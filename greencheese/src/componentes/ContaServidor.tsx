import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { buscarCep } from '../lib/cep'
import { aparelho } from '../lib/conta-adaptador'
import {
  apagarEndereco,
  atualizarDoServidor,
  baixarMeusDados,
  meusPedidos,
  minhasVagasDaConta,
  salvarEndereco,
  type PedidoDaConta,
  type StatusPedidoConta,
  type VagaDaConta,
} from '../lib/conta-servidor'
import { brl } from '../lib/formato'
import { depoisDoHistorico } from '../lib/historico'
import { useContaStore, type EnderecoConta } from '../store/conta'
import { useUI } from '../store/ui'
import './ContaServidor.css'

// O que a Minha conta ganha quando a conta é a do servidor da loja: meus pedidos (com o status que a loja dá no
// painel), minhas vagas de rateio (as feitas com a conta e as do WhatsApp dela que a loja conferiu, em qualquer aparelho), os endereços (o pedido guiado oferece;
// o do último pedido entra sozinho) e o arquivo com os dados (LGPD). Baixa com a Minha conta.

const TC = {
  pedidos: 'Meus pedidos',
  pedidosVazio: 'Nenhum pedido ainda. O que tu pedir com a conta aberta aparece aqui, com o andamento.',
  carregando: 'Carregando…',
  naoCarregou: 'Não deu pra carregar agora.',
  tentarDeNovo: 'Tentar de novo',
  verMais: (n: number) => `Ver mais ${n}`,
  status: { novo: 'Recebido', confirmado: 'Confirmado', saiu: 'Saiu pra entrega', entregue: 'Entregue', cancelado: 'Cancelado' } as Record<StatusPedidoConta, string>,
  encomenda: 'Encomenda',
  itens: (n: number) => (n === 1 ? '1 item' : `${n} itens`),
  vagas: 'Minhas vagas de rateio',
  vagasVazio: 'Nenhuma vaga ainda. As vagas que tu pegar com este WhatsApp aparecem aqui.',
  vaga: { reservado: 'Esperando pagamento', confirmado: 'Confirmada ✅', expirado: 'Venceu — a vaga voltou', cancelado: 'Cancelada', entregue: 'Entregue' } as Record<VagaDaConta['status'], string>,
  verRateio: 'Ver rateio',
  vagasN: (n: number) => (n === 1 ? '1 vaga' : `${n} vagas`),
  enderecos: 'Meus endereços',
  enderecosLegenda: 'O pedido guiado oferece esses na hora do endereço. O do último pedido entra sozinho.',
  enderecosVazio: 'Nenhum endereço ainda. O do teu próximo pedido fica guardado aqui.',
  adicionar: 'Adicionar endereço',
  apagarEndereco: (e: string) => `Apagar ${e}`,
  apagar: 'Apagar',
  apagado: 'Endereço apagado.',
  salvo: 'Endereço guardado.',
  apelido: 'Nome do endereço (opcional)',
  apelidoDica: 'Casa, trabalho…',
  cep: 'CEP',
  semCep: 'Não sei o CEP',
  comCep: 'Usar o CEP',
  procurando: 'Procurando o CEP…',
  cepNaoAchei: 'Não achei esse CEP. Confere ou escreve o endereço.',
  rua: 'Rua',
  numero: 'Número e complemento',
  bairro: 'Bairro',
  cidade: 'Cidade',
  estado: 'Estado',
  livre: 'Endereço (rua, número e bairro)',
  guardar: 'Guardar endereço',
  cancelar: 'Cancelar',
  limite: 'Cabem 5 endereços. Apaga um antes de pôr outro.',
  dados: 'Teus dados na loja',
  dadosLegenda: 'Baixa um arquivo com tudo que a loja guarda da tua conta: dados, endereços, cupons, pedidos e vagas.',
  baixar: 'Baixar meus dados',
  baixou: 'Arquivo baixado.',
  naoBaixou: 'Não deu pra baixar agora. Tenta de novo.',
}

const UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']
const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' })
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "Rua X, 120 — Centro · Teófilo Otoni/MG" (ou o que a pessoa escreveu sem CEP). */
export function textoDoEndereco(e: EnderecoConta): string {
  const lugar = [e.cidade, e.uf.toUpperCase()].filter(Boolean).join('/')
  if (e.cep) return `${e.rua}${e.numero ? `, ${e.numero}` : ''}${e.bairro ? ` — ${e.bairro}` : ''}${lugar ? ` · ${lugar}` : ''}`
  return `${e.livre}${lugar ? ` · ${lugar}` : ''}`
}

