/**
 * #/creditos — fotos de troféus e de eventos, bandeiras, ícones, fontes e fontes de dados, com o
 * aviso de que nomes e escudos aparecem só para identificação. Os créditos de fotos saem de
 * docs/CREDITOS.md (fonte única) e de PHOTO_CREDITS (src/ui/art/photos.ts).
 */
import { useMemo, type ComponentType, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowUpRight, Camera, Database, Flag as FlagIcon, ShieldCheck, Trophy, Type, type LucideProps } from 'lucide-react'
import creditsMd from '../../../../docs/CREDITOS.md?raw'
import { navigate } from '@/store/app'
import { useData } from '@/store/data'
import { TROPHIES } from '@/data/catalog/trophies'
import { PHOTO_CREDITS, photoUrl } from '@/ui/art/photos'
import { useShellSlots } from '@/ui/shell/slots'
import { Button, Eyebrow, Flag, useReducedMotion } from '@/ui/primitives'
import { parseCredits, type EventPhotoCredit } from './parse'
import './credits.css'

const TROPHY_NAME = new Map<string, string>()
for (const t of TROPHIES) {
  if (!TROPHY_NAME.has(t.id)) TROPHY_NAME.set(t.id, t.name)
  if (t.art && !TROPHY_NAME.has(t.art)) TROPHY_NAME.set(t.art, t.name)
}

const FLAGS = ['BRA', 'ARG', 'URU', 'FRA', 'ENG', 'ESP', 'GER', 'ITA', 'POR', 'NED', 'JPN', 'MAR', 'USA', 'MEX', 'NGA', 'KOR']

const FONTS: { name: string; family: string; weight: number; by: string; sample: string }[] = [
  { name: 'Inter', family: "'Inter Variable', system-ui, sans-serif", weight: 500, by: 'Rasmus Andersson', sample: 'Textos 1234' },
  { name: 'Inter Tight', family: "'Inter Tight Variable', system-ui, sans-serif", weight: 800, by: 'Rasmus Andersson', sample: 'Títulos' },
  { name: 'Barlow', family: "'Barlow', system-ui, sans-serif", weight: 600, by: 'Jeremy Tribby', sample: 'Rótulos' },
  { name: 'Barlow Condensed', family: "'Barlow Condensed', system-ui, sans-serif", weight: 700, by: 'Jeremy Tribby', sample: 'PLACARES 3 × 1' },
  { name: 'Cormorant Garamond', family: "'Cormorant Garamond Variable', Georgia, serif", weight: 600, by: 'Christian Thalmann', sample: 'Lendas' },
]

const SECTIONS = [
  { id: 'cr-trofeus', label: 'Troféus' },
  { id: 'cr-eventos', label: 'Fotos de eventos' },
  { id: 'cr-recursos', label: 'Bandeiras e ícones' },
  { id: 'cr-fontes', label: 'Fontes' },
  { id: 'cr-dados', label: 'Dados' },
] as const

