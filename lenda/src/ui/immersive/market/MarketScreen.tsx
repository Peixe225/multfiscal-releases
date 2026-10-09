/**
 * Mercado: propostas na mesa (transferência, empréstimo, renovação) + modal de negociação
 * (salário/duração/papel, teto estimado, paciência da diretoria, chance de aceite, contraproposta
 * → resposta do clube) + contrato atual e estilo de vida.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, BadgeDollarSign, Banknote, Check, CircleSlash, Clock3, Crown, FileSignature, Handshake, Lock, Repeat2, Shirt, ShoppingBag, Sparkles, Star, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { ContractOffer, ImmersiveState } from '@/engine/immersive/types'
import { useApp } from '@/store/app'
import { getClub, getCountry, getLeague } from '@/store/data'
import { useImmersive, type CounterOdds } from '@/store/immersive'
import { Button, Crest, Flag, Modal, clubVars, cx, formatPercent } from '@/ui/primitives'
import { CompLogo, ImDlgTitle, ImSeg, PanelHead } from '../bits'
import { LIFESTYLE_ITEMS } from '../model/constants'
import { ContractStrip } from '../hub/panels'
import { currentItem, fmtMoney, offerScore, yearsLabel } from '../model/view'
import { CloseWindowDialog } from '../hub/NowPanel'

const KIND: Record<ContractOffer['kind'], string> = { transfer: 'Transferência', loan: 'Empréstimo', renewal: 'Renovação', free_agent: 'Sem clube' }
const ROLE_RANK: Record<ContractOffer['role'], number> = { Promessa: 0, Reserva: 1, Rotação: 2, Titular: 3 }
const ROLES: ContractOffer['role'][] = ['Promessa', 'Reserva', 'Rotação', 'Titular']
const MINUTES: Record<ContractOffer['role'], number> = { Titular: 0.85, Rotação: 0.55, Reserva: 0.25, Promessa: 0.15 }

/**
 * Chances da contraproposta: o motor calcula (mesma conta do `offer_respond`); se ele não souber,
 * a UI repete a conta do motor real (interesse × pedido × teto do clube).
 */
function counterOddsUI(s: ImmersiveState, o: ContractOffer, ask: { salary: number; years: number; role: ContractOffer['role'] }): CounterOdds {
  const fromEngine = useImmersive.getState().counterOdds(o.id, ask)
  if (fromEngine) return fromEngine
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const str = (s.world?.clubs?.[o.clubId]?.strength as number | undefined) ?? getClub(o.clubId)?.strength ?? 60
  const interest = clamp(0.55 + (s.ovr - str) * 0.04 + (s.reputation - 30) / 150 + (s.condition.form - 50) / 150 + (o.kind === 'renewal' ? 0.1 : 0), 0.1, 0.95)
  const base = ((s.engine as { offerBase?: Record<string, number> }).offerBase?.[o.id]) ?? o.salary
  const ceiling = base * (1.2 + 0.3 * interest)
  const askSalary = Math.max(o.salary, ask.salary)
  const ratio = askSalary / Math.max(1, o.salary)
  const roleGap = Math.max(0, ROLE_RANK[ask.role] - ROLE_RANK[o.role])
  let accept = clamp(interest * 1.1 - (ratio - 1) * 2.2 - Math.abs(ask.years - o.years) * 0.08 - roleGap * 0.15, 0, 0.95)
  if (askSalary > ceiling) accept = 0
  const improve = o.salary >= ceiling ? 0 : Math.min(1 - accept, 0.4 * Math.max(0, 1 - (ratio - 1) * 2))
  return { accept, improve, walk: Math.max(0, 1 - accept - improve), ceiling, roundsLeft: o.roundsLeft }
}

/** Passo "redondo" (1, 2 ou 5 × 10ⁿ) mais próximo de `v`, no mínimo €1K. */
function niceStep(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(1000, v))))
  const f = Math.max(1000, v) / e
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e
}

/**
 * Rodadas no início da negociação (pips e paciência): o motor guarda na proposta; save antigo sem o
 * campo → a regra do motor (2, ou 3 com superempresário). Sobrevive a recarregar a página.
 */
const roundsOf = (o: ContractOffer, s: ImmersiveState) => Math.max(o.rounds ?? ((s.engine as { superAgent?: boolean } | undefined)?.superAgent ? 3 : 2), o.roundsLeft, 1)

