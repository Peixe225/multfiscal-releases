#!/usr/bin/env node
/**
 * Calibração da v3.4 (servidor/CONTRATO-v34.md §K): lê as carreiras do estudo de raridade (scripts/estudos/raridade.mjs:
 * as 35.613 da v3.3 e as do plano `v34`) e calcula:
 *   1. a chance de cada uma das 87 conquistas com as regras de HOJE, pelo melhor plano de um jogador dedicado, e o "mais
 *      perto" que saiu das que nunca saíram (por que só 78–79 das 87 saem);
 *   2. a grade de limites novos das conquistas raras e a chance de cada um; com os limites escolhidos (ESCOLHA, abaixo),
 *      as chances novas e quantas carreiras um jogador dedicado leva para ter as 87 (simulação do colecionador);
 *   3. as chances do Desafio do Rei (3 Copas + 2 Libertadores) e das versões menores, em carreiras e em dias;
 *   4. os desafios de emblema (critérios que o servidor confere no HallEntry guardado) e a chance de cada um.
 *
 *   node scripts/estudos/calibracao-v34.mjs --dados <pasta v3.3>,<pasta v34> --saida <pasta>
 *
 * Saída em <saida>: calibracao.json (tudo), conquistas-novas.json ({id: {descricao, regra, parametros}}),
 * desafios-emblema.json ([{slug, titulo, descricao, dificuldade, criterio, chance, emblema}]) e tabelas.md.
 * Nada aqui toca o jogo: só lê as linhas JSON que o raridade.mjs gravou.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}

// ───────────────────────────── leitura ─────────────────────────────

const PASTAS = String(opt('dados', '')).split(',').filter(Boolean).map((p) => resolve(p))
if (!PASTAS.length) {
  console.log('uso: node scripts/estudos/calibracao-v34.mjs --dados <pasta v3.3>,<pasta v34> --saida <pasta>')
  process.exit(1)
}
const SAIDA = resolve(opt('saida', '.'))
mkdirSync(SAIDA, { recursive: true })

const todas = []
const condicionais = []
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
      // v3.4 tem os números crus novos (Chuteiras, recordes, nota bruta, temporadas num clube…)
      r.v34 = r.rec !== undefined
      if (lote.startsWith('cond-')) condicionais.push(r)
      else todas.push(r)
    }
  }
}
const arqConq = PASTAS.map((p) => join(p, 'conquistas.json')).filter(existsSync)
const CAT = JSON.parse(readFileSync(arqConq[arqConq.length - 1], 'utf8'))
for (const a of arqConq) {
  const ids = JSON.parse(readFileSync(a, 'utf8')).ids
  if (JSON.stringify(ids) !== JSON.stringify(CAT.ids)) throw new Error(`a lista de conquistas mudou entre as pastas (${a})`)
}
const IDS = CAT.ids
const TITULO = Object.fromEntries(CAT.catalogo.map((c) => [c.id, c.titulo]))
const DESCRICAO = Object.fromEntries(CAT.catalogo.map((c) => [c.id, c.descricao]))
const IX = Object.fromEntries(IDS.map((id, i) => [id, i]))

// ───────────────────────────── planos ─────────────────────────────

const ATAQUE = new Set(['CA', 'PE', 'PD'])
const MEIO = new Set(['MEI', 'MC', 'ME', 'MD', 'VOL'])
const grupoPos = (p) => (p === 'GOL' ? 'goleiro' : ATAQUE.has(p) ? 'ataque' : MEIO.has(p) ? 'meio' : 'defesa')

/** O plano de jogo de uma carreira (política + seleção), sem a posição. null = fora (condicional). */
function politica(r) {
  if (r.bonus) return `bonus${r.bonus}`
  switch (r.pol) {
    case 'aleatoria':
      return 'aleatoria'
    case 'cacador':
      return r.nat === 'ARG' ? 'cacador-ARG' : r.nat === 'BRA' ? 'cacador-BRA' : 'cacador-outros'
    case 'gananciosa':
      if (r.lote === 'alvo-goleiro' || r.lote === 'v34-gk') return 'guloso-goleiro'
      return r.nat === 'ESP' ? 'guloso-ESP' : 'guloso'
    default:
      return r.pol
  }
}
/** Planos que um jogador dedicado pode usar (sem o oráculo, que "volta no tempo", e sem bônus de OVR). */
const legitimo = (p) => p !== 'oraculo' && !p.startsWith('bonus')

