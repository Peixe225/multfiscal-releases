// Montagem dos quadros do elenco da rua: cada personagem é desenhado em peças de texto (cabeça, tronco, braço,
// perna, adereço), e cada quadro é uma pilha de peças postas em (x, y). Assim o andar ganha peso sem redesenhar o
// corpo inteiro a cada quadro: o tronco desce 1 px no apoio, a mochila chega um quadro depois, a perna troca.
//
// Letras: '.' = transparente (deixa ver a peça de baixo), 'x' = apaga (o quadro fica vazado ali), qualquer outra =
// cor da paleta do personagem. O mesmo jeito de escrever das grades.ts; aqui a cor de fundo nunca entra: o quadro sai
// com transparência de verdade, para o motor desenhar por cima da rua.
//
// Lado: tudo é desenhado olhando para a direita. O quadro da esquerda é montado espelhando a posição e o desenho de
// cada peça — menos as peças `fixa` (letreiro, logo GC), que só trocam de lugar e continuam legíveis.

/** Uma peça de pixel art: linhas de texto do mesmo tamanho. */
export interface Peca {
  w: number
  h: number
  linhas: string[]
  /** Não espelha o desenho quando o personagem vira (letras, logo). */
  fixa?: boolean
}

export interface Ponto {
  x: number
  y: number
}

/**
 * Opções de uma camada: troca de letras (mesma peça em outra cor), espelhar só esta peça e `sobre` (só pinta onde já
 * tem pixel: o vão escuro entre a manga e o casaco aparece no corpo e nunca no ar).
 */
export interface OpCamada {
  troca?: Record<string, string>
  virar?: boolean
  sobre?: boolean
}

/** Uma peça posta no quadro: [peça, x, y] ou [peça, x, y, opções]. */
export type Camada = readonly [Peca, number, number] | readonly [Peca, number, number, OpCamada]

/**
 * Luz de cima (poste e néon fraco): a borda da silhueta ganha a cor de aro do material, mais clara onde o vazio fica
 * em cima (luz) e média nos lados. A borda de baixo fica como está (sombra). Letra fora do mapa não ganha aro
 * (olho, brilho, detalhe de 1 px).
 */
export type Aro = Record<string, string | readonly [topo: string, lado: string]>

export const VAZIO = '.'
export const APAGA = 'x'

/** Peça a partir de um bloco de texto: uma linha por linha da grade; recuo e linhas em branco não contam. */
export function p(texto: string, op?: { fixa?: boolean }): Peca {
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  // sem completar as linhas curtas: o conferirPeca acusa o erro de digitação em vez de esconder
  const w = linhas.reduce((m, l) => Math.max(m, l.length), 0)
  return { w, h: linhas.length, linhas, fixa: op?.fixa }
}

/** Peça a partir de linhas já prontas (as grades 44×64 do mercador). */
export function deLinhas(linhas: readonly string[]): Peca {
  const w = linhas.reduce((m, l) => Math.max(m, l.length), 0)
  return { w, h: linhas.length, linhas: linhas.map((l) => l.padEnd(w, VAZIO)) }
}

/** Recorte retangular de uma peça. */
export function recorte(pc: Peca, x: number, y: number, w: number, h: number): Peca {
  const linhas: string[] = []
  for (let j = y; j < y + h; j++) {
    const l = pc.linhas[j] ?? ''
    let s = ''
    for (let i = x; i < x + w; i++) s += l[i] ?? VAZIO
    linhas.push(s)
  }
  return { w, h, linhas, fixa: pc.fixa }
}

/** Faixa de linhas [y0, y1) de uma peça, na largura toda. */
export function faixa(pc: Peca, y0: number, y1: number): Peca {
  return recorte(pc, 0, y0, pc.w, y1 - y0)
}

/** A mesma peça com letras trocadas (ex.: { y: 'e' } fecha os olhos). */
export function trocar(pc: Peca, mapa: Record<string, string>): Peca {
  return { ...pc, linhas: pc.linhas.map((l) => [...l].map((c) => mapa[c] ?? c).join('')) }
}

/** A peça espelhada na horizontal. */
export function virada(pc: Peca): Peca {
  return { ...pc, linhas: pc.linhas.map((l) => [...l].reverse().join('')) }
}

