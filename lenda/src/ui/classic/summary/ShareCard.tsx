/**
 * Share card — 270 × 337.5 design box exported at 4× (1080 × 1350 PNG, 4:5) with html-to-image.
 *
 * The exported node is a hidden off-screen copy (the wrapper is translated away, the card itself
 * has no transform) so the preview can be scaled freely. Plain colours only (TIER_EXPORT) — no
 * backdrop-filter or theme-only effects, which do not survive the SVG foreignObject render.
 *
 * Actions: Compartilhar (navigator.share with the file) · Copiar imagem (ClipboardItem) · Baixar.
 * File: lenda-carreira-<sobrenome>.png
 */
import { forwardRef, memo, useCallback, useRef, useState, type CSSProperties } from 'react'
import { Copy, Download, Share2 } from 'lucide-react'
import { getClub } from '@/store/data'
import { BrandMark, Button, Crest, Flag, Switch, TIER_EXPORT, clubColors, cx, formatInt, formatMoney, gradeOf, tierOf, toast } from '@/ui/primitives'
import { Prize } from '@/ui/classic/tabs/parts'
import { slug } from './model'

export interface ShareModel {
  surname: string
  number: number
  position: string
  nationality: string
  peakOvr: number
  headline: string
  span: string
  seasons: number
  apps: number
  goals: number
  assists: number
  titles: number
  peakValue: number
  clubs: string[]
  trophies: { trophyId: string; count: number }[]
  mainClubId?: string
  retired: boolean
}

const W = 270
const H = 337.5

export const ShareCardView = memo(
  forwardRef<HTMLDivElement, { m: ShareModel; showName: boolean; className?: string; style?: CSSProperties }>(function ShareCardView({ m, showName, className, style }, ref) {
    const tier = tierOf(m.peakOvr)
    const grade = gradeOf(m.peakOvr)
    const ex = TIER_EXPORT[grade === 'icon' ? 'icon' : grade === 'elite' ? 'elite' : tier]
    const cc = clubColors(getClub(m.mainClubId))
    const n = m.clubs.length
    const v = Math.min(10, Math.max(1, n))
    const crest = Math.max(15, Math.min(34, Math.floor((236 - (v - 1) * 3) / v)))
    const groups = m.trophies.length
    const tsize = groups <= 4 ? 44 : groups <= 8 ? 34 : groups <= 12 ? 26 : 20
    const tcols = groups <= 4 ? Math.max(1, groups) : groups <= 8 ? 4 : groups <= 12 ? 6 : 8
    return (
      <div
        ref={ref}
        className={cx('sc', className)}
        style={{
          width: W,
          height: H,
          background: `radial-gradient(circle at 10% 4%, ${cc.primary}55 0%, transparent 42%), radial-gradient(circle at 96% 96%, rgba(255,200,90,.16) 0%, transparent 40%), linear-gradient(180deg, #11131a 0%, #0a0b10 100%)`,
          ...style,
        }}
      >
        <div className="sc__sheen" aria-hidden="true" />
        <div className="sc__top">
          <span className="sc__brand">
            <BrandMark size={14} /> LENDA
          </span>
          <span className="sc__span">
            {m.span} · {m.seasons} {m.seasons === 1 ? 'temporada' : 'temporadas'}
          </span>
        </div>
        <div className="sc__hero">
          <div className="sc__ovr" style={{ background: ex.bg, color: ex.ink }}>
            <span className="sc__ovr-l">PICO</span>
            <span className="sc__ovr-n">{m.peakOvr}</span>
          </div>
          <div className="sc__who">
            <div className="sc__name">{showName ? m.surname : 'JOGADOR'}</div>
            <div className="sc__head">{m.headline}</div>
            <div className="sc__chips">
              <span className="sc__chip">
                <Flag code={m.nationality} h={8} decorative /> {m.nationality}
              </span>
              <span className="sc__chip sc__chip--pos">
                #{m.number} {m.position}
              </span>
              <span className="sc__chip">{m.retired ? 'Fim de carreira' : 'Em atividade'}</span>
            </div>
          </div>
        </div>
        <div className="sc__kpis">
          {(
            [
              ['Jogos', m.apps],
              ['Gols', m.goals],
              ['Assist.', m.assists],
              ['Títulos', m.titles],
            ] as const
          ).map(([k, val]) => (
            <div key={k}>
              <b>{formatInt(val)}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
        <div className="sc__label">Trajetória</div>
        <div className="sc__crests" style={{ gap: 3 }}>
          {m.clubs.slice(0, 20).map((id, i) => (
            <Crest key={id + i} clubId={id} size={crest} decorative />
          ))}
        </div>
        <div className="sc__label">Títulos e prêmios</div>
        <div className="sc__trophies" style={{ gridTemplateColumns: `repeat(${tcols}, minmax(0, 1fr))` }}>
          {groups === 0 && <span className="sc__none">Vitrine vazia — a próxima carreira é sua.</span>}
          {m.trophies.slice(0, 16).map((t) => (
            <span key={t.trophyId} className="sc__t" style={{ height: tsize + 4 }}>
              <Prize id={t.trophyId} h={tsize} maxW={tsize * 1.1} />
              {t.count > 1 && <i className="sc__x">×{t.count}</i>}
            </span>
          ))}
        </div>
        <div className="sc__foot">
          <span>
            Jogue sua carreira em <b>LENDA</b>
          </span>
          <span>Valor máx. {formatMoney(m.peakValue)}</span>
        </div>
      </div>
    )
  }),
)

// ───────────────────────── export ─────────────────────────

let fontCss: string | null = null

async function renderBlob(node: HTMLElement): Promise<Blob> {
  const h2i = await import('html-to-image')
  if (document.fonts?.ready) await document.fonts.ready
  // images inside the card must be decoded before the snapshot
  await Promise.all(
    [...node.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r))))),
  )
  if (fontCss == null) {
    try {
      fontCss = await h2i.getFontEmbedCSS(node)
    } catch {
      fontCss = ''
    }
  }
  const opts = { pixelRatio: 4, width: W, height: H, canvasWidth: W, canvasHeight: H, fontEmbedCSS: fontCss || undefined, backgroundColor: '#07080c', cacheBust: false }
  // first pass warms image decoding in WebKit; the second one is the keeper
  await h2i.toBlob(node, opts).catch(() => null)
  const blob = await h2i.toBlob(node, opts)
  if (!blob) throw new Error('toBlob falhou')
  return blob
}

