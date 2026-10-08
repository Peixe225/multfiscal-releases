// Participantes do rateio: busca, filtro por status e, em cada pessoa, a ação do momento (confirmar pagamento,
// entregue) à mão, o WhatsApp com a mensagem pronta e o resto em "Mais".
import { useMemo, useState } from 'react'
import * as api from '../api'
import type { PedidoConfirmacao } from '../Confirmar'
import { useAcao } from '../dados'
import { Folha } from '../Folha'
import { brl, falta, relativo, vagas, whatsappBonito } from '../formato'
import type { Participante, RateioAdmin, StatusVaga } from '../tipos'
import { Aviso, Botao, Ic } from '../ui'
import {
  BotaoWhats,
  NOME_VAGA,
  avisoDeAgora,
  pedirApagarDados,
  pedirCancelar,
  pedirConfirmarPagamento,
  pedirDesfazerConfirmacao,
  pedirReservarDeNovo,
  type AoMudar,
} from '../vaga'

const FILTROS: { id: string; nome: string; status: StatusVaga[] }[] = [
  { id: 'todos', nome: 'Todos', status: [] },
  { id: 'esperando', nome: 'Esperando', status: ['reservado'] },
  { id: 'pagos', nome: 'Pagos', status: ['confirmado'] },
  { id: 'entregues', nome: 'Entregues', status: ['entregue'] },
  { id: 'venceram', nome: 'Venceram', status: ['expirado'] },
  { id: 'cancelados', nome: 'Cancelados', status: ['cancelado'] },
]

const sem = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Props {
  rateio: RateioAdmin
  lista: Participante[]
  aoMudar: AoMudar
  pedir: (p: PedidoConfirmacao) => void
  aoIncluir: () => void
  aoEditar: (p: Participante) => void
  /** Quem acabou de ser incluído ou editado (o recado com o WhatsApp dele). */
  recado: { p: Participante; novo: boolean } | null
  aoLargarRecado: () => void
}

