/* Informe PDF del Laboratorio IA: originales, reconstrucciones, zonas resaltadas y descripción */
import { ctx, sha256Hex } from './lib.js';
import { APP_VERSION } from './config.js';
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
const T = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[•●]/g, '-').replace(/×/g, 'x').replace(/[^\u0000-ÿ]/g, '');
const jpg = (cv, w = 900, q = 0.8) => { const k = Math.min(1, w / cv.width), c = document.createElement('canvas'); c.width = Math.round(cv.width * k); c.height = Math.round(cv.height * k); c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height); return { d: c.toDataURL('image/jpeg', q), w: c.width, h: c.height }; };

export async function labReport({ items, compare, summary, onProgress = () => {} }) {
  const mod = await import(/* @vite-ignore */ JSPDF_URL), jsPDF = mod.jsPDF || mod.default?.jsPDF || mod.default, doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, M = 15, UW = PW - 2 * M, now = new Date(); let y = M; const ink = [24, 32, 44], teal = [14, 159, 146], muted = [96, 108, 122];
  const setC = (c) => doc.setTextColor(c[0], c[1], c[2]), np = () => { doc.addPage(); y = 20; }, need = (h) => { if (y + h > 276) np(); };
  const P = (t, o = {}) => { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 9.5); setC(o.color || ink); const ls = doc.splitTextToSize(T(t), o.w || UW); need(ls.length * 4.5 + 1); doc.text(ls, o.x || M, y); y += ls.length * 4.5 + (o.gap ?? 1.5); };
  const H1 = (t) => { need(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); setC(ink); doc.text(T(t), M, y); y += 2; doc.setDrawColor(...teal); doc.setLineWidth(0.7); doc.line(M, y, M + 24, y); y += 7; };
  doc.setFillColor(13, 17, 23); doc.rect(0, 0, PW, 70, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('VISIONPARK', M, 24); doc.setFontSize(8); doc.setTextColor(79, 209, 197); doc.text('F O R E N S I C   A I', M, 29);
  doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.text('INFORME DEL LABORATORIO IA', M, 48); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(190, 202, 216); doc.text('Reconstruccion de pixeles, zonas resaltadas y condicion aparente', M, 57);
  y = 82; P(`Generado: ${now.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })} · por ${ctx.user?.email || '-'} · ${ctx.org?.name || ''} · v${APP_VERSION}`, { size: 9, color: muted });
  P(`Fotos analizadas: ${items.length}. Los archivos originales no se modificaron; cada huella SHA-256 identifica el original.`, { size: 9, color: muted });
  if (summary) { y += 2; H1('Resumen'); summary.forEach((l) => P('- ' + l, { size: 9.5, gap: 1 })); }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; onProgress((i + 1) / (items.length + 1), `Foto ${it.n}`); np(); H1(`Foto ${it.n}${it.roleLabel ? ' · ' + it.roleLabel : ''}${it.viewLabel ? ' · ' + it.viewLabel : ''}`);
    P('SHA-256 del original: ' + it.hash, { size: 7.5, color: muted });
    const IW = (UW - 4) / 3, imgs = [['ORIGINAL', it.original], ['RECONSTRUIDA', it.rec], ['RESALTADA', it.hl]];
    imgs.forEach(([l, cv], k) => { if (!cv) return; const j = jpg(cv, 700), h = IW * j.h / j.w, x = M + k * (IW + 2); doc.setFillColor(20, 24, 32); doc.rect(x, y, IW, Math.min(h, IW * 0.8), 'F'); doc.addImage(j.d, 'JPEG', x, y, IW, Math.min(h, IW * 0.8)); doc.setFillColor(0, 0, 0); doc.rect(x, y, 26, 4.4, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.text(l, x + 1.5, y + 3); });
    y += IW * 0.8 + 5; P('Condicion aparente: ' + it.cond.label, { bold: true, size: 10.5 }); it.text.forEach((l) => P(l, { size: 9, gap: 1 }));
    if (it.regions.length) { y += 1; P('Zonas', { bold: true }); it.regions.forEach((r, k) => P(`${k + 1}. ${r.label} - ${r.where} - probabilidad ${r.likelihood}`, { size: 8.5, gap: 0.6, x: M + 3, w: UW - 3 })); }
  }
  if (compare?.length) { np(); H1('Comparacion ingreso / salida (o reclamacion)'); compare.forEach((c) => { need(60); P(c.title, { bold: true, size: 10.5 }); const j = jpg(c.canvas, 800), w = Math.min(UW, 110), h = w * j.h / j.w; need(h + 4); doc.addImage(j.d, 'JPEG', M, y, w, h); y += h + 3; c.lines.forEach((l) => P(l, { size: 9, gap: 1 })); y += 3; }); }
  np(); H1('Metodo y limites');
  ['Reconstruccion: reduccion de ruido bilateral, recuperacion de sombras (Retinex), atenuacion de reflejos, contraste local (CLAHE), claridad, enfoque y ampliacion por interpolacion. Hace mas legible lo que la camara capto; no inventa detalle.',
   'Resaltado: deteccion de lineas finas, desvios de color, variaciones anomalas de sombra, zonas muy fragmentadas y reflejos. Son hipotesis medibles.',
   'Sin foto de referencia solo se puede decir que se ve, no si es nuevo. Para saber si algo ocurrio durante la custodia se comparan ingreso y salida.',
   'Rotulos, rejillas, placas, juntas de paneles y reflejos naturales de la carroceria pueden aparecer como zonas de interes.',
   'El resultado es orientativo y requiere revision y aprobacion de una persona. No reemplaza a un perito.'].forEach((t) => P('- ' + t, { size: 9, gap: 1.5 }));
  const blob = doc.output('blob'); return { blob, sha: await sha256Hex(blob) };
}
