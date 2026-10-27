# Anmerkung v5 integration

This repository integrates the v5 Anmerkung hardening into `assets/anmerkung.js` and keeps the existing browser architecture intact.

## Changes
- v5 hardening layer is present in `assets/anmerkung.js`.
- `tests/harness/load-engine.mjs` now finds the latest Git commit that actually contains a historical Wackler rate-card blob instead of stopping at the deletion commit.
- Added `tests/anmerkung-v5.test.mjs` for v5 parser/hardening invariants.
- Added `scripts/anmerkung/verify.mjs` for syntax, required-engine checks, SHA-256 capture, and full repository test verification.
- Added v5 AI/patch protocol documentation under `docs/anmerkung/`.

## Verification

`npm test`:

- 591 tests on a machine with the plaintext `assets/honold-tariff.js` and `assets/dachser-ratecards.js`
- 591 passed
- 0 failed
- 9 of the 591 need a local plaintext asset. The 4 Honold workbook replays (20379045, 20381523, 20380293, 20382640) skip without `assets/honold-tariff.js`; the 5 Dachser card tests (the Sonderfahrt/bisherigen 50-row table, the 110 pin for 20261019 row 201, the K1AU card test, the Referenz table, the national-card asset guard) skip without `assets/dachser-ratecards.js`. A clone with neither reports 582 passed, 9 skipped.

The integration manifest is refreshed against the current tracked source.

`npm run verify:anmerkung`:

- source exists: PASS
- Node syntax: PASS
- required processors/helpers: PASS
- v5 facade present: PASS
- repository regression suite: PASS

No business-rule sign-off is implied by the v5 hardening alone. New A/B workbooks are still required for any additional business-rule change.
