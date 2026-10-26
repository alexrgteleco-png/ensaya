/* Página del generador de solos: modos principiante y experto, partitura (abcjs), historial, enlace
 * y sonido con muestras reales, efectos y banda de acompañamiento del estilo (Web Audio). */
(function () {
  'use strict';
  var root = document.querySelector('[data-solo-generator]');
  if (!root) return;
  var E = window.Ensaya;
  var S = window.SoloEngine;
  var SE = window.SoundEngine;
  var A = window.ABCJS;
  var data = JSON.parse(document.getElementById('solo-data').textContent);
  var form = root.querySelector('[data-controls]');
  var scoreEl = root.querySelector('[data-score]');
  var metaEl = root.querySelector('[data-meta]');
  var histOut = root.querySelector('[data-history-pos]');
  var playBtn = root.querySelector('[data-act="play"]');
  var loopBtn = root.querySelector('[data-act="loop"]');
  var statusEl = root.querySelector('[data-sound-status]');
  var STORE = 'ensaya.solos2.' + data.song.id;

  var GEN_KEYS = ['style', 'level', 'key', 'tempo', 'meter', 'choruses', 'bars', 'progression', 'useSong', 'density', 'rests', 'swing', 'tuplets', 'variability', 'repetition', 'chordFollow', 'chromatic', 'ornaments', 'paraphrase', 'register', 'range', 'scale', 'endOnTonic'];
  var LEVEL_KEYS = ['density', 'variability', 'rests', 'swing', 'chromatic', 'ornaments', 'repetition', 'chordFollow', 'range', 'register', 'scale'];
  var UI_DEFAULTS = (function () {
    var d = { instrument: 'gtr_jazz', soundPreset: 'jazz', quality: 'alta', chords: 'pno_grand', bass: 'bass_upright', transpose: '0', volSolo: 80, volBand: 50, volDrums: 45, tab: false, countIn: true };
    var fx = SE.presetFx('gtr_jazz');
    Object.keys(fx).forEach(function (k) { d['fx_' + k] = fx[k]; });
    return d;
  })();

  var state = { history: [], pos: -1, current: null, elements: [], loop: false, mode: 'principiante', flavor: '' };

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
      if (!el || values[k] === undefined) return;
      if (typeof RadioNodeList !== 'undefined' && el instanceof RadioNodeList) el.value = String(values[k]);
      else if (el.type === 'checkbox') el.checked = values[k] === true || values[k] === 'true';
      else el.value = values[k];
    });
    updateOutputs();
    updateProgBox();
  }

  function readForm() {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'radio') {
        if (el.checked) out[el.name] = el.value;
        return;
      }
      out[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
    });
    return out;
  }

  function updateProgBox() {
    var box = root.querySelector('[data-prog-box]');
    var use = form.elements.useSong;
    if (box) box.hidden = Boolean(use && use.checked);
  }

  // Compases por línea según el ancho de pantalla y lo cargado que esté el solo.
  function layoutOpts(params, extra) {
    var w = scoreEl.clientWidth || window.innerWidth;
    var dense = Number(params.density) >= 7 || params.meter === '12/8';
    var per = w < 520 ? (dense ? 1 : 2) : w < 900 ? 2 : dense ? 3 : 4;
    var o = { barsPerLine: per };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  function genParams(values, seed) {
    var p = { seed: seed };
    GEN_KEYS.forEach(function (k) { if (values[k] !== undefined) p[k] = values[k]; });
    if (values.flavor) p.flavor = values.flavor;
    return p;
  }

  // Añade los datos de la canción (cifrado y melodía) que no viajan en el enlace.
  function withSong(p) {
    var q = Object.assign({}, p);
    if (q.useSong && data.form && data.form.length) q.form = data.form;
    if (data.theme && q.paraphrase > 0) q.theme = data.theme;
    if (state.mode === 'principiante' || q.level) q.tuplets = q.level === 'facil' ? false : q.tuplets !== false;
    return q;
  }

  function generate(p, extra) {
    return S.generate(withSong(p), layoutOpts(p, extra));
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

  // Valores del estilo y la dificultad (modo principiante, o al cambiar de estilo en experto).
  function applyStyle(style, level, withSound) {
    var vals = S.paramsFor(style, level || 'medio');
    var set = {};
    LEVEL_KEYS.forEach(function (k) { set[k] = vals[k]; });
    set.tuplets = level !== 'facil';
    set.paraphrase = 0;
    setForm(set);
    if (withSound) applyStyleSound(style);
  }

  function applyStyleSound(style) {
    var snd = SE.STYLE_SOUND[style];
    if (!snd) return;
    setForm({ instrument: snd.instrument, chords: snd.chords, bass: snd.bass, soundPreset: snd.preset || SE.INSTRUMENTS[snd.instrument].preset });
    var fx = SE.presetFx(snd.instrument);
    if (snd.preset && SE.FX_PRESETS[snd.preset]) fx = Object.assign({}, SE.FX_DEFAULT, SE.FX_PRESETS[snd.preset].fx);
    fxToForm(fx);
    synth.settingsChanged();
  }

  function setMode(mode) {
    state.mode = mode === 'experto' ? 'experto' : 'principiante';
    root.dataset.mode = state.mode;
    document.querySelectorAll('[data-mode-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.modeBtn === state.mode));
    });
    save('.mode', state.mode);
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
    var bars = result.bars.length;
    var parts = [
      (state.flavor ? '✨ ' + state.flavor + ' · ' : '') + S.STYLES[p.style].name,
      'en ' + S.parseKey(p.key).name,
      p.tempo + ' bpm',
      bars + ' compases' + (p.form && p.form.length ? ' (' + p.choruses + (p.choruses === 1 ? ' vuelta' : ' vueltas') + ')' : ''),
      'nº ' + p.seed,
    ];
    metaEl.textContent = parts.join(' · ');
  }

  function show(result) {
    state.current = result;
    render(result);
    updateHistory();
    persist();
    if (synth.playing) synth.restart(result);
    else synth.warm(result);
  }

  function regenerate() {
    if (!state.current) return;
    var ui = readForm();
    var params = genParams(ui, state.current.params.seed);
    state.history[state.pos] = { seed: params.seed, params: params, flavor: state.flavor };
    show(generate(params));
  }

  function newSolo(seed, extra) {
    var ui = readForm();
    var s = seed || Math.floor(Math.random() * 4294967295) + 1;
    var params = genParams(ui, s);
    state.history = state.history.slice(0, state.pos + 1);
    state.history.push({ seed: s, params: params, flavor: state.flavor });
    if (state.history.length > 40) state.history.shift();
    state.pos = state.history.length - 1;
    show(generate(params, extra));
  }

  // «Inspírame»: ajustes probados para el estilo y la mejor de 12 versiones.
  function inspire() {
    var ui = readForm();
    var s = Math.floor(Math.random() * 4294967295) + 1;
    var p = S.inspire(ui.style || 'swing', s);
    state.flavor = p.flavor;
    var set = {};
    LEVEL_KEYS.concat(['paraphrase']).forEach(function (k) { if (p[k] !== undefined) set[k] = p[k]; });
    if (!data.theme) set.paraphrase = 0;
    setForm(set);
    newSolo(s, { candidates: 12 });
  }

  function goHistory(delta) {
    var pos = state.pos + delta;
    if (pos < 0 || pos >= state.history.length) return;
    state.pos = pos;
    var h = state.history[pos];
    state.flavor = h.flavor || '';
    setForm(h.params);
    show(generate(h.params));
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
    save('.history', { history: state.history.slice(-40), pos: state.pos });
    if (state.current && state.history[state.pos]) {
      var hash = 'solo=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(state.history[state.pos].params)))));
      history.replaceState(null, '', '#' + hash);
    }
  }

  // ---------- Sonido (muestras reales + efectos + banda) ----------
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

  var synth = (function () {
    var ctx = null;
    var engine = null;
    var current = null;
    var startAt = 0;
    var timer = null;
    var raf = null;

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
      var inst = SE.INSTRUMENTS[ui.instrument] || SE.INSTRUMENTS.gtr_jazz;
      return {
        solo: inst.sample,
        chords: (SE.CHORD_INSTRUMENTS[ui.chords] || {}).sample || null,
        bass: (SE.BASS_INSTRUMENTS[ui.bass] || {}).sample || null,
      };
    }

    function requestsFor(result) {
      var s = samples();
      var solo = {};
      var chordNotes = {};
      var bassNotes = {};
      result.events.notes.forEach(function (n) {
        if (n.rest) return;
        solo[n.midi] = true;
        if (n.grace) solo[n.grace] = true;
      });
      (result.events.band || []).forEach(function (b) {
        if (b.part === 'bass') bassNotes[b.midi] = true;
        if (b.part === 'chord') b.midis.forEach(function (m) { chordNotes[m] = true; });
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
      var p = engine.preload(requestsFor(result), function (done, total, failed) {
        if (total) setStatus('Cargando sonidos reales… ' + done + ' de ' + total, 'loading');
        if (done === total) {
          if (failed === total && total > 0) setStatus('Sin conexión con el banco de sonidos: se usa sonido sintetizado.', 'warn');
          else if (failed) setStatus('Sonidos listos (' + failed + ' notas con sonido sintetizado).', 'ok');
          else setStatus('', 'ok');
        }
      });
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve({ timeout: true }); }, 15000); });
      return Promise.race([p, timeout]);
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
      (ev.band || []).forEach(function (b) {
        var t = t0 + b.time;
        if (b.part === 'bass') engine.bandNote(s.bass, b.midi, t, b.duration, b.velocity, 'bass');
        else if (b.part === 'chord') b.midis.forEach(function (m) { engine.bandNote(s.chords, m, t, b.duration, b.velocity, 'pad'); });
        else if (b.part === 'drum') engine.drum(b.type, t, b.velocity);
      });
    }

    function highlight() {
      if (!api.playing || !current) return;
      var tNow = ctx.currentTime - startAt;
      var notes = current.events.notes;
      var active = -1;
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].time <= tNow) active = notes[i].index;
        else break;
      }
      state.elements.forEach(function (set, i) {
        set.forEach(function (el) { el.classList.toggle('sg-active', i === active); });
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
        var k = S.parseKey(ui.key);
        var base = (k.minor ? [0, 2, 3, 5, 7, 9, 10] : [0, 2, 4, 5, 7, 9, 11]).map(function (iv) { return (k.root.pc + iv) % 12; });
        var start = { grave: 45, medio: 59, agudo: 66 }[ui.register] || 59;
        var run = [];
        for (var m = start; run.length < 8; m++) if (base.indexOf(m % 12) >= 0) run.push(m);
        run = run.concat(run.slice(0, 7).reverse());
        engine.preload([{ sample: s.solo, midis: run }], function (d, tot) { if (tot) setStatus('Cargando sonidos reales… ' + d + ' de ' + tot, 'loading'); }).then(function () {
          setStatus('', 'ok');
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
    fxToForm(Object.assign({}, SE.FX_DEFAULT, pr.fx));
  }

  // ---------- Eventos ----------
  var regenTimer = null;
  form.addEventListener('input', function (e) {
    updateOutputs();
    var name = e.target.name;
    if (name === 'style' || name === 'level' || name === 'useSong') return; // los trata 'change'
    if (GEN_KEYS.indexOf(name) >= 0) {
      state.flavor = '';
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
    var name = e.target.name;
    if (name === 'style') {
      // Nuevo estilo: sus valores típicos y su sonido (guitarra, banda, efectos), y un solo nuevo.
      var ui = readForm();
      applyStyle(ui.style, state.mode === 'principiante' ? ui.level : 'medio', true);
      if (!ui.useSong && S.STYLES[ui.style].progression) form.elements.progression.value = '';
      if (form.elements.bars) form.elements.bars.value = ui.style === 'blues' ? '12' : form.elements.bars.value;
      state.flavor = '';
      newSolo();
    } else if (name === 'level') {
      var u = readForm();
      applyStyle(u.style, u.level, false);
      state.flavor = '';
      newSolo();
    } else if (name === 'useSong') {
      updateProgBox();
      regenerate();
    }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!state.current) return;
      var re = generate(state.history[state.pos].params);
      if (re.abc !== state.current.abc) {
        state.current = re;
        render(re);
      }
    }, 250);
  });

  root.querySelectorAll('[data-prog]').forEach(function (b) {
    b.addEventListener('click', function () {
      form.elements.progression.value = S.progressionFor(form.elements.key.value, b.dataset.prog);
      if (b.dataset.prog === 'blues' && form.elements.bars && Number(form.elements.bars.value) < 12) form.elements.bars.value = '12';
      regenerate();
    });
  });

  document.querySelectorAll('[data-mode-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      setMode(b.dataset.modeBtn);
      if (state.mode === 'principiante') {
        // Al volver a principiante, se recuperan los valores del estilo y la dificultad.
        var ui = readForm();
        applyStyle(ui.style, ui.level, false);
        regenerate();
      }
    });
  });

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'new') { state.flavor = ''; newSolo(); }
    if (act === 'inspire') inspire();
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

  // Melodía en notas (para poder editarla luego con el editor sencillo).
  function modelFrom(result) {
    var notes = [];
    result.bars.forEach(function (bar, bi) {
      bar.notes.forEach(function (n) {
        if (n.tieFrom && notes.length && !n.rest) {
          notes[notes.length - 1].ticks += n.ticks;
          return;
        }
        notes.push({ tick: bi * result.barTicks + n.tick, ticks: n.ticks, midi: n.rest ? null : n.midi, tuplet: n.tuplet || 0 });
      });
    });
    var p = result.params;
    return { kind: 'solo', key: p.key, meter: p.meter, tempo: p.tempo, chords: result.events.chords.map(function (c) { return { tick: Math.round(c.time / result.events.tickSec), name: c.name }; }), notes: notes };
  }

  async function saveScore(btn) {
    btn.disabled = true;
    try {
      var title = root.querySelector('[data-save-title]').value.trim();
      var r = await E.api('POST', data.save, { abc: state.current.abc, title: title, model: modelFrom(state.current) });
      E.toast('Guardado en la canción');
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
    if (e.key === 'n' || e.key === 'N') { state.flavor = ''; newSolo(); }
    if (e.key === ' ') {
      e.preventDefault();
      playBtn.click();
    }
  });

  // ---------- Inicio ----------
  (function init() {
    setMode(load('.mode', 'principiante'));
    var fromLink = null;
    var m = /solo=([^&]+)/.exec(location.hash);
    if (m) {
      try { fromLink = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); } catch (e) { fromLink = null; }
    }
    var stored = load('.history', null);
    var storedUi = load('.ui', {});
    if (storedUi.instrument && !SE.INSTRUMENTS[storedUi.instrument]) delete storedUi.instrument;
    var ui = Object.assign({}, UI_DEFAULTS, storedUi);
    var first = !storedUi.instrument;
    if (fromLink) {
      setForm(Object.assign({}, data.defaults, ui, fromLink));
      state.history = stored && stored.history ? stored.history : [];
      state.history.push({ seed: fromLink.seed, params: fromLink, flavor: fromLink.flavor || '' });
      state.pos = state.history.length - 1;
      state.flavor = fromLink.flavor || '';
      show(generate(fromLink));
    } else if (stored && stored.history && stored.history.length) {
      state.history = stored.history;
      state.pos = Math.min(stored.pos, stored.history.length - 1);
      var h = state.history[state.pos];
      state.flavor = h.flavor || '';
      setForm(Object.assign({}, data.defaults, ui, h.params));
      show(generate(h.params));
    } else {
      setForm(Object.assign({}, data.defaults, ui));
      if (first) applyStyleSound(data.defaults.style);
      newSolo();
    }
  })();
})();
