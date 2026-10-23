// LENDA v3.5 · painel no celular — 2. AS ABAS: cada aba (e as partes delas) em cada aparelho, tema escuro e claro.
//   LENDA_PAINEL_BASE=<pasta da pilha> node servidor/teste/mobile/painel-abas.mjs [aparelho…]
// Precisa da sessão do Dono que o painel-entrada.mjs grava ($LENDA_PAINEL_BASE/estado-dono.json). Mede rolagem lateral,
// o que passa da borda, alvos < 40 px, texto cortado, fonte dos campos (zoom do iPhone), onde a aba começa (quanto o
// topo fixo + números + "Precisa de atenção" empurram o conteúdo) e se a aba ativa aparece na barra de abas.
// Prints (página inteira) só nos aparelhos de 360 e 390 e nos que acharem algo; nada é alterado no servidor.
import { readFileSync, writeFileSync } from 'node:fs'
import { APARELHOS, BASE, PAINEL, abrir, esperarDecisao, esperarPulso, irAba, lancar, medir, print, relatar, sleep } from './painel-lib.mjs'

const ESTADO = JSON.parse(readFileSync(`${BASE}/estado-dono.json`, 'utf8'))
export const ABAS = [
  ['visao', '#/visao'], ['area', '#/area'], ['usuarios', '#/usuarios'], ['mensagens', '#/mensagens'], ['hall', '#/hall'],
  ['hall-denunciadas', '#/hall?filtro=denunciadas'], ['denuncias', '#/denuncias'], ['indicacoes', '#/indicacoes'], ['desafios', '#/desafios'],
  ['desafios-novo', '#/desafios?parte=novo'], ['conquistas', '#/conquistas'], ['relatorios', '#/relatorios'], ['tempo', '#/tempo'],
  ['registro', '#/registro'], ['registro-seguranca', '#/registro?parte=seguranca'], ['registro-emails', '#/registro?parte=emails'],
  ['saude', '#/saude'], ['equipe', '#/equipe'], ['equipe-papeis', '#/equipe?parte=papeis'], ['equipe-recados', '#/equipe?parte=recados'],
  ['config', '#/config'], ['config-conta', '#/config?parte=conta'], ['config-backup', '#/config?parte=backup'], ['testes', '#/testes'],
]
const PRINCIPAIS = ['galaxy-a', 'iphone-14']
const pedidos = process.argv.slice(2)
const RODADAS = pedidos.length
  ? pedidos.map((n) => [n, n.endsWith('-claro') ? 'claro' : null]).map(([n, t]) => [n.replace(/-claro$/, ''), t])
  : [['galaxy-a', null], ['iphone-14', null], ['galaxy-a', 'claro'], ['iphone-14', 'claro'], ['pequeno-320', null], ['iphone-se', null], ['pixel-7', null], ['deitado', null]]

const browser = await lancar()
const resumo = {}
for (const [nome, tema] of RODADAS) {
  const rot = nome + (tema ? '-' + tema : '')
  const ap = await abrir(browser, nome, { estado: ESTADO, tema: tema ?? undefined, esquema: tema === 'claro' ? 'light' : 'dark' })
  const { page } = ap
  await page.goto(PAINEL + '#/visao')
  await esperarDecisao(page)
  if (!(await page.isVisible('#tela-painel'))) throw new Error(`${rot}: a sessão do Dono não abriu o painel (rode o painel-entrada.mjs antes)`)
  await esperarPulso(page)
  console.log(`\n── ${rot} (${ap.a.w}×${ap.a.h}) ──`)
  resumo[rot] = []
  for (const [id, hash] of ABAS) {
    await irAba(page, hash, 1200)
    await page.evaluate(() => window.scrollTo(0, 0))
    await sleep(150)
    const m = await medir(page)
    const extra = await page.evaluate(() => {
      const t = document.getElementById('titulo-aba').getBoundingClientRect()
      const lat = document.querySelector('.lateral').getBoundingClientRect()
      const nav = document.getElementById('abas')
      const ativo = nav.querySelector('a[aria-current="page"]')
      const ra = ativo ? ativo.getBoundingClientRect() : null
      const rn = nav.getBoundingClientRect()
      const at = document.getElementById('atencao')
      return {
        tituloY: Math.round(t.top + scrollY), topoFixo: Math.round(lat.height), posicaoTopo: getComputedStyle(document.querySelector('.lateral')).position,
        abaAtivaVisivel: !!ra && ra.left >= rn.left - 1 && ra.right <= rn.right + 1, abasRolam: nav.scrollWidth > nav.clientWidth,
        atencao: at.hidden ? 0 : Math.round(at.getBoundingClientRect().height), numeros: Math.round(document.getElementById('numeros-acao').getBoundingClientRect().height),
        janela: innerHeight, temaCss: getComputedStyle(document.body).backgroundColor,
      }
    })
    const ach = relatar(`${id}`, m, { fonte: true })
    console.log(`      a aba começa em y=${extra.tituloY} (janela ${extra.janela}) · topo fixo ${extra.topoFixo}px (${extra.posicaoTopo}) · números ${extra.numeros}px · atenção ${extra.atencao}px · aba ativa na barra: ${extra.abaAtivaVisivel ? 'sim' : 'NÃO'}`)
    if (!extra.abaAtivaVisivel) ach.push('a aba ativa não aparece na barra de abas')
    if (extra.tituloY > extra.janela) ach.push(`o título da aba só aparece rolando (y=${extra.tituloY} > ${extra.janela})`)
    resumo[rot].push({ id, ach, extra, lateral: m.lateral, pequenos: m.pequenos.map((p) => `${p.nome} ${p.w}×${p.h} (${p.onde})`), cortados: m.cortados.filter((c) => !c.reticencias), vazam: m.vazam, fora: m.foraDaJanela })
    if (PRINCIPAIS.includes(nome) || m.lateral > 0 || m.foraDaJanela.length || m.vazam.length) await print(page, rot, `aba-${id}`, { inteira: true })
  }
  if (ap.erros.length) console.log(`  XX  erros no console (${rot}): ${[...new Set(ap.erros)].slice(0, 6).join(' | ')}`)
  if (ap.rede.length) console.log(`  XX  rede (${rot}): ${[...new Set(ap.rede)].slice(0, 6).join(' | ')}`)
  resumo[rot].erros = ap.erros
  await ap.ctx.close()
}
await browser.close()
writeFileSync(`${BASE}/painel-abas.json`, JSON.stringify(resumo, null, 1))
console.log(`\nresumo em ${BASE}/painel-abas.json`)
// código de saída: 1 se alguma aba rolou de lado, passou da borda, vazou da caixa ou deu erro no console
const graves = Object.entries(resumo).flatMap(([rot, abas]) => abas.filter((a) => a.lateral > 0 || a.fora.length || a.vazam.length).map((a) => `${rot}/${a.id}`).concat((abas.erros ?? []).length ? [`${rot}: erros no console`] : []))
console.log(graves.length ? `\n${graves.length} tela(s) com problema de layout: ${graves.slice(0, 30).join(', ')}` : '\nnenhuma tela com rolagem lateral ou conteúdo vazando')
process.exitCode = graves.length ? 1 : 0
