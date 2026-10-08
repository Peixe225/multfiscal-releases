import type { Ref } from 'react'
import { corDoHalo, ProdutoVisual } from '../../arte/ProdutoVisual'
import { Avatar, tempoRelativo } from '../../componentes/comum'
import { config } from '../../dados/config'
import type { ValorPremio } from '../../dados/sorte'
import { formatarValidade } from '../../lib/cupom'
import { fraseDoPremio } from '../../lib/cupom-uso'
import type { Cupom } from '../../store/conta'
import { useUI } from '../../store/ui'
import { AdesivoCodigo, AdesivoContagem, BolhaPremio, Brilho, SeloAmigos, VERDE_AMIGOS } from './Adesivos'
import { Condicoes, listaCondicoes } from './Condicoes'
import { T } from './textos'

// O prêmio é um story dos Melhores amigos, só pra pessoa: o conceito do site (o Instagram da loja) levado ao prêmio.
// Quadro 9:16 preto (o mesmo preto da câmara do dichavador, ver revelar.ts), barrinha de 1 segmento, cabeçalho com o
// anel verde e o selo "Melhores amigos", o produto flutuando com o brilho da cor dele, "DEU SORTE!" como adesivo de
// texto, o destaque grande em pixel, o produto e 1 linha de apoio. Dois adesivos lado a lado: o do código (como o de
// link; trancado até guardar) e o da contagem da validade. As condições ficam no "Ver condições", que abre por cima.
// O tamanho do quadro vem de fora (--sw, --sh: JogoSorte mede a tela); dentro, tudo acompanha a largura (cqi).

export interface DadosPremio {
  titulo: string
  regra: string
  descricao?: string
  comoUsar?: string
  aplicaA: { produtos?: string[]; categorias?: string[] }
  demo: boolean
  /** Dias de validade depois de guardar (prêmio ainda sem conta). Guardado, vale a data do cupom. */
  validadeDias?: number
  valor: ValorPremio
}

export interface RefsStory {
  quadro?: Ref<HTMLDivElement>
  /** Canvas do chiado que cobre o story e sintoniza (revelar.ts). */
  cobertura?: Ref<HTMLCanvasElement>
  progresso?: Ref<HTMLElement>
}

/** Produto: ainda não (antes do corte), sintonizando agora (revelação) ou pronto (sem animação). */
export type Sintonia = 'antes' | 'agora' | 'pronto'

interface Props {
  dados: DadosPremio
  /** Cupom guardado (código e validade). null = ainda sem conta: o adesivo do código fica trancado. */
  cupom: Cupom | null
  idTitulo: string
  instagram: string | null
  sintonia: Sintonia
  agora: number
  /** Quando o story "foi postado" (sorteio do prêmio reservado). Sem isto: agora. */
  postadoEm?: number | null
  /** Sem conta: até quando o prêmio fica reservado neste aparelho (vai no "Ver condições"). */
  reserva?: string | null
  /** Tocar no adesivo trancado (leva pra guardar). */
  aoGuardar?: () => void
  /** Revelação: nada no story responde ao toque. */
  inerte?: boolean
  refs?: RefsStory
}

/* ───────────── confete (atrás do produto) ───────────── */

interface Pedaco {
  dx: number
  dy: number
  t: number
  cor: 0 | 1 | 2
}

/**
 * 16 pedaços escondidos atrás do produto. O rumo (dx, dy) é uma fração do espaço da vitrine que revelar.ts mede na
 * hora: estoura pros lados e pra cima (nunca pra baixo, onde vem o destaque) e cai de volta atrás do produto.
 */
const FESTA: Pedaco[] = (() => {
  let s = 7
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const lista: Pedaco[] = []
  for (let i = 0; i < 16; i++) {
    const lado = i % 2 ? 1 : -1
    lista.push({ dx: lado * (0.35 + rnd() * 0.65), dy: -(0.15 + rnd() * 0.85), t: rnd() < 0.5 ? 6 : 8, cor: (i % 3) as 0 | 1 | 2 })
  }
  return lista
})()

function Festa({ cor }: { cor: string }) {
  const cores = [cor, '#ffffff', '#a8a8a8']
  return (
    <div className="sp-festa" data-festa aria-hidden="true">
      {FESTA.map((p, i) => (
        <i key={i} data-dx={p.dx.toFixed(2)} data-dy={p.dy.toFixed(2)} style={{ width: p.t, height: p.t, margin: -p.t / 2, background: cores[p.cor] }} />
      ))}
    </div>
  )
}

