/* Visión digital local (clásica) para comparar dos fotos del mismo punto de vista.
   Corre en el navegador: no envía las fotos a ningún tercero. Es un indicador que una persona confirma. */
import { supabase } from './lib.js';

const bmpCache = new Map();
export async function loadBitmap(path) {
  if (bmpCache.has(path)) return bmpCache.get(path);
  const { data, error } = await supabase.storage.from('evidence').download(path);
  if (error) throw new Error('No se pudo descargar la foto: ' + error.message);
  const bmp = await createImageBitmap(data);
  if (bmpCache.size >= 14) bmpCache.delete(bmpCache.keys().next().value);
  bmpCache.set(path, bmp);
  return bmp;
}

function draw(bmp, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  return { c, g };
}
function grayOf(bmp, W, H) {
  const { g } = draw(bmp, W, H), d = g.getImageData(0, 0, W, H).data, out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}
/* Media local con imagen integral */
function boxMean(src, W, H, r) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}
/* Normaliza la iluminación: cada píxel se expresa respecto a su vecindario (resiste cambios de luz y exposición) */
function normalize(g, W, H) {
  const m = boxMean(g, W, H, 7), sq = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) sq[i] = g[i] * g[i];
  const m2 = boxMean(sq, W, H, 7), n = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) n[i] = (g[i] - m[i]) / (Math.sqrt(Math.max(m2[i] - m[i] * m[i], 0)) + 6);
  return n;
}
function half(a, W, H) {
  const w = W >> 1, h = H >> 1, o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = (a[2 * y * W + 2 * x] + a[2 * y * W + 2 * x + 1] + a[(2 * y + 1) * W + 2 * x] + a[(2 * y + 1) * W + 2 * x + 1]) / 4;
  return o;
}
function shiftCost(a, b, W, H, dx, dy, m) {
  let s = 0, n = 0;
  for (let y = m; y < H - m; y += 2) {
    const yb = y + dy; if (yb < 0 || yb >= H) continue;
    for (let x = m; x < W - m; x += 2) { const xb = x + dx; if (xb < 0 || xb >= W) continue; s += Math.abs(a[y * W + x] - b[yb * W + xb]); n++; }
  }
  return n ? s / n : Infinity;
}
function bestShift(a, b, W, H, cx, cy, range, m) {
  let best = [cx, cy], bc = Infinity;
  for (let dy = cy - range; dy <= cy + range; dy++) for (let dx = cx - range; dx <= cx + range; dx++) {
    const c = shiftCost(a, b, W, H, dx, dy, m); if (c < bc) { bc = c; best = [dx, dy]; }
  }
  return best;
}
function lapVar(g, W, H) {
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
    const i = y * W + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]; s += l; s2 += l * l; n++;
  }
  return s2 / n - (s / n) ** 2;
}
function ssimBlocks(a, b, W, H, dx, dy) {
  const C1 = 6.5025, C2 = 58.5225; let tot = 0, cnt = 0;
  for (let by = 4; by + 8 < H - 4; by += 8) for (let bx = 4; bx + 8 < W - 4; bx += 8) {
    const xb = bx + dx, yb = by + dy; if (xb < 0 || yb < 0 || xb + 8 > W || yb + 8 > H) continue;
    let ma = 0, mb = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { ma += a[(by + j) * W + bx + i]; mb += b[(yb + j) * W + xb + i]; }
    ma /= 64; mb /= 64; let va = 0, vb = 0, cv = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const x = a[(by + j) * W + bx + i] - ma, y = b[(yb + j) * W + xb + i] - mb; va += x * x; vb += y * y; cv += x * y; }
    va /= 63; vb /= 63; cv /= 63;
    tot += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); cnt++;
  }
  return cnt ? tot / cnt : 0;
}
function morphOpen(mask, W, H) {
  const er = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; er[i] = mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W] ? 1 : 0;
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; out[i] = er[i] || er[i - 1] || er[i + 1] || er[i - W] || er[i + W] ? 1 : 0;
  }
  return out;
}
function components(mask, ds, W, H, minArea) {
  const seen = new Uint8Array(mask.length), regs = [], stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0, sum = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0;
      area++; sum += ds[p]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (area >= minArea) {
      const pct = area / (W * H) * 100;
      regs.push({ x: minX / W, y: minY / H, w: (maxX - minX + 1) / W, h: (maxY - minY + 1) / H, areaPct: +pct.toFixed(2), intensity: +(sum / area).toFixed(2),
        severity: pct >= 4 ? 'mayor' : pct >= 1 ? 'moderado' : 'leve' });
    }
  }
  return regs.sort((a, b) => b.areaPct * b.intensity - a.areaPct * a.intensity).slice(0, 8);
}

