import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as PointerEventReact } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import { Icone } from '../../componentes/comum'
import { FormConta, type ModoForm } from '../../componentes/FormConta'
import { config } from '../../dados/config'
import type { Premio } from '../../dados/sorte'
import { primeiroNome, type ContaAberta } from '../../lib/conta'
import { conta as adaptador } from '../../lib/conta-adaptador'
import { formatarAte, formatarDiaSemana, formatarEspera, formatarValidade, nomeDoPremio, papelDo, premioPorId } from '../../lib/cupom'
import { movimentoReduzido, ponteiroFino } from '../../lib/movimento'
import type { Cupom } from '../../store/conta'
import { useLocal } from '../../store/local'
import { useUI } from '../../store/ui'
import { FOCO_JOGO, useCasca } from '../CascaInterativo'
import type { PropsJogo } from '../registro'
import { CartaoPremio, FaixaPremio, type DadosCartao } from './CartaoPremio'
import { ID_SORTE, useEstadoSorte, usarNoPedido, type ResumoSorte } from './estado'
import { Palco, type RefsPalco } from './Palco'
import { Regras } from './Regras'
import { estalo, montarRevelacao, pintarFinal, PULAR_DESDE, type ElementosRevelacao } from './revelar'
import { modoLeve, vibrar } from './tato'
import { T } from './textos'
import { useGestoGiro } from './useGiro'
import './estilo'

// "Teste minha sorte": gira a tampa do dichavador, ele abre, sai um beck bolado e o beck desenrola no cupom.
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

function dadosDe(premio: Premio | undefined, cupom: Cupom | null): DadosCartao | null {
  if (cupom) {
    // guardado: vale a data do cupom (validoAte), não os dias do prêmio
    const r = cupom.retrato
    const p = premio ?? premioPorId(cupom.premioId)
    return { titulo: r.titulo, regra: r.regra, descricao: p?.descricao, comoUsar: r.comoUsar, aplicaA: r.aplicaA, papel: r.papel, demo: cupom.demo, valor: r }
  }
  if (!premio) return null
  return { titulo: premio.titulo, regra: premio.regra, descricao: premio.descricao, comoUsar: premio.comoUsar, aplicaA: premio.aplicaA, papel: papelDo(premio), demo: premio.demo, validadeDias: premio.validadeDias, valor: premio }
}

/** Alvo de foco da tela que acabou de entrar (ex.: "Fechou, Ian. Teu cupom tá guardado."); sem ele, o h2. */
const FOCO_FASE = '[data-foco-fase]'

