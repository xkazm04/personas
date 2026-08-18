---
layer: application
subject: build-economics
technique: compilation-unit-splitting
stack: rust
---

# The 2026-07-26 crate split: 8.9 GB → 6.2 GB, measured

The repo's canonical unit split is the app_lib workspace extraction, declared
at `src-tauri/Cargo.toml:1-14`: members `[".", "macros", "core", "db",
"engine"]`, with the motivation stated in the manifest comment itself — "The
single 431k-LOC crate meant one rustc process and an 8.9 GB peak on test
builds; splitting is the only way to parallelize codegen." Target shape:
`core` (dependency-free foundation) → `db` (data layer) → `engine` (business
logic) → `.` (Tauri commands + what's left).

## The win, proven under the one-variable discipline

`scripts/build/sample-build-memory.ps1:14-27` is the before/after record, and
it is a model of the honest-comparison ladder:

```
2026-07-26  one 431k-LOC app_lib                    8,872 MB single rustc
2026-07-27  after the crate split, same debuginfo   6,201 MB single rustc
2026-07-27  after the split, committed debug=0      5,933 MB single rustc
```

The middle row holds debuginfo at the baseline's `line-tables-only` so the
delta is the split alone (**-30%**); the third row isolates `[profile.test]
debug = 0` and finds it worth "a further ~3%, much less than assumed"
(`sample-build-memory.ps1:22-23`). Without the middle measurement the split
and the debuginfo change would have shared credit indistinguishably. The
sampler also implements the attribution rule: `peak_single_rustc_mb` is
called out as "the number that matters — one process is what OOMs a machine"
(`:25-27`), and the script captures the command line of the largest rustc
seen (`:53-61`) so the peak names the crate that produced it — which is how
the follow-up conclusion ("further reduction means shrinking app_lib, not
adding more small crates") was reachable at all.

## The closure probe

The module graph was cyclic at the surface, so cut lines were computed, not
eyeballed: `scripts/build/crate-split-deps.mjs` parses `crate::` paths,
collapses them to module units, and answers `--closure a,b` — "which modules
must travel together for the result to be acyclic". Its header documents both
technique caveats: `--exclude` is what makes it usable (one stray
`crate::engine::SOME_CONST` otherwise drags all 157k LOC of `engine` into
every closure, `crate-split-deps.mjs:27-31`), and it is "a textual
approximation, not rustc … treat a clean closure as 'worth attempting',
never as proof. `cargo check --all-targets` is the actual gate" (`:33-35`).

## The migration shim, with its documented cost

The split was executed through a compatibility shim:
`src-tauri/src/engine/mod.rs:26` is `pub use personas_engine::*;` (plus
targeted `personas_core` re-exports at `:20,:34,:60`), so `crate::engine::X`
kept resolving across four crates and the extraction touched a handful of
files instead of ~849. The standing cost the technique predicts is measurable
here: `personas_engine::` appears **once** in all of `app_lib`'s sources —
the shim itself — so no author is ever confronted with the boundary they are
placing code on, and the two `engine` trees (115 files in-crate, 129 files
extracted) are indistinguishable at every call site. The split bought build
economics; the architectural forcing function is still parked behind the
shim.

## What remains open

The manifest's own target shape is not finished — `app_lib` still carries the
largest surface, and the sampler's conclusion stands as the completion
criterion the split otherwise lacks: the next unit to shrink is the one the
peak is attributed to. No regression baseline runs routinely; the three-row
table above is a point-in-time record, not a time series.
