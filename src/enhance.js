/* Laboratorio de píxeles: mejora real de la imagen (reduce ruido, recupera sombras, atenúa reflejos, contraste local, nitidez y ampliación).
   Todo corre en el navegador sobre una COPIA; el original nunca se modifica. No inventa detalle que la cámara no captó. */
import { boxMean } from './cv.js';

export const MAX_PIXELS = 5.5e6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Desenfoque casi gaussiano: tres pasadas de media por cajas */
function blur(src, W, H, r) { if (r < 1) return src; let a = boxMean(src, W, H, r); a = boxMean(a, W, H, r); return boxMean(a, W, H, r); }

function toCanvas(bmp, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, W, H);
  return { c, g };
}
const srcSize = (b) => [b.naturalWidth || b.videoWidth || b.width, b.naturalHeight || b.videoHeight || b.height];

/* Tamaño de trabajo: respeta la proporción, aplica la ampliación pedida y limita los megapíxeles */
export function workSize(bmp, scale = 1, maxPx = MAX_PIXELS) {
  const [w0, h0] = srcSize(bmp); let k = scale;
  if (w0 * h0 * k * k > maxPx) k = Math.sqrt(maxPx / (w0 * h0));
  return [Math.max(16, Math.round(w0 * k)), Math.max(16, Math.round(h0 * k)), k];
}

/* Filtro bilateral 5×5 sobre la luminancia: quita ruido sin borrar bordes ni rayones */
function bilateral(Y, W, H, sigmaR) {
  const out = new Float32Array(Y.length), R = 2, ws = [0.6, 0.85, 1, 0.85, 0.6], inv = 1 / (2 * sigmaR * sigmaR);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, c = Y[i]; let s = 0, w = 0;
    for (let j = -R; j <= R; j++) { const yy = y + j; if (yy < 0 || yy >= H) continue; const wj = ws[j + R];
      for (let k = -R; k <= R; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; const v = Y[yy * W + xx], d = v - c, wt = wj * ws[k + R] * Math.exp(-d * d * inv); s += wt * v; w += wt; } }
    out[i] = s / w;
  }
  return out;
}

