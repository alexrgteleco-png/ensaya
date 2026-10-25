'use strict';

// Generador de solos: la generación y el sonido ocurren en el navegador (sin coste de servidor).
// El servidor solo pinta la página y guarda un solo como partitura de la canción.

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { layout, icon, jsonData } = require('../lib/ui');
const S = require('../public/solo-engine');
const { str, loadGroup, loadSong } = require('./common');

function defaultsForSong(song) {
  const m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?)(m(?!aj))?/.exec(song.song_key || '');
  const latin = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  let key = 'A';
  let minor = true;
  if (m) {
    key = (latin[m[1]] || m[1]) + (m[2] || '');
    minor = Boolean(m[3]);
    if (!S.ROOTS.includes(key)) key = { 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb' }[key] || 'A';
  }
  const meter = ['4/4', '3/4', '2/4', '6/8', '12/8'].includes(song.time_signature) ? song.time_signature : '4/4';
  const style = S.STYLES.rock;
  return {
    ...S.DEFAULTS,
    style: 'rock',
    key,
    scale: minor ? 'pentatonica_menor' : 'pentatonica_mayor',
    tempo: song.bpm || 100,
    meter,
    density: style.density,
    variability: style.variability,
    rests: style.rests,
    swing: style.swing,
    chromatic: style.chromatic,
    ornaments: style.ornaments,
    repetition: style.repetition,
    progression: S.chordsFromLyrics(song.lyrics),
  };
}

