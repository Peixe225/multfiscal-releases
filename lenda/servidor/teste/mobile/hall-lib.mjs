// LENDA v3.5 · suíte mobile · Hall das Lendas, desafios e conquistas — utilidades em cima do carreira-lib.mjs.
//
//   import { lancar, abrirH, ver, tocar, achados, salvarRelatorio } from './hall-lib.mjs'
//
// abrirH(browser, aparelho, o): o aparelho do carreira-lib (viewport, DPR, isMobile, hasTouch, UA de verdade) e mais:
//   o.prod = true  → produção: só leitura. Aborta todo POST/PUT/DELETE para /api/ e o e.php (a medição de visitas) — nada
//                    chega ao banco de produção (nem visita de teste nos números do dono);
//   o.hall = [HallEntry] → semeia o IndexedDB 'hall' do aparelho ("Suas carreiras" do Hall);
//   o.ach  = {id: {unlockedAt}} → semeia as conquistas do aparelho.
// ver(d, tela, o): espera, mede (rolagem lateral, alvos < 40 px, texto cortado, campo coberto, fonte < 16 px), relata no
//   console, tira o print <aparelho>_<tela>.png e guarda o achado para o relatório final (achados[]).
import { mkdirSync, writeFileSync } from 'node:fs'
import { APARELHOS, EXE, abrir, lancar, medir, relatar, print as printBase, sleep, teclado, girar, lento, semLentidao, offline, longasDesde, agora } from './carreira-lib.mjs'
import { pastaPrints, esperado } from './aparelhos.mjs'

export { APARELHOS, EXE, lancar, medir, relatar, sleep, teclado, girar, lento, semLentidao, offline, longasDesde, agora }
// LENDA_PRINTS_HALL (a pasta da área, como antes) ou <LENDA_PRINTS>/hall — ver aparelhos.mjs
export const PRINTS = pastaPrints('hall', process.env.LENDA_PRINTS_HALL)

export async function abrirH(browser, nome, o = {}) {
  // o.prod: a barreira de aparelhos.mjs (e.php respondido aqui com 204, escrita para /api/ barrada pelo CDP e na página)
  const d = await abrir(browser, nome, { lento: o.lento, ajustes: o.ajustes, prod: o.prod })
  d.bloqueados = d.barrados
  if (o.hall || o.ach) {
    await d.ctx.addInitScript(
      ({ hall, ach }) => {
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
      { hall: o.hall ?? null, ach: o.ach ?? null },
    )
  }
  d.prod = !!o.prod
  return d
}

/** Toque de dedo (Playwright tap: touchstart/touchend + o clique sintético, como no celular). */
export async function tocar(page, alvo, o = {}) {
  const loc = typeof alvo === 'string' ? page.locator(alvo).first() : alvo
  await loc.scrollIntoViewIfNeeded({ timeout: o.timeout ?? 8000 }).catch(() => {})
  await loc.tap({ timeout: o.timeout ?? 8000, force: o.force })
  await sleep(o.espera ?? 450)
}

export const achados = []
/** Mede + relata + print. o.raiz: medir só dentro de um seletor (o diálogo); o.inteira: print da página inteira. */
export async function ver(d, tela, o = {}) {
  await sleep(o.espera ?? 600)
  const m = await medir(d.page, { raiz: o.raiz })
  const ach = relatar(`${d.nome} · ${tela}`, m, { fonte: true })
  const f = await printBase(d.page, d.nome, tela, { dir: o.dir ?? PRINTS, inteira: o.inteira })
  achados.push({ aparelho: d.nome, tela, achados: ach, print: f, pequenos: m.pequenos, cortados: m.cortados.filter((c) => !c.reticencias), lateral: m.lateral, fonteCampo: m.fonteCampo, coberto: m.coberto })
  return { m, ach, f }
}
export const print = (d, tela, o = {}) => printBase(d.page, d.nome, tela, { dir: o.dir ?? PRINTS, inteira: o.inteira })

/** Uma observação feita pelo script (comportamento), para o relatório. */
export const notas = []
export function nota(d, tela, ok, texto, extra = {}) {
  const linha = `  ${ok ? 'ok' : '!!'}  ${d?.nome ?? '-'} · ${tela}: ${texto}`
  console.log(linha)
  notas.push({ aparelho: d?.nome ?? null, tela, ok: !!ok, texto, ...extra })
  return !!ok
}

/** Os erros de console/rede do aparelho desde a última chamada (e zera). */
export function errosDe(d, ignorar = /status of 401|ERR_BLOCKED_BY_CLIENT|blockedbyclient|ERR_(FAILED|ABORTED).*e\.php/) {
  const e = [...d.erros, ...d.rede].filter((x) => !ignorar.test(x) && !esperado(x))
  d.erros.length = 0
  d.rede.length = 0
  return e
}

/**
 * Fecha o script: código 1 se alguma observação saiu ruim (nota com ok=false) ou, com o.telas, se alguma tela medida
 * teve achado (rolagem lateral, texto cortado, campo < 16 px, campo escondido pelo teclado; alvos < 40 px só com o.alvos).
 */
export function fimHall(o = {}) {
  const ruins = notas.filter((n) => !n.ok)
  const telas = o.telas
    ? achados.filter((a) => a.lateral > 0 || a.cortados.length || a.fonteCampo.length || (a.coberto && (a.coberto.fora || a.coberto.porCima)) || (o.alvos && a.pequenos.length))
    : []
  console.log(`\n${achados.length} telas medidas · ${telas.length} com achado que reprova · ${ruins.length} observação(ões) ruim(ns)`)
  for (const n of ruins.slice(0, 30)) console.log(`   XX ${n.aparelho ?? '-'} · ${n.tela}: ${n.texto}`)
  for (const t of telas.slice(0, 30)) console.log(`   XX ${t.aparelho} · ${t.tela}: ${t.achados.join(' | ')}`)
  process.exitCode = ruins.length || telas.length ? 1 : 0
  return ruins.length + telas.length
}

export function salvarRelatorio(nome) {
  const f = `${PRINTS}/${nome}.json`
  writeFileSync(f, JSON.stringify({ quando: new Date().toISOString(), achados, notas }, null, 1))
  console.log(`relatório: ${f}`)
  return f
}

/** Espera a tela "sossegar": rota certa, sem skeleton de carregamento e fontes prontas. */
export async function esperarTela(page, sel, ms = 30000) {
  await page.waitForSelector(sel, { timeout: ms })
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await sleep(300)
}
