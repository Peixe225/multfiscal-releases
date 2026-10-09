// A loja inteira (admin-loja) numa leitura só, guardada pra todas as telas da loja: voltar de tela desenha na hora e
// confere por trás. Depois de cada escrita a tela troca só o pedaço que o servidor devolveu (e a versão).
import { doCache, guardar, useDados, type Leitura } from '../dados'
import * as api from './api'
import type { Carimbo, EstadoAdmin, LojaAdmin, NoEstado, PremioAdmin, ProdutoAdmin } from './tipos'

export const CHAVE = 'loja'

export function useLoja(intervalo = 60_000): Leitura<LojaAdmin> {
  return useDados<LojaAdmin>(CHAVE, async (s) => (await api.loja(s)).loja, intervalo)
}

/** Troca a loja guardada (pra outra tela já abrir com o que acabou de salvar). */
export function guardarLoja(f: (l: LojaAdmin) => LojaAdmin): void {
  const l = doCache<LojaAdmin>(CHAVE)
  if (l) guardar(CHAVE, f(l))
}

const carimbar = (l: LojaAdmin, c: Carimbo): LojaAdmin => ({ ...l, versao: c.versao, atualizadoEm: c.atualizadoEm })

export function comProduto(l: LojaAdmin, p: ProdutoAdmin, c: Carimbo): LojaAdmin {
  const tem = l.produtos.some((x) => x.id === p.id)
  return carimbar({ ...l, produtos: tem ? l.produtos.map((x) => (x.id === p.id ? p : x)) : [...l.produtos, p] }, c)
}

export function semProduto(l: LojaAdmin, id: string, c: Carimbo): LojaAdmin {
  return carimbar({ ...l, produtos: l.produtos.filter((x) => x.id !== id) }, c)
}

export function comEstado(l: LojaAdmin, e: EstadoAdmin, c: Carimbo): LojaAdmin {
  const tem = l.estados.some((x) => x.uf === e.uf)
  return carimbar({ ...l, estados: tem ? l.estados.map((x) => (x.uf === e.uf ? e : x)) : [...l.estados, e] }, c)
}

export function comPremio(l: LojaAdmin, p: PremioAdmin, c: Carimbo): LojaAdmin {
  const tem = l.sorte.premios.some((x) => x.id === p.id)
  return carimbar({ ...l, sorte: { ...l.sorte, premios: tem ? l.sorte.premios.map((x) => (x.id === p.id ? p : x)) : [...l.sorte.premios, p] } }, c)
}

// ─── situação de um produto num estado ──────────────────────────────────────────────────────────────────────────

export type Situacao = 'fora' | 'desligado' | 'esgotado' | 'acabando' | 'disponivel'

/** Sem linha = desligado e sem contar. */
export function noEstado(p: ProdutoAdmin, uf: string): NoEstado {
  return p.estados[uf] ?? { disponivel: false, estoque: null }
}

/**
 * O que o cliente vê nesse estado: fora (produto fora do site), desligado (indisponível), esgotado (ligado com 0 no
 * estoque: sai sozinho), acabando (ligado e com "restam X") ou disponível.
 */
export function situacao(p: ProdutoAdmin, uf: string, restamAte: number | null): Situacao {
  if (!p.ativo) return 'fora'
  const e = noEstado(p, uf)
  if (!e.disponivel) return 'desligado'
  if (e.estoque === 0) return 'esgotado'
  if (e.estoque != null && restamAte != null && e.estoque <= restamAte) return 'acabando'
  return 'disponivel'
}

/** À venda no estado (o "DISPONÍVEL ✅" do site). */
export const aVenda = (s: Situacao) => s === 'disponivel' || s === 'acabando'

/** Estados ativos (no site), na ordem da loja. */
export function estadosNoSite(l: LojaAdmin): EstadoAdmin[] {
  return l.estados.filter((e) => e.ativo)
}

/** Contagens pro Resumo e pros filtros: produtos no site esgotados, acabando (em algum estado ativo), fora e de exemplo. */
export function contagens(l: LojaAdmin): { esgotados: number; acabando: number; fora: number; exemplo: number; noSite: number } {
  const ufs = estadosNoSite(l).map((e) => e.uf)
  let esgotados = 0
  let acabando = 0
  let fora = 0
  let exemplo = 0
  for (const p of l.produtos) {
    if (p.demo) exemplo++
    if (!p.ativo) {
      fora++
      continue
    }
    const s = ufs.map((uf) => situacao(p, uf, l.ajustes.restamAte))
    if (s.includes('esgotado')) esgotados++
    if (s.includes('acabando')) acabando++
  }
  return { esgotados, acabando, fora, exemplo, noSite: l.produtos.length - fora }
}

/** "Fanta Ghost Face Punch 350 ml" (o nome com o tamanho, como na mensagem do pedido). */
export function nomeCompleto(p: { nome: string; tamanho: string }): string {
  return p.tamanho && !p.nome.toLowerCase().includes(p.tamanho.toLowerCase()) ? `${p.nome} ${p.tamanho}` : p.nome
}

const sem = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Busca por nome, tamanho, categoria ou id (cada palavra tem que aparecer). */
export function casa(p: ProdutoAdmin, busca: string, nomeCategoria: string): boolean {
  const partes = sem(busca).split(/\s+/).filter(Boolean)
  if (!partes.length) return true
  const alvo = sem(`${p.nome} ${p.tamanho} ${p.detalhe} ${nomeCategoria} ${p.id}`)
  return partes.every((x) => alvo.includes(x))
}
