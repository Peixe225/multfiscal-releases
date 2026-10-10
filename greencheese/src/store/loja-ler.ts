// A conferência do que chega do servidor (o `loja` do GET r=loja, API.md), campo a campo: item torto fica de fora e
// texto com palavra da lista volta pro embutido. Num pedaço à parte (src/store/loja.ts carrega só quando precisa: a
// resposta nova do servidor, ou a loja guardada por outro build): a primeira tela não paga por ela.
import type { Canal, Cidade, Emblema, FormaPagamento, Turno } from '../dados/canais'
import type { Premio } from '../dados/sorte'
import { ufPorSigla } from '../dados/ufs'
import { palavraProibida, validarPremios } from '../lib/premios'
import type { Arte, Categoria, Combo, Produto, TipoArte, Variacao } from '../lib/tipos'
import type { Loja } from './loja'

type Bruto = Record<string, unknown>
const obj = (v: unknown): v is Bruto => !!v && typeof v === 'object' && !Array.isArray(v)
const textoDe = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
const numeroDe = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const inteiroDe = (v: unknown, min: number, max: number): number | null => {
  const n = numeroDe(v)
  return n != null && Number.isInteger(n) && n >= min && n <= max ? n : null
}
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const UF = /^[a-z]{2}$/
const COR = /^#[0-9a-f]{6}$/i
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
// só foto de dentro do site: a que o painel enviou (uploads/) ou a do build (produtos/)
const FOTO = /^(uploads|produtos)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const WHATSAPP = /^55\d{2}9\d{8}$/
const TIPOS_ARTE = new Set<TipoArte>(['lata', 'lata-alta', 'garrafa-quadrada', 'garrafa-gin', 'garrafa-conhaque', 'garrafa-licor', 'seda', 'piteira-vidro', 'piteira-papel', 'cuia', 'dichavador', 'isqueiro', 'bandeja'])
const EMBLEMAS = new Set<Emblema>(['pao-de-acucar', 'pedra-preciosa', 'predio-sp', 'convento-es', 'ponte-sc', 'generico'])
const PAGAMENTOS = new Set<FormaPagamento>(['pix', 'dinheiro', 'cartao'])
const ICONES = new Set(['lata', 'garrafa', 'seda', 'piteira', 'cuia', 'dichavador', 'tesoura', 'sacola', 'estrela'])

function arteDe(v: unknown, cor: string): Arte {
  const a = obj(v) ? v : {}
  const tipo = TIPOS_ARTE.has(a.tipo as TipoArte) ? (a.tipo as TipoArte) : 'lata'
  const arte: Arte = { tipo, corpo: typeof a.corpo === 'string' && COR.test(a.corpo) ? a.corpo : cor }
  for (const k of ['faixa', 'rotulo', 'detalhe', 'tampa'] as const) if (typeof a[k] === 'string' && COR.test(a[k] as string)) arte[k] = a[k] as string
  return arte
}

function produtoDe(v: unknown): Produto | null {
  if (!obj(v)) return null
  const id = typeof v.id === 'string' && ID.test(v.id) ? v.id : null
  const nome = textoDe(v.nome, 80)
  const categoria = typeof v.categoria === 'string' && ID.test(v.categoria) ? v.categoria : null
  if (!id || !nome || !categoria) return null
  const preco = numeroDe(v.preco)
  const cor = typeof v.cor === 'string' && COR.test(v.cor) ? v.cor : '#a8a8a8'
  const p: Produto = {
    id,
    nome,
    categoria,
    // preço que não fecha vira "Consultar" (nunca um número inventado)
    preco: preco != null && preco >= 0 ? preco : null,
    disponivel: {},
    demo: v.demo === true,
    foto: typeof v.foto === 'string' && FOTO.test(v.foto) && !v.foto.includes('..') ? v.foto : null,
    cor,
    arte: arteDe(v.arte, cor),
  }
  const tamanho = textoDe(v.tamanho, 30)
  const detalhe = textoDe(v.detalhe, 80)
  const descricao = textoDe(v.descricao, 400)
  if (tamanho) p.tamanho = tamanho
  if (detalhe) p.detalhe = detalhe
  if (descricao) p.descricao = descricao
  if (Array.isArray(v.combos) && p.preco != null) {
    const combos: Combo[] = []
    for (const c of v.combos) {
      const qtd = obj(c) ? inteiroDe(c.qtd, 2, 99) : null
      const total = obj(c) ? numeroDe(c.total) : null
      if (qtd != null && total != null && total > 0 && !combos.some((x) => x.qtd === qtd)) combos.push({ qtd, total })
    }
    if (combos.length) p.combos = combos.sort((a, b) => a.qtd - b.qtd)
  }
  if (Array.isArray(v.variacoes)) {
    const vs: Variacao[] = []
    for (const x of v.variacoes) {
      if (!obj(x)) continue
      const vid = textoDe(x.id, 60)
      const vnome = textoDe(x.nome, 60)
      if (!vid || !vnome || vs.some((y) => y.id === vid)) continue
      const vpreco = numeroDe(x.preco)
      vs.push(vpreco != null && vpreco >= 0 ? { id: vid, nome: vnome, preco: vpreco } : { id: vid, nome: vnome })
    }
    if (vs.length) p.variacoes = vs
  }
  if (obj(v.disponivel)) for (const [uf, sim] of Object.entries(v.disponivel)) if (UF.test(uf)) p.disponivel[uf] = sim === true
  if (obj(v.restam)) {
    const restam: Record<string, number> = {}
    for (const [uf, n] of Object.entries(v.restam)) {
      const k = inteiroDe(n, 1, 99999)
      if (UF.test(uf) && k != null && p.disponivel[uf]) restam[uf] = k
    }
    if (Object.keys(restam).length) p.restam = restam
  }
  if (Array.isArray(v.combinaCom)) {
    const ids = v.combinaCom.filter((x): x is string => typeof x === 'string' && ID.test(x) && x !== id)
    if (ids.length) p.combinaCom = [...new Set(ids)].slice(0, 8)
  }
  return p
}

