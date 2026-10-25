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
