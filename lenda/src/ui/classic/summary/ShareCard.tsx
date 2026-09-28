/**
 * Share card — 270 × 337.5 design box exported at 4× (1080 × 1350 PNG, 4:5) with html-to-image.
 *
 * The exported node is a hidden off-screen copy (the wrapper is translated away, the card itself
 * has no transform) so the preview can be scaled freely. Plain colours only (TIER_EXPORT) — no
 * backdrop-filter or theme-only effects, which do not survive the SVG foreignObject render.
 *
 * Actions: Compartilhar (navigator.share with the file) · Copiar imagem (ClipboardItem) · Baixar ·
 * Ver imagem (the PNG large in a dialog, to save with long-press / right-click). Inside an iframe
 * (e.g. an artifact on claude.ai) downloads, Web Share and the clipboard are usually blocked by the
 * sandbox, so "Baixar" opens the viewer there and any share/copy failure falls back to it.
 * File: lenda-carreira-<sobrenome>.png
 */
import { forwardRef, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Copy, Download, Expand, Share2 } from 'lucide-react'
import { getClub } from '@/store/data'
import { BrandMark, Button, Crest, Flag, Modal, Switch, TIER_EXPORT, clubColors, cx, formatInt, formatMoney, gradeOf, tierOf, toast } from '@/ui/primitives'
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

type Busy = 'share' | 'copy' | 'save' | 'view' | null

/** Inside an iframe (claude.ai artifact, embeds): downloads / Web Share / clipboard are usually sandboxed. */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('FileReader'))
    r.readAsDataURL(blob)
  })
}

/** Errors that mean "blocked here" (permissions policy / sandbox), not "user cancelled". */
const isBlocked = (err: unknown) => {
  const n = (err as DOMException)?.name
  return n === 'NotAllowedError' || n === 'SecurityError' || n === 'TypeError' || n === 'DataError'
}

/** The PNG, large: long-press (phone) or right-click (desktop) → "Salvar imagem". */
function ShareImageDialog({ url, file, alt, reason, onClose }: { url: string | null; file: string; alt: string; reason?: string; onClose: () => void }) {
  return (
    <Modal
      open={!!url}
      onClose={onClose}
      size="lg"
      title="Sua imagem"
      description={
        <>
          {reason ? `${reason} ` : ''}
          <b className="text-text">Toque e segure</b> a imagem (celular) ou clique com o <b className="text-text">botão direito</b> (computador) e escolha “Salvar imagem”.
        </>
      }
      bodyClassName="sm-view__body"
      footer={
        <div className="flex gap-2 justify-end flex-wrap w-full">
          {url && (
            <a className="lx-btn lx-btn--ghost lx-btn--md" href={url} download={file}>
              <Download aria-hidden size={16} />
              Tentar baixar
            </a>
          )}
          <Button variant="primary" size="md" onClick={onClose}>
            Pronto
          </Button>
        </div>
      }
    >
      {url && <img className="sm-view__img" src={url} alt={alt} width={1080} height={1350} />}
    </Modal>
  )
}

