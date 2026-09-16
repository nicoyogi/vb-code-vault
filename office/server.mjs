#!/usr/bin/env node
/* Command Code Office — local server.

   Bound to loopback only. It serves the office page and the repo's shared assets/
   tree so that the page and the API share an origin (no CORS, and SSE just works),
   and it exposes three routes:

     GET /api/health   liveness plus what the server can actually see on disk
     GET /api/state    the complete snapshot
     GET /api/stream   SSE: one `snapshot` frame on connect, then deltas

   The snapshot is the page's only source of truth. Deltas are a convenience — every
   (re)connection begins with a fresh snapshot, so a dropped delta can never leave
   the page permanently wrong.

   Two things are tailed: the hook spool (what is happening now) and the session
   transcripts (what it cost, and what the attribution settle pass needs). */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  REPO_ROOT,
  COMMANDCODE_DIR,
  TASK_PATH,
  SPOOL_PATH,
  SPOOL_MAX_LINES,
  SPOOL_KEEP_LINES,
  ensureRuntime,
  resolveStatic,
  isInside,
} from './lib/paths.mjs';
import { createTailer, parseJsonLines } from './lib/tailer.mjs';
import { createAttribution } from './lib/attribution.mjs';
import { createSessions } from './lib/sessions.mjs';
import { createPipeline } from './lib/pipeline.mjs';
import { createHub, computeStats, rotateSpool } from './lib/events.mjs';
import { loadAgents, findAgent } from './lib/agents.mjs';

const PORT = Number(process.env.OFFICE_PORT || 4200);
const HOST = '127.0.0.1';
const TICK_MS = 500;
const PIPELINE_EVERY = 2;
const AGENTS_EVERY = 60;
const ROTATE_EVERY = 120;
const HISTORY_IN_RING = 200;
const HEARTBEAT_MS = 15000;

const startedAt = Date.now();

const hub = createHub({ limit: 1000 });
const attribution = createAttribution();
let agents = loadAgents();
let unresolved = 0;

const sessions = createSessions({ attribution });
const pipeline = createPipeline({ onChange: (snap) => hub.emit('pipeline', snap) });

const spoolTailer = createTailer(SPOOL_PATH);
const pollState = { tick: 0, spoolLines: 0, badLines: 0 };

/* A record's identity: the session, the hook's own timestamp, the tool_use id and
   the event name. Two real hook invocations cannot share all four, but a line that
   is read a second time after the spool shrank shares all four with the copy
   already in the ring. Without this, a spool replaced by shorter content that still
   holds lines we have read would re-emit them as new events — duplicate feed rows
   and an inflated TOOL CALLS figure. The set is bounded so a long session cannot
   grow it without limit. */
const SEEN_LIMIT = 8000;
const seenRecords = new Set();

function firstSight(record) {
  const key = `${record.sid || ''}|${record.ts || ''}|${record.tu || ''}|${record.ev || ''}`;
  if (seenRecords.has(key)) return false;
  seenRecords.add(key);
  if (seenRecords.size > SEEN_LIMIT) seenRecords.delete(seenRecords.values().next().value);
  return true;
}

/* A desk counts as working only while there is evidence from the last minute:
   `busy` used to mean "some event in the ring carries this name", which stays true
   for hours after the agent stopped. */
const BUSY_WINDOW_MS = 60_000;

/* The hook's own timestamp when the record has one. A boot replay re-assembles old
   lines with `at` = now, so recency read from `at` would light every replayed desk
   up for a minute after a restart. */
function observedAt(event) {
  if (typeof event.ts === 'string') {
    const ms = Date.parse(event.ts);
    if (Number.isFinite(ms)) return ms;
  }
  return event.at;
}

/* ── Record assembly ─────────────────────────────────────────────────────────
   The hub knows nothing about hooks or transcripts; this is where the two meet. */
