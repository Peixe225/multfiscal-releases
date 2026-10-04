// Gera o logo da Green Cheese em geometria pura:
//   src/arte/logo-paths.ts  → paths usados por src/arte/Logo.tsx
//   public/favicon.svg      → versão estática simplificada (legível em 32 px)
//
// O "GREEN CHEESE" vira path com opentype.js a partir da Bowlby One (@fontsource/bowlby-one, .woff),
// já inclinado e curvado como se estivesse impresso na frente da cuia.
// A cuia e a tesoura são calculadas aqui, direto nas coordenadas finais do viewBox
// (sem transform aninhado), para a animação girar as lâminas em torno do parafuso sem surpresa.
//
// Rodar: node scripts/gerar-logo.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as otModulo from 'opentype.js'

const opentype = otModulo.default ?? otModulo
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONTE =
  process.env.LOGO_FONTE ??
  path.join(raiz, 'node_modules/@fontsource/bowlby-one/files/bowlby-one-latin-400-normal.woff')

// ---------------------------------------------------------------------------
// Utilidades de geometria: tudo vira contorno de cúbicas, para poder deformar e transformar.
// Contorno = { ini: [x, y], segs: [[c1x, c1y, c2x, c2y, x, y], ...], fechado }

const r1 = (n) => {
  const v = Math.round(n * 10) / 10
  return Object.is(v, -0) ? '0' : String(v)
}

function linhaCubica(a, b) {
  return [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3, b[0], b[1]]
}

/** Comandos do opentype (M L Q C Z) → contornos de cúbicas. */
function comandosParaContornos(cmds) {
  const contornos = []
  let atual = null
  let p = [0, 0]
  for (const c of cmds) {
    if (c.type === 'M') {
      atual = { ini: [c.x, c.y], segs: [], fechado: false }
      contornos.push(atual)
      p = [c.x, c.y]
    } else if (c.type === 'L') {
      atual.segs.push(linhaCubica(p, [c.x, c.y]))
      p = [c.x, c.y]
    } else if (c.type === 'Q') {
      atual.segs.push([
        p[0] + (2 / 3) * (c.x1 - p[0]), p[1] + (2 / 3) * (c.y1 - p[1]),
        c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y),
        c.x, c.y,
      ])
      p = [c.x, c.y]
    } else if (c.type === 'C') {
      atual.segs.push([c.x1, c.y1, c.x2, c.y2, c.x, c.y])
      p = [c.x, c.y]
    } else if (c.type === 'Z') {
      if (Math.hypot(p[0] - atual.ini[0], p[1] - atual.ini[1]) > 0.01) atual.segs.push(linhaCubica(p, atual.ini))
      atual.fechado = true
      p = atual.ini
    }
  }
  return contornos
}

/** Divide cúbicas longas (de Casteljau) para a deformação curvar até as retas. */
function subdividir(contorno, maxLen) {
  const segs = []
  let p = contorno.ini
  const dividir = (a, s) => {
    const [x1, y1, x2, y2, x, y] = s
    const len = Math.hypot(x1 - a[0], y1 - a[1]) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2)
    if (len <= maxLen) {
      segs.push(s)
      return
    }
    const m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]
    const p01 = m(a, [x1, y1]), p12 = m([x1, y1], [x2, y2]), p23 = m([x2, y2], [x, y])
    const p012 = m(p01, p12), p123 = m(p12, p23), meio = m(p012, p123)
    dividir(a, [...p01, ...p012, ...meio])
    dividir(meio, [...p123, ...p23, x, y])
  }
  for (const s of contorno.segs) {
    dividir(p, s)
    p = [s[4], s[5]]
  }
  return { ...contorno, segs }
}

function transformar(contornos, f) {
  return contornos.map((c) => ({
    ini: f(c.ini[0], c.ini[1]),
    segs: c.segs.map((s) => [...f(s[0], s[1]), ...f(s[2], s[3]), ...f(s[4], s[5])]),
    fechado: c.fechado,
  }))
}

