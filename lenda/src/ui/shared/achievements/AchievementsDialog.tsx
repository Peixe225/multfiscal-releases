/**
 * "Conquistas da carreira" (Copero `lp@15002`, improved): progress by rarity, filters
 * Todas/Concluídas/Pendentes, sort (recentes · antigas · A–Z · raridade), list/grid views,
 * pt-BR unlock dates, "NOVA" marks for unlocks not seen yet, secret achievements.
 * Contract: default export `AchievementsDialog({ open, onClose })` (lazy-loaded by the shell).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDownAZ, CalendarArrowDown, CalendarArrowUp, Gem, LayoutGrid, List, Lock } from 'lucide-react'
import type { Achievement } from '@/engine/types'
import { useCareer } from '@/store/career'
import { IconButton, MedalIcon, Modal, Segmented, Tooltip, cx, useReducedMotion } from '@/ui/primitives'
import { useAchievementCatalog } from '@/ui/shell/achievementsRegistry'
import { achievementIcon, formatUnlockDate, longDate, RARITY, type Rarity } from './meta'
import './unlockToasts'
import './achievements.css'

type Filter = 'all' | 'done' | 'todo'
type Sort = 'recent' | 'old' | 'az' | 'rarity'
type View = 'list' | 'grid'

const PREF = 'lenda:ach-view:v1'
const readPref = (): { filter: Filter; sort: Sort; view: View } => {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) ?? '{}')
    return {
      filter: ['all', 'done', 'todo'].includes(v.filter) ? v.filter : 'all',
      sort: ['recent', 'old', 'az', 'rarity'].includes(v.sort) ? v.sort : 'recent',
      view: v.view === 'grid' ? 'grid' : 'list',
    }
  } catch {
    return { filter: 'all', sort: 'recent', view: 'list' }
  }
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })
const RARITIES: Rarity[] = ['comum', 'rara', 'epica', 'lendaria']

function AchTile({ a, on, size = 48 }: { a: Achievement; on: boolean; size?: number }) {
  const Ico = achievementIcon(a)
  const r = RARITY[a.rarity] ?? RARITY.comum
  const secret = a.hidden && !on
  return (
    <span
      className={cx('ac-tile', on ? 'ac-tile--on' : 'ac-tile--off', a.rarity === 'lendaria' && on && 'ac-tile--holo')}
      style={{ width: size, height: size, ...(on ? { background: r.bg, color: r.ink, boxShadow: `0 10px 24px -12px ${r.glow}, inset 0 0 0 1px rgba(255,255,255,.4)` } : {}) }}
      aria-hidden="true"
    >
      {secret ? <Lock size={size * 0.36} strokeWidth={2.2} /> : <Ico size={size * 0.42} strokeWidth={on ? 2.2 : 1.8} />}
      {!on && !secret && (
        <span className="ac-tile__lock">
          <Lock size={10} strokeWidth={2.8} />
        </span>
      )}
    </span>
  )
}

export default function AchievementsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rm = useReducedMotion()
  const list = useAchievementCatalog((s) => s.list)
  const unlocked = useCareer((s) => s.achievements)
  const unseen = useCareer((s) => s.unseenAchievements)
  const markSeen = useCareer((s) => s.markAchievementsSeen)
  const [pref, setPref] = useState(readPref)
  const freshRef = useRef<Set<string>>(new Set())

  // remember what was new when the dialog opened, then clear the top-bar dot
  const booted = useCareer((s) => s.status === 'ready')
  useEffect(() => {
    if (!open || !booted) return
    freshRef.current = new Set(useCareer.getState().unseenAchievements)
    markSeen()
  }, [open, booted, markSeen])
  void unseen

  const update = (p: Partial<typeof pref>) => {
    const next = { ...pref, ...p }
    setPref(next)
    try {
      localStorage.setItem(PREF, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const done = list.filter((a) => unlocked[a.id]).length
  const pct = list.length ? done / list.length : 0
  const byRarity = RARITIES.map((r) => ({ r, total: list.filter((a) => a.rarity === r).length, done: list.filter((a) => a.rarity === r && unlocked[a.id]).length })).filter((x) => x.total)

  const items = useMemo(() => {
    let l = list.map((a) => ({ a, u: unlocked[a.id] }))
    if (pref.view === 'list') {
      if (pref.filter === 'done') l = l.filter((x) => x.u)
      else if (pref.filter === 'todo') l = l.filter((x) => !x.u)
    }
    const title = (x: (typeof l)[number]) => (x.a.hidden && !x.u ? '￿' : x.a.title)
    if (pref.view === 'grid' || pref.sort === 'az') l.sort((x, y) => collator.compare(title(x), title(y)))
    else if (pref.sort === 'rarity') l.sort((x, y) => (RARITY[y.a.rarity]?.order ?? 0) - (RARITY[x.a.rarity]?.order ?? 0) || Number(!!y.u) - Number(!!x.u) || collator.compare(title(x), title(y)))
    else
      l.sort((x, y) => {
        if (!!x.u !== !!y.u) return x.u ? -1 : 1
        if (x.u && y.u) {
          const d = x.u.unlockedAt.localeCompare(y.u.unlockedAt)
          if (d) return pref.sort === 'recent' ? -d : d
        }
        return collator.compare(title(x), title(y))
      })
    return l
  }, [list, unlocked, pref])

  const sortBtns: { v: Sort; label: string; icon: typeof List }[] = [
    { v: 'recent', label: 'Aquisição: recentes', icon: CalendarArrowDown },
    { v: 'old', label: 'Aquisição: antigas', icon: CalendarArrowUp },
    { v: 'az', label: 'Alfabeticamente', icon: ArrowDownAZ },
    { v: 'rarity', label: 'Por raridade', icon: Gem },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2.5">
          <MedalIcon size={20} aria-hidden className="text-glory" />
          Conquistas da carreira
        </span>
      }
      description={`${done} de ${list.length} desbloqueadas · salvas neste navegador`}
      bodyClassName="ac-body"
    >
      <div className="ac-summary">
        <div className="ac-progress" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done} aria-label="Progresso das conquistas">
          <i style={{ transform: `scaleX(${pct})` }} />
        </div>
        <div className="ac-rarities">
          {byRarity.map(({ r, total, done: d }) => (
            <span key={r} className="ac-rar">
              <span className="ac-rar__dot" style={{ background: RARITY[r].bg }} aria-hidden="true" />
              {RARITY[r].label}
              <b>
                {d}/{total}
              </b>
            </span>
          ))}
        </div>
      </div>

      <div className="ac-toolbar">
        {pref.view === 'list' ? (
          <Segmented<Filter>
            size="sm"
            value={pref.filter}
            onChange={(filter) => update({ filter })}
            aria-label="Filtrar conquistas"
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'done', label: `Concluídas · ${done}` },
              { value: 'todo', label: `Pendentes · ${list.length - done}` },
            ]}
          />
        ) : (
          <span className="text-[12px] text-text-3">Todas, em ordem alfabética</span>
        )}
        <span className="flex items-center gap-1 ml-auto">
          {pref.view === 'list' && (
            <span className="flex items-center gap-1" role="group" aria-label="Ordenar conquistas">
              {sortBtns.map((b) => (
                <Tooltip key={b.v} content={b.label}>
                  <IconButton size="sm" label={b.label} icon={b.icon} pressed={pref.sort === b.v} onClick={() => update({ sort: b.v })} />
                </Tooltip>
              ))}
              <span className="ac-sep" aria-hidden="true" />
            </span>
          )}
          <span className="flex items-center gap-1" role="group" aria-label="Visualização de conquistas">
            <Tooltip content="Visualização em lista">
              <IconButton size="sm" label="Visualização em lista" icon={List} pressed={pref.view === 'list'} onClick={() => update({ view: 'list' })} />
            </Tooltip>
            <Tooltip content="Visualização em grade">
              <IconButton size="sm" label="Visualização em grade" icon={LayoutGrid} pressed={pref.view === 'grid'} onClick={() => update({ view: 'grid' })} />
            </Tooltip>
          </span>
        </span>
      </div>

      {pref.view === 'grid' ? (
        <ul className="ac-grid" aria-label="Conquistas">
          {items.map(({ a, u }) => {
            const secret = a.hidden && !u
            const label = `${secret ? 'Conquista secreta' : a.title}${u ? ` — desbloqueada em ${longDate(u.unlockedAt)}` : ' — bloqueada'}`
            return (
              <li key={a.id}>
                <Tooltip tapToShow content={<span className="block max-w-[220px]"><b className="block">{secret ? 'Conquista secreta' : a.title}</b>{!secret && <span className="text-text-2">{a.description}</span>}</span>}>
                  <button type="button" className={cx('ac-cell', u && 'is-on')} aria-label={label}>
                    <AchTile a={a} on={!!u} size={56} />
                    {u && freshRef.current.has(a.id) && <span className="ac-new ac-new--dot" />}
                  </button>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      ) : items.length ? (
        <ul className="ac-list" aria-label="Conquistas">
          {items.map(({ a, u }, i) => {
            const secret = a.hidden && !u
            const r = RARITY[a.rarity] ?? RARITY.comum
            const fresh = !!u && freshRef.current.has(a.id)
            return (
              <motion.li
                key={a.id}
                className={cx('ac-item', u ? 'is-on' : 'is-off', fresh && 'is-fresh')}
                style={u ? { ['--ac-ring' as string]: r.ring, ['--ac-glow' as string]: r.glow } : undefined}
                initial={rm ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(0.3, i * 0.012) }}
              >
                <AchTile a={a} on={!!u} />
                <div className="min-w-0 flex-1">
                  <h3 className="ac-item__t">
                    {secret ? 'Conquista secreta' : a.title}
                  </h3>
                  <p className="ac-item__d">{secret ? 'Continue jogando para descobrir.' : a.description}</p>
                  <div className="ac-item__m">
                    {fresh && <span className="ac-new">Nova</span>}
                    <span className={cx('ac-rpill', `ac-rpill--${a.rarity}`)}>{r.label}</span>
                    {u?.context && <span className="truncate">{u.context}</span>}
                  </div>
                </div>
                {u && (
                  <time className="ac-date" dateTime={u.unlockedAt} title={longDate(u.unlockedAt)}>
                    {formatUnlockDate(u.unlockedAt)}
                  </time>
                )}
              </motion.li>
            )
          })}
        </ul>
      ) : (
        <div className="ac-empty" role="status">
          <MedalIcon size={26} aria-hidden className="mx-auto mb-2 opacity-60" />
          {pref.filter === 'done' ? 'Nenhuma conquista ainda. A primeira taça já conta!' : 'Você completou todas as conquistas. Lenda absoluta.'}
        </div>
      )}
    </Modal>
  )
}

export { AchievementsDialog }
