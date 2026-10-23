import { gsap } from 'gsap'
import { K } from '../../arte/realista/acessorios-dichavador'
import { BOCA } from '../../arte/realista/dichavador-jogo'
import { BECK_ALT } from './Palco'
import type { Origem } from './fumaca'
import { vibrar } from './tato'

// Storyboard da revelação (t = 0 é o 8º quarto; pedido do Ian em 11/10, direção da 2ª rodada). Duas vozes: "app"
// (consequência do dedo: a câmera deita, a tampa sai, o dichavador cai, o story voa) e "pixel" (steps(): adesivos,
// destaque, confete). Só transform e opacity. Movimento reduzido: cortes secos. Modo leve: deitar vira corte.
//
//   0,12–0,42  a câmera deita (a tampa achata e o corpo entra por baixo); o texto de cima some
//   0,40–0,75  a tampa salta e voa pra fora
//   0,45       COMEÇA A FUMAÇA (comecarFumaca): o beck bolado sobe de dentro da câmara, desenhado pela própria fumaça
//              (a borda da frente da boca recorta o pé dele), já deitando e crescendo (a câmera chega perto); o isqueiro
//              entra de lado ainda na subida — dali a fumaça faz o resto (fumaca/roteiro.ts)
//   0,75–1,10  o dichavador cai pelo pé do quadro (girando de leve), em vez de escurecer
//   auge       (onPronto da fumaça) o prêmio respira um instante e o story SAI DA FUMAÇA: o produto, o carimbo e o
//              destaque voam (FLIP) do auge até o lugar deles no story, a fumaça abre como cortina e o resto dela sobe e
//              se desfaz no fundo; nunca dois produtos à vista; a comemoração em pixel bate no story; no fim a fase vira
//              "prêmio" e o foco vai pro destaque

export const EASE_APP = 'cubic-bezier(0.22,1,0.36,1)'
gsap.registerEase?.('app', (p: number) => {
  // cubic-bezier(0.22, 1, 0.36, 1) resolvido por Newton (o GSAP core não traz CustomEase)
  const cx = 3 * 0.22
  const bx = 3 * (0.36 - 0.22) - cx
  const ax = 1 - cx - bx
  const cy = 3 * 1
  const by = 3 * (1 - 1) - cy
  const ay = 1 - cy - by
  let t = p
  for (let i = 0; i < 6; i++) {
    const x = ((ax * t + bx) * t + cx) * t - p
    const d = (3 * ax * t + 2 * bx) * t + cx
    if (Math.abs(d) < 1e-6) break
    t -= x / d
  }
  t = Math.min(1, Math.max(0, t))
  return ((ay * t + by) * t + cy) * t
})
// o voo do produto até o story: cubic-bezier(.2,.8,.2,1)
gsap.registerEase?.('voo', (p: number) => {
  const cx = 3 * 0.2
  const bx = 3 * (0.2 - 0.2) - cx
  const ax = 1 - cx - bx
  const cy = 3 * 0.8
  const by = 3 * (1 - 0.8) - cy
  const ay = 1 - cy - by
  let t = p
  for (let i = 0; i < 6; i++) {
    const x = ((ax * t + bx) * t + cx) * t - p
    const d = (3 * ax * t + 2 * bx) * t + cx
    if (Math.abs(d) < 1e-6) break
    t -= x / d
  }
  t = Math.min(1, Math.max(0, t))
  return ((ay * t + by) * t + cy) * t
})
const APP = 'app'

/** Desde quando um toque pula a revelação (s): a tampa já saiu. Antes disso, o toque é o reflexo de quem girava. */
export const PULAR_DESDE = 0.9
/** A fumaça começa: o beck sobe da câmara (a tampa já está voando). */
export const COMECA = 0.45
/** Depois do auge (o prêmio assentado na fumaça), quanto ele fica sozinho antes de o story sair da fumaça. */
export const RESPIRO_AUGE = 0.3

