import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as PointerEventReact } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import { Icone } from '../../componentes/comum'
import { FormConta, type ModoForm } from '../../componentes/FormConta'
import { canalDa } from '../../dados/canais'
import { config } from '../../dados/config'
import type { Premio } from '../../dados/sorte'
import { primeiroNome, type ContaAberta } from '../../lib/conta'
import { conta as adaptador } from '../../lib/conta-adaptador'
import { formatarAte, formatarDiaSemana, formatarEspera, formatarValidade, fraseDoPremio, nomeDoPremio, premioPorId } from '../../lib/cupom'
import { ehDesktop, movimentoReduzido, ponteiroFino } from '../../lib/movimento'
import type { Cupom } from '../../store/conta'
import { useLocal } from '../../store/local'
import { useUI } from '../../store/ui'
import { FOCO_JOGO, useCasca } from '../CascaInterativo'
import type { PropsJogo } from '../registro'
import { AdesivoCodigo, BolhaPremio } from './Adesivos'
import { ID_SORTE, useEstadoSorte, usarNoPedido, type ResumoSorte } from './estado'
import { Palco, type RefsPalco } from './Palco'
import { Regras } from './Regras'
import { estalo, montarRevelacao, pintarFinal, PULAR_ATE, PULAR_DESDE, type ElementosRevelacao } from './revelar'
import { FaixaPremio, StoryPremio, type DadosPremio, type Sintonia } from './StoryPremio'
import { modoLeve, vibrar } from './tato'
import { T } from './textos'
import { useGestoGiro } from './useGiro'
import './estilo'

// "Teste minha sorte": gira a tampa do dichavador, ele abre, a câmera mergulha na câmara escura e o preto de dentro
// vira um story dos Melhores amigos, só pra pessoa, com o prêmio (StoryPremio).
// Máquina de fases (o React guarda fase e quartos; ângulo, velocidade e trava ficam nos refs do gesto):
// convite → girando → revelando → prêmio → (cadastro | entrar) → guardado · espera (com conta, já girou hoje) ·
// bloqueado (sem conta, já girou). O sorteio é gravado no estalo, antes da animação: recarregar não sorteia de novo.

type Fase = 'convite' | 'girando' | 'revelando' | 'premio' | 'cadastro' | 'entrar' | 'guardado' | 'espera' | 'bloqueado'

interface Ganho {
  premio: Premio
  cupom: Cupom | null
  origem: 'giro' | 'pendente' | 'conta'
}

type Base = Pick<ResumoSorte, 'conta' | 'pendenteValido' | 'giro'>

/** Fase de descanso (abrir a camada, virar o minuto). */
function faseBase(r: Base): Fase {
  if (!r.conta && r.pendenteValido) return 'premio'
  if (r.giro.disponivel) return 'convite'
  return r.conta ? 'espera' : 'bloqueado'
}

function dadosDe(premio: Premio | undefined, cupom: Cupom | null): DadosPremio | null {
  if (cupom) {
    // guardado: vale a data do cupom (validoAte), não os dias do prêmio
    const r = cupom.retrato
    const p = premio ?? premioPorId(cupom.premioId)
    return { titulo: r.titulo, regra: r.regra, descricao: p?.descricao, comoUsar: r.comoUsar, aplicaA: r.aplicaA, demo: cupom.demo, valor: r }
  }
  if (!premio) return null
  return { titulo: premio.titulo, regra: premio.regra, descricao: premio.descricao, comoUsar: premio.comoUsar, aplicaA: premio.aplicaA, demo: premio.demo, validadeDias: premio.validadeDias, valor: premio }
}

/** Alvo de foco da tela que acabou de entrar (ex.: "Fechou, Ian. Teu cupom tá guardado."); sem ele, o h2. */
const FOCO_FASE = '[data-foco-fase]'

/* ───────────── tamanho do story ───────────── */

/**
 * 'fora': as ações ficam embaixo do story (celular alto, computador); 'sobre': por cima do pé dele, num degradê (celular
 * baixo, como o Instagram num celular 16:9); 'lado': celular deitado, o story deitado à esquerda e as ações numa coluna
 * à direita.
 */
type ModoStory = 'fora' | 'sobre' | 'lado'
interface MedidaStory {
  w: number
  h: number
  modo: ModoStory
  pe: number
}

const TOPO_STORY = 8

/** O maior 9:16 que cabe na área do jogo, com as ações embaixo quando isso custa no máximo 12% da largura. */
/**
 * Altura das ações empilhadas (como ficam em 'fora'), medida no que está na tela em qualquer modo: em 'sobre' elas ficam
 * numa linha só, e decidir o modo pela altura da linha faria o modo ir e voltar.
 */
function alturaPeEmPe(pe: HTMLElement | null): number {
  if (!pe) return 112
  const botoes = pe.querySelector<HTMLElement>('.sorte-pe-botoes')
  const nota = pe.querySelector<HTMLElement>('.sorte-pe-nota')
  const filhos = botoes ? [...botoes.children].map((c) => (c as HTMLElement).offsetHeight) : []
  const seg = Math.max(0, parseFloat(getComputedStyle(pe).paddingBottom) - (pe.closest('[data-modo="sobre"]') ? 12 : 8))
  return 12 + (nota ? nota.offsetHeight + 8 : 0) + filhos.reduce((a, b) => a + b, 0) + 8 * Math.max(0, filhos.length - 1) + 8 + seg
}

