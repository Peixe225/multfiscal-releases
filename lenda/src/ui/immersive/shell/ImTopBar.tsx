/**
 * Conteúdo da barra superior no Modo Imersivo (slots do shell): abas, pílula da temporada,
 * saldo · OVR · caixa de entrada, e — durante a partida — "AO VIVO · competição · fase".
 */
import { memo } from 'react'
import { CalendarDays, Home, Inbox, Repeat2, Share2, Shirt } from 'lucide-react'
import { navigate } from '@/store/app'
import { useImmersive } from '@/store/immersive'
import { IconButton, cx, formatMoney } from '@/ui/primitives'
import { compInfo, teamInfo, weekLabel } from '../model/view'
import { CompLogo, ImOvrS } from '../bits'

export type ImTab = 'central' | 'agenda' | 'social' | 'mercado' | 'carreira'

const TAB_META: Record<ImTab, { label: string; icon: typeof Home }> = {
  central: { label: 'Central', icon: Home },
  agenda: { label: 'Agenda', icon: CalendarDays },
  social: { label: 'Social', icon: Share2 },
  mercado: { label: 'Mercado', icon: Repeat2 },
  carreira: { label: 'Carreira', icon: Shirt },
}

export const goTab = (t: ImTab | 'temporada' | 'gala') => navigate('/imersivo', { query: t === 'central' ? undefined : { tela: t } })

export const ImNav = memo(function ImNav({ active }: { active: ImTab | null }) {
  const offers = useImmersive((s) => s.state?.offers.length ?? 0)
  const unread = useImmersive((s) => s.state?.inbox.filter((m) => !m.read).length ?? 0)
  const season = useImmersive((s) => s.state?.season)
  const week = useImmersive((s) => s.state?.week)
  return (
    <>
      <nav className="im-nav" aria-label="Modo Imersivo">
        {(Object.keys(TAB_META) as ImTab[]).map((t) => {
          const M = TAB_META[t]
          const badge = t === 'mercado' ? offers : t === 'central' ? unread : 0
          return (
            <a
              key={t}
              href={t === 'central' ? '#/imersivo' : `#/imersivo?tela=${t}`}
              className={cx('im-nav__a', active === t && 'is-on')}
              aria-current={active === t ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                goTab(t)
              }}
            >
              <M.icon size={15} aria-hidden="true" />
              <span className="im-nav__l">{M.label}</span>
              {badge > 0 && <span className="im-nav__badge num">{badge}</span>}
            </a>
          )
        })}
      </nav>
      {season != null && (
        <span className="im-season max-xl:hidden">
          <i className="lx-dot-accent" aria-hidden="true" />
          <span className="lx-label">{week === 0 ? 'Pré-temporada' : `Semana ${week}`}</span>
          <b className="num">{season}</b>
        </span>
      )}
    </>
  )
})

export const ImTopActions = memo(function ImTopActions() {
  const s = useImmersive((x) => x.state)
  if (!s) return null
  const unread = s.inbox.filter((m) => !m.read).length
  return (
    <>
      <span className="im-top-money max-md:hidden" title="Saldo">
        <span className="lx-label">Saldo</span>
        <b className="num">{formatMoney(s.finance.balance)}</b>
      </span>
      <span className="im-top-ovr max-sm:hidden" title={`OVR ${s.ovr} · potencial ${s.potential}`}>
        <ImOvrS ovr={s.ovr} title={`OVR ${s.ovr} · potencial ${s.potential}`} />
      </span>
      <IconButton label={unread ? `Caixa de entrada (${unread} não lidas)` : 'Caixa de entrada'} icon={Inbox} dot={unread > 0} onClick={() => navigate('/imersivo', { query: { caixa: 1 } })} className="max-sm:hidden" />
    </>
  )
})

/** Centro da barra durante a partida: AO VIVO · competição · fase · estádio. */
export const LiveTopCenter = memo(function LiveTopCenter() {
  const live = useImmersive((s) => s.state?.live)
  if (!live) return null
  const c = compInfo(live.competitionId)
  const home = teamInfo(live.home.id, live.home)
  return (
    <div className="im-livetop">
      <span className="lx-chip lx-chip--live lx-chip--sm">
        <span className="lx-live-dot" /> Ao vivo
      </span>
      <CompLogo id={live.competitionId} size={20} />
      <span className="im-livetop__t">
        {c.short}
        {live.stage ? ` · ${live.stage}` : ''}
        <span className="max-lg:hidden"> · {home.national ? 'Estádio nacional' : `Casa do ${home.short}`}</span>
      </span>
    </div>
  )
})

export { weekLabel }
