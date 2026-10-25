'use strict';

// Borrado fiable de objetos del almacenamiento y limpieza de subidas que no terminaron.
// Un objeto pendiente de borrar sigue contando como espacio ocupado hasta que R2 confirma el borrado,
// así el tope de 9 GB se respeta aunque R2 falle un momento.

const { sql } = require('./db');
const storage = require('./storage');

// Dentro de una transacción: apunta los objetos para borrarlos (antes de borrar sus filas).
async function queueDeletion(tx, files) {
  const rows = files.filter((f) => f && f.storage_key).map((f) => ({ storage_key: f.storage_key, size: Number(f.size) || 0 }));
  if (!rows.length) return;
  await tx`INSERT INTO pending_deletions ${tx(rows)} ON CONFLICT (storage_key) DO NOTHING`;
}

let running = false;
async function processDeletions() {
  if (running) return;
  running = true;
  try {
    const rows = await sql`SELECT storage_key FROM pending_deletions ORDER BY attempts, created_at LIMIT 100`;
    for (const r of rows) {
      try {
        await storage.remove(r.storage_key);
        await sql`DELETE FROM pending_deletions WHERE storage_key = ${r.storage_key}`;
      } catch (err) {
        await sql`UPDATE pending_deletions SET attempts = attempts + 1 WHERE storage_key = ${r.storage_key}`;
        console.error('No se pudo borrar del almacenamiento (se reintentará):', err.message);
      }
    }
  } finally {
    running = false;
  }
}

// Subidas reservadas hace más de una hora que nunca se confirmaron.
async function expireStaleUploads() {
  await sql.begin(async (tx) => {
    const stale = await tx`SELECT id, storage_key, size FROM files WHERE status = 'pending' AND created_at < now() - interval '1 hour' FOR UPDATE SKIP LOCKED`;
    if (!stale.length) return;
    await queueDeletion(tx, stale);
    await tx`DELETE FROM files WHERE id IN ${tx(stale.map((s) => s.id))}`;
  });
}

function start() {
  const run = () => expireStaleUploads().then(processDeletions).catch((err) => console.error('Limpieza:', err.message));
  setTimeout(run, 5000).unref();
  setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = { queueDeletion, processDeletions, expireStaleUploads, start };
