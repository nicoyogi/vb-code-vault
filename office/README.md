# The Office

A local dashboard that watches this repo's agent pipeline work.

Ten desks, one per agent in `.commandcode/agents/`, plus the orchestrator. The spine shows which
pipeline stage the current task is at and whether its gates hold, and the feed streams every tool
call the hooks report.

What that is, exactly: the orchestrator's own tool calls, and the pipeline state. A delegated
sub-agent's own work is **not** observable — its tool calls fire no hooks at all (measured, see
`.agent/artifacts/research.md`) — so a desk whose delegation is open reads as delegated/inferred
and never shows a tool count of its own.

It is a local tool. It serves its own page on loopback, it is not deployed, and nothing about
the public Grimoire site changes because of it.

## Run it

From the repository root:

```
node office/server.mjs
```

Then open <http://127.0.0.1:4200>. Set `OFFICE_PORT` to use a different port.

The page is only a view. If the server is not running it says so and shows nothing else, rather
than an empty office that looks like a quiet one.

## Wire the hooks

The office learns about tool calls from Command Code hooks. Add this to
`.commandcode/settings.json`, alongside the existing `permissions` and `tasteLearning` keys
(that file is gitignored, so this is local wiring, not a committed change):

```json
"hooks": {
  "PreToolUse":   [{ "hooks": [{ "type": "command", "command": "node office/hook.mjs", "timeout": 5 }] }],
  "PostToolUse":  [{ "hooks": [{ "type": "command", "command": "node office/hook.mjs", "timeout": 5 }] }],
  "Stop":         [{ "hooks": [{ "type": "command", "command": "node office/hook.mjs", "timeout": 5 }] }],
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node office/hook.mjs", "timeout": 5 }] }]
}
```

Then **restart Command Code**: hooks are read at startup.

`node office/hook.mjs` is relative to the project directory. If you launch Command Code from a
subdirectory of the repo, use an absolute path instead, for example
`node "D:/vb-code-vault/office/hook.mjs"`.

Do not add a `matcher` to the `Stop` or `SessionStart` hooks. A matcher there stops the hook
from firing at all.

## What the page shows

**Pipeline** reads `.agent/task.json`, so the spine, the gates and the corrections count are the
repo's own pipeline state, not a guess at it. With no task in flight it says so.

**Desks** come from the Markdown files in `.commandcode/agents/` and `~/.commandcode/agents/`,
rescanned every 30 seconds, plus the three read-only built-ins. An idle desk is dimmed, never
hidden, so the grid does not jump around as work moves. A desk is occupied while its delegation is
open, read from the orchestrator's own `agent` and `agent_output` calls, or, for the orchestrator
itself, while one of its own calls landed in the last minute. A delegated desk reports
`delegated: true`, `events: 0` and `confidence: "inferred"`: the orchestrator's calls that arrive
while that delegation is open are labelled with it only provisionally, and counting them as that
agent's own work would be a fabricated figure.

**Signal** is a single line of real figures: sessions, tool calls, steps, tokens, cost. Tokens,
steps and cost are summed from the per-transcript totals the product writes on disk, so they are
session totals and do not rewind as the event ring turns over; `tool calls` and `events` are what
the hooks reported and are bounded by the ring. Cost is read from the `costUsd` the product already
stores in each transcript, so nothing here estimates or invents a price. Sub-agent token totals are
deliberately **not** added to the session totals: the product reports them cumulatively, and the
two are not comparable.

**Activity** is the live feed. Click a desk or a chip to filter by agent.

## How attribution works, and why it is labelled

A sub-agent's own tool calls fire **no** hooks at all, so it is not merely unnamed: it is
invisible. The live session's own hook audit listed 190 invocations, every one of them carrying the
orchestrator's `tool_use` id from the transcript, and ~30 tool calls made from inside a delegation
produced zero hook invocations and zero spool lines. Its turns are written to disk nowhere either:
no child entries in the transcript tree, no sidecar files, nothing in the session meta. Identity can
therefore only come from the delegation that was open when a call happened.

The delegation itself is always visible, because the orchestrator's `agent` call carries
`subagent_type` and `run_in_background`. So the office tracks the set of running delegations and
reports each call at the confidence the evidence supports:

| Shown as | Meaning |
| --- | --- |
| `researcher` | Proven. The transcript confirms the id. |
| `~researcher` | Inferred. Exactly one delegation was open. |
| `coder?` `[coder\|tester]` | Ambiguous. Two or more were open, so it refuses to pick one. |
| `unattributed` | Unknown. A sub-agent call whose delegation was never seen. |

Inferred is never presented as fact. Where two agents overlap, the page shows the set rather
than a coin flip, because a partly-right name shown as fact is worse than an honest gap.

