import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardEventReact } from 'react'
import { gsap } from 'gsap'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { PixelArte } from '../arte/PixelArte'
import type { Grade } from '../arte/pixel/grades'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { emUf, semAcento } from '../dados/ufs'
import { copiarTexto } from '../lib/copiar'
import { brl, plural, precoOuConsultar } from '../lib/formato'
import { depoisDoHistorico, useCamadaNoHistorico } from '../lib/historico'
import { ehDesktop, movimentoReduzido } from '../lib/movimento'
import { calcularLinha, precoUnitario } from '../lib/preco'
import { liberarRolagem, travarRolagem } from '../lib/rolagem'
import type { Produto } from '../lib/tipos'
import { atualizarParametros, lerParametros, linkCompartilhar } from '../lib/url'
import { disponivelEm, produtoPorId, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI, type OrigemPagina, type PaginaAberta } from '../store/ui'
import { EnqueteVariacao, Empurrao, QuizCombo, SeletorQtd, pulsar, voarAteSacola } from './AdesivosProduto'
import { LinkAvisar } from './Catalogo'
import { Avatar, Icone } from './comum'
import './ProdutoPagina.css'

// Página do produto: a "aba" que abre ao tocar no produto, no molde da página de produto do Instagram Shopping.
// Celular: tela cheia que entra pela direita, barra de compra presa embaixo. Desktop: diálogo em 2 colunas sobre a cortina.
// Abrir um "combina com" empilha outra página por cima; "Voltar" (botão, gesto do Android, Esc) desce um nível.

/** Chevron do "Voltar" (mesmo traço de 2 px da cabeça das setas). */
const CHEVRON: Grade = {
  w: 16,
  h: 16,
  linhas: [
    '................',
    '................',
    '..........xx....',
    '.........xxx....',
    '........xxx.....',
    '.......xxx......',
    '......xxx.......',
    '.....xxx........',
    '.....xxx........',
    '......xxx.......',
    '.......xxx......',
    '........xxx.....',
    '.........xxx....',
    '..........xx....',
    '................',
    '................',
  ],
}

/** Elemento que tinha o foco quando cada nível abriu (índice = nível): o foco volta pra ele quando o nível fecha. */
const retornos: (HTMLElement | null)[] = []
/** A página já abriu alguma vez nesta visita (só então o ?produto= velho da URL é limpo na volta do histórico). */
let jaAbriu = false

// Assinatura direta da store: roda dentro do set(), antes de qualquer render mexer no foco.
useUI.subscribe((s, a) => {
  const n = s.pagina?.pilha.length ?? 0
  const m = a.pagina?.pilha.length ?? 0
  if (n > m) {
    const ativo = document.activeElement
    const foco = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null
    for (let i = m; i < n; i++) retornos[i] = foco
    jaAbriu = true
  }
  // um story novo abriu com a página na frente (ex.: pela sacola vazia): a página sai, senão o story ficaria atrás dela
  if (s.pagina && a.pagina && s.story && s.story.lista !== a.story?.lista) useUI.getState().fecharPagina()
})

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** "em Teófilo Otoni", "no Rio de Janeiro" (a cidade com o nome do estado leva o artigo do estado), "na Bahia". */
function ondeFica(canal: Canal | undefined, uf: string, cidade: string | null): string {
  if (cidade && (!canal || semAcento(cidade) !== semAcento(canal.nome))) return `em ${cidade}`
  return emUf(uf)
}

/** Uma entrada no histórico por nível: o voltar do Android desce um nível, igual ao botão. */
function NivelNoHistorico({ nivel }: { nivel: number }) {
  useCamadaNoHistorico(true, `pagina-${nivel}`, () => useUI.getState().voltarPagina())
  return null
}

interface Vista {
  /** Último estado da store já tratado. */
  base: PaginaAberta | null
  /** Níveis na tela, inclusive o que está saindo. */
  lista: string[]
  origem: OrigemPagina
  /** Nível animando a saída depois de um "Voltar". */
  saindo: number | null
  /** A página inteira saindo. */
  fechando: boolean
}

