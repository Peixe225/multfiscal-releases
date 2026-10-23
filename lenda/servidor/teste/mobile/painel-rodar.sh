#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────
# LENDA v3.5 · suíte mobile do PAINEL DO ADMIN (Playwright + Chromium com emulação de celular, contra a pilha local).
#   bash servidor/teste/mobile/painel-rodar.sh            (tudo)
#   bash servidor/teste/mobile/painel-rodar.sh abas acoes (só esses passos; a entrada roda sempre: ela cria o PIN e a sessão)
# Sobe a pilha com o servidor/teste/integracao/subir.sh (o dist-site de agora: rode `npm run build:site` antes se mudou o
# jogo ou o painel; LENDA_BUILD=1 roda aqui), planta a semente do teste do painel (../painel/semente*.mjs) e roda:
#   painel-entrada.mjs  senha, PIN (teclado numérico), criar PIN, senha provisória, 320 px, 4G lento
#   painel-abas.mjs     as 16 abas (e partes) em 360/390 (escuro e claro), 320, 375, 412 e deitado
#   painel-acoes.mjs    ficha em tela cheia, voltar do Android, recarregar, girar, diálogos com teclado, lote, novidade,
#                       busca, Mensagens, Configurações, tema, gráfico, "Precisa de atenção", sem rede, 4G lento
#   painel-extras.mjs   recado, o que só existe no computador, WhatsApp/Instagram, iOS 15 sem requestSubmit
#   painel-correcoes.mjs as correções da v3.5 (topo e aba, menu ⋯, lote, teclado, deitado, Safari antigo)
# Prints em <LENDA_PRINTS>/painel (padrão ${TMPDIR:-/tmp}/lenda-mobile/painel). No fim mata o php -S pelo PID e apaga o banco
# (LENDA_PAINEL_MOBILE_MANTER=1 deixa de pé). Código 0 só se nenhum passo anotou problema.
# Variáveis: LENDA_PAINEL_MOBILE_PORTA (9140), LENDA_PAINEL_MOBILE_BANCO (lenda_v35_painelmobile),
#   LENDA_PAINEL_MOBILE_BASE (/tmp/lenda-v35-painel-mobile, fora de /tmp/claude-0), LENDA_TESTE_SOCK, LENDA_PRINTS.
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(cd "$AQUI/../../.." && pwd)"
PORTA="${LENDA_PAINEL_MOBILE_PORTA:-9140}"
BANCO="${LENDA_PAINEL_MOBILE_BANCO:-lenda_v35_painelmobile}"
BASE="${LENDA_PAINEL_MOBILE_BASE:-/tmp/lenda-v35-painel-mobile}"
SOCK="${LENDA_TESTE_SOCK:-/run/mysqld/mysqld.sock}"
MANTER="${LENDA_PAINEL_MOBILE_MANTER:-0}"
PASSOS="${*:-abas acoes extras correcoes}"
export LENDA_PAINEL_BASE="$BASE"

falhar() { echo "PAINEL MOBILE FALHOU (preparação): $*"; exit 1; }
limpar() {
  [ "$MANTER" = 1 ] && { echo "· pilha de pé: http://127.0.0.1:$PORTA/lenda/painel/ (pid $(cat "$BASE/php.pid" 2>/dev/null)) · segredos em $BASE/segredos.env"; return; }
  if [ -f "$BASE/php.pid" ]; then
    P="$(cat "$BASE/php.pid")"
    kill "$P" 2>/dev/null && for _ in $(seq 1 50); do kill -0 "$P" 2>/dev/null || break; sleep 0.1; done
  fi
  mariadb --socket="$SOCK" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`" >/dev/null 2>&1
}
trap limpar EXIT

mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 || falhar "MariaDB não responde em $SOCK"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null; then falhar "a porta $PORTA já está em uso (LENDA_PAINEL_MOBILE_PORTA=...)"; fi
if [ "${LENDA_BUILD:-0}" = 1 ]; then (cd "$PROJ" && npm run build:site) || falhar "build:site"; fi
[ -d "$PROJ/dist-site/painel" ] || falhar "dist-site/painel não existe (rode npm run build:site)"

LENDA_INTEG_BASE="$BASE" PORTA="$PORTA" BANCO="$BANCO" WORKERS=6 LENDA_INTEG_SOCK="$SOCK" bash "$PROJ/servidor/teste/integracao/subir.sh" | tail -1 || falhar "subir.sh"
echo "BASE=$BASE" >>"$BASE/segredos.env"
node "$PROJ/servidor/teste/painel/semente.mjs" | tail -1 || falhar "semente.mjs"
node "$PROJ/servidor/teste/painel/semente-v33.mjs" | tail -1 || falhar "semente-v33.mjs"
node "$PROJ/servidor/teste/painel/semente-v34.mjs" | tail -1 || falhar "semente-v34.mjs"

CODIGO=0
echo; echo "═══ entrada ═══"; node "$AQUI/painel-entrada.mjs" || CODIGO=1
[ -f "$BASE/estado-dono.json" ] || falhar "a entrada não gravou a sessão do Dono"
for p in $PASSOS; do
  case "$p" in
    abas) echo; echo "═══ abas ═══"; node "$AQUI/painel-abas.mjs" || CODIGO=1 ;;
    acoes) echo; echo "═══ ações ═══"; node "$AQUI/painel-acoes.mjs" || CODIGO=1 ;;
    extras) echo; echo "═══ extras ═══"; node "$AQUI/painel-extras.mjs" || CODIGO=1 ;;
    correcoes) echo; echo "═══ correções v3.5 ═══"; node "$AQUI/painel-correcoes.mjs" || CODIGO=1 ;;
    *) echo "passo desconhecido: $p" ;;
  esac
done
if grep -q "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" 2>/dev/null; then
  echo "  XX  erro fatal no PHP:"; grep "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" | head -5; CODIGO=1
fi
[ "$CODIGO" = 0 ] && echo "PAINEL MOBILE: PASSOU" || echo "PAINEL MOBILE: ACHOU PROBLEMAS (veja acima)"
exit $CODIGO
