"""Canal de e-mail: envia por SMTP e recebe por IMAP (ou por webhook de provedor).

O corpo de resposta e enviado com o assunto original prefixado por "Re:" e com
os cabecalhos In-Reply-To/References, para que o cliente de e-mail do contato
mantenha tudo na mesma thread.
"""
from __future__ import annotations

import email
import imaplib
import smtplib
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr

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

LIMITE_COLETA = 25


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


class AdaptadorEmail(AdaptadorCanal):
    tipo = TipoCanal.EMAIL
    campos_obrigatorios = ("smtp_host", "smtp_usuario", "smtp_senha", "remetente")

    # ---------------------------------------------------------------- entrada
    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        """Formato generico de provedores (Mailgun, SendGrid Inbound Parse...)."""
        remetente = payload.get("from") or payload.get("sender") or ""
        endereco = parseaddr(remetente)[1].lower()
        texto = payload.get("text") or payload.get("body-plain") or payload.get("stripped-text") or ""
        if not endereco or not texto:
            return []
        return [
            MensagemRecebida(
                identificador=endereco,
                conteudo=texto.strip(),
                nome_exibicao=parseaddr(remetente)[0] or endereco,
                externo_id=self._prefixar(payload.get("message-id") or payload.get("Message-Id")),
                assunto=payload.get("subject"),
            )
        ]

    def coletar(self) -> list[MensagemRecebida]:
        """Busca os nao lidos por IMAP e os marca como lidos."""
        host = self.credenciais.get("imap_host")
        if not host:
            return []
        usuario = self.credenciais.get("imap_usuario") or self.credenciais.get("smtp_usuario")
        senha = self.credenciais.get("imap_senha") or self.credenciais.get("smtp_senha")
        recebidas: list[MensagemRecebida] = []
        try:
            with imaplib.IMAP4_SSL(host, int(self.credenciais.get("imap_porta", 993))) as imap:
                imap.login(usuario, senha)
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
                            externo_id=self._prefixar(mensagem.get("Message-Id")),
                            assunto=_decodificar(mensagem.get("Subject")),
                            metadados={"referencias": mensagem.get("Message-Id")},
                            anexos=_anexos_de(mensagem),
                        )
                    )
                    imap.store(identificador, "+FLAGS", "\\Seen")
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
        mensagem.set_content(conteudo)
        for arquivo in contexto.get("arquivos") or []:
            principal, _, secundario = arquivo.tipo_conteudo.partition("/")
            mensagem.add_attachment(
                arquivo.dados,
                maintype=principal or "application",
                subtype=secundario or "octet-stream",
                filename=arquivo.nome,
            )
        porta = int(self.credenciais.get("smtp_porta", 587))
        try:
            if porta == 465:
                servidor = smtplib.SMTP_SSL(self.credenciais["smtp_host"], porta, timeout=20)
            else:
                servidor = smtplib.SMTP(self.credenciais["smtp_host"], porta, timeout=20)
            with servidor:
                if porta != 465:
                    servidor.starttls()
                servidor.login(self.credenciais["smtp_usuario"], self.credenciais["smtp_senha"])
                servidor.send_message(mensagem)
        except (smtplib.SMTPException, OSError) as exc:
            raise ErroCanal(f"falha ao enviar e-mail: {exc}") from exc
        return ResultadoEnvio(status=StatusMensagem.ENVIADA, externo_id=self._prefixar(mensagem.get("Message-Id")))
