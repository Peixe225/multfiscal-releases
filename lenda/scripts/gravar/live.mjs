/**
 * Grava uma lenda inteira do modo LIVE com o simulador (público de teste votando e mandando presentes):
 * disputa → o maior doador cria a lenda → carreira votada → fim de carreira com os agradecimentos.
 */
import { gravar } from './gravador.mjs'
import { BASE, dorme, esperarJogo, lerHall, novoContexto } from './comum.mjs'

export async function gravarLive(browser, job, log = () => {}) {
  const cfg = {
    source: 'simulador', simAuto: true, simSpeed: 3, voteSeconds: job.voto ?? 9, extendOnTie: false, creator: 'disputa', bidSeconds: 12,
    createSeconds: 25, minBidCoins: 1, identityVote: true, nameMode: 'apoiador', celebrationSeconds: 3, nextCareerSeconds: 30,
    pace: job.pace ?? 'expressa', safeArea: job.safeArea ?? true, likesGoal: 400, instantWinCoins: 0, bridgeUrl: '',
  }
  const ctx = await novoContexto(browser, job.formato, { a0: job.a0, a1: job.a1, extra: '.lv-menu{display:none!important}' })
  await ctx.addInitScript((cfg) => {
    try {
      localStorage.setItem('lenda:live:v1', JSON.stringify({ state: { config: cfg, editedAt: 0 }, version: 1 }))
      sessionStorage.setItem('lenda:live:session', JSON.stringify({ state: { on: true, paused: false }, version: 1 }))
    } catch {}
  }, cfg)
  const page = await ctx.newPage()
  const marcas = []
  let rec = null
  const marca = (o) => { if (rec) marcas.push({ t: Math.round(rec.tempo() * 10) / 10, ...o }) }
  const erros = []
  page.on('pageerror', (e) => erros.push(String(e.message)))
  try {
    await page.goto(BASE + '#/live?tela=palco&janela=1', { waitUntil: 'load' })
    await esperarJogo(page)
    // começa a gravar quando a disputa já está na tela (pula a abertura)
    await page.waitForFunction(() => /DISPUTA|disputa/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {})
    await dorme(400)
    rec = await gravar(page, job.arquivo, job.video)
    marca({ o: 'disputa' })
    const fim = Date.now() + (job.maxSegundos ?? 420) * 1000
    let estado = 'disputa', viuCel = false, decisoes = 0, ultimoStep = ''
    while (Date.now() < fim) {
      const s = await page.evaluate(() => {
        const t = document.body.innerText
        return {
          criando: /Nasce uma lenda/i.test(t) ? 'nasce' : /CRIA(Ç|C)ÃO|!criar|!nome/i.test(t) ? 'criacao' : '',
          cel: !!document.querySelector('.ck-cel'), fim: !!document.querySelector('section.ck-end'),
          step: document.querySelector('.ck-step')?.textContent ?? '',
        }
      }).catch(() => ({}))
      if (s.criando === 'criacao' && estado === 'disputa') { estado = 'criacao'; marca({ o: 'criacao' }) }
      if (s.criando === 'nasce' && estado !== 'nasce' && estado !== 'carreira') { estado = 'nasce'; marca({ o: 'nasce' }) }
      if (s.step && s.step !== ultimoStep) { ultimoStep = s.step; decisoes++; if (estado !== 'carreira') estado = 'carreira'; marca({ o: 'votacao', i: decisoes, txt: s.step }) }
      if (s.cel && !viuCel) marca({ o: 'titulo' })
      viuCel = !!s.cel
      if (s.fim) { marca({ o: 'fim' }); await dorme(9000); break }
      await dorme(300)
    }
    const hall = await lerHall(page)
    const out = await rec.parar()
    rec = null
    return { ok: !!hall?.length, ...out, marcas, hall, erros, ...(hall?.length ? {} : { erro: 'a carreira não terminou no tempo' }) }
  } catch (e) {
    let out = null
    if (rec) { try { out = await rec.parar() } catch {} }
    return { ok: false, erro: String(e?.message ?? e), ...(out ?? {}), marcas, erros }
  } finally {
    await ctx.close().catch(() => {})
  }
}
