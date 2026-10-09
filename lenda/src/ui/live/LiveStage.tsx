/**
 * Palco da live (#/live?tela=palco): disputa (quem doar mais cria a lenda), criação pelo vencedor com
 * comandos no chat, votação grande do que faltar (posição, nacionalidade) e o anúncio "Nasce uma lenda".
 */
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Crown, Gift, PenLine, Play, Radio } from 'lucide-react'
import { navigate } from '@/store/app'
import { newLegendNow } from '@/live/autopilot'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { POSITION_NAMES } from '@/engine/career/util'
import { useCountry } from '@/store/data'
import { topBids, topSupporters, useLive, type Creation } from '@/live/store'
import { percents } from '@/live/votes'
import { Button, Flag, cx } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { Countdown, GiftIcon, OPTION_COLORS, fmtCoins, howToVote } from './bits'

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

function Bidding({ c }: { c: Creation }) {
  const paused = useLiveSession((s) => s.paused)
  const min = useLiveConfig((s) => s.config.minBidCoins)
  const bids = topBids(c, 5)
  return (
    <div className="lv-stage__vote lv-bid">
      <div className="lv-create__top">
        <span className="lv-stage__k">
          <Gift size={14} aria-hidden="true" /> Disputa pela criação
        </span>
        <Countdown endsAt={c.endsAt} total={c.endsAt - c.startedAt} size={54} paused={paused} />
      </div>
      <h1 className="lv-stage__t">Quem doar mais agora cria a próxima lenda!</h1>
      <p className="lv-stage__how">Qualquer presente vale{min > 1 ? ` (mínimo ${min} moedas)` : ''}. O vencedor escolhe nome, nacionalidade e posição do jogador.</p>
      {bids.length ? (
        <ol className="lv-bids">
          {bids.map((b, i) => (
            <li key={b.user.id} className={cx(i === 0 && 'is-top')}>
              {i === 0 ? <Crown size={18} aria-hidden="true" /> : <span className="lv-pod__n">{i + 1}</span>}
              <span className="lv-pod__name">{b.user.name}</span>
              <span className="lv-bids__c tabular-nums">{fmtCoins(b.coins)} moedas</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lv-stage__empty lv-bids__empty">Ninguém doou ainda. Seja o primeiro!</p>
      )}
    </div>
  )
}

function DraftRow({ label, value, hint, done }: { label: string; value?: ReactNode; hint: string; done: boolean }) {
  return (
    <li className={cx('lv-draft__row', done && 'is-done')}>
      <span className="lv-draft__l">{label}</span>
      <span className="lv-draft__v">{done ? value : <span className="lv-draft__wait">aguardando…</span>}</span>
      {done ? <Check size={18} aria-hidden="true" className="lv-draft__ok" /> : <code className="lv-draft__cmd">{hint}</code>}
    </li>
  )
}

function Creating({ c }: { c: Creation }) {
  const paused = useLiveSession((s) => s.paused)
  const country = useCountry(c.draft.nationality ?? null)
  const d = c.draft
  return (
    <div className="lv-stage__vote lv-create">
      <div className="lv-create__top">
        <span className="lv-stage__k">
          <PenLine size={14} aria-hidden="true" /> Criação da lenda
        </span>
        <Countdown endsAt={c.endsAt} total={c.endsAt - c.startedAt} size={54} paused={paused} />
      </div>
      <h1 className="lv-stage__t">
        <Crown size={26} aria-hidden="true" className="lv-create__crown" /> {c.winner?.user.name ?? 'O vencedor'} está criando a lenda
      </h1>
      <p className="lv-stage__how">
        Só as mensagens de <b>@{c.winner?.user.id}</b> contam. Digite no chat os comandos abaixo, ou tudo de uma vez: <code>!criar Nome, País, Posição</code>
      </p>
      <ul className="lv-draft">
        <DraftRow label="Nome" done={!!d.surname} value={<b className="lv-draft__name">{d.surname}</b>} hint="!nome SEUNOME" />
        <DraftRow
          label="Nacionalidade"
          done={!!d.nationality}
          value={
            <>
              <Flag code={d.nationality} h={18} decorative /> {country?.name ?? d.nationality}
            </>
          }
          hint="!pais Brasil"
        />
        <DraftRow label="Posição" done={!!d.position} value={d.position ? POSITION_NAMES[d.position] : ''} hint="!posicao atacante" />
      </ul>
      {c.feedback && <p className="lv-create__fb">{c.feedback}</p>}
      <p className="lv-stage__empty">O que não for escolhido a tempo, o chat decide na votação.</p>
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
  const creator = useLiveConfig((s) => s.config.creator)
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
      {creator === 'disputa' ? (
        <p className="lv-stage__hint">Na disputa, quem doar mais cria a próxima lenda: nome, país e posição!</p>
      ) : creator === 'apoiador' ? (
        <p className="lv-stage__hint">Quem mais doar na carreira cria a próxima lenda!</p>
      ) : (
        nameMode === 'apoiador' && <p className="lv-stage__hint">O maior apoiador dá o nome para a próxima lenda!</p>
      )}
    </aside>
  )
}

export function LiveStage() {
  const on = useLiveSession((s) => s.on)
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const announce = useLive((s) => s.announce)
  const creation = useLive((s) => s.creation)
  const stage = useLive((s) => s.stage)
  const idle = !round && !announce && !result && !creation && stage !== 'identity'
  return (
    <main id="conteudo" className="lv-stage" tabIndex={-1}>
      <div className="lv-stage__card lx-glass lx-top-light">
        {announce ? <Announce /> : creation?.phase === 'bidding' ? <Bidding c={creation} /> : creation?.phase === 'creating' ? <Creating c={creation} /> : round || result ? <StageVote /> : null}
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
