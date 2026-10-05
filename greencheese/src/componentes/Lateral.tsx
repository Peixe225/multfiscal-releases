import { Fragment } from 'react'
import { config } from '../dados/config'
import { canais, perfisAConfirmar } from '../dados/canais'
import { Logo } from '../arte/Logo'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { useConta, useCupons } from '../lib/conta'
import { copiarTexto } from '../lib/copiar'
import { rolarPara } from '../lib/rolagem'
import { useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import { Folha } from './Folha'
import { AdesivoLocal, EnqueteLocal, useTextoLocal } from './Local'
import './Lateral.css'

/** Desktop: barra lateral no molde do instagram.com, com o adesivo de localização sempre à vista. */
export function Lateral() {
  const { texto, procurando } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const setSacola = useUI((s) => s.setSacola)
  const setPainel = useUI((s) => s.setPainel)
  const abrirChat = useChat((s) => s.abrir)
  const n = useSacola((s) => contarItens(s.itens))
  const itens: { icone: string; rotulo: string; acao: () => void; extra?: React.ReactNode }[] = [
    { icone: 'estrela', rotulo: 'Início', acao: () => rolarPara('#raiz', 0) },
    {
      icone: 'lupa',
      rotulo: 'Buscar',
      acao: () => {
        rolarPara('#catalogo', -20)
        setTimeout(() => document.querySelector<HTMLInputElement>('.busca input')?.focus({ preventScroll: true }), 500)
      },
    },
    { icone: 'garrafa', rotulo: 'Catálogo', acao: () => rolarPara('#catalogo', -20) },
    { icone: 'balao', rotulo: 'Pedido guiado', acao: () => abrirChat('pedido') },
    { icone: 'sacola', rotulo: 'Sacola', acao: () => setSacola(true), extra: n > 0 ? <span className="lateral-contador px">{n}</span> : null },
    { icone: 'moto', rotulo: 'Por estado', acao: () => rolarPara('#estados', -20) },
  ]
  return (
    <aside className="lateral" aria-label="Navegação">
      <button type="button" className="lateral-marca" onClick={() => rolarPara('#raiz', 0)} aria-label="Green Cheese Imports — início">
        <Logo tamanho={44} />
        <span className="px px-20">GREEN CHEESE</span>
      </button>
      <div className="lateral-local">
        <AdesivoLocal texto={texto} procurando={procurando} inclinacao={-3} aoTocar={() => setSeletor(true)} />
        <EnqueteLocal className="lateral-enquete" />
      </div>
      <nav className="lateral-nav">
        {itens.map((i) => (
          <Fragment key={i.rotulo}>
            <button type="button" className="lateral-item toque" onClick={i.acao}>
              <Icone nome={i.icone} tamanho={24} />
              <span>{i.rotulo}</span>
              {i.extra}
            </button>
            {/* depois da Sacola: os interativos e, com conta, a Minha conta */}
            {i.icone === 'sacola' && (
              <>
                {interativosAtivos().map((x) => (
                  <ItemInterativo key={x.id} i={x} />
                ))}
                <ItemConta />
              </>
            )}
          </Fragment>
        ))}
      </nav>
      {config.modoPrevia && (
        <button type="button" className="lateral-previa toque" onClick={() => setPainel(true)}>
          <span className="carimbo">prévia</span>
          <span className="legenda">o que falta pra ficar oficial</span>
        </button>
      )}
    </aside>
  )
}

/** Item de um interativo na lateral, com o ponto branco de pixel quando tem coisa liberada. */
function ItemInterativo({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
  return (
    <button type="button" className="lateral-item lateral-item-ponto toque" onClick={() => abrir(i.id)}>
      <Icone nome={i.icone} tamanho={24} />
      <span>
        {i.titulo}
        {e.ponto && <span className="sr-only"> · liberado</span>}
      </span>
      {e.ponto && <span className="lateral-ponto" aria-hidden="true" />}
    </button>
  )
}

/** "Minha conta" (só com conta), com o contador de cupons ativos. */
function ItemConta() {
  const conta = useConta()
  const cupons = useCupons()
  const setConta = useUI((s) => s.setConta)
  if (!conta) return null
  const n = cupons.filter((c) => c.status === 'ativo').length
  return (
    <button type="button" className="lateral-item toque" onClick={() => setConta(true)}>
      <Icone nome="conta" tamanho={24} />
      <span>
        Minha conta
        {n > 0 && <span className="sr-only">: {n === 1 ? '1 cupom ativo' : `${n} cupons ativos`}</span>}
      </span>
      {n > 0 && (
        <span className="lateral-contador px" aria-hidden="true">
          {n}
        </span>
      )}
    </button>
  )
}

/** Selo "prévia" discreto (celular). */
export function SeloPrevia() {
  const setPainel = useUI((s) => s.setPainel)
  if (!config.modoPrevia) return null
  return (
    <button type="button" className="selo-previa carimbo toque" onClick={() => setPainel(true)} aria-label="Prévia: ver o que falta pra ficar oficial">
      prévia
    </button>
  )
}

/** Painel da prévia: o que ainda é PENDENTE ou demo, lido direto dos dados, e os links de bio por estado. */
export function PainelPrevia() {
  const aberto = useUI((s) => s.painelPrevia)
  const setPainel = useUI((s) => s.setPainel)
  const avisar = useUI((s) => s.avisar)
  const produtos = useCatalogo((s) => s.produtos)
  if (!config.modoPrevia) return null
  const semZap = canais.filter((c) => !c.whatsapp).map((c) => c.uf.toUpperCase())
  const semCidade = canais.filter((c) => c.cidades.length === 0).map((c) => c.uf.toUpperCase())
  const consultar = produtos.filter((p) => !p.demo && p.preco == null).map((p) => p.nome)
  const exemplos = produtos.filter((p) => p.demo).length
  const semFoto = produtos.filter((p) => !p.demo && !p.foto).length
  const base = config.urlPublica.replace(/\/?$/, '/')
  return (
    <Folha id="previa" aberta={aberto} aoFechar={() => setPainel(false)} rotulo="Prévia: pendências" cabecalho={<span>Prévia · I&H Soluções Digitais</span>}>
      <div className="previa">
        <p className="previa-intro">Tudo funciona até a mensagem pronta no WhatsApp. Pra ficar oficial, falta o dono passar:</p>
        <ul className="previa-lista">
          <li>
            <strong>WhatsApp de cada estado</strong> — {semZap.join(', ') || 'ok'}. Sem número, o pedido abre o WhatsApp pra escolher o contato ou vai pela DM.
          </li>
          <li>
            <strong>Cidades atendidas</strong> — {semCidade.join(', ') || 'ok'} (hoje o pedido pergunta a cidade).
          </li>
          <li>
            <strong>Horário, taxa de entrega e pagamento</strong> — estão como <span className="carimbo">demo</span> nos 5 estados.
          </li>
          <li>
            <strong>Preço</strong> de {consultar.length} produtos reais (aparecem como "Consultar"): {consultar.join(', ')}.
          </li>
          <li>
            <strong>Fotos oficiais</strong> — {semFoto} produtos reais estão em pixel art feita em código.
          </li>
          <li>
            <strong>{exemplos} produtos de exemplo</strong> (marcados "exemplo") completam a vitrine e somem quando a prévia for desligada.
          </li>
          <li>
            <strong>Disponibilidade por estado</strong> — confirmada só onde o produto apareceu nos stories.
          </li>
          {interativosAtivos().length > 0 && (
            <li>
              <strong>Teste minha sorte</strong> — prêmios de exemplo (src/dados/sorte.ts). A conta, os cupons e o limite de giros ficam só neste aparelho; na versão
              oficial, o prêmio, o código e o limite são validados no servidor.
            </li>
          )}
          {perfisAConfirmar.map((p) => (
            <li key={p.instagram}>
              <strong>@{p.instagram}</strong> — {p.obs}: confirmar se é perfil oficial.
            </li>
          ))}
        </ul>
        <h3 className="previa-titulo">Link pra bio de cada perfil</h3>
        <ul className="previa-links">
          {canais.map((c) => {
            const url = `${base}?uf=${c.uf}${c.cidades.length === 1 ? `&cidade=${c.cidades[0].slug}` : ''}`
            return (
              <li key={c.uf}>
                <span className="px px-16">{c.uf.toUpperCase()}</span>
                <code>{url.replace(/^https?:\/\//, '')}</code>
                <button
                  type="button"
                  className="botao botao-contorno"
                  onClick={() => avisar(copiarTexto(url) ? `Link do ${c.uf.toUpperCase()} copiado.` : 'Não deu pra copiar.')}
                >
                  <Icone nome="copiar" tamanho={16} />
                  Copiar
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Folha>
  )
}

/** Aviso curto (toast), anunciado para leitor de tela. */
export function Aviso() {
  const aviso = useUI((s) => s.aviso)
  return (
    <div className="aviso-area" aria-live="polite" role="status">
      {aviso && (
        <p key={aviso.id} className="aviso">
          {aviso.texto}
        </p>
      )}
    </div>
  )
}
