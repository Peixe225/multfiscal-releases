/**
 * Rede social ("Arquibancada"): perfil com seguidores e humor da torcida, compositor com
 * respostas prontas (o jogo não tem texto livre), feed e "Em alta".
 */
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2, Send, Share2, TrendingUp } from 'lucide-react'
import type { ImmersiveState, SocialPost } from '@/engine/immersive/types'
import { navigate } from '@/store/app'
import { getClub } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { Button, Crest, clubVars, cx } from '@/ui/primitives'
import { CompLogo, PanelHead, TeamMark } from '../bits'
import { POST_TEMPLATES, type PostContext } from '../model/constants'
import { compactNumber, recentForm, relWeek, teamInfo } from '../model/view'

const slug = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
const hash = (str: string) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}
/** Torcedores fictícios (o motor manda um "Torcedor" genérico). */
const FANS = ['Carla Menezes', 'Zé da Geral', 'Duda Ferraz', 'Léo Arquibancada', 'Bia Tavares', 'Marcão do Setor Norte', 'Rafa Souza', 'Tia Nena', 'Gui Rocha', 'Paulinha Lima', 'Seu Jorge da Bandeira', 'Nando Faria', 'Júlia Prado', 'Beto Cardoso', 'Lari Campos', 'Dona Cida']

/** Autor e @ de exibição: nome variado para torcedores e @ sem sigla crua de 3 letras ("@bot_…"). */
export function displayAuthor(p: SocialPost, clubAbbr?: string, clubShort?: string): { name: string; handle: string } {
  let handle = p.handle
  if (clubAbbr && clubShort) {
    const re = new RegExp(`^@${clubAbbr}(?=[_.]|$)`, 'i')
    handle = handle.replace(re, `@${slug(clubShort)}`)
  }
  if (!p.byUser && !p.verified && /^torcedor(a)?( raiz)?$/i.test(p.author.trim())) {
    const name = FANS[hash(p.id) % FANS.length]
    const tail = /_(\w+)$/.exec(p.handle)?.[1] ?? String(hash(p.id) % 100)
    return { name, handle: `@${slug(name.split(' ')[0])}_${tail}` }
  }
  return { name: p.author, handle }
}

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

const MEDIA_RE = /gol|⚽|vit[oó]ria|derrota|empate|placar|fim de jogo|×|x /i

/** Um card de placar por semana de jogo: no primeiro post (clube, imprensa, você ou torcedor) que fala do jogo. */
function mediaPosts(s: ImmersiveState, list: SocialPost[]): Set<string> {
  const out = new Set<string>()
  const weeks = new Set<string>()
  const played = new Set(s.calendar.filter((c) => (c.kind === 'match' || c.kind === 'national_match') && c.result).map((c) => `${c.season}:${c.week}`))
  for (const p of list) {
    const k = `${p.season}:${p.week}`
    if (weeks.has(k) || !played.has(k) || !MEDIA_RE.test(p.text)) continue
    weeks.add(k)
    out.add(p.id)
  }
  return out
}

/** Mídia gerada (nunca foto real): placar do jogo da semana nos posts do clube, da imprensa e seus. */
function PostMedia({ p, s }: { p: SocialPost; s: ImmersiveState }) {
  const game = s.calendar.find((c) => c.season === p.season && c.week === p.week && (c.kind === 'match' || c.kind === 'national_match') && c.result)
  if (!game?.result) return null
  const national = game.kind === 'national_match'
  const us = teamInfo(national ? s.identity.nationality : s.clubId)
  const them = teamInfo(game.opponentId)
  const [H, A] = game.home === false ? [them, us] : [us, them]
  return (
    <div className="im-post__media" style={clubVars(us.colors) as CSSProperties} aria-label={`Placar: ${H.short} ${game.result.score[0]} a ${game.result.score[1]} ${A.short}`}>
      <span className="im-post__mk">
        <CompLogo id={game.competitionId} size={18} /> Fim de jogo{game.stage ? ` · ${game.stage}` : ''}
      </span>
      <span className="im-post__ms">
        <TeamMark team={H} size={38} />
        <b className="num">
          {game.result.score[0]}
          <i>–</i>
          {game.result.score[1]}
        </b>
        <TeamMark team={A} size={38} />
      </span>
      <span className="im-post__mn">
        {H.abbr} × {A.abbr}
      </span>
    </div>
  )
}

