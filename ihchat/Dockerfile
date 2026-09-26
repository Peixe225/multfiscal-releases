# IHchat em container. O jeito simples de subir é o docker-compose.yml:
#   docker compose up -d --build   ->   http://localhost:8000/painel
FROM python:3.11-slim

# PYTHONUNBUFFERED: o log chega ao `docker logs` na hora, não em blocos.
# PYTHONDONTWRITEBYTECODE: o código pertence ao root e o app roda sem
# privilégio, então não haveria onde gravar os .pyc de qualquer forma.
# IHCHAT_ORIGENS_PERMITIDAS=[]: o padrão do app é CORS "*", e aí qualquer página
# aberta no navegador de quem alcança a porta chamaria a API. Painel, simulador
# e /widget/demo são da mesma origem; para o widget num site seu, defina a
# variável no .env (o env_file do compose vence este ENV).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    IHCHAT_BANCO_URL=sqlite:////dados/ihchat.db \
    IHCHAT_PASTA_ANEXOS=/dados/anexos \
    IHCHAT_ORIGENS_PERMITIDAS=[] \
    IHCHAT_DEMO=0

WORKDIR /app

# /dados nasce com o dono certo porque um volume nomeado novo herda dono e
# permissões da pasta da imagem; sem isso o usuário do app não grava o banco
RUN useradd --system --create-home --uid 10001 ihchat \
    && mkdir -p /dados \
    && chown ihchat:ihchat /dados

# dependências antes do código: mexer só no app não refaz a camada do pip
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

USER ihchat
VOLUME ["/dados"]
EXPOSE 8000

# sem proxy: um HTTP_PROXY herdado do Docker Desktop mandaria o 127.0.0.1 para fora
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u; u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:8000/saude', timeout=4)"]

# Na partida:
# 1. sem IHCHAT_CHAVE_SECRETA, ou com a de exemplo do .env.example (que o
#    env_file do compose traz junto quando o .env foi copiado dele), gera uma
#    e guarda no volume. A de exemplo é pública, e com ela qualquer um assina
#    um token de administrador; guardada, os logins sobrevivem a recriar o
#    container.
# 2. roda o seed, que não mexe numa base que já existe; as conversas de
#    exemplo e a atendente ana@ (senha pública, está no repositório) só com
#    IHCHAT_DEMO=1. IHCHAT_SENHA_ADMIN vazia (a linha do .env
#    apagada só do lado direito) conta como ausente: o seed gravaria um
#    administrador que entra sem senha.
# 3. exec: o uvicorn vira o processo principal e recebe o SIGTERM do
#    `docker stop`. O fluxo SSE do painel nunca termina sozinho, daí o limite
#    no desligamento, dentro dos 10 s que o Docker espera antes do SIGKILL.
CMD if [ -z "$IHCHAT_CHAVE_SECRETA" ] || [ "$IHCHAT_CHAVE_SECRETA" = troque-esta-chave-em-producao ]; then \
        [ -z "$IHCHAT_CHAVE_SECRETA" ] \
            || echo "Aviso: IHCHAT_CHAVE_SECRETA veio com a chave de exemplo, que é pública; usando a de /dados/.chave_secreta." >&2; \
        [ -s /dados/.chave_secreta ] \
            || (umask 077 && python -c "import secrets; print(secrets.token_urlsafe(48))" > /dados/.chave_secreta); \
        IHCHAT_CHAVE_SECRETA="$(cat /dados/.chave_secreta)" && export IHCHAT_CHAVE_SECRETA; \
    fi \
    && { [ -n "$IHCHAT_SENHA_ADMIN" ] || unset IHCHAT_SENHA_ADMIN; } \
    && if [ "$IHCHAT_DEMO" = 1 ]; then python -m scripts.seed --demo; else python -m scripts.seed --producao; fi \
    && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 3
