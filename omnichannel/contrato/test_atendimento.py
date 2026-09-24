"""Caixa de entrada: conversas, resposta, notas, atribuição, status e etiquetas.

Porte HTTP de tests/test_conversas.py (app/api/conversas.py e
app/servicos/{conversas,mensagens,distribuicao}.py). As conversas nascem por
um webhook de WhatsApp de verdade (canal novo a cada teste, sem App Secret:
o webhook não exige assinatura) e cada teste filtra pelo SEU canal, porque a
base é compartilhada pela sessão inteira.

Setor e assinatura (quem responde aparece para o cliente) valem nos dois
alvos: os dois seeds dão à Ana o setor "Suporte técnico", e os dois servidores
leem o provedor falso (OMNI_TESTE_PROVEDOR).
"""
from __future__ import annotations

import json
import random
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qsl

import httpx
import pytest

from utilitarios import CAMPOS_ATENDENTE, criar_canal, data_com_fuso, exigir_rota, unico

NOME_ANA = "Ana Suporte"
SETOR_ANA = "Suporte técnico"

CAMPOS_CONVERSA = {
    "id", "status", "prioridade", "assunto", "previa", "nao_lidas", "ultima_mensagem_em",
    "criada_em", "contato", "canal", "atendente", "etiquetas",
}
CAMPOS_MENSAGEM = {
    "id", "conversa_id", "contato_id", "direcao", "tipo", "conteudo", "status", "erro",
    "atendente_id", "autor", "anexos", "criada_em",
}
CAMPOS_CONTATO = {"id", "nome", "empresa", "documento", "email", "telefone", "observacoes", "identidades"}
CAMPOS_CANAL = {"id", "nome", "tipo", "ativo", "chave_publica", "configurado", "url_webhook"}


# ------------------------------------------------------------------ apoio
def numero_novo() -> str:
    """Número fictício (faixa 5500 9...) e único na sessão."""
    return "55009" + "".join(random.choices("0123456789", k=8))


def payload_whatsapp(numero: str, texto: str, externo_id: str, nome: str | None = "Cliente") -> dict:
    valor: dict = {"messages": [{"from": numero, "id": externo_id, "type": "text", "text": {"body": texto}}]}
    if nome is not None:
        valor["contacts"] = [{"wa_id": numero, "profile": {"name": nome}}]
    return {"entry": [{"changes": [{"value": valor}]}]}


def whatsapp_entra(cliente, canal: dict, numero: str, texto: str, nome: str | None = "Cliente") -> dict:
    corpo = payload_whatsapp(numero, texto, unico("wamid."), nome)
    resposta = exigir_rota(cliente.post(f"/webhooks/{canal['id']}", json=corpo), "POST /webhooks/{canal_id}")
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def textos_enviados(chamada: dict) -> list[str]:
    """Todos os textos do corpo de uma chamada ao provedor (JSON ou formulário)."""
    corpo = chamada.get("corpo") or ""
    try:
        dados = json.loads(corpo)
    except ValueError:
        dados = {k: v for k, v in parse_qsl(corpo)}
    textos: list[str] = []

    def juntar(valor):
        if isinstance(valor, str):
            textos.append(valor)
        elif isinstance(valor, dict):
            for item in valor.values():
                juntar(item)
        elif isinstance(valor, list):
            for item in valor:
                juntar(item)

    juntar(dados)
    return textos


def conversas(cliente, cabecalho, canal: dict, **filtros) -> list[dict]:
    resposta = cliente.get("/api/conversas", params={"canal_id": canal["id"], **filtros}, headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


@pytest.fixture
def com_setor(login_atendente):
    """AtendenteSaida tem o campo setor (e as respostas, a assinatura)."""
    assert "setor" in login_atendente["atendente"], login_atendente["atendente"]


@pytest.fixture
def setor_da_ana(com_setor, login_atendente):
    """A assinatura esperada usa o setor que os dois seeds dão à Ana."""
    assert login_atendente["atendente"].get("setor") == SETOR_ANA, login_atendente["atendente"]


@pytest.fixture
def provedor_do_alvo(provedor):
    """O provedor falso (os dois alvos leem OMNI_TESTE_PROVEDOR)."""
    return provedor


@pytest.fixture
def conversa(cliente, cabecalho_atendente, canal_whatsapp) -> dict:
    """Uma conversa nova: o cliente Ian manda "Bom dia" pelo WhatsApp."""
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), "Bom dia, tenho uma dúvida", "Ian")
    [unica] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    return unica


