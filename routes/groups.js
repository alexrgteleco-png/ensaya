'use strict';

const crypto = require('crypto');
const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { BASE_URL } = require('../lib/oidc');
const kc = require('../lib/keycloak-admin');
const limits = require('../lib/limits');
const storage = require('../lib/storage');
const { layout, pageHead, empty, csrfField, postButton, avatar, icon, paragraphs, STAVE } = require('../lib/ui');
const { formatShort, formatLong, timeAgo, dayAndMonth } = require('../lib/time');
const { parseId, flash, str, requireLogin, loadGroup, requireOwner } = require('./common');

const INVITE_DAYS = 7;
const ROLE_SUGGESTIONS = [
  'Voz', 'Coros', 'Guitarra', 'Guitarra eléctrica', 'Guitarra acústica', 'Bajo', 'Batería', 'Percusión', 'Teclados', 'Piano',
  'Saxo', 'Trompeta', 'Trombón', 'Violín', 'Viola', 'Violonchelo', 'Contrabajo', 'Flauta', 'Clarinete', 'Dirección', 'Técnico de sonido', 'Mánager',
];
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;

const EVENT_TYPE = { ensayo: 'Ensayo', concierto: 'Concierto', otro: 'Evento' };
const RSVP = { si: 'Voy', no: 'No voy', quizas: 'Quizás' };

