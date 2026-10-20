#!/usr/bin/env node
/**
 * Calibração da v3.4 (servidor/CONTRATO-v34.md §K): lê as carreiras do estudo de raridade (scripts/estudos/raridade.mjs:
 * as 35.613 da v3.3 e as dos planos `v34` e `v34b`) e calcula:
 *   1. a chance de cada uma das 87 conquistas com as regras de HOJE para o jogador dedicado (o melhor plano de jogo) e
 *      para quem joga ao acaso, e o "mais perto que saiu" das que quase nunca saem (por que só 78–79 das 87 saem);
 *   2. a grade de limites novos das conquistas raras e a chance de cada um; com os limites escolhidos
 *      (calibracao-v34-escolha.json), as chances novas e quantas carreiras um jogador dedicado leva para ter as 87
 *      (simulação do colecionador, com as chances dos planos encolhidas para não premiar a sorte de um plano pequeno);
 *   3. as chances do Desafio do Rei (3 Copas + 2 Libertadores) e das versões menores, em carreiras e em dias;
 *   4. os desafios de emblema (critérios que o servidor confere no HallEntry guardado) e a chance de cada um.
 *
 *   node scripts/estudos/calibracao-v34.mjs --dados <pasta v3.3>,<pasta v34>,<pasta v34b> --saida <pasta> [--jogadores 400]
 *
 * Saída em <saida>: calibracao.json (tudo), conquistas-novas.json ({id: {descricao, regra, parametros, check, chance}}),
 * desafios-emblema.json ([{slug, titulo, descricao, dificuldade, criterio, chance, emblema}]) e tabelas.md.
 * Nada aqui toca o jogo: só lê as linhas JSON que o raridade.mjs gravou.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { FAMILIAS, HOJE_PARAMS, v34 } from './calibracao-v34-regras.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}

// ───────────────────────────── leitura ─────────────────────────────

const PASTAS = String(opt('dados', '')).split(',').filter(Boolean).map((p) => resolve(p))
if (!PASTAS.length) {
  console.log('uso: node scripts/estudos/calibracao-v34.mjs --dados <pasta v3.3>,<pasta v34>,<pasta v34b> --saida <pasta> [--jogadores 400]')
  process.exit(1)
}
const SAIDA = resolve(opt('saida', '.'))
mkdirSync(SAIDA, { recursive: true })

const todas = []
const separadas = { condicional: 0, bonus: 0, oraculo: 0 }
const extras = []
for (const pasta of PASTAS) {
  for (const f of readdirSync(pasta).filter((x) => x.endsWith('.jsonl')).sort()) {
    const lote = f.replace(/\.jsonl$/, '')
    if (lote.startsWith('pil') || lote.startsWith('rapido')) continue
    for (const l of readFileSync(join(pasta, f), 'utf8').split('\n')) {
      if (!l.trim()) continue
      let r
      try {
        r = JSON.parse(l)
      } catch {
        continue
      }
      if (r.erro) continue
      r.lote = lote
      r.fonte = basename(pasta)
      // as carreiras da v3.4 têm os números crus novos (Chuteiras, recordes, nota bruta, temporadas num clube…)
      r.v34 = r.rec !== undefined
      // as do experimento condicional são de sementes escolhidas; as com bônus de OVR e as do oráculo (que "volta no
      // tempo") não são o jogador dedicado: ficam fora das taxas (as duas últimas aparecem só nas tabelas à parte)
      if (lote.startsWith('cond-')) separadas.condicional++
      else if (r.bonus || r.pol === 'oraculo') {
        separadas[r.bonus ? 'bonus' : 'oraculo']++
        extras.push(r)
      } else todas.push(r)
    }
  }
}
const arqConq = PASTAS.map((p) => join(p, 'conquistas.json')).filter(existsSync)
if (!arqConq.length) throw new Error('nenhuma pasta tem o conquistas.json (o raridade.mjs grava no fim do simular)')
const CAT = JSON.parse(readFileSync(arqConq[arqConq.length - 1], 'utf8'))
for (const a of arqConq) {
  const ids = JSON.parse(readFileSync(a, 'utf8')).ids
  if (JSON.stringify(ids) !== JSON.stringify(CAT.ids)) throw new Error(`a lista de conquistas mudou entre as pastas (${a})`)
}
const IDS = CAT.ids
const TITULO = Object.fromEntries(CAT.catalogo.map((c) => [c.id, c.titulo]))
const DESCRICAO_CAT = Object.fromEntries(CAT.catalogo.map((c) => [c.id, c.descricao]))
const IX = Object.fromEntries(IDS.map((id, i) => [id, i]))
// a Nômade da v3.3 pedia 6 confederações; a de hoje pede 5 (o catálogo da pasta mais nova já tem o texto novo)
const DESCRICAO = { ...DESCRICAO_CAT, nomad: 'Jogue em clubes das cinco confederações do jogo (Europa, América do Sul, América do Norte, Ásia e África).' }

// ───────────────────────────── planos ─────────────────────────────

const ATAQUE = new Set(['CA', 'PE', 'PD'])
const MEIO = new Set(['MEI', 'MC', 'ME', 'MD', 'VOL'])
const grupoPos = (p) => (p === 'GOL' ? 'goleiro' : ATAQUE.has(p) ? 'ataque' : MEIO.has(p) ? 'meio' : 'defesa')
const NOME_POL = {
  aleatoria: 'ao acaso',
  gananciosa: 'guloso (o clube mais forte)',
  cacador: 'caçador (Copas e Libertadores)',
  mochileiro: 'mochileiro (um clube novo por temporada)',
  sulamericano: 'sul-americano (um país novo)',
  fiel: 'fiel (um clube só)',
  europeu: 'europeu (as cinco grandes ligas)',
  artilheiro: 'artilheiro (v3.3)',
  goleador: 'goleador na América do Sul',
  chuteira: 'artilheiro na Europa (Chuteira de Ouro)',
  recordista: 'recordista (goleador que fica no clube)',
  nomade: 'nômade (confederação nova, senão o clube mais forte)',
  'nomade-v1': 'nômade (sempre a confederação nova)',
}

/** O plano de jogo de uma carreira (política; o nômade da 1ª versão separado), sem seleção nem posição. */
function politica(r) {
  if (r.pol === 'nomade' && r.lote === 'v34-nom') return 'nomade-v1'
  return r.pol
}
for (const r of todas) {
  r.plano = politica(r)
  r.grupo = grupoPos(r.pos)
}

