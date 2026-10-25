'use strict';
// Pruebas unitarias sin base de datos: firma S3 (ejemplo oficial de AWS), acordes y fechas.
const test = require('node:test');
const assert = require('node:assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x@localhost/x';

test('firma SigV4 coincide con el ejemplo oficial de AWS (GET Object con Range)', () => {
  const { signV4 } = require('../lib/storage');
  const { signature } = signV4({
    method: 'GET',
    path: '/test.txt',
    headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    now: new Date('2013-05-24T00:00:00Z'),
    region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.strictEqual(signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('transposición de acordes y tonalidades', () => {
  const C = require('../public/chordpro');
  assert.strictEqual(C.transposeChord('Am7/G', 2), 'Bm7/A');
  assert.strictEqual(C.transposeChord('Lam', 2), 'Sim');
  assert.strictEqual(C.transposeKey('C', 3), 'Eb');
  assert.strictEqual(C.transposeKey('E', 2), 'F#');
  assert.strictEqual(C.isChord('Estribillo'), false);
});

test('fechas en hora de Madrid, también el día del cambio de hora', () => {
  const T = require('../lib/time');
  assert.strictEqual(T.fromInputValue('2026-07-01T19:30').toISOString(), '2026-07-01T17:30:00.000Z');
  assert.strictEqual(T.fromInputValue('2026-12-01T19:30').toISOString(), '2026-12-01T18:30:00.000Z');
  assert.strictEqual(T.fromInputValue('2026-10-25T19:30').toISOString(), '2026-10-25T18:30:00.000Z');
  assert.strictEqual(T.fromInputValue('2026-03-29T12:00').toISOString(), '2026-03-29T10:00:00.000Z');
  assert.strictEqual(T.toInputValue(new Date('2026-10-25T18:30:00Z')), '2026-10-25T19:30');
  assert.strictEqual(T.fromInputValue('basura'), null);
  assert.strictEqual(T.parseDuration('3:45'), 225);
  assert.strictEqual(T.parseDuration('3:75'), undefined);
  const weeks = T.monthGrid(2026, 2);
  assert.strictEqual(weeks[0][0].key, '2026-01-26');
});

test('URL firmada coincide con el ejemplo oficial de AWS (presigned GET)', () => {
  const { presignV4 } = require('../lib/storage');
  const { signature } = presignV4({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    expires: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
    region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.strictEqual(signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});
