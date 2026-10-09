/**
 * Central da semana (hub): cabeçalho com a semana, "Agora" (ação do item atual), placa do jogador,
 * condição, agenda, atributos/relações, classificação ao vivo, caixa de entrada e manchetes.
 */
import { useEffect, useMemo, useRef } from 'react'
import { FastForward, Share2, SkipForward } from 'lucide-react'
import { useApp, navigate } from '@/store/app'
import { useImmersive } from '@/store/immersive'
import { Button, useReducedMotion } from '@/ui/primitives'
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
  const rm = useReducedMotion()

  // a Central não muda de rota a cada ação: quando o "Agora" troca (novo item, nova decisão) e a página
  // ficou rolada abaixo dele (celular), sobe até o card novo — o título não fica fora da tela
  const nowRef = useRef<HTMLDivElement>(null)
  const nowKey = s.pendingDecision?.id ?? it?.id ?? ''
  const lastKey = useRef(nowKey)
  useEffect(() => {
    if (lastKey.current === nowKey) return
    lastKey.current = nowKey
    const el = nowRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (top < 0) window.scrollTo({ top: Math.max(0, window.scrollY + top - 12), behavior: rm ? 'auto' : 'smooth' })
  }, [nowKey, rm])

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
  // sem clube, "avançar" a janela assinaria por você: a escolha fica no card (Assinar com… / Ver propostas)
  const freeWindow = it?.kind === 'transfer_window' && !s.clubId && s.offers.length > 0
  const canSkip = it && !freeWindow && (it.kind === 'training' || it.kind === 'transfer_window' || it.kind === 'national_callup')
  const toMatch = !!it && it.kind !== 'match' && it.kind !== 'national_match' && it.kind !== 'season_end' && it.kind !== 'awards' && !!nm

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
          {/* tablet e celular: a aba Social já está à mão (menos botões espremendo o título) */}
          <Button variant="ghost" size="md" icon={Share2} onClick={() => navigate('/imersivo', { query: { tela: 'social' } })} className="max-lg:hidden">
            Rede social
          </Button>
          {toMatch && (
            <Button variant="outline" size="md" iconRight={FastForward} loading={busy} onClick={() => void dispatch({ type: 'auto', until: 'next_match' })} title="Treinos no seu último foco, coletivas com respostas humildes; para no jogo e em decisões ou propostas novas">
              <span className="md:hidden">Até o jogo</span>
              <span className="max-md:hidden">Simular até o jogo</span>
            </Button>
          )}
          {canSkip && (
            <Button variant="ghost" size="md" icon={SkipForward} loading={busy} onClick={() => void dispatch({ type: 'advance' })} title="Resolve só o compromisso atual com a opção padrão">
              Avançar
            </Button>
          )}
          {/* no celular não há "title": a diferença entre os dois fica escrita */}
          {(toMatch || canSkip) && (
            <p className="im-hub__hint md:hidden">
              {canSkip && 'Avançar resolve só este compromisso. '}
              {toMatch && 'Até o jogo automatiza treinos e coletivas até a partida.'}
            </p>
          )}
        </div>
      </header>

      <div className="im-hub__grid">
        <div className="im-hub__now" ref={nowRef}>
          {now}
        </div>
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
