// LENDA v3 · carga leve: N jogadores simulados ao mesmo tempo (cada um num IP, pelo X-Forwarded-For que a
// config de teste aceita de 127.0.0.1), fazendo o que o jogo faz: medição (view, hb, jogo_inicio, jogo_fim),
// cadastro, partidas com a conta (21 s cada: o servidor só conta a partida de verdade), salvar carreiras (HallEntry
// reais), conquistas, bônus, compartilhar, Hall público com filtros, raridade — e o admin refazendo o Hall no
// meio. Uso: node carga.mjs [N=50]
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { URL0, ORIGEM, env, sql } from './lib.mjs'

const N = Number(process.argv[2] ?? 50)
// HallEntry reais: os dos criativos (se a pasta existir) ou as amostras do repositório (servidor/teste/amostras)
const PASTAS = [process.env.LENDA_CRIATIVOS ?? '', new URL('../amostras', import.meta.url).pathname].filter(Boolean)
const modelos = []
for (const pasta of PASTAS) {
  let nomes = []
  try {
    nomes = readdirSync(pasta).filter((f) => /^v-.*\.json$/.test(f))
  } catch {}
  for (const f of nomes) {
    const j = JSON.parse(readFileSync(`${pasta}/${f}`, 'utf8'))
    const h = j?.hall?.[0] ?? (j?.id && j?.summary ? j : null)
    if (h) modelos.push(h)
  }
  if (modelos.length) break
}
if (!modelos.length) throw new Error('sem HallEntry de exemplo')
const CONQ = ['first_goal', 'first_title', 'king_of_america', 'golden_ball', 'hat_trick', 'centurion', 'captain', 'loyal', 'globetrotter', 'world_champion']
const tempos = {}
const status = {}
const erros = []
const marcar = (rota, ms, st) => {
  ;(tempos[rota] ??= []).push(ms)
  status[`${rota} ${st}`] = (status[`${rota} ${st}`] ?? 0) + 1
}
async function pedido(rota, url, o = {}, ip) {
  const t = performance.now()
  let r
  try {
    r = await fetch(url, {
      method: o.corpo ? 'POST' : 'GET',
      headers: {
        ...(o.corpo ? { 'Content-Type': o.texto ? 'text/plain' : 'application/json', Origin: ORIGEM } : {}),
        ...(o.cookie ? { Cookie: o.cookie } : {}),
        ...(o.auth ? { Authorization: `Bearer ${env.PAINEL_TOKEN}` } : {}),
        'X-Forwarded-For': ip,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
      },
      body: o.corpo ? JSON.stringify(o.corpo) : undefined,
    })
  } catch (e) {
    marcar(rota, performance.now() - t, 'rede')
    erros.push(`${rota}: ${e.message}`)
    return { status: 0 }
  }
  const txt = await r.text()
  const ms = performance.now() - t
  marcar(rota, ms, r.status)
  if (r.status >= 500 || (r.status >= 400 && !o.aceita?.includes(r.status))) erros.push(`${rota} ${r.status} ${txt.slice(0, 160)}`)
  let json = null
  try {
    json = txt ? JSON.parse(txt) : null
  } catch {}
  return { status: r.status, json, setCookie: r.headers.get('set-cookie') }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())))

