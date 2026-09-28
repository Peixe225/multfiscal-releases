/**
 * Arte de troféus. Contrato estável usado por toda a UI:
 *
 *   <TrophyArt id="libertadores" size={64} />
 *
 * `id` = Trophy.id (ou Trophy.art) do catálogo. Um id "cru" (League.trophyId, Competition.trophyId)
 * sem arquivo próprio é resolvido pelo catálogo (src/data/catalog/trophies.ts): primeiro a `art`
 * do troféu, depois a arte genérica da sua `family` (estaduais → estadual, copas → cup-generic…).
 * Duas fontes de arte:
 *
 * 1. **Foto real recortada** — public/trophies/<id>.webp (720 px de altura, fundo transparente) e as
 *    variantes leves h160/ e h320/, listadas em ./photo-manifest.ts (regenere com
 *    `node src/ui/trophies/gen-photo-manifest.mjs`). Créditos/licenças em docs/CREDITOS.md.
 *    A foto nunca deixa o espaço vazio: o SVG (ou a silhueta) é desenhado por baixo até a foto
 *    carregar, e então as duas se cruzam em fade. `preloadTrophyArt()` aquece fotos e SVGs antes
 *    de uma revelação.
 * 2. **SVG** — ./svg/<id>.svg, carregado sob demanda (code-split). Os ids internos do SVG
 *    (gradientes, filtros) são prefixados por instância para que várias cópias na mesma página
 *    não se "roubem" as cores. Sem arte específica, cai numa arte genérica da família do troféu.
 *
 * `variant` (padrão `auto`): foto quando `size >= 40` e há recorte; abaixo disso (ícones de
 * tabela) fica o SVG, mais nítido. Se o id não tem SVG próprio, a foto é usada em qualquer
 * tamanho. `svg`/`photo` forçam uma das fontes (caindo na outra se ela não existir).
 */
import { useCallback, useEffect, useId, useState, type CSSProperties } from 'react'
import type { Trophy, TrophyFamily } from '@/engine/types'
import { TROPHIES } from '@/data/catalog/trophies'
import { TROPHY_PHOTO_ASPECT, TROPHY_PHOTO_IDS, TROPHY_PHOTO_VARIANTS } from './photo-manifest'

export type TrophyArtVariant = 'auto' | 'svg' | 'photo'

export interface TrophyArtProps {
  id: string
  /** Altura em px (a largura segue a proporção da arte). */
  size?: number
  /**
   * Metadados do catálogo para o fallback genérico. Se vier o Trophy inteiro (com `id`), um `id`
   * genérico (ex.: `cup-generic` de dados antigos) ainda mostra a arte própria do troféu.
   */
  trophy?: Pick<Trophy, 'family' | 'metal' | 'accent'> & { id?: string }
  className?: string
  style?: CSSProperties
  title?: string
  /** Fonte da arte: `auto` (padrão), `svg` ou `photo`. */
  variant?: TrophyArtVariant
}

/** Abaixo desta altura o modo `auto` prefere o SVG (ícones pequenos ficam mais nítidos). */
export const PHOTO_MIN_SIZE = 40

const photoIds = new Set(TROPHY_PHOTO_IDS)

/** Há recorte fotográfico real para este id? */
export function hasTrophyPhoto(id: string): boolean {
  return photoIds.has(id)
}

/**
 * URL pública do recorte (respeita o `base` do Vite). Com `height` (px de tela), escolhe a menor
 * variante que cobre `height × devicePixelRatio` (h160, h320 ou a original de 720 px).
 */
export function trophyPhotoUrl(id: string, height?: number): string {
  const base = `${import.meta.env.BASE_URL}trophies/`
  if (!height) return `${base}${id}.webp`
  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1
  const need = height * dpr
  const h = TROPHY_PHOTO_VARIANTS.find((v) => v >= need)
  return h ? `${base}h${h}/${id}.webp` : `${base}${id}.webp`
}

function wantsPhoto(id: string, size: number, variant: TrophyArtVariant): boolean {
  if (!hasTrophyPhoto(id)) return false
  if (variant === 'photo') return true
  if (variant === 'svg') return !hasTrophyArt(id)
  return size >= PHOTO_MIN_SIZE || !hasTrophyArt(id)
}