/** As chaves de grupo de uma carreira: plano, plano:posição, plano/seleção, plano/seleção:posição. */
const chavesDe = (r) => [r.plano, `${r.plano}:${r.grupo}`, `${r.plano}/${r.nat}`, `${r.plano}/${r.nat}:${r.grupo}`]
function pools(lista) {
  const m = new Map()
  for (const r of lista)
    for (const k of chavesDe(r)) {
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
  return m
}
const POOLS = pools(todas)
/** "chuteira/ENG:ataque" → "artilheiro na Europa (Chuteira de Ouro), Inglaterra, atacante". */
const SELECAO = { BRA: 'Brasil', ARG: 'Argentina', URU: 'Uruguai', COL: 'Colômbia', CHI: 'Chile', PAR: 'Paraguai', ECU: 'Equador', PER: 'Peru', VEN: 'Venezuela', BOL: 'Bolívia', ESP: 'Espanha', FRA: 'França', ENG: 'Inglaterra', POR: 'Portugal', GER: 'Alemanha', ITA: 'Itália', NED: 'Holanda', BEL: 'Bélgica', MEX: 'México', USA: 'Estados Unidos', JPN: 'Japão', MAR: 'Marrocos', SEN: 'Senegal', CRO: 'Croácia', NGA: 'Nigéria' }
const POSICAO = { ataque: 'atacante', meio: 'meio-campo', defesa: 'defensor', goleiro: 'goleiro' }
function nomePlano(k) {
  const m = /^([^/:]+)(?:\/([A-Z]{3}))?(?::(\w+))?$/.exec(k)
  if (!m) return k
  return [NOME_POL[m[1]] ?? m[1], m[2] ? SELECAO[m[2]] ?? m[2] : null, m[3] ? POSICAO[m[3]] ?? m[3] : null].filter(Boolean).join(', ')
}

// ───────────────────────────── estatística ─────────────────────────────

function wilson(k, n) {
  if (!n) return [0, 1]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}
const umEm = (p) => (p > 0 ? Math.round(1 / p) : null)
const milhar = (x) => Math.round(x).toLocaleString('pt-BR')
const fmtUmEm = (p) => (p > 0 ? `1 em ${milhar(1 / p)}` : '—')
const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? `${(p * 100).toFixed(2)}%` : '0')
const dec1 = (x) => (x >= 10 ? milhar(x) : x.toFixed(1).replace('.', ','))

/** k em n de uma lista para um predicado que pode não ter como conferir (null). */
function conta(lista, pred) {
  let n = 0
  let k = 0
  for (const r of lista) {
    const v = pred(r)
    if (v === null || v === undefined) continue
    n++
    if (v) k++
  }
  const [lo, hi] = wilson(k, n)
  return { k, n, p: n ? k / n : 0, lo, hi }
}

/**
 * A melhor chance por carreira de um critério entre os planos (política, com ou sem seleção e posição). Só entram grupos
 * com `minN`+ carreiras em que o critério pode ser conferido. O melhor é o de maior limite inferior do intervalo de 95%
 * (um grupo pequeno com uma ocorrência de sorte não passa na frente de um grande com várias); sem nenhuma ocorrência, o
 * de mais carreiras (o teto fica no `hi`).
 */
function melhor(pred, { minN = 500 } = {}) {
  const linhas = []
  for (const [k, l] of POOLS) {
    const c = conta(l, pred)
    if (c.n < minN) continue
    linhas.push({ plano: k, nome: nomePlano(k), ...c })
  }
  const best = linhas.length ? linhas.reduce((a, b) => (b.lo > a.lo || (b.lo === a.lo && b.n > a.n) ? b : a)) : null
  return {
    melhor: best,
    geral: conta(todas, pred),
    aleatoria: conta(todas.filter((r) => r.plano === 'aleatoria'), pred),
    planos: linhas.sort((a, b) => b.lo - a.lo).slice(0, 5),
  }
}

/** Chance numa lista de planos nomeados (para o Desafio do Rei e as conquistas raras). */
const PLANOS_NOMEADOS = {
  'cacador-ARG': { nome: 'caçador argentino', f: (r) => r.plano === 'cacador' && r.nat === 'ARG' },
  'cacador-BRA': { nome: 'caçador brasileiro', f: (r) => r.plano === 'cacador' && r.nat === 'BRA' },
  'cacador-ESP': { nome: 'caçador espanhol', f: (r) => r.plano === 'cacador' && r.nat === 'ESP' },
  'cacador-ARG-meio': { nome: 'caçador argentino, meio-campo', f: (r) => r.plano === 'cacador' && r.nat === 'ARG' && r.grupo === 'meio' },
  'cacador-ARG-ataque': { nome: 'caçador argentino, atacante', f: (r) => r.plano === 'cacador' && r.nat === 'ARG' && r.grupo === 'ataque' },
  'cacador-sul': { nome: 'caçador sul-americano (Brasil e Argentina)', f: (r) => r.plano === 'cacador' && (r.nat === 'ARG' || r.nat === 'BRA') },
  'recordista-ARG': { nome: 'recordista argentino (atacante)', f: (r) => r.plano === 'recordista' && r.nat === 'ARG' },
  'recordista-BRA': { nome: 'recordista brasileiro (atacante)', f: (r) => r.plano === 'recordista' && r.nat === 'BRA' },
  'guloso-ESP': { nome: 'guloso espanhol', f: (r) => r.plano === 'gananciosa' && r.nat === 'ESP' && r.grupo !== 'goleiro' },
  'chuteira-ENG-ESP': { nome: 'artilheiro na Europa, Inglaterra e Espanha (atacante)', f: (r) => r.plano === 'chuteira' && (r.nat === 'ENG' || r.nat === 'ESP') },
  'chuteira-ESP-FRA-ENG': { nome: 'artilheiro na Europa, Espanha/França/Inglaterra (atacante)', f: (r) => r.plano === 'chuteira' && ['ESP', 'FRA', 'ENG'].includes(r.nat) },
  'goleador-COL': { nome: 'goleador colombiano (atacante)', f: (r) => r.plano === 'goleador' && r.nat === 'COL' },
  'goleador-sul': { nome: 'goleador sul-americano (atacante)', f: (r) => r.plano === 'goleador' },
  'gol-rec-BRA': { nome: 'goleador ou recordista brasileiro (atacante)', f: (r) => (r.plano === 'goleador' || r.plano === 'recordista') && r.nat === 'BRA' },
  mochileiro: { nome: 'mochileiro no Intenso', f: (r) => r.plano === 'mochileiro' },
  'sulamericano-gk': { nome: 'sul-americano no Intenso, goleiro', f: (r) => r.plano === 'sulamericano' && r.grupo === 'goleiro' },
  sulamericano: { nome: 'sul-americano no Intenso', f: (r) => r.plano === 'sulamericano' },
  nomade: { nome: 'nômade no Intenso', f: (r) => r.plano === 'nomade' },
  'mochileiro-MAR': { nome: 'mochileiro marroquino no Intenso', f: (r) => r.plano === 'mochileiro' && r.nat === 'MAR' },
  aleatoria: { nome: 'ao acaso', f: (r) => r.plano === 'aleatoria' },
}
const LISTA_NOMEADA = Object.fromEntries(Object.entries(PLANOS_NOMEADOS).map(([k, v]) => [k, todas.filter(v.f)]))
const nomeado = (k, pred) => ({ plano: k, nome: PLANOS_NOMEADOS[k].nome, ...conta(LISTA_NOMEADA[k], pred) })

