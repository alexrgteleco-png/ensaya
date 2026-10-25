'use strict';

// Sesiones guardadas en PostgreSQL con cookie firmada (HMAC).
// La sesión se guarda justo antes de enviar la respuesta, así una redirección
// nunca llega antes de que la sesión esté escrita.

const crypto = require('crypto');
const { sql } = require('./db');

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'sid';

function createSessionMiddleware({ secret, secure }) {
  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

  function unsign(cookie) {
    if (typeof cookie !== 'string') return null;
    const i = cookie.lastIndexOf('.');
    if (i <= 0) return null;
    const value = cookie.slice(0, i);
    const mac = Buffer.from(cookie.slice(i + 1));
    const expected = Buffer.from(sign(value));
    if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
    return value;
  }

  // Limpieza periódica de sesiones caducadas.
  setInterval(() => {
    sql`DELETE FROM sessions WHERE expires < now()`.catch(() => {});
  }, 60 * 60 * 1000).unref();

  return async function session(req, res, next) {
    let sid = unsign(req.cookies[COOKIE]);
    let data = {};
    let expires = null;
    if (sid) {
      const rows = await sql`SELECT data, expires FROM sessions WHERE sid = ${sid} AND expires > now()`;
      if (rows.length) {
        data = rows[0].data || {};
        expires = rows[0].expires;
      } else {
        sid = null;
      }
    }
    let original = JSON.stringify(data);
    let destroyed = false;
    let oldSid = null;

    req.session = data;
    req.sessionStore = {
      regenerate() {
        oldSid = sid;
        sid = null;
        req.session = {};
        original = '{}';
      },
      destroy() {
        destroyed = true;
        oldSid = sid;
        req.session = {};
      },
    };

    async function persist() {
      if (destroyed) {
        if (oldSid) await sql`DELETE FROM sessions WHERE sid = ${oldSid}`;
        res.cookie(COOKIE, '', { maxAge: 0, secure });
        return;
      }
      if (oldSid) await sql`DELETE FROM sessions WHERE sid = ${oldSid}`;
      const json = JSON.stringify(req.session);
      const empty = json === '{}';
      if (!sid && empty) return;
      const stale = !expires || new Date(expires).getTime() - Date.now() < MAX_AGE_MS - 24 * 60 * 60 * 1000;
      if (sid && json === original && !stale) return;
      if (!sid) sid = crypto.randomBytes(32).toString('base64url');
      const newExpires = new Date(Date.now() + MAX_AGE_MS);
      await sql`
        INSERT INTO sessions (sid, data, expires) VALUES (${sid}, ${sql.json(req.session)}, ${newExpires})
        ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires`;
      res.cookie(COOKIE, `${sid}.${sign(sid)}`, { maxAge: MAX_AGE_MS, secure });
    }

    let saving = null;
    req.saveSession = () => {
      if (!saving) saving = persist();
      return saving;
    };

    for (const method of ['html', 'json', 'redirect', 'text']) {
      const original = res[method];
      res[method] = (...args) =>
        req
          .saveSession()
          .catch((err) => console.error('No se pudo guardar la sesión:', err.message))
          .then(() => original(...args));
    }
    await next();
  };
}

module.exports = { createSessionMiddleware };
