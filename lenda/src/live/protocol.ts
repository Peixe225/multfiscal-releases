/**
 * Tradução das mensagens que chegam pelo WebSocket para eventos da live.
 *
 * Aceita dois formatos:
 *   - o da ponte do LENDA (live/ponte.mjs): { type: 'chat' | 'gift-raw' | 'like' | … }
 *   - o do TikTok-Live-Connector / TikFinity: { event: 'gift', data: { … } } (campos v1 planos ou v2 aninhados)
 *
 * Presentes em sequência viram contagens NOVAS com createStreakTracker (o TikTok reenvia o mesmo presente
 * com repeatCount 1, 2, 3… e um último evento com repeatEnd).
 */
import type { LiveEvent, LiveGiftInfo, LiveUser, Parsed, RawGiftEvent } from './types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}
const firstUrl = (img: unknown): string | undefined => {
  if (!isObj(img)) return str(img)
  const list = (img.url ?? img.urlList ?? img.url_list ?? img.urls) as unknown
  if (Array.isArray(list)) return list.map(str).find(Boolean)
  return str(img.giftPictureUrl) ?? str(img.uri)
}

export function userOf(d: Obj): LiveUser {
  const u = isObj(d.user) ? d.user : d
  const id = str(u.uniqueId) ?? str(d.uniqueId) ?? str(u.displayId) ?? str(u.userId) ?? str(d.userId) ?? 'anonimo'
  const name = str(u.nickname) ?? str(d.nickname) ?? id
  const avatar = str(u.profilePictureUrl) ?? str(d.profilePictureUrl) ?? firstUrl(u.profilePicture) ?? firstUrl(u.avatarThumb)
  return { id, name, ...(avatar ? { avatar } : {}) }
}

export function giftOf(d: Obj): { gift: LiveGiftInfo; giftType?: number } {
  const det = isObj(d.giftDetails) ? d.giftDetails : isObj(d.gift) ? d.gift : {}
  const ext = isObj(d.extendedGiftInfo) ? d.extendedGiftInfo : {}
  const name = str(det.giftName) ?? str(d.giftName) ?? str(ext.name) ?? str(det.name) ?? 'Presente'
  const id = str(d.giftId) ?? str(det.id) ?? str(ext.id) ?? name
  const coins = num(det.diamondCount) ?? num(d.diamondCount) ?? num(ext.diamond_count) ?? num(ext.diamondCount) ?? 1
  const image =
    str(d.giftPictureUrl) ?? firstUrl(det.giftImage) ?? firstUrl(det.icon) ?? firstUrl(det.image) ?? firstUrl(ext.image) ?? firstUrl(ext.icon)
  const giftType = num(det.giftType) ?? num(det.type) ?? num(d.giftType) ?? num(ext.type)
  return { gift: { id, name, coins: Math.max(0, coins), ...(image ? { image } : {}) }, giftType }
}

function rawGift(d: Obj, at: number): RawGiftEvent {
  const { gift, giftType } = giftOf(d)
  const repeat = Math.max(1, num(d.repeatCount) ?? num(d.repeat_count) ?? num(d.comboCount) ?? 1)
  const end = d.repeatEnd ?? d.repeat_end
  return {
    type: 'gift-raw',
    user: userOf(d),
    gift,
    repeat,
    streakable: giftType === 1,
    streakEnd: end === true || end === 1 || end === '1',
    ...(str(d.groupId) ? { group: str(d.groupId) } : {}),
    at,
  }
}

/** Formato TikTok-Live-Connector / TikFinity: { event, data }. */
function fromConnector(event: string, d: Obj, at: number): Parsed | null {
  switch (event) {
    case 'chat':
    case 'comment': {
      const text = str(d.comment) ?? str(d.content) ?? ''
      return text ? { type: 'chat', user: userOf(d), text, at } : null
    }
    case 'gift':
      return rawGift(d, at)
    case 'like':
      return { type: 'like', user: userOf(d), count: Math.max(1, num(d.likeCount) ?? num(d.count) ?? 1), ...((num(d.totalLikeCount) ?? num(d.total)) != null ? { total: num(d.totalLikeCount) ?? num(d.total) } : {}), at }
    case 'follow':
      return { type: 'follow', user: userOf(d), at }
    case 'share':
      return { type: 'share', user: userOf(d), at }
    case 'social': {
      const kind = `${str(d.displayType) ?? ''} ${str(d.label) ?? ''}`.toLowerCase()
      if (kind.includes('follow')) return { type: 'follow', user: userOf(d), at }
      if (kind.includes('share')) return { type: 'share', user: userOf(d), at }
      return null
    }
    case 'member':
      return { type: 'join', user: userOf(d), at }
    case 'roomUser': {
      const count = num(d.viewerCount) ?? num(d.total) ?? num(d.totalUser)
      return count != null ? { type: 'viewers', count, at } : null
    }
    default:
      return null
  }
}

