// O CSS do Rateio baixa junto com os pedaços dele (a aba, a página e o "Como funciona"), fora do CSS único do site
// (vite.config: cssCodeSplit false): quem nunca abre o rateio não paga por ele na primeira carga. Entra como <style>
// no <head>, como o do Teste minha sorte (a CSP do .htaccess já permite style inline).
import css from './Rateio.css?inline'
// o 2 e o 5 redesenhados (na Pixelify o 5 vira S e o 2 vira Z): título, preço, contador e código do rateio
import digitos from '../../interativos/sorte/digitos.css?inline'

const ID = 'gc-css-rateio'
if (typeof document !== 'undefined') {
  let el = document.getElementById(ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID
    document.head.appendChild(el)
  }
  // em dev, a edição do Rateio.css reexecuta este módulo e troca o conteúdo
  el.textContent = digitos + css
}
