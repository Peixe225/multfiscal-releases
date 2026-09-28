/**
 * Painéis da Central: placa do jogador, condição, atributos (radar + barras), relações,
 * classificação ao vivo, caixa de entrada, manchetes e a faixa da agenda.
 */
import { memo, useMemo, useState, type CSSProperties } from 'react'
import {
  Activity,
  BatteryMedium,
  Brain,
  CalendarDays,
  Check,
  Crown,
  Dumbbell,
  Flame,
  Handshake,
  HeartPulse,
  Inbox,
  Megaphone,
  Mic,
  Newspaper,
  Plane,
  Repeat2,
  Shirt,
  Smile,
  Sparkles,
  Star,
  Trophy,
  Users,
  Zap,
} from 'lucide-react'
import type { CalendarItem, ImmersiveState, InboxMessage } from '@/engine/immersive/types'
import type { StandingRow } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry, getLeague } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Crest, Flag, Modal, Button, POSITION_LABEL, YouBadge, cx, formatMoney, rowClubVars } from '@/ui/primitives'
import { AttrBar, CompLogo, FormChips, ImOvr, Meter, PanelHead, TeamMark } from '../bits'
import { ATTR_LABEL, KIND_LABEL } from '../model/constants'
import { attrKeysFor, attrValue } from '../model/training'
import { compInfo, goalDiff, levelOf, likelyStarter, recentForm, resultLetter, teamInfo, userLeagueId, zoneOf, type ZoneKey } from '../model/view'

// ───────────────────────── placa do jogador ─────────────────────────

export const PlayerPlate = memo(function PlayerPlate({ s }: { s: ImmersiveState }) {
  const club = getClub(s.clubId)
  const country = getCountry(s.identity.nationality)
  const league = getLeague(userLeagueId(s))
  const vars = club ? (rowClubVars(club) as CSSProperties) : undefined
  return (
    <section className="im-pplate lx-anim-rise" aria-label="Seu jogador" style={{ ['--i' as string]: 1 }}>
      <ImOvr ovr={s.ovr} w={116} className="im-pplate__ovr" />
      <div className="im-pplate__club lx-club-plate" style={vars}>
        {club && <Crest club={club} size={130} decorative className="lx-club-plate__wm" />}
        <div className="im-pplate__chips">
          {country && (
            <span className="lx-chip lx-chip--sm">
              <Flag code={country.code} iso2={country.iso2} h={11} w={15} decorative /> {country.code}
            </span>
          )}
          <span className="lx-chip lx-chip--sm lx-chip--pos-ok">{s.identity.position}</span>
          <span className="lx-chip lx-chip--sm">
            #{s.squadNumber} {s.identity.surname}
          </span>
          {s.captain && (
            <span className="lx-chip lx-chip--sm lx-chip--gold">
              <Crown size={11} aria-hidden="true" /> Capitão
            </span>
          )}
        </div>
        <div className="im-pplate__name">
          {club && <Crest club={club} size={34} decorative />}
          <b>{club?.name ?? 'Sem clube'}</b>
        </div>
        <div className="im-pplate__meta">
          {league && <CompLogo id={league.id} size={16} />}
          {league?.shortName ?? '—'} · {likelyStarter(s)}
        </div>
        <div className="im-pplate__nums">
          <span>
            <small>Idade</small>
            <b className="num">{s.age}</b>
          </span>
          <span>
            <small>Valor</small>
            <b className="num">{formatMoney(s.marketValue)}</b>
          </span>
        </div>
      </div>
    </section>
  )
})

// ───────────────────────── condição ─────────────────────────

