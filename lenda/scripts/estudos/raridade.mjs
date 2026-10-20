#!/usr/bin/env node
/**
 * Estudo de raridade das Taças do Rei (servidor/CONTRATO-v33.md §R).
 *
 *   node scripts/estudos/raridade.mjs simular --plano padrao --saida <pasta> [--workers 3] [--n 1000]
 *   node scripts/estudos/raridade.mjs analisar --saida <pasta>        (lê <pasta>/*.jsonl e escreve <pasta>/resumo.json)
 *   node scripts/estudos/raridade.mjs tabela-conquistas --saida <pasta>   (a tabela das 87 conquistas em <pasta>/conquistas.md)
 *
 * `simular` empacota scripts/estudos/raridade-motor.ts (o motor REAL do jogo, src/engine, e os dados reais
 * src/data/generated/game-data.json) com o rolldown numa pasta temporária, reparte as carreiras entre workers e grava
 * uma linha JSON por carreira em <pasta>/<plano>-<lote>.jsonl. Retoma de onde parou (pula as linhas que já existem).
 * Nada em src/ muda; a pasta de saída e a temporária ficam fora do repositório (padrão: o tmpdir do sistema).
 *
 * Planos:
 *   padrao     o estudo principal: aleatória, gananciosa e caçador × nacionalidades × posições × ritmos (sem bônus);
 *   extra      a melhor estratégia com amostra maior: caçador argentino (5.000) e guloso espanhol (3.000);
 *   bonus      o caçador com bônus de OVR +2 e +5 (o que um jogador ganha compartilhando e indicando);
 *   alvos      as políticas de alvo (mochileiro, sul-americano, fiel, europeu) para as conquistas de carreira montada;
 *   alvos2     o artilheiro (atacantes) e o goleiro guloso (goleiros), para as conquistas de gols e de goleiro;
 *   oraculo    o caçador que prova cada opção antes de escolher (o teto de quem "volta no tempo");
 *   sementes   as mesmas sementes com três políticas (quanto do mundo, como quem ganha cada Copa, vem só da semente);
 *   condicional  joga de novo nas sementes cujo mundo deu 2 ou 3+ Copas a uma seleção (roda por último: lê os outros);
 *   rapido     60 carreiras, para conferir que tudo roda.
 *   v34        a calibração da v3.4 (servidor/CONTRATO-v34.md §K): aleatória, caçador sul-americano, guloso das Copas e as
 *              políticas novas (goleador, chuteira, recordista, nômade) mais mochileiro e sul-americano no Intenso;
 *   v34piloto  ~100 carreiras de cada política nova, para conferir antes da rodada grande;
 *   v34b       a segunda leva da v3.4 (sementes novas nos planos que decidem os limites novos e o Desafio do Rei).
 *
 * O pacote do motor ganha uma troca só de desempenho (`acelerar`): o `clubTitles` do src/engine/world/awards.ts (20% do
 * tempo) percorria todas as copas para cada candidato a prêmio; no pacote ele lê um índice por clube montado uma vez por
 * temporada, na mesma ordem. O resultado é idêntico (`node scripts/estudos/raridade.mjs conferir-pacote` joga as mesmas
 * carreiras com e sem a troca e compara tudo); `--sem-acelerar` desliga. Nada em src/ muda.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '../..')
const DADOS = join(RAIZ, 'src/data/generated/game-data.json')

// ───────────────────────────── worker ─────────────────────────────

if (!isMainThread) {
  const { pacote, tarefas, picksSe } = workerData
  const mod = await import(pathToFileURL(pacote).href)
  const data = JSON.parse(readFileSync(DADOS, 'utf8'))
  for (const t of tarefas) {
    let res
    try {
      res = mod.jogar(data, t.cfg, false)
      // carreira rara: joga de novo guardando as escolhas (para repetir no navegador)
      if (picksSe && (res.copas >= 3 || (res.copas >= 2 && res.lib >= 2))) res = { ...mod.jogar(data, t.cfg, true), ms: res.ms }
    } catch (err) {
      res = { erro: String(err?.stack ?? err).slice(0, 400), ...t.cfg }
    }
    parentPort.postMessage({ k: t.k, res })
  }
  parentPort.postMessage({ fim: true })
  process.exit(0)
}

// ───────────────────────────── principal ─────────────────────────────

const args = process.argv.slice(2)
const cmd = args[0]
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}

/** mulberry32 (o mesmo do jogo) para sortear as configurações de forma reprodutível. */
function rngDe(n) {
  let s = n >>> 0 || 0x9e3779b9
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const u32 = (r) => Math.floor(r() * 4294967296) >>> 0

const POSICOES = ['GOL', 'ZAG', 'LD', 'LE', 'VOL', 'MC', 'ME', 'MD', 'MEI', 'PE', 'PD', 'CA']
const RITMOS = ['intensa', 'normal', 'expressa']
/** As do pedido (Brasil, Argentina, Uruguai, Colômbia, Portugal, Espanha, França) e outras de vários tamanhos. */
const NACOES_PRINCIPAIS = ['BRA', 'ARG', 'URU', 'COL', 'POR', 'ESP', 'FRA']
const NACOES_OUTRAS = ['ENG', 'GER', 'ITA', 'NED', 'BEL', 'MEX', 'USA', 'JPN', 'MAR', 'SEN', 'CHI', 'ECU', 'PAR', 'CRO', 'NGA']
/** v3.4: as posições do caçador e do guloso, puxadas para o ataque (Bolas de Ouro e nota), sem tirar as outras. */
const POS_CAC = ['CA', 'PE', 'PD', 'MEI', 'CA', 'MC', 'ZAG', 'GOL']

/**
 * Um lote = uma política com uma lista de nacionalidades, todas as posições e todos os ritmos (em ciclo, para ficar
 * equilibrado). `n` carreiras por lote; a semente de cada uma sai do índice (reprodutível).
 */
function planos(nBase) {
  const n = (x) => Math.max(1, Math.round(x * nBase))
  return {
    rapido: [
      { nome: 'rapido-ale', pol: 'aleatoria', nacoes: ['BRA', 'ARG'], n: 20, bonus: 0 },
      { nome: 'rapido-gan', pol: 'gananciosa', nacoes: ['BRA', 'FRA'], n: 20, bonus: 0 },
      { nome: 'rapido-cac', pol: 'cacador', nacoes: ['BRA', 'ARG'], n: 20, bonus: 0 },
    ],
    padrao: [
      { nome: 'ale-principais', pol: 'aleatoria', nacoes: NACOES_PRINCIPAIS, n: n(3500), bonus: 0 },
      { nome: 'ale-outras', pol: 'aleatoria', nacoes: NACOES_OUTRAS, n: n(1500), bonus: 0 },
      { nome: 'gan-principais', pol: 'gananciosa', nacoes: NACOES_PRINCIPAIS, n: n(3500), bonus: 0 },
      { nome: 'gan-outras', pol: 'gananciosa', nacoes: NACOES_OUTRAS, n: n(1500), bonus: 0 },
      { nome: 'cac-sul', pol: 'cacador', nacoes: ['BRA', 'ARG', 'URU', 'COL'], n: n(6000), bonus: 0 },
      { nome: 'cac-outras', pol: 'cacador', nacoes: ['POR', 'ESP', 'FRA', 'ECU', 'CHI', 'PAR'], n: n(2000), bonus: 0 },
    ],
    alvos: [
      { nome: 'alvo-mochileiro', pol: 'mochileiro', nacoes: ['BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX', 'USA', 'MAR'], n: n(500), bonus: 0, ritmos: ['intensa'] },
      { nome: 'alvo-sul', pol: 'sulamericano', nacoes: ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'ECU'], n: n(500), bonus: 0, ritmos: ['intensa'] },
      { nome: 'alvo-fiel', pol: 'fiel', nacoes: ['BRA', 'ARG', 'ESP', 'ENG', 'GER', 'ITA', 'FRA', 'POR'], n: n(400), bonus: 0 },
      { nome: 'alvo-europeu', pol: 'europeu', nacoes: ['ESP', 'ENG', 'FRA', 'GER', 'ITA', 'BRA', 'ARG', 'POR'], n: n(500), bonus: 0, ritmos: ['intensa', 'normal'] },
    ],
    alvos2: [
      { nome: 'alvo-artilheiro', pol: 'artilheiro', nacoes: ['BRA', 'ARG', 'ESP', 'FRA', 'ENG', 'POR'], n: n(500), bonus: 0, posicoes: ['CA', 'PE', 'PD', 'CA'] },
      { nome: 'alvo-goleiro', pol: 'gananciosa', nacoes: ['ESP', 'FRA', 'ENG', 'GER', 'BRA', 'ARG', 'ITA', 'POR'], n: n(400), bonus: 0, posicoes: ['GOL'] },
    ],
    // a melhor estratégia de cada desafio, com amostra maior (as 3 Copas são raras demais para a amostra comum)
    extra: [
      { nome: 'cac-arg', pol: 'cacador', nacoes: ['ARG'], n: n(5000), bonus: 0 },
      { nome: 'gan-esp', pol: 'gananciosa', nacoes: ['ESP'], n: n(3000), bonus: 0 },
    ],
    bonus: [
      { nome: 'cac-bonus2', pol: 'cacador', nacoes: ['BRA', 'ARG'], n: n(1000), bonus: 2 },
      { nome: 'cac-bonus5', pol: 'cacador', nacoes: ['BRA', 'ARG'], n: n(1000), bonus: 5 },
    ],
    oraculo: [{ nome: 'ora-sul', pol: 'oraculo', nacoes: ['BRA', 'ARG'], n: n(800), bonus: 0 }],
    // v3.4 (§K): a calibração das conquistas raras, dos desafios de emblema e do Desafio do Rei
    // (as de alvo primeiro: decidem os limites novos; depois as do Desafio do Rei e das Copas, a aleatória e o resto).
    // A ordem e os tamanhos mudaram no meio da rodada (o recordista sul-americano atacante e o artilheiro europeu foram os
    // melhores planos para as Copas: entraram v34-rec2 e v34-chut-copa; o caçador e o guloso diminuíram); os lotes já
    // feitos continuam iguais (cada lote tem as suas sementes, pelo nome); o v34x-nom foi para o fim (a Nômade de 5
    // confederações já sai com o mochileiro marroquino)
    v34: [
      { nome: 'v34-gol', pol: 'goleador', nacoes: ['BRA', 'ARG', 'URU', 'COL'], n: n(2500), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-chut', pol: 'chuteira', nacoes: ['ESP', 'FRA', 'ENG', 'POR', 'BRA', 'ARG'], n: n(1500), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-rec', pol: 'recordista', nacoes: ['ARG', 'BRA'], n: n(1000), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-nom', pol: 'nomade', nacoes: ['BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX', 'USA', 'MAR', 'SEN', 'FRA'], n: n(1000), bonus: 0, ritmos: ['intensa'] },
      { nome: 'v34-moc', pol: 'mochileiro', nacoes: ['BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX', 'USA', 'MAR'], n: n(1000), bonus: 0, ritmos: ['intensa'] },
      { nome: 'v34-sul', pol: 'sulamericano', nacoes: ['BRA', 'ARG', 'URU', 'COL', 'CHI', 'PAR', 'ECU'], n: n(1000), bonus: 0, ritmos: ['intensa'] },
      { nome: 'v34-rec2', pol: 'recordista', nacoes: ['ARG', 'BRA'], n: n(4000), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-chut-copa', pol: 'chuteira', nacoes: ['ESP', 'FRA', 'ENG'], n: n(2500), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-cac-arg', pol: 'cacador', nacoes: ['ARG'], n: n(3000), bonus: 0, posicoes: POS_CAC },
      { nome: 'v34-ale', pol: 'aleatoria', nacoes: [...NACOES_PRINCIPAIS, ...NACOES_OUTRAS], n: n(2500), bonus: 0 },
      { nome: 'v34-gan-esp', pol: 'gananciosa', nacoes: ['ESP'], n: n(1500), bonus: 0, posicoes: POS_CAC },
      { nome: 'v34x-gol-col', pol: 'goleador', nacoes: ['COL'], n: n(1200), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34x-gol-sul', pol: 'goleador', nacoes: ['ECU', 'PAR', 'CHI', 'PER', 'VEN', 'BOL'], n: n(900), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34-cac-bra', pol: 'cacador', nacoes: ['BRA'], n: n(800), bonus: 0, posicoes: POS_CAC },
      { nome: 'v34-fiel', pol: 'fiel', nacoes: ['BRA', 'ARG', 'ESP', 'ENG', 'GER', 'ITA', 'FRA', 'POR'], n: n(400), bonus: 0 },
      { nome: 'v34-eur', pol: 'europeu', nacoes: ['ESP', 'ENG', 'FRA', 'GER', 'ITA', 'BRA', 'ARG', 'POR'], n: n(400), bonus: 0, ritmos: ['intensa', 'normal'] },
      { nome: 'v34-gk', pol: 'gananciosa', nacoes: ['ESP', 'FRA', 'ENG', 'GER', 'BRA', 'ARG', 'ITA', 'POR'], n: n(400), bonus: 0, posicoes: ['GOL'] },
      { nome: 'v34x-nom', pol: 'nomade', nacoes: ['MAR', 'SEN', 'USA', 'MEX'], n: n(1600), bonus: 0, ritmos: ['intensa'] },
    ],
    // v3.4, segunda leva (servidor/CONTRATO-v34.md §K): amostras novas, com sementes novas, nos planos que decidem os
    // limites novos e o Desafio do Rei, na ordem do que decide mais (o goleiro sul-americano é quem mais muda de país na
    // América do Sul; o caçador argentino de meio e de ataque é o plano da GOAT, do Futebol completo e do Rei; o caçador
    // espanhol junta a seleção que mais ganha Copas, 19%, com as Libertadores de um clube sul-americano)
    v34b: [
      { nome: 'v34b-sul-gk', pol: 'sulamericano', nacoes: ['PAR', 'ARG', 'COL', 'ECU', 'CHI', 'BRA', 'URU'], n: n(2000), bonus: 0, ritmos: ['intensa'], posicoes: ['GOL'] },
      // o goleiro argentino quase não sai da Argentina (0 de 286 com 8 países): a segunda amostra é sem ele
      { nome: 'v34b-sul-gk2', pol: 'sulamericano', nacoes: ['PAR', 'COL', 'ECU', 'CHI', 'BRA', 'URU'], n: n(2500), bonus: 0, ritmos: ['intensa'], posicoes: ['GOL'] },
      { nome: 'v34b-chut', pol: 'chuteira', nacoes: ['ENG', 'ESP'], n: n(2000), bonus: 0, posicoes: ['CA', 'CA', 'PE'] },
      { nome: 'v34b-rec-bra', pol: 'recordista', nacoes: ['BRA'], n: n(2000), bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'v34b-moc', pol: 'mochileiro', nacoes: ['MAR', 'BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX', 'USA'], n: n(1500), bonus: 0, ritmos: ['intensa'], posicoes: ['MEI', 'MC', 'CA', 'PE'] },
      { nome: 'v34b-cac-arg', pol: 'cacador', nacoes: ['ARG'], n: n(2000), bonus: 0, posicoes: ['MC', 'MEI', 'CA', 'PE'] },
      { nome: 'v34b-cac-esp', pol: 'cacador', nacoes: ['ESP'], n: n(1200), bonus: 0, posicoes: POS_CAC },
      { nome: 'v34b-sul', pol: 'sulamericano', nacoes: ['PAR', 'ARG', 'COL'], n: n(800), bonus: 0, ritmos: ['intensa'] },
    ],
    v34piloto: [
      { nome: 'pil-gol', pol: 'goleador', nacoes: ['BRA', 'ARG', 'ESP', 'FRA'], n: 96, bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'pil-art', pol: 'artilheiro', nacoes: ['BRA', 'ARG', 'ESP', 'FRA'], n: 96, bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'pil-chut', pol: 'chuteira', nacoes: ['ESP', 'FRA', 'BRA', 'ARG'], n: 96, bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'pil-rec', pol: 'recordista', nacoes: ['ARG', 'BRA', 'ESP', 'FRA'], n: 96, bonus: 0, posicoes: ['CA', 'CA', 'PE', 'PD'] },
      { nome: 'pil-nom', pol: 'nomade', nacoes: ['BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX'], n: 96, bonus: 0, ritmos: ['intensa'] },
    ],
    v34piloto2: [
      { nome: 'pil4-nom', pol: 'nomade', nacoes: ['BRA', 'ARG', 'ENG', 'ESP', 'JPN', 'MEX', 'USA', 'MAR'], n: 96, bonus: 0, ritmos: ['intensa'], posicoes: ['CA', 'PE', 'MEI', 'PD'] },
    ],
    // as MESMAS sementes com políticas diferentes: quanto do mundo (quem ganha cada Copa) já vem da semente
    sementes: ['aleatoria', 'gananciosa', 'cacador'].map((pol) => ({ nome: `sem-${pol}`, sal: 'sementes', pol, nacoes: ['ARG', 'BRA', 'ESP', 'FRA'], n: n(240), bonus: 0 })),
  }
}

function configs(lote, salt) {
  if (lote.tarefas) return lote.tarefas
  const out = []
  const ritmos = lote.ritmos ?? RITMOS
  const posicoes = lote.posicoes ?? POSICOES
  for (let i = 0; i < lote.n; i++) {
    const r = rngDe(Math.imul(i + 1, 2654435761) ^ salt)
    const a0 = u32(r)
    const a1 = u32(r)
    out.push({
      k: i,
      cfg: {
        a0,
        a1,
        nat: lote.nacoes[i % lote.nacoes.length],
        pos: posicoes[Math.floor(i / lote.nacoes.length) % posicoes.length],
        pace: ritmos[Math.floor(i / (lote.nacoes.length * posicoes.length)) % ritmos.length],
        pol: lote.pol,
        bonus: lote.bonus,
      },
    })
  }
  return out
}

function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Troca só de desempenho no pacote (o src/ não muda): o `clubTitles` do motor do mundo percorre todas as copas da
 * temporada para cada candidato a prêmio (milhares por temporada). Aqui ele lê um índice por clube, montado uma vez por
 * `env` (uma temporada) na mesma ordem das copas, então devolve as mesmas listas na mesma ordem (cópias novas a cada
 * chamada). Sem o trecho esperado no pacote, avisa e segue sem a troca.
 */
const CLUB_TITLES_ORIGINAL = `\t\tfor (const cup of Object.values(env.result.cups)) if (cup.winner === clubId) titles.push(cup.competitionId);
\t\telse if (cup.reached[clubId]) reached[cup.competitionId] = cup.reached[clubId];`
const CLUB_TITLES_INDICE = `\t\tlet __ix = __CUP_IX.get(env);
\t\tif (!__ix || __ix.src !== env.result.cups) {
\t\t\tconst m = new Map();
\t\t\tconst at = (k) => { let e = m.get(k); if (!e) m.set(k, (e = { titles: [], reached: [] })); return e; };
\t\t\tfor (const cup of Object.values(env.result.cups)) {
\t\t\t\tif (cup.winner) at(cup.winner).titles.push(cup.competitionId);
\t\t\t\tfor (const k of Object.keys(cup.reached)) if (k !== cup.winner && cup.reached[k]) at(k).reached.push([cup.competitionId, cup.reached[k]]);
\t\t\t}
\t\t\t__ix = { src: env.result.cups, m };
\t\t\t__CUP_IX.set(env, __ix);
\t\t}
\t\tconst __e = __ix.m.get(clubId);
\t\tif (__e) {
\t\t\tfor (const t of __e.titles) titles.push(t);
\t\t\tfor (const [c, r] of __e.reached) reached[c] = r;
\t\t}`

function acelerarPacote(arq) {
  const src = readFileSync(arq, 'utf8')
  const i = src.indexOf(CLUB_TITLES_ORIGINAL)
  if (i < 0 || src.indexOf(CLUB_TITLES_ORIGINAL, i + 1) >= 0) {
    console.warn('aviso: clubTitles não encontrado (uma vez só) no pacote; seguindo sem acelerar')
    return false
  }
  const out = src.slice(0, i) + CLUB_TITLES_INDICE + src.slice(i + CLUB_TITLES_ORIGINAL.length)
  writeFileSync(arq, out.replace('function clubTitles(env, clubId, nationality) {', 'const __CUP_IX = new WeakMap();\nfunction clubTitles(env, clubId, nationality) {'))
  return true
}

async function empacotar(acelerar = !args.includes('--sem-acelerar'), sufixo = '') {
  const { build } = await import('rolldown')
  const pasta = join(process.env.LENDA_ESTUDO_TMP || tmpdir(), `lenda-raridade-${process.pid}${sufixo}`)
  mkdirSync(pasta, { recursive: true })
  // --motor <cópia>/scripts/estudos/raridade-motor.ts: empacota uma cópia da árvore (ex.: com as regras novas das conquistas,
  // para conferir a calibração contra o código antes de alguém mexer no src/ de verdade); o '@' aponta para o src da cópia
  const motor = opt('motor', null) ? resolve(opt('motor', null)) : join(AQUI, 'raridade-motor.ts')
  await build({
    input: motor,
    platform: 'node',
    resolve: { alias: { '@': join(dirname(motor), '../../src') } },
    output: { dir: pasta, format: 'esm', entryFileNames: 'motor.mjs', codeSplitting: false },
    logLevel: 'warn',
  })
  const pacote = join(pasta, 'motor.mjs')
  if (acelerar) acelerarPacote(pacote)
  return { pasta, pacote }
}

/**
 * Confere a troca de desempenho: as mesmas carreiras (várias políticas, ritmos e posições) no pacote original e no
 * acelerado, comparando a linha inteira do resultado (menos o tempo). `--n` carreiras (padrão 24).
 */
async function conferirPacote() {
  const a = await empacotar(false, '-orig')
  const b = await empacotar(true, '-acel')
  try {
    const ma = await import(pathToFileURL(a.pacote).href)
    const mb = await import(pathToFileURL(b.pacote).href)
    const data = JSON.parse(readFileSync(DADOS, 'utf8'))
    const pols = ['aleatoria', 'cacador', 'gananciosa', 'goleador', 'chuteira', 'recordista', 'nomade', 'mochileiro']
    const n = Number(opt('n', '24'))
    let iguais = 0
    let ta = 0
    let tb = 0
    for (let i = 0; i < n; i++) {
      const r = rngDe(9000 + i)
      const cfg = { a0: u32(r), a1: u32(r), nat: NACOES_PRINCIPAIS[i % 7], pos: POSICOES[(i * 5) % 12], pace: RITMOS[i % 3], pol: pols[i % pols.length], bonus: i % 6 === 5 ? 3 : 0 }
      const x = ma.jogar(data, cfg, true)
      const y = mb.jogar(data, cfg, true)
      ta += x.ms
      tb += y.ms
      const sem = (o) => JSON.stringify({ ...o, ms: 0 })
      if (sem(x) === sem(y)) iguais++
      else console.log('DIFERENTE', JSON.stringify(cfg))
    }
    console.log(`${iguais}/${n} carreiras idênticas; tempo ${(ta / n).toFixed(0)} ms → ${(tb / n).toFixed(0)} ms por carreira`)
    if (iguais !== n) process.exitCode = 1
  } finally {
    rmSync(a.pasta, { recursive: true, force: true })
    rmSync(b.pasta, { recursive: true, force: true })
  }
}

/**
 * v3.4: `pacote --destino <pasta>` monta o pacote do motor e o deixa lá (o `simular --pacote <pasta>/motor.mjs` usa esse
 * pacote em vez de montar outro e não o apaga). Assim uma rodada longa, retomada depois, joga sempre com o MESMO motor e as
 * MESMAS regras de conquista, mesmo que alguém mude o src/ no meio.
 */
async function pacoteFixo() {
  const destino = resolve(opt('destino', join(tmpdir(), 'lenda-raridade-pacote')))
  const { pasta, pacote } = await empacotar()
  mkdirSync(destino, { recursive: true })
  writeFileSync(join(destino, 'motor.mjs'), readFileSync(pacote))
  rmSync(pasta, { recursive: true, force: true })
  console.log(`pacote: ${join(destino, 'motor.mjs')}`)
}

async function simular() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  mkdirSync(saida, { recursive: true })
  const nBase = Number(opt('n', '1000')) / 1000
  const plano = opt('plano', 'rapido')
  const todosLotes = plano === 'condicional' ? planoCondicional(saida, nBase) : planos(nBase)[plano]
  if (!todosLotes) throw new Error(`plano desconhecido: ${plano}`)
  // --lotes a,b: só esses lotes do plano (na ordem do plano), para rodar primeiro o que decide mais
  const soLotes = opt('lotes', null)
  const lotes = soLotes ? todosLotes.filter((l) => soLotes.split(',').includes(l.nome)) : todosLotes
  const nw = Math.max(1, Number(opt('workers', String(Math.max(1, cpus().length - 1)))))
  const fixo = opt('pacote', null)
  const { pasta, pacote } = fixo ? { pasta: null, pacote: resolve(fixo) } : await empacotar()
  try {
    for (const lote of lotes) {
      const arq = join(saida, `${lote.nome}.jsonl`)
      const feitos = new Set()
      if (existsSync(arq))
        for (const l of readFileSync(arq, 'utf8').split('\n')) {
          if (!l.trim()) continue
          try {
            feitos.add(JSON.parse(l).k)
          } catch {}
        }
      const todas = configs(lote, hash(lote.sal ?? lote.nome)).filter((t) => !feitos.has(t.k))
      if (!todas.length) {
        console.log(`${lote.nome}: já completo (${feitos.size})`)
        continue
      }
      const t0 = Date.now()
      let feitas = 0
      const partes = Array.from({ length: nw }, (_, w) => todas.filter((_, i) => i % nw === w)).filter((p) => p.length)
      await Promise.all(
        partes.map(
          (tarefas) =>
            new Promise((ok, falha) => {
              const w = new Worker(fileURLToPath(import.meta.url), { workerData: { pacote, tarefas, picksSe: true } })
              w.on('message', (m) => {
                if (m.fim) return
                appendFileSync(arq, JSON.stringify({ k: m.k, ...m.res }) + '\n')
                feitas++
                if (feitas % 200 === 0 || feitas === todas.length) {
                  const s = (Date.now() - t0) / 1000
                  console.log(`${lote.nome}: ${feitas}/${todas.length} em ${s.toFixed(0)} s (${((s / feitas) * nw).toFixed(2)} s por carreira por núcleo)`)
                }
              })
              w.on('error', falha)
              w.on('exit', (c) => (c === 0 ? ok() : falha(new Error(`worker saiu com ${c}`))))
            }),
        ),
      )
    }
  } finally {
    if (pasta) rmSync(pasta, { recursive: true, force: true })
  }
}

