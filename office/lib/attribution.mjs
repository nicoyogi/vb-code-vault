/* Attribution: deciding which agent made a tool call.

   The problem, measured rather than assumed (see .agent/artifacts/research.md):
   a sub-agent's own tool calls fire no hooks at all, so nothing about a delegated
   agent's work is observable, and sub-agent turns are written to disk nowhere — no
   child entries in the transcript tree, no sidecar files, nothing in the session
   meta. Identity can therefore only come from the delegation that was open when a
   call happened.

   The delegation itself IS observable: the orchestrator's `agent` call carries
   `subagent_type` and `run_in_background`. So the SET of delegations is always
   knowable; only the mapping from a sub-agent call to one of several concurrent
   delegations is not. When two are open the answer is `ambiguous` with the
   candidate list attached — never a guess. A partly-right name shown as fact is
   worse than a set.

   Two measured facts shape the machine:

   1. Most delegations run in the background. Their `agent` call's PostToolUse
      returns in about a second ("Background agent launched.") while the agent
      keeps working, so a foreground close on that event would be wrong. Background
      entries close on the matching `agent_output` wait instead.
   2. Background waits are answered out of order, so this is an identity-keyed SET,
      not a LIFO stack. A stack pops the wrong entry when two agents overlap.

   The transcript lags the live stream by roughly a second, which is why there are
   two phases: classify live (inferred/ambiguous), then settle to exact once the
   transcript proves what happened.

   This module is pure: no fs, no http, no timers it owns. The caller feeds it
   spool records and transcript entries and reads the answers back. */

export const CONFIDENCE = ['exact', 'inferred', 'ambiguous', 'unknown'];

const CONTROL_TOOLS = new Set(['agent', 'agent_output']);
/* Only the launch acknowledgement counts. A wait result also contains `agent_id:`,
   so matching on that alone would read a wait as a launch and never close the entry. */
const LAUNCH_ACK = /background agent launched/i;
const BG_ID = /bg-[\w-]+/;

function emptySession(sid) {
  return {
    sid,
    slug: null,
    title: null,
    cwd: null,
    startedAt: null,
    stackKnown: false,
    entries: new Map(),
    byBg: new Map(),
    openOrder: [],
    orchestratorIds: new Set(),
    watermark: 0,
    lastEventAt: 0,
    syntheticCloses: 0,
  };
}

function openEntries(session, exceptId) {
  const out = [];
  for (const entry of session.entries.values()) {
    if (entry.closedAt !== null) continue;
    if (exceptId && entry.id === exceptId) continue;
    out.push(entry);
  }
  return out;
}

function resultText(block) {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  return '';
}

