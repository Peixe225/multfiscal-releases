// Estúdio do vídeo (painel → Produto → "Thumb animada"): o vídeo curto do celular vira a thumb animada do card no
// site. O dono escolhe o trecho (começo e duração: 3,5 s de padrão, até 6), o painel aplica o mesmo estilo da foto
// (fundo liso recortado com o fundo do 1º quadro, o produto enquadrado pela união dos quadros, a cor) sobre preto e
// regrava no próprio navegador (MP4 com H.264 quando ele grava, senão WebM), com a capa (o 1º quadro tratado). Navegador
// que não regrava (sem MediaRecorder): manda o MP4 original pequeno (até 6 MB e 6 s), que o site só enquadra, e avisa
// que no Chrome fica no estilo da loja. GIF só onde o navegador decodifica (ImageDecoder); fora disso, pede vídeo.
import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoPonteiro } from 'react'
import { corDominante } from '../../arte/produtos/dither'
import { Folha } from '../Folha'
import { brl } from '../formato'
import { Aviso, Botao, Ic, Pontinhos } from '../ui'
import { ajusteDeCor, analisar, fundoLiso, recortar, SEM_AJUSTE, toleranciaPara, type Analise, type Caixa } from './recorte'
import { contexto, novoCanvas, quadroAutomatico, reduzir, type Quadro } from './render'
import { abreGif, abrirGif, abrirVideo, capaDe, capaSimples, gravar, mascaraDoQuadro, Processador, quadroPequeno, SAIDA_VIDEO, tipoDeGravacao, TRECHO_MAXIMO, TRECHO_PADRAO, type FonteVideo, type Tratamento } from './video'
import { Vitrine } from './Vitrine'
import { usarCssDoEstudio } from './estilo'

export interface VideoPronto {
  video: Blob
  nomeVideo: string
  capa: Blob
  nomeCapa: string
}

interface Props {
  arquivo: File
  nome: string
  preco: number | null
  cor: string
  aoUsar: (v: VideoPronto, andou: (fracao: number) => void) => Promise<void>
  aoFechar: () => void
}

/** O original que dá pra mandar sem regravar: MP4 (ou o MOV do iPhone), até 6 MB e 6 s. */
const ORIGINAL_MAXIMO = 6 * 1048576
const ehMp4 = (f: File) => /^video\/(mp4|quicktime|x-m4v)$/.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name)
const respirar = () => new Promise<void>((ok) => requestAnimationFrame(() => setTimeout(ok, 0)))
const segundos = (s: number) => `${s.toFixed(1).replace('.', ',')} s`

type Fase = { qual: 'gravando'; t: number } | { qual: 'subindo'; fracao: number } | null

