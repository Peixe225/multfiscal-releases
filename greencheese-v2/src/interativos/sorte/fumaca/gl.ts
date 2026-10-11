// O desenho da fumaça em WebGL 1 (sem biblioteca), em resolução baixa com pixel grande (o canvas sobe com
// image-rendering: pixelated): cara do site (pixel art + dither) e leve no celular.
// Duas passadas:
// (1) o campo das nuvens numa textura RGBA de 8 bits: metaballs de suporte finito (a silhueta une as bolhas com
//     pescoço macio), o ondulado que "ferve" a 12 qps (o ruído troca de semente a cada desenho), o derreter lento, o
//     redemoinho, a ondulação e o caleidoscópio. Por pixel: o campo da frente (R) e o do fundo (B), e em G/A a bolha de
//     cima (id) e a faixa de luz dela (sombreado de esfera em 3 faixas, com dither Bayer entre elas).
// (2) a composição em desenho animado: contorno escuro de 1 pixel na silhueta e na dobra de uma bolha sobre a outra
//     (só do lado da sombra: cara de couve-flor), a cor chapada por bolha (a psicodélica troca de matiz por bolha, sem
//     passar pelo verde), o túnel holográfico, o fundo escuro do prêmio, o halo e os raios, as argolas, as formas, os
//     olhos e a boca, a brasa, a chama e o clarão. Toda saída é opaca ou transparente (o meio-tom é dither).
import type { Quadro } from './cena'
import { NA, NB, NF } from './cena'

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const COMUM = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uMin;
uniform float uT;
uniform float uBoil;
uniform vec4 uOnda;
uniform float uDither;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bayer(vec2 fc) {
  vec2 a = mod(floor(fc), 4.0);
  vec2 lo = mod(a, 2.0); vec2 hi = floor(a * 0.5);
  float b = 4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0);
  return (b + 0.5) / 16.0;
}
vec2 coord() { vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); return (px - 0.5 * uRes) / uMin; }
vec2 ondular(vec2 p) {
#ifdef ONDA
  if (uOnda.z > 0.0) {
    vec2 d = p - uOnda.xy; float r = length(d) + 1e-4;
    p += (d / r) * sin(r * 26.0 - uOnda.w) * uOnda.z * exp(-r * 1.2);
  }
#endif
  return p;
}
`

const CAMPO = `${COMUM}
#define NB ${NB}
// bolhas da tela (só as que tocam este pedaço da tela): x, y, raio, w; w = ±(2·id + peso), negativo = camada de trás
uniform vec4 uB[NB];
uniform float uNB;
uniform vec4 uBuraco;
uniform float uOndulado;
uniform float uDens;
const vec2 LUZ = vec2(-0.6, -0.8);
void campos(vec2 p, out vec2 f, out vec2 ids, out vec2 nF, out vec2 nB) {
  f = vec2(0.0); ids = vec2(0.0); nF = vec2(0.0); nB = vec2(0.0);
  float kF = 0.0; float kB = 0.0; float aF = 0.0; float aB = 0.0; vec2 naF = vec2(0.0); vec2 naB = vec2(0.0);
  for (int i = 0; i < NB; i++) {
    if (float(i) >= uNB) break;
    vec4 b = uB[i];
    vec2 d = p - b.xy;
    float rv = b.z * uDens;
    float dd = dot(d, d);
    float x = dd / (rv * rv * 2.7225);
    if (x >= 1.0) continue;
    float aw = abs(b.w);
    float id = floor(aw * 0.5);
    float w = aw - id * 2.0;
    float k = 1.0 - x; k = k * k * k;
    float kw = k * w;
    bool cobre = dd < rv * rv * 0.9 * min(1.0, w);
    if (b.w > 0.0) {
      f.x += kw;
      if (cobre) { ids.x = id; nF = d / rv; }
      if (kw > kF) { kF = kw; aF = id; naF = d / rv; }
    } else {
      f.y += kw;
      if (cobre) { ids.y = id; nB = d / rv; }
      if (kw > kB) { kB = kw; aB = id; naB = d / rv; }
    }
  }
  if (ids.x == 0.0) { ids.x = aF; nF = naF; }
  if (ids.y == 0.0) { ids.y = aB; nB = naB; }
}
// 3 faixas de luz da esfera (luz de cima à esquerda), com dither na troca de faixa
float faixa(vec2 n, float by) {
  n /= max(1.0, length(n));
  float s = dot(n, LUZ) + (by - 0.5) * 0.26 * uDither;
  return s > 0.42 ? 3.0 : (s < -0.32 ? 1.0 : 2.0);
}
void main() {
  vec2 p = ondular(coord());
  // a linha "ferve" a 12 qps (o ruído troca de semente a cada desenho) e as formas derretem devagar
  vec2 bo = vec2(uBoil * 1.37, uBoil * 2.11);
  p += (vec2(vnoise(p * 6.0 + bo), vnoise(p * 6.0 + bo + 19.3)) - 0.5) * 0.014;
  p += (vec2(vnoise(p * 2.1 + uT * 0.35), vnoise(p * 2.1 - uT * 0.3 + 7.1)) - 0.5) * uOndulado;
  vec2 f; vec2 ids; vec2 nF; vec2 nB;
  campos(p, f, ids, nF, nB);
  if (uBuraco.z > 0.0) { vec2 d = (p - uBuraco.xy) / uBuraco.zw; float h = 1.0 - dot(d, d); if (h > 0.0) f -= vec2(h * h * 1.6); }
  f = max(f, vec2(0.0));
  float by = uDither > 0.5 ? bayer(gl_FragCoord.xy) : 0.5;
  gl_FragColor = vec4(clamp(f.x * 0.25, 0.0, 1.0), (ids.x * 4.0 + faixa(nF, by)) / 255.0, clamp(f.y * 0.25, 0.0, 1.0), (ids.y * 4.0 + faixa(nB, by)) / 255.0);
}
`

const COMPOR = `${COMUM}
#define NA ${NA}
#define NF ${NF}
uniform sampler2D uCampo;
uniform vec3 uCor[4];
uniform vec3 uCorF[4];
uniform vec3 uCorFi[4];
uniform vec4 uPsi;
uniform vec4 uTunel;
uniform vec4 uHalo;
uniform vec3 uHaloC;
uniform vec4 uPlaca;
uniform float uPlacaF;
uniform vec4 uRaios;
uniform vec3 uRaiosC;
uniform vec4 uOlhos;
uniform vec4 uOlhosP;
uniform vec4 uBoca;
uniform float uBico;
uniform vec4 uAnel[NA];
uniform vec4 uForma[NF];
uniform vec4 uFormaK[NF];
uniform vec4 uBrasa;
uniform vec4 uChama;
uniform float uChamaOuro;
uniform float uFlash;
uniform float uLinha;
const float T = 0.25;
const vec3 TINTA = vec3(0.07, 0.03, 0.12);
vec3 hsl(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
// matiz psicodélica sem passar pelo verde: anda só entre o azul (200°) e o laranja-dourado (385° = 25°)
float matiz(float x) { return (200.0 + 185.0 * (0.5 + 0.5 * sin(x))) / 360.0; }
vec3 holo(float i) {
  if (i < 0.5) return vec3(1.0, 0.77, 0.24);
  if (i < 1.5) return vec3(1.0, 0.37, 0.69);
  if (i < 2.5) return vec3(0.21, 0.80, 1.0);
  return vec3(0.58, 0.40, 1.0);
}
float codigo(float g) { return floor(g * 255.0 + 0.5); }
float idDe(float g) { return floor(codigo(g) / 4.0); }
void paleta(bool fundo, float id, out vec3 c0, out vec3 c1, out vec3 c2, out vec3 c3) {
  if (!fundo && id < 8.5) { c0 = uCorFi[0]; c1 = uCorFi[1]; c2 = uCorFi[2]; c3 = uCorFi[3]; return; }
  if (fundo) { c0 = uCorF[0]; c1 = uCorF[1]; c2 = uCorF[2]; c3 = uCorF[3]; }
  else { c0 = uCor[0]; c1 = uCor[1]; c2 = uCor[2]; c3 = uCor[3]; }
#ifdef PSI
  if (uPsi.x > 0.0) {
    // cada bolha com a matiz dela, que vira com o tempo (chapada: nada de degradê dentro da bolha)
    float h = matiz(uPsi.y + id * uPsi.z + (fundo ? 2.1 : 0.0));
    float k = fundo ? 0.7 : 1.0;
    float s = uPsi.w > 0.5 ? 1.0 : 0.92;
    c0 = mix(c0, hsl(h, 0.65, 0.09), uPsi.x);
    c1 = mix(c1, hsl(h, s * 0.8, 0.34 * k), uPsi.x);
    c2 = mix(c2, hsl(h, s * 0.95, 0.55 * k), uPsi.x);
    c3 = mix(c3, hsl(h, s, 0.78 * k + 0.06 * (1.0 - k)), uPsi.x);
  }
#endif
}
// só a cor da faixa pedida (0 contorno, 1 sombra, 2 meio, 3 luz): uma conta de matiz por pixel, não quatro
vec3 corDa(bool fundo, float id, float fx) {
  vec3 base;
  if (!fundo && id < 8.5) base = fx < 0.5 ? uCorFi[0] : (fx < 1.5 ? uCorFi[1] : (fx < 2.5 ? uCorFi[2] : uCorFi[3]));
  else if (fundo) base = fx < 0.5 ? uCorF[0] : (fx < 1.5 ? uCorF[1] : (fx < 2.5 ? uCorF[2] : uCorF[3]));
  else base = fx < 0.5 ? uCor[0] : (fx < 1.5 ? uCor[1] : (fx < 2.5 ? uCor[2] : uCor[3]));
#ifdef PSI
  if (uPsi.x > 0.0 && (fundo || id > 8.5)) {
    float h = matiz(uPsi.y + id * uPsi.z + (fundo ? 2.1 : 0.0));
    float k = fundo ? 0.7 : 1.0;
    float s = uPsi.w > 0.5 ? 1.0 : 0.92;
    vec3 c = fx < 0.5 ? hsl(h, 0.65, 0.09) : (fx < 1.5 ? hsl(h, s * 0.8, 0.34 * k) : (fx < 2.5 ? hsl(h, s * 0.95, 0.55 * k) : hsl(h, s, 0.78 * k + 0.06 * (1.0 - k))));
    base = mix(base, c, uPsi.x);
  }
#endif
  return base;
}
bool interna(float fv, float gv, float id) { return fv * 4.0 > T && idDe(gv) < id - 0.5; }
// uma camada de fumaça (campo no canal f, id+faixa no canal g) com os 4 vizinhos
bool camada(bool fundo, float f, float g, vec2 l, vec2 r, vec2 d, vec2 u, inout vec3 col) {
  if (f * 4.0 <= T) return false;
  float N = codigo(g); float id = floor(N / 4.0); float fx = N - id * 4.0;
  float mn = min(min(l.x, r.x), min(d.x, u.x)) * 4.0;
  bool linha = mn <= T;
  // a dobra de uma bolha sobre a de trás: só do lado da sombra (meio e sombra), como couve-flor
  if (!linha && fx < 1.5) linha = interna(l.x, l.y, id) || interna(r.x, r.y, id) || interna(d.x, d.y, id) || interna(u.x, u.y, id);
  col = corDa(fundo, id, linha ? 0.0 : fx);
  return true;
}
#ifdef FORMAS
float sdEstrela(vec2 p, float r) {
  vec2 k1 = vec2(0.809016994, -0.587785252); vec2 k2 = vec2(-0.809016994, -0.587785252);
  p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x); p.y -= r;
  vec2 ba = 0.45 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdTri(vec2 p) { const float k = 1.7320508; p.x = abs(p.x) - 1.0; p.y = p.y + 1.0 / k; if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0, 0.0); return -length(p) * sign(p.y); }
