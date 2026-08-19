---
layer: golden-path
subject: diff-comparison
status: forged
techniques:
  - semantic-level-selection
  - computation-offload
  - presentation-modes
  - drift-against-declared
  - pair-and-baseline-selection
  - diff-honesty
evidence:
  - src/features/agents/sub_executions/workers/comparisonDiff.worker.ts    # the one off-thread kernel: request ids, chunked streaming, error shape distinct from empty result
  - src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts  # request identity, content-fingerprint cache keys, synchronous small-input fallback
  - src/features/agents/sub_executions/libs/comparisonHelpers.ts           # set-membership line diff with its limitations disclosed in-source; top-level-key structural diff; thresholded "what changed" summary
  - src/features/agents/sub_executions/components/list/ComparisonDiff.tsx  # side-by-side field diff + inline line diff, difference counts on the header
  - src/features/agents/sub_lab/shared/labPrimitives.ts                    # the guarded kernel: DP cell ceiling (MAX_DP_CELLS), prefix/suffix strip, tiered degradation token→line→coarse
  - src/features/plugins/obsidian-brain/sub_sync/conflictDiff.ts           # real LCS chosen for prose because order and duplicates matter — level selected from the entity, contrast documented in-source
  - src/lib/execution/middleware/driftMiddleware.ts                        # the drift species wired as pipeline middleware: outcome vs persona design expectation, decoupled from the execution lifecycle
  - src/lib/design/designDrift.ts                                          # declared expectations with tolerances (80% of timeout, 50/80% of budget); each finding names the design section to amend
  - docs/concepts/golden-paths/version-diff-view.md                        # measured census: 4 client kernels / 2 server deltas, replayed pathologies, stringify-decided-equality census rule
counter_evidence:
  - src/features/agents/sub_lab/shared/DiffViewer.tsx                      # projection reads 5 of 7 fields and the empty state affirms "no structural difference" over the projection — a diff that can deny a change it cannot see
  - src/features/teams/sub_teamMemory/libs/memoryDiff.ts                   # id-set alignment across runs whose ids never match — byte-identical runs render as all-added + all-removed
  - src-tauri/src/commands/infrastructure/dev_tools/competitions.rs        # two candidate baselines; the one displayed is whichever diff string is longer in bytes (:562)
deviations:
  - w12-diff-comparison   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Diff & comparison surfaces

A diff is a **claim about a pair**: *these two states are identical except
here.* It is the one artifact in a product that is built specifically so the
reader does **not** have to read both sides — which means it is believed
without verification, by construction. Nobody audits a diff by re-reading
the originals; the diff exists precisely because that is too expensive.
Every defect in a comparison surface therefore converts directly into a
false belief in the reader's head: an unmarked region is read as
"unchanged", a missing row is read as "never existed", an empty result is
read as "nothing happened". The whole subject is the discipline of earning
that unverified trust — computing the difference at the level where it is
meaningful, off the thread the reader is standing on, and presenting it
without a single silent lie.

Three decisions precede any algorithm, and each is a design act with an
owner, not a default that fell out of the data:

1. **What pair?** — which two states are compared, and who chose the
   baseline ([pair-and-baseline-selection](techniques/pair-and-baseline-selection.md)).
   Swapping the baseline silently swaps the question the diff answers.
2. **At what level?** — bytes, lines, fields, or domain semantics
   ([semantic-level-selection](techniques/semantic-level-selection.md)).
   A structured entity diffed as text produces noise; noise trains readers
   to skim; skimming is how the one real change slips through.
3. **For which audience?** — reviewing, narrating, or triaging
   ([presentation-modes](techniques/presentation-modes.md)). The same
   difference has three honest renderings, and the wrong one wastes the
   reader's attention or starves it.

Only after those three does computation begin — and computation has its own
law: **a diff that freezes the surface it explains has failed its purpose**
([computation-offload](techniques/computation-offload.md)). Throughout,
one standing obligation binds every layer:
**the diff must not lie by omission**
([diff-honesty](techniques/diff-honesty.md)).

## Where this subject ends

- **Which versions exist** — the version records, their lineage, their
  promotion states, and the guarantee that a version can be returned to are
  the [versioning-snapshots](../versioning-snapshots/versioning-snapshots.md)
  subject. This subject *consumes* pairs of states that subject preserves;
  it never mints, stores, or retires them. The tell: "can I see v3?" is
  versioning; "how does v3 differ from v7?" is here.
- **Which of the two is better** — a diff shows *difference*, never
  *verdict*. Judged comparison — scoring, win-rates, arenas — belongs to
  the eval-harness subject, whose
  [comparison-modes](../eval-harness/techniques/comparison-modes.md)
  technique is the authority on asking "which wins" honestly. The two
  compose: an arena renders a diff so the judge can see what distinguishes
  the candidates, but the moment a comparison surface starts declaring
  winners it has crossed the border and inherited that subject's burdens
  (position bias, tie handling, instrument stability).
- **What to do when concurrent edits collide** — the sync subject owns
  conflict *policy*: detecting that two replicas diverged and deciding
  merge, overwrite, or ask. Its
  [conflict-detection-and-policy](../sync-replication/techniques/conflict-detection-and-policy.md)
  technique consumes this subject's computation (a three-way diff against
  the common ancestor is how a conflict becomes legible to a human) but
  owns the decision that follows. Diff shows; policy chooses.
