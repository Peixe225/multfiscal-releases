import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { iconesExtras } from '../arte/pixel/extras'
import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { deUf } from '../dados/ufs'
import { gravarSessao, lerSessao } from '../lib/armazenamento'
import { ehDiaDeEntregaGratis } from '../lib/horario'
import { ehDesktop, movimentoReduzido } from '../lib/movimento'
import { useProgresso } from '../lib/progresso'
import type { Produto } from '../lib/tipos'
import { disponivelEm, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useDisponiveis } from '../store/derivados'
import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { RespostaStory } from './BarraMensagem'
import { Avatar, Icone, tempoDoCatalogo } from './comum'
import { AvisoLocal, LinhaLocal, useAvisoLocal, useTextoLocal } from './Local'
import { PASSO_MS } from './Mercador'
import { Perfil } from './Perfil'
import { StoryMercador, useConviteSorte } from './StoryMercador'
import { StoryQuadro } from './StoryQuadro'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import './Hero.css'

gsap.registerPlugin(ScrollTrigger)

const MAX_BARRAS = 8
/** Fração da largura em cada borda que passa o story (esquerda volta, direita avança); o meio é o produto. */
const BORDA = 0.28
/** Arrasto lateral mínimo (px) para passar. */
const ARRASTO = 40
const CHAVE_DICA = 'gc-dica-hero'
/** Altura mínima da arte (px) para a dica (~60 px) aparecer cobrindo no máximo metade dela e nunca o nome. */
const ESPACO_DICA = 128
/** Abaixo dessa altura da arte (px) o próximo produto, esmaecido atrás, não aparece. */
const ESPACO_ESPERA = 120
/** Por quanto tempo depois de soltar o dedo o clique no produto ainda vale para o produto que estava sob ele. */
const VALE_TOQUE = 1000

type Origem = 'auto' | 'toque' | 'arrasto'
interface Posicao {
  i: number
  /** Quem trocou: a barra (auto) ou a pessoa (toque, seta, teclado, arrasto). Só a troca manual é anunciada. */
  origem: Origem
  dir: 1 | -1
}

/** Alguma camada por cima do hero (story, folhas, página do produto, troca, abertura, chat)? Lido na hora (teclado). */
function camadaPorCima(): boolean {
  const s = useUI.getState()
  if (s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.painelPrevia || s.pagina || s.trocaPendente || s.aberturaAtiva || s.interativo || s.contaAberta) return true
  if (useChat.getState().aberto) return true
  return !!document.querySelector('.folha, [aria-modal="true"]')
}

/** Cursor das bordas do story no mouse: o chevron em pixel, branco com contorno preto, 2 px por pixel da grade. */
function cursorChevron(nome: 'chevron-esq' | 'chevron-dir'): string {
  const g = iconesExtras[nome]
  const tem = (x: number, y: number) => g.linhas[y]?.[x] === 'x'
  const borda = (x: number, y: number) => !tem(x, y) && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => tem(x + dx, y + dy)))
  // corridas na linha viram um <rect> só
  const linhas = (de: (x: number, y: number) => boolean) => {
    let s = ''
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (!de(x, y)) continue
        let fim = x + 1
        while (fim < g.w && de(fim, y)) fim++
        s += `<rect x="${x * 2}" y="${y * 2}" width="${(fim - x) * 2}" height="2"/>`
        x = fim
      }
    }
    return s
  }
  const contorno = linhas(borda)
  const traco = linhas(tem)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" shape-rendering="crispEdges"><g fill="#000">${contorno}</g><g fill="#fff">${traco}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, pointer`
}
const CURSOR_ESQ = cursorChevron('chevron-esq')
const CURSOR_DIR = cursorChevron('chevron-dir')

/** Link da página do produto (abre em aba nova com Ctrl/⌘/botão do meio ou segurando o dedo). */
const linkProduto = (id: string) => `?produto=${encodeURIComponent(id)}`

/** Topo de um elemento dentro de outro pela cadeia de offsetParent (sem transform: o palco anima escala e x). */
function topoEm(el: HTMLElement, dentro: HTMLElement): number {
  let y = 0
  let e: HTMLElement | null = el
  while (e && e !== dentro) {
    y += e.offsetTop
    e = e.offsetParent as HTMLElement | null
  }
  return y
}