/** Contornos → atributo d compacto (M absoluto + c relativo, em décimos exatos para não acumular erro). */
function paraD(contornos) {
  const dec = (n) => Math.round(n * 10)
  const num = (t) => {
    const v = t / 10
    return Object.is(v, -0) ? '0' : String(v)
  }
  const juntar = (vals) => vals.map(num).join(' ').replace(/ -/g, '-')
  return contornos
    .map((c) => {
      let px = dec(c.ini[0]), py = dec(c.ini[1])
      let d = `M${juntar([px, py])}`
      for (const s of c.segs) {
        const v = s.map(dec)
        d += `c${juntar([v[0] - px, v[1] - py, v[2] - px, v[3] - py, v[4] - px, v[5] - py])}`
        px = v[4]
        py = v[5]
      }
      return c.fechado ? d + 'Z' : d
    })
    .join('')
}

/** Área com sinal (aproximada pelos pontos de controle): > 0 = horário na tela (y para baixo). */
function area(c) {
  const pts = [c.ini, ...c.segs.flatMap((s) => [[s[0], s[1]], [s[2], s[3]], [s[4], s[5]]])]
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

function inverter(c) {
  const pts = [c.ini, ...c.segs.map((s) => [s[4], s[5]])]
  const segs = []
  for (let i = c.segs.length - 1; i >= 0; i--) {
    const s = c.segs[i]
    segs.push([s[2], s[3], s[0], s[1], pts[i][0], pts[i][1]])
  }
  return { ini: pts[pts.length - 1], segs, fechado: c.fechado }
}

/** Força o sentido: sólido = horário, furo = anti-horário (regra nonzero). */
const orientar = (c, horario) => ((area(c) > 0) === horario ? c : inverter(c))

/** Polígono/curva a partir de uma lista de passos: ['L', x, y] ou ['C', x1, y1, x2, y2, x, y]. */
function contorno(ini, passos, fechar = true) {
  let p = ini
  const segs = passos.map((s) => {
    const seg = s[0] === 'L' ? linhaCubica(p, [s[1], s[2]]) : s.slice(1)
    p = [seg[4], seg[5]]
    return seg
  })
  if (fechar && Math.hypot(p[0] - ini[0], p[1] - ini[1]) > 0.01) segs.push(linhaCubica(p, ini))
  return { ini, segs, fechado: fechar }
}

/** Ponto da cúbica no parâmetro t. */
function pontoCubica(p0, s, t) {
  const u = 1 - t
  return [
    u * u * u * p0[0] + 3 * u * u * t * s[0] + 3 * u * t * t * s[2] + t * t * t * s[4],
    u * u * u * p0[1] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
  ]
}


/** Elipse (rx, ry, girada rot rad) como 4 cúbicas. */
function elipse(cx, cy, rx, ry, rot = 0) {
  const k = 0.5522847498
  const cs = Math.cos(rot), sn = Math.sin(rot)
  const P = (x, y) => [cx + x * cs - y * sn, cy + x * sn + y * cs]
  const q = [
    [P(rx, 0), P(rx, ry * k), P(rx * k, ry), P(0, ry)],
    [P(0, ry), P(-rx * k, ry), P(-rx, ry * k), P(-rx, 0)],
    [P(-rx, 0), P(-rx, -ry * k), P(-rx * k, -ry), P(0, -ry)],
    [P(0, -ry), P(rx * k, -ry), P(rx, -ry * k), P(rx, 0)],
  ]
  return { ini: q[0][0], segs: q.map(([, a, b, c]) => [...a, ...b, ...c]), fechado: true }
}

const girar = (ang, cx = 0, cy = 0) => (x, y) => {
  const cs = Math.cos(ang), sn = Math.sin(ang)
  return [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]
}

const RAD = Math.PI / 180

// ---------------------------------------------------------------------------
// Fonte

const buf = fs.readFileSync(FONTE)
const fonte = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const altCaixa = (() => {
  const bb = fonte.charToGlyph('H').getBoundingBox()
  return bb.y2 - bb.y1
})()

/** Monta uma linha de texto sem o shaper (o GSUB de algumas fontes trava o opentype.js). */
function linhaTexto(texto, alturaCaixa, espaco = 0) {
  const tam = (alturaCaixa / altCaixa) * fonte.unitsPerEm
  const esc = tam / fonte.unitsPerEm
  let x = 0
  let anterior = null
  const contornos = []
  for (const ch of texto) {
    const g = fonte.charToGlyph(ch)
    if (anterior) x += fonte.getKerningValue(anterior, g) * esc
    contornos.push(...comandosParaContornos(g.getPath(x, 0, tam).commands))
    x += g.advanceWidth * esc + espaco
    anterior = g
  }
  // largura real pela caixa dos pontos
  const xs = contornos.flatMap((c) => [c.ini[0], ...c.segs.flatMap((s) => [s[0], s[2], s[4]])])
  return { contornos, x0: Math.min(...xs), x1: Math.max(...xs) }
}

// ---------------------------------------------------------------------------
// Peças compartilhadas pelo logo e pelo favicon

const VB = 512
const CX = 256

/**
 * Cuia vista levemente de cima: borda elíptica + corpo em U + pé (anel da base).
 * Devolve os contornos (para stroke) e medidas para conferir se o texto cabe dentro.
 */
function montarCuia(c) {
  const { cy, rx, ry } = c.borda
  const P0 = [CX - rx, cy]
  const s1 = [CX - rx + c.bojo[0], cy + c.bojo[1], CX - c.fundoLarg, c.fundoY, CX, c.fundoY]
  const espelho = (x) => 2 * CX - x
  const s2 = [espelho(s1[2]), s1[3], espelho(s1[0]), s1[1], CX + rx, cy]
  const corpo = { ini: P0, segs: [s1, s2], fechado: false }
  const borda = elipse(CX, cy, rx, ry)

  // amostra do lado esquerdo do corpo, para achar x por y e y por x
  const amostra = []
  for (let i = 0; i <= 600; i++) amostra.push(pontoCubica(P0, s1, i / 600))
  const xEmY = (y) => amostra.reduce((a, b) => (Math.abs(b[1] - y) < Math.abs(a[1] - y) ? b : a))[0]
  const yEmX = (x) => amostra.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a))[1]
  const meiaLargura = (y) => CX - xEmY(y) - c.traco / 2
  /** Distância real (perpendicular) até a parede do corpo, descontado o meio traço. */
  const distParede = (x, y) => {
    const xe = x < CX ? x : 2 * CX - x
    let m = Infinity
    for (const [ax, ay] of amostra) m = Math.min(m, Math.hypot(ax - xe, ay - y))
    return m - c.traco / 2
  }
  /** Borda de baixo do traço da frente da borda, na coluna x. */
  const bordaFrente = (x) => cy + ry * Math.sqrt(Math.max(0, 1 - ((x - CX) / rx) ** 2)) + c.traco / 2

  const contornos = { borda, corpo }
  if (c.pe) {
    // pé: duas laterais curtas saindo do corpo + meia elipse por baixo
    const { meia, desce, ry: pry } = c.pe
    const xTopo = CX - meia + 3
    const yTopo = yEmX(xTopo)
    const yBase = c.fundoY + desce
    const k = 0.5522847498
    contornos.pe = contorno(
      [xTopo, yTopo],
      [
        ['L', CX - meia, yBase],
        ['C', CX - meia, yBase + pry * k, CX - meia * k, yBase + pry, CX, yBase + pry],
        ['C', CX + meia * k, yBase + pry, CX + meia, yBase + pry * k, CX + meia, yBase],
        ['L', espelho(xTopo), yTopo],
      ],
      false,
    )
  }
  return { contornos, meiaLargura, bordaFrente, distParede }
}