export interface ElementosRevelacao {
  palco: HTMLElement
  anel: Element
  corpo: HTMLElement
  labio: HTMLElement
  tampa: HTMLElement
  lado: HTMLElement
  disco: HTMLElement
  rotor: HTMLElement
  indicador: HTMLElement
  /** O palco da fumaça (a área visível da coluna): a origem do beck é medida nele. */
  fumaca: HTMLElement
  /** O que some quando a câmera deita (texto de cima, legenda, botão, rodapé). */
  sumir: Element[]
  /** O que sobe junto quando o texto de cima sai do fluxo no fim (a cena): sem pulo de layout. */
  subir: HTMLElement[]
  /** Altura que o texto de cima ocupa (sai do layout quando a revelação termina). */
  alturaIntro: number
  /** O quadro do story e as ações no pé dele (o story monta depois do estalo: pegos na hora). */
  quadro: () => HTMLElement | null
  pe: () => HTMLElement | null
  /** Segmentos "Abrir" e "Prêmio" do cromo do jogo, e o cromo (some quando o story entra: ele tem a barrinha dele). */
  segAbrir: Element | null
  segPremio: Element | null
  cromo: HTMLElement | null
  /** O título do jogo ("TESTE MINHA SORTE"): some quando a fumaça ocupa a tela. */
  titulo?: HTMLElement | null
}

/** Estalo (0–150 ms): a tampa passa 8° do alinhamento e volta (o entalhe para alinhado com o indicador); o anel pisca 2×. */
export function estalo(rotor: HTMLElement, anel: Element | null, angulo: number, reduzido: boolean, aoAlinhar: (a: number) => void): gsap.core.Timeline {
  const alvo = Math.round(angulo / 360) * 360
  aoAlinhar(alvo)
  const tl = gsap.timeline()
  if (reduzido) {
    tl.set(rotor, { rotation: alvo })
    return tl
  }
  gsap.set(rotor, { rotation: angulo })
  tl.to(rotor, { rotation: alvo + 8, duration: 0.09, ease: 'power2.out' }, 0)
  tl.to(rotor, { rotation: alvo, duration: 0.06, ease: 'steps(2)' }, 0.09)
  if (anel) {
    const segs = anel.querySelectorAll('circle')
    tl.to(segs, { opacity: 0, duration: 0.03, ease: 'steps(1)', repeat: 3, yoyo: true }, 0)
  }
  return tl
}

/** gsap.set que ignora alvo vazio (sem o aviso "target not found" do GSAP). */
function fixar(alvos: gsap.TweenTarget | (Element | null | undefined)[], v: gsap.TweenVars) {
  const lista = (Array.isArray(alvos) ? alvos : [alvos]).filter(Boolean) as gsap.TweenTarget[]
  if (lista.length) gsap.set(lista, v)
}

/**
 * A opacidade escrita direto (sem o gsap.set, que lê o estilo calculado de cada peça antes de escrever: com as escritas
 * no meio cada leitura recalculava o estilo; era o grosso do quadro da saída da fumaça). Pra esconder, a opacidade 0 e
 * a visibilidade herdada (não "hidden": ela é herdada, e mudar recalculava cada peça inteira; o story está inerte até o
 * fim da festa); as duas ficam escritas na peça, e o autoAlpha dos tweens depois lê daí, sem calcular o estilo.
 */
function alfa(lista: (Element | null | undefined)[], v: 0 | 1) {
  for (const x of lista) {
    if (!(x instanceof HTMLElement || x instanceof SVGElement)) continue
    x.style.opacity = String(v)
    x.style.visibility = 'inherit'
  }
}

/** O que entra no story na comemoração. */
function partesDoStory(q: HTMLElement) {
  const um = (s: string) => q.querySelector<HTMLElement>(s)
  return {
    produto: um('[data-produto]'),
    deu: um('[data-deu]'),
    raridade: um('[data-raridade-selo]'),
    valor: um('[data-valor]'),
    alvo: um('[data-alvo]'),
    apoio: um('[data-apoio]'),
    codigo: um('[data-codigo]'),
    contagem: um('[data-contagem]'),
    cond: um('[data-cond]'),
    festa: [...q.querySelectorAll<HTMLElement>('[data-festa] > i')],
    brilhos: [...q.querySelectorAll<HTMLElement>('[data-brilho]')],
  }
}

/* ───────────── a origem do beck (a câmara do dichavador) ───────────── */

/**
 * Onde o beck está dentro da câmara do dichavador e a boca dela, em px do palco da fumaça, como vão estar quando a fumaça
 * começa (a câmera já deitou e o texto de cima já subiu). Medido no 8º quarto, antes de qualquer transform.
 */
