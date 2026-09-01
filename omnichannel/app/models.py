"""Modelos de dominio do OmniChannel 2.

A ideia central e que *um contato* pode falar por varios canais. Por isso a
identidade externa (numero de WhatsApp, chat_id do Telegram, e-mail...) fica em
`ContatoIdentidade`, e nao no contato. Assim o historico do cliente permanece
unico mesmo quando ele troca de canal.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def agora() -> datetime:
    return datetime.now(timezone.utc)


class TipoCanal(str, enum.Enum):
    WHATSAPP = "whatsapp"
    TELEGRAM = "telegram"
    EMAIL = "email"
    WEBCHAT = "webchat"


class StatusConversa(str, enum.Enum):
    ABERTA = "aberta"
    PENDENTE = "pendente"
    RESOLVIDA = "resolvida"


class Prioridade(str, enum.Enum):
    BAIXA = "baixa"
    NORMAL = "normal"
    ALTA = "alta"


class Direcao(str, enum.Enum):
    ENTRADA = "entrada"
    SAIDA = "saida"


class TipoMensagem(str, enum.Enum):
    TEXTO = "texto"
    NOTA_INTERNA = "nota_interna"
    SISTEMA = "sistema"


class StatusMensagem(str, enum.Enum):
    RECEBIDA = "recebida"
    ENVIADA = "enviada"
    ENTREGUE = "entregue"
    LIDA = "lida"
    FALHOU = "falhou"
    SIMULADA = "simulada"


class Papel(str, enum.Enum):
    ADMIN = "admin"
    ATENDENTE = "atendente"


conversa_etiqueta = Table(
    "conversa_etiqueta",
    Base.metadata,
    Column("conversa_id", ForeignKey("conversas.id", ondelete="CASCADE"), primary_key=True),
    Column("etiqueta_id", ForeignKey("etiquetas.id", ondelete="CASCADE"), primary_key=True),
)


class Atendente(Base):
    __tablename__ = "atendentes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    senha_hash: Mapped[str] = mapped_column(String(255))
    papel: Mapped[str] = mapped_column(String(20), default=Papel.ATENDENTE.value)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    disponivel: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)

    @property
    def e_admin(self) -> bool:
        return self.papel == Papel.ADMIN.value


class Canal(Base):
    __tablename__ = "canais"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[str] = mapped_column(String(20), index=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    # credenciais especificas do provedor (token, numero, servidor imap...)
    credenciais: Mapped[dict] = mapped_column(JSON, default=dict)
    # identificador publico usado pelo widget de webchat
    chave_publica: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    # segredo compartilhado para validar a assinatura dos webhooks
    segredo_webhook: Mapped[str | None] = mapped_column(String(120), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)

    conversas: Mapped[list["Conversa"]] = relationship(back_populates="canal")


class Contato(Base):
    __tablename__ = "contatos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(160))
    empresa: Mapped[str | None] = mapped_column(String(160), nullable=True)
    documento: Mapped[str | None] = mapped_column(String(32), nullable=True)  # CNPJ/CPF
    email: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    telefone: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    observacoes: Mapped[str | None] = mapped_column(Text, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, onupdate=agora)

    # passive_deletes deixa o ON DELETE CASCADE do banco fazer o trabalho, em
    # vez de o ORM carregar e apagar filho por filho
    identidades: Mapped[list["ContatoIdentidade"]] = relationship(
        back_populates="contato", cascade="all, delete-orphan", lazy="selectin", passive_deletes=True
    )
    conversas: Mapped[list["Conversa"]] = relationship(back_populates="contato", passive_deletes=True)


class ContatoIdentidade(Base):
    """Como um contato e identificado dentro de um canal especifico."""

    __tablename__ = "contato_identidades"
    __table_args__ = (UniqueConstraint("canal_tipo", "identificador", name="uq_identidade_canal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"), index=True)
    canal_tipo: Mapped[str] = mapped_column(String(20))
    identificador: Mapped[str] = mapped_column(String(200))
    nome_exibicao: Mapped[str | None] = mapped_column(String(160), nullable=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)

    contato: Mapped[Contato] = relationship(back_populates="identidades")


class Etiqueta(Base):
    __tablename__ = "etiquetas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(60), unique=True)
    cor: Mapped[str] = mapped_column(String(9), default="#6b7cff")


class Conversa(Base):
    __tablename__ = "conversas"

    id: Mapped[int] = mapped_column(primary_key=True)
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"), index=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canais.id", ondelete="CASCADE"), index=True)
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default=StatusConversa.ABERTA.value, index=True)
    prioridade: Mapped[str] = mapped_column(String(10), default=Prioridade.NORMAL.value)
    assunto: Mapped[str | None] = mapped_column(String(200), nullable=True)
    previa: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nao_lidas: Mapped[int] = mapped_column(Integer, default=0)
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)
    atualizada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, onupdate=agora)
    ultima_mensagem_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, index=True)
    primeira_resposta_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolvida_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    contato: Mapped[Contato] = relationship(back_populates="conversas", lazy="joined")
    canal: Mapped[Canal] = relationship(back_populates="conversas", lazy="joined")
    atendente: Mapped[Atendente | None] = relationship(lazy="joined")
    mensagens: Mapped[list["Mensagem"]] = relationship(
        back_populates="conversa",
        cascade="all, delete-orphan",
        order_by="Mensagem.criada_em",
        passive_deletes=True,
    )
    etiquetas: Mapped[list[Etiqueta]] = relationship(secondary=conversa_etiqueta, lazy="selectin")


class Mensagem(Base):
    __tablename__ = "mensagens"
    # o id externo ja chega prefixado pelo canal (ex.: "whatsapp:wamid.XX"),
    # o que garante idempotencia em reentregas de webhook
    __table_args__ = (UniqueConstraint("externo_id", name="uq_mensagem_externo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int] = mapped_column(ForeignKey("conversas.id", ondelete="CASCADE"), index=True)
    direcao: Mapped[str] = mapped_column(String(10))
    tipo: Mapped[str] = mapped_column(String(20), default=TipoMensagem.TEXTO.value)
    conteudo: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default=StatusMensagem.RECEBIDA.value)
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    externo_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    erro: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadados: Mapped[dict] = mapped_column(JSON, default=dict)
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora, index=True)

    conversa: Mapped[Conversa] = relationship(back_populates="mensagens")
    atendente: Mapped[Atendente | None] = relationship(lazy="joined")


class RespostaRapida(Base):
    __tablename__ = "respostas_rapidas"

    id: Mapped[int] = mapped_column(primary_key=True)
    atalho: Mapped[str] = mapped_column(String(40), unique=True)
    titulo: Mapped[str] = mapped_column(String(120))
    conteudo: Mapped[str] = mapped_column(Text)
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)


class Evento(Base):
    """Trilha de auditoria: quem atribuiu, resolveu, reabriu, etc."""

    __tablename__ = "eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversas.id", ondelete="CASCADE"), nullable=True, index=True
    )
    atendente_id: Mapped[int | None] = mapped_column(
        ForeignKey("atendentes.id", ondelete="SET NULL"), nullable=True
    )
    tipo: Mapped[str] = mapped_column(String(40))
    descricao: Mapped[str] = mapped_column(String(300))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)


class SessaoWidget(Base):
    """Sessao anonima do visitante no widget de webchat."""

    __tablename__ = "sessoes_widget"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    canal_id: Mapped[int] = mapped_column(ForeignKey("canais.id", ondelete="CASCADE"))
    contato_id: Mapped[int] = mapped_column(ForeignKey("contatos.id", ondelete="CASCADE"))
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=agora)
