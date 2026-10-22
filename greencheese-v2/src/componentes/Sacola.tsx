import { useEffect, useRef } from 'react'
import { useConferirCupom, useCupomAutomatico } from '../lib/cupom-pedido'
import { esquecerAjustes, foiAjustado } from '../lib/estoque'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { PixelArte } from '../arte/PixelArte'
import { ilustracoes } from '../arte/pixel/grades'
import { palpebrasGarrafa } from '../arte/pixel/mercador-garrafa'
import { brl, plural } from '../lib/formato'
import { depoisDoHistorico } from '../lib/historico'
import { modoBairro } from '../lib/bairros'
import { entregaDoCanal, entregaDoPedido, nomeNaMensagem, textoSubtotal, totais, type Entrega } from '../lib/mensagem'
import { minimoDoCanal } from '../lib/pedido-minimo'
import { calcularLinha } from '../lib/preco'
import { disponivelEm, produtoPorId } from '../store/catalogo'
import { useDisponiveis, useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useCanalDa, useLojaConferida, useTextosLoja } from '../store/loja'
import { contarItens, MAX_POR_ITEM, useSacola, type ItemSacola } from '../store/sacola'
import { useBairroDa } from '../store/bairro'
import { useUI } from '../store/ui'
import { BairroTaxa } from './BairroTaxa'
import { Icone } from './comum'
import { CupomSacola } from './CupomSacola'
import { FecharSacola } from './FecharSacola'
import { Folha } from './Folha'
import './Sacola.css'

/**
 * "Piteira de vidro RAW (Slim)": o nome guardado no item, com a opção de antes. Item guardado antes do retrato existir
 * fica com o id escrito por extenso (o id sai do nome: "coca-cola-cherry" → "Coca cola cherry").
 */
function nomeGuardado(item: ItemSacola, nomeAtual?: string): string {
  const porExtenso = item.id.replace(/-+/g, ' ').trim()
  const nome = item.nome ?? nomeAtual ?? `${porExtenso.charAt(0).toUpperCase()}${porExtenso.slice(1)}`
  return item.variacaoNome ? `${nome} (${item.variacaoNome})` : nome
}

/** O texto da entrega embaixo do subtotal: a taxa do painel, o dia de entrega grátis, ou a confirmar. */
function textoEntrega(canal: ReturnType<typeof useCanalDa>): string {
  const e = canal ? entregaDoCanal(canal) : null
  if (e === 'gratis') return 'Entrega grátis hoje.'
  // taxa 0 no painel: o dono disse que a entrega não tem taxa (nada de "R$ 0,00 … a loja confirma")
  if (e === 0) return 'Entrega grátis.'
  if (e != null) return `Entrega: ${brl(e)} (a loja confirma no atendimento).`
  return 'Entrega: taxa a confirmar no atendimento.'
}

/**
 * A entrega com a taxa por bairro, na sacola compacta (o resumo do pedido guiado): uma linha só, sem o campo.
 * "Entrega: Copacabana, taxa R$ 12,00." · "Entrega: taxa do bairro a consultar." · "Entrega: a taxa depende do bairro."
 */
function textoEntregaBairro(e: Entrega): string {
  switch (e.tipo) {
    case 'gratis-hoje':
      return 'Entrega grátis hoje.'
    case 'estado':
      return e.valor === 0 ? 'Entrega grátis.' : e.valor != null ? `Entrega: ${brl(e.valor)} (a loja confirma no atendimento).` : 'Entrega: taxa a confirmar no atendimento.'
    case 'bairro':
      return e.valor === 0 ? `Entrega grátis no bairro ${e.bairro}.` : `Entrega: bairro ${e.bairro}, taxa ${brl(e.valor)} (a loja confirma).`
    case 'bairro-consultar':
      return e.bairro ? `Entrega: bairro ${e.bairro}, taxa a consultar no atendimento.` : 'Entrega: a taxa depende do bairro.'
    case 'consulta':
      return 'Entrega: a taxa depende do bairro (a loja passa na conversa).'
  }
}

