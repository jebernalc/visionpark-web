import { supabase, ctx, h, db, toast, roleLabel } from './lib.js';
import { APP_VERSION } from './config.js';
import panel from './screens/panel.js';
import sesiones from './screens/sesiones.js';
import captura from './screens/captura.js';
import mesa from './screens/mesa.js';
import hallazgos from './screens/hallazgos.js';
import prompts from './screens/prompts.js';
import motor from './screens/motor.js';
import equipo from './screens/equipo.js';
import auditoria from './screens/auditoria.js';

const $ = (id) => document.getElementById(id);
const SCREENS = [panel, sesiones, captura, mesa, hallazgos, prompts, motor, auditoria, equipo];
$('version').textContent = 'v' + APP_VERSION; $('version2').textContent = 'v' + APP_VERSION;

/* ---------- Acceso ---------- */
function say(el, text, kind) { el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : ''); }
const authMsg = $('auth-msg'), appMsg = $('app-msg');
const PENDING_KEY = 'vp_pending_org';
let mode = 'login';
const REDIRECT = location.origin + location.pathname;

function store(op, v) {
  try { if (op === 'set') localStorage.setItem(PENDING_KEY, v); else if (op === 'del') localStorage.removeItem(PENDING_KEY); else return localStorage.getItem(PENDING_KEY); } catch { /* almacenamiento bloqueado */ }
  return null;
}
function setMode(m) {
  mode = m;
  const reset = m === 'reset';
  for (const [id, k] of [['tab-login', 'login'], ['tab-owner', 'owner'], ['tab-team', 'team']]) $(id).setAttribute('aria-selected', String(k === (reset ? 'login' : m)));
  $('owner-fields').hidden = m !== 'owner';
  $('pw-wrap').hidden = reset;
  $('password').required = !reset;
  $('link-row').hidden = m !== 'login';
  $('back-row').hidden = !reset;
  $('acc-help').hidden = true;
  $('btn-login').textContent = { login: 'Ingresar', owner: 'Crear cuenta de propietario', team: 'Crear mi cuenta', reset: 'Enviarme el enlace' }[m];
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-hint').textContent = { login: 'Ingresa con tu correo y contraseña.',
    owner: 'El propietario crea la organización y queda como administrador. Recibirás un correo para confirmar la cuenta.',
    team: 'Crea tu cuenta y avisa a tu administrador: él te agrega a la organización con tu correo y tu rol.',
    reset: 'Escribe el correo de tu cuenta y te enviamos un enlace para crear una contraseña nueva.' }[m];
  say(authMsg, ''); $('btn-resend').hidden = true;
}
$('tab-login').addEventListener('click', () => setMode('login'));
$('tab-owner').addEventListener('click', () => setMode('owner'));
$('tab-team').addEventListener('click', () => setMode('team'));
$('link-forgot-pw').addEventListener('click', () => setMode('reset'));
$('link-back').addEventListener('click', () => setMode('login'));
$('link-forgot-acc').addEventListener('click', () => { $('acc-help').hidden = !$('acc-help').hidden; });
$('btn-acc-to-pw').addEventListener('click', () => { setMode('reset'); $('email').focus(); });
$('btn-rec-out').addEventListener('click', () => { recovering = false; supabase.auth.signOut(); });
$('btn-show').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('btn-show').textContent = show ? 'Ocultar' : 'Mostrar';
  $('btn-show').setAttribute('aria-pressed', String(show));
});

