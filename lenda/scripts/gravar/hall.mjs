/**
 * Grava o Hall das Lendas cheio das carreiras gravadas: ranking geral, filtro, categorias,
 * a ficha da melhor carreira e a de uma lenda real.
 */
import { gravar } from './gravador.mjs'
import { BASE, dorme, entre, esperarJogo, novoContexto, tocar } from './comum.mjs'

async function rolar(page, dy, ms = 1600) {
  const passos = Math.max(8, Math.round(ms / 30))
  const y0 = await page.evaluate(() => scrollY)
  for (let s = 1; s <= passos; s++) {
    const e = s / passos, k = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2
    await page.evaluate((y) => scrollTo(0, y), y0 + dy * k)
    await dorme(30)
  }
}
const ate = async (page, sel, margem = 0.15) => {
  const y = await page.locator(sel).first().evaluate((el, m) => el.getBoundingClientRect().top - innerHeight * m, margem).catch(() => null)
  if (y != null) await rolar(page, y, 1800)
}

export async function gravarHall(browser, job) {
  const ctx = await novoContexto(browser, job.formato)
  const page = await ctx.newPage()
  const marcas = []
  let rec = null
  const marca = (o) => { if (rec) marcas.push({ t: Math.round(rec.tempo() * 10) / 10, ...o }) }
  try {
    // grava o Hall no IndexedDB antes de o jogo abrir (mesma origem, sem o app rodando)
    await page.goto(BASE + 'favicon.svg')
    await page.evaluate((list) => new Promise((res, rej) => {
      const rq = indexedDB.open('lenda', 1)
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv') }
      rq.onerror = () => rej(rq.error)
      rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(list, 'hall'); tx.oncomplete = () => { rq.result.close(); res() }; tx.onerror = () => rej(tx.error) }
    }), job.entradas)
    await page.goto(BASE + '#/hall', { waitUntil: 'load' })
    await esperarJogo(page)
    await page.waitForSelector('section.hl-hero', { timeout: 30000 })
    await dorme(900)
    rec = await gravar(page, job.arquivo, job.video)
    marca({ o: 'hall' })
    await dorme(3500)
    await rolar(page, 520, 2200); await dorme(2500)
    await ate(page, '.hl-row--head', 0.12); marca({ o: 'ranking' }); await dorme(2500)
    const filtro = page.getByRole('radio', { name: 'Suas carreiras', exact: true })
    if (await filtro.count()) { await tocar(page, filtro); marca({ o: 'filtro' }); await dorme(2800) }
    const mais = page.locator('button.hl-more')
    if (await mais.count()) { await tocar(page, mais); await dorme(1200); await rolar(page, 900, 4200); await dorme(1500) }
    const todos = page.getByRole('radio', { name: 'Todos', exact: true })
    if (await todos.count()) { await tocar(page, todos); await dorme(1500) }
    await ate(page, '[aria-label="Categorias"]', 0.1); marca({ o: 'categorias' }); await dorme(1800)
    for (const cat of ['ballonDor', 'worldCups', 'goals', 'ucl']) {
      const tab = page.locator(`#hl-tab-${cat}`)
      if (await tab.count()) { await tocar(page, tab); await dorme(entre(2200, 2800)) }
    }
    await ate(page, 'article.hl-rcard', 0.1); marca({ o: 'suas-carreiras' }); await dorme(2500)
    await rolar(page, 700, 3000); await dorme(1500)
    // ficha da melhor carreira
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await dorme(1500)
    const det = page.locator('.hl-hero .hl-link', { hasText: 'Ver detalhes' }).first()
    if (await det.count()) { await tocar(page, det); marca({ o: 'ficha' }); await dorme(3500); const d = page.getByRole('dialog').last(); await d.evaluate((el) => { const sc = [...el.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40); if (sc) sc.scrollBy({ top: 500, behavior: 'smooth' }) }).catch(() => {}); await dorme(3000); await page.keyboard.press('Escape'); await dorme(1200) }
    const leg = page.locator('.hl-hero .hl-link', { hasText: 'Ficha da lenda' }).first()
    if (await leg.count()) { await tocar(page, leg); marca({ o: 'lenda' }); await dorme(4000); await page.keyboard.press('Escape'); await dorme(1200) }
    const out = await rec.parar(); rec = null
    return { ok: true, ...out, marcas }
  } catch (e) {
    let out = null
    if (rec) { try { out = await rec.parar() } catch {} }
    return { ok: false, erro: String(e?.message ?? e), ...(out ?? {}), marcas }
  } finally { await ctx.close().catch(() => {}) }
}
