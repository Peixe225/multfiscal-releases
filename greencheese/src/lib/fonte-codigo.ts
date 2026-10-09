// A fonte do código (GC Codigo, grade 5×7: C aberto × O, 2 × Z, G × 6) pros códigos SORTE-XXXX, que a pessoa lê,
// anota e dita pra loja. Na Pixelify o C fecha e "SORTE-GATC" lia "SORTE-GATO". Entra como <style> no <head> só com
// quem mostra código (jogo, Minha conta, sacola), fora do CSS principal; o rateio já traz a mesma no CSS dele.
import codigo from '../componentes/rateio/codigo.css?inline'

const ID = 'gc-css-codigo'
if (typeof document !== 'undefined') {
  let el = document.getElementById(ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID
    document.head.appendChild(el)
  }
  el.textContent = codigo
}
