/**
 * Emblemas dos desafios (servidor/CONTRATO-v34.md §A.0): todo jogador que cumpre um desafio de modo "emblema" com uma
 * carreira-prova ganha o emblema dele, dado sozinho pelo servidor (o admin pode retirar).
 *
 *   useEmblemas((s) => s.meus)          // os da conta logada (do desafios.php?eu=1), null = ainda não leu
 *   receberMeusEmblemas(lista, uid)     // desafios.ts, depois do ?eu=1
 *   avisarEmblemasNovos(resposta)       // o salvar da carreira respondeu emblemasNovos: o aviso discreto
 *
 * O aviso de emblema novo sai uma vez por emblema em cada aparelho (localStorage); o que já existia antes de este aparelho
 * ver (outro aparelho, a semeadura da v3.4) só avisa se for recente (7 dias).
 */
import { create } from 'zustand'
import { ArrowRight } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { toast } from '@/ui/primitives'
import type { EmblemaVisual } from '@/ui/shared/emblemas/Emblema'
import { armazem, type Armazem } from './medicao'

/**
 * v3.5: as mesmas regras do corDoEmblema/iconeDoEmblema de @/ui/shared/emblemas/Emblema (o v35.test confere), aqui sem
 * importar o componente: este arquivo vai na abertura do jogo (Hall público, carreiras) e o Emblema puxa o mapa de ícones
 * das conquistas e uns 10 pedaços de ícones, que no 4G lento disputavam a rede com a primeira tela.
 */
/** Cor do servidor no formato #rrggbb; fora disso, o bronze das conquistas. */
export const corDoEmblema = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#b98652')
/** Ícone do servidor no formato do mapa das conquistas ("circle-dot"…); fora disso, a medalha. */
export const iconeDoEmblema = (i: unknown) => (typeof i === 'string' && /^[a-z0-9-]{1,32}$/.test(i) ? i : 'medal')

export type Dificuldade = 'facil' | 'medio' | 'dificil' | 'lendario'
export const DIFICULDADES: readonly Dificuldade[] = ['facil', 'medio', 'dificil', 'lendario']
export const NOME_DIFICULDADE: Record<Dificuldade, string> = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil', lendario: 'Lendário' }

export interface Emblema extends EmblemaVisual {
  titulo: string
  dificuldade: Dificuldade | null
  em: string | null
  carreiraId: string | null
  jogador: string | null
}

const data = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)

export const normalizarDificuldade = (v: unknown): Dificuldade | null => ((DIFICULDADES as readonly unknown[]).includes(v) ? (v as Dificuldade) : null)

/** Um emblema que veio do servidor ({slug, titulo?, icone, cor, dificuldade?, em?, carreiraId?, jogador?}). */
export function normalizarEmblema(x: unknown): Emblema | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || typeof o.slug !== 'string' || !/^[a-z0-9-]{1,64}$/.test(o.slug)) return null
  return {
    slug: o.slug,
    titulo: typeof o.titulo === 'string' && o.titulo.trim() ? o.titulo.trim().slice(0, 80) : '',
    icone: iconeDoEmblema(o.icone),
    cor: corDoEmblema(o.cor),
    dificuldade: normalizarDificuldade(o.dificuldade),
    em: data(o.em),
    carreiraId: typeof o.carreiraId === 'string' && o.carreiraId && o.carreiraId.length <= 64 ? o.carreiraId : null,
    jogador: typeof o.jogador === 'string' && o.jogador ? o.jogador.slice(0, 40) : null,
  }
}

export function normalizarEmblemas(x: unknown, max = 50): Emblema[] {
  const vistos = new Set<string>()
  const out: Emblema[] = []
  for (const it of Array.isArray(x) ? x : []) {
    const e = normalizarEmblema(it)
    if (!e || vistos.has(e.slug)) continue
    vistos.add(e.slug)
    out.push(e)
    if (out.length >= max) break
  }
  return out
}

