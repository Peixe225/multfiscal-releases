/**
 * Barra superior do Modo Imersivo, lado direito (slot `actions` do shell): saldo · OVR · caixa de
 * entrada · som · conquistas · menu. O menu é o do Imersivo: continuar/nova/abandonar mexem na
 * carreira IMERSIVA (nunca na clássica), mais navegação e ajustes (som, pular animações, movimento,
 * tempo dos lances).
 */
import { useState } from 'react'
import { CalendarDays, ChevronRight, Crown, Flag as FlagIcon, House, Menu, Radio, Repeat2, ScrollText, Settings2, Share2, Shirt, Trash, Trophy, UserRound, Volume2, VolumeX } from 'lucide-react'
import { navigate, useApp, type RoutePath } from '@/store/app'
import { useCareer } from '@/store/career'
import { useData } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Eyebrow, Hairline, IconButton, MedalIcon, Modal, Segmented, Switch, cx, toast } from '@/ui/primitives'
import { useAchievementCatalog } from '@/ui/shell/achievementsRegistry'
import { sfx } from '@/ui/shell/sfx'
import { ImDlgTitle } from '../bits'
import { goTab, ImTopActions, type ImTab } from './ImTopBar'

const readFlag = (k: string) => {
  try {
    return localStorage.getItem(k) === '1'
  } catch {
    return false
  }
}
const writeFlag = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function Row({ icon: Ico, label, sub, onClick, disabled }: { icon: typeof House; label: string; sub?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="im-menu__row lx-focus-inset" onClick={onClick} disabled={disabled}>
      <span className="im-menu__ic">
        <Ico size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="im-menu__l">{label}</span>
        {sub && <span className="im-menu__s">{sub}</span>}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="im-menu__chev" />
    </button>
  )
}

const TAB_ROWS: { tab: ImTab; label: string; icon: typeof House }[] = [
  { tab: 'central', label: 'Central da semana', icon: House },
  { tab: 'agenda', label: 'Agenda da temporada', icon: CalendarDays },
  { tab: 'social', label: 'Rede social', icon: Share2 },
  { tab: 'mercado', label: 'Mercado e contrato', icon: Repeat2 },
  { tab: 'carreira', label: 'Trajetória', icon: Shirt },
]

