import { config } from '../dados/config'
import { alvoDeSaida } from '../lib/ambiente'
import { linkDM, linkPerfil } from '../lib/mensagem'
import { useLocal } from '../store/local'
import { useCanais, useCanalDa } from '../store/loja'
import './Rodape.css'

/** "Chegou teu pedido? Marca @… no story." */
export function TextoReposts() {
  const uf = useLocal((s) => s.uf)
  const canais = useCanais()
  const canal = useCanalDa(uf) ?? canais[0]
  return (
    <p className="reposts-txt">
      Chegou teu pedido? Marca <strong>@{canal.instagram}</strong> no story.
    </p>
  )
}

/** Rodapé no molde do instagram.com: os perfis dos estados, avisos, privacidade e o crédito. */
export function Rodape() {
  // estado escolhido ou palpitado: a dúvida vai direto pra DM dele
  const canal = useCanalDa(useLocal((s) => s.uf))
  const canais = useCanais()
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
        Privacidade: o palpite de estado vem da localização aproximada pelo IP, sem GPS, e serve só pra indicar o atendimento. A sacola, as respostas do pedido e a conta do Teste minha sorte ficam só neste aparelho. Quem entra num rateio manda nome, WhatsApp, estado, cidade e quantidade pro servidor da loja, só pra organizar o rateio, e uma cópia das tuas vagas fica neste aparelho pra tu acompanhar.
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
