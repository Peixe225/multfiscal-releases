// LENDA v3.5 · suíte mobile · TOQUE E LEGIBILIDADE — a medição de uma tela, elemento por elemento.
//
//   import { auditar, focoVisivel, movimento, abrirT, lancarT } from './toque-lib.mjs'
//
// auditar(d, tela, o) rola a tela (o documento, ou o miolo rolável do diálogo aberto) de janela em janela e, em cada
// passo, mede tudo o que está visível:
//   · alvo de toque  < 40 px (largura ou altura; conta a área invisível de ::before/::after com inset negativo e o
//                    <label> em volta do campo; "link no meio do texto" vem marcado à parte — é a exceção do WCAG 2.5.8)
//   · texto          < 12 px (tamanho calculado × escala de transform)
//   · contraste      < 4,5:1 (texto normal) ou < 3:1 (texto grande: ≥ 24 px, ou ≥ 18,66 px em negrito). O fundo é
//                    medido nos PIXELS: dois prints da janela, um normal e outro com as letras invisíveis
//                    (-webkit-text-fill-color: transparent — não mexe no currentColor de fundos e bordas). A cor da letra
//                    (com a opacidade dos pais) é composta sobre cada pixel do fundo; vale a mediana. Texto com
//                    gradiente (background-clip: text) é medido só pelos pixels.
//   · vaza a largura elemento que passa da borda da janela sem um pai que role de lado ou recorte de propósito
//                    (a .lx-app tem overflow-x: clip: não aparece rolagem lateral, mas o que passa some cortado)
//   · coberto        alvo/texto sob um elemento fixo/sticky de onde a rolagem não tira (topo com a rolagem no começo,
//                    rodapé com a rolagem no fim, ou a tela não rola) — e sob uma camada de tela inteira em qualquer passo
//   · sobreposto     linhas de texto de elementos diferentes uma por cima da outra
// e guarda a lista de animações rodando (para o prefers-reduced-motion).
// Prints: <aparelho>_<tela>.png (a janela no topo, na resolução do aparelho) e <aparelho>_<tela>_marcas-<passo>.png (a
// janela de cada passo com achado, com as caixas numeradas: vermelho alvo, magenta contraste, laranja texto pequeno,
// azul vaza, amarelo coberto, ciano sobreposto). O número da caixa é o "n" do achado no relatório.
//
// focoVisivel(d, tela, o): Tab de parada em parada (até o.max), e para cada uma compara o recorte do elemento com foco
// (teclado → :focus-visible) e sem foco; "sem foco visível" = quase nenhum pixel mudou. Também: foco que some atrás de
// elemento fixo e foco que escapa do diálogo aberto.
// movimento(d): animações rodando agora (CSS/WAAPI), quadros por segundo de requestAnimationFrame e o data-motion.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { APARELHOS, EXE, abrir, lancar } from './carreira-lib.mjs'
import { pastaPrints, religarToque } from './aparelhos.mjs'

const PROJ = new URL('../../../', import.meta.url).pathname
const sharp = createRequire(`${PROJ}package.json`)('sharp')

// LENDA_PRINTS_TOQUE (a pasta da área, como antes) ou <LENDA_PRINTS>/toque — ver aparelhos.mjs
export const PRINTS = pastaPrints('toque', process.env.LENDA_PRINTS_TOQUE)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export { APARELHOS, EXE, religarToque }

/** As quatro larguras pedidas → o aparelho do carreira-lib com essa largura. */
export const LARGURAS = { 320: 'pequeno-320', 360: 'galaxy-a', 390: 'iphone-14', 412: 'pixel-7' }

/** Chromium com o proxy da máquina (produção e a ESPN das Ligas ao vivo); 127.0.0.1 direto (o lancar do carreira-lib). */
export const lancarT = lancar

/**
 * Aparelho para a medição: o do carreira-lib (viewport, DPR, isMobile, hasTouch, UA de verdade) e mais:
 *   o.prod = true          → produção: só leitura (aborta POST/PUT/DELETE em /api/ e a medição de visitas e.php);
 *   o.hall = [HallEntry]   → semeia o "Suas carreiras" do Hall (IndexedDB);
 *   o.reduzir = true       → prefers-reduced-motion: reduce;
 *   o.ajustes              → lenda:settings (padrão: o do carreira-lib, que é o padrão do jogo).
 * Conta os quadros de requestAnimationFrame (window.__raf) para o teste de movimento.
 */
export async function abrirT(browser, nome, o = {}) {
  // o.prod: a barreira de aparelhos.mjs (e.php respondido aqui com 204, escrita para /api/ barrada pelo CDP e na página)
  const d = await abrir(browser, nome, { ajustes: o.ajustes, prod: o.prod })
  if (o.reduzir) await d.page.emulateMedia({ reducedMotion: 'reduce' })
  await d.ctx.addInitScript(() => {
    window.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) =>
      orig((t) => {
        window.__raf++
        cb(t)
      })
  })
  d.bloqueados = d.barrados
  if (o.hall) {
    await d.ctx.addInitScript(
      ({ hall }) => {
        if (localStorage.getItem('teste:semeado')) return
        localStorage.setItem('teste:semeado', '1')
        const req = indexedDB.open('lenda', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => {
          const t = req.result.transaction('kv', 'readwrite')
          t.objectStore('kv').put(hall, 'hall')
        }
      },
      { hall: o.hall },
    )
  }
  d.prod = !!o.prod
  return d
}

const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

/** Espera as animações finitas acabarem (até ms). As infinitas (pulsos, brilhos) continuam. */
export async function assentar(page, ms = 3500) {
  const t = Date.now()
  await sleep(250)
  while (Date.now() - t < ms) {
    const n = await page
      .evaluate(
        () =>
          document.getAnimations().filter((a) => {
            if (a.playState !== 'running') return false
            const ct = a.effect?.getComputedTiming?.()
            return ct && ct.endTime !== Infinity && ct.iterations !== Infinity
          }).length,
      )
      .catch(() => 0)
    if (!n) return
    await sleep(150)
  }
}

