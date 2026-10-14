/**
 * Conta do jogador no site (POST/GET /lenda/api/conta.php — servidor/CONTRATO.md).
 *
 *   await useConta.getState().carregar()                  // GET: quem está logado + regras do convite
 *   useConta.getState().contarPartida()                   // +1 no contador do aparelho
 *   await useConta.getState().entrar(email, senha)        // lança ErroApi com a mensagem pt-BR do servidor
 *   deveAbrirConvite({ partidas, regras, logado, proximoConvite })
 *
 * Contador de partidas (localStorage['lenda:partidas']): +1 por carreira terminada no Clássico e +1 por
 * partida jogada no Imersivo (a Live não conta). Logado, o servidor guarda o maior número que já viu.
 */
import { create } from 'zustand'
import { api } from './api'
import { armazem, origemAtual, visitanteAtual, type Armazem } from './medicao'

export interface Estatisticas {
  partidas: number
  carreirasSalvas: number
  melhorNota: number | null
  melhorJogador: string | null
  bolasOuro: number
  gols: number
  titulos: number
  tempoJogadoMin: number
  primeiroAcesso: string | null
  ultimoAcesso: string | null
  aparelhos: string[]
}

export interface Usuario {
  id: number
  apelido: string
  email: string
  criadoEm: string
  timeCoracao: string | null
  uf: string | null
  origem: string | null
  estatisticas: Estatisticas
}

export interface Regras {
  aposPartidas: number
  obrigatorio: boolean
  lembrarACada: number
}

export const REGRAS_PADRAO: Regras = { aposPartidas: 5, obrigatorio: false, lembrarACada: 3 }

export const CHAVE_PARTIDAS = 'lenda:partidas'
export const CHAVE_PROXIMO = 'lenda:proximo-convite'
/** Último usuário visto (só apelido/id): sem servidor, quem já entrou não leva o convite na cara. */
export const CHAVE_USUARIO = 'lenda:conta'

/** Siglas aceitas no campo "Estado" (EX = fora do Brasil). */
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const

// ───────────────────────────── regras puras ─────────────────────────────

export function lerInteiro(a: Armazem, chave: string): number {
  const n = Number(a.get(chave))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function normalizarRegras(x: unknown): Regras {
  const r = (x ?? {}) as Partial<Record<keyof Regras, unknown>>
  const int = (v: unknown, padrao: number, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : padrao)
  return {
    aposPartidas: int(r.aposPartidas, REGRAS_PADRAO.aposPartidas, 0),
    obrigatorio: typeof r.obrigatorio === 'boolean' ? r.obrigatorio : REGRAS_PADRAO.obrigatorio,
    lembrarACada: int(r.lembrarACada, REGRAS_PADRAO.lembrarACada, 1),
  }
}

/**
 * O convite abre quando o aparelho já tem `aposPartidas` partidas, ninguém está logado e (é obrigatório ou
 * já passou o "lembrar depois" do último "Agora não").
 */
export function deveAbrirConvite(p: { partidas: number; regras: Regras; logado: boolean; proximoConvite: number }): boolean {
  if (p.logado) return false
  if (p.partidas < p.regras.aposPartidas) return false
  return p.regras.obrigatorio || p.partidas >= p.proximoConvite
}

/** "Agora não": volta depois de mais `lembrarACada` partidas. */
export const proximoAposAdiar = (partidas: number, regras: Regras) => partidas + Math.max(1, regras.lembrarACada)

export function normalizarUsuario(x: unknown): Usuario | null {
  const u = x as Partial<Usuario> | null
  if (!u || typeof u !== 'object' || typeof u.apelido !== 'string') return null
  const e = (u.estatisticas ?? {}) as Partial<Estatisticas>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: num(u.id),
    apelido: u.apelido,
    email: typeof u.email === 'string' ? u.email : '',
    criadoEm: typeof u.criadoEm === 'string' ? u.criadoEm : '',
    timeCoracao: typeof u.timeCoracao === 'string' && u.timeCoracao ? u.timeCoracao : null,
    uf: typeof u.uf === 'string' && u.uf ? u.uf : null,
    origem: typeof u.origem === 'string' ? u.origem : null,
    estatisticas: {
      partidas: num(e.partidas),
      carreirasSalvas: num(e.carreirasSalvas),
      melhorNota: typeof e.melhorNota === 'number' ? e.melhorNota : null,
      melhorJogador: typeof e.melhorJogador === 'string' ? e.melhorJogador : null,
      bolasOuro: num(e.bolasOuro),
      gols: num(e.gols),
      titulos: num(e.titulos),
      tempoJogadoMin: num(e.tempoJogadoMin),
      primeiroAcesso: typeof e.primeiroAcesso === 'string' ? e.primeiroAcesso : null,
      ultimoAcesso: typeof e.ultimoAcesso === 'string' ? e.ultimoAcesso : null,
      aparelhos: Array.isArray(e.aparelhos) ? e.aparelhos.filter((a): a is string => typeof a === 'string') : [],
    },
  }
}