// nota da proposta (destaca a melhor com o único botão dourado): offerScore, em model/view — a mesma
// régua do "Assinar com…" da Central

/** Consequências (com chance) de assinar — princípio "consequência antes da escolha". */
function OfferFx({ o, s }: { o: ContractOffer; s: ImmersiveState }) {
  const c = getClub(o.clubId)
  const str = (s.world?.clubs?.[o.clubId]?.strength as number | undefined) ?? c?.strength ?? 60
  const curPrestige = getClub(s.clubId)?.prestige ?? 0
  const pres = (c?.prestige ?? 0) - curPrestige
  const minutes = MINUTES[o.role]
  const gap = str - s.ovr
  const growth = s.age <= 23 ? (gap >= 0 && gap <= 14 ? Math.min(0.9, minutes + 0.15) : gap > 14 ? minutes * 0.7 : 0.35) : minutes * 0.5
  const sal = s.finance.salary ? o.salary / s.finance.salary - 1 : 0
  return (
    <div className="im-offer__fx">
      <span className={cx('lx-fx lx-fx--sm', minutes >= 0.5 ? 'lx-fx--up' : minutes >= 0.25 ? 'lx-fx--neu' : 'lx-fx--down')}>
        <span className="lx-fx__ic">
          <Shirt size={14} aria-hidden="true" />
        </span>
        Minutos
        <span className="lx-fx__p">{formatPercent(minutes)}</span>
      </span>
      <span className={cx('lx-fx lx-fx--sm', growth >= 0.5 ? 'lx-fx--up' : 'lx-fx--info')}>
        <span className="lx-fx__ic">
          <TrendingUp size={14} aria-hidden="true" />
        </span>
        OVR +
        <span className="lx-fx__p">{formatPercent(growth)}</span>
      </span>
      {pres !== 0 ? (
        <span className={cx('lx-fx lx-fx--sm', pres > 0 ? 'lx-fx--gold' : 'lx-fx--down')}>
          <span className="lx-fx__ic">
            <Star size={14} aria-hidden="true" />
          </span>
          Prestígio {pres > 0 ? '+' : '−'}
          {Math.abs(pres) > 1 ? (pres > 0 ? '+' : '−') : ''}
        </span>
      ) : (
        <span className={cx('lx-fx lx-fx--sm', sal >= 0 ? 'lx-fx--up' : 'lx-fx--down')}>
          <span className="lx-fx__ic">{sal >= 0 ? <Banknote size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}</span>
          Salário
          <span className="lx-fx__p num">{sal >= 0 ? '+' : '−'}{Math.round(Math.abs(sal) * 100)}%</span>
        </span>
      )}
    </div>
  )
}

