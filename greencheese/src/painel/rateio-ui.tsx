// Peças do rateio no painel: selo do status, contador "8/10" com um bloco por vaga, linha do tempo e a prévia do
// cartão como o cliente vê no site.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Logo } from '../arte/Logo'
import { canalDa } from '../dados/canais'
import { ArteRateio } from './Arte'
import { brl, diaMes, faixaDias, listaUfs, vagas as txtVagas } from './formato'
import type { RateioAdmin, StatusRateio } from './tipos'
import { Ic } from './ui'

export const NOME_STATUS: Record<StatusRateio, string> = {
  rascunho: 'Rascunho',
  aberto: 'Aberto',
  fechado: 'Fechou',
  pedido: 'Pedido feito',
  caminho: 'A caminho',
  chegou: 'Chegou',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
}

/** O selo em pixel. Aberto: contorno com o ponto aceso (ao vivo); rascunho: tracejado; o resto: cheio. */
export function Selo({ status, pequeno = false, carimbar = false }: { status: StatusRateio; pequeno?: boolean; carimbar?: boolean }) {
  return (
    <span className={`pn-selo px pn-selo-${status}${pequeno ? ' pn-selo-p' : ''}${carimbar ? ' pn-carimbo' : ''}`}>
      {NOME_STATUS[status].toUpperCase()}
    </span>
  )
}

/** Blocos: um por vaga (até 30; com mais, 30 degraus). Pago = cheio, reservado = xadrez, livre = vazio. */
export function Blocos({ vagas, confirmadas, reservadas, grande = false, antes }: { vagas: number; confirmadas: number; reservadas: number; grande?: boolean; antes?: number }) {
  const n = Math.max(1, Math.min(vagas, 30))
  const pagos = Math.min(n, Math.round((confirmadas / vagas) * n))
  const guardados = Math.max(0, Math.min(n - pagos, Math.round(((confirmadas + reservadas) / vagas) * n) - pagos))
  // os que acabaram de ser pagos (antes = confirmadas de antes) enchem em degrau, um depois do outro
  const de = antes == null ? pagos : Math.min(pagos, Math.round((antes / vagas) * n))
  return (
    <span className={`pn-blocos${grande ? ' pn-blocos-g' : ''}`} style={{ '--n': n } as CSSProperties} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          className={i < pagos ? (i >= de ? 'pn-pago pn-novo' : 'pn-pago') : i < pagos + guardados ? 'pn-guardado' : undefined}
          style={i >= de && i < pagos ? ({ '--i': i - de } as CSSProperties) : undefined}
        />
      ))}
    </span>
  )
}

/** O contador grande do detalhe: confirmadas/vagas, reservadas à parte e as livres. */
export function Contador({ r }: { r: RateioAdmin }) {
  const lotou = r.confirmadas >= r.vagas
  // o contador lembra quanto era: quando sobe (pagamento confirmado), os blocos novos enchem
  const antes = useRef<{ id: string; n: number } | null>(null)
  const anterior = antes.current && antes.current.id === r.id && antes.current.n < r.confirmadas ? antes.current.n : undefined
  useEffect(() => {
    antes.current = { id: r.id, n: r.confirmadas }
  }, [r.id, r.confirmadas])
  return (
    <div className="pn-contador">
      <p className="pn-contador-linha">
        <span className="pn-contador-num px" aria-hidden="true">
          {r.confirmadas}
          <span className="pn-contador-de">/{r.vagas}</span>
        </span>
        <span className="pn-contador-rot">
          <strong>{lotou ? 'lotou' : 'vagas pagas'}</strong>
          <span className="sr-only">
            {r.confirmadas} de {r.vagas} vagas pagas.
          </span>
          {r.reservadas > 0 && <span className="pn-contador-res">+{r.reservadas} {r.reservadas === 1 ? 'reservada' : 'reservadas'}</span>}
          {!lotou && <span className="pn-contador-livres">{r.disponiveis === 1 ? '1 livre' : `${r.disponiveis} livres`}</span>}
        </span>
      </p>
      <Blocos key={r.confirmadas} vagas={r.vagas} confirmadas={r.confirmadas} reservadas={r.reservadas} grande antes={anterior} />
    </div>
  )
}

const PASSOS: { status: StatusRateio; nome: string; data: (r: RateioAdmin) => string | null }[] = [
  { status: 'aberto', nome: 'Aberto', data: (r) => r.abertoEm },
  { status: 'fechado', nome: 'Fechou', data: (r) => r.fechadoEm },
  { status: 'pedido', nome: 'Pedido feito', data: (r) => r.pedidoEm },
  { status: 'caminho', nome: 'A caminho', data: (r) => r.caminhoEm },
  { status: 'chegou', nome: 'Chegou', data: (r) => r.chegouEm },
  { status: 'encerrado', nome: 'Entregue', data: (r) => r.encerradoEm },
]
const ORDEM: StatusRateio[] = ['rascunho', 'aberto', 'fechado', 'pedido', 'caminho', 'chegou', 'encerrado']