// ───────────────────────────── conquistas de hoje ─────────────────────────────

/** As conquistas com as regras de hoje: as do motor (conq) com a Nômade de 5 confederações (o motor da v3.3 pedia 6). */
function conquistasHoje(r) {
  const s = new Set(r.conq.map((i) => IDS[i]))
  s.delete('nomad')
  if (r.confeds >= 5) s.add('nomad')
  return s
}
for (const r of todas) r.hoje = conquistasHoje(r)
for (const r of extras) r.hoje = conquistasHoje(r)

const gpg = (r) => (r.jogos >= 300 ? r.gols / r.jogos : 0)
const maxDe = (l, f) => l.reduce((m, r) => Math.max(m, f(r) ?? -Infinity), -Infinity)

/** "O mais perto que saiu" de cada conquista rara, com a regra de hoje (todas as carreiras do jogador dedicado). */
const MAIS_PERTO = {
  only_pele: (l) => {
    const c = l.filter((r) => r.copas >= 3).map((r) => r.gols)
    const g = l.filter((r) => r.gols > 1000).map((r) => r.copas)
    return `com 3 Copas, no máximo ${milhar(c.length ? Math.max(...c) : 0)} gols; com mais de 1.000 gols, no máximo ${g.length ? Math.max(...g) : 0} Copa(s)`
  },
  ushuaia_to_darien: (l) => `${maxDe(l, (r) => r.paisesSul)} países (de 10)`,
  nomad: (l) => `${maxDe(l, (r) => r.confeds)} confederações`,
  baldosero: (l) => `${maxDe(l, (r) => r.clubes)} clubes (de 24)`,
  world_cup_4: (l) => `${maxDe(l, (r) => r.copas)} Copas`,
  world_cup_3: (l) => `${maxDe(l, (r) => r.copas)} Copas`,
  goals_1300: (l) => `${milhar(maxDe(l, (r) => r.gols))} gols`,
  goals_1000: (l) => `${milhar(maxDe(l, (r) => r.gols))} gols`,
  gpg_09: (l) => `${maxDe(l, gpg).toFixed(3).replace('.', ',')} gol por jogo`,
  records_10: (l) => `${maxDe(l.filter((r) => r.v34), (r) => r.rec)} recordes`,
  records_5: (l) => `${maxDe(l.filter((r) => r.v34), (r) => r.rec)} recordes`,
  net_terror: (l) => `${maxDe(l.filter((r) => r.v34), (r) => r.bot)} Chuteiras de Ouro`,
  golden_boot_7: (l) => `${maxDe(l.filter((r) => r.v34), (r) => r.bot)} Chuteiras de Ouro`,
  legacy_95: (l) => `nota ${maxDe(l, (r) => r.nota)}`,
  beat_all: (l) => `${Math.min(...l.filter((r) => r.v34).map((r) => r.acima))} lenda(s) acima`,
  goat: (l) => {
    const c = l.filter((r) => r.copas >= 1 && r.ucl >= 4).map((r) => r.bolas)
    return `com 1 Copa e 4 Champions, no máximo ${c.length ? Math.max(...c) : 0} Bolas de Ouro`
  },
  ucl_7: (l) => `${maxDe(l, (r) => r.ucl)} Champions`,
  complete_football: () => 'saiu',
  most_decorated: (l) => `${maxDe(l, (r) => r.titulos)} títulos`,
}

// ───────────────────────────── as regras novas ─────────────────────────────

// as famílias de limite novo e os parâmetros de hoje: scripts/estudos/calibracao-v34-regras.mjs

const ESCOLHA = JSON.parse(readFileSync(new URL('./calibracao-v34-escolha.json', import.meta.url), 'utf8'))

// ───────────────────────────── 1. hoje ─────────────────────────────

const out = {
  geradoEm: new Date().toISOString(),
  total: todas.length,
  separadas,
  porFonte: {},
  porPolitica: {},
  hoje: {},
  maisPerto: {},
  conferencia: {},
  grade: {},
  novas: {},
  rei: {},
  emblemas: [],
  emblemasCandidatos: [],
  colecao: {},
}
for (const r of todas) out.porFonte[r.fonte] = (out.porFonte[r.fonte] ?? 0) + 1
for (const r of todas) out.porPolitica[r.plano] = (out.porPolitica[r.plano] ?? 0) + 1

for (const id of IDS) {
  const m = melhor((r) => r.hoje.has(id))
  out.hoje[id] = { titulo: TITULO[id], descricao: DESCRICAO[id], ...m, vezes: m.geral.k }
}
for (const [id, f] of Object.entries(MAIS_PERTO)) out.maisPerto[id] = f(todas)

