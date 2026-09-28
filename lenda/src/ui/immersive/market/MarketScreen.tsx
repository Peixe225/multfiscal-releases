/**
 * Mercado: propostas na mesa (transferência, empréstimo, renovação) + modal de negociação
 * (salário/duração/papel, teto estimado, paciência da diretoria, chance de aceite, contraproposta
 * → resposta do clube) + contrato atual e estilo de vida.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, BadgeDollarSign, Check, CircleSlash, Clock3, Crown, FileSignature, Handshake, Repeat2, ShoppingBag, Sparkles, X } from 'lucide-react'
import type { ContractOffer, ImmersiveState } from '@/engine/immersive/types'
import { useApp } from '@/store/app'
import { getClub, getCountry, getLeague } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Crest, Flag, Modal, Segmented, clubVars, cx, formatMoney, formatPercent } from '@/ui/primitives'
import { CompLogo, PanelHead } from '../bits'
import { LIFESTYLE_ITEMS } from '../model/constants'
import { ContractStrip } from '../hub/panels'
import { currentItem } from '../model/view'

const KIND: Record<ContractOffer['kind'], string> = { transfer: 'Transferência', loan: 'Empréstimo', renewal: 'Renovação', free_agent: 'Sem clube' }
const ROLE_RANK: Record<ContractOffer['role'], number> = { Promessa: 0, Reserva: 1, Rotação: 2, Titular: 3 }
const ROLES: ContractOffer['role'][] = ['Reserva', 'Rotação', 'Titular']

/** Estimativa do empresário (mesma forma do motor de exemplo; o real pode divergir). */
function acceptChance(o: ContractOffer, ask: { salary: number; years: number; role: ContractOffer['role'] }) {
  const over = Math.max(0, ask.salary / o.salary - 1)
  const p = 0.92 - over * 1.4 - Math.max(0, ROLE_RANK[ask.role] - ROLE_RANK[o.role]) * 0.22 - Math.abs(ask.years - o.years) * 0.05
  return ask.salary > o.salary * 1.45 ? Math.min(0.08, p) : Math.max(0.05, Math.min(0.95, p))
}

