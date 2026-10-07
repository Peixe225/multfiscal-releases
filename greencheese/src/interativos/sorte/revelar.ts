import { gsap } from 'gsap'
import { K } from '../../arte/realista/acessorios-dichavador'
import { BECK_ESCONDIDO } from './Palco'
import { vibrar } from './tato'

// Storyboard da revelação (t = 0 é o 8º quarto). Uma timeline GSAP só; quem monta mata ao desmontar.
// Duas vozes: "app" (var(--ease-app), consequência do dedo) e "pixel" (steps(), enfeite e comemoração).
// Só transform e opacity. Movimento reduzido: cortes secos. Modo leve: a câmera que deita vira corte.

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

/** Desde quando um toque pula a revelação (s): o beck já saiu da câmara e está deitando no cartão. */
export const PULAR_DESDE = 1.4

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
  beck: HTMLElement
  /** Legendas do beck ("Saiu bolado." / "Só papel e sorte."). */
  legBeck: HTMLElement | null
  /** O que some quando a câmera deita (legenda, botão, rodapé, sub). */
  sumir: Element[]
  /** O que sobe junto quando o texto de cima sai do fluxo no fim (cena e botões): sem pulo de layout. */
  subir: HTMLElement[]
  /** Altura que o texto de cima ocupa (sai do layout quando a revelação termina). */
  alturaIntro: number
  cartaoPos: HTMLElement
  cartao: HTMLElement
  rolo: HTMLElement
  botoes: Element[]
  segAbrir: Element | null
  segPremio: Element | null
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

/** Origem do "recua" (scale 0,9) no centro do palco, para cada camada. */
function origemNoPalco(palco: HTMLElement) {
  return (_: number, el: HTMLElement) => {
    const p = palco.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return `${p.left + p.width / 2 - r.left}px ${p.top + p.width / 2 - r.top}px`
  }
}

/** gsap.set que ignora alvo vazio (sem o aviso "target not found" do GSAP). */
function fixar(alvos: gsap.TweenTarget | (Element | null | undefined)[], v: gsap.TweenVars) {
  const lista = (Array.isArray(alvos) ? alvos : [alvos]).filter(Boolean) as gsap.TweenTarget[]
  if (lista.length) gsap.set(lista, v)
}

function partes(beck: HTMLElement) {
  const q = (n: string) => beck.querySelector<SVGGElement>(`[data-parte="${n}"]`)
  return { ponta: q('ponta'), tubo: q('tubo'), piteira: q('piteira') }
}

function textoDoCartao(cartao: HTMLElement, pos: HTMLElement) {
  return {
    linhas: [...cartao.querySelectorAll('[data-linha]')],
    carimbo: cartao.querySelector('[data-carimbo]'),
    letras: [...cartao.querySelectorAll('[data-letras] > span')],
    mosaico: cartao.querySelector('[data-mosaico]'),
    // comemoração: o produto e os raios entram juntos, o destaque bate, confete atrás do cartão e brilhos no destaque
    foto: cartao.querySelector<HTMLElement>('[data-foto]'),
    raios: cartao.querySelector('[data-raios]'),
    valor: cartao.querySelector('[data-valor]'),
    festa: [...pos.querySelectorAll<HTMLElement>('[data-festa] > i')],
    brilhos: [...cartao.querySelectorAll('[data-brilho]')],
  }
}

/**
 * Brilhos nos cantos do texto de verdade, sempre inteiros dentro do papel (o cartão corta o que passa da borda).
 * Ao lado da linha quando tem espaço; quando o destaque ocupa a largura toda ("LEVA 4 PAGA 3" em 320 px), em cima
 * das pontas da linha, sobre os raios (nunca na foto, que fica no meio, nem embaixo, onde vem o nome do produto).
 * Medido uma vez, antes da comemoração (left/top fixos; o movimento é só scale e opacity). A inclinação de -2° do
 * cartão desvia 1 ou 2 px, que a folga de 4 px absorve.
 */