function medirStory(corpo: HTMLElement, peEmPe: number, peAgora: number): MedidaStory {
  const peH = peEmPe
  const W = corpo.clientWidth
  const H = corpo.clientHeight
  // deitado: o 9:16 não cabe na altura; o story deita também (produto à esquerda, texto e adesivos à direita, como o
  // story do Início deitado) e as ações ficam numa coluna ao lado
  if (window.matchMedia('(max-height: 500px) and (orientation: landscape) and (max-width: 899px)').matches) {
    const w = Math.round(Math.min(560, W - 32 - 24 - Math.min(260, W * 0.3)))
    return { w, h: Math.round(H - TOPO_STORY * 2), modo: 'lado', pe: peH }
  }
  const maxW = Math.max(200, Math.min(W - 16, ehDesktop() ? 360 : 440))
  const hFora = Math.min((maxW * 16) / 9, H - TOPO_STORY - peH - 4)
  if ((hFora * 9) / 16 >= maxW * 0.88) {
    const w = Math.floor((hFora * 9) / 16)
    return { w, h: Math.round((w * 16) / 9), modo: 'fora', pe: peH }
  }
  const hSobre = Math.min((maxW * 16) / 9, H - TOPO_STORY - 8)
  const w = Math.max(200, Math.floor((hSobre * 9) / 16))
  // por cima do pé do story vale a altura que as ações têm agora (numa linha só)
  return { w, h: Math.round((w * 16) / 9), modo: 'sobre', pe: peAgora }
}

function iguais(a: MedidaStory | null, b: MedidaStory): boolean {
  return !!a && a.w === b.w && a.h === b.h && a.modo === b.modo && a.pe === b.pe
}

