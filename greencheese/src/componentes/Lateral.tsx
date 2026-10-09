import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Logo } from '../arte/Logo'
import { PixelArte } from '../arte/PixelArte'
import { iconesAbas } from '../arte/pixel/abas'
import { icones } from '../arte/pixel/grades'
import { preenchida } from '../arte/pixel/preencher'
import { canalDa } from '../dados/canais'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { cliqueDeAba, hrefAba, irParaAba, type Aba } from '../lib/abas'
import { useConta, useCupons } from '../lib/conta'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { useQuantosAbertos } from '../store/rateio'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
import { AdesivoLocal, EnqueteLocal, useTextoLocal } from './Local'
import './Lateral.css'

/**
 * No Catálogo, qual dos dois itens da lateral é o ativo: "Buscar" (tocado por último, ou a pessoa foi para o campo de
 * busca) ou "Catálogo" (tocado por último). Só o texto na busca não decide: tocar em Catálogo depois de buscar deixa
 * Catálogo ativo. Sair do Catálogo zera (voltar para ele sem tocar em nada mostra Catálogo).
 */
function useBuscarAtivo(aba: Aba): [boolean, (v: boolean) => void] {
  const [buscar, setBuscar] = useState(false)
  useEffect(() => {
    const foco = (e: FocusEvent) => {
      const alvo = e.target
      if (alvo instanceof Element && alvo.matches('.vista[data-vista="catalogo"] .busca input')) setBuscar(true)
    }
    document.addEventListener('focusin', foco)
    return () => document.removeEventListener('focusin', foco)
  }, [])
  useEffect(() => {
    if (aba !== 'catalogo') setBuscar(false)
  }, [aba])
  return [buscar, setBuscar]
}

/**
 * A lateral passa da altura da janela (notebook baixo com a enquete, celular grande deitado)? Aí ela rola sozinha
 * (Lateral.css) e ganha data-lenis-prevent: a roda do mouse em cima dela rola a lateral, não a página (o Lenis
 * engoliria o evento). Cabendo, a roda em cima dela continua rolando a página, como antes.
 */
function useLateralRola(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => {
      const rola = el.scrollHeight > el.clientHeight + 1
      el.toggleAttribute('data-lenis-prevent', rola)
    }
    medir()
    // a própria lateral (janela) e cada bloco dela (a enquete entra e sai, o contador da sacola, a prévia)
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    for (const filho of el.children) ro.observe(filho)
    return () => ro.disconnect()
  }, [ref])
}

/** Item de aba na lateral: link de verdade (Ctrl/⌘/botão do meio abre em aba nova), ativo como no instagram.com. */
function ItemAba({ aba, rotulo, ativo, icone, aoTocar, contador }: { aba: Aba; rotulo: string; ativo: boolean; icone: ReactNode; aoTocar: () => void; contador?: { n: number; leitor: string } }) {
  return (
    <a
      className={`lateral-item toque${ativo ? ' ativo' : ''}`}
      href={hrefAba(aba)}
      data-aba={aba}
      aria-current={ativo ? 'page' : undefined}
      onClick={(e) => {
        if (cliqueDeAba(e)) aoTocar()
      }}
    >
      <span className="lateral-icone">{icone}</span>
      <span>
        {rotulo}
        {contador && contador.n > 0 && <span className="sr-only">: {contador.leitor}</span>}
      </span>
      {contador && contador.n > 0 && (
        <span className="lateral-contador px" aria-hidden="true">
          {contador.n}
        </span>
      )}
    </a>
  )
}

/** Rateio: a caixa de importação e quantos rateios dá pra entrar agora (some num estado sem entrega). */
function ItemRateio({ ativo }: { ativo: boolean }) {
  const uf = useLocal((s) => s.uf)
  const n = useQuantosAbertos(uf)
  if (uf && !canalDa(uf)) return null
  return (
    <ItemAba
      aba="rateio"
      rotulo="Rateio"
      ativo={ativo}
      icone={<PixelArte grade={ativo ? iconesAbas['caixa-cheia'] : iconesAbas.caixa} tamanho={24} />}
      aoTocar={() => irParaAba('rateio')}
      contador={{ n, leitor: n === 1 ? '1 aberto' : `${n} abertos` }}
    />
  )
}