/** Formato da ponte do LENDA (e do simulador): já normalizado. */
function fromBridge(m: Obj, at: number): Parsed | null {
  const t = str(m.type)
  const ts = num(m.at) ?? at
  switch (t) {
    case 'chat':
      return isObj(m.user) && str(m.text) ? { type: 'chat', user: userOf(m), text: str(m.text)!, at: ts } : null
    case 'gift-raw':
      return isObj(m.user) && isObj(m.gift)
        ? {
            type: 'gift-raw',
            user: userOf(m),
            gift: giftOf({ giftDetails: { giftName: (m.gift as Obj).name, diamondCount: (m.gift as Obj).coins, id: (m.gift as Obj).id, giftImage: (m.gift as Obj).image } }).gift,
            repeat: Math.max(1, num(m.repeat) ?? 1),
            streakable: m.streakable === true,
            streakEnd: m.streakEnd === true,
            ...(str(m.group) ? { group: str(m.group) } : {}),
            at: ts,
          }
        : null
    case 'like':
      return isObj(m.user) ? { type: 'like', user: userOf(m), count: Math.max(1, num(m.count) ?? 1), ...(num(m.total) != null ? { total: num(m.total) } : {}), at: ts } : null
    case 'follow':
    case 'share':
    case 'join':
      return isObj(m.user) ? { type: t, user: userOf(m), at: ts } : null
    case 'viewers':
      return num(m.count) != null ? { type: 'viewers', count: num(m.count)!, at: ts } : null
    case 'status':
      return isObj(m.status) ? { type: 'status', status: m.status as never } : null
    case 'gifts':
      return Array.isArray(m.list)
        ? {
            type: 'gifts',
            list: (m.list as unknown[]).filter(isObj).map((g) => ({ id: str(g.id) ?? str(g.name) ?? '?', name: str(g.name) ?? '?', coins: num(g.coins) ?? 1, ...(str(g.image) ? { image: str(g.image) } : {}) })),
          }
        : null
    case 'hello':
      return { type: 'hello', version: num(m.version) ?? 1, ...(m.demo === true ? { demo: true } : {}) }
    default:
      return null
  }
}

/** Uma mensagem do WebSocket (texto JSON ou objeto) → zero ou mais eventos. */
export function parseMessage(raw: unknown, now = Date.now()): Parsed[] {
  let m: unknown = raw
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (Array.isArray(m)) return m.flatMap((x) => parseMessage(x, now))
  if (!isObj(m)) return []
  const ev = str(m.event)
  if (ev) {
    const out = fromConnector(ev, isObj(m.data) ? m.data : m, now)
    return out ? [out] : []
  }
  const out = fromBridge(m, now)
  return out ? [out] : []
}

/**
 * Conta só as unidades NOVAS de presentes em sequência.
 *   envio único de presente "combo": repeat 1 (sem fim) + repeat 1 (fim) → 1
 *   sequência 1,2,3,4,5 + fim(5) → 5
 *   presente comum (não combo) → repeat (normalmente 1)
 */
export function createStreakTracker(ttlMs = 120_000) {
  const last = new Map<string, { r: number; at: number }>()
  let calls = 0
  return (g: RawGiftEvent): number => {
    const r = Math.max(1, Math.floor(g.repeat || 1))
    if (!g.streakable) return r
    if (++calls % 200 === 0) for (const [k, v] of last) if (g.at - v.at > ttlMs) last.delete(k)
    const key = `${g.user.id}|${g.gift.id}|${g.group ?? ''}`
    const prev = last.get(key)?.r ?? 0
    const delta = r > prev ? r - prev : r < prev ? r : 0
    if (g.streakEnd) last.delete(key)
    else last.set(key, { r, at: g.at })
    return delta
  }
}

/** Atalho: Parsed (com presentes crus) → LiveEvent com presentes já contados. */
export function resolveGift(p: RawGiftEvent, tracker: (g: RawGiftEvent) => number): LiveEvent | null {
  const count = tracker(p)
  return count > 0 ? { type: 'gift', user: p.user, gift: p.gift, count, at: p.at } : null
}
