import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { config } from '../dados/config'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { buscarRateios, ESPERA_LISTA_MS, lerRateio, type Participacao, type Rateio } from '../lib/rateio-api'

// Rateios: a lista pública (memória, vem do servidor ou dos exemplos) e as vagas DESTE aparelho (localStorage
// 'gc-rateio': o token de cada participação, que é o que deixa ver "Minhas vagas", e o que a pessoa preencheu para a
// mensagem do WhatsApp poder ser montada de novo). Fica no pedaço principal porque a barra, a lateral e o destaque do
// Início mostram quantos rateios estão abertos; as telas do rateio baixam à parte.

/**
 * De onde vieram os rateios: ainda nada, buscando, do servidor da loja, dos exemplos (aqui não tem servidor: o arquivo
 * único, o zip sem api/) ou de lugar nenhum (o servidor existe e não respondeu em ~4 s: "Sem conexão com a loja agora"
 * com o caminho pelo WhatsApp, nunca os exemplos no lugar dos rateios de verdade).
 */
export type FonteRateios = 'nada' | 'carregando' | 'servidor' | 'sem-servidor' | 'fora-do-ar'

/** Participação deste aparelho: o que o servidor devolveu + o que a pessoa preencheu (a mensagem do WhatsApp). */
export interface VagaGuardada extends Participacao {
  nome: string
  /** '55' + DDD + 9 dígitos */
  whatsapp: string
  uf: string
  cidade: string | null
  precoRateio: number
  /**
   * Vaga feita pelo "Entrar com outro WhatsApp" (pra um amigo): não preenche o formulário dos próximos rateios nem
   * aparece como "Tua vaga" quando o dono do aparelho também tem a dele.
   */
  paraOutro?: boolean
}

/**
 * Entrada que saiu deste aparelho e ainda não teve resposta (o POST demorou, a rede caiu): o token que foi junto e o
 * que a pessoa preencheu. Nova tentativa da mesma pessoa no mesmo rateio vai com o MESMO token; e "Minhas vagas"
 * pergunta por ele, então a vaga aparece aqui se o servidor gravou (ver API.md, `token` no rateio-entrar).
 */
export interface EntradaPendente {
  token: string
  rateio: string
  titulo: string
  nome: string
  /** '55' + DDD + 9 dígitos */
  whatsapp: string
  uf: string
  cidade: string | null
  quantidade: number
  precoRateio: number
  /** ms (relógio do aparelho) */
  criadoEm: number
  /** Uma tentativa já ficou sem resposta (tempo esgotado, rede caída): um ja-participa depois provavelmente é dela. */
  semResposta?: boolean
  /** Feita pelo "Entrar com outro WhatsApp" (ver VagaGuardada). */
  paraOutro?: boolean
}

interface EstadoRateio {
  rateios: Rateio[]
  fonte: FonteRateios
  /** Tem uma busca da lista no caminho (o "Sem conexão" diz "Tentando falar com a loja…" enquanto isso). */
  buscandoLista: boolean
  /** Quando a lista chegou (relógio do aparelho). */
  carregadoEm: number
  /** Hora do servidor menos a do aparelho, em ms (a reserva vence pela hora do servidor). */
  desvio: number
  vagas: VagaGuardada[]
  /** Rateios abertos que este aparelho já viu na aba (o selo "novo" do destaque some). */
  vistos: string[]
  /** Entradas sem resposta (ver EntradaPendente). */
  pendentes: EntradaPendente[]
  /** Este aparelho já recebeu resposta do servidor da loja: daí em diante, 404/HTML é servidor fora do ar, não "sem servidor". */
  servidorVisto: boolean
}

const MAX_VAGAS = 20
const VALIDADE_LISTA = 60_000
/** Pendente vale até a maior reserva possível (168 h) e mais um dia; no máximo 5. */
const VIDA_PENDENTE = 8 * 86_400_000
const MAX_PENDENTES = 5

const pendenteValida = (p: unknown): p is EntradaPendente => {
  const x = p as EntradaPendente | null
  return !!x && typeof x.token === 'string' && /^[0-9a-f]{32}$/.test(x.token) && typeof x.rateio === 'string' && typeof x.whatsapp === 'string' && typeof x.criadoEm === 'number' && Date.now() - x.criadoEm < VIDA_PENDENTE
}