/**
 * Plano "condicional" (para medir o que é raro demais para a amostra comum): quem ganha cada Copa vem quase todo da
 * semente (ver o plano "sementes"). Então P(3 Copas) = Σ_k P(o mundo dá k Copas à seleção) × P(3 Copas | mundos com
 * k). Este plano pega, das carreiras já simuladas, sementes cujo mundo deu 2 ou 3+ Copas a cada seleção e joga de
 * novo nelas com um jogador dessa seleção (várias posições e ritmos); a análise junta com a frequência de cada k em
 * todos os mundos simulados.
 */
function planoCondicional(saida, nBase) {
  const tudo = lerTudo(saida).filter((r) => !r.lote.startsWith('cond-') && Array.isArray(r.wc) && r.wc.length >= 6)
  // [seleção, política, sementes no máximo]: o caçador nas sul-americanas (Copas + Libertadores), o guloso nas outras
  // (só Copas) e o oráculo na Argentina (o teto de quem prova as opções)
  const NACOES = [
    ['ARG', 'cacador', 60],
    ['BRA', 'cacador', 60],
    ['ESP', 'gananciosa', 60],
    ['FRA', 'gananciosa', 60],
    ['ENG', 'gananciosa', 60],
    ['ARG', 'oraculo', 25],
  ]
  const porSeed = 6
  const lotes = []
  for (const [nat, pol, maxBase] of NACOES)
    for (const k of [2, 3]) {
      const max = Math.max(1, Math.round(maxBase * nBase))
      const vistas = new Set()
      const sementes = []
      for (const r of tudo) {
        const c = r.wc.filter((x) => x === nat).length
        const chave = `${r.a0}.${r.a1}`
        if ((k === 3 ? c >= 3 : c === 2) && !vistas.has(chave)) {
          vistas.add(chave)
          sementes.push([r.a0, r.a1])
        }
      }
      const tarefas = []
      for (const [j, [a0, a1]] of sementes.slice(0, max).entries())
        for (let q = 0; q < porSeed; q++) {
          const i = j * porSeed + q
          tarefas.push({ k: i, cfg: { a0, a1, nat, pos: POSICOES[(i * 5 + j) % POSICOES.length], pace: RITMOS[(q + j) % RITMOS.length], pol, bonus: 0 } })
        }
      lotes.push({ nome: `cond-${nat}-k${k}-${pol}`, pol, nacoes: [nat], n: tarefas.length, bonus: 0, tarefas, sementes: sementes.length })
      console.log(`cond-${nat}-k${k}-${pol}: ${sementes.length} sementes com o mundo dando ${k === 3 ? '3+' : '2'} Copas, ${tarefas.length} carreiras`)
    }
  return lotes
}

