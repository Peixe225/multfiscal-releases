/**
 * Arte de troféus (SVG). Contrato estável usado por toda a UI:
 *
 *   <TrophyArt id="libertadores" size={64} />
 *
 * `id` = Trophy.id (ou Trophy.art) do catálogo. Cada arte vive em ./svg/<id>.svg e é
 * carregada sob demanda (code-split). Os ids internos do SVG (gradientes, filtros) são
 * prefixados por instância para que várias cópias na mesma página não se "roubem" as cores.
 * Sem arte específica, cai numa arte genérica escolhida pela família do troféu.
 */
import { useEffect, useId, useState, type CSSProperties } from 'react'
import type { Trophy, TrophyFamily } from '@/engine/types'

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

const files = import.meta.glob('./svg/*.svg', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>

const pathOf = (id: string) => `./svg/${id}.svg`

/** Ids com arte específica disponível. */
export const TROPHY_ART_IDS: readonly string[] = Object.keys(files).map((p) => p.slice(6, -4))

export function hasTrophyArt(id: string): boolean {
  return pathOf(id) in files
}

/** Arte genérica por família quando o troféu não tem SVG próprio. */
const FAMILY_FALLBACK: Partial<Record<TrophyFamily, string[]>> = {
  world_cup: ['world-cup'],
  national_continental: ['copa-america', 'estadual'],
  club_world_cup: ['club-world-cup', 'world-cup'],
  continental_primary: ['champions-league', 'estadual'],
  continental_secondary: ['cup-generic', 'copa-do-brasil', 'estadual'],
  continental_tertiary: ['cup-generic', 'estadual'],
  league: ['league-generic', 'estadual'],
  domestic_cup: ['cup-generic', 'copa-do-brasil', 'estadual'],
  award: ['award-generic', 'golden-boot'],
}

function resolveArt(id: string, family?: TrophyFamily): string | null {
  if (hasTrophyArt(id)) return id
  for (const alt of (family && FAMILY_FALLBACK[family]) ?? ['league-generic', 'estadual']) {
    if (hasTrophyArt(alt)) return alt
  }
  return null
}

const cache = new Map<string, Promise<string>>()
const loaded = new Map<string, string>()

function loadSvg(art: string): Promise<string> {
  let p = cache.get(art)
  if (!p) {
    p = files[pathOf(art)]().then((raw) => {
      loaded.set(art, raw)
      return raw
    })
    cache.set(art, p)
  }
  return p
}

/** Prefixa ids e referências (#id / url(#id)) e remove width/height fixos do <svg>. */
function prepare(raw: string, prefix: string, size: number, title?: string): string {
  let svg = raw
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sid="([^"]+)"/g, ` id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, `$1="#${prefix}$2"`)
    .replace(/aria-labelledby="([^"]+)"/g, (_m, ids: string) =>
      `aria-labelledby="${ids
        .split(/\s+/)
        .map((x) => prefix + x)
        .join(' ')}"`,
    )
  svg = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const clean = attrs.replace(/\s(width|height)="[^"]*"/g, '')
    return `<svg${clean} height="${size}" style="height:${size}px;width:auto;display:block;overflow:visible" focusable="false">`
  })
  if (title) svg = svg.replace(/<title\b[^>]*>[\s\S]*?<\/title>/, '')
  return svg
}

export function TrophyArt({ id, size = 48, trophy, className, style, title }: TrophyArtProps) {
  const art = resolveArt(id, trophy?.family)
  const reactId = useId()
  const prefix = `t${reactId.replace(/[^a-zA-Z0-9]/g, '')}-`
  const [raw, setRaw] = useState<string | null>(() => (art ? (loaded.get(art) ?? null) : null))

  useEffect(() => {
    if (!art) return
    const ready = loaded.get(art)
    if (ready) {
      setRaw(ready)
      return
    }
    let alive = true
    loadSvg(art).then((r) => alive && setRaw(r))
    return () => {
      alive = false
    }
  }, [art])

  if (!art || !raw) {
    return <FallbackTrophy size={size} className={className} style={style} title={title} metal={trophy?.metal} />
  }
  return (
    <span
      role="img"
      aria-label={title}
      className={className}
      style={{ display: 'inline-block', lineHeight: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: prepare(raw, prefix, size, title) }}
    />
  )
}

const METALS = {
  gold: ['#7a5a17', '#f6dc8c', '#a47a24'],
  silver: ['#6b717d', '#f3f5f8', '#7b808c'],
  bronze: ['#6e3b1c', '#e8a57a', '#8a4a24'],
  crystal: ['#6f8fb0', '#eaf4ff', '#7d9bbd'],
} as const

/** Silhueta mínima (enquanto carrega ou se não houver nenhuma arte). */
function FallbackTrophy({
  size,
  className,
  style,
  title,
  metal = 'silver',
}: {
  size: number
  className?: string
  style?: CSSProperties
  title?: string
  metal?: Trophy['metal']
}) {
  const gid = `tf${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [a, b, c] = METALS[metal ?? 'silver']
  return (
    <svg viewBox="0 0 64 96" height={size} className={className} style={style} role="img" aria-label={title}>
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0" stopColor={a} />
          <stop offset=".5" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
      </defs>
      <path d="M14 8h36v10c0 14-8 24-18 26C22 42 14 32 14 18z" fill={`url(#${gid})`} />
      <rect x="28" y="44" width="8" height="22" fill={`url(#${gid})`} />
      <rect x="18" y="66" width="28" height="8" rx="2" fill={`url(#${gid})`} />
      <rect x="14" y="74" width="36" height="14" rx="2" fill="#23252c" />
    </svg>
  )
}