- **The trajectory between endpoints** — replaying *how* state moved from
  A to B, step by step, is time-travel replay (a sibling subject). A diff
  compares endpoints and is blind to the path; when the reader's question
  is "in what order did this happen", they need replay, not a bigger diff.
- **"What changed while I was away"** — session resume (a sibling subject)
  is a *consumer* of this subject with a specific baseline choice: last
  state the user saw. The baseline discipline it needs is defined here.

## The pair is a statement, not an accident

Every comparison surface answers a question of the form "X relative to Y" —
and Y is almost never the only candidate. Previous version, promoted
version, common ancestor, declared expectation, sibling candidate: each
baseline turns the same X into a different finding. A surface that does not
*display* its baseline is asking the reader to guess the question; a reader
who guesses wrong walks away with a confident, wrong belief. So the pair is
explicit on the surface, the default baseline is a recorded design decision,
and the sides are named by **role** (baseline/candidate, declared/actual,
mine/theirs) rather than by position. The
[pair-and-baseline-selection](techniques/pair-and-baseline-selection.md)
technique carries the baseline species and the identity discipline that
pairing depends on.

## The level is chosen from the entity, not from the tooling

Text diffing is the universal solvent, and that is exactly its danger: it
dissolves structure. Serialize a structured entity and diff the lines, and
every reordered key, requoted string, and re-indented block becomes a
"change" — dozens of phantom edits burying the one real one. The rule is to
diff each thing at its own semantic level: **field-level diffs over the
entity's own schema for structured data, text diffs for text** — composed,
when a structured entity carries prose fields, as a field-level outer diff
with a text diff inside the changed field. And the surface *says which it
is doing*, because "no change shown" is only meaningful relative to a
stated level. The
[semantic-level-selection](techniques/semantic-level-selection.md)
technique owns the levels, the keyed alignment of lists, and the
normalization ledger.

## The computation leaves the reader's thread

Diff algorithms are superlinear in the worst case, inputs are unbounded in
the tail, and the surface showing the diff is the very surface the reader
is trying to use. So comparison is computed off the interactive thread,
under declared budgets — size caps, time budgets — with three disciplines:
a result that arrives after the user changed the pair is discarded by
request identity, a budget overrun degrades to a *disclosed* coarser answer
rather than an undisclosed partial one, and a computation that dies renders
as "comparison unavailable", never as an empty diff. The
[computation-offload](techniques/computation-offload.md) technique carries
the mechanics; the disclosure wording belongs to
[diff-honesty](techniques/diff-honesty.md).

## Drift is a diff whose left side is a promise

One species deserves its own name. When the baseline is not a past state
but a **declared expectation** — a design contract, an intended
configuration, a manifest of what should be present — the comparison stops
answering "what changed" and starts answering "where does reality depart
from the promise". That shift changes everything downstream: the finding is
directional (exceeding the promise and falling short of it are different
discoveries), the response is a fork (fix reality *or* amend the promise —
a drift surface offering only the first verb turns every stale promise into
a permanent alarm), and the left side has an author and a version that the
finding must cite. Drift detection is how a system notices it is quietly
becoming something nobody decided it should be. The
[drift-against-declared](techniques/drift-against-declared.md) technique
owns the species.

## The diff never lies by omission

The reader trusts silence. Therefore every mechanism that can *produce*
silence — truncation, exclusion, normalization, failure, an element that
moved rather than changed — must disclose itself on the surface. "Not
compared" is a third state, rendered distinctly from "unchanged";
"comparison unavailable" is spelled differently from "no differences"; a
truncated diff says so at the point of truncation; a summary count carries
the predicate it counted under. This is the subject's honesty floor, and it
is load-bearing precisely because no reader will ever check. The
[diff-honesty](techniques/diff-honesty.md) technique enumerates the
disclosures.

## The techniques

- [pair-and-baseline-selection](techniques/pair-and-baseline-selection.md) —
  baseline species (temporal, lifecycle, ancestral, declared, sibling),
  explicit pair display, role-named sides, identity across the pair, and
  who owns the default.
- [semantic-level-selection](techniques/semantic-level-selection.md) — the
  level ladder from bytes to domain semantics, schema-driven field diffs,
  keyed list alignment, level composition, and the normalization ledger.
- [computation-offload](techniques/computation-offload.md) — off-thread
  computation, budgets and degradation, supersession by request identity,
  result caching, and the small-input synchronous fast path.
- [presentation-modes](techniques/presentation-modes.md) — side-by-side
  for review, inline for narrative, summary counts for triage; the
  change-kind vocabulary; direction conventions; the escalation path from
  count to detail.
- [drift-against-declared](techniques/drift-against-declared.md) — the
  promise-as-baseline species: tolerances, directionality, the
  fix-or-amend fork, drift deduplication, and baseline refresh as an
  attributed act.
- [diff-honesty](techniques/diff-honesty.md) — disclosed truncation,
  declared undiffables, failure spelled as failure, moved-vs-changed, and
  summary/detail consistency.
