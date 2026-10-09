// Produtos: a lista da loja com a troca rápida por estado. Escolhido um estado, cada produto tem o interruptor
// "à venda" e o estoque com − e + (1 toque cada); em "Todos", um botão por estado liga e desliga. Busca, categoria,
// os recortes do Resumo (esgotados, acabando, fora do site, exemplo) e "Organizar" (a ordem da grade do site).
import { useEffect, useMemo, useRef, useState } from 'react'
import * as apiBase from '../api'
import { Folha } from '../Folha'
import { brl } from '../formato'
import { lembrar, lido } from '../lembrar'
import { Link, Topo } from '../Moldura'
import { caminho, type VerProdutos } from '../rotas'
import { pegarRecado } from '../telas/flash'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { ArteProduto, NomeProduto } from './Arte'
import { aVenda, casa, contagens, estadosNoSite, guardarLoja, noEstado, situacao, useLoja, type Situacao } from './dados'
import { nomeUf } from './nomes'
import { useTrocasRapidas } from './trocas'
import type { EstadoAdmin, LojaAdmin, NoEstado, ProdutoAdmin } from './tipos'

const VER_NOME: Record<VerProdutos, string> = { esgotados: 'Esgotados', acabando: 'Acabando', fora: 'Fora do site', exemplo: 'De exemplo' }

function passaNoVer(p: ProdutoAdmin, ver: VerProdutos, ufs: string[], restamAte: number | null): boolean {
  if (ver === 'fora') return !p.ativo
  if (ver === 'exemplo') return p.demo
  const s = ufs.map((uf) => situacao(p, uf, restamAte))
  return ver === 'esgotados' ? s.includes('esgotado') : s.includes('acabando')
}

/** O que a pessoa lê do estado de um produto num estado (o rótulo do botão e do leitor de tela). */
function frase(s: Situacao, e: NoEstado): string {
  if (s === 'fora') return 'fora do site'
  if (s === 'desligado') return 'indisponível'
  if (s === 'esgotado') return 'esgotado (0 no estoque)'
  return e.estoque != null ? `à venda, ${e.estoque} no estoque` : 'à venda'
}

/** Em "Todos": um botão por estado. Tocar liga ou desliga ali (o estoque, se tiver, fica). */
function ChipEstado({ p, e, restamAte, aoMudar, salvando }: { p: ProdutoAdmin; e: EstadoAdmin; restamAte: number | null; aoMudar: (n: NoEstado) => void; salvando: boolean }) {
  const ne = noEstado(p, e.uf)
  const s = situacao(p, e.uf, restamAte)
  const on = ne.disponivel
  return (
    <button
      type="button"
      className={`pn-chip-est px${on ? ' on' : ''}${s === 'esgotado' ? ' esgotado' : ''}${salvando ? ' pn-salvando' : ''}`}
      aria-pressed={on}
      aria-label={`${p.nome} em ${e.nome}: ${frase(s, ne)}`}
      onClick={() => aoMudar({ ...ne, disponivel: !on })}
    >
      {on && ne.estoque == null && <Ic nome="check" tamanho={16} />}
      <span>{e.uf.toUpperCase()}</span>
      {ne.estoque != null && <span className="pn-chip-est-n">{ne.estoque}</span>}
    </button>
  )
}

