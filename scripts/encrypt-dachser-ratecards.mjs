#!/usr/bin/env node
/*
 * Encrypt the local-only Dachser ratecard asset into the public artifact
 * assets/dachser-ratecards.enc.json.
 *
 *   AES-256-GCM · key = PBKDF2-SHA256(passphrase, random 16-byte salt, 310k)
 *
 * Same scheme as the Wackler / Honold bundles, and the loader shares their
 * passphrase, so one unlock control covers all three.
 *
 * The plain .js file is gitignored (business data); only the ciphertext ships.
 * assets/dachser-ratecard-loader.js decrypts it in the browser.
 *
 * Usage:  node scripts/encrypt-dachser-ratecards.mjs <passphrase>
 *    or:  DACHSER_PASSPHRASE=... node scripts/encrypt-dachser-ratecards.mjs
 *
 * Regeneration flow when tariffs change: re-run
 * scripts/dachser/build_ratecards.py from the xlsx sources, then this script,
 * and commit only the .enc.json.
 */
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ITER = 310000;

export async function encryptBundle(code, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(code)));
  const b64 = (u) => Buffer.from(u).toString('base64');
  return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pass = process.argv[2] || process.env.DACHSER_PASSPHRASE;
  if (!pass) {
    console.error('Usage: node scripts/encrypt-dachser-ratecards.mjs <passphrase>   (or set DACHSER_PASSPHRASE)');
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const code = readFileSync(path.join(root, 'assets', 'dachser-ratecards.js'), 'utf8');
  const enc = await encryptBundle(code, pass);
  writeFileSync(path.join(root, 'assets', 'dachser-ratecards.enc.json'), JSON.stringify(enc));
  console.log(`Wrote assets/dachser-ratecards.enc.json (${enc.data.length} base64 chars)`);
}
