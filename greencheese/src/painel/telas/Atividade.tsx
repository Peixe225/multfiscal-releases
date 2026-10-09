// Atividade: o que aconteceu (entradas pelo site, pagamentos confirmados, reservas que venceram, passos do rateio, o
// que mudou na loja), do mais novo pro mais velho, no molde das notificações do Instagram.
import * as api from '../api'
import { useDados } from '../dados'
import { dia, hora, relativo } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import type { Evento } from '../tipos'
import { Aviso, Carregando, Ic, TituloTela } from '../ui'
import { useRestaurarRolagem, useTitulo } from './comum'

const ICONE: Record<Evento['origem'], string> = { site: 'caixa', painel: 'conta', sistema: 'relogio', pix: 'pix' }
const QUEM: Record<Evento['origem'], string> = { site: 'Site', painel: 'Painel', sistema: 'Automático', pix: 'Pix' }

function rateioDo(e: Evento): string | null {
  if (e.alvo.startsWith('rateio:')) return e.alvo.slice(7)
  const r = (e.detalhe as { rateio?: unknown }).rateio
  return typeof r === 'string' ? r : null
}

/** Pra onde a linha leva: o rateio, ou a tela da loja que o evento mexeu (o que foi apagado não leva a lugar nenhum). */
function destinoDe(e: Evento): string | null {
  if (/-apagad[oa]$/.test(e.acao)) return null
  const rid = rateioDo(e)
  if (rid) return caminho.rateio(rid)
  const [tipo, id] = e.alvo.split(':')
  if (tipo === 'produto' && id) return caminho.produto(id)
  if (tipo === 'estado' && id) return e.acao === 'stories-salvos' ? caminho.storiesDe(id) : caminho.estado(id)
  if (tipo === 'premio' && id) return caminho.premio(id)
  if (tipo === 'categoria' || e.acao === 'categorias-ordem') return caminho.categorias
  if (e.acao === 'produtos-ordem') return caminho.produtos
  if (e.acao === 'sorte-regras') return caminho.sorte
  if (e.acao.startsWith('loja-')) return caminho.loja
  return null
}

export function Atividade() {
  useTitulo('Atividade')
  const leitura = useDados<{ eventos: Evento[] }>('eventos', (s) => api.eventos(s))
  useRestaurarRolagem(!!leitura.dados)
  const lista = leitura.dados?.eventos ?? []
  const agora = api.agora()
  // agrupa por dia (hoje, ontem, …); o mesmo aviso sem rateio em sequência ("Entrou no painel") vira uma linha só
  const grupos: { dia: string; itens: { e: Evento; vezes: number }[] }[] = []
  for (const e of lista) {
    const d = dia(e.em, agora)
    const g = grupos[grupos.length - 1]
    const ultimo = g?.dia === d ? g.itens[g.itens.length - 1] : undefined
    if (ultimo && !rateioDo(e) && ultimo.e.acao === e.acao && ultimo.e.texto === e.texto && ultimo.e.usuario === e.usuario) ultimo.vezes++
    else if (g && g.dia === d) g.itens.push({ e, vezes: 1 })
    else grupos.push({ dia: d, itens: [{ e, vezes: 1 }] })
  }
  return (
    <>
      <Topo titulo={<TituloTela>Atividade</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita">
        {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        {!leitura.dados && !leitura.erro && <Carregando />}
        {leitura.dados && lista.length === 0 && <p className="pn-vazio">Nada por aqui ainda.</p>}
        {grupos.map((g) => (
          <section key={g.dia} className="pn-bloco" aria-label={g.dia}>
            <h2 className="pn-h3 pn-dia">{g.dia[0].toUpperCase() + g.dia.slice(1)}</h2>
            <ul className="pn-eventos">
              {g.itens.map(({ e, vezes }) => {
                const destino = destinoDe(e)
                const conteudo = (
                  <>
                    <span className={`pn-evento-ic pn-evento-${e.origem}`} aria-hidden="true">
                      <Ic nome={e.acao === 'participacao-confirmada' ? 'check' : ICONE[e.origem]} tamanho={16} />
                    </span>
                    <span className="pn-evento-txt">
                      <span>{e.texto}</span>
                      <small>
                        {QUEM[e.origem]}
                        {e.usuario ? ` · ${e.usuario}` : ''} · <time dateTime={e.em}>{relativo(e.em, agora) === 'agora' ? 'agora' : hora(e.em)}</time>
                        {vezes > 1 ? ` · ${vezes} vezes` : ''}
                      </small>
                    </span>
                  </>
                )
                return (
                  <li key={e.id}>
                    {destino ? (
                      <Link href={destino} className="pn-evento toque">
                        {conteudo}
                        <Ic nome="chevron-dir" tamanho={16} />
                      </Link>
                    ) : (
                      <div className="pn-evento">{conteudo}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
