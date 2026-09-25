# WhatsApp pelo QR Code: provedores (Z-API e Evolution API)

O tipo de canal `whatsapp_qr` conecta um número de WhatsApp comum lendo um QR
Code, como o WhatsApp Web. Esse protocolo exige uma sessão ligada o tempo
todo, e a hospedagem compartilhada (PHP, sem processo longo) não mantém uma.
Por isso a sessão fica num PROVEDOR online e o IHchat conversa com ele por
REST (envio, QR, estado) e recebe por webhook. Nada é instalado no computador
do dono.

O tipo `whatsapp` continua sendo a API oficial da Meta (Cloud API). A conexão
por QR Code **não é oficial**: o WhatsApp pode bloquear o número que mandar
mensagem em massa ou receber muitas denúncias. Para uso oficial, use o tipo
"WhatsApp (API oficial)".

Tudo abaixo foi conferido em 24/09/2026 na documentação e, na Evolution, no
código-fonte. Onde a documentação e o código divergem, vale o código (anotado).

Implementação: `php/app/Canais/WhatsAppQr/` (PHP) e `app/canais/zapi.py`,
`app/canais/evolution.py`, `app/canais/whatsapp_qr.py` (Python), com o mesmo
contrato HTTP. Testes: `contrato/test_whatsapp_qr*.py` (os dois servidores) e
`tests/test_whatsapp_qr*.py`.

## Contrato do IHchat (igual nos dois servidores)

| Rota | O que faz |
| --- | --- |
| `GET /api/canais/{id}/qr` (admin) | Estado e QR no provedor: `{"status": "conectado" \| "aguardando_leitura" \| "desconectado" \| "erro", "qr": "data:image/png;base64,..." \| null, "numero": "5511..." \| null, "mensagem": "..."}`. Sempre 200 (como o `testar`). Nunca devolve token nem API key. Evolution: cria a instância se ela não existir. Com `?so_estado=1` só confere a conexão, sem gerar QR (o painel consulta assim a cada ~3 s e pede QR novo a cada ~15 s). |
| `POST /api/canais/{id}/desconectar` (admin) | Desconecta o número no provedor. `{ok, mensagem, alerta}`. |
| `POST /api/canais/{id}/conectar-webhook` (admin) | Cadastra no provedor `url_publica + /webhooks/{id}?token=<segredo do canal>`. Sem `url_publica`: `ok: false` com a explicação. A Z-API só aceita HTTPS. |
| `POST /webhooks/{id}?token=<segredo>` | Entrega do provedor (o token também vale no cabeçalho `X-IHchat-Token`). Token errado ou ausente: 401 (`hash_equals` / `compare_digest`). Resposta: `{"recebidas", "status_atualizados", "enviadas_pelo_celular"}`. |

Credenciais do canal: `provedor` (`zapi` \| `evolution`); Z-API:
`instancia_id`, `instancia_token` (secreto), `client_token` (secreto,
opcional: só se a conta ativou o token de segurança); Evolution:
`url_servidor`, `api_key` (secreto), `nome_instancia`. O servidor grava sozinho
`estado_conexao` (`conectado` \| `aguardando_leitura` \| `desconectado`),
`numero_conectado` e `webhook_url` (a URL cadastrada, sem o token): não são
segredos e não aparecem no formulário.

Entrega recebida:

- mensagem do cliente (texto, imagem, documento, áudio, vídeo, figurinha,
  localização, contato, resposta de botão/lista) vira entrada; a mídia é
  baixada e guardada como anexo, com a legenda como texto;
- grupo, lista de transmissão, status (`status@broadcast`) e canal
  (newsletter) são ignorados;
- mensagem com `fromMe` (o dono respondeu pelo celular) entra no histórico
  como SAÍDA "Enviada pelo celular", sem ser reenviada. A que o próprio IHchat
  mandou pela API não é duplicada (Z-API: `fromApi`; os dois: o id externo já
  gravado no envio);
- idempotente pelo id externo (`whatsapp_qr:<canal>:<id da mensagem>`);
- recibos (enviada, entregue, lida, falhou) atualizam a mensagem de saída;
- eventos de conexão atualizam `estado_conexao`.

Envio: texto e mídia (uma mídia por mensagem, o texto vira legenda), com a
assinatura do atendente na primeira linha como no WhatsApp oficial
(`*Ana · Suporte*`). Falha do provedor: mensagem "falhou" com o erro. Sem
credencial no sandbox: "simulada".

## Z-API

Documentação (markdown para máquinas): <https://developer.z-api.io/_llms/pt-br/api-reference.md>
e o texto completo em <https://developer.z-api.io/llms-full.txt>.

- Base: `https://api.z-api.io/instances/{instanceId}/token/{token}` —
  <https://developer.z-api.io/api-reference/introduction.md>
