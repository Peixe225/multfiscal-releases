import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyboardEventReact, type RefObject } from 'react'
import { gsap } from 'gsap'
import { PixelArte } from '../../arte/PixelArte'
import type { Grade } from '../../arte/pixel/grades'
import { canalDa } from '../../dados/canais'
import { alvoDeSaida } from '../../lib/ambiente'
import { useConta } from '../../lib/conta'
import { copiarTexto } from '../../lib/copiar'
import { focarVista, prenderTab } from '../../lib/foco'
import { useCamadaNoHistorico } from '../../lib/historico'
import { linkWhatsAppLoja, montarRateioSemConexao } from '../../lib/mensagem'
import { ehDesktop, movimentoReduzido } from '../../lib/movimento'
import type { Rateio } from '../../lib/rateio-api'
import { buscarRateio } from '../../lib/rateio-vagas'
import { liberarRolagem, travarRolagem } from '../../lib/rolagem'
import { atualizarParametros, lerParametros, linkCompartilhar } from '../../lib/url'
import { nomeCidade, useLocal } from '../../store/local'
import { agoraRateio, carregarRateios, useRateio, zapDoDono } from '../../store/rateio'
import { useUI } from '../../store/ui'
import { useLojaMarca } from '../../store/loja'
import { Avatar, Icone } from '../comum'
import { folhaDoTopo } from '../Folha'
import { CartaoRateio } from './CartaoRateio'
import { EntrarRateio } from './EntrarRateio'
import { listaUfs, prazoAcabou, textoPrazo, textoPrevisao, vagaDoAparelho } from './util'
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
      // aberta por link direto, ninguém abriu com o foco: vai pro título da aba que ficou à vista
      if (volta?.isConnected) volta.focus({ preventScroll: true })
      else focarVista(useUI.getState().aba)
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

/**
 * O rateio da página: o da lista; fora dela (ex.: encerrado há mais de 15 dias, ou criado depois da lista), pergunta ao
 * servidor. Só "nao-encontrado" é rateio que saiu do ar; tempo esgotado, rede caída, 5xx ou muitas-tentativas não dizem
 * nada sobre ele ("Não deu pra abrir esse rateio agora", com Tentar de novo). `tentar` busca de novo.
 */
function useRateioDaPagina(id: string): { rateio: Rateio | null; estado: 'buscando' | 'pronto' | 'sumiu' | 'sem-conexao'; tentar: () => void } {
  const daLista = useRateio((s) => s.rateios.find((r) => r.id === id) ?? null)
  const fonte = useRateio((s) => s.fonte)
  const [avulso, setAvulso] = useState<Rateio | null | 'sumiu' | 'falhou'>(null)
  useEffect(() => {
    void carregarRateios()
  }, [])
  useEffect(() => {
    if (daLista || fonte !== 'servidor' || avulso) return
    let vivo = true
    void buscarRateio(id).then((r) => {
      if (vivo) setAvulso(r.ok ? r.rateio : r.erro === 'nao-encontrado' ? 'sumiu' : 'falhou')
    })
    return () => {
      vivo = false
    }
  }, [daLista, fonte, id, avulso])
  const tentar = () => {
    if (avulso === 'falhou') setAvulso(null)
    void carregarRateios(true)
  }
  if (daLista) return { rateio: daLista, estado: 'pronto', tentar }
  if (avulso && typeof avulso === 'object') return { rateio: avulso, estado: 'pronto', tentar }
  if (avulso === 'sumiu') return { rateio: null, estado: 'sumiu', tentar }
  // servidor que não respondeu, ou sem servidor e fora dos exemplos: não dá pra saber se ele existe
  if (avulso === 'falhou' || fonte === 'sem-servidor' || fonte === 'fora-do-ar') return { rateio: null, estado: 'sem-conexao', tentar }
  return { rateio: null, estado: 'buscando', tentar }
}

