// As peças do Teste minha sorte no painel: o selo e as fichas da raridade (as cores de src/lib/raridade.ts), a chance
// real de cada prêmio (a mesma conta do servidor: src/lib/sorteio.ts) e o teste da animação, por cima e em tela cheia,
// com a revelação do site (src/interativos/sorte/fumaca, baixada só quando abre) no modo 'previa': não conta giro nem
// cria cupom.
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { INFO_RARIDADE, RARIDADES, raridadeDe, type Raridade } from '../../lib/raridade'
import { chancesReais, formatarPct, umEm, type Chances } from '../../lib/sorteio'
import { Folha } from '../Folha'
import { Botao, Carregando, Ic } from '../ui'
import { ArteProduto } from './Arte'
import { fraseDoPremio } from './premio-ui'
import type { LojaAdmin, PremioAdmin } from './tipos'

const cores = (r: Raridade) => ({ '--rar': INFO_RARIDADE[r].cor, '--rar-clara': INFO_RARIDADE[r].clara, '--rar-escura': INFO_RARIDADE[r].escura }) as CSSProperties

/** A bolinha da cor da raridade e o nome ("Épico"). */
export function SeloRaridade({ raridade, so = false }: { raridade: Raridade; so?: boolean }) {
  return (
    <span className="pn-rar" style={cores(raridade)}>
      <i className="pn-rar-bola" aria-hidden="true" />
      {so ? <span className="sr-only">{INFO_RARIDADE[raridade].nome}</span> : INFO_RARIDADE[raridade].nome}
    </span>
  )
}

/** As 4 fichas coloridas pra escolher a raridade (rádios de verdade: setas e Espaço no teclado). */
export function FichasRaridade({ valor, aoMudar, nome = 'raridade', id }: { valor: Raridade; aoMudar: (r: Raridade) => void; nome?: string; id?: string }) {
  return (
    <div className="pn-fichas-rar" role="radiogroup" aria-label="Raridade" id={id}>
      {RARIDADES.map((r) => (
        <label key={r} className="pn-ficha-rar" style={cores(r)}>
          <input type="radio" name={nome} value={r} checked={valor === r} onChange={() => aoMudar(r)} />
          <span className="pn-ficha-rar-cara">
            <i className="pn-rar-bola" aria-hidden="true" />
            {INFO_RARIDADE[r].nome}
          </span>
        </label>
      ))}
    </div>
  )
}

/** A chance real de cada prêmio sair (0 a 1), com os prêmios que estão no jogo (os outros: 0). */
export function chancesDosPremios(premios: readonly PremioAdmin[], chances: Chances): Map<string, number> {
  const noJogo = premios.filter((p) => p.noSite)
  const m = chancesReais(noJogo, chances)
  return new Map(premios.map((p) => [p.id, m.get(p) ?? 0]))
}

/** "1 em 8 · 12,5%" */
export const textoChance = (p: number): string => (p <= 0 ? 'não sai' : `${umEm(p)} · ${formatarPct(p * 100, p < 0.01 ? 2 : 1)}`)

/* ───────────────────────── o teste da animação ───────────────────────── */

const Revelacao = lazy(() => import('../../interativos/sorte/fumaca').then((m) => ({ default: m.RevelacaoFumaca })))

class SemAnimacao extends Component<{ children: ReactNode }, { erro: boolean }> {
  state = { erro: false }
  static getDerivedStateFromError() {
    return { erro: true }
  }
  render() {
    return this.state.erro ? <p className="pn-dica-bloco pn-teste-erro">Não deu pra abrir a animação agora. Fecha e tenta de novo.</p> : this.props.children
  }
}

/** Um prêmio pro teste: o destaque e o produto como o site mostra, a raridade e o produto pra arte. */
export interface CenaTeste {
  raridade: Raridade
  destaque: string
  produto: string
  /** O produto da foto/arte (sem produto: só o texto). */
  arte: Parameters<typeof ArteProduto>[0]['produto'] | null
  /** Sem prêmio dessa raridade na loja: a cena é um exemplo. */
  exemplo?: boolean
}

