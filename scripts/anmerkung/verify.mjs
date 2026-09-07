#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const source = path.join(ROOT, 'assets', 'anmerkung.js');
const checks = [];
const add = (name, ok, detail='') => checks.push({ name, ok: !!ok, detail });

add('source exists', fs.existsSync(source));
if (fs.existsSync(source)) {
  const js = fs.readFileSync(source, 'utf8');
  add('syntax', spawnSync(process.execPath, ['--check', source], { encoding: 'utf8' }).status === 0);
  for (const token of ['function processDachser', 'function processKN', 'function processDHL', 'function processWackler', 'function parseLocaleNumber', 'window.AnmerkungV5']) {
    add(`contains ${token}`, js.includes(token));
  }
  const sha256 = crypto.createHash('sha256').update(js).digest('hex');
  add('sha256 recorded', sha256.length === 64, sha256);
}
const result = spawnSync(process.execPath, ['--test'], { cwd: ROOT, encoding: 'utf8' });
add('repository tests', result.status === 0, (result.stdout + result.stderr).split('\n').slice(-20).join('\n'));
const failed = checks.filter(c => !c.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
