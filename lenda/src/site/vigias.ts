/**
 * Liga o site ao jogo sem mexer nos stores dele: observa rota, Clássico, Imersivo e Live e daí tira os
 * eventos da medição, o contador de partidas, o "salvar sozinha" e o momento do convite de conta.
 *
 *   iniciarSite()   // uma vez (SiteRoot)
 */
import { ArrowRight } from 'lucide-react'
import { useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer, type HallEntry } from '@/store/career'
import { useImmersive } from '@/store/immersive'
import { useLiveSession } from '@/live/config'
import { toast } from '@/ui/primitives'
import { iniciarMedicao, track, type ModoJogo } from './medicao'
import { CHAVE_USUARIO, deveAbrirConvite, selectTemConta, useConta } from './conta'
import { CONVITE_ESPERA_MS, momentoSeguro } from './convite'
import { mensagemDeErro } from './api'
import {
  abrirCarreiraDaConta,
  acharCarreira,
  apagadasNoAparelho,
  deveSalvarSozinha,
  fimClassico,
  fimImersivo,
  hallComUltima,
  idsNaConta,
  marcarPendente,
  marcarUltima,
  paraSubirAoEntrar,
  pendentesNoAparelho,
  salvaSozinha,
  useCarreiras,
  vigiarTransitorias,
} from './carreiras'
import { aoEntrar } from './conta'
import { abrirCarreiras, abrirConta, useSiteUi } from './ui'
import { comReintento, esperaReintento, valeTentar } from './api'
import { useAcesso } from '@/store/acesso'
import { iniciarAcesso } from './acesso'
import { iniciarConquistas } from './conquistas'
import { iniciarHallPublico } from './hallPublico'
import { iniciarPontes } from './pontes'
import { pendentesManuais } from './carreiras'
import { salvarManual } from './salvar'
import { useBonus } from './bonus'

/** Está jogando agora (para o batimento)? */
function estadoJogo(): { jogando: boolean; modo: ModoJogo | null } {
  const path = useApp.getState().route.path
  const live = useLiveSession.getState().on
  if (path === '/live' || (live && path === '/carreira')) return { jogando: live, modo: live ? 'live' : null }
  if (path === '/carreira') {
    const c = useCareer.getState()
    const ativo = !c.isFixture && selectHasActiveCareer(c)
    return { jogando: ativo, modo: ativo ? 'classico' : null }
  }
  if (path === '/imersivo') {
    const i = useImmersive.getState()
    const ativo = !!i.state && !i.isFixture && !i.state.retired
    return { jogando: ativo, modo: ativo ? 'imersivo' : null }
  }
  return { jogando: false, modo: null }
}

const naLive = () => useLiveSession.getState().on || useApp.getState().route.path === '/live'

const notaDe = (h: HallEntry) => (typeof h.legacy?.score === 'number' ? h.legacy.score : Math.round(h.summary?.legacyScore ?? 0))

/** Salva na conta (como "auto") uma carreira 90+ que acabou de terminar. */
async function salvarSozinha(h: HallEntry) {
  const conta = useConta.getState()
  if (!conta.usuario) {
    // a conta não respondeu agora (servidor lento), mas este aparelho já entrou: a 90+ espera na fila e sobe quando
    // a conta for confirmada (o GET conta.php tenta de novo sozinho)
    if (conta.lembrado && salvaSozinha(h) && !apagadasNoAparelho().has(h.id)) marcarPendente(h.id)
    return
  }
  const carreiras = useCarreiras.getState()
  if (!deveSalvarSozinha(h, { logado: true, naConta: idsNaConta(carreiras.lista), apagadas: apagadasNoAparelho() })) return
  try {
    // salvar é idempotente (grava ou atualiza pelo id): sem rede, tenta de novo com espera crescente
    await comReintento(() => useCarreiras.getState().salvar(h, 'auto'), { tentativas: 3, base: 2000 })
    toast.success('Salva na sua conta', `${h.identity.surname} · pico ${h.summary.peakOvr}`, { key: `conta-salva-${h.id}` })
  } catch (err) {
    marcarPendente(h.id)
    if (valeTentar(err)) toast.info('Sem conexão agora', `${h.identity.surname} sobe para a sua conta sozinha quando a internet voltar.`, { key: `conta-salva-${h.id}` })
    else toast.error('Não deu para salvar na conta', mensagemDeErro(err), { key: `conta-salva-${h.id}` })
  }
}

/** Sem o HallEntry (o resumo da carreira falhou) depois disto, o jogo_fim sai assim mesmo, sem a nota. */
const ESPERA_HALL_MS = 20_000
/** Carreiras que acabaram de terminar, esperando o HallEntry (a nota de legado vem num import à parte). */
const esperandoHall = new Map<string, { modo: ModoJogo; temporadas: number }>()

