---
layer: technique
subject: codegen
technique: generated-file-hygiene
status: forged
laws: [derivation-names-recomputation, one-authority-per-vocabulary]
shared_with: []
---

# Generated-file hygiene

A generated file spends its life impersonating an authored one: same
directory conventions, same syntax, same syntax highlighting. Every defect
in this technique's territory begins with a human (or a tool) treating it
as authored. Hygiene is the set of declarations and exclusions that make
the impersonation fail fast.

## The self-declaring header

Every generated file opens with a header stating four things:

1. **That it is generated** — the do-not-edit line, first, in the file's
   comment syntax, phrased as a consequence rather than a plea: edits here
   are erased by the next regeneration.
2. **What generates it** — the task's registry name, so the reader can find
   the machinery.
3. **What it derives from** — the authoritative input, so the reader knows
   where the *real* edit goes. This line does the most work: the person
   opening a generated file almost always wants to change something, and
   the header's job is to redirect that intent to the source before the
   editor does.
4. **How to rebuild it** — the exact regeneration command. This is the
   stored derivation naming its recomputation at the point of discovery
   ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)),
   placed where the next confused reader is already standing.

The header is emitted *by the generator*, never added by hand — a
hand-added header is one more thing to drift, and a generator that writes
its own header keeps the header true by construction.

## One writer per file — and the tools count as writers

A generated file must have exactly one writer: its generator. Everything
else that routinely rewrites source — formatters, lint auto-fixers, import
organizers, license-header injectors — must be excluded from generated
roots, or the file has two authorities and its content oscillates between
them ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
the formatter reflows the output, the next regeneration reverts the reflow,
and every pipeline run now produces a phantom diff. The exclusions live in
each tool's own configuration, keyed by the declared output roots from the
registry — which is one more reason output roots are registry data.

Review tooling gets the inverse treatment: generated paths are *marked* so
diffs collapse by default. Reviewers can expand when provenance is in
question; they are not forced to scroll.

## Determinism, or the death of diff signal

The generator's output must be a pure function of its inputs: stable
ordering (sort what the source provides unordered), no timestamps, no
absolute paths, no machine or user names, no locale-dependent formatting,
no iteration-order leakage from hash containers. Every violation produces
diffs that carry no information — and noise in generated diffs is not
cosmetic. The drift gate's entire mechanism is "any difference is a
finding"; nondeterminism converts that into "there is always a difference",
which either breaks the gate outright or, worse, trains everyone that
generated churn is normal and skimmable. A reviewer who has learned to
skim generated diffs will skim the one that mattered.

Determinism is testable, and cheaply: run the generator twice, require
byte-identical output. Put that test in the pipeline once and the whole
class of regressions is fenced.

## Output roots: one per class, retired ones buried

Each artifact class writes to exactly one directory, declared in exactly
one place. When an output root moves, the old root is **deleted and its
recreation blocked** — not abandoned in place. Two live roots for one class
is the worst hygiene state available: both look generated, both carry
headers claiming freshness, consumers import from whichever one tooling
suggests first, and only one is being regenerated. The boundary-contract
instance of this rule, with the drift incident pattern behind it, is stated
in
[generated-type-contracts](../../ipc-contract/techniques/generated-type-contracts.md);
it generalizes to every class in the pipeline.

## Enforcement is layered, because the header is just a sign

The header persuades; it does not prevent. The layers behind it: tool
exclusions prevent *automated* hand-edits (the most common kind); the drift
gate catches human hand-edits after the fact, because an edited artifact no
longer matches its regeneration and the next gated run fails with a diff
that shows exactly the edit; and for gate-less convenience-tier artifacts
(see [commit-vs-derive-policy](commit-vs-derive-policy.md)), the next
ambient regeneration silently reverts the edit — which is precisely why the
header must be blunt about erasure: for those files, the warning is the
only protection the editor's work gets.
