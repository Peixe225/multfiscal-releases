#!/usr/bin/env bash
# LENDA v3.5 · suíte mobile · TOQUE E LEGIBILIDADE — roda tudo de novo (depois das correções).
#
#   bash servidor/teste/mobile/toque-rodar.sh                 # pilha local: build:site → subir.sh → semear → medir
#   ALVO=prod bash servidor/teste/mobile/toque-rodar.sh       # só leitura na produção (nenhum POST, sem medição de visita)
#   LARGURAS=320,360 ETAPAS=home,hall SEM_BUILD=1 bash servidor/teste/mobile/toque-rodar.sh
#
# Variáveis: LENDA_INTEG_BASE (padrão /tmp/lenda-v35-toque), PORTA (9150), BANCO (lenda_v35_toque), LARGURAS
# (320,360,390,412), FOCO (larguras com o teste do Tab; padrão 390), MOVIMENTO=0 para pular a passada com
# prefers-reduced-motion, FIM=0 para não jogar a carreira até o fim, LENDA_PRINTS (pasta-raiz; a área escreve em
# <raiz>/toque, padrão ${TMPDIR:-/tmp}/lenda-mobile/toque) ou LENDA_PRINTS_TOQUE (a pasta da área).
# No fim, com LIMPAR=1: para o php -S pelo PID e apaga o banco do teste. Código 1 se o relatório achou algo grave.
# (Para rodar todas as áreas numa pilha só: servidor/teste/mobile/rodar.sh.)
# Saída: toque-<alvo>.json (todas as medidas), toque-<alvo>-piores.md (os piores casos) e verificar/<aparelho>.json.
set -eu
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
M="$PROJ/servidor/teste/mobile"
ALVO=${ALVO:-local}
export LENDA_INTEG_BASE=${LENDA_INTEG_BASE:-/tmp/lenda-v35-toque}
export PORTA=${PORTA:-9150} BANCO=${BANCO:-lenda_v35_toque}
ARGS=(--larguras "${LARGURAS:-320,360,390,412}")
[ -n "${ETAPAS:-}" ] && ARGS+=(--etapas "$ETAPAS")
if [ "$ALVO" = prod ]; then
  C=0
  node "$M/toque-rotas.mjs" --alvo prod "${ARGS[@]}" --foco "${FOCO:-nenhuma}" || C=1
  node "$M/toque-verificar.mjs" --alvo prod --aparelho "${APARELHO:-galaxy-a}" || C=1
  node "$M/toque-relatorio.mjs" --alvo prod || C=1
  exit $C
fi
if [ "${SEM_BUILD:-0}" != 1 ]; then (cd "$PROJ" && npm run build:site); fi
bash "$PROJ/servidor/teste/integracao/subir.sh"
node "$M/hall-semear.mjs" --de-novo
[ "${MOVIMENTO:-1}" = 1 ] && ARGS+=(--movimento)
[ "${FIM:-1}" = 1 ] && ARGS+=(--fim)
C=0
node "$M/toque-rotas.mjs" "${ARGS[@]}" --foco "${FOCO:-390}" || C=1
node "$M/toque-verificar.mjs" --aparelho "${APARELHO:-galaxy-a}" || C=1
node "$M/toque-relatorio.mjs" --alvo local || C=1
if [ "${LIMPAR:-0}" = 1 ]; then
  kill "$(cat "$LENDA_INTEG_BASE/php.pid")" 2>/dev/null || true
  mariadb --socket="${LENDA_INTEG_SOCK:-/run/mysqld/mysqld.sock}" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`"
fi
exit $C