export default function JogoSorte({ tela }: PropsJogo) {
  const casca = useCasca()
  const r = useEstadoSorte()
  // o resumo mais novo, para quem decide a fase depois de um await (o closure pode ser de um render velho)
  const rAgora = useRef(r)
  rAgora.current = r
  const uf = useLocal((s) => s.uf)
  const instagram = canalDa(uf)?.instagram ?? null
  const avisar = useUI((s) => s.avisar)
  const setConta = useUI((s) => s.setConta)
  const reduzido = useMemo(() => movimentoReduzido(), [])
  const desktop = useMemo(() => ponteiroFino(), [])

  const [fase, setFase] = useState<Fase>(() => (tela && !r.conta ? tela === 'entrar' ? 'entrar' : 'cadastro' : faseBase(r)))
  const [voltaDe, setVoltaDe] = useState<Fase>(() => faseBase(r))
  const [quartos, setQuartos] = useState(0)
  const [ganho, setGanho] = useState<Ganho | null>(() => (!r.conta && r.pendenteValido && r.premioPendente ? { premio: r.premioPendente, cupom: null, origem: 'pendente' } : null))
  const [extra, setExtra] = useState<'zona' | 'parado' | null>(null)
  const [vivo, setVivo] = useState('')
  const [rodada, setRodada] = useState(0)
  const [semPremio, setSemPremio] = useState<{ nome: string } | null>(null)
  const [convidando, setConvidando] = useState(true)
  // o produto do story: só sintoniza no corte da revelação; fora dela, já pronto
  const [sintonia, setSintonia] = useState<Sintonia>('pronto')
  // guardou agora: o adesivo do código começa trancado e destrava com um estalo
  const [destrava, setDestrava] = useState<'trancado' | 'abrindo' | null>(null)
  const tlRev = useRef<gsap.core.Timeline | null>(null)
  const tlEstalo = useRef<gsap.core.Timeline | null>(null)
  const abrindo = useRef(false)

  const refs: RefsPalco = {
    palco: useRef<HTMLDivElement>(null),
    anel: useRef<SVGSVGElement>(null),
    corpo: useRef<HTMLDivElement>(null),
    labio: useRef<HTMLDivElement>(null),
    boca: useRef<HTMLDivElement>(null),
    tampa: useRef<HTMLDivElement>(null),
    lado: useRef<HTMLDivElement>(null),
    disco: useRef<HTMLDivElement>(null),
    rotor: useRef<HTMLDivElement>(null),
    indicador: useRef<HTMLDivElement>(null),
    dedo: useRef<HTMLDivElement>(null),
  }
  const raiz = useRef<HTMLDivElement>(null)
  const story = useRef<HTMLDivElement>(null)
  const quadro = useRef<HTMLDivElement>(null)
  const cobertura = useRef<HTMLCanvasElement>(null)
  const pe = useRef<HTMLDivElement>(null)
  const cromo = useRef<HTMLDivElement>(null)
  const segAbrir = useRef<HTMLElement>(null)
  const segPremio = useRef<HTMLElement>(null)
  const idTitulo = `sorte-titulo-${rodada}`

  // foco depois de trocar de tela (o botão tocado some com a tela velha; sem isto o foco cairia no <body>)
  const focar = useCallback((sel: string) => {
    requestAnimationFrame(() => (raiz.current?.querySelector<HTMLElement>(sel) ?? raiz.current?.querySelector<HTMLElement>(FOCO_JOGO))?.focus({ preventScroll: true }))
  }, [])

  // ao abrir: foco no h2 da fase (a casca já tentou; o jogo pode ter chegado depois)
  useEffect(() => {
    focar(FOCO_JOGO)
  }, [focar])

  /* ───────────── tamanho do story (mede sempre: na revelação ele já tem que estar no lugar) ───────────── */
  const [medida, setMedida] = useState<MedidaStory | null>(null)
  const corpoCasca = casca.corpo
  const ajustarStory = useCallback(() => {
    if (!corpoCasca) return null
    const m = medirStory(corpoCasca, alturaPeEmPe(pe.current), pe.current?.offsetHeight ?? 88)
    // escreve já no elemento (a revelação mede o quadro logo em seguida, antes do React re-renderizar)
    const s = story.current
    if (s) {
      s.style.setProperty('--sw', `${m.w}px`)
      s.style.setProperty('--sh', `${m.h}px`)
      s.style.setProperty('--pe-h', `${m.pe}px`)
      s.dataset.modo = m.modo
    }
    setMedida((a) => (iguais(a, m) ? a : m))
    return m
  }, [corpoCasca])
  useLayoutEffect(() => {
    if (!corpoCasca) return
    ajustarStory()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => ajustarStory())
    ro.observe(corpoCasca)
    if (pe.current) ro.observe(pe.current)
    return () => ro.disconnect()
  }, [corpoCasca, ajustarStory, fase, rodada])

  /* ───────────── fase de descanso acompanha o relógio (virada do dia, prêmio que venceu, outra aba) ───────────── */
  useEffect(() => {
    if (fase === 'espera' && r.giro.disponivel) {
      setRodada((n) => n + 1)
      setQuartos(0)
      setConvidando(true)
      setFase('convite')
      avisar(T.avisoLiberou)
      requestAnimationFrame(() => {
        const p = refs.palco.current
        if (p && !reduzido) gsap.fromTo(p, { scale: 0.9 }, { scale: 1, duration: 0.18, ease: 'steps(3)', clearProps: 'transform' })
      })
      return
    }
    if (fase === 'premio' && ganho?.origem === 'pendente' && !r.conta && !r.pendenteValido) {
      setGanho(null)
      setFase(faseBase(r))
      return
    }
    // saiu ou apagou a conta (Minha conta, outra aba) com um cupom guardado na tela: o "Usar agora" não vale mais
    if (!r.conta && (fase === 'guardado' || (fase === 'premio' && ganho?.cupom))) {
      setGanho(null)
      setSemPremio(null)
      setQuartos(0)
      setRodada((n) => n + 1)
      setFase(faseBase(r))
      focar(FOCO_JOGO)
      return
    }
    if (fase === 'convite' || fase === 'bloqueado' || fase === 'espera') {
      const b = faseBase(r)
      if (b !== fase && b !== 'premio') setFase(b)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, fase])

  // troca de tela (fora da revelação): a coluna volta pro topo
  useEffect(() => {
    if (fase !== 'revelando' && fase !== 'girando') corpoCasca?.scrollTo({ top: 0 })
  }, [fase, corpoCasca])

  /* ───────────── subtela (cadastro/entrar): o voltar e o Esc voltam pra tela de onde veio ───────────── */
  const voltarDoCadastro = useCallback(() => {
    setFase(voltaDe === 'cadastro' || voltaDe === 'entrar' ? faseBase(r) : voltaDe)
    focar(FOCO_JOGO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voltaDe, r])
  const naSubtela = fase === 'cadastro' || fase === 'entrar'
  const { definirSubtela } = casca
  useEffect(() => {
    definirSubtela(naSubtela ? voltarDoCadastro : null)
  }, [naSubtela, voltarDoCadastro, definirSubtela])
  useEffect(() => () => definirSubtela(null), [definirSubtela])

  // o foco vai pro título do formulário ("Cria tua conta"): o leitor de tela anuncia a tela nova
  const irParaCadastro = (modo: 'cadastro' | 'entrar', de: Fase) => {
    setVoltaDe(de)
    // na volta, o story aparece pronto (o produto não sintoniza de novo)
    setSintonia('pronto')
    const ir = () => {
      setFase(modo)
      focar(FOCO_JOGO)
    }
    const el = story.current
    if (el && !reduzido && de === 'premio') gsap.to(el, { y: -16, opacity: 0, duration: 0.2, ease: 'app', onComplete: ir })
    else ir()
  }

  /* ───────────── gesto ───────────── */
  const abrir = useCallback(async () => {
    if (abrindo.current) return
    abrindo.current = true
    setVivo(T.vivoAbriu)
    vibrar('estalo')
    const rotor = refs.rotor.current
    if (rotor) tlEstalo.current = estalo(rotor, refs.anel.current, gesto.angulo(), reduzido, gesto.definirAngulo)
    const res = await adaptador.girar(ID_SORTE, { uf })
    const premio = res.ok ? premioPorId(res.valor.premioId) : undefined
    if (!res.ok || !premio) {
      const giro = await adaptador.giroDisponivel(ID_SORTE)
      abrindo.current = false
      avisar(T.erroGiro)
      gesto.zerar()
      setQuartos(0)
      setRodada((n) => n + 1)
      setFase(faseBase({ ...rAgora.current, giro }))
      return
    }
    setGanho({ premio, cupom: res.valor.cupom, origem: 'giro' })
    setSintonia('antes')
    setFase('revelando')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uf, reduzido])

  const gesto = useGestoGiro({
    area: refs.palco,
    disco: refs.disco,
    rotor: refs.rotor,
    indicador: refs.indicador,
    ativo: fase === 'convite' || fase === 'girando',
    chave: rodada,
    reduzido,
    aoQuarto: (q) => {
      setQuartos(q)
      if (q === 4) setVivo(T.vivoMetade)
      if (q >= 8) void abrir()
    },
    aoComecar: () => {
      setConvidando(false)
      setFase((f) => (f === 'convite' ? 'girando' : f))
    },
    aoZonaMorta: (d) => setExtra((x) => (d ? 'zona' : x === 'zona' ? null : x)),
    aoParado: (p) => setExtra((x) => (p ? 'parado' : x === 'parado' ? null : x)),
  })

  // setas no disco (+¼ cada, qualquer sentido conta) e Espaço/Enter segurado (contínuo)
  const teclaDisco = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') gesto.girarQuarto(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') gesto.girarQuarto(-1)
    else if (e.key === ' ' || e.key === 'Enter') {
      if (!e.repeat) gesto.continuo(true)
    } else return
    e.preventDefault()
    e.stopPropagation()
  }
  const soltarDisco = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') gesto.continuo(false)
  }
  // Espaço/Enter segurado com o foco no título (onde a camada abre) também gira, como a legenda do desktop promete;
  // o disco e o botão Girar tratam as teclas deles
  const jogandoAgora = fase === 'convite' || fase === 'girando'
  const noTitulo = (e: KeyboardEvent<HTMLDivElement>) => e.target instanceof HTMLElement && (e.target === e.currentTarget || e.target.classList.contains('sorte-h2'))
  const teclaRaiz = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!jogandoAgora || !noTitulo(e) || (e.key !== ' ' && e.key !== 'Enter')) return
    e.preventDefault()
    if (!e.repeat) gesto.continuo(true)
  }
  const soltarRaiz = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!noTitulo(e) || (e.key !== ' ' && e.key !== 'Enter')) return
    e.preventDefault()
    gesto.continuo(false)
  }

  // botão "Girar": toque = +¼ (180 ms); segurar > 350 ms = contínuo; leitor de tela e comando de voz (só click) = +¼.
  // O click que vem logo depois de um toque de verdade é engolido (o toque já girou); o teclado não gera click
  // (preventDefault no Espaço e no Enter), então não marca nada.
  const segurar = useRef<{ timer: number; longo: boolean; ativo: boolean }>({ timer: 0, longo: false, ativo: false })
  const pulaCliqueAte = useRef(0)
  const apertar = () => {
    const s = segurar.current
    if (s.ativo) return
    s.ativo = true
    s.longo = false
    s.timer = window.setTimeout(() => {
      s.longo = true
      gesto.continuo(true)
    }, 350)
  }
  const soltar = () => {
    const s = segurar.current
    if (!s.ativo) return
    s.ativo = false
    clearTimeout(s.timer)
    if (s.longo) gesto.continuo(false)
    else gesto.girarQuarto(1)
  }
  const botaoGirar = {
    onPointerDown: (e: PointerEventReact<HTMLButtonElement>) => {
      if (!e.isPrimary) return
      pulaCliqueAte.current = 0
      apertar()
    },
    onPointerUp: () => {
      if (!segurar.current.ativo) return
      soltar()
      pulaCliqueAte.current = performance.now() + 600
    },
    onPointerCancel: soltar,
    onPointerLeave: () => segurar.current.ativo && soltar(),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!e.repeat) apertar()
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        soltar()
      }
    },
    onClick: () => {
      if (performance.now() < pulaCliqueAte.current) {
        pulaCliqueAte.current = 0
        return
      }
      gesto.girarQuarto(1)
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }

  /* ───────────── revelação ───────────── */
  const coletar = (): ElementosRevelacao | null => {
    const p = refs
    if (!quadro.current || !cobertura.current) return null
    const palco = p.palco.current
    if (!palco || !p.anel.current || !p.corpo.current || !p.labio.current || !p.boca.current || !p.tampa.current || !p.lado.current || !p.disco.current || !p.rotor.current || !p.indicador.current) return null
    return {
      palco,
      anel: p.anel.current,
      corpo: p.corpo.current,
      labio: p.labio.current,
      boca: p.boca.current,
      tampa: p.tampa.current,
      lado: p.lado.current,
      disco: p.disco.current,
      rotor: p.rotor.current,
      indicador: p.indicador.current,
      sumir: [...(raiz.current?.querySelectorAll('[data-some]') ?? [])],
      subir: subirNaRevelacao(raiz.current),
      alturaIntro: alturaDe(raiz.current?.querySelector<HTMLElement>('.sorte-intro')),
      quadro: quadro.current,
      cobertura: cobertura.current,
      pe: pe.current,
      segAbrir: segAbrir.current,
      segPremio: segPremio.current,
      cromo: cromo.current,
    }
  }

  /** O story pronto, sem o palco (prêmio reservado, guardado, depois da revelação). */
  const coletarStory = (): ElementosRevelacao | null => {
    if (!quadro.current || !cobertura.current) return null
    const nada = document.createElement('i')
    return {
      palco: nada,
      anel: nada,
      corpo: nada,
      labio: nada,
      boca: nada,
      tampa: nada,
      lado: nada,
      disco: nada,
      rotor: nada,
      indicador: nada,
      sumir: [],
      subir: [],
      alturaIntro: 0,
      quadro: quadro.current,
      cobertura: cobertura.current,
      pe: pe.current,
      segAbrir: segAbrir.current,
      segPremio: segPremio.current,
      cromo: cromo.current,
    }
  }

  useLayoutEffect(() => {
    if (fase !== 'revelando') return
    casca.corpo?.scrollTo({ top: 0 })
    // o story já no tamanho certo (as ações acabaram de montar) antes de medir o quadro pro mergulho
    ajustarStory()
    const el = coletar()
    if (!el) {
      setSintonia('pronto')
      setFase('premio')
      return
    }
    // onde o dedo girava (antes de qualquer transform da revelação): ver "pular" abaixo
    const area = refs.palco.current?.getBoundingClientRect() ?? null
    const tl = montarRevelacao(el, {
      reduzido,
      leve: modoLeve(),
      aoSintonizar: () => setSintonia(reduzido ? 'pronto' : 'agora'),
      aoFim: () => {
        abrindo.current = false
        if (reduzido) setSintonia('pronto')
        // leitor de tela: o resultado, numa frase (a região viva fala só na metade, no "Abriu!" e aqui)
        const d = ganho ? dadosDe(ganho.premio, ganho.cupom) : null
        if (d) setVivo(T.vivoSaiu(nomeDoPremio({ titulo: d.titulo, aplicaA: d.aplicaA, ...d.valor }), d.regra, d.demo && config.carimboDeExemplo))
        setFase('premio')
        // o story deixa de ser inerte no render da fase nova; o foco vai pro destaque no quadro seguinte
        focar(`#${idTitulo}`)
      },
    })
    tlRev.current = tl
    // Pular pro fim: só um toque de verdade (sem arrasto) fora de onde o dichavador estava, e só depois que a câmera já
    // começou a mergulhar (PULAR_DESDE). Quem gira com o polegar em vários toques dá mais um por reflexo quando abre:
    // esse toque cai no lugar da tampa (ou vem cedo demais) e não pode engolir a revelação. A área é medida agora,
    // antes da cena subir. O clique desse toque não aperta botão nenhum.
    const corpo = casca.corpo
    const naArea = (x: number, y: number) => !!area && x >= area.left && x <= area.right && y >= area.top && y <= area.bottom
    let inicio: { x: number; y: number; id: number } | null = null
    const desce = (e: PointerEvent) => {
      inicio = e.isPrimary && !naArea(e.clientX, e.clientY) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null
    }
    const sobe = (e: PointerEvent) => {
      const i = inicio
      inicio = null
      if (!i || e.pointerId !== i.id || Math.hypot(e.clientX - i.x, e.clientY - i.y) > 10) return
      if (tl.time() < PULAR_DESDE || tl.time() >= PULAR_ATE) return
      tl.progress(1)
      setSintonia('pronto')
      const engole = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      corpo?.addEventListener('click', engole, { capture: true, once: true })
      window.setTimeout(() => corpo?.removeEventListener('click', engole, { capture: true }), 600)
    }
    const cancela = () => {
      inicio = null
    }
    corpo?.addEventListener('pointerdown', desce)
    corpo?.addEventListener('pointerup', sobe)
    corpo?.addEventListener('pointercancel', cancela)
    return () => {
      corpo?.removeEventListener('pointerdown', desce)
      corpo?.removeEventListener('pointerup', sobe)
      corpo?.removeEventListener('pointercancel', cancela)
      tl.kill()
      tlEstalo.current?.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase])

  // prêmio, guardado (sem animação de revelação): o story pronto de uma vez
  useLayoutEffect(() => {
    if (fase !== 'premio' && fase !== 'guardado') return
    if (tlRev.current?.isActive()) return
    const el = coletarStory()
    if (el) pintarFinal(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, rodada, ganho])

  // fora do story, o cromo do jogo (Girar, Abrir, Prêmio) volta
  const comStory = !!ganho && (fase === 'revelando' || fase === 'premio' || fase === 'guardado')
  useLayoutEffect(() => {
    if (!comStory && cromo.current) gsap.set(cromo.current, { clearProps: 'opacity,visibility' })
  }, [comStory])

  // celular deitado (o story rola à esquerda): o código liberado entra na tela, sem esconder o topo do story à toa
  useEffect(() => {
    if ((fase !== 'premio' && fase !== 'guardado') || !ganho?.cupom || medida?.modo !== 'lado') return
    const c = casca.corpo
    const cod = quadro.current?.querySelector<HTMLElement>('[data-codigo]')
    if (!c || !cod) return
    const id = requestAnimationFrame(() => {
      const falta = cod.getBoundingClientRect().bottom - (c.getBoundingClientRect().bottom - 12)
      if (falta > 0) c.scrollBy({ top: falta, behavior: reduzido ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, ganho, medida?.modo])

  // guardou agora: o cadeado do adesivo do código treme, abre e o adesivo vira (degraus) mostrando o código
  useLayoutEffect(() => {
    if (fase !== 'guardado' || !destrava) return
    const cx = quadro.current?.querySelector<HTMLElement>('[data-codigo]')
    const ct = quadro.current?.querySelector<HTMLElement>('[data-contagem]')
    if (!cx || reduzido) {
      setDestrava(null)
      return
    }
    if (destrava === 'trancado') {
      const tl = gsap.timeline({ delay: 0.3, onComplete: () => setDestrava('abrindo') })
      tl.to(cx, { x: -3, duration: 0.04, ease: 'steps(1)', repeat: 3, yoyo: true }, 0)
      tl.call(() => {
        cx.classList.add('abrindo')
        vibrar('estalo')
      }, [], 0.16)
      tl.set(cx, { x: 0 }, 0.16)
      tl.to([cx, ct], { scaleY: 0.1, duration: 0.08, ease: 'steps(2)' }, 0.34)
      return () => {
        tl.kill()
      }
    }
    // abrindo: o React já trocou pra face do código; volta a abrir e as letras entram uma a uma
    cx.classList.remove('abrindo')
    const letras = cx.querySelectorAll('[data-letras] > span')
    const tl = gsap.timeline({ onComplete: () => setDestrava(null) })
    tl.fromTo([cx, ct], { scaleY: 0.1 }, { scaleY: 1, duration: 0.08, ease: 'steps(2)', clearProps: 'transform' }, 0)
    if (letras.length) tl.fromTo(letras, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.001, stagger: 0.045 }, 0.06)
    tl.call(() => vibrar('mosaico'), [], 0.06)
    return () => {
      tl.kill()
      gsap.set([cx, ct, ...letras], { clearProps: 'transform,opacity,visibility' })
    }
  }, [fase, destrava, reduzido])

  // cadastro: o formulário sobe (app)
  useLayoutEffect(() => {
    if (!naSubtela || reduzido) return
    const f = raiz.current?.querySelector('.sorte-form')
    const faixa = raiz.current?.querySelector('.faixa-premio')
    if (f) gsap.fromTo(f, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: 'app', clearProps: 'transform,opacity' })
    if (faixa) gsap.fromTo(faixa, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.16, ease: 'steps(2)', clearProps: 'transform,opacity' })
  }, [naSubtela, reduzido, fase])

  /* ───────────── depois de criar conta / entrar ───────────── */
  // Só conta o cupom que o adaptador acabou de guardar (o prêmio reservado). Um cupom velho da conta (até usado)
  // nunca aparece como recém-guardado.
  const depoisDaConta = async ({ conta: c, cupomGuardado }: ContaAberta, modo: ModoForm) => {
    if (cupomGuardado) {
      const premio = premioPorId(cupomGuardado.premioId) ?? ganho?.premio
      if (premio) setGanho({ premio, cupom: cupomGuardado, origem: 'conta' })
      setSemPremio(null)
      setRodada((n) => n + 1)
      setSintonia('pronto')
      setDestrava(reduzido ? null : 'trancado')
      setFase('guardado')
      setVivo(T.vivoGuardado(cupomGuardado.codigo, formatarValidade(cupomGuardado.validoAte)))
      focar(FOCO_FASE)
      return
    }
    if (ganho && !ganho.cupom && modo !== 'editar') avisar(T.premioVencidoAoGuardar)
    setGanho(null)
    if (modo === 'entrar') {
      const giro = await adaptador.giroDisponivel(ID_SORTE)
      avisar(T.entrou(primeiroNome(c.nome)))
      setRodada((n) => n + 1)
      setFase(faseBase({ conta: c, pendenteValido: false, giro }))
      focar(FOCO_JOGO)
    } else {
      setSemPremio({ nome: primeiroNome(c.nome) })
      setRodada((n) => n + 1)
      setFase('guardado')
      focar(FOCO_FASE)
    }
  }

  const usarAgora = (codigo: string) => {
    casca.fechar()
    usarNoPedido(codigo)
  }

  const agoraNao = () => {
    const exp = r.pendente?.expiraEm
    casca.fechar()
    if (exp) avisar(T.avisoAgoraNao(formatarAte(exp, Date.now())))
  }

  const girarDeNovo = () => {
    gesto.zerar()
    setQuartos(0)
    setExtra(null)
    setGanho(null)
    setSemPremio(null)
    setConvidando(true)
    setRodada((n) => n + 1)
    setFase('convite')
    focar(FOCO_JOGO)
  }

  /* ───────────── composição ───────────── */
  const dados = ganho ? dadosDe(ganho.premio, ganho.cupom) : null
  const jogando = fase === 'convite' || fase === 'girando'
  const temPalco = jogando || fase === 'revelando' || fase === 'espera' || fase === 'bloqueado'
  const modoPalco = fase === 'espera' ? 'parado' : fase === 'bloqueado' ? 'travado' : 'girar'
  const legenda = fase === 'convite' ? (desktop ? T.legendaDesktop : T.legendaCelular) : extra === 'zona' ? T.zonaMorta : extra === 'parado' ? T.parado : T.porQuartos(quartos)
  const cheio = fase === 'revelando' ? null : comStory || fase === 'espera' || (naSubtela && !!ganho)
  const comConta = !!r.conta
  const guardadoAgora = fase === 'guardado' && !!ganho?.cupom
  // guardou agora: até o estalo, o story mostra o adesivo ainda trancado
  const cupomNaTela = destrava === 'trancado' ? null : (ganho?.cupom ?? null)
  const reservaTexto = ganho && !ganho.cupom ? T.condReserva(formatarAte(r.pendente?.expiraEm ?? Date.now() + 864e5, r.agora)) : null
  const estiloStory = medida ? ({ '--sw': `${medida.w}px`, '--sh': `${medida.h}px`, '--pe-h': `${medida.pe}px` } as CSSProperties) : undefined

  return (
    <div ref={raiz} className={`sorte sorte-${fase}${comStory ? ' sorte-com-story' : ''}`} onKeyDown={teclaRaiz} onKeyUp={soltarRaiz}>
      <Estrelas parar={reduzido} />
      {casca.cromo &&
        createPortal(
          <div ref={cromo} className="sorte-cromo">
            <span className="sorte-seg">
              <i style={{ transform: `scaleX(${fase === 'revelando' || cheio ? 1 : quartos / 8})` }} />
              <span className="sr-only">{T.segmentos[0]}</span>
            </span>
            <span className="sorte-seg">
              <i ref={segAbrir} style={fase === 'revelando' ? undefined : { transform: `scaleX(${cheio ? 1 : 0})` }} />
              <span className="sr-only">{T.segmentos[1]}</span>
            </span>
            <span className="sorte-seg">
              <i ref={segPremio} style={fase === 'revelando' ? undefined : { transform: `scaleX(${cheio ? 1 : 0})` }} />
              <span className="sr-only">{T.segmentos[2]}</span>
            </span>
          </div>,
          casca.cromo,
        )}

      {!naSubtela && (
        <h2 className={`sorte-h2 px px-24${comStory && fase !== 'revelando' ? ' sr-only' : ''}`} tabIndex={-1} data-foco-jogo>
          {T.tituloPx}
        </h2>
      )}

      {jogando || fase === 'revelando' ? (
        <div className="sorte-intro" data-some>
          <p className="sorte-pergunta adesivo-texto-bloco">
            <span className="adesivo-texto">{T.pergunta}</span>
          </p>
          <p className="sorte-sub">{T.sub}</p>
        </div>
      ) : null}

      {temPalco && (
        <div className="sorte-cena">
          <div className={`sorte-palco-caixa${convidando && fase === 'convite' && !reduzido ? ' convidando' : ''}`}>
            <Palco
              key={rodada}
              refs={refs}
              quartos={quartos}
              modo={modoPalco}
              interativo={jogando}
              aoTecla={teclaDisco}
              aoSoltarTecla={soltarDisco}
              convite={fase === 'convite' && convidando}
            />
          </div>
        </div>
      )}

      {(jogando || fase === 'revelando') && (
        <div className="sorte-controles" data-some>
          <p className="sorte-legenda" aria-hidden="true">
            {legenda}
          </p>
          <button type="button" className="botao botao-contorno sorte-girar toque" aria-label={T.ariaGirar} disabled={fase === 'revelando'} {...botaoGirar}>
            <Icone nome="giro" tamanho={16} />
            {T.botaoGirar}
          </button>
          <div className="sorte-rodape legenda">
            <p>{T.todoGiroGanha}</p>
            <p>{T.limites}</p>
            <Regras />
          </div>
          <p className="legenda sorte-nota">{T.contaLocal}</p>
        </div>
      )}

      {/* o story do prêmio: na revelação fica por cima de tudo, já no lugar final (o mergulho mira nele); depois, no
          fluxo, no mesmo lugar. As ações ficam no pé dele (embaixo ou por cima do pé, conforme a tela) */}
      {comStory && dados && ganho && (
        <div ref={story} className="sorte-story" style={estiloStory} data-modo={medida?.modo}>
          <StoryPremio
            key={`${rodada}-${ganho.premio.id}`}
            dados={dados}
            cupom={cupomNaTela}
            idTitulo={idTitulo}
            instagram={instagram}
            sintonia={fase === 'revelando' ? sintonia : sintonia === 'agora' && fase === 'premio' ? 'agora' : 'pronto'}
            agora={r.agora}
            postadoEm={ganho.origem === 'pendente' ? (r.pendente?.sorteadoEm ?? null) : null}
            reserva={reservaTexto}
            aoGuardar={fase === 'premio' && !ganho.cupom ? () => irParaCadastro('cadastro', 'premio') : undefined}
            inerte={fase === 'revelando'}
            refs={{ quadro, cobertura }}
          />
          <div ref={pe} className="sorte-pe" inert={fase === 'revelando'}>
            {guardadoAgora || (comConta && ganho.cupom) ? (
              <>
                {guardadoAgora ? (
                  <p className="sorte-pe-nota sorte-fechou" tabIndex={-1} data-foco-fase>
                    {T.fechou(primeiroNome(r.conta?.nome))}
                  </p>
                ) : (
                  <p className="sorte-pe-nota legenda">{T.naConta}</p>
                )}
                <div className="sorte-pe-botoes">
                  <button type="button" className="botao botao-cheio botao-largo" onClick={() => usarAgora(ganho.cupom!.codigo)}>
                    {T.usarAgora}
                  </button>
                  <button type="button" className="botao botao-contorno botao-largo" onClick={() => setConta(true)}>
                    {T.verCupons}
                  </button>
                </div>
              </>
            ) : (
              <>
                {ganho.origem === 'pendente' && r.pendente && <p className="sorte-pe-nota legenda">{T.esperando(formatarAte(r.pendente.expiraEm, r.agora))}</p>}
                <div className="sorte-pe-botoes">
                  <button type="button" className="botao botao-cheio botao-largo" onClick={() => irParaCadastro('cadastro', 'premio')}>
                    {T.guardar}
                  </button>
                  <div className="sorte-barra-linha">
                    <p className="legenda">{T.soNomeZap}</p>
                    <button type="button" className="botao-texto toque" onClick={agoraNao}>
                      {T.agoraNao}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {fase === 'guardado' && semPremio && (
        <div className="sorte-bloco">
          <Icone nome="conta" tamanho={48} className="sorte-bloco-icone" />
          <p className="sorte-fechou" tabIndex={-1} data-foco-fase>
            {T.contaCriada(semPremio.nome)}
          </p>
          {r.giro.disponivel ? (
            <>
              <p>{T.giroLiberado}</p>
              <button type="button" className="botao botao-cheio botao-largo" onClick={girarDeNovo}>
                <Icone nome="giro" tamanho={16} />
                {T.girar}
              </button>
            </>
          ) : (
            <p className="legenda">{T.proximoAmanha}</p>
          )}
        </div>
      )}

      {fase === 'espera' && <Espera r={r} usar={usarAgora} verCupons={() => setConta(true)} />}

      {fase === 'bloqueado' && (
        <div className="sorte-bloco">
          {r.pendenteVencido && r.pendente && <p className="legenda">{T.premioVenceu(formatarDiaSemana(r.pendente.sorteadoEm))}</p>}
          <p className="sorte-fechou">{T.giroJaFoi}</p>
          {r.giro.disponivel === false && r.giro.motivo === 'sem-conta-ja-girou' && r.giro.girouHoje ? (
            <>
              <p>{T.criaAmanha}</p>
              <p className="legenda">{T.vantagens}</p>
            </>
          ) : (
            <p>{T.criaAgora}</p>
          )}
          <button type="button" className="botao botao-cheio botao-largo" onClick={() => irParaCadastro('cadastro', 'bloqueado')}>
            {T.criarConta}
          </button>
          <button type="button" className="botao-texto toque" onClick={() => irParaCadastro('entrar', 'bloqueado')}>
            {T.jaTenhoConta}
          </button>
          <p className="legenda sorte-nota">{T.contaLocal}</p>
        </div>
      )}

      {naSubtela && (
        <div className="sorte-cadastro">
          {ganho && dados && !ganho.cupom && <FaixaPremio nome={nomeDoPremio({ titulo: dados.titulo, aplicaA: dados.aplicaA, ...dados.valor })} produto={fraseDoPremio({ titulo: dados.titulo, aplicaA: dados.aplicaA, ...dados.valor }).produto} />}
          <div className="sorte-form">
            <FormConta
              key={fase}
              modo={fase === 'entrar' ? 'entrar' : 'criar'}
              comPremio={!!ganho && !ganho.cupom && r.pendenteValido}
              aoSucesso={depoisDaConta}
              aoTrocarModo={(m) => {
                setFase(m === 'entrar' ? 'entrar' : 'cadastro')
                focar(FOCO_JOGO)
              }}
            />
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {vivo}
      </p>
    </div>
  )
}

/**
 * O que sobe junto quando o texto de cima sai do fluxo no fim da revelação: a cena só quando está embaixo dele (em
 * pé); no celular deitado ela fica na outra coluna e não sai do lugar (subir e voltar no fim dava um salto de ~50 px).
 */
function subirNaRevelacao(raiz: HTMLElement | null): HTMLElement[] {
  if (!raiz) return []
  const intro = raiz.querySelector<HTMLElement>('.sorte-intro')?.getBoundingClientRect()
  return [...raiz.querySelectorAll<HTMLElement>('.sorte-cena')].filter((el) => {
    if (!intro) return true
    const c = el.getBoundingClientRect()
    return c.left < intro.right && c.right > intro.left
  })
}

/** Altura que o elemento ocupa no fluxo (com as margens). */
function alturaDe(el: HTMLElement | null | undefined): number {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
}

/** Com conta e já girou hoje: contagem no molde do adesivo do IG, o cupom do dia e os cupons guardados. */
function Espera({ r, usar, verCupons }: { r: ResumoSorte; usar: (c: string) => void; verCupons: () => void }) {
  const espera = r.giro.disponivel === false && r.giro.motivo === 'ja-girou-hoje' ? formatarEspera(r.giro.proximoEm - r.agora) : 'amanhã'
  const hoje = r.deHoje
  const premioHoje = hoje ? fraseDoPremio(hoje.retrato) : null
  return (
    <div className="sorte-bloco">
      <div className="sorte-contagem" role="img" aria-label={T.ariaProximo}>
        <p className="sorte-contagem-titulo">{T.proximoGiro}</p>
        <p className="sorte-contagem-tempo px">{espera}</p>
      </div>
      <p className="sorte-fechou">{T.hojeJaFoi}</p>
      {hoje && premioHoje && (
        <div className="sorte-mini">
          <BolhaPremio produto={premioHoje.produto} tamanho={56} vista={hoje.status !== 'ativo'} />
          <div className="sorte-mini-txt">
            <p className="legenda">{T.hojeSaiu}</p>
            <p className="sorte-mini-titulo">
              <span className="sorte-mini-valor px">{premioHoje.destaque}</span>
              <span className="sr-only">: </span>
              <span>{premioHoje.alvo}</span>
            </p>
            <AdesivoCodigo codigo={hoje.codigo} apagado={hoje.status !== 'ativo'} />
            {hoje.status === 'ativo' && (
              <button type="button" className="botao botao-contorno sorte-mini-usar" onClick={() => usar(hoje.codigo)}>
                {T.usarNoPedido}
              </button>
            )}
          </div>
        </div>
      )}
      <button type="button" className="botao botao-cheio botao-largo" onClick={verCupons}>
        {T.verCuponsN(r.ativos.length)}
      </button>
    </div>
  )
}

/** Estrelas de pixel no fundo preto (3 piscam em steps(2) a cada 2,4 s; paradas com movimento reduzido). */
function Estrelas({ parar }: { parar: boolean }) {
  return (
    <div className={`sorte-estrelas${parar ? ' paradas' : ''}`} aria-hidden="true">
      <i style={{ left: '12%', top: '9%' }} />
      <i style={{ left: '78%', top: '22%' }} />
      <i style={{ left: '30%', top: '61%' }} />
    </div>
  )
}
