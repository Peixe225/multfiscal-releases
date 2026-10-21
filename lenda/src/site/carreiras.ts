/**
 * Carreiras salvas na conta (GET/POST /lenda/api/carreiras.php — servidor/CONTRATO.md).
 *
 *   await useCarreiras.getState().carregar()              // lista da conta (mais recentes primeiro)
 *   await useCarreiras.getState().salvar(entry, 'manual') // grava/atualiza pelo id do HallEntry
 *   await abrirCarreiraDaConta(id)                        // mostra o mesmo #/resumo do jogo com ela
 *
 * Regras: carreira terminada com pico de OVR >= 90 vai para a conta sozinha (como "auto"); ao entrar ou
 * criar a conta, as do Hall do aparelho com pico >= 90 que ainda não estão lá sobem sozinhas. As outras
 * só pelo botão ("manual"). Uma carreira apagada da conta neste aparelho nunca sobe sozinha de novo, nem uma que a
 * moderação removeu (409 apagada, v3.2): essa sai da fila na hora e só volta pelo botão, se o admin liberar.
 *
 * Hall público (v3.2, X2): cada carreira da conta vem com `hall` = {estado, motivo?} — no Hall, em revisão, fora (e
 * por quê) ou privada —, e seloHall() diz o que a lista e o resumo mostram.
 */
import { create } from 'zustand'
import { navigate, useApp } from '@/store/app'
import { refreshLegacy, useCareer, withRunNumbers, type HallEntry } from '@/store/career'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import { kv, KV_KEYS } from '@/store/persist'
import { api, ErroApi } from './api'
import { armazem, type Armazem } from './medicao'
import { useConta } from './conta'
import { somarProvasNovas } from './provas'
import { avisarEmblemasNovos } from './emblemas'

export interface CarreiraConta {
  id: string
  modo: 'classico' | 'imersivo'
  jogador: string
  numero: number
  pais: string
  posicao: string
  nota: number | null
  /** Versão dos pesos com que a nota foi gravada (LEGACY_VERSION); null = antes da v2. */
  notaV: number | null
  picoOvr: number
  temporadas: number
  gols: number
  titulos: number
  bolasOuro: number
  headline: string
  /** null = ainda só no aparelho. */
  como: 'auto' | 'manual' | null
  salvaEm: string | null
  terminouEm: string | null
  /** Hall público (CONTRATO-v3.md §4): marcada pelo jogador (modo manual). */
  publica: boolean
  /** O servidor diz que ela está (ou entra na próxima atualização) no Hall público; null = não disse. */
  noHall: boolean | null
  /** Ficou fora do Hall público: escondida pela moderação ou em análise (números estranhos). */
  oculta: boolean
  suspeita: boolean
  bonusOvr: number
  /** Onde ela está em relação ao Hall público, segundo o servidor (v3.2); null = servidor antigo ou só no aparelho. */
  hall: HallDaCarreira | null
  /**
   * v3.4: a carreira é prova de conquistas na conta (Clássico, semente do servidor, replay): quantas ela prova, quantas só
   * ela prova (apagar tira a prova dessas) e se já foi conferida pela equipe. null = não é prova (ou servidor antigo).
   */
  prova?: ProvaDaCarreira | null
  /** v3.4, só na resposta do salvar: as conquistas que esta carreira provou agora na conta. */
  provasNovas?: string[]
}

export interface ProvaDaCarreira {
  conquistas: number
  unicas: number
  verificada: boolean | null
}

/** O `prova` do C (v3.4), conferido. */
export function normalizarProvaDaCarreira(x: unknown): ProvaDaCarreira | null {
  const p = x as { conquistas?: unknown; unicas?: unknown; verificada?: unknown } | null
  if (!p || typeof p !== 'object') return null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
  return { conquistas: n(p.conquistas), unicas: n(p.unicas), verificada: typeof p.verificada === 'boolean' ? p.verificada : null }
}

/**
 * `entra_na_proxima` (servidor com a correção da revisão 3, §E.7): entra pelas regras de agora, mas ainda não está na
 * fotografia do Hall (refeita de hora em hora); o `motivo` traz a hora da próxima atualização.
 */
export type EstadoHall = 'no_hall' | 'entra_na_proxima' | 'revisao' | 'suspeita' | 'oculta' | 'fora' | 'privada'
export const ESTADOS_HALL: readonly EstadoHall[] = ['no_hall', 'entra_na_proxima', 'revisao', 'suspeita', 'oculta', 'fora', 'privada']
/** Está no Hall público ou entra na próxima atualização (é uma das que a conta mostra). */
export const noHallOuEntrando = (h: HallDaCarreira | null | undefined): boolean => h?.estado === 'no_hall' || h?.estado === 'entra_na_proxima'

/**
 * Por que a carreira está "fora" (servidor v3.2 com a correção da revisão 3): bloqueada, imersivo, versao e duplicada não
 * mudam com a estrela; escolha e limite mudam.
 */
