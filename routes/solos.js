'use strict';

// Generador de solos: la generación y el sonido ocurren en el navegador (sin coste de servidor).
// El servidor solo pinta la página y guarda un solo como partitura de la canción.

const { sql } = require('../lib/db');
const { html, raw } = require('../lib/html');
const { HttpError } = require('../lib/http');
const { layout, icon, jsonData } = require('../lib/ui');
const S = require('../public/solo-engine');
const SE = require('../public/sound-engine');
const { str, loadGroup, loadSong } = require('./common');

const ChordPro = require('../public/chordpro');

const KEY_ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LATIN = { C: 'Do', 'C#': 'Do#', Db: 'Re♭', D: 'Re', Eb: 'Mi♭', E: 'Mi', F: 'Fa', 'F#': 'Fa#', G: 'Sol', Ab: 'La♭', A: 'La', Bb: 'Si♭', B: 'Si' };
const STYLE_ORDER = ['bossa', 'swing', 'balada', 'bebop', 'blues', 'pop', 'rock', 'funk', 'flamenco', 'metal'];

function songKey(song) {
  const k = S.parseKey(song.song_key || 'C');
  const root = k.name.replace(/m$/, '');
  const fixed = { 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', Gb: 'F#', Cb: 'B' }[root] || root;
  return fixed + (k.minor ? 'm' : '');
}

function defaultsForSong(song, form, meta) {
  const style = S.styleFromName(meta.style) || (form.length ? 'swing' : 'rock');
  const meter = ['4/4', '3/4', '2/4', '5/4', '6/8', '12/8'].includes(song.time_signature) ? song.time_signature : '4/4';
  return {
    ...S.DEFAULTS,
    ...S.paramsFor(style, 'medio'),
    level: 'medio',
    key: songKey(song),
    tempo: song.bpm || (style === 'balada' ? 70 : style === 'bossa' ? 130 : 120),
    meter,
    useSong: form.length > 0,
    bars: style === 'blues' ? 12 : 8,
    choruses: form.length && form.length <= 16 ? 2 : 1,
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

function instrumentSelect() {
  return html`<select name="instrument" aria-label="Instrumento">
    ${['Guitarras', 'Pianos y teclados', 'Vientos y otros'].map((grp) => html`<optgroup label="${grp}">${Object.entries(SE.INSTRUMENTS).filter(([, v]) => v.group === grp).map(([k, v]) => html`<option value="${k}">${v.name}</option>`)}</optgroup>`)}
  </select>`;
}

// Notas de una melodía en JSON (validadas y limitadas).
function cleanModel(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.notes)) return null;
  const num = (v, a, b) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : null);
  const notes = m.notes.slice(0, 4000).map((n) => ({
    tick: num(n.tick, 0, 1e6) || 0,
    ticks: num(n.ticks, 0.1, 1e4) || 1,
    midi: n.midi === null || n.midi === undefined ? null : num(n.midi, 0, 127),
    tuplet: [0, 3, 6].includes(Number(n.tuplet)) ? Number(n.tuplet) : 0,
  }));
  const chords = Array.isArray(m.chords) ? m.chords.slice(0, 1000).map((c) => ({ tick: num(c.tick, 0, 1e6) || 0, name: String(c.name || '').slice(0, 20) })) : [];
  return {
    kind: m.kind === 'solo' ? 'solo' : 'melody',
    key: String(m.key || 'C').slice(0, 8),
    meter: /^\d{1,2}\/\d{1,2}$/.test(m.meter) ? m.meter : '4/4',
    tempo: num(m.tempo, 30, 300) || 100,
    chords,
    notes,
  };
}

