---
layer: technique
subject: fleet-orchestration
technique: result-harvest
status: forged
laws: [failure-not-empty-success, count-carries-predicate, one-validation-door]
shared_with: []
---

# Result harvest

Harvest is the phase that makes a fleet run a *computation* instead of a
crowd: the orchestrator collects each session's result, classifies every
member of the dispatch roster into a terminal account, and composes the
run-level answer. The defining commitment is **accountability over
optimism** — a harvest never reports what came back without also reporting
what did not, because the most expensive fleet failure is the run that looks
complete while a third of it silently never happened
([failure ≠ empty success](../../_laws.md#failure-not-empty-success)).

## The result contract

Harvest is only as good as what sessions hand it, so the result is a
contract set at dispatch, not a scavenger hunt run afterwards:

- **A declared drop point.** Each session's task states where its result
  goes — a structured document at an agreed path in its write set, a record
  appended to a run ledger, a final structured event on its output stream.
  The orchestrator reads declared drop points; it does not grep transcripts
  and hope. Scraping a session's free-form output for its conclusion is the
  harvest-layer equivalent of parsing logs for state: it works until the
  phrasing drifts.
- **A validated shape.** Results pass one validation door on ingestion —
  schema-checked, size-bounded, attributed to the session identity and run
  identity they claim ([one door](../../_laws.md#one-validation-door)). A
  malformed result is itself a finding: it is classified as such, kept for
  diagnosis, and never silently coerced into the aggregate.
- **Failure is a result.** The contract gives sessions a way to report "I
  could not do this, and here is why" as first-class output. A session that
  can only succeed or vanish forces the harvest to infer every failure,
  and inference is strictly worse evidence than a report.
- **Report only what was declared — never a paraphrase.** A session's
  summary in the aggregate is the completion it actually declared through
  the contract, or nothing. Synthesizing a summary from the session's last
  observed state ("it went quiet after editing three files, so: done?")
  launders inference into the place reserved for reports, and the aggregate
  loses the one distinction the whole accounting exists to preserve.

## Roster accounting: every member ends somewhere

The dispatch roster (see [parallel-dispatch](parallel-dispatch.md)) is the
harvest's checklist. For each member, exactly one terminal account:

- **succeeded, result ingested** — the good path, with its result validated.
- **succeeded, result missing** — the session says it finished, but the
  drop point is empty or unreadable. A distinct class, because it indicts
  the contract or the session's compliance, not the work.
- **failed, reported** — the session's own account of why.
- **lost** — the fleet's inference (sweeper or recovery), with which
  inference path attached.
- **timed out / cut off** — the straggler policy fired; whatever partial
  output existed at the cut is preserved and labeled partial.
- **never started** — queued but not admitted before the run closed.

The run summary is these counts *with their predicates*: "run R dispatched
11; 7 succeeded-with-results, 1 succeeded-without, 2 failed (named), 1 timed
out at the straggler deadline" is an accounting; "mostly done" is not
([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
arithmetic invariant is total: accounts sum to the roster, always — a member
that fits no class is a bug in the harvest, and it should fail loudly rather
than be dropped from the denominator.

## Stragglers get a policy, not a vigil

A wave's completion time defaults to its slowest member, and its slowest
member is sometimes dead in a way nothing has noticed yet. The straggler
policy is declared at dispatch:

- **A deadline, always.** Per-member and/or per-run; infinite patience is
  not a policy, it is the absence of one.
- **A quorum option.** Many runs are useful at N-of-M: the harvest can
  close, publish the aggregate as partial-by-policy, and leave the
  stragglers running with their results marked late-arriving. Whether late
  results amend the published aggregate or file separately is decided when
  the policy is written — amending a number someone already acted on is a
  correction event, not a silent update.
- **Cut-off is a lifecycle act.** Enforcing the deadline goes through the
  registry's transition machinery (and, mechanically, through the sibling
  subject subprocess-lifecycle's termination path) — the harvest never
  reaches around the state machine to kill things privately.

## Aggregation: composition is the orchestrator's work

Above accounting sits the actual synthesis: N per-session results into one
run-level product — a merged report, a ranked list, a pass/fail verdict over
the whole. Principles:

- **Aggregate from validated results only,** with the accounting attached to
  the product. A synthesis over 7 of 11 must say so on its face; consumers
  of the aggregate inherit the roster math whether or not they are shown
  it, so show it.
- **Preserve provenance through the merge.** Every claim in the aggregate
  remains traceable to the session that produced it. Fleet outputs feed
  review processes and downstream decisions (often through a human gate —
  see [hitl-approval](../../hitl-approval/hitl-approval.md)), and an
  unattributable claim in a merged report is unverifiable exactly when
  someone finally questions it.
- **Partial failure is a first-class product shape.** The consumers of a
  run — a dashboard, a follow-up dispatch, a person — get a structured
  partial (what exists, what is missing, what is still possible) rather
  than a choice between a false success and an unhelpful total failure.
  Whether the missing fraction is retried rides on the retry discipline of
  [retry-backoff](../../retry-backoff/retry-backoff.md); the harvest's job
  is to make the retryable remainder *enumerable* — which the roster
  accounting has already done.

## Harvest is idempotent and resumable

The orchestrator can crash mid-harvest like it can crash anywhere else.
Ingestion is keyed by session identity and run identity, so re-reading a
drop point is a no-op, not a duplicate; the run's accounting state persists
with the fleet's durable state (see
[durable-fleet-state](durable-fleet-state.md)); and a restarted orchestrator
finishes the harvest from the roster rather than re-deriving it from whatever
outputs it can still find. The roster is the memory of what was promised;
harvest completes against promises, not against discoveries.
