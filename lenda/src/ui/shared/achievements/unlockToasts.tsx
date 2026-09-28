/**
 * Achievement unlock toast (Copero `pp@15423`, improved): fires once per batch of new unlocks,
 * waits for the post-decision reveal to be dismissed (max 6 s) so it never covers the animation,
 * shows up to 4 overlapped medals, and "Ver conquistas" opens the dialog 250 ms later.
 *
 * Side-effect module: importing it installs the store subscription once.
 *   import '@/ui/shared/achievements/unlockToasts'
 */
import { useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { toast } from '@/ui/primitives'
import { achievementById } from '@/ui/shell/achievementsRegistry'
import { MedalIcon } from '@/ui/primitives'
import { achievementIcon, RARITY } from './meta'

const MAX_ICONS = 4
let installed = false
const shown = new Set<string>()

function stack(ids: string[]) {
  const list = ids.map((id) => achievementById(id)).filter((a): a is NonNullable<typeof a> => !!a)
  return (
    <span className="inline-flex items-center mt-1.5" aria-hidden="true">
      {list.slice(0, MAX_ICONS).map((a, i) => {
        const Ico = achievementIcon(a)
        const r = RARITY[a.rarity] ?? RARITY.comum
        return (
          <span
            key={a.id}
            className="grid place-items-center w-8 h-8 rounded-[9px] border-2 border-[var(--bg-2,#0b0c10)]"
            style={{ background: r.bg, color: r.ink, marginLeft: i ? -10 : 0, zIndex: MAX_ICONS - i, boxShadow: `0 6px 14px -6px ${r.glow}` }}
          >
            <Ico size={15} strokeWidth={2.2} />
          </span>
        )
      })}
      {list.length > MAX_ICONS && <span className="ml-2 text-[11px] font-bold text-text-3">+{list.length - MAX_ICONS}</span>}
    </span>
  )
}

export function showUnlockToast(ids: string[]) {
  const fresh = [...new Set(ids)].filter((id) => !shown.has(id))
  if (!fresh.length) return
  fresh.forEach((id) => shown.add(id))
  const sorted = fresh
    .map((id) => achievementById(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  if (!sorted.length) return
  const one = sorted.length === 1
  toast({
    tone: 'gold',
    icon: one ? achievementIcon(sorted[0]) : MedalIcon,
    title: one ? 'Conquista desbloqueada!' : `Você desbloqueou ${sorted.length} conquistas`,
    description: (
      <>
        {one ? <span className="block truncate">{sorted[0].title}</span> : <span className="block truncate">{sorted.map((a) => a.title).join(' · ')}</span>}
        {!one && stack(sorted.map((a) => a.id))}
      </>
    ),
    duration: 5600,
    action: {
      label: 'Ver conquistas',
      onClick: () => window.setTimeout(() => useApp.getState().openDialog('achievements'), 250),
    },
  })
}

export function installAchievementToasts() {
  if (installed || typeof window === 'undefined') return
  installed = true
  let pending: string[] = []
  let timer = 0
  const flush = () => {
    window.clearTimeout(timer)
    timer = 0
    const ids = pending
    pending = []
    if (ids.length) showUnlockToast(ids)
  }
  useCareer.subscribe((s, prev) => {
    if (s.lastUnlocked !== prev.lastUnlocked && s.lastUnlocked.length && !s.isFixture) {
      pending.push(...s.lastUnlocked)
      window.clearTimeout(timer)
      // wait for the reveal to be acknowledged (or 6 s at most)
      timer = window.setTimeout(flush, s.reveal ? 6000 : 400)
    }
    if (pending.length && prev.reveal && !s.reveal) {
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, 500)
    }
  })
}

installAchievementToasts()
