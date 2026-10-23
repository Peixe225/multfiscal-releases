#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────
# LENDA v3.5 · suíte mobile — TODAS as áreas numa pilha local só (ou a produção, só lendo).
#
#   bash servidor/teste/mobile/rodar.sh                     # sobe a pilha, semeia, roda as áreas, derruba a pilha
#   AREAS="mobile carreira" bash servidor/teste/mobile/rodar.sh
#   ALVO=prod bash servidor/teste/mobile/rodar.sh           # produção: SÓ LEITURA (sem pilha, sem banco)
#
# Áreas (AREAS, na ordem): primeira carreira hall toque conta painel mobile carga
#   primeira  primeira-impressao.mjs   Home/dobra, início, navegadores dos apps, medição (bot=0, origem), saída cedo,
#                                      arquivo que não chega, storage, Safari antigo simulado
#   carreira  carreira-*.mjs + src/ui/classic/e2e/carreira-mobile.mjs   carreira inteira pela tela (320 com animação, uma
#                                      fila rara no iPhone SE, TikTok com 4G lento + CPU 4×), voltar do Android, rede
#                                      caindo, 17 tamanhos em pé/deitado, diálogos, iOS 15 (sem clip, sem as APIs)
#   hall      hall-*.mjs               Hall, desafios, conquistas, perfil; rede; Safari antigo; entalhe (a CPU lenta, o
#                                      hall-lento.mjs, roda na área "carga", contra o servidor HTTP/2)
#   toque     toque-*.mjs              alvos, contraste, texto pequeno, vazamento, foco em 36 telas × 4 larguras
#   conta     conta-*.mjs              convite, cadastro, código, teclado, Minha conta, Fale conosco, apps, voltar…
#   painel    painel-*.mjs             (planta antes a semente do painel) entrada/PIN, 24 abas, ações, extras, correções
#   mobile    mobile.mjs               o comando único dos fluxos principais (por último: o painel dele cria ou usa o PIN)
#   carga     4G lento + CPU 4× contra um servidor HTTP/2 com brotli e cache como a Hostinger (ferramentas/servidor-h2.mjs,
#             porta LENDA_MOBILE_PORTA + 5): primeira-impressao --etapas=carga, carreira-tempo-4g --metas e hall-lento (botão em até 5 s,
#             toque → identidade em até 2 s com a página assentada; o toque imediato, assim que o botão aparece, é anotado
#             acima de 2 s e reprova acima de 6 s) — o php -S sozinho não comprime e daria números de ~12 s. O certificado
#             autoassinado vai como confiável (LENDA_TLS_SPKI) para a 2ª visita medir o cache HTTP de verdade
#
# Produção (ALVO=prod): mobile.mjs --alvo prod, primeira-impressao (home, início, carga e filme no 4G, apps),
# carreira-tempo-4g (--metas), hall-mobile/lento/rede e toque-rotas/verificar — todos com a barreira de aparelhos.mjs
# (o e.php respondido localmente com 204; escrita para /api/ barrada no CDP e dentro da página).
#
# Variáveis: LENDA_MOBILE_PORTA (9190), LENDA_MOBILE_BANCO (lenda_v35_mobile), LENDA_MOBILE_BASE (pasta da pilha, fora de
# /tmp/claude-0; padrão ${TMPDIR:-/tmp}/lenda-mobile-pilha), LENDA_PRINTS (pasta-raiz dos prints e relatórios; padrão
# ${TMPDIR:-/tmp}/lenda-mobile, cada área numa subpasta), LENDA_BUILD=1 (roda o npm run build:site antes),
# LENDA_MOBILE_MANTER=1 (deixa a pilha de pé no fim), LENDA_TESTE_SOCK (socket do MariaDB).
# No fim: mata o php -S pelo PID e apaga o banco. Código 0 só se todos os scripts passaram.
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -u
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(cd "$AQUI/../../.." && pwd)"
ALVO="${ALVO:-local}"
PORTA="${LENDA_MOBILE_PORTA:-9190}"
BANCO="${LENDA_MOBILE_BANCO:-lenda_v35_mobile}"
BASE="${LENDA_MOBILE_BASE:-${TMPDIR:-/tmp}/lenda-mobile-pilha}"
SOCK="${LENDA_TESTE_SOCK:-/run/mysqld/mysqld.sock}"
export LENDA_PRINTS="${LENDA_PRINTS:-${TMPDIR:-/tmp}/lenda-mobile}"
mkdir -p "$LENDA_PRINTS"
RESUMO="$LENDA_PRINTS/rodar-$ALVO.txt"
: >"$RESUMO"

