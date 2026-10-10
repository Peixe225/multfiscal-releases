// Gera src/dados/mapa-brasil.ts: o Brasil em pixel art, com o formato de verdade de cada estado.
// Fonte: IBGE — malha das UFs (API de malhas, qualidade mínima). Só roda em dev; o site lê o arquivo gerado (sem fetch no ar).
//
// Uso:
//   node scripts/gerar-mapa-brasil.mjs                      baixa a malha do IBGE e gera o arquivo
//   node scripts/gerar-mapa-brasil.mjs malha.json           usa uma malha já baixada (GeoJSON das 27 UFs)
//   node scripts/gerar-mapa-brasil.mjs --previa /tmp/mapa   também desenha PNGs ampliados (8×) para conferir
//
// Como funciona: projeta a malha (Albers cônica do Brasil, a mesma família dos mapas do IBGE), cobre o país com
// uma grade e, em cada célula, sorteia 6×6 pontos para saber de qual estado ela é (o que tiver mais pontos).
// Estado pequeno (DF, SE, AL, RJ, ES) nunca some: se ficar com menos de MIN_CELULAS, ganha as células onde ele
// mais aparece. Pedaço solto de 1–2 células (ruído da grade) volta para o vizinho.
// A lupa é uma segunda grade, mais fina, só do Sudeste + Santa Catarina, recortada num círculo.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const URL_IBGE =
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&intrarregiao=UF&qualidade=minima'

// Larguras das grades, em células. O mapa inteiro precisa caber em 2–3 px por célula no celular.
const LARGURA_BRASIL = 92
const DIAMETRO_LUPA = 64
const AMOSTRAS = 6 // por lado, em cada célula
const MIN_CELULAS = 4
// Célula vira terra quando pelo menos esta fração dela é Brasil (o litoral não come as pontas finas).
const LIMIAR_TERRA = 0.38

// Código do IBGE → sigla.
const SIGLAS = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
}

// Uma letra por estado no texto da grade (dá para "ver" o Brasil no arquivo gerado).
const LETRA = {
  AC: 'a', AL: 'l', AP: 'P', AM: 'M', BA: 'b', CE: 'c', DF: 'D', ES: 'e', GO: 'g',
  MA: 'm', MT: 'T', MS: 'S', MG: 'G', PA: 'p', PB: 'B', PR: 'r', PE: 'E', PI: 'i',
  RJ: 'j', RN: 'N', RS: 'R', RO: 'o', RR: 'O', SC: 'C', SP: 's', SE: 'x', TO: 't',
}
const MAR = '.'

// Estados da lupa (os atendidos). Ela é centrada neles.
const LUPA_UFS = ['SP', 'MG', 'RJ', 'ES', 'SC']

// Cidades atendidas (lon, lat), para o pino ficar na cidade de verdade. Chave = slug de canais.ts.
const CIDADES = {
  'teofilo-otoni': [-41.5051, -17.8595],
  'rio-de-janeiro': [-43.1964, -22.9083],
}

/* ───────────── projeção: Albers cônica equivalente (paralelos -2° e -22°, origem -12°, -54°) ───────────── */

const rad = Math.PI / 180
const [phi1, phi2, phi0, lam0] = [-2 * rad, -22 * rad, -12 * rad, -54 * rad]
const n = (Math.sin(phi1) + Math.sin(phi2)) / 2
const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1)
const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n
function projetar([lon, lat]) {
  const rho = Math.sqrt(C - 2 * n * Math.sin(lat * rad)) / n
  const theta = n * (lon * rad - lam0)
  // y cresce para baixo (sul), como na tela
  return [rho * Math.sin(theta), -(rho0 - rho * Math.cos(theta))]
}

/* ───────────── malha ───────────── */

