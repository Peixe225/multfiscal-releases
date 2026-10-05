import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { configConta } from '../dados/conta'
import { regrasSorte } from '../dados/sorte'
import { useContaStore, type Conta, type Cupom, type EstadoConta, type Pendente } from '../store/conta'
import { useLinhasSacola } from '../store/derivados'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import {
  diaSP,
  fimDoDiaSP,
  gerarCodigo,
  inicioDoDiaSeguinteSP,
  premioPorId,
  premiosElegiveis,
  retratoDe,
  situacaoNoPedido,
  sortear,
  statusDo,
  type Situacao,
  type StatusCupom,
} from './cupom'
import { celularParaGuardar } from './telefone'

// Conta do cliente atrás de uma interface: a interface só conhece AdaptadorConta e os hooks daqui.
// Hoje (prévia) vale o adaptador local: conta, cupons e limite de giros só neste aparelho, sem rede.
// Na versão oficial entra um adaptador do servidor (PHP + MySQL na Hostinger) com os mesmos métodos: quem sorteia,
// gera o código e valida o limite é o servidor. Por isso todos os métodos são async, mesmo os locais.

export type Resultado<T, E extends string> = { ok: true; valor: T } | { ok: false; erro: E }

export type GiroInfo =
  | { disponivel: true }
  | { disponivel: false; motivo: 'sem-conta-ja-girou'; girouHoje: boolean }
  | { disponivel: false; motivo: 'ja-girou-hoje'; proximoEm: number }

export interface AdaptadorConta {
  modo: 'local' | 'servidor'
  criar(d: { nome: string; whatsapp: string; aceitaPromo: boolean }): Promise<Resultado<Conta, 'whatsapp-existe' | 'invalido' | 'sem-armazenamento'>>
  entrar(whatsapp: string): Promise<Resultado<Conta, 'nao-encontrada'>>
  sair(): Promise<void>
  /** LGPD: apaga a conta e os cupons deste aparelho (o giro de hoje continua usado). */
  apagar(): Promise<void>
  atualizar(d: Partial<Pick<Conta, 'nome' | 'whatsapp' | 'aceitaPromo'>>): Promise<Resultado<Conta, 'whatsapp-existe' | 'invalido'>>
  giroDisponivel(interativo: string): Promise<GiroInfo>
  girar(interativo: string, ctx: { uf: string | null }): Promise<Resultado<{ premioId: string; cupom: Cupom | null }, 'sem-giro' | 'sem-premio'>>
  salvarCupom(interativo: string): Promise<Resultado<Cupom, 'sem-conta' | 'sem-pendente' | 'pendente-vencido'>>
  usarCupom(codigo: string): Promise<Resultado<Cupom, 'nao-encontrado' | 'ja-usado' | 'vencido'>>
}

/* ───────────────────────── armazenamento ───────────────────────── */

/** O navegador deixa guardar? (aba anônima do Safari antigo, navegador do Instagram com dados bloqueados…) */
export const armazenamentoOk: boolean = (() => {
  try {
    localStorage.setItem('gc-teste', '1')
    localStorage.removeItem('gc-teste')
    return true
  } catch {
    return false
  }
})()

// outra aba mexeu na conta (girou, guardou, saiu): relê
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'gc-conta') void useContaStore.persist.rehydrate()
  })
}

/* ───────────────────────── regras puras (servem ao adaptador e aos hooks) ───────────────────────── */

const H24 = regrasSorte.reservaSemContaHoras * 3600 * 1000

function contaAtual(s: EstadoConta): { conta: Conta; cupons: Cupom[] } | null {
  return s.atual ? (s.contas[s.atual] ?? null) : null
}

/** Giro liberado? O limite é do APARELHO: sair, apagar ou criar outra conta não dá giro novo. */
export function calcularGiro(s: EstadoConta, interativo: string, agora: number): GiroInfo {
  const dias = s.giros[interativo] ?? []
  const hoje = diaSP(agora)
  if (!contaAtual(s)) {
    if (dias.length >= regrasSorte.girosSemConta) return { disponivel: false, motivo: 'sem-conta-ja-girou', girouHoje: dias.includes(hoje) }
    return { disponivel: true }
  }
  // girou sem conta hoje e criou conta hoje: o giro de hoje já foi (próximo amanhã)
  if (dias.filter((d) => d === hoje).length >= regrasSorte.girosPorDiaComConta) return { disponivel: false, motivo: 'ja-girou-hoje', proximoEm: inicioDoDiaSeguinteSP(agora) }
  return { disponivel: true }
}

function pendenteValido(p: Pendente | null, interativo: string, agora: number): boolean {
  return !!p && p.interativo === interativo && agora < p.expiraEm && !!premioPorId(p.premioId)
}