declare -a NOMES=() CODIGOS=() TEMPOS=()
rodar() { # rodar <rótulo> <comando…>
  local rot="$1"; shift
  local t0=$SECONDS
  echo; echo "═══ $rot ═══"
  "$@"
  local c=$?
  NOMES+=("$rot"); CODIGOS+=("$c"); TEMPOS+=("$((SECONDS - t0))")
  printf '%-58s %s  %4ss\n' "$rot" "$([ "$c" = 0 ] && echo PASSOU || echo FALHOU)" "$((SECONDS - t0))" >>"$RESUMO"
  return 0
}
resumo() {
  local falhas=0
  echo; echo "══════════ suíte mobile ($ALVO) ══════════"
  for i in "${!NOMES[@]}"; do
    printf '  %-58s %s  %4ss\n' "${NOMES[$i]}" "$([ "${CODIGOS[$i]}" = 0 ] && echo PASSOU || echo FALHOU)" "${TEMPOS[$i]}"
    [ "${CODIGOS[$i]}" = 0 ] || falhas=$((falhas + 1))
  done
  echo "  ${#NOMES[@]} scripts · $falhas falharam · prints e relatórios em $LENDA_PRINTS (resumo em $RESUMO)"
  [ "$falhas" = 0 ]
}
M="$AQUI"

# ───────────────────────── produção: só leitura ─────────────────────────
if [ "$ALVO" = prod ]; then
  AREAS="${AREAS:-mobile primeira carreira hall toque}"
  PERFIL="${PERFIL:-$(curl -s https://oprojeto.online/lenda/api/hall.php | php -r '$j=json_decode(stream_get_contents(STDIN),true); foreach (($j["itens"] ?? []) as $i) if (!empty($i["perfil"])) { echo $i["perfil"]; break; }')}"
  for a in $AREAS; do
    case "$a" in
      mobile) rodar "mobile.mjs --alvo prod" node "$M/mobile.mjs" --alvo prod ${PERFIL:+--perfil "$PERFIL"} ;;
      primeira) rodar "primeira-impressao (home, inicio, carga, filme, inapp)" node "$M/primeira-impressao.mjs" --alvo=prod --etapas=home,inicio,carga,filme,inapp ;;
      carreira) rodar "carreira-tempo-4g --metas (galaxy-a)" env LENDA_URL=https://oprojeto.online/lenda/ node "$M/carreira-tempo-4g.mjs" --aparelho galaxy-a --metas ;;
      hall)
        rodar "hall-mobile --alvo prod" env LENDA_PRINTS_HALL="$LENDA_PRINTS/hall-prod" node "$M/hall-mobile.mjs" --alvo prod --perfil "$PERFIL" --aparelhos pequeno-320,galaxy-a,iphone-se,tiktok-ios,deitado --etapas faixa,desafios,hall,filtros,ficha,comunidade,conquistas,ligas,creditos,perfil,privacidade,voltar
        rodar "hall-lento --alvo prod" env LENDA_PRINTS_HALL="$LENDA_PRINTS/hall-prod" node "$M/hall-lento.mjs" --alvo prod --perfil "$PERFIL" --aparelho galaxy-a
        rodar "hall-rede --alvo prod" env LENDA_PRINTS_HALL="$LENDA_PRINTS/hall-prod" node "$M/hall-rede.mjs" --alvo prod --perfil "$PERFIL" --aparelho galaxy-a ;;
      toque)
        rodar "toque-rotas --alvo prod (320, 360)" node "$M/toque-rotas.mjs" --alvo prod --larguras 320,360 --foco nenhuma
        rodar "toque-verificar --alvo prod" node "$M/toque-verificar.mjs" --alvo prod --aparelho galaxy-a
        rodar "toque-relatorio --alvo prod" node "$M/toque-relatorio.mjs" --alvo prod ;;
      *) echo "área desconhecida na produção: $a (só leitura: mobile primeira carreira hall toque)" ;;
    esac
  done
  resumo
  exit $?
fi

