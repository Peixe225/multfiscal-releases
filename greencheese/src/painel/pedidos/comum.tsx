// Peças das telas de pedidos e avisos: o selo do status, a linha da lista, o histórico dos avisos e o copiar.
import { useEffect, useRef, useState } from 'react'
import { brl, dia, hora, plural, relativo, whatsappBonito } from '../formato'
import { Link } from '../Moldura'
import { caminho } from '../rotas'
import { Botao, Ic } from '../ui'
import type { EnvioAviso, PedidoLinha, StatusPedido } from './tipos'

const NOME_STATUS: Record<StatusPedido, string> = { novo: 'Novo', confirmado: 'Confirmado', saiu: 'Saiu pra entrega', entregue: 'Entregue', cancelado: 'Cancelado' }
const NOME_STATUS_ENC: Record<StatusPedido, string> = { novo: 'Nova', confirmado: 'Confirmada', saiu: 'Saiu pra entrega', entregue: 'Entregue', cancelado: 'Cancelada' }

/** "Confirmado" · "Confirmada" (encomenda). */
export function nomeStatus(s: StatusPedido, tipo: 'pedido' | 'encomenda' = 'pedido'): string {
  return (tipo === 'encomenda' ? NOME_STATUS_ENC : NOME_STATUS)[s]
}

export function SeloPedido({ status, tipo }: { status: StatusPedido; tipo: 'pedido' | 'encomenda' }) {
  return <span className={`pd-status pd-status-${status}`}>{nomeStatus(status, tipo)}</span>
}

/** "hoje 18h30" · "ontem 9h" · "sex, 10/10 14h" */
export function diaHora(iso: string, agora: number): string {
  return `${dia(iso, agora)} ${hora(iso)}`
}

/** Uma linha da lista: quem, o status, o valor, os itens e de onde. Toca e abre o pedido. */
export function LinhaPedido({ p, agora }: { p: PedidoLinha; agora: number }) {
  const valor = p.tipo === 'encomenda' ? null : p.subtotal != null ? brl(p.subtotal) : 'a consultar'
  return (
    <Link href={caminho.pedido(p.id)} className={`pd-linha toque${p.dadosApagados ? ' pd-linha-apagado' : ''}`}>
      <span className="pd-linha-topo">
        <strong className="pd-linha-nome">{p.nome}</strong>
        <SeloPedido status={p.status} tipo={p.tipo} />
        {p.tipo === 'encomenda' && <span className="pd-tag">Encomenda</span>}
      </span>
      <span className="pd-linha-valor">
        {valor}
        {p.tipo === 'pedido' && p.unidades > 0 && <small>{plural(p.unidades, 'item', 'itens')}</small>}
      </span>
      {p.resumo && <span className="pd-linha-itens">{p.resumo}</span>}
      <span className="pd-linha-meta">
        <span className="pn-codigo">{p.codigo}</span> · {p.cidade ? `${p.cidade} (${p.uf.toUpperCase()})` : p.uf.toUpperCase()} ·{' '}
        <time dateTime={p.criadoEm}>{relativo(p.criadoEm, agora)}</time>
        {p.substituidoPor && <> · trocado pelo {p.substituidoPor.codigo}</>}
      </span>
    </Link>
  )
}

