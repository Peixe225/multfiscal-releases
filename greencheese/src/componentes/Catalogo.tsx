import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { gsap } from 'gsap'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { PixelArte } from '../arte/PixelArte'
import { iconesAbas } from '../arte/pixel/abas'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { semAcento } from '../dados/ufs'
import { cliqueDeAba, hrefAba, irParaAba, type Aba, type FocoAba } from '../lib/abas'
import { alvoDeSaida } from '../lib/ambiente'
import { copiarTexto } from '../lib/copiar'
import { linkDM, montarAviso } from '../lib/mensagem'
import { movimentoReduzido } from '../lib/movimento'
import type { Produto } from '../lib/tipos'
import { disponivelEm, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
import { useQuantosAbertos, useRateioNovo } from '../store/rateio'
import { useUI } from '../store/ui'
import { Avatar, Icone } from './comum'
import { StoryQuadro } from './StoryQuadro'
import './Catalogo.css'

// Flip só reorganiza a grade ao filtrar: carrega depois da primeira tela.
type FlipT = typeof import('gsap/Flip').Flip
let FlipMod: FlipT | null = null
function carregarFlip() {
  if (FlipMod) return
  void import('gsap/Flip').then((m) => {
    gsap.registerPlugin(m.Flip)
    FlipMod = m.Flip
  })
}

// Busca que entende o jeito que o cliente escreve: plural simples, sem acento, e apelidos por categoria.
const APELIDOS: Record<string, string> = {
  bebidas: 'bebida refri refrigerante soda lata importada importado drink',
  destilados: 'destilado whisky whiskey uisque gin conhaque cognac licor bebida garrafa jack',
  sedas: 'seda papel papelote slim king size bobina',
  piteiras: 'piteira filtro tips ponta vidro',
  acessorios: 'acessorio dichavador triturador grinder isqueiro bandeja cuia bowl tabacaria',
}

function textoDeBusca(p: Produto): string {
  return semAcento(`${p.nome} ${p.tamanho ?? ''} ${p.detalhe ?? ''} ${APELIDOS[p.categoria] ?? p.categoria}`)
}

/** Termos da busca, sem acento e com plural simples (sedas → seda, piteiras → piteira). */
function normalizarBusca(s: string): string[] {
  return semAcento(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

/**
 * Link "Avisar quando chegar": copia a mensagem pronta e abre a DM do Instagram do estado. O WhatsApp da loja fica só
 * pro fechamento do pedido.
 */
export function LinkAvisar({ produto, canal, cidade, className, compacto = false }: { produto: Produto; canal: Canal; cidade: string | null; className?: string; compacto?: boolean }) {
  const avisar = useUI((s) => s.avisar)
  const msg = montarAviso(canal, cidade, produto)
  return (
    <a
      className={`lembrete toque ${compacto ? 'lembrete-p' : ''} ${className ?? ''}`}
      href={linkDM(canal)}
      target={alvoDeSaida()}
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation()
        // cópia síncrona, dentro do toque, antes de sair para o Instagram
        const ok = copiarTexto(msg)
        avisar(ok ? `Mensagem copiada. Cola na DM da @${canal.instagram}.` : `Abre a DM da @${canal.instagram} e pede o aviso.`)
      }}
    >
      <Icone nome="sino" tamanho={compacto ? 14 : 18} />
      <span>Avisar quando chegar</span>
    </a>
  )
}

function Anel({ total, acesos, tamanho = 66 }: { total: number; acesos: number; tamanho?: number }) {
  const r = tamanho / 2 - 2
  const c = 2 * Math.PI * r
  const n = Math.max(1, total)
  const folga = n > 1 ? 4 : 0
  const seg = c / n - folga
  return (
    <svg className="anel" width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i}
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={i < acesos ? '#fff' : '#3a3a3a'}
          strokeWidth={2}
          strokeDasharray={`${seg} ${c - seg}`}
          strokeDashoffset={-(i * (c / n)) + c / 4}
        />
      ))}
    </svg>
  )
}

/** Bolha de um interativo (não é filtro): anel aceso como story não visto, selo "novo" até a 1ª abertura. */
function DestaqueInterativo({ i }: { i: Interativo }) {
  const e = i.useEntrada!()
  const abrir = useUI((s) => s.abrirInterativo)
  return (
    <button type="button" className="destaque destaque-interativo toque" onClick={() => abrir(i.id)} aria-label={e.aria}>
      <span className="destaque-bola">
        <span className={`anel-interativo${e.aceso ? ' aceso' : ''}`}>
          <Anel total={1} acesos={e.aceso ? 1 : 0} />
        </span>
        <span className="destaque-capa">
          <Icone nome={i.icone} tamanho={32} />
        </span>
        {e.novo && (
          <span className="destaque-novo carimbo" aria-hidden="true">
            novo
          </span>
        )}
      </span>
      <span className="destaque-rot">{e.rotulo}</span>
    </button>
  )
}

