import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { interativoPorId } from '../interativos/registro'
import { ID_SORTE, useEstadoSorte } from '../interativos/sorte/estado'
import { T } from '../interativos/sorte/textos'
import { formatarAte } from '../lib/cupom'
import { useCupomNoPedido } from '../lib/cupom-pedido'
import { nomeCategoria, nomeDoPremio, type Situacao } from '../lib/cupom-uso'
import { depoisDoHistorico } from '../lib/historico'
import type { Produto } from '../lib/tipos'
import { disponivelEm } from '../store/catalogo'
import { useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI, type TelaInterativo } from '../store/ui'
import { Icone } from './comum'
import './CupomSacola.css'

// Cupom na sacola: a linha do cupom aplicado (com a situação dele neste pedido) ou, sem cupom, um convite discreto
// pro "Teste minha sorte". O subtotal nunca muda nem aparece riscado: o desconto é confirmado pela loja no WhatsApp.

const DESCONTO_LOJA = 'desconto confirmado pela loja'

function abrirJogo(tela?: TelaInterativo) {
  useUI.getState().setSacola(false)
  depoisDoHistorico(() => useUI.getState().abrirInterativo(ID_SORTE, tela))
}

export function CupomSacola({ compacta = false }: { compacta?: boolean }) {
  const { cupom, situacao } = useCupomNoPedido()
  if (cupom && situacao)
    return <CupomAplicado codigo={cupom.codigo} titulo={nomeDoPremio(cupom.retrato)} exemplo={cupom.demo && config.carimboDeExemplo} situacao={situacao} compacta={compacta} />
  if (compacta) return null
  return <ConviteCupom />
}

/** Carimbo "exemplo" do cupom de demonstração (prévia), como no cartão, no adesivo e na Minha conta. */
function Exemplo() {
  return <span className="carimbo cs-exemplo">{T.exemplo}</span>
}

function CupomAplicado({ codigo, titulo, exemplo, situacao, compacta }: { codigo: string; titulo: string; exemplo: boolean; situacao: Situacao; compacta: boolean }) {
  const tirar = useSacola((s) => s.tirarCupom)
  const adicionar = useSacola((s) => s.adicionar)
  const { todas } = useLinhasSacola()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const lugar = nomeCidade(canal, cidade, cidadeInformada) ?? canal?.nome ?? 'teu estado'
  const linha = (
    <p className="cs-linha">
      <Icone nome="dichavador" tamanho={16} />
      <span>
        Cupom <span className="px px-16 cs-codigo">{codigo}</span> — {titulo}
        {exemplo && (
          <>
            {' '}
            <Exemplo />
          </>
        )}
      </span>
    </p>
  )
  if (compacta) {
    if (situacao.tipo !== 'ok') return null
    return (
      <div className="cupom-sacola compacta">
        {linha}
        <p className="legenda cs-nota">{DESCONTO_LOJA}</p>
      </div>
    )
  }
  const botaoTirar = (
    <button type="button" className="cs-botao toque" onClick={tirar} aria-label={`Tirar o cupom ${codigo}`}>
      {T.tirar}
    </button>
  )
  const por = (p: Produto, qtd: number, rotulo: string) =>
    disponivelEm(p, uf) && (
      <button
        type="button"
        className="cs-botao toque"
        onClick={() => {
          const naSacola = todas.find((l) => l.produto.id === p.id)
          adicionar(p.id, naSacola?.item.variacao ?? p.variacoes?.[0]?.id ?? null, qtd)
        }}
      >
        {rotulo}
      </button>
    )

  let texto: string
  let acao = botaoTirar
  switch (situacao.tipo) {
    case 'ok':
      return (
        <div className="cupom-sacola cs-ok">
          <div className="cs-txt">
            {linha}
            <p className="legenda cs-nota">{DESCONTO_LOJA}</p>
          </div>
          {botaoTirar}
        </div>
      )
    case 'falta-produto':
      if (situacao.produto) {
        texto = `Vale pra ${situacao.produto.nome}. Põe na sacola pra valer.`
        acao = por(situacao.produto, situacao.precisa, situacao.precisa > 1 ? `Pôr ${situacao.precisa} na sacola` : 'Pôr na sacola') || botaoTirar
      } else {
        const cat = nomeCategoria(situacao.categoria)
        texto = `Vale em pedido com ${cat}. Põe uma ${cat} na sacola pra valer.`
      }
      break
    case 'qtd-insuficiente': {
      const falta = situacao.precisa - situacao.tem
      const nome = situacao.produto?.nome ?? nomeCategoria(situacao.categoria)
      texto = `Pra valer, são ${situacao.precisa} ${nome} (tem ${situacao.tem}).`
      if (situacao.produto) acao = por(situacao.produto, falta, `Pôr mais ${falta}`) || botaoTirar
      break
    }
    case 'indisponivel-aqui':
      // estado sem atendimento: não é falta de estoque, a loja não chega lá (sem "agora", que promete que vai ter)
      texto = canal
        ? `${situacao.produto?.nome ?? 'O produto do cupom'} não tem em ${lugar} agora. O cupom fica guardado.`
        : 'A Green Cheese ainda não chegou no teu estado. O cupom fica guardado.'
      break
    case 'fora-do-catalogo':
      texto = 'Esse produto saiu do catálogo. Fala com a loja.'
      break
    default:
      return null
  }
  return (
    <div className="cupom-sacola cs-aviso">
      <div className="cs-txt">
        {linha}
        <p className="cs-nota">{texto}</p>
      </div>
      <div className="cs-acoes">
        {acao}
        {acao !== botaoTirar && botaoTirar}
      </div>
    </div>
  )
}

