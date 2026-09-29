/**
 * Central da semana (hub): cabeçalho com a semana, "Agora" (ação do item atual), placa do jogador,
 * condição, agenda, atributos/relações, classificação ao vivo, caixa de entrada e manchetes.
 */
import { useMemo } from 'react'
import { FastForward, Share2 } from 'lucide-react'
import { useApp, navigate } from '@/store/app'
import { useImmersive } from '@/store/immersive'
import { Button } from '@/ui/primitives'
import { ContractStrip, AgendaStrip, AttributesPanel, ConditionPanel, InboxDialog, InboxPanel, MiniTable, NewsPanel, PlayerPlate } from './panels'
import { EmptyNow, GenericCard, MatchHero, PressCard, StoryDecision, TrainingPicker, WindowCard } from './NowPanel'
import { SocialMini } from '../social/SocialScreen'
import { currentItem, nextMatch, weekName } from '../model/view'

export default function HubScreen() {
  const s = useImmersive((x) => x.state)!
  const prev = useImmersive((x) => x.previous)
  const engine = useImmersive((x) => x.engine)
  const data = useImmersive((x) => x.data)
  const busy = useImmersive((x) => x.busy)
  const dispatch = useImmersive((x) => x.dispatch)
  const query = useApp((x) => x.route.query)
  const it = currentItem(s)
  const table = useMemo(() => {
    if (!engine || !data) return []
    try {
      return engine.liveTable(data, s)
    } catch {
      return []
    }
  }, [engine, data, s])
  const nm = nextMatch(s)

  const now = s.pendingDecision ? (
    <StoryDecision key={s.pendingDecision.id} s={s} />
  ) : !it ? (
    <EmptyNow />
  ) : it.kind === 'training' ? (
    <TrainingPicker key={it.id} s={s} it={it} />
  ) : it.kind === 'match' || it.kind === 'national_match' ? (
    <MatchHero s={s} it={it} table={table} primary />
  ) : it.kind === 'press' ? (
    <PressCard it={it} />
  ) : it.kind === 'transfer_window' ? (
    <WindowCard s={s} it={it} />
  ) : (
    <GenericCard s={s} it={it} />
  )
  const canSkip = it && (it.kind === 'training' || it.kind === 'transfer_window' || it.kind === 'national_callup')

  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-hub outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div className="min-w-0">
          <span className="lx-kicker">
            Central · {it?.kind === 'season_end' || it?.kind === 'awards' ? 'Fim de temporada' : weekName(it?.week ?? 0)} · {s.season} · {s.age} anos
          </span>
          <h1 className="lx-t-display im-hub__title">Sua semana</h1>
        </div>
        <div className="im-hub__actions">
          <Button variant="ghost" size="md" icon={Share2} onClick={() => navigate('/imersivo', { query: { tela: 'social' } })} className="max-sm:hidden">
            Rede social
          </Button>
          {it && it.kind !== 'match' && it.kind !== 'national_match' && it.kind !== 'season_end' && it.kind !== 'awards' && nm && (
            <Button variant="outline" size="md" iconRight={FastForward} loading={busy} onClick={() => void dispatch({ type: 'auto', until: 'next_match' })} title="Treinos no seu último foco, coletivas com respostas humildes; para no jogo e em decisões ou propostas novas">
              Simular até o jogo
            </Button>
          )}
          {canSkip && (
            <Button variant="ghost" size="md" icon={FastForward} loading={busy} onClick={() => void dispatch({ type: 'advance' })} title="Resolve o item atual com a opção padrão">
              Avançar
            </Button>
          )}
        </div>
      </header>

      <div className="im-hub__grid">
        <div className="im-hub__now">{now}</div>
        <aside className="im-hub__me">
          <PlayerPlate s={s} />
          <ContractStrip s={s} />
          <ConditionPanel s={s} />
        </aside>

        {/* sem clube (oferta da base) ainda não há agenda: nada de cabeçalho vazio */}
        {s.calendar.length > 0 && (
          <div className="im-hub__agenda">
            <AgendaStrip s={s} />
          </div>
        )}
        {nm && nm.id !== it?.id && (
          <div className="im-hub__next">
            <MatchHero s={s} it={nm} table={table} primary={false} />
          </div>
        )}
        <div className="im-hub__c1">
          <AttributesPanel s={s} prev={prev} />
        </div>
        <div className="im-hub__c2">
          <MiniTable s={s} rows={table} />
        </div>
        <div className="im-hub__c3">
          <InboxPanel s={s} />
          <NewsPanel s={s} />
        </div>
        <div className="im-hub__social">
          <SocialMini s={s} />
        </div>
      </div>
      {query.caixa && <InboxDialog s={s} onClose={() => navigate('/imersivo')} />}
    </main>
  )
}
