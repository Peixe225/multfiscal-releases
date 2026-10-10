// O CSS das telas de Equipe e Clientes entra como <style> próprio, logo depois do do painel (estilo.ts): cada frente
// com o seu, sem um arquivo comum crescendo. Importado pelas telas daqui.
import css from './contas.css?inline'

const ID = 'gc-css-contas'
let el = document.getElementById(ID) as HTMLStyleElement | null
if (!el) {
  el = document.createElement('style')
  el.id = ID
  document.head.appendChild(el)
}
// em dev, a edição do contas.css reexecuta este módulo e troca o conteúdo
el.textContent = css
