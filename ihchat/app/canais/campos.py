"""Campos de credencial de cada tipo de canal.

É o contrato entre a tela de canais do painel e os adaptadores: a tela monta o
formulário a partir daqui, e a API usa `secreto` para nunca devolver o valor de
uma senha ou token ao navegador — só se ele está preenchido.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace

from ..config import url_publica_https
from ..models import TipoCanal


@dataclass(frozen=True, slots=True)
class Campo:
    chave: str
    rotulo: str
    secreto: bool = False
    obrigatorio: bool = False
    ajuda: str = ""
    padrao: str = ""
    opcoes: tuple[str, ...] = ()

    def como_dict(self) -> dict:
        dados = asdict(self)
        dados["opcoes"] = list(self.opcoes)
        return dados


CAMPOS: dict[str, tuple[Campo, ...]] = {
    TipoCanal.WHATSAPP.value: (
        Campo("token", "Token de acesso permanente", secreto=True, obrigatorio=True,
              ajuda="Meta for Developers → WhatsApp → Configuração da API"),
        Campo("id_numero", "ID do número de telefone", obrigatorio=True,
              ajuda="Não é o número em si: é o 'Phone number ID' da mesma tela"),
        Campo("token_verificacao", "Token de verificação do webhook",
              ajuda="Qualquer texto; repita-o no cadastro do webhook na Meta"),
        # a Meta assina os webhooks com o App Secret do app dela; não é um
        # segredo que este sistema possa escolher ou gerar
        Campo("segredo_app", "App Secret (valida a assinatura)", secreto=True,
              ajuda="Meta for Developers → Configurações do app → Básico → Chave secreta do app"),
    ),
    # WhatsApp comum pelo QR Code: a sessão fica num provedor online. Quais
    # campos valem depende do provedor (o painel mostra só os dele); por isso
    # só o provedor é obrigatório aqui, e o adaptador diz o resto
    # (AdaptadorWhatsAppQR.campos_obrigatorios). Igual ao Campos.php.
    TipoCanal.WHATSAPP_QR.value: (
        Campo("provedor", "Provedor da conexão", obrigatorio=True, padrao="zapi",
              opcoes=("zapi", "evolution"),
              ajuda="Z-API: serviço online pago, nada para instalar. Evolution API: software livre, "
                    "num servidor seu (a VPS)"),
        Campo("instancia_id", "ID da instância (Z-API)",
              ajuda="Painel da Z-API → Instâncias → a sua instância → ID"),
        Campo("instancia_token", "Token da instância (Z-API)", secreto=True,
              ajuda="Na mesma tela do ID da instância"),
        Campo("client_token", "Client-Token da conta (Z-API)", secreto=True,
              ajuda="Painel da Z-API → Segurança → Token de segurança da conta. "
                    "Obrigatório se você ativou esse token"),
        Campo("url_servidor", "Endereço do servidor Evolution",
              ajuda="Ex.: https://evolution.suaempresa.com.br"),
        Campo("api_key", "API key (Evolution)", secreto=True,
              ajuda="A AUTHENTICATION_API_KEY do servidor: com ela o IHchat cria a instância sozinho"),
        Campo("nome_instancia", "Nome da instância (Evolution)",
              ajuda="Um nome sem espaços, ex.: ihchat-suporte. Se não existir, é criada no primeiro QR Code"),
    ),
    TipoCanal.TELEGRAM.value: (
        Campo("token", "Token do bot", secreto=True, obrigatorio=True,
              ajuda="Fale com @BotFather no Telegram, envie /newbot e cole o token aqui"),
        # o padrão de verdade depende da instalação (modo_telegram_padrao)
        Campo("modo_recebimento", "Como receber mensagens", padrao="polling",
              opcoes=("polling", "webhook"),
              ajuda="'polling' funciona até no seu computador, sem endereço público. "
                    "'webhook' exige uma URL pública apontada para este servidor"),
    ),
    TipoCanal.EMAIL.value: (
        Campo("remetente", "Remetente", obrigatorio=True, ajuda="Ex.: Suporte <suporte@empresa.com.br>"),
        Campo("smtp_host", "Servidor SMTP", obrigatorio=True),
        Campo("smtp_porta", "Porta SMTP", padrao="587", ajuda="587 (STARTTLS) ou 465 (SSL)"),
        Campo("smtp_usuario", "Usuário SMTP", obrigatorio=True),
        Campo("smtp_senha", "Senha SMTP", secreto=True, obrigatorio=True),
        Campo("imap_host", "Servidor IMAP", ajuda="Para receber: a caixa é lida a cada minuto"),
        Campo("imap_usuario", "Usuário IMAP", ajuda="Em branco: usa o do SMTP"),
        Campo("imap_senha", "Senha IMAP", secreto=True, ajuda="Em branco: usa a do SMTP"),
    ),
    TipoCanal.WEBCHAT.value: (),
}


def modo_telegram_padrao() -> str:
    """Com endereço público HTTPS, webhook (entrega na hora, sem ficar
    perguntando ao Telegram); sem ele, polling, o único que funciona sem URL
    pública. Igual ao Campos::modoTelegramPadrao do PHP."""
    return "webhook" if url_publica_https() else "polling"


def campos_de(tipo: str) -> tuple[Campo, ...]:
    campos = CAMPOS.get(tipo, ())
    if tipo != TipoCanal.TELEGRAM.value:
        return campos
    padrao = modo_telegram_padrao()
    return tuple(replace(c, padrao=padrao) if c.chave == "modo_recebimento" else c for c in campos)


def todos_os_campos() -> dict[str, tuple[Campo, ...]]:
    """CAMPOS com os padrões desta instalação (o que a tela de canais recebe)."""
    return {tipo: campos_de(tipo) for tipo in CAMPOS}


def chaves_secretas(tipo: str) -> set[str]:
    return {c.chave for c in campos_de(tipo) if c.secreto}