export type PorqueFora = 'bloqueada' | 'imersivo' | 'versao' | 'duplicada' | 'escolha' | 'limite'
export const PORQUES_FORA: readonly PorqueFora[] = ['bloqueada', 'imersivo', 'versao', 'duplicada', 'escolha', 'limite']
/** Os "fora" em que pôr no Hall não muda nada (a estrela não aparece; tirar continua podendo). */
export const PORQUES_SEM_ESTRELA: readonly PorqueFora[] = ['bloqueada', 'imersivo', 'versao', 'duplicada']

export interface HallDaCarreira {
  estado: EstadoHall
  /** Texto curto do servidor, que dá para mostrar (nunca o que a moderação escreveu). */
  motivo: string | null
  /** Só no "fora", de servidor novo; sem ele, a estrela segue a regra de antes. */
  porque?: PorqueFora
}

/** O `hall` do C, conferido: estado desconhecido = sem selo (null). */
export function normalizarHall(x: unknown): HallDaCarreira | null {
  const h = x as { estado?: unknown; motivo?: unknown; porque?: unknown } | null
  if (!h || typeof h !== 'object' || typeof h.estado !== 'string' || !(ESTADOS_HALL as readonly string[]).includes(h.estado)) return null
  const motivo = typeof h.motivo === 'string' ? h.motivo.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const porque = typeof h.porque === 'string' && (PORQUES_FORA as readonly string[]).includes(h.porque) ? (h.porque as PorqueFora) : null
  return porque ? { estado: h.estado as EstadoHall, motivo: motivo || null, porque } : { estado: h.estado as EstadoHall, motivo: motivo || null }
}

/**
 * A estrela "Pôr no Hall" de uma carreira da conta aparece? Some quando a moderação tirou ou a conferência segura a
 * carreira, com "Nenhuma no Hall" e quando ela está fora por uma regra que a estrela não muda (Imersivo, nota de versão
 * antiga, conta fora do Hall, a mesma carreira já no Hall por outra conta) — a não ser que já esteja marcada (para tirar).
 */
export function estrelaDoHall(h: HallDaCarreira | null | undefined, marcada: boolean): boolean {
  if (!h) return true
  if (h.estado !== 'no_hall' && h.estado !== 'entra_na_proxima' && h.estado !== 'fora' && h.estado !== 'revisao') return false
  if (h.estado === 'fora' && h.porque && (PORQUES_SEM_ESTRELA as readonly string[]).includes(h.porque) && !marcada) return false
  return true
}

/**
 * O toast depois da estrela, com o `hall` que o servidor devolveu no publicar: nunca promete o Hall a uma carreira que
 * continua fora (o motivo do servidor vai no lugar da promessa).
 */
export function avisoAoPublicar(jogador: string, sim: boolean, h: HallDaCarreira | null | undefined): { tipo: 'success' | 'info'; titulo: string; texto: string } {
  if (!sim) return { tipo: 'success', titulo: `${jogador} saiu do Hall público`, texto: 'Sai do Hall da comunidade em poucos minutos.' }
  // a revisão: o texto do servidor (ele só promete a entrada quando, conferida, ela estaria entre as que a conta mostra)
  if (h?.estado === 'revisao') return { tipo: 'success', titulo: `${jogador} vai para o Hall público`, texto: h.motivo ?? 'Está em revisão: entra no Hall assim que for conferida.' }
  if (!h || h.estado === 'no_hall') return { tipo: 'success', titulo: `${jogador} vai para o Hall público`, texto: 'Aparece na próxima atualização do Hall, em até 3 h.' }
  // entra pelas regras de agora: o servidor diz quando (a hora da próxima fotografia)
  if (h.estado === 'entra_na_proxima') return { tipo: 'success', titulo: `${jogador} vai para o Hall público`, texto: h.motivo ?? 'Entra no Hall público na próxima atualização.' }
  return { tipo: 'info', titulo: `${jogador} marcada para o Hall`, texto: seloHall(h)?.texto ?? 'Fora do Hall: esta carreira não aparece no Hall público agora.' }
}

export interface SeloHall {
  estado: EstadoHall
  /** O que vai no selo (curto). */
  rotulo: string
  /** A frase inteira (title e a linha embaixo do cartão); null = o selo basta. */
  texto: string | null
  tom: 'ok' | 'revisao' | 'aviso' | 'neutro'
}

/**
 * Depois de salvar (sozinha ou pelo botão): a frase discreta que vai junto do "Salva na sua conta" quando a carreira
 * acabou de ir para a revisão do Hall (nota alta: o admin confere antes de ela aparecer para todo mundo).
 */
export function avisoAoSalvar(c: Pick<CarreiraConta, 'hall'> | null | undefined): string | null {
  return c?.hall?.estado === 'revisao' ? 'Em revisão: entra no Hall público assim que for conferida.' : null
}

