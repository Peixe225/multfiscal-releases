// Estoque: o "acabou" e a contagem marcados por quem tá no balcão (o gerente), só nos estados dele, sem mexer em nome,
// preço nem foto (isso é com o dono, em Produtos). Cada produto do site tem o interruptor "À venda" e o estoque com − e
// + (um toque cada; chegou a 0, sai do site sozinho naquele estado). Depois de cada troca, o recado embaixo com
// "Desfazer". Os controles são os mesmos da lista de Produtos do dono (troca-ui.tsx). Usa as rotas que o servidor já
// aceita pro gerente: admin-loja (ler) e admin-produto-estado (o estado dele).
import { useMemo, useState } from 'react'
import { brl } from '../formato'
import { lembrar, lido } from '../lembrar'
import { Topo } from '../Moldura'
import { ufsDoUsuario, useUsuario } from '../permissoes'
import { caminho, ir } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Carregando, Ic, TituloTela } from '../ui'
import { ArteProduto } from './Arte'
import { aVenda, casa, situacao, useLoja, type Situacao } from './dados'
import { ControleEstado, FolhaEstoque, useTrocaComRecado } from './troca-ui'
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

function LinhaEstoque({ p, e, l, salvando, aoMudar, aoContar }: { p: ProdutoAdmin; e: EstadoAdmin; l: LojaAdmin; salvando: boolean; aoMudar: (n: NoEstado) => void; aoContar: () => void }) {
  const s = situacao(p, e.uf, l.ajustes.restamAte)
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
      <ControleEstado p={p} e={e} restamAte={l.ajustes.restamAte} salvando={salvando} aoMudar={aoMudar} aoContar={aoContar} />
    </li>
  )
}

export function Estoque({ uf: ufRota }: { uf: string | null }) {
  useTitulo('Estoque')
  const usuario = useUsuario()
  const leitura = useLoja()
  const l = leitura.dados
  const trocas = useTrocaComRecado(leitura)
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
    if (e) trocas.mudar(p, e, n)
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
              Marca aqui o que acabou e quantas unidades tem em {estados.length > 1 ? 'cada estado teu' : e.nome}. Chegou a 0, sai do site sozinho. Errou? “Desfazer” no recado embaixo. Nome, preço e foto são com o dono.
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
      <FolhaEstoque alvo={contar ? { p: l?.produtos.find((x) => x.id === contar.p.id) ?? contar.p, e: contar.e } : null} aoFechar={() => setContar(null)} aoSalvar={(n) => contar && mudar(contar.p, n)} />
    </>
  )
}