export function origemDoBeck(el: ElementosRevelacao): Origem | null {
  const p = el.palco.getBoundingClientRect()
  const f = el.fumaca.getBoundingClientRect()
  if (!p.width || !f.width) return null
  const d = p.width - 32
  const subida = el.subir.some((x) => x.classList.contains('sorte-cena')) ? el.alturaIntro : 0
  const x0 = p.left - f.left + 16
  const y0 = p.top - f.top + 16 - subida
  const boca = { x: x0 + d * BOCA.x, y: y0 + d * BOCA.y, rx: d * BOCA.rxBuraco, ry: d * BOCA.ryBuraco }
  const h = d * BECK_ALT
  return { x: boca.x, base: boca.y + h * 0.5, h, boca }
}

/* ───────────── brilhos e confete ───────────── */

/**
 * Brilhos nos cantos do destaque de verdade, sempre inteiros dentro do quadro (que corta o que passa da borda): ao lado
 * da linha quando tem espaço; quando o destaque ocupa a largura toda ("LEVA 4 PAGA 3" em 320 px), em cima das pontas.
 * Medido uma vez, antes da comemoração (left/top fixos; o movimento é só scale e opacity).
 */
function medirBrilhos(valor: HTMLElement, brilhos: HTMLElement[], quadro: HTMLElement): { b: HTMLElement; left: number; top: number }[] {
  const texto = valor.firstChild
  if (!texto || texto.nodeType !== Node.TEXT_NODE) return []
  const faixa = document.createRange()
  faixa.selectNodeContents(texto)
  const linhas = [...faixa.getClientRects()]
  if (!linhas.length) return []
  const c = valor.getBoundingClientRect()
  const q = quadro.getBoundingClientRect()
  const minX = q.left + 6
  const maxX = q.right - 6
  const prim = linhas[0]
  const ult = linhas[linhas.length - 1]
  const tam = brilhos.map((b) => b.getBoundingClientRect().width || 14)
  const lugar = (i: number, lado: [number, number], cima: [number, number]): [number, number] => (lado[0] >= minX && lado[0] + tam[i] <= maxX ? lado : cima)
  const pos: [number, number][] = [
    lugar(0, [prim.left - tam[0] - 4, prim.top - 8], [prim.left + 2, prim.top - tam[0] - 2]),
    lugar(1, [prim.right + 5, prim.top - 12], [prim.right - tam[1] - 2, prim.top - tam[1] - 4]),
    lugar(2, [ult.right + 8, ult.top + ult.height * 0.35], [prim.left + prim.width * 0.74, prim.top - tam[2] - 2]),
  ]
  const lugares: { b: HTMLElement; left: number; top: number }[] = []
  brilhos.forEach((b, i) => {
    const p = pos[i]
    if (!p) return
    const x = Math.min(Math.max(p[0], minX), maxX - tam[i])
    lugares.push({ b, left: Math.round(x - c.left), top: Math.round(p[1] - c.top) })
  })
  return lugares
}

/** Rumo de cada pedaço de confete em px: fração gravada no pedaço × o espaço da vitrine (lados e em cima). */
function medirConfete(festa: HTMLElement[], quadro: HTMLElement): { p: HTMLElement; x: number; y: number }[] {
  const vitrine = festa[0]?.closest<HTMLElement>('.sp-vitrine')
  if (!vitrine) return []
  const v = vitrine.getBoundingClientRect()
  const q = quadro.getBoundingClientRect()
  const centro = festa[0].parentElement!.getBoundingClientRect()
  const ladoEsq = centro.left - q.left - 10
  const ladoDir = q.right - centro.left - 10
  const cima = centro.top - v.top
  return festa.map((p) => {
    const fx = +(p.dataset.dx ?? 0)
    const fy = +(p.dataset.dy ?? 0)
    return { p, x: Math.round(fx * (fx < 0 ? ladoEsq : ladoDir) * 0.92), y: Math.round(fy * cima * 0.95) }
  })
}

/**
 * O que a saída da fumaça precisa medir, só leituras: os brilhos, o rumo do confete e o voo de cada parte do cartão até
 * a do story. Medido no auge (o cartão assentado, o story escondido parado no lugar, o layout limpo), um respiro antes
 * de o story sair: na hora da saída nada é lido (era o quadro mais longo do fim, com o layout calculado no meio).
 */
export interface MedidasSaida {
  brilhos: { b: HTMLElement; left: number; top: number }[]
  confete: { p: HTMLElement; x: number; y: number }[]
  voos: [HTMLElement, DOMRect, DOMRect, number][]
  escCartao: number
}