def responder(cliente, cabecalho, conversa_id: int, texto: str):
    return cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": texto}, headers=cabecalho)


# ------------------------------------------------------------------ testes
def test_listar_e_abrir_conversa_zera_nao_lidas(cliente, cabecalho_atendente, canal_whatsapp, conversa):
    assert set(conversa) >= CAMPOS_CONVERSA
    assert conversa["nao_lidas"] == 1
    assert conversa["status"] == "aberta" and conversa["prioridade"] == "normal"
    assert conversa["previa"] == "Bom dia, tenho uma dúvida"
    assert set(conversa["canal"]) >= CAMPOS_CANAL
    assert conversa["canal"]["tipo"] == "whatsapp"
    assert conversa["canal"]["url_webhook"] == f"/webhooks/{canal_whatsapp['id']}"
    assert set(conversa["contato"]) >= CAMPOS_CONTATO
    assert conversa["contato"]["nome"] == "Ian"
    assert [i["canal_tipo"] for i in conversa["contato"]["identidades"]] == ["whatsapp"]
    assert conversa["etiquetas"] == []

    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente)
    assert detalhe.status_code == 200
    corpo = detalhe.json()
    assert [m["conteudo"] for m in corpo["mensagens"]] == ["Bom dia, tenho uma dúvida"]
    mensagem = corpo["mensagens"][0]
    assert set(mensagem) >= CAMPOS_MENSAGEM
    assert mensagem["direcao"] == "entrada" and mensagem["status"] == "recebida"
    assert mensagem["autor"] == "Ian"
    assert mensagem["contato_id"] == conversa["contato"]["id"]
    assert conversas(cliente, cabecalho_atendente, canal_whatsapp)[0]["nao_lidas"] == 0


def test_conversa_nova_entra_na_distribuicao(conversa):
    # algum atendente disponível recebe a conversa na hora (menor fila primeiro)
    assert conversa["atendente"] is not None
    assert set(conversa["atendente"]) >= CAMPOS_ATENDENTE


def test_responder_grava_saida_simulada(cliente, cabecalho_atendente, login_atendente, canal_whatsapp, conversa):
    resposta = responder(cliente, cabecalho_atendente, conversa["id"], "  Bom dia! Pode me dizer o CNPJ?  ")
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert set(corpo) >= CAMPOS_MENSAGEM
    assert corpo["direcao"] == "saida" and corpo["tipo"] == "texto"
    assert corpo["conteudo"] == "Bom dia! Pode me dizer o CNPJ?"
    assert corpo["autor"] == NOME_ANA
    assert corpo["atendente_id"] == login_atendente["atendente"]["id"]
    # sem credenciais do provedor, no sandbox o envio só fica registrado
    assert corpo["status"] == "simulada" and corpo["erro"] is None
    data_com_fuso(corpo["criada_em"])

    [depois] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    assert depois["previa"] == "Bom dia! Pode me dizer o CNPJ?"
    assert depois["nao_lidas"] == 0


def test_resposta_valida_o_conteudo(cliente, cabecalho_atendente, conversa):
    assert responder(cliente, cabecalho_atendente, conversa["id"], "").status_code == 422
    assert responder(cliente, cabecalho_atendente, conversa["id"], "x" * 8001).status_code == 422
    sem_campo = cliente.post(f"/api/conversas/{conversa['id']}/mensagens", json={}, headers=cabecalho_atendente)
    assert sem_campo.status_code == 422
    assert sem_campo.json()["detail"][0]["loc"] == ["body", "conteudo"]


