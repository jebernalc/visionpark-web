import { supabase, ctx, h, db, can, toast, badge, empty, field, select, fmtDate, STATES, REVIEW } from '../lib.js';

export default {
  id: 'hallazgos', title: 'Hallazgos', roles: ['revisor', 'supervisor', 'admin', 'perito', 'auditor'],
  async render(root) {
    const body = h('div');
    root.append(h('h2', null, 'Hallazgos'), h('p', { class: 'muted' }, 'Diferencias registradas en la mesa de comparación. Una persona las revisa y un supervisor las aprueba.'), body);
    try { await findings(body); } catch (e) { body.replaceChildren(h('p', { class: 'msg error' }, e.message)); }
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
