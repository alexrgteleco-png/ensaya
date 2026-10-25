'use strict';

// Todas las fechas se guardan en UTC (timestamptz) y se muestran en hora de España.
const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';

const longFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const shortFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const monthTitleFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dayFormat = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, month: 'short' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parts(date) {
  return Object.fromEntries(partsFormat.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
}

function formatLong(date) {
  return cap(longFormat.format(new Date(date)));
}

function formatShort(date) {
  return cap(shortFormat.format(new Date(date)));
}

function formatTime(date) {
  return timeFormat.format(new Date(date));
}

function dayAndMonth(date) {
  const d = new Date(date);
  return { day: dayFormat.format(d), month: monthFormat.format(d).replace('.', '') };
}

// Valor para <input type="datetime-local"> en hora local.
function toInputValue(date) {
  if (!date) return '';
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function localDateKey(date) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// Diferencia (ms) entre la hora local de TZ y UTC en un instante dado.
function tzOffsetMs(date) {
  const p = parts(date);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// "2026-11-03T19:30" (hora local) → Date (UTC). null si no es válido.
function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let guess = new Date(naive - tzOffsetMs(new Date(naive)));
  guess = new Date(naive - tzOffsetMs(guess));
  return Number.isNaN(guess.getTime()) ? null : guess;
}

function monthTitle(year, month) {
  return cap(monthTitleFormat.format(new Date(Date.UTC(year, month - 1, 1))));
}

// Semanas (lunes a domingo) de un mes, como claves AAAA-MM-DD.
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - startOffset * 86400000);
  const weeks = [];
  let cursor = start;
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        key: cursor.toISOString().slice(0, 10),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor = new Date(cursor.getTime() + 86400000);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

function todayKey() {
  return localDateKey(new Date());
}

function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'ahora mismo';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatShort(date);
}

function formatDuration(totalSec) {
  if (totalSec === null || totalSec === undefined || Number.isNaN(totalSec)) return '';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// "3:45" o "225" → segundos.
function parseDuration(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d{1,5}$/.test(v)) return Number(v);
  return undefined;
}

function icsDate(date) {
  return new Date(date).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

module.exports = {
  TZ, formatLong, formatShort, formatTime, dayAndMonth, toInputValue, fromInputValue, localDateKey,
  monthTitle, monthGrid, todayKey, timeAgo, formatDuration, parseDuration, icsDate,
};
