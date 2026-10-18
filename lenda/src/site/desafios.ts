/**
 * Desafios do site — "As Taças do Rei" e os outros que o admin cria (GET /lenda/api/desafios.php — servidor/CONTRATO-v33.md).
 *
 *   await useDesafios.getState().carregar()        // lista pública (cache de 60 s, aqui e no servidor)
 *   await useDesafios.getState().carregarMeu()     // ?eu=1: o checklist do jogador logado
 *   useDesafios(temDesafioAtivo)                   // o menu e a tela inicial só mostram com um desafio valendo
 *
 * Nada aqui é pedido na abertura do jogo: a tela inicial pede depois de pintar (e o menu ao abrir). Servidor antigo (sem
 * desafios.php) ou sem rede: lista vazia, e nada de desafio aparece.
 */
import { create } from 'zustand'
import { api, comReintento, ErroApi } from './api'
import { useConta } from './conta'

export interface Criterio {
  copas?: number
  libertadores?: number
  todasConquistas?: boolean
}

export interface Requisitos {
  partidasMin: number
  emailVerificado: boolean
  publicadoNoHall: boolean
  top3Perfil: boolean
}

export const REQUISITOS_PADRAO: Requisitos = { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true }

export interface Vencedor {
  apelido: string
  jogador: string | null
  carreiraId: string | null
  /** Código do perfil público (#/jogador/<código>); null = perfil fechado. */
  perfil: string | null
  em: string | null
}

export interface Desafio {
  slug: string
  titulo: string
  descricao: string
  regulamento: string
  /** Texto livre do admin (o que o vencedor ganha); vazio = ainda não definido. */
  premio: string
  criterio: Criterio
  requisitos: Requisitos
  ativo: boolean
  inicio: string | null
  fim: string | null
  /** Acabou (prazo vencido ou já tem vencedor): o servidor diz; sem o campo, a conta é feita aqui. */
  encerrado: boolean
  vencedor: Vencedor | null
  /** Candidatas esperando a verificação. */
  pendentes: number
}

export type EstadoCandidato = 'pendente' | 'verificada' | 'recusada' | 'vencedora'
export const ESTADOS_CANDIDATO: readonly EstadoCandidato[] = ['pendente', 'verificada', 'recusada', 'vencedora']

export interface CarreiraQueCumpre {
  carreiraId: string
  jogador: string
  publicada: boolean
  noTop3: boolean
  /** null = o servidor não disse (contrato mínimo). */
  temReplay: boolean | null
  vale: boolean | null
  /** A frase pronta do servidor (motivoTexto) ou, sem ela, o código. */
  motivo: string | null
  /** §E: o código (sem_replay, nao_publicada…): o checklist separa o que é da carreira do que é do Hall. */
  motivoCodigo: string | null
}

/** §E: motivos do Hall — a carreira cumpre o critério e vale, só falta publicar (ou pôr entre as 3 do perfil). */
export const MOTIVOS_DO_HALL: readonly string[] = ['nao_publicada', 'fora_do_top3']

/**
 * §E: as carreiras que contam para o critério no checklist: as que valem e as que só esperam o Hall (publicar, pôr entre as
 * 3). Uma sem replay, do Imersivo, sem a semente do servidor, fora do prazo ou do limite do dia não conta para nada.
 */
export function carreirasQueContam(cs: readonly CarreiraQueCumpre[]): CarreiraQueCumpre[] {
  return cs.filter((c) => c.vale !== false || (c.motivoCodigo !== null && MOTIVOS_DO_HALL.includes(c.motivoCodigo)))
}

export interface MeuDesafio {
  partidas: number
  partidasMin: number
  emailVerificado: boolean
  partidasHoje: number | null
  partidasDiaMax: number | null
  /** Só no de todas as conquistas. */
  conquistas: number | null
  conquistasTotal: number | null
  carreirasQueCumprem: CarreiraQueCumpre[]
  candidato: {
    estado: EstadoCandidato
    motivo: string | null
    em: string | null
    carreiraId: string | null
    /** §E: o pendente/verificado vale agora? (false = deixou de cumprir algo; null = o servidor não disse) */
    vale: boolean | null
    /** §E: por que não vale agora (a frase pronta), quando vale = false. */
    motivoAgora: string | null
  } | null
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown, padrao = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : padrao)
const data = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)
const codigo = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null)

