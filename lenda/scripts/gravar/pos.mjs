/**
 * Pós-produção das gravações: capas (JPG), cortes rápidos prontos para postar e a compilação
 * "do pior ao melhor".
 *
 *   node scripts/gravar/pos.mjs saida/          (LENDA_RECOMPRIMIR=1 recomprime o que foi gravado em ultrafast)
 *
 * Para cada saida/<nome>.mp4 + .json: <nome>.jpg (capa no momento da nota), <nome>-mini.jpg (miniatura
 * para o guia), <nome>-corte.mp4 (20–35 s: criação, títulos, nota). No fim: do-pior-ao-melhor.mp4.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const FF = process.env.LENDA_FFMPEG || 'ffmpeg'
const dir = process.argv[2]
const ff = (args) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
const metas = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => ({ f, m: JSON.parse(readFileSync(join(dir, f), 'utf8')) })).filter((x) => x.m.ok && x.m.segundos)

const quadro = (mp4, t, out, w) => ff(['-ss', String(Math.max(0, t)), '-i', mp4, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', out])
const achar = (m, o) => m.marcas.find((x) => x.o === o)
const todas = (m, o) => m.marcas.filter((x) => x.o === o)

function cortes(m) {
  const dur = m.segundos
  const seg = []
  if (m.tipo === 'classico') {
    const c = achar(m, 'carreira'); if (c) seg.push([Math.max(0, c.t - 2.5), c.t + 1.5])
    const tit = todas(m, 'titulo').slice(-3)
    for (const t of tit) seg.push([t.t - 0.3, t.t + 3.2])
    if (!tit.length) { const d = todas(m, 'decisao'); for (const x of d.slice(1, 3)) seg.push([x.t - 0.5, x.t + 4]) }
    const f = achar(m, 'fim'); if (f) seg.push([f.t, f.t + 3])
    const n = achar(m, 'nota'); if (n) seg.push([n.t - 0.8, Math.min(dur, n.t + 4.5)])
    const k = achar(m, 'card'); if (k) seg.push([k.t - 0.2, Math.min(dur, k.t + 3.2)])
  } else if (m.tipo === 'live') {
    seg.push([0, 6])
    const cr = achar(m, 'criacao'); if (cr && cr.t > 6) seg.push([cr.t, cr.t + 5])
    const na = achar(m, 'nasce'); if (na) seg.push([na.t, na.t + 4.5])
    const v = todas(m, 'votacao'); if (v[1]) seg.push([v[1].t, v[1].t + 9])
    const tit = todas(m, 'titulo').slice(-2); for (const t of tit) seg.push([t.t - 0.3, t.t + 3])
    const f = achar(m, 'fim'); if (f) seg.push([f.t, Math.min(dur, f.t + 7)])
  } else return []
  // junta sobreposições e limita ao vídeo
  const out = []
  for (const [a, b] of seg.map(([a, b]) => [Math.max(0, a), Math.min(dur, b)]).filter(([a, b]) => b - a > 0.8).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 0.3) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

function montar(mp4list, out) {
  // mp4list: [{ mp4, a, b }] → um vídeo só (sem áudio), mesmos fps/tamanho
  const inputs = [], parts = []
  mp4list.forEach((s, i) => { inputs.push('-ss', s.a.toFixed(2), '-t', (s.b - s.a).toFixed(2), '-i', s.mp4); parts.push(`[${i}:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p[v${i}]`) })
  const filtro = parts.join(';') + ';' + mp4list.map((_, i) => `[v${i}]`).join('') + `concat=n=${mp4list.length}:v=1:a=0[o]`
  ff([...inputs, '-filter_complex', filtro, '-map', '[o]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', out])
}

const resumo = []
for (const { f, m } of metas) {
  const nome = f.replace(/\.json$/, '')
  const mp4 = join(dir, `${nome}.mp4`)
  if (!existsSync(mp4)) continue
  // gravado com LENDA_PRESET=ultrafast (arquivo grande): recomprime uma vez, com a qualidade de entrega
  const marcaRec = join(dir, `.${nome}.recomprimido`)
  if (process.env.LENDA_RECOMPRIMIR === '1' && !existsSync(marcaRec)) {
    const tmp = join(dir, `.${nome}.tmp.mp4`)
    ff(['-i', mp4, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp])
    renameSync(tmp, mp4)
    writeFileSync(marcaRec, '')
  }
  const capaT = m.tipo === 'classico' ? (achar(m, 'nota')?.t ?? m.segundos - 3) + 1.4 : m.tipo === 'live' ? (todas(m, 'titulo').at(-1)?.t ?? achar(m, 'nasce')?.t ?? 5) + 1.2 : 4
  const w = m.formato === 'vertical' ? 720 : 1280
  if (!existsSync(join(dir, `${nome}.jpg`))) quadro(mp4, capaT, join(dir, `${nome}.jpg`), w)
  if (!existsSync(join(dir, `${nome}-mini.jpg`))) quadro(mp4, capaT, join(dir, `${nome}-mini.jpg`), m.formato === 'vertical' ? 240 : 400)
  const c = cortes(m)
  if (c.length && !existsSync(join(dir, `${nome}-corte.mp4`))) montar(c.map(([a, b]) => ({ mp4, a, b })), join(dir, `${nome}-corte.mp4`))
  resumo.push({ nome, cortes: c, capaT })
  console.log('✔', nome, c.length ? `corte ${c.reduce((s, [a, b]) => s + b - a, 0).toFixed(1)}s` : '')
}

// compilação: a revelação da nota, da pior para a melhor (só verticais do Clássico)
const ORDEM = ['pessima', 'ruim', 'mediana', 'boa', 'otima', 'extraordinaria']
const rev = metas.filter(({ m }) => m.tipo === 'classico' && m.formato === 'vertical' && achar(m, 'nota'))
  .map(({ f, m }) => ({ mp4: join(dir, f.replace(/\.json$/, '.mp4')), nota: m.hall?.[0]?.legacy?.score ?? m.esperado?.score ?? 0, faixa: m.faixa, t: achar(m, 'nota').t }))
const escolha = []
for (const fx of ORDEM) {
  const g = rev.filter((r) => r.faixa === fx).sort((a, b) => a.nota - b.nota)
  if (g.length) escolha.push(g[0], ...(g.length > 2 ? [g[g.length - 1]] : []))
}
escolha.sort((a, b) => a.nota - b.nota)
if (escolha.length >= 3 && !existsSync(join(dir, 'do-pior-ao-melhor.mp4'))) {
  montar(escolha.map((r) => ({ mp4: r.mp4, a: Math.max(0, r.t - 0.6), b: r.t + 3.4 })), join(dir, 'do-pior-ao-melhor.mp4'))
  console.log('✔ do-pior-ao-melhor', escolha.map((r) => r.nota).join(' → '))
}
if (existsSync(join(dir, 'do-pior-ao-melhor.mp4')) && !existsSync(join(dir, 'do-pior-ao-melhor.json'))) {
  // cada trecho tem 4 s: as marcas dizem qual nota aparece em cada um
  writeFileSync(join(dir, 'do-pior-ao-melhor.json'), JSON.stringify({ ok: true, tipo: 'compilacao', faixa: 'compilacao', formato: 'vertical', segundos: escolha.length * 4,
    marcas: escolha.map((r, i) => ({ t: i * 4, o: 'nota', escolha: `Nota ${r.nota} (${r.faixa})` })), notas: escolha.map((r) => r.nota) }, null, 1))
  quadro(join(dir, 'do-pior-ao-melhor.mp4'), escolha.length * 4 - 1.5, join(dir, 'do-pior-ao-melhor.jpg'), 720)
  quadro(join(dir, 'do-pior-ao-melhor.mp4'), escolha.length * 4 - 1.5, join(dir, 'do-pior-ao-melhor-mini.jpg'), 240)
}
writeFileSync(join(dir, '_pos.json'), JSON.stringify({ resumo, compilacao: escolha.map((r) => ({ nota: r.nota, faixa: r.faixa, mp4: r.mp4.split('/').pop() })) }, null, 1))