type Carga<T> = { estado: 'carregando' } | { estado: 'erro' } | { estado: 'ok'; itens: T[] }

function useLista<T>(buscar: () => Promise<{ ok: true; itens: T[] } | { ok: false; erro: string }>): [Carga<T>, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ estado: 'carregando' })
  const [vez, setVez] = useState(0)
  useEffect(() => {
    let vivo = true
    setCarga({ estado: 'carregando' })
    void buscar().then((r) => {
      if (vivo) setCarga(r.ok ? { estado: 'ok', itens: r.itens } : { estado: 'erro' })
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vez])
  return [carga, () => setVez((n) => n + 1)]
}

function EstadoCarga({ carga, tentar }: { carga: Carga<unknown>; tentar: () => void }) {
  if (carga.estado === 'carregando') return <p className="legenda cs-carregando">{TC.carregando}</p>
  if (carga.estado === 'erro')
    return (
      <div className="conta-vazio">
        <p>{TC.naoCarregou}</p>
        <button type="button" className="botao botao-contorno" onClick={tentar}>
          {TC.tentarDeNovo}
        </button>
      </div>
    )
  return null
}

/** Relê a conta do servidor quando a Minha conta abre (cupom que a loja deu baixa, endereço do último pedido). */
export function useAtualizarConta() {
  useEffect(() => {
    void atualizarDoServidor(aparelho())
  }, [])
}

export function SecaoPedidos() {
  const [carga, tentar] = useLista(meusPedidos)
  const [todos, setTodos] = useState(false)
  const itens = carga.estado === 'ok' ? carga.itens : []
  const mostrados = todos ? itens : itens.slice(0, 3)
  return (
    <section className="conta-secao" aria-labelledby="conta-pedidos">
      <h3 id="conta-pedidos" className="conta-titulo">
        {TC.pedidos}
      </h3>
      <EstadoCarga carga={carga} tentar={tentar} />
      {carga.estado === 'ok' && itens.length === 0 && <p className="conta-vazio">{TC.pedidosVazio}</p>}
      {mostrados.length > 0 && (
        <ul className="cs-lista">
          {mostrados.map((p) => (
            <li key={p.codigo} className="cs-item">
              <Pedido p={p} />
            </li>
          ))}
        </ul>
      )}
      {!todos && itens.length > 3 && (
        <button type="button" className="botao-texto toque" onClick={() => setTodos(true)}>
          {TC.verMais(itens.length - 3)}
        </button>
      )}
    </section>
  )
}

const PASSOS: StatusPedidoConta[] = ['novo', 'confirmado', 'saiu', 'entregue']

function Pedido({ p }: { p: PedidoDaConta }) {
  const passo = PASSOS.indexOf(p.status)
  return (
    <article className="cs-pedido" aria-label={`Pedido ${p.codigo}: ${TC.status[p.status]}`}>
      <div className="cs-pedido-topo">
        <span className="cs-codigo">{p.codigo}</span>
        <span className={`cs-status cs-status-${p.status}`}>{TC.status[p.status]}</span>
      </div>
      <p className="cs-resumo">
        {p.tipo === 'encomenda' && <span className="cs-tag">{TC.encomenda}</span>}
        {p.resumo}
      </p>
      <p className="legenda">
        {fmtDia.format(p.criadoEm)}, {fmtHora.format(p.criadoEm)}
        {p.tipo === 'pedido' && p.unidades > 0 ? ` · ${TC.itens(p.unidades)}` : ''}
        {p.subtotalTexto ? ` · ${p.subtotalTexto}` : ''}
      </p>
      {p.status !== 'cancelado' && (
        // o andamento em 4 degraus, como a barrinha de um story (só desenho: o status já está escrito)
        <span className="cs-andamento" aria-hidden="true">
          {PASSOS.map((s, i) => (
            <span key={s} className={i <= passo ? 'cheio' : ''} />
          ))}
        </span>
      )}
    </article>
  )
}

export function SecaoVagas({ fechar }: { fechar: () => void }) {
  const [carga, tentar] = useLista(minhasVagasDaConta)
  const itens = carga.estado === 'ok' ? carga.itens : []
  return (
    <section className="conta-secao" aria-labelledby="conta-vagas">
      <h3 id="conta-vagas" className="conta-titulo">
        {TC.vagas}
      </h3>
      <EstadoCarga carga={carga} tentar={tentar} />
      {carga.estado === 'ok' && itens.length === 0 && <p className="conta-vazio">{TC.vagasVazio}</p>}
      {itens.length > 0 && (
        <ul className="cs-lista">
          {itens.map((v) => (
            <li key={v.codigo} className="cs-item">
              <article className="cs-pedido" aria-label={`${v.titulo}: ${TC.vaga[v.status]}`}>
                <div className="cs-pedido-topo">
                  <span className="cs-codigo">{v.codigo}</span>
                  <span className={`cs-status cs-vaga-${v.status}`}>{TC.vaga[v.status]}</span>
                </div>
                <p className="cs-resumo">{v.titulo}</p>
                <p className="legenda">
                  {TC.vagasN(v.quantidade)} · {brl(v.total)}
                  {v.status === 'reservado' && v.expiraEm ? ` · até ${fmtDia.format(v.expiraEm)}, ${fmtHora.format(v.expiraEm)}` : ''}
                </p>
                {v.rateio && (
                  <button
                    type="button"
                    className="botao-texto toque cs-ver"
                    onClick={() => {
                      // a página do rateio fica embaixo das folhas: a conta sai do histórico primeiro
                      fechar()
                      depoisDoHistorico(() => useUI.getState().abrirRateio(v.rateio))
                    }}
                  >
                    {TC.verRateio}
                  </button>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function SecaoEnderecos() {
  const enderecos = useContaStore((s) => s.enderecos)
  const avisar = useUI((s) => s.avisar)
  const [novo, setNovo] = useState(false)
  const [apagando, setApagando] = useState<number | null>(null)
  const botaoNovo = useRef<HTMLButtonElement>(null)
  return (
    <section className="conta-secao" aria-labelledby="conta-enderecos">
      <h3 id="conta-enderecos" className="conta-titulo">
        {TC.enderecos}
      </h3>
      <p className="legenda cs-legenda">{TC.enderecosLegenda}</p>
      {enderecos.length === 0 && !novo && <p className="conta-vazio">{TC.enderecosVazio}</p>}
      {enderecos.length > 0 && (
        <ul className="cs-lista">
          {enderecos.map((e) => (
            <li key={e.id} className="cs-item cs-endereco">
              <p>
                {e.apelido && <strong>{e.apelido}: </strong>}
                {textoDoEndereco(e)}
              </p>
              <button
                type="button"
                className="botao-texto toque cs-apagar"
                aria-label={TC.apagarEndereco(e.apelido || textoDoEndereco(e))}
                disabled={apagando === e.id}
                onClick={async () => {
                  setApagando(e.id)
                  const ok = await apagarEndereco(e.id)
                  setApagando(null)
                  avisar(ok ? TC.apagado : TC.naoCarregou)
                  botaoNovo.current?.focus()
                }}
              >
                {TC.apagar}
              </button>
            </li>
          ))}
        </ul>
      )}
      {novo ? (
        <FormEndereco
          aoFim={(salvou) => {
            setNovo(false)
            if (salvou) avisar(TC.salvo)
            requestAnimationFrame(() => botaoNovo.current?.focus())
          }}
        />
      ) : (
        enderecos.length < 5 && (
          <button ref={botaoNovo} type="button" className="botao botao-contorno" onClick={() => setNovo(true)}>
            {TC.adicionar}
          </button>
        )
      )}
    </section>
  )
}

function FormEndereco({ aoFim }: { aoFim: (salvou: boolean) => void }) {
  const uid = useId()
  const [v, setV] = useState({ apelido: '', cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '', livre: '' })
  const [semCep, setSemCep] = useState(false)
  const [procurando, setProcurando] = useState(false)
  const [erro, setErro] = useState<{ campo: string; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const raiz = useRef<HTMLFormElement>(null)
  useEffect(() => {
    raiz.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])
  const mudar = (k: keyof typeof v) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }))
    if (erro?.campo === k) setErro(null)
  }
  const procurar = async (cep: string) => {
    const d = cep.replace(/\D/g, '')
    if (d.length !== 8) return
    setProcurando(true)
    try {
      const e = await buscarCep(d)
      if (e) setV((s) => ({ ...s, rua: s.rua || e.rua, bairro: s.bairro || e.bairro, cidade: e.cidade, uf: e.uf }))
      else setErro({ campo: 'cep', texto: TC.cepNaoAchei })
    } catch {
      /* os serviços de CEP fora: a pessoa escreve */
    } finally {
      setProcurando(false)
    }
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const corpo = semCep
      ? { apelido: v.apelido, cep: '', rua: '', numero: '', bairro: '', cidade: v.cidade, uf: v.uf, livre: v.livre }
      : { apelido: v.apelido, cep: v.cep, rua: v.rua, numero: v.numero, bairro: v.bairro, cidade: v.cidade, uf: v.uf, livre: '' }
    const r = await salvarEndereco(corpo)
    setOcupado(false)
    if (r.ok) {
      aoFim(true)
      return
    }
    const campo = r.erro === 'limite-enderecos' ? 'geral' : (r.campo ?? 'geral')
    setErro({ campo, texto: r.erro === 'limite-enderecos' ? TC.limite : (r.mensagem ?? TC.naoCarregou) })
    raiz.current?.querySelector<HTMLElement>(`[name="${campo}"]`)?.focus()
  }
  const campo = (k: keyof typeof v, rotulo: string, extra: Record<string, unknown> = {}) => (
    <div className="form-campo">
      <label htmlFor={`${uid}-${k}`}>{rotulo}</label>
      <input
        id={`${uid}-${k}`}
        name={k}
        value={v[k]}
        onChange={(e) => mudar(k)(e.target.value)}
        aria-invalid={erro?.campo === k}
        aria-describedby={erro?.campo === k ? `${uid}-erro` : undefined}
        {...extra}
      />
      {erro?.campo === k && (
        <p id={`${uid}-erro`} className="form-erro">
          {erro.texto}
        </p>
      )}
    </div>
  )
  return (
    <form ref={raiz} className="form-conta cs-form" onSubmit={enviar} noValidate>
      {campo('apelido', TC.apelido, { placeholder: TC.apelidoDica, maxLength: 30, autoComplete: 'off' })}
      {!semCep ? (
        <>
          {campo('cep', TC.cep, {
            inputMode: 'numeric',
            autoComplete: 'postal-code',
            maxLength: 9,
            onBlur: (e: { target: HTMLInputElement }) => void procurar(e.target.value),
          })}
          {procurando && <p className="legenda">{TC.procurando}</p>}
          {campo('rua', TC.rua, { autoComplete: 'address-line1', maxLength: 120 })}
          {campo('numero', TC.numero, { autoComplete: 'address-line2', maxLength: 40 })}
          {campo('bairro', TC.bairro, { maxLength: 60 })}
        </>
      ) : (
        campo('livre', TC.livre, { maxLength: 200, autoComplete: 'street-address' })
      )}
      <button
        type="button"
        className="botao-texto toque form-trocar"
        onClick={() => {
          setSemCep((x) => !x)
          setErro(null)
        }}
      >
        {semCep ? TC.comCep : TC.semCep}
      </button>
      <div className="cs-form-linha">
        {campo('cidade', TC.cidade, { autoComplete: 'address-level2', maxLength: 60 })}
        <div className="form-campo cs-uf">
          <label htmlFor={`${uid}-uf`}>{TC.estado}</label>
          <select id={`${uid}-uf`} name="uf" value={v.uf} onChange={(e) => mudar('uf')(e.target.value)} aria-invalid={erro?.campo === 'uf'} aria-describedby={erro?.campo === 'uf' ? `${uid}-erro` : undefined}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u.toUpperCase()}
              </option>
            ))}
          </select>
          {erro?.campo === 'uf' && (
            <p id={`${uid}-erro`} className="form-erro">
              {erro.texto}
            </p>
          )}
        </div>
      </div>
      {erro?.campo === 'geral' && (
        <p className="form-alerta" role="alert">
          {erro.texto}
        </p>
      )}
      <div className="form-acoes">
        <button type="submit" className="botao botao-cheio botao-largo" disabled={ocupado} aria-disabled={ocupado}>
          {TC.guardar}
        </button>
        <button type="button" className="botao botao-contorno botao-largo" onClick={() => aoFim(false)}>
          {TC.cancelar}
        </button>
      </div>
    </form>
  )
}

export function SecaoMeusDados() {
  const avisar = useUI((s) => s.avisar)
  const [ocupado, setOcupado] = useState(false)
  return (
    <section className="conta-secao" aria-labelledby="conta-meus-dados">
      <h3 id="conta-meus-dados" className="conta-titulo">
        {TC.dados}
      </h3>
      <p className="legenda cs-legenda">{TC.dadosLegenda}</p>
      <button
        type="button"
        className="botao botao-contorno"
        disabled={ocupado}
        aria-disabled={ocupado}
        onClick={async () => {
          setOcupado(true)
          const ok = await baixarMeusDados()
          setOcupado(false)
          avisar(ok ? TC.baixou : TC.naoBaixou)
        }}
      >
        {TC.baixar}
      </button>
    </section>
  )
}
