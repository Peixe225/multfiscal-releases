// A lista de bairros da taxa por bairro (painel → Estado → Taxa de entrega → Por bairro; pedido do Ian em 22/10): o
// bairro (e a cidade, quando o estado entrega em mais de uma) com a taxa ou "consultar". Buscar, adicionar, editar,
// apagar e COLAR UMA LISTA (uma linha por bairro: bairros-colar.ts), com a prévia do que o painel entendeu antes de
// aplicar. Até 400 por estado. Nada vem de fábrica: taxa é preço, só o dono põe. A lista é parte do formulário do
// estado: vai junto no Salvar (e fica no rascunho do aparelho até lá). O bairro digitado no formulário de baixo (novo,
// ou a edição sem o "Pronto") também é do formulário do estado: o Salvar aplica ele (como a cidade digitada), com as
// mesmas conferências do "Adicionar". "Trocar a lista toda" pergunta antes quando tira bairro da lista.
import { useMemo, useRef, useState } from 'react'
import { chaveBairro, MAX_BAIRROS } from '../../lib/bairros'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { brl, reaisNoCampo } from '../formato'
import { Aviso, Botao, Ic } from '../ui'
import { aplicarColada, aplicarRascunho, chaveDaLista, lerListaColada, RASCUNHO_VAZIO, rascunhoPendente, situacoes, type RascunhoBairro } from './bairros-colar'
import type { BairroAdmin } from './tipos'

/** Até quantos a lista mostra de uma vez (o resto num toque: "Mostrar todos"). */
const POR_VEZ = 60

const taxaTexto = (t: number | null) => (t == null ? 'consultar' : t === 0 ? 'sem taxa' : brl(t))

interface Props {
  bairros: BairroAdmin[]
  cidades: string[]
  /** 'site' = a lista aparece no site; 'consulta' = só o painel e o aviso do grupo usam. */
  ver: 'site' | 'consulta'
  aoMudar: (b: BairroAdmin[]) => void
  /** O bairro sendo digitado no formulário de baixo (fica no formulário do estado: o Salvar aplica). */
  rascunho: RascunhoBairro
  aoMudarRascunho: (r: RascunhoBairro) => void
  /** O erro do servidor (campo bairros) ou da conferência do formulário. */
  erro?: string
}

