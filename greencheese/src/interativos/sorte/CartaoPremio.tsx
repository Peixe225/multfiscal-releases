import { useId, type Ref } from 'react'
import { corDoHalo, ProdutoVisual } from '../../arte/ProdutoVisual'
import { TONS_PAPEL, type Papel } from '../../arte/realista/beck'
import { PadraoFibras } from '../../arte/realista/papel-livreto'
import { Icone } from '../../componentes/comum'
import { config } from '../../dados/config'
import type { ValorPremio } from '../../dados/sorte'
import { copiarTexto } from '../../lib/copiar'
import { formatarValidade } from '../../lib/cupom'
import { fraseDoPremio } from '../../lib/cupom-uso'
import type { Cupom } from '../../store/conta'
import { useUI } from '../../store/ui'
import { regrasSorte } from '../../dados/sorte'
import { Condicoes, listaCondicoes } from './Condicoes'
import { T } from './textos'

// Cartão do prêmio: o papel do beck desenrolado, colado como adesivo (-2°), texto preto, a única cor é o produto.
// O prêmio é o herói: o produto grande (miniatura de story colada no papel, com raios de pixel atrás), o destaque em
// pixel ("15% OFF", "LEVA 4 PAGA 3", "BRINDE"), em que produto, no máximo 1 linha de apoio e o código. Tudo que é
// condição (validade, 1 por pedido, a loja confirma) fica no "Ver condições".
// Sem conta, o código fica sob um mosaico de pixel e nem existe ainda (só nasce quando o prêmio é guardado).
// Comemoração (revelar.ts): confete de pixel saindo de trás do cartão [data-festa] e brilhos no destaque [data-brilho].

export interface DadosCartao {
  titulo: string
  regra: string
  descricao?: string
  comoUsar?: string
  aplicaA: { produtos?: string[]; categorias?: string[] }
  papel: Papel
  demo: boolean
  /** Dias de validade depois de guardar (prêmio ainda sem conta). Guardado, vale a data do cupom. */
  validadeDias?: number
  valor: ValorPremio
}

export interface RefsCartao {
  cartao?: Ref<HTMLDivElement>
  rolo?: Ref<HTMLDivElement>
  pos?: Ref<HTMLDivElement>
}

interface Props {
  dados: DadosCartao
  /** Cupom guardado (mostra o código e a validade). null = ainda sem conta: código mascarado. */
  cupom: Cupom | null
  idTitulo: string
  refs?: RefsCartao
  /** O mosaico ainda cobre o código (dissolve no "GUARDADO"). */
  mosaico?: boolean
  /** Carimbo "GUARDADO" à vista. */
  guardado?: boolean
}

/* ───────────── raios de pixel atrás do produto (impressos no papel) ───────────── */

const RAIOS_W = 64
const RAIOS_H = 46
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** 12 raios numa grade de pixel: cheios perto do produto, a ponta some em Bayer (o pontilhado do resto do site). */
const RAIOS = (() => {
  const cx = RAIOS_W / 2
  const cy = RAIOS_H / 2
  const fatia = (Math.PI * 2) / 24
  let d = ''
  for (let y = 0; y < RAIOS_H; y++) {
    let ini = -1
    for (let x = 0; x <= RAIOS_W; x++) {
      let on = false
      if (x < RAIOS_W) {
        const dx = (x + 0.5 - cx) / cx
        const dy = (y + 0.5 - cy) / cy
        const r = Math.hypot(dx, dy)
        const setor = Math.floor((Math.atan2(dy, dx) + Math.PI + fatia / 2) / fatia)
        const forca = Math.min(1, Math.max(0, (1 - r) * 2.2))
        on = r > 0.12 && setor % 2 === 0 && forca > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16
      }
      if (on && ini < 0) ini = x
      if (!on && ini >= 0) {
        d += `M${ini} ${y}h${x - ini}v1h${ini - x}z`
        ini = -1
      }
    }
  }
  return d
})()

