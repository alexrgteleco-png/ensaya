'use strict';

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { layout, pageHead, empty, csrfField, postButton, icon, paragraphs, jsonData, formatBytes } = require('../lib/ui');
const { formatDuration, timeAgo } = require('../lib/time');
const ChordPro = require('../public/chordpro');
const cleanup = require('../lib/cleanup');
const limits = require('../lib/limits');
const { str, intOrNull, flash, loadGroup, loadSong, canDelete } = require('./common');

const STATUS = { idea: 'Idea', aprendiendo: 'Aprendiendo', lista: 'Lista para tocar', retirada: 'Archivada' };
const STATUS_HELP = {
  idea: 'Nos gustaría tocarla',
  aprendiendo: 'La estamos ensayando',
  lista: 'Sale bien en directo',
  retirada: 'Ya no la tocamos',
};
const KEYS = ['C', 'Cm', 'C#', 'C#m', 'Db', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm', 'F#', 'F#m', 'G', 'Gm', 'Ab', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm'];
const METERS = ['4/4', '3/4', '2/4', '6/8', '12/8', '5/4', '7/8', '2/2'];
const KIND_LABEL = { audio: 'Audio', pdf: 'Partitura PDF', musicxml: 'MusicXML', image: 'Imagen', other: 'Archivo' };

// Pulsos (en negras) por compás.
function beatsPerBar(ts) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(ts || '').trim());
  if (!m) return 4;
  const n = Number(m[1]);
  const d = Number(m[2]);
  return d === 8 && n % 3 === 0 ? n / 3 : (n * 4) / d;
}

// Duración de una vuelta a la forma, calculada con el cifrado y el tempo.
function formInfo(song) {
  const bars = ChordPro.bars(song.lyrics || '').length;
  if (!bars) return null;
  const seconds = song.bpm ? Math.round((bars * beatsPerBar(song.time_signature) * 60) / song.bpm) : null;
  return { bars, seconds };
}

function songMeta(s) {
  return [s.artist, s.song_key && `Tono ${s.song_key}`, s.bpm && `${s.bpm} bpm`, s.time_signature].filter(Boolean);
}

function readSong(body) {
  const errors = [];
  const lyrics = ChordPro.normalizeChart(str(body.lyrics, 30000));
  const data = {
    title: str(body.title, 150),
    artist: str(body.artist, 150),
    song_key: str(body.song_key, 12),
    bpm: intOrNull(body.bpm, 20, 400),
    time_signature: str(body.time_signature, 10),
    status: STATUS[str(body.status, 20)] ? str(body.status, 20) : 'aprendiendo',
    lyrics,
  };
  // Si el cifrado trae los datos ({title}, {key}, {tempo}, {time}) y el formulario no, se usan.
  const meta = ChordPro.meta(lyrics);
  if (!data.title && meta.title) data.title = meta.title.slice(0, 150);
  if (!data.artist && meta.artist) data.artist = meta.artist.slice(0, 150);
  if (!data.song_key && meta.key) data.song_key = meta.key.slice(0, 12);
  if (!data.time_signature && meta.time) data.time_signature = meta.time.slice(0, 10);
  if (data.bpm === null && /^\d{2,3}$/.test(meta.tempo || '') && meta.tempo >= 20 && meta.tempo <= 400) data.bpm = Number(meta.tempo);
  if (!data.title) errors.push('Ponle título a la canción.');
  if (data.bpm === undefined) errors.push('El tempo debe ser un número entre 20 y 400.');
  return { data, errors };
}

const SONG_FORM_JS = ['/chordpro.js', '/songform.js'];
const CHART_EXAMPLE = '{soc}\n[Bm-7] | [%] | [Em-7] | [F#7b9] |\n[Bm-7] | [%] | [Em-7] | [A7] |\n{eoc}';