/** Linhas da sacola já no formato da mensagem do pedido. */
export function ListaSacola({ compacta = false }: { compacta?: boolean }) {
  const { pedido, fora, saiu } = useLinhasSacola()
  const alterar = useSacola((s) => s.alterar)
  const remover = useSacola((s) => s.remover)
  const abrirPagina = useUI((s) => s.abrirPagina)
  const setSacola = useUI((s) => s.setSacola)
  const conferida = useLojaConferida()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = useCanalDa(uf)
  const lugar = nomeCidade(canal, cidade, cidadeInformada) ?? canal?.nome ?? 'teu estado'
  const t = totais(pedido)
  const minimo = minimoDoCanal(canal)
  // a taxa por bairro (22/10): o "Teu bairro" no lugar da linha da entrega (no dia de entrega grátis, a linha de sempre)
  const bairro = useBairroDa(uf)
  const cidadeDoPedido = canal ? (nomeCidade(canal, cidade, cidadeInformada) ?? (canal.cidades.length === 1 ? canal.cidades[0].nome : null)) : null
  const entregaBairro = canal && modoBairro(canal) ? entregaDoPedido(canal, bairro, cidadeDoPedido) : null
  // o que ainda cabe de cada produto (o "restam X" é do produto: as variações dividem)
  const noPedido = new Map<string, number>()
  for (const l of pedido) noPedido.set(l.item.id, (noPedido.get(l.item.id) ?? 0) + l.qtd)
  const cabeMais = (id: string, limite: number | null) => (limite == null ? Infinity : limite - (noPedido.get(id) ?? 0))
  // e o teto de cada linha (99 da mesma opção): o "Mais um" desliga e a linha avisa
  const noTeto = (qtd: number) => qtd >= MAX_POR_ITEM

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
                {!compacta && l.limite != null && (cabeMais(l.item.id, l.limite) <= 0 || foiAjustado(l.item.id, l.item.variacao)) && (
                  <p className="ls-restam legenda">
                    {l.limite === 1 ? 'Só resta 1 unidade' : `Só restam ${l.limite} unidades`} em {lugar}
                    {foiAjustado(l.item.id, l.item.variacao) ? ': ajustei a quantidade.' : '.'}
                  </p>
                )}
                {!compacta && noTeto(l.qtd) && <p className="ls-restam legenda">Até {MAX_POR_ITEM} por item.</p>}
                {l.precoAntes !== undefined && (
                  <p className="ls-restam ls-preco-novo legenda">Preço novo: era {l.precoAntes == null ? 'a consultar' : `${brl(l.precoAntes)} a unidade`}.</p>
                )}
              </div>
              {!compacta && (
                <div className="ls-qtd-ctrl" role="group" aria-label={`Quantidade de ${l.produto.nome}`}>
                  <button type="button" className="icone-botao toque" onClick={() => alterar(l.item.id, l.item.variacao, l.qtd - 1)} aria-label={l.qtd === 1 ? 'Tirar da sacola' : 'Menos um'}>
                    <Icone nome="menos" tamanho={16} />
                  </button>
                  <span className="px px-16" aria-live="polite">
                    {l.qtd}
                  </span>
                  <button
                    type="button"
                    className="icone-botao toque"
                    onClick={() => alterar(l.item.id, l.item.variacao, l.qtd + 1)}
                    aria-label="Mais um"
                    disabled={cabeMais(l.item.id, l.limite) <= 0 || noTeto(l.qtd)}
                  >
                    <Icone nome="mais" tamanho={16} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {fora.some((l) => l.motivo === 'estado') && (
        <div className="ls-fora">
          <p className="legenda">Não tem em {lugar} agora (fica fora do pedido):</p>
          <ul>
            {fora
              .filter((l) => l.motivo === 'estado')
              .map((l) => (
                <li key={`${l.item.id}-${l.item.variacao}`}>
                  <span className="ls-fora-nome">
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
      {/* saiu da loja (o produto, ou a opção escolhida): fica fora do pedido, com o nome de quando entrou na sacola */}
      {(saiu.length > 0 || fora.some((l) => l.motivo !== 'estado')) && (
        <div className="ls-fora ls-saiu">
          <p className="legenda">Saiu da loja (fica fora do pedido):</p>
          <ul>
            {fora
              .filter((l) => l.motivo === 'variacao' || l.motivo === 'saiu')
              .map((l) => (
                <li key={`${l.item.id}-${l.item.variacao}`}>
                  <span className="ls-fora-txt">
                    <span className="ls-fora-nome">
                      {l.qtd}x {l.motivo === 'variacao' ? nomeGuardado(l.item, l.produto.nome) : (l.item.nome ?? nomeNaMensagem(l))}
                    </span>
                    <span className="ls-fora-motivo">{l.motivo === 'variacao' ? `A opção ${l.item.variacaoNome ?? 'escolhida'} não tem mais. Escolhe outra.` : 'Esse produto saiu da loja.'}</span>
                  </span>
                  {!compacta && (
                    <span className="ls-fora-acoes">
                      {l.motivo === 'variacao' && (
                        <button
                          type="button"
                          className="ls-tirar toque"
                          onClick={() => {
                            // a sacola sai do histórico primeiro; a página do produto (pra escolher outra opção) entra depois
                            setSacola(false)
                            depoisDoHistorico(() => abrirPagina(l.item.id, 'sacola'))
                          }}
                        >
                          Trocar
                        </button>
                      )}
                      <button type="button" className="ls-tirar toque" onClick={() => remover(l.item.id, l.item.variacao)} aria-label={`Tirar ${nomeGuardado(l.item, l.produto.nome)}`}>
                        Tirar
                      </button>
                    </span>
                  )}
                </li>
              ))}
            {saiu.map((i) => (
              <li key={`${i.id}-${i.variacao}`}>
                <span className="ls-fora-txt">
                  <span className="ls-fora-nome">
                    {i.qtd}x {nomeGuardado(i)}
                  </span>
                  <span className="ls-fora-motivo">{conferida ? 'Esse produto saiu da loja.' : 'Conferindo na loja…'}</span>
                </span>
                {!compacta && (
                  <button type="button" className="ls-tirar toque" onClick={() => remover(i.id, i.variacao)} aria-label={`Tirar ${nomeGuardado(i)}`}>
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
      {pedido.length > 0 &&
        (!entregaBairro || entregaBairro.tipo === 'gratis-hoje' ? (
          <p className="ls-taxa legenda">{textoEntrega(canal)}</p>
        ) : compacta || !canal ? (
          <p className="ls-taxa legenda">{textoEntregaBairro(entregaBairro)}</p>
        ) : (
          <BairroTaxa canal={canal} cidade={cidadeDoPedido} variante="sacola" subtotal={{ valor: t.subtotal, temConsultar: t.temConsultar }} />
        ))}
      {/* o pedido mínimo do estado, junto da entrega (o quanto falta, quando falta, fica no rodapé, perto do botão) */}
      {pedido.length > 0 && minimo != null && <p className="ls-taxa legenda">Pedido mínimo pra entrega: {brl(minimo)}.</p>}
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
  const uf = useLocal((s) => s.uf)
  const disponiveis = useDisponiveis()
  const textos = useTextosLoja()
  const n = contarItens(itens)
  // o cupom aplicado ainda vale? (vencido, usado ou fora da conta sai com aviso)
  useConferirCupom(aberta)
  // o cupom da conta que vale nesta sacola entra sozinho (22/10): ao abrir, e a cada mudança até a hora de fechar
  useCupomAutomatico(aberta)
  // o aviso "ajustei a quantidade" e o "preço novo" valem até a sacola fechar (só no fechar: a folha monta fechada,
  // depois do ajuste); fechou, o retrato de cada item acompanha a loja
  const abertaAntes = useRef(aberta)
  useEffect(() => {
    if (abertaAntes.current && !aberta) {
      esquecerAjustes()
      useSacola.getState().conferirRetratos()
    }
    abertaAntes.current = aberta
  }, [aberta])

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
      // o caminho direto: um toque e o WhatsApp abre com o pedido pronto (o pedido guiado fica como opção embaixo)
      rodape={itens.length > 0 ? <FecharSacola /> : undefined}
    >
      {itens.length === 0 ? (
        <div className="sacola-vazia">
          <div className="sacola-vazia-figura">
            <PixelArte grade={ilustracoes.mercadorGarrafa} tamanho={132} ancora="base" className="sacola-vazia-arte" />
            <PixelArte grade={palpebrasGarrafa} tamanho={132} ancora="base" className="sacola-vazia-piscar" />
          </div>
          <p className="adesivo-texto-bloco">
            <span className="adesivo-texto">{textos.sacolaVazia}</span>
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
              <button type="button" className="botao botao-contorno" onClick={() => adicionar(sugestao.id, sugestao.variacoes?.[0]?.id ?? null, 1)}>
                Pôr junto
              </button>
            </div>
          )}
        </div>
      )}
    </Folha>
  )
}
