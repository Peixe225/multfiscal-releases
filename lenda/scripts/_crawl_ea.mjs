import { ensureProxyEnv } from './lib/http.mjs'
import { crawlAll } from './lib/ea.mjs'
await ensureProxyEnv(import.meta.url)
const all = await crawlAll(console.log)
console.log('total', all.length)
