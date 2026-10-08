import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyboardEventReact, type RefObject } from 'react'
import { gsap } from 'gsap'
import { PixelArte } from '../../arte/PixelArte'
import type { Grade } from '../../arte/pixel/grades'
import { canalDa } from '../../dados/canais'
import { copiarTexto } from '../../lib/copiar'
import { prenderTab } from '../../lib/foco'
import { useCamadaNoHistorico } from '../../lib/historico'
import { ehDesktop, movimentoReduzido } from '../../lib/movimento'
import type { Rateio } from '../../lib/rateio-api'
import { buscarRateio } from '../../lib/rateio-vagas'
import { liberarRolagem, travarRolagem } from '../../lib/rolagem'
import { atualizarParametros, lerParametros, linkCompartilhar } from '../../lib/url'
import { useLocal } from '../../store/local'
import { agoraRateio, carregarRateios, useRateio } from '../../store/rateio'
import { useUI } from '../../store/ui'
import { Avatar, Icone } from '../comum'
import { folhaDoTopo } from '../Folha'
import { CartaoRateio } from './CartaoRateio'
import { EntrarRateio } from './EntrarRateio'
import { listaUfs, textoPrazo, textoPrevisao, vagaAtiva } from './util'
import './estilo'

// Página de um rateio (?rateio=<id>), no molde da página do produto: tela cheia que entra pela direita no celular,
// diálogo no computador, uma entrada no histórico (voltar do Android, Esc e o botão do topo fecham), link próprio pra
// compartilhar (o dono põe no adesivo de link dos stories). Em cima, o cartão grande; embaixo, a descrição, o como
// funciona resumido e o "Entrar no rateio".

/** Chevron do "Voltar" (o mesmo da página do produto). */
const CHEVRON: Grade = {
  w: 16,
  h: 16,
  linhas: [
    '................',
    '................',
    '..........xx....',
    '.........xxx....',
    '........xxx.....',
    '.......xxx......',
    '......xxx.......',
    '.....xxx........',
    '.....xxx........',
    '......xxx.......',
    '.......xxx......',
    '........xxx.....',
    '.........xxx....',
    '..........xx....',
    '................',
    '................',
  ],
}

/** A página já abriu nesta visita: o ?rateio= velho da URL (link de entrada) sai na volta do histórico. */
let jaAbriu = false
window.addEventListener('popstate', () => {
  const id = useUI.getState().rateio
  if (id) atualizarParametros({ rateio: id })
  else if (jaAbriu && lerParametros().rateio) atualizarParametros({ rateio: null })
})

export function PaginaRateio() {
  const id = useUI((s) => s.rateio)
  const [mostrado, setMostrado] = useState<string | null>(id)
  const [saindo, setSaindo] = useState(false)
  if (id && (id !== mostrado || saindo)) {
    setMostrado(id)
    setSaindo(false)
  }
  if (!id && mostrado && !saindo) setSaindo(true)
  useCamadaNoHistorico(!!id, 'rateio', () => useUI.getState().fecharRateio())
  if (id) jaAbriu = true

  // ?rateio=<id> na URL enquanto aberta; sai ao fechar (montada no tempo ocioso e fechada, não mexe: o link de entrada
  // ainda vai ser lido depois da abertura)
  const estava = useRef(false)
  useEffect(() => {
    if (id) {
      estava.current = true
      atualizarParametros({ rateio: id })
    } else if (estava.current) {
      estava.current = false
      atualizarParametros({ rateio: null })
    }
  }, [id])

  if (!mostrado) return null
  return (
    <Janela
      key={mostrado}
      id={mostrado}
      saindo={saindo}
      aoSair={() => {
        setMostrado(null)
        setSaindo(false)
      }}
    />
  )
}

