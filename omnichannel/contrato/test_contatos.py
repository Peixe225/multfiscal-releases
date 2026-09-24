"""A promessa do omnichannel: um cliente, um histórico.

Porte HTTP de tests/test_contatos.py (app/api/contatos.py e
app/servicos/contatos.py). Os contatos nascem por webhook de WhatsApp e pelo
widget de webchat; canais novos a cada teste, números únicos na sessão.
"""
from __future__ import annotations

import json
import random

from utilitarios import criar_canal, exigir_rota, unico


def numero_novo() -> str:
    return "55009" + "".join(random.choices("0123456789", k=8))


def whatsapp_entra(cliente, canal: dict, numero: str, texto: str = "oi", nome: str | None = "Cliente") -> None:
    valor: dict = {"messages": [{"from": numero, "id": unico("wamid."), "type": "text", "text": {"body": texto}}]}
    if nome is not None:
        valor["contacts"] = [{"wa_id": numero, "profile": {"name": nome}}]
    resposta = exigir_rota(
        cliente.post(f"/webhooks/{canal['id']}", json={"entry": [{"changes": [{"value": valor}]}]}),
        "POST /webhooks/{canal_id}",
    )
    assert resposta.status_code == 200, resposta.text


def conversas(cliente, cabecalho, canal: dict) -> list[dict]:
    resposta = cliente.get("/api/conversas", params={"canal_id": canal["id"]}, headers=cabecalho)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def contato_do_canal(cliente, cabecalho, canal: dict) -> dict:
    [conversa] = conversas(cliente, cabecalho, canal)
    return conversa["contato"]


def visitante(cliente, canal_webchat: dict, nome: str, email: str | None = None) -> dict:
    corpo = {"chave_publica": canal_webchat["chave_publica"], "nome": nome}
    if email:
        corpo["email"] = email
    sessao = exigir_rota(cliente.post("/api/widget/sessao", json=corpo), "POST /api/widget/sessao")
    assert sessao.status_code == 201, sessao.text
    enviada = cliente.post("/api/widget/mensagens", json={"conteudo": "olá"}, headers={"X-Sessao": sessao.json()["token"]})
    assert enviada.status_code == 201, enviada.text
    return sessao.json()


def test_mesmo_numero_em_dois_canais_e_um_so_contato(cliente, cabecalho_admin, cabecalho_atendente, canal_whatsapp):
    outro = criar_canal(cliente, cabecalho_admin, "whatsapp")
    numero = numero_novo()
    whatsapp_entra(cliente, canal_whatsapp, numero, "oi")
    whatsapp_entra(cliente, outro, "+" + numero[:2] + " (" + numero[2:4] + ") " + numero[4:], "oi de novo")

    [primeira] = conversas(cliente, cabecalho_atendente, canal_whatsapp)
    [segunda] = conversas(cliente, cabecalho_atendente, outro)
    # canais diferentes => atendimentos diferentes, mesmo contato
    assert primeira["id"] != segunda["id"]
    assert primeira["contato"]["id"] == segunda["contato"]["id"]
    assert primeira["contato"]["telefone"] == numero


def test_identidade_e_reaproveitada_e_nome_e_completado(cliente, cabecalho_atendente, canal_whatsapp):
    numero = numero_novo()
    whatsapp_entra(cliente, canal_whatsapp, numero, "primeira", nome=None)
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    assert contato["nome"] == numero  # só tínhamos o número

    whatsapp_entra(cliente, canal_whatsapp, numero, "segunda", nome="Joana")
    depois = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    assert depois["id"] == contato["id"]
    assert depois["nome"] == "Joana"
    assert depois["identidades"] == [{"canal_tipo": "whatsapp", "identificador": numero, "nome_exibicao": None}]


