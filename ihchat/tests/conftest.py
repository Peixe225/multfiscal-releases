"""Configuracao dos testes.

As variaveis de ambiente sao definidas *antes* de importar a aplicacao porque a
engine e criada no import de `app.db`.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
_arquivo_banco = Path(tempfile.mkdtemp(prefix="ihchat-testes-")) / "teste.db"

os.environ.update(
    IHCHAT_BANCO_URL=f"sqlite:///{_arquivo_banco}",
    IHCHAT_COLETOR_ATIVO="0",
    IHCHAT_MODO_SANDBOX="1",
    IHCHAT_CHAVE_SECRETA="chave-de-teste",
)

import sys  # noqa: E402

sys.path.insert(0, str(RAIZ))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.armazenamento import ArmazenamentoLocal, definir_armazenamento  # noqa: E402
from app.canais import http as canal_http  # noqa: E402
from app.db import Base, SessaoLocal, engine  # noqa: E402
from app.main import criar_app  # noqa: E402
from app.models import Atendente, Canal, Cargo, Papel, TipoCanal  # noqa: E402
from app.security import gerar_chave, gerar_hash_senha  # noqa: E402


@pytest.fixture(autouse=True)
def banco_limpo(tmp_path):
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    # anexos vão para uma pasta descartável, nunca para a do projeto
    definir_armazenamento(ArmazenamentoLocal(tmp_path / "anexos"))
    yield
    canal_http.definir_transporte(None)
    definir_armazenamento(None)


@pytest.fixture
def sessao():
    with SessaoLocal() as s:
        yield s


@pytest.fixture
def cliente():
    with TestClient(criar_app()) as c:
        yield c


def _criar_atendente(nome: str, email: str, senha: str, papel: Papel) -> Atendente:
    with SessaoLocal() as sessao:
        atendente = Atendente(
            nome=nome, email=email, senha_hash=gerar_hash_senha(senha), papel=papel.value
        )
        sessao.add(atendente)
        sessao.commit()
        sessao.refresh(atendente)
        return atendente


@pytest.fixture
def admin():
    return _criar_atendente("Admin", "admin@teste.com.br", "admin123", Papel.ADMIN)


# O que o papel "atendente" podia fazer antes dos cargos (tudo menos canais
# e equipe). Com papel "atendente" e sem cargo, a Ana seria Colaboradora (vê
# só as próprias conversas e a fila); os testes que a usam como "o atendente
# comum de sempre" pedem este cargo. As regras dos cargos de fábrica ficam em
# tests/test_cargos.py e na suíte de contrato (test_cargos_*.py).
PERMISSOES_ATENDENTE_LEGADO = [
    "equipe.ver", "canais.ver", "conversas.ver_todas", "conversas.ver_setor", "conversas.transferir",
    "conversas.resolver", "conversas.reabrir", "contatos.editar", "contatos.mesclar", "respostas.gerenciar",
    "etiquetas.gerenciar", "metricas.ver_todas", "metricas.ver_setor", "chat.criar_grupo", "simulador.usar",
]


@pytest.fixture
def atendente():
    ana = _criar_atendente("Ana", "ana@teste.com.br", "ana12345", Papel.ATENDENTE)
    with SessaoLocal() as sessao:
        cargo = Cargo(nome="Atendente (testes)", nivel=30, permissoes=PERMISSOES_ATENDENTE_LEGADO, sistema=False)
        sessao.add(cargo)
        sessao.flush()
        sessao.get(Atendente, ana.id).cargo_id = cargo.id
        sessao.commit()
        return sessao.get(Atendente, ana.id)


def _autenticar(cliente: TestClient, email: str, senha: str) -> dict:
    resposta = cliente.post("/api/auth/login", json={"email": email, "senha": senha})
    assert resposta.status_code == 200, resposta.text
    return {"Authorization": f"Bearer {resposta.json()['token']}"}


@pytest.fixture
def cabecalho_admin(cliente, admin):
    return _autenticar(cliente, "admin@teste.com.br", "admin123")


@pytest.fixture
def cabecalho_atendente(cliente, atendente):
    return _autenticar(cliente, "ana@teste.com.br", "ana12345")


# o webhook de e-mail exige o segredo do canal (X-IHchat-Token ou ?token=)
SEGREDO_EMAIL = "segredo-do-webhook-de-email"
TOKEN_EMAIL = {"X-IHchat-Token": SEGREDO_EMAIL}


def criar_canal(tipo: TipoCanal, nome: str | None = None, **campos) -> Canal:
    with SessaoLocal() as sessao:
        canal = Canal(
            nome=nome or f"Canal {tipo.value}",
            tipo=tipo.value,
            credenciais=campos.pop("credenciais", {}),
            chave_publica=gerar_chave("wc_") if tipo is TipoCanal.WEBCHAT else None,
            segredo_webhook=campos.pop("segredo_webhook", SEGREDO_EMAIL if tipo is TipoCanal.EMAIL else None),
            **campos,
        )
        sessao.add(canal)
        sessao.commit()
        sessao.refresh(canal)
        return canal


@pytest.fixture
def canal_whatsapp():
    return criar_canal(TipoCanal.WHATSAPP, "WhatsApp Suporte")


@pytest.fixture
def canal_telegram():
    return criar_canal(TipoCanal.TELEGRAM, "Telegram Suporte")


@pytest.fixture
def canal_webchat():
    return criar_canal(TipoCanal.WEBCHAT, "Chat do site")


def payload_whatsapp_midia(numero: str, externo_id: str, midia: dict, tipo: str = "image") -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "contacts": [{"wa_id": numero, "profile": {"name": "Cliente"}}],
                            "messages": [
                                {"from": numero, "id": externo_id, "type": tipo, tipo: midia}
                            ],
                        }
                    }
                ]
            }
        ]
    }


def payload_whatsapp(numero: str, texto: str, externo_id: str, nome: str = "Cliente") -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "contacts": [{"wa_id": numero, "profile": {"name": nome}}],
                            "messages": [
                                {
                                    "from": numero,
                                    "id": externo_id,
                                    "type": "text",
                                    "text": {"body": texto},
                                }
                            ],
                        }
                    }
                ]
            }
        ]
    }