/** As partes do cartão do prêmio na fumaça, sem soltar ele (só pra medir). */
export function cartaoDaFumaca(fumaca: Element | null): CartaoFumaca | null {
  const cartao = fumaca?.querySelector<HTMLElement>('.fm-cartao')
  if (!cartao) return null
  return { cartao, visual: cartao.querySelector('.fm-visual'), carimbo: cartao.querySelector('.fm-carimbo'), destaque: cartao.querySelector('.fm-destaque'), nome: cartao.querySelector('.fm-produto') }
}

export function medirSaida(el: ElementosRevelacao, c: CartaoFumaca | null): MedidasSaida | null {
  const q = el.quadro()
  if (!q) return null
  const s = partesDoStory(q)
  const voos: [HTMLElement, DOMRect, DOMRect, number][] = []
  if (c) {
    const par = (a: HTMLElement | null, b: HTMLElement | null, giro = 0) => {
      if (!a || !b) return
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      if (ra.width && rb.width) voos.push([a, ra, rb, giro])
    }
    par(c.visual, s.produto)
    par(c.carimbo, s.raridade, 6)
    par(c.destaque, s.valor)
    par(c.nome, s.alvo)
  }
  return {
    brilhos: s.valor ? medirBrilhos(s.valor, s.brilhos, q) : [],
    confete: s.festa.length ? medirConfete(s.festa, q) : [],
    voos,
    escCartao: c ? c.cartao.getBoundingClientRect().width / Math.max(1, c.cartao.offsetWidth) : 1,
  }
}

/**
 * Aquece o GSAP no convite (num momento ocioso): lê uma vez o transform de cada peça que a revelação vai mexer (o GSAP
 * guarda e não lê de novo). Sem isto o 1º quadro de cada tween lia o estilo calculado das peças no meio da fumaça.
 * Só as peças que nada além do GSAP mexe (o cartão da fumaça é do motor: fica de fora).
 */
export function aquecerRevelacao(el: ElementosRevelacao) {
  const q = el.quadro()
  const pe = el.pe()
  const s = q ? partesDoStory(q) : null
  const alvos: (Element | null | undefined)[] = [el.disco, el.corpo, el.labio, el.lado, el.tampa, el.rotor, el.anel, el.indicador, ...el.sumir, ...el.subir, el.segAbrir, el.segPremio, el.cromo, el.titulo, q, pe, ...(pe ? [...pe.children] : [])]
  if (s) alvos.push(s.produto, s.deu, s.raridade, s.valor, s.alvo, s.apoio, s.codigo, s.contagem, s.cond)
  for (const a of alvos) if (a) gsap.getProperty(a, 'x')
}

/**
 * No auge (o story já com o prêmio de verdade): o GSAP lê uma vez o transform das peças do story, do pé e das partes do
 * cartão que voam (menos o carimbo, que o motor ainda mexe até soltar o cartão).
 */
export function aquecerStory(el: ElementosRevelacao, c: CartaoFumaca | null) {
  const q = el.quadro()
  const pe = el.pe()
  const s = q ? partesDoStory(q) : null
  const alvos: (Element | null | undefined)[] = [q, pe, ...(pe ? [...pe.children] : []), c?.visual, c?.destaque, c?.nome]
  if (s) alvos.push(s.produto, s.deu, s.raridade, s.valor, s.alvo, s.apoio, s.codigo, s.contagem, s.cond, ...s.festa, ...s.brilhos)
  for (const a of alvos) if (a) gsap.getProperty(a, 'x')
}

/** O palco do dichavador some de uma vez (pulou: a fumaça já está na tela). */
export function esconderPalco(el: ElementosRevelacao) {
  fixar([el.anel, el.indicador, ...el.sumir], { opacity: 0 })
  fixar([el.tampa, el.corpo, el.labio, el.lado, el.disco], { autoAlpha: 0 })
  if (el.titulo) fixar(el.titulo, { autoAlpha: 0 })
}