export function ImMenuDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useApp((s) => s.settings)
  const setSetting = useApp((s) => s.setSetting)
  const s = useImmersive((x) => x.state)
  const kind = useImmersive((x) => x.engineKind)
  const isFixture = useImmersive((x) => x.isFixture)
  const source = useData((x) => x.source)
  const [confirm, setConfirm] = useState(false)
  const [slow, setSlow] = useState(() => readFlag('lenda:imm:slowtimer'))
  const [noTimer, setNoTimer] = useState(() => readFlag('lenda:imm:notimer'))
  const locked = !!s?.live || !!s?.press
  const close = () => {
    setConfirm(false)
    onClose()
  }
  const go = (to: RoutePath, query?: Record<string, string>) => {
    sfx.play('click')
    close()
    navigate(to, query ? { query } : undefined)
  }
  const rmValue = settings.reducedMotion == null ? 'auto' : settings.reducedMotion ? 'on' : 'off'
  return (
    <Modal open={open} onClose={close} size="md" className="im-dlg" title={<ImDlgTitle kicker="Modo Imersivo">Menu</ImDlgTitle>}>
      {s && (
        <>
          <Eyebrow as="h3" className="mb-1">
            {s.identity.surname} · {s.age} anos · OVR {s.ovr}
          </Eyebrow>
          <div className="grid gap-1">
            {TAB_ROWS.map((r) => (
              <Row
                key={r.tab}
                icon={r.icon}
                label={r.label}
                sub={locked ? (s.live ? 'Termine a partida primeiro' : 'Termine a coletiva primeiro') : undefined}
                disabled={locked}
                onClick={() => {
                  sfx.play('click')
                  close()
                  goTab(r.tab)
                }}
              />
            ))}
            {s.seasons.length > 0 && <Row icon={Trophy} label="Último balanço" sub={`Temporada ${s.seasons[s.seasons.length - 1].season}`} disabled={locked} onClick={() => (close(), goTab('temporada'))} />}
          </div>
          <Hairline className="my-4" />
        </>
      )}
      <div className="grid gap-1">
        <Row icon={House} label="Início" onClick={() => go('/')} />
        <Row icon={UserRound} label="Nova carreira imersiva" sub="Começa do zero (a atual é substituída ao confirmar)" onClick={() => go('/identidade', { modo: 'imersivo' })} />
        <Row icon={Radio} label="Ligas ao vivo" sub="Tabelas reais de hoje" onClick={() => go('/ligas')} />
        <Row icon={Crown} label="Hall das Lendas" sub="Suas runs contra as lendas" onClick={() => go('/hall')} />
        <Row icon={ScrollText} label="Créditos" sub="Fotos, fontes, dados e licenças" onClick={() => go('/creditos')} />
      </div>

      <Hairline className="my-4" />
      <Eyebrow as="h3" className="flex items-center gap-2 mb-1">
        <Settings2 size={13} aria-hidden="true" /> Configurações
      </Eyebrow>
      <div className="grid">
        <Switch label="Som" description="Apito, torcida e efeitos sintetizados" checked={settings.sound} onChange={(v) => setSetting('sound', v)} />
        <Switch label="Pular animações" description="Revelações da gala, celebrações e coletiva sem espera" checked={settings.skipAnimations} onChange={(v) => setSetting('skipAnimations', v)} />
        <div className="flex items-center gap-3 min-h-[48px] flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">Reduzir movimento</div>
            <div className="text-[12px] text-text-3 mt-0.5">Sem raios, confete e câmera lenta</div>
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
        <Switch
          label="Lances com tempo ×2"
          description="Dobra o cronômetro dos lances decisivos"
          checked={slow}
          onChange={(v) => {
            setSlow(v)
            writeFlag('lenda:imm:slowtimer', v)
          }}
        />
        <Switch
          label="Lances sem cronômetro"
          description="Você decide com calma (acessibilidade)"
          checked={noTimer}
          onChange={(v) => {
            setNoTimer(v)
            writeFlag('lenda:imm:notimer', v)
          }}
        />
      </div>

      {s && !isFixture && (
        <>
          <Hairline className="my-4" />
          {confirm ? (
            <div className="im-menu__danger" role="alert">
              <p className="m-0 text-[13px] text-text-2">
                Abandonar a carreira imersiva de <b className="text-text">{s.identity.surname}</b>? O progresso será apagado (o Hall das Lendas e a carreira clássica continuam).
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash}
                  onClick={async () => {
                    await useImmersive.getState().abandon()
                    close()
                    toast.info('Carreira imersiva abandonada')
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
              Abandonar a carreira imersiva
            </Button>
          )}
        </>
      )}

      <p className="mt-4 mb-0 flex items-center gap-2 text-[11px] text-text-3">
        <FlagIcon size={12} aria-hidden="true" />
        LENDA · Modo Imersivo · dados {source === 'real' ? 'reais' : 'de exemplo'} · motor {kind === 'real' ? 'completo' : 'de exemplo'}
      </p>
    </Modal>
  )
}

/** Lado direito da barra no Imersivo (substitui o do Clássico: o menu dele mexe na carreira clássica). */
export function ImRightCluster() {
  const sound = useApp((x) => x.settings.sound)
  const toggle = useApp((x) => x.toggleSetting)
  const openDialog = useApp((x) => x.openDialog)
  const unseen = useCareer((x) => x.unseenAchievements.length)
  const unlocked = useCareer((x) => Object.keys(x.achievements).length)
  const total = useAchievementCatalog((x) => x.list.length)
  const [menu, setMenu] = useState(false)
  return (
    <>
      <ImTopActions />
      <IconButton label={sound ? 'Desativar som' : 'Ativar som'} icon={sound ? Volume2 : VolumeX} onClick={() => toggle('sound')} />
      <IconButton label={`Conquistas (${unlocked} de ${total})`} icon={MedalIcon} dot={unseen > 0} onClick={() => openDialog('achievements')} className="max-sm:hidden" />
      <IconButton label="Menu" icon={Menu} onClick={() => setMenu(true)} className={cx(menu && 'is-on')} />
      <ImMenuDialog open={menu} onClose={() => setMenu(false)} />
    </>
  )
}
