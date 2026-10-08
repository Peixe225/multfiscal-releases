import { gsap } from 'gsap'
import { K } from '../../arte/realista/acessorios-dichavador'
import { revelar as sintonizar } from '../../arte/produtos/dither'
import { vibrar } from './tato'

// Storyboard da revelação (t = 0 é o 8º quarto). Uma timeline GSAP só; quem monta mata ao desmontar.
// Duas vozes: "app" (consequência do dedo: a câmera deita, a tampa sai, o mergulho) e "pixel" (steps(): adesivos,
// destaque, confete). Só transform e opacity. Movimento reduzido: cortes secos. Modo leve: deitar vira corte e a
// câmera não cresce no mergulho (só o preto da câmara, que é um div liso).
//
// O corte por correspondência: a tampa sai, a câmera mergulha na câmara escura e o preto do buraco (um div elíptico
// exatamente em cima dele, `boca`) cresce até cobrir o quadro do story. O quadro aparece por cima já preto (o mesmo
// preto) e sintoniza do chiado pro real com a revelação em dither dos produtos (dither.ts), enquanto o produto faz a
// dele (ProdutoVisual: chiado → pixel → real).

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
const APP = 'app'

/** Desde quando um toque pula a revelação (s): a tampa já saiu e a câmera está mergulhando. */
export const PULAR_DESDE = 0.9
/** Até quando o toque ainda pula (depois disso a fase vira "prêmio" logo). */
export const PULAR_ATE = 2.6
/** O corte: o quadro do story aparece por cima do preto da câmara. */
const CORTE = 1.3

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
  /** O preto do buraco da câmara (cresce até cobrir o quadro). */
  boca: HTMLElement
  /** O que some quando a câmera deita (texto de cima, legenda, botão, rodapé). */
  sumir: Element[]
  /** O que sobe junto quando o texto de cima sai do fluxo no fim (a cena): sem pulo de layout. */
  subir: HTMLElement[]
  /** Altura que o texto de cima ocupa (sai do layout quando a revelação termina). */
  alturaIntro: number
  /** O quadro do story. */
  quadro: HTMLElement
  /** O chiado que cobre o quadro e sintoniza. */
  cobertura: HTMLCanvasElement
  /** As ações no pé do story (sobem no fim). */
  pe: HTMLElement | null
  /** Segmentos "Abrir" e "Prêmio" do cromo do jogo, e o cromo (some no corte: o story tem a barrinha dele). */
  segAbrir: Element | null
  segPremio: Element | null
  cromo: HTMLElement | null
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