def test_whatsapp_reconhece_contato_pelo_telefone(cliente, cabecalho_atendente, canal_webchat, canal_whatsapp):
    """Quem falou pelo site e deixou o telefone é reconhecido ao chamar no WhatsApp."""
    nome = unico("Cliente do site ")
    visitante(cliente, canal_webchat, nome)
    do_site = contato_do_canal(cliente, cabecalho_atendente, canal_webchat)
    numero = numero_novo()
    formatado = f"+{numero[:2]} ({numero[2:4]}) {numero[4:9]}-{numero[9:]}"
    editado = cliente.patch(f"/api/contatos/{do_site['id']}", json={"telefone": formatado}, headers=cabecalho_atendente)
    assert editado.status_code == 200
    assert editado.json()["telefone"] == numero  # guardado só com dígitos

    whatsapp_entra(cliente, canal_whatsapp, numero, "agora pelo zap", nome="Outro Nome")
    do_zap = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    assert do_zap["id"] == do_site["id"]
    assert sorted(i["canal_tipo"] for i in do_zap["identidades"]) == ["webchat", "whatsapp"]


def test_obter_contato(cliente, cabecalho_atendente, canal_whatsapp):
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome="Ficha")
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    resposta = cliente.get(f"/api/contatos/{contato['id']}", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    assert resposta.json() == contato

    inexistente = cliente.get("/api/contatos/999999", headers=cabecalho_atendente)
    assert inexistente.status_code == 404
    assert inexistente.json() == {"detail": "contato nao encontrado"}
    assert cliente.get(f"/api/contatos/{contato['id']}").status_code == 401


def test_busca_de_contatos(cliente, cabecalho_atendente, canal_whatsapp):
    marca = unico("Padaria ")
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome=f"{marca} do Zé")
    resposta = cliente.get("/api/contatos", headers=cabecalho_atendente, params={"q": marca.lower()})
    assert resposta.status_code == 200
    assert [c["nome"] for c in resposta.json()] == [f"{marca} do Zé"]

    limitada = cliente.get("/api/contatos", headers=cabecalho_atendente, params={"limite": 1})
    assert len(limitada.json()) <= 1
    assert cliente.get("/api/contatos", headers=cabecalho_atendente, params={"limite": 201}).status_code == 422


def test_editar_ficha(cliente, cabecalho_atendente, canal_whatsapp):
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome="Alguém")
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    email = f"{unico('Contato')}@Empresa.com.br"
    resposta = cliente.patch(
        f"/api/contatos/{contato['id']}",
        json={"email": email, "empresa": "ACME", "documento": "12345678000199", "observacoes": "cliente desde 2020"},
        headers=cabecalho_atendente,
    )
    assert resposta.status_code == 200
    ficha = resposta.json()
    assert ficha["email"] == email.lower()
    assert (ficha["empresa"], ficha["documento"], ficha["observacoes"]) == ("ACME", "12345678000199", "cliente desde 2020")
    # campo não enviado não muda; null limpa
    limpa = cliente.patch(f"/api/contatos/{contato['id']}", json={"empresa": None}, headers=cabecalho_atendente).json()
    assert limpa["empresa"] is None and limpa["documento"] == "12345678000199"

    invalido = cliente.patch(f"/api/contatos/{contato['id']}", json={"email": "nao-e-email"}, headers=cabecalho_atendente)
    assert invalido.status_code == 422
    sumido = cliente.patch("/api/contatos/999999", json={"empresa": "x"}, headers=cabecalho_atendente)
    assert sumido.status_code == 404
    assert sumido.json() == {"detail": "contato nao encontrado"}