/** A cena do teste a partir de um prêmio (salvo ou o que tá no formulário). */
export function cenaDoPremio(p: Pick<PremioAdmin, 'tipo' | 'valor' | 'titulo' | 'aplicaA'> & { raridade?: Raridade }, l: LojaAdmin): CenaTeste {
  const { destaque, alvo, produto } = fraseDoPremio(p, l)
  // "em qualquer seda" vira "Qualquer seda" (no meio da revelação, sem o "em")
  const nome = alvo.replace(/^em /, '')
  return { raridade: raridadeDe(p), destaque, produto: nome ? nome[0].toUpperCase() + nome.slice(1) : destaque, arte: produto }
}

/** As 4 raridades: o primeiro prêmio no jogo de cada uma (ou um exemplo, quando a loja não tem). */
export function cenasDasRaridades(l: LojaAdmin): CenaTeste[] {
  return RARIDADES.map((r) => {
    const p = l.sorte.premios.find((x) => x.noSite && x.raridade === r) ?? l.sorte.premios.find((x) => x.raridade === r)
    return p ? cenaDoPremio(p, l) : { raridade: r, destaque: '15% OFF', produto: 'Prêmio de exemplo', arte: null, exemplo: true }
  })
}

/**
 * O teste da animação: por cima e em tela cheia (a folha do painel: Esc fecha, o voltar do Android fecha, o foco volta
 * pra quem abriu), com Repetir e Fechar; com mais de uma cena, as fichas da raridade trocam de uma pra outra.
 */
export function TesteAnimacao({ cenas, inicio = 0, aoFechar, titulo = 'Testar a animação' }: { cenas: CenaTeste[]; inicio?: number; aoFechar: () => void; titulo?: string }) {
  const [i, setI] = useState(inicio)
  const [vez, setVez] = useState(0)
  const [pronto, setPronto] = useState(false)
  const repetir = useRef<HTMLButtonElement>(null)
  const reduzido = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const cena = cenas[i] ?? cenas[0]
  useEffect(() => setPronto(false), [i, vez])
  const info = INFO_RARIDADE[cena.raridade]
  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      className="pn-folha-tela"
      titulo={
        <>
          {titulo} <SeloRaridade raridade={cena.raridade} />
        </>
      }
      sub={cena.exemplo ? `A loja ainda não tem prêmio ${info.nome}: aqui vai um exemplo. Não conta giro nem cria cupom.` : 'Como a pessoa vê quando o prêmio sai. Não conta giro nem cria cupom.'}
      focoInicial={repetir}
      rodape={
        <div className="pn-teste-pe">
          {cenas.length > 1 && (
            <div className="pn-teste-rars" role="group" aria-label="Raridade da prévia">
              {cenas.map((c, j) => (
                <button key={c.raridade} type="button" className="pn-ficha-rar pn-ficha-rar-botao" style={cores(c.raridade)} aria-pressed={j === i} onClick={() => setI(j)}>
                  <span className="pn-ficha-rar-cara">
                    <i className="pn-rar-bola" aria-hidden="true" />
                    {INFO_RARIDADE[c.raridade].nome}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="pn-teste-botoes">
            <button ref={repetir} type="button" className="pn-botao pn-botao-contorno" onClick={() => setVez((v) => v + 1)}>
              <Ic nome="giro" tamanho={16} />
              <span className="pn-botao-txt">Repetir</span>
            </button>
            <Botao variante="cheio" onClick={aoFechar}>
              Fechar
            </Botao>
          </div>
        </div>
      }
    >
      <div className="pn-teste-palco" data-raridade={cena.raridade} data-pronto={pronto || undefined} style={cores(cena.raridade)}>
        <SemAnimacao key={`${i}-${vez}`}>
          <Suspense fallback={<Carregando rotulo="Abrindo a animação…" />}>
            <Revelacao
              premio={{ destaque: cena.destaque, produto: cena.produto, raridade: cena.raridade }}
              visual={cena.arte ? <ArteProduto produto={cena.arte} largura={150} /> : undefined}
              modo="previa"
              reduzido={reduzido}
              onPronto={() => setPronto(true)}
            />
          </Suspense>
        </SemAnimacao>
      </div>
    </Folha>
  )
}
