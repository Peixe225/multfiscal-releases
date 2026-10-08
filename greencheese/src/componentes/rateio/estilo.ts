// O CSS do Rateio baixa junto com os pedaços dele (a aba, a página e o "Como funciona"), fora do CSS único do site
// (vite.config: cssCodeSplit false): quem nunca abre o rateio não paga por ele na primeira carga. Entra como <style>
// no <head>, como o do Teste minha sorte (a CSP do .htaccess já permite style inline).
import css from './Rateio.css?inline'
// o 2 e o 5 redesenhados (na Pixelify o 5 vira S e o 2 vira Z): título, preço e contador do rateio
import digitos from '../../interativos/sorte/digitos.css?inline'
// o código RAT-XXXX numa grade 5×7 própria (2/Z, B/8, G/6 e 5/S bem diferentes): gerado por scripts/gerar-codigo.mjs
import codigo from './codigo.css?inline'

const ID = 'gc-css-rateio'
if (typeof document !== 'undefined') {
  let el = document.getElementById(ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID
    document.head.appendChild(el)
  }
  // em dev, a edição do Rateio.css reexecuta este módulo e troca o conteúdo
  el.textContent = digitos + codigo + css
}
