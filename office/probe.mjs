#!/usr/bin/env node
/* Dumps the shape of the on-disk session transcripts.

   This is not part of the running system. It exists because the transcript format
   is what the parser was written against, and the documented contract does not
   specify it: entry types, the token keys, and whether sub-agent activity is
   recorded anywhere are all facts you have to read off a real file.

   Run it after a Command Code upgrade, or if events stop joining to their step:

     node office/probe.mjs
     node office/probe.mjs <session-id>       a specific session
     node office/probe.mjs --json             machine-readable

   Everything it prints is read-only. */

import fs from 'node:fs';
import path from 'node:path';

import { PROJECTS_DIR, COMMANDCODE_DIR } from './lib/paths.mjs';

const SIDE_CAR = /\.(checkpoints|prompts)\.jsonl$/;

function sessions() {
  if (!PROJECTS_DIR || !fs.existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const full = path.join(PROJECTS_DIR, dir);
    let names;
    try {
      names = fs.readdirSync(full);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl') || SIDE_CAR.test(name)) continue;
      const file = path.join(full, name);
      try {
        out.push({ slug: dir, sid: name.replace(/\.jsonl$/, ''), file, size: fs.statSync(file).size });
      } catch {
        /* raced away */
      }
    }
  }
  return out.sort((a, b) => b.size - a.size);
}

function keysOf(value, prefix = '') {
  const out = [];
  if (!value || typeof value !== 'object') return out;
  for (const [key, val] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) out.push(...keysOf(val, name));
    else out.push(`${name}: ${Array.isArray(val) ? 'array' : typeof val}`);
  }
  return out;
}

function inspect(target) {
  const text = fs.readFileSync(target.file, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);

  let header = null;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    /* leave null */
  }

  const counts = new Map();
  const samples = new Map();
  const usageKeys = new Set();
  const blockTypes = new Map();
  const toolNames = new Map();
  const keySets = new Map();
  const delegationInputs = [];
  const agentResults = [];
  const orchestratorIds = new Set();
  const parentIds = new Set();
  let bad = 0;

  for (let i = 1; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      bad++;
      continue;
    }

    const type = entry.type || '<none>';
    counts.set(type, (counts.get(type) || 0) + 1);
    if (!samples.has(type)) samples.set(type, entry);
    keySets.set(Object.keys(entry).sort().join(','), true);

    if (entry.id) parentIds.add(entry.id);
    if (entry.usage) for (const k of Object.keys(entry.usage)) usageKeys.add(k);

    const message = entry.message;
    if (!message) continue;

    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!block || typeof block !== 'object') continue;
      blockTypes.set(block.type, (blockTypes.get(block.type) || 0) + 1);

      if (block.type === 'tool_use') {
        if (block.id) orchestratorIds.add(block.id);
        toolNames.set(block.name, (toolNames.get(block.name) || 0) + 1);
        if (block.name === 'agent' && block.input) {
          delegationInputs.push({
            subagentType: block.input.subagent_type ?? null,
            background: block.input.run_in_background === true,
            hasPrompt: typeof block.input.prompt === 'string',
            description: String(block.input.description || '').slice(0, 60),
          });
        }
      }
      if (block.type === 'tool_result' && typeof block.content !== 'string' && Array.isArray(block.content)) {
        for (const inner of block.content) {
          if (inner && typeof inner.text === 'string' && /total_tokens:/.test(inner.text)) {
            agentResults.push(inner.text.match(/total_tokens: \d+ tool_uses: \d+ turns: \d+ duration_ms: \d+/)[0]);
          }
        }
      }
    }
  }

  /* The question that decides the whole attribution design: does the transcript
     nest a sub-agent's turns under the delegation that started them? */
  const agentCallIds = delegationInputs.length;
  let nestedUnderAgentCall = 0;
  for (const line of lines.slice(1)) {
    try {
      const entry = JSON.parse(line);
      if (entry.parentId && orchestratorIds.has(entry.parentId)) nestedUnderAgentCall++;
    } catch {
      /* counted already */
    }
  }

  return {
    slug: target.slug,
    sid: target.sid,
    bytes: target.size,
    lines: lines.length,
    badLines: bad,
    header,
    counts,
    samples,
    usageKeys,
    blockTypes,
    toolNames,
    keySets,
    delegationInputs,
    agentResults,
    agentCallIds,
    nestedUnderAgentCall,
    uniqueIds: parentIds.size,
  };
}

