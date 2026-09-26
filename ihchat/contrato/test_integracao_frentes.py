"""O que liga as frentes (marca, WhatsApp pelo QR Code, chat interno), nos dois servidores.

- O cliente que escreve pelo WhatsApp do QR Code é reconhecido pelo telefone,
  como no WhatsApp oficial; um "@lid" (id oculto, sem telefone) não vira telefone.
- A assinatura "*Ana · Suporte*" é do núcleo, igual no oficial e no QR.
- O CanalSaida diz se o WhatsApp do QR Code está conectado ("conexao"), e a
  mudança chega a toda a equipe pelo evento "canal.atualizado".
- Mudar o setor ou desativar um atendente acerta as salas do chat NA HORA.
- Os ícones da marca são servidos com o tipo certo.
"""
from __future__ import annotations

import json
import random

from test_chat_interno import SENHA, Pessoa
from test_contatos import numero_novo, whatsapp_entra
from test_whatsapp_qr import canal_zapi, credenciais, linha_da_assinatura, numero, webhook, zapi_texto
from utilitarios import entrar, unico


def _qr(cliente, cabecalho_admin) -> tuple[dict, str]:
    canal = canal_zapi(cliente, cabecalho_admin)
    return canal, credenciais(cliente, cabecalho_admin, canal)["segredo_webhook"]


def _contato_da_conversa(cliente, cabecalho, canal: dict) -> dict:
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho).json()
    return cliente.get(f"/api/contatos/{conversa['contato']['id']}", headers=cabecalho).json()


# ------------------------------------------------ contato pelo telefone
def test_qr_reconhece_o_cliente_da_api_oficial_pelo_telefone(cliente, cabecalho_admin, cabecalho_atendente, canal_whatsapp):
    telefone = numero_novo()
    whatsapp_entra(cliente, canal_whatsapp, telefone, "oi pela API oficial")
    oficial = _contato_da_conversa(cliente, cabecalho_atendente, canal_whatsapp)

    canal, segredo = _qr(cliente, cabecalho_admin)
    assert webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zm"), "oi pelo QR")).json()["recebidas"] == 1
    pelo_qr = _contato_da_conversa(cliente, cabecalho_atendente, canal)
    # um cliente, um histórico: o mesmo contato, agora com as duas identidades
    assert pelo_qr["id"] == oficial["id"]
    tipos = {i["canal_tipo"] for i in pelo_qr["identidades"]}
    assert {"whatsapp", "whatsapp_qr"} <= tipos


def test_contato_novo_pelo_qr_ganha_o_telefone(cliente, cabecalho_admin, cabecalho_atendente):
    canal, segredo = _qr(cliente, cabecalho_admin)
    telefone = numero()
    webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zm"), "primeira vez"))
    contato = _contato_da_conversa(cliente, cabecalho_atendente, canal)
    assert contato["telefone"] == telefone


def test_contato_so_com_lid_nao_ganha_telefone(cliente, cabecalho_admin, cabecalho_atendente):
    canal, segredo = _qr(cliente, cabecalho_admin)
    lid = f"{random.randint(10**13, 10**14 - 1)}@lid"
    webhook(cliente, canal, segredo, zapi_texto(lid, unico("zm"), "só o lid", chatLid=lid))
    contato = _contato_da_conversa(cliente, cabecalho_atendente, canal)
    # o @lid não é telefone: fica inteiro na identidade (é para ele que a resposta volta)
    assert contato["telefone"] is None
    assert [i["identificador"] for i in contato["identidades"] if i["canal_tipo"] == "whatsapp_qr"] == [lid]


# ---------------------------------------------------------- assinatura
def test_assinatura_do_qr_e_a_mesma_do_oficial_uma_vez_so(cliente, cabecalho_admin, cabecalho_atendente, provedor):
    canal, segredo = _qr(cliente, cabecalho_admin)
    telefone = numero()
    webhook(cliente, canal, segredo, zapi_texto(telefone, unico("zm"), "oi"))
    [conversa] = cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho_atendente).json()
    provedor.roteirar("/send-text", metodo="POST", json={"messageId": unico("3EB0")})
    linha = linha_da_assinatura(cliente, cabecalho_atendente)
    # o atendente começa a resposta com a própria linha: sai duas vezes, como
    # no oficial (o núcleo assina sempre; o adaptador não adivinha mais)
    texto = f"{linha}\nrepetida de propósito"
    resposta = cliente.post(f"/api/conversas/{conversa['id']}/mensagens", headers=cabecalho_atendente, json={"conteudo": texto})
    assert resposta.status_code == 201, resposta.text
    corpo = json.loads(provedor.chamadas()[-1]["corpo"])
    assert corpo["message"] == f"{linha}\n{texto}"
    # o painel mostra o que a atendente escreveu, com a assinatura à parte
    assert resposta.json()["conteudo"] == texto and resposta.json()["assinatura"]["nome"]


