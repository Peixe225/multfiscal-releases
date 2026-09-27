/**
 * Menu (sheet on phones, dialog on desktop): navigation, settings, abandon career.
 */
import { useState } from 'react'
import { ChevronRight, Crown, Flag as FlagIcon, House, ChartLine, Play, Radio, Settings2, Sparkles, Trash, UserRound } from 'lucide-react'
import { navigate, useApp, type RoutePath } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { useData } from '@/store/data'
import { Button, Eyebrow, Hairline, Modal, Segmented, Switch, toast } from '@/ui/primitives'
import { sfx } from './sfx'

function NavRow({ icon: Ico, label, sub, to, onGo }: { icon: typeof House; label: string; sub?: string; to: RoutePath; onGo: () => void }) {
  return (
    <button
      type="button"
      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
      onClick={() => {
        sfx.play('click')
        onGo()
        navigate(to)
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
  const settings = useApp((s) => s.settings)
  const setSetting = useApp((s) => s.setSetting)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const engineKind = useCareer((s) => s.engineKind)
  const isFixture = useCareer((s) => s.isFixture)
  const abandon = useCareer((s) => s.abandon)
  const source = useData((s) => s.source)
  const [confirm, setConfirm] = useState(false)

  const rmValue = settings.reducedMotion == null ? 'auto' : settings.reducedMotion ? 'on' : 'off'
  return (
    <Modal open={open} onClose={() => (setConfirm(false), close())} title="Menu" size="md">
      <div className="grid gap-1">
        <NavRow icon={House} label="Início" to="/" onGo={close} />
        {active && state && <NavRow icon={Play} label="Continuar carreira" sub={`${state.identity.surname} · ${state.age} anos · OVR ${state.ovr}`} to="/carreira" onGo={close} />}
        <NavRow icon={UserRound} label="Nova carreira" sub="Modo Clássico" to="/identidade" onGo={close} />
        {state && <NavRow icon={ChartLine} label="Resumo da carreira" to="/resumo" onGo={close} />}
        <NavRow icon={Radio} label="Ligas ao vivo" sub="Tabelas reais de hoje" to="/ligas" onGo={close} />
        <NavRow icon={Crown} label="Hall da Fama" sub="Suas carreiras anteriores" to="/hall" onGo={close} />
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
            <div className="rounded-md p-3 bg-negative-bg border border-[rgba(255,94,120,.22)]">
              <p className="m-0 text-[13px] text-text-2">
                Abandonar a carreira de <b className="text-text">{state.identity.surname}</b>? O progresso atual será apagado (o Hall da Fama continua).
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
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="text" size="sm" icon={Trash} onClick={() => setConfirm(true)}>
              Abandonar carreira atual
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
