import type { Combo, Produto } from './tipos'

export interface CalculoLinha {
  /** Total da linha já com o melhor combo aplicado. null = há preço a consultar. */
  total: number | null
  /** Total sem combo (qtd × unitário). */
  semCombo: number | null
  /** Combos usados, ex.: [{ qtd: 3, total: 19.99, vezes: 1 }]. */
  combos: (Combo & { vezes: number })[]
  /** Unidades cobradas pelo preço unitário. */
  avulsas: number
  economia: number
}

export function precoUnitario(p: Produto, variacaoId?: string | null): number | null {
  const v = variacaoId ? p.variacoes?.find((x) => x.id === variacaoId) : undefined
  return v?.preco ?? p.preco
}

/** Menor custo para levar `qtd` unidades, combinando combos e unidades avulsas (programação dinâmica). */
export function calcularLinha(p: Produto, qtd: number, variacaoId?: string | null): CalculoLinha {
  const unit = precoUnitario(p, variacaoId)
  if (unit == null || qtd <= 0) {
    return { total: unit == null ? null : 0, semCombo: unit == null ? null : 0, combos: [], avulsas: qtd, economia: 0 }
  }
  const combos = (p.combos ?? []).filter((c) => c.qtd > 1 && c.total > 0)
  // custo[n] em centavos para evitar erro de ponto flutuante
  const cent = (v: number) => Math.round(v * 100)
  const custo: number[] = [0]
  const escolha: number[] = [-1] // -1 = unidade avulsa, i = combo i
  for (let n = 1; n <= qtd; n++) {
    let melhor = custo[n - 1] + cent(unit)
    let qual = -1
    combos.forEach((c, i) => {
      if (c.qtd <= n) {
        const v = custo[n - c.qtd] + cent(c.total)
        if (v < melhor) {
          melhor = v
          qual = i
        }
      }
    })
    custo[n] = melhor
    escolha[n] = qual
  }
  const usados = new Map<number, number>()
  let avulsas = 0
  for (let n = qtd; n > 0; ) {
    const e = escolha[n]
    if (e === -1) {
      avulsas++
      n -= 1
    } else {
      usados.set(e, (usados.get(e) ?? 0) + 1)
      n -= combos[e].qtd
    }
  }
  const total = custo[qtd] / 100
  const semCombo = (cent(unit) * qtd) / 100
  return {
    total,
    semCombo,
    combos: [...usados.entries()].map(([i, vezes]) => ({ ...combos[i], vezes })),
    avulsas,
    economia: Math.max(0, Math.round((semCombo - total) * 100) / 100),
  }
}
