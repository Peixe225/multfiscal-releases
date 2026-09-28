/**
 * Coletiva de imprensa: parede de patrocínio, cone de luz, mesa e microfones de veículos
 * fictícios; lower-third "AO VIVO"; medidor de repercussão (crise ↔ ídolo) e pips de progresso;
 * pergunta em lower-third; 4 respostas por tom com dicas de efeito. Sem cronômetro.
 *
 * Ritmo: a resposta escolhida fica em destaque (flashes de câmera, demais esmaecidas) ~1,1 s antes
 * de a próxima pergunta entrar; a manchete aparece num espaço reservado (nada "pula"). No fim, um
 * card de fechamento mostra a repercussão, as manchetes e o que mudou nas relações.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Brain, Megaphone, Mic, MicOff, Newspaper, Smile, Users } from 'lucide-react'
import type { NewsItem, PressQuestion } from '@/engine/immersive/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { getClub } from '@/store/data'
import { Button, Kbd, cx, useReducedMotion } from '@/ui/primitives'
import { LowerThird } from '../bits'
import { OUTLET_SHORT, TONE_CSS, TONE_LABEL, type Tone } from '../model/constants'
import { compInfo, currentItem, surnameOf, teamInfo } from '../model/view'
import { imSfx, keyBlocked } from '../hooks'

const SHIFT: Record<Tone, number> = { humilde: 0.07, confiante: 0.1, provocador: -0.16, evasivo: -0.04 }
const HOLD_MS = 1100

function MicCluster() {
  return (
    <svg viewBox="0 0 320 160" className="im-press__mics" aria-hidden="true">
      <defs>
        <linearGradient id="im-mic-head" x1="0" x2="1">
          <stop offset="0" stopColor="#1A1D29" />
          <stop offset=".45" stopColor="#4A5068" />
          <stop offset="1" stopColor="#0B0D14" />
        </linearGradient>
        <linearGradient id="im-mic-stem" x1="0" x2="1">
          <stop offset="0" stopColor="#0B0D14" />
          <stop offset=".5" stopColor="#2E3244" />
          <stop offset="1" stopColor="#08090E" />
        </linearGradient>
      </defs>
      {[
        { rot: -14, cx: 90, fill: 'var(--accent)', ink: '#06103A', t: 'LTV', y: 34 },
        { rot: 0, cx: 160, fill: 'var(--lx-live, #FF2E55)', ink: '#fff', t: 'ARQ', y: 28 },
        { rot: 13, cx: 230, fill: 'var(--lx-gold, #F7C948)', ink: '#241400', t: 'C10', y: 36 },
      ].map((m) => (
        <g key={m.t} transform={`rotate(${m.rot} ${m.cx} 150)`}>
          <rect x={m.cx - 6} y={m.y + 26} width="12" height="100" fill="url(#im-mic-stem)" />
          <rect x={m.cx - 21} y={m.y + 18} width="42" height="30" style={{ fill: m.fill }} />
          <text x={m.cx} y={m.y + 39} textAnchor="middle" fontFamily="var(--font-display)" fontWeight="800" fontStyle="italic" fontSize="15" fill={m.ink}>
            {m.t}
          </text>
          <ellipse cx={m.cx} cy={m.y} rx="17" ry="22" fill="url(#im-mic-head)" />
        </g>
      ))}
    </svg>
  )
}

const REL: { key: 'fans' | 'media' | 'coach' | 'teammates'; label: string; icon: typeof Users }[] = [
  { key: 'fans', label: 'Torcida', icon: Megaphone },
  { key: 'media', label: 'Imprensa', icon: Mic },
  { key: 'coach', label: 'Técnico', icon: Brain },
  { key: 'teammates', label: 'Vestiário', icon: Users },
]

export default function PressConference({ onDone }: { onDone?: () => void }) {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const rm = useReducedMotion()
  const press = s.press ?? []
  const total = useRef(Math.max(press.length, 1))
  // retrato no começo da coletiva (para o card de fechamento)
  const start = useRef({ rel: { ...s.relationships }, morale: s.condition.morale, item: currentItem(s) })
  const [gauge, setGauge] = useState(0.55)
  const [chosen, setChosen] = useState<{ q: string; a: string } | null>(null)
  const [flashes, setFlashes] = useState<{ id: number; x: number; y: number; d: number }[]>([])
  const [headline, setHeadline] = useState<string | null>(null)
  const [heads, setHeads] = useState<NewsItem[]>([])
  const [skipped, setSkipped] = useState(false)
  const timers = useRef<number[]>([])
  const q: PressQuestion | undefined = press[0]
  const it = start.current.item
  const club = getClub(s.clubId)
  const done = total.current - press.length
  const ended = !q

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffectStream((e) => {
    if (e.type === 'news') {
      setHeadline(e.item.headline)
      setHeads((h) => (h.some((x) => x.headline === e.item.headline) ? h : [...h, e.item]))
    }
  })
  useEffect(() => {
    if (!headline) return
    const t = setTimeout(() => setHeadline(null), 3600)
    return () => clearTimeout(t)
  }, [headline])
  // a pergunta nova entra: a resposta anterior sai de cena
  useEffect(() => setChosen(null), [q?.id])
  // pulada/encerrada sem responder: volta direto (o toast do motor informa a punição)
  useEffect(() => {
    if (ended && skipped) onDone?.()
  }, [ended, skipped, onDone])

  const answer = (a: PressQuestion['answers'][number]) => {
    if (!q || chosen || busy) return
    setChosen({ q: q.id, a: a.id })
    setGauge((g) => Math.max(0.04, Math.min(0.96, g + SHIFT[a.tone])))
    imSfx.play('click')
    if (!rm) {
      let seed = 7 + done * 13
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const list = Array.from({ length: 7 }, (_, i) => ({ id: Date.now() + i, x: 4 + rnd() * 92, y: 6 + rnd() * 62, d: i * 70 + rnd() * 60 }))
      for (const f of list) timers.current.push(window.setTimeout(() => setFlashes((x) => [...x, f]), f.d))
      timers.current.push(window.setTimeout(() => setFlashes([]), 900))
    }
    const qid = q.id
    timers.current.push(window.setTimeout(() => void dispatch({ type: 'press_answer', questionId: qid, answerId: a.id }), rm ? 350 : HOLD_MS))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!q || !(n >= 1 && n <= q.answers.length) || keyBlocked(e)) return
      e.preventDefault()
      answer(q.answers[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const opp = it?.opponentId ? teamInfo(it.opponentId) : null
  const comp = it?.competitionId ? compInfo(it.competitionId) : null
  const ltKicker = `Coletiva · ${opp ? 'pré-jogo' : 'entrevista'}${comp ? ` · ${comp.short}` : ''}`
  const ltValue = opp && club ? `${club.shortName} × ${opp.short}` : club ? `${surnameOf(s)} · ${club.shortName}` : 'Sala de imprensa'
  const initials = q ? OUTLET_SHORT[q.outlet] ?? q.outlet.slice(0, 3).toUpperCase() : ''
  const mood = gauge >= 0.66 ? 'Ídolo' : gauge <= 0.34 ? 'Crise' : 'Neutro'
  return (
    <main id="conteudo" tabIndex={-1} className={cx('im-press outline-none', ended && 'is-ended')}>
      <div className="lx-press-wall im-press__wall" aria-hidden="true" />
      <div className="im-press__spot" aria-hidden="true" />
      {flashes.map((f) => (
        <span key={f.id} className="lx-camera-flash im-flash" style={{ left: `${f.x}%`, top: `${f.y}%` }} aria-hidden="true" />
      ))}
      <div className="im-press__top">
        <div className="lx-lt lx-lt--live">
          <div className="lx-lt__a im-press__live">AO VIVO</div>
          <div className="lx-lt__b">
            <span className="lx-lt__k">{ltKicker}</span>
            <span className="lx-lt__v">{ltValue}</span>
          </div>
        </div>
        <div className="lx-plate lx-plate--flat lx-c-sm im-gauge" style={{ ['--lx-v' as string]: gauge }}>
          <div className="flex justify-between items-center gap-3">
            <span className="lx-kicker">Repercussão</span>
            <span className="im-gauge__pips" aria-label={`Pergunta ${Math.min(done + 1, total.current)} de ${total.current}`}>
              {Array.from({ length: total.current }).map((_, i) => (
                <i key={i} className={i < done ? 'is-done' : i === done && !ended ? 'is-on' : ended ? 'is-done' : undefined} />
              ))}
            </span>
          </div>
          <div className="im-gauge__bar" aria-hidden="true">
            <span className="im-gauge__needle" />
          </div>
          <div className="im-gauge__ends">
            <span className="lx-label is-neg">Crise</span>
            <span className="lx-label">Neutro</span>
            <span className="lx-label is-pos">Ídolo</span>
          </div>
        </div>
        <span className="im-gauge__pip" aria-hidden="true" data-mood={mood}>
          {mood} · {Math.min(done + (ended ? 0 : 1), total.current)}/{total.current}
        </span>
      </div>

      <div className="im-press__stage" aria-hidden="true">
        <div className="im-press__hl-slot">
          {headline && !ended && (
            <div className="im-press__headline lx-anim-wipe" key={headline}>
              <LowerThird k="Manchete" v={headline} tone="accent">
                <span className="im-press__hl-ic">!</span>
              </LowerThird>
            </div>
          )}
        </div>
        <MicCluster />
        <div className="im-press__table">
          <span className="lx-chip im-press__name">
            {s.identity.surname} · {club?.shortName ?? ''}
          </span>
        </div>
      </div>

      <div className="im-press__bottom">
        {q ? (
          <>
            <div className={cx('im-press__q', chosen ? 'is-answered' : 'lx-anim-rise')} key={q.id}>
              <div className="lx-lt lx-lt--accent">
                <div className="lx-lt__a im-press__outlet">
                  {initials}
                  <small>{q.outlet.split(' ')[0]}</small>
                </div>
                <div className="lx-lt__b">
                  <span className="lx-lt__k">
                    {q.journalist} · {q.outlet}
                  </span>
                  <span className="im-press__qt">“{q.question.replace(/^["“]|["”]$/g, '')}”</span>
                </div>
              </div>
            </div>
            <div className={cx('lx-options im-press__answers', chosen && 'has-choice')} role="group" aria-label="Respostas" key={`a-${q.id}`}>
              {q.answers.map((a, i) => (
                <button key={a.id} type="button" className={cx('lx-option im-ans', !chosen && 'lx-anim-rise', chosen?.a === a.id && 'is-picked')} style={{ ['--i' as string]: i + 1 }} aria-pressed={chosen?.a === a.id} aria-keyshortcuts={String(i + 1)} disabled={!!chosen || busy} onClick={() => answer(a)}>
                  <span className="im-ans__top">
                    <span className="lx-tone" data-tone={TONE_CSS[a.tone]}>
                      {TONE_LABEL[a.tone] === 'Provocador' ? 'Polêmico' : TONE_LABEL[a.tone]}
                    </span>
                    <span className="lx-option__key">{i + 1}</span>
                  </span>
                  <blockquote className="im-ans__q">{a.label}</blockquote>
                  <span className="im-ans__fx">
                    {a.effects.map((fx) => (
                      <span key={fx} className={cx('lx-chip lx-chip--sm', /−|-|▼/.test(fx) ? 'lx-chip--neg' : /▲|\+/.test(fx) ? 'lx-chip--pos-ok' : undefined)}>
                        {fx}
                      </span>
                    ))}
                  </span>
                  {chosen?.a === a.id && <span className="im-ans__said">Resposta dada</span>}
                </button>
              ))}
            </div>
            <div className="im-press__foot">
              <span className="lx-t-small">
                <span className="im-kbd-hint">
                  Teclas <Kbd>1</Kbd>–<Kbd>{q.answers.length}</Kbd> ·{' '}
                </span>
                sem cronômetro
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={MicOff}
                onClick={() => {
                  setSkipped(true)
                  void dispatch({ type: 'press_skip' })
                }}
                disabled={busy || !!chosen}
                title={chosen ? 'Aguarde a próxima pergunta' : 'Sair da coletiva (Mídia −)'}
              >
                Encerrar coletiva
              </Button>
            </div>
          </>
        ) : (
          !skipped && <PressRecap gauge={gauge} mood={mood} heads={heads} before={start.current} onDone={() => onDone?.()} />
        )}
      </div>
    </main>
  )
}

/** Card de fechamento: repercussão final, manchetes do dia e o que mudou. */
function PressRecap({ gauge, mood, heads, before, onDone }: { gauge: number; mood: string; heads: NewsItem[]; before: { rel: { fans: number; media: number; coach: number; teammates: number }; morale: number }; onDone: () => void }) {
  const s = useImmersive((x) => x.state)!
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    btn.current?.focus({ preventScroll: true })
  }, [])
  const deltas = REL.map((r) => ({ ...r, d: Math.round(s.relationships[r.key] - before.rel[r.key]) })).concat([{ key: 'morale' as never, label: 'Moral', icon: Smile, d: Math.round(s.condition.morale - before.morale) }])
  const news = heads.length ? heads : s.news.filter((n) => n.week === s.week && n.season === s.season).slice(0, 3)
  return (
    <section className="lx-plate lx-c-lg im-press__recap lx-anim-rise" aria-labelledby="im-recap-t" role="status">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-recap__head">
        <div>
          <span className="lx-kicker">Coletiva encerrada</span>
          <h2 className="lx-t-sec im-recap__t" id="im-recap-t">
            Repercussão: <span className={cx(mood === 'Ídolo' ? 'text-positive' : mood === 'Crise' ? 'text-negative' : 'text-text-2')}>{mood}</span>
          </h2>
        </div>
        <span className="im-recap__gauge" style={{ ['--lx-v' as string]: gauge }} aria-hidden="true">
          <i />
        </span>
      </div>
      <div className="im-recap__grid">
        <ul className="im-recap__news">
          {news.slice(0, 3).map((n) => (
            <li key={n.id} data-tone={n.tone}>
              <Newspaper size={14} aria-hidden="true" />
              <span>
                <small>{n.outlet}</small>
                {n.headline}
              </span>
            </li>
          ))}
          {!news.length && <li className="lx-t-small">Sem manchetes fortes: a coletiva passou sem polêmica.</li>}
        </ul>
        <div className="im-recap__deltas">
          {deltas.map((d) => (
            <span key={d.label} className={cx('lx-fx lx-fx--sm', d.d > 0 ? 'lx-fx--up' : d.d < 0 ? 'lx-fx--down' : 'lx-fx--neu')}>
              <span className="lx-fx__ic">
                <d.icon size={14} aria-hidden="true" />
              </span>
              {d.label}
              <span className="lx-fx__p num">{d.d > 0 ? `+${d.d}` : d.d < 0 ? `−${Math.abs(d.d)}` : '='}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button ref={btn} variant="primary" size="lg" iconRight={ArrowRight} onClick={onDone}>
          Voltar à Central
        </Button>
      </div>
    </section>
  )
}