/** Terminou agora (transição do estado): conta a partida já; o jogo_fim e o "salvar sozinha" vão com o HallEntry. */
function terminou(id: string, modo: ModoJogo, temporadas: number) {
  if (modo === 'classico') useConta.getState().contarPartida()
  marcarUltima(id)
  esperandoHall.set(id, { modo, temporadas })
  entregarFins()
  window.setTimeout(() => {
    const e = esperandoHall.get(id)
    if (!e) return
    esperandoHall.delete(id)
    track('jogo_fim', e.modo, { temporadas: e.temporadas })
  }, ESPERA_HALL_MS)
}

/** As que terminaram e já têm HallEntry (no Hall ou, cortadas pelo teto dele, em lastFinished). */
function entregarFins() {
  for (const [id, e] of esperandoHall) {
    const h = acharCarreira(id)
    if (!h) continue
    esperandoHall.delete(id)
    track('jogo_fim', e.modo, { nota: notaDe(h), temporadas: h.summary?.seasons ?? 0, pico: h.summary?.peakOvr ?? 0 })
    // a partida conta no servidor (pode liberar os bônus): a próxima carreira pergunta de novo, sem o guardado
    if (useConta.getState().usuario) useBonus.setState({ em: 0 })
    void salvarSozinha(h)
  }
}

/** Depois de entrar/criar a conta: a carreira pedida pelo botão (manual) e as 90+ do aparelho (auto). */
export async function sincronizarAoEntrar(salvarId?: string) {
  const carreiras = useCarreiras.getState()
  try {
    await carreiras.carregar(true)
  } catch (err) {
    // sem a lista da conta agora (5xx, demora, sem rede): as 90+ do aparelho e a do botão vão para a fila e sobem
    // sozinhas daqui a pouco (um 503 não dispara o evento "online")
    if (valeTentar(err)) {
      for (const h of paraSubirAoEntrar(hallComUltima(), idsNaConta(useCarreiras.getState().lista), apagadasNoAparelho())) marcarPendente(h.id)
      if (salvarId) {
        marcarPendente(salvarId, 'manual')
        toast.info('Sem conexão agora', 'A carreira sobe para a sua conta sozinha quando der.', { key: `conta-salva-${salvarId}` })
      }
      agendarReenvio()
    } else if (salvarId) toast.error('Não deu para salvar na conta', mensagemDeErro(err))
    return
  }
  const hall = hallComUltima()
  if (salvarId) {
    const h = hall.find((x) => x.id === salvarId)
    if (h) await salvarManual(h)
  }
  const subir = paraSubirAoEntrar(hall, idsNaConta(useCarreiras.getState().lista), apagadasNoAparelho())
  let n = 0
  for (let i = 0; i < subir.length; i++) {
    try {
      await useCarreiras.getState().salvar(subir[i], 'auto')
      n++
    } catch (err) {
      if (valeTentar(err)) {
        // a atual e as que faltam esperam na fila (um 409/413 é regra: não adianta repetir a cada abertura)
        for (const h of subir.slice(i)) marcarPendente(h.id)
        agendarReenvio()
        toast.info('Algumas carreiras ficaram para depois', 'Sem conexão agora: elas sobem para a sua conta sozinhas quando der.')
      } else toast.error('Algumas carreiras não subiram', mensagemDeErro(err))
      break
    }
  }
  if (n) {
    toast.success(n === 1 ? '1 carreira 90+ foi para a sua conta' : `${n} carreiras 90+ foram para a sua conta`, 'As outras ficam em "Minhas carreiras", com o botão de salvar.', {
      action: { label: 'Ver minhas carreiras', onClick: () => abrirCarreiras('conta'), icon: ArrowRight },
    })
  }
}

/**
 * Tenta de novo as carreiras que não subiram (sem rede na hora): as 90+ ("auto") e as do botão ("manual").
 * Roda ao abrir o jogo já logado, quando a internet volta e, depois de uma falha do servidor, com espera crescente
 * (30 s, 1 min, 2 min… até 6 vezes). Uma de cada vez; a primeira falha para tudo.
 */
