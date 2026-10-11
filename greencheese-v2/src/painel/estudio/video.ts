// Thumb animada: o vídeo do celular no estilo do site, regravado no próprio navegador (a hospedagem não tem ffmpeg).
// - A fonte: <video> (MP4, MOV, WebM, o que o navegador abrir) ou GIF animado, onde o navegador decodifica (ImageDecoder).
// - Cada quadro passa por um shader (WebGL): o fundo modelado no 1º quadro do trecho (a câmera parada: o fundo é o
//   mesmo e só o produto mexe) sai pela distância em OKLab, com a máscara do quadro (o preenchimento a partir da borda,
//   numa cópia pequena, em JS) segurando o miolo do produto; a borda é descontaminada como na foto; a cor no estilo; e
//   tudo vai sobre PRETO (o site já junta o preto ao preto: vídeo não precisa de transparência).
// - O canvas é gravado com canvas.captureStream + MediaRecorder, em tempo real, enquanto o trecho toca: MP4 (H.264,
//   toca em todo lugar) quando o navegador grava, senão WebM.
// - A capa é o 1º quadro tratado (imagem): aparece antes de tocar e onde vídeo não roda.

import { medirComModelo, recortar, type AjusteCor, type Analise, type MapaDoFundo } from './recorte'
import { contexto, novoCanvas, transformar, type Quadro } from './render'

/** O tamanho da thumb animada (9:16; lado menor 432). */
export const SAIDA_VIDEO = { w: 432, h: 768 }
/** Trecho: padrão 3,5 s, no máximo 6 s. */
export const TRECHO_PADRAO = 3.5
export const TRECHO_MAXIMO = 6
/** ~24 quadros por segundo e bits pra ficar bem abaixo de 3 MB em 6 s. */
const QPS = 24
const BITS = 1_800_000
/** Lado maior da cópia pequena que decide a máscara de cada quadro. */
const LADO_MASCARA = 128

/* ---------------------------------------------------------------- a fonte */

export interface FonteVideo {
  w: number
  h: number
  duracao: number
  /** Vai pro tempo t e devolve o quadro (análise, tira de quadros, capa). */
  quadro(t: number): Promise<CanvasImageSource>
  /** Toca de t0 a t0+dur (tempo real), chamando aoQuadro a cada quadro novo; resolve no fim. */
  tocar(t0: number, dur: number, aoQuadro: (img: CanvasImageSource, t: number) => void, sinal?: { parar: boolean }): Promise<void>
  soltar(): void
}

type ComQuadro = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (agora: number, meta: { mediaTime: number }) => void) => number }

