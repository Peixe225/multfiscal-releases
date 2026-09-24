"""Canal de e-mail: envia por SMTP e recebe por IMAP (ou por webhook de provedor).

O corpo de resposta e enviado com o assunto original prefixado por "Re:" e com
os cabecalhos In-Reply-To/References, para que o cliente de e-mail do contato
mantenha tudo na mesma thread.
"""
from __future__ import annotations

import contextlib
import email
import hmac
import imaplib
import smtplib
import ssl
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import HeaderParser
from email.utils import make_msgid, parseaddr
from typing import Mapping

from ..models import StatusMensagem, TipoCanal
from ..util import resumir
from .base import (
    AdaptadorCanal,
    AnexoRecebido,
    ArquivoParaEnviar,
    ErroCanal,
    MensagemRecebida,
    ResultadoEnvio,
)
from .campos import campos_de

LIMITE_COLETA = 25
# o admin espera olhando para a tela: melhor um erro claro em 10 s do que a
# roda girando pelos 20 s do envio
TEMPO_VERIFICACAO = 10


def _contexto_tls() -> ssl.SSLContext:
    """Contexto que confere certificado e nome do servidor.

    Sem ele, smtplib e imaplib aceitam qualquer certificado: quem estiver no
    caminho (Wi-Fi do escritorio, DNS trocado) recebe a senha no login e o
    teste ainda responderia "ok".
    """
    return ssl.create_default_context()


def _rotulo(chave: str) -> str:
    """Nome do campo como o formulario mostra; quem le o erro nunca viu a chave."""
    for campo in campos_de(TipoCanal.EMAIL.value):
        if campo.chave == chave:
            return campo.rotulo
    return {"imap_porta": "Porta IMAP"}.get(chave, chave)


def _erro_de_certificado(servico: str, host: str, exc: ssl.SSLCertVerificationError) -> ErroCanal:
    motivo = getattr(exc, "verify_message", None) or str(exc)
    return ErroCanal(
        f"o certificado TLS do servidor {servico} {host} não é válido ({motivo}); a senha não "
        "foi enviada. Confira o endereço do servidor: é preciso o nome que consta no certificado"
    )


def _erro_de_caractere(servico: str) -> ErroCanal:
    # smtplib e imaplib codificam o login em ASCII: "senhação" nem sai daqui
    return ErroCanal(
        f"o usuário ou a senha do {servico} tem acento ou outro caractere fora do ASCII, que o "
        f"login {servico} não transmite; use uma senha sem acentos (ou uma senha de app)"
    )


def _resposta_smtp(exc: smtplib.SMTPResponseException) -> str:
    texto = exc.smtp_error.decode(errors="replace") if isinstance(exc.smtp_error, bytes) else str(exc.smtp_error)
    return f"{exc.smtp_code} {texto}".strip()


def _decodificar(valor: str | None) -> str:
    if not valor:
        return ""
    try:
        return str(make_header(decode_header(valor)))
    except Exception:
        return valor


def _corpo_texto(mensagem: email.message.Message) -> str:
    if mensagem.is_multipart():
        for parte in mensagem.walk():
            if parte.get_content_type() == "text/plain" and "attachment" not in str(
                parte.get("Content-Disposition", "")
            ):
                carga = parte.get_payload(decode=True) or b""
                return carga.decode(parte.get_content_charset() or "utf-8", errors="replace")
        return "[mensagem sem corpo em texto]"
    carga = mensagem.get_payload(decode=True) or b""
    return carga.decode(mensagem.get_content_charset() or "utf-8", errors="replace")


def _anexos_de(mensagem: email.message.Message) -> list[AnexoRecebido]:
    """Junta as partes que o cliente de e-mail marcou como arquivo."""
    if not mensagem.is_multipart():
        return []
    anexos: list[AnexoRecebido] = []
    for parte in mensagem.walk():
        if parte.get_content_maintype() == "multipart":
            continue
        disposicao = str(parte.get("Content-Disposition", ""))
        nome = parte.get_filename()
        # sem nome e sem "attachment" e corpo, nao anexo
        if "attachment" not in disposicao and not nome:
            continue
        dados = parte.get_payload(decode=True)
        if not dados:
            continue
        anexos.append(
            AnexoRecebido(
                nome=_decodificar(nome) or "arquivo",
                dados=dados,
                tipo_conteudo=parte.get_content_type(),
            )
        )
    return anexos