/** Sombra proporcional ao tamanho: assenta o metal no fundo escuro sem "halo". */
function photoShadow(size: number): string {
  const y = Math.max(1, Math.round(size * 0.035))
  const blur = Math.max(2, Math.round(size * 0.06))
  return `drop-shadow(0 ${y}px ${blur}px rgba(0,0,0,.5)) drop-shadow(0 1px 1px rgba(0,0,0,.35))`
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
  national_continental: ['cup-generic', 'estadual'],
  club_world_cup: ['cup-generic', 'estadual'],
  continental_primary: ['cup-generic', 'estadual'],
  continental_secondary: ['cup-generic', 'copa-do-brasil', 'estadual'],
  continental_tertiary: ['cup-generic', 'estadual'],
  league: ['league-generic', 'estadual'],
  domestic_cup: ['cup-generic', 'copa-do-brasil', 'estadual'],
  award: ['award-generic', 'golden-boot'],
}

const CATALOG: ReadonlyMap<string, Trophy> = new Map(TROPHIES.map((t) => [t.id, t]))

/** Sem família conhecida: uma taça neutra (não a taça de liga com tampa). */
const DEFAULT_FALLBACK = ['cup-generic', 'league-generic', 'estadual']

const hasOwnArt = (id: string) => hasTrophyArt(id) || hasTrophyPhoto(id)

/**
 * Chave de arte de um id: o próprio id se tem arquivo (SVG ou foto); senão a `art` do catálogo
 * (se tiver arquivo); senão o id do `trophy` passado junto (dados antigos com `art` genérica).
 */
export function trophyArtKey(id: string, trophy?: { id?: string }): string {
  if (hasOwnArt(id)) {
    // `id` genérico (cup-generic…) mas o troféu real tem arte própria → a do troféu.
    if (trophy?.id && trophy.id !== id && !CATALOG.has(id) && hasOwnArt(trophy.id)) return trophy.id
    return id
  }
  const art = CATALOG.get(id)?.art
  if (art && art !== id && hasOwnArt(art)) return art
  if (trophy?.id && trophy.id !== id && hasOwnArt(trophy.id)) return trophy.id
  return id
}

/** SVG a desenhar para uma chave: o próprio, ou o genérico da família (do prop ou do catálogo). */
export function trophySvgKey(key: string, family?: TrophyFamily): string | null {
  return resolveArt(key, family)
}

function resolveArt(key: string, family?: TrophyFamily): string | null {
  if (hasTrophyArt(key)) return key
  const fam = family ?? CATALOG.get(key)?.family
  for (const alt of (fam && FAMILY_FALLBACK[fam]) ?? DEFAULT_FALLBACK) {
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

/**
 * Fotos pré-carregadas. Os <img> ficam vivos aqui de propósito: assim o navegador mantém a imagem
 * decodificada na "lista de imagens disponíveis" do documento e um <img> novo com a mesma URL já
 * nasce `complete` (sem fade, sem espaço vazio).
 */
const preloaded = new Map<string, { img: HTMLImageElement; done: Promise<void> }>()

function preloadPhoto(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()
  let entry = preloaded.get(url)
  if (!entry) {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    const done = (img.decode ? img.decode() : new Promise<void>((ok, ko) => ((img.onload = () => ok()), (img.onerror = ko)))).catch(() => {
      preloaded.delete(url)
    })
    entry = { img, done }
    preloaded.set(url, entry)
  }
  return entry.done
}

/**
 * Aquece a arte de troféus que vai aparecer em seguida (celebração, revelação, aba nova): baixa a
 * variante de foto do tamanho pedido e o SVG (placeholder / ícone). Seguro chamar várias vezes.
 */
export function preloadTrophyArt(ids: readonly string[], size = 64): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const raw of ids) {
    if (!raw) continue
    const key = trophyArtKey(raw)
    const svg = resolveArt(key)
    if (svg) jobs.push(loadSvg(svg).catch(() => undefined))
    if (hasTrophyPhoto(key) && size >= PHOTO_MIN_SIZE) jobs.push(preloadPhoto(trophyPhotoUrl(key, size)))
  }
  return Promise.all(jobs).then(() => undefined)
}

