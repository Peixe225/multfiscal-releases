/**
 * v3.5 · o mínimo para o Safari 15.0–15.3 (iPhone com iOS 15 sem atualizar). O build sai em ES2022 e o jogo usa três
 * coisas que só chegaram no Safari 15.4: Array.prototype.at (o Hall: "n.at is not a function"), structuredClone (toda
 * decisão da carreira: "Não foi possível simular a temporada") e Object.hasOwn. Importado PRIMEIRO pelo main.tsx, antes
 * de qualquer outro módulo do jogo. Onde já existem (todo navegador atual), nada muda.
 *
 * Piso de suporte: iOS/Safari 15.0+, Chrome/Android 92+ (o alvo do build é ['es2022', 'safari15'] no vite.config.ts).
 */

/** Array/String/TypedArray.prototype.at: índice negativo conta do fim; fora da faixa, undefined. */
export function emPosicao(this: ArrayLike<unknown>, i: number): unknown {
  const n = this.length >>> 0
  let k = Math.trunc(Number(i)) || 0
  if (k < 0) k += n
  return k < 0 || k >= n ? undefined : this[k]
}

/** Object.hasOwn. */
export function temProprio(o: unknown, k: PropertyKey): boolean {
  if (o == null) throw new TypeError('Cannot convert undefined or null to object')
  return Object.prototype.hasOwnProperty.call(Object(o), k)
}

function erroDeClone(o: unknown): Error {
  const msg = `${Object.prototype.toString.call(o)} could not be cloned.`
  try {
    return new DOMException(msg, 'DataCloneError')
  } catch {
    return new TypeError(msg)
  }
}

/**
 * structuredClone para o que o jogo clona (estado da carreira): primitivos, objetos e arrays (com ciclos e referências
 * repetidas), Date, RegExp, Map, Set, ArrayBuffer, TypedArray/DataView, Error e os primitivos embrulhados. Como o de
 * verdade: objeto de classe vira objeto simples (só as chaves próprias enumeráveis) e função ou símbolo dá DataCloneError.
 */
export function clonar<T>(valor: T): T {
  const vistos = new Map<object, unknown>()
  const ir = (v: unknown): unknown => {
    if (typeof v === 'function' || typeof v === 'symbol') throw erroDeClone(v)
    if (v === null || typeof v !== 'object') return v
    const ja = vistos.get(v)
    if (ja !== undefined) return ja
    const tag = Object.prototype.toString.call(v)
    if (tag === '[object Date]') {
      const d = new Date((v as Date).getTime())
      vistos.set(v, d)
      return d
    }
    if (tag === '[object RegExp]') {
      const r = new RegExp((v as RegExp).source, (v as RegExp).flags)
      vistos.set(v, r)
      return r
    }
    if (tag === '[object Boolean]' || tag === '[object Number]' || tag === '[object String]') {
      const b = Object((v as { valueOf(): unknown }).valueOf())
      vistos.set(v, b)
      return b
    }
    if (v instanceof ArrayBuffer) {
      const b = v.slice(0)
      vistos.set(v, b)
      return b
    }
    if (ArrayBuffer.isView(v)) {
      const buf = ir(v.buffer) as ArrayBuffer
      const C = (v as unknown as { constructor: new (b: ArrayBuffer, o: number, n: number) => unknown }).constructor
      const n = v instanceof DataView ? v.byteLength : (v as unknown as { length: number }).length
      const c = new C(buf, v.byteOffset, n)
      vistos.set(v, c)
      return c
    }
    if (v instanceof Map) {
      const m = new Map()
      vistos.set(v, m)
      for (const [k, x] of v) m.set(ir(k), ir(x))
      return m
    }
    if (v instanceof Set) {
      const s = new Set()
      vistos.set(v, s)
      for (const x of v) s.add(ir(x))
      return s
    }
    if (v instanceof Error) {
      const e = new Error(v.message)
      e.name = v.name
      if (v.stack) e.stack = v.stack
      vistos.set(v, e)
      return e
    }
    if (Array.isArray(v)) {
      const a: unknown[] = new Array(v.length)
      vistos.set(v, a)
      for (let i = 0; i < v.length; i++) if (i in v) a[i] = ir(v[i])
      return a
    }
    if (tag !== '[object Object]' && tag !== '[object Arguments]') throw erroDeClone(v)
    const o: Record<string, unknown> = {}
    vistos.set(v, o)
    for (const k of Object.keys(v)) o[k] = ir((v as Record<string, unknown>)[k])
    return o
  }
  return ir(valor) as T
}

/** Põe o que faltar (não mexe no que o navegador já tem). Devolve os nomes postos (para o teste). */
export function instalarPolyfills(g: typeof globalThis = globalThis): string[] {
  const postos: string[] = []
  const definir = (alvo: object, nome: string, valor: unknown) => {
    Object.defineProperty(alvo, nome, { value: valor, writable: true, configurable: true, enumerable: false })
  }
  const protos: [string, object | undefined][] = [
    ['Array', g.Array?.prototype],
    ['String', g.String?.prototype],
    ['TypedArray', g.Int8Array ? Object.getPrototypeOf(g.Int8Array.prototype) : undefined],
  ]
  for (const [nome, p] of protos) {
    if (p && typeof (p as { at?: unknown }).at !== 'function') {
      definir(p, 'at', emPosicao)
      postos.push(`${nome}.prototype.at`)
    }
  }
  if (typeof (g.Object as { hasOwn?: unknown }).hasOwn !== 'function') {
    definir(g.Object, 'hasOwn', temProprio)
    postos.push('Object.hasOwn')
  }
  if (typeof (g as { structuredClone?: unknown }).structuredClone !== 'function') {
    definir(g, 'structuredClone', clonar)
    postos.push('structuredClone')
  }
  return postos
}

instalarPolyfills()