def test_nota_interna_nao_e_resposta_ao_contato(cliente, cabecalho_atendente, canal_whatsapp, conversa):
    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/notas",
        headers=cabecalho_atendente,
        json={"conteudo": "Cliente já ligou sobre isso ontem."},
    )
    assert resposta.status_code == 201
    nota = resposta.json()
    assert nota["tipo"] == "nota_interna" and nota["direcao"] == "saida" and nota["status"] == "enviada"
    assert conversas(cliente, cabecalho_atendente, canal_whatsapp)[0]["previa"] == "Bom dia, tenho uma dúvida"


def test_atribuir_e_resolver(cliente, cabecalho_atendente, login_atendente, conversa):
    ana = login_atendente["atendente"]
    atribuida = cliente.post(
        f"/api/conversas/{conversa['id']}/atribuir", headers=cabecalho_atendente, json={"atendente_id": ana["id"]}
    )
    assert atribuida.status_code == 200
    assert atribuida.json()["atendente"]["nome"] == NOME_ANA

    resolvida = cliente.post(
        f"/api/conversas/{conversa['id']}/status", headers=cabecalho_atendente, json={"status": "resolvida"}
    )
    assert resolvida.status_code == 200 and resolvida.json()["status"] == "resolvida"

    devolvida = cliente.post(
        f"/api/conversas/{conversa['id']}/atribuir", headers=cabecalho_atendente, json={"atendente_id": None}
    )
    assert devolvida.json()["atendente"] is None


def test_atribuir_a_quem_nao_existe(cliente, cabecalho_atendente, conversa):
    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/atribuir", headers=cabecalho_atendente, json={"atendente_id": 999999}
    )
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "atendente nao encontrado"}


def test_status_e_prioridade_validam_o_valor(cliente, cabecalho_atendente, conversa):
    base = f"/api/conversas/{conversa['id']}"
    assert cliente.post(f"{base}/status", json={"status": "fechada"}, headers=cabecalho_atendente).status_code == 422
    assert cliente.post(f"{base}/prioridade", json={"prioridade": "urgente"}, headers=cabecalho_atendente).status_code == 422
    alta = cliente.post(f"{base}/prioridade", json={"prioridade": "alta"}, headers=cabecalho_atendente)
    assert alta.status_code == 200 and alta.json()["prioridade"] == "alta"
    pendente = cliente.post(f"{base}/status", json={"status": "pendente"}, headers=cabecalho_atendente)
    assert pendente.json()["status"] == "pendente"


def test_responder_reabre_conversa_resolvida(cliente, cabecalho_atendente, canal_whatsapp, conversa):
    cliente.post(f"/api/conversas/{conversa['id']}/status", headers=cabecalho_atendente, json={"status": "resolvida"})
    assert responder(cliente, cabecalho_atendente, conversa["id"], "Voltando...").status_code == 201
    assert conversas(cliente, cabecalho_atendente, canal_whatsapp)[0]["status"] == "aberta"


def test_mensagem_logo_apos_resolver_reabre_a_mesma_conversa(cliente, cabecalho_atendente, canal_whatsapp):
    numero = numero_novo()
    whatsapp_entra(cliente, canal_whatsapp, numero, "oi", "Ian")
    [primeira] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    cliente.post(f"/api/conversas/{primeira['id']}/status", headers=cabecalho_atendente, json={"status": "resolvida"})

    whatsapp_entra(cliente, canal_whatsapp, numero, "Obrigado!", "Ian")
    [unica] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    assert unica["id"] == primeira["id"]
    assert unica["status"] == "aberta"
    assert unica["previa"] == "Obrigado!"


def test_reentrega_do_webhook_nao_duplica(cliente, cabecalho_atendente, canal_whatsapp):
    corpo = payload_whatsapp(numero_novo(), "uma vez só", unico("wamid."))
    primeira = exigir_rota(cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=corpo), "POST /webhooks/{canal_id}")
    segunda = cliente.post(f"/webhooks/{canal_whatsapp['id']}", json=corpo)
    assert primeira.json()["recebidas"] == 1 and segunda.json()["recebidas"] == 0
    [unica] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    detalhe = cliente.get(f"/api/conversas/{unica['id']}", headers=cabecalho_atendente).json()
    assert [m["conteudo"] for m in detalhe["mensagens"]] == ["uma vez só"]