float sdForma(vec2 q, float tipo) {
  if (tipo < 0.5) return sdEstrela(q, 1.0);
  if (tipo < 1.5) { vec2 a = abs(q); return max(length(vec2(a.x, a.y + 0.75)) - 1.25, length(vec2(a.x, a.y - 0.75)) - 1.25); }
  if (tipo < 2.5) return max(abs(q.y - 0.28 * sin(q.x * 5.0)) - 0.22, abs(q.x) - 1.1);
  if (tipo < 3.5) return sdTri(q * 1.15) / 1.15;
  if (tipo < 4.5) return abs(length(q) - 0.75) - 0.25;
  return (abs(q.x) + abs(q.y) - 1.0) * 0.7071;
}
#endif
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 tx = 1.0 / uRes;
  vec2 p = ondular(coord());
  float by = uDither > 0.5 ? bayer(gl_FragCoord.xy) : 0.5;
  float px = 1.0 / uMin;
  float lw = px * uLinha;
  vec3 col = vec3(0.0); float a = 0.0;

#ifdef TUNEL
  // túnel holográfico (lendário): faixas que correm pro fundo em 6 gomos espelhados (caleidoscópio), com contorno
  // escuro; abre do meio pra fora (borda em dither) e escurece no fim (uTunel.w)
  if (uTunel.x > 0.0) {
    vec2 d = p - uHalo.xy; float r = length(d); float an = atan(d.y, d.x);
    float seg = 6.28318 / uTunel.z; float af = abs(mod(an, seg) - seg * 0.5);
    float z = 0.2 / max(r, 0.015);
    float s = z + af * 1.4 - uTunel.y;
    float bnd = fract(s); float idx = mod(floor(s), 4.0);
    float alcance = uTunel.x * 2.2;
    float vis = 1.0 - smoothstep(alcance - 0.12, alcance, r);
    if (by < vis) {
      vec3 hc = holo(idx) * (0.5 + 0.5 * smoothstep(0.05, 0.6, r)) * uTunel.w;
      col = bnd < 0.09 + 0.05 * smoothstep(0.4, 0.0, r) ? TINTA : (bnd > 0.8 ? mix(hc, vec3(uTunel.w), 0.45) : hc);
      a = 1.0;
    }
  }
