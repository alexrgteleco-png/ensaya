/* Página del generador de solos: controles, partitura (abcjs), historial, enlace y sonido (Web Audio). */
(function () {
  'use strict';
  var root = document.querySelector('[data-solo-generator]');
  if (!root) return;
  var E = window.Ensaya;
  var S = window.SoloEngine;
  var A = window.ABCJS;
  var data = JSON.parse(document.getElementById('solo-data').textContent);
  var form = root.querySelector('[data-controls]');
  var scoreEl = root.querySelector('[data-score]');
  var metaEl = root.querySelector('[data-meta]');
  var histOut = root.querySelector('[data-history-pos]');
  var playBtn = root.querySelector('[data-act="play"]');
  var loopBtn = root.querySelector('[data-act="loop"]');
  var STORE = 'ensaya.solos.' + data.song.id;

  var GEN_KEYS = ['style', 'key', 'scale', 'tempo', 'meter', 'bars', 'density', 'rests', 'swing', 'variability', 'repetition', 'chordFollow', 'chromatic', 'ornaments', 'register', 'range', 'endOnTonic', 'progression'];
  var SEN = window.SoundEngine;
  var UI_DEFAULTS = (function () {
    var d = { instrument: 'gtr_rock', soundPreset: 'lead_rock', quality: 'alta', chords: 'pno_bright', bass: 'bass_pick', transpose: '0', volSolo: 80, volBand: 45, volDrums: 50, tab: false, countIn: true };
    var fx = SEN.presetFx('gtr_rock');
    Object.keys(fx).forEach(function (k) { d['fx_' + k] = fx[k]; });
    return d;
  })();

  var state = { history: [], pos: -1, current: null, elements: [], loop: false };

  function load(key, def) {
    try { var v = localStorage.getItem(STORE + key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(key, v) {
    try { localStorage.setItem(STORE + key, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------- Formulario ----------
  function setForm(values) {
    Object.keys(values).forEach(function (k) {
      var el = form.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(values[k]);
      else el.value = values[k];
    });
    updateOutputs();
  }

  function readForm() {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      out[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
    });
    return out;
  }

  // Compases por línea según el ancho de pantalla y lo cargado que esté el solo.
  function layoutOpts(params) {
    var w = scoreEl.clientWidth || window.innerWidth;
    var dense = Number(params.density) >= 7 || params.meter === '12/8';
    var per = w < 520 ? (dense ? 1 : 2) : w < 900 ? 2 : dense ? 2 : 4;
    return { barsPerLine: per };
  }

  function genParams(values, seed) {
    var p = { seed: seed };
    GEN_KEYS.forEach(function (k) { p[k] = values[k]; });
    return p;
  }

  function updateOutputs() {
    form.querySelectorAll('output[data-out]').forEach(function (o) {
      var el = form.elements[o.dataset.out];
      if (!el) return;
      var v = Number(el.value);
      var name = o.dataset.out;
      if (name === 'density') o.textContent = v <= 3 ? 'Pocas (' + v + ')' : v <= 6 ? 'Media (' + v + ')' : 'Muchas (' + v + ')';
      else if (name === 'fx_bass' || name === 'fx_mid' || name === 'fx_treble') o.textContent = (v > 0 ? '+' : '') + v + ' dB';
      else if (name === 'fx_pan') o.textContent = v === 0 ? 'Centro' : v < 0 ? 'Izq. ' + -v : 'Der. ' + v;
      else o.textContent = v + ' %';
    });
  }

  // ---------- Generar y dibujar ----------
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

  function render(result) {
    var ui = readForm();
    var opts = {
      responsive: 'resize',
      add_classes: true,
      visualTranspose: ui.tab ? 0 : Number(ui.transpose) || 0,
      clickListener: function (abcElem) {
        if (abcElem.midiPitches && abcElem.midiPitches.length) synth.previewNote(abcElem.midiPitches[0].pitch - (Number(ui.transpose) || 0) * (ui.tab ? 0 : 1));
      },
    };
    if (ui.tab) opts.tablature = [{ instrument: 'guitar', label: 'Guitarra', tuning: ['E,', 'A,', 'D', 'G', 'B', 'e'], highestNote: "e'" }];
    var tunes = A.renderAbc(scoreEl, result.abc, opts);
    state.elements = tunes && tunes[0] ? noteElements(tunes[0]) : [];
    var p = result.params;
    var st = S.STYLES[p.style].name;
    metaEl.textContent = st + ' · ' + p.key + ' ' + S.SCALES[p.scale].name + ' · ' + p.tempo + ' bpm · ' + p.meter + ' · ' + p.bars + ' compases · acordes: ' + result.chords.slice(0, Math.min(result.chords.length, 8)).join(' ') + ' · solo nº ' + p.seed;
  }

  function regenerate() {
    if (!state.current) return;
    var ui = readForm();
    var result = S.generate(genParams(ui, state.current.params.seed), layoutOpts(ui));
    state.current = result;
    state.history[state.pos] = { seed: result.params.seed, params: genParams(ui, result.params.seed) };
    render(result);
    persist();
    if (synth.playing) synth.restart(result);
    else synth.warm(result);
  }

  function newSolo(seed) {
    var ui = readForm();
    var s = seed || Math.floor(Math.random() * 4294967295) + 1;
    var result = S.generate(genParams(ui, s), layoutOpts(ui));
    state.history = state.history.slice(0, state.pos + 1);
    state.history.push({ seed: s, params: genParams(ui, s) });
    if (state.history.length > 30) state.history.shift();
    state.pos = state.history.length - 1;
    state.current = result;
    render(result);
    updateHistory();
    persist();
    if (synth.playing) synth.restart(result);
    else synth.warm(result);
  }

  function goHistory(delta) {
    var pos = state.pos + delta;
    if (pos < 0 || pos >= state.history.length) return;
    state.pos = pos;
    var h = state.history[pos];
    setForm(h.params);
    state.current = S.generate(h.params, layoutOpts(h.params));
    render(state.current);
    updateHistory();
    persist();
    if (synth.playing) synth.restart(state.current);
  }

  function updateHistory() {
    histOut.textContent = (state.pos + 1) + ' / ' + state.history.length;
    root.querySelector('[data-act="prev"]').disabled = state.pos <= 0;
    root.querySelector('[data-act="next"]').disabled = state.pos >= state.history.length - 1;
  }

  function persist() {
    var ui = readForm();
    var uiPrefs = {};
    Object.keys(UI_DEFAULTS).forEach(function (k) { uiPrefs[k] = ui[k]; });
    save('.ui', uiPrefs);
    save('.history', { history: state.history.slice(-30), pos: state.pos });
    if (state.current) {
      var hash = 'solo=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(state.history[state.pos].params)))));
      history.replaceState(null, '', '#' + hash);
    }
  }

  // ---------- Sonido (muestras reales + efectos) ----------
  var SE = window.SoundEngine;
  var statusEl = root.querySelector('[data-sound-status]');
  var FX_KEYS = Object.keys(SE.FX_DEFAULT);

  function fxFromForm(ui) {
    var fx = {};
    FX_KEYS.forEach(function (k) {
      var v = ui['fx_' + k];
      fx[k] = typeof SE.FX_DEFAULT[k] === 'number' ? Number(v) : v;
    });
    return fx;
  }

  function fxToForm(fx) {
    var vals = {};
    FX_KEYS.forEach(function (k) { vals['fx_' + k] = fx[k]; });
    setForm(vals);
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'sg-status small ' + (kind || '');
  }

  function voicing(tones) {
    return tones.map(function (pc) {
      var m = 55 + ((pc - 55) % 12 + 12) % 12;
      return m;
    }).sort(function (a, b) { return a - b; });
  }

  var synth = (function () {
    var ctx = null;
    var engine = null;
    var current = null;
    var startAt = 0;
    var timer = null;
    var raf = null;
    var loading = null;

    function ensure() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        engine = SE.create(ctx, { quality: readForm().quality });
      }
      if (ctx.state === 'suspended') ctx.resume();
      applySettings();
    }

    function applySettings() {
      if (!engine) return;
      var ui = readForm();
      engine.setQuality(ui.quality);
      engine.applyFx(fxFromForm(ui), Number(ui.tempo) || 100);
      engine.setLevels({ solo: ui.volSolo / 100, band: ui.volBand / 100, drums: ui.volDrums / 100 });
    }

    function samples() {
      var ui = readForm();
      var inst = SE.INSTRUMENTS[ui.instrument] || SE.INSTRUMENTS.gtr_rock;
      return {
        solo: inst.sample,
        chords: (SE.CHORD_INSTRUMENTS[ui.chords] || {}).sample || null,
        bass: (SE.BASS_INSTRUMENTS[ui.bass] || {}).sample || null,
      };
    }

    function requestsFor(result) {
      var s = samples();
      var solo = {};
      result.events.notes.forEach(function (n) {
        if (n.rest) return;
        solo[n.midi] = true;
        if (n.grace) solo[n.grace] = true;
      });
      var chordNotes = {};
      var bassNotes = {};
      result.events.chords.forEach(function (c) {
        voicing(c.tones).forEach(function (m) { chordNotes[m] = true; });
        bassNotes[36 + c.root] = true;
      });
      var keys = function (o) { return Object.keys(o).map(Number); };
      return [
        { sample: s.solo, midis: keys(solo) },
        { sample: s.chords, midis: keys(chordNotes) },
        { sample: s.bass, midis: keys(bassNotes) },
      ];
    }

    // Descarga las muestras que falten (sin bloquear más de 15 s).
    function prepare(result) {
      ensure();
      var reqs = requestsFor(result);
      var p = engine.preload(reqs, function (done, total, failed) {
        if (total) setStatus('Cargando sonidos reales… ' + done + ' de ' + total, 'loading');
        if (done === total) {
          if (failed === total && total > 0) setStatus('Sin conexión con el banco de sonidos: se usa sonido sintetizado.', 'warn');
          else if (failed) setStatus('Sonidos listos (' + failed + ' notas con sonido sintetizado).', 'ok');
          else setStatus('Sonidos reales listos.', 'ok');
        }
      });
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ timeout: true }); }, 15000); });
      loading = Promise.race([p, timeout]);
      return loading;
    }

    function scheduleDrums(result, t0) {
      var ev = result.events;
      var p = result.params;
      var bpb = ev.beatsPerBar;
      var beat = ev.beatSec;
      var swing = p.swing / 100;
      var compound = p.meter === '6/8' || p.meter === '12/8';
      for (var b = 0; b < ev.chords.length; b++) {
        for (var k = 0; k < bpb; k++) {
          var t = t0 + (b * bpb + k) * beat;
          if (p.style === 'flamenco') {
            // Palmas: acentos en cada pulso y contratiempos.
            engine.drum('clap', t, k === 0 ? 1 : 0.7);
            if (compound) engine.drum('clap', t + (2 * beat) / 3, 0.45);
            else engine.drum('clap', t + beat / 2, 0.45);
            if (k === 0) engine.drum('kick', t, 0.5);
            continue;
          }
          if (p.style === 'jazz') {
            engine.drum('ride', t, 0.9);
            engine.drum('ride', t + beat * (0.5 + swing * 0.1667), 0.55);
            if (k % 2 === 1) engine.drum('hat', t, 0.6);
            if (k === 0) engine.drum('kick', t, 0.4);
            continue;
          }
          if (k === 0 || (bpb === 4 && k === 2)) engine.drum('kick', t);
          if ((bpb === 4 && (k === 1 || k === 3)) || (bpb === 2 && k === 1) || (bpb === 3 && k === 1)) engine.drum('snare', t);
          if (compound) {
            for (var s = 0; s < 3; s++) engine.drum('hat', t + (s * beat) / 3, s === 0 ? 1 : 0.6);
          } else if (p.style === 'funk' || p.style === 'metal') {
            for (var q = 0; q < 4; q++) engine.drum('hat', t + (q * beat) / 4, q === 0 ? 1 : 0.5);
          } else {
            engine.drum('hat', t, 1);
            engine.drum('hat', t + beat * (0.5 + swing * 0.1667), 0.6);
          }
        }
      }
    }

    function scheduleAll(result, t0) {
      var s = samples();
      var ev = result.events;
      var guitar = /^gtr_/.test(readForm().instrument);
      ev.notes.forEach(function (n) {
        if (n.rest) return;
        var t = t0 + n.time;
        if (n.grace) {
          var diff = n.midi - n.grace;
          if (guitar && diff > 0 && diff <= 2) {
            engine.soloNote(s.solo, n.midi, t, n.duration, n.velocity, { bendFrom: diff });
            return;
          }
          engine.soloNote(s.solo, n.grace, t - 0.05, 0.06, n.velocity * 0.8);
        }
        engine.soloNote(s.solo, n.midi, t, n.duration, n.velocity);
      });
      ev.chords.forEach(function (c) {
        voicing(c.tones).forEach(function (m) { engine.bandNote(s.chords, m, t0 + c.time, c.duration * 0.98, 0.42, 'pad'); });
        for (var k = 0; k < ev.beatsPerBar; k++) {
          var bassMidi = 36 + c.root;
          engine.bandNote(s.bass, bassMidi, t0 + c.time + k * ev.beatSec, ev.beatSec * 0.9, k === 0 ? 0.95 : 0.75, 'bass');
        }
      });
      scheduleDrums(result, t0);
    }

    function highlight() {
      if (!api.playing || !current) return;
      var tNow = ctx.currentTime - startAt;
      var notes = current.events.notes;
      var activeIdx = -1;
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].time <= tNow) activeIdx = i;
        else break;
      }
      state.elements.forEach(function (set, i) {
        set.forEach(function (el) { el.classList.toggle('sg-active', i === activeIdx); });
      });
      raf = requestAnimationFrame(highlight);
    }

    function clearHighlight() {
      state.elements.forEach(function (set) { set.forEach(function (el) { el.classList.remove('sg-active'); }); });
    }

    function startPass(result, withCountIn) {
      var ui = readForm();
      var t0 = ctx.currentTime + 0.12;
      var ev = result.events;
      if (withCountIn && ui.countIn) {
        for (var k = 0; k < ev.beatsPerBar; k++) engine.drum('hat', t0 + k * ev.beatSec, k === 0 ? 1.6 : 1.1);
        t0 += ev.beatsPerBar * ev.beatSec;
      }
      startAt = t0;
      scheduleAll(result, t0);
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!api.playing) return;
        if (state.loop) {
          engine.stopAll();
          startPass(current, false);
        } else {
          api.stop();
        }
      }, (t0 - ctx.currentTime + ev.totalSec) * 1000 + 60);
    }

    function setPlaying(on) {
      playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      playBtn.lastChild.textContent = on ? ' Parar' : ' Escuchar';
    }

    var api = {
      playing: false,
      play: function (result) {
        ensure();
        current = result;
        api.playing = true;
        setPlaying(true);
        prepare(result).then(function () {
          if (!api.playing || current !== result) return;
          startPass(result, true);
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(highlight);
        });
      },
      stop: function () {
        api.playing = false;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        if (engine) engine.stopAll();
        clearHighlight();
        setPlaying(false);
      },
      restart: function (result) {
        current = result;
        engine.stopAll();
        clearTimeout(timer);
        prepare(result).then(function () {
          if (api.playing && current === result) startPass(result, false);
        });
      },
      // Precarga en segundo plano (solo después de que la persona haya tocado algo).
      warm: function (result) {
        if (engine) prepare(result);
      },
      settingsChanged: function () {
        applySettings();
      },
      previewNote: function (midi) {
        ensure();
        var s = samples();
        engine.preload([{ sample: s.solo, midis: [midi] }]).then(function () {
          engine.soloNote(s.solo, midi, ctx.currentTime + 0.02, 0.6, 0.9);
        });
      },
      // Frase corta para probar el instrumento y los efectos.
      audition: function () {
        ensure();
        var ui = readForm();
        var s = samples();
        var base = S.spellScale(ui.key, ui.scale).notes.map(function (n) { return n.pc; });
        var start = { grave: 45, medio: 57, agudo: 64 }[ui.register] || 57;
        var run = [];
        for (var m = start; run.length < 8; m++) if (base.indexOf(m % 12) >= 0) run.push(m);
        run = run.concat(run.slice(0, 7).reverse());
        engine.preload([{ sample: s.solo, midis: run }], function (d, tot) { if (tot) setStatus('Cargando sonidos reales… ' + d + ' de ' + tot, 'loading'); }).then(function () {
          setStatus('Sonidos reales listos.', 'ok');
          var t = ctx.currentTime + 0.05;
          var step = 60 / (Number(ui.tempo) || 100) / 2;
          run.forEach(function (mm, i) {
            engine.soloNote(s.solo, mm, t + i * step, i === run.length - 1 ? step * 4 : step * 0.95, i % 4 === 0 ? 1 : 0.8);
          });
        });
      },
    };
    return api;
  })();

  function applyPreset(id) {
    var pr = SE.FX_PRESETS[id];
    if (!pr) return;
    var fx = Object.assign({}, SE.FX_DEFAULT, pr.fx);
    fxToForm(fx);
  }

  // ---------- Eventos ----------
  var regenTimer = null;
  form.addEventListener('input', function (e) {
    updateOutputs();
    var name = e.target.name;
    if (name === 'style') return; // lo trata 'change'
    if (GEN_KEYS.indexOf(name) >= 0) {
      clearTimeout(regenTimer);
      regenTimer = setTimeout(regenerate, 160);
      if (name === 'tempo') synth.settingsChanged();
    } else if (/^fx_/.test(name)) {
      form.elements.soundPreset.value = 'custom';
      synth.settingsChanged();
      persist();
    } else if (name === 'soundPreset') {
      if (e.target.value !== 'custom') applyPreset(e.target.value);
      synth.settingsChanged();
      persist();
    } else if (name === 'instrument') {
      var inst = SE.INSTRUMENTS[e.target.value];
      if (inst) {
        fxToForm(SE.presetFx(e.target.value));
        form.elements.soundPreset.value = inst.preset;
      }
      synth.settingsChanged();
      if (state.current) synth.warm(state.current);
      persist();
    } else if (name === 'chords' || name === 'bass' || name === 'quality') {
      synth.settingsChanged();
      if (state.current) synth.warm(state.current);
      persist();
    } else if (name === 'volSolo' || name === 'volBand' || name === 'volDrums') {
      synth.settingsChanged();
      persist();
    } else if (name === 'transpose' || name === 'tab') {
      render(state.current);
      persist();
    } else {
      persist();
    }
  });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'style') {
      // Al cambiar de estilo se cargan sus valores típicos (luego se pueden retocar).
      var st = data.styles[e.target.value];
      setForm({ scale: st.scale, density: st.density, variability: st.variability, rests: st.rests, swing: st.swing, chromatic: st.chromatic, ornaments: st.ornaments, repetition: st.repetition });
      if (st.progression) form.elements.progression.value = S.progressionFor(form.elements.key.value, st.progression);
      else if (data.songProgression) form.elements.progression.value = data.songProgression;
      // Y el sonido típico del estilo: su guitarra, acompañamiento, bajo y efectos.
      var snd = SE.STYLE_SOUND[e.target.value];
      if (snd) {
        setForm({ instrument: snd.instrument, chords: snd.chords, bass: snd.bass, soundPreset: SE.INSTRUMENTS[snd.instrument].preset });
        fxToForm(SE.presetFx(snd.instrument));
        synth.settingsChanged();
      }
      regenerate();
    }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!state.current) return;
      var p = state.current.params;
      var re = S.generate(p, layoutOpts(p));
      if (re.abc !== state.current.abc) {
        state.current = re;
        render(re);
      }
    }, 250);
  });

  root.querySelectorAll('[data-prog]').forEach(function (b) {
    b.addEventListener('click', function () {
      form.elements.progression.value = b.dataset.prog === 'song' ? data.songProgression : S.progressionFor(form.elements.key.value, b.dataset.prog);
      if (b.dataset.prog === 'blues' && Number(form.elements.bars.value) < 12) form.elements.bars.value = '12';
      regenerate();
    });
  });

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'new') newSolo();
    if (act === 'audition') synth.audition();
    if (act === 'resetFx') {
      fxToForm(SE.presetFx(form.elements.instrument.value));
      form.elements.soundPreset.value = (SE.INSTRUMENTS[form.elements.instrument.value] || {}).preset || 'limpio';
      synth.settingsChanged();
      persist();
    }
    if (act === 'play') {
      if (synth.playing) synth.stop();
      else synth.play(state.current);
    }
    if (act === 'loop') {
      state.loop = !state.loop;
      loopBtn.setAttribute('aria-pressed', String(state.loop));
    }
    if (act === 'prev') goHistory(-1);
    if (act === 'next') goHistory(1);
    if (act === 'save') saveScore(b);
    if (act === 'midi') downloadMidi();
    if (act === 'link') {
      var url = location.href;
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { E.toast('Enlace copiado'); }, function () { window.prompt('Copia el enlace:', url); });
      else window.prompt('Copia el enlace:', url);
    }
    if (act === 'print') window.print();
  });

  async function saveScore(btn) {
    btn.disabled = true;
    try {
      var title = root.querySelector('[data-save-title]').value.trim();
      var r = await E.api('POST', data.save, { abc: state.current.abc, title: title });
      E.toast('Guardado en las partituras de la canción');
      btn.textContent = 'Guardado ✓ · ver';
      btn.disabled = false;
      btn.onclick = function () { location.href = r.url; };
      btn.removeAttribute('data-act');
    } catch (err) {
      btn.disabled = false;
      E.toast(err.message);
    }
  }

  function downloadMidi() {
    try {
      var files = A.synth.getMidiFile(state.current.abc, { midiOutputType: 'binary', midiTranspose: 0 });
      var blob = new Blob([files[0]], { type: 'audio/midi' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      var base = (data.song.title + ' solo ' + state.current.params.seed).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]/g, '').trim();
      a.download = (base || 'solo') + '.mid';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) {
      E.toast('No se pudo generar el MIDI.');
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, select, textarea, button') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') newSolo();
    if (e.key === ' ') {
      e.preventDefault();
      playBtn.click();
    }
  });

  // ---------- Inicio ----------
  (function init() {
    var fromLink = null;
    var m = /solo=([^&]+)/.exec(location.hash);
    if (m) {
      try { fromLink = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); } catch (e) { fromLink = null; }
    }
    var stored = load('.history', null);
    var storedUi = load('.ui', {});
    if (storedUi.instrument && !SEN.INSTRUMENTS[storedUi.instrument]) delete storedUi.instrument;
    var ui = Object.assign({}, UI_DEFAULTS, storedUi);
    if (!storedUi.instrument) {
      // Primera vez: sonido del estilo por defecto.
      var snd0 = SEN.STYLE_SOUND[(data.defaults && data.defaults.style) || 'rock'];
      if (snd0) {
        ui.instrument = snd0.instrument; ui.chords = snd0.chords; ui.bass = snd0.bass; ui.soundPreset = SEN.INSTRUMENTS[snd0.instrument].preset;
        var fx0 = SEN.presetFx(snd0.instrument);
        Object.keys(fx0).forEach(function (k) { ui['fx_' + k] = fx0[k]; });
      }
    }
    if (fromLink) {
      setForm(Object.assign({}, data.defaults, ui, fromLink));
      state.history = stored && stored.history ? stored.history : [];
      state.history.push({ seed: fromLink.seed, params: fromLink });
      state.pos = state.history.length - 1;
      state.current = S.generate(fromLink, layoutOpts(fromLink));
      render(state.current);
      updateHistory();
      persist();
    } else if (stored && stored.history && stored.history.length) {
      state.history = stored.history;
      state.pos = Math.min(stored.pos, stored.history.length - 1);
      setForm(Object.assign({}, data.defaults, ui, state.history[state.pos].params));
      state.current = S.generate(state.history[state.pos].params, layoutOpts(state.history[state.pos].params));
      render(state.current);
      updateHistory();
    } else {
      setForm(Object.assign({}, data.defaults, ui));
      newSolo();
    }
  })();
})();
