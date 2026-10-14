/**
 * Público × admin no site (servidor/CONTRATO-v3.md §1–2): lê o `site` do GET conta.php e pergunta ao servidor
 * se este navegador é do administrador (GET painel.php?so=eu, com o cookie do painel). Preenche o
 * useAcesso (src/store/acesso.ts), que o menu, a tela inicial e as rotas leem.
 *
 *   aplicarSite(r.site)       // depois do GET conta.php (ou aplicarSite(null) se ele falhou)
 *   iniciarAcesso()           // uma vez (vigias): registra a verificação e pergunta só quando precisa
 *
 * Pergunta ao painel.php só quando faz diferença — rota fechada aberta (#/live, #/imersivo, #/kit), site em
 * manutenção, ou este navegador já foi confirmado como admin antes (marca no localStorage) —, para não somar
 * um pedido por visitante com muita gente jogando. A marca é só um "vale a pena perguntar": quem decide é a
 * resposta do servidor.
 */
import { useApp } from '@/store/app'
import { rotaFechada, useAcesso, type AvisoSite } from '@/store/acesso'
import { api, ErroApi } from './api'
import { armazem } from './medicao'

export interface RegrasBonus {
  /** Bônus da 1ª, 2ª e 3ª indicação válida. */
  indicacao: number[]
  compartilhar: number
  liberaAposPartidas: number
  maxIndicacoes: number
}

export interface SiteConfig {
  imersivoPublico: boolean
  livePublica: boolean
  aviso: AvisoSite | null
  manutencao: boolean
  cadastroAberto: boolean
  bonus: RegrasBonus
}

export const BONUS_PADRAO: RegrasBonus = { indicacao: [2, 3, 5], compartilhar: 2, liberaAposPartidas: 3, maxIndicacoes: 3 }
/** Sem resposta do servidor: tudo o que é só do admin continua fechado. */
export const SITE_PADRAO: SiteConfig = { imersivoPublico: false, livePublica: false, aviso: null, manutencao: false, cadastroAberto: true, bonus: BONUS_PADRAO }

export const CHAVE_ADMIN = 'lenda:admin'

const bool = (v: unknown, padrao: boolean) => (typeof v === 'boolean' ? v : padrao)
const intEntre = (v: unknown, min: number, max: number, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : padrao)

export function normalizarBonus(x: unknown): RegrasBonus {
  const b = (x ?? {}) as Partial<Record<keyof RegrasBonus, unknown>>
  const ind = Array.isArray(b.indicacao) ? b.indicacao.map((v) => intEntre(v, 0, 10, 0)).slice(0, 10) : BONUS_PADRAO.indicacao
  return {
    indicacao: ind.length ? ind : BONUS_PADRAO.indicacao,
    compartilhar: intEntre(b.compartilhar, 0, 10, BONUS_PADRAO.compartilhar),
    liberaAposPartidas: intEntre(b.liberaAposPartidas, 0, 50, BONUS_PADRAO.liberaAposPartidas),
    maxIndicacoes: intEntre(b.maxIndicacoes, 0, 10, BONUS_PADRAO.maxIndicacoes),
  }
}

/** O `site` do GET conta.php, conferido campo a campo (o que vier estranho fica no padrão fechado). */
export function normalizarSite(x: unknown): SiteConfig {
  const s = (x ?? null) as Partial<Record<keyof SiteConfig, unknown>> | null
  if (!s || typeof s !== 'object') return SITE_PADRAO
  const a = s.aviso as Partial<AvisoSite> | null | undefined
  const texto = a && typeof a === 'object' && typeof a.texto === 'string' ? a.texto.trim().slice(0, 280) : ''
  return {
    imersivoPublico: bool(s.imersivoPublico, false),
    livePublica: bool(s.livePublica, false),
    aviso: texto ? { texto, tipo: a?.tipo === 'alerta' ? 'alerta' : 'info' } : null,
    manutencao: bool(s.manutencao, false),
    cadastroAberto: bool(s.cadastroAberto, true),
    bonus: normalizarBonus(s.bonus),
  }
}

let regrasBonus: RegrasBonus = BONUS_PADRAO
export const bonusDoSite = () => regrasBonus

/** Aplica a config do site no store de acesso. `null` (o GET falhou): o padrão fechado. */
export function aplicarSite(x: unknown) {
  const c = x === null ? SITE_PADRAO : normalizarSite(x)
  regrasBonus = c.bonus
  useAcesso.setState({ configPronta: true, livePublica: c.livePublica, imersivoPublico: c.imersivoPublico, manutencao: c.manutencao, cadastroAberto: c.cadastroAberto, aviso: c.aviso })
}

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

let tentativaAdmin = 0
let ultimaVerificacao = 0
/** Quem já ouviu "não" só pergunta de novo depois disto (o admin que entrou no painel com o jogo aberto). */
const DE_NOVO_MS = 30_000
/** GET painel.php?so=eu: 200 {admin:true} = admin; 401 = não; sem rede = "não" por ora (tenta de novo depois, se havia a marca). */
export async function verificarAdmin(): Promise<boolean> {
  if (useAcesso.getState().adminStatus === 'verificando') return useAcesso.getState().admin
  useAcesso.setState({ adminStatus: 'verificando' })
  ultimaVerificacao = Date.now()
  try {
    const r = await api<{ admin?: unknown }>('painel.php', { query: { so: 'eu' }, tempo: 8000 })
    const sim = r?.admin === true
    ls.set(CHAVE_ADMIN, sim ? '1' : '')
    useAcesso.setState({ admin: sim, adminStatus: sim ? 'sim' : 'nao' })
    return sim
  } catch (err) {
    const recusou = err instanceof ErroApi && (err.status === 401 || err.status === 403)
    if (recusou) ls.set(CHAVE_ADMIN, '')
    useAcesso.setState({ admin: false, adminStatus: 'nao' })
    // sem rede com a marca de admin: mais uma tentativa daqui a pouco (espera crescente, no máximo 3)
    if (!recusou && ls.get(CHAVE_ADMIN) === '1' && tentativaAdmin < 3) {
      const espera = 4000 * 2 ** tentativaAdmin++
      window.setTimeout(() => {
        useAcesso.setState({ adminStatus: 'desconhecido' })
        void verificarAdmin()
      }, espera)
    }
    return false
  }
}

let iniciado = false
export function iniciarAcesso() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  useAcesso.setState({ verificarAdmin: () => void verificarAdmin() })
  const precisa = () => {
    const s = useAcesso.getState()
    if (s.adminStatus === 'verificando' || s.adminStatus === 'sim') return false
    const fechada = rotaFechada(useApp.getState().route, s)
    if (s.adminStatus === 'nao') return fechada && Date.now() - ultimaVerificacao > DE_NOVO_MS
    return fechada || ls.get(CHAVE_ADMIN) === '1'
  }
  if (precisa()) void verificarAdmin()
  // rota fechada aberta depois (link da aba Testes do painel), ou o site entrou em manutenção
  useApp.subscribe((s, p) => {
    if (s.route !== p.route && precisa()) void verificarAdmin()
  })
  useAcesso.subscribe((s, p) => {
    if ((s.configPronta !== p.configPronta || s.manutencao !== p.manutencao) && precisa()) void verificarAdmin()
  })
}