export function createAttribution({ ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map();

  function session(sid) {
    let s = sessions.get(sid);
    if (!s) {
      s = emptySession(sid);
      sessions.set(sid, s);
    }
    return s;
  }

  function close(s, entry, reason, synthetic) {
    entry.closedAt = now();
    entry.closeReason = reason;
    entry.syntheticClose = Boolean(synthetic);
    if (synthetic) s.syntheticCloses++;
  }

  function hasOrchestratorId(s, tu) {
    return Boolean(tu) && s.orchestratorIds.has(tu);
  }

  /* ── 2.4 Live classification ───────────────────────────────────────────────
     Reads the open set BEFORE the event's own transition is applied, and ignores
     the entry whose id equals this event's tool_use_id (I5). The candidate list is
     snapshotted into the answer: an event's live answer must never change just
     because a later event opened another delegation. */
  function classify(s, tu, tool) {
    if (CONTROL_TOOLS.has(tool)) {
      return { agent: 'orchestrator', confidence: 'exact', basis: 'control-tool', settled: true, candidates: [], source: 'control-tool' };
    }

    if (hasOrchestratorId(s, tu)) {
      return { agent: 'orchestrator', confidence: 'exact', basis: 'transcript-id', settled: true, candidates: [], source: 'transcript' };
    }

    const open = openEntries(s, tu);

    if (open.length === 0) {
      /* Nothing is delegated, and a sub-agent only ever runs while a delegation is
         open, so this can only be the orchestrator. Sound by elimination — but only
         if we have seen the session start and know the set is complete. */
      if (s.stackKnown) {
        return { agent: 'orchestrator', confidence: 'exact', basis: 'no-delegation', settled: true, candidates: [], source: 'stack' };
      }
      return { agent: 'orchestrator', confidence: 'inferred', basis: 'cold-start', settled: false, candidates: [], source: 'stack' };
    }

    const candidates = open.map((e) => e.agent);

    if (open.length === 1) {
      return { agent: candidates[0], confidence: 'inferred', basis: 'sole-delegation', settled: false, candidates, source: 'stack' };
    }

    return { agent: null, confidence: 'ambiguous', basis: 'multi-delegation', settled: false, candidates, source: 'stack' };
  }

  /* ── 2.3 Transitions ─────────────────────────────────────────────────────── */
  function apply(rec) {
    const sid = rec.sid;
    if (!sid) return null;
    const s = session(sid);
    s.lastEventAt = now();

    const before = classify(s, rec.tu, rec.tool);
    const openBefore = openEntries(s, rec.tu);
    const delegationId = openBefore.length ? openBefore[openBefore.length - 1].id : null;

    switch (rec.ev) {
      case 'SessionStart': {
        /* The only event that makes the set trustworthy again: no delegation can be
           open at the start of a session. */
        s.entries.clear();
        s.byBg.clear();
        s.openOrder = [];
        s.orchestratorIds = new Set();
        s.watermark = 0;
        s.stackKnown = true;
        s.startedAt = now();
        s.cwd = rec.cwd || s.cwd;
        break;
      }

      case 'PreToolUse': {
        if (rec.tool === 'agent' && rec.tu) {
          if (!s.entries.has(rec.tu)) {
            const entry = {
              id: rec.tu,
              agent: (rec.sub || 'unknown-agent').toLowerCase(),
              description: rec.desc || '',
              mode: rec.bg === true ? 'background' : 'foreground',
              bgId: null,
              pairing: null,
              openedAt: now(),
              waited: false,
              orphan: false,
              launched: false,
              closedAt: null,
              closeReason: null,
              syntheticClose: false,
            };
            s.entries.set(rec.tu, entry);
            s.openOrder.push(rec.tu);
          }
        } else if (rec.tool === 'agent_output') {
          const entry = rec.aid ? s.entries.get(s.byBg.get(rec.aid)) : null;
          if (entry && entry.closedAt === null) {
            entry.waited = true;
          } else {
            const unbound = openEntries(s).filter((e) => !e.bgId);
            if (unbound.length === 1) {
              unbound[0].waited = true;
              if (rec.aid) {
                unbound[0].bgId = rec.aid;
                unbound[0].pairing = 'assumed';
                s.byBg.set(rec.aid, unbound[0].id);
              }
            }
            /* Zero or two-or-more unbound entries: no set change. Never guess which
               agent a wait refers to. */
          }
        }
        break;
      }

      case 'PostToolUse': {
        if (rec.tool === 'agent') {
          const entry = rec.tu ? s.entries.get(rec.tu) : null;
          if (entry && entry.closedAt === null) {
            if (entry.mode === 'foreground') {
              close(s, entry, 'agent-post', false);
            } else {
              /* The launch returns immediately; the sub-agent keeps running. */
              entry.launched = true;
            }
          }
        } else if (rec.tool === 'agent_output') {
          const action = (rec.act || '').toLowerCase();
          if (action === 'wait' || action === 'kill' || action === 'output') {
            /* The entry belongs to the `agent` call, never to this agent_output call,
               so it is found through the background id the launch ack bound, not
               through this event's own tool_use_id. */
            const bound = rec.aid ? s.entries.get(s.byBg.get(rec.aid)) : null;
            if (bound && bound.closedAt === null) {
              close(s, bound, 'agent-output', false);
            } else {
              /* No binding: a wait can still only refer to a background agent that
                 is still running. With exactly one, closing it is unambiguous. */
              const waiting = openEntries(s).filter((e) => e.mode === 'background');
              if (waiting.length === 1) close(s, waiting[0], 'agent-output', false);
            }
          }
          /* A list or status call does not mean the agent stopped. */
        }
        break;
      }

      case 'Stop': {
        for (const entry of s.entries.values()) {
          if (entry.closedAt !== null) continue;
          if (entry.mode === 'foreground') close(s, entry, 'turn-end', true);
          else entry.orphan = true;
        }
        break;
      }

      default:
        break;
    }

    return { attribution: before, delegationId };
  }

  /* ── 2.5 The settle pass ───────────────────────────────────────────────────
     Called for events the transcript now covers. `orchestratorIds` is complete as
     of the watermark, so an id that is absent from it cannot be an orchestrator
     call. Returns a corrected attribution, or null when nothing changed. */
  function settleFor(sid, attribution, eventTsMs, tu) {
    const s = sessions.get(sid);
    if (!s || !s.watermark) return null;
    /* A lifecycle event (`SessionStart`, `Stop`) carries no tool_use id: it is not a
       tool call, so the transcript's silence about an id says nothing about it, and
       the absence test below must not run. Left unsettled, it keeps its live answer
       instead of being promoted to `exact <the sole open delegation>`. */
    if (!tu) return null;
    if (attribution.settled) return null;
    if (eventTsMs > s.watermark) return null;

    if (hasOrchestratorId(s, tu)) {
      if (attribution.agent === 'orchestrator') {
        return { ...attribution, confidence: 'exact', basis: 'transcript-id', source: 'transcript', settled: true };
      }
      return { agent: 'orchestrator', confidence: 'exact', basis: 'transcript-id', source: 'transcript', settled: true, candidates: [] };
    }

    const candidates = attribution.candidates || [];

    if (candidates.length === 1) {
      return {
        ...attribution,
        agent: candidates[0],
        confidence: 'exact',
        basis: 'transcript-absence',
        source: 'transcript',
        settled: true,
      };
    }

    if (candidates.length >= 2) {
      /* Definitely a sub-agent, but which one is unknowable. Stays a set forever. */
      return { ...attribution, basis: 'transcript-absence', source: 'transcript', settled: true };
    }

    /* No candidates and the id is not an orchestrator call: a sub-agent whose
       delegation we never saw (a cold start, or a rotated-away opening line). */
    return {
      agent: null,
      confidence: 'unknown',
      basis: 'orphan',
      source: 'transcript',
      settled: true,
      candidates: [],
    };
  }

  /* ── Transcript advance: E14, E15, B1, B2 ──────────────────────────────── */
  function noteTranscript(sid, entries) {
    const s = sessions.get(sid);
    if (!s) return { closed: [], bound: [], watermark: 0 };

    const closed = [];
    const bound = [];

    for (const entry of entries) {
      if (entry && typeof entry.timestamp === 'string') {
        const ms = Date.parse(entry.timestamp);
        if (Number.isFinite(ms) && ms > s.watermark) s.watermark = ms;
      }

      const message = entry && entry.message;
      if (!message) continue;

      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'tool_use' && block.id) {
          /* Append-only: this is what makes absence meaningful later. */
          s.orchestratorIds.add(block.id);
          continue;
        }

        if (block.type !== 'tool_result') continue;

        const id = block.tool_use_id;
        if (!id) continue;

        const text = resultText(block);
        const target = s.entries.get(id);
        if (!target || target.closedAt !== null) continue;

        const bg = text.match(BG_ID);
        if (target.mode === 'background' && bg && LAUNCH_ACK.test(text)) {
          /* B1: the launch acknowledgement names the background id, and lands as
             soon as the launch step completes. This is what lets a later wait close
             the RIGHT entry when two delegations overlap. Do not close. */
          target.bgId = bg[0];
          target.pairing = 'exact';
          s.byBg.set(bg[0], target.id);
          bound.push(target.id);
          continue;
        }

        /* E14: the transcript is written by the host, not by our hook, so a result
           here closes the entry even if the PostToolUse hook was dropped. */
        close(s, target, 'transcript', false);
        closed.push(target.id);
      }
    }

    return { closed, bound, watermark: s.watermark };
  }

  /* E13: the last-resort leak bound. */
  function sweep() {
    const at = now();
    let changed = false;
    for (const s of sessions.values()) {
      for (const entry of s.entries.values()) {
        if (entry.closedAt !== null) continue;
        if (at - entry.openedAt > ttlMs) {
          close(s, entry, 'ttl', true);
          changed = true;
        }
      }
    }
    return changed;
  }

  function snapshot() {
    const out = [];
    for (const s of sessions.values()) {
      const open = openEntries(s);
      out.push({
        sid: s.sid,
        slug: s.slug,
        title: s.title,
        cwd: s.cwd,
        stackKnown: s.stackKnown,
        watermark: s.watermark,
        orchestratorCalls: s.orchestratorIds.size,
        syntheticCloses: s.syntheticCloses,
        open: open.map((e) => ({
          id: e.id,
          agent: e.agent,
          description: e.description,
          mode: e.mode,
          bgId: e.bgId,
          pairing: e.pairing,
          waited: e.waited,
          orphan: e.orphan,
          openedAt: e.openedAt,
        })),
      });
    }
    return out;
  }

  function annotate(sid, patch) {
    const s = session(sid);
    Object.assign(s, patch);
    return s;
  }

  function knownSid(sid) {
    return sessions.has(sid);
  }

  return { apply, settleFor, noteTranscript, sweep, snapshot, annotate, knownSid };
}