/* ───────────── story ───────────── */

export function StoryPremio({ dados, cupom, idTitulo, instagram, sintonia, agora, postadoEm, reserva, aoGuardar, inerte, refs }: Props) {
  const { destaque, alvo, produto } = fraseDoPremio({ titulo: dados.titulo, aplicaA: dados.aplicaA, ...dados.valor })
  const abrirPagina = useUI((s) => s.abrirPagina)
  const exemplo = dados.demo && config.carimboDeExemplo
  const codigo = cupom?.codigo ?? null
  const [r, g, b] = produto ? corDoHalo(produto.cor, false) : [255, 255, 255]
  const validade = cupom ? T.condValidadeGuardado(formatarValidade(cupom.validoAte)) : dados.validadeDias != null ? T.condValidadeSemConta(dados.validadeDias) : null
  const tempo = postadoEm ? tempoRelativo(new Date(postadoEm).toISOString(), agora) : T.agora
  return (
    <div ref={refs?.quadro} className="story-premio" inert={inerte} data-toca={sintonia === 'antes' ? undefined : ''}>
      <div className="sp-progresso" aria-hidden="true">
        <i ref={refs?.progresso} />
      </div>
      <div className="sp-cab">
        <Avatar tamanho={32} cor={VERDE_AMIGOS} />
        <div className="sp-cab-txt">
          <p className="sp-cab-linha">
            <span className="sp-nome">{instagram ?? 'greencheese_imports'}</span>
            <span className="sp-tempo">{tempo}</span>
          </p>
          <SeloAmigos />
        </div>
        {exemplo && <span className="carimbo sp-exemplo">{T.exemplo}</span>}
      </div>

      <div className="sp-corpo">
        <div className="sp-vitrine">
          <Festa cor={`rgb(${r} ${g} ${b})`} />
          <div className="sp-produto" data-produto>
            {produto && sintonia !== 'antes' && <ProdutoVisual key={sintonia} produto={produto} largura={108} revelar={sintonia === 'agora' ? 'sempre' : false} prioridade rotulo={null} />}
            {!produto && <BolhaPremio produto={null} tamanho={72} />}
          </div>
          <p className="sp-deu px" data-deu aria-hidden="true">
            {T.deuSorte}
          </p>
        </div>

        <h3 id={idTitulo} className="sp-titulo" tabIndex={-1}>
          <span className="sr-only">{T.deuSorte} </span>
          <span className="sp-valor px" data-valor>
            {destaque}
            <Brilho className="sp-brilho-1" />
            <Brilho className="sp-brilho-2" />
            <Brilho className="sp-brilho-3" />
          </span>
          <span className="sr-only">: </span>
          <span className="sp-alvo" data-alvo>
            {alvo}
          </span>
        </h3>
        {dados.descricao && (
          <p className="sp-apoio" data-apoio>
            {dados.descricao}
          </p>
        )}

        <div className="sp-adesivos">
          <AdesivoCodigo codigo={codigo} aoTrancado={aoGuardar} />
          <AdesivoContagem validoAte={cupom?.validoAte ?? null} dias={dados.validadeDias} agora={agora} />
        </div>

        <div className="sp-pe" data-cond>
          <Condicoes
            sobre
            className="sp-cond"
            itens={listaCondicoes({ regra: dados.regra, comoUsar: dados.comoUsar, validade, reserva: cupom ? null : reserva })}
            lado={
              produto && (
                <button type="button" className="sp-ver toque" onClick={() => abrirPagina(produto.id, 'link')}>
                  {T.verProduto}
                </button>
              )
            }
          />
        </div>
      </div>
      <canvas ref={refs?.cobertura} className="sp-cobertura" width={1} height={1} aria-hidden="true" />
    </div>
  )
}

/** Durante o cadastro: o prêmio numa linha, com a bolinha de story dos Melhores amigos (o mesmo nome do story). */
export function FaixaPremio({ nome, produto }: { nome: string; produto: Parameters<typeof BolhaPremio>[0]['produto'] }) {
  return (
    <div className="faixa-premio">
      <BolhaPremio produto={produto} tamanho={40} />
      <p>{T.faixaPremio(nome)}</p>
    </div>
  )
}
