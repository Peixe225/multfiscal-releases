/**
 * Liga o bônus de OVR e o compartilhar do jogo à conta (src/store/bonusCarreira.ts e src/store/compartilhar.ts), a
 * semente da carreira sorteada pelo servidor (src/store/sementeCarreira.ts, CONTRATO-v33 §E) e guarda o código de convite
 * de quem trouxe o visitante (?c=).
 *
 *   iniciarPontes()   // uma vez (vigias)
 */
import { ArrowRight } from 'lucide-react'
import { FalhaBonus, useBonusCarreira } from '@/store/bonusCarreira'
import { pontes } from '@/store/compartilhar'
import { ESPERA_SEMENTE_MS, useSementeCarreira } from '@/store/sementeCarreira'
import { toast } from '@/ui/primitives'
import { api, ErroApi, valeTentar } from './api'
import { proximoBonus, ROTULO_ORIGEM, textoFaltam, useBonus, usarBonus } from './bonus'
import { aoEntrar, useConta } from './conta'
import { capturarConvite, enderecoDoJogo, limparConviteDaUrl, linkConvite, linkPrevia } from './indicacao'
import { armazem } from './medicao'
import { track } from './medicao'
import { abrirConta } from './ui'
import { lembrarSementeDoServidor } from './provas'
import { useCarreiras } from './carreiras'
import { sementeDoPar } from '@/engine/replay'

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

/**
 * v3.4 §E: as carreiras que estão no Hall público AGORA. Só elas levam o link da prévia: o v.php só conhece a carreira da
 * fotografia do Hall, e logo depois de terminar (quando o jogador compartilha) ela ainda não está lá — o link da prévia saía
 * com o cartão genérico e levava para a tela inicial, e os robôs das redes guardavam esse cartão pela URL (dias). Fora do
 * Hall: o link de convite de sempre.
 */
const noHallPublico = new Map<string, boolean>()
const conferindoHall = new Set<string>()
/**
 * A lista da conta mais velha que isto é pedida de novo antes de decidir (a fotografia do Hall é refeita de tempos em tempos e
 * o `hall` do C de antes pode estar velho). Um pedido por card que aparece, no máximo.
 */
const LISTA_VELHA_MS = 5_000

/**
 * Confere se a carreira do card já está no Hall público; nada de esperar no clique: o link é na hora, com o que já se sabe.
 * `propria` = a carreira é do jogador (o card do resumo dele): decide o `hall` do C da conta (`no_hall` = na fotografia; a
 * lista é pedida de novo se tiver mais de 5 s). A de outro jogador (o resumo da comunidade) abriu pelo hall.php?id=: está no
 * Hall. Sem pedido ao hall.php (um 404 a cada card de carreira fora do Hall).
 */
export async function conferirNoHall(id: string, propria: boolean) {
  if (!id) return
  if (!propria) {
    noHallPublico.set(id, true)
    return
  }
  const estado = () => useCarreiras.getState().lista?.find((c) => c.id === id)?.hall?.estado
  if (estado() !== 'no_hall' && !conferindoHall.has(id)) {
    const s = useCarreiras.getState()
    if (!s.lista || Date.now() - s.carregadaEm > LISTA_VELHA_MS) {
      conferindoHall.add(id)
      try {
        await s.carregar(true)
      } catch {
        /* sem rede: fica o que já se sabia */
      } finally {
        conferindoHall.delete(id)
      }
    }
  }
  noHallPublico.set(id, estado() === 'no_hall')
}

/** Para os testes: esquece o que já conferiu. */
export const esquecerNoHall = () => noHallPublico.clear()

/** O link que vai no compartilhar: a prévia só com conta, código e a carreira já no Hall público; senão o de sempre. */
export function linkDoCompartilhar(o: { carreiraId?: string | null; codigo?: string | null; logado: boolean; linkConvite?: string | null }): string {
  if (o.carreiraId && o.codigo && o.logado && noHallPublico.get(o.carreiraId) === true) return linkPrevia({ id: o.carreiraId, codigo: o.codigo })
  return o.linkConvite ?? (o.codigo ? linkConvite(o.codigo) : enderecoDoJogo())
}

/** §E: [a0, a1] da resposta do servidor (dois inteiros de 32 bits) ou null. */
export function parDaResposta(x: unknown): [number, number] | null {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 0x1_0000_0000
  return Array.isArray(x) && x.length === 2 && ok(x[0]) && ok(x[1]) ? [x[0], x[1]] : null
}

