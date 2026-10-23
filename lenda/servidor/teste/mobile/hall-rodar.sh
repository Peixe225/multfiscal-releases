#!/usr/bin/env bash
# LENDA v3.5 · suíte mobile · HALL DAS LENDAS, DESAFIOS E CONQUISTAS — roda tudo de novo (depois das correções).
#
#   bash servidor/teste/mobile/hall-rodar.sh            # pilha local: build:site → subir.sh → semear → todos os testes
#   ALVO=prod bash servidor/teste/mobile/hall-rodar.sh  # só leitura na produção (nenhum POST, sem medição de visita)
#   APARELHOS=galaxy-a,iphone-se ETAPAS=hall,filtros bash servidor/teste/mobile/hall-rodar.sh
#
# Variáveis: LENDA_INTEG_BASE (padrão /tmp/lenda-v35-hall), PORTA (9120), BANCO (lenda_v35_hall), LENDA_PRINTS_HALL.
# No fim, com LIMPAR=1: para o php -S pelo PID e apaga o banco do teste.
set -eu
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
M="$PROJ/servidor/teste/mobile"
ALVO=${ALVO:-local}
export LENDA_INTEG_BASE=${LENDA_INTEG_BASE:-/tmp/lenda-v35-hall}
export PORTA=${PORTA:-9120} BANCO=${BANCO:-lenda_v35_hall}
ARGS=()
[ -n "${APARELHOS:-}" ] && ARGS+=(--aparelhos "$APARELHOS")
[ -n "${ETAPAS:-}" ] && ARGS+=(--etapas "$ETAPAS")
if [ "$ALVO" = prod ]; then
  PERFIL=${PERFIL:-$(curl -s https://oprojeto.online/lenda/api/hall.php | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo $j["itens"][0]["perfil"] ?? "";')}
  export LENDA_PRINTS_HALL=${LENDA_PRINTS_HALL:-/tmp/claude-0/-home-user-multfiscal-releases/856de241-fe5b-5ff3-9843-1a584641489b/scratchpad/v35-mobile/hall/producao}
  node "$M/hall-mobile.mjs" --alvo prod --perfil "$PERFIL" "${ARGS[@]}" --etapas "${ETAPAS:-faixa,desafios,hall,filtros,ficha,comunidade,conquistas,ligas,creditos,perfil,privacidade,voltar}"
  node "$M/hall-lento.mjs" --alvo prod --perfil "$PERFIL" --aparelho "${APARELHO:-galaxy-a}"
  node "$M/hall-rede.mjs" --alvo prod --perfil "$PERFIL" --aparelho "${APARELHO:-galaxy-a}"
  exit 0
fi
if [ "${SEM_BUILD:-0}" != 1 ]; then (cd "$PROJ" && npm run build:site); fi
bash "$PROJ/servidor/teste/integracao/subir.sh"
node "$M/hall-semear.mjs" --de-novo
node "$M/hall-mobile.mjs" "${ARGS[@]}"
node "$M/hall-lento.mjs" --aparelho "${APARELHO:-galaxy-a}"
node "$M/hall-rede.mjs" --aparelho "${APARELHO:-galaxy-a}"
node "$M/hall-safari.mjs"
node "$M/hall-medicao.mjs"
if [ "${LIMPAR:-0}" = 1 ]; then
  kill "$(cat "$LENDA_INTEG_BASE/php.pid")" 2>/dev/null || true
  mariadb --socket="${LENDA_INTEG_SOCK:-/run/mysqld/mysqld.sock}" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`"
fi
