import { supabase, db, h, toast, sha256Hex, badge, select } from '../lib.js';
import { reconstruct, detect, condition, highlight, describe, KIND } from '../inspect.js';
import { diagnose } from '../enhance.js';
import { robustCompare, checklist, CLASSES, SEARCHABLE } from '../novelties.js';
import { labReport } from '../labreport.js';

const MAXP = 8, ROLE = { '': 'Sin definir', ingreso: 'Ingreso', salida: 'Salida', reclamacion: 'Reclamación' };
const COND_KIND = { sin_novedades: 'ok', leves: 'warn', moderadas: 'warn', marcadas: 'bad', no_evaluable: '' };
const FALLBACK_VIEWS = ['Frontal', 'Esquina delantera izquierda', 'Lateral izquierdo', 'Esquina trasera izquierda', 'Posterior', 'Esquina trasera derecha', 'Lateral derecho', 'Esquina delantera derecha', 'Rin delantero derecho', 'Rin trasero derecho', 'Rin trasero izquierdo', 'Rin delantero izquierdo', 'Detalle esquina delantera izquierda', 'Detalle esquina delantera derecha', 'Detalle esquina trasera derecha', 'Detalle esquina trasera izquierda', 'Parabrisas', 'Luneta posterior', 'Techo', 'Espejo izquierdo', 'Espejo derecho', 'Placa frontal', 'Placa posterior', 'Tablero y odómetro'];

function download(canvas, name, type = 'image/png') { canvas.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, type, 0.92); }
function figure(label, canvas, fname) {
  const cv = h('canvas', { width: canvas.width, height: canvas.height, role: 'img', 'aria-label': label }); cv.getContext('2d').drawImage(canvas, 0, 0);
  return h('figure', { class: 'labfig' }, h('figcaption', null, label, ' ', h('small', { class: 'muted' }, `${canvas.width}×${canvas.height}`)), cv, fname ? h('button', { type: 'button', class: 'mini', onclick: () => download(canvas, fname) }, 'Descargar') : null);
}
function drawBoxes(src, regions) {
  const c = document.createElement('canvas'), k = Math.min(1, 1100 / src.width); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k); const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
  g.lineWidth = Math.max(2, c.width / 450); g.font = `bold ${Math.max(13, c.width / 55)}px sans-serif`; g.textBaseline = 'top';
  regions.forEach((r, i) => { const col = (CLASSES[r.cls] || CLASSES.otro).color, pad = 4, x = r.x * c.width - pad, y = r.y * c.height - pad; g.strokeStyle = col; g.strokeRect(x, y, r.w * c.width + 2 * pad, r.h * c.height + 2 * pad); g.fillStyle = col; const fs = Math.max(13, c.width / 55); g.fillRect(x, Math.max(0, y - fs - 3), fs + 8, fs + 3); g.fillStyle = '#000'; g.fillText(String(i + 1), x + 4, Math.max(0, y - fs - 3) + 1); });
  return c;
}