function assemble(rec, historical) {
  const sid = rec.sid || '';
  const result = attribution.apply(rec) || {
    attribution: { agent: null, confidence: 'unknown', basis: 'no-session', settled: true, candidates: [], source: 'stack' },
    delegationId: null,
  };

  const session = sessions.get(sid);
  const phase = rec.ev === 'PreToolUse' ? 'pre' : rec.ev === 'PostToolUse' ? 'post' : 'lifecycle';

  return {
    at: Date.now(),
    ts: rec.ts || null,
    historical: Boolean(historical),
    phase,
    event: rec.ev || null,
    tool: rec.tool || null,
    display: rec.display || (rec.tool ? String(rec.tool).toUpperCase() : null),
    target: rec.summary || '',
    mode: rec.mode || null,
    session: {
      sid,
      slug: session ? session.slug : null,
      title: session ? session.title : null,
      cwd: rec.cwd || null,
    },
    toolUseId: rec.tu || null,
    delegationId: result.delegationId,
    attribution: result.attribution,
    /* Filled by the settle pass once the transcript catches up. */
    step: null,
    model: null,
    effort: null,
    usage: null,
    delegation: rec.tool === 'agent'
      ? { agent: rec.sub || null, description: rec.desc || null, background: rec.bg === true }
      : null,
  };
}

/* ── Startup rebuild ─────────────────────────────────────────────────────────
   The whole spool is replayed on boot, not just its tail. A server started
   mid-delegation would otherwise never see the `agent` call that opened it, and
   every later event would be permanently misattributed. State is rebuilt from
   every line; only the recent tail reaches the ring, so the page opens on an
   occupied office without shipping a megabyte of history to the browser. */
function rebuild() {
  let text = '';
  try {
    text = fs.readFileSync(SPOOL_PATH, 'utf8');
  } catch {
    return { lines: 0, kept: 0 };
  }

  const lines = text.split('\n').filter((l) => l.length > 0);
  const records = [];
  pollState.badLines += parseJsonLines(lines, (o) => records.push(o));
  pollState.spoolLines = records.length;

  /* Seed the identity set from the whole file, not just the part that reaches the
     ring: a later shrink that re-reads an older line must find it already seen. */
  const fresh = records.filter(firstSight);
  const keepFrom = Math.max(0, fresh.length - HISTORY_IN_RING);
  for (let i = 0; i < fresh.length; i++) {
    const record = fresh[i];
    if (record.sid) sessions.track(record.sid);
    if (i < keepFrom) {
      /* State only: no event record, no delta. */
      attribution.apply(record);
    } else {
      hub.push(assemble(record, true));
    }
  }
  return { lines: records.length, kept: fresh.length - keepFrom };
}

/* ── The settle pass ─────────────────────────────────────────────────────────
   The transcript only reveals a step's tool_use id about a second after that step
   completes, so live classification has to be provisional. Once the watermark
   covers an event, `orchestratorIds` is complete for that instant and the answer
   becomes provable: an id that is absent from it cannot be an orchestrator call. */
function settlePass() {
  const now = Date.now();
  let promoted = 0;

  for (const event of hub.recent()) {
    if (!event.attribution || event.attribution.settled) continue;
    if (!event.session || !event.session.sid) continue;
    const ts = event.ts ? Date.parse(event.ts) : event.at;
    if (!Number.isFinite(ts)) continue;

    const settled = attribution.settleFor(event.session.sid, event.attribution, ts, event.toolUseId);
    if (!settled) continue;

    const patch = { attribution: settled };
    const step = sessions.lookupStep(event.session.sid, event.toolUseId);
    if (step) {
      patch.step = step.step;
      patch.model = step.model;
      patch.effort = step.effort;
      patch.usage = step.usage;
    }
    if (settled.confidence === 'unknown') unresolved++;
    hub.update(event.id, patch);
    promoted++;
  }

  /* Join already-settled events to their step as the transcript fills in. */
  for (const event of hub.recent()) {
    if (event.step || !event.attribution || !event.attribution.settled) continue;
    if (!event.session || !event.session.sid) continue;
    const step = sessions.lookupStep(event.session.sid, event.toolUseId);
    if (!step) continue;
    hub.update(event.id, { step: step.step, model: step.model, effort: step.effort, usage: step.usage });
    promoted++;
  }

  /* The desk grid is derived from the ring and from the open delegation set, and a
     promotion changes both, so the page has to be told: otherwise it keeps showing
     the provisional name and count until the next tool call, which may be minutes. */
  if (promoted) {
    hub.emit('stats', buildStats());
    hub.emit('desks', buildDesks());
  }
  return promoted;
}

