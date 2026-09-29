/* Informe PDF de demostración visual: se arma en el navegador con jsPDF y queda registrado con su huella SHA-256 */
import { supabase, ctx, h, db, can, toast, openModal, fmtDate, sha256Hex, badge, REVIEW } from './lib.js';
import { loadBitmap, analyzePair, claimVerdict, overallVerdict, thumbData, overlayData } from './cv.js';
import { APP_VERSION } from './config.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
const ENGINE = 'vision-local-1';
const T = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[•●]/g, '-').replace(/×/g, 'x').replace(/[^\u0000-ÿ]/g, '');
const dt = (s) => (s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const short = (id) => String(id || '').slice(0, 8).toUpperCase();
const VLABEL = { indicios: 'INDICIOS DE CAMBIO DURANTE LA CUSTODIA', sin_indicios: 'SIN INDICIOS EN LAS VISTAS ANALIZADAS', no_concluyente: 'NO CONCLUYENTE', sin_diferencias: 'SIN DIFERENCIAS VISIBLES' };
const VCOLOR = { indicios: [176, 42, 55], sin_indicios: [26, 122, 70], no_concluyente: [140, 110, 20], sin_diferencias: [26, 122, 70] };

async function gather(session, claim) {
  const q = (t, sel) => supabase.from(t).select(sel);
  const [views, caps, cviews, findings, reviews, events, parts, damages] = await Promise.all([
    db(q('canonical_views', '*').order('sort_order')),
    db(q('capture_views', 'phase,view_code,quality,usable,evidence_id,created_at,evidence_files(id,storage_path,sha256_client,captured_at,device,bytes)').eq('session_id', session.id).order('created_at')),
    claim ? db(q('claim_views', 'view_code,evidence_id,note,quality,usable,created_at,evidence_files(id,storage_path,sha256_client,captured_at,device,bytes)').eq('claim_id', claim.id).order('created_at')) : Promise.resolve([]),
    db(q('findings', 'id,part_code,damage_code,state,validation,created_at').eq('session_id', session.id).order('created_at')),
    db(q('finding_reviews', 'finding_id,decision,note,created_at,corrected_state,corrected_damage_code').eq('site_id', ctx.site.id).order('created_at')),
    claim ? db(q('claim_events', 'event_type,detail,created_at').eq('claim_id', claim.id).order('created_at')) : Promise.resolve([]),
    db(q('vehicle_parts', 'code,name')), db(q('damage_types', 'code,name'))
  ]);
  return { views, caps, cviews, findings, reviews: reviews.filter((r) => findings.some((f) => f.id === r.finding_id)), events, parts: Object.fromEntries(parts.map((p) => [p.code, p.name])), damages: Object.fromEntries(damages.map((d) => [d.code, d.name])) };
}

export async function generateReport({ session, claim, options = {}, onProgress = () => {} }) {
  onProgress(0.02, 'Leyendo el expediente…');
  const D = await gather(session, claim);
  const latest = new Map(D.caps.map((c) => [c.phase + ':' + c.view_code, c]));
  const cBy = new Map(); D.cviews.filter((c) => c.view_code).forEach((c) => cBy.set(c.view_code, [...(cBy.get(c.view_code) || []), c]));
  const work = D.views.filter((v) => (latest.get('ingreso:' + v.code) && latest.get('salida:' + v.code)) || (claim && latest.get('ingreso:' + v.code) && cBy.get(v.code)));
  const results = [];
  for (let i = 0; i < work.length; i++) {
    const v = work[i], a = latest.get('ingreso:' + v.code), b = latest.get('salida:' + v.code), c = cBy.get(v.code)?.[0];
    onProgress(0.05 + 0.5 * (i / Math.max(work.length, 1)), `Analizando ${v.code} · ${v.name} (${i + 1} de ${work.length})`);
    const r = { view: v, a, b, c, stay: null, cl: null, verdict: null, bm: {} };
    try {
      r.bm.a = a ? await loadBitmap(a.evidence_files.storage_path) : null; r.bm.b = b ? await loadBitmap(b.evidence_files.storage_path) : null; r.bm.c = c ? await loadBitmap(c.evidence_files.storage_path) : null;
      if (r.bm.a && r.bm.b) r.stay = await analyzePair(r.bm.a, r.bm.b);
      if (claim && r.bm.a && r.bm.c) r.cl = await analyzePair(r.bm.a, r.bm.c);
      if (claim && r.stay && r.cl) r.verdict = claimVerdict(r.stay, r.cl);
      else if (claim && r.cl) r.verdict = { code: 'no_concluyente', label: 'No concluyente', reason: 'Falta la foto de salida de esta vista.', confidence: 'abstencion' };
    } catch (e) { r.error = e.message; }
    results.push(r);
  }
  const overall = claim ? overallVerdict(results.map((r) => r.verdict).filter(Boolean)) : null;

  onProgress(0.6, 'Componiendo el documento…');
  const mod = await import(/* @vite-ignore */ JSPDF_URL); const jsPDF = mod.jsPDF || mod.default?.jsPDF || mod.default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, M = 15, UW = PW - 2 * M, reportId = crypto.randomUUID(), now = new Date();
  const generatedBy = ctx.user?.email || '-';
  let y = M;
  const ink = [24, 32, 44], teal = [14, 159, 146], muted = [96, 108, 122], line = [214, 220, 228];
  const setC = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const newPage = () => { doc.addPage(); y = 22; };
  const need = (hh) => { if (y + hh > 276) newPage(); };
  const H1 = (t) => { need(18); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setC(ink); doc.text(T(t), M, y); y += 2; doc.setDrawColor(...teal); doc.setLineWidth(0.7); doc.line(M, y, M + 24, y); y += 7; };
  const P = (t, o = {}) => { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 10); setC(o.color || ink); const lines = doc.splitTextToSize(T(t), o.w || UW); need(lines.length * (o.lh || 4.6) + 1); doc.text(lines, o.x || M, y); y += lines.length * (o.lh || 4.6) + (o.gap ?? 2); };
  const KV = (rows) => { rows.forEach(([k, v], i) => { const lines = doc.splitTextToSize(T(v), UW - 52); const hh = Math.max(7, lines.length * 4.6 + 2.6); need(hh);
    if (i % 2 === 0) { doc.setFillColor(244, 247, 250); doc.rect(M, y - 4.4, UW, hh, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setC(muted); doc.text(T(k), M + 2, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setC(ink); doc.text(lines, M + 50, y); y += hh; }); y += 3; };

  /* Portada */
  doc.setFillColor(13, 17, 23); doc.rect(0, 0, PW, 118, 'F');
  doc.setDrawColor(...[79, 209, 197]); doc.setLineWidth(1.2); doc.roundedRect(M, 22, 14, 14, 3, 3, 'S'); doc.setFillColor(79, 209, 197); doc.circle(M + 7, 29, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(255, 255, 255); doc.text('VISIONPARK', M + 19, 30);
  doc.setFontSize(8.5); doc.setTextColor(79, 209, 197); doc.text('F O R E N S I C   A I', M + 19, 35);
  doc.setTextColor(255, 255, 255); doc.setFontSize(26); doc.text(doc.splitTextToSize('INFORME DE DEMOSTRACION VISUAL', UW), M, 68);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(190, 202, 216);
  doc.text(doc.splitTextToSize(T(claim ? 'Comparacion de la evidencia de ingreso, salida y reclamacion' : 'Comparacion de la evidencia de ingreso y salida'), UW), M, 90);
  doc.setFontSize(9); doc.text('Documento confidencial · Apoyo a la decision humana', M, 108);
  y = 134; doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setC(muted); doc.text('PLACA', M, y);
  doc.setFillColor(255, 255, 255); doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.6); doc.roundedRect(M, y + 2, 62, 16, 2, 2, 'FD'); doc.setFont('courier', 'bold'); doc.setFontSize(24); setC([20, 20, 20]); doc.text(T(session.plate), M + 31, y + 13.5, { align: 'center' });
  y = 166;
  KV([['Expediente', claim ? 'Reclamacion ' + short(claim.id) : 'Sesion ' + short(session.id)], ['Organizacion', ctx.org.name], ['Sede', ctx.site.name], ['Modalidad', session.modality === 'valet' ? 'Valet' : 'Autoservicio'],
    ['Reclamante', claim?.claimant_name || '-'], ['Generado el', now.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })], ['Generado por', generatedBy], ['ID del informe', reportId], ['Version de la aplicacion', 'VISIONPARK ' + APP_VERSION + ' · motor ' + ENGINE]]);

  /* 1. Resumen ejecutivo */
  newPage(); H1('1. Resumen ejecutivo');
  const nIng = D.views.filter((v) => latest.get('ingreso:' + v.code)).length, nSal = D.views.filter((v) => latest.get('salida:' + v.code)).length;
  const stayChanged = results.filter((r) => r.stay && r.stay.confidence !== 'abstencion' && r.stay.regions.length).length;
  const counts = { indicios: 0, sin_indicios: 0, sin_diferencias: 0, no_concluyente: 0 }; results.forEach((r) => { if (r.verdict) counts[r.verdict.code]++; });
  const box = (label, sub, col) => { need(30); doc.setFillColor(col[0], col[1], col[2]); doc.roundedRect(M, y, UW, 24, 2, 2, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('RESULTADO ORIENTATIVO', M + 5, y + 7);
    doc.setFontSize(14); doc.text(T(label), M + 5, y + 15); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(doc.splitTextToSize(T(sub), UW - 10), M + 5, y + 20.5); y += 30; };
  if (claim) {
    const sub = overall.code === 'indicios' ? 'Los cambios que muestra la reclamacion ya eran visibles en las fotos de salida en al menos una vista.' : overall.code === 'sin_indicios' ? 'Los cambios que muestra la reclamacion no aparecen en las fotos de salida de las vistas concluyentes.' : 'Las fotos disponibles no permiten una conclusion automatica. Se requiere revision humana.';
    box(VLABEL[overall.code], sub, VCOLOR[overall.code]);
  } else box(stayChanged ? 'CAMBIOS DETECTADOS ENTRE INGRESO Y SALIDA' : 'SIN CAMBIOS RELEVANTES ENTRE INGRESO Y SALIDA', stayChanged ? stayChanged + ' vista(s) presentan zonas de cambio que deben revisarse.' : 'En las vistas comparadas no se detectaron zonas de cambio relevantes.', stayChanged ? VCOLOR.indicios : VCOLOR.sin_indicios);
  const figs = [[nIng + '/24', 'Vistas de ingreso'], [nSal + '/24', 'Vistas de salida'], [String(results.filter((r) => r.stay).length), 'Vistas comparadas'], [String(stayChanged), 'Con cambios ingreso a salida'], ...(claim ? [[String(D.cviews.length), 'Fotos de la reclamacion'], [String(counts.indicios), 'Vistas con indicios'], [String(counts.sin_indicios + counts.sin_diferencias), 'Vistas sin indicios'], [String(counts.no_concluyente), 'Vistas no concluyentes']] : [])];
  const cw = (UW - 6) / 4; figs.forEach((f, i) => { const cx = M + (i % 4) * (cw + 2), cy = y + Math.floor(i / 4) * 21; doc.setFillColor(244, 247, 250); doc.roundedRect(cx, cy, cw, 18, 2, 2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setC(ink); doc.text(T(f[0]), cx + cw / 2, cy + 8, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setC(muted); doc.text(doc.splitTextToSize(T(f[1]), cw - 4), cx + cw / 2, cy + 13, { align: 'center' }); });
  y += Math.ceil(figs.length / 4) * 21 + 4;
  P('Como leer este resultado', { bold: true, size: 11 });
  P('El informe compara, vista por vista, las fotografias tomadas al ingreso, a la salida' + (claim ? ' y las aportadas con la reclamacion' : '') + '. Cada foto tiene una huella digital SHA-256 calculada en el dispositivo al capturarla, de modo que cualquier alteracion posterior es detectable. El analisis de vision digital alinea las fotos, compensa las diferencias de luz y senala las zonas que cambiaron.');
  if (claim) P('Un resultado de "indicios" significa que los cambios visibles en la foto de la reclamacion ya aparecen en las fotos de salida; "sin indicios", que no aparecen. Ninguno es una prueba definitiva: la conclusion la toma una persona autorizada tras revisar las imagenes.');
  P('Este informe es una ayuda para la decision y no reemplaza la valoracion de un perito ni de la autoridad competente.', { color: muted, size: 9 });

  /* 2. Datos del caso */
  H1('2. Datos del caso');
  const cov = (v) => (v == null ? '-' : Math.round(v * 100) + '%');
  KV([['Placa', session.plate], ['Modalidad', session.modality === 'valet' ? 'Valet' : 'Autoservicio'], ['Ingreso', dt(session.entered_at)], ['Salida', session.exited_at ? dt(session.exited_at) : 'Sin registrar'], ['Estado de la sesion', session.status],
    ['Cobertura de vistas', 'Ingreso ' + cov(session.coverage_in) + ' · Salida ' + cov(session.coverage_out)],
    ...(claim ? [['Reclamante', claim.claimant_name || '-'], ['Descripcion', claim.description || '-'], ['Estado de la reclamacion', claim.status], ['Apertura', dt(claim.opened_at)], ...(claim.closed_at ? [['Cierre', dt(claim.closed_at)]] : [])] : [])]);

  /* 3. Cronología */
  H1('3. Cronologia');
  const span = (arr) => (arr.length ? [dt(arr[0]), dt(arr[arr.length - 1])] : null);
  const capAt = (ph) => D.caps.filter((c) => c.phase === ph).map((c) => c.evidence_files?.captured_at).filter(Boolean).sort();
  const tl = [[session.entered_at, 'Ingreso del vehiculo registrado']];
  const si = capAt('ingreso'), ss = capAt('salida'); if (si.length) tl.push([si[0], `Captura de fotos de ingreso (${si.length}), hasta ${dt(si[si.length - 1])}`]); if (session.exited_at) tl.push([session.exited_at, 'Salida del vehiculo registrada']);
  if (ss.length) tl.push([ss[0], `Captura de fotos de salida (${ss.length}), hasta ${dt(ss[ss.length - 1])}`]);
  if (claim) { tl.push([claim.opened_at, 'Reclamacion abierta']); const cc = D.cviews.map((c) => c.evidence_files?.captured_at).filter(Boolean).sort(); if (cc.length) tl.push([cc[0], `Fotos de la reclamacion cargadas (${cc.length})`]); D.events.forEach((e) => tl.push([e.created_at, 'Reclamacion: ' + e.event_type + (e.detail?.a ? ' -> ' + e.detail.a : '')])); if (claim.closed_at) tl.push([claim.closed_at, 'Reclamacion cerrada']); }
  D.findings.forEach((f) => tl.push([f.created_at, 'Hallazgo registrado: ' + (D.parts[f.part_code] || f.part_code || '-') + ' / ' + (D.damages[f.damage_code] || f.damage_code || '-')]));
  tl.sort((a, b) => new Date(a[0]) - new Date(b[0])).forEach(([w, t], i) => { need(7); if (i % 2 === 0) { doc.setFillColor(244, 247, 250); doc.rect(M, y - 4.2, UW, 6.6, 'F'); } doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setC(muted); doc.text(dt(w), M + 2, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setC(ink); doc.text(doc.splitTextToSize(T(t), UW - 42)[0], M + 38, y); y += 6.6; });
  y += 4;

  /* 4. Cadena de custodia */
  H1('4. Cadena de custodia de la evidencia');
  P('Cada fila es una fotografia original. La huella SHA-256 se calculo en el dispositivo de captura antes de subirla; si el archivo se modifica, la huella deja de coincidir.', { size: 9, color: muted });
  const ev = [];
  D.caps.forEach((c) => ev.push({ fase: c.phase === 'ingreso' ? 'Ingreso' : 'Salida', vista: c.view_code, f: c.evidence_files }));
  D.cviews.forEach((c) => ev.push({ fase: 'Reclamacion', vista: c.view_code || 'Sin vista', f: c.evidence_files }));
  const seen = new Set(); const evu = ev.filter((e) => e.f && !seen.has(e.f.id) && seen.add(e.f.id));
  const cols = [[M + 1, '#'], [M + 9, 'Fase'], [M + 32, 'Vista'], [M + 48, 'Captura'], [M + 78, 'SHA-256 (huella)']];
  const thead = () => { need(12); doc.setFillColor(...ink); doc.rect(M, y - 4.5, UW, 7, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); cols.forEach(([x, t]) => doc.text(t, x, y)); y += 6.5; };
  thead();
  evu.forEach((e, i) => { if (y + 9 > 276) { newPage(); thead(); } if (i % 2 === 0) { doc.setFillColor(244, 247, 250); doc.rect(M, y - 4, UW, 9, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setC(ink); doc.text(String(i + 1), cols[0][0], y); doc.text(T(e.fase), cols[1][0], y); doc.text(T(e.vista), cols[2][0], y); doc.text(dt(e.f.captured_at), cols[3][0], y);
    doc.setFont('courier', 'normal'); doc.setFontSize(6.6); doc.text(e.f.sha256_client.slice(0, 32), cols[4][0], y - 0.6); doc.text(e.f.sha256_client.slice(32), cols[4][0], y + 2.6); y += 9; });
  const setHash = await sha256Hex(new Blob([evu.map((e) => e.f.sha256_client).sort().join('\n')]));
  y += 2; P('Huella de conjunto de la evidencia (SHA-256 de todas las huellas ordenadas)', { bold: true, size: 9 }); doc.setFont('courier', 'normal'); doc.setFontSize(7.5); setC(ink); need(8); doc.text(setHash.slice(0, 32), M, y); doc.text(setHash.slice(32), M, y + 3.5); y += 9;

  /* 5. Comparación por vista */
  onProgress(0.7, 'Insertando las imágenes…');
  newPage(); H1('5. Comparacion por vista');
  const detailed = results.filter((r) => (claim ? r.c : (r.stay && r.stay.confidence !== 'abstencion' && r.stay.regions.length)));
  const sumRows = results.filter((r) => r.stay || r.cl);
  if (sumRows.length) {
    P('Resumen numerico de todas las vistas comparadas', { bold: true, size: 10 });
    const sc = claim ? [[M + 1, 'Vista', 46], [M + 50, 'Similitud I-S', 0], [M + 76, 'Cambio I-S', 0], [M + 100, 'Cambio I-R', 0], [M + 124, 'Confianza', 0], [M + 148, 'Resultado', 0]] : [[M + 1, 'Vista', 46], [M + 60, 'Similitud', 0], [M + 90, 'Area con cambios', 0], [M + 128, 'Zonas', 0], [M + 148, 'Confianza', 0]];
    const sh = () => { need(12); doc.setFillColor(...ink); doc.rect(M, y - 4.5, UW, 7, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); sc.forEach(([x, t]) => doc.text(t, x, y)); y += 6.5; }; sh();
    sumRows.forEach((r, i) => { if (y + 7 > 276) { newPage(); sh(); } if (i % 2 === 0) { doc.setFillColor(244, 247, 250); doc.rect(M, y - 4, UW, 6.4, 'F'); } doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setC(ink);
      const pct = (a) => (a ? Math.round(a.ssim * 100) + '%' : '-'), chg = (a) => (a ? a.changedPct + '%' : '-'), conf = (r.cl?.confidence && r.stay?.confidence) ? r.verdict?.confidence : (r.stay?.confidence || r.cl?.confidence || '-');
      const cells = claim ? [T(r.view.code + ' ' + r.view.name).slice(0, 30), pct(r.stay), chg(r.stay), chg(r.cl), T(conf || '-'), T(r.verdict ? r.verdict.label : '-').slice(0, 26)] : [T(r.view.code + ' ' + r.view.name).slice(0, 36), pct(r.stay), chg(r.stay), String(r.stay?.regions.length ?? '-'), T(r.stay?.confidence || '-')];
      cells.forEach((t, k) => doc.text(t, sc[k][0], y)); y += 6.4; });
    y += 4;
  }
  const IW = (UW - 4) / 3;
  const imgBox = (data, x, yy, lbl) => { doc.setFillColor(20, 24, 32); doc.rect(x, yy, IW, IW * 0.75, 'F'); if (data) doc.addImage(data.data, 'JPEG', x, yy, IW, IW * 0.75); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setFillColor(0, 0, 0); doc.rect(x, yy, 22, 4.4, 'F'); doc.setTextColor(255, 255, 255); doc.text(T(lbl), x + 1.5, yy + 3.1); };
  for (let i = 0; i < detailed.length; i++) {
    const r = detailed[i]; onProgress(0.7 + 0.25 * (i / Math.max(detailed.length, 1)), `Página de ${r.view.code} · ${r.view.name}`);
    need(112); const v = r.view;
    doc.setFillColor(...ink); doc.rect(M, y - 4.5, UW, 8, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255); doc.text(T(v.code + ' · ' + v.name), M + 2, y + 0.8);
    if (r.verdict) { const c = VCOLOR[r.verdict.code]; doc.setFillColor(...c); const lbl = T(r.verdict.label.toUpperCase()); doc.roundedRect(PW - M - 66, y - 3.6, 65, 6.2, 1.5, 1.5, 'F'); doc.setFontSize(7); doc.text(lbl.slice(0, 40), PW - M - 33.5, y + 0.5, { align: 'center' }); }
    y += 6;
    const bm = r.bm; const t3 = [r.a && bm.a ? thumbData(bm.a, 420) : null, r.b && bm.b ? thumbData(bm.b, 420) : null, r.c && bm.c ? thumbData(bm.c, 420) : null];
    imgBox(t3[0], M, y, 'INGRESO'); imgBox(t3[1], M + IW + 2, y, 'SALIDA'); if (claim) imgBox(t3[2], M + 2 * (IW + 2), y, 'RECLAMACION'); y += IW * 0.75 + 3;
    const withHeat = options.heat !== false;
    const o1 = withHeat && r.stay && bm.b ? overlayData(bm.b, r.stay.heat, 420) : null, o2 = withHeat && claim && r.cl && bm.c ? overlayData(bm.c, r.cl.heat, 420) : null;
    if (o1 || o2) { imgBox(o1, M, y, 'CAMBIO I-S'); if (claim) imgBox(o2, M + IW + 2, y, 'CAMBIO I-R'); }
    const tx = claim ? M + 2 * (IW + 2) : M + IW + 2, tw = claim ? IW : UW - IW - 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setC(ink); let ty = y + 3; const line1 = (t, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); const ls = doc.splitTextToSize(T(t), tw); doc.text(ls, tx, ty); ty += ls.length * 3.7 + 0.6; };
    if (r.stay) { line1('Ingreso vs salida', true); line1(`Similitud ${Math.round(r.stay.ssim * 100)}% · cambio ${r.stay.changedPct}% · ${r.stay.regions.length} zona(s) · confianza ${r.stay.confidence}`); r.stay.regions.slice(0, 2).forEach((z, k) => line1(`  Z${k + 1}: ${z.severity}, ${z.areaPct}% del area`)); }
    if (r.cl) { line1('Ingreso vs reclamacion', true); line1(`Similitud ${Math.round(r.cl.ssim * 100)}% · cambio ${r.cl.changedPct}% · ${r.cl.regions.length} zona(s)`); }
    if (r.verdict) { line1('Cruce de resultados', true); line1(r.verdict.reason); }
    (r.stay?.notes || []).concat(r.cl?.notes || []).slice(0, 2).forEach((n) => line1('Nota: ' + n));
    if (r.c?.note) line1('Nota del cargador: ' + r.c.note);
    y += IW * 0.75 + 6; if (r.error) P('No se pudo analizar esta vista: ' + r.error, { color: VCOLOR.indicios, size: 8 });
  }
  if (!detailed.length) P(claim ? 'No hay fotos de la reclamacion asignadas a una vista: no se generaron comparaciones detalladas.' : 'No se detectaron cambios relevantes que requieran detalle grafico.', { color: muted });

  /* 6. Hallazgos */
  H1('6. Hallazgos y revision humana');
  if (!D.findings.length) P('No hay hallazgos registrados para esta sesion.', { color: muted });
  D.findings.forEach((f) => { need(18); const rv = D.reviews.filter((x) => x.finding_id === f.id); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setC(ink);
    doc.text(T((D.parts[f.part_code] || f.part_code || 'Pieza sin definir') + ' / ' + (D.damages[f.damage_code] || f.damage_code || 'Dano sin definir')), M, y); y += 4.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setC(muted); doc.text(T(`Estado de evidencia ${f.state} · Validacion ${f.validation} · Registrado ${dt(f.created_at)}`), M, y); y += 4.4;
    rv.forEach((x) => P(`Revision ${dt(x.created_at)}: ${x.decision}${x.corrected_state ? ' (estado ' + x.corrected_state + ')' : ''}${x.note ? ' - ' + x.note : ''}`, { size: 8.5, gap: 0.5 })); y += 3; });

  /* 7. Metodología */
  H1('7. Metodologia y limites');
  P('El analisis de vision digital de este informe (motor ' + ENGINE + ') es determinista y se ejecuta en el navegador de quien genera el informe; las fotos no se envian a terceros. Pasos:', { size: 9.5 });
  ['Captura y huella: cada foto se firma con SHA-256 en el dispositivo y se guarda como original inmutable.',
   'Normalizacion de la iluminacion: cada punto se expresa respecto a su vecindario para reducir el efecto de cambios de luz, sombras y exposicion.',
   'Alineacion: se estima el desplazamiento entre las dos fotos (busqueda gruesa a fina) y se compara solo la zona comun.',
   'Mapa de cambio: se mide la diferencia local, se suaviza y se aplica un umbral adaptativo; se eliminan manchas pequenas.',
   'Zonas: se agrupan los puntos conectados; cada zona recibe su area y una severidad orientativa (leve menos de 1%, moderado de 1% a 4%, mayor desde 4% del area).',
   'Similitud estructural (SSIM) global como medida de que tan comparables son las dos fotos.',
   'Cruce con la reclamacion: se mide que parte de los cambios ingreso-reclamacion ya eran visibles en ingreso-salida. 50% o mas: indicios; 15% o menos: sin indicios; en medio: no concluyente.',
   'Abstencion: si las fotos estan muy desplazadas o parecen de otro punto de vista, el sistema no concluye.'].forEach((t, i) => P((i + 1) + '. ' + t, { size: 9, gap: 1, x: M + 3, w: UW - 3 }));
  P('Limites', { bold: true, size: 10 });
  ['Detecta diferencias visuales, no interpreta si son dano; suciedad, lluvia, reflejos, sombras o cambios de angulo pueden aparecer como cambios.',
   'Trabaja con una version reducida de las fotos (400 px de ancho): rayones muy finos pueden no detectarse.',
   'Los resultados son orientativos; toda conclusion requiere revision y aprobacion humana.',
   'El servidor de IA de vision profunda aun no interviene en este informe.'].forEach((t) => P('- ' + t, { size: 9, gap: 1, x: M + 3, w: UW - 3 }));

  /* 8. Conclusión y firmas */
  H1('8. Conclusion y firmas');
  P(claim ? `Resultado automatico: ${VLABEL[overall.code]}. La determinacion final corresponde a la persona responsable tras revisar las imagenes y este informe.` : 'Este informe documenta las diferencias visuales detectadas entre el ingreso y la salida. La determinacion final corresponde a la persona responsable.');
  need(50); y += 8;
  [['Elaboro', generatedBy], ['Reviso', ''], ['Aprobo', '']].forEach(([role, who], i) => { const x = M + i * (UW / 3 + 1); doc.setDrawColor(...ink); doc.setLineWidth(0.3); doc.line(x, y + 16, x + UW / 3 - 6, y + 16); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setC(ink); doc.text(role, x, y + 21); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setC(muted); doc.text(doc.splitTextToSize(T(who || 'Nombre, cargo y fecha'), UW / 3 - 6), x, y + 25.5); });

  /* Pie de página en todas las hojas */
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) { doc.setPage(p); doc.setDrawColor(...line); doc.setLineWidth(0.2); doc.line(M, 285, PW - M, 285); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setC(muted);
    doc.text(T(`VISIONPARK Forensic AI · Informe ${short(reportId)} · ${session.plate} · Confidencial`), M, 290); doc.text(`Pagina ${p} de ${total}`, PW - M, 290, { align: 'right' }); }
  onProgress(0.96, 'Calculando la huella del informe…');
  const blob = doc.output('blob'); const hash = await sha256Hex(blob);
  const name = `Informe_${session.plate}_${now.toISOString().slice(0, 10)}_${short(reportId)}.pdf`;
  return { blob, hash, name, reportId, evidenceIds: evu.map((e) => e.f.id), pages: total, overall, results: results.length };
}

async function store({ session, claim, out }) {
  const path = `${ctx.org.id}/${ctx.site.id}/${session.id}/reports/${out.reportId}.pdf`;
  const up = await supabase.storage.from('evidence').upload(path, out.blob, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(up.error.message);
  let rep = claim
    ? await db(supabase.from('reports').select('id').eq('claim_id', claim.id).limit(1).maybeSingle())
    : await db(supabase.from('reports').select('id').eq('session_id', session.id).is('claim_id', null).limit(1).maybeSingle());
  if (!rep) rep = await db(supabase.from('reports').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, claim_id: claim?.id || null }).select('id').single());
  const last = await db(supabase.from('report_versions').select('version').eq('report_id', rep.id).order('version', { ascending: false }).limit(1).maybeSingle());
  await db(supabase.from('report_versions').insert({ org_id: ctx.org.id, site_id: ctx.site.id, report_id: rep.id, version: (last?.version || 0) + 1, storage_path: path, sha256: out.hash, evidence_ids: out.evidenceIds,
    model_versions: { engine: ENGINE, app: APP_VERSION, resultado: out.overall?.code || null } }));
  return path;
}

/* Botón + cuadro de diálogo para generar, descargar y registrar el informe */
export function reportButton({ session, claim }) {
  return h('button', { type: 'button', class: 'primary', onclick: () => {
    const bar = h('div', { class: 'progress' }, h('span')), msg = h('p', { class: 'muted' }, 'Listo para generar. Tarda entre unos segundos y un par de minutos según el número de fotos.');
    const heat = h('input', { type: 'checkbox', checked: true }), go = h('button', { type: 'button', class: 'primary' }, 'Generar informe PDF'), res = h('div');
    const canStore = can(...REVIEW);
    const body = h('div', null,
      h('p', { class: 'muted' }, claim ? 'Informe de demostración: cruza las fotos de ingreso, salida y reclamación con el análisis de visión digital, la cadena de custodia y las firmas.' : 'Informe de comparación entre ingreso y salida con análisis de visión digital y cadena de custodia.'),
      h('label', { class: 'ctl inline' }, heat, ' Incluir mapas de calor de los cambios'),
      h('p', { class: 'muted' }, canStore ? 'Al terminar se guardará una copia con su huella SHA-256 en el expediente.' : 'Tu rol puede descargar el informe, pero no guardarlo en el expediente.'),
      h('div', { class: 'row' }, go), bar, msg, res);
    const m = openModal('Informe PDF · ' + session.plate, body);
    go.addEventListener('click', async () => {
      go.disabled = true; res.replaceChildren();
      try {
        const out = await generateReport({ session, claim, options: { heat: heat.checked }, onProgress: (p, t) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; msg.textContent = t; } });
        let saved = '';
        if (canStore) { try { await store({ session, claim, out }); saved = 'Guardado en el expediente.'; } catch (e) { saved = 'No se pudo guardar en el expediente: ' + e.message; } }
        bar.firstChild.style.width = '100%'; msg.textContent = `Informe listo · ${out.pages} páginas · ${Math.round(out.blob.size / 1024)} KB. ${saved}`;
        const url = URL.createObjectURL(out.blob);
        res.replaceChildren(h('div', { class: 'row' }, h('a', { class: 'btn primary-link', href: url, download: out.name }, 'Descargar PDF'), h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Abrir en otra pestaña')),
          h('p', { class: 'muted mono' }, 'SHA-256 del informe: ' + out.hash));
      } catch (e) { msg.textContent = ''; res.replaceChildren(h('p', { class: 'msg error' }, 'No se pudo generar el informe: ' + e.message)); toast(e.message, 'error'); }
      finally { go.disabled = false; go.textContent = 'Generar de nuevo'; }
    });
  } }, 'Generar informe PDF');
}

/* Informes ya guardados del expediente o de la sesión */
export async function savedReports({ session, claim }) {
  let q = supabase.from('reports').select('id,created_at,report_versions(version,storage_path,sha256,created_at,model_versions)').eq('session_id', session.id);
  q = claim ? q.eq('claim_id', claim.id) : q.is('claim_id', null);
  const reps = await db(q);
  return reps.flatMap((r) => r.report_versions).sort((a, b) => b.version - a.version);
}