function slider(name, label, min, max, step, hint) {
  return html`<label class="sg-slider">
    <span class="sg-slider-head"><span>${label}</span><output data-out="${name}"></output></span>
    <input type="range" name="${name}" min="${min}" max="${max}" step="${step}">
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;
}

function select(name, label, options) {
  return html`<label>${label}<select name="${name}">${options.map(([v, t]) => html`<option value="${v}">${t}</option>`)}</select></label>`;
}

module.exports = function soloRoutes(app) {
  app.get('/g/:gid/canciones/:sid/solos', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    const data = {
      song: { id: song.id, title: song.title },
      defaults: defaultsForSong(song),
      songProgression: S.chordsFromLyrics(song.lyrics),
      save: `/api/g/${g.id}/canciones/${song.id}/solos`,
      styles: Object.fromEntries(Object.entries(S.STYLES).map(([k, v]) => [k, { scale: v.scale, density: v.density, variability: v.variability, rests: v.rests, swing: v.swing, chromatic: v.chromatic, ornaments: v.ornaments, repetition: v.repetition, progression: v.progression || '' }])),
    };
    const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const latin = { C: 'Do', 'C#': 'Do#', D: 'Re', Eb: 'Mib', E: 'Mi', F: 'Fa', 'F#': 'Fa#', G: 'Sol', Ab: 'Lab', A: 'La', Bb: 'Sib', B: 'Si' };
    const body = html`
      ${jsonData('solo-data', data)}
      <div class="pagehead">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/canciones/${song.id}">${song.title}</a></p>
          <h1>Generador de solos</h1>
          <p class="lead">Ajusta el estilo y los parámetros; cada solo es nuevo, pero puedes volver a los anteriores, escucharlo con acompañamiento y guardarlo como partitura.</p>
        </div>
      </div>
      <div class="sg" data-solo-generator>
        <form class="sg-controls" data-controls autocomplete="off">
          <fieldset>
            <legend>Base</legend>
            <div class="grid-2">
              ${select('style', 'Estilo', Object.entries(S.STYLES).map(([k, v]) => [k, v.name]))}
              ${select('key', 'Tonalidad', roots.map((r) => [r, `${r} (${latin[r]})`]))}
            </div>
            ${select('scale', 'Escala', Object.entries(S.SCALES).map(([k, v]) => [k, v.name]))}
            <div class="grid-3">
              <label>Tempo<input type="number" name="tempo" min="40" max="260" step="1"></label>
              ${select('meter', 'Compás', [['4/4', '4/4'], ['3/4', '3/4'], ['2/4', '2/4'], ['6/8', '6/8'], ['12/8', '12/8']])}
              ${select('bars', 'Compases', [[2, 2], [4, 4], [8, 8], [12, 12], [16, 16]].map(([a, b]) => [a, `${b}`]))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Ritmo</legend>
            ${slider('density', 'Densidad de notas', 1, 10, 1, 'De notas largas a ráfagas rápidas')}
            ${slider('rests', 'Silencios', 0, 70, 1, 'Respiraciones entre frases')}
            ${slider('swing', 'Swing', 0, 100, 1, 'Corcheas desiguales, sensación de tresillo')}
          </fieldset>
          <fieldset>
            <legend>Melodía</legend>
            ${slider('variability', 'Variabilidad', 0, 100, 1, 'Bajo: por grados conjuntos. Alto: saltos amplios')}
            ${slider('repetition', 'Repetición de motivos', 0, 100, 1, 'Frases que vuelven, pregunta y respuesta')}
            ${slider('chordFollow', 'Seguir los acordes', 0, 100, 1, 'Caer en notas del acorde en los pulsos fuertes')}
            ${slider('chromatic', 'Cromatismos', 0, 60, 1, 'Notas de aproximación fuera de la escala')}
            ${slider('ornaments', 'Adornos', 0, 80, 1, 'Notas de adorno, ligados y deslizamientos')}
            <div class="grid-2">
              ${select('register', 'Registro', [['grave', 'Grave'], ['medio', 'Medio'], ['agudo', 'Agudo']])}
              ${select('range', 'Amplitud', [[1, '1 octava'], [2, '2 octavas'], [3, '3 octavas']])}
            </div>
            <label class="check"><input type="checkbox" name="endOnTonic"> Terminar en la tónica</label>
          </fieldset>
          <fieldset>
            <legend>Acordes</legend>
            <label>Progresión <span class="hint">un acorde por compás; se repite si hay menos</span>
              <input name="progression" maxlength="200" placeholder="Am F C G">
            </label>
            <div class="sg-presets" role="group" aria-label="Progresiones">
              ${data.songProgression ? html`<button type="button" class="button button-small button-ghost" data-prog="song">De la canción</button>` : ''}
              ${Object.entries(S.PROGRESSIONS).map(([k, v]) => html`<button type="button" class="button button-small button-ghost" data-prog="${k}">${v.name}</button>`)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Sonido y partitura</legend>
            <div class="grid-2">
              ${select('instrument', 'Instrumento', [['guitarra', 'Guitarra eléctrica'], ['saxo', 'Saxo'], ['synth', 'Sintetizador'], ['piano', 'Piano']])}
              ${select('transpose', 'Partitura para', [['0', 'Instrumento en Do'], ['2', 'Si♭ (trompeta, clarinete, saxo tenor)'], ['9', 'Mi♭ (saxo alto)'], ['7', 'Fa (trompa)']])}
            </div>
            ${slider('volSolo', 'Volumen del solo', 0, 100, 1, '')}
            ${slider('volBand', 'Acordes y bajo', 0, 100, 1, '')}
            ${slider('volDrums', 'Batería', 0, 100, 1, '')}
            <label class="check"><input type="checkbox" name="tab"> Mostrar tablatura de guitarra</label>
            <label class="check"><input type="checkbox" name="countIn"> Compás de cuenta antes de empezar</label>
          </fieldset>
        </form>

        <section class="sg-output">
          <div class="sg-bar">
            <button type="button" class="button button-play" data-act="new" title="Nuevo solo (N)">${icon('plus', 18)} Nuevo solo</button>
            <button type="button" class="button button-ghost" data-act="play" aria-pressed="false" title="Escuchar (espacio)">${icon('play', 16)} Escuchar</button>
            <button type="button" class="button button-ghost" data-act="loop" aria-pressed="false">Bucle</button>
            <span class="sg-history">
              <button type="button" class="button button-icon" data-act="prev" aria-label="Solo anterior">‹</button>
              <output data-history-pos>1 / 1</output>
              <button type="button" class="button button-icon" data-act="next" aria-label="Solo siguiente">›</button>
            </span>
          </div>
          <p class="muted small sg-meta" data-meta></p>
          <div class="sg-score" data-score aria-live="polite"></div>
          <div class="sg-actions">
            <label class="sg-title-label">Nombre al guardar<input name="saveTitle" data-save-title maxlength="150" value="Solo · ${song.title}"></label>
            <button type="button" class="button" data-act="save">Guardar como partitura</button>
            <button type="button" class="button button-ghost" data-act="midi">Descargar MIDI</button>
            <button type="button" class="button button-ghost" data-act="link">Copiar enlace a este solo</button>
            <button type="button" class="button button-ghost" data-act="print">Imprimir</button>
          </div>
          <p class="muted small">Atajos: <kbd>N</kbd> nuevo solo, <kbd>espacio</kbd> escuchar o parar. El enlace reproduce exactamente este solo en el móvil de tus compañeros. Pulsa una nota de la partitura para oírla.</p>
        </section>
      </div>`;
    res.html(layout(res.ctx, { title: `Generador de solos · ${song.title}`, active: 'repertorio', scripts: ['/vendor/abcjs-basic-min.js', '/solo-engine.js', '/solos.js'], body }));
  });

  app.post('/api/g/:gid/canciones/:sid/solos', { bodyLimit: 256 * 1024 }, loadGroup, async (req, res) => {
    const song = await loadSong(req, req.params.sid);
    const abc = typeof req.body.abc === 'string' ? req.body.abc.slice(0, 100000) : '';
    if (!/^X:\s*1/m.test(abc) || !/^K:/m.test(abc)) throw new HttpError(400, 'Solo no válido');
    const title = str(req.body.title, 150) || `Solo · ${song.title}`;
    const finalAbc = abc.replace(/^T:.*$/m, `T:${title.replace(/[\r\n]/g, ' ')}`);
    const [sc] = await sql`
      INSERT INTO scores (group_id, song_id, title, abc, created_by, updated_by)
      VALUES (${req.group.id}, ${song.id}, ${title}, ${finalAbc}, ${req.session.user.id}, ${req.session.user.id})
      RETURNING id`;
    await sql`UPDATE songs SET updated_at = now() WHERE id = ${song.id}`;
    res.json({ id: sc.id, url: `/g/${req.group.id}/partituras/${sc.id}` }, 201);
  });
};
