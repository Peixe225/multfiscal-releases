/** Hall das Lendas — detalhe de uma run, ficha de uma lenda e "como a nota é calculada". */
import { useMemo, useState } from 'react'
import { ArrowRight, Quote, Trash2, Trophy, TrendingUp, Zap } from 'lucide-react'
import { CATEGORIES, CATEGORY_IDS, LEGACY_WEIGHTS, LEGENDS_AS_OF, compareRun, formatCategoryValue, nextTarget, type LegendLegacy, type RunLegacy } from '@/engine/legacy'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { useClub, useCountry } from '@/store/data'
import { Button, Crest, Eyebrow, Modal, POSITION_LABEL, cx, formatInt, toast } from '@/ui/primitives'
import { CategoryGlyph, LegendAvatar, NotaRing, RunCrests, valueOf } from './parts'
import { gapText, runHeadline, yearsLabel, type HallModel } from './model'

function Breakdown({ items, values }: { items: RunLegacy['breakdown']; values: RunLegacy | LegendLegacy }) {
  return (
    <ul className="hl-bd">
      {items.map((b) => (
        <li key={b.id} className={cx(b.points < 0.05 && 'is-zero')}>
          <span className="hl-bd__h">
            <CategoryGlyph id={b.id} size={20} />
            <span className="hl-lg">{CATEGORIES[b.id].label}</span>
            <span className="hl-sm">{CATEGORIES[b.id].short}</span>
          </span>
          <span className="hl-bd__v num">{valueOf(values, b.id)}</span>
          <span className="hl-bd__bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${b.max ? b.points / b.max : 0})` }} />
          </span>
          <span className="hl-bd__p num" title={`${b.points.toFixed(1)} de ${b.max} pontos`}>
            {b.points.toFixed(1).replace('.', ',')}
            <small>/{b.max}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function RunDetail({ entry: run, hall, onClose }: { entry: RunLegacy | null; hall: HallModel; onClose: () => void }) {
  const remove = useCareer((s) => s.removeHallEntry)
  const [confirm, setConfirm] = useState(false)
  const h = run ? hall.entryById.get(run.id) : undefined
  const club = useClub(run?.stats.mainClubId)
  const cmp = useMemo(() => (run ? compareRun(run, hall.legends, { max: 8 }) : []), [run, hall.legends])
  const next = useMemo(() => (run ? nextTarget(run, hall.legends) : null), [run, hall.legends])
  const rank = run ? (hall.overall.find((r) => r.entry === run)?.rank ?? 0) : 0
  const del = async () => {
    if (!run) return
    const name = run.input.identity.surname
    setConfirm(false)
    onClose()
    await remove(run.id)
    toast.info(`${name} saiu do Hall das Lendas`)
  }
  return (
    <>
      <Modal
        open={!!run}
        onClose={onClose}
        size="xl"
        media={run ? <NotaRing score={run.score} size={64} /> : undefined}
        title={
          run ? (
            <span className="hl-md__t">
              {run.input.identity.surname} <span className="hl-runtag">Run nº {run.runNo}</span>
            </span>
          ) : undefined
        }
        description={
          run
            ? `${run.tier.label} · ${rank}º de ${hall.overall.length} no Hall das Lendas · ${POSITION_LABEL[run.stats.position]} · ${run.stats.seasons} temporadas${h ? ` · ${runHeadline(h, run, rank)}` : ''}`
            : undefined
        }
        footer={
          run && (
            <div className="flex gap-2 w-full items-center flex-wrap">
              <Button variant="ghost" size="md" icon={Trash2} onClick={() => setConfirm(true)}>
                Remover
              </Button>
              <span className="flex-1" />
              {h && (
                <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: run.id } })}>
                  Ver resumo
                </Button>
              )}
            </div>
          )
        }
      >
        {run && (
          <div className="hl-md">
            <div className="hl-md__col">
              <div className="hl-md__meta">
                {club && <Crest club={club} size={22} decorative />}
                <RunCrests run={run} max={8} size={20} />
                <span>
                  {formatInt(run.stats.apps)} jogos · {formatInt(run.stats.goals)} gols · {formatInt(run.stats.assists)} assistências · {formatInt(run.stats.titles)} títulos
                </span>
              </div>
              <Eyebrow as="h3">Composição da Nota de Legado</Eyebrow>
              <Breakdown items={run.breakdown} values={run} />
              {next && (
                <p className="hl-md__next">
                  <TrendingUp size={14} aria-hidden /> Próximo alvo: <b>{next.legend.legend.name}</b> ({next.legend.score}) — {gapText(next.gap)}.
                </p>
              )}
            </div>
            <div className="hl-md__col">
              <Eyebrow as="h3">Posição por categoria</Eyebrow>
              <ul className="hl-pos">
                {CATEGORY_IDS.map((id) => {
                  const rows = hall.categories[id]
                  const row = rows.find((r) => r.entry === run)
                  const ok = !!row && run.values[id] > 0
                  return (
                    <li key={id} className={cx(!ok && 'is-zero', ok && row!.rank <= 3 && 'is-podium')}>
                      <CategoryGlyph id={id} size={20} />
                      <span className="hl-pos__l">{CATEGORIES[id].short}</span>
                      <b className="num">{ok ? `${row!.rank}º` : '—'}</b>
                      <small className="num">{valueOf(run, id)}</small>
                    </li>
                  )
                })}
              </ul>
              <Eyebrow as="h3" className="mt-4 block">
                Recordes históricos · {run.historic.length}
              </Eyebrow>
              {run.historic.length ? (
                <ul className="hl-recs">
                  {run.historic.map((r) => (
                    <li key={r.id} className="is-hist">
                      <span className="hl-recs__ic">
                        <Trophy size={14} aria-hidden />
                      </span>
                      <span>
                        <small>Recorde mundial</small>
                        {r.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hl-md__empty">Nenhum recorde histórico nesta run. Supere uma marca mundial (Bolas de Ouro, gols, Libertadores…) para entrar nesta lista.</p>
              )}
              {run.personal.length > 0 && (
                <>
                  <Eyebrow as="h3" className="mt-4 block">
                    Recordes das suas runs · {run.personal.length}
                  </Eyebrow>
                  <ul className="hl-recs">
                    {run.personal.map((r) => (
                      <li key={r.id} className="is-pers">
                        <span className="hl-recs__ic">
                          <Zap size={14} aria-hidden />
                        </span>
                        <span>
                          <small>Só selo · não entra na nota</small>
                          {r.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Eyebrow as="h3" className="mt-4 block">
                Comparações com lendas
              </Eyebrow>
              {cmp.length ? (
                <ul className="hl-quotes hl-quotes--list">
                  {cmp.map((c) => (
                    <li key={c.text}>
                      <Quote size={13} aria-hidden />
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hl-md__empty">Nenhuma categoria acima de uma lenda ainda.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Remover do Hall das Lendas?"
        description={run ? `A run nº ${run.runNo} (${run.input.identity.surname}) será apagada deste navegador. Não dá para desfazer.` : undefined}
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" size="md" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="md" icon={Trash2} onClick={del}>
              Remover
            </Button>
          </div>
        }
      />
    </>
  )
}

const STAT_ROWS: { k: keyof LegendLegacy['legend']; label: string }[] = [
  { k: 'apps', label: 'Jogos' },
  { k: 'goals', label: 'Gols' },
  { k: 'assists', label: 'Assistências' },
  { k: 'ballonDor', label: 'Bolas de Ouro' },
  { k: 'worldCups', label: 'Copas do Mundo' },
  { k: 'goldenBoots', label: 'Chuteiras de Ouro' },
  { k: 'ucl', label: 'Champions' },
  { k: 'libertadores', label: 'Libertadores' },
  { k: 'leagueTitles', label: 'Títulos nacionais' },
  { k: 'otherMajorTitles', label: 'Outros títulos grandes' },
]

export function LegendDetail({ entry, hall, onClose }: { entry: LegendLegacy | null; hall: HallModel; onClose: () => void }) {
  const l = entry?.legend
  const country = useCountry(l?.nationality)
  const rank = entry ? (hall.overall.find((r) => r.entry === entry)?.rank ?? 0) : 0
  const cname = l?.nationality === 'URS' ? 'União Soviética' : (country?.name ?? l?.nationality)
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      size="xl"
      media={entry ? <LegendAvatar legend={entry} size={56} /> : undefined}
      title={l?.name}
      description={
        entry && l
          ? `${l.fullName} · ${cname} · ${POSITION_LABEL[l.position]} · ${yearsLabel(l.years)}${l.active ? ` (em atividade; números até ${LEGENDS_AS_OF.slice(5)}/${LEGENDS_AS_OF.slice(0, 4)})` : ''} · ${rank}º no Hall`
          : undefined
      }
    >
      {entry && l && (
        <div className="hl-md">
          <div className="hl-md__col">
            <div className="hl-md__score">
              <NotaRing score={entry.score} size={64} />
              <div>
                <b className="hl-tier">{entry.tier.label}</b>
                <span>Nota de Legado na mesma escala das suas runs</span>
              </div>
            </div>
            <dl className="hl-facts">
              {STAT_ROWS.map(({ k, label }) => {
                const v = l[k] as number
                const approx = (k === 'assists' && l.assistsEstimated) || (l.uncertain ?? []).includes(k as never)
                return (
                  <div key={k}>
                    <dt>{label}</dt>
                    <dd className="num">
                      {approx ? '≈' : ''}
                      {formatInt(v)}
                    </dd>
                  </div>
                )
              })}
              <div>
                <dt>Média de gols</dt>
                <dd className="num">{formatCategoryValue('goalsPerGame', entry.values.goalsPerGame, { unit: false, approx: !!entry.approx.goalsPerGame })}</dd>
              </div>
              <div>
                <dt>Clubes</dt>
                <dd className="num">{l.clubs.length}</dd>
              </div>
            </dl>
            <Eyebrow as="h3" className="mt-4 block">
              Clubes
            </Eyebrow>
            <ul className="hl-lclubs">
              {l.clubs.map((c) => (
                <LegendClubChip key={c.name} name={c.name} clubId={c.clubId} />
              ))}
            </ul>
            {entry.worldRecords.length > 0 && (
              <>
                <Eyebrow as="h3" className="mt-4 block">
                  Recordes mundiais que contam na nota · {entry.worldRecords.length}
                </Eyebrow>
                <ul className="hl-wrecs">
                  {entry.worldRecords.map((r) => (
                    <li key={r.metric} className={cx(r.current && 'is-cur')}>
                      {r.label}
                      <small>{r.current ? 'atual' : 'na época'}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {l.records.length > 0 && (
              <>
                <Eyebrow as="h3" className="mt-4 block">
                  Marcas notáveis
                </Eyebrow>
                <ul className="hl-recs">
                  {l.records.map((r) => (
                    <li key={r} className="is-hist">
                      <span className="hl-recs__ic">
                        <Trophy size={14} aria-hidden />
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="hl-md__col">
            <Eyebrow as="h3">Composição da nota</Eyebrow>
            <Breakdown items={entry.breakdown} values={entry} />
            {(l.notes?.length ?? 0) > 0 && (
              <ul className="hl-notes">
                {l.notes!.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function LegendClubChip({ name, clubId }: { name: string; clubId?: string }) {
  const club = useClub(clubId)
  return (
    <li>
      {club ? <Crest club={club} size={18} decorative /> : <span className="hl-lclubs__dot" aria-hidden="true" />}
      {name}
    </li>
  )
}

const HOW: { label: string; weight: number; rule: string }[] = [
  { label: 'Bolas de Ouro', weight: LEGACY_WEIGHTS.ballonDor, rule: '1 ≈ 39%, 3 ≈ 78%, 5 ≈ 92%, 8 ≈ 98%; as retroativas da France Football (lendas pré-1995) valem meia' },
  { label: 'Copas do Mundo', weight: LEGACY_WEIGHTS.worldCups, rule: '1 Copa ≈ 51% do peso, 2 ≈ 76%, 3 ≈ 88%' },
  { label: 'Champions + Libertadores', weight: LEGACY_WEIGHTS.continental, rule: 'somadas; o peso é dividido entre as duas' },
  { label: 'Gols', weight: LEGACY_WEIGHTS.goals, rule: '300 ≈ 55%, 500 ≈ 73%, 1.000 ≈ 93% (ajustado por posição)' },
  { label: 'Média de gols', weight: LEGACY_WEIGHTS.goalsPerGame, rule: 'de 0,25 a 0,90 gol por jogo, com 300+ jogos' },
  { label: 'Recordes mundiais', weight: LEGACY_WEIGHTS.records, rule: 'nas métricas do jogo: 1 ≈ 28%, 3 ≈ 63%. Recordes das suas runs são só selo' },
  { label: 'Títulos nacionais', weight: LEGACY_WEIGHTS.leagueTitles, rule: 'só primeira divisão; 5 ≈ 57%, 10 ≈ 81%' },
  { label: 'Assistências', weight: LEGACY_WEIGHTS.assists, rule: '160 ≈ 63%, 400 ≈ 92%' },
  { label: 'Chuteiras de Ouro', weight: LEGACY_WEIGHTS.goldenBoots, rule: '1 ≈ 43%, 3 ≈ 81%' },
  { label: 'Clubes', weight: LEGACY_WEIGHTS.clubs, rule: '2 ≈ 50%, 4+ = 100%; um clube só (300+ jogos) também vale 100%' },
]

export function HowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="md" title="Como a Nota de Legado é calculada" description="A mesma fórmula avalia as suas runs e as lendas reais — por isso dá para comparar.">
      <div className="hl-how">
        <p>Cada categoria rende pontos com retorno decrescente (o primeiro título vale mais que o nono). Os pesos somam 100; a soma passa por uma curva final que vai de 0 a 100.</p>
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Peso</th>
              <th>Como enche</th>
            </tr>
          </thead>
          <tbody>
            {HOW.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.weight}</td>
                <td>{r.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>Posição conta:</b> gols e assistências de meio-campistas valem ×1,5; de defensores, ×3 mais um bônus de longevidade (0,2 por jogo, sem passar de um artilheiro de verdade); goleiros pontuam pela longevidade (jogos). OVR não entra: as lendas não têm.
        </p>
        <p>
          <b>A nota é só da run:</b> não muda com a ordem das runs nem quando uma run sai do Hall. Superar as suas runs anteriores rende selo, não pontos.
        </p>
        <p>
          <b>Níveis:</b> Promessa (0–24) · Profissional (25–44) · Ídolo (45–59) · Craque (60–74) · Lenda (75–89) · Imortal (90+).
        </p>
      </div>
    </Modal>
  )
}
