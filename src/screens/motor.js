import { supabase, ctx, h, db, badge, empty, fmtDate } from '../lib.js';

export default {
  id: 'motor', title: 'Motor IA', roles: ['revisor', 'supervisor', 'admin', 'perito', 'auditor'],
  async render(root) {
    const box = h('div');
    const btn = h('button', { type: 'button', onclick: () => draw() }, 'Actualizar');
    root.append(h('div', { class: 'toolbar' }, h('h2', null, 'Motor de IA y aprendizaje'), btn), box);
    const draw = async () => {
      const cnt = (t, f) => db(f(supabase.from(t).select('id', { count: 'exact', head: true }))).catch(() => 0);
      const [models, jobs, reviews, ev, ds, pend, proc, err, done, accept, corr, rej, queries] = await Promise.all([
        db(supabase.from('model_registry').select('*').order('created_at', { ascending: false })),
        db(supabase.from('inference_jobs').select('id,task,status,attempts,error,created_at,finished_at').eq('site_id', ctx.site.id).order('created_at', { ascending: false }).limit(15)),
        Promise.resolve(), db(supabase.from('learning_events').select('id,kind,detail,created_at').order('created_at', { ascending: false }).limit(15)),
        db(supabase.from('dataset_versions').select('*').order('created_at', { ascending: false }).limit(5)),
        ...['pendiente', 'procesando', 'error', 'completado'].map((s) => cnt('inference_jobs', (q) => q.eq('site_id', ctx.site.id).eq('status', s))),
        ...['aceptar', 'corregir', 'rechazar'].map((d) => cnt('finding_reviews', (q) => q.eq('site_id', ctx.site.id).eq('decision', d))),
        cnt('ai_queries', (q) => q.eq('site_id', ctx.site.id))
      ]);
      const total = accept + corr + rej, kpi = (l, v) => h('div', { class: 'kpi static' }, h('strong', null, String(v)), h('span', null, l));
      box.replaceChildren(
        h('div', { class: 'kpis' }, kpi('Análisis en cola', pend), kpi('Procesando', proc), kpi('Completados', done), kpi('Con error', err), kpi('Consultas hechas', queries)),
        h('div', { class: 'card' }, h('h3', null, 'Ciclo que aprende con validación humana'),
          h('p', { class: 'muted' }, total ? `De ${total} revisiones humanas: ${accept} aceptadas, ${corr} corregidas y ${rej} rechazadas (${Math.round(accept / total * 100)}% de acuerdo). Cada corrección se convierte en una etiqueta validada para el siguiente reentrenamiento.` : 'Aún no hay revisiones humanas. Cada aceptación, corrección o rechazo de un hallazgo alimenta el aprendizaje.'),
          h('p', { class: 'muted' }, 'Un modelo nuevo solo pasa a producción si supera las pruebas de calidad y una persona lo aprueba; siempre se puede volver al anterior.')),
        h('div', { class: 'card' }, h('h3', null, 'Modelos registrados'),
          models.length ? models.map((m) => h('div', { class: 'row-card' }, h('div', null, h('strong', null, m.name + ' ' + m.version), ' ', badge(m.status, m.status === 'campeon' ? 'ok' : 'warn'), h('div', { class: 'muted' }, m.task + ' · licencia ' + (m.license || '—')))))
            : empty('Todavía no hay modelos. El servidor GPU privado (repositorio visionpark-ai) los registrará como «retador»; ninguno se activa sin aprobación humana.')),
        h('div', { class: 'card' }, h('h3', null, 'Últimos trabajos de análisis'),
          jobs.length ? jobs.map((j) => h('div', { class: 'row-card' }, h('div', null, h('strong', null, j.task), ' ', badge(j.status, j.status === 'completado' ? 'ok' : j.status === 'error' ? 'bad' : 'warn'), h('div', { class: 'muted' }, fmtDate(j.created_at) + (j.error ? ' · ' + j.error : '')))))
            : empty('Sin trabajos. Aparecen al subir fotos en la captura.')),
        h('div', { class: 'card' }, h('h3', null, 'Historial de aprendizaje'),
          ev.length ? ev.map((e) => h('div', { class: 'row-card' }, h('div', null, h('strong', null, e.kind), h('div', { class: 'muted' }, fmtDate(e.created_at))))) : empty('Sin eventos de aprendizaje todavía.'),
          ds.length ? h('p', { class: 'muted' }, 'Versiones de datos: ' + ds.map((d) => d.version + ' (' + d.n_cases + ' casos)').join(', ')) : null));
    };
    await draw();
  }
};
