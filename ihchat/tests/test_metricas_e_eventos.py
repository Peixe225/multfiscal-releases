import asyncio

from conftest import payload_whatsapp

from app.eventos import barramento
from app.security import criar_token


def test_resumo_das_metricas(cliente, cabecalho_atendente, canal_whatsapp, atendente):
    for indice in range(3):
        cliente.post(
            f"/webhooks/{canal_whatsapp.id}",
            json=payload_whatsapp(f"55119000000{indice}", "oi", f"wamid.m{indice}"),
        )
    conversas = cliente.get("/api/conversas", headers=cabecalho_atendente).json()
    cliente.post(
        f"/api/conversas/{conversas[0]['id']}/mensagens",
        headers=cabecalho_atendente,
        json={"conteudo": "Bom dia!"},
    )
    cliente.post(
        f"/api/conversas/{conversas[1]['id']}/status",
        headers=cabecalho_atendente,
        json={"status": "resolvida"},
    )

    resumo = cliente.get("/api/metricas/resumo", headers=cabecalho_atendente).json()
    assert resumo["abertas"] == 2
    assert resumo["resolvidas_hoje"] == 1
    assert resumo["sem_atendente"] == 0
    assert resumo["mensagens_hoje"] == 4
    assert resumo["por_canal"] == {"WhatsApp Suporte": 2}
    assert resumo["tempo_medio_primeira_resposta_seg"] is not None


def test_stream_de_eventos_exige_token(cliente, atendente):
    assert cliente.get("/api/eventos/stream", params={"token": "invalido"}).status_code == 401


def test_barramento_entrega_evento_publicado_de_outra_thread():
    async def cenario():
        fluxo = barramento.fluxo()
        iterador = fluxo.__aiter__()
        assert await iterador.__anext__() == ": conectado\n\n"

        await asyncio.get_running_loop().run_in_executor(
            None, barramento.publicar, "mensagem.nova", {"id": 1, "conteudo": "olá"}
        )
        recebido = await asyncio.wait_for(iterador.__anext__(), timeout=3)
        await fluxo.aclose()
        return recebido

    evento = asyncio.run(cenario())
    assert evento.startswith("event: mensagem.nova")
    assert '"conteudo": "olá"' in evento
    assert barramento.total_assinantes == 0


def test_barramento_filtra_por_assinante():
    async def cenario():
        fluxo = barramento.fluxo(lambda e: e["dados"].get("contato_id") == 7)
        iterador = fluxo.__aiter__()
        await iterador.__anext__()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, barramento.publicar, "mensagem.nova", {"contato_id": 1})
        await loop.run_in_executor(None, barramento.publicar, "mensagem.nova", {"contato_id": 7})
        recebido = await asyncio.wait_for(iterador.__anext__(), timeout=3)
        await fluxo.aclose()
        return recebido

    assert '"contato_id": 7' in asyncio.run(cenario())


def test_token_expirado_e_recusado_no_stream(cliente, atendente, monkeypatch):
    from app.config import obter_config

    monkeypatch.setattr(obter_config(), "horas_token", -1)
    token = criar_token(atendente.id)
    assert cliente.get("/api/eventos/stream", params={"token": token}).status_code == 401
