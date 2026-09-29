import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/* Contexto compartido: usuario, organización, sedes y roles vigentes en la sede activa */
export const ctx = { user: null, org: null, sites: [], site: null, memberships: [], roles: new Set() };
export const can = (...roles) => roles.some((r) => ctx.roles.has(r));
export const OPERATIVE = ['operador', 'valet', 'revisor', 'supervisor', 'admin'];
export const REVIEW = ['revisor', 'supervisor', 'admin'];

/* Constructor de nodos DOM. Nunca usa innerHTML: todo texto entra como textContent. */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

/* Consulta a Supabase: lanza el error para tratarlo en un solo lugar */
export async function db(query) {
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return count != null && data == null ? count : data;
}

export function toast(text, kind = 'good') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, text);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

export const fmtDate = (s) => s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* URLs firmadas del bucket privado, con caché en memoria */
const urlCache = new Map();
export async function signedUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !urlCache.has(p)))];
  if (need.length) {
    const { data, error } = await supabase.storage.from('evidence').createSignedUrls(need, 3600);
    if (error) throw new Error(error.message);
    data.forEach((d) => { if (d.signedUrl) urlCache.set(d.path, d.signedUrl); });
  }
  return (p) => urlCache.get(p) || null;
}

export function badge(text, kind) { return h('span', { class: 'tag ' + (kind || '') }, text); }
export function empty(text) { return h('p', { class: 'empty' }, text); }
export function field(label, input) { return h('label', { class: 'fld' }, h('span', null, label), input); }
export function select(options, value, attrs) {
  const s = h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return s;
}

/* Diálogo modal accesible: Esc cierra, foco atrapado de forma sencilla */
export function openModal(title, body, { wide = false } = {}) {
  const prev = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const closeBtn = h('button', { type: 'button', class: 'icon', 'aria-label': 'Cerrar', onclick: close }, '✕');
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), closeBtn), body));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
  return { close };
}

export const roleLabel = { operador: 'Operador', valet: 'Valet', revisor: 'Revisor', supervisor: 'Supervisor', auditor: 'Auditor', perito: 'Perito', admin: 'Administrador' };
export const ROLES = Object.keys(roleLabel);
export const STATES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];
