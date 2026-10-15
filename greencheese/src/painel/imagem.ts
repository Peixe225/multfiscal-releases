// Foto do celular antes de subir: a de 12 MP (3 a 6 MB) vira uma de 2000 px no maior lado (uns 400 KB), que sobe
// rápido no 4G e cabe folgada no limite do servidor (que ainda recodifica em WebP de 1600 px). A orientação do
// celular (EXIF) já vem aplicada pelo navegador. Se algo falhar aqui, manda a original e o servidor resolve.
const LADO = 2000
const LEVE = 1_500_000

async function decodificar(f: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; soltar: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(f)
    return { img: b, w: b.width, h: b.height, soltar: () => b.close() }
  }
  const url = URL.createObjectURL(f)
  const img = new Image()
  img.src = url
  await img.decode()
  return { img, w: img.naturalWidth, h: img.naturalHeight, soltar: () => URL.revokeObjectURL(url) }
}

function paraBlob(c: HTMLCanvasElement, tipo: string, q: number): Promise<Blob | null> {
  return new Promise((ok) => c.toBlob(ok, tipo, q))
}

export async function prepararFoto(f: File): Promise<{ blob: Blob; nome: string; mexeu: boolean }> {
  const original = { blob: f as Blob, nome: f.name || 'foto.jpg', mexeu: false }
  try {
    const d = await decodificar(f)
    try {
      const lado = Math.max(d.w, d.h)
      if (lado <= LADO && f.size <= LEVE) return original
      const k = Math.min(1, LADO / lado)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(d.w * k))
      c.height = Math.max(1, Math.round(d.h * k))
      const ctx = c.getContext('2d')
      if (!ctx) return original
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(d.img, 0, 0, c.width, c.height)
      // PNG (pode ter fundo transparente) vai em WebP; o Safari antigo não gera WebP e cai pro PNG
      const transparente = f.type === 'image/png' || f.type === 'image/webp'
      let blob = await paraBlob(c, transparente ? 'image/webp' : 'image/jpeg', 0.88)
      if (transparente && blob?.type !== 'image/webp') blob = await paraBlob(c, 'image/png', 1)
      if (!blob || blob.size >= f.size) return original
      return { blob, nome: blob.type === 'image/jpeg' ? 'foto.jpg' : blob.type === 'image/webp' ? 'foto.webp' : 'foto.png', mexeu: true }
    } finally {
      d.soltar()
    }
  } catch {
    return original
  }
}
