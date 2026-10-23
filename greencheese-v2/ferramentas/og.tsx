// Composições para a imagem de compartilhamento (og.png 1200×630) e o ícone da tela inicial (180×180).
// Abra com o servidor de desenvolvimento rodando: npm run og (o script tira os prints com Playwright).
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/500.css'
import '../src/estilos/base.css'
import '../src/componentes/Local.css'
import { Logo } from '../src/arte/Logo'
import { ProdutoVisual } from '../src/arte/ProdutoVisual'
import { AdesivoLocal } from '../src/componentes/Local'
import dados from '../src/dados/catalogo.json'
import type { Produto } from '../src/lib/tipos'

const produtos = dados.produtos as Produto[]
const p = (id: string) => produtos.find((x) => x.id === id)!
const modo = new URLSearchParams(location.search).get('modo') ?? 'og'

function Og() {
  return (
    <div style={{ width: 1200, height: 630, background: '#000', position: 'relative', overflow: 'hidden', color: '#fff', display: 'flex' }}>
      <div style={{ width: 620, padding: '64px 0 0 72px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Logo tamanho={168} />
        <p className="px" style={{ fontSize: 64, lineHeight: 1 }}>
          GREEN CHEESE
          <br />
          IMPORTS
        </p>
        <p style={{ font: '600 26px/1.3 system-ui', color: '#a8a8a8', maxWidth: 480 }}>Escolhe no story, monta a sacola, o pedido sai pronto pro WhatsApp.</p>
        <div style={{ marginTop: 6 }}>
          <AdesivoLocal texto="RJ · MG · SP · ES · SC" tamanho="g" inclinacao={-3} />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 70, top: 40, width: 310, height: 551, borderRadius: 14, outline: '2px solid #262626', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', gap: 4 }}>
          {[1, 0.4, 0, 0].map((v, i) => (
            <span key={i} style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.35)' }}>
              <i style={{ display: 'block', height: '100%', width: `${v * 100}%`, background: '#fff' }} />
            </span>
          ))}
        </div>
        <div style={{ position: 'absolute', inset: '30px 20px 150px' }}>
          <ProdutoVisual produto={p('jack-daniels-old-no7-1l')} largura={120} revelar={false} prioridade />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 30, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="px" style={{ fontSize: 24 }}>JACK DANIEL'S OLD NO. 7</p>
          <p className="px" style={{ fontSize: 34 }}>R$ 149,90</p>
          <p className="px" style={{ fontSize: 22 }}>DISPONÍVEL ✅</p>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 330, top: 300, width: 120, height: 213, opacity: 0.35 }}>
        <ProdutoVisual produto={p('gin-tanqueray-london-dry')} largura={72} revelar={false} prioridade />
      </div>
    </div>
  )
}

function Icone() {
  // ícone da tela inicial: o logo com folga (área segura dos ícones "maskable" do Android)
  const t = window.innerWidth
  return (
    <div style={{ width: t, height: t, background: '#000', display: 'grid', placeItems: 'center' }}>
      <Logo tamanho={Math.round(t * 0.82)} desenho="completo" />
    </div>
  )
}

createRoot(document.getElementById('raiz')!).render(modo === 'icone' ? <Icone /> : <Og />)
