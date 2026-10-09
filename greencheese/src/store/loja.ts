// A loja do site numa fonte só: catálogo, estados, stories do Início, textos, o WhatsApp e o Teste minha sorte.
// 1) Começa com a embutida no build (src/dados: a mesma loja da semente do servidor).
// 2) Na mesma hora troca pela guardada no aparelho ('gc-loja': a última que veio do servidor), se tiver.
// 3) No tempo ocioso pergunta ao servidor (GET api/index.php?r=loja). Com o ETag, sem mudança o navegador recebe 304 e
//    devolve a mesma; chegou outra versão, troca tudo de uma vez (o que não mudou fica o mesmo objeto: nada pisca).
// Servidor fora do ar, lento ou com resposta torta: fica com o que tem (nunca em branco). Servidor sem loja (404
// sem-loja, painel não instalado): volta pra embutida. O que chega é conferido campo a campo antes de entrar.
// Telas leem pelos hooks daqui; quem só lê na hora (o pedido, o rateio) usa canalDa/canais de src/dados/canais.ts e
// produtoPorId de src/store/catalogo.ts, que acompanham a troca.
import { create } from 'zustand'
import dados from '../dados/catalogo.json'
import { canais as canaisAtuais, canaisEmbutidos, trocarCanais, type Canal, type Cidade, type Emblema, type FormaPagamento, type Turno } from '../dados/canais'
import { config } from '../dados/config'
import { premios as premiosEmbutidos, regrasSorte, type Premio } from '../dados/sorte'
import { textosLoja, type TextosLoja } from '../dados/textos-loja'
import { ufPorSigla } from '../dados/ufs'
import { apagar, ler, gravar } from '../lib/armazenamento'
import { definirWhatsappDaLoja } from '../lib/mensagem'
import { palavraProibida, validarPremios } from '../lib/premios'
import type { Arte, Categoria, Combo, Produto, TipoArte, Variacao } from '../lib/tipos'

export interface RegrasDaSorte {
  girosSemConta: number
  girosPorDiaComConta: number
  reservaSemContaHoras: number
}

export interface Loja {
  /** O WhatsApp da loja (55 + DDD + 9 dígitos): onde o pedido fecha quando o estado não tem número próprio. */
  whatsapp: string
  /** "Restam X" a partir de quantas unidades (null = nunca). O site usa o restam de cada produto, que já vem pronto. */
  restamAte: number | null
  /** A rua do mercador no começo do Início no celular (Loja → Stories do Início, no painel). */
  ruaNoStory: boolean
  textos: TextosLoja
  categorias: Categoria[]
  /** Os do site, na ordem da grade (os de exemplo saem com config.dadosDeExemplo desligado). */
  produtos: Produto[]
  /** Os estados do site, na ordem da loja. */
  canais: Canal[]
  /** uf → ids na ordem do dono (já só o que tá à venda, até 8); uf ausente = o automático. */
  stories: Record<string, string[]>
  sorte: { ligado: boolean; regras: RegrasDaSorte; premios: Premio[] }
}

export type FonteLoja = 'embutida' | 'aparelho' | 'servidor'

interface EstadoLoja extends Loja {
  fonte: FonteLoja
  /** Versão do servidor (null = a embutida). */
  versao: number | null
  /** Hora da última mudança no painel (ISO): o "2 h" do cabeçalho do story. */
  atualizadoEm: string | null
  /** Sobe a cada troca: quem lê na hora (canalDa, interativos) assina isto pra redesenhar. */
  marca: number
}

const CHAVE = 'gc-loja'
const ROTA = './api/index.php?r=loja'
/** A leitura espera no máximo isso (a tela nunca espera: ela já tem a loja). */
const LIMITE_MS = 10000
/** Voltou pra aba depois de tanto tempo escondida: pergunta de novo (celular que deixa a aba aberta por dias). */
const VOLTA_MS = 10 * 60 * 1000
/** As barrinhas do story do Início. */
export const MAX_STORY = 8

/* ───────────────────────── a embutida ───────────────────────── */

const regrasEmbutidas: RegrasDaSorte = {
  girosSemConta: regrasSorte.girosSemConta,
  girosPorDiaComConta: regrasSorte.girosPorDiaComConta,
  reservaSemContaHoras: regrasSorte.reservaSemContaHoras,
}

