/**
 * O que este visitante pode ver: o que é público e o que é só do administrador (servidor/CONTRATO-v3.md §1–2).
 *
 *   const live = useAcesso(podeLive)                 // menu, tela inicial, rota #/live
 *   const portao = portaoDaRota(route, useAcesso())  // 'ok' | 'verificar' | 'nao-encontrada' | 'em-breve' | 'manutencao'
 *
 * Fora do site (build local, claude.ai) tudo fica como sempre foi: tudo aberto, sem servidor. No site
 * (VITE_SITE=1) o padrão é FECHADO — Live e Modo Imersivo só para o admin — até o GET conta.php dizer outra
 * coisa (`site`), e quem é admin só o servidor diz (GET painel.php?so=eu, o cookie do painel). Nada de
 * segredo aqui: o cliente só esconde; quem confere de verdade é o servidor. O src/site preenche este store.
 */
import { create } from 'zustand'
import type { RouteState } from './app'

const SITE = import.meta.env.VITE_SITE === '1'

export interface AvisoSite {
  texto: string
  tipo: 'info' | 'alerta'
}

/** Para quem é um aviso da lista (v3.2, N14): todo mundo, só quem está com a conta aberta, ou só quem está sem conta. */
export type PublicoAviso = 'todos' | 'logados' | 'visitantes'

/** Um dos avisos da lista do painel (site.avisos): com público e, se tiver, o fim da validade (ISO). */
export interface AvisoLista extends AvisoSite {
  publico: PublicoAviso
  /** ISO (fim do dia em Brasília) ou null = sem fim. */
  ate: string | null
}

export interface Acesso {
  /** O servidor confirmou o cookie do painel neste navegador. */
  admin: boolean
  /** 'desconhecido': ainda não perguntou (só pergunta quando precisa); 'verificando': a pergunta está no ar. */
  adminStatus: 'desconhecido' | 'verificando' | 'sim' | 'nao'
  /** O GET conta.php já respondeu (ou falhou): antes disso, rota fechada espera em vez de dizer "não". */
  configPronta: boolean
  livePublica: boolean
  imersivoPublico: boolean
  manutencao: boolean
  cadastroAberto: boolean
  aviso: AvisoSite | null
  /** Avisos da lista do painel (v3.2): o site manda os do público de quem pediu; a faixa ainda confere público e prazo. */
  avisos: AvisoLista[]
  /** Há uma conta aberta neste aparelho (o site diz; decide os avisos "logados" × "visitantes"). */
  logado: boolean
  /**
   * Conta de testes (v3.2, P1-6: usuarios.tipo = tester, o U.tester do GET conta.php): abre o Modo Imersivo e a Live
   * como o admin (com o selo "Teste"), mas sem o painel, sem o #/kit e sem passar pela manutenção.
   */
  tester: boolean
  /** O site registra aqui a pergunta ao servidor (painel.php?so=eu); fora do site não há nada a perguntar. */
  verificarAdmin: (() => void) | null
}

export const useAcesso = create<Acesso>()(() => ({
  admin: false,
  adminStatus: SITE ? 'desconhecido' : 'nao',
  configPronta: !SITE,
  livePublica: !SITE,
  imersivoPublico: !SITE,
  manutencao: false,
  cadastroAberto: true,
  aviso: null,
  avisos: [],
  logado: false,
  tester: false,
  verificarAdmin: null,
}))

type Quem = Pick<Acesso, 'admin'> & Partial<Pick<Acesso, 'tester'>>

/** Live interativa visível (menu, links, rota): pública, do admin ou de uma conta de testes. */
export const podeLive = (s: Pick<Acesso, 'livePublica'> & Quem) => s.livePublica || s.admin || !!s.tester
/** Modo Imersivo jogável (senão: "Em desenvolvimento"): público, do admin ou de uma conta de testes. */
export const podeImersivo = (s: Pick<Acesso, 'imersivoPublico'> & Quem) => s.imersivoPublico || s.admin || !!s.tester
/** Telas de teste (#/kit, ?fixture=): fora do site como sempre; no site, só o admin (a conta de testes não). */
export const podeDebug = (s: Pick<Acesso, 'admin'>, site = SITE) => !site || s.admin
/** Aberto só porque é o admin (mostra o selo "Teste · só admin"). */
export const soAdmin = (s: Pick<Acesso, 'admin'>, publico: boolean, site = SITE) => site && s.admin && !publico
/**
 * Aberto só porque é o admin ou uma conta de testes (o selo "Teste"): 'admin' | 'tester' | null (público, ou fora do
 * site). O admin ganha do tester (mesmo logado com uma conta de testes, ele vê "só admin").
 */
