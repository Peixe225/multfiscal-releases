/**
 * Grava uma carreira do Modo Clássico do começo ao fim (criação → decisões → fim → Nota de Legado).
 *
 *   await gravarClassico(browser, job)   // job: { a0, a1, identity, pace, picks, formato, arquivo }
 *
 * A carreira é a mesma que a busca offline jogou: a semente vem de crypto.getRandomValues (fixado no
 * contexto) e cada escolha é o mesmo cartão (índice) ou o mesmo canto do pênalti.
 */
import { gravar } from './gravador.mjs'
import { BASE, dorme, entre, esperarJogo, lerHall, novoContexto, paisNome, tocar } from './comum.mjs'

const RITMO = { intensa: 'Intenso', normal: 'Normal', expressa: 'Expresso' }

async function digitar(page, loc, texto) {
  await tocar(page, loc)
  await loc.fill('')
  for (const ch of texto) { await page.keyboard.type(ch); await dorme(entre(70, 140)) }
}

export async function gravarClassico(browser, job, log = () => {}) {
  const ctx = await novoContexto(browser, job.formato, { a0: job.a0, a1: job.a1 })
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
    await dorme(600)
    rec = await gravar(page, job.arquivo, job.video)
    marca({ o: 'inicio' })
    await dorme(1800)
    // landing: modo clássico + ritmo
    const modo = page.locator('button.ld-mode', { hasText: 'Modo Clássico' })
    if ((await modo.getAttribute('aria-pressed')) !== 'true') await tocar(page, modo)
    await dorme(500)
    const ritmo = page.getByRole('radio', { name: RITMO[job.pace], exact: true })
    if ((await ritmo.getAttribute('aria-checked')) !== 'true') { await tocar(page, ritmo); await dorme(700) }
    await dorme(600)
    await tocar(page, page.locator('.ld-ctas__start'))
    marca({ o: 'criacao' })
    await page.waitForSelector('#conteudo.id-wrap', { timeout: 20000 })
    await dorme(900)
    const wide = job.formato === 'horizontal'
    const pais = paisNome(job.identity.nationality)
    const busca = page.locator('input[type=search][placeholder="Buscar país"]')
    await digitar(page, busca, pais)
    await dorme(500)
    const opc = page.getByRole('radio', { name: pais, exact: true }).first()
    if (await opc.count()) await tocar(page, opc)
    else await page.keyboard.press('Enter')
    await dorme(800)
    if (!wide) { await tocar(page, page.getByRole('button', { name: 'Continuar', exact: true })); await dorme(700) }
    await digitar(page, page.locator('#id-surname'), job.identity.surname)
    await dorme(300)
    const num = page.locator('#id-number')
    await tocar(page, num); await num.fill(''); await page.keyboard.type(String(job.identity.number), { delay: 120 })
    await dorme(400)
    const pe = page.getByRole('radio', { name: job.identity.foot === 'left' ? 'Esquerda' : 'Direita', exact: true })
    if ((await pe.getAttribute('aria-checked')) !== 'true') await tocar(page, pe)
    await dorme(500)
    if (!wide) { await tocar(page, page.getByRole('button', { name: 'Continuar', exact: true })); await dorme(800) }
    const chip = page.locator('button.lx-pchip', { hasText: new RegExp(`^\\s*${job.identity.position}\\s*$`) }).first()
    await tocar(page, chip)
    await dorme(1100)
    await tocar(page, page.getByRole('button', { name: wide ? 'Confirmar identidade' : 'Confirmar', exact: true }))
    marca({ o: 'carreira' })
    await page.waitForSelector('section.ck-decision', { timeout: 30000 })

    // decisões
    for (let i = 0; i < job.picks.length; i++) {
      const p = job.picks[i]
      const alvo = page.locator(`#ck-opt-${p.idx}`)
      const t0 = Date.now()
      // espera o cartão ficar clicável (a folha de baixo reabre quando o resultado da temporada termina)
      for (;;) {
        const ok = await alvo.evaluate((el) => {
          if (!el || el.closest('[hidden]') || el.getAttribute('aria-disabled') === 'true' || el.disabled) return false
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !document.documentElement.classList.contains('ck-celebrating')
        }).catch(() => false)
        if (ok) break
        if (await page.locator('section.ck-end').count()) throw new Error(`a carreira acabou antes da decisão ${i + 1} (divergiu da busca)`)
        if (Date.now() - t0 > 45000) throw new Error(`decisão ${i + 1} não ficou clicável`)
        await dorme(150)
      }
      const n = p.pen ? 3 : await page.locator('[id^="ck-opt-"]').count()
      if (!p.pen && n !== Math.min(p.n, 4)) log(`aviso: decisão ${i + 1} tem ${n} cartões, a busca viu ${Math.min(p.n, 4)}`)
      await dorme(entre(1300, 2100)) // "lendo" as opções
      marca({ o: 'decisao', i: i + 1, tipo: p.kind, escolha: p.title })
      await tocar(page, alvo, { espera: entre(250, 450) })
      // títulos: a comemoração aparece durante o resultado
      const fimDecisao = Date.now() + 9000
      let viu = false
      while (Date.now() < fimDecisao) {
        if (!viu && (await page.locator('.ck-cel').count())) { viu = true; marca({ o: 'titulo', i: i + 1 }) }
        if (await page.locator('section.ck-end').count()) break
        const pronto = await page.locator('.ck-step').count()
        if (pronto && Date.now() > fimDecisao - 5500) break
        await dorme(200)
      }
    }
    await page.waitForSelector('section.ck-end', { timeout: 60000 })
    // espera a última comemoração fechar
    for (let k = 0; k < 40 && (await page.locator('.ck-cel').count()); k++) await dorme(250)
    marca({ o: 'fim' })
    await dorme(3200)
    await tocar(page, page.getByRole('button', { name: 'Ver resumo' }))
    await page.waitForSelector('section.hl-lrc', { timeout: 30000 })
    marca({ o: 'resumo' })
    await dorme(2600)
    // desce devagar até a Nota de Legado
    const alvoY = await page.locator('section.hl-lrc').evaluate((el) => el.getBoundingClientRect().top + scrollY - innerHeight * 0.18)
    const passos = 40
    const y0 = await page.evaluate(() => scrollY)
    for (let s = 1; s <= passos; s++) {
      const e = s / passos, k = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2
      await page.evaluate((y) => scrollTo(0, y), y0 + (alvoY - y0) * k)
      await dorme(28)
    }
    marca({ o: 'nota' })
    await dorme(4600)
    // fecha no card para compartilhar (a "figurinha" da carreira)
    const card = page.locator('#sm-share')
    if (await card.count()) {
      const y1 = await page.evaluate(() => scrollY)
      const y2 = await card.evaluate((el) => el.getBoundingClientRect().top + scrollY - innerHeight * 0.08)
      for (let s = 1; s <= 36; s++) { const e = s / 36, k = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2; await page.evaluate((y) => scrollTo(0, y), y1 + (y2 - y1) * k); await dorme(28) }
      marca({ o: 'card' })
      await dorme(3800)
    }
    const hall = await lerHall(page)
    const out = await rec.parar()
    rec = null
    return { ok: true, ...out, marcas, hall, erros }
  } catch (e) {
    let out = null
    if (rec) { try { out = await rec.parar() } catch {} }
    try { await page.screenshot({ path: job.arquivo.replace(/\.mp4$/, '.erro.png') }) } catch {}
    return { ok: false, erro: String(e?.message ?? e), ...(out ?? {}), marcas, erros }
  } finally {
    await ctx.close().catch(() => {})
  }
}
