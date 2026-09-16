/* The agent roster, read from the Markdown definitions Command Code loads.

   Sources, in the order the product resolves them: project `.commandcode/agents/`,
   then personal `~/.commandcode/agents/`, then the three read-only built-ins.
   The first definition of a name wins.

   The product ignores a custom file whose name is reserved for a built-in, so we
   drop those too — otherwise a stray `explore.md` would show up as a phantom desk.

   Agent files are simple `key: value` front matter, one key per line, no nesting
   and no block scalars. This is a line parser, not a YAML parser, and should not
   be described as one. */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_AGENTS_DIR, USER_AGENTS_DIR } from './paths.mjs';

const RESERVED = new Set(['explore', 'plan', 'review', 'general']);

const BUILT_INS = [
  {
    name: 'general',
    description: 'Default for research and multi-step tasks. Runs with all tools.',
    model: null,
    tools: ['*'],
    builtIn: true,
  },
  {
    name: 'explore',
    description: 'Codebase search and understanding across many files.',
    model: null,
    tools: ['read_file', 'read_directory', 'grep'],
    builtIn: true,
  },
  {
    name: 'plan',
    description: 'Designs an approach and weighs trade-offs.',
    model: null,
    tools: ['read_file'],
    builtIn: true,
  },
];

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseTools(value) {
  const raw = stripQuotes(value.trim());
  if (raw === '*') return ['*'];
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseFrontmatter(text) {
  /* The block is delimited by a leading `---` line and the next `---` line.
     Anything before the opening fence is ignored. */
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      start = i;
      break;
    }
    if (lines[i].trim() !== '') return {};
  }
  if (start === -1) return {};

  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;

    /* A leading-space line continues the previous value; these files never use
       that, but folding is harmless and keeps a wrapped description readable. */
    if (/^\s/.test(line) && line.trim()) {
      out.__last = out.__last || null;
      continue;
    }

    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    out[key] = line.slice(colon + 1).trim();
    out.__last = key;
  }

  delete out.__last;
  return out;
}

function toAgent(fm, file, builtIn) {
  const name = (fm.name || path.basename(file, '.md')).trim();
  if (!name) return null;
  const tools = fm.tools ? parseTools(fm.tools) : [];
  const maxTurns = Number.parseInt(fm.maxTurns ?? '', 10);
  return {
    name,
    description: fm.description ? stripQuotes(fm.description) : '',
    model: fm.model && fm.model !== 'inherit' ? fm.model : null,
    effort: fm.reasoningEffort || null,
    maxTurns: Number.isFinite(maxTurns) ? maxTurns : null,
    tools,
    builtIn: Boolean(builtIn),
    source: builtIn ? 'built-in' : path.basename(path.dirname(path.dirname(file))) === '.commandcode' ? 'project' : 'user',
  };
}

function readDir(dir, builtIn) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const agents = [];
  for (const entry of names) {
    if (!entry.endsWith('.md')) continue;
    const file = path.join(dir, entry);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const agent = toAgent(parseFrontmatter(text), file, builtIn);
    if (!agent) continue;
    if (!builtIn && RESERVED.has(agent.name.toLowerCase())) continue;
    agents.push(agent);
  }
  return agents;
}

export function loadAgents() {
  const seen = new Map();
  for (const agent of [...readDir(PROJECT_AGENTS_DIR, false), ...readDir(USER_AGENTS_DIR, false), ...BUILT_INS]) {
    if (!seen.has(agent.name)) seen.set(agent.name, agent);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/* The delegation payload lowercases `subagent_type`; the roster keeps the file's
   own casing. Match case-insensitively so `Researcher` and `researcher` are one desk. */
export function findAgent(agents, name) {
  if (!name) return null;
  const want = String(name).toLowerCase();
  return agents.find((a) => a.name.toLowerCase() === want) || null;
}
