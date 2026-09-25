"""Cargos e setores: a migração dos dados antigos (papel e texto de setor) e
o catálogo. As regras das rotas (hierarquia, visibilidade, eventos) estão na
suíte de contrato, que roda igual nos dois servidores (contrato/test_cargos_*.py).
"""
from __future__ import annotations

import hashlib

from sqlalchemy import create_engine, text

from app import permissoes as perm
from app.db import Base, migrar_cargos_e_setores
from app.models import Atendente, Cargo


def _chave_antiga(setor: str) -> str:
    return "setor:" + hashlib.sha256(" ".join(setor.split()).lower().encode()).hexdigest()[:40]


def test_migracao_papel_vira_cargo_e_texto_vira_setor_com_a_sala(tmp_path):
    motor = create_engine(f"sqlite:///{tmp_path / 'antiga.db'}")
    Base.metadata.create_all(bind=motor)
    with motor.begin() as c:
        # linhas como o código antigo gravava: só papel e o texto do setor
        for nome, papel, setor in (
            ("Chefe", "admin", None),
            ("Ana", "atendente", "  Suporte   Técnico "),
            ("Bia", "atendente", "suporte técnico"),
            ("Caio", "atendente", "Financeiro"),
            ("Davi", "atendente", None),
        ):
            c.execute(
                text(
                    "INSERT INTO atendentes (nome, email, senha_hash, papel, ativo, disponivel, setor, criado_em) "
                    "VALUES (:n, :e, 'x', :p, 1, 1, :s, '2026-09-25 00:00:00')"
                ),
                {"n": nome, "e": f"{nome.lower()}@e.com", "p": papel, "s": setor},
            )
        c.execute(
            text(
                "INSERT INTO interno_salas (tipo, nome, setor, chave, criada_em, atualizada_em) "
                "VALUES ('setor', 'Suporte Técnico', 'Suporte Técnico', :c, '2026-09-25 00:00:00', '2026-09-25 00:00:00')"
            ),
            {"c": _chave_antiga("Suporte Técnico")},
        )
    assert migrar_cargos_e_setores(motor)
    assert migrar_cargos_e_setores(motor) == []  # idempotente

    with motor.connect() as c:
        cargos = dict(c.execute(text("SELECT chave, id FROM cargos")).all())
        pessoas = {n: (cid, sid, s) for n, cid, sid, s in c.execute(text("SELECT nome, cargo_id, setor_id, setor FROM atendentes"))}
        setores = dict(c.execute(text("SELECT nome, id FROM setores ORDER BY id")).all())
        sala = c.execute(text("SELECT chave, setor_id FROM interno_salas")).one()
    assert list(setores) == ["Suporte Técnico", "Financeiro"]
    assert pessoas["Chefe"] == (cargos["administrador"], None, None)
    assert pessoas["Ana"] == pessoas["Bia"] == (cargos["colaborador"], setores["Suporte Técnico"], "Suporte Técnico")
    assert pessoas["Caio"][1] == setores["Financeiro"]
    assert pessoas["Davi"] == (cargos["colaborador"], None, None)
    assert sala == (f"setor:id:{setores['Suporte Técnico']}", setores["Suporte Técnico"])


def test_sem_cargo_id_vale_o_papel(sessao):
    admin = Atendente(nome="A", email="a@e.com", senha_hash="x", papel="admin", ativo=True)
    comum = Atendente(nome="B", email="b@e.com", senha_hash="x", papel="atendente", ativo=True)
    sessao.add_all([admin, comum])
    sessao.flush()
    assert admin.e_admin and admin.permissoes == perm.TODAS and admin.papel_efetivo == "admin"
    assert comum.cargo.chave == perm.COLABORADOR and not comum.e_admin
    comum.ativo = False
    assert comum.permissoes == []


def test_cargos_de_fabrica_decrescentes(sessao):
    ordem = [perm.ADMINISTRADOR, perm.GERENTE, perm.LIDER, perm.CONFERENTE, perm.COLABORADOR]
    cargos = {c.chave: c for c in sessao.query(Cargo).all()}
    for maior, menor in zip(ordem, ordem[1:]):
        assert cargos[maior].nivel > cargos[menor].nivel
        assert set(cargos[menor].permissoes_efetivas) < set(cargos[maior].permissoes_efetivas)
    assert cargos[perm.ADMINISTRADOR].permissoes_efetivas == perm.TODAS


def test_catalogo_igual_ao_do_php():
    """O PHP tem a mesma lista, na mesma ordem (GET /api/permissoes sai igual)."""
    from pathlib import Path

    php = (Path(__file__).resolve().parents[1] / "php/app/Auth/Permissoes.php").read_text()
    for chave, (rotulo, grupo) in perm.CATALOGO.items():
        assert f"'{chave}' => ['{rotulo}', '{grupo}']" in php, chave
