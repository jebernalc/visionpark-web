import { supabase, ctx, h, db, can, OPERATIVE, toast, fmtDate, badge, empty, field, select } from '../lib.js';

const PLATE = /^[A-Z0-9]{3,8}$/;

export default {
  id: 'sesiones', title: 'Sesiones', roles: null,
  async render(root) {
    const canCreate = can(...OPERATIVE);
    let filter = 'abierta', q = '';
    const list = h('div', { class: 'list' });
    const load = async () => {
      let query = supabase.from('parking_sessions').select('id,plate,modality,status,entered_at,exited_at,coverage_in,coverage_out')
        .eq('site_id', ctx.site.id).order('entered_at', { ascending: false }).limit(60);
      if (filter !== 'todas') query = query.eq('status', filter);
      if (q) query = query.ilike('plate', '%' + q + '%');
      const rows = await db(query);
      list.replaceChildren(...(rows.length ? rows.map(row) : [empty('No hay sesiones con este filtro.')]));
    };
    const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
    const row = (s) => {
      const closeBtn = h('button', { type: 'button', hidden: !canCreate || s.status !== 'abierta', onclick: async () => {
        if (!closeBtn.dataset.sure) { closeBtn.dataset.sure = '1'; closeBtn.textContent = 'Confirmar salida'; return; }
        try {
          await db(supabase.from('parking_sessions').update({ status: 'cerrada', exited_at: new Date().toISOString() }).eq('id', s.id));
          toast('Salida registrada. Captura las 24 vistas de salida.'); location.hash = '#/captura/' + s.id;
        } catch (e) { toast(e.message, 'error'); }
      } }, 'Registrar salida');
      return h('div', { class: 'row-card' },
        h('div', null, h('strong', { class: 'plate' }, s.plate), ' ', badge(s.modality === 'valet' ? 'Valet' : 'Autoservicio'), ' ',
          badge(s.status === 'abierta' ? 'Abierta' : 'Cerrada', s.status === 'abierta' ? 'ok' : ''),
          h('div', { class: 'muted' }, 'Ingreso ' + fmtDate(s.entered_at) + (s.exited_at ? ' · Salida ' + fmtDate(s.exited_at) : '')),
          h('div', { class: 'muted' }, 'Cobertura ingreso ' + pct(s.coverage_in) + ' · salida ' + pct(s.coverage_out))),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: '#/captura/' + s.id, hidden: !canCreate }, 'Capturar'),
          h('a', { class: 'btn', href: '#/mesa/' + s.id }, 'Comparar'),
          closeBtn));
    };

    if (canCreate) {
      const plate = h('input', { maxLength: 8, autocomplete: 'off', placeholder: 'ABC123', style: 'text-transform:uppercase' });
      const mod = select([['autoservicio', 'Autoservicio'], ['valet', 'Valet']], 'autoservicio');
      const btn = h('button', { type: 'submit', class: 'primary' }, 'Registrar ingreso');
      root.append(h('form', { class: 'card inline-form', onsubmit: async (e) => {
        e.preventDefault();
        const p = plate.value.trim().toUpperCase().replace(/[\s-]/g, '');
        if (!PLATE.test(p)) return toast('Placa no válida (3 a 8 letras o números).', 'error');
        btn.disabled = true;
        try {
          let veh = await db(supabase.from('vehicles').select('id').eq('org_id', ctx.org.id).eq('plate', p).maybeSingle());
          if (!veh) veh = await db(supabase.from('vehicles').insert({ org_id: ctx.org.id, plate: p }).select('id').single());
          const dup = await db(supabase.from('parking_sessions').select('id').eq('site_id', ctx.site.id).eq('plate', p).eq('status', 'abierta').maybeSingle());
          if (dup) { toast('Esa placa ya tiene una sesión abierta.', 'error'); location.hash = '#/captura/' + dup.id; return; }
          const s = await db(supabase.from('parking_sessions').insert({ org_id: ctx.org.id, site_id: ctx.site.id, vehicle_id: veh.id, plate: p, modality: mod.value, operator_id: ctx.user.id }).select('id').single());
          toast('Ingreso registrado. Captura las 24 vistas.'); location.hash = '#/captura/' + s.id;
        } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
      } }, h('h3', null, 'Nuevo ingreso'), h('div', { class: 'grid2' }, field('Placa', plate), field('Modalidad', mod)), h('div', { class: 'row' }, btn)));
    }

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtro' }, [['abierta', 'Abiertas'], ['cerrada', 'Cerradas'], ['todas', 'Todas']].map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(v === filter), onclick: (e) => { filter = v; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); load(); } }, l)));
    const search = h('input', { type: 'search', placeholder: 'Buscar placa', 'aria-label': 'Buscar placa', oninput: (e) => { q = e.target.value.trim().toUpperCase(); clearTimeout(search._t); search._t = setTimeout(load, 300); } });
    root.append(h('div', { class: 'toolbar' }, seg, search), list);
    await load();
  }
};
