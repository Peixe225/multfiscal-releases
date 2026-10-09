/**
 * Palco da live (#/live?tela=palco): votação grande para criar a próxima lenda (posição, nacionalidade)
 * e o anúncio "Nasce uma lenda" com o nome do maior apoiador.
 */
import { AnimatePresence, motion } from 'motion/react'
import { Crown, Play, Radio } from 'lucide-react'
import { navigate } from '@/store/app'
import { newLegendNow } from '@/live/autopilot'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { topSupporters, useLive } from '@/live/store'
import { percents } from '@/live/votes'
import { Button, cx } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { GiftIcon, OPTION_COLORS, fmtCoins, howToVote } from './bits'

function StageVote() {
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const bindings = useLiveConfig((s) => s.config.giftBindings)
  const r = round ?? result?.round ?? null
  if (!r) return null
  const pct = percents(r)
  const winner = !round && result ? result.outcome.winner : null
  return (
    <div className="lv-stage__vote">
      <span className="lv-stage__k">
        <span className="lv-dot-live" aria-hidden="true" /> {round ? 'Votação do chat' : 'O chat decidiu'}
      </span>
      <h1 className="lv-stage__t">{r.title}</h1>
      <ol className="lv-stage__opts">
        {r.options.map((o, i) => (
          <li key={o.id} className={cx('lv-sopt', winner === i && 'is-won', winner != null && winner !== i && 'is-lost')} style={{ ['--oc' as string]: OPTION_COLORS[i] }}>
            <span className="lv-sopt__fill" style={{ width: `${pct[i]}%` }} aria-hidden="true" />
            <b className="lv-sopt__n">{i + 1}</b>
            {bindings[i] && <GiftIcon name={bindings[i]} size={30} />}
            <span className="lv-sopt__l">{o.label}</span>
            <span className="lv-sopt__p tabular-nums">{pct[i]}%</span>
          </li>
        ))}
      </ol>
      {round && <p className="lv-stage__how">{howToVote(r.options.length)}</p>}
    </div>
  )
}

function Announce() {
  const a = useLive((s) => s.announce)
  const rm = useReducedMotion()
  return (
    <AnimatePresence>
      {a && (
        <motion.div className="lv-announce" initial={rm ? { opacity: 0 } : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <span className="lv-announce__k">{a.kicker}</span>
          <span className="lv-announce__name">{a.title}</span>
          {a.lines.map((l) => (
            <span key={l} className="lv-announce__l">
              {l}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Podium() {
  const supporters = useLive((s) => s.supporters)
  const nameMode = useLiveConfig((s) => s.config.nameMode)
  const top = topSupporters(supporters, 5)
  return (
    <aside className="lv-stage__podium" aria-label="Maiores apoiadores da live">
      <span className="lv-stage__k">
        <Crown size={14} aria-hidden="true" /> Maiores apoiadores
      </span>
      {top.length ? (
        <ol>
          {top.map((s, i) => (
            <li key={s.user.id} className={cx(i === 0 && 'is-top')}>
              <span className="lv-pod__n">{i + 1}</span>
              <span className="lv-pod__name">{s.user.name}</span>
              <span className="lv-pod__c tabular-nums">{fmtCoins(s.coins)} moedas</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lv-stage__empty">Ninguém mandou presente ainda.</p>
      )}
      {nameMode === 'apoiador' && <p className="lv-stage__hint">O maior apoiador dá o nome para a próxima lenda!</p>}
    </aside>
  )
}

export function LiveStage() {
  const on = useLiveSession((s) => s.on)
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const announce = useLive((s) => s.announce)
  const stage = useLive((s) => s.stage)
  const idle = !round && !announce && !result && stage !== 'identity'
  return (
    <main id="conteudo" className="lv-stage" tabIndex={-1}>
      <div className="lv-stage__card lx-glass lx-top-light">
        {announce ? <Announce /> : round || result ? <StageVote /> : null}
        {idle && (
          <div className="lv-stage__idle">
            <Radio size={28} aria-hidden="true" />
            <h1 className="lv-stage__t">{on ? 'Preparando a próxima lenda…' : 'O modo live está desligado'}</h1>
            {on ? (
              <Button variant="primary" size="lg" icon={Play} onClick={() => newLegendNow()}>
                Começar a votação
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => navigate('/live')}>
                Abrir configurações da live
              </Button>
            )}
          </div>
        )}
      </div>
      <Podium />
    </main>
  )
}
