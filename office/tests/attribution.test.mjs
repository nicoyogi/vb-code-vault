import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttribution } from '../lib/attribution.mjs';

const SID = 's1';

function rec(ev, tool, extra = {}) {
  return { ts: new Date().toISOString(), sid: SID, ev, tool, ...extra };
}

/* A transcript tool_result, shaped as it really is on disk. */
function result(toolUseId, text) {
  return {
    type: 'message',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }] },
  };
}

function call(toolUseId) {
  return {
    type: 'message',
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'read_file', input: {} }] },
  };
}

test('with no delegation open the call can only be the orchestrator', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_1' }));

  assert.equal(out.attribution.agent, 'orchestrator');
  assert.equal(out.attribution.confidence, 'exact');
  assert.equal(out.attribution.basis, 'no-delegation');
});

test('without a SessionStart the set is not trusted, so the answer is only inferred', () => {
  const a = createAttribution();
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_1' }));

  assert.equal(out.attribution.agent, 'orchestrator');
  assert.equal(out.attribution.confidence, 'inferred');
  assert.equal(out.attribution.basis, 'cold-start');
});

test('a call under exactly one open delegation is inferred, and named', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', desc: 'do the thing' }));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_2' }));

  assert.equal(out.attribution.agent, 'coder');
  assert.equal(out.attribution.confidence, 'inferred');
  assert.equal(out.attribution.basis, 'sole-delegation');
  assert.equal(out.attribution.settled, false);
  assert.equal(out.delegationId, 'ag_1');
});

test('a control tool is always the orchestrator, whatever is open', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));

  const out = a.apply(rec('PreToolUse', 'agent', { tu: 'ag_2', sub: 'tester' }));
  assert.equal(out.attribution.basis, 'control-tool');
  assert.equal(out.attribution.agent, 'orchestrator');
});

test('two open delegations produce a set, never a guess', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_2', sub: 'tester' }));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_3' }));
  assert.equal(out.attribution.agent, null);
  assert.equal(out.attribution.confidence, 'ambiguous');
  assert.deepEqual(out.attribution.candidates, ['coder', 'tester']);
});

test('a foreground delegation closes on its own PostToolUse', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'ag_1' }));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'after' }));
  assert.equal(out.attribution.basis, 'no-delegation', 'the set is empty again');
});

test('a background launch does NOT close on its PostToolUse, so the sub-agent stays attributed', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'ag_1' }));

  /* The launch returns in about a second while the agent keeps working for minutes. */
  const out = a.apply(rec('PreToolUse', 'shell_command', { tu: 'during' }));
  assert.equal(out.attribution.agent, 'coder');
  assert.equal(out.attribution.confidence, 'inferred');
});

test('a background delegation closes when its agent_output wait returns', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'ag_1' }));
  a.apply(rec('PreToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-abc' }));
  a.apply(rec('PostToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-abc', act: 'wait' }));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'after' }));
  assert.equal(out.attribution.basis, 'no-delegation');
});

test('opening a wait does not close anything; only the returning wait does', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'ag_1' }));
  a.apply(rec('PreToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-abc' }));

  const out = a.apply(rec('PreToolUse', 'shell_command', { tu: 'during' }));
  assert.equal(out.attribution.agent, 'coder', 'a wait is not a stop');
});

test('a list or status call does not mean the agent stopped', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'ag_1' }));
  a.apply(rec('PreToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-abc' }));
  a.apply(rec('PostToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-abc', act: 'list' }));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'after' }));
  assert.equal(out.attribution.agent, 'coder');
});

test('an ordinary tool call never touches the set, so a denied call cannot leak', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));

  /* A PreToolUse with no matching PostToolUse: the classic leak. */
  a.apply(rec('PreToolUse', 'write_file', { tu: 'never_returns' }));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'next' }));
  assert.equal(out.attribution.basis, 'no-delegation');
  assert.equal(out.delegationId, null);
});

test('Stop closes foreground delegations but only orphans background ones', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'fg', sub: 'reviewer' }));
  a.apply(rec('PreToolUse', 'agent', { tu: 'bg', sub: 'coder', bg: true }));
  a.apply(rec('PostToolUse', 'agent', { tu: 'bg' }));
  a.apply(rec('Stop', null));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'next' }));
  assert.equal(out.attribution.agent, 'coder', 'the background agent outlived the turn');
  assert.equal(a.snapshot()[0].open.length, 1);
  assert.equal(a.snapshot()[0].open[0].orphan, true);
});

test('the TTL bounds a delegation that never closes', () => {
  let clock = 1000;
  const a = createAttribution({ ttlMs: 500, now: () => clock });
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));

  clock += 400;
  assert.equal(a.sweep(), false, 'still inside the TTL');

  clock += 200;
  assert.equal(a.sweep(), true);
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'after' }));
  assert.equal(out.attribution.basis, 'no-delegation');
});

test('SessionStart clears a leaked set', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'leaked', sub: 'coder' }));
  a.apply(rec('SessionStart', null));

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'next' }));
  assert.equal(out.attribution.basis, 'no-delegation');
});

/* ── the settle pass ─────────────────────────────────────────────────────── */