async function lerMalha(arquivo) {
  if (arquivo) return JSON.parse(readFileSync(arquivo, 'utf8'))
  const r = await fetch(URL_IBGE)
  if (!r.ok) throw new Error(`IBGE respondeu ${r.status}. Baixe a malha à mão (curl -o malha.json "${URL_IBGE}") e passe o arquivo.`)
  return r.json()
}

/** Cada UF vira uma lista de anéis projetados, com a caixa de cada um para descartar rápido. */
function prepararEstados(geo) {
  const estados = []
  for (const f of geo.features) {
    const sigla = SIGLAS[Number(f.properties.codarea)]
    if (!sigla) throw new Error(`código desconhecido: ${f.properties.codarea}`)
    const poligonos = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const aneis = []
    for (const pol of poligonos) {
      pol.forEach((anel, k) => {
        const pts = anel.map(projetar)
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        aneis.push({ pts, buraco: k > 0, caixa: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] })
      })
    }
    estados.push({ sigla, aneis })
  }
  if (estados.length !== 27) throw new Error(`esperava 27 UFs, veio ${estados.length}`)
  return estados
}

function dentroDoAnel(x, y, pts) {
  let dentro = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

function estadoNoPonto(estados, x, y) {
  for (const e of estados) {
    let dentro = false
    for (const a of e.aneis) {
      const [x0, y0, x1, y1] = a.caixa
      if (x < x0 || x > x1 || y < y0 || y > y1) continue
      if (dentroDoAnel(x, y, a.pts)) dentro = a.buraco ? false : true
    }
    if (dentro) return e.sigla
  }
  return null
}

/* ───────────── rasterização ───────────── */

/**
 * Cobre a janela [x0, y0, lado] com w × h células e devolve a grade de siglas (null = mar).
 * `mascara(cx, cy)` pode recusar células (o círculo da lupa).
 */
function rasterizar(estados, { x0, y0, passo, w, h, mascara, garantir }) {
  const cobertura = [] // por célula: { sigla: fração }
  const grade = []
  for (let j = 0; j < h; j++) {
    const linha = []
    const cobLinha = []
    for (let i = 0; i < w; i++) {
      const cont = {}
      let terra = 0
      if (!mascara || mascara(i + 0.5, j + 0.5)) {
        for (let sy = 0; sy < AMOSTRAS; sy++) {
          for (let sx = 0; sx < AMOSTRAS; sx++) {
            const x = x0 + (i + (sx + 0.5) / AMOSTRAS) * passo
            const y = y0 + (j + (sy + 0.5) / AMOSTRAS) * passo
            const s = estadoNoPonto(estados, x, y)
            if (s) {
              cont[s] = (cont[s] ?? 0) + 1
              terra++
            }
          }
        }
      }
      const total = AMOSTRAS * AMOSTRAS
      for (const k in cont) cont[k] /= total
      cobLinha.push(cont)
      let melhor = null
      if (terra / total >= LIMIAR_TERRA) {
        for (const k in cont) if (!melhor || cont[k] > cont[melhor]) melhor = k
      }
      linha.push(melhor)
    }
    grade.push(linha)
    cobertura.push(cobLinha)
  }

  limparSoltos(grade)

  // estado pequeno nunca some: pega as células onde ele mais aparece
  for (const sigla of garantir) {
    let tem = contar(grade, sigla)
    if (tem >= MIN_CELULAS) continue
    const candidatas = []
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (cobertura[j][i][sigla] && grade[j][i] !== sigla) candidatas.push([cobertura[j][i][sigla], i, j])
    candidatas.sort((a, b) => b[0] - a[0])
    for (const [, i, j] of candidatas) {
      if (tem >= MIN_CELULAS) break
      // não rouba a última célula de outro estado pequeno
      const dono = grade[j][i]
      if (dono && contar(grade, dono) <= MIN_CELULAS) continue
      grade[j][i] = sigla
      tem++
    }
    if (tem < MIN_CELULAS) console.warn(`⚠ ${sigla} ficou com ${tem} células`)
  }
  return grade
}

function contar(grade, sigla) {
  let c = 0
  for (const l of grade) for (const s of l) if (s === sigla) c++
  return c
}

const VIZ4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Pedaços de 1–2 células separados do corpo do estado voltam para o vizinho mais comum (ou para o mar). */
function limparSoltos(grade) {
  const h = grade.length
  const w = grade[0].length
  const visto = grade.map((l) => l.map(() => false))
  const pedacos = {}
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = grade[j][i]
      if (!s || visto[j][i]) continue
      const celulas = []
      const pilha = [[i, j]]
      visto[j][i] = true
      while (pilha.length) {
        const [x, y] = pilha.pop()
        celulas.push([x, y])
        for (const [dx, dy] of VIZ4) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || visto[ny][nx] || grade[ny][nx] !== s) continue
          visto[ny][nx] = true
          pilha.push([nx, ny])
        }
      }
      ;(pedacos[s] ??= []).push(celulas)
    }
  }
  for (const s in pedacos) {
    const lista = pedacos[s].sort((a, b) => b.length - a.length)
    for (const p of lista.slice(1)) {
      if (p.length > 2) continue
      for (const [x, y] of p) {
        const viz = {}
        for (const [dx, dy] of VIZ4) {
          const v = grade[y + dy]?.[x + dx]
          if (v !== undefined) viz[v ?? MAR] = (viz[v ?? MAR] ?? 0) + 1
        }
        delete viz[s]
        const melhor = Object.entries(viz).sort((a, b) => b[1] - a[1])[0]?.[0]
        grade[y][x] = !melhor || melhor === MAR ? null : melhor
      }
    }
  }
}