# ───────────────────────── pilha local ─────────────────────────
falhar() { echo "SUÍTE MOBILE FALHOU (preparação): $*"; exit 1; }
limpar() {
  if [ "${LENDA_MOBILE_MANTER:-0}" = 1 ]; then echo "· pilha de pé: http://127.0.0.1:$PORTA/lenda/ (pid $(cat "$BASE/php.pid" 2>/dev/null)) · banco $BANCO"; return; fi
  [ -f "$BASE/h2.pid" ] && kill "$(cat "$BASE/h2.pid")" 2>/dev/null
  if [ -f "$BASE/php.pid" ]; then
    P="$(cat "$BASE/php.pid")"
    kill "$P" 2>/dev/null && for _ in $(seq 1 50); do kill -0 "$P" 2>/dev/null || break; sleep 0.1; done
  fi
  mariadb --socket="$SOCK" -uroot -e "DROP DATABASE IF EXISTS \`$BANCO\`" >/dev/null 2>&1
}
trap limpar EXIT
AREAS="${AREAS:-primeira carreira hall toque conta painel mobile carga}"
mariadb --socket="$SOCK" -uroot -e 'SELECT 1' >/dev/null 2>&1 || falhar "MariaDB não responde em $SOCK"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORTA") 2>/dev/null; then falhar "a porta $PORTA já está em uso (LENDA_MOBILE_PORTA=...)"; fi
if [ "${LENDA_BUILD:-0}" = 1 ]; then (cd "$PROJ" && npm run build:site) || falhar "build:site"; fi
[ -f "$PROJ/dist-site/index.html" ] || falhar "dist-site não existe (rode npm run build:site ou LENDA_BUILD=1)"

LENDA_INTEG_BASE="$BASE" PORTA="$PORTA" BANCO="$BANCO" WORKERS=8 LENDA_INTEG_SOCK="$SOCK" bash "$PROJ/servidor/teste/integracao/subir.sh" | tail -1 || falhar "subir.sh"
grep -q '^BASE=' "$BASE/segredos.env" || echo "BASE=$BASE" >>"$BASE/segredos.env"
export LENDA_INTEG_BASE="$BASE" LENDA_PAINEL_BASE="$BASE" LENDA_URL="http://127.0.0.1:$PORTA/lenda/"
echo "· pilha: $LENDA_URL (pid $(cat "$BASE/php.pid")) · banco $BANCO · prints em $LENDA_PRINTS"
rodar "hall-semear (semente: carreiras, contas, emblemas)" node "$M/hall-semear.mjs" --de-novo

