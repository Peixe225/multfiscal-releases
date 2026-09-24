"""Números do topo do painel (app/api/metricas.py): GET /api/metricas/resumo.

A base é compartilhada pela sessão, então os testes medem a DIFERENÇA antes e
depois do que fazem, e o por_canal de um canal criado só para o teste.
"""
from __future__ import annotations

import random

from utilitarios import exigir_rota, unico

CAMPOS = {
    "abertas", "pendentes", "resolvidas_hoje", "sem_atendente", "mensagens_hoje", "por_canal",
    "tempo_medio_primeira_resposta_seg",
}


def resumo(cliente, cabecalho) -> dict:
    resposta = cliente.get("/api/metricas/resumo", headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def whatsapp_entra(cliente, canal: dict) -> None:
    numero = "55009" + "".join(random.choices("0123456789", k=8))
    valor = {
        "contacts": [{"wa_id": numero, "profile": {"name": "Cliente"}}],
        "messages": [{"from": numero, "id": unico("wamid."), "type": "text", "text": {"body": "oi"}}],
    }
    resposta = exigir_rota(
        cliente.post(f"/webhooks/{canal['id']}", json={"entry": [{"changes": [{"value": valor}]}]}),
        "POST /webhooks/{canal_id}",
    )
    assert resposta.status_code == 200, resposta.text


def test_formato_do_resumo(cliente, cabecalho_atendente):
    dados = resumo(cliente, cabecalho_atendente)
    assert set(dados) == CAMPOS
    for campo in CAMPOS - {"por_canal", "tempo_medio_primeira_resposta_seg"}:
        assert isinstance(dados[campo], int) and dados[campo] >= 0, campo
    assert isinstance(dados["por_canal"], dict)
    assert all(isinstance(v, int) for v in dados["por_canal"].values())
    media = dados["tempo_medio_primeira_resposta_seg"]
    assert media is None or isinstance(media, (int, float))


def test_resumo_exige_token(cliente):
    assert cliente.get("/api/metricas/resumo").status_code == 401


def test_resumo_acompanha_o_atendimento(cliente, cabecalho_atendente, canal_whatsapp):
    antes = resumo(cliente, cabecalho_atendente)
    assert canal_whatsapp["nome"] not in antes["por_canal"]
    for _ in range(3):
        whatsapp_entra(cliente, canal_whatsapp)
    ids = [c["id"] for c in cliente.get(
        "/api/conversas", params={"canal_id": canal_whatsapp["id"]}, headers=cabecalho_atendente
    ).json()]
    assert len(ids) == 3

    resposta = cliente.post(f"/api/conversas/{ids[0]}/mensagens", json={"conteudo": "Bom dia!"}, headers=cabecalho_atendente)
    assert resposta.status_code == 201
    cliente.post(f"/api/conversas/{ids[1]}/status", json={"status": "resolvida"}, headers=cabecalho_atendente)
    cliente.post(f"/api/conversas/{ids[2]}/status", json={"status": "pendente"}, headers=cabecalho_atendente)

    depois = resumo(cliente, cabecalho_atendente)
    assert depois["abertas"] - antes["abertas"] == 1
    assert depois["pendentes"] - antes["pendentes"] == 1
    assert depois["resolvidas_hoje"] - antes["resolvidas_hoje"] == 1
    assert depois["mensagens_hoje"] - antes["mensagens_hoje"] == 4  # 3 entradas + 1 resposta
    # conversas resolvidas saem da contagem por canal
    assert depois["por_canal"][canal_whatsapp["nome"]] == 2
    assert depois["tempo_medio_primeira_resposta_seg"] is not None
