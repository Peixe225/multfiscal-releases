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
  verificarAdmin: null,
}))

/** Live interativa visível (menu, links, rota). */
export const podeLive = (s: Pick<Acesso, 'livePublica' | 'admin'>) => s.livePublica || s.admin
/** Modo Imersivo jogável (senão: "Em desenvolvimento"). */
export const podeImersivo = (s: Pick<Acesso, 'imersivoPublico' | 'admin'>) => s.imersivoPublico || s.admin
/** Telas de teste (#/kit, ?fixture=): fora do site como sempre; no site, só o admin. */
export const podeDebug = (s: Pick<Acesso, 'admin'>, site = SITE) => !site || s.admin
/** Aberto só porque é o admin (mostra o selo "Teste · só admin"). */
export const soAdmin = (s: Pick<Acesso, 'admin'>, publico: boolean, site = SITE) => site && s.admin && !publico

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
  return r.path === '/live' ? !podeLive(s) : rotaImersiva(r) ? !podeImersivo(s) : r.path === '/kit'
}

/** Pede ao site para conferir o admin (uma vez; o resultado fica no store). */
export function pedirAdmin() {
  const s = useAcesso.getState()
  if (s.adminStatus === 'desconhecido') s.verificarAdmin?.()
}