/** Estado final pintado de uma vez: o story pronto, as ações à vista (o palco, quando existe, escondido). */
export function pintarFinal(el: ElementosRevelacao) {
  const q = el.quadro()
  const pe = el.pe()
  fixar([el.anel, el.indicador, ...el.sumir], { opacity: 0 })
  fixar([el.tampa, el.corpo, el.labio], { autoAlpha: 0 })
  if (q) {
    const s = partesDoStory(q)
    fixar(q, { autoAlpha: 1, clearProps: 'transform' })
    fixar([s.deu, s.raridade, s.valor, s.codigo, s.contagem], { autoAlpha: 1, clearProps: 'transform' })
    fixar([s.produto, s.alvo, s.apoio, s.cond], { autoAlpha: 1 })
    fixar([...s.festa, ...s.brilhos], { autoAlpha: 0, x: 0, y: 0 })
  }
  if (pe) fixar([pe, ...pe.children], { autoAlpha: 1, y: 0 })
  fixar([el.segAbrir, el.segPremio], { scaleX: 1 })
  fixar(el.cromo, { autoAlpha: 0 })
  fixar(el.subir, { clearProps: 'transform' })
}

interface Opcoes {
  reduzido: boolean
  leve: boolean
  /** Quanto a fumaça dura (até o auge), pro segmento "Prêmio" do cromo encher junto. */
  duracaoFumaca: number
  /** A fumaça começa (o beck sobe da câmara). */
  aoComecar: () => void
}

/**
 * Monta a primeira parte da revelação (a partir do fim do estalo): a câmera deita, a tampa sai, a fumaça começa (o beck
 * sobe da câmara, desenhado por ela) e o dichavador cai pelo pé do quadro. Nenhuma medida aqui (a origem do beck já foi
 * medida) e só valores explícitos (fromTo): o GSAP não precisa ler estilo de ninguém no estalo.
 */