/** O destaque real do estado (moto): abre o story de atendimento (horário, entrega, cidades). */
function DestaqueEstado({ canal, abrirInfo }: { canal: Canal; abrirInfo: () => void }) {
  return (
    <button type="button" className="destaque toque" onClick={abrirInfo} aria-label={`${canal.destaque}: atendimento, horário e entrega`}>
      <span className="destaque-bola">
        <Anel total={1} acesos={1} />
        <span className="destaque-capa">
          <Icone nome="moto" tamanho={32} />
        </span>
      </span>
      <span className="destaque-rot">{canal.destaque}</span>
    </button>
  )
}

/** As categorias (Tudo, Importadas, Destilados…): filtros da grade, com o anel contando os disponíveis no estado. */
function FiltrosCategoria({ categoria, setCategoria }: { categoria: string; setCategoria: (c: string) => void }) {
  const { produtos, categorias } = useCatalogo()
  const uf = useLocal((s) => s.uf)
  const itens = [{ id: 'tudo', nome: 'Tudo', curto: 'Tudo', icone: 'tudo' }, ...categorias]
  return (
    <>
      {itens.map((c) => {
        const daCat = produtos.filter((p) => c.id === 'tudo' || p.categoria === c.id)
        const acesos = daCat.filter((p) => disponivelEm(p, uf)).length
        const sel = categoria === c.id
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={sel}
            className={`destaque toque ${sel ? 'sel' : ''}`}
            onClick={() => setCategoria(c.id)}
            aria-label={`${c.nome}: ${uf ? `${acesos} de ${daCat.length} disponíveis` : `${daCat.length} produtos`}`}
          >
            <span className="destaque-bola">
              <Anel total={c.id === 'tudo' ? 1 : daCat.length} acesos={c.id === 'tudo' ? 1 : uf ? acesos : daCat.length} />
              <span className="destaque-capa">
                {c.id === 'tudo' ? <Avatar tamanho={50} anel={false} /> : <Icone nome={c.icone} tamanho={32} />}
              </span>
            </span>
            <span className="destaque-rot">{c.curto}</span>
            {sel && <span className="destaque-cursor" aria-hidden="true" />}
          </button>
        )
      })}
    </>
  )
}

/** Bolinhas de destaque da aba Catálogo: o destaque real do estado (moto), os interativos e as categorias. */
function Destaques({ categoria, setCategoria, abrirInfo }: { categoria: string; setCategoria: (c: string) => void; abrirInfo: () => void }) {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf)
  return (
    // filtros, não abas (não há painel por aba): grupo de botões de alternar
    <div className="destaques" role="group" aria-label="Categorias">
      {canal && <DestaqueEstado canal={canal} abrirInfo={abrirInfo} />}
      {interativosAtivos().map((i) => (
        <DestaqueInterativo key={i.id} i={i} />
      ))}
      <FiltrosCategoria categoria={categoria} setCategoria={setCategoria} />
    </div>
  )
}

/**
 * Destaque que leva a outra aba (Buscar, Por estado): link de verdade, como as abas da barra (Ctrl/⌘/botão do meio
 * abre numa aba nova). Anel apagado, como o destaque já visto do Instagram: é caminho, não novidade.
 */
function DestaqueAba({ aba, foco, rotulo, nome, children }: { aba: Aba; foco?: FocoAba; rotulo: string; nome: string; children: ReactNode }) {
  return (
    <a
      className="destaque toque"
      href={hrefAba(aba)}
      data-destaque={aba}
      aria-label={nome}
      onClick={(e) => {
        if (cliqueDeAba(e)) irParaAba(aba, foco ? { foco } : {})
      }}
    >
      <span className="destaque-bola">
        <Anel total={1} acesos={0} />
        <span className="destaque-capa">{children}</span>
      </span>
      <span className="destaque-rot">{rotulo}</span>
    </a>
  )
}

/**
 * Rateio: caminho pra aba (link de verdade, como os outros), com o anel aceso enquanto tem rateio aberto pro estado e o
 * selo "novo" até a pessoa ver os abertos na aba. Só de 560 px em diante (Catalogo.css): no celular o Rateio está na
 * barra de baixo, com o número de abertos, e os filtros do Início continuam à vista.
 */
