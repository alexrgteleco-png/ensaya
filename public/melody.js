/* Editor sencillo de melodías: piano en pantalla, teclado del ordenador y teclado MIDI.
 * Se elige la duración y se tocan las notas; compases, ligaduras y armadura se ponen solos. */
(function () {
  'use strict';
  var root = document.querySelector('[data-melody-editor]');
  if (!root) return;
  var E = window.Ensaya;
  var A = window.ABCJS;
  var M = window.MelodyModel;
  var SE = window.SoundEngine;
  var data = JSON.parse(document.getElementById('melody-data').textContent);
  var renderEl = root.querySelector('[data-render]');
  var statusEl = root.querySelector('[data-save-status]');
  var titleInput = root.querySelector('[data-title]');
  var selInfo = root.querySelector('[data-sel-info]');
  var octLabel = root.querySelector('[data-oct-label]');
  var saveUrl = root.dataset.save;

  var model = data.model;
  model.notes = (model.notes || []).map(function (n) { return { midi: n.midi === undefined ? null : n.midi, ticks: n.ticks }; });
  var DUR_NAMES = { 16: 'redonda', 12: 'blanca con puntillo', 8: 'blanca', 6: 'negra con puntillo', 4: 'negra', 3: 'corchea con puntillo', 2: 'corchea', 1: 'semicorchea' };
  var state = {
    sel: model.notes.length - 1, dur: 4, dot: false, base: 60, pieces: [], elements: [], visual: null,
    version: root.dataset.version, dirty: false, saving: false, undo: [], synth: null,
  };
  var saveTimer = null;

  // ---------- Dibujo ----------
  function noteElements(tune) {
    var out = [];
    (tune.lines || []).forEach(function (line) {
      if (!line.staff || !line.staff[0] || !line.staff[0].voices) return;
      line.staff[0].voices[0].forEach(function (it) {
        if (it.el_type === 'note' && it.abselem) out.push(it.abselem.elemset || []);
      });
    });
    return out;
  }

  function render() {
    var w = renderEl.clientWidth || window.innerWidth;
    var conv = M.toAbc(model, titleInput.value, { barsPerLine: w < 560 ? 2 : 4, aheadBars: w < 560 ? 3 : 7 });
    state.pieces = conv.pieces;
    state.abc = conv.abc;
    var tunes = A.renderAbc(renderEl, conv.abc, {
      responsive: 'resize',
      add_classes: true,
      clickListener: function (abcElem) {
        var set = abcElem.abselem && abcElem.abselem.elemset;
        var idx = -1;
        for (var i = 0; i < state.elements.length; i++) {
          if (state.elements[i] === set) { idx = i; break; }
        }
        if (idx < 0) return;
        var piece = state.pieces[idx];
        if (!piece) return;
        state.sel = piece.note >= 0 ? piece.note : model.notes.length - 1;
        if (piece.note >= 0 && model.notes[piece.note].midi !== null) preview(model.notes[piece.note].midi);
        highlight();
        info();
      },
    });
    state.visual = tunes && tunes[0];
    state.elements = state.visual ? noteElements(state.visual) : [];
    highlight();
    info();
  }

  function highlight() {
    state.elements.forEach(function (set, i) {
      var p = state.pieces[i];
      var on = p && p.note === state.sel && state.sel >= 0;
      var next = p && p.note === -1 && state.sel === model.notes.length - 1;
      set.forEach(function (el) {
        el.classList.toggle('mel-selected', Boolean(on));
        el.classList.toggle('mel-next', Boolean(next) && i === state.pieces.findIndex(function (q) { return q.note === -1; }));
      });
    });
  }

  function info() {
    var n = model.notes[state.sel];
    if (!n) {
      selInfo.textContent = model.notes.length ? 'Las notas se añaden al final.' : 'Toca una tecla para escribir la primera nota.';
      return;
    }
    var ticks = model.notes.slice(0, state.sel).reduce(function (a, x) { return a + x.ticks; }, 0);
    var mi = M.meterInfo(model.meter);
    var bar = Math.floor(ticks / mi.barTicks) + 1;
    var beat = Math.floor((ticks % mi.barTicks) / mi.beatTicks) + 1;
    selInfo.textContent = (n.midi === null ? 'Silencio' : M.noteName(n.midi)) + ' · ' + (DUR_NAMES[n.ticks] || n.ticks + '/16') + ' · compás ' + bar + ', pulso ' + beat + '. La siguiente nota irá detrás.';
  }

  // ---------- Edición ----------
  function snapshot() {
    state.undo.push(JSON.stringify({ notes: model.notes, sel: state.sel }));
    if (state.undo.length > 80) state.undo.shift();
  }

  function currentTicks() {
    return state.dot ? Math.round(state.dur * 1.5) : state.dur;
  }

  function addNote(midi) {
    snapshot();
    var n = { midi: midi, ticks: currentTicks() };
    model.notes.splice(state.sel + 1, 0, n);
    state.sel++;
    if (midi !== null) preview(midi);
    changed();
  }

  function modifySelected(fn) {
    var n = model.notes[state.sel];
    if (!n) return;
    snapshot();
    fn(n);
    changed();
  }

  function removeSelected() {
    if (state.sel < 0 || !model.notes.length) return;
    snapshot();
    model.notes.splice(state.sel, 1);
    state.sel = Math.min(state.sel - 1, model.notes.length - 1);
    if (state.sel < 0 && model.notes.length) state.sel = -1;
    changed();
  }

  function undo() {
    var s = state.undo.pop();
    if (!s) return;
    var o = JSON.parse(s);
    model.notes = o.notes;
    state.sel = o.sel;
    changed(true);
  }

  function setDur(t) {
    state.dur = t;
    root.querySelectorAll('[data-dur]').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.dur) === t)); });
    // Si hay una nota seleccionada, cambia también su duración.
    if (model.notes[state.sel] && state.lastAction === 'select') modifySelected(function (n) { n.ticks = currentTicks(); });
  }

  function setOctave(base) {
    state.base = Math.max(36, Math.min(84, base));
    octLabel.textContent = 'Do' + (Math.floor(state.base / 12) - 1);
  }

  // ---------- Sonido ----------
  var audio = null;
  function preview(midi) {
    try {
      if (!audio) {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        audio = SE.create(ctx, { quality: 'ligera' });
        audio.applyFx(Object.assign({}, SE.FX_DEFAULT, SE.FX_PRESETS.piano_sala.fx), model.tempo || 100);
      }
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      audio.preload([{ sample: 'acoustic_grand_piano', midis: [midi] }]).then(function () {
        audio.soloNote('acoustic_grand_piano', midi, audio.ctx.currentTime + 0.01, 0.5, 0.85);
      });
    } catch (e) { /* sin audio */ }
  }

  async function play() {
    if (!A.synth || !A.synth.supportsAudio() || !state.visual) return;
    stop();
    try {
      var synth = new A.synth.CreateSynth();
      state.synth = synth;
      await synth.init({ visualObj: state.visual, options: { chordsOff: false } });
      await synth.prime();
      if (state.synth === synth) synth.start();
    } catch (e) {
      E.toast('No se pudieron cargar los sonidos. Hace falta conexión a internet.');
    }
  }

  function stop() {
    if (state.synth) {
      try { state.synth.stop(); } catch (e) { /* nada */ }
      state.synth = null;
    }
  }

  // ---------- Guardado ----------
  function changed(fromUndo) {
    state.dirty = true;
    state.lastAction = 'edit';
    statusEl.textContent = 'Cambios sin guardar';
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(false); }, 2500);
  }

  function modelForSave() {
    var t = 0;
    return {
      kind: model.kind || 'melody', key: model.key, meter: model.meter, tempo: model.tempo, chords: model.chords || [],
      notes: model.notes.map(function (n) { var o = { tick: t, ticks: n.ticks, midi: n.midi }; t += n.ticks; return o; }),
    };
  }

  async function save(force) {
    if (state.saving) return;
    clearTimeout(saveTimer);
    state.saving = true;
    statusEl.textContent = 'Guardando…';
    try {
      var abc = M.toAbc(model, titleInput.value, { barsPerLine: 4, aheadBars: 0 }).abc;
      var r = await E.api('PUT', saveUrl, { abc: abc, model: modelForSave(), title: titleInput.value, version: state.version, force: Boolean(force) });
      state.version = r.version;
      state.dirty = false;
      statusEl.textContent = 'Guardado';
    } catch (e) {
      if (e.status === 409 && e.data && e.data.conflict) {
        if (window.confirm(e.data.by + ' ha guardado otra versión mientras editabas.\n\nAceptar: guardar la tuya encima.\nCancelar: recargar la suya.')) {
          state.saving = false;
          state.version = e.data.version;
          return save(true);
        }
        state.dirty = false;
        location.reload();
      } else {
        statusEl.textContent = 'No se pudo guardar: ' + e.message;
      }
    } finally {
      state.saving = false;
    }
  }

  // ---------- Entradas ----------
  root.querySelector('[data-piano]').addEventListener('pointerdown', function (e) {
    var k = e.target.closest('[data-st]');
    if (!k) return;
    e.preventDefault();
    addNote(state.base + Number(k.dataset.st));
    k.classList.add('is-down');
    setTimeout(function () { k.classList.remove('is-down'); }, 160);
  });

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-dur')) setDur(Number(b.dataset.dur));
    else if (b.hasAttribute('data-dot')) {
      state.dot = !state.dot;
      b.setAttribute('aria-pressed', String(state.dot));
      if (model.notes[state.sel] && state.lastAction === 'select') modifySelected(function (n) { n.ticks = currentTicks(); });
    } else if (b.hasAttribute('data-rest')) addNote(null);
    else if (b.dataset.oct) setOctave(state.base + 12 * Number(b.dataset.oct));
    var act = b.dataset.act;
    if (act === 'undo') undo();
    if (act === 'left') { state.sel = Math.max(-1, state.sel - 1); state.lastAction = 'select'; highlight(); info(); }
    if (act === 'right') { state.sel = Math.min(model.notes.length - 1, state.sel + 1); state.lastAction = 'select'; highlight(); info(); }
    if (act === 'up' || act === 'down') modifySelected(function (n) { if (n.midi !== null) { n.midi += act === 'up' ? 1 : -1; preview(n.midi); } });
    if (act === 'delete') removeSelected();
    if (act === 'play') play();
    if (act === 'stop') stop();
    if (act === 'print') window.print();
    if (act === 'save') save(false);
    if (act === 'midi-in') connectMidi(b);
  });

  // Al tocar una nota de la partitura queda seleccionada: los botones de duración la cambian.
  renderEl.addEventListener('click', function () { state.lastAction = 'select'; });

  var KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, 'ñ': 16, ';': 16 };
  var DURKEYS = { 1: 16, 2: 8, 3: 4, 4: 2, 5: 1 };
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    var key = e.key.toLowerCase();
    if (KEYMAP[key] !== undefined) { e.preventDefault(); addNote(state.base + KEYMAP[key]); return; }
    if (DURKEYS[key]) { setDur(DURKEYS[key]); return; }
    if (key === '.') { root.querySelector('[data-dot]').click(); return; }
    if (key === 'z') { setOctave(state.base - 12); return; }
    if (key === 'x') { setOctave(state.base + 12); return; }
    if (key === 'r' || key === ' ') { e.preventDefault(); addNote(null); return; }
    if (key === 'backspace' || key === 'delete') { e.preventDefault(); removeSelected(); return; }
    if (key === 'arrowleft') { e.preventDefault(); root.querySelector('[data-act="left"]').click(); return; }
    if (key === 'arrowright') { e.preventDefault(); root.querySelector('[data-act="right"]').click(); return; }
    if (key === 'arrowup' || key === 'arrowdown') {
      e.preventDefault();
      var step = (key === 'arrowup' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      modifySelected(function (n) { if (n.midi !== null) { n.midi += step; preview(n.midi); } });
    }
  });

  // Teclado MIDI (Chrome, Edge…): cada nota que se toca se escribe con la duración elegida.
  var midiBtn = root.querySelector('[data-act="midi-in"]');
  if (navigator.requestMIDIAccess) midiBtn.hidden = false;
  function connectMidi(btn) {
    navigator.requestMIDIAccess().then(function (access) {
      var count = 0;
      access.inputs.forEach(function (input) {
        count++;
        input.onmidimessage = function (msg) {
          var d = msg.data;
          if ((d[0] & 0xf0) === 0x90 && d[2] > 0) addNote(d[1]);
        };
      });
      btn.textContent = count ? 'Teclado MIDI conectado' : 'No hay teclado MIDI';
      btn.disabled = Boolean(count);
    }).catch(function () { E.toast('El navegador no ha dado acceso al teclado MIDI.'); });
  }

  titleInput.addEventListener('input', function () {
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(false); }, 2500);
  });
  window.addEventListener('beforeunload', function (ev) {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 250); });

  // Octava inicial según la tonalidad (que quede en el pentagrama).
  setOctave(60);
  render();
})();
