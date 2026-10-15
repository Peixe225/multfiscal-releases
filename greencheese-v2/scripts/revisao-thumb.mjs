// A thumb animada no site (rodada do scripts/revisao.mjs e conferência do scripts/celulares.mjs): o GET loja simulado
// com vídeo e capa em 4 produtos (os primeiros da grade de MG), o vídeo de verdade (WebM gerado pelo ffmpeg; sem ele,
// a rodada fica de fora e diz). Confere: na primeira tela nenhum vídeo baixa (nem antes da maior pintura, LCP); só toca
// o que está à vista, no máximo 2 ao mesmo tempo (celular e computador); aba escondida pausa e volta; movimento
// reduzido e economia de dados ficam na capa, sem baixar vídeo; vídeo com erro volta pra foto (ou pra ilustração, sem
// foto); o story aberto toca
// o dele; o story do Início não toca (é a primeira tela).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lojaDaSemente } from './revisao-loja.mjs'

/** Os 4 produtos com thumb animada (os primeiros da grade de MG na semente). */
export const COM_VIDEO = ['fanta-ghost-face-punch', 'coca-cola-vanilla', 'arizona-green-tea', 'dr-pepper']

/** O vídeo e a capa de teste (o produto "girando" sobre preto, como o painel grava), ou null sem ffmpeg. */
export function arquivosDaThumb() {
  const pasta = mkdtempSync(join(tmpdir(), 'gc-thumb-'))
  try {
    const cena = ['-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=24:d=4', '-f', 'lavfi', '-i', 'color=c=0xd8432a:s=120x330:r=24:d=4', '-filter_complex', "[1]scale=w='max(8,trunc(120*abs(cos(t*1.6))/2)*2)':h=330:eval=frame[l];[0][l]overlay=x='(W-w)/2':y=150:eval=frame,format=yuv420p"]
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...cena, '-t', '4', '-c:v', 'libvpx-vp9', '-b:v', '400k', join(pasta, 'v.webm')], { stdio: 'pipe' })
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...cena, '-frames:v', '1', join(pasta, 'c.png')], { stdio: 'pipe' })
    const out = { video: readFileSync(join(pasta, 'v.webm')), capa: readFileSync(join(pasta, 'c.png')) }
    rmSync(pasta, { recursive: true, force: true })
    return out
  } catch {
    rmSync(pasta, { recursive: true, force: true })
    return null
  }
}

/**
 * A loja da semente com a thumb animada nos 4 produtos (e todos à venda em MG). Os vídeos vêm do GET loja simulado,
 * nunca do catálogo (desde 15/10 nenhum produto do catálogo tem thumb animada: os 4 do material de 11/10 voltaram pro
 * desenho do site). fotos: ids que ganham também uma foto (a que o dono teria posto pelo Estúdio).
 */
export function lojaComThumb({ fotos = [] } = {}) {
  const loja = lojaDaSemente()
  COM_VIDEO.forEach((id, i) => {
    const p = loja.produtos.find((x) => x.id === id)
    p.video = `uploads/thumbteste${i}.webm`
    p.capa = `uploads/capateste${i}.png`
    if (fotos.includes(id)) p.foto = `uploads/fototeste${i}.png`
  })
  return loja
}

/**
 * Prepara o contexto: o GET loja com a thumb, os arquivos dela (e quem baixou o quê), o vídeo com erro (falhar: ids) e
 * a medida da maior pintura (LCP) e do 1º vídeo pedido.
 */
export async function prepararThumb(ctx, arquivos, { falhar = [], fotos = [] } = {}) {
  const loja = lojaComThumb({ fotos })
  await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) => r.fulfill({ json: { ok: true, versao: 31, atualizadoEm: new Date().toISOString(), loja }, headers: { 'Cache-Control': 'no-cache', ETag: '"31"' } }))
  const pedidos = []
  await ctx.route(/\/uploads\/(thumbteste|capateste|fototeste)\d\.(webm|png)$/, (r) => {
    const nome = r.request().url().split('/').pop()
    const video = nome.endsWith('.webm')
    if (video) pedidos.push(nome)
    const i = Number(nome.match(/\d/)[0])
    if (video && falhar.includes(COM_VIDEO[i])) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'não achei' })
    return r.fulfill({ status: 200, contentType: video ? 'video/webm' : 'image/png', body: video ? arquivos.video : arquivos.capa, headers: { 'Accept-Ranges': 'none' } })
  })
  await ctx.addInitScript(() => {
    window.__lcp = []
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push(e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      /* sem LCP */
    }
  })
  return { pedidos }
}

