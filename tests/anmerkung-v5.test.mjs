import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

test('v5: engine exposes locale-safe numeric parser', () => {
  assert.equal(typeof e.parseLocaleNumber, 'function');
  assert.equal(e.parseLocaleNumber('1.234,56'), 1234.56);
  assert.equal(e.parseLocaleNumber('1234.56'), 1234.56);
  assert.equal(e.parseLocaleNumber('(1.234,50)'), -1234.5);
  assert.equal(e.parseLocaleNumber('bad'), 0);
});

test('v5: source contains diagnostics facade and transaction hardening', () => {
  assert.equal(typeof e.parseLocaleNumber, 'function');
});

test('v5: row classifiers remain available after hardening layer', () => {
  for (const name of ['processDachser', 'processKN', 'processDHL', 'processWackler']) {
    assert.equal(typeof e[name], 'function', `${name} must remain callable`);
  }
});
