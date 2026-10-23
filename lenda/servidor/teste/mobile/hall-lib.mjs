// LENDA v3.5 · suíte mobile · Hall das Lendas, desafios e conquistas — utilidades em cima do carreira-lib.mjs.
//
//   import { lancar, abrirH, ver, tocar, achados, salvarRelatorio } from './hall-lib.mjs'
//
// abrirH(browser, aparelho, o): o aparelho do carreira-lib (viewport, DPR, isMobile, hasTouch, UA de verdade) e mais:
//   o.prod = true  → produção: só leitura. Aborta todo POST/PUT/DELETE para /api/ e o e.php (a medição de visitas) — nada
//                    chega ao banco de produção (nem visita de teste nos números do dono);
//   o.hall = [HallEntry] → semeia o IndexedDB 'hall' do aparelho ("Suas carreiras" do Hall);
//   o.ach  = {id: {unlockedAt}} → semeia as conquistas do aparelho.
// ver(d, tela, o): espera, mede (rolagem lateral, alvos < 40 px, texto cortado, campo coberto, fonte < 16 px), relata no
//   console, tira o print <aparelho>_<tela>.png e guarda o achado para o relatório final (achados[]).
import { mkdirSync, writeFileSync } from 'node:fs'
import { APARELHOS, abrir, medir, relatar, print as printBase, sleep, teclado, girar, lento, semLentidao, offline, longasDesde, agora } from './carreira-lib.mjs'
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')

export { APARELHOS, medir, relatar, sleep, teclado, girar, lento, semLentidao, offline, longasDesde, agora }
export const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const PRINTS = process.env.LENDA_PRINTS_HALL ?? '/tmp/claude-0/-home-user-multfiscal-releases/856de241-fe5b-5ff3-9843-1a584641489b/scratchpad/v35-mobile/hall'
mkdirSync(PRINTS, { recursive: true })

/** Chromium com o proxy da máquina (produção e a ESPN das Ligas ao vivo); 127.0.0.1 direto. */
// o Playwright força o loopback pelo proxy (<-loopback>) a não ser que esta variável exista: a pilha local fica direta
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= '1'
export const lancar = () =>
  chromium.launch({
    executablePath: EXE,
    args: ['--autoplay-policy=user-gesture-required'],
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
  })

export async function abrirH(browser, nome, o = {}) {
  const d = await abrir(browser, nome, { lento: o.lento, ajustes: o.ajustes })
  d.bloqueados = []
  if (o.prod) {
    await d.ctx.route('**/api/**', (r) => {
      const q = r.request()
      if (q.method() !== 'GET' || /\/api\/e\.php/.test(q.url())) {
        d.bloqueados.push(`${q.method()} ${q.url().replace(/\?.*/, '')}`)
        return r.abort('blockedbyclient')
      }
      return r.continue()
    })
    // o sendBeacon da medição não passa pelo route em todo caso: bloqueio também pelo CDP
    await d.cdp.send('Network.enable')
    await d.cdp.send('Network.setBlockedURLs', { urls: ['*/api/e.php*'] })
  }
  if (o.hall || o.ach) {
    await d.ctx.addInitScript(
      ({ hall, ach }) => {
        if (localStorage.getItem('teste:semeado')) return
        localStorage.setItem('teste:semeado', '1')
        const req = indexedDB.open('lenda', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => {
          const t = req.result.transaction('kv', 'readwrite')
          if (hall) t.objectStore('kv').put(hall, 'hall')
          if (ach) t.objectStore('kv').put(ach, 'achievements')
        }
      },
      { hall: o.hall ?? null, ach: o.ach ?? null },
    )
  }
  d.prod = !!o.prod
  return d
}

/** Toque de dedo (Playwright tap: touchstart/touchend + o clique sintético, como no celular). */
export async function tocar(page, alvo, o = {}) {
  const loc = typeof alvo === 'string' ? page.locator(alvo).first() : alvo
  await loc.scrollIntoViewIfNeeded({ timeout: o.timeout ?? 8000 }).catch(() => {})
  await loc.tap({ timeout: o.timeout ?? 8000, force: o.force })
  await sleep(o.espera ?? 450)
}

export const achados = []
/** Mede + relata + print. o.raiz: medir só dentro de um seletor (o diálogo); o.inteira: print da página inteira. */
export async function ver(d, tela, o = {}) {
  await sleep(o.espera ?? 600)
  const m = await medir(d.page, { raiz: o.raiz })
  const ach = relatar(`${d.nome} · ${tela}`, m, { fonte: true })
  const f = await printBase(d.page, d.nome, tela, { dir: o.dir ?? PRINTS, inteira: o.inteira })
  achados.push({ aparelho: d.nome, tela, achados: ach, print: f, pequenos: m.pequenos, cortados: m.cortados.filter((c) => !c.reticencias), lateral: m.lateral, fonteCampo: m.fonteCampo, coberto: m.coberto })
  return { m, ach, f }
}
export const print = (d, tela, o = {}) => printBase(d.page, d.nome, tela, { dir: o.dir ?? PRINTS, inteira: o.inteira })

/** Uma observação feita pelo script (comportamento), para o relatório. */
export const notas = []
export function nota(d, tela, ok, texto, extra = {}) {
  const linha = `  ${ok ? 'ok' : '!!'}  ${d?.nome ?? '-'} · ${tela}: ${texto}`
  console.log(linha)
  notas.push({ aparelho: d?.nome ?? null, tela, ok: !!ok, texto, ...extra })
  return !!ok
}

/** Os erros de console/rede do aparelho desde a última chamada (e zera). */
export function errosDe(d, ignorar = /status of 401|ERR_BLOCKED_BY_CLIENT|blockedbyclient|ERR_(FAILED|ABORTED).*e\.php/) {
  const e = [...d.erros, ...d.rede].filter((x) => !ignorar.test(x))
  d.erros.length = 0
  d.rede.length = 0
  return e
}

export function salvarRelatorio(nome) {
  const f = `${PRINTS}/${nome}.json`
  writeFileSync(f, JSON.stringify({ quando: new Date().toISOString(), achados, notas }, null, 1))
  console.log(`relatório: ${f}`)
  return f
}

/** Espera a tela "sossegar": rota certa, sem skeleton de carregamento e fontes prontas. */
export async function esperarTela(page, sel, ms = 30000) {
  await page.waitForSelector(sel, { timeout: ms })
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await sleep(300)
}
