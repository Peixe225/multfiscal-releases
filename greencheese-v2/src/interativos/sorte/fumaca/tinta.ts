// A tinta do texto em cima da cor da raridade (o carimbo na fumaça, o adesivo do story, o selo dos cupons): o tom
// escuro de raridade.ts (contorno e sombra) não dá 4,5:1 em cima da cor cheia (o axe recusou o COMUM em 3,6:1), então
// o texto usa este, quase preto puxado pra cor (comum 10,6:1, raro 6,3:1, épico 5,4:1; no lendário, ≥ 5:1 em todas as
// faixas do holográfico).
import type { Raridade } from '../../../lib/raridade'

export const TINTA_RARIDADE: Record<Raridade, string> = {
  comum: '#1d252b',
  raro: '#04213f',
  epico: '#3a0021',
  lendario: '#1a0b02',
}
