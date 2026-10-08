import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type Ref, type RefObject } from 'react'
import { config } from '../dados/config'
import { PixelArte } from '../arte/PixelArte'
import { ilustracoes } from '../arte/pixel/grades'
import { apresentacao, palpebras } from '../arte/pixel/mercador'
import { movimentoReduzido } from '../lib/movimento'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import './Rodape.css'

// O mercador animado (apresentação do Rodape.css) em qualquer lugar: o topo da aba Mercado (MercadoTopo) e o repost.
// As mesmas classes (.repost-figura, .repost-quadro .q-*), o mesmo ciclo. No Início ele mora na rua viva (rua/).

/** Camadas da apresentação. Sem config.mercadorTraga, as do trago nem entram (o Rodape.css troca para o ciclo curto). */
export const quadros = apresentacao.filter((q) => config.mercadorTraga || !q.trago)

/** Um tique da apresentação (Rodape.css). */
const TIQUE = 125
/** Ciclo inteiro: 100 tiques com trago, 50 sem. */
export const CICLO_MS = config.mercadorTraga ? 12500 : 6250
/** Tique 18: dois tiques antes de ele pegar a beirada do casaco. */
export const INICIO_MS = 18 * TIQUE
/** Fim da parte animada: guardou o cigarro (tique 82) ou fechou o casaco (tique 44 do ciclo curto). */
const FIM_MS = config.mercadorTraga ? 82 * TIQUE : 44 * TIQUE
/** Tique 21: a mão já puxou a beirada e o casaco está meio aberto (o próximo quadro é ele aberto). */
const ABRE_MS = 21 * TIQUE

// Aba do navegador escondida (outro app, outra aba): a animação para.
function assinarAba(avisar: () => void) {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', avisar)
  return () => document.removeEventListener('visibilitychange', avisar)
}
const lerAba = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const lerAbaServidor = () => false

/** true enquanto o elemento aparece na tela. Sem IntersectionObserver (navegador antigo), fica sempre true. */
export function useNaTela(ref: RefObject<Element | null>) {
  const [naTela, setNaTela] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNaTela(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setNaTela(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return naTela
}

/** Alguma camada por cima da página (story, folhas, página do produto, troca, abertura, jogo, conta, chat)? */
export function useCamadaAberta(): boolean {
  const ui = useUI(
    (s) =>
      !!s.story ||
      s.sacolaAberta ||
      s.seletorAberto ||
      s.infoAberto ||
      !!s.pagina ||
      !!s.trocaPendente ||
      s.aberturaAtiva ||
      !!s.interativo ||
      s.contaAberta,
  )
  const chat = useChat((s) => s.aberto)
  return ui || chat
}

/**
 * Leva a apresentação ao tique `alvo` quando ela está na parte parada (do começo até ele pegar a beirada, ou depois de
 * guardar o cigarro). Com o tique 18, toda vez que o mercador aparece ou volta a andar o casaco abre meio segundo
 * depois: quem passa rolando ou fica 3 s na tela vê a apresentação, não só o piscar. Todas as camadas vão juntas para o
 * mesmo ponto; o piscar segue no ritmo dele. No meio da apresentação, não mexe (nada pula para trás).
 */
function pularParaOTique(raiz: Element | null, alvo: number) {
  if (!raiz || typeof raiz.getAnimations !== 'function' || movimentoReduzido()) return
  const animacoes = raiz.getAnimations({ subtree: true }).filter((a) => {
    const nome = (a as CSSAnimation).animationName
    return typeof nome === 'string' && nome.startsWith('mercador-') && nome !== 'mercador-piscar'
  })
  for (const a of animacoes) {
    const agora = Number(a.currentTime ?? 0)
    if (!Number.isFinite(agora)) continue
    const t = ((agora % CICLO_MS) + CICLO_MS) % CICLO_MS
    if (t < INICIO_MS || t >= FIM_MS) a.currentTime = agora - t + (t >= FIM_MS ? CICLO_MS : 0) + alvo
  }
}

/** Mouse em cima do mercador parado: o casaco abre na hora (vai ao tique 21, meio aberto; o seguinte é aberto). */
export function abrirCasacoJa(raiz: Element | null) {
  pularParaOTique(raiz, ABRE_MS)
}

/**
 * O mercador anda (animações correndo) só na tela, com a aba do navegador à vista, sem camada por cima e sem
 * `parado`. A cada vez que volta a andar, pula a parte parada (pularParaOTique).
 * `ref` é a raiz do que anima junto (a figura).
 */
export function useMercadorAnda(ref: RefObject<HTMLElement | null>, op: { parado?: boolean } = {}): boolean {
  const naTela = useNaTela(ref)
  const abaVisivel = useSyncExternalStore(assinarAba, lerAba, lerAbaServidor)
  const camada = useCamadaAberta()
  const anda = naTela && abaVisivel && !camada && !op.parado
  useLayoutEffect(() => {
    if (anda) pularParaOTique(ref.current, INICIO_MS)
  }, [anda, ref])
  return anda
}

/** O mercador com o piscar e as camadas da apresentação, empilhadas na mesma grade. Decorativo (aria-hidden). */
export function MercadorAnimado({ tamanho, anda, refFigura, className }: { tamanho: number; anda: boolean; refFigura?: Ref<HTMLDivElement>; className?: string }) {
  return (
    <div ref={refFigura} className={`repost-figura${config.mercadorTraga ? ' com-trago' : ''}${anda ? '' : ' parado'}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <PixelArte grade={ilustracoes.mercador} tamanho={tamanho} className="repost-arte" />
      <PixelArte grade={palpebras} tamanho={tamanho} className="repost-piscar" />
      {quadros.map((q) => (
        <PixelArte key={q.nome} grade={q.grade} tamanho={tamanho} className={`repost-quadro q-${q.nome}`} />
      ))}
    </div>
  )
}
