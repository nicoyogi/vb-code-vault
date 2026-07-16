#!/usr/bin/env node
/*
 * Encrypt the two local-only Wackler ratecard assets into the public
 * artifact assets/wackler-ratecards.enc.json.
 *
 *   AES-256-GCM · key = PBKDF2-SHA256(passphrase, random 16-byte salt, 310k)
 *
 * The plain .js files are gitignored (business data); only the ciphertext
 * ships. assets/wackler-ratecard-loader.js decrypts it in the browser.
 *
 * Usage:  node scripts/encrypt-ratecards.mjs <passphrase>
 *    or:  WACKLER_PASSPHRASE=... node scripts/encrypt-ratecards.mjs
 *
 * Regeneration flow when tariffs change: regenerate the plain .js from the
 * xlsx sources as before, re-run this script, commit only the .enc.json.
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
  const pass = process.argv[2] || process.env.WACKLER_PASSPHRASE;
  if (!pass) {
    console.error('Usage: node scripts/encrypt-ratecards.mjs <passphrase>   (or set WACKLER_PASSPHRASE)');
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const code =
    readFileSync(path.join(root, 'assets', 'wackler-ratecard.js'), 'utf8') + '\n' +
    readFileSync(path.join(root, 'assets', 'wackler-national-ratecard.js'), 'utf8');
  const enc = await encryptBundle(code, pass);
  writeFileSync(path.join(root, 'assets', 'wackler-ratecards.enc.json'), JSON.stringify(enc));
  console.log(`Wrote assets/wackler-ratecards.enc.json (${enc.data.length} base64 chars)`);
}