// ───────────────────────────── análise ─────────────────────────────

function lerTudo(saida) {
  const out = []
  for (const f of readdirSync(saida).filter((x) => x.endsWith('.jsonl')).sort()) {
    const lote = f.replace(/\.jsonl$/, '')
    for (const l of readFileSync(join(saida, f), 'utf8').split('\n')) {
      if (!l.trim()) continue
      const r = JSON.parse(l)
      if (r.erro) continue
      r.lote = lote
      out.push(r)
    }
  }
  return out
}

/** Intervalo de Wilson (95%) para uma proporção. */
function wilson(k, n) {
  if (!n) return [0, 0]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}

function taxa(lista, f) {
  const k = lista.filter(f).length
  const n = lista.length
  const [lo, hi] = wilson(k, n)
  return { k, n, p: n ? k / n : 0, lo, hi }
}

function grupo(lista, chave) {
  const m = new Map()
  for (const r of lista) {
    const k = chave(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

const C3 = (r) => r.copas >= 3
const L2 = (r) => r.lib >= 2
const C3L2 = (r) => r.copas >= 3 && r.lib >= 2
const C2L2 = (r) => r.copas >= 2 && r.lib >= 2
const C2 = (r) => r.copas >= 2
const C3L1 = (r) => r.copas >= 3 && r.lib >= 1
const C2L1 = (r) => r.copas >= 2 && r.lib >= 1
const C4 = (r) => r.copas >= 4
const L3 = (r) => r.lib >= 3

const C3L3 = (r) => r.copas >= 3 && r.lib >= 3
const C4L2 = (r) => r.copas >= 4 && r.lib >= 2
const CRITERIOS = { C2, C3, C4, L2, L3, C2L1, C2L2, C3L1, C3L2, C3L3, C4L2 }

/**
 * Minutos por carreira, por ritmo. "calmo": as gravações de scripts/gravar (o robô clicando com as animações, da
 * abertura ao card final: Expressa 91–164 s, Normal 130–185 s, Intensa 285–503 s) com folga para ler os cartões;
 * "rapido": animações puladas (Configurações → pular animações / "Pular"), de quem já conhece o jogo.
 */
const MIN_POR_CARREIRA = { expressa: { rapido: 1, calmo: 2.5 }, normal: { rapido: 1.5, calmo: 3.5 }, intensa: { rapido: 3, calmo: 7 }, todos: { rapido: 1.8, calmo: 4.3 } }

function resumoDe(lista) {
  const o = { n: lista.length }
  for (const [k, f] of Object.entries(CRITERIOS)) o[k] = taxa(lista, f)
  o.copasMedia = lista.reduce((t, r) => t + r.copas, 0) / Math.max(1, lista.length)
  o.libMedia = lista.reduce((t, r) => t + r.lib, 0) / Math.max(1, lista.length)
  o.notaMedia = lista.reduce((t, r) => t + r.nota, 0) / Math.max(1, lista.length)
  o.msMedio = lista.reduce((t, r) => t + r.ms, 0) / Math.max(1, lista.length)
  o.decisoesMedia = lista.reduce((t, r) => t + r.decisoes, 0) / Math.max(1, lista.length)
  return o
}

function analisar() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  const todasLinhas = lerTudo(saida)
  // as carreiras do plano condicional são de sementes escolhidas: ficam fora das taxas comuns
  const cond = todasLinhas.filter((r) => r.lote.startsWith('cond-'))
  const tudo = todasLinhas.filter((r) => !r.lote.startsWith('cond-'))
  const motor = JSON.parse(readFileSync(join(saida, 'conquistas.json'), 'utf8'))
  const ids = motor.ids
  const out = { total: tudo.length, porPolitica: {}, porNacao: {}, porRitmo: {}, porPosicao: {}, porLote: {}, conquistas: {}, raras: [] }
  for (const [pol, l] of grupo(tudo, (r) => `${r.pol}${r.bonus ? `+${r.bonus}` : ''}`)) {
    out.porPolitica[pol] = resumoDe(l)
    out.porNacao[pol] = Object.fromEntries([...grupo(l, (r) => r.nat)].map(([k, v]) => [k, resumoDe(v)]))
    out.porRitmo[pol] = Object.fromEntries([...grupo(l, (r) => r.pace)].map(([k, v]) => [k, resumoDe(v)]))
    out.porPosicao[pol] = Object.fromEntries([...grupo(l, (r) => r.pos)].map(([k, v]) => [k, resumoDe(v)]))
    // conquistas: em quantas carreiras cada uma saiu
    const cont = new Array(ids.length).fill(0)
    for (const r of l) for (const i of r.conq) cont[i]++
    out.conquistas[pol] = Object.fromEntries(ids.map((id, i) => [id, cont[i] / l.length]))
    out.conquistas[pol]._n = l.length
  }
  for (const [lote, l] of grupo(tudo, (r) => r.lote)) out.porLote[lote] = resumoDe(l)
  // nação × ritmo no caçador (a combinação que importa)
  out.cacNacaoRitmo = {}
  for (const [k, v] of grupo(tudo.filter((r) => r.pol === 'cacador' && !r.bonus), (r) => `${r.nat}/${r.pace}`)) out.cacNacaoRitmo[k] = resumoDe(v)
  out.cacNacaoGrupoPos = {}
  const gpos = (p) => (p === 'GOL' ? 'goleiro' : ['ZAG', 'LD', 'LE', 'VOL'].includes(p) ? 'defesa' : ['MC', 'ME', 'MD', 'MEI'].includes(p) ? 'meio' : 'ataque')
  for (const [k, v] of grupo(tudo.filter((r) => r.pol === 'cacador' && !r.bonus), (r) => `${r.nat}/${gpos(r.pos)}`)) out.cacNacaoGrupoPos[k] = resumoDe(v)
  // máximos observados (o que é possível de verdade)
  out.maximos = {
    confeds: Math.max(...tudo.map((r) => r.confeds)),
    clubes: Math.max(...tudo.map((r) => r.clubes)),
    paisesSul: Math.max(...tudo.map((r) => r.paisesSul)),
    copas: Math.max(...tudo.map((r) => r.copas)),
    lib: Math.max(...tudo.map((r) => r.lib)),
    bolas: Math.max(...tudo.map((r) => r.bolas)),
    pico: Math.max(...tudo.map((r) => r.pico)),
    titulos: Math.max(...tudo.map((r) => r.titulos)),
    gols: Math.max(...tudo.map((r) => r.gols)),
  }
  // conquistas na união de TODAS as carreiras (o que já saiu alguma vez) e em quantas
  const todas = new Array(ids.length).fill(0)
  for (const r of tudo) for (const i of r.conq) todas[i]++
  out.conquistasGeral = Object.fromEntries(ids.map((id, i) => [id, todas[i]]))
  out.nuncaSairam = ids.filter((_, i) => todas[i] === 0)
  // as carreiras raras (para repetir no navegador)
  out.raras = tudo
    .filter((r) => C3L2(r) || r.copas >= 4)
    .slice(0, 40)
    .map((r) => ({ lote: r.lote, a0: r.a0, a1: r.a1, nat: r.nat, pos: r.pos, pace: r.pace, pol: r.pol, bonus: r.bonus, copas: r.copas, lib: r.lib, nota: r.nota, picks: r.picks }))
  // nota das carreiras que cumprem o critério (top 3 do perfil)
  const notas = (f) => tudo.filter(f).map((r) => r.nota).sort((a, b) => a - b)
  const q = (v, p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null)
  out.notaCriterio = Object.fromEntries(
    Object.entries({ C3, C3L2, C2L2, todas: () => true }).map(([k, f]) => {
      const v = notas(f)
      return [k, { n: v.length, p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9) }]
    }),
  )
  // ── tempo: quantas carreiras e quanto tempo até a primeira que cumpre (jogador dedicado = o caçador) ──
  // p por carreira → média 1/p, mediana ln2/p, 90% das vezes até ln10/p; minutos por carreira pelo ritmo (das
  // gravações de scripts/gravar: o robô com animações; "rápido" = animações puladas, como quem já conhece o jogo)
  out.tempo = {}
  const cacSul = tudo.filter((r) => r.pol === 'cacador' && !r.bonus && ['BRA', 'ARG'].includes(r.nat))
  for (const [crit, f] of Object.entries(CRITERIOS)) {
    out.tempo[crit] = {}
    for (const pace of ['expressa', 'normal', 'intensa', 'todos']) {
      const l = pace === 'todos' ? cacSul : cacSul.filter((r) => r.pace === pace)
      const t = taxa(l, f)
      const min = MIN_POR_CARREIRA[pace] ?? MIN_POR_CARREIRA.normal
      const media = t.p > 0 ? 1 / t.p : null
      out.tempo[crit][pace] = {
        ...t,
        media,
        mediana: t.p > 0 ? Math.log(2) / t.p : null,
        p90: t.p > 0 ? Math.log(10) / t.p : null,
        horasRapido: media ? (media * min.rapido) / 60 : null,
        horasCalmo: media ? (media * min.calmo) / 60 : null,
        // dias com o teto de 100 partidas por dia e com 1 h e 3 h por dia (rápido)
        diasTeto: media ? media / 100 : null,
        dias1h: media ? media / Math.min(100, 60 / min.rapido) : null,
        dias3h: media ? media / Math.min(100, 180 / min.rapido) : null,
      }
    }
  }
  // ── o mundo vem da semente: quem ganha cada Copa (o jogador mal mexe nisso) ──
  const sem = tudo.filter((r) => r.lote?.startsWith('sem-'))
  if (sem.length) {
    const porK = grupo(sem, (r) => r.k)
    let iguais = 0
    let total = 0
    let mundo3 = 0
    let jogador3 = 0
    let n = 0
    for (const [, l] of porK) {
      if (l.length < 2) continue
      const base = l[0].wc
      for (const r of l.slice(1))
        for (let i = 0; i < Math.min(base.length, r.wc.length); i++) {
          total++
          if (base[i] === r.wc[i]) iguais++
        }
    }
    for (const r of sem) {
      n++
      if ((r.wc ?? []).filter((x) => x === r.nat).length >= 3) mundo3++
      if (r.copas >= 3) jogador3++
    }
    out.sementes = { carreiras: sem.length, copasComparadas: total, mesmoCampeao: total ? iguais / total : null, seleçãoGanha3: mundo3 / n, jogadorGanha3: jogador3 / n }
  }
  // ── o mundo: chance de cada seleção ganhar 3+ das 6 Copas (todas as carreiras com wc) ──
  const comWc = tudo.filter((r) => Array.isArray(r.wc) && r.wc.length >= 6)
  out.mundo = { n: comWc.length, campeoes: {}, tres: {} }
  for (const r of comWc) {
    const cont = {}
    for (const w of r.wc) {
      out.mundo.campeoes[w] = (out.mundo.campeoes[w] ?? 0) + 1
      cont[w] = (cont[w] ?? 0) + 1
    }
    for (const [w, c] of Object.entries(cont)) if (c >= 3) out.mundo.tres[w] = (out.mundo.tres[w] ?? 0) + 1
  }
  for (const k of Object.keys(out.mundo.campeoes)) out.mundo.campeoes[k] /= comWc.length * 6
  for (const k of Object.keys(out.mundo.tres)) out.mundo.tres[k] /= comWc.length
  // idades das Copas e Libertadores ganhas (o caçador)
  const idades = (campo) => {
    const m = {}
    for (const r of tudo.filter((x) => x.pol === 'cacador')) for (const a of r[campo] ?? []) m[a] = (m[a] ?? 0) + 1
    return m
  }
  out.idadesCopa = idades('idadesCopa')
  out.idadesLib = idades('idadesLib')
  // ── conquistas: a melhor chance por carreira de cada uma (em qualquer política/lote) ──
  out.conquistasMelhor = {}
  for (const [i, id] of ids.entries()) {
    // a melhor taxa entre os lotes com 100+ carreiras e 3+ ocorrências (menos que isso é sorte); sem nenhum, a geral
    let melhor = { p: 0, k: 0, n: 0, onde: null }
    for (const [lote, l] of grupo(tudo, (r) => r.lote)) {
      const k = l.filter((r) => r.conq.includes(i)).length
      if (l.length >= 100 && k >= 3 && k / l.length > melhor.p) melhor = { p: k / l.length, k, n: l.length, onde: lote }
    }
    if (!melhor.onde) {
      const k = tudo.filter((r) => r.conq.includes(i)).length
      melhor = { p: k / tudo.length, k, n: tudo.length, onde: k ? 'todas' : null }
    }
    out.conquistasMelhor[id] = melhor
  }
  // ── coleção na conta: quantas conquistas diferentes depois de N carreiras ──
  // "misto": o jogador joga como a média de todas as carreiras do estudo (todas as políticas e alvos misturados);
  // "mirando": cada conquista com a melhor chance que alguma política teve (o teto de quem monta cada carreira para
  // uma conquista; otimista, porque uma carreira não mira todas ao mesmo tempo).
  const pMix = ids.map((_, i) => tudo.filter((r) => r.conq.includes(i)).length / tudo.length)
  const pBest = ids.map((id) => out.conquistasMelhor[id].p)
  const esperado = (ps, n) => ps.reduce((t, p) => t + (1 - Math.pow(1 - p, n)), 0)
  const NS = [30, 100, 300, 700, 1000, 2000, 3000, 5000, 10000, 30000, 100000]
  out.colecao = {
    misto: Object.fromEntries(NS.map((n) => [n, esperado(pMix, n)])),
    mirando: Object.fromEntries(NS.map((n) => [n, esperado(pBest, n)])),
    // carreiras até ter X conquistas (média, pela conta acima)
    ate: {},
  }
  for (const alvo of [50, 55, 60, 65, 70, 75, 80, 85]) {
    const achar = (ps) => {
      let lo = 1
      let hi = 1e7
      if (esperado(ps, hi) < alvo) return null
      while (hi - lo > 1) {
        const m = Math.floor((lo + hi) / 2)
        if (esperado(ps, m) >= alvo) hi = m
        else lo = m
      }
      return hi
    }
    out.colecao.ate[alvo] = { misto: achar(pMix), mirando: achar(pBest) }
  }
  // sorteio de verdade (misto): N carreiras tiradas ao acaso do estudo, 200 vezes → mediana e faixa de 80%
  const rnd = rngDe(12345)
  out.colecao.sorteio = {}
  for (const n of [100, 300, 1000, 3000]) {
    const v = []
    for (let t = 0; t < 200; t++) {
      const tem = new Set()
      for (let j = 0; j < n; j++) for (const i of tudo[Math.floor(rnd() * tudo.length)].conq) tem.add(i)
      v.push(tem.size)
    }
    v.sort((a, b) => a - b)
    out.colecao.sorteio[n] = { p10: v[20], p50: v[100], p90: v[180] }
  }
  // ── condicional: P(critério) = Σ_k P(mundo dá k Copas à seleção) × P(critério | mundos com k) ──
  if (cond.length) {
    out.condicional = {}
    for (const [lote, l] of grupo(cond, (r) => r.lote)) {
      const [, nat, kk, pol] = lote.split('-')
      const k = Number(kk.slice(1))
      const chave = `${nat}/${pol}`
      // o mundo "neutro": carreiras em que o jogador não era dessa seleção (não ajudou nem atrapalhou)
      const neutros = tudo.filter((r) => Array.isArray(r.wc) && r.wc.length >= 6 && r.nat !== nat && r.natFim !== nat)
      const pk = taxa(neutros, (r) => (k === 3 ? r.wc.filter((x) => x === nat).length >= 3 : r.wc.filter((x) => x === nat).length === 2))
      out.condicional[chave] ??= {}
      const o = { mundo: pk, n: l.length }
      for (const [crit, f] of Object.entries(CRITERIOS)) o[crit] = taxa(l, f)
      // quantas das Copas do mundo da semente ele estava (convocado) e ganhou
      o.copasMedia = l.reduce((t, r) => t + r.copas, 0) / l.length
      o.mesmoMundo = l.filter((r) => r.wc.filter((x) => x === nat).length >= k).length / l.length
      out.condicional[chave][`k${k}`] = o
    }
    for (const [nat, o] of Object.entries(out.condicional)) {
      o.estimativa = {}
      for (const crit of Object.keys(CRITERIOS)) {
        let p = 0
        let lo = 0
        let hi = 0
        for (const kk of ['k2', 'k3']) {
          if (!o[kk]) continue
          p += o[kk].mundo.p * o[kk][crit].p
          lo += o[kk].mundo.lo * o[kk][crit].lo
          hi += o[kk].mundo.hi * o[kk][crit].hi
        }
        o.estimativa[crit] = { p, lo, hi, media: p > 0 ? 1 / p : null }
      }
    }
  }
  writeFileSync(join(saida, 'resumo.json'), JSON.stringify(out, null, 1))
  console.log(`resumo: ${join(saida, 'resumo.json')} (${tudo.length} carreiras)`)
}

async function conquistas() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  mkdirSync(saida, { recursive: true })
  const fixo = opt('pacote', null)
  const { pasta, pacote } = fixo ? { pasta: null, pacote: resolve(fixo) } : await empacotar()
  try {
    const mod = await import(pathToFileURL(pacote).href)
    writeFileSync(join(saida, 'conquistas.json'), JSON.stringify({ ids: mod.IDS_CONQUISTAS, catalogo: mod.CATALOGO }, null, 1))
    console.log(`${mod.IDS_CONQUISTAS.length} conquistas → ${join(saida, 'conquistas.json')}`)
  } finally {
    if (pasta) rmSync(pasta, { recursive: true, force: true })
  }
}

