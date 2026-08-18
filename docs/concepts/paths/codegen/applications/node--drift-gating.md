---
layer: application
subject: codegen
technique: drift-gating
stack: node
---

# Node: mixed-tier drift gates over one codegen population

This repo runs one pipeline (`scripts/run-codegen.mjs`, 15 tasks) but gates
its artifact classes at deliberately different grades — a live worked
example of per-class gating, gate hosting, and the advisory-confession
rule.

## Gate of record, hosted where it runs

`scripts/check-command-contract.mjs` is the repo's one drift check that
runs locally on every `npm run check` (first entry in the chain, via
`check:contracts`). It never regenerates: it extracts the command union
from `src/lib/commandNames.generated.ts` and the handler list from
`src-tauri/src/lib.rs` and diffs the *names* — sub-250ms, no compiler, no
build. Contrast the binding-drift CI job (`.github/workflows/ci.yml`,
~l.385-431), which needs a 45-minute full cargo build and was documented in
its own file as "5/20 green" — the technique's field case for "a gate
hosted on habitually-red infrastructure is advisory in fact." The same job
is also where the untracked-file blind spot was closed after being proven
blind: `ci.yml:426` adds `git ls-files --others --exclude-standard
src/lib/bindings/`, because `git diff --quiet` exits 0 for a brand-new
binding. The orphan blind spot remains structurally open — 29 committed
bindings whose Rust source no longer exists, invisible to any diff (deep
treatment in the boundary-contract
[drift-gates](../../ipc-contract/techniques/drift-gates.md); inventory
findings in
[codegen-task-registration](../../../golden-paths/codegen-task-registration.md)
§7 B).

## Check mode sharing the write's code path

`scripts/docs/gen-shared-catalog.mjs` builds `CATALOG.md` entirely in
memory, then either writes it or — with `--check` — compares those same
bytes against the committed file and exits 1 with the regeneration command
in the message. One render function feeds both modes, so the check cannot
drift from the write. The generator also emits nothing volatile (no usage
counts, no timestamps) precisely "so the `--check` drift gate stays
meaningful" — determinism in service of gate signal.

## A recorded demotion (tier 2 → tier 3)

The catalog was originally gated: `check:catalog` existed as a build-check.
It was then deliberately **de-gated** — `.claude/CLAUDE.md` records "a
stale catalog no longer fails `npm run check`; regeneration is a
convenience, not a gate" — while the `catalog` task stayed in both
`run-codegen.mjs` presets, so ambient refresh on every `npm run dev`
carries the freshness instead. This is the commit-vs-derive policy's
demotion done mostly right: the invariant was consciously weakened, the
ambient substitute named, the citing document corrected. The `check:catalog`
and `check:catalog-boundary` scripts survive for manual audit and are
labeled as such — the advisory confession the technique requires.

## Manifest acceleration

`scripts/generate-template-checksums.mjs` emits checksum manifests into
both language worlds (`templateChecksums.ts` and `template_checksums.rs`)
from one template set, letting both runtimes verify template integrity by
hash without re-reading the sources. The manifests are themselves derived
artifacts: registered as the `checksums` task (prebuild preset), header-
stamped with their regeneration command — the technique's rule that the
accelerant carries the same obligations as any other generated file.

## The runner as the weakest link, confirmed both ways

Every gate above rides on the runner's honesty, and the runner mostly
earns it: per-task SIGKILL timeout, `Promise.allSettled` so one failure
cannot mask another, `process.exit(failed === 0 ? 0 : 1)` so `npm run
dev`/`build` genuinely abort (confirmed by execution in the legacy leaf).
The remaining gap matches the technique's warning exactly: a task that
exits 0 having written nothing counts as success — there is no
zero-output detection — and one registered task (`cache-budget`) exits 0
unconditionally by design, an always-green entry distinguishable from a
real check only by reading its comment.
