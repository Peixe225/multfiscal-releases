/**
 * Perfil público de um jogador (GET /lenda/api/perfil.php?c=<código> — servidor/CONTRATO-v33.md): apelido, desde
 * quando joga, quantas conquistas, as até 3 carreiras dele no Hall público e os desafios que venceu. A rota do jogo é
 * #/jogador/<código> (o mesmo código do convite).
 *
 *   await usePerfis.getState().abrir('ABCD2345')
 *   const p = usePerfis((s) => s.perfis['ABCD2345'])   // { status: 'pronto', perfil } | { status: 'erro', naoEncontrado }
 */
import { create } from 'zustand'
import type { CarreiraComunidade } from '@/store/comunidade'
import { api, comReintento, ErroApi } from './api'
import { normalizarCarreiraPublica } from './hallPublico'
import { codigoValido } from './indicacao'
import { normalizarEmblemas, ordenarEmblemas, type Emblema } from './emblemas'

export interface PerfilPublico {
  codigo: string
  apelido: string
  desde: string | null
  conquistas: number
  carreiras: CarreiraComunidade[]
  desafiosVencidos: string[]
  /** v3.4: os emblemas dos desafios (os mais difíceis primeiro) e quantas conquistas estão provadas (null = não disse). */
  emblemas: Emblema[]
  conquistasProvadas: number | null
}

export type PerfilAberto = { status: 'carregando' } | { status: 'pronto'; perfil: PerfilPublico; em: number } | { status: 'erro'; naoEncontrado: boolean; semRede: boolean }

/** Um perfil guardado vale isto (o servidor manda max-age=120). */
export const VALIDADE_MS = 2 * 60_000
const GUARDADOS_MAX = 10

export function normalizarPerfil(x: unknown, codigo: string): PerfilPublico | null {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || typeof p.apelido !== 'string' || !p.apelido) return null
  const desde = typeof p.desde === 'string' && Number.isFinite(Date.parse(p.desde)) ? p.desde : null
  return {
    codigo: typeof p.codigo === 'string' && codigoValido(p.codigo) ? p.codigo : codigo,
    apelido: p.apelido.slice(0, 20),
    desde,
    conquistas: typeof p.conquistas === 'number' && Number.isFinite(p.conquistas) ? Math.max(0, Math.round(p.conquistas)) : 0,
    carreiras: (Array.isArray(p.carreiras) ? p.carreiras : [])
      .map(normalizarCarreiraPublica)
      .filter((c): c is CarreiraComunidade => !!c)
      .slice(0, 3),
    desafiosVencidos: (Array.isArray(p.desafiosVencidos) ? p.desafiosVencidos : []).filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s)).slice(0, 20),
    emblemas: ordenarEmblemas(normalizarEmblemas(p.emblemas)),
    conquistasProvadas: typeof p.conquistasProvadas === 'number' && Number.isFinite(p.conquistasProvadas) ? Math.max(0, Math.round(p.conquistasProvadas)) : null,
  }
}

interface PerfisStore {
  perfis: Record<string, PerfilAberto>
  abrir(codigo: string, forcar?: boolean): Promise<void>
}

export const usePerfis = create<PerfisStore>()((set, get) => ({
  perfis: {},
  async abrir(codigo, forcar = false) {
    if (!codigoValido(codigo)) {
      set((s) => ({ perfis: { ...s.perfis, [codigo]: { status: 'erro', naoEncontrado: true, semRede: false } } }))
      return
    }
    const ja = get().perfis[codigo]
    if (ja?.status === 'carregando') return
    if (!forcar && ja?.status === 'pronto' && Date.now() - ja.em < VALIDADE_MS) return
    const guardar = (v: PerfilAberto) =>
      set((s) => {
        const { [codigo]: _, ...resto } = s.perfis
        const ids = Object.keys(resto)
        for (const velho of ids.slice(0, Math.max(0, ids.length - (GUARDADOS_MAX - 1)))) delete resto[velho]
        return { perfis: { ...resto, [codigo]: v } }
      })
    // a página que já estava na tela fica enquanto a nova não chega
    if (ja?.status !== 'pronto') guardar({ status: 'carregando' })
    try {
      const r = await comReintento(() => api('perfil.php', { query: { c: codigo }, cache: forcar ? 'no-cache' : 'default', tempo: 12_000 }), { tentativas: 2 })
      const perfil = normalizarPerfil(r, codigo)
      if (!perfil) throw new ErroApi('servidor', 200, 'O perfil veio incompleto do servidor.')
      guardar({ status: 'pronto', perfil, em: Date.now() })
    } catch (err) {
      const e = err instanceof ErroApi ? err : null
      if (ja?.status === 'pronto' && e?.status !== 404) return
      guardar({ status: 'erro', naoEncontrado: e?.status === 404, semRede: e?.codigo === 'rede' || e?.codigo === 'tempo' })
    }
  },
}))
