#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────
# LENDA · teste de ponta a ponta do servidor (PHP + MariaDB). Uso:
#   bash servidor/teste/rodar.sh
# Sobe (ou reusa) o MariaDB, cria um banco de teste próprio, escreve a config em /tmp/lenda-teste/,
# monta um public_html de mentira (lenda/api, lenda/painel, lenda/privacidade.html), sobe o php -S e roda
# servidor/teste/teste.php contra ele. Se houver Apache, confere também as regras do api/.htaccess. Se houver Chromium,
# roda no fim o teste do painel pelo navegador (teste/painel/rodar.sh: pilha própria na porta LENDA_TESTE_PORTA + 6 ou
# LENDA_TESTE_PAINEL_PORTA, banco <banco>_painel; LENDA_TESTE_SEM_NAVEGADOR=1 pula; LENDA_PRINTS=<pasta> tira os prints).
# Termina com PASSOU/FALHOU; código de saída 0 só se tudo passou. Mata pelo PID só o que ele subiu.
# Variáveis opcionais: LENDA_TESTE_PORTA (php -S, padrão 8711), LENDA_TESTE_PORTA_APACHE (8712),
# LENDA_TESTE_PORTA_PAR (php -S com 4 processos para a concorrência; padrão LENDA_TESTE_PORTA + 4),
# LENDA_TESTE_BANCO (lenda_teste_back_e2e), LENDA_TESTE_BASE (pasta de trabalho, /tmp/lenda-teste),
# LENDA_TESTE_SEM_CARGA=1 (pula as cargas: 100 mil eventos e 2.000 contas / 6.000 carreiras no Hall).
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVIDOR="$(dirname "$AQUI")"
BASE="${LENDA_TESTE_BASE:-/tmp/lenda-teste}"
PORTA="${LENDA_TESTE_PORTA:-8711}"
PORTA_APACHE="${LENDA_TESTE_PORTA_APACHE:-8712}"
PORTA_PAR="${LENDA_TESTE_PORTA_PAR:-$((PORTA + 4))}"   # php -S com 4 processos (teste de concorrência)
PORTA_BANCO_PROPRIO=8706
BANCO="${LENDA_TESTE_BANCO:-lenda_teste_back_e2e}"
SOCK_COMPARTILHADO=/run/mysqld/mysqld.sock

PIDS=()
AP_PROPRIA=""   # pasta do Apache fora do $BASE (quando o www-data não chega nele), apagada no fim
limpar() {
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && for _ in $(seq 1 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
  done
  [ -n "$AP_PROPRIA" ] && rm -rf "$AP_PROPRIA"
}
trap limpar EXIT
falhar() { echo "FALHOU (preparação): $*"; exit 1; }

command -v php >/dev/null || falhar "php não encontrado"
command -v mariadb >/dev/null || falhar "cliente mariadb não encontrado"
php -m | grep -qi '^pdo_mysql$' || falhar "php sem pdo_mysql"
php -m | grep -qi '^curl$' || falhar "php sem curl"

mkdir -p "$BASE"
chmod 755 "$BASE"

# ── 1. MariaDB: reusa o que estiver de pé; senão sobe um só deste teste ──────────────────────
SOCK=""
if [ -S "$SOCK_COMPARTILHADO" ] && mariadb --socket="$SOCK_COMPARTILHADO" -uroot -e 'SELECT 1' >/dev/null 2>&1; then
  SOCK="$SOCK_COMPARTILHADO"
  echo "· MariaDB: reusando o que já está de pé ($SOCK)"
else
  DADOS="$BASE/mariadb"
  SOCK="$DADOS/mysqld.sock"
  if [ -S "$SOCK" ] && mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1; then
    echo "· MariaDB: reusando o do teste ($SOCK)"
  else
    echo "· MariaDB: subindo um só para o teste em $DADOS (porta $PORTA_BANCO_PROPRIO)"
    mkdir -p "$DADOS/db"
    chown -R mysql:mysql "$DADOS" 2>/dev/null || true
    if [ ! -d "$DADOS/db/mysql" ]; then
      mariadb-install-db --user=mysql --datadir="$DADOS/db" --auth-root-authentication-method=socket >"$BASE/mariadb-install.log" 2>&1 \
        || falhar "mariadb-install-db (veja $BASE/mariadb-install.log)"
    fi
    mariadbd --user=mysql --datadir="$DADOS/db" --socket="$SOCK" --port="$PORTA_BANCO_PROPRIO" \
      --bind-address=127.0.0.1 --pid-file="$DADOS/mysqld.pid" >"$BASE/mariadbd.log" 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 100); do
      mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 && break
      sleep 0.2
    done
    mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 || falhar "MariaDB não respondeu (veja $BASE/mariadbd.log)"
  fi
