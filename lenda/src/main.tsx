// v3.5: primeiro de tudo — o que o Safari 15.0–15.3 não tem (Array.prototype.at, structuredClone, Object.hasOwn)
import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles/index.css'
import App from './App'
import { iniciarMedicao } from './site/medicao'
import { useApp } from './store/app'

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

/** Marca a recarga desta build nesta aba; false se já recarregou (ou sem sessionStorage: aí nem tenta). */
function podeRecarregar(build: string): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === build) return false
    sessionStorage.setItem(RELOAD_KEY, build)
    return true
  } catch {
    return false
  }
}

/**
 * v3.5: a folha de estilo principal (o <link rel=stylesheet> do index.html) não chegou — 4G que caiu no meio, ou um
 * index.html velho apontando para um CSS que não existe mais. O vite:preloadError só cobre o import(); sem isto a página
 * abria sem estilo nenhum (fonte serifada, links azuis, o menu embolado) e não tentava de novo. Um módulo só roda depois
 * que as folhas de estilo da página terminaram (carregadas ou com erro), então aqui a resposta já é a final. No Chrome a
 * folha que falhou (com crossorigin) ainda tem `sheet`, mas ler as regras dá SecurityError: conta como não veio. Para não
 * recarregar à toa, confirma pelo tema (a variável --bg do <html>, que vem desse CSS).
 */
function cssNaoChegou(): boolean {
  const nossas = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => {
    try {
      return new URL(l.href).origin === location.origin
    } catch {
      return false
    }
  })
  const falhou = nossas.some((l) => {
    try {
      return !l.sheet || l.sheet.cssRules.length === 0
    } catch {
      return true
    }
  })
  if (!falhou) return false
  try {
    return !getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  } catch {
    return true
  }
}

/** Sem o CSS do jogo: um aviso com estilo próprio (inline), que recarrega ao tocar. */
function avisoSemCss(): void {
  const b = document.createElement('button')
  b.type = 'button'
  b.setAttribute('style',
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;width:100%;height:100%;' +
      'margin:0;padding:24px;border:0;background:#07080c;color:#f4f5f8;font:600 18px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent')
  const t = document.createElement('span')
  t.textContent = 'Conexão fraca. Toque para tentar de novo'
  const s = document.createElement('span')
  s.setAttribute('style', 'font-weight:400;font-size:15px;color:#a9adba;max-width:320px')
  s.textContent = 'Uma parte do jogo não chegou. Seu progresso fica salvo neste aparelho.'
  b.append(t, s)
  b.addEventListener('click', () => location.reload())
  document.getElementById('root')?.style.setProperty('display', 'none')
  document.body.append(b)
}

let semEstilo = false
if (import.meta.env.VITE_SITE === '1') {
  const build = import.meta.url
  window.addEventListener('vite:preloadError', (e) => {
    const err = (e as Event & { payload?: unknown }).payload
    if (navigator.onLine === false || !(err instanceof Error) || !CHUNK_MISSING.test(err.message)) return
    if (!podeRecarregar(build)) return
    document.getElementById('root')?.style.setProperty('visibility', 'hidden')
    location.reload()
  })

  if (import.meta.env.PROD && cssNaoChegou()) {
    semEstilo = true
    // uma recarga por build (a mesma marca do vite:preloadError); sem internet ou já recarregou: o aviso. Enquanto
    // recarrega, fica a marca do index.html (o estilo dela é embutido)
    if (navigator.onLine !== false && podeRecarregar(build)) location.reload()
    else avisoSemCss()
  }

  // v3.5: a medição liga já, antes de desenhar o jogo (o SiteRoot chega segundos depois no 4G lento). Estado provisório:
  // o vigias.ts chama iniciarMedicao de novo com o de verdade (jogando/modo e os diálogos do site).
  iniciarMedicao({ estadoJogo: () => ({ jogando: false, modo: null }), telaAtual: () => useApp.getState().route.path })
}

if (!semEstilo) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* "user": motion follows prefers-reduced-motion; the in-game setting is handled per component */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </StrictMode>,
  )
}
