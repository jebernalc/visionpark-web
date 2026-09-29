import { supabase, ctx, h, db, can, toast, signedUrls, badge, empty, field, select, openModal, fmtDate, STATES, OPERATIVE, REVIEW } from '../lib.js';

export default {
  id: 'mesa', title: 'Mesa de comparación', roles: null,
  async render(root, param) {
    if (!param) {
      const rows = await db(supabase.from('parking_sessions').select('id,plate,status,entered_at').eq('site_id', ctx.site.id).order('entered_at', { ascending: false }).limit(40));
      root.append(h('h2', null, 'Mesa de comparación'), h('p', { class: 'muted' }, 'Elige la sesión que quieres comparar (ingreso frente a salida).'),
        h('div', { class: 'list' }, rows.length ? rows.map((s) => h('a', { class: 'row-card', href: '#/mesa/' + s.id }, h('div', null, h('strong', { class: 'plate' }, s.plate), h('div', { class: 'muted' }, fmtDate(s.entered_at))), badge(s.status === 'abierta' ? 'Abierta' : 'Cerrada', s.status === 'abierta' ? 'ok' : ''))) : [empty('Aún no hay sesiones.')]));
      return;
    }
    const session = await db(supabase.from('parking_sessions').select('*').eq('id', param).eq('site_id', ctx.site.id).maybeSingle());
    if (!session) { root.append(empty('Sesión no encontrada en esta sede.')); return; }
    const [views, caps, parts, damages, prompts] = await Promise.all([
      db(supabase.from('canonical_views').select('*').order('sort_order')),
      db(supabase.from('capture_views').select('phase,view_code,quality,usable,evidence_id,created_at,evidence_files(storage_path,sha256_client,captured_at)').eq('session_id', session.id).order('created_at')),
      db(supabase.from('vehicle_parts').select('code,name').order('name')),
      db(supabase.from('damage_types').select('code,name').order('name')),
      db(supabase.from('prompt_library').select('id,title,template,scope').eq('active', true).order('title'))
    ]);
    const latest = new Map(caps.map((c) => [c.phase + ':' + c.view_code, c]));
    const urlOf = await signedUrls(caps.map((c) => c.evidence_files?.storage_path));
    const thumb = (rec, label) => rec ? h('img', { src: urlOf(rec.evidence_files?.storage_path), alt: label, loading: 'lazy' }) : h('div', { class: 'ph small' }, 'Sin foto');

    root.append(
      h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/sesiones' }, '← Sesiones'), h('h2', null, 'Comparación · ', h('span', { class: 'plate' }, session.plate)),
        h('a', { class: 'btn', href: '#/captura/' + session.id, hidden: !can(...OPERATIVE) }, 'Capturar')),
      h('p', { class: 'muted' }, 'Abre cada cuadrícula para acercar, ajustar, comparar con cortina o diferencia, marcar una zona y pedirle al motor que la analice. La IA propone; una persona decide.'),
      h('div', { class: 'cgrid' }, views.map((v) => {
        const a = latest.get('ingreso:' + v.code), b = latest.get('salida:' + v.code);
        return h('button', { type: 'button', class: 'ccell', onclick: () => openViewer(v, a, b), 'aria-label': 'Revisar ' + v.name },
          h('div', { class: 'pair' }, thumb(a, 'Ingreso ' + v.name), thumb(b, 'Salida ' + v.name)),
          h('span', { class: 'vname' }, v.code + ' · ' + v.name),
          h('span', { class: 'pairtag' }, h('em', null, 'Ingreso'), h('em', null, 'Salida')));
      })));

    function openViewer(view, a, b) {
      const S = { mode: 'side', zoom: 1, bright: 100, contrast: 100, invert: false, region: null, wipe: 50, target: b ? 'salida' : 'ingreso' };
      const filt = () => `brightness(${S.bright}%) contrast(${S.contrast}%)${S.invert ? ' invert(1)' : ''}`;
      const stage = h('div', { class: 'stage' });
      let regionEls = [];
      const mkPane = (rec, label) => {
        const wrap = h('div', { class: 'zoomwrap' });
        const pane = h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, label), wrap);
        if (rec) wrap.append(h('img', { src: urlOf(rec.evidence_files.storage_path), alt: label, draggable: false }));
        else wrap.append(h('div', { class: 'ph small' }, 'Sin foto de ' + label.toLowerCase()));
        return { pane, wrap, rec };
      };
      const attachMark = (wrap) => {
        let start = null; const box = h('div', { class: 'region', hidden: true }); wrap.append(box); regionEls.push(box);
        const rel = (e) => { const r = wrap.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
        const paint = () => { const r = S.region; regionEls.forEach((el) => { el.hidden = !r; if (r) Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); }); };
        wrap.addEventListener('pointerdown', (e) => { if (!S.marking) return; start = rel(e); wrap.setPointerCapture(e.pointerId); });
        wrap.addEventListener('pointermove', (e) => {
          if (start) { const p = rel(e); S.region = { x: Math.min(start[0], p[0]), y: Math.min(start[1], p[1]), w: Math.abs(p[0] - start[0]), h: Math.abs(p[1] - start[1]) }; paintAll(); }
          else if (!S.marking && S.zoom > 1) { const r = wrap.getBoundingClientRect(); wrap.style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`; }
        });
        wrap.addEventListener('pointerup', () => { if (start) { start = null; if (S.region && (S.region.w < 0.01 || S.region.h < 0.01)) S.region = null; paintAll(); regionInfo(); } });
        wrap._paint = paint;
      };
      const paintAll = () => stage.querySelectorAll('.zoomwrap').forEach((w) => w._paint?.());
      const applyView = () => stage.querySelectorAll('.zoomwrap').forEach((w) => { w.style.transform = `scale(${S.zoom})`; w.style.filter = ''; });
      const applyFilter = () => stage.querySelectorAll('.zoomwrap img, canvas').forEach((i) => { i.style.filter = filt(); });

      const build = () => {
        stage.replaceChildren(); regionEls = [];
        stage.className = 'stage ' + S.mode + (S.marking ? ' marking' : '');
        const A = mkPane(a, 'Ingreso'), B = mkPane(b, 'Salida');
        if (S.mode === 'side') { stage.append(A.pane, B.pane); attachMark(A.wrap); attachMark(B.wrap); }
        else if (S.mode === 'wipe') {
          const pane = h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, 'Ingreso ◂ ▸ Salida'), (() => {
            const wrap = h('div', { class: 'zoomwrap' });
            if (a) wrap.append(h('img', { src: urlOf(a.evidence_files.storage_path), alt: 'Ingreso' }));
            if (b) { const top = h('img', { class: 'top', src: urlOf(b.evidence_files.storage_path), alt: 'Salida' }); top.style.clipPath = `inset(0 0 0 ${S.wipe}%)`; wrap.append(top); }
            attachMark(wrap); return wrap; })());
          const slider = h('input', { type: 'range', min: 0, max: 100, value: S.wipe, 'aria-label': 'Posición de la cortina', class: 'wipe', oninput: (e) => { S.wipe = +e.target.value; const t = pane.querySelector('img.top'); if (t) t.style.clipPath = `inset(0 0 0 ${S.wipe}%)`; } });
          stage.append(pane, slider);
        } else {
          const cv = h('canvas', { width: 800, height: 600, class: 'diff' });
          const wrap = h('div', { class: 'zoomwrap' }, cv); attachMark(wrap);
          stage.append(h('div', { class: 'pane' }, h('span', { class: 'panelabel' }, 'Diferencia (amplificada)'), wrap),
            h('p', { class: 'muted' }, 'Orientativa: si la cámara cambió de posición entre ingreso y salida aparecen bordes falsos. Decide siempre comparando las fotos.'));
          if (a && b) {
            const load = (rec) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = urlOf(rec.evidence_files.storage_path); });
            Promise.all([load(a), load(b)]).then(([ia, ib]) => { const g = cv.getContext('2d'); g.drawImage(ia, 0, 0, 800, 600); g.globalCompositeOperation = 'difference'; g.drawImage(ib, 0, 0, 800, 600); g.globalCompositeOperation = 'source-over'; cv.style.filter = 'brightness(4) contrast(1.4)'; }).catch(() => toast('No se pudo calcular la diferencia.', 'error'));
          } else stage.append(empty('La diferencia necesita foto de ingreso y de salida.'));
        }
        applyView(); if (S.mode !== 'diff') applyFilter(); paintAll();
      };

      const ctl = (label, min, max, key, fmt = (v) => v + '%') => {
        const out = h('output', null, fmt(S[key]));
        return h('label', { class: 'ctl' }, h('span', null, label), h('input', { type: 'range', min, max, step: key === 'zoom' ? 0.25 : 1, value: S[key], oninput: (e) => { S[key] = +e.target.value; out.textContent = fmt(S[key]); if (key === 'zoom') applyView(); else applyFilter(); } }), out);
      };
      const modes = h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de comparación' }, [['side', 'Lado a lado'], ['wipe', 'Cortina'], ['diff', 'Diferencia']].map(([m, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(m === S.mode), onclick: (e) => { S.mode = m; modes.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget))); build(); } }, l)));
      const markBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { S.marking = !S.marking; markBtn.setAttribute('aria-pressed', String(S.marking)); stage.classList.toggle('marking', S.marking); if (S.marking && S.zoom !== 1) { S.zoom = 1; build(); } } }, '▭ Marcar zona');
      const clearBtn = h('button', { type: 'button', onclick: () => { S.region = null; paintAll(); regionInfo(); } }, 'Quitar marca');
      const info = h('span', { class: 'muted' });
      const regionInfo = () => { info.textContent = S.region ? `Zona: ${Math.round(S.region.x * 100)}%, ${Math.round(S.region.y * 100)}% · ${Math.round(S.region.w * 100)}×${Math.round(S.region.h * 100)}%` : 'Sin zona marcada (el análisis será de toda la imagen).'; };
      const invert = h('label', { class: 'ctl inline' }, h('input', { type: 'checkbox', onchange: (e) => { S.invert = e.target.checked; applyFilter(); } }), ' Invertir');
      const reset = h('button', { type: 'button', onclick: () => { Object.assign(S, { zoom: 1, bright: 100, contrast: 100, invert: false }); invert.querySelector('input').checked = false; tools.replaceWith(mkTools()); build(); } }, 'Restablecer');
      var mkTools = () => { const t = h('div', { class: 'tools' }, ctl('Zoom', 1, 5, 'zoom', (v) => v + '×'), ctl('Brillo', 40, 220, 'bright'), ctl('Contraste', 40, 220, 'contrast'), invert, reset); tools = t; return t; };
      let tools; tools = mkTools();

      /* Consulta al motor sobre esta imagen */
      const side = h('div', { class: 'side' });
      const canAsk = can(...OPERATIVE);
      const canFind = can(...REVIEW);
      const history = h('div', { class: 'list' });
      const evIds = [a?.evidence_id, b?.evidence_id].filter(Boolean);
      const loadQ = async () => {
        if (!evIds.length) return history.replaceChildren(empty('Sin consultas.'));
        const qs = await db(supabase.from('ai_queries').select('id,scope,prompt,answer,proposed_state,confidence_label,decision,created_at,user_id,evidence_id').in('evidence_id', evIds).order('created_at', { ascending: false }).limit(20));
        history.replaceChildren(...(qs.length ? qs.map((q) => h('div', { class: 'qcard' },
          h('div', { class: 'muted' }, fmtDate(q.created_at) + ' · ' + (q.evidence_id === a?.evidence_id ? 'Ingreso' : 'Salida')),
          h('p', null, q.prompt),
          q.answer ? h('div', { class: 'answer' }, h('strong', null, 'Respuesta del motor'), h('p', null, q.answer), q.proposed_state ? badge('Estado propuesto ' + q.proposed_state, 'ai') : null, ' ', q.confidence_label ? badge('Confianza ' + q.confidence_label) : null)
            : badge('En cola: el trabajador de GPU responderá cuando esté conectado', 'warn'),
          q.answer && !q.decision && q.user_id === ctx.user.id ? h('div', { class: 'row' }, ['aceptada', 'corregida', 'rechazada'].map((d) => h('button', { type: 'button', onclick: async () => { try { await db(supabase.from('ai_queries').update({ decision: d, decided_at: new Date().toISOString() }).eq('id', q.id)); loadQ(); } catch (e) { toast(e.message, 'error'); } } }, d[0].toUpperCase() + d.slice(1)))) : (q.decision ? badge('Decisión: ' + q.decision, 'ok') : null))) : [empty('Aún no hay consultas para esta vista.')]));
      };
      if (canAsk) {
        const lib = select([['', 'Prompt de la biblioteca…'], ...prompts.map((p) => [p.id, p.title])], '');
        const txt = h('textarea', { rows: 4, maxLength: 4000, placeholder: 'Ej.: ¿Hay rayones nuevos en la zona marcada que no estaban al ingreso?' });
        lib.addEventListener('change', () => { const p = prompts.find((x) => x.id === lib.value); if (p) txt.value = p.template.replaceAll('{vista}', view.name); });
        const tgt = select([['ingreso', 'Aplicar a la foto de ingreso'], ['salida', 'Aplicar a la foto de salida']], S.target);
        const ask = h('button', { type: 'button', class: 'primary', onclick: async () => {
          const rec = tgt.value === 'ingreso' ? a : b; const p = txt.value.trim();
          if (!rec) return toast('Esa fase no tiene foto para esta vista.', 'error'); if (!p) return toast('Escribe la pregunta.', 'error');
          ask.disabled = true;
          try {
            await db(supabase.from('ai_queries').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, evidence_id: rec.evidence_id, user_id: ctx.user.id, scope: 'imagen', prompt: p, region: S.region }));
            txt.value = ''; toast('Consulta enviada al motor.'); loadQ();
          } catch (e) { toast(e.message, 'error'); } finally { ask.disabled = false; }
        } }, 'Consultar al motor');
        side.append(h('div', { class: 'card' }, h('h3', null, 'Pregunta sobre esta imagen'), lib, tgt, txt, h('div', { class: 'row' }, ask)));
      }
      if (canFind) {
        const part = select([['', 'Pieza…'], ...parts.map((p) => [p.code, p.name])], '');
        const dmg = select([['', 'Tipo de daño…'], ...damages.map((d) => [d.code, d.name])], '');
        const st = select(STATES.map((s) => [s, s]), 'E1');
        const save = h('button', { type: 'button', onclick: async () => {
          if (!part.value || !dmg.value) return toast('Elige la pieza y el tipo de daño.', 'error');
          save.disabled = true;
          try {
            const r = S.region, poly = r ? [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] : null;
            const f = await db(supabase.from('findings').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, part_code: part.value, damage_code: dmg.value, polygon: poly, state: st.value, validation: 'HUMAN_REVIEWED', created_by: ctx.user.id }).select('id').single());
            const fe = [a && { evidence_id: a.evidence_id, role: 'ingreso' }, b && { evidence_id: b.evidence_id, role: 'salida' }].filter(Boolean).map((x) => ({ ...x, finding_id: f.id, org_id: ctx.org.id, site_id: ctx.site.id, region: r }));
            if (fe.length) await db(supabase.from('finding_evidence').insert(fe));
            await db(supabase.from('finding_reviews').insert({ org_id: ctx.org.id, site_id: ctx.site.id, finding_id: f.id, reviewer_id: ctx.user.id, decision: 'aceptar', note: 'Hallazgo registrado por una persona en la mesa de comparación (' + view.code + ').' }));
            toast('Hallazgo registrado. Pasa a revisión en «Hallazgos».');
          } catch (e) { toast(e.message, 'error'); } finally { save.disabled = false; }
        } }, 'Registrar hallazgo');
        side.append(h('div', { class: 'card' }, h('h3', null, 'Registrar hallazgo'), h('p', { class: 'muted' }, 'Usa la zona marcada como polígono y guarda la foto de ingreso y de salida como evidencia.'), part, dmg, h('label', { class: 'fld' }, h('span', null, 'Estado de evidencia'), st), h('div', { class: 'row' }, save)));
      }
      side.append(h('div', { class: 'card' }, h('h3', null, 'Consultas de esta vista'), history));
      const body = h('div', { class: 'viewer' }, h('div', { class: 'vmain' }, modes, tools, h('div', { class: 'toolbar' }, markBtn, clearBtn, info), stage,
        a?.evidence_files ? h('p', { class: 'muted mono' }, 'Ingreso SHA-256 ' + a.evidence_files.sha256_client.slice(0, 16) + '… · ' + fmtDate(a.evidence_files.captured_at)) : null,
        b?.evidence_files ? h('p', { class: 'muted mono' }, 'Salida SHA-256 ' + b.evidence_files.sha256_client.slice(0, 16) + '… · ' + fmtDate(b.evidence_files.captured_at)) : null), side);
      openModal(view.code + ' · ' + view.name, body, { wide: true });
      regionInfo(); build(); loadQ();
    }
  }
};
