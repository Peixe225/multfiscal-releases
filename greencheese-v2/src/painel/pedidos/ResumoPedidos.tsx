// Bloco dos pedidos no Resumo: os novos (até 5, o mais novo primeiro), quantos estão em andamento e, quando é o caso,
// os avisos no grupo que não foram ou estão desligados. O número de novos também vai pra frase de cima do Resumo e pra
// bolinha da barra (useNovosPedidos), sem outra ida ao servidor.
//
// Ao vivo (pedido do Ian em 14/10: a aba de pedidos "que atualiza toda vez que um cliente faz um pedido"): UMA leitura
// do resumo pro painel inteiro, perguntada de novo com o ETag (o servidor responde 304 sem corpo quando nada mudou): a
// cada 15 s com o Início ou a lista de Pedidos aberta (usePressaNosPedidos), a cada 60 s nas outras telas (a bolinha);
// com a aba do navegador escondida, nada; quando ela volta (e quando a internet volta), na hora. A lista de Pedidos
// pede uma conferência na hora quando ela mesma mudou (atualizarResumoPedidos): a bolinha sobe junto.
import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../api'
import { naoMudou } from '../api'
import { plural } from '../formato'
import { Link } from '../Moldura'
import { caminho } from '../rotas'
import { Ic } from '../ui'
import { resumoPedidos } from './api'
import { LinhaPedido } from './comum'
import './estilo'
import type { ResumoPedidos as TResumo } from './tipos'

/** Com o Início ou a lista aberta (e a aba à vista). */
export const RITMO_RAPIDO_MS = 15_000
/** Nas outras telas: só a bolinha da barra. */
export const RITMO_LENTO_MS = 60_000

let atual: TResumo | undefined
let etag: string | null = null
let dono: string | null = null
let ligado = false
let pressa = 0
let relogio = 0
let emCurso = false
let ultimaVez = 0
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

const visivel = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Pergunta agora (se ligado, com a aba à vista e sem outra pergunta no caminho). */
async function perguntar(): Promise<void> {
  if (!ligado || emCurso || !visivel()) return
  emCurso = true
  const quem = dono
  try {
    const r = await resumoPedidos(undefined, atual ? etag : null)
    ultimaVez = Date.now()
    if (quem !== dono || !ligado) return
    if (naoMudou(r)) return
    const e = (r as { _etag?: unknown })._etag
    etag = typeof e === 'string' && e ? e : null
    atual = r
    avisar()
  } catch {
    // sem rede, servidor sem a rota, sessão caindo (o login abre por cima): fica o que tava, tenta na próxima
  } finally {
    emCurso = false
  }
}

function agendar(): void {
  window.clearTimeout(relogio)
  if (!ligado || !visivel()) return
  relogio = window.setTimeout(() => {
    void perguntar().finally(agendar)
  }, pressa > 0 ? RITMO_RAPIDO_MS : RITMO_LENTO_MS)
}

let vigiando = false
function vigiar(): void {
  if (vigiando || typeof document === 'undefined') return
  vigiando = true
  // a aba some: para tudo; volta: pergunta na hora e retoma o ritmo
  document.addEventListener('visibilitychange', () => {
    if (visivel()) void perguntar().finally(agendar)
    else window.clearTimeout(relogio)
  })
  window.addEventListener('online', () => void perguntar().finally(agendar))
}

/** Confere o resumo agora (a lista de Pedidos mudou, um pedido mudou de passo): a bolinha e o Início acompanham. */
export function atualizarResumoPedidos(): void {
  void perguntar().finally(agendar)
}

/**
 * Liga a leitura do resumo (a Moldura, com o papel que vê pedidos) e devolve o resumo de agora. Trocou quem tá logado:
 * começa do zero (o ETag e o resumo eram de outra pessoa).
 */
export function useResumoPedidos(pode = true, login: string | null = null): TResumo | undefined {
  useEffect(() => {
    vigiar()
    if (login !== dono) {
      dono = login
      atual = undefined
      etag = null
      avisar()
    }
    ligado = pode
    if (pode) void perguntar().finally(agendar)
    else window.clearTimeout(relogio)
    return () => {
      ligado = false
      window.clearTimeout(relogio)
    }
  }, [pode, login])
  return useSyncExternalStore(assinar, () => (ligado ? atual : undefined))
}

