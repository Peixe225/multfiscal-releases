// Só no desenvolvimento (npm run dev): `?raridade=comum|raro|epico|lendario` força a raridade da revelação e do story,
// pra ver as 4 antes de os prêmios terem raridade de verdade (a outra frente põe nos dados). No build de produção
// import.meta.env.DEV é false e isto vira `null` (o parâmetro é ignorado: ninguém força um lendário no site no ar).
import { ehRaridade, type Raridade } from '../../../lib/raridade'

export function raridadeForcada(): Raridade | null {
  if (!import.meta.env.DEV) return null
  try {
    const v = new URLSearchParams(location.search).get('raridade')
    return ehRaridade(v) ? v : null
  } catch {
    return null
  }
}
