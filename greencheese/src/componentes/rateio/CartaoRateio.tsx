import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react'
import { PixelArte } from '../../arte/PixelArte'
import { iconesAbas } from '../../arte/pixel/abas'
import { ProdutoVisual } from '../../arte/ProdutoVisual'
import { canalDa } from '../../dados/canais'
import { config } from '../../dados/config'
import { brl } from '../../lib/formato'
import type { Rateio } from '../../lib/rateio-api'
import type { Produto } from '../../lib/tipos'
import { produtoPorId } from '../../store/catalogo'
import { agoraRateio } from '../../store/rateio'
import { useLojaMarca } from '../../store/loja'
import { Avatar, Icone } from '../comum'
import { ETAPA, SELO, economia, janelaChegada, listaUfs, prazoAcabou, textoPrazo, textoPrevisao, vagasTexto } from './util'

// O cartão do rateio: um post do perfil da loja. Em cima, o cabeçalho do post (avatar, @ e os estados onde vale, no
// lugar da localização). A mídia é um story: as barrinhas do topo são a linha do tempo do rateio (a 1ª enche com as
// vagas pagas), o selo do status, o produto flutuando no preto, o preço do rateio em pixel, o adesivo de controle
// deslizante com o contador (um bloco por vaga) e o adesivo "Adicione o seu", que é a entrada. Embaixo, a legenda.

/** Produto do catálogo (com a imagem do painel por cima) ou um produto só de imagem; sem nenhum dos dois, null. */
function produtoDoRateio(r: Rateio): Produto | null {
  const p = r.produtoId ? produtoPorId(r.produtoId) : undefined
  if (p) return r.imagem ? { ...p, foto: r.imagem } : p
  if (!r.imagem) return null
  return {
    id: `rateio-${r.id}`,
    nome: r.titulo,
    categoria: 'acessorios',
    preco: null,
    disponivel: { rj: true, mg: true, sp: true, es: true, sc: true },
    demo: r.demo,
    foto: r.imagem,
    cor: '#a8a8a8',
    arte: { tipo: 'dichavador', corpo: '#636363' },
  }
}

/** A arte do rateio: a mesma do produto (ilustração ou foto, com o halo), ou a caixa de importação em pixel. */
export function ArteRateio({ rateio, largura, apagado = false, prioridade = false }: { rateio: Rateio; largura: number; apagado?: boolean; prioridade?: boolean }) {
  const p = produtoDoRateio(rateio)
  if (!p) {
    return (
      <span className="rt-caixa">
        <PixelArte grade={iconesAbas.caixa} tamanho={96} />
      </span>
    )
  }
  return <ProdutoVisual produto={p} largura={largura} indisponivel={apagado} revelar={!rateio.imagem} prioridade={prioridade} rotulo={null} />
}

/** Barrinhas do story = linha do tempo: lotar, pedido feito, a caminho, chegou. A 1ª enche com as vagas pagas. */
function Barras({ rateio }: { rateio: Rateio }) {
  const etapa = ETAPA[rateio.status]
  const cheia = (i: number) => (i === 0 ? (etapa >= 1 ? 1 : rateio.confirmadas / rateio.vagas) : etapa >= i + 1 ? 1 : 0)
  return (
    <div className="rt-barras" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="rt-barra">
          <i style={{ '--p': cheia(i) } as CSSProperties} />
        </span>
      ))}
    </div>
  )
}

/**
 * Quantos dos n degraus acendem pra `k` de `total` vagas. Com um bloco por vaga (n = total), a conta é exata. Com mais
 * de 30 vagas, arredonda pra baixo, mas nunca mente nos extremos: 1 vaga já acende 1 degrau e, enquanto falta vaga, o
 * último fica apagado (99/100 não parece lotado).
 */
export function degraus(k: number, total: number, n: number): number {
  if (k <= 0) return 0
  if (k >= total) return n
  if (n >= total) return k
  return Math.min(n - 1, Math.max(1, Math.floor((k / total) * n)))
}

/**
 * Adesivo de controle deslizante: "8/10 vagas", um bloco por vaga (cheio = paga, xadrez = reservada, vazio = livre) e
 * "+2 reservadas" ao lado. Com mais de 30 vagas, a barra vira 30 degraus.
 */
