import type { UfAtendida } from '../dados/canais'
import type { Produto } from './tipos'

/** CSV simples com aspas (Google Sheets publicado). */
export function lerCsv(texto: string): string[][] {
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',' || c === ';') {
      linha.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
    } else campo += c
  }
  if (campo || linha.length) {
    linha.push(campo)
    linhas.push(linha)
  }
  return linhas.filter((l) => l.some((x) => x.trim()))
}

const SIM = /^(sim|s|x|1|true|verdadeiro|disponivel|disponível|✅)$/i
const UFS: UfAtendida[] = ['rj', 'mg', 'sp', 'es', 'sc']

/** Aplica preço e disponibilidade da planilha sobre o catálogo (só para ids que já existem). */
export function aplicarPlanilha(produtos: Produto[], csv: string): Produto[] {
  const [cab, ...linhas] = lerCsv(csv)
  if (!cab) return produtos
  const idx = (n: string) => cab.findIndex((c) => c.trim().toLowerCase() === n)
  const iId = idx('id')
  if (iId < 0) return produtos
  const iPreco = idx('preco') >= 0 ? idx('preco') : idx('preço')
  const porId = new Map(linhas.map((l) => [l[iId]?.trim(), l]))
  return produtos.map((p) => {
    const l = porId.get(p.id)
    if (!l) return p
    const novo: Produto = { ...p, disponivel: { ...p.disponivel } }
    if (iPreco >= 0) {
      const bruto = (l[iPreco] ?? '').trim()
      if (bruto === '' || /consultar/i.test(bruto)) novo.preco = null
      else {
        const n = Number(bruto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
        if (Number.isFinite(n) && n > 0) novo.preco = n
      }
    }
    for (const uf of UFS) {
      const i = idx(uf)
      if (i >= 0 && l[i] != null) novo.disponivel[uf] = SIM.test(l[i].trim())
    }
    return novo
  })
}
