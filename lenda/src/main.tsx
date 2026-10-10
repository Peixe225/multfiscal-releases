import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles/index.css'
import App from './App'

/**
 * Deploy novo com a aba aberta (site público, ou a ponte recompilando o dist/): os nomes dos pedaços do
 * bundle têm hash, os antigos somem do servidor e o import() de uma tela que ainda não tinha carregado
 * falha. O Vite avisa com o evento 'vite:preloadError' — recarregamos a página UMA vez para pegar o
 * index.html novo (o progresso já está salvo no localStorage, e a live volta sozinha pelo sessionStorage).
 * A marca com a hora no sessionStorage impede um laço quando o erro é outro (sem internet, arquivo faltando
 * de verdade): dentro de 30 s não recarrega de novo e o erro segue para a tela de erro, como antes. Sem
 * sessionStorage não dá para garantir isso, então nem tenta.
 * No Artifact do claude.ai fica de fora: lá cada versão publicada tem os próprios arquivos e a página roda
 * num iframe que não é nosso para recarregar.
 */
const RELOAD_KEY = 'lenda:recarregou-chunk'
if (import.meta.env.VITE_ARTIFACT !== '1') {
  window.addEventListener('vite:preloadError', (e) => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
      if (Date.now() - last < 30_000) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      return
    }
    // sem isto o Vite relança o erro e a tela de erro pisca antes do reload
    e.preventDefault()
    location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "user": motion follows prefers-reduced-motion; the in-game setting is handled per component */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
