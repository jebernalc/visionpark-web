/* Inspección de una sola foto: reconstruye los píxeles, resalta zonas de interés (rayón, mancha, relieve, golpe, reflejo)
   y estima la condición aparente. Corre en el navegador; el archivo original nunca se modifica.
   Sin una foto de referencia solo puede decir qué se VE; para saber si algo es nuevo hay que compararlo (ingreso vs salida). */
import { boxMean } from './cv.js';
import { enhance, diagnose, autoParams, BASE, workSize } from './enhance.js';

export const KIND = {
  rayon: { label: 'Posible rayón o marca lineal', color: [255, 122, 89] },
  mancha: { label: 'Posible mancha, suciedad o decoloración', color: [180, 139, 255] },
  relieve: { label: 'Variación de sombra anómala (posible abolladura)', color: [245, 197, 66] },
  golpe: { label: 'Zona muy fragmentada (posible golpe o fisura)', color: [255, 77, 109] },
  reflejo: { label: 'Reflejo o brillo (no es daño)', color: [127, 182, 255] }
};
const blur = (a, W, H, r) => { r = Math.max(1, r); return boxMean(boxMean(boxMean(a, W, H, r), W, H, r), W, H, r); };
const median = (arr) => { const s = Float32Array.from(arr).sort(); return s[s.length >> 1]; };

function readPixels(src, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, n = W * H, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], y = 0.299 * r + 0.587 * gr + 0.114 * b; Y[i] = y; Cb[i] = b - y; Cr[i] = r - y; }
  return { Y, Cb, Cr };
}
function sobel(Y, W, H) {
  const o = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x;
    const gx = -Y[i - W - 1] - 2 * Y[i - 1] - Y[i + W - 1] + Y[i - W + 1] + 2 * Y[i + 1] + Y[i + W + 1], gy = -Y[i - W - 1] - 2 * Y[i - W] - Y[i - W + 1] + Y[i + W - 1] + 2 * Y[i + W] + Y[i + W + 1];
    o[i] = Math.hypot(gx, gy) / 4; }
  return o;
}
/* Componentes conexas con momentos para medir forma */
function blobs(mask, W, H, minPx) {
  const seen = new Uint8Array(mask.length), out = [], stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const pts = []; stack.push(s); seen[s] = 1; let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) { const p = stack.pop(), x = p % W, y = (p / W) | 0; pts.push(p); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    if (pts.length < minPx) continue;
    let mx = 0, my = 0; for (const p of pts) { mx += p % W; my += (p / W) | 0; } mx /= pts.length; my /= pts.length; let cxx = 0, cyy = 0, cxy = 0;
    for (const p of pts) { const dx = (p % W) - mx, dy = ((p / W) | 0) - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
    cxx /= pts.length; cyy /= pts.length; cxy /= pts.length; const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(tr * tr / 4 - det, 0)), l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 0.05);
    out.push({ pts, x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H, areaPct: pts.length / (W * H) * 100, elong: Math.sqrt(l1 / l2), length: 4 * Math.sqrt(l1) / W, fill: pts.length / ((x1 - x0 + 1) * (y1 - y0 + 1)) });
  }
  return out;
}
const dil = (m, W, H, r) => { const o = new Uint8Array(m.length); for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) if (m[y * W + x]) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) o[(y + j) * W + x + i] = 1; return o; };

/* Detector de líneas finas: respuesta de cresta en 8 orientaciones frente a sus laterales */
function ridge(Y, W, H) {
  const out = new Float32Array(W * H), L = 5, off = 4;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    for (let y = off + L; y < H - off - L; y++) for (let x = off + L; x < W - off - L; x++) {
      let c = 0, s1 = 0, s2 = 0;
      for (let t = -L; t <= L; t += 2) { const px = x + dx * t, py = y + dy * t; c += Y[Math.round(py) * W + Math.round(px)]; s1 += Y[Math.round(py + ny * off) * W + Math.round(px + nx * off)]; s2 += Y[Math.round(py - ny * off) * W + Math.round(px - nx * off)]; }
      const n = Math.floor(L) + 1, r = Math.abs(c / n - (s1 + s2) / (2 * n)) - 0.5 * Math.abs(s1 / n - s2 / n); // cresta menos escalón (un borde no es una línea)
      if (r > out[y * W + x]) out[y * W + x] = r;
    }
  }
  return out;
}
const where = (b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return `${cy < 0.34 ? 'parte superior' : cy > 0.66 ? 'parte inferior' : 'zona media'} ${cx < 0.34 ? 'izquierda' : cx > 0.66 ? 'derecha' : 'central'}`; };
const lik = (s) => (s >= 0.7 ? 'alta' : s >= 0.45 ? 'media' : 'baja');