#endif
#ifdef FORMAS
  // as formas também giram no caleidoscópio: o ponto dobra nos 6 gomos em volta do prêmio
  vec2 pf = p;
  if (uTunel.x > 0.0) {
    vec2 d = p - uHalo.xy; float r = length(d); float an = atan(d.y, d.x);
    float seg = 6.28318 / 6.0; an = mod(an, seg); an = abs(an - seg * 0.5);
    pf = uHalo.xy + r * vec2(cos(an), sin(an));
  }
  for (int k = 0; k < NF; k++) {
    vec4 fk = uFormaK[k];
    if (fk.z <= 0.0) continue;
    vec4 fo = uForma[k];
    vec2 q = pf - fo.xy; float cs = cos(fo.w); float sn = sin(fo.w);
    q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / fo.z;
    float sd = sdForma(q, fk.x) * fo.z;
    if (sd < lw && by < fk.z * 1.2) {
      col = sd > 0.0 ? TINTA : holo(fk.y);
      if (sd <= 0.0 && sd > -lw * 2.0) col = mix(col, vec3(1.0), 0.35);
      if (fk.x > 0.5 && fk.x < 1.5 && length(q) < 0.42) col = length(q - vec2(-0.12, -0.12)) < 0.13 ? vec3(1.0) : TINTA;
      a = 1.0;
    }
  }