function roleDatalist() {
  return html`<datalist id="roles">${ROLE_SUGGESTIONS.map((r) => html`<option value="${r}">`)}</datalist>`;
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function eventRow(e, { showGroup = false } = {}) {
  const dm = dayAndMonth(e.starts_at);
  return html`<li class="event-row event-${e.type}">
    <a href="/g/${e.group_id}/eventos/${e.id}" class="event-link">
      <span class="datebox"><b>${dm.day}</b><small>${dm.month}</small></span>
      <span class="event-main">
        <span class="event-title">${e.title}</span>
        <span class="muted">${EVENT_TYPE[e.type]} · ${formatShort(e.starts_at)}${e.location ? ` · ${e.location}` : ''}${showGroup ? ` · ${e.group_name}` : ''}</span>
      </span>
      ${e.my_status ? html`<span class="pill pill-${e.my_status}">${RSVP[e.my_status]}</span>` : html`<span class="pill pill-pending">Sin responder</span>`}
    </a>
  </li>`;
}

async function sendInvitation(invitation) {
  const redirect = `${BASE_URL}/invitaciones/${invitation.token}`;
  try {
    const { newUser } = await kc.sendInvitationLink(invitation.email, redirect, INVITE_DAYS * 24 * 3600);
    const status = `sent:${newUser ? 'new' : 'existing'}`;
    await sql`UPDATE invitations SET email_status = ${status} WHERE id = ${invitation.id}`;
    return { ok: true, newUser };
  } catch (err) {
    const message = String(err.message || 'Error desconocido').slice(0, 300);
    await sql`UPDATE invitations SET email_status = ${`error:${message}`} WHERE id = ${invitation.id}`;
    return { ok: false, message };
  }
}

module.exports = function groupRoutes(app) {
  // ---------- Portada / mis grupos ----------
  app.get('/', async (req, res) => {
    const ctx = res.ctx;
    if (!ctx.user) {
      return res.html(layout(ctx, { bodyClass: 'landing', body: landing() }));
    }
    const uid = ctx.user.id;
    const [groups, invites, events] = await Promise.all([
      sql`
        SELECT g.id, g.name, g.genre, g.owner_id, m.role_label,
          (SELECT count(*) FROM memberships WHERE group_id = g.id)::int AS members,
          (SELECT count(*) FROM songs WHERE group_id = g.id)::int AS songs,
          (SELECT min(starts_at) FROM events WHERE group_id = g.id AND starts_at >= now()) AS next_event
        FROM groups g JOIN memberships m ON m.group_id = g.id AND m.user_id = ${uid}
        ORDER BY g.name`,
      sql`
        SELECT i.token, i.role_label, g.name AS group_name, u.name AS inviter
        FROM invitations i JOIN groups g ON g.id = i.group_id JOIN users u ON u.id = i.invited_by
        WHERE lower(i.email) = lower(${ctx.user.email}) AND i.status = 'pending' AND i.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.group_id = i.group_id AND m.user_id = ${uid})
        ORDER BY i.created_at DESC`,
      sql`
        SELECT e.id, e.group_id, e.type, e.title, e.starts_at, e.location, g.name AS group_name, a.status AS my_status
        FROM events e JOIN memberships m ON m.group_id = e.group_id AND m.user_id = ${uid}
        JOIN groups g ON g.id = e.group_id
        LEFT JOIN attendance a ON a.event_id = e.id AND a.user_id = ${uid}
        WHERE e.starts_at >= now() - interval '3 hours'
        ORDER BY e.starts_at LIMIT 6`,
    ]);
    const body = html`
      ${pageHead(`Hola, ${ctx.user.name.split(' ')[0]}`, {
        lead: groups.length ? 'Tus grupos y lo próximo que tenéis.' : 'Crea tu grupo o acepta una invitación para empezar.',
        actions: html`<a class="button" href="/grupos/nuevo">${icon('plus')} Crear grupo</a>`,
      })}
      ${invites.length
        ? html`<section class="panel panel-invite">
            <h2>${icon('mail')} Invitaciones pendientes</h2>
            <ul class="plain-list">
              ${invites.map((i) => html`<li class="row-between">
                <span><b>${i.inviter}</b> te invita a <b>${i.group_name}</b>${i.role_label ? html` como <i>${i.role_label}</i>` : ''}</span>
                <a class="button button-small" href="/invitaciones/${i.token}">Ver invitación</a>
              </li>`)}
            </ul>
          </section>`
        : ''}
      <section>
        <h2>Mis grupos</h2>
        ${groups.length
          ? html`<ul class="group-grid">
              ${groups.map((g) => html`<li>
                <a class="group-card" href="/g/${g.id}">
                  ${STAVE}
                  <span class="group-card-name">${g.name}</span>
                  <span class="muted">${[g.genre, g.role_label].filter(Boolean).join(' · ') || ' '}</span>
                  <span class="group-card-stats">
                    <span>${g.members} ${g.members === 1 ? 'miembro' : 'miembros'}</span>
                    <span>${g.songs} ${g.songs === 1 ? 'canción' : 'canciones'}</span>
                    ${g.owner_id === ctx.user.id ? html`<span class="badge">Lo creaste tú</span>` : ''}
                  </span>
                  ${g.next_event ? html`<span class="group-card-next">Próximo: ${formatShort(g.next_event)}</span>` : ''}
                </a>
              </li>`)}
            </ul>`
          : empty('Todavía no estás en ningún grupo.', html`<a class="button" href="/grupos/nuevo">Crear mi grupo</a>`)}
      </section>
      ${events.length
        ? html`<section>
            <h2>Próximamente</h2>
            <ul class="event-list">${events.map((e) => eventRow(e, { showGroup: groups.length > 1 }))}</ul>
          </section>`
        : ''}`;
    res.html(layout(ctx, { title: 'Mis grupos', body }));
  });

  // ---------- Crear grupo ----------
  app.get('/grupos/nuevo', requireLogin, (req, res) => {
    res.html(layout(res.ctx, { title: 'Crear grupo', body: groupForm(res.ctx, {}, '/grupos', 'Crear grupo') }));
  });

  app.post('/grupos', requireLogin, async (req, res) => {
    const data = { name: str(req.body.name, 80), genre: str(req.body.genre, 60), description: str(req.body.description, 2000), role_label: str(req.body.role_label, 60) };
    if (!data.name) {
      return res.html(layout(res.ctx, { title: 'Crear grupo', body: groupForm(res.ctx, data, '/grupos', 'Crear grupo', 'Ponle un nombre al grupo.') }), 400);
    }
    const uid = req.session.user.id;
    const gid = await sql.begin(async (tx) => {
      const [g] = await tx`INSERT INTO groups (name, genre, description, owner_id) VALUES (${data.name}, ${data.genre}, ${data.description}, ${uid}) RETURNING id`;
      await tx`INSERT INTO memberships (group_id, user_id, role_label) VALUES (${g.id}, ${uid}, ${data.role_label})`;
      return g.id;
    });
    flash(req, 'ok', 'Grupo creado. Invita a tus compañeros desde Miembros.');
    res.redirect(`/g/${gid}`);
  });

  // ---------- Inicio del grupo ----------
  app.get('/g/:gid', loadGroup, async (req, res) => {
    const g = req.group;
    const uid = req.session.user.id;
    const [events, songs, counts, recentFiles] = await Promise.all([
      sql`
        SELECT e.*, a.status AS my_status FROM events e
        LEFT JOIN attendance a ON a.event_id = e.id AND a.user_id = ${uid}
        WHERE e.group_id = ${g.id} AND e.starts_at >= now() - interval '3 hours'
        ORDER BY e.starts_at LIMIT 4`,
      sql`SELECT id, title, artist, status, song_key, bpm FROM songs WHERE group_id = ${g.id} AND status IN ('aprendiendo', 'idea') ORDER BY updated_at DESC LIMIT 6`,
      sql`
        SELECT
          (SELECT count(*) FROM songs WHERE group_id = ${g.id})::int AS songs,
          (SELECT count(*) FROM songs WHERE group_id = ${g.id} AND status = 'lista')::int AS ready,
          (SELECT count(*) FROM memberships WHERE group_id = ${g.id})::int AS members,
          (SELECT count(*) FROM setlists WHERE group_id = ${g.id})::int AS setlists`,
      sql`
        SELECT f.id, f.kind, f.label, f.filename, f.created_at, s.title AS song_title, u.name AS uploader
        FROM files f LEFT JOIN songs s ON s.id = f.song_id LEFT JOIN users u ON u.id = f.uploaded_by
        WHERE f.group_id = ${g.id} AND f.status = 'ready' ORDER BY f.created_at DESC LIMIT 5`,
    ]);
    const c = counts[0];
    const body = html`
      <section class="grouphead">
        ${STAVE}
        <div class="grouphead-text">
          <h1>${g.name}</h1>
          <p class="muted">${[g.genre, g.role_label ? `Tú: ${g.role_label}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <dl class="stats">
          <div><dt>Canciones</dt><dd>${c.songs}</dd></div>
          <div><dt>Listas para tocar</dt><dd>${c.ready}</dd></div>
          <div><dt>Miembros</dt><dd>${c.members}</dd></div>
          <div><dt>Setlists</dt><dd>${c.setlists}</dd></div>
        </dl>
      </section>
      ${g.description ? html`<div class="prose">${paragraphs(g.description)}</div>` : ''}
      <div class="quick">
        <a class="button" href="/g/${g.id}/eventos/nuevo?tipo=ensayo">${icon('calendar')} Nuevo ensayo</a>
        <a class="button button-ghost" href="/g/${g.id}/canciones/nueva">${icon('music')} Añadir canción</a>
        <a class="button button-ghost" href="/g/${g.id}/setlists">${icon('list')} Preparar setlist</a>
        ${req.isOwner ? html`<a class="button button-ghost" href="/g/${g.id}/miembros#invitar">${icon('mail')} Invitar</a>` : ''}
      </div>
      <div class="two-col">
        <section>
          <h2>Próximos ensayos y conciertos</h2>
          ${events.length
            ? html`<ul class="event-list">${events.map((e) => eventRow(e))}</ul><p><a href="/g/${g.id}/agenda">Ver agenda completa</a></p>`
            : empty('No hay nada en la agenda.', html`<a class="button button-small" href="/g/${g.id}/eventos/nuevo?tipo=ensayo">Programar un ensayo</a>`)}
        </section>
        <section>
          <h2>En el atril</h2>
          ${songs.length
            ? html`<ul class="song-list compact">${songs.map((s) => html`<li><a href="/g/${g.id}/canciones/${s.id}">
                <span class="song-title">${s.title}</span>
                <span class="muted">${[s.artist, s.song_key, s.bpm ? `${s.bpm} bpm` : ''].filter(Boolean).join(' · ')}</span>
                <span class="status status-${s.status}">${s.status === 'idea' ? 'Idea' : 'Aprendiendo'}</span>
              </a></li>`)}</ul>`
            : empty('No hay canciones en preparación.', html`<a class="button button-small" href="/g/${g.id}/canciones/nueva">Añadir canción</a>`)}
          ${recentFiles.length
            ? html`<h3 class="mt">Subido hace poco</h3>
              <ul class="plain-list small">${recentFiles.map((f) => html`<li><a href="/g/${g.id}/archivos/${f.id}">${f.label || f.filename}</a>
                <span class="muted">${f.song_title ? `${f.song_title} · ` : ''}${f.uploader || ''} · ${timeAgo(f.created_at)}</span></li>`)}</ul>`
            : ''}
        </section>
      </div>`;
    res.html(layout(res.ctx, { title: 'Inicio', active: 'inicio', body }));
  });

  // ---------- Ajustes (solo creador) ----------
  app.get('/g/:gid/ajustes', loadGroup, requireOwner, async (req, res) => {
    const usage = await limits.usageReport();
    res.html(layout(res.ctx, { title: 'Ajustes', active: 'ajustes', body: html`${settingsPage(res.ctx, req.group)}${usagePanel(usage)}` }));
  });

  app.post('/g/:gid/ajustes', loadGroup, requireOwner, async (req, res) => {
    const data = { name: str(req.body.name, 80), genre: str(req.body.genre, 60), description: str(req.body.description, 2000) };
    if (!data.name) {
      return res.html(layout(res.ctx, { title: 'Ajustes', active: 'ajustes', body: settingsPage(res.ctx, { ...req.group, ...data }, 'El nombre no puede quedar vacío.') }), 400);
    }
    await sql`UPDATE groups SET name = ${data.name}, genre = ${data.genre}, description = ${data.description} WHERE id = ${req.group.id}`;
    flash(req, 'ok', 'Cambios guardados.');
    res.redirect(`/g/${req.group.id}/ajustes`);
  });

  app.post('/g/:gid/borrar', loadGroup, requireOwner, async (req, res) => {
    if (str(req.body.confirm_name, 80) !== req.group.name) {
      flash(req, 'error', 'Escribe el nombre exacto del grupo para borrarlo.');
      return res.redirect(`/g/${req.group.id}/ajustes`);
    }
    const cleanup = require('../lib/cleanup');
    await sql.begin(async (tx) => {
      const files = await tx`SELECT storage_key, size FROM files WHERE group_id = ${req.group.id}`;
      await cleanup.queueDeletion(tx, files);
      await tx`DELETE FROM groups WHERE id = ${req.group.id}`;
    });
    cleanup.processDeletions().catch(() => {});
    flash(req, 'ok', `Has borrado ${req.group.name}.`);
    res.redirect('/');
  });

  // ---------- Miembros e invitaciones ----------
  app.get('/g/:gid/miembros', loadGroup, async (req, res) => {
    const g = req.group;
    const members = await sql`
      SELECT u.id, u.name, u.email, m.role_label, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ${g.id} ORDER BY (u.id = ${g.owner_id}) DESC, u.name`;
    const invitations = req.isOwner
      ? await sql`
          SELECT * FROM invitations WHERE group_id = ${g.id} AND (status = 'pending' OR responded_at > now() - interval '14 days')
          ORDER BY (status = 'pending') DESC, created_at DESC`
      : [];
    res.html(layout(res.ctx, { title: 'Miembros', active: 'miembros', body: membersPage(res.ctx, req, members, invitations) }));
  });

  app.post('/g/:gid/invitaciones', loadGroup, requireOwner, async (req, res) => {
    const g = req.group;
    const raw = str(req.body.emails, 2000);
    const roleLabel = str(req.body.role_label, 60);
    const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) {
      flash(req, 'error', 'Escribe al menos un email.');
      return res.redirect(`/g/${g.id}/miembros#invitar`);
    }
    if (emails.length > 10) {
      flash(req, 'error', 'Invita como máximo a 10 personas a la vez.');
      return res.redirect(`/g/${g.id}/miembros#invitar`);
    }
    const invalid = emails.filter((e) => !EMAIL_RE.test(e) || e.length > 200);
    if (invalid.length) {
      flash(req, 'error', `Revisa ${invalid.length === 1 ? 'este email' : 'estos emails'}: ${invalid.join(', ')}`);
      return res.redirect(`/g/${g.id}/miembros#invitar`);
    }
    const results = { sent: [], member: [], failed: [] };
    for (const email of emails) {
      const isMember = await sql`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = ${g.id} AND lower(u.email) = ${email}`;
      if (isMember.length) {
        results.member.push(email);
        continue;
      }
      // Una sola invitación pendiente por email: la anterior se revoca.
      await sql`UPDATE invitations SET status = 'revoked', responded_at = now() WHERE group_id = ${g.id} AND lower(email) = ${email} AND status = 'pending'`;
      const token = crypto.randomBytes(24).toString('base64url');
      const [inv] = await sql`
        INSERT INTO invitations (group_id, email, role_label, token, invited_by, expires_at)
        VALUES (${g.id}, ${email}, ${roleLabel}, ${token}, ${req.session.user.id}, now() + ${`${INVITE_DAYS} days`}::interval)
        RETURNING *`;
      const r = await sendInvitation(inv);
      if (r.ok) results.sent.push(email);
      else results.failed.push(`${email} (${r.message})`);
    }
    const parts = [];
    if (results.sent.length) parts.push(`Invitación enviada a ${results.sent.join(', ')}.`);
    if (results.member.length) parts.push(`${results.member.join(', ')} ya ${results.member.length === 1 ? 'es miembro' : 'son miembros'}.`);
    if (results.failed.length) parts.push(`No se pudo enviar el email a ${results.failed.join('; ')}. La invitación existe: copia su enlace y compártelo tú.`);
    flash(req, results.failed.length ? 'error' : 'ok', parts.join(' '));
    res.redirect(`/g/${g.id}/miembros`);
  });

  app.post('/g/:gid/invitaciones/:iid/reenviar', loadGroup, requireOwner, async (req, res) => {
    const iid = parseId(req.params.iid);
    const [inv] = await sql`SELECT * FROM invitations WHERE id = ${iid} AND group_id = ${req.group.id} AND status = 'pending'`;
    if (!inv) throw new HttpError(404, 'Invitación no encontrada');
    await sql`UPDATE invitations SET expires_at = now() + ${`${INVITE_DAYS} days`}::interval WHERE id = ${inv.id}`;
    const r = await sendInvitation(inv);
    flash(req, r.ok ? 'ok' : 'error', r.ok ? `Invitación reenviada a ${inv.email}.` : `No se pudo reenviar: ${r.message}`);
    res.redirect(`/g/${req.group.id}/miembros`);
  });

  app.post('/g/:gid/invitaciones/:iid/revocar', loadGroup, requireOwner, async (req, res) => {
    const iid = parseId(req.params.iid);
    const rows = await sql`UPDATE invitations SET status = 'revoked', responded_at = now() WHERE id = ${iid} AND group_id = ${req.group.id} AND status = 'pending' RETURNING email`;
    flash(req, 'ok', rows.length ? `Invitación a ${rows[0].email} cancelada. Su enlace ya no sirve.` : 'Esa invitación ya no estaba pendiente.');
    res.redirect(`/g/${req.group.id}/miembros`);
  });

  app.post('/g/:gid/miembros/:uid/rol', loadGroup, requireOwner, async (req, res) => {
    const uid = parseId(req.params.uid);
    const role = str(req.body.role_label, 60);
    const rows = await sql`UPDATE memberships SET role_label = ${role} WHERE group_id = ${req.group.id} AND user_id = ${uid} RETURNING user_id`;
    if (!rows.length) throw new HttpError(404, 'Esa persona no es miembro del grupo');
    flash(req, 'ok', 'Rol actualizado.');
    res.redirect(`/g/${req.group.id}/miembros`);
  });

  app.post('/g/:gid/miembros/:uid/quitar', loadGroup, requireOwner, async (req, res) => {
    const uid = parseId(req.params.uid);
    if (uid === req.group.owner_id) throw new HttpError(400, 'No puedes quitarte a ti mismo: eres quien creó el grupo.');
    const rows = await sql`
      DELETE FROM memberships m USING users u WHERE m.group_id = ${req.group.id} AND m.user_id = ${uid} AND u.id = m.user_id
      RETURNING u.name`;
    flash(req, 'ok', rows.length ? `${rows[0].name} ya no está en el grupo.` : 'Esa persona ya no era miembro.');
    res.redirect(`/g/${req.group.id}/miembros`);
  });

  app.post('/g/:gid/salir', loadGroup, async (req, res) => {
    if (req.isOwner) throw new HttpError(400, 'Quien creó el grupo no puede salir de él. Puedes borrarlo desde Ajustes.');
    await sql`DELETE FROM memberships WHERE group_id = ${req.group.id} AND user_id = ${req.session.user.id}`;
    flash(req, 'ok', `Has salido de ${req.group.name}.`);
    res.redirect('/');
  });

  // ---------- Aceptar invitación ----------
  async function findInvitation(token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token))) return null;
    const rows = await sql`
      SELECT i.*, g.name AS group_name, g.genre AS group_genre, u.name AS inviter
      FROM invitations i JOIN groups g ON g.id = i.group_id JOIN users u ON u.id = i.invited_by
      WHERE i.token = ${token}`;
    return rows[0] || null;
  }

  async function verifiedFor(req, inv) {
    const user = req.session.user;
    if (String(user.email).toLowerCase() !== String(inv.email).toLowerCase()) return false;
    if (user.emailVerified) return true;
    // El enlace del email verifica la cuenta en Keycloak, pero la sesión puede ser anterior.
    try {
      if (await kc.isEmailVerified(user.sub, inv.email)) {
        req.session.user = { ...user, emailVerified: true };
        return true;
      }
    } catch (err) {
      console.error('No se pudo comprobar el email en Keycloak:', err.message);
    }
    return false;
  }

  app.get('/invitaciones/:token', async (req, res) => {
    const ctx = res.ctx;
    const inv = await findInvitation(req.params.token);
    const wrap = (title, lead, extra = '') =>
      res.html(layout(ctx, { title, body: html`<section class="narrow invite-card">${STAVE}${pageHead(title, { lead })}${extra}</section>` }));

    if (!inv) return wrap('Invitación no válida', 'Este enlace no existe o está incompleto. Pide a quien te invitó que te mande uno nuevo.', html`<a class="button button-ghost" href="/">Ir a Ensaya</a>`);
    const invitedLine = html`<b>${inv.inviter}</b> te invita a unirte a <b>${inv.group_name}</b>${inv.role_label ? html` como <i>${inv.role_label}</i>` : ''}.`;

    if (ctx.user) {
      const member = await sql`SELECT 1 FROM memberships WHERE group_id = ${inv.group_id} AND user_id = ${ctx.user.id}`;
      if (member.length) return res.redirect(`/g/${inv.group_id}`);
    }
    if (inv.status === 'accepted') return wrap('Invitación ya usada', 'Esta invitación ya se aceptó.', html`<a class="button" href="/">Ir a mis grupos</a>`);
    if (inv.status === 'revoked') return wrap('Invitación cancelada', 'Quien creó el grupo canceló esta invitación. Pídele una nueva si la necesitas.');
    if (inv.status === 'declined') return wrap('Invitación rechazada', 'Rechazaste esta invitación. Si cambias de idea, pide una nueva.');
    if (new Date(inv.expires_at) < new Date()) return wrap('Invitación caducada', 'Han pasado más de 7 días. Pide a quien te invitó que la reenvíe.');

    if (!ctx.user) {
      return wrap(
        `Únete a ${inv.group_name}`,
        invitedLine,
        html`<p>Entra con <b>${maskEmail(inv.email)}</b> para aceptar. Si aún no has creado tu contraseña, usa primero el enlace del email que te llegó.</p>
          <p class="actions">
            <a class="button" href="/login?returnTo=${encodeURIComponent(`/invitaciones/${inv.token}`)}&login_hint=${encodeURIComponent(inv.email)}">Entrar y aceptar</a>
          </p>`
      );
    }
    if (String(ctx.user.email).toLowerCase() !== String(inv.email).toLowerCase()) {
      return wrap(
        'Esta invitación es para otra cuenta',
        html`Has entrado como <b>${ctx.user.email}</b>, pero la invitación es para <b>${maskEmail(inv.email)}</b>.`,
        html`<p>Sal y vuelve a entrar con la cuenta correcta.</p>
          <form method="post" action="/logout">${csrfField(ctx)}<button class="button" type="submit">Salir</button></form>`
      );
    }
    if (!(await verifiedFor(req, inv))) {
      return wrap(
        'Confirma tu email',
        'Antes de unirte, confirma tu email con el enlace que te enviamos.',
        html`<p>Después de confirmarlo, vuelve a esta página.</p>`
      );
    }
    return wrap(
      `Únete a ${inv.group_name}`,
      invitedLine,
      html`<div class="actions">
        <form method="post" action="/invitaciones/${inv.token}/aceptar" class="inline">${csrfField(ctx)}<button class="button" type="submit">Unirme al grupo</button></form>
        <form method="post" action="/invitaciones/${inv.token}/rechazar" class="inline" data-confirm="¿Rechazar la invitación a ${inv.group_name}?">${csrfField(ctx)}<button class="button button-ghost" type="submit">Rechazar</button></form>
      </div>`
    );
  });

  app.post('/invitaciones/:token/aceptar', requireLogin, async (req, res) => {
    const inv = await findInvitation(req.params.token);
    if (!inv || inv.status !== 'pending' || new Date(inv.expires_at) < new Date()) {
      return res.redirect(`/invitaciones/${encodeURIComponent(req.params.token)}`);
    }
    if (!(await verifiedFor(req, inv))) return res.redirect(`/invitaciones/${inv.token}`);
    const uid = req.session.user.id;
    await sql.begin(async (tx) => {
      await tx`INSERT INTO memberships (group_id, user_id, role_label) VALUES (${inv.group_id}, ${uid}, ${inv.role_label}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE invitations SET status = 'accepted', accepted_by = ${uid}, responded_at = now() WHERE id = ${inv.id}`;
    });
    flash(req, 'ok', `¡Bienvenido a ${inv.group_name}!`);
    res.redirect(`/g/${inv.group_id}`);
  });

  app.post('/invitaciones/:token/rechazar', requireLogin, async (req, res) => {
    const inv = await findInvitation(req.params.token);
    if (inv && inv.status === 'pending' && String(req.session.user.email).toLowerCase() === inv.email.toLowerCase()) {
      await sql`UPDATE invitations SET status = 'declined', responded_at = now() WHERE id = ${inv.id}`;
      flash(req, 'ok', 'Invitación rechazada.');
    }
    res.redirect('/');
  });
};

