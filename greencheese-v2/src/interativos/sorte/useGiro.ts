import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { medirQuadro, modoLeve, vibrar } from './tato'

// Gesto de girar a tampa: pega 1:1 com travas, nos dois sentidos (vai e volta também dichava).
// - O pointermove só guarda o último ponto; um rAF escreve rotor.style.transform (nada de setState por quadro:
//   o React re-renderiza 1 vez por quarto de volta, 8 no total).
// - Trava a cada 30° (a tampa segura 3° e alcança o dedo em ~40 ms); na partida, 8° pra descolar; no último quarto,
//   travas a cada 15° segurando 5° (fica mais duro).
// - Progresso = soma de |delta|, com teto de 900°/s; meta 720° (8 quartos, 2 voltas).
// - Inércia ao soltar (ω × 0,9 por quadro, até 60°), fora do movimento reduzido e do modo leve.
// - Alternativas: botão "Girar" (toque = +90° em 180 ms; segurar > 350 ms = contínuo a 360°/s), setas no disco
//   (+¼ cada), Espaço/Enter segurado (contínuo) e a roda do mouse (1 trava por passo, a cada 60 ms).

export const META_GRAUS = 720
const QUARTO = 90
const ZONA_MORTA = 0.2
const TETO_GRAUS_S = 900
const DESCOLAR = 8
const ALCANCE_MS = 13 // constante de tempo: alcança o dedo em ~40 ms

interface Opcoes {
  /** Área do gesto (o quadrado do palco: disco + 24 px). */
  area: RefObject<HTMLElement | null>
  /** Caixa do disco (centro e raio). */
  disco: RefObject<HTMLElement | null>
  /** O que gira. */
  rotor: RefObject<HTMLElement | null>
  /** Indicador às 12h (inverte 1 quadro a cada trava). */
  indicador: RefObject<HTMLElement | null>
  /** Aceita gesto (convite/girando). */
  ativo: boolean
  /** Muda quando o palco remonta (nova rodada): os ouvintes vão pro elemento novo. */
  chave: number
  reduzido: boolean
  aoQuarto: (q: number) => void
  /** 1ª mexida (para o convite animado e vira "girando"). */
  aoComecar: () => void
  aoZonaMorta: (dentro: boolean) => void
  /** Parado há 4 s com pelo menos 1 quarto (ou voltou a mexer). */
  aoParado: (parado: boolean) => void
}

export interface ControleGiro {
  /** +90° em 180 ms (botão, setas). Sinal = sentido; os dois contam. */
  girarQuarto: (sentido?: 1 | -1) => void
  /** Começa/para o giro contínuo (segurar o botão, Espaço ou Enter). */
  continuo: (ligar: boolean) => void
  /** Zera o progresso (fechou no meio, deu erro). */
  zerar: () => void
  /** Ângulo atual da tampa (graus). */
  angulo: () => number
  /** Põe a tampa num ângulo (fim do estalo). */
  definirAngulo: (a: number) => void
}

