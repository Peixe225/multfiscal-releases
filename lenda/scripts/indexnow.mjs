#!/usr/bin/env node
/**
 * IndexNow (servidor/CONTRATO-v34.md §B): avisa o Bing e o Yandex (e, pelo api.indexnow.org, os outros buscadores do
 * protocolo) de que as páginas públicas do jogo em https://oprojeto.online/lenda/ mudaram — eles vêm buscar de novo em
 * minutos, sem esperar a próxima visita do robô.
 *
 * A chave NÃO é segredo: o protocolo exige que ela fique publicada no próprio site (o build:site grava
 * `<chave>.txt` em dist-site/, que vai para public_html/lenda/). Como o arquivo fica em /lenda/ (e não na raiz do domínio,
 * que é de outro site), o pedido manda o `keyLocation` e só vale para endereços dentro de /lenda/ — o script tira da lista
 * qualquer outro antes de mandar.
 *
 * Uso (depois do deploy, com a pasta já no ar):
 *   node scripts/indexnow.mjs                    # as URLs do dist-site/sitemap.xml (ou a página do jogo e a política)
 *   node scripts/indexnow.mjs --seco             # só mostra o pedido; não sai nada para a internet
 *   node scripts/indexnow.mjs --conferir         # antes de avisar, confere se <chave>.txt responde com a chave e (§E) se o
 *                                                # robots.txt da raiz do domínio (de outro site) deixa os robôs entrarem em /lenda/
 *   node scripts/indexnow.mjs --url https://oprojeto.online/lenda/ --url https://oprojeto.online/lenda/privacidade.html
 *   node scripts/indexnow.mjs --motores bing,yandex,indexnow
 *   LENDA_SITE_URL=https://outro.site/jogo/ LENDA_INDEXNOW_KEY=<chave> node scripts/indexnow.mjs
 *
 * Respostas do protocolo: 200 (recebido), 202 (recebido; a chave ainda vai ser conferida), 400 (pedido errado), 403 (a
 * chave não bate com o arquivo publicado), 422 (endereço fora do host ou da pasta da chave), 429 (pedidos demais).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A chave do site (pública por definição: o build publica o arquivo dela). Trocar = rodar o build:site de novo. */
export const CHAVE_INDEXNOW = 'd94ea45cf3f7995fbbccb0d8835cd8de'
export const SITE_PADRAO = 'https://oprojeto.online/lenda/'
export const MOTORES = {
  bing: 'https://www.bing.com/indexnow',
  yandex: 'https://yandex.com/indexnow',
  indexnow: 'https://api.indexnow.org/indexnow',
}
/** Os buscadores avisados quando ninguém diz quais. */
export const MOTORES_PADRAO = ['bing', 'yandex']
/** O protocolo aceita até 10.000 endereços por pedido. */
export const MAX_URLS = 10_000

/** A chave em uso: LENDA_INDEXNOW_KEY (8 a 128 letras, números ou hífen) ou a do repositório. */
export function chaveIndexNow(env = process.env) {
  const k = String(env.LENDA_INDEXNOW_KEY ?? '').trim()
  if (k) {
    if (!/^[A-Za-z0-9-]{8,128}$/.test(k)) throw new Error('LENDA_INDEXNOW_KEY: de 8 a 128 letras, números ou hífen')
    return k
  }
  return CHAVE_INDEXNOW
}

/** A pasta do site, sempre com a barra final. */
export const pastaDoSite = (url = process.env.LENDA_SITE_URL || SITE_PADRAO) => new URL(url).href.replace(/\/?$/, '/')

/** O nome do arquivo da chave na pasta do site (o build:site grava este arquivo). */
export const arquivoDaChave = (chave) => `${chave}.txt`

/** Os <loc> de um sitemap.xml (só http/https, sem repetir). */
export function urlsDoSitemap(xml) {
  const out = []
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const u = m[1].replace(/&amp;/g, '&')
    if (/^https?:\/\//i.test(u) && !out.includes(u)) out.push(u)
  }
  return out
}

/**
 * O corpo do pedido do IndexNow. Fica só o que está DENTRO da pasta do site (o keyLocation em /lenda/ só autoriza
 * endereços de /lenda/), sem repetir e com o fragmento (#/…) tirado (o buscador não vê o que vem depois do #).
 * Devolve também o que ficou de fora e por quê.
 */
