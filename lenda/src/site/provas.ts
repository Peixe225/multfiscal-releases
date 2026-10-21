/**
 * Conquistas PROVADAS (servidor/CONTRATO-v34.md §A.0 e §B): uma carreira do Clássico começada com a conta (semente sorteada
 * pelo servidor + replay) prova, na conta, as conquistas que ela desbloqueou (HallEntry.career.achievements); as que vieram
 * só do aparelho continuam aparecendo, como "não provadas".
 *
 *   lembrarSementeDoServidor(uid, seed)        // pontes.ts: a semente que o servidor sorteou para esta conta
 *   ehCarreiraProva(h, uid)                    // a carreira pode provar algo na conta? (Clássico, replay, semente do servidor)
 *   conquistasNovasParaProvar(h, provadas)     // as dela que a conta ainda não tem provadas
 *   aplicarProvas(resposta)                    // GET/POST conquistas.php → useConquistasSite.provadas
 *
 * Quem decide se a carreira é prova é o servidor (semente_em, replay, limite do dia, suspeita). Aqui o jogo só escolhe
 * quais carreiras sobem sozinhas para a conta: sem a semente do servidor (sem conta, sem rede, o aparelho sorteou), ela não
 * provaria nada e só ocuparia lugar na conta.
 */
import type { HallEntry } from '@/store/career'
import { useConquistasSite, type ContagemProva, type ProvaConquista } from '@/store/conquistasSite'
import { sementeDoPar } from '@/engine/replay'
import { armazem, type Armazem } from './medicao'

export const CHAVE_SEMENTES = 'lenda:sementes-servidor'
/** Quantas sementes do servidor o aparelho lembra (100 carreiras por dia: alguns dias de folga). */
export const SEMENTES_MAX = 600
const ID_CONQUISTA = /^[a-z0-9_.:-]{1,64}$/

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

interface Sementes {
  uid: number
  s: string[]
}

function lerSementes(a: Armazem): Sementes | null {
  try {
    const j = JSON.parse(a.get(CHAVE_SEMENTES) || 'null') as Partial<Sementes> | null
    if (!j || typeof j.uid !== 'number' || !Array.isArray(j.s)) return null
    return { uid: j.uid, s: j.s.filter((x): x is string => typeof x === 'string' && /^[0-9a-z]{2,14}$/.test(x)) }
  } catch {
    return null
  }
}

/** A semente (texto) que o servidor sorteou para a conta `uid` (trocou de conta no aparelho: começa outra lista). */
export function lembrarSementeDoServidor(uid: number, seed: string, a: Armazem = ls): void {
  if (!/^[0-9a-z]{2,14}$/.test(seed)) return
  const atual = lerSementes(a)
  const lista = atual && atual.uid === uid ? atual.s.filter((x) => x !== seed) : []
  lista.push(seed)
  a.set(CHAVE_SEMENTES, JSON.stringify({ uid, s: lista.slice(-SEMENTES_MAX) }))
}

/** Esta semente veio do servidor para esta conta? */
export function sementeDoServidor(uid: number, seed: string, a: Armazem = ls): boolean {
  const atual = lerSementes(a)
  return !!atual && atual.uid === uid && atual.s.includes(seed)
}

/** De que conta são as sementes do servidor lembradas neste aparelho (null = nenhuma). */
export function uidDasSementes(a: Armazem = ls): number | null {
  return lerSementes(a)?.uid ?? null
}

/** A semente (texto) do replay da carreira (null sem replay válido). */
export function sementeDaCarreira(h: Pick<HallEntry, 'replay'>): string | null {
  const p = h.replay?.seed
  return Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 0x1_0000_0000) ? sementeDoPar([p[0], p[1]]) : null
}

/** As conquistas que a carreira desbloqueou (HallEntry.career.achievements), sem repetir. */
export function conquistasDaCarreira(h: Pick<HallEntry, 'career'>): string[] {
  const l = (h.career as { achievements?: unknown } | undefined)?.achievements
  return Array.isArray(l) ? [...new Set(l.filter((x): x is string => typeof x === 'string' && ID_CONQUISTA.test(x)))] : []
}