/* CLAHE: ecualización adaptativa con límite de contraste (mosaicos con interpolación bilineal) */
function clahe(Y, W, H, clip, tiles = 8) {
  const tw = W / tiles, th = H / tiles, maps = new Array(tiles * tiles);
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw), y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th), hist = new Float32Array(256); let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[clamp(Math.round(Y[y * W + x]), 0, 255)]++; n++; }
    const lim = Math.max(1, clip * n / 256); let extra = 0;
    for (let i = 0; i < 256; i++) if (hist[i] > lim) { extra += hist[i] - lim; hist[i] = lim; }
    const add = extra / 256, map = new Float32Array(256); let cum = 0;
    for (let i = 0; i < 256; i++) { cum += hist[i] + add; map[i] = 255 * cum / Math.max(n, 1); }
    maps[ty * tiles + tx] = map;
  }
  const out = new Float32Array(Y.length);
  for (let y = 0; y < H; y++) {
    const fy = clamp(y / th - 0.5, 0, tiles - 1), ty0 = Math.floor(fy), ty1 = Math.min(tiles - 1, ty0 + 1), wy = fy - ty0;
    for (let x = 0; x < W; x++) {
      const fx = clamp(x / tw - 0.5, 0, tiles - 1), tx0 = Math.floor(fx), tx1 = Math.min(tiles - 1, tx0 + 1), wx = fx - tx0, v = clamp(Math.round(Y[y * W + x]), 0, 255);
      const a = maps[ty0 * tiles + tx0][v] * (1 - wx) + maps[ty0 * tiles + tx1][v] * wx, b = maps[ty1 * tiles + tx0][v] * (1 - wx) + maps[ty1 * tiles + tx1][v] * wx;
      out[y * W + x] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/* Parámetros de cada modo. Todos los valores van de 0 (apagado) a 1, salvo scale y denoise (0-3) */
export const PRESETS = {
  auto: { name: 'Mejorar píxeles (automático)', hint: 'Mide la foto y elige los ajustes.' },
  poca_luz: { name: 'Poca luz / sombras', hint: 'Recupera zonas oscuras con menos ruido.', p: { denoise: 2, shadows: 0.75, highlights: 0.2, clahe: 0.45, clarity: 0.25, sharpen: 0.5, wb: true } },
  reflejos: { name: 'Reflejos y brillos', hint: 'Baja destellos para ver la pintura debajo.', p: { denoise: 1, shadows: 0.25, highlights: 0.9, clahe: 0.35, clarity: 0.25, sharpen: 0.4, wb: false } },
  rayones: { name: 'Rayones finos', hint: 'Realza líneas delgadas y microcontraste.', p: { denoise: 1, shadows: 0.2, highlights: 0.4, clahe: 0.6, clarity: 0.7, sharpen: 1.1, wb: false } },
  relieve: { name: 'Relieve / abolladuras', hint: 'Exagera luces y sombras suaves de las deformaciones.', p: { denoise: 2, shadows: 0.1, highlights: 0.4, clahe: 0.9, clarity: 1, sharpen: 0.3, wb: false, relief: true } },
  forense: { name: 'Máximo forense (×2)', hint: 'Todas las etapas, con ampliación.', p: { scale: 2, denoise: 2, shadows: 0.55, highlights: 0.6, clahe: 0.6, clarity: 0.6, sharpen: 1, wb: true } },
  comparar: { name: 'Para comparar', hint: 'Suave y sin distorsión; se usa en el análisis reforzado.', p: { denoise: 2, shadows: 0.45, highlights: 0.5, clahe: 0.25, clarity: 0, sharpen: 0, wb: false } }
};
export const BASE = { scale: 1, denoise: 0, shadows: 0, highlights: 0, clahe: 0, clarity: 0, sharpen: 0, wb: false, relief: false };
export const isNeutral = (p) => !p || (p.scale === 1 && !p.denoise && !p.shadows && !p.highlights && !p.clahe && !p.clarity && !p.sharpen && !p.wb && !p.relief);
export const keyOf = (p) => JSON.stringify([p.scale, p.denoise, p.shadows, p.highlights, p.clahe, p.clarity, p.sharpen, p.wb, p.relief]);

/* Diagnóstico de calidad de una foto */
export function diagnose(bmp) {
  const [w0, h0] = srcSize(bmp), W = 640, H = Math.max(32, Math.round(h0 * W / w0)), { g } = toCanvas(bmp, W, H), d = g.getImageData(0, 0, W, H).data, n = W * H;
  const Y = new Float32Array(n), hist = new Uint32Array(256); let sum = 0, dark = 0, bright = 0, glare = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], y = 0.299 * r + 0.587 * gr + 0.114 * b; Y[i] = y; sum += y; hist[Math.round(y)]++;
    if (y < 35) dark++; if (y > 245) bright++; if (y > 232 && Math.max(r, gr, b) - Math.min(r, gr, b) < 22) glare++;
  }
  const pct = (q) => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= n * q) return i; } return 255; };
  const lap = new Float32Array(n); let s = 0, s2 = 0, c = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, l = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - W] - Y[i + W]; lap[i] = Math.abs(l); s += l; s2 += l * l; c++; }
  const sharp = s2 / c - (s / c) ** 2, sorted = Float32Array.from(lap).sort(), noise = sorted[Math.floor(sorted.length * 0.5)] / 0.6745 / 4.47;
  const q = { mp: +(w0 * h0 / 1e6).toFixed(1), w: w0, h: h0, mean: Math.round(sum / n), darkPct: +(dark / n * 100).toFixed(1), brightPct: +(bright / n * 100).toFixed(1), glarePct: +(glare / n * 100).toFixed(1),
    contrast: pct(0.99) - pct(0.01), sharp: +sharp.toFixed(0), noise: +noise.toFixed(1), hist: Array.from(hist) };
  const tips = [];
  if (q.mean < 85 || q.darkPct > 15) tips.push('Foto oscura: usa «Poca luz / sombras».');
  if (q.glarePct > 1.5 || q.brightPct > 4) tips.push('Hay brillos o reflejos: usa «Reflejos y brillos».');
  if (q.contrast < 120) tips.push('Poco contraste (imagen plana o con bruma): sube el contraste local.');
  if (q.sharp < 40) tips.push('Foto con poca nitidez o movida: la mejora ayuda poco; conviene repetir la toma.');
  if (q.noise > 3.2) tips.push('Ruido alto (típico de poca luz): activa la reducción de ruido.');
  if (Math.max(w0, h0) < 1200) tips.push('Resolución baja: la ampliación ×2 mejora la lectura, pero no crea detalle nuevo.');
  q.tips = tips; q.grade = (q.sharp < 25 || q.mean < 45 || q.mean > 225) ? 'baja' : (tips.length >= 3 ? 'media' : 'buena');
  return q;
}
export function autoParams(q) {
  const p = { ...BASE };
  p.shadows = q.mean < 85 || q.darkPct > 15 ? clamp((100 - q.mean) / 80, 0.3, 0.9) : 0.15;
  p.highlights = q.glarePct > 1.5 || q.brightPct > 4 ? clamp(0.4 + q.glarePct / 8, 0.4, 0.95) : 0.2;
  p.clahe = q.contrast < 120 ? 0.6 : 0.35; p.clarity = 0.3;
  p.denoise = q.noise > 5 ? 3 : q.noise > 3.2 ? 2 : 1; p.sharpen = q.sharp < 40 ? 0.6 : 0.9; p.wb = false;
  if (Math.max(q.w, q.h) < 1200) p.scale = 2; return p;
}

