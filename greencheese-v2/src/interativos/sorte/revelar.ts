import { gsap } from 'gsap'
import { K } from '../../arte/realista/acessorios-dichavador'
import { partesDoBeck, pintarBeck } from './fumaca/Beck'
import { poseDoBeck } from './fumaca/pose'
import { vibrar } from './tato'

// Storyboard da revelação (t = 0 é o 8º quarto; pedido do Ian em 11/10). Duas vozes: "app" (consequência do dedo: a
// câmera deita, a tampa sai, o beck sobe, o story entra) e "pixel" (steps(): adesivos, destaque, confete). Só transform
// e opacity. Movimento reduzido: cortes secos. Modo leve: deitar vira corte.
//
//   0,12–0,52  a câmera deita (a tampa achata e o corpo entra por baixo); o texto de cima some
//   0,52–0,90  a tampa salta e voa pra fora
//   0,58–1,55  o beck bolado sobe de dentro da câmara (o lábio e a parede da frente escondem o pé dele), girando devagar
//              no próprio eixo, cresce e para no meio da tela, levemente inclinado; o dichavador desce e some
//   1,55       EMENDA: a RevelacaoFumaca (fumaca/) assume com o beck na mesma pose (poseDoBeck) e faz o resto: acende,
//              puxadas, fumaça, a viagem da raridade, o prêmio no meio da fumaça (onPronto)
//   depois     entrarStory: o story dos Melhores amigos sai da fumaça (que vira o fundo e se desfaz) com a comemoração
//              em pixel; no fim a fase vira "prêmio" e o foco vai pro destaque

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

/** Desde quando um toque pula a revelação (s): a tampa já saiu. Antes disso, o toque é o reflexo de quem girava. */
export const PULAR_DESDE = 0.9
/** A emenda: o beck chega no meio da tela e a fumaça assume. */
export const EMENDA = 1.55
/** Depois do auge (o prêmio assentado na fumaça), quanto ele fica sozinho antes de o story entrar. */
export const RESPIRO_AUGE = 0.9

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
  /** O beck dentro da câmara (sobe até a emenda). */
  beck: HTMLElement
  /** O palco da fumaça (a área visível da coluna): a pose da emenda é medida nele. */
  fumaca: HTMLElement
  /** O que some quando a câmera deita (texto de cima, legenda, botão, rodapé). */
  sumir: Element[]
  /** O que sobe junto quando o texto de cima sai do fluxo no fim (a cena): sem pulo de layout. */
  subir: HTMLElement[]
  /** Altura que o texto de cima ocupa (sai do layout quando a revelação termina). */
  alturaIntro: number
  /** O quadro do story. */
  quadro: HTMLElement
  /** As ações no pé do story (sobem no fim). */
  pe: HTMLElement | null
  /** Segmentos "Abrir" e "Prêmio" do cromo do jogo, e o cromo (some quando o story entra: ele tem a barrinha dele). */
  segAbrir: Element | null
  segPremio: Element | null
  cromo: HTMLElement | null
  /** O título do jogo ("TESTE MINHA SORTE"): some na emenda (a fumaça ocupa a tela). */
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