#endif
  // o fundo escuro do prêmio (o texto lê em cima de qualquer coisa), com a borda em dither
  if (uPlacaF > 0.0) {
    vec2 e = (p - uPlaca.xy) / uPlaca.zw;
    float i = (1.0 - smoothstep(0.7, 1.0, length(e))) * uPlacaF;
    if (by < i) { col = vec3(0.02, 0.01, 0.04); a = 1.0; }
  }
  // halo do prêmio na cor da raridade (dither que some pra fora, como o halo dos produtos)
  if (uHalo.w > 0.0) {
    float r = length(p - uHalo.xy) / max(uHalo.z, 1e-3);
    float i = pow(max(0.0, 1.0 - r), 1.35) * uHalo.w;
    if (by < i) { col = mix(uHaloC, vec3(1.0), i * i * 0.55); a = 1.0; }
  }
#ifdef RAIOS
  // raios atrás do prêmio (raro azul, lendário dourado)
  if (uRaios.x > 0.0) {
    vec2 d = p - uHalo.xy; float r = length(d);
    float st = fract(atan(d.y, d.x) / 6.28318 * uRaios.y + uRaios.z);
    float raio = smoothstep(0.5, 0.42, abs(st - 0.5) * 2.0 - 0.2);
    // raio chapado (meio-tom por cima do que tem atrás, em 3 degraus que somem pra fora): faixas limpas, sem chiado
    float fade = (1.0 - smoothstep(uHalo.z * 0.9, uRaios.w, r)) * smoothstep(uHalo.z * 0.35, uHalo.z * 0.75, r) * uRaios.x;
    fade = floor(fade * 3.0 + 0.5) / 3.0;
    if (raio > 0.5 && fade > 0.0) { col = mix(a > 0.0 ? col : vec3(0.0), uRaiosC, 0.6 * fade); a = 1.0; }
  }
  // formas flutuando no túnel (estrela, olho, onda, triângulo, argola, losango)