/** Abre o vídeo escolhido (sem som, sem tela cheia). Recusa o que o navegador não abre. */
export async function abrirVideo(arquivo: Blob): Promise<FonteVideo> {
  const url = URL.createObjectURL(arquivo)
  const v = document.createElement('video') as ComQuadro
  v.muted = true
  v.defaultMuted = true
  v.playsInline = true
  v.preload = 'auto'
  v.crossOrigin = 'anonymous'
  v.src = url
  try {
    await new Promise<void>((ok, nao) => {
      const t = window.setTimeout(() => nao(new Error('demorou')), 20000)
      v.onloadeddata = () => {
        window.clearTimeout(t)
        ok()
      }
      v.onerror = () => {
        window.clearTimeout(t)
        nao(new Error('formato'))
      }
    })
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  if (!v.videoWidth || !v.videoHeight || !Number.isFinite(v.duration) || v.duration <= 0) {
    URL.revokeObjectURL(url)
    throw new Error('formato')
  }
  const irPara = (t: number) =>
    new Promise<void>((ok) => {
      const alvo = Math.max(0, Math.min(v.duration - 0.01, t))
      if (Math.abs(v.currentTime - alvo) < 0.002 && v.readyState >= 2) return ok()
      const pronto = () => {
        v.removeEventListener('seeked', pronto)
        ok()
      }
      v.addEventListener('seeked', pronto)
      v.currentTime = alvo
    })
  return {
    w: v.videoWidth,
    h: v.videoHeight,
    duracao: v.duration,
    async quadro(t) {
      await irPara(t)
      return v
    },
    async tocar(t0, dur, aoQuadro, sinal) {
      await irPara(t0)
      aoQuadro(v, t0)
      const fim = t0 + dur
      await new Promise<void>((ok) => {
        let acabou = false
        const parar = () => {
          if (acabou) return
          acabou = true
          v.pause()
          ok()
        }
        const passo = (t: number) => {
          if (acabou) return
          if (sinal?.parar || t >= fim - 0.5 / QPS || v.ended) return parar()
          aoQuadro(v, t)
          agendar()
        }
        const agendar = () => {
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((_, meta) => passo(meta.mediaTime))
          else requestAnimationFrame(() => passo(v.currentTime))
        }
        v.onended = parar
        agendar()
        v.play().catch(parar)
        // rede de segurança: nunca fica preso (vídeo que trava no meio)
        window.setTimeout(parar, (dur + 4) * 1000)
      })
    },
    soltar() {
      v.pause()
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
    },
  }
}

interface QuadroDecodificado {
  image: CanvasImageSource & { timestamp?: number; duration?: number | null; close?: () => void; displayWidth?: number; displayHeight?: number }
}
interface Decodificador {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode(o: { frameIndex: number }): Promise<QuadroDecodificado>
  close(): void
}

/** O navegador decodifica GIF animado (ImageDecoder, Chrome e Edge)? */
export function abreGif(): boolean {
  return typeof (window as unknown as { ImageDecoder?: unknown }).ImageDecoder === 'function'
}

/** GIF animado como fonte (os quadros na memória: GIF de produto é curto). */
export async function abrirGif(arquivo: Blob): Promise<FonteVideo> {
  const Ctor = (window as unknown as { ImageDecoder: new (o: { data: ArrayBuffer; type: string }) => Decodificador }).ImageDecoder
  const dec = new Ctor({ data: await arquivo.arrayBuffer(), type: 'image/gif' })
  await dec.tracks.ready
  const n = Math.min(240, dec.tracks.selectedTrack?.frameCount ?? 0)
  if (n < 2) throw new Error('formato')
  const quadros: { img: QuadroDecodificado['image']; t: number }[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i })
    quadros.push({ img: image, t })
    t += Math.max(0.02, (image.duration ?? 100_000) / 1e6)
  }
  dec.close()
  const first = quadros[0].img
  const w = first.displayWidth ?? (first as HTMLImageElement).width
  const h = first.displayHeight ?? (first as HTMLImageElement).height
  const duracao = t
  const em = (s: number) => {
    let q = quadros[0]
    for (const x of quadros) if (x.t <= s) q = x
    return q.img
  }
  return {
    w,
    h,
    duracao,
    async quadro(s) {
      return em(s)
    },
    async tocar(t0, dur, aoQuadro, sinal) {
      const ini = performance.now()
      await new Promise<void>((ok) => {
        let ultimo: unknown = null
        const passo = () => {
          const s = t0 + (performance.now() - ini) / 1000
          if (sinal?.parar || s >= t0 + dur) return ok()
          const img = em(s)
          if (img !== ultimo) {
            ultimo = img
            aoQuadro(img, s)
          }
          requestAnimationFrame(passo)
        }
        passo()
      })
    },
    soltar() {
      for (const q of quadros) q.img.close?.()
    },
  }
}

/* ---------------------------------------------------------------- máscara de cada quadro */

/** A cópia pequena de um quadro (até 128 px no lado maior), pra decidir a máscara. */
export function quadroPequeno(img: CanvasImageSource, w: number, h: number, lado = LADO_MASCARA): ImageData {
  const k = Math.min(1, lado / Math.max(w, h))
  const c = novoCanvas(w * k, h * k)
  const g = contexto(c)
  g.imageSmoothingEnabled = true
  g.drawImage(img, 0, 0, c.width, c.height)
  return g.getImageData(0, 0, c.width, c.height)
}

