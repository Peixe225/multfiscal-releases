// As 27 unidades da federação, com a posição aproximada no mapa em blocos (coluna, linha).

export interface UF {
  sigla: string
  nome: string
  /** Artigo do nome do estado: 'o' (no Rio de Janeiro), 'a' (na Bahia) ou '' (em Minas Gerais). */
  art?: 'o' | 'a'
  /** Coluna e linha no mapa em blocos (grade 7 × 8). */
  x: number
  y: number
}

export const ufs: UF[] = [
  { sigla: 'RR', nome: 'Roraima', x: 2, y: 0 },
  { sigla: 'AP', art: 'o', nome: 'Amapá', x: 4, y: 0 },
  { sigla: 'AM', art: 'o', nome: 'Amazonas', x: 2, y: 1 },
  { sigla: 'PA', art: 'o', nome: 'Pará', x: 3, y: 1 },
  { sigla: 'MA', art: 'o', nome: 'Maranhão', x: 4, y: 1 },
  { sigla: 'CE', art: 'o', nome: 'Ceará', x: 5, y: 1 },
  { sigla: 'RN', art: 'o', nome: 'Rio Grande do Norte', x: 6, y: 1 },
  { sigla: 'AC', art: 'o', nome: 'Acre', x: 1, y: 2 },
  { sigla: 'RO', nome: 'Rondônia', x: 2, y: 2 },
  { sigla: 'MT', nome: 'Mato Grosso', x: 3, y: 2 },
  { sigla: 'TO', art: 'o', nome: 'Tocantins', x: 4, y: 2 },
  { sigla: 'PI', art: 'o', nome: 'Piauí', x: 5, y: 2 },
  { sigla: 'PB', art: 'a', nome: 'Paraíba', x: 6, y: 2 },
  { sigla: 'MS', nome: 'Mato Grosso do Sul', x: 2, y: 3 },
  { sigla: 'GO', nome: 'Goiás', x: 3, y: 3 },
  { sigla: 'DF', art: 'o', nome: 'Distrito Federal', x: 4, y: 3 },
  { sigla: 'BA', art: 'a', nome: 'Bahia', x: 5, y: 3 },
  { sigla: 'PE', nome: 'Pernambuco', x: 6, y: 3 },
  { sigla: 'SP', nome: 'São Paulo', x: 3, y: 4 },
  { sigla: 'MG', nome: 'Minas Gerais', x: 4, y: 4 },
  { sigla: 'ES', art: 'o', nome: 'Espírito Santo', x: 5, y: 4 },
  { sigla: 'AL', nome: 'Alagoas', x: 6, y: 4 },
  { sigla: 'PR', art: 'o', nome: 'Paraná', x: 2, y: 5 },
  { sigla: 'RJ', art: 'o', nome: 'Rio de Janeiro', x: 4, y: 5 },
  { sigla: 'SE', nome: 'Sergipe', x: 6, y: 5 },
  { sigla: 'SC', nome: 'Santa Catarina', x: 2, y: 6 },
  { sigla: 'RS', art: 'o', nome: 'Rio Grande do Sul', x: 2, y: 7 },
]

/** "na Bahia", "no Rio de Janeiro", "em Minas Gerais". */
export function emUf(sigla: string | null | undefined): string {
  const u = ufPorSigla(sigla)
  if (!u) return ''
  return `${u.art === 'a' ? 'na' : u.art === 'o' ? 'no' : 'em'} ${u.nome}`
}

/** "da Bahia", "do Rio de Janeiro", "de Minas Gerais". */
export function deUf(sigla: string | null | undefined): string {
  const u = ufPorSigla(sigla)
  if (!u) return ''
  return `${u.art === 'a' ? 'da' : u.art === 'o' ? 'do' : 'de'} ${u.nome}`
}

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function slug(s: string): string {
  return semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function ufPorSigla(sigla: string | null | undefined): UF | undefined {
  if (!sigla) return undefined
  const s = sigla.toUpperCase().trim()
  return ufs.find((u) => u.sigla === s)
}

/** Aceita sigla ("MG") ou nome ("Minas Gerais", "Sao Paulo", "State of Rio de Janeiro"). */
export function ufPorTexto(texto: string | null | undefined): UF | undefined {
  if (!texto) return undefined
  const porSigla = ufPorSigla(texto)
  if (porSigla) return porSigla
  const t = semAcento(texto).replace(/^(state of|estado de|estado do|estado da)\s+/, '')
  return ufs.find((u) => semAcento(u.nome) === t)
}
