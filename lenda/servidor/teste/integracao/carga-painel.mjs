// LENDA v3.2 · carga com o painel aberto: N jogadores ao mesmo tempo (carga.mjs) enquanto um navegador fica com o painel
// do admin aberto, pulsando (o pulso de 15 s de verdade e mais um a cada 2 s, como várias abas abertas), e passeia pelas
// abas. Confere: nenhum 5xx nem no jogo nem no painel; a carga passa; o pulso responde rápido durante a carga; e quanto
// cada pulso custa no banco (consultas e linhas lidas, pelo SHOW GLOBAL STATUS do MariaDB, com só o painel aberto, antes e
// depois da carga — o custo não cresce com os dados).
// Uso (na pilha do subir.sh, depois do e2e ou não): node carga-painel.mjs [N=50]. O PIN da conta Dono vem do estado.json
// do e2e (pinDono); sem e2e antes, entra só com a senha do arquivo.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { lancar, sql, env, URL0, BASE, sleep, PRINTS } from './lib.mjs'

const N = Number(process.argv[2] ?? 50)
let pin = null
try {
  pin = JSON.parse(readFileSync(`${BASE}/estado.json`, 'utf8')).pinDono ?? null
} catch {}
const LIMITE_PULSO_P95_MS = Number(process.env.LENDA_PULSO_P95_MS ?? 800)
const LIMITE_CONSULTAS = Number(process.env.LENDA_PULSO_CONSULTAS ?? 25)
let falhas = 0
const ok = (c, m) => {
  console.log(`${c ? '  ok  ' : '  XX  '}${m}`)
  if (!c) falhas++
  return c
}

const browser = await lancar()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const page = await ctx.newPage()
const respostas = []
const errosJs = []
page.on('response', (r) => {
  if (r.url().includes('/api/')) respostas.push({ url: r.url(), status: r.status(), quando: Date.now(), dur: r.request().timing().responseEnd })
})
page.on('pageerror', (e) => errosJs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errosJs.push(m.text())
})
page.on('dialog', (d) => d.accept())
await page.goto(`${URL0}painel/`)
await page.waitForSelector('#form-entrar:not([hidden]), #tela-painel:not([hidden])', { timeout: 20000 })
await page.fill('#senha', env.PAINEL_SENHA)
await page.click('#botao-entrar')
await page.waitForSelector('#form-pin:not([hidden]), #tela-painel:not([hidden])', { timeout: 15000 })
if (await page.isVisible('#form-pin')) {
  if (!pin) throw new Error('a conta Dono pede PIN e o estado.json do e2e não tem o pinDono')
  await page.locator('#pin-caixas .pin-caixa').first().click()
  await page.keyboard.type(pin, { delay: 30 })
}
await page.waitForSelector('#tela-painel:not([hidden])', { timeout: 15000 })
console.log(`· painel aberto (${URL0}painel/)`)
await sleep(4000)

// ── custo de um pulso no banco (só o painel aberto) ──
const status = () =>
  Object.fromEntries(
    sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Questions', 'Rows_read', 'Handler_read_rnd_next')")
      .split('\n')
      .map((l) => l.split('\t'))
      .map(([k, v]) => [k, Number(v)]),
  )
const custoPulso = async (vezes = 20) => {
  const a = status()
  const b = status()
  const extra = { q: b.Questions - a.Questions, r: b.Rows_read - a.Rows_read, s: b.Handler_read_rnd_next - a.Handler_read_rnd_next }
  const c = status()
  const ms = await page.evaluate(async (n) => {
    const t = []
    for (let i = 0; i < n; i++) {
      const t0 = performance.now()
      const r = await fetch('../api/painel.php?so=agora', { credentials: 'same-origin', cache: 'no-store' })
      await r.json()
      t.push(performance.now() - t0)
    }
    return t
  }, vezes)
  const d = status()
  return {
    consultas: (d.Questions - c.Questions - extra.q) / vezes,
    linhas: (d.Rows_read - c.Rows_read - extra.r) / vezes,
    varreduras: (d.Handler_read_rnd_next - c.Handler_read_rnd_next - extra.s) / vezes,
    msMediana: ms.sort((x, y) => x - y)[Math.floor(ms.length / 2)],
  }
}
const contas0 = sql('SELECT COUNT(*) FROM usuarios')
const antes = await custoPulso()
console.log(`· pulso antes da carga (${contas0} contas): ${antes.consultas.toFixed(1)} consultas, ${antes.linhas.toFixed(0)} linhas lidas, ${antes.varreduras.toFixed(0)} linhas varridas, ${antes.msMediana.toFixed(0)} ms (mediana)`)

