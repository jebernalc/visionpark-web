import { supabase, ctx, h, db, can, roleLabel } from '../lib.js';

function webglOk() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }
const checks = () => [
  { name: 'Cámara', ok: !!navigator.mediaDevices?.getUserMedia, need: true },
  { name: 'Hash SHA-256 en origen', ok: !!globalThis.crypto?.subtle, need: true },
  { name: 'Cola offline (IndexedDB)', ok: 'indexedDB' in globalThis, need: true },
  { name: 'Service Worker (app instalable)', ok: 'serviceWorker' in navigator, need: false },
  { name: 'WebGPU (IA en el navegador)', ok: 'gpu' in navigator, need: false, fallback: 'WebGL2 o WASM' },
  { name: 'WebGL2', ok: webglOk(), need: false, fallback: 'WASM' },
  { name: 'WebAssembly', ok: typeof WebAssembly === 'object', need: true }
];

export default {
  id: 'panel', title: 'Panel', roles: null,
  async render(root) {
    const sid = ctx.site.id;
    const count = (t, f) => { let q = supabase.from(t).select('id', { count: 'exact', head: true }).eq('site_id', sid); q = f ? f(q) : q; return db(q).catch(() => '—'); };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [abiertas, hoy, sinRevisar, pendientes, reclamos] = await Promise.all([
      count('parking_sessions', (q) => q.eq('status', 'abierta')),
      count('parking_sessions', (q) => q.gte('entered_at', today.toISOString())),
      count('findings', (q) => q.eq('validation', 'AI_GENERATED')),
      count('inference_jobs', (q) => q.eq('status', 'pendiente')),
      count('claims', (q) => q.neq('status', 'cerrada'))
    ]);
    const kpi = (label, value, href) => h('a', { class: 'kpi', href }, h('strong', null, String(value)), h('span', null, label));
    root.append(
      h('h2', null, 'Panel de ' + ctx.site.name),
      h('div', { class: 'kpis' },
        kpi('Sesiones abiertas', abiertas, '#/sesiones'),
        kpi('Ingresos de hoy', hoy, '#/sesiones'),
        kpi('Hallazgos por revisar', sinRevisar, '#/hallazgos'),
        kpi('Reclamaciones abiertas', reclamos, '#/hallazgos'),
        kpi('Análisis en cola', pendientes, '#/motor')),
      h('div', { class: 'card' },
        h('h3', null, 'Tu acceso'),
        h('p', { class: 'muted' }, 'Rol en esta sede: ' + [...ctx.roles].map((r) => roleLabel[r]).join(', ') + '. Los originales son inmutables; toda edición es una copia derivada.')),
      h('div', { class: 'card' },
        h('h3', null, 'Compatibilidad de este navegador'),
        h('ul', { class: 'compat' }, checks().map((c) => h('li', null, h('span', null, c.name),
          h('span', { class: 'tag ' + (c.ok ? 'ok' : c.need ? 'bad' : 'warn') },
            c.ok ? 'Disponible' : c.need ? 'Falta' : c.fallback ? 'Respaldo: ' + c.fallback : 'Opcional'))))));
  }
};