// ───────────────────────── a medição dentro da página ─────────────────────────
/** Instala window.__tq (funções usadas pelos passos). Idempotente. */
async function instalar(page) {
  await page.evaluate(() => {
    if (window.__tq) return
    const SEM = /^(lx|ld|hl|ck|lv|tb|sm|sc|sv|id|s4|cr|ac|pt|im|pf)-/
    const ids = new WeakMap()
    let n = 0
    const idDe = (el) => {
      if (!ids.has(el)) ids.set(el, ++n)
      return ids.get(el)
    }
    const parte = (e) => {
      let s = e.tagName.toLowerCase()
      const cls = [...e.classList].filter((c) => SEM.test(c)).slice(0, 2)
      s += cls.map((c) => '.' + CSS.escape(c)).join('')
      if (!cls.length) {
        const al = e.getAttribute('aria-label')
        const role = e.getAttribute('role')
        if (al && al.length < 48) s += `[aria-label="${al.replace(/["\\]/g, '\\$&')}"]`
        else if (role) s += `[role="${role}"]`
      }
      const pai = e.parentElement
      if (pai) {
        const mesmos = [...pai.children].filter((x) => x.tagName === e.tagName)
        if (mesmos.length > 1 && [...pai.children].filter((x) => x.matches(s)).length > 1) s += `:nth-of-type(${mesmos.indexOf(e) + 1})`
      }
      return s
    }
    const seletor = (el) => {
      if (!el || el.nodeType !== 1) return ''
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id)
      const p = []
      let sem = false
      for (let e = el; e && e !== document.body && e !== document.documentElement && p.length < 8; e = e.parentElement) {
        if (e !== el && e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) {
          p.unshift('#' + CSS.escape(e.id))
          break
        }
        const pt = parte(e)
        p.unshift(pt)
        if (/\.[a-z]/.test(pt)) sem = true
        const s = p.join(' > ')
        try {
          if (sem && p.length >= 2 && document.querySelectorAll(s).length === 1) break
        } catch {}
      }
      return p.join(' > ')
    }
    const nomeDe = (el) =>
      (el.getAttribute?.('aria-label') ||
        (el.getAttribute?.('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) ||
        (el.labels?.[0]?.innerText) || el.innerText || el.textContent || el.getAttribute?.('title') || el.getAttribute?.('placeholder') || el.getAttribute?.('alt') || el.tagName || '')
        .toString()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
    window.__tq = { idDe, seletor, nomeDe }
  })
}

/** Um passo: mede o que está na janela agora. Devolve itens novos (não vistos em passos anteriores) e as coberturas. */
function passoNaPagina({ raizSel, minimo, vistos, rolagem }) {
  const { idDe, seletor, nomeDe } = window.__tq
  const W = innerWidth
  const H = innerHeight
  const raiz = (raizSel && document.querySelector(raizSel)) || document.body
  const cs = new Map()
  const st = (el) => {
    let s = cs.get(el)
    if (!s) cs.set(el, (s = getComputedStyle(el)))
    return s
  }
  const opac = new Map()
  const opacidade = (el) => {
    if (!el || el.nodeType !== 1) return 1
    if (opac.has(el)) return opac.get(el)
    const v = parseFloat(st(el).opacity || '1') * opacidade(el.parentElement)
    opac.set(el, v)
    return v
  }
  const oculto = (el) => {
    const s = st(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return true
    if (el.closest('[inert]')) return true
    // "só para leitor de tela" (sr-only: clip rect(0 0 0 0), clip-path inset(50%), 1×1 px com overflow escondido)
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const sa = st(a)
      if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(sa.clip) || /inset\(50%\)/.test(sa.clipPath)) return true
      if (sa.overflow !== 'visible' && a.offsetWidth <= 1 && a.offsetHeight <= 1 && sa.position === 'absolute') return true
    }
    if (opacidade(el) < 0.06) return true
    return false
  }
  // retângulo visível: o do elemento recortado pelos pais com overflow ≠ visible e pela janela
  const recorte = (el, r0, proprio = false) => {
    const r = r0 ?? el.getBoundingClientRect()
    let L = r.left
    let T = r.top
    let R = r.right
    let B = r.bottom
    let fixo = st(el).position === 'fixed'
    // o retângulo de um texto também é recortado pelo overflow do próprio pai do texto (proprio = true)
    for (let a = proprio ? el : el.parentElement; a && a !== document.documentElement && !(fixo && a !== el); a = a.parentElement) {
      const s = st(a)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const ra = a.getBoundingClientRect()
        if (s.overflowX !== 'visible') {
          L = Math.max(L, ra.left)
          R = Math.min(R, ra.right)
        }
        if (s.overflowY !== 'visible') {
          T = Math.max(T, ra.top)
          B = Math.min(B, ra.bottom)
        }
      }
      if (s.position === 'fixed') fixo = true
    }
    L = Math.max(L, 0)
    T = Math.max(T, 0)
    R = Math.min(R, W)
    B = Math.min(B, H)
    return R - L > 1 && B - T > 1 ? { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T } : null
  }
  const rr = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width ?? r.right - r.left), h: Math.round(r.height ?? r.bottom - r.top) })

  // elementos fixos/sticky (o de fora de cada pilha), com a âncora
  // (os aninhados também: o cabeçalho sticky dentro do diálogo fixo é uma camada própria)
  const fixos = []
  for (const el of document.body.querySelectorAll('*')) {
    const p = st(el).position
    if (p !== 'fixed' && p !== 'sticky') continue
    if (oculto(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue
    const ancora = r.height > H * 0.7 && r.width > W * 0.7 ? 'tela' : r.top <= H * 0.35 ? 'topo' : r.bottom >= H * 0.65 ? 'base' : 'meio'
    fixos.push({ el, pos: p, ancora, r })
  }
  // a camada fixa/sticky mais de dentro que contém o elemento
  const fixoDe = (el) => {
    let m = null
    for (const f of fixos) if (f.el.contains(el) && (!m || m.el.contains(f.el))) m = f
    return m
  }

  const SEL_ALVO =
    'button, a[href], [role="button"], [role="link"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'
  const ehAlvo = (el) => el.matches(SEL_ALVO) || (st(el).cursor === 'pointer' && !(el.parentElement && st(el.parentElement).cursor === 'pointer'))
  const area = (el, r) => {
    let { left, top, right, bottom } = r
    for (const ps of ['::before', '::after']) {
      const s = getComputedStyle(el, ps)
      if (!s || s.content === 'none' || s.position !== 'absolute' || s.pointerEvents === 'none') continue
      const nn = (v) => (v.endsWith('px') ? parseFloat(v) : NaN)
      const [t, r2, b, l] = [nn(s.top), nn(s.right), nn(s.bottom), nn(s.left)]
      if (!Number.isNaN(l)) left = Math.min(left, r.left + l)
      if (!Number.isNaN(t)) top = Math.min(top, r.top + t)
      if (!Number.isNaN(r2)) right = Math.max(right, r.right - r2)
      if (!Number.isNaN(b)) bottom = Math.max(bottom, r.bottom - b)
    }
    return { w: right - left, h: bottom - top }
  }
  const rel = (a, b) => a === b || a.contains(b) || b.contains(a)
  // ilustração decorativa: dentro de um aria-hidden grande (a arte da Home, o cartão do jogador desenhado)
  const arteDe = (el) => {
    const ah = el.closest('[aria-hidden="true"]')
    if (!ah) return false
    const r = ah.getBoundingClientRect()
    return r.width * r.height >= 120 * 120
  }
  const cobertura = (el, rv) => {
    // 5 pontos (centro e os quatro a 25% das bordas) dentro do retângulo visível
    const pts = [
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]
    let cobre = null
    let n = 0
    for (const [fx, fy] of pts) {
      const x = rv.left + rv.width * fx
      const y = rv.top + rv.height * fy
      const hit = document.elementFromPoint(x, y)
      if (!hit || rel(hit, el)) continue
      // um <label> que envolve o campo, ou o rótulo do mesmo controle: não conta
      if (hit.closest('label') && hit.closest('label').contains(el)) continue
      const f = fixoDe(hit)
      const fe = fixoDe(el)
      if (f && f !== fe && !f.el.contains(el)) {
        n++
        cobre = { tipo: 'fixo', ancora: f.ancora, pos: f.pos, por: seletor(f.el), porNome: nomeDe(f.el).slice(0, 40) }
      }
    }
    return cobre ? { ...cobre, pontos: n } : null
  }

  const alvos = []
  const cobertos = []
  const vistoAlvo = new Set()
  for (const el of raiz.querySelectorAll('*')) {
    if (!ehAlvo(el)) continue
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
    if (oculto(el)) continue
    let r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    let caixa = /INPUT|TEXTAREA|SELECT/.test(el.tagName) ? el.closest('label') : null
    // o campo dentro de uma caixa desenhada (.lx-input: 46 px de altura com o <input> de ~23 px no meio): o toque na
    // caixa foca o campo (conferido com o dedo no toque-verificar.mjs), então conta a caixa
    if (!caixa && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
      for (let a = el.parentElement, i = 0; a && i < 2; a = a.parentElement, i++) {
        const sa = st(a)
        const ra = a.getBoundingClientRect()
        const desenhada = parseFloat(sa.borderTopWidth) > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(sa.backgroundColor)
        if (desenhada && ra.height < 90 && ra.width >= r.width && ra.height >= r.height) {
          caixa = a
          break
        }
      }
    }
    if (caixa && !oculto(caixa)) r = caixa.getBoundingClientRect()
    // o input escondido de um switch/radio estilizado (opacity 0 / 1 px) conta pelo rótulo ou pelo pai visível
    if ((r.width <= 2 || r.height <= 2) && !caixa) continue
    const pai = el.parentElement?.closest(SEL_ALVO)
    if (pai && pai !== el && !oculto(pai)) continue
    const rv = recorte(el, r)
    if (!rv) continue
    const id = idDe(caixa ?? el)
    if (vistoAlvo.has(id)) continue
    vistoAlvo.add(id)
    // cobertura (vale também para os já vistos: é por passo)
    const cob = cobertura(caixa ?? el, rv)
    if (cob) cobertos.push({ id, tipo: 'alvo', sel: seletor(el), nome: nomeDe(el), r: rr(rv), ...cob })
    const inteiro = r.top >= -1 && r.bottom <= H + 1
    if (vistos.includes(id) || !inteiro) continue
    const a = area(el, r)
    if (a.w + 0.5 >= minimo && a.h + 0.5 >= minimo) {
      alvos.push({ id, ok: true })
      continue
    }
    // link no meio de um parágrafo (exceção "inline" do WCAG 2.5.8)
    const s = st(el)
    const noTexto = el.tagName === 'A' && /inline/.test(s.display) && !/flex|grid|block/.test(s.display) && (el.parentElement?.innerText?.length ?? 0) > (el.innerText?.length ?? 0) + 20
    // distância até o alvo vizinho mais perto (borda a borda)
    let viz = Infinity
    let vizNome = ''
    for (const o of raiz.querySelectorAll(SEL_ALVO)) {
      if (o === el || rel(o, el) || oculto(o)) continue
      const q = o.getBoundingClientRect()
      if (q.width < 3 || q.height < 3 || q.bottom < r.top - 60 || q.top > r.bottom + 60) continue
      const dx = Math.max(0, q.left - r.right, r.left - q.right)
      const dy = Math.max(0, q.top - r.bottom, r.top - q.bottom)
      const dd = Math.hypot(dx, dy)
      if (dd < viz) {
        viz = dd
        vizNome = nomeDe(o).slice(0, 30)
      }
    }
    alvos.push({
      id,
      sel: seletor(el),
      nome: nomeDe(el),
      tag: el.tagName.toLowerCase(),
      papel: el.getAttribute('role') || '',
      w: Math.round(a.w),
      h: Math.round(a.h),
      r: rr(r),
      noTexto,
      vizinho: Number.isFinite(viz) ? Math.round(viz) : null,
      vizNome,
      ocultoLeitor: !!el.closest('[aria-hidden="true"]'),
      arte: arteDe(el),
    })
  }

  // textos: por elemento pai do nó de texto
  const textos = []
  const porEl = new Map()
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const txt = t.textContent
    if (!txt || !/[\p{L}\p{N}]/u.test(txt)) continue
    const p = t.parentElement
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|OPTION)$/.test(p.tagName)) continue
    if (oculto(p)) continue
    const rg = document.createRange()
    rg.selectNodeContents(t)
    const rects = [...rg.getClientRects()].filter((q) => q.width > 1 && q.height > 1)
    if (!rects.length) continue
    let e = porEl.get(p)
    if (!e) porEl.set(p, (e = { p, rects: [], txt: '' }))
    e.rects.push(...rects)
    e.txt += txt
  }
  const linhasTexto = []
  const cortados = []
  // quem recorta este retângulo de texto (o pai mais de dentro com overflow ≠ visible que corta mais de 2 px)
  const quemCorta = (el, q) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = st(a)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') {
        if (s.position === 'fixed') return null
        continue
      }
      const ra = a.getBoundingClientRect()
      const corta = (s.overflowX !== 'visible' && (q.left < ra.left - 2 || q.right > ra.right + 2)) || (s.overflowY !== 'visible' && (q.top < ra.top - 3 || q.bottom > ra.bottom + 3))
      if (corta) return { a, s }
      if (s.position === 'fixed') return null
    }
    return null
  }
  for (const { p, rects, txt } of porEl.values()) {
    const vis = rects.map((q) => recorte(p, q, true)).filter(Boolean)
    if (!vis.length) continue
    const id = idDe(p)
    if (!vistos.includes(-id) && !cortados.some((c) => c.id === id)) {
      for (const q of rects) {
        // só o que está dentro da janela na vertical e na horizontal (a borda da janela é o "vaza")
        if (q.top < 0 || q.bottom > H || q.left < 0 || q.right > W) continue
        const c = quemCorta(p, q)
        if (!c) continue
        const { a, s } = c
        // de propósito: rolagem (carrossel, lista), reticências, line-clamp, letreiro animado, máscara de revelação
        if (/auto|scroll/.test(s.overflowX + s.overflowY)) break
        const sp = st(p)
        if (sp.textOverflow === 'ellipsis' || s.textOverflow === 'ellipsis') break
        if ((sp.webkitLineClamp && sp.webkitLineClamp !== 'none') || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) break
        if (a.getAnimations?.({ subtree: true }).some((an) => an.effect?.getComputedTiming?.().iterations === Infinity && an.effect?.target && (an.effect.target === a || a.contains(an.effect.target)) && an.effect.target.contains(p))) break
        const ra = a.getBoundingClientRect()
        const vx = Math.max(0, Math.min(q.right, ra.right) - Math.max(q.left, ra.left))
        const vy = Math.max(0, Math.min(q.bottom, ra.bottom) - Math.max(q.top, ra.top))
        const fr = (vx * vy) / Math.max(1, q.width * q.height)
        if (fr <= 0.02) break // escondido inteiro (sanfona fechada, painel recolhido): não é "cortado"
        cortados.push({ id, sel: seletor(p), texto: txt.replace(/\s+/g, ' ').trim().slice(0, 60), por: seletor(a), visivel: Math.round(fr * 100), r: rr(q) })
        break
      }
    }
    const fx = fixoDe(p)
    for (const v of vis) linhasTexto.push({ id, p, r: v, fixo: fx?.el ?? null })
    // cobertura do texto (centro de cada linha)
    for (const v of vis.slice(0, 3)) {
      const hit = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2)
      if (!hit || rel(hit, p)) continue
      const f = fixoDe(hit)
      if (f && f !== fx && !f.el.contains(p)) {
        cobertos.push({ id, tipo: 'texto', sel: seletor(p), nome: txt.replace(/\s+/g, ' ').trim().slice(0, 50), r: rr(v), tipoCob: 'fixo', ancora: f.ancora, pos: f.pos, por: seletor(f.el), porNome: nomeDe(f.el).slice(0, 40), pontos: 1 })
        break
      }
    }
    if (vistos.includes(-id)) continue
    // só mede quando todas as linhas visíveis estão inteiras na janela (o print do passo pega a letra toda)
    const inteiro = rects.every((q) => q.top >= -1 && q.bottom <= H + 1) || rects.some((q) => q.height > H * 0.8)
    if (!inteiro && !rolagem.ultimo) continue
    const s = st(p)
    const fs = parseFloat(s.fontSize)
    const bw = p.offsetWidth
    const escala = bw > 0 ? Math.min(4, Math.max(0.1, p.getBoundingClientRect().width / bw)) : 1
    const fill = s.webkitTextFillColor
    const gradiente = /transparent|rgba\(0, 0, 0, 0\)/.test(fill) || s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text'
    textos.push({
      id: -id,
      sel: seletor(p),
      texto: txt.replace(/\s+/g, ' ').trim().slice(0, 60),
      fonte: Math.round(fs * escala * 10) / 10,
      peso: parseInt(s.fontWeight, 10) || 400,
      // texto de SVG: a cor é o fill (o color herdado não pinta nada)
      cor: p instanceof SVGElement && s.fill && !/none|url/.test(s.fill) ? s.fill : s.color,
      fill: gradiente ? null : fill && fill !== s.color && !/currentcolor/i.test(fill) ? fill : null,
      opacidade: Math.round(opacidade(p) * 1000) / 1000,
      gradiente,
      svg: p instanceof SVGElement,
      ocultoLeitor: !!p.closest('[aria-hidden="true"]'),
      arte: arteDe(p),
      rects: vis.slice(0, 6).map(rr),
      fixo: !!fx,
    })
  }

  // sobreposição texto × texto (mesma camada)
  const sobrepostos = []
  for (let i = 0; i < linhasTexto.length; i++) {
    const a = linhasTexto[i]
    for (let j = i + 1; j < linhasTexto.length; j++) {
      const b = linhasTexto[j]
      if (a.id === b.id || a.fixo !== b.fixo || rel(a.p, b.p)) continue
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (ix <= 2 || iy <= 2) continue
      const menor = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
      if (ix * iy < Math.max(20, menor * 0.25)) continue
      if (arteDe(a.p) && arteDe(b.p)) continue // as cartas empilhadas da arte decorativa
      sobrepostos.push({ a: seletor(a.p), b: seletor(b.p), ta: a.p.textContent.trim().slice(0, 30), tb: b.p.textContent.trim().slice(0, 30), r: rr({ left: Math.max(a.r.left, b.r.left), top: Math.max(a.r.top, b.r.top), width: ix, height: iy }), ida: a.id, idb: b.id })
      if (sobrepostos.length > 30) break
    }
  }

  // vaza a largura: passa da borda da janela sem um pai que role de lado ou recorte dentro da janela
  const vazam = []
  const raizApp = document.querySelector('.lx-app')
  const marcados = new Set()
  for (const el of raiz.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (!(r.right > W + 1 || r.left < -1)) continue
    if (r.bottom < 0 || r.top > H) continue
    if (r.right <= 0 || r.left >= W) continue // inteiro fora da tela, de propósito (o cartão de compartilhar desenhado fora)
    if (oculto(el)) continue
    let ok = false
    for (let a = el.parentElement; a && a !== document.body && a !== raizApp && a !== document.documentElement; a = a.parentElement) {
      const s = st(a)
      if (s.overflowX === 'visible') continue
      const ra = a.getBoundingClientRect()
      // um pai que rola de lado (carrossel) ou que recorta dentro da janela: de propósito
      if (/auto|scroll/.test(s.overflowX) || (ra.right <= W + 1 && ra.left >= -1)) {
        ok = true
        break
      }
    }
    if (ok) continue
    if (st(el).position === 'fixed' && (r.right <= 0 || r.left >= W)) continue // gaveta fora da tela
    let pai = el.parentElement
    while (pai && marcados.has(pai) === false && pai !== document.body) pai = pai.parentElement
    if (pai && marcados.has(pai)) continue
    marcados.add(el)
    const id = idDe(el)
    const temTexto = /[\p{L}\p{N}]/u.test(el.innerText || el.textContent || '')
    const interativo = !!(el.matches(SEL_ALVO) || el.querySelector(SEL_ALVO))
    vazam.push({ id, sel: seletor(el), nome: nomeDe(el), r: rr(r), passa: Math.round(Math.max(r.right - W, -r.left)), lado: r.right > W + 1 ? 'direita' : 'esquerda', temTexto, interativo, decorativo: !temTexto && !interativo, ocultoLeitor: !!el.closest('[aria-hidden="true"]') })
  }
  const campos = []
  for (const el of raiz.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select')) {
    if (oculto(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H) continue
    const fs = parseFloat(st(el).fontSize)
    if (fs < 16) campos.push({ id: idDe(el), sel: seletor(el), nome: nomeDe(el) || el.type, fonte: fs, r: rr(r) })
  }
  const de = document.documentElement
  return {
    campos,
    W,
    H,
    lateral: Math.max(de.scrollWidth, document.body.scrollWidth) - W,
    alvos,
    textos,
    cobertos,
    sobrepostos,
    cortados: cortados.slice(0, 40),
    vazam: vazam.slice(0, 40),
    fixos: fixos.filter((f) => !fixos.some((g) => g !== f && g.el.contains(f.el))).map((f) => ({ sel: seletor(f.el), nome: nomeDe(f.el).slice(0, 40), pos: f.pos, ancora: f.ancora, r: rr(f.r) })),
  }
}