/** Troca pixels pontuais: [x, y, letra][]. Útil para piscar, mexer um dedo, acender um brilho. */
export function retocar(pc: Peca, pontos: readonly (readonly [number, number, string])[]): Peca {
  const linhas = pc.linhas.map((l) => [...l])
  for (const [x, y, c] of pontos) if (linhas[y] && x >= 0 && x < pc.w) linhas[y][x] = c
  return { ...pc, linhas: linhas.map((l) => l.join('')) }
}

// A montagem trabalha com o código de cada letra num Uint8Array (0 = vazio): é o que roda centenas de vezes quando a
// cena carrega, então nada de string por pixel.
const COD_VAZIO = VAZIO.charCodeAt(0)
const COD_APAGA = APAGA.charCodeAt(0)

const codigosDaPeca = new WeakMap<Peca, Uint8Array>()
function codigos(pc: Peca): Uint8Array {
  let c = codigosDaPeca.get(pc)
  if (!c) {
    c = new Uint8Array(pc.w * pc.h)
    for (let j = 0; j < pc.h; j++) {
      const l = pc.linhas[j] ?? ''
      for (let i = 0; i < pc.w; i++) {
        const k = i < l.length ? l.charCodeAt(i) : COD_VAZIO
        c[j * pc.w + i] = k === COD_VAZIO ? 0 : k
      }
    }
    codigosDaPeca.set(pc, c)
  }
  return c
}

const tabelasDeTroca = new WeakMap<object, Uint8Array>()
function tabelaDeTroca(troca: Record<string, string>): Uint8Array {
  let t = tabelasDeTroca.get(troca)
  if (!t) {
    t = new Uint8Array(128).map((_, i) => i)
    for (const [de, para] of Object.entries(troca)) t[de.charCodeAt(0)] = para.charCodeAt(0)
    tabelasDeTroca.set(troca, t)
  }
  return t
}

const tabelasDeAro = new WeakMap<object, [Uint8Array, Uint8Array]>()
function tabelaDeAro(aro: Aro): [Uint8Array, Uint8Array] {
  let t = tabelasDeAro.get(aro)
  if (!t) {
    const topo = new Uint8Array(128)
    const lado = new Uint8Array(128)
    for (const [letra, regra] of Object.entries(aro)) {
      const [a, b] = typeof regra === 'string' ? [regra, regra] : regra
      topo[letra.charCodeAt(0)] = a.charCodeAt(0)
      lado[letra.charCodeAt(0)] = b.charCodeAt(0)
    }
    t = [topo, lado]
    tabelasDeAro.set(aro, t)
  }
  return t
}

/** Monta um quadro w×h a partir das camadas: o código da letra de cada pixel (0 = vazio), linha a linha. */
export function montarCodigos(w: number, h: number, camadas: readonly Camada[], espelhado: boolean, aro?: Aro): Uint8Array {
  const t = new Uint8Array(w * h)
  for (const camada of camadas) {
    const [pc, xx, yy, op] = camada as readonly [Peca, number, number, OpCamada | undefined]
    // posição sempre em pixel inteiro (os encaixes do boneco podem vir com meio pixel)
    const x0 = Math.round(xx)
    const y0 = Math.round(yy)
    const viraPeca = (op?.virar ?? false) !== (espelhado && !pc.fixa)
    const xBase = espelhado ? w - x0 - pc.w : x0
    const cod = codigos(pc)
    const troca = op?.troca ? tabelaDeTroca(op.troca) : null
    const sobre = !!op?.sobre
    for (let j = 0; j < pc.h; j++) {
      const y = y0 + j
      if (y < 0 || y >= h) continue
      const linha = j * pc.w
      for (let i = 0; i < pc.w; i++) {
        let c = cod[linha + (viraPeca ? pc.w - 1 - i : i)]
        if (!c) continue
        const x = xBase + i
        if (x < 0 || x >= w) continue
        const k = y * w + x
        if (sobre && !t[k]) continue
        if (troca) c = troca[c]
        t[k] = c === COD_APAGA ? 0 : c
      }
    }
  }
  if (aro) {
    const [topo, lado] = tabelaDeAro(aro)
    const saida = t.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x
        const c = t[k]
        if (!c || !topo[c]) continue
        if (y === 0 || !t[k - w]) saida[k] = topo[c]
        else if (x === 0 || x === w - 1 || !t[k - 1] || !t[k + 1]) saida[k] = lado[c]
      }
    }
    return saida
  }
  return t
}

