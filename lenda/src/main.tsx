import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles/index.css'
import App from './App'

/**
 * Só no site público (VITE_SITE=1, oprojeto.online/lenda): deploy novo com a aba aberta. Os pedaços do
 * bundle têm hash no nome; depois do envio o index.html aponta para os novos, e o import() de uma tela que
 * esta aba ainda não tinha carregado pode não achar mais o arquivo velho (ou o CDN ainda não ter o novo).
 * O Vite avisa com o evento 'vite:preloadError' — recarregamos a página para pegar o index.html novo (o
 * progresso já está salvo no localStorage).
 * Recarrega SÓ quando é arquivo que não veio (as mensagens de "não consegui buscar o módulo/CSS" do Chrome,
 * Firefox, Safari e do próprio Vite), com internet, e no máximo UMA vez por build nesta aba: a marca no
 * sessionStorage é o endereço do index-<hash>.js que falhou (import.meta.url), então um index.html velho
 * vindo de um cache não vira laço, e o deploy seguinte ainda ganha a sua recarga. Erro dentro do módulo
 * (bug de verdade) e falha sem internet seguem o caminho de antes: o .catch de quem chamou, ou a tela de
 * erro da rota. Um import opcional (o confete, as pré-cargas do hover) que não achar o arquivo com internet
 * também recarrega: arquivo sumido quer dizer build velho, e a próxima tela daria o mesmo erro. Sem
 * sessionStorage não dá para garantir o "uma vez", então nem tenta.
 * Sem preventDefault de propósito: com ele o import() resolveria `undefined` e quem chamou quebraria com
 * um erro sem sentido. O erro original segue o caminho normal, e o #root some até a página nova chegar
 * (a tela de erro da rota não pisca antes do reload).
 * Fora do site fica de fora: no Artifact do claude.ai cada versão tem os próprios arquivos e a página roda
 * num iframe que não é nosso para recarregar; no PC (ponte, janela 9:16, OBS) um reload no meio da live
 * derrubaria os sockets — lá uma tela que falhou continua só na tela de erro dela, como sempre foi.
 */
const RELOAD_KEY = 'lenda:recarregou-chunk'
const CHUNK_MISSING = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i
if (import.meta.env.VITE_SITE === '1') {
  const build = import.meta.url
  window.addEventListener('vite:preloadError', (e) => {
    const err = (e as Event & { payload?: unknown }).payload
    if (navigator.onLine === false || !(err instanceof Error) || !CHUNK_MISSING.test(err.message)) return
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === build) return
      sessionStorage.setItem(RELOAD_KEY, build)
    } catch {
      return
    }
    document.getElementById('root')?.style.setProperty('visibility', 'hidden')
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