// ───────────────────────── pixels ─────────────────────────
const lin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const razao = (a, b) => {
  const la = lum(a)
  const lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const parseCor = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  const c = String(s).match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/)
  if (c) return [c[1] * 255, c[2] * 255, c[3] * 255, c[4] != null ? Number(c[4]) : 1]
  return null
}
async function crus(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, c: info.channels }
}
const px = (img, x, y) => {
  const xx = Math.min(img.w - 1, Math.max(0, Math.round(x)))
  const yy = Math.min(img.h - 1, Math.max(0, Math.round(y)))
  const i = (yy * img.w + xx) * img.c
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}
const mediana = (v) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const pct = (v, p) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

/** Contraste de um texto: cor da letra composta sobre o fundo real (pixels do print sem letras). */
function contrasteDe(t, normal, semLetra) {
  const cor = parseCor(t.fill ?? t.cor)
  const amostras = []
  const pelosPixels = []
  let fundoMed = null
  let maxDif = 0
  const fundos = []
  for (const r of t.rects) {
    const nx = Math.max(3, Math.min(24, Math.round(r.w / 3)))
    const ny = Math.max(2, Math.min(6, Math.round(r.h / 3)))
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const x = r.x + 1 + ((r.w - 2) * (i + 0.5)) / nx
        const y = r.y + 1 + ((r.h - 2) * (j + 0.5)) / ny
        const bg = px(semLetra, x, y)
        fundos.push(bg)
        if (cor && !t.gradiente) {
          const a = cor[3] * t.opacidade
          const fg = [0, 1, 2].map((k) => a * cor[k] + (1 - a) * bg[k])
          amostras.push(razao(fg, bg))
        }
      }
    // pelos pixels: onde o print normal difere do sem letras, a letra está ali
    for (let x = r.x; x < r.x + r.w; x++)
      for (let y = r.y; y < r.y + r.h; y++) {
        const a = px(normal, x, y)
        const b = px(semLetra, x, y)
        const df = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
        if (df > maxDif) maxDif = df
        if (df > 40) pelosPixels.push(razao(a, b))
      }
  }
  if (fundos.length) fundoMed = [0, 1, 2].map((k) => Math.round(mediana(fundos.map((f) => f[k]))))
  const grande = t.fonte >= 24 || (t.fonte >= 18.66 && t.peso >= 700)
  const minimo = grande ? 3 : 4.5
  const calc = amostras.length ? mediana(amostras) : null
  const pix = pelosPixels.length >= 4 ? pct(pelosPixels, 0.9) : null
  const valor = t.gradiente || t.svg ? pix ?? calc : calc
  // nenhum pixel mudou ao apagar as letras: o texto não aparece (coberto por outra camada, máscara de revelação) — não
  // é contraste, é invisível; vai marcado e fora da lista de contraste
  if (maxDif < 4) return { razao: null, invisivel: true, minimo, grande, fundo: fundoMed }
  return { razao: valor != null ? Math.round(valor * 100) / 100 : null, pior: amostras.length ? Math.round(Math.min(...amostras) * 100) / 100 : null, pixels: pix != null ? Math.round(pix * 100) / 100 : null, minimo, grande, fundo: fundoMed }
}