function Conteudo({ id, titulo }: { id: string; titulo: RefObject<HTMLHeadingElement | null> }) {
  const { rateio, estado, tentar } = useRateioDaPagina(id)
  const { uf, cidade, cidadeInformada } = useLocal()
  useLojaMarca()
  const fonte = useRateio((s) => s.fonte)
  const vagas = useRateio((s) => s.vagas)
  const conta = useConta()
  const canal = canalDa(uf)
  const { fecharRateio, avisar, abrirComoFunciona } = useUI.getState()
  const form = useRef<HTMLDivElement>(null)
  const agora = agoraRateio()
  // a vaga do dono do aparelho (a de um amigo, pelo "Entrar com outro WhatsApp", não conta aqui)
  const codigo = vagaDoAparelho(vagas, id, agora, zapDoDono(vagas, conta?.whatsapp))?.codigo ?? null

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
  // aberto com o prazo vencido e vaga sobrando: não é "vagas tomadas" (o servidor não fecha sozinho pelo prazo)
  const prazo = !!rateio && prazoAcabou(rateio, agora)
  const entra = !!rateio && aberto && !prazo && rateio.aceitaEntradas
  // o formulário some com o foco dentro quando a lista recarrega (fechou, o prazo acabou, saiu do estado): o foco vai
  // pro aviso que entrou no lugar, não pro <body>
  const area = !rateio ? 'nada' : aberto && !foraDoEstado && (entra || codigo) ? 'form' : 'aviso'
  const areaAntes = useRef(area)
  useEffect(() => {
    const antes = areaAntes.current
    areaAntes.current = area
    const ativo = document.activeElement
    if (antes === 'form' && area === 'aviso' && (!ativo || ativo === document.body)) form.current?.querySelector<HTMLElement>('.rp-fora')?.focus({ preventScroll: true })
  }, [area])
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
              <p>Não deu pra abrir esse rateio agora. Tenta de novo daqui a pouco, ou entra pelo WhatsApp: a loja confere o rateio por lá.</p>
              <div className="rp-vazio-acoes">
                <a
                  className="botao botao-cheio toque"
                  href={linkWhatsAppLoja(canal, montarRateioSemConexao(canal, nomeCidade(canal, cidade, cidadeInformada), linkCompartilhar({ aba: 'rateio', rateio: id })))}
                  target={alvoDeSaida()}
                  rel="noopener noreferrer"
                >
                  <Icone nome="whatsapp" tamanho={16} />
                  Entrar pelo WhatsApp
                </a>
                <button type="button" className="botao botao-contorno toque" onClick={tentar}>
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
                {aberto && (
                  <li>
                    {textoPrazo(rateio, agora)}
                    {prazo ? '' : ' O pedido sai depois que fecham as vagas.'}
                  </li>
                )}
                {entra && !foraDoEstado && <li>Tua vaga fica guardada por {rateio.reservaHoras} h enquanto tu fecha o pagamento.</li>}
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
              {aberto && !foraDoEstado && (entra || codigo) ? (
                <EntrarRateio rateio={rateio} modo={fonte === 'sem-servidor' ? 'sem-servidor' : 'servidor'} podeEntrar={entra} />
              ) : foraDoEstado && aberto ? (
                <div className="rp-fora" tabIndex={-1}>
                  <p>
                    Esse rateio é só pra {listaUfs(rateio.ufs)}. Teu estado agora é {uf?.toUpperCase()}.
                  </p>
                  <button type="button" className="botao botao-contorno toque" onClick={() => useUI.getState().setSeletor(true)}>
                    <Icone nome="pin" tamanho={16} />
                    Trocar estado
                  </button>
                </div>
              ) : aberto && prazo ? (
                <p className="rp-fora" tabIndex={-1}>{textoPrazo(rateio, agora)} Fica de olho nos próximos.</p>
              ) : aberto ? (
                <p className="rp-fora" tabIndex={-1}>As vagas foram todas pegas. Se alguém não pagar no prazo, a vaga volta pro rateio.</p>
              ) : (
                <p className="rp-fora" tabIndex={-1}>Esse rateio já fechou. {codigo ? 'Tua vaga tá em "Minhas vagas".' : 'Fica de olho nos próximos.'}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
