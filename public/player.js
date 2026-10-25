/* Reproductor de práctica: forma de onda, bucle A-B, velocidad sin cambiar el tono,
 * tono sin cambiar la velocidad, marcadores compartidos y cuenta de entrada. */
(function () {
  'use strict';
  var root = document.querySelector('[data-player]');
  if (!root) return;
  var E = window.Ensaya;
  var audio = root.querySelector('[data-audio]');
  var canvas = root.querySelector('[data-wave]');
  var waveStatus = root.querySelector('[data-wave-status]');
  var timeOut = root.querySelector('[data-time]');
  var durOut = root.querySelector('[data-duration]');
  var loopInfo = root.querySelector('[data-loop-info]');
  var playBtn = root.querySelector('[data-act="play"]');
  var loopBtn = root.querySelector('[data-act="loop"]');
  var speed = root.querySelector('[data-speed]');
  var pitch = root.querySelector('[data-pitch]');
  var volume = root.querySelector('[data-volume]');
  var countIn = root.querySelector('[data-countin]');
  var markerList = root.querySelector('[data-marker-list]');
  var markerForm = root.querySelector('[data-marker-form]');
  var markersUrl = root.dataset.markers;
  var bpm = Number(root.dataset.bpm) || 0;

  var PLAY_ICON = playBtn.innerHTML;
  var PAUSE_ICON = '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';

  var state = { a: null, b: null, loop: false, markers: [], peaks: null, semis: 0, counting: false };
  var ctx = null;
  var source = null;
  var shifter = null;
  var gain = null;

  // ---------- Audio ----------
  async function ensureGraph() {
    if (ctx) {
      if (ctx.state === 'suspended') await ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    source = ctx.createMediaElementSource(audio);
    gain = ctx.createGain();
    gain.gain.value = Number(volume.value) / 100;
    gain.connect(ctx.destination);
    try {
      await ctx.audioWorklet.addModule('/pitch-worklet.js');
      shifter = new AudioWorkletNode(ctx, 'pitch-shifter', { outputChannelCount: [2] });
    } catch (e) {
      shifter = null;
      pitch.disabled = true;
      root.querySelector('[data-pitch-label]').textContent = 'no disponible en este navegador';
    }
    connect();
  }

  function connect() {
    if (!source) return;
    source.disconnect();
    if (shifter) shifter.disconnect();
    if (shifter && state.semis !== 0) {
      shifter.parameters.get('ratio').value = Math.pow(2, state.semis / 12);
      source.connect(shifter);
      shifter.connect(gain);
    } else {
      source.connect(gain);
    }
  }

  function setPreservePitch() {
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
  }

  function click(time, accent) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.6, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  async function play() {
    await ensureGraph();
    setPreservePitch();
    if (countIn.checked && bpm && ctx && !state.counting) {
      state.counting = true;
      var beat = 60 / (bpm * audio.playbackRate);
      var t0 = ctx.currentTime + 0.1;
      for (var i = 0; i < 4; i++) click(t0 + i * beat, i === 0);
      playBtn.innerHTML = PAUSE_ICON;
      setTimeout(function () {
        state.counting = false;
        audio.play().catch(function () {});
      }, (0.1 + 4 * beat) * 1000);
      return;
    }
    await audio.play().catch(function (e) { E.toast('No se pudo reproducir: ' + e.message); });
  }

  function toggle() {
    if (state.counting) return;
    if (audio.paused) play();
    else audio.pause();
  }

  audio.addEventListener('play', function () { playBtn.innerHTML = PAUSE_ICON; playBtn.setAttribute('aria-label', 'Pausar'); });
  audio.addEventListener('pause', function () { playBtn.innerHTML = PLAY_ICON; playBtn.setAttribute('aria-label', 'Reproducir'); });
  function onMeta() {
    if (isFinite(audio.duration)) durOut.textContent = E.fmtTime(audio.duration);
    draw();
  }
  audio.addEventListener('loadedmetadata', onMeta);
  audio.addEventListener('durationchange', onMeta);
  if (audio.readyState >= 1) setTimeout(onMeta, 0);
  audio.addEventListener('error', function () { waveStatus.textContent = 'No se pudo cargar el audio.'; });

  function seek(t) {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.05, t));
    draw();
  }

  // ---------- Bucle ----------
  function updateLoop() {
    if (state.a !== null && state.b !== null && state.b < state.a) {
      var t = state.a; state.a = state.b; state.b = t;
    }
    loopBtn.setAttribute('aria-pressed', state.loop ? 'true' : 'false');
    var parts = [];
    if (state.a !== null) parts.push('A ' + E.fmtTime(state.a));
    if (state.b !== null) parts.push('B ' + E.fmtTime(state.b));
    loopInfo.textContent = parts.length ? 'Bucle ' + parts.join(' → ') + (state.loop ? ' · activo' : '') : '';
    draw();
  }

  function tick() {
    if (state.loop && state.a !== null && state.b !== null && !audio.paused && audio.currentTime >= state.b) {
      audio.currentTime = state.a;
    }
    timeOut.textContent = E.fmtTime(audio.currentTime);
    if (!audio.paused) draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- Forma de onda ----------
  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(160 * dpr);
    draw();
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function draw() {
    var c = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var dpr = window.devicePixelRatio || 1;
    c.clearRect(0, 0, w, h);
    var dur = audio.duration;
    var known = isFinite(dur) && dur > 0;
    var x = function (t) { return known ? (t / dur) * w : 0; };
    var played = known ? x(audio.currentTime) : 0;
    if (state.a !== null && known) {
      var b = state.b !== null ? state.b : audio.currentTime;
      c.fillStyle = state.loop ? 'rgba(47,79,216,0.22)' : 'rgba(47,79,216,0.10)';
      c.fillRect(x(Math.min(state.a, b)), 0, Math.abs(x(b) - x(state.a)), h);
    }
    var mid = h / 2;
    var ink = cssVar('--ink-soft', '#586379');
    var brass = cssVar('--brass', '#b97f0d');
    if (state.peaks) {
      var n = state.peaks.length;
      var bar = Math.max(1, Math.floor(2 * dpr));
      for (var px = 0; px < w; px += bar + Math.max(1, Math.floor(dpr))) {
        var i = Math.floor((px / w) * n);
        var amp = state.peaks[i] * (h * 0.46);
        c.fillStyle = px < played ? brass : ink;
        c.globalAlpha = px < played ? 1 : 0.55;
        c.fillRect(px, mid - amp, bar, Math.max(1, amp * 2));
      }
      c.globalAlpha = 1;
    } else {
      c.fillStyle = cssVar('--staff', '#cfd6e2');
      c.fillRect(0, mid - 2 * dpr, w, 4 * dpr);
      c.fillStyle = brass;
      c.fillRect(0, mid - 2 * dpr, played, 4 * dpr);
    }
    if (known) {
      c.font = (11 * dpr) + 'px sans-serif';
      state.markers.forEach(function (m) {
        var mx = x(m.position_ms / 1000);
        c.fillStyle = cssVar('--cobalt', '#2f4fd8');
        c.fillRect(mx, 0, Math.max(1, dpr), h);
        c.fillText(m.label, mx + 4 * dpr, 13 * dpr);
      });
      c.fillStyle = cssVar('--ink', '#172033');
      c.fillRect(played - dpr, 0, 2 * dpr, h);
    }
  }

  async function loadPeaks() {
    try {
      var res = await fetch(audio.currentSrc || audio.src, { credentials: 'same-origin' });
      var len = Number(res.headers.get('content-length')) || 0;
      if (len > 160 * 1024 * 1024) {
        res.body && res.body.cancel && res.body.cancel();
        waveStatus.textContent = '';
        return;
      }
      var buf = await res.arrayBuffer();
      var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var tmp = new AC(1, 44100, 44100);
      var decoded = await new Promise(function (resolve, reject) {
        var p = tmp.decodeAudioData(buf, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      var data = decoded.getChannelData(0);
      var data2 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
      var buckets = 1600;
      var size = Math.floor(data.length / buckets) || 1;
      var peaks = new Float32Array(buckets);
      var max = 0;
      for (var i = 0; i < buckets; i++) {
        var peak = 0;
        var start = i * size;
        for (var j = start; j < start + size && j < data.length; j += 8) {
          var v = Math.abs(data[j]);
          if (data2) v = Math.max(v, Math.abs(data2[j]));
          if (v > peak) peak = v;
        }
        peaks[i] = peak;
        if (peak > max) max = peak;
      }
      if (max > 0) for (var k = 0; k < buckets; k++) peaks[k] = peaks[k] / max;
      state.peaks = peaks;
      waveStatus.textContent = '';
      draw();
    } catch (e) {
      waveStatus.textContent = '';
    }
  }

  // Pulsar salta; arrastrar marca el bucle.
  var drag = null;
  function timeAt(ev) {
    var r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (audio.duration || 0);
  }
  canvas.addEventListener('pointerdown', function (ev) {
    if (!isFinite(audio.duration)) return;
    canvas.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, t: timeAt(ev), moved: false };
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    if (Math.abs(ev.clientX - drag.x) > 6) {
      drag.moved = true;
      state.a = drag.t;
      state.b = timeAt(ev);
      draw();
    }
  });
  canvas.addEventListener('pointerup', function (ev) {
    if (!drag) return;
    if (drag.moved) {
      state.b = timeAt(ev);
      state.loop = true;
      updateLoop();
      seek(Math.min(state.a, state.b));
    } else {
      seek(drag.t);
    }
    drag = null;
  });

  // ---------- Controles ----------
  root.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'play') toggle();
    if (act === 'back') seek(audio.currentTime - 5);
    if (act === 'fwd') seek(audio.currentTime + 5);
    if (act === 'setA') { state.a = audio.currentTime; if (state.b !== null && state.b <= state.a) state.b = null; updateLoop(); }
    if (act === 'setB') { state.b = audio.currentTime; if (state.a === null) state.a = 0; state.loop = true; updateLoop(); }
    if (act === 'loop') { if (state.a === null) { E.toast('Marca primero el inicio (A) y el fin (B), o arrastra sobre la onda.'); return; } state.loop = !state.loop; updateLoop(); }
    if (act === 'clearLoop') { state.a = null; state.b = null; state.loop = false; updateLoop(); }
  });

  speed.addEventListener('input', function () {
    setPreservePitch();
    audio.playbackRate = Number(speed.value) / 100;
    root.querySelector('[data-speed-label]').textContent = speed.value + ' %';
  });
  pitch.addEventListener('input', async function () {
    state.semis = Number(pitch.value);
    var s = state.semis;
    root.querySelector('[data-pitch-label]').textContent = (s > 0 ? '+' : '') + s + (Math.abs(s) === 1 ? ' semitono' : ' semitonos');
    await ensureGraph();
    connect();
  });
  volume.addEventListener('input', function () {
    if (gain) gain.gain.value = Number(volume.value) / 100;
    else audio.volume = Number(volume.value) / 100;
  });

  // ---------- Marcadores ----------
  function renderMarkers() {
    markerList.innerHTML = '';
    if (!state.markers.length) {
      var li = document.createElement('li');
      li.className = 'muted small';
      li.style.border = '0';
      li.textContent = 'Sin marcadores. Escribe un nombre y pulsa «Marcar aquí» mientras suena.';
      markerList.appendChild(li);
    }
    state.markers.forEach(function (m) {
      var li = document.createElement('li');
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      go.title = 'Ir a ' + m.label + (m.author ? ' (de ' + m.author + ')' : '');
      var t = document.createElement('time');
      t.textContent = E.fmtTime(m.position_ms / 1000);
      go.appendChild(t);
      go.appendChild(document.createTextNode(m.label));
      go.addEventListener('click', function () { seek(m.position_ms / 1000); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.setAttribute('aria-label', 'Borrar marcador ' + m.label);
      del.textContent = '×';
      del.addEventListener('click', async function () {
        try {
          await E.api('DELETE', markersUrl + '/' + m.id);
          state.markers = state.markers.filter(function (x) { return x.id !== m.id; });
          renderMarkers();
          draw();
        } catch (e) { E.toast(e.message); }
      });
      li.appendChild(go);
      li.appendChild(del);
      markerList.appendChild(li);
    });
  }

  async function loadMarkers() {
    try {
      var data = await E.api('GET', markersUrl);
      state.markers = data.markers;
      renderMarkers();
      draw();
    } catch (e) { /* sin conexión: seguimos sin marcadores */ }
  }

  markerForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var input = markerForm.querySelector('input');
    try {
      var data = await E.api('POST', markersUrl, { position_ms: Math.round(audio.currentTime * 1000), label: input.value.trim() });
      state.markers.push(data.marker);
      state.markers.sort(function (a, b) { return a.position_ms - b.position_ms; });
      input.value = '';
      renderMarkers();
      draw();
    } catch (e) { E.toast(e.message); }
  });

  // ---------- Teclado ----------
  document.addEventListener('keydown', function (ev) {
    if (ev.target.closest('input, textarea, select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === ' ' || ev.code === 'Space') {
      if (ev.target.closest('button, a')) return;
      ev.preventDefault();
      toggle();
    }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seek(audio.currentTime - 5); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); seek(audio.currentTime + 5); }
    else if (ev.key === '[') { root.querySelector('[data-act="setA"]').click(); }
    else if (ev.key === ']') { root.querySelector('[data-act="setB"]').click(); }
    else if (ev.key === 'l' || ev.key === 'L') { loopBtn.click(); }
  });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: document.querySelector('h1').textContent, artist: 'Ensaya' });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('seekbackward', function () { seek(audio.currentTime - 5); });
      navigator.mediaSession.setActionHandler('seekforward', function () { seek(audio.currentTime + 5); });
    } catch (e) { /* opcional */ }
  }

  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();
  loadMarkers();
  loadPeaks();

  // Letra con transposición, si la hay.
  document.querySelectorAll('[data-chordpro]').forEach(function (panel) {
    panel.querySelector('[data-render]').innerHTML = window.ChordPro.render(panel.querySelector('[data-source]').value, 0, { key: panel.dataset.key });
  });
})();
