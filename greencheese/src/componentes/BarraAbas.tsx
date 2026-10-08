import { useEffect, useRef, type MouseEvent } from 'react'
import { gsap } from 'gsap'
import { PixelArte } from '../arte/PixelArte'
import { iconesAbas } from '../arte/pixel/abas'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { cliqueDeAba, hrefAba, irParaAba, type Aba } from '../lib/abas'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
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
  const uf = useLocal((s) => s.uf)
  // o href das abas leva uf e cidade junto (re-renderiza quando mudam)
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
        aria-label="Mercado"
        aria-current={aba === 'catalogo' ? 'page' : undefined}
        onClick={(e) => tocar(e, 'catalogo')}
      >
        {aba === 'catalogo' ? <PixelArte grade={iconesAbas['lupa-grossa']} tamanho={32} /> : <Icone nome="lupa" tamanho={32} />}
      </a>
      {sorte && <CelulaSorte i={sorte} />}
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

/** A ação do meio: abre o Teste minha sorte (camada; nunca fica ativa), com o dichavador. */
function CelulaSorte({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
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
        <Icone nome={i.icone} tamanho={32} />
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
