/**
 * Live interativa (TikTok LIVE): tipos compartilhados entre a ponte local (live/ponte.mjs), o simulador,
 * a votação e a interface.
 *
 *   ponte/TikFinity/simulador ──(WebSocket JSON)──▶ protocol.parseMessage ──▶ store.ingest ──▶ votes
 */

/** De onde vêm os eventos da live. */
export type LiveSource = 'ponte' | 'tikfinity' | 'simulador'

export interface LiveUser {
  /** @ do TikTok (uniqueId) — identifica o votante. */
  id: string
  /** Apelido exibido. */
  name: string
  avatar?: string
}

export interface LiveGiftInfo {
  id: string
  /** Nome como o TikTok envia (em inglês: "Rose", "TikTok", "GG"…). */
  name: string
  /** Moedas (diamantes) por unidade. */
  coins: number
  image?: string
}

/** Presente cru: em sequência ("combo") o TikTok repete o evento com repeatCount crescente. */
export interface RawGiftEvent {
  type: 'gift-raw'
  user: LiveUser
  gift: LiveGiftInfo
  repeat: number
  streakable: boolean
  streakEnd: boolean
  group?: string
  at: number
}

export type LiveEvent =
  | { type: 'chat'; user: LiveUser; text: string; at: number }
  /** `count` = unidades NOVAS deste evento (já descontada a sequência). */
  | { type: 'gift'; user: LiveUser; gift: LiveGiftInfo; count: number; at: number }
  | { type: 'like'; user: LiveUser; count: number; total?: number; at: number }
  | { type: 'follow' | 'share' | 'join'; user: LiveUser; at: number }
  | { type: 'viewers'; count: number; at: number }

export type BridgeState = 'idle' | 'connecting' | 'connected' | 'offline' | 'error' | 'demo'

export interface BridgeStatus {
  state: BridgeState
  /** @ conectado. */
  user?: string
  roomId?: string
  message?: string
}

/** Mensagens de controle que a ponte manda além dos eventos. */
export type BridgeMessage =
  | { type: 'status'; status: BridgeStatus }
  | { type: 'gifts'; list: LiveGiftInfo[] }
  | { type: 'hello'; version: number; demo?: boolean }

export type Parsed = LiveEvent | RawGiftEvent | BridgeMessage
