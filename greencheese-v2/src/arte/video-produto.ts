// Thumb animada do produto: quem toca e quando. Pedaço à parte (o ProdutoVisual só baixa depois da primeira tela e só
// se algum produto à vista tem vídeo). Regras:
// - toca só o que está à vista (metade ou mais na tela), já sintonizado (a revelação em pixel acabou);
// - no máximo 2 ao mesmo tempo (o mais visível primeiro; empate, o que entrou antes);
// - aba escondida: pausa todos; volta quando a aba volta;
// - o vídeo só ganha o src na primeira vez que vai tocar (antes disso, nenhum byte); pausado, fica no quadro em que
//   parou, por cima da capa;
// - erro do vídeo (rede, formato): avisa o ProdutoVisual, que volta pra foto ou pra ilustração.

export interface RegistroVideo {
  /** A sintonia acabou (true) ou recomeçou (false). */
  pronto(sim: boolean): void
  /** Saiu da tela de vez (desmontou): para, solta o arquivo e sai da fila. */
  soltar(): void
}

/** Quantos tocam ao mesmo tempo. */
export const MAXIMO_TOCANDO = 2

interface Item {
  el: HTMLElement
  v: HTMLVideoElement
  src: string
  /** Quanto dele está na tela (0 a 1). */
  visivel: number
  pronto: boolean
  ordem: number
  tocando: boolean
  falhou: boolean
  aoFalhar: () => void
}

const itens = new Set<Item>()
const porElemento = new WeakMap<Element, Item>()
let sequencia = 0
let observador: IntersectionObserver | null = null

function observar(): IntersectionObserver {
  if (observador) return observador
  observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        const it = porElemento.get(e.target)
        if (it) it.visivel = e.isIntersecting ? e.intersectionRatio : 0
      }
      avaliar()
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  )
  document.addEventListener('visibilitychange', avaliar)
  return observador
}

/** Decide quem toca agora (chamado a cada mudança: visibilidade, sintonia, aba, item novo ou que saiu). */
function avaliar(): void {
  const aVista = document.visibilityState !== 'hidden'
  const vez = new Set(
    aVista
      ? [...itens]
          .filter((i) => i.pronto && !i.falhou && i.visivel >= 0.5)
          .sort((a, b) => b.visivel - a.visivel || a.ordem - b.ordem)
          .slice(0, MAXIMO_TOCANDO)
      : [],
  )
  // pausa antes de tocar: nunca passa de 2 nem por um instante
  for (const i of itens) if (!vez.has(i)) pausar(i)
  for (const i of vez) tocar(i)
}

function tocar(i: Item): void {
  if (i.tocando) return
  i.tocando = true
  const v = i.v
  v.muted = true
  v.defaultMuted = true
  if (!v.getAttribute('src')) {
    v.preload = 'auto'
    v.src = i.src
  }
  const p = v.play()
  if (p)
    p.catch((e: unknown) => {
      // tocar sem toque bloqueado (economia de bateria, política do navegador): fica a capa, sem erro
      i.tocando = false
      if (e instanceof DOMException && e.name === 'NotSupportedError') falhar(i)
    })
}

function pausar(i: Item): void {
  if (!i.tocando) return
  i.tocando = false
  i.v.pause()
}

function falhar(i: Item): void {
  if (i.falhou) return
  i.falhou = true
  pausar(i)
  i.el.removeAttribute('data-video')
  i.aoFalhar()
  avaliar()
}

/** Põe um vídeo na fila. el = a caixa do produto (é ela que conta como "à vista"). */
export function registrarVideo(el: HTMLElement, v: HTMLVideoElement, src: string, aoFalhar: () => void): RegistroVideo {
  const i: Item = { el, v, src, visivel: 0, pronto: false, ordem: sequencia++, tocando: false, falhou: false, aoFalhar }
  // com o 1º quadro na tela, a capa sai de baixo (com o lighten, as duas juntas fariam fantasma)
  const aoTocar = () => {
    v.setAttribute('data-tocando', '')
    el.setAttribute('data-video', '')
  }
  const aoErro = () => falhar(i)
  v.addEventListener('playing', aoTocar)
  v.addEventListener('error', aoErro)
  itens.add(i)
  porElemento.set(el, i)
  observar().observe(el)
  return {
    pronto(sim) {
      if (i.pronto === sim) return
      i.pronto = sim
      avaliar()
    },
    soltar() {
      observador?.unobserve(el)
      porElemento.delete(el)
      itens.delete(i)
      v.removeEventListener('playing', aoTocar)
      v.removeEventListener('error', aoErro)
      pausar(i)
      el.removeAttribute('data-video')
      v.removeAttribute('data-tocando')
      // solta o arquivo e o decodificador (a grade pode ter muitos)
      if (v.getAttribute('src')) {
        v.removeAttribute('src')
        try {
          v.load()
        } catch {
          /* já saiu da página */
        }
      }
      avaliar()
    },
  }
}
