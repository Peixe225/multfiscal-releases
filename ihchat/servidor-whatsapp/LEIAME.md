# WhatsApp pelo QR Code sem mensalidade (Evolution API em servidor grátis)

A hospedagem compartilhada da Hostinger não mantém programa rodando o tempo
todo, e o WhatsApp pelo QR Code precisa de um: é ele que fica "logado" como
o WhatsApp Web do celular. A Z-API faz isso por mensalidade. Aqui fazemos o
mesmo de graça com a **Evolution API** (código aberto) numa máquina gratuita.

O `cloud-init.yaml` desta pasta monta tudo sozinho quando a máquina nasce:
Docker, Evolution API v2.3.7, PostgreSQL, Redis e HTTPS automático (Caddy) em
`https://<ip-com-traços>.sslip.io`. Você não instala nada no computador.

## Opção 1 — Oracle Cloud "Always Free" (recomendada: até 4 núcleos ARM grátis)

1. Crie a conta em <https://www.oracle.com/cloud/free/>. Pede cartão só para
   confirmar a identidade (não cobra nada dentro do Always Free). Região: São Paulo.
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (ou 22.04);
   - Shape: **Ampere VM.Standard.A1.Flex**, 1 OCPU e 6 GB (ou a
     VM.Standard.E2.1.Micro se o Ampere estiver sem capacidade);
   - Networking: deixe **"Assign a public IPv4 address"** ligado;
   - **Show advanced options → Management → Paste cloud-init script**: cole o
     `cloud-init.yaml` inteiro.
3. **Networking → Virtual cloud networks → (a rede criada) → Security Lists →
   Default Security List → Add Ingress Rules**: origem `0.0.0.0/0`, TCP,
   portas de destino `80` e depois `443`.
4. Espere ~5 minutos e abra `https://<IP-com-traços>.sslip.io` (ex.: IP
   `129.151.10.20` → `https://129-151-10-20.sslip.io`). Deve aparecer uma
   mensagem JSON da Evolution API ("Welcome to the Evolution API").

Importante: a Oracle pode recuperar máquinas Always Free **ociosas** (uso muito
baixo por 7 dias), e um servidor de WhatsApp de pouco movimento parece ocioso.
Para evitar, converta a conta para **Pay As You Go** (Billing → Upgrade): o que
está dentro do Always Free continua sem custo e a regra de ociosidade deixa de valer.

## Opção 2 — Google Cloud e2-micro (grátis para sempre nos EUA)

1. <https://cloud.google.com/free> → Compute Engine → **Create instance**.
2. Região **us-central1**, **us-east1** ou **us-west1** (só essas são grátis);
   tipo **e2-micro**; disco **30 GB padrão** (standard persistent disk);
   imagem **Ubuntu 24.04**.
3. Firewall: marque **Allow HTTP traffic** e **Allow HTTPS traffic**.
4. **Advanced → Management → Metadata → Add item**: chave `user-data`, valor
   = o `cloud-init.yaml` inteiro.
5. Mesma conferência do passo 4 da Oracle.

A e2-micro tem 1 GB de memória (o script liga 2 GB de swap) e 1 GB de tráfego
de saída grátis por mês; muita foto e vídeo por mês pode passar disso.

## Ligar no IHchat

Painel → **Canais → Novo canal → WhatsApp (QR Code)**:

- Provedor: **Evolution API (servidor próprio)**
- Endereço do servidor Evolution: `https://<IP-com-traços>.sslip.io`
- API key (Evolution): a mesma `CHAVE_API` do `cloud-init.yaml`
- Nome da instância (Evolution): `ihchat` (qualquer nome; a Evolution cria sozinha)

Salve e use **Conectar pelo QR Code**. No celular: WhatsApp →
**Aparelhos conectados → Conectar um aparelho** → leia o QR. Pronto: as
mensagens chegam no IHchat e as respostas saem com o nome e o setor do atendente.

## Cuidados

- É uma conexão **não oficial** (a mesma do WhatsApp Web). O WhatsApp pode
  bloquear números que mandam mensagens em massa ou para quem não os tem salvos.
  Para atendimento (cliente chama, você responde) o risco é baixo, mas use um
  número que você possa perder. A API oficial da Meta (canal "WhatsApp Cloud
  API" do IHchat) não tem esse risco.
- A `CHAVE_API` dá controle total do WhatsApp conectado: não publique.
- Para ver o log da montagem: `sudo cat /opt/ihchat-whatsapp/instalacao.log`
  (por SSH). Para atualizar a Evolution: troque `VERSAO_EVOLUTION` em
  `/opt/ihchat-whatsapp/configurar.sh` e rode `sudo bash /opt/ihchat-whatsapp/configurar.sh`.
