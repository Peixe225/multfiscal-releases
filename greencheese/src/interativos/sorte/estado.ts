// Estado do "Teste minha sorte" visto de fora do jogo (destaque, lateral, adesivo do feed, sacola).
// Hook leve: fica no pedaço principal; o jogo em si (JogoSorte) só baixa quando a camada abre.
import { useMemo } from 'react'
import { config } from '../../dados/config'
import { canalDa } from '../../dados/canais'
import type { Premio } from '../../dados/sorte'
import { formatarAte, formatarEspera, formatarFalta, premioPorId, diasEntre } from '../../lib/cupom'
import { depoisDoHistorico } from '../../lib/historico'
import { primeiroNome, useAgora, useConta, useCupons, useGiro, usePendente, useVisto, type CupomComStatus, type GiroInfo } from '../../lib/conta'
import type { Conta, Pendente } from '../../store/conta'
import { useLocal } from '../../store/local'
import { useSacola } from '../../store/sacola'
import { useUI } from '../../store/ui'
import type { EntradaInterativo } from '../registro'
import { T } from './textos'

export const ID_SORTE = 'sorte'

/**
 * A: sem conta, nunca girou · B: sem conta, prêmio reservado · C: sem conta, já girou (hoje / antes) e sem prêmio
 * reservado · D: com conta e giro liberado · E: com conta e já girou hoje (E1: tem cupom que vence hoje ou amanhã).
 */
export type EstadoSorte = 'A' | 'B' | 'C-hoje' | 'C-antes' | 'D' | 'E' | 'E1'

export interface ResumoSorte {
  estado: EstadoSorte
  conta: Conta | null
  giro: GiroInfo
  pendente: Pendente | null
  pendenteValido: boolean
  pendenteVencido: boolean
  /** Prêmio reservado (sem conta), quando ainda vale. */
  premioPendente: Premio | undefined
  ativos: CupomComStatus[]
  todos: CupomComStatus[]
  /** Cupom ativo que vence hoje ou amanhã (E1). */
  vencendo: CupomComStatus | null
  /** Cupom ganho hoje (tela de espera). */
  deHoje: CupomComStatus | null
  agora: number
}

export function useEstadoSorte(): ResumoSorte {
  const conta = useConta()
  const giro = useGiro(ID_SORTE)
  const { pendente, valido, vencido } = usePendente(ID_SORTE)
  const todos = useCupons()
  const agora = useAgora()
  return useMemo(() => {
    const ativos = todos.filter((c) => c.status === 'ativo' && c.interativo === ID_SORTE)
    const vencendo = ativos.find((c) => diasEntre(agora, c.validoAte) <= 1) ?? null
    const deHoje = [...todos].filter((c) => c.interativo === ID_SORTE && diasEntre(c.ganhoEm, agora) === 0).sort((a, b) => b.ganhoEm - a.ganhoEm)[0] ?? null
    let estado: EstadoSorte
    if (!conta) estado = valido ? 'B' : giro.disponivel ? 'A' : giro.motivo === 'sem-conta-ja-girou' && giro.girouHoje ? 'C-hoje' : 'C-antes'
    else if (giro.disponivel) estado = 'D'
    else estado = vencendo ? 'E1' : 'E'
    return {
      estado,
      conta,
      giro,
      pendente,
      pendenteValido: valido,
      pendenteVencido: vencido,
      premioPendente: valido ? premioPorId(pendente?.premioId) : undefined,
      ativos,
      todos,
      vencendo,
      deHoje,
      agora,
    }
  }, [conta, giro, pendente, valido, vencido, todos, agora])
}

/** Aplica o cupom e abre a sacola (o adesivo e a conta usam). Com uma camada fechando, espera o histórico. */
export function usarNoPedido(codigo: string) {
  useSacola.getState().aplicarCupom(codigo)
  useUI.getState().avisar(T.cupomAplicado(codigo))
  depoisDoHistorico(() => useUI.getState().setSacola(true))
}

const ARIA: Record<EstadoSorte, string> = {
  A: 'Teste minha sorte: gira o dichavador, todo giro ganha',
  B: 'Teste minha sorte: teu prêmio tá guardado aqui',
  'C-hoje': 'Teste minha sorte: cria tua conta pra girar de novo',
  'C-antes': 'Teste minha sorte: cria tua conta pra girar de novo',
  D: 'Teste minha sorte: giro de hoje liberado',
  E: 'Teste minha sorte: próximo giro amanhã',
  E1: 'Teste minha sorte: próximo giro amanhã',
}

/** Entrada do "Teste minha sorte" no registro (destaque, lateral, adesivo). */
export function useEntradaSorte(): EntradaInterativo {
  const r = useEstadoSorte()
  const visto = useVisto(ID_SORTE)
  const uf = useLocal((s) => s.uf)
  const instagram = canalDa(uf)?.instagram ?? null
  return useMemo(() => {
    const { estado, conta, agora } = r
    const aceso = estado === 'A' || estado === 'B' || estado === 'D'
    const abrir = (tela?: 'cadastro' | 'entrar') => useUI.getState().abrirInterativo(ID_SORTE, tela)
    let adesivo: EntradaInterativo['adesivo']
    switch (estado) {
      case 'A':
        adesivo = { pergunta: T.pergunta, titulo: T.tituloPx, texto: 'Gira o dichavador. Sai um beck bolado com cupom dentro.', cta: 'Testar minha sorte', legenda: T.todoGiroGanha, acao: () => abrir() }
        break
      case 'B':
        adesivo = {
          titulo: T.tituloPx,
          pergunta: `Teu prêmio tá guardado aqui até ${formatarAte(r.pendente?.expiraEm ?? agora, agora)}`,
          texto: r.premioPendente?.titulo,
          cta: T.guardar,
          acao: () => abrir('cadastro'),
        }
        break
      case 'C-hoje':
      case 'C-antes':
        adesivo = { titulo: T.tituloPx, pergunta: T.giroJaFoi, texto: estado === 'C-hoje' ? T.criaAmanha : T.criaAgora, cta: T.criarConta, acao: () => abrir('cadastro') }
        break
      case 'D':
        adesivo = { titulo: T.tituloPx, pergunta: `${primeiroNome(conta?.nome)}, teu giro de hoje tá liberado`, cta: T.girar, legenda: T.todoGiroGanha, acao: () => abrir() }
        break
      case 'E1': {
        const c = r.vencendo!
        adesivo = { titulo: T.tituloPx, pergunta: `Teu cupom ${c.codigo} ${formatarFalta(c.validoAte, agora)}`, texto: c.retrato.titulo, cta: T.usarNoPedido, acao: () => usarNoPedido(c.codigo) }
        break
      }
      case 'E': {
        const espera = r.giro.disponivel === false && r.giro.motivo === 'ja-girou-hoje' ? formatarEspera(r.giro.proximoEm - agora, true) : 'amanhã'
        const n = r.ativos.length
        adesivo = {
          titulo: T.tituloPx,
          pergunta: `Hoje já foi. Próximo giro ${espera}.`,
          texto: n ? `${n} ${n === 1 ? 'cupom guardado' : 'cupons guardados'}` : undefined,
          cta: T.verCupons,
          acao: () => useUI.getState().setConta(true),
        }
        break
      }
    }
    return {
      aceso,
      ponto: aceso,
      novo: !visto,
      rotulo: estado === 'B' ? T.curtoPremio : T.curto,
      aria: ARIA[estado],
      instagram,
      exemplo: config.modoPrevia,
      adesivo,
    }
  }, [r, visto, instagram])
}