/** Várias subiram de uma vez (ao entrar): quantas delas foram para a revisão, numa frase (null = nenhuma). */
export function revisaoNoLote(salvas: number, emRevisao: number): string | null {
  if (emRevisao <= 0) return null
  if (emRevisao === 1) return `${salvas === 1 ? 'Ela está' : 'Uma delas está'} em revisão: entra no Hall público assim que for conferida.`
  return `${emRevisao === salvas ? 'Elas estão' : `${emRevisao} delas estão`} em revisão: entram no Hall público assim que forem conferidas.`
}

/** "A moderação tirou…" → "a moderação tirou…" (depois de "Fora do Hall:"), sem mexer em sigla. */
const minuscula = (t: string) => (t.length > 1 && /\p{Lu}/u.test(t[0]) && !/\p{Lu}/u.test(t[1]) ? t[0].toLocaleLowerCase('pt-BR') + t.slice(1) : t)

/**
 * O selo do Hall público de uma carreira da conta (Minhas carreiras e o resumo dela): "No Hall público", "Em revisão:
 * entra no Hall assim que for conferida", "Fora do Hall: <motivo>" ou "Privada". Sem `hall` (servidor antigo): null.
 */
export function seloHall(h: HallDaCarreira | null | undefined): SeloHall | null {
  if (!h) return null
  switch (h.estado) {
    case 'no_hall':
      return { estado: h.estado, rotulo: 'No Hall público', texto: null, tom: 'ok' }
    case 'entra_na_proxima':
      return { estado: h.estado, rotulo: 'Entra em breve', texto: h.motivo ?? 'Entra no Hall público na próxima atualização.', tom: 'ok' }
    case 'revisao':
      return { estado: h.estado, rotulo: 'Em revisão', texto: h.motivo ?? 'Em revisão: entra no Hall assim que for conferida.', tom: 'revisao' }
    case 'privada':
      return { estado: h.estado, rotulo: 'Privada', texto: h.motivo ?? 'Você escolheu não aparecer no Hall público.', tom: 'neutro' }
    default:
      return {
        estado: h.estado,
        rotulo: 'Fora do Hall',
        texto: `Fora do Hall: ${h.motivo ? minuscula(h.motivo) : 'esta carreira não aparece no Hall público agora.'}`,
        // escondida pela moderação ou esperando a conferência: aviso; escolha do jogador ou regra do Hall: neutro
        tom: h.estado === 'fora' ? 'neutro' : 'aviso',
      }
  }
}

/** Pico de OVR a partir do qual a carreira vai para a conta sozinha ("acima de 89"). */
export const PICO_AUTO = 90
export const LIMITE_PADRAO = 200
/** O servidor aceita até 600 KB (em bytes) por pedido; acima disto tenta sem o diário da carreira. */
export const CARREIRA_MAX_BYTES = 590_000
/** Tamanho em bytes UTF-8 (acento conta 2): é o que o servidor mede. */
const bytes = (s: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3)

export const CHAVE_APAGADAS = 'lenda:carreiras-apagadas'
export const CHAVE_PENDENTES = 'lenda:carreiras-pendentes'
/** As que o jogador mandou salvar (botão) e não subiram por falta de rede: sobem como "manual". */
export const CHAVE_PENDENTES_MANUAL = 'lenda:carreiras-pendentes-manual'
/** As que o servidor recusou com 409 apagada (a moderação removeu): nunca sobem sozinhas de novo neste aparelho. */
export const CHAVE_REMOVIDAS = 'lenda:carreiras-removidas'
/** Id e momento da última carreira encerrada neste aparelho (sabe que ela existiu mesmo se o Hall a cortou). */
export const CHAVE_ULTIMA = 'lenda:ultima-carreira'

// ───────────────────────────── regras puras ─────────────────────────────

export const picoDe = (h: Pick<HallEntry, 'summary'>): number => (typeof h.summary?.peakOvr === 'number' ? h.summary.peakOvr : 0)

/** Pico 90+ vai para a conta sozinha. */
export const salvaSozinha = (h: Pick<HallEntry, 'summary'>) => picoDe(h) >= PICO_AUTO

/** Na hora em que a carreira termina: salvar sozinha? */
export function deveSalvarSozinha(h: Pick<HallEntry, 'id' | 'summary'>, p: { logado: boolean; naConta: ReadonlySet<string>; apagadas: ReadonlySet<string> }): boolean {
  return p.logado && salvaSozinha(h) && !p.naConta.has(h.id) && !p.apagadas.has(h.id)
}

/** Ao entrar/criar a conta: as do aparelho com pico 90+ que a conta ainda não tem (as mais recentes primeiro). */
export function paraSubirAoEntrar(hall: readonly HallEntry[], naConta: ReadonlySet<string>, apagadas: ReadonlySet<string> = new Set()): HallEntry[] {
  return porRecentes(hall.filter((h) => salvaSozinha(h) && !naConta.has(h.id) && !apagadas.has(h.id)))
}

/** Aba "Neste aparelho": o Hall local que não está na conta, as mais recentes primeiro. */
export function nesteAparelho(hall: readonly HallEntry[], naConta: ReadonlySet<string>): HallEntry[] {
  return porRecentes(hall.filter((h) => !naConta.has(h.id)))
}