#endif
  // brasa: o brilho laranja em volta (dither) e a chama de desenho na ponta torcida
  if (uBrasa.w > 0.0) {
    float r = length(p - uBrasa.xy) / max(uBrasa.z, 1e-3);
    float i = pow(max(0.0, 1.0 - r), 1.8) * uBrasa.w;
    if (by < i * 0.95) { col = mix(vec3(1.0, 0.34, 0.08), vec3(1.0, 0.88, 0.52), i); a = 1.0; }
  }
  if (uChama.w > 0.0) {
    float fl = 1.0 + 0.12 * sin(uBoil * 2.3) + 0.06 * sin(uBoil * 5.1);
    vec2 q = (p - uChama.xy) / (uChama.z * uChama.w * fl);
    q.y = -q.y - 0.3;
    q.x += sin(q.y * 6.0 + uBoil * 1.9) * 0.07 * max(q.y, 0.0);
    float y = q.y;
    float w = y < 0.0 ? sqrt(max(0.0, 0.2025 - y * y)) : 0.45 * pow(max(0.0, 1.0 - y / 1.4), 1.25);
    float sd = max(abs(q.x) - w, max(-0.45 - y, y - 1.4)) * uChama.z * uChama.w;
    if (sd < lw) {
      vec3 cf = uChamaOuro > 0.5 ? vec3(1.0, 0.69, 0.13) : vec3(1.0, 0.48, 0.1);
      vec3 cm = uChamaOuro > 0.5 ? vec3(1.0, 0.89, 0.48) : vec3(1.0, 0.77, 0.24);
      float yi = y + 0.12;
      float wi = yi < 0.0 ? sqrt(max(0.0, 0.11 - yi * yi)) : 0.33 * pow(max(0.0, 1.0 - yi / 1.0), 1.25);
      float yc = y + 0.2;
      float wc = yc < 0.0 ? sqrt(max(0.0, 0.04 - yc * yc)) : 0.2 * pow(max(0.0, 1.0 - yc / 0.6), 1.25);
      col = sd > 0.0 ? vec3(0.23, 0.07, 0.0) : (abs(q.x) < wc ? vec3(1.0, 0.97, 0.86) : (abs(q.x) < wi ? cm : cf));
      a = 1.0;
    }
  }

  // fumaça: o fundo, depois a frente por cima (o contorno da frente desenha a dobra entre as duas)
  vec4 c = texture2D(uCampo, uv);
  if (c.r * 4.0 > T || c.b * 4.0 > T) {
    vec2 o = tx * uLinha;
    vec4 cl = texture2D(uCampo, uv - vec2(o.x, 0.0));
    vec4 cr = texture2D(uCampo, uv + vec2(o.x, 0.0));
    vec4 cd = texture2D(uCampo, uv - vec2(0.0, o.y));
    vec4 cu = texture2D(uCampo, uv + vec2(0.0, o.y));
    vec3 cc = col;
    if (camada(true, c.b, c.a, cl.ba, cr.ba, cd.ba, cu.ba, cc)) { col = cc; a = 1.0; }
    if (camada(false, c.r, c.g, cl.rg, cr.rg, cd.rg, cu.rg, cc)) { col = cc; a = 1.0; }
  }

#ifdef ANEIS
  // argolas (raro): anéis de fumaça com contorno e as mesmas faixas de luz
  for (int k = 0; k < NA; k++) {
    vec4 an = uAnel[k];
    if (an.w <= 0.0) continue;
    vec2 d = p - an.xy; float r = length(d);
    float sd = abs(r - an.z) - an.w;
    if (sd < lw) {
      if (sd > 0.0) col = uCor[0];
      else {
        float lado = dot(d / max(r, 1e-4), vec2(-0.6, -0.8));
        float dentro = (r - an.z) / an.w;
        float v = 0.5 + 0.55 * lado * dentro + (by - 0.5) * 0.3 * uDither;
        col = v < 0.3 ? uCor[1] : (v < 0.72 ? uCor[2] : uCor[3]);
      }
      a = 1.0;
    }
  }

