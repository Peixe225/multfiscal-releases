/**
 * Liga o bônus de OVR e o compartilhar do jogo à conta (src/store/bonusCarreira.ts e src/store/compartilhar.ts),
 * e guarda o código de convite de quem trouxe o visitante (?c=).
 *
 *   iniciarPontes()   // uma vez (vigias)
 */
import { ArrowRight } from 'lucide-react'
import { useBonusCarreira } from '@/store/bonusCarreira'
import { pontes } from '@/store/compartilhar'
import { toast } from '@/ui/primitives'
import { ErroApi, valeTentar } from './api'
import { proximoBonus, ROTULO_ORIGEM, textoFaltam, useBonus, usarBonus } from './bonus'
import { aoEntrar, useConta } from './conta'
import { capturarConvite, enderecoDoJogo, limparConviteDaUrl, linkConvite } from './indicacao'
import { armazem } from './medicao'
import { track } from './medicao'
import { abrirConta } from './ui'

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))
const CHAVE_PENDENTE = 'lenda:compartilhei-pendente'
/** Um compartilhamento que não foi registrado (sem rede) ainda vale tentar por este tempo. */
const PENDENTE_MS = 12 * 3600_000

function oferta() {
  const d = useBonus.getState().dados
  const b = proximoBonus(d)
  useBonusCarreira.setState({ oferta: b ? { valor: b.valor, origem: ROTULO_ORIGEM[b.origem], depois: Math.max(0, (d?.disponiveis.length ?? 1) - 1) } : null })
}

async function registrar(carreiraId: string) {
  try {
    const r = await useBonus.getState().compartilhei(carreiraId)
    ls.set(CHAVE_PENDENTE, '')
    if (r.ganhou > 0) {
      toast.gold(`+${r.ganhou} de OVR na próxima carreira!`, 'Obrigado por levar o LENDA para mais gente.', { key: 'bonus-compartilhar' })
      void useBonus.getState().carregar(true).then(oferta)
    } else if (r.motivo === 'ja_hoje') {
      toast.info('O bônus de hoje já é seu', 'Compartilhar o card dá bônus de OVR uma vez por dia. Volte amanhã!', { key: 'bonus-compartilhar' })
    } else if (r.motivo === 'bloqueado') {
      const d = await useBonus.getState().carregar(true)
      toast.info('Bônus de compartilhar ainda bloqueado', d && d.faltamPartidas > 0 ? `Ele libera depois de algumas partidas com a conta: ${textoFaltam(d.faltamPartidas)}.` : 'Ele libera depois das primeiras partidas com a conta.', { key: 'bonus-compartilhar' })
    }
  } catch (err) {
    if (err instanceof ErroApi && err.status === 401) {
      useConta.getState().sessaoExpirou()
      return
    }
    // sem rede: fica guardado e tenta de novo quando a internet voltar (ou na próxima abertura)
    if (valeTentar(err)) ls.set(CHAVE_PENDENTE, JSON.stringify({ carreiraId, em: Date.now() }))
  }
}

function pendente(): { carreiraId: string; em: number } | null {
  try {
    const j = JSON.parse(ls.get(CHAVE_PENDENTE) || 'null') as { carreiraId?: unknown; em?: unknown } | null
    if (!j || typeof j.carreiraId !== 'string' || typeof j.em !== 'number' || Date.now() - j.em > PENDENTE_MS) return null
    return { carreiraId: j.carreiraId, em: j.em }
  } catch {
    return null
  }
}

let avisouSemConta = false

let iniciado = false
export function iniciarPontes() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true

  // ?c=<codigo>: guarda por 30 dias (vai no cadastro) e tira da barra de endereço
  if (capturarConvite(location.search, ls)) limparConviteDaUrl()

  useBonusCarreira.setState({
    carregar: () => {
      if (!useConta.getState().usuario) return useBonusCarreira.setState({ oferta: null })
      void useBonus.getState().carregar().then(oferta)
    },
    consumir: async (carreiraId) => {
      const valor = await usarBonus(carreiraId)
      // o bônus usado sai da lista; o próximo (se houver) aparece na próxima carreira
      void useBonus.getState().carregar(true).then(oferta)
      return valor
    },
  })

  pontes.compartilhar = {
    link: () => {
      const d = useBonus.getState().dados
      const codigo = d?.codigoConvite ?? useConta.getState().usuario?.codigoConvite
      return d?.linkConvite ?? (codigo ? linkConvite(codigo) : enderecoDoJogo())
    },
    preparar: () => {
      if (useConta.getState().usuario) void useBonus.getState().carregar()
    },
    compartilhou: (carreiraId, como) => {
      track('compartilhar', null, { acao: como === 'share' ? 'card_ok' : 'link_ok', rota: '/resumo' })
      if (!useConta.getState().usuario) {
        if (avisouSemConta) return
        avisouSemConta = true
        toast.info('Ganhe bônus de OVR compartilhando', 'Com uma conta, o card compartilhado dá +2 de OVR na próxima carreira (1x por dia).', {
          action: { label: 'Criar conta', icon: ArrowRight, onClick: () => abrirConta({ modo: 'manual', aba: 'criar' }) },
        })
        return
      }
      void registrar(carreiraId)
    },
  }

  // conta entrou/saiu: o bônus da tela de criação acompanha (e um compartilhamento sem rede tenta de novo)
  aoEntrar(() => {
    useBonus.getState().limpar()
    useBonusCarreira.setState({ usar: true })
    void useBonus.getState().carregar(true).then(oferta)
    const p = pendente()
    if (p) void registrar(p.carreiraId)
  })
  useConta.subscribe((s, p) => {
    if (p.usuario && !s.usuario) {
      useBonus.getState().limpar()
      useBonusCarreira.setState({ oferta: null })
    }
  })
  window.addEventListener('online', () => {
    const p = pendente()
    if (p && useConta.getState().usuario) void registrar(p.carreiraId)
  })
}
