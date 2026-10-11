/**
 * Chamadas na tela ("Comente 1, 2, 3 ou 4 para escolher", "Rosa = 10 pontos na opção 1", "Siga para ver a
 * próxima lenda nascer"…): frases curtas que giram a cada CTA_PERIOD_MS na faixa da live, para ensinar a
 * jogar quem acabou de chegar — numa sala vazia, é isso que segura o primeiro espectador.
 *
 *   const { items, hot } = ctaItems({ cfg, phase: 'vote', round: { options: 3, voted: false }, giftCoins })
 *   const item = pickCta(items, Date.now())
 *
 * Pura (sem React/store): a tela (LiveCallout.tsx) monta o contexto. Com a votação aberta e NINGUÉM votou
 * ainda, a chamada fica "quente" (mais chamativa) e FIXA no jeito grátis de jogar ("Seja o primeiro: comente
 * 1, 2 ou 3") — nos últimos segundos da sala vazia (config.quietSeconds) ela avisa que o destino vai escolher.
 * Girar preço de presente nessa hora faria o primeiro espectador ver só "pague" (e a rodada curta da sala
 * vazia nem dá tempo de girar); o presente de cada opção já aparece no chip/cartão dela, e os preços voltam a
 * girar depois do primeiro voto. Sem "comentário vale voto", o presente é o único jeito: aí giram o jeito de
 * votar e os presentes, intercalados e contados do começo da rodada (a primeira chamada é sempre como votar).
 */
import type { LiveConfig } from './config'
import { giftLabel } from './gifts'
import { isOffensive } from './identity'

export const CTA_PERIOD_MS = 6000
/** Nos últimos segundos da sala vazia a chamada quente vira o aviso "o destino escolhe em N s". */
export const CTA_QUIET_WARN_S = 5
/** Endereço do jogo grátis (site público) — o mesmo do guia e dos criativos. */
export const CTA_SITE = 'oprojeto.online/lenda'
export const CTA_CUSTOM_MAX = 80

export type CtaKind = 'vote' | 'gift' | 'quiet' | 'bid' | 'creator' | 'site' | 'follow' | 'custom'

export interface CtaItem {
  id: string
  kind: CtaKind
  text: string
  /** Presente da chamada (a tela mostra o ícone dele). */
  gift?: string
}

/** Fase da live, do jeito que as chamadas precisam (a tela decide pela store). */
export type CtaPhase = 'vote' | 'bidding' | 'creating' | 'other'

export interface CtaContext {
  cfg: Pick<LiveConfig, 'commentVotes' | 'giftBindings' | 'pointsPerCoin' | 'creator' | 'nameMode' | 'ctaCustom' | 'unboundGiftsFollowComment'>
  phase: CtaPhase
  /**
   * Votação aberta: quantas opções, se alguém já votou, (sala vazia) em quantos segundos o destino escolhe e
   * quando começou (a rodada quente conta as chamadas a partir daí).
   */
  round?: { options: number; voted: boolean; quietIn?: number | null; startedAt?: number } | null
  /** Moedas de um presente (catálogo da sala ou o de reserva). */
  giftCoins: (name: string) => number
}

/** "1, 2, 3 ou 4" · "1 ou 2". */
export function numberList(n: number): string {
  const nums = Array.from({ length: Math.max(1, n) }, (_, i) => String(i + 1))
  return nums.length > 1 ? `${nums.slice(0, -1).join(', ')} ou ${nums[nums.length - 1]}` : nums[0]
}

/** A frase do streamer como vai para a tela: aparada, sem espaços repetidos, até CTA_CUSTOM_MAX — ou null (vazia/palavrão). */
export function cleanCustomCta(raw: string): string | null {
  const t = Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, CTA_CUSTOM_MAX).join('').trim()
  return t && !isOffensive(t) ? t : null
}