/** O critério (JSON) que veio do servidor: só os campos conhecidos, com números de 1 a 99. */
export function normalizarCriterio(x: unknown): Criterio {
  const c = (typeof x === 'string' ? tentarJson(x) : x) as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return {}
  const out: Criterio = {}
  if (typeof c.copas === 'number' && c.copas >= 1) out.copas = Math.min(99, Math.round(c.copas))
  if (typeof c.libertadores === 'number' && c.libertadores >= 1) out.libertadores = Math.min(99, Math.round(c.libertadores))
  if (c.todasConquistas === true) out.todasConquistas = true
  return out
}

export function normalizarRequisitos(x: unknown): Requisitos {
  const r = (typeof x === 'string' ? tentarJson(x) : x) as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return REQUISITOS_PADRAO
  return {
    partidasMin: typeof r.partidasMin === 'number' && r.partidasMin >= 0 ? Math.min(100_000, Math.round(r.partidasMin)) : REQUISITOS_PADRAO.partidasMin,
    emailVerificado: typeof r.emailVerificado === 'boolean' ? r.emailVerificado : REQUISITOS_PADRAO.emailVerificado,
    publicadoNoHall: typeof r.publicadoNoHall === 'boolean' ? r.publicadoNoHall : REQUISITOS_PADRAO.publicadoNoHall,
    top3Perfil: typeof r.top3Perfil === 'boolean' ? r.top3Perfil : REQUISITOS_PADRAO.top3Perfil,
  }
}

function tentarJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export function normalizarVencedor(x: unknown): Vencedor | null {
  const v = x as Record<string, unknown> | null
  if (!v || typeof v !== 'object') return null
  // a conta do vencedor foi excluída (LGPD): o desafio continua vencido, sem nome nem link
  if (v.excluido === true) return { apelido: 'Conta excluída', jogador: null, carreiraId: null, perfil: null, em: data(v.declaradoEm) ?? data(v.em) }
  if (typeof v.apelido !== 'string' || !v.apelido) return null
  return {
    apelido: v.apelido.slice(0, 20),
    jogador: typeof v.jogador === 'string' && v.jogador ? v.jogador.slice(0, 15) : null,
    carreiraId: typeof v.carreiraId === 'string' && v.carreiraId && v.carreiraId.length <= 64 ? v.carreiraId : null,
    perfil: codigo(v.perfil),
    em: data(v.em) ?? data(v.declaradoEm),
  }
}

/** Um desafio da lista pública, conferido campo a campo; sem slug ou título, fica de fora. */
export function normalizarDesafio(x: unknown, agora = Date.now()): Desafio | null {
  const d = x as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || typeof d.slug !== 'string' || !/^[a-z0-9-]{1,64}$/.test(d.slug)) return null
  const titulo = str(d.titulo, 120).trim()
  if (!titulo) return null
  const fim = data(d.fim)
  const vencedor = normalizarVencedor(d.vencedor)
  const fimPassou = fim ? Date.parse(fim) <= agora : false
  return {
    slug: d.slug,
    titulo,
    descricao: str(d.descricao, 2000).trim(),
    regulamento: str(d.regulamento, 20_000).trim(),
    premio: str(d.premio, 2000).trim(),
    criterio: normalizarCriterio(d.criterio),
    requisitos: normalizarRequisitos(d.requisitos),
    ativo: d.ativo === true || d.ativo === 1,
    inicio: data(d.inicio),
    fim,
    encerrado: typeof d.encerrado === 'boolean' ? d.encerrado || !!vencedor : !!vencedor || fimPassou,
    vencedor,
    pendentes: int(d.pendentes),
  }
}

/** O desafio está valendo agora (ativo, já começou, sem vencedor, dentro do prazo)? */
export function valendo(d: Pick<Desafio, 'ativo' | 'inicio' | 'fim' | 'encerrado' | 'vencedor'>, agora = Date.now()): boolean {
  if (!d.ativo || d.encerrado || d.vencedor) return false
  if (d.inicio && Date.parse(d.inicio) > agora) return false
  if (d.fim && Date.parse(d.fim) <= agora) return false
  return true
}

const bool = (v: unknown) => v === true || v === 1
const boolOuNulo = (v: unknown) => (typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : null)