/** Sem cupom aplicado: os cupons guardados (até 3) ou um convite pro jogo, conforme o estado da pessoa. */
function ConviteCupom() {
  const r = useEstadoSorte()
  const aplicar = useSacola((s) => s.aplicarCupom)
  const setConta = useUI((s) => s.setConta)
  const avisar = useUI((s) => s.avisar)
  const uf = useLocal((s) => s.uf)
  const ativo = interativoPorId(ID_SORTE)?.ativo() ?? false
  // cupom só serve onde a loja atende (fora da área o caminho é a encomenda, que não leva cupom)
  if (r.conta && r.ativos.length && canalDa(uf)) {
    return (
      <div className="cupom-sacola cs-usar">
        <p className="cs-rot">Usar cupom</p>
        <div className="cs-chips">
          {r.ativos.slice(0, 3).map((c) => (
            <button
              key={c.codigo}
              type="button"
              className="cs-chip toque"
              onClick={() => {
                aplicar(c.codigo)
                avisar(T.cupomAplicado(c.codigo))
              }}
            >
              <span className="px px-16 cs-codigo">{c.codigo}</span> · {nomeDoPremio(c.retrato)}
              {c.demo && config.carimboDeExemplo && (
                <>
                  {' '}
                  <Exemplo />
                </>
              )}
            </button>
          ))}
          <button type="button" className="cs-ver toque" onClick={() => setConta(true)}>
            ver todos
          </button>
        </div>
      </div>
    )
  }
  if (!ativo) return null
  let texto: string | null = null
  let tela: TelaInterativo | undefined
  if (r.estado === 'A') texto = 'Testa tua sorte: pode sair cupom pra esse pedido'
  else if (r.estado === 'B' && r.pendente) {
    texto = `Teu prêmio tá guardado até ${formatarAte(r.pendente.expiraEm, r.agora)} · Guardar`
    tela = 'cadastro'
  } else if (r.estado === 'D') texto = 'Giro de hoje liberado'
  if (!texto) return null
  return (
    <button type="button" className="cupom-sacola cs-convite toque" onClick={() => abrirJogo(tela)}>
      <Icone nome="dichavador" tamanho={24} />
      <span>{texto}</span>
      <span className="cs-seta" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
