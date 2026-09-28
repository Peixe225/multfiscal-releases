/**
 * Persistent top bar: brand mark + sub-label · context slot · right cluster
 * (sound, achievements with dot/count, menu). Career routes get the session pill + progress.
 */
import { memo } from 'react'
import { Menu, Save, Volume2, VolumeX } from 'lucide-react'
import { useApp, type RoutePath } from '@/store/app'
import { decisionProgress, useCareer } from '@/store/career'
import { Brand, IconButton, MedalIcon, cx, toast, NewBadge } from '@/ui/primitives'
import { formatSeason } from '@/ui/primitives/format'
import { getLeague } from '@/store/data'
import { useSlotStore } from './slots'
import { useAchievementCatalog } from './achievementsRegistry'

const SUB: Partial<Record<RoutePath, string>> = {
  '/': 'SIMULADOR DE CARREIRA',
  '/identidade': 'NOVA CARREIRA',
  '/carreira': 'CLÁSSICO',
  '/resumo': 'RESUMO',
  '/ligas': 'LIGAS AO VIVO',
  '/hall': 'HALL DA FAMA',
  '/imersivo': 'IMERSIVO',
  '/kit': 'DESIGN KIT',
  '/creditos': 'CRÉDITOS',
}

const PACE_LABEL = { intensa: 'Ritmo Intenso', normal: 'Ritmo Normal', expressa: 'Ritmo Expresso' } as const

/** "Temporada 2035 · Ritmo Normal" */
export function SessionPill({ className }: { className?: string }) {
  const s = useCareer((x) => x.state)
  if (!s) return null
  // the last season played (the pending decision belongs to it), like the mockup "Temporada 2035"
  const last = s.seasons[s.seasons.length - 1]
  const lg = getLeague(last?.leagueId ?? null)
  return (
    <div className={cx('lx-session', className)}>
      <b className="tabular-nums">Temporada {formatSeason(last?.season ?? s.season, lg?.calendar)}</b>
      <span className="lx-session__dot" aria-hidden="true" />
      {PACE_LABEL[s.pace]}
    </div>
  )
}

/** "Carreira ▬▬▬▬▭▭ 10/24" */
export function CareerProgress({ className }: { className?: string }) {
  const s = useCareer((x) => x.state)
  if (!s) return null
  const p = decisionProgress(s)
  const pct = Math.min(100, (p.seasonsDone / p.seasonsTotal) * 100)
  return (
    <div className={cx('lx-session', className)} role="group" aria-label={`Carreira: ${p.seasonsDone} de ${p.seasonsTotal} temporadas`}>
      Carreira
      <span className="lx-bar lx-bar--club" style={{ width: 120, ['--v' as string]: `${pct}%`, ['--from' as string]: 'var(--club-hi, #36d884)', ['--to' as string]: '#d7ffe9' }} aria-hidden="true" />
      <b className="num text-[14px]">
        {p.seasonsDone}/{p.seasonsTotal}
      </b>
    </div>
  )
}

function DefaultCenter({ path }: { path: RoutePath }) {
  const has = useCareer((x) => !!x.state)
  if (path === '/carreira' && has)
    return (
      <>
        <SessionPill />
        <CareerProgress className="max-lg:hidden" />
      </>
    )
  if (path === '/') return <TopNav />
  return null
}

/** Landing nav (Modo Clássico · Modo Imersivo NOVO · Ligas ao vivo · Hall da Fama). */
export function TopNav() {
  const links: [string, string, boolean?][] = [
    ['Modo Clássico', '#/identidade'],
    ['Modo Imersivo', '#/imersivo', true],
    ['Ligas ao vivo', '#/ligas'],
    ['Hall da Fama', '#/hall'],
  ]
  return (
    <nav aria-label="Principal" className="flex items-center gap-1 ml-5 max-lg:hidden">
      {links.map(([label, href, isNew]) => (
        <a key={href} href={href} className="h-[34px] px-3 inline-flex items-center gap-[7px] rounded-sm text-[13.5px] font-semibold text-text-2 no-underline transition-colors hover:text-text hover:bg-surface">
          {label}
          {isNew && <NewBadge />}
        </a>
      ))}
    </nav>
  )
}

function RightCluster({ path }: { path: RoutePath }) {
  const sound = useApp((s) => s.settings.sound)
  const toggle = useApp((s) => s.toggleSetting)
  const open = useApp((s) => s.openDialog)
  const unseen = useCareer((s) => s.unseenAchievements.length)
  const unlocked = useCareer((s) => Object.keys(s.achievements).length)
  const total = useAchievementCatalog((s) => s.list.length)
  const hasCareer = useCareer((s) => !!s.state && !s.isFixture)
  const saving = useCareer((s) => s.saving)
  const saveNow = useCareer((s) => s.saveNow)
  return (
    <>
      {path === '/carreira' && hasCareer && (
        <IconButton
          label={saving ? 'Salvando…' : 'Salvar carreira'}
          icon={Save}
          className="max-sm:hidden"
          onClick={async () => {
            const ok = await saveNow()
            if (ok) toast.success('Carreira salva', 'Continue de onde parou quando quiser.')
            else toast.error('Não foi possível salvar', 'O navegador bloqueou o armazenamento.')
          }}
        />
      )}
      <IconButton label={sound ? 'Desativar som' : 'Ativar som'} icon={sound ? Volume2 : VolumeX} pressed={!sound ? false : undefined} onClick={() => toggle('sound')} />
      <IconButton
        label={`Conquistas (${unlocked} de ${total})`}
        icon={MedalIcon}
        dot={unseen > 0}
        onClick={() => open('achievements')}
        className={path === '/' ? undefined : 'max-sm:hidden'}
      />
      <IconButton label="Menu" icon={Menu} onClick={() => open('menu')} />
    </>
  )
}

export const TopBar = memo(function TopBar({ path }: { path: RoutePath }) {
  const slots = useSlotStore((s) => s.slots)
  if (slots.topbar === false) return null
  const h = slots.height ?? (path === '/' ? 72 : path === '/identidade' ? 62 : 60)
  return (
    <header className={cx('lx-topbar', h === 72 && 'lx-topbar--tall', h === 62 && 'lx-topbar--mid')}>
      <Brand sub={slots.sub ?? SUB[path]} href="#/" />
      <div className="lx-topbar__center">{slots.center !== undefined ? slots.center : <DefaultCenter path={path} />}</div>
      <div className="lx-topbar__right">
        {slots.extraActions}
        {slots.actions !== undefined ? slots.actions : <RightCluster path={path} />}
      </div>
    </header>
  )
})
