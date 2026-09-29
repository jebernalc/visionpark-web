import { supabase, ctx, h, db, toast, sha256Hex, signedUrls, badge, empty, OPERATIVE, can } from '../lib.js';

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

    const load = async () => {
      const rows = await db(supabase.from('capture_views').select('id,phase,view_code,quality,usable,created_at,evidence_files(storage_path)')
        .eq('session_id', session.id).order('created_at', { ascending: true }));
      latest = new Map(rows.map((r) => [r.phase + ':' + r.view_code, r]));
      const urlOf = await signedUrls(rows.map((r) => r.evidence_files?.storage_path));
      draw(urlOf);
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

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fase' }, ['ingreso', 'salida'].map((p) =>
      h('button', { type: 'button', 'aria-pressed': String(p === phase), onclick: (e) => { phase = p; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); load(); } }, p === 'ingreso' ? 'Ingreso' : 'Salida')));
    root.append(
      h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: '#/sesiones' }, '← Sesiones'), h('h2', null, 'Pasaporte visual · ', h('span', { class: 'plate' }, session.plate)), seg,
        h('a', { class: 'btn', href: '#/mesa/' + session.id }, 'Comparar')),
      h('p', { class: 'muted' }, 'Cada foto se firma con SHA-256 en tu dispositivo antes de subirla. El original no se puede modificar ni borrar; repetir una vista guarda una nueva y conserva la anterior.'),
      h('div', { class: 'card' }, plabel, progress), cells);
    await load();
  }
};
