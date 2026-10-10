// Estúdio da foto (painel → Produto): a foto que o dono tirou vira a foto no estilo do site. Abre sozinho quando ele
// escolhe a foto (e no "Ajustar a foto" de uma já salva): tira o fundo liso, acha o produto e centraliza no 9:16 com as
// margens das ilustrações, ajusta a cor e mostra antes e depois como o site mostra (no preto, com o halo da cor do
// produto e a sintonia), no tamanho do story e do card. Mexe: tirar o fundo (liga/desliga), quanto apagar, tocar pra
// apagar ou devolver um pedaço, girar, tamanho e posição (arrastar, pinça ou botões). Fundo bagunçado: avisa e mantém
// o fundo (só enquadra e escurece as bordas). Tudo no aparelho; o que sobe é a foto pronta (WebP, ou PNG no Safari
// antigo), com a transparência.
import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoPonteiro } from 'react'
import { corDominante } from '../../arte/produtos/dither'
import { Folha } from '../Folha'
import { brl } from '../formato'
import { Aviso, Botao, Ic, Pontinhos } from '../ui'
import { ajusteDeCor, analisar, fundoLiso, girarAjustes, recortar, SEM_AJUSTE, toleranciaPara, varinha, type Analise, type Recorte } from './recorte'
import { abrirImagem, contexto, exportar, girar90, novoCanvas, quadroAutomatico, reduzir, renderizar, renderizarOriginal, SAIDA, transformar, type Quadro } from './render'
import { Vitrine } from './Vitrine'
import { usarCssDoEstudio } from './estilo'

export interface FotoPronta {
  blob: Blob
  nome: string
  /** A cor do produto tirada da foto tratada (vai pro halo do site). */
  cor: string | null
}

interface Props {
  /** A foto escolhida (ou a salva, baixada pro "Ajustar a foto"). */
  arquivo: Blob
  nome: string
  preco: number | null
  /** A cor do produto agora (o halo, até a foto nova dizer outra). */
  cor: string
  /** Sobe a foto pronta e põe no produto. */
  aoUsar: (f: FotoPronta, andou: (fracao: number) => void) => Promise<void>
  /** Sobe a original como veio (null no "Ajustar": a original é a que já está salva). */
  aoUsarOriginal: ((andou: (fracao: number) => void) => Promise<void>) | null
  aoFechar: () => void
}

/** Lado maior da foto pra trabalhar (a final sai em 720×1280) e da cópia pequena que decide o recorte. */
const LADO_FONTE = 2000
const LADO_ANALISE = 480
/** A prévia enquanto mexe (o final é feito só no "Usar assim"). */
const PREVIA = { w: 360, h: 640 }

type Toque = 'mexer' | 'apagar' | 'devolver'

interface Base {
  fonte: HTMLCanvasElement
  trab: HTMLCanvasElement
  an: Analise
}

function analisarCanvas(c: HTMLCanvasElement): Analise {
  return analisar({ w: c.width, h: c.height, d: contexto(c).getImageData(0, 0, c.width, c.height).data })
}

/** Respira um quadro (a tela anda entre um passo pesado e outro). */
const respirar = () => new Promise<void>((ok) => requestAnimationFrame(() => setTimeout(ok, 0)))

