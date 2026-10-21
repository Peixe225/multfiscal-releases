/**
 * Desafios do site — "As Taças do Rei" e os outros que o admin cria (GET /lenda/api/desafios.php — servidor/CONTRATO-v33.md).
 *
 *   await useDesafios.getState().carregar()        // lista pública (cache de 60 s, aqui e no servidor)
 *   await useDesafios.getState().carregarMeu()     // ?eu=1: o checklist do jogador logado
 *   useDesafios(temDesafioAtivo)                   // o menu e a tela inicial só mostram com um desafio valendo
 *
 * Nada aqui é pedido na abertura do jogo: a tela inicial pede depois de pintar (e o menu ao abrir). Servidor antigo (sem
 * desafios.php) ou sem rede: lista vazia, e nada de desafio aparece.
 *
 * v3.4 (CONTRATO-v34 §A.0): desafio de modo "emblema" (todo jogador que cumprir ganha o emblema, sem corrida) ao lado do
 * de sempre ("primeiro": um vencedor e o prêmio do admin); critérios novos (Champions, Bolas de Ouro, títulos, gols, nota,
 * clubes, temporadas no mesmo clube, nacionalidade, Copas pela seleção); dificuldade, emblema {icone, cor}, `home` (vai na
 * faixa da tela inicial) e `ganharam`. O ?eu=1 traz `eu.emblema` em cada um e `emblemas` (os da conta) no topo.
 */
import { create } from 'zustand'
import { api, comReintento, ErroApi } from './api'
import { useConta } from './conta'
import { limparEmblemas, normalizarDificuldade, normalizarEmblemas, receberMeusEmblemas, type Dificuldade, type Emblema } from './emblemas'
import { corDoEmblema, iconeDoEmblema } from '@/ui/shared/emblemas/Emblema'
import type { HallEntry } from '@/store/career'

export interface Criterio {
  copas?: number
  libertadores?: number
  todasConquistas?: boolean
  /** v3.4: os critérios novos (tudo "pelo menos", numa mesma carreira). */
  champions?: number
  bolasOuro?: number
  titulos?: number
  gols?: number
  nota?: number
  clubes?: number
  temporadasMesmoClube?: number
  copasPelaSelecao?: number
  /** Seleções (código de 3 letras) que valem: a da criação, a mesma até o fim. */
  nacionalidade?: string[]
}

export type ModoDesafio = 'primeiro' | 'emblema'

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
  /** v3.4: "primeiro" (um vencedor, o prêmio) ou "emblema" (todo mundo que cumprir ganha o emblema). */
  modo: ModoDesafio
  dificuldade: Dificuldade | null
  emblema: { icone: string; cor: string } | null
  /** Vai na faixa da tela inicial. */
  home: boolean
  /** Contas que já ganharam o emblema (só no de emblema; null = o servidor não disse). */
  ganharam: number | null
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
  /** Só no de todas as conquistas (v3.4: as PROVADAS da conta). */
  conquistas: number | null
  conquistasTotal: number | null
  /** v3.4, no de todas as conquistas: as provadas por carreiras já conferidas e todas (com as não provadas). */
  conquistasVerificadas: number | null
  conquistasTodas: number | null
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
  /** v3.4, no de emblema: o emblema desta conta (ativo ou retirado pelo admin), ou null = ainda não tem. */
  emblema: { estado: 'ativo' | 'retirado'; em: string | null; carreiraId: string | null; jogador: string | null; motivo: string | null } | null
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown, padrao = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : padrao)
const data = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)
const codigo = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null)

/** Os critérios numéricos e o teto de cada um (o servidor confere com os mesmos, CONTRATO-v34 §A.0). */
const CRITERIOS_NUM: [keyof Criterio, number][] = [
  ['copas', 99],
  ['libertadores', 99],
  ['champions', 99],
  ['bolasOuro', 99],
  ['copasPelaSelecao', 99],
  ['titulos', 500],
  ['gols', 5000],
  ['nota', 100],
  ['clubes', 40],
  ['temporadasMesmoClube', 30],
]

