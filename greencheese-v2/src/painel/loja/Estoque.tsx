// Estoque: o "acabou" e a contagem marcados por quem tá no balcão (o gerente), só nos estados dele, sem mexer em nome,
// preço nem foto (isso é com o dono, em Produtos). Cada produto do site tem o interruptor "À venda" e o estoque com − e
// + (um toque cada; chegou a 0, sai do site sozinho naquele estado). Depois de cada troca, o recado embaixo com
// "Desfazer". Usa as rotas que o servidor já aceita pro gerente: admin-loja (ler) e admin-produto-estado (o estado dele).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Folha } from '../Folha'
import { brl } from '../formato'
import { lembrar, lido } from '../lembrar'
import { Topo } from '../Moldura'
import { ufsDoUsuario, useUsuario } from '../permissoes'
import { recado } from '../recado'
import { caminho, ir } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import { ArteProduto } from './Arte'
import { aVenda, casa, noEstado, situacao, useLoja, type Situacao } from './dados'
import { useTrocasRapidas } from './trocas'
import type { EstadoAdmin, LojaAdmin, NoEstado, ProdutoAdmin } from './tipos'

type Recorte = 'todos' | 'esgotados' | 'acabando' | 'fora'
const RECORTES: { id: Recorte; nome: string }[] = [
  { id: 'todos', nome: 'Todos' },
  { id: 'esgotados', nome: 'Esgotados' },
  { id: 'acabando', nome: 'Acabando' },
  { id: 'fora', nome: 'Indisponíveis' },
]

function passa(s: Situacao, r: Recorte): boolean {
  if (r === 'esgotados') return s === 'esgotado'
  if (r === 'acabando') return s === 'acabando'
  if (r === 'fora') return s === 'desligado'
  return true
}

/** Os estados que essa pessoa cuida (o dono: os do site), na ordem da loja. */
function meusEstados(l: LojaAdmin, ufs: string[] | null): EstadoAdmin[] {
  return l.estados.filter((e) => (ufs === null ? e.ativo : ufs.includes(e.uf)))
}

function FolhaContar({ alvo, aoFechar, aoSalvar }: { alvo: { p: ProdutoAdmin; e: EstadoAdmin } | null; aoFechar: () => void; aoSalvar: (n: NoEstado) => void }) {
  const [v, setV] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const ne = alvo ? noEstado(alvo.p, alvo.e.uf) : null
  useEffect(() => {
    setV(ne?.estoque != null ? String(ne.estoque) : '')
    setErro(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.p.id, alvo?.e.uf])
  if (!alvo || !ne) return null
  const salvar = () => {
    const n = /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null
    if (n == null) {
      setErro('Põe quantas unidades tem (de 0 a 9.999).')
      campo.current?.focus()
      return
    }
    aoSalvar({ disponivel: ne.disponivel || n > 0, estoque: n })
    aoFechar()
  }
  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={`Estoque em ${alvo.e.nome}`}
      sub={alvo.p.nome}
      focoInicial={campo}
      rodape={
        <div className="pn-botoes">
          <Botao largo onClick={salvar}>
            Salvar o estoque
          </Botao>
          {ne.estoque != null && (
            <Botao
              variante="texto"
              largo
              onClick={() => {
                aoSalvar({ ...ne, estoque: null })
                aoFechar()
              }}
            >
              Parar de contar
            </Botao>
          )}
        </div>
      }
    >
      <form
        className="pn-folha-pad pn-form"
        onSubmit={(ev) => {
          ev.preventDefault()
          salvar()
        }}
      >
        <div className={`pn-campo${erro ? ' pn-campo-erro' : ''}`}>
          <label className="pn-rotulo" htmlFor="est-n">
            Unidades
          </label>
          <input
            ref={campo}
            id="est-n"
            name="estoque"
            className="pn-input pn-input-num"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={v}
            onChange={(ev) => {
              setV(ev.target.value.replace(/\D/g, '').slice(0, 4))
              setErro(null)
            }}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'est-erro' : 'est-dica'}
          />
          {erro ? (
            <p id="est-erro" className="pn-erro">
              <Ic nome="atencao" tamanho={16} />
              <span>{erro}</span>
            </p>
          ) : (
            <p id="est-dica" className="pn-dica">
              Chegou a 0, sai do site sozinho nesse estado. Quando tu põe mais, volta.
            </p>
          )}
        </div>
      </form>
    </Folha>
  )
}