def test_rota_de_mesclagem(cliente, cabecalho_atendente, canal_whatsapp, canal_webchat):
    numero = numero_novo()
    whatsapp_entra(cliente, canal_whatsapp, numero, nome="Duplicado A")
    principal = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    email = f"{unico('dup')}@empresa.com.br"
    visitante(cliente, canal_webchat, "Duplicado B", email=email)
    secundario = contato_do_canal(cliente, cabecalho_atendente, canal_webchat)
    assert secundario["id"] != principal["id"]
    # o e-mail digitado no widget não tem prova de posse e não vai para a
    # ficha (fica nas observações); quem o grava é a atendente, que confirmou
    assert secundario["email"] is None
    patch = cliente.patch(f"/api/contatos/{secundario['id']}", json={"email": email}, headers=cabecalho_atendente)
    assert patch.status_code == 200, patch.text

    resposta = cliente.post(f"/api/contatos/{principal['id']}/mesclar/{secundario['id']}", headers=cabecalho_atendente)
    assert resposta.status_code == 200
    mesclado = resposta.json()
    assert mesclado["id"] == principal["id"]
    assert mesclado["nome"] == "Duplicado A"
    assert sorted(i["canal_tipo"] for i in mesclado["identidades"]) == ["webchat", "whatsapp"]
    # o que só o secundário tinha completa a ficha
    assert mesclado["telefone"] == numero and mesclado["email"] == email

    # a conversa do secundário agora é do principal; o secundário sumiu
    assert contato_do_canal(cliente, cabecalho_atendente, canal_webchat)["id"] == principal["id"]
    assert cliente.get(f"/api/contatos/{secundario['id']}", headers=cabecalho_atendente).status_code == 404


def test_mesclar_com_contato_inexistente_ou_consigo(cliente, cabecalho_atendente, canal_whatsapp):
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome="Sozinho")
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    inexistente = cliente.post(f"/api/contatos/{contato['id']}/mesclar/999999", headers=cabecalho_atendente)
    assert inexistente.status_code == 404
    assert inexistente.json() == {"detail": "contato nao encontrado"}
    consigo = cliente.post(f"/api/contatos/{contato['id']}/mesclar/{contato['id']}", headers=cabecalho_atendente)
    assert consigo.status_code == 200 and consigo.json() == contato


def test_mesclar_encerra_a_sessao_do_widget_do_secundario(cliente, cabecalho_atendente, canal_whatsapp, canal_webchat):
    """Mesclar é decisão da atendente, não prova de identidade: o navegador
    anônimo que era o secundário NÃO herda o histórico de WhatsApp do
    principal. A sessão dele acaba (401) e ele abre outra."""
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), "Meu CPF é 123.456.789-00", nome="Ian")
    principal = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    sessao = visitante(cliente, canal_webchat, "Ian (site)")
    secundario = contato_do_canal(cliente, cabecalho_atendente, canal_webchat)

    mescla = cliente.post(f"/api/contatos/{principal['id']}/mesclar/{secundario['id']}", headers=cabecalho_atendente)
    assert mescla.status_code == 200

    historico = cliente.get("/api/widget/mensagens", headers={"X-Sessao": sessao["token"]})
    assert historico.status_code == 401
    assert "CPF" not in historico.text
    eventos = cliente.get("/api/widget/eventos/desde", params={"token": sessao["token"], "depois": 0})
    assert eventos.status_code in (401, 404)  # 404: o alvo ainda não tem a rota de consulta


