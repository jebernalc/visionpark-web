import { supabase, ctx, h, db, can, toast, badge, empty, field, select } from '../lib.js';

const SCOPES = [['imagen', 'Imagen'], ['panel', 'Panel'], ['caja', 'Zona marcada'], ['expediente', 'Expediente'], ['similares', 'Casos similares']];
const STARTERS = [
  ['Rayones nuevos', 'imagen', 'Compara la vista {vista} entre ingreso y salida. ¿Hay rayones que no estaban al ingreso? Si no estás segura, abstente y dilo.'],
  ['Abolladuras nuevas', 'imagen', 'En la vista {vista}, ¿aparecen abolladuras nuevas respecto al ingreso? Indica la ubicación aproximada y tu nivel de confianza.'],
  ['Zona marcada', 'caja', 'Analiza solo la zona marcada de la vista {vista}. Describe el daño, su severidad y si ya existía al ingreso.'],
  ['Calidad de la foto', 'imagen', '¿La foto de la vista {vista} es suficiente para una comparación forense (nitidez, luz, encuadre)? Si no, indica cómo repetirla.'],
  ['Casos similares', 'similares', 'Busca casos aprobados parecidos a esta vista {vista} y resume cómo se resolvieron.']
];

export default {
  id: 'prompts', title: 'Prompts', roles: null,
  async render(root) {
    const canEdit = can('supervisor', 'admin');
    const list = h('div', { class: 'list' });
    let editing = null;
    const title = h('input', { maxLength: 120, placeholder: 'Título' }), scope = select(SCOPES, 'imagen'), tpl = h('textarea', { rows: 4, maxLength: 4000, placeholder: 'Plantilla. Usa {vista} para insertar el nombre de la vista.' });
    const btn = h('button', { type: 'submit', class: 'primary' }, 'Guardar prompt');
    const load = async () => {
      const rows = await db(supabase.from('prompt_library').select('*').eq('org_id', ctx.org.id).order('title'));
      list.replaceChildren(...(rows.length ? rows.map((p) => h('div', { class: 'row-card' },
        h('div', null, h('strong', null, p.title), ' ', badge(SCOPES.find((s) => s[0] === p.scope)?.[1] || p.scope), ' ', badge('v' + p.version), ' ', badge(p.active ? 'Activo' : 'Inactivo', p.active ? 'ok' : 'warn'), h('p', { class: 'muted' }, p.template), h('small', { class: 'muted' }, p.uses + ' usos')),
        canEdit ? h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: () => { editing = p; title.value = p.title; scope.value = p.scope; tpl.value = p.template; btn.textContent = 'Guardar cambios (v' + (p.version + 1) + ')'; title.focus(); } }, 'Editar'),
          h('button', { type: 'button', onclick: async () => { try { await db(supabase.from('prompt_library').update({ active: !p.active }).eq('id', p.id)); load(); } catch (e) { toast(e.message, 'error'); } } }, p.active ? 'Desactivar' : 'Activar')) : null))
        : [empty('La biblioteca está vacía.'), canEdit ? h('button', { type: 'button', class: 'primary', onclick: async () => {
          try { await db(supabase.from('prompt_library').insert(STARTERS.map(([t, s, x]) => ({ org_id: ctx.org.id, title: t, scope: s, template: x, approved_by: ctx.user.id })))); toast('Prompts iniciales cargados.'); load(); } catch (e) { toast(e.message, 'error'); } } }, 'Cargar 5 prompts iniciales') : null]));
    };
    root.append(h('h2', null, 'Biblioteca de prompts'), h('p', { class: 'muted' }, 'Plantillas que se usan al preguntar sobre cada imagen. Cada edición sube la versión; supervisores y administradores las aprueban.'));
    if (canEdit) root.append(h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); if (!title.value.trim() || !tpl.value.trim()) return toast('Completa título y plantilla.', 'error'); btn.disabled = true;
      try {
        if (editing) await db(supabase.from('prompt_library').update({ title: title.value.trim(), scope: scope.value, template: tpl.value.trim(), version: editing.version + 1, approved_by: ctx.user.id }).eq('id', editing.id));
        else await db(supabase.from('prompt_library').insert({ org_id: ctx.org.id, title: title.value.trim(), scope: scope.value, template: tpl.value.trim(), approved_by: ctx.user.id }));
        editing = null; title.value = tpl.value = ''; btn.textContent = 'Guardar prompt'; toast('Prompt guardado.'); load();
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    } }, h('h3', null, 'Nuevo o editar'), field('Título', title), field('Alcance', scope), field('Plantilla', tpl), h('div', { class: 'row' }, btn)));
    root.append(list); await load();
  }
};