def test_etiquetas_na_conversa(cliente, cabecalho_atendente, canal_whatsapp, conversa):
    etiqueta = cliente.post(
        "/api/etiquetas", headers=cabecalho_atendente, json={"nome": unico("urgente-"), "cor": "#ff0000"}
    ).json()

    marcada = cliente.post(
        f"/api/conversas/{conversa['id']}/etiquetas", headers=cabecalho_atendente, json={"etiqueta_id": etiqueta["id"]}
    )
    assert marcada.status_code == 200
    assert marcada.json()["etiquetas"] == [etiqueta]
    # marcar de novo não duplica
    de_novo = cliente.post(
        f"/api/conversas/{conversa['id']}/etiquetas", headers=cabecalho_atendente, json={"etiqueta_id": etiqueta["id"]}
    )
    assert de_novo.json()["etiquetas"] == [etiqueta]

    filtrada = conversas(cliente, cabecalho_atendente, canal_whatsapp, etiqueta_id=etiqueta["id"])
    assert [c["id"] for c in filtrada] == [conversa["id"]]

    desmarcada = cliente.delete(f"/api/conversas/{conversa['id']}/etiquetas/{etiqueta['id']}", headers=cabecalho_atendente)
    assert desmarcada.status_code == 200
    assert desmarcada.json()["etiquetas"] == []
    assert conversas(cliente, cabecalho_atendente, canal_whatsapp, etiqueta_id=etiqueta["id"]) == []


def test_etiqueta_inexistente(cliente, cabecalho_atendente, conversa):
    resposta = cliente.post(
        f"/api/conversas/{conversa['id']}/etiquetas", headers=cabecalho_atendente, json={"etiqueta_id": 999999}
    )
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "etiqueta nao encontrada"}


def test_filtros_da_caixa_de_entrada(cliente, cabecalho_atendente, login_atendente, canal_whatsapp):
    ana = login_atendente["atendente"]
    nome_ian = unico("Ian ")
    assunto_boleto = unico("boleto")
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), "Bom dia", nome_ian)
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), f"segunda via do {assunto_boleto}", "Zé")
    por_nome = {c["contato"]["nome"]: c["id"] for c in conversas(cliente, cabecalho_atendente, canal_whatsapp)}
    do_ian, do_ze = por_nome[nome_ian], por_nome["Zé"]

    cliente.post(f"/api/conversas/{do_ian}/atribuir", headers=cabecalho_atendente, json={"atendente_id": ana["id"]})
    cliente.post(f"/api/conversas/{do_ze}/atribuir", headers=cabecalho_atendente, json={"atendente_id": None})

    def ids(**filtros):
        return [c["id"] for c in conversas(cliente, cabecalho_atendente, canal_whatsapp, **filtros)]

    assert sorted(ids()) == sorted([do_ian, do_ze])
    assert ids(atendente="eu") == [do_ian]
    assert ids(atendente="sem") == [do_ze]
    assert ids(atendente=str(ana["id"])) == [do_ian]
    assert len(ids(status="aberta")) == 2
    assert ids(status="resolvida") == []
    # a busca cobre o conteúdo das mensagens e os dados do contato
    assert ids(q=assunto_boleto.upper()) == [do_ze]
    assert ids(q=nome_ian.lower()) == [do_ian]
    # mais recente primeiro
    assert ids() == [do_ze, do_ian]
    assert ids(limite=1) == [do_ze]
    assert ids(limite=1, deslocamento=1) == [do_ian]


