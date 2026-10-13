#!/usr/bin/env node
// Installs the vault mirror hook into this clone, idempotently.
//
//   node scripts/install-hooks.mjs           install or update the hook
//   node scripts/install-hooks.mjs --check    report only; exit 1 if missing or stale
//
// Why an installer instead of a committed hook: git does not version `.git/hooks/`, and a
// committed `core.hooksPath` directory would fight graphify. graphify's installer resolves the
// hooks directory with `git rev-parse --git-path hooks`, so it follows `core.hooksPath` too -
// repointing that setting would silently stop the graphify rebuild and make graphify append its
// machine-specific pinned-Python block into a tracked file. Instead, this script writes the
// portable vault block into the real hooks directory and leaves every other block alone, so it
// coexists with graphify and survives `graphify hook install` re-running.
//
// The hook it writes is the same soft-failing block the post-commit hook already carries: it
// refreshes the Obsidian mirror after a commit, skips merges and rebases, and never blocks a
// commit. Run this once per clone (`npm install` runs it via the `prepare` script).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MARKER = '# vault-hook-start';
const MARKER_END = '# vault-hook-end';
const HOOK = 'post-commit';

/** The block this installer owns, markers included. Portable: no absolute paths, no machine state. */
const BLOCK = `${MARKER}
# Refreshes the Obsidian mirror of this repo's markdown into vb-code-vault/_mirror. Local only:
# no network, no LLM. Fails soft, because a stale mirror must never block a commit. Skipped in the
# middle of a merge or rebase, where the working tree can hold conflicted files the vault should
# not capture. Refresh by hand any time with: node vb-code-vault/sync-notes.mjs
_VAULT_GITDIR=\${GIT_DIR:-$(git rev-parse --git-dir 2>/dev/null)}
_VAULT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if command -v node >/dev/null 2>&1 && [ -f "$_VAULT_ROOT/vb-code-vault/sync-notes.mjs" ] && [ ! -d "$_VAULT_GITDIR/rebase-merge" ] && [ ! -d "$_VAULT_GITDIR/rebase-apply" ] && [ ! -f "$_VAULT_GITDIR/MERGE_HEAD" ] && [ ! -f "$_VAULT_GITDIR/CHERRY_PICK_HEAD" ]; then
    node "$_VAULT_ROOT/vb-code-vault/sync-notes.mjs" >/dev/null 2>&1 || true
fi
${MARKER_END}`;

/**
 * Replace the vault block in `content` with `block`, or append it.
 *
 * Idempotent and non-destructive: any other content (notably graphify's marker-delimited block)
 * is preserved byte for byte. Returns the new content and what happened.
 */
export function applyBlock(content, block = BLOCK) {
	const start = content.indexOf(MARKER);
	const end = content.indexOf(MARKER_END);
	if (start !== -1 && end !== -1 && end >= start) {
		const after = end + MARKER_END.length;
		const next = content.slice(0, start) + block + content.slice(after);
		return { content: next, action: next === content ? 'current' : 'updated' };
	}
	if (start !== -1 || end !== -1) {
		// One marker without the other is a hand-edited or half-written hook. Refuse to guess.
		throw new Error(`found only one of ${MARKER} / ${MARKER_END}; fix the hook by hand`);
	}
	const base = content.trimEnd();
	const joined = base.length > 0 ? `${base}\n\n${block}\n` : `#!/bin/sh\n${block}\n`;
	return { content: joined, action: base.length > 0 ? 'appended' : 'created' };
}

/** The hooks directory git actually uses, honouring `core.hooksPath` and linked worktrees. */
export function hooksDir(cwd = process.cwd()) {
	const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-path', 'hooks'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	if (r.status !== 0) return null;
	const raw = r.stdout.trim();
	if (!raw || /[\r\n\0]/.test(raw)) return null;
	return path.resolve(cwd, raw);
}

/** Install or update the hook. Returns `{ action, hookPath }`, or `{ action: 'no-git' }`. */
export function install(cwd = process.cwd()) {
	const dir = hooksDir(cwd);
	if (!dir) return { action: 'no-git', hookPath: null };
	fs.mkdirSync(dir, { recursive: true });
	const hookPath = path.join(dir, HOOK);
	const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';
	const { content, action } = applyBlock(existing);
	if (action !== 'current') {
		fs.writeFileSync(hookPath, content, { encoding: 'utf8' });
	}
	try {
		fs.chmodSync(hookPath, 0o755);
	} catch {
		/* chmod is a no-op on some filesystems; git only needs the file present */
	}
	return { action, hookPath };
}

const isMain =
	process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const check = process.argv.includes('--check');
	let result;
	try {
		result = check ? checkHook() : install();
	} catch (err) {
		console.error(`install-hooks: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	if (result.action === 'no-git') {
		// Not a git checkout (a tarball, or a CI scratch dir). Not an error: `prepare` must not fail.
		console.log('install-hooks: not a git repository, nothing to do');
		process.exit(0);
	}
	const label = { created: 'installed', updated: 'updated', current: 'already current', missing: 'missing' }[result.action] ?? result.action;
	console.log(`install-hooks: ${HOOK} ${label} at ${result.hookPath}`);
	if (check) process.exit(result.action === 'current' ? 0 : 1);
}

/** Report whether the installed hook matches the block this script owns. */
export function checkHook(cwd = process.cwd()) {
	const dir = hooksDir(cwd);
	if (!dir) return { action: 'no-git', hookPath: null };
	const hookPath = path.join(dir, HOOK);
	if (!fs.existsSync(hookPath)) return { action: 'missing', hookPath };
	const { action } = applyBlock(fs.readFileSync(hookPath, 'utf8'));
	return { action: action === 'current' ? 'current' : 'stale', hookPath };
}