export function normalizarMeu(x: unknown): MeuDesafio | null {
  const m = x as Record<string, unknown> | null
  if (!m || typeof m !== 'object' || typeof m.partidas !== 'number') return null
  const cand = m.candidato as Record<string, unknown> | null | undefined
  const estado = cand && typeof cand === 'object' && (ESTADOS_CANDIDATO as readonly unknown[]).includes(cand.estado) ? (cand.estado as EstadoCandidato) : null
  const nulo = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null)
  return {
    partidas: int(m.partidas),
    partidasMin: int(m.partidasMin, REQUISITOS_PADRAO.partidasMin),
    emailVerificado: bool(m.emailVerificado),
    partidasHoje: nulo(m.partidasHoje),
    partidasDiaMax: nulo(m.partidasDiaMax),
    conquistas: nulo(m.conquistas),
    conquistasTotal: nulo(m.conquistasTotal),
    carreirasQueCumprem: (Array.isArray(m.carreirasQueCumprem) ? m.carreirasQueCumprem : [])
      .map((c): CarreiraQueCumpre | null => {
        const o = c as Record<string, unknown> | null
        if (!o || typeof o.carreiraId !== 'string' || !o.carreiraId) return null
        return {
          carreiraId: o.carreiraId.slice(0, 64),
          jogador: str(o.jogador, 15) || '—',
          publicada: bool(o.publicada),
          noTop3: bool(o.noTop3),
          temReplay: boolOuNulo(o.temReplay),
          vale: boolOuNulo(o.vale),
          // o servidor manda o código (motivo) e a frase pronta (motivoTexto): a tela mostra a frase
          motivo: typeof o.motivoTexto === 'string' && o.motivoTexto ? o.motivoTexto.slice(0, 200) : typeof o.motivo === 'string' && o.motivo ? o.motivo.slice(0, 200) : null,
          motivoCodigo: typeof o.motivo === 'string' && /^[a-z0-9_]{1,32}$/.test(o.motivo) ? o.motivo : null,
        }
      })
      .filter((c): c is CarreiraQueCumpre => !!c)
      .slice(0, 20),
    candidato: estado
      ? {
          estado,
          motivo: typeof cand!.motivo === 'string' && cand!.motivo ? cand!.motivo.slice(0, 200) : null,
          em: data(cand!.em),
          carreiraId: typeof cand!.carreiraId === 'string' ? cand!.carreiraId.slice(0, 64) : null,
          vale: boolOuNulo(cand!.vale),
          motivoAgora:
            typeof cand!.motivoAgoraTexto === 'string' && cand!.motivoAgoraTexto ? cand!.motivoAgoraTexto.slice(0, 200) : typeof cand!.motivoAgora === 'string' && cand!.motivoAgora ? cand!.motivoAgora.slice(0, 200) : null,
        }
      : null,
  }
}

/**
 * A resposta do ?eu=1: cada desafio com `eu: {...}` (o servidor desta rodada) ou com os campos direto no item (o
 * contrato mínimo). Devolve slug → checklist.
 */
export function normalizarMeus(x: unknown): Record<string, MeuDesafio> {
  const r = (x ?? {}) as { desafios?: unknown }
  const out: Record<string, MeuDesafio> = {}
  for (const it of Array.isArray(r.desafios) ? r.desafios : []) {
    const o = it as Record<string, unknown> | null
    if (!o || typeof o.slug !== 'string') continue
    const m = normalizarMeu(o.eu && typeof o.eu === 'object' ? o.eu : o)
    if (m) out[o.slug] = m
  }
  return out
}

export function normalizarLista(x: unknown, agora = Date.now()): Desafio[] {
  const r = (x ?? {}) as { desafios?: unknown }
  return (Array.isArray(r.desafios) ? r.desafios : [])
    .map((d) => normalizarDesafio(d, agora))
    .filter((d): d is Desafio => !!d)
    .slice(0, 20)
}

/** "3 Copas do Mundo e 2 Libertadores numa mesma carreira" (o critério em uma frase). */
export function textoCriterio(c: Criterio): string {
  if (c.todasConquistas) return 'Desbloquear todas as conquistas do jogo'
  const partes: string[] = []
  if (c.copas) partes.push(`${c.copas} ${c.copas === 1 ? 'Copa do Mundo' : 'Copas do Mundo'}`)
  if (c.libertadores) partes.push(`${c.libertadores} ${c.libertadores === 1 ? 'Libertadores' : 'Libertadores'}`)
  if (!partes.length) return 'Critério a definir'
  return `${partes.join(' e ')} numa mesma carreira`
}

/** O critério no meio de uma frase ("Desafio valendo: desbloquear todas…"): só a 1ª letra, nunca "Copas do Mundo". */
export function criterioEmFrase(c: Criterio): string {
  const t = textoCriterio(c)
  return /^\p{Lu}\p{Ll}/u.test(t) ? t[0].toLocaleLowerCase('pt-BR') + t.slice(1) : t
}