export function detect(src, { width = 640 } = {}) {
  const sw = src.width, sh = src.height, W = width, H = Math.max(48, Math.round(sh * W / sw)), n = W * H;
  const { Y, Cb, Cr } = readPixels(src, W, H), G = sobel(blur(Y, W, H, 1), W, H), Gb = boxMean(G, W, H, 6), notes = [];
  const darkM = new Uint8Array(n); for (let i = 0; i < n; i++) darkM[i] = Y[i] < 52 ? 1 : 0; const darkD = dil(darkM, W, H, 5);
  const offPaint = (b) => { let d = 0; for (const p of b.pts) d += darkD[p]; return d / b.pts.length > 0.3; };
  const res = []; const gMed = median(G), busy = Gb.reduce((a, v) => a + (v > 28 ? 1 : 0), 0) / n;
  if (busy > 0.55) notes.push('La imagen tiene mucha textura o detalle de fondo; la detección de marcas finas pierde fiabilidad.');
  const add = (kind, b, score, ev) => res.push({ kind, ...b, score: +Math.min(1, score).toFixed(2), likelihood: lik(score), where: where(b), evidence: ev, mask: b.pts });

  // 1) Reflejos
  const gl = new Uint8Array(n); for (let i = 0; i < n; i++) gl[i] = Y[i] > 236 && Math.max(Math.abs(Cb[i]), Math.abs(Cr[i])) < 24 ? 1 : 0;
  blobs(dil(gl, W, H, 1), W, H, Math.round(n * 0.0015)).slice(0, 6).forEach((b) => add('reflejo', b, 0.6, [`${b.areaPct.toFixed(2)}% del encuadre saturado de luz`]));
  const glareMask = dil(gl, W, H, 4);

  // 2) Rayones (umbral con histéresis: semillas fuertes que se extienden por trazo débil continuo)
  const R = ridge(blur(Y, W, H, 1), W, H), rm = median(R), mad = median(R.map((v) => Math.abs(v - rm))), thr = Math.max(10, rm + 5 * mad * 1.48), rmask = new Uint8Array(n), strong = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const ok = Gb[i] < 34 && !glareMask[i]; rmask[i] = ok && R[i] > thr * 0.55 ? 1 : 0; strong[i] = ok && R[i] > thr ? 1 : 0; }
  blobs(dil(rmask, W, H, 3), W, H, 40).filter((b) => { let s2 = 0; for (const p of b.pts) s2 += strong[p]; return s2 >= 14; }).filter((b) => !offPaint(b) && b.elong >= 3.2 && b.length >= 0.04 && b.length <= 0.5 && b.fill < 0.7).slice(0, 8).forEach((b) => {
    let c = 0, m = 0; for (const p of b.pts) if (strong[p]) { c += R[p]; m++; } c /= Math.max(m, 1); if (c < 12) return; b.pts = b.pts.filter((p) => strong[p]); add('rayon', b, 0.35 + Math.min(0.3, (b.elong - 3.2) / 20) + Math.min(0.3, c / 60), [`largo aprox. ${Math.round(b.length * 100)}% del ancho`, `forma muy alargada (${b.elong.toFixed(1)})`, `contraste de línea ${c.toFixed(0)}`]); });

  const lY = blur(Y, W, H, Math.round(W / 8)), lumDev = (b) => { let d = 0; for (const p of b.pts) d += Math.abs(Y[p] - lY[p]); return d / b.pts.length; };
  // 3) Manchas / decoloración: desviación de color frente al entorno
  const cbL = blur(Cb, W, H, Math.round(W / 8)), crL = blur(Cr, W, H, Math.round(W / 8)), dev = new Float32Array(n);
  for (let i = 0; i < n; i++) dev[i] = Math.hypot(Cb[i] - cbL[i], Cr[i] - crL[i]);
  const dS = blur(dev, W, H, 3), dm = median(dS), dmad = median(dS.map((v) => Math.abs(v - dm))), dthr = Math.max(14, dm + 6 * dmad * 1.48), smask = new Uint8Array(n);
  for (let i = 0; i < n; i++) smask[i] = dS[i] > dthr && Gb[i] < 30 && !glareMask[i] ? 1 : 0;
  blobs(smask, W, H, Math.round(n * 0.0025)).filter((b) => !offPaint(b) && b.areaPct < 12 && b.fill > 0.4 && lumDev(b) < 40).slice(0, 5).forEach((b) => { let c = 0; for (const p of b.pts) c += dS[p]; c /= b.pts.length; add('mancha', b, 0.3 + Math.min(0.5, c / 70), [`${b.areaPct.toFixed(1)}% del encuadre`, `desvío de color ${c.toFixed(0)} frente al entorno`]); });

  // 4) Variación de sombra anómala (relieve)
  const l1 = blur(Y, W, H, Math.round(W / 55)), l2 = blur(Y, W, H, Math.round(W / 9)), D = new Float32Array(n); for (let i = 0; i < n; i++) D[i] = l1[i] - l2[i];
  const dg = sobel(D, W, H), dgS = blur(dg, W, H, 3), gm = median(dgS), gmad = median(dgS.map((v) => Math.abs(v - gm))), gthr = Math.max(4, gm + 7 * gmad * 1.48), rl = new Uint8Array(n);
  for (let i = 0; i < n; i++) rl[i] = dgS[i] > gthr && Gb[i] < 26 && !glareMask[i] ? 1 : 0;
  blobs(dil(rl, W, H, 3), W, H, Math.round(n * 0.006)).filter((b) => !offPaint(b) && b.areaPct < 18 && b.elong < 4).slice(0, 4).forEach((b) => { let c = 0; for (const p of b.pts) c += dgS[p]; c /= b.pts.length; add('relieve', b, 0.2 + Math.min(0.3, c / 40), [`${b.areaPct.toFixed(1)}% del encuadre`, 'cambio brusco de sombra sin bordes duros', 'los reflejos naturales de la carrocería pueden causar lo mismo']); });

  // 5) Zonas muy fragmentadas
  const em = new Uint8Array(n); for (let i = 0; i < n; i++) em[i] = G[i] > Math.max(30, gMed * 4) ? 1 : 0;
  const ed = boxMean(Float32Array.from(em), W, H, 7), edM = median(ed), fm = new Uint8Array(n);
  for (let i = 0; i < n; i++) fm[i] = ed[i] > Math.max(0.28, edM * 4 + 0.12) ? 1 : 0;
  if (busy <= 0.55) blobs(fm, W, H, Math.round(n * 0.003)).filter((b) => !offPaint(b) && b.areaPct < 9 && b.elong < 5).slice(0, 4).forEach((b) => { let c = 0; for (const p of b.pts) c += ed[p]; c /= b.pts.length; add('golpe', b, 0.25 + Math.min(0.35, (c - 0.28) * 1.2), [`${b.areaPct.toFixed(1)}% del encuadre`, `densidad de bordes ${(c * 100).toFixed(0)}% frente a ${(edM * 100).toFixed(0)}% del entorno`, 'rótulos, rejillas, placas y logos también fragmentan']); });

  res.sort((a, b) => (b.kind === 'reflejo' ? -1 : 0) - (a.kind === 'reflejo' ? -1 : 0) || b.score * b.areaPct - a.score * a.areaPct);
  return { W, H, regions: res, notes, busy };
}

