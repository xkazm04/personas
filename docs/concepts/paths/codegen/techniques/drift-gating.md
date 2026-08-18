---
layer: technique
subject: codegen
technique: drift-gating
status: forged
laws: [gate-sees-target, failure-not-empty-success, derivation-names-recomputation]
shared_with: []
---

# Drift gating

A committed derived artifact carries an invariant — "this equals what the
generator would produce right now" — and an invariant without a gate is a
hope. The deep anatomy of the gate for a *single* artifact class is already
written: generate-then-diff as the spine, and its three blind spots (the
untracked new file, the orphan whose source died, the generator that
silently did nothing) are treated in full in the boundary-contract
[drift-gates](../../ipc-contract/techniques/drift-gates.md) technique, and
everything there transfers unchanged to any other artifact class. This
technique does not repeat it. What lives here is what only the **pipeline
level** can see: a heterogeneous *population* of artifact classes, each with
its own policy tier, sharing one runner and one budget.

## One gate per class, not one mega-gate

The tempting implementation is a single check: run the whole pipeline, then
diff the whole tree. It works, and it is worth having as a backstop — but as
the *only* gate it has two structural costs:

- **Attribution is destroyed.** "Something under the generated roots
  changed" forces the failing contributor to bisect the pipeline by hand.
  Per-class gates — each regenerating one task's declared output root
  (declared in the registry, per
  [task-registry-design](task-registry-design.md)) and diffing only that —
  fail with the generator's name in the message, and the message becomes
  its own fix instruction.
- **The cost is the maximum, always.** The mega-gate pays the full pipeline
  on every run. Per-class gates can be triggered by what actually changed —
  the class whose *inputs* are untouched need not regenerate at all,
  provided the input set is honestly declared (an undeclared input is a
  gate blind spot of its own: the gate skips exactly when the undeclared
  input was the thing that changed —
  [gate-sees-target](../../_laws.md#gate-sees-target)).

## Placement follows cost

Where each gate runs is an economic decision, not a stylistic one:

- **Commit-time** for checks that are cheap and local — a checksum
  comparison, a single small class's regenerate-and-diff. Feedback in
  seconds, at the moment of the mistake.
- **The automated pipeline** for everything expensive — full regeneration
  of heavy classes, cross-class inventory checks. This is the gate of
  record; commit-time gates are a courtesy layer in front of it, never a
  replacement, because local hooks can be skipped and the automated
  pipeline is the door that cannot be.
- **The test suite**, for any check cheap enough to live there. A check
  expressed as an ordinary test runs on every developer machine, every
  branch, every fork — and cannot be taken offline by an unrelated
  infrastructure failure. The cheapest honest shape: give the generator a
  check mode that builds the fresh output in memory and compares it to the
  committed copy — **the same code path that writes is the code path that
  checks**, so the check cannot drift from the write — then assert that
  mode from a test whose failure message is the regeneration command.

One placement rule outranks the economics: **a gate of record must be
hosted where it actually runs.** A perfectly designed check living on
infrastructure that is habitually red, chronically slow, or routinely
skipped is advisory *in fact* regardless of its design — measured in the
field as a drift job green a quarter of the time, which everyone had
learned to read past. When the honest hosting for the full check does not
exist, say so and ship the cheap approximation somewhere that runs, rather
than pointing at the aspirational gate as if it were protection.

## Manifests: the gate accelerant with its own obligations

For expensive generators, a **checksum manifest** — a committed file mapping
each input (or output) to a content fingerprint — lets the gate verify
freshness by hashing instead of regenerating: recompute fingerprints,
compare to the manifest, done in milliseconds. Two obligations come with the
trick:

- **The manifest is itself a derived artifact.** It needs its own named
  recomputation and its own lockstep discipline
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation));
  a manifest updated by hand to silence a gate is the gate's own uniform
  worn by drift.
- **A hash gate sees only what it hashes.** If the generator's output
  depends on anything outside the fingerprinted input set — an environment
  detail, a tool version, a second input nobody listed — the manifest gate
  passes exactly when that unhashed factor diverges. The manifest's input
  list is a claim, and it must be maintained as one.

## Advisory checks must confess to being advisory

A population under mixed policy (see
[commit-vs-derive-policy](commit-vs-derive-policy.md)) will contain checks
that exist but do not fail the build — staleness reporters for
convenience-tier artifacts, boundary audits kept for manual runs. These are
legitimate, with one hard rule: **an advisory check must be labeled as
advisory everywhere it is mentioned.** The most damaging state in this whole
technique is a check that people *believe* is a gate and is not — every
"there's a check for that" conversation then transmits a guarantee nobody is
providing, which is strictly worse than the check not existing, because it
suppresses the vigilance that its absence would have preserved. When a
gate is demoted to advisory, the demotion note (per the policy technique)
must chase down the places that cited it as enforcement.

## The runner's honesty is part of every gate

All of these gates execute through the shared runner, so the runner's
failure contract is a dependency of every one of them: a gate whose
underlying task was skipped, timed out, or produced zero outputs must
surface as a failed *check run*, never as a clean pass
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The mechanics live in
[generator-failure-isolation](generator-failure-isolation.md); the point
that belongs here is that gate composition inherits the weakest link — a
perfectly designed diff gate downstream of a runner that swallows task
failures is a gate on a proxy.