def test_filtros_invalidos_sao_recusados(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/conversas", headers=cabecalho_atendente, params={"atendente": "abc"})
    assert resposta.status_code == 422
    assert resposta.json() == {"detail": "filtro de atendente invalido"}
    for params in ({"status": "fechada"}, {"limite": 201}, {"deslocamento": -1}, {"canal_id": "x"}):
        assert cliente.get("/api/conversas", headers=cabecalho_atendente, params=params).status_code == 422, params


def test_conversa_inexistente(cliente, cabecalho_atendente):
    resposta = cliente.get("/api/conversas/999999", headers=cabecalho_atendente)
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "conversa nao encontrada"}
    assert cliente.get("/api/conversas/abc", headers=cabecalho_atendente).status_code == 422


def test_rotas_da_caixa_exigem_token(cliente, conversa):
    base = f"/api/conversas/{conversa['id']}"
    for metodo, caminho, corpo in [
        ("GET", "/api/conversas", None),
        ("GET", base, None),
        ("POST", f"{base}/mensagens", {"conteudo": "oi"}),
        ("POST", f"{base}/notas", {"conteudo": "oi"}),
        ("POST", f"{base}/status", {"status": "resolvida"}),
        ("POST", f"{base}/ler", None),
    ]:
        resposta = cliente.request(metodo, caminho, json=corpo)
        assert resposta.status_code == 401, (metodo, caminho)
        assert resposta.json() == {"detail": "informe o token de acesso"}


def test_ler_zera_nao_lidas(cliente, cabecalho_atendente, canal_whatsapp, conversa):
    resposta = cliente.post(f"/api/conversas/{conversa['id']}/ler", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    assert resposta.json()["nao_lidas"] == 0
    assert set(resposta.json()) >= CAMPOS_CONVERSA


def test_datas_da_api_saem_com_fuso(cliente, cabecalho_atendente, conversa):
    """Sem o fuso, o navegador em Brasília mostra a hora UTC como local: 3 h adiantada."""
    responder(cliente, cabecalho_atendente, conversa["id"], "Oi!")
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    datas = [detalhe["ultima_mensagem_em"], detalhe["criada_em"]] + [m["criada_em"] for m in detalhe["mensagens"]]
    for valor in datas:
        assert re.search(r"(Z|[+-]\d\d:\d\d)$", valor), valor
        data_com_fuso(valor)
    # cronológica: a entrada antes da resposta
    assert [m["direcao"] for m in detalhe["mensagens"]] == ["entrada", "saida"]


def test_resposta_vira_evento_com_contato(cliente, cabecalho_atendente, conversa):
    cursor = exigir_rota(
        cliente.get("/api/eventos/desde", headers=cabecalho_atendente), "GET /api/eventos/desde"
    ).json()["ultimo"]
    texto = unico("resposta ")
    responder(cliente, cabecalho_atendente, conversa["id"], texto)
    eventos = cliente.get("/api/eventos/desde", params={"depois": cursor}, headers=cabecalho_atendente).json()["eventos"]
    nova = next(e["dados"] for e in eventos if e["tipo"] == "mensagem.nova" and e["dados"]["conteudo"] == texto)
    assert nova["contato_id"] == conversa["contato"]["id"]
    assert nova["conversa_id"] == conversa["id"]
    atualizada = [e["dados"] for e in eventos if e["tipo"] == "conversa.atualizada" and e["dados"]["id"] == conversa["id"]]
    assert atualizada and atualizada[-1]["previa"] == texto


# ------------------------------------------------------------- quem atende
def test_resposta_expoe_a_assinatura_do_atendente(cliente, cabecalho_atendente, setor_da_ana, conversa):
    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "Olá!").json()
    assert corpo["assinatura"] == {"nome": NOME_ANA, "setor": SETOR_ANA}
    assert corpo["conteudo"] == "Olá!"  # o texto gravado fica sem a assinatura
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    entrada, saida = detalhe["mensagens"]
    assert entrada["assinatura"] is None
    assert saida["assinatura"] == {"nome": NOME_ANA, "setor": SETOR_ANA}


