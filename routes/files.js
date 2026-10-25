'use strict';

const path = require('path');
const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const storage = require('../lib/storage');
const { layout, csrfField, postButton, icon, jsonData, formatBytes } = require('../lib/ui');
const { timeAgo } = require('../lib/time');
const ChordPro = require('../public/chordpro');
const { str, parseId, flash, loadGroup, loadFile, canDelete } = require('./common');

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 300) * 1024 * 1024;

const TYPES = {
  '.mp3': ['audio', 'audio/mpeg'],
  '.wav': ['audio', 'audio/wav'],
  '.flac': ['audio', 'audio/flac'],
  '.m4a': ['audio', 'audio/mp4'],
  '.aac': ['audio', 'audio/aac'],
  '.ogg': ['audio', 'audio/ogg'],
  '.oga': ['audio', 'audio/ogg'],
  '.opus': ['audio', 'audio/ogg'],
  '.webm': ['audio', 'audio/webm'],
  '.aif': ['audio', 'audio/aiff'],
  '.aiff': ['audio', 'audio/aiff'],
  '.pdf': ['pdf', 'application/pdf'],
  '.musicxml': ['musicxml', 'application/vnd.recordare.musicxml+xml'],
  '.xml': ['musicxml', 'application/xml'],
  '.mxl': ['musicxml', 'application/vnd.recordare.musicxml'],
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.heic': ['image', 'image/heic'],
  '.mid': ['other', 'audio/midi'],
  '.midi': ['other', 'audio/midi'],
  '.gp': ['other', 'application/octet-stream'],
  '.gpx': ['other', 'application/octet-stream'],
  '.gp5': ['other', 'application/octet-stream'],
  '.mscz': ['other', 'application/octet-stream'],
  '.txt': ['other', 'text/plain'],
  '.zip': ['other', 'application/zip'],
};
// Tipos que el navegador puede mostrar sin riesgo; el resto se descarga.
const INLINE = /^(audio\/|application\/pdf$|image\/(png|jpeg|gif|webp)$)/;

