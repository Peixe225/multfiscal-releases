// Laboratório da revelação da fumaça (só desenvolvimento: laboratorio/fumaca.html no `npm run dev`; o build de
// produção não leva). Mostra a RevelacaoFumaca de cada raridade com um prêmio de exemplo, com repetir, raridade,
// pular, reduzido, velocidade (1× · 0,5× · 0,25× · parado + passo de 1/12 s), a técnica (pixel 4 · pixel 3 · suave ·
// canvas 2D) e o tamanho do quadro. Na URL (pra print e vídeo): ?r=epico&premio=piteira-vidro-15&w=390&h=844
// &modo=jogo&tec=px4&v=0.25&t=3.2 (para no quadro t) &limpo=1 (só o quadro) &reduzido=1.
import { StrictMode, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/500.css'
import '../estilos/base.css'
import '../interativos/sorte/digitos.css'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { carregarArtesRealistas, liberarArtesRealistas } from '../arte/realista/carregar'
import { premios } from '../dados/sorte'
import { fraseDoPremio } from '../lib/cupom'
import { ehRaridade, INFO_RARIDADE, RARIDADES, type Raridade } from '../lib/raridade'
import { RevelacaoFumaca } from '../interativos/sorte/fumaca'
import type { Motor } from '../interativos/sorte/fumaca/motor'
import { BolhaPremio } from '../interativos/sorte/Adesivos'

carregarArtesRealistas().catch(() => {})
liberarArtesRealistas?.()

const q = new URLSearchParams(location.search)
const TAMANHOS: [string, number, number][] = [
  ['390×844', 390, 844],
  ['320×568', 320, 568],
  ['360×640', 360, 640],
  ['430×932', 430, 932],
  ['844×390', 844, 390],
  ['932×430', 932, 430],
  ['568×320', 568, 320],
  ['480×680 (diálogo)', 480, 680],
]
// px4/px3/px5/suave: o shader (aceita o WebGL emulado do headless); auto: como no ar (sem placa de vídeo, canvas 2D); 2d: o
// caminho sem WebGL
const TECNICAS = {
  px4: { pixel: 4, glSoftware: true },
  px3: { pixel: 3, glSoftware: true },
  px5: { pixel: 5, glSoftware: true },
  suave: { suave: true, glSoftware: true },
  auto: {},
  '2d': { forcar2d: true },
} as const
type Tecnica = keyof typeof TECNICAS

declare global {
  interface Window {
    __fumaca?: Motor
    __fumacaLab?: { pixel?: number; suave?: boolean; forcar2d?: boolean; leve?: boolean; glSoftware?: boolean }
    __lab?: { irPara: (t: number) => void; velocidade: (v: number) => void; pular: () => void; tempo: () => number; pronto: () => boolean }
  }
}

function Lab() {
  const [rar, setRar] = useState<Raridade>(() => (ehRaridade(q.get('r')) ? (q.get('r') as Raridade) : 'epico'))
  const [premioId, setPremioId] = useState(q.get('premio') ?? 'piteira-vidro-15')
  const [tam, setTam] = useState<[number, number]>(() => [Number(q.get('w')) || 390, Number(q.get('h')) || 844])
  const [modo, setModo] = useState<'jogo' | 'previa'>(q.get('modo') === 'previa' ? 'previa' : 'jogo')
  const [tec, setTec] = useState<Tecnica>(() => ((q.get('tec') as Tecnica) in TECNICAS ? (q.get('tec') as Tecnica) : 'px4'))
  const [reduzido, setReduzido] = useState(q.get('reduzido') === '1')
  const [vel, setVel] = useState(Number(q.get('v')) || 1)
  const [rodada, setRodada] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const [tempo, setTempo] = useState(0)
  const limpo = q.get('limpo') === '1'
  // a técnica vai pro componente por um global de laboratório (só em dev)
  window.__fumacaLab = TECNICAS[tec]

  const p = premios.find((x) => x.id === premioId) ?? premios[0]
  const frase = fraseDoPremio(p)
  const visual = frase.produto ? <ProdutoVisual produto={frase.produto} largura={160} revelar={false} brilho={false} prioridade rotulo={null} /> : <BolhaPremio produto={null} tamanho={96} />
  const chave = `${rar}|${premioId}|${modo}|${tec}|${reduzido}|${tam.join('x')}|${rodada}`
  const anotar = (s: string) => setLog((l) => [`${(window.__fumaca?.tempo() ?? 0).toFixed(2)} s · ${s}`, ...l].slice(0, 8))

  // velocidade e parada no quadro t (pra folha de contato)
  useEffect(() => {
    let vivo = true
    const t0 = q.get('t')
    const espera = () => {
      if (!vivo) return
      const m = window.__fumaca
      if (!m) return requestAnimationFrame(espera)
      m.definirVelocidade(vel)
      if (t0 != null && rodada === 0) {
        m.definirVelocidade(0)
        m.irPara(Number(t0))
      }
    }
    espera()
    return () => {
      vivo = false
    }
  }, [chave, vel, rodada])
  useEffect(() => {
    // o relógio na tela (só com os controles: no quadro limpo, nada re-renderiza durante a medida)
    if (limpo) {
      // só o quadro: sem barra de rolagem (no Chromium do computador ela come 15 px da direita do quadro nos prints)
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      return
    }
    const id = setInterval(() => setTempo(window.__fumaca?.tempo() ?? 0), 100)
    return () => clearInterval(id)
  }, [limpo])
  useEffect(() => {
    window.__lab = {
      irPara: (t) => {
        window.__fumaca?.definirVelocidade(0)
        window.__fumaca?.irPara(t)
      },
      velocidade: (v) => window.__fumaca?.definirVelocidade(v),
      pular: () => window.__fumaca?.pular(),
      tempo: () => window.__fumaca?.tempo() ?? 0,
      pronto: () => document.querySelector('.fm')?.getAttribute('data-fase') === 'pronto',
    }
  }, [])

  const quadro = useMemo<CSSProperties>(() => ({ width: tam[0], height: tam[1] }), [tam])
  const premioFumaca = { destaque: frase.destaque, produto: frase.alvo, raridade: rar }

  const palco = (
    <div className="lab-quadro" style={quadro}>
      <div className="lab-estrelas" />
      <RevelacaoFumaca
        key={chave}
        premio={premioFumaca}
        visual={visual}
        modo={modo}
        reduzido={reduzido}
        onPronto={() => anotar('onPronto')}
        onPular={() => anotar('onPular')}
      />
    </div>
  )
  if (limpo) return palco
  const bt = (ativo: boolean) => `lab-bt${ativo ? ' on' : ''}`
  return (
    <div className="lab">
      <aside className="lab-painel">
        <h1 className="px">Laboratório da fumaça</h1>
        <p className="lab-tempo px">{tempo.toFixed(2)} s</p>
        <div className="lab-grupo">
          {RARIDADES.map((r) => (
            <button key={r} className={bt(r === rar)} style={{ color: INFO_RARIDADE[r].cor }} onClick={() => setRar(r)}>
              {INFO_RARIDADE[r].nome}
            </button>
          ))}
        </div>
        <div className="lab-grupo">
          <button className="lab-bt" onClick={() => setRodada((n) => n + 1)}>
            Repetir
          </button>
          <button className="lab-bt" onClick={() => window.__fumaca?.pular()}>
            Pular
          </button>
          <button className={bt(reduzido)} onClick={() => setReduzido((x) => !x)}>
            Reduzido
          </button>
        </div>
        <div className="lab-grupo">
          {[1, 0.5, 0.25, 0].map((v) => (
            <button key={v} className={bt(vel === v)} onClick={() => setVel(v)}>
              {v === 0 ? 'Parado' : `${v}×`}
            </button>
          ))}
          <button
            className="lab-bt"
            onClick={() => {
              const m = window.__fumaca
              if (!m) return
              setVel(0)
              m.definirVelocidade(0)
              m.irPara(m.tempo() + 1 / 12)
            }}
          >
            +1/12 s
          </button>
        </div>
        <div className="lab-grupo">
          {(Object.keys(TECNICAS) as Tecnica[]).map((k) => (
            <button key={k} className={bt(tec === k)} onClick={() => setTec(k)}>
              {k}
            </button>
          ))}
        </div>
        <div className="lab-grupo">
          <button className={bt(modo === 'jogo')} onClick={() => setModo('jogo')}>
            jogo
          </button>
          <button className={bt(modo === 'previa')} onClick={() => setModo('previa')}>
            prévia
          </button>
        </div>
        <label className="lab-campo">
          Prêmio
          <select value={premioId} onChange={(e) => setPremioId(e.target.value)}>
            {premios.map((x) => (
              <option key={x.id} value={x.id}>
                {x.titulo}
              </option>
            ))}
          </select>
        </label>
        <label className="lab-campo">
          Tamanho
          <select value={tam.join('x')} onChange={(e) => setTam(e.target.value.split('x').map(Number) as [number, number])}>
            {TAMANHOS.map(([n, w, h]) => (
              <option key={n} value={`${w}x${h}`}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="lab-desenho">desenho: {typeof document !== 'undefined' ? (document.querySelector('.fm')?.getAttribute('data-desenho') ?? '…') : ''}</p>
        <ol className="lab-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </aside>
      {palco}
    </div>
  )
}

const estilo = document.createElement('style')
estilo.textContent = `
body { font: 14px/1.4 var(--ui); }
.lab { display: flex; gap: 24px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
.lab-painel { width: 300px; display: flex; flex-direction: column; gap: 12px; }
.lab-painel h1 { font-size: 20px; margin: 0; }
.lab-tempo { font-size: 28px; margin: 0; }
.lab-grupo { display: flex; flex-wrap: wrap; gap: 6px; }
.lab-bt { padding: 8px 10px; border: 1px solid #555; border-radius: 6px; background: #111; color: #fff; cursor: pointer; font: inherit; }
.lab-bt.on { background: #fff; color: #000 !important; }
.lab-campo { display: flex; flex-direction: column; gap: 4px; }
.lab-campo select { padding: 6px; background: #111; color: #fff; border: 1px solid #555; }
.lab-log { margin: 0; padding-left: 18px; color: #aaa; font-size: 12px; }
.lab-quadro { position: relative; flex: none; background: #000; outline: 1px solid #333; overflow: hidden; }
.lab-estrelas { position: absolute; inset: 0; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='220' shape-rendering='crispEdges' fill='%23fff'%3E%3Crect x='14' y='22' width='2' height='2' opacity='.32'/%3E%3Crect x='96' y='8' width='2' height='2' opacity='.22'/%3E%3Crect x='150' y='64' width='2' height='2' opacity='.28'/%3E%3Crect x='58' y='118' width='2' height='2' opacity='.2'/%3E%3Crect x='128' y='160' width='2' height='2' opacity='.32'/%3E%3Crect x='24' y='196' width='2' height='2' opacity='.22'/%3E%3C/svg%3E"); background-size: 180px 220px; }
.lab-quadro > .fm { position: absolute; inset: 0; }
`
document.head.appendChild(estilo)

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