def _message_id_dos_cabecalhos(cabecalhos: str | None) -> str | None:
    """Message-ID de um bloco de cabeçalhos crus (o campo "headers" do SendGrid)."""
    if not cabecalhos:
        return None
    valor = HeaderParser().parsestr(cabecalhos).get("Message-ID")
    return str(valor).strip() or None if valor else None


class AdaptadorEmail(AdaptadorCanal):
    tipo = TipoCanal.EMAIL
    campos_obrigatorios = ("smtp_host", "smtp_usuario", "smtp_senha", "remetente")

    # ------------------------------------------------------------------ estado
    def _porta(self, campo: str, padrao: int) -> int:
        # a API ja recusa porta invalida; isto cobre o que foi gravado antes dela
        valor = self.credenciais.get(campo) or padrao
        try:
            porta = int(valor)
        except (TypeError, ValueError):
            porta = 0
        if not 1 <= porta <= 65535:
            raise ErroCanal(f"{_rotulo(campo)} inválida: {valor!r}; use um número, ex.: {padrao}")
        return porta

    def verificar_conexao(self) -> str:
        """Entra no SMTP e, se houver, no IMAP, sem enviar nem ler nada.

        Cada erro diz a etapa (conexao, STARTTLS, login) porque cada uma tem um
        culpado diferente: host/porta errados, porta trocada, senha.
        """
        if not self.configurado:
            return super().verificar_conexao()  # a base diz o que falta preencher
        feito = [self._verificar_smtp()]
        if self.credenciais.get("imap_host"):
            feito.append(self._verificar_imap())
        else:
            feito.append("sem servidor IMAP, a caixa não é lida: e-mails só chegam pelo webhook do provedor")
        return "; ".join(feito)

    def _verificar_smtp(self) -> str:
        host = self.credenciais["smtp_host"]
        porta = self._porta("smtp_porta", 587)
        seguranca = "SSL" if porta == 465 else "STARTTLS"
        etapa = f"conectar ao servidor SMTP {host}:{porta}"
        servidor = None
        tls = _contexto_tls()
        try:
            if porta == 465:
                servidor = smtplib.SMTP_SSL(host, porta, timeout=TEMPO_VERIFICACAO, context=tls)
            else:
                servidor = smtplib.SMTP(host, porta, timeout=TEMPO_VERIFICACAO)
                etapa = f"iniciar STARTTLS em {host}:{porta}"
                servidor.starttls(context=tls)
            etapa = "entrar no SMTP"
            servidor.login(self.credenciais["smtp_usuario"], self.credenciais["smtp_senha"])
        except smtplib.SMTPAuthenticationError as exc:
            raise ErroCanal(f"o servidor SMTP recusou o usuário e a senha: {_resposta_smtp(exc)}") from exc
        except ssl.SSLCertVerificationError as exc:
            # antes do OSError (que ele tambem e): a dica da porta 465 la seria enganosa
            raise _erro_de_certificado("SMTP", host, exc) from exc
        except UnicodeError as exc:
            if etapa == "entrar no SMTP":
                raise _erro_de_caractere("SMTP") from exc
            raise ErroCanal(f"falha ao {etapa}: endereço com caractere inválido ({exc})") from exc
        except (smtplib.SMTPException, OSError) as exc:
            # quem usa SSL direto e esquece a porta 465 cai aqui, no STARTTLS
            dica = " (servidor com SSL direto usa a porta 465)" if "STARTTLS" in etapa else ""
            raise ErroCanal(f"falha ao {etapa}: {exc}{dica}") from exc
        finally:
            if servidor is not None:
                with contextlib.suppress(Exception):
                    servidor.quit()
                servidor.close()
        return f"SMTP ok (login em {host}:{porta} com {seguranca})"

    def _verificar_imap(self) -> str:
        host = self.credenciais["imap_host"]
        porta = self._porta("imap_porta", 993)
        usuario = self.credenciais.get("imap_usuario") or self.credenciais.get("smtp_usuario")
        senha = self.credenciais.get("imap_senha") or self.credenciais.get("smtp_senha")
        etapa = f"conectar ao servidor IMAP {host}:{porta}"
        imap = None
        try:
            imap = imaplib.IMAP4_SSL(host, porta, ssl_context=_contexto_tls(), timeout=TEMPO_VERIFICACAO)
            etapa = "entrar no IMAP"
            imap.login(usuario, senha)
        except ssl.SSLCertVerificationError as exc:
            raise _erro_de_certificado("IMAP", host, exc) from exc
        except UnicodeError as exc:
            if etapa == "entrar no IMAP":
                raise _erro_de_caractere("IMAP") from exc
            raise ErroCanal(f"falha ao {etapa}: endereço com caractere inválido ({exc})") from exc
        except imaplib.IMAP4.error as exc:
            # o imaplib usa a mesma excecao para senha errada e resposta
            # estranha na conexao; a etapa separa as duas
            if etapa == "entrar no IMAP":
                raise ErroCanal(f"o servidor IMAP recusou o usuário e a senha: {exc}") from exc
            raise ErroCanal(f"falha ao {etapa}: {exc}") from exc
        except OSError as exc:
            raise ErroCanal(f"falha ao {etapa}: {exc}") from exc
        finally:
            if imap is not None:
                with contextlib.suppress(Exception):
                    imap.logout()
        return f"IMAP ok (login em {host}:{porta})"

    # ---------------------------------------------------------------- entrada
    def verificar_assinatura(self, corpo: bytes, cabecalhos: Mapping[str, str]) -> bool:
        """O webhook genérico de e-mail exige o segredo do canal.

        Gerado no cadastro (segredo_webhook), vem no cabeçalho X-Omni-Token ou
        em ?token= na URL cadastrada no provedor (a rota junta os dois). Sem
        ele, qualquer um que achasse a URL (ids são sequenciais) punha
        mensagens na ficha de um cliente real, com o e-mail dele, e a resposta
        do atendente ia para o cliente de verdade. Canal sem segredo recusa tudo.
        """
        segredo = self.canal.segredo_webhook or ""
        enviado = cabecalhos.get("x-omni-token") or ""
        if not segredo or not enviado:
            return False
        return hmac.compare_digest(enviado.encode(), segredo.encode())

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        """Formato generico de provedores: JSON, ou os campos do formulário do
        SendGrid Inbound Parse (from, text, subject, headers) e das rotas do
        Mailgun (sender, body-plain, stripped-text, Message-Id)."""
        def texto(chave: str) -> str | None:
            valor = payload.get(chave)
            return valor if isinstance(valor, str) and valor else None

        remetente = _decodificar(texto("from") or texto("sender") or "")
        nome, endereco = parseaddr(remetente)
        endereco = endereco.lower()
        conteudo = texto("text") or texto("body-plain") or texto("stripped-text") or ""
        if not endereco or not conteudo:
            return []
        message_id = texto("message-id") or texto("Message-Id") or _message_id_dos_cabecalhos(texto("headers"))
        return [
            MensagemRecebida(
                identificador=endereco,
                conteudo=conteudo.strip(),
                nome_exibicao=nome or endereco,
                # com o canal: o cliente que escreve para suporte@ e vendas@
                # manda o mesmo Message-ID às duas caixas, e as duas o recebem
                externo_id=self._prefixar_no_canal(message_id),
                assunto=texto("subject"),
            )
        ]

    def analisar_formulario(self, campos: dict, arquivos: list[AnexoRecebido]) -> list[MensagemRecebida]:
        """Entrega em formulário (multipart ou urlencoded), como a do SendGrid e
        a do Mailgun: os campos viram o payload de analisar_webhook, e os
        arquivos (attachment1, attachment-1...) viram anexos da mensagem."""
        recebidas = self.analisar_webhook(campos)
        for recebida in recebidas:
            recebida.anexos = list(arquivos)
        return recebidas

    def coletar(self) -> list[MensagemRecebida]:
        """Busca os nao lidos por IMAP e os marca como lidos."""
        host = self.credenciais.get("imap_host")
        if not host:
            return []
        usuario = self.credenciais.get("imap_usuario") or self.credenciais.get("smtp_usuario")
        senha = self.credenciais.get("imap_senha") or self.credenciais.get("smtp_senha")
        recebidas: list[MensagemRecebida] = []
        porta = self._porta("imap_porta", 993)
        try:
            with imaplib.IMAP4_SSL(host, porta, ssl_context=_contexto_tls()) as imap:
                try:
                    imap.login(usuario, senha)
                except UnicodeError as exc:
                    raise _erro_de_caractere("IMAP") from exc
                imap.select(self.credenciais.get("imap_pasta", "INBOX"))
                _, dados = imap.search(None, "UNSEEN")
                ids = (dados[0] or b"").split()[:LIMITE_COLETA]
                for identificador in ids:
                    _, bruto = imap.fetch(identificador, "(RFC822)")
                    if not bruto or not bruto[0]:
                        continue
                    mensagem = email.message_from_bytes(bruto[0][1])
                    endereco = parseaddr(mensagem.get("From", ""))[1].lower()
                    if not endereco:
                        continue
                    recebidas.append(
                        MensagemRecebida(
                            identificador=endereco,
                            conteudo=_corpo_texto(mensagem).strip(),
                            nome_exibicao=_decodificar(parseaddr(mensagem.get("From", ""))[0]) or endereco,
                            externo_id=self._prefixar_no_canal(mensagem.get("Message-Id")),
                            assunto=_decodificar(mensagem.get("Subject")),
                            metadados={"referencias": mensagem.get("Message-Id")},
                            anexos=_anexos_de(mensagem),
                        )
                    )
                    imap.store(identificador, "+FLAGS", "\\Seen")
        except ssl.SSLCertVerificationError as exc:
            raise _erro_de_certificado("IMAP", host, exc) from exc
        except (imaplib.IMAP4.error, OSError) as exc:
            raise ErroCanal(f"falha ao ler a caixa de entrada: {exc}") from exc
        return recebidas

    # ------------------------------------------------------------------ saida
    @property
    def envia_arquivos(self) -> bool:
        return True

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        assunto = contexto.get("assunto") or "Atendimento"
        if not assunto.lower().startswith("re:"):
            assunto = f"Re: {assunto}"
        mensagem = EmailMessage()
        mensagem["From"] = self.credenciais["remetente"]
        mensagem["To"] = destino
        mensagem["Subject"] = resumir(assunto, 180)
        referencia = contexto.get("referencia")
        if referencia:
            mensagem["In-Reply-To"] = referencia
            mensagem["References"] = referencia
        # O Message-ID é gerado aqui (o smtplib não o cria): vira o id externo
        # da resposta, e é o que o cliente de e-mail do contato cita no
        # In-Reply-To quando ele responde de volta
        dominio = parseaddr(self.credenciais["remetente"])[1].rpartition("@")[2] or None
        mensagem["Message-ID"] = make_msgid(domain=dominio)
        mensagem.set_content(conteudo)
        for arquivo in contexto.get("arquivos") or []:
            principal, _, secundario = arquivo.tipo_conteudo.partition("/")
            mensagem.add_attachment(
                arquivo.dados,
                maintype=principal or "application",
                subtype=secundario or "octet-stream",
                filename=arquivo.nome,
            )
        # ErroCanal, nao ValueError: vira mensagem "falhou" com reenviar, nao 500
        porta = self._porta("smtp_porta", 587)
        host = self.credenciais["smtp_host"]
        tls = _contexto_tls()
        try:
            if porta == 465:
                servidor = smtplib.SMTP_SSL(host, porta, timeout=20, context=tls)
            else:
                servidor = smtplib.SMTP(host, porta, timeout=20)
            with servidor:
                if porta != 465:
                    servidor.starttls(context=tls)
                try:
                    servidor.login(self.credenciais["smtp_usuario"], self.credenciais["smtp_senha"])
                except UnicodeError as exc:
                    raise _erro_de_caractere("SMTP") from exc
                servidor.send_message(mensagem)
        except ssl.SSLCertVerificationError as exc:
            raise _erro_de_certificado("SMTP", host, exc) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise ErroCanal(f"falha ao enviar e-mail: {exc}") from exc
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self._prefixar_no_canal(mensagem["Message-ID"]))