// ---------- Vistas ----------
function landing() {
  return html`<section class="hero">
    <div class="hero-text">
      <h1>Todo lo que tu grupo necesita para ensayar, en el mismo atril.</h1>
      <p class="lead">Canciones con su audio, partituras que se pasan con el pedal, ensayos con asistencia y setlists listos para el escenario, aunque en la sala no haya cobertura.</p>
      <p class="actions">
        <a class="button button-large" href="/login?signup=1&returnTo=%2Fgrupos%2Fnuevo">Crear mi grupo</a>
        <a class="button button-ghost button-large" href="/login">Ya tengo cuenta</a>
      </p>
    </div>
    <figure class="hero-score" aria-hidden="true">
      <svg viewBox="0 0 520 260">
        <g class="hero-staff">
          ${raw([0, 1, 2, 3, 4].map((i) => `<line x1="0" x2="520" y1="${70 + i * 18}" y2="${70 + i * 18}"/>`).join(''))}
        </g>
        <g class="hero-notes">
          <ellipse cx="90" cy="133" rx="11" ry="8" transform="rotate(-20 90 133)"/><line x1="100" y1="131" x2="100" y2="75"/>
          <ellipse cx="160" cy="115" rx="11" ry="8" transform="rotate(-20 160 115)"/><line x1="170" y1="113" x2="170" y2="57"/>
          <ellipse cx="230" cy="97" rx="11" ry="8" transform="rotate(-20 230 97)"/><line x1="240" y1="95" x2="240" y2="39"/>
          <path d="M170 57 L240 39 L240 47 L170 65 Z"/>
          <ellipse cx="310" cy="124" rx="11" ry="8" transform="rotate(-20 310 124)"/><line x1="320" y1="122" x2="320" y2="66"/>
          <ellipse cx="380" cy="106" rx="11" ry="8" transform="rotate(-20 380 106)"/><line x1="390" y1="104" x2="390" y2="48"/>
          <ellipse cx="450" cy="88" rx="11" ry="8" transform="rotate(-20 450 88)"/><line x1="460" y1="86" x2="460" y2="30"/>
        </g>
        <g class="hero-chords"><text x="82" y="200">Am</text><text x="222" y="200">F</text><text x="302" y="200">C</text><text x="442" y="200">G</text></g>
      </svg>
    </figure>
  </section>
  <section class="features">
    <div><h2>Repertorio con sonido</h2><p>Sube la canción completa, maquetas y pistas. Practica en bucle, más lenta o en otro tono sin cambiar el tempo.</p></div>
    <div><h2>Partituras vivas</h2><p>PDF en modo atril con pedal Bluetooth, anotaciones tuyas y del grupo, MusicXML transpuesto y un editor para escribir las tuyas.</p></div>
    <div><h2>Ensayos que se aprovechan</h2><p>Agenda con asistencia, qué se trabaja en cada ensayo y notas para el siguiente.</p></div>
    <div><h2>Listo para el escenario</h2><p>Setlists que se ordenan arrastrando y un modo escenario con letras y acordes a pantalla completa, también sin conexión.</p></div>
  </section>`;
}

