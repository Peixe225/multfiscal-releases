// HTTP com cache em disco (scripts/.cache). Re-execuções são rápidas e funcionam offline.
//
//   getJson(url, { ttl, ua })   → objeto (ou null em 4xx/erro permanente)
//   getBuffer(url, { ttl })     → Buffer (ou null)
//
// A política padrão é "cache para sempre" (o snapshot é de uma data fixa). Rode com
// `--refresh` (ou REFRESH=1) para ignorar o cache de respostas da ESPN.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = path.resolve(HERE, '..', '.cache')
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const REFRESH = process.argv.includes('--refresh') || process.env.REFRESH === '1'
const OFFLINE = process.argv.includes('--offline') || process.env.OFFLINE === '1'

let stats = { hit: 0, miss: 0, fail: 0 }
export const httpStats = () => ({ ...stats })

function keyFor(url) {
  const u = new URL(url)
  const h = createHash('sha1').update(url).digest('hex').slice(0, 12)
  const slug = (u.hostname.split('.')[0] + u.pathname + u.search)
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(-90)
  return `${slug}_${h}`
}

async function cached(url, ext, { ttl = Infinity, group = 'misc' } = {}) {
  const dir = path.join(CACHE_DIR, group)
  const file = path.join(dir, keyFor(url) + ext)
  if (existsSync(file)) {
    const age = (Date.now() - (await stat(file)).mtimeMs) / 1000
    if (OFFLINE || (!REFRESH && age < ttl)) {
      stats.hit++
      return { file, data: await readFile(file) }
    }
  }
  const missFile = file + '.404'
  if (existsSync(missFile) && !REFRESH) {
    stats.hit++
    return { file, data: null }
  }
  if (OFFLINE) return { file, data: null }
  return { file, data: undefined, dir, missFile }
}

// fila simples para limitar concorrência
const MAX = Number(process.env.HTTP_CONCURRENCY || 8)
let active = 0
const queue = []
function slot() {
  return new Promise((res) => {
    const go = () => {
      active++
      res(() => {
        active--
        const n = queue.shift()
        if (n) n()
      })
    }
    if (active < MAX) go()
    else queue.push(go)
  })
}

async function download(url, { ua, retries = 3 } = {}) {
  const release = await slot()
  try {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, {
          // A ESPN (Akamai) bloqueia UA de navegador "falso"; o fut.gg exige um. Por isso o UA é opcional.
          headers: ua ? { 'user-agent': ua, accept: 'application/json, */*' } : {},
          signal: AbortSignal.timeout(45000),
        })
        if (res.status === 404 || res.status === 400 || res.status === 410) return { status: res.status, body: null }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { status: res.status, body: Buffer.from(await res.arrayBuffer()) }
      } catch (e) {
        if (i === retries) throw e
        await new Promise((r) => setTimeout(r, 800 * (i + 1)))
      }
    }
  } finally {
    release()
  }
}

export async function getBuffer(url, opts = {}) {
  const c = await cached(url, opts.ext || '.bin', opts)
  if (c.data !== undefined) return c.data
  stats.miss++
  try {
    const { body } = await download(url, opts)
    await mkdir(c.dir, { recursive: true })
    if (!body) {
      await writeFile(c.missFile, '')
      return null
    }
    await writeFile(c.file, body)
    return body
  } catch (e) {
    stats.fail++
    console.warn(`  ! falha ${url}: ${e.message}`)
    return null
  }
}

export async function getJson(url, opts = {}) {
  const buf = await getBuffer(url, { ext: '.json', ...opts })
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

/** Mapeia com concorrência limitada preservando a ordem. */
export async function pmap(items, fn, conc = 8) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k], k)
    }
  })
  await Promise.all(workers)
  return out
}

/** Garante NODE_USE_ENV_PROXY=1 quando há proxy (o fetch do Node só usa o proxy com essa flag). */
export async function ensureProxyEnv(scriptUrl) {
  const hasProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY
  if (!hasProxy || process.env.NODE_USE_ENV_PROXY === '1') return false
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [fileURLToPath(scriptUrl), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' },
  })
  process.exit(r.status ?? 1)
}
