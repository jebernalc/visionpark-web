import { supabase, ctx, h, db, can, toast, badge, empty, field, select, openModal, fmtDate, STATES, OPERATIVE, REVIEW } from './lib.js';
import { loadBitmap, analyzePair, claimVerdict, autoLevels } from './cv.js';

export const SRC_NAME = { ingreso: 'Ingreso', salida: 'Salida', reclamacion: 'Reclamación' };
const SEV = { leve: '', moderado: 'warn', mayor: 'bad' };

/* Filtros SVG compartidos (nitidez, bordes, gamma y niveles) que se combinan con los filtros CSS */
function ensureFx() {
  if (document.getElementById('vp-fx-svg')) return;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('id', 'vp-fx-svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute'; svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><filter id="vp-fx" color-interpolation-filters="sRGB"><feConvolveMatrix id="vp-conv" order="3" kernelMatrix="0 0 0 0 1 0 0 0 0" preserveAlpha="true"/>' +
    '<feComponentTransfer id="vp-lv"><feFuncR type="linear" slope="1" intercept="0"/><feFuncG type="linear" slope="1" intercept="0"/><feFuncB type="linear" slope="1" intercept="0"/></feComponentTransfer>' +
    '<feComponentTransfer id="vp-gm"><feFuncR type="gamma" amplitude="1" exponent="1" offset="0"/><feFuncG type="gamma" amplitude="1" exponent="1" offset="0"/><feFuncB type="gamma" amplitude="1" exponent="1" offset="0"/></feComponentTransfer></filter></defs>';
  document.body.append(svg);
}
const setAll = (id, attr, val) => document.querySelectorAll('#' + id + ' > *').forEach((n) => n.setAttribute(attr, val));

/* Visor de una vista: ingreso, salida y (si existe) reclamación */
export function openViewer({ session, view, recs, urlOf, parts, damages, prompts, claim, onSaved }) {
  ensureFx();
  const keys = ['ingreso', 'salida'].filter((k) => recs[k]).concat(recs.reclamacion?.length ? ['reclamacion'] : []);
  const pick = { reclamacion: recs.reclamacion?.[0] || null };
  const recOf = (k) => (k === 'reclamacion' ? pick.reclamacion : recs[k]);
  const S = { mode: 'side', left: keys[0] || 'ingreso', right: keys[1] || keys[0] || 'salida', zoom: 1, bright: 100, contrast: 100, gamma: 1, sat: 100, sharp: 0,
    gray: false, invert: false, edges: false, levels: false, region: null, wipe: 50, marking: false, heat: true, heatOpacity: 0.85, analysis: null, verdict: null };
  if (claim && recs.reclamacion?.length) { S.left = recs.ingreso ? 'ingreso' : keys[0]; S.right = 'reclamacion'; }
  const stage = h('div', { class: 'stage' });
  const regionEls = [];
  let heatCanvases = [];

  const filt = () => `url(#vp-fx) brightness(${S.bright}%) contrast(${S.contrast}%) saturate(${S.sat}%)${S.gray ? ' grayscale(1)' : ''}${S.invert ? ' invert(1)' : ''}${S.edges ? ' brightness(2.4)' : ''}`;
  const applyFx = () => {
    const k = S.sharp;
    document.getElementById('vp-conv')?.setAttribute('kernelMatrix', S.edges ? '-1 -1 -1 -1 8 -1 -1 -1 -1' : `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`);
    setAll('vp-gm', 'exponent', String(S.gamma));
    stage.querySelectorAll('.zoomwrap > img, .zoomwrap > canvas.base').forEach((el) => { el.style.filter = filt(); });
  };
  const applyLevels = async () => {
    let slope = 1, icpt = 0;
    if (S.levels) {
      const p = recOf(S.left)?.evidence_files?.storage_path;
      if (p) { try { const { lo, hi } = autoLevels(await loadBitmap(p)); slope = 255 / (hi - lo); icpt = -lo / (hi - lo); } catch { /* sin ajuste */ } }
    }
    setAll('vp-lv', 'slope', String(slope)); setAll('vp-lv', 'intercept', String(icpt)); applyFx();
  };
  const applyZoom = () => stage.querySelectorAll('.zoomwrap').forEach((w) => { w.style.transform = `scale(${S.zoom})`; });
  const paintRegion = () => regionEls.forEach((el) => { const r = S.region; el.hidden = !r; if (r) Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); });
  const regionInfo = h('span', { class: 'muted' });
  const updRegionInfo = () => { regionInfo.textContent = S.region ? `Zona: ${Math.round(S.region.x * 100)}%, ${Math.round(S.region.y * 100)}% · ${Math.round(S.region.w * 100)}×${Math.round(S.region.h * 100)}%` : 'Sin zona marcada (el análisis será de toda la imagen).'; };

  const attachMark = (wrap) => {
    let start = null; const box = h('div', { class: 'region', hidden: true }); wrap.append(box); regionEls.push(box);
    const rel = (e) => { const r = wrap.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    wrap.addEventListener('pointerdown', (e) => { if (!S.marking) return; start = rel(e); wrap.setPointerCapture(e.pointerId); });
    wrap.addEventListener('pointermove', (e) => {
      if (start) { const p = rel(e); S.region = { x: Math.min(start[0], p[0]), y: Math.min(start[1], p[1]), w: Math.abs(p[0] - start[0]), h: Math.abs(p[1] - start[1]) }; paintRegion(); }
      else if (!S.marking && S.zoom > 1) { const r = wrap.getBoundingClientRect(); wrap.style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`; }
    });
    wrap.addEventListener('pointerup', () => { if (start) { start = null; if (S.region && (S.region.w < 0.01 || S.region.h < 0.01)) S.region = null; paintRegion(); updRegionInfo(); } });
  };

  const mkPane = (key, label = SRC_NAME[key]) => {
    const rec = recOf(key), wrap = h('div', { class: 'zoomwrap' }), pane = h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, label), wrap);
    if (rec) {
      const img = h('img', { src: urlOf(rec.evidence_files.storage_path), alt: label, draggable: false });
      img.addEventListener('load', () => { pane.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight; });
      wrap.append(img);
    } else wrap.append(h('div', { class: 'ph small' }, 'Sin foto de ' + label.toLowerCase()));
    return { pane, wrap };
  };
  const addHeat = (wrap) => {
    if (!S.analysis || !S.heat) return;
    const cv = h('canvas', { class: 'heat', width: S.analysis.W, height: S.analysis.H }); cv.getContext('2d').drawImage(S.analysis.heat, 0, 0);
    cv.style.opacity = S.heatOpacity; wrap.append(cv); heatCanvases.push(cv);
  };

  const build = async () => {
    stage.replaceChildren(); regionEls.length = 0; heatCanvases = [];
    stage.className = 'stage ' + S.mode + (S.marking ? ' marking' : '');
    const L = mkPane(S.left), R = mkPane(S.right);
    if (S.mode === 'side') { stage.append(L.pane, R.pane); attachMark(L.wrap); attachMark(R.wrap); addHeat(R.wrap); }
    else if (S.mode === 'three') {
      const others = keys.filter((k) => k !== S.left && k !== S.right); const T = others[0] ? mkPane(others[0]) : null;
      stage.append(L.pane, R.pane, ...(T ? [T.pane] : [])); [L, R, T].filter(Boolean).forEach((p) => attachMark(p.wrap)); addHeat(R.wrap);
    } else if (S.mode === 'wipe') {
      const wrap = h('div', { class: 'zoomwrap' }), pane = h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, `${SRC_NAME[S.left]} ◂ ▸ ${SRC_NAME[S.right]}`), wrap);
      const rl = recOf(S.left), rr = recOf(S.right);
      const first = h('img', { src: rl ? urlOf(rl.evidence_files.storage_path) : '', alt: SRC_NAME[S.left], draggable: false });
      first.addEventListener('load', () => { pane.style.aspectRatio = first.naturalWidth + ' / ' + first.naturalHeight; });
      const top = h('img', { class: 'top', src: rr ? urlOf(rr.evidence_files.storage_path) : '', alt: SRC_NAME[S.right], draggable: false });
      top.style.clipPath = `inset(0 0 0 ${S.wipe}%)`; wrap.append(first, top); attachMark(wrap); addHeat(wrap);
      const slider = h('input', { type: 'range', min: 0, max: 100, value: S.wipe, 'aria-label': 'Posición de la cortina', class: 'wipe', oninput: (e) => { S.wipe = +e.target.value; top.style.clipPath = `inset(0 0 0 ${S.wipe}%)`; } });
      stage.append(pane, slider);
    } else {
      const cv = h('canvas', { width: 800, height: 600, class: 'diff' }); const wrap = h('div', { class: 'zoomwrap' }, cv); attachMark(wrap);
      stage.append(h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, `Diferencia ${SRC_NAME[S.left]} / ${SRC_NAME[S.right]}`), wrap),
        h('p', { class: 'muted' }, 'La diferencia se alinea automáticamente. Es orientativa: decide siempre mirando las fotos.'));
      const rl = recOf(S.left), rr = recOf(S.right);
      if (rl && rr) {
        try {
          const [ba, bb] = await Promise.all([loadBitmap(rl.evidence_files.storage_path), loadBitmap(rr.evidence_files.storage_path)]);
          const an = await analyzePair(ba, bb), sc = 800 / an.W, g = cv.getContext('2d');
          g.drawImage(ba, 0, 0, 800, 600); g.globalCompositeOperation = 'difference'; g.drawImage(bb, -an.shift.dx * sc, -an.shift.dy * sc, 800, 600); g.globalCompositeOperation = 'source-over';
          cv.style.filter = 'brightness(4) contrast(1.4)';
        } catch (e) { toast('No se pudo calcular la diferencia: ' + e.message, 'error'); }
      } else stage.append(empty('La diferencia necesita las dos fotos.'));
    }
    applyZoom(); applyFx(); paintRegion();
  };

  /* --- Barra de herramientas --- */
  const seg = (items, cur, on, label) => { const el = h('div', { class: 'seg', role: 'group', 'aria-label': label }, items.map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === cur), onclick: (e) => { el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); on(v); } }, l))); return el; };
  const modeItems = [['side', 'Lado a lado'], ...(keys.length > 2 ? [['three', 'Las tres']] : []), ['wipe', 'Cortina'], ['diff', 'Diferencia']];
  const modes = seg(modeItems, S.mode, (m) => { S.mode = m; build(); }, 'Modo de comparación');
  const nameOpts = keys.map((k) => [k, SRC_NAME[k]]);
  const selL = select(nameOpts, S.left, { 'aria-label': 'Foto de referencia', onchange: (e) => { S.left = e.target.value; S.analysis = null; renderAnalysis(); build(); } });
  const selR = select(nameOpts, S.right, { 'aria-label': 'Foto a comparar', onchange: (e) => { S.right = e.target.value; S.analysis = null; renderAnalysis(); build(); } });
  const claimPick = (recs.reclamacion?.length || 0) > 1 ? select(recs.reclamacion.map((r, i) => [String(i), `Foto de la reclamación ${i + 1}`]), '0', { 'aria-label': 'Foto de la reclamación', onchange: (e) => { pick.reclamacion = recs.reclamacion[+e.target.value]; S.analysis = null; renderAnalysis(); build(); } }) : null;

  const sliders = [];
  const ctl = (label, min, max, key, fmt, step = 1) => {
    const out = h('output', null, fmt(S[key])), inp = h('input', { type: 'range', min, max, step, value: S[key], 'aria-label': label, oninput: (e) => { S[key] = +e.target.value; out.textContent = fmt(S[key]); key === 'zoom' ? applyZoom() : applyFx(); } });
    sliders.push({ key, inp, out, fmt }); return h('label', { class: 'ctl' }, h('span', null, label), inp, out);
  };
  const toggles = {};
  const tog = (key, label) => { const b = h('button', { type: 'button', 'aria-pressed': String(S[key]), onclick: async () => { S[key] = !S[key]; b.setAttribute('aria-pressed', String(S[key])); key === 'levels' ? await applyLevels() : applyFx(); } }, label); toggles[key] = b; return b; };
  const syncTools = () => { sliders.forEach((s) => { s.inp.value = S[s.key]; s.out.textContent = s.fmt(S[s.key]); }); Object.entries(toggles).forEach(([k, b]) => b.setAttribute('aria-pressed', String(S[k]))); };
  const preset = (name, set) => h('button', { type: 'button', onclick: async () => { Object.assign(S, { zoom: 1, bright: 100, contrast: 100, gamma: 1, sat: 100, sharp: 0, gray: false, invert: false, edges: false, levels: false }, set); syncTools(); applyZoom(); await applyLevels(); } }, name);
  const tools = h('div', { class: 'toolbox' },
    h('div', { class: 'toolhead' }, h('strong', null, 'Herramientas de imagen'), h('span', { class: 'muted' }, 'Solo cambian lo que ves; el original no se toca.')),
    h('div', { class: 'row tight' }, preset('Restablecer', {}), preset('Reducir reflejos', { bright: 70, contrast: 125, gamma: 1.3 }), preset('Aclarar sombras', { bright: 125, gamma: 0.6, contrast: 110 }),
      preset('Realzar rayones', { sharp: 1.5, contrast: 150, gray: true }), preset('Bordes', { edges: true, gray: true })),
    h('div', { class: 'tools' }, ctl('Zoom', 1, 6, 'zoom', (v) => v + '×', 0.25), ctl('Brillo', 20, 250, 'bright', (v) => v + '%'), ctl('Contraste', 40, 300, 'contrast', (v) => v + '%'),
      ctl('Gamma', 0.4, 2.5, 'gamma', (v) => v.toFixed(1), 0.1), ctl('Saturación', 0, 250, 'sat', (v) => v + '%'), ctl('Nitidez', 0, 3, 'sharp', (v) => v.toFixed(1), 0.1)),
    h('div', { class: 'row tight' }, tog('levels', 'Niveles automáticos'), tog('gray', 'Blanco y negro'), tog('invert', 'Invertir'), tog('edges', 'Detectar bordes')));

  const markBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { S.marking = !S.marking; markBtn.setAttribute('aria-pressed', String(S.marking)); stage.classList.toggle('marking', S.marking); if (S.marking && S.zoom !== 1) { S.zoom = 1; syncTools(); applyZoom(); } } }, '▭ Marcar zona');
  const clearBtn = h('button', { type: 'button', onclick: () => { S.region = null; paintRegion(); updRegionInfo(); } }, 'Quitar marca');

  /* --- Visión digital --- */
  const anaBox = h('div', { class: 'card' });
  const renderAnalysis = () => {
    const a = S.analysis, v = S.verdict; const kids = [h('h3', null, 'Visión digital')];
    const run = h('button', { type: 'button', class: 'primary', onclick: async () => {
      const rl = recOf(S.left), rr = recOf(S.right);
      if (!rl || !rr || S.left === S.right) return toast('Elige dos fotos distintas con imagen.', 'error');
      run.disabled = true; run.textContent = 'Analizando…';
      try {
        const [ba, bb] = await Promise.all([loadBitmap(rl.evidence_files.storage_path), loadBitmap(rr.evidence_files.storage_path)]);
        S.analysis = await analyzePair(ba, bb); S.verdict = null; await build(); renderAnalysis();
      } catch (e) { toast(e.message, 'error'); run.disabled = false; run.textContent = 'Analizar con visión digital'; }
    } }, a ? 'Repetir análisis' : 'Analizar con visión digital');
    kids.push(h('p', { class: 'muted' }, `Alinea las fotos, compensa la luz y marca lo que cambió entre ${SRC_NAME[S.left].toLowerCase()} y ${SRC_NAME[S.right].toLowerCase()}. Es un indicador: una persona decide.`), h('div', { class: 'row tight' }, run));
    if (a) {
      kids.push(h('div', { class: 'metrics' },
        h('div', null, h('strong', null, Math.round(a.ssim * 100) + '%'), h('span', null, 'Similitud')),
        h('div', null, h('strong', null, a.changedPct + '%'), h('span', null, 'Área con cambios')),
        h('div', null, h('strong', null, a.regions.length), h('span', null, 'Zonas')),
        h('div', null, h('strong', null, `${a.shift.dx},${a.shift.dy}`), h('span', null, 'Ajuste (px)'))),
        h('div', null, badge('Confianza ' + a.confidence, a.confidence === 'alta' ? 'ok' : a.confidence === 'abstencion' ? 'bad' : 'warn'), ' ',
          h('label', { class: 'ctl inline' }, h('input', { type: 'checkbox', checked: S.heat, onchange: (e) => { S.heat = e.target.checked; build(); } }), ' Mapa de calor'),
          h('label', { class: 'ctl' }, h('span', null, 'Opacidad'), h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: S.heatOpacity, 'aria-label': 'Opacidad del mapa', oninput: (e) => { S.heatOpacity = +e.target.value; heatCanvases.forEach((c) => { c.style.opacity = S.heatOpacity; }); } }))),
        ...a.notes.map((n) => h('p', { class: 'muted' }, '⚠ ' + n)),
        a.confidence === 'abstencion' ? h('p', { class: 'msg error' }, 'El motor se abstiene: las fotos no son comparables. Repite la toma desde el mismo punto.') : null,
        a.regions.length ? h('div', { class: 'list' }, a.regions.map((r, i) => h('div', { class: 'row-card compact' },
          h('div', null, h('strong', null, 'Zona ' + (i + 1)), ' ', badge(r.severity, SEV[r.severity]), h('div', { class: 'muted' }, `${r.areaPct}% del área · intensidad ${r.intensity}`)),
          h('button', { type: 'button', onclick: () => { S.region = { x: r.x, y: r.y, w: r.w, h: r.h }; paintRegion(); updRegionInfo(); } }, 'Usar como zona')))) : (a.confidence !== 'abstencion' ? h('p', { class: 'msg good' }, 'No se detectaron cambios relevantes entre estas dos fotos.') : null),
        can(...REVIEW) ? h('div', { class: 'row tight' }, h('button', { type: 'button', onclick: async () => {
          try {
            await db(supabase.from('ai_comparisons').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, evidence_in: recOf(S.left).evidence_id, evidence_out: recOf(S.right).evidence_id,
              result: { engine: 'vision-local-1', vista: view.code, referencia: S.left, comparada: S.right, similitud: a.ssim, area_cambio_pct: a.changedPct, ajuste: a.shift, confianza: a.confidence, umbral: a.threshold, zonas: a.regions, notas: a.notes } }));
            toast('Análisis guardado en el expediente.');
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Guardar análisis')) : null);
    }
    if (recs.ingreso && recs.salida && recs.reclamacion?.length) {
      const vb = h('button', { type: 'button', onclick: async () => {
        vb.disabled = true; vb.textContent = 'Cruzando fotos…';
        try {
          const [bi, bs, bc] = await Promise.all([loadBitmap(recs.ingreso.evidence_files.storage_path), loadBitmap(recs.salida.evidence_files.storage_path), loadBitmap(pick.reclamacion.evidence_files.storage_path)]);
          const stay = await analyzePair(bi, bs), cl = await analyzePair(bi, bc); S.verdict = claimVerdict(stay, cl); renderAnalysis();
        } catch (e) { toast(e.message, 'error'); vb.disabled = false; vb.textContent = 'Cruzar ingreso, salida y reclamación'; }
      } }, 'Cruzar ingreso, salida y reclamación');
      kids.push(h('div', { class: 'row tight' }, vb));
      if (v) kids.push(h('div', { class: 'verdict ' + v.code }, h('strong', null, v.label), h('p', null, v.reason), h('span', { class: 'muted' }, 'Confianza ' + v.confidence + ' · resultado orientativo, sujeto a revisión humana')));
    }
    anaBox.replaceChildren(...kids.filter(Boolean));
  };

  /* --- Preguntas al motor y hallazgos --- */
  const side = h('div', { class: 'side' });
  const history = h('div', { class: 'list' });
  const evIds = keys.flatMap((k) => (k === 'reclamacion' ? recs.reclamacion.map((r) => r.evidence_id) : [recs[k].evidence_id]));
  const evLabel = (id) => (id === recs.ingreso?.evidence_id ? 'Ingreso' : id === recs.salida?.evidence_id ? 'Salida' : 'Reclamación');
  const loadQ = async () => {
    if (!evIds.length) return history.replaceChildren(empty('Sin consultas.'));
    const qs = await db(supabase.from('ai_queries').select('id,prompt,answer,proposed_state,confidence_label,decision,created_at,user_id,evidence_id').in('evidence_id', evIds).order('created_at', { ascending: false }).limit(20));
    history.replaceChildren(...(qs.length ? qs.map((q) => h('div', { class: 'qcard' },
      h('div', { class: 'muted' }, fmtDate(q.created_at) + ' · ' + evLabel(q.evidence_id)), h('p', null, q.prompt),
      q.answer ? h('div', { class: 'answer' }, h('strong', null, 'Respuesta del motor'), h('p', null, q.answer), q.proposed_state ? badge('Estado propuesto ' + q.proposed_state, 'ai') : null, ' ', q.confidence_label ? badge('Confianza ' + q.confidence_label) : null)
        : badge('En cola: el servidor de IA responderá cuando esté conectado', 'warn'),
      q.answer && !q.decision && q.user_id === ctx.user.id ? h('div', { class: 'row tight' }, ['aceptada', 'corregida', 'rechazada'].map((d) => h('button', { type: 'button', onclick: async () => { try { await db(supabase.from('ai_queries').update({ decision: d, decided_at: new Date().toISOString() }).eq('id', q.id)); loadQ(); } catch (e) { toast(e.message, 'error'); } } }, d[0].toUpperCase() + d.slice(1)))) : (q.decision ? badge('Decisión: ' + q.decision, 'ok') : null))) : [empty('Aún no hay consultas para esta vista.')]));
  };
  side.append(anaBox);
  if (can(...OPERATIVE)) {
    const lib = select([['', 'Prompt de la biblioteca…'], ...prompts.map((p) => [p.id, p.title])], '');
    const txt = h('textarea', { rows: 4, maxLength: 4000, placeholder: 'Ej.: ¿Hay rayones nuevos en la zona marcada que no estaban al ingreso?' });
    lib.addEventListener('change', () => { const p = prompts.find((x) => x.id === lib.value); if (p) txt.value = p.template.replaceAll('{vista}', view.name); });
    const tgt = select(keys.map((k) => [k, 'Aplicar a la foto de ' + SRC_NAME[k].toLowerCase()]), S.right);
    const ask = h('button', { type: 'button', class: 'primary', onclick: async () => {
      const rec = recOf(tgt.value), p = txt.value.trim(); if (!rec) return toast('Esa fase no tiene foto para esta vista.', 'error'); if (!p) return toast('Escribe la pregunta.', 'error');
      ask.disabled = true;
      try { await db(supabase.from('ai_queries').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, evidence_id: rec.evidence_id, user_id: ctx.user.id, scope: S.region ? 'caja' : 'imagen', prompt: p, region: S.region })); txt.value = ''; toast('Consulta enviada al motor.'); loadQ(); }
      catch (e) { toast(e.message, 'error'); } finally { ask.disabled = false; }
    } }, 'Consultar al motor');
    side.append(h('div', { class: 'card' }, h('h3', null, 'Pregunta sobre esta imagen'), lib, tgt, txt, h('div', { class: 'row tight' }, ask)));
  }
  if (can(...REVIEW)) {
    const part = select([['', 'Pieza…'], ...parts.map((p) => [p.code, p.name])], ''), dmg = select([['', 'Tipo de daño…'], ...damages.map((d) => [d.code, d.name])], ''), st = select(STATES.map((s) => [s, s]), 'E1');
    const save = h('button', { type: 'button', onclick: async () => {
      if (!part.value || !dmg.value) return toast('Elige la pieza y el tipo de daño.', 'error'); save.disabled = true;
      try {
        const r = S.region, poly = r ? [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] : null;
        const f = await db(supabase.from('findings').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, part_code: part.value, damage_code: dmg.value, polygon: poly, state: st.value, validation: 'HUMAN_REVIEWED', created_by: ctx.user.id }).select('id').single());
        const fe = [recs.ingreso && { evidence_id: recs.ingreso.evidence_id, role: 'ingreso' }, recs.salida && { evidence_id: recs.salida.evidence_id, role: 'salida' }, pick.reclamacion && { evidence_id: pick.reclamacion.evidence_id, role: 'reclamacion' }].filter(Boolean).map((x) => ({ ...x, finding_id: f.id, org_id: ctx.org.id, site_id: ctx.site.id, region: r }));
        if (fe.length) await db(supabase.from('finding_evidence').insert(fe));
        await db(supabase.from('finding_reviews').insert({ org_id: ctx.org.id, site_id: ctx.site.id, finding_id: f.id, reviewer_id: ctx.user.id, decision: 'aceptar', note: 'Hallazgo registrado por una persona en la mesa de comparación (' + view.code + ').' }));
        toast('Hallazgo registrado. Pasa a revisión en «Hallazgos».'); onSaved?.();
      } catch (e) { toast(e.message, 'error'); } finally { save.disabled = false; }
    } }, 'Registrar hallazgo');
    side.append(h('div', { class: 'card' }, h('h3', null, 'Registrar hallazgo'), h('p', { class: 'muted' }, 'Usa la zona marcada y guarda las fotos como evidencia.'), part, dmg, h('label', { class: 'fld' }, h('span', null, 'Estado de evidencia'), st), h('div', { class: 'row tight' }, save)));
  }
  side.append(h('div', { class: 'card' }, h('h3', null, 'Consultas de esta vista'), history));

  const info = keys.map((k) => { const r = recOf(k); return r?.evidence_files ? h('p', { class: 'muted mono' }, `${SRC_NAME[k]} · SHA-256 ${r.evidence_files.sha256_client.slice(0, 16)}… · ${fmtDate(r.evidence_files.captured_at)}`) : null; });
  const body = h('div', { class: 'viewer' }, h('div', { class: 'vmain' },
    h('div', { class: 'toolbar' }, modes, h('span', { class: 'muted' }, 'Comparar'), selL, h('span', { class: 'muted' }, 'con'), selR, claimPick),
    tools, h('div', { class: 'toolbar' }, markBtn, clearBtn, regionInfo), stage, ...info), side);
  openModal(view.code + ' · ' + view.name, body, { wide: true });
  updRegionInfo(); renderAnalysis(); build(); loadQ();
}