# ------------------------------------------------------ conexão do QR
def test_canal_saida_mostra_a_conexao_e_o_evento_avisa_a_equipe(cliente, cabecalho_admin, cabecalho_atendente):
    canal, segredo = _qr(cliente, cabecalho_admin)

    def conexao() -> str | None:
        canais = cliente.get("/api/canais", headers=cabecalho_atendente).json()
        return next(c for c in canais if c["id"] == canal["id"])["conexao"]

    assert conexao() is None  # ninguém conferiu ainda
    cursor = cliente.get("/api/eventos/desde", headers=cabecalho_atendente).json()["ultimo"]

    webhook(cliente, canal, segredo, {"type": "ConnectedCallback", "connected": True, "phone": "5544999999999"})
    assert conexao() == "conectado"
    webhook(cliente, canal, segredo, {"type": "DisconnectedCallback", "disconnected": True, "error": "Device has been disconnected"})
    assert conexao() == "desconectado"
    # repetir o mesmo estado não gera evento novo
    webhook(cliente, canal, segredo, {"type": "DisconnectedCallback", "disconnected": True})

    eventos = cliente.get("/api/eventos/desde", params={"depois": cursor}, headers=cabecalho_atendente).json()["eventos"]
    do_canal = [e["dados"] for e in eventos if e["tipo"] == "canal.atualizado" and e["dados"]["id"] == canal["id"]]
    assert [d["conexao"] for d in do_canal] == ["conectado", "desconectado"]
    # o evento é o CanalSaida: nada de credenciais
    assert set(do_canal[-1]) == {"id", "nome", "tipo", "ativo", "chave_publica", "configurado", "url_webhook", "conexao", "setor_padrao_id"}
    assert "tok-instancia-secreto" not in json.dumps(do_canal)


# -------------------------------------- chat interno acompanha o cadastro
def test_mudar_o_setor_acerta_as_salas_na_hora(cliente, cabecalho_admin):
    setor, outro = unico("Setor "), unico("Outro ")
    email = f"{unico('integ')}@exemplo.com.br"
    criado = cliente.post(
        "/api/atendentes", headers=cabecalho_admin,
        json={"nome": unico("Pessoa "), "email": email, "senha": SENHA, "setor": setor},
    )
    assert criado.status_code == 201, criado.text
    pessoa = Pessoa(cliente, criado.json(), entrar(cliente, email, SENHA)["token"])
    cursor = pessoa.cursor()

    # o admin muda o setor dela; NINGUÉM chama /api/interno depois
    assert cliente.patch(f"/api/atendentes/{pessoa.id}", json={"setor": outro}, headers=cabecalho_admin).status_code == 200
    salas = [e["dados"] for e in pessoa.eventos(cursor) if e["tipo"] == "interno.sala"]
    acoes = {d["acao"] for d in salas}
    assert "saiu" in acoes and "entrou" in acoes, salas
    assert all(d.get("para") == [pessoa.id] for d in salas if d["acao"] in ("entrou", "saiu"))


# ------------------------------------------------------------- marca
def test_icones_da_marca(cliente):
    svg = cliente.get("/static/marca/favicon.svg")
    assert svg.status_code == 200
    assert svg.headers["content-type"].split(";")[0] == "image/svg+xml"
    assert b"<svg" in svg.content
    png = cliente.get("/static/marca/apple-touch-icon.png")
    assert png.status_code == 200
    assert png.headers["content-type"].split(";")[0] == "image/png"
    assert png.content.startswith(b"\x89PNG\r\n\x1a\n")


# ------------------------------------------- paridade do ?so_estado
def test_so_estado_invalido_e_recusado_nos_dois(cliente, cabecalho_admin, provedor):
    canal, _ = _qr(cliente, cabecalho_admin)
    provedor.roteirar("/status", metodo="GET", json={"connected": False})
    assert cliente.get(f"/api/canais/{canal['id']}/qr", params={"so_estado": "abc"}, headers=cabecalho_admin).status_code == 422
    for valor in ("1", "true", "0", "false"):
        resposta = cliente.get(f"/api/canais/{canal['id']}/qr", params={"so_estado": valor}, headers=cabecalho_admin)
        assert resposta.status_code == 200, (valor, resposta.text)
