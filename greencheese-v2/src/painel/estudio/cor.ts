// Cor do Estúdio do produto: sRGB ↔ RGB linear (tabelas) e OKLab (o espaço perceptual onde "parecido" é parecido pro
// olho: a distância do fundo, a varinha e o ajuste de cor trabalham nele). OKLab aqui vai ×100: L de 0 a 100, a e b
// perto de −40..40.

/** sRGB (0–255) → linear (0–1). */
export const LINEAR = (() => {
  const t = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return t
})()

const PASSOS = 4096
const SRGB = (() => {
  const t = new Uint8ClampedArray(PASSOS + 1)
  for (let i = 0; i <= PASSOS; i++) {
    const l = i / PASSOS
    t[i] = Math.round((l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055) * 255)
  }
  return t
})()

/** Linear (0–1, fora disso corta) → sRGB 0–255. */
export function paraSrgb(l: number): number {
  return SRGB[l <= 0 ? 0 : l >= 1 ? PASSOS : (l * PASSOS + 0.5) | 0]
}

type Saida = Float32Array | Float64Array | number[]

/** RGB linear → OKLab ×100, escrito em s[o], s[o+1], s[o+2]. */
export function oklab(r: number, g: number, b: number, s: Saida, o = 0): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  s[o] = 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q)
  s[o + 1] = 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q)
  s[o + 2] = 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q)
}

/** OKLab ×100 → RGB linear (pode sair um pouco do 0–1: quem usa corta). */
export function deOklab(L: number, A: number, B: number, s: Saida, o = 0): void {
  const Lr = L / 100
  const ar = A / 100
  const br = B / 100
  const l = (Lr + 0.3963377774 * ar + 0.2158037573 * br) ** 3
  const m = (Lr - 0.1055613458 * ar - 0.0638541728 * br) ** 3
  const q = (Lr - 0.0894841775 * ar - 1.291485548 * br) ** 3
  s[o] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q
  s[o + 1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q
  s[o + 2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q
}

/** #rrggbb de um RGB 0–255. */
export function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}
