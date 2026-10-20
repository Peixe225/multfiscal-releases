#!/usr/bin/env node
/**
 * Conferência das regras novas das conquistas (servidor/CONTRATO-v34.md §K) contra o CÓDIGO do jogo: joga de novo, com
 * dois pacotes do motor, carreiras do estudo de raridade (as mesmas sementes, identidades, ritmos e políticas) e confere
 *   1. que o motor não mudou: todos os números da carreira são iguais nos dois pacotes (menos a lista de conquistas e o tempo);
 *   2. que as conquistas que NÃO mudaram de regra são as mesmas nos dois;
 *   3. que, no pacote novo, cada conquista que mudou sai exatamente quando a regra da calibração (calibracao-v34-escolha.json
 *      + calibracao-v34-regras.mjs) diz que sai.
 *
 *   node scripts/estudos/raridade.mjs pacote --destino <a>                      (o motor de antes das regras novas)
 *   node scripts/estudos/raridade.mjs pacote --destino <b> [--motor <cópia>/scripts/estudos/raridade-motor.ts]
 *   node scripts/estudos/conferir-v34.mjs --antigo <a>/motor.mjs --novo <b>/motor.mjs --dados <pastas> [--n 400]
 *
 * Entram todas as carreiras do estudo (com os números da v3.4) que cumprem alguma regra nova; depois, até `--n`, as que
 * ficam a um passo dela e carreiras sorteadas. Sai com código 1 se alguma conferência falhar.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FAMILIAS } from './calibracao-v34-regras.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const DADOS = join(AQUI, '../../src/data/generated/game-data.json')
const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}
if (!opt('antigo') || !opt('novo') || !opt('dados')) {
  console.log('uso: node scripts/estudos/conferir-v34.mjs --antigo <motor.mjs> --novo <motor.mjs> --dados <pasta>[,<pasta>] [--n 400]')
  process.exit(1)
}
const ESCOLHA = JSON.parse(readFileSync(join(AQUI, 'calibracao-v34-escolha.json'), 'utf8'))
const MUDARAM = Object.keys(ESCOLHA.conquistas)
const N = Number(opt('n', '400'))

const antigo = await import(pathToFileURL(resolve(opt('antigo'))).href)
const novo = await import(pathToFileURL(resolve(opt('novo'))).href)
const data = JSON.parse(readFileSync(DADOS, 'utf8'))
const IDS_A = antigo.IDS_CONQUISTAS
const IDS_N = novo.IDS_CONQUISTAS
if (JSON.stringify(IDS_A) !== JSON.stringify(IDS_N)) throw new Error('as duas listas de conquistas têm ids diferentes')

// as carreiras do estudo (só as que guardam os números crus da v3.4), sem oráculo nem bônus
const linhas = []
for (const pasta of opt('dados').split(',')) {
  // o v34-nom rodou com a 1ª versão da política do nômade (o raridade-motor.ts de hoje joga outra): não dá para repetir
  for (const f of readdirSync(pasta).filter((x) => x.endsWith('.jsonl') && x !== 'v34-nom.jsonl' && !x.startsWith('pil'))) {
    for (const l of readFileSync(join(pasta, f), 'utf8').split('\n')) {
      if (!l.trim()) continue
      let r
      try {
        r = JSON.parse(l)
      } catch {
        continue
      }
      if (r.erro || r.rec === undefined || r.bonus || r.pol === 'oraculo') continue
      r.v34 = true
      r.hoje = new Set(r.conq.map((i) => IDS_A[i]))
      linhas.push(r)
    }
  }
}
// as que cumprem uma regra nova ou ficam a um passo (o limite de antes do de agora na grade), depois sorteadas
const perto = (r) =>
  MUDARAM.some((id) => {
    const fam = FAMILIAS[id]
    if (fam.pred(ESCOLHA.conquistas[id].parametros)(r)) return true
    const g = fam.grade
    const i = g.findIndex((q) => JSON.stringify(q) === JSON.stringify(ESCOLHA.conquistas[id].parametros))
    return i + 1 < g.length && !!fam.pred(g[i + 1])(r)
  })
// primeiro as que cumprem alguma regra nova (todas), depois as que ficam a um passo, depois sorteadas, até `--n`
const cumpre = (r) => MUDARAM.some((id) => !!FAMILIAS[id].pred(ESCOLHA.conquistas[id].parametros)(r))
const escolhidas = [...linhas.filter(cumpre), ...linhas.filter((r) => !cumpre(r) && perto(r))]
let s = 12345
const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296)
const resto = linhas.filter((r) => !perto(r))
while (escolhidas.length < N && resto.length) escolhidas.push(resto.splice(Math.floor(rnd() * resto.length), 1)[0])
const alvo = escolhidas.slice(0, Math.max(N, linhas.filter(cumpre).length))

let falhas = 0
const porId = Object.fromEntries(MUDARAM.map((id) => [id, { sim: 0, nao: 0, erradas: 0 }]))
const t0 = Date.now()
for (const [j, r] of alvo.entries()) {
  const cfg = { a0: r.a0, a1: r.a1, nat: r.nat, pos: r.pos, pace: r.pace, pol: r.pol, bonus: r.bonus ?? 0 }
  const a = antigo.jogar(data, cfg, false)
  const b = novo.jogar(data, cfg, false)
  const sem = (x) => JSON.stringify({ ...x, conq: 0, ms: 0 })
  if (sem(a) !== sem(b)) {
    falhas++
    console.log(`MOTOR MUDOU na carreira ${JSON.stringify(cfg)}`)
    continue
  }
  // a mesma carreira que o estudo gravou (reprodutível)
  if (a.copas !== r.copas || a.gols !== r.gols || a.lib !== r.lib || a.clubes !== r.clubes) {
    falhas++
    console.log(`NÃO REPETIU a carreira gravada ${JSON.stringify(cfg)}`)
  }
  const ca = new Set(a.conq.map((i) => IDS_A[i]))
  const cb = new Set(b.conq.map((i) => IDS_N[i]))
  for (const id of IDS_A) {
    if (MUDARAM.includes(id)) continue
    if (ca.has(id) !== cb.has(id)) {
      falhas++
      console.log(`"${id}" (regra que não mudou) diferente em ${JSON.stringify(cfg)}`)
    }
  }
  const x = { ...a, v34: true, hoje: ca }
  for (const id of MUDARAM) {
    const deve = !!FAMILIAS[id].pred(ESCOLHA.conquistas[id].parametros)(x)
    porId[id][deve ? 'sim' : 'nao']++
    if (deve !== cb.has(id)) {
      falhas++
      porId[id].erradas++
      console.log(`"${id}": a regra da calibração diz ${deve ? 'sim' : 'não'}, o código novo diz ${cb.has(id) ? 'sim' : 'não'} em ${JSON.stringify(cfg)}`)
    }
  }
  if ((j + 1) % 50 === 0) console.log(`${j + 1}/${alvo.length} em ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
console.log(JSON.stringify(porId))
console.log(falhas ? `FALHOU: ${falhas} diferença(s) em ${alvo.length} carreiras` : `OK: ${alvo.length} carreiras jogadas de novo; motor igual, conquistas de antes iguais e as ${MUDARAM.length} regras novas batem com a calibração`)
process.exitCode = falhas ? 1 : 0
