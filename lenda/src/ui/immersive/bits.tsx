/**
 * Peças pequenas do Modo Imersivo (grafismo "Transmissão").
 */
import { memo, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { Globe2, type LucideProps } from 'lucide-react'

type LucideIcon = ComponentType<LucideProps>
import { Crest, Flag, cx, tierOf, useCountUp } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { compInfo, fmtRating, levelOf, ratingTone, teamInfo, type TeamInfo } from './model/view'

/** Escudo do clube ou bandeira da seleção. */
export const TeamMark = memo(function TeamMark({ id, size = 28, team, className }: { id?: string | null; size?: number; team?: TeamInfo; className?: string }) {
  const t = team ?? teamInfo(id)
  if (t.national && t.country) return <Flag code={t.country.code} iso2={t.country.iso2} h={Math.round(size * 0.7)} w={Math.round(size * 0.95)} radius={3} decorative className={className} />
  return <Crest club={t.club ?? { id: t.id, name: t.name, abbr: t.abbr }} size={size} decorative className={className} />
})

/** Logo da competição (liga/copa) com fallback para a taça. */
export function CompLogo({ id, size = 22, className }: { id?: string | null; size?: number; className?: string }) {
  const c = compInfo(id)
  if (c.logo) return <img src={c.logo} alt="" width={size} height={size} className={cx('im-complogo', className)} style={{ width: size, height: size }} loading="lazy" decoding="async" />
  if (c.trophyId) return <TrophyArt id={c.trophyId} size={size} variant="svg" className={className} />
  // amistoso de seleções: sem escudo de competição → globo (nada de caixa vazia)
  if (id === 'friendly') return <Globe2 size={Math.round(size * 0.8)} className={cx('im-complogo is-icon', className)} aria-hidden="true" />
  return <span className={cx('im-complogo is-empty', className)} style={{ width: size, height: size }} aria-hidden="true" />
}

/** Cabeçalho de placa: kicker + título opcional + ação à direita. */
export function PanelHead({ kicker, title, icon: Ico, right, gold, className }: { kicker: ReactNode; title?: ReactNode; icon?: LucideIcon; right?: ReactNode; gold?: boolean; className?: string }) {
  return (
    <div className={cx('im-phead', className)}>
      <div className="min-w-0">
        <span className={cx('lx-kicker', gold && 'lx-kicker--gold')}>
          {Ico && <Ico size={13} aria-hidden="true" className="-ml-1" />}
          {kicker}
        </span>
        {title && <h2 className="im-phead__t">{title}</h2>}
      </div>
      {right && <div className="im-phead__r">{right}</div>}
    </div>
  )
}

/** Medidor segmentado com rótulo e valor. */
export function Meter({ label, value, icon: Ico, seg = true, hint, level, className }: { label: string; value: number; icon?: LucideIcon; seg?: boolean; hint?: string; level?: 'good' | 'warn' | 'crit'; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cx('im-meter', className)} title={hint}>
      <div className="im-meter__top">
        <span className="lx-label">
          {Ico && <Ico size={13} aria-hidden="true" />}
          {label}
        </span>
        <b className="im-meter__v num">{v}</b>
      </div>
      <div className={cx('lx-meter', seg && 'lx-meter--seg')} data-level={level ?? levelOf(v)} style={{ ['--lx-v' as string]: v / 100 }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} />
    </div>
  )
}

