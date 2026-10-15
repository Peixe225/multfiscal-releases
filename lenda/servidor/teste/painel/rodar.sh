#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────
# LENDA · teste funcional do painel do administrador (Playwright + Chromium contra a pilha real: php -S + MariaDB).
#   bash servidor/teste/painel/rodar.sh
# Monta um public_html de mentira (lenda/api, lenda/painel), um banco próprio, a config com segredos aleatórios
# (só na pasta de trabalho), roda o instalar.php, planta dados de mentira (semente.mjs: contas, carreiras, denúncias,
# indicações, mesmo aparelho, lixeira, bônus, e-mails, equipe, recados) e roda painel.mjs (o painel pelo navegador) e,
# na mesma pilha, correcoes.mjs (as correções da revisão 3).
# Termina com PASSOU/FALHOU; código 0 só se tudo passou. Mata pelo PID só o que subiu; apaga o banco no fim.
# Variáveis: LENDA_TESTE_PAINEL_PORTA (8717), LENDA_TESTE_PAINEL_BANCO (lenda_teste_painel),
#   LENDA_TESTE_PAINEL_BASE (${LENDA_TESTE_BASE:-/tmp/lenda-teste}/painel), LENDA_TESTE_SOCK (/run/mysqld/mysqld.sock),
#   LENDA_CHROMIUM, LENDA_PLAYWRIGHT, LENDA_PRINTS (pasta: tira os prints de cada aba em 1440 e 390),
#   LENDA_TESTE_PAINEL_MANTER=1 (não roda o teste do navegador: deixa a pilha de pé, para olhar à mão).
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVIDOR="$(dirname "$(dirname "$AQUI")")"
PORTA="${LENDA_TESTE_PAINEL_PORTA:-8717}"
BANCO="${LENDA_TESTE_PAINEL_BANCO:-lenda_teste_painel}"
BASE="${LENDA_TESTE_PAINEL_BASE:-${LENDA_TESTE_BASE:-/tmp/lenda-teste}/painel}"
SOCK="${LENDA_TESTE_SOCK:-/run/mysqld/mysqld.sock}"
MANTER="${LENDA_TESTE_PAINEL_MANTER:-0}"
export LENDA_CHROMIUM="${LENDA_CHROMIUM:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}"
export LENDA_PLAYWRIGHT="${LENDA_PLAYWRIGHT:-/opt/node22/lib/node_modules/playwright/index.mjs}"

