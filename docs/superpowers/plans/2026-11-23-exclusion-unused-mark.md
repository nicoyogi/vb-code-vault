# Mark Unused Exclusion Values — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In step 3 of `File_splitter.html`, draw each listed Kreditor or Referenz value that matches no row of that system's upload in red, inside the textarea, so a stale exclusion is visible at a glance.

**Architecture:** A mirror layer sits behind each exclusion textarea and renders the same characters, with the unmatched values wrapped in a red span; the textarea's own text is transparent and its caret visible. Four pure helpers in the page's inline script produce the marks, the mirror markup and the stat markup, and are unit tested through the existing vm harness. The DOM work is property assignment and a scroll listener.

**Tech Stack:** Vanilla JS in one HTML file, no build step, XLSX via CDN, `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-23-exclusion-unused-mark-design.md`

## Global Constraints

- One file to change: `File_splitter.html`. Tests in `tests/splitter.test.mjs`. No new dependency, no new file, no build step.
- Liveness: a listed value is live when it matches >= 1 row of a non-error system carrying the same name, in the column the exclusion acts on. Supplier is `row[1]` through `normDoc`; Reference is `row[2]` through `normDoc(...).toLowerCase()`.
- The row total must stay identical to today's stat: `sum(hits) === the row count already shown`.
- Match is exact after the parser's own normalisation (trim, and lower-case for Referenz). No substring, no digit grouping.
- Red is `var(--danger)` (`#ff6b6b`), the existing variable. No new colour, no new palette.
- New copy uses no em dash; the stat line's existing sentence keeps its own em dash unchanged.
- No changelog version bump, no `sw.js` `VERSION` bump.
- `docs/*` is gitignored, so the spec and plan need `git add -f`.
- Existing behaviour of `splitRows`, storage and the split output is untouched.

## Review Focus

- **Editing text.** Marks must follow delete, undo and paste on the next keystroke, not lag or stick to stale values. Verified manually in Task 3 (no DOM test rig exists).
- **Scrolled list.** A 45-entry list scrolled down must keep its red marks on the right numbers. Verified manually in Task 3.
- **CRLF paste.** Excel columns paste `\r\n`; the textarea's `value` normalises to `\n`, and the mirror must too, or a `\r` shows as a ghost break. Test in Task 1.
- **One long comma-separated line.** Wrap points must match the textarea's or the red drifts off its number. Mitigated with `scrollbar-gutter: stable`; verified manually in Task 3.
- **A number live in another system's file.** It stays red in this system's card, which is the agreed rule and can look like a bug. Test in Task 1.

---

### Task 1: Per-value marks as pure helpers

**Files:**
- Modify: `File_splitter.html` (helpers after `referenzSetFor`, currently line ~1092)
- Modify: `tests/splitter.test.mjs` (append at end)
- Commit: `docs/superpowers/specs/2026-11-23-exclusion-unused-mark-design.md` and this plan, force-added

**Interfaces:**
- Consumes: `parseKreditors(text) -> Set`, `parseReferenz(text) -> Set`, `normDoc(v) -> string`, `escapeHtml(s) -> string`, all already in the page.
- Produces, all top-level in the inline script:
  - `exclusionMarks(text, parse, cell, rows) -> { listed: string[], dead: string[], rows: number }` — `parse` is a parser, `cell(row)` returns the normalised field value, `rows` is the flat array of rows to test against.
  - `exclusionSegments(text, dead, key) -> { text: string, dead: boolean }[]` — `dead` is a `Set` of dead tokens, `key(v)` normalises a segment the way `parse` does.
  - `exclusionMirrorHtml(text, dead, key) -> string`
  - `exclusionStatHtml(marks, noun, nounPlural = noun) -> string`

- [ ] **Step 0: Branch from the latest main**

```bash
cd /d/vb-code-vault
git fetch origin
git switch -c feat/splitter-unused-exclusions origin/main
```

- [ ] **Step 1: Commit the design and the plan**