export const ConditionPanel = memo(function ConditionPanel({ s }: { s: ImmersiveState }) {
  const c = s.condition
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel lx-anim-rise" style={{ ['--i' as string]: 2 }} aria-labelledby="im-cond">
      <PanelHead kicker={<span id="im-cond">Condição</span>} icon={HeartPulse} right={<FormChips form={recentForm(s)} />} />
      {c.injury && (
        <div className="im-injury" role="status">
          <HeartPulse size={16} aria-hidden="true" />
          <span>
            <b>{c.injury.name}</b> · {c.injury.weeksLeft} {c.injury.weeksLeft === 1 ? 'semana' : 'semanas'} fora
          </span>
        </div>
      )}
      <div className="im-meters">
        <Meter label="Energia" value={c.fitness} icon={BatteryMedium} hint="Condição física: cai com treinos intensos e jogos" />
        <Meter label="Fase" value={c.form} icon={Flame} hint="Média das últimas atuações" />
        <Meter label="Moral" value={c.morale} icon={Smile} />
        <Meter label="Ritmo de jogo" value={c.sharpness} icon={Activity} hint="Minutos recentes em campo" />
      </div>
    </section>
  )
})

// ───────────────────────── relações ─────────────────────────

const REL: { key: 'coach' | 'teammates' | 'fans' | 'media'; label: string; icon: typeof Users }[] = [
  { key: 'coach', label: 'Técnico', icon: Brain },
  { key: 'teammates', label: 'Vestiário', icon: Users },
  { key: 'fans', label: 'Torcida', icon: Megaphone },
  { key: 'media', label: 'Imprensa', icon: Mic },
]

