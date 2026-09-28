/**
 * Hall da Fama (route "#/hall") — finished careers saved in this browser.
 * The best career gets the featured "podium" card; the rest are cards with OVR tier, clubs,
 * trophies and "Ver resumo" (→ #/resumo?id=<id>). Sort by legado, recentes or OVR.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Crown, Play, Trash2 } from 'lucide-react'
import type { Club, Trophy, TrophyFamily } from '@/engine/types'
import { navigate } from '@/store/app'
import { selectHasActiveCareer, useCareer, type HallEntry } from '@/store/career'
import { useData } from '@/store/data'
import { Button, Crest, Eyebrow, Flag, Glass, IconButton, Modal, OvrBadge, POSITION_LABEL, Segmented, Tooltip, formatInt, toast, useReducedMotion } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { clubColors } from '@/ui/theme/club'
import { TrophyArt } from '@/ui/trophies'
import { clubKit } from '@/ui/shared/identity/kit'
import { PACE_INFO } from '@/ui/shared/identity/prefs'
import { PlayerCard } from '@/ui/shared/landing/PlayerCard'
import '@/ui/shared/landing/landing.css'
import '@/ui/shared/achievements/unlockToasts'
import './hall.css'

type Sort = 'legado' | 'recentes' | 'ovr'

const FAMILY_ORDER: TrophyFamily[] = ['world_cup', 'national_continental', 'club_world_cup', 'continental_primary', 'continental_secondary', 'continental_tertiary', 'league', 'domestic_cup', 'award']

interface HallView {
  entry: HallEntry
  main: Club | undefined
  clubs: Club[]
  titles: number
  ballons: number
  trophies: { trophy: Trophy | undefined; id: string; count: number }[]
  firstAge: number
  lastAge: number
}

function useHallViews(list: HallEntry[]): HallView[] {
  const index = useData((s) => s.index)
  return useMemo(
    () =>
      list.map((entry) => {
        const s = entry.summary
        const byUse = [...s.clubs].sort((a, b) => b.seasons - a.seasons || b.apps - a.apps)
        const clubs = [...new Set(byUse.map((c) => c.clubId))].map((id) => index?.clubById.get(id)).filter((c): c is Club => !!c)
        const trophies = s.trophies
          .map((t) => ({ id: t.trophyId, count: t.count, trophy: index?.trophyById.get(t.trophyId) }))
          .sort((a, b) => FAMILY_ORDER.indexOf(a.trophy?.family ?? 'award') - FAMILY_ORDER.indexOf(b.trophy?.family ?? 'award') || b.count - a.count)
        const seasons = entry.career.seasons ?? []
        return {
          entry,
          main: clubs[0],
          clubs,
          titles: s.trophies.reduce((a, t) => a + t.count, 0),
          ballons: s.awards.find((a) => a.award === 'ballon_dor')?.count ?? 0,
          trophies,
          firstAge: seasons[0]?.age ?? 16,
          lastAge: seasons.at(-1)?.age ?? entry.career.age,
        }
      }),
    [list, index],
  )
}

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' ')

function ClubsRow({ clubs, max = 5, size = 24 }: { clubs: Club[]; max?: number; size?: number }) {
  return (
    <span className="hl-clubs" aria-label={`Clubes: ${clubs.map((c) => c.shortName).join(', ')}`}>
      {clubs.slice(0, max).map((c) => (
        <Crest key={c.id} club={c} size={size} decorative shadow />
      ))}
      {clubs.length > max && <span className="hl-clubs__more">+{clubs.length - max}</span>}
    </span>
  )
}

function Legacy({ score }: { score: number }) {
  const v = Math.max(0, Math.min(100, Math.round(score)))
  return (
    <div className="hl-legacy" aria-label={`Legado ${v} de 100`}>
      <span>Legado</span>
      <span className="hl-legacy__bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${v / 100})` }} />
      </span>
      <b>{v}</b>
    </div>
  )
}

function Featured({ v, onDelete }: { v: HallView; onDelete: () => void }) {
  const { entry } = v
  const s = entry.summary
  const id = entry.identity
  const style = v.main ? ({ ['--club' as string]: clubColors(v.main).primary } as CSSProperties) : undefined
  return (
    <Glass className="hl-top" padding="none" style={style} aria-labelledby={`hl-${entry.id}`}>
      <div className="hl-top__card">
        <PlayerCard
          ovr={s.peakOvr}
          pos={id.position}
          nationality={id.nationality}
          club={v.main}
          kit={clubKit(v.main)}
          name={id.surname}
          number={id.number}
          stats={[
            ['JOG', formatInt(s.totals.apps)],
            ['GOL', formatInt(s.totals.goals)],
            ['TÍT', v.titles],
          ]}
          width={230}
        />
      </div>
      <div className="min-w-0">
        <span className="hl-rank">
          <Crown size={13} aria-hidden /> Sua maior lenda
        </span>
        <h2 className="hl-name" id={`hl-${entry.id}`}>
          {id.surname} <small>#{id.number}</small>
          <Flag code={id.nationality} h={20} w={27} radius={4} />
        </h2>
        <p className="hl-headline lx-metal-text">{s.headline}</p>
        <div className="hl-meta">
          <span>{POSITION_LABEL[id.position]}</span>
          <span className="hl-dot" />
          <span>
            {v.firstAge}–{v.lastAge} anos · {s.seasons} temporadas
          </span>
          <span className="hl-dot" />
          <span>Ritmo {PACE_INFO[entry.pace]?.label ?? entry.pace}</span>
          {v.clubs.length > 0 && (
            <>
              <span className="hl-dot" />
              <ClubsRow clubs={v.clubs} max={6} size={20} />
            </>
          )}
        </div>
        <div className="hl-kpis">
          <div className="hl-kpi">
            <b>{formatInt(s.totals.apps)}</b>
            <span>Jogos</span>
          </div>
          <div className="hl-kpi">
            <b>{formatInt(s.totals.goals)}</b>
            <span>Gols</span>
          </div>
          <div className="hl-kpi">
            <b className="lx-metal-text--v">{v.titles}</b>
            <span>Títulos</span>
          </div>
          <div className="hl-kpi">
            <b>{v.ballons}</b>
            <span>Bolas de Ouro</span>
          </div>
        </div>
        {v.trophies.length > 0 && (
          <div className="hl-shelf" aria-label="Principais taças">
            {v.trophies.slice(0, 6).map((t) => (
              <Tooltip key={t.id} content={`${t.trophy?.name ?? t.id} ×${t.count}`}>
                <span className="hl-tro" tabIndex={0}>
                  <TrophyArt id={t.trophy?.art ?? t.id} trophy={t.trophy} size={54} title={t.trophy?.name} />
                  {t.count > 1 && <span className="hl-tro__n">×{t.count}</span>}
                </span>
              </Tooltip>
            ))}
          </div>
        )}
        <div className="mt-4 grid gap-3">
          <Legacy score={s.legacyScore} />
          <div className="flex gap-2 flex-wrap items-center">
            <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: entry.id } })}>
              Ver resumo
            </Button>
            <span className="text-[12px] text-text-3 ml-1">Encerrada em {dateLabel(entry.finishedAt)}</span>
            <IconButton label={`Remover ${id.surname} do Hall da Fama`} icon={Trash2} size="sm" className="ml-auto" onClick={onDelete} />
          </div>
        </div>
      </div>
    </Glass>
  )
}

function HallCard({ v, rank, onDelete }: { v: HallView; rank: number; onDelete: () => void }) {
  const { entry } = v
  const s = entry.summary
  const id = entry.identity
  const style = v.main ? ({ ['--club' as string]: clubColors(v.main).primary } as CSSProperties) : undefined
  return (
    <Glass as="article" className="hl-card" padding="none" style={style} aria-labelledby={`hl-${entry.id}`}>
      <div className="hl-card__top">
        <OvrBadge ovr={s.peakOvr} size="md" sheen={false} />
        <div className="min-w-0 flex-1">
          <h3 className="hl-card__name m-0" id={`hl-${entry.id}`}>
            <span>{id.surname}</span>
            <Flag code={id.nationality} h={14} w={19} />
            <small className="font-num text-text-3 text-[15px] font-bold">#{rank}</small>
          </h3>
          <div className="hl-card__hl">{s.headline}</div>
          <div className="text-[11.5px] text-text-3 mt-1 truncate">
            {POSITION_LABEL[id.position]} · {v.firstAge}–{v.lastAge} anos · {s.seasons} temp.
          </div>
        </div>
      </div>
      <div className="hl-card__stats">
        <div className="hl-st">
          <b>{formatInt(s.totals.apps)}</b>
          <span>Jogos</span>
        </div>
        <div className="hl-st">
          <b>{formatInt(s.totals.goals)}</b>
          <span>Gols</span>
        </div>
        <div className="hl-st">
          <b className="lx-metal-text--v">{v.titles}</b>
          <span>Títulos</span>
        </div>
        <div className="hl-st">
          <b>{v.ballons}</b>
          <span>Bolas</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 min-h-[44px]">
        <ClubsRow clubs={v.clubs} />
        <span className="flex items-end gap-2" aria-label="Principais taças">
          {v.trophies.slice(0, 3).map((t) => (
            <span key={t.id} className="hl-tro" title={`${t.trophy?.name ?? t.id} ×${t.count}`}>
              <TrophyArt id={t.trophy?.art ?? t.id} trophy={t.trophy} size={38} />
              {t.count > 1 && <span className="hl-tro__n">×{t.count}</span>}
            </span>
          ))}
        </span>
      </div>
      <Legacy score={s.legacyScore} />
      <div className="hl-card__foot">
        <span>Encerrada em {dateLabel(entry.finishedAt)}</span>
        <span className="flex items-center gap-1.5">
          <IconButton label={`Remover ${id.surname} do Hall da Fama`} icon={Trash2} size="sm" onClick={onDelete} />
          <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: entry.id } })}>
            Ver resumo
          </Button>
        </span>
      </div>
    </Glass>
  )
}

export default function HallScreen() {
  useShellSlots({ sub: 'HALL DA FAMA', stage: { preset: 'legend' } })
  const rm = useReducedMotion()
  const hall = useCareer((s) => s.finishedCareers)
  const active = useCareer(selectHasActiveCareer)
  const remove = useCareer((s) => s.removeHallEntry)
  const [sort, setSort] = useState<Sort>('legado')
  const [pending, setPending] = useState<HallEntry | null>(null)
  const sorted = useMemo(() => {
    const l = [...hall]
    if (sort === 'recentes') l.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    else if (sort === 'ovr') l.sort((a, b) => b.summary.peakOvr - a.summary.peakOvr || b.summary.legacyScore - a.summary.legacyScore)
    else l.sort((a, b) => b.summary.legacyScore - a.summary.legacyScore)
    return l
  }, [hall, sort])
  const views = useHallViews(sorted)
  const [top, ...rest] = views

  const confirmDelete = async () => {
    if (!pending) return
    const name = pending.identity.surname
    await remove(pending.id)
    setPending(null)
    toast.info(`${name} saiu do Hall da Fama`)
  }

  return (
    <main id="conteudo" tabIndex={-1} className="hl-wrap outline-none">
      <div className="hl-head">
        <div>
          <Eyebrow>Hall da Fama</Eyebrow>
          <h1>Suas lendas</h1>
          <p>{hall.length ? `${hall.length} ${hall.length === 1 ? 'carreira encerrada' : 'carreiras encerradas'} neste navegador, do maior legado ao menor.` : 'As carreiras que você terminar ficam guardadas aqui, neste navegador.'}</p>
        </div>
        {hall.length > 1 && (
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            aria-label="Ordenar carreiras"
            options={[
              { value: 'legado', label: 'Legado' },
              { value: 'recentes', label: 'Recentes' },
              { value: 'ovr', label: 'OVR' },
            ]}
          />
        )}
      </div>

      {!top ? (
        <Glass className="hl-empty" padding="none">
          <div className="hl-empty__art" aria-hidden="true">
            <TrophyArt id="ballon-dor" size={150} />
          </div>
          <h2>Seu Hall da Fama está vazio</h2>
          <p>Jogue até a aposentadoria: a carreira ganha um lugar aqui com OVR máximo, clubes, taças e o legado que você deixou.</p>
          <div className="flex gap-2 flex-wrap justify-center mt-3">
            {active ? (
              <Button variant="primary" size="lg" icon={Play} onClick={() => navigate('/carreira')}>
                Continuar carreira
              </Button>
            ) : (
              <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
                Começar carreira
              </Button>
            )}
          </div>
        </Glass>
      ) : (
        <>
          <motion.div key={`${top.entry.id}-${sort}`} initial={rm ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            <Featured v={top} onDelete={() => setPending(top.entry)} />
          </motion.div>
          {rest.length > 0 && (
            <ul className="hl-grid m-0 p-0 list-none" aria-label="Outras carreiras">
              {rest.map((v, i) => (
                <motion.li
                  key={v.entry.id}
                  className="flex"
                  initial={rm ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min(0.4, 0.06 * i) }}
                >
                  <div className="flex-1 min-w-0 flex [&>*]:flex-1">
                    <HallCard v={v} rank={i + 2} onDelete={() => setPending(v.entry)} />
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title="Remover do Hall da Fama?"
        description={pending ? `A carreira de ${pending.identity.surname} (${pending.summary.headline}) será apagada deste navegador. Não dá para desfazer.` : undefined}
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" size="md" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="md" icon={Trash2} onClick={confirmDelete}>
              Remover
            </Button>
          </div>
        }
      />
    </main>
  )
}