export function EstudioVideo({ arquivo, nome, preco, cor, aoUsar, aoFechar }: Props) {
  usarCssDoEstudio()
  const [fonte, setFonte] = useState<FonteVideo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const tipo = useMemo(() => tipoDeGravacao(), [])
  const [proc, setProc] = useState<Processador | null>(null)
  const [semEstilo, setSemEstilo] = useState(false)
  const [ini, setIni] = useState(0)
  const [dur, setDur] = useState(TRECHO_PADRAO)
  const [base, setBase] = useState<Analise | null>(null)
  const [tirarFundo, setTirarFundo] = useState(true)
  const [quanto, setQuanto] = useState(50)
  const [quantoDigitado, setQuantoDigitado] = useState(50)
  const [corNoEstilo, setCorNoEstilo] = useState(true)
  const [quadro, setQuadro] = useState<Quadro | null>(null)
  // a união das caixas do produto nos quadros do trecho (undefined = ainda medindo; null = não achou produto)
  const [uniao, setUniao] = useState<Caixa | null | undefined>(undefined)
  const decidiuFundo = useRef(false)
  const [ajustando, setAjustando] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [fase, setFase] = useState<Fase>(null)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [sintonia, setSintonia] = useState(0)
  const [tira, setTira] = useState<string[]>([])
  const [versao, setVersao] = useState(0)
  const palco = useRef<HTMLDivElement>(null)
  const sinal = useRef({ parar: false })
  const capaQuadro = useRef<HTMLCanvasElement | null>(null)

  // abre o vídeo (ou o GIF) e o processador (WebGL)
  useEffect(() => {
    let vivo = true
    let aberto: FonteVideo | null = null
    let p: Processador | null = null
    ;(async () => {
      try {
        const gif = arquivo.type === 'image/gif' || /\.gif$/i.test(arquivo.name)
        if (gif && !abreGif()) throw new Error('gif')
        aberto = gif ? await abrirGif(arquivo) : await abrirVideo(arquivo)
        if (!vivo) return aberto.soltar()
        try {
          p = new Processador()
        } catch {
          p = null
        }
        setProc(p)
        setSemEstilo(!p || !tipo)
        setDur(Math.min(TRECHO_PADRAO, aberto.duracao))
        setFonte(aberto)
      } catch (e) {
        if (!vivo) return
        setErro(
          e instanceof Error && e.message === 'gif'
            ? 'Esse navegador não abre GIF animado aqui. Manda um vídeo (MP4, MOV ou WebM).'
            : 'Esse vídeo não abre neste navegador. Grava de novo pela câmera do celular (MP4) ou abre o painel no Chrome.',
        )
      }
    })()
    return () => {
      vivo = false
      sinal.current.parar = true
      aberto?.soltar()
      p?.soltar()
    }
  }, [arquivo, tipo])

  // o canvas do processador mora na vitrine grande
  useEffect(() => {
    const el = palco.current
    if (!el || !proc) return
    proc.canvas.className = 'pn-est-real'
    el.prepend(proc.canvas)
    return () => proc.canvas.remove()
  }, [proc, fonte])

  // a tira de quadros (8 ao longo do vídeo)
  useEffect(() => {
    if (!fonte) return
    let vivo = true
    ;(async () => {
      const urls: string[] = []
      for (let i = 0; i < 8; i++) {
        const img = await fonte.quadro((fonte.duracao * (i + 0.5)) / 8)
        if (!vivo) return
        const c = novoCanvas(54, 96)
        const g = contexto(c)
        const k = Math.max(54 / fonte.w, 96 / fonte.h)
        g.drawImage(img, (54 - fonte.w * k) / 2, (96 - fonte.h * k) / 2, fonte.w * k, fonte.h * k)
        urls.push(c.toDataURL('image/jpeg', 0.7))
      }
      if (vivo) setTira(urls)
    })()
    return () => {
      vivo = false
    }
  }, [fonte])

  // o fundo (modelado no 1º quadro do trecho) e o quadro pela união dos quadros do trecho
  useEffect(() => {
    if (!fonte || !proc) return
    let vivo = true
    const t = window.setTimeout(async () => {
      setAjustando(true)
      try {
        const img = await fonte.quadro(ini)
        const grande = reduzir(img, fonte.w, fonte.h, 480)
        const an = analisar({ w: grande.width, h: grande.height, d: contexto(grande).getImageData(0, 0, grande.width, grande.height).data })
        if (!vivo) return
        const primeiro = recortar(an, an.tolerancia, null)
        const liso = fundoLiso(an) && primeiro.area > 0.015 && primeiro.area < 0.92
        setBase(an)
        if (!decidiuFundo.current) {
          decidiuFundo.current = true
          setTirarFundo(liso)
        }
        // o 1º quadro já dá um quadro (a prévia aparece logo); depois, a união das caixas do produto em 5 quadros do trecho
        const tol = toleranciaPara(an, quanto)
        const k1 = grande.width / fonte.w
        if (primeiro.caixa && uniao === undefined) setUniao({ x0: primeiro.caixa.x0 / k1, y0: primeiro.caixa.y0 / k1, x1: primeiro.caixa.x1 / k1, y1: primeiro.caixa.y1 / k1 })
        let uniao2: Caixa | null = null as Caixa | null
        for (let i = 0; i < 5; i++) {
          const q = await fonte.quadro(ini + (dur * i) / 4)
          if (!vivo) return
          const px = quadroPequeno(q, fonte.w, fonte.h)
          const m = mascaraDoQuadro(px, an, tol)
          if (!m.caixa) continue
          const kx = fonte.w / m.w
          const ky = fonte.h / m.h
          const c = { x0: m.caixa.x0 * kx, y0: m.caixa.y0 * ky, x1: m.caixa.x1 * kx, y1: m.caixa.y1 * ky }
          uniao2 = uniao2 ? { x0: Math.min(uniao2.x0, c.x0), y0: Math.min(uniao2.y0, c.y0), x1: Math.max(uniao2.x1, c.x1), y1: Math.max(uniao2.y1, c.y1) } : c
          await respirar()
        }
        if (!vivo) return
        setUniao(uniao2)
      } finally {
        if (vivo) setAjustando(false)
      }
    }, 350)
    return () => {
      vivo = false
      window.clearTimeout(t)
    }
    // refaz com o trecho e o "quanto"; ligar/desligar o fundo só refaz o quadro (abaixo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte, proc, ini, dur, quanto])

  const tol = base ? toleranciaPara(base, quanto) : 10
  const recorte1 = useMemo(() => (base ? recortar(base, tol, null) : null), [base, tol])
  const ajusteCor = useMemo(() => (base && corNoEstilo ? ajusteDeCor(base, tirarFundo && recorte1 ? recorte1.fundo : null) : SEM_AJUSTE), [base, corNoEstilo, tirarFundo, recorte1])
  const tratamento: Tratamento | null = quadro ? { base: tirarFundo ? base : null, tol, quadro, cor: ajusteCor } : null

  /** Desenha um quadro tratado (com a máscara do quadro, quando tira o fundo). */
  const desenhar = (img: CanvasImageSource, t: Tratamento) => {
    if (!proc || !fonte) return
    proc.desenhar(img, fonte.w, fonte.h, t)
  }

  // a prévia parada: o 1º quadro do trecho tratado (e a cópia pra capa e pra sintonia)
  useEffect(() => {
    if (!fonte || !proc || !tratamento || tocando || fase) return
    let vivo = true
    ;(async () => {
      const img = await fonte.quadro(ini)
      if (!vivo) return
      desenhar(img, tratamento)
      const c = capaQuadro.current ?? novoCanvas(SAIDA_VIDEO.w, SAIDA_VIDEO.h)
      contexto(c).drawImage(proc.canvas, 0, 0)
      capaQuadro.current = c
      setVersao((v) => v + 1)
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte, proc, quadro, tirarFundo, tol, ajusteCor, ini, tocando, fase])

  // o quadro automático: o produto (a união dos quadros) no molde das ilustrações; com o fundo mantido, o vídeo inteiro.
  // Volta pro automático quando o trecho muda, o fundo liga ou desliga, ou no "Centralizar"
  const [centralizar, setCentralizar] = useState(0)
  useEffect(() => {
    if (!fonte || uniao === undefined) return
    setQuadro(quadroAutomatico(fonte.w, fonte.h, tirarFundo ? uniao : null))
  }, [fonte, uniao, tirarFundo, centralizar])
  const ligarFundo = (v: boolean) => setTirarFundo(v)

  const primeira = useRef(false)
  useEffect(() => {
    if (versao > 0 && !primeira.current) {
      primeira.current = true
      setSintonia(1)
    }
  }, [versao])

  const corHalo = useMemo(() => {
    const c = capaQuadro.current
    if (!c || versao === 0) return cor
    const p = novoCanvas(90, 160)
    contexto(p).drawImage(c, 0, 0, 90, 160)
    try {
      return corDominante(contexto(p).getImageData(0, 0, 90, 160))
    } catch {
      return cor
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao])

  const verTrecho = async () => {
    if (!fonte || !tratamento || tocando) return
    setTocando(true)
    sinal.current = { parar: false }
    try {
      await fonte.tocar(ini, dur, (img) => desenhar(img, tratamento), sinal.current)
    } finally {
      setTocando(false)
    }
  }

  // arrastar e pinça na vitrine grande (como na foto)
  const ponteiros = useRef(new Map<number, { x: number; y: number }>())
  const gesto = useRef<{ x: number; y: number; q: Quadro; dist: number } | null>(null)
  const aoDescer = (e: EventoPonteiro<HTMLDivElement>) => {
    if (!quadro || fase) return
    e.currentTarget.setPointerCapture(e.pointerId)
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...ponteiros.current.values()]
    gesto.current = { x: pts[0].x, y: pts[0].y, q: quadro, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 }
  }
  const aoMover = (e: EventoPonteiro<HTMLDivElement>) => {
    const g = gesto.current
    if (!g || !ponteiros.current.has(e.pointerId)) return
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const r = e.currentTarget.getBoundingClientRect()
    const pts = [...ponteiros.current.values()]
    if (pts.length > 1 && g.dist > 0) {
      setQuadro({ ...g.q, escala: (g.q.escala * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.dist })
      return
    }
    setQuadro({ ...g.q, dx: g.q.dx + (pts[0].x - g.x) / r.width, dy: g.q.dy + (pts[0].y - g.y) / r.height })
  }
  const aoSubir = (e: EventoPonteiro<HTMLDivElement>) => {
    ponteiros.current.delete(e.pointerId)
    if (!ponteiros.current.size) gesto.current = null
  }
  const zoom = (f: number) => quadro && setQuadro({ ...quadro, escala: quadro.escala * f })
  const mover = (dx: number, dy: number) => quadro && setQuadro({ ...quadro, dx: quadro.dx + dx, dy: quadro.dy + dy })

  const usar = async () => {
    if (!fonte || !proc || !tratamento || !tipo || fase) return
    setErroEnvio(null)
    sinal.current.parar = true
    sinal.current = { parar: false }
    try {
      setFase({ qual: 'gravando', t: 0 })
      // a capa: o 1º quadro tratado
      desenhar(await fonte.quadro(ini), tratamento)
      const capa = await capaDe(proc.canvas)
      // a barra anda de 1/4 em 1/4 de segundo (redesenhar a tela a cada quadro roubava tempo da gravação)
      let mostrado = -1
      const g = await gravar(proc.canvas, tipo, (pronto) =>
        fonte.tocar(
          ini,
          dur,
          (img, t) => {
            desenhar(img, tratamento)
            pronto()
            const passo = Math.floor((t - ini) * 4)
            if (passo !== mostrado) {
              mostrado = passo
              setFase({ qual: 'gravando', t: Math.max(0, t - ini) })
            }
          },
          sinal.current,
        ),
      )
      ;(window as unknown as { __gcGravacao?: unknown }).__gcGravacao = { quadros: g.quadros, segundos: g.segundos, bytes: g.blob.size, tipo: g.tipo }
      if (g.blob.size < 1000) throw new Error('O vídeo saiu vazio. Tenta de novo (deixa o painel aberto na tela enquanto grava).')
      if (g.blob.size > 5.8 * 1048576) throw new Error('O vídeo ficou grande demais. Escolhe um trecho menor.')
      const ext = g.blob.type.includes('mp4') ? 'mp4' : 'webm'
      setFase({ qual: 'subindo', fracao: 0 })
      await aoUsar({ video: g.blob, nomeVideo: `thumb.${ext}`, capa: capa.blob, nomeCapa: capa.nome }, (f) => setFase({ qual: 'subindo', fracao: f }))
    } catch (e) {
      setErroEnvio(e instanceof Error && e.message ? e.message : 'O vídeo não subiu. Tenta de novo.')
      setFase(null)
    }
  }

  // sem regravar: o original (MP4 até 6 MB e 6 s), com a capa do 1º quadro só cabendo no 9:16
  const podeOriginal = !!fonte && ehMp4(arquivo) && arquivo.size <= ORIGINAL_MAXIMO && fonte.duracao <= TRECHO_MAXIMO + 0.2
  const usarOriginal = async () => {
    if (!fonte || fase || !podeOriginal) return
    setErroEnvio(null)
    try {
      setFase({ qual: 'subindo', fracao: 0 })
      const capa = await capaDe(capaSimples(await fonte.quadro(0), fonte.w, fonte.h))
      const ext = /\.mov$/i.test(arquivo.name) || arquivo.type === 'video/quicktime' ? 'mov' : 'mp4'
      await aoUsar({ video: arquivo, nomeVideo: `original.${ext}`, capa: capa.blob, nomeCapa: capa.nome }, (f) => setFase({ qual: 'subindo', fracao: f }))
    } catch (e) {
      setErroEnvio(e instanceof Error && e.message ? e.message : 'O vídeo não subiu. Tenta de novo.')
      setFase(null)
    }
  }

  const ocupado = !!fase
  const maxIni = fonte ? Math.max(0, fonte.duracao - dur) : 0
  const maxDur = fonte ? Math.min(TRECHO_MAXIMO, fonte.duracao) : TRECHO_MAXIMO
  const larguraGrande = 'min(56vw, 252px)'
  const complexo = !!base && !fundoLiso(base)
  return (
    <Folha
      aberta
      aoFechar={() => !ocupado && aoFechar()}
      titulo="Thumb animada"
      sub="Escolhe o trecho: o painel deixa no estilo da loja e grava a thumb do card."
      larga
      preso={ocupado}
      className="pn-folha-estudio"
      rodape={
        <div className="pn-est-pe">
          {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
          {fase && (
            <div className="pn-foto-andamento-linha" role="status">
              <Pontinhos rotulo={fase.qual === 'gravando' ? 'Gravando a thumb…' : 'Subindo o vídeo…'} />
              <span className="pn-foto-barra" aria-hidden="true">
                <i style={{ transform: `scaleX(${fase.qual === 'gravando' ? Math.min(1, fase.t / dur) : fase.fracao})` }} />
              </span>
              <span>{fase.qual === 'gravando' ? `gravando ${segundos(fase.t)} de ${segundos(dur)}` : `${Math.round(fase.fracao * 100)}%`}</span>
            </div>
          )}
          {!semEstilo ? (
            <Botao largo onClick={() => void usar()} ocupado={ocupado} disabled={!fonte || !quadro || ajustando}>
              Usar assim
            </Botao>
          ) : (
            <Botao largo onClick={() => void usarOriginal()} ocupado={ocupado} disabled={!podeOriginal}>
              Mandar o vídeo original
            </Botao>
          )}
          <div className="pn-est-pe-dupla">
            <Botao variante="texto" onClick={aoFechar} disabled={ocupado}>
              Cancelar
            </Botao>
          </div>
        </div>
      }
    >
      <div className="pn-est">
        {erro ? (
          <Aviso tipo="erro">{erro}</Aviso>
        ) : !fonte ? (
          <div className="pn-est-abrindo">
            <Pontinhos rotulo="Abrindo o vídeo…" />
            <p>Abrindo o vídeo…</p>
          </div>
        ) : semEstilo ? (
          <>
            <Aviso tipo="info">
              Este navegador não regrava vídeo, então não dá pra deixar no estilo da loja aqui: no Chrome fica no estilo da loja (sem o fundo, no meio, com a cor acertada).{' '}
              {podeOriginal ? 'Dá pra mandar o vídeo original assim mesmo: o site só enquadra ele no card.' : `Pra mandar o original, ele tem de ser MP4 de até 6 MB e 6 s (esse tem ${segundos(fonte.duracao)} e ${(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB).`}
            </Aviso>
            <p className="pn-est-numeros">
              {segundos(fonte.duracao)} · {fonte.w}×{fonte.h}
            </p>
          </>
        ) : (
          <>
            <div className="pn-filtros pn-est-vista" role="group" aria-label="Ver">
              <button type="button" className="pn-filtro" onClick={() => void verTrecho()} disabled={tocando || !quadro || ocupado}>
                <Ic nome="play" tamanho={16} /> {tocando ? 'Tocando…' : 'Ver o trecho'}
              </button>
              <button type="button" className="pn-filtro" onClick={() => setSintonia((n) => n + 1)} disabled={!capaQuadro.current || ocupado}>
                <Ic nome="estrela" tamanho={16} /> Ver entrar no site
              </button>
            </div>
            <div className="pn-est-vitrines">
              <figure className="pn-est-fig">
                <Vitrine
                  largura={252}
                  style={{ width: larguraGrande, height: `calc(${larguraGrande} * 16 / 9)` }}
                  cor={corHalo}
                  sintonia={capaQuadro.current && sintonia ? { vez: sintonia, imagem: capaQuadro.current } : null}
                  className="pn-est-grande pn-est-toque-mexer"
                  onPointerDown={aoDescer}
                  onPointerMove={aoMover}
                  onPointerUp={aoSubir}
                  onPointerCancel={aoSubir}
                  role="img"
                  aria-label="A thumb animada, como fica no story"
                >
                  <div ref={palco} className="pn-est-palco" />
                </Vitrine>
                <figcaption>{ajustando ? 'Ajustando o quadro…' : 'No story'}</figcaption>
              </figure>
              <figure className="pn-est-fig">
                <div className="pn-sq pn-est-card" style={{ width: 'min(30vw, 132px)' }}>
                  <div className="pn-sq-arte">
                    <Vitrine largura={56} cor={corHalo} sintonia={null} style={{ width: '43%', height: 'auto', aspectRatio: '9 / 16' }}>
                      <CopiaDoQuadro fonte={capaQuadro.current} versao={versao} />
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

            <div className="pn-est-trecho">
              {tira.length > 0 && (
                <div className="pn-est-quadros" aria-hidden="true">
                  {tira.map((u, i) => {
                    const t = (fonte.duracao * (i + 0.5)) / 8
                    return <img key={i} src={u} alt="" style={{ flex: 1, minWidth: 0, objectFit: 'cover', opacity: t >= ini && t <= ini + dur ? 1 : 0.35 }} />
                  })}
                </div>
              )}
              <div className="pn-est-trecho-linha">
                <label htmlFor="est-ini">Começa em</label>
                <input id="est-ini" type="range" min={0} max={Math.max(0.01, maxIni)} step={0.1} value={Math.min(ini, maxIni)} disabled={ocupado || maxIni <= 0} onChange={(e) => setIni(Number(e.target.value))} />
                <output htmlFor="est-ini">{segundos(Math.min(ini, maxIni))}</output>
              </div>
              <div className="pn-est-trecho-linha">
                <label htmlFor="est-dur">Duração</label>
                <input
                  id="est-dur"
                  type="range"
                  min={Math.min(1, maxDur)}
                  max={maxDur}
                  step={0.5}
                  value={Math.min(dur, maxDur)}
                  disabled={ocupado}
                  onChange={(e) => {
                    const d = Number(e.target.value)
                    setDur(d)
                    if (fonte && ini + d > fonte.duracao) setIni(Math.max(0, fonte.duracao - d))
                  }}
                />
                <output htmlFor="est-dur">{segundos(Math.min(dur, maxDur))}</output>
              </div>
              <p className="pn-est-numeros">
                Vídeo de {segundos(fonte.duracao)} · a thumb sai em {SAIDA_VIDEO.w}×{SAIDA_VIDEO.h}, {tipo?.includes('mp4') ? 'MP4' : 'WebM'}, sem som
              </p>
            </div>

            {complexo && (
              <Aviso tipo="info" acao={tirarFundo ? <button type="button" className="pn-link-botao" onClick={() => ligarFundo(false)}>Manter o fundo</button> : undefined}>
                {tirarFundo ? 'O fundo desse vídeo tem muita coisa: o recorte pode errar. Se ficar estranho, mantém o fundo.' : 'O fundo desse vídeo tem muita coisa, então mantive o fundo: só enquadrei e escureci as bordas.'}
              </Aviso>
            )}

            <div className="pn-est-controles">
              <label className="pn-troca">
                <input type="checkbox" checked={tirarFundo} onChange={(e) => ligarFundo(e.target.checked)} disabled={ocupado} />
                <span className="pn-troca-marca" aria-hidden="true" />
                <span>Tirar o fundo</span>
              </label>
              {tirarFundo && (
                <div className="pn-est-faixa">
                  <label htmlFor="est-quanto-v" className="pn-rotulo">
                    Quanto do fundo apagar
                  </label>
                  <div className="pn-est-faixa-linha">
                    <span aria-hidden="true">Menos</span>
                    <input
                      id="est-quanto-v"
                      type="range"
                      min={0}
                      max={100}
                      value={quantoDigitado}
                      disabled={ocupado}
                      onChange={(e) => setQuantoDigitado(Number(e.target.value))}
                      onPointerUp={() => setQuanto(quantoDigitado)}
                      onKeyUp={() => setQuanto(quantoDigitado)}
                      onBlur={() => setQuanto(quantoDigitado)}
                    />
                    <span aria-hidden="true">Mais</span>
                  </div>
                </div>
              )}
              <div className="pn-est-ajuste" role="group" aria-label="Tamanho e posição">
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
                <button type="button" className="pn-botao pn-botao-texto" onClick={() => setCentralizar((n) => n + 1)}>
                  <span className="pn-botao-txt">Centralizar</span>
                </button>
              </div>
              <label className="pn-troca">
                <input type="checkbox" checked={corNoEstilo} onChange={(e) => setCorNoEstilo(e.target.checked)} disabled={ocupado} />
                <span className="pn-troca-marca" aria-hidden="true" />
                <span>Cor no estilo da loja</span>
              </label>
            </div>
          </>
        )}
      </div>
    </Folha>
  )
}

/** A prévia pequena (card): a cópia do 1º quadro tratado. */
function CopiaDoQuadro({ fonte, versao }: { fonte: HTMLCanvasElement | null; versao: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !fonte) return
    const g = contexto(c)
    g.clearRect(0, 0, c.width, c.height)
    g.imageSmoothingQuality = 'high'
    g.drawImage(fonte, 0, 0, c.width, c.height)
  }, [fonte, versao])
  return <canvas ref={ref} className="pn-est-real" width={180} height={320} />
}