function codigosDoAparelho(s: EstadoConta): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(s.contas)) for (const k of c.cupons) out.add(k.codigo)
  return out
}

function novoId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* reserva abaixo */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** Cria o cupom do prêmio na conta aberta (o código nasce aqui). */
function criarCupom(s: EstadoConta, interativo: string, premioId: string, agora: number): Cupom | null {
  const p = premioPorId(premioId)
  if (!p) return null
  return {
    codigo: gerarCodigo(regrasSorte.prefixo, codigosDoAparelho(s)),
    interativo,
    premioId,
    retrato: retratoDe(p),
    demo: p.demo,
    ganhoEm: agora,
    validoAte: fimDoDiaSP(agora, p.validadeDias),
  }
}

/* ───────────────────────── adaptador local (prévia) ───────────────────────── */

const st = () => useContaStore.getState()
const gravar = (parcial: Partial<EstadoConta> | ((s: EstadoConta) => Partial<EstadoConta>)) => useContaStore.setState(parcial)

/** Relê o que está gravado (outra aba pode ter girado ou guardado). */
async function reler() {
  await useContaStore.persist.rehydrate()
}

/** Aplica um cupom na conta aberta (substitui pelo código). */
function trocarCupom(codigo: string, f: (c: Cupom) => Cupom) {
  gravar((s) => {
    const atual = contaAtual(s)
    if (!atual || !s.atual) return {}
    return { contas: { ...s.contas, [s.atual]: { ...atual, cupons: atual.cupons.map((c) => (c.codigo === codigo ? f(c) : c)) } } }
  })
}

export const contaLocal: AdaptadorConta = {
  modo: 'local',

  async criar(d) {
    if (!armazenamentoOk) return { ok: false, erro: 'sem-armazenamento' }
    await reler()
    const whatsapp = celularParaGuardar(d.whatsapp)
    const nome = nomeLimpo(d.nome)
    if (!whatsapp || nome.length < 2) return { ok: false, erro: 'invalido' }
    if (st().contas[whatsapp]) return { ok: false, erro: 'whatsapp-existe' }
    const agora = Date.now()
    const conta: Conta = {
      id: novoId(),
      nome,
      whatsapp,
      aceitaPromo: d.aceitaPromo,
      aceitaPromoEm: d.aceitaPromo ? agora : null,
      confirmou18Em: agora,
      criadaEm: agora,
    }
    gravar((s) => ({ contas: { ...s.contas, [whatsapp]: { conta, cupons: [] } }, atual: whatsapp }))
    await guardarPendente()
    return { ok: true, valor: conta }
  },

  async entrar(whatsappTexto) {
    await reler()
    const whatsapp = celularParaGuardar(whatsappTexto)
    const achada = whatsapp ? st().contas[whatsapp] : undefined
    if (!whatsapp || !achada) return { ok: false, erro: 'nao-encontrada' }
    gravar({ atual: whatsapp })
    await guardarPendente()
    return { ok: true, valor: achada.conta }
  },

  async sair() {
    gravar({ atual: null })
    useSacola.getState().tirarCupom()
  },

  async apagar() {
    gravar((s) => {
      if (!s.atual) return {}
      const contas = { ...s.contas }
      delete contas[s.atual]
      return { contas, atual: null }
    })
    useSacola.getState().tirarCupom()
  },

  async atualizar(d) {
    await reler()
    const s = st()
    const atual = contaAtual(s)
    if (!atual || !s.atual) return { ok: false, erro: 'invalido' }
    const nome = d.nome != null ? nomeLimpo(d.nome) : atual.conta.nome
    if (nome.length < 2) return { ok: false, erro: 'invalido' }
    const whatsapp = d.whatsapp != null ? celularParaGuardar(d.whatsapp) : atual.conta.whatsapp
    if (!whatsapp) return { ok: false, erro: 'invalido' }
    if (whatsapp !== s.atual && s.contas[whatsapp]) return { ok: false, erro: 'whatsapp-existe' }
    const aceita = d.aceitaPromo ?? atual.conta.aceitaPromo
    const conta: Conta = {
      ...atual.conta,
      nome,
      whatsapp,
      aceitaPromo: aceita,
      aceitaPromoEm: aceita ? (atual.conta.aceitaPromo ? atual.conta.aceitaPromoEm : Date.now()) : null,
    }
    const contas = { ...s.contas }
    delete contas[s.atual]
    contas[whatsapp] = { ...atual, conta }
    gravar({ contas, atual: whatsapp })
    return { ok: true, valor: conta }
  },

  async giroDisponivel(interativo) {
    await reler()
    return calcularGiro(st(), interativo, Date.now())
  },

  async girar(interativo, ctx) {
    // 1) relê e confere: duas abas não giram duas vezes
    await reler()
    const agora = Date.now()
    if (!calcularGiro(st(), interativo, agora).disponivel) return { ok: false, erro: 'sem-giro' }
    // 2) sorteia só entre os prêmios que valem no estado
    const premio = sortear(premiosElegiveis(ctx.uf))
    if (!premio) return { ok: false, erro: 'sem-premio' }
    // 3) grava o dia do giro (do aparelho)
    const hoje = diaSP(agora)
    gravar((s) => ({ giros: { ...s.giros, [interativo]: [...(s.giros[interativo] ?? []), hoje].slice(-30) } }))
    // 4) com conta, o cupom já nasce guardado; sem conta, fica reservado 24 h (sem código)
    const s = st()
    if (contaAtual(s) && s.atual) {
      const cupom = criarCupom(s, interativo, premio.id, agora)
      if (cupom) {
        const conta = s.atual
        gravar((x) => ({ contas: { ...x.contas, [conta]: { ...x.contas[conta], cupons: [...x.contas[conta].cupons, cupom] } }, pendente: null }))
      }
      return { ok: true, valor: { premioId: premio.id, cupom } }
    }
    gravar({ pendente: { interativo, premioId: premio.id, sorteadoEm: agora, expiraEm: agora + H24 } })
    return { ok: true, valor: { premioId: premio.id, cupom: null } }
  },

  async salvarCupom(interativo) {
    await reler()
    const s = st()
    const agora = Date.now()
    if (!contaAtual(s) || !s.atual) return { ok: false, erro: 'sem-conta' }
    const p = s.pendente
    if (!p || p.interativo !== interativo) return { ok: false, erro: 'sem-pendente' }
    if (agora >= p.expiraEm) return { ok: false, erro: 'pendente-vencido' }
    const cupom = criarCupom(s, interativo, p.premioId, agora)
    if (!cupom) return { ok: false, erro: 'sem-pendente' }
    const conta = s.atual
    gravar((x) => ({ contas: { ...x.contas, [conta]: { ...x.contas[conta], cupons: [...x.contas[conta].cupons, cupom] } }, pendente: null }))
    return { ok: true, valor: cupom }
  },

  async usarCupom(codigo) {
    await reler()
    const atual = contaAtual(st())
    const c = atual?.cupons.find((x) => x.codigo === codigo)
    if (!c) return { ok: false, erro: 'nao-encontrado' }
    if (c.usadoEm) return { ok: false, erro: 'ja-usado' }
    const agora = Date.now()
    if (statusDo(c, agora) !== 'ativo') return { ok: false, erro: 'vencido' }
    const usado = { ...c, usadoEm: agora }
    trocarCupom(codigo, () => usado)
    return { ok: true, valor: usado }
  },
}

