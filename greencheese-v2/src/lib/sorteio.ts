// O sorteio do Teste minha sorte em dois passos (src/lib/raridade.ts explica a regra), a mesma conta do servidor
// (sorte.php: gc_sortear, gc_sorteio_grupos, gc_sorteio_chances, gc_chances_ler):
// 1) a raridade, pela chance dela (em décimos de %, inteiro) entre as raridades que têm algum prêmio na lista — a das
//    vazias se reparte entre as outras, na proporção; raridade em 0% nunca sai;
// 2) o prêmio, pelo peso dele dentro da raridade (inteiro, de 1 a 1000; o padrão é 1).
// Se nenhuma raridade com prêmio tem chance (todas em 0%), todo giro ainda ganha: os prêmios entram num grupo só, pelo
// peso. O site usa no sorteio do aparelho (a conta sem servidor); o painel, pra mostrar a chance real de cada prêmio.
import { CHANCES_PADRAO, INFO_RARIDADE, RARIDADES, raridadeDe, type Raridade } from './raridade'

export type Chances = Record<Raridade, number>

interface Sorteavel {
  peso: number
  raridade?: unknown
}

/** O peso do prêmio dentro da raridade, em inteiro (o que veio torto vale 1). */
export const pesoDe = (p: Sorteavel): number => Math.max(1, Math.round(Number.isFinite(p.peso) ? p.peso : 1))

interface Grupo<T> {
  raridade: Raridade | null
  /** Décimos de %. */
  peso: number
  premios: T[]
}

/** Os grupos do 1º passo: cada raridade com prêmio na lista e chance acima de 0 (ou o grupo só, se nenhuma tem). */
export function gruposDoSorteio<T extends Sorteavel>(lista: readonly T[], chances: Chances): Grupo<T>[] {
  const grupos: Grupo<T>[] = []
  for (const r of RARIDADES) {
    const premios = lista.filter((p) => raridadeDe(p) === r)
    if (premios.length) grupos.push({ raridade: r, peso: Math.max(0, Math.round((chances[r] ?? 0) * 10)), premios })
  }
  if (grupos.length && grupos.every((g) => g.peso === 0)) return [{ raridade: null, peso: 1, premios: [...lista] }]
  return grupos.filter((g) => g.peso > 0)
}

/** A chance de cada prêmio sair (0 a 1), na ordem da lista. */
export function chancesReais<T extends Sorteavel>(lista: readonly T[], chances: Chances): Map<T, number> {
  const out = new Map<T, number>(lista.map((p) => [p, 0]))
  const grupos = gruposDoSorteio(lista, chances)
  const total = grupos.reduce((s, g) => s + g.peso, 0)
  for (const g of grupos) {
    const pesos = g.premios.reduce((s, p) => s + pesoDe(p), 0)
    for (const p of g.premios) out.set(p, (g.peso / total) * (pesoDe(p) / pesos))
  }
  return out
}

/** Inteiro de 0 a n − 1, sem viés (crypto.getRandomValues com descarte). */
export function inteiroAleatorio(n: number): number {
  if (n <= 1) return 0
  const limite = Math.floor(2 ** 32 / n) * n
  const a = new Uint32Array(1)
  for (let i = 0; i < 64; i++) {
    try {
      crypto.getRandomValues(a)
    } catch {
      a[0] = Math.floor(Math.random() * 2 ** 32) // reserva: navegador sem crypto
    }
    if (a[0] < limite) return a[0] % n
  }
  return a[0] % n
}

function escolher<T>(itens: readonly T[], peso: (x: T) => number, aleatorio: (n: number) => number): T {
  const total = itens.reduce((s, x) => s + peso(x), 0)
  let n = aleatorio(total)
  for (const x of itens) {
    n -= peso(x)
    if (n < 0) return x
  }
  return itens[itens.length - 1]
}

/** O sorteio em dois passos (a raridade, depois o prêmio dentro dela). Lista vazia: null. */
export function sortearPorRaridade<T extends Sorteavel>(lista: readonly T[], chances: Chances, aleatorio: (n: number) => number = inteiroAleatorio): T | null {
  if (!lista.length) return null
  const grupo = escolher(gruposDoSorteio(lista, chances), (g) => g.peso, aleatorio)
  return escolher(grupo.premios, pesoDe, aleatorio)
}

/* ───────────────────────── as chances (painel e o que chega do servidor) ───────────────────────── */

/** Soma das chances em décimos de % (100% = 1000). */
export const somaDecimos = (c: Partial<Record<Raridade, number>>): number => RARIDADES.reduce((s, r) => s + Math.round((c[r] ?? 0) * 10), 0)

export type ErroChances = { erro: string; raridade: Raridade | null }

/**
 * Por que as chances não fecham (ou null): as 4 raridades, números de 0 a 100 com até 1 casa decimal, somando 100, e
 * cada uma menor ou igual à da raridade anterior ("quanto mais raro, menor a chance"). As mesmas mensagens do servidor.
 */
export function problemaNasChances(c: Partial<Record<Raridade, unknown>>): ErroChances | null {
  const dec: Partial<Record<Raridade, number>> = {}
  for (const r of RARIDADES) {
    const v = c[r]
    const nome = INFO_RARIDADE[r].nome
    if (typeof v !== 'number' || !Number.isFinite(v)) return { erro: `A chance do ${nome} tem que ser um número (ex.: 12,5).`, raridade: r }
    if (v < 0 || v > 100) return { erro: `A chance do ${nome} vai de 0% a 100%.`, raridade: r }
    if (Math.abs(v * 10 - Math.round(v * 10)) > 1e-6) return { erro: `A chance do ${nome} tem até 1 casa depois da vírgula (ex.: 12,5%).`, raridade: r }
    dec[r] = Math.round(v * 10)
  }
  const soma = somaDecimos(dec)
  if (soma !== 1000) return { erro: `As 4 chances somam 100% (agora dão ${String(soma / 10).replace('.', ',')}%).`, raridade: null }
  for (let i = 1; i < RARIDADES.length; i++) {
    const r = RARIDADES[i]
    const antes = RARIDADES[i - 1]
    if ((dec[r] ?? 0) > (dec[antes] ?? 0)) return { erro: `Quanto mais raro, menor a chance: ${INFO_RARIDADE[r].nome} não pode passar de ${INFO_RARIDADE[antes].nome}.`, raridade: r }
  }
  return null
}

/** As chances que chegaram (do servidor, da loja guardada), se fecham; senão, null. */
export function chancesDe(v: unknown): Chances | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const c = v as Partial<Record<Raridade, unknown>>
  if (problemaNasChances(c)) return null
  return { comum: c.comum as number, raro: c.raro as number, epico: c.epico as number, lendario: c.lendario as number }
}

/** As de fábrica (60/25/12/3), num objeto novo. */
export const chancesDeFabrica = (): Chances => ({ ...CHANCES_PADRAO })

/** "12,5%" · "3%" · "0,5%" */
export function formatarPct(x: number, casas = 1): string {
  const v = Number(x.toFixed(casas))
  return `${String(v).replace('.', ',')}%`
}

/** "1 em 8" (a chance real em "1 em N", arredondado; abaixo de 1 em 1000, "menos de 1 em 1000"). */
export function umEm(p: number): string {
  if (p <= 0) return 'nunca'
  if (p >= 1) return 'sempre'
  const n = Math.round(1 / p)
  return n > 1000 ? 'menos de 1 em 1000' : `1 em ${n}`
}
