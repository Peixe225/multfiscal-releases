// Gera o logo da Green Cheese:
//   src/arte/logo-paths.ts → desenho completo (cuia, texto, tesoura), grades pixel do compacto e LOGO_PIXELS (abertura)
//   public/favicon.svg     → favicon pixelado à mão (grades 16 e 32, crispEdges)
//   public/apple-touch-icon.png (sempre) e public/og.png (só se não existir ou com LOGO_OG=refazer; o "npm run og" faz a versão com produtos)
//
// O "GREEN CHEESE" vira path com opentype.js (fonte em LOGO_FONTE ou a padrão abaixo), inclinado e enrolado
// na frente da cuia. A cuia é um contorno preenchido de espessura variável (pincel: fundo e frente mais grossos,
// borda de trás mais fina, leve torto de mão), não um stroke uniforme. Tudo nas coordenadas finais do viewBox.
//
// Rodar:            node scripts/gerar-logo.mjs
// Prévia (não grava o projeto): LOGO_PREVIA=saida.png [LOGO_FONTE=fonte.woff] node scripts/gerar-logo.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as otModulo from 'opentype.js'
import sharp from 'sharp'

const opentype = otModulo.default ?? otModulo
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONTE_PADRAO = 'node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff'
const FONTE = process.env.LOGO_FONTE ?? path.join(raiz, FONTE_PADRAO)
const NOME_FONTE = process.env.LOGO_FONTE ? path.basename(FONTE).replace(/-latin.*$/, '') : 'Archivo Black'
const PREVIA = process.env.LOGO_PREVIA

// ---------------------------------------------------------------------------
// Geometria: tudo vira contorno de cúbicas, para poder deformar e transformar.
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