function contentDisposition(type, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function siblings(file) {
  if (!file.song_id) return [];
  return sql`SELECT id, label, filename, kind FROM files WHERE song_id = ${file.song_id} AND kind = ${file.kind} ORDER BY created_at`;
}

module.exports = function fileRoutes(app) {
  // Subida: el navegador envía el archivo tal cual en el cuerpo (sin multipart) y se pasa en streaming a R2.
  app.put('/g/:gid/archivos', { rawBody: true }, loadGroup, async (req, res) => {
    const g = req.group;
    const name = str(req.query.name, 200).replace(/[\/\\\0]/g, '_');
    const label = str(req.query.label, 120);
    const size = Number(req.headers['content-length']);
    if (!name) throw new HttpError(400, 'Falta el nombre del archivo.');
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(411, 'El archivo está vacío.');
    if (size > MAX_UPLOAD) throw new HttpError(413, `El archivo pasa de ${Math.round(MAX_UPLOAD / 1048576)} MB.`);
    const ext = path.extname(name).toLowerCase();
    const type = TYPES[ext];
    if (!type) throw new HttpError(415, `No se admiten archivos ${ext || 'sin extensión'}. Sube audio, PDF, MusicXML o imágenes.`);
    let songId = null;
    if (req.query.song) {
      songId = parseId(req.query.song);
      const s = songId ? await sql`SELECT id FROM songs WHERE id = ${songId} AND group_id = ${g.id}` : [];
      if (!s.length) throw new HttpError(404, 'Canción no encontrada');
    }
    const key = storage.newKey(g.id, name);
    await storage.put(key, req, size, type[1]);
    const [row] = await sql`
      INSERT INTO files (group_id, song_id, kind, label, filename, mime, size, storage_key, uploaded_by)
      VALUES (${g.id}, ${songId}, ${type[0]}, ${label}, ${name}, ${type[1]}, ${size}, ${key}, ${req.session.user.id})
      RETURNING id, kind`;
    if (songId) await sql`UPDATE songs SET updated_at = now() WHERE id = ${songId}`;
    res.json({ id: row.id, kind: row.kind, url: `/g/${g.id}/archivos/${row.id}` }, 201);
  });

  // Contenido con soporte de Range (necesario para saltar en audios largos y leer PDF por partes).
  app.get('/g/:gid/archivos/:fid/contenido', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const obj = await storage.get(file.storage_key, range);
    if (!obj) throw new HttpError(404, 'El archivo ya no está en el almacenamiento.');
    const inline = INLINE.test(file.mime) && req.query.descargar !== '1';
    const headers = {
      ...obj.headers,
      'Content-Type': file.mime,
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.filename),
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
      'X-Content-Type-Options': 'nosniff',
    };
    res.writeHead(obj.status, headers);
    if (!obj.stream || req.method === 'HEAD') return res.end();
    obj.stream.on('error', () => res.destroy());
    obj.stream.pipe(res);
  });

  app.get('/g/:gid/archivos/:fid', loadGroup, async (req, res) => {
    const g = req.group;
    const file = await loadFile(req, req.params.fid);
    const song = file.song_id ? (await sql`SELECT id, title, lyrics, song_key, bpm FROM songs WHERE id = ${file.song_id}`)[0] : null;
    const sibs = await siblings(file);
    const src = `/g/${g.id}/archivos/${file.id}/contenido`;
    const title = file.label || file.filename;
    const crumbs = html`<p class="crumbs">${song ? html`<a href="/g/${g.id}/canciones/${song.id}">${song.title}</a>` : html`<a href="/g/${g.id}/canciones">Repertorio</a>`}</p>`;
    const switcher = sibs.length > 1
      ? html`<nav class="versions" aria-label="Otras versiones">${sibs.map((s) => html`<a href="/g/${g.id}/archivos/${s.id}" class="${s.id === file.id ? 'active' : ''}">${s.label || s.filename}</a>`)}</nav>`
      : '';
    const footer = html`<details class="file-admin">
      <summary>Datos del archivo</summary>
      <p class="muted">${file.filename} · ${formatBytes(file.size)} · subido ${timeAgo(file.created_at)}</p>
      <form method="post" action="/g/${g.id}/archivos/${file.id}/editar" class="form form-row">
        ${csrfField(res.ctx)}
        <label>Nombre<input name="label" maxlength="120" value="${file.label}" placeholder="${file.filename}"></label>
        <button class="button button-small button-ghost" type="submit">Renombrar</button>
      </form>
      <p class="actions">
        <a class="button button-small button-ghost" href="${src}?descargar=1">Descargar</a>
        ${canDelete(req, file.uploaded_by) ? postButton(res.ctx, `/g/${g.id}/archivos/${file.id}/borrar`, 'Borrar archivo', { cls: 'button button-small button-danger-ghost', confirm: `¿Borrar «${title}»?` }) : ''}
      </p>
    </details>`;

    let body;
    let scripts = [];
    let modules = [];
    let bodyClass = '';
    if (file.kind === 'audio') {
      scripts = ['/chordpro.js', '/player.js'];
      body = html`${crumbs}<h1 class="h-compact">${title}</h1>${switcher}
        <section class="player" data-player data-src="${src}" data-markers="/api/g/${g.id}/archivos/${file.id}/marcadores" data-bpm="${song && song.bpm ? song.bpm : ''}">
          <div class="wave-wrap">
            <canvas class="wave" data-wave height="160" aria-label="Forma de onda. Pulsa para saltar; arrastra para marcar un bucle."></canvas>
            <div class="wave-status muted" data-wave-status>Cargando forma de onda…</div>
          </div>
          <div class="time-row"><output data-time>0:00</output><span class="muted">/</span><output data-duration>0:00</output><span class="loop-info muted" data-loop-info></span></div>
          <div class="transport">
            <button type="button" class="button button-icon" data-act="back" title="Atrás 5 s (←)" aria-label="Atrás 5 segundos">−5</button>
            <button type="button" class="button button-play" data-act="play" title="Reproducir o pausar (espacio)" aria-label="Reproducir">${icon('play', 22)}</button>
            <button type="button" class="button button-icon" data-act="fwd" title="Adelante 5 s (→)" aria-label="Adelante 5 segundos">+5</button>
            <span class="divider"></span>
            <button type="button" class="button button-ghost" data-act="setA" title="Inicio del bucle ([)">A</button>
            <button type="button" class="button button-ghost" data-act="setB" title="Fin del bucle (])">B</button>
            <button type="button" class="button button-ghost" data-act="loop" aria-pressed="false" title="Activar bucle (L)">Bucle</button>
            <button type="button" class="button button-ghost" data-act="clearLoop" title="Quitar bucle">Quitar bucle</button>
          </div>
          <div class="sliders">
            <label>Velocidad <output data-speed-label>100 %</output>
              <input type="range" min="40" max="150" step="5" value="100" data-speed>
            </label>
            <label>Tono <output data-pitch-label>0 semitonos</output>
              <input type="range" min="-6" max="6" step="1" value="0" data-pitch>
            </label>
            <label>Volumen
              <input type="range" min="0" max="100" step="1" value="90" data-volume>
            </label>
            <label class="check"><input type="checkbox" data-countin> Cuenta de entrada${song && song.bpm ? ` (${song.bpm} bpm)` : ''}</label>
          </div>
          <p class="muted small">La velocidad no cambia el tono y el cambio de tono no cambia la velocidad. Atajos: espacio, ← →, [ ] y L.</p>
          <section class="markers">
            <div class="row-between"><h2>Marcadores</h2>
              <form class="marker-form" data-marker-form><input name="label" maxlength="60" placeholder="Estribillo, solo…" aria-label="Nombre del marcador"><button class="button button-small" type="submit">Marcar aquí</button></form>
            </div>
            <ul class="marker-list" data-marker-list></ul>
          </section>
          <audio data-audio preload="metadata" src="${src}"></audio>
        </section>
        ${song && song.lyrics
          ? html`<details class="lyrics-panel lyrics-under" data-chordpro data-key="${song.song_key}" open>
              <summary>Letra y acordes</summary>
              <textarea hidden data-source>${song.lyrics}</textarea>
              <div class="chordpro" data-render>${raw(ChordPro.render(song.lyrics, 0, { key: song.song_key }))}</div>
            </details>`
          : ''}
        ${footer}`;
    } else if (file.kind === 'pdf') {
      modules = ['/pdfviewer.js'];
      bodyClass = 'viewer-page';
      body = html`${crumbs}<h1 class="h-compact">${title}</h1>${switcher}
        <section class="atril" data-atril data-src="${src}" data-annotations="/api/g/${g.id}/archivos/${file.id}/anotaciones">
          <div class="atril-bar">
            <div class="atril-group">
              <button type="button" class="button button-icon" data-act="prev" aria-label="Página anterior">‹</button>
              <output data-page>1 / 1</output>
              <button type="button" class="button button-icon" data-act="next" aria-label="Página siguiente">›</button>
            </div>
            <div class="atril-group">
              <button type="button" class="button button-ghost button-small" data-act="zoomOut" aria-label="Alejar">−</button>
              <button type="button" class="button button-ghost button-small" data-act="fit">Ajustar</button>
              <button type="button" class="button button-ghost button-small" data-act="zoomIn" aria-label="Acercar">+</button>
              <button type="button" class="button button-ghost button-small" data-act="twoUp" aria-pressed="false">Dos páginas</button>
            </div>
            <div class="atril-group">
              <button type="button" class="button button-ghost button-small" data-act="draw" aria-pressed="false">Anotar</button>
              <button type="button" class="button button-small" data-act="full">Modo atril</button>
            </div>
          </div>
          <div class="annot-bar" data-annot-bar hidden>
            <span class="seg" role="group" aria-label="Capa donde anotas">
              <button type="button" data-layer="personal" aria-pressed="true">Mis notas</button>
              <button type="button" data-layer="group" aria-pressed="false">Notas del grupo</button>
            </span>
            <span class="seg" role="group" aria-label="Herramienta">
              <button type="button" data-tool="pen" aria-pressed="true">Lápiz</button>
              <button type="button" data-tool="marker" aria-pressed="false">Subrayador</button>
              <button type="button" data-tool="text" aria-pressed="false">Texto</button>
              <button type="button" data-tool="eraser" aria-pressed="false">Goma</button>
            </span>
            <span class="swatches" role="group" aria-label="Color">
              <button type="button" data-color="#c2364a" style="--c:#c2364a" aria-label="Rojo" aria-pressed="true"></button>
              <button type="button" data-color="#2f4fd8" style="--c:#2f4fd8" aria-label="Azul" aria-pressed="false"></button>
              <button type="button" data-color="#1f8a5b" style="--c:#1f8a5b" aria-label="Verde" aria-pressed="false"></button>
              <button type="button" data-color="#172033" style="--c:#172033" aria-label="Negro" aria-pressed="false"></button>
            </span>
            <button type="button" class="button button-ghost button-small" data-act="undo">Deshacer</button>
            <button type="button" class="button button-ghost button-small" data-act="clearPage">Borrar página</button>
            <label class="check"><input type="checkbox" data-show="group" checked> Ver notas del grupo</label>
            <label class="check"><input type="checkbox" data-show="personal" checked> Ver mis notas</label>
            <span class="muted small" data-save-status></span>
          </div>
          <div class="atril-stage" data-stage tabindex="0" aria-label="Partitura. Usa las flechas, AvPág/RePág o un pedal para pasar página."></div>
          <p class="muted small atril-help">Pasa página con ← →, AvPág/RePág, espacio o un pedal Bluetooth. En pantalla táctil, toca el borde derecho o izquierdo.</p>
        </section>
        ${footer}`;
    } else if (file.kind === 'musicxml') {
      scripts = ['/vendor/opensheetmusicdisplay.min.js', '/musicxml.js'];
      body = html`${crumbs}<h1 class="h-compact">${title}</h1>${switcher}
        <section class="mxl" data-musicxml data-src="${src}" data-zip="${/\.mxl$/i.test(file.filename) ? '1' : ''}">
          <div class="atril-bar">
            <div class="atril-group">
              <span>Transponer</span>
              <button type="button" class="button button-ghost button-small" data-act="down" aria-label="Bajar un semitono">−½</button>
              <output data-transpose>0</output>
              <button type="button" class="button button-ghost button-small" data-act="up" aria-label="Subir un semitono">+½</button>
            </div>
            <div class="atril-group">
              <button type="button" class="button button-ghost button-small" data-act="zoomOut" aria-label="Alejar">−</button>
              <output data-zoom>100 %</output>
              <button type="button" class="button button-ghost button-small" data-act="zoomIn" aria-label="Acercar">+</button>
            </div>
            <div class="atril-group" data-parts></div>
            <button type="button" class="button button-ghost button-small" data-act="print">Imprimir</button>
          </div>
          <div class="mxl-status muted" data-status>Cargando partitura…</div>
          <div class="mxl-score" data-score></div>
        </section>
        ${footer}`;
    } else if (file.kind === 'image') {
      body = html`${crumbs}<h1 class="h-compact">${title}</h1>${switcher}
        <figure class="image-view"><img src="${src}" alt="${title}"></figure>${footer}`;
    } else {
      body = html`${crumbs}<h1 class="h-compact">${title}</h1>
        <section class="panel"><p>Este tipo de archivo no se puede ver en el navegador.</p><a class="button" href="${src}?descargar=1">Descargar ${file.filename}</a></section>${footer}`;
    }
    res.html(layout(res.ctx, { title, active: 'repertorio', scripts, modules, bodyClass, body }));
  });

  app.post('/g/:gid/archivos/:fid/editar', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    await sql`UPDATE files SET label = ${str(req.body.label, 120)} WHERE id = ${file.id}`;
    flash(req, 'ok', 'Nombre guardado.');
    res.redirect(`/g/${req.group.id}/archivos/${file.id}`);
  });

  app.post('/g/:gid/archivos/:fid/borrar', loadGroup, async (req, res) => {
    const g = req.group;
    const file = await loadFile(req, req.params.fid);
    if (!canDelete(req, file.uploaded_by)) throw new HttpError(403, 'Solo quien subió el archivo o quien creó el grupo puede borrarlo.');
    await sql`DELETE FROM files WHERE id = ${file.id}`;
    await storage.remove(file.storage_key).catch((err) => console.error('No se pudo borrar del almacenamiento:', err.message));
    flash(req, 'ok', 'Archivo borrado.');
    res.redirect(file.song_id ? `/g/${g.id}/canciones/${file.song_id}` : `/g/${g.id}`);
  });

  // ---------- Marcadores de audio ----------
  app.get('/api/g/:gid/archivos/:fid/marcadores', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    const rows = await sql`SELECT m.id, m.position_ms, m.label, u.name AS author FROM markers m LEFT JOIN users u ON u.id = m.created_by WHERE m.file_id = ${file.id} ORDER BY m.position_ms`;
    res.json({ markers: rows });
  });

  app.post('/api/g/:gid/archivos/:fid/marcadores', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    const pos = Math.round(Number(req.body.position_ms));
    const label = str(req.body.label, 60) || 'Marcador';
    if (!Number.isFinite(pos) || pos < 0 || pos > 24 * 3600 * 1000) throw new HttpError(400, 'Posición no válida');
    const count = await sql`SELECT count(*)::int AS n FROM markers WHERE file_id = ${file.id}`;
    if (count[0].n >= 200) throw new HttpError(400, 'Demasiados marcadores en este audio.');
    const [m] = await sql`INSERT INTO markers (file_id, position_ms, label, created_by) VALUES (${file.id}, ${pos}, ${label}, ${req.session.user.id}) RETURNING id, position_ms, label`;
    res.json({ marker: { ...m, author: req.session.user.name } }, 201);
  });

  app.delete('/api/g/:gid/archivos/:fid/marcadores/:mid', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    await sql`DELETE FROM markers WHERE id = ${parseId(req.params.mid)} AND file_id = ${file.id}`;
    res.json({ ok: true });
  });

  // ---------- Anotaciones en PDF ----------
  app.get('/api/g/:gid/archivos/:fid/anotaciones', loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    const rows = await sql`
      SELECT page, scope, strokes FROM annotations
      WHERE file_id = ${file.id} AND (scope = 'group' OR (scope = 'personal' AND owner_id = ${req.session.user.id}))`;
    const out = { personal: {}, group: {} };
    rows.forEach((r) => {
      out[r.scope][r.page] = r.strokes;
    });
    res.json(out);
  });

  app.put('/api/g/:gid/archivos/:fid/anotaciones', { bodyLimit: 2 * 1024 * 1024 }, loadGroup, async (req, res) => {
    const file = await loadFile(req, req.params.fid);
    if (file.kind !== 'pdf') throw new HttpError(400, 'Solo se pueden anotar PDF.');
    const page = Number(req.body.page);
    const scope = req.body.scope === 'group' ? 'group' : 'personal';
    const strokes = Array.isArray(req.body.strokes) ? req.body.strokes.slice(0, 2000) : null;
    if (!Number.isInteger(page) || page < 1 || page > 5000 || !strokes) throw new HttpError(400, 'Anotación no válida');
    const clean = strokes
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        tool: ['pen', 'marker', 'text'].includes(s.tool) ? s.tool : 'pen',
        color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#c2364a',
        width: Math.min(40, Math.max(0.5, Number(s.width) || 2)),
        points: Array.isArray(s.points) ? s.points.slice(0, 4000).map((p) => [Math.round(Number(p[0]) * 10000) / 10000, Math.round(Number(p[1]) * 10000) / 10000]).filter((p) => p.every(Number.isFinite)) : [],
        text: typeof s.text === 'string' ? s.text.slice(0, 200) : undefined,
      }));
    const owner = scope === 'group' ? 0 : req.session.user.id;
    await sql`
      INSERT INTO annotations (file_id, page, scope, owner_id, strokes, updated_by)
      VALUES (${file.id}, ${page}, ${scope}, ${owner}, ${sql.json(clean)}, ${req.session.user.id})
      ON CONFLICT (file_id, page, scope, owner_id) DO UPDATE SET strokes = EXCLUDED.strokes, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    res.json({ ok: true });
  });
};