export function Bairros({ bairros, cidades, ver, aoMudar, rascunho: edicao, aoMudarRascunho, erro }: Props) {
  const variasCidades = cidades.length > 1
  const [busca, setBusca] = useState('')
  const [todos, setTodos] = useState(false)
  const setEdicao = (f: (x: RascunhoBairro) => RascunhoBairro) => aoMudarRascunho(f(edicao))
  const [falha, setFalha] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [colando, setColando] = useState(false)
  const [colado, setColado] = useState('')
  const [cidadeColada, setCidadeColada] = useState('')
  const [modoColar, setModoColar] = useState<'juntar' | 'trocar'>('juntar')
  const [falhaColar, setFalhaColar] = useState<string | null>(null)
  const campoNome = useRef<HTMLInputElement>(null)
  const campoColar = useRef<HTMLTextAreaElement>(null)

  const filtrados = useMemo(() => {
    const t = chaveBairro(busca)
    return t ? bairros.filter((b) => chaveBairro(`${b.nome} ${b.cidade ?? ''}`).includes(t)) : bairros
  }, [bairros, busca])
  const mostrar = todos || busca ? filtrados : filtrados.slice(0, POR_VEZ)
  const lidas = useMemo(() => (colado.trim() ? lerListaColada(colado, cidades, cidadeColada) : []), [colado, cidades, cidadeColada])
  const previa = useMemo(() => situacoes(lidas, modoColar === 'juntar' ? bairros : []), [lidas, bairros, modoColar])
  const conta = (s: string) => previa.filter((p) => p.situacao === s).length
  const entram = conta('novo') + conta('muda') + (modoColar === 'trocar' ? conta('igual') : 0)

  const editando = edicao.chave !== null
  const pendente = rascunhoPendente(bairros, edicao)
  const limparEdicao = () => {
    aoMudarRascunho(RASCUNHO_VAZIO)
    setFalha(null)
  }

  /** Adicionar (ou salvar a edição de) um bairro, com as mesmas conferências do servidor. */
  const confirmar = () => {
    const r = aplicarRascunho(bairros, edicao, variasCidades)
    if (!r.lista) {
      setFalha(r.problema)
      if (r.campo === 'nome') campoNome.current?.focus()
      return
    }
    aoMudar(r.lista)
    limparEdicao()
    campoNome.current?.focus()
  }

  const aplicar = () => {
    const r = aplicarColada(bairros, lidas, modoColar)
    if (!r.lista) {
      setFalhaColar(r.problema)
      return
    }
    const nova = r.lista
    const feito = () => {
      aoMudar(nova)
      setColado('')
      setColando(false)
      setFalhaColar(null)
    }
    // trocar a lista toda tira os bairros que não vieram na colada: pergunta antes (até 400 bairros saem num toque)
    const ficam = new Set(nova.map(chaveDaLista))
    const saem = modoColar === 'trocar' ? bairros.filter((b) => !ficam.has(chaveDaLista(b))).length : 0
    if (saem > 0) {
      const n = (x: number) => `${x} ${x === 1 ? 'bairro' : 'bairros'}`
      setConfirmacao({
        titulo: 'Trocar a lista toda?',
        texto: (
          <p>
            A lista de agora ({n(bairros.length)}) sai e fica só a colada ({n(nova.length)}): {saem === 1 ? '1 bairro que não tá na lista colada sai' : `${saem} bairros que não tão na lista colada saem`}. O site só muda quando tu salvar o estado.
          </p>
        ),
        botao: `Trocar pela lista colada (${n(nova.length)})`,
        cancelar: 'Deixa a lista como tá',
        perigo: true,
        acao: async () => feito(),
      })
      return
    }
    feito()
  }

  const formulario = (
    <div className={`pn-bairro-form${falha ? ' pn-campo-erro' : ''}`} role="group" aria-label={editando ? `Editar ${edicao.nome}` : 'Bairro novo'}>
      <div className="pn-bairro-campos">
        <label className="pn-bairro-c pn-bairro-c-nome">
          <span className="pn-rotulo">{editando ? 'Bairro' : 'Bairro novo'}</span>
          <input
            ref={campoNome}
            id="e-bairros"
            className="pn-input"
            placeholder="Ex.: Copacabana"
            autoComplete="off"
            maxLength={60}
            value={edicao.nome}
            aria-describedby={falha ? 'e-bairro-erro' : undefined}
            onChange={(e) => {
              setEdicao((x) => ({ ...x, nome: e.target.value }))
              setFalha(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmar()
              }
            }}
          />
        </label>
        {variasCidades && (
          <label className="pn-bairro-c pn-bairro-c-cidade">
            <span className="pn-rotulo">Cidade</span>
            <select className="pn-input pn-select" value={edicao.cidade} onChange={(e) => setEdicao((x) => ({ ...x, cidade: e.target.value }))}>
              <option value="">Qualquer cidade</option>
              {cidades.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="pn-bairro-c pn-bairro-c-taxa">
          <span className="pn-rotulo">Taxa</span>
          <span className="pn-reais">
            <span aria-hidden="true">R$</span>
            <input
              className="pn-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="consultar"
              value={edicao.taxa}
              onChange={(e) => {
                setEdicao((x) => ({ ...x, taxa: e.target.value.replace(/[^\d,.]/g, '').slice(0, 7) }))
                setFalha(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmar()
                }
              }}
            />
          </span>
        </label>
      </div>
      <div className="pn-bairro-acoes">
        <Botao variante="cinza" icone={editando ? 'check' : 'mais'} onClick={confirmar}>
          {editando ? 'Pronto' : 'Adicionar bairro'}
        </Botao>
        {editando && (
          <Botao variante="texto" onClick={limparEdicao}>
            Cancelar
          </Botao>
        )}
      </div>
      {falha || erro ? (
        <p id="e-bairro-erro" className="pn-erro">
          <Ic nome="atencao" tamanho={16} />
          <span>{falha ?? erro}</span>
        </p>
      ) : pendente ? (
        // o bairro digitado sem o "Adicionar" (ou a edição sem o "Pronto"): entra quando salvar o estado
        <p className="pn-dica pn-bairro-pendente">
          {editando ? `A mudança em “${edicao.nome.trim() || 'esse bairro'}” vale quando tu salvar (ou toca em Pronto).` : `“${edicao.nome.trim().replace(/\s+/g, ' ')}” entra na lista quando tu salvar.`}
        </p>
      ) : (
        <p className="pn-dica">Taxa vazia = consultar (o site diz “a consultar” e a loja passa no atendimento).</p>
      )}
    </div>
  )

  return (
    <div className="pn-bairros">
      <div className="pn-bairros-topo">
        <p className="pn-dica pn-bairros-conta" aria-live="polite">
          {bairros.length === 0 ? 'Nenhum bairro ainda.' : `${bairros.length} ${bairros.length === 1 ? 'bairro' : 'bairros'} na lista (até ${MAX_BAIRROS}).`}
        </p>
        <Botao
          variante="cinza"
          icone="copiar"
          aria-expanded={colando}
          onClick={() => {
            setColando((x) => !x)
            setFalhaColar(null)
            window.requestAnimationFrame(() => campoColar.current?.focus())
          }}
        >
          Colar uma lista
        </Botao>
      </div>

      {colando && (
        <div className="pn-bairros-colar">
          <label className="pn-rotulo" htmlFor="e-bairros-colar">
            Cola a lista: um bairro por linha
          </label>
          <textarea
            ref={campoColar}
            id="e-bairros-colar"
            className="pn-input pn-texto"
            rows={6}
            spellCheck={false}
            placeholder={'Copacabana: 12\nIpanema; 12,50\nBotafogo, Flamengo, Catete: 15\nRecreio'}
            value={colado}
            aria-describedby="e-bairros-colar-dica"
            onChange={(e) => {
              setColado(e.target.value)
              setFalhaColar(null)
            }}
          />
          <p id="e-bairros-colar-dica" className="pn-dica">
            “Bairro: taxa” ou “Bairro; taxa”. Vários com a mesma taxa: “Botafogo, Flamengo: 15”. Linha sem valor = consultar.
            {variasCidades ? ' A cidade entre parênteses vale só pra aquele: “Centro (Vila Velha): 10”.' : ''}
          </p>
          {variasCidades && (
            <label className="pn-bairro-c">
              <span className="pn-rotulo">Cidade desses bairros</span>
              <select className="pn-input pn-select" value={cidadeColada} onChange={(e) => setCidadeColada(e.target.value)}>
                <option value="">Qualquer cidade</option>
                {cidades.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bairros.length > 0 && (
            <fieldset className="pn-opcoes">
              <legend className="sr-only">O que fazer com a lista de agora</legend>
              <label className="pn-opcao">
                <input type="radio" name="bairros-colar-modo" checked={modoColar === 'juntar'} onChange={() => setModoColar('juntar')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Juntar com a lista
                  <small>o que já tem fica; o bairro que veio de novo troca a taxa</small>
                </span>
              </label>
              <label className="pn-opcao">
                <input type="radio" name="bairros-colar-modo" checked={modoColar === 'trocar'} onChange={() => setModoColar('trocar')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Trocar a lista toda
                  <small>fica só o que tá colado aqui</small>
                </span>
              </label>
            </fieldset>
          )}
          {previa.length > 0 && (
            <div className="pn-bairros-previa">
              <p className="pn-rotulo">
                O que eu entendi: {[conta('novo') && `${conta('novo')} ${conta('novo') === 1 ? 'novo' : 'novos'}`, conta('muda') && `${conta('muda')} ${conta('muda') === 1 ? 'muda' : 'mudam'}`, conta('igual') && `${conta('igual')} igual`, conta('problema') && `${conta('problema')} com problema`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {/* a prévia rola sozinha quando é comprida: o foco do teclado entra nela pra rolar */}
              <ul className="pn-bairros-lista pn-bairros-lista-previa" aria-label="Prévia da lista colada" tabIndex={0}>
                {previa.map((p, i) => (
                  <li key={i} className={`pn-bairro-linha pn-previa-${p.situacao}`}>
                    <span className="pn-bairro-nome">
                      <strong>{p.linha.nome || p.linha.texto}</strong>
                      {p.linha.cidade && <small> · {p.linha.cidade}</small>}
                      <small className="pn-bairro-sit">
                        {p.situacao === 'novo'
                          ? 'novo'
                          : p.situacao === 'muda'
                            ? `muda: era ${taxaTexto(p.antes?.taxa ?? null)}`
                            : p.situacao === 'igual'
                              ? 'igual ao que já tem'
                              : p.situacao === 'repetido'
                                ? 'repetido: vale o de baixo'
                                : `fica de fora: ${p.linha.problema}`}
                      </small>
                      {p.situacao !== 'problema' && p.linha.aviso && <small className="pn-bairro-problema">{p.linha.aviso}</small>}
                    </span>
                    <span className="pn-bairro-taxa">{p.situacao === 'problema' ? '' : taxaTexto(p.linha.taxa)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {falhaColar && <Aviso tipo="erro">{falhaColar}</Aviso>}
          <div className="pn-bairro-acoes">
            <Botao variante="cheio" disabled={entram === 0} onClick={aplicar}>
              {modoColar === 'trocar' ? 'Trocar a lista' : entram === 1 ? 'Aplicar 1 bairro' : `Aplicar ${entram} bairros`}
            </Botao>
            <Botao
              variante="texto"
              onClick={() => {
                setColando(false)
                setColado('')
                setFalhaColar(null)
              }}
            >
              Cancelar
            </Botao>
          </div>
          <p className="pn-dica">Aplicar muda a lista aqui; vai pro site quando tu salvar o estado.</p>
        </div>
      )}

      {bairros.length > 8 && (
        <div className="pn-busca">
          <Ic nome="lupa" tamanho={16} />
          <input type="search" className="pn-input" placeholder="Buscar bairro" aria-label="Buscar bairro" autoComplete="off" enterKeyHint="search" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}

      {bairros.length > 0 && (
        <ul className="pn-bairros-lista" aria-label="Bairros e taxas">
          {mostrar.map((b) => {
            const k = chaveDaLista(b)
            return (
              <li key={k} className={`pn-bairro-linha${edicao.chave === k ? ' pn-bairro-editando' : ''}`}>
                <span className="pn-bairro-nome">
                  <strong>{b.nome}</strong>
                  {b.cidade && <small> · {b.cidade}</small>}
                </span>
                <span className="pn-bairro-taxa">{taxaTexto(b.taxa)}</span>
                <span className="pn-bairro-botoes">
                  <button
                    type="button"
                    className="icone-botao"
                    aria-label={`Editar ${b.nome}`}
                    onClick={() => {
                      aoMudarRascunho({ chave: k, nome: b.nome, cidade: b.cidade ?? '', taxa: reaisNoCampo(b.taxa) })
                      setFalha(null)
                      window.requestAnimationFrame(() => campoNome.current?.focus())
                    }}
                  >
                    <Ic nome="editar" tamanho={16} />
                  </button>
                  <button
                    type="button"
                    className="icone-botao"
                    aria-label={`Apagar ${b.nome}`}
                    onClick={() => {
                      aoMudar(bairros.filter((x) => chaveDaLista(x) !== k))
                      if (edicao.chave === k) limparEdicao()
                    }}
                  >
                    <Ic nome="lixo" tamanho={16} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {busca && filtrados.length === 0 && <p className="pn-dica">Nenhum bairro com “{busca}”.</p>}
      {!todos && !busca && filtrados.length > POR_VEZ && (
        <Botao variante="texto" onClick={() => setTodos(true)}>
          Mostrar todos ({filtrados.length})
        </Botao>
      )}

      {formulario}

      {ver === 'site' && bairros.length === 0 && (
        <Aviso tipo="info">Lista vazia: o site mostra “taxa do bairro a consultar” pra todo bairro.</Aviso>
      )}
      {ver === 'consulta' && (
        <p className="pn-dica">No modo “o cliente consulta”, a lista não aparece no site: ela fica aqui e no aviso do grupo do WhatsApp, pra quem atende saber a taxa.</p>
      )}
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </div>
  )
}
