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
  var UI_DEFAULTS = { instrument: 'guitarra', transpose: '0', volSolo: 80, volBand: 45, volDrums: 50, tab: false, countIn: true };

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

  // ---------- Sonido ----------
  var synth = (function () {
    var ctx = null;
    var master = null;
    var noise = null;
    var nodes = [];
    var startAt = 0;
    var timer = null;
    var raf = null;
    var current = null;
    var offset = 0;

    function ensure() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createDynamicsCompressor();
        master.connect(ctx.destination);
        var len = ctx.sampleRate;
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
    }

    function freq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function track(n) {
      nodes.push(n);
      return n;
    }

    function voice(midi, t, dur, vel, kind, gainMul) {
      var ui = readForm();
      var vol = (ui.volSolo / 100) * vel * (gainMul || 1);
      if (vol <= 0) return;
      var out = ctx.createGain();
      out.connect(master);
      track(out);
      var f = freq(midi);
      var oscs = [];
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.connect(out);
      if (kind === 'saxo') {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        var lfo = ctx.createOscillator();
        var lfoGain = ctx.createGain();
        lfo.frequency.value = 5.5;
        lfoGain.gain.setValueAtTime(0, t);
        lfoGain.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.25, dur));
        lfo.connect(lfoGain);
        lfoGain.connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.2);
        track(lfo);
        oscs.push(o);
        filter.frequency.value = 2200;
        filter.Q.value = 2;
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.04);
        out.gain.setValueAtTime(0.2 * vol, t + Math.max(0.05, dur - 0.05));
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      } else if (kind === 'synth') {
        var q = ctx.createOscillator();
        q.type = 'square';
        q.frequency.value = f;
        oscs.push(q);
        filter.frequency.value = 2600;
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.01);
        out.gain.setValueAtTime(0.12 * vol, t + Math.max(0.02, dur - 0.03));
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      } else if (kind === 'piano') {
        var tri = ctx.createOscillator();
        tri.type = 'triangle';
        tri.frequency.value = f;
        var sin = ctx.createOscillator();
        sin.type = 'sine';
        sin.frequency.value = f * 2;
        oscs.push(tri, sin);
        filter.frequency.value = 5000;
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.005);
        out.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(2.5, dur + 1.2));
      } else {
        // Guitarra eléctrica: dos dientes de sierra algo desafinados y filtro que se cierra.
        [-4, 4].forEach(function (cents) {
          var s = ctx.createOscillator();
          s.type = 'sawtooth';
          s.frequency.value = f;
          s.detune.value = cents;
          oscs.push(s);
        });
        filter.frequency.setValueAtTime(3800, t);
        filter.frequency.exponentialRampToValueAtTime(1100, t + Math.min(0.6, dur + 0.2));
        filter.Q.value = 1.5;
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.004);
        out.gain.exponentialRampToValueAtTime(0.09 * vol, t + Math.min(0.25, dur));
        out.gain.setValueAtTime(0.09 * vol, t + Math.max(0.01, dur - 0.02));
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      }
      oscs.forEach(function (o2) {
        o2.connect(filter);
        o2.start(t);
        o2.stop(t + dur + (kind === 'piano' ? 2.6 : 0.3));
        track(o2);
      });
    }

    function pad(tones, rootPc, t, dur) {
      var ui = readForm();
      var vol = ui.volBand / 100;
      if (vol <= 0) return;
      // Acorde alrededor de Do4 y bajo en la segunda octava.
      tones.forEach(function (pc) {
        var midi = 60 + ((pc - 60) % 12 + 12) % 12;
        if (midi > 67) midi -= 12;
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq(midi);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035 * vol, t + 0.08);
        g.gain.setValueAtTime(0.035 * vol, t + dur - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + dur + 0.05);
        track(o);
        track(g);
      });
    }

    function bass(rootPc, t, dur) {
      var ui = readForm();
      var vol = ui.volBand / 100;
      if (vol <= 0) return;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq(36 + rootPc);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3 * vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur);
      track(o);
      track(g);
    }

    function drum(type, t, vel) {
      var ui = readForm();
      var vol = (ui.volDrums / 100) * (vel || 1);
      if (vol <= 0) return;
      var g = ctx.createGain();
      g.connect(master);
      track(g);
      if (type === 'kick') {
        var o = ctx.createOscillator();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.7 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.2);
        track(o);
        return;
      }
      var src = ctx.createBufferSource();
      src.buffer = noise;
      var f = ctx.createBiquadFilter();
      if (type === 'snare') {
        f.type = 'bandpass';
        f.frequency.value = 1800;
        g.gain.setValueAtTime(0.35 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      } else {
        f.type = 'highpass';
        f.frequency.value = 7000;
        g.gain.setValueAtTime(0.12 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      }
      src.connect(f);
      f.connect(g);
      src.start(t);
      src.stop(t + 0.2);
      track(src);
    }

    function scheduleDrums(ev, t0, swing) {
      var bpb = ev.beatsPerBar;
      var beat = ev.beatSec;
      var bars = ev.chords.length;
      var compound = Math.abs(beat - 60 / current.params.tempo * 1.5) < 1e-6;
      for (var b = 0; b < bars; b++) {
        for (var k = 0; k < bpb; k++) {
          var t = t0 + (b * bpb + k) * beat;
          if (k === 0 || (bpb === 4 && k === 2)) drum('kick', t);
          if ((bpb === 4 && (k === 1 || k === 3)) || (bpb === 2 && k === 1) || (bpb === 3 && k === 1)) drum('snare', t);
          if (compound) {
            for (var s = 0; s < 3; s++) drum('hat', t + (s * beat) / 3, s === 0 ? 1 : 0.6);
          } else {
            drum('hat', t, 1);
            drum('hat', t + beat * (0.5 + swing * 0.1667), 0.6);
          }
        }
      }
    }

    function scheduleAll(result, t0) {
      var ui = readForm();
      var ev = result.events;
      ev.notes.forEach(function (n) {
        if (n.rest) return;
        var t = t0 + n.time;
        if (n.grace) {
          voice(n.grace, t - 0.05, 0.06, n.velocity * 0.8, ui.instrument);
        }
        voice(n.midi, t, n.duration, n.velocity, ui.instrument);
      });
      ev.chords.forEach(function (c) {
        pad(c.tones, c.root, t0 + c.time, c.duration);
        for (var k = 0; k < ev.beatsPerBar; k++) bass(c.root, t0 + c.time + k * ev.beatSec, ev.beatSec);
      });
      scheduleDrums(ev, t0, result.params.swing / 100);
    }

    function stopNodes() {
      nodes.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) { /* ya parado */ }
        try { n.disconnect(); } catch (e) { /* nada */ }
      });
      nodes = [];
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
        for (var k = 0; k < ev.beatsPerBar; k++) drum('hat', t0 + k * ev.beatSec, k === 0 ? 1.6 : 1.1);
        t0 += ev.beatsPerBar * ev.beatSec;
      }
      startAt = t0;
      scheduleAll(result, t0);
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!api.playing) return;
        if (state.loop) {
          stopNodes();
          startPass(current, false);
        } else {
          api.stop();
        }
      }, (t0 - ctx.currentTime + ev.totalSec) * 1000 + 60);
    }

    var api = {
      playing: false,
      play: function (result) {
        ensure();
        current = result;
        api.playing = true;
        startPass(result, true);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(highlight);
        playBtn.setAttribute('aria-pressed', 'true');
        playBtn.lastChild.textContent = ' Parar';
      },
      stop: function () {
        api.playing = false;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        stopNodes();
        clearHighlight();
        playBtn.setAttribute('aria-pressed', 'false');
        playBtn.lastChild.textContent = ' Escuchar';
      },
      restart: function (result) {
        stopNodes();
        current = result;
        startPass(result, false);
      },
      previewNote: function (midi) {
        ensure();
        voice(midi, ctx.currentTime + 0.02, 0.5, 0.9, readForm().instrument);
      },
    };
    return api;
  })();

  // ---------- Eventos ----------
  var regenTimer = null;
  form.addEventListener('input', function (e) {
    updateOutputs();
    var name = e.target.name;
    if (name === 'style') return; // lo trata 'change'
    if (GEN_KEYS.indexOf(name) >= 0) {
      clearTimeout(regenTimer);
      regenTimer = setTimeout(regenerate, 160);
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
    var ui = Object.assign({}, UI_DEFAULTS, load('.ui', {}));
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
