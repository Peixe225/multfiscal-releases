// "Colar uma lista" de bairros (a taxa por bairro, 22/10): o dono cola do bloco de notas, do WhatsApp ou da planilha e o
// painel mostra o que entendeu antes de aplicar. Uma linha por bairro:
//   Copacabana: 12          Copacabana; 12,50          Copacabana	12  (da planilha)
//   Copacabana, Ipanema, Leblon: 15   (vários com a mesma taxa)
//   Copacabana R$ 12        Copacabana - R$ 12          Barra da Tijuca: grátis (= sem taxa)
//   Centro (Vila Velha): 10 (a cidade entre parênteses, quando o estado entrega em mais de uma)
//   Recreio                 (linha sem valor = consultar)
// Linha vazia, ou começando com #, fica de fora; numeração e marcador do começo ("1.", "-", "•") saem.
import { chaveBairro, MAX_BAIRROS, TAXA_BAIRRO_MAX } from '../../lib/bairros'
import { lerReais } from '../formato'
import type { BairroAdmin } from './tipos'
import { problemaNoTexto, tamanho } from './validar'

export interface LinhaColada {
  /** A linha como veio (pra prévia). */
  texto: string
  nome: string
  /** '' = qualquer cidade do estado. */
  cidade: string
  taxa: number | null
  /** O que não deu pra entender (a linha fica de fora). */
  problema: string | null
  /** Um lembrete que não tira a linha (o nome termina com número: era a taxa?). */
  aviso?: string
}

/** A chave do bairro na lista: a cidade e o nome, sem acento, maiúscula, espaço nem pontuação a mais. */
export const chaveDaLista = (b: { nome: string; cidade?: string }) => `${chaveBairro(b.cidade ?? '')}|${chaveBairro(b.nome)}`

/** A taxa escrita: '' / "consultar" / "?" = consultar (null); "grátis" / "sem taxa" = 0; senão reais de 0 a 500. */
export function lerTaxaBairro(v: string): { taxa: number | null; problema: string | null } {
  const t = v.trim().toLowerCase().replace(/\.$/, '')
  if (!t || /^(a\s+)?consultar$|^\?$|^-$|^—$/.test(t)) return { taxa: null, problema: null }
  if (/^(gr[aá]tis|sem\s+taxa|zero)$/.test(t)) return { taxa: 0, problema: null }
  const n = lerReais(t.replace(/^r\$\s*/, ''))
  if (n == null || n < 0 || n > TAXA_BAIRRO_MAX) return { taxa: null, problema: `Taxa de R$ 0,00 a R$ ${TAXA_BAIRRO_MAX},00 (ou vazio pra consultar).` }
  return { taxa: Math.round(n * 100) / 100, problema: null }
}

/** O problema do nome do bairro (o mesmo do servidor): null = serve. */
export function problemaNoBairro(nome: string): string | null {
  if (tamanho(nome) < 2 || tamanho(nome) > 60 || !chaveBairro(nome)) return 'Nome do bairro de 2 a 60 letras.'
  return problemaNoTexto(nome, 'loja')
}

const VALOR_NO_FIM = /^(.*?)\s*(?:[-–—]\s*)?R\$\s*([\d.,]+)\s*$/i
/** "Copacabana 12,50": o valor com centavos no fim, sem separador (sem centavos, o número pode ser do nome: "Setor 2"). */
const CENTAVOS_NO_FIM = /^(.*\D)\s+(\d{1,3},\d{2})$/
const TRACO_E_VALOR = /^(.*\S)\s+[-–—]\s+((?:R\$\s*)?[\d.,]+|gr[aá]tis|sem taxa|(?:a\s+)?consultar)\s*$/i

/**
 * Lê a lista colada. `cidades` = as cidades do estado (o "(Cidade)" no fim do nome só vale se for uma delas);
 * `cidadePadrao` = a cidade escolhida pra lista inteira ('' = qualquer cidade).
 */
