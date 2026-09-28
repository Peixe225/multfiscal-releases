/**
 * #/kit — design-system gallery for the foundation primitives (every state, both sizes) and
 * fixture loaders so other teams can screenshot their screens with realistic careers.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Bell, ChartLine, Crown, Gauge, Medal, Play, Save, Sparkles, Trophy, Volume2 } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer, type FixtureName } from '@/store/career'
import { useData } from '@/store/data'
import {
  AgeBadge,
  BallIcon,
  BootIcon,
  Button,
  Card,
  CardHeader,
  ClubChip,
  CountUp,
  Crest,
  EffectChip,
  Eyebrow,
  Flag,
  GoldPill,
  IconButton,
  Kbd,
  LivePill,
  Modal,
  Money,
  NewBadge,
  OvrBadge,
  OvrPill,
  Pill,
  Segmented,
  Skeleton,
  SkeletonText,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  YouBadge,
  formatMoney,
  toast,
} from '@/ui/primitives'
import { sfx, type SfxName } from './sfx'
import { useShellSlots } from './slots'

function Section({ title, eyebrow, children, className }: { title: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return (
    <Card as="section" radius="xl" className={className}>
      <CardHeader eyebrow={eyebrow} title={title} className="mb-3" />
      {children}
    </Card>
  )
}

const Row = ({ children, className }: { children: ReactNode; className?: string }) => <div className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}>{children}</div>

export default function KitScreen() {
  useShellSlots({ sub: 'DESIGN KIT' })
  const data = useData((s) => s.data)
  const source = useData((s) => s.source)
  const engineKind = useCareer((s) => s.engineKind)
  const loadFixture = useCareer((s) => s.loadFixture)
  const [pace, setPace] = useState<'intensa' | 'normal' | 'expressa'>('normal')
  const [tab, setTab] = useState<'carreira' | 'temporada' | 'premios' | 'mundo'>('carreira')
  const [tab2, setTab2] = useState<'a' | 'b' | 'c'>('a')
  const [foot, setFoot] = useState<'left' | 'right'>('right')
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [sw, setSw] = useState(true)
  const [cu, setCu] = useState(0)
  const [spin, setSpin] = useState<number | null>(null)

  // roulette demo: flash the chips, land on index 0
  useEffect(() => {
    if (spin === null) return
    if (spin >= 9) return
    const t = setTimeout(() => setSpin(spin + 1), 110 + spin * 30)
    return () => clearTimeout(t)
  }, [spin])

  const clubs = data?.clubs ?? []
  const pick = (id: string) => clubs.find((c) => c.id === id) ?? clubs[0]
  const showcase = ['e2029', 'e819', 'e874', 'e6086', 'e86', 'e382', 'e132', 'e160', 'e111', 'e9967'].map(pick).filter(Boolean)
  const fixtures: [FixtureName, string][] = [
    ['new', 'Início (base)'],
    ['mid', 'Meio (25 anos)'],
    ['end', 'Fim (39 anos)'],
    ['reveal', 'Revelação c/ troféus'],
  ]
  const sounds: SfxName[] = ['click', 'whoosh', 'tick', 'reveal', 'trophy', 'unlock', 'goal', 'save', 'miss', 'whistle', 'relegation']

  return (
    <main id="conteudo" tabIndex={-1} className="relative z-[1] w-full max-w-[1392px] mx-auto px-4 sm:px-6 pb-16 outline-none">
      <div className="flex flex-wrap items-end gap-4 pt-2 pb-5">
        <div className="min-w-0 flex-1">
          <Eyebrow>Fundação · Noite de Final</Eyebrow>
          <h1 className="font-display text-[30px] sm:text-[36px] font-extrabold tracking-[-0.03em] leading-[1.05] m-0 mt-1">Design kit</h1>
          <p className="text-text-2 text-[14px] mt-2 mb-0">
            Dados: <b className="text-text">{source === 'real' ? 'reais' : 'de exemplo'}</b> · motor: <b className="text-text">{engineKind ?? '…'}</b> · {clubs.length} clubes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {fixtures.map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant="ghost"
              icon={Play}
              onClick={async () => {
                await loadFixture(k)
                navigate('/carreira')
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section eyebrow="Rating" title="OVR — metal + graus" className="lg:col-span-2">
          <Row className="gap-6 items-end">
            {[52, 75, 87, 92, 96, 99].map((o) => (
              <div key={o} className="grid justify-items-center gap-4">
                <OvrBadge ovr={o} size="xl" delta={o === 87 ? 2 : o === 52 ? -1 : undefined} />
                <span className="text-[11px] font-bold text-text-3 tracking-[.12em]">{o >= 99 ? 'ÍCONE' : o >= 95 ? 'ELITE' : o >= 90 ? 'LENDA' : o >= 80 ? 'OURO' : o >= 70 ? 'PRATA' : 'BRONZE'}</span>
              </div>
            ))}
          </Row>
          <Row className="mt-5">
            {[40, 58, 78].map((w) => (
              <OvrBadge key={w} ovr={88} size={w} />
            ))}
            <OvrBadge ovr={64} size="sm" />
            <OvrBadge ovr={93} size="md" />
            <span className="w-px h-10 bg-border mx-1" aria-hidden />
            {[52, 66, 70, 79, 82, 87, 94, 97, 99].map((o) => (
              <OvrPill key={o} ovr={o} />
            ))}
            <OvrPill ovr={null} />
            <OvrPill ovr={87} pending />
            <OvrPill ovr={75} size="sm" />
            <OvrPill ovr={82} size="xs" />
          </Row>
          <Row className="mt-5">
            <OvrBadge key={cu} ovr={cu % 2 ? 91 : 91} from={69} countUp={{ duration: 1700, onStep: () => sfx.tick() }} size="xl" />
            <Button variant="ghost" size="sm" onClick={() => setCu((x) => x + 1)}>
              Repetir count-up 69 → 91
            </Button>
          </Row>
        </Section>

        <Section eyebrow="Controles" title="Botões">
          <Row>
            <Button variant="primary" iconRight={ArrowRight}>
              Começar carreira
            </Button>
            <Button variant="primary" pill>
              Pílula
            </Button>
            <Button variant="gold" icon={Trophy}>
              Celebrar
            </Button>
            <Button variant="ghost" icon={Play}>
              Continuar
            </Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="text">Texto</Button>
            <Button variant="danger">Perigo</Button>
          </Row>
          <Row className="mt-3">
            <Button variant="primary" size="xl" kbd="Enter">
              Confirmar
            </Button>
            <Button variant="primary" size="md">
              Médio
            </Button>
            <Button variant="ghost" size="sm" icon={Save} loading>
              Salvando
            </Button>
            <Button variant="ghost" size="sm" disabled>
              Desativado
            </Button>
          </Row>
          <Row className="mt-3">
            <IconButton label="Salvar" icon={Save} />
            <IconButton label="Som" icon={Volume2} pressed />
            <IconButton label="Conquistas" icon={Medal} dot />
            <IconButton label="Alertas" icon={Bell} count="12/48" size="lg" />
            <IconButton label="Pequeno" icon={Sparkles} size="sm" />
          </Row>
        </Section>

        <Section eyebrow="Controles" title="Segmented · Tabs · Switch">
          <div className="grid gap-4">
            <Row>
              <Eyebrow>Ritmo</Eyebrow>
              <Segmented
                aria-label="Ritmo"
                value={pace}
                onChange={setPace}
                options={[
                  { value: 'intensa', label: 'Intensa' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'expressa', label: 'Expressa' },
                ]}
              />
            </Row>
            <Segmented
              aria-label="Pé dominante"
              variant="solid"
              full
              value={foot}
              onChange={setFoot}
              options={[
                { value: 'left', label: 'Canhoto' },
                { value: 'right', label: 'Destro' },
              ]}
            />
            <Tabs
              aria-label="Painel da carreira"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'carreira', label: 'Carreira', icon: ChartLine },
                { value: 'temporada', label: 'Temporada 2035' },
                { value: 'premios', label: 'Prêmios', badge: 'BOLA 3º' },
                { value: 'mundo', label: 'Mundo' },
              ]}
            />
            <Tabs
              aria-label="Sublinhado"
              variant="underline"
              value={tab2}
              onChange={setTab2}
              tabs={[
                { value: 'a', label: 'Brasileirão' },
                { value: 'b', label: 'Libertadores' },
                { value: 'c', label: 'Copa do Brasil' },
              ]}
            />
            <Switch label="Som" description="Efeitos sonoros sintetizados" checked={sw} onChange={setSw} />
          </div>
        </Section>

        <Section eyebrow="Decisões" title="Pílulas de efeito + roleta">
          <div className="grid gap-2 max-w-[340px]">
            {[
              { kind: 'positive' as const, label: '+3 OVR', probability: 0.6 },
              { kind: 'negative' as const, label: '-2 OVR · adaptação', probability: 0.4 },
              { kind: 'fixed' as const, label: 'Capitão do time', probability: 1 },
              { kind: 'neutral' as const, label: 'Sem efeito', probability: 0.25 },
            ].map((e, i) => (
              <EffectChip key={i} effect={e} state={spin === null ? 'idle' : spin < 9 ? (spin % 4 === i ? 'flash' : 'idle') : i === 0 ? 'hit' : 'dim'} />
            ))}
            <Button variant="ghost" size="sm" className="justify-self-start mt-1" onClick={() => (sfx.play('whoosh'), setSpin(0))}>
              Girar roleta
            </Button>
          </div>
        </Section>

        <Section eyebrow="Clubes" title="Escudos · bandeiras · chips">
          <Row className="items-end">
            {[16, 20, 28, 48, 72, 120, 160].map((s, i) => (
              <Crest key={s} club={showcase[i % showcase.length]} size={s} />
            ))}
          </Row>
          <Row className="mt-4">
            {['BRA', 'ARG', 'ESP', 'ENG', 'FRA', 'GER', 'POR', 'ITA', 'URU', 'NED'].map((c) => (
              <Flag key={c} code={c} h={16} />
            ))}
            <Flag code="BRA" w={30} h={22} />
            <Flag iso2="xx" h={16} title="Desconhecida" />
          </Row>
          <div className="grid sm:grid-cols-2 gap-2 mt-4">
            {showcase.slice(0, 6).map((c, i) => (
              <div key={c.id} className="flex items-center gap-2.5 min-w-0">
                <AgeBadge age={16 + i * 2} club={c} current={i === 0} />
                <ClubChip club={c} loan={i === 2} />
              </div>
            ))}
            <ClubChip club={showcase[4]} size="lg" sub="LaLiga · Espanha" />
            <ClubChip club={showcase[5]} variant="chip" short />
          </div>
          <Row className="mt-3">
            <AgeBadge age={26} state="pending" />
            <AgeBadge age={33} state="empty" />
          </Row>
        </Section>

        <Section eyebrow="Status" title="Pílulas, tags e dinheiro">
          <Row>
            <Pill>Neutra</Pill>
            <Pill tone="positive">Pronto</Pill>
            <Pill tone="negative">Lesionado</Pill>
            <Pill tone="warning">Decisão pendente</Pill>
            <Pill tone="gold" icon={Crown}>
              8 títulos
            </Pill>
            <Pill tone="info">Defesa</Pill>
            <Pill tone="solid">Selecionado</Pill>
          </Row>
          <Row className="mt-3">
            <Tag kind="up">Acesso</Tag>
            <Tag kind="down">Rebaixado</Tag>
            <Tag kind="gold" icon={Trophy}>
              Bola 3º
            </Tag>
            <LivePill>Temporada 2026 ao vivo</LivePill>
            <GoldPill>CAMPEÃO</GoldPill>
            <YouBadge />
            <NewBadge />
            <Kbd>Esc</Kbd>
          </Row>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
            {[100_000, 380_000, 999_600, 5_500_000, 9_999_999, 45_000_000].map((v) => (
              <div key={v} className="rounded-sm bg-surface border border-border px-2 py-1.5 text-center">
                <div className="num text-[18px] font-extrabold">{formatMoney(v)}</div>
              </div>
            ))}
          </div>
          <Row className="mt-3">
            <Money value={68_000_000} from={54_000_000} countUp className="text-[30px] font-extrabold" />
            <Money value={14_000_000} delta className="text-[13px]" />
            <Money value={-3_000_000} delta className="text-[13px]" />
            <span className="inline-flex items-center gap-1.5 text-text-2 text-[13px]">
              <BallIcon size={15} /> <CountUp to={147} from={116} duration={900} className="num text-[20px] font-extrabold text-text" />
            </span>
            <span className="inline-flex items-center gap-1.5 text-text-2 text-[13px]">
              <BootIcon size={15} /> <span className="num text-[20px] font-extrabold text-text">58</span>
            </span>
          </Row>
        </Section>

        <Section eyebrow="Superfícies" title="Cards">
          <div className="grid sm:grid-cols-2 gap-3">
            <Card variant="flat" padding="sm">
              <Eyebrow>flat</Eyebrow>
              <p className="m-0 mt-1 text-[13px] text-text-2">Card em fluxo</p>
            </Card>
            <Card variant="well" padding="sm">
              <Eyebrow>well</Eyebrow>
              <p className="m-0 mt-1 text-[13px] text-text-2">Poço rebaixado</p>
            </Card>
            <Card variant="club" padding="md" className="sm:col-span-2 overflow-hidden" radius="xl">
              <div className="flex items-center gap-4">
                <OvrBadge ovr={87} size="lg" delta={2} />
                <div>
                  <div className="font-display font-black text-[30px] tracking-[-0.03em] leading-none">RIBEIRO</div>
                  <ClubChip clubId="e2029" className="mt-2" />
                </div>
              </div>
            </Card>
          </div>
        </Section>

        <Section eyebrow="Overlays" title="Modal · Sheet · Tooltip · Toast · Som">
          <Row>
            <Button variant="ghost" size="sm" onClick={() => setModal(true)}>
              Abrir modal
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSheet(true)}>
              Abrir sheet
            </Button>
            <Tooltip content="Próxima decisão em 2 temporadas">
              <Button variant="ghost" size="sm" icon={Gauge}>
                Tooltip
              </Button>
            </Tooltip>
          </Row>
          <Row className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => toast.info('Carreira salva automaticamente')}>
              Toast
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toast.success('Carreira salva', 'Continue de onde parou.')}>
              Sucesso
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toast.error('Não foi possível salvar')}>
              Erro
            </Button>
            <Button variant="gold" size="sm" onClick={() => toast.gold('Conquista desbloqueada', 'Bola de Ouro — vença a Bola de Ouro.', { icon: Medal })}>
              Conquista
            </Button>
          </Row>
          <Row className="mt-3">
            {sounds.map((n) => (
              <Button key={n} variant="text" size="sm" sfx={false} onClick={() => sfx.play(n)}>
                {n}
              </Button>
            ))}
          </Row>
          <div className="grid gap-2 mt-4">
            <Skeleton h={18} w="40%" />
            <SkeletonText lines={2} />
          </div>
        </Section>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="O Real Madrid bateu à sua porta"
        description="Depois do 3º lugar na Bola de Ouro, os merengues oferecem €95M."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" onClick={() => setModal(false)} data-autofocus>
              Assinar
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <EffectChip effect={{ kind: 'positive', label: '+3 OVR', probability: 0.6 }} />
          <EffectChip effect={{ kind: 'negative', label: '−2 OVR · adaptação', probability: 0.4 }} />
        </div>
      </Modal>
      <Modal open={sheet} onClose={() => setSheet(false)} mode="sheet" title="Sheet" description="Arraste a alça para baixo para fechar.">
        <SkeletonText lines={5} />
      </Modal>
    </main>
  )
}