function posicionarBrilhos(valor: Element, brilhos: Element[]) {
  const texto = valor.firstChild
  if (!texto || texto.nodeType !== Node.TEXT_NODE) return
  const faixa = document.createRange()
  faixa.selectNodeContents(texto)
  const linhas = [...faixa.getClientRects()]
  if (!linhas.length) return
  const c = valor.getBoundingClientRect()
  const corpo = (valor.closest('.cartao-corpo') ?? valor).getBoundingClientRect()
  const minX = corpo.left + 4
  const maxX = corpo.right - 4
  const prim = linhas[0]
  const ult = linhas[linhas.length - 1]
  const tam = brilhos.map((b) => (b as HTMLElement).getBoundingClientRect().width || 14)
  // [x, y] na tela: ao lado se couber; senão, em cima da ponta da linha
  const lugar = (i: number, lado: [number, number], cima: [number, number]): [number, number] => (lado[0] >= minX && lado[0] + tam[i] <= maxX ? lado : cima)
  const pos: [number, number][] = [
    lugar(0, [prim.left - tam[0] - 3, prim.top - 10], [prim.left + 2, prim.top - tam[0] - 2]),
    lugar(1, [prim.right + 4, prim.top - 14], [prim.right - tam[1] - 2, prim.top - tam[1] - 6]),
    // ao lado da última linha, na meia altura (mais baixo encostaria no nome do produto); sem espaço, em cima, a 1/4 da ponta
    lugar(2, [ult.right + 8, ult.top + ult.height * 0.3], [prim.left + prim.width * 0.76, prim.top - tam[2] - 2]),
  ]
  brilhos.forEach((b, i) => {
    const p = pos[i]
    if (!p) return
    const x = Math.min(Math.max(p[0], minX), maxX - tam[i])
    Object.assign((b as HTMLElement).style, { left: `${Math.round(x - c.left)}px`, top: `${Math.round(p[1] - c.top)}px`, right: 'auto', bottom: 'auto' })
  })
}

/**
 * Rumo de cada pedaço de confete em px, a partir da fração gravada no pedaço (CartaoPremio) e do espaço livre medido
 * agora: em cima, o vão até o título (a cena ainda vai subir `subida` px); dos lados, a margem até a borda da área que
 * rola ou até a coluna vizinha. Pedaço de cima sem vão nem aparece; o do lado sem margem fica atrás do cartão.
 */
function rumoDoConfete(festa: HTMLElement[], pos: HTMLElement, subida: number) {
  const c = pos.getBoundingClientRect()
  const area = (pos.closest('.casca-corpo') ?? document.documentElement).getBoundingClientRect()
  // teto: o título, quando está em cima do cartão (deitado ele fica na outra coluna), ou o topo da área que rola
  const titulo = pos.closest('.sorte')?.querySelector('.sorte-h2')?.getBoundingClientRect()
  const teto = titulo && titulo.left < c.right && titulo.right > c.left ? Math.max(titulo.bottom, area.top) : area.top

  let esq = c.left - area.left - 4
  let dir = area.right - c.right - 4
  // deitado, a coluna dos botões fica ao lado do cartão: o confete para no vão entre as colunas
  for (const v of pos.closest('.sorte')?.querySelectorAll('.sorte-barra, .sorte-acoes, .sorte-h2, .sorte-intro') ?? []) {
    const r = v.getBoundingClientRect()
    if (r.left >= c.right - 1) dir = Math.min(dir, r.left - c.right - 4)
    if (r.right <= c.left + 1) esq = Math.min(esq, c.left - r.right - 4)
  }
  for (const p of festa) {
    const t = p.offsetWidth
    const fx = +(p.dataset.dx ?? 0)
    const fy = +(p.dataset.dy ?? 0)
    // topo do pedaço onde ele vai estar quando a comemoração começar (a cena já subiu)
    const topo = c.top - subida + p.offsetTop
    if (p.dataset.lado === 'cima') {
      // sobe até 4 px do teto, usando o vão todo
      const sobe = Math.max(0, topo - teto - 4)
      p.dataset.x = String(Math.round(fx * Math.min(28, sobe)))
      p.dataset.y = String(Math.round(fy * sobe))
      // sem vão (cartão encostado no topo da área, como no celular deitado): esse pedaço nem aparece
      p.dataset.fora = sobe < t + 8 ? '1' : ''
    } else {
      const livre = Math.max(0, Math.min(48, (fx < 0 ? esq : dir) - t / 2))
      p.dataset.x = String(Math.round(fx * livre))
      // sobe no máximo até o teto
      p.dataset.y = String(Math.round(Math.max(fy * 18, teto + 2 - topo)))
    }
  }
}