export function ShareActions({
  m,
  get,
  fileBase,
  size = 'md',
  layout = 'row',
  viewRef,
}: {
  m: ShareModel
  get: () => Promise<Blob>
  fileBase: string
  size?: 'sm' | 'md'
  layout?: 'row' | 'stack'
  /** Receives the "Ver imagem" opener (e.g. for a click on the preview). */
  viewRef?: { current: (() => void) | null }
}) {
  const [busy, setBusy] = useState<Busy>(null)
  const [view, setView] = useState<{ url: string; reason?: string } | null>(null)
  const file = `lenda-carreira-${slug(fileBase || 'jogador')}.png`
  const embedded = isEmbedded()
  const openView = async (reason?: string) => setView({ url: await toDataUrl(await get()), reason })
  const run = async (b: Exclude<Busy, null>, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(b)
    try {
      await fn()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      // blocked here (sandbox / permissions policy): show the PNG to save by hand instead of failing
      if (b !== 'view' && isBlocked(err)) {
        try {
          await openView('Este navegador não deixou concluir a ação aqui.')
          return
        } catch {
          /* fall through */
        }
      }
      toast.error('Não foi possível preparar a imagem da sua carreira.', 'Tente de novo em alguns segundos.')
    } finally {
      setBusy(null)
    }
  }
  const viewNow = () => run('view', () => openView())
  if (viewRef) viewRef.current = viewNow
  const save = () =>
    run('save', async () => {
      // an iframe sandbox drops a.download silently: show the image instead
      if (embedded) return openView('Aqui o download direto pode estar bloqueado.')
      const blob = await get()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast.success('Imagem salva.', file, { action: { label: 'Ver imagem', icon: Expand, onClick: () => void viewNow() } })
    })
  const share = () =>
    run('share', async () => {
      const blob = await get()
      const f = new File([blob], file, { type: 'image/png' })
      const data: ShareData = { files: [f], title: 'Minha carreira no LENDA', text: `${m.surname}: ${m.headline}. Esta foi a minha carreira no LENDA. Como seria a sua?` }
      if (!navigator.share || !navigator.canShare?.(data)) return openView('Este navegador não compartilha imagens como arquivo.')
      await navigator.share(data)
    })
  const copy = () =>
    run('copy', async () => {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return openView('Este navegador não copia imagens.')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': get() })])
      toast.success('Imagem copiada para a área de transferência.')
    })
  return (
    <>
      <div className={cx('sm-share__actions', layout === 'stack' && 'is-stack')}>
        <Button variant="primary" size={size} icon={Share2} loading={busy === 'share'} onClick={share} className="sm-share__primary">
          Compartilhar
        </Button>
        <Button variant="ghost" size={size} icon={Expand} loading={busy === 'view'} onClick={viewNow}>
          Ver imagem
        </Button>
        <Button variant="ghost" size={size} icon={Download} loading={busy === 'save'} onClick={save}>
          Baixar
        </Button>
        <Button variant="ghost" size={size} icon={Copy} loading={busy === 'copy'} onClick={copy} className="sm-share__copy">
          Copiar imagem
        </Button>
      </div>
      <ShareImageDialog url={view?.url ?? null} reason={view?.reason} file={file} alt={`Card da carreira de ${fileBase || 'jogador'} no LENDA`} onClose={() => setView(null)} />
    </>
  )
}

/** Preview (scaled) + hidden export copy + name switch + actions. */
export function SharePanel({ m, compact }: { m: ShareModel; compact?: boolean }) {
  const [showName, setShowName] = useState(true)
  const key = `${m.surname}:${m.peakOvr}:${m.seasons}:${m.titles}:${m.goals}:${showName}`
  const { node, get } = useShareImage(key)
  const view = useRef<(() => void) | null>(null)
  const preview = useRef<HTMLButtonElement>(null)
  const scale = compact ? 1.12 : 1.3
  // render the PNG as soon as the panel shows up: "Compartilhar" then runs inside the click's
  // user activation (Safari/Chrome drop navigator.share after a slow await)
  useEffect(() => {
    const el = preview.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let t = 0
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return
      io.disconnect()
      t = window.setTimeout(() => void get().catch(() => {}), 400)
    })
    io.observe(el)
    return () => (io.disconnect(), window.clearTimeout(t))
  }, [get])
  return (
    <div className="sm-share">
      <button ref={preview} type="button" className="sm-share__preview" style={{ width: W * scale, height: H * scale }} onClick={() => view.current?.()} aria-label="Ver a imagem do card em tamanho grande" title="Ver imagem">
        <ShareCardView m={m} showName={showName} style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }} />
        <span className="sm-share__zoom" aria-hidden="true">
          <Expand size={14} />
        </span>
      </button>
      <div className="sm-share__side">
        <div>
          <div className="lx-eyebrow">Card da carreira · 1080 × 1350</div>
          <h3 className="sm-share__t">Mostre sua carreira pro mundo</h3>
          <p className="sm-share__d">Um card no formato do feed com seu pico de OVR, números, clubes e taças. Mande no grupo e desafie os amigos a fazer melhor.</p>
        </div>
        <Switch checked={showName} onChange={setShowName} label="Mostrar sobrenome" description={showName ? `Aparece “${m.surname}” no card` : 'O card mostra “JOGADOR”'} />
        <ShareActions m={m} get={get} fileBase={showName ? m.surname : 'jogador'} layout={compact ? 'stack' : 'row'} viewRef={view} />
      </div>
      <div className="sm-share__offscreen" aria-hidden="true">
        <ShareCardView ref={node} m={m} showName={showName} />
      </div>
    </div>
  )
}
