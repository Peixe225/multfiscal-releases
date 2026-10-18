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
 *
 * v3.2 (CONTRATO-v32 §A.7): U.tester (conta de testes: abre o Imersivo e a Live) e U.aviso (o recado da moderação,
 * mostrado uma vez em Minha conta → avisoLido()). A conta de testes e "há conta aberta" vão para o useAcesso.
 */
import { create } from 'zustand'
import { api, esperaReintento, valeTentar } from './api'
import { useAcesso } from '@/store/acesso'
import { aplicarSite } from './acesso'
import { conviteGuardado, esquecerConvite } from './indicacao'
import { armazem, enviarAgora, origemAtual, visitanteAtual, type Armazem } from './medicao'

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

/** Quais carreiras da conta vão para o Hall público: as 3 melhores sozinhas, as que o jogador marcou, ou nenhuma. */
export type ModoHallPublico = 'auto' | 'manual' | 'nao'

export interface Usuario {
  id: number
  apelido: string
  email: string
  criadoEm: string
  timeCoracao: string | null
  uf: string | null
  origem: string | null
  /** Padrão 'auto' (servidor/CONTRATO-v3.md §3–4). */
  hallPublico: ModoHallPublico
  /** Código do link de convite (…/lenda/?c=<código>), §8.2. */
  codigoConvite: string | null
  estatisticas: Estatisticas
  /** Conta de testes (v3.2, P1-6): abre o Imersivo e a Live com o selo "Teste". Servidor antigo = false. */
  tester: boolean
  /** Aviso da moderação para o dono (v3.2, H11): Minha conta mostra uma vez e manda "aviso_lido". */
  aviso: AvisoConta | null
  /**
   * E-mail confirmado com o código de 6 dígitos (v3.3, CONTRATO-v33). Requisito dos desafios. Servidor antigo (sem o
   * campo) = true: ninguém leva o aviso de "confirme o e-mail" de um servidor que nem manda o código.
   */
  emailVerificado: boolean
}

export interface AvisoConta {
  texto: string
  em: string | null
  /**
   * v3.3: 'desafio' = o recado de quem venceu um desafio ("Parabéns! Você venceu o desafio “…”"), mostrado como vitória;
   * 'moderacao' = o aviso da moderação de sempre (v3.2). Servidor sem o campo: decide pelo começo do texto.
   */
  tipo: 'moderacao' | 'desafio'
}

/** Começo do recado do vencedor (o mesmo LENDA_AVISO_VENCEDOR do servidor). */
const AVISO_VENCEDOR = 'Parabéns! Você venceu o desafio'

/** O U.aviso do servidor, conferido (texto curto, só texto). */
export function normalizarAvisoConta(x: unknown): AvisoConta | null {
  const a = x as { texto?: unknown; em?: unknown; tipo?: unknown } | null
  if (!a || typeof a !== 'object' || typeof a.texto !== 'string') return null
  const texto = a.texto.trim().slice(0, 300)
  if (!texto) return null
  const tipo = a.tipo === 'desafio' || (a.tipo !== 'moderacao' && texto.startsWith(AVISO_VENCEDOR)) ? 'desafio' : 'moderacao'
  return { texto, em: typeof a.em === 'string' ? a.em : null, tipo }
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
    hallPublico: u.hallPublico === 'manual' || u.hallPublico === 'nao' ? u.hallPublico : 'auto',
    codigoConvite: typeof u.codigoConvite === 'string' && /^[A-Za-z0-9]{4,16}$/.test(u.codigoConvite) ? u.codigoConvite : null,
    tester: u.tester === true,
    aviso: normalizarAvisoConta(u.aviso),
    emailVerificado: u.emailVerificado !== false,
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
  perfil(p: { apelido?: string; timeCoracao?: string; uf?: string; hallPublico?: ModoHallPublico }): Promise<Usuario>
  excluir(senha: string): Promise<void>
  /** O jogador viu o aviso da moderação (H11): some daqui na hora e do servidor quando ele responder. */
  avisoLido(): Promise<void>
  /** v3.3: confirma o e-mail com o código de 6 dígitos (lança ErroApi codigo_invalido / limite). */
  verificarEmail(codigo: string): Promise<Usuario>
  /** v3.3: manda outro código (3 a cada 10 min, 10 por dia). `true` = já estava confirmado (a conta é relida). */
  reenviarVerificacao(): Promise<boolean>
}

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

/** Quem quiser saber de cada login/cadastro (ex.: subir as carreiras e as conquistas do aparelho). */
type AoEntrar = (u: Usuario, como: 'cadastro' | 'login' | 'redefinir' | 'sessao') => void
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

/** O GET conta.php falhou (servidor lento, sem rede) e este aparelho já entrou antes: tenta de novo sozinho. */
let tentativaCarregar = 0
let timerCarregar: ReturnType<typeof setTimeout> | 0 = 0