function Ext({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>
  return (
    <a className={['cr-link', className].filter(Boolean).join(' ')} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight aria-hidden size={12} className="cr-link__ic" />
    </a>
  )
}

function SecHead({ id, icon: Ico, title, count, children }: { id: string; icon: ComponentType<LucideProps>; title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="cr-sec__head">
      <span className="cr-sec__ic" aria-hidden="true">
        <Ico size={18} />
      </span>
      <div className="min-w-0">
        <h2 id={id}>
          {title}
          {count != null && <span className="cr-count">{count}</span>}
        </h2>
        {children && <p>{children}</p>}
      </div>
    </div>
  )
}

function scrollTo(id: string, rm: boolean) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: rm ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

const base = () => import.meta.env.BASE_URL

export function CreditsScreen() {
  const rm = useReducedMotion()
  const generatedAt = useData((s) => s.data?.generatedAt)
  useShellSlots({ sub: 'CRÉDITOS', stage: { preset: 'brand' } }, [])

  const credits = useMemo(() => parseCredits(creditsMd), [])
  const photos = useMemo<EventPhotoCredit[]>(() => {
    const shows = new Map(credits.photos.map((p) => [p.file, p.shows]))
    return Object.entries(PHOTO_CREDITS).map(([file, c]) => ({ file, author: c.author, unsplashId: c.unsplashId, shows: shows.get(file) }))
  }, [credits])
  const day = generatedAt ? new Date(generatedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '27/09/2026'

  const rise = (i: number) => (rm ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: 0.04 * i, ease: [0.16, 1, 0.3, 1] as const } })

  return (
    <main id="conteudo" tabIndex={-1} className="cr-wrap outline-none">
      <motion.header className="cr-head" {...rise(0)}>
        <Eyebrow>LENDA · projeto pessoal e não comercial</Eyebrow>
        <h1>Créditos</h1>
        <p>As fotos, os ícones, as fontes e os dados que dão vida ao jogo. Toda imagem de terceiros aparece aqui com autor, fonte e licença.</p>
      </motion.header>

      <motion.aside className="cr-note" role="note" {...rise(1)}>
        <ShieldCheck size={20} aria-hidden className="cr-note__ic" />
        <p>
          <b>Só para identificação.</b> Nomes, escudos e cores de clubes, logos de ligas e os desenhos dos troféus pertencem aos seus donos (FIFA, UEFA, CONMEBOL, CBF, ligas e clubes) e
          aparecem aqui apenas para identificar times e competições. Nenhuma dessas entidades apoia o LENDA ou tem vínculo com ele. As licenças abaixo cobrem as <b>fotografias</b>, não as marcas.
        </p>
      </motion.aside>

      <motion.nav className="cr-toc no-scrollbar" aria-label="Seções dos créditos" {...rise(2)}>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className="cr-toc__chip" onClick={() => scrollTo(s.id, rm)}>
            {s.label}
          </button>
        ))}
      </motion.nav>

      {/* ── troféus ── */}
      <section id="cr-trofeus" tabIndex={-1} className="cr-sec lx-glass" aria-labelledby="cr-trofeus-h">
        <SecHead id="cr-trofeus-h" icon={Trophy} title="Troféus" count={credits.trophies.length}>
          Recortes de fotos do Wikimedia Commons: fundo removido, 720 px de altura, WebP. Quando não havia foto livre boa o bastante, o troféu usa arte SVG desenhada para o projeto.
        </SecHead>
        <ul className="cr-trophies" role="list">
          {credits.trophies.map((t) => {
            const id = t.file.replace(/\.webp$/, '')
            return (
              <li key={t.file} className="cr-trophy">
                <span className="cr-trophy__img" aria-hidden="true">
                  <img src={`${base()}trophies/${t.file}`} alt="" loading="lazy" decoding="async" draggable={false} />
                </span>
                <div className="cr-trophy__body">
                  <div className="cr-trophy__name">{TROPHY_NAME.get(id) ?? id}</div>
                  <div className="cr-meta">
                    Foto: <b>{t.author}</b>
                  </div>
                  <div className="cr-meta cr-meta--row">
                    <Ext href={t.licenseUrl} className="cr-lic">
                      {t.license}
                    </Ext>
                    <Ext href={t.url}>Commons</Ext>
                  </div>
                  {t.notes && <div className="cr-small">{t.notes}</div>}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="cr-small cr-after">
          Modificações em todos os recortes: corte na altura do troféu, remoção do fundo (BiRefNet-lite), limpeza das bordas e redimensionamento. Derivados de fotos CC BY-SA seguem a mesma licença.
        </p>
      </section>

      {/* ── fotos de eventos ── */}
      <section id="cr-eventos" tabIndex={-1} className="cr-sec lx-glass" aria-labelledby="cr-eventos-h">
        <SecHead id="cr-eventos-h" icon={Camera} title="Fotos de eventos" count={photos.length}>
          Os cards de decisão usam fotos do <Ext href="https://unsplash.com">Unsplash</Ext> sob a <Ext href="https://unsplash.com/license">Licença Unsplash</Ext>. O crédito não é obrigatório, mas cada autor está aqui.
        </SecHead>
        <ul className="cr-photos" role="list">
          {photos.map((p) => (
            <li key={p.file} className="cr-photo">
              <a className="cr-photo__img" href={`https://unsplash.com/photos/${p.unsplashId.replace(/^photo-/, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`${p.shows ?? p.file}, foto de ${p.author} no Unsplash`}>
                <img src={photoUrl(p.file)} alt="" loading="lazy" decoding="async" draggable={false} />
              </a>
              <div className="cr-photo__cap">
                <span className="cr-photo__shows">{p.shows ?? p.file}</span>
                <span className="cr-meta">{p.author}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="cr-small cr-after">Redimensionadas para 900 px de largura e recortadas para 3:2 quando verticais. Nos cards, o jogo aplica gradiente, vinheta e grão por cima.</p>
      </section>

      {/* ── bandeiras, ícones, escudos ── */}
      <section id="cr-recursos" tabIndex={-1} className="cr-sec lx-glass" aria-labelledby="cr-recursos-h">
        <SecHead id="cr-recursos-h" icon={FlagIcon} title="Bandeiras, ícones e escudos" />
        <div className="cr-flags" aria-hidden="true">
          {FLAGS.map((c) => (
            <Flag key={c} code={c} h={18} decorative />
          ))}
        </div>
        <dl className="cr-rows">
          <div className="cr-row">
            <dt>Bandeiras</dt>
            <dd>
              <Ext href="https://github.com/lipis/flag-icons">flag-icons</Ext>, de Panayiotis Lipiridis e colaboradores · <Ext href="https://github.com/lipis/flag-icons/blob/main/LICENSE">Licença MIT</Ext>
            </dd>
          </div>
          <div className="cr-row">
            <dt>Ícones</dt>
            <dd>
              <Ext href="https://lucide.dev">Lucide</Ext> · <Ext href="https://lucide.dev/license">Licença ISC</Ext>
            </dd>
          </div>
          <div className="cr-row">
            <dt>Escudos e logos</dt>
            <dd>Escudos de clubes e logos de ligas e copas vêm do CDN da ESPN. São marcas dos respectivos donos, usadas apenas para identificação.</dd>
          </div>
          <div className="cr-row">
            <dt>Troféus em SVG</dt>
            <dd>Desenhos próprios do projeto, inspirados nas taças reais.</dd>
          </div>
        </dl>
      </section>

      {/* ── fontes ── */}
      <section id="cr-fontes" tabIndex={-1} className="cr-sec lx-glass" aria-labelledby="cr-fontes-h">
        <SecHead id="cr-fontes-h" icon={Type} title="Fontes">
          Hospedadas no próprio jogo via <Ext href="https://fontsource.org">Fontsource</Ext>, todas sob a <Ext href="https://openfontlicense.org">SIL Open Font License 1.1</Ext>.
        </SecHead>
        <ul className="cr-fonts" role="list">
          {FONTS.map((f) => (
            <li key={f.name} className="cr-font">
              <span className="cr-font__sample" style={{ fontFamily: f.family, fontWeight: f.weight }}>
                {f.sample}
              </span>
              <span className="cr-font__name">{f.name}</span>
              <span className="cr-meta">{f.by} · OFL 1.1</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── dados ── */}
      <section id="cr-dados" tabIndex={-1} className="cr-sec lx-glass" aria-labelledby="cr-dados-h">
        <SecHead id="cr-dados-h" icon={Database} title="Dados" />
        <dl className="cr-rows">
          <div className="cr-row">
            <dt>ESPN</dt>
            <dd>
              Tabelas de {day}, clubes, cores, escudos, calendário e copas em andamento, da API pública da ESPN (endpoint não documentado, sem garantias). A tela <i>Ligas ao vivo</i> também consulta a ESPN quando você pede para atualizar.
            </dd>
          </div>
          <div className="cr-row">
            <dt>EA SPORTS FC 27 via fut.gg</dt>
            <dd>
              Notas dos jogadores, usadas como referência de força dos elencos e dos craques, obtidas pelo <Ext href="https://www.fut.gg">fut.gg</Ext>. “EA SPORTS FC” é marca da Electronic Arts. <b>Uso pessoal, não comercial.</b>
            </dd>
          </div>
          <div className="cr-row">
            <dt>Catálogos do LENDA</dt>
            <dd>Nomes em português, ligas, vagas continentais, troféus, eventos e carreiras de lendas: escritos à mão para o projeto.</dd>
          </div>
        </dl>
      </section>

      <footer className="cr-foot">
        <p>O uso desses dados e marcas vale apenas para uso pessoal e não comercial. Publicar ou monetizar o jogo exigiria rever cada item desta página.</p>
        <Button variant="ghost" size="md" icon={ArrowLeft} onClick={() => navigate('/')}>
          Voltar ao início
        </Button>
      </footer>
    </main>
  )
}

export default CreditsScreen
