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

async function credentials() {
  const email = $('email').value.trim(), password = $('password').value;
  if (!email || password.length < 8) { say(authMsg, 'Escribe un correo válido y una contraseña de al menos 8 caracteres.', 'error'); return null; }
  return { email, password };
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cred = await credentials(); if (!cred) return;
  $('btn-login').disabled = true;
  const { error } = await supabase.auth.signInWithPassword(cred);
  $('btn-login').disabled = false;
  say(authMsg, error ? 'No se pudo ingresar: ' + error.message : '', error ? 'error' : '');
});

$('btn-signup').addEventListener('click', async () => {
  const cred = await credentials(); if (!cred) return;
  const { data, error } = await supabase.auth.signUp(cred);
  if (error) return say(authMsg, 'No se pudo crear la cuenta: ' + error.message, 'error');
  say(authMsg, data.session ? 'Cuenta creada.' : 'Cuenta creada. Confirma tu correo y luego ingresa.', 'good');
});

$('btn-logout').addEventListener('click', () => supabase.auth.signOut());

$('btn-bootstrap').addEventListener('click', async () => {
  $('btn-bootstrap').disabled = true;
  const { error } = await supabase.rpc('bootstrap_org', { p_name: 'Mi organización', p_site_name: 'Sede principal' });
  $('btn-bootstrap').disabled = false;
  if (error) return say(appMsg, 'No se pudo crear la organización: ' + error.message, 'error');
  say(appMsg, 'Organización creada. Eres administrador.', 'good');
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