// ───────────────────────── marcas nos prints ─────────────────────────
const CORES = { alvo: '#ff2d2d', contraste: '#ff2dd2', fonte: '#ff9a1f', vaza: '#2d8cff', coberto: '#ffe02d', sobreposto: '#22e3ff' }
async function marcar(page, caixas) {
  await page.evaluate(
    ({ caixas, CORES }) => {
      const c = document.createElement('div')
      c.id = '__tq_marcas'
      c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
      for (const b of caixas) {
        const d = document.createElement('div')
        const cor = CORES[b.cat]
        d.style.cssText = `position:absolute;left:${b.r.x - 1}px;top:${b.r.y - 1}px;width:${Math.max(2, b.r.w + 2)}px;height:${Math.max(2, b.r.h + 2)}px;outline:2px solid ${cor};outline-offset:0;box-sizing:border-box`
        const l = document.createElement('span')
        l.textContent = b.n
        l.style.cssText = `position:absolute;left:-2px;top:-14px;font:700 10px/12px system-ui,sans-serif;color:#000;background:${cor};padding:0 3px;border-radius:2px;white-space:nowrap`
        d.appendChild(l)
        c.appendChild(d)
      }
      document.documentElement.appendChild(c)
    },
    { caixas, CORES },
  )
}
const desmarcar = (page) => page.evaluate(() => document.getElementById('__tq_marcas')?.remove()).catch(() => {})

