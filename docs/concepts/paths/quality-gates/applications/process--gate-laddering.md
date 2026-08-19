---
layer: application
subject: quality-gates
technique: gate-laddering
stack: process
---

# The gate ladder as this repo runs it

Three rungs are declared: pre-commit and pre-push in `lefthook.yml`, and
the merge pipeline in `.github/workflows/ci.yml` plus the local full run
`npm run check` (nine `&&`-chained constituents in `package.json`).

## The rung budgets are written into the config

`lefthook.yml` opens with its own design rationale:

> - pre-commit must stay fast (<5s on a small commit) so it doesn't break flow
> - hooks NEVER stash, restore, or rewrite the working tree (concurrent CLIs
>   share the tree; mutating it would clobber other sessions' work)
> - heavier validation (full type-check, i18n coverage) lives on pre-push so
>   the local build feedback loop catches things before they reach CI

Pre-commit carries four jobs, each glob-scoped (`eslint-staged` over
staged source files, the two i18n gates only when `src/i18n/locales/*.json`
is staged, the secret scan always). Pre-push carries the expensive tier:
`npx tsc --noEmit` (~218s), the census ratchet, i18n coverage, evals, and
the `.ai` conformance pair.

## A rung placement decision with its reasoning attached

The census job's comment in `lefthook.yml` is a model of explicit ladder
design. It was added to pre-push in 2026-08-16 because the check "was
enforced NOWHERE: `census:check` lives only inside `npm run check`, which
nothing runs automatically" — and the author "pushed past a red one" as a
result. Placement: "pre-push and not pre-commit, deliberately: the walk is
~110 rules over ~4,800 files and takes minutes, which is a pre-push cost
(this hook already pays a ~218s typecheck) and an unacceptable pre-commit
one." Cost decides the rung; the comment records both the incident that
demanded a rung and the budget math that chose it.

## Measured failures of the ladder, from the repo's own audits

- **The binding rung was permanently red.**
  `docs/concepts/golden-paths/adding-a-ci-gate.md` queried the Actions API
  (2026-08-15, all-time): `ci.yml` **0 successes in 260 runs**;
  `e2e-smoke`, `audit`, and `release` also 0. Merging continued
  throughout. Every rule those workflows enforce was, for practical
  purposes, advisory — the ladder's refusal rung did not exist, whatever
  the config said.
- **The typical-commit fire set was nearly empty.**
  `docs/concepts/golden-paths/commit-path-gates.md` replayed 1,000 real
  commits against the pre-commit globs and found the only job firing on
  every commit was one that could not block on that machine (the secret
  scan skipping for a missing binary), with the i18n gates firing only on
  locale edits. Individually reasonable trigger scopes composed into a
  mostly ungated rung.
- **Scoping without a live backstop.** The pre-commit lint sees
  `{staged_files}` only; the full-scope `eslint src/` exists in
  `npm run check` — which, per the census comment above, "nothing runs
  automatically," and in CI, which was never green. The
  scoping-is-a-loan rule failed on the backstop side, not the scope side.
- **One broken step blinded the chain.** `npm run check` is an `&&` chain;
  when `check:corpus` (step 5 of 9) carried a hardcoded root path, every
  machine but the author's aborted there and never ran `tsc`, `eslint`,
  or `census:check` (documented at the fix site in
  `scripts/census/check-corpus-integrity.mjs`).

## One authority, partially

The pre-commit lint and the merge-rung lint both run the same
`eslint.config.js` — rule content has a single source; the rungs differ
only in scope and flags (`--quiet --max-warnings 99999` at commit, bare
`eslint src/` in the full chain — neither of which, measured by fault
injection in `commit-path-gates.md`, lets a warn-level rule fail).
Severity is where this ladder's single-authority story ends and the
severity-by-construction technique takes over.
