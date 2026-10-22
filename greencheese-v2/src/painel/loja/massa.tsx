// Classificar em massa por estado (pedido do Ian em 22/10: "Classificar em massa por estado"): em Produtos, o
// "Selecionar" marca vários produtos e a folha daqui escolhe os estados e o que fazer neles — pôr à venda, tirar de
// venda, esgotado, contar o estoque, sem contagem ou copiar de outro estado —, com a confirmação curta ("12 produtos ·
// RJ e SP · pôr à venda") antes e o recado com "Desfazer" depois. Tudo vai num pedido só (admin-produtos-em-massa, numa
// transação no servidor), e o Desfazer manda de volta o "antes" que a resposta trouxe.
import { useEffect, useId, useRef, useState } from 'react'
import { mensagemDe } from '../api'
import type { Leitura } from '../dados'
import { Folha } from '../Folha'
import { recado } from '../recado'
import { Aviso, Botao, Ic } from '../ui'
import * as api from './api'
import { guardarLoja } from './dados'
import type { EstadoAdmin, LojaAdmin, ProdutoAdmin } from './tipos'

export type AcaoMassa = 'vender' | 'tirar' | 'esgotado' | 'contar' | 'sem-contagem' | 'copiar'

const ACOES: { id: AcaoMassa; nome: string; dica: string }[] = [
  { id: 'vender', nome: 'Pôr à venda', dica: 'Aparece no site nesses estados. O estoque contado fica como está.' },
  { id: 'tirar', nome: 'Tirar de venda', dica: 'Sai do site nesses estados. O estoque fica guardado.' },
  { id: 'esgotado', nome: 'Esgotado (0 no estoque)', dica: 'Sai do site e volta sozinho quando tu contar mais.' },
  { id: 'contar', nome: 'Contar o estoque', dica: 'O mesmo número em todos. Mais de 0 já põe à venda.' },
  { id: 'sem-contagem', nome: 'Sem contagem', dica: 'Para de contar o estoque. O à venda fica como está.' },
  { id: 'copiar', nome: 'Copiar de outro estado', dica: 'O à venda e o estoque de um estado viram os destes.' },
]

/** "RJ" · "RJ e SP" · "RJ, SP e MG". */
export function listaUfs(ufs: string[]): string {
  const u = ufs.map((x) => x.toUpperCase())
  return u.length <= 1 ? (u[0] ?? '') : `${u.slice(0, -1).join(', ')} e ${u[u.length - 1]}`
}

const produtos = (n: number) => `${n} ${n === 1 ? 'produto' : 'produtos'}`

/** A ação em poucas palavras (o resumo da confirmação). */
function acaoCurta(acao: AcaoMassa, estoque: number | null, de: string | null): string {
  switch (acao) {
    case 'vender':
      return 'pôr à venda'
    case 'tirar':
      return 'tirar de venda'
    case 'esgotado':
      return 'esgotado (0 no estoque)'
    case 'contar':
      return `${estoque ?? 0} no estoque`
    case 'sem-contagem':
      return 'sem contagem'
    case 'copiar':
      return `copiar de ${(de ?? '').toUpperCase()}`
  }
}

/** O botão de fazer, na confirmação. */
function botaoDa(acao: AcaoMassa, estoque: number | null, de: string | null): string {
  switch (acao) {
    case 'vender':
      return 'Pôr à venda'
    case 'tirar':
      return 'Tirar de venda'
    case 'esgotado':
      return 'Marcar esgotado'
    case 'contar':
      return `Contar ${estoque ?? 0}`
    case 'sem-contagem':
      return 'Parar de contar'
    case 'copiar':
      return `Copiar de ${(de ?? '').toUpperCase()}`
  }
}

/** O recado depois de fazer ("12 produtos à venda em RJ e SP"). */
function fraseFeito(acao: AcaoMassa, n: number, ufs: string, estoque: number | null, de: string | null): string {
  const p = produtos(n)
  switch (acao) {
    case 'vender':
      return `${p} à venda em ${ufs}`
    case 'tirar':
      return `${p} fora de venda em ${ufs}`
    case 'esgotado':
      return `${p} ${n === 1 ? 'esgotado' : 'esgotados'} em ${ufs} (0 no estoque)`
    case 'contar':
      return `${p} com ${estoque ?? 0} no estoque em ${ufs}`
    case 'sem-contagem':
      return `${p} sem contar o estoque em ${ufs}`
    case 'copiar':
      return `${p} ${n === 1 ? 'igual' : 'iguais'} a ${(de ?? '').toUpperCase()} em ${ufs}`
  }
}

