/* The live hub: the event ring, and fan-out to every connected page.

   Deliberately dumb. It knows nothing about hooks, transcripts or agents — the
   server assembles a record, and the hub assigns it a sequence number, keeps the
   recent tail, and hands it to each subscriber. Keeping the broadcast in one place
   is what makes the SSE contract easy to state: the hub only ever emits `event`
   and `event.update`, and the server adds `snapshot` on connect.

   The ring is what makes a late-joining page correct without a replay protocol:
   a connect sends one `snapshot` frame carrying the whole ring, so a tab that
   missed a hundred deltas is still exact after it reconnects. */

import fs from 'node:fs';

export function createHub({ limit = 1000 } = {}) {
  const ring = [];
  const subscribers = new Set();
  let seq = 0;

  function emit(name, data) {
    for (const send of subscribers) {
      try {
        send(name, data);
      } catch {
        subscribers.delete(send);
      }
    }
  }

  function push(event) {
    seq++;
    const record = { ...event, seq, id: `e${seq}` };
    ring.push(record);
    if (ring.length > limit) ring.splice(0, ring.length - limit);
    emit('event', record);
    return record;
  }

  function update(id, patch) {
    const index = ring.findIndex((e) => e.id === id);
    if (index === -1) return null;
    ring[index] = { ...ring[index], ...patch };
    emit('event.update', { id, ...patch });
    return ring[index];
  }

  function subscribe(send) {
    subscribers.add(send);
    return () => subscribers.delete(send);
  }

  function recent(limit = ring.length) {
    return limit >= ring.length ? ring.slice() : ring.slice(-limit);
  }

  function find(id) {
    return ring.find((e) => e.id === id) || null;
  }

  return {
    push,
    update,
    subscribe,
    recent,
    find,
    emit,
    get size() {
      return ring.length;
    },
    get subscribers() {
      return subscribers.size;
    },
    get seq() {
      return seq;
    },
  };
}

/* Rollups over the ring. Tokens are summed by STEP, not by event: one step can
   issue eight tool calls, and each of those events carries the same step id, so
   summing per event would multiply the cost by the batch size. */
export function computeStats(events) {
  const steps = new Map();
  const byAgent = new Map();
  const sessions = new Set();
  let toolCalls = 0;

  for (const e of events) {
    if (e.session && e.session.sid) sessions.add(e.session.sid);
    if (e.phase === 'pre') toolCalls++;

    const agent = (e.attribution && e.attribution.agent) || 'unattributed';
    byAgent.set(agent, (byAgent.get(agent) || 0) + 1);

    if (e.step && e.usage) steps.set(e.step, e.usage);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  for (const usage of steps.values()) {
    inputTokens += usage.inputTokens || 0;
    outputTokens += usage.outputTokens || 0;
    cacheReadTokens += usage.cacheReadTokens || 0;
    cacheWriteTokens += usage.cacheWriteTokens || 0;
    costUsd += usage.costUsd || 0;
  }

  return {
    events: events.length,
    toolCalls,
    sessions: sessions.size,
    steps: steps.size,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: Number(costUsd.toFixed(6)),
    byAgent: [...byAgent.entries()].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
  };
}

/* The spool grows for as long as the hooks fire. Rotation happens here, in the
   server, and never in the hook: a hook that read and rewrote the file would add
   latency to every tool call it observes.

   The spool is rewritten by renaming it aside first and then building a fresh one,
   never by reading a temp copy over the live path. A hook append that races a
   read-then-rename lands between the two and is silently thrown away, and on
   Windows the rename over a file a hook holds open fails outright. A rename is a
   single step: an append either happens before it (and is read from the renamed
   file below) or after it (and creates a fresh spool, which must not be clobbered). */
export function rotateSpool(file, maxLines, keepLines) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  /* Only count complete lines: a torn tail must not be counted or kept as one. */
  const lines = text.split('\n');
  const trailing = lines.pop() ?? '';
  if (lines.length <= maxLines) return false;

  const kept = lines.slice(-keepLines);
  const body = kept.join('\n') + (trailing ? `\n${trailing}` : '') + '\n';
  const aside = `${file}.rotate`;

  try {
    fs.renameSync(file, aside);
  } catch {
    /* Windows refuses the rename while a hook holds the file open. Nothing has
       changed yet, so the next rotation simply tries again. */
    return false;
  }

  let rebuilt = true;
  try {
    /* 'wx': never replace a spool that a hook created in the gap. */
    fs.writeFileSync(file, body, { flag: 'wx' });
  } catch {
    rebuilt = false;
    if (!fs.existsSync(file)) {
      /* The write failed and no hook took over: put the old spool back rather than
         leaving the runtime with none at all. */
      try {
        fs.renameSync(aside, file);
      } catch {
        /* nothing further to try; the ring still holds the recent events */
      }
    }
  }

  try {
    fs.unlinkSync(aside);
  } catch {
    /* A stale `.rotate` is harmless: the next rotation renames over it. */
  }

  /* The caller skips to the end only when the kept lines are back on disk — they
     are already in the ring, so re-reading them would duplicate every event. When
     `false` comes back, a hook owns the fresh spool and the tailer must re-read it. */
  return rebuilt;
}
