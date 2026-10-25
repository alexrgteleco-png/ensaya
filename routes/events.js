'use strict';

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { layout, pageHead, empty, csrfField, postButton, avatar, icon, paragraphs } = require('../lib/ui');
const T = require('../lib/time');
const { BASE_URL } = require('../lib/oidc');
const { str, parseId, flash, loadGroup, canDelete } = require('./common');
const { EVENT_TYPE, RSVP, eventRow } = require('./groups');

async function loadEvent(req) {
  const id = parseId(req.params.eid);
  const rows = id ? await sql`SELECT * FROM events WHERE id = ${id} AND group_id = ${req.group.id}` : [];
  if (!rows.length) throw new HttpError(404, 'Evento no encontrado');
  return rows[0];
}

function readEvent(body) {
  const errors = [];
  const type = EVENT_TYPE[body.type] ? body.type : 'ensayo';
  const starts = T.fromInputValue(str(body.starts_at, 20));
  const endsRaw = str(body.ends_at, 20);
  const ends = endsRaw ? T.fromInputValue(endsRaw) : null;
  const data = {
    type,
    title: str(body.title, 150) || (type === 'ensayo' ? 'Ensayo' : type === 'concierto' ? 'Concierto' : ''),
    starts_at: starts,
    ends_at: ends,
    location: str(body.location, 200),
    details: str(body.details, 5000),
    plan: str(body.plan, 5000),
    setlist_id: parseId(body.setlist_id),
  };
  if (!data.title) errors.push('Ponle un nombre al evento.');
  if (!starts) errors.push('Indica el día y la hora de inicio.');
  if (endsRaw && !ends) errors.push('La hora de fin no es válida.');
  if (starts && ends && ends <= starts) errors.push('El fin tiene que ser después del inicio.');
  const songIds = (Array.isArray(body.song_ids) ? body.song_ids : body.song_ids ? [body.song_ids] : []).map(parseId).filter(Boolean).slice(0, 60);
  return { data, errors, songIds };
}

function eventForm(ctx, g, ev, { songs, setlists, planSongs, action, errors = [] }) {
  const isNew = !ev.id;
  const selected = new Set(planSongs);
  return html`<section class="narrow wide-ok">
    ${pageHead(isNew ? (ev.type === 'concierto' ? 'Nuevo concierto' : ev.type === 'otro' ? 'Nuevo evento' : 'Nuevo ensayo') : `Editar «${ev.title}»`)}
    ${errors.length ? html`<div class="flash flash-error" role="alert">${errors.map((e) => html`<p>${e}</p>`)}</div>` : ''}
    <form method="post" action="${action}" class="form">
      ${csrfField(ctx)}
      <fieldset class="seg-field">
        <legend>Tipo</legend>
        ${Object.entries(EVENT_TYPE).map(([k, v]) => html`<label class="seg-option"><input type="radio" name="type" value="${k}" ${ev.type === k ? raw('checked') : ''}> ${v}</label>`)}
      </fieldset>
      <label>Nombre<input name="title" maxlength="150" value="${ev.title || ''}" placeholder="Ensayo, Concierto en la Sala Malandar…"></label>
      <div class="grid-2">
        <label>Empieza<input type="datetime-local" name="starts_at" required value="${ev.starts_at ? T.toInputValue(ev.starts_at) : ev.starts_input || ''}"></label>
        <label>Termina <span class="hint">opcional</span><input type="datetime-local" name="ends_at" value="${ev.ends_at ? T.toInputValue(ev.ends_at) : ev.ends_input || ''}"></label>
      </div>
      <label>Lugar <span class="hint">opcional</span><input name="location" maxlength="200" value="${ev.location || ''}" placeholder="Local de ensayo, sala, dirección…"></label>
      <label>Detalles <span class="hint">horarios, prueba de sonido, contacto…</span><textarea name="details" rows="3" maxlength="5000">${ev.details || ''}</textarea></label>
      <label>Objetivos <span class="hint">qué queréis conseguir</span><textarea name="plan" rows="3" maxlength="5000" placeholder="Cerrar el final de «Marea», pasar el set entero dos veces…">${ev.plan || ''}</textarea></label>
      ${songs.length
        ? html`<fieldset class="song-picker">
            <legend>Canciones a trabajar</legend>
            <div class="checks">${songs.map((s) => html`<label class="check"><input type="checkbox" name="song_ids" value="${s.id}" ${selected.has(s.id) ? raw('checked') : ''}> ${s.title}</label>`)}</div>
          </fieldset>`
        : ''}
      ${setlists.length
        ? html`<label>Setlist <span class="hint">opcional</span>
            <select name="setlist_id"><option value="">Sin setlist</option>${setlists.map((l) => html`<option value="${l.id}" ${ev.setlist_id === l.id ? raw('selected') : ''}>${l.name}</option>`)}</select>
          </label>`
        : ''}
      <p class="actions">
        <button class="button" type="submit">${isNew ? 'Guardar en la agenda' : 'Guardar cambios'}</button>
        <a class="button button-ghost" href="${isNew ? `/g/${g.id}/agenda` : `/g/${g.id}/eventos/${ev.id}`}">Cancelar</a>
      </p>
    </form>
  </section>`;
}

