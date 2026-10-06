import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { config } from '../dados/config'
import { canais, perfisAConfirmar } from '../dados/canais'
import { Logo } from '../arte/Logo'
import { PixelArte } from '../arte/PixelArte'
import { iconesAbas } from '../arte/pixel/abas'
import { icones } from '../arte/pixel/grades'
import { preenchida } from '../arte/pixel/preencher'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { cliqueDeAba, hrefAba, irParaAba, rolarAoTopo, type Aba } from '../lib/abas'
import { useConta, useCupons } from '../lib/conta'
import { copiarTexto } from '../lib/copiar'
import { HOME_PADRAO, homeNaURL, lembrarHome, type Home } from '../lib/home'
import { atualizarParametros, linkCompartilhar } from '../lib/url'
import { useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
import { Folha } from './Folha'
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
function ItemAba({ aba, rotulo, ativo, icone, aoTocar }: { aba: Aba; rotulo: string; ativo: boolean; icone: ReactNode; aoTocar: () => void }) {
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
      <span>{rotulo}</span>
    </a>
  )
}

/** Desktop: barra lateral no molde do instagram.com, com o adesivo de localização sempre à vista. */
export function Lateral() {
  const { texto, procurando } = useTextoLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const setSacola = useUI((s) => s.setSacola)
  const setPainel = useUI((s) => s.setPainel)
  const aba = useUI((s) => s.aba)
  const home = useUI((s) => s.home)
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
          rotulo="Catálogo"
          ativo={catalogoAtivo}
          icone={<PixelArte grade={catalogoAtivo ? preenchida(icones.garrafa) : icones.garrafa} tamanho={24} />}
          aoTocar={() => {
            setBuscando(false)
            irParaAba('catalogo')
          }}
        />
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
      {config.modoPrevia && (
        <button type="button" className="lateral-previa toque" onClick={() => setPainel(true)}>
          <span className="lateral-previa-selos">
            <span className="carimbo">prévia</span>
            {home === 2 && <span className="carimbo carimbo-home">home 2</span>}
          </span>
          <span className="legenda">{home === 2 ? 'vendo a Home 2 · trocar de home' : 'o que falta pra ficar oficial'}</span>
        </button>
      )}
    </aside>
  )
}

