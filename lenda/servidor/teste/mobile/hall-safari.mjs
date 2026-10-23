// LENDA v3.5 · suíte mobile · o que o Safari antigo do iPhone NÃO entende, simulado no Chromium (não há WebKit aqui).
// Cada cenário injeta o CSS que o Safari daquela versão ignora (a declaração inválida cai fora inteira) e mede/fotografa:
//
//   ios16.1  → sem color-mix() (chegou no Safari 16.2): o fundo dos emblemas (.lx-emblema) some
//   ios15    → sem overflow: clip (Safari 16): o .lx-app deixa de cortar o que vaza para os lados
//   ios15.3  → sem dvh (Safari 15.4): o diálogo/sheet fica sem max-height (cresce além da tela)
//   notch    → iPhone deitado com viewport-fit=cover: área do entalhe (safe-area 47 px dos lados), pelo CDP
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/hall-safari.mjs
import { existsSync, readFileSync } from 'node:fs'
import { abrirH, lancar, nota, print, salvarRelatorio, sleep, tocar, ver } from './hall-lib.mjs'

const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-hall'
const env = Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const URL0 = process.env.LENDA_URL ?? `http://127.0.0.1:${env.PORTA}/lenda/`
const SEM = existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const browser = await lancar()
const CSS = {
  'ios16.1': '.lx-emblema{background:none!important;box-shadow:none!important}',
  ios15: '.lx-app{overflow-x:visible!important}',
  'ios15.3': '.lx-sheet,.lx-dialog,.sc-modal.lx-sheet{max-height:none!important}',
}
async function comCss(d, css) {
  await d.ctx.addInitScript((css) => {
    const s = document.createElement('style')
    s.dataset.simulaSafari = '1'
    s.textContent = css
    const pôr = () => (document.head ? document.head.appendChild(s) : setTimeout(pôr, 5))
    pôr()
    // o CSS dos chunks entra depois: mantém este por último
    new MutationObserver(() => document.head && document.head.lastElementChild !== s && document.head.appendChild(s)).observe(document.documentElement, { childList: true, subtree: true })
  }, css)
}
const lateral = (d) => d.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)

// ── iOS 16.0/16.1: emblemas sem fundo ──
{
  const d = await abrirH(browser, 'iphone-se', { hall: SEM?.entradas })
  await comCss(d, CSS['ios16.1'])
  d.nome = 'iphone-se-ios16.1-simulado'
  await d.page.goto(`${URL0}#/`)
  await d.page.waitForSelector('.s4-faixa', { timeout: 20000 }).catch(() => {})
  await d.page.evaluate(() => document.querySelector('.s4-faixa')?.scrollIntoView({ block: 'center' }))
  await sleep(600)
  await print(d, 'home-faixa-emblemas-sem-color-mix')
  if (SEM) {
    await d.page.goto(`${URL0}?c=${SEM.codigo}#/jogador/${SEM.codigo}`)
    await d.page.waitForSelector('.lx-emblema', { timeout: 20000 }).catch(() => {})
    await d.page.evaluate(() => document.querySelector('.lx-emblema')?.scrollIntoView({ block: 'center' }))
    await sleep(600)
    await print(d, 'perfil-emblemas-sem-color-mix')
  }
  const cont = await d.page.evaluate(() => {
    const e = document.querySelector('.lx-emblema')
    if (!e) return null
    const cs = getComputedStyle(e)
    return { fundo: cs.backgroundImage.slice(0, 30), cor: cs.color }
  })
  nota(d, 'emblema', false, `com o color-mix ignorado (Safari ≤ 16.1), o emblema fica sem fundo: background-image ${cont?.fundo}, ícone ${cont?.cor} (quase preto) sobre a página escura`)
  await d.ctx.close()
}

