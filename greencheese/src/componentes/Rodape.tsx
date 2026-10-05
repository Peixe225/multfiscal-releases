import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { canais, canalDa, perfisAConfirmar } from '../dados/canais'
import { config } from '../dados/config'
import { PixelArte } from '../arte/PixelArte'
import { ilustracoes } from '../arte/pixel/grades'
import { apresentacao, palpebras } from '../arte/pixel/mercador'
import { linkPerfil } from '../lib/mensagem'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { Avatar } from './comum'
import './Rodape.css'

// O quadro de dentro tem 78% de min(260px, 72vw): a partir de 360 px de tela ele passa de 200 px e o mercador
// entra com 4 px por pixel da grade (176 px, folga de uns 13 px de cada lado); abaixo disso, 3 px (132 px).
// Sempre múltiplo da grade de 44.
const TELA_LARGA = '(min-width: 360px)'
function assinarTela(avisar: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const consulta = window.matchMedia(TELA_LARGA)
  consulta.addEventListener('change', avisar)
  return () => consulta.removeEventListener('change', avisar)
}
const lerTela = () => typeof window !== 'undefined' && !!window.matchMedia?.(TELA_LARGA).matches
const lerTelaServidor = () => true

// A apresentação do mercador (abre o outro lado do casaco e dá uns tragos). Sem config.mercadorTraga, as camadas do
// trago nem entram: o ciclo fica só com o casaco abrindo e fechando (o Rodape.css troca para o ciclo curto).
const quadros = apresentacao.filter((q) => config.mercadorTraga || !q.trago)

// Aba escondida (outro app, outra aba): a animação para.
function assinarAba(avisar: () => void) {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', avisar)
  return () => document.removeEventListener('visibilitychange', avisar)
}
const lerAba = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const lerAbaServidor = () => false

/** true enquanto o elemento aparece na tela. Sem IntersectionObserver (navegador antigo), fica sempre true. */
function useNaTela(ref: RefObject<Element | null>) {
  const [naTela, setNaTela] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNaTela(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setNaTela(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return naTela
}

/** Repost no molde do IG: o story da loja com o story do cliente dentro. Sem depoimento inventado: só a ilustração da marca. */
export function Reposts() {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf) ?? canais[0]
  const tamanho = useSyncExternalStore(assinarTela, lerTela, lerTelaServidor) ? 176 : 132
  const figura = useRef<HTMLDivElement>(null)
  // Fora da tela, coberto por uma camada ou com a aba escondida, as animações ficam pausadas (animation-play-state):
  // nenhum trabalho. O IntersectionObserver não vê o que cobre o repost, então vale o mesmo critério do Hero.
  const naTela = useNaTela(figura)
  const abaVisivel = useSyncExternalStore(assinarAba, lerAba, lerAbaServidor)
  const camadaAberta = useUI(
    (s) => !!s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.painelPrevia || !!s.pagina || !!s.trocaPendente || s.aberturaAtiva,
  )
  const chatAberto = useChat((s) => s.aberto)
  const anda = naTela && abaVisivel && !camadaAberta && !chatAberto
  return (
    <section className="reposts" aria-label="Clientes marcando a loja">
      <div className="repost">
        <div className="repost-cab">
          <Avatar tamanho={28} />
          <span>{canal.instagram}</span>
        </div>
        <div className="repost-dentro">
          {/* decorativo: a legenda embaixo já diz o que importa. Pálpebras e quadros da apresentação são camadas na
              mesma grade, empilhadas por cima do mercador; o CSS diz quando cada uma aparece. */}
          <div
            ref={figura}
            className={`repost-figura${config.mercadorTraga ? ' com-trago' : ''}${anda ? '' : ' parado'}`}
          >
            <PixelArte grade={ilustracoes.mercador} tamanho={tamanho} className="repost-arte" />
            <PixelArte grade={palpebras} tamanho={tamanho} className="repost-piscar" />
            {quadros.map((q) => (
              <PixelArte key={q.nome} grade={q.grade} tamanho={tamanho} className={`repost-quadro q-${q.nome}`} />
            ))}
          </div>
          <span className="adesivo-mencao repost-mencao">@{canal.instagram}</span>
        </div>
        <p className="repost-legenda px">Quem já usou sabe da qualidade</p>
      </div>
      <p className="reposts-txt">
        Chegou teu pedido? Marca <strong>@{canal.instagram}</strong> no story.
      </p>
    </section>
  )
}

/** Rodapé no molde do instagram.com: todos os perfis, avisos, privacidade e o crédito da prévia. */
export function Rodape() {
  return (
    <footer className="rodape">
      <nav aria-label="Instagrams da Green Cheese" className="rodape-perfis">
        {canais.map((c) => (
          <a key={c.uf} href={linkPerfil(c.instagram)} target="_blank" rel="noopener noreferrer">
            @{c.instagram}
          </a>
        ))}
        {perfisAConfirmar.map((p) => (
          <a key={p.instagram} href={linkPerfil(p.instagram)} target="_blank" rel="noopener noreferrer">
            @{p.instagram} <span className="carimbo">{p.nota}</span>
          </a>
        ))}
      </nav>
      <p className="rodape-aviso">
        <strong>Venda proibida para menores de 18 anos.</strong> Beba com moderação.
      </p>
      <p className="rodape-txt">
        Derivados do tabaco não são vendidos pelo site (Anvisa, RDC 840/2023). Sedas, piteiras e acessórios, sim.
      </p>
      <p className="rodape-txt">
        Privacidade: o palpite de estado vem da localização aproximada pelo IP, sem GPS, e serve só pra indicar o atendimento. A sacola e as respostas ficam guardadas só neste aparelho; nada vai pra servidor da loja. Quem cria conta no Teste minha sorte: na prévia, nome e WhatsApp também ficam só neste aparelho.
      </p>
      {config.modoPrevia && (
        <p className="rodape-credito">
          {config.credito.texto} —{' '}
          <a href={linkPerfil(config.credito.instagram)} target="_blank" rel="noopener noreferrer">
            @{config.credito.instagram}
          </a>
        </p>
      )}
      <p className="rodape-assinatura">Green Cheese Imports · {new Date().getFullYear()}</p>
    </footer>
  )
}
