/* ChordPro: letras con acordes entre corchetes, p. ej. "[Am]Hoy te [F]vi".
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

  var CHORD_RE = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?)((?:maj|min|mi|m|M|dim|aug|sus|add|no|°|ø|\+|-|\d|\(|\)|b|#|\/?\d)*)(?:\/(Do|Re|Mi|Fa|Sol|La|Si|[A-G])([#b]?))?$/;

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
    var asFlat = transposeChord((LATIN[m[1]] || m[1]) + m[2] + (/^m(?!aj)/.test(m[3] || '') ? 'm' : ''), semitones, true);
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

  function transposeKey(key, semitones) {
    if (!key || !isChord(key)) return key;
    return transposeChord(key, semitones, usesFlats(key, semitones));
  }

  // Analiza el texto en bloques de líneas.
  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var section = null;
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var d = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(line.trim());
      if (d) {
        var name = d[1].toLowerCase();
        var value = d[2] || '';
        if (name === 'soc' || name === 'start_of_chorus') { section = 'chorus'; out.push({ type: 'start', section: 'chorus', label: value || 'Estribillo' }); return; }
        if (name === 'sov' || name === 'start_of_verse') { section = 'verse'; out.push({ type: 'start', section: 'verse', label: value }); return; }
        if (name === 'sob' || name === 'start_of_bridge') { section = 'bridge'; out.push({ type: 'start', section: 'bridge', label: value || 'Puente' }); return; }
        if (/^(eoc|eov|eob|end_of_chorus|end_of_verse|end_of_bridge)$/.test(name)) { section = null; out.push({ type: 'end' }); return; }
        if (name === 'c' || name === 'comment' || name === 'ci' || name === 'comment_italic') { out.push({ type: 'comment', text: value }); return; }
        if (name === 't' || name === 'title' || name === 'st' || name === 'subtitle') { out.push({ type: 'title', text: value }); return; }
        return; // otras directivas (key, tempo…) se ignoran al pintar
      }
      if (/^#/.test(line)) return;
      if (!line.trim()) { out.push({ type: 'blank' }); return; }
      var label = /^\[([^\]]+)\]:?$/.exec(line.trim());
      if (label && !isChord(label[1])) { out.push({ type: 'label', text: label[1] }); return; }
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
      var hasChords = segs.some(function (s) { return s.chord !== null; });
      out.push({ type: 'line', segs: segs, hasChords: hasChords, lyrics: segs.some(function (s) { return s.text.trim(); }) });
    });
    return out;
  }

  // HTML con acordes encima de la letra.
  function render(text, semitones, opts) {
    semitones = Number(semitones) || 0;
    opts = opts || {};
    var flats = opts.key ? usesFlats(opts.key, semitones) : undefined;
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
      } else if (b.type === 'label') {
        html += '<div class="cp-label">' + escapeHtml(b.text) + '</div>';
      } else if (b.type === 'blank') {
        html += '<div class="cp-blank"></div>';
      } else {
        var cls = 'cp-line' + (b.hasChords ? ' cp-has-chords' : '') + (b.lyrics ? '' : ' cp-chords-only');
        html += '<div class="' + cls + '">';
        b.segs.forEach(function (s) {
          var chord = s.chord === null ? '' : (isChord(s.chord) ? transposeChord(s.chord, semitones, flats) : s.chord);
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
    return /\[[^\]]+\]/.test(String(text || ''));
  }

  return { parse: parse, render: render, transposeChord: transposeChord, transposeKey: transposeKey, isChord: isChord, hasChords: hasChords };
});