Most delegations run in the background: their `agent` call returns in about a second while the
agent keeps working, so a delegation is closed by its matching `agent_output` wait, not by the
launch call returning. Because those waits can come back out of order, delegations are matched
by identity, never by position.

## Known limits

**Hooks are skipped entirely in plan mode.** That is the product's design, not a bug here: the
office shows nothing while you are in plan mode.

**A headless run (`cmdc -p ...`) does not fire `SessionStart`.** Until the transcript proves an
id, those events are reported as inferred rather than exact. The settle pass promotes them as
soon as the transcript catches up, which takes about a second.

**The hook spawns node on every tool call.** The body is a single parse and one `appendFileSync`,
and it always exits 0 with empty stdout, so it can never block or alter a tool call. If you want
to stop watching, remove the `hooks` block; nothing else depends on it.

**The spool contains real command text and file paths** from your local sessions. It lives in
`office/.runtime/`, which is gitignored. The server binds to `127.0.0.1` only and reads only the
sessions whose ids appear in the spool, so it never walks the wider session catalog. It also answers
only requests whose `Host` is `127.0.0.1` or `localhost` (403 otherwise), so a page on another
hostname cannot reach it by pointing that name at loopback.

**Dark only.** The rest of the Grimoire ships a theme toggle; this page does not, because it is a
console that sits next to a terminal and the repo's canon palette is dark. A light mode that was
not verified in both directions would be worse than no toggle.

## Design direction

There is no `DESIGN.md` in this repo. The direction for this page is the repo's own canon: the
`--gr-*` tokens from `assets/grimoire-theme.css`, served over the same `/assets/` route the Grimoire
uses, so the office cannot drift from the site it belongs to.

The read it was built to:

> A local operator console for one developer watching their own agent pipeline, in the Grimoire's
> dark canon. Dial ENERGY 1 / RHYTHM 2 / MOTION 1.

What that buys, concretely: **ENERGY 1** because it is a console, not a landing page, so it has no
marketing vocabulary and no call to action. **RHYTHM 2** because the four zones deliberately do not
share a composition: a stage rail with gate chips, a uniform grid of peer desks, one dense line of
figures, then a filtered feed. **MOTION 1** because there is no animation at all: no keyframes, no
transitions on state, nothing that moves without a pointer. The desk cards are uniform on purpose
rather than by default, because the agents are peers and the only thing worth showing is occupancy.

The focal point is the stage rail. It is the one question the screen exists to answer, which is why
it comes first and why the gate chips carry the real evidence text instead of a colour alone.

**Recorded after the fact.** This read was not written down before the page was built; it was
reconstructed during the antislop delivery gate, which requires it. The build itself was checked
against `antislop` plus `antislop-ui` and `antislop-human`, and the gate report lives in
`.agent/artifacts/antislop-gate.md`.

## API

| Route | Returns |
| --- | --- |
| `GET /api/health` | liveness, plus what the server can actually see on disk |
| `GET /api/state` | the complete snapshot |
| `GET /api/stream` | SSE: one `snapshot` on connect, then deltas, 15s heartbeat |

Every stream connection opens with a full snapshot, so a dropped delta cannot leave the page
permanently wrong. `/api/state` is the same object, for `curl` and for tests.

## Files

```
office/
  server.mjs          http server: static allowlist, API, SSE, the poll loop
  hook.mjs            hook target: reads stdin, writes one spool line, exits 0
  lib/
    paths.mjs         every path resolved from this file, never from cwd
    tailer.mjs        the read discipline for append-only NDJSON
    attribution.mjs   the delegation state machine (pure, no io)
    sessions.mjs      transcript tailing and the token/cost rollup
    pipeline.mjs      .agent/task.json and history
    events.mjs        the ring, the fan-out, spool rotation
    agents.mjs        the roster from *.md front matter
  public/             office.html, office.css, office.js
  tests/              node --test "office/tests/*.test.mjs"
```

`node --test` from the repo root picks these up along with the rest of the suite.

`node office/probe.mjs` is not part of the running system; it dumps the shape of the on-disk
session transcripts, which is what the parser was written against.

## Troubleshooting

The page says the office is closed: the server is not running. `node office/server.mjs`.

The page is live but no desks light up: the hooks are not loaded. Restart Command Code, and
check that the `hooks` block is valid JSON in `.commandcode/settings.json`.

Events arrive but every row says `unattributed`: the transcript for that session was not found.
Check that `~/.commandcode/projects/` exists and is readable.

The rail says no task is in flight: `.agent/task.json` is absent. That is a normal state for a
repo with no pipeline run in progress.
