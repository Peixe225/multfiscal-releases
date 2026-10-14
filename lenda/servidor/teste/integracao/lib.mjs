// LENDA v3 · integração: utilidades dos testes de navegador (aparelhos, jogar uma carreira pela tela, SQL, admin).
const { chromium } = await import(process.env.LENDA_PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'

export const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-integracao'
export const PRINTS = process.env.LENDA_PRINTS ?? `${BASE}/prints`
mkdirSync(PRINTS, { recursive: true })
export const env = Object.fromEntries(
  readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
export const PORTA = env.PORTA || '8752'
export const ORIGEM = `http://127.0.0.1:${PORTA}`
export const URL0 = `${ORIGEM}/lenda/`
export const EXE = process.env.LENDA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const sql = (q) =>
  execFileSync('mariadb', ['--socket=/run/mysqld/mysqld.sock', '--default-character-set=utf8mb4', '-uroot', '-N', '-B', env.BANCO || 'lenda_integracao', '-e', q], {
    encoding: 'utf8',
  }).trim()

let falhas = 0
let oks = 0
const lista = []
export function ok(c, m) {
  const linha = `${c ? '  ok  ' : '  XX  '}${m}`
  console.log(linha)
  if (c) oks++
  else {
    falhas++
    lista.push(m)
  }
  return !!c
}
export const resultado = () => ({ oks, falhas, lista })

/** admin.php pelo Bearer (scripts). */
export async function admin(corpo, query) {
  const u = new URL(`${URL0}api/admin.php`)
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, String(v))
  const r = await fetch(u, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.PAINEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const txt = await r.text()
  let json = null
  try {
    json = JSON.parse(txt)
  } catch {}
  return { status: r.status, json, txt }
}

export const AJUSTES = JSON.stringify({
  state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: true, engine: 'auto' } },
  version: 1,
})

/**
 * Um "aparelho": contexto novo do navegador (localStorage/IndexedDB/cookies próprios).
 * o.partidas: contador de partidas do aparelho; o.hall/o.ach: semeia o IndexedDB; o.semente: sementes de carreira
 * (fila; cada "Confirmar identidade" consome uma); o.share: navigator.share de mentira (resolve).
 */