const CSS_SEM_LETRA = `*, *::before, *::after, *::placeholder, *::first-line, *::marker { -webkit-text-fill-color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; text-decoration-color: transparent !important; caret-color: transparent !important; transition: none !important; }
text, tspan { fill-opacity: 0 !important; stroke-opacity: 0 !important; }
input::placeholder, textarea::placeholder { color: transparent !important; }`

/** O elemento que rola: o miolo rolável do diálogo (o.raiz) ou o documento. */
async function rolador(page, raizSel) {
  return page.evaluate((raizSel) => {
    const de = document.scrollingElement || document.documentElement
    const raiz = raizSel ? document.querySelector(raizSel) : null
    let melhor = null
    if (raiz) {
      for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
        const s = getComputedStyle(el)
        if (!/auto|scroll/.test(s.overflowY)) continue
        const sobra = el.scrollHeight - el.clientHeight
        if (sobra > 4 && (!melhor || sobra > melhor.sobra)) melhor = { el, sobra }
      }
    }
    if (melhor) {
      window.__tqRol = melhor.el
      return { doc: false, max: melhor.sobra, alt: melhor.el.clientHeight }
    }
    window.__tqRol = de
    return { doc: true, max: Math.max(0, de.scrollHeight - innerHeight), alt: innerHeight }
  }, raizSel ?? null)
}

