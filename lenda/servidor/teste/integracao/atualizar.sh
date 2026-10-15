#!/usr/bin/env bash
# LENDA · teste de atualização (deploy por cima do que está no ar, sem perder nada):
#   1. sobe o servidor/api e o servidor/painel de um commit (LENDA_ATUALIZAR_REF, padrão HEAD = o que está publicado),
#      roda o instalar.php dele e cria dados de verdade pela API daquela versão (contas, carreiras, conquistas, convite,
#      bônus, denúncia, carreira oculta, medição, config, sessão do jogo);
#   2. guarda cada linha de cada tabela;
#   3. põe os arquivos desta árvore por cima e roda o instalar.php novo duas vezes (a 2ª não muda nada);
#   4. confere que nenhuma linha antiga sumiu nem mudou (nas colunas que já existiam) e que o jogo e o painel novos
#      respondem com esses dados (a sessão do jogador continua; o cookie antigo do painel deixa de valer, como o LEIAME diz).
# Uso: LENDA_INTEG_SOCK=<socket do MariaDB> PORTA=8824 BANCO=lenda_atualizar bash servidor/teste/integracao/atualizar.sh
# Pasta de trabalho: LENDA_ATUALIZAR_BASE (padrão /tmp/lenda-atualizar). Mata pelo PID só o php -S que subiu; apaga o banco.
set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LENDA="$(cd "$AQUI/../../.." && pwd)"
REPO="$(git -C "$LENDA" rev-parse --show-toplevel)"
REF="${LENDA_ATUALIZAR_REF:-HEAD}"
BASE="${LENDA_ATUALIZAR_BASE:-/tmp/lenda-atualizar}"
PORTA="${PORTA:-8824}"
BANCO="${BANCO:-lenda_atualizar}"
SOCK="${LENDA_INTEG_SOCK:-/run/mysqld/mysqld.sock}"
PID_PHP=""
falhar() { echo "ATUALIZAR FALHOU (preparação): $*"; exit 1; }
limpar() {
  [ -n "$PID_PHP" ] && kill "$PID_PHP" 2>/dev/null && for _ in $(seq 1 50); do kill -0 "$PID_PHP" 2>/dev/null || break; sleep 0.1; done
  mariadb --socket="$SOCK" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`" >/dev/null 2>&1
}
trap limpar EXIT
mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 || falhar "MariaDB não responde em $SOCK"
(exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null && falhar "a porta $PORTA já está em uso"
rm -rf "$BASE"
mkdir -p "$BASE/antes" "$BASE/public_html/lenda" "$BASE/emails"
chmod 755 "$BASE"
CAMINHO="$(realpath --relative-to="$REPO" "$LENDA")/servidor"
git -C "$REPO" archive "$REF" "$CAMINHO/api" "$CAMINHO/painel" | tar -x -C "$BASE/antes" || falhar "git archive $REF"
ANTES="$BASE/antes/$CAMINHO"
mariadb --socket="$SOCK" -uroot <<SQL || falhar "banco"
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
umask 077
cat >"$BASE/lenda-config.php" <<PHP
<?php return [
  'db' => ['dsn' => 'mysql:unix_socket=$SOCK;dbname=$BANCO;charset=utf8mb4', 'user' => 'lenda', 'pass' => 'lenda'],
  'segredo' => '$SEGREDO',
  'admin_senha_hash' => '$SENHA_HASH',
  'admin_token_sha256' => '$TOKEN_SHA',
  'origens' => ['http://127.0.0.1:$PORTA'],
  'regras' => ['apos_partidas' => 5, 'obrigatorio' => false, 'lembrar_a_cada' => 3],
  'email_remetente' => 'contato@oprojeto.online',
  'email_modo' => 'arquivo',
  'email_pasta' => '$BASE/emails',
  'cookie_seguro' => false,
  'ip_cabecalho' => 'HTTP_X_FORWARDED_FOR',
  'ip_proxies' => ['127.0.0.1'],
  'limpeza_a_cada' => 0,
  'painel_cache_s' => 0,
];
PHP
umask 022
WWW="$BASE/public_html/lenda"
cp -r "$ANTES/api" "$ANTES/painel" "$WWW/"
PHP_CLI_SERVER_WORKERS=4 php -d opcache.enable=0 -d display_errors=0 -d log_errors=1 -d error_log="$BASE/php-erros.log" \
  -S "127.0.0.1:$PORTA" -t "$BASE/public_html" >"$BASE/php.log" 2>&1 &
PID_PHP=$!
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null && break; sleep 0.1; done
URL="http://127.0.0.1:$PORTA/lenda"
instalar() {
  curl -s -X POST -H "Authorization: Bearer $PAINEL_TOKEN" "$URL/api/instalar.php"
}
R0="$(instalar)"
echo "$R0" | grep -q '"faltam":0' || falhar "instalar.php de $REF: $(echo "$R0" | head -c 300)"
echo "· $REF no ar em $URL (banco $BANCO, pid $PID_PHP)"
export LENDA_URL="$URL" LENDA_ORIGEM="http://127.0.0.1:$PORTA" LENDA_DSN="mysql:unix_socket=$SOCK;dbname=$BANCO;charset=utf8mb4"
export LENDA_ESTADO="$BASE/estado.json" LENDA_AMOSTRAS="$LENDA/servidor/teste/amostras"
php "$AQUI/atualizar.php" antes || falhar "dados da versão de antes"
# os arquivos desta árvore por cima (como o build sobe a pasta api/ inteira) e o instalar novo, duas vezes
rm -rf "$WWW/api" "$WWW/painel"
cp -r "$LENDA/servidor/api" "$LENDA/servidor/painel" "$WWW/"
R1="$(instalar)"
R2="$(instalar)"
printf '%s' "$R1" >"$BASE/instalar-1.json"
printf '%s' "$R2" >"$BASE/instalar-2.json"
php "$AQUI/atualizar.php" depois
CODIGO=$?
[ "$CODIGO" = 0 ] && echo "ATUALIZAR: PASSOU" || echo "ATUALIZAR: FALHOU"
exit $CODIGO
