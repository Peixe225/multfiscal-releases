// Resumo: primeiro o que pede ação (quem tá esperando confirmar o pagamento, rateio que lotou ou chegou, prazo
// vencido), depois os rateios abertos com a barra, o dinheiro (pago e a receber) e as últimas entradas.
import { useState } from 'react'
import * as api from '../api'
import { ArteRateio } from '../Arte'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { guardar, useDados } from '../dados'
import { brl, falta, plural, relativo, vagas } from '../formato'
import { Link, Topo } from '../Moldura'
import { Blocos, Selo } from '../rateio-ui'
import { caminho } from '../rotas'
import type { ParticipanteComTitulo, RateioAdmin, Resumo as TResumo } from '../tipos'
import { Aviso, Carregando, Ic, TituloTela } from '../ui'
import { BotaoWhats, NOME_VAGA, avisoDeAgora, pedirConfirmarPagamento } from '../vaga'
import { useRestaurarRolagem } from './comum'

interface Dados {
  resumo: TResumo
  rateios: RateioAdmin[]
}

interface Pendencia {
  id: string
  rateio: RateioAdmin
  texto: string
  sub: string
}

function pendencias(lista: RateioAdmin[], agora: number): Pendencia[] {
  const out: Pendencia[] = []
  for (const r of lista) {
    if (r.status === 'fechado') out.push({ id: `${r.id}-f`, rateio: r, texto: `${r.titulo} fechou`, sub: 'Faz o pedido e marca “Pedido feito” pra avisar a galera.' })
    else if (r.status === 'chegou') out.push({ id: `${r.id}-c`, rateio: r, texto: `${r.titulo} chegou`, sub: `Entrega pra cada um. ${r.totais.entregues}/${r.confirmadas} vagas entregues.` })
    else if (r.status === 'aberto' && r.fechaEm && Date.parse(r.fechaEm) <= agora)
      out.push({ id: `${r.id}-p`, rateio: r, texto: `Prazo de ${r.titulo} acabou`, sub: `${r.confirmadas}/${r.vagas} pagas. Fecha agora ou muda a data pra seguir aberto.` })
    else if (r.status === 'aberto' && r.disponiveis === 0 && r.confirmadas < r.vagas)
      out.push({ id: `${r.id}-v`, rateio: r, texto: `${r.titulo}: vagas tomadas`, sub: `Falta pagamento de ${plural(r.reservadas, 'vaga reservada', 'vagas reservadas')}.` })
  }
  return out
}

function LinhaReserva({ p, rateio, aoConfirmar }: { p: ParticipanteComTitulo; rateio: RateioAdmin | undefined; aoConfirmar: () => void }) {
  const resta = p.expiraEm ? falta(p.expiraEm, api.agora()) : null
  const urgente = !!p.expiraEm && Date.parse(p.expiraEm) - api.agora() < 6 * 3600 * 1000
  const aviso = rateio ? avisoDeAgora(p, rateio) : null
  return (
    <li className="pn-reserva">
      <div className="pn-reserva-txt">
        <p className="pn-reserva-nome">
          <strong>{p.nome}</strong> <span className="pn-codigo">{p.codigo}</span>
        </p>
        <p className="pn-reserva-sub">
          {p.rateioTitulo} · {vagas(p.quantidade)} · <strong>{brl(p.total)}</strong>
        </p>
        {resta && <p className={`pn-reserva-prazo${urgente ? ' pn-urgente' : ''}`}>{urgente && <Ic nome="relogio" tamanho={16} />}vence em {resta}</p>}
      </div>
      <div className="pn-reserva-acoes">
        <button type="button" className="pn-botao pn-botao-cheio pn-botao-p" onClick={aoConfirmar}>
          <span className="pn-botao-txt">Confirmar pagamento</span>
          <span className="sr-only"> de {p.nome}</span>
        </button>
        {aviso && p.whatsapp && <BotaoWhats p={p} texto={aviso.texto} rotulo="Cobrar" variante="cinza" pequeno />}
      </div>
    </li>
  )
}

