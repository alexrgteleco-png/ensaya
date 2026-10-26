'use strict';
// Pruebas del generador de solos.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../public/solo-engine');

function check(r) {
  r.bars.forEach((b) => {
    const sum = b.notes.reduce((a, n) => a + n.ticks, 0);
    assert.ok(Math.abs(sum - r.barTicks) < 1e-6, `el compás suma ${sum} y debería sumar ${r.barTicks}`);
    for (let k = 0; k < b.notes.length; k++) {
      const n = b.notes[k];
      if (n.tuplet && n.tupletIndex === 0) {
        for (let q = 0; q < n.tupletSize; q++) assert.strictEqual(b.notes[k + q].tupletIndex, q, 'grupo de valoración especial completo');
      }
    }
  });
}

test('todos los estilos y compases dan compases completos y terminan en la tónica', () => {
  for (const style of Object.keys(S.STYLES)) {
    for (const meter of ['4/4', '3/4', '2/4', '6/8', '12/8']) {
      for (let seed = 1; seed <= 25; seed++) {
        const st = S.STYLES[style];
        const r = S.generate({ ...st, style, meter, seed, key: 'E', bars: 8 });
        check(r);
        const last = r.bars[r.bars.length - 1].notes.slice(-1)[0];
        assert.strictEqual(last.midi % 12, 4, 'acaba en Mi');
        assert.match(r.abc, /\|\]\n$/);
      }
    }
  }
});

test('la misma semilla da el mismo solo; otra semilla, otro', () => {
  const p = { style: 'blues', scale: 'blues', key: 'A', seed: 1234 };
  assert.strictEqual(S.generate(p).abc, S.generate(p).abc);
  assert.notStrictEqual(S.generate(p).abc, S.generate({ ...p, seed: 1235 }).abc);
});

test('las notas son de la escala salvo las cromáticas de aproximación', () => {
  const r = S.generate({ style: 'rock', scale: 'pentatonica_menor', key: 'A', chromatic: 0, ornaments: 0, seed: 7, bars: 16 });
  const allowed = [9, 0, 2, 4, 7]; // La pentatónica menor
  r.events.notes.filter((n) => !n.rest).forEach((n) => assert.ok(allowed.includes(n.midi % 12), `nota fuera de escala: ${n.midi}`));
});

test('el registro y la amplitud limitan las notas', () => {
  const r = S.generate({ style: 'metal', scale: 'menor_armonica', key: 'A', register: 'grave', range: 1, seed: 3, bars: 16 });
  r.events.notes.filter((n) => !n.rest).forEach((n) => assert.ok(n.midi >= 39 && n.midi <= 54, `fuera de registro: ${n.midi}`));
});

test('más densidad, más notas; más silencios, más pausas', () => {
  const count = (p) => S.generate(p).events.notes.filter((n) => !n.rest).length;
  const rests = (p) => S.generate(p).events.notes.filter((n) => n.rest).length;
  let low = 0;
  let high = 0;
  let r0 = 0;
  let r1 = 0;
  for (let seed = 1; seed <= 20; seed++) {
    low += count({ style: 'rock', density: 2, seed, bars: 8 });
    high += count({ style: 'rock', density: 9, seed, bars: 8 });
    r0 += rests({ style: 'rock', rests: 0, seed, bars: 8 });
    r1 += rests({ style: 'rock', rests: 60, seed, bars: 8 });
  }
  assert.ok(high > low * 1.8, `densidad: ${low} → ${high}`);
  assert.ok(r1 > r0 + 20, `silencios: ${r0} → ${r1}`);
});