function friendly(error) {
  const m = (error.message || '').toLowerCase();
  if (error.code === 'over_email_send_rate_limit' || m.includes('rate limit')) return mode === 'reset'
    ? 'Se alcanzó el límite de correos por hora del servicio de correo gratuito. No se perdió nada: espera unos 60 minutos antes de pedir otro enlace, o ingresa con tu contraseña actual (o la temporal que te dio el administrador).'
    : 'Se alcanzó el límite de correos por hora del servicio de correo gratuito. Espera unos 60 minutos y usa «Reenviar correo de confirmación».';
  if (m.includes('email not confirmed')) return 'Tu correo aún no está confirmado. Abre el enlace que te enviamos o reenvíalo.';
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos, o la cuenta aún no está confirmada.';
  if (m.includes('already registered')) return 'Ese correo ya tiene cuenta. Usa «Ingresar».';
  if (m.includes('same password') || m.includes('different from the old')) return 'La nueva contraseña debe ser distinta de la anterior.';
  if (m.includes('weak') || m.includes('pwned') || m.includes('easy to guess')) return 'Esa contraseña es muy débil o aparece en filtraciones conocidas. Usa otra más larga.';
  return error.message;
}
function credentials() {
  const email = $('email').value.trim(), password = $('password').value;
  if (!email || password.length < 8) { say(authMsg, 'Escribe un correo válido y una contraseña de al menos 8 caracteres.', 'error'); return null; }
  return { email, password };
}
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (mode === 'reset') return sendReset();
  const cred = credentials(); if (!cred) return;
  const btn = $('btn-login'); btn.disabled = true;
  try {
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword(cred);
      if (error) { if (/confirm/i.test(error.message)) $('btn-resend').hidden = false; return say(authMsg, friendly(error), 'error'); }
      return say(authMsg, '');
    }
    if (mode === 'owner') {
      const org = $('org-name').value.trim();
      if (org.length < 2) return say(authMsg, 'Escribe el nombre de la organización.', 'error');
      store('set', JSON.stringify({ org, site: $('site-name').value.trim() || 'Sede principal' }));
    } else store('del');
    const { data, error } = await supabase.auth.signUp({ ...cred, options: { emailRedirectTo: REDIRECT } });
    if (error) { $('btn-resend').hidden = false; return say(authMsg, friendly(error), 'error'); }
    if (data.user && data.user.identities && data.user.identities.length === 0) return say(authMsg, 'Ese correo ya tiene cuenta. Usa «Ingresar».', 'error');
    if (!data.session) {
      $('btn-resend').hidden = false;
      say(authMsg, mode === 'owner' ? 'Cuenta creada. Revisa tu correo (y spam), confirma y vuelve a ingresar: la organización se creará sola.' : 'Cuenta creada. Confirma tu correo, ingresa y avisa a tu administrador.', 'good');
    }
  } finally { btn.disabled = false; }
});
async function sendReset() {
  const email = $('email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return say(authMsg, 'Escribe el correo de tu cuenta.', 'error');
  const btn = $('btn-login'); btn.disabled = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT });
    if (error) return say(authMsg, friendly(error), 'error');
    say(authMsg, 'Si ese correo tiene cuenta, te llegará un enlace en unos minutos. Revisa también spam. El enlace vence pronto y sirve una sola vez.', 'good');
  } finally { btn.disabled = false; }
}
$('btn-resend').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return say(authMsg, 'Escribe tu correo primero.', 'error');
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: REDIRECT } });
  say(authMsg, error ? friendly(error) : 'Correo reenviado. Revisa tu bandeja y spam.', error ? 'error' : 'good');
});
const logout = () => supabase.auth.signOut();
$('btn-logout').addEventListener('click', logout);
$('top-logout').addEventListener('click', logout);

async function createOrg(name, site) {
  const { error } = await supabase.rpc('bootstrap_org', { p_name: name, p_site_name: site });
  if (error) { say(appMsg, 'No se pudo crear la organización: ' + error.message, 'error'); return false; }
  store('del'); return true;
}
$('btn-bootstrap').addEventListener('click', async () => {
  $('btn-bootstrap').disabled = true;
  if (await createOrg('Mi organización', 'Sede principal')) await boot();
  $('btn-bootstrap').disabled = false;
});

/* ---------- Contexto y navegación ---------- */
const siteSelect = $('site-select');
function computeRoles() {
  ctx.roles = new Set(ctx.memberships.filter((m) => m.site_id == null || m.site_id === ctx.site?.id).map((m) => m.role));
}
const allowed = (s) => s.roles == null || s.roles.some((r) => ctx.roles.has(r));

