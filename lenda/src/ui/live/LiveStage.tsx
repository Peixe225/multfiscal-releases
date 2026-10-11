/**
 * Palco da live (#/live?tela=palco): disputa (quem doar mais cria a lenda), criação pelo vencedor com
 * comandos no chat, votação grande do que faltar (posição, nacionalidade) e o anúncio "Nasce uma lenda"
 * (com o ritmo da carreira — no automático, o que o movimento da sala escolheu). Ao lado, os maiores
 * apoiadores e o recorde do dia (ranking da live).
 */
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Crown, Dices, Gauge, Gift, Mic, Pause, PenLine, Play, Radio } from 'lucide-react'
import { navigate } from '@/store/app'
import { newLegendNow } from '@/live/autopilot'
import { lockHolder, sendLiveCommand } from '@/live/channel'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { POSITION_NAMES } from '@/engine/career/util'
import { useCountry } from '@/store/data'
import { topBids, topSupporters, useLive, type Creation } from '@/live/store'
import { percents } from '@/live/votes'
import { Button, Flag, cx } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { Countdown, GiftIcon, OPTION_COLORS, coinsLabel, howToVote, useNow, useSafeArea, useSafePortrait } from './bits'
import { PAUSED_HOW, outcomeWhy, resultKicker } from './LiveHud'
import { DayRecordLine } from './LiveRanking'

/** Cabeçalho da disputa/criação no palco; em pausa vira "… pausada", em amarelo. */
function Kicker({ paused, pausedText, icon, children }: { paused: boolean; pausedText: string; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={cx('lv-stage__k', paused && 'is-paused')}>
      {paused ? <Pause size={14} aria-hidden="true" /> : icon} {paused ? pausedText : children}
    </span>
  )
}

function StageVote() {
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const bindings = useLiveConfig((s) => s.config.giftBindings)
  const paused = useLiveSession((s) => s.paused)
  const r = round ?? result?.round ?? null
  if (!r) return null
  const pct = percents(r)
  const winner = !round && result ? result.outcome.winner : null
  const fate = !round && result?.outcome.reason === 'no-votes'
  return (
    <div className="lv-stage__vote">
      {round && paused ? (
        <span className="lv-stage__k is-paused">
          <Pause size={14} aria-hidden="true" /> Votação pausada
        </span>
      ) : fate ? (
        <span className="lv-stage__k">
          <Dices size={14} aria-hidden="true" /> O destino escolheu
        </span>
      ) : !round && result?.outcome.streamer ? (
        <span className="lv-stage__k">
          <Mic size={14} aria-hidden="true" /> {resultKicker(result.outcome)}
        </span>
      ) : (
        <span className="lv-stage__k">
          <span className="lv-dot-live" aria-hidden="true" /> {round ? 'Votação do chat' : 'O chat decidiu'}
        </span>
      )}
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
      {round ? (
        <p className={cx('lv-stage__how', paused && 'is-paused')}>{paused ? PAUSED_HOW : howToVote(r.options.length)}</p>
      ) : (
        result && <p className="lv-stage__how is-why">{outcomeWhy(result.round, result.outcome)}</p>
      )}
    </div>
  )
}

