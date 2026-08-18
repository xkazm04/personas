---
layer: golden-path
subject: ipc-contract
status: forged
techniques:
  - generated-type-contracts
  - drift-gates
  - call-wrapping
  - error-shape-mapping
  - casing-and-naming
  - command-registration
evidence:
  - src/lib/tauriInvoke.ts                    # the single wrapper: timeout ladder, at-least-once hazard documented at the point of failure, idempotency + auto-dedup, raw-primitive ban target
  - src/lib/utils/tauri/safeInvoke.ts         # anchored "command not registered" detection, with the substring-match incident recorded in its own header
  - scripts/check-command-contract.mjs        # declared/registered/invoked set parity + parameter-name parity, four assertions
  - .github/workflows/ci.yml                  # binding-drift job: generate-then-diff with the untracked-file blind spot closed and its regeneration flags documented inline
  - src-tauri/build.rs                        # generation output root declared once, via the route that reliably reaches the generator
counter_evidence:
  - src/api/companion.ts                      # the forked contract: a hand-written mirror of a generated type, patching a value-fidelity defect at the wrong layer
deviations:
  - w2-ipc-contract   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Frontend↔backend IPC contract

Some products ship as one artifact containing **two language worlds**: an
interface layer written in one language and an engine layer written in another,
talking across an in-process or local message boundary. Each world has its own
compiler, its own type system, its own naming culture, and its own build — and
each will happily verify itself into a state of perfect internal consistency
while disagreeing with the other about every shape that crosses between them.
The subject of this path is the **contract** that governs that boundary: what
crosses, in what shape, under what names, within what time, and what happens
when the far side says no.

## What this boundary is — and is not

This is **not a public API**. There is no third-party consumer, no version skew
in the field, no deprecation window: both halves ship together and are always
the same version. That changes the economics completely. Public-API machinery —
versioned endpoints, tolerant readers, additive-only evolution — is weight this
boundary does not need to carry. What it needs instead is **lockstep**: a
guarantee that at every commit, the two worlds agree exactly.

One caveat keeps that framing honest: the lockstep economics hold only while
this boundary is the **sole transport** to these operations. The moment the same
operations are exposed on a second door — a local socket, a management endpoint,
an automation harness — the caller population changes, and the public-API
questions this subject set aside (authentication, addressability, versioned
consumers) come back through that door. Opening a second transport is a
different subject; the rule that belongs *here* is knowing that the contract
below assumes there is exactly one.

The threat model follows from that. A public API fails by *skew in deployment*;
a two-world boundary fails by *drift in the repository*. Both compilers pass.
Both test suites pass. Each half is a closed, self-consistent system — and the
disagreement between them is invisible to every tool that lives inside one
world. It surfaces only at runtime, at the exact moment a value crosses, in
front of a user. Every discipline in this path exists to move that discovery
from runtime back to the commit that caused it.

## The contract is a generated artifact, not a convention

The naive posture is a convention: "the engine's shapes are documented here;
keep the interface's declarations matching." That is two hand-maintained copies
of one vocabulary, which is not redundancy but a race with a delay fuse
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)) —
the copies drift precisely when someone extends a shape and finds only one of
them.

The principal-grade posture: **one side authors, the other side receives
machinery output.** Pick the world that owns the domain model — almost always
the engine, because it owns persistence and business logic — and generate the
other world's declarations from it. The generated files are the contract made
physical: reviewable in diffs, breaking the consumer's compile when the
producer changes, impossible to "forget to update" without a gate noticing.
And the generated declaration must describe **what the transport delivers, not
what the source declared** — a translation that is faithful to the source
type system can still be a false description of the wire, and a false type is
worse than none, because the consumer's compiler now certifies fiction.
The [generated-type-contracts](techniques/generated-type-contracts.md)
technique owns the generation-direction decision, the commit-vs-generate-on-
build tradeoff, and the rule that regeneration is one exact, documented
command.

A generated contract shifts the failure modes rather than abolishing them —
generators regenerate what still exists and silently skip what does not, gates
diff what is tracked and overlook what is new, and nothing at all deletes the
output of a source that died. Those are the
[drift-gates](techniques/drift-gates.md) technique's territory.

## Drift is the central enemy, and it has four faces

Every boundary defect in this class of product is one of four drifts. They are
worth naming separately because each has a different detection story, and a
gate built for one is blind to the others.

1. **Type drift** — a field added, removed, or retyped on one side only. The
   producing side serializes what it knows; the consuming side reads what it
   declared; the difference is silently absent or silently ignored. Caught by
   generation plus a diff gate — *if* the gate sees new and deleted artifacts,
   not just modified ones.
2. **Name drift** — a call renamed or removed while call sites still reference
   the old name. In most transports a call name is a free string, so the
   consumer compiles clean and fails at runtime with "no such operation".
   Caught by generating the name vocabulary as checkable constants and gating
   call sites against it.
