import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Canal } from '../dados/canais'
import { config } from '../dados/config'
import { copiarTexto } from '../lib/copiar'
import { linkPerfil } from '../lib/mensagem'
import type { Produto } from '../lib/tipos'
import { atualizarParametros, linkCompartilhar, manterNaURL } from '../lib/url'
import { disponivelEm, produtoPorId, restamEm, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { useCanalDa } from '../store/loja'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { AdesivoSacola, EnqueteVariacao, QuizCombo, voarAteSacola } from './AdesivosProduto'
import { LinkAvisar } from './Catalogo'
import { Icone } from './comum'
import { useTextoLocal } from './Local'
import { StoryQuadro } from './StoryQuadro'
import { StoryShell } from './StoryShell'
import './StoryProduto.css'

function MenuStory({ produto, canal }: { produto: Produto; canal: Canal | undefined }) {
  const [aberto, setAberto] = useState(false)
  const setSeletor = useUI((s) => s.setSeletor)
  const avisar = useUI((s) => s.avisar)
  const abrirPagina = useUI((s) => s.abrirPagina)
  const botao = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  // abriu: o foco vai pro 1º item, como num menu de verdade
  useEffect(() => {
    if (aberto) lista.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [aberto])
  // setas, Home e End andam pelos itens; Esc fecha só o menu (o story fica) e devolve o foco pro ⋯
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && aberto) {
      e.preventDefault()
      e.stopPropagation()
      setAberto(false)
      botao.current?.focus({ preventScroll: true })
      return
    }
    if (!aberto) {
      if (e.target === botao.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        e.stopPropagation()
        setAberto(true)
      }
      return
    }
    const itens = [...(lista.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = itens.indexOf(document.activeElement as HTMLElement)
    let j = -1
    if (e.key === 'ArrowDown') j = (i + 1) % itens.length
    else if (e.key === 'ArrowUp') j = i < 0 ? itens.length - 1 : (i - 1 + itens.length) % itens.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = itens.length - 1
    if (j < 0 || !itens.length) return
    e.preventDefault()
    e.stopPropagation()
    itens[j].focus({ preventScroll: true })
  }
  return (
    <div className="story-menu" onKeyDown={teclas}>
      <button ref={botao} type="button" className="icone-botao toque" onClick={() => setAberto((v) => !v)} aria-label="Mais opções" aria-haspopup="menu" aria-expanded={aberto}>
        <Icone nome="mais-opcoes" tamanho={20} />
      </button>
      {aberto && (
        <div ref={lista} className="story-menu-lista" role="menu" aria-label="Mais opções">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // o foco volta pro ⋯ quando a página do produto fechar (o item do menu some)
              botao.current?.focus({ preventScroll: true })
              setAberto(false)
              abrirPagina(produto.id, 'story')
            }}
          >
            Ver detalhes do produto
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false)
              setSeletor(true)
            }}
          >
            Trocar cidade
          </button>
          {canal && (
            <a role="menuitem" href={linkPerfil(canal.instagram)} target="_blank" rel="noopener noreferrer">
              Ver perfil no Instagram
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false)
              avisar(copiarTexto(linkCompartilhar({ p: produto.id })) ? 'Link do produto copiado.' : 'Não deu pra copiar o link.')
            }}
          >
            Copiar link do produto
          </button>
        </div>
      )}
    </div>
  )
}