export function ProdutoPagina() {
  const pagina = useUI((s) => s.pagina)
  const [v, setV] = useState<Vista>(() => ({ base: pagina, lista: pagina?.pilha ?? [], origem: pagina?.origem ?? 'link', saindo: null, fechando: false }))
  const raiz = useRef<HTMLDivElement>(null)
  const topoAnt = useRef(-1)

  // a store mudou: decide o que fica na tela (o nível que sai continua montado até a animação acabar)
  if (pagina !== v.base) {
    const ant = v.base
    const voltou = !!pagina && !!ant && pagina.pilha.length === ant.pilha.length - 1 && pagina.pilha.every((x, i) => x === ant.pilha[i])
    if (!pagina) setV({ ...v, base: null, lista: ant?.pilha ?? v.lista, saindo: null, fechando: v.lista.length > 0 })
    else if (voltou) setV({ base: pagina, lista: ant.pilha, origem: pagina.origem, saindo: ant.pilha.length - 1, fechando: false })
    else setV({ base: pagina, lista: pagina.pilha, origem: pagina.origem, saindo: null, fechando: false })
  }

  const aberta = v.lista.length > 0
  const vivos = v.fechando ? 0 : (v.base?.pilha.length ?? 0)
  const topo = vivos - 1
  const chaveDe = (i: number) => `${i}:${v.lista[i]}`

  // rolagem da página travada atrás; aviso (toast) sobe acima da barra de compra
  useEffect(() => {
    if (!aberta) return
    travarRolagem()
    document.documentElement.classList.add('pp-aberta')
    return () => {
      liberarRolagem()
      document.documentElement.classList.remove('pp-aberta')
    }
  }, [aberta])

  // ?produto=<topo> na URL enquanto aberta (replaceState); some ao fechar
  const idTopo = pagina ? pagina.pilha[pagina.pilha.length - 1] : null
  const estavaAberta = useRef(false)
  useEffect(() => {
    if (idTopo) {
      estavaAberta.current = true
      atualizarParametros({ produto: idTopo })
    } else if (estavaAberta.current) {
      estavaAberta.current = false
      atualizarParametros({ produto: null })
    }
  }, [idTopo])
  // fechou pelo botão: o history.back() cai na entrada anterior, que pode ter o ?produto= do link de entrada
  useEffect(() => {
    const limpar = () => {
      if (jaAbriu && !useUI.getState().pagina && lerParametros().produto) atualizarParametros({ produto: null })
    }
    window.addEventListener('popstate', limpar)
    return () => window.removeEventListener('popstate', limpar)
  }, [])

  // teclado: Esc volta um nível; setas e espaço não chegam no story/hero que está por baixo
  useEffect(() => {
    if (!aberta) return
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('.folha')) return // sacola, chat ou seletor por cima: a folha cuida
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useUI.getState().voltarPagina()
        return
      }
      const dentro = raiz.current?.contains(e.target as Node)
      if (!dentro && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ')) e.stopPropagation()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [aberta])

  // fechar: a página inteira sai (todos os níveis juntos) e só então desmonta; o foco volta pra quem abriu
  useLayoutEffect(() => {
    const r = raiz.current
    if (!r || !v.fechando) return
    const janelas = r.querySelectorAll<HTMLElement>('.pp-janela')
    const cortina = r.querySelector<HTMLElement>('.pp-cortina')
    const fim = () => {
      setV((x) => (x.fechando ? { ...x, lista: [], saindo: null, fechando: false } : x))
      const volta = retornos[0]
      if (volta?.isConnected) volta.focus({ preventScroll: true })
      else if (v.origem === 'story') document.querySelector<HTMLElement>('.story-quadro')?.focus({ preventScroll: true })
    }
    if (movimentoReduzido()) {
      fim()
      return
    }
    const desk = ehDesktop()
    const tl = gsap.timeline({ onComplete: fim })
    if (desk) {
      tl.to(janelas, { opacity: 0, y: 16, duration: 0.2, ease: 'power3.in' }, 0)
      if (cortina) tl.to(cortina, { opacity: 0, duration: 0.18, ease: 'none' }, 0)
    } else tl.to(janelas, { xPercent: 100, duration: 0.24, ease: 'power3.in' }, 0)
    return () => {
      tl.kill()
      gsap.set([...janelas, cortina].filter(Boolean), { clearProps: 'transform,opacity' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.fechando])

  // foco: entra no título do nível novo; num "Voltar", volta pro card que abriu o nível que saiu
  const chaveTopo = topo >= 0 ? chaveDe(topo) : ''
  useEffect(() => {
    if (topo < 0) {
      topoAnt.current = -1
      return
    }
    const r = raiz.current
    const voltou = topo < topoAnt.current
    const volta = voltou ? retornos[topoAnt.current] : null
    topoAnt.current = topo
    if (volta?.isConnected && r?.contains(volta)) volta.focus({ preventScroll: true })
    else r?.querySelector<HTMLElement>(`[data-nivel="${topo}"] .pp-nome`)?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveTopo])

  // Tab fica preso na página do topo
  const prender = (e: KeyboardEventReact<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') e.stopPropagation()
    if (e.key !== 'Tab') return
    const janela = raiz.current?.querySelector<HTMLElement>(`[data-nivel="${topo}"]`)
    if (!janela) return
    const lista = [...janela.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    if (!lista.length) return
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    const ativo = document.activeElement
    if (e.shiftKey && (ativo === primeiro || !janela.contains(ativo))) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && (ativo === ultimo || !janela.contains(ativo))) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <>
      {pagina?.pilha.map((_, i) => <NivelNoHistorico key={i} nivel={i} />)}
      {aberta && (
        <div
          ref={raiz}
          className="pp"
          role="dialog"
          aria-modal="true"
          aria-labelledby={topo >= 0 ? `pp-nome-${topo}` : undefined}
          onKeyDown={prender}
          data-lenis-prevent
        >
          <Cortina />
          {v.lista.map((id, i) => {
            const vivo = i < vivos
            return (
              <PaginaNivel
                key={chaveDe(i)}
                id={id}
                nivel={i}
                topo={vivo && i === topo}
                escondido={i < v.lista.length - 2}
                saindo={v.saindo === i}
                origem={v.origem}
                aoSair={() => setV((x) => (x.saindo === i ? { ...x, lista: x.lista.slice(0, i), saindo: null } : x))}
              />
            )
          })}
        </div>
      )}
    </>
  )
}

/** Cortina pontilhada do desktop (no celular a página cobre tudo). Tocar fora fecha a página. */
function Cortina() {
  const ref = useRef<HTMLDivElement>(null)
  const fechar = useUI((s) => s.fecharPagina)
  useLayoutEffect(() => {
    if (!ref.current || movimentoReduzido() || !ehDesktop()) return
    gsap.fromTo(ref.current, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' })
  }, [])
  return <div ref={ref} className="pp-cortina cortina" onClick={fechar} aria-hidden="true" />
}

interface PropsNivel {
  id: string
  nivel: number
  /** Página de cima (a única que recebe toque e foco). */
  topo: boolean
  /** Nível fundo da pilha: fica montado (guarda escolhas e rolagem), mas não pinta. */
  escondido: boolean
  saindo: boolean
  origem: OrigemPagina
  aoSair: () => void
}

/** Uma página de produto (um nível da pilha). */
function PaginaNivel({ id, nivel, topo, escondido, saindo, origem, aoSair }: PropsNivel) {
  const produto = produtoPorId(id)
  const janela = useRef<HTMLDivElement>(null)

  // entrada: do zero (a página abriu) ou por cima de outra (combina com). Voz app, só transform/opacity.
  useLayoutEffect(() => {
    const el = janela.current
    if (!el || movimentoReduzido()) return
    const desk = ehDesktop()
    const tw = desk
      ? gsap.fromTo(el, nivel === 0 ? { opacity: 0, y: 16 } : { opacity: 0, x: 40 }, { opacity: 1, x: 0, y: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform,opacity' })
      : gsap.fromTo(el, { xPercent: 100 }, { xPercent: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' })
    return () => {
      tw.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // saída de um nível ("Voltar"): sai pela direita e desmonta
  useLayoutEffect(() => {
    const el = janela.current
    if (!saindo || !el) return
    if (movimentoReduzido()) {
      aoSair()
      return
    }
    const tw = ehDesktop()
      ? gsap.to(el, { opacity: 0, x: 40, duration: 0.2, ease: 'power3.in', onComplete: aoSair })
      : gsap.to(el, { xPercent: 100, duration: 0.22, ease: 'power3.in', onComplete: aoSair })
    return () => {
      tw.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saindo])

  if (!produto) return null
  return (
    <div
      ref={janela}
      className={`pp-janela ${escondido ? 'pp-escondida' : ''}`}
      data-nivel={nivel}
      inert={!topo}
      tabIndex={-1}
    >
      <ConteudoProduto produto={produto} nivel={nivel} topo={topo} origem={origem} />
    </div>
  )
}

function ConteudoProduto({ produto, nivel, topo, origem }: { produto: Produto; nivel: number; topo: boolean; origem: OrigemPagina }) {
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const produtos = useCatalogo((s) => s.produtos)
  const itens = useSacola((s) => s.itens)
  const adicionar = useSacola((s) => s.adicionar)
  const abrirChat = useChat((s) => s.abrir)
  const { voltarPagina, fecharPagina, abrirPagina, abrirStory, setSacola, avisar } = useUI.getState()
  const [variacao, setVariacao] = useState<string | null>(produto.variacoes?.[0]?.id ?? null)
  const [qtd, setQtd] = useState(1)
  const [carimbo, setCarimbo] = useState(0)
  const visual = useRef<HTMLDivElement>(null)
  const sacolaRef = useRef<HTMLButtonElement>(null)
  const barra = useRef<HTMLDivElement>(null)

  const disponivel = uf ? (canal ? disponivelEm(produto, uf) : false) : null
  const vendavel = disponivel !== false
  const cidadeNome = nomeCidade(canal, cidade, cidadeInformada)
  const unitario = precoUnitario(produto, variacao)
  const linha = calcularLinha(produto, qtd, variacao)
  const nSacola = contarItens(itens)
  const nDeste = itens.filter((i) => i.id === produto.id).reduce((n, i) => n + i.qtd, 0)
  const temCombo = !!produto.combos && produto.preco != null

  // "Combina com": o que a loja indicou primeiro; depois o que tem da mesma categoria. Até 4.
  const sugestoes = useMemo(() => {
    const vistos = new Set([produto.id])
    const r: Produto[] = []
    for (const cid of produto.combinaCom ?? []) {
      const p = produtos.find((x) => x.id === cid)
      if (p && !vistos.has(p.id)) {
        vistos.add(p.id)
        r.push(p)
      }
    }
    for (const p of produtos) {
      if (p.categoria !== produto.categoria || vistos.has(p.id)) continue
      if (uf && !(canal && disponivelEm(p, uf))) continue
      vistos.add(p.id)
      r.push(p)
    }
    return r.slice(0, 4)
  }, [produto, produtos, uf, canal])

  // altura da barra de compra: o aviso (toast) fica logo acima dela
  useEffect(() => {
    const el = barra.current
    if (!topo || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--pp-barra', `${Math.round(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [topo])

  const porNaSacola = () => {
    adicionar(produto.id, variacao, qtd)
    setCarimbo((c) => c + 1)
    // a miniatura só voa se a arte está à vista; rolou pra baixo, o contador pula sozinho
    const r = visual.current?.getBoundingClientRect()
    const topoBarra = janelaTopo(visual.current)
    if (r && r.bottom > topoBarra + 60 && r.top < window.innerHeight) voarAteSacola(visual.current?.querySelector<HTMLElement>('.pp-arte') ?? null, sacolaRef.current)
    else pulsar(sacolaRef.current)
  }

  // igual ao "Pedir este item…" do story
  const pedir = () => {
    if (disponivel === false) {
      abrirChat('encomenda', { produtoEncomenda: `${produto.nome}${produto.tamanho ? ` ${produto.tamanho}` : ''}` })
      return
    }
    if (!itens.some((i) => i.id === produto.id && i.variacao === variacao)) adicionar(produto.id, variacao, qtd)
    abrirChat('pedido', { respondendo: [produto.id] })
  }

  const compartilhar = async () => {
    const url = linkCompartilhar({ produto: produto.id })
    try {
      if (navigator.share) {
        await navigator.share({ title: `${produto.nome} — Green Cheese`, text: `${produto.nome} na Green Cheese`, url })
        return
      }
    } catch {
      return
    }
    avisar(copiarTexto(url) ? 'Link copiado. Manda pra quem quiser.' : 'Não deu pra copiar o link.')
  }

  // a página sai do histórico primeiro; o story entra depois (senão a volta levaria a entrada e o ?p= do story)
  const verNosStories = () => {
    const daCat = produtos.filter((x) => x.categoria === produto.categoria)
    fecharPagina()
    depoisDoHistorico(() =>
      abrirStory(
        daCat.map((x) => x.id),
        Math.max(0, daCat.findIndex((x) => x.id === produto.id)),
      ),
    )
  }

  const idNome = `pp-nome-${nivel}`

  return (
    <>
      <header className="pp-topo">
        <button type="button" className="icone-botao toque pp-voltar" onClick={voltarPagina} aria-label="Voltar">
          <PixelArte grade={CHEVRON} tamanho={32} />
        </button>
        <p className="pp-loja">
          <Avatar tamanho={28} />
          <span className="pp-loja-nome">{canal?.instagram ?? 'Green Cheese'}</span>
        </p>
        <button type="button" className="icone-botao toque" onClick={compartilhar} aria-label="Compartilhar produto">
          <Icone nome="enviar" tamanho={24} />
        </button>
        <button ref={sacolaRef} type="button" className="icone-botao toque pp-sacola" onClick={() => setSacola(true)} aria-label={`Sacola: ${plural(nSacola, 'item', 'itens')}`}>
          <Icone nome="sacola" tamanho={24} />
          {nSacola > 0 && <span className="pp-contador px">{nSacola}</span>}
        </button>
        <button type="button" className="icone-botao toque pp-fechar" onClick={fecharPagina} aria-label="Fechar">
          <Icone nome="fechar" tamanho={20} />
        </button>
      </header>

      <div ref={visual} className="pp-visual" style={{ '--brilho': produto.cor } as CSSProperties}>
        <div className={`pp-arte ${disponivel === false ? '' : 'pp-arte-flutua'}`} data-arte={produto.id}>
          <ProdutoVisual produto={produto} largura={120} indisponivel={disponivel === false} prioridade={topo} rotulo={null} />
        </div>
        {carimbo > 0 && (
          <span key={carimbo} className="carimbo-sacola px" aria-hidden="true">
            NA SACOLA
          </span>
        )}
        {produto.demo && config.modoPrevia && <span className="pp-demo carimbo">exemplo</span>}
      </div>

      <div className="pp-info">
        <h2 id={idNome} className={`pp-nome px ${disponivel === false ? 'pp-off' : ''}`} tabIndex={-1}>
          {produto.nome}
        </h2>
        {(produto.detalhe ?? produto.tamanho) && <p className="pp-detalhe">{produto.detalhe ?? produto.tamanho}</p>}
        <p className={`pp-preco px ${disponivel === false ? 'pp-off' : ''}`}>{precoOuConsultar(unitario)}</p>
        {temCombo && <p className="pp-combos px px-n">{produto.combos!.map((c) => `${c.qtd} por ${brl(c.total)}`).join(' · ')}</p>}

        <Disponibilidade produto={produto} />

        {produto.descricao && <p className="pp-desc">{produto.descricao}</p>}

        {vendavel && (produto.variacoes || temCombo) && (
          <div className="pp-opcoes">
            {produto.variacoes && <EnqueteVariacao produto={produto} valor={variacao} mudar={setVariacao} />}
            {temCombo && <QuizCombo produto={produto} qtd={qtd} mudar={setQtd} />}
            <Empurrao produto={produto} qtd={qtd} />
          </div>
        )}

        {vendavel ? (
          <div className="pp-pedir">
            <button type="button" className="botao botao-contorno botao-largo toque" onClick={pedir}>
              <Icone nome="balao" tamanho={16} />
              Pedir este item
            </button>
            <p className="legenda">Abre a conversa do pedido com ele já na sacola.</p>
          </div>
        ) : (
          canal && (
            <div className="pp-pedir pp-avisar">
              <LinkAvisar produto={produto} canal={canal} cidade={cidadeNome} />
              <p className="legenda">Ou encomenda pelo botão aqui embaixo.</p>
            </div>
          )
        )}

        {sugestoes.length > 0 && (
          <section className="pp-combina" aria-labelledby={`pp-combina-${nivel}`}>
            <h3 id={`pp-combina-${nivel}`} className="pp-subtitulo">
              Combina com
            </h3>
            <ul className="pp-sugestoes">
              {sugestoes.map((p) => {
                const off = uf ? !(canal && disponivelEm(p, uf)) : false
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`pp-sug toque ${off ? 'pp-sug-off' : ''}`}
                      onClick={() => abrirPagina(p.id)}
                      aria-label={`${p.nome}, ${p.preco == null ? 'preço a consultar' : brl(p.preco)}${off ? ', indisponível' : ''}. Ver produto`}
                    >
                      <span className="pp-sug-arte">
                        <ProdutoVisual produto={p} largura={60} indisponivel={off} rotulo={null} />
                      </span>
                      <span className="pp-sug-nome px">{p.nome}</span>
                      <span className="pp-sug-preco px">{precoOuConsultar(p.preco)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {origem !== 'story' && (
          <button type="button" className="pp-link toque" onClick={verNosStories}>
            Ver nos stories
            <Icone nome="seta-dir" tamanho={16} />
          </button>
        )}
      </div>

      <div ref={barra} className="pp-barra">
        {nDeste > 0 && (
          <div className="pp-na-sacola" role="status">
            <span className="pp-na-sacola-txt">
              <Icone nome="check" tamanho={16} />
              <span>
                Na sacola: <span className="px px-16">{nDeste}</span>
              </span>
            </span>
            <button type="button" className="pp-ver-sacola toque" onClick={() => setSacola(true)}>
              Ver sacola
            </button>
          </div>
        )}
        <div className="pp-acoes">
          {vendavel ? (
            <>
              <SeletorQtd qtd={qtd} mudar={setQtd} className="pp-qtd" tamanhoIcone={16} />
              <button type="button" className="botao botao-cheio pp-por toque" onClick={porNaSacola}>
                <span>Adicionar à sacola</span>
                {linha.total != null && linha.total > 0 && <span className="pp-por-preco px px-16">{brl(linha.total)}</span>}
              </button>
            </>
          ) : (
            <button type="button" className="botao botao-cheio botao-largo pp-por toque" onClick={pedir}>
              Encomendar este item
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** Base da barra do topo da página (a miniatura não voa se a arte já rolou pra trás dela). */
function janelaTopo(el: HTMLElement | null): number {
  const topo = el?.closest('.pp-janela')?.querySelector('.pp-topo')
  return topo ? topo.getBoundingClientRect().bottom : 0
}

/** "DISPONÍVEL ✅ em Teófilo Otoni" · "INDISPONÍVEL em Minas Gerais" · sem estado: pede o estado. */
function Disponibilidade({ produto }: { produto: Produto }) {
  const { uf, cidade, cidadeInformada, detectando } = useLocal()
  const setSeletor = useUI((s) => s.setSeletor)
  const canal = canalDa(uf)
  if (!uf) {
    return (
      <div className="pp-disp pp-disp-sem">
        <p>{detectando ? 'Procurando teu estado…' : 'Escolhe teu estado pra ver se tem'}</p>
        <button type="button" className="botao botao-contorno toque" onClick={() => setSeletor(true)}>
          <Icone nome="pin" tamanho={16} />
          Escolher estado
        </button>
      </div>
    )
  }
  const disp = canal ? disponivelEm(produto, uf) : false
  const onde = ondeFica(canal, uf, nomeCidade(canal, cidade, cidadeInformada))
  return (
    <div className={`pp-disp ${disp ? '' : 'pp-indisp'}`}>
      <p>
        <span className="px pp-disp-selo">{disp ? 'DISPONÍVEL ✅' : 'INDISPONÍVEL'}</span> <span className="pp-disp-onde">{onde}</span>
      </p>
      <button type="button" className="pp-trocar toque" onClick={() => setSeletor(true)} aria-label={`Trocar estado (agora: ${onde.replace(/^(em|no|na) /, '')})`}>
        Trocar
      </button>
    </div>
  )
}
