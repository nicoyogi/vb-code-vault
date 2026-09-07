# Patch Protocol v4

## Guarded sequence

1. `verify_bundle_v4.js`
2. `patch_guard.js <patch> <source>`
3. run invariant smoke
4. replay full regression corpus
5. compare pre/post counts for `wrong`, `missed`, `overfired`, `correct`, and `drift`
6. inspect newly introduced phrase keys / unmapped emissions
7. only then promote the patch

A patch that cannot be cleanly applied to the exact source fingerprint is rejected instead of being partially or fuzzily applied.
