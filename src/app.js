import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_VERSION } from './config.js';

const $ = (id) => document.getElementById(id);
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
$('version').textContent = 'v' + APP_VERSION;

/* ---------- Compatibilidad: mejora progresiva ---------- */
function webglOk() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
const checks = [
  { name: 'Cámara', ok: !!navigator.mediaDevices?.getUserMedia, need: true },
  { name: 'Hash SHA-256 en origen', ok: !!globalThis.crypto?.subtle, need: true },
  { name: 'Cola offline (IndexedDB)', ok: 'indexedDB' in globalThis, need: true },
  { name: 'Service Worker (app instalable)', ok: 'serviceWorker' in navigator, need: false },
  { name: 'WebGPU (IA en el navegador)', ok: 'gpu' in navigator, need: false, fallback: 'WebGL2 o WASM' },
  { name: 'WebGL2', ok: webglOk(), need: false, fallback: 'WASM' },
  { name: 'WebAssembly', ok: typeof WebAssembly === 'object', need: true }
];
const compat = $('compat');
for (const c of checks) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = c.name;
  const tag = document.createElement('span');
  tag.className = 'tag ' + (c.ok ? 'ok' : c.need ? 'bad' : 'warn');
  tag.textContent = c.ok ? 'Disponible' : c.need ? 'Falta' : (c.fallback ? 'Respaldo: ' + c.fallback : 'Opcional');
  li.append(label, tag);
  compat.append(li);
}

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
  const owner = m === 'owner';
  $('tab-login').setAttribute('aria-selected', String(!owner));
  $('tab-owner').setAttribute('aria-selected', String(owner));
  $('owner-fields').hidden = !owner;
  $('btn-login').textContent = owner ? 'Crear cuenta de propietario' : 'Ingresar';
  $('password').autocomplete = owner ? 'new-password' : 'current-password';
  $('auth-hint').textContent = owner
    ? 'El propietario crea la organización y queda como administrador. Recibirás un correo para confirmar la cuenta.'
    : 'Ingresa con tu correo y contraseña.';
  say(authMsg, '');
  $('btn-resend').hidden = true;
}
$('tab-login').addEventListener('click', () => setMode('login'));
$('tab-owner').addEventListener('click', () => setMode('owner'));

function friendly(error) {
  const m = (error.message || '').toLowerCase();
  if (error.code === 'over_email_send_rate_limit' || m.includes('rate limit')) return 'Se enviaron demasiados correos. Espera unos minutos y usa «Reenviar correo de confirmación».';
  if (m.includes('email not confirmed')) return 'Tu correo aún no está confirmado. Abre el enlace que te enviamos o reenvíalo.';
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos, o la cuenta aún no está confirmada.';
  if (m.includes('already registered')) return 'Ese correo ya tiene cuenta. Usa «Ingresar».';
  return error.message;
}

function credentials() {
  const email = $('email').value.trim(), password = $('password').value;
  if (!email || password.length < 8) { say(authMsg, 'Escribe un correo válido y una contraseña de al menos 8 caracteres.', 'error'); return null; }
  return { email, password };
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cred = credentials(); if (!cred) return;
  const btn = $('btn-login'); btn.disabled = true;
  try {
    if (mode === 'owner') {
      const org = $('org-name').value.trim();
      if (org.length < 2) return say(authMsg, 'Escribe el nombre de la organización.', 'error');
      store('set', JSON.stringify({ org, site: $('site-name').value.trim() || 'Sede principal' }));
      const { data, error } = await supabase.auth.signUp({ ...cred, options: { emailRedirectTo: REDIRECT } });
      if (error) { $('btn-resend').hidden = false; return say(authMsg, friendly(error), 'error'); }
      if (data.user && data.user.identities && data.user.identities.length === 0) return say(authMsg, 'Ese correo ya tiene cuenta. Usa «Ingresar».', 'error');
      if (!data.session) {
        $('btn-resend').hidden = false;
        say(authMsg, 'Cuenta creada. Revisa tu correo (y spam), confirma y vuelve a ingresar: la organización se creará sola.', 'good');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword(cred);
      if (error) { if (/confirm/i.test(error.message)) $('btn-resend').hidden = false; return say(authMsg, friendly(error), 'error'); }
      say(authMsg, '');
    }
  } finally { btn.disabled = false; }
});

$('btn-resend').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return say(authMsg, 'Escribe tu correo primero.', 'error');
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: REDIRECT } });
  say(authMsg, error ? friendly(error) : 'Correo reenviado. Revisa tu bandeja y spam.', error ? 'error' : 'good');
});

$('btn-logout').addEventListener('click', () => supabase.auth.signOut());

async function createOrg(name, site) {
  const { error } = await supabase.rpc('bootstrap_org', { p_name: name, p_site_name: site });
  if (error) { say(appMsg, 'No se pudo crear la organización: ' + error.message, 'error'); return false; }
  store('del');
  say(appMsg, 'Organización creada. Eres administrador.', 'good');
  return true;
}

$('btn-bootstrap').addEventListener('click', async () => {
  $('btn-bootstrap').disabled = true;
  await createOrg('Mi organización', 'Sede principal');
  $('btn-bootstrap').disabled = false;
  await loadApp();
});

/* ---------- Datos protegidos por RLS ---------- */
async function loadApp() {
  const { data: { user } } = await supabase.auth.getUser();
  $('who').textContent = user?.email ?? '—';
  const { data: rows, error } = await supabase.from('user_sites').select('role, organizations(name)').limit(1);
  if (error) return say(appMsg, 'Error leyendo la organización: ' + error.message, 'error');
  const has = rows && rows.length > 0;
  $('btn-bootstrap').hidden = has;
  $('owner-note').hidden = has;
  if (!has) {
    const raw = store('get');
    if (raw) {
      try { const p = JSON.parse(raw); if (await createOrg(p.org, p.site)) return loadApp(); } catch { store('del'); }
    }
  }
  $('org').textContent = has ? rows[0].organizations?.name ?? '—' : 'Sin organización';
  $('role').textContent = has ? rows[0].role : '—';
  if (has) {
    const { count } = await supabase.from('parking_sessions').select('id', { count: 'exact', head: true });
    $('sessions').textContent = String(count ?? 0);
    say(appMsg, '');
  } else {
    $('sessions').textContent = '—';
    say(appMsg, 'Aún no perteneces a ninguna organización.');
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  $('auth-card').hidden = !!session;
  $('app-card').hidden = !session;
  if (session) setTimeout(loadApp, 0); // evita bloqueos dentro del callback de auth
});