/** Escolhido um estado: o interruptor "à venda" e o estoque (− e + mandam na hora; o número abre pra digitar). */
function ControleEstado({
  p,
  e,
  restamAte,
  aoMudar,
  aoEditarEstoque,
  salvando,
}: {
  p: ProdutoAdmin
  e: EstadoAdmin
  restamAte: number | null
  aoMudar: (n: NoEstado) => void
  aoEditarEstoque: () => void
  salvando: boolean
}) {
  const ne = noEstado(p, e.uf)
  const s = situacao(p, e.uf, restamAte)
  const id = `d-${p.id}-${e.uf}`
  return (
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
        <button type="button" className="pn-botao pn-botao-texto pn-botao-p pn-prod-contar" onClick={aoEditarEstoque} aria-label={`Contar o estoque de ${p.nome} em ${e.nome}`}>
          <span className="pn-botao-txt">Contar estoque</span>
        </button>
      ) : (
        <div className="pn-estoque" role="group" aria-label={`Estoque de ${p.nome} em ${e.nome}`}>
          <button type="button" className="pn-numero-b" aria-label={`Menos um no estoque de ${p.nome}`} aria-disabled={ne.estoque <= 0 || undefined} onClick={() => ne.estoque! > 0 && aoMudar({ ...ne, estoque: ne.estoque! - 1 })}>
            <Ic nome="menos" tamanho={16} />
          </button>
          <button type="button" className="pn-estoque-n" onClick={aoEditarEstoque} aria-label={`${ne.estoque} no estoque. Digitar outro número`}>
            <span className="px">{ne.estoque}</span>
            <small>{s === 'acabando' ? 'restam' : 'un.'}</small>
          </button>
          <button type="button" className="pn-numero-b" aria-label={`Mais um no estoque de ${p.nome}`} aria-disabled={ne.estoque >= 9999 || undefined} onClick={() => ne.estoque! < 9999 && aoMudar({ ...ne, estoque: ne.estoque! + 1 })}>
            <Ic nome="mais" tamanho={16} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Digitar o estoque (ou parar de contar). */
function FolhaEstoque({ alvo, aoFechar, aoSalvar }: { alvo: { p: ProdutoAdmin; e: EstadoAdmin } | null; aoFechar: () => void; aoSalvar: (n: NoEstado) => void }) {
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
    // contar estoque de algo desligado: liga junto (quem conta é porque tem)
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
          <label className="pn-rotulo" htmlFor="estoque-n">
            Unidades
          </label>
          <input
            ref={campo}
            id="estoque-n"
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
            aria-describedby={erro ? 'estoque-erro' : 'estoque-dica'}
          />
          {erro ? (
            <p id="estoque-erro" className="pn-erro">
              <Ic nome="atencao" tamanho={16} />
              <span>{erro}</span>
            </p>
          ) : (
            <p id="estoque-dica" className="pn-dica">
              Chegou a 0, sai do site sozinho nesse estado. Quando tu põe mais, volta.
            </p>
          )}
        </div>
      </form>
    </Folha>
  )
}

function LinhaProduto({
  p,
  l,
  uf,
  nomeCategoria,
  trocas,
  aoEditarEstoque,
}: {
  p: ProdutoAdmin
  l: LojaAdmin
  uf: string | null
  nomeCategoria: string
  trocas: ReturnType<typeof useTrocasRapidas>
  aoEditarEstoque: (e: EstadoAdmin) => void
}) {
  const estados = estadosNoSite(l)
  const e = uf ? l.estados.find((x) => x.uf === uf) : undefined
  const s = e ? situacao(p, e.uf, l.ajustes.restamAte) : null
  const apagado = !p.ativo || (s != null && !aVenda(s))
  return (
    <li className={`pn-prod${apagado ? ' pn-prod-off' : ''}`}>
      <Link href={caminho.produto(p.id)} className="pn-prod-link toque" aria-label={`${p.nome}${p.tamanho ? ` ${p.tamanho}` : ''}: editar`}>
        <ArteProduto produto={p} largura={40} halo={false} cinza={apagado} />
        <span className="pn-prod-txt">
          <span className="pn-prod-nome">
            <strong>{p.nome}</strong>
            {p.tamanho && <span className="pn-prod-tam"> {p.tamanho}</span>}
          </span>
          <span className="pn-prod-sub">
            {p.preco == null ? 'Consultar' : brl(p.preco)} · {nomeCategoria}
          </span>
          {(p.demo || !p.ativo) && (
            <span className="pn-prod-selos">
              {!p.ativo && <span className="carimbo">fora do site</span>}
              {p.demo && <span className="carimbo">exemplo</span>}
            </span>
          )}
        </span>
        <Ic nome="chevron-dir" tamanho={16} />
      </Link>
      {p.ativo && e && (
        <ControleEstado p={p} e={e} restamAte={l.ajustes.restamAte} salvando={trocas.salvando.has(`${p.id}|${e.uf}`)} aoMudar={(n) => trocas.mudar(p, e.uf, n)} aoEditarEstoque={() => aoEditarEstoque(e)} />
      )}
      {p.ativo && !e && (
        <div className="pn-chips-est" role="group" aria-label={`Onde ${p.nome} tá à venda`}>
          {estados.map((x) => (
            <ChipEstado key={x.uf} p={p} e={x} restamAte={l.ajustes.restamAte} salvando={trocas.salvando.has(`${p.id}|${x.uf}`)} aoMudar={(n) => trocas.mudar(p, x.uf, n)} />
          ))}
        </div>
      )}
    </li>
  )
}

/** Organizar: a ordem da grade do site, com subir e descer (sem arrastar: dá no teclado e no leitor de tela). */
function Organizar({ l, aoSair }: { l: LojaAdmin; aoSair: (salvou: boolean) => void }) {
  const [ordem, setOrdem] = useState(() => l.produtos.map((p) => p.id))
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const porId = new Map(l.produtos.map((p) => [p.id, p]))
  const mexeu = ordem.join() !== l.produtos.map((p) => p.id).join()
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= ordem.length) return
    const n = [...ordem]
    ;[n[i], n[j]] = [n[j], n[i]]
    setOrdem(n)
    // o foco segue o produto (o botão dele, na posição nova)
    requestAnimationFrame(() => document.getElementById(`ord-${d < 0 ? 'c' : 'b'}-${n[j]}`)?.focus())
  }
  const salvar = async () => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    try {
      const r = await api.ordemProdutos(ordem)
      guardarLoja((x) => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, produtos: r.ordem.map((id) => x.produtos.find((p) => p.id === id)).filter((p): p is ProdutoAdmin => !!p) }))
      aoSair(true)
    } catch (e) {
      setErro(apiBase.mensagemDe(e))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <>
      <p className="pn-dica-bloco">A ordem da grade do site (o Início e o Mercado). Sobe e desce, depois salva.</p>
      <ol className="pn-ordem">
        {ordem.map((id, i) => {
          const p = porId.get(id)
          if (!p) return null
          return (
            <li key={id} className="pn-ordem-item">
              <span className="pn-ordem-n px">{i + 1}</span>
              <ArteProduto produto={p} largura={28} halo={false} cinza={!p.ativo} />
              <span className="pn-ordem-nome">
                <span>
                  <NomeProduto p={p} />
                </span>
              </span>
              <button type="button" id={`ord-c-${id}`} className="icone-botao" aria-label={`Subir ${p.nome}`} aria-disabled={i === 0 || undefined} onClick={() => mover(i, -1)}>
                <Ic nome="chevron-cima" tamanho={16} />
              </button>
              <button type="button" id={`ord-b-${id}`} className="icone-botao" aria-label={`Descer ${p.nome}`} aria-disabled={i === ordem.length - 1 || undefined} onClick={() => mover(i, 1)}>
                <Ic nome="chevron-baixo" tamanho={16} />
              </button>
            </li>
          )
        })}
      </ol>
      <div className="pn-editar-pe pn-pe-fixo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pn-botoes pn-botoes-linha">
          <Botao variante="cinza" onClick={() => aoSair(false)} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao onClick={() => void salvar()} ocupado={ocupado} disabled={!mexeu}>
            Salvar a ordem
          </Botao>
        </div>
      </div>
    </>
  )
}

