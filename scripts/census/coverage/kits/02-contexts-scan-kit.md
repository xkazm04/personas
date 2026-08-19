# Phase B — Context-exhaustive scan kit (T2, READ-ONLY)

You scan an assigned slice of ONE sibling repo against the golden-path corpus, at
CONTEXT granularity, and emit machine-readable findings for the cross-repo pairing
ledger. **READ-ONLY: no edits, no commits, no writes to any repo.** You write ONE
findings JSON to the scratchpad and return a short summary.

## Inputs
- **Your coverage matrix:** `.../scratchpad/coverage-matrix-<repo>.json` — the
  `context → candidate_subjects` map from Phase A. Your assignment names which
  contexts you own; look each up here to get its candidate subjects (your cell list).
- **The scoring protocol:** `.../scratchpad/v3-fulltest-kit.md` — READ IT. The
  verdict vocabulary (holds / holds(self) [politicas only] / partial / violates /
  n/a-absent), governing-rule + cited-law scoring, two-impl counts, FIX/DEFER,
  independence-by-purity-gate — all apply unchanged.
- **The rubric:** `C:/Users/mkdol/dolla/personas/scripts/census/subject-index.json`
  (subjects → techniques + laws) and `.../law-index.json`. Read each scored
  subject's technique bodies under
  `C:/Users/mkdol/dolla/personas/docs/concepts/paths/<subject>/techniques/*.md`
  for its governing rule.

## The unit of work: one CONTEXT (T2 — attest every one)
For EACH context in your assignment:
1. Read the context's real files (from the repo's `context-map.json` file list).
2. For each **candidate subject** of that context (from the matrix), locate the
   manifestation and score it at technique granularity vs the governing rule + cited
   laws → a verdict. A candidate that turns out absent → `n/a-confirmed` (Phase A
   over-included by design; confirming it is part of T2 completeness).
3. **Attest the context**: even for the pruned-out subjects, you don't re-scan them,
   but you DO confirm the context's overall profile matches (one line). T2 means no
   context is left unread.
4. Two implementations for any load-bearing count; a disagreement is a finding.

## Emit findings (the Phase-C payload)
Write `.../scratchpad/findings-<repo>-<yourslug>.json`:
```json
{"repo":"<repo>","assignment":"<group-or-context-list>",
 "contexts_covered":[{"context":"<name>","candidates":N,"scored":N,"na_confirmed":N,
                      "verdicts":{"holds":N,"partial":N,"violates":N}}],
 "findings":[
   {"repo":"<repo>","context":"<name>","subject":"<s>","technique":"<t>",
    "verdict":"violates|partial","law":["..."],"file":"path:line",
    "problem_shape":"<short canonical label — the KEY that pairs this across sites, e.g. 'sort-missing-id-tiebreaker', 'catch-reaches-no-door', 'unversioned-vocabulary-subset'>",
    "failure_scenario":"<one line: input/state → wrong outcome>",
    "tag":"FIX|DEFER","fix_hint":"<one line>"}
 ],
 "enrichment":[{"bucket":"new-law|new-technique|new-application","subject":"<s>","practice":"<...>","file":"path:line"}]
}
```
**`problem_shape` is load-bearing** — it is the dedup key Phase C pairs on. Use a
short canonical kebab label describing the DEFECT CLASS, not the site. Identical
defects in different files/contexts/repos MUST get the identical `problem_shape`
string so they pair. Reuse these where they fit (from the prior transplant run):
`sort-missing-id-tiebreaker`, `catch-reaches-no-door`, `unversioned-vocabulary-subset`,
`index-derived-identity`, `egress-scrub-asymmetry`, `stuck-status-no-reaper`,
`whole-collection-fails-on-one-row`, `retry-classifies-nonretryable`,
`secret-scanner-absent`, `unauthenticated-spending-route`, `budget-defaults-unlimited`.
Invent new ones as needed, kebab-case, defect-not-site.

## FIX vs DEFER (same as resolve-kit)
- **FIX** = safe, non-behaviour-changing, obvious-correct, minimal diff.
- **DEFER** = behaviour-changing / auth-crypto-secrets-payment-deletion / schema
  migration / judgment / low-confidence. Note pumper's 4 already-fixed issues
  (credential-injection, provisioner desync, census 5xx-masking, NAICS double-count)
  — if re-seen, do NOT report as new.

## Return (final text)
Compact: contexts covered (all attested?), total cells scored, verdict tally,
FIX-count vs DEFER-count, the top `problem_shape`s you saw (with site counts), and
confirm the findings JSON was written. The JSON is the deliverable.