/** Texto inclinado e enrolado na frente da cuia (perspectiva igual à da borda). */
function textoNaCuia(linhas, cfg, cuia, relatorio) {
  const topo = linhas[0].base - linhas[0].caixa
  const yRef = (topo + linhas[linhas.length - 1].base) / 2
  return linhas.map((ln) => {
    const l = linhaTexto(ln.texto, ln.caixa, ln.espaco ?? 0)
    const meio = (l.x0 + l.x1) / 2
    const contornos = l.contornos.map((c) => subdividir(c, 18))
    return transformar(contornos, (x, y) => {
      let px = x - meio + (cfg.dx ?? 0)
      const py = y + ln.base
      px += (yRef - py) * Math.tan(cfg.inclinacao) // itálico de rua
      const R = cfg.raio // enrola no cilindro: pontas comprimidas e mais altas
      const fi = px / R
      const sx = CX + R * Math.sin(fi)
      const sy = py - cfg.achatamento * R * (1 - Math.cos(fi))
      if (relatorio) {
        const fora = cuia.meiaLargura(sy) - Math.abs(sx - CX) < 0 // passou da parede
        relatorio.push([ln.texto, cuia.distParede(sx, sy) * (fora ? -1 : 1), sy, sy - cuia.bordaFrente(sx)])
      }
      return [sx, sy]
    })
  })
}