/** A linha do status com as datas de cada passo. */
export function LinhaDoTempo({ r }: { r: RateioAdmin }) {
  const atual = ORDEM.indexOf(r.status)
  return (
    <ol className={`pn-tempo${r.status === 'cancelado' ? ' pn-tempo-cancelado' : ''}`} aria-label="Passos do rateio">
      {PASSOS.map((p) => {
        const i = ORDEM.indexOf(p.status)
        const feito = r.status !== 'cancelado' ? i <= atual : !!p.data(r)
        const agora = i === atual
        const d = p.data(r)
        return (
          <li key={p.status} className={`${feito ? 'feito' : ''}${agora ? ' atual' : ''}`} aria-current={agora ? 'step' : undefined}>
            <span className="pn-tempo-ponto" aria-hidden="true" />
            <span className="pn-tempo-nome">{p.nome}</span>
            <span className="pn-tempo-dia">{d && feito ? diaMes(d) : feito ? '' : ' '}</span>
            {!feito && <span className="sr-only"> (ainda não)</span>}
          </li>
        )
      })}
    </ol>
  )
}

/** O que o cliente vê no site: o post do perfil com a mídia em forma de story (espelha o cartão do site). */
export function PreviaCartao({ r, rodape }: { r: Pick<RateioAdmin, 'titulo' | 'produtoId' | 'imagem' | 'precoRateio' | 'precoDepois' | 'vagas' | 'confirmadas' | 'reservadas' | 'disponiveis' | 'ufs' | 'previsaoMin' | 'previsaoMax' | 'fechaEm' | 'status' | 'descricao'>; rodape?: ReactNode }) {
  const eco = r.precoDepois != null && r.precoDepois > r.precoRateio ? Math.round((r.precoDepois - r.precoRateio) * 100) / 100 : null
  const insta = canalDa(r.ufs[0])?.instagram ?? 'greencheese_imports'
  const aberto = r.status === 'aberto' || r.status === 'rascunho'
  const sobra = r.vagas - r.confirmadas - r.reservadas
  return (
    <article className="pn-previa" aria-label="Prévia do cartão no site">
      <header className="pn-previa-cab">
        <span className="pn-previa-avatar" aria-hidden="true">
          <Logo tamanho={28} />
        </span>
        <span className="pn-previa-cab-txt">
          <span className="pn-previa-nome">{insta}</span>
          <span className="pn-previa-sub">Rateio · vale pra {r.ufs.length ? listaUfs(r.ufs) : '…'}</span>
        </span>
      </header>
      <div className="pn-previa-midia">
        <div className="pn-previa-barras" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i}>
              <i style={{ transform: `scaleX(${i === 0 ? Math.min(1, r.confirmadas / Math.max(1, r.vagas)) : 0})` }} />
            </span>
          ))}
        </div>
        <span className="pn-previa-selo px">{aberto ? 'ABERTO' : NOME_STATUS[r.status].toUpperCase()}</span>
        <div className="pn-previa-arte">
          <ArteRateio produtoId={r.produtoId} imagem={r.imagem} largura={96} />
        </div>
        <p className="pn-previa-titulo px">{r.titulo || 'Nome do rateio'}</p>
        <p className="pn-previa-preco">
          <span className="px pn-previa-valor">{r.precoRateio > 0 ? brl(r.precoRateio) : 'R$ –'}</span>
          <span className="px pn-previa-no">no rateio</span>
        </p>
        {r.precoDepois != null && eco != null && (
          <p className="pn-previa-depois">
            <span>{brl(r.precoDepois)} quando chegar</span>
            <span className="pn-previa-eco">economiza {brl(eco)}</span>
          </p>
        )}
        <div className="pn-previa-adesivos">
          <div className="pn-previa-contador">
            <p>
              <span className="px pn-previa-num">
                {r.confirmadas}/{r.vagas || '–'}
              </span>
              <strong>vagas</strong>
              {r.reservadas > 0 && <span className="pn-previa-res">+{r.reservadas} {r.reservadas === 1 ? 'reservada' : 'reservadas'}</span>}
            </p>
            {r.vagas > 0 && <Blocos vagas={r.vagas} confirmadas={r.confirmadas} reservadas={r.reservadas} />}
          </div>
          {aberto && (
            <span className="pn-previa-entrar">
              <span className="pn-previa-entrar-ic">
                <Ic nome="caixa-cheia" tamanho={16} />
              </span>
              <span className="pn-previa-entrar-txt">
                <strong>Entrar no rateio</strong>
                <small>{sobra === r.vagas ? (sobra === 1 ? '1 vaga livre' : `${sobra} vagas livres`) : `${sobra === 1 ? 'sobra' : 'sobram'} ${txtVagas(Math.max(0, sobra))}`}</small>
              </span>
              <span className="pn-previa-mais">
                <Ic nome="mais" tamanho={16} />
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="pn-previa-legenda">
        <p>
          <strong>Previsão: {faixaDias(r.previsaoMin, r.previsaoMax)} depois que fechar.</strong>{' '}
          {r.fechaEm ? `Fecha dia ${diaMes(r.fechaEm)} ou quando lotar.` : 'Fecha quando lotar.'}
        </p>
        {r.descricao && <p className="pn-previa-desc">{r.descricao}</p>}
        {rodape}
      </div>
    </article>
  )
}
