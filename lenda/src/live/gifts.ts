/**
 * Presentes do TikTok LIVE: catálogo de reserva (quando a ponte ainda não mandou a lista real da sala),
 * nomes em português e ícones.
 *
 * O TikTok envia o nome em inglês ("Rose"); a lista real (com imagem e preço) chega pela ponte assim que
 * ela conecta na live. Os preços abaixo são os usuais no Brasil e servem só para o simulador e para a
 * configuração antes de conectar.
 */
import type { LiveGiftInfo } from './types'

export interface GiftMeta extends LiveGiftInfo {
  /** Nome em português para a tela. */
  pt: string
  emoji: string
}

export const FALLBACK_GIFTS: GiftMeta[] = [
  { id: 'rose', name: 'Rose', pt: 'Rosa', coins: 1, emoji: '🌹' },
  { id: 'tiktok', name: 'TikTok', pt: 'TikTok', coins: 1, emoji: '🎵' },
  { id: 'gg', name: 'GG', pt: 'GG', coins: 1, emoji: '🎮' },
  { id: 'ice-cream', name: 'Ice Cream Cone', pt: 'Sorvete', coins: 1, emoji: '🍦' },
  { id: 'heart-me', name: 'Heart Me', pt: 'Coração', coins: 1, emoji: '💗' },
  { id: 'finger-heart', name: 'Finger Heart', pt: 'Coraçãozinho', coins: 5, emoji: '🫰' },
  { id: 'necklace', name: 'Friendship Necklace', pt: 'Colar da amizade', coins: 10, emoji: '📿' },
  { id: 'perfume', name: 'Perfume', pt: 'Perfume', coins: 20, emoji: '🧴' },
  { id: 'doughnut', name: 'Doughnut', pt: 'Rosquinha', coins: 30, emoji: '🍩' },
  { id: 'hand-hearts', name: 'Hand Hearts', pt: 'Mãos de coração', coins: 100, emoji: '🫶' },
  { id: 'corgi', name: 'Corgi', pt: 'Corgi', coins: 299, emoji: '🐶' },
  { id: 'money-gun', name: 'Money Gun', pt: 'Arma de dinheiro', coins: 500, emoji: '💸' },
  { id: 'galaxy', name: 'Galaxy', pt: 'Galáxia', coins: 1000, emoji: '🌌' },
  { id: 'lion', name: 'Lion', pt: 'Leão', coins: 29999, emoji: '🦁' },
]

/** Presente padrão de cada opção (1 a 4): os de 1 moeda mais comuns. */
export const DEFAULT_BINDINGS = ['Rose', 'TikTok', 'GG', 'Ice Cream Cone']

export const giftKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const BY_KEY = new Map<string, GiftMeta>()
for (const g of FALLBACK_GIFTS) {
  BY_KEY.set(giftKey(g.name), g)
  BY_KEY.set(giftKey(g.pt), g)
}

export function giftMeta(name: string): GiftMeta | undefined {
  return BY_KEY.get(giftKey(name))
}

/** Nome para a tela: "Rosa" para "Rose"; desconhecido → como veio. */
export function giftLabel(name: string): string {
  return giftMeta(name)?.pt ?? name
}

export function giftEmoji(name: string): string {
  return giftMeta(name)?.emoji ?? '🎁'
}

/** Mesmo presente? (por nome, ignorando acento/caixa/idioma do catálogo de reserva, ou por id). */
export function sameGift(a: Pick<LiveGiftInfo, 'id' | 'name'>, binding: string): boolean {
  if (!binding) return false
  const k = giftKey(binding)
  if (giftKey(a.name) === k || giftKey(a.id) === k) return true
  const meta = giftMeta(a.name)
  return !!meta && (giftKey(meta.pt) === k || giftKey(meta.name) === k)
}

/** Catálogo para a configuração: lista real da sala (ordenada por preço) ou o de reserva. */
export function giftCatalog(live: LiveGiftInfo[]): LiveGiftInfo[] {
  if (!live.length) return FALLBACK_GIFTS
  const seen = new Set<string>()
  return [...live]
    .filter((g) => {
      const k = giftKey(g.name)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name))
}