function songForm(ctx, g, song, action, errors = []) {
  const status = song.status || 'aprendiendo';
  return html`<section class="song-edit">
    ${pageHead(song.id ? `Editar «${song.title}»` : 'Nueva canción')}
    ${errors.length ? html`<div class="flash flash-error" role="alert">${errors.map((e) => html`<p>${e}</p>`)}</div>` : ''}
    <form method="post" action="${action}" class="form song-form" data-song-form>
      ${csrfField(ctx)}
      <div class="song-form-fields">
        <div class="grid-2">
          <label>Título<input name="title" maxlength="150" value="${song.title || ''}" ${song.id ? '' : raw('autofocus')} data-meta="title"></label>
          <label>Artista o autor <span class="hint">opcional</span><input name="artist" maxlength="150" value="${song.artist || ''}" data-meta="artist"></label>
        </div>
        <div class="grid-3">
          <label>Tonalidad<input name="song_key" maxlength="12" list="keys" value="${song.song_key || ''}" placeholder="Bm" data-meta="key"></label>
          <label>Tempo <span class="hint">bpm</span><input name="bpm" inputmode="numeric" maxlength="3" value="${song.bpm ?? ''}" placeholder="120" data-meta="tempo"></label>
          <label>Compás<input name="time_signature" maxlength="10" list="meters" value="${song.time_signature || ''}" placeholder="4/4" data-meta="time"></label>
        </div>
        <datalist id="keys">${KEYS.map((k) => html`<option value="${k}">`)}</datalist>
        <datalist id="meters">${METERS.map((k) => html`<option value="${k}">`)}</datalist>
        <fieldset class="segmented">
          <legend>¿En qué punto está?</legend>
          ${Object.entries(STATUS).map(([k, v]) => html`<label class="seg-option"><input type="radio" name="status" value="${k}" ${status === k ? raw('checked') : ''}><span><b>${v}</b><small>${STATUS_HELP[k]}</small></span></label>`)}
        </fieldset>
      </div>
      <div class="chart-editor">
        <div class="chart-input">
          <div class="row-between">
            <label for="lyrics" class="label-strong">Cifrado</label>
            <button type="button" class="button button-small button-ghost" data-paste>Pegar</button>
          </div>
          <textarea id="lyrics" name="lyrics" rows="16" class="mono" spellcheck="false" placeholder="${CHART_EXAMPLE}" data-chart>${song.lyrics || ''}</textarea>
          <p class="hint" data-chart-status>Pega aquí el cifrado que te da la IA a partir de una captura de iReal Pro, o un enlace de iReal Pro (Compartir → Copiar enlace). También vale letra con acordes.</p>
          <details class="help">
            <summary>Cómo se escribe</summary>
            <p><b>Por compases</b> (como iReal Pro): un compás entre barras, <code>%</code> repite el anterior y dos acordes en un compás van separados por un espacio: <code>[Gmaj7] | [%] | [Em7] [A7] |</code>. Los corchetes son opcionales.</p>
            <p><b>Secciones</b>: <code>{soc}</code> … <code>{eoc}</code> (se llaman A, B, C…) o con nombre, <code>{soc: Puente}</code>. Avisos: <code>{c: D.C. al Coda}</code>.</p>
            <p><b>Letra con acordes</b>: el acorde entre corchetes antes de la sílaba, <code>[Am]Hoy te [F]vi</code>.</p>
          </details>
        </div>
        <div class="chart-preview" aria-live="polite">
          <p class="label-strong">Vista previa <span class="hint" data-chart-count></span></p>
          <div class="chordpro chart-box" data-chart-preview>${song.lyrics ? raw(ChordPro.render(song.lyrics, 0, { key: song.song_key })) : html`<p class="muted">Aquí verás el cifrado tal como lo leerá el grupo.</p>`}</div>
        </div>
      </div>
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
      <span>${icon('plus')} <b>Arrastra aquí o pulsa para elegir</b><br><span class="muted small">Audio (MP3, WAV, M4A…), PDF, MusicXML o imágenes</span></span>
    </label>
    <label class="upload-label">Nombre <span class="hint">opcional, p. ej. «Maqueta», «Parte de bajo»</span><input name="label" maxlength="120"></label>
    <ul class="upload-progress" aria-live="polite"></ul>
    ${used !== null
      ? html`<div class="quota ${pct >= 90 ? 'quota-high' : ''}">
          <div class="quota-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Espacio usado"><span style="width:${pct}%"></span></div>
          <span class="muted small">Espacio: ${limits.formatGB(used)} de ${limits.formatGB(L)}</span>
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
        <input id="q" name="q" type="search" value="${q}" placeholder="Buscar por título o artista">
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
    res.html(layout(res.ctx, { title: 'Nueva canción', active: 'repertorio', scripts: SONG_FORM_JS, body: songForm(res.ctx, req.group, {}, `/g/${req.group.id}/canciones`) }));
  });

  app.post('/g/:gid/canciones', loadGroup, async (req, res) => {
    const g = req.group;
    const { data, errors } = readSong(req.body);
    if (errors.length) {
      return res.html(layout(res.ctx, { title: 'Nueva canción', active: 'repertorio', scripts: SONG_FORM_JS, body: songForm(res.ctx, g, data, `/g/${g.id}/canciones`, errors) }), 400);
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
    const form = formInfo(song);
    const base = `/g/${g.id}/canciones/${song.id}`;
    const body = html`
      <div class="pagehead song-head">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/canciones">Repertorio</a></p>
          <h1>${song.title}</h1>
          <p class="meta-chips">
            <span class="status status-${song.status}">${STATUS[song.status]}</span>
            ${songMeta(song).map((m) => html`<span class="chip">${m}</span>`)}
          </p>
        </div>
        <div class="pagehead-actions">
          <a class="button button-ghost" href="${base}/editar">Editar</a>
        </div>
      </div>
      <nav class="song-actions" aria-label="Acciones de la canción">
        <a class="action-card" href="${base}/solos">${icon('spark', 22)}<span><b>Generar un solo</b><small>Sobre estos acordes, en tu estilo</small></span></a>
        ${song.lyrics ? html`<a class="action-card" href="${base}/escenario">${icon('stage', 22)}<span><b>Modo escenario</b><small>Pantalla completa para tocar</small></span></a>` : ''}
        <form method="post" action="/g/${g.id}/partituras" class="action-form">
          ${csrfField(res.ctx)}
          <input type="hidden" name="song_id" value="${song.id}">
          <input type="hidden" name="title" value="${`Melodía de ${song.title}`.slice(0, 150)}">
          <input type="hidden" name="kind" value="melody">
          <button class="action-card" type="submit">${icon('score', 22)}<span><b>Escribir melodía</b><small>Con un teclado en pantalla</small></span></button>
        </form>
      </nav>
      <div class="song-layout">
        <div class="song-main">
          ${song.lyrics
            ? html`<section class="lyrics-panel panel" data-chordpro data-key="${song.song_key}">
                <div class="row-between">
                  <h2>Cifrado ${form ? html`<span class="hint">${form.bars} compases${form.seconds ? ` · una vuelta ≈ ${formatDuration(form.seconds)}` : ''}</span>` : ''}</h2>
                  <div class="transpose" role="group" aria-label="Transponer">
                    <button type="button" class="button button-small button-ghost" data-transpose="-1" aria-label="Bajar un semitono">−½</button>
                    <output data-transpose-label>${song.song_key ? `Tono ${song.song_key}` : 'Original'}</output>
                    <button type="button" class="button button-small button-ghost" data-transpose="1" aria-label="Subir un semitono">+½</button>
                  </div>
                </div>
                <textarea hidden data-source>${song.lyrics}</textarea>
                <div class="chordpro" data-render>${raw(ChordPro.render(song.lyrics, 0, { key: song.song_key }))}</div>
              </section>`
            : empty('Esta canción aún no tiene cifrado. Pega el de iReal Pro o el que te dé la IA y podrás tocarla en modo escenario y generar solos sobre ella.', html`<a class="button" href="${base}/editar">Añadir cifrado</a>`)}
          ${song.notes ? html`<section><h2>Notas</h2><div class="prose">${paragraphs(song.notes)}</div></section>` : ''}
        </div>
        <div class="song-side">
          <section>
            <h2>Audio y partituras</h2>
            ${audios.length || sheets.length || scores.length
              ? html`<ul class="file-list">
                  ${audios.map((f) => fileRow(g, f))}
                  ${sheets.map((f) => fileRow(g, f))}
                  ${scores.map((sc) => html`<li class="file-row file-abc"><a class="file-link" href="/g/${g.id}/partituras/${sc.id}">${icon('score')}
                    <span class="file-main"><span class="file-title">${sc.title}</span><span class="muted">Escrita en Ensaya · ${sc.editor || ''} · ${timeAgo(sc.updated_at)}</span></span></a></li>`)}
                </ul>`
              : html`<p class="muted">Nada todavía. Sube una maqueta, la grabación original o la partitura en PDF.</p>`}
            <details class="upload-toggle" ${audios.length || sheets.length || scores.length ? '' : raw('open')}>
              <summary class="button button-small button-ghost">${icon('plus', 15)} Subir archivo</summary>
              ${uploader(res.ctx, g, song.id, used)}
            </details>
          </section>
          ${setlists.length ? html`<section><h2>En setlists</h2><ul class="plain-list">${setlists.map((l) => html`<li><a href="/g/${g.id}/setlists/${l.id}">${l.name}</a></li>`)}</ul></section>` : ''}
          ${canDelete(req, song.created_by)
            ? html`<p class="danger-inline">${postButton(res.ctx, `${base}/borrar`, 'Borrar canción', { cls: 'button button-small button-danger-ghost', confirm: `¿Borrar «${song.title}» con todos sus audios y partituras?` })}</p>`
            : ''}
        </div>
      </div>`;
    res.html(layout(res.ctx, { title: song.title, active: 'repertorio', scripts: ['/chordpro.js', '/song.js', '/upload.js'], body }));
  });

  app.get('/g/:gid/canciones/:sid/editar', loadGroup, async (req, res) => {
    const song = await loadSong(req, req.params.sid);
    res.html(layout(res.ctx, { title: 'Editar canción', active: 'repertorio', scripts: SONG_FORM_JS, body: songForm(res.ctx, req.group, song, `/g/${req.group.id}/canciones/${song.id}/editar`) }));
  });

  app.post('/g/:gid/canciones/:sid/editar', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    const { data, errors } = readSong(req.body);
    if (errors.length) {
      return res.html(layout(res.ctx, { title: 'Editar canción', active: 'repertorio', scripts: SONG_FORM_JS, body: songForm(res.ctx, g, { ...song, ...data }, `/g/${g.id}/canciones/${song.id}/editar`, errors) }), 400);
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