test('an id that the transcript proves is an orchestrator call settles to exact', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_9' }));

  assert.equal(out.attribution.confidence, 'inferred');

  a.noteTranscript(SID, [call('call_9'), result('call_9', 'done')]);
  const settled = a.settleFor(SID, out.attribution, Date.now() - 1000, 'call_9');

  assert.equal(settled.agent, 'orchestrator');
  assert.equal(settled.confidence, 'exact');
  assert.equal(settled.basis, 'transcript-id');
  assert.equal(settled.settled, true);
});

test('an id the transcript does not know must be the delegated agent', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'sub_call' }));

  /* The transcript advanced, but it only ever holds orchestrator calls. */
  a.noteTranscript(SID, [call('some_orchestrator_call')]);
  const settled = a.settleFor(SID, out.attribution, Date.now() - 1000, 'sub_call');

  assert.equal(settled.agent, 'coder');
  assert.equal(settled.confidence, 'exact');
  assert.equal(settled.basis, 'transcript-absence');
});

test('with two candidates the settle pass still refuses to pick one', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder' }));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_2', sub: 'tester' }));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'sub_call' }));

  assert.deepEqual(out.attribution.candidates, ['coder', 'tester']);
  a.noteTranscript(SID, [call('some_orchestrator_call')]);
  const settled = a.settleFor(SID, out.attribution, Date.now() - 1000, 'sub_call');

  assert.equal(settled.agent, null);
  assert.equal(settled.confidence, 'ambiguous');
  assert.equal(settled.settled, true, 'settled as unknowable, not left hanging');
});

test('an event the watermark does not yet cover is left alone', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'call_9' }));
  a.noteTranscript(SID, [call('call_9')]);

  const future = Date.now() + 60_000;
  assert.equal(a.settleFor(SID, out.attribution, future, 'call_9'), null);
});

test('the launch acknowledgement binds the background id without closing the entry', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));

  a.noteTranscript(SID, [result('ag_1', 'Background agent launched.\nagent_id: bg-1-7f15d366')]);

  const open = a.snapshot()[0].open;
  assert.equal(open.length, 1, 'a launch ack is not a completion');
  assert.equal(open[0].bgId, 'bg-1-7f15d366');
  assert.equal(open[0].pairing, 'exact');
});

test('a wait result closes the entry even when no hook was ever seen for it', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));

  /* The PostToolUse hook was dropped; the host still wrote the result. */
  a.noteTranscript(SID, [result('ag_1', 'Agent finished.')]);

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'after' }));
  assert.equal(out.attribution.basis, 'no-delegation');
});

test('a wait closes the delegation it names, not the most recent one', () => {
  /* The strongest argument against a LIFO stack: reviewer is launched first and
     tester second, but tester's wait returns before reviewer's. A positional pop
     closes the wrong entry; identity matching does not. */
  const a = createAttribution();
  a.apply(rec('SessionStart', null));

  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_rev', sub: 'reviewer', bg: true }));
  a.noteTranscript(SID, [result('ag_rev', 'Background agent launched.\nagent_id: bg-1-rev')]);

  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_tst', sub: 'tester', bg: true }));
  a.noteTranscript(SID, [result('ag_tst', 'Background agent launched.\nagent_id: bg-1-tst')]);

  assert.equal(a.snapshot()[0].open.length, 2, 'both are running');

  a.apply(rec('PreToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-tst' }));
  a.apply(rec('PostToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-1-tst', act: 'wait' }));

  const open = a.snapshot()[0].open;
  assert.equal(open.length, 1);
  assert.equal(open[0].agent, 'reviewer', 'the tester finished; the reviewer did not');
});

test('a wait with an unknown id closes the only background agent still running', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PreToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-9-nope' }));
  a.apply(rec('PostToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-9-nope', act: 'wait' }));

  assert.equal(a.snapshot()[0].open.length, 0);
});

test('a wait with an unknown id refuses to choose between two running agents', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_1', sub: 'coder', bg: true }));
  a.apply(rec('PreToolUse', 'agent', { tu: 'ag_2', sub: 'tester', bg: true }));
  a.apply(rec('PostToolUse', 'agent_output', { tu: 'ao_1', aid: 'bg-9-nope', act: 'wait' }));

  assert.equal(a.snapshot()[0].open.length, 2, 'nothing is closed on a guess');
});

test('an event arriving after the transcript already knows its id is exact immediately', () => {
  const a = createAttribution();
  a.apply(rec('SessionStart', null));
  a.noteTranscript(SID, [call('known_id')]);

  const out = a.apply(rec('PreToolUse', 'read_file', { tu: 'known_id' }));
  assert.equal(out.attribution.basis, 'transcript-id');
  assert.equal(out.attribution.confidence, 'exact');
});

test('sessions are tracked independently', () => {
  const a = createAttribution();
  a.apply({ sid: 'one', ev: 'SessionStart', tool: null });
  a.apply({ sid: 'one', ev: 'PreToolUse', tool: 'agent', tu: 'ag', sub: 'coder' });
  a.apply({ sid: 'two', ev: 'SessionStart', tool: null });

  const other = a.apply({ sid: 'two', ev: 'PreToolUse', tool: 'read_file', tu: 'c' });
  assert.equal(other.attribution.basis, 'no-delegation', 'one session cannot leak into another');
});
