// Stories do Início: por estado, os produtos que passam no story do topo do site e em que ordem (até as 8
// barrinhas). Lista vazia = automático (os à venda no estado, os com preço primeiro). Subir e descer por botão (dá no
// teclado e no leitor de tela) e a prévia do story como o cliente vê. Em cima, a chave da rua do mercador no fim do
// Início do celular (vale pra todos os estados; salva no toque). A chave é a `ruaNoStory` da loja: o nome é de quando a
// rua era o 1º story do celular; desde 09/10 ela liga e desliga a rua no fim do Início, depois da grade.
import { useEffect, useMemo, useState } from 'react'
import { mensagemDe } from '../api'
import { brl } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho, ir } from '../rotas'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { ArteProduto, NomeProduto } from './Arte'
import { aVenda, estadosNoSite, guardarLoja, situacao, useLoja } from './dados'
import { PreviaStory } from './Previa'
import type { LojaAdmin, ProdutoAdmin } from './tipos'

const MAX = 8

/** O automático do site (Hero.tsx): os à venda no estado, os com preço primeiro e os de exemplo por último. */
function automatico(l: LojaAdmin, uf: string): ProdutoAdmin[] {
  const peso = (p: ProdutoAdmin) => (p.demo ? 2 : 0) + (p.preco == null ? 1 : 0)
  return l.produtos
    .filter((p) => aVenda(situacao(p, uf, l.ajustes.restamAte)))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => peso(a.p) - peso(b.p) || a.i - b.i)
    .slice(0, MAX)
    .map((x) => x.p)
}

