// O CSS das telas de pedidos, avisos e falas entra como <style> próprio, logo depois do do painel (estilo.ts): cada
// frente com o seu, sem um arquivo comum crescendo. Importado pelas telas daqui.
import css from './pedidos.css?inline'

const ID = 'gc-css-pedidos'
let el = document.getElementById(ID) as HTMLStyleElement | null
if (!el) {
  el = document.createElement('style')
  el.id = ID
  document.head.appendChild(el)
}
// em dev, a edição do pedidos.css reexecuta este módulo e troca o conteúdo
el.textContent = css