for (const r of todas) {
  r.plano = politica(r)
  r.grupo = grupoPos(r.pos)
}

/** Agrupa: plano inteiro e plano:grupo de posição. */
function pools(lista, filtro = () => true) {
  const m = new Map()
  for (const r of lista) {
    if (!filtro(r)) continue
    for (const k of [r.plano, `${r.plano}:${r.grupo}`]) {
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
  }
  return m
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
const fmtUmEm = (p) => (p > 0 ? `1 em ${Math.round(1 / p).toLocaleString('pt-BR')}` : '—')
const pct = (p) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : p > 0 ? `${(p * 100).toFixed(2)}%` : '0')

/**
 * A melhor chance por carreira de um critério entre os planos legítimos (política + seleção, com ou sem o grupo de
 * posição). Só entram planos com 400+ carreiras em que o critério pode ser conferido (pred !== null). Devolve também a
 * taxa geral de todos os planos legítimos e a da aleatória.
 */
function melhor(pred, { minN = 400, lista = todas, planos } = {}) {
  const ps = pools(lista, (r) => legitimo(r.plano))
  let best = null
  const linhas = []
  for (const [k, l] of ps) {
    if (planos && !planos.some((p) => k === p || k.startsWith(`${p}:`))) continue
    let n = 0
    let c = 0
    for (const r of l) {
      const v = pred(r)
      if (v === null || v === undefined) continue
      n++
      if (v) c++
    }
    if (n < minN) continue
    const [lo, hi] = wilson(c, n)
    linhas.push({ plano: k, k: c, n, p: c / n, lo, hi })
  }
  // o melhor plano é o de maior limite inferior do intervalo de 95% (um plano pequeno com 1 ocorrência não passa na
  // frente de um grande com várias); sem nenhuma ocorrência, o de mais carreiras (o teto fica no `hi`)
  if (linhas.length) best = linhas.reduce((a, b) => (b.lo > a.lo || (b.lo === a.lo && b.n > a.n) ? b : a))
  const geral = (() => {
    let n = 0
    let c = 0
    for (const r of lista) {
      if (!legitimo(r.plano)) continue
      const v = pred(r)
      if (v === null || v === undefined) continue
      n++
      if (v) c++
    }
    return { k: c, n, p: n ? c / n : 0 }
  })()
  const ale = (() => {
    let n = 0
    let c = 0
    for (const r of lista) {
      if (r.plano !== 'aleatoria') continue
      const v = pred(r)
      if (v === null || v === undefined) continue
      n++
      if (v) c++
    }
    const [lo, hi] = wilson(c, n)
    return { k: c, n, p: n ? c / n : 0, lo, hi }
  })()
  return { melhor: best, geral, aleatoria: ale, planos: linhas.sort((a, b) => b.p - a.p).slice(0, 6) }
}

// ───────────────────────────── conquistas de hoje ─────────────────────────────

/** As conquistas com as regras de hoje: as do motor (conq) e a Nômade com 5 confederações (o motor da v3.3 pedia 6). */
function conquistasHoje(r) {
  const s = new Set(r.conq.map((i) => IDS[i]))
  s.delete('nomad')
  if (r.confeds >= 5) s.add('nomad')
  return s
}
for (const r of todas) r.hoje = conquistasHoje(r)

const gpg = (r) => (r.jogos >= 300 ? r.gols / r.jogos : 0)
const v34 = (f) => (r) => (r.v34 ? f(r) : null)

/** "O mais perto que saiu" de cada conquista rara, com a regra de hoje. */
const MAIS_PERTO = {
  only_pele: { texto: 'Copas com mais gols', f: (l) => {
    const c = l.filter((r) => r.copas >= 3).map((r) => r.gols)
    const g = l.filter((r) => r.gols > 1000).map((r) => r.copas)
    return `com 3 Copas, no máximo ${c.length ? Math.max(...c) : 0} gols; com mais de 1.000 gols, no máximo ${g.length ? Math.max(...g) : 0} Copa(s)`
  } },
  ushuaia_to_darien: { texto: 'países sul-americanos', f: (l) => `${Math.max(...l.map((r) => r.paisesSul))} países (de 10)` },
  nomad: { texto: 'confederações', f: (l) => `${Math.max(...l.map((r) => r.confeds))} confederações` },
  baldosero: { texto: 'clubes', f: (l) => `${Math.max(...l.map((r) => r.clubes))} clubes (de 24)` },
  world_cup_4: { texto: 'Copas', f: (l) => `${Math.max(...l.map((r) => r.copas))} Copas` },
  goals_1300: { texto: 'gols', f: (l) => `${Math.max(...l.map((r) => r.gols)).toLocaleString('pt-BR')} gols` },
  goals_1000: { texto: 'gols', f: (l) => `${Math.max(...l.map((r) => r.gols)).toLocaleString('pt-BR')} gols` },
  gpg_09: { texto: 'gols por jogo (300+ jogos)', f: (l) => `${Math.max(...l.map(gpg)).toFixed(3).replace('.', ',')} gol por jogo` },
  records_10: { texto: 'recordes', f: (l) => `${Math.max(...l.filter((r) => r.v34).map((r) => r.rec))} recordes` },
  records_5: { texto: 'recordes', f: (l) => `${Math.max(...l.filter((r) => r.v34).map((r) => r.rec))} recordes` },
  net_terror: { texto: 'Chuteiras', f: (l) => `${Math.max(...l.filter((r) => r.v34).map((r) => r.bot))} Chuteiras de Ouro` },
  golden_boot_7: { texto: 'Chuteiras', f: (l) => `${Math.max(...l.filter((r) => r.v34).map((r) => r.bot))} Chuteiras de Ouro` },
  legacy_95: { texto: 'nota', f: (l) => `nota ${Math.max(...l.map((r) => r.nota))}` },
  beat_all: { texto: 'lendas acima', f: (l) => `${Math.min(...l.filter((r) => r.v34).map((r) => r.acima))} lenda(s) acima` },
  world_cup_3: { texto: 'Copas', f: (l) => `${Math.max(...l.map((r) => r.copas))} Copas` },
}

// ───────────────────────────── as regras novas ─────────────────────────────

/**
 * As famílias de limite novo de cada conquista rara (a grade) e a escolha. `pred(params)` → (r) → true/false/null
 * (null = a carreira não tem o número: as da v3.3 não têm Chuteiras, recordes, nota bruta…).
 */
const FAMILIAS = {
  only_pele: {
    grade: [[2, 900], [2, 800], [2, 700], [2, 600], [1, 1000], [1, 900], [1, 800], [3, 600], [3, 500]].map(([copas, gols]) => ({ copas, gols })),
    pred: ({ copas, gols }) => (r) => r.copas >= copas && r.gols > gols,
  },
  ushuaia_to_darien: { grade: [5, 6, 7, 8].map((paises) => ({ paises })), pred: ({ paises }) => (r) => r.paisesSul >= paises },
  nomad: { grade: [5, 4].map((confederacoes) => ({ confederacoes })), pred: ({ confederacoes }) => (r) => r.confeds >= confederacoes },
  baldosero: { grade: [24, 23, 22, 21, 20, 19].map((clubes) => ({ clubes })), pred: ({ clubes }) => (r) => r.clubes >= clubes },
  world_cup_4: {
    grade: [
      { tipo: 'copas_maior_que_pele', copas: 2 },
      { tipo: 'copas_maior_que_pele', copas: 3 },
      { tipo: 'copas_libertadores', copas: 2, total: 6 },
      { tipo: 'copas_libertadores', copas: 2, total: 5 },
      { tipo: 'copas_continentais', copas: 2, total: 4 },
      { tipo: 'copas_continentais', copas: 2, total: 3 },
    ],
    pred: (q) => {
      if (q.tipo === 'copas_maior_que_pele') return (r) => r.copas >= q.copas && r.hoje.has('beat_pele')
      if (q.tipo === 'copas_libertadores') return (r) => r.copas >= q.copas && r.copas + r.lib >= q.total
      return v34((r) => r.copas >= q.copas && r.copas + r.nacCont >= q.total)
    },
  },
  goals_1300: { grade: [1300, 1200, 1150, 1100, 1050, 1000, 950].map((gols) => ({ gols })), pred: ({ gols }) => (r) => r.gols >= gols },
  goals_1000: { grade: [1000, 950, 900].map((gols) => ({ gols })), pred: ({ gols }) => (r) => r.gols >= gols },
  gpg_09: {
    grade: [0.9, 0.88, 0.86, 0.85, 0.84, 0.82, 0.8].map((media) => ({ media, jogos: 300 })),
    pred: ({ media, jogos }) => (r) => r.jogos >= jogos && r.gols / r.jogos >= media,
  },
  records_10: { grade: [10, 9, 8, 7, 6, 5].map((recordes) => ({ recordes })), pred: ({ recordes }) => v34((r) => r.rec >= recordes) },
  records_5: { grade: [5, 4, 3].map((recordes) => ({ recordes })), pred: ({ recordes }) => v34((r) => r.rec >= recordes) },
  net_terror: { grade: [6, 5, 4].map((chuteiras) => ({ chuteiras })), pred: ({ chuteiras }) => v34((r) => r.bot >= chuteiras) },
  golden_boot_7: { grade: [7, 6].map((chuteiras) => ({ chuteiras })), pred: ({ chuteiras }) => v34((r) => r.bot >= chuteiras) },
  legacy_95: { grade: [95, 94, 93, 92, 91, 90].map((nota) => ({ nota })), pred: ({ nota }) => (r) => r.nota >= nota },
  beat_all: {
    grade: [0, 1, 2].map((lendasAcima) => ({ lendasAcima })),
    pred: ({ lendasAcima }) => v34((r) => r.acima <= lendasAcima),
  },
  world_cup_3: { grade: [3].map((copas) => ({ copas })), pred: ({ copas }) => (r) => r.copas >= copas },
  goat: {
    grade: [
      [1, 2, 8, 4],
      [1, 2, 6, 3],
      [1, 2, 5, 3],
      [1, 1, 6, 3],
      [1, 1, 5, 3],
      [1, 1, 6, 2],
      [1, 2, 6, 2],
      [1, 1, 5, 2],
      [1, 1, 4, 2],
    ].map(([copas, continentais, bolas, champions]) => ({ copas, continentais, bolas, champions })),
    // títulos continentais de seleção: as carreiras da v3.3 só sabem se houve 1 (a conquista "Campeão continental")
    pred: (q) => (r) => {
      if (q.continentais >= 2 && !r.v34) return null
      const cont = r.v34 ? r.nacCont : r.hoje.has('continental_national') ? 1 : 0
      return r.copas >= q.copas && cont >= q.continentais && r.bolas >= q.bolas && r.ucl >= q.champions
    },
  },
}

/**
 * Conferência: com os parâmetros de HOJE, o predicado de cada família tem de dar o mesmo que o motor deu (as conquistas
 * gravadas pela carreira) — assim a medição com o limite novo é a mesma conta que o jogo faz.
 */
const HOJE_PARAMS = {
  only_pele: [FAMILIAS.only_pele.pred, { copas: 3, gols: 1000 }],
  ushuaia_to_darien: [FAMILIAS.ushuaia_to_darien.pred, { paises: 10 }],
  nomad: [FAMILIAS.nomad.pred, { confederacoes: 5 }],
  baldosero: [FAMILIAS.baldosero.pred, { clubes: 24 }],
  world_cup_4: [() => (r) => r.copas >= 4, {}],
  goals_1300: [FAMILIAS.goals_1300.pred, { gols: 1300 }],
  goals_1000: [FAMILIAS.goals_1000.pred, { gols: 1000 }],
  gpg_09: [FAMILIAS.gpg_09.pred, { media: 0.9, jogos: 300 }],
  records_10: [FAMILIAS.records_10.pred, { recordes: 10 }],
  records_5: [FAMILIAS.records_5.pred, { recordes: 5 }],
  net_terror: [FAMILIAS.net_terror.pred, { chuteiras: 6 }],
  golden_boot_7: [FAMILIAS.golden_boot_7.pred, { chuteiras: 7 }],
  legacy_95: [FAMILIAS.legacy_95.pred, { nota: 95 }],
  beat_all: [FAMILIAS.beat_all.pred, { lendasAcima: 0 }],
  world_cup_3: [FAMILIAS.world_cup_3.pred, { copas: 3 }],
  goat: [FAMILIAS.goat.pred, { copas: 1, continentais: 2, bolas: 8, champions: 4 }],
}

/** Os limites escolhidos (preenchido depois da grade; ver a §K). */
const ESCOLHA = JSON.parse(readFileSync(new URL('./calibracao-v34-escolha.json', import.meta.url), 'utf8'))

// ───────────────────────────── 1. hoje ─────────────────────────────

const out = { total: todas.length, porFonte: {}, porPlano: {}, hoje: {}, maisPerto: {}, grade: {}, novas: {}, rei: {}, emblemas: [], colecao: {} }
for (const r of todas) out.porFonte[r.fonte] = (out.porFonte[r.fonte] ?? 0) + 1
for (const [k, l] of pools(todas)) if (!k.includes(':')) out.porPlano[k] = l.length

for (const id of IDS) {
  const m = melhor((r) => r.hoje.has(id))
  const vezes = todas.filter((r) => legitimo(r.plano) && r.hoje.has(id)).length
  out.hoje[id] = { titulo: TITULO[id], ...m, vezes }
}
for (const [id, mp] of Object.entries(MAIS_PERTO)) out.maisPerto[id] = mp.f(todas.filter((r) => legitimo(r.plano)))

out.conferencia = {}
for (const [id, [mk, q]] of Object.entries(HOJE_PARAMS)) {
  const f = mk(q)
  let n = 0
  let dif = 0
  for (const r of todas) {
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
    return { parametros: q, melhor: m.melhor, geral: m.geral, aleatoria: m.aleatoria }
  })
}

