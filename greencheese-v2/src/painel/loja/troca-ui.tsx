// As peças da troca rápida na tela, as mesmas em Produtos (o dono) e em Estoque (o gerente): o interruptor "À venda" com
// o estoque − e + de um estado, os chips "À venda em:" de todos os estados (em Produtos, sem estado escolhido), a folha
// de digitar o estoque e o recado de cada troca, com "Desfazer" (põe de volta como estava). A fila e o pedido ficam em
// trocas.ts.
import { useEffect, useRef, useState } from 'react'
import type { Leitura } from '../dados'
import { Folha } from '../Folha'
import { recado } from '../recado'
import { Botao, Ic } from '../ui'
import { noEstado, situacao, type Situacao } from './dados'
import { useTrocasRapidas } from './trocas'
import type { EstadoAdmin, LojaAdmin, NoEstado, ProdutoAdmin } from './tipos'

/** O que a pessoa lê do estado de um produto num estado (o rótulo do chip e do leitor de tela). */
export function frase(s: Situacao, e: NoEstado): string {
  if (s === 'fora') return 'fora do site'
  if (s === 'desligado') return 'fora de venda'
  if (s === 'esgotado') return 'esgotado (0 no estoque)'
  return e.estoque != null ? `à venda, ${e.estoque} no estoque` : 'à venda'
}

/** O recado de cada troca ("Seda OCB saiu de MG (indisponível)"), com o "Desfazer" que põe de volta como estava. */
export function fraseDaTroca(p: ProdutoAdmin, e: EstadoAdmin, antes: NoEstado, depois: NoEstado): string {
  const uf = e.uf.toUpperCase()
  if (antes.disponivel !== depois.disponivel) {
    if (depois.disponivel) return depois.estoque === 0 ? `${p.nome}: ligado em ${uf}, mas com 0 no estoque (esgotado)` : `${p.nome} voltou pra venda em ${uf}`
    return `${p.nome} saiu de ${uf} (indisponível)`
  }
  if (depois.estoque == null) return `${p.nome}: parou de contar o estoque em ${uf}`
  if (depois.estoque === 0) return `${p.nome}: 0 em ${uf}, saiu do site lá`
  if (antes.estoque === 0) return `${p.nome}: ${depois.estoque} em ${uf}, voltou pra venda lá`
  return `${p.nome}: ${depois.estoque} em ${uf}`
}

/** A troca rápida com o recado de sempre embaixo (e o Desfazer): o mesmo em Produtos e em Estoque. */
export function useTrocaComRecado(leitura: Leitura<LojaAdmin>) {
  const trocas = useTrocasRapidas(leitura)
  const mudar = (p: ProdutoAdmin, e: EstadoAdmin, n: NoEstado) => {
    const antes = noEstado(p, e.uf)
    if (antes.disponivel === n.disponivel && antes.estoque === n.estoque) return
    trocas.mudar(p, e.uf, n)
    recado(fraseDaTroca(p, e, antes, n), { desfazer: { acao: () => trocas.mudar(p, e.uf, antes) } })
  }
  return { ...trocas, mudar }
}

/** Um estado escolhido: o interruptor "À venda" e o estoque (− e + mandam na hora; o número abre pra digitar). */
export function ControleEstado({
  p,
  e,
  restamAte,
  salvando,
  aoMudar,
  aoContar,
}: {
  p: ProdutoAdmin
  e: EstadoAdmin
  restamAte: number | null
  salvando: boolean
  aoMudar: (n: NoEstado) => void
  aoContar: () => void
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
  )
}

/** Um chip "MG": ligado (✓ MG), fora de venda (MG riscado) ou esgotado (MG · 0, tracejado). */
function Chip({ p, e, restamAte, salvando, aoMudar }: { p: ProdutoAdmin; e: EstadoAdmin; restamAte: number | null; salvando: boolean; aoMudar: (n: NoEstado) => void }) {
  const ne = noEstado(p, e.uf)
  const s = situacao(p, e.uf, restamAte)
  const on = ne.disponivel
  return (
    <button
      type="button"
      className={`pn-chip-est px${on ? ' on' : ''}${s === 'esgotado' ? ' esgotado' : ''}${salvando ? ' pn-salvando' : ''}`}
      aria-pressed={on}
      aria-label={`${p.nome} em ${e.nome}: ${frase(s, ne)}. Toca pra ${on ? 'tirar de venda' : 'pôr à venda'}`}
      onClick={() => aoMudar({ ...ne, disponivel: !on })}
    >
      {on && ne.estoque == null && <Ic nome="check" tamanho={16} />}
      <span className="pn-chip-est-uf">{e.uf.toUpperCase()}</span>
      {ne.estoque != null && <span className="pn-chip-est-n">{ne.estoque}</span>}
    </button>
  )
}

/** Sem estado escolhido: "À venda em:" e um chip por estado do site (tocar liga ou desliga ali; o estoque, se tiver, fica). */
export function ChipsEstados({
  p,
  estados,
  restamAte,
  salvando,
  aoMudar,
}: {
  p: ProdutoAdmin
  estados: EstadoAdmin[]
  restamAte: number | null
  salvando: (uf: string) => boolean
  aoMudar: (e: EstadoAdmin, n: NoEstado) => void
}) {
  const idLegenda = `venda-${p.id}`
  return (
    <div className="pn-chips-linha">
      <span id={idLegenda} className="pn-chips-legenda">
        À venda em:
      </span>
      <div className="pn-chips-est" role="group" aria-labelledby={idLegenda}>
        {estados.map((e) => (
          <Chip key={e.uf} p={p} e={e} restamAte={restamAte} salvando={salvando(e.uf)} aoMudar={(n) => aoMudar(e, n)} />
        ))}
      </div>
    </div>
  )
}

/** A legenda dos chips, uma vez em cima da lista: o que cada um quer dizer. */
export function LegendaChips() {
  return (
    <p className="pn-legenda-chips" aria-hidden="true">
      <span className="pn-legenda-par">
        <span className="pn-chip-est px on pn-chip-mini">
          <Ic nome="check" tamanho={16} />
          <span className="pn-chip-est-uf">MG</span>
        </span>
        à venda
      </span>
      <span className="pn-legenda-par">
        <span className="pn-chip-est px pn-chip-mini">
          <span className="pn-chip-est-uf">MG</span>
        </span>
        fora de venda
      </span>
      <span className="pn-legenda-par">
        <span className="pn-chip-est px on esgotado pn-chip-mini">
          <span className="pn-chip-est-uf">MG</span>
          <span className="pn-chip-est-n">0</span>
        </span>
        esgotado
      </span>
    </p>
  )
}

/** Digitar o estoque (ou parar de contar). */
export function FolhaEstoque({ alvo, aoFechar, aoSalvar }: { alvo: { p: ProdutoAdmin; e: EstadoAdmin } | null; aoFechar: () => void; aoSalvar: (n: NoEstado) => void }) {
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
