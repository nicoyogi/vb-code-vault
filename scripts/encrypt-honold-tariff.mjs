#!/usr/bin/env node
/*
 * Encrypt the local-only Honold OLD tariff asset into the public artifact
 * assets/honold-tariff.enc.json.
 *
 *   AES-256-GCM · key = PBKDF2-SHA256(passphrase, random 16-byte salt, 310k)
 *
 * The plain assets/honold-tariff.js is gitignored (business data); only the
 * ciphertext ships. assets/honold-tariff-loader.js decrypts it in the browser.
 *
 * Usage:  node scripts/encrypt-honold-tariff.mjs <passphrase>
 *    or:  HONOLD_PASSPHRASE=... node scripts/encrypt-honold-tariff.mjs
 *
 * Regeneration flow when the tariff changes: re-run
 * scripts/honold/build_tariff.py against the new xlsx, re-run this script,
 * commit only the .enc.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encryptBundle } from './encrypt-ratecards.mjs';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pass = process.argv[2] || process.env.HONOLD_PASSPHRASE;
  if (!pass) {
    console.error('Usage: node scripts/encrypt-honold-tariff.mjs <passphrase>   (or set HONOLD_PASSPHRASE)');
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const code = readFileSync(path.join(root, 'assets', 'honold-tariff.js'), 'utf8');
  const enc = await encryptBundle(code, pass);
  writeFileSync(path.join(root, 'assets', 'honold-tariff.enc.json'), JSON.stringify(enc));
  console.log(`Wrote assets/honold-tariff.enc.json (${enc.data.length} base64 chars)`);
}
