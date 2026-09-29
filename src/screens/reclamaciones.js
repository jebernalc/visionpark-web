import { supabase, ctx, h, db, can, toast, badge, empty, field, select, fmtDate, OPERATIVE, REVIEW } from '../lib.js';

const ST = { abierta: ['Abierta', 'warn'], en_revision: ['En revisión', 'ai'], cerrada: ['Cerrada', 'ok'] };

export default {
  id: 'reclamaciones', title: 'Reclamaciones', roles: null,
  async render(root) {
    const canCreate = can(...OPERATIVE);
    let filter = 'todas';
    const list = h('div', { class: 'list' });
    const rows = await db(supabase.from('claims').select('id,session_id,claimant_name,description,status,opened_at,closed_at,parking_sessions(plate)').eq('site_id', ctx.site.id).order('opened_at', { ascending: false }).limit(80));
    const counts = await db(supabase.from('claim_views').select('claim_id').eq('site_id', ctx.site.id)).catch(() => []);
    const nPhotos = counts.reduce((m, c) => m.set(c.claim_id, (m.get(c.claim_id) || 0) + 1), new Map());
    const paint = () => {
      const r = rows.filter((c) => filter === 'todas' || c.status === filter);
      list.replaceChildren(...(r.length ? r.map((c) => h('a', { class: 'row-card', href: '#/reclamacion/' + c.id },
        h('div', null, h('strong', { class: 'plate' }, c.parking_sessions?.plate || '—'), ' ', h('strong', null, c.claimant_name || 'Sin nombre'), ' ', badge(ST[c.status][0], ST[c.status][1]), ' ', badge((nPhotos.get(c.id) || 0) + ' fotos'),
          h('div', { class: 'muted' }, 'Abierta ' + fmtDate(c.opened_at)), c.description ? h('p', { class: 'muted' }, c.description.slice(0, 140)) : null),
        h('span', { class: 'btn' }, 'Abrir expediente'))) : [empty('No hay reclamaciones con este filtro.')]));
    };
    const fsel = select([['todas', 'Todas'], ['abierta', 'Abiertas'], ['en_revision', 'En revisión'], ['cerrada', 'Cerradas']], 'todas', { 'aria-label': 'Filtro', onchange: (e) => { filter = e.target.value; paint(); } });
    root.append(h('h2', null, 'Reclamaciones'), h('p', { class: 'muted' }, 'Cada reclamación tiene su expediente: fotos aportadas por quien reclama, comparación con el ingreso y la salida, análisis de visión digital e informe PDF.'));
    if (canCreate) {
      const ses = select([], '', { 'aria-label': 'Sesión' }), who = h('input', { placeholder: 'Nombre de quien reclama', maxLength: 120 }), desc = h('textarea', { rows: 3, maxLength: 1000, placeholder: 'Qué reclama (pieza, daño, cuándo lo notó)' });
      db(supabase.from('parking_sessions').select('id,plate,entered_at').eq('site_id', ctx.site.id).order('entered_at', { ascending: false }).limit(80)).then((s) => ses.replaceChildren(...s.map((x) => h('option', { value: x.id }, x.plate + ' · ' + fmtDate(x.entered_at)))));
      const btn = h('button', { type: 'submit', class: 'primary' }, 'Abrir reclamación y cargar fotos');
      root.append(h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault(); if (!ses.value) return toast('No hay sesiones para reclamar.', 'error'); btn.disabled = true;
        try {
          const c = await db(supabase.from('claims').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: ses.value, claimant_name: who.value.trim() || null, description: desc.value.trim() || null, created_by: ctx.user.id }).select('id').single());
          toast('Reclamación abierta.'); location.hash = '#/reclamacion/' + c.id;
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      } }, h('h3', null, 'Nueva reclamación'), h('div', { class: 'grid2' }, field('Sesión (placa)', ses), field('Reclamante', who)), field('Descripción', desc), h('div', { class: 'row' }, btn)));
    }
    root.append(h('div', { class: 'toolbar' }, fsel), list); paint();
  }
};
