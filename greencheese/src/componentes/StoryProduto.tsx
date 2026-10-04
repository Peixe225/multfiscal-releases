import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { copiarTexto } from '../lib/copiar'
import { brl } from '../lib/formato'
import { linkPerfil } from '../lib/mensagem'
import { movimentoReduzido } from '../lib/movimento'
import { calcularLinha } from '../lib/preco'
import type { Produto } from '../lib/tipos'
import { atualizarParametros, linkCompartilhar } from '../lib/url'
import { disponivelEm, produtoPorId } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { contarItens, useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { LinkAvisar } from './Catalogo'
import { Icone } from './comum'
import { useTextoLocal } from './Local'
import { StoryQuadro } from './StoryQuadro'
import { StoryShell } from './StoryShell'
import './StoryProduto.css'

/** Variação = adesivo de enquete. A metade escolhida enche. */
function EnqueteVariacao({ produto, valor, mudar }: { produto: Produto; valor: string | null; mudar: (v: string) => void }) {
  const vs = produto.variacoes ?? []
  return (
    <div className="ad-enquete" role="radiogroup" aria-label="Formato">
      {vs.map((v) => {
        const [titulo, ...resto] = v.nome.split('·')
        const sel = v.id === valor
        return (
          <button key={v.id} type="button" role="radio" aria-checked={sel} className={`ad-enquete-op ${sel ? 'sel' : ''}`} onClick={() => mudar(v.id)}>
            <span className="ad-enquete-cheio" aria-hidden="true" />
            <span className="ad-enquete-txt">
              <strong>{titulo.trim()}</strong>
              {resto.length > 0 && <small>{resto.join('·').trim()}</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Combo = adesivo de quiz: cada linha é um preço; tocar escolhe a quantidade. */
function QuizCombo({ produto, qtd, mudar }: { produto: Produto; qtd: number; mudar: (q: number) => void }) {
  const linhas = [{ qtd: 1, total: produto.preco ?? 0 }, ...(produto.combos ?? [])]
  return (
    <div className="ad-quiz" role="radiogroup" aria-label="Quanto leva">
      <p className="ad-quiz-topo">Quanto leva?</p>
      {linhas.map((l) => (
        <button key={l.qtd} type="button" role="radio" aria-checked={qtd === l.qtd} className={`ad-quiz-linha ${qtd === l.qtd ? 'sel' : ''}`} onClick={() => mudar(l.qtd)}>
          <span className="ad-quiz-letra">{l.qtd}</span>
          <span>
            {l.qtd} por {brl(l.total)}
          </span>
        </button>
      ))}
    </div>
  )
}

/** "Pôr na sacola" = adesivo de link, com a quantidade dentro. */
function AdesivoSacola({ produto, variacao, qtd, mudar, aoPor }: { produto: Produto; variacao: string | null; qtd: number; mudar: (q: number) => void; aoPor: () => void }) {
  const c = calcularLinha(produto, qtd, variacao)
  // empurrão de combo: "leva mais 1 e as 3 saem por R$ 19,99"
  const prox = produto.combos?.find((cb) => cb.qtd === qtd + 1)
  return (
    <>
      <div className="ad-sacola">
        <div className="ad-qtd" role="group" aria-label="Quantidade">
          <button type="button" className="icone-botao toque" onClick={() => mudar(Math.max(1, qtd - 1))} aria-label="Menos um" disabled={qtd <= 1}>
            <Icone nome="menos" tamanho={14} />
          </button>
          <span className="px px-20" aria-live="polite">
            {qtd}
          </span>
          <button type="button" className="icone-botao toque" onClick={() => mudar(Math.min(99, qtd + 1))} aria-label="Mais um">
            <Icone nome="mais" tamanho={14} />
          </button>
        </div>
        <button type="button" className="ad-por toque" onClick={aoPor}>
          <Icone nome="sacola" tamanho={18} />
          <span>Pôr na sacola</span>
          {c.total != null && c.total > 0 && <span className="ad-por-preco">{brl(c.total)}</span>}
        </button>
      </div>
      {prox && (
        <p className="ad-empurrao px px-n">
          Leva mais 1 e as {prox.qtd} saem por {brl(prox.total)}
        </p>
      )}
    </>
  )
}

function MenuStory({ produto, canal }: { produto: Produto; canal: Canal | undefined }) {
  const [aberto, setAberto] = useState(false)
  const setSeletor = useUI((s) => s.setSeletor)
  const avisar = useUI((s) => s.avisar)
  return (
    <div className="story-menu">
      <button type="button" className="icone-botao toque" onClick={() => setAberto((v) => !v)} aria-label="Mais opções" aria-expanded={aberto}>
        <Icone nome="mais-opcoes" tamanho={20} />
      </button>
      {aberto && (
        <div className="story-menu-lista" role="menu">
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
    voarAteSacola(produto.id, sacolaRef.current)
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
      pausadoFora={interagiu || chatAberto || sacolaAberta}
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

/** "Pôr na sacola": a arte vira uma miniatura 9:16 e desce até a sacola, como mandar um story por DM. */
function voarAteSacola(id: string, alvo: HTMLElement | null) {
  if (!alvo || movimentoReduzido()) {
    pulsar(alvo)
    return
  }
  const origem = document.querySelector<HTMLCanvasElement>(`.story-produto [data-arte="${id}"] canvas`)
  if (!origem) return
  const r = origem.getBoundingClientRect()
  const a = alvo.getBoundingClientRect()
  const c = document.createElement('canvas')
  c.width = origem.width
  c.height = origem.height
  c.getContext('2d')?.drawImage(origem, 0, 0)
  c.className = 'voo-miniatura'
  Object.assign(c.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  document.body.appendChild(c)
  const escala = Math.min(1, 26 / r.width)
  gsap
    .timeline({ onComplete: () => c.remove() })
    .to(c, { scale: 0.5, duration: 0.18, ease: 'power2.out', transformOrigin: '50% 50%' })
    .to(c, {
      x: a.left + a.width / 2 - (r.left + r.width / 2),
      y: a.top + a.height / 2 - (r.top + r.height / 2),
      scale: escala,
      duration: 0.42,
      ease: 'power3.in',
    })
    .to(c, { opacity: 0, duration: 0.08, ease: 'steps(1)' })
    .add(() => pulsar(alvo), '-=0.06')
}

function pulsar(alvo: HTMLElement | null) {
  if (!alvo || movimentoReduzido()) return
  gsap.fromTo(alvo, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'steps(3)' })
}