function Raios() {
  return (
    <svg className="cartao-raios" data-raios viewBox={`0 0 ${RAIOS_W} ${RAIOS_H}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path d={RAIOS} fill="currentColor" />
    </svg>
  )
}

/* ───────────── confete (atrás do cartão) e brilhos (no destaque) ───────────── */

interface Pedaco {
  x: number
  y: number
  dx: number
  dy: number
  t: number
  cor: 0 | 1 | 2
}

/** 32 pedaços nas bordas do cartão (escondidos atrás dele), cada um com o rumo pra fora. */
const FESTA: Pedaco[] = (() => {
  let s = 11
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const entre = (a: number, b: number) => a + (b - a) * rnd()
  const lista: Pedaco[] = []
  for (let i = 0; i < 32; i++) {
    const lado = i < 9 ? 'esq' : i < 18 ? 'dir' : i < 25 ? 'cima' : 'baixo'
    const t = rnd() < 0.5 ? 6 : 8
    const cor = (i % 3) as 0 | 1 | 2
    if (lado === 'esq' || lado === 'dir') {
      const s1 = lado === 'esq' ? -1 : 1
      lista.push({ x: lado === 'esq' ? 3 : 97, y: entre(6, 94), dx: s1 * entre(22, 64), dy: entre(-44, 36), t, cor })
    } else if (lado === 'cima') {
      // pra cima só até o vão de 28 px entre o título e o cartão (o confete nunca passa por cima de texto)
      lista.push({ x: entre(8, 92), y: 2, dx: entre(-64, 64), dy: -entre(10, 22), t, cor })
    } else {
      lista.push({ x: entre(8, 92), y: 98, dx: entre(-56, 56), dy: entre(22, 60), t, cor })
    }
  }
  return lista
})()

function Festa({ cor }: { cor: string }) {
  const cores = [cor, '#ffffff', 'var(--papel-claro)']
  return (
    <div className="cartao-festa" data-festa aria-hidden="true">
      {FESTA.map((p, i) => (
        <i
          key={i}
          data-dx={p.dx.toFixed(0)}
          data-dy={p.dy.toFixed(0)}
          style={{ left: `${p.x.toFixed(1)}%`, top: `${p.y.toFixed(1)}%`, width: p.t, height: p.t, margin: -p.t / 2, background: cores[p.cor] }}
        />
      ))}
    </div>
  )
}

/** Brilho de 4 pontas em pixel (7×7). `fixo` = impresso no papel (fora da comemoração). */
function Brilho({ className, fixo = false }: { className: string; fixo?: boolean }) {
  return (
    <svg className={`${fixo ? '' : 'cartao-brilho '}${className}`} data-brilho={fixo ? undefined : ''} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path d="M3 0h1v2h1v1h2v1h-2v1h-1v2h-1v-2h-1v-1h-2v-1h2v-1h1z" fill="currentColor" />
    </svg>
  )
}

/* ───────────── cartão ───────────── */

export function CartaoPremio({ dados, cupom, idTitulo, refs, mosaico, guardado }: Props) {
  const fib = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const tons = TONS_PAPEL[dados.papel]
  const { destaque, alvo, produto } = fraseDoPremio({ titulo: dados.titulo, aplicaA: dados.aplicaA, ...dados.valor })
  const exemplo = dados.demo && config.carimboDeExemplo
  const abrirPagina = useUI((s) => s.abrirPagina)
  const avisar = useUI((s) => s.avisar)
  const codigo = cupom?.codigo ?? null
  const cobrir = !codigo || mosaico
  const [r, g, b] = produto ? corDoHalo(produto.cor, false) : [255, 255, 255]
  const papelVars = { ['--papel' as string]: tons.base, ['--papel-claro' as string]: tons.claro, ['--papel-escuro' as string]: tons.escuro }
  const validade = cupom ? T.condValidadeGuardado(formatarValidade(cupom.validoAte)) : dados.validadeDias != null ? T.condValidadeSemConta(dados.validadeDias) : null
  return (
    <div ref={refs?.pos} className="cartao-pos" style={papelVars}>
      <Festa cor={`rgb(${r} ${g} ${b})`} />
      <div ref={refs?.cartao} className={`cartao-premio cartao-${dados.papel}`}>
        <svg className="cartao-fibras" aria-hidden="true" focusable="false" width="100%" height="100%">
          <defs>
            <PadraoFibras id={`${fib}-f`} escura="#6b5636" clara="#ffffff" forca={tons.fibra * 0.9} finas={tons.finas} />
          </defs>
          <rect width="100%" height="100%" fill={`url(#${fib}-f)`} />
        </svg>
        <p className="cartao-cola px px-16" aria-hidden="true">
          {T.faixaCartao}
        </p>
        <div className="cartao-corpo">
          {exemplo && (
            <span className="cartao-exemplo carimbo" data-carimbo>
              {T.exemplo}
            </span>
          )}
          {guardado && (
            <span className="cartao-guardado px" data-guardado aria-hidden="true">
              {T.guardado}
            </span>
          )}
          <p className="cartao-deu px px-16" data-linha>
            <Brilho className="cartao-deu-brilho" fixo />
            {T.deuSorte}
            <Brilho className="cartao-deu-brilho" fixo />
          </p>
          {produto && (
            <div className="cartao-vitrine">
              <Raios />
              <span className="cartao-foto" data-foto>
                <ProdutoVisual produto={produto} largura={88} revelar={false} rotulo={null} />
              </span>
            </div>
          )}
          <h3 id={idTitulo} className="cartao-titulo" tabIndex={-1}>
            <span className="cartao-valor px" data-linha data-valor>
              {destaque}
              <Brilho className="cartao-brilho-1" />
              <Brilho className="cartao-brilho-2" />
              <Brilho className="cartao-brilho-3" />
            </span>
            <span className="sr-only">: </span>
            <span className="cartao-alvo" data-linha>
              {alvo}
            </span>
          </h3>
          {dados.descricao && (
            <p className="cartao-apoio" data-linha>
              {dados.descricao}
            </p>
          )}
          <div className="cartao-pe" data-linha>
            <div className="cartao-codigo" data-codigo>
              <span className="cartao-codigo-caixa">
                <span className="cartao-codigo-rot">{T.codigo}</span>
                {cobrir ? (
                  <span className="cartao-codigo-valor px px-24" role="img" aria-label={codigo ? codigo : T.codigoMascarado}>
                    <span aria-hidden="true">{regrasSorte.prefixo}-</span>
                    <span className="cartao-mosaico" data-mosaico aria-hidden="true">
                      {codigo && <span className="cartao-mosaico-por-baixo">{codigo.slice(regrasSorte.prefixo.length + 1)}</span>}
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    {!codigo && <Icone nome="cadeado" tamanho={16} className="cartao-cadeado" />}
                  </span>
                ) : (
                  <span className="cartao-codigo-valor px px-24" data-letras>
                    {codigo.split('').map((ch, i) => (
                      <span key={i}>{ch}</span>
                    ))}
                  </span>
                )}
              </span>
              {codigo && (
                <button
                  type="button"
                  className="cartao-copiar toque"
                  onClick={() => avisar(copiarTexto(codigo) ? T.copiado : T.naoCopiou)}
                  aria-label={`${T.copiar} o código ${codigo}`}
                >
                  <Icone nome="copiar" tamanho={16} />
                  {T.copiar}
                </button>
              )}
            </div>
            <Condicoes
              className="cartao-cond"
              itens={listaCondicoes({ regra: dados.regra, comoUsar: dados.comoUsar, validade })}
              lado={
                produto && (
                  <button type="button" className="cartao-ver toque" onClick={() => abrirPagina(produto.id, 'link')}>
                    {T.verProduto}
                  </button>
                )
              }
            />
          </div>
        </div>
      </div>
      <div ref={refs?.rolo} className={`cartao-rolo cartao-${dados.papel}`} aria-hidden="true" />
    </div>
  )
}

/** Faixa compacta de papel no lugar do cartão, durante o cadastro. */
export function FaixaPremio({ titulo, papel }: { titulo: string; papel: Papel }) {
  const tons = TONS_PAPEL[papel]
  return (
    <p className="faixa-premio" style={{ background: tons.base }}>
      <Icone nome="dichavador" tamanho={16} />
      <span>{T.faixaPremio(titulo)}</span>
    </p>
  )
}