/* Compara A (referencia) con B. Devuelve métricas, regiones de cambio, mapa de calor y máscara. */
export async function analyzePair(bmpA, bmpB, { width = 400 } = {}) {
  const W = width, H = Math.max(32, Math.round(bmpA.height * W / bmpA.width));
  const notes = [];
  if (Math.abs(bmpA.width / bmpA.height - bmpB.width / bmpB.height) > 0.08) notes.push('Las fotos tienen proporciones distintas: se ajustaron y la comparación pierde precisión.');
  const gA = grayOf(bmpA, W, H), gB = grayOf(bmpB, W, H);
  const nA = normalize(gA, W, H), nB = normalize(gB, W, H);
  await new Promise((r) => setTimeout(r));
  const w2 = W >> 1, h2 = H >> 1;
  const [cx, cy] = bestShift(half(nA, W, H), half(nB, W, H), w2, h2, 0, 0, 8, 8);
  const [dx, dy] = bestShift(nA, nB, W, H, cx * 2, cy * 2, 2, Math.max(12, Math.abs(cx * 2) + 6));
  const d = new Float32Array(W * H), valid = new Uint8Array(W * H), m = 6;
  for (let y = m; y < H - m; y++) for (let x = m; x < W - m; x++) {
    const xb = x + dx, yb = y + dy; if (xb < m || yb < m || xb >= W - m || yb >= H - m) continue;
    const i = y * W + x; d[i] = Math.abs(nA[i] - nB[yb * W + xb]); valid[i] = 1;
  }
  const ds = boxMean(d, W, H, 2); let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < ds.length; i++) if (valid[i]) { sum += ds[i]; sq += ds[i] * ds[i]; n++; }
  const mu = sum / Math.max(n, 1), sd = Math.sqrt(Math.max(sq / Math.max(n, 1) - mu * mu, 0));
  const tau = Math.min(1.4, Math.max(0.6, mu + 2 * sd));
  let raw = new Uint8Array(W * H); for (let i = 0; i < raw.length; i++) raw[i] = valid[i] && ds[i] > tau ? 1 : 0;
  const mask = morphOpen(raw, W, H);
  let mc = 0; for (let i = 0; i < mask.length; i++) mc += mask[i];
  const regions = components(mask, ds, W, H, Math.max(40, Math.round(W * H * 0.0012)));
  const ssim = ssimBlocks(gA, gB, W, H, dx, dy), sharpA = lapVar(gA, W, H), sharpB = lapVar(gB, W, H);
  let confidence = ssim >= 0.7 ? 'alta' : ssim >= 0.5 ? 'media' : 'baja';
  if (Math.abs(dx) >= 15 || Math.abs(dy) >= 15) { confidence = 'abstencion'; notes.push('Las fotos están muy desplazadas entre sí: no se pueden alinear con seguridad.'); }
  else if (ssim < 0.25) { confidence = 'abstencion'; notes.push('Las fotos no parecen tomadas desde el mismo punto de vista.'); }
  else if (Math.min(sharpA, sharpB) < 8) { if (confidence === 'alta') confidence = 'media'; notes.push('Alguna de las fotos está borrosa o con poca definición.'); }
  if (ssim < 0.5 && confidence !== 'abstencion') notes.push('La similitud global es baja: el ángulo o la distancia cambiaron.');
  const heat = document.createElement('canvas'); heat.width = W; heat.height = H;
  const hg = heat.getContext('2d'), hd = hg.createImageData(W, H);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? Math.min(1, 0.35 + (ds[i] - tau) / (tau * 1.5)) : 0;
    hd.data[i * 4] = 255; hd.data[i * 4 + 1] = Math.round(220 * (1 - v)); hd.data[i * 4 + 2] = 40; hd.data[i * 4 + 3] = Math.round(v * 190);
  }
  hg.putImageData(hd, 0, 0);
  return { W, H, shift: { dx, dy }, ssim: +ssim.toFixed(3), changedPct: +(mc / Math.max(n, 1) * 100).toFixed(2), regions, confidence, notes,
    threshold: +tau.toFixed(2), sharpness: { a: +sharpA.toFixed(1), b: +sharpB.toFixed(1) }, mask, maskCount: mc, heat };
}

