'use strict';

const { sql } = require('../lib/db');

function displayName(claims) {
  const full = [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  return String(claims.name || full || claims.preferred_username || (claims.email || '').split('@')[0] || 'Música').slice(0, 120);
}

async function upsertUser(claims) {
  const email = String(claims.email || '').slice(0, 200);
  const name = displayName(claims);
  const rows = await sql`
    INSERT INTO users (sub, email, name) VALUES (${claims.sub}, ${email}, ${name})
    ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login = now()
    RETURNING id, sub, email, name`;
  const u = rows[0];
  return { id: Number(u.id), sub: u.sub, email: u.email, name: u.name, emailVerified: claims.email_verified === true };
}

module.exports = { upsertUser };