/**
 * Uma peça da tesoura (lâmina + miolo + haste + aro) no referencial próprio:
 * parafuso na origem, lâmina para +x. lado -1 = corpo da lâmina para cima (peça A), +1 = para baixo (B).
 */
function pecaTesoura(lado, t) {
  const L = t.lamina, W = t.larg, s = lado
  // fio reto no eixo, costas curvas afinando até a ponta
  const lamina = contorno([L, s * -1.5], [
    ['C', L * 0.78, s * W * 0.5, L * 0.42, s * W * 1.04, 24, s * W],
    // ombro: desce firme para dentro do miolo. Em ângulo aberto, o respiro da outra peça
    // corta limpo (em curva tangente sobraria uma farpa)
    ['L', 6, s * 8],
    ['L', -4, s * -5],
    ['L', 20, s * -3],
    ['C', L * 0.45, s * -2.4, L * 0.8, s * -2.2, L, s * -1.5],
  ])
  const miolo = elipse(0, 0, t.miolo, t.miolo)
  // haste até o aro, do lado oposto ao corpo da lâmina
  const { dist, desvio, rx, ry, esp } = t.aro
  const ac = [-dist, -s * desvio]
  const ang = Math.atan2(ac[1], ac[0])
  const perp = [-Math.sin(ang), Math.cos(ang)]
  const dir = [Math.cos(ang), Math.sin(ang)]
  const fim = [ac[0] - dir[0] * (rx - esp / 2), ac[1] - dir[1] * (rx - esp / 2)]
  const [h0, h1] = t.haste
  const haste = contorno([perp[0] * h0, perp[1] * h0], [
    ['L', fim[0] + perp[0] * h1, fim[1] + perp[1] * h1],
    ['L', fim[0] - perp[0] * h1, fim[1] - perp[1] * h1],
    ['L', -perp[0] * h0, -perp[1] * h0],
  ])
  return [
    orientar(lamina, true),
    orientar(miolo, true),
    orientar(haste, true),
    orientar(elipse(ac[0], ac[1], rx, ry, ang), true),
    orientar(elipse(ac[0], ac[1], rx - esp, ry - esp, ang), false),
  ]
}

/** Abre a peça (graus), inclina a tesoura inteira e leva o parafuso ao lugar. */
function posicionarPeca(contornos, aberturaGraus, t) {
  const abre = girar(aberturaGraus * RAD)
  const giro = girar(t.giro * RAD)
  return transformar(contornos, (x, y) => {
    const [a, b] = giro(...abre(x, y))
    return [a + t.pivo[0], b + t.pivo[1]]
  })
}

/**
 * Enquadra o desenho no círculo: centraliza a caixa e escala até o ponto mais distante
 * (somando a meia espessura do traço) ficar a `raioAlvo` do centro.
 */
function enquadrar(grupos, raioAlvo, margemTraco, ajusteY = 0) {
  // pontos sobre a curva (os de controle ficam fora dela e exagerariam o raio)
  const pts = grupos.flat().flatMap((c) => {
    const out = [c.ini]
    let p = c.ini
    for (const sg of c.segs) {
      for (let i = 1; i <= 8; i++) out.push(pontoCubica(p, sg, i / 8))
      p = [sg[4], sg[5]]
    }
    return out
  })
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const raio = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)))
  if (process.env.LOGO_DEBUG) {
    const longe = pts.find((p) => Math.hypot(p[0] - cx, p[1] - cy) === raio).map(Math.round)
    console.log('caixa', [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(Math.round), 'mais longe', longe)
  }
  const esc = (raioAlvo - margemTraco) / raio
  const f = (x, y) => [VB / 2 + (x - cx) * esc, VB / 2 + ajusteY + (y - cy) * esc]
  return { f, esc }
}

// ---------------------------------------------------------------------------
// Logo principal

