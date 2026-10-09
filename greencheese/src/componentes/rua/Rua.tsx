import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cliqueDeAba, hrefAba, irParaAba } from '../../lib/abas'
import { Icone } from '../comum'
import { useCamadaAberta } from '../Mercador'
import { Motor, type Balao } from './motor'
import { carregarPacote, type Pacote } from './pacote'
import { ALTURA, ALTURA_LUZ, ALTURA_POSTE, LARGURA_MAX, escalaDoAparelho } from './palco'
import { montarCena, montarRetrato, type Cena, type Chamado } from './roteiro'
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

/** Um jeito de quebrar o balão: a largura máxima (null: a do CSS) e o tamanho que ele fica. */
interface Variante {
  mw: number | null
  w: number
  h: number
  linhas: number
}
interface Medida {
  vs: Variante[]
  atual: number
}
/** As quebras de cada balão (uma, duas e três linhas), medidas uma vez quando ele aparece. */
const medidas = new WeakMap<HTMLElement, Medida>()

/** Mede o balão com a largura máxima `mw`: tamanho da caixa e largura da linha mais larga (sem o giro da entrada). */
function lerBalao(el: HTMLElement, mw: number | null) {
  el.style.maxWidth = mw == null ? '' : `${mw}px`
  const corpo = el.firstElementChild as HTMLElement
  const esc = corpo.offsetWidth ? corpo.getBoundingClientRect().width / corpo.offsetWidth || 1 : 1
  const r = document.createRange()
  r.selectNodeContents(corpo)
  const linhas = new Map<number, number>()
  for (const q of r.getClientRects()) {
    const t = Math.round(q.top / esc)
    linhas.set(t, (linhas.get(t) ?? 0) + q.width / esc)
  }
  return { w: el.offsetWidth, h: el.offsetHeight, linhas: Math.max(1, linhas.size), texto: linhas.size ? Math.max(...linhas.values()) : 0 }
}

/**
 * Uma linha (a do CSS) e, se a fala quebra, duas e três, cada uma na menor largura que cabe e justa no texto (a caixa
 * encolhe até a linha mais larga): é o que deixa o balão caber de lado quando a cabeça de outro está perto de quem
 * fala. Uns 15 layouts, uma vez por balão.
 */
function medirBalao(el: HTMLElement): Variante[] {
  const v0 = lerBalao(el, null)
  const vs: Variante[] = [{ mw: null, w: v0.w, h: v0.h, linhas: v0.linhas }]
  const folga = v0.w - v0.texto
  let teto = v0.w
  for (let alvo = v0.linhas + 1; alvo <= 3; alvo++) {
    // a menor largura com até `alvo` linhas (busca binária: menos largura, mais linhas)
    let lo = 24
    let hi = teto
    while (hi - lo > 2) {
      const meio = (lo + hi) >> 1
      if (lerBalao(el, meio).linhas <= alvo) hi = meio
      else lo = meio
    }
    const a = lerBalao(el, hi)
    if (a.linhas !== alvo) continue
    // justa na linha mais larga
    const mw = Math.min(hi, Math.ceil(a.texto + folga + 1))
    const b = lerBalao(el, mw)
    vs.push(b.linhas === alvo ? { mw, w: b.w, h: b.h, linhas: alvo } : { mw: hi, w: a.w, h: a.h, linhas: alvo })
    teto = hi
  }
  el.style.maxWidth = ''
  return vs
}

interface Caixa {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Quanto custa cobrir: cabeça de outro pesa muito; o letreiro e o botão de pausar, menos. */
  peso: number
}
const cobre = (x0: number, y0: number, x1: number, y1: number, c: Caixa) => Math.max(0, Math.min(x1, c.x1) - Math.max(x0, c.x0)) * Math.max(0, Math.min(y1, c.y1) - Math.max(y0, c.y0))
/** Custo de quebrar a fala (px² cobertos que valem uma linha a mais). */
const CUSTO_LINHA = [0, 150, 1000]