export async function aparelho(browser, nome, o = {}) {
  const ctx = await browser.newContext({
    viewport: o.viewport ?? { width: 1366, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
    isMobile: !!o.celular,
    hasTouch: !!o.celular,
    // "pessoa de verdade" para a medição (o painel esconde robôs por padrão): UA comum e sem navigator.webdriver
    userAgent: o.celular
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  })
  await ctx.addInitScript(
    ({ a, partidas, hall, ach, share }) => {
      try {
        if (!localStorage.getItem('lenda:settings')) localStorage.setItem('lenda:settings', a)
        if (partidas != null && !localStorage.getItem('lenda:partidas')) localStorage.setItem('lenda:partidas', String(partidas))
      } catch {}
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true })
      } catch {}
      // semente de carreira fixa (o randomSeed do jogo: Uint32Array(2)) quando o teste pede
      const orig = crypto.getRandomValues.bind(crypto)
      crypto.getRandomValues = (arr) => {
        try {
          const fila = JSON.parse(sessionStorage.getItem('teste:sementes') || '[]')
          if (arr instanceof Uint32Array && arr.length === 2 && fila.length && sessionStorage.getItem('teste:armado') === '1') {
            const [x, y] = fila.shift()
            sessionStorage.setItem('teste:sementes', JSON.stringify(fila))
            sessionStorage.removeItem('teste:armado')
            arr[0] = x
            arr[1] = y
            return arr
          }
        } catch {}
        return orig(arr)
      }
      if (share) {
        Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
        Object.defineProperty(navigator, 'share', {
          value: async (d) => {
            window.__compartilhado = (window.__compartilhado || 0) + 1
            window.__textoCompartilhado = d?.text ?? ''
          },
          configurable: true,
        })
      }
      if (!hall && !ach) return
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
    { a: AJUSTES, partidas: o.partidas ?? null, hall: o.hall ?? null, ach: o.ach ?? null, share: !!o.share },
  )
  const page = await ctx.newPage()
  const erros = []
  const respostas5xx = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/status of 401/.test(t)) return // painel.php?so=eu responde 401 para quem não é admin (esperado)
    if (o.ignorarConsole && o.ignorarConsole.test(t)) return
    erros.push(`[${nome}] ${t}`)
  })
  page.on('pageerror', (e) => erros.push(`[${nome}] ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) respostas5xx.push(`${r.status()} ${r.url()}`)
  })
  return { ctx, page, erros, respostas5xx, nome }
}

export const lancar = () => chromium.launch({ executablePath: EXE })

/** IndexedDB do jogo: lê uma chave do store kv. */
export const lerKv = (page, chave) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const r = indexedDB.open('lenda', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('kv')
        r.onsuccess = () => {
          const g = r.result.transaction('kv').objectStore('kv').get(k)
          g.onsuccess = () => res(g.result ?? null)
          g.onerror = () => res(null)
        }
      }),
    chave,
  )

/**
 * Joga uma carreira do Clássico pela tela (ritmo Expresso), escolhendo sempre a 1ª opção liberada, até o card
 * de fim ("Jogar novamente"). o.semente = [x, y] fixa a semente. o.nacao = texto da busca de país.
 * Devolve { ms, fim } (fim = apareceu o card de fim). Não clica em "Jogar novamente".
 */
export async function jogarCarreira(page, o = {}) {
  if (o.semente) {
    await page.evaluate((s) => {
      sessionStorage.setItem('teste:sementes', JSON.stringify([s]))
    }, o.semente)
  }
  await page.goto(`${URL0}#/identidade?ritmo=${o.ritmo ?? 'expressa'}`)
  await page.waitForSelector('#id-surname', { timeout: 60000 })
  const sobrenome = o.sobrenome ?? 'TESTE'
  // o sobrenome confere antes de seguir: com a máquina carregada, o texto do fill pode cair fora do campo logo
  // depois de a tela abrir (o formulário já vem com o sobrenome da carreira anterior e ela sairia com o nome errado)
  const conferirSobrenome = async () => {
    for (let i = 0; i < 4 && (await page.inputValue('#id-surname')) !== sobrenome; i++) {
      if (i > 0) console.log(`  ..  sobrenome não ficou no campo; preenchendo de novo (${sobrenome})`)
      await page.fill('#id-surname', sobrenome)
      await sleep(150)
    }
    const v = await page.inputValue('#id-surname')
    if (v !== sobrenome) throw new Error(`sobrenome no campo: "${v}" (esperado "${sobrenome}")`)
  }
  await conferirSobrenome()
  const busca = page.getByPlaceholder('Buscar país')
  await busca.fill(o.nacao ?? 'Brasil')
  await busca.press('Enter')
  const radios = page.locator('[role="radiogroup"][aria-label="Posição em campo"] [role="radio"]')
  await (o.posicao == null || o.posicao === 'ultima' ? radios.last() : radios.nth(o.posicao)).click()
  await sleep(300)
  await conferirSobrenome()
  if (o.antesDeConfirmar) await o.antesDeConfirmar(page)
  if (o.semente) await page.evaluate(() => sessionStorage.setItem('teste:armado', '1'))
  await page.getByRole('button', { name: /Confirmar identidade/ }).click()
  await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 30000 })
  await page.evaluate(() => sessionStorage.removeItem('teste:armado'))
  if (o.aoComecar) await o.aoComecar(page)
  const t0 = Date.now()
  let fim = false
  while (Date.now() - t0 < (o.limiteMs ?? 600_000)) {
    if (await page.locator('.ck-end').count()) {
      if ((await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) > 0) {
        fim = true
        break
      }
    }
    const opt = page.locator('.ck-opt:not(.is-locked):not([disabled])').first()
    const pen = page.locator('.ck-pen__goal button:not([disabled])').first()
    const pular = page.getByRole('button', { name: /^Pular/ })
    try {
      if (await opt.count()) await opt.click({ timeout: 3000 })
      else if (await pen.count()) await pen.click({ timeout: 3000 })
      else if (await pular.count()) await pular.first().click({ timeout: 3000 })
      else {
        const dlg = page.locator('[role="dialog"]:not(.sc-modal)')
        if (await dlg.count()) {
          const b = dlg.locator('button').filter({ hasText: /Continuar|Fechar|Seguir|OK|Avançar/ }).first()
          if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {})
          else await page.keyboard.press('Escape')
        }
      }
    } catch {}
    await sleep(120)
  }
  return { ms: Date.now() - t0, fim }
}

/** A carreira que acabou de terminar (a última do Hall do aparelho ou o lastFinished). */
export async function ultimaTerminada(page) {
  const hall = (await lerKv(page, 'hall')) ?? []
  const ord = [...hall].sort((a, b) => String(b.finishedAt ?? '').localeCompare(String(a.finishedAt ?? '')))
  return ord[0] ?? null
}

/** Espera uma condição SQL ficar verdadeira (texto igual) ou o tempo acabar; devolve o último valor. */
export async function esperarSql(q, cond, ms = 20000) {
  const t0 = Date.now()
  let v = ''
  while (Date.now() - t0 < ms) {
    v = sql(q)
    if (cond(v)) return v
    await sleep(400)
  }
  return v
}