export function montarPedido({ site = pastaDoSite(), urls = [], chave = chaveIndexNow() } = {}) {
  const base = new URL(pastaDoSite(site))
  const lista = []
  const fora = []
  for (const bruto of urls) {
    let u
    try {
      u = new URL(bruto, base)
    } catch {
      fora.push({ url: String(bruto), motivo: 'endereço inválido' })
      continue
    }
    u.hash = ''
    if (u.protocol !== base.protocol || u.host !== base.host) fora.push({ url: u.href, motivo: 'outro site' })
    else if (!u.pathname.startsWith(base.pathname)) fora.push({ url: u.href, motivo: `fora de ${base.pathname}` })
    else if (!lista.includes(u.href)) lista.push(u.href)
  }
  return {
    pedido: { host: base.host, key: chave, keyLocation: new URL(arquivoDaChave(chave), base).href, urlList: lista.slice(0, MAX_URLS) },
    fora,
  }
}

const TEXTO_STATUS = {
  200: 'recebido',
  202: 'recebido (a chave ainda vai ser conferida)',
  400: 'pedido errado',
  403: 'a chave não bate com o arquivo publicado',
  422: 'endereço fora do host ou da pasta da chave',
  429: 'pedidos demais: tente mais tarde',
}
export const textoStatus = (s) => TEXTO_STATUS[s] ?? `resposta ${s}`

/** Manda o pedido a cada buscador (um de cada vez). `fetch` é trocável (os testes nunca saem para a internet). */
export async function avisar(pedido, { motores = MOTORES_PADRAO, fetch: f = globalThis.fetch, tempo = 15_000 } = {}) {
  if (!pedido?.urlList?.length) throw new Error('nenhum endereço para avisar')
  const out = []
  for (const nome of motores) {
    const destino = MOTORES[nome]
    if (!destino) {
      out.push({ motor: nome, ok: false, status: 0, texto: 'buscador desconhecido' })
      continue
    }
    try {
      const r = await f(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(pedido),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(tempo) : undefined,
      })
      out.push({ motor: nome, ok: r.status === 200 || r.status === 202, status: r.status, texto: textoStatus(r.status) })
    } catch (err) {
      out.push({ motor: nome, ok: false, status: 0, texto: `sem resposta (${err?.message ?? err})` })
    }
  }
  return out
}

/** A chave está publicada? (GET do keyLocation: tem de responder 200 com a chave no corpo.) */
export async function conferirChave(pedido, { fetch: f = globalThis.fetch } = {}) {
  try {
    const r = await f(pedido.keyLocation, { method: 'GET', cache: 'no-store' })
    const corpo = r.ok ? (await r.text()).trim() : ''
    return { ok: r.ok && corpo === pedido.key, status: r.status, corpo: corpo.slice(0, 200) }
  } catch (err) {
    return { ok: false, status: 0, corpo: String(err?.message ?? err) }
  }
}

// ───────────────────── robots.txt da raiz (CONTRATO-v34 §E: ele é de outro site) ─────────────────────

/** Os robôs que importam para o SEO e para a prévia de link (o Twitterbot obedece ao robots.txt; sem ele, o X fica sem card). */
export const ROBOS = ['Googlebot', 'Bingbot', 'YandexBot', 'Twitterbot', 'facebookexternalhit']

/**
 * O robots.txt deixa o robô `agente` buscar `caminho`? (As regras de sempre: o grupo do User-agent mais específico que casa — ou
 * o `*` —, a regra Allow/Disallow mais longa que casa vence, no empate o Allow; `*` e `$` nos caminhos; Disallow vazio não
 * bloqueia nada.) Sem robots.txt (404) tudo é permitido.
 */
export function robotsPermite(txt, agente, caminho) {
  const grupos = []
  let atual = null
  let lendoAgentes = false
  for (const bruta of String(txt ?? '').split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(linha)
    if (!m) continue
    const campo = m[1].toLowerCase()
    const valor = m[2].trim()
    if (campo === 'user-agent') {
      if (!lendoAgentes) {
        atual = { agentes: [], regras: [] }
        grupos.push(atual)
      }
      atual.agentes.push(valor.toLowerCase())
      lendoAgentes = true
    } else if (campo === 'allow' || campo === 'disallow') {
      lendoAgentes = false
      if (atual) atual.regras.push({ allow: campo === 'allow', caminho: valor })
    } else lendoAgentes = false
  }
  const ua = String(agente).toLowerCase()
  let melhor = -1
  let regras = null
  for (const g of grupos) {
    for (const a of g.agentes) {
      const n = a === '*' ? 0 : ua.includes(a) ? a.length : -1
      if (n > melhor) {
        melhor = n
        regras = [...g.regras]
      } else if (n === melhor && n >= 0 && regras) regras.push(...g.regras)
    }
  }
  if (!regras) return true
  const casa = (padrao) => {
    const fim = padrao.endsWith('$')
    const corpo = (fim ? padrao.slice(0, -1) : padrao)
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp('^' + corpo + (fim ? '$' : '')).test(caminho)
  }
  let vence = null
  for (const r of regras) {
    if (!r.caminho) continue // Disallow vazio = nada bloqueado
    if (!casa(r.caminho)) continue
    if (!vence || r.caminho.length > vence.caminho.length || (r.caminho.length === vence.caminho.length && r.allow)) vence = r
  }
  return !vence || vence.allow
}

