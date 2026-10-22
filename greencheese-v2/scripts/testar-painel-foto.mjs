// A foto pesada do celular (pedido do Ian em 22/10: o limite da foto foi de 8 pra 32 MB), no navegador e contra o
// servidor de verdade (roda dentro do scripts/testar-painel.mjs): uma foto de hoje (12 MP, uns 6 MB) e uma pesada de 50
// megapixels e uns 25 MB, escolhidas no Produto → Estúdio da foto. A pesada abre já reduzida (o ImageDecoder do JPEG
// em N/8, ou o createImageBitmap pedindo o tamanho de saída: a de 50 MP não passa inteira pela memória), sobe ("Usar
// assim" e "Usar a foto original") e o arquivo que o site serve fica do tamanho do de hoje — os bytes vão no relatório.

import { join } from 'node:path'
import { statSync } from 'node:fs'

/** Uma "foto de celular" sintética: a bancada com grão (o ruído é o que pesa no JPEG) e o produto no meio. */
async function gerarFoto(sharp, w, h, sigma, q, arquivo) {
  const fundo = await sharp({ create: { width: w, height: h, channels: 3, background: '#d9d4c7', noise: { type: 'gaussian', mean: 128, sigma } } }).raw().toBuffer({ resolveWithObject: true })
  const produto = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * 0.3)}" height="${Math.round(h * 0.7)}"><rect width="100%" height="100%" rx="${Math.round(w * 0.03)}" fill="#c43a22"/><rect y="40%" width="100%" height="20%" fill="#f2e6c8"/></svg>`)
  await sharp(fundo.data, { raw: fundo.info }).composite([{ input: produto, left: Math.round(w * 0.35), top: Math.round(h * 0.15) }]).jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toFile(arquivo)
  return { arquivo, bytes: statSync(arquivo).size, mp: (w * h) / 1e6 }
}

const kb = (n) => `${Math.round(n / 1024)} KB`
const mb = (n) => `${(n / 1048576).toFixed(1).replace('.', ',')} MB`

