// Telas do painel por hash (#/rateios, #/rateio/<id>…): funciona em qualquer pasta, sem regra de servidor.
// Cada tela entra no histórico (o voltar do Android volta de tela); as folhas também (o voltar fecha a folha).
import { useSyncExternalStore } from 'react'
import type { FiltroPedidos } from './pedidos/tipos'

const FILTROS_PEDIDOS: FiltroPedidos[] = ['abertos', 'todos', 'novo', 'confirmado', 'saiu', 'entregue', 'cancelado']

export type Rota =
  // pedidos do site, avisos no WhatsApp e falas do pedido guiado
  | { tela: 'pedidos'; status: FiltroPedidos | null; uf: string | null }
  | { tela: 'pedido'; id: number }
  | { tela: 'avisos' }
  | { tela: 'textos' }
  // equipe e clientes (as contas)
  | { tela: 'equipe' }
  | { tela: 'usuario'; login: string }
  | { tela: 'clientes'; promo: boolean }
  | { tela: 'cliente'; id: number }
  | { tela: 'resumo' }
  | { tela: 'rateios' }
  | { tela: 'novo'; produto: string | null }
  | { tela: 'rateio'; id: string }
  | { tela: 'editar'; id: string }
  | { tela: 'atividade'; quem: string | null }
  | { tela: 'conta' }
  | { tela: 'servidor' }
  // loja: produtos, estados, stories do Início, categorias, ajustes e Teste minha sorte
  | { tela: 'produtos'; ver: VerProdutos | null }
  | { tela: 'produto'; id: string }
  | { tela: 'produto-novo' }
  | { tela: 'loja' }
  | { tela: 'estados' }
  | { tela: 'estado'; uf: string }
  | { tela: 'stories'; uf: string | null }
  | { tela: 'categorias' }
  | { tela: 'sorte' }
  | { tela: 'premio'; id: string | null }

/** Recortes da lista de produtos que o Resumo abre direto (?ver=). */
export type VerProdutos = 'esgotados' | 'acabando' | 'fora' | 'exemplo'
const VER: VerProdutos[] = ['esgotados', 'acabando', 'fora', 'exemplo']
const UF = /^[a-z]{2}$/

function ler(): Rota {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  const [caminho, busca = ''] = h.split('?')
  const partes = caminho.split('/').filter(Boolean)
  const q = new URLSearchParams(busca)
  const id = partes[1] && /^[a-z0-9-]{1,80}$/.test(partes[1]) ? partes[1] : null
  switch (partes[0]) {
    case 'pedidos': {
      const status = q.get('status') as FiltroPedidos | null
      const uf = q.get('uf')
      return { tela: 'pedidos', status: status && FILTROS_PEDIDOS.includes(status) ? status : null, uf: uf && /^[a-z]{2}$/.test(uf) ? uf : null }
    }
    case 'pedido':
      return id && /^\d{1,12}$/.test(id) ? { tela: 'pedido', id: Number(id) } : { tela: 'pedidos', status: null, uf: null }
    case 'avisos':
      return { tela: 'avisos' }
    case 'textos':
      return { tela: 'textos' }
    case 'equipe':
      return partes[1] && /^[a-z0-9][a-z0-9._-]{2,31}$/.test(partes[1]) ? { tela: 'usuario', login: partes[1] } : { tela: 'equipe' }
    case 'clientes':
      return { tela: 'clientes', promo: q.get('promo') === '1' }
    case 'cliente':
      return id && /^\d{1,12}$/.test(id) ? { tela: 'cliente', id: Number(id) } : { tela: 'clientes', promo: false }
    case 'rateios':
      return { tela: 'rateios' }
    case 'novo':
      return { tela: 'novo', produto: q.get('produto') }
    case 'rateio':
      if (id) return partes[2] === 'editar' ? { tela: 'editar', id } : { tela: 'rateio', id }
      return { tela: 'rateios' }
    case 'atividade': {
      const quem = q.get('quem')
      return { tela: 'atividade', quem: quem && /^[a-z0-9][a-z0-9._-]{2,31}$/.test(quem) ? quem : null }
    }
    case 'conta':
      return { tela: 'conta' }
    case 'servidor':
      return { tela: 'servidor' }
    case 'produtos': {
      if (partes[1] === 'novo') return { tela: 'produto-novo' }
      const ver = q.get('ver') as VerProdutos | null
      return { tela: 'produtos', ver: ver && VER.includes(ver) ? ver : null }
    }
    case 'produto':
      return id ? { tela: 'produto', id } : { tela: 'produtos', ver: null }
    case 'loja': {
      const uf = partes[2] && UF.test(partes[2]) ? partes[2] : null
      if (partes[1] === 'estados') return { tela: 'estados' }
      if (partes[1] === 'estado') return uf ? { tela: 'estado', uf } : { tela: 'estados' }
      if (partes[1] === 'stories') return { tela: 'stories', uf }
      if (partes[1] === 'categorias') return { tela: 'categorias' }
      if (partes[1] === 'sorte') {
        if (partes[2] === 'novo') return { tela: 'premio', id: null }
        const premio = partes[2] === 'premio' && partes[3] && /^[a-z0-9-]{1,80}$/.test(partes[3]) ? partes[3] : null
        return premio ? { tela: 'premio', id: premio } : { tela: 'sorte' }
      }
      return { tela: 'loja' }
    }
    default:
      return { tela: 'resumo' }
  }
}