/* Cruza los cambios ingreso→salida con los ingreso→reclamación de una misma vista */
export function claimVerdict(stay, claim) {
  const NC = (reason) => ({ code: 'no_concluyente', label: 'No concluyente', reason, confidence: 'abstencion', overlap: null });
  if (!stay || !claim) return NC('Faltan fotos de ingreso, salida o reclamación en esta vista.');
  if (stay.confidence === 'abstencion' || claim.confidence === 'abstencion') return NC('Las fotos no son comparables (' + [...stay.notes, ...claim.notes][0] + ')');
  const worst = ['abstencion', 'baja', 'media', 'alta'], confidence = worst[Math.min(worst.indexOf(stay.confidence), worst.indexOf(claim.confidence))];
  if (!claim.regions.length || claim.changedPct < 0.3) return { code: 'sin_diferencias', label: 'Sin diferencias visibles', reason: 'La foto de la reclamación no muestra cambios visibles frente al ingreso en esta vista.', confidence, overlap: 0 };
  const W = claim.W, H = claim.H, dil = new Uint8Array(W * H);
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) if (stay.mask[y * W + x]) for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) dil[(y + j) * W + x + i] = 1;
  let inter = 0; for (let i = 0; i < claim.mask.length; i++) if (claim.mask[i] && dil[i]) inter++;
  const overlap = +(inter / Math.max(claim.maskCount, 1)).toFixed(2);
  if (overlap >= 0.5) return { code: 'indicios', label: 'Indicios de cambio durante la custodia', reason: 'Los cambios que muestra la reclamación ya son visibles en las fotos de salida (coinciden el ' + Math.round(overlap * 100) + '% de las zonas).', confidence, overlap };
  if (overlap <= 0.15) return { code: 'sin_indicios', label: 'Sin indicios en la salida', reason: 'Los cambios que muestra la reclamación no aparecen en las fotos de salida (coinciden solo el ' + Math.round(overlap * 100) + '%).', confidence, overlap };
  return { code: 'no_concluyente', label: 'No concluyente', reason: 'Los cambios coinciden solo parcialmente con los de la salida (' + Math.round(overlap * 100) + '%).', confidence, overlap };
}
export function overallVerdict(list) {
  const conclusive = list.filter((v) => v.code !== 'no_concluyente');
  if (list.some((v) => v.code === 'indicios' && v.confidence !== 'baja')) return { code: 'indicios', label: 'Indicios de cambio durante la custodia' };
  if (conclusive.length && conclusive.every((v) => v.code === 'sin_indicios' || v.code === 'sin_diferencias')) return { code: 'sin_indicios', label: 'Sin indicios en las vistas analizadas' };
  return { code: 'no_concluyente', label: 'No concluyente' };
}

/* Niveles automáticos: recorta el 1% más oscuro y el 1% más claro de la foto */
export function autoLevels(bmp) {
  const g = grayOf(bmp, 128, Math.max(16, Math.round(bmp.height * 128 / bmp.width))), h = new Uint32Array(256);
  for (const v of g) h[Math.min(255, Math.max(0, Math.round(v)))]++;
  const cut = g.length * 0.01; let a = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { a += h[i]; if (a > cut) { lo = i; break; } }
  a = 0; for (let i = 255; i >= 0; i--) { a += h[i]; if (a > cut) { hi = i; break; } }
  return { lo, hi: Math.max(hi, lo + 20) };
}
export function thumbData(bmp, w = 480, q = 0.72) {
  const H = Math.round(bmp.height * w / bmp.width), { c } = draw(bmp, w, H);
  return { data: c.toDataURL('image/jpeg', q), w, h: H };
}
export function overlayData(bmp, heat, w = 480, alpha = 0.85, q = 0.72) {
  const H = Math.round(bmp.height * w / bmp.width), { c, g } = draw(bmp, w, H);
  g.globalAlpha = alpha; g.drawImage(heat, 0, 0, w, H); return { data: c.toDataURL('image/jpeg', q), w, h: H };
}
