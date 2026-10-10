import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { emUf, ufPorSigla } from '../dados/ufs'
import { ehDesktop, movimentoReduzido, quandoRespirar } from '../lib/movimento'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { useCanalDa } from '../store/loja'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import './Local.css'

gsap.registerPlugin(ScrollTrigger)

/** Texto do adesivo para o estado atual. */
export function useTextoLocal(): { texto: string; procurando: boolean; vazio: boolean } {
  const { uf, cidade, cidadeInformada, detectando } = useLocal()
  const canal = useCanalDa(uf)
  if (!uf) return { texto: detectando ? 'Procurando' : 'De onde tu é?', procurando: detectando, vazio: !detectando }
  const c = nomeCidade(canal, cidade, cidadeInformada)
  return { texto: c ?? ufPorSigla(uf)?.nome ?? uf.toUpperCase(), procurando: false, vazio: false }
}

/** O adesivo de localização do Instagram: caixa branca, pino, cidade em caixa-alta. */
export function AdesivoLocal({
  texto,
  procurando = false,
  tamanho = 'm',
  inclinacao = -4,
  aoTocar,
  rotulo,
  className,
}: {
  texto: string
  procurando?: boolean
  tamanho?: 'p' | 'm' | 'g'
  inclinacao?: number
  aoTocar?: () => void
  rotulo?: string
  className?: string
}) {
  const conteudo = (
    <>
      <Icone nome="pin" tamanho={tamanho === 'p' ? 12 : tamanho === 'g' ? 20 : 16} className="adesivo-local-pin" />
      <span className="adesivo-local-txt">{texto}</span>
      {procurando && <span className="adesivo-local-cursor" aria-hidden="true" />}
    </>
  )
  const estilo = { transform: `rotate(${inclinacao}deg)` }
  const cls = `adesivo-local adesivo-local-${tamanho} ${className ?? ''}`
  return aoTocar ? (
    <button type="button" className={`${cls} toque`} style={estilo} onClick={aoTocar} aria-label={rotulo ?? `Local: ${texto}. Trocar cidade`}>
      {conteudo}
    </button>
  ) : (
    <span className={cls} style={estilo}>
      {conteudo}
    </span>
  )
}

/**
 * Local no celular, enxuto: no story do topo, o local é a linha "📍 Teófilo Otoni" do cabeçalho (LinhaLocal, como o
 * Instagram mostra o local num post). Este adesivo fixo só aparece pequeno e reto depois que a pessoa rola para além
 * do story (catálogo, estados…), para o local continuar a um toque. Junto vem o aviso de uma linha do palpite de IP.
 */
export function TopoLocal() {
  const { texto, procurando } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const ref = useRef<HTMLDivElement>(null)
  const textoAntes = useRef(texto)

  // Fora do Início (abas Catálogo e Por estado) não há story com a linha de local: o adesivo fica sempre à vista,
  // como cabeçalho, já no render (por classe, sem gsap.set, que forçava o layout da vista nova na troca de aba).
  // No Início, aparece quando o topo da tela passa do fim do story (ou da tela "ainda não chegou aí", ou da vaga de
  // espera da loja). O story também pode entrar ou sair sem a pessoa rolar (a loja do servidor chega, o estado muda): a
  // vista do Início muda de altura e o adesivo confere de novo (ResizeObserver).
  const ancorado = useUI((s) => s.aba !== 'inicio')
  const [passouDoStory, setPassouDoStory] = useState(false)
  const jaMediu = useRef(false)
  useLayoutEffect(() => {
    if (ehDesktop() || ancorado) return
    const medir = () => {
      const topo = document.querySelector('.vista-inicio')?.querySelector('.hero, .sem-atendimento, .inicio-esperando')
      const fim = topo ? topo.getBoundingClientRect().bottom : 0
      setPassouDoStory(fim < 72)
    }
    let st: ScrollTrigger | undefined
    let ro: ResizeObserver | undefined
    const conferir = () => st?.refresh()
    const ligar = () => {
      st = ScrollTrigger.create({ trigger: document.documentElement, start: 0, end: 'max', onUpdate: medir })
      window.addEventListener('resize', conferir)
      const vista = document.querySelector('.vista-inicio')
      if (vista && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => medir())
        ro.observe(vista)
      }
    }
    // volta de outra aba: mede e liga já (a rolagem volta à altura guardada do Início). Na página abrindo, mede no
    // quadro seguinte e liga a rolagem quando a página respira: ler a posição (e o ScrollTrigger lê a rolagem ao
    // nascer) aqui, no meio da montagem, obrigava o navegador a calcular a página inteira a mais e atrasava a primeira
    // tela (ela abre no topo, com o story à vista; o adesivo começa escondido, como já estava)
    let quadro = 0
    let cancelar = () => {}
    if (jaMediu.current) {
      medir()
      ligar()
    } else {
      quadro = requestAnimationFrame(medir)
      cancelar = quandoRespirar(() => {
        medir()
        ligar()
      })
    }
    jaMediu.current = true
    return () => {
      cancelAnimationFrame(quadro)
      cancelar()
      window.removeEventListener('resize', conferir)
      ro?.disconnect()
      st?.kill()
    }
  }, [ancorado])
  const visivel = ancorado || passouDoStory

  // trocou de cidade: o adesivo cola de novo (pop curto, voz pixel)
  useLayoutEffect(() => {
    if (textoAntes.current === texto) return
    textoAntes.current = texto
    const a = ref.current?.querySelector('.adesivo-local')
    if (a && visivel && !movimentoReduzido()) gsap.fromTo(a, { scale: 0.7, rotate: -10 }, { scale: 1, rotate: 0, duration: 0.36, ease: 'back.out(2.4)' })
  }, [texto, visivel])

  return (
    <>
      <div className={`topo-faixa ${visivel ? 'visivel' : ''}`} aria-hidden="true" />
      <div ref={ref} className={`topo-local ${visivel ? 'visivel' : ''}`} aria-hidden={!visivel} inert={!visivel}>
        <AdesivoLocal texto={texto} procurando={procurando} inclinacao={0} aoTocar={() => setSeletor(true)} />
      </div>
      <AvisoLocal />
    </>
  )
}