function consulta(q: string) {
  return {
    assinar: (aviso: () => void) => {
      try {
        const m = window.matchMedia(q)
        m.addEventListener('change', aviso)
        return () => m.removeEventListener('change', aviso)
      } catch {
        return () => {}
      }
    },
    ler: () => {
      try {
        return window.matchMedia(q).matches
      } catch {
        return false
      }
    },
  }
}
/**
 * Tela larga (>= 1200 px): perfil à esquerda do story (e, na Home 2, o card do mercador à esquerda do perfil).
 * Abaixo disso o story vem primeiro — no DOM também (ordem do Tab).
 */
const LARGO = consulta('(min-width: 1200px)')
/** Celular: o mercador da Home 2 entra como passo do story (no computador ele tem o card dele). */
const CELULAR = consulta('(max-width: 899px)')

/** Um passo do story do hero: um produto, ou (Home 2, celular) o convite do Teste minha sorte com o mercador. */
type Passo = { tipo: 'produto'; produto: Produto } | { tipo: 'mercador' }

/** Foco visível de teclado (o clique do mouse num botão foca sem :focus-visible). */
function focoDeTeclado(el: EventTarget | null): boolean {
  try {
    return el instanceof Element && el.matches(':focus-visible')
  } catch {
    return false
  }
}

/** Aviso quando o IP aponta um estado sem atendimento: não troca o site sozinho. */
function AvisoFora() {
  const palpiteFora = useLocal((s) => s.palpiteFora)
  const uf = useLocal((s) => s.uf)
  const setSeletor = useUI((s) => s.setSeletor)
  const abrir = useChat((s) => s.abrir)
  if (!palpiteFora || uf) return null
  return (
    <div className="enquete hero-enquete" role="group" aria-label="Seu estado">
      <p className="enquete-pergunta">Parece que é {deUf(palpiteFora)}. A Green Cheese ainda não chegou aí.</p>
      <div className="enquete-opcoes">
        <button type="button" className="enquete-opcao toque" onClick={() => setSeletor(true)}>
          Ver estados
        </button>
        <button type="button" className="enquete-opcao toque" onClick={() => abrir('encomenda')}>
          Encomendar
        </button>
      </div>
    </div>
  )
}

/**
 * O hero é um story rodando com os produtos disponíveis do estado — um por segmento de barra.
 * Passa e volta como o do Instagram: bordas do quadro, arrastar de lado, setas (fora do quadro no desktop) e ← →.
 * O produto (arte + nome/preço) é um link para a página dele.
 */