async function formData(g) {
  const [songs, setlists] = await Promise.all([
    sql`SELECT id, title FROM songs WHERE group_id = ${g.id} AND status <> 'retirada' ORDER BY title`,
    sql`SELECT id, name FROM setlists WHERE group_id = ${g.id} ORDER BY updated_at DESC`,
  ]);
  return { songs, setlists };
}

async function savePlan(tx, eventId, songIds, groupId) {
  await tx`DELETE FROM event_songs WHERE event_id = ${eventId}`;
  if (!songIds.length) return;
  const valid = await tx`SELECT id FROM songs WHERE group_id = ${groupId} AND id IN ${tx(songIds)}`;
  const ok = new Set(valid.map((r) => r.id));
  const rows = songIds.filter((id) => ok.has(id)).map((id, i) => ({ event_id: eventId, song_id: id, position: i }));
  if (rows.length) await tx`INSERT INTO event_songs ${tx(rows)}`;
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsFold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 73) {
    let cut = 73;
    while (Buffer.byteLength(rest.slice(0, cut)) > 73) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function icsCalendar(g, events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//theaipeoplehub//Ensaya//ES', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(g.name)}`];
  events.forEach((e) => {
    const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:ensaya-${e.id}@theaipeoplehub`,
      `DTSTAMP:${T.icsDate(new Date())}`,
      `DTSTART:${T.icsDate(e.starts_at)}`,
      `DTEND:${T.icsDate(end)}`,
      `SUMMARY:${icsEscape(`${e.title} (${g.name})`)}`,
      e.location ? `LOCATION:${icsEscape(e.location)}` : null,
      `DESCRIPTION:${icsEscape([e.details, e.plan].filter(Boolean).join('\n\n'))}`,
      `URL:${BASE_URL}/g/${g.id}/eventos/${e.id}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).map(icsFold).join('\r\n') + '\r\n';
}

module.exports = function eventRoutes(app) {
  app.get('/g/:gid/agenda', loadGroup, async (req, res) => {
    const g = req.group;
    const uid = req.session.user.id;
    const today = T.todayKey();
    const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.mes || ''));
    const year = m ? Number(m[1]) : Number(today.slice(0, 4));
    const month = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : Number(today.slice(5, 7));
    const weeks = T.monthGrid(year, month);
    const from = T.fromInputValue(`${weeks[0][0].key}T00:00`);
    const lastKey = weeks[weeks.length - 1][6].key;
    const to = new Date(T.fromInputValue(`${lastKey}T00:00`).getTime() + 86400000);
    const [monthEvents, upcoming, past] = await Promise.all([
      sql`SELECT id, type, title, starts_at FROM events WHERE group_id = ${g.id} AND starts_at >= ${from} AND starts_at < ${to} ORDER BY starts_at`,
      sql`
        SELECT e.*, a.status AS my_status FROM events e LEFT JOIN attendance a ON a.event_id = e.id AND a.user_id = ${uid}
        WHERE e.group_id = ${g.id} AND e.starts_at >= now() - interval '3 hours' ORDER BY e.starts_at LIMIT 20`,
      sql`
        SELECT e.*, a.status AS my_status FROM events e LEFT JOIN attendance a ON a.event_id = e.id AND a.user_id = ${uid}
        WHERE e.group_id = ${g.id} AND e.starts_at < now() - interval '3 hours' ORDER BY e.starts_at DESC LIMIT 10`,
    ]);
    const byDay = {};
    monthEvents.forEach((e) => {
      const k = T.localDateKey(e.starts_at);
      (byDay[k] = byDay[k] || []).push(e);
    });
    const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    const body = html`
      ${pageHead('Agenda', {
        lead: 'Ensayos, conciertos y todo lo que tenéis en común.',
        actions: html`<a class="button" href="/g/${g.id}/eventos/nuevo?tipo=ensayo">${icon('plus')} Ensayo</a>
          <a class="button button-ghost" href="/g/${g.id}/eventos/nuevo?tipo=concierto">${icon('plus')} Concierto</a>`,
      })}
      <div class="agenda">
        <section class="calendar" aria-label="Calendario">
          <div class="cal-head">
            <a class="button button-icon button-ghost" href="?mes=${prev}" aria-label="Mes anterior">‹</a>
            <h2>${T.monthTitle(year, month)}</h2>
            <a class="button button-icon button-ghost" href="?mes=${next}" aria-label="Mes siguiente">›</a>
          </div>
          <table class="cal">
            <thead><tr>${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => html`<th scope="col" abbr="${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][i]}">${d}</th>`)}</tr></thead>
            <tbody>${weeks.map((w) => html`<tr>${w.map((d) => html`<td class="${[d.inMonth ? '' : 'out', d.key === today ? 'today' : ''].join(' ')}">
              <a class="cal-day" href="/g/${g.id}/eventos/nuevo?tipo=ensayo&fecha=${d.key}" title="Añadir ensayo el ${d.key}"><span>${d.day}</span></a>
              ${(byDay[d.key] || []).map((e) => html`<a class="cal-ev cal-${e.type}" href="/g/${g.id}/eventos/${e.id}">${T.formatTime(e.starts_at)} ${e.title}</a>`)}
            </td>`)}</tr>`)}</tbody>
          </table>
          <p class="muted small">Pulsa un día para programar un ensayo. <a href="/g/${g.id}/agenda.ics">Descargar la agenda (.ics)</a> para tu calendario.</p>
        </section>
        <section>
          <h2>Próximos</h2>
          ${upcoming.length ? html`<ul class="event-list">${upcoming.map((e) => eventRow(e))}</ul>` : empty('No hay nada programado.')}
          ${past.length ? html`<h2 class="mt">Anteriores</h2><ul class="event-list past">${past.map((e) => eventRow(e))}</ul>` : ''}
        </section>
      </div>`;
    res.html(layout(res.ctx, { title: 'Agenda', active: 'agenda', body }));
  });

  app.get('/g/:gid/agenda.ics', loadGroup, async (req, res) => {
    const events = await sql`SELECT * FROM events WHERE group_id = ${req.group.id} AND starts_at > now() - interval '90 days' ORDER BY starts_at`;
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="ensaya-${req.group.id}.ics"`,
    });
    res.end(icsCalendar(req.group, events));
  });

  app.get('/g/:gid/eventos/nuevo', loadGroup, async (req, res) => {
    const g = req.group;
    const type = EVENT_TYPE[req.query.tipo] ? req.query.tipo : 'ensayo';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? req.query.fecha : '';
    const { songs, setlists } = await formData(g);
    const ev = { type, title: type === 'ensayo' ? 'Ensayo' : '', starts_input: date ? `${date}T${type === 'concierto' ? '21:00' : '19:00'}` : '' };
    res.html(layout(res.ctx, { title: 'Nuevo evento', active: 'agenda', body: eventForm(res.ctx, g, ev, { songs, setlists, planSongs: [], action: `/g/${g.id}/eventos` }) }));
  });

  app.post('/g/:gid/eventos', loadGroup, async (req, res) => {
    const g = req.group;
    const { data, errors, songIds } = readEvent(req.body);
    if (data.setlist_id) {
      const ok = await sql`SELECT 1 FROM setlists WHERE id = ${data.setlist_id} AND group_id = ${g.id}`;
      if (!ok.length) data.setlist_id = null;
    }
    if (errors.length) {
      const { songs, setlists } = await formData(g);
      const ev = { ...data, starts_at: null, ends_at: null, starts_input: str(req.body.starts_at, 20), ends_input: str(req.body.ends_at, 20) };
      return res.html(layout(res.ctx, { title: 'Nuevo evento', active: 'agenda', body: eventForm(res.ctx, g, ev, { songs, setlists, planSongs: songIds, action: `/g/${g.id}/eventos`, errors }) }), 400);
    }
    const id = await sql.begin(async (tx) => {
      const [e] = await tx`INSERT INTO events ${tx({ ...data, group_id: g.id, created_by: req.session.user.id })} RETURNING id`;
      await savePlan(tx, e.id, songIds, g.id);
      // Quien lo crea queda apuntado.
      await tx`INSERT INTO attendance (event_id, user_id, status) VALUES (${e.id}, ${req.session.user.id}, 'si')`;
      return e.id;
    });
    flash(req, 'ok', 'Añadido a la agenda.');
    res.redirect(`/g/${g.id}/eventos/${id}`);
  });

  app.get('/g/:gid/eventos/:eid', loadGroup, async (req, res) => {
    const g = req.group;
    const ev = await loadEvent(req);
    const uid = req.session.user.id;
    const [members, plan, setlist] = await Promise.all([
      sql`
        SELECT u.id, u.name, m.role_label, a.status, a.comment FROM memberships m JOIN users u ON u.id = m.user_id
        LEFT JOIN attendance a ON a.event_id = ${ev.id} AND a.user_id = u.id
        WHERE m.group_id = ${g.id} ORDER BY u.name`,
      sql`SELECT s.id, s.title, s.song_key, s.status FROM event_songs es JOIN songs s ON s.id = es.song_id WHERE es.event_id = ${ev.id} ORDER BY es.position`,
      ev.setlist_id ? sql`SELECT id, name FROM setlists WHERE id = ${ev.setlist_id}` : [],
    ]);
    const me = members.find((m) => m.id === uid) || {};
    const counts = { si: 0, no: 0, quizas: 0, none: 0 };
    members.forEach((m) => { counts[m.status || 'none'] += 1; });
    const isPast = new Date(ev.starts_at) < new Date(Date.now() - 3 * 3600 * 1000);
    const body = html`
      <div class="pagehead">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/agenda">Agenda</a></p>
          <h1>${ev.title}</h1>
          <p class="lead"><span class="pill pill-type-${ev.type}">${EVENT_TYPE[ev.type]}</span> ${T.formatLong(ev.starts_at)}${ev.ends_at ? ` – ${T.localDateKey(ev.ends_at) === T.localDateKey(ev.starts_at) ? T.formatTime(ev.ends_at) : T.formatLong(ev.ends_at)}` : ''}</p>
          ${ev.location ? html`<p>${ev.location}</p>` : ''}
        </div>
        <div class="pagehead-actions">
          <a class="button button-ghost" href="/g/${g.id}/eventos/${ev.id}/editar">Editar</a>
          <a class="button button-ghost" href="/g/${g.id}/eventos/${ev.id}/calendario.ics">Añadir a mi calendario</a>
        </div>
      </div>
      <div class="two-col">
        <div>
          ${!isPast
            ? html`<section class="panel rsvp">
                <h2>¿Vas a ir?</h2>
                <form method="post" action="/g/${g.id}/eventos/${ev.id}/asistencia" class="form">
                  ${csrfField(res.ctx)}
                  <div class="rsvp-options">
                    ${Object.entries(RSVP).map(([k, v]) => html`<button type="submit" name="status" value="${k}" class="button rsvp-${k} ${me.status === k ? 'is-selected' : 'button-ghost'}" aria-pressed="${me.status === k ? 'true' : 'false'}">${v}</button>`)}
                  </div>
                  <label>Comentario <span class="hint">opcional</span><input name="comment" maxlength="200" value="${me.comment || ''}" placeholder="Llego 15 min tarde, llevo el ampli…"></label>
                </form>
              </section>`
            : ''}
          <section>
            <h2>Asistencia</h2>
            <p class="muted">${counts.si} van · ${counts.quizas} quizás · ${counts.no} no · ${counts.none} sin responder</p>
            <ul class="member-list compact">${members.map((m) => html`<li class="member">
              ${avatar(m.name)}
              <div class="member-main"><span class="member-name">${m.name}</span><span class="muted">${[m.role_label, m.comment].filter(Boolean).join(' · ')}</span></div>
              ${m.status ? html`<span class="pill pill-${m.status}">${RSVP[m.status]}</span>` : html`<span class="pill pill-pending">Sin responder</span>`}
            </li>`)}</ul>
          </section>
        </div>
        <div>
          ${ev.details ? html`<section><h2>Detalles</h2><div class="prose">${paragraphs(ev.details)}</div></section>` : ''}
          ${ev.plan ? html`<section><h2>Objetivos</h2><div class="prose">${paragraphs(ev.plan)}</div></section>` : ''}
          ${plan.length
            ? html`<section><h2>Canciones a trabajar</h2><ol class="plan-list">${plan.map((s) => html`<li><a href="/g/${g.id}/canciones/${s.id}">${s.title}</a> <span class="muted">${s.song_key || ''}</span></li>`)}</ol></section>`
            : ''}
          ${setlist.length
            ? html`<section class="panel"><h2>Setlist</h2><p><a href="/g/${g.id}/setlists/${setlist[0].id}">${setlist[0].name}</a></p>
                <a class="button" href="/g/${g.id}/setlists/${setlist[0].id}/escenario">${icon('stage')} Abrir modo escenario</a></section>`
            : ''}
          <section>
            <h2>${ev.type === 'concierto' ? 'Notas tras el concierto' : 'Notas del ensayo'}</h2>
            <form method="post" action="/g/${g.id}/eventos/${ev.id}/notas" class="form">
              ${csrfField(res.ctx)}
              <label class="sr-only" for="post_notes">Notas</label>
              <textarea id="post_notes" name="post_notes" rows="6" maxlength="10000" placeholder="Qué salió bien, qué hay que repasar para el próximo…">${ev.post_notes}</textarea>
              <p class="actions"><button class="button button-ghost" type="submit">Guardar notas</button></p>
            </form>
          </section>
          ${canDelete(req, ev.created_by)
            ? html`<p class="danger-inline">${postButton(res.ctx, `/g/${g.id}/eventos/${ev.id}/borrar`, 'Borrar de la agenda', { cls: 'button button-small button-danger-ghost', confirm: `¿Borrar «${ev.title}»?` })}</p>`
            : ''}
        </div>
      </div>`;
    res.html(layout(res.ctx, { title: ev.title, active: 'agenda', body }));
  });

  app.get('/g/:gid/eventos/:eid/calendario.ics', loadGroup, async (req, res) => {
    const id = parseId(req.params.eid);
    const rows = id ? await sql`SELECT * FROM events WHERE id = ${id} AND group_id = ${req.group.id}` : [];
    if (!rows.length) throw new HttpError(404, 'Evento no encontrado');
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="evento-${id}.ics"` });
    res.end(icsCalendar(req.group, rows));
  });

  app.get('/g/:gid/eventos/:eid/editar', loadGroup, async (req, res) => {
    const g = req.group;
    const ev = await loadEvent(req);
    const { songs, setlists } = await formData(g);
    const plan = await sql`SELECT song_id FROM event_songs WHERE event_id = ${ev.id} ORDER BY position`;
    res.html(layout(res.ctx, { title: 'Editar evento', active: 'agenda', body: eventForm(res.ctx, g, ev, { songs, setlists, planSongs: plan.map((p) => p.song_id), action: `/g/${g.id}/eventos/${ev.id}/editar` }) }));
  });

  app.post('/g/:gid/eventos/:eid/editar', loadGroup, async (req, res) => {
    const g = req.group;
    const ev = await loadEvent(req);
    const { data, errors, songIds } = readEvent(req.body);
    if (data.setlist_id) {
      const ok = await sql`SELECT 1 FROM setlists WHERE id = ${data.setlist_id} AND group_id = ${g.id}`;
      if (!ok.length) data.setlist_id = null;
    }
    if (errors.length) {
      const { songs, setlists } = await formData(g);
      const view = { ...ev, ...data, starts_at: null, ends_at: null, starts_input: str(req.body.starts_at, 20), ends_input: str(req.body.ends_at, 20) };
      return res.html(layout(res.ctx, { title: 'Editar evento', active: 'agenda', body: eventForm(res.ctx, g, view, { songs, setlists, planSongs: songIds, action: `/g/${g.id}/eventos/${ev.id}/editar`, errors }) }), 400);
    }
    await sql.begin(async (tx) => {
      await tx`UPDATE events SET ${tx(data)} WHERE id = ${ev.id}`;
      await savePlan(tx, ev.id, songIds, g.id);
    });
    flash(req, 'ok', 'Cambios guardados.');
    res.redirect(`/g/${g.id}/eventos/${ev.id}`);
  });

  app.post('/g/:gid/eventos/:eid/asistencia', loadGroup, async (req, res) => {
    const ev = await loadEvent(req);
    const status = RSVP[req.body.status] ? req.body.status : null;
    if (!status) throw new HttpError(400, 'Elige si vas, no vas o quizás.');
    await sql`
      INSERT INTO attendance (event_id, user_id, status, comment) VALUES (${ev.id}, ${req.session.user.id}, ${status}, ${str(req.body.comment, 200)})
      ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, comment = EXCLUDED.comment, updated_at = now()`;
    flash(req, 'ok', `Respuesta guardada: ${RSVP[status]}.`);
    res.redirect(`/g/${req.group.id}/eventos/${ev.id}`);
  });

  app.post('/g/:gid/eventos/:eid/notas', loadGroup, async (req, res) => {
    const ev = await loadEvent(req);
    await sql`UPDATE events SET post_notes = ${str(req.body.post_notes, 10000)} WHERE id = ${ev.id}`;
    flash(req, 'ok', 'Notas guardadas.');
    res.redirect(`/g/${req.group.id}/eventos/${ev.id}`);
  });

  app.post('/g/:gid/eventos/:eid/borrar', loadGroup, async (req, res) => {
    const ev = await loadEvent(req);
    if (!canDelete(req, ev.created_by)) throw new HttpError(403, 'Solo quien lo creó o quien creó el grupo puede borrarlo.');
    await sql`DELETE FROM events WHERE id = ${ev.id}`;
    flash(req, 'ok', `«${ev.title}» borrado de la agenda.`);
    res.redirect(`/g/${req.group.id}/agenda`);
  });
};