const TRACO = 13 // traço uniforme da cuia (e espessura dos aros da tesoura)
const FOLGA = 7 // respiro preto entre elementos que se cruzam

const CUIA = {
  traco: TRACO,
  borda: { cy: 200, rx: 192, ry: 37 },
  bojo: [0, 185], // 1º ponto de controle do corpo (relativo à ponta da borda)
  fundoLarg: 150, // 2º ponto de controle: meia largura no fundo
  fundoY: 420,
  pe: { meia: 60, desce: 14, ry: 12 },
}
const TXT = {
  inclinacao: 13 * RAD,
  dx: 4, // o itálico puxa a base para a esquerda; compensa
  raio: 230,
  achatamento: CUIA.borda.ry / CUIA.borda.rx,
  linhas: [
    { texto: 'GREEN', caixa: 62, base: 320, espaco: 1 },
    { texto: 'CHEESE', caixa: 54, base: 383, espaco: 0 },
  ],
}
const TES = {
  pivo: [238, 146],
  giro: -11, // inclinação da tesoura inteira (graus)
  abertura: 14, // graus que cada lâmina abre a partir do eixo
  lamina: 150,
  larg: 27,
  miolo: 19,
  haste: [9, 7.5],
  aro: { dist: 98, desvio: 25, rx: 35, ry: 28, esp: TRACO },
  parafuso: 6,
}

const cuia = montarCuia(CUIA)
const relatorio = []
const [txtGreen, txtCheese] = textoNaCuia(TXT.linhas, TXT, cuia, relatorio)
const pecaA = posicionarPeca(pecaTesoura(-1, TES), -TES.abertura, TES)
const pecaB = posicionarPeca(pecaTesoura(1, TES), TES.abertura, TES)

for (const t of ['GREEN', 'CHEESE']) {
  // folga entre o texto e a parede interna da cuia (negativo = atravessa)
  const pts = relatorio.filter((r) => r[0] === t)
  const pior = pts.reduce((a, b) => (b[1] < a[1] ? b : a))
  const vert = Math.min(...pts.map((r) => r[3]))
  console.log(`${t}: folga lateral ${pior[1].toFixed(1)} (y ${pior[2].toFixed(0)}), abaixo da borda ${vert.toFixed(1)}, y ${Math.min(...pts.map((r) => r[2])).toFixed(0)}–${Math.max(...pts.map((r) => r[2])).toFixed(0)}`)
}

const cuiaContornos = Object.values(cuia.contornos).map((c) => [c])
const quadro = enquadrar([...cuiaContornos, txtGreen, txtCheese, pecaA, pecaB], VB / 2 - 30, TRACO / 2, 0)
const F = (cs) => paraD(transformar(cs, quadro.f))
const pivo = quadro.f(...TES.pivo)
console.log(`escala de enquadramento: ${quadro.esc.toFixed(3)}`)

// ---------------------------------------------------------------------------
// Favicon: mesma ideia, simplificada para 16–32 px. Corpo da cuia cheio de branco com "GC" vazado
// (massa sólida lê melhor que linha fina nesse tamanho) e tesoura em silhueta grossa.

