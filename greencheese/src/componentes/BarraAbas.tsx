import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { gsap } from 'gsap'
import { PixelArte } from '../arte/PixelArte'
import { iconesAbas } from '../arte/pixel/abas'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { TE } from '../interativos/sorte/textos-entrada'
import { cliqueDeAba, hrefAba, irParaAba, type Aba } from '../lib/abas'
import { lerSessao, gravarSessao } from '../lib/armazenamento'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
import { useAvisoLocal } from './Local'
import { passoDoMercadorVisto, RostoMercador, useCamadaAberta, useRostoParado } from './Mercador'
import { useConviteSorte } from './StoryMercador'
import './BarraAbas.css'

// Barra de abas do celular, no molde da barra de baixo do Instagram: Início, Busca (Catálogo), a ação do meio
// (Teste minha sorte), a Sacola e o "perfil" (Por estado, com o avatar da loja e o selo da UF). Uma barra fixa só:
// o "Enviar mensagem…" mora no pé do story do Início. Sem rótulo visível; cada célula tem nome para leitor de tela.

/** Toque numa aba da barra: a lupa tocada de novo no Catálogo vai até a busca e foca (como o Instagram). */
function tocar(e: MouseEvent<HTMLAnchorElement>, a: Aba) {
  if (!cliqueDeAba(e)) return
  const atual = useUI.getState().aba
  if (a === 'catalogo') irParaAba('catalogo', { foco: atual === 'catalogo' ? 'busca' : 'titulo' })
  else irParaAba(a)
}

export function BarraAbas() {
  const aba = useUI((s) => s.aba)
  const home = useUI((s) => s.home)
  const uf = useLocal((s) => s.uf)
  // o href das abas leva uf e home junto (re-renderiza quando mudam)
  useLocal((s) => s.cidade)
  const sorte = interativosAtivos()[0]
  return (
    <nav className="barra-abas" aria-label="Abas">
      <a
        className={`aba-celula toque${aba === 'inicio' ? ' ativa' : ''}`}
        href={hrefAba('inicio')}
        data-aba="inicio"
        aria-label="Início"
        aria-current={aba === 'inicio' ? 'page' : undefined}
        onClick={(e) => tocar(e, 'inicio')}
      >
        <PixelArte grade={aba === 'inicio' ? iconesAbas['casa-cheia'] : iconesAbas.casa} tamanho={32} />
      </a>
      <a
        className={`aba-celula toque${aba === 'catalogo' ? ' ativa' : ''}`}
        href={hrefAba('catalogo')}
        data-aba="catalogo"
        aria-label="Catálogo"
        aria-current={aba === 'catalogo' ? 'page' : undefined}
        onClick={(e) => tocar(e, 'catalogo')}
      >
        {aba === 'catalogo' ? <PixelArte grade={iconesAbas['lupa-grossa']} tamanho={32} /> : <Icone nome="lupa" tamanho={32} />}
      </a>
      {sorte && <CelulaSorte i={sorte} home={home} />}
      <CelulaSacola />
      <a
        className={`aba-celula toque${aba === 'estados' ? ' ativa' : ''}`}
        href={hrefAba('estados')}
        data-aba="estados"
        aria-label="Por estado"
        aria-current={aba === 'estados' ? 'page' : undefined}
        onClick={(e) => tocar(e, 'estados')}
      >
        <span className="aba-perfil">
          <Avatar tamanho={28} anel={aba === 'estados'} />
          {uf && (
            <span className="aba-uf px" aria-hidden="true">
              {uf.toUpperCase()}
            </span>
          )}
        </span>
      </a>
    </nav>
  )
}

/** A ação do meio: abre o Teste minha sorte (camada; nunca fica ativa). Na Home 2, o rosto do mercador piscando. */
function CelulaSorte({ i, home }: { i: Interativo; home: 1 | 2 }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
  const parado = useRostoParado()
  return (
    <button
      type="button"
      className="aba-celula aba-sorte toque"
      data-aba="sorte"
      aria-label={`${i.titulo}${e.ponto ? ' · liberado' : ''}`}
      aria-haspopup="dialog"
      onClick={() => abrir(i.id)}
    >
      <span className="aba-icone">
        {home === 2 ? <RostoMercador tamanho={32} parado={parado} /> : <Icone nome={i.icone} tamanho={32} />}
        {e.ponto && <span className="aba-ponto" aria-hidden="true" />}
      </span>
    </button>
  )
}