/** Copia um texto (com o plano B dos navegadores sem a área de transferência). */
export async function copiarTexto(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto)
  } catch {
    const t = document.createElement('textarea')
    t.value = texto
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

/** Botão "Copiar" que vira "Copiado" por 2,5 s (e avisa o leitor de tela). */
export function BotaoCopiar({ texto, rotulo = 'Copiar', variante = 'cinza', className }: { texto: string; rotulo?: string; variante?: 'cinza' | 'texto' | 'contorno'; className?: string }) {
  const [copiado, setCopiado] = useState(false)
  const t = useRef(0)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return (
    <>
      <Botao
        variante={variante}
        icone={copiado ? 'check' : 'copiar'}
        className={className}
        onClick={async () => {
          await copiarTexto(texto)
          setCopiado(true)
          window.clearTimeout(t.current)
          t.current = window.setTimeout(() => setCopiado(false), 2500)
        }}
      >
        {copiado ? 'Copiado' : rotulo}
      </Botao>
      <span className="sr-only" role="status">
        {copiado ? 'Copiado' : ''}
      </span>
    </>
  )
}

// ─── histórico dos avisos ───────────────────────────────────────────────────────────────────────────────────────

/** O pedido do aviso ('pedido:12' → 12), ou null. */
export function pedidoDoAviso(e: EnvioAviso): number | null {
  const m = /^pedido:(\d+)$/.exec(e.alvo)
  return m ? Number(m[1]) : null
}

function codigoDoAviso(e: EnvioAviso): string {
  const p = /^participacao:(.+)$/.exec(e.alvo)
  if (p) return p[1]
  return /#?(GC-[A-Z0-9]{5})/.exec(e.texto)?.[1] ?? ''
}

/** "Pedido GC-7KD2X" · "Reserva no rateio · RAT-K8EA" · "Mensagem de teste" */
export function tituloDoAviso(e: EnvioAviso): string {
  const c = codigoDoAviso(e)
  const de = c ? ` ${c}` : ''
  switch (e.tipo) {
    case 'pedido':
      return `Pedido${de}`
    case 'pedido-atualizado':
      return `Pedido${de} (o cliente mudou)`
    case 'encomenda':
      return `Encomenda${de}`
    case 'encomenda-atualizado':
      return `Encomenda${de} (o cliente mudou)`
    case 'rateio-reserva':
      return `Reserva no rateio${c ? ` · ${c}` : ''}`
    case 'rateio-pago':
      return `Pagamento de rateio${c ? ` · ${c}` : ''}`
    case 'teste':
      return 'Mensagem de teste'
    default:
      return e.texto.split('\n')[0].replace(/[*_]/g, '').slice(0, 60) || 'Aviso'
  }
}

function praOnde(e: EnvioAviso): string {
  if (!e.para) return 'no grupo'
  return e.para.tipo === 'numero' ? `pro ${whatsappBonito(e.para.valor)}` : 'pra outro grupo'
}

/** Como tá o aviso, numa frase: "Enviado no grupo hoje 18h30" · "Não foi (3 tentativas)…" */
export function situacaoDoAviso(e: EnvioAviso, agora: number): string {
  switch (e.status) {
    case 'enviado':
      return `Enviado ${praOnde(e)} · ${diaHora(e.enviadoEm ?? e.atualizadoEm, agora)}`
    case 'falhou': {
      const vezes = plural(e.tentativas, 'tentativa', 'tentativas')
      return e.tentarEm ? `Não foi (${vezes}) · tenta de novo sozinho às ${hora(e.tentarEm)}` : `Não foi (${vezes}) · ${diaHora(e.atualizadoEm, agora)}`
    }
    case 'enviando':
      return 'Enviando…'
    default:
      return 'Na fila · sai em instantes'
  }
}

const POR: Record<string, string> = { sistema: 'automático' }

function quemTentou(por: string): string {
  if (por.startsWith('painel:')) return `pelo painel (${por.slice(7)})`
  return POR[por] ?? por
}

function LinhaAviso({ e, agora, ocupado, aoReenviar, comPedido }: { e: EnvioAviso; agora: number; ocupado: boolean; aoReenviar: (e: EnvioAviso) => void; comPedido: boolean }) {
  const pedido = comPedido ? pedidoDoAviso(e) : null
  const reenviar = (rotulo: string, variante: 'cinza' | 'texto') => (
    <Botao variante={variante} className="pn-botao-p" icone="giro" ocupado={ocupado} onClick={() => aoReenviar(e)}>
      {rotulo}
      <span className="sr-only"> ({tituloDoAviso(e)})</span>
    </Botao>
  )
  const icone = e.status === 'enviado' ? 'check' : e.status === 'falhou' ? 'atencao' : 'relogio'
  return (
    <li className={`pd-envio pd-envio-${e.status}`}>
      <div className="pd-envio-topo">
        <span className="pd-envio-ic" aria-hidden="true">
          <Ic nome={icone} tamanho={16} />
        </span>
        <span className="pd-envio-txt">
          <strong>{tituloDoAviso(e)}</strong>
          <span>{situacaoDoAviso(e, agora)}</span>
        </span>
      </div>
      {e.status === 'falhou' && e.erro && <p className="pd-envio-erro">{e.erro}</p>}
      <div className="pd-envio-acoes">
        {e.reenvia && e.status === 'falhou' && reenviar('Mandar de novo', 'cinza')}
        {pedido != null && (
          <Link className="pn-link" href={caminho.pedido(pedido)}>
            Ver o pedido
          </Link>
        )}
      </div>
      <details className="pd-detalhes pd-envio-mais">
        <summary>{e.reenvia ? 'Ver a mensagem' : 'Ver o registro'}</summary>
        <p className="pd-zap-msg">{e.texto}</p>
        {e.ultimas.length > 0 && (
          <ul className="pd-tentativas" aria-label="Últimas tentativas">
            {e.ultimas.map((t, i) => (
              <li key={i}>
                {diaHora(t.em, agora)} · {t.motor === 'zapi' ? 'Z-API' : t.motor === 'evolution' ? 'Evolution' : t.motor === 'webhook' ? 'Webhook' : t.motor} · {t.ok ? `foi (${(t.ms / 1000).toFixed(1).replace('.', ',')} s)` : `não foi${t.erro ? `: ${t.erro}` : ''}`} · {quemTentou(t.por)}
              </li>
            ))}
          </ul>
        )}
        {e.reenvia && e.status === 'enviado' && <div className="pd-envio-acoes pd-envio-acoes-dentro">{reenviar('Mandar outra vez', 'cinza')}</div>}
        {!e.reenvia && <p className="pd-tentativas">Esse aviso não fica guardado com o texto de verdade, por isso não dá pra mandar de novo daqui.</p>}
      </details>
    </li>
  )
}

/** O histórico dos avisos (mais novo primeiro), com o "Mandar de novo" nos que não foram. */
export function ListaAvisos({ envios, agora, ocupado, aoReenviar, comPedido = true }: { envios: EnvioAviso[]; agora: number; ocupado: number | null; aoReenviar: (e: EnvioAviso) => void; comPedido?: boolean }) {
  return (
    <ul className="pd-envios">
      {envios.map((e) => (
        <LinhaAviso key={e.id} e={e} agora={agora} ocupado={ocupado === e.id} aoReenviar={aoReenviar} comPedido={comPedido} />
      ))}
    </ul>
  )
}
