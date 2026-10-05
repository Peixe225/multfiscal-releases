import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { ufPorSigla, slug } from '../dados/ufs'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { palpitePorIp } from '../lib/geo'
import { atualizarParametros, lerParametros } from '../lib/url'

export type Origem = 'link' | 'salvo' | 'ip' | 'manual'

interface LocalState {
  /** Sigla minúscula de qualquer UF (atendida ou não). */
  uf: string | null
  /** Slug da cidade atendida escolhida. */
  cidade: string | null
  /** Cidade informada pela pessoa (CEP ou texto) quando o canal ainda não tem cidade cadastrada. */
  cidadeInformada: string | null
  origem: Origem | null
  /** Palpite de IP só vale depois do "Sim" na enquete. Link e escolha manual já nascem confirmados. */
  confirmado: boolean
  detectando: boolean
  /** Palpite de IP numa UF sem atendimento: não troca o site, só avisa. */
  palpiteFora: string | null
  escolher: (uf: string, cidade?: string | null, origem?: Origem) => void
  escolherCidade: (cidade: string) => void
  informarCidade: (nome: string | null) => void
  confirmar: () => void
}

export const useLocal = create<LocalState>()(
  persist(
    (set, get) => ({
      uf: null,
      cidade: null,
      cidadeInformada: null,
      origem: null,
      confirmado: false,
      detectando: false,
      palpiteFora: null,
      escolher: (uf, cidade = null, origem = 'manual') => {
        const u = uf.toLowerCase()
        const canal = canalDa(u)
        // cidade só vale se for uma das cidades do canal; estado com uma cidade só já vem com ela
        let c = cidade && canal?.cidades.some((x) => x.slug === cidade) ? cidade : null
        if (!c && canal?.cidades.length === 1) c = canal.cidades[0].slug
        const mudouUf = get().uf !== u
        set({
          uf: u,
          cidade: c,
          origem,
          confirmado: origem !== 'ip',
          palpiteFora: null,
          cidadeInformada: mudouUf ? null : get().cidadeInformada,
        })
        if (origem !== 'ip') atualizarParametros({ uf: u, cidade: c })
      },
      escolherCidade: (cidade) => {
        set({ cidade, confirmado: true })
        atualizarParametros({ uf: get().uf, cidade })
      },
      informarCidade: (nome) => set({ cidadeInformada: nome }),
      confirmar: () => {
        set({ confirmado: true, origem: get().origem === 'ip' ? 'manual' : get().origem })
        atualizarParametros({ uf: get().uf, cidade: get().cidade })
      },
    }),
    {
      name: 'gc-local',
      storage: createJSONStorage(() => armazenamentoSeguro),
      // Só a escolha confirmada fica salva; palpite de IP não conta como "escolha salva".
      partialize: (s) =>
        (s.confirmado
          ? { uf: s.uf, cidade: s.cidade, cidadeInformada: s.cidadeInformada, confirmado: true, origem: 'salvo' }
          : {}) as unknown as LocalState,
    },
  ),
)

/**
 * Ordem de decisão do estado: 1) ?uf= na URL (link da bio) 2) escolha salva 3) palpite por IP (pede confirmação) 4) seletor manual.
 */
export async function iniciarLocal(): Promise<void> {
  const p = lerParametros()
  const st = useLocal.getState()
  if (p.uf && ufPorSigla(p.uf)) {
    const canal = canalDa(p.uf)
    const cidade = p.cidade && canal ? (canal.cidades.find((c) => c.slug === slug(p.cidade!))?.slug ?? null) : null
    st.escolher(p.uf, cidade, 'link')
    return
  }
  if (st.confirmado && st.uf) {
    useLocal.setState({ origem: 'salvo' })
    return
  }
  useLocal.setState({ detectando: true })
  const palpite = await palpitePorIp(config.geoTimeoutMs)
  // a pessoa pode ter escolhido na mão enquanto o palpite chegava
  if (useLocal.getState().confirmado) {
    useLocal.setState({ detectando: false })
    return
  }
  // Palpite numa UF sem atendimento nunca abre a tela "não chegou aí" sozinho: só avisa e deixa escolher.
  if (palpite && canalDa(palpite.uf)) useLocal.getState().escolher(palpite.uf, null, 'ip')
  else if (palpite) useLocal.setState({ palpiteFora: palpite.uf })
  useLocal.setState({ detectando: false })
}

export function useCanal(): Canal | undefined {
  return canalDa(useLocal((s) => s.uf))
}

/** Nome da cidade para mostrar/usar no pedido: a cidade atendida escolhida ou a informada pela pessoa. */
export function nomeCidade(canal: Canal | undefined, cidadeSlug: string | null, informada: string | null): string | null {
  if (!canal) return null
  const c = canal.cidades.find((x) => x.slug === cidadeSlug)
  if (c) return c.nome
  if (canal.cidades.length === 0) return informada
  return null
}
