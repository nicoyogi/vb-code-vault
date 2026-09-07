# Anmerkung Diff / AI Bundle v5 — Hardened Limit Build

This is the practical ceiling for a browser-first rule-engine bundle without a fresh A/B workbook corpus: the package now treats the engine as an auditable, replayable artifact rather than only a diff container.

## v5 highlights

- Locale-safe numeric parsing for workbook text values (`1.234,56`, `1,23`, native Excel numbers).
- Transaction-safe bulk execution with `finally` restoration of global workbook state.
- `window.AnmerkungV5` diagnostics facade with health, stable fingerprints, phrase inspection, numeric parsing, and transactional execution helpers.
- V4 diagnostics retained for backward compatibility.
- Strict JavaScript syntax gate, security lint, performance lint, invariant checks, and patch applicability checks.
- SHA-256 source provenance and machine-readable artifact manifest.
- AI workflow remains evidence-first: no fabricated A/B rows, no patch without replay evidence.

## Important boundary

No new A/B Excel pair was supplied in this turn, so this bundle cannot truthfully claim new business-rule accuracy. The hardening is real and testable; business-rule changes still require representative A/B evidence.

## Recommended gate before production

`syntax -> invariant -> security -> performance review -> A/B replay -> zero unintended regressions -> strict patch apply -> release fingerprint`
