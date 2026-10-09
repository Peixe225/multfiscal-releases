/**
 * Menu (sheet on phones, dialog on desktop): navigation, settings, abandon career.
 * With a classic AND an immersive career saved, both "Continuar" rows show (the classic one labelled).
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Crown, Flag as FlagIcon, House, ChartLine, Play, Radio, ScrollText, Settings2, Sparkles, Trash, Tv2, UserRound, Video } from 'lucide-react'
import type { ImmersiveState } from '@/engine/immersive/types'
import { navigate, useApp, type RoutePath } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { peekSavedImmersive, useImmersive } from '@/store/immersive'
import { useData } from '@/store/data'
import { Button, Eyebrow, Hairline, MedalIcon, Modal, Segmented, Switch, toast, useReducedMotion } from '@/ui/primitives'
import { shortDate } from '@/ui/shared/live/leagues'
import { useAchievementCatalog } from './achievementsRegistry'
import { sfx } from './sfx'

function NavRow({ icon: Ico, label, sub, to, onGo }: { icon: typeof House; label: string; sub?: string; to?: RoutePath; onGo: () => void }) {
  return (
    <button
      type="button"
      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
      onClick={() => {
        sfx.play('click')
        onGo()
        if (to) navigate(to)
      }}
    >
      <span className="grid place-items-center w-9 h-9 rounded-[11px] bg-surface-2 border border-border text-text-2 group-hover:text-text flex-none">
        <Ico size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-text">{label}</span>
        {sub && <span className="block text-[12px] text-text-3 truncate">{sub}</span>}
      </span>
      <ChevronRight size={16} className="text-text-3 flex-none" aria-hidden />
    </button>
  )
}

export function MenuDialog() {
  const open = useApp((s) => s.dialog === 'menu')
  const close = useApp((s) => s.closeDialog)
  const openDialog = useApp((s) => s.openDialog)
  const settings = useApp((s) => s.settings)
  const setSetting = useApp((s) => s.setSetting)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const engineKind = useCareer((s) => s.engineKind)
  const isFixture = useCareer((s) => s.isFixture)
  const abandon = useCareer((s) => s.abandon)
  const source = useData((s) => s.source)
  const tablesDay = shortDate(useData((s) => s.data?.generatedAt))
  const unlocked = useCareer((s) => Object.keys(s.achievements).length)
  const total = useAchievementCatalog((s) => s.list.length)
  const rm = useReducedMotion()
  const [confirm, setConfirm] = useState(false)
  // a carreira imersiva salva (o store do Imersivo só carrega dentro do modo; aqui basta espiar o save)
  const immLoaded = useImmersive((s) => (s.state && !s.isFixture ? s.state : null))
  const [immSaved, setImmSaved] = useState<ImmersiveState | null>(null)
  useEffect(() => {
    if (open) void peekSavedImmersive().then(setImmSaved).catch(() => {})
  }, [open])
  const imm = immLoaded ?? immSaved
  const both = !!(active && state && imm && !imm.retired)
  // "Abandonar": a confirmação aparece no fim da lista → rola até ela e põe o foco em "Cancelar";
  // ao cancelar, o foco volta para o botão que abriu (nada de foco perdido no <body>)
  const confirmRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const abandonRef = useRef<HTMLButtonElement>(null)
  const wasConfirm = useRef(false)
  useEffect(() => {
    if (confirm) {
      cancelRef.current?.focus({ preventScroll: true })
      confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: rm ? 'auto' : 'smooth' })
    } else if (wasConfirm.current) abandonRef.current?.focus({ preventScroll: true })
    wasConfirm.current = confirm
  }, [confirm, rm])

  const rmValue = settings.reducedMotion == null ? 'auto' : settings.reducedMotion ? 'on' : 'off'
  return (
    <Modal open={open} onClose={() => (setConfirm(false), close())} title="Menu" size="md">
      <div className="grid gap-1">
        <NavRow icon={House} label="Início" to="/" onGo={close} />
        {active && state && <NavRow icon={Play} label={both ? 'Continuar carreira clássica' : 'Continuar carreira'} sub={`${state.identity.surname} · ${state.age} anos · OVR ${state.ovr}`} to="/carreira" onGo={close} />}
        {imm && !imm.retired && <NavRow icon={Tv2} label="Continuar carreira imersiva" sub={`${imm.identity.surname} · ${imm.age} anos · OVR ${imm.ovr}`} to="/imersivo" onGo={close} />}
        <NavRow icon={UserRound} label="Nova carreira" sub="Modo Clássico" to="/identidade" onGo={close} />
        {state && <NavRow icon={ChartLine} label="Resumo da carreira" to="/resumo" onGo={close} />}
        <NavRow icon={Radio} label="Ligas ao vivo" sub={tablesDay ? `Tabelas reais de ${tablesDay}` : 'Tabelas reais'} to="/ligas" onGo={close} />
        <NavRow icon={Crown} label="Hall das Lendas" sub="Suas carreiras contra as lendas reais" to="/hall" onGo={close} />
        <NavRow icon={MedalIcon as unknown as typeof House} label="Conquistas" sub={`${unlocked} de ${total} desbloqueadas`} onGo={() => openDialog('achievements')} />
        <NavRow icon={Video} label="Live interativa" sub="TikTok LIVE: o chat decide com comentários e presentes" to="/live" onGo={close} />
        <NavRow icon={ScrollText} label="Créditos" sub="Fotos, fontes, dados e licenças" to="/creditos" onGo={close} />
        {import.meta.env.DEV && <NavRow icon={Sparkles} label="Design kit" sub="Primitivos e estados" to="/kit" onGo={close} />}
      </div>

      <Hairline className="my-4" />
      <Eyebrow as="h3" className="flex items-center gap-2 mb-1">
        <Settings2 size={13} aria-hidden /> Configurações
      </Eyebrow>
      <div className="grid">
        <Switch label="Som" description="Efeitos sonoros sintetizados" checked={settings.sound} onChange={(v) => setSetting('sound', v)} />
        {settings.sound && (
          <label className="flex items-center gap-3 min-h-[40px]">
            <span className="text-[12.5px] font-semibold text-text-2 w-16 flex-none">Volume</span>
            <input
              type="range"
              className="lx-range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              style={{ ['--pct' as string]: `${Math.round(settings.volume * 100)}%` }}
              onChange={(e) => setSetting('volume', Number(e.target.value) / 100)}
              onPointerUp={() => sfx.play('click')}
              aria-label="Volume"
            />
            <span className="num text-[15px] font-bold w-9 text-right">{Math.round(settings.volume * 100)}</span>
          </label>
        )}
        <Switch label="Pular animações" description="Mostra o resultado de cada decisão na hora" checked={settings.skipAnimations} onChange={(v) => setSetting('skipAnimations', v)} />
        <div className="flex items-center gap-3 min-h-[48px] flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">Reduzir movimento</div>
            <div className="text-[12px] text-text-3 mt-0.5">Brilhos e loops ambientes ficam estáticos</div>
          </div>
          <Segmented
            aria-label="Reduzir movimento"
            size="sm"
            value={rmValue}
            onChange={(v) => setSetting('reducedMotion', v === 'auto' ? null : v === 'on')}
            options={[
              { value: 'auto', label: 'Sistema' },
              { value: 'on', label: 'Sim' },
              { value: 'off', label: 'Não' },
            ]}
          />
        </div>
        <Switch label="Efeitos leves" description="Sem desfoque de vidro — melhor em celulares antigos" checked={settings.lowFx} onChange={(v) => setSetting('lowFx', v)} />
      </div>

      {state && !isFixture && (
        <>
          <Hairline className="my-4" />
          {confirm ? (
            <div ref={confirmRef} className="rounded-md p-3 bg-negative-bg border border-[rgba(255,94,120,.22)] scroll-mb-3">
              <p className="m-0 text-[13px] text-text-2">
                Abandonar a carreira {both ? 'clássica ' : ''}de <b className="text-text">{state.identity.surname}</b>? O progresso atual será apagado (o Hall das Lendas{both ? ' e a carreira imersiva continuam' : ' continua'}).
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash}
                  onClick={async () => {
                    await abandon()
                    setConfirm(false)
                    close()
                    toast.info('Carreira abandonada')
                    navigate('/')
                  }}
                >
                  Abandonar
                </Button>
                <Button ref={cancelRef} variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button ref={abandonRef} variant="text" size="sm" icon={Trash} onClick={() => setConfirm(true)}>
              {both ? 'Abandonar a carreira clássica' : 'Abandonar carreira atual'}
            </Button>
          )}
        </>
      )}

      <p className="mt-4 mb-0 flex items-center gap-2 text-[11px] text-text-3">
        <FlagIcon size={12} aria-hidden />
        LENDA · dados {source === 'real' ? 'reais de 27/09/2026' : 'de exemplo'} · motor {engineKind === 'real' ? 'completo' : 'de exemplo'}
      </p>
    </Modal>
  )
}
