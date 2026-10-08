import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cliqueDeAba, hrefAba, irParaAba } from '../../lib/abas'
import { Icone } from '../comum'
import { useCamadaAberta } from '../Mercador'
import { Motor, type Balao } from './motor'
import { carregarPacote, type Pacote } from './pacote'
import { ALTURA, ALTURA_LUZ, ALTURA_POSTE, LARGURA_MAX, escalaDoAparelho } from './palco'
import { montarCena, montarRetrato, type Cena } from './roteiro'
import './Rua.css'

// A rua viva do Início: o mercador anda, bebe a Fanta e vende para o skatista, o motoboy, o MC e o turista. Um canvas
// na resolução da arte (o CSS amplia em px inteiros do aparelho), os balões de fala por cima no DOM (texto nítido em
// Pixelify) e três coisas que dá para tocar: o mercador (abre o casaco e oferece o Mercado), os clientes (reagem) e
// o botão de pausar. Para fora da tela, com a aba escondida, com camada por cima, pausada ou com movimento reduzido
// (aí vira uma foto: o mercador de casaco aberto atendendo). Para o leitor de tela é decorativa: só o rótulo do
// grupo, o botão do mercador e o do Mercado.

export interface PropsRua {
  /** px de CSS por pixel da arte (inteiro; vira px inteiros do aparelho). */
  k: number
  /** Escurece as pontas (a cena não vai de ponta a ponta da tela). */
  bordas?: boolean
  className?: string
}

const REDUZ = '(prefers-reduced-motion: reduce)'
function assinarReduz(avisar: () => void) {
  try {
    const q = window.matchMedia(REDUZ)
    q.addEventListener('change', avisar)
    return () => q.removeEventListener('change', avisar)
  } catch {
    return () => {}
  }
}
const lerReduz = () => {
  try {
    return window.matchMedia(REDUZ).matches
  } catch {
    return false
  }
}
function assinarAba(avisar: () => void) {
  document.addEventListener('visibilitychange', avisar)
  return () => document.removeEventListener('visibilitychange', avisar)
}
const lerAba = () => document.visibilityState !== 'hidden'

/** ?ruaquadros[=semente]: relógio na mão (prints quadro a quadro), semente fixa. */
function modoQuadros(): number | null {
  try {
    const v = new URLSearchParams(location.search).get('ruaquadros')
    return v == null ? null : Number(v) || 7
  } catch {
    return null
  }
}

interface Montada {
  motor: Motor
  cena: Cena
  /** px de CSS por pixel da grade. */
  px: number
  /** Onde o canvas começa dentro da faixa (px de CSS). */
  ox: number
}

/** Quanto tempo o botão do Mercado fica à vista depois do chamado (sem foco nem mouse em cima). */
const CTA_MS = 7000

