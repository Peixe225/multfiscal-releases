/**
 * Boas-vindas e agradecimentos na tela da live ("Chegou Ana · comenta 1 a 4 pra jogar", "Valeu por seguir,
 * Bia!"): fila pura, sem relógio próprio — quem chama passa `now` (a store mostra e agenda; ver store.ts).
 *
 *   const q = createShoutQueue()
 *   q.push('join', user, now)    // false = repetido (mesma pessoa em 10 min) ou fila cheia
 *   q.take(now)                  // a próxima a mostrar agora, ou null (no máximo 1 a cada 4 s)
 *   q.wait(now)                  // ms até poder mostrar a próxima (null = fila vazia)
 *
 * Regras (sala vazia: cada pessoa que entra é ouro, mas a tela não pode virar um painel de chegada):
 *   - no máximo uma na tela a cada SHOUT.gapMs (4 s), cada uma por SHOUT.showMs;
 *   - fila de até SHOUT.cap (3): entrada nova com a fila cheia é descartada; seguir/compartilhar vale mais
 *     e toma o lugar da entrada mais antiga da fila;
 *   - a mesma pessoa não é saudada de novo pelo mesmo motivo em SHOUT.repeatMs (10 min) — quem sai e volta,
 *     ou o TikTok repetindo o evento, não gera outra chamada.
 */
import type { LiveUser } from './types'

export type ShoutKind = 'join' | 'follow' | 'share'

export interface Shout {
  id: number
  kind: ShoutKind
  user: LiveUser
  at: number
}

export const SHOUT = { gapMs: 4000, showMs: 3400, cap: 3, repeatMs: 10 * 60_000 } as const

export interface ShoutQueue {
  push(kind: ShoutKind, user: LiveUser, now: number): boolean
  take(now: number): Shout | null
  wait(now: number): number | null
  size(): number
  clear(): void
}

export function createShoutQueue(opts: { gapMs: number; cap: number; repeatMs: number } = SHOUT): ShoutQueue {
  /** `${tipo}|@` → quando entrou na fila pela última vez. */
  const seen = new Map<string, number>()
  let queue: Shout[] = []
  let lastShown = -Infinity
  let seq = 0
  return {
    push(kind, user, now) {
      const key = `${kind}|${user.id}`
      const prev = seen.get(key)
      if (prev != null && now - prev < opts.repeatMs) return false
      if (queue.length >= opts.cap) {
        if (kind === 'join') return false
        const i = queue.findIndex((s) => s.kind === 'join')
        if (i < 0) return false
        queue.splice(i, 1)
      }
      seen.set(key, now)
      queue.push({ id: ++seq, kind, user, at: now })
      // limpeza de quem já pode ser saudado de novo (lives longas, salas cheias)
      if (seen.size > 2000) for (const [k, t] of seen) if (now - t >= opts.repeatMs) seen.delete(k)
      return true
    },
    take(now) {
      if (!queue.length || now - lastShown < opts.gapMs) return null
      lastShown = now
      return queue.shift() ?? null
    },
    wait(now) {
      return queue.length ? Math.max(0, opts.gapMs - (now - lastShown)) : null
    },
    size: () => queue.length,
    clear() {
      queue = []
      seen.clear()
      lastShown = -Infinity
    },
  }
}