/** O que cada requisito pede, para o checklist. */
export function itensRequisitos(r: Requisitos): { chave: keyof Requisitos; texto: string }[] {
  const out: { chave: keyof Requisitos; texto: string }[] = []
  if (r.partidasMin > 0) out.push({ chave: 'partidasMin', texto: `${r.partidasMin} partidas jogadas com a conta` })
  if (r.emailVerificado) out.push({ chave: 'emailVerificado', texto: 'Conta com o e-mail confirmado' })
  if (r.publicadoNoHall) out.push({ chave: 'publicadoNoHall', texto: 'A carreira publicada no Hall das Lendas' })
  if (r.top3Perfil) out.push({ chave: 'top3Perfil', texto: 'A carreira entre as 3 do seu perfil público' })
  return out
}

export const ROTULO_ESTADO: Record<EstadoCandidato, string> = {
  pendente: 'Em verificação',
  verificada: 'Verificada',
  recusada: 'Não valeu',
  vencedora: 'Vencedora',
}

/** Uma busca guardada vale isto (o servidor também manda max-age=60). */
export const VALIDADE_MS = 60_000

interface DesafiosStore {
  status: 'idle' | 'carregando' | 'pronto' | 'erro'
  lista: Desafio[]
  buscadoEm: number
  /** Checklist do jogador logado (slug → itens); null = ainda não pediu (ou sem conta). */
  meu: Record<string, MeuDesafio> | null
  meuStatus: 'idle' | 'carregando' | 'pronto' | 'erro'
  meuDe: number | null
  carregar(forcar?: boolean): Promise<Desafio[]>
  carregarMeu(forcar?: boolean): Promise<Record<string, MeuDesafio> | null>
}

let noAr: Promise<Desafio[]> | null = null

export const useDesafios = create<DesafiosStore>()((set, get) => ({
  status: 'idle',
  lista: [],
  buscadoEm: 0,
  meu: null,
  meuStatus: 'idle',
  meuDe: null,

  carregar(forcar = false) {
    const s = get()
    if (!forcar && s.status === 'pronto' && Date.now() - s.buscadoEm < VALIDADE_MS) return Promise.resolve(s.lista)
    if (noAr) return noAr
    if (s.status !== 'pronto') set({ status: 'carregando' })
    noAr = (async () => {
      try {
        const r = await comReintento(() => api('desafios.php', { cache: forcar ? 'no-cache' : 'default', tempo: 10_000 }), { tentativas: 2 })
        const lista = normalizarLista(r)
        set({ status: 'pronto', lista, buscadoEm: Date.now() })
        return lista
      } catch (err) {
        // servidor antigo (404) = sem desafios; sem rede: o que já veio continua
        const naoTem = err instanceof ErroApi && err.status === 404
        set(naoTem ? { status: 'pronto', lista: [], buscadoEm: Date.now() } : { status: get().lista.length ? 'pronto' : 'erro' })
        return get().lista
      } finally {
        noAr = null
      }
    })()
    return noAr
  },

  async carregarMeu(forcar = false) {
    const u = useConta.getState().usuario
    if (!u) {
      set({ meu: null, meuStatus: 'idle', meuDe: null })
      return null
    }
    const s = get()
    if (!forcar && s.meuStatus === 'carregando') return s.meu
    set({ meuStatus: 'carregando' })
    try {
      const r = await api('desafios.php', { query: { eu: '1' }, tempo: 12_000 })
      const meu = normalizarMeus(r)
      // a lista que veio junto também vale como lista pública (a mesma de agora)
      const lista = normalizarLista(r)
      set({ meu, meuStatus: 'pronto', meuDe: u.id, ...(lista.length ? { lista, status: 'pronto' as const, buscadoEm: Date.now() } : {}) })
      return meu
    } catch (err) {
      if (err instanceof ErroApi && err.status === 401) useConta.getState().sessaoExpirou()
      set({ meuStatus: 'erro' })
      return null
    }
  },
}))

// a conta saiu ou trocou: o checklist era da outra
useConta.subscribe((s, p) => {
  if (s.usuario?.id !== p.usuario?.id) useDesafios.setState({ meu: null, meuStatus: 'idle', meuDe: null })
  // confirmou o e-mail com o checklist já carregado: o servidor avaliou a conta na hora (a candidatura pode ter nascido
  // agora), então o checklist vem de novo — sem isso "Em verificação" só aparecia ao recarregar a tela
  else if (s.usuario?.emailVerificado && p.usuario && !p.usuario.emailVerificado && useDesafios.getState().meu) void useDesafios.getState().carregarMeu(true)
})

/** Há desafio valendo agora (menu e tela inicial). */
export const temDesafioAtivo = (s: Pick<DesafiosStore, 'lista'>) => s.lista.some((d) => valendo(d))
