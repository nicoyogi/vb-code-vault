# Patch Protocol

## Guarded sequence

1. Run `npm run verify:anmerkung`.
2. Review the exact diff and confirm the changed branch has evidence behind it.
3. Replay the available regression corpus, if it is present locally.
4. Compare pre/post counts for `wrong`, `missed`, `overfired`, `correct`, and `drift`.
5. Inspect newly introduced phrase keys and unmapped emissions.
6. Only then promote the patch.

The private workbooks are not shipped, so a fresh clone can run the repository checks but cannot claim an A/B business-rule replay. Infrastructure changes must not be presented as new business-rule accuracy.