function groupForm(ctx, data, action, submit, error = '') {
  return html`<section class="narrow">
    ${pageHead(submit === 'Crear grupo' ? 'Crea tu grupo' : 'Datos del grupo', { lead: submit === 'Crear grupo' ? 'Serás quien gestione el grupo: solo tú podrás invitar a los demás y asignar sus roles.' : '' })}
    ${error ? html`<p class="flash flash-error" role="alert">${error}</p>` : ''}
    <form method="post" action="${action}" class="form">
      ${csrfField(ctx)}
      <label>Nombre del grupo<input name="name" required maxlength="80" value="${data.name || ''}" autofocus></label>
      <label>Estilo <span class="hint">opcional</span><input name="genre" maxlength="60" value="${data.genre || ''}" placeholder="Rock, coro, banda de música, jazz…"></label>
      ${submit === 'Crear grupo' ? html`<label>Tu papel en el grupo <span class="hint">opcional</span><input name="role_label" maxlength="60" list="roles" value="${data.role_label || ''}" placeholder="Guitarra, voz, dirección…">${roleDatalist()}</label>` : ''}
      <label>Descripción <span class="hint">opcional</span><textarea name="description" rows="4" maxlength="2000">${data.description || ''}</textarea></label>
      <p class="actions"><button class="button" type="submit">${submit}</button> <a class="button button-ghost" href="/">Cancelar</a></p>
    </form>
  </section>`;
}