/** Criou conta ou entrou com prêmio reservado e ainda válido: guarda na hora. */
async function guardarPendente() {
  const p = st().pendente
  if (p && pendenteValido(p, p.interativo, Date.now())) await contaLocal.salvarCupom(p.interativo)
}

/**
 * O adaptador em uso. Na versão oficial, configConta.modo = 'servidor' liga o adaptador da API da loja (mesmos métodos;
 * descrito no PENDENCIAS.md). Enquanto ele não existe, segue o local.
 */
export const conta: AdaptadorConta = contaLocal
if (import.meta.env.DEV && configConta.modo !== conta.modo) console.warn('[conta] o adaptador do servidor ainda não existe: segue o local')

/** Marca o interativo como já aberto neste aparelho (some o selo "novo"). Não é conta: é do aparelho. */
export function marcarVisto(interativo: string) {
  if (st().vistos.includes(interativo)) return
  gravar((s) => ({ vistos: [...s.vistos, interativo] }))
}

/* ───────────────────────── relógio compartilhado ───────────────────────── */

// Um relógio só para o site inteiro: avança a cada virada de minuto e quando a aba volta a ficar visível
// (o celular dormiu, a pessoa voltou do WhatsApp). Sem segundos na tela.
let agoraCache = Date.now()
const ouvintesRelogio = new Set<() => void>()
let timerRelogio = 0

