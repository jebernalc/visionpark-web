import { supabase, ctx, h, db, can, toast, badge, empty, field, select, fmtDate, STATES, REVIEW } from '../lib.js';

export default {
  id: 'hallazgos', title: 'Hallazgos', roles: ['revisor', 'supervisor', 'admin', 'perito', 'auditor'],
  async render(root) {
    let tab = 'hallazgos';
    const body = h('div');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sección' }, [['hallazgos', 'Hallazgos'], ['reclamaciones', 'Reclamaciones']].map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(v === tab), onclick: (e) => { tab = v; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); show(); } }, l)));
    root.append(h('h2', null, 'Hallazgos y reclamaciones'), seg, body);
    const show = () => (tab === 'hallazgos' ? findings(body) : claims(body)).catch((e) => body.replaceChildren(h('p', { class: 'msg error' }, e.message)));
    await show();
  }
};

async function findings(box) {
  const [rows, parts, damages] = await Promise.all([
    db(supabase.from('findings').select('id,session_id,part_code,damage_code,state,validation,confidence_label,confidence,created_at,parking_sessions(plate)').eq('site_id', ctx.site.id).order('created_at', { ascending: false }).limit(80)),
    db(supabase.from('vehicle_parts').select('code,name')), db(supabase.from('damage_types').select('code,name,severity_class'))
  ]);
  const pn = Object.fromEntries(parts.map((p) => [p.code, p.name])), dn = Object.fromEntries(damages.map((d) => [d.code, d.name]));
  const canReview = can(...REVIEW), canApprove = can('supervisor', 'admin');
  let filter = 'todas';
  const list = h('div', { class: 'list' });
  const review = async (f, decision, extra = {}) => {
    try {
      await db(supabase.from('finding_reviews').insert({ org_id: ctx.org.id, site_id: ctx.site.id, finding_id: f.id, reviewer_id: ctx.user.id, decision, ...extra }));
      const upd = { validation: 'HUMAN_REVIEWED' };
      if (extra.corrected_state) upd.state = extra.corrected_state;
      if (extra.corrected_damage_code) upd.damage_code = extra.corrected_damage_code;
      await db(supabase.from('findings').update(upd).eq('id', f.id));
      toast('Revisión guardada.'); draw();
    } catch (e) { toast(e.message, 'error'); }
  };
  const card = (f) => {
    const acts = h('div', { class: 'actions' });
    if (canReview && f.validation === 'AI_GENERATED') {
      const note = h('input', { placeholder: 'Nota (obligatoria para rechazar o corregir)', 'aria-label': 'Nota de revisión' });
      const st = select(STATES.map((s) => [s, 'Estado ' + s]), f.state), dm = select(damages.map((d) => [d.code, d.name]), f.damage_code);
      acts.append(note, st, dm,
        h('button', { type: 'button', class: 'primary', onclick: () => review(f, 'aceptar', { note: note.value || null }) }, 'Aceptar'),
        h('button', { type: 'button', onclick: () => { if (!note.value.trim()) return toast('Escribe la nota de la corrección.', 'error'); review(f, 'corregir', { note: note.value, corrected_state: st.value, corrected_damage_code: dm.value }); } }, 'Corregir'),
        h('button', { type: 'button', onclick: () => { if (!note.value.trim()) return toast('Escribe el motivo del rechazo.', 'error'); review(f, 'rechazar', { note: note.value }); } }, 'Rechazar'));
    }
    if (canApprove && f.validation === 'HUMAN_REVIEWED') acts.append(h('button', { type: 'button', class: 'primary', onclick: async () => {
      try { await db(supabase.from('findings').update({ validation: 'APPROVED' }).eq('id', f.id)); toast('Hallazgo aprobado.'); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'Aprobar'));
    return h('div', { class: 'row-card col' },
      h('div', null, h('strong', null, (pn[f.part_code] || f.part_code || 'Pieza sin definir') + ' · ' + (dn[f.damage_code] || f.damage_code || 'Daño sin definir')), ' ',
        badge('Estado ' + f.state, 'ai'), ' ', badge({ AI_GENERATED: 'Generado por IA', HUMAN_REVIEWED: 'Revisado', APPROVED: 'Aprobado' }[f.validation], f.validation === 'APPROVED' ? 'ok' : f.validation === 'AI_GENERATED' ? 'warn' : ''),
        f.confidence_label ? ' ' : null, f.confidence_label ? badge('Confianza ' + f.confidence_label) : null,
        h('div', { class: 'muted' }, 'Placa ' + (f.parking_sessions?.plate || '—') + ' · ' + fmtDate(f.created_at))),
      acts, h('a', { class: 'btn', href: '#/mesa/' + f.session_id }, 'Ver en la mesa'));
  };
  const draw = async () => {
    const fresh = await db(supabase.from('findings').select('id,session_id,part_code,damage_code,state,validation,confidence_label,confidence,created_at,parking_sessions(plate)').eq('site_id', ctx.site.id).order('created_at', { ascending: false }).limit(80));
    rows.splice(0, rows.length, ...fresh); paint();
  };
  const paint = () => { const r = rows.filter((f) => filter === 'todas' || f.validation === filter); list.replaceChildren(...(r.length ? r.map(card) : [empty('No hay hallazgos con este filtro. Regístralos desde la mesa de comparación.')])); };
  const fsel = select([['todas', 'Todos'], ['AI_GENERATED', 'Generados por IA'], ['HUMAN_REVIEWED', 'Revisados'], ['APPROVED', 'Aprobados']], 'todas', { 'aria-label': 'Filtro', onchange: (e) => { filter = e.target.value; paint(); } });
  box.replaceChildren(h('div', { class: 'toolbar' }, fsel), list); paint();
}

async function claims(box) {
  const canReview = can(...REVIEW);
  const rows = await db(supabase.from('claims').select('id,session_id,claimant_name,description,status,opened_at,closed_at,parking_sessions(plate)').eq('site_id', ctx.site.id).order('opened_at', { ascending: false }).limit(60));
  const list = h('div', { class: 'list' }, rows.length ? rows.map((c) => {
    const st = select([['abierta', 'Abierta'], ['en_revision', 'En revisión'], ['cerrada', 'Cerrada']], c.status, { disabled: !canReview, 'aria-label': 'Estado', onchange: async (e) => {
      try {
        await db(supabase.from('claims').update({ status: e.target.value, closed_at: e.target.value === 'cerrada' ? new Date().toISOString() : null }).eq('id', c.id));
        await db(supabase.from('claim_events').insert({ org_id: ctx.org.id, site_id: ctx.site.id, claim_id: c.id, event_type: 'estado', detail: { de: c.status, a: e.target.value }, actor: ctx.user.id }));
        c.status = e.target.value; toast('Estado actualizado.');
      } catch (err) { toast(err.message, 'error'); }
    } });
    return h('div', { class: 'row-card' }, h('div', null, h('strong', { class: 'plate' }, c.parking_sessions?.plate || '—'), ' ' + (c.claimant_name || 'Sin nombre'), h('div', { class: 'muted' }, fmtDate(c.opened_at)), h('p', null, c.description || '')),
      h('div', { class: 'actions' }, st, h('a', { class: 'btn', href: '#/mesa/' + c.session_id }, 'Comparar')));
  }) : [empty('No hay reclamaciones.')]);
  const form = () => {
    if (!can('operador', 'valet', ...REVIEW)) return null;
    const ses = select([], '', { 'aria-label': 'Sesión' }), who = h('input', { placeholder: 'Nombre de quien reclama' }), desc = h('textarea', { rows: 3, placeholder: 'Qué reclama' });
    db(supabase.from('parking_sessions').select('id,plate,entered_at').eq('site_id', ctx.site.id).order('entered_at', { ascending: false }).limit(60)).then((s) => ses.replaceChildren(...s.map((x) => h('option', { value: x.id }, x.plate + ' · ' + fmtDate(x.entered_at)))));
    const btn = h('button', { type: 'submit', class: 'primary' }, 'Abrir reclamación');
    return h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); if (!ses.value) return; btn.disabled = true;
      try { await db(supabase.from('claims').insert({ org_id: ctx.org.id, site_id: ctx.site.id, session_id: ses.value, claimant_name: who.value.trim() || null, description: desc.value.trim() || null, created_by: ctx.user.id })); toast('Reclamación abierta.'); location.reload(); }
      catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    } }, h('h3', null, 'Nueva reclamación'), field('Sesión', ses), field('Reclamante', who), field('Descripción', desc), h('div', { class: 'row' }, btn));
  };
  box.replaceChildren(...[form(), list].filter(Boolean));
}
