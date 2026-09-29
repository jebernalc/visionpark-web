import { supabase, ctx, h, db, can, toast, sha256Hex, signedUrls, badge, empty, select, openModal, fmtDate, OPERATIVE, REVIEW } from '../lib.js';
import { estimateQuality } from './captura.js';
import { openViewer } from '../viewer.js';
import { loadBitmap, analyzePair, claimVerdict, overallVerdict } from '../cv.js';
import { reportButton, savedReports } from '../report.js';

const ST = { abierta: ['Abierta', 'warn'], en_revision: ['En revisión', 'ai'], cerrada: ['Cerrada', 'ok'] };
const VB = { indicios: 'bad', sin_indicios: 'ok', sin_diferencias: 'ok', no_concluyente: 'warn' };

export default {
  id: 'reclamacion', title: 'Expediente', roles: null, hidden: true,
  async render(root, claimId) {
    if (!claimId) { location.hash = '#/reclamaciones'; return; }
    const claim = await db(supabase.from('claims').select('*, parking_sessions(*)').eq('id', claimId).eq('site_id', ctx.site.id).maybeSingle());
    if (!claim) { root.append(empty('Reclamación no encontrada en esta sede.')); return; }
    const session = claim.parking_sessions, canUpload = can(...OPERATIVE), canReview = can(...REVIEW);
    const [views, parts, damages, prompts] = await Promise.all([
      db(supabase.from('canonical_views').select('*').order('sort_order')), db(supabase.from('vehicle_parts').select('code,name').order('name')),
      db(supabase.from('damage_types').select('code,name').order('name')), db(supabase.from('prompt_library').select('id,title,template,scope').eq('active', true).order('title'))
    ]);
    const top = h('div'), gal = h('div'), cmp = h('div'), ana = h('div'), reps = h('div');
    let cviews = [], caps = [], urlOf = () => null, results = new Map();

    const load = async () => {
      [cviews, caps] = await Promise.all([
        db(supabase.from('claim_views').select('id,view_code,note,quality,usable,created_at,evidence_id,evidence_files(storage_path,sha256_client,captured_at,bytes)').eq('claim_id', claim.id).order('created_at')),
        db(supabase.from('capture_views').select('phase,view_code,evidence_id,created_at,evidence_files(storage_path,sha256_client,captured_at)').eq('session_id', session.id).order('created_at'))
      ]);
      urlOf = await signedUrls([...cviews, ...caps].map((c) => c.evidence_files?.storage_path));
      drawGallery(); drawCompare(); drawAnalysis(); await drawReports();
    };

    /* --- Cabecera --- */
    const stSel = select(Object.entries(ST).map(([k, v]) => [k, v[0]]), claim.status, { disabled: !canReview, 'aria-label': 'Estado', onchange: async (e) => {
      try {
        await db(supabase.from('claims').update({ status: e.target.value, closed_at: e.target.value === 'cerrada' ? new Date().toISOString() : null }).eq('id', claim.id));
        await db(supabase.from('claim_events').insert({ org_id: ctx.org.id, site_id: ctx.site.id, claim_id: claim.id, event_type: 'estado', detail: { de: claim.status, a: e.target.value }, actor: ctx.user.id }));
        claim.status = e.target.value; toast('Estado actualizado.');
      } catch (err) { toast(err.message, 'error'); }
    } });
    top.append(h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/reclamaciones' }, '← Reclamaciones'), h('h2', null, 'Expediente · ', h('span', { class: 'plate' }, session.plate)), stSel),
      h('div', { class: 'card' }, h('div', { class: 'facts2' },
        h('div', null, h('span', null, 'Reclamante'), h('strong', null, claim.claimant_name || '—')), h('div', null, h('span', null, 'Apertura'), h('strong', null, fmtDate(claim.opened_at))),
        h('div', null, h('span', null, 'Ingreso del vehículo'), h('strong', null, fmtDate(session.entered_at))), h('div', null, h('span', null, 'Salida'), h('strong', null, session.exited_at ? fmtDate(session.exited_at) : 'Sin registrar'))),
        claim.description ? h('p', null, claim.description) : null));

    /* --- Carga de fotos de la reclamación --- */
    if (canUpload) {
      const tag = select([['', 'Asignar después'], ...views.map((v) => [v.code, `${v.code} · ${v.name}`])], '', { 'aria-label': 'Vista para las fotos nuevas' });
      const log = h('div', { class: 'list' });
      const one = async (file) => {
        const row = h('div', { class: 'row-card compact' }, h('span', null, file.name), h('span', { class: 'muted' }, 'Subiendo…')); log.prepend(row);
        try {
          if (!file.type.startsWith('image/')) throw new Error('Solo se admiten fotos.');
          if (file.size > 25 * 1024 * 1024) throw new Error('La foto supera 25 MB.');
          const [hash, q] = await Promise.all([sha256Hex(file), estimateQuality(file)]);
          const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), path = `${ctx.org.id}/${ctx.site.id}/${session.id}/${crypto.randomUUID()}.${ext}`;
          const up = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw new Error(up.error.message);
          const ev = await db(supabase.from('evidence_files').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, claim_id: claim.id, kind: 'foto', phase: 'reclamacion', storage_path: path, mime: file.type, bytes: file.size, sha256_client: hash, captured_by: ctx.user.id, device: navigator.userAgent.slice(0, 120) }).select('id').single());
          await db(supabase.from('claim_views').insert({ org_id: ctx.org.id, site_id: ctx.site.id, claim_id: claim.id, evidence_id: ev.id, view_code: tag.value || null, quality: q.quality, usable: q.usable, created_by: ctx.user.id }));
          row.lastChild.textContent = 'Guardada · huella ' + hash.slice(0, 8) + '…'; row.lastChild.className = 'msg good';
        } catch (e) { row.lastChild.textContent = e.message; row.lastChild.className = 'msg error'; }
      };
      const many = async (files) => { for (const f of files) await one(f); await load(); };
      const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', onchange: (e) => { many([...e.target.files]); e.target.value = ''; } });
      const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr', onchange: (e) => { many([...e.target.files]); e.target.value = ''; } });
      const drop = h('label', { class: 'dropzone', tabindex: 0,
        ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); many([...e.dataTransfer.files]); } },
        h('strong', null, 'Arrastra aquí las fotos de la reclamación'), h('span', { class: 'muted' }, 'o toca para elegirlas de tu galería (puedes seleccionar varias)'), fileIn);
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
      top.append(h('div', { class: 'card' }, h('h3', null, 'Fotos de la reclamación'),
        h('p', { class: 'muted' }, 'Cada foto se firma con SHA-256 y queda como original inmutable. Asignarla a una vista (V01 a V24) permite compararla con el ingreso y la salida de esa misma vista.'),
        h('div', { class: 'grid2' }, h('label', { class: 'fld' }, h('span', null, 'Asignar las fotos que subas a la vista'), tag),
          h('div', { class: 'fld' }, h('span', null, 'Cámara'), h('button', { type: 'button', onclick: () => camIn.click() }, '📷 Tomar foto ahora'), camIn)), drop, log));
    }
    root.append(top, gal, cmp, ana, reps);

    /* --- Galería con etiquetado --- */
    const drawGallery = () => {
      gal.replaceChildren(h('div', { class: 'card' }, h('h3', null, `Fotos cargadas (${cviews.length})`),
        h('p', { class: 'muted' }, 'Las fotos no se pueden borrar. Si te equivocaste de vista, cámbiala aquí.'),
        cviews.length ? h('div', { class: 'vcells' }, cviews.map((c) => {
          const vs = select([['', 'Sin vista'], ...views.map((v) => [v.code, `${v.code} · ${v.name}`])], c.view_code || '', { disabled: !canUpload, 'aria-label': 'Vista de la foto', onchange: async (e) => {
            try { await db(supabase.from('claim_views').update({ view_code: e.target.value || null }).eq('id', c.id)); toast('Vista actualizada.'); await load(); } catch (err) { toast(err.message, 'error'); } } });
          const note = h('input', { value: c.note || '', maxLength: 500, placeholder: 'Nota (opcional)', disabled: !canUpload, 'aria-label': 'Nota', onchange: async (e) => {
            try { await db(supabase.from('claim_views').update({ note: e.target.value.trim() || null }).eq('id', c.id)); toast('Nota guardada.'); } catch (err) { toast(err.message, 'error'); } } });
          const url = urlOf(c.evidence_files.storage_path);
          return h('div', { class: 'vcell static' }, h('img', { src: url, alt: 'Foto de la reclamación', loading: 'lazy', onclick: () => openModal('Foto de la reclamación', h('div', null, h('img', { src: url, alt: '', class: 'bigimg' }), h('p', { class: 'muted mono' }, 'SHA-256 ' + c.evidence_files.sha256_client)), { wide: true }) }),
            vs, note, c.quality != null ? badge(c.usable === false ? 'Calidad baja' : 'Calidad ' + Math.round(c.quality * 100) + '%', c.usable === false ? 'warn' : 'ok') : null, h('small', { class: 'muted mono' }, c.evidence_files.sha256_client.slice(0, 12) + '… · ' + fmtDate(c.evidence_files.captured_at)));
        })) : empty('Aún no hay fotos. Súbelas arriba para poder compararlas.')));
    };

    /* --- Comparación ingreso / salida / reclamación --- */
    const latest = () => new Map(caps.map((c) => [c.phase + ':' + c.view_code, c]));
    const recsFor = (v) => { const L = latest(); return { ingreso: L.get('ingreso:' + v.code) || null, salida: L.get('salida:' + v.code) || null, reclamacion: cviews.filter((c) => c.view_code === v.code) }; };
    const open = (v) => openViewer({ session, view: v, recs: recsFor(v), urlOf, parts, damages, prompts, claim });
    const drawCompare = () => {
      const withClaim = views.filter((v) => cviews.some((c) => c.view_code === v.code));
      const th = (rec, l) => rec ? h('img', { src: urlOf(rec.evidence_files.storage_path), alt: l, loading: 'lazy' }) : h('div', { class: 'ph small' }, 'Sin foto');
      cmp.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Comparación por vista'),
        withClaim.length ? h('div', { class: 'cgrid three' }, withClaim.map((v) => { const r = recsFor(v), res = results.get(v.code);
          return h('button', { type: 'button', class: 'ccell', onclick: () => open(v), 'aria-label': 'Revisar ' + v.name },
            h('div', { class: 'pair p3' }, th(r.ingreso, 'Ingreso'), th(r.salida, 'Salida'), th(r.reclamacion[0], 'Reclamación')), h('span', { class: 'vname' }, v.code + ' · ' + v.name),
            h('span', { class: 'pairtag p3' }, h('em', null, 'Ingreso'), h('em', null, 'Salida'), h('em', null, 'Reclamación')), res?.verdict ? badge(res.verdict.label, VB[res.verdict.code]) : null);
        })) : empty('Asigna cada foto a una vista para verla junto al ingreso y la salida.'),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/mesa/${session.id}/${claim.id}` }, 'Abrir en la mesa completa'))));
    };

    /* --- Análisis de visión digital de toda la reclamación --- */
    const drawAnalysis = () => {
      const withClaim = views.filter((v) => cviews.some((c) => c.view_code === v.code));
      const bar = h('div', { class: 'progress', hidden: true }, h('span')), msg = h('p', { class: 'muted' });
      const out = h('div');
      const run = h('button', { type: 'button', class: 'primary', disabled: !withClaim.length, onclick: async () => {
        run.disabled = true; bar.hidden = false; results = new Map(); out.replaceChildren();
        for (let i = 0; i < withClaim.length; i++) {
          const v = withClaim[i], r = recsFor(v); bar.firstChild.style.width = Math.round(i / withClaim.length * 100) + '%'; msg.textContent = `Analizando ${v.code} · ${v.name}…`;
          try {
            if (!r.ingreso) { results.set(v.code, { verdict: { code: 'no_concluyente', label: 'No concluyente', reason: 'Falta la foto de ingreso de esta vista.', confidence: 'abstencion' } }); continue; }
            const bi = await loadBitmap(r.ingreso.evidence_files.storage_path), bc = await loadBitmap(r.reclamacion[0].evidence_files.storage_path), bs = r.salida ? await loadBitmap(r.salida.evidence_files.storage_path) : null;
            const cl = await analyzePair(bi, bc), stay = bs ? await analyzePair(bi, bs) : null;
            results.set(v.code, { stay, cl, verdict: stay ? claimVerdict(stay, cl) : { code: 'no_concluyente', label: 'No concluyente', reason: 'Falta la foto de salida de esta vista.', confidence: 'abstencion' } });
          } catch (e) { results.set(v.code, { verdict: { code: 'no_concluyente', label: 'No concluyente', reason: e.message, confidence: 'abstencion' } }); }
        }
        bar.firstChild.style.width = '100%'; msg.textContent = 'Análisis terminado.';
        const list = [...results.values()].map((x) => x.verdict), overall = overallVerdict(list);
        if (canReview) for (const v of withClaim) { const x = results.get(v.code), r = recsFor(v); if (x?.stay && x?.cl) {
          try { await db(supabase.from('ai_comparisons').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, evidence_in: r.ingreso.evidence_id, evidence_out: r.reclamacion[0].evidence_id,
            result: { engine: 'vision-local-1', tipo: 'reclamacion', vista: v.code, reclamacion: claim.id, veredicto: x.verdict.code, coincidencia: x.verdict.overlap, similitud_ingreso_salida: x.stay.ssim, cambio_ingreso_salida_pct: x.stay.changedPct, cambio_ingreso_reclamacion_pct: x.cl.changedPct, confianza: x.verdict.confidence } })); } catch { /* ya guardado o sin permiso */ } } }
        drawCompare();
        const box = h('div', { class: 'verdict ' + overall.code }, h('strong', null, 'Resultado orientativo: ' + overall.label),
          h('p', null, overall.code === 'indicios' ? 'Al menos una vista muestra en la reclamación cambios que ya eran visibles en la salida.' : overall.code === 'sin_indicios' ? 'En las vistas concluyentes, los cambios de la reclamación no aparecen en las fotos de salida.' : 'Las fotos disponibles no permiten una conclusión automática.'),
          h('span', { class: 'muted' }, 'Decide una persona. Genera el informe PDF para dejar el análisis documentado.'));
        out.replaceChildren(box, h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Vista', 'Similitud ing.-sal.', 'Cambio ing.-sal.', 'Cambio ing.-recl.', 'Resultado', 'Confianza', ''].map((t) => h('th', null, t)))),
          h('tbody', null, withClaim.map((v) => { const x = results.get(v.code) || {}; return h('tr', null, h('td', null, v.code + ' ' + v.name), h('td', null, x.stay ? Math.round(x.stay.ssim * 100) + '%' : '—'), h('td', null, x.stay ? x.stay.changedPct + '%' : '—'), h('td', null, x.cl ? x.cl.changedPct + '%' : '—'),
            h('td', null, x.verdict ? badge(x.verdict.label, VB[x.verdict.code]) : '—'), h('td', null, x.verdict?.confidence || '—'), h('td', null, h('button', { type: 'button', onclick: () => open(v) }, 'Revisar'))); })))));
        run.disabled = false; run.textContent = 'Repetir el análisis';
      } }, 'Analizar la reclamación con visión digital');
      ana.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Análisis de visión digital'),
        h('p', { class: 'muted' }, 'Para cada vista con foto de reclamación, alinea las fotos, compensa la luz y cruza tres momentos: ingreso, salida y reclamación. Averigua si lo que muestra la reclamación ya era visible al retirar el vehículo.'),
        h('div', { class: 'row' }, run, reportButton({ session, claim })), bar, msg, out));
    };

    /* --- Informes guardados --- */
    const drawReports = async () => {
      let list = []; try { list = await savedReports({ session, claim }); } catch { /* sin permiso o sin informes */ }
      const paths = list.map((r) => r.storage_path), signer = await supabase.storage.from('evidence').createSignedUrls(paths.length ? paths : ['x'], 3600).catch(() => ({ data: [] }));
      const urls = Object.fromEntries((signer.data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
      reps.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Informes guardados'),
        list.length ? list.map((r) => h('div', { class: 'row-card' }, h('div', null, h('strong', null, 'Versión ' + r.version), ' ', badge(r.model_versions?.resultado || 'sin resultado'), h('div', { class: 'muted' }, fmtDate(r.created_at)), h('div', { class: 'muted mono' }, 'SHA-256 ' + r.sha256)),
          urls[r.storage_path] ? h('a', { class: 'btn', href: urls[r.storage_path], target: '_blank', rel: 'noopener' }, 'Descargar PDF') : null)) : empty('Aún no hay informes guardados.')));
    };
    await load();
  }
};