export function Contador({ rateio }: { rateio: Rateio }) {
  const { vagas, confirmadas, reservadas } = rateio
  const n = Math.min(vagas, 30)
  const pagos = degraus(confirmadas, vagas, n)
  // as reservadas acendem pelo menos 1 degrau, sem passar do que sobra
  const ocupados = Math.max(degraus(confirmadas + reservadas, vagas, n), reservadas > 0 ? Math.min(n, pagos + 1) : pagos)
  const guardados = Math.max(0, ocupados - pagos)
  const lotou = confirmadas >= vagas
  return (
    <div className="rt-contador" style={{ '--n': n } as CSSProperties}>
      <p className="rt-contador-topo">
        <span className="rt-contador-num px" aria-hidden="true">
          {confirmadas}/{vagas}
        </span>
        <span className="rt-contador-rot" aria-hidden="true">
          {lotou ? 'vagas · lotou' : 'vagas'}
        </span>
        <span className="sr-only">
          {confirmadas} de {vagas} vagas pagas{lotou ? ', lotou' : ''}
          {reservadas > 0 ? `, mais ${reservadas} ${reservadas === 1 ? 'reservada' : 'reservadas'}` : ''}
        </span>
        {reservadas > 0 && (
          <span className="rt-contador-res" aria-hidden="true">
            +{reservadas} {reservadas === 1 ? 'reservada' : 'reservadas'}
          </span>
        )}
      </p>
      <span className="rt-blocos" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className={i < pagos ? 'rt-pago' : i < pagos + guardados ? 'rt-guardado' : undefined} style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
    </div>
  )
}

interface PropsEntrada {
  rateio: Rateio
  /** Link da página do rateio (lista) ou ação (na página: desce até o formulário). */
  href?: string
  aoTocar?: (e: MouseEvent<HTMLElement>) => void
  /** Código da vaga deste aparelho, quando já está dentro. */
  codigo?: string | null
}

/** Adesivo "Adicione o seu": a entrada no rateio. Já dentro, vira "Tu tá nesse rateio" com o código. */
function Entrada({ rateio, href, aoTocar, codigo }: PropsEntrada) {
  // a API conta vagas, não pessoas (o dono pode baixar o limite por pessoa depois que alguém pegou mais de uma): o
  // adesivo fala das vagas que sobram, nunca de "N participando"
  const sobra = rateio.disponiveis
  const sub = codigo ? `Código ${codigo}` : sobra === rateio.vagas ? `${sobra} ${sobra === 1 ? 'vaga livre' : 'vagas livres'}` : `${sobra === 1 ? 'sobra' : 'sobram'} ${vagasTexto(sobra)}`
  // com vários cartões, cada entrada diz de qual rateio é (o texto à vista vem junto, no começo)
  const nome = codigo ? `Tu tá nesse rateio, ${rateio.titulo}. ${sub}` : `Entrar no rateio de ${rateio.titulo}. ${sub}`
  const conteudo = (
    <>
      <span className="rt-entrar-icone" aria-hidden="true">
        <PixelArte grade={iconesAbas['caixa-cheia']} tamanho={16} />
      </span>
      <span className="rt-entrar-txt">
        <strong>{codigo ? 'Tu tá nesse rateio' : 'Entrar no rateio'}</strong>
        <small>{sub}</small>
      </span>
      <span className="rt-entrar-mais" aria-hidden="true">
        <Icone nome={codigo ? 'check' : 'mais'} tamanho={16} />
      </span>
    </>
  )
  if (href) {
    return (
      <a className="rt-entrar toque" href={href} onClick={aoTocar} aria-label={nome}>
        {conteudo}
      </a>
    )
  }
  return (
    <button type="button" className="rt-entrar toque" onClick={aoTocar} aria-label={nome}>
      {conteudo}
    </button>
  )
}

/** Linha do tempo do rateio em andamento, em texto (as barrinhas da mídia são o mesmo, em desenho). */
function LinhaDoTempo({ rateio }: { rateio: Rateio }) {
  const etapa = ETAPA[rateio.status]
  const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(Date.parse(iso)) : null)
  const passos: { nome: string; feito: boolean; quando: string | null }[] = [
    { nome: 'Fechou', feito: etapa >= 1, quando: dia(rateio.fechadoEm) },
    { nome: 'Pedido feito', feito: etapa >= 2, quando: dia(rateio.pedidoEm) },
    { nome: 'A caminho', feito: etapa >= 3, quando: null },
    { nome: 'Chegou', feito: etapa >= 4, quando: dia(rateio.chegouEm) },
  ]
  const atual = Math.min(etapa, 4) - 1
  return (
    <ol className="rt-linha">
      {passos.map((p, i) => (
        <li key={p.nome} className={`${p.feito ? 'feito' : ''}${i === atual ? ' atual' : ''}`} aria-current={i === atual ? 'step' : undefined}>
          <span className="rt-linha-ponto" aria-hidden="true" />
          <span className="rt-linha-nome">{p.nome}</span>
          {p.quando && <span className="rt-linha-dia">{p.quando}</span>}
          {!p.feito && <span className="sr-only"> (ainda não)</span>}
        </li>
      ))}
    </ol>
  )
}

interface Props {
  rateio: Rateio
  /** Estado de quem vê (null = ainda não escolheu). */
  uf: string | null
  /** 'feed': o post na aba (com cabeçalho e legenda); 'pagina': a mídia grande da página do rateio. */
  variante?: 'feed' | 'pagina'
  /** Link da página (feed) ou ação da entrada (página). */
  hrefEntrar?: string
  aoEntrar?: (e: MouseEvent<HTMLElement>) => void
  /** Código da vaga ativa deste aparelho nesse rateio. */
  codigo?: string | null
  /** Arte com prioridade (primeiro cartão da tela, página). */
  prioridade?: boolean
  /** Algo a mais embaixo da legenda. */
  children?: ReactNode
  /** Página: o título é o h2 do diálogo e recebe o foco ao abrir. */
  tituloId?: string
  tituloRef?: RefObject<HTMLHeadingElement | null>
}

