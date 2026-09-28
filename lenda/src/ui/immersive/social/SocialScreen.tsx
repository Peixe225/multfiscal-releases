/**
 * Rede social ("Arquibancada"): perfil com seguidores e humor da torcida, compositor com
 * respostas prontas (o jogo não tem texto livre), feed e "Em alta".
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2, Send, Share2, TrendingUp } from 'lucide-react'
import type { ImmersiveState, SocialPost } from '@/engine/immersive/types'
import { navigate } from '@/store/app'
import { getClub } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Crest, cx } from '@/ui/primitives'
import { PanelHead } from '../bits'
import { POST_TEMPLATES, type PostContext } from '../model/constants'
import { compactNumber, recentForm } from '../model/view'

/** Seguidores: o motor pode guardar na memória opaca; senão estimamos pela fama. */
export function followersOf(s: ImmersiveState): number {
  if (typeof s.followers === 'number') return s.followers
  const f = (s.engine as Record<string, unknown>)?.followers
  return typeof f === 'number' ? f : Math.round(1800 * Math.pow(1.085, s.reputation))
}

const rich = (text: string): ReactNode[] =>
  text.split(/(\s+)/).map((w, i) =>
    /^[@#][\wÀ-ú]+/.test(w) ? (
      <span key={i} className="lx-handle">
        {w}
      </span>
    ) : (
      w
    ),
  )