/** Item de um interativo na lateral, com o ponto branco de pixel quando tem coisa liberada. */
function ItemInterativo({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
  return (
    <button type="button" className="lateral-item toque" onClick={() => abrir(i.id)} aria-haspopup="dialog">
      <span className="lateral-icone">
        <Icone nome={i.icone} tamanho={24} />
        {/* ponto de notificação no canto do ícone, como no instagram.com */}
        {e.ponto && <span className="lateral-ponto" aria-hidden="true" />}
      </span>
      <span>
        {i.titulo}
        {e.ponto && <span className="sr-only"> · liberado</span>}
      </span>
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

/** Selo "prévia" discreto (celular). Na Home 2, "home 2" (o painel troca de home). */
export function SeloPrevia() {
  const setPainel = useUI((s) => s.setPainel)
  const home = useUI((s) => s.home)
  if (!config.modoPrevia) return null
  return (
    <button
      type="button"
      className="selo-previa carimbo toque"
      onClick={() => setPainel(true)}
      aria-label={home === 2 ? 'Prévia da Home 2: ver o que falta e trocar de home' : 'Prévia: ver o que falta pra ficar oficial'}
    >
      {home === 2 ? 'home 2' : 'prévia'}
    </button>
  )
}

/** Troca de versão da home (prévia): Home 1 (atual) ou Home 2 (sorte e mercador no topo). */
function VersaoHome() {
  const home = useUI((s) => s.home)
  const avisar = useUI((s) => s.avisar)
  const uf = useLocal((s) => s.uf)
  const escolher = (h: Home) => {
    if (h === useUI.getState().home) return
    lembrarHome(h)
    useUI.getState().setHome(h)
    atualizarParametros({ home: homeNaURL(h) })
    useUI.getState().setPainel(false)
    if (useUI.getState().aba === 'inicio') rolarAoTopo()
    else irParaAba('inicio')
    avisar(h === 2 ? 'Vendo a Home 2.' : 'Vendo a Home 1.')
  }
  const link = linkCompartilhar({ ...(uf ? { uf } : {}), home: '2' })
  return (
    <fieldset className="previa-home">
      <legend className="previa-titulo">Versão da home</legend>
      {([1, 2] as const).map((h) => (
        <label key={h} className={`previa-opcao toque${home === h ? ' escolhida' : ''}`}>
          <input type="radio" name="versao-home" value={h} checked={home === h} onChange={() => escolher(h)} />
          <span>
            {h === 1 ? 'Home 1 (atual)' : 'Home 2 (sorte e mercador no topo)'}
            {h === HOME_PADRAO && <span className="legenda"> · padrão</span>}
          </span>
        </label>
      ))}
      <button type="button" className="botao botao-contorno previa-copiar" onClick={() => avisar(copiarTexto(link) ? 'Link da Home 2 copiado.' : 'Não deu pra copiar.')}>
        <Icone nome="copiar" tamanho={16} />
        Copiar link da Home 2
      </button>
    </fieldset>
  )
}

/** Painel da prévia: o que ainda é PENDENTE ou demo, lido direto dos dados, e os links de bio por estado. */
export function PainelPrevia() {
  const aberto = useUI((s) => s.painelPrevia)
  const setPainel = useUI((s) => s.setPainel)
  const avisar = useUI((s) => s.avisar)
  const produtos = useCatalogo((s) => s.produtos)
  if (!config.modoPrevia) return null
  const semZap = canais.filter((c) => !c.whatsapp).map((c) => c.uf.toUpperCase())
  const semCidade = canais.filter((c) => c.cidades.length === 0).map((c) => c.uf.toUpperCase())
  const consultar = produtos.filter((p) => !p.demo && p.preco == null).map((p) => p.nome)
  const exemplos = produtos.filter((p) => p.demo).length
  const semFoto = produtos.filter((p) => !p.demo && !p.foto).length
  const base = config.urlPublica.replace(/\/?$/, '/')
  return (
    <Folha id="previa" aberta={aberto} aoFechar={() => setPainel(false)} rotulo="Prévia: pendências" cabecalho={<span>Prévia · I&H Soluções Digitais</span>}>
      <div className="previa">
        <VersaoHome />
        <p className="previa-intro">Tudo funciona até a mensagem pronta no WhatsApp. Pra ficar oficial, falta o dono passar:</p>
        <ul className="previa-lista">
          <li>
            <strong>WhatsApp de cada estado</strong> — {semZap.join(', ') || 'ok'}. Sem número, o pedido abre o WhatsApp pra escolher o contato ou vai pela DM.
          </li>
          <li>
            <strong>Cidades atendidas</strong> — {semCidade.join(', ') || 'ok'} (hoje o pedido pergunta a cidade).
          </li>
          <li>
            <strong>Horário, taxa de entrega e pagamento</strong> — estão como <span className="carimbo">demo</span> nos 5 estados.
          </li>
          <li>
            <strong>Preço</strong> de {consultar.length} produtos reais (aparecem como "Consultar"): {consultar.join(', ')}.
          </li>
          <li>
            <strong>Fotos oficiais</strong> — {semFoto} produtos reais estão em pixel art feita em código.
          </li>
          <li>
            <strong>{exemplos} produtos de exemplo</strong> (marcados "exemplo") completam a vitrine e somem quando a prévia for desligada.
          </li>
          <li>
            <strong>Disponibilidade por estado</strong> — confirmada só onde o produto apareceu nos stories.
          </li>
          {interativosAtivos().length > 0 && (
            <li>
              <strong>Teste minha sorte</strong> — prêmios de exemplo (src/dados/sorte.ts). A conta, os cupons e o limite de giros ficam só neste aparelho; na versão
              oficial, o prêmio, o código e o limite são validados no servidor.
            </li>
          )}
          {perfisAConfirmar.map((p) => (
            <li key={p.instagram}>
              <strong>@{p.instagram}</strong> — {p.obs}: confirmar se é perfil oficial.
            </li>
          ))}
        </ul>
        <h3 className="previa-titulo">Link pra bio de cada perfil</h3>
        <ul className="previa-links">
          {canais.map((c) => {
            const url = `${base}?uf=${c.uf}${c.cidades.length === 1 ? `&cidade=${c.cidades[0].slug}` : ''}`
            return (
              <li key={c.uf}>
                <span className="px px-16">{c.uf.toUpperCase()}</span>
                <code>{url.replace(/^https?:\/\//, '')}</code>
                <button
                  type="button"
                  className="botao botao-contorno"
                  onClick={() => avisar(copiarTexto(url) ? `Link do ${c.uf.toUpperCase()} copiado.` : 'Não deu pra copiar.')}
                >
                  <Icone nome="copiar" tamanho={16} />
                  Copiar
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Folha>
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