/**
 * Lê o robots.txt da raiz do domínio e diz quais robôs não podem buscar a pasta do jogo, o sitemap e a prévia de link
 * (api/v.php). O robots.txt da raiz é de outro site: o script só avisa (e diz o que pedir ao dono), nunca mexe nele.
 */
export async function conferirRobots(site = pastaDoSite(), { fetch: f = globalThis.fetch, robos = ROBOS } = {}) {
  const base = new URL(pastaDoSite(site))
  const url = new URL('/robots.txt', base).href
  let txt = ''
  let status = 0
  try {
    const r = await f(url, { method: 'GET', cache: 'no-store' })
    status = r.status
    txt = r.ok ? await r.text() : ''
  } catch (err) {
    return { url, status: 0, erro: String(err?.message ?? err), bloqueados: [] }
  }
  const caminhos = [base.pathname, `${base.pathname}sitemap.xml`, `${base.pathname}api/v.php`]
  const bloqueados = []
  for (const robo of robos) {
    const fora = caminhos.filter((c) => !robotsPermite(txt, robo, c))
    if (fora.length) bloqueados.push({ robo, caminhos: fora })
  }
  return { url, status, erro: null, bloqueados }
}

/** O que pedir ao dono do robots.txt da raiz para liberar só a pasta do jogo (o resto do domínio fica como está). */
export const pedidoRobots = (site = pastaDoSite()) => {
  const p = new URL(pastaDoSite(site)).pathname
  return [`User-agent: *`, `Allow: ${p}`, '', `Sitemap: ${new URL('sitemap.xml', pastaDoSite(site)).href}`].join('\n')
}

// ───────────────────────────── linha de comando ─────────────────────────────

async function main(argv) {
  const args = argv.slice(2)
  const tem = (k) => args.includes(`--${k}`)
  const varios = (k) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]] : []))
  const site = pastaDoSite()
  const chave = chaveIndexNow()
  let urls = varios('url')
  if (!urls.length) {
    const raiz = fileURLToPath(new URL('..', import.meta.url))
    const sitemap = join(resolve(raiz, process.env.SITE_OUT || 'dist-site'), 'sitemap.xml')
    urls = existsSync(sitemap) ? urlsDoSitemap(readFileSync(sitemap, 'utf8')) : [site, new URL('privacidade.html', site).href]
  }
  const motores = (varios('motores')[0] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const { pedido, fora } = montarPedido({ site, urls, chave })
  for (const x of fora) console.log(`  · fora do pedido: ${x.url} (${x.motivo})`)
  console.log(`IndexNow · ${pedido.urlList.length} endereço(s) de ${pedido.host} · chave em ${pedido.keyLocation}`)
  for (const u of pedido.urlList) console.log(`  ${u}`)
  if (tem('seco')) {
    console.log('\n(--seco: nada foi mandado)\n' + JSON.stringify(pedido, null, 2))
    return 0
  }
  if (tem('conferir')) {
    const c = await conferirChave(pedido)
    if (!c.ok) {
      console.error(`✗ a chave não está publicada em ${pedido.keyLocation} (status ${c.status}). Suba o dist-site/ antes.`)
      return 1
    }
    console.log('✓ chave publicada')
    // §E: o robots.txt da raiz (de outro site) pode bloquear a pasta inteira — aí o aviso chega, mas ninguém vem buscar
    const rb = await conferirRobots(site)
    if (rb.erro) console.warn(`! não deu para ler ${rb.url} (${rb.erro})`)
    else if (rb.bloqueados.length) {
      console.warn(`! ${rb.url} BLOQUEIA a pasta do jogo para: ${rb.bloqueados.map((b) => `${b.robo} (${b.caminhos.join(', ')})`).join('; ')}`)
      console.warn('  O aviso vai assim mesmo, mas os buscadores não indexam e o X não mostra o card da prévia enquanto o robots.txt')
      console.warn('  da raiz bloquear. Ele é de outro site: peça ao dono para acrescentar (o resto do domínio continua como está):')
      for (const l of pedidoRobots(site).split('\n')) console.warn(`    ${l}`)
    } else console.log(`✓ ${rb.url}: a pasta do jogo liberada para ${ROBOS.join(', ')}`)
  }
  const r = await avisar(pedido, { motores: motores.length ? motores : MOTORES_PADRAO })
  for (const x of r) console.log(`${x.ok ? '✓' : '✗'} ${x.motor}: ${x.status || '—'} ${x.texto}`)
  return r.every((x) => x.ok) ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(
    (c) => process.exit(c),
    (err) => {
      console.error(`✗ ${err?.message ?? err}`)
      process.exit(1)
    },
  )
}