let reenviando = false
let tentativaReenvio = 0
let timerReenvio = 0
function agendarReenvio() {
  if (typeof window === 'undefined' || tentativaReenvio >= 6) return
  window.clearTimeout(timerReenvio)
  timerReenvio = window.setTimeout(() => void reenviarPendentes(), esperaReintento(tentativaReenvio++, 30_000, 300_000))
}
async function reenviarPendentes() {
  const pend = pendentesNoAparelho()
  const manuais = pendentesManuais()
  if ((!pend.size && !manuais.size) || !useConta.getState().usuario || reenviando) return
  reenviando = true
  try {
    try {
      await useCarreiras.getState().carregar(true)
    } catch (err) {
      if (valeTentar(err)) agendarReenvio()
      return
    }
    const naConta = idsNaConta(useCarreiras.getState().lista)
    const apagadas = apagadasNoAparelho()
    let n = 0
    for (const h of hallComUltima()) {
      const manual = manuais.has(h.id)
      if ((!pend.has(h.id) && !manual) || naConta.has(h.id) || (!manual && apagadas.has(h.id))) continue
      try {
        await useCarreiras.getState().salvar(h, manual ? 'manual' : 'auto')
        n++
      } catch (err) {
        if (valeTentar(err)) agendarReenvio()
        return
      }
    }
    tentativaReenvio = 0
    if (n) toast.success(n === 1 ? 'A carreira que estava esperando subiu para a sua conta' : `${n} carreiras que estavam esperando subiram para a sua conta`, undefined, { key: 'conta-pendentes' })
  } finally {
    reenviando = false
  }
}

function outroDialogoAberto(): boolean {
  if (typeof document === 'undefined') return false
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')) {
    if (el.closest('.sc-modal')) continue
    if (el.offsetParent !== null || el.getClientRects().length) return true
  }
  return false
}

function contextoConvite() {
  const app = useApp.getState()
  const c = useCareer.getState()
  const i = useImmersive.getState()
  return {
    rota: app.route.path,
    liveLigada: useLiveSession.getState().on,
    revelando: !!c.reveal || c.busy,
    classicoEmAndamento: !c.isFixture && selectHasActiveCareer(c),
    partidaAoVivo: !!i.state?.live,
    coletiva: !!i.state?.press,
    outroDialogo: !!app.dialog || outroDialogoAberto(),
  }
}

let iniciado = false

