/* The pipeline rail: the repo's own multi-agent workflow state.

   Read straight from `.agent/task.json`, which the orchestrator keeps current, plus
   `.agent/history.jsonl`. Both are gitignored scratch, and both are absent on a
   fresh checkout — that is a normal "no task in flight", not an error, so nothing
   here throws or invents a placeholder task. */

import fs from 'node:fs';
import { createTailer, parseJsonLines } from './tailer.mjs';
import { TASK_PATH, HISTORY_PATH } from './paths.mjs';

/* The state machine defined in .commandcode/AGENTS.md. */
export const STAGES = [
  'NEW',
  'RESEARCHING',
  'PLANNING',
  'ARCHITECTING',
  'IMPLEMENTING',
  'REVIEWING',
  'TESTING',
  'FINALIZING',
  'COMPLETE',
];

const GATE_ORDER = ['requirements', 'review', 'tests', 'regression', 'finalization'];
const HISTORY_LIMIT = 200;

export function createPipeline({ onChange = () => {} } = {}) {
  let task = null;
  let taskMtime = 0;
  let history = [];
  const tailer = createTailer(HISTORY_PATH);

  function readTask() {
    let stat;
    try {
      stat = fs.statSync(TASK_PATH);
    } catch {
      if (task !== null) {
        task = null;
        taskMtime = 0;
        return true;
      }
      return false;
    }

    if (stat.mtimeMs === taskMtime) return false;

    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(TASK_PATH, 'utf8'));
    } catch {
      /* A half-written file: keep the previous task rather than blanking the rail. */
      return false;
    }

    taskMtime = stat.mtimeMs;
    task = parsed;
    return true;
  }

  function readHistory() {
    const lines = tailer.read();
    if (!lines.length) return false;
    let added = 0;
    parseJsonLines(lines, (o) => {
      history.push(o);
      added++;
    });
    if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
    return added > 0;
  }

  function poll() {
    const changed = readTask() || readHistory();
    if (changed) onChange(snapshot());
    return changed;
  }

  function snapshot() {
    if (!task) {
      return { present: false, task: null, state: null, stageIndex: -1, stages: STAGES, gates: [], history: history.slice(-40) };
    }

    const state = typeof task.state === 'string' ? task.state.toUpperCase() : null;
    const gates = GATE_ORDER
      .filter((name) => task.gates && task.gates[name])
      .map((name) => ({
        name,
        status: (task.gates[name].status || 'unknown').toLowerCase(),
        evidence: task.gates[name].evidence || '',
      }));

    return {
      present: true,
      task: task.task || null,
      state,
      stageIndex: state ? STAGES.indexOf(state) : -1,
      stages: STAGES,
      created: task.created || null,
      completed: task.completed || null,
      gates,
      findings: Array.isArray(task.findings)
        ? task.findings.map((f) => ({ id: f.id, tag: f.tag, what: f.what, status: f.status }))
        : [],
      corrections: Array.isArray(task.corrections) ? task.corrections.length : 0,
      knownGaps: Array.isArray(task.known_gaps) ? task.known_gaps.length : 0,
      history: history.slice(-40),
    };
  }

  return { poll, snapshot };
}