let warmed = false
/** Uma vez por sessão, em tempo ocioso: variantes h160 de todas as fotos (~120 KB no total). */
function warmIdle() {
  if (warmed || typeof window === 'undefined') return
  warmed = true
  const run = () => {
    for (const id of TROPHY_PHOTO_IDS) void preloadPhoto(trophyPhotoUrl(id, 1))
  }
  const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}

export function TrophyArt({ id, size = 48, trophy, className, style, title, variant = 'auto' }: TrophyArtProps) {
  const key = trophyArtKey(id, trophy)
  const [photoFailed, setPhotoFailed] = useState<string | null>(null)
  const photo = wantsPhoto(key, size, variant)
  const photoUrl = photo ? (photoFailed === trophyPhotoUrl(key, size) ? trophyPhotoUrl(key) : trophyPhotoUrl(key, size)) : null
  const photoDead = photo && photoFailed === trophyPhotoUrl(key)
  // URL que ESTE <img> já mostrou; `instant` = já estava em cache ao montar (sem fade).
  const [shown, setShown] = useState<{ url: string; instant: boolean } | null>(null)
  const showPhoto = photo && !photoDead
  const photoReady = !!photoUrl && shown?.url === photoUrl
  const instant = photoReady && !!shown?.instant
  // SVG: a arte em si (sem foto) ou o placeholder por baixo da foto até ela carregar (e no fade).
  const art = !showPhoto || !instant ? resolveArt(key, trophy?.family) : null
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

  useEffect(() => {
    if (showPhoto) warmIdle()
  }, [showPhoto])

  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      // Já decodificada ao montar (cache / preloadTrophyArt): mostra direto, antes do 1º paint.
      if (el && photoUrl && el.complete && el.naturalWidth > 0) setShown((s) => (s?.url === photoUrl ? s : { url: photoUrl, instant: true }))
    },
    [photoUrl],
  )
  const onPhotoLoad = () => {
    if (photoUrl) setShown((s) => (s?.url === photoUrl ? s : { url: photoUrl, instant: false }))
  }

  const svgNode = (fill: boolean) =>
    art && raw && loaded.get(art) === raw ? (
      <span
        role={fill ? undefined : 'img'}
        aria-label={fill ? undefined : title}
        aria-hidden={fill ? true : undefined}
        className={fill ? undefined : className}
        style={fill ? { display: 'block', lineHeight: 0 } : { display: 'inline-block', lineHeight: 0, ...style }}
        dangerouslySetInnerHTML={{ __html: prepare(raw, prefix, size, title) }}
      />
    ) : (
      <FallbackTrophy size={size} className={fill ? undefined : className} style={fill ? undefined : style} title={fill ? undefined : title} metal={trophy?.metal} />
    )

  if (showPhoto && photoUrl) {
    const aspect = TROPHY_PHOTO_ASPECT[key]
    const fade = 'opacity .24s ease-out'
    return (
      <span className={className} style={{ display: 'inline-block', lineHeight: 0, ...style }}>
        <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0, verticalAlign: 'bottom' }}>
          {!instant ? (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 0,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                opacity: photoReady ? 0 : 1,
                transition: fade,
              }}
            >
              {svgNode(true)}
            </span>
          ) : null}
          <img
            ref={imgRef}
            src={photoUrl}
            alt={title ?? ''}
            aria-hidden={title ? undefined : true}
            height={size}
            width={aspect ? Math.round(size * aspect) : undefined}
            loading={size >= 120 ? 'eager' : 'lazy'}
            fetchPriority={size >= 160 ? 'high' : undefined}
            decoding="async"
            draggable={false}
            onLoad={onPhotoLoad}
            onError={() => setPhotoFailed(photoUrl)}
            style={{
              position: 'relative',
              display: 'block',
              height: size,
              width: 'auto',
              maxWidth: 'none',
              objectFit: 'contain',
              filter: photoShadow(size),
              userSelect: 'none',
              opacity: photoReady ? 1 : 0,
              transition: instant ? undefined : fade,
            }}
          />
        </span>
      </span>
    )
  }

  return svgNode(false)
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