const initials = (name: string) =>
  name
    .replace(/[@(].*$/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase() || '?'

export const Post = memo(function Post({ p, s, i }: { p: SocialPost; s: ImmersiveState; i: number }) {
  const [liked, setLiked] = useState(false)
  const club = getClub(s.clubId)
  const official = p.verified && club && (p.author === club.name || p.handle.toLowerCase().includes(club.shortName.toLowerCase().replace(/\s+/g, '')))
  const trending = p.likes > 10000
  return (
    <article className={cx('lx-plate lx-plate--flat lx-post im-post lx-anim-rise', official && 'lx-post--official', p.byUser && 'is-me')} style={{ ['--i' as string]: Math.min(i, 8) }}>
      {trending && <span className="im-post__ribbon">Em alta</span>}
      <span className={cx('lx-avatar im-post__av', official && 'lx-avatar--club', p.byUser && 'is-me')} data-tone={p.verified ? 'media' : 'fan'}>
        {p.byUser ? s.squadNumber : official && club ? <Crest club={club} size={28} decorative /> : initials(p.author)}
      </span>
      <div className="min-w-0">
        <header className="im-post__h">
          <span className="im-post__nm">{p.author}</span>
          {p.verified && <BadgeCheck size={15} className="im-post__ver" aria-label="Verificado" />}
          <span className="im-post__hd">
            {p.handle} · sem {p.week}
          </span>
        </header>
        {p.text && <p className="im-post__t">{rich(p.text)}</p>}
        <div className="im-post__acts">
          <button type="button" className="lx-post__action" aria-label="Respostas">
            <MessageCircle aria-hidden="true" />
            {compactNumber(Math.round(p.likes * 0.04))}
          </button>
          <button type="button" className="lx-post__action" aria-label="Repostagens">
            <Repeat2 aria-hidden="true" />
            {compactNumber(p.reposts)}
          </button>
          <button type="button" className="lx-post__action is-like" aria-pressed={liked} onClick={() => setLiked(!liked)} aria-label="Curtir">
            <Heart aria-hidden="true" fill={liked ? 'currentColor' : 'none'} />
            {compactNumber(p.likes + (liked ? 1 : 0))}
          </button>
          <span className="lx-post__action max-sm:hidden">
            <Eye aria-hidden="true" />
            {compactNumber(p.likes * 11)}
          </span>
        </div>
      </div>
    </article>
  )
})

function postContext(s: ImmersiveState, scored: boolean): PostContext[] {
  const last = recentForm(s, 1)[0]
  const ctx: PostContext[] = ['any']
  if (scored) ctx.push('goal')
  if (last === 'V') ctx.push('win')
  if (last === 'E') ctx.push('draw')
  if (last === 'D') ctx.push('loss')
  return ctx
}

export function Composer({ s, compact }: { s: ImmersiveState; compact?: boolean }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const lastMatch = useImmersive((x) => x.lastMatch)
  const [posted, setPosted] = useState<string | null>(null)
  const scored = !!lastMatch && lastMatch.stats.goals > 0
  const ctx = postContext(s, scored)
  const catalog = useImmersive((x) => x.catalog.postTemplates)
  const templates: { id: string; label: string; text: string; hint: string; when?: string[] }[] = catalog ?? POST_TEMPLATES
  const list = templates.filter((t) => !t.when || t.when.some((w) => (ctx as string[]).includes(w))).slice(0, compact ? 3 : 6)
  const postedThisWeek = s.social.some((p) => p.byUser && p.week === s.week && p.season === s.season)
  return (
    <div className={cx('lx-plate lx-plate--flat lx-c-sm im-compose', compact && 'is-compact')}>
      <span className="lx-kicker">{lastMatch ? 'Postar após o jogo' : 'Postar'}</span>
      {postedThisWeek && !posted ? (
        <p className="lx-t-small m-0 mt-2">Você já postou nesta semana. Volte depois do próximo jogo.</p>
      ) : (
        <div className="im-compose__opts">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cx('lx-btn lx-btn--line lx-btn--xs im-compose__opt', posted === t.id && 'is-on')}
              disabled={busy || !!posted}
              title={t.text || 'Não postar nada'}
              onClick={() => {
                setPosted(t.id)
                void dispatch({ type: 'social_post', templateId: t.id })
              }}
            >
              <span>{t.label}</span>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Profile({ s }: { s: ImmersiveState }) {
  const club = getClub(s.clubId)
  const f = followersOf(s)
  const fans = s.relationships.fans
  const segs = 12
  const pos = Math.round((fans / 100) * segs)
  const neg = Math.max(0, Math.round(((100 - fans) / 100) * segs * 0.55))
  return (
    <>
      <section className="lx-plate lx-c-md im-prof">
        <span className="lx-avatar lx-avatar--club im-prof__av">{s.squadNumber}</span>
        <div className="min-w-0">
          <div className="lx-t-card">{s.identity.surname}</div>
          <div className="lx-handle im-prof__h">
            @{s.identity.surname.toLowerCase()}
            {s.squadNumber} {s.reputation >= 20 && <BadgeCheck size={13} className="inline -mt-0.5" aria-label="Verificado" />}
          </div>
        </div>
        <span className="lx-label">Seguidores</span>
        <b className="im-prof__big num">{compactNumber(f)}</b>
        <span className="lx-chip lx-chip--sm lx-chip--pos-ok">
          <TrendingUp size={11} aria-hidden="true" /> Fama {s.reputation}/100
        </span>
        {club && <span className="lx-t-small">{club.name}</span>}
      </section>
      <section className="lx-plate lx-plate--flat lx-c-sm im-mood">
        <span className="lx-kicker">Humor da torcida</span>
        <div className="im-mood__segs" aria-label={`Torcida: ${fans}/100`}>
          {Array.from({ length: segs }).map((_, i) => (
            <i key={i} data-t={i < neg ? 'neg' : i >= segs - pos ? 'pos' : 'neu'} />
          ))}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="lx-label is-neg">Vaia</span>
          <span className="lx-label">Neutro</span>
          <span className="lx-label is-pos">Idolatria</span>
        </div>
      </section>
    </>
  )
}

function Trending({ s }: { s: ImmersiveState }) {
  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of s.social) for (const h of p.text.match(/#[\wÀ-ú]+/g) ?? []) m.set(h, (m.get(h) ?? 0) + p.likes + p.reposts * 3)
    const club = getClub(s.clubId)
    if (club) m.set(`#${club.shortName.replace(/\s+/g, '')}`, (m.get(`#${club.shortName.replace(/\s+/g, '')}`) ?? 0) + 5000)
    m.set(`#${s.identity.surname.charAt(0)}${s.identity.surname.slice(1).toLowerCase()}${s.squadNumber}`, 1200 + s.reputation * 900)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [s.social, s.clubId, s.identity, s.squadNumber, s.reputation])
  return (
    <section className="lx-plate lx-plate--flat lx-c-sm im-trend">
      <span className="lx-kicker">Em alta</span>
      <ol>
        {tags.map(([t, n], i) => (
          <li key={t}>
            <span className="lx-label">{i + 1}</span>
            <div>
              <b>{t}</b>
              <span>{compactNumber(Math.round(n / 10) * 10)} posts</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function SocialScreen() {
  const s = useImmersive((x) => x.state)!
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-social outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">Arquibancada · rede social</span>
          <h1 className="lx-t-display im-hub__title">Social</h1>
        </div>
      </header>
      <div className="im-social__grid">
        <aside className="im-social__l">
          <Profile s={s} />
        </aside>
        <section className="im-social__feed" aria-label="Feed">
          <Composer s={s} />
          {s.social.slice(0, 30).map((p, i) => (
            <Post key={p.id} p={p} s={s} i={i} />
          ))}
        </section>
        <aside className="im-social__r">
          <Trending s={s} />
        </aside>
      </div>
    </main>
  )
}

/** Prévia na Central. */
export const SocialMini = memo(function SocialMini({ s }: { s: ImmersiveState }) {
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-panel im-socialmini lx-anim-rise" style={{ ['--i' as string]: 8 }} aria-labelledby="im-soc-h">
      <PanelHead
        kicker={<span id="im-soc-h">Arquibancada</span>}
        icon={Share2}
        right={
          <Button variant="ghost" size="sm" icon={Send} onClick={() => navigate('/imersivo', { query: { tela: 'social' } })}>
            Abrir rede
          </Button>
        }
      />
      <div className="im-socialmini__grid">
        <Composer s={s} compact />
        {s.social.slice(0, 2).map((p, i) => (
          <Post key={p.id} p={p} s={s} i={i} />
        ))}
      </div>
    </section>
  )
})
