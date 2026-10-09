// O rateio por dentro: contador grande (pagas/vagas + reservadas), dinheiro, a linha do status com o próximo passo
// como botão (com confirmação e, depois, o "Avisar todos"), o link pra compartilhar e os participantes.
import { useEffect, useRef, useState } from 'react'
import { config } from '../../dados/config'
import * as api from '../api'
import { ArteRateio } from '../Arte'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { useDados } from '../dados'
import { brl, dataCompleta, diaMes, faixaDias, janela, listaUfs, quando, vagas } from '../formato'
import { PASSOS_COM_AVISO, quemAvisar } from '../mensagens'
import { Link, Topo } from '../Moldura'
import { Contador, LinhaDoTempo, NOME_STATUS, Selo } from '../rateio-ui'
import { caminho, ir } from '../rotas'
import type { Participante, RateioAdmin, StatusRateio } from '../tipos'
import { Aviso, Botao, Carregando, Ic, Linha, TituloTela } from '../ui'
import type { AoMudar } from '../vaga'
import { AvisarTodos, avisados } from './AvisarTodos'
import { usePode } from '../permissoes'
import { useRestaurarRolagem, useTitulo } from './comum'
import { avisarNaProxima, pegarRecado } from './flash'
import { FormPessoa } from './FormPessoa'
import { Participantes } from './Participantes'

interface Dados {
  rateio: RateioAdmin
  participantes: Participante[]
}

const BOTAO_PASSO: Partial<Record<StatusRateio, string>> = {
  aberto: 'Publicar no site',
  fechado: 'Fechar agora',
  pedido: 'Pedido feito',
  caminho: 'A caminho',
  chegou: 'Chegou',
  encerrado: 'Encerrar',
}

function textoDoMomento(r: RateioAdmin, agora: number): string {
  const j = janela(r.fechadoEm, r.previsaoMin, r.previsaoMax)
  switch (r.status) {
    case 'rascunho':
      return 'Rascunho: só tu vê. Publica quando estiver pronto.'
    case 'aberto':
      if (r.fechaEm && Date.parse(r.fechaEm) <= agora) return 'O prazo pra entrar acabou. Fecha agora ou edita a data pra seguir aberto.'
      if (r.disponiveis === 0 && r.confirmadas < r.vagas) return `Vagas tomadas. Falta o pagamento de ${vagas(r.reservadas)} reservada${r.reservadas === 1 ? '' : 's'}.`
      // o prazo só para as entradas pelo site: o rateio segue aberto até lotar ou até o dono fechar
      return `Aberto no site. Fecha sozinho quando as ${r.vagas} vagas forem pagas.${r.fechaEm ? ` Dá pra entrar até ${quando(r.fechaEm, agora)}; depois, tu fecha ou muda o prazo.` : ''}`
    case 'fechado':
      return `Fechou ${r.fechadoEm ? `dia ${diaMes(r.fechadoEm)}` : ''}. Faz o pedido e marca aqui: a galera vê no site.`
    case 'pedido':
      return `Pedido feito ${r.pedidoEm ? `dia ${diaMes(r.pedidoEm)}` : ''}. Previsão: ${j ?? faixaDias(r.previsaoMin, r.previsaoMax)}.`
    case 'caminho':
      return `A caminho. Previsão: ${j ?? faixaDias(r.previsaoMin, r.previsaoMax)}.`
    case 'chegou':
      return `Chegou ${r.chegouEm ? `dia ${diaMes(r.chegouEm)}` : ''}. Marca “Entregue” em cada um; quando todo mundo receber, encerra.`
    case 'encerrado':
      return 'Encerrado. Fica 15 dias no site como entregue e depois some.'
    case 'cancelado':
      return 'Cancelado. Saiu do site; quem participava vê “cancelado” nas vagas dele.'
  }
}

