// Atividade: o que aconteceu (entradas pelo site, pagamentos confirmados, reservas que venceram, passos do rateio),
// do mais novo pro mais velho, no molde das notificações do Instagram. Pra gerente e atendente, só o que a própria
// pessoa fez; o dono vê tudo ou o que uma pessoa da equipe fez (vindo da tela dela).
import * as api from '../api'
import { eventosDe } from '../contas/api'
import { useUsuario } from '../permissoes'
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

export function Atividade({ quem = null }: { quem?: string | null }) {
  const eu = useUsuario()
  const dono = !eu || eu.papel === 'dono'
  const de = dono ? quem : null
  useTitulo(de ? `Atividade de @${de}` : 'Atividade')
  const leitura = useDados<{ eventos: Evento[] }>(de ? `eventos:${de}` : 'eventos', (s) => (de ? eventosDe(de, s) : api.eventos(s)))
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
      <Topo titulo={<TituloTela>{de ? `Atividade de @${de}` : 'Atividade'}</TituloTela>} voltar={de ? caminho.usuario(de) : undefined} />
      <div className="pn-pagina pn-pagina-estreita">
        {!dono && <p className="pn-dica-bloco ct-intro">O que tu fez no painel. O resto da loja aparece pro dono.</p>}
        {de && (
          <p className="pn-dica-bloco ct-intro">
            Só o que @{de} fez. <Link href={caminho.atividade} className="pn-link-botao">Ver a atividade da loja toda</Link>
          </p>
        )}
        {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        {!leitura.dados && !leitura.erro && <Carregando />}
        {leitura.dados && lista.length === 0 && <p className="pn-vazio">Nada por aqui ainda.</p>}
        {grupos.map((g) => (
          <section key={g.dia} className="pn-bloco" aria-label={g.dia}>
            <h2 className="pn-h3 pn-dia">{g.dia[0].toUpperCase() + g.dia.slice(1)}</h2>
            <ul className="pn-eventos">
              {g.itens.map(({ e, vezes }) => {
                const rid = rateioDo(e)
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
                    {rid && e.acao !== 'rateio-apagado' ? (
                      <Link href={caminho.rateio(rid)} className="pn-evento toque">
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
