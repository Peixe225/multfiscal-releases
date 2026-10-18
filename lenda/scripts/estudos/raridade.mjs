#!/usr/bin/env node
/**
 * Estudo de raridade das Taças do Rei (servidor/CONTRATO-v33.md §R).
 *
 *   node scripts/estudos/raridade.mjs simular --plano padrao --saida <pasta> [--workers 3] [--n 1000]
 *   node scripts/estudos/raridade.mjs analisar --saida <pasta>        (lê <pasta>/*.jsonl e escreve <pasta>/resumo.json)
 *
 * `simular` empacota scripts/estudos/raridade-motor.ts (o motor REAL do jogo, src/engine, e os dados reais
 * src/data/generated/game-data.json) com o rolldown numa pasta temporária, reparte as carreiras entre workers e grava
 * uma linha JSON por carreira em <pasta>/<plano>-<lote>.jsonl. Retoma de onde parou (pula as linhas que já existem).
 * Nada em src/ muda; a pasta de saída e a temporária ficam fora do repositório (padrão: o tmpdir do sistema).
 *
 * Planos:
 *   padrao     o estudo principal: aleatória, gananciosa e caçador × nacionalidades × posições × ritmos (sem bônus);
 *   bonus      o caçador com bônus de OVR +2 e +5 (o que um jogador ganha compartilhando e indicando);
 *   alvos      as políticas de alvo (mochileiro, sul-americano, fiel, europeu) para as conquistas de carreira montada;
 *   oraculo    o caçador que prova cada opção antes de escolher (o teto de quem "volta no tempo");
 *   sementes   as mesmas sementes com três políticas (quanto do mundo, como quem ganha cada Copa, vem só da semente);
 *   rapido     60 carreiras, para conferir que tudo roda.
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
    bonus: [
      { nome: 'cac-bonus2', pol: 'cacador', nacoes: ['BRA', 'ARG'], n: n(1000), bonus: 2 },
      { nome: 'cac-bonus5', pol: 'cacador', nacoes: ['BRA', 'ARG'], n: n(1000), bonus: 5 },
    ],
    oraculo: [{ nome: 'ora-sul', pol: 'oraculo', nacoes: ['BRA', 'ARG'], n: n(800), bonus: 0 }],
    // as MESMAS sementes com políticas diferentes: quanto do mundo (quem ganha cada Copa) já vem da semente
    sementes: ['aleatoria', 'gananciosa', 'cacador'].map((pol) => ({ nome: `sem-${pol}`, sal: 'sementes', pol, nacoes: ['ARG', 'BRA', 'ESP', 'FRA'], n: n(240), bonus: 0 })),
  }
}

function configs(lote, salt) {
  const out = []
  const ritmos = lote.ritmos ?? RITMOS
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
        pos: POSICOES[Math.floor(i / lote.nacoes.length) % POSICOES.length],
        pace: ritmos[Math.floor(i / (lote.nacoes.length * POSICOES.length)) % ritmos.length],
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

async function empacotar() {
  const { build } = await import('rolldown')
  const pasta = join(process.env.LENDA_ESTUDO_TMP || tmpdir(), `lenda-raridade-${process.pid}`)
  mkdirSync(pasta, { recursive: true })
  await build({
    input: join(AQUI, 'raridade-motor.ts'),
    platform: 'node',
    resolve: { alias: { '@': join(RAIZ, 'src') } },
    output: { dir: pasta, format: 'esm', entryFileNames: 'motor.mjs', codeSplitting: false },
    logLevel: 'warn',
  })
  return { pasta, pacote: join(pasta, 'motor.mjs') }
}

async function simular() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  mkdirSync(saida, { recursive: true })
  const nBase = Number(opt('n', '1000')) / 1000
  const plano = opt('plano', 'rapido')
  const lotes = planos(nBase)[plano]
  if (!lotes) throw new Error(`plano desconhecido: ${plano}`)
  const nw = Math.max(1, Number(opt('workers', String(Math.max(1, cpus().length - 1)))))
  const { pasta, pacote } = await empacotar()
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
    rmSync(pasta, { recursive: true, force: true })
  }
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
  const tudo = lerTudo(saida)
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
    let melhor = { p: 0, k: 0, n: 0, onde: null }
    for (const [lote, l] of grupo(tudo, (r) => r.lote)) {
      const k = l.filter((r) => r.conq.includes(i)).length
      if (l.length >= 100 && k / l.length > melhor.p) melhor = { p: k / l.length, k, n: l.length, onde: lote }
    }
    out.conquistasMelhor[id] = melhor
  }
  writeFileSync(join(saida, 'resumo.json'), JSON.stringify(out, null, 1))
  console.log(`resumo: ${join(saida, 'resumo.json')} (${tudo.length} carreiras)`)
}

async function conquistas() {
  const saida = resolve(opt('saida', join(tmpdir(), 'lenda-raridade')))
  mkdirSync(saida, { recursive: true })
  const { pasta } = await empacotar()
  try {
    const mod = await import(pathToFileURL(join(pasta, 'motor.mjs')).href)
    writeFileSync(join(saida, 'conquistas.json'), JSON.stringify({ ids: mod.IDS_CONQUISTAS, catalogo: mod.CATALOGO }, null, 1))
    console.log(`${mod.IDS_CONQUISTAS.length} conquistas → ${join(saida, 'conquistas.json')}`)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
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
else if (cmd === 'analisar') analisar()
else if (cmd === 'conquistas') await conquistas()
else {
  console.log('uso: node scripts/estudos/raridade.mjs simular|analisar|conquistas --saida <pasta> [--plano padrao|bonus|oraculo|rapido] [--n 1000] [--workers 3]')
  process.exit(1)
}