def test_resposta_vai_para_o_numero_que_escreveu_na_conversa(
    cliente, cabecalho_admin, cabecalho_atendente, servidor, provedor, request
):
    """Dois números no mesmo canal (pessoal e empresa), mesclados num contato:
    a resposta de cada conversa vai para o número que escreveu NELA, nunca
    para "o primeiro número do contato" (poderia ser outra pessoa)."""
    canal = criar_canal(cliente, cabecalho_admin, "whatsapp", credenciais={"token": "tk", "id_numero": "5599"})
    provedor.roteirar("graph.facebook.com", metodo="POST", json={"messages": [{"id": unico("wamid.r")}]})
    pessoal, empresa = numero_novo(), numero_novo()
    whatsapp_entra(cliente, canal, pessoal, "oi do pessoal", nome="João")
    whatsapp_entra(cliente, canal, empresa, "oi da empresa", nome="João Empresa")
    por_previa = {c["previa"]: c for c in conversas(cliente, cabecalho_atendente, canal)}
    da_empresa, do_pessoal = por_previa["oi da empresa"], por_previa["oi do pessoal"]

    mescla = cliente.post(
        f"/api/contatos/{do_pessoal['contato']['id']}/mesclar/{da_empresa['contato']['id']}", headers=cabecalho_atendente
    )
    assert mescla.status_code == 200

    def destino_da_resposta(conversa_id: int) -> str:
        provedor.limpar()
        provedor.roteirar("graph.facebook.com", metodo="POST", json={"messages": [{"id": unico("wamid.r")}]})
        resposta = cliente.post(f"/api/conversas/{conversa_id}/mensagens", json={"conteudo": "ok"}, headers=cabecalho_atendente)
        assert resposta.status_code == 201 and resposta.json()["status"] == "enviada", resposta.text
        [envio] = [c for c in provedor.chamadas() if "/messages" in c["url"]]
        return json.loads(envio["corpo"])["to"]

    assert destino_da_resposta(da_empresa["id"]) == empresa
    assert destino_da_resposta(do_pessoal["id"]) == pessoal


def test_telefone_longo_demais_e_recusado(cliente, cabecalho_atendente, canal_whatsapp, servidor, request):
    """O telefone é gravado só com dígitos numa coluna de 32: com mais que
    isso, 422 (e não 500 do MySQL estrito)."""
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome="Longo")
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    url = f"/api/contatos/{contato['id']}"
    longo = cliente.patch(url, json={"telefone": "+55 11 " + "1" * 31}, headers=cabecalho_atendente)  # 33 dígitos
    assert longo.status_code == 422, longo.text
    assert longo.json()["detail"][0]["loc"] == ["body", "telefone"]
    no_limite = cliente.patch(url, json={"telefone": "+55 (11) " + "1" * 28}, headers=cabecalho_atendente)  # 32 dígitos
    assert no_limite.status_code == 200 and no_limite.json()["telefone"] == "5511" + "1" * 28


def test_busca_de_contato_com_maiuscula_acentuada(cliente, cabecalho_atendente, canal_whatsapp):
    marca = unico("Z")
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome=f"ÁUREA LTDA {marca}")
    for termo in (f"ÁUREA LTDA {marca}", f"ÁUREA LTDA {marca.lower()}", marca):
        resposta = cliente.get("/api/contatos", headers=cabecalho_atendente, params={"q": termo})
        assert [c["nome"] for c in resposta.json()] == [f"ÁUREA LTDA {marca}"], termo


def test_patch_do_contato_respeita_os_limites_das_colunas(cliente, cabecalho_atendente, canal_whatsapp):
    """Nome é obrigatório (null não "limpa") e nada passa do tamanho da coluna:
    422 com o campo, em vez do 500 do banco."""
    whatsapp_entra(cliente, canal_whatsapp, numero_novo(), nome="Limites")
    contato = contato_do_canal(cliente, cabecalho_atendente, canal_whatsapp)
    url = f"/api/contatos/{contato['id']}"
    for corpo, campo in (
        ({"nome": None}, "nome"),
        ({"nome": ""}, "nome"),
        ({"nome": "x" * 161}, "nome"),
        ({"empresa": "x" * 161}, "empresa"),
        ({"documento": "1" * 33}, "documento"),
    ):
        resposta = cliente.patch(url, json=corpo, headers=cabecalho_atendente)
        assert resposta.status_code == 422, (corpo, resposta.text)
        assert resposta.json()["detail"][0]["loc"] == ["body", campo]
    assert cliente.get(url, headers=cabecalho_atendente).json()["nome"] == "Limites"
    # dentro do limite, e null limpando o que é opcional
    resposta = cliente.patch(url, json={"empresa": "x" * 160, "documento": None}, headers=cabecalho_atendente)
    assert resposta.status_code == 200 and resposta.json()["empresa"] == "x" * 160
