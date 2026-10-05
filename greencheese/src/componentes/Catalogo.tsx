import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { canalDa, type Canal } from '../dados/canais'
import { config } from '../dados/config'
import { interativosAtivos, type Interativo } from '../interativos/registro'
import { semAcento } from '../dados/ufs'
import { alvoDeSaida } from '../lib/ambiente'
import { copiarTexto } from '../lib/copiar'
import { linkDM, linkWhatsApp, montarAviso } from '../lib/mensagem'
import { movimentoReduzido } from '../lib/movimento'
import type { Produto } from '../lib/tipos'
import { disponivelEm, useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { nomeCidade, useLocal } from '../store/local'
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

/** Link "Avisar quando chegar": WhatsApp com a mensagem pronta; sem número, copia e abre a DM do estado. */
export function LinkAvisar({ produto, canal, cidade, className, compacto = false }: { produto: Produto; canal: Canal; cidade: string | null; className?: string; compacto?: boolean }) {
  const avisar = useUI((s) => s.avisar)
  const msg = montarAviso(canal, cidade, produto)
  const href = canal.whatsapp ? linkWhatsApp(canal, msg) : linkDM(canal)
  return (
    <a
      className={`lembrete toque ${compacto ? 'lembrete-p' : ''} ${className ?? ''}`}
      href={href}
      target={alvoDeSaida()}
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation()
        if (!canal.whatsapp) {
          const ok = copiarTexto(msg)
          avisar(ok ? `Mensagem copiada. Cola na DM da @${canal.instagram}.` : `Abre a DM da @${canal.instagram} e pede o aviso.`)
        }
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

/** Bolinhas de destaque: o destaque real do estado (moto), os interativos e as categorias. */
function Destaques({ categoria, setCategoria, abrirInfo }: { categoria: string; setCategoria: (c: string) => void; abrirInfo: () => void }) {
  const { produtos, categorias } = useCatalogo()
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf)
  const itens = [{ id: 'tudo', nome: 'Tudo', curto: 'Tudo', icone: 'tudo' }, ...categorias]
  return (
    // filtros, não abas (não há painel por aba): grupo de botões de alternar
    <div className="destaques" role="group" aria-label="Categorias">
      {canal && (
        <button type="button" className="destaque toque" onClick={abrirInfo} aria-label={`${canal.destaque}: atendimento, horário e entrega`}>
          <span className="destaque-bola">
            <Anel total={1} acesos={1} />
            <span className="destaque-capa">
              <Icone nome="moto" tamanho={32} />
            </span>
          </span>
          <span className="destaque-rot">{canal.destaque}</span>
        </button>
      )}
      {interativosAtivos().map((i) => (
        <DestaqueInterativo key={i.id} i={i} />
      ))}
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

export function Catalogo({ abrirInfo }: { abrirInfo: () => void }) {
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
    if (FlipMod && grade.current && !movimentoReduzido()) flip.current = FlipMod.getState(grade.current.querySelectorAll('.card'))
    f()
  }
  useLayoutEffect(() => {
    if (!flip.current || !FlipMod) return
    const st = flip.current
    flip.current = null
    FlipMod.from(st, {
      duration: 0.42,
      ease: 'power3.inOut',
      absolute: true,
      nested: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'steps(3)' }),
      onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.2, ease: 'steps(3)' }),
    })
  }, [lista])

  const cidadeNome = nomeCidade(canal, cidade, cidadeInformada)

  return (
    <section id="catalogo" className="catalogo" aria-labelledby="catalogo-titulo">
      <h2 id="catalogo-titulo" className="sr-only">
        Catálogo
      </h2>
      <Destaques categoria={categoria} setCategoria={(c) => comFlip(() => setCategoria(c))} abrirInfo={abrirInfo} />

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

      {!uf && <p className="catalogo-aviso legenda">Escolhe teu estado no adesivo lá em cima pra ver o que tem disponível.</p>}

      {lista.length === 0 ? (
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
                {p.demo && config.modoPrevia && <span className="card-demo carimbo">exemplo</span>}
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
