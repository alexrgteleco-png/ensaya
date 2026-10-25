'use strict';

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { layout, pageHead, empty, csrfField, postButton, icon, jsonData, paragraphs } = require('../lib/ui');
const { formatDuration, timeAgo, formatShort } = require('../lib/time');
const { str, parseId, flash, loadGroup, canDelete } = require('./common');

async function loadSetlist(req) {
  const id = parseId(req.params.lid);
  const rows = id ? await sql`SELECT * FROM setlists WHERE id = ${id} AND group_id = ${req.group.id}` : [];
  if (!rows.length) throw new HttpError(404, 'Setlist no encontrado');
  return rows[0];
}

async function loadItems(setlistId) {
  return sql`
    SELECT i.id, i.position, i.song_id, i.title, i.note, i.transpose, i.break_min,
      s.title AS song_title, s.artist, s.song_key, s.bpm, s.duration_sec, s.lyrics, s.time_signature
    FROM setlist_items i LEFT JOIN songs s ON s.id = i.song_id
    WHERE i.setlist_id = ${setlistId} ORDER BY i.position`;
}

function totalSeconds(items) {
  let total = 0;
  let unknown = 0;
  items.forEach((i) => {
    if (i.song_id) {
      if (i.duration_sec) total += i.duration_sec;
      else unknown += 1;
    } else if (i.break_min) total += i.break_min * 60;
  });
  return { total, unknown };
}

function stagePage(ctx, g, setlist, items, backUrl) {
  const data = {
    name: setlist.name,
    back: backUrl,
    items: items.map((i) => {
      const song = i.song || (i.song_id ? { id: i.song_id, title: i.song_title, artist: i.artist, song_key: i.song_key, bpm: i.bpm, lyrics: i.lyrics, duration_sec: i.duration_sec, time_signature: i.time_signature } : null);
      return {
        kind: song ? 'song' : i.break_min ? 'break' : 'text',
        title: song ? song.title : i.title,
        artist: song ? song.artist : '',
        key: song ? song.song_key : '',
        bpm: song ? song.bpm : null,
        meter: song ? song.time_signature : '',
        duration: song ? song.duration_sec : null,
        lyrics: song ? song.lyrics : '',
        transpose: i.transpose || 0,
        note: i.note || '',
        breakMin: i.break_min || null,
      };
    }),
  };
  return layout(ctx, {
    title: `Escenario: ${setlist.name}`,
    bare: true,
    bodyClass: 'stage-body',
    scripts: ['/chordpro.js', '/stage.js'],
    body: html`${jsonData('stage-data', data)}
      <div class="stage" data-stage-root>
        <header class="stage-bar">
          <a class="stage-btn" href="${backUrl}" aria-label="Salir del modo escenario">✕</a>
          <button type="button" class="stage-btn" data-act="list" aria-expanded="false">Lista</button>
          <span class="stage-pos" data-pos></span>
          <span class="stage-spacer"></span>
          <span class="stage-group" role="group" aria-label="Tono">
            <button type="button" class="stage-btn" data-act="tDown" aria-label="Bajar un semitono">−½</button>
            <output data-key class="stage-key"></output>
            <button type="button" class="stage-btn" data-act="tUp" aria-label="Subir un semitono">+½</button>
          </span>
          <button type="button" class="stage-btn stage-more-btn" data-act="more" aria-expanded="false">Más</button>
          <span class="stage-more" data-more>
            <span class="stage-group" role="group" aria-label="Tamaño de letra">
              <button type="button" class="stage-btn" data-act="fDown" aria-label="Letra más pequeña">A−</button>
              <button type="button" class="stage-btn" data-act="fUp" aria-label="Letra más grande">A+</button>
            </span>
            <span class="stage-group" role="group" aria-label="Desplazamiento automático">
              <button type="button" class="stage-btn" data-act="scroll" aria-pressed="false">Auto</button>
              <input type="range" min="1" max="10" value="3" data-scroll-speed aria-label="Velocidad de desplazamiento">
            </span>
            <button type="button" class="stage-btn" data-act="chords" aria-pressed="true">Acordes</button>
            <button type="button" class="stage-btn" data-act="theme">Claro</button>
            <button type="button" class="stage-btn" data-act="offline" data-offline>Guardar sin conexión</button>
          </span>
        </header>
        <nav class="stage-list" data-list hidden></nav>
        <main class="stage-main" data-main tabindex="-1"></main>
        <footer class="stage-foot">
          <button type="button" class="stage-nav" data-act="prev" aria-label="Canción anterior">‹ <span data-prev-title></span></button>
          <button type="button" class="stage-nav" data-act="next" aria-label="Canción siguiente"><span data-next-title></span> ›</button>
        </footer>
      </div>`,
  });
}