function drawNav() {
  const nav = $('nav'); const cur = (location.hash.split('/')[1] || 'panel');
  nav.replaceChildren(...SCREENS.filter((s) => !s.hidden && allowed(s)).map((s) => h('a', { href: '#/' + s.id, 'aria-current': s.id === cur ? 'page' : null }, s.title)));
}
async function route() {
  if (!ctx.site) return;
  const [, id = 'panel', param] = location.hash.split('/');
  let screen = SCREENS.find((s) => s.id === id) || panel;
  if (!allowed(screen)) { toast('Tu rol no tiene acceso a esa sección.', 'error'); screen = panel; }
  drawNav();
  const root = h('div', { class: 'screen' });
  $('view').replaceChildren(root);
  try { await screen.render(root, param); } catch (e) { root.append(h('p', { class: 'msg error' }, 'No se pudo cargar: ' + e.message)); }
  $('view').focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
document.addEventListener('vp-sites-changed', () => loadSites().then(route));
siteSelect.addEventListener('change', () => {
  ctx.site = ctx.sites.find((s) => s.id === siteSelect.value); computeRoles();
  try { sessionStorage.setItem('vp_site', ctx.site.id); } catch { /* sin almacenamiento */ }
  route();
});
async function loadSites() {
  ctx.sites = await db(supabase.from('sites').select('id,name,address').eq('org_id', ctx.org.id).order('created_at'));
  let saved = null; try { saved = sessionStorage.getItem('vp_site'); } catch { /* sin almacenamiento */ }
  ctx.site = ctx.sites.find((s) => s.id === (ctx.site?.id || saved)) || ctx.sites[0] || null;
  siteSelect.replaceChildren(...ctx.sites.map((s) => h('option', { value: s.id, selected: s.id === ctx.site?.id }, s.name)));
  siteSelect.hidden = ctx.sites.length < 2;
  computeRoles();
}

async function boot() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  ctx.user = user;
  $('who').textContent = user.email;
  if (user.app_metadata?.must_change_password) {
    recovering = true;
    $('rec-hint').textContent = 'Entraste con una contraseña temporal. Por seguridad, define ahora una contraseña propia de al menos 8 caracteres para continuar.';
    $('btn-rec-out').hidden = false;
    return show('recovery');
  }
  let rows;
  try { rows = await db(supabase.from('user_sites').select('site_id, role, org_id, organizations(id,name)').eq('user_id', user.id)); }
  catch (e) { return show('onboard', 'Error leyendo tu acceso: ' + e.message, 'error'); }
  if (!rows.length) {
    const raw = store('get');
    if (raw) { try { const p = JSON.parse(raw); if (await createOrg(p.org, p.site)) return boot(); } catch { store('del'); } }
    $('btn-bootstrap').hidden = false;
    $('owner-note').hidden = false;
    $('owner-note').textContent = 'Aún no perteneces a ninguna organización. Si eres el propietario, créala aquí. Si eres del equipo, pide a tu administrador que te agregue con este correo.';
    return show('onboard');
  }
  ctx.memberships = rows; ctx.org = rows[0].organizations;
  await loadSites();
  if (!ctx.site) return show('onboard', 'Tu organización no tiene sedes o no tienes acceso a ninguna.', 'error');
  $('top-who').textContent = user.email;
  show('app');
  if (!location.hash || location.hash === '#') location.hash = '#/panel'; else route();
}
function show(which, msg, kind) {
  $('auth-shell').hidden = which === 'app';
  $('app').hidden = which !== 'app';
  $('auth-card').hidden = which !== 'auth';
  $('recovery-card').hidden = which !== 'recovery';
  $('app-card').hidden = which !== 'onboard';
  if (msg) say(appMsg, msg, kind);
}

let recovering = false;
$('recovery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('new-pw').value, p2 = $('new-pw2').value, msg = $('rec-msg');
  if (p1.length < 8) return say(msg, 'La contraseña debe tener al menos 8 caracteres.', 'error');
  if (p1 !== p2) return say(msg, 'Las dos contraseñas no coinciden.', 'error');
  $('btn-newpw').disabled = true;
  const { error } = await supabase.auth.updateUser({ password: p1 });
  $('btn-newpw').disabled = false;
  if (error) return say(msg, friendly(error), 'error');
  recovering = false; $('new-pw').value = $('new-pw2').value = ''; $('btn-rec-out').hidden = true;
  await supabase.auth.refreshSession();
  toast('Contraseña actualizada.');
  boot();
});

/* Errores que Supabase devuelve en la dirección (enlace vencido o ya usado) */
{
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (p.get('error')) {
    const expired = /expired|otp/i.test((p.get('error_code') || '') + (p.get('error_description') || ''));
    history.replaceState(null, '', location.pathname);
    say(authMsg, expired ? 'El enlace venció o ya se usó. Pide otro con «Olvidé mi contraseña».' : 'No se pudo validar el enlace: ' + (p.get('error_description') || p.get('error')), 'error');
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; $('rec-hint').textContent = 'Escribe una contraseña nueva de al menos 8 caracteres.'; show('recovery'); return; }
  if (recovering || event === 'USER_UPDATED') return;
  if (!session) { ctx.user = null; ctx.org = null; ctx.site = null; show('auth'); return; }
  if (event === 'TOKEN_REFRESHED' || (event === 'SIGNED_IN' && ctx.user?.id === session.user.id && !$('app').hidden)) return;
  setTimeout(boot, 0); // evita bloqueos dentro del callback de auth
});