/**
 * Mede a tela atual inteira (rolando). o.raiz = seletor do diálogo (mede só dentro dele e rola o miolo dele);
 * o.maxPassos (padrão 14); o.semRolar = só a janela atual; o.minimo (padrão 40).
 * Devolve { tela, aparelho, largura, achados: {alvos, textoPequeno, contraste, vaza, cobertos, sobrepostos}, prints, ... }.
 */
export async function auditar(d, tela, o = {}) {
  const { page, nome } = d
  await instalar(page)
  await assentar(page)
  const base = `${slug(nome)}_${slug(tela)}`
  const R = { tela, aparelho: nome, largura: d.a.w, hash: await page.evaluate(() => location.hash), prints: [], passos: 0, rolagem: null, lateral: 0, fixos: [], achados: { alvos: [], textoPequeno: [], contraste: [], vaza: [], cobertos: [], sobrepostos: [], campoZoom: [], textoCortado: [] }, contagem: { alvos: 0, textos: 0 } }
  // print da tela como a pessoa vê (resolução do aparelho)
  const p0 = `${PRINTS}/${base}.png`
  await page.screenshot({ path: p0, timeout: 60000 }).catch(() => {})
  R.prints.push(p0)
  const rol = await rolador(page, o.raiz)
  R.rolagem = rol
  if (o.raiz && rol.doc) {
    // diálogo sem miolo rolável: não rola o documento de trás; confere se ele cabe na janela
    o = { ...o, semRolar: true }
    R.dialogoCabe = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      let L = 1e9, T = 1e9, Rr = -1e9, B = -1e9
      for (const e of [el, ...el.querySelectorAll('*')]) {
        const r = e.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        L = Math.min(L, r.left); T = Math.min(T, r.top); Rr = Math.max(Rr, r.right); B = Math.max(B, r.bottom)
      }
      return { top: Math.round(T), bottom: Math.round(B), janela: innerHeight, cabe: T >= -1 && B <= innerHeight + 1 }
    }, o.raiz)
    if (R.dialogoCabe && !R.dialogoCabe.cabe) console.log(`  !!  ${nome} · ${tela}: o diálogo passa da janela (${R.dialogoCabe.top}→${R.dialogoCabe.bottom} de ${R.dialogoCabe.janela}px) e não tem miolo rolável`)
  }
  const passo = Math.max(120, Math.round(rol.alt * 0.8))
  const posicoes = []
  if (o.semRolar) posicoes.push(null)
  else {
    for (let y = 0; y < rol.max; y += passo) posicoes.push(y)
    posicoes.push(rol.max)
  }
  const maxP = o.maxPassos ?? 14
  if (posicoes.length > maxP) {
    R.cortadoEmPassos = posicoes.length
    posicoes.splice(maxP - 1, posicoes.length - maxP, rol.max)
  }
  const vistos = []
  let n = 0
  const add = (cat, item) => {
    item.n = ++n
    R.achados[cat].push(item)
    return item
  }
  for (let k = 0; k < posicoes.length; k++) {
    const y = posicoes[k]
    if (y != null) {
      await page.evaluate((y) => window.__tqRol.scrollTo({ top: y, behavior: 'instant' }), y)
      await sleep(350)
      await assentar(page, 1800)
    }
    const atual = await page.evaluate(() => Math.round(window.__tqRol === (document.scrollingElement || document.documentElement) ? scrollY : window.__tqRol.scrollTop))
    const ultimo = k === posicoes.length - 1
    const m = await page.evaluate(passoNaPagina, { raizSel: o.raiz ?? null, minimo: o.minimo ?? 40, vistos, rolagem: { ultimo, y: atual, max: rol.max } })
    R.passos++
    R.lateral = Math.max(R.lateral, m.lateral)
    for (const f of m.fixos) if (!R.fixos.some((x) => x.sel === f.sel)) R.fixos.push(f)
    // prints do passo: normal e sem letras (para o contraste), na escala CSS (1 px = 1 px da página)
    const normal = await crus(await page.screenshot({ scale: 'css', animations: 'disabled', caret: 'hide', timeout: 60000 }))
    await page.addStyleTag({ content: CSS_SEM_LETRA }).then((h) => h.evaluate((el) => el.setAttribute('data-tq', 'sem-letra')))
    await sleep(60)
    const semLetra = await crus(await page.screenshot({ scale: 'css', animations: 'disabled', caret: 'hide', timeout: 60000 }))
    await page.evaluate(() => document.querySelectorAll('style[data-tq="sem-letra"]').forEach((s) => s.remove()))
    const caixas = []
    for (const a of m.alvos) {
      vistos.push(a.id)
      R.contagem.alvos++
      if (a.ok) continue
      const it = add('alvos', { ...a, passo: k, rolagem: atual })
      caixas.push({ n: it.n, cat: 'alvo', r: a.r })
    }
    for (const t of m.textos) {
      vistos.push(t.id)
      R.contagem.textos++
      if (t.fonte < 12) {
        const it = add('textoPequeno', { sel: t.sel, texto: t.texto, fonte: t.fonte, peso: t.peso, ocultoLeitor: t.ocultoLeitor, arte: t.arte, r: t.rects[0], passo: k, rolagem: atual })
        caixas.push({ n: it.n, cat: 'fonte', r: t.rects[0] })
      }
      const c = contrasteDe(t, normal, semLetra)
      if (c.razao != null && c.razao < c.minimo) {
        const it = add('contraste', { sel: t.sel, texto: t.texto, fonte: t.fonte, peso: t.peso, cor: t.cor, opacidade: t.opacidade, gradiente: t.gradiente, ...c, ocultoLeitor: t.ocultoLeitor, arte: t.arte, r: t.rects[0], passo: k, rolagem: atual })
        caixas.push({ n: it.n, cat: 'contraste', r: t.rects[0] })
      }
    }
    for (const v of m.vazam) {
      if (R.achados.vaza.some((x) => x.sel === v.sel)) continue
      const it = add('vaza', { ...v, passo: k, rolagem: atual })
      caixas.push({ n: it.n, cat: 'vaza', r: { x: Math.max(0, v.r.x), y: v.r.y, w: Math.min(m.W, v.r.x + v.r.w) - Math.max(0, v.r.x), h: v.r.h } })
    }
    // coberto "sem saída": topo com a rolagem no começo, rodapé com a rolagem no fim, tela que não rola, camada de tela inteira
    const naoRola = rol.max <= 4
    for (const c of m.cobertos) {
      const semSaida = c.ancora === 'tela' || c.ancora === 'meio' || naoRola || (c.ancora === 'topo' && atual <= 2) || (c.ancora === 'base' && atual >= rol.max - 2)
      if (!semSaida) continue
      if (R.achados.cobertos.some((x) => x.id === c.id && x.por === c.por)) continue
      const it = add('cobertos', { ...c, passo: k, rolagem: atual })
      // no print, no máximo 4 caixas por camada que cobre (a tabela inteira atrás do sheet viraria um borrão)
      if (caixas.filter((x) => x.cat === 'coberto' && x.por === c.por).length < 4) caixas.push({ n: it.n, cat: 'coberto', r: c.r, por: c.por })
    }
    for (const c of m.cortados) {
      if (R.achados.textoCortado.some((x) => x.id === c.id)) continue
      const it = add('textoCortado', { ...c, passo: k, rolagem: atual })
      caixas.push({ n: it.n, cat: 'sobreposto', r: c.r })
    }
    for (const c of m.campos) {
      if (R.achados.campoZoom.some((x) => x.id === c.id)) continue
      const it = add('campoZoom', { ...c, passo: k, rolagem: atual })
      caixas.push({ n: it.n, cat: 'fonte', r: c.r })
    }
    for (const s of m.sobrepostos) {
      if (R.achados.sobrepostos.some((x) => (x.ida === s.ida && x.idb === s.idb) || (x.ida === s.idb && x.idb === s.ida))) continue
      const it = add('sobrepostos', { ...s, passo: k, rolagem: atual })
      caixas.push({ n: it.n, cat: 'sobreposto', r: s.r })
    }
    if (caixas.length) {
      await marcar(page, caixas)
      const f = `${PRINTS}/${base}_marcas-${k}.png`
      await page.screenshot({ path: f, scale: 'css', timeout: 60000 }).catch(() => {})
      await desmarcar(page)
      R.prints.push(f)
      for (const cat of Object.keys(R.achados)) for (const it of R.achados[cat]) if (it.passo === k && !it.print) it.print = f
    }
  }
  // volta ao topo
  await page.evaluate(() => window.__tqRol?.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {})
  R.animacoes = await movimento(d, { semEsperar: true })
  R.erros = [...d.erros]
  d.erros.length = 0
  const a = R.achados
  console.log(
    `  ${Object.values(a).some((x) => x.length) || R.lateral > 0 ? '!!' : 'ok'}  ${nome} · ${tela}: ${R.passos} passo(s), ${R.contagem.alvos} alvos, ${R.contagem.textos} textos` +
      `${R.lateral > 0 ? ` · ROLAGEM LATERAL ${R.lateral}px` : ''} · alvos<40 ${a.alvos.length} · texto<12 ${a.textoPequeno.length} · contraste ${a.contraste.length} · vaza ${a.vaza.length} · coberto ${a.cobertos.length} · sobreposto ${a.sobrepostos.length} · campo<16px ${a.campoZoom.length} · texto cortado ${a.textoCortado.length}${R.erros.length ? ` · ${R.erros.length} erro(s) no console` : ''}`,
  )
  return R
}