export function CartaoRateio({ rateio: r, uf, variante = 'feed', hrefEntrar, aoEntrar, codigo, prioridade = false, children, tituloId, tituloRef }: Props) {
  // o canal e o produto do rateio vêm da loja: redesenha quando ela troca
  useLojaMarca()
  const foraDoEstado = !!uf && !r.ufs.includes(uf)
  const aberto = r.status === 'aberto'
  const apagado = foraDoEstado && aberto
  const eco = economia(r)
  const canal = canalDa(uf)
  const idTitulo = tituloId ?? `rt-${variante}-${r.id}`
  const Titulo = variante === 'pagina' ? 'h2' : 'h3'
  const produto = r.produtoId ? produtoPorId(r.produtoId) : undefined
  const janela = janelaChegada(r)
  const exemplo = r.demo && config.carimboDeExemplo
  const agora = agoraRateio()
  // aberto com o prazo vencido: nada de "ABERTO" piscando nem "Fecha dia X" no futuro
  const prazo = prazoAcabou(r, agora)
  const podeEntrar = aberto && !foraDoEstado && r.aceitaEntradas && !prazo
  return (
    <article className={`rt rt-${variante}${apagado ? ' rt-off' : ''}${aberto ? '' : ' rt-andamento'}`} aria-labelledby={idTitulo} data-rateio={r.id}>
      {variante === 'feed' && (
        <header className="rt-cab">
          <Avatar tamanho={32} />
          <p className="rt-cab-txt">
            <span className="rt-cab-nome">{canal?.instagram ?? 'Green Cheese Imports'}</span>
            <span className="rt-cab-sub">Rateio · vale pra {listaUfs(r.ufs)}</span>
          </p>
        </header>
      )}
      <div className="rt-midia" style={{ '--brilho': produto?.cor ?? '#a8a8a8' } as CSSProperties}>
        <Barras rateio={r} />
        <span className={`rt-selo px rt-selo-${prazo ? 'prazo' : r.status}`}>{prazo ? 'TEMPO ACABOU' : SELO[r.status]}</span>
        {exemplo && <span className="rt-exemplo carimbo">exemplo</span>}
        <div className={`rt-arte${apagado ? '' : ' rt-flutua'}`}>
          <ArteRateio rateio={r} largura={variante === 'pagina' ? 120 : 96} apagado={apagado} prioridade={prioridade} />
        </div>
        <div className="rt-info">
          <Titulo ref={tituloRef} id={idTitulo} className="rt-titulo px" tabIndex={variante === 'pagina' ? -1 : undefined}>
            {r.titulo}
          </Titulo>
          <p className="rt-preco">
            <span className="rt-preco-valor px">{brl(r.precoRateio)}</span>
            <span className="rt-preco-no px">no rateio</span>
          </p>
          {r.precoDepois != null && eco != null && (
            <p className="rt-depois">
              <span>{brl(r.precoDepois)} quando chegar</span>
              <span className="rt-economia">economiza {brl(eco)}</span>
            </p>
          )}
        </div>
        <div className="rt-adesivos">
          <Contador rateio={r} />
          {/* já dentro, o "Tu tá nesse rateio" fica mesmo quando não dá mais pra entrar (vagas tomadas, prazo) */}
          {(podeEntrar || (aberto && !foraDoEstado && !!codigo)) && (hrefEntrar || aoEntrar) && <Entrada rateio={r} href={hrefEntrar} aoTocar={aoEntrar} codigo={codigo} />}
          {aberto && !foraDoEstado && !podeEntrar && !codigo && <p className="rt-aviso-adesivo">{prazo ? 'O prazo pra entrar acabou' : 'Vagas tomadas: esperando os pagamentos'}</p>}
          {apagado && <p className="rt-aviso-adesivo">Só pra {listaUfs(r.ufs)}</p>}
        </div>
      </div>
      {variante === 'feed' && (
        <div className="rt-legenda">
          {aberto ? (
            <p>
              <strong>{textoPrevisao(r)}</strong> {textoPrazo(r, agora)}
              {foraDoEstado ? '' : ` Vale pra ${listaUfs(r.ufs)}.`}
            </p>
          ) : (
            <>
              <LinhaDoTempo rateio={r} />
              <p>
                {r.status === 'encerrado' ? 'Entregue a todos.' : r.status === 'chegou' ? 'Chegou. A loja chama cada um pra entregar.' : `${textoPrevisao(r)}${janela ? ` Previsão: ${janela}.` : ''}`}
              </p>
            </>
          )}
          {children}
        </div>
      )}
    </article>
  )
}
