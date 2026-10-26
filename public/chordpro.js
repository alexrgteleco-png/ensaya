/* Cifrado de canciones para Ensaya.
 * Admite dos formas de escribir, que se pueden mezclar:
 *  - Letra con acordes (ChordPro): "[Am]Hoy te [F]vi pasar".
 *  - Cifrado por compases (como iReal Pro):  "[Bm-7] | [%] | [Em-7] | [F#7b9] |"  o  "Bm7 | % | Em7 | F#7b9 |".
 *    "%" repite el compás anterior; varios acordes en un compás se separan con espacios.
 * Secciones con {soc} … {eoc} (o {soc: A}), avisos con {c: texto} y datos con {key: Bm}, {tempo: 120}, {time: 4/4}.
 * Importa enlaces de iReal Pro (irealb:// e irealbook://).
 * Transposición en notación americana (C D E…) y latina (Do Re Mi…).
 * Funciona en el navegador (window.ChordPro) y en Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChordPro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var LATIN = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
  var TO_LATIN = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
  // Tonalidades que se escriben con bemoles.
  var FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'];

  var QUALITY = '(?:maj|min|mi|dim|aug|alt|sus|add|omit|no|m|M|°|ø|Δ|\\^|h|o|\\+|-|\\d|\\(|\\)|b|#|,)*';
  var CHORD_RE = new RegExp('^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?)(' + QUALITY + ')(?:\\/(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?))?$');
  var REPEAT_TOKENS = { '%': true, x: true, '·/·': true, '/': true };
  var NC_TOKENS = { 'N.C.': true, NC: true, 'n.c.': true, 'N.C': true };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isChord(s) {
    return CHORD_RE.test(String(s).trim());
  }

  function noteIndex(root, acc) {
    var r = LATIN[root] || root;
    var i = SHARPS.indexOf(r);
    if (acc === '#') i += 1;
    if (acc === 'b') i -= 1;
    return (i + 12) % 12;
  }

  function noteName(index, useFlats, latin) {
    var n = (useFlats ? FLATS : SHARPS)[((index % 12) + 12) % 12];
    if (latin) return TO_LATIN[n[0]] + n.slice(1);
    return n;
  }

  function usesFlats(key, semitones) {
    if (!key) return false;
    var m = CHORD_RE.exec(String(key).trim());
    if (!m) return false;
    var minor = /^(m(?!aj)|-|min|mi(?!n))/.test(m[3] || '');
    var asFlat = transposeChord((LATIN[m[1]] || m[1]) + m[2] + (minor ? 'm' : ''), semitones, true);
    return FLAT_KEYS.indexOf(asFlat) >= 0;
  }

  // Transpone un acorde suelto. preferFlats: true/false/undefined (automático).
  function transposeChord(chord, semitones, preferFlats) {
    var m = CHORD_RE.exec(String(chord).trim());
    if (!m) return chord;
    var latin = Boolean(LATIN[m[1]]);
    var flats = preferFlats === undefined ? m[2] === 'b' : preferFlats;
    var out = noteName(noteIndex(m[1], m[2]) + semitones, flats, latin) + (m[3] || '');
    if (m[4]) out += '/' + noteName(noteIndex(m[4], m[5]) + semitones, flats, Boolean(LATIN[m[4]]));
    return out;
  }

  // Calidad normalizada (iReal/IA → notación habitual): "-7"→"m7", "^7"→"maj7", "h7"→"m7b5", "o7"→"dim7".
  function normalizeQuality(q) {
    q = String(q || '');
    q = q.replace(/^m-/, 'm').replace(/^-/, 'm').replace(/^min(?!or)/, 'm').replace(/^mi(?!n)/, 'm');
    q = q.replace(/^(m?)(\^|Δ|M)(?=7|9|13|$)/, '$1maj').replace(/^(m?)maj(?=$)/, '$1maj7');
    q = q.replace(/^(h|ø)7?/, 'm7b5').replace(/^(o|°)/, 'dim');
    return q;
  }

  // Acorde para mostrar: calidad normalizada y alteraciones con ♭ y ♯.
  function prettyChord(chord) {
    var m = CHORD_RE.exec(String(chord).trim());
    if (!m) return chord;
    var acc = function (a) { return a === '#' ? '♯' : a === 'b' ? '♭' : ''; };
    var q = normalizeQuality(m[3]).replace(/([#b])(?=\d)/g, function (x) { return acc(x); });
    return m[1] + acc(m[2]) + q + (m[4] ? '/' + m[4] + acc(m[5]) : '');
  }

  function transposeKey(key, semitones) {
    if (!key || !isChord(key)) return key;
    return transposeChord(key, semitones, usesFlats(key, semitones));
  }

  // ---------- Líneas de compases ----------
  function cleanToken(t) {
    return t.replace(/^\[|\]$/g, '').trim();
  }

  // Devuelve los compases de una línea "Am7 | % | D7 G7 |" o null si no es una línea de compases.
  function parseBarLine(line) {
    var t = line.trim();
    if (t.indexOf('|') < 0) return null;
    t = t.replace(/:?\|\|?:?/g, '|').replace(/^\|/, '').replace(/\|$/, '');
    var parts = t.split('|');
    var bars = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) {
        bars.push({ chords: [], repeat: false, empty: true });
        continue;
      }
      // "[Gmaj7][G6]" o "[Gmaj7] [G6]" o "Gmaj7 G6"
      var tokens = seg.replace(/\]\s*\[/g, '] [').split(/\s+/).map(cleanToken).filter(Boolean);
      var chords = [];
      var repeat = false;
      var nc = false;
      for (var k = 0; k < tokens.length; k++) {
        var tok = tokens[k];
        if (REPEAT_TOKENS[tok]) repeat = true;
        else if (NC_TOKENS[tok]) nc = true;
        else if (isChord(tok)) chords.push(tok);
        else return null; // hay texto: no es una línea de compases
      }
      bars.push({ chords: chords, repeat: repeat && !chords.length, nc: nc && !chords.length });
    }
    // Quita compases vacíos al principio y al final (por barras dobles).
    while (bars.length && bars[bars.length - 1].empty) bars.pop();
    while (bars.length && bars[0].empty) bars.shift();
    return bars.length ? bars : null;
  }

  // Analiza el texto en bloques.
  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var d = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(line.trim());
      if (d) {
        var name = d[1].toLowerCase();
        var value = d[2] || '';
        if (name === 'soc' || name === 'start_of_chorus') { out.push({ type: 'start', section: 'chorus', label: value, implicit: !value }); return; }
        if (name === 'sov' || name === 'start_of_verse') { out.push({ type: 'start', section: 'verse', label: value }); return; }
        if (name === 'sob' || name === 'start_of_bridge') { out.push({ type: 'start', section: 'bridge', label: value || 'Puente' }); return; }
        if (name === 'sos' || name === 'section') { out.push({ type: 'start', section: 'part', label: value }); return; }
        if (/^(eoc|eov|eob|eos|end_of_chorus|end_of_verse|end_of_bridge|end_of_section)$/.test(name)) { out.push({ type: 'end' }); return; }
        if (name === 'c' || name === 'comment' || name === 'ci' || name === 'comment_italic') { out.push({ type: 'comment', text: value }); return; }
        if (name === 't' || name === 'title' || name === 'st' || name === 'subtitle') { out.push({ type: 'title', text: value }); return; }
        out.push({ type: 'meta', name: name, value: value });
        return;
      }
      if (/^#/.test(line)) return;
      if (!line.trim()) { out.push({ type: 'blank' }); return; }
      var label = /^\[([^\]]+)\]:?$/.exec(line.trim());
      if (label && !isChord(label[1])) { out.push({ type: 'label', text: label[1] }); return; }
      var barLine = parseBarLine(line);
      if (barLine) { out.push({ type: 'bars', bars: barLine }); return; }
      var segs = [];
      var re = /\[([^\]]*)\]/g;
      var last = 0;
      var m;
      var pending = null;
      while ((m = re.exec(line))) {
        var before = line.slice(last, m.index);
        if (before || pending !== null) segs.push({ chord: pending, text: before });
        pending = m[1];
        last = re.lastIndex;
      }
      segs.push({ chord: pending, text: line.slice(last) });
      if (segs.length && segs[0].chord === null && segs[0].text === '' && segs.length > 1) segs.shift();
      var hasChordsInLine = segs.some(function (s) { return s.chord !== null; });
      out.push({ type: 'line', segs: segs, hasChords: hasChordsInLine, lyrics: segs.some(function (s) { return s.text.trim(); }) });
    });
    // Secciones {soc} sin nombre: «Estribillo» si llevan letra; si solo llevan compases, A, B, C…
    var letter = 0;
    for (var i = 0; i < out.length; i++) {
      if (out[i].type !== 'start' || !out[i].implicit) continue;
      var lyrics = false;
      for (var j = i + 1; j < out.length && out[j].type !== 'end' && out[j].type !== 'start'; j++) {
        if (out[j].type === 'line' && out[j].lyrics) lyrics = true;
      }
      out[i].label = lyrics ? 'Estribillo' : String.fromCharCode(65 + (letter++ % 26));
    }
    return out;
  }

  function renderBars(bars, semitones, flats) {
    var html = '<div class="cp-bars" style="--bars:' + Math.min(Math.max(bars.length, 4), 8) + '">';
    bars.forEach(function (bar) {
      html += '<span class="cp-bar">';
      if (bar.repeat) html += '<span class="cp-repeat" title="Igual que el compás anterior">%</span>';
      else if (bar.nc) html += '<span class="cp-nc">N.C.</span>';
      else if (!bar.chords.length) html += '<span class="cp-empty"></span>';
      else {
        bar.chords.forEach(function (c) {
          html += '<span class="cp-chord">' + escapeHtml(prettyChord(transposeChord(c, semitones, flats))) + '</span>';
        });
      }
      html += '</span>';
    });
    return html + '</div>';
  }

  // HTML con acordes encima de la letra y rejillas de compases.
  function render(text, semitones, opts) {
    semitones = Number(semitones) || 0;
    opts = opts || {};
    var flats = opts.key && semitones ? usesFlats(opts.key, semitones) : undefined;
    var html = '';
    var open = false;
    parse(text).forEach(function (b) {
      if (b.type === 'start') {
        if (open) html += '</div>';
        html += '<div class="cp-section cp-' + b.section + '">' + (b.label ? '<div class="cp-label">' + escapeHtml(b.label) + '</div>' : '');
        open = true;
      } else if (b.type === 'end') {
        if (open) html += '</div>';
        open = false;
      } else if (b.type === 'comment') {
        html += '<div class="cp-comment">' + escapeHtml(b.text) + '</div>';
      } else if (b.type === 'title') {
        if (opts.showTitles) html += '<div class="cp-title">' + escapeHtml(b.text) + '</div>';
      } else if (b.type === 'meta') {
        // datos de la canción: no se pintan
      } else if (b.type === 'label') {
        html += '<div class="cp-label">' + escapeHtml(b.text) + '</div>';
      } else if (b.type === 'blank') {
        html += '<div class="cp-blank"></div>';
      } else if (b.type === 'bars') {
        html += renderBars(b.bars, semitones, flats);
      } else {
        var cls = 'cp-line' + (b.hasChords ? ' cp-has-chords' : '') + (b.lyrics ? '' : ' cp-chords-only');
        html += '<div class="' + cls + '">';
        b.segs.forEach(function (s) {
          var chord = s.chord === null ? '' : (isChord(s.chord) ? prettyChord(transposeChord(s.chord, semitones, flats)) : s.chord);
          html += '<span class="cp-seg">' +
            (b.hasChords ? '<span class="cp-chord">' + (chord ? escapeHtml(chord) : '&nbsp;') + '</span>' : '') +
            '<span class="cp-lyric">' + (s.text ? escapeHtml(s.text).replace(/ /g, '&nbsp;') : (b.lyrics ? '' : '&nbsp;')) + '</span></span>';
        });
        html += '</div>';
      }
    });
    if (open) html += '</div>';
    return html;
  }

  function hasChords(text) {
    return /\[[^\]]+\]/.test(String(text || '')) || parse(text).some(function (b) { return b.type === 'bars'; });
  }

  // Compases en orden de interpretación: [["Bm7"], ["Bm7"], ["Em7"], ["F#7b9"], …]
  // Si la canción solo tiene letra con acordes, cuenta un acorde por compás.
  function bars(text) {
    var blocks = parse(text);
    var out = [];
    var hasBarLines = blocks.some(function (b) { return b.type === 'bars'; });
    blocks.forEach(function (b) {
      if (hasBarLines && b.type === 'bars') {
        b.bars.forEach(function (bar) {
          if (bar.empty) return;
          if (bar.repeat && out.length) out.push(out[out.length - 1].slice());
          else if (bar.nc) out.push([]);
          else out.push(bar.chords.slice());
        });
      } else if (!hasBarLines && b.type === 'line') {
        b.segs.forEach(function (s) {
          if (s.chord && isChord(s.chord)) out.push([s.chord]);
        });
      }
    });
    // Rellena compases N.C. con el acorde anterior para no dejar huecos al tocar.
    for (var i = 0; i < out.length; i++) if (!out[i].length && i > 0) out[i] = out[i - 1].slice();
    return out.filter(function (b) { return b.length; });
  }

  // Datos de cabecera: {title}, {key}, {tempo}, {time}, {artist}, {style}
  function meta(text) {
    var o = {};
    parse(text).forEach(function (b) {
      if (b.type === 'title' && !o.title) o.title = b.text;
      if (b.type === 'meta') o[b.name] = b.value;
    });
    return o;
  }

  // ---------- Importar desde iReal Pro ----------
  function obfusc50(s) {
    var n = s.split('');
    for (var i = 0; i < 5; i++) {
      n[49 - i] = s[i];
      n[i] = s[49 - i];
    }
    for (var j = 10; j < 24; j++) {
      n[49 - j] = s[j];
      n[j] = s[49 - j];
    }
    return n.join('');
  }

  function unscramble(s) {
    var r = '';
    while (s.length > 50) {
      var p = s.substring(0, 50);
      s = s.substring(50);
      r += s.length < 2 ? p : obfusc50(p);
    }
    return r + s;
  }

  // Notación de iReal Pro → notación habitual.
  function irealChord(c) {
    var m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(c);
    if (!m) return c;
    var q = m[2]
      .replace(/^-\^7?/, 'm(maj7)')
      .replace(/^-/, 'm')
      .replace(/^\^(\d+)/, 'maj$1')
      .replace(/^\^/, 'maj7')
      .replace(/^h7?/, 'm7b5')
      .replace(/^o7/, 'dim7')
      .replace(/^o/, 'dim')
      .replace(/^\+/, 'aug');
    return m[1] + q + (m[3] ? '/' + m[3] : '');
  }

  var SECTION_NAMES = { i: 'Intro', v: 'Verso' };
  var IREAL_CHORD = /^([A-GW][#b]?)([+\-^\dhob#suadlt]*)(\/[A-G][#b]?)?/;

  function parseIRealMusic(music) {
    var s = unscramble(music)
      .replace(/XyQ/g, ' ')
      .replace(/Kcl/g, '| x')
      .replace(/LZ/g, '|');
    var measures = [];
    var cur = null;
    var pendingSection = null;
    var pendingStartRepeat = false;
    var curEnding = 0;
    var pendingJump = null;
    var time = null;
    var lastRoot = null;
    var skipNext = false;
    var segnoIdx = null;
    var codaMarks = [];

    function hasContent(m) {
      return Boolean(m && (m.chords.length || m.repeat || m.nc || m.repeat2));
    }
    function newMeasure() {
      if (cur && !hasContent(cur)) {
        // compás vacío: reutilizarlo
        if (pendingSection) cur.section = pendingSection;
        return cur;
      }
      cur = { chords: [], section: pendingSection, startRepeat: false, endRepeat: false, ending: curEnding, repeat: false, nc: false };
      pendingSection = null;
      measures.push(cur);
      return cur;
    }
    function ensure() {
      if (!cur) newMeasure();
      if (pendingSection) { cur.section = cur.section || pendingSection; pendingSection = null; }
      if (pendingStartRepeat) { cur.startRepeat = true; pendingStartRepeat = false; }
      return cur;
    }

    var i = 0;
    while (i < s.length) {
      var ch = s[i];
      var rest = s.slice(i);
      var mm;
      if (ch === '*' && i + 1 < s.length) {
        var lab = s[i + 1];
        pendingSection = SECTION_NAMES[lab] || lab.toUpperCase();
        if (cur && !hasContent(cur)) cur.section = pendingSection, pendingSection = null;
        i += 2;
      } else if ((mm = /^T(\d)(\d)/.exec(rest))) {
        var num = mm[1] + mm[2];
        time = num === '12' ? '12/8' : mm[1] + '/' + mm[2];
        i += 3;
      } else if (ch === '<') {
        var close = s.indexOf('>', i);
        var comment = s.slice(i + 1, close < 0 ? s.length : close).toLowerCase().replace(/\s+/g, ' ').trim();
        if (/^fine$/.test(comment)) ensure().fine = true;
        else if (/d\.?\s?c\.? al fine/.test(comment)) pendingJump = 'dcFine';
        else if (/d\.?\s?c\.? al coda/.test(comment)) pendingJump = 'dcCoda';
        else if (/d\.?\s?s\.? al coda/.test(comment)) pendingJump = 'dsCoda';
        else if (/d\.?\s?s\.? al fine/.test(comment)) pendingJump = 'dsFine';
        else if (/d\.?\s?c\.? al (3rd|third) ending/.test(comment)) pendingJump = 'dcEnding3';
        else if (/d\.?\s?c\.? al (2nd|second) ending/.test(comment)) pendingJump = 'dcEnding2';
        i = close < 0 ? s.length : close + 1;
      } else if (ch === 'S') {
        segnoIdx = hasContent(cur) ? measures.length : Math.max(0, measures.length - 1);
        i++;
      } else if (ch === 'Q') {
        codaMarks.push(hasContent(cur) ? measures.length - 1 : Math.max(0, measures.length - (cur ? 1 : 0)));
        i++;
      } else if (ch === '(') {
        var close2 = s.indexOf(')', i);
        i = close2 < 0 ? s.length : close2 + 1;
      } else if (ch === '{') {
        curEnding = 0;
        if (hasContent(cur)) newMeasure();
        pendingStartRepeat = true;
        if (cur && !hasContent(cur)) { cur.startRepeat = true; pendingStartRepeat = false; }
        i++;
      } else if (ch === '}') {
        if (cur) cur.endRepeat = true;
        curEnding = 0;
        newMeasure();
        i++;
      } else if (ch === '|' || ch === '[' || ch === ']' || ch === 'Z') {
        if (skipNext && ch === '|') { skipNext = false; i++; continue; }
        if (ch !== '|') curEnding = 0;
        if ((ch === ']' || ch === 'Z') && pendingJump) {
          // El salto se hace al final de la sección donde aparece la indicación.
          var target = hasContent(cur) ? cur : measures[measures.length - 1];
          for (var b = measures.length - 1; b >= 0 && !hasContent(target); b--) target = measures[b];
          if (target) target.jump = pendingJump;
          pendingJump = null;
        }
        if (hasContent(cur)) newMeasure();
        if (ch !== '|' && cur && !hasContent(cur)) cur.ending = 0;
        i++;
      } else if ((mm = /^N(\d)/.exec(rest))) {
        curEnding = Number(mm[1]);
        if (hasContent(cur)) newMeasure();
        if (cur) cur.ending = curEnding;
        i += 2;
      } else if (ch === 'x') {
        ensure().repeat = true;
        i++;
      } else if (ch === 'r') {
        // repite los dos compases anteriores (ocupa este compás y el siguiente)
        var m1 = ensure();
        m1.repeat2 = true;
        skipNext = true;
        i++;
      } else if (ch === 'n') {
        ensure().nc = true;
        i++;
      } else if ((mm = IREAL_CHORD.exec(rest)) && mm[0].length) {
        var chord = mm[0];
        var adv = mm[0].length;
        // 's' (pequeño) y 'l' (grande) al final son marcas de tamaño, no parte del acorde.
        while (/[sl]$/.test(chord) && !/sus$/.test(chord)) chord = chord.slice(0, -1);
        if (chord[0] === 'W') chord = (lastRoot || 'C') + chord.slice(1);
        else lastRoot = mm[1];
        ensure().chords.push(irealChord(chord));
        i += adv;
      } else {
        i++; // espacios, comas, Y, p, s, l, f, U, S, Q…
      }
    }
    if (pendingJump) {
      for (var lj = measures.length - 1; lj >= 0; lj--) if (hasContent(measures[lj])) { measures[lj].jump = pendingJump; break; }
    }
    // Marcas de segno y coda por objeto (antes de quitar los compases vacíos).
    if (segnoIdx !== null && measures[segnoIdx]) measures[segnoIdx].segno = true;
    if (codaMarks[0] !== undefined && measures[codaMarks[0]]) measures[codaMarks[0]].toCoda = true;
    if (codaMarks[1] !== undefined && measures[codaMarks[1]]) measures[codaMarks[1]].codaStart = true;
    var keep = function (m) { return m.chords.length || m.repeat || m.nc || m.repeat2; };
    // Si un compás vacío llevaba una marca, se pasa al siguiente con contenido.
    for (var q = 0; q < measures.length; q++) {
      if (!keep(measures[q])) {
        var nx = measures[q + 1];
        if (nx) ['segno', 'codaStart', 'startRepeat', 'section'].forEach(function (f) { if (measures[q][f] && !nx[f]) nx[f] = measures[q][f]; });
        if (nx && measures[q].ending && !nx.ending) nx.ending = measures[q].ending;
        var pv = measures[q - 1];
        if (pv) ['endRepeat', 'toCoda', 'fine', 'jump'].forEach(function (f) { if (measures[q][f] && !pv[f]) pv[f] = measures[q][f]; });
      }
    }
    measures = measures.filter(keep);

    // Desplegar repeticiones {…} con casillas (1.ª, 2.ª, 3.ª) y saltos D.C./D.S., en orden de interpretación.
    var played = [];
    var n = measures.length;
    var maxEnding = 0;
    measures.forEach(function (m) { if (m.ending > maxEnding) maxEnding = m.ending; });
    function laterEnding(from, num) {
      for (var a = from; a < n; a++) {
        if (measures[a].startRepeat && a > from) return false;
        if (measures[a].ending === num) return true;
      }
      return false;
    }
    function jumpPass(type, lastRs) {
      var from = 0;
      var target = 0;
      if (/^ds/.test(type)) {
        for (var sg = 0; sg < n; sg++) if (measures[sg].segno) { from = sg; break; }
      }
      if (type === 'dcEnding3' || type === 'dcEnding2') {
        from = lastRs;
        target = type === 'dcEnding3' ? 3 : 2;
      }
      var toCoda = /Coda$/.test(type);
      for (var k2 = from; k2 < n && guard++ < 4000; k2++) {
        var mk = measures[k2];
        if (mk.ending && (target ? mk.ending !== target : mk.ending !== maxEnding)) continue;
        played.push(mk);
        if (/Fine$/.test(type) && mk.fine) return;
        if (toCoda && mk.toCoda) {
          for (var c2 = k2 + 1; c2 < n; c2++) {
            if (measures[c2].codaStart) {
              for (var c3 = c2; c3 < n; c3++) played.push(measures[c3]);
              break;
            }
          }
          return;
        }
      }
    }
    var idx = 0;
    var rs = 0;
    var passNo = 1;
    var returning = false;
    var guard = 0;
    while (idx < n && guard++ < 4000) {
      var me = measures[idx];
      if (me.startRepeat && !(returning && idx === rs)) { rs = idx; passNo = 1; }
      returning = false;
      if (me.ending && me.ending !== passNo) { idx++; continue; }
      played.push(me);
      if (me.jump) { jumpPass(me.jump, rs); break; }
      if (me.endRepeat && (passNo === 1 || laterEnding(idx + 1, passNo + 1))) {
        passNo++;
        idx = rs;
        returning = true;
        continue;
      }
      idx++;
    }

    // Resolver x (repite 1) y r (repite 2) a acordes concretos.
    var resolved = [];
    played.forEach(function (m) {
      if (m.repeat2 && resolved.length >= 2) {
        resolved.push({ chords: resolved[resolved.length - 2].chords.slice(), section: m.section, repeat: true });
        resolved.push({ chords: resolved[resolved.length - 2].chords.slice(), repeat: true });
      } else if (m.repeat && resolved.length) {
        resolved.push({ chords: resolved[resolved.length - 1].chords.slice(), section: m.section, repeat: true });
      } else if (m.nc) {
        resolved.push({ chords: [], section: m.section, nc: true });
      } else {
        resolved.push({ chords: m.chords.slice(), section: m.section });
      }
    });
    return { measures: resolved, time: time };
  }

  function chartFromMeasures(measures, perLine) {
    perLine = perLine || 4;
    var out = [];
    var line = [];
    var inSection = false;
    var prev = null;
    function flush() {
      if (line.length) out.push(line.join(' | ') + ' |');
      line = [];
    }
    measures.forEach(function (m) {
      if (m.section) {
        flush();
        if (inSection) out.push('{eoc}', '');
        out.push('{soc: ' + m.section + '}');
        inSection = true;
      }
      var same = prev && prev.join(' ') === m.chords.join(' ') && m.chords.length;
      var cell = m.nc ? 'N.C.' : same ? '[%]' : m.chords.map(function (c) { return '[' + c + ']'; }).join(' ');
      line.push(cell);
      if (line.length === perLine) flush();
      prev = m.chords;
    });
    flush();
    if (inSection) out.push('{eoc}');
    return out.join('\n');
  }

  // Devuelve las canciones de un enlace/exportación de iReal Pro: [{title, composer, style, key, tempo, time, chart}]
  function fromIReal(text) {
    var m = /(irealb(?:ook)?):\/\/([^"'\s<>]+)/.exec(String(text || ''));
    if (!m) return [];
    var obfuscated = m[1] === 'irealb';
    var decoded;
    try {
      decoded = decodeURIComponent(m[2]);
    } catch (e) {
      return [];
    }
    var chunks = decoded.split('===');
    if (chunks.length > 1 && chunks[chunks.length - 1].indexOf('=') < 0) chunks.pop(); // nombre de la lista
    var songs = [];
    chunks.forEach(function (chunk) {
      var parts = chunk.split(/=+/).filter(function (x) { return x !== ''; });
      if (parts.length < 4) return;
      var musicIdx = -1;
      for (var k = 0; k < parts.length; k++) {
        if (obfuscated ? parts[k].indexOf('1r34LbKcu7') === 0 : /[|\[{]/.test(parts[k]) && k >= 3) { musicIdx = k; break; }
      }
      if (musicIdx < 0) return;
      var title = parts[0];
      var composer = parts[1] || '';
      var style = parts[2] || '';
      var key = parts[3] || '';
      var music = obfuscated ? parts[musicIdx].slice('1r34LbKcu7'.length) : parts[musicIdx];
      var after = parts.slice(musicIdx + 1);
      var tempo = 0;
      after.forEach(function (x) { if (/^\d+$/.test(x) && !tempo && Number(x) >= 30 && Number(x) <= 400) tempo = Number(x); });
      var parsed = obfuscated ? parseIRealMusic(music) : parseIRealMusic(obfuscatePlain(music));
      var keyName = key.replace(/-$/, 'm');
      var composerName = composer.split(' ').length === 2 ? composer.split(' ').reverse().join(' ') : composer;
      var head = ['{title: ' + title.trim() + '}'];
      if (composerName && !/unknown/i.test(composerName)) head.push('{artist: ' + composerName + '}');
      if (keyName) head.push('{key: ' + keyName + '}');
      if (tempo) head.push('{tempo: ' + tempo + '}');
      if (parsed.time) head.push('{time: ' + parsed.time + '}');
      if (style) head.push('{style: ' + style + '}');
      songs.push({
        title: title.trim(),
        composer: composerName,
        style: style,
        key: keyName,
        tempo: tempo || null,
        time: parsed.time || '4/4',
        bars: parsed.measures.map(function (x) { return x.chords; }),
        chart: head.join('\n') + '\n\n' + chartFromMeasures(parsed.measures),
      });
    });
    return songs;
  }

  // irealbook:// no está codificado; se pasa por el mismo analizador (la ofuscación es su propia inversa).
  function obfuscatePlain(s) {
    var r = '';
    while (s.length > 50) {
      var p = s.substring(0, 50);
      s = s.substring(50);
      r += s.length < 2 ? p : obfusc50(p);
    }
    return r + s;
  }

  // Convierte texto pegado (de iReal Pro, de una IA o escrito a mano) al formato de Ensaya.
  // Acepta acordes sin corchetes en líneas de compases y los deja con corchetes.
  function normalizeChart(text) {
    var songs = fromIReal(text);
    if (songs.length) return songs[0].chart;
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^\s*```[a-z]*\s*$/gim, '')
      .replace(/^\n+|\s+$/g, '')
      .split('\n')
      .map(function (line) {
        var bars = parseBarLine(line);
        if (!bars) return line;
        var cells = bars.map(function (b) {
          if (b.repeat) return '[%]';
          if (b.nc) return 'N.C.';
          return b.chords.map(function (c) { return '[' + c + ']'; }).join(' ');
        });
        return cells.join(' | ') + ' |';
      })
      .join('\n');
  }

  return {
    parse: parse, render: render, transposeChord: transposeChord, transposeKey: transposeKey, isChord: isChord, hasChords: hasChords,
    bars: bars, meta: meta, prettyChord: prettyChord, normalizeQuality: normalizeQuality, fromIReal: fromIReal, normalizeChart: normalizeChart, parseBarLine: parseBarLine, unscramble: unscramble,
  };
});