test('progresiones: de la letra, de los preajustes y escritas a mano', () => {
  assert.strictEqual(S.chordsFromLyrics('[Am]Hoy [F]te [F]vi [C]pasar [G]ya'), 'Am F C G');
  assert.strictEqual(S.progressionFor('A', 'blues').split(' ').length, 12);
  assert.strictEqual(S.progressionFor('E', 'andaluza'), 'Em D C B');
  const r = S.generate({ progression: 'Dm7 G7 Cmaj7', bars: 6, seed: 2 });
  assert.deepStrictEqual(r.chords, ['Dm7', 'G7', 'Cmaj7', 'Dm7', 'G7', 'Cmaj7']);
});

test('ortografía de escalas: La menor armónica lleva Sol#, La blues lleva Mi bemol', () => {
  const harm = S.spellScale('A', 'menor_armonica').notes.map((n) => n.letter + (n.acc === 1 ? '#' : n.acc === -1 ? 'b' : ''));
  assert.deepStrictEqual(harm, ['A', 'B', 'C', 'D', 'E', 'F', 'G#']);
  const blues = S.spellScale('A', 'blues').notes.map((n) => n.letter + (n.acc === 1 ? '#' : n.acc === -1 ? 'b' : ''));
  assert.deepStrictEqual(blues, ['A', 'C', 'D', 'Eb', 'E', 'G']);
});

// ---------- Versión 2: cifrado de la canción, escalas por acorde, estilos de jazz ----------
const ChordPro = require('../public/chordpro');
const fs = require('fs');
const path = require('path');
const ESTATE = ChordPro.bars(fs.readFileSync(path.join(__dirname, 'estate.chart'), 'utf8'));

test('acordes al estilo iReal/IA: calidad, notas guía y escala', () => {
  const k = S.parseKey('Bm');
  const bm7 = S.parseChord('Bm-7', { key: k });
  assert.strictEqual(bm7.kind, 'min');
  assert.deepStrictEqual(bm7.tones, [11, 2, 6, 9]);
  const g = S.parseChord('Gmaj7', { key: k });
  assert.strictEqual(g.kind, 'maj');
  assert.ok(g.tones.includes(6), 'Gmaj7 lleva Fa#');
  const f = S.parseChord('F#7b9', { key: k });
  assert.strictEqual(f.kind, 'dom');
  assert.ok(f.scalePcs.includes(7) && !f.scalePcs.includes(8), 'F#7b9 usa Sol (b9), no Sol#');
  assert.strictEqual(S.parseChord('Fm7b5').kind, 'hdim');
  assert.strictEqual(S.parseChord('D7sus').scalePcs.includes(6), false, 'D7sus evita la tercera');
  assert.strictEqual(S.parseChord('C^7').kind, 'maj');
  assert.strictEqual(S.parseChord('Ch7').kind, 'hdim');
});

test('el solo sigue la forma del cifrado (varias vueltas y resolución final)', () => {
  const r = S.generate({ ...S.paramsFor('bossa', 'medio'), key: 'Bm', form: ESTATE, choruses: 2, useSong: true, seed: 5 });
  check(r);
  assert.strictEqual(r.bars.length, ESTATE.length * 2 + 1, 'dos vueltas y un compás para resolver');
  assert.strictEqual(r.bars[0].chord.name, 'Bm-7');
  const last = r.bars[r.bars.length - 1].notes.slice(-1)[0];
  assert.strictEqual(last.midi % 12, 11, 'acaba en Si');
});

test('en los cambios de acorde predominan las notas del acorde y las tensiones', () => {
  for (const style of ['bossa', 'swing', 'balada', 'bebop']) {
    let good = 0;
    let total = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const r = S.generate({ ...S.paramsFor(style, 'medio'), key: 'Bm', form: ESTATE, seed });
      r.bars.forEach((bar) => {
        bar.notes.forEach((n) => {
          if (n.rest || n.tieFrom) return;
          const ch = bar.chords.filter((c) => c.tick <= n.tick + 1e-6).pop().chord;
          if (Math.abs(n.tick - bar.chords.filter((c) => c.tick <= n.tick + 1e-6).pop().tick) > 1e-6) return;
          total++;
          const pc = n.midi % 12;
          const tensions = [9, 13].map((d) => ch.degrees[d]).filter((x) => x !== null && x !== undefined).map((iv) => (ch.root + iv) % 12);
          if (ch.tones.includes(pc) || tensions.includes(pc)) good++;
        });
      });
    }
    assert.ok(good / total > 0.8, `${style}: ${good}/${total} notas del acorde en los cambios`);
  }
});