export function emTeste(s: Quem, publico: boolean, site = SITE): 'admin' | 'tester' | null {
  if (!site || publico) return null
  return s.admin ? 'admin' : s.tester ? 'tester' : null
}

/**
 * "#/resumo?id=…&de=admin": o admin abrindo uma carreira qualquer pelo painel (v3.2, X4). Para o público, nada muda.
 * "#/verificar?id=…" (v3.3): a verificação por replay de uma candidata a desafio, que o painel abre.
 */
export const rotaDeAdmin = (r: Pick<RouteState, 'path' | 'query'>) => (r.path === '/resumo' && r.query.de === 'admin' && !!r.query.id) || r.path === '/verificar'

/**
 * Os avisos que a faixa do topo mostra agora: o `aviso` único de sempre e os da lista que ainda valem e são do público
 * de quem está aqui (logado × visitante), sem repetir o mesmo texto; os de alerta primeiro, depois a ordem do painel.
 */
export function avisosVisiveis(s: Pick<Acesso, 'aviso' | 'avisos' | 'logado'>, agora = Date.now()): AvisoSite[] {
  const out: AvisoSite[] = []
  const vistos = new Set<string>()
  const por = (a: AvisoSite) => {
    const k = `${a.tipo}:${a.texto}`
    if (vistos.has(k)) return
    vistos.add(k)
    out.push({ texto: a.texto, tipo: a.tipo })
  }
  if (s.aviso) por(s.aviso)
  for (const a of s.avisos ?? []) {
    if (a.publico === 'logados' && !s.logado) continue
    if (a.publico === 'visitantes' && s.logado) continue
    const fim = a.ate ? Date.parse(a.ate) : NaN
    if (Number.isFinite(fim) && fim <= agora) continue
    por(a)
  }
  return out.map((a, i) => ({ a, i })).sort((x, y) => (x.a.tipo === y.a.tipo ? x.i - y.i : x.a.tipo === 'alerta' ? -1 : 1)).map((x) => x.a)
}

/** Quando o próximo aviso da lista vence (ms desde a época), para a faixa sumir com ele sem recarregar; null = nenhum. */
export function proximoVencimento(avisos: readonly AvisoLista[], agora = Date.now()): number | null {
  let min: number | null = null
  for (const a of avisos) {
    const fim = a.ate ? Date.parse(a.ate) : NaN
    if (Number.isFinite(fim) && fim > agora && (min === null || fim < min)) min = fim
  }
  return min
}

export type Portao = 'ok' | 'verificar' | 'nao-encontrada' | 'em-breve' | 'manutencao'

/** A rota pedida é uma das que o Modo Imersivo abre? (#/imersivo e a identidade com ?modo=imersivo) */
export const rotaImersiva = (r: Pick<RouteState, 'path' | 'query'>) => r.path === '/imersivo' || (r.path === '/identidade' && r.query.modo === 'imersivo')

/**
 * Pode mostrar esta rota? 'verificar' = ainda não dá para dizer (a config ou a pergunta do admin estão no ar):
 * mostra o carregando e pede a verificação. Fora do site é sempre 'ok'.
 */
export function portaoDaRota(r: Pick<RouteState, 'path' | 'query'>, s: Acesso, site = SITE): Portao {
  if (!site) return 'ok'
  const indefinido = s.adminStatus === 'desconhecido' || s.adminStatus === 'verificando'
  if (s.manutencao && !s.admin) return indefinido ? 'verificar' : 'manutencao'
  if (!rotaFechada(r, s, site)) return 'ok'
  if (!s.configPronta || indefinido) return 'verificar'
  return rotaImersiva(r) ? 'em-breve' : 'nao-encontrada'
}

/** A rota (ou o site inteiro, em manutenção) está fechada para quem não é admin, do jeito que o store está agora? */
export function rotaFechada(r: Pick<RouteState, 'path' | 'query'>, s: Acesso, site = SITE): boolean {
  if (!site || s.admin) return false
  if (s.manutencao) return true
  // #/kit e #/verificar (v3.3): só o admin, nunca a conta de testes
  return r.path === '/live' ? !podeLive(s) : rotaImersiva(r) ? !podeImersivo(s) : r.path === '/kit' || r.path === '/verificar'
}

/** Pede ao site para conferir o admin (uma vez; o resultado fica no store). */
export function pedirAdmin() {
  const s = useAcesso.getState()
  if (s.adminStatus === 'desconhecido') s.verificarAdmin?.()
}
