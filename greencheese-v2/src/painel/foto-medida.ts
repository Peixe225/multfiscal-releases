// A foto enorme do celular (pedido do Ian em 22/10: o limite da foto foi de 8 pra 32 MB) sem travar o celular: o
// tamanho vem do cabeçalho do arquivo (uns KB lidos, nenhum pixel aberto) e a foto abre já reduzida, sem montar os 50 a
// 200 megapixels inteiros na memória (200 MB a 1 GB) só pra depois encolher:
// 1. JPEG com o ImageDecoder (Chrome e Android): o decodificador do JPEG já sai em 1/8, 2/8… do tamanho (o
//    desiredWidth/desiredHeight). Medido no Chromium: a de 200 MP abre com uns 100 MB a mais, contra 1 GB inteira.
// 2. O createImageBitmap pedindo o tamanho de saída (resizeWidth/resizeHeight), no navegador sem o ImageDecoder. No
//    Chromium ele abre inteira por dentro e só depois encolhe (o pico é o mesmo); noutros navegadores, pode reduzir já
//    ao abrir.
// 3. A reserva: o caminho de antes, a foto inteira e o canvas reduzindo.
// O site nunca serve a original: o painel sobe a reduzida e o servidor recodifica em WebP de até 1600 px
// (public/api/nucleo/upload.php).

export interface Medida {
  /** Largura e altura como estão gravadas no arquivo (antes de girar pela orientação do celular). */
  w: number
  h: number
  /** Orientação EXIF (1 a 8; 5 a 8 = deitada: largura e altura trocam ao abrir). PNG e WebP: 1. */
  orientacao: number
}

const u16 = (d: DataView, p: number, le = false) => d.getUint16(p, le)
const u24le = (d: DataView, p: number) => d.getUint8(p) | (d.getUint8(p + 1) << 8) | (d.getUint8(p + 2) << 16)

/** A orientação no EXIF de um APP1 ("Exif\0\0" + TIFF), ou 1. */
function orientacaoExif(d: DataView, inicio: number, fim: number): number {
  if (inicio + 14 > fim) return 1
  if (d.getUint32(inicio) !== 0x45786966 || u16(d, inicio + 4) !== 0) return 1 // "Exif\0\0"
  const t = inicio + 6
  const le = u16(d, t) === 0x4949
  if (!le && u16(d, t) !== 0x4d4d) return 1
  const ifd = t + d.getUint32(t + 4, le)
  if (ifd + 2 > fim) return 1
  const n = u16(d, ifd, le)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > fim) break
    if (u16(d, e, le) === 0x0112) {
      const o = u16(d, e + 8, le)
      return o >= 1 && o <= 8 ? o : 1
    }
  }
  return 1
}

/** JPEG: anda pelos marcadores até o SOF (largura e altura), lendo a orientação do APP1 no caminho. */
function medirJpeg(d: DataView): Medida | null {
  let p = 2
  let orientacao = 1
  while (p + 4 <= d.byteLength) {
    if (d.getUint8(p) !== 0xff) return null
    const m = d.getUint8(p + 1)
    if (m === 0xff) {
      p++ // byte de enchimento
      continue
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2
      continue
    }
    if (m === 0xd9 || m === 0xda) return null // fim ou começo da imagem sem o SOF antes
    const tam = u16(d, p + 2)
    if (tam < 2) return null
    const sof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
    if (sof) {
      if (p + 9 > d.byteLength) return null
      const h = u16(d, p + 5)
      const w = u16(d, p + 7)
      return w > 0 && h > 0 ? { w, h, orientacao } : null
    }
    if (m === 0xe1 && orientacao === 1) orientacao = orientacaoExif(d, p + 4, Math.min(d.byteLength, p + 2 + tam))
    p += 2 + tam
  }
  return null
}

function medirPng(d: DataView): Medida | null {
  if (d.byteLength < 24 || d.getUint32(0) !== 0x89504e47 || d.getUint32(12) !== 0x49484452) return null // IHDR
  const w = d.getUint32(16)
  const h = d.getUint32(20)
  return w > 0 && h > 0 ? { w, h, orientacao: 1 } : null
}

function medirWebp(d: DataView): Medida | null {
  if (d.byteLength < 30 || d.getUint32(0) !== 0x52494646 || d.getUint32(8) !== 0x57454250) return null // RIFF…WEBP
  const tipo = d.getUint32(12)
  if (tipo === 0x56503858) return { w: 1 + u24le(d, 24), h: 1 + u24le(d, 27), orientacao: 1 } // VP8X
  if (tipo === 0x56503820) return { w: u16(d, 26, true) & 0x3fff, h: u16(d, 28, true) & 0x3fff, orientacao: 1 } // "VP8 "
  if (tipo === 0x5650384c) {
    // VP8L: 14 bits de largura-1 e 14 de altura-1 depois do byte de assinatura
    const b = d.getUint32(21, true)
    return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff), orientacao: 1 }
  }
  return null
}

/** Largura, altura e orientação lidas do cabeçalho (JPEG, PNG e WebP), sem abrir os pixels; null se não der. */
export async function medirCabecalho(b: Blob): Promise<Medida | null> {
  try {
    // o SOF do JPEG vem depois do EXIF (até 64 KB) e da prévia que alguns celulares põem em outro APP: 1 MB sobra
    const d = new DataView(await b.slice(0, Math.min(b.size, 1_048_576)).arrayBuffer())
    if (d.byteLength < 4) return null
    if (u16(d, 0) === 0xffd8) return medirJpeg(d)
    return medirPng(d) ?? medirWebp(d)
  } catch {
    return null
  }
}

