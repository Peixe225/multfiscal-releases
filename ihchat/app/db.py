"""Engine, sessao e base declarativa do SQLAlchemy."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import obter_config


class Base(DeclarativeBase):
    pass


def _criar_engine(url: str):
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        # necessario porque o FastAPI atende requisicoes em threads distintas
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _criar_engine(obter_config().banco_url)
SessaoLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


@event.listens_for(engine, "connect")
def _ativar_chaves_estrangeiras(dbapi_connection, _record):  # pragma: no cover - trivial
    if engine.dialect.name == "sqlite":
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def criar_tabelas() -> None:
    from . import models  # noqa: F401  - registra os modelos no metadata

    Base.metadata.create_all(bind=engine)


def obter_sessao() -> Iterator[Session]:
    """Dependencia do FastAPI: uma sessao por requisicao."""
    sessao = SessaoLocal()
    try:
        yield sessao
        sessao.commit()
    except Exception:
        sessao.rollback()
        raise
    finally:
        sessao.close()
