/**
 * GERADO por gen-photo-manifest.mjs — não edite à mão.
 * Recortes fotográficos reais disponíveis em public/trophies/<id>.webp (720 px de altura, WebP com alfa).
 * Fontes e licenças: docs/CREDITOS.md.
 */
export const TROPHY_PHOTO_IDS: readonly string[] = [
  'ballon-dor',
  'brasileirao',
  'bundesliga',
  'champions-league',
  'club-world-cup',
  'conference-league',
  'copa-america',
  'copa-del-rey',
  'copa-do-brasil',
  'coupe-de-france',
  'euro',
  'fa-cup',
  'golden-boot',
  'laliga',
  'libertadores',
  'liga-mx',
  'premier-league',
  'recopa',
  'sudamericana',
  'world-cup',
]

/** Proporção largura/altura de cada recorte (reserva a largura antes de a imagem carregar). */
export const TROPHY_PHOTO_ASPECT: Readonly<Record<string, number>> = {
  'ballon-dor': 0.6111,
  'brasileirao': 0.7361,
  'bundesliga': 1.0931,
  'champions-league': 0.6236,
  'club-world-cup': 0.8528,
  'conference-league': 0.4833,
  'copa-america': 0.3847,
  'copa-del-rey': 0.5222,
  'copa-do-brasil': 0.9278,
  'coupe-de-france': 0.7222,
  'euro': 0.4375,
  'fa-cup': 0.5458,
  'golden-boot': 1.5458,
  'laliga': 0.7708,
  'libertadores': 0.2792,
  'liga-mx': 0.425,
  'premier-league': 0.5319,
  'recopa': 0.6278,
  'sudamericana': 0.4472,
  'world-cup': 0.4264,
}
