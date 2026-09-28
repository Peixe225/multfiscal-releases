/**
 * "Nova carreira · 1 Identidade" (route "#/identidade", optional ?ritmo=intensa|normal|expressa).
 * Desktop: 3 columns (Identidade · Nacionalidade · Posição). Tablet: 2 + Posição below.
 * Phones: 3-step wizard (Nacionalidade → Identidade → Posição) with a progress bar.
 * "Confirmar identidade" starts the career through the store and opens the cockpit.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Minus, Plus, RotateCcw, Save, X, type LucideProps } from 'lucide-react'
import type { Pace, PlayerIdentity } from '@/engine/types'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { selectHasImmersiveCareer, useImmersive } from '@/store/immersive'
import { useData } from '@/store/data'
import { Button, Flag, FootIcon, Glass, IconButton, Modal, OvrBadge, POSITION_LABEL, Segmented, Tooltip, cx, toast, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { sfx } from '@/ui/shell/sfx'
import { bestInk, clubVars, nationColors } from '@/ui/theme/club'
import '@/ui/shared/achievements/unlockToasts'
import { Jersey } from './Jersey'
import { BLANK_KIT, nationKit } from './kit'
import { NationalityPicker } from './NationalityPicker'
import { Pitch, PositionCard } from './PositionPitch'
import { cleanSurname, draftToIdentity, isValidNumber, PACE_INFO, PACES, usePrefs } from './prefs'
import './identity.css'

/** Engine constant (career/constants.ts START_OVR): every career starts at 50. */
const START_OVR = 50