/** "Salvar a última carreira": a que terminou por último neste aparelho. */
export function ultimaCarreira(hall: readonly HallEntry[]): HallEntry | null {
  return porRecentes(hall)[0] ?? null
}

/**
 * "Salvar a última carreira" com a marca da última encerrada (CHAVE_ULTIMA): se ela é mais nova que a mais
 * recente do Hall e não está nele (o Hall cortou, ou o jogador a tirou), `perdida` — nada de salvar outra no
 * lugar dela avisando que salvou.
 */
export function escolherUltima(hall: readonly HallEntry[], marca: { id: string; em: number } | null): { h: HallEntry | null; perdida: boolean } {
  const h = ultimaCarreira(hall)
  if (!marca || hall.some((x) => x.id === marca.id)) return { h, perdida: false }
  const quando = h ? Date.parse(h.finishedAt) : NaN
  return Number.isFinite(quando) && quando >= marca.em ? { h, perdida: false } : { h: null, perdida: true }
}

interface FotoClassico {
  status: 'idle' | 'restoring' | 'ready'
  isFixture: boolean
  state: { id: string; retired?: boolean; phase?: string } | null
  reveal: unknown
}
interface FotoImersivo {
  status: 'idle' | 'restoring' | 'ready'
  isFixture: boolean
  state: { id: string; retired?: boolean } | null
}

const encerrada = (st: { retired?: boolean; phase?: string }) => !!st.retired || st.phase === 'finished'

/**
 * A carreira do Clássico terminou agora, NESTA janela? Devolve o id (ou null). Vale a transição do próprio
 * estado (a mesma carreira passa de "em jogo" para encerrada numa jogada, com revelação), e não a entrada no
 * Hall: o Hall tem teto e corta as de nota baixa, e o "Jogar novamente" pode vir antes de ela entrar nele.
 * Não conta: o jogo reaberto (a carreira já vem encerrada no init), o estado relido de outra janela (sem
 * revelação) nem fixture. `s`/`p`: o store depois/antes.
 */
export function fimClassico(s: FotoClassico, p: FotoClassico): string | null {
  if (s.status !== 'ready' || p.status !== 'ready' || s.isFixture || p.isFixture || !s.reveal) return null
  if (!s.state || !p.state || s.state.id !== p.state.id || encerrada(p.state) || !encerrada(s.state)) return null
  return s.state.id
}

/** Imersivo: a mesma carreira passou a aposentada agora, nesta janela? Devolve o id (ou null). */
export function fimImersivo(s: FotoImersivo, p: FotoImersivo): string | null {
  if (s.status !== 'ready' || p.status !== 'ready' || s.isFixture || p.isFixture) return null
  if (!s.state || !p.state || s.state.id !== p.state.id || p.state.retired || !s.state.retired) return null
  return s.state.id
}

function porRecentes(l: readonly HallEntry[]): HallEntry[] {
  return [...l].sort((a, b) => String(b.finishedAt ?? '').localeCompare(String(a.finishedAt ?? '')))
}

/** Os mesmos campos que a lista da conta mostra, montados do HallEntry do aparelho. */
export function resumoLocal(h: HallEntry): CarreiraConta {
  const s = h.summary
  return {
    id: h.id,
    modo: h.mode === 'immersive' ? 'imersivo' : 'classico',
    jogador: h.identity?.surname ?? s?.identity?.surname ?? '—',
    numero: h.identity?.number ?? 0,
    pais: h.identity?.nationality ?? '',
    posicao: h.career?.seasons?.at(-1)?.position ?? h.identity?.position ?? '',
    nota: typeof h.legacy?.score === 'number' ? h.legacy.score : typeof s?.legacyScore === 'number' ? Math.round(s.legacyScore) : null,
    notaV: typeof h.legacy?.v === 'number' ? h.legacy.v : null,
    picoOvr: picoDe(h),
    temporadas: s?.seasons ?? 0,
    gols: s?.totals?.goals ?? 0,
    titulos: (s?.trophies ?? []).reduce((a, t) => a + (t.count || 0), 0),
    bolasOuro: (s?.awards ?? []).find((a) => a.award === 'ballon_dor')?.count ?? 0,
    headline: s?.headline ?? '',
    como: null,
    salvaEm: null,
    terminouEm: h.finishedAt ?? null,
    publica: false,
    noHall: null,
    oculta: false,
    suspeita: false,
    bonusOvr: typeof h.career?.bonusOvr === 'number' ? h.career.bonusOvr : 0,
    hall: null,
  }
}

