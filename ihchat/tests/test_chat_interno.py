"""Chat interno no app Python: o que a suíte de contrato não alcança por HTTP.

(O contrato em contrato/test_chat_interno.py cobre a API nos dois servidores.)
Aqui: a base antiga ganhando as tabelas na subida, o fluxo SSE filtrando por
membro, a fila sem filtro nunca soltando "interno.*", a sincronização
idempotente (e a que esbarra numa corrida), as menções e o apagar de verdade.
"""
from __future__ import annotations

import asyncio
import json

from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.api import eventos as rotas_eventos
from app.db import SessaoLocal, criar_tabelas, engine
from app.models import (
    Atendente,
    Conversa,
    FilaEvento,
    MembroSala,
    MensagemInterna,
    Papel,
    SalaInterna,
    TipoCanal,
)
from app.security import criar_token, gerar_hash_senha
from app.servicos import chat_interno as svc
from conftest import criar_canal

TABELAS = ("interno_mensagens", "interno_membros", "interno_salas")


def pessoa(cliente, nome: str, setor: str | None = None) -> tuple[Atendente, dict]:
    with SessaoLocal() as sessao:
        atendente = Atendente(
            nome=nome,
            email=f"{nome.lower().replace(' ', '.')}@teste.com.br",
            senha_hash=gerar_hash_senha("senha123"),
            papel=Papel.ATENDENTE.value,
            setor=setor,
        )
        sessao.add(atendente)
        sessao.commit()
        sessao.refresh(atendente)
    return atendente, {"Authorization": f"Bearer {criar_token(atendente.id)}"}