function OfferCard({ o, s, onNegotiate, i }: { o: ContractOffer; s: ImmersiveState; onNegotiate: () => void; i: number }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const c = getClub(o.clubId)
  const lg = c ? getLeague(c.leagueId) : undefined
  const country = c ? getCountry(c.country) : undefined
  const vars = c ? (clubVars(c) as CSSProperties) : undefined
  const left = o.expiresWeek - s.week
  return (
    <article className="lx-plate lx-c-lg im-offer lx-anim-rise" style={{ ...vars, ['--i' as string]: i }}>
      <div className="lx-club-glow" aria-hidden="true" />
      <div className="im-offer__head">
        {c && <Crest club={c} size={58} decorative />}
        <div className="min-w-0">
          <span className={cx('lx-chip lx-chip--sm', o.kind === 'renewal' ? 'lx-chip--accent' : 'lx-chip--gold')}>{KIND[o.kind]}</span>
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
          <span className="im-pips" title={`${o.roundsLeft} rodadas de negociação`} aria-label={`${o.roundsLeft} rodadas de negociação restantes`}>
            {[0, 1, 2].map((k) => (
              <i key={k} className={k < o.roundsLeft ? 'is-on' : undefined} />
            ))}
          </span>
        </span>
      </div>
      <dl className="im-offer__terms">
        {o.fee ? (
          <div>
            <dt>Valor</dt>
            <dd className="lx-hi num">{formatMoney(o.fee)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Salário</dt>
          <dd className="num">{formatMoney(o.salary)}/ano</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd className="num">{o.years} anos</dd>
        </div>
        <div>
          <dt>Papel</dt>
          <dd className={cx(o.role === 'Titular' && 'text-positive')}>{o.role}</dd>
        </div>
        {o.signingBonus ? (
          <div className="max-sm:hidden">
            <dt>Luvas</dt>
            <dd className="num">{formatMoney(o.signingBonus)}</dd>
          </div>
        ) : null}
      </dl>
      {o.note && <p className="im-offer__note">“{o.note}”</p>}
      <div className="im-offer__foot">
        <Button variant="ghost" size="sm" icon={X} onClick={() => void dispatch({ type: 'offer_respond', offerId: o.id, response: 'reject' })} disabled={busy}>
          Recusar
        </Button>
        <Button variant="ghost" size="sm" icon={Handshake} onClick={onNegotiate} disabled={busy || o.roundsLeft <= 0}>
          Negociar
        </Button>
        <Button variant="primary" size="sm" icon={FileSignature} onClick={() => void dispatch({ type: 'offer_respond', offerId: o.id, response: 'accept' })} loading={busy}>
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
  useEffect(() => {
    if (!o) return
    setSalary(Math.round((o.salary * 1.2) / 1000) * 1000)
    setYears(o.years)
    setRole(o.role === 'Promessa' ? 'Reserva' : o.role)
    setReply(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId])
  if (!o) return null
  const c = getClub(o.clubId)
  const min = Math.round((o.salary * 0.8) / 1000) * 1000
  const max = Math.round((o.salary * 1.9) / 1000) * 1000
  const cap = o.salary * 1.45
  const p = acceptChance(o, { salary, years, role })
  const tone = p >= 0.65 ? 'pos' : p >= 0.35 ? 'warn' : 'neg'
  const overTerms = (salary > cap ? 1 : 0) + (ROLE_RANK[role] > ROLE_RANK[o.role] ? 1 : 0)
  const patience = Math.round((o.roundsLeft / 3) * 10)
  const closed = !live
  const delta = (a: number, b: number, fmt: (n: number) => string) => (a === b ? <span className="lx-chip lx-chip--sm">=</span> : <span className={cx('lx-chip lx-chip--sm', a > b ? 'lx-chip--gold' : 'lx-chip--neg')}>{a > b ? '+' : '−'}{fmt(Math.abs(a - b))}</span>)
  const send = async () => {
    const before = JSON.stringify(live)
    await dispatch({ type: 'offer_respond', offerId: o.id, response: 'counter', counter: { salary, years, role } })
    const after = useImmersive.getState().state?.offers.find((x) => x.id === o.id)
    if (!after) setReply('A diretoria encerrou a negociação. Chegaram ao limite deles.')
    else if (JSON.stringify(after) !== before) setReply(after.note ?? 'Nova proposta na mesa.')
  }
  return (
    <Modal
      open={!!offerId}
      onClose={onClose}
      size="xl"
      media={c ? <Crest club={c} size={52} decorative /> : undefined}
      title={<span className="im-neg__t">{`${c?.shortName ?? 'Clube'} × ${s.identity.surname}`}</span>}
      description={`Negociação · ${KIND[o.kind]}`}
      className="im-neg-modal im-dlg"
    >
      <div className="im-neg" style={c ? (clubVars(c) as CSSProperties) : undefined}>
        <div className="im-neg__head">
          <span className="lx-kicker">
            {o.kind === 'renewal' ? 'Renovação' : o.fee ? `Transferência · ${formatMoney(o.fee)}` : KIND[o.kind]}
          </span>
          <div className="im-neg__rounds">
            <span className="lx-label">Rodadas</span>
            <span className="im-pips is-lg">
              {[0, 1, 2].map((k) => (
                <i key={k} className={k < o.roundsLeft ? 'is-on' : 'is-done'} />
              ))}
            </span>
          </div>
        </div>
        <div className="im-neg__pat">
          <span className="lx-label">Paciência da diretoria</span>
          <span className="lx-meter lx-meter--seg" data-level={patience >= 7 ? 'good' : patience >= 4 ? 'warn' : 'crit'} style={{ ['--lx-v' as string]: patience / 10 }} />
          <b className="num">{patience}/10</b>
        </div>
        <div className="im-neg__body">
          <div className="im-neg__terms">
            <div className="im-term">
              <span className="lx-t-row">Salário/ano</span>
              <span className="im-term__club num">{formatMoney(o.salary)}</span>
              <div className="im-term__ctl">
                <div className="lx-range-wrap" style={{ ['--lx-cap' as string]: (cap - min) / (max - min) }}>
                  <span className="lx-range-wrap__cap" title="Teto estimado do clube" />
                  <input type="range" className="lx-range" min={min} max={max} step={1000} value={salary} onChange={(e) => setSalary(Number(e.target.value))} style={{ ['--lx-v' as string]: (salary - min) / (max - min) }} aria-label="Seu pedido de salário anual" disabled={closed} />
                </div>
                <b className="im-term__v num">{formatMoney(salary)}</b>
              </div>
              {delta(salary, o.salary, (n) => formatMoney(n))}
            </div>
            <div className="im-term">
              <span className="lx-t-row">Duração</span>
              <span className="im-term__club num">{o.years} anos</span>
              <div className="im-term__ctl">
                <Segmented<string> size="sm" value={String(years)} onChange={(v) => setYears(Number(v))} aria-label="Duração do contrato" options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `${y}`, disabled: closed }))} />
              </div>
              {delta(years, o.years, (n) => `${n}a`)}
            </div>
            <div className="im-term">
              <span className="lx-t-row">Papel</span>
              <span className="im-term__club">{o.role}</span>
              <div className="im-term__ctl">
                <Segmented<ContractOffer['role']> size="sm" value={role} onChange={setRole} aria-label="Papel no elenco" options={ROLES.map((r) => ({ value: r, label: r, disabled: closed }))} />
              </div>
              {ROLE_RANK[role] === ROLE_RANK[o.role] ? <span className="lx-chip lx-chip--sm">=</span> : <span className={cx('lx-chip lx-chip--sm', ROLE_RANK[role] > ROLE_RANK[o.role] ? 'lx-chip--gold' : 'lx-chip--neg')}>{ROLE_RANK[role] > ROLE_RANK[o.role] ? '▲' : '▼'}</span>}
            </div>
            {o.releaseClause ? (
              <div className="im-term is-static">
                <span className="lx-t-row">Multa rescisória</span>
                <span className="im-term__club num">{formatMoney(o.releaseClause)}</span>
                <span className="lx-t-small">Fixada pelo clube</span>
                <span />
              </div>
            ) : null}
          </div>
          <aside className="im-neg__side">
            <span className="lx-label">Chance de aceite</span>
            <b className={cx('im-neg__p num', `is-${tone}`)}>{formatPercent(p)}</b>
            <span className="lx-meter" data-level={tone === 'pos' ? 'good' : tone === 'warn' ? 'warn' : 'crit'} style={{ ['--lx-v' as string]: p }} />
            <span className="lx-t-small">{overTerms ? `Acima do teto em ${overTerms} ${overTerms === 1 ? 'termo' : 'termos'}` : 'Dentro do que o clube pode pagar'}</span>
            <div className="im-agent">
              <span className="im-agent__av">AG</span>
              <p>{reply ?? (p >= 0.65 ? 'Dá para pedir isso tranquilo. Eles querem fechar.' : p >= 0.35 ? 'Arriscado, mas possível. Cada contraproposta gasta paciência.' : 'Assim eles levantam da mesa. Eu baixaria o salário ou o papel.')}</p>
            </div>
          </aside>
        </div>
        <div className="im-neg__actions">
          <Button variant="danger" size="md" icon={CircleSlash} onClick={() => { void dispatch({ type: 'offer_respond', offerId: o.id, response: 'reject' }); onClose() }} disabled={busy || closed}>
            Recusar
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="md" icon={Repeat2} onClick={() => void send()} loading={busy} disabled={closed || o.roundsLeft <= 0}>
            Enviar contraproposta
          </Button>
          <Button variant="primary" size="md" icon={Check} onClick={() => { void dispatch({ type: 'offer_respond', offerId: o.id, response: 'accept' }); onClose() }} disabled={busy || closed}>
            Aceitar proposta
          </Button>
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
  useEffect(() => {
    if (query.proposta && s.offers.some((o) => o.id === query.proposta)) setNeg(query.proposta)
    else if (fixture === 'negociacao' && s.offers[0]) setNeg(s.offers[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.proposta, fixture])
  const it = currentItem(s)
  const open = it?.kind === 'transfer_window'
  const offers = useMemo(() => s.offers.slice().sort((a, b) => (a.kind === 'renewal' ? 1 : 0) - (b.kind === 'renewal' ? 1 : 0)), [s.offers])
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
            <Button variant="ghost" size="md" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
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
            offers.map((o, i) => <OfferCard key={o.id} o={o} s={s} i={i} onNegotiate={() => setNeg(o.id)} />)
          )}
        </section>
        <aside className="im-market__side">
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Seu contrato" icon={BadgeDollarSign} right={s.captain ? <span className="lx-chip lx-chip--sm lx-chip--gold"><Crown size={11} aria-hidden="true" /> Capitão</span> : undefined} />
            <ContractStrip s={s} />
            <p className="lx-t-small m-0 mt-3">Valor de mercado: <b className="text-text num">{formatMoney(s.marketValue)}</b></p>
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Estilo de vida" icon={ShoppingBag} />
            <ul className="im-shop">
              {shop.slice(0, 6).map((it2) => (
                <li key={it2.id}>
                  <span className="min-w-0">
                    <b>{it2.name}</b>
                    <small>Moral +{it2.morale}</small>
                  </span>
                  <Button variant={owned.has(it2.id) ? 'ghost' : 'outline'} size="sm" icon={owned.has(it2.id) ? Check : Sparkles} disabled={busy || owned.has(it2.id) || s.finance.balance < it2.price} onClick={() => void dispatch({ type: 'buy', itemId: it2.id })}>
                    {owned.has(it2.id) ? 'Seu' : formatMoney(it2.price)}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      <Negotiation offerId={neg} onClose={() => setNeg(null)} />
    </main>
  )
}
