'use strict';

// Envío de invitaciones con la Admin REST API de Keycloak.
//
// Keycloak no trae "magic links" de serie, pero sí el email de "acciones requeridas"
// (execute-actions-email): un enlace firmado, de un solo uso y con caducidad que el
// propio Keycloak envía con el SMTP del realm. Lo usamos como enlace mágico:
// - Si la persona no tiene cuenta, la creamos y el enlace le pide nombre y contraseña.
// - Si ya la tiene, el enlace solo confirma su email.
// Al terminar, Keycloak la devuelve a /invitaciones/<token> de la app.

const { ISSUER, CLIENT_ID, CLIENT_SECRET, fetchJson, discovery } = require('./oidc');

const ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || CLIENT_SECRET;
const ADMIN_BASE = ISSUER.replace('/realms/', '/admin/realms/');

let tokenCache = { token: null, exp: 0 };

function isConfigured() {
  return Boolean(ISSUER && ADMIN_CLIENT_ID && ADMIN_CLIENT_SECRET);
}

async function adminToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 30000) return tokenCache.token;
  const meta = await discovery();
  const body = await fetchJson(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ADMIN_CLIENT_ID,
      client_secret: ADMIN_CLIENT_SECRET,
    }),
  });
  tokenCache = { token: body.access_token, exp: Date.now() + (body.expires_in || 60) * 1000 };
  return tokenCache.token;
}

class KeycloakAdminError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function adminFetch(pathAndQuery, { method = 'GET', body } = {}) {
  const token = await adminToken();
  const res = await fetch(`${ADMIN_BASE}${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new KeycloakAdminError(
        'La app no tiene permiso para gestionar usuarios en Keycloak. Activa "Service accounts" en el cliente y dale los roles manage-users y view-users de realm-management.',
        res.status
      );
    }
    const detail = (json && (json.errorMessage || json.error_description || json.error)) || `HTTP ${res.status}`;
    throw new KeycloakAdminError(detail, res.status);
  }
  return { status: res.status, json, headers: res.headers };
}

async function findUserByEmail(email) {
  const { json } = await adminFetch(`/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`);
  const target = email.toLowerCase();
  return (json || []).find((u) => String(u.email || '').toLowerCase() === target) || null;
}

async function createUser(email) {
  try {
    const { headers } = await adminFetch('/users', {
      method: 'POST',
      body: { username: email, email, enabled: true, emailVerified: false },
    });
    const location = headers.get('location') || '';
    const id = location.split('/').pop();
    if (id) return { id, email, emailVerified: false, firstName: '' };
  } catch (err) {
    if (err.status !== 409) throw err;
  }
  return findUserByEmail(email);
}

async function sendActionsEmail(userId, actions, redirectUri, lifespanSeconds) {
  const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, lifespan: String(lifespanSeconds) });
  try {
    await adminFetch(`/users/${encodeURIComponent(userId)}/execute-actions-email?${params}`, { method: 'PUT', body: actions });
  } catch (err) {
    if (err.status === 500) {
      throw new KeycloakAdminError('Keycloak no pudo enviar el email. Revisa la configuración SMTP del realm (Realm settings → Email).', 500);
    }
    if (err.status === 400 && /redirect/i.test(err.message)) {
      throw new KeycloakAdminError('Keycloak rechazó la URL de vuelta. Añade la URL de la app con /* a las "Valid redirect URIs" del cliente.', 400);
    }
    throw err;
  }
}

// Envía (o reenvía) el enlace de invitación. Devuelve { newUser }.
async function sendInvitationLink(email, redirectUri, lifespanSeconds) {
  if (!isConfigured()) {
    throw new KeycloakAdminError('El envío de emails con Keycloak no está configurado.', 503);
  }
  let user = await findUserByEmail(email);
  let newUser = false;
  if (!user) {
    user = await createUser(email);
    newUser = true;
  }
  if (!user || !user.id) throw new KeycloakAdminError('No se pudo crear la cuenta en Keycloak.', 500);
  if (user.enabled === false) throw new KeycloakAdminError('La cuenta de esa persona está desactivada en Keycloak.', 400);

  // Sin contraseña todavía (cuenta nueva o invitada antes y sin terminar) → que la cree.
  let needsPassword = newUser;
  if (!needsPassword) {
    const { json } = await adminFetch(`/users/${encodeURIComponent(user.id)}/credentials`);
    needsPassword = !(json || []).some((c) => c.type === 'password');
  }
  const actions = [];
  if (needsPassword) actions.push('UPDATE_PROFILE', 'UPDATE_PASSWORD');
  actions.push('VERIFY_EMAIL');
  await sendActionsEmail(user.id, actions, redirectUri, lifespanSeconds);
  return { newUser: needsPassword };
}

// ¿Tiene esta cuenta (sub = id de Keycloak) el email verificado ahora mismo?
async function isEmailVerified(userId, email) {
  if (!isConfigured()) return false;
  const { json } = await adminFetch(`/users/${encodeURIComponent(userId)}`);
  return Boolean(json && json.emailVerified && String(json.email || '').toLowerCase() === String(email).toLowerCase());
}

module.exports = { isConfigured, sendInvitationLink, isEmailVerified, KeycloakAdminError };
