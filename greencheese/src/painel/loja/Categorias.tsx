// Categorias: as bolinhas dos destaques do site (que filtram a grade). Nome, nome curto (o de baixo da bolinha),
// ícone e se é bebida (bebida nunca entra em prêmio do Teste minha sorte). Subir e descer muda a ordem no site.
// Apagar (dentro da edição) só vazia e sem prêmio.
import { useRef, useState } from 'react'
import { ErroApi, mensagemDe } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { Folha } from '../Folha'
import { Topo } from '../Moldura'
import { caminho } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { guardarLoja, useLoja } from './dados'
import { ICONES } from './nomes'
import type { CategoriaAdmin } from './tipos'
import { problemaNoTexto, tamanho } from './validar'

interface FormCat {
  id?: string
  nome: string
  curto: string
  icone: string
  bebida: boolean
}

function FolhaCategoria({ alvo, cat, aoFechar, aoSalvar, aoApagar }: { alvo: FormCat | null; cat?: CategoriaAdmin; aoFechar: () => void; aoSalvar: () => void; aoApagar?: () => void }) {
  const [f, setF] = useState<FormCat | null>(alvo)
  const [erros, setErros] = useState<Partial<Record<keyof FormCat, string>>>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const nome = useRef<HTMLInputElement>(null)
  if (!alvo || !f) return null
  const mudar = <K extends keyof FormCat>(k: K, v: FormCat[K]) => {
    setF({ ...f, [k]: v })
    setErros((e) => ({ ...e, [k]: undefined }))
  }
  const salvar = async () => {
    if (ocupado) return
    const e: Partial<Record<keyof FormCat, string>> = {}
    if (tamanho(f.nome) < 2 || tamanho(f.nome) > 30) e.nome = 'Nome de 2 a 30 letras.'
    else if (problemaNoTexto(f.nome)) e.nome = problemaNoTexto(f.nome) ?? undefined
    if (tamanho(f.curto) < 2 || tamanho(f.curto) > 14) e.curto = 'Nome curto de 2 a 14 letras (é o que aparece embaixo da bolinha).'
    setErros(e)
    if (e.nome || e.curto) return
    setOcupado(true)
    setGeral(null)
    try {
      await api.salvarCategoria({ ...(f.id ? { id: f.id } : {}), nome: f.nome.trim(), curto: f.curto.trim(), icone: f.icone, bebida: f.bebida })
      aoSalvar()
      aoFechar()
    } catch (err) {
      if (err instanceof ErroApi && (err.campo === 'nome' || err.campo === 'curto' || err.campo === 'bebida')) setErros({ [err.campo]: err.message })
      else setGeral(mensagemDe(err))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      preso={ocupado}
      titulo={f.id ? `Editar ${alvo.nome}` : 'Nova categoria'}
      focoInicial={nome}
      rodape={
        <Botao largo ocupado={ocupado} onClick={() => void salvar()}>
          {f.id ? 'Salvar' : 'Criar categoria'}
        </Botao>
      }
    >
      <form
        className="pn-folha-pad pn-form"
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
      >
        <Campo id="c-nome" rotulo="Nome" erro={erros.nome} lado={<span className="pn-contagem">{tamanho(f.nome)}/30</span>}>
          {(a) => (
            <input
              {...a}
              ref={nome}
              name="nome"
              className="pn-input"
              autoComplete="off"
              maxLength={30}
              placeholder="Ex.: Bebidas importadas"
              value={f.nome}
              onChange={(e) => {
                const v = e.target.value
                // o curto acompanha o nome enquanto cabe e ninguém mexeu nele
                setF((s) => (s ? { ...s, nome: v, curto: !s.id && (s.curto === '' || s.curto === s.nome.slice(0, 14)) ? v.slice(0, 14) : s.curto } : s))
                setErros((x) => ({ ...x, nome: undefined }))
              }}
            />
          )}
        </Campo>
        <Campo id="c-curto" rotulo="Nome curto" erro={erros.curto} dica="Embaixo da bolinha nos destaques do site." lado={<span className="pn-contagem">{tamanho(f.curto)}/14</span>}>
          {(a) => <input {...a} name="curto" className="pn-input" autoComplete="off" maxLength={14} placeholder="Importadas" value={f.curto} onChange={(e) => mudar('curto', e.target.value)} />}
        </Campo>
        <fieldset className="pn-opcoes">
          <legend className="pn-rotulo">Ícone</legend>
          <div className="pn-icones">
            {ICONES.map((x) => (
              <label key={x.id} className={`pn-icone-opcao${f.icone === x.id ? ' on' : ''}`}>
                <input type="radio" name="icone" checked={f.icone === x.id} onChange={() => mudar('icone', x.id)} />
                <Ic nome={x.id} tamanho={32} />
                <span className="sr-only">{x.nome}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="pn-troca">
          <input type="checkbox" checked={f.bebida} onChange={(e) => mudar('bebida', e.target.checked)} />
          <span className="pn-troca-marca" aria-hidden="true" />
          <span>É bebida</span>
        </label>
        {erros.bebida ? (
          <p className="pn-erro">
            <Ic nome="atencao" tamanho={16} />
            <span>{erros.bebida}</span>
          </p>
        ) : (
          <p className="pn-dica-bloco">Bebida (com ou sem álcool) nunca entra em prêmio do Teste minha sorte.</p>
        )}
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
        {cat && aoApagar && (
          <div className="pn-apagar">
            {cat.produtos > 0 || cat.premios.length > 0 ? (
              <p className="pn-dica-bloco">
                {cat.produtos > 0
                  ? `Pra apagar, muda ${cat.produtos === 1 ? 'o produto' : `os ${cat.produtos} produtos`} de categoria antes.`
                  : `Pra apagar, muda antes o prêmio “${cat.premios[0].titulo}” (vale em ${cat.nome}).`}
              </p>
            ) : (
              <button type="button" className="pn-botao pn-botao-texto pn-botao-perigo" onClick={aoApagar} disabled={ocupado}>
                <Ic nome="lixo" tamanho={16} />
                <span className="pn-botao-txt">Apagar categoria</span>
              </button>
            )}
          </div>
        )}
      </form>
    </Folha>
  )
}

export function Categorias() {
  useTitulo('Categorias')
  const leitura = useLoja(0)
  const l = leitura.dados
  const [editando, setEditando] = useState<FormCat | null>(null)
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [movendo, setMovendo] = useState(false)
  useRestaurarRolagem(!!l)

  const recarregar = () => {
    void leitura.recarregar()
  }
  const mover = async (lista: CategoriaAdmin[], i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= lista.length || movendo) return
    const ids = lista.map((c) => c.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setMovendo(true)
    setErro(null)
    // na tela na hora; o servidor confirma
    leitura.trocar((x) => ({ ...x, categorias: ids.map((id) => x.categorias.find((c) => c.id === id)!) }))
    try {
      const r = await api.ordemCategorias(ids)
      guardarLoja((x) => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, categorias: r.ordem.map((id) => x.categorias.find((c) => c.id === id)!).filter(Boolean) }))
      requestAnimationFrame(() => document.getElementById(`cat-${d < 0 ? 'c' : 'b'}-${lista[i].id}`)?.focus())
    } catch (e) {
      setErro(mensagemDe(e))
      recarregar()
    } finally {
      setMovendo(false)
    }
  }
  const pedirApagar = (c: CategoriaAdmin) =>
    setConfirmacao({
      titulo: `Apagar ${c.nome}?`,
      texto: 'Sai dos destaques do site.',
      botao: 'Apagar categoria',
      perigo: true,
      acao: async () => {
        await api.apagarCategoria(c.id)
        recarregar()
      },
    })

  return (
    <>
      <Topo
        voltar={caminho.loja}
        titulo={<TituloTela>Categorias</TituloTela>}
        acoes={
          <button type="button" className="pn-botao pn-botao-cheio pn-botao-p" aria-label="Nova categoria" onClick={() => setEditando({ nome: '', curto: '', icone: 'estrela', bebida: false })}>
            <Ic nome="mais" tamanho={16} />
            <span className="pn-botao-txt">
              Nova<span className="pn-txt-sufixo"> categoria</span>
            </span>
          </button>
        }
      />
      <div className="pn-pagina pn-pagina-estreita">
        {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!l && !leitura.erro && <Carregando />}
        {l && (
          <>
            <p className="pn-dica-bloco">Na ordem dos destaques do site. Toca no nome pra editar ou apagar.</p>
            <ol className="pn-lista-cat">
              {l.categorias.map((c, i) => {
                return (
                  <li key={c.id} className="pn-cat">
                    <button type="button" className="pn-cat-abrir toque" onClick={() => setEditando({ id: c.id, nome: c.nome, curto: c.curto, icone: c.icone, bebida: c.bebida })} aria-label={`Editar ${c.nome}`}>
                      <span className="pn-cat-bola" aria-hidden="true">
                        <Ic nome={c.icone} tamanho={32} />
                      </span>
                      <span className="pn-cat-txt">
                        <strong>{c.nome}</strong>
                        <span>
                          {c.curto !== c.nome ? `${c.curto} · ` : ''}
                          {c.produtos === 1 ? '1 produto' : `${c.produtos} produtos`}
                          {c.bebida ? ' · bebida' : ''}
                          {c.premios.length ? ` · ${c.premios.length === 1 ? '1 prêmio' : `${c.premios.length} prêmios`}` : ''}
                        </span>
                      </span>
                    </button>
                    <span className="pn-cat-acoes">
                      <button type="button" id={`cat-c-${c.id}`} className="icone-botao" aria-label={`Subir ${c.nome}`} aria-disabled={i === 0 || movendo || undefined} onClick={() => void mover(l.categorias, i, -1)}>
                        <Ic nome="chevron-cima" tamanho={16} />
                      </button>
                      <button type="button" id={`cat-b-${c.id}`} className="icone-botao" aria-label={`Descer ${c.nome}`} aria-disabled={i === l.categorias.length - 1 || movendo || undefined} onClick={() => void mover(l.categorias, i, 1)}>
                        <Ic nome="chevron-baixo" tamanho={16} />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
      {editando && (
        <FolhaCategoria
          key={editando.id ?? 'nova'}
          alvo={editando}
          cat={editando.id ? l?.categorias.find((c) => c.id === editando.id) : undefined}
          aoFechar={() => setEditando(null)}
          aoSalvar={recarregar}
          aoApagar={() => {
            const c = l?.categorias.find((x) => x.id === editando.id)
            setEditando(null)
            if (c) pedirApagar(c)
          }}
        />
      )}
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