const FAV_TRACO = 30
const FAV_FOLGA = 14
const FAV_CUIA = {
  traco: FAV_TRACO,
  borda: { cy: 214, rx: 200, ry: 48 },
  bojo: [0, 168],
  fundoLarg: 150,
  fundoY: 436,
  pe: null,
}
const FAV_TXT = {
  inclinacao: 12 * RAD,
  dx: 4,
  raio: 300,
  achatamento: FAV_CUIA.borda.ry / FAV_CUIA.borda.rx,
  linhas: [{ texto: 'GC', caixa: 116, base: 404, espaco: 10 }],
}
const FAV_TES = {
  pivo: [246, 132],
  giro: -12,
  abertura: 16,
  lamina: 150,
  larg: 40,
  miolo: 27,
  haste: [15, 13],
  aro: { dist: 96, desvio: 34, rx: 46, ry: 39, esp: 25 },
  parafuso: 0,
}
const favCuia = montarCuia(FAV_CUIA)
const favRel = []
const [favTxt] = textoNaCuia(FAV_TXT.linhas, FAV_TXT, favCuia, favRel)
console.log(
  `favicon GC: folga lateral ${favRel.reduce((a, b) => (b[1] < a[1] ? b : a))[1].toFixed(1)}, abaixo da borda ${Math.min(...favRel.map((r) => r[3])).toFixed(1)}`,
)
// corpo fechado: U da esquerda para a direita + metade da frente da borda voltando
const favCorpo = {
  ini: favCuia.contornos.corpo.ini,
  segs: [...favCuia.contornos.corpo.segs, ...favCuia.contornos.borda.segs.slice(0, 2)],
  fechado: true,
}
const favA = posicionarPeca(pecaTesoura(-1, FAV_TES), -FAV_TES.abertura, FAV_TES)
const favB = posicionarPeca(pecaTesoura(1, FAV_TES), FAV_TES.abertura, FAV_TES)
const favQuadro = enquadrar([[favCuia.contornos.borda], [favCorpo], favA, favB], VB / 2 - 20, FAV_TRACO / 2)
const FF = (cs) => paraD(transformar(cs, favQuadro.f))

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">
<title>Green Cheese Imports</title>
<circle cx="${VB / 2}" cy="${VB / 2}" r="${VB / 2}" fill="#000"/>
<path d="${FF([favCorpo])}" fill="#fff" stroke="#fff" stroke-width="${FAV_TRACO}" stroke-linejoin="round"/>
<path d="${FF([favCuia.contornos.borda])}" fill="none" stroke="#fff" stroke-width="${FAV_TRACO}"/>
<path d="${FF(favTxt)}" fill="#000"/>
<g fill="#fff" stroke="#000" stroke-width="${FAV_FOLGA * 2}" stroke-linejoin="round" paint-order="stroke">
<path d="${FF(favA)}"/>
<path d="${FF(favB)}"/>
</g>
</svg>
`

// ---------------------------------------------------------------------------
// Saída

const ts = `// GERADO por scripts/gerar-logo.mjs — não editar à mão (rode "node scripts/gerar-logo.mjs").
// Paths do logo da Green Cheese no viewBox ${VB}×${VB}. Texto em Bowlby One, convertido em path.

export const LOGO_VIEWBOX = '0 0 ${VB} ${VB}'

/** Círculo preto (foto de perfil). */
export const LOGO_CIRCULO = { cx: ${VB / 2}, cy: ${VB / 2}, r: ${VB / 2} } as const

/** Espessura do traço da cuia e do respiro preto entre elementos que se cruzam. */
export const LOGO_TRACO = ${TRACO}
export const LOGO_FOLGA = ${FOLGA}

/** Traços da cuia (stroke, sem fill): borda elíptica, corpo em U e pé. */
export const LOGO_CUIA = {
  borda: '${F([cuia.contornos.borda])}',
  corpo: '${F([cuia.contornos.corpo])}',
  pe: '${F([cuia.contornos.pe])}',
} as const

/** "GREEN" e "CHEESE" já inclinados e curvados na frente da cuia. */
export const LOGO_TEXTO = {
  green: '${F(txtGreen)}',
  cheese: '${F(txtCheese)}',
} as const

/** Cada peça da tesoura (lâmina + aro), na pose aberta do logo. Fill, regra nonzero. */
export const LOGO_LAMINAS = {
  a: '${F(pecaA)}',
  b: '${F(pecaB)}',
} as const

/** Parafuso da tesoura: centro de giro das lâminas, em coordenadas do viewBox. */
export const LOGO_PIVO = { x: ${r1(pivo[0])}, y: ${r1(pivo[1])}, r: ${r1(TES.parafuso * quadro.esc)} } as const

/** Graus para fechar cada lâmina a partir da pose do logo (girando em torno de LOGO_PIVO). */
export const LOGO_FECHAR = { a: ${TES.abertura}, b: ${-TES.abertura} } as const
`

fs.mkdirSync(path.join(raiz, 'src/arte'), { recursive: true })
fs.writeFileSync(path.join(raiz, 'src/arte/logo-paths.ts'), ts)
fs.writeFileSync(path.join(raiz, 'public/favicon.svg'), favicon)
console.log(`ok: src/arte/logo-paths.ts ${(ts.length / 1024).toFixed(1)} KB · public/favicon.svg ${(favicon.length / 1024).toFixed(1)} KB`)