export function useShareImage(key: string) {
  const node = useRef<HTMLDivElement>(null)
  const cache = useRef<{ key: string; blob: Promise<Blob> } | null>(null)
  const get = useCallback(() => {
    if (!node.current) return Promise.reject(new Error('sem card'))
    if (cache.current?.key !== key) {
      const p = renderBlob(node.current)
      p.catch(() => {
        if (cache.current?.blob === p) cache.current = null
      })
      cache.current = { key, blob: p }
    }
    return cache.current.blob
  }, [key])
  return { node, get }
}

type Busy = 'share' | 'copy' | 'save' | null

export function ShareActions({ m, get, fileBase, size = 'md', layout = 'row' }: { m: ShareModel; get: () => Promise<Blob>; fileBase: string; size?: 'sm' | 'md'; layout?: 'row' | 'stack' }) {
  const [busy, setBusy] = useState<Busy>(null)
  const file = `lenda-carreira-${slug(fileBase || 'jogador')}.png`
  const run = async (b: Exclude<Busy, null>, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(b)
    try {
      await fn()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      console.warn('[LENDA] compartilhar', err)
      toast.error('Não foi possível preparar a imagem da sua carreira.', 'Tente de novo em alguns segundos.')
    } finally {
      setBusy(null)
    }
  }
  const save = () =>
    run('save', async () => {
      const blob = await get()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast.success('Imagem salva.', file)
    })
  const share = () =>
    run('share', async () => {
      const blob = await get()
      const f = new File([blob], file, { type: 'image/png' })
      const data: ShareData = { files: [f], title: 'Minha carreira no LENDA', text: `${m.surname}: ${m.headline}. Esta foi a minha carreira no LENDA. Como seria a sua?` }
      if (!navigator.share || !navigator.canShare?.(data)) {
        toast.info('Este navegador não permite compartilhar esta imagem como arquivo.', 'Baixe a imagem e compartilhe onde quiser.', { action: { label: 'Baixar', onClick: () => void save() } })
        return
      }
      await navigator.share(data)
    })
  const copy = () =>
    run('copy', async () => {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        toast.info('Este navegador não permite copiar imagens.', 'Use "Baixar" para salvar o card.')
        return
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': get() })])
      toast.success('Imagem copiada para a área de transferência.')
    })
  return (
    <div className={cx('sm-share__actions', layout === 'stack' && 'is-stack')}>
      <Button variant="primary" size={size} icon={Share2} loading={busy === 'share'} onClick={share}>
        Compartilhar
      </Button>
      <Button variant="ghost" size={size} icon={Copy} loading={busy === 'copy'} onClick={copy}>
        Copiar imagem
      </Button>
      <Button variant="ghost" size={size} icon={Download} loading={busy === 'save'} onClick={save}>
        Baixar
      </Button>
    </div>
  )
}

/** Preview (scaled) + hidden export copy + name switch + actions. */
export function SharePanel({ m, compact }: { m: ShareModel; compact?: boolean }) {
  const [showName, setShowName] = useState(true)
  const key = `${m.surname}:${m.peakOvr}:${m.seasons}:${m.titles}:${m.goals}:${showName}`
  const { node, get } = useShareImage(key)
  const scale = compact ? 1.12 : 1.3
  return (
    <div className="sm-share">
      <div className="sm-share__preview" style={{ width: W * scale, height: H * scale }}>
        <ShareCardView m={m} showName={showName} style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }} />
      </div>
      <div className="sm-share__side">
        <div>
          <div className="lx-eyebrow">Card da carreira · 1080 × 1350</div>
          <h3 className="sm-share__t">Mostre sua carreira pro mundo</h3>
          <p className="sm-share__d">Um card no formato do feed com seu pico de OVR, números, clubes e taças. Mande no grupo e desafie os amigos a fazer melhor.</p>
        </div>
        <Switch checked={showName} onChange={setShowName} label="Mostrar sobrenome" description={showName ? `Aparece “${m.surname}” no card` : 'O card mostra “JOGADOR”'} />
        <ShareActions m={m} get={get} fileBase={showName ? m.surname : 'jogador'} layout={compact ? 'stack' : 'row'} />
      </div>
      <div className="sm-share__offscreen" aria-hidden="true">
        <ShareCardView ref={node} m={m} showName={showName} />
      </div>
    </div>
  )
}