/** As raras de hoje no plano dedicado de cada uma (escolhido pelo que o jogo pede, não pela sorte de um grupo pequeno). */
const RARAS_PLANO = {
  ushuaia_to_darien: ['sulamericano-gk', 'sulamericano'],
  baldosero: 'mochileiro',
  world_cup_4: 'chuteira-ESP-FRA-ENG',
  goals_1300: ['goleador-COL', 'gol-rec-BRA', 'goleador-sul'],
  records_10: ['gol-rec-BRA', 'goleador-sul', 'sulamericano'],
  only_pele: 'chuteira-ESP-FRA-ENG',
  goat: 'cacador-ARG-meio',
  complete_football: 'cacador-ARG-ataque',
  gpg_09: ['goleador-COL', 'goleador-sul'],
  legacy_95: 'chuteira-ESP-FRA-ENG',
  beat_all: 'chuteira-ESP-FRA-ENG',
  ucl_7: 'guloso-ESP',
  world_cup_3: 'chuteira-ESP-FRA-ENG',
  golden_boot_7: 'chuteira-ESP-FRA-ENG',
  goals_1000: ['goleador-COL', 'gol-rec-BRA', 'goleador-sul'],
  nomad: 'mochileiro-MAR',
  most_decorated: 'gol-rec-BRA',
}
out.raras = {}
for (const [id, pl] of Object.entries(RARAS_PLANO)) {
  const pred = (r) => r.hoje.has(id)
  const ded = [].concat(pl).map((x) => nomeado(x, pred)).reduce((a, b) => (b.lo > a.lo || (b.lo === a.lo && b.n > a.n) ? b : a))
  out.raras[id] = { titulo: TITULO[id], descricao: DESCRICAO[id], dedicado: ded, melhor: out.hoje[id].melhor, geral: out.hoje[id].geral, aleatoria: out.hoje[id].aleatoria, maisPerto: out.maisPerto[id] ?? null }
}

for (const [id, q] of Object.entries(HOJE_PARAMS)) {
  const f = FAMILIAS[id].pred(q)
  let n = 0
  let dif = 0
  for (const r of todas) {
    // a v3.3 não tem os números crus de tudo; a conferência é nas carreiras da v3.4 (o motor de hoje)
    if (!r.v34) continue
    const v = f(r)
    if (v === null) continue
    n++
    if (!!v !== r.hoje.has(id)) dif++
  }
  out.conferencia[id] = { carreiras: n, diferentes: dif }
}

// ───────────────────────────── 2. grade e escolha ─────────────────────────────

for (const [id, fam] of Object.entries(FAMILIAS)) {
  out.grade[id] = fam.grade.map((q) => {
    const m = melhor(fam.pred(q))
    return { parametros: q, melhor: m.melhor, geral: m.geral, aleatoria: m.aleatoria, planos: m.planos.slice(0, 3) }
  })
}

/** O conjunto de conquistas de uma carreira com as regras novas; `null` em `faltam` = sem o número para conferir. */
function conquistasNovas(r) {
  const s = new Set(r.hoje)
  const faltam = []
  for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
    const v = FAMILIAS[id].pred(e.parametros)(r)
    s.delete(id)
    if (v === null || v === undefined) faltam.push(id)
    else if (v) s.add(id)
  }
  return { s, faltam }
}
for (const r of todas) {
  const { s, faltam } = conquistasNovas(r)
  r.novas = s
  r.novasFaltam = faltam
}

for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
  const pred = FAMILIAS[id].pred(e.parametros)
  const m = melhor(pred)
  // o plano dedicado escolhido para a conquista (nomeado) e a confirmação só com as carreiras da segunda leva (v34b):
  // sementes novas, depois de escolher o limite
  // `plano` pode ser uma lista de planos nomeados: vale o de maior limite inferior do intervalo (empate: mais carreiras)
  const planos = e.plano ? [].concat(e.plano) : []
  const ded = planos.length ? planos.map((pl) => nomeado(pl, pred)).reduce((a, b) => (b.lo > a.lo || (b.lo === a.lo && b.n > a.n) ? b : a)) : null
  const conf = ded ? { plano: ded.plano, ...conta(LISTA_NOMEADA[ded.plano].filter((r) => r.fonte === 'v34b'), pred) } : null
  // a regra de HOJE no mesmo plano dedicado (para comparar antes × depois no mesmo plano)
  const antesDedicado = ded ? nomeado(ded.plano, FAMILIAS[id].pred(HOJE_PARAMS[id])) : null
  out.novas[id] = { titulo: TITULO[id], antes: DESCRICAO[id], ...e, check: FAMILIAS[id].check(e.parametros), checkAntes: FAMILIAS[id].check(HOJE_PARAMS[id]), ...m, dedicado: ded, confirmacao: conf, hoje: out.hoje[id].melhor, antesDedicado }
}

// ───────────────────────────── colecionador ─────────────────────────────