/**
 * A carreira pode provar conquistas na conta `uid`: Clássico, motor real, com replay e com a semente que o servidor sorteou
 * para essa conta (lembrada neste aparelho). O servidor confere de novo (e decide).
 */
export function ehCarreiraProva(h: Pick<HallEntry, 'mode' | 'engine' | 'replay' | 'id'>, uid: number, a: Armazem = ls): boolean {
  if (h.mode !== 'classic' || h.engine !== 'real' || !h.replay) return false
  const seed = sementeDaCarreira(h)
  return !!seed && h.id === `career-${seed}` && sementeDoServidor(uid, seed, a)
}

/** As conquistas da carreira que a conta ainda não tem provadas (`provadas` null = não sabe: nenhuma). */
export function conquistasNovasParaProvar(h: Pick<HallEntry, 'career'>, provadas: Readonly<Record<string, unknown>> | null, catalogo?: ReadonlySet<string>): string[] {
  if (!provadas) return []
  return conquistasDaCarreira(h).filter((id) => !provadas[id] && (!catalogo || catalogo.has(id)))
}

// ───────────────────────────── resposta do servidor ─────────────────────────────

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

/**
 * As provadas da resposta de conquistas.php (GET ou sincronizar): `conquistas: [{id, em, provada, verificada, carreira}]` e
 * as contagens. Servidor sem o campo `provada` (antes da v3.4): null (o jogo não sabe; nada aparece como provada).
 */
export function normalizarProvas(x: unknown): { provadas: Record<string, ProvaConquista>; contagem: ContagemProva | null } | null {
  const r = x as { conquistas?: unknown; provadas?: unknown; verificadas?: unknown; naoProvadas?: unknown; total?: unknown } | null
  if (!r || !Array.isArray(r.conquistas)) return null
  let sabe = false
  const provadas: Record<string, ProvaConquista> = {}
  for (const c of r.conquistas) {
    const o = c as Record<string, unknown> | null
    if (!o || typeof o.id !== 'string' || !ID_CONQUISTA.test(o.id)) continue
    if (typeof o.provada === 'boolean') sabe = true
    if (o.provada !== true) continue
    provadas[o.id] = { verificada: o.verificada === true, carreira: typeof o.carreira === 'string' && o.carreira.length <= 64 ? o.carreira : null }
  }
  const p = int(r.provadas)
  if (!sabe && p === null) return null
  const total = int(r.total)
  const contagem: ContagemProva | null =
    p !== null ? { provadas: p, verificadas: int(r.verificadas) ?? 0, naoProvadas: int(r.naoProvadas) ?? 0, total: total ?? 0 } : null
  return { provadas, contagem }
}

/** Grava as provadas que vieram do servidor (resposta de conquistas.php). Devolve se o servidor sabe de provas. */
export function aplicarProvas(x: unknown): boolean {
  const n = normalizarProvas(x)
  if (!n) return false
  useConquistasSite.setState({ provadas: n.provadas, contagemProva: n.contagem })
  return true
}

/** O salvar respondeu `provasNovas`: entram já como provadas (o GET seguinte confirma). */
export function somarProvasNovas(ids: unknown, carreira: string): string[] {
  const novas = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string' && ID_CONQUISTA.test(x))
  if (!novas.length) return []
  const s = useConquistasSite.getState()
  const prov = { ...(s.provadas ?? {}) }
  let mais = 0
  for (const id of novas)
    if (!prov[id]) {
      prov[id] = { verificada: false, carreira }
      mais++
    }
  const c = s.contagemProva
  useConquistasSite.setState({ provadas: prov, contagemProva: c ? { ...c, provadas: c.provadas + mais, naoProvadas: Math.max(0, c.naoProvadas - mais) } : c })
  return novas
}
