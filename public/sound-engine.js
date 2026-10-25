/* Motor de sonido de Ensaya: muestras grabadas de instrumentos reales + cadena de efectos.
 * Las muestras (bancos MusyngKite y FluidR3 GM, licencias Creative Commons) se descargan
 * nota a nota desde GitHub Pages directamente al navegador: no pasan por el servidor de la app.
 * Si no hay conexión, cada nota que falte suena con un sintetizador sencillo. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoundEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAMPLE_BASE = 'https://paulrosen.github.io/midi-js-soundfonts/';
  var BANKS = { alta: 'MusyngKite', ligera: 'FluidR3_GM' };
  var NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Efectos por defecto (0-100 salvo los indicados).
  var FX_DEFAULT = {
    drive: 0, bass: 0, mid: 0, treble: 0, // EQ en dB (-12…12)
    comp: 20, chorus: 0, delayMix: 0, delayTime: '1/8d', delayFeedback: 35,
    reverbType: 'sala', reverbMix: 20, vibrato: 0, sustain: 50, pan: 0, humanize: 20,
  };

  var FX_PRESETS = {
    limpio: { name: 'Limpio', fx: { drive: 0, comp: 25, chorus: 0, delayMix: 0, reverbType: 'sala', reverbMix: 18, vibrato: 0, sustain: 50 } },
    crunch: { name: 'Crunch (blues)', fx: { drive: 35, bass: 2, mid: 3, treble: 1, comp: 30, chorus: 0, delayMix: 10, delayTime: '1/8', delayFeedback: 25, reverbType: 'habitacion', reverbMix: 22, vibrato: 25, sustain: 55 } },
    lead_rock: { name: 'Solo de rock', fx: { drive: 55, bass: 1, mid: 4, treble: 2, comp: 45, chorus: 0, delayMix: 22, delayTime: '1/8d', delayFeedback: 35, reverbType: 'sala', reverbMix: 25, vibrato: 35, sustain: 70 } },
    metal: { name: 'Metal', fx: { drive: 80, bass: 4, mid: -3, treble: 3, comp: 60, chorus: 0, delayMix: 12, delayTime: '1/16', delayFeedback: 20, reverbType: 'sala', reverbMix: 15, vibrato: 20, sustain: 70 } },
    jazz: { name: 'Jazz cálido', fx: { drive: 0, bass: 3, mid: 1, treble: -5, comp: 25, chorus: 0, delayMix: 0, reverbType: 'habitacion', reverbMix: 20, vibrato: 0, sustain: 45 } },
    funk: { name: 'Funk', fx: { drive: 0, bass: -2, mid: 2, treble: 4, comp: 70, chorus: 25, delayMix: 0, reverbType: 'habitacion', reverbMix: 10, vibrato: 0, sustain: 30 } },
    flamenco: { name: 'Flamenco seco', fx: { drive: 0, bass: 1, mid: 2, treble: 2, comp: 30, chorus: 0, delayMix: 0, reverbType: 'habitacion', reverbMix: 14, vibrato: 0, sustain: 45 } },
    ambiente: { name: 'Ambiente (balada)', fx: { drive: 0, bass: 0, mid: 0, treble: 0, comp: 25, chorus: 30, delayMix: 25, delayTime: '1/4', delayFeedback: 45, reverbType: 'catedral', reverbMix: 40, vibrato: 15, sustain: 80 } },
    piano_sala: { name: 'Piano en sala', fx: { drive: 0, bass: 0, mid: 0, treble: 0, comp: 15, chorus: 0, delayMix: 0, reverbType: 'sala', reverbMix: 28, vibrato: 0, sustain: 75 } },
    rhodes: { name: 'Rhodes con chorus', fx: { drive: 10, bass: 1, mid: 0, treble: -2, comp: 30, chorus: 40, delayMix: 10, delayTime: '1/4', delayFeedback: 30, reverbType: 'placa', reverbMix: 25, vibrato: 0, sustain: 60 } },
    vientos: { name: 'Vientos', fx: { drive: 0, bass: 0, mid: 2, treble: 0, comp: 30, chorus: 0, delayMix: 8, delayTime: '1/4', delayFeedback: 25, reverbType: 'placa', reverbMix: 25, vibrato: 30, sustain: 60 } },
  };

  // Catálogo de instrumentos del solo. "sample" es el nombre en el banco General MIDI.
  var INSTRUMENTS = {
    gtr_rock: { name: 'Guitarra eléctrica rock (saturada)', group: 'Guitarras', sample: 'overdriven_guitar', preset: 'lead_rock', style: 'rock', range: [40, 88] },
    gtr_blues: { name: 'Guitarra blues (crunch)', group: 'Guitarras', sample: 'electric_guitar_clean', preset: 'crunch', style: 'blues', range: [40, 88] },
    gtr_jazz: { name: 'Guitarra jazz (caja hueca)', group: 'Guitarras', sample: 'electric_guitar_jazz', preset: 'jazz', style: 'jazz', range: [40, 86] },
    gtr_funk: { name: 'Guitarra funk (limpia)', group: 'Guitarras', sample: 'electric_guitar_clean', preset: 'funk', style: 'funk', range: [40, 88] },
    gtr_muted: { name: 'Guitarra apagada (palm mute)', group: 'Guitarras', sample: 'electric_guitar_muted', preset: 'funk', range: [40, 84] },
    gtr_flamenco: { name: 'Guitarra española (flamenco)', group: 'Guitarras', sample: 'acoustic_guitar_nylon', preset: 'flamenco', style: 'flamenco', range: [40, 84] },
    gtr_metal: { name: 'Guitarra metal (distorsionada)', group: 'Guitarras', sample: 'distortion_guitar', preset: 'metal', style: 'metal', range: [40, 90] },
    gtr_acoustic: { name: 'Guitarra acústica (cuerdas de acero)', group: 'Guitarras', sample: 'acoustic_guitar_steel', preset: 'ambiente', style: 'balada', range: [40, 84] },
    gtr_pop: { name: 'Guitarra eléctrica pop (limpia con chorus)', group: 'Guitarras', sample: 'electric_guitar_clean', preset: 'limpio', style: 'pop', range: [40, 88], fx: { chorus: 30, delayMix: 12 } },
    pno_grand: { name: 'Piano de cola', group: 'Pianos y teclados', sample: 'acoustic_grand_piano', preset: 'piano_sala', range: [21, 108] },
    pno_bright: { name: 'Piano brillante (pop y rock)', group: 'Pianos y teclados', sample: 'bright_acoustic_piano', preset: 'piano_sala', range: [21, 108] },
    pno_egrand: { name: 'Piano eléctrico de cola (CP-70)', group: 'Pianos y teclados', sample: 'electric_grand_piano', preset: 'piano_sala', range: [21, 108] },
    pno_honky: { name: 'Piano honky-tonk (blues)', group: 'Pianos y teclados', sample: 'honkytonk_piano', preset: 'piano_sala', range: [21, 108] },
    pno_rhodes: { name: 'Rhodes (piano eléctrico)', group: 'Pianos y teclados', sample: 'electric_piano_1', preset: 'rhodes', range: [28, 103] },
    pno_fm: { name: 'Piano FM (DX7)', group: 'Pianos y teclados', sample: 'electric_piano_2', preset: 'rhodes', range: [28, 103] },
    pno_clav: { name: 'Clavinet (funk)', group: 'Pianos y teclados', sample: 'clavinet', preset: 'funk', range: [29, 96] },
    pno_harpsi: { name: 'Clave barroco', group: 'Pianos y teclados', sample: 'harpsichord', preset: 'piano_sala', range: [29, 96] },
    org_hammond: { name: 'Órgano Hammond', group: 'Pianos y teclados', sample: 'drawbar_organ', preset: 'rhodes', range: [36, 96] },
    org_rock: { name: 'Órgano rock', group: 'Pianos y teclados', sample: 'rock_organ', preset: 'crunch', range: [36, 96] },
    sax_alto: { name: 'Saxo alto', group: 'Vientos y otros', sample: 'alto_sax', preset: 'vientos', range: [49, 81] },
    sax_tenor: { name: 'Saxo tenor', group: 'Vientos y otros', sample: 'tenor_sax', preset: 'vientos', range: [44, 76] },
    trumpet: { name: 'Trompeta', group: 'Vientos y otros', sample: 'trumpet', preset: 'vientos', range: [52, 84] },
    trumpet_mute: { name: 'Trompeta con sordina (jazz)', group: 'Vientos y otros', sample: 'muted_trumpet', preset: 'jazz', range: [52, 84] },
    violin: { name: 'Violín', group: 'Vientos y otros', sample: 'violin', preset: 'vientos', range: [55, 96] },
    synth_lead: { name: 'Sintetizador lead', group: 'Vientos y otros', sample: 'lead_2_sawtooth', preset: 'lead_rock', range: [36, 96], fx: { drive: 0 } },
    synth_offline: { name: 'Sonido sintetizado (sin descargas)', group: 'Vientos y otros', sample: null, preset: 'limpio', range: [0, 127] },
  };

  var CHORD_INSTRUMENTS = {
    pno_grand: { name: 'Piano de cola', sample: 'acoustic_grand_piano' },
    pno_bright: { name: 'Piano brillante', sample: 'bright_acoustic_piano' },
    pno_rhodes: { name: 'Rhodes', sample: 'electric_piano_1' },
    org_hammond: { name: 'Órgano Hammond', sample: 'drawbar_organ' },
    gtr_acoustic: { name: 'Guitarra acústica', sample: 'acoustic_guitar_steel' },
    gtr_nylon: { name: 'Guitarra española', sample: 'acoustic_guitar_nylon' },
    gtr_clean: { name: 'Guitarra eléctrica limpia', sample: 'electric_guitar_clean' },
    pad: { name: 'Colchón de sintetizador', sample: 'pad_2_warm' },
    synth: { name: 'Sintetizado (sin descargas)', sample: null },
  };

  var BASS_INSTRUMENTS = {
    bass_finger: { name: 'Bajo eléctrico (dedos)', sample: 'electric_bass_finger' },
    bass_pick: { name: 'Bajo eléctrico (púa)', sample: 'electric_bass_pick' },
    bass_upright: { name: 'Contrabajo (jazz)', sample: 'acoustic_bass' },
    bass_fretless: { name: 'Bajo sin trastes', sample: 'fretless_bass' },
    bass_synth: { name: 'Bajo de sintetizador', sample: 'synth_bass_1' },
    synth: { name: 'Sintetizado (sin descargas)', sample: null },
  };

  // Instrumentos por defecto para cada estilo del generador.
  var STYLE_SOUND = {
    rock: { instrument: 'gtr_rock', chords: 'pno_bright', bass: 'bass_pick' },
    blues: { instrument: 'gtr_blues', chords: 'org_hammond', bass: 'bass_finger' },
    jazz: { instrument: 'gtr_jazz', chords: 'pno_rhodes', bass: 'bass_upright' },
    funk: { instrument: 'gtr_funk', chords: 'pno_rhodes', bass: 'bass_finger' },
    flamenco: { instrument: 'gtr_flamenco', chords: 'gtr_nylon', bass: 'bass_upright' },
    metal: { instrument: 'gtr_metal', chords: 'gtr_clean', bass: 'bass_pick' },
    balada: { instrument: 'gtr_acoustic', chords: 'pno_grand', bass: 'bass_fretless' },
    pop: { instrument: 'gtr_pop', chords: 'pno_bright', bass: 'bass_finger' },
  };

  var REVERBS = {
    habitacion: { name: 'Habitación', seconds: 0.6, decay: 3.2, pre: 0.005, bright: 0.75 },
    sala: { name: 'Sala de conciertos', seconds: 1.8, decay: 2.6, pre: 0.02, bright: 0.55 },
    placa: { name: 'Placa', seconds: 1.4, decay: 2.2, pre: 0.0, bright: 0.9 },
    catedral: { name: 'Catedral', seconds: 4.2, decay: 2.0, pre: 0.04, bright: 0.45 },
  };

  var DELAY_TIMES = { '1/4': 1, '1/8': 0.5, '1/8d': 0.75, '1/16': 0.25, '1/4t': 2 / 3 };

  function noteFile(midi) {
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function presetFx(instrumentId) {
    var inst = INSTRUMENTS[instrumentId] || INSTRUMENTS.gtr_rock;
    var p = FX_PRESETS[inst.preset] || FX_PRESETS.limpio;
    var fx = {};
    Object.keys(FX_DEFAULT).forEach(function (k) { fx[k] = FX_DEFAULT[k]; });
    Object.keys(p.fx).forEach(function (k) { fx[k] = p.fx[k]; });
    if (inst.fx) Object.keys(inst.fx).forEach(function (k) { fx[k] = inst.fx[k]; });
    return fx;
  }

  // ---------- Motor (solo en el navegador) ----------
  function create(ctx, opts) {
    opts = opts || {};
    var cache = {}; // url → AudioBuffer | Promise | null (fallo)
    var bank = BANKS[opts.quality] || BANKS.alta;

    // Salida general y reverb compartida.
    var master = ctx.createGain();
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    var reverb = ctx.createConvolver();
    var reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 1;
    reverb.connect(reverbReturn);
    reverbReturn.connect(master);
    var currentReverb = null;

    function impulse(type) {
      var r = REVERBS[type] || REVERBS.sala;
      var rate = ctx.sampleRate;
      var len = Math.floor(rate * (r.seconds + r.pre));
      var buf = ctx.createBuffer(2, len, rate);
      var preN = Math.floor(rate * r.pre);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        var lp = 0;
        for (var i = preN; i < len; i++) {
          var t = (i - preN) / (len - preN);
          var white = Math.random() * 2 - 1;
          // Filtro paso bajo simple: las salas grandes suenan más oscuras.
          lp = lp + (white - lp) * r.bright;
          d[i] = lp * Math.pow(1 - t, r.decay);
        }
      }
      return buf;
    }

    function setReverbType(type) {
      if (type === currentReverb) return;
      currentReverb = type;
      reverb.buffer = impulse(type);
    }
    setReverbType('sala');

    function driveCurve(amount) {
      var k = amount * 1.2;
      var n = 2048;
      var curve = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var x = (i * 2) / n - 1;
        curve[i] = k > 0 ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x;
      }
      return curve;
    }

    // Cadena de efectos del solo:
    // entrada → EQ → saturación → compresor → chorus → salida seca + envíos a delay y reverb → panorama.
    function buildChain() {
      var c = {};
      c.input = ctx.createGain();
      c.low = ctx.createBiquadFilter();
      c.low.type = 'lowshelf';
      c.low.frequency.value = 220;
      c.midEq = ctx.createBiquadFilter();
      c.midEq.type = 'peaking';
      c.midEq.frequency.value = 1100;
      c.midEq.Q.value = 0.8;
      c.high = ctx.createBiquadFilter();
      c.high.type = 'highshelf';
      c.high.frequency.value = 3800;
      c.preDrive = ctx.createGain();
      c.shaper = ctx.createWaveShaper();
      c.shaper.oversample = '4x';
      c.postDrive = ctx.createGain();
      c.cabinet = ctx.createBiquadFilter();
      c.cabinet.type = 'lowpass';
      c.cabinet.frequency.value = 18000;
      c.comp = ctx.createDynamicsCompressor();
      c.comp.attack.value = 0.005;
      c.comp.release.value = 0.15;
      // Chorus: dos líneas de retardo moduladas.
      c.chorusIn = ctx.createGain();
      c.chorusDry = ctx.createGain();
      c.chorusWet = ctx.createGain();
      c.chorusOut = ctx.createGain();
      c.chorusDelays = [0.012, 0.019].map(function (base, i) {
        var d = ctx.createDelay(0.05);
        d.delayTime.value = base;
        var lfo = ctx.createOscillator();
        lfo.frequency.value = i ? 0.9 : 0.6;
        var depth = ctx.createGain();
        depth.gain.value = 0.0025;
        lfo.connect(depth);
        depth.connect(d.delayTime);
        lfo.start();
        c.chorusIn.connect(d);
        d.connect(c.chorusWet);
        return d;
      });
      c.chorusIn.connect(c.chorusDry);
      c.chorusDry.connect(c.chorusOut);
      c.chorusWet.connect(c.chorusOut);
      // Delay con realimentación y tono algo oscuro.
      c.delaySend = ctx.createGain();
      c.delay = ctx.createDelay(4);
      c.delayFb = ctx.createGain();
      c.delayTone = ctx.createBiquadFilter();
      c.delayTone.type = 'lowpass';
      c.delayTone.frequency.value = 3500;
      c.delaySend.connect(c.delay);
      c.delay.connect(c.delayTone);
      c.delayTone.connect(c.delayFb);
      c.delayFb.connect(c.delay);
      c.reverbSend = ctx.createGain();
      c.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      c.output = ctx.createGain();

      c.input.connect(c.low);
      c.low.connect(c.midEq);
      c.midEq.connect(c.high);
      c.high.connect(c.preDrive);
      c.preDrive.connect(c.shaper);
      c.shaper.connect(c.postDrive);
      c.postDrive.connect(c.cabinet);
      c.cabinet.connect(c.comp);
      c.comp.connect(c.chorusIn);
      c.chorusOut.connect(c.pan);
      c.chorusOut.connect(c.delaySend);
      c.delayTone.connect(c.pan);
      c.pan.connect(c.output);
      c.output.connect(master);
      c.pan.connect(c.reverbSend);
      c.reverbSend.connect(reverb);
      return c;
    }

    var chain = buildChain();
    var bandBus = ctx.createGain();
    var bandReverb = ctx.createGain();
    bandBus.connect(master);
    bandBus.connect(bandReverb);
    bandReverb.connect(reverb);
    var drumBus = ctx.createGain();
    drumBus.connect(master);

    var state = { fx: presetFx('gtr_rock'), tempo: 100 };

    function applyFx(fx, tempo) {
      state.fx = fx;
      if (tempo) state.tempo = tempo;
      var t = ctx.currentTime;
      var set = function (param, v) { param.setTargetAtTime(v, t, 0.02); };
      set(chain.low.gain, clampN(fx.bass, -12, 12));
      set(chain.midEq.gain, clampN(fx.mid, -12, 12));
      set(chain.high.gain, clampN(fx.treble, -12, 12));
      var drive = clampN(fx.drive, 0, 100) / 100;
      chain.shaper.curve = drive > 0 ? driveCurve(drive * 60) : null;
      set(chain.preDrive.gain, 1 + drive * 3);
      set(chain.postDrive.gain, 1 / (1 + drive * 2.2));
      set(chain.cabinet.frequency, drive > 0 ? 7500 - drive * 3000 : 18000);
      var comp = clampN(fx.comp, 0, 100) / 100;
      set(chain.comp.threshold, -comp * 32);
      set(chain.comp.ratio, 1 + comp * 9);
      var chorus = clampN(fx.chorus, 0, 100) / 100;
      set(chain.chorusWet.gain, chorus * 0.7);
      set(chain.chorusDry.gain, 1 - chorus * 0.3);
      var beat = 60 / state.tempo;
      set(chain.delay.delayTime, Math.min(3.9, beat * (DELAY_TIMES[fx.delayTime] || 0.75)));
      set(chain.delaySend.gain, clampN(fx.delayMix, 0, 100) / 100 * 0.6);
      set(chain.delayFb.gain, clampN(fx.delayFeedback, 0, 90) / 100);
      setReverbType(fx.reverbType);
      set(chain.reverbSend.gain, clampN(fx.reverbMix, 0, 100) / 100 * 0.9);
      set(bandReverb.gain, clampN(fx.reverbMix, 0, 100) / 100 * 0.5);
      if (chain.pan.pan) set(chain.pan.pan, clampN(fx.pan, -100, 100) / 100);
    }

    function clampN(v, a, b) {
      v = Number(v);
      if (!isFinite(v)) v = 0;
      return Math.max(a, Math.min(b, v));
    }

    function setLevels(levels) {
      var t = ctx.currentTime;
      chain.output.gain.setTargetAtTime(levels.solo, t, 0.02);
      bandBus.gain.setTargetAtTime(levels.band, t, 0.02);
      drumBus.gain.setTargetAtTime(levels.drums, t, 0.02);
    }

    // ---------- Muestras ----------
    function sampleUrl(sample, midi) {
      return SAMPLE_BASE + bank + '/' + sample + '-mp3/' + noteFile(midi) + '.mp3';
    }

    function loadSample(sample, midi) {
      var url = sampleUrl(sample, midi);
      if (inflight[url]) return inflight[url];
      if (cache[url] instanceof AudioBuffer) return Promise.resolve(cache[url]);
      var p = fetch(url, { mode: 'cors', credentials: 'omit' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (ab) {
          return new Promise(function (resolve, reject) {
            var pr = ctx.decodeAudioData(ab, resolve, reject);
            if (pr && pr.then) pr.then(resolve, reject);
          });
        })
        .then(function (buf) {
          cache[url] = buf;
          return buf;
        })
        .catch(function () {
          // Se vuelve a intentar pasado medio minuto (por si vuelve la conexión).
          cache[url] = { failedAt: Date.now() };
          return null;
        })
        .then(function (buf) {
          delete inflight[url];
          return buf;
        });
      inflight[url] = p;
      return p;
    }
    var inflight = {};

    function getLoaded(sample, midi) {
      var v = cache[sampleUrl(sample, midi)];
      return v instanceof AudioBuffer ? v : null;
    }

    // Descarga (con 6 en paralelo) las notas que falten. onProgress(hechas, total, fallidas)
    function preload(requests, onProgress) {
      var list = [];
      var seen = {};
      requests.forEach(function (r) {
        if (!r.sample) return;
        r.midis.forEach(function (m) {
          var url = sampleUrl(r.sample, m);
          var failed = cache[url] && cache[url].failedAt && Date.now() - cache[url].failedAt < 30000;
          if (seen[url] || cache[url] instanceof AudioBuffer || failed) return;
          seen[url] = true;
          list.push([r.sample, m, url]);
        });
      });
      var total = list.length;
      var done = 0;
      var failed = 0;
      if (!total) {
        if (onProgress) onProgress(0, 0, 0);
        return Promise.resolve({ total: 0, failed: 0 });
      }
      var i = 0;
      return new Promise(function (resolve) {
        function next() {
          if (i >= list.length) return;
          var item = list[i++];
          var p = inflight[item[2]] || loadSample(item[0], item[1]);
          p.then(function (buf) {
            done++;
            if (!buf) failed++;
            if (onProgress) onProgress(done, total, failed);
            if (done === total) resolve({ total: total, failed: failed });
            else next();
          });
        }
        for (var k = 0; k < Math.min(6, list.length); k++) next();
      });
    }

    // ---------- Reproducción ----------
    var live = [];
    function track(n) {
      live.push(n);
      return n;
    }

    function freq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    // Respaldo sintetizado para notas sin muestra.
    function synthNote(dest, midi, t, dur, vel, kind) {
      var o = track(ctx.createOscillator());
      var g = track(ctx.createGain());
      o.type = kind === 'bass' ? 'triangle' : kind === 'pad' ? 'triangle' : 'sawtooth';
      o.frequency.value = freq(midi);
      var f = track(ctx.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.setValueAtTime(kind === 'bass' ? 900 : 3200, t);
      f.frequency.exponentialRampToValueAtTime(kind === 'bass' ? 400 : 1200, t + Math.min(0.6, dur + 0.1));
      var peak = (kind === 'pad' ? 0.05 : kind === 'bass' ? 0.35 : 0.18) * vel;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (kind === 'pad' ? 0.08 : 0.005));
      g.gain.setValueAtTime(peak * 0.7, t + Math.max(0.01, dur - 0.03));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      o.connect(f);
      f.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.2);
    }

    // Toca una muestra; si la nota exacta no está, usa la más cercana cargada cambiando la velocidad.
    function sampleNote(dest, sample, midi, t, dur, vel, opt) {
      opt = opt || {};
      var buf = sample ? getLoaded(sample, midi) : null;
      var rate = 1;
      if (sample && !buf) {
        for (var d = 1; d <= 3 && !buf; d++) {
          var up = getLoaded(sample, midi - d);
          var dn = getLoaded(sample, midi + d);
          if (up) { buf = up; rate = Math.pow(2, d / 12); } else if (dn) { buf = dn; rate = Math.pow(2, -d / 12); }
        }
      }
      if (!buf) return synthNote(dest, midi, t, dur, vel, opt.kind);
      var src = track(ctx.createBufferSource());
      src.buffer = buf;
      src.playbackRate.value = rate;
      var g = track(ctx.createGain());
      var release = opt.release !== undefined ? opt.release : 0.25;
      var level = 0.9 * vel;
      g.gain.setValueAtTime(level, t);
      var end = Math.min(t + dur, t + buf.duration / rate);
      g.gain.setValueAtTime(level, Math.max(t, end - 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, end + release);
      if (opt.vibrato && src.detune) {
        var lfo = track(ctx.createOscillator());
        var depth = track(ctx.createGain());
        lfo.frequency.value = 5.4;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(opt.vibrato * 35, t + Math.min(0.35, dur * 0.6 + 0.05));
        lfo.connect(depth);
        depth.connect(src.detune);
        lfo.start(t);
        lfo.stop(end + release + 0.05);
      }
      if (opt.bendFrom && src.detune) {
        // Bend: empieza un semitono o tono abajo y sube.
        src.detune.setValueAtTime(-opt.bendFrom * 100, t);
        src.detune.linearRampToValueAtTime(0, t + Math.min(0.12, dur * 0.5));
      }
      src.connect(g);
      g.connect(dest);
      src.start(t);
      src.stop(end + release + 0.1);
    }

    function noiseBuffer() {
      if (noiseBuffer.buf) return noiseBuffer.buf;
      var len = ctx.sampleRate;
      var b = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBuffer.buf = b;
      return b;
    }

    function drum(type, t, vel) {
      var g = track(ctx.createGain());
      g.connect(drumBus);
      vel = vel || 1;
      if (type === 'kick') {
        var o = track(ctx.createOscillator());
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
        g.gain.setValueAtTime(0.8 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.25);
        return;
      }
      var src = track(ctx.createBufferSource());
      src.buffer = noiseBuffer();
      var f = track(ctx.createBiquadFilter());
      if (type === 'snare') {
        f.type = 'bandpass';
        f.frequency.value = 1900;
        f.Q.value = 0.7;
        g.gain.setValueAtTime(0.42 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        var body = track(ctx.createOscillator());
        var bg = track(ctx.createGain());
        body.frequency.setValueAtTime(220, t);
        body.frequency.exponentialRampToValueAtTime(140, t + 0.08);
        bg.gain.setValueAtTime(0.25 * vel, t);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        body.connect(bg);
        bg.connect(drumBus);
        body.start(t);
        body.stop(t + 0.12);
      } else if (type === 'clap') {
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 1.2;
        [0, 0.012, 0.024].forEach(function (off, i) {
          g.gain.setValueAtTime(0.5 * vel * (i === 2 ? 1 : 0.6), t + off);
          g.gain.exponentialRampToValueAtTime(0.01, t + off + 0.01);
        });
        g.gain.setValueAtTime(0.4 * vel, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      } else if (type === 'ride') {
        f.type = 'highpass';
        f.frequency.value = 5200;
        g.gain.setValueAtTime(0.13 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      } else {
        f.type = 'highpass';
        f.frequency.value = 7500;
        g.gain.setValueAtTime(0.14 * vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      }
      src.connect(f);
      f.connect(g);
      src.start(t);
      src.stop(t + 0.4);
    }

    function stopAll() {
      live.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) { /* ya parado */ }
        try { n.disconnect(); } catch (e) { /* nada */ }
      });
      live = [];
      // Corta las colas de delay sin esperar.
      var t = ctx.currentTime;
      chain.delayFb.gain.cancelScheduledValues(t);
      chain.delayFb.gain.setValueAtTime(0, t);
      chain.delayFb.gain.setTargetAtTime(clampN(state.fx.delayFeedback, 0, 90) / 100, t + 0.15, 0.05);
    }

    return {
      ctx: ctx,
      setQuality: function (q) { bank = BANKS[q] || BANKS.alta; },
      applyFx: applyFx,
      setLevels: setLevels,
      preload: preload,
      soloNote: function (sample, midi, t, dur, vel, extra) {
        var fx = state.fx;
        var h = clampN(fx.humanize, 0, 100) / 100;
        var jitter = (Math.random() - 0.5) * 0.03 * h;
        var v = vel * (1 - h * 0.25 * Math.random());
        var release = 0.05 + clampN(fx.sustain, 0, 100) / 100 * 1.2;
        sampleNote(chain.input, sample, midi, Math.max(ctx.currentTime, t + jitter), dur, v, { release: release, vibrato: clampN(fx.vibrato, 0, 100) / 100, bendFrom: extra && extra.bendFrom, kind: 'lead' });
      },
      bandNote: function (sample, midi, t, dur, vel, kind) {
        sampleNote(bandBus, sample, midi, t, dur, vel, { release: kind === 'bass' ? 0.08 : 0.35, kind: kind });
      },
      drum: drum,
      stopAll: stopAll,
      isLoaded: function (sample, midi) { return Boolean(getLoaded(sample, midi)); },
    };
  }

  return {
    INSTRUMENTS: INSTRUMENTS, CHORD_INSTRUMENTS: CHORD_INSTRUMENTS, BASS_INSTRUMENTS: BASS_INSTRUMENTS, STYLE_SOUND: STYLE_SOUND,
    FX_DEFAULT: FX_DEFAULT, FX_PRESETS: FX_PRESETS, REVERBS: REVERBS, DELAY_TIMES: DELAY_TIMES, BANKS: BANKS, SAMPLE_BASE: SAMPLE_BASE,
    noteFile: noteFile, presetFx: presetFx, create: create,
  };
});
