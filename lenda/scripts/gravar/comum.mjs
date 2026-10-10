/**
 * Peças comuns das gravações: navegador, contexto 9:16 ou 16:9, configurações do jogo e o
 * "toque na tela" desenhado no vídeo (o screencast não mostra o cursor).
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

export const CHROME = process.env.LENDA_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const BASE = process.env.LENDA_BASE || 'http://localhost:4173/'
export const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
export const entre = (a, b) => Math.round(a + Math.random() * (b - a))

export const FORMATOS = {
  vertical: { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, video: { largura: 1080, altura: 1920 } },
  horizontal: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, video: { largura: 1920, altura: 1080 } },
}

export async function abrirNavegador() {
  return chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding'] })
}

const DADOS = JSON.parse(readFileSync(new URL('../../src/data/generated/game-data.json', import.meta.url), 'utf8'))
export const paisNome = (code) => DADOS.countries.find((c) => c.code === code)?.name ?? code
export const clubeNome = (id) => DADOS.clubs.find((c) => c.id === id)?.shortName ?? id
export const tacaNome = (id) => DADOS.trophies.find((t) => t.id === id)?.name ?? id

/** Contexto novo (sem Hall nem carreira salvos) com o som desligado, movimento ligado e a semente fixa. */
export async function novoContexto(browser, formato, { a0, a1, extra = '' } = {}) {
  const f = FORMATOS[formato]
  const ctx = await browser.newContext({ viewport: f.viewport, deviceScaleFactor: f.deviceScaleFactor, isMobile: f.isMobile, hasTouch: f.hasTouch, reducedMotion: 'no-preference', locale: 'pt-BR', colorScheme: 'dark' })
  await ctx.addInitScript(({ a0, a1, extra }) => {
    try {
      localStorage.setItem('lenda:settings', JSON.stringify({ state: { settings: { sound: false, volume: 0.7, skipAnimations: false, reducedMotion: false, lowFx: false, engine: 'auto' } }, version: 1 }))
    } catch {}
    if (a0 != null) {
      // a semente da carreira sai de crypto.getRandomValues(new Uint32Array(2)): fixá-la reproduz a carreira escolhida
      const orig = crypto.getRandomValues.bind(crypto)
      crypto.getRandomValues = (arr) => {
        if (arr instanceof Uint32Array && arr.length === 2) { arr[0] = a0; arr[1] = a1; return arr }
        return orig(arr)
      }
    }
    // "dedo" na tela: um círculo onde o jogador toca/clica (o vídeo não tem cursor)
    addEventListener('pointerdown', (e) => {
      const d = document.createElement('div')
      d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;pointer-events:none;z-index:2147483647;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.85);box-shadow:0 0 18px rgba(255,255,255,.45);transform:scale(.4);opacity:1;transition:transform 420ms cubic-bezier(.2,.8,.2,1),opacity 520ms ease-out`
      document.documentElement.appendChild(d)
      requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.35)'; d.style.opacity = '0' }))
      setTimeout(() => d.remove(), 700)
    }, true)
    if (extra) {
      // no começo do carregamento ainda não há <html>: põe o estilo assim que existir
      const s = document.createElement('style'); s.textContent = extra
      const pôr = () => (document.head || document.documentElement ? (document.head || document.documentElement).appendChild(s) : setTimeout(pôr, 5))
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pôr); else pôr()
    }
  }, { a0: a0 ?? null, a1: a1 ?? null, extra })
  return ctx
}

/** Toque "humano": leva o ponteiro até o alvo, clica e tira o ponteiro de cima (a comemoração pausa com o mouse em cima). */
export async function tocar(page, loc, { espera = 0 } = {}) {
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  const box = await loc.boundingBox()
  if (!box) { await loc.click(); return }
  const x = box.x + box.width * (0.35 + Math.random() * 0.3), y = box.y + box.height * (0.4 + Math.random() * 0.2)
  await page.mouse.move(x, y, { steps: 6 })
  if (espera) await dorme(espera)
  await page.mouse.down(); await dorme(entre(60, 110)); await page.mouse.up()
  await dorme(80)
  await page.mouse.move(2, 2)
}

/** Espera o jogo terminar de carregar (a abertura some e a tela principal aparece). */
export async function esperarJogo(page) {
  await page.waitForSelector('.lx-splash', { state: 'detached', timeout: 60000 }).catch(() => {})
  await page.waitForSelector('main#conteudo, main', { timeout: 60000 })
}

/** Lê o Hall salvo no IndexedDB da página. */
export async function lerHall(page) {
  return page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('lenda')
    rq.onerror = () => res(null)
    rq.onsuccess = () => {
      try {
        const tx = rq.result.transaction('kv', 'readonly')
        const g = tx.objectStore('kv').get('hall')
        g.onsuccess = () => res(g.result ?? null)
        g.onerror = () => res(null)
      } catch { res(null) }
    }
  }))
}
