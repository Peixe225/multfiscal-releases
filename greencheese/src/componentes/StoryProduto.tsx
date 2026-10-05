import { useEffect, useRef, useState } from 'react'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { copiarTexto } from '../lib/copiar'
import { linkPerfil } from '../lib/mensagem'
import type { Produto } from '../lib/tipos'
import { atualizarParametros, linkCompartilhar } from '../lib/url'
import { disponivelEm, produtoPorId } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
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
  return (
    <div className="story-menu">
      <button ref={botao} type="button" className="icone-botao toque" onClick={() => setAberto((v) => !v)} aria-label="Mais opções" aria-expanded={aberto}>
        <Icone nome="mais-opcoes" tamanho={20} />
      </button>
      {aberto && (
        <div className="story-menu-lista" role="menu">
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
  const canal = canalDa(uf)
  const { texto: lugar } = useTextoLocal()
  const [interagiu, setInteragiu] = useState(false)
  const [variacao, setVariacao] = useState<string | null>(null)
  const [qtd, setQtd] = useState(1)
  const [carimbo, setCarimbo] = useState(0)
  const sacolaRef = useRef<HTMLButtonElement>(null)

  const id = story?.lista[story.indice]
  const produto = produtoPorId(id)

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

  if (!story || !produto) return null
  const disponivel = uf ? (canal ? disponivelEm(produto, uf) : false) : null
  const cidadeNome = nomeCidade(canal, cidade, cidadeInformada)

  const interagir = () => setInteragiu(true)

  const porNaSacola = () => {
    interagir()
    adicionar(produto.id, variacao, qtd)
    setCarimbo((c) => c + 1)
    voarAteSacola(document.querySelector<HTMLElement>(`.story-produto [data-arte="${produto.id}"]`), sacolaRef.current)
  }

  const pedir = () => {
    if (disponivel === false) {
      abrirChat('encomenda', { produtoEncomenda: `${produto.nome}${produto.tamanho ? ` ${produto.tamanho}` : ''}` })
      return
    }
    // responde ao story: o item entra na sacola (se ainda não estiver) e abre o chat citando o story
    if (!itens.some((i) => i.id === produto.id && i.variacao === variacao)) adicionar(produto.id, variacao, qtd)
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
        {produto.combos && produto.preco != null && <QuizCombo produto={produto} qtd={qtd} mudar={setQtd} />}
        <AdesivoSacola produto={produto} variacao={variacao} qtd={qtd} mudar={setQtd} aoPor={porNaSacola} />
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
          {produto.demo && config.modoPrevia && <span className="story-demo carimbo">exemplo</span>}
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
