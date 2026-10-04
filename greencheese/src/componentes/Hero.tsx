import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { deUf } from '../dados/ufs'
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
import { ArteProduto } from '../arte/ArteProduto'
import './Hero.css'

gsap.registerPlugin(ScrollTrigger)

const MAX_BARRAS = 8

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

/** O hero é um story rodando com os produtos disponíveis do estado — um por segmento de barra. */
export function Hero() {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf)
  const todos = useCatalogo((s) => s.produtos)
  const disponiveis = useDisponiveis()
  // produto real com preço primeiro; exemplo por último
  const peso = (p: (typeof todos)[number]) => (p.demo ? 2 : 0) + (p.preco == null ? 1 : 0)
  const lista = [...(canal ? disponiveis : todos)].sort((a, b) => peso(a) - peso(b)).slice(0, MAX_BARRAS)
  const { texto: lugar } = useTextoLocal()
  const abrirStory = useUI((s) => s.abrirStory)
  const setHeroProduto = useUI((s) => s.setHeroProduto)
  const camadaAberta = useUI((s) => !!s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.aberturaAtiva)
  const chatAberto = useChat((s) => s.aberto)
  const [i, setI] = useState(0)
  const [visivel, setVisivel] = useState(true)
  const [segurando, setSegurando] = useState(false)
  const raiz = useRef<HTMLElement>(null)
  const palco = useRef<HTMLDivElement>(null)
  const espera = useRef<HTMLDivElement>(null)
  const reduz = movimentoReduzido()

  const n = lista.length
  const idx = n ? i % n : 0
  const atual = lista[idx]
  const proximo = n > 1 ? lista[(idx + 1) % n] : undefined

  // trocar de estado recomeça o story e gira o "cubo" do Instagram (passar de um perfil para outro)
  const ufAnterior = useRef(uf)
  const quadroRef = useRef<HTMLDivElement>(null)
  useEffect(() => setI(0), [uf])
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

  // pausa fora da tela
  useEffect(() => {
    const el = raiz.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting && e.intersectionRatio > 0.35), { threshold: [0, 0.35, 0.6] })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const barra = useProgresso({
    ativo: !reduz && visivel && !segurando && !camadaAberta && !chatAberto && n > 1,
    duracaoMs: 5000,
    chave: `${uf}-${idx}`,
    aoTerminar: () => setI((v) => v + 1),
  })

  // troca de produto: o que esperava atrás vem pro centro (voz app)
  useLayoutEffect(() => {
    const p = palco.current
    if (!p || reduz) return
    gsap.fromTo(p, { scale: 0.42, opacity: 0.3, x: 40, y: -30 }, { scale: 1, opacity: 1, x: 0, y: 0, duration: 0.55, ease: 'power3.out' })
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

  // gestos: 1/3 esquerdo volta, o resto avança; segurar pausa
  const g = useRef<{ t: number; timer: number; segurou: boolean } | null>(null)
  const aoDescer = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, .enquete')) return
    const timer = window.setTimeout(() => {
      if (g.current) {
        g.current.segurou = true
        setSegurando(true)
      }
    }, 220)
    g.current = { t: performance.now(), timer, segurou: false }
  }
  const aoSoltar = (e: React.PointerEvent) => {
    const s = g.current
    g.current = null
    if (!s) return
    clearTimeout(s.timer)
    if (s.segurou) {
      setSegurando(false)
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX - r.left < r.width / 3) setI((v) => (v - 1 + n) % Math.max(1, n))
    else setI((v) => v + 1)
  }

  const verProduto = () => {
    if (!atual) return
    abrirStory(
      lista.map((p) => p.id),
      idx,
    )
  }

  const sextou = canal && ehDiaDeEntregaGratis(canal) ? canal.entregaGratis?.texto : null

  if (!atual) return null

  const quadro = (
    <div ref={quadroRef} className={`hero-quadro ${segurando ? 'segurando' : ''}`} onPointerDown={aoDescer} onPointerUp={aoSoltar} onPointerCancel={() => (g.current = null)} onContextMenu={(e) => e.preventDefault()}>
      <div className="story-barras hero-barras" aria-hidden="true">
        {lista.map((p, k) => (
          <span key={p.id} className="story-barra">
            <i ref={k === idx ? (el) => { barra.current = el } : undefined} style={{ transform: k < idx || (reduz && k === idx) ? 'scaleX(1)' : 'scaleX(0)' }} />
          </span>
        ))}
      </div>
      <div className="hero-cab">
        <Avatar tamanho={32} />
        <span className="story-cab-nome">{canal?.instagram ?? 'Green Cheese Imports'}</span>
        {tempoDoCatalogo() && <span className="story-cab-tempo">{tempoDoCatalogo()}</span>}
      </div>

      <div className="hero-enquetes">
        <EnqueteLocal className="hero-enquete" />
        <AvisoFora />
      </div>

      {proximo && (
        <div className="hero-espera" ref={espera} aria-hidden="true">
          <ArteProduto produto={proximo} largura={54} revelar={false} />
        </div>
      )}

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

      <div className="hero-adesivos">
        <p className="adesivo-texto-bloco hero-frase">
          <span className="adesivo-texto">{sextou ?? 'Vem no certo!'}</span>
        </p>
        <button type="button" className="adesivo-link toque" onClick={verProduto}>
          <Icone nome="link" tamanho={16} />
          VER PRODUTO
        </button>
      </div>
      {atual.demo && config.modoPrevia && <span className="hero-demo carimbo">exemplo</span>}
    </div>
  )

  return (
    <section ref={raiz} className="hero" aria-label="Stories da Green Cheese">
      <div className="hero-desktop-perfil">
        <Perfil variante="desktop" />
      </div>
      <div className="hero-story">{quadro}</div>
    </section>
  )
}
