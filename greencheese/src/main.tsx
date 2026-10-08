import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/500.css'
import './estilos/base.css'
// o 2 e o 5 redesenhados na grade da Pixelify (lá o 5 vira S e o 2 vira Z): os contadores da barra e da lateral (rateios
// abertos, sacola, cupons) e, depois, o prêmio e o rateio. ~1,3 KB comprimido, só os dois dígitos
import './interativos/sorte/digitos.css'
import { App } from './App'
import { carregarArtesRealistas } from './arte/realista/carregar'

// já fica na fila; o download em si espera liberarArtesRealistas() (ver carregar.ts)
carregarArtesRealistas().catch(() => {})

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
