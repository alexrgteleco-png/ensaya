'use strict';

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { layout, pageHead, empty, csrfField, postButton, icon, paragraphs, jsonData, formatBytes } = require('../lib/ui');
const { formatDuration, parseDuration, timeAgo } = require('../lib/time');
const ChordPro = require('../public/chordpro');
const cleanup = require('../lib/cleanup');
const limits = require('../lib/limits');
const { str, intOrNull, flash, loadGroup, loadSong, canDelete } = require('./common');

const STATUS = { idea: 'Idea', aprendiendo: 'Aprendiendo', lista: 'Lista para tocar', retirada: 'Retirada' };
const KEYS = ['C', 'Cm', 'C#', 'C#m', 'Db', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm', 'F#', 'F#m', 'G', 'Gm', 'Ab', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm'];
const METERS = ['4/4', '3/4', '2/4', '6/8', '12/8', '5/4', '7/8', '2/2'];
const KIND_LABEL = { audio: 'Audio', pdf: 'Partitura PDF', musicxml: 'MusicXML', image: 'Imagen', other: 'Archivo' };

function songMeta(s) {
  return [s.artist, s.song_key && `Tono ${s.song_key}`, s.bpm && `${s.bpm} bpm`, s.time_signature, s.duration_sec && formatDuration(s.duration_sec)].filter(Boolean);
}

function readSong(body) {
  const errors = [];
  const data = {
    title: str(body.title, 150),
    artist: str(body.artist, 150),
    song_key: str(body.song_key, 12),
    bpm: intOrNull(body.bpm, 20, 400),
    time_signature: str(body.time_signature, 10),
    duration_sec: parseDuration(str(body.duration, 10)),
    status: STATUS[str(body.status, 20)] ? str(body.status, 20) : 'aprendiendo',
    tags: str(body.tags, 200),
    lyrics: str(body.lyrics, 30000),
    notes: str(body.notes, 5000),
  };
  if (!data.title) errors.push('Ponle título a la canción.');
  if (data.bpm === undefined) errors.push('El tempo debe ser un número entre 20 y 400.');
  if (data.duration_sec === undefined) errors.push('Escribe la duración como 3:45.');
  return { data, errors };
}

function songForm(ctx, g, song, action, errors = []) {
  const duration = song.duration_sec ? formatDuration(song.duration_sec) : song.duration || '';
  return html`<section class="narrow wide-ok">
    ${pageHead(song.id ? `Editar «${song.title}»` : 'Nueva canción')}
    ${errors.length ? html`<div class="flash flash-error" role="alert">${errors.map((e) => html`<p>${e}</p>`)}</div>` : ''}
    <form method="post" action="${action}" class="form">
      ${csrfField(ctx)}
      <div class="grid-2">
        <label>Título<input name="title" required maxlength="150" value="${song.title || ''}" ${song.id ? '' : raw('autofocus')}></label>
        <label>Artista o autor <span class="hint">opcional</span><input name="artist" maxlength="150" value="${song.artist || ''}"></label>
      </div>
      <div class="grid-4">
        <label>Tonalidad<input name="song_key" maxlength="12" list="keys" value="${song.song_key || ''}" placeholder="Am"></label>
        <label>Tempo (bpm)<input name="bpm" inputmode="numeric" maxlength="3" value="${song.bpm ?? ''}" placeholder="120"></label>
        <label>Compás<input name="time_signature" maxlength="10" list="meters" value="${song.time_signature || ''}" placeholder="4/4"></label>
        <label>Duración<input name="duration" maxlength="8" value="${duration}" placeholder="3:45"></label>
      </div>
      <datalist id="keys">${KEYS.map((k) => html`<option value="${k}">`)}</datalist>
      <datalist id="meters">${METERS.map((k) => html`<option value="${k}">`)}</datalist>
      <div class="grid-2">
        <label>Estado
          <select name="status">${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${(song.status || 'aprendiendo') === k ? raw('selected') : ''}>${v}</option>`)}</select>
        </label>
        <label>Etiquetas <span class="hint">separadas por comas</span><input name="tags" maxlength="200" value="${song.tags || ''}" placeholder="balada, versión, bis"></label>
      </div>
      <label>Letra y acordes <span class="hint">formato ChordPro: los acordes entre corchetes delante de la sílaba</span>
        <textarea name="lyrics" rows="14" class="mono" spellcheck="false" placeholder="{soc}&#10;[Am]Hoy te he [F]visto pasar&#10;[C]sin mirar a[G]trás&#10;{eoc}&#10;&#10;[Puente]&#10;[Dm]Y no [E]sé…">${song.lyrics || ''}</textarea>
      </label>
      <details class="help">
        <summary>Cómo escribir acordes</summary>
        <p>Escribe el acorde entre corchetes justo antes de la sílaba donde suena: <code>[Am]Hoy te [F]vi</code>. Vale notación americana (<code>C</code>, <code>F#m7</code>) o latina (<code>Do</code>, <code>Lam</code>).</p>
        <p>Marca secciones con una línea como <code>[Estribillo]</code> o con <code>{soc}</code> … <code>{eoc}</code> para el estribillo. Añade avisos con <code>{c: Solo de guitarra}</code>.</p>
      </details>
      <label>Notas para el grupo <span class="hint">opcional</span><textarea name="notes" rows="4" maxlength="5000" placeholder="Arreglo, quién empieza, final…">${song.notes || ''}</textarea></label>
      <p class="actions">
        <button class="button" type="submit">${song.id ? 'Guardar cambios' : 'Añadir canción'}</button>
        <a class="button button-ghost" href="${song.id ? `/g/${g.id}/canciones/${song.id}` : `/g/${g.id}/canciones`}">Cancelar</a>
      </p>
    </form>
  </section>`;
}

function fileRow(g, f) {
  return html`<li class="file-row file-${f.kind}">
    <a href="/g/${g.id}/archivos/${f.id}" class="file-link">
      ${icon(f.kind === 'audio' ? 'play' : f.kind === 'pdf' || f.kind === 'musicxml' ? 'score' : 'file')}
      <span class="file-main">
        <span class="file-title">${f.label || f.filename}</span>
        <span class="muted">${KIND_LABEL[f.kind]} · ${formatBytes(f.size)} · ${f.uploader || 'alguien'} · ${timeAgo(f.created_at)}</span>
      </span>
    </a>
  </li>`;
}

function uploader(ctx, g, songId, used = null) {
  const L = limits.LIMITS.storageBytes;
  const pct = used === null ? 0 : Math.min(100, Math.round((used / L) * 100));
  return html`<form class="uploader" data-upload="/api/g/${g.id}/archivos" data-song="${songId || ''}" data-free="${used === null ? '' : Math.max(0, L - used)}">
    <label class="dropzone">
      <input type="file" name="file" multiple accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.pdf,.musicxml,.mxl,.xml,image/*">
      <span>${icon('plus')} <b>Sube audio o partituras</b><br><span class="muted">MP3, WAV, FLAC, M4A, PDF, MusicXML o imágenes. Arrastra aquí o pulsa para elegir.</span></span>
    </label>
    <label class="upload-label">Nombre <span class="hint">opcional, p. ej. «Maqueta», «Parte de bajo»</span><input name="label" maxlength="120"></label>
    <ul class="upload-progress" aria-live="polite"></ul>
    ${used !== null
      ? html`<div class="quota ${pct >= 90 ? 'quota-high' : ''}">
          <div class="quota-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Espacio usado"><span style="width:${pct}%"></span></div>
          <span class="muted small">Espacio usado por la app: ${limits.formatGB(used)} de ${limits.formatGB(L)}. El tope evita cualquier coste.</span>
        </div>`
      : ''}
  </form>`;
}

module.exports = function songRoutes(app) {
  app.get('/g/:gid/canciones', loadGroup, async (req, res) => {
    const g = req.group;
    const q = str(req.query.q, 100);
    const status = STATUS[req.query.estado] ? req.query.estado : '';
    const order = { titulo: sql`s.title`, recientes: sql`s.updated_at DESC`, tono: sql`s.song_key, s.title` }[req.query.orden] || sql`s.title`;
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const songs = await sql`
      SELECT s.*,
        (SELECT count(*) FROM files f WHERE f.song_id = s.id AND f.kind = 'audio' AND f.status = 'ready')::int AS audios,
        (SELECT count(*) FROM files f WHERE f.song_id = s.id AND f.kind IN ('pdf', 'musicxml', 'image') AND f.status = 'ready')::int
          + (SELECT count(*) FROM scores sc WHERE sc.song_id = s.id)::int AS sheets
      FROM songs s
      WHERE s.group_id = ${g.id}
        ${status ? sql`AND s.status = ${status}` : sql``}
        ${q ? sql`AND (s.title ILIKE ${like} OR s.artist ILIKE ${like} OR s.tags ILIKE ${like})` : sql``}
      ORDER BY ${order}`;
    const body = html`
      ${pageHead('Repertorio', {
        lead: `${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'}${status ? ` en «${STATUS[status]}»` : ''}.`,
        actions: html`<a class="button" href="/g/${g.id}/canciones/nueva">${icon('plus')} Añadir canción</a>`,
      })}
      <form class="filters" method="get" role="search">
        <label class="sr-only" for="q">Buscar</label>
        <input id="q" name="q" type="search" value="${q}" placeholder="Buscar por título, artista o etiqueta">
        <select name="estado" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${status === k ? raw('selected') : ''}>${v}</option>`)}</select>
        <select name="orden" aria-label="Ordenar"><option value="titulo">Por título</option><option value="recientes" ${req.query.orden === 'recientes' ? raw('selected') : ''}>Últimas cambiadas</option><option value="tono" ${req.query.orden === 'tono' ? raw('selected') : ''}>Por tonalidad</option></select>
        <button class="button button-ghost" type="submit">Filtrar</button>
      </form>
      ${songs.length
        ? html`<ul class="song-list">
            ${songs.map((s) => html`<li><a href="/g/${g.id}/canciones/${s.id}">
              <span class="song-title">${s.title}</span>
              <span class="muted">${songMeta(s).join(' · ')}</span>
              <span class="song-icons">
                ${s.audios ? html`<span title="${s.audios} audio(s)">${icon('play', 15)} ${s.audios}</span>` : ''}
                ${s.sheets ? html`<span title="${s.sheets} partitura(s)">${icon('score', 15)} ${s.sheets}</span>` : ''}
                ${ChordPro.hasChords(s.lyrics) ? html`<span title="Tiene acordes" class="chord-mark">Am</span>` : ''}
              </span>
              <span class="status status-${s.status}">${STATUS[s.status]}</span>
            </a></li>`)}
          </ul>`
        : q || status
          ? empty('Ninguna canción coincide con la búsqueda.', html`<a class="button button-ghost" href="/g/${g.id}/canciones">Quitar filtros</a>`)
          : empty('El repertorio está vacío. Añade la primera canción y sube su audio o su partitura.', html`<a class="button" href="/g/${g.id}/canciones/nueva">Añadir canción</a>`)}`;
    res.html(layout(res.ctx, { title: 'Repertorio', active: 'repertorio', body }));
  });

  app.get('/g/:gid/canciones/nueva', loadGroup, (req, res) => {
    res.html(layout(res.ctx, { title: 'Nueva canción', active: 'repertorio', body: songForm(res.ctx, req.group, {}, `/g/${req.group.id}/canciones`) }));
  });

  app.post('/g/:gid/canciones', loadGroup, async (req, res) => {
    const g = req.group;
    const { data, errors } = readSong(req.body);
    if (errors.length) {
      return res.html(layout(res.ctx, { title: 'Nueva canción', active: 'repertorio', body: songForm(res.ctx, g, { ...data, duration: str(req.body.duration, 10) }, `/g/${g.id}/canciones`, errors) }), 400);
    }
    const [s] = await sql`
      INSERT INTO songs ${sql({ ...data, group_id: g.id, created_by: req.session.user.id })}
      RETURNING id`;
    flash(req, 'ok', 'Canción añadida. Sube aquí su audio o su partitura.');
    res.redirect(`/g/${g.id}/canciones/${s.id}`);
  });

  app.get('/g/:gid/canciones/:sid', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    const [files, scores, setlists, used] = await Promise.all([
      sql`SELECT f.*, u.name AS uploader FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.song_id = ${song.id} AND f.status = 'ready' ORDER BY f.kind, f.created_at`,
      sql`SELECT sc.id, sc.title, sc.updated_at, u.name AS editor FROM scores sc LEFT JOIN users u ON u.id = sc.updated_by WHERE sc.song_id = ${song.id} ORDER BY sc.title`,
      sql`SELECT DISTINCT l.id, l.name FROM setlists l JOIN setlist_items i ON i.setlist_id = l.id WHERE i.song_id = ${song.id} ORDER BY l.name`,
      limits.storageUsed(),
    ]);
    const audios = files.filter((f) => f.kind === 'audio');
    const sheets = files.filter((f) => f.kind !== 'audio');
    const body = html`
      <div class="pagehead">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/canciones">Repertorio</a></p>
          <h1>${song.title}</h1>
          <p class="meta-chips">
            <span class="status status-${song.status}">${STATUS[song.status]}</span>
            ${songMeta(song).map((m) => html`<span class="chip">${m}</span>`)}
            ${song.tags ? song.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => html`<span class="chip chip-tag">${t}</span>`) : ''}
          </p>
        </div>
        <div class="pagehead-actions">
          ${song.lyrics ? html`<a class="button" href="/g/${g.id}/canciones/${song.id}/escenario">${icon('stage')} Modo escenario</a>` : ''}
          <a class="button button-ghost" href="/g/${g.id}/canciones/${song.id}/editar">Editar</a>
        </div>
      </div>
      <div class="song-layout">
        <div class="song-side">
          <section>
            <h2>Audio</h2>
            ${audios.length
              ? html`<ul class="file-list">${audios.map((f) => fileRow(g, f))}</ul>
                <p class="muted small">Abre un audio para practicar con bucle, velocidad, tono y marcadores.</p>`
              : html`<p class="muted">Sin audio todavía.</p>`}
          </section>
          <section>
            <h2>Partituras</h2>
            ${sheets.length || scores.length
              ? html`<ul class="file-list">
                  ${sheets.map((f) => fileRow(g, f))}
                  ${scores.map((sc) => html`<li class="file-row file-abc"><a class="file-link" href="/g/${g.id}/partituras/${sc.id}">${icon('score')}
                    <span class="file-main"><span class="file-title">${sc.title}</span><span class="muted">Editor · ${sc.editor || ''} · ${timeAgo(sc.updated_at)}</span></span></a></li>`)}
                </ul>`
              : html`<p class="muted">Sin partituras todavía.</p>`}
            <form method="post" action="/g/${g.id}/partituras" class="inline">
              ${csrfField(res.ctx)}
              <input type="hidden" name="song_id" value="${song.id}">
              <input type="hidden" name="title" value="${song.title}">
              <button class="button button-small button-ghost" type="submit">${icon('plus', 15)} Escribir partitura</button>
            </form>
          </section>
          ${uploader(res.ctx, g, song.id, used)}
          ${setlists.length ? html`<section><h2>En setlists</h2><ul class="plain-list">${setlists.map((l) => html`<li><a href="/g/${g.id}/setlists/${l.id}">${l.name}</a></li>`)}</ul></section>` : ''}
        </div>
        <div class="song-main">
          ${song.lyrics
            ? html`<section class="lyrics-panel" data-chordpro data-key="${song.song_key}">
                <div class="row-between">
                  <h2>Letra y acordes</h2>
                  <div class="transpose" role="group" aria-label="Transponer">
                    <button type="button" class="button button-small button-ghost" data-transpose="-1" aria-label="Bajar un semitono">−½</button>
                    <output data-transpose-label>${song.song_key ? `Tono ${song.song_key}` : 'Original'}</output>
                    <button type="button" class="button button-small button-ghost" data-transpose="1" aria-label="Subir un semitono">+½</button>
                  </div>
                </div>
                <textarea hidden data-source>${song.lyrics}</textarea>
                <div class="chordpro" data-render>${raw(ChordPro.render(song.lyrics, 0, { key: song.song_key }))}</div>
              </section>`
            : empty('Sin letra todavía.', html`<a class="button button-small button-ghost" href="/g/${g.id}/canciones/${song.id}/editar">Añadir letra y acordes</a>`)}
          ${song.notes ? html`<section><h2>Notas</h2><div class="prose">${paragraphs(song.notes)}</div></section>` : ''}
          ${canDelete(req, song.created_by)
            ? html`<p class="danger-inline">${postButton(res.ctx, `/g/${g.id}/canciones/${song.id}/borrar`, 'Borrar canción', { cls: 'button button-small button-danger-ghost', confirm: `¿Borrar «${song.title}» con todos sus audios y partituras?` })}</p>`
            : ''}
        </div>
      </div>`;
    res.html(layout(res.ctx, { title: song.title, active: 'repertorio', scripts: ['/chordpro.js', '/song.js', '/upload.js'], body }));
  });

  app.get('/g/:gid/canciones/:sid/editar', loadGroup, async (req, res) => {
    const song = await loadSong(req, req.params.sid);
    res.html(layout(res.ctx, { title: 'Editar canción', active: 'repertorio', body: songForm(res.ctx, req.group, song, `/g/${req.group.id}/canciones/${song.id}/editar`) }));
  });

  app.post('/g/:gid/canciones/:sid/editar', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    const { data, errors } = readSong(req.body);
    if (errors.length) {
      return res.html(layout(res.ctx, { title: 'Editar canción', active: 'repertorio', body: songForm(res.ctx, g, { ...song, ...data, duration_sec: null, duration: str(req.body.duration, 10) }, `/g/${g.id}/canciones/${song.id}/editar`, errors) }), 400);
    }
    await sql`UPDATE songs SET ${sql(data)}, updated_at = now() WHERE id = ${song.id}`;
    flash(req, 'ok', 'Cambios guardados.');
    res.redirect(`/g/${g.id}/canciones/${song.id}`);
  });

  app.post('/g/:gid/canciones/:sid/borrar', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    if (!canDelete(req, song.created_by)) {
      flash(req, 'error', 'Solo quien añadió la canción o quien creó el grupo puede borrarla.');
      return res.redirect(`/g/${g.id}/canciones/${song.id}`);
    }
    await sql.begin(async (tx) => {
      const files = await tx`SELECT storage_key, size FROM files WHERE song_id = ${song.id}`;
      await cleanup.queueDeletion(tx, files);
      await tx`DELETE FROM songs WHERE id = ${song.id}`;
    });
    cleanup.processDeletions().catch(() => {});
    flash(req, 'ok', `«${song.title}» borrada.`);
    res.redirect(`/g/${g.id}/canciones`);
  });

  // Modo escenario de una sola canción.
  app.get('/g/:gid/canciones/:sid/escenario', loadGroup, async (req, res) => {
    const song = await loadSong(req, req.params.sid);
    const { stagePage } = require('./setlists');
    res.html(stagePage(res.ctx, req.group, { name: song.title, id: null }, [{ kind: 'song', song, transpose: 0, note: '' }], `/g/${req.group.id}/canciones/${song.id}`));
  });
};

module.exports.STATUS = STATUS;
module.exports.songMeta = songMeta;
module.exports.uploader = uploader;
module.exports.fileRow = fileRow;
module.exports.KIND_LABEL = KIND_LABEL;