/** O que entra no story na comemoração. */
function partesDoStory(q: HTMLElement) {
  const um = (s: string) => q.querySelector<HTMLElement>(s)
  return {
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
  fixar([el.tampa, el.corpo, el.labio, el.beck], { autoAlpha: 0 })
  fixar(el.quadro, { autoAlpha: 1, clearProps: 'transform' })
  fixar([s.deu, s.raridade, s.valor, s.codigo, s.contagem], { autoAlpha: 1, clearProps: 'transform' })
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
  /** Quanto a fumaça dura (até o auge), pro segmento "Prêmio" do cromo encher junto. */
  duracaoFumaca: number
  /** A emenda: a RevelacaoFumaca monta (o beck dela já na pose). */
  aoEmenda: () => void
}

/**
 * Monta a primeira metade da revelação (a partir do fim do estalo): a câmera deita, a tampa sai e o beck sobe de dentro
 * da câmara até a pose da emenda. A fumaça e o story vêm depois (RevelacaoFumaca e entrarStory).
 */
export function montarRevelacao(el: ElementosRevelacao, o: Opcoes): gsap.core.Timeline {
  const s = partesDoStory(el.quadro)
  const segs = [el.segAbrir, el.segPremio].filter(Boolean) as Element[]
  const peFilhos = el.pe ? [...el.pe.children] : []
  const tl = gsap.timeline()

  // estado inicial: o story escondido (já no lugar final); o que entra na comemoração, escondido
  fixar(el.quadro, { autoAlpha: 0 })
  fixar([s.deu, s.raridade, s.valor, s.alvo, s.apoio, s.codigo, s.contagem, s.cond, ...s.festa, ...s.brilhos], { autoAlpha: 0 })
  if (el.pe) fixar([el.pe, ...peFilhos], { autoAlpha: 0 })
  fixar(peFilhos, { y: 12 })
  fixar(segs, { scaleX: 0, transformOrigin: '0% 50%' })

  if (o.reduzido) {
    // cortes secos: o dichavador aberto, parado 400 ms → a fumaça parada com o prêmio (RevelacaoFumaca reduzido)
    tl.set([el.anel, el.indicador, ...el.sumir], { opacity: 0 }, 0)
    if (el.alturaIntro) tl.set(el.subir, { y: -el.alturaIntro }, 0)
    tl.set(el.tampa, { autoAlpha: 0 }, 0)
    tl.set(el.disco, { yPercent: -18, scaleY: K }, 0)
    tl.set([el.corpo, el.labio, el.lado], { opacity: 1, y: 0 }, 0)
    if (el.segAbrir) tl.set(el.segAbrir, { scaleX: 1 }, 0)
    tl.set([el.corpo, el.labio, el.lado, el.disco, el.beck], { autoAlpha: 0 }, 0.4)
    if (el.titulo) tl.set(el.titulo, { autoAlpha: 0 }, 0.4)
    if (el.segPremio) tl.set(el.segPremio, { scaleX: 1 }, 0.4)
    tl.call(o.aoEmenda, [], 0.4)
    return tl
  }

  // medidas no começo (a coluna já rolou pro topo e nada tem transform ainda): de onde o beck sai e onde ele para
  const subida = el.subir.some((x) => x.classList.contains('sorte-cena')) ? el.alturaIntro : 0
  gsap.set(el.beck, { clearProps: 'transform' })
  const b = el.beck.getBoundingClientRect()
  const f = el.fumaca.getBoundingClientRect()
  const pose = poseDoBeck(f.width, f.height)
  const escala = pose.h / Math.max(1, b.height)
  const dx = f.left + pose.x - (b.left + b.width / 2)
  const dy = f.top + pose.y - (b.top + b.height / 2 - subida)
  const partes = partesDoBeck(el.beck)
  const beck = { giro: 0 }
  const pintar = () => partes && pintarBeck(partes, { queima: 0, brasa: 0, luz: 0, torcida: 1, giro: beck.giro, pende: 0 })

  // 0,12–0,52 · CÂMERA DEITA (app): a tampa achata (vista de lado) e o corpo entra por baixo
  const deita = o.leve ? { duration: 0.12, ease: 'steps(2)' } : { duration: 0.4, ease: APP }
  tl.to(el.disco, { yPercent: -18, scaleY: K, ...deita }, 0.12)
  tl.fromTo([el.corpo, el.labio], { y: 24, opacity: 0 }, { y: 0, opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.fromTo(el.lado, { opacity: 0 }, { opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.to([el.anel, el.indicador, ...el.sumir], { opacity: 0, duration: 0.2, ease: 'steps(3)' }, 0.12)
  // o texto de cima some e a cena sobe no lugar dele (no fim ele sai do layout e a cena fica onde está)
  if (el.alturaIntro) tl.to(el.subir, { y: -el.alturaIntro, ...deita }, 0.12)

  // 0,52–0,90 · A TAMPA SALTA: sobe girando e voa pra fora (a boca da câmara fica à vista, com o beck lá dentro)
  tl.to(el.tampa, { y: -150, xPercent: -26, rotation: -38, duration: 0.38, ease: 'power2.out', transformOrigin: '50% 30%' }, 0.52)
  tl.to(el.tampa, { opacity: 0, duration: 0.14, ease: 'none' }, 0.76)

  // 0,58–1,55 · O BECK SOBE de dentro da câmara (o lábio e a parede da frente escondem o pé), girando no próprio eixo
  // (a costura e a fibra passam, a luz fica): sai inteiro da boca (até 1,05), solta do recorte e flutua até o meio da
  // tela, crescendo e parando levemente inclinado (a pose da emenda)
  const caixa = el.beck.parentElement
  const pico = -b.height * 0.6
  tl.set(el.beck, { autoAlpha: 1, x: 0, y: b.height * 0.62, scale: 1, rotation: 0, transformOrigin: '50% 50%' }, 0)
  tl.call(() => vibrar('trava'), [], 0.6)
  tl.to(el.beck, { y: pico, scale: 1.12, rotation: -5, duration: 0.47, ease: 'power2.out' }, 0.58)
  if (caixa) tl.set(caixa, { clipPath: 'none' }, 1.05)
  tl.to(el.beck, { x: dx, y: dy, scale: escala, rotation: pose.ang, duration: EMENDA - 1.05, ease: 'power2.inOut' }, 1.05)
  tl.fromTo(beck, { giro: 0 }, { giro: Math.PI * 2.5, duration: EMENDA - 0.58, ease: 'power1.out', onUpdate: pintar, immediateRender: false }, 0.58)
  // o dichavador desce e some (a fumaça vai ocupar a tela)
  tl.to([el.corpo, el.labio, el.lado, el.disco], { y: '+=40', opacity: 0, duration: 0.42, ease: 'power2.in' }, 1.02)

  // 1,55 · EMENDA: a fumaça assume (o título sai; o segmento "Prêmio" enche durante a fumaça)
  if (el.titulo) tl.to(el.titulo, { autoAlpha: 0, duration: 0.2, ease: 'steps(2)' }, EMENDA - 0.3)
  tl.call(o.aoEmenda, [], EMENDA)
  // o beck do jogo sai de baixo assim que o da fumaça (na mesma pose, por cima) já desenhou: senão, quando a fumaça
  // abre o buraco do prêmio, ele aparece lá no fundo, inteiro (o da fumaça já queimou)
  const esconderBeck = (tentativas: number) => {
    if (el.fumaca?.querySelector('.fm[data-desenho]') || tentativas <= 0) gsap.set(el.beck, { autoAlpha: 0 })
    else requestAnimationFrame(() => esconderBeck(tentativas - 1))
  }
  tl.call(() => esconderBeck(90), [], EMENDA + 0.25)

  // segmentos do cromo do jogo: "Abrir" enche até a tampa sair; "Prêmio", durante a fumaça (nunca passam sozinhos)
  if (el.segAbrir) tl.to(el.segAbrir, { scaleX: 1, duration: 0.78, ease: 'none' }, 0.12)
  if (el.segPremio) tl.to(el.segPremio, { scaleX: 1, duration: o.duracaoFumaca, ease: 'none' }, EMENDA)
  return tl
}

/**
 * O story sai da fumaça (que vira o fundo e se desfaz, ver dissiparFumaca): o quadro chega perto (escala) já no lugar
 * final e a comemoração em pixel acontece nele (o adesivo "DEU SORTE!" e o da raridade batem, o destaque carimba, o
 * confete estoura de trás do produto, 3 brilhos piscam, os adesivos colam) e as ações sobem; no fim, aoFim.
 */
export function entrarStory(el: ElementosRevelacao, o: { aoFim: () => void }): gsap.core.Timeline {
  const s = partesDoStory(el.quadro)
  const peFilhos = el.pe ? [...el.pe.children] : []
  const tl = gsap.timeline()
  if (s.valor) posicionarBrilhos(s.valor, s.brilhos, el.quadro)
  if (s.festa.length) rumoDoConfete(s.festa, el.quadro)
  if (el.cromo) tl.to(el.cromo, { autoAlpha: 0, duration: 0.15, ease: 'none' }, 0)
  if (el.segPremio) tl.to(el.segPremio, { scaleX: 1, duration: 0.15, ease: 'none' }, 0)
  // o story sai da fumaça: aparece devagar por cima do prêmio na fumaça (que some e cresce enquanto isso), então nos
  // primeiros quadros a fumaça e o prêmio ainda aparecem através dele; o tamanho vem com a voz "app"
  tl.fromTo(el.quadro, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.55, ease: 'sine.inOut', immediateRender: false }, 0)
  tl.fromTo(el.quadro, { scale: 0.86, y: 18 }, { scale: 1, y: 0, duration: 0.6, ease: APP, immediateRender: false }, 0)
  tl.set(el.quadro, { clearProps: 'transform' }, 0.61)

  const t0 = 0.3
  if (s.deu) tl.fromTo(s.deu, { autoAlpha: 0, scale: 1.8 }, { autoAlpha: 1, scale: 1, duration: 0.18, ease: 'steps(3)', immediateRender: false }, t0)
  if (s.raridade) tl.fromTo(s.raridade, { autoAlpha: 0, scale: 2 }, { autoAlpha: 1, scale: 1, duration: 0.16, ease: 'steps(3)', immediateRender: false }, t0 + 0.08)
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
  if (s.alvo) tl.to(s.alvo, { autoAlpha: 1, duration: 0.001 }, t0 + 0.2)
  if (s.apoio) tl.to(s.apoio, { autoAlpha: 1, duration: 0.001 }, t0 + 0.26)
  // adesivos: colam com um pulinho em degraus (passa do tamanho e volta)
  ;[s.codigo, s.contagem].forEach((x, i) => {
    if (!x) return
    const t = t0 + 0.32 + i * 0.08
    tl.fromTo(x, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1.12, duration: 0.1, ease: 'steps(2)', immediateRender: false }, t)
    tl.to(x, { scale: 1, duration: 0.05, ease: 'steps(1)' }, t + 0.1)
  })
  if (s.cond) tl.to(s.cond, { autoAlpha: 1, duration: 0.08, ease: 'steps(2)' }, t0 + 0.46)
  // ações (app): sobem no pé do story; no fim delas, a fase vira "prêmio" (o story deixa de ser inerte e o foco vai pro
  // destaque)
  if (el.pe) tl.set(el.pe, { autoAlpha: 1 }, 0.36)
  tl.to(peFilhos, { autoAlpha: 1, y: 0, duration: 0.26, ease: APP }, 0.36)
  // o confete cai até ~1 s: a fase vira "prêmio" (e o story deixa de ser inerte) quando a comemoração acaba
  tl.call(o.aoFim, [], 1.0)
  return tl
}