/** Ponto de rótulo: a célula do estado mais longe da borda (desempate: mais perto do centro de massa). */
function pontosDeRotulo(grade) {
  const h = grade.length
  const w = grade[0].length
  const siglas = new Set(grade.flat().filter(Boolean))
  const saida = {}
  for (const s of siglas) {
    // distância (em passos de 8 vizinhos) até a célula mais próxima que não é do estado
    const dist = grade.map((l) => l.map((v) => (v === s ? Infinity : 0)))
    for (let passo = 0; passo < 2; passo++) {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          if (dist[j][i] === 0) continue
          const a = Math.min(dist[j - 1]?.[i] ?? 0, dist[j]?.[i - 1] ?? 0, dist[j - 1]?.[i - 1] ?? 0, dist[j - 1]?.[i + 1] ?? 0) + 1
          dist[j][i] = Math.min(dist[j][i], a)
        }
      for (let j = h - 1; j >= 0; j--)
        for (let i = w - 1; i >= 0; i--) {
          if (dist[j][i] === 0) continue
          const b = Math.min(dist[j + 1]?.[i] ?? 0, dist[j]?.[i + 1] ?? 0, dist[j + 1]?.[i + 1] ?? 0, dist[j + 1]?.[i - 1] ?? 0) + 1
          dist[j][i] = Math.min(dist[j][i], b)
        }
    }
    let sx = 0
    let sy = 0
    let k = 0
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (grade[j][i] === s) {
          sx += i + 0.5
          sy += j + 0.5
          k++
        }
    const [cx, cy] = [sx / k, sy / k]
    let melhor = null
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if (grade[j][i] !== s) continue
        const d = dist[j][i]
        const perto = Math.hypot(i + 0.5 - cx, j + 0.5 - cy)
        if (!melhor || d > melhor.d || (d === melhor.d && perto < melhor.perto)) melhor = { d, perto, i, j }
      }
    saida[s.toLowerCase()] = [melhor.i + 0.5, melhor.j + 0.5]
  }
  return saida
}

const paraTexto = (grade) => grade.map((l) => l.map((s) => (s ? LETRA[s] : MAR)).join(''))

/* ───────────── principal ───────────── */