/**
 * §E: pede ao servidor a semente da carreira do Clássico que começa agora (POST carreiras.php {acao: "semente"}). Sem conta:
 * null sem pedir nada. Sessão caída: o aviso de sempre. Sem rede, servidor antigo, limite do dia: null (a carreira começa com
 * a semente do aparelho e não vale para desafio).
 */
export async function pedirSementeCarreira(): Promise<[number, number] | null> {
  const u = useConta.getState().usuario
  if (!u) return null
  try {
    const r = await api<{ semente?: unknown }>('carreiras.php', { corpo: { acao: 'semente' }, tempo: ESPERA_SEMENTE_MS })
    const par = parDaResposta(r?.semente)
    // v3.4: o aparelho lembra que esta semente veio do servidor para esta conta (a carreira dela pode provar conquistas:
    // src/site/provas.ts); se a resposta chegar tarde e a carreira começar com a do aparelho, a lembrada nunca casa
    if (par) lembrarSementeDoServidor(u.id, sementeDoPar(par))
    return par
  } catch (err) {
    if (err instanceof ErroApi && err.status === 401) useConta.getState().sessaoExpirou()
    return null
  }
}

let iniciado = false
export function iniciarPontes() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true

  // ?c=<codigo>: guarda por 30 dias (vai no cadastro) e tira da barra de endereço
  if (capturarConvite(location.search, ls)) limparConviteDaUrl()

  // §E: a semente da carreira do Clássico sai do servidor quando há conta (só ela vale para desafio)
  useSementeCarreira.setState({ pedir: pedirSementeCarreira })

  useBonusCarreira.setState({
    carregar: () => {
      if (!useConta.getState().usuario) return useBonusCarreira.setState({ oferta: null })
      // a tela de criação pergunta sempre (um pedido por carreira nova): o bônus que acabou de chegar (amigo que
      // jogou, presente do admin, partida que liberou) já aparece; o valor que vale é o que o "usar" devolve
      void useBonus.getState().carregar(true).then(oferta)
    },
    consumir: async (carreiraId) => {
      let valor: number
      try {
        valor = await usarBonus(carreiraId)
      } catch (err) {
        // a sessão caiu (ou a conta foi suspensa): nada foi gasto, a carreira espera o jogador entrar de novo
        if (err instanceof ErroApi && (err.status === 401 || err.codigo === 'suspenso')) {
          useConta.getState().sessaoExpirou()
          toast.info('Sua sessão expirou', 'Entre de novo para usar o bônus: ele não foi gasto.', {
            key: 'bonus-sessao',
            action: { label: 'Entrar', icon: ArrowRight, onClick: () => abrirConta({ modo: 'manual', aba: 'entrar' }) },
          })
          throw new FalhaBonus('sessao')
        }
        throw new FalhaBonus(valeTentar(err) ? 'rede' : 'outro', err instanceof Error ? err.message : '')
      }
      // o bônus usado sai da lista; o próximo (se houver) aparece na próxima carreira
      void useBonus.getState().carregar(true).then(oferta)
      return valor
    },
  })

  pontes.compartilhar = {
    link: (carreiraId) => {
      const d = useBonus.getState().dados
      const codigo = d?.codigoConvite ?? useConta.getState().usuario?.codigoConvite
      // v3.4: com a conta e a carreira do card JÁ NO HALL PÚBLICO (§E), o link da prévia (api/v.php: o cartão com o resumo dela
      // no WhatsApp, X, Facebook…), com o código de convite de quem compartilha; senão (sem conta, fora do Hall, ainda não
      // conferido) o de sempre
      return linkDoCompartilhar({ carreiraId, codigo, logado: !!useConta.getState().usuario, linkConvite: d?.linkConvite })
    },
    preparar: (carreiraId, propria) => {
      if (!useConta.getState().usuario) return
      void useBonus.getState().carregar()
      // §E: a carreira do card já está no Hall público? (o link da prévia só vale para ela)
      if (carreiraId) void conferirNoHall(carreiraId, propria !== false)
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
  aoEntrar((_u, como) => {
    const p = pendente()
    if (p) void registrar(p.carreiraId)
    useBonus.getState().limpar()
    useBonusCarreira.setState({ usar: true })
    // abrir o jogo já logado não busca o bônus: quem precisa (criação da carreira, card, Minha conta) pede
    if (como === 'sessao') return
    void useBonus.getState().carregar(true).then(oferta)
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