- Cabeçalho `Client-Token: <token de segurança da conta>`; só é exigido depois
  que a conta ativa o recurso (sem ele: `{"error": "null not allowed"}`) —
  <https://developer.z-api.io/security/client-token>
- `Content-Type: application/json` em todo pedido (sem ele: 415).

| Uso no IHchat | Rota | Resposta |
| --- | --- | --- |
| estado | `GET /status` — <https://developer.z-api.io/instance/status.md> | `{"connected": bool, "error": "You are not connected", "smartphoneConnected": bool}` |
| número conectado | `GET /device` — <https://developer.z-api.io/instance/device.md> | `{"phone": "5511999999999", "name": ..., ...}` |
| QR Code | `GET /qr-code/image` — <https://developer.z-api.io/instance/qr-code-image.md> | `{"value": "data:image/png;base64,..."}`; em aparelhos com Chave de Acesso: `{"challenge": {...}}` (o IHchat pede para concluir no painel da Z-API). O QR expira a cada ~20 s; a doc recomenda pedir de novo a cada 10–20 s. |
| desconectar | `GET /disconnect` — <https://developer.z-api.io/instance/disconnect.md> | `{"value": true}` |
| webhooks | `PUT /update-every-webhooks` `{"value": url, "notifySentByMe": true}` — <https://developer.z-api.io/webhooks/update-every-webhooks.md> | `{"value": true}`. Só HTTPS. `notifySentByMe` faz chegar também o que o dono manda pelo celular — <https://developer.z-api.io/webhooks/update-notify-sent-by-me.md> |
| texto | `POST /send-text` `{"phone", "message"}` — <https://developer.z-api.io/message/send-text.md> | `{"zaapId", "messageId", "id"}` (id = messageId) |
| imagem | `POST /send-image` `{"phone", "image": "data:image/png;base64,...", "caption"}` — <https://developer.z-api.io/message/send-message-image.md> | idem |
| vídeo | `POST /send-video` `{"phone", "video", "caption"}` — <https://developer.z-api.io/message/send-message-video.md> | idem |
| documento | `POST /send-document/{extensão}` `{"phone", "document": "data:...;base64,...", "fileName", "caption"}` — <https://developer.z-api.io/message/send-message-document.md> | idem |

Webhooks (POST JSON; o campo `type` diz o evento):

- `ReceivedCallback` — <https://developer.z-api.io/webhooks/on-message-received.md> e
  exemplos <https://developer.z-api.io/webhooks/on-message-received-examples.md>:
  `messageId`, `phone`, `fromMe`, `fromApi`, `isGroup`, `isNewsletter`,
  `broadcast`, `senderName`, `chatName`, e um objeto por tipo: `text.message`;
  `image {imageUrl, mimeType, caption}`; `audio {audioUrl, mimeType}`;
  `video {videoUrl, mimeType, caption}`; `document {documentUrl, mimeType,
  fileName, title}`; `sticker {stickerUrl, mimeType}`; `location {latitude,
  longitude}`; `contact {displayName}`; `buttonsResponseMessage {message}`;
  `listResponseMessage {message, title}`. As mídias ficam 30 dias no
  armazenamento da Z-API: o IHchat baixa pela URL na hora.
- `MessageStatusCallback` `{"status": "SENT" | "RECEIVED" | "READ" | "READ_BY_ME" | "PLAYED", "ids": [...]}` —
  <https://developer.z-api.io/webhooks/on-whatsapp-message-status-changes.md>
  (SENT → enviada, RECEIVED → entregue, READ/PLAYED → lida; READ_BY_ME é a
  leitura feita pelo próprio dono e é ignorada).
- `DeliveryCallback` `{"messageId", "error"?}` — <https://developer.z-api.io/webhooks/on-message-send.md>
  (com `error`, a mensagem vira "falhou").
- `ConnectedCallback` `{"connected": true, "phone"}` — <https://developer.z-api.io/webhooks/on-webhook-connected.md>
- `DisconnectedCallback` `{"disconnected": true, "error"}` — <https://developer.z-api.io/webhooks/on-whatsapp-disconnected.md>

## Evolution API v2