async function jogador(i) {
  const ip = `10.${50 + (i >> 16)}.${(i >> 8) & 255}.${i & 255}`
  const v = randomUUID()
  const s = randomUUID()
  const ctx = { ref: 'tiktok.com', utm: { source: 'tiktok', medium: 'video', campaign: 'v3' }, dev: 'mobile', lang: 'pt-BR', tela: '390x844' }
  const e = (ev, cookie) => pedido('e.php', `${URL0}api/e.php`, { corpo: { v, s, bot: 0, ctx, ev }, texto: true, cookie }, ip)
  await e([{ t: 'view', m: null, d: { rota: '/' }, ts: Date.now() }, { t: 'hb', p: 0 }])
  await pedido('conta.php GET', `${URL0}api/conta.php`, {}, ip)
  await pedido('hall.php', `${URL0}api/hall.php`, {}, ip)
  // 5 partidas antes da conta
  for (let k = 0; k < 5; k++) {
    await e([{ t: 'jogo_inicio', m: 'classico', d: { ritmo: 'expressa' } }, { t: 'hb', p: 1 }])
    await espera(80)
    await e([{ t: 'jogo_fim', m: 'classico', d: { nota: 40 + k, temporadas: 21, pico: 85 } }, { t: 'hb', p: 1 }])
  }
  await e([{ t: 'gate_ver', m: null, d: { partidas: 5, rota: '/carreira' } }])
  const cad = await pedido('conta.php cadastrar', `${URL0}api/conta.php`, { corpo: { acao: 'cadastrar', apelido: `Carga ${i}`, email: `carga${i}-${Date.now()}@exemplo.com`, senha: 'segredo-123', aceite: true, vid: v, origem: 'tiktok' } }, ip)
  if (cad.status !== 201) return
  const cookie = (cad.setCookie || '').split(';')[0]
  await e([{ t: 'cadastro', m: null }], cookie)
  // conquistas do aparelho sobem
  await pedido('conquistas.php sincronizar', `${URL0}api/conquistas.php`, { corpo: { acao: 'sincronizar', conquistas: CONQ.slice(0, 3 + (i % 7)).map((id) => ({ id, em: '2026-10-14T12:00:00Z' })) }, cookie }, ip)
  // 3 partidas com a conta: carreiras salvas (2 por jogador) e o bônus liberado. Cada carreira leva 21 s (com
  // batimentos): o servidor só conta o fim que chega pelo menos 20 s depois do início, no mesmo aparelho
  for (let k = 0; k < 3; k++) {
    await e([{ t: 'jogo_inicio', m: 'classico', d: { ritmo: 'expressa' } }, { t: 'hb', p: 1 }], cookie)
    for (let w = 0; w < 4; w++) {
      await new Promise((r) => setTimeout(r, 5300))
      await e([{ t: 'hb', p: 1 }], cookie)
    }
    const m = modelos[(i * 3 + k) % modelos.length]
    const h = structuredClone(m)
    h.id = `career-carga${i}x${k}`
    h.career.id = h.id
    // cada jogador com a sua carreira (o servidor trata o mesmo resumo em outra conta como cópia)
    h.summary.cargaId = h.id
    h.runNo = k + 1
    h.legacy = { score: m.legacy?.score ?? 40, raw: m.legacy?.raw ?? 40, at: new Date().toISOString(), v: 2 }
    await e([{ t: 'jogo_fim', m: 'classico', d: { nota: h.legacy.score, temporadas: h.summary.seasons, pico: h.summary.peakOvr } }, { t: 'hb', p: 1 }], cookie)
    if (k < 2) await pedido('carreiras.php salvar', `${URL0}api/carreiras.php`, { corpo: { acao: 'salvar', carreira: h, como: h.summary.peakOvr >= 90 ? 'auto' : 'manual' }, cookie }, ip)
    await pedido('conquistas.php sincronizar', `${URL0}api/conquistas.php`, { corpo: { acao: 'sincronizar', conquistas: [{ id: CONQ[(i + k) % CONQ.length], em: new Date().toISOString() }] }, cookie }, ip)
  }
  await pedido('carreiras.php GET', `${URL0}api/carreiras.php`, { cookie }, ip)
  await pedido('bonus.php GET', `${URL0}api/bonus.php`, { cookie }, ip)
  await pedido('bonus.php compartilhei', `${URL0}api/bonus.php`, { corpo: { acao: 'compartilhei', carreiraId: `career-carga${i}x0` }, cookie }, ip)
  await pedido('bonus.php usar', `${URL0}api/bonus.php`, { corpo: { acao: 'usar', carreiraId: `career-carga${i}x9` }, cookie }, ip)
  await pedido('conquistas.php GET', `${URL0}api/conquistas.php`, { cookie }, ip)
  await pedido('conquistas.php raridade', `${URL0}api/conquistas.php?raridade=1`, {}, ip)
  for (const q of ['', '?pais=BRA', '?clube=e83', '?pais=BRA&clube=e83', '?pagina=2']) await pedido('hall.php', `${URL0}api/hall.php${q}`, {}, ip)
  await pedido('conta.php GET', `${URL0}api/conta.php`, { cookie }, ip)
  for (let k = 0; k < 4; k++) {
    await e([{ t: 'hb', p: 1 }], cookie)
    await espera(50)
  }
}

