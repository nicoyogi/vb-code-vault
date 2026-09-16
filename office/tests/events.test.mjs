import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTailer } from '../lib/tailer.mjs';
import { computeStats, rotateSpool, createHub } from '../lib/events.mjs';

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
  return path.join(dir, name);
}

test('a trailing fragment is held back until its line completes', () => {
  const file = tmpFile('spool.ndjson');
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n{"partial"');
  const tailer = createTailer(file);

  assert.deepEqual(tailer.read(), ['{"a":1}', '{"a":2}']);

  fs.appendFileSync(file, ':true}\n');
  assert.deepEqual(tailer.read(), ['{"partial":true}']);

  assert.deepEqual(tailer.read(), [], 'nothing is emitted twice');
});

test('a file that shrinks is re-read from the start instead of silently skipped', () => {
  const file = tmpFile('spool.ndjson');
  fs.writeFileSync(file, '{"long":1}\n{"long":2}\n{"long":3}\n');
  const tailer = createTailer(file);
  assert.equal(tailer.read().length, 3);

  fs.writeFileSync(file, '{"rotated":1}\n');
  assert.deepEqual(tailer.read(), ['{"rotated":1}']);
});

test('a missing file is an empty read, not a crash', () => {
  const tailer = createTailer(tmpFile('never-created.ndjson'));
  assert.deepEqual(tailer.read(), []);
  assert.equal(tailer.exists, false);
});

test('skipToEnd moves past existing content without emitting it', () => {
  const file = tmpFile('spool.ndjson');
  fs.writeFileSync(file, '{"old":1}\n{"old":2}\n');
  const tailer = createTailer(file);
  tailer.skipToEnd();
  assert.deepEqual(tailer.read(), []);

  fs.appendFileSync(file, '{"new":1}\n');
  assert.deepEqual(tailer.read(), ['{"new":1}']);
});

test('rotation keeps the newest lines and leaves the file valid NDJSON', () => {
  const file = tmpFile('spool.ndjson');
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(JSON.stringify({ i }));
  fs.writeFileSync(file, lines.join('\n') + '\n');

  assert.equal(rotateSpool(file, 50, 20), true);

  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(kept.length, 20);
  assert.equal(JSON.parse(kept[kept.length - 1]).i, 99);
  assert.equal(JSON.parse(kept[0]).i, 80);
});

test('rotation is a no-op below the threshold, so a torn tail is never truncated', () => {
  const file = tmpFile('spool.ndjson');
  fs.writeFileSync(file, '{"a":1}\n{"partial"');
  assert.equal(rotateSpool(file, 50, 20), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n{"partial"');
});

test('the hub assigns increasing ids and keeps only the newest events', () => {
  const hub = createHub({ limit: 3 });
  for (let i = 0; i < 5; i++) hub.push({ n: i });

  assert.equal(hub.size, 3);
  assert.deepEqual(hub.recent().map((e) => e.n), [2, 3, 4]);
  assert.deepEqual(hub.recent().map((e) => e.id), ['e3', 'e4', 'e5']);
});

test('an update patches the ring and is not applied to an id that is gone', () => {
  const hub = createHub({ limit: 2 });
  const first = hub.push({ n: 1 });
  hub.push({ n: 2 });
  hub.push({ n: 3 });

  assert.equal(hub.update(first.id, { patched: true }), null, 'evicted event cannot be patched');
  const live = hub.recent()[0];
  assert.equal(hub.update(live.id, { patched: true }).patched, true);
});

test('tokens are summed per step, not per event', () => {
  /* One step issuing eight tool calls produces eight events sharing a step id and
     one usage object. Summing per event would multiply the cost by eight. */
  const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0, costUsd: 0.5 };
  const events = [];
  for (let i = 0; i < 8; i++) {
    events.push({ id: 'e' + i, phase: 'pre', step: 'step-1', usage, session: { sid: 's1' }, attribution: { agent: 'coder' } });
  }

  const stats = computeStats(events);
  assert.equal(stats.steps, 1);
  assert.equal(stats.inputTokens, 100);
  assert.equal(stats.costUsd, 0.5);
  assert.equal(stats.toolCalls, 8);
});

test('only pre events count as tool calls, so a call is not counted twice', () => {
  const events = [
    { phase: 'pre', session: { sid: 's' }, attribution: { agent: 'a' } },
    { phase: 'post', session: { sid: 's' }, attribution: { agent: 'a' } },
    { phase: 'lifecycle', session: { sid: 's' }, attribution: { agent: 'a' } },
  ];
  assert.equal(computeStats(events).toolCalls, 1);
  assert.equal(computeStats(events).sessions, 1);
});
