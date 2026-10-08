// O CSS do painel entra como <style> no <head>, num pedaço só dele: o CSS único do site (vite.config: cssCodeSplit
// false) não ganha nada e o painel não baixa o do site (o plugin painelSemCssDoSite tira o link do HTML). Reaproveita
// o base.css do site (tokens, .px, .folha, .cortina, botões) e o 2/5 redesenhado da Pixelify (GC Digitos).
// A fonte vem do mesmo arquivo do site (mesmo nome com hash: quem já abriu o site tem em cache).
import base from '../estilos/base.css?inline'
// ?raw (e não ?inline, como o jogo usa): módulo à parte, pra o painel não arrancar esse pedaço do pacote do jogo
import digitos from '../interativos/sorte/digitos.css?raw'
import pixel400 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff2?url'
import pixel500 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff2?url'
import css from './painel.css?inline'

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const fonte = (url: string, peso: number) =>
  `@font-face{font-family:'Pixelify Sans';font-style:normal;font-display:swap;font-weight:${peso};src:url(${url}) format('woff2');unicode-range:${LATIN}}`

const ID = 'gc-css-painel'
let el = document.getElementById(ID) as HTMLStyleElement | null
if (!el) {
  el = document.createElement('style')
  el.id = ID
  document.head.appendChild(el)
}
// em dev, a edição do painel.css reexecuta este módulo e troca o conteúdo
el.textContent = fonte(pixel400, 400) + fonte(pixel500, 500) + digitos + base + css