// ───────────────────────── foco visível ─────────────────────────
/**
 * Tab pelas paradas da tela (até o.max). Para cada uma: recorte com foco (teclado) × sem foco; foco escondido atrás de
 * fixo (logo depois do Tab, com a rolagem que o navegador fez); foco fora do diálogo o.raiz.
 */
export async function focoVisivel(d, tela, o = {}) {
  const { page, nome } = d
  await instalar(page)
  const max = o.max ?? 30
  const R = { tela, aparelho: nome, paradas: 0, semFoco: [], escondido: [], foraDoDialogo: [], foraDaTela: [], ciclo: false }
  // começa do começo (ou de dentro do diálogo, que já pôs o foco nele)
  if (!o.raiz) {
    await page.evaluate(() => {
      document.activeElement?.blur?.()
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    // o ponto de partida da navegação sequencial: o começo do documento (um botão temporário no início do body,
    // focado e removido — sem clicar em nada da página)
    await page.evaluate(() => {
      const b = document.createElement('button')
      b.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
      document.body.prepend(b)
      b.focus()
      b.blur()
      b.remove()
    })
  }
  const paradas = []
  let primeiro = null
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    await sleep(140)
    const info = await page.evaluate(
      ({ raizSel }) => {
        const el = document.activeElement
        if (!el || el === document.body) return { nada: true }
        const { seletor, nomeDe, idDe } = window.__tq
        const r = el.getBoundingClientRect()
        const raiz = raizSel ? document.querySelector(raizSel) : null
        let escondido = null
        if (r.width > 0 && r.height > 0) {
          const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
          if (hit && !el.contains(hit) && !hit.contains(el)) {
            let f = hit
            while (f && f !== document.body && !['fixed', 'sticky'].includes(getComputedStyle(f).position)) f = f.parentElement
            if (f && f !== document.body && !f.contains(el)) escondido = seletor(f)
          }
        }
        return {
          id: idDe(el),
          sel: seletor(el),
          nome: nomeDe(el),
          r: { x: r.left, y: r.top, w: r.width, h: r.height },
          foraDaTela: r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth,
          escondido,
          foraDoDialogo: raiz ? !raiz.contains(el) : false,
        }
      },
      { raizSel: o.raiz ?? null },
    )
    if (info.nada) continue
    if (primeiro == null) primeiro = info.id
    else if (info.id === primeiro) {
      R.ciclo = true
      break
    }
    if (paradas.some((p) => p.id === info.id)) {
      R.ciclo = true
      break
    }
    R.paradas++
    if (info.foraDoDialogo) R.foraDoDialogo.push({ sel: info.sel, nome: info.nome })
    if (info.foraDaTela) R.foraDaTela.push({ sel: info.sel, nome: info.nome })
    if (info.escondido) R.escondido.push({ sel: info.sel, nome: info.nome, por: info.escondido })
    // recorte com foco, com o elemento no meio da janela
    const clip = await page.evaluate(() => {
      const el = document.activeElement
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      const r = el.getBoundingClientRect()
      const x = Math.max(0, r.left - 16)
      const y = Math.max(0, r.top - 16)
      return { x, y, width: Math.max(4, Math.min(innerWidth, r.right + 16) - x), height: Math.max(4, Math.min(innerHeight, r.bottom + 16) - y) }
    })
    await sleep(260) // transições do anel
    const com = await page.screenshot({ clip, scale: 'css', animations: 'disabled', caret: 'hide' }).catch(() => null)
    const h = await page.evaluateHandle(() => document.activeElement)
    paradas.push({ ...info, com, h, clip })
  }
  // sem foco: tira o foco e refaz cada recorte na mesma posição
  await page.evaluate(() => document.activeElement?.blur?.())
  await sleep(260)
  for (const p of paradas) {
    if (!p.com) continue
    // a mesma rolagem do recorte com foco (scrollIntoView de novo) e o MESMO recorte: o que mudou foi só o foco
    // (um "pular para o conteúdo" que só aparece com foco volta para fora da tela e o recorte fica sem ele)
    const vivo = await p.h
      .evaluate((el) => {
        if (!el.isConnected) return false
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        return true
      })
      .catch(() => false)
    if (!vivo) continue
    const clip = p.clip
    await sleep(120)
    const sem = await page.screenshot({ clip, scale: 'css', animations: 'disabled', caret: 'hide' }).catch(() => null)
    if (!sem) continue
    const A = await crus(p.com)
    const B = await crus(sem)
    let mud = 0
    const ww = Math.min(A.w, B.w)
    const hh = Math.min(A.h, B.h)
    for (let y = 0; y < hh; y++)
      for (let x = 0; x < ww; x++) {
        const a = px(A, x, y)
        const b = px(B, x, y)
        if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 48) mud++
      }
    const perimetro = 2 * (p.r.w + p.r.h)
    p.mudou = mud
    if (mud < Math.max(8, perimetro * 0.5)) {
      const f = `${PRINTS}/${slug(nome)}_${slug(tela)}_foco-${R.semFoco.length + 1}.png`
      await p.h.evaluate((el) => el.focus()).catch(() => {})
      await page.keyboard.press('Shift+Tab').catch(() => {})
      await page.keyboard.press('Tab').catch(() => {})
      await sleep(260)
      await page.screenshot({ path: f, clip: { x: 0, y: Math.max(0, clip.y - 120), width: d.a.w, height: Math.min(260, (await page.evaluate(() => innerHeight)) - Math.max(0, clip.y - 120)) } }).catch(() => {})
      await page.evaluate(() => document.activeElement?.blur?.())
      R.semFoco.push({ sel: p.sel, nome: p.nome, pixelsMudaram: mud, perimetro: Math.round(perimetro), print: f })
    }
  }
  for (const p of paradas) await p.h.dispose().catch(() => {})
  console.log(
    `  ${R.semFoco.length || R.escondido.length || R.foraDoDialogo.length ? '!!' : 'ok'}  ${nome} · ${tela} · foco: ${R.paradas} paradas${R.ciclo ? ' (fechou o ciclo)' : ''} · sem foco visível ${R.semFoco.length}${R.semFoco.length ? ` (${R.semFoco.map((s) => `"${s.nome.slice(0, 24)}"`).slice(0, 5).join(', ')})` : ''} · escondido atrás de fixo ${R.escondido.length} · fora do diálogo ${R.foraDoDialogo.length}`,
  )
  return R
}

