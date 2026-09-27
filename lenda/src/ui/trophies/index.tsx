/**
 * Arte de troféus (SVG). Contrato estável usado por toda a UI:
 *
 *   <TrophyArt id="libertadores" size={64} />
 *
 * `id` = Trophy.id do catálogo (src/data/catalog). Se não houver arte específica,
 * cai numa arte genérica pela família/metal do troféu.
 * Pasta de propriedade do time de arte de troféus — a UI só importa daqui.
 */
import type { CSSProperties } from 'react'
import type { Trophy } from '@/engine/types'

export interface TrophyArtProps {
  id: string
  /** Altura em px (a largura segue a proporção da arte). */
  size?: number
  /** Metadados do catálogo para o fallback genérico. */
  trophy?: Pick<Trophy, 'family' | 'metal' | 'accent'>
  className?: string
  style?: CSSProperties
  title?: string
}

export function TrophyArt({ size = 48, className, style, title }: TrophyArtProps) {
  // Placeholder até o time de arte entregar as SVGs reais.
  return (
    <svg viewBox="0 0 64 96" height={size} className={className} style={style} role="img" aria-label={title}>
      <defs>
        <linearGradient id="lx-trophy-fallback" x1="0" x2="1">
          <stop offset="0" stopColor="#8a8f9c" />
          <stop offset=".5" stopColor="#f1f3f7" />
          <stop offset="1" stopColor="#7b808c" />
        </linearGradient>
      </defs>
      <path d="M14 8h36v10c0 14-8 24-18 26C22 42 14 32 14 18z" fill="url(#lx-trophy-fallback)" />
      <rect x="28" y="44" width="8" height="22" fill="url(#lx-trophy-fallback)" />
      <rect x="18" y="66" width="28" height="8" rx="2" fill="url(#lx-trophy-fallback)" />
      <rect x="14" y="74" width="36" height="14" rx="2" fill="#23252c" />
    </svg>
  )
}

/** Ids com arte específica (preenchido pelo time de arte). */
export const TROPHY_ART_IDS: readonly string[] = []