/** Como estão os vídeos da página: com src (baixando), tocando e quanto deles está na tela. */
export function estadoDosVideos(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll('video.pv-video')].map((v) => {
      const r = v.getBoundingClientRect()
      const vis = r.height ? Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height : 0
      return { id: v.closest('[data-arte]')?.getAttribute('data-arte') ?? '', src: !!v.getAttribute('src'), tocando: !v.paused && !v.ended, vis: +vis.toFixed(2), noHero: !!v.closest('.hero') }
    }),
  )
}

/** Espera até a condição sobre os vídeos valer (ou o prazo acabar) e devolve o último estado. */
export async function esperarVideos(p, cond, ms = 15000) {
  const fim = Date.now() + ms
  let e = await estadoDosVideos(p)
  while (Date.now() < fim && !cond(e)) {
    await p.waitForTimeout(250)
    e = await estadoDosVideos(p)
  }
  return e
}

/** Rola até o primeiro card com thumb ficar inteiro na tela. */
export async function irPraGrade(p) {
  await p.evaluate((id) => {
    const card = [...document.querySelectorAll('.vista-inicio .grade .card [data-arte]')].find((e) => e.getAttribute('data-arte') === id)
    card?.scrollIntoView({ block: 'center' })
  }, COM_VIDEO[0])
}

/**
 * A rodada completa (revisao.mjs). contexto(browser, viewport, opts) é o do revisao.mjs; conferir(cond, msg) anota.
 */