3. **Casing drift** — the serialization layer renames fields in transit (each
   world's native casing plus declared renames form a *third*, wire-level
   naming convention that nobody reads). A mis-cased field does not error; it
   deserializes to absent-with-default, the quietest failure on the whole
   boundary. Caught by fixing the wire casing globally and refusing unknown
   fields at development-time boundaries.
4. **Registration drift** — the handler exists, compiles, and is tested, but
   was never wired into the dispatch table that routes incoming calls. Writing
   a handler and registering it are two acts, usually in two files, and the
   second is the one people forget. Caught by set-parity checks between
   declared, registered, and invoked names.

The four detection stories are the
[drift-gates](techniques/drift-gates.md),
[casing-and-naming](techniques/casing-and-naming.md), and
[command-registration](techniques/command-registration.md) techniques.

## A boundary call is not a function call

The transport makes crossing the boundary look like calling a local function —
one expression, a returned promise of a value. The resemblance is the point of
the abstraction and also its danger, because the call has failure modes no
local function has: serialization of both payloads, a handler that can stall or
die independently of the caller, a queue between the worlds, and — critically —
**no shared fate**. The caller can give up while the callee keeps working.

So the call contract has more clauses than a signature:

- **Every call carries a timeout, and timeouts come in named classes, not
  per-call numbers.** An interactive read, a heavy mutation, a long job
  kickoff, and a subscription are different kinds of promise; give each kind a
  named budget and make every call site declare which kind it is. A single
  global timeout is a category error in both directions — it kills legitimate
  slow work and lets broken fast work hang.
- **A timeout is the caller giving up, not the work stopping.** Unless
  cancellation is explicitly plumbed, the far side runs to completion after
  the near side has already reported failure. This is the **at-least-once
  hazard**: a timed-out mutation *may have happened*. Retrying it on timeout
  is therefore a double-execution bug unless the operation is idempotent or
  deduplicated by an identity the caller minted
  ([identity-survives-reuse](../_laws.md#identity-survives-reuse)). Timeout
  must be reported as *outcome unknown* — a third state, distinct from both
  success and refusal
  ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
- **Long work does not belong inside a blocking call.** Past a budget of a few
  seconds, the shape changes: the call becomes a kickoff that returns a job
  identity fast, and progress and completion travel back as events. Stretching
  a blocking call's timeout to cover long work converts every slow job into a
  hung interface.
- **All of this lives in one wrapper.** One chokepoint that every cross-
  boundary call passes through — enforced mechanically, not by review — is
  where timeout classes, error normalization, telemetry, and future policy
  live. Call sites that reach for the raw transport primitive re-decide all of
  it, differently, forever. The
  [call-wrapping](techniques/call-wrapping.md) technique owns this.

## Errors cross as structure, or they die in transit

The default fate of a rich engine-side error is flattening: somewhere in the
transport it becomes a string, and the interface side is reduced to matching
substrings of prose to decide what to show. That is a contract written on
wording — it breaks on the first reword and was never translatable to the
user's language anyway.

The standard: errors cross the boundary in an **envelope** — a code from a
closed, generated vocabulary; a human-readable message; optional structured
data. The near side maps code → user-facing handling at **one door**
([one-validation-door](../_laws.md#one-validation-door)), so that retryable,
user-fixable, and report-this classes are decided once, not per call site. The
timeout case gets its own code, because "outcome unknown" demands different
handling than "refused". The
[error-shape-mapping](techniques/error-shape-mapping.md) technique carries the
full treatment.

## The gates that keep it true

A contract nobody checks reverts to a convention. The minimum standing gates:

- **Generate-then-diff**: regenerate the contract in a clean environment and
  fail on any difference from what is committed — counting *new* and *orphaned*
  files, not only modified ones, because the diff-shaped blind spots are
  exactly where new types and deleted sources hide
  ([gate-sees-target](../_laws.md#gate-sees-target)).
- **Name parity**: declared call names, registered handlers, and invoked names
  are three sets; every pairwise difference is a finding with a distinct
  meaning.
- **Instrument assertion**: a generator that produced zero files, a parity
  check that found zero names — these are failures of the check, never clean
  passes ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

## The techniques

- [generated-type-contracts](techniques/generated-type-contracts.md) — one
  source of truth for shapes; generation direction; commit-the-artifacts vs
  generate-on-build; regeneration as one exact command.
- [drift-gates](techniques/drift-gates.md) — generate-then-diff, its three
  blind spots (untracked files, orphans, the silent no-op generator), and the
  inventory check that closes them.
- [call-wrapping](techniques/call-wrapping.md) — the single chokepoint,
  timeout classes, retry semantics, and the at-least-once hazard made
  explicit.
- [error-shape-mapping](techniques/error-shape-mapping.md) — the error
  envelope, the closed code vocabulary, and the one mapping door.
- [casing-and-naming](techniques/casing-and-naming.md) — the wire casing as a
  contract, the silent-null failure, and ratchets over legacy corpora.
- [command-registration](techniques/command-registration.md) — dispatch-table
  parity, anchored detection of "no such operation", and dead-handler
  inventory.