export const useRateio = create<EstadoRateio>()(
  persist(
    (): EstadoRateio => ({ rateios: [], fonte: 'nada', buscandoLista: false, carregadoEm: 0, desvio: 0, vagas: [], vistos: [], pendentes: [], servidorVisto: false }),
    {
      name: 'gc-rateio',
      storage: createJSONStorage(() => armazenamentoSeguro),
      // só o que é do aparelho; a lista volta do servidor a cada visita
      partialize: (s) => ({ vagas: s.vagas, vistos: s.vistos, pendentes: s.pendentes, servidorVisto: s.servidorVisto }) as unknown as EstadoRateio,
      merge: (guardado, atual) => {
        const g = (guardado ?? {}) as Partial<EstadoRateio>
        return {
          ...atual,
          vagas: Array.isArray(g.vagas) ? g.vagas.filter((v) => v && typeof v.codigo === 'string' && typeof v.rateio === 'string') : [],
          vistos: Array.isArray(g.vistos) ? g.vistos.filter((v) => typeof v === 'string').slice(-50) : [],
          pendentes: Array.isArray(g.pendentes) ? g.pendentes.filter(pendenteValida).slice(0, MAX_PENDENTES) : [],
          servidorVisto: g.servidorVisto === true || atual.servidorVisto,
        }
      },
    },
  ),
)

// outra aba entrou num rateio: relê as vagas
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'gc-rateio') void useRateio.persist.rehydrate()
  })
}

/** Rateio de exemplo só enquanto a loja não tem os dela (config.dadosDeExemplo). */
const valeNaTela = (r: Rateio) => !r.demo || config.dadosDeExemplo

/** Agora pela hora do servidor (o relógio do aparelho pode estar errado). */
export function agoraRateio(): number {
  return Date.now() + useRateio.getState().desvio
}

let buscando: Promise<void> | null = null

/** Respondeu a API da loja (qualquer resposta em JSON dela, até erro): lembra que este site tem servidor. */
export function marcarServidorVisto() {
  if (!useRateio.getState().servidorVisto) useRateio.setState({ servidorVisto: true })
}

/**
 * Busca a lista (no máximo uma vez por minuto, a não ser que `forcar`). Sem servidor aqui (o arquivo único, o zip sem
 * api/): os exemplos de src/dados/rateios-exemplo.json (se dadosDeExemplo), sem erro na tela. Servidor que não
 * respondeu (lento, fora do ar): fica com a lista que já tinha nesta visita; sem nenhuma, 'fora-do-ar' (a aba diz "Sem
 * conexão com a loja agora", com "Entrar pelo WhatsApp", e tenta de novo). A aba não espera mais que ~4 s pra isso
 * (ESPERA_LISTA_MS): a busca continua até o limite de leitura e, se a lista chegar, entra no lugar do aviso. Um
 * aparelho que já falou com o servidor nunca cai nos exemplos.
 */
export function carregarRateios(forcar = false): Promise<void> {
  if (buscando) return buscando
  const s = useRateio.getState()
  if (!forcar && s.fonte !== 'nada' && s.fonte !== 'carregando' && Date.now() - s.carregadoEm < VALIDADE_LISTA) return Promise.resolve()
  useRateio.setState(s.fonte === 'nada' ? { fonte: 'carregando', buscandoLista: true } : { buscandoLista: true })
  // sem lista nenhuma e sem resposta em ~4 s: a aba já mostra o aviso com o WhatsApp (a busca segue)
  const espera = setTimeout(() => {
    if (useRateio.getState().fonte === 'carregando') useRateio.setState({ fonte: 'fora-do-ar' })
  }, ESPERA_LISTA_MS)
  buscando = (async () => {
    const r = await buscarRateios()
    if (r.ok) {
      const desvio = r.agora ? Date.parse(r.agora) - Date.now() : 0
      useRateio.setState({ rateios: r.rateios.filter(valeNaTela), fonte: 'servidor', carregadoEm: Date.now(), desvio: Math.abs(desvio) > 90_000 ? desvio : 0, servidorVisto: true })
      return
    }
    const agora = useRateio.getState()
    // erro da própria API (ex.: muitas-tentativas): o servidor existe
    if (r.erro !== 'sem-servidor' && r.erro !== 'fora-do-ar') marcarServidorVisto()
    // já tinha lista do servidor nesta visita? fica com ela (o próximo minuto tenta de novo)
    if (agora.fonte === 'servidor') {
      useRateio.setState({ carregadoEm: Date.now() })
      return
    }
    const semServidorAqui = r.erro === 'sem-servidor' && !agora.servidorVisto && !agora.vagas.some((v) => v.token)
    if (!semServidorAqui) {
      useRateio.setState({ rateios: [], fonte: 'fora-do-ar', carregadoEm: Date.now() })
      return
    }
    let exemplos: Rateio[] = []
    if (config.dadosDeExemplo) {
      try {
        const m = await import('../dados/rateios-exemplo.json')
        exemplos = (m.default.rateios as unknown[]).map(lerRateio).filter((x): x is Rateio => !!x)
      } catch {
        exemplos = []
      }
    }
    useRateio.setState({ rateios: exemplos.filter(valeNaTela), fonte: 'sem-servidor', carregadoEm: Date.now(), desvio: 0 })
  })().finally(() => {
    clearTimeout(espera)
    buscando = null
    useRateio.setState({ buscandoLista: false })
  })
  return buscando
}

