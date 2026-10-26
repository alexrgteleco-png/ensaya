/* Melodías como lista de notas (para el editor sencillo) y su conversión a notación ABC.
 * Una nota: { midi (o null si es silencio), ticks } en semicorcheas (L:1/16). Las notas van seguidas.
 * Acordes: [{ tick, name }]. Funciona en el navegador (window.MelodyModel) y en Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MelodyModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7, 'G#': 8, 'D#': 9, 'A#': 10 };
  var LATIN = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  var PIECES = [16, 12, 8, 6, 4, 3, 2, 1];
  var NAMES_ES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

  function parseKey(key) {
    var m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?)(.*)$/.exec(String(key || 'C').trim());
    if (!m) return { letter: 'C', acc: 0, minor: false, name: 'C', fifths: 0, pc: 0 };
    var letter = LATIN[m[1]] || m[1];
    var acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    var minor = /^(m(?!aj)|-|min)/.test(m[3] || '');
    var base = letter + (m[2] || '');
    var fifths = (MAJOR_FIFTHS[base] !== undefined ? MAJOR_FIFTHS[base] : 0) + (minor ? -3 : 0);
    return { letter: letter, acc: acc, minor: minor, name: base + (minor ? 'm' : ''), fifths: fifths, pc: (LETTER_PC[letter] + acc + 12) % 12 };
  }

  function meterInfo(meter) {
    var m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(meter || '4/4'));
    var n = m ? Number(m[1]) : 4;
    var d = m ? Number(m[2]) : 4;
    var barTicks = Math.round((n * 16) / d) || 16;
    var beatTicks = d === 8 && n % 3 === 0 ? 6 : 16 / d;
    return { barTicks: barTicks, beatTicks: beatTicks, meter: n + '/' + d };
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

  // Ortografía según la armadura: si la nota está en la tonalidad, como en la armadura; si no, ♯ o ♭ según la tonalidad.
  function spell(midi, fifths) {
    var pc = ((midi % 12) + 12) % 12;
    var sig = keySignature(fifths);
    for (var i = 0; i < 7; i++) {
      var L = LETTERS[i];
      if ((LETTER_PC[L] + (sig[L] || 0) + 12) % 12 === pc) return { letter: L, acc: sig[L] || 0 };
    }
    var sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    var nm = (fifths < 0 ? flats : sharps)[pc];
    return { letter: nm[0], acc: nm[1] === '#' ? 1 : nm[1] === 'b' ? -1 : 0 };
  }

  function pitchToken(midi, fifths, barAcc, sig) {
    var sp = spell(midi, fifths);
    var natural = midi - sp.acc;
    var octave = Math.floor(natural / 12) - 1;
    var keyName = sp.letter + octave;
    var current = barAcc[keyName] !== undefined ? barAcc[keyName] : sig[sp.letter] || 0;
    var prefix = '';
    if (sp.acc !== current) {
      prefix = sp.acc === 1 ? '^' : sp.acc === -1 ? '_' : '=';
      barAcc[keyName] = sp.acc;
    }
    var body = octave >= 5 ? sp.letter.toLowerCase() + "'".repeat(octave - 5) : sp.letter + ','.repeat(Math.max(0, 4 - octave));
    return prefix + body;
  }

  // Posición de cada nota (tick) a partir de las duraciones.
  function withTicks(notes) {
    var t = 0;
    return (notes || []).map(function (n) {
      var o = { midi: n.midi === undefined ? null : n.midi, ticks: Number(n.ticks) || 4, tick: t };
      t += o.ticks;
      return o;
    });
  }

  function totalTicks(notes) {
    return (notes || []).reduce(function (a, n) { return a + (Number(n.ticks) || 0); }, 0);
  }

  // Acordes del cifrado de la canción (compases de ChordPro.bars) en ticks.
  function chordsFromBars(bars, meter) {
    var mi = meterInfo(meter);
    var out = [];
    var beats = mi.barTicks / mi.beatTicks;
    (bars || []).forEach(function (chords, bi) {
      var n = Math.min(chords.length, beats);
      var each = Math.floor(beats / n);
      var t = bi * mi.barTicks;
      for (var i = 0; i < n; i++) {
        out.push({ tick: t, name: chords[i] });
        t += (each + (i === 0 ? beats - each * n : 0)) * mi.beatTicks;
      }
    });
    return out;
  }

  // Trocea una duración en valores que se escriben bien (con ligaduras).
  function splitLength(len, posInBeat) {
    var out = [];
    var rest = len;
    while (rest > 0) {
      var p = 1;
      for (var i = 0; i < PIECES.length; i++) {
        if (PIECES[i] <= rest) { p = PIECES[i]; break; }
      }
      out.push(p);
      rest -= p;
    }
    return out;
  }

  function lengthStr(n) {
    return n === 1 ? '' : String(n);
  }

  function chordLabel(name) {
    return String(name).replace(/^([A-G][#b]?)m-/, '$1m').replace(/^([A-G][#b]?)-/, '$1m').replace(/^([A-G][#b]?)\^/, '$1maj').replace(/^([A-G][#b]?)h7?/, '$1m7b5').replace(/^([A-G][#b]?)o/, '$1dim');
  }

  // model → { abc, pieces: [{ note: índice de la nota o -1 si es relleno }] } (una pieza por figura dibujada).
  function toAbc(model, title, opts) {
    opts = opts || {};
    var k = parseKey(model.key);
    var mi = meterInfo(model.meter);
    var sig = keySignature(k.fifths);
    var notes = withTicks(model.notes);
    var chords = (model.chords || []).slice().sort(function (a, b) { return a.tick - b.tick; });
    var end = totalTicks(notes);
    var chordEnd = chords.length ? chords[chords.length - 1].tick + 1 : 0;
    // Se dibujan los compases escritos y unos pocos más del cifrado (no la canción entera vacía).
    if (opts.aheadBars !== undefined) chordEnd = Math.min(chordEnd, Math.ceil((end + 1) / mi.barTicks) * mi.barTicks + opts.aheadBars * mi.barTicks - 1);
    var minBars = Math.max(1, Math.ceil(Math.max(end, chordEnd, opts.minTicks || 0) / mi.barTicks));
    if (opts.extraBar && end >= (minBars - 0) * mi.barTicks - 1e-6) minBars++;
    var total = minBars * mi.barTicks;
    // Línea de tiempo: notas y silencios de relleno hasta completar el último compás.
    var timeline = notes.map(function (n, i) { return { tick: n.tick, ticks: n.ticks, midi: n.midi, note: i }; });
    if (end < total) timeline.push({ tick: end, ticks: total - end, midi: null, note: -1, filler: true });
    var perLine = opts.barsPerLine || 4;
    var lines = [
      'X:1',
      'T:' + String(title || 'Melodía').replace(/[\r\n]/g, ' '),
      'M:' + mi.meter,
      'L:1/16',
      'Q:1/4=' + (Number(model.tempo) || 100),
      'K:' + k.name,
    ];
    var body = '';
    var pieces = [];
    var chordIdx = 0;
    for (var bar = 0; bar < minBars; bar++) {
      var barStart = bar * mi.barTicks;
      var barEnd = barStart + mi.barTicks;
      var barAcc = {};
      var out = '';
      timeline.forEach(function (ev) {
        var s = Math.max(ev.tick, barStart);
        var e = Math.min(ev.tick + ev.ticks, barEnd);
        if (e <= s) return;
        // Trocea también en los cambios de acorde de silencios de relleno y en las partes del compás.
        var cuts = [s];
        if (ev.midi === null) {
          chords.forEach(function (c) { if (c.tick > s && c.tick < e) cuts.push(c.tick); });
          if (s !== barStart || e !== barEnd) {
            for (var b = barStart + mi.beatTicks; b < barEnd; b += mi.beatTicks) if (b > s && b < e && (b - barStart) % (mi.barTicks / 2) === 0) cuts.push(b);
          }
        }
        cuts.push(e);
        cuts.sort(function (a, b) { return a - b; });
        for (var c = 0; c < cuts.length - 1; c++) {
          var segS = cuts[c];
          var segE = cuts[c + 1];
          var parts = splitLength(segE - segS);
          var t = segS;
          parts.forEach(function (len, pi) {
            var label = '';
            while (chordIdx < chords.length && chords[chordIdx].tick < t + len - 1e-6) {
              if (!label) label = chordLabel(chords[chordIdx].name);
              chordIdx++;
            }
            if (out && t % mi.beatTicks === 0) out += ' ';
            if (label) out += '"' + label.replace(/"/g, '') + '"';
            if (ev.midi === null) out += 'z' + lengthStr(len);
            else {
              var last = t + len >= ev.tick + ev.ticks - 1e-6;
              out += pitchToken(ev.midi, k.fifths, barAcc, sig) + lengthStr(len) + (last ? '' : '-');
            }
            pieces.push({ note: ev.note, tick: t });
            t += len;
          });
        }
      });
      body += out + (bar === minBars - 1 ? ' |]' : ' | ');
      if ((bar + 1) % perLine === 0 && bar !== minBars - 1) body += '\n';
    }
    return { abc: lines.join('\n') + '\n' + body + '\n', pieces: pieces, bars: minBars, barTicks: mi.barTicks };
  }

  function noteName(midi) {
    if (midi === null || midi === undefined) return 'Silencio';
    return NAMES_ES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  return { parseKey: parseKey, meterInfo: meterInfo, withTicks: withTicks, totalTicks: totalTicks, chordsFromBars: chordsFromBars, toAbc: toAbc, spell: spell, noteName: noteName };
});
