#!/usr/bin/env bash
# LENDA v3 · integração: sobe a pilha local igual à Hostinger (o jogo do dist-site + o servidor PHP + MariaDB).
#   docroot  $BASE/public_html          (lenda/ = cópia do dist-site: rode antes `npm run build:site`)
#   config   $BASE/lenda-config.php     (= dirname(api, 3), onde o _lib.php procura; cookie_seguro=false, e-mail em arquivo)
#   banco    $BANCO (MariaDB do socket /run/mysqld/mysqld.sock, que já tem de estar no ar)
#   php -S   127.0.0.1:$PORTA com $WORKERS processos
# Segredos aleatórios em $BASE/segredos.env (fora do repositório; só para este teste).
# Uso: LENDA_INTEG_BASE=/tmp/lenda-integracao PORTA=8752 bash servidor/teste/integracao/subir.sh
# Depois: node e2e.mjs · node hall-prazo.mjs · node carga.mjs 50 (nesta pasta). Parar: kill "$(cat $BASE/php.pid)".
set -eu
BASE=${LENDA_INTEG_BASE:-/tmp/lenda-integracao}
PORTA=${PORTA:-8752}
WORKERS=${WORKERS:-8}
BANCO=${BANCO:-lenda_integracao}
SOCK=/run/mysqld/mysqld.sock
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
mkdir -p "$BASE"
mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null
mariadb --socket="$SOCK" -uroot <<SQL
DROP DATABASE IF EXISTS \`$BANCO\`;
CREATE DATABASE \`$BANCO\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lenda'@'localhost' IDENTIFIED BY 'lenda';
GRANT ALL PRIVILEGES ON \`$BANCO\`.* TO 'lenda'@'localhost';
FLUSH PRIVILEGES;
SQL
SEGREDO="$(php -r 'echo bin2hex(random_bytes(32));')"
export PAINEL_SENHA="painel-$(php -r 'echo bin2hex(random_bytes(8));')"
export PAINEL_TOKEN="$(php -r 'echo bin2hex(random_bytes(24));')"
SENHA_HASH="$(php -r 'echo password_hash(getenv("PAINEL_SENHA"), PASSWORD_DEFAULT);')"
TOKEN_SHA="$(php -r 'echo hash("sha256", getenv("PAINEL_TOKEN"));')"
rm -rf "$BASE/emails"; mkdir -p "$BASE/emails"
umask 077
# ip_cabecalho só no teste: o php -S recebe tudo de 127.0.0.1; a carga manda X-Forwarded-For para simular
# jogadores em IPs diferentes (na Hostinger o REMOTE_ADDR já é o IP real e isto fica vazio).
cat >"$BASE/lenda-config.php" <<PHP
<?php return [
  'db' => ['dsn' => 'mysql:unix_socket=$SOCK;dbname=$BANCO;charset=utf8mb4', 'user' => 'lenda', 'pass' => 'lenda'],
  'segredo' => '$SEGREDO',
  'admin_senha_hash' => '$SENHA_HASH',
  'admin_token_sha256' => '$TOKEN_SHA',
  'origens' => ['http://127.0.0.1:$PORTA', 'http://localhost:$PORTA'],
  'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
  'email_remetente' => 'contato@oprojeto.online',
  'email_modo' => 'arquivo',
  'email_pasta' => '$BASE/emails',
  'cookie_seguro' => false,
  'ip_cabecalho' => 'HTTP_X_FORWARDED_FOR',
  'ip_proxies' => ['127.0.0.1'],
];
PHP
printf 'PAINEL_SENHA=%s\nPAINEL_TOKEN=%s\nPORTA=%s\nBANCO=%s\n' "$PAINEL_SENHA" "$PAINEL_TOKEN" "$PORTA" "$BANCO" > "$BASE/segredos.env"
umask 022
rm -rf "$BASE/public_html"
mkdir -p "$BASE/public_html"
cp -r "$PROJ/dist-site" "$BASE/public_html/lenda"
if [ -f "$BASE/php.pid" ] && kill -0 "$(cat "$BASE/php.pid")" 2>/dev/null; then
  kill "$(cat "$BASE/php.pid")"
  for _ in $(seq 1 50); do kill -0 "$(cat "$BASE/php.pid")" 2>/dev/null || break; sleep 0.1; done
fi
: > "$BASE/php.log"
PHP_CLI_SERVER_WORKERS=$WORKERS php -d opcache.enable=0 -d log_errors=1 -d error_log="$BASE/php-erros.log" -d display_errors=0 \
  -S "127.0.0.1:$PORTA" -t "$BASE/public_html" >>"$BASE/php.log" 2>&1 &
echo $! > "$BASE/php.pid"
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null && break; sleep 0.1; done
for _ in 1 2 3; do
  R="$(curl -s -X POST -H "Authorization: Bearer $PAINEL_TOKEN" "http://127.0.0.1:$PORTA/lenda/api/instalar.php")"
  echo "$R" | head -c 300; echo
  echo "$R" | grep -q '"faltam":0' && break
done
echo "ok: http://127.0.0.1:$PORTA/lenda/ (pid $(cat "$BASE/php.pid"))"
