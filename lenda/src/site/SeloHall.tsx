/**
 * O selo do Hall público de uma carreira da conta (v3.2, X2): Minhas carreiras e o rodapé do resumo da própria
 * carreira. Num arquivo à parte para os dois pedaços (que são carregados separados) não puxarem um ao outro.
 */
import { EyeOff, Hourglass, ShieldAlert, Users } from 'lucide-react'
import type { SeloHall } from './carreiras'

const ICONE_SELO = { ok: Users, revisao: Hourglass, aviso: ShieldAlert, neutro: EyeOff } as const

/** O chip ("No Hall público", "Em revisão", "Fora do Hall", "Privada"), com a frase do servidor no `title`. */
export function ChipHall({ selo }: { selo: SeloHall }) {
  const Ico = ICONE_SELO[selo.tom]
  const cls = selo.tom === 'ok' ? 'sc-chip sc-chip--ok' : selo.tom === 'neutro' ? 'sc-chip' : selo.tom === 'revisao' ? 'sc-chip sc-chip--rev' : 'sc-chip sc-chip--warn'
  return (
    <span className={cls} title={selo.texto ?? 'Aparece no Hall das Lendas da comunidade'}>
      <Ico aria-hidden="true" /> {selo.rotulo}
    </span>
  )
}

/** O selo e, se houver, a frase inteira ao lado (rodapé do resumo). */
export function SeloNoResumo({ selo }: { selo: SeloHall }) {
  return (
    <span className={`sc-hallresumo is-${selo.tom}`} role="status">
      <ChipHall selo={selo} />
      {selo.texto && <span className="sc-hallresumo__t">{selo.texto}</span>}
    </span>
  )
}