function tick() {
  pollState.tick++;

  const lines = spoolTailer.read();
  let pushed = 0;
  if (lines.length) {
    pollState.spoolLines += lines.length;
    const records = [];
    pollState.badLines += parseJsonLines(lines, (o) => records.push(o));
    for (const record of records) {
      /* A line read a second time is a re-read, never a new hook invocation. */
      if (!firstSight(record)) continue;
      if (record.sid) sessions.track(record.sid);
      hub.push(assemble(record, false));
      pushed++;
    }
  }

  const changed = sessions.poll();
  const swept = attribution.sweep();
  settlePass();

  if (changed.length) hub.emit('sessions', sessions.snapshot());
  if (swept) {
    /* A sweep closes a delegation that never reported an end, which changes the
       open delegation set the desks are built from. */
    hub.emit('stats', buildStats());
    hub.emit('desks', buildDesks());
  }

  /* Desk occupancy and the totals are derived from the ring, so the server owns
     them and the page just renders. Emitted at most once per tick regardless of
     how many events arrived, which keeps a burst of tool calls from turning into
     a burst of deltas. */
  if (pushed) {
    hub.emit('desks', buildDesks());
    hub.emit('stats', buildStats());
  }

  if (pollState.tick % PIPELINE_EVERY === 0) pipeline.poll();

  if (pollState.tick % AGENTS_EVERY === 0) {
    const next = loadAgents();
    if (JSON.stringify(next) !== JSON.stringify(agents)) {
      agents = next;
      hub.emit('desks', buildDesks());
    }
  }

  if (pollState.tick % ROTATE_EVERY === 0) {
    ensureRuntime();
    if (rotateSpool(SPOOL_PATH, SPOOL_MAX_LINES, SPOOL_KEEP_LINES)) {
      /* The kept lines are already in the ring; jumping to the end stops them
         being emitted a second time. A false return means the spool was not rebuilt
         by us, so it must be re-read from zero and the identity set left to drop
         whatever has already been seen. */
      spoolTailer.skipToEnd();
    }
  }
}

