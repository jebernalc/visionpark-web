import { supabase, ctx, h, db, can, signedUrls, badge, empty, fmtDate, OPERATIVE } from '../lib.js';
import { openViewer } from '../viewer.js';
import { reportButton } from '../report.js';

export default {
  id: 'mesa', title: 'Mesa de comparación', roles: null,
  async render(root, param, claimId) {
    if (!param) {
      const rows = await db(supabase.from('parking_sessions').select('id,plate,status,entered_at').eq('site_id', ctx.site.id).order('entered_at', { ascending: false }).limit(40));
      root.append(h('h2', null, 'Mesa de comparación'), h('p', { class: 'muted' }, 'Elige la sesión que quieres comparar (ingreso frente a salida y, si hay reclamación, sus fotos).'),
        h('div', { class: 'list' }, rows.length ? rows.map((s) => h('a', { class: 'row-card', href: '#/mesa/' + s.id }, h('div', null, h('strong', { class: 'plate' }, s.plate), h('div', { class: 'muted' }, fmtDate(s.entered_at))), badge(s.status === 'abierta' ? 'Abierta' : 'Cerrada', s.status === 'abierta' ? 'ok' : ''))) : [empty('Aún no hay sesiones.')]));
      return;
    }
    const session = await db(supabase.from('parking_sessions').select('*').eq('id', param).eq('site_id', ctx.site.id).maybeSingle());
    if (!session) { root.append(empty('Sesión no encontrada en esta sede.')); return; }
    const claim = claimId ? await db(supabase.from('claims').select('*').eq('id', claimId).eq('session_id', session.id).maybeSingle()) : null;
    const [views, caps, parts, damages, prompts, cviews] = await Promise.all([
      db(supabase.from('canonical_views').select('*').order('sort_order')),
      db(supabase.from('capture_views').select('phase,view_code,quality,usable,evidence_id,created_at,evidence_files(storage_path,sha256_client,captured_at)').eq('session_id', session.id).order('created_at')),
      db(supabase.from('vehicle_parts').select('code,name').order('name')),
      db(supabase.from('damage_types').select('code,name').order('name')),
      db(supabase.from('prompt_library').select('id,title,template,scope').eq('active', true).order('title')),
      claim ? db(supabase.from('claim_views').select('view_code,evidence_id,note,created_at,evidence_files(storage_path,sha256_client,captured_at)').eq('claim_id', claim.id).not('view_code', 'is', null).order('created_at')) : Promise.resolve([])
    ]);
    const latest = new Map(caps.map((c) => [c.phase + ':' + c.view_code, c]));
    const claimBy = new Map(); cviews.forEach((c) => claimBy.set(c.view_code, [...(claimBy.get(c.view_code) || []), c]));
    const urlOf = await signedUrls([...caps, ...cviews].map((c) => c.evidence_files?.storage_path));
    const thumb = (rec, label) => rec ? h('img', { src: urlOf(rec.evidence_files?.storage_path), alt: label, loading: 'lazy' }) : h('div', { class: 'ph small' }, 'Sin foto');
    const three = !!claim;

    root.append(
      h('div', { class: 'toolbar' }, h('a', { class: 'btn', href: claim ? '#/reclamacion/' + claim.id : '#/sesiones' }, claim ? '← Expediente' : '← Sesiones'),
        h('h2', null, (claim ? 'Reclamación · ' : 'Comparación · '), h('span', { class: 'plate' }, session.plate)),
        h('a', { class: 'btn', href: '#/captura/' + session.id, hidden: !can(...OPERATIVE) }, 'Capturar'),
        reportButton({ session, claim })),
      h('p', { class: 'muted' }, 'Toca cualquier cuadrícula para abrir el visor: comparación lado a lado, cortina o diferencia, herramientas de imagen (brillo, contraste, gamma, nitidez, bordes…), marcado de zona, análisis de visión digital y preguntas al motor. La IA propone; una persona decide.'),
      h('div', { class: 'cgrid' + (three ? ' three' : '') }, views.map((v) => {
        const a = latest.get('ingreso:' + v.code), b = latest.get('salida:' + v.code), c = claimBy.get(v.code) || [];
        return h('button', { type: 'button', class: 'ccell', onclick: () => openViewer({ session, view: v, recs: { ingreso: a || null, salida: b || null, reclamacion: c }, urlOf, parts, damages, prompts, claim }), 'aria-label': 'Revisar ' + v.name },
          h('div', { class: 'pair' + (three ? ' p3' : '') }, thumb(a, 'Ingreso ' + v.name), thumb(b, 'Salida ' + v.name), ...(three ? [thumb(c[0], 'Reclamación ' + v.name)] : [])),
          h('span', { class: 'vname' }, v.code + ' · ' + v.name),
          h('span', { class: 'pairtag' + (three ? ' p3' : '') }, h('em', null, 'Ingreso'), h('em', null, 'Salida'), ...(three ? [h('em', null, 'Reclamación')] : [])));
      })));
  }
};
