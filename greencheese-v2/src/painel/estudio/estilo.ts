// O CSS do Estúdio entra com o pedaço dele (o painel só baixa o Estúdio quando o dono escolhe uma foto ou um vídeo),
// num <style> só, como o resto do painel (src/painel/estilo.ts).
import css from './estudio.css?inline'

const ID = 'gc-css-estudio'

export function usarCssDoEstudio(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = ID
    document.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}
