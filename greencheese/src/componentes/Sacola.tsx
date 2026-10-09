import { canalDa } from '../dados/canais'
import { textosLoja } from '../dados/textos-loja'
import { useConferirCupom } from '../lib/cupom-pedido'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { PixelArte } from '../arte/PixelArte'
import { ilustracoes } from '../arte/pixel/grades'
import { palpebrasGarrafa } from '../arte/pixel/mercador-garrafa'
import { brl, plural } from '../lib/formato'
import { depoisDoHistorico } from '../lib/historico'
import { nomeNaMensagem, textoSubtotal, totais } from '../lib/mensagem'
import { calcularLinha } from '../lib/preco'
import { disponivelEm, produtoPorId } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useDisponiveis, useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import { CupomSacola } from './CupomSacola'
import { Folha } from './Folha'
import './Sacola.css'

/** Linhas da sacola já no formato da mensagem do pedido. */
export function ListaSacola({ compacta = false }: { compacta?: boolean }) {
  const { pedido, fora } = useLinhasSacola()
  const alterar = useSacola((s) => s.alterar)
  const remover = useSacola((s) => s.remover)
  const { uf, cidade, cidadeInformada } = useLocal()
  const lugar = nomeCidade(canalDa(uf), cidade, cidadeInformada) ?? canalDa(uf)?.nome ?? 'teu estado'
  const t = totais(pedido)

  return (
    <div className={`lista-sacola ${compacta ? 'compacta' : ''}`}>
      <ul>
        {pedido.map((l) => {
          const c = calcularLinha(l.produto, l.qtd, l.variacaoId)
          return (
            <li key={`${l.item.id}-${l.item.variacao}`} className="ls-linha">
              {!compacta && (
                <div className="ls-mini">
                  <ProdutoVisual produto={l.produto} largura={45} revelar={false} brilho={false} />
                </div>
              )}
              <div className="ls-txt">
                <p className="ls-nome">
                  <span className="ls-qtd">{l.qtd}x</span> {nomeNaMensagem(l)}
                </p>
                <p className="ls-preco">
                  <span className="px px-16">{c.total == null ? 'Consultar' : brl(c.total)}</span>
                  {c.combos.map((cb) => (
                    <span key={cb.qtd} className="ls-combo px">
                      {cb.vezes > 1 ? `${cb.vezes}× ` : ''}
                      {cb.qtd} por {brl(cb.total)}
                    </span>
                  ))}
                </p>
              </div>
              {!compacta && (
                <div className="ls-qtd-ctrl" role="group" aria-label={`Quantidade de ${l.produto.nome}`}>
                  <button type="button" className="icone-botao toque" onClick={() => alterar(l.item.id, l.item.variacao, l.qtd - 1)} aria-label={l.qtd === 1 ? 'Tirar da sacola' : 'Menos um'}>
                    <Icone nome="menos" tamanho={16} />
                  </button>
                  <span className="px px-16" aria-live="polite">
                    {l.qtd}
                  </span>
                  <button type="button" className="icone-botao toque" onClick={() => alterar(l.item.id, l.item.variacao, l.qtd + 1)} aria-label="Mais um">
                    <Icone nome="mais" tamanho={16} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {fora.length > 0 && (
        <div className="ls-fora">
          <p className="legenda">Não tem em {lugar} agora (fica fora do pedido):</p>
          <ul>
            {fora.map((l) => (
              <li key={`${l.item.id}-${l.item.variacao}`}>
                <span>
                  {l.qtd}x {nomeNaMensagem(l)}
                </span>
                {!compacta && (
                  <button type="button" className="ls-tirar toque" onClick={() => remover(l.item.id, l.item.variacao)}>
                    Tirar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pedido.length > 0 && (
        <div className="ls-subtotal">
          <span>Subtotal</span>
          <span className="px px-24">{textoSubtotal(t, true)}</span>
        </div>
      )}
      {pedido.length > 0 && t.economia > 0 && <p className="ls-economia legenda">Combo aplicado: {brl(t.economia)} a menos.</p>}
      <CupomSacola compacta={compacta} />
      {pedido.length > 0 && <p className="ls-taxa legenda">Entrega: taxa a confirmar no atendimento.</p>}
    </div>
  )
}

export function SacolaFolha() {
  const aberta = useUI((s) => s.sacolaAberta)
  const setSacola = useUI((s) => s.setSacola)
  const abrirStory = useUI((s) => s.abrirStory)
  const itens = useSacola((s) => s.itens)
  const ultimo = useSacola((s) => s.ultimo)
  const repetirUltimo = useSacola((s) => s.repetirUltimo)
  const adicionar = useSacola((s) => s.adicionar)
  const { pedido } = useLinhasSacola()
  const abrirChat = useChat((s) => s.abrir)
  const chatAberto = useChat((s) => s.aberto)
  const uf = useLocal((s) => s.uf)
  const disponiveis = useDisponiveis()
  const n = contarItens(itens)
  // o cupom aplicado ainda vale? (vencido, usado ou fora da conta sai com aviso)
  useConferirCupom(aberta)

  // sugestão de combinação (dado da loja: Jack Daniel's + Coca-Cola Vanilla num post deles)
  const sugestoes = pedido
    .flatMap((l) => l.produto.combinaCom ?? [])
    .map((id) => produtoPorId(id))
    .filter((p): p is NonNullable<typeof p> => !!p && disponivelEm(p, uf) && !itens.some((i) => i.id === p.id))
  const sugestao = sugestoes[0]
  const base = sugestao ? pedido.find((l) => l.produto.combinaCom?.includes(sugestao.id)) : undefined

  return (
    <Folha
      id="sacola"
      aberta={aberta}
      aoFechar={() => setSacola(false)}
      rotulo="Sacola"
      cabecalho={
        <span>
          Sacola <span className="legenda">· {plural(n, 'item', 'itens')}</span>
        </span>
      }
      rodape={
        itens.length > 0 ? (
          <button
            type="button"
            className="botao botao-cheio botao-largo"
            disabled={pedido.length === 0}
            onClick={() => {
              setSacola(false)
              if (!chatAberto) abrirChat('pedido')
            }}
          >
            {chatAberto ? 'Voltar pro pedido' : 'Fazer pedido'}
          </button>
        ) : undefined
      }
    >
      {itens.length === 0 ? (
        <div className="sacola-vazia">
          <div className="sacola-vazia-figura">
            <PixelArte grade={ilustracoes.mercadorGarrafa} tamanho={132} ancora="base" className="sacola-vazia-arte" />
            <PixelArte grade={palpebrasGarrafa} tamanho={132} ancora="base" className="sacola-vazia-piscar" />
          </div>
          <p className="adesivo-texto-bloco">
            <span className="adesivo-texto">{textosLoja.sacolaVazia}</span>
          </p>
          <CupomSacola />
          {ultimo.length > 0 && (
            <button type="button" className="botao botao-contorno" onClick={repetirUltimo}>
              Repetir último pedido ({plural(contarItens(ultimo), 'item', 'itens')})
            </button>
          )}
          {disponiveis.length > 0 && (
            <div className="sacola-vazia-stories">
              {disponiveis.slice(0, 3).map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="sacola-vazia-story toque"
                  onClick={() => {
                    // a sacola (e a página do produto, se estava por baixo) sai do histórico primeiro; o story entra
                    // depois, senão a volta levaria a entrada e o ?p= dele (igual ao "Ver nos stories" da página)
                    setSacola(false)
                    if (useUI.getState().pagina) useUI.getState().fecharPagina()
                    const lista = disponiveis.map((x) => x.id)
                    depoisDoHistorico(() => abrirStory(lista, i))
                  }}
                  aria-label={`Ver ${p.nome}`}
                >
                  <ProdutoVisual produto={p} largura={54} revelar={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="sacola-corpo">
          <ListaSacola />
          {sugestao && base && (
            <div className="sacola-sugestao">
              <div className="ls-mini">
                <ProdutoVisual produto={sugestao} largura={45} revelar={false} brilho={false} />
              </div>
              <p>
                <span className="legenda">Combina com {base.produto.nome}:</span>
                <br />
                <strong>{sugestao.nome}</strong>
              </p>
              <button type="button" className="botao botao-contorno" onClick={() => adicionar(sugestao.id, null, 1)}>
                Pôr junto
              </button>
            </div>
          )}
        </div>
      )}
    </Folha>
  )
}
