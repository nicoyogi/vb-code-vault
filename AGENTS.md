# Project conventions

Repo-specific notes for agents working in this tree. The pipeline itself (roles, routing,
gates) lives in `.commandcode/AGENTS.md` - local to this machine, gitignored - so this file is
only what is specific to this project.

## Versioning (The Alchemist)

Only The Alchemist is versioned, and `assets/anmerkung-changelog.json` is the only place that
version lives. The top-level `version` is what code reads for behaviour: it drives the header
badge, the modal subtitle, and the "What's new" trigger. `entries[0]` is the release the modal
lists first, and `renderChangelog()` prints every entry's own `ver` label, so the two have to
match or the first row disagrees with the badge. Other version-looking fields are not releases:
`package.json` `version` (never read at runtime), `sw.js` `VERSION` (a cache name),
`scripts/notify-*.mjs` `version` (an Adaptive Card schema version in the Teams payload),
`assets/operation-report.js` `version` (a backup schema), `assets/holiday-tracker.js`
`'VERSION:2.0'` (an iCal property).

Bump when the tool behaves differently for the user: the engine emits different Anmerkung
phrases, or the tool writes or exports something different. Do not bump for docs, tests,
refactors, repo hygiene, dependencies, or the way the app looks, reads, or is wired - layout,
readability, styling defaults, accessibility, and service-worker plumbing are all free. A
commit that touches `anmerkung.js` without changing what the tool produces or offers does not
earn a version. UI work is the judgement edge: `18e35d6`, choosing the cell style written into
the workbook, took 1.44.0, while `f127a48`, the first-visit project picker from the same day,
took nothing.

Which slot: `x.y.Z+1` amends the release at the top of the changelog (usually the same
forwarder or subsystem, days rather than weeks later, no new surface); `x.Y+1.0` is a new work
unit (a fresh bundle triage, a new SNK code, a new panel or export, a new forwarder branch).
Never a major. The split is amendment vs new unit, not bugfix vs feature: a new SNK code
arrives in a `fix(anmerkung):` commit and still takes a minor.

A bump is not free. `showChangelogOnUpdate()` keys off the version string, so every bump pops
the "What's new" modal for every returning user.

README's `Version policy` section under Contributing is normative; this is the summary. When
you do bump, move `version`, `entries[0].ver`, and the new entry in one commit, rebuild
`docs/anmerkung/conditions-report.pdf` if the cascade changed, and refresh the test counts in
`docs/anmerkung/INTEGRATION_v5.md` and `README.md` plus both the counts and the file hashes in
`docs/anmerkung/integration-manifest.json` - nothing generates those, it is a manual step.

## Writing style

No em dashes in prose. `README.md` has none. The changelog history is mixed (1.46.0 and
1.47.0 use plain hyphens, 1.45.0 and older use em dashes), so write new entries with ` - ` to
match the most recent practice.
