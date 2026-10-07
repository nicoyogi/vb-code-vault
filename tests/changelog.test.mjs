import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* loadChangelog() fetches this JSON at runtime; the test reads the same shipped
   file instead of loading the browser code through the vm harness. */
const changelog = JSON.parse(
  readFileSync(new URL('../assets/anmerkung-changelog.json', import.meta.url), 'utf8')
);
const engine = readFileSync(new URL('../assets/anmerkung.js', import.meta.url), 'utf8');

test('changelog: the badge version and the first modal row agree', () => {
  const { version, entries } = changelog;

  /* The badge and the modal agree only if the badge reads the file this test
     parses, so pin the declared URL to the path read at line 8, without its
     ../ prefix. Anchored to the declaration, so an earlier mention of the name
     in a comment cannot satisfy it, and a template literal or concatenation
     fails rather than silently passing. */
  const fetched = /^\s*(?:const|let|var)\s+CHANGELOG_URL\s*=\s*['"]([^'"]+)['"]/m.exec(engine)?.[1];
  assert.equal(fetched, 'assets/anmerkung-changelog.json',
    `assets/anmerkung.js must fetch the file this test reads; CHANGELOG_URL is "${fetched}"`);

  assert.ok(Array.isArray(entries) && entries.length > 0,
    'changelog.entries must be a non-empty array');

  assert.equal(version, entries[0].ver,
    `top-level version "${version}" must equal entries[0].ver "${entries[0].ver}"`);

  for (const e of entries) {
    assert.match(e.ver, /^\d+\.\d+\.\d+$/,
      `entry ver "${e.ver}" is not a dotted release number`);
    assert.ok(typeof e.date === 'string' && e.date.length > 0,
      `entry "${e.ver}" has no date`);
    assert.ok(Array.isArray(e.items) && e.items.length > 0,
      `entry "${e.ver}" has no items`);
    assert.ok(e.items.every(i => typeof i === 'string' && i.length > 0),
      `entry "${e.ver}" has an empty item`);
  }
});