export function Stories({ uf: ufRota }: { uf: string | null }) {
  useTitulo('Stories do Início')
  const leitura = useLoja(0)
  const l = leitura.dados
  const estados = l ? estadosNoSite(l) : []
  const uf = ufRota && estados.some((e) => e.uf === ufRota) ? ufRota : (estados[0]?.uf ?? null)
  const salvo = useMemo(() => (l && uf ? (l.stories[uf] ?? []) : []), [l, uf])
  const [lista, setLista] = useState<string[] | null>(null)
  const [soAVenda, setSoAVenda] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [atual, setAtual] = useState(0)
  const [rua, setRua] = useState<{ ocupado: boolean; erro: string | null; ok: string | null }>({ ocupado: false, erro: null, ok: null })

  // trocou de estado (ou a loja chegou): começa da lista salva dele
  useEffect(() => {
    setLista(null)
    setErro(null)
    setOk(null)
    setAtual(0)
  }, [uf])
  const escolhidos = lista ?? salvo
  const mexeu = escolhidos.join() !== salvo.join()

  if (!l || !uf) {
    return (
      <>
        <Topo voltar={caminho.loja} titulo={<TituloTela>Stories do Início</TituloTela>} />
        <div className="pn-pagina">{leitura.erro ? <Aviso tipo="erro">{leitura.erro.message}</Aviso> : <Carregando />}</div>
      </>
    )
  }
  const estado = l.estados.find((e) => e.uf === uf)!
  const porId = new Map(l.produtos.map((p) => [p.id, p]))
  const sit = (p: ProdutoAdmin) => situacao(p, uf, l.ajustes.restamAte)
  const passam = escolhidos.map((id) => porId.get(id)).filter((p): p is ProdutoAdmin => !!p && aVenda(sit(p)))
  const auto = escolhidos.length === 0 || passam.length === 0
  const naTela = auto ? automatico(l, uf) : passam
  const disponiveisPraEscolher = l.produtos.filter((p) => p.ativo && !escolhidos.includes(p.id) && (!soAVenda || aVenda(sit(p))))
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= escolhidos.length) return
    const n = [...escolhidos]
    ;[n[i], n[j]] = [n[j], n[i]]
    setLista(n)
    setOk(null)
    requestAnimationFrame(() => document.getElementById(`st-${d < 0 ? 'c' : 'b'}-${n[j]}`)?.focus())
  }
  const trocarRua = async (ligada: boolean) => {
    if (rua.ocupado) return
    setRua({ ocupado: true, erro: null, ok: null })
    try {
      const r = await api.salvarLoja({ ruaNoStory: ligada })
      const novo = (x: LojaAdmin): LojaAdmin => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, ajustes: r.ajustes })
      guardarLoja(novo)
      leitura.trocar(novo)
      setRua({ ocupado: false, erro: null, ok: r.ajustes.ruaNoStory ? 'A rua fecha o Início no celular.' : 'O Início do celular fica sem a rua.' })
    } catch (e) {
      setRua({ ocupado: false, erro: mensagemDe(e), ok: null })
    }
  }
  const salvar = async (ids: string[]) => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    setOk(null)
    try {
      const r = await api.salvarStories(uf, ids)
      guardarLoja((x) => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, stories: { ...x.stories, [uf]: r.produtos.length ? r.produtos : undefined } }))
      leitura.trocar((x) => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, stories: { ...x.stories, [uf]: r.produtos.length ? r.produtos : undefined } }))
      setLista(null)
      setOk(r.produtos.length ? `Story de ${estado.nome} salvo: ${r.produtos.length === 1 ? '1 produto' : `${r.produtos.length} produtos`}, nessa ordem.` : `Story de ${estado.nome} no automático.`)
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <Topo voltar={caminho.loja} titulo={<TituloTela>Stories do Início</TituloTela>} />
      <div className="pn-pagina pn-stories">
        <section className="pn-bloco pn-st-rua" aria-labelledby="h-st-rua">
          <h2 id="h-st-rua" className="sr-only">
            Rua do mercador
          </h2>
          <label className="pn-troca">
            <input type="checkbox" checked={l.ajustes.ruaNoStory} disabled={rua.ocupado} onChange={(e) => void trocarRua(e.target.checked)} />
            <span className="pn-troca-marca" aria-hidden="true" />
            <span>Rua do mercador no fim do Início (celular)</span>
          </label>
          <p className="pn-dica-bloco">
            No celular, a rua fecha o Início, depois dos produtos: o mercador anda, vende e chama pro Mercado. Desligada, a rua sai do celular; no
            computador ela continua embaixo do perfil.
          </p>
          {rua.erro && <Aviso tipo="erro">{rua.erro}</Aviso>}
          {rua.ok && <Aviso tipo="ok">{rua.ok}</Aviso>}
        </section>
        <div className="pn-filtros" role="group" aria-label="Estado">
          {estados.map((e) => (
            <button key={e.uf} type="button" className={`pn-filtro px${e.uf === uf ? ' on' : ''}`} aria-pressed={e.uf === uf} aria-label={e.nome} onClick={() => ir(caminho.storiesDe(e.uf), true)}>
              {e.uf.toUpperCase()}
              {l.stories[e.uf]?.length ? <span className="pn-filtro-n"> {l.stories[e.uf]!.length}</span> : null}
            </button>
          ))}
        </div>
        {/* no celular a prévia fica entre a lista e o "Escolher"; no computador, do lado */}
        <div className="pn-stories-grade">
          <section className="pn-bloco pn-st-passam" aria-labelledby="h-st-passam">
            <h2 id="h-st-passam" className="pn-h2">
              No story de {estado.nome}
            </h2>
            {escolhidos.length === 0 ? (
              <p className="pn-dica-bloco">
                <strong>Automático:</strong> passam os à venda em {estado.nome}, os com preço primeiro ({naTela.length === 1 ? '1 agora' : `${naTela.length} agora`}). Escolhe em “Escolher produtos” pra decidir quais e em que ordem.
              </p>
            ) : (
              <>
                <p className="pn-dica-bloco">
                  {escolhidos.length} de {MAX}. O que não tá à venda em {estado.nome} na hora não passa{passam.length === 0 ? '; como nenhum tá, passa o automático' : ''}.
                </p>
                <ol className="pn-ordem">
                  {escolhidos.map((id, i) => {
                    const p = porId.get(id)
                    if (!p) return null
                    const s = sit(p)
                    const fora = !aVenda(s)
                    return (
                      <li key={id} className={`pn-ordem-item${fora ? ' pn-ordem-fora' : ''}`}>
                        <span className="pn-ordem-n px">{i + 1}</span>
                        <ArteProduto produto={p} largura={28} halo={false} cinza={fora} />
                        <span className="pn-ordem-nome">
                          <span>
                            <NomeProduto p={p} />
                          </span>
                          {fora && <small>{s === 'fora' ? 'fora do site' : s === 'esgotado' ? 'esgotado' : `indisponível em ${estado.uf.toUpperCase()}`}: não passa</small>}
                        </span>
                        <button type="button" id={`st-c-${id}`} className="icone-botao" aria-label={`Subir ${p.nome}`} aria-disabled={i === 0 || undefined} onClick={() => mover(i, -1)}>
                          <Ic nome="chevron-cima" tamanho={16} />
                        </button>
                        <button type="button" id={`st-b-${id}`} className="icone-botao" aria-label={`Descer ${p.nome}`} aria-disabled={i === escolhidos.length - 1 || undefined} onClick={() => mover(i, 1)}>
                          <Ic nome="chevron-baixo" tamanho={16} />
                        </button>
                        <button type="button" className="icone-botao" aria-label={`Tirar ${p.nome} do story`} onClick={() => setLista(escolhidos.filter((x) => x !== id))}>
                          <Ic nome="fechar" tamanho={16} />
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {ok && <Aviso tipo="ok">{ok}</Aviso>}
            {/* sem nada pra salvar e no automático, o botão nem aparece */}
            {(mexeu || salvo.length > 0) && (
              <div className="pn-botoes pn-botoes-linha pn-stories-botoes">
                <Botao onClick={() => void salvar(escolhidos)} ocupado={ocupado} disabled={!mexeu}>
                  Salvar o story
                </Botao>
                {salvo.length > 0 && (
                  <Botao variante="cinza" onClick={() => void salvar([])} disabled={ocupado}>
                    Voltar pro automático
                  </Botao>
                )}
              </div>
            )}
          </section>

          <aside className="pn-editar-previa pn-stories-previa" aria-labelledby="h-st-previa">
            <h2 id="h-st-previa" className="pn-h2">
              Como passa no site
            </h2>
            <PreviaStory produtos={naTela} atual={Math.min(atual, Math.max(0, naTela.length - 1))} instagram={estado.instagram} />
            {naTela.length > 1 && (
              <div className="pn-botoes pn-botoes-linha pn-previa-passar">
                <Botao variante="cinza" onClick={() => setAtual((a) => (a - 1 + naTela.length) % naTela.length)} aria-label="Produto anterior na prévia">
                  <Ic nome="chevron-esq" tamanho={16} />
                </Botao>
                <span className="pn-previa-pos px" aria-live="polite">
                  {Math.min(atual, naTela.length - 1) + 1}/{naTela.length}
                </span>
                <Botao variante="cinza" onClick={() => setAtual((a) => (a + 1) % naTela.length)} aria-label="Próximo produto na prévia">
                  <Ic nome="chevron-dir" tamanho={16} />
                </Botao>
              </div>
            )}
            <p className="pn-dica-bloco pn-previa-legenda-p">
              {auto ? 'No automático agora.' : 'A tua ordem.'} Pra mudar o que tá à venda,{' '}
              <Link href={caminho.produtos} className="pn-link pn-link-dentro">
                Produtos
              </Link>
              .
            </p>
          </aside>

          <section className="pn-bloco pn-st-escolher" aria-labelledby="h-st-escolher">
            <h2 id="h-st-escolher" className="pn-h2">
              Escolher produtos
            </h2>
            <label className="pn-troca pn-troca-p">
              <input type="checkbox" checked={soAVenda} onChange={(e) => setSoAVenda(e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Só os à venda em {estado.uf.toUpperCase()}</span>
            </label>
            {escolhidos.length >= MAX && <p className="pn-dica-bloco">O story tá cheio ({MAX}). Tira um pra pôr outro.</p>}
            {disponiveisPraEscolher.length === 0 ? (
              <p className="pn-vazio">{soAVenda ? `Nenhum outro à venda em ${estado.nome}.` : 'Nenhum outro produto.'}</p>
            ) : (
              <ul className="pn-lista-escolher">
                {disponiveisPraEscolher.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="pn-escolher toque" disabled={escolhidos.length >= MAX} onClick={() => setLista([...escolhidos, p.id])} aria-label={`Pôr ${p.nome} no story`}>
                      <ArteProduto produto={p} largura={28} halo={false} cinza={!aVenda(sit(p))} />
                      <span className="pn-escolher-txt">
                        <strong>
                          <NomeProduto p={p} />
                        </strong>
                        <span>
                          {p.preco == null ? 'Consultar' : brl(p.preco)}
                          {aVenda(sit(p)) ? '' : ` · indisponível em ${estado.uf.toUpperCase()}`}
                        </span>
                      </span>
                      <Ic nome="mais" tamanho={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
