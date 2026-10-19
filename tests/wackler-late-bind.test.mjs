/*
 * Pins the engine half of the Wackler late-bind handshake.
 *
 * In the browser assets/wackler-ratecard-loader.js decrypts the rate cards AFTER
 * assets/anmerkung.js has evaluated, then calls wacklerRatecardsReady(). Without
 * that hook the engine keeps the eval-time snapshot of WACKLER_RATECARD (usually
 * null) and Wackler costing silently runs on the weight fallback instead of the
 * rate card. The harness loads the plaintext cards before the engine, so these
 * tests poke the bindings through the vm context instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();

test('wacklerRatecardsReady re-derives WACKLER_RC / WACKLER_BP from the late card', () => {
  assert.equal(e.evalInContext('WACKLER_BP.length'), 45);
  e.context.WACKLER_RATECARD = { tiers: [50, 100], rate() { return 0; } };
  assert.equal(e.context.wacklerRatecardsReady(), true);
  assert.equal(e.evalInContext('WACKLER_BP.length'), 2);
  assert.equal(e.evalInContext('WACKLER_RC.tiers.length'), 2);
});

test('a card-less second call clears the card but keeps the installed tier table', () => {
  /* Independent of the first test: install the two-tier table here too, so this
     one holds when run alone via --test-name-pattern. */
  e.context.WACKLER_RATECARD = { tiers: [50, 100], rate() { return 0; } };
  e.context.wacklerRatecardsReady();
  e.context.WACKLER_RATECARD = undefined;
  e.context.WACKLER_NATIONAL_RATECARD = {
    tiers: [50],
    normalizeZone() { return ''; },
    resolveZone() { return ''; },
  };
  assert.equal(e.context.wacklerRatecardsReady(), true);
  assert.equal(e.evalInContext('WACKLER_RC'), null);
  assert.equal(e.evalInContext('WACKLER_NAT_RC.tiers.length'), 1);
  assert.equal(e.evalInContext('WACKLER_BP.length'), 2);
});