/**
 * O produto no quadro (255) e o fundo (0), com o fundo do 1º quadro; borrado 1 px (a borda fica pro shader). Sem
 * mapa, px é o quadro inteiro do vídeo; com mapa, px é o quadro já enquadrado (a saída), e o mapa diz onde cada pixel
 * dele cai no vídeo.
 */
export function mascaraDoQuadro(px: ImageData, base: Analise, tol: number, mapa?: MapaDoFundo, fora?: (x: number, y: number) => boolean): { m: Uint8Array; w: number; h: number; caixa: { x0: number; y0: number; x1: number; y1: number } | null } {
  const an = medirComModelo({ w: px.width, h: px.height, d: px.data }, base, mapa, fora)
  const rec = recortar(an, tol, null)
  const { w, h } = an
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let soma = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          soma += rec.fundo[yy * w + xx] ? 0 : 255
          n++
        }
      m[y * w + x] = soma / n
    }
  return { m, w, h, caixa: rec.caixa }
}

/* ---------------------------------------------------------------- o shader */

const VERTICE = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENTO = `
precision highp float;
varying vec2 v;
uniform sampler2D quadro;
uniform sampler2D mascara;
uniform vec2 saida;
uniform vec3 transf;
uniform vec2 fonte;
uniform float coefLab[18];
uniform float coefRgb[18];
uniform float tol;
uniform float recortar;
uniform float usarMascara;
uniform vec4 cor;
uniform float vinheta;
uniform float cy;

// sRGB ↔ linear sem pow (polinômio e raízes: erro abaixo de 1 nível de 255, e barato na GPU fraca)
vec3 lin(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
vec3 srgb(vec3 l) { l = clamp(l, 0.0, 1.0); vec3 s1 = sqrt(l); vec3 s2 = sqrt(s1); vec3 s3 = sqrt(s2); return clamp(0.585122381 * s1 + 0.783140355 * s2 - 0.368262736 * s3, 0.0, 1.0); }
float cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
vec3 oklab(vec3 c) {
  float l = cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  float m = cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  float s = cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return 100.0 * vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 deOklab(vec3 c) {
  c /= 100.0;
  float l = pow(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, 3.0);
  float m = pow(c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, 3.0);
  float s = pow(c.x - 0.0894841775 * c.y - 1.2914855480 * c.z, 3.0);
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
float poli(float c0, float c1, float c2, float c3, float c4, float c5, vec2 q) { return c0 + c1 * q.x + c2 * q.y + c3 * q.x * q.x + c4 * q.x * q.y + c5 * q.y * q.y; }
vec3 modeloLab(vec2 q) { return vec3(poli(coefLab[0], coefLab[1], coefLab[2], coefLab[3], coefLab[4], coefLab[5], q), poli(coefLab[6], coefLab[7], coefLab[8], coefLab[9], coefLab[10], coefLab[11], q), poli(coefLab[12], coefLab[13], coefLab[14], coefLab[15], coefLab[16], coefLab[17], q)); }
vec3 modeloRgb(vec2 q) { return vec3(poli(coefRgb[0], coefRgb[1], coefRgb[2], coefRgb[3], coefRgb[4], coefRgb[5], q), poli(coefRgb[6], coefRgb[7], coefRgb[8], coefRgb[9], coefRgb[10], coefRgb[11], q), poli(coefRgb[12], coefRgb[13], coefRgb[14], coefRgb[15], coefRgb[16], coefRgb[17], q)); }

void main() {
  vec2 o = vec2(v.x, 1.0 - v.y) * saida;
  // uv: o ponto na foto de origem (o fundo modelado e a máscara moram lá); a cor vem do quadro já enquadrado (2D)
  vec2 uv = (o - transf.yz) / transf.x / fonte;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 l = lin(texture2D(quadro, vec2(v.x, 1.0 - v.y)).rgb);
  float a = 1.0;
  if (recortar > 0.5) {
    // a máscara do quadro decide o miolo e o lado de fora; só a faixa da borda (e quem não tem máscara) faz a conta
    float m = usarMascara > 0.5 ? texture2D(mascara, vec2(v.x, 1.0 - v.y)).a : 0.5;
    if (m >= 0.97) a = 1.0;
    else if (m <= 0.03) a = 0.0;
    else {
      vec2 q = uv * 2.0 - 1.0;
      vec3 c = oklab(l);
      vec3 b = modeloLab(q);
      float dL = c.x - b.x;
      if (dL < 0.0) dL *= 0.55;
      float d = sqrt(dL * dL + dot(c.yz - b.yz, c.yz - b.yz));
      a = smoothstep(tol * 0.7, tol * 1.7, d);
      vec3 fundo = clamp(modeloRgb(q), 0.0, 1.0);
      l = clamp((l - (1.0 - a) * fundo) / max(a, 0.35), 0.0, 1.0);
    }
  }
  if (a > 0.0 && (cor.z != 1.0 || cor.w != 1.0 || cor.x != cor.y)) {
    // níveis na luz (L do OKLab ≈ raiz cúbica da luminância) e saturação em volta da luminância: o tom não muda
    float Y = max(dot(l, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
    float L = cor.y + (100.0 * pow(Y, 1.0 / 3.0) - cor.x) * cor.z;
    if (L > 90.0) L = 90.0 + (L - 90.0) * 0.45;
    L = max(L, 0.0) / 100.0;
    float Y2 = L * L * L;
    l = l * (Y2 / Y);
    l = max(mix(vec3(Y2), l, cor.w), 0.0);
  }
  if (vinheta > 0.5) {
    float r = length(vec2((o.x - saida.x * 0.5) / (saida.x * 0.5), (o.y - saida.y * cy) / (saida.y * 0.5)));
    float t = clamp((r - 0.55) / 0.42, 0.0, 1.0);
    a *= 1.0 - t * t * (3.0 - 2.0 * t);
  }
  gl_FragColor = vec4(srgb(l) * a, 1.0);
}`