export function useGestoGiro(o: Opcoes): ControleGiro {
  const op = useRef(o)
  op.current = o

  const s = useRef({
    tampa: 0, // ângulo desenhado
    alvo: 0, // ângulo do dedo (acumulado)
    progresso: 0,
    quartos: 0,
    ponteiro: null as number | null,
    ponto: null as { x: number; y: number } | null,
    angAnterior: 0,
    inicio: 0,
    descolou: true,
    centro: { x: 0, y: 0 },
    raio: 1,
    velocidades: [] as number[],
    inercia: 0,
    inerciaFeita: 0,
    sintetico: 0, // graus que faltam aplicar (botão, setas, roda)
    porMs: 0.5,
    continuo: false,
    trava: 0,
    raf: 0,
    t: 0,
    zona: false,
    comecou: false,
    ultimoMov: 0,
    parado: false,
    medindo: true,
  })

  const medir = useCallback(() => {
    const d = op.current.disco.current
    if (!d) return
    const r = d.getBoundingClientRect()
    s.current.centro = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    s.current.raio = (r.width / 2) * (320 / 340)
  }, [])

  const piscarIndicador = useCallback(() => {
    const el = op.current.indicador.current
    if (!el) return
    el.classList.add('inv')
    window.setTimeout(() => el.classList.remove('inv'), 70)
  }, [])

  const escrever = useCallback(() => {
    const r = op.current.rotor.current
    if (r) r.style.transform = `rotate(${s.current.tampa.toFixed(2)}deg)`
  }, [])

  const comecar = useCallback(() => {
    const e = s.current
    if (e.comecou) return
    e.comecou = true
    op.current.aoComecar()
  }, [])

  /** Soma graus ao progresso (com teto) e avisa quando passa de quarto. */
  const progredir = useCallback((graus: number, dt: number) => {
    const e = s.current
    if (e.quartos >= 8) return
    const g = Math.min(Math.abs(graus), (TETO_GRAUS_S * Math.max(dt, 1)) / 1000)
    if (g <= 0) return
    e.progresso = Math.min(META_GRAUS, e.progresso + g)
    e.ultimoMov = performance.now()
    if (e.parado) {
      e.parado = false
      op.current.aoParado(false)
    }
    const q = Math.min(8, Math.floor(e.progresso / QUARTO + 1e-6))
    if (q > e.quartos) {
      e.quartos = q
      vibrar('quarto')
      op.current.aoQuarto(q)
    }
  }, [])

  const passo = () => (s.current.progresso >= META_GRAUS - QUARTO ? 15 : 30)
  const segura = () => (op.current.reduzido ? 0 : s.current.progresso >= META_GRAUS - QUARTO ? 5 : 3)

  const quadro = useCallback(
    (t: number) => {
      const e = s.current
      const dt = e.t ? Math.min(64, t - e.t) : 16
      e.t = t
      if (e.medindo && e.ponteiro != null) medirQuadro(dt)

      // dedo
      if (e.ponteiro != null && e.ponto) {
        const dx = e.ponto.x - e.centro.x
        const dy = e.ponto.y - e.centro.y
        const dentro = Math.hypot(dx, dy) < e.raio * ZONA_MORTA
        if (dentro !== e.zona) {
          e.zona = dentro
          op.current.aoZonaMorta(dentro)
        }
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI
        let d = ang - e.angAnterior
        d = ((((d + 180) % 360) + 360) % 360) - 180
        if (d === -180) d = 180
        e.angAnterior = ang
        if (!dentro && d !== 0) {
          e.alvo += d
          e.velocidades.push(d)
          if (e.velocidades.length > 4) e.velocidades.shift()
          progredir(d, dt)
        } else e.velocidades.push(0)
        if (!e.descolou && Math.abs(e.alvo - e.inicio) >= DESCOLAR) e.descolou = true
      }

      // inércia depois de soltar
      if (e.ponteiro == null && Math.abs(e.inercia) >= 0.5 && e.inerciaFeita < 60) {
        const d = Math.sign(e.inercia) * Math.min(Math.abs(e.inercia), 60 - e.inerciaFeita)
        e.alvo += d
        e.inerciaFeita += Math.abs(d)
        e.inercia *= 0.9
        progredir(d, dt)
      } else if (e.ponteiro == null) e.inercia = 0

      // botão, setas, roda e contínuo
      if (e.sintetico !== 0 || e.continuo) {
        const vel = e.continuo ? 0.36 : e.porMs
        let d = vel * dt
        if (!e.continuo) d = Math.sign(e.sintetico) * Math.min(Math.abs(e.sintetico), d)
        else d = Math.max(d, 0)
        if (!e.continuo) e.sintetico -= d
        if (Math.abs(e.sintetico) < 0.01) e.sintetico = 0
        e.alvo += d
        progredir(d, dt)
      }

      // tampa: segue o dedo, segura nas travas e descola na partida
      let destino = e.descolou ? e.alvo : e.tampa
      const p = passo()
      const h = segura()
      const k = Math.round(destino / p) * p
      if (h > 0 && Math.abs(destino - k) <= h / 2) destino = k
      // trava: cada vez que o dedo cruza uma (nos dois sentidos), um tique e o indicador pisca
      const cruzou = Math.floor(e.alvo / p) * p
      if (cruzou !== e.trava) {
        e.trava = cruzou
        vibrar('trava')
        piscarIndicador()
      }
      const falta = destino - e.tampa
      if (op.current.reduzido || Math.abs(falta) < 0.3) e.tampa = destino
      else e.tampa += falta * (1 - Math.exp(-dt / ALCANCE_MS))
      escrever()

      const ativoAinda = e.ponteiro != null || e.continuo || e.sintetico !== 0 || (Math.abs(e.inercia) >= 0.5 && e.inerciaFeita < 60) || Math.abs(destino - e.tampa) > 0.05
      if (ativoAinda && e.quartos < 8) e.raf = requestAnimationFrame(quadro)
      else {
        e.raf = 0
        e.t = 0
        const r = op.current.rotor.current
        if (r) r.style.willChange = ''
      }
    },
    [escrever, piscarIndicador, progredir],
  )

  const acordar = useCallback(() => {
    const e = s.current
    if (e.raf || e.quartos >= 8) return
    const r = op.current.rotor.current
    if (r) r.style.willChange = 'transform'
    e.raf = requestAnimationFrame(quadro)
  }, [quadro])

  // ponteiro (toque e mouse): só o primário; o 2º dedo é ignorado
  useEffect(() => {
    const area = o.area.current
    if (!area || !o.ativo) return
    const e = s.current
    const desce = (ev: PointerEvent) => {
      if (!ev.isPrimary || e.ponteiro != null || e.quartos >= 8) return
      if (ev.pointerType === 'mouse' && ev.button !== 0) return
      ev.preventDefault()
      medir()
      comecar()
      e.ponteiro = ev.pointerId
      e.ponto = { x: ev.clientX, y: ev.clientY }
      e.angAnterior = (Math.atan2(ev.clientY - e.centro.y, ev.clientX - e.centro.x) * 180) / Math.PI
      e.inicio = e.alvo
      e.descolou = op.current.reduzido || Math.abs(e.tampa - e.alvo) > 0.5 ? true : false
      e.inercia = 0
      e.velocidades = []
      try {
        area.setPointerCapture(ev.pointerId)
      } catch {
        /* ignora */
      }
      acordar()
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.ponteiro) return
      e.ponto = { x: ev.clientX, y: ev.clientY }
    }
    const solta = (ev: PointerEvent, cancelou: boolean) => {
      if (ev.pointerId !== e.ponteiro) return
      e.ponteiro = null
      e.medindo = false // o modo leve só mede o 1º gesto
      e.ponto = null
      if (e.zona) {
        e.zona = false
        op.current.aoZonaMorta(false)
      }
      // inércia: média dos últimos quadros (pointercancel mantém o progresso, sem inércia)
      const v = e.velocidades.length ? e.velocidades.reduce((a, b) => a + b, 0) / e.velocidades.length : 0
      e.inercia = !cancelou && !op.current.reduzido && !modoLeve() ? v : 0
      e.inerciaFeita = 0
      acordar()
    }
    const up = (ev: PointerEvent) => solta(ev, false)
    const cancel = (ev: PointerEvent) => solta(ev, true)
    area.addEventListener('pointerdown', desce)
    area.addEventListener('pointermove', move)
    area.addEventListener('pointerup', up)
    area.addEventListener('pointercancel', cancel)
    return () => {
      area.removeEventListener('pointerdown', desce)
      area.removeEventListener('pointermove', move)
      area.removeEventListener('pointerup', up)
      area.removeEventListener('pointercancel', cancel)
    }
  }, [o.area, o.ativo, o.chave, medir, comecar, acordar])

  // roda do mouse sobre o disco: 1 trava por passo (listener não passivo pra segurar a rolagem)
  useEffect(() => {
    const disco = o.disco.current
    if (!disco || !o.ativo) return
    let ultima = 0
    const roda = (ev: WheelEvent) => {
      ev.preventDefault()
      const agora = performance.now()
      if (agora - ultima < 60 || Math.abs(ev.deltaY) < 1) return
      ultima = agora
      comecar()
      s.current.porMs = 0.5
      s.current.sintetico += ev.deltaY > 0 ? 30 : -30
      acordar()
    }
    disco.addEventListener('wheel', roda, { passive: false })
    return () => disco.removeEventListener('wheel', roda)
  }, [o.disco, o.ativo, o.chave, comecar, acordar])

  // centro e raio: no resize e na virada da tela (nunca no loop)
  useEffect(() => {
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('orientationchange', medir)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('orientationchange', medir)
    }
  }, [medir])

  // parado há 4 s com pelo menos 1 quarto
  useEffect(() => {
    if (!o.ativo) return
    const id = window.setInterval(() => {
      const e = s.current
      if (e.quartos >= 1 && e.quartos < 8 && !e.parado && e.ponteiro == null && !e.continuo && performance.now() - e.ultimoMov > 4000) {
        e.parado = true
        op.current.aoParado(true)
      }
    }, 500)
    return () => clearInterval(id)
  }, [o.ativo])

  useEffect(() => () => cancelAnimationFrame(s.current.raf), [])

  const girarQuarto = useCallback(
    (sentido: 1 | -1 = 1) => {
      if (s.current.quartos >= 8) return
      comecar()
      s.current.porMs = QUARTO / 180
      s.current.sintetico += sentido * QUARTO
      acordar()
    },
    [comecar, acordar],
  )

  const continuo = useCallback(
    (ligar: boolean) => {
      if (ligar && s.current.quartos >= 8) return
      if (ligar) comecar()
      s.current.continuo = ligar
      if (ligar) acordar()
    },
    [comecar, acordar],
  )

  const zerar = useCallback(() => {
    const e = s.current
    cancelAnimationFrame(e.raf)
    Object.assign(e, { raf: 0, t: 0, progresso: 0, quartos: 0, sintetico: 0, continuo: false, inercia: 0, ponteiro: null, ponto: null, comecou: false, parado: false, trava: 0, alvo: 0, tampa: 0, descolou: true })
    escrever()
  }, [escrever])

  const angulo = useCallback(() => s.current.tampa, [])
  const definirAngulo = useCallback(
    (a: number) => {
      s.current.tampa = a
      s.current.alvo = a
    },
    [],
  )

  return { girarQuarto, continuo, zerar, angulo, definirAngulo }
}
