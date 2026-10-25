/* Metrónomo (programación precisa con Web Audio) y afinador cromático (autocorrelación). */
(function () {
  'use strict';
  var ctx = null;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- Metrónomo ----------
  var m = document.querySelector('[data-metronome]');
  if (m) {
    var bpmInput = m.querySelector('[data-bpm]');
    var bpmOut = m.querySelector('[data-bpm-out]');
    var toggleBtn = m.querySelector('[data-toggle]');
    var meterSel = m.querySelector('[data-meter]');
    var subSel = m.querySelector('[data-sub]');
    var beatsEl = m.querySelector('[data-beats]');
    var running = false;
    var nextTime = 0;
    var tickIndex = 0;
    var timer = null;
    var taps = [];

    function setBpm(v) {
      v = Math.max(30, Math.min(260, Math.round(v)));
      bpmInput.value = v;
      bpmOut.textContent = v;
    }

    function drawBeats() {
      var n = Number(meterSel.value);
      beatsEl.innerHTML = '';
      for (var i = 0; i < n; i++) {
        var s = document.createElement('span');
        if (i === 0 && n > 1) s.className = 'first';
        beatsEl.appendChild(s);
      }
    }

    function click(time, level) {
      var c = audioCtx();
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.frequency.value = level === 2 ? 1760 : level === 1 ? 1175 : 880;
      var peak = level === 0 ? 0.25 : 0.7;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(peak, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(time);
      osc.stop(time + 0.08);
    }

    function schedule() {
      var c = audioCtx();
      var sub = Number(subSel.value);
      var beats = Number(meterSel.value);
      var interval = 60 / Number(bpmInput.value) / sub;
      while (nextTime < c.currentTime + 0.12) {
        var beat = Math.floor(tickIndex / sub) % beats;
        var isBeat = tickIndex % sub === 0;
        var level = isBeat ? (beat === 0 && beats > 1 ? 2 : 1) : 0;
        click(nextTime, level);
        if (isBeat) {
          (function (b, delay) {
            setTimeout(function () {
              var dots = beatsEl.children;
              for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === b);
            }, Math.max(0, delay * 1000));
          })(beat, nextTime - c.currentTime);
        }
        nextTime += interval;
        tickIndex++;
      }
    }

    function start() {
      var c = audioCtx();
      running = true;
      tickIndex = 0;
      nextTime = c.currentTime + 0.06;
      schedule();
      timer = setInterval(schedule, 25);
      toggleBtn.textContent = 'Parar';
      toggleBtn.setAttribute('aria-label', 'Parar metrónomo');
    }
    function stop() {
      running = false;
      clearInterval(timer);
      toggleBtn.textContent = 'Iniciar';
      toggleBtn.setAttribute('aria-label', 'Iniciar metrónomo');
      Array.prototype.forEach.call(beatsEl.children, function (d) { d.classList.remove('on'); });
    }

    toggleBtn.addEventListener('click', function () { running ? stop() : start(); });
    bpmInput.addEventListener('input', function () { setBpm(Number(bpmInput.value)); });
    m.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () { setBpm(Number(bpmInput.value) + Number(b.dataset.step)); });
    });
    meterSel.addEventListener('change', function () { drawBeats(); tickIndex = 0; });
    m.querySelector('[data-tap]').addEventListener('click', function () {
      var now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 5) taps.shift();
      if (taps.length >= 2) {
        var sum = 0;
        for (var i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
        setBpm(60000 / (sum / (taps.length - 1)));
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.closest('input, select, textarea, button')) return;
      if (e.key === ' ') { e.preventDefault(); running ? stop() : start(); }
    });
    drawBeats();
  }

  // ---------- Afinador ----------
  var t = document.querySelector('[data-tuner]');
  if (t) {
    var noteOut = t.querySelector('[data-note]');
    var freqOut = t.querySelector('[data-freq]');
    var centsOut = t.querySelector('[data-cents]');
    var needle = t.querySelector('[data-needle]');
    var display = t.querySelector('.tuner-display');
    var listenBtn = t.querySelector('[data-listen]');
    var a4Input = t.querySelector('[data-a4]');
    var latin = t.querySelector('[data-latin]');
    var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var LATIN = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
    var stream = null;
    var analyser = null;
    var buf = null;
    var raf = null;
    var smooth = null;

    function a4() {
      var v = Number(a4Input.value);
      return v >= 415 && v <= 466 ? v : 440;
    }

    // Autocorrelación con interpolación parabólica.
    function detect(data, rate) {
      var size = data.length;
      var rms = 0;
      for (var i = 0; i < size; i++) rms += data[i] * data[i];
      rms = Math.sqrt(rms / size);
      if (rms < 0.01) return -1;
      var r1 = 0;
      var r2 = size - 1;
      var thres = 0.2;
      for (var a = 0; a < size / 2; a++) if (Math.abs(data[a]) < thres) { r1 = a; break; }
      for (var b = 1; b < size / 2; b++) if (Math.abs(data[size - b]) < thres) { r2 = size - b; break; }
      var d = data.slice(r1, r2);
      var n = d.length;
      var c = new Float32Array(n);
      for (var lag = 0; lag < n; lag++) {
        var s = 0;
        for (var k = 0; k < n - lag; k++) s += d[k] * d[k + lag];
        c[lag] = s;
      }
      var j = 0;
      while (j < n - 1 && c[j] > c[j + 1]) j++;
      var maxv = -1;
      var maxpos = -1;
      for (var x = j; x < n; x++) if (c[x] > maxv) { maxv = c[x]; maxpos = x; }
      if (maxpos <= 0) return -1;
      var x1 = c[maxpos - 1] || c[maxpos];
      var x2 = c[maxpos];
      var x3 = c[maxpos + 1] || c[maxpos];
      var aa = (x1 + x3 - 2 * x2) / 2;
      var bb = (x3 - x1) / 2;
      var T0 = aa ? maxpos - bb / (2 * aa) : maxpos;
      return rate / T0;
    }

    function loop() {
      analyser.getFloatTimeDomainData(buf);
      var f = detect(buf, ctx.sampleRate);
      if (f > 25 && f < 4200) {
        smooth = smooth ? smooth * 0.7 + f * 0.3 : f;
        var midi = 69 + 12 * Math.log2(smooth / a4());
        var nearest = Math.round(midi);
        var cents = Math.round((midi - nearest) * 100);
        var names = latin.checked ? LATIN : NAMES;
        noteOut.textContent = names[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1);
        freqOut.textContent = smooth.toFixed(1) + ' Hz';
        centsOut.textContent = (cents > 0 ? '+' : '') + cents + ' cents' + (Math.abs(cents) <= 5 ? ' · afinado' : cents < 0 ? ' · sube' : ' · baja');
        needle.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
        display.classList.toggle('in-tune', Math.abs(cents) <= 5);
      }
      raf = requestAnimationFrame(loop);
    }

    async function listen() {
      if (stream) {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        stream = null;
        cancelAnimationFrame(raf);
        listenBtn.textContent = 'Escuchar';
        freqOut.textContent = 'Pulsa «Escuchar»';
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        freqOut.textContent = 'Este navegador no permite usar el micrófono.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        freqOut.textContent = 'Sin permiso para el micrófono. Actívalo en los ajustes del navegador.';
        return;
      }
      var c = audioCtx();
      var src = c.createMediaStreamSource(stream);
      analyser = c.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      src.connect(analyser);
      listenBtn.textContent = 'Dejar de escuchar';
      freqOut.textContent = 'Toca una nota…';
      loop();
    }

    listenBtn.addEventListener('click', listen);
    t.querySelector('[data-ref-play]').addEventListener('click', function () {
      var midi = Number(t.querySelector('[data-ref]').value);
      if (!midi) return;
      var c = audioCtx();
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = a4() * Math.pow(2, (midi - 69) / 12);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 0.03);
      g.gain.setValueAtTime(0.35, c.currentTime + 1.8);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.2);
      osc.connect(g);
      g.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 2.3);
    });
  }
})();