/** Barra embaixo do story: legenda + "Pedir este item…" + compartilhar + sacola. */
function RodapeStory({ produto, disponivel, aoPedir, sacolaRef }: { produto: Produto; disponivel: boolean | null; aoPedir: () => void; sacolaRef: React.RefObject<HTMLButtonElement | null> }) {
  const n = useSacola((s) => contarItens(s.itens))
  const setSacola = useUI((s) => s.setSacola)
  const avisar = useUI((s) => s.avisar)
  const compartilhar = async () => {
    const url = linkCompartilhar({ p: produto.id })
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
  return (
    <>
      <p className="story-legenda px px-n">Quem tiver interesse é só mandar dm</p>
      <div className="barra-resposta">
        <button type="button" className="barra-pilula toque" onClick={aoPedir}>
          {disponivel === false ? 'Encomendar este item…' : 'Pedir este item…'}
        </button>
        <button type="button" className="icone-botao toque" onClick={compartilhar} aria-label="Compartilhar produto">
          <Icone nome="enviar" tamanho={24} />
        </button>
        <button ref={sacolaRef} type="button" className="icone-botao toque barra-sacola" onClick={() => setSacola(true)} aria-label={`Sacola: ${n} ${n === 1 ? 'item' : 'itens'}`}>
          <Icone nome="sacola" tamanho={24} />
          {n > 0 && <span className="barra-contador px">{n}</span>}
        </button>
      </div>
    </>
  )
}

export function StoryProduto() {
  const story = useUI((s) => s.story)
  const irStory = useUI((s) => s.irStory)
  const fecharStory = useUI((s) => s.fecharStory)
  const sacolaAberta = useUI((s) => s.sacolaAberta)
  const paginaAberta = useUI((s) => !!s.pagina)
  const chatAberto = useChat((s) => s.aberto)
  const abrirChat = useChat((s) => s.abrir)
  const adicionar = useSacola((s) => s.adicionar)
  const itens = useSacola((s) => s.itens)
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = useCanalDa(uf)
  const { texto: lugar } = useTextoLocal()
  const [interagiu, setInteragiu] = useState(false)
  const [variacao, setVariacao] = useState<string | null>(null)
  const [qtd, setQtd] = useState(1)
  const [carimbo, setCarimbo] = useState(0)
  const sacolaRef = useRef<HTMLButtonElement>(null)

  const id = story?.lista[story.indice]
  // assina a loja: o produto muda (preço, estoque) ou sai dela sem o story ficar com o de antes
  const produto = useCatalogo((s) => (id ? s.produtos.find((p) => p.id === id) : undefined))

  // novo produto: zera escolhas e o congelamento
  useEffect(() => {
    setInteragiu(false)
    setQtd(1)
    setVariacao(produto?.variacoes?.[0]?.id ?? null)
    setCarimbo(0)
  }, [id, produto?.variacoes])

  // ?p=id na URL enquanto o story está aberto (link direto do produto)
  useEffect(() => {
    if (!id) return
    atualizarParametros({ p: id })
    return () => atualizarParametros({ p: null })
  }, [id])
  // trocou de produto com uma folha por cima (sacola vazia → outra miniatura): a volta da folha cai na entrada do
  // story, que ainda tem o ?p= de antes
  useEffect(
    () =>
      manterNaURL(() => {
        const s = useUI.getState().story
        const atual = s?.lista[s.indice]
        return atual ? { p: atual } : {}
      }),
    [],
  )

  // o produto saiu da loja (o dono tirou do site) com o story aberto: fecha, em vez de ficar uma camada vazia por cima
  useEffect(() => {
    if (story && id && !produto) fecharStory()
  }, [story, id, produto, fecharStory])

  if (!story || !produto) return null
  const disponivel = uf ? (canal ? disponivelEm(produto, uf) : false) : null
  const cidadeNome = nomeCidade(canal, cidade, cidadeInformada)
  // "restam X": a quantidade não passa do que sobra no estado (com o que já tá na sacola)
  const restam = disponivel ? restamEm(produto, uf) : null
  const cabe = restam == null ? null : Math.max(0, restam - itens.reduce((n, i) => n + (i.id === produto.id ? i.qtd : 0), 0))
  const maxQtd = cabe == null ? 99 : Math.max(1, cabe)
  const qtdOk = Math.min(qtd, maxQtd)

  const interagir = () => setInteragiu(true)

  const porNaSacola = () => {
    interagir()
    if (cabe === 0) {
      useUI.getState().avisar(`As ${restam === 1 ? 'unidade que resta' : `${restam} que restam`} aqui já tão na tua sacola.`)
      return
    }
    adicionar(produto.id, variacao, qtdOk)
    setCarimbo((c) => c + 1)
    voarAteSacola(document.querySelector<HTMLElement>(`.story-produto [data-arte="${produto.id}"]`), sacolaRef.current)
  }

  const pedir = () => {
    if (disponivel === false) {
      abrirChat('encomenda', { produtoEncomenda: `${produto.nome}${produto.tamanho ? ` ${produto.tamanho}` : ''}` })
      return
    }
    // responde ao story: o item entra na sacola (se ainda não estiver) e abre o chat citando o story
    // já na sacola: o pedido leva pelo menos a quantidade escolhida no adesivo (nunca menos do que já tinha)
    const naSacola = itens.find((i) => i.id === produto.id && i.variacao === variacao)
    if (!naSacola) {
      if (cabe !== 0) adicionar(produto.id, variacao, qtdOk)
    } else if (qtd > naSacola.qtd) useSacola.getState().alterar(produto.id, variacao, cabe == null ? qtd : Math.min(qtd, naSacola.qtd + cabe))
    abrirChat('pedido', { respondendo: [produto.id] })
  }

  const adesivos =
    disponivel === false ? (
      canal ? (
        <LinkAvisar produto={produto} canal={canal} cidade={cidadeNome} />
      ) : undefined
    ) : (
      <div className="ad-pilha" onPointerDown={interagir}>
        {produto.variacoes && <EnqueteVariacao produto={produto} valor={variacao} mudar={setVariacao} />}
        {produto.combos && produto.preco != null && <QuizCombo produto={produto} qtd={qtdOk} mudar={setQtd} max={maxQtd} />}
        <AdesivoSacola produto={produto} variacao={variacao} qtd={qtdOk} mudar={setQtd} aoPor={porNaSacola} max={maxQtd} />
      </div>
    )

  return (
    <StoryShell
      id="story-produto"
      total={story.lista.length}
      indice={story.indice}
      irPara={irStory}
      fechar={fecharStory}
      origem={story.origem}
      alvoVolta={(i) => document.querySelector<HTMLElement>(`[data-flip-id="${story.lista[i]}"] .card-abrir`)}
      duracaoMs={config.storySegundos * 1000}
      pausadoFora={interagiu || chatAberto || sacolaAberta || paginaAberta}
      instagram={canal?.instagram ?? null}
      menu={<MenuStory produto={produto} canal={canal} />}
      rotulo={`Story: ${produto.nome}`}
      quadro={
        <div className="story-produto" key={produto.id}>
          <StoryQuadro
            produto={produto}
            escala="tela"
            disponivel={disponivel}
            lugar={canal || !uf ? lugar : null}
            prioridade
            semPreco={!!produto.combos && disponivel !== false}
            adesivos={adesivos}
            artePropsExtra={{ flutuar: true }}
          />
          {carimbo > 0 && (
            <span key={carimbo} className="carimbo-sacola px" role="status">
              NA SACOLA
            </span>
          )}
          {produto.demo && config.carimboDeExemplo && <span className="story-demo carimbo">exemplo</span>}
        </div>
      }
      rodape={<RodapeStory produto={produto} disponivel={disponivel} aoPedir={pedir} sacolaRef={sacolaRef} />}
      vizinho={(i) => {
        const v = produtoPorId(story.lista[i])
        return v ? <StoryQuadro produto={v} escala="card" disponivel={uf ? (canal ? disponivelEm(v, uf) : false) : null} revelar={false} /> : null
      }}
    />
  )
}