const args = process.argv.slice(2)
const iPrevia = args.indexOf('--previa')
const pastaPrevia = iPrevia >= 0 ? args[iPrevia + 1] : null
const arquivo = args.find((a, k) => !a.startsWith('--') && (iPrevia < 0 || k !== iPrevia + 1))

const geo = await lerMalha(arquivo)
const estados = prepararEstados(geo)

// caixa do Brasil projetado
let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity]
for (const e of estados)
  for (const a of e.aneis) {
    bx0 = Math.min(bx0, a.caixa[0])
    by0 = Math.min(by0, a.caixa[1])
    bx1 = Math.max(bx1, a.caixa[2])
    by1 = Math.max(by1, a.caixa[3])
  }
const passoB = (bx1 - bx0) / LARGURA_BRASIL
const hB = Math.ceil((by1 - by0) / passoB)
const todas = Object.keys(LETRA)
const gradeB = rasterizar(estados, { x0: bx0, y0: by0, passo: passoB, w: LARGURA_BRASIL, h: hB, garantir: todas })

// lupa: círculo que cobre os atendidos com folga
let [lx0, ly0, lx1, ly1] = [Infinity, Infinity, -Infinity, -Infinity]
for (const e of estados) {
  if (!LUPA_UFS.includes(e.sigla)) continue
  for (const a of e.aneis)
    for (const [x, y] of a.pts) {
      lx0 = Math.min(lx0, x)
      ly0 = Math.min(ly0, y)
      lx1 = Math.max(lx1, x)
      ly1 = Math.max(ly1, y)
    }
}
// centro: meio da caixa; raio: o ponto atendido mais longe do centro + 6% de folga
const lcx = (lx0 + lx1) / 2
const lcy = (ly0 + ly1) / 2
let raio = 0
for (const e of estados) {
  if (!LUPA_UFS.includes(e.sigla)) continue
  for (const a of e.aneis) for (const [x, y] of a.pts) raio = Math.max(raio, Math.hypot(x - lcx, y - lcy))
}
raio *= 1.06
const passoL = (2 * raio) / DIAMETRO_LUPA
const meio = DIAMETRO_LUPA / 2
const gradeL = rasterizar(estados, {
  x0: lcx - raio,
  y0: lcy - raio,
  passo: passoL,
  w: DIAMETRO_LUPA,
  h: DIAMETRO_LUPA,
  mascara: (cx, cy) => Math.hypot(cx - meio, cy - meio) <= meio,
  garantir: LUPA_UFS,
})

const noB = ([x, y]) => [+((x - bx0) / passoB).toFixed(2), +((y - by0) / passoB).toFixed(2)]
const naL = ([x, y]) => [+((x - (lcx - raio)) / passoL).toFixed(2), +((y - (lcy - raio)) / passoL).toFixed(2)]
const cidades = {}
for (const [slug, ll] of Object.entries(CIDADES)) {
  const p = projetar(ll)
  cidades[slug] = { brasil: noB(p), lupa: naL(p) }
}

// rótulos da lupa: atendidos sempre; vizinhos só quando têm corpo para a sigla caber (PR entre SP e SC, GO, MS, BA…)
const rotulosL = Object.fromEntries(
  Object.entries(pontosDeRotulo(gradeL)).filter(([s]) => LUPA_UFS.includes(s.toUpperCase()) || contar(gradeL, s.toUpperCase()) >= 40),
)

const legenda = Object.fromEntries(Object.entries(LETRA).map(([s, l]) => [l, s.toLowerCase()]))
// objeto → texto TS (chave sem aspas quando dá, aspas simples, espaço depois da vírgula)
const chave = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`)
const valor = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' ? `'${v}'` : fmt(v))
const fmt = (o) => `{ ${Object.entries(o).map(([k, v]) => `${chave(k)}: ${valor(v)}`).join(', ')} }`

const saida = `// GERADO por scripts/gerar-mapa-brasil.mjs — não editar à mão (rode o script de novo).
// Fonte: IBGE, malha das unidades da federação (API de malhas, qualidade mínima), em projeção Albers do Brasil.
//
// Cada caractere é uma célula do mapa: '${MAR}' = mar ou fora do Brasil; cada letra é um estado (legenda abaixo).
// O \`brasil\` é o país inteiro; a \`lupa\` é o Sudeste + Santa Catarina ampliado, recortado num círculo.