/** Chips V/E/D. */
export function FormChips({ form, className }: { form: ('V' | 'E' | 'D')[]; className?: string }) {
  if (!form.length) return <span className={cx('lx-t-small', className)}>Sem jogos</span>
  return (
    <span className={cx('im-form', className)} aria-label={`Últimos jogos: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span key={i} className="lx-form" data-r={r}>
          {r}
        </span>
      ))}
    </span>
  )
}

/** Nota (paralelogramo colorido por faixa). */
export function RatingBadge({ rating, size = 'md', className, live }: { rating: number; size?: 'sm' | 'md' | 'lg'; className?: string; live?: boolean }) {
  return (
    <span className={cx('im-rating', `is-${size}`, className)} data-tone={ratingTone(rating)} aria-label={`Nota ${fmtRating(rating)}${live ? ' ao vivo' : ''}`}>
      {fmtRating(rating)}
    </span>
  )
}

/** Lower-third de TV. */
export function LowerThird({ k, v, icon: Ico, tone, className, style, children }: { k: ReactNode; v: ReactNode; icon?: LucideIcon; tone?: 'accent' | 'club' | 'live' | 'red' | 'yellow'; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cx('lx-lt', tone && `lx-lt--${tone}`, className)} style={style}>
      <span className="lx-lt__a">{Ico ? <Ico aria-hidden="true" /> : children}</span>
      <span className="lx-lt__b">
        <span className="lx-lt__k">{k}</span>
        <span className="lx-lt__v">{v}</span>
      </span>
    </div>
  )
}

/** KPI grande (JOGOS 313). */
export function Kpi({ label, value, icon: Ico, gold, sub, className }: { label: string; value: ReactNode; icon?: LucideIcon; gold?: boolean; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('im-kpi', className)}>
      <span className="lx-label">
        {Ico && <Ico size={12} aria-hidden="true" />}
        {label}
      </span>
      <b className={cx('im-kpi__v', gold && 'lx-hi')}>
        {value}
        {sub && <small>{sub}</small>}
      </b>
    </div>
  )
}

/** Barra dividida casa × visitante (posse, finalizações). */
export function SplitStat({ label, home, away, homeColor, awayColor, pct }: { label: string; home: number; away: number; homeColor: string; awayColor: string; pct?: boolean }) {
  const total = home + away || 1
  return (
    <div className="im-split">
      <div className="im-split__row">
        <b className="num">{home}{pct ? '%' : ''}</b>
        <span className="lx-label">{label}</span>
        <b className="num">{away}{pct ? '%' : ''}</b>
      </div>
      <div className="im-split__bar" aria-hidden="true">
        {home + away > 0 ? (
          <>
            <i style={{ width: `${(home / total) * 100}%`, background: homeColor }} />
            <i style={{ width: `${(away / total) * 100}%`, background: awayColor }} />
          </>
        ) : (
          <i className="is-empty" />
        )}
      </div>
    </div>
  )
}

/** Barra de atributo com valor. */
export function AttrBar({ label, short, value, flash, className }: { label: string; short: string; value: number; flash?: number; className?: string }) {
  return (
    <div className={cx('im-attr', flash && 'is-up', className)} title={label}>
      <span className="im-attr__k">{short}</span>
      <span className="lx-attr-bar" style={{ ['--lx-v' as string]: value / 99 }} aria-hidden="true">
        <i />
      </span>
      <b className={cx('im-attr__v num', value >= 80 && 'lx-hi')}>{value}</b>
      {flash ? <span className="im-attr__up">+{flash}</span> : null}
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  )
}

/** Badge de OVR no desenho da Transmissão (.lx-ovr[data-tier] + __label/__num). */
export function ImOvr({ ovr, w = 116, label = true, from, countUp, className }: { ovr: number; w?: number; label?: boolean; from?: number; countUp?: { duration?: number; delay?: number }; className?: string }) {
  const shown = useCountUp(ovr, { from: countUp ? from : ovr, duration: countUp ? countUp.duration ?? 1200 : 0, delay: countUp?.delay })
  const h = Math.round(w * 1.086)
  return (
    <div className={cx('lx-ovr im-ovr', className)} data-tier={tierOf(shown)} style={{ width: w, height: h, ['--lx-c' as string]: `${Math.round(w * 0.155)}px` }} role="img" aria-label={`OVR ${ovr}`}>
      {label && (
        <span className="lx-ovr__label" style={{ fontSize: Math.max(8, Math.round(w * 0.11)) }} aria-hidden="true">
          OVR
        </span>
      )}
      <span className="lx-ovr__num" style={{ fontSize: Math.round(w * (label ? 0.6 : 0.64)) }} aria-hidden="true">
        {shown}
      </span>
    </div>
  )
}

/** OVR pequeno (linha de tabela, barra superior). */
export function ImOvrS({ ovr, className, title }: { ovr: number; className?: string; title?: string }) {
  return (
    <span className={cx('lx-ovr-s', className)} data-tier={tierOf(ovr)} title={title ?? `OVR ${ovr}`}>
      {ovr}
    </span>
  )
}

/** Segmentado compacto (radiogroup) no desenho .lx-seg — alvos de toque ≥ 40 px no tamanho "touch". */
export function ImSeg<T extends string>({ value, onChange, options, label, size = 'sm', className, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: LucideIcon; hint?: string; disabled?: boolean }[]; label: string; size?: 'xs' | 'sm' | 'touch'; className?: string; disabled?: boolean }) {
  const move = (dir: number) => {
    const list = options.filter((o) => !o.disabled)
    const i = list.findIndex((o) => o.value === value)
    const n = list[(i + dir + list.length) % list.length]
    if (n) onChange(n.value)
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('lx-seg im-seg', `is-${size}`, className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1))
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1))
      }}
    >
      {options.map((o) => {
        const on = o.value === value
        const Ico = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled || o.disabled}
            title={o.hint}
            aria-label={typeof o.label === 'string' ? undefined : o.hint}
            onClick={() => onChange(o.value)}
            onPointerUp={(e) => e.currentTarget.blur()}
          >
            {Ico && <Ico size={14} aria-hidden="true" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Título de diálogo no sistema da Transmissão: kicker + título 800 itálico em caixa-alta. */
export function ImDlgTitle({ kicker, children }: { kicker?: ReactNode; children: ReactNode }) {
  return (
    <span className="im-dlgt">
      {kicker && <span className="lx-kicker im-dlgt__k">{kicker}</span>}
      <span className="lx-t-sec im-dlgt__t">{children}</span>
    </span>
  )
}