/* Condición aparente a partir de las zonas y de la calidad */
export function condition(q, det) {
  const real = det.regions.filter((r) => r.kind !== 'reflejo'); let pts = 0;
  for (const r of real) pts += r.score * Math.min(1, 0.35 + r.areaPct / 3) * (r.kind === 'relieve' || r.kind === 'golpe' ? 0.6 : 1) * (r.likelihood === 'baja' ? 0.3 : 1);
  if (q.sharp < 10 || q.mean < 45 || q.mean > 225) return { code: 'no_evaluable', label: 'No evaluable con confianza', pts, reason: 'La foto está movida, oscura o quemada: repítela antes de sacar conclusiones.' };
  const code = pts < 0.35 ? 'sin_novedades' : pts < 1.2 ? 'leves' : pts < 2.6 ? 'moderadas' : 'marcadas';
  const label = { sin_novedades: 'Sin novedades visibles', leves: 'Novedades leves', moderadas: 'Novedades moderadas', marcadas: 'Novedades marcadas' }[code];
  const reason = code === 'sin_novedades' ? 'No se identificaron marcas, manchas ni deformaciones que destaquen en esta foto.' : `Se identificaron ${real.length} zona(s) de interés${real.some((r) => r.likelihood === 'alta') ? ', alguna con probabilidad alta' : ''}. Confírmalas mirando la imagen reconstruida.`;
  return { code, label, pts: +pts.toFixed(2), reason };
}

