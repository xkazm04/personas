---
subject: software-engineering/error-handling
project: personas
raised_by: intake intake-kube-0903 (peer comparison)
source: librarian/sources/2026-09-03-kube-rs.md
stage: the failure's raise site in src-tauri/src/engine/execution.rs, the `persona_executions` row it becomes, and the two readers that re-derive its class from prose
size: 5 files / ~250 lines / M
status: accepted
---

## Why the scope implies it

`scope.does` names two things this sits between: *"run local AI agent personas over wrapped CLIs"* and *"observe runs — cost, health, traces — and **tune routing from evidence**"*. Every word of the second clause depends on a run's failure being classified correctly, because the classification is what decides whether the run is retried, retried with a longer timeout, scheduled for a provider's reset time, handed to AI healing, or turned into an issue a person reads (`src-tauri\core\src\healing.rs:66-83`). And the classification is currently derived from the *text* of the failure, after the failure has been persisted as text.

**The tree has already measured what that costs, and the measurement is in the source.** `src-tauri\core\src\error_taxonomy.rs:187-206` records it, in a comment above the timeout branch it had to widen:

> `engine/mod.rs:414` mints "Engine safety ceiling exceeded (20m). Execution forcibly terminated." That string contains none of the four patterns above, so the app's own deadline landed in `Unknown` — whose recovery is `CreateIssue` with `suggested_fix: None` and **no retry, ever**.
>
> Measured on the live database: 40 of 43 `Unknown` healing issues (93%) are that one string. The `Timeout` recovery it should have reached succeeded 72.7% of the time — the best rate of any class — while the fallthrough it actually reached succeeded 0 times because it never runs.
>
> The circularity is worth keeping in view: `healing.rs:122` sets `MAX_TIMEOUT_MS = ENGINE_MAX_EXECUTION_SECS * 1000`, so the Timeout recovery doubles a run's timeout up to exactly the ceiling whose message it then could not classify.

That is the whole argument. The app minted its own deadline message at `src-tauri\src\engine\execution.rs:207-210`, knowing exactly what class it was, and the only channel it had to say so was a sentence. The fix that shipped was a fifth substring (`"ceiling exceeded"`). The next string the app mints has the same defect waiting for it, and nothing will fail when it does.

The shape is well understood in this workspace — it is simply not applied here. `db/src/damage.rs` landed today with a section header that states the rule: *"Classification is not string matching. The split is made on SQLite's extended result code, not on the message … No branch here reads the error text, so a SQLite version that rewords a message cannot silently change the policy"* (`:38-45`). `ToolErrorKind` carries a typed class into `tool_execution_audit_log.error_kind` so *"audit rows and the incidents it promotes carry structure instead of prose"* (`engine/src/tool_outcome.rs:32-40`). `AppError::category()` is already a typed match for twenty-odd variants, with only three string passthroughs (`core/src/error.rs:125-135`). The class exists at every raise site. It is thrown away at exactly one place: the database round-trip.

`persona_executions` has an `error_message TEXT` and no category column. So `get_error_category_breakdown` — the query behind the observability surface `scope.does` names — reads every failed row's message back and re-runs the substring ladder in Rust, with the cost written in its own doc comment: *"The classification is intentionally done in Rust at aggregation time — SQL can't run the taxonomy's substring heuristics"* (`db/src/repos/execution/metrics.rs:595-597`). The heuristics are the reason the aggregate cannot be a `GROUP BY`.

The peer does the opposite as a matter of course — retryability is a property of the type, stated once per enum (`C:/t/kube/kube-runtime/src/watcher.rs:21-24`), and the transport's retry set is a `match` on a status code and nothing else (`kube-client/src/client/retry.rs:52-56`). kube's version is weaker than what personas can build here, because kube's is prose with no test. What transfers is only the direction, and the other two Rust projects in the fleet already went that way — which is why this is the one finding in the study with three-way convergence behind it.

## What the first context contains

A **class carried on the row**, minted where the failure is raised, and the two readers that stop deriving it. One column, one enum already written, no new module.

**The column.** `persona_executions.error_category TEXT NULL`, holding an `ErrorCategory`'s existing `snake_case` serde token (`core/src/error_taxonomy.rs:22-24` — the enum already derives `Serialize`, `TS` and `rename_all`, and already crosses to TypeScript, so the wire value, the DB value and the frontend value are one string with no new definition). Nullable, because every row written before this exists has no class and must not be given a fabricated one.

**The mint sites — three, and they are the whole point.** A class is written only where the code *knows* it:
- `src/engine/execution.rs:192-210`, the engine's own safety ceiling → `Timeout`, directly, without a message ever being consulted. This is the site that produced the 93%.
- The runner's process-exit paths, which already distinguish a non-zero exit with no stderr from one with diagnostic output — the distinction `TransientProcessFailure` was added for (`error_taxonomy.rs:42-53`).
- The provider parse path, which already produces `UsageLimitInfo { scope, resets_at }` (`:63-83`) and therefore already knows `RateLimit` vs `SessionLimit` structurally.

Everywhere else the column stays `NULL` and the reader falls back to `classify_error` exactly as today.

**Reader one — healing.** `diagnose` takes a `&FailureCategory` (`core/src/healing.rs:298-305`), so the change is upstream of it: the caller prefers the row's stored class and calls `classify_error` only when it is `NULL`. `diagnose` itself is untouched, and that is the design's best feature — §4.3 of the comparison study found that personas already has the peer's `error_policy` shape and better; only its input is wrong.