def test_assinatura_vai_ao_whatsapp_na_primeira_linha(cliente, cabecalho_admin, cabecalho_atendente, setor_da_ana, provedor_do_alvo):
    provedor = provedor_do_alvo
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk-falso", "id_numero": "123456"})
    assert canal["configurado"] is True
    provedor.roteirar("graph.facebook.com", metodo="POST", json={"messages": [{"id": "wamid.SAIDA1"}]})
    whatsapp_entra(cliente, canal, numero_novo(), "oi", "Ian")
    [conversa] = conversas(cliente, cabecalho_atendente, canal)

    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "Bom dia!").json()
    assert corpo["status"] == "enviada", corpo
    chamadas = [c for c in provedor.chamadas() if "/messages" in c["url"]]
    assert chamadas, provedor.chamadas()
    assert f"*{NOME_ANA} · {SETOR_ANA}*\nBom dia!" in textos_enviados(chamadas[-1])


def test_assinatura_vai_ao_telegram_na_primeira_linha(cliente, cabecalho_admin, cabecalho_atendente, setor_da_ana, provedor_do_alvo):
    provedor = provedor_do_alvo
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "123:falso"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    provedor.roteirar("/sendMessage", metodo="POST", json={"ok": True, "result": {"message_id": 77}})
    chat = random.randint(10_000, 99_999_999)
    entrada = {"update_id": 1, "message": {"message_id": 1, "chat": {"id": chat}, "from": {"first_name": "Zé"}, "text": "oi"}}
    resposta = exigir_rota(
        cliente.post(f"/webhooks/{canal['id']}", json=entrada, headers={"X-Telegram-Bot-Api-Secret-Token": segredo or ""}),
        "POST /webhooks/{canal_id}",
    )
    assert resposta.status_code == 200, resposta.text
    [conversa] = conversas(cliente, cabecalho_atendente, canal)

    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "Olá, Zé").json()
    assert corpo["status"] == "enviada", corpo
    chamadas = [c for c in provedor.chamadas() if "/sendMessage" in c["url"]]
    assert chamadas, provedor.chamadas()
    assert f"{NOME_ANA} · {SETOR_ANA}\nOlá, Zé" in textos_enviados(chamadas[-1])


def test_webchat_nao_mexe_no_texto(cliente, cabecalho_atendente, setor_da_ana, canal_webchat):
    sessao = exigir_rota(
        cliente.post("/api/widget/sessao", json={"chave_publica": canal_webchat["chave_publica"], "nome": "Visitante"}),
        "POST /api/widget/sessao",
    ).json()
    enviada = exigir_rota(
        cliente.post("/api/widget/mensagens", json={"conteudo": "oi"}, headers={"X-Sessao": sessao["token"]}),
        "POST /api/widget/mensagens",
    )
    assert enviada.status_code == 201, enviada.text
    [conversa] = conversas(cliente, cabecalho_atendente, canal_webchat)
    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "Olá!").json()
    assert corpo["status"] == "enviada"
    assert corpo["conteudo"] == "Olá!"
    assert corpo["assinatura"] == {"nome": NOME_ANA, "setor": SETOR_ANA}


def test_entrada_simulada_nunca_sai_pelo_provedor(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    """O simulador inventa o número do cliente: se o canal ganhar credencial
    depois, a resposta NÃO pode ir para esse número (pode ser de alguém)."""
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp")
    simulada = exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            json={"canal_id": canal["id"], "identificador": numero_novo(), "nome": "Teste", "conteudo": "oi"},
            headers=cabecalho_atendente,
        ),
        "POST /api/simulador/mensagens",
    )
    assert simulada.status_code == 201, simulada.text
    ligado = exigir_rota(
        cliente.patch(
            f"/api/canais/{canal['id']}",
            json={"credenciais": {"token": "tk-falso", "id_numero": "123456"}},
            headers=cabecalho_admin,
        ),
        "PATCH /api/canais/{id}",
    )
    assert ligado.status_code == 200 and ligado.json()["configurado"] is True
    provedor.roteirar("graph.facebook.com", json={"messages": [{"id": "wamid.NAO"}]})

    [conversa] = conversas(cliente, cabecalho_atendente, canal)
    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "resposta").json()
    assert corpo["status"] == "simulada"
    assert [c for c in provedor.chamadas() if "/messages" in c["url"]] == []


