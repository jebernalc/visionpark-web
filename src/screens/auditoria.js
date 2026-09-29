import { supabase, ctx, h, db, empty, fmtDate, badge } from '../lib.js';

export default {
  id: 'auditoria', title: 'Auditoría', roles: ['auditor', 'supervisor', 'admin'],
  async render(root) {
    const rows = await db(supabase.from('audit_log').select('id,actor,action,table_name,row_id,prev_hash,hash,created_at').eq('org_id', ctx.org.id).order('id', { ascending: false }).limit(100));
    const asc = [...rows].reverse();
    let linked = 0, broken = 0;
    for (let i = 1; i < asc.length; i++) if (asc[i].id === asc[i - 1].id + 1) { if (asc[i].prev_hash === asc[i - 1].hash) linked++; else broken++; }
    root.append(h('h2', null, 'Auditoría'),
      h('p', { class: 'muted' }, 'Registro de solo inserción: cada línea incluye la huella de la anterior, así que alterar una rompe la cadena.'),
      h('div', { class: 'card' }, broken ? badge(broken + ' eslabones no coinciden: revisar de inmediato', 'bad') : badge(linked + ' eslabones consecutivos verificados', 'ok')),
      h('div', { class: 'tablewrap' }, rows.length ? h('table', null,
        h('thead', null, h('tr', null, ['#', 'Fecha', 'Acción', 'Tabla', 'Huella'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, String(r.id)), h('td', null, fmtDate(r.created_at)), h('td', null, r.action), h('td', null, r.table_name || '—'), h('td', { class: 'mono' }, r.hash.slice(0, 12) + '…'))))) : empty('Aún no hay registros.')));
  }
};
