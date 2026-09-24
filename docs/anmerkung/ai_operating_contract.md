# AI Operating Contract

1. Treat `after` / ground truth as the target; `engineNow` is the current implementation.
2. Prefer `engine_missing_phrase_keys` and `engine_extra_phrase_keys` over raw string differences.
3. Use `shared_inputs`, numeric profiles, and repeated rows to form hypotheses; do not promote one-off coincidences into rules.
4. Negative evidence is binding: an expected-empty row is a negative constraint.
5. A patch must be the smallest branch-level change that explains the evidence.
6. Never silently change thresholds, tier tables, phrase wording, UID semantics, or forwarder precedence as a side effect.
7. Before accepting a patch, run `npm run verify:anmerkung` and the available regression checks.
8. If A/B evidence is absent, improve infrastructure only; do not synthesize training data.
9. Any unmapped `?:phrase` is an explicit data-quality defect, not ignorable noise.
10. Reject a patch if it changes unrelated processor branches without evidence.