function DestaqueRateio() {
  const uf = useLocal((s) => s.uf)
  const n = useQuantosAbertos(uf)
  const novo = useRateioNovo(uf)
  return (
    <a
      className="destaque destaque-interativo toque"
      href={hrefAba('rateio')}
      data-destaque="rateio"
      aria-label={n ? `Rateio: ${n} ${n === 1 ? 'aberto' : 'abertos'}${novo ? ', novo' : ''}` : 'Rateio: compra junto, paga menos'}
      onClick={(e) => {
        if (cliqueDeAba(e)) irParaAba('rateio')
      }}
    >
      <span className="destaque-bola">
        <span className={`anel-interativo${n ? ' aceso' : ''}`}>
          <Anel total={1} acesos={n ? 1 : 0} />
        </span>
        <span className="destaque-capa">
          <PixelArte grade={iconesAbas.caixa} tamanho={32} />
        </span>
        {novo && (
          <span className="destaque-novo carimbo" aria-hidden="true">
            novo
          </span>
        )}
      </span>
      <span className="destaque-rot">Rateio</span>
    </a>
  )
}

/**
 * Setas nas pontas da linha de destaques do Início (computador com mouse), como a bandeja de destaques do instagram.com:
 * de 900 a ~1170 px a linha não cabe, a barra de rolagem fica escondida e a roda comum desce a página. Só aparecem do
 * lado que ainda tem destaque escondido. Shift + roda também anda de lado (o Lenis engolia o gesto).
 */
function useSetasLinha(linha: RefObject<HTMLDivElement | null>) {
  const [setas, setSetas] = useState({ antes: false, depois: false })
  useEffect(() => {
    const el = linha.current
    if (!el) return
    let mouse: MediaQueryList | null = null
    try {
      // só no layout de computador: celular com caneta (hover e ponteiro fino) arrasta a linha com o dedo
      mouse = window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)')
    } catch {
      mouse = null
    }
    let raf = 0
    const medir = () => {
      raf = 0
      const fino = !!mouse?.matches
      const max = el.scrollWidth - el.clientWidth
      const antes = fino && el.scrollLeft > 1
      const depois = fino && el.scrollLeft < max - 1
      setSetas((s) => (s.antes === antes && s.depois === depois ? s : { antes, depois }))
    }
    const pedir = () => {
      if (!raf) raf = requestAnimationFrame(medir)
    }
    // Shift + roda: deixa o navegador rolar a linha de lado, sem o Lenis (que trataria como rolagem da página)
    const roda = (e: WheelEvent) => {
      if (e.shiftKey && el.scrollWidth > el.clientWidth) (e as WheelEvent & { lenisStopPropagation?: boolean }).lenisStopPropagation = true
    }
    medir()
    el.addEventListener('scroll', pedir, { passive: true })
    el.addEventListener('wheel', roda, { passive: true })
    // a linha e os dois grupos (o destaque do estado e o interativo entram depois e alargam o grupo)
    const ro = new ResizeObserver(pedir)
    ro.observe(el)
    for (const filho of el.children) ro.observe(filho)
    mouse?.addEventListener?.('change', pedir)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', pedir)
      el.removeEventListener('wheel', roda)
      ro.disconnect()
      mouse?.removeEventListener?.('change', pedir)
    }
  }, [linha])
  return setas
}

/** Uma das setas da linha: só para o mouse (o teclado chega em cada destaque pelo Tab, e a linha acompanha o foco). */
function SetaLinha({ lado, linha }: { lado: 'esq' | 'dir'; linha: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      type="button"
      className={`destaques-seta destaques-seta-${lado}`}
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => {
        const el = linha.current
        if (!el) return
        // uma página da linha de cada vez, deixando um destaque da página de antes à vista
        el.scrollBy({ left: (lado === 'dir' ? 1 : -1) * Math.max(120, el.clientWidth - 160), behavior: movimentoReduzido() ? 'auto' : 'smooth' })
      }}
    >
      <span className="destaques-seta-disco">
        <Icone nome={lado === 'dir' ? 'chevron-dir' : 'chevron-esq'} tamanho={16} />
      </span>
    </button>
  )
}

/**
 * Destaques do Início, numa linha só: primeiro os que são caminho (o destaque do estado, Buscar, Rateio — só em tela
 * larga —, os interativos, Por estado), um fio, e à direita os filtros, que filtram a grade do próprio Início. No celular
 * a linha é mais compacta (Catalogo.css) para o primeiro filtro aparecer inteiro, com o seguinte espiando na borda.
 */
