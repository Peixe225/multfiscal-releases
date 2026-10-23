#!/usr/bin/env node
// LENDA v3.5 · suíte mobile · TOQUE — os piores casos a partir dos relatórios JSON do toque-rotas.mjs.
//
//   node servidor/teste/mobile/toque-relatorio.mjs toque-local.json [toque-prod.json …] > toque-piores.md
//   node servidor/teste/mobile/toque-relatorio.mjs --alvo local|prod     (lê <pasta do toque>/toque-<alvo>.json e grava
//                                                                         toque-<alvo>-piores.md ao lado)
//
// Sai com código 1 quando há algo GRAVE (graves() abaixo): rolagem lateral, elemento interativo ou texto vazando a
// largura da janela, campo com fonte < 16 px (zoom do iPhone), texto cortado sem reticências, diálogo que não cabe nem
// rola, falha de navegação, erro de JavaScript no console, ou botão (não link no meio do texto, não arte) com o menor
// lado < 32 px. Contraste, texto < 12 px e alvos entre 32 e 40 px ficam no relatório (são acabamento, não quebra).
//
// Junta as medidas de várias rodadas (local, produção), agrupa por seletor (sem os :nth-of-type, que só mudam de linha
// para linha da mesma lista) e ordena pelo pior valor. "arte" = texto/alvo dentro de uma ilustração aria-hidden grande
// (a arte da Home, o cartão do jogador desenhado): vai para o fim de cada lista.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// sem os :nth-of-type e com os ids que o React gera (useId: #_r_2k_, #sc_r_9p_) trocados por um curinga
const semN = (s) =>
  String(s ?? '')
    .replace(/:nth-of-type\(\d+\)/g, '')
    .replace(/#(sc)?_?r_[a-z0-9]+_/gi, '#$1_r_*_')
function grupo(lista, chave) {
  const m = new Map()
  for (const x of lista) {
    const k = chave(x)
    if (!m.has(k)) m.set(k, { ...x, larguras: new Set(), telas: new Set(), alvos: new Set(), vezes: 0 })
    const g = m.get(k)
    g.larguras.add(String(x.largura))
    g.telas.add(x.tela)
    g.alvos.add(x.alvo)
    g.vezes++
    if (x.pior < g.pior) Object.assign(g, { ...x, larguras: g.larguras, telas: g.telas, alvos: g.alvos, vezes: g.vezes })
  }
  return [...m.values()]
}
const L = (g) => [...g.larguras].sort().join('/') + (g.alvos.size > 1 || [...g.alvos][0] !== 'local' ? ` (${[...g.alvos].join('+')})` : '')
const T = (g) => [...g.telas].slice(0, 4).join(', ') + (g.telas.size > 4 ? ` (+${g.telas.size - 4})` : '')
const esc = (s) => String(s ?? '').replace(/\|/g, '/')
const arteDepois = (a, b) => (a.arte ? 1 : 0) - (b.arte ? 1 : 0)

export function piores(relatorios) {
  const telas = relatorios.flatMap((r) => r.telas.map((t) => ({ ...t, alvo: r.alvo })))
  const foco = relatorios.flatMap((r) => r.foco.map((f) => ({ ...f, alvo: r.alvo })))
  const movimento = relatorios.flatMap((r) => r.movimento ?? [])
  const falhas = relatorios.flatMap((r) => r.falhas.map((f) => ({ ...f, alvo: r.alvo })))
  const todos = (cat) => telas.flatMap((t) => (t.achados[cat] ?? []).map((a) => ({ ...a, tela: t.tela, largura: t.largura, alvo: t.alvo })))
  const md = []
  md.push(`# Toque e legibilidade — ${relatorios.map((r) => `${r.alvo} (${r.url}, ${r.quando})`).join(' + ')}`, '')
  md.push(`Telas medidas: ${telas.length}. Falhas de navegação: ${falhas.length}.`, '')
  const lat = telas.filter((t) => t.lateral > 0)
  md.push('## Rolagem lateral', lat.length ? lat.map((t) => `- ${t.largura}px ${t.tela}: ${t.lateral}px — ${t.prints[0]}`).join('\n') : '- nenhuma', '')

  const alvos = grupo(
    todos('alvos').map((a) => ({ ...a, pior: Math.min(a.w, a.h) })),
    (a) => semN(a.sel),
  ).sort((a, b) => arteDepois(a, b) || a.pior - b.pior || b.vezes - a.vezes)
  md.push(`## Alvos de toque < 40 px (${alvos.length} grupos de seletor)`, '| menor lado | tamanho | nome | seletor | vão até o vizinho | vezes | larguras | telas | print |', '|---|---|---|---|---|---|---|---|---|')
  for (const a of alvos.slice(0, 120)) md.push(`| ${a.pior} | ${a.w}×${a.h}${a.noTexto ? ' (link no texto)' : ''}${a.arte ? ' (arte)' : ''} | ${esc(a.nome)} | \`${a.sel}\` | ${a.vizinho ?? '-'} px | ${a.vezes} | ${L(a)} | ${T(a)} | ${a.print ?? ''} |`)
  md.push('')

  const peq = grupo(
    todos('textoPequeno').map((a) => ({ ...a, pior: a.fonte })),
    (a) => semN(a.sel),
  ).sort((a, b) => arteDepois(a, b) || a.pior - b.pior)
  md.push(`## Texto < 12 px (${peq.length} grupos)`, '| px | texto | seletor | vezes | larguras | telas | print |', '|---|---|---|---|---|---|---|')
  for (const a of peq.slice(0, 150)) md.push(`| ${a.fonte} | ${esc(a.texto)}${a.arte ? ' (arte decorativa)' : a.ocultoLeitor ? ' (aria-hidden)' : ''} | \`${a.sel}\` | ${a.vezes} | ${L(a)} | ${T(a)} | ${a.print ?? ''} |`)
  md.push('')

  const con = grupo(
    todos('contraste').map((a) => ({ ...a, pior: a.razao })),
    (a) => semN(a.sel),
  ).sort((a, b) => arteDepois(a, b) || a.pior - b.pior)
  md.push(`## Contraste abaixo do mínimo (${con.length} grupos)`, '| razão | mínimo | px | texto | cor | fundo medido | seletor | vezes | larguras | telas | print |', '|---|---|---|---|---|---|---|---|---|---|---|')
  for (const a of con.slice(0, 150)) md.push(`| ${a.razao} | ${a.minimo} | ${a.fonte} | ${esc(a.texto)}${a.arte ? ' (arte decorativa)' : a.ocultoLeitor ? ' (aria-hidden)' : ''}${a.gradiente ? ' (gradiente)' : ''} | ${a.cor}${a.opacidade < 1 ? ` ×${a.opacidade}` : ''} | rgb(${a.fundo?.join(',')}) | \`${a.sel}\` | ${a.vezes} | ${L(a)} | ${T(a)} | ${a.print ?? ''} |`)
  md.push('')

  const zoom = grupo(
    todos('campoZoom').map((a) => ({ ...a, pior: a.fonte })),
    (a) => a.sel.replace(/#sc_r_\w+_/, '#sc_r_*').replace(/#_r_\w+_/, '#_r_*'),
  )
  md.push(`## Campo com fonte < 16 px (o Safari do iPhone dá zoom ao tocar) (${zoom.length})`, ...zoom.map((a) => `- ${a.fonte}px · \`${a.sel}\` "${a.nome}" · ${L(a)} · ${T(a)} · ${a.print ?? ''}`), '')

  const cort = grupo(
    todos('textoCortado').map((a) => ({ ...a, pior: a.visivel })),
    (a) => semN(a.sel),
  ).sort((a, b) => a.pior - b.pior)
  md.push(`## Texto cortado por um contêiner (sem reticências, sem rolagem) (${cort.length})`, ...cort.map((a) => `- ${a.visivel}% visível · "${esc(a.texto)}" · \`${a.sel}\` cortado por \`${a.por}\` · ${a.vezes}× · ${L(a)} · ${T(a)} · ${a.print ?? ''}`), '')

  const vaz = grupo(
    todos('vaza').map((a) => ({ ...a, pior: -a.passa })),
    (a) => semN(a.sel),
  ).sort((a, b) => a.pior - b.pior)
  md.push(`## Vaza a largura da janela (${vaz.length})`, ...vaz.map((a) => `- ${a.passa}px à ${a.lado} · ${a.decorativo ? 'decorativo' : a.interativo ? 'INTERATIVO' : 'texto'} · \`${a.sel}\` "${esc(a.nome).slice(0, 50)}" · ${a.vezes}× · ${L(a)} · ${T(a)} · ${a.print ?? ''}`), '')

  // cobertos: uma linha por camada que cobre (o sheet da decisão cobre a tabela inteira atrás dele)
  const porCamada = grupo(
    todos('cobertos').map((a) => ({ ...a, pior: 0 })),
    (a) => `${a.tela}|${a.largura}|${semN(a.por)}`,
  )
  const camadas = grupo(
    porCamada.map((c) => ({ ...c, pior: 0 })),
    (c) => semN(c.por),
  )
  md.push(`## Coberto por camada fixa/sticky, sem rolagem que resolva (${camadas.length} camadas)`)
  for (const c of camadas) {
    const itens = todos('cobertos').filter((a) => semN(a.por) === semN(c.por))
    const ex = [...new Set(itens.map((a) => `${a.tipo} "${String(a.nome).slice(0, 28)}"`))].slice(0, 8)
    md.push(`- sob \`${c.por}\` (${c.pos}, ${c.ancora}${c.porNome ? `, "${c.porNome}"` : ''}): ${itens.length} itens — ${ex.join(', ')} · ${L(c)} · ${T(c)} · ${itens.find((a) => a.print)?.print ?? ''}`)
  }
  md.push('')

  const sob = grupo(
    todos('sobrepostos').map((a) => ({ ...a, pior: 0 })),
    (a) => `${semN(a.a)}|${semN(a.b)}`,
  )
  md.push(`## Texto sobre texto (${sob.length})`, ...sob.slice(0, 60).map((a) => `- "${a.ta}" × "${a.tb}" · \`${a.a}\` × \`${a.b}\` · ${a.vezes}× · ${L(a)} · ${T(a)} · ${a.print ?? ''}`), '')

  const semFoco = foco.flatMap((f) => f.semFoco.map((s) => ({ ...s, tela: f.tela, largura: f.largura, alvo: f.alvo })))
  md.push(`## Foco pelo teclado sem indicador visível (ou recortado) (${semFoco.length})`, ...grupo(semFoco.map((s) => ({ ...s, pior: s.pixelsMudaram })), (s) => semN(s.sel)).map((s) => `- \`${s.sel}\` "${esc(s.nome).slice(0, 40)}" (${s.pixelsMudaram} px mudaram; perímetro ${s.perimetro}) · ${L(s)} · ${T(s)} · ${s.print}`), '')
  const escd = foco.flatMap((f) => f.escondido.map((s) => ({ ...s, tela: f.tela, largura: f.largura })))
  md.push(`## Foco escondido atrás de camada fixa (${escd.length})`, ...escd.map((s) => `- \`${s.sel}\` "${esc(s.nome).slice(0, 40)}" atrás de \`${s.por}\` · ${s.largura} · ${s.tela}`), '')
  const fora = foco.flatMap((f) => f.foraDoDialogo.map((s) => ({ ...s, tela: f.tela, largura: f.largura })))
  md.push(`## Foco que sai do diálogo aberto (${fora.length})`, ...fora.map((s) => `- \`${s.sel}\` "${esc(s.nome).slice(0, 40)}" · ${s.largura} · ${s.tela}`), '')

  if (movimento.length) {
    md.push('## Movimento (390 px): sem preferência × prefers-reduced-motion: reduce', '| tela | normal: rodando/infinitas/rAF por s | reduzir: data-motion · rodando/infinitas/rAF por s | o que ainda roda com "reduzir" |', '|---|---|---|---|')
    const normal = movimento.filter((m) => m.largura === '390')
    for (const r of movimento.filter((m) => m.largura === '390-reduzir')) {
      const n = normal.find((x) => x.tela === r.tela)
      md.push(`| ${r.tela} | ${n ? `${n.rodando}/${n.infinitas}/${n.rafPorSegundo}` : '-'} | ${r.dataMotion} · ${r.rodando}/${r.infinitas}/${r.rafPorSegundo} | ${r.lista.map((a) => `${a.nome}${a.infinita ? '∞' : ''} (${a.props.join(',')}) em \`${a.alvo}\``).slice(0, 6).join('; ')} |`)
    }
    md.push('')
  }
  const naoCabe = telas.filter((t) => t.dialogoCabe && !t.dialogoCabe.cabe)
  md.push(`## Diálogo que passa da janela sem rolar (${naoCabe.length})`, ...naoCabe.map((t) => `- ${t.largura} · ${t.tela}: ${t.dialogoCabe.top}→${t.dialogoCabe.bottom} de ${t.dialogoCabe.janela}px · ${t.prints[0]}`), '')
  md.push(`## Falhas de navegação (${falhas.length})`, ...falhas.map((f) => `- ${f.alvo} · ${f.largura} · ${f.tela}: ${f.erro} · ${f.print}`), '')
  const erros = telas.filter((t) => t.erros?.length)
  md.push(`## Erros no console (${erros.reduce((s, t) => s + t.erros.length, 0)})`, ...erros.map((t) => `- ${t.alvo} · ${t.largura} · ${t.tela}: ${t.erros.slice(0, 3).join(' · ')}`), '')
  return md.join('\n')
}

/** O que reprova (lista de frases); vazia = passou. */
export function graves(relatorios) {
  const telas = relatorios.flatMap((r) => r.telas.map((t) => ({ ...t, alvo: r.alvo })))
  const todos = (cat) => telas.flatMap((t) => (t.achados[cat] ?? []).map((a) => ({ ...a, tela: t.tela, largura: t.largura, alvo: t.alvo })))
  const g = []
  for (const t of telas.filter((t) => t.lateral > 0)) g.push(`rolagem lateral de ${t.lateral}px · ${t.largura} · ${t.tela}`)
  for (const a of todos('vaza').filter((a) => !a.decorativo && a.passa > 2)) g.push(`vaza ${a.passa}px à ${a.lado} (${a.interativo ? 'interativo' : 'texto'}) · ${a.sel} "${String(a.nome).slice(0, 40)}" · ${a.largura} · ${a.tela}`)
  for (const a of todos('campoZoom')) g.push(`campo com ${a.fonte}px (zoom do iPhone) · ${a.sel} "${a.nome}" · ${a.largura} · ${a.tela}`)
  for (const a of todos('textoCortado').filter((a) => !a.arte && a.visivel < 90)) g.push(`texto cortado (${a.visivel}% visível) "${String(a.texto).slice(0, 40)}" · ${a.sel} · ${a.largura} · ${a.tela}`)
  for (const t of telas.filter((t) => t.dialogoCabe && !t.dialogoCabe.cabe)) g.push(`diálogo passa da janela sem rolar · ${t.largura} · ${t.tela}`)
  for (const r of relatorios) for (const f of r.falhas) g.push(`falha de navegação · ${r.alvo} · ${f.largura} · ${f.tela}: ${f.erro}`)
  const ESPERADOS = /perfil\.php.*404|status of 401|ERR_BLOCKED_BY_CLIENT|blockedbyclient|barrado: produção só leitura|ERR_ABORTED.*e\.php/
  for (const t of telas) for (const e of t.erros ?? []) if (!ESPERADOS.test(e)) g.push(`erro no console · ${t.largura} · ${t.tela}: ${String(e).slice(0, 140)}`)
  for (const a of todos('alvos').filter((a) => !a.noTexto && !a.arte && Math.min(a.w, a.h) < 32)) g.push(`alvo de toque ${a.w}×${a.h} · ${a.sel} "${String(a.nome).slice(0, 40)}" · ${a.largura} · ${a.tela}`)
  return [...new Set(g)]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const iAlvo = process.argv.indexOf('--alvo')
  let arqs = process.argv.slice(2).filter((a, i, l) => !a.startsWith('--') && l[i - 1] !== '--alvo')
  let saida = null
  if (iAlvo > 0) {
    const { PRINTS } = await import('./toque-lib.mjs')
    const alvo = process.argv[iAlvo + 1]
    arqs = [`${PRINTS}/toque-${alvo}.json`]
    saida = `${PRINTS}/toque-${alvo}-piores.md`
  }
  if (!arqs.length) {
    console.error('uso: node toque-relatorio.mjs relatorio.json [outro.json …]  |  node toque-relatorio.mjs --alvo local|prod')
    process.exit(2)
  }
  const rels = arqs.map((a) => JSON.parse(readFileSync(a, 'utf8')))
  const md = piores(rels)
  if (saida) {
    writeFileSync(saida, md)
    console.log(`relatório: ${saida}`)
  } else process.stdout.write(md)
  const gs = graves(rels)
  console.error(`\ntoque-relatorio: ${gs.length} achado(s) grave(s)`)
  for (const x of gs.slice(0, 60)) console.error(`   XX ${x}`)
  process.exitCode = gs.length ? 1 : 0
}
