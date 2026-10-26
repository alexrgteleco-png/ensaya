/* Generador de solos de Ensaya (versión 2).
 * Improvisa como lo haría un músico: piensa en frases con respiraciones, apunta a notas guía del acorde
 * (terceras, séptimas, novenas) en los cambios de acorde y las une con líneas de escala, cromatismos,
 * envolventes (enclosures), arpegios y pequeñas fórmulas del lenguaje de cada estilo.
 * Cada acorde usa su escala (dórica en m7, mixolidia o alterada en 7, lidia en maj7#11…).
 * Puede seguir el cifrado completo de la canción (varios acordes por compás) y parafrasear su melodía.
 * Genera varias versiones y se queda con la más musical según una puntuación.
 * La misma semilla y los mismos parámetros dan siempre el mismo solo.
 * Devuelve notación ABC (partitura y tablatura), eventos para el sonido y el acompañamiento del estilo.
 * Funciona en el navegador (window.SoloEngine) y en Node (pruebas). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SoloEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 2;
  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var LATIN = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  var ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7, 'G#': 8, 'D#': 9, 'A#': 10 };

  // Escalas para el modo «una escala para todo el solo» (rock, blues…) y para elegirla a mano en modo experto.
  var SCALES = {
    pentatonica_menor: { name: 'Pentatónica menor', parent: [0, 2, 3, 5, 7, 8, 10], degrees: [0, 2, 3, 4, 6], mode: 'm', minor: true },
    pentatonica_mayor: { name: 'Pentatónica mayor', parent: [0, 2, 4, 5, 7, 9, 11], degrees: [0, 1, 2, 4, 5], mode: '', minor: false },
    blues: { name: 'Blues', parent: [0, 2, 3, 5, 7, 8, 10], degrees: [0, 2, 3, 4, 6], blueNote: true, mode: 'm', minor: true },
    blues_mayor: { name: 'Blues mayor', parent: [0, 2, 4, 5, 7, 9, 11], degrees: [0, 1, 2, 4, 5], blueThird: true, mode: '', minor: false },
    mayor: { name: 'Mayor (jónica)', parent: [0, 2, 4, 5, 7, 9, 11], mode: '', minor: false },
    menor: { name: 'Menor natural (eólica)', parent: [0, 2, 3, 5, 7, 8, 10], mode: 'm', minor: true },
    dorica: { name: 'Dórica', parent: [0, 2, 3, 5, 7, 9, 10], mode: 'Dor', minor: true },
    mixolidia: { name: 'Mixolidia', parent: [0, 2, 4, 5, 7, 9, 10], mode: 'Mix', minor: false },
    frigia: { name: 'Frigia', parent: [0, 1, 3, 5, 7, 8, 10], mode: 'Phr', minor: true },
    frigia_dominante: { name: 'Frigia dominante (flamenco)', parent: [0, 1, 4, 5, 7, 8, 10], mode: 'Phr', minor: false },
    lidia: { name: 'Lidia', parent: [0, 2, 4, 6, 7, 9, 11], mode: 'Lyd', minor: false },
    menor_armonica: { name: 'Menor armónica', parent: [0, 2, 3, 5, 7, 8, 11], mode: 'm', minor: true },
    menor_melodica: { name: 'Menor melódica', parent: [0, 2, 3, 5, 7, 9, 11], mode: 'm', minor: true },
    bebop_dominante: { name: 'Bebop dominante', parent: [0, 2, 4, 5, 7, 9, 10], extra: 11, mode: 'Mix', minor: false },
    tonos: { name: 'Tonos enteros', parent: [0, 2, 4, 6, 8, 10], mode: '', minor: false, symmetric: true },
    disminuida: { name: 'Disminuida (semitono-tono)', parent: [0, 1, 3, 4, 6, 7, 9, 10], mode: '', minor: false, symmetric: true },
  };
  var MODE_OFFSET = { '': 0, m: -3, Dor: -2, Mix: -1, Phr: -4, Lyd: 1 };

  // Estilos. harmony: 'chord' = escala de cada acorde (jazz, bossa, pop); 'key' = una escala para todo (rock, metal…);
  // 'blues' = escala de blues con notas de cada acorde.
  // targets: peso de cada grado del acorde como nota de llegada (1, 3, 5, 7, 9, 11, 13).
  var STYLES = {
    bossa: {
      name: 'Bossa nova', harmony: 'chord', density: 4, variability: 35, rests: 40, swing: 0, chromatic: 15, ornaments: 10, repetition: 45, chordFollow: 85,
      phrase: [4, 9], gap: [2, 5], cells: 'bossa', targets: { 3: 5, 7: 3, 9: 5, 5: 2, 1: 1, 13: 3, 11: 1 }, ends: { 3: 4, 9: 4, 5: 2, 1: 1, 13: 2 }, licks: 0.12, endTicks: [6, 8, 12], comp: 'bossa', progression: 'bossa', feel: 'straight',
    },
    swing: {
      name: 'Jazz medium swing', harmony: 'chord', density: 6, variability: 40, rests: 25, swing: 62, chromatic: 40, ornaments: 10, repetition: 30, chordFollow: 90,
      phrase: [6, 14], gap: [1, 4], cells: 'swing', targets: { 3: 6, 7: 5, 9: 3, 5: 2, 1: 1, 13: 1 }, ends: { 3: 3, 5: 3, 9: 3, 1: 2, 13: 1 }, licks: 0.3, endTicks: [2, 4, 6], comp: 'swing', progression: 'jazz', feel: 'swing',
    },
    balada: {
      name: 'Balada', harmony: 'chord', density: 3, variability: 35, rests: 35, swing: 40, chromatic: 25, ornaments: 20, repetition: 40, chordFollow: 90,
      phrase: [4, 9], gap: [2, 4], cells: 'ballad', targets: { 3: 5, 7: 3, 9: 5, 5: 2, 1: 2, 13: 2 }, ends: { 3: 4, 9: 3, 5: 2, 1: 2 }, licks: 0.1, endTicks: [4, 8, 12], comp: 'ballad', progression: 'balada', feel: 'ballad',
    },
    bebop: {
      name: 'Bebop', harmony: 'chord', density: 8, variability: 45, rests: 15, swing: 58, chromatic: 60, ornaments: 5, repetition: 20, chordFollow: 95,
      phrase: [8, 16], gap: [1, 3], cells: 'bebop', targets: { 3: 6, 7: 5, 9: 3, 5: 2, 1: 1 }, ends: { 3: 3, 5: 3, 9: 2, 1: 2 }, licks: 0.45, endTicks: [2, 4], comp: 'swing', progression: 'jazz', feel: 'swing',
    },
    blues: {
      name: 'Blues', harmony: 'blues', density: 4, variability: 45, rests: 30, swing: 60, chromatic: 10, ornaments: 40, repetition: 55, chordFollow: 65,
      phrase: [3, 8], gap: [2, 5], cells: 'blues', targets: { 1: 3, 3: 3, 5: 3, 7: 3 }, ends: { 1: 4, 5: 3, 3: 2 }, licks: 0.15, endTicks: [4, 6, 8], comp: 'blues', progression: 'blues', feel: 'swing', bend: true, riff: true,
    },
    rock: {
      name: 'Rock', harmony: 'key', scaleMinor: 'pentatonica_menor', scaleMajor: 'pentatonica_mayor', density: 5, variability: 40, rests: 20, swing: 0, chromatic: 5, ornaments: 25, repetition: 45, chordFollow: 70,
      phrase: [4, 10], gap: [1, 4], cells: 'rock', targets: { 1: 4, 3: 2, 5: 4, 7: 1 }, ends: { 1: 4, 5: 3, 3: 1 }, licks: 0, endTicks: [4, 6, 8], comp: 'rock', feel: 'straight', bend: true, accents: true, riff: true,
    },
    funk: {
      name: 'Funk', harmony: 'key', scaleMinor: 'dorica', scaleMajor: 'mixolidia', density: 6, variability: 35, rests: 35, swing: 10, chromatic: 10, ornaments: 10, repetition: 65, chordFollow: 70,
      phrase: [2, 6], gap: [1, 3], cells: 'funk', targets: { 1: 4, 3: 2, 5: 3, 7: 3 }, ends: { 1: 3, 7: 2, 5: 2 }, licks: 0, endTicks: [1, 2, 3], comp: 'funk', feel: 'straight', staccato: true, riff: true,
    },
    pop: {
      name: 'Pop', harmony: 'chord', density: 4, variability: 30, rests: 25, swing: 0, chromatic: 0, ornaments: 15, repetition: 60, chordFollow: 80,
      phrase: [4, 8], gap: [2, 4], cells: 'pop', targets: { 1: 3, 3: 4, 5: 3, 9: 1 }, ends: { 1: 3, 3: 3, 5: 2 }, licks: 0, endTicks: [4, 6, 8], comp: 'pop', progression: 'pop', feel: 'straight', plain: true,
    },
    flamenco: {
      name: 'Flamenco', harmony: 'key', scaleMinor: 'frigia_dominante', scaleMajor: 'frigia_dominante', density: 7, variability: 35, rests: 15, swing: 0, chromatic: 5, ornaments: 35, repetition: 40, chordFollow: 60,
      phrase: [4, 8], gap: [1, 3], cells: 'flamenco', targets: { 1: 4, 3: 3, 5: 2 }, ends: { 1: 4, 3: 2 }, licks: 0, endTicks: [4, 8], comp: 'flamenco', progression: 'andaluza', feel: 'straight', descending: true, onRoot: true,
    },
    metal: {
      name: 'Metal', harmony: 'key', scaleMinor: 'menor_armonica', scaleMajor: 'mixolidia', density: 9, variability: 50, rests: 8, swing: 0, chromatic: 10, ornaments: 15, repetition: 35, chordFollow: 60,
      phrase: [6, 14], gap: [1, 2], cells: 'metal', targets: { 1: 4, 5: 3, 3: 2 }, ends: { 1: 4, 5: 3 }, licks: 0, endTicks: [4, 8], comp: 'metal', feel: 'straight', accents: true,
    },
  };

  // Estilo según el nombre de iReal Pro o del cifrado ({style: Bossa Nova}).
  function styleFromName(name) {
    var s = String(name || '').toLowerCase();
    if (/bossa|samba|latin|brazil|bolero/.test(s)) return 'bossa';
    if (/ballad|balada|slow/.test(s)) return 'balada';
    if (/bebop|be-bop|up tempo|uptempo|fast/.test(s)) return 'bebop';
    if (/blues|shuffle/.test(s)) return 'blues';
    if (/swing|jazz|waltz|vals|gypsy|manouche/.test(s)) return 'swing';
    if (/funk|soul|r&b/.test(s)) return 'funk';
    if (/flamenco|rumba|bulería|buleria/.test(s)) return 'flamenco';
    if (/metal/.test(s)) return 'metal';
    if (/rock|punk/.test(s)) return 'rock';
    if (/pop|folk|country|reggae|even/.test(s)) return 'pop';
    return '';
  }

  var PROGRESSIONS = {
    blues: { name: 'Blues de 12 compases', degrees: ['I7', 'IV7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] },
    jazz: { name: 'ii–V–I', degrees: ['ii7', 'V7', 'Imaj7', 'Imaj7'] },
    bossa: { name: 'Bossa (I–II7–ii–V)', degrees: ['Imaj7', 'Imaj7', 'II7', 'II7', 'ii7', 'V7', 'Imaj7', 'V7'] },
    balada: { name: 'Balada (I–vi–ii–V)', degrees: ['Imaj7', 'vi7', 'ii7', 'V7'] },
    andaluza: { name: 'Cadencia andaluza', degrees: ['i', 'bVII', 'bVI', 'V'] },
    pop: { name: 'I–V–vi–IV', degrees: ['I', 'V', 'vi', 'IV'] },
    menor: { name: 'i–VI–III–VII', degrees: ['i', 'bVI', 'bIII', 'bVII'] },
    menor_jazz: { name: 'ii–V–i menor', degrees: ['ii7b5', 'V7b9', 'i7', 'i7'] },
    modal: { name: 'Un acorde (modal)', degrees: ['i'] },
  };

  // Grados de los acordes para elegir notas de llegada.
  var DEGREE_IV = { 1: 0, 9: 2, 11: 5, 13: 9 };

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
    if (total <= 0) return items.length ? items[0][0] : undefined;
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
  function pcOf(m) {
    return ((m % 12) + 12) % 12;
  }
  function between(rng, range) {
    return range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
  }

  function rootPc(name) {
    var m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b♯♭]?)/.exec(String(name || '').trim());
    if (!m) return null;
    var letter = LATIN[m[1]] || m[1];
    var pc = LETTER_PC[letter];
    var acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return { pc: (pc + acc + 12) % 12, letter: letter, acc: acc, rest: String(name).trim().slice(m[0].length) };
  }

  // Tonalidad "Bm", "F#", "Ebm", "La menor"… → { root, minor, name }
  function parseKey(key) {
    var r = rootPc(key) || rootPc('C');
    var rest = r.rest.trim();
    var minor = /^(m(?!aj)|-|min|menor)/i.test(rest);
    var name = r.letter + (r.acc === 1 ? '#' : r.acc === -1 ? 'b' : '');
    return { root: r, minor: minor, name: name + (minor ? 'm' : '') };
  }

  // ---------- Acordes ----------
  // Interpreta cualquier cifrado (Bm-7, F#7b9, D7sus, Gmaj7, C^7, Fm7b5, Bb7#11, A7alt…)
  // y decide sus notas, las notas guía, las tensiones y su escala.
  function parseChord(name, ctx) {
    var r = rootPc(name);
    if (!r) return null;
    var full = String(name).trim();
    var q = r.rest.split('/')[0].replace(/[()]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
    q = q.replace(/^m-/, 'm').replace(/^-/, 'm').replace(/^min(?!or)/, 'm').replace(/^mi(?!n)/, 'm');
    q = q.replace(/^(m?)(\^|Δ|M)(?=7|9|11|13|$)/, '$1maj').replace(/^h7?|^ø7?/, 'm7b5').replace(/^°|^o(?!m)/, 'dim');
    var kind;
    if (/^(m7b5)/.test(q)) kind = 'hdim';
    else if (/^dim/.test(q)) kind = 'dim';
    else if (/^m(maj|M|\^)/.test(q)) kind = 'minmaj';
    else if (/^maj/.test(q)) kind = 'maj';
    else if (/^m/.test(q)) kind = 'min';
    else if (/^(aug|\+)/.test(q) && !/7|9/.test(q)) kind = 'aug';
    else if (/^maj/.test(q)) kind = 'maj';
    else if (/^(7|9|11|13)/.test(q) || /^(aug|\+)7/.test(q) || /^7?alt/.test(q)) kind = 'dom';
    else if (/^sus/.test(q) && /7|9|13/.test(q)) kind = 'dom';
    else if (/^6/.test(q) || q === '' || /^add|^2|^5/.test(q)) kind = 'maj';
    else if (/^sus/.test(q)) kind = 'sus';
    else kind = 'maj';
    var sus = /sus/.test(q);
    var has7 = /7|9|11|13/.test(q);
    var six = /6/.test(q) && !/b6|#6/.test(q);
    var alt = /alt/.test(q);
    var b9 = /b9/.test(q);
    var s9 = /#9/.test(q);
    var s11 = /#11|b5/.test(q) && kind !== 'hdim';
    var b13 = /b13|#5|\+/.test(q) && kind === 'dom';
    var tones;
    var scale;
    var key = ctx && ctx.key;
    var deg = key ? (r.pc - key.root.pc + 12) % 12 : 0;
    if (kind === 'maj') {
      tones = [0, sus ? 5 : 4, 7, has7 ? 11 : six ? 9 : 11];
      if (!has7 && !six) tones = [0, sus ? 5 : 4, 7];
      // IV de la tonalidad mayor o con #11: lidia (suena más abierta).
      scale = s11 || (key && !key.minor && deg === 5) || (key && key.minor && (deg === 8 || deg === 3) && has7) ? [0, 2, 4, 6, 7, 9, 11] : [0, 2, 4, 5, 7, 9, 11];
    } else if (kind === 'dom') {
      tones = [0, sus ? 5 : 4, 7, 10];
      var nextMinor = ctx && ctx.next && ctx.next.kind && (ctx.next.kind === 'min' || ctx.next.kind === 'minmaj' || ctx.next.kind === 'hdim') && pcOf(ctx.next.root - r.pc) === 5;
      // V7 de una tonalidad menor: también con b9 y b13.
      if (key && key.minor && deg === 7) nextMinor = true;
      if (sus) scale = [0, 2, 5, 7, 9, 10];
      else if (alt || (s9 && b9)) scale = [0, 1, 3, 4, 6, 8, 10];
      else if (b13 && !b9 && !s9) scale = [0, 2, 4, 6, 8, 10];
      else if (s11 && !b9) scale = [0, 2, 4, 6, 7, 9, 10];
      else if (b9 && !s9 && /13/.test(q)) scale = [0, 1, 3, 4, 6, 7, 9, 10];
      else if (b9 || s9 || nextMinor) scale = [0, 1, 4, 5, 7, 8, 10];
      else scale = [0, 2, 4, 5, 7, 9, 10];
      if (/#5|\+|aug/.test(q)) tones = [0, 4, 8, 10];
    } else if (kind === 'min') {
      tones = [0, 3, 7, has7 ? 10 : six ? 9 : 10];
      if (!has7 && !six) tones = [0, 3, 7];
      if (six) scale = [0, 2, 3, 5, 7, 9, 11];
      else if (key && !key.minor && deg === 4) scale = [0, 1, 3, 5, 7, 8, 10];
      else if (key && !key.minor && deg === 9) scale = [0, 2, 3, 5, 7, 8, 10];
      else scale = [0, 2, 3, 5, 7, 9, 10];
    } else if (kind === 'minmaj') {
      tones = [0, 3, 7, 11];
      scale = [0, 2, 3, 5, 7, 9, 11];
    } else if (kind === 'hdim') {
      tones = [0, 3, 6, 10];
      scale = [0, 2, 3, 5, 6, 8, 10];
    } else if (kind === 'dim') {
      tones = [0, 3, 6, 9];
      scale = [0, 2, 3, 5, 6, 8, 9, 11];
    } else if (kind === 'aug') {
      tones = [0, 4, 8];
      scale = [0, 2, 4, 6, 8, 10];
    } else {
      tones = [0, 5, 7];
      scale = [0, 2, 5, 7, 9, 10];
    }
    // Grados como intervalos: 3 = tercera (o cuarta si es sus), 5, 7, y tensiones disponibles en la escala.
    var degrees = { 1: 0, 3: tones[1], 5: tones[2] };
    if (tones.length > 3) degrees[7] = tones[3];
    [9, 11, 13].forEach(function (d) {
      var iv = DEGREE_IV[d];
      var alts = d === 9 ? [2, 1, 3] : d === 11 ? [5, 6] : [9, 8];
      for (var k = 0; k < alts.length; k++) {
        if (scale.indexOf(alts[k]) >= 0) {
          iv = alts[k];
          // 11 natural sobre acordes mayores o de dominante (no sus) es nota a evitar.
          if (d === 11 && iv === 5 && (kind === 'maj' || kind === 'dom') && !sus) iv = null;
          if (d === 13 && iv === 8 && kind === 'min') iv = null;
          if (d === 9 && iv === 1 && kind !== 'dom') iv = null;
          degrees[d] = iv;
          return;
        }
      }
    });
    var avoid = [];
    if ((kind === 'maj' || kind === 'dom') && !sus) avoid.push(5);
    if (kind === 'min' && scale.indexOf(8) >= 0) avoid.push(8);
    if (kind === 'hdim') avoid.push(1);
    var bassPc = null;
    var slash = r.rest.split('/')[1];
    if (slash) {
      var br = rootPc(slash);
      if (br) bassPc = br.pc;
    }
    return {
      name: full,
      root: r.pc,
      letter: r.letter,
      acc: r.acc,
      kind: kind,
      bass: bassPc === null ? r.pc : bassPc,
      tones: tones.map(function (x) { return (r.pc + x) % 12; }),
      intervals: tones,
      degrees: degrees,
      scale: scale,
      scalePcs: scale.map(function (x) { return (r.pc + x) % 12; }),
      avoid: avoid.map(function (x) { return (r.pc + x) % 12; }),
    };
  }

  function parseProgression(text) {
    return String(text || '')
      .split(/[\s,|]+/)
      .map(function (t) { return t.replace(/^\[|\]$/g, '').trim(); })
      .filter(function (t) { return t && t !== '%' && t !== '-' && t !== '–'; })
      .filter(function (t) { return parseChord(t); })
      .slice(0, 64);
  }

  // Grados romanos → acordes en la tonalidad.
  var ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
  function noteName(pc, preferFlats) {
    var sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    return (preferFlats ? flats : sharps)[pcOf(pc)];
  }
  function keyPrefersFlats(k) {
    var name = k.root.letter + (k.root.acc === 1 ? '#' : k.root.acc === -1 ? 'b' : '');
    var f = MAJOR_FIFTHS[name];
    if (f === undefined) f = 0;
    if (k.minor) f -= 3;
    return f < 0;
  }
  function progressionFor(key, presetId) {
    var preset = PROGRESSIONS[presetId];
    if (!preset) return '';
    var k = parseKey(key);
    var flats = keyPrefersFlats(k) || /b/.test(key);
    return preset.degrees
      .map(function (d) {
        var m = /^(b?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(d);
        var deg = ROMAN[m[2].toUpperCase()] - (m[1] ? 1 : 0);
        var minor = m[2] === m[2].toLowerCase();
        var suffix = m[3] || '';
        return noteName(k.root.pc + deg, flats) + (minor && !/^m/.test(suffix) ? 'm' : '') + suffix;
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
    if (sc.symmetric) {
      notes = sc.parent.map(function (iv, i) {
        var pc = (r.pc + iv) % 12;
        var nm = noteName(pc, r.acc < 0);
        return { pc: pc, letter: nm[0], acc: nm[1] === '#' ? 1 : nm[1] === 'b' ? -1 : 0, degree: i };
      });
    }
    var used = sc.degrees ? sc.degrees.map(function (d) { return notes[d]; }) : notes.slice();
    if (sc.blueNote) {
      var fifth = notes[4];
      used.push({ pc: (fifth.pc + 11) % 12, letter: fifth.letter, acc: fifth.acc - 1, degree: 4, blue: true });
    }
    if (sc.blueThird) {
      var third = notes[2];
      used.push({ pc: (third.pc + 11) % 12, letter: third.letter, acc: third.acc - 1, degree: 2, blue: true });
    }
    if (sc.extra !== undefined) {
      var seventh = notes[6];
      used.push({ pc: (r.pc + sc.extra) % 12, letter: seventh.letter, acc: seventh.acc + 1, degree: 6 });
    }
    used.sort(function (a, b) { return ((a.pc - r.pc + 12) % 12) - ((b.pc - r.pc + 12) % 12); });
    return { root: r, notes: used, all: notes, scale: sc };
  }

  // Ortografía de la escala de un acorde.
  function chordSpelling(ch) {
    var li = LETTERS.indexOf(ch.letter);
    var map = {};
    if (ch.scale.length === 7) {
      ch.scale.forEach(function (iv, i) {
        var letter = LETTERS[(li + i) % 7];
        var pc = (ch.root + iv) % 12;
        var acc = ((pc - LETTER_PC[letter] + 18) % 12) - 6;
        if (Math.abs(acc) <= 1) map[pc] = { letter: letter, acc: acc };
      });
    }
    return map;
  }

  function keyFifths(k) {
    var name = k.root.letter + (k.root.acc === 1 ? '#' : k.root.acc === -1 ? 'b' : '');
    var base = MAJOR_FIFTHS[name];
    if (base === undefined) base = 0;
    return base + (k.minor ? -3 : 0);
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
  // Celdas: duraciones en semicorcheas (L:1/16). rest: posiciones que son silencio. beats: pulsos que ocupa.
  var CELLS4 = {
    q: { notes: [4] }, e: { notes: [2, 2] }, s: { notes: [1, 1, 1, 1] }, de: { notes: [3, 1] }, sync: { notes: [1, 2, 1] }, snap: { notes: [1, 3] },
    es: { notes: [2, 1, 1] }, se: { notes: [1, 1, 2] },
    trip: { notes: [2, 2, 2], tuplet: 3 }, sext: { notes: [1, 1, 1, 1, 1, 1], tuplet: 6 },
    off: { notes: [2, 2], rest: [0] },
    h: { notes: [8], beats: 2 }, dh: { notes: [12], beats: 3 },
    ant: { notes: [2, 4, 2], beats: 2 }, tres: { notes: [3, 3, 2], beats: 2 }, dq: { notes: [6, 2], beats: 2 }, eq: { notes: [2, 2, 4], beats: 2 }, qe: { notes: [4, 2, 2], beats: 2 },
    tq: { notes: [4, 4, 4], tuplet: 3, beats: 2 },
  };
  var CELLS6 = {
    q: { notes: [6] }, e: { notes: [2, 2, 2] }, s: { notes: [1, 1, 1, 1, 1, 1] }, de: { notes: [4, 2] }, sync: { notes: [2, 4] }, snap: { notes: [1, 1, 2, 2] },
    trip: { notes: [2, 1, 1, 2] }, sext: { notes: [1, 1, 1, 1, 2] }, off: { notes: [2, 2, 2], rest: [0] }, h: { notes: [12], beats: 2 },
  };
  var VOCAB = {
    bossa: { q: 3, ant: 4, tres: 3, dq: 3, eq: 2, qe: 2, e: 2.5, h: 1.5, off: 1.5, de: 0.5, sync: 0.4, s: 0.2 },
    swing: { e: 8, q: 2.5, trip: 1.1, off: 1.6, h: 0.6, ant: 0.6 },
    bebop: { e: 10, trip: 2, q: 0.8, off: 1.2, s: 0.4, es: 0.2 },
    ballad: { q: 3, h: 2.5, e: 2.5, dq: 2, dh: 0.6, trip: 1, tq: 0.8, s: 0.8, sext: 0.3, es: 0.4, se: 0.4, ant: 1 },
    blues: { trip: 3, q: 3, e: 3, off: 1.5, h: 2, dq: 1, ant: 1 },
    rock: { e: 4, q: 2, s: 2, de: 2, sync: 2, h: 1, trip: 1, off: 1 },
    funk: { s: 4, sync: 5, e: 2, snap: 2, off: 2, es: 1, se: 1 },
    pop: { e: 4, q: 3, sync: 1.5, ant: 2.5, de: 1, h: 1.5, eq: 1.5, qe: 1.5 },
    flamenco: { s: 4, sext: 3, trip: 2, e: 2, q: 1 },
    metal: { s: 5, sext: 4, e: 1, trip: 1 },
  };

  function cellsFor(beatTicks) {
    return beatTicks === 6 ? CELLS6 : CELLS4;
  }

  // ---------- Parámetros ----------
  var DEFAULTS = {
    key: 'A', scale: 'auto', style: 'rock', tempo: 100, meter: '4/4', bars: 8, choruses: 1,
    density: 5, variability: 40, rests: 20, swing: 0, chromatic: 5, ornaments: 25, repetition: 45,
    register: 'medio', range: 2, chordFollow: 75, progression: '', endOnTonic: true, seed: 1, paraphrase: 0, useSong: false,
  };

  // Niveles del modo principiante: valores para cada estilo.
  var LEVELS = {
    facil: { name: 'Fácil', density: -2, chromatic: -100, ornaments: -100, rests: 15, variability: -15, range: 1, tuplets: false },
    medio: { name: 'Medio', density: 0, chromatic: 0, ornaments: 0, rests: 0, variability: 0, range: 2, tuplets: true },
    dificil: { name: 'Difícil', density: 2, chromatic: 20, ornaments: 5, rests: -10, variability: 10, range: 2, tuplets: true },
  };

  function paramsFor(style, level) {
    var st = STYLES[style] || STYLES.rock;
    var lv = LEVELS[level] || LEVELS.medio;
    return {
      style: STYLES[style] ? style : 'rock',
      density: clamp(st.density + lv.density, 1, 10),
      variability: clamp(st.variability + lv.variability, 0, 100),
      rests: clamp(st.rests + lv.rests, 0, 70),
      swing: st.swing,
      chromatic: clamp(st.chromatic + lv.chromatic, 0, 60),
      ornaments: clamp(st.ornaments + lv.ornaments, 0, 80),
      repetition: st.repetition,
      chordFollow: st.chordFollow,
      range: lv.range,
      register: 'medio',
      scale: 'auto',
    };
  }

  // «Inspírame»: combinaciones probadas para cada estilo con un toque de azar.
  var FLAVORS = {
    bossa: [['Lírica, con aire', { density: 3, rests: 45, chromatic: 10, variability: 30 }], ['Cantable', { density: 4, rests: 35, chromatic: 15, repetition: 55 }], ['Con más movimiento', { density: 5, rests: 30, chromatic: 25, variability: 40 }]],
    swing: [['Melódica', { density: 5, rests: 30, chromatic: 30 }], ['Swing clásico', { density: 6, rests: 22, chromatic: 40 }], ['Con fuego', { density: 7, rests: 15, chromatic: 50, variability: 50 }]],
    balada: [['Íntima', { density: 2, rests: 40, chromatic: 15, ornaments: 25 }], ['Expresiva', { density: 3, rests: 30, chromatic: 25, ornaments: 20 }], ['Con adornos rápidos', { density: 4, rests: 30, chromatic: 35, ornaments: 25 }]],
    bebop: [['Bebop fluido', { density: 8, rests: 15, chromatic: 55 }], ['Bebop con aire', { density: 7, rests: 25, chromatic: 50 }]],
    blues: [['Blues con respiraciones', { density: 3, rests: 40, ornaments: 45 }], ['Shuffle con garra', { density: 5, rests: 25, ornaments: 40, repetition: 60 }]],
    rock: [['Rock melódico', { density: 4, rests: 25, ornaments: 25 }], ['Rock con riffs', { density: 6, rests: 20, repetition: 60 }]],
    funk: [['Funk con espacio', { density: 5, rests: 40 }], ['Funk apretado', { density: 7, rests: 30 }]],
    pop: [['Pop cantable', { density: 3, rests: 30, repetition: 65 }], ['Pop con ritmo', { density: 5, rests: 25, repetition: 55 }]],
    flamenco: [['Falseta tranquila', { density: 5, rests: 20 }], ['Picado', { density: 8, rests: 10 }]],
    metal: [['Shred', { density: 9, rests: 5 }], ['Metal melódico', { density: 6, rests: 15 }]],
  };

  function inspire(style, seed) {
    var rng = mulberry32(((Number(seed) >>> 0) || 1) * 2246822519 + 7);
    var st = STYLES[style] ? style : 'swing';
    var list = FLAVORS[st] || FLAVORS.swing;
    var pick = list[Math.floor(rng() * list.length)];
    var p = paramsFor(st, 'medio');
    Object.keys(pick[1]).forEach(function (k) { p[k] = pick[1][k]; });
    ['density', 'rests', 'chromatic', 'variability', 'repetition'].forEach(function (k) {
      var jitter = k === 'density' ? Math.round((rng() - 0.5) * 2) : Math.round((rng() - 0.5) * 12);
      p[k] = clamp(p[k] + jitter, k === 'density' ? 1 : 0, k === 'density' ? 10 : k === 'rests' ? 70 : 100);
    });
    p.paraphrase = rng() < 0.4 ? 35 : 0;
    p.flavor = pick[0];
    return p;
  }

  function normalize(p) {
    var o = {};
    for (var k in DEFAULTS) o[k] = p && p[k] !== undefined && p[k] !== '' && p[k] !== null ? p[k] : DEFAULTS[k];
    o.tempo = clamp(Number(o.tempo) || 100, 40, 300);
    o.bars = clamp(Math.round(Number(o.bars) || 8), 1, 64);
    o.choruses = clamp(Math.round(Number(o.choruses) || 1), 1, 4);
    ['density', 'variability', 'rests', 'swing', 'chromatic', 'ornaments', 'repetition', 'chordFollow', 'paraphrase'].forEach(function (k) {
      o[k] = clamp(Number(o[k]) || 0, k === 'density' ? 1 : 0, k === 'density' ? 10 : 100);
    });
    o.range = clamp(Math.round(Number(o.range) || 2), 1, 3);
    if (o.scale !== 'auto' && !SCALES[o.scale]) o.scale = 'auto';
    if (o.style === 'jazz') o.style = 'swing';
    if (!STYLES[o.style]) o.style = DEFAULTS.style;
    if (!/^([2-5]\/4|6\/8|12\/8)$/.test(o.meter)) o.meter = '4/4';
    if (!rootPc(o.key)) o.key = 'A';
    if (['grave', 'medio', 'agudo'].indexOf(o.register) < 0) o.register = 'medio';
    o.seed = (Number(o.seed) >>> 0) || 1;
    o.endOnTonic = o.endOnTonic !== false && o.endOnTonic !== 'false';
    o.useSong = o.useSong === true || o.useSong === 'true';
    o.tuplets = !(p && (p.tuplets === false || p.tuplets === 'false'));
    if (p && Array.isArray(p.form)) o.form = p.form;
    if (p && Array.isArray(p.theme)) o.theme = p.theme;
    if (p && p.level) o.level = p.level;
    return o;
  }

  // ---------- Generación ----------
  // layout.barsPerLine: compases por línea en la partitura (solo afecta al aspecto).
  // layout.candidates: cuántas versiones se comparan (por defecto 6).
  function generate(params, layout) {
    var p = normalize(params);
    var style = STYLES[p.style];
    var k = parseKey(p.key);
    // Si la escala elegida es de modo menor y la tonalidad no lo dice, se entiende como menor (compatibilidad).
    if (p.scale !== 'auto' && SCALES[p.scale].minor && !/m(?!aj)|-/.test(String(p.key).slice(1))) k = parseKey(k.root.letter + (k.root.acc === 1 ? '#' : k.root.acc === -1 ? 'b' : '') + 'm');

    // Compás
    var mt = p.meter.split('/').map(Number);
    var compound = mt[1] === 8 && mt[0] % 3 === 0;
    var beatTicks = compound ? 6 : 4;
    var beatsPerBar = compound ? mt[0] / 3 : mt[0];
    var barTicks = beatsPerBar * beatTicks;

    // Forma: cifrado de la canción (varios acordes por compás) o progresión (uno por compás).
    var formBars = buildForm(p, k, style);
    var totalBars = formBars.length;
    var segments = segmentsFor(formBars, barTicks, beatTicks, k);

    // Registro (MIDI): grave E2, medio A3, agudo E4.
    var low = { grave: 40, medio: 59, agudo: 66 }[p.register] || 59;
    var high = low + 12 * p.range + 2;

    // Escala para todo el solo (rock, blues, metal…) o escala de cada acorde.
    var mode = p.scale !== 'auto' ? 'key' : style.harmony;
    var keyScaleId = p.scale !== 'auto' ? p.scale : mode === 'blues' ? 'blues' : k.minor ? style.scaleMinor : style.scaleMajor;
    var keyScale = keyScaleId ? spellScale(k.root.letter + (k.root.acc === 1 ? '#' : k.root.acc === -1 ? 'b' : ''), keyScaleId) : null;

    var ctx = {
      p: p, style: style, key: k, mode: mode, keyScale: keyScale, segments: segments, low: low, high: high,
      beatTicks: beatTicks, beatsPerBar: beatsPerBar, barTicks: barTicks, totalTicks: totalBars * barTicks, compound: compound,
      cells: cellsFor(beatTicks),
    };

    var count = layout && layout.candidates ? clamp(layout.candidates, 1, 16) : 6;
    var best = null;
    for (var c = 0; c < count; c++) {
      var rng = mulberry32((p.seed * 2654435761 + c * 40503 + VERSION * 97) >>> 0);
      var notes = improvise(ctx, rng);
      var score = scoreSolo(ctx, notes);
      if (!best || score > best.score) best = { notes: notes, score: score, index: c };
    }

    var bars = toBars(ctx, best.notes, formBars);
    var fifths = keyFifths(k);
    var perLine = layout && layout.barsPerLine ? clamp(Math.round(layout.barsPerLine), 1, 8) : (p.density >= 7 || barTicks >= 24 ? 2 : 4);
    var abc = toAbc(p, k, bars, { fifths: fifths, barTicks: barTicks, beatTicks: beatTicks, perLine: perLine, style: style, keyScaleId: p.scale !== 'auto' ? keyScaleId : null });
    var events = toEvents(p, bars, { barTicks: barTicks, beatTicks: beatTicks, segments: segments });
    events.band = accompaniment(ctx, segments, events);
    return {
      params: p, abc: abc, events: events, bars: bars,
      chords: bars.map(function (x) { return x.chord.name; }),
      barTicks: barTicks, beatTicks: beatTicks, beatsPerBar: beatsPerBar, version: VERSION, score: Math.round(best.score * 100) / 100,
    };
  }

  function keyChordName(k, style) {
    var name = k.root.letter + (k.root.acc === 1 ? '#' : k.root.acc === -1 ? 'b' : '');
    if (style.harmony === 'chord' && !style.plain) return name + (k.minor ? 'm6' : 'maj7');
    return name + (k.minor ? 'm' : '');
  }

  function buildForm(p, k, style) {
    var bars = [];
    if (p.form && p.form.length) {
      var form = p.form.slice(0, 128).map(function (b) { return (Array.isArray(b) ? b : [b]).filter(function (c) { return parseChord(c); }).slice(0, 4); }).filter(function (b) { return b.length; });
      for (var c = 0; c < p.choruses; c++) form.forEach(function (b) { bars.push(b.slice()); });
      // Si la forma acaba en un turnaround, un compás más para resolver en la tónica.
      if (p.endOnTonic && bars.length) {
        var last = parseChord(bars[bars.length - 1][bars[bars.length - 1].length - 1]);
        if (!last || last.root !== k.root.pc || last.kind === 'dom') bars.push([keyChordName(k, style)]);
      }
    }
    if (!bars.length) {
      var prog = parseProgression(p.progression);
      if (!prog.length) {
        var preset = style.progression || (k.minor ? 'menor' : 'pop');
        if (k.minor && preset === 'jazz') preset = 'menor_jazz';
        if (k.minor && (preset === 'bossa' || preset === 'balada' || preset === 'pop')) preset = preset === 'pop' ? 'menor' : 'menor_jazz';
        prog = parseProgression(progressionFor(k.name, preset));
      }
      if (!prog.length) prog = [keyChordName(k, style)];
      for (var b = 0; b < p.bars; b++) bars.push([prog[b % prog.length]]);
    }
    return bars.slice(0, 160);
  }

  // Acordes en el tiempo: dos acordes en 4/4 = dos pulsos cada uno.
  function segmentsFor(formBars, barTicks, beatTicks, k) {
    var segs = [];
    var beats = barTicks / beatTicks;
    formBars.forEach(function (chords, bi) {
      var n = Math.min(chords.length, beats);
      var split = [];
      if (n === 1) split = [beats];
      else if (n === 2) split = beats % 2 === 0 ? [beats / 2, beats / 2] : [Math.ceil(beats / 2), Math.floor(beats / 2)];
      else {
        var each = Math.floor(beats / n);
        for (var i = 0; i < n; i++) split.push(each);
        split[0] += beats - each * n;
      }
      var t = bi * barTicks;
      for (var j = 0; j < n; j++) {
        segs.push({ name: chords[j], start: t, end: t + split[j] * beatTicks, bar: bi });
        t += split[j] * beatTicks;
      }
    });
    segs.forEach(function (s, i) {
      var next = segs[i + 1] ? parseChord(segs[i + 1].name, { key: k }) : null;
      s.chord = parseChord(s.name, { key: k, next: next });
      s.spelling = chordSpelling(s.chord);
    });
    return segs;
  }

  function segmentAt(ctx, tick) {
    var segs = ctx.segments;
    var lo = 0;
    var hi = segs.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= tick + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  // Notas permitidas (clases de altura) en un momento: escala del acorde o escala del solo.
  function scalePcsAt(ctx, seg) {
    if (ctx.mode === 'chord') return seg.chord.scalePcs;
    var ks = ctx.keyScale.notes.map(function (n) { return n.pc; });
    if (ctx.mode === 'blues') {
      // Blues: la escala de blues más la tercera mayor del acorde (el «curl» de b3 a 3).
      var third = (seg.chord.root + 4) % 12;
      if (seg.chord.kind === 'dom' || seg.chord.kind === 'maj') {
        if (ks.indexOf(third) < 0) ks = ks.concat([third]);
      }
    }
    return ks;
  }

  function pitchesIn(ctx, pcs) {
    var out = [];
    for (var m = ctx.low; m <= ctx.high; m++) if (pcs.indexOf(m % 12) >= 0) out.push(m);
    return out;
  }

  // Pesos de llegada para un acorde según el estilo.
  function targetPitches(ctx, seg, weightsByDegree) {
    var ch = seg.chord;
    var allowed = scalePcsAt(ctx, seg);
    var out = [];
    Object.keys(weightsByDegree).forEach(function (d) {
      var iv = ch.degrees[d];
      if (iv === undefined || iv === null) return;
      var pc = (ch.root + iv) % 12;
      if (ctx.mode !== 'chord' && allowed.indexOf(pc) < 0) return;
      if (ch.avoid.indexOf(pc) >= 0) return;
      out.push({ pc: pc, w: weightsByDegree[d], degree: Number(d) });
    });
    if (!out.length) out.push({ pc: ch.root, w: 1, degree: 1 });
    return out;
  }

  // ---------- Ritmo de las frases ----------
  function planRhythm(ctx, rng) {
    var p = ctx.p;
    var style = ctx.style;
    var bt = ctx.beatTicks;
    var totalBeats = ctx.totalTicks / bt;
    var cells = ctx.cells;
    var vocab = VOCAB[style.cells] || VOCAB.rock;
    var target = 0.4 + (p.density - 1) * 0.4; // notas por pulso
    var phraseScale = 0.7 + p.density / 15;
    var gapScale = 0.2 + p.rests / 55;
    var out = [];
    var beat = 0;
    var phrase = 0;
    // Final: la última nota cae en el primer pulso del último compás.
    var finalBeat = p.endOnTonic ? totalBeats - ctx.beatsPerBar : totalBeats;
    var previous = null;

    function chooseCell(beatsLeft, first, beatsLeftInBar) {
      var items = [];
      Object.keys(vocab).forEach(function (id) {
        var c = cells[id];
        if (!c) return;
        var beats = c.beats || 1;
        if (beats > beatsLeft) return;
        if (c.tuplet && (!p.tuplets || beats > beatsLeftInBar)) return;
        if (id === 'off' && !first) {
          items.push([id, vocab[id] * 0.25]);
          return;
        }
        var d = (c.notes.length - (c.rest ? c.rest.length : 0)) / beats;
        var fit = Math.exp(-Math.pow(Math.log((d + 0.2) / (target + 0.2)), 2) * 2.2);
        items.push([id, vocab[id] * fit * (first && id === 'off' ? 3 : 1)]);
      });
      if (!items.length) return beatsLeft >= 1 ? 'q' : null;
      return weighted(rng, items);
    }

    // Al repetir un ritmo en otro sitio, los tresillos no pueden quedar partidos por la barra de compás.
    function tupletsFit(prevPhrase, atBeat) {
      var bar = ctx.barTicks;
      return prevPhrase.cells.every(function (n) {
        if (!n.tuplet || n.tupletIndex !== 0) return true;
        var start = atBeat * bt + n.offset;
        var len = n.ticks * n.tupletSize;
        return Math.floor(start / bar + 1e-9) === Math.floor((start + len - 1e-6) / bar);
      });
    }

    function emitRest(fromBeat, toBeat) {
      for (var b = fromBeat; b < toBeat; b++) out.push({ tick: b * bt, ticks: bt, rest: true, phrase: -1 });
    }

    // A veces el solo empieza con un pulso de silencio (como al entrar después del tema).
    if (rng() < 0.3 && finalBeat > 4) {
      emitRest(0, 1);
      beat = 1;
    }
    while (beat < finalBeat) {
      var len = Math.max(2, Math.round(between(rng, style.phrase) * phraseScale));
      var end = Math.min(finalBeat, beat + len);
      if (finalBeat - end < 2) end = finalBeat;
      var reuse = previous && rng() < p.repetition / 100 && end - beat >= previous.beats && !(p.endOnTonic && end === finalBeat && previous.beats > end - beat - 1) && tupletsFit(previous, beat);
      var startIndex = out.length;
      if (reuse) {
        // Repite el ritmo de la frase anterior (pregunta y respuesta).
        previous.cells.forEach(function (n) {
          out.push({ tick: beat * bt + n.offset, ticks: n.ticks, written: n.written, rest: n.rest, tuplet: n.tuplet, tupletIndex: n.tupletIndex, tupletSize: n.tupletSize, phrase: phrase });
        });
        beat += previous.beats;
      } else {
        var bodyEnd = end - 1;
        var first = true;
        while (beat < bodyEnd) {
          var id = chooseCell(bodyEnd - beat, first, ctx.beatsPerBar - (beat % ctx.beatsPerBar));
          if (!id) break;
          var cell = cells[id];
          var span = (cell.beats || 1) * bt;
          var t = beat * bt;
          var sum = cell.notes.reduce(function (a, x) { return a + x; }, 0);
          for (var n = 0; n < cell.notes.length; n++) {
            var dur = cell.tuplet ? span / cell.notes.length : cell.notes[n];
            out.push({
              tick: t, ticks: dur, written: cell.notes[n], rest: Boolean(cell.rest && cell.rest.indexOf(n) >= 0),
              tuplet: cell.tuplet || 0, tupletIndex: n, tupletSize: cell.notes.length, phrase: phrase,
            });
            t += dur;
          }
          if (!cell.tuplet && sum !== span) out[out.length - 1].ticks += span - sum;
          beat += cell.beats || 1;
          first = false;
        }
        // Nota final de la frase: larga, en el pulso (o anticipada si la frase es corta).
        var remain = (end - beat) * bt;
        if (remain > 0) {
          var endTicks = style.endTicks[Math.floor(rng() * style.endTicks.length)];
          var noteLen = Math.min(remain, Math.max(Math.min(endTicks, remain), bt >= 4 ? 2 : 1));
          out.push({ tick: beat * bt, ticks: noteLen, written: noteLen, phrase: phrase, end: true });
          if (remain - noteLen > 0) out.push({ tick: beat * bt + noteLen, ticks: remain - noteLen, written: remain - noteLen, rest: true, phrase: -1 });
          beat = end;
        }
      }
      var notesOfPhrase = out.slice(startIndex);
      var lastSounding = null;
      for (var q = notesOfPhrase.length - 1; q >= 0; q--) {
        if (!notesOfPhrase[q].rest) { lastSounding = notesOfPhrase[q]; break; }
      }
      if (lastSounding) lastSounding.end = true;
      if (!reuse && notesOfPhrase.length) {
        var startTick = notesOfPhrase[0].tick;
        previous = {
          beats: Math.round((beat * bt - startTick) / bt),
          cells: notesOfPhrase.map(function (x) { return { offset: x.tick - startTick, ticks: x.ticks, written: x.written, rest: x.rest || false, tuplet: x.tuplet || 0, tupletIndex: x.tupletIndex, tupletSize: x.tupletSize }; }),
        };
      }
      phrase++;
      if (beat >= finalBeat) break;
      // Respiración entre frases.
      var gap = Math.round(between(rng, style.gap) * gapScale);
      if (p.rests === 0) gap = 0;
      gap = Math.min(gap, finalBeat - beat);
      if (finalBeat - (beat + gap) < 2) gap = finalBeat - beat;
      emitRest(beat, beat + gap);
      beat += gap;
    }
    if (p.endOnTonic) {
      out.push({ tick: finalBeat * bt, ticks: ctx.barTicks, written: ctx.barTicks, phrase: phrase - 1, end: true, final: true });
    }
    // Pequeñas respiraciones dentro de las frases.
    out.forEach(function (n) {
      if (!n.rest && !n.end && !n.tuplet && n.ticks <= 2 && rng() < p.rests / 700) n.rest = true;
    });
    return out;
  }

  // ---------- Alturas ----------
  function nearestIn(list, midi) {
    var best = list[0];
    for (var i = 1; i < list.length; i++) if (Math.abs(list[i] - midi) < Math.abs(best - midi)) best = list[i];
    return best;
  }

  // Paso de escala desde una nota (dir +1/-1, steps notas de escala).
  function scaleStep(ctx, seg, midi, dir, steps) {
    var pcs = scalePcsAt(ctx, seg);
    var m = midi;
    var guard = 0;
    while (steps > 0 && guard++ < 40) {
      m += dir;
      if (pcs.indexOf(pcOf(m)) >= 0) steps--;
    }
    return m;
  }

  function scaleDistance(ctx, seg, a, b) {
    var pcs = scalePcsAt(ctx, seg);
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    var n = 0;
    for (var m = lo + 1; m <= hi; m++) if (pcs.indexOf(pcOf(m)) >= 0) n++;
    return n * (b >= a ? 1 : -1);
  }

  // Fórmulas del lenguaje: grados desde la nota de partida del acorde.
  var LICKS = {
    1: [[1, 9, 3, 5], [1, 3, 5, 7], [1, 7, 6, 5]],
    3: [[3, 5, 7, 9], [3, 9, 1, 7], [3, 4, 5, 7]],
    5: [[5, 7, 9, 3], [5, 4, 3, 9], [5, 6, 7, 9]],
    7: [[7, 9, 3, 5], [7, 6, 5, 3]],
    9: [[9, 7, 5, 3], [9, 1, 7, 6]],
  };
  var LICK_IV = { 1: 0, 2: 2, 3: null, 4: 5, 5: null, 6: 9, 7: null, 9: null };

  function improvise(ctx, rng) {
    var p = ctx.p;
    var style = ctx.style;
    var notes = planRhythm(ctx, rng);
    var v = p.variability / 100;
    var center = Math.round((ctx.low + ctx.high) / 2);
    var span = ctx.high - ctx.low;
    var prev = center - 2 + Math.round((rng() - 0.5) * 6);
    var theme = Array.isArray(p.theme) && p.theme.length && p.paraphrase > 0 ? p.theme : null;
    var themeLen = theme ? ctx.totalTicks / Math.max(1, p.choruses) : 0;

    // Agrupa por frases.
    var phrases = [];
    notes.forEach(function (n, i) {
      if (n.rest) return;
      var ph = phrases[phrases.length - 1];
      if (!ph || ph.id !== n.phrase) {
        ph = { id: n.phrase, idx: [] };
        phrases.push(ph);
      }
      ph.idx.push(i);
    });

    var lastPhrasePitches = null;
    phrases.forEach(function (ph, pi) {
      var idx = ph.idx;
      // Contorno de la frase: arco, bajada, subida u ola; la altura de partida se mueve por el registro.
      var shape = weighted(rng, [['arch', 4], ['down', style.descending ? 5 : 3], ['up', 2], ['wave', 2]]);
      var amp = 3 + Math.round((4 + 8 * v) * (0.6 + rng() * 0.6));
      var startLevel = clamp(prev + Math.round((rng() - 0.5) * 8), ctx.low + 3, ctx.high - 3);
      if (shape === 'down') startLevel = clamp(startLevel + 4, ctx.low + 5, ctx.high - 2);
      if (shape === 'up') startLevel = clamp(startLevel - 4, ctx.low + 2, ctx.high - 5);
      // El clímax del solo, hacia los dos tercios.
      var pos = idx.length ? notes[idx[0]].tick / ctx.totalTicks : 0;
      if (pos > 0.55 && pos < 0.8) startLevel = clamp(startLevel + Math.round(span * 0.15), ctx.low, ctx.high - 3);
      function contour(x) {
        if (shape === 'arch') return Math.sin(Math.PI * x) * amp;
        if (shape === 'down') return -x * amp;
        if (shape === 'up') return x * amp * 0.8;
        return Math.sin(Math.PI * 2 * x) * amp * 0.6;
      }

      // Paráfrasis de la melodía: las notas estructurales salen del tema.
      var useTheme = theme && rng() < p.paraphrase / 100;

      // Riff: el blues y el rock repiten la frase anterior adaptándola al acorde.
      var hasFinal = idx.some(function (ni) { return notes[ni].final; });
      if (style.riff && !hasFinal && lastPhrasePitches && lastPhrasePitches.length === idx.length && rng() < p.repetition / 140) {
        idx.forEach(function (ni, k2) {
          var seg = segmentAt(ctx, notes[ni].tick);
          var pcs = scalePcsAt(ctx, seg);
          var m = lastPhrasePitches[k2];
          if (pcs.indexOf(pcOf(m)) < 0) m = nearestIn(pitchesIn(ctx, pcs), m);
          notes[ni].midi = clamp(m, ctx.low, ctx.high);
        });
        prev = notes[idx[idx.length - 1]].midi;
        lastPhrasePitches = idx.map(function (ni) { return notes[ni].midi; });
        return;
      }

      // 1) Notas estructurales: primera, última, cambios de acorde y pulsos fuertes.
      var structural = [];
      var lastTick = -1e9;
      idx.forEach(function (ni, k2) {
        var n = notes[ni];
        var seg = segmentAt(ctx, n.tick);
        var isChange = Math.abs(seg.start - n.tick) < 1e-6;
        var strongBeat = n.tick % (ctx.beatTicks * 2) < 1e-6;
        var first = k2 === 0;
        var last = k2 === idx.length - 1;
        var longNote = n.ticks >= ctx.beatTicks * 1.5;
        if (first || last || isChange || longNote || (strongBeat && n.tick - lastTick >= ctx.beatTicks * 2)) {
          if (!n.tuplet || n.tupletIndex === 0 || last) {
            structural.push(k2);
            lastTick = n.tick;
          }
        }
      });
      // No más de 6 notas seguidas sin un punto de llegada.
      for (var s = 1; s < structural.length; s++) {
        if (structural[s] - structural[s - 1] > 7) structural.splice(s, 0, structural[s - 1] + 4);
      }

      var chosen = {};
      var level = startLevel;
      structural.forEach(function (k2, si) {
        var n = notes[idx[k2]];
        var seg = segmentAt(ctx, n.tick);
        var x = structural.length > 1 ? si / (structural.length - 1) : 0;
        var desired = Math.round(level + contour(x));
        var midi;
        if (n.final) {
          // Final: la tónica.
          var tonics = pitchesIn(ctx, [ctx.key.root.pc]);
          midi = nearestIn(tonics, prev);
        } else if (useTheme) {
          var tt = n.tick % themeLen;
          var tn = null;
          for (var q = 0; q < theme.length; q++) {
            if (theme[q].tick <= tt + 1e-6 && theme[q].tick + theme[q].ticks > tt + 1e-6) { tn = theme[q]; break; }
          }
          if (tn && tn.midi) {
            midi = tn.midi;
            while (midi > ctx.high) midi -= 12;
            while (midi < ctx.low) midi += 12;
            if (Math.abs(midi - desired) > 9 && midi + 12 <= ctx.high && midi + 12 - desired < desired - midi) midi += 12;
          }
        }
        if (midi === undefined) {
          var isEnd = n.end || k2 === idx.length - 1;
          var weights = isEnd ? style.ends : style.targets;
          var tps = targetPitches(ctx, seg, weights);
          var cands = [];
          for (var m = ctx.low; m <= ctx.high; m++) {
            for (var t = 0; t < tps.length; t++) {
              if (tps[t].pc !== pcOf(m)) continue;
              var dist = Math.abs(m - desired);
              var w = tps[t].w * Math.exp(-dist / (1.8 + 3.5 * v));
              if (si > 0 && chosen[structural[si - 1]] === m) w *= 0.25;
              // Conducción de voces: la nota guía más cercana a la anterior gusta más.
              if (Math.abs(m - prev) <= 2) w *= 1.4;
              if (Math.abs(m - prev) > 9) w *= 0.35;
              cands.push([m, w]);
            }
          }
          if (rng() * 100 > p.chordFollow) {
            // Menos ligado a los acordes: cualquier nota de la escala cercana.
            var free = pitchesIn(ctx, scalePcsAt(ctx, seg)).filter(function (mm) { return seg.chord.avoid.indexOf(pcOf(mm)) < 0 || n.ticks < ctx.beatTicks; });
            free.forEach(function (mm) { cands.push([mm, 0.6 * Math.exp(-Math.abs(mm - desired) / 3)]); });
          }
          midi = cands.length ? weighted(rng, cands) : nearestIn(pitchesIn(ctx, [seg.chord.root]), desired);
        }
        chosen[k2] = midi;
        prev = midi;
      });

      // 2) Relleno entre notas estructurales.
      var prevMidi = null;
      for (var a = 0; a < structural.length; a++) {
        var from = structural[a];
        var to = a + 1 < structural.length ? structural[a + 1] : null;
        var A = chosen[from];
        notes[idx[from]].midi = A;
        if (to === null) {
          // Notas tras la última estructural (raro): bajan por escala.
          for (var r = from + 1; r < idx.length; r++) {
            var sgr = segmentAt(ctx, notes[idx[r]].tick);
            A = scaleStep(ctx, sgr, A, -1, 1);
            notes[idx[r]].midi = clamp(A, ctx.low, ctx.high);
          }
          break;
        }
        var B = chosen[to];
        var m2 = to - from - 1;
        if (m2 <= 0) continue;
        var path = fillPath(ctx, rng, notes, idx, from, to, A, B);
        for (var f = 0; f < m2; f++) {
          var pm = path[f];
          if (pm < ctx.low || pm > ctx.high) {
            pm = nearestIn(pitchesIn(ctx, scalePcsAt(ctx, segmentAt(ctx, notes[idx[from + 1 + f]].tick))), clamp(pm, ctx.low, ctx.high));
            notes[idx[from + 1 + f]].chromatic = false;
          }
          notes[idx[from + 1 + f]].midi = pm;
        }
      }
      prevMidi = notes[idx[idx.length - 1]].midi;
      prev = prevMidi;
      lastPhrasePitches = idx.map(function (ni) { return notes[ni].midi; });
    });

    // 3) Notas largas o en pulso fuerte que choquen con el acorde → nota del acorde más cercana.
    notes.forEach(function (n) {
      if (n.rest || n.midi === undefined || n.chromatic || n.final) return;
      var seg = segmentAt(ctx, n.tick);
      var pc = pcOf(n.midi);
      var strong = Math.abs(seg.start - n.tick) < 1e-6 || n.ticks >= ctx.beatTicks;
      if (strong && seg.chord.avoid.indexOf(pc) >= 0) {
        var tones = pitchesIn(ctx, seg.chord.tones.filter(function (x) { return scalePcsAt(ctx, seg).indexOf(x) >= 0 || ctx.mode === 'chord'; }));
        if (tones.length) n.midi = nearestIn(tones, n.midi);
      }
      if (ctx.mode !== 'chord' && scalePcsAt(ctx, seg).indexOf(pc) < 0) {
        n.midi = nearestIn(pitchesIn(ctx, scalePcsAt(ctx, seg)), n.midi);
      }
    });

    // 4) Adornos y articulación.
    notes.forEach(function (n, i) {
      if (n.rest || n.midi === undefined) return;
      var seg = segmentAt(ctx, n.tick);
      if (p.ornaments > 0 && !n.chromatic && !n.tuplet && rng() < p.ornaments / 100 * (n.ticks >= ctx.beatTicks ? 0.6 : 0.25)) {
        if (n.ticks >= 4 && style.bend) {
          var below = scaleStep(ctx, seg, n.midi, -1, 1);
          if (n.midi - below <= 2 && below >= ctx.low) n.grace = below;
        } else if (n.ticks >= 2) {
          // Nota de adorno: semitono por debajo (jazz, bossa) o nota de escala por encima.
          var g = ctx.mode === 'chord' && rng() < 0.6 ? n.midi - 1 : scaleStep(ctx, seg, n.midi, 1, 1);
          if (g >= ctx.low - 1 && g <= ctx.high + 2) n.grace = g;
        } else if (n.ticks >= 4 && rng() < 0.5) {
          n.slide = true;
        }
      }
      if (style.staccato && n.ticks <= 2 && rng() < 0.5) n.staccato = true;
      if (style.accents && n.tick % ctx.barTicks === 0) n.accent = true;
      // Swing: algunas corcheas a contratiempo más fuertes (solo en el sonido, no se escriben).
      if (style.feel === 'swing' && n.ticks === 2 && n.tick % ctx.beatTicks !== 0 && rng() < 0.3) n.push = true;
    });
    return notes;
  }

  // Une dos notas de llegada A y B con una línea musical (escala, arpegio, cromatismo, envolvente o fórmula).
  function fillPath(ctx, rng, notes, idx, from, to, A, B) {
    var p = ctx.p;
    var style = ctx.style;
    var m = to - from - 1;
    var segA = segmentAt(ctx, notes[idx[from]].tick);
    var segB = segmentAt(ctx, notes[idx[to]].tick);
    var path = [];
    var chrom = p.chromatic / 100;

    // Fórmula del lenguaje (1-2-3-5, 3-5-7-9…) al empezar un acorde con corcheas.
    var allEighths = true;
    for (var e = from; e <= Math.min(to - 1, from + 3); e++) if (notes[idx[e]].ticks !== 2 || notes[idx[e]].tuplet) allEighths = false;
    if (style.licks && ctx.mode === 'chord' && m >= 3 && allEighths && rng() < style.licks) {
      var ch = segA.chord;
      var degA = null;
      Object.keys(ch.degrees).forEach(function (d) { if (ch.degrees[d] !== null && ch.degrees[d] !== undefined && pcOf(ch.root + ch.degrees[d]) === pcOf(A)) degA = Number(d); });
      var options = degA && LICKS[degA];
      if (options) {
        var lick = options[Math.floor(rng() * options.length)];
        var cur = A;
        var ok = true;
        var out = [];
        for (var l = 1; l < lick.length; l++) {
          var iv = ch.degrees[lick[l]];
          if (iv === undefined || iv === null) iv = LICK_IV[lick[l]];
          if (iv === undefined || iv === null) { ok = false; break; }
          var pc = pcOf(ch.root + iv);
          var dir = lick[l] > lick[l - 1] || (lick[l] === 1 && lick[l - 1] === 9) ? 1 : -1;
          if (lick[l - 1] === 9 && lick[l] === 1) dir = -1;
          var nxt = cur + dir;
          while (pcOf(nxt) !== pc) nxt += dir;
          out.push(nxt);
          cur = nxt;
        }
        if (ok && Math.abs(cur - B) <= 5 + (m - 3) * 2) {
          path = out;
          var rest = m - out.length;
          var tail = rest > 0 ? walk(ctx, rng, notes, idx, from + out.length, rest, cur, B, segB) : [];
          return path.concat(tail);
        }
      }
    }

    // Final de la línea hacia B: cromatismo o envolvente.
    var suffix = [];
    if (m >= 2 && rng() < chrom * 0.55 && ctx.mode === 'chord') {
      var upper = scaleStep(ctx, segB, B, 1, 1);
      suffix = [upper, B - 1];
    } else if (m >= 1 && rng() < chrom) {
      suffix = [rng() < 0.65 ? B - 1 : B + 1];
    }
    if (suffix.length) {
      var lastFill = idx[from + m];
      notes[lastFill].chromatic = true;
    }
    var body = m - suffix.length;
    var goal = suffix.length ? suffix[0] : B;
    path = walk(ctx, rng, notes, idx, from, body, A, goal, segB, suffix.length > 0);
    return path.concat(suffix);
  }

  // Camina de A hacia la meta por grados de escala, con saltos de arpegio si hay que cubrir mucha distancia
  // y vueltas (notas vecinas) si sobran notas.
  function walk(ctx, rng, notes, idx, from, count, A, goal, segGoal, approach) {
    var out = [];
    var cur = A;
    var v = ctx.p.variability / 100;
    for (var i = 0; i < count; i++) {
      var n = notes[idx[from + 1 + i]];
      var seg = segmentAt(ctx, n.tick);
      var stepsLeft = count - i + (approach ? 1 : 0);
      var target = approach ? (goal > cur ? goal - 1 : goal + 1) : goal;
      var dist = scaleDistance(ctx, seg, cur, target);
      var dir = dist === 0 ? (rng() < 0.5 ? 1 : -1) : dist > 0 ? 1 : -1;
      var size;
      if (Math.abs(dist) > stepsLeft) {
        // Mucha distancia: salto por notas del acorde.
        var tones = pitchesIn(ctx, seg.chord.tones.filter(function (pc) { return ctx.mode === 'chord' || scalePcsAt(ctx, seg).indexOf(pc) >= 0; }));
        var next = null;
        for (var t = 0; t < tones.length; t++) {
          var cand = dir > 0 ? tones[t] : tones[tones.length - 1 - t];
          if ((dir > 0 && cand > cur) || (dir < 0 && cand < cur)) { next = cand; break; }
        }
        if (next !== null && Math.abs(next - cur) <= 7) {
          cur = next;
          out.push(cur);
          continue;
        }
        size = Math.min(3, Math.ceil(Math.abs(dist) / stepsLeft));
      } else if (Math.abs(dist) === stepsLeft || Math.abs(dist) === stepsLeft - 1) {
        size = 1;
      } else if (rng() < 0.3 + v * 0.15 && out.length !== 1) {
        // Sobran notas: vuelta (se aleja un poco para volver).
        dir = -dir;
        size = rng() < 0.4 + v * 0.4 ? 2 : 1;
      } else {
        size = rng() < 0.15 + v * 0.3 ? 2 : 1;
      }
      cur = scaleStep(ctx, seg, cur, dir, size);
      if (cur > ctx.high + 2) cur = scaleStep(ctx, seg, cur, -1, 2);
      if (cur < ctx.low - 2) cur = scaleStep(ctx, seg, cur, 1, 2);
      out.push(cur);
    }
    return out;
  }

  // ---------- Puntuación ----------
  function scoreSolo(ctx, notes) {
    var sounding = notes.filter(function (n) { return !n.rest && n.midi !== undefined; });
    if (sounding.length < 2) return -1e6;
    var score = 0;
    var steps = 0;
    var leaps = 0;
    var bigLeaps = 0;
    var repeats = 0;
    var strongGood = 0;
    var strongTotal = 0;
    var lo = 999;
    var hi = 0;
    var hiCount = 0;
    var hiPos = 0;
    var unresolved = 0;
    var zigzag = 0;
    var avoidLong = 0;
    for (var i = 0; i < sounding.length; i++) {
      var n = sounding[i];
      var seg = segmentAt(ctx, n.tick);
      var pc = pcOf(n.midi);
      if (n.midi > hi) { hi = n.midi; hiCount = 1; hiPos = n.tick / ctx.totalTicks; } else if (n.midi === hi) hiCount++;
      if (n.midi < lo) lo = n.midi;
      var strong = n.tick % ctx.beatTicks < 1e-6 || n.ticks >= ctx.beatTicks;
      if (strong) {
        strongTotal++;
        var good = seg.chord.tones.indexOf(pc) >= 0;
        if (!good && ctx.mode === 'chord') {
          [9, 13].forEach(function (d) { var iv = seg.chord.degrees[d]; if (iv !== undefined && iv !== null && pcOf(seg.chord.root + iv) === pc) good = true; });
        }
        if (good) strongGood++;
        if (n.ticks >= ctx.beatTicks && seg.chord.avoid.indexOf(pc) >= 0) avoidLong++;
      }
      if (seg.chord.scalePcs.indexOf(pc) < 0 && ctx.mode === 'chord') {
        var nx = sounding[i + 1];
        if (!nx || Math.abs(nx.midi - n.midi) > 2) unresolved++;
      }
      if (i > 2 && n.midi === sounding[i - 2].midi && sounding[i - 1].midi === sounding[i - 3].midi) zigzag++;
      if (i > 0) {
        var d = Math.abs(n.midi - sounding[i - 1].midi);
        if (d === 0) repeats++;
        else if (d <= 2) steps++;
        else if (d > 12) bigLeaps++;
        else if (d > 7) leaps++;
      }
    }
    var moves = sounding.length - 1;
    var stepRatio = steps / moves;
    var idealSteps = 0.55 + (1 - ctx.p.variability / 100) * 0.2;
    score += (strongGood / Math.max(1, strongTotal)) * 6;
    score -= Math.abs(stepRatio - idealSteps) * 6;
    score -= (leaps / moves) * 3 + (bigLeaps / moves) * 10;
    score -= (repeats / moves) * (ctx.style.staccato ? 1 : 4);
    score -= (unresolved / sounding.length) * 8;
    score -= (zigzag / sounding.length) * 12;
    score -= (avoidLong / sounding.length) * 8;
    var rangeUsed = hi - lo;
    var wanted = Math.min(ctx.high - ctx.low, 7 + ctx.p.range * 5);
    score -= Math.abs(rangeUsed - wanted) / 6;
    // Un único punto culminante, mejor en la segunda mitad.
    if (hiCount === 1) score += 0.8;
    if (hiPos > 0.45 && hiPos < 0.9) score += 0.8;
    return score;
  }

  // ---------- Compases ----------
  function toBars(ctx, notes, formBars) {
    var bars = [];
    var bt = ctx.barTicks;
    var total = formBars.length;
    for (var b = 0; b < total; b++) {
      var segs = ctx.segments.filter(function (s) { return s.bar === b; });
      bars.push({
        chord: segs[0].chord,
        chords: segs.map(function (s) { return { name: s.name, tick: s.start - b * bt, chord: s.chord }; }),
        notes: [],
      });
    }
    notes.forEach(function (n) {
      var start = n.tick;
      var remaining = n.ticks;
      var first = true;
      while (remaining > 1e-6) {
        var bi = Math.floor(start / bt + 1e-9);
        if (bi >= total) break;
        var barEnd = (bi + 1) * bt;
        var len = Math.min(remaining, barEnd - start);
        var piece = Object.assign({}, n, { tick: start - bi * bt, ticks: len, written: n.tuplet ? n.written : len });
        if (!first) {
          delete piece.grace;
          delete piece.slide;
          delete piece.accent;
          piece.tieFrom = true;
        }
        if (remaining - len > 1e-6 && !n.rest) piece.tie = true;
        var seg = segmentAt(ctx, start);
        if (!n.rest) piece.sp = spell(ctx, n, seg, notes);
        bars[bi].notes.push(piece);
        start += len;
        remaining -= len;
        first = false;
      }
    });
    return bars;
  }

  // Ortografía de cada nota: por la escala del acorde o de la tonalidad; cromatismos según hacia dónde van.
  function spell(ctx, n, seg, notes) {
    var pc = pcOf(n.midi);
    if (ctx.mode === 'chord' && seg.spelling[pc]) return seg.spelling[pc];
    if (ctx.mode !== 'chord' && ctx.keyScale) {
      var all = ctx.keyScale.notes.concat(ctx.keyScale.all);
      for (var i = 0; i < all.length; i++) if (all[i].pc === pc) return { letter: all[i].letter, acc: all[i].acc };
    }
    // Cromatismo: si sube, con sostenido; si baja, con bemol.
    var idx = notes.indexOf(n);
    var next = null;
    for (var j = idx + 1; j < notes.length; j++) if (!notes[j].rest && notes[j].midi !== undefined) { next = notes[j]; break; }
    var up = next ? next.midi > n.midi : false;
    var sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    var nm = (up ? sharps : flats)[pc];
    return { letter: nm[0], acc: nm[1] === '#' ? 1 : nm[1] === 'b' ? -1 : 0 };
  }

  // ---------- Salida ABC ----------
  function lengthStr(n) {
    if (n === 1) return '';
    if (Number.isInteger(n)) return String(n);
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
      var pc = pcOf(midi);
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

  // Une silencios seguidos alineados (dos negras de silencio → una blanca) para que la partitura se lea mejor.
  function mergeRests(notes, barTicks, beatTicks) {
    var merged = mergeRestsOnce(notes, barTicks, beatTicks);
    while (merged.length < notes.length) {
      notes = merged;
      merged = mergeRestsOnce(notes, barTicks, beatTicks);
    }
    return merged;
  }

  function mergeRestsOnce(notes, barTicks, beatTicks) {
    var out = [];
    notes.forEach(function (n) {
      var last = out[out.length - 1];
      if (n.rest && last && last.rest && !n.tuplet && !last.tuplet) {
        var len = last.ticks + n.ticks;
        var aligned = (len === beatTicks * 2 && last.tick % (beatTicks * 2) === 0 && barTicks % (beatTicks * 2) === 0) || (len === barTicks && last.tick === 0) || (len === beatTicks && last.tick % beatTicks === 0) || (len === beatTicks * 3 && last.tick === 0 && barTicks === beatTicks * 3);
        if (aligned) {
          out[out.length - 1] = Object.assign({}, last, { ticks: len, written: len });
          return;
        }
      }
      out.push(n);
    });
    return out;
  }

  function chordLabel(name) {
    // Para la partitura: m en lugar de -, maj7 en lugar de ^.
    var r = rootPc(name);
    if (!r) return name;
    var q = r.rest.replace(/^m-/, 'm').replace(/^-/, 'm').replace(/^\^/, 'maj').replace(/^h7?/, 'm7b5').replace(/^o/, 'dim');
    return name.slice(0, name.length - r.rest.length) + q;
  }

  function toAbc(p, k, bars, ctx) {
    var keySig = keySignature(ctx.fifths);
    var sc = ctx.keyScaleId ? SCALES[ctx.keyScaleId] : null;
    var title = ctx.style.name + ' en ' + k.name + (sc ? ' · ' + sc.name : '');
    var lines = [
      'X:1',
      'T:' + title,
      'C:Generador de solos de Ensaya · nº ' + p.seed,
      'M:' + p.meter,
      'L:1/16',
      'Q:1/4=' + p.tempo,
      'K:' + k.name,
    ];
    var body = '';
    bars.forEach(function (bar, bi) {
      var barAcc = {};
      var out = '';
      var lastBeat = -1;
      var inTuplet = 0;
      var chordIdx = 0;
      var notes = mergeRests(bar.notes, ctx.barTicks, ctx.beatTicks);
      notes.forEach(function (n) {
        var beat = Math.floor(n.tick / ctx.beatTicks + 1e-9);
        if (beat !== lastBeat && out.length && inTuplet === 0) out += ' ';
        lastBeat = beat;
        // Acorde en su sitio (si cae dentro de una nota larga, se escribe en esa nota).
        var label = '';
        while (chordIdx < bar.chords.length && bar.chords[chordIdx].tick <= n.tick + n.ticks - 1e-6 && (!n.tuplet || n.tupletIndex === 0 || bar.chords[chordIdx].tick <= n.tick + 1e-6)) {
          if (!label) label = chordLabel(bar.chords[chordIdx].name);
          chordIdx++;
        }
        if (label) out += '"' + label + '"';
        if (n.tuplet && n.tupletIndex === 0) {
          out += '(' + n.tuplet;
          inTuplet = n.tupletSize;
        }
        var len = lengthStr(n.tuplet ? n.written : n.ticks);
        if (n.rest) {
          out += 'z' + len;
        } else {
          if (n.grace !== undefined && n.grace !== null) out += '{' + pitchToken(n.grace, null, ctx.fifths, {}, keySig) + '}';
          if (n.slide) out += '!slide!';
          if (n.accent) out += '!>!';
          if (n.staccato) out += '.';
          out += pitchToken(n.midi, n.sp, ctx.fifths, barAcc, keySig) + len + (n.tie ? '-' : '');
        }
        if (inTuplet) inTuplet--;
      });
      body += out + (bi === bars.length - 1 ? ' |]' : ' | ');
      if ((bi + 1) % ctx.perLine === 0 && bi !== bars.length - 1) body += '\n';
    });
    return lines.join('\n') + '\n' + body + '\n';
  }

  // ---------- Eventos para el sonido ----------
  function swingTimer(p, beatTicks) {
    var swing = p.swing / 100;
    return function (tick) {
      if (beatTicks !== 4) return tick;
      var inBeat = ((tick % 4) + 4) % 4;
      var beatStart = tick - inBeat;
      if (Math.abs(inBeat - 2) < 1e-6) return beatStart + 2 + swing * (2 / 3);
      if (Math.abs(inBeat - 1) < 1e-6) return beatStart + 1 + swing * 0.33;
      if (Math.abs(inBeat - 3) < 1e-6) return beatStart + 3 + swing * 0.33;
      return tick;
    };
  }

  function toEvents(p, bars, ctx) {
    var out = [];
    var beatSec = (60 / p.tempo) * (ctx.beatTicks === 6 ? 1.5 : ctx.beatTicks === 2 ? 0.5 : 1);
    var tickSec = beatSec / ctx.beatTicks;
    var swingTime = swingTimer(p, ctx.beatTicks);
    var noteIndex = 0;
    var tied = null;
    bars.forEach(function (bar, bi) {
      var barStart = bi * ctx.barTicks;
      mergeRests(bar.notes, ctx.barTicks, ctx.beatTicks).forEach(function (n) {
        var start = swingTime(n.tick);
        var end = n.tick + n.ticks >= ctx.barTicks - 1e-6 ? ctx.barTicks : swingTime(n.tick + n.ticks);
        var dur = (end - start) * tickSec;
        if (n.tieFrom && tied) {
          // Nota ligada desde el compás anterior: alarga la nota que ya suena.
          tied.duration += dur;
          noteIndex++;
          if (!n.tie) tied = null;
          return;
        }
        var ev = {
          index: noteIndex++,
          rest: Boolean(n.rest),
          midi: n.rest ? null : n.midi,
          time: (barStart + start) * tickSec,
          duration: Math.max(0.05, dur * (n.staccato ? 0.5 : n.tie ? 1 : 0.95)),
          velocity: n.accent ? 1 : n.push ? 0.9 : n.tick === 0 ? 0.88 : n.tick % ctx.beatTicks === 0 ? 0.8 : 0.72,
          grace: n.grace !== undefined && n.grace !== null ? n.grace : null,
          bar: bi,
        };
        out.push(ev);
        tied = n.tie ? ev : null;
      });
    });
    return {
      notes: out,
      chords: ctx.segments.map(function (s) {
        return { bar: s.bar, time: s.start * tickSec, duration: (s.end - s.start) * tickSec, root: s.chord.root, bass: s.chord.bass, tones: s.chord.tones, name: s.name };
      }),
      beatSec: beatSec,
      tickSec: tickSec,
      beatsPerBar: ctx.barTicks / ctx.beatTicks,
      totalSec: bars.length * ctx.barTicks * tickSec,
    };
  }

  // ---------- Acompañamiento del estilo ----------
  // Devuelve [{part:'bass', midi, time, duration, velocity}, {part:'chord', midis, …}, {part:'drum', type, time, velocity}].
  function accompaniment(ctx, segments, ev) {
    var p = ctx.p;
    var style = ctx.style;
    var comp = style.comp;
    var rng = mulberry32((p.seed * 7919 + 13) >>> 0);
    var out = [];
    var bt = ctx.beatTicks;
    var tickSec = ev.tickSec;
    var swingTime = swingTimer(p, bt);
    var T = function (tick) {
      var base = Math.floor(tick / bt) * bt;
      return (base + swingTime(tick - base)) * tickSec;
    };
    var bpb = ctx.beatsPerBar;
    var totalTicks = ctx.totalTicks;

    function bassNote(pc, near) {
      var m = 28 + pcOf(pc - 4); // E1..D#2
      if (near !== undefined) {
        while (m + 12 <= 52 && Math.abs(m + 12 - near) < Math.abs(m - near)) m += 12;
      } else if (m < 33) m += 12;
      return m;
    }
    function bass(tick, ticks, midi, vel) {
      out.push({ part: 'bass', midi: midi, time: T(tick), duration: Math.max(0.08, ticks * tickSec * 0.92), velocity: vel || 0.85 });
    }
    function chord(tick, ticks, midis, vel) {
      out.push({ part: 'chord', midis: midis, time: T(tick), duration: Math.max(0.08, ticks * tickSec * 0.95), velocity: vel || 0.5 });
    }
    function drum(type, tick, vel) {
      if (tick >= totalTicks - 1e-6) return;
      out.push({ part: 'drum', type: type, time: T(tick), velocity: vel || 0.8 });
    }

    // Voicings: jazz y bossa sin fundamental (3-7-9 / 7-3-13), con la conducción de voces más corta.
    var lastVoicing = null;
    function voicing(ch) {
      var pcs;
      var jazz = style.harmony === 'chord' && !style.plain;
      if (jazz && ch.tones.length >= 4) {
        var d = ch.degrees;
        var three = pcOf(ch.root + d[3]);
        var seven = pcOf(ch.root + d[7]);
        var nine = d[9] !== undefined && d[9] !== null ? pcOf(ch.root + d[9]) : pcOf(ch.root + d[5]);
        var five = pcOf(ch.root + d[5]);
        var thirteen = d[13] !== undefined && d[13] !== null && ch.kind === 'dom' ? pcOf(ch.root + d[13]) : five;
        var optA = [three, five, seven, nine];
        var optB = [seven, nine, three, thirteen];
        pcs = !lastVoicing || rng() < 0.5 ? optA : optB;
        if (lastVoicing) {
          var a = place(optA, 52);
          var b = place(optB, 52);
          pcs = cost(a) <= cost(b) ? optA : optB;
        }
      } else {
        pcs = ch.tones.slice(0, 4);
      }
      var v = place(pcs, style.harmony === 'chord' ? 52 : 55);
      lastVoicing = v;
      return v;
    }
    function place(pcs, bottom) {
      var res = [];
      var m = bottom - 1;
      pcs.forEach(function (pc) {
        var n = m + 1;
        while (pcOf(n) !== pc) n++;
        res.push(n);
        m = n;
      });
      if (lastVoicing) {
        // Desplaza por octavas para quedar cerca del voicing anterior.
        var avgL = lastVoicing.reduce(function (s, x) { return s + x; }, 0) / lastVoicing.length;
        var avg = res.reduce(function (s, x) { return s + x; }, 0) / res.length;
        if (avg - avgL > 6 && res[0] - 12 >= 45) res = res.map(function (x) { return x - 12; });
        else if (avgL - avg > 6 && res[res.length - 1] + 12 <= 79) res = res.map(function (x) { return x + 12; });
      }
      return res;
    }
    function cost(v) {
      if (!lastVoicing) return 0;
      var c = 0;
      for (var i = 0; i < v.length; i++) c += Math.abs(v[i] - (lastVoicing[i] || v[i]));
      return c;
    }

    segments.forEach(function (s, si) {
      var ch = s.chord;
      var next = segments[si + 1] ? segments[si + 1].chord : null;
      var len = s.end - s.start;
      var beats = Math.round(len / bt);
      var root = bassNote(ch.bass);
      var fifth = bassNote(ch.root + 7, root + 7);
      var v = voicing(ch);
      var b;
      if (comp === 'swing' || comp === 'blues') {
        // Walking bass: fundamental, notas del acorde y cromatismo hacia el siguiente acorde.
        var cur = root;
        for (b = 0; b < beats; b++) {
          var tick = s.start + b * bt;
          var m;
          if (b === 0) m = root;
          else if (b === beats - 1 && next) {
            var nr = bassNote(next.bass, cur);
            m = rng() < 0.6 ? nr + (rng() < 0.5 ? 1 : -1) : bassNote(next.root + 7, nr) ;
            if (Math.abs(m - nr) > 7) m = nr - 1;
          } else {
            var opts = [ch.tones[1], ch.tones[2], ch.tones[3] !== undefined ? ch.tones[3] : ch.tones[0], (ch.root + (ch.scale[1] || 2)) % 12].map(function (pc) { return bassNote(pc, cur); });
            m = opts[Math.floor(rng() * opts.length)];
          }
          if (comp === 'blues' && b > 0 && b < beats - 1 && rng() < 0.5) m = bassNote(ch.root + [0, 4, 7, 9][b % 4], root);
          bass(tick, bt, m, b === 0 ? 0.9 : 0.78);
          cur = m;
        }
        // Comping: charlestón o golpes sueltos.
        var hits = rng() < 0.5 ? [[0, 3], [Math.min(beats - 1, 1) * bt + bt / 2, 2]] : [[rng() < 0.5 ? 0 : bt / 2, 3]];
        if (beats <= 2) hits = [[0, beats * bt - 1]];
        hits.forEach(function (h) {
          if (h[0] < len) chord(s.start + h[0], Math.min(h[1] * (bt / 2), len - h[0]), v, comp === 'blues' ? 0.45 : 0.38);
        });
      } else if (comp === 'bossa') {
        // Bajo de bossa: fundamental y quinta con anticipación; guitarra/piano sincopados.
        for (b = 0; b < beats; b += 2) {
          var t0 = s.start + b * bt;
          bass(t0, bt + bt / 2, root, 0.85);
          if (b + 1 < beats) bass(t0 + bt + bt / 2, bt / 2, fifth, 0.6);
        }
        // Patrón de acompañamiento (dos compases): 1, y-de-2, 4 / y-de-1, 3…
        var patt = [0, 3, 6, 10, 12];
        var barStart = s.bar * ctx.barTicks;
        patt.forEach(function (x) {
          var tk = barStart + (x * bt) / 4;
          if (tk >= s.start - 1e-6 && tk < s.end - 1e-6) chord(tk, bt / 2 + 0.5, v, x === 0 ? 0.42 : 0.34);
        });
      } else if (comp === 'ballad') {
        bass(s.start, Math.min(len, bt * 2), root, 0.8);
        if (beats >= 4) bass(s.start + bt * 2, bt * 2, rng() < 0.5 ? fifth : bassNote(ch.tones[1], root), 0.65);
        chord(s.start, len, v, 0.36);
      } else if (comp === 'funk') {
        var funkBass = [0, 3, 6, 8, 10, 14];
        for (b = 0; b < beats; b += 4) {
          funkBass.forEach(function (x, i) {
            var tk = s.start + b * bt + (x * bt) / 4;
            if (tk < s.end - 1e-6) bass(tk, bt / 4, i % 3 === 2 ? root + 12 : root, i === 0 ? 0.95 : 0.7);
          });
        }
        for (b = 0; b < beats; b++) {
          if (rng() < 0.7) chord(s.start + b * bt + bt / 2, bt / 4, v, 0.32);
        }
      } else if (comp === 'metal') {
        for (b = 0; b < beats * 2; b++) bass(s.start + (b * bt) / 2, bt / 2, root, 0.8);
        chord(s.start, len, [root + 12, root + 19], 0.3);
      } else if (comp === 'flamenco') {
        bass(s.start, bt, root, 0.85);
        if (beats > 2) bass(s.start + bt * 2, bt, fifth, 0.7);
        for (b = 0; b < beats; b++) chord(s.start + b * bt, bt / 2, v, b === 0 ? 0.5 : 0.35);
      } else {
        // rock / pop: corcheas de bajo y acordes largos.
        for (b = 0; b < beats * 2; b++) bass(s.start + (b * bt) / 2, bt / 2, root, b % 2 ? 0.65 : 0.82);
        chord(s.start, len, v, 0.4);
      }
    });

    // Batería
    var bars = Math.round(totalTicks / ctx.barTicks);
    for (var bar = 0; bar < bars; bar++) {
      var t = bar * ctx.barTicks;
      for (var k = 0; k < bpb; k++) {
        var tk = t + k * bt;
        if (comp === 'swing') {
          drum('ride', tk, k % 2 ? 0.7 : 0.9);
          if (k % 2 === 1 && bt === 4) drum('ride', tk + 2, 0.5);
          if (k % 2 === 1) drum('hat', tk, 0.6);
          drum('kick', tk, 0.18);
        } else if (comp === 'blues') {
          drum('ride', tk, 0.8);
          if (bt === 4) drum('ride', tk + 2, 0.5);
          if (k % 2 === 1) drum('snare', tk, 0.7);
          if (k % 2 === 0) drum('kick', tk, 0.7);
        } else if (comp === 'ballad') {
          drum('brush', tk, k === 0 ? 0.8 : 0.6);
          if (k % 2 === 1) drum('hat', tk, 0.35);
        } else if (comp === 'bossa') {
          // Charles en corcheas, aro con el patrón de bossa, bombo en 1 y 3 con anticipación.
          drum('shaker', tk, 0.7);
          if (bt === 4) drum('shaker', tk + 2, 0.45);
          if (k % 2 === 0) {
            drum('kick', tk, 0.7);
            if (bt === 4) drum('kick', tk - 1 + bt, 0.35);
          }
        } else if (comp === 'flamenco') {
          drum('clap', tk, k === 0 ? 1 : 0.7);
          drum('clap', tk + (bt === 6 ? 4 : bt / 2), 0.45);
          if (k === 0) drum('kick', tk, 0.5);
        } else {
          if (k === 0 || (bpb === 4 && k === 2)) drum('kick', tk, 0.9);
          if ((bpb === 4 && (k === 1 || k === 3)) || (bpb !== 4 && k === 1)) drum('snare', tk, 0.85);
          if (bt === 6) {
            for (var s3 = 0; s3 < 3; s3++) drum('hat', tk + s3 * 2, s3 === 0 ? 1 : 0.6);
          } else if (comp === 'funk' || comp === 'metal') {
            for (var q = 0; q < 4; q++) drum('hat', tk + q * (bt / 4), q === 0 ? 1 : 0.5);
          } else {
            drum('hat', tk, 1);
            drum('hat', tk + bt / 2, 0.6);
          }
        }
      }
      if (comp === 'bossa') {
        // Aro (rim) con la clave de bossa, en dos compases.
        var clave = bar % 2 === 0 ? [0, 3, 6] : [2, 4];
        clave.forEach(function (x) { drum('rim', t + (x * ctx.barTicks) / 8, 0.75); });
      }
    }
    return out.sort(function (a, b) { return a.time - b.time; });
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
    VERSION: VERSION, SCALES: SCALES, STYLES: STYLES, PROGRESSIONS: PROGRESSIONS, ROOTS: ROOTS, DEFAULTS: DEFAULTS, LEVELS: LEVELS, FLAVORS: FLAVORS,
    generate: generate, normalize: normalize, progressionFor: progressionFor, chordsFromLyrics: chordsFromLyrics, parseChord: parseChord, spellScale: spellScale,
    paramsFor: paramsFor, inspire: inspire, styleFromName: styleFromName, parseKey: parseKey,
  };
});