function OfferCard({ o, s, onNegotiate, i, best }: { o: ContractOffer; s: ImmersiveState; onNegotiate: () => void; i: number; best: boolean }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const c = getClub(o.clubId)
  const lg = c ? getLeague(c.leagueId) : undefined
  const country = c ? getCountry(c.country) : undefined
  const vars = c ? (clubVars(c) as CSSProperties) : undefined
  const left = o.expiresWeek - s.week
  const total = roundsOf(o, s)
  return (
    <article className={cx('lx-plate lx-c-lg im-offer lx-anim-rise', best && 'is-best')} style={{ ...vars, ['--i' as string]: i }}>
      <div className="lx-club-glow" aria-hidden="true" />
      <div className="im-offer__head">
        {c && <Crest club={c} size={58} decorative />}
        <div className="min-w-0">
          <span className="im-offer__chips">
            <span className={cx('lx-chip lx-chip--sm', o.kind === 'renewal' ? 'lx-chip--accent' : 'lx-chip--gold')}>{KIND[o.kind]}</span>
            {best && <span className="lx-chip lx-chip--sm lx-chip--solid-gold">Melhor proposta</span>}
          </span>
          <h3 className="im-offer__club">{c?.name ?? o.clubId}</h3>
          <span className="im-offer__lg">
            {lg && <CompLogo id={lg.id} size={16} />}
            {lg?.shortName}
            {country && (
              <>
                <span aria-hidden="true">·</span>
                <Flag code={country.code} iso2={country.iso2} h={11} w={15} decorative /> {country.code}
              </>
            )}
          </span>
        </div>
        <span className="im-offer__side">
          <span className={cx('im-offer__exp', left <= 1 && 'is-warn')}>
            <Clock3 size={13} aria-hidden="true" /> {left <= 0 ? 'Expira hoje' : `${left} sem.`}
          </span>
          <span className="im-pips" title={`${o.roundsLeft} de ${total} rodadas de negociação`} aria-label={`${o.roundsLeft} de ${total} rodadas de negociação restantes`}>
            {Array.from({ length: total }).map((_, k) => (
              <i key={k} className={k < o.roundsLeft ? 'is-on' : 'is-done'} />
            ))}
          </span>
        </span>
      </div>
      <dl className="im-offer__terms">
        <div>
          <dt>Valor</dt>
          <dd className={cx('num', o.fee && 'lx-hi')}>{o.fee ? fmtMoney(o.fee) : '—'}</dd>
        </div>
        <div>
          <dt>Salário</dt>
          <dd className="num">{fmtMoney(o.salary)}</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd className="num">{yearsLabel(o.years)}</dd>
        </div>
        <div>
          <dt>Papel</dt>
          <dd className={cx(o.role === 'Titular' && 'text-positive')}>{o.role}</dd>
        </div>
        <div>
          <dt>Luvas</dt>
          <dd className="num">{o.signingBonus ? fmtMoney(o.signingBonus) : '—'}</dd>
        </div>
      </dl>
      <OfferFx o={o} s={s} />
      {o.note && <p className="im-offer__note">“{o.note}”</p>}
      <div className="im-offer__foot">
        <Button variant="ghost" size="sm" icon={X} onClick={() => void dispatch({ type: 'offer_respond', offerId: o.id, response: 'reject' })} disabled={busy}>
          Recusar
        </Button>
        <Button variant="outline" size="sm" icon={Handshake} onClick={onNegotiate} disabled={busy || o.roundsLeft <= 0}>
          Negociar
        </Button>
        <Button variant={best ? 'primary' : 'outline'} size="sm" icon={FileSignature} onClick={() => void dispatch({ type: 'offer_respond', offerId: o.id, response: 'accept' })} loading={busy && best}>
          Aceitar
        </Button>
      </div>
    </article>
  )
}