export default function JogoSorte({ tela }: PropsJogo) {
  const casca = useCasca()
  const r = useEstadoSorte()
  // o resumo mais novo, para quem decide a fase depois de um await (o closure pode ser de um render velho)
  const rAgora = useRef(r)
  rAgora.current = r
  const uf = useLocal((s) => s.uf)
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
  const tlRev = useRef<gsap.core.Timeline | null>(null)
  const tlEstalo = useRef<gsap.core.Timeline | null>(null)
  const abrindo = useRef(false)

  const refs: RefsPalco = {
    palco: useRef<HTMLDivElement>(null),
    anel: useRef<SVGSVGElement>(null),
    corpo: useRef<HTMLDivElement>(null),
    beck: useRef<HTMLDivElement>(null),
    labio: useRef<HTMLDivElement>(null),
    tampa: useRef<HTMLDivElement>(null),
    lado: useRef<HTMLDivElement>(null),
    disco: useRef<HTMLDivElement>(null),
    rotor: useRef<HTMLDivElement>(null),
    indicador: useRef<HTMLDivElement>(null),
    dedo: useRef<HTMLDivElement>(null),
  }
  const raiz = useRef<HTMLDivElement>(null)
  const cartaoPos = useRef<HTMLDivElement>(null)
  const cartao = useRef<HTMLDivElement>(null)
  const rolo = useRef<HTMLDivElement>(null)
  const legBeck = useRef<HTMLDivElement>(null)
  const botoes = useRef<HTMLDivElement>(null)
  const notas = useRef<HTMLDivElement>(null)
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
  const corpoCasca = casca.corpo
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
    const ir = () => {
      setFase(modo)
      focar(FOCO_JOGO)
    }
    const el = cartaoPos.current
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
    if (!p.palco.current || !p.anel.current || !p.corpo.current || !p.labio.current || !p.tampa.current || !p.lado.current || !p.disco.current || !p.rotor.current || !p.indicador.current || !p.beck.current) return null
    if (!cartaoPos.current || !cartao.current || !rolo.current) return null
    return {
      palco: p.palco.current,
      anel: p.anel.current,
      corpo: p.corpo.current,
      labio: p.labio.current,
      tampa: p.tampa.current,
      lado: p.lado.current,
      disco: p.disco.current,
      rotor: p.rotor.current,
      indicador: p.indicador.current,
      beck: p.beck.current,
      legBeck: legBeck.current,
      sumir: [...(raiz.current?.querySelectorAll('[data-some]') ?? [])],
      subir: subirNaRevelacao(raiz.current),
      alturaIntro: alturaDe(raiz.current?.querySelector<HTMLElement>('.sorte-intro')),
      cartaoPos: cartaoPos.current,
      cartao: cartao.current,
      rolo: rolo.current,
      // os filhos entram (y 12→0); o contêiner sobe junto com a cena (transforms separados)
      botoes: [...(botoes.current?.children ?? []), ...(notas.current?.children ?? [])],
      segAbrir: segAbrir.current,
      segPremio: segPremio.current,
    }
  }

  useLayoutEffect(() => {
    if (fase !== 'revelando') return
    casca.corpo?.scrollTo({ top: 0 })
    const el = coletar()
    if (!el) {
      setFase('premio')
      return
    }
    // onde o dedo girava (antes de qualquer transform da revelação): ver "pular" abaixo
    const area = refs.palco.current?.getBoundingClientRect() ?? null
    const tl = montarRevelacao(el, {
      reduzido,
      leve: modoLeve(),
      aoFoco: () => focar(`#${idTitulo}`),
      aoFim: () => {
        abrindo.current = false
        // leitor de tela: o resultado, numa frase (a região viva fala só na metade, no "Abriu!" e aqui)
        const d = ganho ? dadosDe(ganho.premio, ganho.cupom) : null
        if (d) setVivo(T.vivoSaiu(nomeDoPremio({ titulo: d.titulo, aplicaA: d.aplicaA, ...d.valor }), d.regra, d.demo && config.carimboDeExemplo))
        setFase('premio')
      },
    })
    tlRev.current = tl
    // Pular pro fim: só um toque de verdade (sem arrasto) fora de onde o dichavador estava, e só depois que o beck já
    // saiu (PULAR_DESDE). Quem gira com o polegar em vários toques dá mais um por reflexo quando abre: esse toque cai
    // no lugar da tampa (ou vem cedo demais) e não pode engolir o beck desenrolando. A área é medida agora, antes da
    // cena subir (a tampa invisível e o cartão passam por cima de outras partes da tela). O clique desse toque não
    // aperta botão nenhum.
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
      if (tl.time() < PULAR_DESDE || tl.time() >= 2.7) return
      tl.progress(1)
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

  // prêmio, guardado (sem animação de revelação): estado final de uma vez
  useLayoutEffect(() => {
    if (fase !== 'premio' && fase !== 'guardado') return
    if (tlRev.current?.isActive()) return
    const el = coletar()
    if (el) pintarFinal(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, rodada, ganho])

  // celular baixo: na revelação a barra dos botões ficou abaixo da dobra; no prêmio ela gruda no pé da tela e entra
  // subindo (app). Em tela alta ela já apareceu no lugar dela (aos 2,7 s) e não se mexe.
  useLayoutEffect(() => {
    if (fase !== 'premio' && fase !== 'guardado') return
    const b = raiz.current?.querySelector<HTMLElement>('.sorte-barra')
    const c = casca.corpo
    if (!b || !c || reduzido) return
    if (b.getBoundingClientRect().bottom < c.getBoundingClientRect().bottom - 2) return
    const tw = gsap.fromTo(b, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.26, ease: 'app', clearProps: 'transform,opacity' })
    return () => {
      tw.kill()
      gsap.set(b, { clearProps: 'transform,opacity' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase])

  // código liberado (com conta, ou guardado agora) nunca fica atrás da barra grudada no pé: rola só o que falta pra
  // linha do código aparecer acima dela, sem tirar o topo do cartão da tela. Deitado (barra ao lado), o pé da coluna.
  useEffect(() => {
    if ((fase !== 'premio' && fase !== 'guardado') || !ganho?.cupom) return
    const c = casca.corpo
    const pos = cartaoPos.current
    const cod = cartao.current?.querySelector<HTMLElement>('[data-codigo]')
    if (!c || !pos || !cod) return
    const id = requestAnimationFrame(() => {
      const area = c.getBoundingClientRect()
      const k = cod.getBoundingClientRect()
      const b = raiz.current?.querySelector<HTMLElement>('.sorte-barra')
      const br = b?.getBoundingClientRect()
      // a barra pode estar entrando (y +16): a altura dela basta, e o degradê de cima também cobre (20 px)
      const cobre = !!b && !!br && getComputedStyle(b).position === 'sticky' && br.left < k.right && br.right > k.left && br.bottom >= area.bottom - 20
      const limite = (cobre && b ? area.bottom - b.offsetHeight - 20 : area.bottom) - 8
      const falta = k.bottom - limite
      const folga = pos.getBoundingClientRect().top - area.top - 8
      if (falta > 0 && folga > 0) c.scrollBy({ top: Math.min(falta, folga), behavior: reduzido ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, ganho])

  // guardado com cupom: o mosaico dissolve em 4 degraus e mostra o código; o carimbo GUARDADO bate
  const [mosaico, setMosaico] = useState(true)
  useLayoutEffect(() => {
    if (fase !== 'guardado' || !ganho?.cupom) return
    const c = cartao.current
    const tiles = c?.querySelectorAll('[data-mosaico] > i')
    const carimbo = c?.querySelector('[data-guardado]')
    if (reduzido || !tiles?.length) {
      setMosaico(false)
      return
    }
    setMosaico(true)
    const tl = gsap.timeline({ delay: 0.25, onComplete: () => setMosaico(false) })
    tl.call(() => vibrar('mosaico'), [], 0)
    tl.to(tiles, { opacity: 0, duration: 0.24, ease: 'steps(4)', stagger: 0.03 }, 0)
    if (carimbo) tl.fromTo(carimbo, { scale: 1.4, rotation: -6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.16, ease: 'steps(2)' }, 0.1)
    return () => {
      tl.kill()
    }
  }, [fase, ganho, reduzido])

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
  const comCartao = !!dados && (fase === 'revelando' || fase === 'premio' || fase === 'guardado')
  const jogando = fase === 'convite' || fase === 'girando'
  const temCena = !naSubtela && !(fase === 'guardado' && semPremio)
  const modoPalco = fase === 'espera' ? 'parado' : fase === 'bloqueado' ? 'travado' : 'girar'
  const legenda = fase === 'convite' ? (desktop ? T.legendaDesktop : T.legendaCelular) : extra === 'zona' ? T.zonaMorta : extra === 'parado' ? T.parado : T.porQuartos(quartos)
  const cheio = fase === 'revelando' ? null : comCartao || fase === 'espera' || (naSubtela && !!ganho)
  const papel = dados?.papel ?? 'natural'
  const comConta = !!r.conta

  return (
    <div ref={raiz} className={`sorte sorte-${fase}`} onKeyDown={teclaRaiz} onKeyUp={soltarRaiz}>
      <Estrelas parar={reduzido} />
      {casca.cromo &&
        createPortal(
          <div className="sorte-cromo">
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
        <h2 className="sorte-h2 px px-24" tabIndex={-1} data-foco-jogo>
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

      {fase === 'premio' && ganho?.origem === 'pendente' && <p className="sorte-esperando px px-16">{T.esperando}</p>}

      {temCena && (
        <div className={`sorte-cena${comCartao ? ' com-cartao' : ''}`}>
          <div className={`sorte-palco-caixa${convidando && fase === 'convite' && !reduzido ? ' convidando' : ''}`}>
            <Palco
              key={rodada}
              refs={refs}
              quartos={quartos}
              modo={modoPalco}
              interativo={jogando}
              papel={papel}
              aoTecla={teclaDisco}
              aoSoltarTecla={soltarDisco}
              convite={fase === 'convite' && convidando}
            />
          </div>
          {fase === 'revelando' && (
            <div ref={legBeck} className="sorte-leg-beck" aria-hidden="true">
              <p className="px px-16">{T.saiuBolado}</p>
              <p className="legenda">{T.soPapel}</p>
            </div>
          )}
          {comCartao && dados && (
            <CartaoPremio
              key={`${rodada}-${ganho?.cupom?.codigo ?? 'sem'}`}
              dados={dados}
              cupom={ganho?.cupom ?? null}
              idTitulo={idTitulo}
              refs={{ pos: cartaoPos, cartao, rolo }}
              mosaico={fase === 'guardado' && mosaico}
              guardado={fase === 'guardado'}
              reserva={ganho && !ganho.cupom ? T.condReserva(formatarAte(r.pendente?.expiraEm ?? Date.now() + 864e5, r.agora)) : null}
            />
          )}
        </div>
      )}

      {/* prêmio: a barra dos botões gruda no pé da tela (celular baixo, navegador do Instagram) e nada vem depois dela
          (deitado, ela gruda no topo da coluna da direita); a reserva sem conta fica no "Ver condições" */}
      {(fase === 'revelando' || fase === 'premio') && ganho && (
        <>
          {comConta && ganho.cupom && (
            <div ref={notas} className="sorte-acoes" inert={fase === 'revelando'}>
              <p className="legenda sorte-nota">{T.naConta}</p>
            </div>
          )}
          <div ref={botoes} className="sorte-barra" inert={fase === 'revelando'}>
            {comConta && ganho.cupom ? (
              <>
                <button type="button" className="botao botao-cheio botao-largo" onClick={() => usarAgora(ganho.cupom!.codigo)}>
                  {T.usarAgora}
                </button>
                <button type="button" className="botao botao-contorno botao-largo" onClick={() => setConta(true)}>
                  {T.verCupons}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="botao botao-cheio botao-largo" onClick={() => irParaCadastro('cadastro', 'premio')}>
                  {T.guardar}
                </button>
                <div className="sorte-barra-linha">
                  <p className="legenda">{T.soNomeZap}</p>
                  <button type="button" className="botao-texto toque" onClick={agoraNao}>
                    {T.agoraNao}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
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

      {fase === 'guardado' && ganho?.cupom && (
        <>
          <div className="sorte-acoes">
            <p className="sorte-fechou" tabIndex={-1} data-foco-fase>
              {T.fechou(primeiroNome(r.conta?.nome))}
            </p>
            <p className="legenda">{T.guardadoNota(formatarValidade(ganho.cupom.validoAte))}</p>
          </div>
          <div className="sorte-barra">
            <button type="button" className="botao botao-cheio botao-largo" onClick={() => usarAgora(ganho.cupom!.codigo)}>
              {T.usarAgora}
            </button>
            <button type="button" className="botao botao-contorno botao-largo" onClick={() => setConta(true)}>
              {T.verCupons}
            </button>
          </div>
        </>
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
          {ganho && dados && !ganho.cupom && <FaixaPremio nome={nomeDoPremio({ titulo: dados.titulo, aplicaA: dados.aplicaA, ...dados.valor })} papel={dados.papel} />}
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
  return [...raiz.querySelectorAll<HTMLElement>('.sorte-cena, .sorte-barra, .sorte-acoes')].filter((el) => {
    if (!el.classList.contains('sorte-cena') || !intro) return true
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
  return (
    <div className="sorte-bloco">
      <div className="sorte-contagem" role="img" aria-label={T.ariaProximo}>
        <p className="px px-16">{T.proximoGiro}</p>
        <p className="px px-24">{espera}</p>
      </div>
      <p className="sorte-fechou">{T.hojeJaFoi}</p>
      {hoje && (
        <div className="sorte-mini">
          <p className="legenda">{T.hojeSaiu}</p>
          <p className="sorte-mini-titulo">{nomeDoPremio(hoje.retrato)}</p>
          <p className="px px-20">{hoje.codigo}</p>
          {hoje.status === 'ativo' && (
            <button type="button" className="botao botao-contorno" onClick={() => usar(hoje.codigo)}>
              {T.usarNoPedido}
            </button>
          )}
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
