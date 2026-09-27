/**
 * <Flag code="BRA" />            — FIFA code, resolved to iso2 through the data store
 * <Flag iso2="gb-eng" h={16} />  — direct flag-icons key
 *
 * Source: public/flags/4x3/<iso2>.svg (data pipeline). Falls back to the bundled flag-icons
 * subset, then to a text badge.
 */
import { memo, useEffect, useState, type CSSProperties } from 'react'
import { useCountry } from '@/store/data'
import { cx } from './cx'

// Bundled safety net for the most common football nations (lazy URLs — only fetched on error).
const bundled = import.meta.glob(
  '/node_modules/flag-icons/flags/4x3/{br,ar,uy,co,cl,py,pe,ec,bo,ve,mx,us,ca,pt,es,fr,de,it,nl,be,hr,gb-eng,gb-sct,gb-wls,dk,se,no,ch,at,pl,rs,tr,ma,sn,ng,gh,ci,cm,eg,jp,kr,sa,au,ie,ua,cz,gr,ru}.svg',
  { query: '?url', import: 'default' },
) as Record<string, () => Promise<string>>

const FIFA_TO_ISO2: Record<string, string> = {
  BRA: 'br', ARG: 'ar', URU: 'uy', COL: 'co', CHI: 'cl', PAR: 'py', PER: 'pe', ECU: 'ec', BOL: 'bo', VEN: 've',
  MEX: 'mx', USA: 'us', CAN: 'ca', POR: 'pt', ESP: 'es', FRA: 'fr', GER: 'de', ITA: 'it', NED: 'nl', BEL: 'be',
  CRO: 'hr', ENG: 'gb-eng', SCO: 'gb-sct', WAL: 'gb-wls', DEN: 'dk', SWE: 'se', NOR: 'no', SUI: 'ch', AUT: 'at',
  POL: 'pl', SRB: 'rs', TUR: 'tr', MAR: 'ma', SEN: 'sn', NGA: 'ng', GHA: 'gh', CIV: 'ci', CMR: 'cm', EGY: 'eg',
  JPN: 'jp', KOR: 'kr', KSA: 'sa', AUS: 'au', IRL: 'ie', UKR: 'ua', CZE: 'cz', GRE: 'gr', RUS: 'ru',
}

export interface FlagProps {
  /** FIFA 3-letter code (BRA). */
  code?: string | null
  /** flag-icons key (br, gb-eng). Wins over `code`. */
  iso2?: string | null
  /** Height in px (4:3 → width = h × 4/3). Default 13 (chip size 18×13). */
  h?: number
  /** Explicit width (e.g. 30×22 cards). */
  w?: number
  /** Corner radius in px. Default: 2.5 small, 3–4 larger. */
  radius?: number
  title?: string
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

export const Flag = memo(function Flag({ code, iso2, h = 13, w, radius, title, decorative, className, style }: FlagProps) {
  const country = useCountry(iso2 ? null : code)
  const key = (iso2 || country?.iso2 || (code ? FIFA_TO_ISO2[code.toUpperCase()] : '') || '').toLowerCase()
  const width = w ?? Math.round((h * 4) / 3)
  const r = radius ?? (h <= 14 ? 2.5 : h <= 24 ? 3 : 4)
  const name = title ?? country?.name ?? code ?? key.toUpperCase()
  const [stage, setStage] = useState<0 | 1 | 2>(0) // 0 public · 1 bundled · 2 text
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setStage(0)
    setSrc(null)
  }, [key])
  const base = import.meta.env.BASE_URL ?? './'
  const url = stage === 0 ? `${base}flags/4x3/${key}.svg` : src

  const onError = () => {
    if (stage === 0) {
      const loader = bundled[`/node_modules/flag-icons/flags/4x3/${key}.svg`]
      if (loader) {
        setStage(1)
        loader().then(setSrc, () => setStage(2))
        return
      }
    }
    setStage(2)
  }
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name }
  return (
    <span
      className={cx('lx-flag-box', className)}
      style={{ width, height: h, borderRadius: r, boxShadow: '0 0 0 1px rgba(255,255,255,.08), 0 4px 10px -4px #000', ...style }}
      title={decorative ? undefined : name}
      {...a11y}
    >
      {key && stage < 2 && url ? (
        <img src={url} alt="" width={width} height={h} loading="lazy" decoding="async" draggable={false} onError={onError} />
      ) : (
        <span className="lx-flag-fb" style={{ fontSize: Math.max(7, h * 0.52) }}>
          {(code || key).slice(0, 3).toUpperCase()}
        </span>
      )}
    </span>
  )
})
