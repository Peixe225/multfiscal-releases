"""Cria a base inicial do OmniChannel 2.

    python -m scripts.seed                 # so o essencial
    python -m scripts.seed --demo          # com conversas de exemplo

Sem argumentos, cria um administrador com a senha informada em OMNI_SENHA_ADMIN
(ou 'admin123', que deve ser trocada no primeiro acesso).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.api.canais import segredos_iniciais  # noqa: E402
from app.canais.base import MensagemRecebida  # noqa: E402
from app.db import SessaoLocal, criar_tabelas  # noqa: E402
from app.models import (  # noqa: E402
    Atendente,
    Canal,
    Etiqueta,
    Papel,
    RespostaRapida,
    TipoCanal,
)
from app.security import gerar_hash_senha  # noqa: E402
from app.servicos.mensagens import enviar_mensagem, registrar_entrada  # noqa: E402

CANAIS = [
    ("WhatsApp Suporte", TipoCanal.WHATSAPP),
    ("Telegram Suporte", TipoCanal.TELEGRAM),
    ("suporte@multfiscal", TipoCanal.EMAIL),
    ("Chat do site", TipoCanal.WEBCHAT),
]

ETIQUETAS = [
    ("dúvida fiscal", "#3b82f6"),
    ("instalação", "#8b5cf6"),
    ("financeiro", "#10b981"),
    ("bug", "#ef4444"),
    ("urgente", "#f59e0b"),
]

RESPOSTAS = [
    ("bomdia", "Saudação", "Bom dia! Aqui é o suporte MultFiscal. Como posso ajudar?"),
    (
        "versao",
        "Versão atual",
        "A versão mais recente é a 0.8.7.2. Você atualiza pelo próprio sistema, "
        "em Configurações → Atualizações.",
    ),
    (
        "senha",
        "Redefinição de senha",
        "A troca de senha fica em Configurações → Acesso → \"Alterar minha senha\". "
        "Se você esqueceu a senha, só o suporte redefine — me confirme o CNPJ da empresa.",
    ),
    ("aguarde", "Pedir um instante", "Só um instante, por favor, já verifico isso para você."),
]


def semear(demo: bool = False) -> None:
    criar_tabelas()
    with SessaoLocal() as sessao:
        if sessao.scalar(select(Atendente).limit(1)):
            print("Base já inicializada; nada a fazer.")
            return

        senha = os.environ.get("OMNI_SENHA_ADMIN", "admin123")
        admin = Atendente(
            nome="Administrador",
            email="admin@multfiscal.com.br",
            senha_hash=gerar_hash_senha(senha),
            papel=Papel.ADMIN.value,
        )
        ana = Atendente(
            nome="Ana Suporte",
            email="ana@multfiscal.com.br",
            senha_hash=gerar_hash_senha("ana12345"),
        )
        sessao.add_all([admin, ana])

        canais = {}
        for nome, tipo in CANAIS:
            # mesma regra do cadastro pela API: um segredo gerado aqui para o
            # WhatsApp faria recusar todo webhook real, assinado pela Meta
            canal = Canal(nome=nome, tipo=tipo.value, credenciais={}, **segredos_iniciais(tipo))
            sessao.add(canal)
            canais[tipo] = canal

        sessao.add_all([Etiqueta(nome=n, cor=c) for n, c in ETIQUETAS])
        sessao.add_all([RespostaRapida(atalho=a, titulo=t, conteudo=c) for a, t, c in RESPOSTAS])
        sessao.flush()

        if demo:
            _conversas_de_exemplo(sessao, canais, ana)

        sessao.commit()

        print("Base criada.")
        print(f"  admin: admin@multfiscal.com.br / {senha}")
        print("  atendente: ana@multfiscal.com.br / ana12345")
        print(f"  chave pública do webchat: {canais[TipoCanal.WEBCHAT].chave_publica}")


def _conversas_de_exemplo(sessao, canais, atendente) -> None:
    roteiro = [
        (
            TipoCanal.WHATSAPP,
            "5500912345678",
            "Ian Dantas",
            "Bom dia! O DIFAL do Rio está saindo com base dupla, isso está certo?",
            "Bom dia, Ian! Está correto: o RJ já vem cadastrado com antecipação por base dupla "
            "na aba CÁLCULO DE ICMS.",
        ),
        (
            TipoCanal.TELEGRAM,
            "884412",
            "Marcos Contabilidade",
            "Consigo cadastrar a regra de um estado que não está na lista?",
            "Consegue sim: CÁLCULO DE ICMS → guia de base única × dupla → clique na sigla da UF "
            "e em \"Ajustar esta UF\".",
        ),
        (
            TipoCanal.EMAIL,
            "financeiro@loja.example",
            "Financeiro Loja Exemplo",
            "Preciso da segunda via do boleto da licença deste mês.",
            None,
        ),
    ]
    for tipo, identificador, nome, pergunta, resposta in roteiro:
        mensagem = registrar_entrada(
            sessao,
            canais[tipo],
            MensagemRecebida(identificador=identificador, conteudo=pergunta, nome_exibicao=nome),
        )
        if resposta and mensagem is not None:
            enviar_mensagem(sessao, mensagem.conversa, resposta, atendente)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Popula a base do OmniChannel 2")
    parser.add_argument("--demo", action="store_true", help="cria conversas de exemplo")
    semear(parser.parse_args().demo)
