'use strict';

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta la variable DATABASE_URL');
  process.exit(1);
}

const SCHEMA = 'ensaya';

// La URL interna de Render no usa TLS; la externa (*.render.com) sí lo exige.
const useSsl = process.env.DATABASE_SSL === 'true' || /\.render\.com/.test(connectionString);

const sql = postgres(connectionString, {
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX || 5),
  idle_timeout: 30,
  connection: { search_path: SCHEMA, application_name: 'ensaya' },
  onnotice: () => {},
  transform: { undefined: null },
  // Los id son bigint; en esta app nunca pasan de 2^53, así que los leemos como número.
  types: {
    bigint: { to: 20, from: [20], parse: (v) => Number(v), serialize: (v) => String(v) },
  },
});

async function migrate() {
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await sql.unsafe(ddl);
}

module.exports = { sql, migrate, SCHEMA };