function montarEmbutida(): Loja {
  const categorias: Categoria[] = (dados.categorias as Categoria[]).map((c) => ({ id: c.id, nome: c.nome, curto: c.curto, icone: c.icone, bebida: c.bebida === true }))
  const produtos = dados.produtos as Produto[]
  return {
    whatsapp: config.whatsappPedidos,
    restamAte: config.restamAte,
    ruaNoStory: true,
    textos: textosLoja,
    categorias,
    produtos,
    canais: [...canaisEmbutidos],
    stories: {},
    // em dev, prêmio errado em src/dados/sorte.ts para com erro na tela (quem editou vê na hora)
    sorte: { ligado: true, regras: regrasEmbutidas, premios: validarPremios(premiosEmbutidos, { produtos, categorias }, import.meta.env.DEV) },
  }
}

/** A embutida, montada uma vez (em dev, prêmio errado em src/dados/sorte.ts para aqui, na abertura). */
const EMBUTIDA = montarEmbutida()

/* ───────────────────────── conferência do que chega ───────────────────────── */

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
 * A loja do servidor (o `loja` do GET r=loja, API.md), conferida. Item torto fica de fora; sem nenhum estado que
 * feche, a resposta inteira não vale (o site nunca fica sem estado por causa de uma resposta torta).
 */
export function lerLoja(v: unknown): Loja | null {
  if (!obj(v)) return null
  const reserva = EMBUTIDA
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
      const l = [...new Set(lista.filter((id): id is string => typeof id === 'string' && ids.has(id)))].slice(0, MAX_STORY)
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
        girosSemConta: inteiroDe(r.girosSemConta, 1, 3) ?? regrasEmbutidas.girosSemConta,
        girosPorDiaComConta: inteiroDe(r.girosPorDiaComConta, 1, 5) ?? regrasEmbutidas.girosPorDiaComConta,
        reservaSemContaHoras: inteiroDe(r.reservaSemContaHoras, 1, 72) ?? regrasEmbutidas.reservaSemContaHoras,
      },
      // as mesmas regras do embutido (cupom.ts): nada de bebida, produto que existe, palavras da lista
      premios: validarPremios(premiosCrus, { produtos, categorias }),
    },
  }
}

/* ───────────────────────── o que o site mostra ───────────────────────── */

/** Os de exemplo (demo) saem com config.dadosDeExemplo desligado; prêmio que cita produto que saiu, sai junto. */
function doSite(l: Loja): Loja {
  if (config.dadosDeExemplo) return l
  const produtos = l.produtos.filter((p) => !p.demo)
  const ids = new Set(produtos.map((p) => p.id))
  const cats = new Set(l.categorias.map((c) => c.id))
  const cita = (p: Premio) =>
    (p.aplicaA.produtos ?? []).every((id) => ids.has(id)) && (p.aplicaA.categorias ?? []).every((c) => cats.has(c)) && (p.tipo !== 'brinde' || ids.has(p.valor.produto))
  return { ...l, produtos, sorte: { ...l.sorte, premios: l.sorte.premios.filter((p) => !p.demo && cita(p)) } }
}

/** Troca reaproveitando o que não mudou (mesmo objeto): componente memo e revelação do produto não recomeçam. */
function reaproveitar<T extends { id?: string; uf?: string }>(novos: T[], antigos: readonly T[]): T[] {
  const chave = (x: T) => x.id ?? x.uf ?? ''
  const porChave = new Map(antigos.map((x) => [chave(x), x]))
  const out = novos.map((x) => {
    const a = porChave.get(chave(x))
    return a && JSON.stringify(a) === JSON.stringify(x) ? a : x
  })
  return out.length === antigos.length && out.every((x, i) => x === antigos[i]) ? (antigos as T[]) : out
}
const igual = <T,>(a: T, b: T): T => (JSON.stringify(a) === JSON.stringify(b) ? a : b)

/** Produtos que saíram numa troca: a página aberta continua mostrando ele (como indisponível) em vez de sumir. */
const sumidos = new Map<string, Produto>()

