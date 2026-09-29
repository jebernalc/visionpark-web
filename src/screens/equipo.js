import { supabase, ctx, h, db, toast, badge, empty, field, select, roleLabel, ROLES } from '../lib.js';

export default {
  id: 'equipo', title: 'Equipo y sedes', roles: ['admin'],
  async render(root) {
    const members = h('div', { class: 'list' }), sites = h('div', { class: 'list' });
    const email = h('input', { type: 'email', placeholder: 'correo@ejemplo.com', autocomplete: 'off' });
    const role = select(ROLES.map((r) => [r, roleLabel[r]]), 'operador');
    const siteSel = select([['', 'Todas las sedes']], '');
    const loadSites = async () => {
      const rows = await db(supabase.from('sites').select('id,name,address').eq('org_id', ctx.org.id).order('created_at'));
      ctx.sites = rows;
      siteSel.replaceChildren(...[['', 'Todas las sedes'], ...rows.map((s) => [s.id, s.name])].map(([v, l]) => h('option', { value: v }, l)));
      sites.replaceChildren(...rows.map((s) => h('div', { class: 'row-card' }, h('div', null, h('strong', null, s.name), h('div', { class: 'muted' }, s.address || 'Sin dirección')))));
    };
    const loadMembers = async () => {
      const rows = await db(supabase.rpc('list_members'));
      members.replaceChildren(...(rows.length ? rows.map((m) => {
        const btn = h('button', { type: 'button', onclick: async () => {
          if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = 'Confirmar'; return; }
          try { await db(supabase.rpc('remove_member', { p_id: m.id })); toast('Miembro quitado.'); loadMembers(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Quitar');
        return h('div', { class: 'row-card' }, h('div', null, h('strong', null, m.email), ' ', badge(roleLabel[m.role]), ' ', badge(m.site_name || 'Todas las sedes')), btn);
      }) : [empty('Sin miembros.')]));
    };
    const addBtn = h('button', { type: 'submit', class: 'primary' }, 'Agregar miembro');
    const sName = h('input', { maxLength: 120, placeholder: 'Nombre de la sede' }), sAddr = h('input', { maxLength: 200, placeholder: 'Dirección (opcional)' });
    root.append(
      h('h2', null, 'Equipo y sedes'),
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault(); if (!email.value.trim()) return; addBtn.disabled = true;
        try { await db(supabase.rpc('add_member', { p_email: email.value.trim(), p_role: role.value, p_site: siteSel.value || null })); toast('Miembro agregado.'); email.value = ''; loadMembers(); }
        catch (err) { toast(err.message, 'error'); } finally { addBtn.disabled = false; }
      } }, h('h3', null, 'Agregar miembro'),
        h('p', { class: 'muted' }, 'La persona debe crear antes su cuenta en la pestaña «Soy del equipo» de la pantalla de acceso. Luego la agregas aquí con su correo y su rol.'),
        h('div', { class: 'grid3' }, field('Correo', email), field('Rol', role), field('Sede', siteSel)), h('div', { class: 'row' }, addBtn)),
      h('div', { class: 'card' }, h('h3', null, 'Miembros'), members),
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault(); if (!sName.value.trim()) return;
        try { await db(supabase.from('sites').insert({ org_id: ctx.org.id, name: sName.value.trim(), address: sAddr.value.trim() || null })); sName.value = sAddr.value = ''; toast('Sede creada.'); loadSites(); document.dispatchEvent(new Event('vp-sites-changed')); }
        catch (err) { toast(err.message, 'error'); }
      } }, h('h3', null, 'Sedes'), sites, h('div', { class: 'grid2' }, field('Nueva sede', sName), field('Dirección', sAddr)), h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Crear sede'))));
    await Promise.all([loadSites(), loadMembers()]);
  }
};