export function Produtos({ ver }: { ver: VerProdutos | null }) {
  useTitulo('Produtos')
  const leitura = useLoja()
  const l = leitura.dados
  const trocas = useTrocasRapidas(leitura)
  const [busca, setBusca] = useState('')
  const [uf, setUfBruto] = useState<string | null>(() => lido('produtos-uf'))
  const [cat, setCat] = useState<string | null>(null)
  const [organizando, setOrganizando] = useState(false)
  const [estoque, setEstoque] = useState<{ p: ProdutoAdmin; e: EstadoAdmin } | null>(null)
  const [recado, setRecado] = useState(pegarRecado)
  useRestaurarRolagem(!!l)
  const setUf = (x: string | null) => {
    setUfBruto(x)
    lembrar('produtos-uf', x)
  }
  const estados = l ? estadosNoSite(l) : []
  // o estado lembrado saiu do site: volta pro "Todos"
  const ufValida = uf && estados.some((e) => e.uf === uf) ? uf : null
  const nomesCat = useMemo(() => new Map(l?.categorias.map((c) => [c.id, c.curto]) ?? []), [l?.categorias])
  const conta = l ? contagens(l) : null
  const lista = useMemo(() => {
    if (!l) return []
    const ufs = estadosNoSite(l).map((e) => e.uf)
    return l.produtos.filter((p) => (!cat || p.categoria === cat) && (!ver || passaNoVer(p, ver, ufs, l.ajustes.restamAte)) && casa(p, busca, nomesCat.get(p.categoria) ?? ''))
  }, [l, cat, ver, busca, nomesCat])

  const topo = (
    <Topo
      titulo={<TituloTela>Produtos</TituloTela>}
      acoes={
        !organizando && (
          <>
            {l && l.produtos.length > 1 && (
              <button type="button" className="pn-botao pn-botao-cinza pn-botao-p pn-so-icone-celular" onClick={() => setOrganizando(true)}>
                <Ic nome="tudo" tamanho={16} />
                <span className="pn-botao-txt">Organizar</span>
              </button>
            )}
            <Link href={caminho.produtoNovo} className="pn-botao pn-botao-cheio pn-botao-p pn-so-icone-estreito">
              <Ic nome="mais" tamanho={16} />
              <span className="pn-botao-txt">
                Novo<span className="pn-txt-sufixo"> produto</span>
              </span>
            </Link>
          </>
        )
      }
    />
  )

  if (organizando && l) {
    return (
      <>
        {topo}
        <div className="pn-pagina pn-pagina-estreita pn-produtos">
          <Organizar
            l={l}
            aoSair={(salvou) => {
              setOrganizando(false)
              if (salvou) {
                setRecado('Ordem salva. A grade do site já segue ela.')
                void leitura.recarregar()
              }
            }}
          />
        </div>
      </>
    )
  }

  return (
    <>
      {topo}
      <div className="pn-pagina pn-pagina-estreita pn-produtos">
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
        {trocas.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="icone-botao" aria-label="Fechar o aviso" onClick={() => trocas.setErro(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {trocas.erro}
          </Aviso>
        )}
        {!l && !leitura.erro && <Carregando />}
        {l && (
          <>
            <div className="pn-busca pn-prod-busca">
              <Ic nome="lupa" tamanho={16} />
              <input
                type="search"
                className="pn-input"
                placeholder="Buscar produto"
                aria-label="Buscar produto"
                autoComplete="off"
                enterKeyHint="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="pn-filtros" role="group" aria-label="Estado">
              <button type="button" className={`pn-filtro${!ufValida ? ' on' : ''}`} aria-pressed={!ufValida} onClick={() => setUf(null)}>
                Todos
              </button>
              {estados.map((e) => (
                <button key={e.uf} type="button" className={`pn-filtro px${ufValida === e.uf ? ' on' : ''}`} aria-pressed={ufValida === e.uf} aria-label={e.nome} onClick={() => setUf(e.uf)}>
                  {e.uf.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="pn-filtros pn-filtros-cat" role="group" aria-label="Categoria">
              <button type="button" className={`pn-filtro${!cat ? ' on' : ''}`} aria-pressed={!cat} onClick={() => setCat(null)}>
                Tudo <span className="pn-filtro-n">{l.produtos.length}</span>
              </button>
              {l.categorias.map((c) => (
                <button key={c.id} type="button" className={`pn-filtro${cat === c.id ? ' on' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>
                  {c.curto} <span className="pn-filtro-n">{c.produtos}</span>
                </button>
              ))}
            </div>
            {ver && (
              <p className="pn-recorte">
                <span>
                  Mostrando: <strong>{VER_NOME[ver].toLowerCase()}</strong>
                  {ver === 'acabando' && l.ajustes.restamAte != null ? ` (${l.ajustes.restamAte} ou menos no estoque)` : ''}
                </span>
                <Link href={caminho.produtos} trocar className="pn-link">
                  Ver todos
                </Link>
              </p>
            )}
            <p className="pn-dica-bloco pn-prod-dica">
              {ufValida
                ? `Em ${nomeUf(ufValida)}: o interruptor tira ou põe à venda; − e + mexem no estoque.`
                : 'Toca no estado pra pôr à venda ou tirar. Pra contar o estoque, escolhe o estado aqui em cima.'}
            </p>
            {lista.length === 0 ? (
              <p className="pn-vazio">{l.produtos.length === 0 ? 'Nenhum produto ainda. Cria o primeiro no “Novo produto”.' : busca ? `Nada com “${busca}”.` : 'Nenhum produto aqui.'}</p>
            ) : (
              <ul className="pn-lista-prod" aria-label="Produtos">
                {lista.map((p) => (
                  <LinhaProduto key={p.id} p={p} l={l} uf={ufValida} nomeCategoria={nomesCat.get(p.categoria) ?? p.categoria} trocas={trocas} aoEditarEstoque={(e) => setEstoque({ p, e })} />
                ))}
              </ul>
            )}
            {conta && conta.exemplo > 0 && !ver && (
              <p className="pn-dica-bloco pn-prod-rodape">
                {conta.exemplo === 1 ? '1 produto é de exemplo' : `${conta.exemplo} produtos são de exemplo`}: some do site quando tu apagar os dados de exemplo (
                <Link href={caminho.loja} className="pn-link pn-link-dentro">
                  Loja
                </Link>
                ).
              </p>
            )}
          </>
        )}
      </div>
      <FolhaEstoque
        alvo={estoque ? { p: l?.produtos.find((x) => x.id === estoque.p.id) ?? estoque.p, e: estoque.e } : null}
        aoFechar={() => setEstoque(null)}
        aoSalvar={(n) => estoque && trocas.mudar(estoque.p, estoque.e.uf, n)}
      />
    </>
  )
}