export interface Tratamento {
  /** null = manter o fundo. */
  base: Analise | null
  tol: number
  quadro: Quadro
  cor: AjusteCor
}

/** O processador: um canvas WebGL do tamanho da thumb, que desenha cada quadro tratado. */
export class Processador {
  readonly canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext
  private prog: WebGLProgram
  private texQuadro: WebGLTexture
  private texMascara: WebGLTexture
  private u: Record<string, WebGLUniformLocation | null> = {}
  /** O quadro já enquadrado, num canvas 2D do tamanho da saída: o vídeo vai pra GPU pequeno (subir o quadro inteiro do
   *  vídeo pra textura é o passo caro nos aparelhos sem aceleração). */
  private enquadrado: HTMLCanvasElement
  private g2: CanvasRenderingContext2D

  constructor(w = SAIDA_VIDEO.w, h = SAIDA_VIDEO.h) {
    this.canvas = novoCanvas(w, h)
    this.enquadrado = novoCanvas(w, h)
    const g2 = this.enquadrado.getContext('2d', { alpha: false })
    if (!g2) throw new Error('sem-canvas')
    this.g2 = g2
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false })
    if (!gl) throw new Error('sem-webgl')
    this.gl = gl
    const sombreador = (tipo: number, src: string) => {
      const s = gl.createShader(tipo) as WebGLShader
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`)
      return s
    }
    const prog = gl.createProgram() as WebGLProgram
    gl.attachShader(prog, sombreador(gl.VERTEX_SHADER, VERTICE))
    gl.attachShader(prog, sombreador(gl.FRAGMENT_SHADER, FRAGMENTO))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`programa: ${gl.getProgramInfoLog(prog)}`)
    this.prog = prog
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const textura = (unidade: number) => {
      const t = gl.createTexture() as WebGLTexture
      gl.activeTexture(gl.TEXTURE0 + unidade)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return t
    }
    this.texQuadro = textura(0)
    this.texMascara = textura(1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 1, 1, 0, gl.ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([255]))
    for (const nome of ['quadro', 'mascara', 'saida', 'transf', 'fonte', 'coefLab[0]', 'coefRgb[0]', 'tol', 'recortar', 'usarMascara', 'cor', 'vinheta', 'cy']) this.u[nome] = gl.getUniformLocation(prog, nome)
    gl.uniform1i(this.u.quadro, 0)
    gl.uniform1i(this.u.mascara, 1)
    gl.viewport(0, 0, w, h)
  }

  private pequeno = novoCanvas(1, 1)

  /**
   * Desenha um quadro tratado: o vídeo vai uma vez pro canvas 2D já enquadrado (W×H); dele sai a cópia pequena que
   * decide a máscara (o preenchimento a partir da borda, com o fundo do 1º quadro) e a textura do shader.
   */
  desenhar(img: CanvasImageSource, fw: number, fh: number, t: Tratamento, comMascara = true): void {
    const { gl, u } = this
    const W = this.canvas.width
    const H = this.canvas.height
    const [s, tx, ty] = transformar(t.quadro, W, H)
    const g2 = this.g2
    g2.setTransform(1, 0, 0, 1, 0, 0)
    g2.fillStyle = '#000'
    g2.fillRect(0, 0, W, H)
    g2.imageSmoothingEnabled = true
    g2.imageSmoothingQuality = 'high'
    g2.setTransform(s, 0, 0, s, tx, ty)
    g2.drawImage(img, 0, 0, fw, fh)
    let mascara: { m: Uint8Array; w: number; h: number } | null = null
    if (t.base && comMascara) {
      const k = Math.min(1, LADO_MASCARA / Math.max(W, H))
      const pw = Math.max(1, Math.round(W * k))
      const ph = Math.max(1, Math.round(H * k))
      if (this.pequeno.width !== pw || this.pequeno.height !== ph) {
        this.pequeno.width = pw
        this.pequeno.height = ph
      }
      const gp = contexto(this.pequeno)
      gp.imageSmoothingEnabled = true
      gp.drawImage(this.enquadrado, 0, 0, pw, ph)
      const px = gp.getImageData(0, 0, pw, ph)
      // pixel da cópia pequena → ponto do vídeo (normalizado, como o fundo foi modelado)
      const ponto = (x: number, y: number): [number, number] => [((((x + 0.5) * W) / pw - tx) / s / fw) * 2 - 1, ((((y + 0.5) * H) / ph - ty) / s / fh) * 2 - 1]
      const fora = (x: number, y: number) => {
        const [a, b] = ponto(x, y)
        return a < -1 || a > 1 || b < -1 || b > 1
      }
      mascara = mascaraDoQuadro(px, t.base, t.tol, ponto, fora)
    }
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texQuadro)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.enquadrado)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texMascara)
    if (mascara) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, mascara.w, mascara.h, 0, gl.ALPHA, gl.UNSIGNED_BYTE, mascara.m)
    }
    gl.uniform2f(u.saida, W, H)
    gl.uniform3f(u.transf, s, tx, ty)
    gl.uniform2f(u.fonte, fw, fh)
    const base = t.base
    gl.uniform1fv(u['coefLab[0]'], base ? Float32Array.from(base.modelo.lab) : new Float32Array(18))
    gl.uniform1fv(u['coefRgb[0]'], base ? Float32Array.from(base.modelo.rgb) : new Float32Array(18))
    gl.uniform1f(u.tol, t.tol)
    gl.uniform1f(u.recortar, base ? 1 : 0)
    gl.uniform1f(u.usarMascara, mascara ? 1 : 0)
    gl.uniform4f(u.cor, t.cor.de, t.cor.base, t.cor.ganho, t.cor.sat)
    gl.uniform1f(u.vinheta, base ? 0 : 1)
    gl.uniform1f(u.cy, 0.515)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  soltar(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/* ---------------------------------------------------------------- gravar */

/** O formato que o navegador grava: MP4 com H.264 (toca em todo lugar) quando dá; senão WebM; null = não grava. */
export function tipoDeGravacao(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null
  const sim = (t: string) => {
    try {
      return MediaRecorder.isTypeSupported(t)
    } catch {
      return false
    }
  }
  for (const t of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.4D401E', 'video/mp4;codecs=avc1']) if (sim(t)) return t
  // MP4 sem dizer o codec: no Safari é H.264; no Chrome sem H.264 seria VP9 dentro do MP4 (o iPhone não toca), então lá vai o WebM
  if (sim('video/mp4') && !sim('video/webm')) return 'video/mp4'
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (sim(t)) return t
  return null
}

export interface Gravacao {
  blob: Blob
  tipo: string
  segundos: number
  /** Quantos quadros foram entregues ao gravador. */
  quadros: number
}

type TrilhaDoCanvas = MediaStreamTrack & { requestFrame?: () => void }

/**
 * Grava o canvas enquanto `tocar` desenha nele. `tocar` recebe o "pronto": chamado a cada quadro desenhado, entrega
 * aquele quadro ao gravador (captureStream(0) + requestFrame, onde existe: nenhum quadro some nem repete; senão o
 * navegador pega o canvas a ~24 qps sozinho).
 */
export async function gravar(canvas: HTMLCanvasElement, tipo: string, tocar: (pronto: () => void) => Promise<void>): Promise<Gravacao> {
  const sondar = canvas.captureStream(0)
  const temPedido = typeof (sondar.getVideoTracks()[0] as TrilhaDoCanvas | undefined)?.requestFrame === 'function'
  const fluxo = temPedido ? sondar : canvas.captureStream(QPS)
  if (!temPedido) sondar.getTracks().forEach((t) => t.stop())
  const trilha = fluxo.getVideoTracks()[0] as TrilhaDoCanvas
  let quadros = 0
  const pronto = () => {
    quadros++
    if (temPedido) trilha.requestFrame?.()
  }
  const rec = new MediaRecorder(fluxo, { mimeType: tipo, videoBitsPerSecond: BITS })
  const partes: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) partes.push(e.data)
  }
  const parou = new Promise<void>((ok) => {
    rec.onstop = () => ok()
  })
  const ini = performance.now()
  rec.start(500)
  try {
    await tocar(pronto)
  } finally {
    if (rec.state !== 'inactive') rec.stop()
    await parou
    fluxo.getTracks().forEach((t) => t.stop())
  }
  const t = rec.mimeType || tipo
  return { blob: new Blob(partes, { type: t.split(';')[0] }), tipo: t, segundos: (performance.now() - ini) / 1000, quadros }
}

/** Capa: o canvas (o 1º quadro tratado) em WebP opaco (ou JPEG, onde o canvas não gera WebP). */
export async function capaDe(canvas: HTMLCanvasElement): Promise<{ blob: Blob; nome: string }> {
  const c = novoCanvas(canvas.width, canvas.height)
  contexto(c).drawImage(canvas, 0, 0)
  const como = (tipo: string, q: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, tipo, q))
  const webp = await como('image/webp', 0.86)
  if (webp && webp.type === 'image/webp') return { blob: webp, nome: 'capa.webp' }
  const jpg = await como('image/jpeg', 0.88)
  if (!jpg) throw new Error('não deu pra gerar a capa')
  return { blob: jpg, nome: 'capa.jpg' }
}

/** Sem gravar no navegador: a capa do vídeo original, só cabendo no 9:16 sobre preto (como o site enquadra). */
export function capaSimples(img: CanvasImageSource, fw: number, fh: number): HTMLCanvasElement {
  const c = novoCanvas(SAIDA_VIDEO.w, SAIDA_VIDEO.h)
  const g = contexto(c)
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  const k = Math.min(c.width / fw, c.height / fh)
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, (c.width - fw * k) / 2, (c.height - fh * k) / 2, fw * k, fh * k)
  return c
}
