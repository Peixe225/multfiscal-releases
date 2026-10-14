/**
 * Ponte com a API do site (/lenda/api/*.php — servidor/CONTRATO.md), na mesma origem do jogo.
 * Só existe no build do site (VITE_SITE=1): tudo em src/site é carregado por import dinâmico atrás dessa flag.
 *
 *   const r = await api<{ usuario: Usuario | null }>('conta.php')
 *   await api('conta.php', { corpo: { acao: 'sair' } })        // POST JSON
 *   try { … } catch (e) { mensagemDeErro(e) }                   // texto pt-BR para mostrar
 */

/** Endereço de um arquivo da API, relativo à pasta do jogo (funciona em /lenda/ e em http://127.0.0.1:PORTA/lenda/). */
export function apiUrl(arquivo: string, query?: Record<string, string>): string {
  const base = (import.meta.env.BASE_URL || './').replace(/\/?$/, '/')
  const u = new URL(`${base}api/${arquivo}`, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/lenda/')
  if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  return u.href
}

/** Mensagens para quando o servidor não mandou uma (rede caiu, resposta estranha). */
const PADRAO: Record<string, string> = {
  rede: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
  tempo: 'O servidor demorou para responder. Tente de novo em instantes.',
  limite: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  origem: 'Pedido recusado pelo servidor. Recarregue a página e tente de novo.',
  nao_logado: 'Sua sessão expirou. Entre de novo na sua conta.',
  credenciais: 'E-mail ou senha incorretos.',
  email_invalido: 'Confira o e-mail.',
  apelido_invalido: 'O apelido precisa ter de 2 a 20 letras, números, espaço, _ . ou -.',
  senha_curta: 'A senha precisa ter pelo menos 6 caracteres.',
  aceite: 'Para criar a conta, aceite a Política de Privacidade.',
  email_em_uso: 'Já existe uma conta com esse e-mail. Use "Já tenho conta".',
  codigo: 'Código inválido ou vencido. Peça um novo.',
  cheio: 'Sua conta chegou ao limite de carreiras salvas. Apague alguma para salvar outra.',
  grande: 'Essa carreira é grande demais para salvar na conta.',
  nao_encontrada: 'Essa carreira não está mais na sua conta.',
  servidor: 'O servidor teve um problema. Tente de novo em instantes.',
}

export class ErroApi extends Error {
  readonly codigo: string
  readonly status: number
  constructor(codigo: string, status: number, mensagem?: string) {
    super(mensagem?.trim() || PADRAO[codigo] || PADRAO.servidor)
    this.name = 'ErroApi'
    this.codigo = codigo
    this.status = status
  }
}

/** Código de erro pelo status, quando o corpo não trouxe um. */
function codigoDoStatus(status: number): string {
  if (status === 401) return 'nao_logado'
  if (status === 404) return 'nao_encontrada'
  if (status === 409) return 'cheio'
  if (status === 413) return 'grande'
  if (status === 429) return 'limite'
  if (status === 403) return 'origem'
  return 'servidor'
}

export interface OpcoesApi {
  /** Com corpo, vai como POST JSON. */
  corpo?: unknown
  /** Corpo já em JSON (evita serializar duas vezes um objeto grande). */
  corpoJson?: string
  query?: Record<string, string>
  /** ms (padrão 15 s). */
  tempo?: number
}

export async function api<T = unknown>(arquivo: string, opts: OpcoesApi = {}): Promise<T> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.tempo ?? 15_000) : 0
  const body = opts.corpoJson ?? (opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo))
  let res: Response
  try {
    res = await fetch(apiUrl(arquivo, opts.query), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
      signal: ctrl?.signal,
    })
  } catch (err) {
    throw new ErroApi((err as Error)?.name === 'AbortError' ? 'tempo' : 'rede', 0)
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (res.status === 204) return null as T
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* sem corpo JSON (página de erro do servidor, PHP ausente) */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { erro?: unknown; mensagem?: unknown }
    throw new ErroApi(typeof j.erro === 'string' ? j.erro : codigoDoStatus(res.status), res.status, typeof j.mensagem === 'string' ? j.mensagem : undefined)
  }
  // 200 sem JSON = não é a nossa API (ex.: o servidor devolveu o index.html)
  if (json == null || typeof json !== 'object') throw new ErroApi('servidor', res.status)
  return json as T
}

/** Texto pt-BR para mostrar de qualquer erro (o do servidor vem como veio). */
export function mensagemDeErro(err: unknown): string {
  if (err instanceof ErroApi) return err.message
  return PADRAO.servidor
}

export const codigoDeErro = (err: unknown): string | null => (err instanceof ErroApi ? err.codigo : null)