function confirmacaoDoPasso(r: RateioAdmin, para: StatusRateio): { titulo: string; texto: string; botao: string; perigo?: boolean } {
  switch (para) {
    case 'aberto':
      return r.status === 'fechado'
        ? { titulo: 'Reabrir o rateio?', texto: 'Volta a aceitar entradas no site.', botao: 'Reabrir' }
        : { titulo: 'Publicar no site?', texto: 'O rateio aparece na aba Rateio e a galera já pode entrar.', botao: 'Publicar no site' }
    case 'fechado':
      return {
        titulo: 'Fechar agora?',
        texto: `Ninguém mais entra pelo site. ${r.confirmadas} de ${r.vagas} vagas pagas${r.reservadas ? `; quem tá reservado (${r.reservadas}) ainda pode pagar até o prazo` : ''}.`,
        botao: 'Fechar agora',
      }
    case 'pedido':
      return { titulo: 'Marcar pedido feito?', texto: 'Quem tá no rateio vê “Pedido feito” no site. Depois tu avisa cada um no WhatsApp.', botao: 'Pedido feito' }
    case 'caminho':
      return { titulo: 'Marcar a caminho?', texto: 'Quem tá no rateio vê “A caminho” no site.', botao: 'A caminho' }
    case 'chegou':
      return { titulo: 'Marcar que chegou?', texto: 'Quem tá no rateio vê “Chegou” no site. Aí é combinar a entrega com cada um.', botao: 'Chegou' }
    case 'encerrado':
      return { titulo: 'Encerrar o rateio?', texto: `Use quando todo mundo já recebeu (${r.totais.entregues} de ${r.confirmadas} vagas entregues). Fica 15 dias no site como entregue.`, botao: 'Encerrar' }
    case 'cancelado':
      return {
        titulo: 'Cancelar o rateio?',
        texto: `Sai do site na hora e não volta. ${r.totais.pessoasConfirmadas === 1 ? '1 pessoa já pagou: combina com ela no WhatsApp o que fazer com o pagamento.' : r.totais.pessoasConfirmadas ? `${r.totais.pessoasConfirmadas} pessoas já pagaram: combina com cada uma no WhatsApp o que fazer com o pagamento.` : 'Ninguém pagou ainda.'}`,
        botao: 'Cancelar o rateio',
        perigo: true,
      }
    default:
      return { titulo: 'Mudar o status?', texto: '', botao: 'Mudar' }
  }
}