function estadoDe(l: Loja, fonte: FonteLoja, versao: number | null, atualizadoEm: string | null, antes: EstadoLoja | null): EstadoLoja {
  const site = doSite(l)
  const produtos = antes ? reaproveitar(site.produtos, antes.produtos) : site.produtos
  const canais = antes ? reaproveitar(site.canais, antes.canais) : site.canais
  if (antes) {
    const ficam = new Set(produtos.map((p) => p.id))
    for (const p of antes.produtos) if (!ficam.has(p.id)) sumidos.set(p.id, { ...p, disponivel: {}, restam: undefined })
    for (const id of ficam) sumidos.delete(id)
  }
  return {
    whatsapp: site.whatsapp,
    restamAte: site.restamAte,
    ruaNoStory: site.ruaNoStory,
    textos: antes ? igual(antes.textos, site.textos) : site.textos,
    categorias: antes ? reaproveitar(site.categorias, antes.categorias) : site.categorias,
    produtos,
    canais,
    stories: antes ? igual(antes.stories, site.stories) : site.stories,
    sorte: antes ? igual(antes.sorte, site.sorte) : site.sorte,
    fonte,
    versao,
    atualizadoEm,
    marca: antes ? antes.marca + 1 : 0,
  }
}

/* ───────────────────────── o guardado no aparelho ───────────────────────── */

interface Guardada {
  formato: 1
  versao: number
  atualizadoEm: string
  /** O `loja` como veio do servidor: conferido de novo a cada abertura, com as regras do build que abriu. */
  loja: unknown
}

function lerGuardada(): { loja: Loja; versao: number; atualizadoEm: string } | null {
  const g = ler<Guardada | null>(CHAVE, null)
  if (!obj(g) || g.formato !== 1 || typeof g.versao !== 'number' || typeof g.atualizadoEm !== 'string') return null
  const loja = lerLoja(g.loja)
  return loja ? { loja, versao: g.versao, atualizadoEm: g.atualizadoEm } : null
}

function inicial(): EstadoLoja {
  const g = lerGuardada()
  return g ? estadoDe(g.loja, 'aparelho', g.versao, g.atualizadoEm, null) : estadoDe(EMBUTIDA, 'embutida', null, null, null)
}

export const useLoja = create<EstadoLoja>(inicial)

/** O que fica fora do React acompanha a loja: os estados (canalDa) e o WhatsApp da loja (a mensagem). */
function espelhar(s: EstadoLoja) {
  if (canaisAtuais !== s.canais) trocarCanais(s.canais)
  definirWhatsappDaLoja(s.whatsapp)
}
espelhar(useLoja.getState())
useLoja.subscribe(espelhar)

/* ───────────────────────── servidor ───────────────────────── */

/** Aqui não tem servidor: o arquivo único da prévia ou a página aberta do disco. */
function semServidorAqui(): boolean {
  try {
    return __ARQUIVO_UNICO__ || location.protocol === 'file:'
  } catch {
    return true
  }
}

let buscando: Promise<void> | null = null
let ultimaBusca = 0
let avisarPrimeira: () => void = () => {}
/** Resolve quando a primeira conversa com o servidor termina (deu certo ou não): a planilha espera ela. */
const primeira = new Promise<void>((ok) => {
  avisarPrimeira = ok
})
export const lojaPronta = () => primeira

/** Pergunta a loja ao servidor e troca se veio outra. Nunca joga erro: sem resposta boa, fica tudo como está. */
export function buscarLoja(): Promise<void> {
  if (buscando) return buscando
  buscando = (async () => {
    if (semServidorAqui()) return
    ultimaBusca = Date.now()
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(() => ctrl?.abort(), LIMITE_MS)
    try {
      const r = await fetch(ROTA, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl?.signal })
      let d: unknown
      try {
        d = await r.json()
      } catch {
        return // HTML no lugar de JSON (sem servidor aqui) ou resposta cortada: fica como está
      }
      if (!obj(d)) return
      // o servidor existe e ainda não tem loja (painel não instalado): a embutida, que é a mesma da semente
      if (r.status === 404 && d.ok === false && d.erro === 'sem-loja') {
        apagar(CHAVE)
        if (useLoja.getState().fonte !== 'embutida') aplicar(EMBUTIDA, 'embutida', null, null)
        return
      }
      if (!r.ok || d.ok !== true) return
      const versao = numeroDe(d.versao)
      const atualizadoEm = typeof d.atualizadoEm === 'string' && Number.isFinite(Date.parse(d.atualizadoEm)) ? d.atualizadoEm : null
      if (versao == null || !atualizadoEm) return
      const s = useLoja.getState()
      // a mesma versão que já tá na tela (o 304 de sempre): nada muda
      if (s.fonte !== 'embutida' && s.versao === versao && s.atualizadoEm === atualizadoEm) {
        if (s.fonte !== 'servidor') useLoja.setState({ fonte: 'servidor' })
        return
      }
      const loja = lerLoja(d.loja)
      if (!loja) return
      gravar(CHAVE, { formato: 1, versao, atualizadoEm, loja: d.loja } satisfies Guardada)
      aplicar(loja, 'servidor', versao, atualizadoEm)
    } catch {
      /* fora do ar, tempo esgotado: fica com o que tem */
    } finally {
      clearTimeout(t)
    }
  })().finally(() => {
    buscando = null
    avisarPrimeira()
  })
  return buscando
}