/** mulberry32 (reprodutível). */
function rngDe(n) {
  let s = n >>> 0 || 0x9e3779b9
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Simula jogadores dedicados juntando as 87. A cada carreira ele escolhe o plano (política, com a seleção e/ou o grupo de
 * posição, com 400+ carreiras no estudo) com o maior número esperado de conquistas que ainda faltam e joga uma carreira
 * sorteada daquele plano (as conquistas saem juntas como saíram naquela carreira). Para um plano pequeno não parecer
 * melhor só pela sorte de uma ou duas carreiras, a chance que guia a escolha é encolhida para a média de todos os planos
 * (`(k + a·p0) / (n + a)`, a = 300 carreiras). Conquista que a carreira sorteada não tem como conferir (as carreiras da
 * v3.3 não guardam os recordes) sai com a chance do plano medida nas carreiras que guardam.
 */
function colecionador(campo, faltamCampo, { jogadores = 400, teto = 20000, semente = 1, minN = 400, a = 300 } = {}) {
  const legit = todas.filter((r) => r.plano !== 'aleatoria')
  // chance geral de cada conquista (o "p0" do encolhimento)
  const k0 = new Float64Array(IDS.length)
  const n0 = new Float64Array(IDS.length)
  for (const r of legit) {
    const sem = new Set(faltamCampo ? r[faltamCampo] : [])
    for (let i = 0; i < IDS.length; i++) if (!sem.has(IDS[i])) n0[i]++
    for (const id of r[campo]) k0[IX[id]]++
  }
  const p0 = Array.from(k0, (k, i) => (n0[i] ? k / n0[i] : 0))
  const planos = []
  for (const [k, l] of POOLS) {
    if (l.length < minN || l[0].plano === 'aleatoria') continue
    const sets = []
    const faltas = []
    const kk = new Float64Array(IDS.length)
    const nn = new Float64Array(IDS.length)
    for (const r of l) {
      const f = faltamCampo ? r[faltamCampo].map((id) => IX[id]) : []
      const sem = new Set(f)
      sets.push(new Uint16Array([...r[campo]].map((id) => IX[id])))
      faltas.push(f)
      for (let i = 0; i < IDS.length; i++) if (!sem.has(i)) nn[i]++
      for (const id of r[campo]) kk[IX[id]]++
    }
    const cru = Array.from(kk, (x, i) => (nn[i] ? x / nn[i] : 0))
    const guia = Array.from(kk, (x, i) => (x + a * p0[i]) / (nn[i] + a))
    planos.push({ k, sets, faltas, cru, guia })
  }
  const rnd = rngDe(semente)
  const res = []
  const faltas = new Map()
  const usoPlanos = new Map()
  const MARCOS = [100, 300, 700, 1000, 1500, 2100, 3000, 4200, 6000, 10000]
  // em que carreira cada conquista chegou (para ver quais seguram a coleção)
  const quando = IDS.map(() => [])
  for (let j = 0; j < jogadores; j++) {
    const tem = new Uint8Array(IDS.length)
    let falta = IDS.length
    let n = 0
    const marcos = {}
    let bp = null
    let mudou = true
    while (falta > 0 && n < teto) {
      // o melhor plano só muda quando chega uma conquista nova
      if (mudou) {
        bp = null
        let bv = 0
        for (const p of planos) {
          let v = 0
          // só conta o que o plano já deu alguma vez (o encolhimento sozinho não faz um plano "dar" o que nunca deu)
          for (let i = 0; i < IDS.length; i++) if (!tem[i] && p.cru[i] > 0) v += p.guia[i]
          if (v > bv) (bv = v), (bp = p)
        }
        mudou = false
      }
      if (!bp) break
      const q = Math.floor(rnd() * bp.sets.length)
      n++
      usoPlanos.set(bp.k, (usoPlanos.get(bp.k) ?? 0) + 1)
      for (const i of bp.sets[q])
        if (!tem[i]) {
          tem[i] = 1
          falta--
          mudou = true
          quando[i].push(n)
        }
      for (const i of bp.faltas[q])
        if (!tem[i] && rnd() < bp.cru[i]) {
          tem[i] = 1
          falta--
          mudou = true
          quando[i].push(n)
        }
      for (const mk of MARCOS) if (n === mk) marcos[mk] = IDS.length - falta
    }
    for (const mk of MARCOS) if (marcos[mk] === undefined) marcos[mk] = IDS.length - falta
    res.push({ n: falta === 0 ? n : null, tem: IDS.length - falta, carreiras: n, marcos })
    for (let i = 0; i < IDS.length; i++) if (!tem[i]) faltas.set(IDS[i], (faltas.get(IDS[i]) ?? 0) + 1)
  }
  const ns = res.map((x) => x.n ?? Infinity).sort((a, b) => a - b)
  const q = (p) => ns[Math.min(ns.length - 1, Math.floor(p * ns.length))]
  const media = (mk) => res.reduce((t, x) => t + x.marcos[mk], 0) / res.length
  const fin = ns.filter(Number.isFinite)
  // as que nenhum plano deu nenhuma vez (o teto do que dá para juntar)
  const nunca = IDS.filter((id, i) => !planos.some((p) => p.cru[i] > 0))
  return {
    jogadores,
    teto,
    completos: fin.length,
    carreiras: { p10: q(0.1), p25: q(0.25), mediana: q(0.5), p75: q(0.75), p90: q(0.9), media: fin.length === ns.length ? fin.reduce((a, b) => a + b, 0) / fin.length : null },
    conquistasApos: Object.fromEntries(MARCOS.map((mk) => [mk, Math.round(media(mk) * 10) / 10])),
    maximo: Math.max(...res.map((x) => x.tem)),
    nunca,
    // as que chegam por último: a carreira mediana (e a do 90º percentil) em que chegou, contando quem não conseguiu como o teto
    ultimas: IDS.map((id, i) => {
      const v = quando[i].concat(Array(jogadores - quando[i].length).fill(Infinity)).sort((a, b) => a - b)
      return { id, mediana: v[Math.floor(v.length / 2)], p90: v[Math.floor(v.length * 0.9)] }
    })
      .sort((a, b) => b.mediana - a.mediana || b.p90 - a.p90)
      .slice(0, 16),
    faltaram: Object.fromEntries([...faltas].sort((a, b) => b[1] - a[1]).map(([id, c]) => [id, c / jogadores])),
    planosUsados: Object.fromEntries([...usoPlanos].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, c]) => [k, Math.round((c / jogadores) * 10) / 10])),
  }
}

// ───────────────────────────── 3. Desafio do Rei ─────────────────────────────

