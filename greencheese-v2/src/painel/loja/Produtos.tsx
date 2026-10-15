// Produtos: a lista da loja com a troca rápida por estado. Escolhido um estado, cada produto tem o interruptor
// "à venda" e o estoque com − e + (1 toque cada); em "Todos", "À venda em:" e um chip por estado liga e desliga. Cada
// troca deixa o recado embaixo com "Desfazer" (as peças são as mesmas do Estoque do gerente: troca-ui.tsx). Busca,
// categoria, os recortes do Resumo (esgotados, acabando, fora do site, exemplo), "Organizar" (a ordem da grade do
// site) e o selo "não salvo" no produto que tem mudança guardada só no aparelho.
import { useMemo, useState } from 'react'
import * as apiBase from '../api'
import { brl } from '../formato'
import { lembrar, lido, lidoJson } from '../lembrar'
import { Link, Topo } from '../Moldura'
import { recado } from '../recado'
import { caminho, type VerProdutos } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { ArteProduto, NomeProduto } from './Arte'
import { aVenda, casa, contagens, estadosNoSite, guardarLoja, situacao, useLoja } from './dados'
import { nomeUf } from './nomes'
import { ChipsEstados, ControleEstado, FolhaEstoque, LegendaChips, useTrocaComRecado } from './troca-ui'
import type { EstadoAdmin, LojaAdmin, ProdutoAdmin } from './tipos'
import { lerPreco } from './validar'

const VER_NOME: Record<VerProdutos, string> = { esgotados: 'Esgotados', acabando: 'Acabando', fora: 'Fora do site', exemplo: 'De exemplo' }

function passaNoVer(p: ProdutoAdmin, ver: VerProdutos, ufs: string[], restamAte: number | null): boolean {
  if (ver === 'fora') return !p.ativo
  if (ver === 'exemplo') return p.demo
  const s = ufs.map((uf) => situacao(p, uf, restamAte))
  return ver === 'esgotados' ? s.includes('esgotado') : s.includes('acabando')
}

/** O rascunho que o Produto guardou neste aparelho e ainda vale (o produto não mudou depois dele), ou null. */
function rascunhoDe(p: ProdutoAdmin): { preco: string | null } | null {
  const r = lidoJson<{ form?: { preco?: string }; base?: string | null }>(`produto:${p.id}`)
  if (!r?.form || r.base !== p.atualizadoEm) return null
  return { preco: typeof r.form.preco === 'string' ? r.form.preco : null }
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
  trocas: ReturnType<typeof useTrocaComRecado>
  aoEditarEstoque: (e: EstadoAdmin) => void
}) {
  const estados = estadosNoSite(l)
  const e = uf ? l.estados.find((x) => x.uf === uf) : undefined
  const s = e ? situacao(p, e.uf, l.ajustes.restamAte) : null
  const apagado = !p.ativo || (s != null && !aVenda(s))
  // mudança no produto que ficou só no aparelho (saiu sem salvar): a lista diz, em vez de mostrar o de antes como salvo
  const rascunho = rascunhoDe(p)
  const precoRascunho = rascunho?.preco != null ? lerPreco(rascunho.preco) : undefined
  const precoMudou = rascunho != null && precoRascunho !== undefined && (precoRascunho ?? null) !== p.preco
  return (
    <li className={`pn-prod${apagado ? ' pn-prod-off' : ''}`}>
      <Link href={caminho.produto(p.id)} className="pn-prod-link toque" aria-label={`${p.nome}${p.tamanho ? ` ${p.tamanho}` : ''}: editar${rascunho ? ' (tem mudança não salva)' : ''}`}>
        <ArteProduto produto={p} largura={40} halo={false} cinza={apagado} />
        <span className="pn-prod-txt">
          <span className="pn-prod-nome">
            <strong>{p.nome}</strong>
            {p.tamanho && <span className="pn-prod-tam"> {p.tamanho}</span>}
          </span>
          <span className="pn-prod-sub">
            {p.preco == null ? 'Consultar' : brl(p.preco)} · {nomeCategoria}
          </span>
          {(p.demo || !p.ativo || rascunho) && (
            <span className="pn-prod-selos">
              {rascunho && <span className="carimbo pn-carimbo-rascunho">{precoMudou ? `não salvo: ${precoRascunho == null ? 'Consultar' : brl(precoRascunho)}` : 'mudança não salva'}</span>}
              {!p.ativo && <span className="carimbo">fora do site</span>}
              {p.demo && <span className="carimbo">exemplo</span>}
            </span>
          )}
        </span>
        <Ic nome="chevron-dir" tamanho={16} />
      </Link>
      {p.ativo && e && (
        <ControleEstado p={p} e={e} restamAte={l.ajustes.restamAte} salvando={trocas.salvando.has(`${p.id}|${e.uf}`)} aoMudar={(n) => trocas.mudar(p, e, n)} aoContar={() => aoEditarEstoque(e)} />
      )}
      {p.ativo && !e && (
        <ChipsEstados p={p} estados={estados} restamAte={l.ajustes.restamAte} salvando={(x) => trocas.salvando.has(`${p.id}|${x}`)} aoMudar={(x, n) => trocas.mudar(p, x, n)} />
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
  const trocas = useTrocaComRecado(leitura)
  const [busca, setBusca] = useState('')
  const [uf, setUfBruto] = useState<string | null>(() => lido('produtos-uf'))
  const [cat, setCat] = useState<string | null>(null)
  const [organizando, setOrganizando] = useState(false)
  const [estoque, setEstoque] = useState<{ p: ProdutoAdmin; e: EstadoAdmin } | null>(null)
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
              <button type="button" className="pn-botao pn-botao-cinza pn-botao-p pn-so-icone-celular pn-botao-organizar" onClick={() => setOrganizando(true)} aria-label="Organizar a ordem da grade">
                <Ic nome="tudo" tamanho={16} />
                <span className="pn-botao-txt">
                  <span className="pn-txt-longo">Organizar</span>
                  <span className="pn-txt-curto" aria-hidden="true">
                    Ordem
                  </span>
                </span>
              </button>
            )}
            {/* o produto novo já nasce à venda no estado do filtro (o botão de criar diz onde) */}
            <Link href={caminho.produtoNovoEm(ufValida)} className="pn-botao pn-botao-cheio pn-botao-p pn-so-icone-estreito" aria-label="Novo produto">
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
                recado('Ordem salva. A grade do site já segue ela.')
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
                ? `Em ${nomeUf(ufValida)}: o interruptor tira ou põe à venda; − e + mexem no estoque. Errou? “Desfazer” no recado embaixo.`
                : 'Toca no estado pra pôr à venda ou tirar (o recado embaixo tem “Desfazer”). Pra contar o estoque, escolhe o estado aqui em cima.'}
            </p>
            {!ufValida && <LegendaChips />}
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
        aoSalvar={(n) => {
          if (!estoque) return
          trocas.mudar(l?.produtos.find((x) => x.id === estoque.p.id) ?? estoque.p, estoque.e, n)
        }}
      />
    </>
  )
}
