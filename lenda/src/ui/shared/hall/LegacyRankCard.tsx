/**
 * Cartão compacto "Hall das Lendas" para o Resumo: Nota de Legado, posição contra as 50 lendas e as
 * suas runs, recordes quebrados e as melhores comparações. Autossuficiente (lê o store).
 *
 *   <LegacyRankCard career={career} />
 */
import { useMemo } from 'react'
import { ArrowRight, Landmark, Quote, Trophy, Zap } from 'lucide-react'
import type { CareerState } from '@/engine/types'
import { compareRun, nextTarget, placeRun } from '@/engine/legacy'
import { navigate } from '@/store/app'
import { cx } from '@/ui/primitives'
import { LegendAvatar, NotaRing } from './parts'
import { careerToRun, gapText, useHallModel } from './model'
import './hall.css'

export function LegacyRankCard({ career, className }: { career: CareerState | Omit<CareerState, 'world'>; className?: string }) {
  const hall = useHallModel()
  const finished = !!career.retired || career.phase === 'finished'
  const inHall = hall.runById.has(career.id)
  const p = useMemo(() => {
    // já está no Hall: a mesma avaliação da tela #/hall (posição atual entre todas as runs e lendas)
    const run = hall.runById.get(career.id)
    if (run) {
      return {
        run,
        rank: hall.overall.find((r) => r.entry === run)?.rank ?? 0,
        total: hall.overall.length,
        legendsBelow: hall.legends.filter((l) => l.raw < run.raw).length,
        runRank: hall.runs.filter((r) => r.raw > run.raw).length + 1,
        runCount: hall.runs.length,
        comparisons: compareRun(run, hall.legends),
        next: nextTarget(run, hall.legends),
      }
    }
    // carreira em andamento (ou ainda não salva): contra tudo o que já está no Hall
    return placeRun(careerToRun(career), hall.runs.map((r) => r.input), { finished })
  }, [hall, career, finished])
  const { run } = p
  return (
    <section className={cx('lx-glass hl-lrc', className)} aria-labelledby="hl-lrc-h">
      <div className="hl-lrc__main">
        <NotaRing score={run.score} size={86} />
        <div className="min-w-0">
          <span className="hl-kicker hl-kicker--gold">
            <Landmark size={12} aria-hidden /> Hall das Lendas{inHall ? ` · Run nº ${run.runNo}` : ''}
          </span>
          <h2 id="hl-lrc-h" className="hl-lrc__t">
            {run.tier.label} · <span className="lx-metal-text">{p.rank}º</span> de {p.total}
          </h2>
          <p className="hl-lrc__s">
            {p.legendsBelow > 0 ? `Acima de ${p.legendsBelow} das 50 lendas reais` : 'Ainda abaixo das 50 lendas reais'}
            {p.runCount > 1 ? ` · ${p.runRank}ª entre as suas ${p.runCount} runs` : ''}
            {!finished ? ' · parcial' : ''}
          </p>
        </div>
      </div>
      <div className="hl-lrc__facts">
        <span>
          <Trophy size={14} aria-hidden />
          <b>{run.historic.length}</b> {run.historic.length === 1 ? 'recorde histórico' : 'recordes históricos'}
        </span>
        {run.personal.length > 0 && (
          <span title="Só selo: não entra na nota nem é comparado com as lendas">
            <Zap size={14} aria-hidden />
            <b>{run.personal.length}</b> {run.personal.length === 1 ? 'recorde das suas runs' : 'recordes das suas runs'}
          </span>
        )}
        {p.next && (
          <span>
            <LegendAvatar legend={p.next.legend} size={18} />
            Próximo alvo: <b>{p.next.legend.legend.name}</b> ({gapText(p.next.gap)})
          </span>
        )}
      </div>
      {p.comparisons.length > 0 && (
        <ul className="hl-quotes hl-quotes--list">
          {p.comparisons.slice(0, 3).map((c) => (
            <li key={c.text}>
              <Quote size={13} aria-hidden />
              <span>{c.text.replace(/^Sua run nº \d+/, inHall ? `Sua run nº ${run.runNo}` : 'Esta carreira')}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="hl-link hl-lrc__go" onClick={() => navigate('/hall', { query: inHall ? { run: career.id } : undefined })}>
        Abrir o Hall das Lendas <ArrowRight size={14} aria-hidden />
      </button>
    </section>
  )
}

export default LegacyRankCard
