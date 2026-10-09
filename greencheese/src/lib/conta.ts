import { useMemo, useSyncExternalStore } from 'react'
import { regrasDaSorte } from '../store/loja'
import { useContaStore, type Conta, type Cupom, type EstadoConta, type Pendente } from '../store/conta'
import { diaSP, inicioDoDiaSeguinteSP, premioPorId, statusDo, type StatusCupom } from './cupom'

// Conta do cliente atrás de uma interface (AdaptadorConta). Divisão do trabalho:
// - ESCREVER é só com o adaptador (src/lib/conta-adaptador.ts): criar, entrar, girar, guardar, usar… Hoje vale o
//   adaptador local (prévia: conta, cupons e limite só neste aparelho, sem rede). Na versão oficial entra o do
//   servidor (PHP + MySQL na Hostinger) com os mesmos métodos: quem sorteia, gera o código e valida o limite é o
//   servidor. Por isso todos os métodos são async, mesmo os locais.
// - LER é com os hooks daqui, que leem o store 'gc-conta' (src/store/conta.ts). Esse store é o CACHE da conta no
//   aparelho: na prévia ele é a própria fonte; na versão oficial o adaptador do servidor grava nele o que a API
//   devolve a cada chamada (conta, cupons, dias de giro e prêmio reservado). As telas não leem o store direto.
// Este arquivo fica no pedaço principal (as entradas do site usam os hooks); o adaptador baixa só com o jogo e a conta.

export type Resultado<T, E extends string> = { ok: true; valor: T } | { ok: false; erro: E }

export type GiroInfo =
  | { disponivel: true }
  | { disponivel: false; motivo: 'sem-conta-ja-girou'; girouHoje: boolean }
  | { disponivel: false; motivo: 'ja-girou-hoje'; proximoEm: number }

/** Conta aberta e o cupom que foi guardado nessa hora (prêmio reservado sem conta), se teve. */
export interface ContaAberta {
  conta: Conta
  cupomGuardado: Cupom | null
}

export interface AdaptadorConta {
  modo: 'local' | 'servidor'
  /** Cria e abre a conta; guarda na hora o prêmio reservado, se ainda vale. */
  criar(d: { nome: string; whatsapp: string; aceitaPromo: boolean }): Promise<Resultado<ContaAberta, 'whatsapp-existe' | 'invalido' | 'sem-armazenamento'>>
  /**
   * Entrar, passo 1: pede o código de confirmação pelo WhatsApp. `enviado: false` = não precisa de código
   * (adaptador local: a conta só existe neste aparelho) e a tela vai direto pro passo 2 sem pedir nada.
   */
  pedirCodigo(whatsapp: string): Promise<Resultado<{ enviado: boolean }, 'nao-encontrada' | 'muitas-tentativas'>>
  /** Entrar, passo 2: confere o código (o local ignora) e abre a conta; guarda o prêmio reservado, se ainda vale. */
  confirmarCodigo(whatsapp: string, codigo: string | null): Promise<Resultado<ContaAberta, 'nao-encontrada' | 'codigo-errado'>>
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

export function contaAtual(s: EstadoConta): { conta: Conta; cupons: Cupom[] } | null {
  return s.atual ? (s.contas[s.atual] ?? null) : null
}

/**
 * Giro liberado? O limite é do APARELHO: sair, apagar ou criar outra conta não dá giro novo. Roda sobre o cache
 * (os dias de giro): na versão oficial o servidor recusa o giro de qualquer jeito, e o adaptador grava no cache os
 * dias que ele devolve, então a tela continua certa.
 */
export function calcularGiro(s: EstadoConta, interativo: string, agora: number): GiroInfo {
  const dias = s.giros[interativo] ?? []
  const hoje = diaSP(agora)
  if (!contaAtual(s)) {
    if (dias.length >= regrasDaSorte().girosSemConta) return { disponivel: false, motivo: 'sem-conta-ja-girou', girouHoje: dias.includes(hoje) }
    return { disponivel: true }
  }
  // girou sem conta hoje e criou conta hoje: o giro de hoje já foi (próximo amanhã)
  if (dias.filter((d) => d === hoje).length >= regrasDaSorte().girosPorDiaComConta) return { disponivel: false, motivo: 'ja-girou-hoje', proximoEm: inicioDoDiaSeguinteSP(agora) }
  return { disponivel: true }
}

export function pendenteValido(p: Pendente | null, interativo: string, agora: number): boolean {
  return !!p && p.interativo === interativo && agora < p.expiraEm && !!premioPorId(p.premioId)
}

/** Marca o interativo como já aberto neste aparelho (some o selo "novo"). Não é conta: é do aparelho. */
export function marcarVisto(interativo: string) {
  if (useContaStore.getState().vistos.includes(interativo)) return
  useContaStore.setState((s) => ({ vistos: [...s.vistos, interativo] }))
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

/* ───────────────────────── hooks (só leem o cache) ───────────────────────── */

export function useConta(): Conta | null {
  return useContaStore((s) => (s.atual ? (s.contas[s.atual]?.conta ?? null) : null))
}

export type CupomComStatus = Cupom & { status: StatusCupom }

const ORDEM: Record<StatusCupom, number> = { ativo: 0, usado: 1, vencido: 2, encerrado: 3 }
export const SEM_CUPONS: Cupom[] = []

/** Cupons da conta aberta (sem status), para quem precisa só da lista. */
export function useCuponsDaConta(): Cupom[] {
  return useContaStore((s) => (s.atual ? (s.contas[s.atual]?.cupons ?? SEM_CUPONS) : SEM_CUPONS))
}

/** Cupons da conta aberta com o status, na ordem: ativos (vence antes primeiro), usados, vencidos, encerrados. */
export function useCupons(): CupomComStatus[] {
  const cupons = useCuponsDaConta()
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

/** Primeiro nome, para "Fechou, Ian." */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}