Projeto: <https://github.com/evolution-foundation/evolution-api> (o antigo
`EvolutionAPI/evolution-api` redireciona para lá). Conferido na versão 2.3.7,
commit `fa09d37` (06/05/2026). Documentação: <https://docs.evolutionfoundation.com.br/llms.txt>
(o endereço antigo <https://doc.evolution-api.com> redireciona).

- Autenticação: cabeçalho `apikey` (a chave global `AUTHENTICATION_API_KEY`
  cria instâncias; o token de uma instância só vale para ela) —
  `src/api/guards/auth.guard.ts`.
- Instância inexistente: 404 `{"status": 404, "error": "Not Found", "response": {"message": ["The \"x\" instance does not exist"]}}`
  (`src/api/guards/instance.guard.ts`; formato de erro em `src/main.ts`). A
  documentação mostra outro formato (`{"success": false, "error": {...}}`), que
  o código não usa.

| Uso no IHchat | Rota (código: `src/api/routes/*.router.ts`) | Resposta |
| --- | --- | --- |
| criar instância | `POST /instance/create` `{"instanceName", "integration": "WHATSAPP-BAILEYS", "qrcode": true, "groupsIgnore": true}` — <https://docs.evolutionfoundation.com.br/evolution-api/create-instance.md> | 201 `{"instance": {...}, "hash", "qrcode": {"base64": "data:image/png;base64,...", "code", "pairingCode", "count"}}`. Sem `integration` válido: 400 "Invalid integration" (`channel.controller.ts`). |
| QR Code | `GET /instance/connect/{instancia}` — <https://docs.evolutionfoundation.com.br/evolution-api/connect-instance.md> | `{"base64", "code", "pairingCode", "count"}`; se já conectada, `{"instance": {"instanceName", "state": "open"}}` (`instance.controller.ts: connectToWhatsapp`) |
| estado | `GET /instance/connectionState/{instancia}` — <https://docs.evolutionfoundation.com.br/evolution-api/get-connection-state.md> | `{"instance": {"instanceName", "state": "open" \| "connecting" \| "close"}}` |
| número conectado | `GET /instance/fetchInstances?instanceName=` | lista de instâncias com `ownerJid` ("5511...@s.whatsapp.net") |
| desconectar | `DELETE /instance/logout/{instancia}` — <https://docs.evolutionfoundation.com.br/evolution-api/logout-instance.md> | `{"status": "SUCCESS", "error": false, "response": {"message": "Instance logged out"}}`; já desconectada: 400 "... is not connected" (o IHchat trata como sucesso) |
| webhook | `POST /webhook/set/{instancia}` `{"webhook": {"enabled": true, "url", "byEvents": false, "base64": true, "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"]}}` — <https://docs.evolutionfoundation.com.br/evolution-api/set-webhook.md> | 201. O corpo aninhado em `webhook` é o do código (`webhook.schema.ts`); a página de configuração mostra um formato plano antigo. `base64: true` faz a mídia recebida vir no próprio webhook. |
| texto | `POST /message/sendText/{instancia}` `{"number", "text"}` — <https://docs.evolutionfoundation.com.br/evolution-api/send-text-message.md> | 201 com a mensagem: `{"key": {"id", "remoteJid", "fromMe": true}, ...}` |
| mídia | `POST /message/sendMedia/{instancia}` `{"number", "mediatype": "image" \| "video" \| "document", "mimetype", "media": "<base64 puro>", "fileName", "caption"}` — <https://docs.evolutionfoundation.com.br/evolution-api/send-media-message.md> | idem. Base64 de documento exige `fileName` (`sendMessage.controller.ts`). |
| baixar mídia (quando o webhook veio sem base64) | `POST /chat/getBase64FromMediaMessage/{instancia}` `{"message": {"key": {"id"}}, "convertToMp4": false}` | `{"mediaType", "fileName", "mimetype", "base64"}` |

Webhook (POST JSON) `{"event": "messages.upsert", "instance": "<nome>", "data": {...}, "date_time", "sender", "server_url", "apikey"}`
(`webhook.controller.ts: emit`). O IHchat ignora a entrega de outra
instância (campo `instance`).

- `messages.upsert` (`whatsapp.baileys.service.ts: prepareMessage`):
  `data = {"key": {"remoteJid", "fromMe", "id", "remoteJidAlt"?}, "pushName",
  "messageType", "message": {...}, "messageTimestamp", "source"}`. Tipos:
  `conversation`; `imageMessage {caption, mimetype}`; `videoMessage`;
  `audioMessage`; `documentMessage {fileName, caption, mimetype}`;
  `stickerMessage`; `locationMessage {degreesLatitude, degreesLongitude}`;
  `contactMessage {displayName}`; com `base64` ligado, `message.base64`. Jid
  de grupo termina em `@g.us`; status é `status@broadcast`. Com
  `emitOwnEvents: false` (fixo no código), o que a própria API envia NÃO volta
  como `messages.upsert` (vem como `send.message`, que o IHchat não assina):
  `fromMe` em `messages.upsert` é o dono escrevendo pelo celular.
- `messages.update`: `data = {"keyId", "remoteJid", "fromMe", "status": "ERROR" | "PENDING" | "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED"}`
  (SERVER_ACK → enviada, DELIVERY_ACK → entregue, READ/PLAYED → lida, ERROR → falhou).
- `connection.update`: `data = {"instance", "state": "open" | "close" | "connecting" | "refused", "wuid"?, "statusReason"}`.
- `qrcode.updated`: `data = {"qrcode": {"base64", "code", "pairingCode"}}`.
