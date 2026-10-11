/**
 * Página de download dos criativos editados: vídeo, versão sem trilha, legenda pronta e hashtags.
 *
 *   node scripts/editar/pagina.mjs pasta-dos-editados pasta-do-site
 *
 * Lê scripts/editar/legendas.json, copia os .mp4 (com e sem trilha) para pasta-do-site, tira uma capa de
 * cada um e escreve index.html + copiar.js (o botão "Copiar legenda"; script à parte por causa da CSP).
 * Depois é só subir a pasta: node scripts/publicar-hostinger.mjs pasta-do-site lenda/criativos/editados
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FF = process.env.LENDA_FFMPEG || 'ffmpeg'
const AQUI = dirname(fileURLToPath(import.meta.url))
const [orig, dest] = process.argv.slice(2)
if (!orig || !dest) { console.error('uso: node scripts/editar/pagina.mjs pasta-dos-editados pasta-do-site'); process.exit(2) }
mkdirSync(dest, { recursive: true })
const L = JSON.parse(readFileSync(join(AQUI, 'legendas.json'), 'utf8'))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const segundos = (mp4) => {
  let err = ''
  try { execFileSync(FF, ['-hide_banner', '-i', mp4], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { err = String(e.stderr) }
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return m ? Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0
}

const cards = L.ordem.map((nome, i) => {
  const v = L.videos[nome]
  for (const f of [`${nome}.mp4`, `${nome}-sem-trilha.mp4`]) copyFileSync(join(orig, f), join(dest, f))
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1.0', '-i', join(orig, `${nome}.mp4`), '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', join(dest, `${nome}.jpg`)])
  const mb = (f) => (statSync(join(dest, f)).size / 1e6).toFixed(0)
  const texto = `${v.legenda}\n\n${L.hashtags}${v.extra ? ' ' + v.extra : ''}`
  return `<article class="c">
  <video controls playsinline preload="none" poster="${nome}.jpg" src="${nome}.mp4"></video>
  <div class="b">
    <div class="q">${i + 1} · ${esc(v.quando)}</div>
    <h2>${esc(v.titulo)} <span>${segundos(join(orig, `${nome}.mp4`))}s</span></h2>
    <div class="d"><a class="btn ouro" href="${nome}.mp4" download>Baixar com trilha · ${mb(`${nome}.mp4`)} MB</a><a class="btn" href="${nome}-sem-trilha.mp4" download>Sem trilha (som do TikTok)</a></div>
    <pre id="t${i}">${esc(texto)}</pre>
    <button class="btn cp" data-alvo="t${i}">Copiar legenda</button>
  </div>
</article>`
})

writeFileSync(join(dest, 'index.html'), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LENDA · Criativos editados</title><link rel="icon" href="../../favicon.svg"><meta name="robots" content="noindex">
<style>
:root{--bg:#0b0c10;--card:#15171d;--tx:#f2f2f2;--mut:#9aa0aa;--ouro:#F4C95D;--borda:rgba(255,255,255,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:28px 16px 8px;max-width:1180px;margin:0 auto}h1{margin:0;font-size:28px;letter-spacing:.02em}h1 b{color:var(--ouro)}
header p{color:var(--mut);margin:6px 0 0;max-width:760px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;padding:18px 16px 48px;max-width:1180px;margin:0 auto}
.c{background:var(--card);border:1px solid var(--borda);border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
video{width:100%;aspect-ratio:9/16;max-height:72vh;object-fit:contain;background:#000;display:block}
.b{padding:14px;display:flex;flex-direction:column;gap:10px}.q{color:var(--ouro);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
h2{margin:0;font-size:20px}h2 span{color:var(--mut);font-weight:500;font-size:14px}
.d{display:flex;flex-wrap:wrap;gap:8px}
.btn{appearance:none;border:1px solid var(--borda);background:#1f222a;color:var(--tx);padding:9px 12px;border-radius:10px;font:600 14px system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.ouro{background:linear-gradient(180deg,#FFE7A8,#E2A93B);color:#1a1205;border:0}.btn.cp.ok{border-color:var(--ouro);color:var(--ouro)}
pre{margin:0;white-space:pre-wrap;word-break:break-word;background:#0f1116;border:1px solid var(--borda);border-radius:10px;padding:10px;font:13px/1.45 ui-monospace,Menlo,monospace;color:#d8dbe0}
footer{color:var(--mut);text-align:center;padding:0 16px 40px;font-size:14px}footer a{color:var(--ouro)}
</style></head><body>
<header><h1><b>LENDA</b> · criativos editados</h1>
<p>Prontos pra postar no TikTok e no YouTube Shorts (9:16). A ordem sugere um por dia. A versão "sem trilha" serve pra escolher um som em alta dentro do TikTok. As músicas e os efeitos das versões com trilha são originais, sem direitos de terceiros.</p></header>
<main>
${cards.join('\n')}
</main>
<footer><a href="../">Todas as gravações brutas</a> · <a href="../../">Jogar LENDA</a></footer>
<script src="copiar.js"></script>
</body></html>
`)
writeFileSync(join(dest, 'copiar.js'), `document.addEventListener('click', async (e) => {
  const b = e.target.closest('.cp'); if (!b) return
  const t = document.getElementById(b.dataset.alvo).textContent
  try { await navigator.clipboard.writeText(t) } catch { const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.alvo)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy') }
  b.textContent = 'Copiado!'; b.classList.add('ok'); setTimeout(() => { b.textContent = 'Copiar legenda'; b.classList.remove('ok') }, 1600)
})
`)
console.log(`${cards.length} criativos em ${dest}/index.html`)