function Steps({ current, items = ['Identidade', 'Clube de base', 'Estreia'] }: { current: 1 | 2 | 3; items?: string[] }) {
  return (
    <ol className="id-steps m-0 p-0 list-none" aria-label="Etapas da nova carreira">
      {items.map((label, i) => (
        <li key={label} className="contents">
          {i > 0 && <span className="id-steps__ln" aria-hidden="true" />}
          <span className={cx('id-step', i + 1 === current && 'is-on')} aria-current={i + 1 === current ? 'step' : undefined}>
            <span className="id-step__n">{i + 1}</span>
            <span className="id-step__l">{label}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function ColHead({ k, title, done, doneLabel, todo }: { k: string; title: string; done: boolean; doneLabel?: string; todo?: string }) {
  return (
    <div className="id-col-h">
      <h2>
        <span className="k">{k}</span>
        {title}
      </h2>
      {done ? (
        <span className="id-ok">
          <Check size={13} strokeWidth={3} aria-hidden />
          <span className="truncate">{doneLabel ?? 'Pronto'}</span>
        </span>
      ) : (
        todo && <span className="id-todo">{todo}</span>
      )}
    </div>
  )
}

export default function IdentityScreen() {
  const rm = useReducedMotion()
  const data = useData((s) => s.data)
  const index = useData((s) => s.index)
  const query = useApp((s) => s.route.query)
  // ?modo=imersivo → a identidade começa uma carreira do Modo Imersivo
  const immersive = query.modo === 'imersivo'
  const classicBusy = useCareer((s) => s.busy)
  const immBusy = useImmersive((s) => s.busy)
  const busy = immersive ? immBusy : classicBusy
  const hasClassic = useCareer(selectHasActiveCareer)
  const hasImmersive = useImmersive(selectHasImmersiveCareer)
  const hasActive = immersive ? hasImmersive : hasClassic
  useEffect(() => {
    if (immersive) void useImmersive.getState().init()
  }, [immersive])
  const draft = usePrefs((s) => s.draft)
  const savedAt = usePrefs((s) => s.savedAt)
  const patch = usePrefs((s) => s.patchDraft)
  const reset = usePrefs((s) => s.resetDraft)
  const prefPace = usePrefs((s) => s.pace)
  const setPace = usePrefs((s) => s.setPace)
  const wide = useMediaQuery('(min-width: 45rem)')
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [numberText, setNumberText] = useState(draft.number)
  const searchRef = useRef<HTMLInputElement>(null)
  const surnameRef = useRef<HTMLInputElement>(null)

  // ?ritmo= from the landing wins over the stored preference
  useEffect(() => {
    const r = query.ritmo as Pace | undefined
    if (r && PACES.includes(r) && r !== prefPace) setPace(r)
  }, [query.ritmo]) // eslint-disable-line react-hooks/exhaustive-deps
  const pace = prefPace

  const countries = data?.countries ?? []
  const country = draft.nationality ? index?.countryByCode.get(draft.nationality) : undefined
  const kit = country ? nationKit(country) : BLANK_KIT
  const colors = useMemo(() => (country ? nationColors(country) : null), [country])
  const vars = useMemo(() => {
    if (!colors) return undefined
    const v = { ...clubVars(colors) } as unknown as CSSProperties & Record<string, string>
    v['--club-2-ink'] = bestInk(colors.secondary)
    return v
  }, [colors])

  useShellSlots(
    {
      sub: 'NOVA CARREIRA',
      height: 62,
      center: <Steps current={1} items={immersive ? ['Identidade', 'Central da semana'] : undefined} />,
      actions: <IconButton label="Fechar e voltar ao início" icon={X} onClick={() => navigate('/')} />,
      stage: { preset: 'duo', colors: colors ?? { primary: '#3a3f4d', secondary: '#8a8f9c' } },
    },
    [colors?.primary, colors?.secondary, immersive],
  )

  const surname = draft.surname
  const numberOk = isValidNumber(numberText)
  const identity: PlayerIdentity | null = draftToIdentity({ ...draft, number: numberText })
  const persona = surname.trim().toUpperCase() || 'SOBRENOME'
  const missing = [!draft.nationality && 'nacionalidade', !draft.position && 'posição', !numberOk && 'número'].filter(Boolean) as string[]

  const setNumber = (t: string) => {
    const clean = t.replace(/\D/g, '').slice(0, 2)
    setNumberText(clean)
    patch({ number: clean })
  }
  const bump = (d: number) => {
    const n = Number(numberText) || 0
    const next = Math.min(99, Math.max(1, n + d))
    setNumber(String(next))
    sfx.play('tick')
  }

  const doStart = async () => {
    if (!identity) return
    try {
      sfx.play('whistle')
      if (immersive) {
        // Modo Imersivo: sobrenome em caixa normal nas frases (o grafismo põe em caixa-alta pelo CSS)
        const surname = identity.surname.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
        await useImmersive.getState().start({ ...identity, surname })
        navigate('/imersivo')
        return
      }
      await useCareer.getState().start(identity, pace)
      navigate('/carreira')
    } catch (err) {
      console.error(err)
      toast.error('Não foi possível começar a carreira', 'Tente de novo em instantes.')
    }
  }
  const confirm = () => {
    if (!identity) {
      toast.info('Quase lá', `Falta escolher: ${missing.join(' e ')}.`)
      if (!draft.nationality) searchRef.current?.focus()
      return
    }
    if (hasActive && !query.nova) {
      setConfirmReplace(true)
      return
    }
    void doStart()
  }

  // ───────────────────────── columns ─────────────────────────
  const colIdentity = (
    <section className="id-col" aria-labelledby="id-h-1">
      <span id="id-h-1" className="sr-only">
        Identidade
      </span>
      <ColHead k="01" title="Identidade" done={surname.trim().length > 0 && numberOk} todo="Nome e número" />
      <div className="id-jersey">
        <div className="id-jersey__ovr">
          <OvrBadge ovr={START_OVR} size="md" sheen={false} />
          <span className="id-jersey__cap">Inicial</span>
        </div>
        <motion.div
          className={cx('id-jersey__kit', !rm && 'lx-sway')}
          key={country?.code ?? 'blank'}
          initial={rm ? false : { rotateY: -90, opacity: 0.4 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformPerspective: 800 }}
        >
          <Jersey name={persona} number={numberOk ? numberText : numberText || '?'} kit={kit} title={`Camisa de ${persona}, número ${numberText || 'sem número'}`} />
        </motion.div>
        <div className="id-jersey__rot">
          <Tooltip content="Recomeçar identidade">
            <IconButton
              label="Recomeçar identidade"
              icon={RotateCcw}
              size="sm"
              onClick={() => {
                reset()
                setNumberText('10')
                surnameRef.current?.focus()
              }}
            />
          </Tooltip>
        </div>
      </div>
      <div className="id-fields">
        <div className="id-field">
          <label className="id-label" htmlFor="id-surname">
            Sobrenome
          </label>
          <span className="lx-input lx-input--name">
            <input
              id="id-surname"
              ref={surnameRef}
              value={surname}
              maxLength={15}
              autoComplete="family-name"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="SOBRENOME"
              onChange={(e) => patch({ surname: cleanSurname(e.target.value) })}
              aria-describedby="id-surname-count"
            />
            <span className="id-count" id="id-surname-count" aria-label={`${surname.length} de 15 caracteres`}>
              {surname.length}/15
            </span>
          </span>
        </div>
        <div className="id-field">
          <label className="id-label" htmlFor="id-number">
            Número
          </label>
          <span className="lx-stepper id-stepper" data-invalid={!numberOk}>
            <button type="button" aria-label="Diminuir número" onClick={() => bump(-1)} disabled={(Number(numberText) || 0) <= 1}>
              <Minus aria-hidden />
            </button>
            <input
              id="id-number"
              inputMode="numeric"
              pattern="[1-9][0-9]?"
              value={numberText}
              aria-invalid={!numberOk}
              aria-describedby={!numberOk ? 'id-number-err' : undefined}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  bump(1)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  bump(-1)
                }
              }}
            />
            <button type="button" aria-label="Aumentar número" onClick={() => bump(1)} disabled={(Number(numberText) || 0) >= 99}>
              <Plus aria-hidden />
            </button>
          </span>
        </div>
      </div>
      {!numberOk && (
        <p className="id-err" id="id-number-err" role="alert">
          Use um número de 1 a 99.
        </p>
      )}
      <div className="mt-4">
        <span className="id-label" id="id-foot-l">
          Perna dominante
        </span>
        <Segmented
          variant="solid"
          full
          value={draft.foot}
          onChange={(foot) => patch({ foot })}
          aria-label="Perna dominante"
          options={[
            { value: 'left', label: 'Esquerda', icon: MirroredFoot },
            { value: 'right', label: 'Direita', icon: FootIcon },
          ]}
        />
      </div>
      {!immersive && (
        <div className="mt-4">
          <span className="id-label">Ritmo da carreira</span>
          <Segmented<Pace> full value={pace} onChange={setPace} aria-label="Ritmo da carreira" options={PACES.map((p) => ({ value: p, label: PACE_INFO[p].label }))} />
          <p className="id-hint">
            <b>{PACE_INFO[pace].lead}</b> · {PACE_INFO[pace].tail}
          </p>
        </div>
      )}
    </section>
  )

  const colNation = (
    <section className="id-col" aria-labelledby="id-h-2" style={vars}>
      <span id="id-h-2" className="sr-only">
        Nacionalidade
      </span>
      <ColHead k="02" title="Nacionalidade" done={!!country} doneLabel={country?.name} todo="Busque seu país" />
      <NationalityPicker countries={countries} value={draft.nationality} onChange={(nationality) => patch({ nationality })} searchRef={searchRef} />
    </section>
  )

  const colPosition = (
    <section className="id-col id-col--pos" aria-labelledby="id-h-3">
      <span id="id-h-3" className="sr-only">
        Posição
      </span>
      <ColHead k="03" title="Posição" done={!!draft.position} doneLabel={draft.position ? POSITION_LABEL[draft.position] : undefined} todo="Seu lugar em campo" />
      <Pitch value={draft.position} onChange={(position) => patch({ position })} />
      <PositionCard value={draft.position} />
    </section>
  )

  const summary = (
    <span className="id-actions__mid max-md:hidden" aria-live="polite">
      {missing.length && !identity ? (
        <span className="id-missing">
          Falta escolher: <b>{missing.join(' · ')}</b>
        </span>
      ) : (
        <>
          {country && <Flag code={country.code} iso2={country.iso2} h={15} w={20} decorative />}
          <b>
            {persona} #{numberText}
          </b>
          <span className="id-dot" />
          {draft.position ? POSITION_LABEL[draft.position] : '—'}
          <span className="id-dot" />
          {draft.foot === 'left' ? 'Canhoto' : 'Destro'}
          <span className="id-dot" />
          16 anos · 2026
        </>
      )}
    </span>
  )

  const title = (
    <div className="id-title">
      <div>
        <span className="lx-eyebrow">{immersive ? 'Modo Imersivo · partida a partida' : `Modo Clássico · Ritmo ${PACE_INFO[pace].label}`}</span>
        <h1>Defina sua identidade</h1>
        <p>O nome que vai estar nas costas da camisa pelos próximos 24 anos.</p>
      </div>
      <span className="id-save" style={{ opacity: savedAt ? 1 : 0 }} aria-hidden={!savedAt}>
        <Save size={14} aria-hidden /> Rascunho salvo automaticamente
      </span>
    </div>
  )

  const replaceModal = (
    <Modal
      open={confirmReplace}
      onClose={() => setConfirmReplace(false)}
      size="sm"
      title="Substituir a carreira atual?"
      description="Você tem uma carreira em andamento. Ao confirmar, ela será substituída por esta nova."
      footer={
        <div className="flex gap-2 justify-end flex-wrap w-full">
          <Button variant="ghost" size="md" onClick={() => setConfirmReplace(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            iconRight={ArrowRight}
            loading={busy}
            onClick={() => {
              setConfirmReplace(false)
              void doStart()
            }}
          >
            Começar nova carreira
          </Button>
        </div>
      }
    />
  )

  // ───────────────────────── phones: wizard ─────────────────────────
  if (!wide) {
    const steps: { title: string; ok: boolean; body: ReactNode }[] = [
      { title: 'Nacionalidade', ok: !!country, body: colNation },
      { title: 'Identidade', ok: surname.trim().length > 0 && numberOk, body: colIdentity },
      { title: 'Posição', ok: !!draft.position, body: colPosition },
    ]
    const cur = steps[step]
    const last = step === 2
    return (
      <main id="conteudo" tabIndex={-1} className="id-wrap outline-none" style={vars}>
        <div className="id-wiz">
          <div className="id-wiz__head">
            <div className="min-w-0 flex-1">
              <span className="lx-eyebrow">
                Passo {step + 1} de 3 · {immersive ? 'Modo Imersivo' : `Ritmo ${PACE_INFO[pace].label}`}
              </span>
              <h1 className="font-display font-extrabold text-[22px] tracking-[-0.02em] leading-tight m-0 mt-0.5">{cur.title}</h1>
              <div className="id-wiz__progress" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={step + 1} aria-label={`Passo ${step + 1} de 3`}>
                <i style={{ transform: `scaleX(${(step + 1) / 3})` }} />
              </div>
            </div>
            {step !== 1 && (
              <div className="id-wiz__kit">
                <Jersey name={persona} number={numberText || '?'} kit={kit} />
              </div>
            )}
          </div>
          <Glass className="id-wiz__body" padding="none" radius="xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                className="flex-1 flex flex-col min-h-0"
                initial={rm ? { opacity: 0 } : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={rm ? { opacity: 0 } : { opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {cur.body}
              </motion.div>
            </AnimatePresence>
          </Glass>
          <div className="id-wiz__foot">
            <Button variant="ghost" size="lg" pill icon={ArrowLeft} onClick={() => (step === 0 ? navigate('/') : setStep((s) => (s - 1) as 0 | 1 | 2))}>
              Voltar
            </Button>
            {last ? (
              <Button variant="primary" size="lg" pill iconRight={ArrowRight} loading={busy} aria-disabled={!identity} className={cx(!identity && 'opacity-60')} onClick={confirm}>
                Confirmar
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                pill
                iconRight={ArrowRight}
                aria-disabled={!cur.ok}
                className={cx(!cur.ok && 'opacity-60')}
                onClick={() => {
                  if (!cur.ok) {
                    toast.info(step === 0 ? 'Escolha sua nacionalidade' : 'Complete nome e número')
                    return
                  }
                  setStep((s) => (s + 1) as 0 | 1 | 2)
                  window.scrollTo({ top: 0 })
                }}
              >
                Continuar
              </Button>
            )}
          </div>
        </div>
        {replaceModal}
      </main>
    )
  }

  // ───────────────────────── tablet / desktop ─────────────────────────
  return (
    <main id="conteudo" tabIndex={-1} className="id-wrap outline-none">
      {title}
      <motion.div initial={rm ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
        <Glass className="id-panel" padding="none" radius="xl" style={vars}>
          {colIdentity}
          {colNation}
          {colPosition}
        </Glass>
      </motion.div>
      <Glass className="id-actions" padding="none">
        <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={() => navigate('/')}>
          Voltar
        </Button>
        {summary}
        <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy} aria-disabled={!identity} className={cx(!identity && 'opacity-60')} onClick={confirm}>
          Confirmar identidade
        </Button>
      </Glass>
      {replaceModal}
    </main>
  )
}

function MirroredFoot(props: LucideProps) {
  return <FootIcon {...props} style={{ ...(props.style ?? {}), transform: 'scaleX(-1)' }} />
}