/** O mesmo quadro em linhas de texto (para conferir e para o laboratório). */
export function montarLinhas(w: number, h: number, camadas: readonly Camada[], espelhado: boolean, aro?: Aro): string[] {
  const t = montarCodigos(w, h, camadas, espelhado, aro)
  const linhas: string[] = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) s += t[y * w + x] ? String.fromCharCode(t[y * w + x]) : VAZIO
    linhas.push(s)
  }
  return linhas
}

/** Confere uma peça (linhas do mesmo tamanho, letras com cor). Devolve a lista de problemas; vazia = ok. */
export function conferirPeca(pc: Peca, paleta: Record<string, string>, nome: string): string[] {
  const erros: string[] = []
  pc.linhas.forEach((l, y) => {
    if (l.length !== pc.w) erros.push(`${nome}: linha ${y} com ${l.length}, esperado ${pc.w}`)
    for (const c of l) if (c !== VAZIO && c !== APAGA && !paleta[c]) erros.push(`${nome}: linha ${y} letra "${c}" sem cor`)
  })
  return erros
}

/* ───────────── manga gerada (braço dobrado em qualquer pose, com a mesma luz) ───────────── */

export interface Manga {
  /** A manga: miolo, aro de luz em cima e nos lados, sombra embaixo. */
  peca: Peca
  /** O vão escuro em volta, para pôr antes da manga com { sobre: true }. */
  vao: Peca
  x: number
  y: number
}

/**
 * Manga de pano grosso seguindo os pontos (ombro → cotovelo → punho), com raio `r` px. Letras: `miolo` no meio,
 * `luz` na borda de cima e nos lados, `sombra` na borda de baixo; o vão sai com `sombra` também.
 */
const mangasFeitas = new Map<string, Manga>()

export function manga(pontos: readonly Ponto[], r: number, cores: { miolo: string; luz: string; sombra: string }): Manga {
  // a mesma pose aparece em muitos quadros: gera uma vez (a mesma peça também deixa o quadro igual reaproveitar)
  const chave = `${pontos.map((q) => `${q.x},${q.y}`).join(';')}|${r}|${cores.miolo}${cores.luz}${cores.sombra}`
  const pronta = mangasFeitas.get(chave)
  if (pronta) return pronta
  const feita = gerarManga(pontos, r, cores)
  mangasFeitas.set(chave, feita)
  return feita
}

function gerarManga(pontos: readonly Ponto[], r: number, cores: { miolo: string; luz: string; sombra: string }): Manga {
  const xs = pontos.map((q) => q.x)
  const ys = pontos.map((q) => q.y)
  const m = Math.ceil(r) + 2
  const x0 = Math.floor(Math.min(...xs) - m)
  const y0 = Math.floor(Math.min(...ys) - m)
  const w = Math.ceil(Math.max(...xs) + m) - x0 + 1
  const h = Math.ceil(Math.max(...ys) + m) - y0 + 1
  const dentro = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return false
    const px = x0 + i + 0.5
    const py = y0 + j + 0.5
    for (let k = 0; k < pontos.length - 1; k++) {
      const a = pontos[k]
      const b = pontos[k + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0
      const ex = a.x + t * dx - px
      const ey = a.y + t * dy - py
      if (ex * ex + ey * ey <= r * r) return true
    }
    return false
  }
  const linhas: string[] = []
  const vao: string[] = []
  for (let j = 0; j < h; j++) {
    let s = ''
    let v = ''
    for (let i = 0; i < w; i++) {
      if (dentro(i, j)) {
        v += VAZIO
        if (!dentro(i, j - 1)) s += cores.luz
        else if (!dentro(i, j + 1)) s += cores.sombra
        else if (!dentro(i + 1, j) || !dentro(i - 1, j)) s += cores.luz
        else s += cores.miolo
      } else {
        s += VAZIO
        v += dentro(i - 1, j) || dentro(i + 1, j) || dentro(i, j - 1) || dentro(i, j + 1) ? cores.sombra : VAZIO
      }
    }
    linhas.push(s)
    vao.push(v)
  }
  return { peca: { w, h, linhas }, vao: { w, h, linhas: vao }, x: x0, y: y0 }
}

/** As duas camadas de uma manga (o vão primeiro, só sobre o corpo), deslocadas por (dx, dy). */
export function camadasDaManga(mg: Manga, dx = 0, dy = 0): Camada[] {
  return [
    [mg.vao, mg.x + dx, mg.y + dy, { sobre: true }],
    [mg.peca, mg.x + dx, mg.y + dy],
  ]
}