export function Hero() {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf)
  const todos = useCatalogo((s) => s.produtos)
  const disponiveis = useDisponiveis()
  // produto real com preço primeiro; exemplo por último
  const peso = (p: (typeof todos)[number]) => (p.demo ? 2 : 0) + (p.preco == null ? 1 : 0)
  const home = useUI((s) => s.home)
  const celular = useSyncExternalStore(CELULAR.assinar, CELULAR.ler)
  // Home 2 no celular: o mercador é o 2º passo (aparece aos 5 s), dentro do mesmo limite de barras
  const comMercador = home === 2 && celular
  const lista = [...(canal ? disponiveis : todos)].sort((a, b) => peso(a) - peso(b)).slice(0, comMercador ? MAX_BARRAS - 1 : MAX_BARRAS)
  const passos: Passo[] = lista.map((produto) => ({ tipo: 'produto', produto }))
  if (comMercador && passos.length) passos.splice(1, 0, { tipo: 'mercador' })
  const convite = useConviteSorte()
  // palpite de IP pendente (celular): o aviso ocupa o lugar da linha de resposta até a pessoa responder
  const avisoLocal = useAvisoLocal()
  const { texto: lugar } = useTextoLocal()
  const setHeroProduto = useUI((s) => s.setHeroProduto)
  const camadaAberta = useUI(
    (s) =>
      !!s.story ||
      s.sacolaAberta ||
      s.seletorAberto ||
      s.infoAberto ||
      s.painelPrevia ||
      !!s.pagina ||
      !!s.trocaPendente ||
      s.aberturaAtiva ||
      !!s.interativo ||
      s.contaAberta,
  )
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  const chatAberto = useChat((s) => s.aberto)
  const largo = useSyncExternalStore(LARGO.assinar, LARGO.ler)
  const [pos, setPos] = useState<Posicao>({ i: 0, origem: 'auto', dir: 1 })
  const [visivel, setVisivel] = useState(true)
  const [segurando, setSegurando] = useState(false)
  // dedo (ou botão do mouse) pressionado no story: a barra para já, para o story não trocar debaixo dele
  const [tocando, setTocando] = useState(false)
  const [pausaManual, setPausaManual] = useState(false)
  // foco de teclado dentro do story para a rotação (padrão de carrossel); "Continuar" libera até o foco sair
  const [foco, setFoco] = useState<'fora' | 'dentro' | 'liberado'>('fora')
  // dica de primeira vez (celular): some no primeiro gesto ou depois de duas trocas sozinhas; lembrada na sessão
  const [dica, setDica] = useState<'mostra' | 'saindo' | 'fora'>(() => (lerSessao(CHAVE_DICA) ? 'fora' : 'mostra'))
  // a dica só entra quando a arte tem altura para ela (com a enquete aberta num celular baixo, não tem)
  const [dicaCabe, setDicaCabe] = useState(false)
  const raiz = useRef<HTMLElement>(null)
  const historia = useRef<HTMLDivElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const espera = useRef<HTMLDivElement>(null)
  const barras = useRef<HTMLDivElement>(null)
  const quaseTodo = useRef(false)
  const reduz = movimentoReduzido()

  const n = passos.length
  const idx = n ? pos.i % n : 0
  const passo = passos[idx]
  /** Produto do passo atual (null no passo do mercador). */
  const atual = passo?.tipo === 'produto' ? passo.produto : null
  const noMercador = passo?.tipo === 'mercador'
  const chavePasso = atual ? atual.id : 'mercador'
  // o próximo, esmaecido atrás, é sempre um produto: no passo do mercador e antes dele não aparece nada
  const seguinte = n > 1 ? passos[(idx + 1) % n] : undefined
  const proximo = !noMercador && seguinte?.tipo === 'produto' ? seguinte.produto : undefined
  const pausado = pausaManual || foco === 'dentro'

  // aviso de local respondido pelo teclado (Enter no Sim, dentro do story): o botão some e o foco cairia no body sem
  // o story saber, que ficaria pausado de vez. O foco passa para a linha de resposta, que volta no mesmo lugar
  const focoRef = useRef(foco)
  focoRef.current = foco
  const avisoAntes = useRef(avisoLocal)
  useEffect(() => {
    const antes = avisoAntes.current
    avisoAntes.current = avisoLocal
    if (!antes || avisoLocal || focoRef.current !== 'dentro') return
    const ativo = document.activeElement
    if (ativo && ativo !== document.body) return
    const pilula = historia.current?.querySelector<HTMLElement>('.hero-resposta .barra-pilula')
    if (pilula) pilula.focus({ preventScroll: true })
    else setFoco('fora')
  }, [avisoLocal])

  const dicaViva = useRef(dica === 'mostra')
  const dicaNaTela = useRef(false)
  const trocasComDica = useRef(0)
  const timerDica = useRef(0)
  const dispensarDica = useCallback(() => {
    if (!dicaViva.current) return
    dicaViva.current = false
    gravarSessao(CHAVE_DICA, '1')
    setDica('saindo')
    timerDica.current = window.setTimeout(() => setDica('fora'), 400)
  }, [])

  /** Passa (1) ou volta (-1), em loop nos dois sentidos. */
  const irPara = useCallback(
    (dir: 1 | -1, origem: Origem) => {
      if (n < 2) return
      setPos((p) => ({ i: (((p.i + dir) % n) + n) % n, origem, dir }))
      // só contam as trocas sozinhas com a dica à vista (escondida esperando espaço, ela não foi vista)
      if (origem !== 'auto') dispensarDica()
      else if (dicaNaTela.current && ++trocasComDica.current >= 2) dispensarDica()
    },
    [n, dispensarDica],
  )

  const alternarPausa = useCallback(() => {
    if (pausado) {
      setPausaManual(false)
      setFoco((f) => (f === 'dentro' ? 'liberado' : f))
    } else setPausaManual(true)
    dispensarDica()
  }, [pausado, dispensarDica])

  // trocar de estado recomeça o story e gira o "cubo" do Instagram (passar de um perfil para outro)
  const ufAnterior = useRef(uf)
  const quadroRef = useRef<HTMLDivElement>(null)
  useEffect(() => setPos({ i: 0, origem: 'auto', dir: 1 }), [uf])
  useLayoutEffect(() => {
    const antes = ufAnterior.current
    ufAnterior.current = uf
    const q = quadroRef.current
    if (!q || !antes || !uf || antes === uf || reduz) return
    gsap.fromTo(
      q,
      { rotateY: 75, transformPerspective: 1100, transformOrigin: '0% 50%', opacity: 0.4 },
      { rotateY: 0, opacity: 1, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity' },
    )
  }, [uf, reduz])

  useEffect(() => {
    setHeroProduto(visivel && atual ? atual.id : null)
  }, [visivel, atual, setHeroProduto])

  // pausa fora da tela; "quase todo na tela" libera as setas do teclado sem foco no hero
  useEffect(() => {
    const el = raiz.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        setVisivel(e.isIntersecting && e.intersectionRatio > 0.35)
        quaseTodo.current = e.isIntersecting && e.intersectionRatio > 0.5
      },
      { threshold: [0, 0.35, 0.5, 0.6] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // geometria do produto atual: as bordas que passam vão só até o topo do nome (nome e preço abrem o produto na
  // largura toda), as setas do celular ficam no meio da arte e a dica só entra se a arte tiver altura para ela
  useLayoutEffect(() => {
    const q = quadroRef.current
    const h = historia.current
    const meio = q?.querySelector<HTMLElement>('.hero-meio')
    // passo do mercador: as bordas passam na altura toda (o meio abre o jogo) e as setas ficam na altura dele
    const figura = q?.querySelector<HTMLElement>('.hero-palco .sm-palco')
    if (q && h && meio && figura) {
      const medirMercador = () => {
        q.style.setProperty('--hero-texto', `${q.clientHeight}px`)
        h.style.setProperty('--hero-arte-meio', `${Math.round(topoEm(figura, q) + figura.offsetHeight / 2)}px`)
        h.style.setProperty('--hero-espera-vis', 'hidden')
        setDicaCabe(false)
      }
      medirMercador()
      const ro = new ResizeObserver(medirMercador)
      ro.observe(figura)
      return () => ro.disconnect()
    }
    const t = q?.querySelector<HTMLElement>('.hero-palco .sq-texto')
    const a = q?.querySelector<HTMLElement>('.hero-palco .sq-arte')
    if (!q || !h || !t || !a || !meio) return
    const medir = () => {
      const arteH = a.offsetHeight
      const meioArte = topoEm(a, q) + arteH / 2
      q.style.setProperty('--hero-texto', `${topoEm(t, q)}px`)
      h.style.setProperty('--hero-arte-meio', `${Math.round(meioArte)}px`)
      // o próximo, esmaecido atrás, acompanha a arte: no máximo 60% da altura dela (nunca maior que o produto atual,
      // nunca por cima do nome) e some quando a arte fica pequena (enquete aberta num celular baixo)
      const esperaH = Math.min(arteH * 0.6, (q.clientWidth * 0.22 * 16) / 9)
      h.style.setProperty('--hero-espera-w', `${Math.round((esperaH * 9) / 16)}px`)
      h.style.setProperty('--hero-espera-y', `${Math.round(meioArte - esperaH * 0.35)}px`)
      h.style.setProperty('--hero-espera-vis', arteH < ESPACO_ESPERA ? 'hidden' : 'visible')
      setDicaCabe(arteH >= ESPACO_DICA)
    }
    medir()
    // a enquete some, o nome quebra em duas linhas, a fonte em pixel chega: tudo muda a altura de um dos dois
    const ro = new ResizeObserver(medir)
    ro.observe(meio)
    ro.observe(t)
    return () => ro.disconnect()
  }, [chavePasso, uf])

  const barra = useProgresso({
    ativo: !reduz && visivel && !segurando && !tocando && !pausado && !camadaAberta && !chatAberto && n > 1,
    // o passo do mercador dura a apresentação dele (do tique 18 até fechar o casaco)
    duracaoMs: noMercador ? PASSO_MS : 5000,
    chave: `${uf}-${idx}`,
    aoTerminar: () => irPara(1, 'auto'),
  })

  // barras: as de trás cheias, a atual do zero (cheia sem movimento), as da frente vazias — também ao voltar e no loop
  // (depois do useProgresso: roda por último e vale)
  const ids = passos.map((p) => (p.tipo === 'produto' ? p.produto.id : 'mercador')).join()
  useLayoutEffect(() => {
    barras.current?.querySelectorAll<HTMLElement>('.story-barra > i').forEach((el, k) => {
      el.style.transform = `scaleX(${k < idx || (reduz && k === idx) ? 1 : 0})`
    })
  }, [idx, ids, uf, reduz])

  // troca de produto (voz app): sozinha, o que esperava atrás vem pro centro; na mão, desliza do lado de onde veio
  useLayoutEffect(() => {
    const p = palco.current
    if (!p || reduz) return
    if (pos.origem === 'auto') {
      gsap.fromTo(p, { scale: 0.42, opacity: 0.3, x: 40, y: -30 }, { scale: 1, opacity: 1, x: 0, y: 0, duration: 0.55, ease: 'power3.out' })
    } else {
      gsap.fromTo(p, { x: pos.dir * (pos.origem === 'arrasto' ? 72 : 48), opacity: 0.2, scale: 1, y: 0 }, { x: 0, opacity: 1, duration: 0.32, ease: 'power3.out' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, uf, reduz])

  // paralaxe: só o próximo produto, atrás, acompanha a rolagem (posição presa em 2 px)
  useLayoutEffect(() => {
    const e = espera.current
    const r = raiz.current
    if (!e || !r || reduz) return
    const ctx = gsap.context(() => {
      gsap.to(e, {
        y: -90,
        ease: 'none',
        modifiers: { y: (y: string) => `${Math.round(parseFloat(y) / 2) * 2}px` },
        scrollTrigger: { trigger: r, start: 'top top', end: 'bottom top', scrub: true },
      })
    })
    return () => ctx.revert()
  }, [reduz])

  // teclado: ← → com o foco no hero, ou com ele quase todo na tela e o foco fora de campo de texto; K pausa.
  // Nunca com camada aberta (o story aberto e as folhas têm as setas deles).
  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      const pausa = e.key === 'k' || e.key === 'K'
      if (!dir && !pausa) return
      if (camadaPorCima()) return
      const alvo = e.target instanceof Element ? e.target : null
      if (alvo?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      if (!(alvo && raiz.current?.contains(alvo))) {
        if (!quaseTodo.current) return
        // widget que usa as setas (rádio, abas, lista) fica com elas
        if (alvo?.closest('[role="radiogroup"], [role="radio"], [role="tablist"], [role="listbox"], [role="slider"], [role="menu"], [role="grid"]')) return
      }
      e.preventDefault()
      if (pausa) alternarPausa()
      else if (dir) irPara(dir, 'toque')
    }
    window.addEventListener('keydown', t)
    return () => window.removeEventListener('keydown', t)
  }, [irPara, alternarPausa])

  // gestos: toque na borda esquerda volta, no resto (fora do produto) avança; arrastar de lado passa; segurar pausa.
  // O produto é link: tocar nele abre a página (o clique do <a>), segurar nele abre o menu do link do navegador.
  const g = useRef<{ x: number; y: number; id: number; produto: boolean; arrastando: boolean; segurou: boolean; timer: number } | null>(null)
  /** Até quando ignorar o clique no produto (o clique que vem depois de arrastar ou segurar). */
  const semClique = useRef(0)
  /** Produto que estava sob o dedo quando ele pousou: é ele que abre, mesmo que a barra vire entre soltar e o clique. */
  const alvoDoToque = useRef<{ id: string; ate: number } | null>(null)
  const voltarPalco = useCallback(() => {
    if (palco.current && !movimentoReduzido()) gsap.to(palco.current, { x: 0, duration: 0.25, ease: 'power3.out' })
  }, [])
  /** Fim de gesto sem navegar (soltou fora do quadro, rolou a página, janela perdeu o foco): destrava tudo. */
  const encerrarGesto = useCallback(() => {
    const s = g.current
    g.current = null
    if (alvoDoToque.current) alvoDoToque.current.ate = Math.min(alvoDoToque.current.ate, performance.now() + VALE_TOQUE)
    setTocando(false)
    if (!s) return
    clearTimeout(s.timer)
    if (s.segurou) setSegurando(false)
    if (s.arrastando) voltarPalco()
  }, [voltarPalco])

  // o quadro só ouve o que acontece em cima dele: soltar o botão do mouse fora (depois de segurar e sair na vertical)
  // chega pela window. Os timers do gesto e da dica morrem junto com o hero.
  useEffect(() => {
    const solto = (e: PointerEvent) => {
      if (g.current && e.pointerId === g.current.id) encerrarGesto()
    }
    const semFoco = () => {
      if (g.current) encerrarGesto()
    }
    window.addEventListener('pointerup', solto)
    window.addEventListener('pointercancel', solto)
    window.addEventListener('blur', semFoco)
    return () => {
      window.removeEventListener('pointerup', solto)
      window.removeEventListener('pointercancel', solto)
      window.removeEventListener('blur', semFoco)
      if (g.current) clearTimeout(g.current.timer)
      clearTimeout(timerDica.current)
    }
  }, [encerrarGesto])

  const aoDescer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const alvo = e.target as HTMLElement
    // a linha de resposta (Enviar mensagem…, compartilhar) não passa nem pausa o story
    if (alvo.closest('.hero-resposta')) return
    // o produto e o VER PRODUTO são links do produto: tocar abre, arrastar passa, nunca contam como toque de borda
    const produto = !!alvo.closest('.hero-produto, .hero-ver')
    // outros botões e links e a enquete não navegam
    if (!produto && alvo.closest('button, a, input, .enquete')) return
    // gesto anterior que ficou sem fim: destrava antes de começar outro
    if (g.current) encerrarGesto()
    alvoDoToque.current = produto && atual ? { id: atual.id, ate: Infinity } : null
    const timer = produto
      ? 0
      : window.setTimeout(() => {
          const s = g.current
          if (!s || s.arrastando) return
          s.segurou = true
          setSegurando(true)
          dispensarDica()
        }, 220)
    g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, produto, arrastando: false, segurou: false, timer }
    setTocando(true)
  }
  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (!s || e.pointerId !== s.id) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.arrastando) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        // na vertical o navegador rola (pan-y) e cancela o gesto; com mouse, só deixa de ser toque
        if (Math.abs(dy) > 10) clearTimeout(s.timer)
        return
      }
      s.arrastando = true
      clearTimeout(s.timer)
      if (s.segurou) {
        s.segurou = false
        setSegurando(false)
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* sem captura: segue sem */
      }
      if (palco.current) gsap.killTweensOf(palco.current)
    }
    // o produto acompanha o dedo com resistência (metade do arrasto)
    if (palco.current && !reduz) gsap.set(palco.current, { x: dx * 0.5 })
  }
  const aoSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (!s || e.pointerId !== s.id) return
    g.current = null
    clearTimeout(s.timer)
    setTocando(false)
    if (alvoDoToque.current) alvoDoToque.current.ate = performance.now() + VALE_TOQUE
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (s.arrastando) {
      semClique.current = performance.now() + 400
      if (Math.abs(dx) >= ARRASTO && Math.abs(dx) > Math.abs(dy) * 1.5) irPara(dx < 0 ? 1 : -1, 'arrasto')
      else voltarPalco()
      return
    }
    if (s.segurou) {
      semClique.current = performance.now() + 400
      setSegurando(false)
      return
    }
    if (s.produto || Math.hypot(dx, dy) > 12) return
    const r = e.currentTarget.getBoundingClientRect()
    irPara(e.clientX - r.left < r.width * BORDA ? -1 : 1, 'toque')
  }

  /** Passo do mercador: o meio do story e o adesivo-link abrem o convite (jogo, cadastro, cupom, conta ou a loja). */
  const abrirConvite = () => {
    if (performance.now() < semClique.current) return
    dispensarDica()
    convite.acao()
  }

  const abrirProduto = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/⌘/Shift/Alt + clique: aba ou janela nova, do jeito do navegador
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    const t = alvoDoToque.current
    alvoDoToque.current = null
    if (performance.now() < semClique.current) return
    const id = t && performance.now() < t.ate ? t.id : atual?.id
    if (!id) return
    dispensarDica()
    useUI.getState().abrirPagina(id, 'hero')
  }

  // foco: entrar com o teclado para a rotação; o clique do mouse nas setas (sem :focus-visible) não
  const aoFocar = (e: React.FocusEvent<HTMLDivElement>) => {
    const teclado = focoDeTeclado(e.target)
    setFoco((f) => (f === 'liberado' ? f : teclado ? 'dentro' : 'fora'))
  }
  const aoDesfocar = (e: React.FocusEvent<HTMLDivElement>) => {
    const vai = e.relatedTarget as Node | null
    if (vai && e.currentTarget.contains(vai)) return
    setFoco('fora')
  }

  const sextou = canal && ehDiaDeEntregaGratis(canal) ? canal.entregaGratis?.texto : null

  const navega = n > 1
  const comDica = navega && dica !== 'fora' && !aberturaAtiva && dicaCabe && !noMercador
  useEffect(() => {
    dicaNaTela.current = comDica && dica === 'mostra'
  }, [comDica, dica])

  if (!passo) return null

  const quadro = (
    <div
      ref={quadroRef}
      className={`hero-quadro${config.modoPrevia ? ' com-selo' : ''}`}
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={(e) => {
        if (g.current && e.pointerId === g.current.id) encerrarGesto()
      }}
      onContextMenu={(e) => {
        // segurar o produto (link) mostra o menu do navegador (abrir em aba nova) e o story volta a correr atrás dele;
        // no resto, segurar é pausar
        if ((e.target as HTMLElement).closest('a')) encerrarGesto()
        else e.preventDefault()
      }}
    >
      {/* uma barra por passo (com o mercador, ele tem a dele): toda posição do story tem a barra que conta o tempo */}
      <div ref={barras} className="story-barras hero-barras" aria-hidden="true">
        {passos.map((p, k) => (
          <span key={p.tipo === 'produto' ? p.produto.id : 'mercador'} className="story-barra">
            <i ref={k === idx ? (el) => { barra.current = el } : undefined} />
          </span>
        ))}
      </div>
      <div className="hero-cab">
        <Avatar tamanho={32} />
        {/* @ e tempo em cima; no celular, o local embaixo (como num post do Instagram) — sem adesivo por cima do produto */}
        <div className="hero-cab-texto">
          <div className="hero-cab-linha">
            <span className="story-cab-nome">{canal?.instagram ?? 'Green Cheese Imports'}</span>
            {noMercador ? (
              <span className="story-cab-tempo">interativo</span>
            ) : (
              tempoDoCatalogo() && <span className="story-cab-tempo">{tempoDoCatalogo()}</span>
            )}
          </div>
          <LinhaLocal className="hero-cab-local" />
        </div>
        {navega && !reduz && (
          <button
            type="button"
            className="icone-botao toque hero-pausa"
            onClick={alternarPausa}
            aria-label={pausado ? 'Continuar stories' : 'Pausar stories'}
            aria-keyshortcuts="K"
          >
            <Icone nome={pausado ? 'play' : 'pausa'} tamanho={16} />
          </button>
        )}
      </div>

      {/* bordas que passam: só ponteiro (teclado e leitor de tela usam as setas) */}
      {navega && (
        <>
          <div className="hero-zona hero-zona-esq" style={{ cursor: CURSOR_ESQ }} aria-hidden="true" />
          <div className="hero-zona hero-zona-dir" style={{ cursor: CURSOR_DIR }} aria-hidden="true" />
        </>
      )}

      {/* a confirmação do palpite de IP não entra no story: no celular ela vai para a abertura (ou para o aviso de uma
          linha embaixo); no desktop, para a barra lateral. Aqui só o aviso de estado sem atendimento, no desktop. */}
      <div className="hero-enquetes">
        <AvisoFora />
      </div>

      {proximo && (
        <div className="hero-espera" ref={espera} aria-hidden="true">
          <ProdutoVisual produto={proximo} largura={54} revelar={false} />
        </div>
      )}

      <div className="hero-meio">
        <div className="hero-palco" ref={palco} key={`${uf}-${chavePasso}`}>
          {atual ? (
            <StoryQuadro
              produto={atual}
              escala="hero"
              disponivel={uf ? (canal ? disponivelEm(atual, uf) : false) : null}
              lugar={lugar}
              prioridade
              artePropsExtra={{ flutuar: true }}
              legenda={
                !uf ? (
                  <p className="hero-sem-uf legenda">RJ · MG · SP · ES · SC</p>
                ) : undefined
              }
            />
          ) : (
            <StoryMercador variante="passo" parado={segurando || pausado} />
          )}
        </div>
        {/* fora do palco (que remonta a cada produto): o foco do teclado não se perde ao passar */}
        {atual ? (
          <a className="hero-produto" href={linkProduto(atual.id)} onClick={abrirProduto} draggable={false} aria-label={`Ver ${atual.nome}`} />
        ) : (
          <button type="button" className="hero-produto" onClick={abrirConvite} aria-label={convite.ativo ? `Teste minha sorte: ${convite.cta}` : 'Ver loja'} />
        )}
        {comDica && (
          <div className={`hero-dica degrau${dica === 'saindo' ? ' saindo' : ''}`} aria-hidden="true">
            <p className="hero-dica-linha px px-16">
              <Icone nome="chevron-esq" tamanho={16} />
              toca nos lados pra passar
              <Icone nome="chevron-dir" tamanho={16} />
            </p>
            <p className="hero-dica-linha px px-16">toca no produto pra ver</p>
          </div>
        )}
      </div>

      {atual ? (
        <div className="hero-adesivos">
          <p className="adesivo-texto-bloco hero-frase">
            <span className="adesivo-texto">{sextou ?? 'Vem no certo!'}</span>
          </p>
          <a className="adesivo-link toque hero-ver" href={linkProduto(atual.id)} onClick={abrirProduto} draggable={false}>
            <Icone nome="link" tamanho={16} />
            VER PRODUTO
          </a>
        </div>
      ) : (
        <div className="hero-adesivos">
          {convite.legenda && (
            <p className="adesivo-texto-bloco hero-frase hero-frase-mercador">
              <span className="adesivo-texto">{convite.legenda}</span>
            </p>
          )}
          {/* no lugar do VER PRODUTO: o CTA do convite (muda com o estado do jogo) */}
          <button type="button" className="adesivo-link toque hero-ver hero-ver-mercador" onClick={abrirConvite}>
            <Icone nome={convite.ativo ? 'dichavador' : 'link'} tamanho={16} />
            {convite.cta.toUpperCase()}
          </button>
        </div>
      )}
      {atual?.demo && config.modoPrevia && <span className="hero-demo carimbo">exemplo</span>}
      {/* a linha de resposta do story (celular): "Enviar mensagem…" responde ao produto que está passando. Com o
          palpite de IP pendente, o aviso de local fica no lugar dela (por cima, cobria a pílula no celular baixo) */}
      {avisoLocal && !ehDesktop() ? (
        <div className="hero-resposta hero-aviso-local">
          <AvisoLocal variante="story" />
        </div>
      ) : (
        <RespostaStory produtoId={atual?.id ?? null} mercador={noMercador} />
      )}
      {/* só a troca feita pela pessoa é anunciada; a automática fica muda (sem falatório a cada 5 s) */}
      <span className="sr-only" aria-live="polite">
        {pos.origem !== 'auto' ? `${atual ? atual.nome : 'Teste minha sorte'}, story ${idx + 1} de ${n}` : ''}
      </span>
    </div>
  )

  const perfil = (
    <div key="perfil" className="hero-desktop-perfil">
      <Perfil variante="desktop" />
    </div>
  )
  const story = (
    <div
      key="story"
      ref={historia}
      className={`hero-story${segurando ? ' segurando' : ''}${comDica && dica === 'mostra' ? ' com-dica' : ''}${visivel ? '' : ' fora'}`}
      onFocus={aoFocar}
      onBlur={aoDesfocar}
    >
      {navega && (
        <button type="button" className="hero-seta hero-seta-esq" onClick={() => irPara(-1, 'toque')} aria-label="Story anterior" aria-keyshortcuts="ArrowLeft">
          <span className="hero-seta-disco">
            <Icone nome="chevron-esq" tamanho={16} />
          </span>
        </button>
      )}
      {quadro}
      {navega && (
        <button type="button" className="hero-seta hero-seta-dir" onClick={() => irPara(1, 'toque')} aria-label="Próximo story" aria-keyshortcuts="ArrowRight">
          <span className="hero-seta-disco">
            <Icone nome="chevron-dir" tamanho={16} />
          </span>
        </button>
      )}
    </div>
  )

  // Home 2 no computador: o card do mercador ("story" menor ao lado do perfil, como os vizinhos do visualizador do
  // instagram.com). A ordem no DOM segue o que se vê (o Tab vai na mesma ordem): >= 1200 card | perfil | story;
  // abaixo, story, perfil e o card deitado.
  const h2 = home === 2 && !celular
  const vitrine = h2 ? (
    <div key="vitrine" className="hero-vitrine">
      <StoryMercador variante={largo ? 'coluna' : 'deitada'} />
    </div>
  ) : null
  const ordem = !h2 ? (largo ? [perfil, story] : [story, perfil]) : largo ? [vitrine, perfil, story] : [story, perfil, vitrine]

  return (
    <section ref={raiz} className={`hero${h2 ? ' hero-h2' : ''}`} aria-label="Stories da Green Cheese">
      {ordem}
    </section>
  )
}