falhar() { echo "PAINEL FALHOU (preparação): $*"; exit 1; }
PID_PHP=""
limpar() {
  if [ "$MANTER" != 1 ]; then
    [ -n "$PID_PHP" ] && kill "$PID_PHP" 2>/dev/null && for _ in $(seq 1 50); do kill -0 "$PID_PHP" 2>/dev/null || break; sleep 0.1; done
    mariadb --socket="$SOCK" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`" >/dev/null 2>&1
  fi
}
trap limpar EXIT

command -v php >/dev/null || falhar "php não encontrado"
command -v node >/dev/null || falhar "node não encontrado"
command -v mariadb >/dev/null || falhar "cliente mariadb não encontrado"
mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 || falhar "MariaDB não responde em $SOCK"
[ "$MANTER" = 1 ] || [ -x "$LENDA_CHROMIUM" ] || falhar "Chromium não encontrado em $LENDA_CHROMIUM"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null; then falhar "a porta $PORTA já está em uso (LENDA_TESTE_PAINEL_PORTA=...)"; fi

mkdir -p "$BASE"
chmod 755 "$BASE"
mariadb --socket="$SOCK" -uroot <<SQL || falhar "não consegui criar o banco $BANCO"
DROP DATABASE IF EXISTS \`$BANCO\`;
CREATE DATABASE \`$BANCO\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lenda'@'localhost' IDENTIFIED BY 'lenda';
GRANT ALL PRIVILEGES ON \`$BANCO\`.* TO 'lenda'@'localhost';
FLUSH PRIVILEGES;
SQL

# segredos aleatórios, só na pasta de trabalho
SEGREDO="$(php -r 'echo bin2hex(random_bytes(32));')"
export PAINEL_SENHA="painel-$(php -r 'echo bin2hex(random_bytes(8));')"
export PAINEL_TOKEN="$(php -r 'echo bin2hex(random_bytes(24));')"
SENHA_HASH="$(php -r 'echo password_hash(getenv("PAINEL_SENHA"), PASSWORD_DEFAULT);')"
TOKEN_SHA="$(php -r 'echo hash("sha256", getenv("PAINEL_TOKEN"));')"
rm -rf "$BASE/emails" "$BASE/lenda-copias"
mkdir -p "$BASE/emails"
umask 077
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
  'painel_cache_s' => 0,
];
PHP
printf 'PAINEL_SENHA=%s\nPAINEL_TOKEN=%s\nPORTA=%s\nBANCO=%s\nSOCK=%s\nBASE=%s\n' "$PAINEL_SENHA" "$PAINEL_TOKEN" "$PORTA" "$BANCO" "$SOCK" "$BASE" >"$BASE/segredos.env"
umask 022

# public_html de mentira, como na hospedagem (a config fica em dirname(api, 3) = $BASE)
WWW="$BASE/public_html"
rm -rf "$WWW"
mkdir -p "$WWW/lenda"
cp -r "$SERVIDOR/api" "$SERVIDOR/painel" "$WWW/lenda/"
cp "$SERVIDOR/privacidade.html" "$WWW/lenda/" 2>/dev/null || true
# o jogo não é montado aqui: uma página de mentira só para os links "abrir no jogo" não darem 404
printf '<!doctype html><meta charset="utf-8"><title>LENDA (teste)</title><p>Jogo de mentira do teste do painel.</p>\n' >"$WWW/lenda/index.html"

LOG="$BASE/php.log"
: >"$LOG"
PHP_CLI_SERVER_WORKERS=4 php -d opcache.enable=0 -d display_errors=0 -d log_errors=1 -d error_log="$BASE/php-erros.log" \
  -S "127.0.0.1:$PORTA" -t "$WWW" >>"$LOG" 2>&1 &
PID_PHP=$!
echo "$PID_PHP" >"$BASE/php.pid"
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null && break; sleep 0.1; done
(exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null || falhar "php -S não subiu (veja $LOG)"
URL="http://127.0.0.1:$PORTA/lenda"
OK_INST=""
for _ in 1 2 3; do
  R="$(curl -s -X POST -H "Authorization: Bearer $PAINEL_TOKEN" "$URL/api/instalar.php")"
  if echo "$R" | grep -q '"faltam":0'; then OK_INST=1; break; fi
done
[ -n "$OK_INST" ] || falhar "instalar.php não terminou: $(echo "$R" | head -c 300)"
echo "· painel: pilha em $URL/painel/ (banco $BANCO, pid $PID_PHP)"

export LENDA_PAINEL_BASE="$BASE"
node "$AQUI/semente.mjs" || falhar "a semente de dados falhou"

if [ "$MANTER" = 1 ]; then
  echo "· pilha de pé (LENDA_TESTE_PAINEL_MANTER=1): $URL/painel/ · senha do painel em $BASE/segredos.env · parar: kill $PID_PHP"
  exit 0
fi
node "$AQUI/painel.mjs"
CODIGO=$?
# as correções da revisão 3 (fila ao vivo, foco no pulso, botões travados, coluna fixa…), na mesma pilha, depois
node "$AQUI/correcoes.mjs" || CODIGO=1
if grep -q "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" 2>/dev/null; then
  echo "  XX  erro fatal no PHP durante o teste do painel:"; grep "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" | head -5
  CODIGO=1
fi
[ "$CODIGO" = 0 ] && echo "PAINEL: PASSOU" || echo "PAINEL: FALHOU"
exit $CODIGO