test('dos acordes en un compás: cada uno en su mitad', () => {
  const r = S.generate({ style: 'swing', key: 'C', form: [['Dm7', 'G7'], ['Cmaj7']], seed: 3, endOnTonic: false });
  assert.deepStrictEqual(r.bars[0].chords.map((c) => [c.name, c.tick]), [['Dm7', 0], ['G7', 8]]);
  assert.ok(/"Dm7".*"G7"/.test(r.abc.split('\n').slice(7).join(' ')));
});

test('principiante fácil: menos notas, sin tresillos ni cromatismos', () => {
  let easy = 0;
  let hard = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const e = S.generate({ ...S.paramsFor('swing', 'facil'), tuplets: false, key: 'F', seed });
    const h = S.generate({ ...S.paramsFor('swing', 'dificil'), key: 'F', seed });
    assert.ok(!/\(3/.test(e.abc), 'sin tresillos');
    easy += e.events.notes.filter((n) => !n.rest).length;
    hard += h.events.notes.filter((n) => !n.rest).length;
  }
  assert.ok(hard > easy * 1.3, `fácil ${easy}, difícil ${hard}`);
});

test('Inspírame da ajustes válidos y repetibles', () => {
  const a = S.inspire('bossa', 99);
  assert.deepStrictEqual(a, S.inspire('bossa', 99));
  assert.ok(a.flavor && a.density >= 1 && a.density <= 10);
  const r = S.generate({ ...a, key: 'Bm', form: ESTATE, seed: 99 }, { candidates: 12 });
  check(r);
});

test('parafrasear la melodía usa sus notas', () => {
  const theme = [{ tick: 0, ticks: 16, midi: 66 }, { tick: 16, ticks: 16, midi: 69 }, { tick: 32, ticks: 16, midi: 71 }];
  const r = S.generate({ style: 'balada', key: 'Bm', form: ESTATE.slice(0, 4), theme, paraphrase: 100, seed: 4, endOnTonic: false });
  const pcs = r.events.notes.filter((n) => !n.rest).map((n) => n.midi % 12);
  assert.ok(pcs.includes(6) && pcs.includes(9), 'aparecen notas del tema');
});

test('el acompañamiento de cada estilo tiene bajo, acordes y batería', () => {
  for (const style of Object.keys(S.STYLES)) {
    const r = S.generate({ ...S.paramsFor(style, 'medio'), key: 'A', seed: 2 });
    const parts = new Set(r.events.band.map((b) => b.part));
    assert.ok(parts.has('bass') && parts.has('chord') && parts.has('drum'), style);
    r.events.band.forEach((b) => assert.ok(b.time >= 0 && b.time < r.events.totalSec + 0.01, `${style}: evento fuera de tiempo`));
  }
  const bossa = S.generate({ style: 'bossa', key: 'A', seed: 2 });
  assert.ok(bossa.events.band.some((b) => b.type === 'rim'), 'bossa con aro');
  const swing = S.generate({ style: 'swing', key: 'A', seed: 2 });
  assert.ok(swing.events.band.some((b) => b.type === 'ride'), 'swing con ride');
});

test('estilo a partir del nombre de iReal Pro', () => {
  assert.strictEqual(S.styleFromName('Bossa Nova'), 'bossa');
  assert.strictEqual(S.styleFromName('Medium Swing'), 'swing');
  assert.strictEqual(S.styleFromName('Ballad'), 'balada');
  assert.strictEqual(S.styleFromName('Up Tempo Swing'), 'bebop');
});
