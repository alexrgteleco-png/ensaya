'use strict';

// Topes para que la app nunca genere costes:
// - Almacenamiento total: como máximo 9 GB (10^9 bytes) entre todos los grupos. El plan gratuito de R2 da 10 GB.
// - Operaciones de R2 al mes: por debajo del plan gratuito (1 millón de clase A y 10 millones de clase B).
// - Tráfico de salida de Render al mes: tope propio, porque el ancho de banda gratuito se comparte entre todas las apps.
// Las variables de entorno solo pueden BAJAR estos topes, nunca subirlos.

const { sql } = require('./db');
const { HttpError } = require('./http');

const GB = 1e9;
const MB = 1e6;

function capped(envName, def, hardMax, unit = 1) {
  const raw = Number(process.env[envName]);
  const value = Number.isFinite(raw) && raw > 0 ? raw * unit : def;
  return Math.min(value, hardMax);
}

const LIMITS = {
  storageBytes: capped('STORAGE_LIMIT_GB', 9 * GB, 9 * GB, GB),
  r2ClassA: capped('R2_CLASS_A_LIMIT', 800000, 800000),
  r2ClassB: capped('R2_CLASS_B_LIMIT', 8000000, 8000000),
  renderEgressBytes: capped('RENDER_EGRESS_LIMIT_MB', 1500 * MB, 4000 * MB, MB),
};

class LimitError extends HttpError {
  constructor(message) {
    super(503, message);
    this.limit = true;
  }
}

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

// Suma n a un contador mensual solo si no pasa del tope. Devuelve true si se pudo.
async function consume(metric, n, limit) {
  const month = monthKey();
  const rows = await sql`
    INSERT INTO usage_counters (month, metric, value) VALUES (${month}, ${metric}, ${n})
    ON CONFLICT (month, metric) DO UPDATE SET value = usage_counters.value + ${n}
      WHERE usage_counters.value + ${n} <= ${limit}
    RETURNING value`;
  if (!rows.length) return false;
  if (rows[0].value > limit) {
    // Primera inserción del mes con n mayor que el tope (no debería pasar).
    await sql`UPDATE usage_counters SET value = value - ${n} WHERE month = ${month} AND metric = ${metric}`;
    return false;
  }
  return true;
}

async function useClassA(n = 1) {
  if (!(await consume('r2_class_a', n, LIMITS.r2ClassA))) {
    throw new LimitError('Este mes ya no se pueden subir más archivos: se ha alcanzado el tope de operaciones gratuitas del almacenamiento. Vuelve a intentarlo el día 1.');
  }
}

async function useClassB(n = 1) {
  if (!(await consume('r2_class_b', n, LIMITS.r2ClassB))) {
    throw new LimitError('Este mes se ha alcanzado el tope de descargas gratuitas del almacenamiento. Los archivos vuelven a estar disponibles el día 1.');
  }
}

// Bytes ocupados ahora: archivos (también subidas en curso) + objetos pendientes de borrar.
async function storageUsed(tx = sql) {
  const [r] = await tx`
    SELECT (SELECT COALESCE(sum(size), 0) FROM files)::bigint + (SELECT COALESCE(sum(size), 0) FROM pending_deletions)::bigint AS used`;
  return Number(r.used);
}

// Reserva espacio de forma atómica y crea la fila del archivo en estado 'pending'.
async function reserveStorage(row) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(724242)`;
    const used = await storageUsed(tx);
    if (used + row.size > LIMITS.storageBytes) {
      const free = Math.max(0, LIMITS.storageBytes - used);
      throw new HttpError(
        507,
        `No queda espacio: la app tiene un tope de ${formatGB(LIMITS.storageBytes)} para no generar costes y quedan ${formatGB(free)} libres. Borra audios que ya no uséis o comprímelos (por ejemplo, a MP3).`
      );
    }
    const [inserted] = await tx`INSERT INTO files ${tx({ ...row, status: 'pending' })} RETURNING *`;
    return inserted;
  });
}

function formatGB(bytes) {
  if (bytes < GB) return `${Math.round(bytes / MB)} MB`;
  return `${(bytes / GB).toFixed(bytes < 10 * GB ? 2 : 1).replace('.', ',')} GB`;
}

// ---------- Tráfico de salida de Render ----------
let egressPending = 0;
let egressMonth = monthKey();
let egressTotal = 0;

function addEgress(bytes) {
  egressPending += bytes;
}

async function flushEgress() {
  const month = monthKey();
  if (month !== egressMonth) {
    egressMonth = month;
    egressTotal = 0;
  }
  const n = egressPending;
  egressPending = 0;
  try {
    const rows = await sql`
      INSERT INTO usage_counters (month, metric, value) VALUES (${month}, 'render_egress', ${n})
      ON CONFLICT (month, metric) DO UPDATE SET value = usage_counters.value + ${n}
      RETURNING value`;
    egressTotal = Number(rows[0].value);
  } catch (err) {
    egressPending += n;
  }
}

function egressExceeded() {
  return egressTotal + egressPending >= LIMITS.renderEgressBytes;
}

async function usageReport() {
  const month = monthKey();
  const rows = await sql`SELECT metric, value FROM usage_counters WHERE month = ${month}`;
  const m = Object.fromEntries(rows.map((r) => [r.metric, Number(r.value)]));
  return {
    month,
    storageUsed: await storageUsed(),
    storageLimit: LIMITS.storageBytes,
    classA: m.r2_class_a || 0,
    classALimit: LIMITS.r2ClassA,
    classB: m.r2_class_b || 0,
    classBLimit: LIMITS.r2ClassB,
    egress: (m.render_egress || 0) + egressPending,
    egressLimit: LIMITS.renderEgressBytes,
  };
}

module.exports = { LIMITS, LimitError, useClassA, useClassB, reserveStorage, storageUsed, addEgress, flushEgress, egressExceeded, usageReport, formatGB, monthKey };
