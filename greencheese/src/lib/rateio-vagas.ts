// A parte do contrato do rateio que só as telas usam (baixa com elas): o rateio avulso, entrar e minhas vagas.
// Mesmas regras de src/lib/rateio-api.ts: leitura em 8 s, entrada em 20 s, nada trava a tela, o que vem da rede é
// conferido.
import { chamar, data, falha, inteiro, lerRateio, numero, STATUS_RATEIO, texto, type Bruto, type Participacao, type Rateio, type RespostaRateio, type StatusVaga } from './rateio-api'

const STATUS_VAGA: readonly StatusVaga[] = ['reservado', 'confirmado', 'expirado', 'cancelado', 'entregue']

/** Participação conferida. Nas "minhas vagas" o token pode vir vazio (o servidor só guarda o hash): aí vale o código. */
export function lerParticipacao(x: unknown, exigirToken = true): Participacao | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Bruto
  const codigo = texto(p.codigo, 20)
  const token = texto(p.token, 64) ?? (exigirToken ? null : '')
  const rateio = texto(p.rateio, 80)
  const status = STATUS_VAGA.find((s) => s === p.status)
  const rateioStatus = [...STATUS_RATEIO, 'cancelado' as const].find((s) => s === p.rateioStatus)
  const quantidade = inteiro(p.quantidade, 1)
  if (!codigo || !/^RAT-[0-9A-Z]{4}$/.test(codigo) || token == null || (token !== '' && !/^[0-9a-f]{32}$/i.test(token)) || (exigirToken && !token) || !rateio || !status || !rateioStatus || quantidade == null) return null
  return {
    codigo,
    token: token.toLowerCase(),
    rateio,
    titulo: texto(p.titulo, 120) ?? '',
    quantidade,
    total: numero(p.total) ?? 0,
    status,
    expiraEm: data(p.expiraEm),
    criadoEm: data(p.criadoEm) ?? new Date().toISOString(),
    confirmadoEm: data(p.confirmadoEm),
    rateioStatus,
  }
}

/** GET r=rateio&id= */
export async function buscarRateio(id: string): Promise<RespostaRateio<{ rateio: Rateio }>> {
  const r = await chamar(`rateio&id=${encodeURIComponent(id)}`)
  if (!r.ok) return r
  const rateio = lerRateio(r.dados.rateio)
  return rateio ? { ok: true, rateio } : falha('sem-servidor')
}

export interface PedidoEntrada {
  rateio: string
  nome: string
  /** Só dígitos (com ou sem 55). */
  whatsapp: string
  uf: string
  cidade?: string
  quantidade: number
  /** Armadilha para robô: vai do jeito que veio do campo escondido (gente deixa vazio). */
  site?: string
  /**
   * Token gerado no aparelho (32 hex), o mesmo em cada nova tentativa da mesma entrada. Servidor que segue o API.md
   * guarda o hash dele e, se o POST chegar de novo (a resposta se perdeu no 3G), devolve a mesma participação; e o
   * `minhas-vagas` com ele já acha a vaga. Servidor que ainda não aceita ignora o campo e gera o dele.
   */
  token?: string
}

/** Token novo do aparelho: 32 hex (128 bits), do gerador do navegador. */
export function novoToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** POST r=rateio-entrar */
export async function entrarNoRateio(p: PedidoEntrada): Promise<RespostaRateio<{ participacao: Participacao; rateio: Rateio | null }>> {
  const r = await chamar('rateio-entrar', p)
  if (!r.ok) return r
  const participacao = lerParticipacao(r.dados.participacao)
  if (!participacao) return falha('erro-interno')
  return { ok: true, participacao, rateio: lerRateio(r.dados.rateio) }
}

/** GET r=minhas-vagas&t=… (até 20 tokens; desconhecido é ignorado pelo servidor). */
export async function buscarMinhasVagas(tokens: string[]): Promise<RespostaRateio<{ participacoes: Participacao[] }>> {
  const lista = tokens.filter((t) => /^[0-9a-f]{32}$/i.test(t)).slice(0, 20)
  if (!lista.length) return { ok: true, participacoes: [] }
  const r = await chamar(`minhas-vagas&t=${lista.join(',')}`)
  if (!r.ok) return r
  if (!Array.isArray(r.dados.participacoes)) return falha('sem-servidor')
  return { ok: true, participacoes: r.dados.participacoes.map((x) => lerParticipacao(x, false)).filter((x): x is Participacao => !!x) }
}