/** Divide cúbicas longas (de Casteljau) para a deformação curvar até as retas. Descarta segmentos nulos. */
function subdividir(contorno, maxLen) {
  const segs = []
  let p = contorno.ini
  const dividir = (a, s) => {
    const [x1, y1, x2, y2, x, y] = s
    const len = Math.hypot(x1 - a[0], y1 - a[1]) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2)
    if (len < 0.05) return // ponto repetido da fonte
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

/**
 * Contornos → atributo d compacto: M absoluto + c/l relativos em décimos exatos (sem acumular erro),
 * sem segmentos nulos, cúbica reta vira "l" e a letra repetida é omitida.
 */
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
      let cmd = 'M'
      const emitir = (letra, vals) => {
        const corpo = juntar(vals)
        if (letra === cmd) d += corpo.startsWith('-') ? corpo : ' ' + corpo
        else d += letra + corpo
        cmd = letra
      }
      for (const s of c.segs) {
        const v = s.map(dec)
        const r = [v[0] - px, v[1] - py, v[2] - px, v[3] - py, v[4] - px, v[5] - py]
        if (r.every((x) => x === 0)) continue
        const [dx, dy] = [r[4], r[5]]
        const len2 = dx * dx + dy * dy
        // pontos de controle a menos de 0,12 da corda (e dentro dela) = reta
        const naCorda = (x, y) => {
          if (len2 === 0) return false
          const t = (x * dx + y * dy) / len2
          return t >= -0.02 && t <= 1.02 && Math.abs(x * dy - y * dx) / Math.sqrt(len2) <= 1.2
        }
        if (naCorda(r[0], r[1]) && naCorda(r[2], r[3])) emitir('l', [dx, dy])
        else emitir('c', r)
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

function pontoCubica(p0, s, t) {
  const u = 1 - t
  return [
    u * u * u * p0[0] + 3 * u * u * t * s[0] + 3 * u * t * t * s[2] + t * t * t * s[4],
    u * u * u * p0[1] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
  ]
}

function derivadaCubica(p0, s, t) {
  const u = 1 - t
  return [
    3 * u * u * (s[0] - p0[0]) + 6 * u * t * (s[2] - s[0]) + 3 * t * t * (s[4] - s[2]),
    3 * u * u * (s[1] - p0[1]) + 6 * u * t * (s[3] - s[1]) + 3 * t * t * (s[5] - s[3]),
  ]
}

/** Catmull-Rom uniforme → cúbicas que passam pelos pontos. */
function catmull(pts, fechado) {
  const n = pts.length
  const P = (i) => (fechado ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const segs = []
  for (let i = 0; i < (fechado ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    segs.push([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]])
  }
  return { ini: pts[0], segs, fechado }
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
function linhaTexto(texto, alturaCaixa, espaco = 0, f = fonte, alt = altCaixa) {
  const tam = (alturaCaixa / alt) * f.unitsPerEm
  const esc = tam / f.unitsPerEm
  let x = 0
  let anterior = null
  const contornos = []
  for (const ch of texto) {
    const g = f.charToGlyph(ch)
    if (anterior) x += f.getKerningValue(anterior, g) * esc
    contornos.push(...comandosParaContornos(g.getPath(x, 0, tam).commands))
    x += g.advanceWidth * esc + espaco
    anterior = g
  }
  const xs = contornos.flatMap((c) => [c.ini[0], ...c.segs.flatMap((s) => [s[0], s[2], s[4]])])
  return { contornos, x0: Math.min(...xs), x1: Math.max(...xs), avanco: x }
}

// ---------------------------------------------------------------------------
// Peças

const VB = 512
const CX = 256

/**
 * Cuia vista levemente de cima, larga e rasa (a cuia de silicone RAW que a loja vende), sem pé.
 * Borda: elipse externa e interna com centros deslocados → a frente sai mais grossa que o fundo.
 * Corpo: linha central em U com contorno de espessura variável (mais grosso no fundo) e torto leve de mão.
 */
function montarCuia(c) {
  const { cy, rx, ry } = c.borda
  const { frente, fundo, lado, corpoFundo, corpoPonta } = c.larg
  const m = c.mao
  const dV = (frente - fundo) / 4
  const sV = (frente + fundo) / 4
  const bordaFora = orientar(elipse(CX, cy + dV, rx + lado / 2, ry + sV), true)
  const bordaDentro = orientar(elipse(CX + m.dx, cy - dV, rx - lado / 2, ry - sV, m.giro * RAD), false)

  const P0 = [CX - rx, cy]
  const s1 = [CX - rx + c.bojo[0], cy + c.bojo[1], CX - c.fundoLarg, c.fundoY, CX, c.fundoY]
  const P1 = [CX, c.fundoY]
  const s2 = [CX + c.fundoLarg + m.assim, c.fundoY, CX + rx - c.bojo[0], cy + c.bojo[1] + m.assim, CX + rx, cy]
  const N = 16
  const amostra = [] // [ponto, normal para fora, u]
  for (let i = 0; i <= N; i++) {
    const t = i / N
    amostra.push([pontoCubica(P0, s1, t), derivadaCubica(P0, s1, t), t / 2])
  }
  for (let i = 1; i <= N; i++) {
    const t = i / N
    amostra.push([pontoCubica(P1, s2, t), derivadaCubica(P1, s2, t), 0.5 + t / 2])
  }
  const largura = (u) =>
    corpoPonta + (corpoFundo - corpoPonta) * Math.pow(Math.sin(Math.PI * u), 1.4) + m.w * (0.55 * Math.sin(7.1 * u + 1.1) + 0.45 * Math.sin(12.7 * u + 0.4))
  const fora = [], dentro = [], meias = []
  for (const [p, d, u] of amostra) {
    const l = Math.hypot(d[0], d[1]) || 1
    const n = [-d[1] / l, d[0] / l]
    const w = largura(u) / 2
    fora.push([p[0] + n[0] * w, p[1] + n[1] * w])
    dentro.push([p[0] - n[0] * w, p[1] - n[1] * w])
    meias.push([p, w])
  }
  const ladoFora = catmull(fora, false)
  const ladoDentro = catmull([...dentro].reverse(), false)
  const corpo = orientar(
    {
      ini: fora[0],
      segs: [...ladoFora.segs, linhaCubica(fora.at(-1), dentro.at(-1)), ...ladoDentro.segs, linhaCubica(dentro[0], fora[0])],
      fechado: true,
    },
    true,
  )

  // medidas para conferir se o texto cabe (lado esquerdo; o direito é quase espelho)
  const fino = []
  for (let i = 0; i <= 400; i++) fino.push(pontoCubica(P0, s1, i / 400))
  const xEmY = (y) => fino.reduce((a, b) => (Math.abs(b[1] - y) < Math.abs(a[1] - y) ? b : a))[0]
  const meiaLargura = (y) => CX - xEmY(y) - corpoFundo / 2
  /** Distância até a face interna da parede (negativa = atravessou). */
  const distParede = (x, y) => {
    let melhor = Infinity
    for (const [p, w] of meias) melhor = Math.min(melhor, Math.hypot(p[0] - x, p[1] - y) - w)
    return melhor
  }
  /** Borda de baixo da frente do aro, na coluna x. */
  const bordaFrente = (x) => cy + dV + (ry + sV) * Math.sqrt(Math.max(0, 1 - ((x - CX) / (rx + lado / 2)) ** 2))
  return { contornos: [bordaFora, bordaDentro, corpo], meiaLargura, bordaFrente, distParede }
}

/** Texto inclinado e enrolado na frente da cuia (perspectiva igual à da borda). */
function textoNaCuia(linhas, cfg, cuia, relatorio) {
  const topo = linhas[0].base - linhas[0].caixa
  const yRef = (topo + linhas[linhas.length - 1].base) / 2
  return linhas.map((ln) => {
    const l = linhaTexto(ln.texto, ln.caixa, ln.espaco ?? 0)
    const meio = (l.x0 + l.x1) / 2
    const contornos = l.contornos.map((c) => subdividir(c, 36))
    return transformar(contornos, (x, y) => {
      let px = x - meio + (ln.dx ?? cfg.dx ?? 0)
      const py = y + ln.base
      px += (yRef - py) * Math.tan(cfg.inclinacao) // itálico de rua
      const R = cfg.raio // enrola no cilindro: pontas comprimidas e mais altas
      const fi = px / R
      const sx = CX + R * Math.sin(fi)
      const sy = py - cfg.achatamento * R * (1 - Math.cos(fi))
      if (relatorio) relatorio.push([ln.texto, cuia.distParede(sx, sy), sy, sy - cuia.bordaFrente(sx), sx])
      return [sx, sy]
    })
  })
}

/**
 * Uma peça da tesoura no referencial próprio: parafuso na origem, lâmina para +x.
 * lado -1 = corpo da lâmina para cima, +1 = para baixo. O aro fica do lado oposto (alavanca cruzada).
 * Lâmina: fio reto, dorso curvo que entra no miolo pela tangente (sem degrau no ombro).
 */
function pecaTesoura(lado, t, aro) {
  const s = lado, L = t.lamina, W = t.larg, R = t.miolo
  const e0 = -1.6 * s // o fio passa um tico do eixo: fechada, as lâminas se sobrepõem
  const lamina = contorno([L, e0], [
    ['C', L * 0.8, s * W * 0.38, L * 0.56, s * W, L * 0.34, s * W],
    ['C', L * 0.15, s * W, R * 1.35, s * R, 0, s * R],
    ['L', -R * 0.55, s * R * 0.55],
    ['L', -R * 0.55, e0],
  ])
  const miolo = elipse(0, 0, R, R)
  const { dist, desvio, rx, ry, esp, haste: [h0, h1] } = aro
  const ac = [-dist, -s * desvio]
  const ang = Math.atan2(ac[1], ac[0])
  const dir = [Math.cos(ang), Math.sin(ang)]
  const perp = [-Math.sin(ang), Math.cos(ang)]
  const P = (d, w) => [dir[0] * d + perp[0] * w, dir[1] * d + perp[1] * w]
  const d0 = R * 0.3
  const d1 = Math.hypot(ac[0], ac[1]) - (rx - esp / 2)
  const cint = 1.6 // cintura da haste
  const haste = contorno(P(d0, h0), [
    ['C', ...P(d0 + (d1 - d0) * 0.4, h0 * 0.6 + h1 * 0.4 - cint), ...P(d0 + (d1 - d0) * 0.75, h1 - cint * 0.4), ...P(d1, h1)],
    ['L', ...P(d1, -h1)],
    ['C', ...P(d0 + (d1 - d0) * 0.75, -h1 + cint * 0.4), ...P(d0 + (d1 - d0) * 0.4, -(h0 * 0.6 + h1 * 0.4) + cint), ...P(d0, -h0)],
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
 * ficar a `raioAlvo` do centro.
 */
function enquadrar(grupos, raioAlvo, ajusteY = 0) {
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
  const esc = raioAlvo / raio
  const f = (x, y) => [VB / 2 + (x - cx) * esc, VB / 2 + ajusteY + (y - cy) * esc]
  return { f, esc, caixa: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] }
}

// ---------------------------------------------------------------------------
// Logo principal

const FOLGA = 7 // respiro (transparente, por máscara) entre elementos que se cruzam

const CUIA = {
  borda: { cy: 200, rx: 190, ry: 33 },
  bojo: [6, 138], // 1º ponto de controle do corpo (relativo à ponta da borda): bojo curto
  fundoLarg: 174, // 2º ponto de controle: meia largura no fundo (fundo largo e chato)
  fundoY: 394,
  larg: { frente: 14, fundo: 9, lado: 12, corpoFundo: 16.5, corpoPonta: 12 },
  mao: { dx: 1.4, giro: -0.6, assim: 3, w: 0.7 }, // torto de mão: miolo da borda deslocado, lado direito mais cheio
}
const TXT = {
  inclinacao: 13 * RAD,
  dx: 12, // o itálico puxa a base para a esquerda; compensa
  raio: 185,
  achatamento: CUIA.borda.ry / CUIA.borda.rx,
  // GREEN sobe por cima da frente do aro (o respiro recorta a borda atrás das letras)
  linhas: [
    { texto: 'GREEN', caixa: 68, base: 297, espaco: -1, dx: -5 }, // centrado: o aro reaparece igual dos dois lados
    { texto: 'CHEESE', caixa: 54, base: 357, espaco: -5, dx: 8 }, // ≥ 10 de folga das paredes (o respiro não morde a cuia)
  ],
}
const TES = {
  pivo: [256, 92],
  giro: -2, // inclinação da tesoura inteira (graus)
  abertura: 14, // graus que cada lâmina abre a partir do eixo (= LOGO_FECHAR)
  lamina: 156,
  larg: 25,
  miolo: 17,
  parafuso: 5.5,
  // aro do polegar (menor, redondo) e aro dos dedos (maior, comprido), como numa tesoura de verdade
  aroPolegar: { dist: 74, desvio: 16, rx: 27, ry: 23, esp: 12, haste: [10, 7] },
  aroDedos: { dist: 92, desvio: 10, rx: 42, ry: 25, esp: 12, haste: [10, 7.5] },
}

// ajuste fino sem editar o arquivo (só para a prévia): LOGO_AJUSTE='{"TES":{"giro":-8}}'
if (process.env.LOGO_AJUSTE) {
  const aj = JSON.parse(process.env.LOGO_AJUSTE)
  const fundir = (alvo, de) => {
    for (const [k, v] of Object.entries(de)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && alvo[k]) fundir(alvo[k], v)
      else alvo[k] = v
    }
  }
  fundir(CUIA, aj.CUIA ?? {})
  fundir(TXT, aj.TXT ?? {})
  fundir(TES, aj.TES ?? {})
  TXT.achatamento = CUIA.borda.ry / CUIA.borda.rx
}

const cuia = montarCuia(CUIA)
const relatorio = []
const [txtGreen, txtCheese] = textoNaCuia(TXT.linhas, TXT, cuia, relatorio)
// peça A (lâmina de cima, na frente): o aro dela fica embaixo → dedos. Peça B (lâmina de baixo, atrás): aro de cima → polegar.
const pecaA = posicionarPeca(pecaTesoura(-1, TES, TES.aroDedos), -TES.abertura, TES)
const pecaB = posicionarPeca(pecaTesoura(1, TES, TES.aroPolegar), TES.abertura, TES)

for (const t of ['GREEN', 'CHEESE']) {
  const pts = relatorio.filter((r) => r[0] === t)
  const pior = pts.reduce((a, b) => (b[1] < a[1] ? b : a))
  const vert = Math.min(...pts.map((r) => r[3]))
  console.log(`${t}: folga da parede ${pior[1].toFixed(1)} (x ${pior[4].toFixed(0)}, y ${pior[2].toFixed(0)}), x ${Math.min(...pts.map((r) => r[4])).toFixed(0)}–${Math.max(...pts.map((r) => r[4])).toFixed(0)}, abaixo do aro ${vert.toFixed(1)}, y ${Math.min(...pts.map((r) => r[2])).toFixed(0)}–${Math.max(...pts.map((r) => r[2])).toFixed(0)}`)
}

const quadro = enquadrar([cuia.contornos, txtGreen, txtCheese, pecaA, pecaB], VB / 2 - 27)
const F = (cs) => paraD(transformar(cs, quadro.f))
const pivo = quadro.f(...TES.pivo)
console.log(`caixa ${quadro.caixa.map(Math.round)} · escala de enquadramento ${quadro.esc.toFixed(3)}`)

/** Envoltória convexa (monotone chain) dos pontos do contorno, já no viewBox. */
function envoltoria(contornos) {
  const pts = []
  for (const c of contornos) {
    let p = c.ini
    pts.push(p)
    for (const sg of c.segs) {
      for (let i = 1; i <= 6; i++) pts.push(pontoCubica(p, sg, i / 6))
      p = [sg[4], sg[5]]
    }
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const baixo = [], cima = []
  for (const p of pts) {
    while (baixo.length >= 2 && cruz(baixo.at(-2), baixo.at(-1), p) <= 0) baixo.pop()
    baixo.push(p)
  }
  for (const p of [...pts].reverse()) {
    while (cima.length >= 2 && cruz(cima.at(-2), cima.at(-1), p) <= 0) cima.pop()
    cima.push(p)
  }
  // simplifica (Douglas-Peucker, 0,4 unidade): o arco de cima tem dezenas de pontos quase alinhados
  const simplificar = (pl, tol) => {
    if (pl.length < 3) return pl
    const [a, b] = [pl[0], pl.at(-1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    let iMax = 0, dMax = 0
    for (let i = 1; i < pl.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pl[i][1]) - (a[0] - pl[i][0]) * (b[1] - a[1])) / len
      if (d > dMax) [dMax, iMax] = [d, i]
    }
    return dMax <= tol ? [a, b] : [...simplificar(pl.slice(0, iMax + 1), tol).slice(0, -1), ...simplificar(pl.slice(iMax), tol)]
  }
  const casco = [...simplificar(baixo, 0.4).slice(0, -1), ...simplificar(cima, 0.4).slice(0, -1)]
  return 'M' + casco.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L') + 'Z'
}

const D = {
  cuia: F(cuia.contornos),
  // o GREEN passa na frente do aro: o aro some atrás da palavra inteira (sem farelo entre as letras)
  recorte: envoltoria(transformar(txtGreen, quadro.f)),
  green: F(txtGreen),
  cheese: F(txtCheese),
  a: F(pecaA),
  b: F(pecaB),
  pivo: { x: Number(r1(pivo[0])), y: Number(r1(pivo[1])), r: Number(r1(TES.parafuso * quadro.esc)) },
  folga: Number(r1(FOLGA * quadro.esc)),
}

/** SVG estático do logo completo (prévia, rasterização, ícones). Respiro por máscara, igual ao componente. */
function svgCompleto({ tamanho = VB, circulo = true, fundo = null, so = null } = {}) {
  const ver = (c) => !so || so === c
  const masc = `<defs>
<mask id="mc" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB}" height="${VB}"><rect width="${VB}" height="${VB}" fill="#fff"/><g fill="#000" stroke="#000" stroke-width="${D.folga * 2}" stroke-linejoin="round"><path d="${D.recorte}"/><path d="${D.cheese}"/><path d="${D.a}"/><path d="${D.b}"/></g></mask>
<mask id="mb" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB}" height="${VB}"><rect width="${VB}" height="${VB}" fill="#fff"/><path d="${D.a}" fill="#000" stroke="#000" stroke-width="${D.folga * 2}" stroke-linejoin="round"/></mask>
<mask id="mf" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB}" height="${VB}"><rect width="${VB}" height="${VB}" fill="#fff"/><circle cx="${D.pivo.x}" cy="${D.pivo.y}" r="${D.pivo.r}" fill="#000"/></mask>
</defs>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${VB} ${VB}">${masc}
${fundo ? `<rect width="${VB}" height="${VB}" fill="${fundo}"/>` : ''}${circulo ? `<circle cx="${VB / 2}" cy="${VB / 2}" r="${VB / 2}" fill="#000"/>` : ''}
<g fill="#fff">
${ver('cuia') ? `<path mask="url(#mc)" d="${D.cuia}"/>` : ''}
${ver('texto') ? `<path d="${D.green}"/><path d="${D.cheese}"/>` : ''}
${ver('tesoura') ? `<g mask="url(#mf)"><path mask="url(#mb)" d="${D.b}"/><path d="${D.a}"/></g>` : ''}
</g></svg>`
}

// ---------------------------------------------------------------------------
// Grades pixel desenhadas à mão (# = branco). A cuia e o GC foram compostos à mão célula a célula.
// 32: compacto de 31 a 40 px e favicon a 32 px · 24: compacto até 30 px · 16: favicon a 16 px (cuia em massa, GC vazado).

const linhas = (s) => s.trim().split('\n').map((l) => l.trim())

const GRADE_32 = linhas(`
................................
................................
................................
.........##...........##........
........#..#........###.........
.........####.....###...........
............###.###.............
..............####..............
............###.########........
.........#####..................
........#....#..................
.........####...................
................................
........################........
....####................####....
.###........................###.
.#######................#######.
.##..######################..##.
.##....##################....##.
.##..........................##.
.##.......#####....#####.....##.
..##.....##...##..##...##...##..
..##.....##.......##........##..
...##...##.####..##........##...
...###..##...##..##...##..###...
....###..#####....#####..###....
.....####..............####.....
.......##################.......
..........############..........
................................
................................
................................
`)

const GRADE_24 = linhas(`
........................
........................
.......##......##.......
......#..#...###........
.......###.###..........
..........##............
.......###.######.......
......#...#.............
.......###..............
........................
.....##############.....
.####..............####.
.######..........######.
.##..##############..##.
.##..................##.
.##....####..####....##.
.##...##....##.......##.
..##..##.##.##......##..
...##.##..#.##.....##...
...##..###...####..##...
....###..........###....
......############......
........########........
........................
`)

const GRADE_16 = linhas(`
................
.....#....##....
....#.#.##......
.....###........
....#.#.####....
.....#..........
...##########...
.##..........##.
.##############.
.###...#...####.
..##.###.#####..
..##.#.#.#####..
...#...#...##...
....########....
......####......
................
`)

for (const [nome, g] of [['32', GRADE_32], ['24', GRADE_24], ['16', GRADE_16]]) {
  if (g.length !== Number(nome) || g.some((l) => l.length !== Number(nome))) throw new Error(`grade ${nome} com tamanho errado`)
}

/** Células marcadas → path de retângulos (corridas horizontais), em coordenadas inteiras. */
function gradeParaD(g, marca = (ch) => ch === '#') {
  let d = ''
  g.forEach((l, y) => {
    for (let x = 0; x < l.length; ) {
      if (!marca(l[x])) {
        x++
        continue
      }
      let w = 1
      while (x + w < l.length && marca(l[x + w])) w++
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w
    }
  })
  return d
}

/** Disco pixelado (fundo do favicon): células com o centro dentro do raio. */
function disco(n) {
  const r = n / 2 - 0.1
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => (Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) <= r ? '#' : '.')).join(''),
  )
}

// ---------------------------------------------------------------------------
// LOGO_PIXELS: o mesmo desenho rasterizado numa grade 64×64 (sharp), camada a camada,
// para a abertura acender bloco a bloco por opacity (sem stroke-dashoffset, sem canvas).

const LADO_PIXELS = 64

async function cobertura(svg) {
  const { data } = await sharp(Buffer.from(svg)).resize(VB, VB).greyscale().raw().toBuffer({ resolveWithObject: true })
  const k = VB / LADO_PIXELS
  const out = []
  for (let gy = 0; gy < LADO_PIXELS; gy++) {
    const linha = []
    for (let gx = 0; gx < LADO_PIXELS; gx++) {
      let s = 0
      for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) s += data[(gy * k + y) * VB + gx * k + x]
      linha.push(s / (k * k * 255))
    }
    out.push(linha)
  }
  return out
}

async function gerarPixels() {
  const cam = {}
  for (const c of ['cuia', 'texto', 'tesoura']) cam[c] = await cobertura(svgCompleto({ circulo: false, fundo: '#000', so: c }))
  const limiar = { tesoura: 0.36, texto: 0.42, cuia: 0.34 }
  const letra = { tesoura: 's', texto: 't', cuia: 'c' }
  const linhasPx = []
  for (let y = 0; y < LADO_PIXELS; y++) {
    let l = ''
    for (let x = 0; x < LADO_PIXELS; x++) {
      const c = ['tesoura', 'texto', 'cuia'].find((k) => cam[k][y][x] >= limiar[k])
      l += c ? letra[c] : '.'
    }
    linhasPx.push(l)
  }
  // corta as linhas vazias de cima e de baixo só no relatório; a grade fica inteira (alinha com o vetor)
  return linhasPx
}

// ---------------------------------------------------------------------------
// Favicon: pixelado à mão. 32×32 por padrão; a 16 px (ou menos) troca para a grade 16 por media query
// (dentro do SVG ela mede o próprio tamanho de exibição).

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">
<title>Green Cheese Imports</title>
<style>.f16{display:none}@media (max-width:24px){.f32{display:none}.f16{display:inline}}</style>
<g class="f32"><path fill="#000" d="${gradeParaD(disco(32))}"/><path fill="#fff" d="${gradeParaD(GRADE_32)}"/></g>
<g class="f16" transform="scale(2)"><path fill="#000" d="${gradeParaD(disco(16))}"/><path fill="#fff" d="${gradeParaD(GRADE_16)}"/></g>
</svg>
`
}

// ---------------------------------------------------------------------------
// Imagem de compartilhamento de reserva (padrão story) — só se public/og.png ainda não existir.

function textoEmPath(texto, alturaCaixa, x, y, arqFonte, espaco = 0) {
  const b = fs.readFileSync(arqFonte)
  const f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  const bb = f.charToGlyph('H').getBoundingBox()
  const l = linhaTexto(texto, alturaCaixa, espaco, f, bb.y2 - bb.y1)
  return { d: paraD(transformar(l.contornos, (px, py) => [px + x, py + y])), largura: l.avanco }
}

function ogSvg(linhasPx) {
  const px700 = path.join(raiz, 'node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-700-normal.woff')
  const px400 = path.join(raiz, 'node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff')
  const t1 = textoEmPath('GREEN CHEESE', 58, 96, 372, px700, 2)
  const t2 = textoEmPath('IMPORTS', 58, 96, 448, px700, 2)
  const t3 = textoEmPath('Escolhe no story, pede no WhatsApp.', 24, 98, 510, px400)
  // story 9:16 à direita: estados no topo, logo em blocos no meio, "DISPONÍVEL ✅" embaixo, tudo centrado
  const story = { x: 770, y: 40, w: 315, h: 560 }
  const meio = story.x + story.w / 2
  const centrado = (texto, caixa, y, arq, esp) => textoEmPath(texto, caixa, meio - textoEmPath(texto, caixa, 0, 0, arq, esp).largura / 2, y, arq, esp)
  const selo = 22
  const t4largura = textoEmPath('DISPONÍVEL', 22, 0, 0, px700, 1).largura
  const x4 = meio - (t4largura + 10 + selo) / 2
  const t4 = textoEmPath('DISPONÍVEL', 22, x4, 540, px700, 1)
  const t5 = centrado('RJ · MG · SP · ES · SC', 18, 100, px400, 0)
  const cel = 4
  const ox = Math.round(meio - (LADO_PIXELS * cel) / 2), oy = 170
  const blocos = gradeParaD(linhasPx.map((l) => l.replace(/[cts]/g, '#')))
  const logoSvg = svgCompleto({ circulo: true })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  const barra = (story.w - 28 - 9) / 4
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#000"/>
<g transform="translate(92 70) scale(${210 / VB})">${logoSvg}</g>
<g fill="#fff"><path d="${t1.d}"/><path d="${t2.d}"/></g>
<path fill="#A8A8A8" d="${t3.d}"/>
<rect x="${story.x}" y="${story.y}" width="${story.w}" height="${story.h}" rx="14" fill="none" stroke="#262626" stroke-width="2"/>
<g fill="#fff">${[0, 1, 2, 3].map((i) => `<rect x="${story.x + 14 + i * (barra + 3)}" y="${story.y + 12}" width="${barra}" height="3"${i ? ' opacity=".35"' : ''}/>`).join('')}</g>
<path fill="#A8A8A8" d="${t5.d}"/>
<g transform="translate(${ox} ${oy}) scale(${cel})" fill="#fff" shape-rendering="crispEdges"><path d="${blocos}"/></g>
<path fill="#fff" d="${t4.d}"/>
<g transform="translate(${x4 + t4largura + 10} 520)" shape-rendering="crispEdges"><rect width="${selo}" height="${selo}" fill="#2E9E4F"/><path fill="#fff" d="M4 11h3v3h3v-3h3v-3h3v-3h3v3h-3v3h-3v3h-3v3h-3v-3h-3z"/></g>
</svg>`
}

// ---------------------------------------------------------------------------
// Saída

const linhasPx = await gerarPixels()
const nPx = linhasPx.join('').replace(/\./g, '').length
console.log(`LOGO_PIXELS ${LADO_PIXELS}×${LADO_PIXELS}: ${nPx} blocos acesos`)

if (PREVIA) {
  // prévia: logo grande + tamanhos pequenos + a grade 64, lado a lado
  const W = 1500, H = 560
  const comp = [
    { input: await sharp(Buffer.from(svgCompleto({ tamanho: 520 }))).png().toBuffer(), left: 20, top: 20 },
    { input: await sharp(Buffer.from(svgCompleto({ tamanho: 120 }))).png().toBuffer(), left: 560, top: 20 },
    { input: await sharp(Buffer.from(svgCompleto({ tamanho: 64 }))).png().toBuffer(), left: 700, top: 20 },
    {
      input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="448" height="448" viewBox="0 0 64 64" shape-rendering="crispEdges"><rect width="64" height="64" fill="#111"/><path fill="#fff" d="${gradeParaD(linhasPx, (c) => c !== '.')}"/></svg>`)).png().toBuffer(),
      left: 1030,
      top: 20,
    },
  ]
  const fonteRot = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"><text x="0" y="28" font-family="sans-serif" font-size="22" fill="#aaa">${NOME_FONTE}</text></svg>`)).png().toBuffer()
  comp.push({ input: fonteRot, left: 560, top: 160 })
  await sharp({ create: { width: W, height: H, channels: 3, background: '#1a1a1a' } }).composite(comp).png().toFile(PREVIA)
  console.log(`prévia: ${PREVIA}`)
  process.exit(0)
}

const lista = (a) => a.map((l) => `    '${l}',`).join('\n')

const ts = `// GERADO por scripts/gerar-logo.mjs — não editar à mão (rode "node scripts/gerar-logo.mjs").
// Logo da Green Cheese no viewBox ${VB}×${VB}. Texto em ${NOME_FONTE}, convertido em path.

export const LOGO_VIEWBOX = '0 0 ${VB} ${VB}'

/** Círculo preto (foto de perfil). */
export const LOGO_CIRCULO = { cx: ${VB / 2}, cy: ${VB / 2}, r: ${VB / 2} } as const

/** Respiro entre elementos que se cruzam (metade da largura do contorno na máscara). */
export const LOGO_FOLGA = ${D.folga}

/** Cuia (fill, nonzero): borda de espessura variável + corpo raso. Sem pé. */
export const LOGO_CUIA = '${D.cuia}'

/**
 * "GREEN" e "CHEESE" já inclinados e curvados na frente da cuia.
 * recorte = envoltória do GREEN: na máscara, apaga o aro atrás da palavra inteira (o GREEN sobe na frente da borda).
 */
export const LOGO_TEXTO = {
  green: '${D.green}',
  cheese: '${D.cheese}',
  recorte: '${D.recorte}',
} as const

/** Cada peça da tesoura (lâmina + miolo + haste + aro), na pose aberta do logo. Fill, nonzero. a = da frente. */
export const LOGO_LAMINAS = {
  a: '${D.a}',
  b: '${D.b}',
} as const

/** Parafuso da tesoura: centro de giro das lâminas, em coordenadas do viewBox (r = furo vazado). */
export const LOGO_PIVO = { x: ${D.pivo.x}, y: ${D.pivo.y}, r: ${D.pivo.r} } as const

/** Graus para fechar cada lâmina a partir da pose do logo (girando em torno de LOGO_PIVO). */
export const LOGO_FECHAR = { a: ${TES.abertura}, b: ${-TES.abertura} } as const

/**
 * Desenho compacto, pixelado à mão (# = bloco branco), para tamanhos pequenos: cuia sem pé ocupando
 * o círculo, traço de 2 blocos, GC em massa e tesoura simplificada. Grade 24 até 30 px, 32 acima.
 */
export const LOGO_GRADES = {
  24: [
${lista(GRADE_24)}
  ],
  32: [
${lista(GRADE_32)}
  ],
} as const

/**
 * O desenho completo em blocos (${LADO_PIXELS}×${LADO_PIXELS}, rasterizado do vetor acima), por camada:
 * c = cuia, t = texto, s = tesoura, . = vazio. Para a abertura acender bloco a bloco por opacity.
 */
export const LOGO_PIXELS = {
  lado: ${LADO_PIXELS},
  linhas: [
${lista(linhasPx)}
  ],
} as const
`

fs.mkdirSync(path.join(raiz, 'src/arte'), { recursive: true })
fs.writeFileSync(path.join(raiz, 'src/arte/logo-paths.ts'), ts)
fs.writeFileSync(path.join(raiz, 'public/favicon.svg'), faviconSvg())

// ícone da tela inicial: derivado do logo, refeito sempre. Fundo preto opaco (o iOS arredonda o canto e não aceita transparência)
const touch = path.join(raiz, 'public/apple-touch-icon.png')
await sharp(Buffer.from(svgCompleto({ tamanho: 180, fundo: '#000' }))).flatten({ background: '#000' }).png().toFile(touch)
console.log('public/apple-touch-icon.png (180×180, opaco)')
const og = path.join(raiz, 'public/og.png')
if (!fs.existsSync(og) || process.env.LOGO_OG === 'refazer') {
  await sharp(Buffer.from(ogSvg(linhasPx))).flatten({ background: '#000' }).png().toFile(og)
  console.log('public/og.png criado (reserva; "npm run og" gera a versão com os produtos)')
}
console.log(`ok: src/arte/logo-paths.ts ${(ts.length / 1024).toFixed(1)} KB · public/favicon.svg ${(faviconSvg().length / 1024).toFixed(1)} KB`)
