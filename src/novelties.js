/* Búsqueda de novedades: compara dos fotos dos veces (original y mejorada), confirma lo que aparece en ambas
   y clasifica cada zona de cambio con reglas medibles (forma, relieve, color, bordes, brillo). Son hipótesis para revisión humana. */
import { analyzePair, boxMean } from './cv.js';
import { enhance, PRESETS, BASE } from './enhance.js';

export const CLASSES = {
  rayon: { label: 'Rayón o marca lineal', color: '#ff7a59', ask: 'Rayón' },
  abolladura: { label: 'Abolladura o deformación', color: '#f5c542', ask: 'Abolladura / deformación' },
  mancha: { label: 'Mancha o suciedad', color: '#b48bff', ask: 'Mancha / suciedad' },
  golpe: { label: 'Golpe, fractura o pieza afectada', color: '#ff4d6d', ask: 'Golpe / fractura' },
  reflejo: { label: 'Reflejo o brillo (no es daño)', color: '#7fb6ff', ask: null },
  otro: { label: 'Cambio sin clasificar', color: '#9aa7b5', ask: null }
};
export const SEARCHABLE = Object.entries(CLASSES).filter(([, v]) => v.ask).map(([k, v]) => [k, v.ask]);

function pix(canvas, W, H, dx = 0, dy = 0) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, -dx, -dy, W, H); // se alinea B con A usando el desplazamiento medido
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

/* Rasgos de una zona y clasificación */
function classify(reg, ana, A, B, gEdge, lowDiff, hiDiff, glob) {
  const W = ana.W, H = ana.H, x0 = Math.max(0, Math.floor(reg.x * W)), x1 = Math.min(W, Math.ceil((reg.x + reg.w) * W)), y0 = Math.max(0, Math.floor(reg.y * H)), y1 = Math.min(H, Math.ceil((reg.y + reg.h) * H));
  let n = 0, sx = 0, sy = 0, dL = 0, dC = 0, eA = 0, eB = 0, gl = 0, lo = 0, hi = 0; const pts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (!ana.mask[i]) continue;
    n++; sx += x; sy += y; pts.push(i); dL += B.Y[i] - A.Y[i]; dC += Math.hypot(B.Cb[i] - A.Cb[i], B.Cr[i] - A.Cr[i]); eA += gEdge.a[i]; eB += gEdge.b[i];
    if ((A.Y[i] > 236 || B.Y[i] > 236) && Math.max(Math.abs(A.Cb[i]), Math.abs(A.Cr[i]), Math.abs(B.Cb[i]), Math.abs(B.Cr[i])) < 28) gl++;
    lo += Math.abs(lowDiff[i]); hi += Math.abs(hiDiff[i]); }
  if (!n) return { cls: 'otro', likelihood: 'baja', evidence: ['Sin píxeles suficientes.'], f: {} };
  const mx = sx / n, my = sy / n; let cxx = 0, cyy = 0, cxy = 0;
  for (const i of pts) { const x = (i % W) - mx, y = ((i / W) | 0) - my; cxx += x * x; cyy += y * y; cxy += x * y; }
  cxx /= n; cyy /= n; cxy /= n; const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(tr * tr / 4 - det, 0)), l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 0.05);
  const elong = Math.sqrt(l1 / l2), bboxA = Math.max(1, (x1 - x0) * (y1 - y0)), fill = n / bboxA;
  const f = { elong: +elong.toFixed(1), fill: +fill.toFixed(2), dL: +(dL / n - glob.dL).toFixed(1), dC: +(dC / n - glob.dC).toFixed(1), edgeGain: +((eB - eA) / (eA + eB + 4 * n)).toFixed(2), glare: +(gl / n).toFixed(2), shade: +(lo / Math.max(hi, 1e-3)).toFixed(2), areaPct: reg.areaPct };
  const ev = [`forma: ${f.elong >= 4 ? 'alargada' : f.elong >= 2.2 ? 'algo alargada' : 'compacta'} (elongación ${f.elong})`, `luz: ${f.dL > 4 ? 'más clara' : f.dL < -4 ? 'más oscura' : 'similar'} (${f.dL >= 0 ? '+' : ''}${f.dL})`, `color: ${f.dC > 9 ? 'cambio notorio' : 'sin cambio notorio'} (${f.dC})`, `bordes nuevos: ${f.edgeGain > 0.12 ? 'sí' : f.edgeGain < -0.12 ? 'se pierden' : 'no'} (${f.edgeGain})`];
  let cls = 'otro', score = 0.3;
  if (f.glare > 0.3) { cls = 'reflejo'; score = 0.5 + f.glare / 2; ev.push(`${Math.round(f.glare * 100)}% de la zona está saturada de brillo`); }
  else if (f.elong >= 4 && f.fill < 0.7 && f.edgeGain > 0.03) { cls = 'rayon'; score = 0.5 + Math.min(0.4, (f.elong - 4) / 12) + Math.min(0.1, f.edgeGain); }
  else if (f.dC > 9 && f.edgeGain < 0.12 && f.fill > 0.25) { cls = 'mancha'; score = 0.45 + Math.min(0.4, f.dC / 40); }
  else if (reg.areaPct >= 1.2 && f.edgeGain > 0.2) { cls = 'golpe'; score = 0.5 + Math.min(0.4, f.edgeGain); }
  else if (f.shade > 1.1 && f.edgeGain < 0.2 && reg.areaPct >= 0.8) { cls = 'abolladura'; score = 0.45 + Math.min(0.4, (f.shade - 1) / 3); ev.push('el cambio es de sombra suave más que de bordes'); }
  else if (f.edgeGain > 0.12) { cls = f.elong >= 2.5 ? 'rayon' : 'golpe'; score = 0.4; }
  return { cls, likelihood: score >= 0.75 ? 'alta' : score >= 0.5 ? 'media' : 'baja', score: +score.toFixed(2), evidence: ev, f };
}

