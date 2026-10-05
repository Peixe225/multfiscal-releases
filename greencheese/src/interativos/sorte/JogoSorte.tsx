import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as PointerEventReact } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import { Icone } from '../../componentes/comum'
import { FormConta, type ModoForm } from '../../componentes/FormConta'
import { config } from '../../dados/config'
import type { Premio } from '../../dados/sorte'
import { calcularGiro, conta as adaptador, primeiroNome } from '../../lib/conta'
import { formatarAte, formatarDiaSemana, formatarEspera, formatarValidade, papelDo, premioPorId } from '../../lib/cupom'
import { movimentoReduzido, ponteiroFino } from '../../lib/movimento'
import { useContaStore, type Cupom } from '../../store/conta'
import { useLocal } from '../../store/local'
import { useUI } from '../../store/ui'
import { FOCO_JOGO, useCasca } from '../CascaInterativo'
import type { PropsJogo } from '../registro'
import { CartaoPremio, FaixaPremio, type DadosCartao } from './CartaoPremio'
import { ID_SORTE, useEstadoSorte, usarNoPedido, type ResumoSorte } from './estado'
import { Palco, type RefsPalco } from './Palco'
import { Regras } from './Regras'
import { estalo, montarRevelacao, pintarFinal, type ElementosRevelacao } from './revelar'
import { modoLeve, vibrar } from './tato'
import { T } from './textos'
import { useGestoGiro } from './useGiro'
import './sorte.css'

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
    const r = cupom.retrato
    const p = premio ?? premioPorId(cupom.premioId)
    return { titulo: r.titulo, regra: r.regra, descricao: p?.descricao, comoUsar: r.comoUsar, aplicaA: r.aplicaA, papel: r.papel, demo: cupom.demo, validadeDias: p?.validadeDias ?? 7, valor: r }
  }
  if (!premio) return null
  return { titulo: premio.titulo, regra: premio.regra, descricao: premio.descricao, comoUsar: premio.comoUsar, aplicaA: premio.aplicaA, papel: papelDo(premio), demo: premio.demo, validadeDias: premio.validadeDias, valor: premio }
}

/** O cupom mais novo do Sorte na conta aberta, ganho depois de `desde`. */
function cupomNovo(desde: number): Cupom | null {
  const s = useContaStore.getState()
  const cupons = s.atual ? (s.contas[s.atual]?.cupons ?? []) : []
  return cupons.filter((c) => c.interativo === ID_SORTE && c.ganhoEm >= desde).sort((a, b) => b.ganhoEm - a.ganhoEm)[0] ?? null
}