const REI = {
  '3C+2L': (r) => r.copas >= 3 && r.lib >= 2,
  '3C+1L': (r) => r.copas >= 3 && r.lib >= 1,
  '3C': (r) => r.copas >= 3,
  '2C+3L': (r) => r.copas >= 2 && r.lib >= 3,
  '2C+2L': (r) => r.copas >= 2 && r.lib >= 2,
  '2C+1L': (r) => r.copas >= 2 && r.lib >= 1,
  '2C': (r) => r.copas >= 2,
  '1C+3L': (r) => r.copas >= 1 && r.lib >= 3,
  '1C+2L': (r) => r.copas >= 1 && r.lib >= 2,
  '1C+1L': (r) => r.copas >= 1 && r.lib >= 1,
  '2L': (r) => r.lib >= 2,
}
const PLANOS_REI = ['cacador-ARG', 'cacador-BRA', 'cacador-ESP', 'recordista-ARG', 'recordista-BRA', 'guloso-ESP', 'chuteira-ESP-FRA-ENG', 'aleatoria']
/** Dias até o primeiro acerto com `jogadores` jogando 100 carreiras por dia cada um (média, metade das vezes, 90%). */
function dias(p, jogadores = 1) {
  if (!(p > 0)) return null
  const porDia = 100 * jogadores
  return { media: 1 / (p * porDia), mediana: Math.log(2) / (p * porDia), p90: Math.log(10) / (p * porDia) }
}
for (const [nome, f] of Object.entries(REI)) {
  const porPlano = Object.fromEntries(PLANOS_REI.map((pl) => [pl, nomeado(pl, f)]))
  out.rei[nome] = { porPlano, melhor: melhor(f, { minN: 1500 }).melhor }
}
// decomposição para o que é raro demais para a contagem direta: P(3 Copas e 2 Libertadores) = P(2 Copas) × P(3ª | 2) ×
// P(2 Libertadores | 2+ Copas), cada pedaço com mais carreiras que a conta direta
{
  const dec = {}
  const fortes = todas.filter((r) => ['cacador', 'gananciosa', 'chuteira', 'recordista', 'goleador'].includes(r.plano))
  const c2f = fortes.filter((r) => r.copas >= 2)
  const r32 = { k: c2f.filter((r) => r.copas >= 3).length, n: c2f.length }
  for (const pl of ['cacador-ARG', 'cacador-BRA', 'cacador-ESP', 'recordista-ARG', 'cacador-sul']) {
    const l = LISTA_NOMEADA[pl]
    const c2 = l.filter((r) => r.copas >= 2)
    const c1 = l.filter((r) => r.copas >= 1)
    const pC2 = c2.length / l.length
    const pL2c2 = c2.filter((r) => r.lib >= 2).length / Math.max(1, c2.length)
    const pL2c1 = c1.filter((r) => r.lib >= 2).length / Math.max(1, c1.length)
    const pL1c2 = c2.filter((r) => r.lib >= 1).length / Math.max(1, c2.length)
    const p3 = r32.k / r32.n
    // faixa (conservadora): o produto dos limites de 95% de cada pedaço
    const [c2lo, c2hi] = wilson(c2.length, l.length)
    const [r3lo, r3hi] = wilson(r32.k, r32.n)
    const [l2lo, l2hi] = wilson(c2.filter((r) => r.lib >= 2).length, c2.length)
    const [l1lo, l1hi] = wilson(c2.filter((r) => r.lib >= 1).length, c2.length)
    dec[pl] = {
      faixa3C2L: [c2lo * r3lo * l2lo, c2hi * r3hi * l2hi],
      faixa3C1L: [c2lo * r3lo * l1lo, c2hi * r3hi * l1hi],
      faixa3C: [c2lo * r3lo, c2hi * r3hi],
      n: l.length,
      pC2,
      nC2: c2.length,
      p3dado2: p3,
      pC3: pC2 * p3,
      pC3direto: l.filter((r) => r.copas >= 3).length / l.length,
      pL2dadoC2: pL2c2,
      pL2dadoC1: pL2c1,
      pL1dadoC2: pL1c2,
      p3C2L: pC2 * p3 * pL2c2,
      p3C1L: pC2 * p3 * pL1c2,
    }
  }
  out.rei.decomposicao = { r32, porPlano: dec }
}

// ───────────────────────────── 4. emblemas ─────────────────────────────

/** Campos do HallEntry guardado que o servidor confere (ver a §K, "de onde o servidor tira cada número"). */
const CAMPO = {
  copas: (r) => r.copas,
  libertadores: (r) => r.lib,
  champions: (r) => r.ucl,
  bolasOuro: (r) => r.bolas,
  titulos: (r) => r.titulos,
  gols: (r) => r.gols,
  jogos: (r) => r.jogos,
  nota: (r) => (r.v34 ? r.notaHall : r.nota),
  pico: (r) => r.pico,
  temporadasMesmoClube: (r) => (r.v34 ? r.maxClube : null),
  clubes: (r) => r.clubes,
  chuteirasOuro: (r) => (r.v34 ? r.bot : null),
  mundiais: (r) => (r.v34 ? r.mundial : null),
  copasPelaSelecao: (r) => (r.v34 ? r.copaPropria : null),
}
function predCriterio(c) {
  return (r) => {
    for (const [k, v] of Object.entries(c)) {
      if (k === 'nacionalidade') {
        // a seleção da criação (replay.identity) e a do fim (identity) iguais: nunca trocou de seleção
        if (!v.includes(r.nat) || r.natFim !== r.nat) return false
        continue
      }
      const f = CAMPO[k]
      if (!f) throw new Error(`campo de critério desconhecido: ${k}`)
      const x = f(r)
      if (x === null || x === undefined) return null
      if (!(x >= v)) return false
    }
    return true
  }
}
for (const d of ESCOLHA.emblemas) {
  const pred = predCriterio(d.criterio)
  const m = melhor(pred, { minN: d.minN ?? 500 })
  const ded = d.plano ? nomeado(d.plano, pred) : null
  // o que é raro demais para a contagem direta (as Taças do Rei) usa a decomposição do Desafio do Rei
  let chanceEstimada
  if (d.estimativa) {
    const e = out.rei.decomposicao.porPlano[d.estimativa.plano]
    const pe = e[d.estimativa.campo]
    const faixa = e[`faixa${d.estimativa.campo.slice(1)}`] ?? null
    chanceEstimada = { umEm: umEm(pe), p: Number(pe.toFixed(7)), ic95: faixa ? [umEm(faixa[1]), umEm(faixa[0])] : null, plano: d.estimativa.plano, nomePlano: PLANOS_NOMEADOS[d.estimativa.plano].nome, metodo: 'P(2 Copas) × P(3ª Copa | 2) × P(2 Libertadores | 2 Copas)' }
  }
  out.emblemas.push({ ...d, medido: m, dedicado: ded, chanceEstimada })
}
for (const c of ESCOLHA.emblemasCandidatos ?? []) out.emblemasCandidatos.push({ ...c, medido: melhor(predCriterio(c.criterio), { minN: c.minN ?? 500 }) })

// ───────────────────────────── coleção ─────────────────────────────

const J = Number(opt('jogadores', '400'))
const TETO = Number(opt('teto', '20000'))
out.colecao.hoje = colecionador('hoje', null, { jogadores: J, teto: TETO, semente: 7 })
out.colecao.novas = colecionador('novas', 'novasFaltam', { jogadores: J, teto: TETO, semente: 7 })

writeFileSync(join(SAIDA, 'calibracao.json'), JSON.stringify(out, null, 1))

// ───────────────────────────── arquivos para os outros agentes ─────────────────────────────