const inter = (a, b) => { const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return (x * y) / Math.max(1e-6, Math.min(a.w * a.h, b.w * b.h)); };

/* Análisis reforzado: original + mejorada (consenso). Devuelve zonas clasificadas y confirmadas. */
export async function robustCompare(bmpA, bmpB, { onProgress = () => {} } = {}) {
  onProgress('Analizando las fotos originales…');
  const raw = await analyzePair(bmpA, bmpB, { width: 400 });
  onProgress('Mejorando los píxeles de ambas fotos…');
  const P = { ...BASE, ...PRESETS.comparar.p }, [eA, eB] = await Promise.all([enhance(bmpA, { ...P }), enhance(bmpB, { ...P })]);
  onProgress('Analizando las fotos mejoradas…');
  const enh = await analyzePair(eA, eB, { width: 640 });
  if (enh.confidence === 'abstencion' && raw.confidence === 'abstencion') return { raw, enh, regions: [], confidence: 'abstencion', notes: enh.notes };
  onProgress('Clasificando las zonas…');
  const W = enh.W, H = enh.H, A = pix(eA, W, H), B = pix(eB, W, H, enh.shift.dx, enh.shift.dy);
  const eAe = sobel(A.Y, W, H), eBe = sobel(B.Y, W, H);
  const lowA = blurRaw(A.Y, W, H, Math.round(W / 40)), lowB = blurRaw(B.Y, W, H, Math.round(W / 40));
  const lowDiff = new Float32Array(W * H), hiDiff = new Float32Array(W * H); let gdL = 0, gdC = 0, gn = 0;
  for (let i = 0; i < W * H; i++) { lowDiff[i] = lowB[i] - lowA[i]; hiDiff[i] = (B.Y[i] - lowB[i]) - (A.Y[i] - lowA[i]); if (!enh.mask[i]) { gdL += B.Y[i] - A.Y[i]; gdC += Math.hypot(B.Cb[i] - A.Cb[i], B.Cr[i] - A.Cr[i]); gn++; } }
  const glob = { dL: gdL / Math.max(gn, 1), dC: gdC / Math.max(gn, 1) };
  const out = enh.regions.map((r) => { const c = classify(r, enh, A, B, { a: eAe, b: eBe }, lowDiff, hiDiff, glob), inRaw = raw.regions.some((q) => inter(r, q) >= 0.3);
    return { ...r, ...c, status: inRaw ? 'confirmada' : 'solo_mejorada', source: 'enh' }; });
  raw.regions.forEach((q) => { if (!out.some((r) => inter(r, q) >= 0.3)) out.push({ ...q, cls: 'otro', likelihood: 'baja', score: 0.2, evidence: ['Solo aparece en la foto original, no tras mejorar los píxeles: puede ser ruido o un efecto de compresión.'], f: {}, status: 'solo_original', source: 'raw' }); });
  const rank = { confirmada: 2, solo_mejorada: 1, solo_original: 0 };
  out.sort((a, b) => rank[b.status] - rank[a.status] || b.areaPct * b.intensity - a.areaPct * a.intensity);
  return { raw, enh, regions: out, confidence: enh.confidence, notes: [...new Set([...enh.notes, ...raw.notes])], shift: enh.shift };
}
function blurRaw(a, W, H, r) { r = Math.max(2, r); return boxMean(boxMean(a, W, H, r), W, H, r); }

/* Lista de verificación: para cada novedad buscada, ¿se detecta? */
export function checklist(result, wanted) {
  return wanted.map((k) => {
    const hits = result.regions.filter((r) => r.cls === k && r.status !== 'solo_original');
    const strong = hits.filter((r) => r.status === 'confirmada' && r.likelihood !== 'baja');
    const state = result.confidence === 'abstencion' ? 'no_concluyente' : strong.length ? 'detectada' : hits.length ? 'posible' : 'no_detectada';
    return { key: k, label: CLASSES[k].ask, state, count: hits.length, best: hits[0] || null };
  });
}
