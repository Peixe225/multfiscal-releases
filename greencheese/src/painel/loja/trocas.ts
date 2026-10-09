// A troca rápida de disponível e estoque por estado (1 toque na lista). A tela muda na hora; o pedido vai em fila por
// produto+estado, cada um com o valor novo (não "inverter"), então a ordem dos toques é a ordem que fica no servidor.
// A resposta só volta pra tela se for a do último toque daquele produto+estado; erro mostra o aviso e relê a loja.
import { useCallback, useRef, useState } from 'react'
import { mensagemDe } from '../api'
import type { Leitura } from '../dados'
import * as api from './api'
import { guardarLoja } from './dados'
import { nomeUf } from './nomes'
import type { LojaAdmin, NoEstado, ProdutoAdmin } from './tipos'

function comNoEstado(l: LojaAdmin, id: string, uf: string, e: NoEstado, extra?: Partial<LojaAdmin>): LojaAdmin {
  return { ...l, ...extra, produtos: l.produtos.map((p) => (p.id === id ? { ...p, estados: { ...p.estados, [uf]: e } } : p)) }
}

export function useTrocasRapidas(leitura: Leitura<LojaAdmin>) {
  const fila = useRef(new Map<string, Promise<unknown>>())
  const ultimo = useRef(new Map<string, number>())
  const [salvando, setSalvando] = useState<ReadonlySet<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const leituraRef = useRef(leitura)
  leituraRef.current = leitura

  const tirar = (k: string) =>
    setSalvando((s) => {
      const t = new Set(s)
      t.delete(k)
      return t
    })

  const mudar = useCallback((p: ProdutoAdmin, uf: string, novo: NoEstado) => {
    const k = `${p.id}|${uf}`
    const n = (ultimo.current.get(k) ?? 0) + 1
    ultimo.current.set(k, n)
    setErro(null)
    leituraRef.current.trocar((l) => comNoEstado(l, p.id, uf, novo))
    setSalvando((s) => new Set(s).add(k))
    const antes = fila.current.get(k) ?? Promise.resolve()
    const agora = antes
      .catch(() => {})
      .then(() => api.produtoNoEstado(p.id, uf, novo))
      .then(
        (r) => {
          if (ultimo.current.get(k) !== n) return
          // só o estado deste toque: outro estado do mesmo produto pode ter um toque no caminho
          const e = r.produto.estados[uf] ?? { disponivel: false, estoque: null }
          const f = (l: LojaAdmin) => comNoEstado(l, p.id, uf, e, { versao: r.versao, atualizadoEm: r.atualizadoEm })
          leituraRef.current.trocar(f)
          guardarLoja(f)
          tirar(k)
        },
        (e: unknown) => {
          if (ultimo.current.get(k) !== n) return
          tirar(k)
          setErro(`Não salvou ${p.nome} em ${nomeUf(uf)}: ${mensagemDe(e)}`)
          void leituraRef.current.recarregar()
        },
      )
    fila.current.set(k, agora)
  }, [])

  return { mudar, salvando, erro, setErro }
}