/** O conjunto de conquistas de uma carreira com as regras novas (null = falta número para conferir alguma). */
function conquistasNovas(r) {
  const s = new Set(r.hoje)
  for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
    const v = FAMILIAS[id].pred(e.parametros)(r)
    if (v === null || v === undefined) return null
    if (v) s.add(id)
    else s.delete(id)
  }
  return s
}
for (const r of todas) r.novas = conquistasNovas(r)

for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
  const m = melhor(FAMILIAS[id].pred(e.parametros))
  out.novas[id] = { titulo: TITULO[id], antes: DESCRICAO[id], ...e, ...m, hoje: out.hoje[id].melhor }
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
 * Simula jogadores dedicados juntando as 87: a cada carreira ele escolhe o plano (política + seleção + grupo de posição)
 * com o maior número esperado de conquistas que ainda faltam (a chance de cada uma naquele plano, medida no estudo) e
 * joga uma carreira sorteada daquele plano. Devolve quantas carreiras levou cada jogador (até `teto`) e o que faltou.
 */
function colecionador(campo, { jogadores = 300, teto = 20000, semente = 1, minN = 150 } = {}) {
  const planos = []
  for (const [k, l] of pools(todas, (r) => legitimo(r.plano) && r[campo])) {
    if (!k.includes(':') || l.length < minN) continue
    const sets = l.map((r) => [...r[campo]].map((id) => IX[id]))
    const freq = new Float64Array(IDS.length)
    for (const s of sets) for (const i of s) freq[i]++
    for (let i = 0; i < IDS.length; i++) freq[i] /= sets.length
    planos.push({ k, sets, freq })
  }
  const rnd = rngDe(semente)
  const res = []
  const faltas = new Map()
  const usoPlanos = new Map()
  for (let j = 0; j < jogadores; j++) {
    const tem = new Uint8Array(IDS.length)
    let falta = IDS.length
    let n = 0
    const marcos = {}
    while (falta > 0 && n < teto) {
      let bp = null
      let bv = -1
      for (const p of planos) {
        let v = 0
        for (let i = 0; i < IDS.length; i++) if (!tem[i]) v += p.freq[i]
        if (v > bv) (bv = v), (bp = p)
      }
      if (!bp || bv <= 0) break
      const s = bp.sets[Math.floor(rnd() * bp.sets.length)]
      n++
      usoPlanos.set(bp.k, (usoPlanos.get(bp.k) ?? 0) + 1)
      for (const i of s)
        if (!tem[i]) {
          tem[i] = 1
          falta--
        }
      for (const m of [100, 300, 700, 1000, 1500, 2100, 3000, 4200, 6000]) if (n === m) marcos[m] = IDS.length - falta
    }
    for (const m of [100, 300, 700, 1000, 1500, 2100, 3000, 4200, 6000]) if (marcos[m] === undefined) marcos[m] = IDS.length - falta
    res.push({ n: falta === 0 ? n : null, tem: IDS.length - falta, marcos })
    for (let i = 0; i < IDS.length; i++) if (!tem[i]) faltas.set(IDS[i], (faltas.get(IDS[i]) ?? 0) + 1)
  }
  const ns = res.map((x) => x.n ?? Infinity).sort((a, b) => a - b)
  const q = (p) => ns[Math.min(ns.length - 1, Math.floor(p * ns.length))]
  const media = (m) => res.reduce((t, x) => t + x.marcos[m], 0) / res.length
  return {
    jogadores,
    completos: res.filter((x) => x.n !== null).length,
    carreiras: { p10: q(0.1), p25: q(0.25), mediana: q(0.5), p75: q(0.75), p90: q(0.9), media: ns.every(Number.isFinite) ? ns.reduce((a, b) => a + b, 0) / ns.length : null },
    dias100: { p10: q(0.1) / 100, mediana: q(0.5) / 100, p90: q(0.9) / 100 },
    conquistasApos: Object.fromEntries([100, 300, 700, 1000, 1500, 2100, 3000, 4200, 6000].map((m) => [m, Math.round(media(m) * 10) / 10])),
    faltaram: Object.fromEntries([...faltas].sort((a, b) => b[1] - a[1]).map(([id, c]) => [id, c / jogadores])),
    planosUsados: Object.fromEntries([...usoPlanos].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => [k, Math.round((c / jogadores) * 10) / 10])),
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
  '1C+2L': (r) => r.copas >= 1 && r.lib >= 2,
  '1C+1L': (r) => r.copas >= 1 && r.lib >= 1,
  '2L': (r) => r.lib >= 2,
}
const PLANOS_REI = ['cacador-ARG', 'cacador-BRA', 'cacador-outros', 'guloso-ESP', 'guloso', 'aleatoria']
function dias(p, jogadores) {
  if (!(p > 0)) return null
  const porDia = 100 * jogadores
  return { media: 1 / (p * porDia), mediana: Math.log(2) / (p * porDia), p90: Math.log(10) / (p * porDia) }
}
for (const [nome, f] of Object.entries(REI)) {
  const porPlano = {}
  for (const pl of PLANOS_REI) {
    const l = todas.filter((r) => r.plano === pl)
    const k = l.filter(f).length
    const [lo, hi] = wilson(k, l.length)
    porPlano[pl] = { k, n: l.length, p: l.length ? k / l.length : 0, lo, hi }
  }
  const sul = todas.filter((r) => r.plano === 'cacador-ARG' || r.plano === 'cacador-BRA')
  const ks = sul.filter(f).length
  const [lo, hi] = wilson(ks, sul.length)
  const m = melhor(f, { minN: 1000 })
  out.rei[nome] = { porPlano, cacadorSul: { k: ks, n: sul.length, p: ks / sul.length, lo, hi }, melhor: m.melhor }
}
// decomposição: P(3 Copas) no melhor plano × P(2+ Libertadores | 2+ Copas) do caçador sul-americano (a 3ª Copa quase
// não muda as Libertadores, que vêm do clube)
{
  const sul = todas.filter((r) => r.plano === 'cacador-ARG' || r.plano === 'cacador-BRA' || r.plano === 'cacador-outros')
  const c2 = sul.filter((r) => r.copas >= 2)
  const l2c2 = c2.filter((r) => r.lib >= 2).length / Math.max(1, c2.length)
  const arg = todas.filter((r) => r.plano === 'cacador-ARG')
  const c3arg = arg.filter((r) => r.copas >= 3).length / Math.max(1, arg.length)
  const c2arg = arg.filter((r) => r.copas >= 2).length / Math.max(1, arg.length)
  // P(3+ | 2+) no conjunto de todas as carreiras de caçador e guloso (a razão é parecida entre seleções)
  const fortes = todas.filter((r) => ['cacador-ARG', 'cacador-BRA', 'cacador-outros', 'guloso-ESP', 'guloso'].includes(r.plano))
  const r32 = fortes.filter((r) => r.copas >= 3).length / Math.max(1, fortes.filter((r) => r.copas >= 2).length)
  out.rei.decomposicao = {
    pL2dadoC2: l2c2,
    nC2: c2.length,
    pC3argDireto: c3arg,
    pC2arg: c2arg,
    p3dado2: r32,
    pC3argPorRazao: c2arg * r32,
    estimativa3C2L: c2arg * r32 * l2c2,
  }
}