export function Negotiation({ offerId, onClose }: { offerId: string | null; onClose: () => void }) {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const live = s.offers.find((o) => o.id === offerId) ?? null
  const [snap, setSnap] = useState<ContractOffer | null>(live)
  useEffect(() => {
    if (live) setSnap(live)
  }, [live])
  const o = live ?? snap
  const [salary, setSalary] = useState(o?.salary ?? 0)
  const [years, setYears] = useState(o?.years ?? 3)
  const [role, setRole] = useState<ContractOffer['role']>(o?.role ?? 'Rotação')
  const [reply, setReply] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const ended = !!offerId && !live
  useEffect(() => {
    if (ended) closeRef.current?.focus({ preventScroll: true })
  }, [ended])
  // abre com os termos do clube (a contraproposta parte da oferta, nunca abaixo dela)
  useEffect(() => {
    if (!o) return
    setSalary(o.salary)
    setYears(o.years)
    setRole(o.role)
    setReply(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId])
  // proposta melhorada: o slider não fica abaixo do novo valor
  useEffect(() => {
    if (live && salary < live.salary) setSalary(live.salary)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.salary])
  if (!o) return null
  const c = getClub(o.clubId)
  const odds = counterOddsUI(s, o, { salary, years, role })
  // passo de ~5% do salário oferecido (1/2/5 × 10ⁿ, nunca mais fino que o arredondamento do motor):
  // o teto do clube é 1,2–1,5× a oferta
  const step = Math.max(niceStep(o.salary / 20), o.salary >= 10_000_000 ? 1_000_000 : o.salary >= 1_000_000 ? 100_000 : o.salary >= 100_000 ? 10_000 : 1_000)
  const min = o.salary
  const max = Math.max(min + step * 4, Math.ceil((Math.max(odds.ceiling, o.salary) * 1.25) / step) * step)
  const cap = odds.ceiling
  // pedir exatamente os termos do clube = aceitar a proposta (a conta da contraproposta não vale aqui)
  const same = salary === o.salary && years === o.years && role === o.role
  const p = same ? 1 : odds.accept
  const tone = p >= 0.65 ? 'pos' : p >= 0.35 ? 'warn' : 'neg'
  const overTerms = (salary > o.salary ? 1 : 0) + (ROLE_RANK[role] > ROLE_RANK[o.role] ? 1 : 0) + (years !== o.years ? 1 : 0)
  const total = roundsOf(o, s)
  const patience = Math.round((o.roundsLeft / total) * 10)
  const closed = !live
  const loan = o.kind === 'loan'
  const delta = (a: number, b: number, fmt: (n: number) => string) => (a === b ? <span className="lx-chip lx-chip--sm">=</span> : <span className={cx('lx-chip lx-chip--sm', a > b ? 'lx-chip--gold' : 'lx-chip--neg')}>{a > b ? '+' : '−'}{fmt(Math.abs(a - b))}</span>)
  const send = async () => {
    const before = JSON.stringify(live)
    await dispatch({ type: 'offer_respond', offerId: o.id, response: 'counter', counter: loan ? { salary } : { salary, years, role } })
    const after = useImmersive.getState().state?.offers.find((x) => x.id === o.id)
    if (!after) setReply('A diretoria encerrou a negociação. Chegaram ao limite deles.')
    else if (JSON.stringify(after) !== before) setReply(after.note ?? 'Nova proposta na mesa.')
  }
  const advice =
    reply ??
    (same
      ? `São os termos do clube: é só aceitar. Para pedir mais, mexa no salário${loan ? ' (no empréstimo, duração e papel são do clube)' : ', na duração ou no papel'}.`
      : salary > cap
      ? `Acima do teto deles (${fmtMoney(cap)}): assim eles não aceitam. Baixa o salário.`
      : p >= 0.65
        ? 'Dá para pedir isso tranquilo. Eles querem fechar.'
        : p >= 0.35
          ? `Arriscado, mas possível. Se não aceitarem, ${odds.walk > 0.3 ? 'podem levantar da mesa' : 'devem melhorar a oferta'}.`
          : `Assim eles levantam da mesa. Eu baixaria o salário${loan ? '' : ' ou o papel'}.`)
  return (
    <Modal
      open={!!offerId}
      onClose={onClose}
      size="xl"
      media={c ? <Crest club={c} size={52} decorative /> : undefined}
      title={<ImDlgTitle kicker={`Negociação · ${o.kind === 'renewal' ? 'Renovação' : o.fee ? `Transferência · ${fmtMoney(o.fee)}` : KIND[o.kind]}`}>{`${c ? (c.name.length <= 14 ? c.name : c.shortName) : 'Clube'} × ${s.identity.surname}`}</ImDlgTitle>}
      className="im-neg-modal im-dlg"
    >
      <div className="im-neg" style={c ? (clubVars(c) as CSSProperties) : undefined}>
        <div className="im-neg__head">
          <div className="im-neg__pat">
            <span className="lx-label">Paciência da diretoria</span>
            <span className="lx-meter lx-meter--seg" data-level={patience >= 7 ? 'good' : patience >= 4 ? 'warn' : 'crit'} style={{ ['--lx-v' as string]: patience / 10 }} />
            <b className="num">{patience}/10</b>
          </div>
          <div className="im-neg__rounds">
            <span className="lx-label">
              Rodada {Math.min(total, total - o.roundsLeft + 1)}/{total}
            </span>
            <span className="im-pips is-lg">
              {Array.from({ length: total }).map((_, k) => (
                <i key={k} className={k < total - o.roundsLeft ? 'is-done' : k === total - o.roundsLeft ? 'is-on' : undefined} />
              ))}
            </span>
          </div>
        </div>
        <div className="im-neg__body">
          <div className="im-neg__terms">
            <div className="im-term is-head" aria-hidden="true">
              <span />
              <span className="lx-label">Clube oferece</span>
              <span className="lx-label">Sua contraproposta</span>
              <span />
            </div>
            <div className="im-term">
              <span className="lx-t-row">Salário/ano</span>
              <span className="im-term__club num">{fmtMoney(o.salary)}</span>
              <div className="im-term__ctl">
                <div className="lx-range-wrap" style={{ ['--lx-cap' as string]: Math.max(0, Math.min(1, (cap - min) / (max - min))) }}>
                  <span className="lx-range-wrap__cap" title={`Teto do clube: ${fmtMoney(cap)}`} />
                  <input type="range" className="lx-range" min={min} max={max} step={step} value={salary} onChange={(e) => setSalary(Number(e.target.value))} style={{ ['--lx-v' as string]: (salary - min) / (max - min) }} aria-label="Seu pedido de salário anual" aria-valuetext={fmtMoney(salary)} disabled={closed} />
                </div>
                <b className="im-term__v num">{fmtMoney(salary)}</b>
              </div>
              {delta(salary, o.salary, (n) => fmtMoney(n))}
            </div>
            <div className="im-term">
              <span className="lx-t-row">Duração</span>
              <span className="im-term__club num">{yearsLabel(o.years)}</span>
              <div className="im-term__ctl">
                {loan ? (
                  // empréstimo: nada de seletor morto — o motivo no lugar dele
                  <span className="im-term__lock">
                    <Lock size={13} aria-hidden="true" /> No empréstimo, a duração é do clube
                  </span>
                ) : (
                  <ImSeg<string> size="touch" value={String(years)} onChange={(v) => setYears(Number(v))} label="Duração do contrato em anos" disabled={closed} options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y}`, hint: yearsLabel(y) }))} />
                )}
              </div>
              {delta(years, o.years, (n) => (n === 1 ? '1 ano' : `${n} anos`))}
            </div>
            <div className="im-term">
              <span className="lx-t-row">Papel</span>
              <span className="im-term__club">{o.role}</span>
              <div className="im-term__ctl">
                {loan ? (
                  <span className="im-term__lock">
                    <Lock size={13} aria-hidden="true" /> No empréstimo, o papel é do clube
                  </span>
                ) : (
                  <ImSeg<ContractOffer['role']> size="touch" value={role} onChange={setRole} label="Papel no elenco" disabled={closed} options={ROLES.map((r) => ({ value: r, label: r }))} />
                )}
              </div>
              {ROLE_RANK[role] === ROLE_RANK[o.role] ? <span className="lx-chip lx-chip--sm">=</span> : <span className={cx('lx-chip lx-chip--sm', ROLE_RANK[role] > ROLE_RANK[o.role] ? 'lx-chip--gold' : 'lx-chip--neg')}>{ROLE_RANK[role] > ROLE_RANK[o.role] ? '▲' : '▼'}</span>}
            </div>
            {o.releaseClause ? (
              <div className="im-term is-static">
                <span className="lx-t-row">Multa rescisória</span>
                <span className="im-term__club num">{fmtMoney(o.releaseClause)}</span>
                <span className="lx-t-small">Fixada pelo clube</span>
                <span />
              </div>
            ) : null}
          </div>
          <aside className="im-neg__side">
            <span className="lx-label">Chance de aceite</span>
            <b className={cx('im-neg__p num', `is-${tone}`)}>{formatPercent(p)}</b>
            <span className="lx-meter" data-level={tone === 'pos' ? 'good' : tone === 'warn' ? 'warn' : 'crit'} style={{ ['--lx-v' as string]: p }} />
            <div className="im-neg__odds">
              <span>
                Melhoram <b className="num">{same ? '—' : formatPercent(odds.improve)}</b>
              </span>
              <span className={cx(!same && odds.walk >= 0.3 && 'is-neg')}>
                Desistem <b className="num">{same ? '—' : formatPercent(odds.walk)}</b>
              </span>
            </div>
            <span className="lx-t-small">{overTerms ? `Você muda ${overTerms} ${overTerms === 1 ? 'termo' : 'termos'} da proposta` : 'Os termos do clube'}{salary > cap ? ' · acima do teto' : ''}</span>
            <div className="im-agent">
              <span className="im-agent__av">AG</span>
              <p>{advice}</p>
            </div>
          </aside>
        </div>
        <div className="im-neg__actions">
          {closed ? (
            // o clube saiu da mesa: sobra só fechar (o foco vai para cá; os controles ficam desativados)
            <>
              <span className="flex-1" />
              <Button ref={closeRef} variant="primary" size="md" icon={X} onClick={onClose}>
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger" size="md" icon={CircleSlash} onClick={() => { void dispatch({ type: 'offer_respond', offerId: o.id, response: 'reject' }); onClose() }} disabled={busy}>
                Recusar
              </Button>
              <span className="flex-1" />
              <Button variant="ghost" size="md" icon={Repeat2} onClick={() => void send()} loading={busy} disabled={o.roundsLeft <= 0 || same}>
                Enviar contraproposta
              </Button>
              <Button variant="primary" size="md" icon={Check} onClick={() => { void dispatch({ type: 'offer_respond', offerId: o.id, response: 'accept' }); onClose() }} disabled={busy}>
                Aceitar proposta
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function MarketScreen() {
  const s = useImmersive((x) => x.state)!
  const fixture = useImmersive((x) => x.fixture)
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const query = useApp((x) => x.route.query)
  const [neg, setNeg] = useState<string | null>(null)
  // sem clube, fechar a janela com propostas assinaria por você: pergunta antes (CloseWindowDialog)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (query.proposta && s.offers.some((o) => o.id === query.proposta)) setNeg(query.proposta)
    else if (fixture === 'negociacao' && s.offers[0]) setNeg(s.offers[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.proposta, fixture])
  const it = currentItem(s)
  const open = it?.kind === 'transfer_window'
  const offers = useMemo(() => s.offers.slice().sort((a, b) => offerScore(b) - offerScore(a)), [s.offers])
  const owned = new Set((s.finance.lifestyle ?? []).map((l) => l.id))
  const shop = useImmersive((x) => x.catalog.lifestyleItems) ?? LIFESTYLE_ITEMS
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-market outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">
            {open ? <span className="lx-live-dot" /> : null}
            Mercado · {open ? 'janela aberta' : 'janela fechada'}
          </span>
          <h1 className="lx-t-display im-hub__title">Propostas</h1>
        </div>
        {open && (
          <div className="im-hub__actions">
            <Button variant="ghost" size="md" iconRight={ArrowRight} loading={busy} onClick={() => (!s.clubId && s.offers.length ? setClosing(true) : void dispatch({ type: 'advance' }))}>
              Fechar a janela
            </Button>
          </div>
        )}
      </header>
      <div className="im-market__grid">
        <section className="im-market__offers" aria-label="Propostas">
          {offers.length === 0 ? (
            <div className="lx-plate lx-plate--flat lx-c-md im-panel im-emptybox">
              <Repeat2 size={28} aria-hidden="true" />
              <b>Nenhuma proposta na mesa</b>
              <p className="lx-t-small m-0">As ofertas chegam nas janelas de transferência. Jogar bem (e aparecer na mídia) faz o telefone tocar.</p>
            </div>
          ) : (
            offers.map((o, i) => <OfferCard key={o.id} o={o} s={s} i={i} best={i === 0} onNegotiate={() => setNeg(o.id)} />)
          )}
        </section>
        <aside className="im-market__side">
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Seu contrato" icon={BadgeDollarSign} right={s.captain ? <span className="lx-chip lx-chip--sm lx-chip--gold"><Crown size={11} aria-hidden="true" /> Capitão</span> : undefined} />
            {s.clubId ? <ContractStrip s={s} balance /> : <p className="lx-t-small m-0">Sem contrato: a primeira proposta que você aceitar define salário e duração.</p>}
            <p className="lx-t-small m-0 mt-3">
              Valor de mercado: <b className="text-text num">{fmtMoney(s.marketValue)}</b>
              {!s.clubId && (
                <>
                  {' '}
                  · Saldo: <b className="text-text num">{fmtMoney(s.finance.balance)}</b>
                </>
              )}
            </p>
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Estilo de vida" icon={ShoppingBag} />
            <ul className="im-shop">
              {shop.slice(0, 6).map((it2) => {
                const mine = owned.has(it2.id)
                // sem saldo: o botão apaga de vez e a linha diz quanto falta
                const short = mine ? 0 : it2.price - s.finance.balance
                return (
                  <li key={it2.id} className={cx(short > 0 && 'is-locked')}>
                    <span className="min-w-0">
                      <b>{it2.name}</b>
                      <small>Moral +{it2.morale}</small>
                      {short > 0 && <small className="im-shop__why">Saldo insuficiente: faltam {fmtMoney(short)}</small>}
                    </span>
                    <Button variant={mine ? 'ghost' : 'outline'} size="sm" icon={mine ? Check : short > 0 ? Lock : Sparkles} disabled={busy || mine || short > 0} onClick={() => void dispatch({ type: 'buy', itemId: it2.id })}>
                      {mine ? 'Seu' : fmtMoney(it2.price)}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>
        </aside>
      </div>
      <Negotiation offerId={neg} onClose={() => setNeg(null)} />
      <CloseWindowDialog s={s} open={closing} onClose={() => setClosing(false)} />
    </main>
  )
}