function Janela({ id, saindo, aoSair }: { id: string; saindo: boolean; aoSair: () => void }) {
  const raiz = useRef<HTMLDivElement>(null)
  const janela = useRef<HTMLDivElement>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  // quem tinha o foco quando a página abriu: ele volta pra lá quando ela fecha
  const [volta] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null))
  const fechar = useUI((s) => s.fecharRateio)

  useEffect(() => {
    travarRolagem()
    return () => liberarRolagem()
  }, [])

  // entrada (voz app): pela direita no celular, subindo no computador
  useLayoutEffect(() => {
    const el = janela.current
    const cortina = raiz.current?.querySelector<HTMLElement>('.pp-cortina')
    titulo.current?.focus({ preventScroll: true })
    if (!el || movimentoReduzido()) return
    const desk = ehDesktop()
    const tw = desk
      ? gsap.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform,opacity' })
      : gsap.fromTo(el, { xPercent: 100 }, { xPercent: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' })
    if (desk && cortina) gsap.fromTo(cortina, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' })
    return () => {
      tw.kill()
    }
  }, [])

  // saída: some e só então desmonta; o foco volta pra quem abriu
  useLayoutEffect(() => {
    if (!saindo) return
    const el = janela.current
    const cortina = raiz.current?.querySelector<HTMLElement>('.pp-cortina')
    const fim = () => {
      aoSair()
      if (volta?.isConnected) volta.focus({ preventScroll: true })
    }
    if (!el || movimentoReduzido()) {
      fim()
      return
    }
    const tl = gsap.timeline({ onComplete: fim })
    if (ehDesktop()) {
      tl.to(el, { opacity: 0, y: 16, duration: 0.2, ease: 'power3.in' }, 0)
      if (cortina) tl.to(cortina, { opacity: 0, duration: 0.18, ease: 'none' }, 0)
    } else tl.to(el, { xPercent: 100, duration: 0.24, ease: 'power3.in' }, 0)
    return () => {
      tl.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saindo])

  // Esc fecha (com uma folha por cima, ela cuida); setas e espaço não vazam pro story de trás
  useEffect(() => {
    if (saindo) return
    const tecla = (e: KeyboardEvent) => {
      if (folhaDoTopo()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useUI.getState().fecharRateio()
      }
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [saindo])

  // foco que escapa pra página de trás volta pro título
  useEffect(() => {
    if (saindo) return
    const guarda = (e: FocusEvent) => {
      const r = raiz.current
      const alvo = e.target
      if (!r || !(alvo instanceof Element) || r.contains(alvo) || alvo.closest('.folha') || folhaDoTopo()) return
      titulo.current?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', guarda)
    return () => document.removeEventListener('focusin', guarda)
  }, [saindo])

  const prender = (e: KeyboardEventReact<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') e.stopPropagation()
    if (e.key !== 'Tab') return
    const folha = folhaDoTopo()
    if (folha) {
      e.preventDefault()
      folha.focus()
      return
    }
    prenderTab(e, janela.current)
  }

  return (
    <div ref={raiz} className={`pp rp${saindo ? ' pp-saindo' : ''}`} role="dialog" aria-modal="true" aria-labelledby="rp-titulo" onKeyDown={prender} data-lenis-prevent>
      <div className="pp-cortina cortina" onClick={fechar} aria-hidden="true" />
      <div ref={janela} className="pp-janela rp-janela" tabIndex={-1}>
        <Conteudo id={id} titulo={titulo} />
      </div>
    </div>
  )
}

/** O rateio da página: o da lista; fora dela (ex.: encerrado há mais de 15 dias), pergunta ao servidor. */
function useRateioDaPagina(id: string): { rateio: Rateio | null; estado: 'buscando' | 'pronto' | 'sumiu' | 'sem-conexao' } {
  const daLista = useRateio((s) => s.rateios.find((r) => r.id === id) ?? null)
  const fonte = useRateio((s) => s.fonte)
  const [avulso, setAvulso] = useState<Rateio | null | 'sumiu'>(null)
  useEffect(() => {
    void carregarRateios()
  }, [])
  useEffect(() => {
    if (daLista || fonte !== 'servidor' || avulso) return
    let vivo = true
    void buscarRateio(id).then((r) => {
      if (vivo) setAvulso(r.ok ? r.rateio : 'sumiu')
    })
    return () => {
      vivo = false
    }
  }, [daLista, fonte, id, avulso])
  if (daLista) return { rateio: daLista, estado: 'pronto' }
  if (avulso && avulso !== 'sumiu') return { rateio: avulso, estado: 'pronto' }
  if (avulso === 'sumiu') return { rateio: null, estado: 'sumiu' }
  // sem servidor e fora dos exemplos: não dá pra saber se ele existe (a loja pode estar fora do ar)
  if (fonte === 'sem-servidor') return { rateio: null, estado: 'sem-conexao' }
  return { rateio: null, estado: 'buscando' }
}

function Conteudo({ id, titulo }: { id: string; titulo: RefObject<HTMLHeadingElement | null> }) {
  const { rateio, estado } = useRateioDaPagina(id)
  const uf = useLocal((s) => s.uf)
  const fonte = useRateio((s) => s.fonte)
  const vagas = useRateio((s) => s.vagas)
  const canal = canalDa(uf)
  const { fecharRateio, avisar, abrirComoFunciona } = useUI.getState()
  const form = useRef<HTMLDivElement>(null)
  const agora = agoraRateio()
  const codigo = vagas.find((v) => v.rateio === id && vagaAtiva(v, agora))?.codigo ?? null

  const compartilhar = async () => {
    const url = linkCompartilhar({ aba: 'rateio', rateio: id })
    const nome = rateio?.titulo ?? 'Rateio'
    try {
      if (navigator.share) {
        await navigator.share({ title: `${nome} — Rateio Green Cheese`, text: `Rateio de ${nome} na Green Cheese`, url })
        return
      }
    } catch {
      return
    }
    avisar(copiarTexto(url) ? 'Link copiado. Manda pra quem quiser.' : 'Não deu pra copiar o link.')
  }

  // o adesivo "Entrar no rateio" do cartão desce até o formulário e põe o cursor no nome
  const irProFormulario = () => {
    const el = form.current
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: movimentoReduzido() ? 'auto' : 'smooth' })
    el.querySelector<HTMLElement>('input, a.rp-zap, button')?.focus({ preventScroll: true })
  }

  const aberto = rateio?.status === 'aberto'
  const foraDoEstado = !!rateio && !!uf && !rateio.ufs.includes(uf)
  return (
    <>
      <header className="pp-topo">
        <button type="button" className="icone-botao toque pp-voltar" onClick={fecharRateio} aria-label="Voltar">
          <PixelArte grade={CHEVRON} tamanho={32} />
        </button>
        <p className="pp-loja">
          <Avatar tamanho={28} />
          <span className="pp-loja-nome">{canal?.instagram ?? 'Green Cheese'}</span>
        </p>
        <button type="button" className="icone-botao toque" onClick={compartilhar} aria-label="Compartilhar rateio">
          <Icone nome="enviar" tamanho={24} />
        </button>
        <button type="button" className="icone-botao toque pp-fechar" onClick={fecharRateio} aria-label="Fechar">
          <Icone nome="fechar" tamanho={20} />
        </button>
      </header>

      {!rateio ? (
        <div className="pp-info rp-vazio">
          <h2 ref={titulo} id="rp-titulo" className="rp-nome px" tabIndex={-1}>
            Rateio
          </h2>
          {estado === 'buscando' ? (
            <p className="legenda" role="status">
              Buscando o rateio…
            </p>
          ) : estado === 'sem-conexao' ? (
            <>
              <p>Não deu pra abrir esse rateio agora. Tenta de novo daqui a pouco.</p>
              <div className="rp-vazio-acoes">
                <button type="button" className="botao botao-cheio toque" onClick={() => void carregarRateios(true)}>
                  Tentar de novo
                </button>
                <button type="button" className="botao botao-contorno toque" onClick={fecharRateio}>
                  Ver os rateios
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Esse rateio não tá mais no ar.</p>
              <button type="button" className="botao botao-cheio toque" onClick={fecharRateio}>
                Ver os rateios
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="rp-visual">
            <CartaoRateio rateio={rateio} uf={uf} variante="pagina" aoEntrar={irProFormulario} codigo={codigo} prioridade tituloId="rp-titulo" tituloRef={titulo} />
          </div>
          <div className="pp-info rp-info">
            {rateio.descricao && <p className="rp-desc">{rateio.descricao}</p>}
            <div className="rp-resumo">
              <ul className="rp-resumo-lista">
                <li>{textoPrevisao(rateio)}</li>
                {aberto && <li>{textoPrazo(rateio)} O pedido sai depois que fecham as vagas.</li>}
                {aberto && <li>Tua vaga fica guardada por {rateio.reservaHoras} h enquanto tu fecha o pagamento.</li>}
                <li>Vale pra {listaUfs(rateio.ufs)}.</li>
              </ul>
              <button
                type="button"
                className="rp-como toque"
                onClick={() => abrirComoFunciona({ reservaHoras: rateio.reservaHoras, previsaoMin: rateio.previsaoMin, previsaoMax: rateio.previsaoMax })}
                aria-haspopup="dialog"
              >
                <Icone nome="interrogacao" tamanho={16} />
                Como funciona o rateio
              </button>
            </div>
            <div ref={form} className="rp-entrar-area">
              {aberto && !foraDoEstado && (rateio.aceitaEntradas || codigo) ? (
                <EntrarRateio rateio={rateio} modo={fonte === 'servidor' ? 'servidor' : 'sem-servidor'} />
              ) : foraDoEstado && aberto ? (
                <div className="rp-fora">
                  <p>
                    Esse rateio é só pra {listaUfs(rateio.ufs)}. Teu estado agora é {uf?.toUpperCase()}.
                  </p>
                  <button type="button" className="botao botao-contorno toque" onClick={() => useUI.getState().setSeletor(true)}>
                    <Icone nome="pin" tamanho={16} />
                    Trocar estado
                  </button>
                </div>
              ) : aberto ? (
                <p className="rp-fora">As vagas foram todas pegas. Se alguém não pagar no prazo, a vaga volta pro rateio.</p>
              ) : (
                <p className="rp-fora">Esse rateio já fechou. {codigo ? 'Tua vaga tá em "Minhas vagas".' : 'Fica de olho nos próximos.'}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
