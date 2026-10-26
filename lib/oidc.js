'use strict';

// Login con Keycloak mediante OpenID Connect (Authorization Code + PKCE).
// Sin dependencias externas: usa fetch y crypto de Node 18+.

const crypto = require('crypto');

const ISSUER = (process.env.OIDC_ISSUER || '').replace(/\/$/, '');
const CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

let discoveryCache = null;
let jwksCache = { keys: [], fetchedAt: 0 };

function isConfigured() {
  return Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no JSON de ${url} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Error de Keycloak: ${detail}`);
  }
  return body;
}

async function discovery() {
  if (!discoveryCache) {
    discoveryCache = await fetchJson(`${ISSUER}/.well-known/openid-configuration`);
  }
  return discoveryCache;
}

// En el plan gratuito de Render, Keycloak se duerme tras 15 minutos sin uso y tarda 1-2 minutos en arrancar.
// Cuando llega una visita a Ensaya, se le hace una petición en segundo plano para que vaya despertando
// y esté listo cuando la persona pulse «Entrar». Como mucho una vez cada 2 minutos.
let lastWake = 0;
function wakeIdentityProvider() {
  if (!ISSUER || Date.now() - lastWake < 2 * 60 * 1000) return;
  lastWake = Date.now();
  fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(120000) })
    .then((r) => r.arrayBuffer())
    .catch(() => {});
}

// Error de red o 5xx de Keycloak: casi siempre es que se está despertando.
function isWaking(err) {
  return /HTTP 50[234]|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|aborted|no JSON/i.test(String((err && err.message) || err));
}

async function getJwks(forceRefresh) {
  const ageMs = Date.now() - jwksCache.fetchedAt;
  if (forceRefresh || jwksCache.keys.length === 0 || ageMs > 60 * 60 * 1000) {
    const meta = await discovery();
    const body = await fetchJson(meta.jwks_uri);
    jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
  }
  return jwksCache.keys;
}

function base64url(buffer) {
  return buffer.toString('base64url');
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

const ALGORITHMS = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
};

async function verifyIdToken(idToken, expectedNonce) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('id_token mal formado');
  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  const alg = ALGORITHMS[header.alg];
  if (!alg) throw new Error(`Algoritmo de firma no admitido: ${header.alg}`);

  let jwk = (await getJwks(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('No se encontró la clave de firma del token');

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const options = { key };
  if (alg.padding) options.padding = alg.padding;
  if (alg.dsaEncoding) options.dsaEncoding = alg.dsaEncoding;
  if (!crypto.verify(alg.hash, signed, options, signature)) {
    throw new Error('Firma del id_token no válida');
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) throw new Error('Emisor del token no válido');
  if (!audiences.includes(CLIENT_ID)) throw new Error('Audiencia del token no válida');
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw new Error('Token caducado');
  if (payload.nonce !== expectedNonce) throw new Error('Nonce del token no válido');
  return payload;
}

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';
}

// Monta /login, /auth/callback y /logout.
// onLogin(claims) se llama tras un login correcto y devuelve el usuario de sesión.
function mountAuthRoutes(app, { onLogin, renderError }) {
  app.get('/login', async (req, res) => {
    if (!isConfigured()) {
      return renderError(req, res, 503, 'El login no está configurado: faltan OIDC_ISSUER, OIDC_CLIENT_ID u OIDC_CLIENT_SECRET.');
    }
    let meta;
    try {
      meta = await discovery();
    } catch (err) {
      if (!isWaking(err)) throw err;
      lastWake = 0;
      wakeIdentityProvider();
      const attempt = Math.min(30, (Number(req.query.intento) || 0) + 1);
      const retry = new URLSearchParams({ ...req.query, intento: String(attempt) });
      return renderError(
        req,
        res,
        503,
        attempt < 30
          ? 'El servicio de acceso estaba en reposo y se está despertando. Suele tardar uno o dos minutos; esta página lo vuelve a intentar sola.'
          : 'El servicio de acceso no responde. Vuelve a intentarlo en unos minutos.',
        { waking: attempt < 30, retryUrl: `/login?${retry}`, title: 'Despertando el acceso…' }
      );
    }
    const state = base64url(crypto.randomBytes(24));
    const nonce = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    req.session.oidc = { state, nonce, verifier, returnTo: safeReturnTo(req.query.returnTo) };
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (req.query.signup === '1') params.set('prompt', 'create');
    if (typeof req.query.login_hint === 'string') params.set('login_hint', req.query.login_hint.slice(0, 200));
    res.redirect(`${meta.authorization_endpoint}?${params}`, 302);
  });

  app.get('/auth/callback', async (req, res) => {
    const pending = req.session.oidc;
    if (req.query.error) {
      delete req.session.oidc;
      return res.redirect(pending ? pending.returnTo : '/');
    }
    if (!pending || req.query.state !== pending.state || typeof req.query.code !== 'string') {
      return renderError(req, res, 400, 'La sesión de login ha caducado. Vuelve a intentarlo.', { retryLogin: true });
    }
    const meta = await discovery();
    const tokens = await fetchJson(meta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: pending.verifier,
      }),
    });
    const claims = await verifyIdToken(tokens.id_token, pending.nonce);
    const user = await onLogin(claims);
    const returnTo = pending.returnTo || '/';
    req.sessionStore.regenerate();
    req.session.user = user;
    req.session.idToken = tokens.id_token;
    res.redirect(returnTo);
  });

  app.post('/logout', async (req, res) => {
    const idToken = req.session.idToken;
    req.sessionStore.destroy();
    if (!isConfigured()) return res.redirect('/');
    try {
      const meta = await discovery();
      const params = new URLSearchParams({ post_logout_redirect_uri: `${BASE_URL}/`, client_id: CLIENT_ID });
      if (idToken) params.set('id_token_hint', idToken);
      res.redirect(`${meta.end_session_endpoint}?${params}`);
    } catch {
      res.redirect('/');
    }
  });
}

function loginUrl(req) {
  let returnTo = '/';
  if (req.method === 'GET') {
    returnTo = req.originalUrl;
  } else {
    try {
      returnTo = new URL(req.headers.referer || '/', BASE_URL).pathname;
    } catch {
      returnTo = '/';
    }
  }
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

module.exports = { mountAuthRoutes, loginUrl, isConfigured, BASE_URL, ISSUER, CLIENT_ID, CLIENT_SECRET, fetchJson, discovery, wakeIdentityProvider };