/* ── Snapshot ─────────────────────────────────────────────────────────────── */
function buildDesks() {
  const now = Date.now();
  const desks = [];

  /* Only the orchestrator's own tool calls are observable: a sub-agent's tool calls
     fire no hooks at all, so nothing in the ring is evidence that a delegated agent
     is working. The events that arrive under a delegate's name are the
     orchestrator's own calls, labelled with the delegation that was open at the
     time, and counting them as that agent's work is what produced a fabricated tool
     count and a desk that stayed lit for hours. */
  const orchestrator = {
    events: 0,
    tools: new Map(),
    lastAt: null,
    lastTool: null,
    lastTarget: '',
    lastConfidence: null,
    task: null,
  };

  for (const event of hub.recent()) {
    const attributed = event.attribution || {};
    if (attributed.agent !== 'orchestrator') continue;
    orchestrator.events++;
    orchestrator.lastAt = observedAt(event);
    orchestrator.lastConfidence = attributed.confidence;
    orchestrator.lastTarget = event.target;
    if (event.display) {
      orchestrator.lastTool = event.display;
      orchestrator.tools.set(event.display, (orchestrator.tools.get(event.display) || 0) + 1);
    }
    if (event.delegation && event.delegation.description) orchestrator.task = event.delegation.description;
  }

  /* The open delegation set is the primary signal for a delegated desk, and the only
     one there is: while a delegation is open the desk is occupied but nothing about
     that agent's own work can be seen, so it reports no tool calls of its own and
     the confidence the evidence supports. */
  const delegated = new Map();
  for (const session of attribution.snapshot()) {
    for (const entry of session.open) {
      const name = entry.agent;
      if (!name || name === 'unknown-agent') continue;
      const open = delegated.get(name);
      if (open) {
        if (!open.description && entry.description) open.description = entry.description;
      } else {
        delegated.set(name, { description: entry.description || '', openedAt: entry.openedAt });
      }
    }
  }

  function stateOf(name, open) {
    if (open) {
      return {
        busy: true,
        delegated: true,
        events: 0,
        tools: [],
        lastTool: null,
        lastTarget: '',
        lastAt: open.openedAt,
        task: open.description || null,
        confidence: 'inferred',
      };
    }
    if (name !== 'orchestrator') {
      return {
        busy: false,
        delegated: false,
        events: 0,
        tools: [],
        lastTool: null,
        lastTarget: '',
        lastAt: null,
        task: null,
        confidence: null,
      };
    }
    return {
      busy: orchestrator.lastAt !== null && now - orchestrator.lastAt <= BUSY_WINDOW_MS,
      delegated: false,
      events: orchestrator.events,
      tools: [...orchestrator.tools.entries()].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count),
      lastTool: orchestrator.lastTool,
      lastTarget: orchestrator.lastTarget,
      lastAt: orchestrator.lastAt,
      task: orchestrator.task,
      confidence: orchestrator.lastConfidence,
    };
  }

  /* One desk per agent in the roster, busy or not: an idle agent is information,
     and hiding it would make the grid jump around as work moves between agents. */
  for (const agent of agents) {
    desks.push({
      name: agent.name,
      description: agent.description,
      model: agent.model,
      builtIn: agent.builtIn,
      ...stateOf(agent.name, delegated.get(agent.name)),
    });
  }

  /* Anything delegated or working under a name that is not in the roster (a
     delegation to an agent with no file, or a built-in) still gets a desk rather
     than vanishing. */
  const extras = new Set(delegated.keys());
  if (orchestrator.events) extras.add('orchestrator');
  for (const name of extras) {
    if (findAgent(agents, name)) continue;
    desks.push({
      name,
      description: '',
      model: null,
      builtIn: false,
      phantom: true,
      ...stateOf(name, delegated.get(name)),
    });
  }

  return desks;
}

function buildStats() {
  const stats = computeStats(hub.recent());
  const sessionList = sessions.snapshot();

  /* Tokens, cost and steps come from the session transcripts, not from the ring.
     The ring holds at most 1000 events and a restart replays only the last 200, so
     a ring rollup silently rewinds while the page shows it under "Session totals".
     `sessions[].totals` is the product's own per-transcript figure, which is what a
     session total has to be. Tool calls and events stay ring figures: they say what
     the hooks reported, and nothing on disk counts them. */
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let steps = 0;
  for (const session of sessionList) {
    inputTokens += session.totals.inputTokens;
    outputTokens += session.totals.outputTokens;
    cacheReadTokens += session.totals.cacheReadTokens;
    cacheWriteTokens += session.totals.cacheWriteTokens;
    costUsd += session.totals.costUsd;
    steps += session.totals.steps;
  }

  return {
    ...stats,
    steps,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: Number(costUsd.toFixed(6)),
    sessions: sessionList,
    attribution: {
      unresolved,
      syntheticCloses: attribution.snapshot().reduce((a, s) => a + s.syntheticCloses, 0),
      badLines: pollState.badLines,
    },
  };
}

function buildState() {
  return {
    now: Date.now(),
    startedAt,
    server: {
      port: PORT,
      root: REPO_ROOT,
      spool: SPOOL_PATH,
      spoolLines: pollState.spoolLines,
      inRing: hub.size,
      subscribers: hub.subscribers,
      hasTask: fs.existsSync(TASK_PATH),
      hasCommandCodeDir: Boolean(COMMANDCODE_DIR) && fs.existsSync(COMMANDCODE_DIR),
    },
    desks: buildDesks(),
    sessions: sessions.snapshot(),
    pipeline: pipeline.snapshot(),
    stats: buildStats(),
    events: hub.recent(250),
  };
}

