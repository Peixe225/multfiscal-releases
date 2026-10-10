#!/usr/bin/env node
/**
 * Sobe uma pasta para a hospedagem da Hostinger pelo upload TUS do gerenciador de arquivos.
 *
 *   HOST_URL=… HOST_AUTH=… HOST_REST=… node scripts/publicar-hostinger.mjs dist-site lenda [--paralelo 6]
 *
 * HOST_URL / HOST_AUTH / HOST_REST são o `url`, o `auth_key` e o `rest_auth_key` que o painel/API da
 * Hostinger gera ("Generate upload URL", válidos por algumas horas). Nunca grave essas chaves no projeto.
 * O destino é relativo ao public_html (ex.: "lenda" → public_html/lenda/…); as pastas são criadas sozinhas.
 * Arquivos grandes vão em pedaços de 8 MB. Usa o curl do sistema (respeita proxy e certificados).
 */
import { execFile } from 'node:child_process'
import { readdirSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

const [origem, destino = '', ...resto] = process.argv.slice(2)
const PAR = Number(resto[resto.indexOf('--paralelo') + 1] || 6) || 6
const { HOST_URL, HOST_AUTH, HOST_REST } = process.env
if (!origem || !HOST_URL || !HOST_AUTH || !HOST_REST) {
  console.error('uso: HOST_URL=… HOST_AUTH=… HOST_REST=… node scripts/publicar-hostinger.mjs <pasta> <destino-no-public_html>')
  process.exit(2)
}
const PEDACO = 8 * 1024 * 1024
const tmp = mkdtempSync(join(tmpdir(), 'lenda-up-'))

function listar(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...listar(p))
    else out.push({ p, size: st.size })
  }
  return out
}
const enc = (rel) => rel.split(sep).map(encodeURIComponent).join('/')
const cabec = ['-H', `X-Auth: ${HOST_AUTH}`, '-H', `X-Auth-Rest: ${HOST_REST}`, '-H', 'Tus-Resumable: 1.0.0']

const curl = (args) => new Promise((res) => {
  execFile('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--retry', '3', '--retry-delay', '2', ...args], { encoding: 'utf8' }, (_e, out) => res(Number(String(out ?? '').trim().slice(-3)) || 0))
})

async function subir({ p, size }, i) {
  const rel = relative(origem, p)
  const url = `${HOST_URL}/${destino ? enc(destino) + '/' : ''}${enc(rel)}?override=true`
  for (let tent = 1; tent <= 3; tent++) {
    const c = await curl(['-X', 'POST', url, ...cabec, '-H', `Upload-Length: ${size}`, '-H', 'Upload-Offset: 0'])
    if (c !== 201) { if (tent === 3) return `POST ${c}`; continue }
    if (size === 0) return null
    let off = 0, ok = true
    const fd = openSync(p, 'r')
    try {
      while (off < size) {
        const n = Math.min(PEDACO, size - off)
        const buf = Buffer.alloc(n)
        readSync(fd, buf, 0, n, off)
        const f = join(tmp, `p${i}`)
        writeFileSync(f, buf)
        const c2 = await curl(['-X', 'PATCH', url, ...cabec, '-H', 'Content-Type: application/offset+octet-stream', '-H', `Upload-Offset: ${off}`, '--data-binary', `@${f}`])
        if (c2 !== 204) { ok = false; break }
        off += n
      }
    } finally { closeSync(fd) }
    if (ok) return null
  }
  return 'PATCH falhou'
}

// o index.html da raiz vai por último: quem abrir o site no meio do envio ainda vê a versão anterior inteira
const arquivos = listar(origem)
const total = arquivos.reduce((s, a) => s + a.size, 0)
console.log(`${arquivos.length} arquivos, ${(total / 1e6).toFixed(1)} MB → public_html/${destino}`)
let prox = 0, feitos = 0
const erros = []
const fila = arquivos.filter((a) => relative(origem, a.p) !== 'index.html')
const ultimo = arquivos.filter((a) => relative(origem, a.p) === 'index.html')
async function trab(w) {
  while (prox < fila.length) {
    const i = prox++
    const e = await subir(fila[i], `${w}-${i}`)
    feitos++
    if (e) erros.push(`${relative(origem, fila[i].p)}: ${e}`)
    if (feitos % 50 === 0) console.log(`  ${feitos}/${arquivos.length}`)
  }
}
await Promise.all(Array.from({ length: PAR }, (_, w) => trab(w)))
for (const a of ultimo) { const e = await subir(a, 'idx'); feitos++; if (e) erros.push(`index.html: ${e}`) }
rmSync(tmp, { recursive: true, force: true })
console.log(erros.length ? `✖ ${erros.length} erros:\n${erros.join('\n')}` : `✔ ${feitos} arquivos enviados`)
process.exit(erros.length ? 1 : 0)