function Bidding({ c }: { c: Creation }) {
  const paused = useLiveSession((s) => s.paused)
  const min = useLiveConfig((s) => s.config.minBidCoins)
  const identityVote = useLiveConfig((s) => s.config.identityVote)
  // janela em pé: top 3 (o 4º e o 5º ficariam por baixo do chat do TikTok)
  const compact = useSafePortrait()
  const bids = topBids(c, compact ? 3 : 5)
  // sala vazia: sem lance nenhum, a disputa acaba em quietAt — o anel conta até lá (é quando ela fecha de
  // fato) e a tela avisa o que vem depois (honesto e dá pressa). Chegou um lance, o anel volta para o fim normal.
  const quiet = c.quietAt != null && c.quietAt < c.endsAt && !bids.length
  const ringEnd = quiet && c.quietAt != null ? c.quietAt : c.endsAt
  const now = useNow(quiet, 500)
  const quietIn = quiet && !paused ? Math.max(0, Math.ceil((ringEnd - now) / 1000)) : null
  return (
    <div className="lv-stage__vote lv-bid">
      <div className="lv-create__top">
        <Kicker paused={paused} pausedText="Disputa pausada" icon={<Gift size={14} aria-hidden="true" />}>
          Disputa pela criação
        </Kicker>
        <Countdown endsAt={ringEnd} total={ringEnd - c.startedAt} size={54} paused={paused} />
      </div>
      <h1 className="lv-stage__t">Quem doar mais agora cria a próxima lenda!</h1>
      <p className={cx('lv-stage__how', paused && 'is-paused')}>
        {paused ? 'O streamer pausou — a disputa volta já (os presentes continuam valendo).' : `Qualquer presente vale${min > 1 ? ` (mínimo ${coinsLabel(min)})` : ''}. O vencedor escolhe nome, nacionalidade e posição do jogador.`}
      </p>
      {bids.length ? (
        <ol className="lv-bids">
          {bids.map((b, i) => (
            <li key={b.user.id} className={cx(i === 0 && 'is-top')}>
              {i === 0 ? <Crown size={18} aria-hidden="true" /> : <span className="lv-pod__n">{i + 1}</span>}
              <span className="lv-pod__name">{b.user.name}</span>
              <span className="lv-bids__c tabular-nums">{coinsLabel(b.coins)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lv-stage__empty lv-bids__empty">
          Ninguém doou ainda. Seja o primeiro!
          {/* com a votação de identidade, sem lance o chat escolhe posição e país antes de a lenda nascer */}
          {quietIn != null && quietIn > 0 && <span className="lv-bids__quiet"> {identityVote ? `Sem lances, em ${quietIn} s o chat escolhe a lenda.` : `Sem lances, a disputa fecha em ${quietIn} s.`}</span>}
        </p>
      )}
      {/* o recorde do dia fica no cartão da disputa (e não só no pódio, que na janela em pé fica por baixo do
          chat do TikTok): é a hora de "crie a lenda que bate o recorde" */}
      <DayRecordLine />
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
  const identityVote = useLiveConfig((s) => s.config.identityVote)
  const country = useCountry(c.draft.nationality ?? null)
  const now = useNow(c.readyAt != null, 250)
  const d = c.draft
  const readyIn = c.readyAt != null ? Math.max(0, Math.ceil((c.readyAt - now) / 1000)) : null
  // retorno do último comando ("País: Argentina ✓", "Esse nome não pode…"); a contagem tem a sua própria linha
  const fb = (c.feedback ?? '').replace(/\s*·?\s*Ficha completa:.*$/, '').trim()
  return (
    <div className="lv-stage__vote lv-create">
      <div className="lv-create__top">
        <Kicker paused={paused} pausedText="Criação pausada" icon={<PenLine size={14} aria-hidden="true" />}>
          Criação da lenda
        </Kicker>
        <Countdown endsAt={c.endsAt} total={c.endsAt - c.startedAt} size={54} paused={paused} />
      </div>
      <h1 className="lv-stage__t">
        <Crown size={26} aria-hidden="true" className="lv-create__crown" /> {c.winner?.user.name ?? 'O vencedor'} está criando a lenda
      </h1>
      <p className={cx('lv-stage__how', paused && 'is-paused')}>
        {paused ? (
          'O streamer pausou — a criação volta já.'
        ) : (
          <>
            Só as mensagens de <b>@{c.winner?.user.id}</b> contam. Digite no chat os comandos abaixo (nome com até 15 letras), ou tudo de uma vez: <code>!criar Nome, País, Posição</code>
          </>
        )}
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
      {fb && <p className={cx('lv-create__fb', /não|falta|Escreva|Tudo de uma vez/i.test(fb) && 'is-warn')}>{fb}</p>}
      {readyIn != null && !paused && (
        <p className="lv-create__fb is-ready">
          Ficha completa! A lenda nasce em {readyIn} s — dá para corrigir, ou digite <code>!ok</code> para começar já.
        </p>
      )}
      <p className="lv-stage__empty">
        {identityVote ? 'O que faltar quando o tempo acabar, o chat decide na votação' : 'O que faltar quando o tempo acabar, o jogo completa'} (sem nome, vale o apelido de quem criou).
      </p>
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
          {a.badge && (
            <span className="lv-announce__pace">
              <Gauge size={15} aria-hidden="true" /> {a.badge}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Podium() {
  const supporters = useLive((s) => s.supporters)
  // na disputa o recorde do dia já está no cartão dela
  const bidding = useLive((s) => s.creation?.phase === 'bidding')
  const nameMode = useLiveConfig((s) => s.config.nameMode)
  const creator = useLiveConfig((s) => s.config.creator)
  // com as chamadas ligadas, "quem doar mais cria a próxima lenda" já gira na faixa: o pódio não repete
  const ctaOn = useLiveConfig((s) => s.config.ctaOn)
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
              <span className="lv-pod__c tabular-nums">{coinsLabel(s.coins)}</span>
            </li>
          ))}
        </ol>
      ) : (
        // sala vazia: convite, não lamento — o primeiro presente já põe a pessoa no pódio da live
        <p className="lv-stage__empty">Mande o primeiro presente e entre no pódio da live!</p>
      )}
      {ctaOn ? null : creator === 'disputa' ? (
        <p className="lv-stage__hint">Na disputa, quem doar mais cria a próxima lenda: nome, país e posição!</p>
      ) : creator === 'apoiador' ? (
        <p className="lv-stage__hint">Quem mais doar na carreira cria a próxima lenda!</p>
      ) : (
        nameMode === 'apoiador' && <p className="lv-stage__hint">O maior apoiador dá o nome para a próxima lenda!</p>
      )}
      {!bidding && <DayRecordLine />}
    </aside>
  )
}

/** Rótulo do botão do palco parado: o que ele abre de fato. */
const START_LABEL = { disputa: 'Abrir a disputa', apoiador: 'Começar a nova lenda', votacao: 'Começar a votação' } as const

export function LiveStage() {
  const on = useLiveSession((s) => s.on)
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const announce = useLive((s) => s.announce)
  const creation = useLive((s) => s.creation)
  const stage = useLive((s) => s.stage)
  const creator = useLiveConfig((s) => s.config.creator)
  const idle = !round && !announce && !result && !creation && stage !== 'identity'
  useSafeArea()
  // a live roda em outra janela: o botão manda o comando para lá (aqui o autopiloto não roda)
  const begin = () => (lockHolder() ? sendLiveCommand('new-legend') : newLegendNow())
  return (
    <main id="conteudo" className="lv-stage" tabIndex={-1}>
      <div className="lv-stage__card lx-glass lx-top-light">
        {announce ? <Announce /> : creation?.phase === 'bidding' ? <Bidding c={creation} /> : creation?.phase === 'creating' ? <Creating c={creation} /> : round || result ? <StageVote /> : null}
        {idle && (
          <div className="lv-stage__idle">
            <Radio size={28} aria-hidden="true" />
            <h1 className="lv-stage__t">{on ? 'Preparando a próxima lenda…' : 'O modo live está desligado'}</h1>
            {on ? (
              <Button variant="primary" size="lg" icon={Play} onClick={begin}>
                {START_LABEL[creator]}
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