export function Participantes({ rateio, lista, aoMudar, pedir, aoIncluir, aoEditar, recado, aoLargarRecado }: Props) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [mais, setMais] = useState<Participante | null>(null)
  const acao = useAcao()
  const contagem = (st: StatusVaga[]) => (st.length ? lista.filter((p) => st.includes(p.status)).length : lista.length)
  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.id === filtro) ?? FILTROS[0]
    const q = sem(busca.trim())
    const digitos = busca.replace(/\D/g, '')
    return lista.filter((p) => {
      if (f.status.length && !f.status.includes(p.status)) return false
      if (!q) return true
      return sem(`${p.nome} ${p.codigo} ${p.cidade}`).includes(q) || (digitos.length >= 3 && p.whatsapp.includes(digitos))
    })
  }, [lista, filtro, busca])

  const podeIncluir = ['aberto', 'fechado', 'pedido', 'caminho', 'chegou'].includes(rateio.status)
  const entregaVale = rateio.status === 'chegou' || rateio.status === 'encerrado'

  const entregar = (p: Participante, para: 'entregue' | 'confirmado') =>
    void acao.rodar(`${para}-${p.id}`, async () => {
      aoMudar(await api.statusParticipante(p.id, para))
    })

  return (
    <section className="pn-bloco pn-pessoas" aria-labelledby="h-pessoas">
      <div className="pn-h2-linha">
        <h2 id="h-pessoas" className="pn-h2">
          Participantes <span className="pn-conta">{lista.length}</span>
        </h2>
        <div className="pn-h2-acoes">
          {lista.length > 0 && (
            <a className="pn-botao pn-botao-texto pn-botao-p" href={api.urlCsv(rateio.id)} download>
              <Ic nome="baixar" tamanho={16} />
              <span className="pn-botao-txt">CSV</span>
              <span className="sr-only"> (planilha com todo mundo)</span>
            </a>
          )}
          {podeIncluir && (
            <button type="button" className="pn-botao pn-botao-cinza pn-botao-p" onClick={aoIncluir}>
              <Ic nome="incluir-pessoa" tamanho={16} />
              <span className="pn-botao-txt">Incluir</span>
            </button>
          )}
        </div>
      </div>

      {recado && (
        <Aviso
          tipo="ok"
          acao={
            <button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={aoLargarRecado}>
              <Ic nome="fechar" tamanho={16} />
            </button>
          }
        >
          <p>
            {recado.novo ? `${recado.p.nome} entrou no rateio (${recado.p.codigo}, ${recado.p.status === 'confirmado' ? 'pago' : 'reservado'}).` : `Dados de ${recado.p.nome} salvos.`}
          </p>
          {recado.novo && recado.p.whatsapp && (
            <p className="pn-aviso-botoes">
              <BotaoWhats p={recado.p} texto={avisoDeAgora(recado.p, rateio).texto} rotulo={recado.p.status === 'confirmado' ? 'Mandar a confirmação' : 'Mandar o código e o prazo'} variante="cinza" aoTocar={aoLargarRecado} />
            </p>
          )}
        </Aviso>
      )}
      {lista.length === 0 ? (
        <p className="pn-vazio">
          {rateio.status === 'rascunho' ? 'Publica o rateio pra galera poder entrar.' : 'Ninguém entrou ainda. Manda o link do rateio no story e no WhatsApp.'}
        </p>
      ) : (
        <>
          <div className="pn-busca">
            <Ic nome="lupa" tamanho={16} />
            <input type="search" className="pn-input" placeholder="Nome, WhatsApp ou código" aria-label="Buscar participante" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
          </div>
          <div className="pn-filtros" role="group" aria-label="Filtrar por status">
            {FILTROS.map((f) => {
              const n = contagem(f.status)
              if (f.id !== 'todos' && n === 0) return null
              return (
                <button key={f.id} type="button" className={`pn-filtro${filtro === f.id ? ' on' : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
                  {f.nome} <span className="pn-filtro-n">{n}</span>
                </button>
              )
            })}
          </div>
          {acao.erro && <Aviso tipo="erro">{acao.erro.message}</Aviso>}
          {visiveis.length === 0 && <p className="pn-vazio">Ninguém com esse filtro.</p>}
          <ul className="pn-lista-pessoas">
            {visiveis.map((p) => {
              const resta = p.status === 'reservado' && p.expiraEm ? falta(p.expiraEm, api.agora()) : null
              const urgente = !!resta && !!p.expiraEm && Date.parse(p.expiraEm) - api.agora() < 6 * 3600 * 1000
              const aviso = avisoDeAgora(p, rateio)
              return (
                <li key={p.id} className={`pn-pessoa pn-pessoa-${p.status}`}>
                  <div className="pn-pessoa-topo">
                    <strong className="pn-pessoa-nome">{p.nome}</strong>
                    <span className={`pn-chip pn-chip-${p.status}`}>
                      {p.status === 'confirmado' && <Ic nome="check" tamanho={16} />}
                      {NOME_VAGA[p.status]}
                    </span>
                    <button type="button" className="icone-botao pn-mais" aria-label={`Mais ações de ${p.nome}`} onClick={() => setMais(p)}>
                      <Ic nome="mais-opcoes" tamanho={16} />
                    </button>
                  </div>
                  <p className="pn-pessoa-sub">
                    <span className="pn-codigo">{p.codigo}</span> · {vagas(p.quantidade)} · <strong>{brl(p.total)}</strong> · {p.uf.toUpperCase()}
                    {p.cidade ? ` · ${p.cidade}` : ''}
                  </p>
                  <p className="pn-pessoa-sub2">
                    {p.whatsapp ? whatsappBonito(p.whatsapp) : 'sem WhatsApp'} · {p.origem === 'site' ? 'entrou pelo site' : 'incluído aqui'} {relativo(p.criadoEm, api.agora())}
                    {resta && <span className={urgente ? 'pn-urgente' : undefined}> · vence em {resta}</span>}
                  </p>
                  {p.observacao && <p className="pn-pessoa-obs">{p.observacao}</p>}
                  <div className="pn-pessoa-acoes">
                    {(p.status === 'reservado' || p.status === 'expirado') && rateio.status !== 'cancelado' && (
                      <button type="button" className={`pn-botao ${p.status === 'reservado' ? 'pn-botao-cheio' : 'pn-botao-contorno'} pn-botao-p`} onClick={() => pedir(pedirConfirmarPagamento(p, rateio, aoMudar))}>
                        <span className="pn-botao-txt">Confirmar pagamento</span>
                        <span className="sr-only"> de {p.nome}</span>
                      </button>
                    )}
                    {p.status === 'confirmado' && entregaVale && (
                      <Botao className="pn-botao-p" ocupado={acao.ocupado === `entregue-${p.id}`} onClick={() => entregar(p, 'entregue')}>
                        Entregue<span className="sr-only"> pra {p.nome}</span>
                      </Botao>
                    )}
                    {p.whatsapp && <BotaoWhats p={p} texto={aviso.texto} rotulo={aviso.rotulo === 'Avisar no WhatsApp' ? 'WhatsApp' : aviso.rotulo.replace(' no WhatsApp', '')} variante="cinza" pequeno />}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <MaisAcoes
        p={mais}
        rateio={rateio}
        aoFechar={() => setMais(null)}
        acoes={(p) => {
          const fechar = (f: () => void) => () => {
            setMais(null)
            f()
          }
          const itens: { nome: string; icone: string; feito: () => void; perigo?: boolean }[] = []
          const vivo = rateio.status !== 'cancelado'
          // dados apagados (LGPD) não voltam
          if (p.whatsapp) itens.push({ nome: 'Editar dados', icone: 'editar', feito: fechar(() => aoEditar(p)) })
          if (vivo && p.status === 'cancelado') itens.push({ nome: 'Confirmar pagamento', icone: 'check', feito: fechar(() => pedir(pedirConfirmarPagamento(p, rateio, aoMudar))) })
          if (vivo && p.status === 'confirmado' && !entregaVale) itens.push({ nome: 'Marcar como entregue', icone: 'check', feito: fechar(() => entregar(p, 'entregue')) })
          if (vivo && p.status === 'entregue') itens.push({ nome: 'Desfazer a entrega', icone: 'giro', feito: fechar(() => entregar(p, 'confirmado')) })
          if (vivo && (p.status === 'expirado' || p.status === 'cancelado')) itens.push({ nome: 'Reservar de novo', icone: 'relogio', feito: fechar(() => pedir(pedirReservarDeNovo(p, rateio, aoMudar))) })
          if (vivo && p.status === 'confirmado') itens.push({ nome: 'Desfazer o pagamento', icone: 'giro', feito: fechar(() => pedir(pedirDesfazerConfirmacao(p, rateio, aoMudar))), perigo: true })
          if (vivo && (p.status === 'reservado' || p.status === 'confirmado' || p.status === 'expirado'))
            itens.push({ nome: p.status === 'confirmado' ? 'Cancelar a vaga' : 'Cancelar a reserva', icone: 'fechar', feito: fechar(() => pedir(pedirCancelar(p, aoMudar))), perigo: true })
          const ativa = (p.status === 'reservado' || p.status === 'confirmado') && !['encerrado', 'cancelado'].includes(rateio.status)
          if (p.whatsapp && !ativa) itens.push({ nome: 'Apagar os dados (LGPD)', icone: 'lixo', feito: fechar(() => pedir(pedirApagarDados(p, aoMudar))), perigo: true })
          return itens
        }}
      />
    </section>
  )
}

function MaisAcoes({ p, rateio, aoFechar, acoes }: { p: Participante | null; rateio: RateioAdmin; aoFechar: () => void; acoes: (p: Participante) => { nome: string; icone: string; feito: () => void; perigo?: boolean }[] }) {
  if (!p) return null
  const itens = acoes(p)
  return (
    <Folha aberta aoFechar={aoFechar} titulo={p.nome} sub={`${p.codigo} · ${NOME_VAGA[p.status]} · ${rateio.titulo}`}>
      <ul className="pn-menu">
        {itens.map((i) => (
          <li key={i.nome}>
            <button type="button" className={`pn-menu-item toque${i.perigo ? ' pn-perigo' : ''}`} onClick={i.feito}>
              <Ic nome={i.icone} tamanho={16} />
              <span>{i.nome}</span>
            </button>
          </li>
        ))}
        {itens.length === 0 && <li className="pn-vazio">Nada pra fazer com essa vaga agora.</li>}
      </ul>
    </Folha>
  )
}