/** Estado final pintado de uma vez: dichavador aberto e recuado, cartão completo, botões à vista. */
export function pintarFinal(el: ElementosRevelacao) {
  const { linhas, carimbo, letras, mosaico, foto, raios, valor, festa, brilhos } = textoDoCartao(el.cartao, el.cartaoPos)
  fixar([el.anel, el.indicador, ...el.sumir], { opacity: 0 })
  fixar(el.tampa, { autoAlpha: 0 })
  fixar([el.corpo, el.labio], { opacity: 0.25, scale: 0.9, y: 0, transformOrigin: origemNoPalco(el.palco) })
  fixar(el.beck, { autoAlpha: 0 })
  if (el.legBeck) fixar(el.legBeck, { autoAlpha: 0 })
  fixar(el.cartao, { opacity: 1, scaleY: 1 })
  fixar(el.rolo, { autoAlpha: 0 })
  fixar([...linhas, ...letras], { autoAlpha: 1 })
  if (carimbo) fixar(carimbo, { autoAlpha: 1, scale: 1, rotation: -6 })
  if (mosaico) fixar(mosaico, { autoAlpha: 1 })
  // o produto fica no lugar dele (a inclinação de +3° é do CSS); confete e brilhos só existem na comemoração
  fixar([foto, raios, valor], { clearProps: 'transform' })
  fixar([foto, raios], { autoAlpha: 1 })
  fixar([...festa, ...brilhos], { autoAlpha: 0, x: 0, y: 0 })
  fixar(el.botoes, { opacity: 1, y: 0 })
  fixar([el.segAbrir, el.segPremio].filter(Boolean), { scaleX: 1 })
  // o texto de cima já saiu do layout: a cena e os botões voltam pro lugar deles
  fixar(el.subir, { clearProps: 'transform' })
}

interface Opcoes {
  reduzido: boolean
  leve: boolean
  aoFoco: () => void
  aoFim: () => void
}

