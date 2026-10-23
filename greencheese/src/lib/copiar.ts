/**
 * Copia texto de forma SÍNCRONA dentro do toque (o navegador do Instagram pode não ter navigator.clipboard
 * e bloqueia qualquer coisa depois de await). Tenta execCommand primeiro e a API moderna em paralelo.
 */
export function copiarTexto(texto: string): boolean {
  let ok = false
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, texto.length)
    ok = document.execCommand('copy')
    ta.remove()
  } catch {
    ok = false
  }
  try {
    void navigator.clipboard?.writeText(texto).catch(() => undefined)
    if (navigator.clipboard) ok = true
  } catch {
    /* sem clipboard */
  }
  return ok
}
