/* Editor de partituras en notación ABC (abcjs): vista en vivo, paleta de notas,
 * transposición, reproducción, MIDI, impresión y guardado con aviso de conflictos. */
(function () {
  'use strict';
  var root = document.querySelector('[data-abc-editor]');
  if (!root) return;
  var E = window.Ensaya;
  var A = window.ABCJS;
  var text = root.querySelector('[data-abc]');
  var titleInput = root.querySelector('[data-title]');
  var renderEl = root.querySelector('[data-render]');
  var warningsEl = root.querySelector('[data-warnings]');
  var statusEl = root.querySelector('[data-save-status]');
  var transposeOut = root.querySelector('[data-transpose]');
  var octaveOut = root.querySelector('[data-octave-label]');
  var saveUrl = root.dataset.save;

  var state = { version: root.dataset.version, dirty: false, saving: false, transpose: 0, dur: 1, dot: false, octave: 4, acc: '', visual: null, synth: null };
  var renderTimer = null;
  var saveTimer = null;

  if (!A) {
    renderEl.textContent = 'No se pudo cargar el motor de partituras.';
    return;
  }

  // ---------- Dibujo ----------
  function render() {
    var tunes = A.renderAbc(renderEl, text.value, {
      responsive: 'resize',
      add_classes: true,
      visualTranspose: state.transpose,
      selectionColor: '#2f4fd8',
      clickListener: function (abcElem) {
        if (typeof abcElem.startChar === 'number' && abcElem.startChar >= 0) {
          text.focus();
          text.setSelectionRange(abcElem.startChar, abcElem.endChar);
        }
      },
    });
    state.visual = tunes && tunes[0];
    var warnings = (state.visual && state.visual.warnings) || [];
    warningsEl.textContent = warnings.length ? 'Revisa la notación: ' + warnings.slice(0, 3).map(function (w) { return String(w).replace(/<[^>]+>/g, ''); }).join(' · ') : '';
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 200);
  }

  // ---------- Inserción ----------
  function insert(str) {
    var start = text.selectionStart;
    var end = text.selectionEnd;
    text.setRangeText(str, start, end, 'end');
    text.focus();
    changed();
  }

  function durationString() {
    var v = state.dur * (state.dot ? 1.5 : 1);
    if (v === 1) return '';
    if (Number.isInteger(v)) return String(v);
    if (v === 0.5) return '/2';
    if (v === 0.25) return '/4';
    // fracciones como 3/2 o 3/4
    for (var d = 2; d <= 8; d *= 2) {
      if (Number.isInteger(v * d)) return (v * d) + '/' + d;
    }
    return '';
  }

  function noteString(letter) {
    var o = state.octave;
    var n;
    if (o >= 5) n = letter.toLowerCase() + "'".repeat(o - 5);
    else n = letter.toUpperCase() + ','.repeat(4 - o);
    return state.acc + n + durationString();
  }

  function setPressed(sel, fn) {
    root.querySelectorAll(sel).forEach(function (b) { b.setAttribute('aria-pressed', String(fn(b))); });
  }

  root.querySelector('.abc-toolbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-dur')) {
      var map = { '8': 8, '4': 4, '2': 2, '': 1, '/2': 0.5 };
      state.dur = map[b.dataset.dur];
      setPressed('[data-dur]', function (x) { return x === b; });
      return;
    }
    if (b.hasAttribute('data-dot')) {
      state.dot = !state.dot;
      b.setAttribute('aria-pressed', String(state.dot));
      return;
    }
    if (b.dataset.note) {
      insert(noteString(b.dataset.note));
      state.acc = '';
      setPressed('[data-acc]', function () { return false; });
      return;
    }
    if (b.dataset.octave) {
      state.octave = Math.max(2, Math.min(7, state.octave + Number(b.dataset.octave)));
      octaveOut.textContent = String(state.octave);
      return;
    }
    if (b.dataset.acc) {
      state.acc = state.acc === b.dataset.acc ? '' : b.dataset.acc;
      setPressed('[data-acc]', function (x) { return x.dataset.acc === state.acc; });
      return;
    }
    if (b.hasAttribute('data-insert')) {
      var s = b.dataset.insert === '\\n' ? '\n' : b.dataset.insert;
      if (b.hasAttribute('data-uses-dur')) s += durationString();
      insert(s);
      return;
    }
    if (b.hasAttribute('data-chord')) {
      var chord = window.prompt('Acorde (p. ej. Am, G7, F#m):');
      if (chord && chord.trim()) insert('"' + chord.trim().replace(/"/g, '') + '"');
      return;
    }
    if (b.hasAttribute('data-lyrics')) {
      var pos = text.value.indexOf('\n', text.selectionEnd);
      if (pos < 0) pos = text.value.length;
      text.setSelectionRange(pos, pos);
      insert('\nw: ');
    }
  });

  // ---------- Guardado ----------
  function changed() {
    state.dirty = true;
    statusEl.textContent = 'Cambios sin guardar';
    scheduleRender();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(false); }, 2500);
  }

  async function save(force) {
    if (state.saving) return;
    clearTimeout(saveTimer);
    state.saving = true;
    statusEl.textContent = 'Guardando…';
    try {
      var data = await E.api('PUT', saveUrl, { abc: text.value, title: titleInput.value, version: state.version, force: Boolean(force) });
      state.version = data.version;
      state.dirty = false;
      statusEl.textContent = 'Guardado';
    } catch (e) {
      if (e.status === 409 && e.data && e.data.conflict) {
        var keepMine = window.confirm(e.data.by + ' ha guardado otra versión mientras editabas.\n\nAceptar: guardar la tuya encima.\nCancelar: cargar la suya (perderás tus cambios).');
        if (keepMine) {
          state.saving = false;
          state.version = e.data.version;
          return save(true);
        }
        text.value = e.data.abc;
        state.version = e.data.version;
        state.dirty = false;
        statusEl.textContent = 'Cargada la versión de ' + e.data.by;
        render();
      } else {
        statusEl.textContent = 'No se pudo guardar: ' + e.message;
      }
    } finally {
      state.saving = false;
    }
  }

  text.addEventListener('input', changed);
  titleInput.addEventListener('input', changed);
  document.addEventListener('keydown', function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      save(false);
    }
  });
  window.addEventListener('beforeunload', function (ev) {
    if (state.dirty) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  // ---------- Acciones ----------
  async function play() {
    if (!A.synth || !A.synth.supportsAudio()) {
      E.toast('Este navegador no puede reproducir audio.');
      return;
    }
    if (!state.visual) return;
    stop();
    try {
      var synth = new A.synth.CreateSynth();
      state.synth = synth;
      var btn = root.querySelector('[data-act="play"]');
      btn.disabled = true;
      btn.textContent = 'Cargando sonidos…';
      await synth.init({ visualObj: state.visual, options: { midiTranspose: state.transpose } });
      await synth.prime();
      btn.disabled = false;
      btn.textContent = 'Escuchar';
      if (state.synth === synth) synth.start();
    } catch (e) {
      var b = root.querySelector('[data-act="play"]');
      b.disabled = false;
      b.textContent = 'Escuchar';
      E.toast('No se pudieron cargar los sonidos. Hace falta conexión a internet.');
    }
  }

  function stop() {
    if (state.synth) {
      try { state.synth.stop(); } catch (e) { /* nada */ }
      state.synth = null;
    }
  }

  function downloadMidi() {
    try {
      var files = A.synth.getMidiFile(text.value, { midiOutputType: 'binary', midiTranspose: state.transpose });
      var data = files && files[0];
      if (!data) throw new Error('vacío');
      var blob = new Blob([data], { type: 'audio/midi' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      var base = (titleInput.value || 'partitura').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]/g, '').trim() || 'partitura';
      a.download = base + '.mid';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) {
      E.toast('No se pudo generar el MIDI. Revisa la notación.');
    }
  }

  root.querySelector('.abc-actions').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'up' || act === 'down') {
      state.transpose = Math.max(-12, Math.min(12, state.transpose + (act === 'up' ? 1 : -1)));
      transposeOut.textContent = (state.transpose > 0 ? '+' : '') + state.transpose;
      stop();
      render();
    }
    if (act === 'applyTranspose') {
      if (!state.transpose) { E.toast('Elige primero cuántos semitonos transponer.'); return; }
      if (!A.strTranspose) { E.toast('Esta versión del editor no puede reescribir el texto.'); return; }
      var visual = A.renderAbc('*', text.value)[0];
      text.value = A.strTranspose(text.value, [visual], state.transpose);
      state.transpose = 0;
      transposeOut.textContent = '0';
      changed();
      render();
    }
    if (act === 'play') play();
    if (act === 'stop') stop();
    if (act === 'midi') downloadMidi();
    if (act === 'print') window.print();
    if (act === 'save') save(false);
  });

  render();
})();