export default function Rua({ k, bordas = false, className }: PropsRua) {
  const raiz = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const camadaBaloes = useRef<HTMLDivElement>(null)
  const botaoMerc = useRef<HTMLButtonElement>(null)
  const cta = useRef<HTMLAnchorElement>(null)
  const montada = useRef<Montada | null>(null)
  const [pacote, setPacote] = useState<Pacote | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [largura, setLargura] = useState(0)
  const [versao, setVersao] = useState(0)
  const [baloes, setBaloes] = useState<Balao[]>([])
  const [ctaVisivel, setCtaVisivel] = useState(false)
  const [pausada, setPausada] = useState(false)
  // o que o leitor de tela ouve quando chamam o mercador (a cena sozinha fica muda)
  const [aviso, setAviso] = useState('')
  const reduz = useSyncExternalStore(assinarReduz, lerReduz, () => false)
  const abaVisivel = useSyncExternalStore(assinarAba, lerAba, () => true)
  // à vista de verdade: a barra de abas do celular (64 px, fixa embaixo) cobre o pé da tela
  const [naTela, setNaTela] = useState(false)
  useEffect(() => {
    const el = raiz.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNaTela(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setNaTela(e.isIntersecting), { rootMargin: '0px 0px -72px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const camada = useCamadaAberta()
  const quadros = useRef(modoQuadros()).current
  const roda = !!pacote && naTela && abaVisivel && !camada && !pausada && !reduz && quadros == null

  // o elenco monta no worker quando a rua chega perto da tela (no computador ela já nasce à vista)
  const [perto, setPerto] = useState(false)
  useEffect(() => {
    const el = raiz.current
    if (!el || perto) return
    if (typeof IntersectionObserver === 'undefined') {
      setPerto(true)
      return
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setPerto(true), { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [perto])
  useEffect(() => {
    if (!perto) return
    let vivo = true
    carregarPacote({ alturaPoste: ALTURA_POSTE, alturaLuz: ALTURA_LUZ }).then(
      (p) => vivo && setPacote(p),
      () => vivo && setFalhou(true),
    )
    return () => {
      vivo = false
    }
  }, [perto])

  // largura da faixa (a rua remonta quando ela muda: celular que deita, janela que estica)
  useLayoutEffect(() => {
    const el = raiz.current
    if (!el) return
    let t = 0
    const medir = () => {
      const w = Math.round(el.clientWidth)
      setLargura((antes) => {
        if (!antes) return w
        // esticando a janela: espera parar
        window.clearTimeout(t)
        t = window.setTimeout(() => setLargura(w), 160)
        return antes
      })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [])

  /** Balões e o botão do mercador seguem quem fala / o mercador (depois de cada desenho). */
  const posicionar = useCallback(() => {
    const mo = montada.current
    const caixa = raiz.current
    if (!mo || !caixa) return
    const { motor, px, ox } = mo
    const dpr = window.devicePixelRatio || 1
    const snap = (v: number) => Math.round(v * dpr) / dpr
    const W = caixa.clientWidth
    camadaBaloes.current?.querySelectorAll<HTMLElement>('[data-ator]').forEach((el) => {
      const a = motor.ator(el.dataset.ator!)
      if (!a) return
      const c = motor.cabeca(a)
      const cx = ox + c.x * px
      const cy = c.y * px
      const w = el.offsetWidth
      const h = el.offsetHeight
      const CAUDA = 7
      // em cima da cabeça, um pouco para a frente (para onde ele olha), sem sair da faixa
      let left = cx - w / 2 + (c.lado === 'dir' ? w * 0.18 : -w * 0.18)
      left = Math.max(4, Math.min(W - w - 4, left))
      const top = Math.max(2, cy - CAUDA - h - 1)
      // sem tapar a cabeça de outro (a moto passando na frente do mercador): desvia para o lado que tiver lugar
      for (const o of motor.atores) {
        if (o === a || !o.visivel || o.efeito || !motor.temCabeca(o)) continue
        const oc = motor.cabeca(o)
        const ox0 = ox + (oc.x - 9) * px
        const ox1 = ox + (oc.x + 9) * px
        const oy0 = oc.y * px
        if (left < ox1 && left + w > ox0 && top < oy0 + 14 * px && top + h > oy0) {
          const paraEsq = ox0 - w - 4
          const paraDir = ox1 + 4
          left = Math.abs(paraEsq - left) < Math.abs(paraDir - left) && paraEsq >= 4 ? paraEsq : paraDir + w <= W - 4 ? paraDir : Math.max(4, paraEsq)
        }
      }
      el.style.transform = `translate(${snap(left)}px, ${snap(top)}px)`
      el.style.setProperty('--cauda', `${Math.round(Math.max(12, Math.min(w - 12, cx - left)))}px`)
    })
    const merc = motor.ator('mercador')
    const b = botaoMerc.current
    if (merc && b) {
      const [x0, y0, x1, y1] = motor.caixa(merc)
      b.style.transform = `translate(${snap(ox + x0 * px)}px, ${snap(y0 * px)}px)`
      b.style.width = `${snap((x1 - x0) * px)}px`
      b.style.height = `${snap((y1 - y0) * px)}px`
      // o adesivo do Mercado: colado na calçada, embaixo dele
      const l = cta.current
      if (l) {
        const w = l.offsetWidth
        const meio = ox + merc.x * px
        l.style.transform = `translate(${snap(Math.max(6, Math.min(W - w - 6, meio - w / 2)))}px, 0) rotate(2deg)`
      }
    }
  }, [])

  // monta a cena (e remonta quando muda a largura, o elenco ou o movimento reduzido)
  useEffect(() => {
    const c = tela.current
    if (!pacote || !largura || !c) return
    const dpr = window.devicePixelRatio || 1
    const kk = escalaDoAparelho(k, dpr)
    const W = Math.min(LARGURA_MAX, Math.ceil((largura * dpr) / kk))
    const px = kk / dpr
    c.style.width = `${(W * kk) / dpr}px`
    c.style.height = `${(ALTURA * kk) / dpr}px`
    const ox = (largura - (W * kk) / dpr) / 2
    c.style.transform = `translateX(${Math.round(ox * dpr) / dpr}px)`
    let motor: Motor
    try {
      motor = new Motor({
        tela: c,
        pacote,
        largura: W,
        bordas: bordas || W >= LARGURA_MAX,
        semente: quadros ?? (Date.now() & 0xffff),
        sexta: new Date().getDay() === 5,
        aoBaloes: (b) => setBaloes(b),
        aoDesenhar: () => posicionar(),
      })
    } catch {
      setFalhou(true)
      return
    }
    const cena = reduz ? montarRetrato(motor) : montarCena(motor)
    montada.current = { motor, cena, px, ox }
    motor.desenhar()
    setVersao((v) => v + 1)
    if (quadros != null) {
      ;(window as unknown as { __rua?: unknown }).__rua = {
        avancar: (ms: number) => motor.avancarNaMao(ms),
        motor,
        chamar: () => cena.chamar(false),
      }
    }
    return () => {
      motor.destruir()
      montada.current = null
      setBaloes([])
    }
  }, [pacote, largura, k, bordas, reduz, quadros, posicionar])

  // liga e desliga o relógio
  useEffect(() => {
    const mo = montada.current
    if (!mo) return
    if (roda) mo.motor.ligar()
    else mo.motor.desligar()
  }, [roda, versao])

  // balão novo: posiciona antes de pintar
  useLayoutEffect(() => {
    posicionar()
  }, [baloes, ctaVisivel, posicionar])

  // o botão do Mercado some sozinho, menos com foco ou mouse em cima
  const timerCta = useRef(0)
  const esconderCta = useCallback(() => {
    window.clearTimeout(timerCta.current)
    timerCta.current = window.setTimeout(() => {
      const l = cta.current
      if (l && (l.matches(':focus') || l.matches(':hover'))) return esconderCta()
      setCtaVisivel(false)
    }, CTA_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timerCta.current), [])

  const chamar = () => {
    const mo = montada.current
    if (!mo) return
    // no computador a rua é larga: cabe a fala longa em duas linhas
    mo.cena.chamar(k >= 3)
    mo.motor.marcar()
    if (!mo.motor.rodando) mo.motor.desenhar()
    setCtaVisivel(true)
    setAviso('O mercador abriu o casaco e ofereceu o Mercado.')
    esconderCta()
  }

  const tocarCena = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mo = montada.current
    if (!mo || reduz) return
    const r = e.currentTarget.getBoundingClientRect()
    const gx = (e.clientX - r.left) / mo.px
    const gy = (e.clientY - r.top) / mo.px
    const quem = mo.cena.tocar(gx, gy, 22 / mo.px)
    if (quem === 'mercador') chamar()
  }

  const apontar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mo = montada.current
    if (!mo || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const quem = mo.motor.quemEsta((e.clientX - r.left) / mo.px, (e.clientY - r.top) / mo.px, 0)
    e.currentTarget.style.cursor = quem && !reduz ? 'pointer' : ''
  }

  const estado = falhou ? 'falhou' : !pacote ? 'carregando' : reduz ? 'foto' : roda ? 'rodando' : 'parada'

  if (falhou) return null

  return (
    <div ref={raiz} className={`rua${pacote ? ' pronta' : ''}${className ? ` ${className}` : ''}`} role="group" aria-label="A rua da loja" data-rua={estado}>
      <canvas ref={tela} className="rua-tela" aria-hidden="true" onClick={tocarCena} onPointerMove={apontar} />
      <div ref={camadaBaloes} className="rua-baloes" aria-hidden="true">
        {baloes.map((b) => (
          <p key={b.id} className="rua-balao" data-ator={b.ator}>
            <span className="rua-balao-corpo">{b.texto}</span>
          </p>
        ))}
      </div>
      {pacote && (
        <button ref={botaoMerc} type="button" className="rua-mercador" aria-label="Chamar o mercador" onClick={chamar} />
      )}
      {ctaVisivel && (
        <a
          ref={cta}
          className="adesivo-link toque rua-cta"
          href={hrefAba('catalogo')}
          onClick={(e) => {
            if (!cliqueDeAba(e)) return
            irParaAba('catalogo')
          }}
          onBlur={esconderCta}
        >
          <Icone nome="link" tamanho={16} />
          Ver o Mercado
        </a>
      )}
      <span className="sr-only" aria-live="polite">
        {ctaVisivel ? aviso : ''}
      </span>
      {pacote && !reduz && quadros == null && (
        <button type="button" className="rua-pausa" aria-label={pausada ? 'Continuar a rua' : 'Pausar a rua'} onClick={() => setPausada((p) => !p)}>
          <span className="rua-pausa-disco">
            <Icone nome={pausada ? 'play' : 'pausa'} tamanho={16} />
          </span>
        </button>
      )}
    </div>
  )
}
