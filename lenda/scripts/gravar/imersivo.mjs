/**
 * Grava o começo de uma carreira do Modo Imersivo: criação, escolha da base, treino e as primeiras
 * partidas com os lances decisivos (o "jogador" escolhe sozinho, com pausas de quem está lendo).
 */
import { gravar } from './gravador.mjs'
import { BASE, dorme, entre, esperarJogo, novoContexto, paisNome, tocar } from './comum.mjs'

async function digitar(page, loc, texto) {
  await tocar(page, loc); await loc.fill('')
  for (const ch of texto) { await page.keyboard.type(ch); await dorme(entre(70, 140)) }
}

export async function gravarImersivo(browser, job) {
  const ctx = await novoContexto(browser, job.formato, { a0: job.a0, a1: job.a1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('lenda:imm:speed', '2'); localStorage.removeItem('lenda:imm:auto') } catch {} })
  const page = await ctx.newPage()
  const marcas = []
  let rec = null
  const marca = (o) => { if (rec) marcas.push({ t: Math.round(rec.tempo() * 10) / 10, ...o }) }
  const erros = []
  page.on('pageerror', (e) => erros.push(String(e.message)))
  try {
    await page.goto(BASE + '#/', { waitUntil: 'load' })
    await esperarJogo(page)
    await page.waitForSelector('.ld-ctas__start', { timeout: 30000 })
    await dorme(500)
    rec = await gravar(page, job.arquivo, job.video)
    marca({ o: 'inicio' })
    await dorme(1500)
    await tocar(page, page.locator('button.ld-mode', { hasText: 'Modo Imersivo' })); await dorme(1200)
    await tocar(page, page.locator('.ld-ctas__start'))
    await page.waitForSelector('#conteudo.id-wrap', { timeout: 20000 }); await dorme(900)
    const wide = job.formato === 'horizontal'
    const pais = paisNome(job.identity.nationality)
    await digitar(page, page.locator('input[type=search][placeholder="Buscar país"]'), pais); await dorme(500)
    const opc = page.getByRole('radio', { name: pais, exact: true }).first()
    if (await opc.count()) await tocar(page, opc); else await page.keyboard.press('Enter')
    await dorme(700)
    if (!wide) { await tocar(page, page.getByRole('button', { name: 'Continuar', exact: true })); await dorme(700) }
    await digitar(page, page.locator('#id-surname'), job.identity.surname)
    const num = page.locator('#id-number'); await tocar(page, num); await num.fill(''); await page.keyboard.type(String(job.identity.number), { delay: 120 })
    await dorme(500)
    if (!wide) { await tocar(page, page.getByRole('button', { name: 'Continuar', exact: true })); await dorme(700) }
    await tocar(page, page.locator('button.lx-pchip', { hasText: new RegExp(`^\\s*${job.identity.position}\\s*$`) }).first()); await dorme(900)
    await tocar(page, page.getByRole('button', { name: wide ? 'Confirmar identidade' : 'Confirmar', exact: true }))
    marca({ o: 'carreira' })
    await page.waitForURL(/#\/imersivo/, { timeout: 30000 })
    let jogos = 0, ocioso = 0
    const fim = Date.now() + (job.maxSegundos ?? 300) * 1000
    const vis = async (sel) => { const l = page.locator(sel).first(); return (await l.count()) && (await l.isVisible().catch(() => false)) ? l : null }
    const porTexto = async (txt) => { const l = page.getByRole('button', { name: txt, exact: false }).first(); return (await l.count()) && (await l.isVisible().catch(() => false)) && !(await l.isDisabled().catch(() => true)) ? l : null }
    while (Date.now() < fim && jogos < (job.jogos ?? 2)) {
      let l
      if ((l = await vis('.lx-cele.im-cele'))) { marca({ o: 'titulo' }); await dorme(3200); await page.keyboard.press('Escape'); await dorme(800); continue }
      if ((l = await vis('.im-km button.im-opt:not([disabled])'))) { marca({ o: 'lance' }); await dorme(entre(1400, 2400)); const ops = page.locator('.im-km button.im-opt:not([disabled])'); const n = await ops.count(); await tocar(page, ops.nth(Math.min(n - 1, entre(0, n - 1)))); await dorme(1500); continue }
      if ((l = await vis('.im-timing__go'))) { await dorme(entre(900, 1800)); await tocar(page, l); await dorme(1200); continue }
      if ((l = await vis('.im-pen__opts button:not([disabled])'))) { marca({ o: 'penalti' }); await dorme(1500); const ops = page.locator('.im-pen__opts button:not([disabled])'); await tocar(page, ops.nth(entre(0, (await ops.count()) - 1))); await dorme(2000); continue }
      if ((l = await porTexto('Bola rolando'))) { await dorme(2600); await tocar(page, l); await dorme(800); continue }
      if ((l = await porTexto('Começar o 2º tempo'))) { marca({ o: 'intervalo' }); await dorme(2600); await tocar(page, l); await dorme(800); continue }
      if ((l = await porTexto('Voltar à Central'))) { marca({ o: 'fim-jogo', i: ++jogos }); await dorme(3800); if (jogos >= (job.jogos ?? 2)) break; await tocar(page, l); await dorme(1200); continue }
      if ((l = await vis('.im-pre__cta'))) { marca({ o: 'pre-jogo' }); await dorme(2200); await tocar(page, l); await dorme(1500); continue }
      if ((l = await vis('.im-hero__play'))) { await dorme(1600); await tocar(page, l); await dorme(1500); continue }
      if ((l = await vis('button.im-story__opt'))) { marca({ o: 'decisao' }); await dorme(entre(1800, 2600)); await tocar(page, page.locator('button.im-story__opt').first()); await dorme(1500); continue }
      if ((l = await vis('button.im-ans'))) { await dorme(1600); await tocar(page, page.locator('button.im-ans').first()); await dorme(1300); continue }
      if ((l = await vis('.im-train__go'))) { marca({ o: 'treino' }); await dorme(1500); await tocar(page, l); await dorme(1500); continue }
      if ((l = await porTexto('Ir para a coletiva'))) { await dorme(1200); await tocar(page, l); await dorme(1200); continue }
      if ((l = await vis('.im-hub__now button.lx-btn--primary, .im-hub__now button'))) { if (ocioso++ > 2) { await dorme(900); await tocar(page, l); ocioso = 0; await dorme(1200); continue } }
      if (ocioso > 6) { const s = await porTexto('Simular até o jogo') ?? await porTexto('Até o jogo'); if (s) { await tocar(page, s); ocioso = 0; await dorme(1500); continue } }
      ocioso++
      await dorme(500)
    }
    const out = await rec.parar(); rec = null
    return { ok: jogos > 0, ...out, marcas, erros, ...(jogos ? {} : { erro: 'nenhuma partida terminou' }) }
  } catch (e) {
    let out = null
    if (rec) { try { out = await rec.parar() } catch {} }
    try { await page.screenshot({ path: job.arquivo.replace(/\.mp4$/, '.erro.png') }) } catch {}
    return { ok: false, erro: String(e?.message ?? e), ...(out ?? {}), marcas, erros }
  } finally { await ctx.close().catch(() => {}) }
}
