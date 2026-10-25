'use strict';

const crypto = require('crypto');
const { early, HttpError } = require('./http');

// CSRF: un token por sesión. Los formularios lo mandan en _csrf y las peticiones
// fetch en la cabecera X-CSRF-Token.
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const sent = req.headers['x-csrf-token'] || (req.body && req.body._csrf) || req.query._csrf;
  const expected = req.session.csrf;
  if (
    typeof sent === 'string' &&
    typeof expected === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    return next();
  }
  throw new HttpError(403, 'El formulario ha caducado. Recarga la página e inténtalo de nuevo.');
}

// El login y el logout redirigen a Keycloak desde un formulario: su origen debe estar en form-action.
let issuerOrigin = '';
try {
  issuerOrigin = new URL(process.env.OIDC_ISSUER || '').origin;
} catch {
  issuerOrigin = '';
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  // abcjs descarga los sonidos de instrumentos (soundfonts) de este dominio.
  "connect-src 'self' https://paulrosen.github.io",
  `form-action 'self' https:${issuerOrigin ? ` ${issuerOrigin}` : ''}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = early((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  next();
});

module.exports = { csrfToken, verifyCsrf, securityHeaders };
