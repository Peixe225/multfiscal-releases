"""Apoio dos testes de cargos, permissões e setores (test_cargos_*.py).

Cada teste cria as próprias pessoas, setores e canais (nomes únicos): a base
é da sessão inteira e outros testes criam gente disponível o tempo todo.
Por isso a distribuição só é conferida DENTRO de um setor novo (conversa de
setor só vai para quem é do setor), nunca na fila geral.
"""
from __future__ import annotations

import random

import httpx

from utilitarios import criar_canal, entrar, exigir_rota, unico

SENHA = "senha-de-cargo-123"

# mensagens de erro do contrato (iguais nos dois servidores)
PROPRIO_PERFIL = "no próprio perfil você só altera a senha e a disponibilidade"
SO_ABAIXO = "você só gerencia pessoas de cargo abaixo do seu"
CONCEDER_ABAIXO = "você só pode conceder cargos abaixo do seu"
SO_SEU_SETOR = "você só gerencia pessoas do seu setor"
ULTIMO_ADMIN = "é preciso manter pelo menos um Administrador ativo"
CARGO_ADMIN_TRAVADO = "o cargo Administrador não pode ser alterado"
CARGO_ACIMA = "você só gerencia cargos abaixo do seu"
CARGO_DE_FABRICA = "cargo de fábrica não pode ser apagado"


def sem_permissao(rotulo: str) -> dict:
    return {"detail": f"sem permissão para {rotulo}"}


class Pessoa:
    """Um atendente com login próprio."""

    def __init__(self, cliente: httpx.Client, dados: dict, token: str):
        self.cliente = cliente
        self.dados = dados
        self.id = dados["id"]
        self.nome = dados["nome"]
        self.token = token
        self.cab = {"Authorization": f"Bearer {token}"}

    def get(self, caminho, **kw):
        return self.cliente.get(caminho, headers=self.cab, **kw)

    def post(self, caminho, corpo=None, **kw):
        return self.cliente.post(caminho, json=corpo, headers=self.cab, **kw)

    def patch(self, caminho, corpo, **kw):
        return self.cliente.patch(caminho, json=corpo, headers=self.cab, **kw)

    def delete(self, caminho, **kw):
        return self.cliente.delete(caminho, headers=self.cab, **kw)

    def eu(self) -> dict:
        resposta = self.get("/api/auth/eu")
        assert resposta.status_code == 200, resposta.text
        return resposta.json()

    def cursor(self) -> int:
        return self.get("/api/eventos/desde").json()["ultimo"]

    def eventos(self, depois: int) -> list[dict]:
        resposta = self.get("/api/eventos/desde", params={"depois": depois, "limite": 500})
        assert resposta.status_code == 200, resposta.text
        return resposta.json()["eventos"]

    def conversas_dos_eventos(self, depois: int) -> set[int]:
        """Ids de conversa que chegaram a esta pessoa por evento."""
        ids = set()
        for evento in self.eventos(depois):
            if evento["tipo"].startswith("mensagem."):
                ids.add(evento["dados"]["conversa_id"])
            elif evento["tipo"].startswith("conversa."):
                ids.add(evento["dados"]["id"])
        return ids

    def ve(self, conversa_id: int, canal_id: int | None = None) -> bool:
        """A conversa aparece na lista E abre no detalhe (e as duas concordam)."""
        parametros = {"limite": 200}
        if canal_id is not None:
            parametros["canal_id"] = canal_id
        lista = self.get("/api/conversas", params=parametros)
        assert lista.status_code == 200, lista.text
        na_lista = conversa_id in [c["id"] for c in lista.json()]
        detalhe = self.get(f"/api/conversas/{conversa_id}")
        assert detalhe.status_code in (200, 404), detalhe.text
        if detalhe.status_code == 404:
            assert detalhe.json() == {"detail": "conversa nao encontrada"}
        assert na_lista == (detalhe.status_code == 200), (na_lista, detalhe.status_code)
        return na_lista


def cargos(cliente: httpx.Client, cab: dict) -> dict[str, dict]:
    resposta = exigir_rota(cliente.get("/api/cargos", headers=cab), "GET /api/cargos")
    assert resposta.status_code == 200, resposta.text
    return {c["nome"]: c for c in resposta.json()}


def cargo_id(cliente: httpx.Client, cab: dict, nome: str) -> int:
    return cargos(cliente, cab)[nome]["id"]


def novo_setor(cliente: httpx.Client, cab_admin: dict, prefixo: str = "Setor ") -> dict:
    resposta = exigir_rota(
        cliente.post("/api/setores", json={"nome": unico(prefixo)}, headers=cab_admin), "POST /api/setores"
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def novo_cargo(cliente: httpx.Client, cab_admin: dict, nivel: int, permissoes: list[str], prefixo="Cargo ") -> dict:
    resposta = cliente.post(
        "/api/cargos", json={"nome": unico(prefixo), "nivel": nivel, "permissoes": permissoes}, headers=cab_admin
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def nova_pessoa(
    cliente: httpx.Client,
    cab_admin: dict,
    cargo: str | int = "Colaborador",
    setor: dict | None = None,
    disponivel: bool = False,
    nome: str | None = None,
) -> Pessoa:
    """Pessoa nova criada pelo admin. Por padrão INDISPONÍVEL: não entra na
    distribuição e não rouba conversa de outro teste."""
    corpo = {
        "nome": nome or unico("Pessoa "),
        "email": f"{unico('cargo')}@exemplo.com.br",
        "senha": SENHA,
        "cargo_id": cargo if isinstance(cargo, int) else cargo_id(cliente, cab_admin, cargo),
        "setor_id": setor["id"] if setor else None,
        "disponivel": disponivel,
    }
    resposta = cliente.post("/api/atendentes", json=corpo, headers=cab_admin)
    assert resposta.status_code == 201, resposta.text
    dados = resposta.json()
    assert dados["disponivel"] is disponivel, dados
    return Pessoa(cliente, dados, entrar(cliente, corpo["email"], SENHA)["token"])


def canal_do_setor(cliente: httpx.Client, cab_admin: dict, setor: dict | None) -> dict:
    """Canal de WhatsApp (sem App Secret: o webhook entra sem assinatura) cujas
    conversas novas caem na fila do setor."""
    canal = criar_canal(cliente, cab_admin, "whatsapp", setor_padrao_id=setor["id"] if setor else None)
    assert canal["setor_padrao_id"] == (setor["id"] if setor else None), canal
    return canal


def cliente_escreve(cliente: httpx.Client, cab_admin: dict, canal: dict, texto: str = "Olá, preciso de ajuda") -> dict:
    """Um cliente novo manda uma mensagem no canal; devolve a ConversaSaida (lida pelo admin)."""
    numero = "55009" + "".join(random.choices("0123456789", k=8))
    corpo = {"entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": numero, "profile": {"name": unico("Cliente ")}}],
        "messages": [{"from": numero, "id": unico("wamid."), "type": "text", "text": {"body": texto}}],
    }}]}]}
    resposta = cliente.post(f"/webhooks/{canal['id']}", json=corpo)
    assert resposta.status_code == 200, resposta.text
    lista = cliente.get("/api/conversas", params={"canal_id": canal["id"], "limite": 200}, headers=cab_admin).json()
    return next(c for c in lista if c["contato"]["telefone"] == numero or numero in str(c["contato"]["identidades"]))


def conversa(cliente: httpx.Client, cab_admin: dict, conversa_id: int) -> dict:
    resposta = cliente.get(f"/api/conversas/{conversa_id}", headers=cab_admin)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()
