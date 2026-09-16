#!/usr/bin/env node
/* Command Code hook target. Wired for PreToolUse, PostToolUse, Stop and SessionStart.

   The contract this file must never break:

     - empty stdout. Empty stdout on exit 0 means "no opinion, allow" — anything
       else is either misread as a decision or logged as a warning.
     - exit 0, always. A non-zero exit from PreToolUse blocks the tool call, and a
       monitoring hook must never be able to stop the agent working.
     - fast. This runs on every tool call, so the whole body is one parse and one
       appendFileSync. Anything slower belongs in the server.

   Nothing here decides anything about the session; it writes one compact line and
   leaves. The server does the thinking. */

import fs from 'node:fs';
import { SPOOL_PATH, ensureRuntime } from './lib/paths.mjs';

const CAP = 200;
const SMALL = 40;

/* One line, small and identity-only. `tool_input.content` is an entire file and
   `tool_response` is an entire tool result, so neither is ever copied: a write_file
   carrying a megabyte of content must still produce a line under a few hundred bytes. */
function summarize(input) {
  if (!input || typeof input !== 'object') return '';

  const command = typeof input.command === 'string' ? input.command : '';
  if (command) {
    const args = Array.isArray(input.args) ? input.args.filter((a) => typeof a === 'string') : [];
    return args.length ? `${command} ${args.join(' ')}`.slice(0, CAP) : command.slice(0, CAP);
  }

  const fields = ['absolute_path', 'file_path', 'path', 'pattern', 'description', 'agent_id', 'url', 'query'];
  for (const field of fields) {
    const value = input[field];
    if (typeof value === 'string' && value) return value.slice(0, CAP);
  }

  if (Array.isArray(input.patterns) && input.patterns.length) return String(input.patterns[0]).slice(0, CAP);
  return '';
}

function clip(value, max) {
  return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

function buildRecord(payload) {
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};

  const record = {
    ts: new Date().toISOString(),
    sid: typeof payload.session_id === 'string' ? payload.session_id : '',
    ev: typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '',
    tool,
    tu: clip(payload.tool_use_id, 120),
    mode: clip(payload.permission_mode, 20),
    cwd: clip(payload.cwd, CAP),
    summary: summarize(input),
  };

  if (tool === 'agent') {
    record.sub = clip(String(input.subagent_type || '').toLowerCase(), SMALL);
    record.desc = clip(input.description, CAP);
    if (input.run_in_background === true) record.bg = true;
  }

  if (tool === 'agent_output') {
    record.aid = clip(input.agent_id, SMALL);
    record.act = clip(String(input.action || '').toLowerCase(), 20);
  }

  if (typeof payload.tool_display_name === 'string' && payload.tool_display_name) {
    record.display = payload.tool_display_name;
  } else if (tool) {
    record.display = tool.toUpperCase();
  }

  return record;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let raw = '';
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  let record;
  try {
    record = buildRecord(payload);
  } catch {
    return;
  }
  if (!record.sid || !record.ev) return;

  try {
    ensureRuntime();
    fs.appendFileSync(SPOOL_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    /* A full disk or a read-only checkout must not break the agent loop. */
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