function turnoDe(v: unknown): Turno | undefined {
  if (v === null) return null
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && HORA.test(v[0]) && HORA.test(v[1]) && v[0] !== v[1]) return [v[0], v[1]]
  return undefined
}

function canalDe(v: unknown): Canal | null {
  if (!obj(v)) return null
  const uf = typeof v.uf === 'string' && UF.test(v.uf) ? v.uf : null
  const instagram = typeof v.instagram === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(v.instagram) ? v.instagram : null
  if (!uf || !instagram) return null
  const h = obj(v.horario) ? v.horario : {}
  const semana = Array.isArray(h.semana) && h.semana.length === 7 ? h.semana.map(turnoDe) : null
  // horário que não fecha fica "a confirmar" (de exemplo: o site não mostra), nunca um horário inventado
  const horarioOk = !!semana && semana.every((t) => t !== undefined)
  const t = obj(v.taxaEntrega) ? v.taxaEntrega : {}
  const taxa = numeroDe(t.valor)
  const g = obj(v.entregaGratis) ? v.entregaGratis : null
  const diasCrus = g && Array.isArray(g.dias) ? g.dias : g && typeof g.diaSemana === 'number' ? [g.diaSemana] : []
  const dias = [...new Set(diasCrus.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))]
  const textoGratis = g ? textoDe(g.texto, 60) : null
  const pg = obj(v.pagamento) ? v.pagamento : {}
  const opcoes = Array.isArray(pg.opcoes) ? [...new Set(pg.opcoes.filter((o): o is FormaPagamento => PAGAMENTOS.has(o as FormaPagamento)))] : []
  const cidades: Cidade[] = []
  if (Array.isArray(v.cidades)) {
    for (const c of v.cidades) {
      const slug = obj(c) && typeof c.slug === 'string' && ID.test(c.slug) ? c.slug : null
      const nome = obj(c) ? textoDe(c.nome, 60) : null
      if (slug && nome && !cidades.some((x) => x.slug === slug)) cidades.push({ slug, nome })
    }
  }
  return {
    uf,
    nome: textoDe(v.nome, 40) ?? ufPorSigla(uf)?.nome ?? uf.toUpperCase(),
    destaque: textoDe(v.destaque, 24) ?? `DELIVERY ${uf.toUpperCase()}`,
    nomePerfil: textoDe(v.nomePerfil, 40),
    cidades,
    instagram,
    whatsapp: typeof v.whatsapp === 'string' && WHATSAPP.test(v.whatsapp) ? v.whatsapp : null,
    horario: horarioOk ? { semana: semana as Canal['horario']['semana'], demo: h.demo === true } : { semana: [null, null, null, null, null, null, null], demo: true },
    taxaEntrega: { valor: taxa != null && taxa >= 0 ? taxa : null, demo: t.demo === true },
    entregaGratis: dias.length && textoGratis ? { dias, texto: textoGratis, demo: g!.demo === true } : null,
    // pagamento que não fecha: as três, como exemplo ("Como vai pagar?" nunca fica sem opção)
    pagamento: opcoes.length ? { opcoes, demo: pg.demo === true } : { opcoes: ['pix', 'dinheiro', 'cartao'], demo: true },
    emblema: EMBLEMAS.has(v.emblema as Emblema) ? (v.emblema as Emblema) : 'generico',
  }
}

function categoriaDe(v: unknown): Categoria | null {
  if (!obj(v)) return null
  const id = typeof v.id === 'string' && ID.test(v.id) ? v.id : null
  const nome = textoDe(v.nome, 40)
  if (!id || !nome) return null
  return { id, nome, curto: textoDe(v.curto, 20) ?? nome, icone: typeof v.icone === 'string' && ICONES.has(v.icone) ? v.icone : 'estrela', bebida: v.bebida !== false }
}

