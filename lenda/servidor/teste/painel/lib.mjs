// LENDA · teste do painel: utilidades comuns da semente (semente.mjs) e do teste do navegador (painel.mjs).
// Lê a pilha que o rodar.sh montou ($LENDA_PAINEL_BASE/segredos.env): porta, banco, senha e token do painel (aleatórios,
// só desta rodada, nunca no repositório).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export const BASE = process.env.LENDA_PAINEL_BASE ?? '/tmp/lenda-teste/painel'
export const env = Object.fromEntries(
  readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
export const PORTA = env.PORTA
export const ORIGEM = `http://127.0.0.1:${PORTA}`
export const URL0 = `${ORIGEM}/lenda/`
export const PAINEL = `${URL0}painel/`
export const uuid = () => randomUUID()
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Consulta no banco do teste (root pelo socket). Devolve o texto (colunas separadas por tab). */
export const sql = (q) =>
  execFileSync('mariadb', [`--socket=${env.SOCK}`, '--default-character-set=utf8mb4', '-uroot', '-N', '-B', env.BANCO, '-e', q], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim()
export const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Pedido HTTP de um "jogador" (cada um com o seu IP, pelo X-Forwarded-For que a config de teste aceita). */
export async function pedido(caminho, o = {}) {
  const r = await fetch(`${URL0}${caminho}`, {
    method: o.corpo !== undefined ? 'POST' : 'GET',
    headers: {
      ...(o.corpo !== undefined ? { 'Content-Type': o.texto ? 'text/plain' : 'application/json', Origin: ORIGEM } : {}),
      ...(o.cookie ? { Cookie: o.cookie } : {}),
      ...(o.bearer ? { Authorization: `Bearer ${env.PAINEL_TOKEN}` } : {}),
      'X-Forwarded-For': o.ip ?? '10.99.0.1',
      'User-Agent': o.ua ?? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
    },
    body: o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined,
  })
  const txt = await r.text()
  let json = null
  try {
    json = txt ? JSON.parse(txt) : null
  } catch {}
  return { status: r.status, json, txt, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}

/** admin.php pelo Bearer (como um script). corpo = POST; query = GET. */
export async function admin(corpo, query) {
  const q = new URLSearchParams(query ?? {}).toString()
  return pedido(`api/admin.php${q ? `?${q}` : ''}`, { corpo: corpo ?? undefined, bearer: true, ip: '127.0.0.1' })
}
export async function equipe(corpo, query) {
  const q = new URLSearchParams(query ?? {}).toString()
  return pedido(`api/equipe.php${q ? `?${q}` : ''}`, { corpo: corpo ?? undefined, bearer: true, ip: '127.0.0.1' })
}
/** Confere uma resposta: status esperado, senão erro com o corpo (a semente não segue com dado faltando). */
export function exigir(r, status, oque) {
  const ok = Array.isArray(status) ? status.includes(r.status) : r.status === status
  if (!ok) throw new Error(`${oque}: esperava ${status}, veio ${r.status} ${r.txt.slice(0, 300)}`)
  return r.json
}

// ── resultado dos testes ──
let oks = 0
let falhas = 0
const lista = []
export function ok(c, m) {
  console.log(`${c ? '  ok  ' : '  XX  '}${m}`)
  if (c) oks++
  else {
    falhas++
    lista.push(m)
  }
  return !!c
}
export const resultado = () => ({ oks, falhas, lista })