/** Desktop: barra lateral no molde do instagram.com, com o adesivo de localização sempre à vista. */
export function Lateral() {
  const { texto, procurando } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const setSacola = useUI((s) => s.setSacola)
  const aba = useUI((s) => s.aba)
  const abrirChat = useChat((s) => s.abrir)
  const n = useSacola((s) => contarItens(s.itens))
  // os links das abas levam uf e cidade junto
  useLocal((s) => s.cidade)
  const [buscando, setBuscando] = useBuscarAtivo(aba)
  const buscarAtivo = aba === 'catalogo' && buscando
  const catalogoAtivo = aba === 'catalogo' && !buscando
  const raiz = useRef<HTMLElement>(null)
  useLateralRola(raiz)
  return (
    <aside ref={raiz} className="lateral" aria-label="Navegação">
      <a
        className="lateral-marca"
        href={hrefAba('inicio')}
        onClick={(e) => {
          if (cliqueDeAba(e)) irParaAba('inicio')
        }}
        aria-label="Green Cheese Imports — início"
      >
        <Logo tamanho={44} />
        <span className="px px-20">GREEN CHEESE</span>
      </a>
      <div className="lateral-local">
        <AdesivoLocal texto={texto} procurando={procurando} inclinacao={-3} aoTocar={() => setSeletor(true)} />
        <EnqueteLocal className="lateral-enquete" />
      </div>
      <nav className="lateral-nav" aria-label="Abas">
        <ItemAba
          aba="inicio"
          rotulo="Início"
          ativo={aba === 'inicio'}
          icone={<PixelArte grade={aba === 'inicio' ? iconesAbas['casa-cheia'] : iconesAbas.casa} tamanho={24} />}
          aoTocar={() => irParaAba('inicio')}
        />
        <a
          className={`lateral-item toque${buscarAtivo ? ' ativo' : ''}`}
          href={hrefAba('catalogo')}
          data-aba="buscar"
          aria-current={buscarAtivo ? 'page' : undefined}
          onClick={(e) => {
            if (!cliqueDeAba(e)) return
            setBuscando(true)
            irParaAba('catalogo', { foco: 'busca' })
          }}
        >
          <span className="lateral-icone">
            <PixelArte grade={buscarAtivo ? iconesAbas['lupa-grossa'] : icones.lupa} tamanho={24} />
          </span>
          <span>Buscar</span>
        </a>
        <ItemAba
          aba="catalogo"
          rotulo="Mercado"
          ativo={catalogoAtivo}
          icone={<PixelArte grade={catalogoAtivo ? preenchida(icones.garrafa) : icones.garrafa} tamanho={24} />}
          aoTocar={() => {
            setBuscando(false)
            irParaAba('catalogo')
          }}
        />
        <ItemRateio ativo={aba === 'rateio'} />
        <button type="button" className="lateral-item toque" onClick={() => abrirChat('pedido')} aria-haspopup="dialog">
          <span className="lateral-icone">
            <Icone nome="balao" tamanho={24} />
          </span>
          <span>Pedido guiado</span>
        </button>
        <button type="button" className="lateral-item toque" onClick={() => setSacola(true)} aria-haspopup="dialog">
          <span className="lateral-icone">
            <Icone nome="sacola" tamanho={24} />
          </span>
          <span>
            Sacola
            {n > 0 && <span className="sr-only">: {n === 1 ? '1 item' : `${n} itens`}</span>}
          </span>
          {n > 0 && (
            <span className="lateral-contador px" aria-hidden="true">
              {n}
            </span>
          )}
        </button>
        {/* depois da Sacola: os interativos e, com conta, a Minha conta */}
        {interativosAtivos().map((x) => (
          <ItemInterativo key={x.id} i={x} />
        ))}
        <ItemConta />
        <ItemAba
          aba="estados"
          rotulo="Por estado"
          ativo={aba === 'estados'}
          icone={<Avatar tamanho={24} anel={aba === 'estados'} />}
          aoTocar={() => irParaAba('estados')}
        />
      </nav>
    </aside>
  )
}

/** Item de um interativo na lateral, com o ponto branco de pixel quando tem coisa liberada. */
function ItemInterativo({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
  return (
    // o leitor ouve o momento do jogo (giro liberado, prêmio guardado esperando…), o mesmo do destaque
    <button type="button" className="lateral-item toque" onClick={() => abrir(i.id)} aria-haspopup="dialog" aria-label={e.aria}>
      <span className="lateral-icone">
        <Icone nome={i.icone} tamanho={24} />
        {/* ponto de notificação no canto do ícone, como no instagram.com */}
        {e.ponto && <span className="lateral-ponto" aria-hidden="true" />}
      </span>
      <span>{i.titulo}</span>
    </button>
  )
}

/** "Minha conta" (só com conta), com o contador de cupons ativos. */
function ItemConta() {
  const conta = useConta()
  const cupons = useCupons()
  const setConta = useUI((s) => s.setConta)
  if (!conta) return null
  const n = cupons.filter((c) => c.status === 'ativo').length
  return (
    <button type="button" className="lateral-item toque" onClick={() => setConta(true)} aria-haspopup="dialog">
      <span className="lateral-icone">
        <Icone nome="conta" tamanho={24} />
      </span>
      <span>
        Minha conta
        {n > 0 && <span className="sr-only">: {n === 1 ? '1 cupom ativo' : `${n} cupons ativos`}</span>}
      </span>
      {n > 0 && (
        <span className="lateral-contador px" aria-hidden="true">
          {n}
        </span>
      )}
    </button>
  )
}

/** Aviso curto (toast), anunciado para leitor de tela. */
export function Aviso() {
  const aviso = useUI((s) => s.aviso)
  return (
    <div className="aviso-area" aria-live="polite" role="status">
      {aviso && (
        <p key={aviso.id} className="aviso">
          {aviso.texto}
        </p>
      )}
    </div>
  )
}
