---
layer: application
subject: error-handling
technique: taxonomy-design
stack: rust
---

# Rust application — taxonomy design

How this repo realizes the closed, consumer-driven taxonomy — and where its
own history proves the technique's warnings by measurement.

## The authority: `ErrorCategory`

`src-tauri/core/src/error_taxonomy.rs` opens by declaring itself the single
source of truth, and names the four subsystems whose *independent* heuristics
it retired (`error_taxonomy.rs:1-20`): healing's `FailureCategory`, the
persona slice's `DegradationCategory`, design-drift's regex classification,
and the health-check severity inferrer — the pre-consolidation state was
exactly the "each consumer re-derives" drift the technique forbids.

- **Closed set, eleven variants** (`error_taxonomy.rs:25-57`): `RateLimit`,
  `SessionLimit`, `Timeout`, `ProviderNotFound`, `CredentialError`,
  `Network`, `Validation`, `ToolError`, `ApiError`,
  `TransientProcessFailure`, and an explicit `Unknown` whose doc comment
  ("No known pattern matched") keeps it an honest signal, not a default
  branch.
- **Consumers branch on predicates, not re-inspection.** The three axes are
  literal functions over the category: `is_auto_fixable`
  (`error_taxonomy.rs:336-343`) is the transience axis for the healing
  engine; `is_failover_eligible` (`error_taxonomy.rs:381-389`) guards entry
  to the provider circuit breaker; `is_technical_failure`
  (`error_taxonomy.rs:354-366`) separates infrastructure failures from
  LLM-signal categories so manual-review queues don't fill with runs that
  never produced output. `default_severity` and the legacy `db_category`
  mapping (`error_taxonomy.rs:393-426`) complete the consumer set.
- **Retry-interval extraction is a typed struct.** `UsageLimitInfo`
  (`error_taxonomy.rs:64-82`) carries `scope` (rolling window vs weekly cap)
  and `resets_at`, parsed once and carried on `ExecutionResult` "so healing
  can schedule a retry at the actual reset time instead of blind backoff" —
  the technique's stated-interval-wins rule, verbatim.

## Mirroring across the language boundary

Two mechanisms, one per artifact kind:

- The **vocabulary** is generated: `#[derive(TS)] #[ts(export)]` with
  `serde(rename_all = "snake_case")` (`error_taxonomy.rs:22-24`) emits the
  category type into the frontend bindings, so the tag spelling cannot drift.
- The **classifier ladder** is duplicated by hand in
  `src/lib/errorTaxonomy.ts` and held in sync by `PARITY_FIXTURES` — a
  fixture list kept byte-for-byte identical on both sides
  (`error_taxonomy.rs:766-826`,
  `src/lib/errors/__tests__/errorTaxonomy.parity.test.ts:13`), with both
  ladders required to map every fixture to the same category. This is a
  deviation from the technique's "generated, never hand-maintained" —
  mitigated by a real gate, but the fixtures themselves are a second
  hand-mirrored pair, and a shape added to one ladder without a fixture is
  invisible to the test.
- The category also **crosses the wire as data**: `AppError`'s serializer
  ships `kind`, `category`, `auto_fixable`, and `failover_eligible` over IPC
  (per the doc comment at `error_taxonomy.rs:379-388`) so the frontend can
  branch without re-running any classifier. The TS ladder exists for strings
  that arrive without that envelope — stored execution messages, raw CLI
  output.

## The measured incident: prose classification eating its own failure

`classify_error` (`error_taxonomy.rs:141-323`) is a lowercase-substring
ladder — a concession to its dominant input, raw CLI stderr with no
structure. The comment block at `error_taxonomy.rs:171-193` records what the
golden path predicts for prose classification, measured on the live
database: the engine's own message "Engine safety ceiling exceeded (20m)"
contained none of the timeout patterns, so **the app's own deadline landed
in `Unknown`** — 40 of 43 `Unknown` healing issues (93%) were that one
string, routed to a no-retry recovery, while the `Timeout` recovery it
should have reached succeeded 72.7% of the time, the best rate of any
class. The fix added a pattern (`ceiling exceeded`), but the durable lesson
is the structured-propagation rule: the mint site knew it was a timeout;
the classifier should never have been asked.

Two structural flags keep the worst of this at bay: pre-parsed booleans
(`timed_out`, `session_limit`) take priority over any string match
(`error_taxonomy.rs:141-147`), and the `Unknown` bucket is treated as an
operator-facing work queue — the doc comment ships the SQL to list what
still falls through (`error_taxonomy.rs:128-140`).
