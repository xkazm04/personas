# Golden-path coverage runner — run the corpus against ANY repo

The repeatable wiring for scanning a target repo against the golden-path corpus,
applying safe fixes, and forging improvements back. Built from the
inversion-system-v3 / full-contexts campaign (see
`docs/concepts/paths-enrichment-inbox.md`); promoted here from session scratch so
any session can run it against any repo, from either corpus location.

## The corpus source is location-agnostic (the key wiring)

`scripts/census/build-paths-index.mjs` reads the golden-path corpus and emits the
rubric (`subject-index.json` / `law-index.json` / `router.json`) the kits consume.
It reads from EITHER home — same subject/technique/application layout, `_laws.md`,
`categories.json`:

```bash
# from personas' local authority (today's default)
node scripts/census/build-paths-index.mjs

# from a registry clone (survives the planned paths/ -> registry move)
node scripts/census/build-paths-index.mjs \
  --corpus /c/Users/mkdol/dolla/ai-registry/knowledge/software-engineering \
  --out    ./scripts/census
```
Both produce an identical 105/624/9 index. `--corpus`/`CORPUS_DIR` and
`--out`/`INDEX_OUT_DIR` parameterize source and destination. When `paths/` is
deleted from personas (migration plan decision 3), flip the default `--corpus` to
the registry clone — nothing else in the process changes.

> **Registry mirror can lag `paths/`.** As of 2026-08-19 the registry mirror did
> NOT carry demotions forged into personas `paths/` (e.g. the `reconciliation`
> boundary on `table/performance`). `paths/` is still the authority; forge there,
> then the migration session's mirror-sync propagates to the registry. Build the
> index from `paths/` when you need the freshest corpus, from the registry when
> testing the post-move wiring.

## Preconditions for a target repo

1. A **`context-map.json`** at the repo root (personas' context scanner / the
   passport-onboard flow generates it; LightTrack, pumper, politicas, gravitone
   all have one). This drives Phase-A pruning. Format: `contexts[]` each with
   `name`/`group`/`filePaths`.
2. A **gate command** (how the repo verifies a change by exit code): Rust →
   `cargo check -p <crate>` + `cargo clippy -p <crate> -- -D warnings` +
   `cargo test -p <crate>`; Next/TS → `npx tsc --noEmit` (+ `eslint`, Vitest);
   no-harness → whatever the repo ships.
3. A **remote decision**: push at the end, or local-only (no remote → commit only).

## The phases (kits in ./kits/)

- **Phase A — map & prune.** One agent per target repo maps each context to its
  candidate subjects (bias to recall), emitting `coverage-matrix-<repo>.json` +
  the inverse `subject -> contexts` pairing spine. Prunes the naive
  contexts×subjects matrix ~90%.
- **Phase B — scan (`kits/02-contexts-scan-kit.md`).** One agent per group covers
  its contexts' candidate cells at technique granularity vs the governing rule +
  cited laws; emits `findings-<repo>-<group>.json` keyed by `problem_shape` (the
  cross-site/cross-repo dedup key). For a lighter subject-major sample instead,
  use `kits/01-transplant-scan-kit.md`.
- **Phase C — pair.** `node consolidate-phaseC.mjs <findings-dir>` (in this dir):
  aggregates findings by `problem_shape` -> all sites, with pairing metrics
  (sites/problem, cross-repo recurrence) and FIX/DEFER split.
- **Phase D — apply (`kits/03-deeper-fix-triage-kit.md`).** Triage each finding
  (a) safe-once-verified -> fix BEHIND A PROBE (fail-before/pass-after regression
  test); (b) product-judgment -> decision queue for the operator; (c)
  claim-fails-when-run -> **corpus demotion**. One writer per repo, atomic commits,
  isolated-index ritual (`git read-tree HEAD` seed), verify `git log -1` after each.

## Verification lanes (dynamic > static)

A static "holds (by pattern)" is not "holds (when run)". For perf/functional/LLM
techniques, add a probe that MEASURES the quantity or EXERCISES the flow (the
`verified_by:` edge). A probe that fails is a BUG (fix + its regression test) or a
DEMOTION (the technique's claim doesn't survive a run). This is what makes the
behavior-changing/"risky" territory safely applicable instead of perpetually
deferred, and it is the feedback edge that grades the corpus down.

## Forge-back (improve / demote the corpus)

Enrichment (new-law / new-technique / new-application) and demotions land in
`docs/concepts/paths-enrichment-inbox.md` for the corpus owner, and — for
demotions safe to forge directly — as technique **boundary clauses** in
`docs/concepts/paths/<subject>/techniques/<t>.md` (stack-free: the purity gate
bans stack identifiers like React/IndexedDB/.rs in technique bodies; move them to
`evidence:`). After forging, `node scripts/census/check-corpus-integrity.mjs`
must stay green, then the migration session re-syncs the registry mirror.

## One-line status: is a repo runnable?

```bash
test -f <repo>/context-map.json && echo "context-map OK" || echo "needs a context scan"
```
