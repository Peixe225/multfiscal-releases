// Foto do celular antes de subir: a de 12 MP (3 a 6 MB) vira uma de 2000 px no maior lado (uns 400 KB), que sobe
// rápido no 4G e cabe folgada no limite do servidor (32 MB desde 22/10; ele ainda recodifica em WebP de 1600 px). A
// orientação do celular (EXIF) já vem aplicada pelo navegador. A foto enorme (50 a 200 MP, 20 a 32 MB) abre já
// reduzida (foto-medida.ts: o tamanho sai do cabeçalho e o createImageBitmap entrega a de 2000 px), sem passar inteira
// pela memória do celular. Se algo falhar aqui, manda a original e o servidor resolve — menos quando ela nem passaria
// lá (mais de 40 MP ou mais que o limite): aí avisa aqui, antes de gastar o 4G subindo 30 MB à toa.
import { ErroApi } from './api'
import { abrirFoto, dePe, medirCabecalho } from './foto-medida'

const LADO = 2000
const LEVE = 1_500_000
/** Os mesmos do servidor (upload.php: GC_MEGAPIXELS_MAXIMO e GC_ENVIO_MAXIMO): a original acima disso não passa lá. */
const MEGAPIXELS_SERVIDOR = 40_000_000
const ENVIO_SERVIDOR = 32 * 1048576

function paraBlob(c: HTMLCanvasElement, tipo: string, q: number): Promise<Blob | null> {
  return new Promise((ok) => c.toBlob(ok, tipo, q))
}

/** A original não passaria no servidor: o aviso daqui (em vez de subir 30 MB pra ouvir "não" lá). */
function grandeDemais(f: File, mp: number | null): ErroApi {
  const quanto = mp != null ? `${Math.round(mp / 1_000_000)} megapixels` : `${(f.size / 1048576).toFixed(0)} MB`
  return new ErroApi('foto-grande', `Não deu pra reduzir essa foto aqui no celular (${quanto}). Tira de novo numa resolução menor (12 MP) ou manda um print dela.`)
}

export async function prepararFoto(f: File): Promise<{ blob: Blob; nome: string; mexeu: boolean }> {
  const original = { blob: f as Blob, nome: f.name || 'foto.jpg', mexeu: false }
  const medida = await medirCabecalho(f)
  const pe = medida ? dePe(medida) : null
  const mp = pe ? pe.w * pe.h : null
  // pequena e leve (o cabeçalho já diz): vai como veio, sem abrir os pixels
  if (pe && Math.max(pe.w, pe.h) <= LADO && f.size <= LEVE) return original
  const naoPassa = (mp != null && mp > MEGAPIXELS_SERVIDOR) || f.size > ENVIO_SERVIDOR
  try {
    const d = await abrirFoto(f, LADO)
    try {
      const lado = Math.max(d.w, d.h)
      if (lado <= LADO && f.size <= LEVE) return original
      const k = Math.min(1, LADO / lado)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(d.w * k))
      c.height = Math.max(1, Math.round(d.h * k))
      const ctx = c.getContext('2d')
      if (!ctx) {
        if (naoPassa) throw grandeDemais(f, mp)
        return original
      }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(d.img, 0, 0, c.width, c.height)
      // PNG (pode ter fundo transparente) vai em WebP; o Safari antigo não gera WebP e cai pro PNG
      const transparente = f.type === 'image/png' || f.type === 'image/webp'
      let blob = await paraBlob(c, transparente ? 'image/webp' : 'image/jpeg', 0.88)
      if (transparente && blob?.type !== 'image/webp') blob = await paraBlob(c, 'image/png', 1)
      if (!blob || blob.size >= f.size) {
        if (naoPassa) throw grandeDemais(f, mp)
        return original
      }
      return { blob, nome: blob.type === 'image/jpeg' ? 'foto.jpg' : blob.type === 'image/webp' ? 'foto.webp' : 'foto.png', mexeu: true }
    } finally {
      d.soltar()
    }
  } catch (e) {
    if (e instanceof ErroApi) throw e
    if (naoPassa) throw grandeDemais(f, mp)
    return original
  }
}
