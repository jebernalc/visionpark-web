import { supabase, ctx, h, db, toast, sha256Hex, signedUrls, badge, empty, select, field, openModal, fmtDate, OPERATIVE, can } from '../lib.js';
import { reportButton } from '../report.js';

/* Calidad estimada en el navegador: nitidez (varianza del laplaciano) y exposición */
export async function estimateQuality(file) {
  try {
    const bmp = await createImageBitmap(file);
    const w = 256, hgt = Math.max(1, Math.round(bmp.height * w / bmp.width));
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, hgt);
    const d = g.getImageData(0, 0, w, hgt).data, gray = new Float32Array(w * hgt);
    let sum = 0;
    for (let i = 0; i < gray.length; i++) { gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gray[i]; }
    const mean = sum / gray.length; let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < hgt - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      s += l; s2 += l * l; n++;
    }
    const variance = s2 / n - (s / n) ** 2;
    const sharp = Math.min(1, variance / 150), expo = Math.max(0, 1 - Math.abs(mean - 128) / 128);
    const q = Math.round((0.7 * sharp + 0.3 * expo) * 100) / 100;
    return { quality: q, usable: q >= 0.35 };
  } catch { return { quality: null, usable: null }; }
}

export default {
  id: 'captura', title: 'Captura', roles: OPERATIVE, hidden: true,
  async render(root, param) {
    if (!param) { root.append(empty('Elige una sesión en «Sesiones» y pulsa Capturar.')); return; }
    const session = await db(supabase.from('parking_sessions').select('*').eq('id', param).eq('site_id', ctx.site.id).maybeSingle());
    if (!session) { root.append(empty('Sesión no encontrada en esta sede.')); return; }
    const views = await db(supabase.from('canonical_views').select('*').order('sort_order'));
    let phase = session.status === 'cerrada' ? 'salida' : 'ingreso';
    const cells = h('div', { class: 'vgrid' });
    const progress = h('div', { class: 'progress' }), bar = h('span'), plabel = h('strong');
    progress.append(bar);
    let latest = new Map();

    const claimBox = h('div'), capCard = h('div', { class: 'card' }, plabel, progress);
    let claims = [], claimId = null;
    const load = async () => {
      if (phase === 'reclamacion') { cells.replaceChildren(); capCard.hidden = true; return loadClaims(); }
      claimBox.replaceChildren(); capCard.hidden = false;
      const rows = await db(supabase.from('capture_views').select('id,phase,view_code,quality,usable,created_at,evidence_files(storage_path)')
        .eq('session_id', session.id).order('created_at', { ascending: true }));
      latest = new Map(rows.map((r) => [r.phase + ':' + r.view_code, r]));
      const urlOf = await signedUrls(rows.map((r) => r.evidence_files?.storage_path));
      draw(urlOf);
    };


    /* --- Fase «Reclamación»: hasta 5 fotos (o más) con el mismo estilo que ingreso y salida --- */
    const loadClaims = async () => {
      claims = await db(supabase.from('claims').select('id,claimant_name,description,status,opened_at').eq('session_id', session.id).order('opened_at', { ascending: false }));
      if (!claimId || !claims.some((c) => c.id === claimId)) claimId = claims[0]?.id || null;
      await drawClaim();
    };
    const drawClaim = async () => {
      const kids = [];
      if (!claims.length) {
        const who = h('input', { placeholder: 'Nombre de quien reclama', maxLength: 120 }), desc = h('textarea', { rows: 3, maxLength: 1000, placeholder: 'Qué reclama (pieza, daño, cuándo lo notó)' }), btn = h('button', { type: 'submit', class: 'primary' }, 'Abrir reclamación');
        kids.push(h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); btn.disabled = true;
          try { const c = await db(supabase.from('claims').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, claimant_name: who.value.trim() || null, description: desc.value.trim() || null, created_by: ctx.user.id }).select('id').single()); claimId = c.id; toast('Reclamación abierta. Ya puedes cargar las fotos.'); await loadClaims(); }
          catch (err) { toast(err.message, 'error'); btn.disabled = false; } } },
          h('h3', null, 'Esta sesión aún no tiene reclamación'), h('p', { class: 'muted' }, 'Ábrela para cargar las fotos que aporta quien reclama, con el mismo esquema de las 24 vistas.'), h('div', { class: 'grid2' }, field('Reclamante', who), field('Descripción', desc)), h('div', { class: 'row' }, btn)));
        claimBox.replaceChildren(...kids); return;
      }
      const claim = claims.find((c) => c.id === claimId);
      const rows = await db(supabase.from('claim_views').select('id,view_code,note,quality,usable,created_at,evidence_files(storage_path,sha256_client,captured_at)').eq('claim_id', claim.id).order('created_at'));
      const urlOf = await signedUrls(rows.map((r) => r.evidence_files?.storage_path));
      const pick = claims.length > 1 ? select(claims.map((c) => [c.id, (c.claimant_name || 'Sin nombre') + ' · ' + fmtDate(c.opened_at)]), claim.id, { 'aria-label': 'Reclamación', onchange: (e) => { claimId = e.target.value; drawClaim(); } }) : null;
      const sendOne = async (file, slotView) => {
        if (!file.type.startsWith('image/')) return toast('Solo se admiten fotos.', 'error');
        if (file.size > 25 * 1024 * 1024) return toast('La foto supera 25 MB.', 'error');
        const [hash, q] = await Promise.all([sha256Hex(file), estimateQuality(file)]);
        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), path = `${ctx.org.id}/${ctx.site.id}/${session.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw new Error(up.error.message);
        const ev = await db(supabase.from('evidence_files').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, claim_id: claim.id, kind: 'foto', phase: 'reclamacion', storage_path: path, mime: file.type, bytes: file.size, sha256_client: hash, captured_by: ctx.user.id, device: navigator.userAgent.slice(0, 120) }).select('id').single());
        await db(supabase.from('claim_views').insert({ org_id: ctx.org.id, site_id: ctx.site.id, claim_id: claim.id, evidence_id: ev.id, view_code: slotView || null, quality: q.quality, usable: q.usable, created_by: ctx.user.id }));
        toast(`Foto guardada · huella ${hash.slice(0, 8)}…` + (q.usable === false ? ' · calidad baja, considera repetirla' : ''), q.usable === false ? 'warn' : 'good');
      };
      const many = async (files) => { for (const f of files) { try { await sendOne(f, null); } catch (e) { toast(e.message, 'error'); } } await drawClaim(); };
      const total = Math.max(5, rows.length + (rows.length >= 5 ? 1 : 0));
      const slot = (i) => {
        const r = rows[i], url = r && urlOf(r.evidence_files?.storage_path);
        const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr', 'aria-label': `Foto ${i + 1} de la reclamación`, onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await sendOne(f, null); } catch (err) { toast(err.message, 'error'); } await drawClaim(); } });
        const vs = r ? select([['', 'Asignar vista…'], ...views.map((v) => [v.code, `${v.code} · ${v.name}`])], r.view_code || '', { 'aria-label': 'Vista de la foto', onchange: async (e) => { try { await db(supabase.from('claim_views').update({ view_code: e.target.value || null }).eq('id', r.id)); toast('Vista asignada.'); } catch (err) { toast(err.message, 'error'); } } }) : null;
        return h('div', { class: 'vcell' + (r ? ' done' : '') },
          h('label', { class: 'slotpick' }, url ? h('img', { src: url, alt: `Foto ${i + 1} de la reclamación`, loading: 'lazy' }) : h('div', { class: 'ph' }, '＋'), h('span', { class: 'vname' }, `Foto ${i + 1}`), input),
          r ? badge(r.usable === false ? 'Calidad baja' : r.quality != null ? 'Calidad ' + Math.round(r.quality * 100) + '%' : 'Guardada', r.usable === false ? 'warn' : 'ok') : null, vs);
      };
      const multi = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; many(f); } });
      const drop = h('label', { class: 'dropzone', tabindex: 0, ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); many([...e.dataTransfer.files]); } },
        h('strong', null, 'Arrastra aquí varias fotos de la reclamación'), h('span', { class: 'muted' }, 'o toca para elegirlas de tu galería'), multi);
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); multi.click(); } });
      const withView = rows.filter((r) => r.view_code).length;
      kids.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('strong', null, `${rows.length} foto(s) de la reclamación · ${withView} con vista asignada`), pick, badge(claim.claimant_name || 'Sin nombre')),
        h('div', { class: 'progress' }, h('span', { style: `width:${Math.min(100, rows.length / 5 * 100)}%` })),
        claim.description ? h('p', { class: 'muted' }, claim.description) : null,
        h('p', { class: 'muted' }, 'Toca un cuadro para tomar o elegir la foto. Asigna a cada foto la vista (V01 a V24) que muestra, para compararla con el ingreso y la salida de esa misma vista.')),
        h('div', { class: 'vgroup' }, h('h3', null, 'Fotos de la reclamación'), h('div', { class: 'vcells' }, Array.from({ length: total }, (_, i) => slot(i)))), drop,
        h('div', { class: 'toolbar' }, h('a', { class: 'btn primary-link', href: `#/mesa/${session.id}/${claim.id}` }, 'Comparar ingreso · salida · reclamación'), h('a', { class: 'btn', href: '#/reclamacion/' + claim.id }, 'Abrir expediente y análisis'), reportButton({ session, claim })));
      claimBox.replaceChildren(...kids);
    };

    const upload = async (view, file) => {
      if (!file.type.startsWith('image/')) return toast('Solo se admiten fotos.', 'error');
      const cell = document.getElementById('cell-' + view.code); cell?.classList.add('busy');
      try {
        const [hash, qual] = await Promise.all([sha256Hex(file), estimateQuality(file)]);
        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const path = `${ctx.org.id}/${ctx.site.id}/${session.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw new Error(up.error.message);
        const ev = await db(supabase.from('evidence_files').insert({
          org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, kind: 'foto', phase, storage_path: path,
          mime: file.type, bytes: file.size, sha256_client: hash, captured_by: ctx.user.id, device: navigator.userAgent.slice(0, 120)
        }).select('id').single());
        await db(supabase.from('capture_views').insert({
          org_id: ctx.org.id, site_id: ctx.site.id, session_id: session.id, phase, view_code: view.code, evidence_id: ev.id, ...qual
        }));
        await load();
        const done = views.filter((v) => latest.has(phase + ':' + v.code)).length;
        await supabase.from('parking_sessions').update(phase === 'ingreso' ? { coverage_in: done / views.length } : { coverage_out: done / views.length }).eq('id', session.id);
        toast(`${view.name} guardada · huella ${hash.slice(0, 8)}…` + (qual.usable === false ? ' · calidad baja, considera repetirla' : ''), qual.usable === false ? 'warn' : 'good');
      } catch (e) { toast(e.message, 'error'); } finally { cell?.classList.remove('busy'); }
    };

    const draw = (urlOf) => {
      const done = views.filter((v) => latest.has(phase + ':' + v.code)).length;
      bar.style.width = (done / views.length * 100) + '%'; plabel.textContent = `${done} de ${views.length} vistas de ${phase}`;
      const groups = [...new Set(views.map((v) => v.group_name))];
      cells.replaceChildren(...groups.map((g) => h('section', { class: 'vgroup' }, h('h3', null, g),
        h('div', { class: 'vcells' }, views.filter((v) => v.group_name === g).map((v) => {
          const rec = latest.get(phase + ':' + v.code), url = rec && urlOf(rec.evidence_files?.storage_path);
          const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr', 'aria-label': `${rec ? 'Repetir' : 'Tomar'} ${v.name}`, onchange: (e) => { const f = e.target.files[0]; if (f) upload(v, f); e.target.value = ''; } });
          return h('label', { class: 'vcell' + (rec ? ' done' : ''), id: 'cell-' + v.code },
            url ? h('img', { src: url, alt: v.name, loading: 'lazy' }) : h('div', { class: 'ph' }, '＋'),
            h('span', { class: 'vname' }, v.code + ' · ' + v.name),
            rec ? badge(rec.usable === false ? 'Calidad baja' : rec.quality != null ? 'Calidad ' + Math.round(rec.quality * 100) + '%' : 'Guardada', rec.usable === false ? 'warn' : 'ok') : null,
            input);
        })))));
    };

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fase' }, ['ingreso', 'salida', 'reclamacion'].map((p) =>
      h('button', { type: 'button', 'aria-pressed': String(p === phase), onclick: (e) => { phase = p; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); load(); } }, p === 'reclamacion' ? 'Reclamación' : p === 'ingreso' ? 'Ingreso' : 'Salida')));
    root.append(
      h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/sesiones' }, '← Sesiones'), h('h2', null, 'Pasaporte visual · ', h('span', { class: 'plate' }, session.plate)), seg,
        h('a', { class: 'btn', href: '#/mesa/' + session.id }, 'Comparar')),
      h('p', { class: 'muted' }, 'Cada foto se firma con SHA-256 en tu dispositivo antes de subirla. El original no se puede modificar ni borrar; repetir una vista guarda una nueva y conserva la anterior.'),
      capCard, cells, claimBox);
    await load();
  }
};
