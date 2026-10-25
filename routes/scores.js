'use strict';

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { layout, csrfField, postButton, jsonData } = require('../lib/ui');
const { timeAgo } = require('../lib/time');
const { str, parseId, flash, loadGroup, canDelete } = require('./common');

function starterAbc(title, song) {
  const meter = song && /^\d+\/\d+$/.test(song.time_signature || '') ? song.time_signature : '4/4';
  const key = song && song.song_key ? song.song_key : 'C';
  const tempo = song && song.bpm ? `Q:1/4=${song.bpm}\n` : '';
  return `X:1
T:${title.replace(/\n/g, ' ')}
M:${meter}
L:1/8
${tempo}K:${/^[A-G][#b]?m?$/.test(key) ? key : 'C'}
"C"C2 E2 G2 c2 | "G"B2 d2 G4 | "Am"A2 c2 e2 a2 | "F"f4 "G"g4 |]
`;
}

async function loadScore(req) {
  const id = parseId(req.params.pid);
  const rows = id ? await sql`SELECT * FROM scores WHERE id = ${id} AND group_id = ${req.group.id}` : [];
  if (!rows.length) throw new HttpError(404, 'Partitura no encontrada');
  return rows[0];
}

module.exports = function scoreRoutes(app) {
  app.post('/g/:gid/partituras', loadGroup, async (req, res) => {
    const g = req.group;
    let song = null;
    if (req.body.song_id) {
      const sid = parseId(req.body.song_id);
      song = sid ? (await sql`SELECT * FROM songs WHERE id = ${sid} AND group_id = ${g.id}`)[0] : null;
      if (!song) throw new HttpError(404, 'Canción no encontrada');
    }
    const title = str(req.body.title, 150) || (song ? song.title : 'Partitura nueva');
    const [sc] = await sql`
      INSERT INTO scores (group_id, song_id, title, abc, created_by, updated_by)
      VALUES (${g.id}, ${song ? song.id : null}, ${title}, ${starterAbc(title, song)}, ${req.session.user.id}, ${req.session.user.id})
      RETURNING id`;
    res.redirect(`/g/${g.id}/partituras/${sc.id}`);
  });

  app.get('/g/:gid/partituras/:pid', loadGroup, async (req, res) => {
    const g = req.group;
    const sc = await loadScore(req);
    const song = sc.song_id ? (await sql`SELECT id, title FROM songs WHERE id = ${sc.song_id}`)[0] : null;
    const editor = sc.updated_by ? (await sql`SELECT name FROM users WHERE id = ${sc.updated_by}`)[0] : null;
    const body = html`
      <p class="crumbs">${song ? html`<a href="/g/${g.id}/canciones/${song.id}">${song.title}</a>` : html`<a href="/g/${g.id}/canciones">Repertorio</a>`}</p>
      <section class="abc-editor" data-abc-editor data-save="/api/g/${g.id}/partituras/${sc.id}" data-version="${new Date(sc.updated_at).toISOString()}">
        <div class="abc-head">
          <label class="abc-title-label"><span class="sr-only">Título</span><input class="abc-title" data-title maxlength="150" value="${sc.title}"></label>
          <span class="muted small" data-save-status>Guardado ${timeAgo(sc.updated_at)}${editor ? ` por ${editor.name}` : ''}</span>
        </div>
        <div class="abc-toolbar" role="toolbar" aria-label="Insertar notación">
          <span class="tb-group" aria-label="Duración">
            <span class="tb-label">Duración</span>
            <button type="button" data-dur="8" aria-pressed="false" title="Redonda">1</button>
            <button type="button" data-dur="4" aria-pressed="false" title="Blanca">1/2</button>
            <button type="button" data-dur="2" aria-pressed="false" title="Negra">1/4</button>
            <button type="button" data-dur="" aria-pressed="true" title="Corchea">1/8</button>
            <button type="button" data-dur="/2" aria-pressed="false" title="Semicorchea">1/16</button>
            <button type="button" data-dot aria-pressed="false" title="Con puntillo">·</button>
          </span>
          <span class="tb-group" aria-label="Notas">
            <span class="tb-label">Nota</span>
            ${['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((n, i) => html`<button type="button" data-note="${n}" title="${['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'][i]} (tecla ${n.toLowerCase()})">${['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'][i]}</button>`)}
            <button type="button" data-insert="z" data-uses-dur title="Silencio">Silencio</button>
          </span>
          <span class="tb-group" aria-label="Octava y alteraciones">
            <button type="button" data-octave="-1" title="Octava abajo">8va↓</button>
            <output data-octave-label>4</output>
            <button type="button" data-octave="1" title="Octava arriba">8va↑</button>
            <button type="button" data-acc="^" aria-pressed="false" title="Sostenido">♯</button>
            <button type="button" data-acc="_" aria-pressed="false" title="Bemol">♭</button>
            <button type="button" data-acc="=" aria-pressed="false" title="Becuadro">♮</button>
          </span>
          <span class="tb-group" aria-label="Estructura">
            <button type="button" data-insert=" | " title="Barra de compás">|</button>
            <button type="button" data-insert=" |] " title="Doble barra final">‖</button>
            <button type="button" data-insert=" |: " title="Inicio de repetición">|:</button>
            <button type="button" data-insert=" :| " title="Fin de repetición">:|</button>
            <button type="button" data-chord title="Acorde de cifrado encima">Cifrado</button>
            <button type="button" data-lyrics title="Línea de letra bajo las notas">Letra</button>
            <button type="button" data-insert="\n" title="Nueva línea de pentagrama">Salto</button>
          </span>
        </div>
        <div class="abc-panes">
          <div class="abc-source">
            <label class="sr-only" for="abc-text">Notación ABC</label>
            <textarea id="abc-text" data-abc class="mono" spellcheck="false" rows="16">${sc.abc}</textarea>
            <details class="help">
              <summary>Cómo funciona</summary>
              <p>La partitura se escribe en notación ABC y se dibuja al momento. Usa los botones o escribe directamente: <code>C D E F</code> son notas, <code>c</code> es una octava más alta, <code>C2</code> dura el doble, <code>^F</code> es Fa sostenido, <code>z</code> es un silencio y <code>|</code> una barra de compás.</p>
              <p>Cabecera: <code>T:</code> título, <code>M:</code> compás, <code>L:</code> duración base, <code>Q:</code> tempo, <code>K:</code> tonalidad. Pulsa una nota del pentagrama para ir a su sitio en el texto.</p>
            </details>
            <div class="abc-warnings muted small" data-warnings></div>
          </div>
          <div class="abc-preview">
            <div class="abc-render" data-render></div>
          </div>
        </div>
        <div class="abc-actions">
          <div class="atril-group">
            <span>Transponer</span>
            <button type="button" class="button button-ghost button-small" data-act="down" aria-label="Bajar un semitono">−½</button>
            <output data-transpose>0</output>
            <button type="button" class="button button-ghost button-small" data-act="up" aria-label="Subir un semitono">+½</button>
            <button type="button" class="button button-ghost button-small" data-act="applyTranspose" title="Reescribir el texto en el nuevo tono">Aplicar al texto</button>
          </div>
          <div class="atril-group" data-audio-controls>
            <button type="button" class="button button-small" data-act="play">Escuchar</button>
            <button type="button" class="button button-ghost button-small" data-act="stop">Parar</button>
          </div>
          <div class="atril-group">
            <button type="button" class="button button-ghost button-small" data-act="midi">Descargar MIDI</button>
            <button type="button" class="button button-ghost button-small" data-act="print">Imprimir o PDF</button>
            <button type="button" class="button button-small" data-act="save">Guardar</button>
          </div>
        </div>
      </section>
      ${canDelete(req, sc.created_by)
        ? html`<p class="danger-inline">${postButton(res.ctx, `/g/${g.id}/partituras/${sc.id}/borrar`, 'Borrar partitura', { cls: 'button button-small button-danger-ghost', confirm: '¿Borrar esta partitura?' })}</p>`
        : ''}`;
    res.html(layout(res.ctx, { title: sc.title, active: 'repertorio', scripts: ['/vendor/abcjs-basic-min.js', '/abceditor.js'], body }));
  });

  app.put('/api/g/:gid/partituras/:pid', { bodyLimit: 512 * 1024 }, loadGroup, async (req, res) => {
    const sc = await loadScore(req);
    const abc = typeof req.body.abc === 'string' ? req.body.abc.slice(0, 200000) : null;
    const title = str(req.body.title, 150) || sc.title;
    if (abc === null) throw new HttpError(400, 'Falta la partitura');
    // Aviso si otra persona la ha guardado mientras tanto.
    if (req.body.version && !req.body.force && new Date(sc.updated_at).toISOString() !== req.body.version) {
      const who = sc.updated_by ? (await sql`SELECT name FROM users WHERE id = ${sc.updated_by}`)[0] : null;
      return res.json({ conflict: true, by: who ? who.name : 'otra persona', abc: sc.abc, version: new Date(sc.updated_at).toISOString() }, 409);
    }
    const [row] = await sql`UPDATE scores SET abc = ${abc}, title = ${title}, updated_by = ${req.session.user.id}, updated_at = now() WHERE id = ${sc.id} RETURNING updated_at`;
    res.json({ ok: true, version: new Date(row.updated_at).toISOString() });
  });

  app.post('/g/:gid/partituras/:pid/borrar', loadGroup, async (req, res) => {
    const sc = await loadScore(req);
    if (!canDelete(req, sc.created_by)) throw new HttpError(403, 'Solo quien la creó o quien creó el grupo puede borrarla.');
    await sql`DELETE FROM scores WHERE id = ${sc.id}`;
    flash(req, 'ok', 'Partitura borrada.');
    res.redirect(sc.song_id ? `/g/${req.group.id}/canciones/${sc.song_id}` : `/g/${req.group.id}/canciones`);
  });
};
