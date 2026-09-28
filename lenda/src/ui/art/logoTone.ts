/**
 * Logo "tone": ESPN league/competition logos are drawn for light backgrounds, so they sit on a white
 * tile — except the ones that are themselves (almost) white, which need a dark tile.
 *
 * The white logos are listed up front (measured from public/leagues/*.webp: mean luminance of the
 * opaque pixels > 0.86), so the right tile shows on the first frame and also where the canvas probe
 * cannot run — e.g. inside claude.ai, where a tainted canvas left the Premier League logo a blank
 * white square. Logos outside the list are measured once per URL.
 *
 * Shared by the landing ticker / Ligas ao vivo (LeagueLogo) and the career tabs / summary (CompLogo).
 */
import { useCallback, useState, type SyntheticEvent } from 'react'

/** (Almost) white logos in public/leagues, by file key (= league / competition id). */
export const LIGHT_LOGOS: ReadonlySet<string> = new Set([
  'eng.1',
  'fra.1',
  'ned.1',
  'sco.1',
  'aus.1',
  'arg.copa',
  'ita.coppa_italia',
  'uefa.champions',
  'uefa.europa',
  'uefa.europa.conf',
])

const probed = new Map<string, boolean>()

/** File key of a logo URL: `…/leagues/eng.1.webp?x` → `eng.1`. */
export function logoKey(url: string): string {
  const file = url.split(/[?#]/)[0].split('/').pop() ?? ''
  return file.replace(/\.(webp|png|svg|jpe?g)$/i, '')
}

/** Known-light by id or URL (no probe). */
export function isKnownLightLogo(idOrUrl: string): boolean {
  return LIGHT_LOGOS.has(idOrUrl) || LIGHT_LOGOS.has(logoKey(idOrUrl))
}

/** Mean luminance of the opaque pixels > 0.86. False when the canvas is unavailable / tainted. */
export function probeLightLogo(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas')
    const n = 24
    c.width = n
    c.height = n
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    let sum = 0
    let count = 0
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255
      if (a < 0.35) continue
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
      count++
    }
    return count > 20 && sum / count > 0.86
  } catch {
    return false
  }
}

/**
 * `[light, onLoad]` for a logo `<img>`: `light` is true for listed logos from the first render, and
 * for other logos once the loaded image measures light (cached per URL). Pass `enabled=false` when
 * the logo is not drawn on a tile.
 */
export function useLogoTone(url: string, enabled = true): [boolean, (e: SyntheticEvent<HTMLImageElement>) => void] {
  const known = isKnownLightLogo(url)
  const [light, setLight] = useState(() => known || (probed.get(url) ?? false))
  const onLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      if (!enabled || known) return
      let v = probed.get(url)
      if (v === undefined) {
        v = probeLightLogo(e.currentTarget)
        probed.set(url, v)
      }
      if (v) setLight(true)
    },
    [enabled, known, url],
  )
  return [known || light, onLoad]
}