/**
 * Tabela das 87 conquistas (markdown) a partir do resumo.json: a melhor chance por carreira que alguma política teve,
 * onde, e quantas carreiras do estudo tiveram a conquista. As impossíveis pelos dados do jogo vão marcadas.
 */
function tabelaConquistas() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  const r = JSON.parse(readFileSync(join(saida, 'resumo.json'), 'utf8'))
  const cat = JSON.parse(readFileSync(join(saida, 'conquistas.json'), 'utf8')).catalogo
  const IMPOSSIVEL = { nomad: 'impossível: só há clubes de 5 confederações (nenhuma liga da Oceania; Auckland e Wellington jogam a liga australiana, AFC)' }
  const pct = (p) => (p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? `${(p * 100).toFixed(2)}%` : '0')
  const linhas = cat
    .map((c) => {
      const m = r.conquistasMelhor[c.id]
      const vezes = r.conquistasGeral[c.id] ?? 0
      const carreiras = m.p > 0 ? Math.round(1 / m.p) : null
      const nota = IMPOSSIVEL[c.id] ?? (vezes === 0 ? `não saiu em ${r.total} carreiras` : vezes <= 3 ? `saiu ${vezes} ${vezes === 1 ? 'vez' : 'vezes'}` : '')
      return { c, m, vezes, carreiras, nota }
    })
    .sort((a, b) => b.m.p - a.m.p)
  const out = ['| Conquista | Melhor chance por carreira | Onde (política) | Carreiras (média) | Vezes no estudo | Observação |', '|---|---:|---|---:|---:|---|']
  for (const l of linhas) out.push(`| ${l.c.titulo} (\`${l.c.id}\`) | ${pct(l.m.p)} | ${l.m.onde ?? '—'} | ${l.carreiras ?? '—'} | ${l.vezes} | ${l.nota} |`)
  writeFileSync(join(saida, 'conquistas.md'), out.join('\n') + '\n')
  console.log(`tabela: ${join(saida, 'conquistas.md')}`)
}

if (cmd === 'simular') {
  // vários planos em fila: --plano padrao,alvos,bonus,oraculo
  const lista = opt('plano', 'rapido').split(',')
  if (!args.includes('--plano')) args.push('--plano', 'rapido')
  for (const p of lista) {
    args[args.indexOf('--plano') + 1] = p
    await simular()
  }
  await conquistas()
}
else if (cmd === 'conferir-pacote') await conferirPacote()
else if (cmd === 'pacote') await pacoteFixo()
else if (cmd === 'analisar') analisar()
else if (cmd === 'conquistas') await conquistas()
else if (cmd === 'tabela-conquistas') tabelaConquistas()
else {
  console.log('uso: node scripts/estudos/raridade.mjs simular|analisar|conquistas|tabela-conquistas|conferir-pacote|pacote --saida <pasta> [--pacote <motor.mjs>] [--destino <pasta>] [--motor <raridade-motor.ts de uma cópia>] [--lotes a,b] [--plano padrao,alvos,alvos2,extra,bonus,oraculo,sementes,condicional,v34,v34piloto|rapido] [--n 1000] [--workers 3] [--sem-acelerar]')
  process.exit(1)
}
