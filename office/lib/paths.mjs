/* Path resolution shared by the hook, the server and the tailers.

   Every path is derived from this file's own location, never from process.cwd().
   A hook runs with the *session* cwd, which is often a subdirectory of the project
   (there is a real session whose cwd is D:\vb-code-vault\office), so a cwd-relative
   spool path would scatter events across directories. */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

export const OFFICE_DIR = path.resolve(LIB_DIR, '..');
export const REPO_ROOT = path.resolve(OFFICE_DIR, '..');
export const PUBLIC_DIR = path.join(OFFICE_DIR, 'public');
export const RUNTIME_DIR = path.join(OFFICE_DIR, '.runtime');
export const SPOOL_PATH = path.join(RUNTIME_DIR, 'events.ndjson');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
export const COMMANDCODE_DIR = HOME ? path.join(HOME, '.commandcode') : '';
export const PROJECTS_DIR = COMMANDCODE_DIR ? path.join(COMMANDCODE_DIR, 'projects') : '';
export const USER_AGENTS_DIR = COMMANDCODE_DIR ? path.join(COMMANDCODE_DIR, 'agents') : '';
export const PROJECT_AGENTS_DIR = path.join(REPO_ROOT, '.commandcode', 'agents');

export const AGENT_DIR = path.join(REPO_ROOT, '.agent');
export const TASK_PATH = path.join(AGENT_DIR, 'task.json');
export const HISTORY_PATH = path.join(AGENT_DIR, 'history.jsonl');

/* Directory that `/assets/*` is served from, so the page reuses the Grimoire
   design tokens and runtime instead of duplicating them. */
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets');

export const SPOOL_MAX_LINES = 5000;
export const SPOOL_KEEP_LINES = 2500;

export function ensureRuntime() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  } catch {
    /* read-only checkout: the server reports the failure through /api/health */
  }
}

function readDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/* A session id comes from the spool, which is a plain file any local writer can put
   a line into, and it is interpolated into a path below. Only the characters a real
   id uses are accepted, so a tampered `sid` cannot walk out of `projects/` with
   `..` and open an arbitrary `.jsonl` somewhere else on disk. A rejected id takes
   the same route as an id with no transcript at all: null, "not found here". */
const SID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function validSid(sid) {
  return typeof sid === 'string' && SID_RE.test(sid);
}

/* Transcripts are catalogued per project under a slug of the cwd
   (D:\vb-code-vault -> d-vb-code-vault). The slug scheme is not part of the
   documented contract, so we locate a session by scanning for its id rather
   than reconstructing the slug. */
export function findTranscript(sid) {
  if (!validSid(sid) || !PROJECTS_DIR) return null;
  for (const entry of readDirs(PROJECTS_DIR)) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PROJECTS_DIR, entry.name, `${sid}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function findSessionMeta(sid) {
  if (!validSid(sid) || !PROJECTS_DIR) return null;
  for (const entry of readDirs(PROJECTS_DIR)) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PROJECTS_DIR, entry.name, `${sid}.meta.json`);
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/* Static serving is an allowlist, not a directory scan: only the office page,
   its two assets, and the repo's shared assets/ tree are reachable. Anything
   that escapes its base through `..` is rejected after resolution. */
const PUBLIC_FILES = new Map([
  ['/', 'office.html'],
  ['/index.html', 'office.html'],
  ['/office.html', 'office.html'],
  ['/office.css', 'office.css'],
  ['/office.js', 'office.js'],
]);

export function resolveStatic(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  if (PUBLIC_FILES.has(decoded)) {
    return { file: path.join(PUBLIC_DIR, PUBLIC_FILES.get(decoded)), base: PUBLIC_DIR };
  }

  if (decoded.startsWith('/assets/')) {
    const file = path.resolve(ASSETS_DIR, decoded.slice('/assets/'.length));
    return { file, base: ASSETS_DIR };
  }

  return null;
}

/* A resolved path is only servable if it is still inside its base after
   normalisation — this is what actually stops `..` traversal. */
export function isInside(base, file) {
  const rel = path.relative(base, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