def test_resposta_sai_quando_o_cliente_real_escreve_depois_da_simulacao(
    cliente, cabecalho_admin, cabecalho_atendente, provedor_do_alvo
):
    """O dono testa no simulador com o próprio número, liga o canal e escreve
    de verdade do celular: a MESMA conversa recebe a entrada real, e a
    resposta tem de sair pelo provedor (antes ficava "simulada" para sempre)."""
    provedor = provedor_do_alvo
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp")
    numero = numero_novo()
    simulada = exigir_rota(
        cliente.post(
            "/api/simulador/mensagens",
            json={"canal_id": canal["id"], "identificador": numero, "nome": "Dono", "conteudo": "teste"},
            headers=cabecalho_atendente,
        ),
        "POST /api/simulador/mensagens",
    )
    assert simulada.status_code == 201, simulada.text
    ligado = cliente.patch(
        f"/api/canais/{canal['id']}", json={"credenciais": {"token": "tk-falso", "id_numero": "123456"}},
        headers=cabecalho_admin,
    )
    assert ligado.status_code == 200 and ligado.json()["configurado"] is True
    provedor.roteirar("graph.facebook.com", metodo="POST", json={"messages": [{"id": unico("wamid.real")}]})

    whatsapp_entra(cliente, canal, numero, "agora é de verdade", "Dono")
    [conversa] = conversas(cliente, cabecalho_atendente, canal)
    corpo = responder(cliente, cabecalho_atendente, conversa["id"], "Recebido!").json()
    assert corpo["status"] == "enviada", corpo
    [envio] = [c for c in provedor.chamadas() if "/messages" in c["url"]]
    assert json.loads(envio["corpo"])["to"] == numero


def test_rajada_de_webhooks_nao_perde_mensagem_nem_nao_lidas(cliente, cabecalho_atendente, canal_whatsapp, servidor):
    """O cliente manda várias mensagens seguidas e a Meta entrega os webhooks
    ao mesmo tempo: todas entram (nada de 500 por deadlock), numa conversa
    só, e o contador de não lidas conta todas. Com OMNI_CONTRATO_MYSQL o
    teste roda contra o InnoDB, onde a corrida existe de verdade."""
    numero = numero_novo()
    quantas = 8

    def entregar(i: int) -> int:
        corpo = payload_whatsapp(numero, f"parte {i}", unico("wamid.rajada"), "Rajada")
        with httpx.Client(base_url=servidor.url, timeout=30.0) as c:
            return c.post(f"/webhooks/{canal_whatsapp['id']}", json=corpo).status_code

    with ThreadPoolExecutor(quantas) as grupo:
        codigos = list(grupo.map(entregar, range(quantas)))
    assert codigos == [200] * quantas

    [unica] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    assert unica["nao_lidas"] == quantas
    detalhe = cliente.get(f"/api/conversas/{unica['id']}", headers=cabecalho_atendente).json()
    assert sorted(m["conteudo"] for m in detalhe["mensagens"]) == sorted(f"parte {i}" for i in range(quantas))


def test_resposta_cruzando_com_entrada_nao_derruba_nenhuma(cliente, cabecalho_atendente, canal_whatsapp, servidor, conversa):
    """Atendente respondendo enquanto o cliente escreve (mesma conversa)."""
    numero = conversa["contato"]["identidades"][0]["identificador"]
    cabecalho = dict(cabecalho_atendente)

    def trabalho(i: int) -> int:
        with httpx.Client(base_url=servidor.url, timeout=30.0) as c:
            if i % 2:
                return c.post(f"/api/conversas/{conversa['id']}/mensagens", json={"conteudo": f"resp {i}"}, headers=cabecalho).status_code
            corpo = payload_whatsapp(numero, f"cli {i}", unico("wamid.cruza"), "Ian")
            return c.post(f"/webhooks/{canal_whatsapp['id']}", json=corpo).status_code

    with ThreadPoolExecutor(8) as grupo:
        codigos = list(grupo.map(trabalho, range(12)))
    assert sorted(set(codigos)) == [200, 201], codigos
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    assert len(detalhe["mensagens"]) == 1 + 12


