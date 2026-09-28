/**
 * PLACEHOLDER (cockpit team) — the tabs team replaces this file.
 * Contract: default export (and a named export), no required props; read everything from the
 * stores (useCareer / useData). Rendered inside the cockpit's right panel, which already provides
 * the tab header and the glass panel — render only the tab body (it may scroll: the parent is a
 * flex column with min-height 0).
 */
import { CalendarDays } from 'lucide-react'

export function SeasonTab() {
  return (
    <div className="grid place-items-center gap-2 py-16 text-center text-text-3">
      <CalendarDays size={28} aria-hidden="true" />
      <p className="m-0 font-display text-[16px] font-extrabold text-text-2">Temporada</p>
      <p className="m-0 max-w-[320px] text-[12.5px]">Tabela da liga com zonas de classificação, copas e o seu clube em destaque. Em breve.</p>
    </div>
  )
}

export default SeasonTab