const chanceDe = (m) => (m && m.n ? { umEm: umEm(m.p), p: Number(m.p.toFixed(6)), ic95: [umEm(m.hi), umEm(m.lo)], plano: m.plano, nomePlano: m.nome ?? nomePlano(m.plano), carreiras: m.n, vezes: m.k } : null)
const novasJson = {}
for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
  const o = out.novas[id]
  novasJson[id] = {
    titulo: TITULO[id],
    descricao: e.descricao,
    regra: e.regra,
    parametros: e.parametros,
    check: o.check,
    antes: DESCRICAO[id],
    raridade: e.raridade,
    oculta: e.oculta,
    chance: chanceDe(o.dedicado ?? o.melhor),
    chanceMelhorGrupo: chanceDe(o.melhor),
    confirmacao: o.confirmacao && o.confirmacao.n ? { carreiras: o.confirmacao.n, vezes: o.confirmacao.k, umEm: umEm(o.confirmacao.p) } : null,
    chanceAntes: chanceDe(o.antesDedicado),
    chanceAntesMelhorGrupo: chanceDe(o.hoje),
    aleatoria: { carreiras: o.aleatoria.n, vezes: o.aleatoria.k, umEm: umEm(o.aleatoria.p) },
  }
}
writeFileSync(join(SAIDA, 'conquistas-novas.json'), JSON.stringify(novasJson, null, 2) + '\n')
const NOME_DIF = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil', lendario: 'Lendário' }
const emblemasJson = out.emblemas.map((d) => {
  const m = d.dedicado ?? d.medido.melhor
  if (d.chanceEstimada)
    return {
      slug: d.slug,
      titulo: d.titulo,
      descricao: d.descricao,
      dificuldade: d.dificuldade,
      dificuldadeNome: NOME_DIF[d.dificuldade],
      criterio: d.criterio,
      chance: { ...d.chanceEstimada, direta: m ? { carreiras: m.n, vezes: m.k, plano: m.plano } : null, aleatoria: { carreiras: d.medido.aleatoria.n, vezes: d.medido.aleatoria.k, umEm: umEm(d.medido.aleatoria.p) } },
      emblema: d.emblema,
      ordem: d.ordem,
      home: d.home ?? false,
    }
  return {
    slug: d.slug,
    titulo: d.titulo,
    descricao: d.descricao,
    dificuldade: d.dificuldade,
    dificuldadeNome: NOME_DIF[d.dificuldade],
    criterio: d.criterio,
    chance: m
      ? {
          umEm: umEm(m.p) ?? (d.chanceEstimada ? d.chanceEstimada.umEm : null),
          p: Number(m.p.toFixed(6)),
          ic95: [umEm(m.hi), umEm(m.lo)],
          plano: m.plano,
          nomePlano: m.nome ?? nomePlano(m.plano),
          carreiras: m.n,
          vezes: m.k,
          aleatoria: d.medido.aleatoria.n ? { carreiras: d.medido.aleatoria.n, vezes: d.medido.aleatoria.k, umEm: umEm(d.medido.aleatoria.p) } : null,
        }
      : null,
    emblema: d.emblema,
    ordem: d.ordem,
    home: d.home ?? false,
  }
})
writeFileSync(join(SAIDA, 'desafios-emblema.json'), JSON.stringify(emblemasJson, null, 2) + '\n')

// ───────────────────────────── tabelas ─────────────────────────────