// ── a carga, com o painel aberto ──
const t0 = Date.now()
const filho = spawn(process.execPath, [new URL('./carga.mjs', import.meta.url).pathname, String(N)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let saidaCarga = ''
filho.stdout.on('data', (d) => (saidaCarga += d))
filho.stderr.on('data', (d) => (saidaCarga += d))
const fim = new Promise((r) => filho.on('close', r))
let acabou = false
fim.then(() => (acabou = true))
// várias abas abertas: um pulso a cada 2 s (além do de 15 s do próprio painel)
const extras = page.evaluate(async () => {
  const t = []
  const st = []
  while (!window.__pararPulso) {
    const t0 = performance.now()
    try {
      const r = await fetch('../api/painel.php?so=agora', { credentials: 'same-origin', cache: 'no-store' })
      st.push(r.status)
      await r.text()
    } catch {
      st.push(0)
    }
    t.push(performance.now() - t0)
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { t, st }
})
// o admin passeia pelas abas enquanto os jogadores jogam
const ABAS = ['visao', 'area', 'usuarios', 'hall', 'denuncias', 'indicacoes', 'relatorios', 'tempo', 'registro', 'visao']
let k = 0
while (!acabou) {
  await page.evaluate((a) => {
    location.hash = '#/' + a
  }, ABAS[k++ % ABAS.length])
  await Promise.race([sleep(8000), fim])
  if (k === 4 && PRINTS) await page.screenshot({ path: `${PRINTS}/v32-carga-painel-na-area.png` }).catch(() => {})
}
const codigo = await fim
await page.evaluate(() => {
  window.__pararPulso = true
})
const ex = await extras
const durCarga = (Date.now() - t0) / 1000
console.log(saidaCarga.trim().split('\n').map((l) => '    ' + l).join('\n'))
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length * p) / 100))]
const pulsos = respostas.filter((r) => r.url.includes('so=agora') && r.quando >= t0)
ok(codigo === 0, `carga de ${N} jogadores com o painel aberto: ${codigo === 0 ? 'passou' : 'falhou'} (${durCarga.toFixed(0)} s)`)
const r5 = respostas.filter((r) => r.status >= 500)
ok(r5.length === 0 && !ex.st.some((s) => s >= 500 || s === 0), `painel: nenhum 5xx em ${respostas.length + ex.st.length} pedidos à API${r5.length ? ` (${r5.slice(0, 5).map((r) => r.status + ' ' + r.url).join(', ')})` : ''}`)
ok(ex.st.every((s) => s === 200) && pulsos.every((p) => p.status === 200), `pulso: ${ex.st.length + pulsos.length} pulsos durante a carga, todos 200`)
const p95 = pct(ex.t, 95)
ok(p95 <= LIMITE_PULSO_P95_MS, `pulso durante a carga: mediana ${pct(ex.t, 50).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, máx ${Math.max(...ex.t).toFixed(0)} ms (limite p95 ${LIMITE_PULSO_P95_MS} ms)`)
await sleep(1500)
const contas1 = sql('SELECT COUNT(*) FROM usuarios')
const depois = await custoPulso()
console.log(`· pulso depois da carga (${contas1} contas): ${depois.consultas.toFixed(1)} consultas, ${depois.linhas.toFixed(0)} linhas lidas, ${depois.varreduras.toFixed(0)} linhas varridas, ${depois.msMediana.toFixed(0)} ms (mediana)`)
ok(depois.consultas <= LIMITE_CONSULTAS && antes.consultas <= LIMITE_CONSULTAS, `pulso leve: até ${LIMITE_CONSULTAS} consultas por pulso (${antes.consultas.toFixed(1)} → ${depois.consultas.toFixed(1)})`)
// Com tabelas pequenas o banco prefere ler tudo (é mais barato): o que importa é o custo com tabelas grandes. O banco de
// teste ganha 30 mil visitas antigas e 100 cópias de cada carreira (sem suspeita): o pulso tem de continuar lendo pouco.
if (process.env.LENDA_CARGA_ENCHER !== '0') {
  const cols = sql(`SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'carreiras' AND COLUMN_NAME NOT IN ('id', 'carreira_id', 'suspeita')`)
  sql(`INSERT INTO carreiras (${cols}, carreira_id, suspeita) SELECT ${cols}, CONCAT(carreira_id, '-encher-', s.seq), NULL FROM carreiras c JOIN seq_1_to_100 s WHERE c.carreira_id NOT LIKE '%-encher-%'`)
  sql(`INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, origem, bot) SELECT UUID(), UUID(), NULL, UTC_TIMESTAMP() - INTERVAL 2 DAY, UTC_TIMESTAMP() - INTERVAL 2 DAY, 60, 'direto', 0 FROM seq_1_to_30000`)
  sql('ANALYZE TABLE carreiras, visitas')
  const nc = Number(sql('SELECT COUNT(*) FROM carreiras'))
  const nv = Number(sql('SELECT COUNT(*) FROM visitas'))
  const cheio = await custoPulso()
  console.log(`· pulso com o banco cheio (${nc} carreiras, ${nv} visitas): ${cheio.consultas.toFixed(1)} consultas, ${cheio.linhas.toFixed(0)} linhas lidas, ${cheio.varreduras.toFixed(0)} linhas varridas, ${cheio.msMediana.toFixed(0)} ms (mediana)`)
  const teto = Math.max(400, Number(sql("SELECT COUNT(*) FROM carreiras WHERE suspeita IS NOT NULL")) * 4)
  ok(cheio.linhas <= teto && cheio.varreduras <= 100, `pulso pelos índices com ${nc} carreiras e ${nv} visitas: ${cheio.linhas.toFixed(0)} linhas lidas (teto ${teto}) e ${cheio.varreduras.toFixed(0)} varridas por pulso`)
  ok(cheio.msMediana <= 100, `pulso com o banco cheio: ${cheio.msMediana.toFixed(0)} ms (mediana)`)
}
ok(errosJs.length === 0, `painel sem erro de JavaScript${errosJs.length ? `: ${errosJs.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
console.log(falhas ? `CARGA + PAINEL: FALHOU (${falhas})` : 'CARGA + PAINEL: PASSOU')
process.exit(falhas ? 1 : 0)