#endif
#ifdef ROSTO
  // olhos (épico): enormes, semicerrados, com a pupila em espiral psicodélica; a pálpebra é da própria fumaça
  if (uOlhos.x > 0.0) {
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 j = (vec2(hash(vec2(uBoil, float(i))), hash(vec2(float(i), uBoil))) - 0.5) * px * 0.9;
      vec2 q = (p - uOlhosP.xy - vec2(sx * uOlhosP.w, 0.0) + j) / uOlhosP.z;
      float r = length(q * vec2(1.0, 0.92));
      float abre = uOlhos.x * (1.0 - uOlhos.y);
      float tampa = -1.05 + 2.1 * (1.0 - abre);
      float lwq = lw / uOlhosP.z;
      vec3 c0; vec3 c1; vec3 c2; vec3 c3; paleta(false, 20.0 + float(i) * 3.0, c0, c1, c2, c3);
      if (r < 1.0 + lwq) {
        if (r > 1.0) col = c0;
        else if (q.y < tampa) col = q.y > tampa - lwq * 1.4 ? c0 : (q.y < tampa - 0.35 ? c3 : c2);
        else {
          vec2 pc = vec2(uOlhos.z * 0.38, 0.12 + uOlhos.w);
          float rp = length(q - pc);
          if (rp < 0.52) {
            float ring = fract(rp * 6.5 - uT * 2.4);
            col = ring < 0.5 ? hsl(matiz(uT * 1.6 + floor(rp * 6.5 - uT * 2.4)), 0.95, 0.55) : vec3(0.08, 0.02, 0.1);
            if (length(q - pc - vec2(-0.17, -0.18)) < 0.12) col = vec3(1.0);
            if (rp > 0.52 - lwq) col = vec3(0.06, 0.01, 0.08);
          } else col = q.y > 0.62 ? vec3(0.98, 0.86, 0.93) : vec3(1.0, 0.97, 0.99);
        }
        a = 1.0;
      }
      // a bolsa embaixo do olho (cara de quem viajou)
      vec2 qb = q - vec2(0.0, 0.25);
      float rb = length(qb * vec2(0.95, 1.6));
      if (abre > 0.05 && qb.y > 0.0 && r >= 1.0 + lwq && abs(rb - 1.2) < lwq * 0.8 && abs(q.x) < 0.75) { col = c0; a = 1.0; }
    }
  }
  // boca (épico): sorriso largo com dentes e língua, que vira bico e sopra
  if (uBoca.w > 0.0) {
    vec2 q = (p - uBoca.xy) / uBoca.z;
    float ab = uBoca.w;
    float topo = -0.12 * ab + 0.42 * q.x * q.x * ab;
    float base = 0.78 * ab * sqrt(max(0.0, 1.0 - q.x * q.x));
    float sdS = max(max(abs(q.x) - 1.0, topo - q.y), q.y - base);
    float sdO = length(q * vec2(1.0, 0.86)) - 0.6 * min(ab, 1.4);
    float sd = mix(sdS, sdO, uBico) * uBoca.z;
    if (sd < lw) {
      vec3 c0; vec3 c1; vec3 c2; vec3 c3; paleta(false, 22.0, c0, c1, c2, c3);
      if (sd > 0.0) col = c0;
      else if (uBico < 0.5 && q.y < topo + 0.2 * ab) col = vec3(1.0, 0.98, 0.95);
      else if (uBico < 0.5 && q.y > base * 0.5 + 0.1 && abs(q.x) < 0.62) col = vec3(1.0, 0.42, 0.6);
      else col = vec3(0.17, 0.02, 0.09);
      a = 1.0;
    }
  }
#endif
#ifdef FLASH
  // clarão (lendário): branco que desfaz em dither
  if (uFlash > 0.0 && by < uFlash) { col = vec3(1.0, 0.98, 0.9); a = 1.0; }
#endif
  gl_FragColor = vec4(col * a, a);
}
`

function compilar(gl: WebGLRenderingContext, tipo: number, src: string): WebGLShader {
  const s = gl.createShader(tipo)
  if (!s) throw new Error('shader')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s)
    gl.deleteShader(s)
    throw new Error(`shader: ${log}`)
  }
  return s
}

function programa(gl: WebGLRenderingContext, frag: string): WebGLProgram {
  const p = gl.createProgram()
  if (!p) throw new Error('programa')
  gl.attachShader(p, compilar(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compilar(gl, gl.FRAGMENT_SHADER, frag))
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`)
  return p
}

type Locais = Record<string, WebGLUniformLocation | null>

function locais(gl: WebGLRenderingContext, p: WebGLProgram, nomes: string[]): Locais {
  const r: Locais = {}
  for (const n of nomes) r[n] = gl.getUniformLocation(p, n)
  return r
}

export interface Desenho {
  /** Tamanho do canvas em pixels da fumaça (o CSS estica). */
  medir(w: number, h: number, linha: number, dither: boolean): void
  pintar(q: Quadro): void
  limpar(): void
  destruir(): void
  readonly tipo: 'gl' | '2d'
}

/** Cria o desenho em WebGL, ou null se não der (sem WebGL, poucos uniforms, shader que não compila). */
/** O que cada raridade desenha: o shader é compilado só com isso (no software do headless e do celular fraco, código
 *  desligado por uniform ainda custa). */
export type Recurso = 'ONDA' | 'PSI' | 'TUNEL' | 'FORMAS' | 'RAIOS' | 'ANEIS' | 'ROSTO' | 'FLASH'