module.exports = function setlistRoutes(app) {
  app.get('/g/:gid/setlists', loadGroup, async (req, res) => {
    const g = req.group;
    const lists = await sql`
      SELECT l.*, (SELECT count(*) FROM setlist_items i WHERE i.setlist_id = l.id AND i.song_id IS NOT NULL)::int AS songs,
        (SELECT min(e.starts_at) FROM events e WHERE e.setlist_id = l.id AND e.starts_at >= now()) AS next_gig
      FROM setlists l WHERE l.group_id = ${g.id} ORDER BY l.updated_at DESC`;
    const body = html`
      ${pageHead('Setlists', { lead: 'Prepara el orden del concierto y llévalo al escenario.' })}
      <form method="post" action="/g/${g.id}/setlists" class="form form-row panel">
        ${csrfField(res.ctx)}
        <label>Nuevo setlist<input name="name" required maxlength="120" placeholder="Fiestas de octubre, set acústico…"></label>
        <button class="button" type="submit">${icon('plus')} Crear</button>
      </form>
      ${lists.length
        ? html`<ul class="setlist-grid">${lists.map((l) => html`<li><a class="setlist-card" href="/g/${g.id}/setlists/${l.id}">
            <span class="setlist-name">${l.name}</span>
            <span class="muted">${l.songs} ${l.songs === 1 ? 'canción' : 'canciones'} · cambiado ${timeAgo(l.updated_at)}</span>
            ${l.next_gig ? html`<span class="badge">Concierto ${formatShort(l.next_gig)}</span>` : ''}
          </a></li>`)}</ul>`
        : empty('Aún no hay setlists. Crea uno y añade canciones del repertorio.')}`;
    res.html(layout(res.ctx, { title: 'Setlists', active: 'setlists', body }));
  });

  app.post('/g/:gid/setlists', loadGroup, async (req, res) => {
    const name = str(req.body.name, 120);
    if (!name) {
      flash(req, 'error', 'Ponle nombre al setlist.');
      return res.redirect(`/g/${req.group.id}/setlists`);
    }
    const [l] = await sql`INSERT INTO setlists (group_id, name, created_by) VALUES (${req.group.id}, ${name}, ${req.session.user.id}) RETURNING id`;
    res.redirect(`/g/${req.group.id}/setlists/${l.id}`);
  });

  app.get('/g/:gid/setlists/:lid', loadGroup, async (req, res) => {
    const g = req.group;
    const list = await loadSetlist(req);
    const [items, songs, events] = await Promise.all([
      loadItems(list.id),
      sql`SELECT id, title, artist, song_key, bpm, duration_sec, status FROM songs WHERE group_id = ${g.id} AND status <> 'retirada' ORDER BY title`,
      sql`SELECT id, title, starts_at FROM events WHERE setlist_id = ${list.id} ORDER BY starts_at DESC LIMIT 5`,
    ]);
    const data = {
      save: `/api/g/${g.id}/setlists/${list.id}/items`,
      items: items.map((i) => ({ song_id: i.song_id, title: i.title, note: i.note, transpose: i.transpose, break_min: i.break_min })),
      songs: songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, key: s.song_key, bpm: s.bpm, duration: s.duration_sec, status: s.status })),
    };
    const body = html`
      ${jsonData('setlist-data', data)}
      <div class="pagehead">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/setlists">Setlists</a></p>
          <h1>${list.name}</h1>
          <p class="lead" data-totals></p>
        </div>
        <div class="pagehead-actions">
          <a class="button" href="/g/${g.id}/setlists/${list.id}/escenario">${icon('stage')} Modo escenario</a>
          <a class="button button-ghost" href="/g/${g.id}/setlists/${list.id}/imprimir">Imprimir</a>
        </div>
      </div>
      <div class="setlist-editor" data-setlist-editor>
        <section class="setlist-items">
          <div class="row-between"><h2>Orden</h2><span class="muted small" data-save-status>Guardado</span></div>
          <ol class="set-items" data-items aria-describedby="drag-help"></ol>
          <p id="drag-help" class="muted small">Arrastra las filas para cambiar el orden o usa las flechas. Los cambios se guardan solos.</p>
          <div class="set-add-extra">
            <button type="button" class="button button-ghost button-small" data-add-break>Añadir descanso</button>
            <form data-add-text class="inline-form"><input name="t" maxlength="120" placeholder="Presentación, cambio de afinación…" aria-label="Texto"><button class="button button-ghost button-small" type="submit">Añadir texto</button></form>
          </div>
        </section>
        <section class="setlist-picker">
          <h2>Repertorio</h2>
          <input type="search" data-song-filter placeholder="Buscar canción" aria-label="Buscar canción">
          <ul class="pick-list" data-pick></ul>
          ${!songs.length ? html`<p class="muted">El repertorio está vacío. <a href="/g/${g.id}/canciones/nueva">Añade canciones</a> primero.</p>` : ''}
        </section>
      </div>
      <details class="panel">
        <summary>Nombre y notas del setlist</summary>
        <form method="post" action="/g/${g.id}/setlists/${list.id}/editar" class="form">
          ${csrfField(res.ctx)}
          <label>Nombre<input name="name" required maxlength="120" value="${list.name}"></label>
          <label>Notas<textarea name="notes" rows="3" maxlength="3000">${list.notes}</textarea></label>
          <p class="actions"><button class="button button-ghost" type="submit">Guardar</button></p>
        </form>
      </details>
      ${list.notes ? html`<div class="prose">${paragraphs(list.notes)}</div>` : ''}
      ${events.length ? html`<p class="muted">Usado en: ${events.map((e, i) => html`${i ? ', ' : ''}<a href="/g/${g.id}/eventos/${e.id}">${e.title} (${formatShort(e.starts_at)})</a>`)}</p>` : ''}
      <p class="actions">
        ${postButton(res.ctx, `/g/${g.id}/setlists/${list.id}/duplicar`, 'Duplicar setlist', { cls: 'button button-small button-ghost' })}
        ${canDelete(req, list.created_by) ? postButton(res.ctx, `/g/${g.id}/setlists/${list.id}/borrar`, 'Borrar setlist', { cls: 'button button-small button-danger-ghost', confirm: `¿Borrar «${list.name}»?` }) : ''}
      </p>`;
    res.html(layout(res.ctx, { title: list.name, active: 'setlists', scripts: ['/chordpro.js', '/setlist.js'], body }));
  });

  app.put('/api/g/:gid/setlists/:lid/items', loadGroup, async (req, res) => {
    const g = req.group;
    const list = await loadSetlist(req);
    const incoming = Array.isArray(req.body.items) ? req.body.items.slice(0, 150) : null;
    if (!incoming) throw new HttpError(400, 'Lista no válida');
    const songIds = [...new Set(incoming.map((i) => parseId(i.song_id)).filter(Boolean))];
    const valid = songIds.length ? await sql`SELECT id FROM songs WHERE group_id = ${g.id} AND id IN ${sql(songIds)}` : [];
    const ok = new Set(valid.map((r) => r.id));
    const rows = [];
    incoming.forEach((i) => {
      const sid = parseId(i.song_id);
      const t = Math.max(-11, Math.min(11, Math.round(Number(i.transpose) || 0)));
      const note = typeof i.note === 'string' ? i.note.slice(0, 200) : '';
      if (sid) {
        if (ok.has(sid)) rows.push({ song_id: sid, title: '', note, transpose: t, break_min: null });
      } else if (Number(i.break_min) > 0) {
        rows.push({ song_id: null, title: 'Descanso', note, transpose: 0, break_min: Math.min(180, Math.round(Number(i.break_min))) });
      } else if (typeof i.title === 'string' && i.title.trim()) {
        rows.push({ song_id: null, title: i.title.trim().slice(0, 120), note, transpose: 0, break_min: null });
      }
    });
    await sql.begin(async (tx) => {
      await tx`DELETE FROM setlist_items WHERE setlist_id = ${list.id}`;
      if (rows.length) await tx`INSERT INTO setlist_items ${tx(rows.map((r, i) => ({ ...r, setlist_id: list.id, position: i })))}`;
      await tx`UPDATE setlists SET updated_at = now() WHERE id = ${list.id}`;
    });
    res.json({ ok: true, count: rows.length });
  });

  app.post('/g/:gid/setlists/:lid/editar', loadGroup, async (req, res) => {
    const list = await loadSetlist(req);
    const name = str(req.body.name, 120) || list.name;
    await sql`UPDATE setlists SET name = ${name}, notes = ${str(req.body.notes, 3000)}, updated_at = now() WHERE id = ${list.id}`;
    flash(req, 'ok', 'Setlist guardado.');
    res.redirect(`/g/${req.group.id}/setlists/${list.id}`);
  });

  app.post('/g/:gid/setlists/:lid/duplicar', loadGroup, async (req, res) => {
    const list = await loadSetlist(req);
    const id = await sql.begin(async (tx) => {
      const [n] = await tx`INSERT INTO setlists (group_id, name, notes, created_by) VALUES (${req.group.id}, ${`${list.name} (copia)`.slice(0, 120)}, ${list.notes}, ${req.session.user.id}) RETURNING id`;
      await tx`INSERT INTO setlist_items (setlist_id, position, song_id, title, note, transpose, break_min)
        SELECT ${n.id}, position, song_id, title, note, transpose, break_min FROM setlist_items WHERE setlist_id = ${list.id}`;
      return n.id;
    });
    flash(req, 'ok', 'Setlist duplicado.');
    res.redirect(`/g/${req.group.id}/setlists/${id}`);
  });

  app.post('/g/:gid/setlists/:lid/borrar', loadGroup, async (req, res) => {
    const list = await loadSetlist(req);
    if (!canDelete(req, list.created_by)) throw new HttpError(403, 'Solo quien lo creó o quien creó el grupo puede borrarlo.');
    await sql`DELETE FROM setlists WHERE id = ${list.id}`;
    flash(req, 'ok', `«${list.name}» borrado.`);
    res.redirect(`/g/${req.group.id}/setlists`);
  });

  app.get('/g/:gid/setlists/:lid/escenario', loadGroup, async (req, res) => {
    const list = await loadSetlist(req);
    const items = await loadItems(list.id);
    res.html(stagePage(res.ctx, req.group, list, items, `/g/${req.group.id}/setlists/${list.id}`));
  });

  app.get('/g/:gid/setlists/:lid/imprimir', loadGroup, async (req, res) => {
    const g = req.group;
    const list = await loadSetlist(req);
    const items = await loadItems(list.id);
    const { total, unknown } = totalSeconds(items);
    let n = 0;
    const body = html`<div class="print-set">
      <p class="no-print actions"><button class="button" type="button" data-print>Imprimir</button> <a class="button button-ghost" href="/g/${g.id}/setlists/${list.id}">Volver</a></p>
      <h1>${list.name}</h1>
      <p class="muted">${g.name} · ${formatDuration(total)}${unknown ? ` (+${unknown} sin duración)` : ''}</p>
      <ol class="print-items">${items.map((i) => {
        if (i.song_id) {
          n += 1;
          const C = require('../public/chordpro');
          const key = i.song_key ? (i.transpose ? C.transposeKey(i.song_key, i.transpose) : i.song_key) : '';
          return html`<li><span class="pn">${n}</span><span class="pt">${i.song_title}</span><span class="pk">${[key, i.bpm ? `${i.bpm}` : ''].filter(Boolean).join(' · ')}</span>${i.note ? html`<span class="pnote">${i.note}</span>` : ''}</li>`;
        }
        return html`<li class="print-break"><span class="pn"></span><span class="pt">${i.break_min ? `Descanso · ${i.break_min} min` : i.title}</span>${i.note ? html`<span class="pnote">${i.note}</span>` : ''}</li>`;
      })}</ol>
    </div>`;
    res.html(layout(res.ctx, { title: `Imprimir ${list.name}`, bare: true, bodyClass: 'print-body', body }));
  });
};

module.exports.stagePage = stagePage;