/** O critério (JSON) que veio do servidor: só os campos conhecidos, com números de 1 ao teto de cada um. */
export function normalizarCriterio(x: unknown): Criterio {
  const c = (typeof x === 'string' ? tentarJson(x) : x) as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return {}
  const out: Criterio = {}
  for (const [k, max] of CRITERIOS_NUM) {
    const v = c[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1) (out as Record<string, number>)[k] = Math.min(max, Math.round(v))
  }
  if (Array.isArray(c.nacionalidade)) {
    const l = c.nacionalidade.filter((p): p is string => typeof p === 'string' && /^[A-Z]{3}$/.test(p)).slice(0, 20)
    if (l.length) out.nacionalidade = [...new Set(l)]
  }
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
  const modo: ModoDesafio = d.modo === 'emblema' ? 'emblema' : 'primeiro'
  // no de emblema não há vencedor (todo mundo que cumprir ganha)
  const vencedor = modo === 'emblema' ? null : normalizarVencedor(d.vencedor)
  const fimPassou = fim ? Date.parse(fim) <= agora : false
  const emb = d.emblema && typeof d.emblema === 'object' ? (d.emblema as Record<string, unknown>) : null
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
    modo,
    dificuldade: normalizarDificuldade(d.dificuldade),
    emblema: emb ? { icone: iconeDoEmblema(emb.icone), cor: corDoEmblema(emb.cor) } : modo === 'emblema' ? { icone: 'medal', cor: corDoEmblema(null) } : null,
    home: d.home === true || d.home === 1,
    ganharam: typeof d.ganharam === 'number' && Number.isFinite(d.ganharam) ? Math.max(0, Math.round(d.ganharam)) : null,
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
    conquistasVerificadas: nulo(m.conquistasVerificadas),
    conquistasTodas: nulo(m.conquistasTodas),
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
    emblema: normalizarEmblemaDoEu(m.emblema),
  }
}