const t0 = performance.now()
const adminVezes = []
const adm = (async () => {
  // o admin refaz o Hall de tempos em tempos enquanto os jogadores salvam (no meio das carreiras de 21 s)
  for (let k = 0; k < 5; k++) {
    await new Promise((r) => setTimeout(r, 15_000))
    const r = await pedido('admin atualizar_hall', `${URL0}api/admin.php`, { corpo: { acao: 'atualizar_hall' }, auth: true, aceita: [409] }, '127.0.0.1')
    adminVezes.push(r.status)
    await pedido('admin resumo', `${URL0}api/admin.php?r=resumo`, { auth: true }, '127.0.0.1')
    await pedido('admin usuarios', `${URL0}api/admin.php?r=usuarios&ordem=partidas`, { auth: true }, '127.0.0.1')
  }
})()
await Promise.all([...Array.from({ length: N }, (_, i) => jogador(i)), adm])
const total = performance.now() - t0
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))]
console.log(`\n${N} jogadores em ${(total / 1000).toFixed(1)} s · ${Object.values(tempos).reduce((s, a) => s + a.length, 0)} pedidos`)
console.log('rota'.padEnd(30), 'n'.padStart(5), 'p50'.padStart(7), 'p95'.padStart(7), 'máx'.padStart(7), '(ms)')
for (const [rota, a] of Object.entries(tempos).sort()) {
  a.sort((x, y) => x - y)
  console.log(rota.padEnd(30), String(a.length).padStart(5), pct(a, 50).toFixed(0).padStart(7), pct(a, 95).toFixed(0).padStart(7), a[a.length - 1].toFixed(0).padStart(7))
}
console.log('\nstatus:', JSON.stringify(status))
console.log('admin atualizar_hall:', adminVezes.join(','))
const n5xx = Object.entries(status).filter(([k]) => / 5\d\d$| rede$/.test(k)).reduce((s, [, n]) => s + n, 0)
const contas = sql(`SELECT COUNT(*) FROM usuarios WHERE apelido LIKE 'Carga %'`)
const carreiras = sql(`SELECT COUNT(*) FROM carreiras c JOIN usuarios u ON u.id=c.usuario_id WHERE u.apelido LIKE 'Carga %'`)
const liberados = sql(`SELECT COUNT(*) FROM usuarios WHERE apelido LIKE 'Carga %' AND partidas_conta >= 3`)
const compart = sql(`SELECT COUNT(*) FROM bonus b JOIN usuarios u ON u.id=b.usuario_id WHERE u.apelido LIKE 'Carga %' AND b.origem='compartilhar'`)
const conq = sql(`SELECT COUNT(*) FROM conquistas_usuario c JOIN usuarios u ON u.id=c.usuario_id WHERE u.apelido LIKE 'Carga %'`)
console.log(`banco: ${contas} contas, ${carreiras} carreiras, ${liberados} com 3+ partidas na conta, ${compart} bônus de compartilhar, ${conq} conquistas`)
console.log(erros.length ? `erros (${erros.length}):\n  ${erros.slice(0, 20).join('\n  ')}` : 'erros: nenhum')
const okCarga = n5xx === 0 && erros.length === 0 && Number(contas) === N && Number(carreiras) === 2 * N && Number(liberados) === N && Number(compart) === N
console.log(okCarga ? 'CARGA: PASSOU' : 'CARGA: FALHOU')
process.exit(okCarga ? 0 : 1)