function LinhaEstoque({ p, e, l, salvando, aoMudar, aoContar }: { p: ProdutoAdmin; e: EstadoAdmin; l: LojaAdmin; salvando: boolean; aoMudar: (n: NoEstado) => void; aoContar: () => void }) {
  const ne = noEstado(p, e.uf)
  const s = situacao(p, e.uf, l.ajustes.restamAte)
  const id = `est-${p.id}-${e.uf}`
  return (
    <li className={`pn-prod${aVenda(s) ? '' : ' pn-prod-off'}`}>
      <div className="pn-prod-link pn-est-prod">
        <ArteProduto produto={p} largura={40} halo={false} cinza={!aVenda(s)} />
        <span className="pn-prod-txt">
          <span className="pn-prod-nome">
            <strong>{p.nome}</strong>
            {p.tamanho && <span className="pn-prod-tam"> {p.tamanho}</span>}
          </span>
          <span className="pn-prod-sub">{p.preco == null ? 'Consultar' : brl(p.preco)}</span>
        </span>
      </div>
      <div className={`pn-prod-ctrl${salvando ? ' pn-salvando' : ''}`}>
        <label className="pn-troca pn-troca-p" htmlFor={id}>
          <input id={id} type="checkbox" checked={ne.disponivel} onChange={(ev) => aoMudar({ ...ne, disponivel: ev.target.checked })} />
          <span className="pn-troca-marca" aria-hidden="true" />
          <span className="pn-prod-ctrl-txt">
            {s === 'esgotado' ? 'Esgotado' : ne.disponivel ? 'À venda' : 'Indisponível'}
            <span className="sr-only">
              {' '}
              em {e.nome}: {p.nome}
            </span>
          </span>
        </label>
        {ne.estoque == null ? (
          <button type="button" className="pn-botao pn-botao-texto pn-botao-p pn-prod-contar" onClick={aoContar} aria-label={`Contar o estoque de ${p.nome} em ${e.nome}`}>
            <span className="pn-botao-txt">Contar estoque</span>
          </button>
        ) : (
          <div className="pn-estoque" role="group" aria-label={`Estoque de ${p.nome} em ${e.nome}`}>
            <button type="button" className="pn-numero-b" aria-label={`Menos um no estoque de ${p.nome}`} aria-disabled={ne.estoque <= 0 || undefined} onClick={() => ne.estoque! > 0 && aoMudar({ ...ne, estoque: ne.estoque! - 1 })}>
              <Ic nome="menos" tamanho={16} />
            </button>
            <button type="button" className="pn-estoque-n" onClick={aoContar} aria-label={`${ne.estoque} no estoque. Digitar outro número`}>
              <span className="px">{ne.estoque}</span>
              <small>{s === 'acabando' ? 'restam' : 'un.'}</small>
            </button>
            <button type="button" className="pn-numero-b" aria-label={`Mais um no estoque de ${p.nome}`} aria-disabled={ne.estoque >= 9999 || undefined} onClick={() => ne.estoque! < 9999 && aoMudar({ ...ne, estoque: ne.estoque! + 1 })}>
              <Ic nome="mais" tamanho={16} />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/** O recado de cada troca (com o "Desfazer" que põe de volta como estava). */
function fraseDaTroca(p: ProdutoAdmin, e: EstadoAdmin, antes: NoEstado, depois: NoEstado): string {
  const uf = e.uf.toUpperCase()
  if (antes.disponivel !== depois.disponivel) return depois.disponivel ? `${p.nome} voltou pra venda em ${uf}` : `${p.nome} saiu de ${uf} (indisponível)`
  if (depois.estoque == null) return `${p.nome}: parou de contar o estoque em ${uf}`
  if (depois.estoque === 0) return `${p.nome}: 0 em ${uf}, saiu do site lá`
  return `${p.nome}: ${depois.estoque} em ${uf}`
}

export function Estoque({ uf: ufRota }: { uf: string | null }) {
  useTitulo('Estoque')
  const usuario = useUsuario()
  const leitura = useLoja()
  const l = leitura.dados
  const trocas = useTrocasRapidas(leitura)
  const [busca, setBusca] = useState('')
  const [recorte, setRecorte] = useState<Recorte>('todos')
  const [contar, setContar] = useState<{ p: ProdutoAdmin; e: EstadoAdmin } | null>(null)
  useRestaurarRolagem(!!l)
  const estados = l ? meusEstados(l, ufsDoUsuario(usuario)) : []
  const guardado = lido('estoque-uf')
  const e = estados.find((x) => x.uf === ufRota) ?? estados.find((x) => x.uf === guardado) ?? estados[0] ?? null
  const nomesCat = useMemo(() => new Map(l?.categorias.map((c) => [c.id, c.nome])), [l])
  const lista = useMemo(() => {
    if (!l || !e) return []
    return l.produtos.filter((p) => p.ativo && casa(p, busca, nomesCat.get(p.categoria) ?? '') && passa(situacao(p, e.uf, l.ajustes.restamAte), recorte))
  }, [l, e, busca, recorte, nomesCat])
  const mudar = (p: ProdutoAdmin, n: NoEstado) => {
    if (!e) return
    const antes = noEstado(p, e.uf)
    trocas.mudar(p, e.uf, n)
    recado(fraseDaTroca(p, e, antes, n), { desfazer: { acao: () => trocas.mudar(p, e.uf, antes) } })
  }
  return (
    <>
      <Topo titulo={<TituloTela>Estoque</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pn-produtos pn-estoque-tela">
        {leitura.erro && !l && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {trocas.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="icone-botao" aria-label="Fechar o aviso" onClick={() => trocas.setErro(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {trocas.erro}
          </Aviso>
        )}
        {!l && !leitura.erro && <Carregando />}
        {l && !e && <p className="pn-vazio">Nenhum estado teu tá na loja ainda. Fala com o dono.</p>}
        {l && e && (
          <>
            <p className="pn-dica-bloco">
              Marca aqui o que acabou e quantas unidades tem em {estados.length > 1 ? 'cada estado teu' : e.nome}. Chegou a 0, sai do site sozinho. Nome, preço e foto são com o dono.
            </p>
            {estados.length > 1 && (
              <div className="pn-filtros" role="group" aria-label="Estado">
                {estados.map((x) => (
                  <button
                    key={x.uf}
                    type="button"
                    className={`pn-filtro px${x.uf === e.uf ? ' on' : ''}`}
                    aria-pressed={x.uf === e.uf}
                    aria-label={x.nome}
                    onClick={() => {
                      lembrar('estoque-uf', x.uf)
                      ir(caminho.estoqueDe(x.uf), true)
                    }}
                  >
                    {x.uf.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            <div className="pn-busca pn-prod-busca">
              <Ic nome="lupa" tamanho={16} />
              <input type="search" className="pn-input" placeholder="Buscar produto" aria-label="Buscar produto" autoComplete="off" enterKeyHint="search" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
            </div>
            <div className="pn-filtros" role="group" aria-label="Recorte">
              {RECORTES.map((r) => (
                <button key={r.id} type="button" className={`pn-filtro${recorte === r.id ? ' on' : ''}`} aria-pressed={recorte === r.id} onClick={() => setRecorte(r.id)}>
                  {r.nome}
                </button>
              ))}
            </div>
            {lista.length === 0 ? (
              <p className="pn-vazio">{busca ? `Nada com “${busca}”.` : recorte === 'todos' ? 'Nenhum produto no site.' : 'Nenhum aqui.'}</p>
            ) : (
              <ul className="pn-lista-prod" aria-label={`Produtos em ${e.nome}`}>
                {lista.map((p) => (
                  <LinhaEstoque key={p.id} p={p} e={e} l={l} salvando={trocas.salvando.has(`${p.id}|${e.uf}`)} aoMudar={(n) => mudar(p, n)} aoContar={() => setContar({ p, e })} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <FolhaContar alvo={contar ? { p: l?.produtos.find((x) => x.id === contar.p.id) ?? contar.p, e: contar.e } : null} aoFechar={() => setContar(null)} aoSalvar={(n) => contar && mudar(contar.p, n)} />
    </>
  )
}