function fraseDoDia(pagamentos: number, rateios: number): string {
  if (!pagamentos && !rateios) return 'Nada esperando por ti agora.'
  const a = pagamentos ? plural(pagamentos, 'pagamento pra confirmar', 'pagamentos pra confirmar') : ''
  const b = rateios ? plural(rateios, 'rateio pedindo atenção', 'rateios pedindo atenção') : ''
  return `Tem ${[a, b].filter(Boolean).join(' e ')}.`
}

export function Resumo({ nome }: { nome: string }) {
  const leitura = useDados<Dados>('resumo', async (s) => {
    const [a, b] = await Promise.all([api.resumo(s), api.rateios(s)])
    guardar('rateios', b)
    return { resumo: a, rateios: b.rateios }
  })
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  useRestaurarRolagem(!!leitura.dados)
  const d = leitura.dados
  const agora = api.agora()

  const porId = new Map(d?.rateios.map((r) => [r.id, r]))
  const lista = d ? pendencias(d.rateios, agora) : []
  const abertos = d?.rateios.filter((r) => r.status === 'aberto') ?? []
  const andamento = d?.rateios.filter((r) => ['pedido', 'caminho'].includes(r.status)) ?? []
  const esperando = d?.resumo.esperandoPagamento ?? []

  return (
    <>
      <Topo marca titulo={<TituloTela focar={false}>Resumo</TituloTela>} acoes={<Link href={caminho.novo} className="pn-botao pn-botao-cheio pn-botao-p pn-so-celular-nao"><Ic nome="mais" tamanho={16} /><span className="pn-botao-txt">Criar rateio</span></Link>} />
      <div className="pn-pagina pn-resumo">
        <p className="pn-oi">
          Oi, {nome.split(' ')[0]}.{' '}
          {d && fraseDoDia(esperando.length, lista.length)}
        </p>
        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!d && !leitura.erro && <Carregando />}
        {d && (
          <div className="pn-resumo-grade">
            <div className="pn-col">
            <section className="pn-bloco pn-resumo-acao" aria-labelledby="h-acao">
              <h2 id="h-acao" className="pn-h2">
                Pede tua ação
              </h2>
              {lista.length === 0 && esperando.length === 0 && (
                <p className="pn-vazio">
                  <Ic nome="check" tamanho={16} /> Tudo em dia. Quando alguém entrar num rateio pelo site, aparece aqui.
                </p>
              )}
              {lista.length > 0 && (
                <ul className="pn-pendencias">
                  {lista.map((x) => (
                    <li key={x.id}>
                      <Link href={caminho.rateio(x.rateio.id)} className="pn-pendencia toque">
                        <ArteRateio produtoId={x.rateio.produtoId} imagem={x.rateio.imagem} largura={36} halo={false} />
                        <span className="pn-pendencia-txt">
                          <strong>{x.texto}</strong>
                          <span>{x.sub}</span>
                        </span>
                        <Ic nome="chevron-dir" tamanho={16} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {esperando.length > 0 && (
                <>
                  <h3 className="pn-h3">
                    Esperando pagamento <span className="pn-conta">{d.resumo.reservas.pessoas}</span>
                  </h3>
                  <p className="pn-dica-bloco">Confirma quando o Pix cair. A que vence antes vem primeiro.</p>
                  <ul className="pn-reservas">
                    {esperando.map((p) => (
                      <LinhaReserva
                        key={p.id}
                        p={p}
                        rateio={porId.get(p.rateio)}
                        aoConfirmar={() =>
                          setConfirmacao(
                            pedirConfirmarPagamento(p, porId.get(p.rateio) ?? null, () => void leitura.recarregar(), false),
                          )
                        }
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="pn-bloco pn-resumo-ultimas" aria-labelledby="h-ultimas">
              <div className="pn-h2-linha">
                <h2 id="h-ultimas" className="pn-h2">
                  Últimas entradas
                </h2>
                <Link href={caminho.atividade} className="pn-link">
                  Atividade
                </Link>
              </div>
              {d.resumo.ultimasEntradas.length === 0 ? (
                <p className="pn-vazio">Ninguém entrou ainda.</p>
              ) : (
                <ul className="pn-ultimas">
                  {d.resumo.ultimasEntradas.map((p) => (
                    <li key={p.id}>
                      <Link href={caminho.rateio(p.rateio)} className="pn-ultima toque">
                        <span className="pn-ultima-txt">
                          <strong>{p.nome}</strong> {p.origem === 'site' ? 'entrou pelo site' : 'incluído no painel'} · {vagas(p.quantidade)}
                          <span className="pn-ultima-sub">
                            {p.rateioTitulo} · {relativo(p.criadoEm, agora)}
                          </span>
                        </span>
                        <span className={`pn-chip pn-chip-${p.status}`}>{NOME_VAGA[p.status]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            </div>
            <div className="pn-col">
            <section className="pn-bloco pn-resumo-dinheiro" aria-labelledby="h-dinheiro">
              <h2 id="h-dinheiro" className="pn-h2">
                Dinheiro dos rateios
              </h2>
              <dl className="pn-dinheiro">
                <div>
                  <dt>Pago</dt>
                  <dd className="px">{brl(d.resumo.confirmado.valor)}</dd>
                  <dd className="pn-dinheiro-sub">
                    {plural(d.resumo.confirmado.pessoas, 'pessoa', 'pessoas')} · {vagas(d.resumo.confirmado.vagas)}
                  </dd>
                </div>
                <div>
                  <dt>A receber</dt>
                  <dd className="px">{brl(d.resumo.reservas.aReceber)}</dd>
                  <dd className="pn-dinheiro-sub">
                    {plural(d.resumo.reservas.pessoas, 'reserva', 'reservas')}
                    {d.resumo.reservas.vencendo > 0 ? ` · ${d.resumo.reservas.vencendo} vence${d.resumo.reservas.vencendo === 1 ? '' : 'm'} em menos de 6 h` : ''}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="pn-bloco pn-resumo-abertos" aria-labelledby="h-abertos">
              <div className="pn-h2-linha">
                <h2 id="h-abertos" className="pn-h2">
                  Rateios abertos
                </h2>
                <Link href={caminho.rateios} className="pn-link">
                  Ver todos
                </Link>
              </div>
              {abertos.length === 0 ? (
                <p className="pn-vazio">Nenhum aberto agora.</p>
              ) : (
                <ul className="pn-lista-rateios">
                  {abertos.map((r) => (
                    <li key={r.id}>
                      <CartaoLinha r={r} />
                    </li>
                  ))}
                </ul>
              )}
              <Link href={caminho.novo} className="pn-botao pn-botao-cinza pn-botao-largo">
                <Ic nome="mais" tamanho={16} />
                <span className="pn-botao-txt">Criar rateio</span>
              </Link>
            </section>

            {andamento.length > 0 && (
              <section className="pn-bloco pn-resumo-andamento" aria-labelledby="h-andamento">
                <h2 id="h-andamento" className="pn-h2">
                  A caminho
                </h2>
                <ul className="pn-lista-rateios">
                  {andamento.map((r) => (
                    <li key={r.id}>
                      <CartaoLinha r={r} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            </div>
          </div>
        )}
      </div>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}

/** Linha de um rateio nas listas: arte, título, selo e a barra de vagas. */
export function CartaoLinha({ r }: { r: RateioAdmin }) {
  return (
    <Link href={caminho.rateio(r.id)} className="pn-rlinha toque">
      <ArteRateio produtoId={r.produtoId} imagem={r.imagem} largura={44} apagada={r.status === 'cancelado'} />
      <span className="pn-rlinha-txt">
        <span className="pn-rlinha-topo">
          <strong className="pn-rlinha-titulo">{r.titulo}</strong>
        </span>
        <span className="pn-rlinha-meio">
          <Selo status={r.status} pequeno />
          <span className="pn-rlinha-num">
            <span className="px">
              {r.confirmadas}/{r.vagas}
            </span>{' '}
            pagas{r.reservadas > 0 ? ` · +${r.reservadas} ${r.reservadas === 1 ? 'reservada' : 'reservadas'}` : ''}
          </span>
        </span>
        <Blocos vagas={r.vagas} confirmadas={r.confirmadas} reservadas={r.reservadas} />
      </span>
      <Ic nome="chevron-dir" tamanho={16} />
    </Link>
  )
}