export const useConta = create<ContaStore>()((set, get) => {
  const enviarPartidas = (n: number) => {
    if (!get().usuario || n <= 0) return
    void api('conta.php', { corpo: { acao: 'partidas', n } }).catch(() => {})
  }
  const avisar = (u: Usuario, como: 'cadastro' | 'login' | 'redefinir' | 'sessao') => {
    for (const fn of ouvintes) {
      try {
        fn(u, como)
      } catch (err) {
        console.warn('[LENDA] pós-login falhou', err)
      }
    }
  }
  const logou = (u: Usuario, como: 'cadastro' | 'login' | 'redefinir') => {
    if (como === 'cadastro') esquecerConvite(ls)
    lembrar(u)
    set({ usuario: u, lembrado: u.apelido })
    if (get().partidas > u.estatisticas.partidas) enviarPartidas(get().partidas)
    avisar(u, como)
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
        // o que é público e o que é só do admin (Live, Imersivo, avisos, manutenção, cadastro, bônus) vem no `site`
        const r = await api<{ usuario: unknown; regras: unknown; site?: unknown }>('conta.php', { tempo: 8000 })
        const antes = get().usuario
        const u = normalizarUsuario(r.usuario)
        // a conta de testes antes da config: a rota fechada que ela pode abrir não pisca "não encontrada"
        sincronizarAcesso(u)
        aplicarSite(r.site ?? {})
        lembrar(u)
        set({ usuario: u, lembrado: u?.apelido ?? null, regras: normalizarRegras(r.regras), status: 'pronto' })
        if (u && get().partidas > u.estatisticas.partidas) enviarPartidas(get().partidas)
        tentativaCarregar = 0
        // já estava logado ao abrir (cookie de antes), entrou em outra aba ou a conta só respondeu agora: quem
        // sincroniza (carreiras na fila, conquistas, bônus) fica sabendo
        if (u && antes?.id !== u.id) avisar(u, 'sessao')
      } catch (err) {
        // sem servidor: regras padrão e o que é só do admin fechado; quem já entrou neste aparelho segue
        // "lembrado" (sem convite)
        if (!useAcesso.getState().configPronta) aplicarSite(null)
        set({ regras: REGRAS_PADRAO, status: 'pronto' })
        // quem já entrou neste aparelho pergunta de novo, com espera crescente (2 s, 4 s, 8 s… até 2 min, 6 vezes):
        // sem isso a sessão inteira seguiria "sem conta" (nada salvo sozinho, conquistas e bônus parados)
        if (valeTentar(err) && get().lembrado && !get().usuario && tentativaCarregar < 6 && typeof window !== 'undefined') {
          if (timerCarregar) clearTimeout(timerCarregar)
          timerCarregar = setTimeout(() => {
            timerCarregar = 0
            if (!get().usuario) void get().carregar()
          }, esperaReintento(tentativaCarregar++, 2000, 120_000))
        }
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
      // quem indicou (link ?c= dos últimos 30 dias): o servidor confere e valida depois da 1ª partida
      const convite = conviteGuardado(ls)
      if (convite) corpo.convite = convite
      // a partida que abriu o convite (ainda na fila da medição) vai antes, como do visitante: não conta como
      // partida "com a conta" para liberar os bônus (CONTRATO-v3 §6)
      await enviarAgora()
      const u = comUsuario(await api('conta.php', { corpo }))
      logou(u, 'cadastro')
      return u
    },

    async entrar(email, senha) {
      const corpo: Record<string, unknown> = { acao: 'entrar', email: email.trim(), senha }
      const vid = visitanteAtual()
      if (vid) corpo.vid = vid
      await enviarAgora()
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
      await enviarAgora()
      const u = comUsuario(await api('conta.php', { corpo: { acao: 'redefinir', email: email.trim(), codigo: codigo.trim(), senha } }))
      logou(u, 'redefinir')
      return u
    },

    async perfil(p) {
      const corpo: Record<string, unknown> = { acao: 'perfil' }
      if (p.apelido !== undefined) corpo.apelido = p.apelido.trim()
      if (p.timeCoracao !== undefined) corpo.timeCoracao = p.timeCoracao.trim().slice(0, 40)
      if (p.uf !== undefined) corpo.uf = p.uf
      if (p.hallPublico !== undefined) corpo.hallPublico = p.hallPublico
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

    async verificarEmail(codigo) {
      const u = comUsuario(await api('conta.php', { corpo: { acao: 'verificar_email', codigo: codigo.replace(/\D/g, '').slice(0, 6) } }))
      lembrar(u)
      // o servidor antigo não manda o campo: quem acabou de confirmar está confirmado
      const certo = { ...u, emailVerificado: true }
      set({ usuario: certo, lembrado: u.apelido })
      return certo
    },

    async reenviarVerificacao() {
      const r = await api<{ ok?: unknown; jaVerificado?: unknown }>('conta.php', { corpo: { acao: 'reenviar_verificacao' } })
      if (r?.jaVerificado === true) {
        const u = get().usuario
        if (u && !u.emailVerificado) set({ usuario: { ...u, emailVerificado: true } })
        return true
      }
      return false
    },

    async avisoLido() {
      const u = get().usuario
      if (!u?.aviso) return
      set({ usuario: { ...u, aviso: null } })
      try {
        await api('conta.php', { corpo: { acao: 'aviso_lido' } })
      } catch {
        // sem rede (ou servidor antigo): o aviso volta na próxima abertura da conta, e só isso
      }
    },
  }
})

/** A conta de testes e "há conta aberta" vão para o store de acesso (menu, rotas, avisos por público). */
function sincronizarAcesso(u: Usuario | null) {
  const tester = !!u?.tester
  const logado = !!u
  const a = useAcesso.getState()
  if (a.tester !== tester || a.logado !== logado) useAcesso.setState({ tester, logado })
}
useConta.subscribe((s, p) => {
  if (s.usuario !== p.usuario) sincronizarAcesso(s.usuario)
})

/** Logado de verdade (o servidor confirmou) ou, sem servidor, lembrado neste aparelho. */
export const selectTemConta = (s: Pick<ContaStore, 'usuario' | 'lembrado'>) => !!s.usuario || !!s.lembrado