/* Mejora una imagen (ImageBitmap, canvas o img) y devuelve un canvas nuevo */
export async function enhance(bmp, params) {
  const p = { ...BASE, ...params }, [W, H] = workSize(bmp, p.scale), { c, g } = toCanvas(bmp, W, H), n = W * H;
  if (isNeutral(p) && p.scale === 1) return c;
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const tick = () => new Promise((r) => setTimeout(r));
  // Balance de blancos (gris promedio), acotado para no falsear colores
  if (p.wb) { let sr = 0, sg = 0, sb = 0; for (let i = 0; i < n; i++) { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; } const m = (sr + sg + sb) / 3;
    const kr = clamp(m / sr, 0.75, 1.3), kg = clamp(m / sg, 0.75, 1.3), kb = clamp(m / sb, 0.75, 1.3); for (let i = 0; i < n; i++) { d[i * 4] = clamp(d[i * 4] * kr, 0, 255); d[i * 4 + 1] = clamp(d[i * 4 + 1] * kg, 0, 255); d[i * 4 + 2] = clamp(d[i * 4 + 2] * kb, 0, 255); } }
  // A luminancia + crominancia
  let Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2]; Y[i] = 0.299 * r + 0.587 * gr + 0.114 * b; Cb[i] = b - Y[i]; Cr[i] = r - Y[i]; }
  await tick();
  if (p.denoise > 0) { Y = bilateral(Y, W, H, 6 + p.denoise * 6); if (p.denoise >= 2) { Cb = boxMean(Cb, W, H, p.denoise); Cr = boxMean(Cr, W, H, p.denoise); } await tick(); }
  const Y0 = Y;
  // Reflejos: se detectan brillos casi blancos y se rellenan con el entorno cercano (convolución normalizada) según la fuerza
  if (p.highlights > 0) {
    const m = new Float32Array(n), keep = new Float32Array(n), ykeep = new Float32Array(n);
    for (let i = 0; i < n; i++) { const sat = Math.max(Math.abs(Cb[i]), Math.abs(Cr[i])) < 26 && Y[i] > 226; m[i] = sat ? 1 : 0; keep[i] = 1 - m[i]; ykeep[i] = Y[i] * keep[i]; }
    const r = Math.max(4, Math.round(Math.max(W, H) / 60)), bm = blur(m, W, H, 2), bk = blur(keep, W, H, r), by = blur(ykeep, W, H, r); const Y2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = Y[i]; const local = bk[i] > 0.05 ? by[i] / bk[i] : v;
      if (bm[i] > 0) v = v * (1 - bm[i] * p.highlights * 0.85) + local * (bm[i] * p.highlights * 0.85);
      if (v > 205) v = 205 + (v - 205) * (1 - p.highlights * 0.6);
      Y2[i] = v;
    }
    Y = Y2; await tick();
  }
  // Sombras: Retinex de una escala (se divide por la iluminación estimada) con ganancia acotada
  if (p.shadows > 0) {
    const L = blur(Y, W, H, Math.max(6, Math.round(Math.max(W, H) / 16))); let mean = 0; for (let i = 0; i < n; i++) mean += L[i]; mean /= n;
    const Y3 = new Float32Array(n); for (let i = 0; i < n; i++) { const gain = clamp(Math.pow((mean + 8) / (L[i] + 8), p.shadows * 0.85), 0.75, 3.2); Y3[i] = clamp(Y[i] * gain, 0, 255); }
    Y = Y3; await tick();
  }
  // Contraste local (CLAHE), mezclado con la luminancia actual
  if (p.clahe > 0) { const C = clahe(Y, W, H, 1.5 + p.clahe * 4.5), a = Math.min(1, p.clahe * 1.1), Y4 = new Float32Array(n); for (let i = 0; i < n; i++) Y4[i] = Y[i] * (1 - a) + C[i] * a; Y = Y4; await tick(); }
  // Claridad: realce de contraste de escala media
  if (p.clarity > 0) { const B = blur(Y, W, H, Math.max(4, Math.round(Math.max(W, H) / 45))), Y5 = new Float32Array(n); for (let i = 0; i < n; i++) Y5[i] = clamp(Y[i] + p.clarity * 0.9 * (Y[i] - B[i]), 0, 255); Y = Y5; await tick(); }
  // Nitidez (máscara de desenfoque) con umbral para no realzar el ruido
  if (p.sharpen > 0) { const rr = Math.max(1, Math.round(Math.max(W, H) / 900) + 1), B = blur(Y, W, H, rr), Y6 = new Float32Array(n), th = 2 + p.denoise;
    for (let i = 0; i < n; i++) { const dd = Y[i] - B[i]; Y6[i] = clamp(Y[i] + (Math.abs(dd) > th ? p.sharpen * 1.4 * dd : 0), 0, 255); } Y = Y6; await tick(); }
  // Relieve: luces y sombras suaves exageradas alrededor de un gris medio, útil para deformaciones
  if (p.relief) { const B = blur(Y, W, H, Math.max(10, Math.round(Math.max(W, H) / 30))), Y7 = new Float32Array(n); for (let i = 0; i < n; i++) Y7[i] = clamp(128 + 3.2 * (Y[i] - B[i]), 0, 255); Y = Y7; Cb = Cb.map((v) => v * 0.25); Cr = Cr.map((v) => v * 0.25); }
  void Y0;
  for (let i = 0; i < n; i++) { const y = Y[i]; d[i * 4] = clamp(y + Cr[i], 0, 255); d[i * 4 + 2] = clamp(y + Cb[i], 0, 255); d[i * 4 + 1] = clamp((y - 0.299 * (y + Cr[i]) - 0.114 * (y + Cb[i])) / 0.587, 0, 255); }
  g.putImageData(img, 0, 0); return c;
}

