/**
 * Peças da live: ícone de presente, relógio, cores das opções, linha "como votar".
 */
import { useEffect, useState } from 'react'
import { LIVE_SANDBOXED, useLiveConfig } from '@/live/config'
import { giftEmoji, giftLabel, sameGift } from '@/live/gifts'
import { useLive } from '@/live/store'
import { cx } from '@/ui/primitives'

/** Cor de cada opção (1 a 4) — a mesma no palco, na faixa e nos cards. */
export const OPTION_COLORS = ['#ff4d6d', '#2fd3ff', '#a98bff', '#ffc857']

export function GiftIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const catalog = useLive((s) => s.catalog)
  const g = name ? catalog.find((x) => sameGift(x, name)) : undefined
  const [broken, setBroken] = useState(false)
  if (!name) return null
  if (g?.image && !broken && !LIVE_SANDBOXED)
    return <img className={cx('lv-gift-img', className)} src={g.image} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return (
    <span className={cx('lv-gift-emoji', className)} style={{ fontSize: Math.round(size * 0.92), width: size, height: size }} aria-hidden="true">
      {giftEmoji(name)}
    </span>
  )
}

/** Re-render a cada `ms` enquanto `active`. */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

/** Anel do relógio da votação. */
export function Countdown({ endsAt, total, size = 46, paused }: { endsAt: number; total: number; size?: number; paused?: boolean }) {
  const now = useNow(true, 200)
  const left = Math.max(0, endsAt - now)
  const secs = Math.ceil(left / 1000)
  const frac = total > 0 ? Math.min(1, left / total) : 0
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  return (
    <span className={cx('lv-clock', secs <= 5 && !paused && 'is-hot', paused && 'is-paused')} style={{ width: size, height: size }} role="timer" aria-label={paused ? 'Votação pausada' : `${secs} segundos para o fim da votação`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="lv-clock__track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="lv-clock__bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <b>{paused ? 'II' : secs}</b>
    </span>
  )
}

/** "Comente 1, 2 ou 3 · 🌹 Rosa = 1 · 🎵 TikTok = 2…" */
export function howToVote(n: number): string {
  const cfg = useLiveConfig.getState().config
  const nums = Array.from({ length: n }, (_, i) => String(i + 1))
  const list = nums.length > 1 ? `${nums.slice(0, -1).join(', ')} ou ${nums[nums.length - 1]}` : nums[0]
  const gifts = cfg.giftBindings
    .slice(0, n)
    .map((g, i) => (g ? `${giftEmoji(g)} ${giftLabel(g)} = ${i + 1}` : ''))
    .filter(Boolean)
    .join(' · ')
  const parts = [cfg.commentVotes ? `Comente ${list} para votar` : `Mande o presente da opção`]
  if (gifts) parts.push(gifts)
  if (cfg.pointsPerCoin > 0) parts.push(`cada moeda vale ${cfg.pointsPerCoin} voto${cfg.pointsPerCoin === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export const fmtCoins = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)} mil` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n))