export default function JogoSorte({ tela }: PropsJogo) {
  const casca = useCasca()
  const r = useEstadoSorte()
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
  const desdeCadastro = useRef(0)
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
  const segAbrir = useRef<HTMLElement>(null)
  const segPremio = useRef<HTMLElement>(null)
  const idTitulo = `sorte-titulo-${rodada}`

  const focar = useCallback((sel: string) => {
    requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }))
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

  const irParaCadastro = (modo: 'cadastro' | 'entrar', de: Fase) => {
    desdeCadastro.current = Date.now()
    setVoltaDe(de)
    const el = cartaoPos.current
    if (el && !reduzido && de === 'premio') {
      gsap.to(el, { y: -16, opacity: 0, duration: 0.2, ease: 'app', onComplete: () => setFase(modo) })
    } else setFase(modo)
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
      abrindo.current = false
      avisar(T.erroGiro)
      gesto.zerar()
      setQuartos(0)
      setRodada((n) => n + 1)
      setFase(faseBase(estadoAgora()))
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

  // botão "Girar": toque = +¼ (180 ms); segurar > 350 ms = contínuo; leitor de tela (só click) = +¼
  const segurar = useRef<{ timer: number; longo: boolean; ativo: boolean }>({ timer: 0, longo: false, ativo: false })
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
    pulaClique.current = true
  }
  const pulaClique = useRef(false)
  const botaoGirar = {
    onPointerDown: (e: PointerEventReact<HTMLButtonElement>) => {
      if (e.isPrimary) apertar()
    },
    onPointerUp: soltar,
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
      if (pulaClique.current) {
        pulaClique.current = false
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
      subir: [...(raiz.current?.querySelectorAll<HTMLElement>('.sorte-cena, .sorte-acoes') ?? [])],
      alturaIntro: alturaDe(raiz.current?.querySelector<HTMLElement>('.sorte-intro')),
      cartaoPos: cartaoPos.current,
      cartao: cartao.current,
      rolo: rolo.current,
      // os filhos entram (y 12→0); o contêiner sobe junto com a cena (transforms separados)
      botoes: botoes.current ? [...botoes.current.children] : [],
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
    const tl = montarRevelacao(el, {
      reduzido,
      leve: modoLeve(),
      aoFoco: () => focar(`#${idTitulo}`),
      aoFim: () => {
        abrindo.current = false
        // leitor de tela: o resultado, numa frase (a região viva fala só na metade, no "Abriu!" e aqui)
        const d = ganho ? dadosDe(ganho.premio, ganho.cupom) : null
        if (d) setVivo(T.vivoSaiu(d.titulo, d.regra, d.demo && config.modoPrevia))
        setFase('premio')
      },
    })
    tlRev.current = tl
    // tocar em qualquer lugar até 2,7 s pula pro fim (e o clique desse toque não aperta botão nenhum)
    const corpo = casca.corpo
    const pular = () => {
      if (tl.time() >= 2.7) return
      tl.progress(1)
      const engole = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
      }
      corpo?.addEventListener('click', engole, { capture: true, once: true })
      window.setTimeout(() => corpo?.removeEventListener('click', engole, { capture: true }), 600)
    }
    corpo?.addEventListener('pointerdown', pular)
    return () => {
      corpo?.removeEventListener('pointerdown', pular)
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
  const depoisDaConta = (c: { nome: string }, modo: ModoForm) => {
    const novo = cupomNovo(desdeCadastro.current)
    if (novo) {
      const premio = premioPorId(novo.premioId) ?? ganho?.premio
      if (premio) setGanho({ premio, cupom: novo, origem: 'conta' })
      setSemPremio(null)
      setRodada((n) => n + 1)
      setFase('guardado')
      focar(FOCO_JOGO)
      return
    }
    if (ganho && !ganho.cupom && modo !== 'editar') avisar(T.premioVencidoAoGuardar)
    setGanho(null)
    if (modo === 'entrar') {
      avisar(T.entrou(primeiroNome(c.nome)))
      setRodada((n) => n + 1)
      setFase(faseBase(estadoAgora()))
    } else {
      setSemPremio({ nome: primeiroNome(c.nome) })
      setRodada((n) => n + 1)
      setFase('guardado')
    }
    focar(FOCO_JOGO)
  }

  const usarAgora = (codigo: string) => {
    casca.fechar()
    usarNoPedido(codigo)
  }

  const agoraNao = () => {
    const exp = useContaStore.getState().pendente?.expiraEm
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
    <div ref={raiz} className={`sorte sorte-${fase}`}>
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
            />
          )}
        </div>
      )}

      {(fase === 'revelando' || fase === 'premio') && ganho && (
        <div ref={botoes} className="sorte-acoes" inert={fase === 'revelando'}>
          {comConta && ganho.cupom ? (
            <>
              <button type="button" className="botao botao-cheio botao-largo" onClick={() => usarAgora(ganho.cupom!.codigo)}>
                {T.usarAgora}
              </button>
              <button type="button" className="botao botao-contorno botao-largo" onClick={() => setConta(true)}>
                {T.verCupons}
              </button>
              <p className="legenda sorte-nota">{T.naConta}</p>
            </>
          ) : (
            <>
              <button type="button" className="botao botao-cheio botao-largo" onClick={() => irParaCadastro('cadastro', 'premio')}>
                {T.guardar}
              </button>
              <p className="legenda sorte-nota">{T.soNomeZap}</p>
              <p className="legenda sorte-nota">{T.reservado(formatarAte(r.pendente?.expiraEm ?? Date.now() + 864e5, r.agora))}</p>
              <button type="button" className="botao-texto toque" onClick={agoraNao}>
                {T.agoraNao}
              </button>
            </>
          )}
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
          {config.modoPrevia && (
            <div className="sorte-previa">
              <span className="carimbo">{T.exemplo}</span>
              <p className="legenda">{T.previaPremios}</p>
              <p className="legenda">{T.previaConta}</p>
            </div>
          )}
        </div>
      )}

      {fase === 'guardado' && ganho?.cupom && (
        <div className="sorte-acoes">
          <p className="sorte-fechou">{T.fechou(primeiroNome(r.conta?.nome))}</p>
          <p className="legenda">{T.valeAte(formatarValidade(ganho.cupom.validoAte))}</p>
          <button type="button" className="botao botao-cheio botao-largo" onClick={() => usarAgora(ganho.cupom!.codigo)}>
            {T.usarAgora}
          </button>
          <button type="button" className="botao botao-contorno botao-largo" onClick={() => setConta(true)}>
            {T.verCupons}
          </button>
          <p className="legenda sorte-nota">{T.voltaAmanha}</p>
        </div>
      )}

      {fase === 'guardado' && semPremio && (
        <div className="sorte-bloco">
          <Icone nome="conta" tamanho={48} className="sorte-bloco-icone" />
          <p className="sorte-fechou">{T.contaCriada(semPremio.nome)}</p>
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
          {config.modoPrevia && <p className="legenda sorte-nota">{T.previaConta}</p>}
        </div>
      )}

      {naSubtela && (
        <div className="sorte-cadastro">
          {ganho && dados && !ganho.cupom && <FaixaPremio titulo={dados.titulo} papel={dados.papel} />}
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

/** Altura que o elemento ocupa no fluxo (com as margens). */
function alturaDe(el: HTMLElement | null | undefined): number {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
}

/** Leitura síncrona do estado (fora do render) para decidir a fase depois de uma ação. */
function estadoAgora(): Base {
  const s = useContaStore.getState()
  const agora = Date.now()
  const conta = s.atual ? (s.contas[s.atual]?.conta ?? null) : null
  const p = s.pendente
  const pendenteValido = !!p && p.interativo === ID_SORTE && agora < p.expiraEm && !!premioPorId(p.premioId)
  return { conta, pendenteValido, giro: calcularGiro(s, ID_SORTE, agora) }
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
          <p className="sorte-mini-titulo">{hoje.retrato.titulo}</p>
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