let atual = ler()
let chave = location.hash
const ouvintes = new Set<() => void>()
function avisar() {
  if (location.hash === chave) return
  chave = location.hash
  atual = ler()
  ouvintes.forEach((f) => f())
}
window.addEventListener('popstate', avisar)
window.addEventListener('hashchange', avisar)

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

export function useRota(): Rota {
  return useSyncExternalStore(assinar, () => atual)
}

/** Rolagem de cada tela, pra voltar no mesmo ponto (quem restaura é a tela, logo depois de desenhar). */
const rolagens = new Map<string, number>()
history.scrollRestoration = 'manual'
window.addEventListener('scroll', () => rolagens.set(location.hash, window.scrollY), { passive: true })
export function rolagemGuardada(): number {
  return rolagens.get(location.hash) ?? 0
}

/**
 * Volta do histórico que uma folha fechada pediu e ainda não aconteceu (o history.back é assíncrono). Navegar antes
 * dela terminar gravaria a tela nova em cima da entrada da folha, e o voltar dela levaria pra tela de antes.
 */
let voltando: Promise<void> | null = null

export function tirarFolhaDoHistorico(): void {
  voltando = new Promise<void>((ok) => {
    const f = () => {
      window.removeEventListener('popstate', f)
      voltando = null
      ok()
    }
    window.addEventListener('popstate', f)
  })
  history.back()
}

export function depoisDaVolta(): Promise<void> | null {
  return voltando
}

/** Vai pra outra tela (entra no histórico; trocar = substitui a entrada atual). */
export function ir(caminho: string, trocar = false): void {
  if (voltando) {
    void voltando.then(() => ir(caminho, trocar))
    return
  }
  const url = caminho.startsWith('#') ? caminho : `#${caminho}`
  if (url === location.hash || (url === '#/' && !location.hash)) return
  rolagens.set(location.hash, window.scrollY)
  rolagens.delete(url)
  const n = (history.state as { pn?: number } | null)?.pn ?? 0
  if (trocar) history.replaceState({ pn: n }, '', url)
  else history.pushState({ pn: n + 1 }, '', url)
  avisar()
}

/** Voltar de verdade quando a tela anterior é do painel; senão, vai pra tela de cima. */
export function voltar(padrao: string): void {
  if (voltando) {
    void voltando.then(() => voltar(padrao))
    return
  }
  const n = (history.state as { pn?: number; folha?: string } | null)?.pn ?? 0
  if (n > 0) {
    rolagens.set(location.hash, window.scrollY)
    history.back()
  } else ir(padrao, true)
}

export const caminho = {
  resumo: '#/',
  // pedidos, avisos no WhatsApp e falas do pedido guiado
  pedidos: '#/pedidos',
  pedidosDe: (status: FiltroPedidos | null, uf: string | null) => {
    const q = new URLSearchParams()
    if (status) q.set('status', status)
    if (uf) q.set('uf', uf)
    const s = q.toString()
    return s ? `#/pedidos?${s}` : '#/pedidos'
  },
  pedido: (id: number) => `#/pedido/${id}`,
  avisos: '#/avisos',
  textos: '#/textos',
  rateios: '#/rateios',
  novo: '#/novo',
  rateio: (id: string) => `#/rateio/${id}`,
  editar: (id: string) => `#/rateio/${id}/editar`,
  atividade: '#/atividade',
  atividadeDe: (login: string) => `#/atividade?quem=${encodeURIComponent(login)}`,
  // equipe e clientes
  equipe: '#/equipe',
  usuario: (login: string) => `#/equipe/${login}`,
  clientes: '#/clientes',
  clientesPromo: '#/clientes?promo=1',
  cliente: (id: number) => `#/cliente/${id}`,
  conta: '#/conta',
  servidor: '#/servidor',
  // loja
  produtos: '#/produtos',
  produtosVer: (ver: VerProdutos) => `#/produtos?ver=${ver}`,
  produto: (id: string) => `#/produto/${id}`,
  produtoNovo: '#/produtos/novo',
  loja: '#/loja',
  estados: '#/loja/estados',
  estado: (uf: string) => `#/loja/estado/${uf}`,
  stories: '#/loja/stories',
  storiesDe: (uf: string) => `#/loja/stories/${uf}`,
  categorias: '#/loja/categorias',
  sorte: '#/loja/sorte',
  premio: (id: string) => `#/loja/sorte/premio/${id}`,
  premioNovo: '#/loja/sorte/novo',
}
