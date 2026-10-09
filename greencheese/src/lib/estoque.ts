// O estoque visto pela sacola: o "restam X" de cada produto no estado (o painel conta o estoque; o site só sabe as
// unidades quando elas chegam no limite do "restam", e é aí que a sacola trava). O estoque é do produto: as variações
// (piteira flat e slim) dividem as mesmas unidades.
import { produtoPorId, restamEm } from '../store/catalogo'
import { useLocal } from '../store/local'
import { useLoja } from '../store/loja'
import { chaveItem, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'

/** Unidades desse produto que ainda cabem na sacola (o "restam X" menos o que já tá nela); null = sem limite conhecido. */
export function cabemMais(id: string, uf: string | null | undefined): number | null {
  const p = produtoPorId(id)
  const limite = p ? restamEm(p, uf) : null
  if (limite == null) return null
  const naSacola = useSacola.getState().itens.reduce((n, i) => n + (i.id === id ? i.qtd : 0), 0)
  return Math.max(0, limite - naSacola)
}

/** Itens que a sacola ajustou por causa do estoque (a sacola mostra o aviso neles até fechar). */
const ajustados = new Set<string>()
export const foiAjustado = (id: string, variacao: string | null) => ajustados.has(chaveItem(id, variacao))
export function esquecerAjustes(): void {
  ajustados.clear()
}

/** Põe a sacola dentro do "restam X" de cada produto no estado atual. Devolve os produtos que mudaram. */
export function ajustarSacolaAoEstoque(): { nome: string; restam: number }[] {
  const uf = useLocal.getState().uf
  const { itens, alterar } = useSacola.getState()
  const usado = new Map<string, number>()
  const mudaram: { nome: string; restam: number }[] = []
  for (const i of itens) {
    const p = produtoPorId(i.id)
    const limite = p ? restamEm(p, uf) : null
    if (!p || limite == null) continue
    const ja = usado.get(i.id) ?? 0
    const cabe = Math.max(0, limite - ja)
    if (i.qtd > cabe) {
      // nunca zera sozinho: com 0, o item fica (com o aviso) e a pessoa decide tirar
      const nova = Math.max(1, cabe)
      if (nova !== i.qtd) {
        alterar(i.id, i.variacao, nova)
        ajustados.add(chaveItem(i.id, i.variacao))
        if (!mudaram.some((m) => m.nome === p.nome)) mudaram.push({ nome: p.nome, restam: limite })
      }
      usado.set(i.id, ja + nova)
    } else usado.set(i.id, ja + i.qtd)
  }
  return mudaram
}

/**
 * Confere a sacola na abertura (calado: a sacola mostra o aviso quando abrir) e de novo quando a loja muda ou a
 * pessoa troca de estado (com um aviso curto, se ela já está usando o site).
 */
export function vigiarEstoqueDaSacola(): void {
  ajustarSacolaAoEstoque()
  const conferir = () => {
    const m = ajustarSacolaAoEstoque()
    if (!m.length || useUI.getState().aberturaAtiva) return
    useUI
      .getState()
      .avisar(
        m.length === 1
          ? `Só ${m[0].restam === 1 ? 'resta 1 unidade' : `restam ${m[0].restam} unidades`} de ${m[0].nome} aqui. Ajustei tua sacola.`
          : `${m.length} itens da sacola têm poucas unidades aqui. Ajustei a quantidade.`,
      )
  }
  useLoja.subscribe((s, a) => {
    if (s.marca !== a.marca) conferir()
  })
  useLocal.subscribe((s, a) => {
    if (s.uf !== a.uf) conferir()
  })
}
