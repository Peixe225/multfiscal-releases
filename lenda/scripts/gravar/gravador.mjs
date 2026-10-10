/**
 * Gravador de vídeo de uma página do Chromium (Playwright) em MP4 H.264 nítido.
 *
 *   const rec = await gravar(page, 'saida.mp4', { fps: 30, largura: 1080, altura: 1920 })
 *   ...                       // o que acontecer na página entra no vídeo
 *   await rec.parar()         // fecha o arquivo; devolve { segundos, quadros }
 *
 * Usa o screencast do DevTools (JPEG de alta qualidade, no tamanho real da tela com deviceScaleFactor)
 * e monta um vídeo de fps constante: quando a tela não muda, o último quadro se repete.
 * O ffmpeg vem de LENDA_FFMPEG ou do PATH. LENDA_PRESET=ultrafast alivia a CPU durante a gravação
 * (arquivo maior; o pos.mjs recomprime depois).
 */
import { spawn } from 'node:child_process'

export function acharFfmpeg() {
  return process.env.LENDA_FFMPEG || 'ffmpeg'
}

export async function gravar(page, arquivo, { fps = 30, largura = 1080, altura = 1920, crf = Number(process.env.LENDA_CRF || 19), qualidade = 92, preset = process.env.LENDA_PRESET || 'veryfast' } = {}) {
  const cdp = await page.context().newCDPSession(page)
  const ff = spawn(acharFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-vf', `scale=${largura}:${altura}:force_original_aspect_ratio=decrease,pad=${largura}:${altura}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-r', String(fps),
    '-movflags', '+faststart', arquivo,
  ], { stdio: ['pipe', 'ignore', 'pipe'] })
  let erro = ''
  ff.stderr.on('data', (d) => (erro += d))
  const fim = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg saiu com ${c}: ${erro}`)))))

  let ultimo = null // Buffer do último quadro
  let inicio = null // timestamp (s) do primeiro quadro
  let desvio = 0 // relógio do DevTools − relógio do Node (o DevTools não usa a mesma origem de tempo)
  let escritos = 0
  let recebidos = 0 // quadros que o Chromium mandou (fluidez real = recebidos / segundos)
  // sem esperar o "drain": os quadros repetidos são o mesmo Buffer (o Node guarda só a referência)
  const escrever = (buf, n) => {
    for (let i = 0; i < n; i++) ff.stdin.write(buf)
    escritos += n
  }
  // completa o vídeo até o instante t (s): repete o último quadro
  const ate = (t) => {
    if (!ultimo || inicio === null) return
    const alvo = Math.floor((t - inicio) * fps)
    if (alvo > escritos) escrever(ultimo, alvo - escritos)
  }
  cdp.on('Page.screencastFrame', async (f) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
    const t = f.metadata.timestamp
    const buf = Buffer.from(f.data, 'base64')
    recebidos++
    if (inicio === null) { inicio = t; desvio = t - Date.now() / 1000; ultimo = buf; escrever(buf, 1); return }
    ate(t)
    ultimo = buf
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: qualidade, maxWidth: largura, maxHeight: altura, everyNthFrame: 1 })
  return {
    /** segundos desde o primeiro quadro */
    tempo: () => (inicio === null ? 0 : Date.now() / 1000 + desvio - inicio),
    async parar() {
      try { await cdp.send('Page.stopScreencast') } catch {}
      // fecha com o último quadro até agora (o screencast não manda quadro quando nada muda)
      if (inicio !== null) ate(Date.now() / 1000 + desvio + 0.2)
      ff.stdin.end()
      await fim
      try { await cdp.detach() } catch {}
      return { segundos: escritos / fps, quadros: escritos, recebidos }
    },
  }
}