/** Largura e altura já de pé (a orientação do celular aplicada). */
export function dePe(m: Medida): { w: number; h: number } {
  return m.orientacao >= 5 ? { w: m.h, h: m.w } : { w: m.w, h: m.h }
}

export interface Aberta {
  img: CanvasImageSource
  w: number
  h: number
  soltar: () => void
  /** O navegador abriu já no tamanho pedido (a foto inteira não passou pela memória). */
  reduziu: boolean
}

/** O ImageDecoder do navegador (WebCodecs), quando tem: o mínimo que se usa dele. */
interface QuadroDecodificado {
  displayWidth: number
  displayHeight: number
  rotation?: number
  close: () => void
}
interface DecodificadorImagem {
  decode: () => Promise<{ image: QuadroDecodificado }>
  close: () => void
}
type ConstrutorDecodificador = (new (op: { data: ReadableStream<Uint8Array>; type: string; desiredWidth?: number; desiredHeight?: number }) => DecodificadorImagem) & {
  isTypeSupported?: (tipo: string) => Promise<boolean>
}

/**
 * JPEG pelo ImageDecoder, já em N/8 do tamanho (o JPEG reduz no próprio decodificador, sem a foto inteira na memória):
 * o menor N que ainda dá o lado maior até `lado` ou mais (a qualidade fica; o canvas reduz o resto). O tamanho pedido é o
 * do arquivo (antes de girar) e o quadro sai de pé (a rotação vai junto e o drawImage aplica). Navegador que não diz a
 * rotação, com a foto girada no EXIF: não usa (null).
 */
async function abrirComDecodificador(b: Blob, m: Medida, lado: number): Promise<Aberta | null> {
  const D = (globalThis as { ImageDecoder?: ConstrutorDecodificador }).ImageDecoder
  if (!D || b.type !== 'image/jpeg' || typeof b.stream !== 'function') return null
  const n = Math.max(1, Math.ceil((8 * lado) / Math.max(m.w, m.h)))
  if (n >= 8) return null
  try {
    if (D.isTypeSupported && !(await D.isTypeSupported(b.type))) return null
  } catch {
    return null
  }
  let dec: DecodificadorImagem | null = null
  let quadro: QuadroDecodificado | null = null
  try {
    dec = new D({ data: b.stream(), type: b.type, desiredWidth: Math.ceil((m.w * n) / 8), desiredHeight: Math.ceil((m.h * n) / 8) })
    quadro = (await dec.decode()).image
    const pe = dePe(m)
    const w = quadro.displayWidth
    const h = quadro.displayHeight
    const sabeGirar = typeof quadro.rotation === 'number'
    if (!w || !h || (m.orientacao !== 1 && !sabeGirar) || Math.abs(w / h - pe.w / pe.h) > 0.02) return null
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) return null
    g.drawImage(quadro as unknown as CanvasImageSource, 0, 0, w, h)
    return { img: c, w, h, soltar: () => ((c.width = 0), (c.height = 0)), reduziu: true }
  } catch {
    return null
  } finally {
    quadro?.close()
    dec?.close()
  }
}

/** Pede ao navegador a foto já reduzida (lado maior até `lado`); null se ele não souber fazer isso direito. */
async function abrirJaReduzida(b: Blob, lado: number): Promise<Aberta | null> {
  const m = await medirCabecalho(b)
  if (!m) return null
  const pe = dePe(m)
  const k = lado / Math.max(pe.w, pe.h)
  if (k >= 1) return null
  const viaDecodificador = await abrirComDecodificador(b, m, lado)
  if (viaDecodificador) return viaDecodificador
  if (typeof createImageBitmap !== 'function') return null
  const rw = Math.max(1, Math.round(pe.w * k))
  const rh = Math.max(1, Math.round(pe.h * k))
  const pedir = (w: number, h: number) => createImageBitmap(b, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'from-image' })
  try {
    let bm = await pedir(rw, rh)
    // navegador que reduz antes de girar devolve deitada (e esticada): pede de novo com os lados trocados
    if (rw !== rh && bm.width === rh && bm.height === rw) {
      bm.close()
      bm = await pedir(rh, rw)
    }
    const certo = Math.abs(bm.width / bm.height - pe.w / pe.h) < 0.02
    if (!certo) {
      bm.close()
      return null
    }
    const final = bm
    return { img: final, w: final.width, h: final.height, soltar: () => final.close(), reduziu: Math.max(final.width, final.height) <= lado + 1 }
  } catch {
    return null
  }
}

/** O caminho de antes: a foto inteira (o canvas reduz depois). */
async function abrirInteira(b: Blob): Promise<Aberta> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(b, { imageOrientation: 'from-image' })
      return { img: bm, w: bm.width, h: bm.height, soltar: () => bm.close(), reduziu: false }
    } catch {
      /* Safari antigo: cai no <img> */
    }
  }
  const url = URL.createObjectURL(b)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, soltar: () => URL.revokeObjectURL(url), reduziu: false }
}

/**
 * Abre a foto com a orientação do celular aplicada; com `lado`, já reduzida (lado maior até ele) quando o navegador
 * sabe, e inteira quando não sabe (o canvas reduz depois, como antes).
 */
export async function abrirFoto(b: Blob, lado?: number): Promise<Aberta> {
  if (lado) {
    const r = await abrirJaReduzida(b, lado)
    if (r) return r
  }
  return abrirInteira(b)
}
