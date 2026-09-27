/**
 * PRNG determinístico do LENDA.
 *
 * - `hashSeed` (FNV-1a 32 bits) transforma qualquer string em semente.
 * - `Rng` usa mulberry32 (rápido, boa distribuição para jogo).
 * - `rng(seed, ...keys)` cria um sub-stream independente e reprodutível,
 *   ex.: rng(world.seed, 'season', 2027, 'bra.1'). Mesmo par (seed, chaves) ⇒ mesma sequência.
 */

export function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export class Rng {
  private s: number

  constructor(seed: number | string) {
    this.s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9
  }

  /** Float em [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Float em [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Inteiro em [min, max] (inclusivo). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** true com probabilidade p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: lista vazia')
    return items[Math.floor(this.next() * items.length)]
  }

  /** Escolha ponderada. Pesos ≤ 0 são ignorados. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0
    for (const it of items) total += Math.max(0, weight(it))
    if (total <= 0) return this.pick(items)
    let r = this.next() * total
    for (const it of items) {
      r -= Math.max(0, weight(it))
      if (r < 0) return it
    }
    return items[items.length - 1]
  }

  /** Embaralha uma cópia (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  /** k itens distintos. */
  sample<T>(items: readonly T[], k: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, k))
  }

  /** Normal (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12)
    const v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Poisson (Knuth) — adequado para médias de gols (λ < 10). */
  poisson(lambda: number): number {
    const L = Math.exp(-Math.max(0, lambda))
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > L)
    return k - 1
  }
}

/** Sub-stream reprodutível: rng(seed, 'season', 2027, 'bra.1'). */
export function rng(seed: string, ...keys: (string | number)[]): Rng {
  return new Rng(keys.length ? `${seed}:${keys.join(':')}` : seed)
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