export interface MalhaPixel {
  w: number
  h: number
  linhas: string[]
  /** Onde escrever a sigla de cada UF (célula mais funda do estado), em células. */
  rotulos: Record<string, [number, number]>
}

/** Letra da grade → sigla minúscula da UF. */
export const legenda: Record<string, string> = ${fmt(legenda)}

export const brasil: MalhaPixel = {
  w: ${LARGURA_BRASIL},
  h: ${hB},
  rotulos: ${fmt(pontosDeRotulo(gradeB))},
  linhas: [
${paraTexto(gradeB)
  .map((l) => `    '${l}',`)
  .join('\n')}
  ],
}

/** A lupa: grade quadrada (só o círculo inscrito tem terra). \`noBrasil\` = centro e raio dela no mapa inteiro, em células. */
export const lupa: MalhaPixel & { noBrasil: { cx: number; cy: number; raio: number } } = {
  w: ${DIAMETRO_LUPA},
  h: ${DIAMETRO_LUPA},
  noBrasil: { cx: ${+((lcx - bx0) / passoB).toFixed(2)}, cy: ${+((lcy - by0) / passoB).toFixed(2)}, raio: ${+(raio / passoB).toFixed(2)} },
  rotulos: ${fmt(rotulosL)},
  linhas: [
${paraTexto(gradeL)
  .map((l) => `    '${l}',`)
  .join('\n')}
  ],
}

/** Cidades atendidas (slug de canais.ts): posição no mapa inteiro e na lupa, em células. */
export const cidadesNoMapa: Record<string, { brasil: [number, number]; lupa: [number, number] }> = ${fmt(cidades)}
`

const destino = new URL('../src/dados/mapa-brasil.ts', import.meta.url).pathname
writeFileSync(destino, saida)
console.log(`✓ ${destino}`)
console.log(`  brasil ${LARGURA_BRASIL}×${hB}, lupa ${DIAMETRO_LUPA}×${DIAMETRO_LUPA}`)
const resumo = todas.map((s) => `${s} ${contar(gradeB, s)}`).join(' · ')
console.log(`  células por UF: ${resumo}`)
console.log(`  na lupa: ${LUPA_UFS.map((s) => `${s} ${contar(gradeL, s)}`).join(' · ')}`)

/* ───────────── prévia (PNG 8×) ───────────── */

if (pastaPrevia) {
  const { default: sharp } = await import('sharp')
  mkdirSync(pastaPrevia, { recursive: true })
  const cores = {}
  todas.forEach((s, k) => {
    const h = (k * 137.5) % 360
    cores[s] = `hsl(${h} 55% ${LUPA_UFS.includes(s) ? 75 : 42}%)`
  })
  const desenhar = (grade, nome, z = 8) => {
    const h = grade.length
    const w = grade[0].length
    let rects = ''
    grade.forEach((l, j) => l.forEach((s, i) => {
      if (s) rects += `<rect x="${i * z}" y="${j * z}" width="${z}" height="${z}" fill="${cores[s]}"/>`
    }))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * z}" height="${h * z}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#000"/>${rects}</svg>`
    return sharp(Buffer.from(svg)).png().toFile(`${pastaPrevia}/${nome}.png`)
  }
  await desenhar(gradeB, 'brasil-8x')
  await desenhar(gradeL, 'lupa-8x')
  await desenhar(gradeB, 'brasil-2x', 2)
  console.log(`✓ prévia em ${pastaPrevia}`)
}