export function normalizarCarreira(x: unknown): CarreiraConta | null {
  const c = x as Partial<CarreiraConta> | null
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: c.id,
    modo: c.modo === 'imersivo' ? 'imersivo' : 'classico',
    jogador: typeof c.jogador === 'string' ? c.jogador : '—',
    numero: num(c.numero),
    pais: typeof c.pais === 'string' ? c.pais : '',
    posicao: typeof c.posicao === 'string' ? c.posicao : '',
    nota: typeof c.nota === 'number' ? c.nota : null,
    notaV: typeof c.notaV === 'number' ? c.notaV : null,
    picoOvr: num(c.picoOvr),
    temporadas: num(c.temporadas),
    gols: num(c.gols),
    titulos: num(c.titulos),
    bolasOuro: num(c.bolasOuro),
    headline: typeof c.headline === 'string' ? c.headline : '',
    como: c.como === 'manual' ? 'manual' : 'auto',
    salvaEm: typeof c.salvaEm === 'string' ? c.salvaEm : null,
    terminouEm: typeof c.terminouEm === 'string' ? c.terminouEm : null,
    publica: c.publica === true || (c.publica as unknown) === 1,
    noHall: typeof c.noHall === 'boolean' ? c.noHall : null,
    oculta: c.oculta === true || (c.oculta as unknown) === 1,
    suspeita: !!c.suspeita,
    bonusOvr: Math.max(0, Math.min(10, num(c.bonusOvr))),
    hall: normalizarHall(c.hall),
    prova: normalizarProvaDaCarreira((c as { prova?: unknown }).prova),
  }
}

/** No Hall público só até 3 por conta (servidor/CONTRATO-v3.md §4). */
export const HALL_PUBLICO_MAX = 3

/**
 * Quais carreiras da conta estão (ou entram na próxima atualização) no Hall público. Se o servidor disse
 * (`noHall`), vale o dele; senão: modo `auto` = as 3 de maior nota na versão atual (fora as ocultas e em
 * análise); `manual` = as marcadas (até 3); `nao` = nenhuma.
 */
export function idsNoHallPublico(lista: readonly CarreiraConta[], modo: 'auto' | 'manual' | 'nao', versao = LEGACY_VERSION): Set<string> {
  if (modo === 'nao') return new Set()
  // v3.2: o estado de cada uma (no Hall, em revisão, fora…) é o que vale; a que entra na próxima atualização (rev3)
  // já é uma das que a conta mostra (a estrela fica marcada no automático e conta no "N/3")
  if (lista.some((c) => c.hall !== null)) return new Set(lista.filter((c) => noHallOuEntrando(c.hall)).map((c) => c.id))
  if (lista.some((c) => c.noHall !== null)) return new Set(lista.filter((c) => c.noHall).map((c) => c.id))
  const validas = lista.filter((c) => !c.oculta && !c.suspeita && c.nota !== null && c.notaV === versao)
  if (modo === 'manual') return new Set(validas.filter((c) => c.publica).slice(0, HALL_PUBLICO_MAX).map((c) => c.id))
  return new Set(
    [...validas]
      .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0) || String(a.terminouEm ?? '').localeCompare(String(b.terminouEm ?? '')))
      .slice(0, HALL_PUBLICO_MAX)
      .map((c) => c.id),
  )
}

/** HallEntry que veio do servidor tem o mínimo para o resumo abrir? */
export function hallEntryValido(x: unknown): x is HallEntry {
  const h = x as HallEntry | null
  return !!h && typeof h === 'object' && typeof h.id === 'string' && !!h.identity && !!h.summary && typeof h.summary.peakOvr === 'number' && !!h.career && Array.isArray(h.career.seasons)
}

/** O que vai para o servidor: o HallEntry inteiro; grande demais, sem o diário (o resumo não usa). */
export function corpoParaSalvar(h: HallEntry, como: 'auto' | 'manual'): string {
  const inteiro = JSON.stringify({ acao: 'salvar', carreira: h, como })
  if (bytes(inteiro) <= CARREIRA_MAX_BYTES) return inteiro
  const leve = { ...h, career: { ...h.career, log: [] } } as HallEntry
  const menor = JSON.stringify({ acao: 'salvar', carreira: leve, como })
  if (bytes(menor) <= CARREIRA_MAX_BYTES) return menor
  throw new ErroApi('grande', 413)
}