export function lerListaColada(texto: string, cidades: readonly string[], cidadePadrao: string): LinhaColada[] {
  const porChave = new Map(cidades.map((c) => [chaveBairro(c), c]))
  const out: LinhaColada[] = []
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    if (!linha || linha.startsWith('#')) continue
    let nomes = linha
    let valor = ''
    const sep = Math.max(linha.lastIndexOf(':'), linha.lastIndexOf(';'), linha.lastIndexOf('\t'), linha.lastIndexOf('='))
    if (sep >= 0) {
      nomes = linha.slice(0, sep)
      valor = linha.slice(sep + 1)
    } else {
      const m = VALOR_NO_FIM.exec(linha) ?? TRACO_E_VALOR.exec(linha) ?? CENTAVOS_NO_FIM.exec(linha)
      if (m) {
        nomes = m[1]
        valor = m[2]
      }
    }
    const { taxa, problema: problemaTaxa } = lerTaxaBairro(valor)
    const partes = nomes
      .replace(/^\s*(?:[-•*·]|\d{1,3}[.)])\s+/, '')
      .split(',')
      .map((x) => x.trim().replace(/\s+/g, ' ').replace(/[.]+$/, ''))
      .filter(Boolean)
    if (!partes.length) {
      out.push({ texto: linha, nome: '', cidade: cidadePadrao, taxa, problema: 'Faltou o nome do bairro.' })
      continue
    }
    for (const parte of partes) {
      let nome = parte
      let cidade = cidadePadrao
      const pc = /^(.*\S)\s*\(([^()]+)\)$/.exec(parte)
      if (pc && porChave.has(chaveBairro(pc[2]))) {
        nome = pc[1]
        cidade = porChave.get(chaveBairro(pc[2])) ?? ''
      }
      const numeroNoFim = !valor && /\s\d{1,3}$/.test(nome) ? /\s(\d{1,3})$/.exec(nome)?.[1] : undefined
      out.push({
        texto: linha,
        nome,
        cidade,
        taxa,
        problema: problemaTaxa ?? problemaNoBairro(nome),
        ...(numeroNoFim ? { aviso: `Se ${numeroNoFim} é a taxa, escreve “${nome.slice(0, -numeroNoFim.length).trim()}: ${numeroNoFim}”.` } : {}),
      })
    }
  }
  return out
}

export type Situacao = 'novo' | 'muda' | 'igual' | 'repetido' | 'problema'

/** Cada linha lida contra a lista de agora: novo, muda (de quanto pra quanto), igual, repetido (vale o de baixo) ou problema. */
export function situacoes(linhas: readonly LinhaColada[], lista: readonly BairroAdmin[]): { linha: LinhaColada; situacao: Situacao; antes: BairroAdmin | null }[] {
  const atual = new Map(lista.map((b) => [chaveDaLista(b), b]))
  const ultima = new Map<string, number>()
  linhas.forEach((l, i) => {
    if (!l.problema) ultima.set(chaveDaLista(l), i)
  })
  return linhas.map((l, i) => {
    if (l.problema) return { linha: l, situacao: 'problema', antes: null }
    const k = chaveDaLista(l)
    if (ultima.get(k) !== i) return { linha: l, situacao: 'repetido', antes: null }
    const antes = atual.get(k) ?? null
    if (!antes) return { linha: l, situacao: 'novo', antes }
    return { linha: l, situacao: antes.taxa === l.taxa && antes.nome === l.nome ? 'igual' : 'muda', antes }
  })
}

/** Ordem da lista: pela cidade e pelo nome, do jeito que a gente lê (sem acento contar). */
export function ordenarBairros(lista: BairroAdmin[]): BairroAdmin[] {
  return [...lista].sort((a, b) => (a.cidade ?? '').localeCompare(b.cidade ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * Aplica as linhas boas: 'juntar' (o que já tem fica; o que veio entra ou troca a taxa) ou 'trocar' (a lista vira só a
 * colada). Passou de 400, não aplica (o problema diz quantos sobram).
 */
export function aplicarColada(lista: readonly BairroAdmin[], linhas: readonly LinhaColada[], modo: 'juntar' | 'trocar'): { lista: BairroAdmin[] | null; problema: string | null } {
  const boas = situacoes(linhas, lista).filter((s) => s.situacao !== 'problema' && s.situacao !== 'repetido').map((s) => s.linha)
  const mapa = new Map<string, BairroAdmin>(modo === 'juntar' ? lista.map((b) => [chaveDaLista(b), b]) : [])
  for (const l of boas) mapa.set(chaveDaLista(l), { nome: l.nome, ...(l.cidade ? { cidade: l.cidade } : {}), taxa: l.taxa })
  if (mapa.size > MAX_BAIRROS) return { lista: null, problema: `Ficaria com ${mapa.size} bairros: o máximo é ${MAX_BAIRROS} por estado. Tira ${mapa.size - MAX_BAIRROS} da lista colada${modo === 'juntar' ? ' (ou troca a lista toda)' : ''}.` }
  return { lista: ordenarBairros([...mapa.values()]), problema: null }
}