/* Recorte de una zona (fracciones 0-1) ampliado y mejorado a partir de la foto original a máxima resolución */
export async function enhanceCrop(bmp, region, params, targetW = 520, margin = 0.12) {
  const [w0, h0] = srcSize(bmp), mx = region.w * margin, my = region.h * margin;
  const x = clamp(region.x - mx, 0, 1), y = clamp(region.y - my, 0, 1), w = clamp(region.w + 2 * mx, 0.02, 1 - x), h = clamp(region.h + 2 * my, 0.02, 1 - y);
  const sx = Math.round(x * w0), sy = Math.round(y * h0), sw = Math.max(8, Math.round(w * w0)), sh = Math.max(8, Math.round(h * h0));
  const k = Math.max(1, Math.min(6, targetW / sw)), c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const out = await enhance(c, { ...params, scale: 1 }); return { canvas: out, factor: +k.toFixed(1), src: { w: sw, h: sh } };
}

/* Histograma de luminancia dibujado en un canvas */
export function drawHist(canvas, hist) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, mx = Math.max(...hist.slice(2, 254), 1); g.clearRect(0, 0, W, H); g.fillStyle = '#4FD1C5';
  for (let i = 0; i < 256; i++) { const hh = Math.min(1, hist[i] / mx) * H; g.fillRect(i * W / 256, H - hh, Math.max(1, W / 256), hh); }
}
