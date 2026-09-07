# v5 — Hardening / Replayability

- Fixed locale-sensitive numeric parsing for common EU-formatted text values such as `1.234,56`.
- Added `AnmerkungV5` diagnostic facade for deterministic health, phrase-set inspection, locale parsing, fingerprints, and workbook transactions.
- Bulk processing now restores global workbook state in a `finally` block even if a rule throws.
- Kept the hardening layer opt-in and behavior-neutral except for the corrected numeric parser.
- Added machine-checkable verifier, invariants, security and performance gates.