for a in $AREAS; do
  case "$a" in
    primeira)
      rodar "primeira-impressao (home…safari, local)" node "$M/primeira-impressao.mjs" --alvo=local --etapas=home,inicio,inapp,medicao,saida,rede,storage,safari ;;
    carreira)
      rodar "carreira-classico pequeno-320 Expresso (com animação)" node "$M/carreira-classico.mjs" --aparelho pequeno-320 --ritmo expressa --share falso
      rodar "carreira-classico iphone-se fila v-extraordinaria-03" node "$M/carreira-classico.mjs" --aparelho iphone-se --fila scripts/gravar/filas/classico.json:v-extraordinaria-03 --pular --sem-extras
      rodar "carreira-classico pequeno-320 fila v-extraordinaria-01" node "$M/carreira-classico.mjs" --aparelho pequeno-320 --fila scripts/gravar/filas/classico.json:v-extraordinaria-01 --pular --sem-extras
      rodar "carreira-classico tiktok-android Expresso (4G lento + CPU 4×)" node "$M/carreira-classico.mjs" --aparelho tiktok-android --ritmo expressa --lento --sem-extras --pular
      rodar "carreira-classico deitado Expresso" node "$M/carreira-classico.mjs" --aparelho deitado --ritmo expressa --sem-extras --pular --share falso
      rodar "carreira-voltar (pixel-7)" node "$M/carreira-voltar.mjs" --aparelho pixel-7
      rodar "carreira-offline (galaxy-a)" node "$M/carreira-offline.mjs" --aparelho galaxy-a
      rodar "carreira-girar (17 tamanhos)" node "$M/carreira-girar.mjs"
      rodar "carreira-dialogos (pequeno-320)" node "$M/carreira-dialogos.mjs" --aparelho pequeno-320
      rodar "carreira-dialogos (pequeno-320, 568 de altura)" node "$M/carreira-dialogos.mjs" --aparelho pequeno-320 --altura 568
      rodar "carreira-ios15 (iphone-se)" node "$M/carreira-ios15.mjs"
      rodar "e2e carreira-mobile (galaxy-a)" node "$PROJ/src/ui/classic/e2e/carreira-mobile.mjs" --aparelho galaxy-a
      rodar "e2e carreira-mobile (pequeno-320)" node "$PROJ/src/ui/classic/e2e/carreira-mobile.mjs" --aparelho pequeno-320 ;;
    hall)
      rodar "hall-mobile (11 aparelhos)" node "$M/hall-mobile.mjs"
      rodar "hall-rede (galaxy-a)" node "$M/hall-rede.mjs" --aparelho galaxy-a
      rodar "hall-rede (tiktok-android)" node "$M/hall-rede.mjs" --aparelho tiktok-android
      rodar "hall-safari (iOS 15.3/15.6/16.1 e entalhe)" node "$M/hall-safari.mjs" ;;
    toque)
      rodar "toque-rotas (320/360/390/412, foco 390, movimento, fim)" node "$M/toque-rotas.mjs" --larguras 320,360,390,412 --foco 390 --movimento --fim
      rodar "toque-verificar (galaxy-a)" node "$M/toque-verificar.mjs" --aparelho galaxy-a
      rodar "toque-relatorio (local)" node "$M/toque-relatorio.mjs" --alvo local ;;
    conta)
      rodar "conta-cadastro" node "$M/conta-cadastro.mjs"
      rodar "conta-gestao" node "$M/conta-gestao.mjs"
      rodar "conta-extras" node "$M/conta-extras.mjs" ;;
    painel)
      rodar "semente do painel (v3.2/v3.3/v3.4)" bash -c "node '$PROJ/servidor/teste/painel/semente.mjs' | tail -1 && node '$PROJ/servidor/teste/painel/semente-v33.mjs' | tail -1 && node '$PROJ/servidor/teste/painel/semente-v34.mjs' | tail -1"
      rodar "painel-entrada" node "$M/painel-entrada.mjs"
      rodar "painel-abas" node "$M/painel-abas.mjs"
      rodar "painel-acoes" node "$M/painel-acoes.mjs"
      rodar "painel-extras" node "$M/painel-extras.mjs"
      rodar "painel-correcoes" node "$M/painel-correcoes.mjs" ;;
    mobile)
      rodar "mobile.mjs (local)" node "$M/mobile.mjs" ;;
    carga)
      PH2=$((PORTA + 5))
      rm -f "$BASE/h2.spki"
      node "$M/ferramentas/servidor-h2.mjs" "$BASE/public_html" "$PH2" "$PORTA" "$BASE/h2.spki" >"$BASE/h2.log" 2>&1 &
      echo $! >"$BASE/h2.pid"
      for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$PH2") 2>/dev/null && [ -s "$BASE/h2.spki" ] && break; sleep 0.2; done
      # o hash do certificado de teste: o Chromium o trata como válido e guarda no cache HTTP (a "2ª visita" mede o cache)
      SPKI="$(cat "$BASE/h2.spki" 2>/dev/null)"
      rodar "carga 4G (HTTP/2 + brotli): primeira-impressao --etapas=carga" env LENDA_URL="https://127.0.0.1:$PH2/lenda/" LENDA_IGNORAR_TLS=1 LENDA_TLS_SPKI="$SPKI" node "$M/primeira-impressao.mjs" --alvo=local --etapas=carga
      rodar "carga 4G (HTTP/2 + brotli): carreira-tempo-4g --metas" env LENDA_URL="https://127.0.0.1:$PH2/lenda/" LENDA_IGNORAR_TLS=1 LENDA_TLS_SPKI="$SPKI" node "$M/carreira-tempo-4g.mjs" --aparelho galaxy-a --metas --sem-filme
      rodar "carga 4G (HTTP/2 + brotli): hall-lento (galaxy-a)" env LENDA_URL="https://127.0.0.1:$PH2/lenda/" LENDA_IGNORAR_TLS=1 LENDA_TLS_SPKI="$SPKI" node "$M/hall-lento.mjs" --aparelho galaxy-a
      kill "$(cat "$BASE/h2.pid")" 2>/dev/null ;;
    *) echo "área desconhecida: $a" ;;
  esac
done
if grep -q "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" 2>/dev/null; then
  echo "  XX  erro fatal no PHP:"; grep "PHP \(Fatal\|Parse\)" "$BASE/php-erros.log" | head -5
  NOMES+=("php-erros.log sem Fatal/Parse"); CODIGOS+=(1); TEMPOS+=(0)
fi
resumo