/* Reconstrucción por niveles: suave, estándar o forense (con ampliación) */
export async function reconstruct(bmp, level = 'estandar') {
  const q = diagnose(bmp), p = autoParams(q);
  if (level === 'suave') Object.assign(p, { clahe: p.clahe * 0.5, clarity: 0.15, sharpen: 0.5, scale: 1 });
  if (level === 'forense') Object.assign(p, { clahe: Math.max(p.clahe, 0.6), clarity: 0.6, sharpen: 1.1, denoise: Math.max(2, p.denoise), wb: true, scale: Math.max(p.scale, 2) });
  if (level === 'estandar') p.scale = Math.max(1, Math.min(p.scale, 2));
  const canvas = await enhance(bmp, { ...BASE, ...p });
  return { canvas, params: p, quality: q, factor: +(canvas.width / (bmp.width || 1)).toFixed(2) };
}

/* Imagen resaltada: base reconstruida + relleno translúcido de los píxeles detectados + marco numerado */
export function highlight(baseCanvas, det, { only = null } = {}) {
  const out = document.createElement('canvas'); out.width = baseCanvas.width; out.height = baseCanvas.height; const g = out.getContext('2d'); g.drawImage(baseCanvas, 0, 0);
  const ov = document.createElement('canvas'); ov.width = det.W; ov.height = det.H; const og = ov.getContext('2d'), id = og.createImageData(det.W, det.H);
  const list = det.regions.filter((r) => !only || only.includes(r.kind));
  list.forEach((r) => { const c = KIND[r.kind].color; for (const p of r.mask) { id.data[p * 4] = c[0]; id.data[p * 4 + 1] = c[1]; id.data[p * 4 + 2] = c[2]; id.data[p * 4 + 3] = 150; } });
  og.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(ov, 0, 0, out.width, out.height);
  const lw = Math.max(2, out.width / 500), fs = Math.max(14, out.width / 55); g.lineWidth = lw; g.font = `bold ${fs}px sans-serif`; g.textBaseline = 'top';
  list.forEach((r, i) => { const c = KIND[r.kind].color, col = `rgb(${c[0]},${c[1]},${c[2]})`, pad = lw * 3, x = Math.max(0, r.x * out.width - pad), y = Math.max(0, r.y * out.height - pad), w = r.w * out.width + 2 * pad, h2 = r.h * out.height + 2 * pad;
    g.strokeStyle = col; g.strokeRect(x, y, w, h2); const t = String(i + 1), tw = g.measureText(t).width + 8; g.fillStyle = col; g.fillRect(x, Math.max(0, y - fs - 4), tw, fs + 4); g.fillStyle = '#000'; g.fillText(t, x + 4, Math.max(0, y - fs - 4) + 2); });
  return { canvas: out, list };
}

/* Texto descriptivo en español */
export function describe(photo, q, det, cond, rec) {
  const lines = []; const tag = `Foto ${photo.n}` + (photo.roleLabel ? ` (${photo.roleLabel}${photo.viewLabel ? ' · ' + photo.viewLabel : ''})` : '');
  lines.push(`${tag}: calidad ${q.grade} (luz media ${q.mean}/255, nitidez ${q.sharp}, ruido ${q.noise}${q.glarePct > 0.5 ? ', reflejos ' + q.glarePct + '%' : ''}).`);
  if (rec) lines.push(`Se reconstruyó a ${rec.canvas.width}×${rec.canvas.height} px${rec.factor > 1.05 ? ` (×${rec.factor.toFixed(1)})` : ''} sin tocar el original.`);
  const real = det.regions.filter((r) => r.kind !== 'reflejo'), refl = det.regions.filter((r) => r.kind === 'reflejo');
  if (!real.length) lines.push('No se identifican zonas de interés: no hay marcas lineales, manchas ni deformaciones que destaquen.');
  real.forEach((r, i) => lines.push(`Zona ${det.regions.indexOf(r) + 1}: ${KIND[r.kind].label.toLowerCase()} en la ${r.where}; probabilidad ${r.likelihood}. ${r.evidence.join('; ')}.`));
  if (refl.length) lines.push(`${refl.length} reflejo(s) de luz detectado(s): se descartan como daño, pero pueden ocultar detalle; conviene repetir la foto sin ellos.`);
  det.notes.forEach((n) => lines.push('Nota: ' + n));
  lines.push(`Condición aparente: ${cond.label}. ${cond.reason}`);
  return lines;
}
