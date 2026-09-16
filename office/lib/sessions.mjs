/* Session transcripts: discovery, incremental tailing, and the token/cost rollup.

   A transcript is at ~/.commandcode/projects/<slug>/<sid>.jsonl. The slug is a
   slug of the session cwd, and the scheme is not part of the documented contract,
   so sessions are located by scanning for the id rather than reconstructing the
   slug. Only sessions whose id has appeared in the spool are ever opened — this
   server never walks the whole catalog, so it cannot leak another project's work
   into the dashboard.

   Shape (CONFIRMED, see .agent/artifacts/research.md):
     line 1  {"type":"session","version":3,"id":…,"timestamp":…,"cwd":…}
     then    {"type":"message","id","parentId","timestamp","message",
              "usage"?,"model"?,"effort"?}
   Assistant entries carry a usage object with inputTokens, outputTokens,
   cacheReadTokens, cacheWriteTokens and costUsd. Cost is stored, so nothing here
   computes prices.

   This module does not decide attribution; it hands parsed entries to the
   attribution machine and reports what came back settled. */

import fs from 'node:fs';
import path from 'node:path';
import { createTailer, parseJsonLines } from './tailer.mjs';
import { findTranscript, findSessionMeta } from './paths.mjs';

/* A transcript entry is written by the host, not by us, and it can be large: real
   transcripts reach 282 KB on a single line. The 1 MB default the spool uses is
   therefore too tight here — a read that lands mid-entry would drop the fragment,
   and a dropped entry takes its `tool_use` id with it. The settle pass reads a
   missing id as proof that the call was the delegated agent's, so a dropped entry
   becomes a confident wrong name with no `~`. This bound is a memory guard against
   a corrupt file, not a limit on what the host may write. */
const TRANSCRIPT_MAX_LINE = 16 * 1024 * 1024;

function emptyTotals() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, steps: 0 };
}

