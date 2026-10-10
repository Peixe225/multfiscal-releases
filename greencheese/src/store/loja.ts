// A loja do site numa fonte só: catálogo, estados, stories do Início, textos, o WhatsApp e o Teste minha sorte.
// 1) Começa com a embutida no build (src/dados: a mesma loja da semente do servidor).
// 2) Na mesma hora troca pela guardada no aparelho ('gc-loja': a última que veio do servidor), se tiver.
// 3) No tempo ocioso pergunta ao servidor (GET api/index.php?r=loja). Com o ETag, sem mudança o navegador recebe 304 e
//    devolve a mesma; chegou outra versão, troca tudo de uma vez (o que não mudou fica o mesmo objeto: nada pisca).
// Servidor fora do ar, lento ou com resposta torta: fica com o que tem (nunca em branco). Servidor sem loja (404
// sem-loja, painel não instalado): volta pra embutida. O que chega é conferido campo a campo antes de entrar
// (src/store/loja-ler.ts, num pedaço à parte: só baixa quando chega loja nova).
// Telas leem pelos hooks daqui; quem só lê na hora (o pedido, o rateio) usa canalDa/canais de src/dados/canais.ts e
// produtoPorId de src/store/catalogo.ts, que acompanham a troca.
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import dados from '../dados/catalogo.json'
import { canais as canaisAtuais, canaisEmbutidos, trocarCanais, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { premios as premiosEmbutidos, regrasSorte, type Premio } from '../dados/sorte'
import { textosLoja, type TextosLoja } from '../dados/textos-loja'
import { ufPorSigla } from '../dados/ufs'
import { apagar, ler, gravar } from '../lib/armazenamento'
import { definirWhatsappDaLoja } from '../lib/mensagem'
import { validarPremios } from '../lib/premios'
import type { Categoria, Produto } from '../lib/tipos'

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
  /**
   * A rua do mercador no celular (Loja → Stories do Início, no painel): o 1º story do Início na home e o fim do Início,
   * depois da grade, na Home 2. O nome é o do contrato (JSON e banco), de quando ela só era o 1º story; desligada, o
   * celular fica sem a rua nas duas. No computador a rua fica sempre embaixo do perfil.
   */
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

/**
 * O build que guardou. A `pronta` vale pra primeira tela em qualquer build do mesmo formato (o formato sobe quando o
 * jeito da Loja muda); guardada por outro build, ela é conferida de novo logo depois, com as regras deste.
 */
const BUILD = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

interface Guardada {
  formato: 2
  build: string
  versao: number
  atualizadoEm: string
  /** O `loja` como veio do servidor (outro build confere de novo, com as regras dele). */
  loja: unknown
  /** A loja já conferida (abre a primeira tela sem conferir de novo). */
  pronta: Loja
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A guardada no aparelho: a `pronta` (formato 2) abre a primeira tela; guardada por outro build (ou no formato velho, só
 * a crua), ela também vai pra conferir de novo.
 */
function lerGuardada(): { pronta: Loja | null; conferir: boolean; crua: unknown; versao: number; atualizadoEm: string } | null {
  const g = ler<unknown>(CHAVE, null)
  if (!ehObjeto(g) || typeof g.versao !== 'number' || typeof g.atualizadoEm !== 'string' || (g.formato !== 1 && g.formato !== 2)) return null
  const p = g.formato === 2 && ehObjeto(g.pronta) ? (g.pronta as unknown as Loja) : null
  const pronta = p && Array.isArray(p.canais) && p.canais.length && Array.isArray(p.produtos) && Array.isArray(p.categorias) && ehObjeto(p.sorte) && ehObjeto(p.textos) ? p : null
  return { pronta, conferir: !pronta || g.build !== BUILD, crua: g.loja, versao: g.versao, atualizadoEm: g.atualizadoEm }
}

function guardar(crua: unknown, pronta: Loja, versao: number, atualizadoEm: string) {
  gravar(CHAVE, { formato: 2, build: BUILD, versao, atualizadoEm, loja: crua, pronta } satisfies Guardada)
}

/** Guardada por outro build (ou no formato velho): conferida de novo depois da conversa com o servidor. */
let paraConferir: { crua: unknown; versao: number; atualizadoEm: string } | null = null

function inicial(): EstadoLoja {
  const g = lerGuardada()
  if (g?.conferir) paraConferir = { crua: g.crua, versao: g.versao, atualizadoEm: g.atualizadoEm }
  return g?.pronta ? estadoDe(g.pronta, 'aparelho', g.versao, g.atualizadoEm, null) : estadoDe(EMBUTIDA, 'embutida', null, null, null)
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
let conferida = false
/** O servidor já respondeu com a loja (nova, a mesma de antes ou "sem loja"): o que não está nela não existe mesmo. */
let respondeu = false
/**
 * Rede de segurança de quem espera a loja do servidor (estado ou produto que a daqui não conhece): a espera dura a
 * conversa inteira (no 4G lento ela passa de 4 s; a leitura desiste em LIMITE_MS) e, se algo travar fora dela, para aqui.
 */
const PACIENCIA_MS = LIMITE_MS + 2000
let paciencia = false
const ouvintesConferida = new Set<() => void>()
const avisarConferida = () => ouvintesConferida.forEach((f) => f())
let avisarPrimeira: () => void = () => {}
/**
 * Resolve quando a primeira conversa com o servidor termina (deu certo ou não), já com a loja nova na tela: a planilha,
 * o estado do link da bio e os links diretos esperam ela.
 */
const primeira = new Promise<void>((ok) => {
  avisarPrimeira = () => {
    if (conferida) return
    conferida = true
    ok()
    avisarConferida()
  }
})
export const lojaPronta = () => primeira
/** A primeira conversa com o servidor já terminou (ou aqui não tem servidor). */
export const lojaConferida = () => conferida
/**
 * O servidor respondeu com a loja (ou aqui não tem servidor, e a daqui é a loja toda). Falso depois da conversa = fora
 * do ar, lento demais ou resposta torta: o que não está na loja daqui pode existir lá.
 */
export const lojaDoServidorRespondeu = () => respondeu || semServidorAqui()
/** Espera a primeira conversa com o servidor por no máximo `ms`: quem depende dela não fica preso num servidor lento. */
export function esperarLoja(ms: number): Promise<void> {
  if (conferida) return Promise.resolve()
  return Promise.race([primeira, new Promise<void>((ok) => setTimeout(ok, ms))])
}
/**
 * Espera a primeira conversa com o servidor até ela terminar (a leitura desiste sozinha em LIMITE_MS), com a rede de
 * segurança de PACIENCIA_MS: pra quem não tem o que mostrar sem ela (o link de um produto que a loja daqui não tem).
 */
export const esperarLojaToda = () => esperarLoja(PACIENCIA_MS)

function assinarConferida(f: () => void) {
  ouvintesConferida.add(f)
  return () => ouvintesConferida.delete(f)
}
/** A primeira conversa com o servidor já terminou (assina: redesenha quando termina). */
export function useLojaConferida(): boolean {
  return useSyncExternalStore(assinarConferida, () => conferida || paciencia, () => true)
}
/**
 * O estado escolhido ainda não está na loja daqui e a do servidor ainda não chegou (estado ativado no painel, com a
 * loja guardada de antes ou de outro build): a tela espera enquanto a conversa com o servidor durar, sem dizer "ainda
 * não chegou aí" (o "sem atendimento" só aparece quando a resposta chega sem o estado ou quando o pedido falha).
 */
export function useEsperandoLoja(uf: string | null | undefined): boolean {
  const pronta = useSyncExternalStore(assinarConferida, () => conferida || paciencia, () => true)
  const conhece = useLoja((s) => !!uf && s.canais.some((c) => c.uf === uf.toLowerCase()))
  return !!uf && !conhece && !pronta
}

/** Pergunta a loja ao servidor e troca se veio outra. Nunca joga erro: sem resposta boa, fica tudo como está. */
export function buscarLoja(): Promise<void> {
  if (buscando) return buscando
  buscando = (async () => {
    if (semServidorAqui()) return
    await perguntar()
    // sem loja nova do servidor (fora do ar, resposta torta): a guardada por outro build, conferida agora, entra no
    // lugar da embutida
    if (paraConferir) await conferirGuardada()
  })().finally(() => {
    buscando = null
    avisarPrimeira()
  })
  return buscando
}

/** Uma conversa com o servidor: troca a loja quando chega uma versão nova que fecha. */
async function perguntar(): Promise<void> {
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
    if (!ehObjeto(d)) return
    // o servidor existe e ainda não tem loja (painel não instalado): a embutida, que é a mesma da semente
    if (r.status === 404 && d.ok === false && d.erro === 'sem-loja') {
      respondeu = true
      apagar(CHAVE)
      paraConferir = null
      if (useLoja.getState().fonte !== 'embutida') await aplicar(EMBUTIDA, 'embutida', null, null)
      return
    }
    if (!r.ok || d.ok !== true) return
    const versao = typeof d.versao === 'number' && Number.isFinite(d.versao) ? d.versao : null
    const atualizadoEm = typeof d.atualizadoEm === 'string' && Number.isFinite(Date.parse(d.atualizadoEm)) ? d.atualizadoEm : null
    if (versao == null || !atualizadoEm) return
    const s = useLoja.getState()
    // a mesma versão que já tá na tela (o 304 de sempre): nada muda
    if (s.fonte !== 'embutida' && s.versao === versao && s.atualizadoEm === atualizadoEm) {
      respondeu = true
      if (s.fonte !== 'servidor') useLoja.setState({ fonte: 'servidor' })
      return
    }
    const { lerLoja } = await import('./loja-ler')
    const loja = lerLoja(d.loja, EMBUTIDA, MAX_STORY)
    if (!loja) return
    paraConferir = null
    guardar(d.loja, loja, versao, atualizadoEm)
    await aplicar(loja, 'servidor', versao, atualizadoEm)
    respondeu = true
  } catch {
    /* fora do ar, tempo esgotado: fica com o que tem */
  } finally {
    clearTimeout(t)
  }
}

/**
 * A guardada por outro build (ou no formato velho), conferida com as regras deste: entra na tela (o que não mudou fica
 * o mesmo objeto) e fica guardada. Se a loja do servidor já entrou, ela vale mais.
 */
async function conferirGuardada(): Promise<void> {
  const g = paraConferir
  paraConferir = null
  if (!g) return
  try {
    const { lerLoja } = await import('./loja-ler')
    const loja = lerLoja(g.crua, EMBUTIDA, MAX_STORY)
    if (!loja) {
      // a guardada não fecha com as regras deste build: esquece ela (a embutida fica até o servidor responder)
      apagar(CHAVE)
      if (useLoja.getState().fonte === 'aparelho') await aplicar(EMBUTIDA, 'embutida', null, null)
      return
    }
    if (useLoja.getState().fonte === 'servidor') return
    guardar(g.crua, loja, g.versao, g.atualizadoEm)
    await aplicar(loja, 'aparelho', g.versao, g.atualizadoEm)
  } catch {
    /* o pedaço não baixou: segue com o que tem */
  }
}

/** Troca a loja de uma vez, num respiro do navegador (nunca no meio de um quadro de animação). Resolve já trocada. */
function aplicar(l: Loja, fonte: FonteLoja, versao: number | null, atualizadoEm: string | null): Promise<void> {
  return new Promise((ok) => {
    const trocar = () => {
      useLoja.setState((s) => estadoDe(l, fonte, versao, atualizadoEm, s), true)
      ok()
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(trocar, { timeout: 800 })
    else setTimeout(trocar, 0)
  })
}

/**
 * Começa a conversa com o servidor: no primeiro respiro depois da primeira pintura (nunca na frente dela) e, depois,
 * quando a pessoa volta pra aba depois de um tempo fora (o celular que deixa o site aberto por dias). Sem o pedido
 * aberto: o pedido montado não muda debaixo da pessoa. `ufPedida` (o ?uf= do link da bio ou a escolha salva) que a
 * loja daqui não conhece é estado ativado no painel depois da última visita; `produtosPedidos` (o ?p= e o ?produto= de
 * um link direto) que ela não tem é produto criado no painel depois da última visita (o link que o dono posta no
 * Instagram): nos dois casos pergunta na hora, sem esperar o respiro.
 */
export function iniciarLoja({
  pedidoAberto = () => false,
  ufPedida = null,
  produtosPedidos = [],
}: { pedidoAberto?: () => boolean; ufPedida?: string | null; produtosPedidos?: readonly (string | null | undefined)[] } = {}): void {
  if (typeof window === 'undefined' || semServidorAqui()) {
    avisarPrimeira()
    return
  }
  setTimeout(() => {
    paciencia = true
    avisarConferida()
  }, PACIENCIA_MS)
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const u = ufPedida?.toLowerCase()
  const daqui = useLoja.getState()
  const ufNova = !!u && !daqui.canais.some((c) => c.uf === u)
  const produtoNovo = produtosPedidos.some((id) => !!id && !daqui.produtos.some((p) => p.id === id))
  if (ufNova || produtoNovo) void buscarLoja()
  else if (w.requestIdleCallback) w.requestIdleCallback(() => void buscarLoja(), { timeout: 2500 })
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

/** A rua do mercador no celular (1º story na home, fim do Início na Home 2), ligada ou não pelo dono (`ruaNoStory`). */
export const useRuaNoCelular = () => useLoja((s) => s.ruaNoStory)

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