function settingsPage(ctx, group, error = '') {
  return html`${groupForm(ctx, group, `/g/${group.id}/ajustes`, 'Guardar cambios', error)}
  <section class="narrow danger-zone">
    <h2>Borrar el grupo</h2>
    <p>Se borran para siempre sus canciones, archivos, partituras, ensayos y setlists. Escribe <b>${group.name}</b> para confirmarlo.</p>
    <form method="post" action="/g/${group.id}/borrar" class="form" data-confirm="¿Seguro? Esto no se puede deshacer.">
      ${csrfField(ctx)}
      <label>Nombre del grupo<input name="confirm_name" required autocomplete="off"></label>
      <button class="button button-danger" type="submit">Borrar ${group.name}</button>
    </form>
  </section>`;
}

function usageRow(label, value, limit, fmt) {
  const pct = limit ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  return html`<tr><th scope="row">${label}</th><td>${fmt(value)} de ${fmt(limit)}</td>
    <td><div class="quota ${pct >= 90 ? 'quota-high' : ''}"><div class="quota-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"><span style="width:${pct}%"></span></div></div></td></tr>`;
}

function usagePanel(u) {
  const n = (v) => Number(v).toLocaleString('es-ES');
  return html`<section class="narrow panel">
    <h2>Uso de la app (${u.month})</h2>
    <p class="muted small">Topes fijos para que Ensaya no genere ningún coste. Se comparten entre todos los grupos de la app y los contadores mensuales vuelven a cero el día 1.</p>
    <table class="usage-table">
      ${usageRow('Almacenamiento', u.storageUsed, u.storageLimit, limits.formatGB)}
      ${storage.useS3 ? usageRow('Subidas a R2 (mes)', u.classA, u.classALimit, n) : ''}
      ${storage.useS3 ? usageRow('Lecturas de R2 (mes, estimadas)', u.classB, u.classBLimit, n) : ''}
      ${usageRow('Tráfico de Render (mes)', u.egress, u.egressLimit, limits.formatGB)}
    </table>
    ${storage.useS3 ? '' : html`<p class="error-text">Los archivos se están guardando en el disco del servidor, que se borra en cada despliegue. Configura R2.</p>`}
  </section>`;
}

