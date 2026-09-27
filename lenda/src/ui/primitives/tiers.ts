/**
 * OVR tiers (DESIGN-SPEC-noite §8) + LENDA "grades" inspired by Copero's 90/95/99 badges.
 *
 *   tier:  bronze < 70 · silver 70–79 · gold 80–89 · lenda ≥ 90   (metal, colour)
 *   grade: lenda 90–94 (holo) · elite 95–98 (holo + halo aura) · icon 99 (obsidian-violet, pulsing aura)
 */
export type OvrTier = 'bronze' | 'silver' | 'gold' | 'lenda'
export type OvrGrade = 'base' | 'lenda' | 'elite' | 'icon'

export function tierOf(ovr: number): OvrTier {
  return ovr >= 90 ? 'lenda' : ovr >= 80 ? 'gold' : ovr >= 70 ? 'silver' : 'bronze'
}

export function gradeOf(ovr: number): OvrGrade {
  return ovr >= 99 ? 'icon' : ovr >= 95 ? 'elite' : ovr >= 90 ? 'lenda' : 'base'
}

export const TIER_LABEL: Record<OvrTier, string> = { bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', lenda: 'Lenda' }
export const GRADE_LABEL: Record<OvrGrade, string> = { base: '', lenda: 'Lenda', elite: 'Elite', icon: 'Ícone' }

/** Chart colours per tier (§8). */
export const TIER_CHART: Record<OvrTier, { line: string; band: string }> = {
  bronze: { line: '#e3a06a', band: 'rgba(192,122,72,.07)' },
  silver: { line: '#dfe5ee', band: 'rgba(205,212,224,.05)' },
  gold: { line: '#ffd66e', band: 'rgba(240,198,83,.075)' },
  lenda: { line: '#e2d4ff', band: 'rgba(205,185,255,.10)' },
}

/** Plain-CSS palette for exports (share card PNG via html-to-image — no theme vars there). */
export const TIER_EXPORT: Record<OvrTier | 'elite' | 'icon', { bg: string; ink: string }> = {
  bronze: { bg: 'linear-gradient(135deg,#643619 0%,#b07044 28%,#f0b884 46%,#c47d49 60%,#7a4220 100%)', ink: '#2b1306' },
  silver: { bg: 'linear-gradient(135deg,#59606b 0%,#a9b0ba 28%,#f4f6f9 46%,#bcc4cf 60%,#6c7482 100%)', ink: '#1b212c' },
  gold: { bg: 'linear-gradient(135deg,#79530b 0%,#d8b24b 28%,#fff0b3 46%,#f0c653 60%,#93650e 100%)', ink: '#2c1d00' },
  lenda: { bg: 'conic-gradient(from 200deg at 60% 40%,#ffd3f2,#bff3ff,#d9ffc9,#fff0b8,#ffc9e8,#cfd4ff,#ffd3f2)', ink: '#1d1233' },
  elite: { bg: 'conic-gradient(from 200deg at 60% 40%,#ffd3f2,#bff3ff,#d9ffc9,#fff0b8,#ffc9e8,#cfd4ff,#ffd3f2)', ink: '#1d1233' },
  icon: { bg: 'conic-gradient(from 210deg at 55% 38%,#1c0c36,#4a1a86 16%,#0b0714 36%,#5b1580 58%,#120824 78%,#1c0c36)', ink: '#ffffff' },
}
