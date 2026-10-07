// O CSS do "Teste minha sorte" baixa junto com o pedaço do jogo (e com a Minha conta, que mostra as Regras), fora do
// CSS único do site (vite.config: cssCodeSplit false): quem nunca abre o jogo não paga por ele na primeira carga.
// Entra como <style> no <head> (a CSP do .htaccess já permite style inline). Ver DECISOES.md.
import css from './sorte.css?inline'
// o 2 e o 5 do destaque do prêmio (na Pixelify o 5 vira S e o 2 vira Z); gerado por scripts/gerar-digitos.mjs
import digitos from './digitos.css?inline'

const ID = 'gc-css-sorte'
if (typeof document !== 'undefined') {
  let el = document.getElementById(ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID
    document.head.appendChild(el)
  }
  // em dev, a edição do sorte.css reexecuta este módulo e troca o conteúdo
  el.textContent = digitos + css
}