export default {
  id: 'laboratorio', title: 'Laboratorio IA', roles: null,
  async render(root) {
    let viewNames = FALLBACK_VIEWS.map((n, i) => ['V' + String(i + 1).padStart(2, '0'), n]);
    try { const vs = await db(supabase.from('canonical_views').select('code,name').order('sort_order')); if (vs?.length) viewNames = vs.map((v) => [v.code, v.name]); } catch { /* sin conexión: lista base */ }
    const photos = []; let seq = 0, level = 'estandar', busy = false; const cache = new Map();
    const slots = h('div', { class: 'labslots' }), chat = h('div', { class: 'chatlog', role: 'log', 'aria-live': 'polite' }), input = h('textarea', { rows: 2, maxLength: 600, placeholder: 'Pide lo que necesitas: «mejora y resalta todas las fotos», «describe la foto 2», «determina el estado de ingreso», «compara ingreso con salida»…', 'aria-label': 'Mensaje' });
    const roleLabel = (p) => ROLE[p.role] || ''; const viewLabel = (p) => (p.view ? `${p.view} ${viewNames.find((v) => v[0] === p.view)?.[1] || ''}`.trim() : '');

    /* ---------- Cuadro de fotos ---------- */
    const addFiles = async (files) => {
      for (const f of files) {
        if (photos.length >= MAXP) { toast(`Máximo ${MAXP} fotos a la vez.`, 'warn'); break; }
        if (!f.type.startsWith('image/')) { toast(f.name + ': solo se admiten fotos.', 'error'); continue; }
        try { const bmp = await createImageBitmap(f); photos.push({ id: ++seq, n: photos.length + 1, file: f, bmp, url: URL.createObjectURL(f), role: '', view: '', hash: await sha256Hex(f) }); } catch { toast(f.name + ': no se pudo leer la imagen.', 'error'); }
      }
      photos.forEach((p, i) => { p.n = i + 1; }); drawSlots();
    };
    const drawSlots = () => {
      const total = Math.max(5, Math.min(MAXP, photos.length + 1));
      slots.replaceChildren(...Array.from({ length: total }, (_, i) => {
        const p = photos[i];
        if (!p) { const inp = h('input', { type: 'file', accept: 'image/*', class: 'sr', multiple: true, 'aria-label': 'Agregar foto ' + (i + 1), onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); } });
          return h('label', { class: 'vcell labslot empty' }, h('div', { class: 'ph' }, '＋'), h('span', { class: 'vname' }, 'Foto ' + (i + 1)), inp); }
        const rs = select(Object.entries(ROLE), p.role, { 'aria-label': 'Momento de la foto', onchange: (e) => { p.role = e.target.value; } }), vs = select([['', 'Vista (opcional)'], ...viewNames.map(([c, n]) => [c, `${c} · ${n}`])], p.view, { 'aria-label': 'Vista', onchange: (e) => { p.view = e.target.value; } });
        return h('div', { class: 'vcell labslot done' }, h('img', { src: p.url, alt: 'Foto ' + p.n }), h('span', { class: 'vname' }, 'Foto ' + p.n), rs, vs, h('small', { class: 'muted mono' }, 'SHA-256 ' + p.hash.slice(0, 12) + '…'),
          h('button', { type: 'button', class: 'mini', onclick: () => { URL.revokeObjectURL(p.url); cache.delete(p.id); photos.splice(photos.indexOf(p), 1); photos.forEach((q, k) => { q.n = k + 1; }); drawSlots(); } }, 'Quitar'));
      }));
    };
    const multi = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); } });
    const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); } });
    const drop = h('label', { class: 'dropzone', tabindex: 0, ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); } },
      h('strong', null, 'Arrastra aquí hasta ' + MAXP + ' fotos'), h('span', { class: 'muted' }, 'o toca para elegirlas de tu galería'), multi);
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); multi.click(); } });
    const lvl = select([['suave', 'Reconstrucción suave'], ['estandar', 'Reconstrucción estándar'], ['forense', 'Reconstrucción forense (×2)']], level, { 'aria-label': 'Nivel de reconstrucción', onchange: (e) => { level = e.target.value; cache.clear(); } });

    /* ---------- Motor: análisis de una foto ---------- */
    const analyze = async (p) => {
      const key = p.id + '|' + level; if (cache.has(key)) return cache.get(key);
      const rec = await reconstruct(p.bmp, level), det = detect(rec.canvas), q = rec.quality, cond = condition(q, det), hl = highlight(rec.canvas, det), text = describe({ n: p.n, roleLabel: roleLabel(p), viewLabel: viewLabel(p) }, q, det, cond, rec);
      const res = { p, rec, det, q, cond, hl, text }; cache.set(key, res); return res;
    };

    /* ---------- Chat ---------- */
    const say = (who, ...kids) => { const m = h('div', { class: 'msg-' + who }, who === 'bot' ? h('div', { class: 'who' }, 'Asistente de visión (motor local)') : null, ...kids); chat.append(m); chat.scrollTop = chat.scrollHeight; return m; };
    const pick = (text) => {
      const nums = [...text.matchAll(/foto(?:s)?\s*((?:\d+\s*(?:,|y|e|a)?\s*)+)/gi)].flatMap((m) => [...m[1].matchAll(/\d+/g)].map((x) => +x[0]));
      return nums.length ? photos.filter((p) => nums.includes(p.n)) : [];
    };
    const resultBlock = (r) => {
      const real = r.det.regions;
      return h('div', { class: 'labres' },
        h('div', { class: 'row tight' }, h('strong', null, `Foto ${r.p.n}`), r.p.role ? badge(roleLabel(r.p)) : null, r.p.view ? badge(viewLabel(r.p)) : null, badge(r.cond.label, COND_KIND[r.cond.code]), badge('Calidad ' + r.q.grade, r.q.grade === 'buena' ? 'ok' : r.q.grade === 'media' ? 'warn' : 'bad')),
        h('div', { class: 'labgrid' }, figure('Original', (() => { const c = document.createElement('canvas'); c.width = r.p.bmp.width; c.height = r.p.bmp.height; c.getContext('2d').drawImage(r.p.bmp, 0, 0); return c; })(), null), figure('Reconstruida', r.rec.canvas, `foto${r.p.n}_reconstruida.png`), figure('Zonas resaltadas', r.hl.canvas, `foto${r.p.n}_resaltada.png`)),
        real.length ? h('div', { class: 'legend' }, [...new Set(real.map((x) => x.kind))].map((k) => h('span', null, h('i', { style: `background:rgb(${KIND[k].color.join(',')})` }), KIND[k].label))) : null,
        h('ul', { class: 'labtext' }, r.text.map((l) => h('li', null, l))));
    };
    const worst = (list) => { const order = ['no_evaluable', 'sin_novedades', 'leves', 'moderadas', 'marcadas']; return list.reduce((a, b) => (order.indexOf(b.cond.code) > order.indexOf(a.cond.code) ? b : a)); };

    const runInspect = async (targets, { show = true } = {}) => {
      const out = []; for (const p of targets) { const m = say('bot', h('p', { class: 'muted' }, `Reconstruyendo y analizando la foto ${p.n}…`)); const r = await analyze(p); out.push(r); m.replaceChildren(h('div', { class: 'who' }, 'Asistente de visión (motor local)'), show ? resultBlock(r) : h('p', null, `Foto ${p.n}: ${r.cond.label}.`)); chat.scrollTop = chat.scrollHeight; await new Promise((x) => setTimeout(x)); }
      return out;
    };
    const stateOf = async (phase, targets) => {
      const t = targets.length ? targets : photos.filter((p) => p.role === phase);
      if (!t.length) return say('bot', h('p', null, `No hay fotos marcadas como «${ROLE[phase]}». Elige el momento de cada foto en el cuadro de arriba (o dime «determina el estado de la foto 1»).`));
      const res = await runInspect(t); const w = worst(res), all = res.flatMap((r) => r.det.regions.filter((x) => x.kind !== 'reflejo'));
      say('bot', h('div', { class: 'verdict ' + (w.cond.code === 'sin_novedades' ? 'sin_indicios' : w.cond.code === 'no_evaluable' ? 'no_concluyente' : 'indicios') }, h('strong', null, `Estado de ${phase === 'ingreso' ? 'ingreso' : 'salida'}: ${w.cond.label}`),
        h('p', null, `${res.length} foto(s) analizada(s), ${all.length} zona(s) de interés${res.some((r) => r.cond.code === 'no_evaluable') ? '; alguna foto no es evaluable con confianza' : ''}.`),
        h('span', { class: 'muted' }, 'Es la condición aparente que se VE en las fotos. Sin una foto de referencia no se puede saber si algo ya existía: para eso compara ingreso con salida.')));
    };
    const compare = async () => {
      const pairs = []; const by = (role) => photos.filter((p) => p.role === role);
      const ing = by('ingreso'), sal = by('salida'), rec = by('reclamacion');
      for (const a of ing) { const b = sal.find((x) => x.view === a.view) || (a.view ? null : sal[0]); if (b) pairs.push([a, b, 'Ingreso', 'Salida']); const c = rec.find((x) => x.view === a.view) || (a.view ? null : rec[0]); if (c) pairs.push([a, c, 'Ingreso', 'Reclamación']); }
      if (!pairs.length && photos.length === 2) pairs.push([photos[0], photos[1], 'Foto ' + photos[0].n + ' (referencia)', 'Foto ' + photos[1].n]);
      if (!pairs.length) return say('bot', h('p', null, 'Para comparar necesito al menos una foto marcada como «Ingreso» y otra como «Salida» (o «Reclamación»), de preferencia con la misma vista. También puedes subir solo dos fotos y comparo la primera con la segunda.'));
      const blocks = [];
      for (const [a, b, la, lb] of pairs) {
        const m = say('bot', h('p', { class: 'muted' }, `Comparando foto ${a.n} (${la}) con foto ${b.n} (${lb}): análisis original + mejorado…`)); const note = m.querySelector('p');
        try {
          const r = await robustCompare(a.bmp, b.bmp, { onProgress: (t) => { note.textContent = `Foto ${a.n} vs ${b.n}: ${t}`; } });
          const regs = r.regions.filter((x) => x.status !== 'solo_original'), conf = regs.filter((x) => x.status === 'confirmada');
          const cv = document.createElement('canvas'); cv.width = b.bmp.width; cv.height = b.bmp.height; cv.getContext('2d').drawImage(b.bmp, 0, 0); const marked = drawBoxes(cv, regs);
          const ck = checklist(r, SEARCHABLE.map(([k]) => k)); const lines = [];
          if (r.confidence === 'abstencion') lines.push('El motor se abstiene: ' + (r.notes[0] || 'las fotos no son comparables.') + ' Repite la foto desde el mismo punto y ángulo.');
          else if (!regs.length) lines.push('No se detectan cambios entre las dos fotos, ni en las originales ni en las mejoradas.');
          else { lines.push(`${conf.length} zona(s) confirmada(s) en original y mejorada; ${regs.length - conf.length} solo en la mejorada.`); regs.slice(0, 6).forEach((z, i) => lines.push(`${i + 1}. ${(CLASSES[z.cls] || CLASSES.otro).label} · probabilidad ${z.likelihood} · ${z.areaPct}% del área · ${z.evidence.slice(0, 2).join('; ')}`)); }
          const title = `Foto ${a.n} (${la}) vs foto ${b.n} (${lb})`;
          blocks.push({ title, canvas: marked, lines });
          m.replaceChildren(h('div', { class: 'who' }, 'Asistente de visión (motor local)'), h('div', { class: 'labres' }, h('strong', null, title), h('div', { class: 'labgrid one' }, figure(`${lb} con las diferencias marcadas`, marked, `comparacion_${a.n}_${b.n}.png`)),
            h('div', { class: 'checklist' }, ck.map((c) => h('div', { class: 'ck ' + c.state }, h('span', null, c.label), badge({ detectada: 'Detectada', posible: 'Posible (revisar)', no_detectada: 'No se detecta', no_concluyente: 'No concluyente' }[c.state], { detectada: 'bad', posible: 'warn', no_detectada: 'ok', no_concluyente: 'warn' }[c.state])))), h('ul', { class: 'labtext' }, lines.map((l) => h('li', null, l))),
            h('p', { class: 'muted small' }, 'Lo que aparece en la segunda foto y no estaba en la primera es lo que cambió entre ambos momentos. Una persona debe confirmarlo.')));
        } catch (e) { m.replaceChildren(h('p', { class: 'msg error' }, e.message)); }
      }
      lastCompare = blocks;
    };
    let lastCompare = [], lastResults = [];

    const handle = async (text) => {
      if (!photos.length) return say('bot', h('p', null, 'Primero agrega al menos una foto en el cuadro de arriba (hasta ' + MAXP + '). Luego dime qué necesitas.'));
      const t = text.toLowerCase(), sel = pick(t), targets = sel.length ? sel : photos;
      const wantsCmp = /compar|diferenc|cambi|nuev|ocurri/.test(t) && !/describ/.test(t), wantsIn = /ingres/.test(t) && /estado|condici|determin|vino|lleg/.test(t), wantsOut = /salid/.test(t) && /estado|condici|determin/.test(t);
      if (wantsCmp) return compare();
      if (wantsIn) return stateOf('ingreso', sel);
      if (wantsOut) return stateOf('salida', sel);
      if (/describ|detall|explic|que ves|qué ves/.test(t)) { const res = await runInspect(targets, { show: false }); return say('bot', ...res.map((r) => h('ul', { class: 'labtext' }, r.text.map((l) => h('li', null, l))))); }
      const res = await runInspect(targets); lastResults = res;
      if (res.length > 1) { const w = worst(res); say('bot', h('p', null, h('strong', null, 'Resumen: '), `${res.length} fotos analizadas. La condición aparente más desfavorable es «${w.cond.label}» (foto ${w.p.n}). Puedes pedirme «compara ingreso con salida» o «determina el estado de ingreso».`)); }
    };
    const send = async (text) => {
      text = (text || input.value).trim(); if (!text || busy) return; input.value = ''; busy = true; sendBtn.disabled = true; say('user', text);
      try { await handle(text); } catch (e) { say('bot', h('p', { class: 'msg error' }, 'No pude completar el análisis: ' + e.message)); } finally { busy = false; sendBtn.disabled = false; }
    };
    const sendBtn = h('button', { type: 'button', class: 'primary', onclick: () => send() }, 'Enviar');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    const chip = (label, cmd) => h('button', { type: 'button', class: 'chip', onclick: () => send(cmd) }, label);
    const chips = h('div', { class: 'row tight' }, chip('Mejorar y resaltar todo', 'mejora, reconstruye y resalta todas las fotos'), chip('Describir', 'describe en detalle todas las fotos'), chip('Estado de ingreso', 'determina el estado de ingreso'), chip('Estado de salida', 'determina el estado de salida'), chip('Comparar ingreso y salida', 'compara ingreso con salida'));

    const repBtn = h('button', { type: 'button', onclick: async () => {
      const done = photos.map((p) => cache.get(p.id + '|' + level)).filter(Boolean); if (!done.length) return toast('Primero analiza al menos una foto.', 'error');
      repBtn.disabled = true; repBtn.textContent = 'Generando informe…';
      try {
        const items = done.map((r) => { const o = document.createElement('canvas'); o.width = r.p.bmp.width; o.height = r.p.bmp.height; o.getContext('2d').drawImage(r.p.bmp, 0, 0);
          return { n: r.p.n, hash: r.p.hash, roleLabel: roleLabel(r.p), viewLabel: viewLabel(r.p), original: o, rec: r.rec.canvas, hl: r.hl.canvas, cond: r.cond, text: r.text, regions: r.det.regions.map((x) => ({ label: KIND[x.kind].label, where: x.where, likelihood: x.likelihood })) }; });
        const w = worst(done), summary = [`Fotos analizadas: ${done.length}. Condicion aparente mas desfavorable: ${w.cond.label} (foto ${w.p.n}).`, ...(lastCompare.length ? [`Comparaciones realizadas: ${lastCompare.length}.`] : [])];
        const { blob, sha } = await labReport({ items, compare: lastCompare, summary }); const url = URL.createObjectURL(blob);
        say('bot', h('p', null, 'Informe generado. SHA-256: ', h('code', null, sha.slice(0, 16) + '…')), h('a', { class: 'btn primary-link', href: url, download: 'informe_laboratorio_ia.pdf' }, 'Descargar informe PDF'));
      } catch (e) { toast(e.message, 'error'); } finally { repBtn.disabled = false; repBtn.textContent = 'Generar informe PDF'; }
    } }, 'Generar informe PDF');

    root.append(h('h2', null, 'Laboratorio IA de imágenes'),
      h('p', { class: 'muted' }, 'Adjunta hasta ' + MAXP + ' fotos, pídele al asistente que las mejore, las reconstruya a partir de sus píxeles, resalte las novedades, las describa y determine la condición de ingreso o de salida. Las fotos se procesan en este navegador y no se suben; el archivo original nunca se modifica.'),
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', null, 'Cuadro de fotos'), lvl), slots, drop),
      h('div', { class: 'card chatbox' }, h('h3', null, 'Chat con el asistente de visión'), chat, chips, input, h('div', { class: 'row tight' }, sendBtn, repBtn)));
    say('bot', h('p', null, 'Hola. Adjunta tus fotos arriba y marca de cada una si es de ', h('strong', null, 'ingreso'), ', ', h('strong', null, 'salida'), ' o ', h('strong', null, 'reclamación'), ' (y su vista, si la sabes). Luego puedes pedirme, por ejemplo: «mejora y resalta todas las fotos», «describe la foto 2», «determina el estado de ingreso» o «compara ingreso con salida».'),
      h('p', { class: 'muted small' }, 'Soy el motor de visión local de VISIONPARK: reconstruyo los píxeles y marco zonas con reglas medibles. No soy un modelo de lenguaje; cuando se conecte el servidor de IA con GPU, este mismo chat podrá usarlo. Mis resultados son orientativos y los confirma una persona.'));
    drawSlots();
  }
};
