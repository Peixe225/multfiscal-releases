/**
 * PLACEHOLDER (foundation) — the achievements team replaces this file.
 * Contract: default export `AchievementsDialog({ open, onClose })`, lazy-loaded by the shell when
 * the top-bar medal is pressed. Unlock state: useCareer((s) => s.achievements); catalogue:
 * useAchievementCatalog (register the real one with registerAchievementCatalog()).
 */
import { useEffect } from 'react'
import { Lock, Medal } from 'lucide-react'
import { useCareer } from '@/store/career'
import { cx, Modal } from '@/ui/primitives'
import { useAchievementCatalog } from '@/ui/shell/achievementsRegistry'

export default function AchievementsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useAchievementCatalog((s) => s.list)
  const unlocked = useCareer((s) => s.achievements)
  const markSeen = useCareer((s) => s.markAchievementsSeen)
  useEffect(() => {
    if (open) markSeen()
  }, [open, markSeen])
  const n = list.filter((a) => unlocked[a.id]).length
  return (
    <Modal open={open} onClose={onClose} title="Conquistas" description={`${n} de ${list.length} desbloqueadas`} size="lg">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 m-0 p-0 list-none">
        {list.map((a) => {
          const on = !!unlocked[a.id]
          return (
            <li key={a.id} className={cx('flex items-center gap-3 rounded-md p-3 border', on ? 'bg-surface-2 border-border-strong' : 'bg-surface border-border opacity-70')}>
              <span className={cx('grid place-items-center w-10 h-10 rounded-[12px] flex-none', on ? 'text-[#231600]' : 'bg-surface-2 text-text-3')} style={on ? { background: 'linear-gradient(180deg,#ffe7a3,#e7b54a)' } : undefined}>
                {on ? <Medal size={18} aria-hidden /> : <Lock size={16} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-bold">{a.hidden && !on ? 'Conquista secreta' : a.title}</span>
                <span className="block text-[12px] text-text-3">{a.hidden && !on ? '???' : a.description}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
