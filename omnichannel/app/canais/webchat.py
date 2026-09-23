"""Webchat do proprio site: a entrega acontece dentro do sistema, via SSE."""
from __future__ import annotations

from ..models import StatusMensagem, TipoCanal
from .base import AdaptadorCanal, MensagemRecebida, ResultadoEnvio


class AdaptadorWebchat(AdaptadorCanal):
    tipo = TipoCanal.WEBCHAT
    campos_obrigatorios = ()

    @property
    def configurado(self) -> bool:
        return True

    @property
    def envia_arquivos(self) -> bool:
        # o arquivo ja esta guardado aqui; o visitante o busca pela API
        return True

    def verificar_conexao(self) -> str:
        return "O webchat não depende de provedor externo: está sempre pronto."

    def analisar_webhook(self, payload: dict) -> list[MensagemRecebida]:
        """O widget usa rotas proprias; um webhook aqui e opcional."""
        identificador = payload.get("visitante") or payload.get("identificador")
        conteudo = (payload.get("conteudo") or payload.get("texto") or "").strip()
        if not identificador or not conteudo:
            return []
        return [
            MensagemRecebida(
                identificador=str(identificador),
                conteudo=conteudo,
                nome_exibicao=payload.get("nome"),
                externo_id=self._prefixar(payload.get("id")),
            )
        ]

    def _enviar(self, destino: str, conteudo: str, contexto: dict) -> ResultadoEnvio:
        # a mensagem ja foi gravada; o visitante a recebe pelo fluxo de eventos
        return ResultadoEnvio(status=StatusMensagem.ENVIADA)