function print(report) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${report.sid}  (${report.slug}, ${(report.bytes / 1024).toFixed(0)} KB, ${report.lines} lines)`);
  console.log('='.repeat(72));

  if (report.badLines) console.log(`unparseable lines: ${report.badLines}`);

  console.log('\nheader:');
  console.log('  ' + JSON.stringify(report.header));

  console.log('\nentry types:');
  for (const [type, n] of [...report.counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${type}`);
  }

  console.log('\nentry key sets (the shape is the discriminator, there is no type field difference):');
  for (const keySet of report.keySets.keys()) console.log('  ' + keySet);

  console.log('\ncontent block types:');
  for (const [type, n] of [...report.blockTypes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${type}`);
  }

  console.log('\ntools used:');
  console.log('  ' + [...report.toolNames].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(', '));

  console.log('\nusage keys present on assistant entries:');
  console.log('  ' + ([...report.usageKeys].join(', ') || '(none)'));

  console.log('\ndelegations (agent tool calls):');
  if (!report.agentCallIds) console.log('  none in this session');
  for (const d of report.delegationInputs.slice(0, 10)) {
    console.log(`  subagent_type=${d.subagentType}  background=${d.background}  prompt=${d.hasPrompt}  "${d.description}"`);
  }

  console.log('\nsub-agent usage blocks recovered from results:');
  console.log(`  ${report.agentResults.length} found` + (report.agentResults[0] ? `  e.g. ${report.agentResults[0]}` : ''));

  console.log('\nTHE ATTRIBUTION QUESTION');
  console.log(`  entries whose parentId is a tool_use id: ${report.nestedUnderAgentCall}`);
  if (report.nestedUnderAgentCall === 0) {
    console.log('  -> sub-agent turns are NOT recorded in this transcript.');
    console.log('     Identity can only come from the open delegation, so attribution is');
    console.log('     never better than `inferred` where the transcript cannot prove an id.');
  } else {
    console.log('  -> sub-agent turns ARE nested; exact attribution is available.');
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const wanted = args.find((a) => !a.startsWith('-'));

if (!COMMANDCODE_DIR || !fs.existsSync(COMMANDCODE_DIR)) {
  console.error(`No Command Code directory at ${COMMANDCODE_DIR || '(unknown home)'}.`);
  process.exit(1);
}

const all = sessions();
if (!all.length) {
  console.error(`No session transcripts under ${PROJECTS_DIR}.`);
  process.exit(1);
}

const picked = wanted ? all.filter((s) => s.sid.startsWith(wanted)) : all.slice(0, 3);
if (!picked.length) {
  console.error(`No session matching "${wanted}".`);
  process.exit(1);
}

const reports = picked.map(inspect);

if (asJson) {
  console.log(JSON.stringify(reports.map((r) => ({
    sid: r.sid,
    slug: r.slug,
    bytes: r.bytes,
    lines: r.lines,
    badLines: r.badLines,
    header: r.header,
    entryTypes: Object.fromEntries(r.counts),
    usageKeys: [...r.usageKeys],
    blockTypes: Object.fromEntries(r.blockTypes),
    tools: Object.fromEntries(r.toolNames),
    delegations: r.delegationInputs,
    nestedUnderAgentCall: r.nestedUnderAgentCall,
  })), null, 2));
} else {
  console.log(`Session transcripts under ${PROJECTS_DIR}`);
  console.log(`Inspecting ${reports.length} of ${all.length}.`);
  reports.forEach(print);
}