def direta(cliente, cabecalho, outro_id: int) -> dict:
    resposta = cliente.post("/api/interno/diretas", json={"atendente_id": outro_id}, headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def enviar(cliente, cabecalho, sala_id: int, conteudo: str, **extra) -> dict:
    resposta = cliente.post(
        f"/api/interno/salas/{sala_id}/mensagens", json={"conteudo": conteudo, **extra}, headers=cabecalho
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


# ------------------------------------------------------------------ esquema
def test_base_antiga_ganha_as_tabelas_na_subida(cliente, atendente):
    """Base criada antes do chat interno: a subida cria as tabelas que faltam
    sem tocar no que já existe."""
    with engine.begin() as conexao:
        for tabela in TABELAS:
            conexao.execute(text(f"DROP TABLE {tabela}"))
    assert not set(TABELAS) & set(inspect(engine).get_table_names())

    criar_tabelas()  # é o que o ciclo de vida do app chama na subida
    assert set(TABELAS) <= set(inspect(engine).get_table_names())
    indices = {i["name"] for i in inspect(engine).get_indexes("interno_salas")}
    assert {"uq_interno_salas_chave", "ix_interno_salas_tipo"} <= indices
    with SessaoLocal() as sessao:
        assert sessao.get(Atendente, atendente.id) is not None


# --------------------------------------------------------- tempo real (SSE)
def _ler_stream(token: str, ate: str = "event: conversa.atualizada") -> list[str]:
    """Consome a resposta da ROTA /api/eventos/stream (com o filtro dela) até
    o primeiro evento que contenha `ate` (o último que os testes geram)."""

    async def consumir():
        with SessaoLocal() as sessao:
            resposta = rotas_eventos.stream(sessao, token=token, depois=0, last_event_id=None)
        corpo = resposta.body_iterator
        partes = []
        try:
            async for trecho in corpo:
                if trecho.startswith("id:"):
                    partes.append(trecho)
                    if ate in trecho:
                        break
        finally:
            await corpo.aclose()
        return partes

    return asyncio.run(asyncio.wait_for(consumir(), timeout=5))


def test_stream_so_entrega_o_chat_a_membros(cliente, admin, atendente, cabecalho_admin, cabecalho_atendente):
    caio, _ = pessoa(cliente, "Caio Reis")
    sala = direta(cliente, cabecalho_atendente, admin.id)
    enviar(cliente, cabecalho_atendente, sala["id"], "segredo da direta")
    # um evento de atendimento depois, para o fluxo de quem não é membro ter o que entregar
    canal = criar_canal(TipoCanal.WEBCHAT)
    sessao_widget = cliente.post("/api/widget/sessao", json={"chave_publica": canal.chave_publica}).json()
    cliente.post("/api/widget/mensagens", json={"conteudo": "cliente"}, headers={"X-Sessao": sessao_widget["token"]})

    do_admin = _ler_stream(criar_token(admin.id))
    tipos_admin = [p.split("\n")[1] for p in do_admin]
    assert "event: interno.mensagem" in tipos_admin
    assert any("segredo da direta" in p for p in do_admin)

    do_caio = _ler_stream(criar_token(caio.id))
    assert all("interno.mensagem" not in p and "segredo" not in p for p in do_caio)
    # do chat, o Caio só recebe o aviso de que entrou na Geral (dele mesmo)
    assert [p.split("\n")[1] for p in do_caio] == [
        "event: interno.sala",
        "event: mensagem.nova",
        "event: conversa.atualizada",
    ]
    assert f'"para": [{caio.id}]' in do_caio[0]


def test_fila_sem_filtro_nunca_solta_o_chat(cliente, atendente, cabecalho_atendente, admin):
    sala = direta(cliente, cabecalho_atendente, admin.id)
    enviar(cliente, cabecalho_atendente, sala["id"], "só para membros")
    with SessaoLocal() as sessao:
        assert sessao.scalar(select(func.count()).where(FilaEvento.tipo == "interno.mensagem")) == 1
    # quem esquecer o filtro erra para o lado seguro
    assert not [e for e in rotas_eventos.ler_desde(0)["eventos"] if e["tipo"].startswith("interno.")]
    # o widget (filtro próprio) também não vê
    assert rotas_eventos.ler_desde(0, filtro=rotas_eventos.do_visitante(1))["eventos"] == []


def test_filtro_de_membro_le_as_salas_uma_vez_por_lote(monkeypatch):
    chamadas = []
    monkeypatch.setattr(svc, "ids_das_salas", lambda atendente_id: chamadas.append(atendente_id) or {7})
    filtro = rotas_eventos.FiltroDoAtendente(3)
    linha = FilaEvento(tipo="interno.mensagem", dados="{}")
    assert filtro(linha, {"sala_id": 7}) is True
    assert filtro(linha, {"sala_id": 8}) is False
    assert filtro(FilaEvento(tipo="interno.lida"), {"sala_id": 7, "para": [4]}) is False
    assert filtro(FilaEvento(tipo="interno.lida"), {"sala_id": 8, "para": [3]}) is True
    assert filtro(linha, None) is False
    assert filtro(FilaEvento(tipo="mensagem.nova"), {"qualquer": 1}) is True
    assert chamadas == [3]
    filtro.novo_lote()  # quem saiu de uma sala deixa de receber já no próximo lote
    filtro(linha, {"sala_id": 7})
    assert chamadas == [3, 3]


# ------------------------------------------------------------ sincronização
def test_sincronizar_e_idempotente(cliente, admin, atendente):
    with SessaoLocal() as sessao:
        svc.sincronizar(sessao)
        svc.sincronizar(sessao)
        assert sessao.scalar(select(func.count()).select_from(SalaInterna).where(SalaInterna.tipo == "geral")) == 1
        geral = sessao.scalar(select(SalaInterna).where(SalaInterna.chave == svc.CHAVE_GERAL))
        membros = set(sessao.scalars(select(MembroSala.atendente_id).where(MembroSala.sala_id == geral.id)))
        assert membros == {admin.id, atendente.id}
    with SessaoLocal() as sessao:
        eventos = sessao.scalar(select(func.count()).where(FilaEvento.tipo == "interno.sala"))
    # uma entrada por pessoa na Geral, e nenhuma repetida na segunda passada
    assert eventos == 2


def test_sincronizar_tenta_de_novo_depois_de_uma_corrida(cliente, admin, monkeypatch):
    original = svc._sincronizar
    tentativas = []

    def com_corrida(sessao):
        tentativas.append(1)
        if len(tentativas) == 1:
            # outra requisição criou a mesma sala no mesmo instante
            raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed: interno_salas.chave"))
        return original(sessao)

    monkeypatch.setattr(svc, "_sincronizar", com_corrida)
    with SessaoLocal() as sessao:
        svc.sincronizar(sessao)
        assert sessao.scalar(select(func.count()).select_from(SalaInterna)) == 1
    assert len(tentativas) == 2


def test_setor_normalizado_e_chave_estavel():
    assert svc.normalizar_setor("  Suporte   Técnico ") == "suporte técnico"
    assert svc.chave_setor("Suporte Técnico") == svc.chave_setor(" suporte  técnico")
    assert svc.chave_setor("Implantação") != svc.chave_setor("Implantacao")
    assert svc.chave_setor("   ") is None and svc.chave_setor(None) is None
    assert svc.chave_direta(9, 3) == svc.chave_direta(3, 9) == "direta:3:9"


# ------------------------------------------------------------------ menções
def test_resolver_mencoes():
    candidatos = [(1, "Ana Lima"), (2, "Bia Souza"), (3, "Bia Alves"), (4, "Caio  Reis")]
    assert svc.resolver_mencoes("oi @Ana, e @bia souza", candidatos, None) == [1, 2]
    assert svc.resolver_mencoes("@Bia não diz qual Bia", candidatos, None) == []
    assert svc.resolver_mencoes("@Caio Reis e @Caio", candidatos, None) == [4]
    assert svc.resolver_mencoes("contato@Ana.com e @Anabela", candidatos, None) == []
    assert svc.resolver_mencoes("eu mesma: @Ana Lima", candidatos, 1) == []
    assert svc.resolver_mencoes("sem arroba", candidatos, None) == []
    assert svc.resolver_mencoes("(@ana)", candidatos, None) == [1]


# ------------------------------------------------------------- privacidade
def test_apagar_tira_o_texto_do_banco(cliente, atendente, admin, cabecalho_atendente):
    sala = direta(cliente, cabecalho_atendente, admin.id)
    mensagem = enviar(cliente, cabecalho_atendente, sala["id"], "senha do wifi é 1234 @Admin")
    assert cliente.delete(f"/api/interno/mensagens/{mensagem['id']}", headers=cabecalho_atendente).status_code == 200
    with SessaoLocal() as sessao:
        linha = sessao.get(MensagemInterna, mensagem["id"])
        assert (linha.apagada, linha.conteudo, linha.mencoes) == (True, "", [])
        # e o evento de "atualizada" não leva o texto antigo
        dados = [json.loads(e.dados) for e in sessao.scalars(select(FilaEvento).where(FilaEvento.tipo.like("interno.%")))]
    # nenhum evento guardado (nem o da criação) leva mais o texto antigo
    da_mensagem = [d for d in dados if d.get("id") == mensagem["id"]]
    assert len(da_mensagem) == 2
    assert all(d["apagada"] is True for d in da_mensagem)
    assert "1234" not in json.dumps(da_mensagem)


def test_conversa_apagada_tira_o_cartao(cliente, atendente, admin, cabecalho_atendente):
    canal = criar_canal(TipoCanal.WEBCHAT)
    sessao_widget = cliente.post("/api/widget/sessao", json={"chave_publica": canal.chave_publica}).json()
    cliente.post("/api/widget/mensagens", json={"conteudo": "oi"}, headers={"X-Sessao": sessao_widget["token"]})
    with SessaoLocal() as sessao:
        conversa_id = sessao.scalar(select(Conversa.id))
    sala = direta(cliente, cabecalho_atendente, admin.id)
    mensagem = enviar(cliente, cabecalho_atendente, sala["id"], "veja", conversa_id=conversa_id)
    assert mensagem["conversa"]["id"] == conversa_id
    with SessaoLocal() as sessao:
        sessao.delete(sessao.get(Conversa, conversa_id))
        sessao.commit()
    vistas = cliente.get(f"/api/interno/salas/{sala['id']}/mensagens", headers=cabecalho_atendente).json()
    assert vistas["mensagens"][0]["conversa"] is None and vistas["mensagens"][0]["conversa_id"] is None


def test_quem_entra_no_grupo_ve_o_historico_sem_nao_lidas(cliente, atendente, admin, cabecalho_atendente, cabecalho_admin):
    caio, cabecalho_caio = pessoa(cliente, "Caio Reis")
    grupo = cliente.post(
        "/api/interno/grupos", json={"nome": "Plantão", "membros": [admin.id]}, headers=cabecalho_atendente
    ).json()
    enviar(cliente, cabecalho_atendente, grupo["id"], "combinado antes do Caio")
    resposta = cliente.patch(
        f"/api/interno/salas/{grupo['id']}", json={"adicionar": [caio.id]}, headers=cabecalho_atendente
    )
    assert resposta.status_code == 200, resposta.text
    visto = cliente.get(f"/api/interno/salas/{grupo['id']}", headers=cabecalho_caio).json()
    assert visto["nao_lidas"] == 0
    historico = cliente.get(f"/api/interno/salas/{grupo['id']}/mensagens", headers=cabecalho_caio).json()
    assert [m["conteudo"] for m in historico["mensagens"]] == ["combinado antes do Caio"]
    # o admin do sistema também administra grupos de que é membro
    assert cliente.get(f"/api/interno/salas/{grupo['id']}", headers=cabecalho_admin).json()["administrador"] is True