function DestaquesInicio({ categoria, setCategoria, abrirInfo }: { categoria: string; setCategoria: (c: string) => void; abrirInfo: () => void }) {
  const uf = useLocal((s) => s.uf)
  // o href das abas leva uf e cidade junto
  useLocal((s) => s.cidade)
  const canal = canalDa(uf)
  const linha = useRef<HTMLDivElement>(null)
  const setas = useSetasLinha(linha)
  return (
    <div className="destaques-moldura">
      <div ref={linha} className="destaques destaques-inicio">
        <nav className="destaques-grupo" aria-label="Atalhos da loja">
          {canal && <DestaqueEstado canal={canal} abrirInfo={abrirInfo} />}
          <DestaqueAba aba="catalogo" foco="busca" rotulo="Buscar" nome="Buscar no catálogo">
            <Icone nome="lupa" tamanho={32} />
          </DestaqueAba>
          <DestaqueRateio />
          {interativosAtivos().map((i) => (
            <DestaqueInterativo key={i.id} i={i} />
          ))}
          <DestaqueAba aba="estados" rotulo="Por estado" nome="Por estado: os perfis de cada estado">
            <Icone nome="pin" tamanho={32} />
            {uf && (
              <span className="destaque-uf px" aria-hidden="true">
                {uf.toUpperCase()}
              </span>
            )}
          </DestaqueAba>
        </nav>
        <span className="destaques-fio" aria-hidden="true" />
        <div className="destaques-grupo" role="group" aria-label="Categorias">
          <FiltrosCategoria categoria={categoria} setCategoria={setCategoria} />
        </div>
      </div>
      {setas.antes && <SetaLinha lado="esq" linha={linha} />}
      {setas.depois && <SetaLinha lado="dir" linha={linha} />}
    </div>
  )
}