// ── iOS 15: sem overflow: clip ──
{
  const d = await abrirH(browser, 'iphone-se', { hall: SEM?.entradas })
  await comCss(d, CSS.ios15)
  d.nome = 'iphone-se-ios15-simulado'
  for (const [h, sel] of [['#/', '.ld-modes'], ['#/hall', '.hl-row.is-legend'], ['#/desafios', '.s4-emb'], ['#/creditos', '.cr-wrap'], ['#/ligas', '.lv-wrap'], [SEM ? `?c=${SEM.codigo}#/jogador/${SEM.codigo}` : '#/', 'main#conteudo:not([aria-busy="true"])']]) {
    await d.page.goto(`${URL0}${h}`)
    await d.page.waitForSelector(sel, { timeout: 30000 }).catch(() => {})
    await sleep(2500)
    const l = await lateral(d)
    const quem = l > 0 ? await d.page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 2).join('.')} →${Math.round(e.getBoundingClientRect().right)}`)) : []
    nota(d, `sem-overflow-clip ${h}`, l <= 0, `sem o overflow: clip (Safari 15): rolagem lateral de ${l}px${quem.length ? ` (vaza: ${quem.join(', ')})` : ''}`)
    if (l > 0) {
      await d.page.evaluate((x) => scrollTo(x, scrollY), l)
      await sleep(300)
      await print(d, `rolagem-lateral-${h.replace(/[^a-z]+/g, '-')}`)
    }
  }
  await d.ctx.close()
}

// ── iOS 15.0–15.3: sem dvh (o diálogo cresce) ──
{
  const d = await abrirH(browser, 'iphone-se', { hall: SEM?.entradas })
  await comCss(d, CSS['ios15.3'])
  d.nome = 'iphone-se-ios15.3-simulado'
  await d.page.goto(`${URL0}#/`)
  await d.page.waitForSelector('.ld-modes', { timeout: 30000 })
  await sleep(1500)
  await tocar(d.page, d.page.locator('.ld-medal, button[aria-label^="Ver conquistas"]').first(), { espera: 1500 })
  const dl = await d.page.evaluate(() => {
    const p = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].pop()
    const f = p?.querySelector('button[aria-label="Fechar"]')?.getBoundingClientRect()
    const r = p?.getBoundingClientRect()
    return p ? { top: Math.round(r.top), h: Math.round(r.height), fecharTop: Math.round(f?.top ?? -1), janela: innerHeight } : null
  })
  nota(d, 'conquistas-sem-dvh', dl && dl.top >= 0, `sem dvh (Safari 15.0–15.3) o diálogo das conquistas tem ${dl?.h}px numa janela de ${dl?.janela}px: começa em y=${dl?.top} e o botão Fechar fica em y=${dl?.fecharTop} (${dl && dl.fecharTop < 0 ? 'FORA da tela, inalcançável' : 'à vista'})`, { dl })
  await print(d, 'conquistas-sem-dvh')
  await d.ctx.close()
}

// ── iPhone deitado: entalhe (safe-area) ──
{
  const d = await abrirH(browser, 'deitado', { hall: SEM?.entradas })
  d.nome = 'deitado-entalhe'
  let ok = true
  try {
    await d.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } })
  } catch (e) {
    ok = false
    nota(d, 'safe-area', true, `o Chromium daqui não emula safe-area (${e.message.slice(0, 60)}); só a revisão do código vale`)
  }
  if (ok) {
    for (const [h, sel, t] of [['#/hall', '.hl-row.is-legend', 'hall'], ['#/desafios', '.s4-emb', 'desafios']]) {
      await d.page.goto(`${URL0}${h}`)
      await d.page.waitForSelector(sel, { timeout: 30000 }).catch(() => {})
      await sleep(1200)
      // desenha a área do entalhe (47 px de cada lado) para o print
      const dentro = await d.page.evaluate(() => {
        const o = document.createElement('div')
        o.style.cssText = 'position:fixed;inset:0 auto 0 0;width:47px;background:rgba(255,0,80,.35);z-index:99999;pointer-events:none'
        document.body.appendChild(o)
        const sl = getComputedStyle(document.documentElement).getPropertyValue('--x') // nada
        return [...document.querySelectorAll('.lx-topbar a, .lx-topbar button, main h1, .hl-filtros, .hl-row')].slice(0, 12).filter((e) => e.getBoundingClientRect().left < 47).map((e) => `${e.tagName.toLowerCase()}.${e.classList[0] ?? ''} x=${Math.round(e.getBoundingClientRect().left)}`)
      })
      nota(d, `entalhe ${t}`, !dentro.length, dentro.length ? `com 47 px de entalhe à esquerda, ficam embaixo dele: ${dentro.join(', ')}` : 'nada embaixo do entalhe')
      await print(d, `${t}-com-entalhe`)
    }
  }
  await d.ctx.close()
}
salvarRelatorio('relatorio-safari-simulado')
await browser.close()