/** Põe a resposta do servidor na tela (só os produtos que mudaram, e a versão). */
function aplicarResposta(leitura: Leitura<LojaAdmin>, r: { produtos: ProdutoAdmin[]; versao: number; atualizadoEm: string }) {
  const novos = new Map(r.produtos.map((p) => [p.id, p]))
  const f = (x: LojaAdmin): LojaAdmin => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, produtos: x.produtos.map((p) => novos.get(p.id) ?? p) })
  leitura.trocar(f)
  guardarLoja(f)
}

/**
 * A folha da mudança em massa: os estados (um ou vários), o que fazer e, no passo seguinte, a confirmação curta. Feito,
 * o recado embaixo com "Desfazer" (põe cada produto de volta como estava, em cada estado).
 */
export function FolhaMassa({
  aberta,
  aoFechar,
  leitura,
  ids,
  estados,
  ufInicial,
}: {
  aberta: boolean
  aoFechar: () => void
  leitura: Leitura<LojaAdmin>
  ids: string[]
  estados: EstadoAdmin[]
  ufInicial: string | null
}) {
  const [ufs, setUfs] = useState<string[]>([])
  const [acao, setAcao] = useState<AcaoMassa | null>(null)
  const [estoque, setEstoque] = useState('')
  const [de, setDe] = useState<string | null>(null)
  const [passo, setPasso] = useState<'escolher' | 'confirmar'>('escolher')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const trava = useRef(false)
  const campo = useRef<HTMLInputElement>(null)
  const id = useId()
  // abriu: o estado do filtro da lista já vem marcado
  useEffect(() => {
    if (!aberta) return
    setUfs(ufInicial ? [ufInicial] : [])
    setAcao(null)
    setEstoque('')
    setDe(null)
    setPasso('escolher')
    setErro(null)
  }, [aberta, ufInicial])
  // o estado de onde copia não pode ser um dos que recebem
  useEffect(() => {
    if (de && ufs.includes(de)) setDe(null)
  }, [ufs, de])
  // o erro de um passo some quando a pessoa mexe no que ele pedia
  useEffect(() => setErro(null), [ufs, acao, de])
  const l = leitura.dados
  const marcados = l ? l.produtos.filter((p) => ids.includes(p.id)) : []
  const foraDoSite = marcados.filter((p) => !p.ativo).length
  const n = marcados.length
  const todosUfs = estados.map((e) => e.uf)
  const tudo = ufs.length === todosUfs.length && todosUfs.length > 0
  const numero = /^\d{1,4}$/.test(estoque.trim()) ? Number(estoque.trim()) : null
  const origens = estados.filter((e) => !ufs.includes(e.uf))

  const continuar = () => {
    setErro(null)
    if (!ufs.length) return setErro('Escolhe pelo menos um estado.')
    if (!acao) return setErro('Escolhe o que fazer nesses estados.')
    if (acao === 'contar' && numero == null) {
      setErro('Põe quantas unidades tem (de 0 a 9.999).')
      campo.current?.focus()
      return
    }
    if (acao === 'copiar' && !de) return setErro(origens.length ? 'Escolhe de qual estado copiar.' : 'Pra copiar, deixa de fora o estado de onde copia.')
    setPasso('confirmar')
  }

  const fazer = async () => {
    if (!acao || trava.current) return
    trava.current = true
    setOcupado(true)
    setErro(null)
    const ordem = todosUfs.filter((u) => ufs.includes(u))
    try {
      const r = await api.emMassa({ ids, ufs: ordem, acao, ...(acao === 'contar' ? { estoque: numero ?? 0 } : {}), ...(acao === 'copiar' && de ? { de } : {}) })
      aplicarResposta(leitura, r)
      aoFechar()
      if (!r.mudancas.length) {
        recado(`Nada mudou: ${n === 1 ? 'o produto já estava' : `os ${n} já estavam`} assim em ${listaUfs(ordem)}.`, { tipo: 'info' })
        return
      }
      const mudaram = new Set(r.mudancas.map((m) => m.id)).size
      // pôr à venda com 0 no estoque continua esgotado (sai do site): o recado diz
      const seguem = acao === 'vender' ? new Set(r.mudancas.filter((m) => m.depois.estoque === 0).map((m) => m.id)).size : 0
      const texto = fraseFeito(acao, mudaram, listaUfs(ordem), numero, de) + (seguem ? ` (${seguem === 1 ? '1 segue esgotado' : `${seguem} seguem esgotados`}: 0 no estoque)` : '')
      const antes = r.mudancas.map((m) => ({ id: m.id, uf: m.uf, ...m.antes }))
      recado(texto, {
        desfazer: {
          acao: async () => {
            try {
              const d = await api.emMassa({ acao: 'definir', estados: antes })
              aplicarResposta(leitura, d)
              recado(`Desfeito: ${produtos(new Set(antes.map((a) => a.id)).size)} de volta como estavam em ${listaUfs(ordem)}.`)
            } catch (e) {
              recado(`Não deu pra desfazer: ${mensagemDe(e)}`, { tipo: 'erro' })
              void leitura.recarregar()
            }
          },
        },
      })
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }

  const resumo = acao ? `${produtos(n)} · ${listaUfs(todosUfs.filter((u) => ufs.includes(u)))} · ${acaoCurta(acao, numero, de)}` : ''
  return (
    <Folha
      aberta={aberta}
      aoFechar={aoFechar}
      preso={ocupado}
      papel={passo === 'confirmar' ? 'alertdialog' : 'dialog'}
      titulo={passo === 'confirmar' ? 'Confere antes' : `Mudar ${produtos(n)}`}
      sub={passo === 'confirmar' ? undefined : 'Escolhe os estados e o que fazer neles.'}
      rodape={
        passo === 'confirmar' ? (
          <div className="pn-botoes">
            <Botao largo ocupado={ocupado} onClick={() => void fazer()}>
              {acao ? botaoDa(acao, numero, de) : 'Fazer'}
            </Botao>
            <Botao variante="texto" largo disabled={ocupado} onClick={() => setPasso('escolher')}>
              Voltar e mudar
            </Botao>
          </div>
        ) : (
          <div className="pn-botoes">
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <Botao largo onClick={continuar}>
              Continuar
            </Botao>
          </div>
        )
      }
    >
      {passo === 'confirmar' ? (
        <div className="pn-folha-pad pn-confirmar pn-massa-confere">
          <p className="pn-massa-resumo">{resumo}</p>
          <p className="pn-dica-bloco">
            {foraDoSite > 0 &&
              `${foraDoSite === 1 ? '1 deles está fora do site' : `${foraDoSite} deles estão fora do site`}: muda nos estados, mas só aparece quando voltar pro site. `}
            Errou? O recado embaixo tem “Desfazer”.
          </p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </div>
      ) : (
        <div className="pn-folha-pad pn-form pn-massa">
          <fieldset className="pn-massa-grupo">
            <legend className="pn-rotulo">Em quais estados</legend>
            <div className="pn-filtros pn-massa-ufs">
              <button type="button" className={`pn-filtro${tudo ? ' on' : ''}`} aria-pressed={tudo} onClick={() => setUfs(tudo ? [] : todosUfs)}>
                Todos
              </button>
              {estados.map((e) => {
                const on = ufs.includes(e.uf)
                return (
                  <button
                    key={e.uf}
                    type="button"
                    className={`pn-filtro px${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={e.nome}
                    onClick={() => setUfs((x) => (on ? x.filter((u) => u !== e.uf) : [...x, e.uf]))}
                  >
                    {e.uf.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset className="pn-massa-grupo">
            <legend className="pn-rotulo">O que fazer</legend>
            <div className="pn-massa-acoes" role="radiogroup" aria-label="O que fazer">
              {ACOES.map((a) => {
                const on = acao === a.id
                return (
                  <div key={a.id} className={`pn-massa-acao${on ? ' on' : ''}`}>
                    <label className="pn-marcar pn-marcar-redondo">
                      <input type="radio" name={`${id}-acao`} value={a.id} checked={on} onChange={() => setAcao(a.id)} aria-describedby={`${id}-${a.id}`} />
                      <span className="pn-marcar-caixa" aria-hidden="true">
                        {on && <Ic nome="check" tamanho={16} />}
                      </span>
                      <span className="pn-massa-acao-txt">
                        <span className="pn-massa-acao-nome">{a.nome}</span>
                        <span id={`${id}-${a.id}`} className="pn-dica">
                          {a.dica}
                        </span>
                      </span>
                    </label>
                    {on && a.id === 'contar' && (
                      <div className="pn-campo pn-massa-extra">
                        <label className="pn-rotulo" htmlFor={`${id}-n`}>
                          Unidades
                        </label>
                        <input
                          ref={campo}
                          id={`${id}-n`}
                          className="pn-input pn-input-num"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          value={estoque}
                          onChange={(ev) => {
                            setEstoque(ev.target.value.replace(/\D/g, '').slice(0, 4))
                            setErro(null)
                          }}
                        />
                      </div>
                    )}
                    {on && a.id === 'copiar' && (
                      <div className="pn-massa-extra" role="group" aria-label="Copiar de qual estado">
                        <p className="pn-rotulo">Copiar de</p>
                        {origens.length ? (
                          <div className="pn-filtros pn-massa-ufs">
                            {origens.map((e) => (
                              <button key={e.uf} type="button" className={`pn-filtro px${de === e.uf ? ' on' : ''}`} aria-pressed={de === e.uf} aria-label={`Copiar de ${e.nome}`} onClick={() => setDe(e.uf)}>
                                {e.uf.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="pn-dica">Deixa de fora, lá em cima, o estado de onde copiar.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </fieldset>
        </div>
      )}
    </Folha>
  )
}