function invitationStatus(inv) {
  if (inv.status === 'accepted') return html`<span class="pill pill-si">Aceptada</span>`;
  if (inv.status === 'revoked') return html`<span class="pill">Cancelada</span>`;
  if (inv.status === 'declined') return html`<span class="pill pill-no">Rechazada</span>`;
  if (new Date(inv.expires_at) < new Date()) return html`<span class="pill pill-no">Caducada</span>`;
  if (inv.email_status.startsWith('error:')) return html`<span class="pill pill-no" title="${inv.email_status.slice(6)}">Email no enviado</span>`;
  if (inv.email_status.startsWith('sent')) return html`<span class="pill pill-quizas">Email enviado</span>`;
  return html`<span class="pill">Pendiente</span>`;
}

function membersPage(ctx, req, members, invitations) {
  const g = req.group;
  const owner = members.find((m) => m.id === g.owner_id);
  return html`
    ${pageHead('Miembros', { lead: `${members.length} ${members.length === 1 ? 'persona' : 'personas'} en ${g.name}.` })}
    <ul class="member-list">
      ${members.map((m) => html`<li class="member">
        ${avatar(m.name)}
        <div class="member-main">
          <span class="member-name">${m.name}${m.id === ctx.user.id ? ' (tú)' : ''}</span>
          <span class="muted">${m.email}</span>
        </div>
        <div class="member-role">
          ${m.id === g.owner_id ? html`<span class="badge">Creador del grupo</span>` : ''}
          ${req.isOwner
            ? html`<form method="post" action="/g/${g.id}/miembros/${m.id}/rol" class="role-form">
                ${csrfField(ctx)}
                <label class="sr-only" for="role-${m.id}">Rol de ${m.name}</label>
                <input id="role-${m.id}" name="role_label" list="roles" maxlength="60" value="${m.role_label}" placeholder="Sin rol">
                <button class="button button-small button-ghost" type="submit">Guardar</button>
              </form>`
            : html`<span>${m.role_label || html`<span class="muted">Sin rol</span>`}</span>`}
        </div>
        ${req.isOwner && m.id !== g.owner_id
          ? postButton(ctx, `/g/${g.id}/miembros/${m.id}/quitar`, 'Quitar', { cls: 'button button-small button-danger-ghost', confirm: `¿Quitar a ${m.name} del grupo?` })
          : ''}
      </li>`)}
    </ul>
    ${req.isOwner ? roleDatalist() : ''}

    ${req.isOwner
      ? html`<section class="panel" id="invitar">
          <h2>${icon('mail')} Invitar al grupo</h2>
          <p class="muted">Les llegará un email de acceso: quien no tenga cuenta creará su contraseña en un paso y entrará directamente a la invitación. El enlace caduca en 7 días.</p>
          <form method="post" action="/g/${g.id}/invitaciones" class="form form-inline-wide">
            ${csrfField(ctx)}
            <label>Emails <span class="hint">separados por comas, hasta 10</span><textarea name="emails" rows="2" required placeholder="ana@ejemplo.com, luis@ejemplo.com"></textarea></label>
            <label>Rol en el grupo <span class="hint">opcional</span><input name="role_label" list="roles" maxlength="60" placeholder="Batería, voz…"></label>
            <p class="actions"><button class="button" type="submit">Enviar invitaciones</button></p>
          </form>
        </section>
        <section>
          <h2>Invitaciones</h2>
          ${invitations.length
            ? html`<ul class="invite-list">
                ${invitations.map((inv) => html`<li class="invite">
                  <div class="member-main">
                    <span class="member-name">${inv.email}</span>
                    <span class="muted">${inv.role_label ? `${inv.role_label} · ` : ''}enviada ${timeAgo(inv.created_at)}${inv.status === 'pending' ? ` · caduca ${formatShort(inv.expires_at)}` : ''}</span>
                    ${inv.email_status.startsWith('error:') && inv.status === 'pending' ? html`<span class="error-text">${inv.email_status.slice(6)}</span>` : ''}
                  </div>
                  ${invitationStatus(inv)}
                  ${inv.status === 'pending'
                    ? html`<div class="invite-actions">
                        <button type="button" class="button button-small button-ghost" data-copy="${`${BASE_URL}/invitaciones/${inv.token}`}">Copiar enlace</button>
                        ${postButton(ctx, `/g/${g.id}/invitaciones/${inv.id}/reenviar`, 'Reenviar email', { cls: 'button button-small button-ghost' })}
                        ${postButton(ctx, `/g/${g.id}/invitaciones/${inv.id}/revocar`, 'Cancelar', { cls: 'button button-small button-danger-ghost', confirm: `¿Cancelar la invitación a ${inv.email}?` })}
                      </div>`
                    : ''}
                </li>`)}
              </ul>`
            : empty('No hay invitaciones pendientes.')}
        </section>`
      : html`<section class="panel">
          <p>Solo <b>${owner ? owner.name : 'quien creó el grupo'}</b> puede invitar a nuevas personas y asignar roles.</p>
          ${postButton(ctx, `/g/${g.id}/salir`, 'Salir del grupo', { cls: 'button button-danger-ghost', confirm: `¿Salir de ${g.name}? Necesitarás otra invitación para volver.` })}
        </section>`}`;
}

module.exports.EVENT_TYPE = EVENT_TYPE;
module.exports.RSVP = RSVP;
module.exports.eventRow = eventRow;