def test_anexo_com_tipo_executavel_nunca_abre_no_painel(cliente, cabecalho_admin, cabecalho_atendente, provedor_do_alvo):
    """O tipo do anexo recebido vem do REMETENTE: um "text/xsl" com XHTML e
    script dentro rodaria na origem do painel (o Chromium executa XSL/XML).
    O tipo guardado é conferido com os bytes e só sai como download."""
    provedor = provedor_do_alvo
    canal = criar_canal(cliente, cabecalho_admin, "telegram", credenciais={"token": "bot"})
    segredo = cliente.get(f"/api/canais/{canal['id']}/credenciais", headers=cabecalho_admin).json()["segredo_webhook"]
    xml = (b'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>'
           b'<script>document.title="XSS"</script></body></html>')
    provedor.roteirar("/getFile", json={"ok": True, "result": {"file_path": "documents/nota.xsl"}})
    provedor.roteirar("/file/botbot/documents/nota.xsl", corpo_bytes=xml)
    resposta = cliente.post(
        f"/webhooks/{canal['id']}",
        json={"message": {"message_id": 9, "chat": {"id": random.randint(1, 10**9)}, "from": {"first_name": "Mal"},
                          "document": {"file_id": "x", "file_name": "nota.xsl", "mime_type": "text/xsl"}}},
        headers={"x-telegram-bot-api-secret-token": segredo or ""},
    )
    assert resposta.status_code == 200, resposta.text
    [conversa] = conversas(cliente, cabecalho_atendente, canal)
    detalhe = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()
    [anexo] = detalhe["mensagens"][0]["anexos"]
    assert anexo["tipo_conteudo"] != "text/xsl" and anexo["imagem"] is False
    baixado = cliente.get(anexo["url"], headers=cabecalho_atendente)
    assert baixado.status_code == 200 and baixado.content == xml
    assert baixado.headers["content-disposition"].startswith("attachment")
    assert "sandbox" in baixado.headers.get("content-security-policy", "")


def test_busca_com_maiuscula_acentuada(cliente, cabecalho_atendente, canal_whatsapp):
    """"CÁLCULO" gravado é achado buscando "CÁLCULO" (no SQLite o LOWER só
    troca ASCII: os dois lados precisam passar pelo mesmo LOWER do banco)."""
    marca = unico("M")
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), f"PRECISO DO CÁLCULO DE SERVIÇO {marca}", f"JOÃO ÁVILA {marca}")
    [conversa] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    for termo in (f"CÁLCULO DE SERVIÇO {marca}", f"JOÃO ÁVILA {marca}", f"ÁVILA {marca.lower()}", marca):
        achadas = conversas(cliente, cabecalho_atendente, canal_whatsapp, q=termo)
        assert [c["id"] for c in achadas] == [conversa["id"]], termo


def test_resposta_so_com_espacos_e_recusada(cliente, cabecalho_atendente, conversa):
    """Espaços não são uma resposta: nada vai ao cliente e nada fica gravado."""
    antes = len(cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()["mensagens"])
    for texto in ("", "   ", "\n\t "):
        resposta = responder(cliente, cabecalho_atendente, conversa["id"], texto)
        assert resposta.status_code == 422, (texto, resposta.text)
    depois = cliente.get(f"/api/conversas/{conversa['id']}", headers=cabecalho_atendente).json()["mensagens"]
    assert len(depois) == antes


def test_sem_login_e_401_antes_de_saber_se_a_conversa_existe(cliente, conversa):
    """Sem token, "existe" e "não existe" respondem igual: nada de enumerar ids."""
    for conversa_id in (conversa["id"], 99999999):
        assert cliente.get(f"/api/conversas/{conversa_id}").status_code == 401
        assert cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": "x"}).status_code == 401