/** Ordem de exibição: do mais difícil para o mais fácil, depois o mais recente. */
export function ordenarEmblemas<T extends { dificuldade?: Dificuldade | null; em?: string | null }>(l: readonly T[]): T[] {
  const peso = (d: Dificuldade | null | undefined) => (d ? DIFICULDADES.indexOf(d) : -1)
  return [...l].sort((a, b) => peso(b.dificuldade) - peso(a.dificuldade) || String(b.em ?? '').localeCompare(String(a.em ?? '')))
}

interface EmblemasStore {
  /** Os emblemas ativos da conta logada; null = ainda não leu (ou sem conta). */
  meus: Emblema[] | null
  uid: number | null
}

export const useEmblemas = create<EmblemasStore>()(() => ({ meus: null, uid: null }))

// ───────────────────────── aviso de emblema novo ─────────────────────────

export const CHAVE_VISTOS = 'lenda:emblemas-vistos'
/** Um emblema que este aparelho nunca viu só avisa se for destes últimos dias (os antigos aparecem na Minha conta). */
export const AVISO_RECENTE_MS = 7 * 24 * 3600_000
const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

function lerVistos(a: Armazem, uid: number): Set<string> {
  try {
    const j = JSON.parse(a.get(CHAVE_VISTOS) || 'null') as { uid?: unknown; s?: unknown } | null
    return j && j.uid === uid && Array.isArray(j.s) ? new Set(j.s.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

/** Quais destes ainda não foram avisados neste aparelho (e os marca como avisados). */
export function emblemasParaAvisar(lista: readonly Emblema[], uid: number, a: Armazem = ls, agora = Date.now()): Emblema[] {
  const vistos = lerVistos(a, uid)
  const novos = lista.filter((e) => !vistos.has(e.slug) && (!e.em || agora - Date.parse(e.em) < AVISO_RECENTE_MS))
  if (lista.some((e) => !vistos.has(e.slug))) a.set(CHAVE_VISTOS, JSON.stringify({ uid, s: [...new Set([...vistos, ...lista.map((e) => e.slug)])].slice(-200) }))
  return novos
}

function avisar(novos: readonly Emblema[]) {
  // v3.5: já em #/desafios (onde os emblemas aparecem), o aviso só cobriria o título — eles já ficaram marcados como vistos
  if (!novos.length || useApp.getState().route.path === '/desafios') return
  const ver = { label: 'Ver desafios', icon: ArrowRight, onClick: () => navigate('/desafios') }
  if (novos.length === 1) {
    const e = novos[0]
    toast.gold(`Emblema novo: ${e.titulo || 'desafio cumprido'}`, e.jogador ? `Ganho com ${e.jogador}. Ele aparece no seu perfil e no Hall.` : 'Ele aparece no seu perfil e no Hall.', { key: `emblema-${e.slug}`, action: ver })
  } else {
    toast.gold(`${novos.length} emblemas novos`, novos.map((e) => e.titulo).filter(Boolean).join(', ').slice(0, 140) || 'Eles aparecem no seu perfil e no Hall.', { key: 'emblemas-novos', action: ver })
  }
}

/** Os emblemas da conta (do ?eu=1): guarda e avisa os novos deste aparelho. */
export function receberMeusEmblemas(lista: readonly Emblema[], uid: number) {
  const atual = useEmblemas.getState()
  useEmblemas.setState({ meus: ordenarEmblemas(lista), uid })
  // a primeira leitura desta conta neste aparelho também avisa (só os recentes, emblemasParaAvisar)
  void atual
  avisar(emblemasParaAvisar(lista, uid))
}

/** O salvar respondeu `emblemasNovos`: entram na lista da conta e o aviso sai na hora. */
export function avisarEmblemasNovos(x: unknown, uid: number | null) {
  const novos = normalizarEmblemas(x, 20).map((e) => ({ ...e, em: e.em ?? new Date().toISOString() }))
  if (!novos.length || uid == null) return
  const s = useEmblemas.getState()
  const base = s.uid === uid && s.meus ? s.meus.filter((e) => !novos.some((n) => n.slug === e.slug)) : []
  useEmblemas.setState({ meus: ordenarEmblemas([...novos, ...base]), uid })
  avisar(emblemasParaAvisar(novos, uid))
}

/** Saiu ou trocou de conta. */
export function limparEmblemas() {
  useEmblemas.setState({ meus: null, uid: null })
}
