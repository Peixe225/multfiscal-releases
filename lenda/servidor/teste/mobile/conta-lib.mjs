// LENDA v3.5 · suíte mobile — CONTA E COMPARTILHAMENTO: utilidades para os fluxos com conta no celular (pilha local).
//
//   import { C, novoAparelho, menu, dialogo, codigoDoEmail, ... } from './conta-lib.mjs'
//
// Usa a pilha local de servidor/teste/integracao/subir.sh (LENDA_INTEG_BASE com segredos.env) e os aparelhos, a
// medição (medir), o teclado virtual e o girar de ./carreira-lib.mjs. Nada aqui fala com a produção.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { APARELHOS, abrir, lancar, lento, semLentidao, offline, medir, relatar, teclado, girar, sleep, lerKv } from './carreira-lib.mjs'

// o Galaxy A deitado (Chrome do Android: o teclado encolhe a janela, que deitada fica com ~150 px)
APARELHOS['galaxy-a-deitado'] = { ...APARELHOS['galaxy-a'], w: 800, h: 360 }

export { APARELHOS, lancar, lento, semLentidao, offline, medir, relatar, teclado, girar, sleep, lerKv }

export const BASE = process.env.LENDA_INTEG_BASE ?? '/tmp/lenda-v35-conta'
if (!existsSync(`${BASE}/segredos.env`)) throw new Error(`sem ${BASE}/segredos.env: suba a pilha (LENDA_INTEG_BASE=${BASE} PORTA=9130 BANCO=lenda_v35_conta bash servidor/teste/integracao/subir.sh)`)
export const env = Object.fromEntries(readFileSync(`${BASE}/segredos.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
export const ORIGEM = `http://127.0.0.1:${env.PORTA}`
export const URL0 = `${ORIGEM}/lenda/`
export const PRINTS = process.env.LENDA_PRINTS ?? '/tmp/claude-0/-home-user-multfiscal-releases/856de241-fe5b-5ff3-9843-1a584641489b/scratchpad/v35-mobile/conta'
mkdirSync(PRINTS, { recursive: true })

export const sql = (q) =>
  execFileSync('mariadb', [`--socket=${env.SOCK || '/run/mysqld/mysqld.sock'}`, '--default-character-set=utf8mb4', '-uroot', '-N', '-B', env.BANCO, '-e', q], { encoding: 'utf8' }).trim()

// ───────────────────────── resultado ─────────────────────────
const achados = []
let oks = 0
/** Conferência: c verdadeiro = ok; falso = achado (com o aparelho, a tela e o detalhe). */
export function ok(c, msg, extra = {}) {
  console.log(`${c ? '  ok  ' : '  XX  '}${msg}`)
  if (c) oks++
  else achados.push({ msg, ...extra })
  return !!c
}
/** Uma observação (não é falha da conferência, mas vai para o relatório). */
export function nota(msg, extra = {}) {
  console.log(`  ..  ${msg}`)
  achados.push({ nota: true, msg, ...extra })
}
export function fim(nome) {
  const f = `${PRINTS}/relatorio-${nome}.json`
  writeFileSync(f, JSON.stringify({ oks, achados }, null, 2))
  const falhas = achados.filter((a) => !a.nota).length
  console.log(`\n${oks} ok · ${falhas} falha(s) · ${achados.length - falhas} nota(s) · relatório em ${f}`)
  return falhas
}

// ───────────────────────── aparelho ─────────────────────────
/**
 * Abre um aparelho (o do carreira-lib: viewport, DPR, isMobile, hasTouch, UA) na pilha local, com o clipboard liberado
 * (o.clipboard: 'ok' padrão; 'negado' = writeText recusa, como num WebView sem permissão; 'sem' = navigator.clipboard
 * não existe), o.partidas = contador de partidas, o.share 'falso' = navigator.share de mentira.
 */
export async function novoAparelho(browser, nome, o = {}) {
  const ap = await abrir(browser, nome, { share: o.share, ajustes: o.ajustes, lento: o.lento })
  const { ctx, page } = ap
  // cada aparelho com um IP próprio (o php -S recebe tudo de 127.0.0.1 e os limites por IP do servidor — entrar,
  // cadastrar — juntariam todos os aparelhos do teste; a pilha local confia no X-Forwarded-For, ver subir.sh)
  await ctx.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` })
  if ((o.clipboard ?? 'ok') === 'ok') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGEM })
  await ctx.addInitScript(
    ({ partidas, clip }) => {
      try {
        if (partidas != null && !localStorage.getItem('lenda:partidas')) localStorage.setItem('lenda:partidas', String(partidas))
      } catch {}
      window.__copiado = []
      try {
        if (navigator.clipboard) window.__clipOrig = navigator.clipboard.writeText.bind(navigator.clipboard)
      } catch {}
      if (clip === 'negado' && navigator.clipboard) {
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard)
        void orig
        navigator.clipboard.writeText = async (t) => {
          window.__copiado.push({ negado: true, t })
          throw new DOMException('Write permission denied.', 'NotAllowedError')
        }
      } else if (clip === 'sem') {
        try {
          Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true })
        } catch {}
      } else if (navigator.clipboard) {
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard)
        navigator.clipboard.writeText = async (t) => {
          window.__copiado.push({ t })
          return orig(t)
        }
      }
    },
    { partidas: o.partidas ?? null, clip: o.clipboard ?? 'ok' },
  )
  // os 4xx que o próprio fluxo provoca (senha errada, código errado) não contam como erro do console
  ap.ignorar = (re) => {
    for (let i = ap.erros.length - 1; i >= 0; i--) if (re.test(ap.erros[i])) ap.erros.splice(i, 1)
  }
  return ap
}

/** Print com nome aparelho_tela.png na pasta da área (o.sub = subpasta). */
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
export async function print(page, aparelho, tela, o = {}) {
  const dir = o.sub ? `${PRINTS}/${o.sub}` : PRINTS
  mkdirSync(dir, { recursive: true })
  const f = `${dir}/${slug(aparelho)}_${slug(tela)}.png`
  await page.screenshot({ path: f, fullPage: !!o.inteira, timeout: 60000 }).catch((e) => console.log(`  ..  print falhou (${tela}): ${e.message}`))
  return f
}

/** Fecha o que estiver aberto (Esc; e o "Fechar" do diálogo, se o Esc não fechar). */
export async function fecharTudo(page) {
  for (let i = 0; i < 4; i++) {
    const n = await page.locator('[role="dialog"]').count()
    if (!n) return
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(350)
    if ((await page.locator('[role="dialog"]').count()) === n) await page.locator('[role="dialog"]').last().getByRole('button', { name: 'Fechar' }).first().click({ timeout: 2000 }).catch(() => {})
    await sleep(350)
  }
}

/** A Home pronta (o jogo carregado e o site ligado). */
export async function home(page, hash = '#/') {
  await fecharTudo(page).catch(() => {})
  await page.goto(`${URL0}${hash}`)
  await page.waitForSelector('.ld-modes, .lx-topbar', { timeout: 60000 })
  await sleep(600)
}

export async function menu(page) {
  await page.getByRole('button', { name: 'Menu' }).first().click()
  const m = page.getByRole('dialog', { name: 'Menu' })
  await m.waitFor({ timeout: 10000 })
  await sleep(450)
  return m
}
/** O diálogo do site aberto agora (o de cima). */
export const dialogo = (page, texto) => (texto ? page.locator('[role="dialog"].sc-modal', { hasText: texto }) : page.locator('[role="dialog"].sc-modal')).last()
export const semDialogo = (page, ms = 15000) => page.waitForFunction(() => !document.querySelector('[role="dialog"].sc-modal'), null, { timeout: ms })

/** Atributos do campo (o teclado que o celular abre e o que o autocompletar oferece). */
export const atributos = (loc) =>
  loc.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
      inputmode: el.getAttribute('inputmode'),
      autocomplete: el.getAttribute('autocomplete'),
      autocapitalize: el.getAttribute('autocapitalize'),
      autocorrect: el.getAttribute('autocorrect'),
      spellcheck: el.getAttribute('spellcheck'),
      enterkeyhint: el.getAttribute('enterkeyhint'),
      maxlength: el.getAttribute('maxlength'),
      pattern: el.getAttribute('pattern'),
      name: el.getAttribute('name'),
      fonte: parseFloat(cs.fontSize),
    }
  })

/** O campo focado está inteiro à vista na janela (visualViewport) e nada por cima do centro dele? */
export const campoVisivel = (page) =>
  page.evaluate(() => {
    const f = document.activeElement
    if (!f || f === document.body) return { foco: null }
    const r = f.getBoundingClientRect()
    const vv = window.visualViewport
    const h = vv ? vv.height + vv.offsetTop : innerHeight
    const topo = document.elementFromPoint(r.left + r.width / 2, Math.min(h - 1, r.top + r.height / 2))
    return {
      foco: f.id || f.getAttribute('aria-label') || f.textContent?.trim().slice(0, 30) || f.tagName,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      janela: Math.round(h),
      inteiro: r.top >= 0 && r.bottom <= h,
      // no centro do campo tem de estar o próprio campo: outra coisa = coberto; um ancestral = o campo está recortado
      // (fora da área que o corpo do diálogo mostra), mesmo com o getBoundingClientRect dentro da janela
      porCima: topo && topo !== f && !f.contains(topo) ? `${topo.contains(f) ? 'recortado, aparece o ' : ''}${(topo.className?.toString?.() || topo.tagName).slice(0, 60)}` : null,
    }
  })

/** Onde fica o botão principal do formulário (o "Criar conta" / "Entrar") com o teclado aberto. */
export const botaoVisivel = (page, sel) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel)
    if (!b) return null
    const r = b.getBoundingClientRect()
    const vv = window.visualViewport
    const h = vv ? vv.height + vv.offsetTop : innerHeight
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), janela: Math.round(h), visivel: r.top >= 0 && r.bottom <= h }
  }, sel)

// ───────────────────────── e-mails do modo "arquivo" ─────────────────────────
export function emailsPara(para, depoisDe = 0) {
  const pasta = `${BASE}/emails`
  return readdirSync(pasta)
    .map((f) => ({ f, t: statSync(`${pasta}/${f}`).mtimeMs }))
    .filter((x) => x.t >= depoisDe)
    .sort((a, b) => b.t - a.t)
    .map(({ f, t }) => ({ arquivo: `${pasta}/${f}`, t, txt: readFileSync(`${pasta}/${f}`, 'utf8') }))
    .filter((e) => e.txt.split('\r\n').some((l) => l.toLowerCase() === `to: ${para.toLowerCase()}`))
}
/** O código de 6 dígitos mais novo que foi para `para` (o de confirmar o e-mail ou o de trocar a senha). */
export async function codigoDoEmail(para, depoisDe = 0, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    for (const e of emailsPara(para, depoisDe)) {
      const m = /\n\s*(\d{6})\s*\n/.exec(e.txt.replace(/\r\n/g, '\n').split('\n\n').slice(1).join('\n\n'))
      if (m) return m[1]
    }
    await sleep(250)
  }
  return null
}

/** Cria uma conta direto pela API (para as etapas que começam logadas); devolve { email, senha, apelido, id }. */
export async function contaPelaApi(page, apelido, email, senha = 'senha-forte-123') {
  const r = await page.evaluate(
    async ({ apelido, email, senha }) => {
      const x = await fetch('api/conta.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'cadastrar', apelido, email, senha, aceite: true }) })
      return { status: x.status, txt: await x.text() }
    },
    { apelido, email, senha },
  )
  if (r.status >= 300) throw new Error(`cadastro pela API: ${r.status} ${r.txt.slice(0, 200)}`)
  return { email, senha, apelido, id: Number(sql(`SELECT id FROM usuarios WHERE email='${email}'`)) }
}

/**
 * O painel do diálogo (sheet ou caixa) é overflow:hidden e quem rola é o corpo dele; um scrollIntoView lá dentro que não
 * cabe no corpo rola o PAINEL: o cabeçalho (título, Fechar, a alça) sobe para fora e sobra uma faixa vazia embaixo.
 * Devolve { scrollTop do painel, cabeçalho à vista?, faixa vazia embaixo (px) }.
 */
export const painelDeslocado = (page) =>
  page.evaluate(() => {
    const s = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!s) return null
    const b = s.querySelector('.lx-dialog__body')
    const rs = s.getBoundingClientRect()
    const rb = b?.getBoundingClientRect()
    const foot = s.querySelector('.lx-dialog__foot')
    const fundo = foot ? foot.getBoundingClientRect().top : rs.bottom
    return { scrollTop: Math.round(s.scrollTop), corpoTop: rb ? Math.round(rb.top - rs.top) : null, vazioEmbaixo: rb ? Math.max(0, Math.round(fundo - rb.bottom)) : null }
  })

/** Confere que o aparelho fica sem rolagem lateral e sem alvos pequenos; devolve a medição (e o deslocamento do painel). */
export async function medirTela(page, rot, o = {}) {
  const m = await medir(page, { raiz: o.raiz ?? '[role="dialog"].sc-modal', minimo: o.minimo ?? 40 })
  // os <input> ficam numa caixa de 48 px (.sc-input) que, tocada em qualquer ponto, foca o campo: não contam como alvo pequeno
  m.pequenos = m.pequenos.filter((p) => !/^sc_r_|^Ex\.:|^Prefiro não dizer|^Link do seu perfil|^Seu link de convite/.test(p.nome))
  const ach = relatar(rot, m, { fonte: true })
  const desloc = await painelDeslocado(page).catch(() => null)
  if (desloc && desloc.scrollTop > 0) console.log(`  !!  ${rot}: o painel do diálogo rolou ${desloc.scrollTop}px (cabeçalho fora, ${desloc.vazioEmbaixo}px vazios embaixo)`)
  return { m, ach, desloc }
}

/** Simula o "colar" de verdade: põe o texto no clipboard e manda Ctrl+V no campo focado. */
export async function colar(page, texto) {
  await page.evaluate((t) => (window.__clipOrig ?? navigator.clipboard.writeText.bind(navigator.clipboard))(t), texto)
  await page.keyboard.press('Control+V')
  await sleep(200)
}

/**
 * Joga uma carreira do Clássico pela tela do celular (assistente de 3 passos da identidade, ritmo Expresso), sempre a 1ª
 * opção liberada, até o card de fim ("Jogar novamente"). Devolve { ms, fim }.
 */
export async function jogarCelular(page, sobrenome = 'MOBILE', o = {}) {
  await page.goto(`${URL0}#/identidade?ritmo=${o.ritmo ?? 'expressa'}`)
  const busca = page.locator('input[placeholder="Buscar país"]')
  await busca.waitFor({ state: 'visible', timeout: 60000 })
  await busca.fill(o.pais ?? 'bras')
  await page.locator('#id-nation-list [role="radio"]', { hasText: o.paisRe ?? /^\s*Brasil\s*$/ }).first().click()
  const largo = (await page.getByRole('button', { name: /^Continuar/ }).count()) === 0
  if (!largo) await page.getByRole('button', { name: /^Continuar/ }).click()
  await page.locator('#id-surname').waitFor({ state: 'visible', timeout: 20000 })
  await page.fill('#id-surname', sobrenome)
  if (!largo) await page.getByRole('button', { name: /^Continuar/ }).click()
  await sleep(500)
  await page.locator('[role="radiogroup"][aria-label="Posição em campo"] [role="radio"]').last().click()
  await sleep(300)
  await page.getByRole('button', { name: /^Confirmar$|Confirmar identidade/ }).click()
  await page.waitForFunction(() => location.hash.startsWith('#/carreira'), null, { timeout: 30000 })
  const t0 = Date.now()
  let fim = false
  while (Date.now() - t0 < (o.limiteMs ?? 300000)) {
    if (await page.locator('.ck-end button', { hasText: /Jogar novamente/ }).count()) {
      fim = true
      break
    }
    const opt = page.locator('.ck-opt:not(.is-locked):not([disabled])').first()
    const pen = page.locator('.ck-pen__goal button:not([disabled])').first()
    const pular = page.getByRole('button', { name: /^Pular/ })
    try {
      if (await opt.count()) await opt.click({ timeout: 3000 })
      else if (await pen.count()) await pen.click({ timeout: 3000 })
      else if (await pular.count()) await pular.first().click({ timeout: 3000 })
      else if (o.fecharDialogos !== false) {
        const dlg = page.locator('[role="dialog"]:not(.sc-modal)')
        if (await dlg.count()) {
          const b = dlg.locator('button').filter({ hasText: /Continuar|Fechar|Seguir|OK|Avançar/ }).first()
          if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {})
        }
      }
    } catch {}
    await sleep(150)
  }
  return { ms: Date.now() - t0, fim }
}

/** Ajustes rápidos (sem som, sem animações): para as etapas que só precisam de carreiras terminadas. */
export const AJUSTES_RAPIDOS = JSON.stringify({ state: { settings: { sound: false, volume: 0, skipAnimations: true, reducedMotion: true, lowFx: true, engine: 'auto' } }, version: 1 })

/** Toasts na tela agora: [{ titulo, desc, larguraTexto, cortado }] (cortado = o texto não cabe e vira reticências). */
export const toasts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.lx-toast')].map((t) => {
      const ti = t.querySelector('.lx-toast__title')
      const de = t.querySelector('.lx-toast__desc')
      const corta = (el) => !!el && (el.scrollWidth > el.clientWidth + 1 || [...el.querySelectorAll('*')].some((x) => x.scrollWidth > x.clientWidth + 1))
      return { titulo: ti?.textContent?.trim() ?? '', desc: de?.textContent?.trim() ?? '', tituloCortado: corta(ti), descCortada: corta(de) }
    }),
  )