**Reader two — the observability aggregate.** `get_error_category_breakdown_with_conn` (`db/src/repos/execution/metrics.rs:611`) gains a `GROUP BY error_category` fast path for rows that have one, and keeps the Rust ladder for the ones that do not. The doc comment's admission stops being true for new rows.

**The guard that keeps it honest.** A test asserting that every `ErrorCategory` variant is minted by at least one non-test site — the same rule `every_declared_point_has_a_live_emit_site` already holds for `MutationPoint` (`src/engine/runner/hooks/mod.rs:27-38`). A category nothing ever writes is a bucket that will silently stay empty while its failures land in `Unknown`, which is this defect in a new costume.

**What it must NOT absorb.** Not `classify_error` — it stays, unchanged, as the fallback for the 2,188-row history and for any failure whose origin genuinely is a foreign string (a provider's stderr). Deleting it would be a migration, and this is not one. Not the TypeScript mirror at `src/lib/errorTaxonomy.ts`, whose parity fixtures keep working because the enum's tokens do not change. Not `AppError`'s shape — §1.1 of the study argues for a per-crate split and this proposal deliberately does not, because the split is a large refactor and this is a column. Not `HealingAction`, `MAX_RETRY_COUNT`, or any recovery policy: the same policy, better input. Not the `Unknown` category, which must survive — a novel failure must still reach it, and a change that eliminates `Unknown` has replaced one lie with another.

## The measurable

**Failures whose class is derived from prose: today all of them, target the three minted sites plus whatever follows.**

**Number one — the 93%.** Replay the `healing_issues` rows on the 2026-08-17 backup, and then measure forward. Today, per the tree's own count, **40 of 43 `Unknown` issues (93%) are the engine ceiling string**. After the ceiling site mints `Timeout` directly, that number is 0 by construction, and the assertion is a test at `src/engine/execution.rs`'s ceiling path — not a query, because a query would be measuring the fix rather than pinning it.

**Number two — the recovery that starts running.** The tree measured `Timeout`'s recovery at **72.7% success, the best rate of any class**, against **0** for the `CreateIssue` fallthrough those rows reach today (which cannot succeed, because it never retries). The number that would move is completed runs recovered from a ceiling timeout: today 0, target the `Timeout` class rate on a comparable population. This is the number that says the direction paid off, and it is measurable within one week of normal use.

**Number three — the aggregate stops being a scan.** `get_error_category_breakdown` currently pulls every failed row's message over a 2×window and classifies each in Rust. After, rows with a class are counted in SQL. The number that would move is rows read per breakdown call; the paired assertion is that the breakdown's *output* is identical for the historical window, or the fast path and the ladder disagree and one of them is wrong.

**Number four, before acceptance.** Run T2 from the comparison study: the count of `AppError::` construction sites (2,105 with `format!` today) and match sites by crate. It does not gate this proposal, but it establishes whether the follow-on split in §1.1 is worth raising later.

## What would make this wrong

**If the class is not knowable at the raise site.** The design assumes the three chosen sites know their class without reading a message, and for the engine ceiling that is certain — it is the app's own timer. For the runner's process-exit paths it is less certain: the distinction between `TransientProcessFailure` and `ApiError` currently depends on whether stderr carried diagnostic content, which is itself a content judgment. If that judgment cannot be made without substrings, then that site should mint nothing and stay on the fallback, and the proposal shrinks to the ceiling plus the usage-limit parser. **That is still worth doing** — it is 93% of the measured cost — but it should be said out loud at acceptance rather than discovered at implementation.

**If a nullable column becomes a fabricated one.** The obvious shortcut is a backfill: run `classify_error` over the 2,188 historical rows and write the result. That would destroy the only honest signal the column has — *this row's class was measured, that row's was guessed* — and would make number three's paired assertion vacuous. If a backfill is proposed during implementation, it is evidence the nullable design was not understood, and the review should stop there.

**If the two classifiers drift.** Two paths now answer "what class is this row" — the column and the ladder — and they will disagree the first time someone edits one. The mitigation is the fallback's narrowness (it runs only when the column is `NULL`) plus number three's paired assertion, but neither is a guarantee. If the disagreement surfaces anywhere other than at a category boundary nobody cares about, the right answer is to make the column mandatory for new rows and treat a `NULL` on a fresh row as a bug, which is a stricter design than this proposal asks for.

**If it changes what the operator sees without warning.** Rows that used to appear as `Unknown` in the Overview's error breakdown will move into `Timeout`. That is the point, but an operator who has learned the shape of their own error histogram will see it change overnight with no explanation. The `CHANGELOG.md` entry has to carry the two numbers — 93% and 72.7% — the way that file's entries already carry their measurements, or the improvement reads as a regression in a chart.

**If `ErrorCategory` is the wrong vocabulary to persist.** It is an *inferred* category, designed for a classifier's output — `Unknown` is one of its variants, which is a strange thing for a raise site to declare. If minting turns out to want a narrower, raise-site-shaped enum (closer to `ToolErrorKind`, which has no `Unknown` at its typed sites), then the column holds that instead and `ErrorCategory` becomes its projection. That is a better design and a slightly larger one; discovering it during implementation is a success, not a failure, and should be allowed to change the column's type before anything is written to it.