/** A linha de local do cabeçalho do story (celular): pino, cidade e seta. Tocar abre o seletor. */
export function LinhaLocal({ className }: { className?: string }) {
  const { texto, procurando, vazio } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const nome = vazio ? 'De onde tu é?' : texto
  return (
    <button
      type="button"
      className={`linha-local toque ${vazio ? 'vazia' : ''} ${className ?? ''}`}
      onClick={() => setSeletor(true)}
      aria-label={vazio ? 'Escolher teu estado' : `Local: ${texto}. Trocar cidade`}
    >
      <Icone nome="pin" tamanho={12} className="linha-local-pin" />
      <span className="linha-local-txt">{nome}</span>
      {procurando && <span className="adesivo-local-cursor" aria-hidden="true" />}
      <Icone nome="chevron-dir" tamanho={12} className="linha-local-seta" />
    </button>
  )
}

/** Qual aviso de local está pendente: confirmar o palpite de IP de um estado atendido, ou o IP de um estado sem entrega. */
export function useAvisoLocal(): 'confirmar' | 'fora' | null {
  return useLocal((s) => (s.uf && !s.confirmado && s.origem === 'ip' ? 'confirmar' : !s.uf && s.palpiteFora ? 'fora' : null))
}

/**
 * Aviso de uma linha (celular): confirma o palpite de IP quando a abertura não perguntou (palpite chegou depois, ou
 * a pessoa pulou) e avisa quando o IP aponta um estado sem atendimento. No Início ele mora no pé do story, no lugar
 * da linha "Enviar mensagem…" (variante 'story', o Hero troca uma pela outra até a resposta); nas outras abas, fixo
 * logo acima da barra de abas. Nunca por cima do produto nem da linha de resposta.
 */
export function AvisoLocal({ variante = 'fixo' }: { variante?: 'fixo' | 'story' }) {
  const aviso = useAvisoLocal()
  const { uf, palpiteFora, confirmar } = useLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const abrirChat = useChat((s) => s.abrir)
  const chatAberto = useChat((s) => s.aberto)
  const noInicio = useUI((s) => s.aba === 'inicio')
  const camadaAberta = useUI(
    (s) => !!s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || !!s.pagina || !!s.trocaPendente || s.aberturaAtiva || !!s.interativo || s.contaAberta,
  )
  if (!aviso || ehDesktop()) return null
  // o fixo fica fora do Início (lá o story já mostra) e some com qualquer camada por cima
  if (variante === 'fixo' && (noInicio || camadaAberta || chatAberto)) return null
  const cls = `aviso-local aviso-local-${variante}${aviso === 'fora' ? ' aviso-local-fora' : ''}`
  if (aviso === 'confirmar' && uf) {
    return (
      <div className={cls} role="group" aria-label="Confirmar teu estado">
        <p className="aviso-local-txt">Tu tá {emUf(uf)}?</p>
        <div className="aviso-local-opcoes">
          <button type="button" className="aviso-local-op toque" onClick={confirmar}>
            Sim
          </button>
          <button type="button" className="aviso-local-op toque" onClick={() => setSeletor(true)}>
            Trocar
          </button>
        </div>
      </div>
    )
  }
  if (aviso === 'fora' && palpiteFora) {
    return (
      <div className={cls} role="group" aria-label="Teu estado">
        <p className="aviso-local-txt">Ainda não chegou {emUf(palpiteFora)}.</p>
        <div className="aviso-local-opcoes">
          <button type="button" className="aviso-local-op toque" onClick={() => setSeletor(true)}>
            Estados
          </button>
          <button type="button" className="aviso-local-op toque" onClick={() => abrirChat('encomenda')}>
            Encomendar
          </button>
        </div>
      </div>
    )
  }
  return null
}

/** Enquete do story para o palpite de IP: "Tu tá em Minas Gerais?" [Sim] | [Trocar] (cidade atendida embaixo). */
export function EnqueteLocal({ className, aoSim, aoTrocar }: { className?: string; aoSim?: () => void; aoTrocar?: () => void }) {
  const { uf, cidade, confirmado, origem, confirmar } = useLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const canal = useCanalDa(uf)
  if (!uf || confirmado || origem !== 'ip') return null
  const c = nomeCidade(canal, cidade, null)
  return (
    <div className={`enquete enquete-confirmar ${className ?? ''}`} role="group" aria-label="Confirmar teu estado">
      <p className="enquete-pergunta">
        Tu tá {emUf(uf)}?{c && <span className="enquete-sub">Atendimento de {c}</span>}
      </p>
      <div className="enquete-opcoes">
        <button
          type="button"
          className="enquete-opcao toque"
          onClick={() => {
            confirmar()
            aoSim?.()
          }}
        >
          Sim
        </button>
        <button type="button" className="enquete-opcao toque" onClick={() => (aoTrocar ? aoTrocar() : setSeletor(true))}>
          Trocar
        </button>
      </div>
    </div>
  )
}