/** Troca um rateio da lista pelo que acabou de chegar (o contador novo depois de entrar). */
export function trocarRateio(r: Rateio) {
  if (!valeNaTela(r)) return
  useRateio.setState((s) => ({ rateios: s.rateios.some((x) => x.id === r.id) ? s.rateios.map((x) => (x.id === r.id ? r : x)) : [...s.rateios, r] }))
}

const ATIVAS = new Set(['reservado', 'confirmado'])

/** No máximo 20 (o limite da API): as ativas primeiro, depois as mais novas. */
export function apararVagas(vagas: VagaGuardada[]): VagaGuardada[] {
  if (vagas.length <= MAX_VAGAS) return vagas
  const ordem = [...vagas].sort((a, b) => Number(ATIVAS.has(b.status)) - Number(ATIVAS.has(a.status)) || Date.parse(b.criadoEm) - Date.parse(a.criadoEm))
  const ficam = new Set(ordem.slice(0, MAX_VAGAS))
  return vagas.filter((v) => ficam.has(v))
}

/** WhatsApp ('55…') do dono do aparelho: o da conta do Teste minha sorte, senão o da vaga mais nova que não foi pra um amigo. */
export function zapDoDono(vagas: VagaGuardada[], contaWhatsapp?: string | null): string | null {
  // a conta guarda '55' + DDD + 9 dígitos (lib/telefone); aceita também sem o 55, sem puxar a lib pra 1ª tela
  const d = contaWhatsapp?.replace(/\D/g, '') ?? ''
  const conta = d.length === 13 && d.startsWith('55') ? d : d.length === 11 ? `55${d}` : null
  return conta ?? vagas.find((v) => !v.paraOutro)?.whatsapp ?? null
}

/** Guarda a participação que acabou de nascer neste aparelho (a mais nova primeiro); a entrada pendente dela sai. */
export function guardarVaga(v: VagaGuardada) {
  useRateio.setState((s) => ({
    vagas: apararVagas([v, ...s.vagas.filter((x) => x.codigo !== v.codigo)]),
    pendentes: s.pendentes.filter((p) => !(p.rateio === v.rateio && p.whatsapp === v.whatsapp)),
    servidorVisto: true,
  }))
}

/** A entrada sem resposta desta pessoa (WhatsApp '55…') nesse rateio, se tiver. */
export function pendenteDe(rateio: string, whatsapp: string): EntradaPendente | null {
  return useRateio.getState().pendentes.find((p) => p.rateio === rateio && p.whatsapp === whatsapp && pendenteValida(p)) ?? null
}

/** Guarda (ou atualiza) a entrada que vai sair agora, ANTES do POST: se a resposta se perder, o token fica. */
export function guardarPendente(p: EntradaPendente) {
  useRateio.setState((s) => ({ pendentes: [p, ...s.pendentes.filter((x) => x.token !== p.token && !(x.rateio === p.rateio && x.whatsapp === p.whatsapp))].filter(pendenteValida).slice(0, MAX_PENDENTES) }))
}

export function tirarPendente(token: string) {
  useRateio.setState((s) => ({ pendentes: s.pendentes.filter((p) => p.token !== token) }))
}

/** Marca os rateios abertos como vistos (o selo "novo" do destaque some). */
export function marcarRateiosVistos(ids: string[]) {
  const vistos = useRateio.getState().vistos
  const novos = ids.filter((id) => !vistos.includes(id))
  if (novos.length) useRateio.setState({ vistos: [...vistos, ...novos].slice(-50) })
}

/* ───────────────────────── leituras para as entradas (barra, lateral, destaque) ───────────────────────── */

/** O rateio aceita gente desse estado? (sem estado escolhido, vale) */
export function valeNoEstado(r: Rateio, uf: string | null): boolean {
  return !uf || r.ufs.includes(uf)
}

/**
 * Aberto, aceitando entrada (e o prazo não venceu desde que a lista chegou) e valendo no estado: o que conta no selo
 * da barra, no "Abertos" da aba e acende o destaque.
 */
export function abertoParaEntrar(r: Rateio, uf: string | null): boolean {
  return r.status === 'aberto' && r.aceitaEntradas && !(r.fechaEm && Date.parse(r.fechaEm) <= agoraRateio()) && valeNoEstado(r, uf)
}

/** Quantos rateios dá pra entrar agora, no estado de quem vê. */
export function useQuantosAbertos(uf: string | null): number {
  return useRateio((s) => s.rateios.filter((r) => abertoParaEntrar(r, uf)).length)
}

/** Tem rateio aberto que este aparelho ainda não viu na aba (selo "novo"). */
export function useRateioNovo(uf: string | null): boolean {
  return useRateio((s) => s.rateios.some((r) => abertoParaEntrar(r, uf) && !s.vistos.includes(r.id)))
}
