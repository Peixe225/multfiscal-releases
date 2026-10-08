import { useRef, useSyncExternalStore } from 'react'
import { canais, canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { alvoDeSaida } from '../lib/ambiente'
import { linkDM, linkPerfil } from '../lib/mensagem'
import { useLocal } from '../store/local'
import { Avatar } from './comum'
import { MercadorAnimado, useMercadorAnda } from './Mercador'
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

/**
 * Repost no molde do IG: o story da loja com o story do cliente dentro. Sem depoimento inventado: só a ilustração da
 * marca. `texto` = a linha "Chegou teu pedido? Marca…" embaixo (a aba Catálogo põe a linha fora da coluna).
 */
export function Reposts({ texto = true }: { texto?: boolean }) {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf) ?? canais[0]
  const tamanho = useSyncExternalStore(assinarTela, lerTela, lerTelaServidor) ? 176 : 132
  const figura = useRef<HTMLDivElement>(null)
  // Fora da tela, coberto por uma camada ou com a aba escondida, as animações ficam pausadas (animation-play-state):
  // nenhum trabalho. Ao voltar a andar, pula a parte parada (ver useMercadorAnda).
  const anda = useMercadorAnda(figura)
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
          <MercadorAnimado refFigura={figura} tamanho={tamanho} anda={anda} />
          <span className="adesivo-mencao repost-mencao">@{canal.instagram}</span>
        </div>
        <p className="repost-legenda px">Quem já usou sabe da qualidade</p>
      </div>
      {texto && <TextoReposts />}
    </section>
  )
}

/** "Chegou teu pedido? Marca @… no story." */
export function TextoReposts() {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf) ?? canais[0]
  return (
    <p className="reposts-txt">
      Chegou teu pedido? Marca <strong>@{canal.instagram}</strong> no story.
    </p>
  )
}

/** Rodapé no molde do instagram.com: os perfis dos estados, avisos, privacidade e o crédito. */
export function Rodape() {
  // estado escolhido ou palpitado: a dúvida vai direto pra DM dele
  const canal = canalDa(useLocal((s) => s.uf))
  return (
    <footer className="rodape">
      {/* como fala com a loja: o pedido fecha no WhatsApp (só no fim do pedido guiado); dúvida, na DM do estado */}
      <p className="rodape-txt rodape-como">
        <span>Monta o pedido aqui e fecha no WhatsApp da loja.</span>{' '}
        {canal ? (
          <span>
            Outra dúvida? Chama a{' '}
            <a className="rodape-dm" href={linkDM(canal)} target={alvoDeSaida()} rel="noopener noreferrer">
              @{canal.instagram}
            </a>{' '}
            na&nbsp;DM.
          </span>
        ) : (
          <span>Outra dúvida? Chama o Instagram do teu estado:</span>
        )}
      </p>
      {/* só os perfis dos estados (o que ainda falta confirmar não entra na lista pública) */}
      <nav aria-label="Instagrams da Green Cheese" className="rodape-perfis">
        {canais.map((c) => (
          <a key={c.uf} href={linkPerfil(c.instagram)} target="_blank" rel="noopener noreferrer">
            @{c.instagram}
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
        Privacidade: o palpite de estado vem da localização aproximada pelo IP, sem GPS, e serve só pra indicar o atendimento. A sacola, as respostas do pedido e a conta do Teste minha sorte ficam só neste aparelho. Quem entra num rateio manda nome, WhatsApp, estado e quantidade pro servidor da loja, só pra organizar o rateio.
      </p>
      {config.credito && (
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