/** O que entra no story na comemoração. */
function partesDoStory(q: HTMLElement) {
  const um = (s: string) => q.querySelector<HTMLElement>(s)
  return {
    deu: um('[data-deu]'),
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

/* ───────────── chiado do quadro ───────────── */

const parar = new WeakMap<HTMLCanvasElement, () => void>()

/** Cobre o quadro de preto, na resolução do pixel dos produtos (4 px de tela por pixel). */
function cobrir(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect()
  c.width = Math.max(8, Math.round(r.width / 4))
  c.height = Math.max(8, Math.round(r.height / 4))
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
}

/** Sintoniza o quadro: chiado sobre o preto, que se desfaz em ordem Bayer e deixa o story à vista. */
function sintonizarQuadro(c: HTMLCanvasElement) {
  parar.get(c)?.()
  const vazio = new ImageData(c.width, c.height)
  const fim = sintonizar(c, vazio, { duracao: 560, cobrir: [0, 0, 0], densidade: 0.42, vinheta: false, aoTerminar: () => parar.delete(c) })
  parar.set(c, fim)
}

/** Tira o chiado de vez (pulou, estado final). */
function limparQuadro(c: HTMLCanvasElement) {
  parar.get(c)?.()
  parar.delete(c)
  c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
}

/* ───────────── brilhos e confete ───────────── */

/**
 * Brilhos nos cantos do destaque de verdade, sempre inteiros dentro do quadro (que corta o que passa da borda): ao lado
 * da linha quando tem espaço; quando o destaque ocupa a largura toda ("LEVA 4 PAGA 3" em 320 px), em cima das pontas.
 * Medido uma vez, antes da comemoração (left/top fixos; o movimento é só scale e opacity).
 */
function posicionarBrilhos(valor: HTMLElement, brilhos: HTMLElement[], quadro: HTMLElement) {
  const texto = valor.firstChild
  if (!texto || texto.nodeType !== Node.TEXT_NODE) return
  const faixa = document.createRange()
  faixa.selectNodeContents(texto)
  const linhas = [...faixa.getClientRects()]
  if (!linhas.length) return
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
  brilhos.forEach((b, i) => {
    const p = pos[i]
    if (!p) return
    const x = Math.min(Math.max(p[0], minX), maxX - tam[i])
    Object.assign(b.style, { left: `${Math.round(x - c.left)}px`, top: `${Math.round(p[1] - c.top)}px` })
  })
}

/** Rumo de cada pedaço de confete em px: fração gravada no pedaço × o espaço da vitrine (lados e em cima). */
function rumoDoConfete(festa: HTMLElement[], quadro: HTMLElement) {
  const vitrine = festa[0]?.closest<HTMLElement>('.sp-vitrine')
  if (!vitrine) return
  const v = vitrine.getBoundingClientRect()
  const q = quadro.getBoundingClientRect()
  const centro = festa[0].parentElement!.getBoundingClientRect()
  const ladoEsq = centro.left - q.left - 10
  const ladoDir = q.right - centro.left - 10
  const cima = centro.top - v.top
  for (const p of festa) {
    const fx = +(p.dataset.dx ?? 0)
    const fy = +(p.dataset.dy ?? 0)
    p.dataset.x = String(Math.round(fx * (fx < 0 ? ladoEsq : ladoDir) * 0.92))
    p.dataset.y = String(Math.round(fy * cima * 0.95))
  }
}

/** Estado final pintado de uma vez: o story pronto, as ações à vista (o palco, quando existe, escondido). */
export function pintarFinal(el: ElementosRevelacao) {
  const s = partesDoStory(el.quadro)
  fixar([el.anel, el.indicador, ...el.sumir], { opacity: 0 })
  fixar([el.tampa, el.corpo, el.labio, el.boca], { autoAlpha: 0 })
  fixar(el.quadro, { autoAlpha: 1 })
  limparQuadro(el.cobertura)
  fixar([s.deu, s.valor, s.codigo, s.contagem], { autoAlpha: 1, clearProps: 'transform' })
  fixar([s.alvo, s.apoio, s.cond], { autoAlpha: 1 })
  fixar([...s.festa, ...s.brilhos], { autoAlpha: 0, x: 0, y: 0 })
  if (el.pe) fixar([el.pe, ...el.pe.children], { autoAlpha: 1, y: 0 })
  fixar([el.segAbrir, el.segPremio], { scaleX: 1 })
  fixar(el.cromo, { autoAlpha: 0 })
  fixar(el.subir, { clearProps: 'transform' })
}

interface Opcoes {
  reduzido: boolean
  leve: boolean
  /** No corte: o produto começa a sintonizar (React monta o ProdutoVisual com revelar 'sempre'). */
  aoSintonizar: () => void
  /** Fim: a fase vira "prêmio" e o foco vai pro destaque do story. */
  aoFim: () => void
}

/** Monta a timeline da revelação (a partir do fim do estalo). */
export function montarRevelacao(el: ElementosRevelacao, o: Opcoes): gsap.core.Timeline {
  const s = partesDoStory(el.quadro)
  const segs = [el.segAbrir, el.segPremio].filter(Boolean) as Element[]
  const peFilhos = el.pe ? [...el.pe.children] : []
  const tl = gsap.timeline()

  // estado inicial: o quadro escondido e já coberto de preto; o que entra na comemoração, escondido
  fixar(el.quadro, { autoAlpha: 0 })
  cobrir(el.cobertura)
  fixar(el.boca, { autoAlpha: 0, scale: 1 })
  fixar([s.deu, s.valor, s.alvo, s.apoio, s.codigo, s.contagem, s.cond, ...s.festa, ...s.brilhos], { autoAlpha: 0 })
  if (el.pe) fixar([el.pe, ...peFilhos], { autoAlpha: 0 })
  fixar(peFilhos, { y: 12 })
  fixar(segs, { scaleX: 0, transformOrigin: '0% 50%' })

  if (o.reduzido) {
    // cortes secos: o dichavador aberto, com a câmara escura à vista (400 ms parado) → o story pronto
    tl.set([el.anel, el.indicador, ...el.sumir], { opacity: 0 }, 0)
    if (el.alturaIntro) tl.set(el.subir, { y: -el.alturaIntro }, 0)
    tl.set(el.tampa, { autoAlpha: 0 }, 0)
    tl.set(el.disco, { yPercent: -18, scaleY: K }, 0)
    tl.set([el.corpo, el.labio, el.lado], { opacity: 1, y: 0 }, 0)
    if (el.segAbrir) tl.set(el.segAbrir, { scaleX: 1 }, 0)
    tl.call(() => pintarFinal(el), [], 0.4)
    tl.call(o.aoFim, [], 0.4)
    return tl
  }

  // medidas no começo (a coluna já rolou pro topo e nada tem transform ainda)
  const subida = el.subir.some((x) => x.classList.contains('sorte-cena')) ? el.alturaIntro : 0
  const b = el.boca.getBoundingClientRect()
  const q = el.quadro.getBoundingClientRect()
  const cx = b.left + b.width / 2
  const cy = b.top + b.height / 2 - subida
  // elipse em volta do quadro, com o centro na boca: os 4 cantos ficam dentro (√2 × a maior distância em cada eixo)
  const ax = Math.max(cx - q.left, q.right - cx) * Math.SQRT2 * 1.04
  const ay = Math.max(cy - q.top, q.bottom - cy) * Math.SQRT2 * 1.04
  const escala = { x: (2 * ax) / Math.max(1, b.width), y: (2 * ay) / Math.max(1, b.height) }
  const c = el.corpo.getBoundingClientRect()
  const origemBoca = `${cx - c.left}px ${cy + subida - c.top}px`
  if (s.valor) posicionarBrilhos(s.valor, s.brilhos, el.quadro)
  if (s.festa.length) rumoDoConfete(s.festa, el.quadro)

  // 0,12–0,52 · CÂMERA DEITA (app): a tampa achata (vista de lado) e o corpo entra por baixo
  const deita = o.leve ? { duration: 0.12, ease: 'steps(2)' } : { duration: 0.4, ease: APP }
  tl.to(el.disco, { yPercent: -18, scaleY: K, ...deita }, 0.12)
  tl.fromTo([el.corpo, el.labio], { y: 24, opacity: 0 }, { y: 0, opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.fromTo(el.lado, { opacity: 0 }, { opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.to([el.anel, el.indicador, ...el.sumir], { opacity: 0, duration: 0.2, ease: 'steps(3)' }, 0.12)
  // o texto de cima some e a cena sobe no lugar dele (no fim ele sai do layout e a cena fica onde está)
  if (el.alturaIntro) tl.to(el.subir, { y: -el.alturaIntro, ...deita }, 0.12)

  // 0,52–0,82 · TAMPA SAI: levanta e deita de lado; a boca da câmara fica à vista, vazia e escura
  tl.to(el.tampa, { y: -64, rotation: -14, xPercent: -18, opacity: 0.6, duration: 0.3, ease: 'power3.out', transformOrigin: '50% 30%' }, 0.52)
  tl.to(el.tampa, { opacity: 0, duration: 0.16, ease: 'none' }, 0.82)

  // 0,86–1,30 · MERGULHO: a câmera chega perto (o corpo cresce em volta da boca, acelerando) e o preto do buraco
  // acompanha a borda; no fim a câmera vira pra dentro da câmara: o buraco se abre (a elipse arredonda e cresce mais
  // rápido que a borda) e cobre o quadro inteiro. Um valor só (p) move os dois, pra nunca desgrudarem.
  const S = o.leve ? 1 : 3
  const corpoX = gsap.quickSetter([el.corpo, el.labio], 'scaleX') as (v: number) => void
  const corpoY = gsap.quickSetter([el.corpo, el.labio], 'scaleY') as (v: number) => void
  const bocaX = gsap.quickSetter(el.boca, 'scaleX') as (v: number) => void
  const bocaY = gsap.quickSetter(el.boca, 'scaleY') as (v: number) => void
  const mergulho = { p: 0 }
  const aplicar = () => {
    const p = mergulho.p
    const cam = 1 + (S - 1) * p * p
    const q = Math.max(0, (p - 0.4) / 0.6)
    const abre = q * q * q
    if (S > 1) {
      corpoX(cam)
      corpoY(cam)
    }
    bocaX(Math.max(cam, cam + (escala.x - cam) * abre))
    bocaY(Math.max(cam, cam + (escala.y - cam) * abre))
  }
  tl.set([el.corpo, el.labio], { transformOrigin: origemBoca }, 0.86)
  tl.to(el.boca, { autoAlpha: 1, duration: 0.12, ease: 'none' }, 0.86)
  tl.fromTo(mergulho, { p: 0 }, { p: 1, duration: CORTE - 0.86, ease: 'none', onUpdate: aplicar, immediateRender: false }, 0.86)

  // 1,30 · CORTE: o quadro aparece por cima, preto (o mesmo preto); o produto e o chiado começam a sintonizar
  tl.set(el.quadro, { autoAlpha: 1 }, CORTE)
  tl.set([el.corpo, el.labio, el.lado, el.disco], { autoAlpha: 0 }, CORTE)
  if (el.cromo) tl.set(el.cromo, { autoAlpha: 0 }, CORTE)
  tl.call(o.aoSintonizar, [], CORTE)
  tl.call(() => sintonizarQuadro(el.cobertura), [], CORTE + 0.06)
  // o preto da câmara fica em volta até o story sintonizar; depois volta o céu de estrelas (corte seco)
  tl.set(el.boca, { autoAlpha: 0 }, CORTE + 0.62)

  // 1,94–2,54 · COMEMORAÇÃO (pixel, uma vez), com o story já sintonizado: o "DEU SORTE!" bate como adesivo, o destaque
  // carimba, o confete estoura de trás do produto (pros lados e pra cima, nunca no texto) e cai de volta atrás dele,
  // e 3 brilhos piscam
  const t0 = 1.94
  if (s.deu) tl.fromTo(s.deu, { autoAlpha: 0, scale: 1.8 }, { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'steps(3)', immediateRender: false }, t0)
  tl.call(() => vibrar('premio'), [], t0 + 0.06)
  if (s.valor) tl.fromTo(s.valor, { autoAlpha: 0, scale: 1.35 }, { autoAlpha: 1, scale: 1, duration: 0.12, ease: 'steps(2)', immediateRender: false }, t0 + 0.14)
  if (s.festa.length) {
    tl.set(s.festa, { autoAlpha: 1, x: 0, y: 0 }, t0 + 0.18)
    tl.to(s.festa, { x: (_: number, p: HTMLElement) => +(p.dataset.x ?? 0), y: (_: number, p: HTMLElement) => +(p.dataset.y ?? 0), duration: 0.24, ease: 'steps(4)', stagger: { each: 0.004, from: 'random' } }, t0 + 0.18)
    tl.to(s.festa, { y: '+=24', autoAlpha: 0, duration: 0.21, ease: 'steps(3)', stagger: { each: 0.004, from: 'random' } }, t0 + 0.48)
  }
  s.brilhos.forEach((x, i) => {
    const t = t0 + 0.24 + i * 0.12
    tl.fromTo(x, { autoAlpha: 1, scale: 0 }, { scale: 1, duration: 0.1, ease: 'steps(2)', repeat: 1, yoyo: true, immediateRender: false }, t)
    tl.set(x, { autoAlpha: 0 }, t + 0.2)
  })
  if (s.alvo) tl.to(s.alvo, { autoAlpha: 1, duration: 0.001 }, t0 + 0.24)
  if (s.apoio) tl.to(s.apoio, { autoAlpha: 1, duration: 0.001 }, t0 + 0.3)
  // adesivos: colam com um pulinho em degraus (passa do tamanho e volta)
  ;[s.codigo, s.contagem].forEach((x, i) => {
    if (!x) return
    const t = t0 + 0.38 + i * 0.08
    tl.fromTo(x, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1.12, duration: 0.1, ease: 'steps(2)', immediateRender: false }, t)
    tl.to(x, { scale: 1, duration: 0.05, ease: 'steps(1)' }, t + 0.1)
  })
  if (s.cond) tl.to(s.cond, { autoAlpha: 1, duration: 0.08, ease: 'steps(2)' }, t0 + 0.52)

  // 2,40–2,66 · AÇÕES (app): sobem no pé do story; no fim delas, a fase vira "prêmio" (o story deixa de ser inerte e o
  // foco vai pro destaque)
  if (el.pe) tl.set(el.pe, { autoAlpha: 1 }, 2.4)
  tl.to(peFilhos, { autoAlpha: 1, y: 0, duration: 0.26, ease: APP }, 2.4)
  tl.call(o.aoFim, [], 2.66)

  // segmentos do cromo do jogo: "Abrir" enche até a tampa sair; "Prêmio", no mergulho (nunca passam sozinhos)
  if (el.segAbrir) tl.to(el.segAbrir, { scaleX: 1, duration: 0.74, ease: 'none' }, 0.12)
  if (el.segPremio) tl.to(el.segPremio, { scaleX: 1, duration: CORTE - 0.86, ease: 'none' }, 0.86)
  return tl
}