/** `anchor`: de onde o rodízio conta (começo da rodada quente; sem = o relógio). */
export function ctaItems(ctx: CtaContext): { items: CtaItem[]; hot: boolean; anchor?: number } {
  const { cfg, phase } = ctx
  const n = Math.max(1, Math.min(4, ctx.round?.options ?? 4))
  const list = numberList(n)
  const ppc = Math.max(0, cfg.pointsPerCoin)
  const gifts: CtaItem[] = []
  if (ppc > 0)
    cfg.giftBindings.slice(0, n).forEach((g, i) => {
      if (!g) return
      const pts = Math.max(1, ctx.giftCoins(g)) * ppc
      gifts.push({ id: `gift:${i}`, kind: 'gift', gift: g, text: `${giftLabel(g)} = ${pts} ${pts === 1 ? 'ponto' : 'pontos'} na opção ${i + 1}` })
    })
  const custom = cleanCustomCta(cfg.ctaCustom ?? '')
  const creator: CtaItem | null =
    cfg.creator === 'disputa'
      ? { id: 'creator', kind: 'creator', text: 'Quem doar mais cria a próxima lenda' }
      : cfg.creator === 'apoiador'
        ? { id: 'creator', kind: 'creator', text: 'Quem mais doar nesta carreira cria a próxima lenda' }
        : cfg.nameMode === 'apoiador'
          ? { id: 'creator', kind: 'creator', text: 'O maior apoiador dá nome à próxima lenda' }
          : null
  const extras: CtaItem[] = [
    ...(creator ? [creator] : []),
    { id: 'site', kind: 'site', text: `Jogue grátis: ${CTA_SITE}` },
    { id: 'follow', kind: 'follow', text: 'Siga para ver a próxima lenda nascer' },
    ...(custom ? [{ id: 'custom', kind: 'custom' as const, text: custom }] : []),
  ]
  const vote: CtaItem = cfg.commentVotes
    ? { id: 'vote', kind: 'vote', text: `Comente ${list} para escolher` }
    : { id: 'vote', kind: 'vote', text: 'Mande o presente da opção para escolher' }

  if (phase === 'vote' && ctx.round) {
    if (!ctx.round.voted) {
      // ninguém votou ainda: só o essencial, e chamativo (ver o comentário do topo)
      const q = ctx.round.quietIn
      const ending = q != null && q > 0 && q <= CTA_QUIET_WARN_S
      const anchor = ctx.round.startedAt
      if (cfg.commentVotes) {
        // o id fica o mesmo no aviso: a tela troca o texto no lugar, sem reentrar
        const item: CtaItem = ending ? { id: 'vote', kind: 'quiet', text: `Comente ${list} já · sem votos, o destino escolhe em ${q} s` } : { id: 'vote', kind: 'vote', text: `Seja o primeiro: comente ${list}` }
        return { items: [item], hot: true, ...(anchor != null ? { anchor } : {}) }
      }
      const how: CtaItem = ending ? { id: 'vote', kind: 'quiet', text: `Mande o presente da opção · sem votos, o destino escolhe em ${q} s` } : vote
      // jeito de votar intercalado com cada presente: [votar, presente 1, votar, presente 2…]
      const items = gifts.length ? gifts.flatMap((g) => [how, g]) : [how]
      return { items: ending ? [how] : items, hot: true, ...(anchor != null ? { anchor } : {}) }
    }
    const others: CtaItem[] = cfg.unboundGiftsFollowComment && ppc > 0 && cfg.commentVotes ? [{ id: 'others', kind: 'gift', text: 'Outro presente vale para o número que você comentou' }] : []
    return { items: [vote, ...gifts, ...others, ...extras], hot: false }
  }
  if (phase === 'bidding') return { items: [{ id: 'bid', kind: 'bid', text: 'Qualquer presente vale lance: o maior cria a lenda' }, ...extras.filter((x) => x.kind !== 'creator')], hot: false }
  if (phase === 'creating') return { items: extras.filter((x) => x.kind !== 'creator'), hot: false }
  // entre votações (simulando, fim de carreira, anúncio): como funciona + o resto
  const how: CtaItem = cfg.commentVotes ? { id: 'vote', kind: 'vote', text: 'Cada decisão é sua: comente o número da opção' } : { id: 'vote', kind: 'vote', text: 'Cada decisão é sua: mande o presente da opção' }
  return { items: [how, ...extras], hot: false }
}

/**
 * A chamada da vez: gira pelo relógio (todas as janelas mostram a mesma, e recarregar não recomeça). Com
 * `anchor` (começo da rodada quente), conta a partir dele: a primeira chamada da rodada é sempre a primeira da lista.
 */
export function pickCta(items: readonly CtaItem[], now: number, period = CTA_PERIOD_MS, anchor = 0): CtaItem | null {
  if (!items.length) return null
  const i = Math.floor(Math.max(0, now - anchor) / period) % items.length
  return items[i]
}