/** Troca a loja de uma vez, num respiro do navegador (nunca no meio de um quadro de animação). */
function aplicar(l: Loja, fonte: FonteLoja, versao: number | null, atualizadoEm: string | null) {
  const trocar = () => useLoja.setState((s) => estadoDe(l, fonte, versao, atualizadoEm, s), true)
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(trocar, { timeout: 800 })
  else setTimeout(trocar, 0)
}

/**
 * Começa a conversa com o servidor: no primeiro respiro depois da primeira pintura (nunca na frente dela) e, depois,
 * quando a pessoa volta pra aba depois de um tempo fora (o celular que deixa o site aberto por dias). Sem o pedido
 * aberto: o pedido montado não muda debaixo da pessoa.
 */
export function iniciarLoja(pedidoAberto: () => boolean = () => false): void {
  if (typeof window === 'undefined' || semServidorAqui()) {
    avisarPrimeira()
    return
  }
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(() => void buscarLoja(), { timeout: 2500 })
  else setTimeout(() => void buscarLoja(), 1200)
  let escondidaEm = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      escondidaEm = Date.now()
      return
    }
    if (escondidaEm && Date.now() - Math.max(escondidaEm, ultimaBusca) >= VOLTA_MS && !pedidoAberto()) void buscarLoja()
  })
}

/* ───────────────────────── leitura ───────────────────────── */

export const useCanais = () => useLoja((s) => s.canais)

/** O canal do estado (assina a loja: redesenha quando os estados mudam). */
export function useCanalDa(uf: string | null | undefined): Canal | undefined {
  return useLoja((s) => (uf ? s.canais.find((c) => c.uf === uf.toLowerCase()) : undefined))
}

/** Assina a troca da loja inteira (pra quem lê na hora, como os interativos e o canal do rateio). */
export const useLojaMarca = () => useLoja((s) => s.marca)

export const useTextosLoja = () => useLoja((s) => s.textos)

export const useRuaNoStory = () => useLoja((s) => s.ruaNoStory)

export function regrasDaSorte(): RegrasDaSorte {
  return useLoja.getState().sorte.regras
}

/** O Teste minha sorte ligado no painel (desligado, o jogo some do site inteiro). */
export function sorteLigada(): boolean {
  return useLoja.getState().sorte.ligado
}

/** Produto que saiu numa troca da loja (a página aberta mostra ele como indisponível). */
export function produtoSumido(id: string): Produto | undefined {
  return sumidos.get(id)
}

/** Os estados em siglas: "RJ · MG · SP · ES · SC". */
export function siglasDosEstados(canais: readonly Canal[], sep = ' · '): string {
  return canais.map((c) => c.uf.toUpperCase()).join(sep)
}

/** "RJ, MG, SP, ES e SC", com o artigo do primeiro ("no RJ, MG…", "em MG, ES…", "na BA…"). */
export function ondeEntrega(canais: readonly Canal[]): string {
  const s = canais.map((c) => c.uf.toUpperCase())
  if (!s.length) return ''
  const lista = s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} e ${s[s.length - 1]}`
  const art = ufPorSigla(s[0])?.art
  return `${art === 'o' ? 'no' : art === 'a' ? 'na' : 'em'} ${lista}`
}
