/**
 * Boas-vindas e agradecimentos na tela da live ("Chegou Ana · comenta 1 a 4 pra jogar", "Valeu por seguir,
 * Bia!"): fila pura, sem relógio próprio — quem chama passa `now` (a store mostra e agenda; ver store.ts).
 *
 *   const q = createShoutQueue()
 *   q.push('join', user, now)    // false = repetido (mesma pessoa em 10 min) ou fila cheia
 *   q.take(now, gap)             // a próxima a mostrar agora, ou null (no máximo 1 a cada `gap`)
 *   q.wait(now, gap)             // ms até poder mostrar a próxima (null = fila vazia)
 *   shoutGap(viewers)            // o `gap` pelo tamanho da sala (4 s vazia … 14 s cheia)
 *
 * Regras (sala vazia: cada pessoa que entra é ouro, mas a tela não pode virar um painel de chegada):
 *   - no máximo uma na tela a cada SHOUT.gapMs (4 s), cada uma por SHOUT.showMs. Com a sala enchendo, o
 *     intervalo cresce (shoutGap): as chamadas de como jogar dividem a mesma linha e precisam de tempo de
 *     leitura entre uma boas-vindas e outra; com sala cheia (JOIN_SHOUT_MAX_VIEWERS) entrada não ganha
 *     chamada, só seguir/compartilhar;
 *   - entrada que esperou mais de SHOUT.joinMaxAgeMs na fila é descartada (a pessoa talvez nem esteja mais
 *     lá); seguir/compartilhar espera até SHOUT.maxAgeMs;
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

export const SHOUT = { gapMs: 4000, showMs: 3400, cap: 3, repeatMs: 10 * 60_000, joinMaxAgeMs: 20_000, maxAgeMs: 60_000 } as const

/** Com tanta gente assistindo, entrar na sala não ganha mais chamada (só seguir/compartilhar). */
export const JOIN_SHOUT_MAX_VIEWERS = 50

/**
 * Intervalo entre duas chamadas pelo tamanho da sala (espectadores do TikTok; sem o número = sala vazia):
 * menos de 5 → 4 s (cada pessoa é saudada), 5 a 19 → 8 s, 20 ou mais → 14 s (sobra linha para as chamadas
 * de como jogar entre uma boas-vindas e outra).
 */
export function shoutGap(viewers: number | null | undefined): number {
  if (viewers == null || viewers < 5) return SHOUT.gapMs
  return viewers < 20 ? 8000 : 14_000
}

export interface ShoutQueue {
  push(kind: ShoutKind, user: LiveUser, now: number): boolean
  take(now: number, gapMs?: number): Shout | null
  wait(now: number, gapMs?: number): number | null
  size(): number
  clear(): void
}

export function createShoutQueue(opts: { gapMs: number; cap: number; repeatMs: number; joinMaxAgeMs?: number; maxAgeMs?: number } = SHOUT): ShoutQueue {
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
    take(now, gapMs = opts.gapMs) {
      // velhas demais: quem entrou há muito tempo talvez nem esteja mais na sala
      queue = queue.filter((s) => now - s.at <= (s.kind === 'join' ? (opts.joinMaxAgeMs ?? Infinity) : (opts.maxAgeMs ?? Infinity)))
      if (!queue.length || now - lastShown < gapMs) return null
      lastShown = now
      return queue.shift() ?? null
    },
    wait(now, gapMs = opts.gapMs) {
      return queue.length ? Math.max(0, gapMs - (now - lastShown)) : null
    },
    size: () => queue.length,
    clear() {
      queue = []
      seen.clear()
      lastShown = -Infinity
    },
  }
}