function tique() {
  agoraCache = Date.now()
  ouvintesRelogio.forEach((f) => f())
}
function agendar() {
  clearTimeout(timerRelogio)
  timerRelogio = window.setTimeout(
    () => {
      tique()
      agendar()
    },
    60000 - (Date.now() % 60000) + 50,
  )
}
function aoVoltar() {
  if (document.visibilityState === 'visible') {
    tique()
    agendar()
  }
}
function assinarRelogio(f: () => void) {
  ouvintesRelogio.add(f)
  if (ouvintesRelogio.size === 1) {
    agoraCache = Date.now()
    agendar()
    document.addEventListener('visibilitychange', aoVoltar)
  }
  return () => {
    ouvintesRelogio.delete(f)
    if (!ouvintesRelogio.size) {
      clearTimeout(timerRelogio)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }
}

/** Agora em ms, atualizado a cada minuto e no visibilitychange. */
export function useAgora(): number {
  return useSyncExternalStore(assinarRelogio, () => agoraCache, () => agoraCache)
}

/* ───────────────────────── hooks (só leem) ───────────────────────── */

export function useConta(): Conta | null {
  return useContaStore((s) => (s.atual ? (s.contas[s.atual]?.conta ?? null) : null))
}

export type CupomComStatus = Cupom & { status: StatusCupom }

const ORDEM: Record<StatusCupom, number> = { ativo: 0, usado: 1, vencido: 2, encerrado: 3 }
const SEM_CUPONS: Cupom[] = []

/** Cupons da conta aberta com o status, na ordem: ativos (vence antes primeiro), usados, vencidos, encerrados. */
export function useCupons(): CupomComStatus[] {
  const cupons = useContaStore((s) => (s.atual ? (s.contas[s.atual]?.cupons ?? SEM_CUPONS) : SEM_CUPONS))
  const agora = useAgora()
  return useMemo(
    () =>
      cupons
        .map((c) => ({ ...c, status: statusDo(c, agora) }))
        .sort((a, b) => ORDEM[a.status] - ORDEM[b.status] || (a.status === 'ativo' ? a.validoAte - b.validoAte : (b.usadoEm ?? b.ganhoEm) - (a.usadoEm ?? a.ganhoEm))),
    [cupons, agora],
  )
}

export function useGiro(interativo: string): GiroInfo {
  const giros = useContaStore((s) => s.giros)
  const temConta = useContaStore((s) => !!s.atual && !!s.contas[s.atual])
  const agora = useAgora()
  return useMemo(() => calcularGiro({ ...useContaStore.getState(), giros }, interativo, agora), [giros, temConta, agora, interativo])
}

export function usePendente(interativo: string): { pendente: Pendente | null; valido: boolean; vencido: boolean } {
  const pendente = useContaStore((s) => s.pendente)
  const agora = useAgora()
  return useMemo(() => {
    const doJogo = pendente && pendente.interativo === interativo ? pendente : null
    const valido = pendenteValido(doJogo, interativo, agora)
    return { pendente: doJogo, valido, vencido: !!doJogo && !valido }
  }, [pendente, agora, interativo])
}

export function useVisto(interativo: string): boolean {
  return useContaStore((s) => s.vistos.includes(interativo))
}

/** Cupom aplicado na sacola e a situação dele neste pedido. */
export function useCupomNoPedido(): { cupom: Cupom | null; situacao: Situacao | null } {
  const codigo = useSacola((s) => s.cupom)
  const cupons = useContaStore((s) => (s.atual ? (s.contas[s.atual]?.cupons ?? SEM_CUPONS) : SEM_CUPONS))
  const { todas } = useLinhasSacola()
  const uf = useLocal((s) => s.uf)
  const agora = useAgora()
  return useMemo(() => {
    const cupom = codigo ? (cupons.find((c) => c.codigo === codigo) ?? null) : null
    return { cupom, situacao: cupom ? situacaoNoPedido(cupom, todas, uf, agora) : null }
  }, [codigo, cupons, todas, uf, agora])
}

/**
 * O cupom aplicado ainda vale? Vencido, encerrado, usado ou fora da conta: sai da sacola com aviso.
 * Roda ao abrir a sacola, quando o pedido chega no resumo e quando a aba volta a ficar visível.
 */
export function conferirCupomAplicado(): void {
  const codigo = useSacola.getState().cupom
  if (!codigo) return
  const atual = contaAtual(st())
  const c = atual?.cupons.find((x) => x.codigo === codigo)
  const status = c ? statusDo(c, Date.now()) : null
  if (status === 'ativo') return
  useSacola.getState().tirarCupom()
  useUI.getState().avisar(status === 'vencido' ? `Teu cupom ${codigo} venceu e saiu do pedido.` : `Teu cupom ${codigo} não vale mais e saiu do pedido.`)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') conferirCupomAplicado()
  })
}

/** Liga a conferência do cupom aplicado enquanto `ativo` (sacola aberta, chat no resumo). */
export function useConferirCupom(ativo: boolean) {
  useEffect(() => {
    if (ativo) conferirCupomAplicado()
  }, [ativo])
}

/** Primeiro nome, para "Fechou, Ian." */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}
