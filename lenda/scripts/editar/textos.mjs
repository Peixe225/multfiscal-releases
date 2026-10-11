/**
 * Textos e cartões que vão por cima dos criativos, desenhados com as fontes e as cores do LENDA
 * (PNG transparente 1080×1920). O vídeo final é montado pelo montar.mjs.
 *
 *   await desenharTextos([{ id, tipo, texto, ... }], pastaSaida)
 *
 * Tipos: gancho (título grande no topo), legenda (caixas brancas estilo TikTok), contador (número
 * dourado + rótulo), chips (fileira de pílulas, uma acesa), selo (etiqueta pequena), nota (selo da
 * Nota de Legado), cta (cartão final com o site), flash (tela branca de transição), faixa (texto
 * no rodapé da área segura).
 * Opções: gancho {tam, fundo: caixa escura atrás}, legenda {escuro}, contador {prefixo, topo: etiqueta
 * acima do número, tam}, nota {nota, tier, rotulo}, cta {texto, url, rodape}; todos aceitam y (px).
 * Área segura do TikTok/Shorts: nada importante nos 10% de cima, nos 22% de baixo e nos 12% da direita.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
// fontes embutidas (data:): a página é montada com setContent e não carrega arquivo local por file://
const fonte = (p) => 'data:font/woff2;base64,' + readFileSync(join(RAIZ, 'node_modules', p)).toString('base64')
const CREST = readFileSync(join(RAIZ, 'public/favicon.svg'), 'utf8')

const CSS = `
@font-face{font-family:'BarlowC';font-weight:800;font-style:italic;src:url('${fonte('@fontsource/barlow-condensed/files/barlow-condensed-latin-800-italic.woff2')}') format('woff2')}
@font-face{font-family:'BarlowC';font-weight:900;font-style:italic;src:url('${fonte('@fontsource/barlow-condensed/files/barlow-condensed-latin-900-italic.woff2')}') format('woff2')}
@font-face{font-family:'BarlowC';font-weight:700;font-style:normal;src:url('${fonte('@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2')}') format('woff2')}
@font-face{font-family:'BarlowC';font-weight:900;font-style:normal;src:url('${fonte('@fontsource/barlow-condensed/files/barlow-condensed-latin-900-normal.woff2')}') format('woff2')}
@font-face{font-family:'Inter';font-weight:100 900;src:url('${fonte('@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2')}') format('woff2')}
@font-face{font-family:'Inter';font-weight:100 900;src:url('${fonte('@fontsource-variable/inter-tight/files/inter-tight-latin-ext-wght-normal.woff2')}') format('woff2');unicode-range:U+0100-024F}
:root{--ouro:#F4C95D;--ouro2:#C8952B;--noite:#07080c}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1920px;background:transparent;overflow:hidden}
.c{position:absolute;left:0;top:0;width:1080px;height:1920px}
.g{position:absolute;left:70px;right:150px;text-align:center;font-family:'BarlowC';font-weight:900;font-style:italic;text-transform:uppercase;color:#fff;line-height:.94;letter-spacing:.005em;
  text-shadow:0 0 2px #000,0 5px 0 rgba(0,0,0,.55),0 0 28px rgba(0,0,0,.65),0 10px 40px rgba(0,0,0,.6);-webkit-text-stroke:3px rgba(0,0,0,.55);paint-order:stroke fill}
.g b{color:var(--ouro);font-weight:900}
.g.f{background:rgba(7,8,12,.84);border-radius:26px;padding:16px 18px 22px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.l{position:absolute;left:60px;right:140px;text-align:center;line-height:1.46}
.l span{font-family:'Inter';font-weight:800;font-size:58px;color:#0b0c10;background:#fff;padding:10px 28px;border-radius:16px;-webkit-box-decoration-break:clone;box-decoration-break:clone;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.l span b{color:#B07A12}
.l.esc span{background:rgba(7,8,12,.94);color:#fff;border:2px solid rgba(244,201,93,.55)}
.l.esc span b{color:var(--ouro)}
.ct{position:absolute;left:0;right:110px;text-align:center;isolation:isolate}
.ct::before,.nt::before{content:'';position:absolute;left:40px;right:-30px;top:-60px;bottom:-50px;background:radial-gradient(closest-side,rgba(7,8,12,.86),rgba(7,8,12,.55) 62%,rgba(7,8,12,0));z-index:-1}
.ct .k,.nt .k{display:inline-block;background:rgba(7,8,12,.9);padding:4px 26px 6px;border-radius:14px;border:2px solid rgba(244,201,93,.45)}
.ct .k{margin-bottom:8px;font-family:'BarlowC';font-weight:800;font-style:italic;font-size:46px;color:var(--ouro);letter-spacing:.06em;text-transform:uppercase}
.ct .n{font-family:'BarlowC';font-weight:900;font-style:italic;font-size:300px;line-height:.85;color:var(--ouro);
  text-shadow:0 0 3px #000,0 10px 0 rgba(0,0,0,.45),0 0 60px rgba(244,201,93,.55),0 0 120px rgba(0,0,0,.6);-webkit-text-stroke:5px rgba(60,35,0,.75);paint-order:stroke fill}
.ct .n small{font-size:150px;vertical-align:.55em;margin-right:8px}
.ct .r{margin-top:6px;font-family:'BarlowC';font-weight:900;font-style:italic;font-size:78px;color:#fff;text-transform:uppercase;letter-spacing:.02em;text-shadow:0 4px 0 rgba(0,0,0,.6),0 0 30px rgba(0,0,0,.8)}
.ch{position:absolute;left:40px;right:120px;display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
.ch i{font-style:normal;font-family:'BarlowC';font-weight:900;font-size:56px;text-transform:uppercase;letter-spacing:.04em;padding:14px 30px;border-radius:999px;color:#fff;background:rgba(7,8,12,.78);border:3px solid rgba(255,255,255,.25);box-shadow:0 10px 30px rgba(0,0,0,.4)}
.ch i.on{background:linear-gradient(180deg,#FFE29A,#E2A93B);color:#1a1205;border-color:#FFE7A8;box-shadow:0 0 0 6px rgba(244,201,93,.25),0 12px 40px rgba(244,201,93,.45)}
.ch i.off{color:rgba(255,255,255,.5);background:rgba(7,8,12,.92);border-color:rgba(255,255,255,.12)}
.se{position:absolute;left:56px;top:210px;font-family:'Inter';font-weight:800;font-size:34px;color:#fff;background:rgba(229,72,77,.92);padding:10px 22px;border-radius:12px;letter-spacing:.02em;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.se.ouro{background:linear-gradient(180deg,#FFE29A,#E2A93B);color:#1a1205}
.nt{position:absolute;left:0;right:110px;text-align:center;isolation:isolate}
.nt .k{font-family:'BarlowC';font-weight:800;font-style:italic;font-size:70px;color:#fff;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 4px 0 rgba(0,0,0,.6)}
.nt .v{font-family:'BarlowC';font-weight:900;font-style:italic;font-size:330px;line-height:.82;color:#fff;text-shadow:0 0 3px #000,0 12px 0 rgba(0,0,0,.45),0 0 80px rgba(0,0,0,.7)}
.nt .t{display:inline-block;margin-top:14px;font-family:'BarlowC';font-weight:900;font-style:italic;font-size:110px;text-transform:uppercase;letter-spacing:.05em;padding:4px 44px 10px;border-radius:22px;color:#1a1205;background:linear-gradient(180deg,#FFE7A8,#E2A93B 60%,#B9832A);box-shadow:0 0 0 8px rgba(244,201,93,.25),0 20px 60px rgba(0,0,0,.55),0 0 100px rgba(244,201,93,.5)}
.nt .t.prata{background:linear-gradient(180deg,#f2f4f8,#a9b0bf);box-shadow:0 0 0 8px rgba(255,255,255,.15),0 20px 60px rgba(0,0,0,.55)}
.nt .t.bronze{background:linear-gradient(180deg,#f0c6a0,#a8683a);box-shadow:0 0 0 8px rgba(200,120,60,.2),0 20px 60px rgba(0,0,0,.55)}
.cta{background:radial-gradient(120% 70% at 50% 40%,rgba(20,18,10,.88),rgba(7,8,12,.96))}
.cta .in{position:absolute;left:70px;right:130px;top:470px;text-align:center}
.cta svg{width:200px;height:200px;filter:drop-shadow(0 0 40px rgba(244,201,93,.55))}
.cta .w{margin-top:10px;font-family:'BarlowC';font-weight:900;font-style:italic;font-size:200px;letter-spacing:.12em;color:#fff;line-height:1}
.cta .s{margin-top:18px;font-family:'Inter';font-weight:700;font-size:48px;color:rgba(255,255,255,.85)}
.cta .u{display:inline-block;margin-top:56px;font-family:'Inter';font-weight:900;font-size:66px;color:#1a1205;background:linear-gradient(180deg,#FFE7A8,#E2A93B);padding:22px 40px;border-radius:26px;box-shadow:0 0 0 8px rgba(244,201,93,.22),0 20px 60px rgba(244,201,93,.35)}
.cta .p{margin-top:34px;font-family:'Inter';font-weight:800;font-size:44px;color:#fff;opacity:.9}
.fl{background:#fff}
.fx{position:absolute;left:60px;right:140px;text-align:center;font-family:'Inter';font-weight:800;font-size:44px;color:#fff;text-shadow:0 3px 12px rgba(0,0,0,.85)}
`
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// *palavra* = destaque dourado; quebra de linha = \n
const rich = (s) => esc(s).replace(/\*([^*]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')

function html(o) {
  const y = o.y ?? null
  switch (o.tipo) {
    case 'gancho': return `<div class="c"><div class="g ${o.fundo ? 'f' : ''}" style="top:${y ?? 260}px;font-size:${o.tam ?? 112}px">${rich(o.texto)}</div></div>`
    case 'legenda': return `<div class="c"><div class="l ${o.escuro ? 'esc' : ''}" style="top:${y ?? 1150}px"><span>${rich(o.texto)}</span></div></div>`
    case 'contador': return `<div class="c"><div class="ct" style="top:${y ?? 230}px">${o.topo ? `<div class="k">${esc(o.topo)}</div>` : ''}<div class="n"${o.tam ? ` style="font-size:${o.tam}px"` : ''}>${o.prefixo ? `<small>${esc(o.prefixo)}</small>` : ''}${esc(o.numero)}</div><div class="r">${rich(o.rotulo)}</div></div></div>`
    case 'chips': return `<div class="c"><div class="ch" style="top:${y ?? 1240}px">${o.itens.map((t, i) => `<i class="${i === o.ativo ? 'on' : o.ativo != null ? 'off' : ''}">${esc(t)}</i>`).join('')}</div></div>`
    case 'selo': return `<div class="c"><div class="se ${o.ouro ? 'ouro' : ''}" style="${y != null ? `top:${y}px` : ''}">${esc(o.texto)}</div></div>`
    case 'nota': return `<div class="c"><div class="nt" style="top:${y ?? 420}px"><div class="k">${esc(o.rotulo ?? 'Nota de Legado')}</div><div class="v">${esc(o.nota)}</div><div class="t ${o.cor ?? ''}">${esc(o.tier)}</div></div></div>`
    case 'cta': return `<div class="c cta"><div class="in">${CREST}<div class="w">LENDA</div><div class="s">${rich(o.texto ?? 'Sua carreira. Suas decisões.')}</div><div class="u">${esc(o.url ?? 'oprojeto.online/lenda')}</div><div class="p">${rich(o.rodape ?? 'Jogue grátis no navegador')}</div></div></div>`
    case 'flash': return `<div class="c fl"></div>`
    case 'faixa': return `<div class="c"><div class="fx" style="top:${y ?? 1380}px">${rich(o.texto)}</div></div>`
    default: throw new Error(`tipo de texto desconhecido: ${o.tipo}`)
  }
}

export async function desenharTextos(lista, pasta) {
  mkdirSync(pasta, { recursive: true })
  const b = await chromium.launch({ executablePath: process.env.LENDA_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="r"></div></body></html>`)
  await p.evaluate(() => document.fonts.ready)
  const saidas = {}
  for (const o of lista) {
    await p.evaluate((h) => { document.getElementById('r').innerHTML = h }, html(o))
    await p.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })
    const f = join(pasta, `${o.id}.png`)
    await p.screenshot({ path: f, omitBackground: true })
    saidas[o.id] = f
  }
  await b.close()
  return saidas
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lista = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  console.log(await desenharTextos(lista, process.argv[3]))
}