export async function fluxoFoto({ BASE, ok, print, novoContexto, entrar, sharp, pasta }) {
  const hoje = await gerarFoto(sharp, 4000, 3000, 14, 88, join(pasta, 'foto-12mp.jpg'))
  const pesada = await gerarFoto(sharp, 8660, 5800, 14, 88, join(pasta, 'foto-50mp.jpg'))
  ok(pesada.mp > 50 && pesada.bytes > 24 * 1048576 && pesada.bytes < 32 * 1048576, `a foto pesada de teste: ${pesada.mp.toFixed(1)} MP, ${mb(pesada.bytes)} (a de hoje: ${hoje.mp.toFixed(0)} MP, ${mb(hoje.bytes)})`)

  const ctx = await novoContexto(390, 844)
  // quantas vezes a foto foi aberta, e se foi pedindo o tamanho de saída (a reduzida) ou inteira
  await ctx.addInitScript(() => {
    const original = window.createImageBitmap
    window.__aberturas = []
    window.createImageBitmap = function (fonte, ...resto) {
      const o = resto.length >= 4 ? resto[4] : resto[0]
      window.__aberturas.push({ bytes: fonte && typeof fonte.size === 'number' ? fonte.size : null, via: 'createImageBitmap', reduzida: !!(o && (o.resizeWidth || o.resizeHeight)), w: o?.resizeWidth ?? null, h: o?.resizeHeight ?? null })
      return original.call(this, fonte, ...resto)
    }
    // o ImageDecoder (o JPEG já reduzido no decodificador): quem pede sem o tamanho abre inteira
    if (window.ImageDecoder) {
      const D = window.ImageDecoder
      const Instrumentado = function (op) {
        window.__aberturas.push({ bytes: null, via: 'ImageDecoder', reduzida: !!(op && (op.desiredWidth || op.desiredHeight)), w: op?.desiredWidth ?? null, h: op?.desiredHeight ?? null, tipo: op?.type })
        return new D(op)
      }
      Instrumentado.isTypeSupported = D.isTypeSupported?.bind(D)
      window.ImageDecoder = Instrumentado
    }
    // o tamanho de cada arquivo que sai do celular no envio (o painel manda a foto num FormData)
    window.__envios = []
    const guardar = (corpo) => {
      if (corpo instanceof FormData) for (const [, v] of corpo.entries()) if (v instanceof Blob) window.__envios.push(v.size)
    }
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function (corpo) {
      guardar(corpo)
      return send.call(this, corpo)
    }
    const f = window.fetch
    window.fetch = function (url, op) {
      guardar(op?.body)
      return f.call(this, url, op)
    }
  })
  const p = await ctx.newPage()
  await entrar(p)

  /** Escolhe a foto no produto novo, abre o Estúdio e sobe pelo botão; devolve o que o servidor guardou e o que o site serve. */
  const subir = async (foto, botao) => {
    await p.goto(`${BASE}/painel/#/produtos/novo`)
    await p.locator('#p-foto').waitFor({ state: 'attached' })
    await p.evaluate(() => (window.__aberturas = []))
    const t0 = Date.now()
    await p.locator('#p-foto').setInputFiles(foto.arquivo)
    const est = p.getByRole('dialog', { name: 'Estúdio da foto' })
    await est.waitFor()
    await est.locator('.pn-est-vista').waitFor({ timeout: 60000 })
    const abrir = Date.now() - t0
    const aberturas = await p.evaluate(() => window.__aberturas)
    await p.evaluate(() => (window.__envios = []))
    const resp = p.waitForResponse((r) => r.url().includes('r=admin-upload'))
    await est.getByRole('button', { name: botao, exact: true }).click()
    const r = await resp
    // o tamanho do arquivo que saiu do celular (o do FormData do envio)
    const enviado = (await p.evaluate(() => window.__envios)).reduce((a, b) => a + b, 0)
    const j = await r.json()
    await est.waitFor({ state: 'detached', timeout: 30000 })
    const servido = r.ok() ? (await (await fetch(`${BASE}/${j.imagem}`)).arrayBuffer()).byteLength : 0
    return { status: r.status(), ...j, enviado, servido, abrir, aberturas }
  }

  const h1 = await subir(hoje, 'Usar assim')
  const p1 = await subir(pesada, 'Usar assim')
  await print(p, 'foto-390-estudio-pesada')
  const p2 = await subir(pesada, 'Usar a foto original')
  const h2 = await subir(hoje, 'Usar a foto original')
  console.log(
    `  foto: hoje (${hoje.mp.toFixed(0)} MP, ${mb(hoje.bytes)}) → "Usar assim": subiu ${kb(h1.enviado)}, o site serve ${h1.largura}×${h1.altura} com ${kb(h1.servido)}; "Usar a foto original": subiu ${kb(h2.enviado)}, o site serve ${h2.largura}×${h2.altura} com ${kb(h2.servido)}`,
  )
  console.log(
    `  foto: pesada (${pesada.mp.toFixed(1)} MP, ${mb(pesada.bytes)}) → abriu no Estúdio em ${(p1.abrir / 1000).toFixed(1)} s; "Usar assim": subiu ${kb(p1.enviado)}, o site serve ${p1.largura}×${p1.altura} com ${kb(p1.servido)}; "Usar a foto original": subiu ${kb(p2.enviado)}, o site serve ${p2.largura}×${p2.altura} com ${kb(p2.servido)}`,
  )
  // as aberturas da original: o ImageDecoder (o JPEG) e o createImageBitmap com o arquivo pesado
  const daPesada = (x) => x.aberturas.filter((a) => a.bytes === pesada.bytes || a.via === 'ImageDecoder')
  const reduzida = daPesada(p1).find((a) => a.reduzida)
  ok(!!reduzida && Math.max(reduzida.w ?? 0, reduzida.h ?? 0) <= 2400, `a de 50 MP abre já reduzida no Estúdio (${reduzida ? `${reduzida.via} pedindo ${reduzida.w}×${reduzida.h}` : 'abriu inteira'})`)
  ok(daPesada(p1).length > 0 && daPesada(p1).every((a) => a.reduzida), `e nunca inteira (nenhuma abertura da original sem o tamanho de saída: ${JSON.stringify(daPesada(p1))})`)
  ok(p1.status === 201 && p1.largura === 720 && p1.altura === 1280, `"Usar assim" com a pesada: sobe e o site serve a de 720×1280 (${p1.status}, ${p1.largura}×${p1.altura})`)
  ok(p1.servido <= Math.max(2 * h1.servido, 400 * 1024), `o arquivo que o site serve fica do tamanho de hoje: ${kb(p1.servido)} (a de 12 MP: ${kb(h1.servido)}; a original tinha ${mb(pesada.bytes)})`)
  const orig = daPesada(p2)
  ok(orig.length > 0 && orig.every((a) => a.reduzida), `"Usar a foto original" também abre a pesada já reduzida (${orig.map((a) => `${a.via} ${a.w}×${a.h}`).join(', ') || 'abriu inteira'})`)
  ok(p2.status === 201 && p2.enviado > 0 && p2.enviado < 3 * 1048576 && Math.max(p2.largura, p2.altura) <= 1600, `"Usar a foto original" com a pesada: sobe a de 2000 px (${kb(p2.enviado)}, não os ${mb(pesada.bytes)}) e o site serve ${p2.largura}×${p2.altura}`)
  ok(p2.servido <= Math.max(2 * h2.servido, 600 * 1024), `e o que o site serve fica do tamanho de hoje: ${kb(p2.servido)} (a de 12 MP: ${kb(h2.servido)})`)
  await ctx.close()
}