/** v3.4: `eu.emblema` de um desafio de emblema. */
export function normalizarEmblemaDoEu(x: unknown): MeuDesafio['emblema'] {
  const e = x as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  return {
    estado: e.estado === 'retirado' ? 'retirado' : 'ativo',
    em: data(e.em),
    carreiraId: typeof e.carreiraId === 'string' && e.carreiraId ? e.carreiraId.slice(0, 64) : null,
    jogador: typeof e.jogador === 'string' && e.jogador ? e.jogador.slice(0, 40) : null,
    motivo: typeof e.motivo === 'string' && e.motivo ? e.motivo.slice(0, 200) : null,
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

const milhar = (n: number) => n.toLocaleString('pt-BR')

/** Nomes das seleções que aparecem nos critérios (as outras vão pelo código). */
const NOMES_SELECAO: Record<string, string> = { BRA: 'brasileiro', ARG: 'argentino', URU: 'uruguaio', ESP: 'espanhol', FRA: 'francês', ENG: 'inglês', GER: 'alemão', ITA: 'italiano', POR: 'português', NED: 'holandês', COL: 'colombiano', MEX: 'mexicano' }

/** As partes do critério, cada uma numa frase curta ("2 Copas do Mundo", "800 gols", "jogador brasileiro"). */
export function partesCriterio(c: Criterio): string[] {
  const partes: string[] = []
  const n = (v: number | undefined, um: string, varios: string) => (v ? partes.push(`${milhar(v)} ${v === 1 ? um : varios}`) : 0)
  if (c.nacionalidade?.length) partes.push(`jogador ${c.nacionalidade.map((p) => NOMES_SELECAO[p] ?? p).join(' ou ')}`)
  // "a Copa pela própria seleção" já diz a Copa: o total só entra quando pede mais que isso
  if (!c.copasPelaSelecao || (c.copas ?? 0) > c.copasPelaSelecao) n(c.copas, 'Copa do Mundo', 'Copas do Mundo')
  if (c.copasPelaSelecao) partes.push(c.copasPelaSelecao === 1 ? 'a Copa pela própria seleção' : `${c.copasPelaSelecao} Copas pela própria seleção`)
  n(c.libertadores, 'Libertadores', 'Libertadores')
  n(c.champions, 'Champions League', 'Champions League')
  n(c.bolasOuro, 'Bola de Ouro', 'Bolas de Ouro')
  n(c.titulos, 'título', 'títulos')
  if (c.gols) partes.push(c.gols > 1 && c.gols % 1000 === 1 ? `mais de ${milhar(c.gols - 1)} gols` : `${milhar(c.gols)} gols`)
  if (c.nota) partes.push(`Nota de Legado ${c.nota} ou mais`)
  n(c.clubes, 'clube', 'clubes diferentes')
  if (c.temporadasMesmoClube) partes.push(`${c.temporadasMesmoClube} temporadas no mesmo clube`)
  return partes
}

/** "3 Copas do Mundo e 2 Libertadores numa mesma carreira" (o critério em uma frase). */
export function textoCriterio(c: Criterio): string {
  if (c.todasConquistas) return 'Desbloquear todas as conquistas do jogo'
  const partes = partesCriterio(c)
  if (!partes.length) return 'Critério a definir'
  const junta = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`
  return `${junta} numa mesma carreira`
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
      // v3.4: os emblemas da conta (no topo da resposta; sem ele, os `eu.emblema` ativos de cada desafio) e o aviso dos novos
      const emb = (r as { emblemas?: unknown } | null)?.emblemas
      const meus = Array.isArray(emb) ? normalizarEmblemas(emb) : emblemasDoEu(lista, meu)
      if (meus && useConta.getState().usuario?.id === u.id) receberMeusEmblemas(meus, u.id)
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
  if (s.usuario?.id !== p.usuario?.id) {
    useDesafios.setState({ meu: null, meuStatus: 'idle', meuDe: null })
    limparEmblemas()
  }
  // confirmou o e-mail com o checklist já carregado: o servidor avaliou a conta na hora (a candidatura pode ter nascido
  // agora), então o checklist vem de novo — sem isso "Em verificação" só aparecia ao recarregar a tela
  else if (s.usuario?.emailVerificado && p.usuario && !p.usuario.emailVerificado && useDesafios.getState().meu) void useDesafios.getState().carregarMeu(true)
})

/**
 * v3.4: os emblemas da conta tirados de cada desafio (`eu.emblema` ativo), para quando a resposta não traz a lista no topo.
 * Sem nenhum desafio de emblema na lista: null (o servidor não sabe de emblemas).
 */
export function emblemasDoEu(lista: readonly Desafio[], meu: Record<string, MeuDesafio>): Emblema[] | null {
  if (!lista.some((d) => d.modo === 'emblema')) return null
  return lista
    .filter((d) => d.modo === 'emblema' && meu[d.slug]?.emblema?.estado === 'ativo')
    .map((d) => {
      const e = meu[d.slug].emblema!
      return { slug: d.slug, titulo: d.titulo, icone: d.emblema?.icone ?? 'medal', cor: d.emblema?.cor ?? corDoEmblema(null), dificuldade: d.dificuldade, em: e.em, carreiraId: e.carreiraId, jogador: e.jogador }
    })
}

/** v3.4 §E: os números de uma carreira para os critérios — a mesma conta do servidor (_carreiras.php extrairCampos). */
export interface NumerosCriterio {
  copas: number
  libertadores: number
  champions: number
  bolasOuro: number
  titulos: number
  gols: number
  nota: number
  clubes: number
  temporadasMesmoClube: number
  copasPelaSelecao: number
  /** A seleção da criação (a do replay; null sem replay) e a do fim. */
  paisInicio: string | null
  paisFim: string
}

type CarreiraParaCriterio = Pick<HallEntry, 'summary' | 'identity'> & Partial<Pick<HallEntry, 'legacy' | 'replay'>>

/** Uma contagem de taça ou prêmio como o servidor lê (inteiro de 0 a 10.000; o resto vale 0). */
const contagem = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10_000, Math.round(v))) : 0)

export function numerosParaCriterio(h: CarreiraParaCriterio): NumerosCriterio {
  const s = (h.summary ?? {}) as Partial<HallEntry['summary']>
  const trofeus = Array.isArray(s.trophies) ? s.trophies : []
  const conta = (id: string) => trofeus.reduce((t, x) => t + (x && x.trophyId === id ? contagem(x.count) : 0), 0)
  const clubes = new Set<string>()
  const porClube = new Map<string, number>()
  for (const c of Array.isArray(s.clubs) ? s.clubs : []) {
    const id = c && typeof c.clubId === 'string' ? c.clubId : ''
    if (!id) continue
    if (/^[A-Za-z0-9_-]{1,16}$/.test(id) && clubes.size < 40) clubes.add(id)
    const t = typeof c.seasons === 'number' && Number.isFinite(c.seasons) ? Math.max(0, Math.min(999, Math.round(c.seasons))) : 0
    porClube.set(id, Math.min(999, (porClube.get(id) ?? 0) + t))
  }
  const paisFim = typeof h.identity?.nationality === 'string' ? h.identity.nationality : ''
  const ini = (h.replay as { identity?: { nationality?: unknown } } | undefined)?.identity?.nationality
  const paisInicio = typeof ini === 'string' && ini ? ini : null
  const sel = paisInicio ?? paisFim
  const nacionais = Array.isArray(s.national?.trophies) ? s.national.trophies : []
  const notaBruta = typeof h.legacy?.score === 'number' ? h.legacy.score : typeof s.legacyScore === 'number' ? s.legacyScore : 0
  return {
    copas: conta('world-cup'),
    libertadores: conta('libertadores'),
    champions: conta('champions-league'),
    bolasOuro: (Array.isArray(s.awards) ? s.awards : []).reduce((t, x) => t + (x && x.award === 'ballon_dor' ? Math.min(1000, contagem(x.count)) : 0), 0),
    titulos: trofeus.reduce((t, x) => t + (x && typeof x === 'object' ? contagem(x.count) : 0), 0),
    gols: typeof s.totals?.goals === 'number' && Number.isFinite(s.totals.goals) ? Math.max(0, Math.round(s.totals.goals)) : 0,
    nota: Number.isFinite(notaBruta) ? Math.round(notaBruta) : 0,
    clubes: clubes.size,
    temporadasMesmoClube: Math.max(0, ...porClube.values()),
    copasPelaSelecao: nacionais.filter((t) => t && (t.trophyId === 'world-cup' || (t as { kind?: unknown }).kind === 'world_cup') && t.minor !== true && !!sel && t.teamId === sel).length,
    paisInicio,
    paisFim,
  }
}

/**
 * v3.4 §E: a carreira cumpre o critério de carreira do desafio? (Como o servidor, cumpreCriterio; a nota sem olhar a versão dos
 * pesos — o salvar manda a nota já na versão de agora. Só para o jogo decidir se a carreira sobe sozinha: quem dá o emblema
 * é o servidor.) O de todas as conquistas e o critério vazio: não.
 */
export function carreiraCumpre(h: CarreiraParaCriterio, c: Criterio): boolean {
  if (c.todasConquistas) return false
  const n = numerosParaCriterio(h)
  const chaves = ['copas', 'libertadores', 'champions', 'bolasOuro', 'titulos', 'gols', 'nota', 'clubes', 'temporadasMesmoClube', 'copasPelaSelecao'] as const
  let alguma = false
  for (const k of chaves) {
    const v = c[k]
    if (typeof v !== 'number') continue
    alguma = true
    if (n[k] < v) return false
  }
  if (c.nacionalidade?.length) {
    alguma = true
    if (!n.paisInicio || !c.nacionalidade.includes(n.paisInicio) || n.paisFim !== n.paisInicio) return false
  }
  return alguma
}

/** v3.4 §E: dos desafios de emblema valendo, os que a carreira cumpre e cujo emblema a conta ainda não tem (`tem` = slugs). */
export const emblemasQueACarreiraDa = (h: CarreiraParaCriterio, lista: readonly Desafio[], tem: ReadonlySet<string>): Desafio[] =>
  emblemasValendo(lista).filter((d) => !tem.has(d.slug) && carreiraCumpre(h, d.criterio))

/** Há desafio de PRÊMIO valendo agora (o destaque grande da tela inicial e a linha do menu, v3.3). */
export const temDesafioAtivo = (s: Pick<DesafiosStore, 'lista'>) => s.lista.some((d) => d.modo !== 'emblema' && valendo(d))

/** v3.4: os desafios de emblema valendo agora. */
export const emblemasValendo = (lista: readonly Desafio[]) => lista.filter((d) => d.modo === 'emblema' && valendo(d))

/**
 * v3.4: os da faixa discreta da tela inicial (até `max`): os marcados `home` primeiro (na ordem do servidor), depois os
 * outros de emblema valendo, do mais fácil ao mais difícil.
 */
export function desafiosDaFaixa(lista: readonly Desafio[], max = 3): Desafio[] {
  const valem = emblemasValendo(lista)
  const peso = (d: Desafio) => (d.dificuldade ? ['facil', 'medio', 'dificil', 'lendario'].indexOf(d.dificuldade) : 9)
  const home = valem.filter((d) => d.home)
  const resto = valem.filter((d) => !d.home).sort((a, b) => peso(a) - peso(b))
  return [...home, ...resto].slice(0, max)
}

/**
 * v3.4: a chance aproximada de cada desafio de emblema de fábrica, para quem joga para isso (a calibração da §K.4 do
 * CONTRATO-v34: o "plano dedicado"). Desafio criado pelo admin não tem (a tela não mostra).
 */
export const CHANCE_EMBLEMA: Readonly<Record<string, { umEm: number; aproximada?: boolean }>> = {
  'noite-de-gala': { umEm: 12 },
  'andarilho-campeao': { umEm: 11 },
  'bandeira-do-clube': { umEm: 9 },
  'hexa-e-gloria-eterna': { umEm: 66 },
  'era-de-ouro': { umEm: 79 },
  'artilheiro-do-mundo': { umEm: 114 },
  'bi-do-mundo-bi-da-america': { umEm: 350 },
  imortal: { umEm: 583 },
  'tacas-do-rei-emblema': { umEm: 9577, aproximada: true },
  'mil-gols-e-o-tri': { umEm: 5250 },
}

/** "~1 em 12 carreiras" (null = sem número). */
export function textoChance(slug: string): string | null {
  const c = CHANCE_EMBLEMA[slug]
  return c ? `~1 em ${milhar(c.umEm)} carreiras` : null
}