export function createSessions({ attribution, onChange = () => {} } = {}) {
  const tracked = new Map();
  let badLines = 0;

  function track(sid) {
    let s = tracked.get(sid);
    if (s) return s;

    const file = findTranscript(sid);
    if (!file) return null;

    const meta = findSessionMeta(sid) || {};
    s = {
      sid,
      file,
      slug: path.basename(path.dirname(file)),
      title: typeof meta.title === 'string' ? meta.title : null,
      model: typeof meta.model === 'string' ? meta.model : null,
      models: new Set(),
      totals: emptyTotals(),
      turns: 0,
      startedAt: null,
      lastAt: null,
      lastToolUseId: null,
      tailer: createTailer(file, { maxLine: TRANSCRIPT_MAX_LINE }),
      seen: new Set(),
      /* tool_use id -> the step that issued it. A step is one assistant entry, and
         it can issue several tool calls, so many ids share one usage object. The
         join must therefore read usage once per step, never once per event. */
      stepByToolUse: new Map(),
      delegations: new Map(),
    };
    tracked.set(sid, s);

    if (attribution) {
      attribution.annotate(sid, { slug: s.slug, title: s.title, cwd: null });
    }
    return s;
  }

  function absorb(s, entries) {
    let touched = false;
    for (const entry of entries) {
      const message = entry && entry.message;

      if (entry && typeof entry.timestamp === 'string') {
        const ms = Date.parse(entry.timestamp);
        if (Number.isFinite(ms)) {
          if (s.startedAt === null || ms < s.startedAt) s.startedAt = ms;
          if (s.lastAt === null || ms > s.lastAt) s.lastAt = ms;
        }
      }

      if (!message || !Array.isArray(message.content)) continue;

      if (message.role === 'user' && entry.message.meta && entry.message.meta.source === 'user') {
        s.turns++;
      }

      if (entry.usage) {
        /* One assistant entry is one step, and a step can issue several tool calls.
           Summing per entry is therefore correct for the session total, but the
           per-event join must dedupe by step id or it multiplies the cost. */
        s.totals.inputTokens += entry.usage.inputTokens || 0;
        s.totals.outputTokens += entry.usage.outputTokens || 0;
        s.totals.cacheReadTokens += entry.usage.cacheReadTokens || 0;
        s.totals.cacheWriteTokens += entry.usage.cacheWriteTokens || 0;
        s.totals.costUsd += entry.usage.costUsd || 0;
        s.totals.steps++;
        if (entry.model) s.models.add(entry.model);
      }

      for (const block of message.content) {
        if (block && block.type === 'tool_use' && block.id) {
          s.lastToolUseId = block.id;
          if (entry.usage) {
            s.stepByToolUse.set(block.id, {
              step: entry.id,
              model: entry.model || null,
              effort: entry.effort || null,
              usage: entry.usage,
            });
          }
        }
      }
      touched = true;
    }
    return touched;
  }

  /* Returns the per-agent totals the sub-agent used blocks carry. The product
     writes `<usage>total_tokens: N tool_uses: N turns: N duration_ms: N</usage>`
     at the end of a delegation result. Those tokens are cumulative across the
     sub-agent's turns and are NOT comparable with session tokens, so they are
     reported separately and must never be added to the session totals. */
  function absorbDelegations(s, entries) {
    const found = [];
    for (const entry of entries) {
      const message = entry && entry.message;
      if (!message || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (!block || block.type !== 'tool_result') continue;
        const text = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((b) => (b && b.text) || '').join('\n')
            : '';
        const m = text.match(/total_tokens:\s*(\d+)\s+tool_uses:\s*(\d+)\s+turns:\s*(\d+)\s+duration_ms:\s*(\d+)/i);
        if (!m) continue;
        found.push({
          toolUseId: block.tool_use_id || null,
          totalTokens: Number(m[1]),
          toolUses: Number(m[2]),
          turns: Number(m[3]),
          durationMs: Number(m[4]),
        });
      }
    }
    return found;
  }

  function poll() {
    const changes = [];

    for (const s of tracked.values()) {
      const lines = s.tailer.read();
      if (!lines.length) continue;

      const entries = [];
      badLines += parseJsonLines(lines, (o) => entries.push(o));
      if (!entries.length) continue;

      const touched = absorb(s, entries);
      const delegations = absorbDelegations(s, entries);
      for (const d of delegations) {
        if (d.toolUseId) s.delegations.set(d.toolUseId, d);
      }

      let settled = { closed: [], bound: [] };
      if (attribution) settled = attribution.noteTranscript(s.sid, entries);

      if (touched || delegations.length || settled.closed.length || settled.bound.length) {
        changes.push({ session: s, delegations });
      }
    }

    if (changes.length) onChange(changes);
    return changes;
  }

  function snapshot() {
    return [...tracked.values()].map((s) => ({
      sid: s.sid,
      slug: s.slug,
      title: s.title,
      model: s.model,
      models: [...s.models],
      turns: s.turns,
      startedAt: s.startedAt,
      lastAt: s.lastAt,
      totals: { ...s.totals, costUsd: Number(s.totals.costUsd.toFixed(6)) },
      delegations: [...s.delegations.values()],
      active: s.tailer.exists,
    }));
  }

  function lookupStep(sid, toolUseId) {
    const s = tracked.get(sid);
    if (!s || !toolUseId) return null;
    return s.stepByToolUse.get(toolUseId) || null;
  }

  function delegations(sid) {
    const s = tracked.get(sid);
    if (!s) return [];
    return [...s.delegations.values()];
  }

  function get(sid) {
    return tracked.get(sid) || null;
  }

  function trackedCount() {
    return tracked.size;
  }

  return {
    track,
    poll,
    snapshot,
    get,
    lookupStep,
    delegations,
    trackedCount,
    get badLines() {
      return badLines;
    },
  };
}

export function readSessionSummary(sid) {
  const file = findTranscript(sid);
  if (!file) return null;
  const meta = findSessionMeta(sid) || {};
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return null;
  }
  return { file, meta, lines: lines.filter(Boolean).length };
}