export const Post = memo(function Post({ p, s, i, withMedia }: { p: SocialPost; s: ImmersiveState; i: number; withMedia?: boolean }) {
  const [liked, setLiked] = useState(false)
  const club = getClub(s.clubId)
  const official = p.verified && club && (p.author === club.name || p.handle.toLowerCase().includes(club.shortName.toLowerCase().replace(/\s+/g, '')))
  const trending = p.likes > 10000
  const who = displayAuthor(p, club?.abbr, club?.shortName)
  const media = withMedia ?? ((official || p.byUser) && MEDIA_RE.test(p.text))
  return (
    <article className={cx('lx-plate lx-plate--flat lx-post im-post lx-anim-rise', official && 'lx-post--official', p.byUser && 'is-me')} style={{ ['--i' as string]: Math.min(i, 8), ...(official && club ? (clubVars(club) as CSSProperties) : {}) }}>
      {trending && <span className="im-post__ribbon">Em alta</span>}
      <span className={cx('lx-avatar im-post__av', official && 'lx-avatar--club', p.byUser && 'is-me')} data-tone={p.verified ? 'media' : 'fan'}>
        {p.byUser ? s.squadNumber : official && club ? <Crest club={club} size={28} decorative /> : initials(who.name)}
      </span>
      <div className="min-w-0">
        <header className="im-post__h">
          <span className="im-post__nm">{who.name}</span>
          {p.verified && <BadgeCheck size={15} className="im-post__ver" aria-label="Verificado" />}
          <span className="im-post__hd">
            {who.handle} · {relWeek(s, p.week, p.season)}
          </span>
        </header>
        {p.text && <p className="im-post__t">{rich(p.text)}</p>}
        {media && <PostMedia p={p} s={s} />}
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
  // o catálogo do motor pode não trazer "quando" cada modelo vale: usa o da UI pelo id
  const templates: { id: string; label: string; text: string; hint: string; when?: string[] }[] = (catalog ?? POST_TEMPLATES).map((t) => ({ ...t, when: t.when ?? POST_TEMPLATES.find((u) => u.id === t.id)?.when }))
  const list = templates.filter((t) => !s.clubId ? t.when?.includes('any') ?? !/gol|rival/i.test(t.label) : !t.when || t.when.some((w) => (ctx as string[]).includes(w))).slice(0, compact ? 3 : 6)
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
              <small className="im-hints">
                {t.hint.split(/\s*·\s*/).map((h) => (
                  <em key={h} className={cx(/[−-]|▼/.test(h) ? 'is-neg' : /\+|▲/.test(h) ? 'is-pos' : 'is-neu')}>
                    {h}
                  </em>
                ))}
              </small>
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
      <section className="lx-plate lx-c-md im-prof" style={club ? (clubVars(club) as CSSProperties) : undefined}>
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
        <div className="im-mood__pct">
          <span className="is-neg">
            <b className="num">{Math.round((neg / segs) * 100)}%</b> criticam
          </span>
          <span>
            <b className="num">{100 - Math.round((neg / segs) * 100) - Math.round((pos / segs) * 100)}%</b> neutros
          </span>
          <span className="is-pos">
            <b className="num">{Math.round((pos / segs) * 100)}%</b> apoiam
          </span>
        </div>
      </section>
    </>
  )
}

function Trending({ s }: { s: ImmersiveState }) {
  const tags = useMemo(() => {
    // mesma hashtag em caixas diferentes (#botafogo / #Botafogo) conta como uma só
    const m = new Map<string, { tag: string; n: number }>()
    const add = (tag: string, n: number) => {
      const k = tag.toLowerCase()
      const cur = m.get(k)
      m.set(k, { tag: cur?.tag ?? tag, n: (cur?.n ?? 0) + n })
    }
    for (const p of s.social) for (const h of p.text.match(/#[\wÀ-ú]+/g) ?? []) add(h, p.likes + p.reposts * 3)
    const club = getClub(s.clubId)
    if (club) add(`#${club.shortName.replace(/\s+/g, '')}`, 5000)
    add(`#${s.identity.surname.charAt(0).toUpperCase()}${s.identity.surname.slice(1).toLowerCase()}${s.squadNumber}`, 1200 + s.reputation * 900)
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((x) => [x.tag, x.n] as const)
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
  const feed = useMemo(() => s.social.slice(0, 30), [s.social])
  const withMedia = useMemo(() => mediaPosts(s, feed), [s, feed])
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
          {feed.map((p, i) => (
            <Post key={p.id} p={p} s={s} i={i} withMedia={withMedia.has(p.id)} />
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