export function criarGL(canvas: HTMLCanvasElement, aoPerder: () => void, recursos: readonly Recurso[] = [], aceitarSoftware = false): Desenho | null {
  let gl: WebGLRenderingContext | null = null
  // sem placa de vídeo (o WebGL emulado no processador: aparelho na lista negra do navegador, headless), o canvas 2D
  // anda mais liso que o shader: failIfMajorPerformanceCaveat recusa o WebGL de software
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: !aceitarSoftware,
    }) as WebGLRenderingContext | null
  } catch {
    gl = null
  }
  if (!gl) return null
  const g = gl
  // a composição usa ~60 vec4 de uniform e o campo NB + 8: aparelho com menos que isso vai pro canvas 2D
  if (g.getParameter(g.MAX_FRAGMENT_UNIFORM_VECTORS) < 64) return null
  let pCampo: WebGLProgram
  let pCompor: WebGLProgram
  try {
    const defs = recursos.map((r) => `#define ${r}\n`).join('')
    pCampo = programa(g, defs + CAMPO)
    pCompor = programa(g, defs + COMPOR)
  } catch (e) {
    console.warn('[fumaça] WebGL sem shader, vai o canvas 2D', e)
    return null
  }
  const uC = locais(g, pCampo, ['uRes', 'uMin', 'uT', 'uBoil', 'uOnda', 'uDither', 'uB', 'uNB', 'uBuraco', 'uOndulado', 'uDens'])
  const pedaco = new Float32Array(NB * 4)
  const uP = locais(g, pCompor, [
    'uRes', 'uMin', 'uT', 'uBoil', 'uOnda', 'uDither', 'uCampo', 'uCor', 'uCorF', 'uCorFi', 'uPsi', 'uTunel', 'uHalo', 'uHaloC', 'uPlaca', 'uPlacaF',
    'uRaios', 'uRaiosC', 'uOlhos', 'uOlhosP', 'uBoca', 'uBico', 'uAnel', 'uForma', 'uFormaK', 'uBrasa', 'uChama', 'uChamaOuro', 'uFlash', 'uLinha',
  ])
  const buf = g.createBuffer()
  g.bindBuffer(g.ARRAY_BUFFER, buf)
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
  g.enableVertexAttribArray(0)
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
  const tex = g.createTexture()
  const fbo = g.createFramebuffer()
  let w = 1
  let h = 1
  let linha = 1
  let dither = true
  let perdeu = false
  const perder = (e: Event) => {
    e.preventDefault()
    perdeu = true
    aoPerder()
  }
  canvas.addEventListener('webglcontextlost', perder)

  const prepararTextura = () => {
    g.bindTexture(g.TEXTURE_2D, tex)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
    g.bindFramebuffer(g.FRAMEBUFFER, fbo)
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
    g.bindFramebuffer(g.FRAMEBUFFER, null)
  }

  return {
    tipo: 'gl',
    medir(nw, nh, nl, nd) {
      linha = nl
      dither = nd
      if (nw === w && nh === h) return
      w = Math.max(2, nw)
      h = Math.max(2, nh)
      canvas.width = w
      canvas.height = h
      prepararTextura()
    },
    pintar(q) {
      if (perdeu || g.isContextLost()) return
      const min = Math.min(w, h)
      const dbg = import.meta.env.DEV ? (window as unknown as { __fumacaDbg?: Record<string, boolean> }).__fumacaDbg : undefined
      g.disable(g.BLEND)
      // 1) campo, em pedaços de ~32 px: cada pedaço só com as bolhas que tocam nele (no software do celular fraco e no
      //    headless, o laço das bolhas é o que pesa)
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.viewport(0, 0, w, h)
      g.useProgram(pCampo)
      g.uniform2f(uC.uRes, w, h)
      g.uniform1f(uC.uMin, min)
      g.uniform1f(uC.uT, q.t)
      g.uniform1f(uC.uBoil, q.boil)
      g.uniform4fv(uC.uOnda, q.onda)
      g.uniform1f(uC.uDither, dither ? 1 : 0)
      g.uniform4fv(uC.uBuraco, q.buraco)
      g.uniform1f(uC.uOndulado, q.giro[3])
      g.uniform1f(uC.uDens, q.dens)
      // limpa o campo inteiro antes dos pedaços (com o recorte ligado, o clear só limparia o último pedaço e quem fica
      // sem bolha guardaria a fumaça do quadro anterior)
      g.disable(g.SCISSOR_TEST)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      g.enable(g.SCISSOR_TEST)
      const B = q.blobs
      const folga = 0.016 + q.giro[3] * 0.6 + q.onda[2] + 1.5 / min
      const cols = Math.max(1, Math.round(w / 32))
      const lins = Math.max(1, Math.round(h / 32))
      for (let j = 0; j < lins; j++) {
        const sy0 = Math.floor((j * h) / lins)
        const sy1 = Math.floor(((j + 1) * h) / lins)
        const y0 = (sy0 - h / 2) / min
        const y1 = (sy1 - h / 2) / min
        for (let i = 0; i < cols; i++) {
          const sx0 = Math.floor((i * w) / cols)
          const sx1 = Math.floor(((i + 1) * w) / cols)
          const x0 = (sx0 - w / 2) / min
          const x1 = (sx1 - w / 2) / min
          let n = 0
          for (let k = 0; k < q.nBlobs; k++) {
            const bw = B[k * 4 + 3]
            const br = B[k * 4 + 2]
            if (!bw || br <= 0) continue
            const bx = B[k * 4]
            const by = B[k * 4 + 1]
            const R = br * q.dens * 1.65 + folga
            const cx = bx < x0 ? x0 : bx > x1 ? x1 : bx
            const cy = by < y0 ? y0 : by > y1 ? y1 : by
            if ((bx - cx) * (bx - cx) + (by - cy) * (by - cy) > R * R) continue
            const o = n * 4
            pedaco[o] = bx
            pedaco[o + 1] = by
            pedaco[o + 2] = br
            pedaco[o + 3] = bw > 0 ? (k + 1) * 2 + Math.min(1, bw) : -((k + 1) * 2 + 1)
            n++
          }
          if (!n || dbg?.semCampo) continue
          g.scissor(sx0, h - sy1, sx1 - sx0, sy1 - sy0)
          g.uniform4fv(uC.uB, pedaco)
          g.uniform1f(uC.uNB, n)
          g.drawArrays(g.TRIANGLES, 0, 3)
        }
      }
      g.disable(g.SCISSOR_TEST)
      // 2) composição
      g.bindFramebuffer(g.FRAMEBUFFER, null)
      g.viewport(0, 0, w, h)
      g.useProgram(pCompor)
      g.activeTexture(g.TEXTURE0)
      g.bindTexture(g.TEXTURE_2D, tex)
      g.uniform1i(uP.uCampo, 0)
      g.uniform2f(uP.uRes, w, h)
      g.uniform1f(uP.uMin, min)
      g.uniform1f(uP.uT, q.t)
      g.uniform1f(uP.uBoil, q.boil)
      g.uniform4fv(uP.uOnda, q.onda)
      g.uniform1f(uP.uDither, dither ? 1 : 0)
      g.uniform3fv(uP.uCor, q.cores)
      g.uniform3fv(uP.uCorF, q.coresFundo)
      g.uniform3fv(uP.uCorFi, q.coresFiapo)
      g.uniform4fv(uP.uPsi, q.psi)
      g.uniform4fv(uP.uTunel, q.tunel)
      g.uniform4fv(uP.uHalo, q.halo)
      g.uniform3fv(uP.uHaloC, q.haloCor)
      g.uniform4fv(uP.uPlaca, q.placa)
      g.uniform1f(uP.uPlacaF, q.placaForca)
      g.uniform4fv(uP.uRaios, q.raios)
      g.uniform3fv(uP.uRaiosC, q.raiosCor)
      g.uniform4fv(uP.uOlhos, q.olhos)
      g.uniform4fv(uP.uOlhosP, q.olhosP)
      g.uniform4fv(uP.uBoca, q.boca)
      g.uniform1f(uP.uBico, q.bico)
      g.uniform4fv(uP.uAnel, q.aneis)
      g.uniform4fv(uP.uForma, q.formas)
      g.uniform4fv(uP.uFormaK, q.formasK)
      g.uniform4fv(uP.uBrasa, q.brasa)
      g.uniform4fv(uP.uChama, q.chama)
      g.uniform1f(uP.uChamaOuro, q.chamaDourada)
      g.uniform1f(uP.uFlash, q.flash)
      g.uniform1f(uP.uLinha, linha)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
      if (!dbg?.semCompor) g.drawArrays(g.TRIANGLES, 0, 3)
    },
    limpar() {
      if (perdeu || g.isContextLost()) return
      g.bindFramebuffer(g.FRAMEBUFFER, null)
      g.clearColor(0, 0, 0, 0)
      g.clear(g.COLOR_BUFFER_BIT)
    },
    destruir() {
      canvas.removeEventListener('webglcontextlost', perder)
      if (!g.isContextLost()) {
        g.deleteProgram(pCampo)
        g.deleteProgram(pCompor)
        g.deleteTexture(tex)
        g.deleteFramebuffer(fbo)
        g.deleteBuffer(buf)
      }
    },
  }
}
