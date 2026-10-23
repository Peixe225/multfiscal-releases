// LENDA v3.5 · suíte mobile · a visita de quem chega ao Hall / perfil público / desafios pelo navegador de dentro do
// TikTok, do Instagram e do WhatsApp conta como PESSOA (não robô) e com o aparelho e a origem certos. Só na pilha LOCAL
// (lê a tabela visitas do banco do teste).
// (ferramenta, fora da suíte: o primeira-impressao.mjs --etapas=medicao faz o mesmo e ainda confere o painel)
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/ferramentas/hall-medicao.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { APARELHOS, abrirH, lancar, nota, salvarRelatorio, sleep } from '../hall-lib.mjs'

const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-hall'
const env = Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const URL0 = `http://127.0.0.1:${env.PORTA}/lenda/`
const SEM = existsSync(`${BASE}/hall-semente.json`) ? JSON.parse(readFileSync(`${BASE}/hall-semente.json`, 'utf8')) : null
const sql = (q) => execFileSync('mariadb', [`--socket=${env.SOCK}`, '--default-character-set=utf8mb4', '-uroot', '-N', '-B', env.BANCO, '-e', q], { encoding: 'utf8' }).trim()
// a regra do servidor (servidor/api/e.php, ROBO_UA), para dizer POR QUE caiu como robô
const ROBO_UA = /bot|crawl|spider|preview|headless|facebookexternalhit|slurp|curl|wget|python/i

const ENTRADAS = [
  // [aparelho, caminho, origem esperada]
  ['tiktok-android', `?utm_source=tiktok#/hall`, 'tiktok'],
  ['tiktok-ios', `?utm_source=tiktok#/desafios`, 'tiktok'],
  ['instagram-android', SEM ? `?c=${SEM.codigo}&utm_source=instagram#/jogador/${SEM.codigo}` : '#/hall', 'instagram'],
  ['instagram-ios', `#/hall`, null],
  ['whatsapp-android', SEM ? `?c=${SEM.codigo}#/jogador/${SEM.codigo}` : '#/hall', null],
]
const browser = await lancar()
for (const [nome, caminho, origem] of ENTRADAS) {
  const ua = APARELHOS[nome].ua
  nota({ nome }, 'ua', !ROBO_UA.test(ua), `UA do ${nome} ${ROBO_UA.test(ua) ? `CASA com o ROBO_UA do e.php ("${ua.match(ROBO_UA)[0]}")` : 'não casa com o ROBO_UA do e.php'}`)
  const d = await abrirH(browser, nome, {})
  await d.page.goto(`${URL0}${caminho}`, { waitUntil: 'domcontentloaded' })
  await d.page.waitForSelector('main#conteudo', { timeout: 40000 })
  await sleep(1500)
  const vid = await d.page.evaluate(() => localStorage.getItem('lenda:vid'))
  const bot = await d.page.evaluate(() => navigator.webdriver)
  // a fila sai a cada 10 s (ou ao esconder a aba): espera o envio
  let linha = ''
  for (let i = 0; i < 30 && !linha; i++) {
    await sleep(1000)
    linha = vid ? sql(`SELECT CONCAT_WS('|', bot, dispositivo, origem, IFNULL(utm_source,'-'), IFNULL(rota,'-'), eventos) FROM visitas WHERE vid = '${vid}' ORDER BY inicio DESC LIMIT 1`) : ''
  }
  const [b, dev, org, utm, rota, ev] = linha.split('|')
  nota(d, 'visita', linha && b === '0' && dev === 'mobile' && (!origem || org === origem), linha ? `visita gravada: bot=${b} dispositivo=${dev} origem=${org} utm=${utm} rota=${rota} eventos=${ev} (navigator.webdriver=${bot})` : `NENHUMA visita gravada em 30 s (vid ${vid})`, { linha, caminho })
  await d.ctx.close()
}
salvarRelatorio('relatorio-medicao-local')
await browser.close()