module.exports = function soloRoutes(app) {
  app.get('/g/:gid/canciones/:sid/solos', loadGroup, async (req, res) => {
    const g = req.group;
    const song = await loadSong(req, req.params.sid);
    const form = ChordPro.bars(song.lyrics || '').slice(0, 128);
    const meta = ChordPro.meta(song.lyrics || '');
    const [melody] = await sql`
      SELECT model FROM scores WHERE song_id = ${song.id} AND model IS NOT NULL AND model->>'kind' = 'melody'
      ORDER BY updated_at DESC LIMIT 1`;
    const theme = melody && melody.model && Array.isArray(melody.model.notes) ? melody.model.notes.filter((n) => n.midi).map((n) => ({ tick: n.tick, ticks: n.ticks, midi: n.midi })).slice(0, 2000) : null;
    const data = {
      song: { id: song.id, title: song.title },
      defaults: defaultsForSong(song, form, meta),
      form,
      theme,
      songProgression: S.chordsFromLyrics(song.lyrics),
      save: `/api/g/${g.id}/canciones/${song.id}/solos`,
    };
    const keyOptions = [];
    KEY_ROOTS.forEach((r) => keyOptions.push([r, `${r} mayor (${LATIN[r]})`]));
    KEY_ROOTS.forEach((r) => keyOptions.push([`${r}m`, `${r} menor (${LATIN[r]}m)`]));
    const body = html`
      ${jsonData('solo-data', data)}
      <div class="pagehead sg-head">
        <div>
          <p class="crumbs"><a href="/g/${g.id}/canciones/${song.id}">${song.title}</a></p>
          <h1>Generador de solos</h1>
          <p class="lead">${form.length
            ? `Improvisa sobre el cifrado de la canción (${form.length} compases, ${data.defaults.key}).`
            : 'La canción no tiene cifrado: se usa una progresión típica del estilo. Añade el cifrado para improvisar sobre sus acordes.'}</p>
        </div>
        <div class="sg-mode" role="group" aria-label="Modo">
          <button type="button" class="seg-btn" data-mode-btn="principiante" aria-pressed="true">Principiante</button>
          <button type="button" class="seg-btn" data-mode-btn="experto" aria-pressed="false">Experto</button>
        </div>
      </div>
      <div class="sg" data-solo-generator data-mode="principiante">
        <form class="sg-controls" data-controls autocomplete="off">
          <section class="sg-quick">
            <div class="sg-styles" role="radiogroup" aria-label="Estilo">
              ${STYLE_ORDER.map((k) => html`<label class="chip-radio"><input type="radio" name="style" value="${k}"><span>${S.STYLES[k].name}</span></label>`)}
            </div>
            <div class="sg-quick-row">
              <label class="sg-inst">Instrumento ${instrumentSelect()}</label>
              <fieldset class="sg-level beginner-only">
                <legend>Dificultad</legend>
                <div class="seg-mini">
                  ${Object.entries(S.LEVELS).map(([k, v]) => html`<label><input type="radio" name="level" value="${k}"><span>${v.name}</span></label>`)}
                </div>
              </fieldset>
            </div>
            <div class="sg-bar">
              <button type="button" class="button" data-act="inspire" title="Parámetros elegidos para que suene bonito">${icon('spark', 18)} Inspírame</button>
              <button type="button" class="button button-ghost" data-act="new" title="Otro solo con los mismos ajustes (N)">${icon('plus', 16)} Otro solo</button>
              <button type="button" class="button button-play" data-act="play" aria-pressed="false" title="Escuchar (espacio)">${icon('play', 16)} Escuchar</button>
              <button type="button" class="button button-ghost button-small" data-act="loop" aria-pressed="false">Bucle</button>
              <span class="sg-history">
                <button type="button" class="button button-icon" data-act="prev" aria-label="Solo anterior">‹</button>
                <output data-history-pos>1 / 1</output>
                <button type="button" class="button button-icon" data-act="next" aria-label="Solo siguiente">›</button>
              </span>
            </div>
            <p class="sg-status small" data-sound-status role="status"></p>
          </section>

          <div class="sg-expert">
            <fieldset>
              <legend>Canción</legend>
              <div class="grid-2">
                ${select('key', 'Tonalidad', keyOptions)}
                <label>Tempo<input type="number" name="tempo" min="40" max="300" step="1"></label>
              </div>
              <div class="grid-2">
                ${select('meter', 'Compás', ['4/4', '3/4', '2/4', '5/4', '6/8', '12/8'].map((m) => [m, m]))}
                ${form.length ? select('choruses', 'Vueltas a la forma', [[1, '1 vuelta'], [2, '2 vueltas'], [3, '3 vueltas'], [4, '4 vueltas']]) : select('bars', 'Compases', [[4, 4], [8, 8], [12, 12], [16, 16], [24, 24], [32, 32]])}
              </div>
              ${form.length ? html`<label class="check"><input type="checkbox" name="useSong"> Usar el cifrado de la canción</label>` : ''}
              <div class="sg-prog" data-prog-box>
                <label>Progresión <span class="hint">si no se usa el cifrado; un acorde por compás</span>
                  <input name="progression" maxlength="300" placeholder="Dm7 G7 Cmaj7">
                </label>
                <div class="sg-presets" role="group" aria-label="Progresiones">
                  ${Object.entries(S.PROGRESSIONS).map(([k, v]) => html`<button type="button" class="button button-small button-ghost" data-prog="${k}">${v.name}</button>`)}
                </div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Ritmo y fraseo</legend>
              ${slider('density', 'Densidad de notas', 1, 10, 1, 'De notas largas a ráfagas rápidas')}
              ${slider('rests', 'Espacio entre frases', 0, 70, 1, 'Respiraciones; el silencio también es música')}
              ${slider('swing', 'Swing', 0, 100, 1, 'Corcheas desiguales, sensación de tresillo')}
              <label class="check"><input type="checkbox" name="tuplets"> Tresillos y grupos rápidos</label>
            </fieldset>
            <fieldset>
              <legend>Melodía</legend>
              ${slider('variability', 'Saltos', 0, 100, 1, 'Bajo: por grados conjuntos. Alto: intervalos amplios')}
              ${slider('repetition', 'Motivos que vuelven', 0, 100, 1, 'Pregunta y respuesta, riffs')}
              ${slider('chordFollow', 'Apoyarse en los acordes', 0, 100, 1, 'Caer en terceras, séptimas y novenas en los cambios')}
              ${slider('chromatic', 'Cromatismos', 0, 60, 1, 'Notas de paso y envolventes del bebop')}
              ${slider('ornaments', 'Adornos', 0, 80, 1, 'Notas de adorno, ligados, bends')}
              ${data.theme ? slider('paraphrase', 'Parafrasear la melodía', 0, 100, 1, 'Toma frases del tema que escribisteis en Ensaya') : ''}
              <div class="grid-2">
                ${select('register', 'Registro', [['grave', 'Grave'], ['medio', 'Medio'], ['agudo', 'Agudo']])}
                ${select('range', 'Amplitud', [[1, '1 octava'], [2, '2 octavas'], [3, '3 octavas']])}
              </div>
              ${select('scale', 'Escala', [['auto', 'Automática (la de cada acorde)'], ...Object.entries(S.SCALES).map(([k, v]) => [k, `${v.name} (toda la canción)`])])}
              <label class="check"><input type="checkbox" name="endOnTonic"> Terminar en la tónica</label>
            </fieldset>
            <fieldset>
              <legend>Sonido</legend>
              <div class="grid-2">
                ${select('soundPreset', 'Preajuste', [...Object.entries(SE.FX_PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Personalizado']])}
                ${select('quality', 'Calidad', [['alta', 'Alta'], ['ligera', 'Ligera (carga antes)']])}
              </div>
              <p class="actions sg-inline-actions">
                <button type="button" class="button button-small" data-act="audition">${icon('play', 14)} Probar sonido</button>
                <button type="button" class="button button-small button-ghost" data-act="resetFx">Restablecer efectos</button>
              </p>
              <details class="sg-fx">
                <summary>Efectos (reverb, delay, saturación…)</summary>
                ${slider('fx_drive', 'Saturación / distorsión', 0, 100, 1, '')}
                <div class="grid-3 sg-eq">
                  ${slider('fx_bass', 'Graves', -12, 12, 1, '')}
                  ${slider('fx_mid', 'Medios', -12, 12, 1, '')}
                  ${slider('fx_treble', 'Agudos', -12, 12, 1, '')}
                </div>
                ${slider('fx_comp', 'Compresión', 0, 100, 1, '')}
                ${slider('fx_chorus', 'Chorus', 0, 100, 1, '')}
                ${slider('fx_delayMix', 'Delay (eco)', 0, 100, 1, 'Sincronizado con el tempo')}
                ${select('fx_delayTime', 'Tiempo del delay', [['1/4', 'Negra'], ['1/8', 'Corchea'], ['1/8d', 'Corchea con puntillo'], ['1/16', 'Semicorchea'], ['1/4t', 'Tresillo de blanca']])}
                ${slider('fx_delayFeedback', 'Repeticiones del delay', 0, 90, 1, '')}
                ${select('fx_reverbType', 'Tipo de reverb', Object.entries(SE.REVERBS).map(([k, v]) => [k, v.name]))}
                ${slider('fx_reverbMix', 'Cantidad de reverb', 0, 100, 1, '')}
                ${slider('fx_vibrato', 'Vibrato', 0, 100, 1, '')}
                ${slider('fx_sustain', 'Sustain', 0, 100, 1, '')}
                ${slider('fx_pan', 'Panorama', -100, 100, 1, '')}
                ${slider('fx_humanize', 'Humanización', 0, 100, 1, 'Pequeñas variaciones, como al tocar en vivo')}
              </details>
            </fieldset>
            <fieldset>
              <legend>Banda y partitura</legend>
              <div class="grid-2">
                ${select('chords', 'Acordes', Object.entries(SE.CHORD_INSTRUMENTS).map(([k, v]) => [k, v.name]))}
                ${select('bass', 'Bajo', Object.entries(SE.BASS_INSTRUMENTS).map(([k, v]) => [k, v.name]))}
              </div>
              ${slider('volSolo', 'Volumen del solo', 0, 100, 1, '')}
              ${slider('volBand', 'Acordes y bajo', 0, 100, 1, '')}
              ${slider('volDrums', 'Batería', 0, 100, 1, '')}
              ${select('transpose', 'Partitura para', [['0', 'Instrumento en Do'], ['2', 'Si♭ (trompeta, clarinete, saxo tenor)'], ['9', 'Mi♭ (saxo alto)'], ['7', 'Fa (trompa)']])}
              <label class="check"><input type="checkbox" name="tab"> Tablatura de guitarra</label>
              <label class="check"><input type="checkbox" name="countIn"> Compás de cuenta antes de empezar</label>
            </fieldset>
          </div>
        </form>

        <section class="sg-output">
          <p class="sg-meta" data-meta></p>
          <div class="sg-score" data-score aria-live="polite"></div>
          <div class="sg-actions">
            <label class="sg-title-label">Nombre<input name="saveTitle" data-save-title maxlength="150" value="Solo · ${song.title}"></label>
            <button type="button" class="button" data-act="save">Guardar en la canción</button>
            <details class="sg-more">
              <summary class="button button-ghost">Más</summary>
              <div class="sg-more-menu">
                <button type="button" class="button button-ghost button-small" data-act="midi">Descargar MIDI</button>
                <button type="button" class="button button-ghost button-small" data-act="link">Copiar enlace</button>
                <button type="button" class="button button-ghost button-small" data-act="print">Imprimir</button>
              </div>
            </details>
          </div>
          <p class="muted small sg-help">Pulsa una nota para oírla. <kbd>N</kbd> otro solo · <kbd>espacio</kbd> escuchar. El enlace reproduce este mismo solo en el móvil de tus compañeros.</p>
        </section>
      </div>`;
    res.html(layout(res.ctx, { title: `Generador de solos · ${song.title}`, active: 'repertorio', scripts: ['/vendor/abcjs-basic-min.js', '/solo-engine.js', '/sound-engine.js', '/solos.js'], body }));
  });

  app.post('/api/g/:gid/canciones/:sid/solos', { bodyLimit: 512 * 1024 }, loadGroup, async (req, res) => {
    const song = await loadSong(req, req.params.sid);
    const abc = typeof req.body.abc === 'string' ? req.body.abc.slice(0, 100000) : '';
    if (!/^X:\s*1/m.test(abc) || !/^K:/m.test(abc)) throw new HttpError(400, 'Solo no válido');
    const title = str(req.body.title, 150) || `Solo · ${song.title}`;
    const finalAbc = abc.replace(/^T:.*$/m, `T:${title.replace(/[\r\n]/g, ' ')}`);
    const model = cleanModel(req.body.model);
    const [sc] = await sql`
      INSERT INTO scores (group_id, song_id, title, abc, model, created_by, updated_by)
      VALUES (${req.group.id}, ${song.id}, ${title}, ${finalAbc}, ${model ? sql.json(model) : null}, ${req.session.user.id}, ${req.session.user.id})
      RETURNING id`;
    await sql`UPDATE songs SET updated_at = now() WHERE id = ${song.id}`;
    res.json({ id: sc.id, url: `/g/${req.group.id}/partituras/${sc.id}` }, 201);
  });
};

module.exports.cleanModel = cleanModel;