// ───────────────────────────── 4. emblemas ─────────────────────────────

/** Campos do HallEntry guardado que o servidor confere (ver ESCOLHA.criterios). */
const CAMPO = {
  copas: (r) => r.copas,
  libertadores: (r) => r.lib,
  champions: (r) => r.ucl,
  bolasOuro: (r) => r.bolas,
  titulos: (r) => r.titulos,
  gols: (r) => r.gols,
  jogos: (r) => r.jogos,
  nota: (r) => (r.notaHall ?? r.nota),
  pico: (r) => r.pico,
  temporadasMesmoClube: (r) => (r.v34 ? r.maxClube : null),
  clubes: (r) => r.clubes,
  chuteirasOuro: (r) => (r.v34 ? r.bot : null),
  mundiais: (r) => (r.v34 ? r.mundial : null),
}
function predCriterio(c) {
  return (r) => {
    for (const [k, v] of Object.entries(c)) {
      if (k === 'nacionalidade') {
        if (!v.includes(r.nat)) return false
        continue
      }
      if (k === 'copaPelaSelecao') {
        if (!r.v34) return null
        if (v && !(r.copaPropria >= 1)) return false
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
  const m = melhor(predCriterio(d.criterio), { minN: d.minN ?? 400 })
  out.emblemas.push({ ...d, medido: m })
}
if (ESCOLHA.emblemasCandidatos)
  out.emblemasCandidatos = ESCOLHA.emblemasCandidatos.map((c) => ({ ...c, medido: melhor(predCriterio(c.criterio), { minN: c.minN ?? 400 }) }))

// ───────────────────────────── coleção ─────────────────────────────

const J = Number(opt('jogadores', '300'))
out.colecao.hoje = colecionador('hoje', { jogadores: J, teto: Number(opt('teto', '12000')), semente: 7 })
out.colecao.novas = colecionador('novas', { jogadores: J, teto: Number(opt('teto', '12000')), semente: 7 })

writeFileSync(join(SAIDA, 'calibracao.json'), JSON.stringify(out, null, 1))

// ───────────────────────────── arquivos para os outros agentes ─────────────────────────────

const novasJson = {}
for (const [id, e] of Object.entries(ESCOLHA.conquistas)) {
  const m = out.novas[id].melhor
  novasJson[id] = {
    titulo: TITULO[id],
    descricao: e.descricao,
    regra: e.regra,
    parametros: e.parametros,
    antes: DESCRICAO[id],
    chance: m ? { umEm: umEm(m.p), p: Number(m.p.toFixed(6)), ic95: [umEm(m.hi), umEm(m.lo)], plano: m.plano, carreiras: m.n, vezes: m.k } : null,
  }
}
writeFileSync(join(SAIDA, 'conquistas-novas.json'), JSON.stringify(novasJson, null, 2) + '\n')
const emblemasJson = out.emblemas.map((d) => ({
  slug: d.slug,
  titulo: d.titulo,
  descricao: d.descricao,
  dificuldade: d.dificuldade,
  criterio: d.criterio,
  chance: d.medido.melhor
    ? {
        umEm: umEm(d.medido.melhor.p),
        p: Number(d.medido.melhor.p.toFixed(6)),
        ic95: [umEm(d.medido.melhor.hi), umEm(d.medido.melhor.lo)],
        plano: d.medido.melhor.plano,
        aleatoria: d.medido.aleatoria.p > 0 ? umEm(d.medido.aleatoria.p) : null,
      }
    : null,
  emblema: d.emblema,
  ordem: d.ordem,
}))
writeFileSync(join(SAIDA, 'desafios-emblema.json'), JSON.stringify(emblemasJson, null, 2) + '\n')

// ───────────────────────────── tabelas ─────────────────────────────

const md = []
md.push(`Carreiras: ${todas.length.toLocaleString('pt-BR')} (${Object.entries(out.porFonte).map(([k, v]) => `${k}: ${v.toLocaleString('pt-BR')}`).join(', ')}) + ${condicionais.length.toLocaleString('pt-BR')} do experimento condicional da v3.3 (fora das taxas).`)
md.push('')
md.push('### Hoje: as conquistas abaixo de 1 em 1.500 para o jogador dedicado')
md.push('')
md.push('| Conquista | Regra de hoje | Melhor chance por carreira | Plano | Vezes no estudo | O mais perto que saiu |')
md.push('|---|---|---:|---|---:|---|')
const raras = IDS.filter((id) => !out.hoje[id].melhor || out.hoje[id].melhor.p < 1 / 1500).sort((a, b) => (out.hoje[b].melhor?.p ?? 0) - (out.hoje[a].melhor?.p ?? 0))
for (const id of raras) {
  const h = out.hoje[id]
  md.push(`| ${h.titulo} (\`${id}\`) | ${DESCRICAO[id]} | ${h.melhor && h.melhor.k ? fmtUmEm(h.melhor.p) : '0'} | ${h.melhor?.k ? `${h.melhor.plano} (${h.melhor.k} em ${h.melhor.n.toLocaleString('pt-BR')})` : '—'} | ${h.vezes} | ${out.maisPerto[id] ?? ''} |`)
}
md.push('')
md.push('### Limites novos')
md.push('')
md.push('| Conquista | Antes | Agora | Chance nova (melhor plano) | IC 95% | Plano | Aleatória |')
md.push('|---|---|---|---:|---|---|---:|')
for (const [id, e] of Object.entries(out.novas)) {
  const m = e.melhor
  md.push(`| ${e.titulo} | ${e.antes} | ${e.descricao} | ${m ? fmtUmEm(m.p) : '—'} | ${m ? `${fmtUmEm(m.hi)} a ${fmtUmEm(m.lo)}` : ''} | ${m ? `${m.plano} (${m.k} em ${m.n.toLocaleString('pt-BR')})` : ''} | ${e.aleatoria.k ? fmtUmEm(e.aleatoria.p) : `0 em ${e.aleatoria.n.toLocaleString('pt-BR')}`} |`)
}
md.push('')
md.push('### Coleção (jogador dedicado, plano escolhido a cada carreira)')
md.push('')
for (const [k, c] of Object.entries(out.colecao)) {
  md.push(`- **${k}**: ${c.completos} de ${c.jogadores} completaram as 87; carreiras p10 ${c.carreiras.p10} · mediana ${c.carreiras.mediana} · p90 ${c.carreiras.p90}; conquistas depois de N carreiras: ${Object.entries(c.conquistasApos).map(([n, v]) => `${n}: ${v}`).join(' · ')}; o que mais faltou: ${Object.entries(c.faltaram).slice(0, 8).map(([id, f]) => `${TITULO[id]} ${pct(f)}`).join(', ')}`)
}
md.push('')
md.push('### Desafio do Rei e versões menores')
md.push('')
md.push('| Critério | Caçador argentino | Caçador brasileiro | Guloso espanhol | Aleatória | Caçador sul-americano (juntos) |')
md.push('|---|---:|---:|---:|---:|---:|')
for (const [nome, e] of Object.entries(out.rei)) {
  if (nome === 'decomposicao') continue
  const c = (x) => (x.k ? `${fmtUmEm(x.p)} (${x.k}/${x.n.toLocaleString('pt-BR')})` : `0/${x.n.toLocaleString('pt-BR')}`)
  md.push(`| ${nome} | ${c(e.porPlano['cacador-ARG'])} | ${c(e.porPlano['cacador-BRA'])} | ${c(e.porPlano['guloso-ESP'])} | ${c(e.porPlano.aleatoria)} | ${c(e.cacadorSul)} |`)
}
md.push('')
md.push('### Emblemas')
md.push('')
md.push('| Desafio | Dificuldade | Critério | Chance (melhor plano) | IC 95% | Plano | Aleatória |')
md.push('|---|---|---|---:|---|---|---:|')
for (const d of out.emblemas) {
  const m = d.medido.melhor
  md.push(`| ${d.titulo} | ${d.dificuldade} | \`${JSON.stringify(d.criterio)}\` | ${m ? fmtUmEm(m.p) : '—'} | ${m ? `${fmtUmEm(m.hi)} a ${fmtUmEm(m.lo)}` : ''} | ${m ? `${m.plano} (${m.k}/${m.n})` : ''} | ${d.medido.aleatoria.k ? fmtUmEm(d.medido.aleatoria.p) : `0/${d.medido.aleatoria.n}`} |`)
}
writeFileSync(join(SAIDA, 'tabelas.md'), md.join('\n') + '\n')
console.log(`calibração: ${todas.length} carreiras → ${SAIDA}/calibracao.json, conquistas-novas.json, desafios-emblema.json, tabelas.md`)
