import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { iconesExtras } from '../arte/pixel/extras'
import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { deUf } from '../dados/ufs'
import { gravarSessao, lerSessao } from '../lib/armazenamento'
import { ehDiaDeEntregaGratis } from '../lib/horario'
import { movimentoReduzido } from '../lib/movimento'
import { useProgresso } from '../lib/progresso'
import { disponivelEm, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useDisponiveis } from '../store/derivados'
import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Avatar, Icone, tempoDoCatalogo } from './comum'
import { EnqueteLocal, useTextoLocal } from './Local'
import { Perfil } from './Perfil'
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
  if (s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.painelPrevia || s.pagina || s.trocaPendente || s.aberturaAtiva) return true
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
  const lista = [...(canal ? disponiveis : todos)].sort((a, b) => peso(a) - peso(b)).slice(0, MAX_BARRAS)
  const { texto: lugar } = useTextoLocal()
  const setHeroProduto = useUI((s) => s.setHeroProduto)
  const camadaAberta = useUI(
    (s) => !!s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.painelPrevia || !!s.pagina || !!s.trocaPendente || s.aberturaAtiva,
  )
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  const chatAberto = useChat((s) => s.aberto)
  const [pos, setPos] = useState<Posicao>({ i: 0, origem: 'auto', dir: 1 })
  const [visivel, setVisivel] = useState(true)
  const [segurando, setSegurando] = useState(false)
  const [pausaManual, setPausaManual] = useState(false)
  // dica de primeira vez (celular): some no primeiro gesto ou depois de duas trocas sozinhas; lembrada na sessão
  const [dica, setDica] = useState<'mostra' | 'saindo' | 'fora'>(() => (lerSessao(CHAVE_DICA) ? 'fora' : 'mostra'))
  const raiz = useRef<HTMLElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const espera = useRef<HTMLDivElement>(null)
  const barras = useRef<HTMLDivElement>(null)
  const quaseTodo = useRef(false)
  const reduz = movimentoReduzido()

  const n = lista.length
  const idx = n ? pos.i % n : 0
  const atual = lista[idx]
  const proximo = n > 1 ? lista[(idx + 1) % n] : undefined

  const dicaViva = useRef(dica === 'mostra')
  const trocasComDica = useRef(0)
  const dispensarDica = useCallback(() => {
    if (!dicaViva.current) return
    dicaViva.current = false
    gravarSessao(CHAVE_DICA, '1')
    setDica('saindo')
    window.setTimeout(() => setDica('fora'), 400)
  }, [])

  /** Passa (1) ou volta (-1), em loop nos dois sentidos. */
  const irPara = useCallback(
    (dir: 1 | -1, origem: Origem) => {
      if (n < 2) return
      setPos((p) => ({ i: (((p.i + dir) % n) + n) % n, origem, dir }))
      if (origem === 'auto') {
        trocasComDica.current++
        if (trocasComDica.current >= 2) dispensarDica()
      } else dispensarDica()
    },
    [n, dispensarDica],
  )

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

  const barra = useProgresso({
    ativo: !reduz && visivel && !segurando && !pausaManual && !camadaAberta && !chatAberto && n > 1,
    duracaoMs: 5000,
    chave: `${uf}-${idx}`,
    aoTerminar: () => irPara(1, 'auto'),
  })

  // barras: as de trás cheias, a atual do zero (cheia sem movimento), as da frente vazias — também ao voltar e no loop
  // (depois do useProgresso: roda por último e vale)
  const ids = lista.map((p) => p.id).join()
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
      if (pausa) {
        setPausaManual((v) => !v)
        dispensarDica()
      } else if (dir) irPara(dir, 'toque')
    }
    window.addEventListener('keydown', t)
    return () => window.removeEventListener('keydown', t)
  }, [irPara, dispensarDica])

  // gestos: toque na borda esquerda volta, no resto (fora do produto) avança; arrastar de lado passa; segurar pausa.
  // O produto é link: tocar nele abre a página (o clique do <a>), segurar nele abre o menu do link do navegador.
  const g = useRef<{ x: number; y: number; id: number; produto: boolean; arrastando: boolean; segurou: boolean; timer: number } | null>(null)
  /** Até quando ignorar o clique no produto (o clique que vem depois de arrastar ou segurar). */
  const semClique = useRef(0)
  const voltarPalco = () => {
    if (palco.current && !reduz) gsap.to(palco.current, { x: 0, duration: 0.25, ease: 'power3.out' })
  }
  const aoDescer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const alvo = e.target as HTMLElement
    const produto = !!alvo.closest('.hero-produto')
    // botões, links, enquete e o adesivo VER PRODUTO não navegam
    if (!produto && alvo.closest('button, a, input, .enquete')) return
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
  const aoCancelar = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current
    if (!s || e.pointerId !== s.id) return
    g.current = null
    clearTimeout(s.timer)
    if (s.segurou) setSegurando(false)
    if (s.arrastando) voltarPalco()
  }

  const abrirProduto = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/⌘/Shift/Alt + clique: aba ou janela nova, do jeito do navegador
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (!atual || performance.now() < semClique.current) return
    dispensarDica()
    useUI.getState().abrirPagina(atual.id, 'hero')
  }

  const sextou = canal && ehDiaDeEntregaGratis(canal) ? canal.entregaGratis?.texto : null

  if (!atual) return null

  const navega = n > 1
  const comDica = navega && dica !== 'fora' && !aberturaAtiva

  const quadro = (
    <div
      ref={quadroRef}
      className={`hero-quadro${config.modoPrevia ? ' com-selo' : ''}`}
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoCancelar}
      onContextMenu={(e) => {
        // segurar o produto (link) mostra o menu do navegador (abrir em aba nova); no resto, segurar é pausar
        if (!(e.target as HTMLElement).closest('a')) e.preventDefault()
      }}
    >
      <div ref={barras} className="story-barras hero-barras" aria-hidden="true">
        {lista.map((p, k) => (
          <span key={p.id} className="story-barra">
            <i ref={k === idx ? (el) => { barra.current = el } : undefined} />
          </span>
        ))}
      </div>
      <div className="hero-cab">
        <Avatar tamanho={32} />
        <span className="story-cab-nome">{canal?.instagram ?? 'Green Cheese Imports'}</span>
        {tempoDoCatalogo() && <span className="story-cab-tempo">{tempoDoCatalogo()}</span>}
        {navega && !reduz && (
          <button
            type="button"
            className="icone-botao toque hero-pausa"
            onClick={() => {
              setPausaManual((v) => !v)
              dispensarDica()
            }}
            aria-label={pausaManual ? 'Continuar stories' : 'Pausar stories'}
            aria-keyshortcuts="K"
          >
            <Icone nome={pausaManual ? 'play' : 'pausa'} tamanho={16} />
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

      <div className="hero-enquetes">
        <EnqueteLocal className="hero-enquete" />
        <AvisoFora />
      </div>

      {proximo && (
        <div className="hero-espera" ref={espera} aria-hidden="true">
          <ProdutoVisual produto={proximo} largura={54} revelar={false} />
        </div>
      )}

      <div className="hero-meio">
        <div className="hero-palco" ref={palco} key={`${uf}-${atual.id}`}>
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
        </div>
        {/* fora do palco (que remonta a cada produto): o foco do teclado não se perde ao passar */}
        <a className="hero-produto" href={linkProduto(atual.id)} onClick={abrirProduto} draggable={false} aria-label={`Ver ${atual.nome}`} />
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

      <div className="hero-adesivos">
        <p className="adesivo-texto-bloco hero-frase">
          <span className="adesivo-texto">{sextou ?? 'Vem no certo!'}</span>
        </p>
        <a className="adesivo-link toque" href={linkProduto(atual.id)} onClick={abrirProduto} draggable={false}>
          <Icone nome="link" tamanho={16} />
          VER PRODUTO
        </a>
      </div>
      {atual.demo && config.modoPrevia && <span className="hero-demo carimbo">exemplo</span>}
      {/* só a troca feita pela pessoa é anunciada; a automática fica muda (sem falatório a cada 5 s) */}
      <span className="sr-only" aria-live="polite">
        {pos.origem !== 'auto' ? `${atual.nome}, story ${idx + 1} de ${n}` : ''}
      </span>
    </div>
  )

  return (
    <section ref={raiz} className="hero" aria-label="Stories da Green Cheese">
      <div className="hero-desktop-perfil">
        <Perfil variante="desktop" />
      </div>
      <div className={`hero-story${segurando ? ' segurando' : ''}${comDica && dica === 'mostra' ? ' com-dica' : ''}`}>
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
    </section>
  )
}
