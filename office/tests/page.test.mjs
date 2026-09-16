import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveStatic, isInside, PUBLIC_DIR, ASSETS_DIR } from '../lib/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'office.html'), 'utf8');
const JS = fs.readFileSync(path.join(PUBLIC_DIR, 'office.js'), 'utf8');
const CSS = fs.readFileSync(path.join(PUBLIC_DIR, 'office.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(HERE, '..', 'server.mjs'), 'utf8');

test('every element the script looks up exists in the markup', () => {
  /* A renamed or deleted id is a silent null at runtime, which is the classic way
     a live page renders nothing and reports no error. */
  const wanted = [...JS.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(wanted.length > 5, 'expected the page to look up several elements');

  const missing = wanted.filter((id) => !HTML.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

/* Only the stream listeners. The page also binds `click` on its own buttons, which
   is DOM wiring, not the wire contract. `open`, `error` and `message` are EventSource
   built-ins and are not ours to emit. */
const BUILT_IN = new Set(['open', 'error', 'message']);
const STREAM_LISTENERS = [...JS.matchAll(/source\.addEventListener\('([^']+)'/g)]
  .map((m) => m[1])
  .filter((name) => !BUILT_IN.has(name));

/* `event` and `event.update` are emitted by the hub, not by the server, so the
   contract has to be read from both files or those two would look unemitted. */
const HUB = fs.readFileSync(path.join(HERE, '..', 'lib', 'events.mjs'), 'utf8');

const EMITTED = new Set([
  ...[...SERVER.matchAll(/hub\.emit\('([^']+)'/g)].map((m) => m[1]),
  ...[...SERVER.matchAll(/send\('([^']+)'/g)].map((m) => m[1]),
  ...[...HUB.matchAll(/emit\('([^']+)'/g)].map((m) => m[1]),
]);

test('every stream event the page listens for is one the server emits', () => {
  const orphans = STREAM_LISTENERS.filter((name) => !EMITTED.has(name));
  assert.deepEqual(orphans, [], `the page listens for events nothing emits: ${orphans.join(', ')}`);
});

test('the emit and listen sets are the documented ones', () => {
  assert.deepEqual([...STREAM_LISTENERS].sort(), ['desks', 'event', 'event.update', 'pipeline', 'sessions', 'snapshot', 'stats']);
});

test('static serving is an allowlist', () => {
  assert.ok(resolveStatic('/'), 'the page itself');
  assert.ok(resolveStatic('/office.css'));
  assert.ok(resolveStatic('/office.js'));

  assert.equal(resolveStatic('/data/'), null, 'the data directory is not reachable');
  assert.equal(resolveStatic('/.commandcode/AGENTS.md'), null);
  assert.equal(resolveStatic('/.agent/task.json'), null);
  assert.equal(resolveStatic('/package.json'), null);
  assert.equal(resolveStatic('/README.md'), null);
});

test('path traversal is rejected after resolution, not by string matching', () => {
  for (const attempt of [
    '/assets/../package.json',
    '/assets/../../etc/passwd',
    '/assets/%2e%2e/package.json',
    '/assets/..%2f..%2fpackage.json',
  ]) {
    const found = resolveStatic(attempt);
    if (found) {
      assert.equal(isInside(found.base, found.file), false, `${attempt} escaped its base`);
    }
  }
});

test('a null byte is refused rather than passed to the filesystem', () => {
  assert.equal(resolveStatic('/assets/a\0b.css'), null);
});

test('shared assets resolve into the repo assets directory', () => {
  const found = resolveStatic('/assets/grimoire-theme.css');
  assert.ok(found);
  assert.equal(found.base, ASSETS_DIR);
  assert.ok(isInside(ASSETS_DIR, found.file));
});

test('the page ships no em dash', () => {
  /* R-02. Checked here so a later edit cannot quietly reintroduce one. */
  for (const [name, text] of [['office.html', HTML], ['office.js', JS], ['office.css', CSS]]) {
    assert.equal(text.includes('\u2014'), false, `${name} contains an em dash`);
  }
});

test('the page does not use the token that fails contrast at normal size', () => {
  /* --gr-faint measures 3.14:1 against the background, below the 4.5:1 floor for
     normal text, so this page does not reference it at all. */
  assert.equal(CSS.includes('var(--gr-faint)'), false, 'office.css must not use --gr-faint');
});

test('the CSS never removes a focus outline without replacing it', () => {
  assert.equal(/outline:\s*(none|0)/.test(CSS), false, 'a removed outline must be replaced, never deleted');
  assert.ok(CSS.includes(':focus-visible'), 'expected a visible focus style');
});
