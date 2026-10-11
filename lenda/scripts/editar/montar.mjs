/**
 * Monta um criativo a partir de um roteiro (EDL) em JSON: cortes das gravações brutas, zoom suave,
 * velocidade, textos animados por cima, trilha original + efeitos e o cartão final.
 *
 *   node scripts/editar/montar.mjs roteiro.json pasta-das-gravacoes pasta-de-saida
 *
 * roteiro = {
 *   nome, bpm, estilo ('hype'|'epico'|'leve'), drop (s), fim (s, a música some a partir daqui),
 *   cenas:  [{ src: 'v-intenso-01.mp4', de: 116.1, ate: 119.0, vel: 1, zoom: [1, 1.1], foco: [0.5, 0.45] }],
 *   textos: [{ de: 0, ate: 2.4, tipo: 'gancho', texto: 'Ele ganhou\n*12 Bolas de Ouro*', anim: 'pop'|'sobe'|'fade', ...opções do textos.mjs }],
 *   efeitos:[{ t: 2.4, tipo: 'whoosh'|'impacto'|'ding'|'riser'|'tick'|'pop', nota?: 0, nivel?: 1 }]
 * }
 * Tempos de textos/efeitos são da linha do tempo FINAL. foco = ponto do quadro que o zoom aproxima (0–1).
 * Saída: <nome>.mp4 (trilha + efeitos) e <nome>-sem-trilha.mp4 (só efeitos, para usar um som do TikTok).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desenharTextos } from './textos.mjs'

const FF = process.env.LENDA_FFMPEG || 'ffmpeg'
const AQUI = dirname(fileURLToPath(import.meta.url))
const W = 1080, H = 1920, FPS = 30
const [arqRoteiro, pastaBrutos, pastaSaida] = process.argv.slice(2)
const r = JSON.parse(readFileSync(arqRoteiro, 'utf8'))
mkdirSync(pastaSaida, { recursive: true })
const tmp = join(pastaSaida, `.${r.nome}`)
mkdirSync(tmp, { recursive: true })
const f2 = (x) => Number(x).toFixed(3)

// 1) cenas → um vídeo só (sem áudio)
const durCena = r.cenas.map((c) => (c.ate - c.de) / (c.vel ?? 1))
const total = durCena.reduce((a, b) => a + b, 0)
const entradas = [], partes = []
r.cenas.forEach((c, i) => {
  entradas.push('-ss', f2(c.de), '-t', f2(c.ate - c.de), '-i', join(pastaBrutos, c.src))
  const d = durCena[i]
  const [z0, z1] = c.zoom ?? [1, 1]
  const [fx, fy] = c.foco ?? [0.5, 0.5]
  // zoom: escala quadro a quadro (eval=frame) e recorta 1080×1920 em volta do foco
  const Z = `(${z0}+(${z1 - z0})*min(t/${f2(Math.max(d, 0.01))},1))`
  const escala = z0 === 1 && z1 === 1
    ? `scale=${W}:${H}:flags=lanczos`
    : `scale=w='2*trunc(${W}*${Z}/2)':h='2*trunc(${H}*${Z}/2)':eval=frame:flags=bicubic,crop=${W}:${H}:x='(in_w-${W})*${fx}':y='(in_h-${H})*${fy}'`
  const vel = c.vel ?? 1
  partes.push(`[${i}:v]setpts=(PTS-STARTPTS)/${vel},fps=${FPS},${escala},setsar=1,format=yuv420p,trim=duration=${f2(d)}[c${i}]`)
})
let grafo = partes.join(';') + ';' + r.cenas.map((_, i) => `[c${i}]`).join('') + `concat=n=${r.cenas.length}:v=1:a=0[base]`

// 2) textos → PNGs → sobrepostos com animação
const textos = (r.textos ?? []).map((t, i) => ({ ...t, id: `t${i}` }))
const pngs = await desenharTextos(textos, join(tmp, 'textos'))
let ultimo = 'base'
const nCenas = r.cenas.length
textos.forEach((t, k) => {
  const idx = nCenas + k
  const dur = t.ate - t.de
  entradas.push('-loop', '1', '-framerate', String(FPS), '-t', f2(dur + 0.05), '-i', pngs[t.id])
  const fi = t.anim === 'corte' ? 0.001 : t.tipo === 'flash' ? 0.02 : 0.16
  const fo = t.tipo === 'flash' ? Math.max(0.05, dur - 0.04) : 0.16
  let cadeia = `[${idx}:v]format=rgba,fade=in:st=0:d=${fi}:alpha=1,fade=out:st=${f2(Math.max(0, dur - fo))}:d=${f2(fo)}:alpha=1`
  let x = '0', y = '0'
  if (t.anim === 'pop') {
    // cresce 86%→104%→100% em 0,24 s
    const S = `if(lt(t,0.14),0.86+0.18*t/0.14,if(lt(t,0.24),1.04-0.04*(t-0.14)/0.10,1))`
    cadeia += `,scale=w='2*trunc(${W}*${S}/2)':h='2*trunc(${H}*${S}/2)':eval=frame`
    x = '(W-w)/2'; y = '(H-h)/2'
  } else if (t.anim === 'sobe' || t.anim == null) {
    y = `if(lt(t-${f2(t.de)},0.22),46*(1-(t-${f2(t.de)})/0.22),0)`
  }
  cadeia += `,setpts=PTS-STARTPTS+${f2(t.de)}/TB[o${k}]`
  grafo += `;${cadeia};[${ultimo}][o${k}]overlay=x='${x}':y='${y}':eof_action=pass:enable='between(t,${f2(t.de)},${f2(t.ate)})'[v${k}]`
  ultimo = `v${k}`
})
grafo += `;[${ultimo}]format=yuv420p[vout]`
writeFileSync(join(tmp, 'grafo.txt'), grafo)

// 3) trilha original + efeitos (com o mesmo comprimento do vídeo)
const plano = { dur: total, bpm: r.bpm ?? 124, estilo: r.estilo ?? 'hype', drop: r.drop ?? null, fim: r.fim ?? null, efeitos: r.efeitos ?? [] }
writeFileSync(join(tmp, 'trilha.json'), JSON.stringify(plano))
const wavM = join(tmp, 'musica.wav'), wavF = join(tmp, 'efeitos.wav')
execFileSync('python3', [join(AQUI, 'trilha.py'), join(tmp, 'trilha.json'), wavM, wavF], { stdio: 'inherit' })

// 4) render: vídeo uma vez (sem áudio) e depois junta cada áudio
const mudo = join(tmp, 'mudo.mp4')
execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-filter_complex_script', join(tmp, 'grafo.txt'), '-map', '[vout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', f2(total), '-movflags', '+faststart', mudo], { stdio: 'inherit' })
for (const [wav, sufixo] of [[wavM, ''], [wavF, '-sem-trilha']]) {
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', mudo, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest', '-movflags', '+faststart', join(pastaSaida, `${r.nome}${sufixo}.mp4`)], { stdio: 'inherit' })
}
console.log(`✔ ${r.nome}: ${total.toFixed(1)} s, ${r.cenas.length} cenas, ${textos.length} textos`)