const md = []
const kn = (x) => `${x.k} em ${milhar(x.n)}`
md.push(`Carreiras: ${milhar(todas.length)} (${Object.entries(out.porFonte).map(([k, v]) => `${k}: ${milhar(v)}`).join(', ')}); fora das taxas: ${separadas.condicional} do experimento condicional, ${separadas.bonus} com bônus de OVR e ${separadas.oraculo} do oráculo.`)
md.push('')
md.push(`Por política: ${Object.entries(out.porPolitica).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${NOME_POL[k] ?? k} ${milhar(v)}`).join(' · ')}`)
md.push('')
md.push('### Conferência (predicado × motor, regras de hoje, carreiras da v3.4)')
md.push('')
md.push(Object.entries(out.conferencia).map(([id, c]) => `${id} ${c.diferentes}/${c.carreiras}`).join(' · '))
md.push('')
md.push('### As 87 de hoje (melhor plano, aleatória, vezes no estudo)')
md.push('')
md.push('| Conquista | Regra de hoje | Jogador dedicado | Plano | Ao acaso | Vezes | O mais perto |')
md.push('|---|---|---:|---|---:|---:|---|')
const ordem = IDS.slice().sort((a, b) => (out.hoje[a].melhor?.p ?? 0) - (out.hoje[b].melhor?.p ?? 0))
for (const id of ordem) {
  const h = out.hoje[id]
  const m = h.melhor
  md.push(`| ${h.titulo} (\`${id}\`) | ${h.descricao} | ${m && m.k ? fmtUmEm(m.p) : `0 em ${milhar(m?.n ?? 0)}`} | ${m && m.k ? `${m.nome} (${kn(m)})` : '—'} | ${h.aleatoria.k ? fmtUmEm(h.aleatoria.p) : '0'} | ${h.vezes} | ${out.maisPerto[id] ?? ''} |`)
}
md.push('')
md.push('### As raras de hoje no plano dedicado')
md.push('')
md.push('| Conquista | Regra de hoje | Plano dedicado | Chance | IC 95% | Melhor grupo | Vezes (todas) | O mais perto |')
md.push('|---|---|---|---:|---|---|---:|---|')
for (const [id, x] of Object.entries(out.raras)) {
  const d = x.dedicado
  md.push(`| ${x.titulo} | ${x.descricao} | ${d.nome} (${kn(d)}) | ${d.k ? fmtUmEm(d.p) : '0'} | ${d.k ? `${fmtUmEm(d.hi)} a ${fmtUmEm(d.lo)}` : `0 (até 1 em ${milhar(1 / d.hi)})`} | ${x.melhor && x.melhor.k ? `${x.melhor.plano} ${kn(x.melhor)}` : '—'} | ${x.geral.k} em ${milhar(x.geral.n)} | ${x.maisPerto ?? ''} |`)
}
md.push('')
md.push('### Grade (melhor plano por limite)')
md.push('')
for (const [id, g] of Object.entries(out.grade)) {
  md.push(`- **${TITULO[id]}**: ${g.map((x) => `${JSON.stringify(x.parametros)} → ${x.melhor && x.melhor.k ? `${fmtUmEm(x.melhor.p)} (${x.melhor.plano}, ${kn(x.melhor)})` : `0 (${x.geral.k} em ${milhar(x.geral.n)} no total)`}`).join('; ')}`)
}
md.push('')
md.push('### Limites novos')
md.push('')
md.push('| Conquista | Antes | Agora | Chance (plano dedicado) | IC 95% | Plano | Confirmação (2ª leva) | Melhor grupo | Ao acaso |')
md.push('|---|---|---|---:|---|---|---|---|---:|')
for (const [id, e] of Object.entries(out.novas)) {
  const m = e.dedicado ?? e.melhor
  md.push(
    `| ${e.titulo} | ${e.antes} | ${e.descricao} | ${m ? fmtUmEm(m.p) : '—'} | ${m ? `${fmtUmEm(m.hi)} a ${fmtUmEm(m.lo)}` : ''} | ${m ? `${m.nome} (${kn(m)})` : ''} | ${e.confirmacao ? kn(e.confirmacao) : ''} | ${e.melhor ? `${e.melhor.plano} ${kn(e.melhor)}` : ''} | ${e.aleatoria.k ? fmtUmEm(e.aleatoria.p) : `0 em ${milhar(e.aleatoria.n)}`} |`,
  )
}
md.push('')
md.push('### Coleção (jogador dedicado, plano escolhido a cada carreira)')
md.push('')
for (const [k, c] of Object.entries(out.colecao)) {
  md.push(
    `- **${k}**: ${c.completos} de ${c.jogadores} completaram as 87 em até ${milhar(c.teto)} carreiras; carreiras p10 ${c.carreiras.p10} · p25 ${c.carreiras.p25} · mediana ${c.carreiras.mediana} · p75 ${c.carreiras.p75} · p90 ${c.carreiras.p90}; conquistas depois de N carreiras: ${Object.entries(c.conquistasApos).map(([n, v]) => `${n}: ${v}`).join(' · ')}; máximo ${c.maximo}; as últimas a chegar (carreira mediana/p90): ${c.ultimas.slice(0, 12).map((u) => `${TITULO[u.id]} ${u.mediana}/${u.p90}`).join(', ')}; nunca saíram: ${c.nunca.map((id) => TITULO[id]).join(', ') || 'nenhuma'}; o que mais faltou: ${Object.entries(c.faltaram).slice(0, 8).map(([id, f]) => `${TITULO[id]} ${pct(f)}`).join(', ')}; planos: ${Object.entries(c.planosUsados).slice(0, 8).map(([p, v]) => `${p} ${v}`).join(', ')}`,
  )
}
md.push('')
md.push('### Desafio do Rei e versões menores (contagem direta)')
md.push('')
md.push(`| Critério | ${PLANOS_REI.map((p) => PLANOS_NOMEADOS[p].nome).join(' | ')} |`)
md.push(`|---|${PLANOS_REI.map(() => '---:').join('|')}|`)
for (const [nome, e] of Object.entries(out.rei)) {
  if (nome === 'decomposicao') continue
  const c = (x) => (x.k ? `${fmtUmEm(x.p)} (${x.k}/${milhar(x.n)})` : `0/${milhar(x.n)}`)
  md.push(`| ${nome} | ${PLANOS_REI.map((p) => c(e.porPlano[p])).join(' | ')} |`)
}
md.push('')
md.push(`Decomposição (P(3ª Copa | 2) = ${out.rei.decomposicao.r32.k}/${out.rei.decomposicao.r32.n}): ${Object.entries(out.rei.decomposicao.porPlano).map(([k, d]) => `${k}: P(2C) ${fmtUmEm(d.pC2)} · P(3C) ${fmtUmEm(d.pC3)} (direto ${fmtUmEm(d.pC3direto)}) · P(2L|2C) ${pct(d.pL2dadoC2)} · 3C+2L ${fmtUmEm(d.p3C2L)} (${fmtUmEm(d.faixa3C2L[1])} a ${fmtUmEm(d.faixa3C2L[0])}) · 3C+1L ${fmtUmEm(d.p3C1L)} · 3C ${fmtUmEm(d.pC3)} (${fmtUmEm(d.faixa3C[1])} a ${fmtUmEm(d.faixa3C[0])})`).join('; ')}`)
md.push('')
md.push('### Emblemas')
md.push('')
md.push('| Desafio | Dificuldade | Critério | Chance (plano dedicado) | IC 95% | Plano | Ao acaso |')
md.push('|---|---|---|---:|---|---|---:|')
for (const d of out.emblemas) {
  const m = d.dedicado ? d.dedicado : d.medido.melhor
  const ce = d.chanceEstimada
  const ale = d.medido.aleatoria.k ? fmtUmEm(d.medido.aleatoria.p) : `0 em ${milhar(d.medido.aleatoria.n)}`
  if (ce) md.push(`| ${d.titulo} | ${d.dificuldade} | \`${JSON.stringify(d.criterio)}\` | ~1 em ${milhar(ce.umEm)} (decomposição) | ${ce.ic95 ? `1 em ${milhar(ce.ic95[0])} a 1 em ${milhar(ce.ic95[1])}` : ''} | ${ce.nomePlano} (direto: ${m ? `${m.nome ?? m.plano} ${kn(m)}` : '—'}) | ${ale} |`)
  else md.push(`| ${d.titulo} | ${d.dificuldade} | \`${JSON.stringify(d.criterio)}\` | ${m && m.k ? fmtUmEm(m.p) : '—'} | ${m ? `${fmtUmEm(m.hi)} a ${fmtUmEm(m.lo)}` : ''} | ${m ? `${m.nome ?? m.plano} (${kn(m)})` : ''} | ${ale} |`)
}
if (out.emblemasCandidatos.length) {
  md.push('')
  md.push('### Candidatos a emblema')
  md.push('')
  for (const c of out.emblemasCandidatos) {
    const m = c.medido.melhor
    md.push(`- ${c.slug} \`${JSON.stringify(c.criterio)}\`: ${m && m.k ? `${fmtUmEm(m.p)} (${m.plano}, ${kn(m)})` : '0'} · geral ${c.medido.geral.k ? fmtUmEm(c.medido.geral.p) : '0'} · ao acaso ${c.medido.aleatoria.k ? fmtUmEm(c.medido.aleatoria.p) : `0 em ${milhar(c.medido.aleatoria.n)}`}`)
  }
}
writeFileSync(join(SAIDA, 'tabelas.md'), md.join('\n') + '\n')
console.log(`calibração: ${todas.length} carreiras → ${SAIDA}/calibracao.json, conquistas-novas.json, desafios-emblema.json, tabelas.md`)
