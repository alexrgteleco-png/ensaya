'use strict';

const { sql } = require('../lib/db');
const { HttpError } = require('../lib/http');
const { loginUrl } = require('../lib/oidc');

function parseId(value) {
  return /^\d{1,15}$/.test(String(value)) ? Number(value) : null;
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// Texto de formulario recortado y limitado.
function str(value, max = 200) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function intOrNull(value, min, max) {
  const v = str(value, 10);
  if (!v) return null;
  if (!/^-?\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (n < min || n > max) return undefined;
  return n;
}

function wantsJson(req) {
  return String(req.headers.accept || '').includes('application/json') || req.path.startsWith('/api/');
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  if (wantsJson(req)) throw new HttpError(401, 'Tu sesión ha caducado. Vuelve a entrar.');
  return res.redirect(loginUrl(req), 302);
}

// Carga el grupo de :gid y comprueba que la persona es miembro.
async function loadGroup(req, res, next) {
  if (!req.session.user) return requireLogin(req, res, next);
  const gid = parseId(req.params.gid);
  if (!gid) throw new HttpError(404, 'Grupo no encontrado');
  const rows = await sql`
    SELECT g.*, m.role_label
    FROM groups g JOIN memberships m ON m.group_id = g.id AND m.user_id = ${req.session.user.id}
    WHERE g.id = ${gid}`;
  if (!rows.length) {
    const exists = await sql`SELECT 1 FROM groups WHERE id = ${gid}`;
    if (exists.length) throw new HttpError(403, 'No eres miembro de este grupo. Pide a quien lo creó que te invite.');
    throw new HttpError(404, 'Grupo no encontrado');
  }
  const group = rows[0];
  req.group = group;
  req.isOwner = Number(group.owner_id) === Number(req.session.user.id);
  res.ctx.group = group;
  res.ctx.isOwner = req.isOwner;
  return next();
}

// Solo quien creó el grupo.
function requireOwner(req, res, next) {
  if (!req.isOwner) throw new HttpError(403, 'Solo quien creó el grupo puede hacer esto.');
  return next();
}

async function loadSong(req, id) {
  const sid = parseId(id);
  if (!sid) throw new HttpError(404, 'Canción no encontrada');
  const rows = await sql`SELECT * FROM songs WHERE id = ${sid} AND group_id = ${req.group.id}`;
  if (!rows.length) throw new HttpError(404, 'Canción no encontrada');
  return rows[0];
}

async function loadFile(req, id) {
  const fid = parseId(id);
  if (!fid) throw new HttpError(404, 'Archivo no encontrado');
  const rows = await sql`SELECT * FROM files WHERE id = ${fid} AND group_id = ${req.group.id} AND status = 'ready'`;
  if (!rows.length) throw new HttpError(404, 'Archivo no encontrado');
  return rows[0];
}

function canDelete(req, createdBy) {
  return req.isOwner || Number(createdBy) === Number(req.session.user.id);
}

module.exports = { parseId, flash, str, intOrNull, wantsJson, requireLogin, loadGroup, requireOwner, loadSong, loadFile, canDelete };