/* ── HTTP ─────────────────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function json(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function serveStatic(res, urlPath) {
  const found = resolveStatic(urlPath);
  if (!found || !isInside(found.base, found.file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  let body;
  try {
    body = fs.readFileSync(found.file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(found.file).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function openStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const send = (name, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  /* Every connection opens with the whole state, so a reconnect is always exact. */
  send('snapshot', buildState());

  const unsubscribe = hub.subscribe(send);
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
}

/* Binding to loopback is not enough on its own: a page on an attacker-controlled
   hostname can resolve that name to 127.0.0.1 and reach this server with its own
   `Host` header, which is DNS rebinding. The spool holds real command text and
   absolute paths, so only the two names a local browser can legitimately use are
   accepted, on the API routes and the static routes alike. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

function hostAllowed(req) {
  const raw = req.headers.host;
  if (typeof raw !== 'string' || !raw) return false;
  const lower = raw.trim().toLowerCase();
  /* `name:port`, or `[::1]:port` for an IPv6 literal. */
  const name = lower.startsWith('[')
    ? lower.slice(1, lower.includes(']') ? lower.indexOf(']') : lower.length)
    : lower.split(':')[0];
  return ALLOWED_HOSTS.has(name);
}

const server = http.createServer((req, res) => {
  if (!hostAllowed(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden: this office only answers requests addressed to 127.0.0.1 or localhost.');
    return;
  }

  const urlPath = (req.url || '/').split('?')[0];

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, { error: 'method not allowed' }, 405);
    return;
  }

  if (urlPath === '/api/health') {
    json(res, {
      ok: true,
      startedAt,
      uptimeMs: Date.now() - startedAt,
      pid: process.pid,
      port: PORT,
      root: REPO_ROOT,
      spool: SPOOL_PATH,
      spoolLines: pollState.spoolLines,
      badLines: pollState.badLines,
      sessionsTracked: sessions.trackedCount(),
      subscribers: hub.subscribers,
      agents: agents.length,
      hasTask: fs.existsSync(TASK_PATH),
      hasCommandCodeDir: Boolean(COMMANDCODE_DIR) && fs.existsSync(COMMANDCODE_DIR),
    });
    return;
  }

  if (urlPath === '/api/state') {
    json(res, buildState());
    return;
  }

  if (urlPath === '/api/stream') {
    openStream(req, res);
    return;
  }

  serveStatic(res, urlPath);
});

ensureRuntime();
const rebuilt = rebuild();
spoolTailer.skipToEnd();
setInterval(tick, TICK_MS).unref?.();

/* A second instance, or a port something else already holds, must say so in one
   line rather than dying with an unhandled 'error' event stack trace and no
   stdout. */
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Command Code Office: port ${PORT} is already in use.`);
    console.error('  Another office may still be running. Start this one on a free port instead:');
    console.error('    set OFFICE_PORT=4300 && node office/server.mjs   (cmd.exe)');
    console.error('    OFFICE_PORT=4300 node office/server.mjs          (sh)');
    process.exit(1);
  }
  console.error(`Command Code Office: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Command Code Office  http://${HOST}:${PORT}`);
  console.log(`  root        ${REPO_ROOT}`);
  console.log(`  spool       ${SPOOL_PATH}`);
  console.log(`  replayed    ${rebuilt.lines} line(s), ${rebuilt.kept} kept in the ring`);
  console.log(`  agents      ${agents.length}`);
  if (!COMMANDCODE_DIR || !fs.existsSync(COMMANDCODE_DIR)) {
    console.log('  note        ~/.commandcode not found: no transcripts or user agents to read');
  }
  if (!fs.existsSync(TASK_PATH)) {
    console.log('  note        .agent/task.json not found: the pipeline rail will be empty');
  }
  console.log('  hooks       wire .commandcode/settings.json (see office/README.md)');
});
