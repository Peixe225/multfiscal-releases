// Recorta a arte dos produtos a partir dos prints do Instagram (referencias/) e gera WebP sobre preto puro.
//
// Uso:  npm run recortar
//
// 1. Ponha os prints (PNG/JPG, 1242×2688) em referencias/.
// 2. Para cada produto, adicione uma linha em scripts/recortes.json:
//      { "arquivo": "story-jack.png", "id": "jack-daniels-old-no7-1l" }
//    Sem x/y/w/h, o script procura sozinho o produto no meio do print (faixa entre 22% e 70% da altura,
//    que é onde o produto fica nos stories da marca) e corta o que não é preto.
//    Se o corte automático pegar texto ou adesivo junto, informe a caixa na mão (em pixels do print):
//      { "arquivo": "story-jack.png", "id": "jack-daniels-old-no7-1l", "x": 380, "y": 700, "w": 480, "h": 1100 }
// 3. O script grava public/produtos/<id>.webp e preenche "foto" no src/dados/catalogo.json.
//    No site, a foto passa pelo mesmo tratamento em dither das artes (a resolução baixa vira estética).

import sharp from 'sharp'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = new URL('..', import.meta.url).pathname
const pastaRef = join(raiz, 'referencias')
const pastaSaida = join(raiz, 'public', 'produtos')
const arqRecortes = join(raiz, 'scripts', 'recortes.json')
const arqCatalogo = join(raiz, 'src', 'dados', 'catalogo.json')

if (!existsSync(arqRecortes)) {
  console.error('Falta scripts/recortes.json (lista de { arquivo, id, x?, y?, w?, h? }).')
  process.exit(1)
}
const recortes = JSON.parse(readFileSync(arqRecortes, 'utf8')).recortes ?? []
if (!recortes.length) {
  console.log('scripts/recortes.json está vazio: nada para recortar. Veja as instruções no topo deste arquivo.')
  process.exit(0)
}
mkdirSync(pastaSaida, { recursive: true })
const catalogo = JSON.parse(readFileSync(arqCatalogo, 'utf8'))

/** Caixa do que não é preto dentro de uma região (limiar de luminância). */
async function caixaNaoPreta(img, regiao, limiar = 28) {
  const { data, info } = await img.clone().extract(regiao).greyscale().raw().toBuffer({ resolveWithObject: true })
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[y * info.width + x] > limiar) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const m = 12
  return {
    left: Math.max(0, regiao.left + x0 - m),
    top: Math.max(0, regiao.top + y0 - m),
    width: Math.min(info.width, x1 - x0 + 2 * m),
    height: Math.min(info.height, y1 - y0 + 2 * m),
  }
}

let feitos = 0
for (const r of recortes) {
  const origem = join(pastaRef, r.arquivo)
  if (!existsSync(origem)) {
    console.warn(`! ${r.arquivo} não está em referencias/ — pulei ${r.id}`)
    continue
  }
  const p = catalogo.produtos.find((x) => x.id === r.id)
  if (!p) {
    console.warn(`! id desconhecido no catálogo: ${r.id}`)
    continue
  }
  const img = sharp(origem)
  const meta = await img.metadata()
  let caixa
  if (r.w && r.h) caixa = { left: r.x ?? 0, top: r.y ?? 0, width: r.w, height: r.h }
  else {
    const top = Math.round(meta.height * 0.22)
    caixa = await caixaNaoPreta(img, { left: Math.round(meta.width * 0.08), top, width: Math.round(meta.width * 0.84), height: Math.round(meta.height * 0.48) })
  }
  if (!caixa) {
    console.warn(`! não achei produto em ${r.arquivo}`)
    continue
  }
  const saida = join(pastaSaida, `${r.id}.webp`)
  await img
    .extract(caixa)
    .flatten({ background: '#000000' })
    // pretos quase-pretos viram preto puro (o fundo some no #000 do site)
    .linear(1.06, -6)
    .resize({ height: 720, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(saida)
  p.foto = `produtos/${r.id}.webp`
  feitos++
  console.log(`✓ ${r.id} ← ${r.arquivo} (${caixa.width}×${caixa.height})`)
}

writeFileSync(arqCatalogo, JSON.stringify(catalogo, null, 2) + '\n')
console.log(`${feitos} foto(s) gerada(s) em public/produtos/. catalogo.json atualizado.`)