```bash
git add -f docs/superpowers/specs/2026-11-23-exclusion-unused-mark-design.md docs/superpowers/plans/2026-11-23-exclusion-unused-mark.md
git commit -m "docs: design and plan for unused-exclusion marks"
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/splitter.test.mjs`:

```js
test('exclusionMarks: per-token hits, dead list, and a row total that matches the old stat', () => {
  const rows = [
    ['DHL', '111', 'REF-A', 'D1', []],
    ['DHL', '111', 'REF-B', 'D2', []],
    ['DHL', '222', 'REF-C', 'D3', []],
  ];
  const m = s.exclusionMarks('111, 999', s.parseKreditors, r => s.normDoc(r[1]), rows);
  assert.deepEqual(plain(m.listed), ['111', '999']);
  assert.deepEqual(plain(m.dead), ['999']);
  assert.equal(m.rows, 2);                       // hits are rows, not tokens
  // the same token listed twice counts its rows once
  const dup = s.exclusionMarks('111 111', s.parseKreditors, r => s.normDoc(r[1]), rows);
  assert.deepEqual(plain(dup.listed), ['111']);
  assert.equal(dup.rows, 2);
  // numeric Supplier cells match the typed digits
  assert.equal(s.exclusionMarks('111', s.parseKreditors, r => s.normDoc(r[1]), [['V', 111, 'R', 'D', []]]).rows, 1);
  // nothing listed, nothing counted
  assert.deepEqual(plain(s.exclusionMarks('', s.parseKreditors, r => s.normDoc(r[1]), rows)), { listed: [], dead: [], rows: 0 });
  assert.deepEqual(plain(s.exclusionMarks('  , ; ', s.parseKreditors, r => s.normDoc(r[1]), rows)), { listed: [], dead: [], rows: 0 });
});

test('exclusionMarks: Referenz matches case-insensitively, and a value only in another column stays dead', () => {
  const rows = [['DHL', '111', 'REF-A', 'D1', []]];
  const ref = s.exclusionMarks('ref-a', s.parseReferenz, r => s.normDoc(r[2]).toLowerCase(), rows);
  assert.equal(ref.rows, 1);
  assert.deepEqual(plain(ref.dead), []);
  // REF-A is in the Reference column, not the Supplier one, so as a Kreditor it excludes nothing
  const kred = s.exclusionMarks('REF-A', s.parseKreditors, r => s.normDoc(r[1]), rows);
  assert.deepEqual(plain(kred.dead), ['REF-A']);
  assert.equal(kred.rows, 0);
  // rows from two uploads sharing a system name are judged together
  const both = s.exclusionMarks('222', s.parseKreditors, r => s.normDoc(r[1]),
    [...rows, ['DHL', '222', 'REF-Z', 'D2', []]]);
  assert.equal(both.rows, 1);
  assert.deepEqual(plain(both.dead), []);
});

test('exclusionSegments: keeps separators so the mirror is character-identical', () => {
  const segs = s.exclusionSegments('111, 999', new Set(['999']), v => v);
  assert.deepEqual(plain(segs.map(x => x.text)), ['111', ', ', '999']);
  assert.deepEqual(plain(segs.map(x => x.dead)), [false, false, true]);
  // leading/trailing space and a CRLF paste survive unchanged
  const raw = ' 111\r\n999 ';
  assert.equal(s.exclusionSegments(raw, new Set(['999']), v => v).map(x => x.text).join(''), raw);
  // the key normalises the segment, not the rendered text
  const ref = s.exclusionSegments('REF-1 ref-2', new Set(['ref-1']), v => v.toLowerCase());
  assert.deepEqual(plain(ref.map(x => [x.text, x.dead])), [['REF-1', true], [' ', false], ['ref-2', false]]);
  assert.deepEqual(plain(s.exclusionSegments('', new Set(), v => v)), []);
});

test('exclusionMirrorHtml: only dead segments are wrapped, text is escaped, a trailing newline keeps its line box', () => {
  assert.equal(s.exclusionMirrorHtml('111, 999', new Set(['999']), v => v),
    '111, <span class="excl-dead">999</span>');
  assert.equal(s.exclusionMirrorHtml('<b>', new Set(['<b>']), v => v),
    '<span class="excl-dead">&lt;b&gt;</span>');
  assert.equal(s.exclusionMirrorHtml('111', new Set(), v => v), '111');
  assert.equal(s.exclusionMirrorHtml('', new Set(), v => v), '');
  // a pasted column ends with a newline; without the zero-width space the mirror
  // is one line box shorter than the textarea and drifts when scrolled
  assert.equal(s.exclusionMirrorHtml('111\n', new Set(), v => v), '111\n\u200b');
});

test('exclusionStatHtml: keeps the existing sentence and appends the unused count in red', () => {
  assert.equal(s.exclusionStatHtml({ listed: ['a', 'b', 'c'], dead: ['b', 'c'], rows: 1 }, 'Kreditor', 'Kreditors'),
    '3 Kreditors listed — excludes 1 row. <span class="excl-dead-count">2 unused.</span>');
  assert.equal(s.exclusionStatHtml({ listed: ['a'], dead: [], rows: 7 }, 'Referenz'),
    '1 Referenz listed — excludes 7 rows.');
  assert.equal(s.exclusionStatHtml({ listed: [], dead: [], rows: 0 }, 'Referenz'), '');
  assert.equal(s.exclusionStatHtml({ listed: ['a', 'b'], dead: ['a', 'b'], rows: 0 }, 'Referenz'),
    '2 Referenz listed — excludes 0 rows. <span class="excl-dead-count">2 unused.</span>');
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `node --test tests/splitter.test.mjs`
Expected: FAIL, five new tests, each with `s.exclusionMarks is not a function` (or the segment/html/stat equivalent).

- [ ] **Step 4: Implement the four helpers**

Insert after `referenzSetFor` in `File_splitter.html`, before the `splitRows` comment block. Bodies:

- `exclusionMarks`: `const listed = [...parse(text)]`; a `Map` of token -> 0 seeded from `listed`; one pass over `rows` reading `cell(r)` and incrementing a matching key; total the map into `rows`, collect the zero-hit tokens in `listed` order into `dead`. Return the three.
- `exclusionSegments`: `String(text || '').split(/([\s,;]+)/)`, drop empty parts, map to `{ text: part, dead: dead.has(key(part)) }`. Splitting with the capture group is what keeps every separator, so the join equals the input.
- `exclusionMirrorHtml`: `exclusionSegments(...)` mapped to `escapeHtml(seg.text)`, wrapped in `<span class="excl-dead">…</span>` when `seg.dead`, joined; when the input ends in `\n`, a zero-width space `\u200b` is appended so the mirror keeps the textarea's last empty line box and the two scroll heights match.
- `exclusionStatHtml`: empty string when `marks.listed.length === 0`; otherwise `${listed.length} ${noun} listed — excludes ${rows} row(s).` reused verbatim from the current stat (plural on `rows === 1`), plus ` <span class="excl-dead-count">${dead.length} unused.</span>` when `dead.length > 0`.

Each helper gets a one-line comment saying what it decides, matching the file's existing comment style. No comment restating the body.

- [ ] **Step 5: Run them and see them pass**

Run: `node --test tests/splitter.test.mjs`
Expected: PASS, all tests in the file, including the existing ones.

- [ ] **Step 6: Commit**

```bash
git add File_splitter.html tests/splitter.test.mjs
git commit -m "feat(splitter): count per-value exclusion hits"
```

---

### Task 2: Mirror layer and the stat line in the Exclusions card

**Files:**
- Modify: `File_splitter.html` (CSS at `.excl-col .note-stat`, line ~161; markup and wiring in `renderKreditor`, lines ~1216-1283)

**Interfaces:**
- Consumes: `exclusionMarks`, `exclusionMirrorHtml`, `exclusionStatHtml`, `parseKreditors`, `parseReferenz`, `normDoc`, `escapeHtml` from Task 1 and the page.
- Produces: nothing new for later tasks; this is the last task.

- [ ] **Step 1: Add the styles**

After the `.excl-col .note-stat` rule:

```css
.excl-wrap { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; transition: border-color 0.15s; }
.excl-wrap:focus-within { border-color: var(--accent); }
.excl-mirror { position: absolute; inset: 0; z-index: 0; overflow: hidden; padding: 8px 10px; font-size: 12px; font-family: var(--mono); line-height: 1.5; color: var(--text); white-space: pre-wrap; overflow-wrap: break-word; tab-size: 4; scrollbar-gutter: stable; pointer-events: none; user-select: none; }
.excl-dead, .excl-dead-count { color: var(--danger); }
```

Rewrite `.kred-input` so the wrapper carries surface, border and radius: `position: relative; z-index: 1; display: block; background: transparent; border: none; border-radius: 8px; color: transparent; caret-color: var(--text); line-height: 1.5; scrollbar-gutter: stable;`, keeping width, min-height, padding, font, `resize: vertical` and the transition drop. Replace the `.kred-input:focus` rule with the `.excl-wrap:focus-within` rule above; `::-webkit-resizer` needs no styling.

- [ ] **Step 2: Wrap each textarea in the markup**

In `renderKreditor`'s `block.innerHTML`, put each textarea inside the wrapper, with the mirror immediately before it:

```html
<div class="excl-wrap"><div class="excl-mirror" aria-hidden="true"></div><textarea class="kred-input kred-ta" rows="3" placeholder="Kreditor numbers — one per line or comma-separated"></textarea></div>
```

and the same shape for `.ref-ta`. Keep both placeholders byte-identical to today.

- [ ] **Step 3: Replace the stat updater with the renderer**

Replace the `updateExclStat` closure with `updateExcl(ta, mirror, parse, cell, key, statEl, noun, nounPlural = noun)`:

- `const rows = systems.filter(sys => !sys.error && sys.name === name).flatMap(sys => sys.rows);` — the same set the old nested loop counted.
- `const marks = exclusionMarks(ta.value, parse, cell, rows);`
- `mirror.innerHTML = exclusionMirrorHtml(ta.value, new Set(marks.dead), key);`
- `statEl.innerHTML = exclusionStatHtml(marks, noun, nounPlural);`
- `mirror.scrollTop = ta.scrollTop; mirror.scrollLeft = ta.scrollLeft;` last, so the mirror lands where the textarea already is on re-render.

Wire `kredTa` with `parseKreditors`, `r => normDoc(r[1])`, key `v => v`; `refTa` with `parseReferenz`, `r => normDoc(r[2]).toLowerCase()`, key `v => v.toLowerCase()`. Each textarea keeps its `input` listener (store then save then `updateExcl`), gains a `scroll` listener that copies `scrollTop`/`scrollLeft` to its mirror, and gets one `updateExcl` call at render time, replacing the two current `updateExclStat` calls.

- [ ] **Step 4: Run the unit suite**

Run: `node --test tests/splitter.test.mjs`
Expected: PASS. A syntax error here surfaces as `splitter inline failed to load`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no new failures against the pre-change run.

- [ ] **Step 6: Verify in the browser**

Run: `node scripts/dev-server.mjs`, open the splitter, upload a workbook with a Kreditor column, then type two Kreditor numbers, one real and one absent. Check, in this order: the absent one is red while the caret and typing stay normal; the stat reads `2 Kreditors listed — excludes N rows. 1 unused.`; scrolling the box moves the red with the text; deleting the red number leaves no mark and the sentence drops the unused count; focus still draws the accent border.

Expected: all five hold. Note in the commit body that the visual check was done by the human, not a test.

- [ ] **Step 7: Commit**

```bash
git add File_splitter.html
git commit -m "feat(splitter): mark exclusion values that match no row in red"
```