/** Texto da loja: o do servidor, ou o embutido quando falta ou tem palavra da lista. */
function textoLimpo(v: unknown, max: number, reserva: string): string {
  const t = textoDe(v, max)
  return t && !palavraProibida(t) ? t : reserva
}
function linhasLimpas(v: unknown, maxLinhas: number, max: number, reserva: string[]): string[] {
  const l = Array.isArray(v) ? v.map((x) => textoDe(x, max)).filter((x): x is string => !!x && !palavraProibida(x)).slice(0, maxLinhas) : []
  return l.length ? l : reserva
}

function premioDe(v: unknown): Premio | null {
  if (!obj(v) || typeof v.id !== 'string' || typeof v.tipo !== 'string' || !obj(v.aplicaA)) return null
  const a = v.aplicaA
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : undefined)
  const p = {
    id: v.id,
    tipo: v.tipo,
    valor: v.valor,
    titulo: textoDe(v.titulo, 80) ?? '',
    descricao: textoDe(v.descricao, 60) ?? '',
    regra: textoDe(v.regra, 160) ?? '',
    aplicaA: { produtos: lista(a.produtos), categorias: lista(a.categorias) },
    peso: numeroDe(v.peso) ?? 0,
    validadeDias: numeroDe(v.validadeDias) ?? 0,
    demo: v.demo === true,
  } as Premio
  const como = textoDe(v.comoUsar, 200)
  if (como) p.comoUsar = como
  if (!p.aplicaA.produtos) delete p.aplicaA.produtos
  if (!p.aplicaA.categorias) delete p.aplicaA.categorias
  return p
}

/**
 * A loja do servidor (o `loja` do GET r=loja), conferida; `reserva` (a embutida) cobre o que falta e `maxStory` são as
 * barrinhas do story do Início. Sem nenhum estado que feche, a resposta inteira não vale (o site nunca fica sem estado
 * por causa de uma resposta torta).
 */
export function lerLoja(v: unknown, reserva: Loja, maxStory: number): Loja | null {
  if (!obj(v)) return null
  const canais: Canal[] = []
  for (const x of Array.isArray(v.estados) ? v.estados : []) {
    const c = canalDe(x)
    if (c && !canais.some((y) => y.uf === c.uf)) canais.push(c)
  }
  if (!canais.length) return null
  const categorias: Categoria[] = []
  for (const x of Array.isArray(v.categorias) ? v.categorias : []) {
    const c = categoriaDe(x)
    if (c && !categorias.some((y) => y.id === c.id)) categorias.push(c)
  }
  const produtos: Produto[] = []
  for (const x of Array.isArray(v.produtos) ? v.produtos : []) {
    const p = produtoDe(x)
    if (p && !produtos.some((y) => y.id === p.id)) produtos.push(p)
  }
  const ids = new Set(produtos.map((p) => p.id))
  for (const p of produtos) if (p.combinaCom) p.combinaCom = p.combinaCom.filter((id) => ids.has(id))
  const stories: Record<string, string[]> = {}
  if (obj(v.stories)) {
    for (const [uf, lista] of Object.entries(v.stories)) {
      if (!UF.test(uf) || !Array.isArray(lista)) continue
      const l = [...new Set(lista.filter((id): id is string => typeof id === 'string' && ids.has(id)))].slice(0, maxStory)
      if (l.length) stories[uf] = l
    }
  }
  const t = obj(v.textos) ? v.textos : {}
  const s = obj(v.sorte) ? v.sorte : {}
  const r = obj(s.regras) ? s.regras : {}
  const premiosCrus = (Array.isArray(s.premios) ? s.premios : []).map(premioDe).filter((p): p is Premio => !!p)
  const restamAte = v.restamAte === null ? null : inteiroDe(v.restamAte, 1, 99)
  return {
    whatsapp: typeof v.whatsapp === 'string' && WHATSAPP.test(v.whatsapp) ? v.whatsapp : reserva.whatsapp,
    restamAte: restamAte ?? null,
    // a rua no fim do Início do celular (o nome vem de quando ela era o 1º story): sem o ajuste, ligada
    ruaNoStory: v.ruaNoStory !== false,
    textos: {
      bio: linhasLimpas(t.bio, 3, 80, reserva.textos.bio),
      fraseStory: textoLimpo(t.fraseStory, 28, reserva.textos.fraseStory),
      sacolaVazia: textoLimpo(t.sacolaVazia, 48, reserva.textos.sacolaVazia),
      falasMercado: linhasLimpas(t.falasMercado, 5, 32, reserva.textos.falasMercado),
    },
    categorias,
    produtos,
    canais,
    stories,
    sorte: {
      ligado: s.ligado !== false,
      regras: {
        girosSemConta: inteiroDe(r.girosSemConta, 1, 3) ?? reserva.sorte.regras.girosSemConta,
        girosPorDiaComConta: inteiroDe(r.girosPorDiaComConta, 1, 5) ?? reserva.sorte.regras.girosPorDiaComConta,
        reservaSemContaHoras: inteiroDe(r.reservaSemContaHoras, 1, 72) ?? reserva.sorte.regras.reservaSemContaHoras,
      },
      // as mesmas regras do embutido (cupom.ts): nada de bebida, produto que existe, palavras da lista
      premios: validarPremios(premiosCrus, { produtos, categorias }),
    },
  }
}
