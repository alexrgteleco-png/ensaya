'use strict';
// Pruebas del catálogo de sonidos (lo que no depende del navegador).
const test = require('node:test');
const assert = require('node:assert');
const SE = require('../public/sound-engine');
const S = require('../public/solo-engine');

test('nombres de archivo de las muestras (bemoles, octava MIDI)', () => {
  assert.strictEqual(SE.noteFile(60), 'C4');
  assert.strictEqual(SE.noteFile(61), 'Db4');
  assert.strictEqual(SE.noteFile(70), 'Bb4');
  assert.strictEqual(SE.noteFile(21), 'A0');
});

test('cada estilo del generador tiene guitarra, acompañamiento y bajo existentes', () => {
  for (const style of Object.keys(S.STYLES)) {
    const snd = SE.STYLE_SOUND[style];
    assert.ok(snd, `falta sonido para ${style}`);
    assert.ok(SE.INSTRUMENTS[snd.instrument] && /^gtr_/.test(snd.instrument), `guitarra de ${style}`);
    assert.ok(SE.CHORD_INSTRUMENTS[snd.chords], `acordes de ${style}`);
    assert.ok(SE.BASS_INSTRUMENTS[snd.bass], `bajo de ${style}`);
  }
});

test('hay varios pianos y todos los preajustes de efectos son válidos', () => {
  const pianos = Object.values(SE.INSTRUMENTS).filter((i) => /piano|Rhodes|Clavinet|Clave/i.test(i.name));
  assert.ok(pianos.length >= 6, `pianos: ${pianos.length}`);
  for (const [id, inst] of Object.entries(SE.INSTRUMENTS)) {
    assert.ok(SE.FX_PRESETS[inst.preset], `preajuste de ${id}`);
    const fx = SE.presetFx(id);
    for (const k of Object.keys(SE.FX_DEFAULT)) assert.ok(fx[k] !== undefined, `${id}.${k}`);
    assert.ok(SE.REVERBS[fx.reverbType], `reverb de ${id}`);
    assert.ok(SE.DELAY_TIMES[fx.delayTime], `delay de ${id}`);
  }
});
