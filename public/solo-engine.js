/* Generador de solos de Ensaya.
 * Crea solos aleatorios pero musicales a partir de parámetros (escala, estilo, ritmo, variabilidad...).
 * La misma semilla y los mismos parámetros dan siempre el mismo solo, así se puede compartir.
 * Devuelve notación ABC (para partitura y tablatura) y una lista de eventos (para el sonido).
 * Funciona en el navegador (window.SoloEngine) y en Node (pruebas). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoloEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LATIN = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  var ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7, 'G#': 8, 'D#': 9, 'A#': 10 };

  // Escalas: intervalos de la escala madre de 7 notas y grados usados (pentatónicas y blues usan un subconjunto).
  var SCALES = {
    pentatonica_menor: { name: 'Pentatónica menor', parent: [0, 2, 3, 5, 7, 8, 10], degrees: [0, 2, 3, 4, 6], mode: 'm', minor: true },
    pentatonica_mayor: { name: 'Pentatónica mayor', parent: [0, 2, 4, 5, 7, 9, 11], degrees: [0, 1, 2, 4, 5], mode: '', minor: false },
    blues: { name: 'Blues', parent: [0, 2, 3, 5, 7, 8, 10], degrees: [0, 2, 3, 4, 6], blueNote: true, mode: 'm', minor: true },
    mayor: { name: 'Mayor (jónica)', parent: [0, 2, 4, 5, 7, 9, 11], mode: '', minor: false },
    menor: { name: 'Menor natural (eólica)', parent: [0, 2, 3, 5, 7, 8, 10], mode: 'm', minor: true },
    dorica: { name: 'Dórica', parent: [0, 2, 3, 5, 7, 9, 10], mode: 'Dor', minor: true },
    mixolidia: { name: 'Mixolidia', parent: [0, 2, 4, 5, 7, 9, 10], mode: 'Mix', minor: false },
    frigia: { name: 'Frigia', parent: [0, 1, 3, 5, 7, 8, 10], mode: 'Phr', minor: true },
    frigia_dominante: { name: 'Frigia dominante (flamenco)', parent: [0, 1, 4, 5, 7, 8, 10], mode: 'Phr', minor: false },
    lidia: { name: 'Lidia', parent: [0, 2, 4, 6, 7, 9, 11], mode: 'Lyd', minor: false },
    menor_armonica: { name: 'Menor armónica', parent: [0, 2, 3, 5, 7, 8, 11], mode: 'm', minor: true },
    menor_melodica: { name: 'Menor melódica', parent: [0, 2, 3, 5, 7, 9, 11], mode: 'm', minor: true },
  };
  var MODE_OFFSET = { '': 0, m: -3, Dor: -2, Mix: -1, Phr: -4, Lyd: 1 };

  // Estilos: valores por defecto y preferencias rítmicas.
  var STYLES = {
    rock: { name: 'Rock', scale: 'pentatonica_menor', density: 5, variability: 40, rests: 15, swing: 0, chromatic: 5, ornaments: 25, repetition: 45, cells: { e: 4, q: 2, s: 2, de: 2, sync: 2, h: 1, trip: 1 }, accents: true, bend: true },
    blues: { name: 'Blues', scale: 'blues', density: 4, variability: 45, rests: 25, swing: 60, chromatic: 10, ornaments: 40, repetition: 55, cells: { trip: 4, q: 3, e: 3, de: 2, h: 2, sync: 1 }, bend: true, progression: 'blues' },
    jazz: { name: 'Jazz', scale: 'dorica', density: 6, variability: 55, rests: 15, swing: 65, chromatic: 35, ornaments: 15, repetition: 25, cells: { e: 6, trip: 2, q: 2, sync: 2, s: 1 }, approach: true },
    funk: { name: 'Funk', scale: 'dorica', density: 6, variability: 35, rests: 35, swing: 10, chromatic: 10, ornaments: 10, repetition: 65, cells: { s: 4, sync: 5, e: 2, snap: 2 }, staccato: true },
    flamenco: { name: 'Flamenco', scale: 'frigia_dominante', density: 7, variability: 35, rests: 10, swing: 0, chromatic: 5, ornaments: 35, repetition: 40, cells: { s: 4, sext: 3, trip: 2, e: 2, q: 1 }, progression: 'andaluza', descending: true },
    metal: { name: 'Metal', scale: 'menor_armonica', density: 9, variability: 50, rests: 5, swing: 0, chromatic: 10, ornaments: 15, repetition: 35, cells: { s: 5, sext: 4, e: 1, trip: 1 }, accents: true },
    balada: { name: 'Balada', scale: 'pentatonica_mayor', density: 2, variability: 25, rests: 20, swing: 0, chromatic: 0, ornaments: 30, repetition: 40, cells: { q: 4, h: 3, e: 2, de: 1, w: 1 } },
    pop: { name: 'Pop', scale: 'mayor', density: 4, variability: 30, rests: 20, swing: 0, chromatic: 0, ornaments: 15, repetition: 60, cells: { e: 4, q: 3, sync: 2, de: 1, h: 1 } },
  };

  var PROGRESSIONS = {
    blues: { name: 'Blues de 12 compases', degrees: ['I7', 'IV7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] },
    andaluza: { name: 'Cadencia andaluza', degrees: ['i', 'bVII', 'bVI', 'V'] },
    pop: { name: 'I–V–vi–IV', degrees: ['I', 'V', 'vi', 'IV'] },
    menor: { name: 'i–VI–III–VII', degrees: ['i', 'bVI', 'bIII', 'bVII'] },
    jazz: { name: 'ii–V–I', degrees: ['ii7', 'V7', 'Imaj7', 'Imaj7'] },
    modal: { name: 'Un acorde (modal)', degrees: ['i'] },
  };

  // ---------- Utilidades ----------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weighted(rng, items) {
    var total = 0;
    for (var i = 0; i < items.length; i++) total += Math.max(0, items[i][1]);
    if (total <= 0) return items[0][0];
    var r = rng() * total;
    for (var j = 0; j < items.length; j++) {
      r -= Math.max(0, items[j][1]);
      if (r <= 0) return items[j][0];
    }
    return items[items.length - 1][0];
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function rootPc(name) {
    var m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?)/.exec(String(name || '').trim());
    if (!m) return null;
    var letter = LATIN[m[1]] || m[1];
    var pc = LETTER_PC[letter];
    if (m[2] === '#') pc += 1;
    if (m[2] === 'b') pc -= 1;
    return { pc: (pc + 12) % 12, letter: letter, acc: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, rest: String(name).trim().slice(m[0].length) };
  }

  // Acorde → notas (clases de altura) y nombre limpio.
  function parseChord(name) {
    var r = rootPc(name);
    if (!r) return null;
    var q = r.rest.split('/')[0];
    var iv;
    if (/^(maj7|M7|Δ)/.test(q)) iv = [0, 4, 7, 11];
    else if (/^(m7b5|ø)/.test(q)) iv = [0, 3, 6, 10];
    else if (/^(m|min|-)7/.test(q)) iv = [0, 3, 7, 10];
    else if (/^(m|min|-)6/.test(q)) iv = [0, 3, 7, 9];
    else if (/^(m|min|-)(?!aj)/.test(q)) iv = [0, 3, 7];
    else if (/^(dim|°|o)/.test(q)) iv = [0, 3, 6, 9];
    else if (/^(aug|\+)/.test(q)) iv = [0, 4, 8];
    else if (/^sus2/.test(q)) iv = [0, 2, 7];
    else if (/^sus/.test(q)) iv = [0, 5, 7];
    else if (/^5/.test(q)) iv = [0, 7];
    else if (/^6/.test(q)) iv = [0, 4, 7, 9];
    else if (/^(7|9|11|13)/.test(q)) iv = [0, 4, 7, 10];
    else iv = [0, 4, 7];
    return { name: String(name).trim(), root: r.pc, tones: iv.map(function (x) { return (r.pc + x) % 12; }) };
  }

  function parseProgression(text) {
    return String(text || '')
      .split(/[\s,|\-–]+/)
      .map(function (t) { return t.trim(); })
      .filter(Boolean)
      .map(parseChord)
      .filter(Boolean)
      .slice(0, 32);
  }

  // Grados romanos → acordes en la tonalidad.
  var ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
  function noteName(pc, preferFlats) {
    var sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    return (preferFlats ? flats : sharps)[((pc % 12) + 12) % 12];
  }
  function progressionFor(key, presetId) {
    var preset = PROGRESSIONS[presetId];
    if (!preset) return '';
    var r = rootPc(key);
    if (!r) return '';
    var flats = /b/.test(key) || ['F'].indexOf(key) >= 0;
    return preset.degrees
      .map(function (d) {
        var m = /^(b?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(d);
        var deg = ROMAN[m[2].toUpperCase()] - (m[1] ? 1 : 0);
        var minor = m[2] === m[2].toLowerCase();
        var suffix = m[3] || '';
        return noteName(r.pc + deg, flats) + (minor && !/^m/.test(suffix) ? 'm' : '') + suffix;
      })
      .join(' ');
  }

  // Ortografía de la escala: letras consecutivas desde la raíz.
  function spellScale(key, scaleId) {
    var sc = SCALES[scaleId] || SCALES.pentatonica_menor;
    var r = rootPc(key) || rootPc('A');
    var li = LETTERS.indexOf(r.letter);
    var notes = sc.parent.map(function (iv, i) {
      var letter = LETTERS[(li + i) % 7];
      var pc = (r.pc + iv) % 12;
      var acc = ((pc - LETTER_PC[letter] + 18) % 12) - 6;
      return { pc: pc, letter: letter, acc: acc, degree: i };
    });
    var used = sc.degrees ? sc.degrees.map(function (d) { return notes[d]; }) : notes.slice();
    if (sc.blueNote) {
      var fifth = notes[4];
      used.push({ pc: (fifth.pc + 11) % 12, letter: fifth.letter, acc: fifth.acc - 1, degree: 4, blue: true });
    }
    used.sort(function (a, b) { return ((a.pc - r.pc + 12) % 12) - ((b.pc - r.pc + 12) % 12); });
    return { root: r, notes: used, all: notes, scale: sc };
  }

  function keyFifths(key, scaleId) {
    var sc = SCALES[scaleId] || SCALES.pentatonica_menor;
    var r = rootPc(key) || rootPc('A');
    var name = r.letter + (r.acc === 1 ? '#' : r.acc === -1 ? 'b' : '');
    var base = MAJOR_FIFTHS[name];
    if (base === undefined) base = 0;
    return base + (MODE_OFFSET[sc.mode] || 0);
  }

  function keySignature(fifths) {
    var sig = {};
    var sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    var flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
    for (var i = 0; i < Math.min(7, Math.abs(fifths)); i++) {
      if (fifths > 0) sig[sharps[i]] = 1;
      else sig[flats[i]] = -1;
    }
    return sig;
  }

  // ---------- Ritmo ----------
  // Una "celda" llena un pulso. ticks = semicorcheas (L:1/16).
  function cellsFor(beatTicks) {
    if (beatTicks === 6) {
      return {
        q: { notes: [6] }, e: { notes: [2, 2, 2] }, s: { notes: [1, 1, 1, 1, 1, 1] }, de: { notes: [4, 2] },
        sync: { notes: [2, 4] }, snap: { notes: [1, 1, 2, 2] }, trip: { notes: [2, 1, 1, 2] }, sext: { notes: [1, 1, 1, 1, 2] },
        h: { notes: [12], beats: 2 }, w: { notes: [12], beats: 2 },
      };
    }
    return {
      q: { notes: [4] }, e: { notes: [2, 2] }, s: { notes: [1, 1, 1, 1] }, de: { notes: [3, 1] },
      sync: { notes: [1, 2, 1] }, snap: { notes: [1, 3] }, trip: { notes: [2, 2, 2], tuplet: 3 }, sext: { notes: [1, 1, 1, 1, 1, 1], tuplet: 6 },
      h: { notes: [8], beats: 2 }, w: { notes: [16], beats: 4 },
    };
  }

  function cellDensity(cell, beatTicks) {
    var beats = cell.beats || 1;
    return cell.notes.length / beats;
  }

  // ---------- Generación ----------
  var DEFAULTS = {
    key: 'A', scale: 'pentatonica_menor', style: 'rock', tempo: 100, meter: '4/4', bars: 8,
    density: 5, variability: 40, rests: 15, swing: 0, chromatic: 5, ornaments: 25, repetition: 45,
    register: 'medio', range: 2, chordFollow: 70, progression: '', endOnTonic: true, seed: 1,
  };

  function normalize(p) {
    var o = {};
    for (var k in DEFAULTS) o[k] = p && p[k] !== undefined && p[k] !== '' ? p[k] : DEFAULTS[k];
    o.tempo = clamp(Number(o.tempo) || 100, 40, 260);
    o.bars = clamp(Math.round(Number(o.bars) || 8), 1, 32);
    ['density', 'variability', 'rests', 'swing', 'chromatic', 'ornaments', 'repetition', 'chordFollow'].forEach(function (k) {
      o[k] = clamp(Number(o[k]) || 0, k === 'density' ? 1 : 0, k === 'density' ? 10 : 100);
    });
    o.range = clamp(Math.round(Number(o.range) || 2), 1, 3);
    if (!SCALES[o.scale]) o.scale = DEFAULTS.scale;
    if (!STYLES[o.style]) o.style = DEFAULTS.style;
    if (!/^(2|3|4|6|12)\/(4|8)$/.test(o.meter)) o.meter = '4/4';
    if (!rootPc(o.key)) o.key = 'A';
    o.seed = (Number(o.seed) >>> 0) || 1;
    o.endOnTonic = o.endOnTonic !== false && o.endOnTonic !== 'false';
    return o;
  }

  // layout.barsPerLine: compases por línea en la partitura (solo afecta al aspecto, no al solo).
  function generate(params, layout) {
    var p = normalize(params);
    var rng = mulberry32(p.seed * 2654435761 + VERSION);
    var style = STYLES[p.style];
    var spelled = spellScale(p.key, p.scale);
    var rootMidiPc = spelled.root.pc;

    // Compás
    var mt = p.meter.split('/').map(Number);
    var compound = mt[1] === 8 && mt[0] % 3 === 0;
    var beatTicks = compound ? 6 : 16 / mt[1] * 1;
    if (mt[1] === 4) beatTicks = 4;
    var beatsPerBar = compound ? mt[0] / 3 : mt[0];
    var barTicks = beatsPerBar * beatTicks;
    var cells = cellsFor(beatTicks);

    // Registro (MIDI): grave E2..., medio A3..., agudo E4...
    var lowStart = { grave: 40, medio: 57, agudo: 64 }[p.register] || 57;
    var low = lowStart;
    var high = lowStart + 12 * p.range + 2;
    var pool = [];
    for (var m = low; m <= high; m++) {
      var pc = m % 12;
      for (var i = 0; i < spelled.notes.length; i++) {
        if (spelled.notes[i].pc === pc) pool.push({ midi: m, sp: spelled.notes[i] });
      }
    }

    // Acordes: uno por compás (si hay menos, se repiten).
    var chords = parseProgression(p.progression);
    if (!chords.length) {
      var preset = style.progression || (spelled.scale.minor ? 'menor' : 'pop');
      chords = parseProgression(progressionFor(p.key, preset));
    }
    if (!chords.length) chords = [parseChord(p.key + (spelled.scale.minor ? 'm' : ''))];

    // Preferencias de celdas según densidad (notas por pulso deseadas).
    var target = 0.35 + (p.density - 1) * (5.5 / 9); // 0.35 … 5.85 notas por pulso
    function chooseCell(beatsLeft) {
      var items = [];
      Object.keys(cells).forEach(function (id) {
        var c = cells[id];
        if ((c.beats || 1) > beatsLeft) return;
        var base = (style.cells[id] || 0.15);
        var d = cellDensity(c, beatTicks);
        var fit = Math.exp(-Math.pow(Math.log((d + 0.2) / (target + 0.2)), 2) * 2.2);
        items.push([id, base * fit]);
      });
      return weighted(rng, items);
    }

    function rhythmBar() {
      var events = [];
      var beat = 0;
      while (beat < beatsPerBar) {
        var id = chooseCell(beatsPerBar - beat);
        var c = cells[id];
        var start = beat * beatTicks;
        var t = start;
        var span = (c.beats || 1) * beatTicks;
        var sum = c.notes.reduce(function (a, b) { return a + b; }, 0);
        for (var n = 0; n < c.notes.length; n++) {
          var len = c.tuplet ? (span / c.notes.length) : c.notes[n];
          events.push({ tick: t, ticks: len, written: c.notes[n], tuplet: c.tuplet || 0, tupletIndex: n, tupletSize: c.notes.length, strong: n === 0 });
          t += c.tuplet ? span / c.notes.length : c.notes[n];
        }
        if (!c.tuplet && sum !== span) events[events.length - 1].ticks += span - sum;
        beat += c.beats || 1;
      }
      return events;
    }

    // Saltos según variabilidad: baja = por grados conjuntos; alta = saltos amplios.
    var v = p.variability / 100;
    function stepSize() {
      var items = [];
      for (var k = 0; k <= 7; k++) {
        var w = Math.exp(-k / (0.45 + 3.2 * v));
        if (k === 0) w *= style.staccato ? 0.7 : 0.15;
        if (k === 1) w *= 1.6 - v;
        items.push([k, w]);
      }
      return weighted(rng, items);
    }

    function nearestIndex(midi) {
      var best = 0;
      for (var i = 0; i < pool.length; i++) if (Math.abs(pool[i].midi - midi) < Math.abs(pool[best].midi - midi)) best = i;
      return best;
    }

    var bars = [];
    var idx = nearestIndex(low + Math.round((high - low) * 0.45));
    var motif = null;
    for (var b = 0; b < p.bars; b++) {
      var chord = chords[b % chords.length];
      var phrasePos = (b % 4) / 4; // forma de arco dentro de cada frase de 4 compases
      var reuse = b > 0 && motif && rng() < p.repetition / 100 && !(b === p.bars - 1 && p.endOnTonic);
      var rhythm;
      var intervals = null;
      if (reuse) {
        rhythm = motif.rhythm.map(function (e) { return Object.assign({}, e); });
        // Llamada y respuesta: a veces se varía la segunda mitad.
        if (rng() < 0.5 && (barTicks / 2) % beatTicks === 0) {
          var half = barTicks / 2;
          var fresh = rhythmBar().filter(function (e) { return e.tick >= half - 1e-6; });
          var first = rhythm.filter(function (e) { return e.tick < half - 1e-6 && e.tick + e.ticks <= half + 1e-6; });
          var firstSum = first.reduce(function (acc, x) { return acc + x.ticks; }, 0);
          if (first.length && fresh.length && Math.abs(fresh[0].tick - half) < 1e-6 && Math.abs(firstSum - half) < 1e-6) rhythm = first.concat(fresh);
        }
        intervals = motif.intervals;
      } else {
        rhythm = rhythmBar();
      }

      var notes = [];
      var prevIdx = idx;
      var lastDir = 0;
      var repeats = 0;
      var runDir = 0;
      var pendingTarget = -1;
      for (var e = 0; e < rhythm.length; e++) {
        var ev = rhythm[e];
        var isLastBar = b === p.bars - 1;
        var restP = p.rests / 100 * (ev.strong ? 0.6 : 1);
        if (e === 0 && b === 0) restP = 0;
        var isRest = !ev.tuplet && rng() < restP;
        if (isLastBar && e === rhythm.length - 1) isRest = false;
        if (isRest) {
          notes.push(Object.assign({ rest: true }, ev));
          continue;
        }
        var nextIdx;
        if (pendingTarget >= 0) {
          nextIdx = pendingTarget;
        } else if (intervals && intervals[e] !== undefined && e > 0) {
          nextIdx = clamp(prevIdx + intervals[e], 0, pool.length - 1);
        } else {
          var k = e === 0 && b === 0 ? 0 : stepSize();
          // Dirección: tendencia a volver al centro del registro, arco de frase e inercia melódica.
          var center = (pool.length - 1) / 2;
          var upP = 0.5 + ((center - prevIdx) / Math.max(1, pool.length)) * 1.1 + (phrasePos < 0.5 ? 0.08 : -0.08) - (style.descending ? 0.12 : 0);
          var dir;
          if (ev.tuplet && ev.tupletIndex > 0 && runDir) {
            // Dentro de un tresillo o seisillo: escala rápida en una dirección.
            dir = runDir;
            k = rng() < 0.8 ? 1 : 2;
          } else if (lastDir && rng() < (ev.ticks <= 1 ? 0.75 : 0.5)) {
            dir = lastDir;
          } else {
            dir = rng() < clamp(upP, 0.1, 0.9) ? 1 : -1;
          }
          if (ev.tuplet && ev.tupletIndex === 0) runDir = dir;
          if (k === 0 && repeats >= 1 && !style.staccato) k = 1;
          nextIdx = prevIdx + dir * k;
          if (nextIdx < 0 || nextIdx >= pool.length) nextIdx = prevIdx - dir * k;
          nextIdx = clamp(nextIdx, 0, pool.length - 1);
        }
        // En partes fuertes, tender a notas del acorde.
        var onBeat = ev.tick % beatTicks === 0;
        var resolving = pendingTarget >= 0;
        pendingTarget = -1;
        if (!resolving && onBeat && p.chordFollow > 0 && rng() < p.chordFollow / 100) {
          var cands = [];
          for (var d = -3; d <= 3; d++) {
            var j = nextIdx + d;
            if (j < 0 || j >= pool.length) continue;
            var isChord = chord.tones.indexOf(pool[j].midi % 12) >= 0;
            cands.push([j, (isChord ? 6 : 0.3) * Math.exp(-Math.abs(d) * 0.6)]);
          }
          nextIdx = weighted(rng, cands);
        }
        var midi = pool[nextIdx].midi;
        var sp = pool[nextIdx].sp;
        var chromaticNote = null;
        // Nota cromática de aproximación: un semitono por debajo y, a continuación, la nota de la escala.
        if (!resolving && !ev.tuplet && !onBeat && p.chromatic > 0 && rng() < p.chromatic / 100 && e + 1 < rhythm.length && !rhythm[e + 1].tuplet) {
          var below = midi - 1;
          if (below >= low && spelled.notes.every(function (n) { return n.pc !== below % 12; })) {
            chromaticNote = below;
            pendingTarget = nextIdx;
          }
        }
        var note = Object.assign({ midi: chromaticNote || midi, sp: chromaticNote ? null : sp, idx: nextIdx }, ev);
        // Adornos
        if (p.ornaments > 0 && rng() < p.ornaments / 100) {
          if (ev.ticks >= 4 && style.bend && nextIdx > 0) note.grace = pool[nextIdx - 1];
          else if (ev.ticks >= 2 && nextIdx < pool.length - 1 && rng() < 0.5) note.grace = pool[nextIdx + 1];
          else if (ev.ticks >= 4 && rng() < 0.5) note.slide = true;
        }
        if (style.staccato && ev.ticks <= 2 && rng() < 0.5) note.staccato = true;
        if (style.accents && ev.tick === 0) note.accent = true;
        notes.push(note);
        repeats = nextIdx === prevIdx ? repeats + 1 : 0;
        if (nextIdx !== prevIdx) lastDir = nextIdx > prevIdx ? 1 : -1;
        prevIdx = nextIdx;
      }

      // Final en la tónica
      if (b === p.bars - 1 && p.endOnTonic) {
        var lastNote = notes[notes.length - 1];
        var tonicIdx = -1;
        for (var t2 = 0; t2 < pool.length; t2++) {
          if (pool[t2].midi % 12 === rootMidiPc && (tonicIdx < 0 || Math.abs(t2 - prevIdx) < Math.abs(tonicIdx - prevIdx))) tonicIdx = t2;
        }
        if (tonicIdx >= 0 && lastNote) {
          // El último pulso entero pasa a ser la tónica larga.
          var lastBeatStart = (beatsPerBar - 1) * beatTicks;
          notes = notes.filter(function (n) { return n.tick < lastBeatStart; });
          var cut = notes.length ? notes[notes.length - 1] : null;
          if (cut && cut.tick + cut.ticks > lastBeatStart + 1e-6) {
            notes.pop();
            lastBeatStart = cut.tick;
          }
          notes.push({ midi: pool[tonicIdx].midi, sp: pool[tonicIdx].sp, idx: tonicIdx, tick: lastBeatStart, ticks: barTicks - lastBeatStart, written: barTicks - lastBeatStart, tuplet: 0, strong: true, final: true });
          prevIdx = tonicIdx;
        }
      }

      // Guardar el motivo (ritmo + intervalos) para repetirlo después.
      if (!reuse && (b % 2 === 0 || !motif)) {
        var iv = [];
        var last = null;
        notes.forEach(function (n, k2) {
          if (n.rest || n.idx === undefined) { iv.push(undefined); return; }
          iv.push(last === null ? 0 : n.idx - last);
          last = n.idx;
        });
        motif = { rhythm: rhythm, intervals: iv };
      }
      idx = prevIdx;
      bars.push({ chord: chord, notes: notes });
    }

    var fifths = keyFifths(p.key, p.scale);
    var perLine = layout && layout.barsPerLine ? clamp(Math.round(layout.barsPerLine), 1, 8) : (p.density >= 7 || barTicks >= 24 ? 2 : 4);
    var abc = toAbc(p, bars, { fifths: fifths, barTicks: barTicks, beatTicks: beatTicks, spelled: spelled, perLine: perLine });
    var events = toEvents(p, bars, { barTicks: barTicks, beatTicks: beatTicks });
    return { params: p, abc: abc, events: events, bars: bars, chords: bars.map(function (x) { return x.chord.name; }), barTicks: barTicks, beatTicks: beatTicks, beatsPerBar: beatsPerBar, version: VERSION };
  }

  // ---------- Salida ABC ----------
  function lengthStr(n) {
    if (n === 1) return '';
    if (Number.isInteger(n)) return String(n);
    // fracciones simples
    var den = 2;
    while (!Number.isInteger(n * den) && den < 16) den *= 2;
    return (n * den) + '/' + den;
  }

  function pitchToken(midi, sp, fifths, barAcc, keySig) {
    var letter;
    var acc;
    if (sp) {
      letter = sp.letter;
      acc = sp.acc;
    } else {
      var pc = midi % 12;
      var useFlats = fifths < 0;
      var names = useFlats ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      var nm = names[pc];
      letter = nm[0];
      acc = nm[1] === '#' ? 1 : nm[1] === 'b' ? -1 : 0;
    }
    var natural = midi - acc;
    var octave = Math.floor(natural / 12) - 1;
    var keyName = letter + octave;
    var current = barAcc[keyName] !== undefined ? barAcc[keyName] : keySig[letter] || 0;
    var prefix = '';
    if (acc !== current) {
      prefix = acc === 1 ? '^' : acc === -1 ? '_' : acc === 2 ? '^^' : acc === -2 ? '__' : '=';
      barAcc[keyName] = acc;
    }
    var body = octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ','.repeat(Math.max(0, 4 - octave));
    return prefix + body;
  }

  function toAbc(p, bars, ctx) {
    var sc = SCALES[p.scale];
    var r = rootPc(p.key);
    var keyName = r.letter + (r.acc === 1 ? '#' : r.acc === -1 ? 'b' : '');
    var keySig = keySignature(ctx.fifths);
    var title = STYLES[p.style].name + ' en ' + p.key + ' · ' + sc.name;
    var lines = [
      'X:1',
      'T:' + title,
      'C:Generador de solos · semilla ' + p.seed,
      'M:' + p.meter,
      'L:1/16',
      'Q:1/4=' + p.tempo,
      'K:' + keyName + (sc.mode ? (sc.mode === 'm' ? 'm' : ' ' + sc.mode) : ''),
    ];
    var body = '';
    bars.forEach(function (bar, bi) {
      var barAcc = {};
      var out = '"' + bar.chord.name + '"';
      var lastBeat = -1;
      var inTuplet = 0;
      bar.notes.forEach(function (n) {
        var beat = Math.floor(n.tick / ctx.beatTicks + 1e-9);
        if (beat !== lastBeat && out.length && !/"$/.test(out) && inTuplet === 0) out += ' ';
        lastBeat = beat;
        if (n.tuplet && n.tupletIndex === 0) {
          out += '(' + n.tuplet;
          inTuplet = n.tupletSize;
        }
        var len = lengthStr(n.tuplet ? n.written : n.ticks);
        if (n.rest) {
          out += 'z' + len;
        } else {
          if (n.grace) out += '{' + pitchToken(n.grace.midi, n.grace.sp, ctx.fifths, {}, keySig) + '}';
          if (n.slide) out += '!slide!';
          if (n.accent) out += '!>!';
          if (n.staccato) out += '.';
          out += pitchToken(n.midi, n.sp, ctx.fifths, barAcc, keySig) + len;
        }
        if (inTuplet) inTuplet--;
      });
      body += out + (bi === bars.length - 1 ? ' |]' : ' | ');
      if ((bi + 1) % ctx.perLine === 0 && bi !== bars.length - 1) body += '\n';
    });
    return lines.join('\n') + '\n' + body + '\n';
  }

  // ---------- Eventos para el sonido ----------
  function toEvents(p, bars, ctx) {
    var out = [];
    var beatSec = 60 / p.tempo * (ctx.beatTicks === 6 ? 1.5 : 1);
    var tickSec = beatSec / ctx.beatTicks;
    var swing = p.swing / 100;
    function swingTime(tick) {
      // Corcheas a contratiempo se retrasan (hasta el tresillo con swing 100 %).
      if (ctx.beatTicks !== 4) return tick;
      var inBeat = tick % 4;
      var beatStart = tick - inBeat;
      if (inBeat === 2) return beatStart + 2 + swing * (2 / 3) * 2 / 2;
      if (inBeat === 1) return beatStart + 1 + swing * 0.33;
      if (inBeat === 3) return beatStart + 3 + swing * 0.33;
      return tick;
    }
    var noteIndex = 0;
    bars.forEach(function (bar, bi) {
      var barStart = bi * ctx.barTicks;
      bar.notes.forEach(function (n) {
        var start = swingTime(n.tick);
        var end = n.tick + n.ticks >= ctx.barTicks ? ctx.barTicks : swingTime(n.tick + n.ticks);
        out.push({
          index: noteIndex++,
          rest: Boolean(n.rest),
          midi: n.rest ? null : n.midi,
          time: (barStart + start) * tickSec,
          duration: Math.max(0.05, (end - start) * tickSec * (n.staccato ? 0.5 : 0.95)),
          velocity: n.accent ? 1 : n.tick === 0 ? 0.9 : 0.75,
          grace: n.grace ? n.grace.midi : null,
          bar: bi,
        });
      });
    });
    return {
      notes: out,
      chords: bars.map(function (b, i) { return { bar: i, time: i * ctx.barTicks * tickSec, duration: ctx.barTicks * tickSec, root: b.chord.root, tones: b.chord.tones, name: b.chord.name }; }),
      beatSec: beatSec,
      beatsPerBar: ctx.barTicks / ctx.beatTicks,
      totalSec: bars.length * ctx.barTicks * tickSec,
    };
  }

  // Acordes de una letra ChordPro (para usar la progresión de la canción).
  function chordsFromLyrics(text) {
    var out = [];
    var re = /\[([^\]]+)\]/g;
    var m;
    while ((m = re.exec(String(text || ''))) && out.length < 16) {
      var c = parseChord(m[1]);
      if (c && out[out.length - 1] !== c.name) out.push(c.name);
    }
    return out.join(' ');
  }

  return {
    VERSION: VERSION, SCALES: SCALES, STYLES: STYLES, PROGRESSIONS: PROGRESSIONS, ROOTS: ROOTS, DEFAULTS: DEFAULTS,
    generate: generate, normalize: normalize, progressionFor: progressionFor, chordsFromLyrics: chordsFromLyrics, parseChord: parseChord, spellScale: spellScale,
  };
});