/** O resumo de agora, pra quem só lê (o bloco do Início). */
export function useResumoAtual(): TResumo | undefined {
  return useSyncExternalStore(assinar, () => atual)
}

/**
 * A tela quer o ritmo de 15 s (o Início, a lista de Pedidos): enquanto ela tá montada. Ao entrar, desenha na hora o
 * que tinha e confere por trás (com o ETag: sem mudança, 304; a pergunta que já tá no caminho não sai de novo).
 */
export function usePressaNosPedidos(): void {
  useEffect(() => {
    pressa++
    if (Date.now() - ultimaVez > 1000) void perguntar().finally(agendar)
    else agendar()
    return () => {
      pressa = Math.max(0, pressa - 1)
      agendar()
    }
  }, [])
}

/** Quantos pedidos novos a última leitura achou (0 até carregar): a frase do Resumo e a bolinha da barra. */
export function useNovosPedidos(): number {
  return useSyncExternalStore(assinar, () => atual?.novos ?? 0)
}

/** Quantos avisos no grupo não foram nos últimos 7 dias (só o dono recebe; 0 pros outros). */
export function useAvisosQueFalharam(): number {
  return useSyncExternalStore(assinar, () => (atual?.avisos?.ligado ? atual.avisos.falhas : 0))
}

export function ResumoPedidos() {
  // o Início tá aberto: o resumo vem a cada 15 s (o pedido novo aparece aqui sem recarregar)
  usePressaNosPedidos()
  const d = useResumoAtual()
  // sem resposta (servidor sem a rota, rede): o Resumo segue sem o bloco
  if (!d) return null
  const agora = api.agora()
  // avisos no grupo: só pra quem cuida deles (o dono); pros outros o servidor manda null
  const a = d.avisos
  return (
    <section className="pn-bloco pd-resumo-novos" aria-labelledby="h-pedidos-novos">
      <div className="pn-h2-linha">
        <h2 id="h-pedidos-novos" className="pn-h2">
          Pedidos novos {d.novos > 0 && <span className="pn-conta">{d.novos}</span>}
        </h2>
        <Link href={caminho.pedidos} className="pn-link">
          Ver pedidos
        </Link>
      </div>
      {/* o aviso que não foi vem antes da lista: é o que o dono precisa resolver (antes ficava embaixo dos pedidos) */}
      {a && a.ligado && a.falhas > 0 && (
        <Link href={caminho.avisos} className="pd-resumo-alerta toque">
          <Ic nome="atencao" tamanho={16} />
          <span>{plural(a.falhas, 'aviso no grupo não foi', 'avisos no grupo não foram')} (7 dias)</span>
          <Ic nome="chevron-dir" tamanho={16} />
        </Link>
      )}
      {d.novos === 0 ? (
        <p className="pn-vazio">
          <Ic nome="check" tamanho={16} />{' '}
          {d.emAndamento > 0 ? `Nenhum novo. ${plural(d.emAndamento, 'pedido', 'pedidos')} em andamento.` : 'Nenhum pedido novo. Quando alguém fechar um pedido pelo site, aparece aqui.'}
        </p>
      ) : (
        <>
          <ul className="pd-lista">
            {d.ultimos.map((p) => (
              <li key={p.id}>
                <LinhaPedido p={p} agora={agora} />
              </li>
            ))}
          </ul>
          {d.novos > d.ultimos.length && (
            <Link href={caminho.pedidosDe('novo', null)} className="pn-link">
              Ver os {d.novos} novos
            </Link>
          )}
          {d.emAndamento > 0 && <p className="pd-resumo-zero">E {plural(d.emAndamento, 'pedido', 'pedidos')} em andamento.</p>}
        </>
      )}
      {a && !a.ligado && (
        <p className="pd-resumo-zero">
          Aviso no grupo do WhatsApp desligado.{' '}
          <Link href={caminho.avisos} className="pn-link">
            Ligar
          </Link>
        </p>
      )}
    </section>
  )
}