export function EstudioFoto({ arquivo, nome, preco, cor, aoUsar, aoUsarOriginal, aoFechar }: Props) {
  usarCssDoEstudio()
  const [base, setBase] = useState<Base | null>(null)
  const [falhou, setFalhou] = useState<string | null>(null)
  const [tirarFundo, setTirarFundo] = useState(true)
  const [quanto, setQuanto] = useState(50)
  const [ajustes, setAjustes] = useState<{ m: Int8Array; v: number } | null>(null)
  const desfazer = useRef<Int8Array[]>([])
  const [toque, setToque] = useState<Toque>('mexer')
  const [quadro, setQuadro] = useState<Quadro | null>(null)
  const [corNoEstilo, setCorNoEstilo] = useState(true)
  const [vista, setVista] = useState<'antes' | 'depois'>('depois')
  const [sintonia, setSintonia] = useState(0)
  const [subindo, setSubindo] = useState<{ qual: 'pronta' | 'original'; fracao: number } | null>(null)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [quantoDigitado, setQuantoDigitado] = useState(50)
  const real = useRef<HTMLCanvasElement>(null)
  const realCard = useRef<HTMLCanvasElement>(null)
  const previa = useRef<HTMLCanvasElement | null>(null)
  const [versao, setVersao] = useState(0)

  // abre a foto: a cópia de trabalhar (até 2000 px) e a pequena que decide (até 480 px)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const im = await abrirImagem(arquivo)
        await respirar()
        const fonte = reduzir(im.img, im.w, im.h, LADO_FONTE)
        im.soltar()
        const trab = reduzir(fonte, fonte.width, fonte.height, LADO_ANALISE)
        await respirar()
        const an = analisarCanvas(trab)
        if (!vivo) return
        const rec = recortar(an, an.tolerancia, null)
        const recortavel = fundoLiso(an) && rec.area > 0.015 && rec.area < 0.92
        setTirarFundo(recortavel)
        setCorNoEstilo(!an.recortada)
        setAjustes({ m: new Int8Array(an.w * an.h), v: 0 })
        setBase({ fonte, trab, an })
      } catch {
        if (vivo) setFalhou('Não deu pra abrir essa foto. Tenta outra (JPG, PNG ou WebP).')
      }
    })()
    return () => {
      vivo = false
    }
  }, [arquivo])

  const tol = base ? toleranciaPara(base.an, quanto) : 0
  // o recorte (resolução da análise): muda com o "quanto", a varinha e o girar
  const rec: Recorte | null = useMemo(() => (base && ajustes ? recortar(base.an, tol, ajustes.m) : null), [base, tol, ajustes])
  const k = base ? base.trab.width / base.fonte.width : 1
  const caixaFonte = rec?.caixa ? { x0: rec.caixa.x0 / k, y0: rec.caixa.y0 / k, x1: rec.caixa.x1 / k, y1: rec.caixa.y1 / k } : null
  const usaRecorte = tirarFundo && !!rec && rec.area > 0.002
  const ajusteCor = useMemo(() => (base && corNoEstilo ? ajusteDeCor(base.an, usaRecorte && rec ? rec.fundo : null) : SEM_AJUSTE), [base, corNoEstilo, usaRecorte, rec])

  // enquadramento automático quando abre (e no "Centralizar"/girar); com o fundo mantido, a foto inteira
  const [quadroAuto, setQuadroAuto] = useState(0)
  useEffect(() => {
    if (!base || !rec) return
    setQuadro(quadroAutomatico(base.fonte.width, base.fonte.height, tirarFundo ? caixaFonte : null))
    // só quando pedem um quadro novo (abrir, girar, Centralizar, ligar/desligar o fundo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, quadroAuto, tirarFundo])

  // a prévia (360×640): refeita quando algo muda, no quadro seguinte (sem travar o toque)
  useEffect(() => {
    if (!base || !rec || !quadro) return
    const id = requestAnimationFrame(() => {
      const c = previa.current ?? novoCanvas(PREVIA.w, PREVIA.h)
      previa.current = c
      const g = contexto(c)
      if (vista === 'antes') {
        g.clearRect(0, 0, c.width, c.height)
        g.drawImage(renderizarOriginal(base.fonte, PREVIA.w, PREVIA.h), 0, 0)
      } else {
        g.putImageData(renderizar({ fonte: base.fonte, an: base.an, rec: usaRecorte ? rec : null, quadro, cor: ajusteCor, nitidez: 0.25, w: PREVIA.w, h: PREVIA.h }), 0, 0)
      }
      for (const alvo of [real.current, realCard.current]) {
        if (!alvo) continue
        const ag = contexto(alvo)
        ag.clearRect(0, 0, alvo.width, alvo.height)
        ag.imageSmoothingQuality = 'high'
        ag.drawImage(c, 0, 0, alvo.width, alvo.height)
      }
      setVersao((v) => v + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [base, rec, quadro, usaRecorte, ajusteCor, vista])

  // a sintonia toca uma vez quando a foto fica pronta (e no "Ver entrar no site")
  const primeira = useRef(false)
  useEffect(() => {
    if (versao > 0 && !primeira.current) {
      primeira.current = true
      setSintonia(1)
    }
  }, [versao])

  // a cor do produto que a foto tratada sugere (o halo do site)
  const corDaFoto = useMemo(() => {
    if (!previa.current || versao === 0 || vista === 'antes') return null
    const c = novoCanvas(90, 160)
    const g = contexto(c)
    g.drawImage(previa.current, 0, 0, 90, 160)
    try {
      return corDominante(g.getImageData(0, 0, 90, 160))
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao])
  const corHalo = corDaFoto ?? cor

  /* ------------------------------------------------------------ gestos na prévia grande */

  const ponteiros = useRef(new Map<number, { x: number; y: number }>())
  const gesto = useRef<{ x: number; y: number; q: Quadro; dist: number; mexeu: boolean } | null>(null)
  const aoDescer = (e: EventoPonteiro<HTMLDivElement>) => {
    if (!quadro || subindo) return
    e.currentTarget.setPointerCapture(e.pointerId)
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...ponteiros.current.values()]
    gesto.current = { x: pts[0].x, y: pts[0].y, q: quadro, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, mexeu: pts.length > 1 }
  }
  const aoMover = (e: EventoPonteiro<HTMLDivElement>) => {
    const g = gesto.current
    if (!g || !ponteiros.current.has(e.pointerId)) return
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const r = e.currentTarget.getBoundingClientRect()
    const pts = [...ponteiros.current.values()]
    if (pts.length > 1 && g.dist > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      setQuadro({ ...g.q, escala: Math.min(g.q.escala * 8, Math.max(g.q.escala / 8, (g.q.escala * d) / g.dist)) })
      g.mexeu = true
      return
    }
    const dx = pts[0].x - g.x
    const dy = pts[0].y - g.y
    if (!g.mexeu && Math.hypot(dx, dy) < 6) return
    g.mexeu = true
    setQuadro({ ...g.q, dx: g.q.dx + dx / r.width, dy: g.q.dy + dy / r.height })
  }
  const aoSubir = (e: EventoPonteiro<HTMLDivElement>) => {
    const g = gesto.current
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size) return
    gesto.current = null
    if (!g || g.mexeu || toque === 'mexer' || !base || !rec || !quadro || !ajustes || !usaRecorte) return
    // o toque da varinha: do ponto na tela pro pixel da análise
    const r = e.currentTarget.getBoundingClientRect()
    const ox = ((e.clientX - r.left) / r.width) * SAIDA.w
    const oy = ((e.clientY - r.top) / r.height) * SAIDA.h
    const [s, tx, ty] = transformar(quadro, SAIDA.w, SAIDA.h)
    const antes = ajustes.m.slice()
    const m = ajustes.m.slice()
    if (varinha(base.an, rec, ((ox - tx) / s) * k, ((oy - ty) / s) * k, toque, m) > 0) {
      desfazer.current.push(antes)
      if (desfazer.current.length > 12) desfazer.current.shift()
      setAjustes({ m, v: ajustes.v + 1 })
    }
  }

  /* ------------------------------------------------------------ botões */

  const zoom = (f: number) => quadro && setQuadro({ ...quadro, escala: quadro.escala * f })
  const mover = (dx: number, dy: number) => quadro && setQuadro({ ...quadro, dx: quadro.dx + dx, dy: quadro.dy + dy })
  const girar = async () => {
    if (!base || !ajustes) return
    const fonte = girar90(base.fonte)
    const trab = girar90(base.trab)
    await respirar()
    const an = analisarCanvas(trab)
    desfazer.current = []
    setAjustes({ m: girarAjustes(ajustes.m, base.an.w, base.an.h), v: ajustes.v + 1 })
    setBase({ fonte, trab, an })
    setQuadroAuto((n) => n + 1)
  }
  const voltarUm = () => {
    const anterior = desfazer.current.pop()
    if (anterior && ajustes) setAjustes({ m: anterior, v: ajustes.v + 1 })
  }

  const usar = async () => {
    if (!base || !rec || !quadro || subindo) return
    setErroEnvio(null)
    setSubindo({ qual: 'pronta', fracao: 0 })
    try {
      await respirar()
      const final = renderizar({ fonte: base.fonte, an: base.an, rec: usaRecorte ? rec : null, quadro, cor: ajusteCor, nitidez: 0.35, w: SAIDA.w, h: SAIDA.h })
      const c = novoCanvas(SAIDA.w, SAIDA.h)
      contexto(c).putImageData(final, 0, 0)
      const pronta = await exportar(c)
      const p = novoCanvas(90, 160)
      contexto(p).drawImage(c, 0, 0, 90, 160)
      let corFinal: string | null = null
      try {
        corFinal = corDominante(contexto(p).getImageData(0, 0, 90, 160))
      } catch {
        corFinal = null
      }
      await aoUsar({ ...pronta, cor: corFinal }, (f) => setSubindo({ qual: 'pronta', fracao: f }))
    } catch (e) {
      setErroEnvio(e instanceof Error && e.message ? e.message : 'A foto não subiu. Tenta de novo.')
      setSubindo(null)
    }
  }
  const usarOriginal = async () => {
    if (!aoUsarOriginal || subindo) return
    setErroEnvio(null)
    setSubindo({ qual: 'original', fracao: 0 })
    try {
      await aoUsarOriginal((f) => setSubindo({ qual: 'original', fracao: f }))
    } catch (e) {
      setErroEnvio(e instanceof Error && e.message ? e.message : 'A foto não subiu. Tenta de novo.')
      setSubindo(null)
    }
  }

  /* ------------------------------------------------------------ avisos */

  const complexo = !!base && !fundoLiso(base.an)
  const pouco = !!rec && tirarFundo && rec.area <= 0.015
  const nada = !!rec && tirarFundo && rec.area >= 0.92
  let aviso: { texto: string; acao?: { rotulo: string; fazer: () => void } } | null = null
  if (base && rec) {
    if (tirarFundo && pouco) aviso = { texto: 'Quase não sobrou produto: o fundo parece com ele. Diminui o “Quanto do fundo apagar” ou mantém o fundo.', acao: { rotulo: 'Manter o fundo', fazer: () => setTirarFundo(false) } }
    else if (tirarFundo && nada) aviso = { texto: 'Não achei fundo pra tirar nessa foto. Dá pra manter o fundo (só enquadro e escureço as bordas).', acao: { rotulo: 'Manter o fundo', fazer: () => setTirarFundo(false) } }
    else if (tirarFundo && complexo) aviso = { texto: 'O fundo dessa foto tem muita coisa: o recorte pode errar. Se ficar estranho, mantém o fundo.', acao: { rotulo: 'Manter o fundo', fazer: () => setTirarFundo(false) } }
    else if (!tirarFundo && complexo) aviso = { texto: 'O fundo dessa foto tem muita coisa, então mantive o fundo: só enquadrei e escureci as bordas. Recorta melhor numa foto em fundo liso (parede, papel, bancada).' }
  }

  const ocupado = !!subindo
  const larguraGrande = 'min(56vw, 252px)'
  const titulo = 'Estúdio da foto'
  return (
    <Folha
      aberta
      aoFechar={() => !ocupado && aoFechar()}
      titulo={titulo}
      sub="A foto fica no estilo da loja: sem o fundo, no meio, com a cor acertada. Confere e usa."
      larga
      preso={ocupado}
      className="pn-folha-estudio"
      rodape={
        <div className="pn-est-pe">
          {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
          {subindo && (
            <div className="pn-foto-andamento-linha" role="status">
              <Pontinhos rotulo={subindo.fracao > 0 ? 'Subindo a foto…' : 'Preparando a foto…'} />
              <span className="pn-foto-barra" aria-hidden="true">
                <i style={{ transform: `scaleX(${subindo.fracao})` }} />
              </span>
              <span>{subindo.fracao > 0 ? `${Math.round(subindo.fracao * 100)}%` : 'preparando'}</span>
            </div>
          )}
          <Botao largo onClick={() => void usar()} ocupado={subindo?.qual === 'pronta'} disabled={!base || (ocupado && subindo?.qual !== 'pronta')}>
            Usar assim
          </Botao>
          <div className="pn-est-pe-dupla">
            {aoUsarOriginal && (
              <Botao variante="cinza" onClick={() => void usarOriginal()} ocupado={subindo?.qual === 'original'} disabled={ocupado && subindo?.qual !== 'original'}>
                Usar a foto original
              </Botao>
            )}
            <Botao variante="texto" onClick={aoFechar} disabled={ocupado}>
              Cancelar
            </Botao>
          </div>
        </div>
      }
    >
      <div className="pn-est">
        {falhou ? (
          <Aviso tipo="erro">{falhou}</Aviso>
        ) : !base ? (
          <div className="pn-est-abrindo">
            <Pontinhos rotulo="Preparando a foto…" />
            <p>Preparando a foto…</p>
          </div>
        ) : (
          <>
            <div className="pn-filtros pn-est-vista" role="group" aria-label="Ver">
              {(['antes', 'depois'] as const).map((v) => (
                <button key={v} type="button" className={`pn-filtro${vista === v ? ' on' : ''}`} aria-pressed={vista === v} onClick={() => setVista(v)}>
                  {v === 'antes' ? 'Antes' : 'Depois'}
                </button>
              ))}
              <button type="button" className="pn-filtro" onClick={() => setSintonia((n) => n + 1)} disabled={vista === 'antes'}>
                <Ic nome="estrela" tamanho={16} /> Ver entrar no site
              </button>
            </div>
            <div className="pn-est-vitrines">
              <figure className="pn-est-fig">
                <Vitrine
                  largura={252}
                  style={{ width: larguraGrande, height: `calc(${larguraGrande} * 16 / 9)` }}
                  cor={vista === 'antes' ? cor : corHalo}
                  sintonia={vista === 'depois' && previa.current && sintonia ? { vez: sintonia, imagem: previa.current } : null}
                  className={`pn-est-grande pn-est-toque-${toque}`}
                  onPointerDown={aoDescer}
                  onPointerMove={aoMover}
                  onPointerUp={aoSubir}
                  onPointerCancel={aoSubir}
                  role="img"
                  aria-label={vista === 'antes' ? 'Antes: a foto como veio, no site' : 'Depois: a foto tratada, como fica no story'}
                  data-vista={vista}
                >
                  <canvas ref={real} className="pn-est-real" width={PREVIA.w} height={PREVIA.h} />
                </Vitrine>
                <figcaption>No story</figcaption>
              </figure>
              <figure className="pn-est-fig">
                <div className="pn-sq pn-est-card" style={{ width: 'min(30vw, 132px)' }}>
                  <div className="pn-sq-arte">
                    <Vitrine largura={56} cor={vista === 'antes' ? cor : corHalo} sintonia={vista === 'depois' && previa.current && sintonia ? { vez: sintonia, imagem: previa.current } : null} style={{ width: '43%', height: 'auto', aspectRatio: '9 / 16' }}>
                      <canvas ref={realCard} className="pn-est-real" width={180} height={320} />
                    </Vitrine>
                  </div>
                  <div className="pn-sq-texto">
                    <p className="pn-sq-nome px">{nome || 'Nome do produto'}</p>
                    <p className="pn-sq-preco px">{preco == null ? 'Consultar' : brl(preco)}</p>
                    <p className="pn-sq-disp px">DISPONÍVEL ✅</p>
                  </div>
                </div>
                <figcaption>No card</figcaption>
              </figure>
            </div>

            {aviso && (
              <Aviso
                tipo="info"
                acao={
                  aviso.acao && (
                    <button type="button" className="pn-link-botao" onClick={aviso.acao.fazer}>
                      {aviso.acao.rotulo}
                    </button>
                  )
                }
              >
                {aviso.texto}
              </Aviso>
            )}

            <div className="pn-est-controles">
              <label className="pn-troca">
                <input type="checkbox" checked={tirarFundo} onChange={(e) => setTirarFundo(e.target.checked)} />
                <span className="pn-troca-marca" aria-hidden="true" />
                <span>Tirar o fundo</span>
              </label>
              {tirarFundo && (
                <>
                  <div className="pn-est-faixa">
                    <label htmlFor="est-quanto" className="pn-rotulo">
                      Quanto do fundo apagar
                    </label>
                    <div className="pn-est-faixa-linha">
                      <span aria-hidden="true">Menos</span>
                      <input
                        id="est-quanto"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={quantoDigitado}
                        onChange={(e) => setQuantoDigitado(Number(e.target.value))}
                        onPointerUp={() => setQuanto(quantoDigitado)}
                        onKeyUp={() => setQuanto(quantoDigitado)}
                        onBlur={() => setQuanto(quantoDigitado)}
                        aria-valuetext={quantoDigitado === 50 ? 'automático' : quantoDigitado < 50 ? 'menos' : 'mais'}
                      />
                      <span aria-hidden="true">Mais</span>
                    </div>
                  </div>
                  <div className="pn-est-toque">
                    <p className="pn-rotulo">Tocar na foto pra</p>
                    <div className="pn-filtros" role="group" aria-label="Tocar na foto pra">
                      {(
                        [
                          ['mexer', 'Mexer'],
                          ['apagar', 'Apagar'],
                          ['devolver', 'Devolver'],
                        ] as const
                      ).map(([v, r]) => (
                        <button key={v} type="button" className={`pn-filtro${toque === v ? ' on' : ''}`} aria-pressed={toque === v} onClick={() => setToque(v)}>
                          {r}
                        </button>
                      ))}
                      <button type="button" className="pn-filtro" onClick={voltarUm} disabled={!desfazer.current.length}>
                        Desfazer
                      </button>
                    </div>
                    <p className="pn-dica">{toque === 'mexer' ? 'Arrasta pra mudar de lugar; pinça (dois dedos) muda o tamanho.' : toque === 'apagar' ? 'Toca num pedaço de fundo que ficou: ele some.' : 'Toca num pedaço do produto que sumiu: ele volta.'}</p>
                  </div>
                </>
              )}
              <div className="pn-est-ajuste" role="group" aria-label="Tamanho e posição">
                <button type="button" className="pn-botao pn-botao-cinza" onClick={() => void girar()} aria-label="Girar 90 graus">
                  <span className="pn-botao-txt">Girar</span>
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => zoom(1 / 1.08)} aria-label="Menor">
                  <Ic nome="menos" tamanho={16} />
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => zoom(1.08)} aria-label="Maior">
                  <Ic nome="mais" tamanho={16} />
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => mover(-0.02, 0)} aria-label="Pra esquerda">
                  ←
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => mover(0, -0.02)} aria-label="Pra cima">
                  ↑
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => mover(0, 0.02)} aria-label="Pra baixo">
                  ↓
                </button>
                <button type="button" className="icone-botao pn-est-b" onClick={() => mover(0.02, 0)} aria-label="Pra direita">
                  →
                </button>
                <button type="button" className="pn-botao pn-botao-texto" onClick={() => setQuadroAuto((n) => n + 1)}>
                  <span className="pn-botao-txt">Centralizar</span>
                </button>
              </div>
              <label className="pn-troca">
                <input type="checkbox" checked={corNoEstilo} onChange={(e) => setCorNoEstilo(e.target.checked)} />
                <span className="pn-troca-marca" aria-hidden="true" />
                <span>Cor no estilo da loja</span>
              </label>
              {corDaFoto && vista === 'depois' && (
                <p className="pn-dica pn-est-cor">
                  <span className="pn-est-amostra" style={{ background: corDaFoto }} aria-hidden="true" /> O brilho atrás do produto no site vai ficar dessa cor (dá pra trocar em “Desenho”).
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Folha>
  )
}