export function iniciarSite() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  iniciarMedicao({ estadoJogo })
  // público × admin (Live, Imersivo de teste, aviso, manutenção), Hall público, conquistas na conta,
  // bônus de OVR / convite de amigos
  iniciarAcesso()
  iniciarHallPublico()
  iniciarConquistas()
  iniciarPontes()
  vigiarTransitorias()
  // a internet voltou: a conta que não respondeu pergunta de novo e o que não subiu (carreiras salvas sem rede) tenta de novo
  window.addEventListener('online', () => {
    const c = useConta.getState()
    if (!c.usuario && c.lembrado) void c.carregar()
    tentativaReenvio = 0
    void reenviarPendentes()
  })

  // regras do convite + quem está logado
  void useConta
    .getState()
    .carregar()
    .then(() => reenviarPendentes())

  // ── telas ──
  let rota = ''
  const view = (path: string) => {
    if (path === rota) return
    rota = path
    track('view', null, { rota: path })
  }
  view(useApp.getState().route.path)
  useApp.subscribe((s) => view(s.route.path))

  // ── Clássico ──
  const modoDe = new Map<string, ModoJogo>()
  useCareer.subscribe((s, p) => {
    const st = s.state
    if (st && !s.isFixture && st.id !== p.state?.id && s.status !== 'restoring' && p.status !== 'restoring' && st.seasons.length === 0) {
      const modo: ModoJogo = naLive() ? 'live' : 'classico'
      modoDe.set(st.id, modo)
      track('jogo_inicio', modo, { ritmo: st.pace })
    }
    // fim pela transição do estado: vale mesmo se o Hall cortar a carreira ou o jogador sair antes dela entrar
    const fim = fimClassico(s, p)
    if (fim && st) terminou(fim, modoDe.get(fim) ?? (naLive() ? 'live' : 'classico'), st.seasons.length)
    if (esperandoHall.size && (s.finishedCareers !== p.finishedCareers || s.lastFinished !== p.lastFinished)) entregarFins()
  })

  // ── Imersivo ──
  useImmersive.subscribe((s, p) => {
    if (s.isFixture) return
    const st = s.state
    if (st && st.id !== p.state?.id && s.status !== 'restoring' && p.status !== 'restoring' && st.seasons.length === 0 && !st.live) {
      track('jogo_inicio', 'imersivo')
    }
    const fimI = fimImersivo(s, p)
    if (fimI && st) terminou(fimI, 'imersivo', st.seasons.length)
    const fim = p.state?.live
    if (fim && st && !st.live && st.id === p.state?.id && !p.isFixture) {
      const m = s.lastMatch ?? fim
      const [casa, fora] = m.score
      const [pro, contra] = m.userSide === 'home' ? [casa, fora] : [fora, casa]
      let resultado = pro > contra ? 'vitoria' : pro < contra ? 'derrota' : 'empate'
      if (pro === contra && m.pens) {
        const [pc, pf] = m.pens
        const [pp, pcn] = m.userSide === 'home' ? [pc, pf] : [pf, pc]
        resultado = pp > pcn ? 'vitoria_penaltis' : 'derrota_penaltis'
      }
      track('partida_fim', 'imersivo', { resultado, placar: `${pro}-${contra}`, gols: m.stats?.goals ?? 0 })
      useConta.getState().contarPartida()
    }
  })

  // ── conta: depois de entrar, sobe as carreiras ──
  aoEntrar((_u, como) => {
    // já estava logado (cookie), entrou em outra aba ou a conta só respondeu agora: sobe o que ficou na fila
    if (como === 'sessao') {
      void reenviarPendentes()
      return
    }
    track(como === 'cadastro' ? 'cadastro' : 'login')
    const d = useSiteUi.getState().dialogo
    const salvarId = d?.tipo === 'conta' ? d.depois?.salvar : undefined
    void sincronizarAoEntrar(salvarId)
  })
  useConta.subscribe((s, p) => {
    if (p.usuario && !s.usuario) useCarreiras.getState().limpar()
  })
  // outra aba jogou (ou adiou o convite): o contador desta acompanha; entrou ou saiu da conta: esta pergunta
  // ao servidor (o cookie é o mesmo) — senão seguiria com o convite aberto ou sem salvar as 90+ sozinha
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'lenda:partidas' || e.key === 'lenda:proximo-convite') useConta.getState().releer()
    if (e.key === null || e.key === CHAVE_USUARIO) void useConta.getState().carregar()
  })

  // ── compartilhar (botões do card do resumo, sem mexer no componente) ──
  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as Element | null)?.closest?.('.sm-share__actions button, .sm-share__actions a')
      if (!b) return
      const acao = b.classList.contains('sm-share__primary') ? 'compartilhar' : b.classList.contains('sm-share__copy') ? 'copiar' : (b.textContent ?? '').trim().toLowerCase().slice(0, 20)
      track('compartilhar', null, { acao, rota: useApp.getState().route.path })
    },
    { capture: true },
  )

  // ── #/resumo?id= de uma carreira da conta que não está neste aparelho (recarregou a página, link guardado):
  // busca na conta e mostra, como o "Abrir" de Minhas carreiras. Falhou (não está na conta, sem rede): não tenta
  // de novo esse id; deu certo: pode buscar de novo se o jogador voltar a esse resumo depois de sair ──
  const tentadas = new Set<string>()
  const resumoDaConta = () => {
    const r = useApp.getState().route
    // carreira da comunidade (de outro jogador): quem busca é o Hall público, nunca a conta
    const id = r.path === '/resumo' && r.query.de !== 'comunidade' ? r.query.id : undefined
    if (!id || tentadas.has(id) || !useConta.getState().usuario || useCareer.getState().status !== 'ready') return
    if (useCareer.getState().finishedCareers.some((h) => h.id === id)) return
    tentadas.add(id)
    abrirCarreiraDaConta(id, { navegar: false }).then(
      () => tentadas.delete(id),
      () => {
        /* fica o "Carreira não encontrada" do jogo */
      },
    )
  }
  useApp.subscribe(resumoDaConta)
  useConta.subscribe(resumoDaConta)
  useCareer.subscribe((s, p) => {
    if (s.status !== p.status) resumoDaConta()
  })

  // ── convite de conta ──
  let seguroDesde = 0
  const avaliar = () => {
    // aba no fundo: nada de convite (nem gate_ver) que ninguém vê
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      seguroDesde = 0
      return
    }
    // site em manutenção (para quem não é admin, ou enquanto o admin ainda é conferido): nada de convite por cima
    const acesso = useAcesso.getState()
    if (acesso.manutencao && !acesso.admin) {
      seguroDesde = 0
      return
    }
    const c = useConta.getState()
    // espera o jogo carregar (nada de convite por cima da tela de abertura) e nenhum diálogo do site aberto
    if (c.status !== 'pronto' || useCareer.getState().status !== 'ready' || useSiteUi.getState().dialogo) {
      seguroDesde = 0
      return
    }
    // cadastros fechados pelo painel: nada de convite para criar conta
    if (!useAcesso.getState().cadastroAberto || !deveAbrirConvite({ partidas: c.partidas, regras: c.regras, logado: selectTemConta(c), proximoConvite: c.proximoConvite })) {
      seguroDesde = 0
      return
    }
    if (!momentoSeguro(contextoConvite())) {
      seguroDesde = 0
      return
    }
    const agora = Date.now()
    if (!seguroDesde) seguroDesde = agora
    if (agora - seguroDesde < CONVITE_ESPERA_MS) return
    seguroDesde = 0
    abrirConta({ modo: 'convite' })
    track('gate_ver', null, { partidas: c.partidas, rota: useApp.getState().route.path })
  }
  window.setInterval(avaliar, 500)
}
