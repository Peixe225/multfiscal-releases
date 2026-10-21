/**
 * Código de convite de quem indicou (servidor/CONTRATO-v3.md §6): o link é `…/lenda/?c=<codigo>`. Na
 * primeira visita com `?c=`, o jogo guarda o código por 30 dias em localStorage['lenda:convite'] e manda no
 * `cadastrar`. Um segundo link (de outra pessoa) não troca o que já está guardado e válido — vale o primeiro
 * amigo que trouxe.
 *
 *   capturarConvite(location.search, ls)   // na abertura do site (depois da medição ler os utm)
 *   conviteGuardado(ls)                     // o código para mandar no cadastro (ou null)
 *   linkConvite(codigo)                     // https://oprojeto.online/lenda/?c=ABCD2345
 *   linkPerfil(codigo)                      // https://oprojeto.online/lenda/?c=ABCD2345#/jogador/ABCD2345 (v3.3)
 *   linkPrevia({ id, codigo })              // https://oprojeto.online/lenda/api/v.php?id=career-…&c=ABCD2345 (v3.4)
 */
import type { Armazem } from './medicao'

export const CHAVE_CONVITE = 'lenda:convite'
export const CONVITE_DIAS = 30
const DIA_MS = 86_400_000

/** 4 a 16 letras/números (o servidor gera 8, sem os ambíguos); o servidor confere de verdade. */
export const CODIGO_RE = /^[A-Za-z0-9]{4,16}$/

export function codigoValido(c: unknown): c is string {
  return typeof c === 'string' && CODIGO_RE.test(c)
}

/** O código guardado, se ainda não venceu (30 dias). */
export function conviteGuardado(a: Armazem, agora = Date.now()): string | null {
  try {
    const j = JSON.parse(a.get(CHAVE_CONVITE) || 'null') as { codigo?: unknown; em?: unknown } | null
    if (!j || !codigoValido(j.codigo) || typeof j.em !== 'number' || !Number.isFinite(j.em)) return null
    if (agora - j.em > CONVITE_DIAS * DIA_MS || j.em - agora > DIA_MS) return null
    return j.codigo
  } catch {
    return null
  }
}

/** Lê `?c=` do endereço e guarda (se não houver um válido guardado). Devolve o código lido (ou null). */
export function capturarConvite(search: string, a: Armazem, agora = Date.now()): string | null {
  let c: string | null = null
  try {
    c = new URLSearchParams(search).get('c')?.trim() ?? null
  } catch {
    c = null
  }
  if (!codigoValido(c)) return null
  if (!conviteGuardado(a, agora)) a.set(CHAVE_CONVITE, JSON.stringify({ codigo: c, em: agora }))
  return c
}

/** Depois do cadastro: o convite já foi usado. */
export function esquecerConvite(a: Armazem) {
  a.set(CHAVE_CONVITE, '')
}

/** Endereço público do jogo (a pasta, com a barra), de onde o jogo está rodando. */
export function enderecoDoJogo(): string {
  if (typeof location === 'undefined') return 'https://oprojeto.online/lenda/'
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`
}

export function linkConvite(codigo: string | null | undefined, base = enderecoDoJogo()): string {
  return codigoValido(codigo) ? `${base}?c=${encodeURIComponent(codigo)}` : base
}

/**
 * O link do perfil público (v3.3): `…/lenda/?c=<código>#/jogador/<código>` — o mesmo código do convite, então quem abre
 * o perfil de alguém também chega como convidado dele.
 */
export function linkPerfil(codigo: string | null | undefined, base = enderecoDoJogo()): string | null {
  if (!codigoValido(codigo)) return null
  const c = encodeURIComponent(codigo)
  return `${base}?c=${c}#/jogador/${c}`
}

/** Um id de carreira (o do HallEntry: career-<semente>) que dá para pôr no link da prévia. */
const ID_CARREIRA_RE = /^[A-Za-z0-9_.:-]{1,64}$/

/**
 * v3.4 (CONTRATO-v34 §A.0): o link da PRÉVIA para compartilhar (api/v.php): os robôs do WhatsApp, X, Facebook e Discord
 * leem o cartão (Open Graph + a imagem 1200×630 da carreira, feita no servidor) e a pessoa é levada para o jogo, já como
 * convidada de quem compartilhou. `id` = a carreira (do Hall público); sem `id`, o perfil do `codigo`. Sem nada que sirva: o
 * link do convite (ou o do jogo).
 */
export function linkPrevia(o: { id?: string | null; codigo?: string | null }, base = enderecoDoJogo()): string {
  const c = codigoValido(o.codigo) ? encodeURIComponent(o.codigo) : null
  if (o.id && ID_CARREIRA_RE.test(o.id)) return `${base}api/v.php?id=${encodeURIComponent(o.id)}${c ? `&c=${c}` : ''}`
  if (c) return `${base}api/v.php?c=${c}`
  return linkConvite(o.codigo, base)
}

/** Tira o `?c=` da barra de endereço (o resto da URL e o #/rota ficam). */
export function limparConviteDaUrl() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return
  try {
    const u = new URL(location.href)
    if (!u.searchParams.has('c')) return
    u.searchParams.delete('c')
    history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`)
  } catch {
    /* sem history: fica como está */
  }
}
