/**
 * Coletiva de imprensa: parede de patrocínio, cone de luz, mesa e microfones de veículos
 * fictícios; lower-third "AO VIVO"; medidor de repercussão (crise ↔ ídolo) e pips de progresso;
 * pergunta em lower-third; 4 respostas por tom com dicas de efeito. Sem cronômetro.
 */
import { useEffect, useRef, useState } from 'react'
import { MicOff } from 'lucide-react'
import type { PressQuestion } from '@/engine/immersive/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { getClub } from '@/store/data'
import { Button, cx, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { LowerThird } from '../bits'
import { OUTLET_SHORT, TONE_CSS, TONE_LABEL, type Tone } from '../model/constants'
import { currentItem } from '../model/view'

const SHIFT: Record<Tone, number> = { humilde: 0.07, confiante: 0.1, provocador: -0.16, evasivo: -0.04 }

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

export default function PressConference() {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const rm = useReducedMotion()
  const press = s.press ?? []
  const total = useRef(Math.max(press.length, 1))
  const [gauge, setGauge] = useState(0.55)
  const [chosen, setChosen] = useState<string | null>(null)
  const [flashes, setFlashes] = useState<{ id: number; x: number; y: number }[]>([])
  const [headline, setHeadline] = useState<string | null>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const q: PressQuestion | undefined = press[0]
  const it = currentItem(s)
  const club = getClub(s.clubId)
  const done = total.current - press.length

  useEffectStream((e) => {
    if (e.type === 'news') setHeadline(e.item.headline)
  })
  useEffect(() => {
    if (!headline) return
    const t = setTimeout(() => setHeadline(null), 4200)
    return () => clearTimeout(t)
  }, [headline])
  useEffect(() => setChosen(null), [q?.id])

  const answer = (a: PressQuestion['answers'][number]) => {
    if (!q || chosen) return
    setChosen(a.id)
    setGauge((g) => Math.max(0.04, Math.min(0.96, g + SHIFT[a.tone])))
    sfx.play('click')
    if (!rm) {
      let seed = 3 + done
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const list = Array.from({ length: 5 }, (_, i) => ({ id: Date.now() + i, x: 8 + rnd() * 84, y: 12 + rnd() * 40 }))
      list.forEach((f, i) => setTimeout(() => setFlashes((x) => [...x, f]), i * 90 + rnd() * 60))
      setTimeout(() => setFlashes([]), 900)
    }
    setTimeout(() => void dispatch({ type: 'press_answer', questionId: q.id, answerId: a.id }), rm ? 200 : 900)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (q && n >= 1 && n <= q.answers.length) answer(q.answers[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const initials = q ? OUTLET_SHORT[q.outlet] ?? q.outlet.slice(0, 3).toUpperCase() : ''
  return (
    <main id="conteudo" tabIndex={-1} className="im-press outline-none" ref={sceneRef}>
      <div className="lx-press-wall im-press__wall" aria-hidden="true" />
      <div className="im-press__spot" aria-hidden="true" />
      {flashes.map((f) => (
        <span key={f.id} className="lx-camera-flash" style={{ left: `${f.x}%`, top: `${f.y}%` }} aria-hidden="true" />
      ))}
      <div className="im-press__top">
        <div className="lx-lt lx-lt--live">
          <div className="lx-lt__a im-press__live">AO VIVO</div>
          <div className="lx-lt__b">
            <span className="lx-lt__k">Coletiva · {it?.kind === 'press' ? 'pré-jogo' : 'entrevista'}</span>
            <span className="lx-lt__v">{it?.title ?? 'Sala de imprensa'}</span>
          </div>
        </div>
        <div className="lx-plate lx-plate--flat lx-c-sm im-gauge" style={{ ['--lx-v' as string]: gauge }}>
          <div className="flex justify-between items-center gap-3">
            <span className="lx-kicker">Repercussão</span>
            <span className="im-gauge__pips" aria-label={`Pergunta ${Math.min(done + 1, total.current)} de ${total.current}`}>
              {Array.from({ length: total.current }).map((_, i) => (
                <i key={i} className={i < done ? 'is-done' : i === done ? 'is-on' : undefined} />
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
      </div>

      <div className="im-press__stage" aria-hidden="true">
        <MicCluster />
        <div className="im-press__table">
          <span className="lx-chip im-press__name">
            {s.identity.surname} · {club?.shortName ?? ''}
          </span>
        </div>
      </div>

      <div className="im-press__bottom">
        {headline && (
          <div className="im-press__headline lx-anim-wipe" role="status">
            <LowerThird k="Manchete" v={headline} tone="accent">
              <span className="im-press__hl-ic">!</span>
            </LowerThird>
          </div>
        )}
        {q ? (
          <>
            <div className="im-press__q lx-anim-rise" key={q.id}>
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
            <div className={cx('lx-options im-press__answers', chosen && 'has-choice')} role="group" aria-label="Respostas">
              {q.answers.map((a, i) => (
                <button key={a.id} type="button" className="lx-option lx-anim-rise im-ans" style={{ ['--i' as string]: i + 1 }} aria-pressed={chosen === a.id} aria-keyshortcuts={String(i + 1)} disabled={!!chosen || busy} onClick={() => answer(a)}>
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
                </button>
              ))}
            </div>
            <div className="im-press__foot">
              <span className="lx-t-small">Teclas 1–{q.answers.length} · sem cronômetro</span>
              <Button variant="ghost" size="sm" icon={MicOff} onClick={() => void dispatch({ type: 'press_skip' })} disabled={busy}>
                Encerrar coletiva
              </Button>
            </div>
          </>
        ) : (
          <p className="lx-t-body">Coletiva encerrada.</p>
        )}
      </div>
    </main>
  )
}