export function Rateio({ id }: { id: string }) {
  const leitura = useDados<Dados>(`participantes:${id}`, (s) => api.participantes(id, s))
  const [recado, setRecado] = useState(pegarRecado)
  // atendente vê o rateio e cuida dos participantes; editar, mudar o status e apagar é com gerente e dono
  const mexe = usePode('rateios')
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [avisar, setAvisar] = useState<StatusRateio | null>(null)
  const [pessoa, setPessoa] = useState<{ aberta: boolean; p: Participante | null }>({ aberta: false, p: null })
  const [copiado, setCopiado] = useState(false)
  const [incluido, setIncluido] = useState<{ p: Participante; novo: boolean } | null>(null)
  // o selo carimba quando o status muda com a tela aberta (não na primeira vez)
  const statusVisto = useRef<string | null>(null)
  const mudouStatus = !!statusVisto.current && !!leitura.dados && statusVisto.current !== leitura.dados.rateio.status
  useEffect(() => {
    if (leitura.dados) statusVisto.current = leitura.dados.rateio.status
  }, [leitura.dados])
  const d = leitura.dados
  useTitulo(d?.rateio.titulo ?? 'Rateio')
  useRestaurarRolagem(!!d)

  if (leitura.erro && !d) {
    return (
      <>
        <Topo voltar={caminho.rateios} titulo={<TituloTela>Rateio</TituloTela>} />
        <div className="pn-pagina">
          <Aviso tipo="erro" acao={leitura.erro.codigo === 'nao-encontrado' ? <Link className="pn-link" href={caminho.rateios}>Ver os rateios</Link> : <button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.codigo === 'nao-encontrado' ? 'Esse rateio não existe mais.' : leitura.erro.message}
          </Aviso>
        </div>
      </>
    )
  }
  if (!d) {
    return (
      <>
        <Topo voltar={caminho.rateios} titulo={<TituloTela>Rateio</TituloTela>} />
        <Carregando />
      </>
    )
  }

  const r = d.rateio
  const agora = api.agora()
  const aoMudar: AoMudar = ({ participante, rateio }) =>
    leitura.trocar((x) => ({ rateio, participantes: x.participantes.some((p) => p.id === participante.id) ? x.participantes.map((p) => (p.id === participante.id ? participante : p)) : [...x.participantes, participante] }))

  const passo = (para: StatusRateio) => {
    const c = confirmacaoDoPasso(r, para)
    setConfirmacao({
      ...c,
      texto: <p>{c.texto}</p>,
      acao: async () => {
        const res = await api.statusRateio(r.id, para)
        leitura.trocar((x) => ({ ...x, rateio: res.rateio }))
        if (PASSOS_COM_AVISO.includes(para) && quemAvisar(para, d.participantes).length) setAvisar(para)
      },
    })
  }

  const apagar = () =>
    setConfirmacao({
      titulo: 'Apagar o rateio?',
      texto: <p>{r.demo ? 'É um rateio de exemplo: some do painel e do site.' : 'Some do painel e do site. Não dá pra desfazer.'}{r.totais.participacoes ? ` As ${r.totais.participacoes} participações dele somem junto.` : ''}</p>,
      botao: 'Apagar o rateio',
      perigo: true,
      acao: async () => {
        await api.apagarRateio(r.id)
        avisarNaProxima(`Rateio “${r.titulo}” apagado.`)
        ir(caminho.rateios, true)
      },
    })

  const link = `${config.urlPublica}?rateio=${r.id}`
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const t = document.createElement('textarea')
      t.value = link
      t.setAttribute('readonly', '')
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 2500)
  }
  const compartilhar = async () => {
    try {
      await navigator.share({ title: r.titulo, text: `Rateio de ${r.titulo}: ${brl(r.precoRateio)} a vaga.`, url: link })
    } catch {
      /* cancelou */
    }
  }
  const podeCompartilhar = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const proximos = r.proximos.filter((s) => s !== 'cancelado')
  const principal = proximos.find((s) => !(r.status === 'fechado' && s === 'aberto'))
  const reabrir = r.status === 'fechado' && proximos.includes('aberto')
  const comAviso = PASSOS_COM_AVISO.includes(r.status) ? quemAvisar(r.status, d.participantes) : []
  const jaAvisados = comAviso.length ? avisados(r, r.status, d.participantes) : 0
  const editavel = !['encerrado', 'cancelado'].includes(r.status)
  // chegou: o que importa é a entrega, não o que falta receber
  const entrega = r.status === 'chegou' || r.status === 'encerrado'
  // passo que não é o do dia fica cinza: fechar antes da hora (aberto, no prazo e com vaga) e encerrar com gente
  // sem receber (o do dia é marcar "Entregue" em cada um)
  const fecharCedo = principal === 'fechado' && r.disponiveis > 0 && !(r.fechaEm && Date.parse(r.fechaEm) <= agora)
  const faltaEntregar = principal === 'encerrado' && r.totais.entregues < r.confirmadas

  return (
    <>
      <Topo
        voltar={caminho.rateios}
        titulo={<TituloTela className="pn-h1-rateio">{r.titulo}</TituloTela>}
        acoes={
          editavel && mexe && (
            <Link href={caminho.editar(r.id)} className="pn-botao pn-botao-cinza pn-botao-p pn-so-icone-estreito">
              <Ic nome="editar" tamanho={16} />
              <span className="pn-botao-txt">Editar</span>
            </Link>
          )
        }
      />
      <div className="pn-pagina pn-detalhe">
        {recado && (
          <Aviso tipo="ok" className="pn-detalhe-recado" acao={<button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={() => setRecado(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {recado}
          </Aviso>
        )}
        {leitura.erro && <Aviso tipo="erro" className="pn-detalhe-recado">{leitura.erro.message}</Aviso>}

        <div className="pn-det-esq">
        <section className="pn-det-cab" aria-label="Rateio">
          <ArteRateio produtoId={r.produtoId} imagem={r.imagem} largura={88} apagada={r.status === 'cancelado'} />
          <div className="pn-det-cab-txt">
            <div className="pn-det-selos">
              <Selo key={r.status} status={r.status} carimbar={mudouStatus} />
              {r.noSite ? (
                <span className="pn-no-site">
                  <Ic nome="olho" tamanho={16} /> no site
                </span>
              ) : (
                <span className="pn-no-site pn-fora">fora do site</span>
              )}
            </div>
            <p className="pn-det-preco">
              <span className="px">{brl(r.precoRateio)}</span> no rateio
            </p>
            {r.precoDepois != null && (
              <p className="pn-det-depois">
                {brl(r.precoDepois)} quando chegar · <strong>economia de {brl(r.precoDepois - r.precoRateio)}</strong>
              </p>
            )}
            {r.demo && <p className="pn-nota">Rateio de exemplo: some do site quando a loja sair do modo de exemplo. Pode apagar quando quiser.</p>}
          </div>
        </section>

        <section className="pn-bloco pn-det-contador" aria-label="Vagas">
          <Contador r={r} />
          <dl className="pn-dinheiro pn-dinheiro-p">
            <div>
              <dt>Pago</dt>
              <dd className="px">{brl(r.totais.arrecadado)}</dd>
              <dd className="pn-dinheiro-sub">{r.totais.pessoasConfirmadas} pessoa{r.totais.pessoasConfirmadas === 1 ? '' : 's'}</dd>
            </div>
            {entrega ? (
              <div>
                <dt>Entregue</dt>
                <dd className="px">
                  {r.totais.entregues}/{r.confirmadas}
                </dd>
                <dd className="pn-dinheiro-sub">{r.totais.entregues >= r.confirmadas ? 'todo mundo recebeu' : `falta ${vagas(r.confirmadas - r.totais.entregues)}`}</dd>
              </div>
            ) : (
              <div>
                <dt>A receber</dt>
                <dd className="px">{brl(r.totais.aReceber)}</dd>
                <dd className="pn-dinheiro-sub">
                  {/* "tudo pago" só com todas as vagas pagas (5/12 pagas e nenhuma reserva não é tudo pago) */}
                  {r.totais.pessoasReservadas ? `${r.totais.pessoasReservadas} reserva${r.totais.pessoasReservadas === 1 ? '' : 's'}` : r.confirmadas >= r.vagas ? 'tudo pago' : 'nenhuma reserva esperando'}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="pn-bloco pn-det-passo" aria-labelledby="h-status">
          <h2 id="h-status" className="pn-h2">
            Status: {NOME_STATUS[r.status].toLowerCase()}
          </h2>
          <LinhaDoTempo r={r} />
          <p className="pn-passo-txt">{textoDoMomento(r, agora)}</p>
          {mexe && (principal || reabrir) && (
            <div className="pn-botoes pn-botoes-linha">
              {principal && BOTAO_PASSO[principal] && (
                <Botao largo variante={fecharCedo || faltaEntregar ? 'cinza' : undefined} onClick={() => passo(principal)}>
                  {BOTAO_PASSO[principal]}
                </Botao>
              )}
              {reabrir && (
                <Botao largo variante="cinza" onClick={() => passo('aberto')}>
                  Reabrir
                </Botao>
              )}
            </div>
          )}
          {!mexe && (principal || reabrir) && <p className="pn-dica-bloco">Mudar o status do rateio é com o gerente ou o dono.</p>}
          {comAviso.length > 0 && (
            <button type="button" className="pn-avisar-todos toque" onClick={() => setAvisar(r.status)}>
              <Ic nome="whatsapp" tamanho={24} />
              <span>
                <strong>Avisar todos no WhatsApp</strong>
                <small>
                  {jaAvisados} de {comAviso.length} avisados · mensagem pronta pra cada um
                </small>
              </span>
              <Ic nome="chevron-dir" tamanho={16} />
            </button>
          )}
        </section>

        <section className="pn-bloco pn-det-link" aria-labelledby="h-link">
          <h2 id="h-link" className="pn-h2">
            Link pra compartilhar
          </h2>
          {r.noSite ? (
            <>
              <p className="pn-link-url">
                <span>{link.replace(/^https?:\/\//, '')}</span>
              </p>
              <div className="pn-botoes pn-botoes-linha">
                <Botao variante="cinza" icone={copiado ? 'check' : 'copiar'} onClick={() => void copiar()}>
                  {copiado ? 'Copiado' : 'Copiar link'}
                </Botao>
                {podeCompartilhar && (
                  <Botao variante="cinza" icone="compartilhar" onClick={() => void compartilhar()}>
                    Compartilhar
                  </Botao>
                )}
                <a className="pn-botao pn-botao-texto" href={link} target="_blank" rel="noopener noreferrer">
                  <Ic nome="olho" tamanho={16} />
                  <span className="pn-botao-txt">Ver no site</span>
                </a>
              </div>
              <span className="sr-only" role="status">
                {copiado ? 'Link copiado' : ''}
              </span>
              <p className="pn-dica-bloco">Põe no adesivo de link do story ou manda no WhatsApp: abre direto nesse rateio.</p>
            </>
          ) : (
            <p className="pn-dica-bloco">{r.status === 'rascunho' ? 'O link funciona depois de publicar.' : 'Esse rateio não aparece mais no site.'}</p>
          )}
        </section>

        <section className="pn-bloco pn-det-detalhes" aria-labelledby="h-detalhes">
          <h2 id="h-detalhes" className="pn-h2">
            Detalhes
          </h2>
          <dl className="pn-lista-det">
            <Linha rotulo="Vale pra">{listaUfs(r.ufs)}</Linha>
            <Linha rotulo="Por pessoa">até {vagas(r.limitePorPessoa)}</Linha>
            <Linha rotulo="Previsão">{faixaDias(r.previsaoMin, r.previsaoMax)} depois de fechar</Linha>
            <Linha rotulo="Prazo pra entrar">{r.fechaEm ? quando(r.fechaEm, agora) : 'até lotar'}</Linha>
            <Linha rotulo="Reserva">{r.reservaHoras} h pra pagar</Linha>
            <Linha rotulo="Criado">{dataCompleta(r.criadoEm)}</Linha>
            {r.totais.expiradas > 0 && <Linha rotulo="Reservas vencidas">{r.totais.expiradas}</Linha>}
            {r.totais.canceladas > 0 && <Linha rotulo="Canceladas">{r.totais.canceladas}</Linha>}
          </dl>
          {r.descricao && <p className="pn-det-desc">{r.descricao}</p>}
        </section>

        {mexe && (r.status !== 'cancelado' || r.podeApagar) && (
        <section className="pn-bloco pn-det-mais" aria-labelledby="h-mais">
          <h2 id="h-mais" className="pn-h2">
            Mais
          </h2>
          <div className="pn-botoes">
            {r.status !== 'cancelado' && (
              <Botao variante="perigo" largo onClick={() => passo('cancelado')}>
                Cancelar o rateio
              </Botao>
            )}
            {r.podeApagar && (
              <Botao variante="texto" largo icone="lixo" onClick={apagar}>
                Apagar o rateio
              </Botao>
            )}
          </div>
        </section>
        )}
        </div>
        <div className="pn-det-dir">
        <div className="pn-det-pessoas">
          <Participantes
            rateio={r}
            lista={d.participantes}
            aoMudar={aoMudar}
            pedir={setConfirmacao}
            aoIncluir={() => setPessoa({ aberta: true, p: null })}
            aoEditar={(p) => setPessoa({ aberta: true, p })}
            recado={incluido}
            aoLargarRecado={() => setIncluido(null)}
          />
        </div>

        </div>
      </div>

      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
      <AvisarTodos passo={avisar} rateio={r} participantes={d.participantes} aoFechar={() => setAvisar(null)} />
      <FormPessoa
        aberta={pessoa.aberta}
        rateio={r}
        pessoa={pessoa.p}
        aoFechar={() => setPessoa({ aberta: false, p: null })}
        aoSalvar={(res, incluiu) => {
          aoMudar(res)
          setPessoa({ aberta: false, p: null })
          setIncluido({ p: res.participante, novo: incluiu })
        }}
      />
    </>
  )
}