/** Adesivo "caixa de perguntas" do story: entrada da encomenda. */
export function CaixaEncomenda({ termo, className }: { termo?: string; className?: string }) {
  const abrir = useChat((s) => s.abrir)
  const [v, setV] = useState(termo ?? '')
  return (
    <form
      className={`caixa-perguntas ${className ?? ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        abrir('encomenda', { produtoEncomenda: v.trim() })
      }}
    >
      <span className="caixa-avatar">
        <Avatar tamanho={44} />
      </span>
      <p className="caixa-titulo">{termo ? `Não achou “${termo}”? A Green Cheese importa.` : 'Não achou? A Green Cheese importa.'}</p>
      <div className="caixa-campo">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Digite o produto…" aria-label="Produto que você quer encomendar" maxLength={120} />
      </div>
      <button type="submit" className="botao botao-cheio botao-largo caixa-enviar">
        {termo ? `Pedir encomenda de “${termo}”` : 'Pedir encomenda'}
      </button>
    </form>
  )
}

interface PropsCatalogo {
  abrirInfo: () => void
  /**
   * 'aba': a aba Catálogo (destaques, busca, Só DISPONÍVEL; ids catalogo/catalogo-titulo, que o chat e a rolagem usam).
   * 'inicio': a loja no fim do Início (destaques com as abas primeiro, sem busca; ids próprios).
   */
  onde?: 'aba' | 'inicio'
  /** false: só os destaques, a grade ainda não montou (o Início monta ela no primeiro respiro, ver Abas.tsx). */
  comGrade?: boolean
}

export function Catalogo({ abrirInfo, onde = 'aba', comGrade = true }: PropsCatalogo) {
  const inicio = onde === 'inicio'
  const { produtos } = useCatalogo()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const abrirStory = useUI((s) => s.abrirStory)
  const [categoria, setCategoria] = useState('tudo')
  const [busca, setBusca] = useState('')
  const [soDisp, setSoDisp] = useState(false)
  const grade = useRef<HTMLUListElement>(null)
  const flip = useRef<ReturnType<FlipT['getState']> | null>(null)

  useEffect(() => {
    const t = setTimeout(carregarFlip, 1500)
    return () => clearTimeout(t)
  }, [])

  const lista = useMemo(() => {
    const q = normalizarBusca(busca)
    const r = produtos.filter((p) => {
      if (categoria !== 'tudo' && p.categoria !== categoria) return false
      if (soDisp && !disponivelEm(p, uf)) return false
      if (q && !q.every((t) => textoDeBusca(p).includes(t))) return false
      return true
    })
    // disponíveis primeiro (ordem estável)
    return uf ? [...r.filter((p) => disponivelEm(p, uf)), ...r.filter((p) => !disponivelEm(p, uf))] : r
  }, [produtos, categoria, soDisp, busca, uf])

  // reorganiza a grade com Flip ao trocar filtro/categoria (voz app)
  const comFlip = (f: () => void) => {
    carregarFlip()
    if (FlipMod && grade.current && !movimentoReduzido()) flip.current = FlipMod.getState(grade.current.querySelectorAll('.card'), { simple: true })
    f()
  }
  useLayoutEffect(() => {
    if (!flip.current || !FlipMod) return
    const st = flip.current
    flip.current = null
    // só posição, medida pela caixa (simple): sem rotação nem escala na grade, e as células têm o mesmo tamanho. Sem
    // absolute/nested e sem a matriz de cada card, que mediam e remediam o estilo e o layout da página card a card (1,3
    // s por toque num Android médio). Os que saem já saíram do DOM com o React; os que entram (targets: a grade de
    // agora) aparecem em degrau, e quem não andou fica de fora (prune)
    FlipMod.from(st, {
      targets: grade.current?.querySelectorAll('.card'),
      duration: 0.42,
      ease: 'power3.inOut',
      simple: true,
      prune: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'steps(3)' }),
    })
  }, [lista])

  const cidadeNome = nomeCidade(canal, cidade, cidadeInformada)

  const trocarCategoria = (c: string) => comFlip(() => setCategoria(c))

  return (
    // aba: o título (h1 "Catálogo", id catalogo-titulo) fica no cabeçalho da aba (Abas.tsx). Início: título só para
    // leitor de tela (a loja vem logo depois do perfil, como os destaques e a grade de um perfil do Instagram)
    <section
      id={inicio ? 'inicio-loja' : 'catalogo'}
      className={`catalogo${inicio ? ' catalogo-inicio' : ''}`}
      aria-labelledby={inicio ? 'inicio-loja-titulo' : 'catalogo-titulo'}
    >
      {inicio && (
        <h2 id="inicio-loja-titulo" className="sr-only" tabIndex={-1}>
          Loja
        </h2>
      )}
      {inicio ? (
        <DestaquesInicio categoria={categoria} setCategoria={trocarCategoria} abrirInfo={abrirInfo} />
      ) : (
        <Destaques categoria={categoria} setCategoria={trocarCategoria} abrirInfo={abrirInfo} />
      )}

      {!inicio && (
        <div className="filtros">
          <label className="busca">
            <Icone nome="lupa" tamanho={18} />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="gin, seda, piteira…"
              aria-label="Buscar produto"
              enterKeyHint="search"
            />
          </label>
          <button
            type="button"
            className={`chip-disp px toque ${soDisp ? 'ativo' : ''}`}
            aria-pressed={soDisp}
            onClick={() => comFlip(() => setSoDisp((v) => !v))}
            disabled={!canal}
          >
            Só DISPONÍVEL ✅
          </button>
        </div>
      )}

      {!uf && <p className="catalogo-aviso legenda">Escolhe teu estado no adesivo lá em cima pra ver o que tem disponível.</p>}

      {!comGrade ? (
        // a grade entra no primeiro respiro: o lugar dela fica guardado (o rodapé não sobe e desce)
        <div className="grade-espera" />
      ) : lista.length === 0 ? (
        <div className="catalogo-vazio">
          <CaixaEncomenda termo={busca.trim() || undefined} key={busca} />
        </div>
      ) : (
        <ul className="grade" ref={grade}>
          {lista.map((p, i) => {
            const disp = uf ? (canal ? disponivelEm(p, uf) : false) : null
            return (
              <li key={p.id} className={`card ${disp === false && canal ? 'card-off' : ''}`} data-flip-id={p.id}>
                <button
                  type="button"
                  className="card-abrir"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    abrirStory(
                      lista.map((x) => x.id),
                      i,
                      r,
                    )
                  }}
                  aria-label={`${p.nome}${p.preco == null ? ', preço a consultar' : ''}${disp === true ? ', disponível' : disp === false ? ', indisponível' : ''}. Abrir story`}
                >
                  <StoryQuadro produto={p} escala="card" disponivel={disp} />
                </button>
                {disp === false && canal && <LinkAvisar produto={p} canal={canal} cidade={cidadeNome} compacto className="card-avisar" />}
                {p.demo && config.carimboDeExemplo && <span className="card-demo carimbo">exemplo</span>}
              </li>
            )
          })}
          <li className="card card-caixa" data-flip-id="caixa">
            <CaixaEncomenda />
          </li>
        </ul>
      )}
    </section>
  )
}