export function montarRevelacao(el: ElementosRevelacao, o: Opcoes): gsap.core.Timeline {
  const segs = [el.segAbrir, el.segPremio].filter(Boolean) as Element[]
  const tl = gsap.timeline()
  if (segs.length) tl.set(segs, { scaleX: 0, transformOrigin: '0% 50%' }, 0)

  if (o.reduzido) {
    // cortes secos: o dichavador aberto, parado 400 ms → a fumaça parada com o prêmio (RevelacaoFumaca reduzido)
    tl.set([el.anel, el.indicador, ...el.sumir], { opacity: 0 }, 0)
    if (el.alturaIntro) tl.set(el.subir, { y: -el.alturaIntro }, 0)
    tl.set(el.tampa, { autoAlpha: 0 }, 0)
    tl.set(el.disco, { yPercent: -18, scaleY: K }, 0)
    tl.set([el.corpo, el.labio, el.lado], { opacity: 1, y: 0 }, 0)
    if (el.segAbrir) tl.set(el.segAbrir, { scaleX: 1 }, 0)
    tl.set([el.corpo, el.labio, el.lado, el.disco], { autoAlpha: 0 }, 0.4)
    if (el.titulo) tl.set(el.titulo, { autoAlpha: 0 }, 0.4)
    if (el.segPremio) tl.set(el.segPremio, { scaleX: 1 }, 0.4)
    tl.call(o.aoComecar, [], 0.4)
    return tl
  }

  // 0,12–0,42 · CÂMERA DEITA (app): a tampa achata (vista de lado) e o corpo entra por baixo
  const deita = o.leve ? { duration: 0.12, ease: 'steps(2)' } : { duration: 0.3, ease: APP }
  tl.fromTo(el.disco, { yPercent: 0, scaleY: 1 }, { yPercent: -18, scaleY: K, ...deita, immediateRender: false }, 0.12)
  tl.fromTo([el.corpo, el.labio], { y: 24, opacity: 0 }, { y: 0, opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.fromTo(el.lado, { opacity: 0 }, { opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.fromTo([el.anel, el.indicador, ...el.sumir], { opacity: 1 }, { opacity: 0, duration: 0.2, ease: 'steps(3)', immediateRender: false }, 0.12)
  // o texto de cima some e a cena sobe no lugar dele (no fim ele sai do layout e a cena fica onde está)
  if (el.alturaIntro) tl.fromTo(el.subir, { y: 0 }, { y: -el.alturaIntro, ...deita, immediateRender: false }, 0.12)

  // 0,40–0,75 · A TAMPA SALTA: sobe girando e voa pra fora (a boca da câmara fica à vista, com o beck lá dentro)
  tl.fromTo(el.tampa, { y: 0, xPercent: 0, rotation: 0 }, { y: -170, xPercent: -30, rotation: -42, duration: 0.32, ease: 'power2.out', transformOrigin: '50% 30%', immediateRender: false }, 0.4)
  tl.fromTo(el.tampa, { opacity: 1 }, { opacity: 0, duration: 0.12, ease: 'none', immediateRender: false }, 0.6)

  // 0,45 · a fumaça começa: o beck sobe de dentro da câmara (desenhado por ela, na mesma grade de pixel)
  tl.call(() => vibrar('trava'), [], COMECA + 0.05)
  tl.call(o.aoComecar, [], COMECA)
  // 0,75–1,10 · o dichavador cai pelo pé do quadro (a câmera chega perto do beck)
  tl.fromTo([el.corpo, el.labio, el.lado, el.disco], { yPercent: 0, rotation: 0 }, { yPercent: 60, rotation: 8, duration: 0.35, ease: 'power2.in', immediateRender: false }, 0.75)
  tl.fromTo([el.corpo, el.labio, el.lado, el.disco], { opacity: 1 }, { opacity: 0, duration: 0.12, ease: 'none', immediateRender: false }, 0.98)
  if (el.titulo) tl.fromTo(el.titulo, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2, ease: 'steps(2)', immediateRender: false }, 0.8)

  // segmentos do cromo do jogo: "Abrir" enche até a tampa sair; "Prêmio", durante a fumaça (nunca passam sozinhos)
  if (el.segAbrir) tl.fromTo(el.segAbrir, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'none', immediateRender: false }, 0.12)
  if (el.segPremio) tl.fromTo(el.segPremio, { scaleX: 0 }, { scaleX: 1, duration: o.duracaoFumaca, ease: 'none', immediateRender: false }, COMECA)
  return tl
}

/** As partes do cartão do prêmio na fumaça (o que voa até o story). */
export interface CartaoFumaca {
  cartao: HTMLElement
  visual: HTMLElement | null
  carimbo: HTMLElement | null
  destaque: HTMLElement | null
  nome: HTMLElement | null
}

/**
 * O story sai da fumaça: o produto, o carimbo, o destaque e o nome voam (FLIP) do lugar e do tamanho deles no auge até o
 * lugar deles no story (sem mudar de opacidade); a fumaça abre como cortina por cima do story (que entra por baixo,
 * 0,15 s depois) e o resto dela sobe e se desfaz; quando o voo pousa, troca no mesmo quadro (o do story aparece, o da
 * fumaça some: nunca dois). Aí a comemoração em pixel bate no story e as ações sobem; no fim, aoFim.
 * `rapido`: quem pulou (o voo e a cortina mais curtos).
 */
export function entrarStory(el: ElementosRevelacao, o: { aoFim: () => void; cartao: CartaoFumaca | null; abrirFumaca: (seg: number) => void; rapido?: boolean; medidas?: MedidasSaida | null }): gsap.core.Timeline {
  const tl = gsap.timeline()
  const q = el.quadro()
  const pe = el.pe()
  if (!q) {
    tl.call(o.aoFim, [], 0)
    return tl
  }
  const s = partesDoStory(q)
  const peFilhos = pe ? [...pe.children] : []
  const c = o.cartao
  // as medidas do auge (ou agora, antes de escrever qualquer estilo, quando não vieram)
  const m = o.medidas ?? medirSaida(el, c)
  const voos = m?.voos ?? []
  const escCartao = m?.escCartao ?? 1
  for (const x of m?.brilhos ?? []) Object.assign(x.b.style, { left: `${x.left}px`, top: `${x.top}px` })
  for (const x of m?.confete ?? []) {
    x.p.dataset.x = String(x.x)
    x.p.dataset.y = String(x.y)
  }
  const voo = o.rapido ? 0.22 : 0.45
  const cortina = o.rapido ? 0.34 : 0.52

  // o story pronto embaixo, ainda sem o que vai chegar voando
  alfa([s.produto, s.raridade, s.valor, s.alvo, s.deu, s.apoio, s.codigo, s.contagem, s.cond, ...s.festa, ...s.brilhos], 0)
  if (pe) alfa([pe, ...peFilhos], 0)
  fixar(peFilhos, { y: 12 })
  alfa([q], 0)
  if (el.cromo) {
    // o valor de partida já escrito (o GSAP não lê o estilo calculado do cromo no 1º quadro do voo: o autoAlpha lê a
    // opacidade e a visibilidade)
    el.cromo.style.opacity = '1'
    el.cromo.style.visibility = 'inherit'
    tl.to(el.cromo, { autoAlpha: 0, duration: 0.15, ease: 'none' }, 0)
  }
  if (el.segPremio) tl.to(el.segPremio, { scaleX: 1, duration: 0.15, ease: 'none' }, 0)
  tl.call(() => o.abrirFumaca(cortina), [], 0)
  // o voo: cada parte do cartão até a do story (translate + escala, no referencial do cartão, que tem a escala dele)
  for (const [a, ra, rb, giro] of voos) {
    const dx = (rb.left + rb.width / 2 - (ra.left + ra.width / 2)) / escCartao
    const dy = (rb.top + rb.height / 2 - (ra.top + ra.height / 2)) / escCartao
    const k = a === c?.nome || a === c?.destaque ? rb.height / ra.height : rb.width / ra.width
    tl.to(a, { x: dx, y: dy, scale: k, rotation: giro, duration: voo, ease: 'voo' }, 0)
  }
  // o quadro do story entra por baixo (a fumaça abrindo por cima dele)
  tl.fromTo(q, { autoAlpha: 0 }, { autoAlpha: 1, duration: voo * 0.66, ease: 'sine.out', immediateRender: false }, voo * 0.33)
  // pousou: troca no mesmo quadro
  tl.call(
    () => {
      alfa([s.produto, s.raridade, s.valor, s.alvo], 1)
      if (c) alfa([c.cartao], 0)
    },
    [],
    voo,
  )
  const t0 = voo
  if (s.deu) tl.fromTo(s.deu, { autoAlpha: 0, scale: 1.8 }, { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'steps(3)', immediateRender: false }, t0)
  if (s.valor) tl.fromTo(s.valor, { scale: 1.12 }, { scale: 1, duration: 0.1, ease: 'steps(2)', immediateRender: false }, t0)
  if (s.festa.length) {
    tl.set(s.festa, { autoAlpha: 1, x: 0, y: 0 }, t0 + 0.04)
    tl.to(s.festa, { x: (_: number, p: HTMLElement) => +(p.dataset.x ?? 0), y: (_: number, p: HTMLElement) => +(p.dataset.y ?? 0), duration: 0.24, ease: 'steps(4)', stagger: { each: 0.004, from: 'random' } }, t0 + 0.04)
    tl.to(s.festa, { y: '+=24', autoAlpha: 0, duration: 0.21, ease: 'steps(3)', stagger: { each: 0.004, from: 'random' } }, t0 + 0.34)
  }
  s.brilhos.forEach((x, i) => {
    const t = t0 + 0.1 + i * 0.12
    tl.fromTo(x, { autoAlpha: 1, scale: 0 }, { scale: 1, duration: 0.1, ease: 'steps(2)', repeat: 1, yoyo: true, immediateRender: false }, t)
    tl.set(x, { autoAlpha: 0 }, t + 0.2)
  })
  if (s.apoio) tl.to(s.apoio, { autoAlpha: 1, duration: 0.001 }, t0 + 0.08)
  // adesivos: colam com um pulinho em degraus (passa do tamanho e volta)
  ;[s.codigo, s.contagem].forEach((x, i) => {
    if (!x) return
    const t = t0 + 0.14 + i * 0.08
    tl.fromTo(x, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1.12, duration: 0.1, ease: 'steps(2)', immediateRender: false }, t)
    tl.to(x, { scale: 1, duration: 0.05, ease: 'steps(1)' }, t + 0.1)
  })
  if (s.cond) tl.to(s.cond, { autoAlpha: 1, duration: 0.08, ease: 'steps(2)' }, t0 + 0.28)
  // ações (app): sobem no pé do story; quando a comemoração acaba, a fase vira "prêmio" (o story deixa de ser inerte e
  // o foco vai pro destaque)
  if (pe) tl.set(pe, { autoAlpha: 1 }, t0 + 0.06)
  tl.to(peFilhos, { autoAlpha: 1, y: 0, duration: 0.26, ease: APP }, t0 + 0.06)
  // o pé (as ações) acabou de subir: o story já é do cliente (o resto da festa termina sozinho)
  tl.call(o.aoFim, [], t0 + (o.rapido ? 0.16 : 0.36))
  return tl
}
