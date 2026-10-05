import type { ComponentType } from 'react'
import { canalDa } from '../dados/canais'
import { premiosValidos } from '../lib/cupom'
import { useLocal } from '../store/local'
import { useEntradaSorte } from './sorte/estado'

// Registro dos interativos "underground" (o "Teste minha sorte" é o primeiro).
// O próximo entra com: 1 linha aqui, o jogo em src/interativos/<id>/ (componente default que recebe PropsJogo e usa
// a CascaInterativo) e a tabela de prêmios dele em src/dados/. As entradas (destaque, lateral, adesivo do feed) são
// componentes que chamam i.useEntrada() dentro de si, então a ordem dos hooks fica estável.

export interface EntradaInterativo {
  /** Anel aceso (como story não visto): tem coisa nova pra pessoa ali. */
  aceso: boolean
  /** Ponto branco na lateral. */
  ponto: boolean
  /** Selo "novo" até a primeira abertura neste aparelho. */
  novo: boolean
  rotulo: string
  aria: string
  /** @ do perfil do estado para o cabeçalho do adesivo (null = Green Cheese). */
  instagram: string | null
  /** Carimbo "exemplo" (prévia). */
  exemplo: boolean
  adesivo: { pergunta?: string; titulo: string; texto?: string; legenda?: string; cta: string; acao: () => void } | null
}

export interface PropsJogo {
  tela?: 'cadastro' | 'entrar'
}

export interface Interativo {
  id: string
  titulo: string
  curto: string
  /** Nome do ícone de pixel (Icone). */
  icone: string
  /** Valor do ?jogo= na URL. */
  param: string
  status: 'ativo' | 'em-breve'
  /** O que pede conta: guardar o prêmio, jogar, ou nada. */
  exigeContaPara: 'guardar' | 'jogar' | null
  /**
   * Aparece no site? Sem prêmio válido, ou com um estado escolhido que a loja não atende (o cupom não serviria em
   * lugar nenhum), some de todas as entradas e o ?jogo= é ignorado. Quem chama precisa re-renderizar quando o
   * estado muda (as entradas leem useLocal).
   */
  ativo: () => boolean
  useEntrada?: () => EntradaInterativo
  carregar?: () => Promise<{ default: ComponentType<PropsJogo> }>
}

/** Estado escolhido e sem atendimento (ex.: BA): nada de jogo nem de conta pra um cupom que não dá pra usar. */
function estadoSemAtendimento(): boolean {
  const uf = useLocal.getState().uf
  return !!uf && !canalDa(uf)
}

export const interativos: Interativo[] = [
  {
    id: 'sorte',
    titulo: 'Teste minha sorte',
    curto: 'Sorte',
    icone: 'dichavador',
    param: 'sorte',
    status: 'ativo',
    exigeContaPara: 'guardar',
    ativo: () => !estadoSemAtendimento() && premiosValidos().length > 0,
    useEntrada: useEntradaSorte,
    carregar: () => import('./sorte/JogoSorte'),
  },
  // os próximos: só aparecem travados em "Próximos interativos" (Minha conta), sem nome e sem data
  { id: 'em-breve-1', titulo: '???', curto: '???', icone: 'cadeado', param: '', status: 'em-breve', exigeContaPara: null, ativo: () => false },
  { id: 'em-breve-2', titulo: '???', curto: '???', icone: 'cadeado', param: '', status: 'em-breve', exigeContaPara: null, ativo: () => false },
]

/** Interativos que aparecem no site agora (ativos e com prêmio). */
export function interativosAtivos(): Interativo[] {
  return interativos.filter((i) => i.status === 'ativo' && i.ativo())
}

export function interativosEmBreve(): Interativo[] {
  return interativos.filter((i) => i.status === 'em-breve')
}

export function interativoPorId(id: string | null | undefined): Interativo | undefined {
  return id ? interativos.find((i) => i.id === id) : undefined
}

export function interativoPorParam(p: string | null | undefined): Interativo | undefined {
  return p ? interativos.find((i) => i.status === 'ativo' && i.param === p) : undefined
}