// Validação no aparelho (a mesma do servidor): erro na hora, sem ida e volta
const APELIDO_RE = /^[\p{L}\p{N}_.\- ]{2,20}$/u
export function erroApelido(a: string): string | null {
  if (a !== a.trim() || !APELIDO_RE.test(a)) return 'O apelido precisa ter de 2 a 20 letras, números, espaço, _ . ou - (sem espaço nas pontas).'
  return null
}
export function erroEmail(e: string): string | null {
  const v = e.trim()
  if (!v || v.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Confira o e-mail.'
  return null
}
export function erroSenha(s: string): string | null {
  if (s.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (s.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  return null
}

// ───────────────────────────── store ─────────────────────────────

export interface DadosCadastro {
  apelido: string
  email: string
  senha: string
  timeCoracao?: string
  uf?: string
}

interface ContaStore {
  /** 'carregando' até o GET responder (ou falhar): o convite espera. */
  status: 'carregando' | 'pronto'
  usuario: Usuario | null
  /** Apelido do último login neste aparelho (sem servidor no ar, para não pedir conta a quem já tem). */
  lembrado: string | null
  regras: Regras
  partidas: number
  proximoConvite: number
  carregar(): Promise<void>
  /** Relê o contador e o adiamento do aparelho (outra aba mexeu neles). */
  releer(): void
  contarPartida(): void
  adiarConvite(): void
  cadastrar(d: DadosCadastro): Promise<Usuario>
  entrar(email: string, senha: string): Promise<Usuario>
  sair(): Promise<void>
  /** O servidor disse que a sessão não vale mais (401): sai sem chamar o servidor. */
  sessaoExpirou(): void
  esqueci(email: string): Promise<void>
  redefinir(email: string, codigo: string, senha: string): Promise<Usuario>
  perfil(p: { apelido?: string; timeCoracao?: string; uf?: string }): Promise<Usuario>
  excluir(senha: string): Promise<void>
}

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

/** Quem quiser saber de cada login/cadastro (ex.: subir as carreiras do aparelho). */
type AoEntrar = (u: Usuario, como: 'cadastro' | 'login' | 'redefinir') => void
const ouvintes = new Set<AoEntrar>()
export function aoEntrar(fn: AoEntrar): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}

function lembrar(u: Usuario | null) {
  ls.set(CHAVE_USUARIO, u ? JSON.stringify({ id: u.id, apelido: u.apelido }) : '')
}
function lembrado(): string | null {
  try {
    const j = JSON.parse(ls.get(CHAVE_USUARIO) || 'null') as { apelido?: string } | null
    return typeof j?.apelido === 'string' ? j.apelido : null
  } catch {
    return null
  }
}

export const useConta = create<ContaStore>()((set, get) => {
  const enviarPartidas = (n: number) => {
    if (!get().usuario || n <= 0) return
    void api('conta.php', { corpo: { acao: 'partidas', n } }).catch(() => {})
  }
  const logou = (u: Usuario, como: 'cadastro' | 'login' | 'redefinir') => {
    lembrar(u)
    set({ usuario: u, lembrado: u.apelido })
    if (get().partidas > u.estatisticas.partidas) enviarPartidas(get().partidas)
    for (const fn of ouvintes) {
      try {
        fn(u, como)
      } catch (err) {
        console.warn('[LENDA] pós-login falhou', err)
      }
    }
  }
  const comUsuario = (r: { usuario?: unknown }) => {
    const u = normalizarUsuario(r?.usuario)
    if (!u) throw new Error('Resposta inesperada do servidor.')
    return u
  }

  return {
    status: 'carregando',
    usuario: null,
    lembrado: lembrado(),
    regras: REGRAS_PADRAO,
    partidas: lerInteiro(ls, CHAVE_PARTIDAS),
    proximoConvite: lerInteiro(ls, CHAVE_PROXIMO),

    async carregar() {
      try {
        const r = await api<{ usuario: unknown; regras: unknown }>('conta.php', { tempo: 8000 })
        const u = normalizarUsuario(r.usuario)
        lembrar(u)
        set({ usuario: u, lembrado: u?.apelido ?? null, regras: normalizarRegras(r.regras), status: 'pronto' })
        if (u && get().partidas > u.estatisticas.partidas) enviarPartidas(get().partidas)
      } catch {
        // sem servidor: regras padrão; quem já entrou neste aparelho segue "lembrado" (sem convite)
        set({ regras: REGRAS_PADRAO, status: 'pronto' })
      }
    },

    releer() {
      set({ partidas: lerInteiro(ls, CHAVE_PARTIDAS), proximoConvite: lerInteiro(ls, CHAVE_PROXIMO) })
    },

    contarPartida() {
      const n = lerInteiro(ls, CHAVE_PARTIDAS) + 1
      ls.set(CHAVE_PARTIDAS, String(n))
      set({ partidas: n })
      enviarPartidas(n)
    },

    adiarConvite() {
      const n = proximoAposAdiar(get().partidas, get().regras)
      ls.set(CHAVE_PROXIMO, String(n))
      set({ proximoConvite: n })
    },

    async cadastrar(d) {
      const corpo: Record<string, unknown> = { acao: 'cadastrar', apelido: d.apelido.trim(), email: d.email.trim(), senha: d.senha, aceite: true }
      const vid = visitanteAtual()
      if (vid) corpo.vid = vid
      const origem = origemAtual()
      if (origem) corpo.origem = origem
      if (d.timeCoracao?.trim()) corpo.timeCoracao = d.timeCoracao.trim().slice(0, 40)
      if (d.uf) corpo.uf = d.uf
      const u = comUsuario(await api('conta.php', { corpo }))
      logou(u, 'cadastro')
      return u
    },

    async entrar(email, senha) {
      const corpo: Record<string, unknown> = { acao: 'entrar', email: email.trim(), senha }
      const vid = visitanteAtual()
      if (vid) corpo.vid = vid
      const u = comUsuario(await api('conta.php', { corpo }))
      logou(u, 'login')
      return u
    },

    async sair() {
      try {
        await api('conta.php', { corpo: { acao: 'sair' } })
      } finally {
        // mesmo sem resposta: neste aparelho a conta sai (o cookie some quando o servidor responder);
        // e o convite não volta na mesma hora para quem acabou de sair
        lembrar(null)
        set({ usuario: null, lembrado: null })
        get().adiarConvite()
      }
    },

    sessaoExpirou() {
      if (!get().usuario && !get().lembrado) return
      lembrar(null)
      set({ usuario: null, lembrado: null })
    },

    async esqueci(email) {
      await api('conta.php', { corpo: { acao: 'esqueci', email: email.trim() } })
    },

    async redefinir(email, codigo, senha) {
      const u = comUsuario(await api('conta.php', { corpo: { acao: 'redefinir', email: email.trim(), codigo: codigo.trim(), senha } }))
      logou(u, 'redefinir')
      return u
    },

    async perfil(p) {
      const corpo: Record<string, unknown> = { acao: 'perfil' }
      if (p.apelido !== undefined) corpo.apelido = p.apelido.trim()
      if (p.timeCoracao !== undefined) corpo.timeCoracao = p.timeCoracao.trim().slice(0, 40)
      if (p.uf !== undefined) corpo.uf = p.uf
      const u = comUsuario(await api('conta.php', { corpo }))
      lembrar(u)
      set({ usuario: u, lembrado: u.apelido })
      return u
    },

    async excluir(senha) {
      await api('conta.php', { corpo: { acao: 'excluir', senha } })
      lembrar(null)
      set({ usuario: null, lembrado: null })
      get().adiarConvite()
    },
  }
})

/** Logado de verdade (o servidor confirmou) ou, sem servidor, lembrado neste aparelho. */
export const selectTemConta = (s: Pick<ContaStore, 'usuario' | 'lembrado'>) => !!s.usuario || !!s.lembrado
