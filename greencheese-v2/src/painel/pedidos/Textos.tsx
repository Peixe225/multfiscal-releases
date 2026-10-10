// Textos do pedido: cada fala do pedido guiado (o chat do site que monta o pedido) com a prévia do balão. Tocou, abre
// o editor: a prévia ao vivo, os marcadores da fala ({nome}, {cidade}…) pra pôr com um toque, a conferência do
// servidor (tamanho, marcador, promessa de prazo ou frete, tabaco) e o "voltar ao padrão". A mensagem que vai pro
// WhatsApp não muda por aqui.
import { Fragment, useRef, useState, type KeyboardEvent } from 'react'
import { limparFala, marcadoresDe, MAXIMO_TEXTO, pedacosDaFala, problemaDaFala, TEXTOS_PEDIDO, type ChaveTexto } from '../../dados/textos-pedido'
import { useAcao, useDados } from '../dados'
import { quando } from '../formato'
import * as api from '../api'
import { Folha } from '../Folha'
import { Topo } from '../Moldura'
import { termoProibido } from '../proibidos'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import { falas as lerFalas, salvarFala, type Trocas } from './api'
import './estilo'
import { EXEMPLO_MARCADOR, GRUPOS_FALAS, NOME_MARCADOR, ROTULO_FALA } from './falas'

const CHAVES = Object.keys(TEXTOS_PEDIDO) as ChaveTexto[]
const AVISO_TABACO = 'Tabaco e vape não entram no site (Anvisa). Troca essa palavra.'
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** A fala como aparece no chat: balão da loja, resposta da pessoa, botão, dica dentro do campo ou erro embaixo dele. */
export function PreviaFala({ chave, texto }: { chave: ChaveTexto; texto: string }) {
  const tipo = TEXTOS_PEDIDO[chave].tipo
  const conteudo = pedacosDaFala(texto, EXEMPLO_MARCADOR).map((p, i) =>
    'texto' in p ? (
      <Fragment key={i}>{p.texto}</Fragment>
    ) : (
      <span key={i} className="pd-marca">
        {p.valor || `{${p.marcador}}`}
      </span>
    ),
  )
  const classe = { fala: 'pd-bolha pd-bolha-loja', resposta: 'pd-bolha pd-bolha-eu', botao: 'pd-chip', dica: 'pd-campo-dica', erro: 'pd-campo-erro' }[tipo]
  return (
    <span className="pd-previa">
      <span className={classe}>{conteudo}</span>
    </span>
  )
}

/** null = pode salvar; senão, o que tá errado (a mesma conferência do servidor). */
function problema(chave: ChaveTexto, texto: string): string | null {
  return problemaDaFala(chave, texto) ?? (termoProibido(texto) ? AVISO_TABACO : null)
}