// ───────────────────────── movimento ─────────────────────────
/** Animações rodando agora + quadros de rAF por segundo + data-motion. */
export async function movimento(d, o = {}) {
  const { page } = d
  await instalar(page)
  if (!o.semEsperar) await sleep(o.espera ?? 1200)
  const r0 = await page.evaluate(() => window.__raf ?? 0)
  await sleep(1000)
  return page.evaluate((r0) => {
    const { seletor } = window.__tq
    const anim = document.getAnimations().filter((a) => a.playState === 'running')
    const lista = anim.map((a) => {
      const ct = a.effect?.getComputedTiming?.() ?? {}
      let props = []
      try {
        props = [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))]
      } catch {}
      const alvo = a.effect?.target
      return {
        nome: a.animationName || a.transitionProperty || a.id || a.constructor.name,
        tipo: a.constructor.name,
        alvo: alvo ? seletor(alvo.nodeType === 1 ? alvo : alvo.parentElement) : '',
        infinita: ct.iterations === Infinity,
        duracao: typeof ct.duration === 'number' ? Math.round(ct.duration) : String(ct.duration),
        props,
      }
    })
    return {
      dataMotion: document.documentElement.getAttribute('data-motion'),
      prefereReduzir: matchMedia('(prefers-reduced-motion: reduce)').matches,
      rafPorSegundo: (window.__raf ?? 0) - r0,
      rodando: lista.length,
      infinitas: lista.filter((x) => x.infinita).length,
      lista: lista.slice(0, 40),
    }
  }, r0)
}

/** Diálogo aberto agora (o de cima), como seletor para o.raiz. */
export async function dialogoAberto(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 10 && r.height > 10 && s.visibility !== 'hidden' && s.display !== 'none'
    })
    const el = ds[ds.length - 1]
    if (!el) return null
    if (el.id) return '#' + CSS.escape(el.id)
    el.setAttribute('data-tq-dialogo', '1')
    document.querySelectorAll('[data-tq-dialogo]').forEach((x) => x !== el && x.removeAttribute('data-tq-dialogo'))
    return '[data-tq-dialogo="1"]'
  })
}