export async function rodadaThumb({ browser, base, contexto, conferir, foto }) {
  const arquivos = arquivosDaThumb()
  if (!arquivos) {
    conferir(true, 'thumb animada: sem ffmpeg aqui, a rodada fica de fora')
    return
  }
  const abrir = async (viewport, opts = {}, prep = {}) => {
    const ctx = await contexto(browser, viewport, opts)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
      } catch {
        /* ignora */
      }
    })
    if (opts.economia) await ctx.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true }))
    const r = await prepararThumb(ctx, arquivos, prep)
    const p = await ctx.newPage()
    await p.goto(`${base}?uf=mg`)
    return { ctx, p, ...r }
  }

  // celular: a primeira tela não baixa vídeo; a grade toca o que está à vista, no máximo 2
  {
    const { ctx, p, pedidos } = await abrir({ width: 390, height: 844 })
    await p.waitForTimeout(6000)
    const topo = await estadoDosVideos(p)
    conferir(pedidos.length === 0 && topo.every((v) => !v.src), `thumb: na primeira tela do celular nenhum vídeo baixa (${pedidos.length} pedidos, ${topo.filter((v) => v.src).length} com src)`)
    conferir(topo.every((v) => !v.noHero), 'thumb: o story do Início não tem vídeo (fica na capa: é a primeira tela)')
    await irPraGrade(p)
    const grade = await esperarVideos(p, (e) => e.some((v) => v.tocando))
    const tocando = grade.filter((v) => v.tocando)
    conferir(tocando.length >= 1 && tocando.length <= 2, `thumb: na grade do celular toca 1 ou 2 (${tocando.length}: ${tocando.map((v) => v.id).join(', ')})`)
    conferir(tocando.every((v) => v.vis >= 0.5), `thumb: só toca o que está à vista (${tocando.map((v) => `${v.id} ${v.vis}`).join(', ')})`)
    conferir(grade.filter((v) => v.src && v.vis === 0).length === 0, 'thumb: card fora da tela não baixa vídeo')
    // a thumb animada (quadro sobre preto, sem transparência) fica sem o halo pontilhado, que vazava pelo escuro do
    // produto; o card sem vídeo (o desenho do site) continua com ele
    const halos = await p.evaluate(
      (ids) => Object.fromEntries([...document.querySelectorAll('.vista-inicio .grade > .card[data-flip-id]')].map((li) => [li.getAttribute('data-flip-id'), { halo: !!li.querySelector('.pv.pv-com-halo'), video: ids.includes(li.getAttribute('data-flip-id')) }])),
      COM_VIDEO,
    )
    const comVideo = Object.entries(halos).filter(([, x]) => x.video)
    const semVideo = Object.entries(halos).filter(([id, x]) => !x.video && id === 'jack-daniels-old-no7-1l')
    conferir(comVideo.length === COM_VIDEO.length && comVideo.every(([, x]) => !x.halo) && semVideo.length === 1 && semVideo.every(([, x]) => x.halo), `thumb: o card com vídeo fica sem o halo pontilhado, o do desenho com (${JSON.stringify(halos).slice(0, 300)})`)
    const lcp = await p.evaluate(() => window.__lcp)
    const ini = await p.evaluate(() => performance.getEntriesByType('resource').filter((e) => /thumbteste/.test(e.name)).map((e) => e.startTime).sort((a, b) => a - b)[0] ?? null)
    conferir(ini !== null && lcp.length > 0 && ini > Math.max(...lcp), `thumb: o 1º vídeo só é pedido depois da maior pintura (LCP ${Math.round(Math.max(...lcp))} ms, vídeo ${Math.round(ini)} ms)`)
    await foto(p, 'thumb-celular-grade')
    // aba escondida: pausa todos; volta: toca de novo
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await p.waitForTimeout(400)
    conferir((await estadoDosVideos(p)).every((v) => !v.tocando), 'thumb: aba escondida pausa todos')
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const volta = await esperarVideos(p, (e) => e.some((v) => v.tocando), 4000)
    conferir(volta.some((v) => v.tocando), 'thumb: a aba volta e o vídeo também')
    // o story aberto toca o dele
    await p.locator('.vista-inicio .grade .card').filter({ has: p.locator(`[data-arte="${COM_VIDEO[0]}"]`) }).first().locator('.card-abrir').click()
    const story = await esperarVideos(p, (e) => e.some((v) => v.tocando && v.vis > 0.5 && !v.noHero && v.id === COM_VIDEO[0]), 8000)
    conferir(story.filter((v) => v.tocando).length <= 2 && story.some((v) => v.tocando && v.id === COM_VIDEO[0]), `thumb: o story aberto toca a thumb (tocando: ${story.filter((v) => v.tocando).map((v) => v.id).join(', ')})`)
    await foto(p, 'thumb-celular-story')
    await ctx.close()
  }

  // computador: a grade larga mostra os 4 de uma vez, e mesmo assim tocam no máximo 2
  {
    const { ctx, p } = await abrir({ width: 1280, height: 900 })
    await p.waitForTimeout(3500)
    await irPraGrade(p)
    await p.evaluate(() => window.scrollBy(0, 120))
    const e = await esperarVideos(p, (x) => x.filter((v) => v.vis >= 0.5).length >= 3 && x.some((v) => v.tocando))
    const vistos = e.filter((v) => v.vis >= 0.5)
    await p.waitForTimeout(2500)
    const depois = await estadoDosVideos(p)
    const tocando = depois.filter((v) => v.tocando)
    conferir(vistos.length >= 3 && tocando.length >= 1 && tocando.length <= 2, `thumb: no computador, ${vistos.length} à vista e ${tocando.length} tocando (no máximo 2)`)
    await foto(p, 'thumb-computador-grade')
    await ctx.close()
  }

  // movimento reduzido e economia de dados: ficam na capa, nenhum vídeo baixa
  for (const [nome, opts] of [
    ['movimento reduzido', { reduzir: true }],
    ['economia de dados', { economia: true }],
  ]) {
    const { ctx, p, pedidos } = await abrir({ width: 390, height: 844 }, opts)
    await p.waitForTimeout(3500)
    await irPraGrade(p)
    await p.waitForTimeout(3500)
    const e = await estadoDosVideos(p)
    const capa = await p.evaluate((id) => document.querySelector(`.vista-inicio .grade [data-arte="${id}"] img.pv-real`)?.getAttribute('src') ?? null, COM_VIDEO[0])
    conferir(pedidos.length === 0 && e.every((v) => !v.tocando && !v.src) && /capateste0\.png$/.test(capa ?? ''), `thumb: ${nome} fica parado na capa (${pedidos.length} vídeos pedidos, capa ${capa})`)
    await ctx.close()
  }

  // vídeo que dá erro: o card volta pra foto do produto (a que o dono teria posto, simulada no GET loja) ou, sem foto
  // (o caso da Fanta Ghost Face, que desde 15/10 vem no desenho do site), pra ilustração, sem ficar preso na capa
  for (const comFoto of [true, false]) {
    const fotoDele = comFoto ? `uploads/fototeste0.png` : null
    const { ctx, p } = await abrir({ width: 390, height: 844 }, {}, { falhar: [COM_VIDEO[0]], fotos: comFoto ? [COM_VIDEO[0]] : [] })
    await p.waitForTimeout(3500)
    await irPraGrade(p)
    const voltou = await p
      .waitForFunction(
        ({ id, foto }) => {
          const caixa = document.querySelector(`.vista-inicio .grade [data-arte="${id}"]`)
          if (!caixa || caixa.querySelector('video.pv-video')) return false
          const img = caixa.querySelector('img.pv-real')
          return foto ? !!img && (img.getAttribute('src') ?? '').endsWith(foto) : !!caixa.querySelector('svg.pv-real') && !img
        },
        { id: COM_VIDEO[0], foto: fotoDele },
        { timeout: 12000 },
      )
      .then(() => true, () => false)
    conferir(voltou, `thumb: vídeo com erro volta pra ${fotoDele ? `foto do produto (${fotoDele})` : 'ilustração do produto (o desenho do site)'}, sem ficar preso na capa`)
    await ctx.close()
  }
}