/** O que o leitor de tela ouve quando chamam o mercador: o que de fato acontece na cena. */
function avisoDoChamado(c: Chamado, rodando: boolean): string {
  if (c === 'foto') return 'O mercador ofereceu o Mercado.'
  if (!rodando) return 'O mercador ofereceu o Mercado. A rua está parada: ele abre o casaco quando ela voltar a andar.'
  if (c === 'depois') return 'O mercador ofereceu o Mercado. Ele abre o casaco assim que terminar o atendimento.'
  return 'O mercador ofereceu o Mercado e abre o casaco.'
}

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
    const CAUDA = 7
    camadaBaloes.current?.querySelectorAll<HTMLElement>('[data-ator]').forEach((el) => {
      const a = motor.ator(el.dataset.ator!)
      if (!a) return
      const c = motor.cabeca(a)
      const cx = ox + c.x * px
      const cy = c.y * px
      let med = medidas.get(el)
      // a fonte em pixel chegou depois da medida: mede de novo
      if (med && Math.abs(el.offsetWidth - med.vs[med.atual].w) > 1) med = undefined
      if (!med) {
        med = { vs: medirBalao(el), atual: 0 }
        medidas.set(el, med)
      }
      // o que o balão não deve cobrir: a cabeça de outro (o rosto e o capuz), o letreiro GC e o botão de pausar
      const obst: Caixa[] = []
      for (const o of motor.atores) {
        if (o === a || !o.visivel || o.efeito) continue
        if (motor.temCabeca(o)) {
          const oc = motor.cabeca(o)
          const topo = Math.min(oc.y, motor.caixa(o)[1])
          obst.push({ x0: ox + (oc.x - 10) * px, y0: topo * px, x1: ox + (oc.x + 10) * px, y1: (topo + 14) * px, peso: 10 })
        } else if (o.id === 'letreiro') {
          const [x0, y0, x1, y1] = motor.caixa(o)
          obst.push({ x0: ox + x0 * px, y0: y0 * px, x1: ox + x1 * px, y1: y1 * px, peso: 1 })
        }
      }
      if (caixa.querySelector('.rua-pausa')) obst.push({ x0: W - 38, y0: 6, x1: W - 6, y1: 38, peso: 2 })
      // em cima da cabeça, um pouco para a frente (para onde ele olha), com a ponta da cauda em cima dele, dentro da
      // faixa; se cobrir alguma coisa, vai para o lado ou quebra em duas (três) linhas: ganha o que cobre menos
      let melhor = { custo: Infinity, iv: 0, left: 0, top: 0 }
      med.vs.forEach((v, iv) => {
        const topoIdeal = cy - CAUDA - v.h - 1
        const top = Math.max(2, topoIdeal)
        const pref = cx - v.w / 2 + (c.lado === 'dir' ? v.w * 0.18 : -v.w * 0.18)
        // a cauda (12 px da ponta da caixa, no mínimo) fica em cima de quem fala
        const lo = Math.max(4, cx - v.w + 12)
        const hi = Math.min(W - v.w - 4, cx - 12)
        const prender = (x: number) => (lo <= hi ? Math.max(lo, Math.min(hi, x)) : Math.max(4, Math.min(W - v.w - 4, pref)))
        const lugares = [pref, lo, hi]
        for (const o of obst) lugares.push(o.x0 - v.w - 4, o.x1 + 4)
        for (const l of lugares) {
          const left = prender(l)
          let custo = CUSTO_LINHA[v.linhas - med.vs[0].linhas] ?? 2000
          custo += Math.abs(left - pref) * 0.5 + (topoIdeal < 2 ? (2 - topoIdeal) * 20 : 0) + (iv !== med.atual ? 60 : 0)
          // o corpo do balão (a cauda é a sobra transparente de baixo)
          for (const o of obst) custo += o.peso * cobre(left, top, left + v.w, top + v.h - CAUDA, o)
          if (custo < melhor.custo) melhor = { custo, iv, left, top }
        }
      })
      const v = med.vs[melhor.iv]
      if (melhor.iv !== med.atual) {
        med.atual = melhor.iv
        el.style.maxWidth = v.mw == null ? '' : `${v.mw}px`
      }
      el.style.transform = `translate(${snap(melhor.left)}px, ${snap(melhor.top)}px)`
      el.style.setProperty('--cauda', `${Math.round(Math.max(12, Math.min(v.w - 12, cx - melhor.left)))}px`)
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
    const c = mo.cena.chamar(k >= 3)
    mo.motor.marcar()
    if (!mo.motor.rodando) mo.motor.desenhar()
    setCtaVisivel(true)
    setAviso(avisoDoChamado(c, mo.motor.rodando))
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