/** Sacola: abre a folha; o contador no canto troca o dígito em degrau. */
function CelulaSacola() {
  const n = useSacola((s) => contarItens(s.itens))
  const setSacola = useUI((s) => s.setSacola)
  const contador = useRef<HTMLSpanElement>(null)
  const anterior = useRef(n)
  // o dígito troca em degrau (sem escala elástica)
  useEffect(() => {
    if (n !== anterior.current && contador.current && !movimentoReduzido()) {
      gsap.fromTo(contador.current, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: 'steps(3)' })
    }
    anterior.current = n
  }, [n])
  return (
    <button
      type="button"
      className="aba-celula toque"
      data-aba="sacola"
      aria-label={`Sacola: ${n} ${n === 1 ? 'item' : 'itens'}`}
      aria-haspopup="dialog"
      onClick={() => setSacola(true)}
    >
      <span className="aba-icone">
        <Icone nome="sacola" tamanho={32} />
        {n > 0 && (
          <span ref={contador} className="aba-contador px" aria-hidden="true">
            {n}
          </span>
        )}
      </span>
    </button>
  )
}

const CHAVE_BALAO = 'gc-balao-mercador'
const CHAVE_DICA = 'gc-dica-hero'
/** Respiro depois que tudo vale (o passo do mercador acabou de sair do story). */
const ESPERA_MS = 1500
const FICA_MS = 6000

/**
 * Home 2, celular: o balão "Tá com sorte hoje?" em cima do rosto do mercador, uma vez por sessão. Entra logo depois
 * que o passo do mercador sai do story (ele sai do story e fica morando na barra; a mesma pergunta nunca aparece duas
 * vezes na mesma tela). Só com o Início parado no topo, sem camada, depois da abertura, da dica do hero e da enquete
 * de local, e em celular alto (cai na sobra da faixa, nunca na linha de resposta do story). Decorativo para leitor de
 * tela (a aba do meio já diz tudo); tocar nele abre o jogo.
 */
export function BalaoMercador() {
  const aba = useUI((s) => s.aba)
  const camada = useCamadaAberta()
  // qualquer aviso de local pendente (confirmar o palpite ou estado sem entrega): o balão espera, sem gastar a vez
  const enquete = useAvisoLocal() !== null
  const c = useConviteSorte()
  const [fase, setFase] = useState<'espera' | 'mostra' | 'saindo' | 'fim'>(() => (lerSessao(CHAVE_BALAO) ? 'fim' : 'espera'))
  const elegivel = fase === 'espera' && aba === 'inicio' && !camada && !enquete && c.ativo && c.novo

  // conta 1,5 s seguidos com tudo valendo (rolagem, altura da tela, a dica e o passo do hero, conferidos a cada meio segundo)
  useEffect(() => {
    if (!elegivel) return
    let acumulado = 0
    const id = window.setInterval(() => {
      const ok =
        window.scrollY < 40 &&
        window.matchMedia('(max-width: 899px) and (min-height: 701px)').matches &&
        lerSessao(CHAVE_DICA) === '1' &&
        passoDoMercadorVisto() &&
        !document.querySelector('.vista-inicio .hero-palco .sm-passo') &&
        !lerSessao(CHAVE_BALAO) &&
        !document.querySelector('.folha, [aria-modal="true"]')
      acumulado = ok ? acumulado + 500 : 0
      if (acumulado >= ESPERA_MS) {
        window.clearInterval(id)
        gravarSessao(CHAVE_BALAO, '1')
        setFase('mostra')
      }
    }, 500)
    return () => window.clearInterval(id)
  }, [elegivel])

  // some ao tocar fora, ao rolar, ao trocar de aba, com camada aberta ou depois de 6 s
  useEffect(() => {
    if (fase !== 'mostra') return
    const sair = () => setFase((f) => (f === 'mostra' ? 'saindo' : f))
    const t = window.setTimeout(sair, FICA_MS)
    const rolou = () => {
      if (window.scrollY > 40) sair()
    }
    const fora = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest('.balao-mercador')) sair()
    }
    window.addEventListener('scroll', rolou, { passive: true })
    document.addEventListener('pointerdown', fora, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('scroll', rolou)
      document.removeEventListener('pointerdown', fora, true)
    }
  }, [fase])
  useEffect(() => {
    if (fase === 'mostra' && (aba !== 'inicio' || camada)) setFase('saindo')
  }, [aba, camada, fase])
  useEffect(() => {
    if (fase !== 'saindo') return
    const t = window.setTimeout(() => setFase('fim'), movimentoReduzido() ? 0 : 170)
    return () => window.clearTimeout(t)
  }, [fase])

  if (fase !== 'mostra' && fase !== 'saindo') return null
  return (
    <div
      className={`balao-mercador${fase === 'saindo' ? ' saindo' : ''}`}
      aria-hidden="true"
      onClick={() => {
        setFase('saindo')
        c.acao()
      }}
    >
      <span className="balao-mercador-txt px">{TE.pergunta}</span>
    </div>
  )
}
