---
layer: application
subject: quality-gates
technique: gate-liveness
stack: node
---

# Gate liveness in this repo's Node checker scripts

The corpus-integrity checker, `scripts/census/check-corpus-integrity.mjs`,
is the repo's living exemplar of the technique — it practices instrument
assertion, carries the vocabulary in its exit codes, and documents its own
liveness incident inline.

## Instrument asserted before the result, with its own exit code

The checker's header states the rule and its provenance: "THE INSTRUMENT
IS ASSERTED BEFORE THE RESULT. A checker that silently walks zero files
reports success. Wave 1 found four gates in this repo that ran green while
checking nothing (an FK assertion against an empty database, a parity test
comparing a file to itself, a secret scan exiting 0 when the scanner was
absent)." The implementation keeps three outcomes distinguishable:

- **FATAL, exit 2** — could-not-run: required inputs missing
  (`FATAL: required input missing … This checker cannot run. Failing
  loudly rather than reporting a green tree.`), a spine walk that yields
  fewer than 200 leaves (`THE WALKER IS BROKEN, NOT THE SPINE.`), or a
  directory listing of zero markdown files (`THE READER IS BROKEN.`).
- **fail, exit 1** — ran, found violations (accumulated in `failures[]`
  via `fail()`).
- **exit 0** — ran, clean.

Note the population floor: not just `leaves.length > 0` but
`leaves.length < 200` against an expected ~247. A broken walker that
still finds *some* nodes is caught by the bound, not just by zero.

## The portability incident, preserved at the fix site

The `ROOT` constant carries this comment: it "read
`const ROOT = 'C:/Users/mkdol/dolla/personas'` until 2026-08-15 — the
author's machine. On any other checkout it exits non-zero immediately, and
because `npm run check` is an `&&` chain with `check:corpus` at step 5 of
9, that aborted the run before `tsc --noEmit`, `eslint src/` and
`census:check` ever executed." One non-portable step blinded four
downstream gates on every machine but one — the chain-ordering failure
mode, measured. The fix derives the root from the script's own location:

```js
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
```

The same comment names the embarrassment that makes the lesson stick: the
hardcoded path "was written in the same pass as the doctrine paragraph
telling everyone else to assert their instruments."

## The announced skip: honest output, zero enforcement

`scripts/secret-scan.mjs` (the pre-commit `gitleaks-staged` job in
`lefthook.yml`) probes for the scanner and, when absent, prints
"`gitleaks not installed — secret scan SKIPPED (commit not blocked)`" plus
an install hint, then **exits 0**. This is the announced-skip pattern:
could-not-run is *visible* (unlike the Wave-1 secret scan that exited 0
silently) but not *blocking*. Per the technique, that posture is
defensible only with a binding backstop running the same check — and the
CI workflows currently run no secret scan, so on any machine without the
tool the D9 control is opt-in. The wrapper is a liveness improvement over
its predecessor on the display channel and unchanged on the enforcement
channel.

## The invocation channel, measured

The sibling audit in
`docs/concepts/golden-paths/cross-artifact-drift-gate.md` records two
liveness probes worth repeating anywhere:

- `scripts/i18n/check-coverage.mjs --strict`, run against a locales
  directory containing only `en.json`, "printed an empty table and
  **exited 0**" — an instrument-assertion gap found by seeding the
  degenerate input rather than by reading the code.
- Checkers there are run "**directly, never through a pipe** — a pipe
  replaces the exit code with the pipe's, which is how a red
  corpus-integrity run was pushed past once already." The verdict channel
  is part of the gate.