fi

mariadb --socket="$SOCK" -uroot <<SQL || falhar "não consegui criar o banco $BANCO"
DROP DATABASE IF EXISTS \`$BANCO\`;
CREATE DATABASE \`$BANCO\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lenda'@'localhost' IDENTIFIED BY 'lenda';
GRANT ALL PRIVILEGES ON \`$BANCO\`.* TO 'lenda'@'localhost';
FLUSH PRIVILEGES;
SQL

# ── 2. config de teste (segredos aleatórios, só em /tmp) ─────────────────────────────────────
SEGREDO="$(php -r 'echo bin2hex(random_bytes(32));')"
PAINEL_SENHA="painel-$(php -r 'echo bin2hex(random_bytes(6));')"
PAINEL_TOKEN="$(php -r 'echo bin2hex(random_bytes(24));')"
export PAINEL_SENHA PAINEL_TOKEN
SENHA_HASH="$(php -r 'echo password_hash(getenv("PAINEL_SENHA"), PASSWORD_DEFAULT);')"
TOKEN_SHA="$(php -r 'echo hash("sha256", getenv("PAINEL_TOKEN"));')"
EMAILS="$BASE/emails"
rm -rf "$EMAILS"
mkdir -p "$EMAILS"
CONFIG="$BASE/lenda-config.php"
DSN="mysql:unix_socket=$SOCK;dbname=$BANCO;charset=utf8mb4"
escrever_config() {
  # $1 = limpeza_a_cada
  umask 077
  cat >"$CONFIG" <<PHP
<?php return [
  'db' => ['dsn' => '$DSN', 'user' => 'lenda', 'pass' => 'lenda'],
  'segredo' => '$SEGREDO',
  'admin_senha_hash' => '$SENHA_HASH',
  'admin_token_sha256' => '$TOKEN_SHA',
  'origens' => ['http://127.0.0.1:$PORTA', 'http://localhost:$PORTA', 'http://127.0.0.1:$PORTA_PAR'],
  'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
  'email_remetente' => 'contato@oprojeto.online',
  'email_modo' => 'arquivo',
  'email_pasta' => '$EMAILS',
  'cookie_seguro' => false,
  'limpeza_a_cada' => $1,
  'painel_cache_s' => 0,
];
PHP
  umask 022
}
escrever_config 100

# ── 3. public_html de mentira (cópia, como na hospedagem) ────────────────────────────────────
WWW="$BASE/public_html"
rm -rf "$WWW"
mkdir -p "$WWW/lenda"
cp -r "$SERVIDOR/api" "$SERVIDOR/painel" "$WWW/lenda/"
cp "$SERVIDOR/privacidade.html" "$WWW/lenda/"
# config tem de ser achada por dirname(__DIR__, 3): /tmp/lenda-teste/public_html/lenda/api → /tmp/lenda-teste
[ "$(dirname "$(dirname "$(dirname "$WWW/lenda/api")")")" = "$BASE" ] || falhar "estrutura de pastas errada"

# ── 4. php -S (com display_errors ligado de propósito: as rotas têm de desligar sozinhas) ────
# Sem opcache: o teste troca a config no meio (comConfig) e o opcache às vezes ainda servia a anterior.
LOG_PHP="$BASE/php-servidor.log"
: >"$LOG_PHP"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null; then
  falhar "a porta $PORTA já está em uso (use LENDA_TESTE_PORTA=...)"
fi
php -d display_errors=1 -d error_reporting=-1 -d log_errors=1 -d error_log="$LOG_PHP" -d opcache.enable=0 \
  -S "127.0.0.1:$PORTA" -t "$WWW" >>"$LOG_PHP" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null && break
  sleep 0.1
done
(exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null || falhar "php -S não subiu (veja $LOG_PHP)"
echo "· php -S em http://127.0.0.1:$PORTA (docroot $WWW)"
# Um segundo php -S, com 4 processos atendendo ao mesmo tempo, só para o teste de concorrência (o de cima atende
# um pedido por vez de propósito: alguns testes contam com isso).
if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA_PAR") 2>/dev/null; then
  falhar "a porta $PORTA_PAR já está em uso (use LENDA_TESTE_PORTA_PAR=...)"
fi
PHP_CLI_SERVER_WORKERS=4 php -d display_errors=1 -d error_reporting=-1 -d log_errors=1 -d error_log="$LOG_PHP" -d opcache.enable=0 \
  -S "127.0.0.1:$PORTA_PAR" -t "$WWW" >>"$LOG_PHP" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$PORTA_PAR") 2>/dev/null && break
  sleep 0.1
done
(exec 3<>"/dev/tcp/127.0.0.1/$PORTA_PAR") 2>/dev/null || falhar "php -S (4 processos) não subiu (veja $LOG_PHP)"
echo "· php -S com 4 processos em http://127.0.0.1:$PORTA_PAR (concorrência)"

# ── 5. Apache (opcional): só as regras do .htaccess (sem PHP; CGI de eco para o Authorization) ─
URL_APACHE=""
if command -v apache2 >/dev/null 2>&1 && [ -f /usr/lib/apache2/modules/mod_setenvif.so ]; then
  AP="$BASE/apache"
  # O Apache atende como www-data: se uma pasta acima do $BASE não deixa ele passar (ex.: um $BASE dentro de uma pasta
  # 700 do root), todo pedido daria 403 e as regras do .htaccess "falhariam" sem ser culpa delas. Aí a cópia do Apache
  # vai para uma pasta própria em /tmp (apagada no fim).
  if command -v runuser >/dev/null 2>&1 && id www-data >/dev/null 2>&1 && ! runuser -u www-data -- test -x "$BASE" 2>/dev/null; then
    AP_PROPRIA="$(mktemp -d /tmp/lenda-teste-apache.XXXXXX)" || falhar "mktemp para o Apache"
    chmod 755 "$AP_PROPRIA"
    AP="$AP_PROPRIA"
    echo "· Apache: o www-data não chega em $BASE; a cópia do Apache fica em $AP (apagada no fim)"
  fi
  rm -rf "$AP"
  mkdir -p "$AP/public_html/lenda"
  cp -r "$SERVIDOR/api" "$AP/public_html/lenda/"
  printf '# fica de fora\n' >"$AP/public_html/lenda/api/LEIAME.md"
  printf '<?php // de mentira: só confere que o nome passa\n' >"$AP/public_html/lenda/api/lendas.php"
  cat >"$AP/public_html/lenda/api/eco.cgi" <<'CGI'
#!/bin/sh
printf 'Content-Type: text/plain\r\n\r\n'
printf 'auth=%s\n' "${HTTP_AUTHORIZATION:-}"
CGI
  chmod 755 "$AP/public_html/lenda/api/eco.cgi"
  chmod -R a+rX "$AP"
  M=/usr/lib/apache2/modules
  cat >"$AP/httpd.conf" <<CONF
ServerRoot "$AP"
ServerName 127.0.0.1
Listen 127.0.0.1:$PORTA_APACHE
PidFile "$AP/httpd.pid"
ErrorLog "$AP/erro.log"
LogLevel warn
User www-data
Group www-data
LoadModule mpm_prefork_module $M/mod_mpm_prefork.so
LoadModule authz_core_module $M/mod_authz_core.so
LoadModule authz_host_module $M/mod_authz_host.so
LoadModule access_compat_module $M/mod_access_compat.so
LoadModule mime_module $M/mod_mime.so
LoadModule dir_module $M/mod_dir.so
LoadModule autoindex_module $M/mod_autoindex.so
LoadModule headers_module $M/mod_headers.so
LoadModule setenvif_module $M/mod_setenvif.so
LoadModule env_module $M/mod_env.so
LoadModule cgi_module $M/mod_cgi.so
LoadModule alias_module $M/mod_alias.so
TypesConfig /etc/mime.types
DocumentRoot "$AP/public_html"
<Directory />
  AllowOverride None
  Require all denied
</Directory>
<Directory "$AP/public_html">
  Options Indexes FollowSymLinks ExecCGI
  AllowOverride All
  Require all granted
  AddHandler cgi-script .cgi
</Directory>
CONF
  if apache2 -f "$AP/httpd.conf" -t >"$AP/sintaxe.log" 2>&1; then
    # setsid: o Apache (prefork) avisa o próprio grupo de processos ao sair; sem isso mataria este script.
    setsid apache2 -f "$AP/httpd.conf" -DFOREGROUND >"$AP/saida.log" 2>&1 </dev/null &
    PIDS+=($!)
    for _ in $(seq 1 50); do
      (exec 3<>"/dev/tcp/127.0.0.1/$PORTA_APACHE") 2>/dev/null && break
      sleep 0.1
    done
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA_APACHE") 2>/dev/null; then
      URL_APACHE="http://127.0.0.1:$PORTA_APACHE/lenda"
      echo "· Apache em $URL_APACHE (só para o .htaccess)"
    else
      echo "· Apache não subiu (veja $AP/saida.log); as regras do .htaccess ficam sem conferir"
    fi
  else
    echo "· Apache: config de teste inválida (veja $AP/sintaxe.log); pulando"
  fi
else
  echo "· Apache não instalado: as regras do .htaccess ficam sem conferir"
fi

# ── 6. o teste ───────────────────────────────────────────────────────────────────────────────
export LENDA_URL="http://127.0.0.1:$PORTA/lenda"
export LENDA_ORIGEM="http://127.0.0.1:$PORTA"
export LENDA_URL_PAR="http://127.0.0.1:$PORTA_PAR/lenda"
export LENDA_ORIGEM_PAR="http://127.0.0.1:$PORTA_PAR"
export LENDA_SRC="$(dirname "$SERVIDOR")/src"
export LENDA_DSN="$DSN" LENDA_BD_USUARIO=lenda LENDA_BD_SENHA=lenda
export LENDA_EMAILS="$EMAILS" LENDA_CONFIG_ARQ="$CONFIG" LENDA_LOG_PHP="$LOG_PHP"
export LENDA_AMOSTRAS="$AQUI/amostras" LENDA_URL_APACHE="$URL_APACHE"
export LENDA_TESTE_SEM_CARGA="${LENDA_TESTE_SEM_CARGA:-0}"
export LENDA_SEGREDO="$SEGREDO"
php -d display_errors=1 -d error_reporting=-1 -d memory_limit=512M "$AQUI/teste.php"
CODIGO=$?
escrever_config 100
if [ "${LENDA_TESTE_SEM_NAVEGADOR:-0}" != 1 ] && [ -x "${LENDA_CHROMIUM:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}" ]; then LENDA_TESTE_SOCK="$SOCK" LENDA_TESTE_PAINEL_PORTA="${LENDA_TESTE_PAINEL_PORTA:-$((PORTA + 6))}" LENDA_TESTE_PAINEL_BANCO="${BANCO}_painel" LENDA_TESTE_PAINEL_BASE="$BASE/painel" bash "$AQUI/painel/rodar.sh" || CODIGO=1; else echo "· teste do painel pelo navegador: pulado (sem Chromium ou LENDA_TESTE_SEM_NAVEGADOR=1)"; fi
exit $CODIGO