/** Conjunto de ids guardado no aparelho (apagadas / pendentes). */
export function lerIds(a: Armazem, chave: string): Set<string> {
  try {
    const l = JSON.parse(a.get(chave) || '[]') as unknown
    return new Set(Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function gravarIds(a: Armazem, chave: string, ids: Set<string>) {
  a.set(chave, JSON.stringify([...ids].slice(-300)))
}

// ───────────────────────────── store ─────────────────────────────

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

interface CarreirasStore {
  /** null = ainda não carregou (ou sem conta). */
  lista: CarreiraConta[] | null
  /** Quando a lista veio do servidor (ms; 0 = nunca): o resumo pede de novo se ela tem mais de 1 min. */
  carregadaEm: number
  limite: number
  carregando: boolean
  erro: string | null
  /** ids sendo salvos agora (botões com "carregando"). */
  salvando: Record<string, true>
  carregar(forcar?: boolean): Promise<CarreiraConta[] | null>
  salvar(h: HallEntry, como: 'auto' | 'manual'): Promise<CarreiraConta>
  apagar(id: string): Promise<void>
  abrir(id: string): Promise<HallEntry>
  /** Marca/desmarca para o Hall público (passa a conta para o modo "escolher", se estava no automático). */
  /** Devolve a carreira como o servidor a deixou (com o `hall` de agora), ou null. */
  publicar(id: string, sim: boolean): Promise<CarreiraConta | null>
  limpar(): void
}

/** 401 de qualquer rota: a sessão caiu — a conta sai deste aparelho. */
function tratar401(err: unknown) {
  if (err instanceof ErroApi && err.status === 401) {
    useConta.getState().sessaoExpirou()
    useCarreiras.getState().limpar()
  }
}

export const useCarreiras = create<CarreirasStore>()((set, get) => ({
  lista: null,
  carregadaEm: 0,
  limite: LIMITE_PADRAO,
  carregando: false,
  erro: null,
  salvando: {},

  async carregar(forcar = false) {
    if (!useConta.getState().usuario) return null
    if (get().lista && !forcar) return get().lista
    set({ carregando: true, erro: null })
    try {
      const r = await api<{ carreiras?: unknown[]; limite?: number; hallPublico?: unknown }>('carreiras.php')
      const lista = (r.carreiras ?? []).map(normalizarCarreira).filter((c): c is CarreiraConta => !!c)
      set({ lista, limite: typeof r.limite === 'number' ? r.limite : LIMITE_PADRAO, carregando: false, carregadaEm: Date.now() })
      // o modo do Hall público vem junto (pode ter mudado em outro aparelho)
      const u = useConta.getState().usuario
      const modo = r.hallPublico === 'auto' || r.hallPublico === 'manual' || r.hallPublico === 'nao' ? r.hallPublico : null
      if (u && modo && modo !== u.hallPublico) useConta.setState({ usuario: { ...u, hallPublico: modo } })
      void atualizarNotasVelhas(lista)
      return lista
    } catch (err) {
      tratar401(err)
      set({ carregando: false, erro: err instanceof ErroApi ? err.message : 'Não foi possível carregar suas carreiras.' })
      throw err
    }
  },

  async salvar(original, como) {
    // a nota vai sempre na versão atual dos pesos (a mesma que o Hall mostra)
    const [h] = await refreshLegacy([original])
    if (get().salvando[h.id]) throw new ErroApi('ocupado', 0, 'Essa carreira já está sendo salva.')
    set({ salvando: { ...get().salvando, [h.id]: true } })
    try {
      const corpo = corpoParaSalvar(h, como)
      const r = await api<{ carreira?: unknown; provasNovas?: unknown; emblemasNovos?: unknown }>('carreiras.php', { corpoJson: corpo, tempo: 30_000 })
      const c: CarreiraConta = normalizarCarreira(r.carreira) ?? { ...resumoLocal(h), como, salvaEm: new Date().toISOString() }
      // v3.4: o que esta carreira provou agora na conta e os emblemas que ela deu (o aviso discreto sai daqui)
      const provasNovas = somarProvasNovas(r.provasNovas, h.id)
      if (provasNovas.length) c.provasNovas = provasNovas
      avisarEmblemasNovos(r.emblemasNovos, useConta.getState().usuario?.id ?? null)
      const atual = get().lista
      if (atual) set({ lista: [c, ...atual.filter((x) => x.id !== c.id)] })
      // salvou: sai das pendentes e das apagadas (o jogador quis de volta)
      const pend = lerIds(ls, CHAVE_PENDENTES)
      if (pend.delete(h.id)) gravarIds(ls, CHAVE_PENDENTES, pend)
      const pendM = lerIds(ls, CHAVE_PENDENTES_MANUAL)
      if (pendM.delete(h.id)) gravarIds(ls, CHAVE_PENDENTES_MANUAL, pendM)
      const apag = lerIds(ls, CHAVE_APAGADAS)
      if (apag.delete(h.id)) gravarIds(ls, CHAVE_APAGADAS, apag)
      // o admin liberou o reenvio (ou foi engano): deixa de ser "removida"
      const rem = lerIds(ls, CHAVE_REMOVIDAS)
      if (rem.delete(h.id)) gravarIds(ls, CHAVE_REMOVIDAS, rem)
      const u = useConta.getState().usuario
      if (u && !atual?.some((x) => x.id === c.id)) useConta.setState({ usuario: { ...u, estatisticas: { ...u.estatisticas, carreirasSalvas: u.estatisticas.carreirasSalvas + 1 } } })
      return c
    } catch (err) {
      tratar401(err)
      // a moderação removeu esta carreira: é final — sai das filas e nunca mais sobe sozinha deste aparelho
      if (err instanceof ErroApi && err.codigo === 'apagada') marcarRemovida(h.id)
      throw err
    } finally {
      const { [h.id]: _, ...resto } = get().salvando
      set({ salvando: resto })
    }
  },

  async apagar(id) {
    try {
      await api('carreiras.php', { corpo: { acao: 'apagar', id } })
    } catch (err) {
      tratar401(err)
      throw err
    }
    const apag = lerIds(ls, CHAVE_APAGADAS)
    apag.add(id)
    gravarIds(ls, CHAVE_APAGADAS, apag)
    const atual = get().lista
    if (atual) set({ lista: atual.filter((c) => c.id !== id) })
    const u = useConta.getState().usuario
    if (u) useConta.setState({ usuario: { ...u, estatisticas: { ...u.estatisticas, carreirasSalvas: Math.max(0, u.estatisticas.carreirasSalvas - 1) } } })
  },

  async abrir(id) {
    try {
      const r = await api<{ carreira?: unknown }>('carreiras.php', { query: { id } })
      if (!hallEntryValido(r.carreira)) throw new ErroApi('servidor', 200, 'Essa carreira veio incompleta do servidor.')
      return r.carreira
    } catch (err) {
      tratar401(err)
      throw err
    }
  },

  async publicar(id, sim) {
    let r: { carreira?: unknown; hallPublico?: unknown }
    try {
      r = await api<{ carreira?: unknown; hallPublico?: unknown }>('carreiras.php', { corpo: { acao: 'publicar', id, sim } })
    } catch (err) {
      tratar401(err)
      throw err
    }
    const atual = get().lista
    const c = normalizarCarreira(r?.carreira)
    // vindo do automático, o servidor marca as 3 que já estavam no Hall: até a lista nova chegar, a conta
    // aqui mostra a escolha manual
    if (atual) set({ lista: atual.map((x) => (x.id === id ? (c ?? { ...x, publica: sim }) : x)) })
    const u = useConta.getState().usuario
    const modo = r?.hallPublico === 'auto' || r?.hallPublico === 'manual' || r?.hallPublico === 'nao' ? r.hallPublico : 'manual'
    if (u && u.hallPublico !== modo) useConta.setState({ usuario: { ...u, hallPublico: modo } })
    void get()
      .carregar(true)
      .catch(() => {})
    return c
  },

  limpar() {
    set({ lista: null, erro: null, salvando: {}, carregadaEm: 0 })
  },
}))

/**
 * Carreiras da conta gravadas com outra versão dos pesos da Nota de Legado: abre, recalcula e salva de novo
 * (mesmo `como`), uma de cada vez e no máximo 20 por abertura, para a nota da lista bater com a do Hall.
 */
let atualizando = false
export async function atualizarNotasVelhas(lista: readonly CarreiraConta[]) {
  if (atualizando) return
  const velhas = lista.filter((c) => c.notaV !== LEGACY_VERSION).slice(0, 20)
  if (!velhas.length) return
  atualizando = true
  try {
    for (const c of velhas) {
      try {
        const h = await useCarreiras.getState().abrir(c.id)
        await useCarreiras.getState().salvar(h, c.como === 'manual' ? 'manual' : 'auto')
      } catch {
        // sem rede ou carreira incompleta: tenta de novo na próxima vez que a lista abrir
      }
    }
  } finally {
    atualizando = false
  }
}

export const idsNaConta = (lista: readonly CarreiraConta[] | null): Set<string> => new Set((lista ?? []).map((c) => c.id))
/** As que não sobem sozinhas: apagadas da conta pelo jogador neste aparelho e as removidas pela moderação. */
export const apagadasNoAparelho = () => new Set([...lerIds(ls, CHAVE_APAGADAS), ...lerIds(ls, CHAVE_REMOVIDAS)])
/** Removidas pela moderação (409 apagada): a lista "Neste aparelho" mostra o selo. */
export const removidasNoAparelho = () => lerIds(ls, CHAVE_REMOVIDAS)

/** 409 apagada: sai das duas filas e entra nas removidas (nada de tentar de novo a cada abertura). */
export function marcarRemovida(id: string, a: Armazem = ls) {
  for (const chave of [CHAVE_PENDENTES, CHAVE_PENDENTES_MANUAL]) {
    const p = lerIds(a, chave)
    if (p.delete(id)) gravarIds(a, chave, p)
  }
  const r = lerIds(a, CHAVE_REMOVIDAS)
  if (!r.has(id)) {
    r.add(id)
    gravarIds(a, CHAVE_REMOVIDAS, r)
  }
}

/** O HallEntry de uma carreira deste aparelho: no Hall ou, cortada pelo teto dele, a última encerrada nesta janela. */
export function acharCarreira(id: string): HallEntry | null {
  const c = useCareer.getState()
  return c.finishedCareers.find((h) => h.id === id) ?? (c.lastFinished?.id === id ? c.lastFinished : null)
}

/** O Hall do aparelho (sem as transitórias), mais a última encerrada nesta janela se o corte a deixou de fora. */
export function hallComUltima(): HallEntry[] {
  const c = useCareer.getState()
  const hall = c.finishedCareers.filter((h) => !ehTransitoria(h.id))
  const u = c.lastFinished
  return u && !hall.some((h) => h.id === u.id) ? [...hall, u] : hall
}

export function marcarUltima(id: string, em = Date.now()) {
  ls.set(CHAVE_ULTIMA, JSON.stringify({ id, em }))
}
export function lerUltima(a: Armazem = ls): { id: string; em: number } | null {
  try {
    const j = JSON.parse(a.get(CHAVE_ULTIMA) || 'null') as { id?: unknown; em?: unknown } | null
    return j && typeof j.id === 'string' && typeof j.em === 'number' && Number.isFinite(j.em) ? { id: j.id, em: j.em } : null
  } catch {
    return null
  }
}

/** Não subiu agora (sem rede): fica na fila do aparelho e sobe quando a internet voltar (ou na próxima abertura). */
export function marcarPendente(id: string, como: 'auto' | 'manual' = 'auto') {
  const chave = como === 'manual' ? CHAVE_PENDENTES_MANUAL : CHAVE_PENDENTES
  const p = lerIds(ls, chave)
  p.add(id)
  gravarIds(ls, chave, p)
}
export const pendentesNoAparelho = () => lerIds(ls, CHAVE_PENDENTES)
export const pendentesManuais = () => lerIds(ls, CHAVE_PENDENTES_MANUAL)

// ───────────────────────────── abrir no resumo ─────────────────────────────

/**
 * Carreiras abertas da conta que não estão no Hall deste aparelho: entram só na memória (para o #/resumo
 * achar pelo id) e saem quando o jogador deixa o resumo — a não ser que ele as guarde no aparelho.
 */
const transitorias = new Set<string>()
export const ehTransitoria = (id: string) => transitorias.has(id)
/**
 * Marca no próprio HallEntry de uma carreira transitória, que o resumo (SummaryScreen) lê pelo mesmo
 * Symbol.for sem importar o site: lá ela não aparece como "Salvo no Hall das Lendas". Não enumerável e
 * de símbolo, não vai para o IndexedDB nem para o JSON.
 */
export const MARCA_SO_NA_CONTA = Symbol.for('lenda:so-na-conta')

/** `navegar: false` (link #/resumo?id= aberto direto): só mostra se o jogador ainda estiver nesse resumo. */
export async function abrirCarreiraDaConta(id: string, o: { navegar?: boolean } = {}): Promise<void> {
  if (!useCareer.getState().finishedCareers.some((h) => h.id === id)) {
    const h = await useCarreiras.getState().abrir(id)
    const r = useApp.getState().route
    if (o.navegar === false && !(r.path === '/resumo' && r.query.id === id)) return
    const atual = useCareer.getState().finishedCareers
    if (!atual.some((x) => x.id === h.id)) {
      transitorias.add(h.id)
      Object.defineProperty(h, MARCA_SO_NA_CONTA, { value: true })
      useCareer.setState({ finishedCareers: [...atual, h] })
    }
  }
  if (o.navegar !== false) navigate('/resumo', { query: { id } })
}

/** "Guardar no Hall deste aparelho": grava junto com o Hall salvo (ler-mesclar-gravar, como o jogo faz). */
export async function guardarNoAparelho(id: string): Promise<boolean> {
  const mem = useCareer.getState().finishedCareers
  const h = mem.find((x) => x.id === id)
  if (!h) return false
  let salvo: HallEntry[] = []
  try {
    const l = await kv.get<HallEntry[]>(KV_KEYS.hall)
    salvo = Array.isArray(l) ? l : []
  } catch {
    salvo = []
  }
  const outras = new Map<string, HallEntry>()
  for (const x of mem) if (!transitorias.has(x.id) || x.id === id) outras.set(x.id, x)
  for (const x of salvo) outras.set(x.id, x)
  // número da run já usado por outra deste aparelho: ganha o próximo livre
  const usados = new Set([...outras.values()].filter((x) => x.id !== id).map((x) => x.runNo))
  // cópia: sai a marca de "só na conta" (o spread não copia propriedade não enumerável)
  const entrada = usados.has(h.runNo) ? { ...h, runNo: Math.max(0, ...[...usados].map((n) => n ?? 0)) + 1 } : { ...h }
  outras.set(id, entrada)
  const lista = withRunNumbers([...outras.values()])
  const ok = await kv.set(KV_KEYS.hall, lista)
  if (!ok) return false
  transitorias.delete(id)
  const resto = mem.filter((x) => transitorias.has(x.id) && x.id !== id)
  useCareer.setState({ finishedCareers: [...lista, ...resto] })
  return true
}

/** Saiu do resumo de uma carreira transitória: ela sai da memória (o Hall volta a ser só o do aparelho). */
export function vigiarTransitorias(): () => void {
  return useApp.subscribe((s) => {
    if (!transitorias.size) return
    const aberta = s.route.path === '/resumo' ? s.route.query.id : undefined
    const sair = [...transitorias].filter((id) => id !== aberta)
    if (!sair.length) return
    for (const id of sair) transitorias.delete(id)
    const fora = new Set(sair)
    useCareer.setState({ finishedCareers: useCareer.getState().finishedCareers.filter((h) => !fora.has(h.id)) })
  })
}