function Editor({ chave, troca, aoFechar, aoSalvar }: { chave: ChaveTexto; troca: Trocas[ChaveTexto]; aoFechar: () => void; aoSalvar: (t: { textos: Trocas; recado: string }) => void }) {
  const def = TEXTOS_PEDIDO[chave]
  const [texto, setTexto] = useState(troca?.texto ?? def.padrao)
  const [tentou, setTentou] = useState(false)
  const acao = useAcao()
  const campo = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const max = MAXIMO_TEXTO[def.tipo]
  const marcadores = marcadoresDe(chave)
  const limpo = limparFala(texto)
  const erroLocal = problema(chave, texto)
  // em branco só reclama depois de tentar salvar; o resto (marcador, promessa, tabaco, tamanho) aparece na hora
  const erroVisivel = erroLocal && (tentou || limpo !== '') ? erroLocal : acao.erro?.campo === 'texto' ? acao.erro.message : null
  const igualPadrao = limpo === def.padrao
  const mudou = limpo !== (troca?.texto ?? def.padrao)

  const salvar = async () => {
    setTentou(true)
    if (erroLocal) {
      campo.current?.focus()
      return
    }
    if (!mudou) {
      aoFechar()
      return
    }
    const r = await acao.rodar('salvar', () => salvarFala(chave, igualPadrao ? null : limpo))
    if (r) aoSalvar({ textos: r.textos, recado: igualPadrao ? 'Voltou ao texto de sempre.' : 'Fala trocada. O site usa a nova na próxima vez que alguém abrir o chat.' })
  }
  const padrao = async () => {
    if (!troca) {
      setTexto(def.padrao)
      campo.current?.focus()
      return
    }
    const r = await acao.rodar('padrao', () => salvarFala(chave, null))
    if (r) aoSalvar({ textos: r.textos, recado: 'Voltou ao texto de sempre.' })
  }
  const inserir = (m: string) => {
    const el = campo.current
    const ini = el?.selectionStart ?? texto.length
    const fim = el?.selectionEnd ?? ini
    const antes = texto.slice(0, ini)
    const espaco = antes && !/\s$/.test(antes) ? ' ' : ''
    const novo = `${antes}${espaco}{${m}}${texto.slice(fim)}`
    setTexto(novo)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = ini + espaco.length + m.length + 2
      el.setSelectionRange(pos, pos)
    })
  }
  // a fala é uma linha só: Enter salva em vez de quebrar
  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void salvar()
    }
  }
  const ocupado = acao.ocupado !== null
  const contagem = [...limpo].length

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      preso={ocupado}
      titulo={ROTULO_FALA[chave]}
      sub={troca ? `Trocada ${quando(troca.atualizadoEm, api.agora())}` : 'Com o texto de sempre'}
      focoInicial={campo}
      rodape={
        <div className="pn-botoes">
          <Botao largo ocupado={acao.ocupado === 'salvar'} disabled={ocupado && acao.ocupado !== 'salvar'} onClick={() => void salvar()}>
            Salvar
          </Botao>
          {(troca || !igualPadrao) && (
            <Botao variante="texto" largo ocupado={acao.ocupado === 'padrao'} disabled={ocupado && acao.ocupado !== 'padrao'} onClick={() => void padrao()}>
              Voltar ao padrão
            </Botao>
          )}
        </div>
      }
    >
      <div className="pn-folha-pad pn-form">
        <div className="pd-editor-previa" aria-hidden="true">
          <p className="pd-editor-previa-rot">Prévia</p>
          <PreviaFala chave={chave} texto={limpo || def.padrao} />
        </div>
        <Campo id="tx-fala" rotulo="Texto" erro={erroVisivel} lado={<span className="pn-contagem">{contagem}/{max}</span>} dica={marcadores.length ? 'As palavras entre chaves viram o dado de quem tá pedindo.' : undefined}>
          {(a) =>
            def.tipo === 'fala' ? (
              <textarea {...a} ref={campo} name="texto" className="pn-input pn-texto pd-texto-fala" rows={3} value={texto} onKeyDown={aoTeclar} onChange={(e) => setTexto(e.target.value)} />
            ) : (
              <input {...a} ref={campo} name="texto" className="pn-input" type="text" autoComplete="off" value={texto} onKeyDown={aoTeclar} onChange={(e) => setTexto(e.target.value)} />
            )
          }
        </Campo>
        {marcadores.length > 0 && (
          <div className="pd-marcadores-bloco">
            <p className="pn-rotulo" id="tx-marcadores">
              Pôr um marcador
            </p>
            <div className="pd-marcadores" role="group" aria-labelledby="tx-marcadores">
              {marcadores.map((m) => (
                <button key={m} type="button" className="pd-marcador" onClick={() => inserir(m)}>
                  <code>{`{${m}}`}</code>
                  <small>
                    {NOME_MARCADOR[m] ?? m}
                    {EXEMPLO_MARCADOR[m] ? ` · ex.: ${EXEMPLO_MARCADOR[m]}` : ''}
                  </small>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="pd-padrao">
          Texto de sempre: <q>{def.padrao}</q>
        </p>
        {acao.erro && acao.erro.campo !== 'texto' && <Aviso tipo="erro">{acao.erro.message}</Aviso>}
      </div>
    </Folha>
  )
}

export function Textos() {
  useTitulo('Textos do pedido')
  const leitura = useDados<{ textos: Trocas; versao: string }>('falas', (s) => lerFalas(s))
  const d = leitura.dados
  useRestaurarRolagem(!!d)
  const [editando, setEditando] = useState<ChaveTexto | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [so, setSo] = useState(false)
  const [busca, setBusca] = useState('')
  const trocas: Trocas = d?.textos ?? {}
  const trocadas = CHAVES.filter((k) => trocas[k])
  const termo = semAcento(busca.trim())
  // buscando (ou só as trocadas), os grupos abrem sozinhos com o que achou
  const filtrando = so || termo !== ''
  const achou = (k: ChaveTexto) =>
    (!so || !!trocas[k]) && (!termo || [ROTULO_FALA[k], trocas[k]?.texto ?? '', TEXTOS_PEDIDO[k].padrao].some((t) => semAcento(t).includes(termo)))

  return (
    <>
      <Topo titulo={<TituloTela>Textos do pedido</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pd-textos">
        <p className="pn-dica-bloco pd-textos-intro">
          As falas do chat que monta o pedido no site. Dá pra trocar o jeito de falar de cada uma; a mensagem que vai pro WhatsApp continua igual. Sem promessa de prazo ou frete: a loja combina
          isso na conversa.
        </p>
        {recado && (
          <Aviso tipo="ok" acao={<button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={() => setRecado(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {recado}
          </Aviso>
        )}
        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!d && !leitura.erro && <Carregando rotulo="Carregando as falas…" />}
        {d && (
          <>
            <div className="pn-busca">
              <Ic nome="lupa" tamanho={16} />
              <input type="search" className="pn-input" aria-label="Buscar fala" placeholder="Buscar: cidade, troco, cupom…" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
            </div>
            <div className="pn-filtros" role="group" aria-label="Quais falas">
              <button type="button" className={`pn-filtro${!so ? ' on' : ''}`} aria-pressed={!so} onClick={() => setSo(false)}>
                Todas <span className="pn-filtro-n">{CHAVES.length}</span>
              </button>
              <button type="button" className={`pn-filtro${so ? ' on' : ''}`} aria-pressed={so} onClick={() => setSo(true)}>
                Trocadas <span className="pn-filtro-n">{trocadas.length}</span>
              </button>
            </div>
            {so && trocadas.length === 0 && !termo && (
              <p className="pn-vazio">
                <Ic nome="check" tamanho={16} /> Todas com o texto de sempre.
              </p>
            )}
            {termo && !CHAVES.some(achou) && <p className="pn-vazio">Nenhuma fala com “{busca.trim()}”.</p>}
            <ul className="pd-grupos">
            {GRUPOS_FALAS.map((g) => {
              const doGrupo = CHAVES.filter((k) => g.prefixos.some((p) => k.startsWith(p)))
              const chaves = doGrupo.filter(achou)
              if (!chaves.length) return null
              const nTrocadas = doGrupo.filter((k) => trocas[k]).length
              return (
                <li key={g.nome}>
                <details key={filtrando ? 'filtro' : 'tudo'} className="pd-grupo" open={filtrando || undefined}>
                  <summary>
                    <span className="pd-grupo-txt">
                      <span className="pd-grupo-nome">{g.nome}</span>
                      <span className="pd-grupo-n">
                        {filtrando ? `${chaves.length} de ${doGrupo.length}` : doGrupo.length} {doGrupo.length === 1 ? 'fala' : 'falas'}
                        {nTrocadas ? ` · ${nTrocadas} ${nTrocadas === 1 ? 'trocada' : 'trocadas'}` : ''}
                      </span>
                    </span>
                    <Ic nome="chevron-dir" tamanho={16} />
                  </summary>
                  <ul className="pd-falas">
                    {chaves.map((k) => (
                      <li key={k}>
                        <button type="button" className="pd-fala toque" onClick={() => setEditando(k)}>
                          <span className="pd-fala-txt">
                            <span className="pd-fala-rot">
                              {ROTULO_FALA[k]}
                              {trocas[k] && <span className="pd-fala-trocada">trocada</span>}
                            </span>
                            <PreviaFala chave={k} texto={trocas[k]?.texto ?? TEXTOS_PEDIDO[k].padrao} />
                          </span>
                          <Ic nome="chevron-dir" tamanho={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
                </li>
              )
            })}
            </ul>
          </>
        )}
      </div>
      {editando && d && (
        <Editor
          key={editando}
          chave={editando}
          troca={trocas[editando]}
          aoFechar={() => setEditando(null)}
          aoSalvar={({ textos, recado: r }) => {
            leitura.trocar((x) => ({ ...x, textos }))
            setEditando(null)
            setRecado(r)
          }}
        />
      )}
    </>
  )
}
