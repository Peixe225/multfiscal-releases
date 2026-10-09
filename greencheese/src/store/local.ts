import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { ufPorSigla, slug } from '../dados/ufs'
import { armazenamentoSeguro } from '../lib/armazenamento'
import { palpitePorIp } from '../lib/geo'
import { atualizarParametros, lerParametros, manterNaURL } from '../lib/url'
import { esperarLoja, esperarLojaToda, lojaConferida, useCanalDa, useLoja } from './loja'

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
  /**
   * O ?uf= do link (estado que a loja daqui ainda não conhece) esperando a do servidor: o Início e o Mercado mostram a
   * vaga de espera, não a tela do estado de antes (nem a de sem estado) para trocar logo depois. Não fica salvo.
   */
  linkEsperando: string | null
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
      linkEsperando: null,
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

// a URL com ?uf= (link da bio, escolha confirmada) acompanha o estado do site mesmo depois de uma folha fechar:
// recarregar (ou o Android restaurar a aba na volta do WhatsApp) não volta pro estado de antes da troca
manterNaURL(() => {
  const s = useLocal.getState()
  return s.confirmado && s.uf && lerParametros().uf ? { uf: s.uf, cidade: s.cidade } : {}
})

/**
 * Quanto o palpite por IP espera a loja do servidor quando a UF não está na daqui (pode ser estado ativado no painel).
 * O palpite nunca abre o "ainda não chegou aí" sozinho, e o estado que entrar depois vira a pergunta (acompanharEstados):
 * não precisa esperar a conversa inteira. O ?uf= do link espera ela toda (ver iniciarLocal).
 */
const ESPERA_PALPITE_MS = 2500

/**
 * Ordem de decisão do estado: 1) ?uf= na URL (link da bio) 2) escolha salva 3) palpite por IP (pede confirmação) 4) seletor manual.
 */
export async function iniciarLocal(): Promise<void> {
  const p = lerParametros()
  const st = useLocal.getState()
  if (p.uf && ufPorSigla(p.uf)) {
    // estado que a loja daqui ainda não conhece (ativado no painel depois da última visita): espera a do servidor
    // enquanto a conversa durar, "procurando", em vez de mostrar "ainda não chegou aí" e trocar logo depois
    if (!canalDa(p.uf) && !lojaConferida()) {
      useLocal.setState({ detectando: true, linkEsperando: p.uf.toLowerCase() })
      await esperarLojaToda()
      useLocal.setState({ detectando: false, linkEsperando: null })
      if (useLocal.getState().confirmado && useLocal.getState().origem === 'manual') return
    }
    const canal = canalDa(p.uf)
    const cidade = p.cidade && canal ? (canal.cidades.find((c) => c.slug === slug(p.cidade!))?.slug ?? null) : null
    useLocal.getState().escolher(p.uf, cidade, 'link')
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
  // palpite num estado que a loja daqui não conhece: espera a do servidor um pouco (pode ser estado ativado no painel)
  if (palpite && !canalDa(palpite.uf) && !lojaConferida()) {
    await esperarLoja(ESPERA_PALPITE_MS)
    if (useLocal.getState().confirmado) {
      useLocal.setState({ detectando: false })
      return
    }
  }
  // Palpite numa UF sem atendimento nunca abre a tela "não chegou aí" sozinho: só avisa e deixa escolher.
  if (palpite && canalDa(palpite.uf)) useLocal.getState().escolher(palpite.uf, null, 'ip')
  else if (palpite) useLocal.setState({ palpiteFora: palpite.uf })
  useLocal.setState({ detectando: false })
}

/**
 * Os estados da loja mudaram (a do servidor chegou, o dono ativou ou tirou um estado): o local acompanha sem a pessoa
 * fazer nada. Cidade que saiu do estado sai da escolha (estado com uma cidade só já fica com ela; a do link da bio
 * volta, se o estado ganhou ela); palpite de IP num estado que entrou vira a pergunta "Você está em…?"; palpite (ainda
 * sem "Sim") num estado que saiu vira só o aviso, como palpite fora. Escolha confirmada num estado que saiu fica: a
 * pessoa vê a tela de sem atendimento e escolhe outro.
 */
function acompanharEstados(): void {
  const s = useLocal.getState()
  if (!s.uf) {
    if (s.palpiteFora && !s.confirmado && !s.detectando && canalDa(s.palpiteFora)) s.escolher(s.palpiteFora, null, 'ip')
    return
  }
  const canal = canalDa(s.uf)
  if (!canal) {
    if (s.origem === 'ip' && !s.confirmado) useLocal.setState({ uf: null, cidade: null, origem: null, palpiteFora: s.uf })
    return
  }
  if (s.cidade && canal.cidades.some((c) => c.slug === s.cidade)) return
  const p = lerParametros()
  const doLink = s.origem === 'link' && p.uf === s.uf && p.cidade ? (canal.cidades.find((c) => c.slug === slug(p.cidade!))?.slug ?? null) : null
  const cidade = doLink ?? (canal.cidades.length === 1 ? canal.cidades[0].slug : null)
  if (cidade === s.cidade) return
  useLocal.setState({ cidade })
  if (s.confirmado && p.uf) atualizarParametros({ uf: s.uf, cidade })
}
useLoja.subscribe((s, a) => {
  if (s.canais !== a.canais) acompanharEstados()
})

/**
 * O link com ?uf= ainda espera a loja do servidor (estado que a daqui não conhece) e a pessoa não escolheu outro na mão
 * nesse meio-tempo: a tela espera numa vaga preta.
 */
export function useEsperandoLink(): boolean {
  return useLocal((s) => s.linkEsperando != null && !(s.confirmado && s.origem === 'manual'))
}

/** O canal do estado escolhido (redesenha quando a loja troca os estados). */
export function useCanal(): Canal | undefined {
  return useCanalDa(useLocal((s) => s.uf))
}

/** Nome da cidade para mostrar/usar no pedido: a cidade atendida escolhida ou a informada pela pessoa. */
export function nomeCidade(canal: Canal | undefined, cidadeSlug: string | null, informada: string | null): string | null {
  if (!canal) return null
  const c = canal.cidades.find((x) => x.slug === cidadeSlug)
  if (c) return c.nome
  if (canal.cidades.length === 0) return informada
  return null
}