export const RelationsPanel = memo(function RelationsPanel({ s, compact }: { s: ImmersiveState; compact?: boolean }) {
  return (
    <div className={cx('im-rel', compact && 'is-compact')}>
      {REL.map((r) => {
        const v = s.relationships[r.key]
        return (
          <div key={r.key} className="im-rel__it" title={`${r.label}: ${v}/100`}>
            <r.icon size={15} aria-hidden="true" />
            <span className="im-rel__l">{r.label}</span>
            <span className="lx-meter" data-level={levelOf(v)} style={{ ['--lx-v' as string]: v / 100 }} aria-hidden="true" />
            <b className="num">{v}</b>
          </div>
        )
      })}
      {!compact && !!s.relationships.bonds?.length && (
        <div className="im-bonds">
          {s.relationships.bonds.slice(0, 3).map((b) => (
            <span key={b.name} className="lx-chip lx-chip--sm" title={`${b.role} · ${b.value}/100`}>
              <Handshake size={11} aria-hidden="true" /> {b.name.split(' ').slice(-1)[0]} · {b.role}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

// ───────────────────────── atributos ─────────────────────────

function Radar({ values, labels }: { values: number[]; labels: string[] }) {
  const n = values.length
  const R = 64
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [80 + Math.cos(a) * r, 80 + Math.sin(a) * r] as const
  }
  const poly = (f: (i: number) => number) => values.map((_, i) => pt(i, f(i)).join(',')).join(' ')
  return (
    <svg viewBox="0 0 160 160" className="im-radar" aria-hidden="true">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={poly(() => R * k)} className="im-radar__grid" />
      ))}
      {values.map((_, i) => {
        const [x, y] = pt(i, R)
        return <line key={i} x1={80} y1={80} x2={x} y2={y} className="im-radar__axis" />
      })}
      <polygon points={poly((i) => (R * Math.max(8, values[i])) / 99)} className="im-radar__val" />
      {values.map((v, i) => {
        const [x, y] = pt(i, R + 12)
        return (
          <text key={i} x={x} y={y + 3} textAnchor="middle" className="im-radar__lbl">
            {labels[i]}
          </text>
        )
      })}
    </svg>
  )
}

export const AttributesPanel = memo(function AttributesPanel({ s, prev }: { s: ImmersiveState; prev?: ImmersiveState | null }) {
  const keys = attrKeysFor(s)
  const values = keys.map((k) => attrValue(s, k))
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel lx-anim-rise" style={{ ['--i' as string]: 4 }} aria-labelledby="im-attr">
      <PanelHead kicker={<span id="im-attr">Atributos</span>} icon={Zap} right={<span className="lx-t-small">Potencial <b className="text-text num">{s.potential}</b></span>} />
      <div className="im-attrs">
        <Radar values={values} labels={keys.map((k) => ATTR_LABEL[k].short)} />
        <div className="im-attrs__bars">
          {keys.map((k) => {
            const before = prev ? attrValue(prev, k) : attrValue(s, k)
            const d = attrValue(s, k) - before
            return <AttrBar key={k} label={ATTR_LABEL[k].label} short={ATTR_LABEL[k].short} value={attrValue(s, k)} flash={d > 0 ? d : undefined} />
          })}
        </div>
      </div>
      <div className="im-divider" />
      <PanelHead kicker="Relações" icon={Users} />
      <RelationsPanel s={s} />
    </section>
  )
})

// ───────────────────────── contrato ─────────────────────────

export const ContractStrip = memo(function ContractStrip({ s }: { s: ImmersiveState }) {
  const f = s.finance
  const left = f.contractUntil - s.season
  return (
    <div className="im-contract">
      <span>
        <small>Salário</small>
        <b className="num">{formatMoney(f.salary)}/ano</b>
      </span>
      <span>
        <small>Contrato</small>
        <b className={cx('num', left <= 0 && 'text-negative')}>até {f.contractUntil}</b>
      </span>
      {f.releaseClause ? (
        <span className="max-sm:hidden">
          <small>Multa</small>
          <b className="num">{formatMoney(f.releaseClause)}</b>
        </span>
      ) : null}
      <span>
        <small>Saldo</small>
        <b className="num">{formatMoney(f.balance)}</b>
      </span>
    </div>
  )
})

// ───────────────────────── classificação ─────────────────────────

export const MiniTable = memo(function MiniTable({ s, rows, full }: { s: ImmersiveState; rows: StandingRow[]; full?: boolean }) {
  const league = getLeague(userLeagueId(s))
  const me = rows.findIndex((r) => r.clubId === s.clubId)
  const n = rows.length
  const shown = useMemo(() => {
    if (full || n <= 8) return rows.map((r, i) => ({ r, i }))
    const idx = new Set<number>([0, 1, 2])
    for (let k = Math.max(0, me - 2); k <= Math.min(n - 1, me + 2); k++) idx.add(k)
    idx.add(n - 1)
    return [...idx].sort((a, b) => a - b).map((i) => ({ r: rows[i], i }))
  }, [rows, me, n, full])
  const round = rows.length ? Math.max(...rows.map((r) => r.played)) : 0
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel lx-anim-rise" style={{ ['--i' as string]: 5 }} aria-labelledby="im-table">
      <PanelHead
        kicker={<span id="im-table">Classificação</span>}
        icon={Trophy}
        right={
          <span className="lx-t-small inline-flex items-center gap-1.5">
            {league && <CompLogo id={league.id} size={16} />}
            {round ? `${round}ª rodada` : league?.shortName}
          </span>
        }
      />
      {rows.length === 0 ? (
        <p className="lx-t-small m-0">Tabela disponível após a primeira rodada.</p>
      ) : (
        <table className="im-table">
          <thead>
            <tr>
              <th className="is-pos">#</th>
              <th className="is-club">Clube</th>
              <th>J</th>
              <th className="max-sm:hidden">SG</th>
              <th>P</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i }, k) => {
              const c = getClub(r.clubId)
              const z: ZoneKey = zoneOf(league, i + 1, n)
              const gap = k > 0 && shown[k - 1].i !== i - 1
              const mine = r.clubId === s.clubId
              return (
                <tr key={r.clubId} className={cx('lx-zone', mine && 'lx-row-me', gap && 'is-gap')} data-zone={z === 'up' ? 'lib' : z ?? undefined}>
                  <td className="is-pos num">{i + 1}</td>
                  <td className="is-club">
                    <span className="im-table__club">
                      {c && <Crest club={c} size={18} decorative />}
                      <span className="truncate">{c?.shortName ?? r.clubId}</span>
                      {mine && <YouBadge>Você</YouBadge>}
                    </span>
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num max-sm:hidden">{goalDiff(r) > 0 ? `+${goalDiff(r)}` : goalDiff(r)}</td>
                  <td className="num is-pts">{r.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
})

// ───────────────────────── caixa de entrada ─────────────────────────

const fromTone = (m: InboxMessage) => (m.offerId ? 'gold' : /sele/i.test(m.from) ? 'accent' : /diretoria|técnico/i.test(m.from) ? 'warn' : 'neutral')

function useInboxView() {
  const dispatch = useImmersive((x) => x.dispatch)
  const [openId, setOpen] = useState<string | null>(null)
  const view = (m: InboxMessage) => {
    setOpen(m.id)
    if (!m.read) void dispatch({ type: 'inbox_read', messageId: m.id })
  }
  return { openId, setOpen, view }
}

function InboxList({ s, max, onView }: { s: ImmersiveState; max: number; onView: (m: InboxMessage) => void }) {
  return (
    <ul className="im-inbox">
      {s.inbox.slice(0, max).map((m) => (
        <li key={m.id}>
          <button type="button" className={cx('im-inbox__it lx-focus-inset', !m.read && 'is-unread')} data-tone={fromTone(m)} onClick={() => onView(m)}>
            <span className="im-inbox__from">{m.from}</span>
            <span className="im-inbox__sub">{m.subject}</span>
            <span className="im-inbox__wk num">Sem {m.week}</span>
          </button>
        </li>
      ))}
      {s.inbox.length === 0 && <li className="lx-t-small">Nada por aqui ainda.</li>}
    </ul>
  )
}

function MessageModal({ s, id, onClose }: { s: ImmersiveState; id: string | null; onClose: () => void }) {
  const msg = s.inbox.find((m) => m.id === id) ?? null
  return (
    <Modal
      open={!!msg}
      onClose={onClose}
      size="md"
      className="im-dlg"
      title={msg?.subject}
      description={msg ? `${msg.from} · semana ${msg.week} · ${msg.season}` : undefined}
      footer={
        msg?.offerId ? (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" size="md" onClick={onClose}>
              Fechar
            </Button>
            <Button variant="primary" size="md" icon={Repeat2} onClick={() => { onClose(); navigate('/imersivo', { query: { tela: 'mercado', proposta: msg.offerId } }) }}>
              Ver proposta
            </Button>
          </div>
        ) : undefined
      }
    >
      <p className="m-0 text-[15px] leading-relaxed text-text-2 whitespace-pre-line">{msg?.body}</p>
    </Modal>
  )
}

export const InboxPanel = memo(function InboxPanel({ s, max = 4 }: { s: ImmersiveState; max?: number }) {
  const { openId, setOpen, view } = useInboxView()
  const unread = s.inbox.filter((m) => !m.read).length
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel lx-anim-rise" style={{ ['--i' as string]: 6 }} aria-labelledby="im-inbox">
      <PanelHead kicker={<span id="im-inbox">Caixa de entrada</span>} icon={Inbox} right={unread ? <span className="lx-chip lx-chip--sm lx-chip--accent num">{unread} novas</span> : undefined} />
      <InboxList s={s} max={max} onView={view} />
      <MessageModal s={s} id={openId} onClose={() => setOpen(null)} />
    </section>
  )
})

/** Caixa de entrada completa (botão da barra superior). */
export function InboxDialog({ s, onClose }: { s: ImmersiveState; onClose: () => void }) {
  const { openId, setOpen, view } = useInboxView()
  return (
    <>
      <Modal open={!openId} onClose={onClose} size="md" className="im-dlg" title="Caixa de entrada" description={`${s.inbox.filter((m) => !m.read).length} não lidas`}>
        <InboxList s={s} max={40} onView={view} />
      </Modal>
      <MessageModal s={s} id={openId} onClose={() => setOpen(null)} />
    </>
  )
}

// ───────────────────────── manchetes ─────────────────────────

export const NewsPanel = memo(function NewsPanel({ s, max = 4 }: { s: ImmersiveState; max?: number }) {
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel lx-anim-rise" style={{ ['--i' as string]: 7 }} aria-labelledby="im-news">
      <PanelHead kicker={<span id="im-news">Manchetes</span>} icon={Newspaper} />
      <ul className="im-news">
        {s.news.slice(0, max).map((n) => (
          <li key={n.id} className="im-news__it" data-tone={n.tone}>
            <span className="im-news__outlet">{n.outlet}</span>
            <span className="im-news__h">{n.headline}</span>
          </li>
        ))}
        {s.news.length === 0 && <li className="lx-t-small">Sem notícias.</li>}
      </ul>
    </section>
  )
})

// ───────────────────────── agenda ─────────────────────────

const KIND_ICON: Record<CalendarItem['kind'], typeof Dumbbell> = {
  training: Dumbbell,
  match: Shirt,
  national_match: Flame,
  press: Mic,
  story: Sparkles,
  transfer_window: Repeat2,
  national_callup: Plane,
  season_end: Star,
  awards: Trophy,
}

export function DayCard({ it, s, state }: { it: CalendarItem; s: ImmersiveState; state: 'past' | 'today' | 'next' }) {
  const isMatch = it.kind === 'match' || it.kind === 'national_match'
  const opp = it.opponentId ? teamInfo(it.opponentId) : null
  const Ico = KIND_ICON[it.kind] ?? CalendarDays
  const res = isMatch && it.result ? resultLetter(it) : null
  const vars = isMatch && opp ? ({ ['--club' as string]: opp.colors.primary } as CSSProperties) : undefined
  const comp = isMatch ? compInfo(it.competitionId) : null
  return (
    <div className={cx('lx-day im-day', state === 'past' && 'is-past', state === 'today' && 'is-today', isMatch && 'is-match', it.kind === 'transfer_window' && 'lx-window-band')} style={vars} aria-current={state === 'today' ? 'step' : undefined}>
      <span className="lx-day__dow">{it.week === 0 ? 'Pré' : `Sem ${it.week}`}{state === 'today' ? ' · agora' : ''}</span>
      <span className="im-day__act">
        {isMatch && opp ? <TeamMark team={opp} size={24} /> : <Ico size={18} aria-hidden="true" />}
        <span className="im-day__t">{isMatch && opp ? `${it.home === false ? '@ ' : 'vs '}${opp.abbr}` : KIND_LABEL[it.kind]}</span>
      </span>
      <span className="im-day__sub">
        {isMatch ? (
          <>
            {comp?.id && <CompLogo id={comp.id} size={14} />}
            <span className="truncate">{it.stage ?? comp?.short}</span>
          </>
        ) : (
          <span className="truncate">{it.title}</span>
        )}
      </span>
      {state === 'past' && (
        <span className="im-day__done">
          {res ? (
            <span className="lx-form" data-r={res}>
              {res}
            </span>
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          {it.result && <b className="num">{it.home === false ? `${it.result.score[1]}–${it.result.score[0]}` : `${it.result.score[0]}–${it.result.score[1]}`}</b>}
        </span>
      )}
      {state !== 'past' && isMatch && (it.importance ?? 0) >= 0.8 && <span className="lx-chip lx-chip--sm lx-chip--gold im-day__big">Decisão</span>}
      {state === 'today' && isMatch && <span className="lx-chip lx-chip--sm lx-chip--live im-day__big">Jogo</span>}
    </div>
  )
}

export const AgendaStrip = memo(function AgendaStrip({ s }: { s: ImmersiveState }) {
  const items = useMemo(() => {
    const start = Math.max(0, s.cursor - 2)
    return s.calendar.slice(start, start + 9).map((it, k) => ({ it, state: (start + k < s.cursor ? 'past' : start + k === s.cursor ? 'today' : 'next') as 'past' | 'today' | 'next' }))
  }, [s.calendar, s.cursor])
  return (
    <section className="im-agenda lx-anim-rise" style={{ ['--i' as string]: 3 }} aria-labelledby="im-agenda-h">
      <PanelHead
        kicker={<span id="im-agenda-h">Agenda</span>}
        icon={CalendarDays}
        right={
          <a className="im-link" href="#/imersivo?tela=agenda" onClick={(e) => { e.preventDefault(); navigate('/imersivo', { query: { tela: 'agenda' } }) }}>
            Temporada completa ›
          </a>
        }
      />
      <div className="im-agenda__row" role="list">
        {items.map(({ it, state }) => (
          <div role="listitem" key={it.id}>
            <DayCard it={it} s={s} state={state} />
          </div>
        ))}
      </div>
    </section>
  )
})

export { POSITION_LABEL, TeamMark }
