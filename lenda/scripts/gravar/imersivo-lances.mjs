/**
 * Melhores momentos do Modo Imersivo a partir dos estados de exemplo do jogo (#/imersivo?fixture=…):
 * uma partida inteira como titular (lances decisivos, intervalo, apito final), o título e a noite da
 * Bola de Ouro. Os estados de exemplo saem do motor de verdade e nunca são salvos.
 */
import { gravar } from './gravador.mjs'
import { BASE, dorme, entre, esperarJogo, novoContexto, tocar } from './comum.mjs'

const vis = async (page, sel) => { const l = page.locator(sel).first(); return (await l.count()) && (await l.isVisible().catch(() => false)) ? l : null }
const botao = async (page, txt) => { const l = page.getByRole('button', { name: txt }).first(); return (await l.count()) && (await l.isVisible().catch(() => false)) && !(await l.isDisabled().catch(() => true)) ? l : null }

/** Joga sozinho até a condição de parada (ou o tempo acabar). */
async function jogar(page, marca, { maxMs, para }) {
  const fim = Date.now() + maxMs
  while (Date.now() < fim) {
    let l
    if (await para()) return true
    if ((l = await vis(page, '.lx-cele.im-cele'))) { marca({ o: 'titulo' }); await dorme(4200); await page.keyboard.press('Escape'); await dorme(800); continue }
    if ((l = await vis(page, '.im-km button.im-opt:not([disabled])'))) {
      marca({ o: 'lance' }); await dorme(entre(1500, 2300))
      const ops = page.locator('.im-km button.im-opt:not([disabled])'); const n = await ops.count()
      await tocar(page, ops.nth(entre(0, Math.max(0, n - 1)))); await dorme(1500); continue
    }
    if ((l = await vis(page, '.im-timing__go'))) { await dorme(entre(900, 1700)); await tocar(page, l); await dorme(1200); continue }
    if ((l = await vis(page, '.im-pen__opts button:not([disabled])'))) {
      marca({ o: 'penalti' }); await dorme(1500)
      const ops = page.locator('.im-pen__opts button:not([disabled])'); await tocar(page, ops.nth(entre(0, (await ops.count()) - 1))); await dorme(2200); continue
    }
    if ((l = await botao(page, 'Bola rolando'))) { await dorme(2200); await tocar(page, l); await dorme(600); continue }
    if ((l = await botao(page, 'Começar o 2º tempo'))) { marca({ o: 'intervalo' }); await dorme(2600); await tocar(page, l); await dorme(800); continue }
    if ((l = (await botao(page, 'Entrar em campo')) ?? (await botao(page, 'Ir para o banco')))) { marca({ o: 'pre-jogo' }); await dorme(2400); await tocar(page, l); await dorme(1500); continue }
    if ((l = await botao(page, 'Ver balanço e premiação'))) { await dorme(1800); await tocar(page, l); await dorme(1500); continue }
    if ((l = await botao(page, 'Noite da Bola de Ouro'))) { await dorme(2200); await tocar(page, l); await dorme(1500); continue }
    if ((l = await botao(page, 'Abrir envelope'))) { marca({ o: 'gala' }); await dorme(2200); await tocar(page, l); await dorme(1200); continue }
    await dorme(400)
  }
  return false
}

export async function gravarImersivoLances(browser, job) {
  const ctx = await novoContexto(browser, job.formato)
  await ctx.addInitScript(() => { try { localStorage.setItem('lenda:imm:speed', '2'); localStorage.setItem('lenda:imm:comojogar:v1', '1') } catch {} })
  const page = await ctx.newPage()
  const marcas = []
  let rec = null
  const marca = (o) => { if (rec) marcas.push({ t: Math.round(rec.tempo() * 10) / 10, ...o }) }
  const erros = []
  page.on('pageerror', (e) => erros.push(String(e.message)))
  try {
    // 1) uma partida em andamento, com o lance decisivo na tela, até o apito final
    await page.goto(BASE + '#/imersivo?fixture=lance', { waitUntil: 'load' })
    await esperarJogo(page)
    await page.waitForSelector('.im-km', { timeout: 30000 })
    await dorme(600)
    rec = await gravar(page, job.arquivo, job.video)
    marca({ o: 'lance' })
    const fimJogo = async () => !!(await botao(page, 'Voltar à Central'))
    await jogar(page, marca, { maxMs: 150000, para: fimJogo })
    marca({ o: 'fim-jogo' }); await dorme(4500)
    // 2) pênalti decisivo
    await page.goto(BASE + '#/imersivo?fixture=penalti'); await dorme(1200)
    await jogar(page, marca, { maxMs: 11000, para: async () => false })
    // 3) campeão: a festa do título
    await page.goto(BASE + '#/imersivo?fixture=campeao'); await dorme(1200)
    await jogar(page, marca, { maxMs: 9000, para: async () => false })
    // 4) a noite da Bola de Ouro
    await page.goto(BASE + '#/imersivo?fixture=gala'); await dorme(1500)
    await jogar(page, marca, { maxMs: 30000, para: async () => !!(await page.getByRole('button', { name: /Começar a temporada/ }).count()) })
    marca({ o: 'fim' }); await dorme(3500)
    const out = await rec.parar(); rec = null
    return { ok: true, ...out, marcas, erros }
  } catch (e) {
    let out = null
    if (rec) { try { out = await rec.parar() } catch {} }
    try { await page.screenshot({ path: job.arquivo.replace(/\.mp4$/, '.erro.png') }) } catch {}
    return { ok: false, erro: String(e?.message ?? e), ...(out ?? {}), marcas, erros }
  } finally { await ctx.close().catch(() => {}) }
}
