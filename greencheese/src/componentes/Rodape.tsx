import { useSyncExternalStore } from 'react'
import { canais, canalDa, perfisAConfirmar } from '../dados/canais'
import { config } from '../dados/config'
import { PixelArte } from '../arte/PixelArte'
import { ilustracoes } from '../arte/pixel/grades'
import { palpebras } from '../arte/pixel/mercador'
import { linkPerfil } from '../lib/mensagem'
import { useLocal } from '../store/local'
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

/** Repost no molde do IG: o story da loja com o story do cliente dentro. Sem depoimento inventado: só a ilustração da marca. */
export function Reposts() {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf) ?? canais[0]
  const tamanho = useSyncExternalStore(assinarTela, lerTela, lerTelaServidor) ? 176 : 132
  return (
    <section className="reposts" aria-label="Clientes marcando a loja">
      <div className="repost">
        <div className="repost-cab">
          <Avatar tamanho={28} />
          <span>{canal.instagram}</span>
        </div>
        <div className="repost-dentro">
          {/* decorativo: a legenda embaixo já diz o que importa. As pálpebras, na mesma grade, piscam por cima dos olhos. */}
          <div className="repost-figura">
            <PixelArte grade={ilustracoes.mercador} tamanho={tamanho} className="repost-arte" />
            <PixelArte grade={palpebras} tamanho={tamanho} className="repost-piscar" />
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
        Privacidade: o palpite de estado vem da localização aproximada pelo IP, sem GPS, e serve só pra indicar o atendimento. A sacola e as respostas ficam guardadas só neste aparelho; nada vai pra servidor da loja.
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