/** Monta a timeline da revelação (a partir do fim do estalo). */
export function montarRevelacao(el: ElementosRevelacao, o: Opcoes): gsap.core.Timeline {
  const { ponta, tubo, piteira } = partes(el.beck)
  const { linhas, carimbo, letras, mosaico, foto, raios, valor, festa, brilhos } = textoDoCartao(el.cartao, el.cartaoPos)
  const segs = [el.segAbrir, el.segPremio].filter(Boolean) as Element[]

  // medidas no começo (a coluna já rolou pro topo): beck em pé, sem transform, e a borda de cima do cartão
  if (valor && !o.reduzido) posicionarBrilhos(valor, brilhos)
  const cena = el.cartaoPos.closest<HTMLElement>('.sorte-cena')
  if (festa.length && !o.reduzido) rumoDoConfete(festa, el.cartaoPos, cena && el.subir.includes(cena) ? el.alturaIntro : 0)
  gsap.set(el.beck, { clearProps: 'transform' })
  const b = el.beck.getBoundingClientRect()
  const c = el.cartaoPos.getBoundingClientRect()
  const hCartao = el.cartao.offsetHeight
  const dx = c.left + c.width / 2 - (b.left + b.width / 2)
  // a cena (com o beck e o cartão) sobe alturaIntro junto; o alvo é relativo a ela, então não muda
  const dy = c.top + 12 - (b.top + b.height / 2)
  // 40 px de tela em unidades do SVG do beck (60 de largura), já com a escala 1,4 do beck deitado
  const unidade = (b.width / 60) * 1.4

  // o fim (fase "prêmio", botões vivos) é chamado no fim dos botões (2,96 s), não no fim da timeline: nada da
  // comemoração segura o "Guardar meu prêmio" inerte depois que ele já apareceu inteiro
  const tl = gsap.timeline()

  // estado inicial do que entra depois
  fixar(el.beck, { autoAlpha: 0, yPercent: BECK_ESCONDIDO })
  fixar(el.cartao, { opacity: 0, scaleY: 0.08, transformOrigin: '50% 0%' })
  fixar(el.rolo, { autoAlpha: 0 })
  fixar([...linhas, ...letras], { autoAlpha: 0 })
  if (carimbo) fixar(carimbo, { autoAlpha: 0 })
  if (mosaico) fixar(mosaico, { autoAlpha: 0 })
  fixar([foto, raios, ...festa, ...brilhos], { autoAlpha: 0 })
  if (el.legBeck) fixar(el.legBeck, { autoAlpha: 0 })
  fixar(el.botoes, { opacity: 0, y: 12 })
  fixar(segs, { scaleX: 0, transformOrigin: '0% 50%' })

  if (o.reduzido) {
    // cortes secos: aberto com o beck em pé e "Saiu bolado." (400 ms parado) → cartão completo
    tl.set([el.anel, el.indicador, ...el.sumir], { opacity: 0 }, 0)
    if (el.alturaIntro) tl.set(el.subir, { y: -el.alturaIntro }, 0)
    tl.set(el.tampa, { autoAlpha: 0 }, 0)
    tl.set([el.corpo, el.labio], { opacity: 1, y: 0 }, 0)
    tl.set(el.beck, { autoAlpha: 1, yPercent: 0 }, 0)
    if (el.legBeck) tl.set(el.legBeck, { autoAlpha: 1 }, 0)
    if (el.segAbrir) tl.set(el.segAbrir, { scaleX: 1 }, 0)
    tl.call(() => pintarFinal(el), [], 0.4)
    tl.call(o.aoFoco, [], 0.4)
    tl.call(o.aoFim, [], 0.4)
    return tl
  }

  // 0,12–0,52 · CÂMERA DEITA (app): a tampa achata (vista de lado) e o corpo entra por baixo
  const deita = o.leve ? { duration: 0.12, ease: 'steps(2)' } : { duration: 0.4, ease: APP }
  tl.to(el.disco, { yPercent: -18, scaleY: K, ...deita }, 0.12)
  tl.fromTo([el.corpo, el.labio], { y: 24, opacity: 0 }, { y: 0, opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.fromTo(el.lado, { opacity: 0 }, { opacity: 1, ...deita, immediateRender: false }, 0.12)
  tl.to([el.anel, el.indicador, ...el.sumir], { opacity: 0, duration: 0.2, ease: 'steps(3)' }, 0.12)
  // o texto de cima some e a cena sobe no lugar dele (no fim ele sai do layout e a cena fica onde está)
  if (el.alturaIntro) tl.to(el.subir, { y: -el.alturaIntro, ...deita }, 0.12)

  // 0,52–0,82 · TAMPA SAI: a tampa levanta e deita de lado; aparece a boca vazia
  tl.to(el.tampa, { y: -64, rotation: -14, xPercent: -18, opacity: 0.6, duration: 0.3, ease: 'power3.out', transformOrigin: '50% 30%' }, 0.52)
  // longe da boca, a tampa passa pra trás do beck
  tl.set(el.tampa, { zIndex: 1 }, 0.82)

  // 0,82–1,34 · BECK SOBE de dentro da câmara (o lábio fica por cima) e quica 2 degraus no topo
  tl.set(el.beck, { autoAlpha: 1 }, 0.82)
  tl.to(el.beck, { yPercent: 0, duration: 0.44, ease: APP }, 0.82)
  tl.to(el.beck, { yPercent: -5, duration: 0.04, ease: 'steps(1)' }, 1.26)
  tl.to(el.beck, { yPercent: 0, duration: 0.04, ease: 'steps(1)' }, 1.3)

  // 1,34–1,70 · BECK DEITA na borda de cima do cartão (passa por cima dele); o dichavador recua
  tl.set(el.beck, { zIndex: 10 }, 1.34)
  tl.to(el.beck, { x: dx, y: dy, rotation: -92, scale: 1.4, duration: 0.36, ease: APP }, 1.34)
  tl.to([el.corpo, el.labio], { opacity: 0.25, scale: 0.9, transformOrigin: origemNoPalco(el.palco), duration: 0.36, ease: APP }, 1.34)
  tl.to(el.tampa, { opacity: 0, duration: 0.2, ease: 'none' }, 1.34)
  if (el.legBeck) tl.to(el.legBeck, { autoAlpha: 1, duration: 0.16, ease: 'steps(2)' }, 1.4)

  // 1,70–2,30 · DESENROLA: a piteira solta e cai, a torcida desenrosca, o cartão desce do tubo
  if (piteira) tl.to(piteira, { x: -40 / unidade, rotation: 30, opacity: 0, duration: 0.24, ease: 'steps(4)', transformOrigin: '50% 50%' }, 1.7)
  if (ponta) tl.to(ponta, { rotation: 90, opacity: 0, duration: 0.12, ease: 'power2.in', transformOrigin: '50% 100%' }, 1.7)
  tl.set(el.cartao, { opacity: 1 }, 1.76)
  tl.to(el.cartao, { scaleY: 1, duration: 0.54, ease: APP }, 1.76)
  if (tubo) tl.to(tubo, { opacity: 0, duration: 0.3, ease: 'none' }, 1.76)
  tl.to(el.beck, { autoAlpha: 0, duration: 0.01 }, 2.06)
  tl.fromTo(el.rolo, { autoAlpha: 1, y: hCartao * 0.08, scaleY: 1 }, { y: hCartao, scaleY: 0.4, duration: 0.54, ease: APP, immediateRender: false }, 1.76)
  tl.to(el.rolo, { autoAlpha: 0, duration: 0.08, ease: 'steps(2)' }, 2.3)
  if (el.legBeck) tl.to(el.legBeck, { autoAlpha: 0, duration: 0.12, ease: 'steps(2)' }, 1.76)

  // 2,30–2,70 · TEXTO (pixel): linha a linha, o carimbo bate, o código entra
  tl.to(linhas, { autoAlpha: 1, duration: 0.001, stagger: 0.06 }, 2.3)
  if (carimbo) tl.fromTo(carimbo, { autoAlpha: 0, scale: 1.4, rotation: -6 }, { autoAlpha: 1, scale: 1, duration: 0.16, ease: 'steps(2)', immediateRender: false }, 2.5)
  if (letras.length) tl.to(letras, { autoAlpha: 1, duration: 0.001, stagger: 0.05 }, 2.4)
  if (mosaico) tl.to(mosaico, { autoAlpha: 1, duration: 0.12, ease: 'steps(2)' }, 2.5)

  // 2,30–2,96 · COMEMORAÇÃO (pixel, uma vez): os raios abrem e o produto pula no papel, o destaque bate como carimbo,
  // o confete sai de trás da metade de cima do cartão (nunca por cima de texto nem dos botões) e cai de volta atrás
  // dele, e 3 brilhos piscam em volta do destaque. Tudo acaba até 2,96 s, quando a fase vira "prêmio".
  tl.call(() => vibrar('premio'), [], 2.3)
  if (raios) tl.fromTo(raios, { autoAlpha: 0, scale: 0.5, rotation: -11.25 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.24, ease: 'steps(3)', immediateRender: false }, 2.3)
  if (foto) {
    tl.fromTo(foto, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1.12, duration: 0.12, ease: 'steps(2)', immediateRender: false }, 2.32)
    tl.to(foto, { scale: 1, duration: 0.08, ease: 'steps(1)' }, 2.44)
  }
  if (valor) tl.fromTo(valor, { scale: 1.35 }, { scale: 1, duration: 0.12, ease: 'steps(2)', immediateRender: false }, 2.36)
  if (festa.length) {
    tl.set(festa, { autoAlpha: (_: number, p: HTMLElement) => (p.dataset.fora ? 0 : 1), x: 0, y: 0 }, 2.36)
    // estoura pra fora (4 degraus) e cai de volta, sumindo (3 degraus); o pintarFinal da fase "prêmio" põe no lugar
    tl.to(festa, { x: (_: number, p: HTMLElement) => +(p.dataset.x ?? 0), y: (_: number, p: HTMLElement) => +(p.dataset.y ?? 0), duration: 0.24, ease: 'steps(4)', stagger: { each: 0.004, from: 'random' } }, 2.36)
    tl.to(festa, { y: '+=20', autoAlpha: 0, duration: 0.21, ease: 'steps(3)', stagger: { each: 0.004, from: 'random' } }, 2.68)
  }
  brilhos.forEach((b, i) => {
    const t = 2.42 + i * 0.12
    tl.fromTo(b, { autoAlpha: 1, scale: 0 }, { scale: 1, duration: 0.1, ease: 'steps(2)', repeat: 1, yoyo: true, immediateRender: false }, t)
    tl.set(b, { autoAlpha: 0 }, t + 0.2)
  })

  // 2,70–2,96 · BOTÕES (app); o foco vai pro título do cartão; no fim deles, a fase vira "prêmio" (inert sai)
  tl.to(el.botoes, { opacity: 1, y: 0, duration: 0.26, ease: APP }, 2.7)
  tl.call(o.aoFoco, [], 2.7)
  tl.call(o.aoFim, [], 2.96)

  // segmentos do story: "Abrir" enche até 1340 ms; "Prêmio", de 1340 a 2700 ms (nunca passam sozinhos)
  if (el.segAbrir) tl.to(el.segAbrir, { scaleX: 1, duration: 1.22, ease: 'none' }, 0.12)
  if (el.segPremio) tl.to(el.segPremio, { scaleX: 1, duration: 1.36, ease: 'none' }, 1.34)
  return tl
}
