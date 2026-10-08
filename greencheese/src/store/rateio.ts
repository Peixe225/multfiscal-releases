import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { config } from '../dados/config'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { buscarRateios, lerRateio, type Participacao, type Rateio } from '../lib/rateio-api'

// Rateios: a lista pública (memória, vem do servidor ou dos exemplos) e as vagas DESTE aparelho (localStorage
// 'gc-rateio': o token de cada participação, que é o que deixa ver "Minhas vagas", e o que a pessoa preencheu para a
// mensagem do WhatsApp poder ser montada de novo). Fica no pedaço principal porque a barra, a lateral e o destaque do
// Início mostram quantos rateios estão abertos; as telas do rateio baixam à parte.

/** De onde vieram os rateios: ainda nada, buscando, do servidor da loja ou dos exemplos (servidor fora do ar). */
export type FonteRateios = 'nada' | 'carregando' | 'servidor' | 'sem-servidor'

/** Participação deste aparelho: o que o servidor devolveu + o que a pessoa preencheu (a mensagem do WhatsApp). */
export interface VagaGuardada extends Participacao {
  nome: string
  /** '55' + DDD + 9 dígitos */
  whatsapp: string
  uf: string
  cidade: string | null
  precoRateio: number
}

interface EstadoRateio {
  rateios: Rateio[]
  fonte: FonteRateios
  /** Quando a lista chegou (relógio do aparelho). */
  carregadoEm: number
  /** Hora do servidor menos a do aparelho, em ms (a reserva vence pela hora do servidor). */
  desvio: number
  vagas: VagaGuardada[]
  /** Rateios abertos que este aparelho já viu na aba (o selo "novo" do destaque some). */
  vistos: string[]
}

const MAX_VAGAS = 20
const VALIDADE_LISTA = 60_000

export const useRateio = create<EstadoRateio>()(
  persist(
    (): EstadoRateio => ({ rateios: [], fonte: 'nada', carregadoEm: 0, desvio: 0, vagas: [], vistos: [] }),
    {
      name: 'gc-rateio',
      storage: createJSONStorage(() => armazenamentoSeguro),
      // só o que é do aparelho; a lista volta do servidor a cada visita
      partialize: (s) => ({ vagas: s.vagas, vistos: s.vistos }) as unknown as EstadoRateio,
      merge: (guardado, atual) => {
        const g = (guardado ?? {}) as Partial<EstadoRateio>
        return {
          ...atual,
          vagas: Array.isArray(g.vagas) ? g.vagas.filter((v) => v && typeof v.codigo === 'string' && typeof v.rateio === 'string') : [],
          vistos: Array.isArray(g.vistos) ? g.vistos.filter((v) => typeof v === 'string').slice(-50) : [],
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

/**
 * Busca a lista (no máximo uma vez por minuto, a não ser que `forcar`). Sem servidor: os exemplos de
 * src/dados/rateios-exemplo.json (se dadosDeExemplo), sem erro na tela.
 */
export function carregarRateios(forcar = false): Promise<void> {
  if (buscando) return buscando
  const s = useRateio.getState()
  if (!forcar && s.fonte !== 'nada' && s.fonte !== 'carregando' && Date.now() - s.carregadoEm < VALIDADE_LISTA) return Promise.resolve()
  if (s.fonte === 'nada') useRateio.setState({ fonte: 'carregando' })
  buscando = (async () => {
    const r = await buscarRateios()
    if (r.ok) {
      const desvio = r.agora ? Date.parse(r.agora) - Date.now() : 0
      useRateio.setState({ rateios: r.rateios.filter(valeNaTela), fonte: 'servidor', carregadoEm: Date.now(), desvio: Math.abs(desvio) > 90_000 ? desvio : 0 })
      return
    }
    // servidor fora do ar: já tinha lista do servidor nesta visita? fica com ela (o próximo minuto tenta de novo)
    if (useRateio.getState().fonte === 'servidor') {
      useRateio.setState({ carregadoEm: Date.now() })
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
    buscando = null
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
function aparar(vagas: VagaGuardada[]): VagaGuardada[] {
  if (vagas.length <= MAX_VAGAS) return vagas
  const ordem = [...vagas].sort((a, b) => Number(ATIVAS.has(b.status)) - Number(ATIVAS.has(a.status)) || Date.parse(b.criadoEm) - Date.parse(a.criadoEm))
  const ficam = new Set(ordem.slice(0, MAX_VAGAS))
  return vagas.filter((v) => ficam.has(v))
}

/** Guarda a participação que acabou de nascer neste aparelho (a mais nova primeiro). */
export function guardarVaga(v: VagaGuardada) {
  useRateio.setState((s) => ({ vagas: aparar([v, ...s.vagas.filter((x) => x.codigo !== v.codigo)]) }))
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

/** Aberto, aceitando entrada e valendo no estado: o que conta no selo da barra e acende o destaque. */
export function abertoParaEntrar(r: Rateio, uf: string | null): boolean {
  return r.status === 'aberto' && r.aceitaEntradas && valeNoEstado(r, uf)
}

/** Quantos rateios dá pra entrar agora, no estado de quem vê. */
export function useQuantosAbertos(uf: string | null): number {
  return useRateio((s) => s.rateios.filter((r) => abertoParaEntrar(r, uf)).length)
}

/** Tem rateio aberto que este aparelho ainda não viu na aba (selo "novo"). */
export function useRateioNovo(uf: string | null): boolean {
  return useRateio((s) => s.rateios.some((r) => abertoParaEntrar(r, uf) && !s.vistos.includes(r.id)))
}
