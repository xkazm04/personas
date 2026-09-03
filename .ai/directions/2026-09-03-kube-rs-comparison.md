# personas vs. `kube-rs/kube` — structural peer comparison (Rust craft)

- **Source**: `kube-rs/kube`, clone `C:/t/kube`, pinned `7a4641d4cc2f693b2dee97b9fc15fadb96d7f62e`
- **Design record**: `librarian/sources/2026-09-03-kube-rs.md` (intake run `intake-kube-0903`)
- **Dimension: (a) Rust coding expertise and design patterns, only.** personas is **not** a peer on cluster operations and is excluded by its own text: `scope.does_not` bars *"CI/CD or deployment pipelines for other repositories"* and `scope.does` fixes the product at local-first, one operator per install. Nothing below proposes a cluster capability, and the direction pass records personas as excluded rather than as a candidate.
- **Why this peer, and why the study is worth running anyway**: personas is a ~240k-LOC Rust workspace whose engine is a long-lived loop over spawned CLI processes with an admission queue, a healing/retry layer, a boot recovery sweep and a hook surface. `kube-runtime` is a long-lived loop over a watch stream with an admission queue, a retry layer, a readiness barrier and an extension surface. The domains share nothing; the **craft questions are identical**, and personas is the fleet's instructive counter-case on exactly one of them (error classification) while being ahead of the peer on several others.
- **Verdicts** come from the closed set `adopt` / `adapt` / `keep ours` / `different forces`. Every one carries its reason.

**Verdict tally: 33 points — 6 `adopt`, 7 `adapt`, 16 `keep ours`, 4 `different forces`.**

**Headline: the design record's Study-4 seeds are right about the diagnosis and wrong about four particulars, all corrected below.** `ToolErrorKind` is *not* cleanly typed — its `classify_app_error` falls back to string-sniffing for the three catch-all variants that carry most of the traffic (§1.4). The queue is not a plain depth-capped `VecDeque` — it carries a reject-by-class shed policy with displacement, which is stronger than anything kube has (§2.5). personas' lint posture is not a gap but the better of the two trees', because it carries measured baselines and a ratchet (§8.1). And the string-classification finding has a much sharper form than the seed gave it: **the tree already carries its own measured proof that the anti-pattern cost it 93% of one error class** (§1.3).

---

## 1. Error design

**1.1 — One enum per subsystem vs. one enum per workspace.**
kube: five error enums, each scoped to the layer that raises it — `watcher::Error` (`C:/t/kube/kube-runtime/src/watcher.rs:21-48`), `controller::Error` (`kube-runtime/src/controller/mod.rs:62-83`), `finalizer::Error` (`kube-runtime/src/finalizer.rs:14-54`), `runner::Error` (`kube-runtime/src/controller/runner.rs:14-18`), `kube_client::Error`.
personas: one `AppError` for the whole workspace — *"App-wide error type. Every fallible function returns `Result<T, AppError>`"* (`C:\Users\kazda\kiro\personas\src-tauri\core\src\error.rs:5-9`), ~25 variants, referenced **4,395 times** across four crates (74 in `core`, 1,061 in `db`, 372 in `engine`, 2,888 in the desktop crate).
**Verdict: `adopt`.** Every caller matches on variants that cannot occur at its layer, and — the sharper cost — `AppError` is `personas-core`'s type, so `db` and `engine` both depend on the bottom crate for their *failures*, which is the one direction the crate-split doctrine (`core/src/lib.rs:10-13`) otherwise forbids. The first move is not five enums; it is a `DbError` and an `EngineError` with `From` into `AppError` at the IPC boundary, which is where a flat, serializable shape genuinely is required.

**1.2 — `#[source]` on every variant vs. a `format!` at the raise site.**
kube: `#[source]` on every non-leaf variant of every enum (`watcher.rs:23,27,31,35`; `controller/mod.rs:74,79,83`; `finalizer.rs:28,32,36,40`), so the chain is the taxonomy and a consumer walks to the root cause without parsing text.
personas: `#[from]` on four variants — `Database` (`core/src/error.rs:11`), `Pool` (`:14`), `Io` (`:23`), `Serde` (`:26`) — and `String` payloads on the rest, with **2,105 construction sites across the four crates using `format!`**.
**Verdict: `adapt`.** The four `#[from]`s are the right ones and the pattern exists; what is missing is that the message-carrying variants have nowhere to put the cause they interpolate. The narrower fix that pays for itself first is not source chains everywhere — it is retiring the three catch-alls in §1.4 that make the sniffing necessary.

**1.3 — Retryability as a property of the type, or of the message.**
kube: stated once, in prose, per enum — *"These are all considered retryable from a watcher's point of view"* (`watcher.rs:21-24`). No predicate, no test.
personas: reconstructed downstream from strings. `classify_error(error: &str, timed_out: bool, session_limit: bool)` (`core/src/error_taxonomy.rs:141`) lowercases the message and runs forty-odd `contains(…)` branches — `"rate limit"`, `"429"`, `"etimedout"`, `"enoent"`, `"credit balance"`, `"reset by peer"` (`:152-241`) — and the file calls itself *"the **single source of truth** for error classification"* (`:3-6`) with a TypeScript mirror.
**Verdict: `adopt` — and the tree has already measured what this costs, which is the strongest evidence either study produced.** The comment at `error_taxonomy.rs:187-206` records it: `engine/mod.rs:414` mints *"Engine safety ceiling exceeded (20m). Execution forcibly terminated."* — the app's **own deadline**, whose string matched none of the timeout patterns, so it landed in `Unknown`, *"whose recovery is `CreateIssue` with `suggested_fix: None` and **no retry, ever**."* Measured on the live database: **40 of 43 `Unknown` healing issues (93%) are that one string**, while the `Timeout` recovery it should have reached *"succeeded 72.7% of the time — the best rate of any class"*. The fix landed as a fifth substring. The next string the app mints has the same defect waiting for it. kube's posture is only marginally better in kind, but the direction it points is right and both other Rust fleet projects already went that way.

**1.4 — The typed exception, and where it stops being typed.**
kube: `RetryPolicy` branches on `StatusCode` — 429/503/504 and nothing else (`kube-client/src/client/retry.rs:52-56`).
personas: `ToolErrorKind` is genuinely typed, with a stable machine token per class stored in `tool_execution_audit_log.error_kind` (`engine/src/tool_outcome.rs:38-82`), and `classify_http_status` is closed and typed exactly as kube's is — 401/403 terminal auth, 429 and 5xx retryable, other 4xx terminal (`:138-146`). **But** `classify_app_error` (`:107-128`) is typed for most variants and then routes `Execution | Internal | External` — the three free-form catch-alls that carry most engine traffic — into `classify_message`, which lowercases and sniffs (`:149-190`).
**Verdict: `keep ours` on the shape, `adopt` on the boundary — correcting the seed.** The design record read this as "the right pattern already exists in the tree; the migration target is make `AppError` look like `ToolErrorKind`". Half true: the *enum* is the model, but `classify_app_error`'s own fallback shows why copying the enum is not enough. As long as three variants can hold anything, a typed classifier still ends in a string matcher. The migration target is the catch-alls, not the enum.

**1.5 — Classification by result code, never by prose — which personas already does, better than kube.**
kube: the status code, in a `match`.
personas: `db/src/damage.rs` splits corruption into derived (detach) and canonical (quarantine) on SQLite's **extended result code**, with a section header saying so — *"Classification is not string matching … `SQLITE_CORRUPT_VTAB` (267) is raised when a virtual table reports its own backing store is malformed … No branch here reads the error text, so a SQLite version that rewords a message cannot silently change the policy"* (`:38-45`).
**Verdict: `keep ours` — inverse list, and it is the in-tree proof that §1.3 is achievable here.** This module landed today. It is the same author, the same workspace and the same week as the 40-substring classifier, and it makes the opposite choice with the reason written out. Nothing about §1.3 needs inventing.

**1.6 — A provider-stated delay, richer than a header.**
kube: `Retry-After` honoured over the computed delay when `server_aware` (`kube-client/src/client/retry.rs:63,80-88`) — one number, one meaning.
personas: `UsageLimitInfo { scope: UsageLimitScope, resets_at }` (`core/src/error_taxonomy.rs:63-83`) distinguishes a **rolling window** that *"resets on its own — eligible for a scheduled retry at the reset time"* from a **weekly cap** that is *"too far out to auto-retry"*, and the two get different actions: `HealingAction::RetryAt { retry_at }` is *"persisted to `scheduled_retries` and survives app restarts"* (`core/src/healing.rs:73-80`), while the weekly case creates an issue.
**Verdict: `keep ours` — inverse list.** A durable absolute-time retry that survives a process restart is a strictly stronger answer than kube's in-memory sleep, and the window/weekly split is a distinction kube's single header cannot express.

**1.7 — A denial is not an error.**
kube: no equivalent statement. A policy-shaped refusal and a bug both arrive as `Err`.
personas: stated as a design rule in the hook surface — *"A policy denial is `Decision::Refuse`, never a returned `Err`: veto-by-error makes a denial and a contributor bug indistinguishable at every consumer downstream, so the host cannot record one as a refusal or apply the fail-open rule to the other"* (`src/engine/runner/hooks/mod.rs:18-24`).
**Verdict: `keep ours` — inverse list.** This is the sentence `is_terminal_for_job`-style classification is *for*, generalised, and stated better than any anchor in the peer tree.

**1.8 — The framework's error generic over the caller's error.**
kube: `Error<ReconcilerErr, QueueErr>` (`controller/mod.rs:62-83`) — the caller's typed error survives the runtime — with `finalizer.rs:16-20` warning that this deliberately makes `anyhow` awkward.
personas: every Tauri command returns `AppError`, so a callee's taxonomy is flattened at the first boundary it crosses.
**Verdict: `adapt`, narrowly.** kube's force is external implementors; personas' callers are all in-tree, and the IPC boundary genuinely does need one serializable shape for the frontend. The transferable half is not the type parameter — it is that the flattening should happen **at the IPC boundary only**, not at every internal call, which is §1.1 restated with the reason.

**1.9 — An error boundary that keeps the failed item's identity.**
kube: `DeserializeGuard<K>(pub Result<K, InvalidObject>)` buffers into `serde_value::Value`, tries `K`, and on failure re-parses **only `metadata`** so the broken object still implements `Resource` — it has a name, a namespace, and can be logged, evented or reconciled (`kube-core/src/error_boundary.rs:12-59`; the `meta()` fallback at `:81-84`; the test named after the failure at `:97-110`). One malformed row cannot poison a list.
personas: absent. `engine/src/safe_json.rs` bounds allocation, not malformed input; there is no `deny_unknown_fields` posture, no salvage helper, and no partial-parse type. A malformed item in a provider list response or an MCP tool result fails the whole parse.
**Verdict: `adopt`.** personas is the fleet project with the most external parsers — NDJSON provider streams, MCP results, connector payloads — and the least tolerance machinery.

---

## 2. The work queue

**2.1 — What a duplicate is.**
kube: the system decides, and the decision is structural: `ReconcileRequest`'s reason is excluded from `Hash`/`PartialEq` (`controller/mod.rs:298-302`), so an object occupies exactly one slot however many triggers fired.
personas: nothing decides. `QueueTracker::admit` (`engine/src/queue.rs:261-337`) inserts by priority without consulting the queue for an equal entry; the only dedup is incidental — `running` is a `HashSet<String>` per persona (`:231-241`), so the same *execution id* cannot be registered twice, but two executions of the same persona and the same trigger are two ids and two slots.
**Verdict: `adopt`, narrowly.** This is the personas proposal (`2026-09-03-admission-key-exclusion.md`). Narrowly, because personas' unit is a *command with an author* far more often than a *convergence toward declared state*, and a user who presses run twice may genuinely mean it — which is why the key must be the trigger, not the persona.

**2.2 — Earliest-wins on re-schedule.**
kube: re-scheduling a key already queued mutates the existing entry to the earlier time rather than enqueueing a copy (`kube-runtime/src/scheduler.rs:76-112`), with the priority rule stated — a user-triggered request should beat the reconciler's own retry.
personas: no delayed requeue at all; there is nothing to pull forward. A failed run is re-admitted by the healing layer at a time that layer chooses (`core/src/healing.rs:66-83`), not by the queue.
**Verdict: `different forces`.** The queue's job here is admission, not scheduling; the schedule lives in `scheduled_retries` and in the trigger layer. Recorded so a future queue-side delay does not reinvent it in the wrong module.

**2.3 — In-flight exclusion, at which granularity.**
kube: per **key**. A message whose equal is executing is parked in `pending` (`scheduler.rs:114-139`; `controller/runner.rs:20-25`), with the guarantee stated in the builder doc — *"despite concurrency, a controller never schedules concurrent reconciles on the same object"* (`controller/mod.rs:605-617`).
personas: per **execution id**, which is a tautology, and per **persona** via `max_concurrent` (`queue.rs:222-229`). Two executions of one persona from one trigger run concurrently whenever `max_concurrent > 1`.
**Verdict: `adapt`.** Per-persona concurrency is a resource limit (a persona that spawns two CLI processes at once costs twice), not an exclusion. Whether the exclusion matters depends on whether two runs of one persona+trigger can write the same rows — a question the tests in §Tests answer.

**2.4 — The global cap.**
kube: one number, `max_concurrent_executions: u16`, `0` = unbounded (`controller/runner.rs:36,44-57`).
personas: two, and both are load-bearing — `GLOBAL_MAX_CONCURRENT = 4` (`queue.rs:10`) because the machine has a finite number of CLI processes it can host, and a per-persona `max_concurrent` snapshot carried on each queued entry *"to check per-persona capacity without a DB lookup"* (`:44-47`).
**Verdict: `keep ours`.** kube's one cap suffices because per-key exclusion already spreads the work; personas' second number is the resource limit kube does not have (kube's reconciles do not spawn processes).

**2.5 — The shed policy, which the seed missed entirely.**
kube: no admission shedding. The scheduler's queue is unbounded and coalescing; overload manifests as latency, never as refusal.
personas: `admit` refuses by **class**, with displacement, and the reasoning is written out — *"Depth alone cannot decide this: a queue that carries priority levels but consults them only when choosing an insertion point has a refuse-newest shed policy regardless of what the levels say, because the gate that refuses never sees the class. Reject-by-class needs the class evaluated BEFORE the depth verdict, and it needs a displacement rule -- the comparison alone is the easy half"* (`queue.rs:294-302`). At depth the weakest entry is evicted only by a strictly higher-priority arrival, and the victim choice is argued on both counts (`:303-315`).
**Verdict: `keep ours` — inverse list, and a correction.** The design record described this as *"in-memory per-persona `VecDeque` with priority, depth cap 10"*. It is an admission-queue with a class-aware shed policy, and kube has no equivalent because it never refuses.

**2.6 — Admission held by a quota the work would immediately violate.**
kube: a 429 is a *retry* concern, handled after the request has been sent (`retry.rs:52-56`).
personas: a quota cooldown is an **admission** concern, checked before a slot is granted — *"When a session/usage/rate limit was recently hit, `quota_available()` is false → fall through to enqueue so the work WAITS rather than running straight into the limit and failing"* (`queue.rs:266-286`; `set_quota_cooldown` at `:182-189`), and `drain_next` re-checks it (`:373-378`).
**Verdict: `keep ours` — inverse list.** Refusing admission is strictly cheaper than retrying, and this is the shape kube's client-side retry cannot express because it has no admission stage.

**2.7 — Durable vs. in-memory.**
kube: everything in memory; a restart is repaired by a full relist, safe only because the apiserver republishes.
personas: the queue is in memory (`HashMap<String, VecDeque>`, `queue.rs:85`) — and the durability answer was moved to the store today. `db/src/repos/execution/restart_recovery.rs` classifies rows the app died mid-run on into three classes (`:26-33`), and `ResumePending` becomes `queued` *"the durable-queue re-admission path already drains `queued` rows"*.
**Verdict: `keep ours`.** The split is right: an in-memory admission queue plus a durable row is the correct decomposition for a desktop app whose work is expensive and whose process is quit several times a day.

---

## 3. Backoff

**3.1 — Backoff as a stream adapter.**
kube: one composable adapter — `StreamBackoff<S, B>` pauses a stream after any `Err`, resets `B` on any `Ok`, and **closes the stream** when the policy gives up (`kube-runtime/src/utils/stream_backoff.rs:9-42`).
personas: no stream adapters; retry is a per-decision `HealingAction` (`core/src/healing.rs:66-83`) plus per-call ladders.
**Verdict: `different forces`.** kube's unit is a long-lived stream that must survive an apiserver restart; personas' unit is a bounded run of a spawned process. A stream adapter has nothing here to wrap. Recorded so the decision is inherited.

**3.2 — Reset after sustained health, not after the first attempt.**
kube: `ResetTimerBackoff` resets the inner policy only once `reset_duration` has elapsed since the last backoff (`kube-runtime/src/utils/backoff_reset_timer.rs:34-49`), with the default watcher strategy at 800 ms → 30 s and a 120-second reset window (`watcher.rs:979-987`) — so a stream that fails every 30 minutes does not restart at rung 0 each time.
personas: the same rule, applied to restarts rather than to a stream, and stated more sharply — the `restart_count` mark *"survives the re-admission. It is cleared in `executions::exec_status_update` when a run reaches `completed` — never when a resume begins. Clearing at resume time is the mistake that costs the whole mechanism: it makes every crash the first crash, so the escalation below can never fire"* (`db/src/repos/execution/restart_recovery.rs:44-49`), with `MAX_CONSECUTIVE_RESTARTS = 3` carrying its predicate (`:67-72`).
**Verdict: `keep ours` — inverse list.** Same rule, arrived at independently, and personas names the failure mode kube's doc only implies.

**3.3 — The closed retryable set.**
kube: 429/503/504 in the policy's own `match` (`retry.rs:52-56`).
personas: `classify_http_status` (`engine/src/tool_outcome.rs:138-146`) — 401/403 auth and terminal, 429 retryable, 5xx retryable, every other 4xx terminal — closed, typed, and with the reason on each arm.
**Verdict: `keep ours`.** At the one place personas classifies from a code rather than a message, it matches kube exactly and is slightly broader in the right direction (401/403 as a *distinct terminal class* rather than as "not in the set").

**3.4 — Where the ladder is applied.**
kube: at the transport layer, beneath every API call, enabled by default in 4.0.0 — so no call site decides.
personas: at the decision layer. `diagnose` returns a `HealingAction` and the caller applies it, with the durable variant (`RetryAt`) going through `scheduled_retries` and the in-memory ones not.
**Verdict: `adapt`.** kube's placement means a new call site inherits the policy; personas' means a new call site must remember. The transferable half is not the tower stack — it is that the *default* should be the policy, and opting out should be the explicit act.

---

## 4. The converge loop

**4.1 — Told *that*, never *why*.**
kube: the reason is carried for tracing and excluded from equality, and the doc states the consequence — *"This mapping mechanism ultimately hides the reason for the reconciliation request, and forces you to write an idempotent reconciler"* (`controller/mod.rs:631-634`).
personas: the run's provenance is load-bearing throughout — `retry_reason_for` picks a `scheduled_retries` reason tag which *"in turn drives the drain path's resume-vs-fresh decision"* (`core/src/healing.rs:88-93`).
**Verdict: `different forces`.** kube erases the reason because a lost event must not mean a lost branch. personas' triggers are not lossy observations of declared state; they are commands with authors, and a resume genuinely is a different act from a fresh run. Erasing the reason here would delete information, not hide it.

**4.2 — Idempotence, and the honesty of declaring its absence.**
kube: idempotence forced structurally, by erasing the reason.
personas: refused explicitly where it does not hold — *"The continuation is **single-use per frame**. Calling it twice would re-run the call beneath it, and a credential-relayed API request is not idempotent — the second call is a second write, a second charge. A second invocation is a contract violation naming the frame, never a retry"* (`src/engine/runner/hooks/mod.rs:52-56`).
**Verdict: `keep ours`.** A system that cannot be idempotent and says so, enforcing it in the type, is better than one that claims it. kube's own finalizer makes the same admission in the other direction (`finalizer.rs:75-120` assumes both branches tolerate re-execution); personas states the boundary at the point of the non-idempotent act.

**4.3 — The requeue policy as a function separate from the work.**
kube: `error_policy` is a **parameter** of `applier` (`controller/mod.rs:401`), receives the reconciler's *typed* error, and returns an `Action` (`:466-479`).
personas: the structure already exists and is richer — `diagnose` → `HealingDiagnosis { category, action, … }` (`core/src/healing.rs:85-96`) is exactly kube's `error_policy`, with five actions instead of two and a durable one among them.
**Verdict: `keep ours` on the structure — and this is the framing that matters for §1.3.** personas has kube's error policy. What it feeds that policy is prose. The defect is entirely in the input, not in the design, which is why the proposal is a classification change and not a restructuring.

**4.4 — What a boot sweep declares.**
kube: nothing to declare — a restarted controller relists.
personas: classification rather than declaration, with the prescription quoted from the repo's own golden path — *"At boot, do not declare — classify"* — and the cost of the old behaviour measured: *"`recover_stale_executions` marked every `running` row `failed` with 'App restarted while execution was running' — a failure nobody observed … **74 of 2,188 executions** on the 2026-08-17 backup carry that marker"* (`db/src/repos/execution/restart_recovery.rs:1-11`).
**Verdict: `keep ours` — inverse list.** Different force (kube has a server to ask), and personas' answer is the stronger artifact: three classes, a second counter keyed on the interruption rather than on a failure identity (`:14-24`), and an escalation that terminates a run which kills the app on every resume.

**4.5 — Distinguishing a quit from a crash.**
kube: not applicable.
personas: `core/src/shutdown_marker.rs` — a graceful stop writes a marker, a start that finds one skips the sweep and deletes it, and the fail direction is derived from what the wrong direction costs: *"A marker we cannot read or delete is reported absent, so the classification sweep runs"* (`:20-25`).
**Verdict: `keep ours` — inverse list.** The nearest thing in kube is the applier's shutdown oneshot (`controller/mod.rs:416-441`), which distinguishes nothing because nothing durable is at stake.

**4.6 — Graceful drain.**
kube: the queue terminating fires a oneshot that shuts the scheduler down and lets in-flight reconciles complete, with a debug line per stage (`controller/mod.rs:416-441`).
personas: the drain is the marker plus the classification sweep (§4.4, §4.5) rather than an in-process wait; a quit does not wait for a running CLI process to finish, it records that it was running.
**Verdict: `adapt`.** For a desktop app that is force-quit, recording beats waiting. What kube has and personas does not is the *ordered* stage log — the drain leaves no trace of which subsystem stopped when, which is the thing an operator wants when a quit hangs.

---

## 5. Typestate and marker traits

**5.1 — Making the illegal call unrepresentable.**
kube: private marker traits `ClusterScope` / `NamespaceScope`, so a namespaced call on a cluster-scoped type is a **compile error, not a 404** (`kube-client/src/client/client_ext.rs:15-25`).
personas: `SessionState::transition_to` (`src/engine/process_session.rs:60-82`) checks terminality and `can_transition_to` at **runtime** and returns `Result<Self, String>` — an illegal transition compiles, and its refusal is a formatted sentence.
**Verdict: `adapt`.** Full typestate across five process domains (design analysis, lab runs, n8n transforms, test runs, executions) is expensive and would cross to TypeScript through `ts-rs`, which is why `restart_recovery.rs:34-42` explicitly declined to widen `ExecutionState` for a related reason. The cheap half is the error: a `TransitionError { from, to, entity }` instead of a `String` makes the refusal matchable, and is one struct.

**5.2 — A closed vocabulary with a compile-time completeness check.**
kube: `unstable-runtime` fans out to three separately-named sub-gates so an unstable surface can be stabilised one surface at a time — but a feature gate is declaration-only; nothing proves a gated surface is reachable.
personas: `ObservationPoint` / `MutationPoint` admit no name before a live emit site exists, and the rule is held mechanically — *"`registry::pairing_sources` plus the test `every_declared_point_has_a_live_emit_site` hold that mechanically: every variant must be named at a real dispatch site … Adding a variant without its emitter turns the build red"* — with the failure it prevents named: *"a declared-but-never-fired point is the worst kind of defect: registration succeeds, the contribution reports itself installed, and it does nothing"* (`src/engine/runner/hooks/mod.rs:27-38`). Registration for an unhandled point is **refused, not stored** (`:39-42`), and deliberate non-fires are written down with reasons at `registry::NON_FIRE` (`:57-64`).
**Verdict: `keep ours` — inverse list.** kube has nothing like it. And the rule has a live counter-example one crate away: `PromptDelivery::PositionalArg` and `::Flag` (`engine/src/provider/mod.rs:18-24`) are exactly the declared-but-never-fired variants that test exists to prevent, carrying `#[allow(dead_code)] // pending: Codex provider currently uses Stdin; PositionalArg lands ahead of consumer`. The hook registry's rule is the tree's own answer to its own defect; it is simply not applied outside `hooks/`.

---

## 6. Generic over typed and dynamic

**6.1 — One API serving compile-time-known and runtime-discovered types.**
kube: `trait Resource { type DynamicType; }` — static types set `DynamicType = ()` and pay nothing, runtime types carry `ApiResource`, and one `Api<K>` serves both, so the dynamic path is not a parallel API with its own bugs (`kube-core/src/resource.rs:27-40`).
personas: `CliProvider` (`engine/src/provider/mod.rs:45-70`) abstracts over CLI-based agents — binary location, argument construction, NDJSON parsing, env configuration — with **one implementation** (`provider/claude.rs`) and a `PromptDelivery` enum two-thirds of which is unreachable (§5.2).
**Verdict: `adapt`.** The trait is the right shape and the second implementation is a named intention rather than a fantasy. What is wrong is the same thing §5.2 names: the un-exercised variants are carried by an `#[allow(dead_code)]` and a comment instead of by a test that would go red when the second provider lands without them. kube's discipline here is `DynamicResourceScope` opting out of a check at exactly one line, visibly.

**6.2 — The runtime-typed edge that personas actually has.**
kube: the dynamic edge is a Kubernetes CRD discovered at runtime.
personas: the dynamic edge is TypeScript. `ErrorCategory`, `ErrorSeverity` and `ToolErrorKind` all carry `#[derive(TS)] #[ts(export)] #[serde(rename_all = "snake_case")]` (`core/src/error_taxonomy.rs:22-24`; `engine/src/tool_outcome.rs:37-40`), so one Rust type serves a compile-time-typed Rust caller and a runtime-typed frontend, and `ToolErrorKind::as_str` is documented as the DB column value too (`:68-70`) — one type, three consumers, no parallel definition.
**Verdict: `keep ours`.** This is kube's `DynamicType` force answered for the boundary personas actually has, and it is the reason §1.3's fix is cheaper than it looks: the typed classification would cross to TS for free, the way the categories already do.

---

## 7. The test-power ladder

**7.1 — The ladder written as MUST / MUST NOT with a stated default.**
kube: four classes with prohibitions — *"Unit tests MUST NOT try to contact a Kubernetes cluster"*, *"Doc tests MUST be marked as `no_run` when they need to contact a cluster"*, *"E2E tests MUST NOT be used where an integration test is sufficient"* — closing on **"use the least powerful method of testing available to you"**, then a per-crate assignment (`C:/t/kube/CONTRIBUTING.md:96-110`).
personas: the tiers exist as five separate vitest configurations (`vitest.config.ts`, `.integration`, `.e2e`, `.cli`, `.evals`) plus 5,064 Rust test functions, and the prohibitions are stated nowhere. `CLAUDE.md` mentions tests only as a context *category*.
**Verdict: `adopt`.** Twelve lines. The per-crate assignment is the half that matters most here, because the crate split (`core` → `db` → `engine` → desktop) already gives it an obvious shape and nothing currently says which tier a new case belongs in.

**7.2 — `#[ignore]` for live dependencies.**
kube: 33 sites, each with a reason string — `"needs kubeconfig"`, `"needs cluster (creates + patches foo crd)"`, `"shells out to echo/sh; skipped on windows"` (`kube/src/lib.rs:253,272`; `kube-client/src/client/auth/mod.rs:717`) — so the default `cargo test` is hermetic.
personas: **two** real sites (`engine/src/scraper.rs:966` `= "network"`), against 5,064 test functions. The rest of the `#[ignore]` hits in the tree are string *literals* inside a skip-marker detector (`engine/src/app_master.rs:552-580`), which scans a codebase for `#[ignore]`, `.skip(`, `xdescribe(` as a quality signal.
**Verdict: `keep ours` on the detector — inverse list — and `adopt` the convention where it applies.** personas' Rust suite is hermetic mostly by construction rather than by convention, which is fine until the first live-dependency test lands; and the detector is a technique kube does not have. The gap is that nothing stops a live test being written without the marker the detector looks for.

**7.3 — A test named after the failure it prevents.**
kube: `should_parse_meta_of_invalid_objects` (`kube-core/src/error_boundary.rs:97`).
personas: `rate_limited_is_retryable_auth_is_not` (`engine/src/tool_outcome.rs:228`), `validation_is_misconfigured_not_retryable` (`:238`), `every_declared_point_has_a_live_emit_site` (`src/engine/runner/hooks/`).
**Verdict: `keep ours`.** Same convention, and personas' names carry the *rule* rather than the mechanism, which is the stronger form.

---

## 8. Lint discipline

**8.1 — The posture, and whether it carries a measurement.**
kube: `#![deny(clippy::all)]` and `#![deny(clippy::pedantic)]` at the top of the runtime crate (`kube-runtime/src/lib.rs:12-13`), so the level travels with the source.
personas: `[workspace.lints.clippy]` in `src-tauri/Cargo.toml` with `dbg_macro = "deny"` and `todo = "deny"` justified by a **measured zero** (*"Zero occurrences of `dbg!`, `todo!` and `unimplemented!` in 963 .rs files, so these cost nothing today and stop the first one from landing"*), `await_holding_lock = "warn"` with a correction of a grep heuristic that had over-counted it 23 to 0, and an explicit **RATCHET** block listing the lints that are off with their production/all-targets counts (`clone_on_ref_ptr` 275/280, `unwrap_used` 94/94, `expect_used` 78/87, `inefficient_to_string` 63/100) and the rule that each is enabled when its count reaches zero.
**Verdict: `keep ours` — inverse list, and a correction to the expected direction.** kube's exemptions carry reasons; personas' carry reasons *and* numbers *and* a plan. A ratchet with counts is the stronger artifact, and it is the one the corpus should carry.

**8.2 — The configuration file as a decision record.**
kube: `clippy.toml` exists and is short.
personas: `src-tauri/clippy.toml` documents that *"an unrecognised key in clippy.toml is not a warning, it is a hard error that fails every single crate in the workspace"* and that every key was verified by feeding clippy a bogus key and reading back its "expected one of" list; then it writes out the full argument-count distribution behind `too-many-arguments-threshold` (159 attributes, median 10, worst 22, and the fraction still over the line at each candidate threshold) and concludes *"Raising the threshold does not fix a single function; it only makes some of those 159 attributes deletable while the signature stays exactly as wide as it was."*
**Verdict: `keep ours` — inverse list.** This is the best small example of "the checker is the contract" in either tree.

**8.3 — Justified exemptions, per allow.**
kube: seven `#![allow(…)]` lines, each with its reason on the line above (`kube-runtime/src/lib.rs:14-22`).
personas: **552 `#[allow]` sites** across the four crates. The four crate-level blocks each carry a reason paragraph and a boundary — `core/src/lib.rs:25-33` explains that the allowed lints are artifacts of a `git mv` and closes with *"Do NOT extend this list for newly written code"* — but the ~159 per-function `too_many_arguments` and the 23 `type_complexity` attributes carry no reason each.
**Verdict: `adapt`.** The block-level rationale is better than kube's and stays. The per-site half is kube's and is worth adopting selectively: not 552 comments, but a reason on any allow that is not one of the two counted classes, since those two are already accounted for in `clippy.toml`.

---

## 9. Module composition

**9.1 — À la carte components, and why the boundary exists.**
kube: *"all components are designed to be usable á la carte if your operator doesn't quite fit that mold"* (`kube-runtime/src/lib.rs:7-9`), delivered by making every layer a `Stream`. The reason is a *consumer* requirement — operators assemble their own pipelines.
personas: the boundary is stated with the number that forced it — *"`app_lib` was a single 431k-LOC crate. One crate is one `rustc` process, so a test build peaked at **8.9 GB in a single process** … No `-j` flag helps: there is nothing to parallelize inside one crate"* — followed by the invariant: *"The rule for this crate: it may not depend on any other Personas crate. It is the bottom of the graph"* and the extraction technique that keeps each step revertible (`core/src/lib.rs:1-23`).
**Verdict: `keep ours` — inverse list.** Same discipline, different force (build economics rather than consumer assembly), and personas' is the rarer artifact: a module boundary whose justification is a measured number and whose violation condition is stated in one sentence.

**9.2 — Two extension surfaces, separated by signature.**
kube: `reflector()` observes the watch stream and passes it through unmodified (`kube-runtime/src/reflector/mod.rs:18-30`) while `watcher()` produces it — the observe/transform split exists but is a convention of the module layout, not of any signature.
personas: the split is the signature. *"`Observer` **reports.** `Observer::observe` returns `()` by signature, so 'did this observer change anything?' is not a question a reader can ask … an observer cannot refuse a call, cannot rewrite an argument, cannot delay a decision, and therefore needs no ordering guarantee against the runner's own gates. `Interceptor` **changes.** It declares — via `Interceptor::wraps` — exactly one `MutationPoint` out of a closed vocabulary"*, closing on *"A reviewer reading a contribution's registrations knows its blast radius without reading its handlers. That is the whole point of there being two"* (`src/engine/runner/hooks/mod.rs:9-25`).
**Verdict: `keep ours` — inverse list.** kube's version of this is implicit; personas' is enforced by return types and by a closed enum.

**9.3 — Rewrite runs before the gate, structurally.**
kube: the client is a `ServiceBuilder` stack — `base_uri_layer` → `auth_layer` → `BufferLayer` → `RetryLayer` (`kube-client/src/client/retry.rs:20-27`) — so ordering is composition, not convention.
personas: *"the frames run **outside** the policy path: SSRF validation and `scope_enforcement::evaluate` execute *inside* the `Continuation` a frame calls, so the gate necessarily evaluates the effective value and never a value that will not run. That is structural, not a comment — a frame cannot reach the gate except through the continuation"* (`hooks/mod.rs:44-50`).
**Verdict: `keep ours`.** Both trees make ordering structural. personas' is the harder case, because the thing being ordered is third-party code rather than the crate's own layers.

---

## 10. Repository maintenance

**10.1 — A changelog that carries rationale.**
kube: `CHANGELOG.md` is 16,411 words, generated from releases, with its convention stated in the file's own header — *"NOTICE this is mostly generated from releases - ONLY ADD NEWS here now"* (`C:/t/kube/CHANGELOG.md:1-5`) — and the 4.0.0 entry argues for the CEL crate, the retry default and the timeout removal rather than listing PRs.
personas: Keep-a-Changelog with a stated pre-1.0 breaking-change policy (`CHANGELOG.md:1-7`), and entries that carry **the measurement that justified the change** — a token rollup corrected from a median 2.22× to 1.00× against the transcript's own final cost record across 45 transcripts; a board virtualization taking DOM nodes from 100 to 41 at 50/100/200/400 sessions with main-thread blocked share from 10.18% to 6.36% and p95 frame from 133.5 ms to 100 ms.
**Verdict: `keep ours` — inverse list.** kube's entries carry links; personas' carry numbers and the ground truth they were checked against.

**10.2 — Release tooling.**
kube: `release.toml` (cargo-release) plus a dedicated `release.yml` among twelve workflows, and an MSRV badge regenerated by the `justfile` (`justfile:114`).
personas: `lefthook.yml` for pre-push, `renovate.json` for dependencies, four `tauri.*.conf.json` build profiles — but no single command that cuts a release, and the version lives in several files.
**Verdict: `adapt`.** kube's `cargo-release` does not port to a Tauri desktop app with a signed installer. The transferable half is that **one file owns the version and one command bumps it** — the failure mode without it is a `CHANGELOG.md` heading that disagrees with `tauri.conf.json`, which no test currently catches.

---

## Tests to initiate

Paired, with the instrument and the number that would move.

**T1 — What does structural classification recover?** (§1.3)
Replay every `healing_issues` row on the 2026-08-17 backup through a `classify` that reads a typed kind from the error rather than its message. *Instrument*: the category histogram, and the per-category recovery success rate the tree already computes. *Numbers that would move*: (a) rows in `Unknown` whose message is *"Engine safety ceiling exceeded (20m)"* — **today 40 of 43 `Unknown` rows (93%)**, target 0; (b) the recovery success rate on those rows once they reach `Timeout` — the tree's own measured `Timeout` rate is **72.7%**, against **0** for the fallthrough they reach today, because `CreateIssue` with `suggested_fix: None` never retries. *Paired arm*: no row that is genuinely `Unknown` may be reclassified — assert that a fabricated novel error string still lands in `Unknown`, or the typing has become a catch-all in a new costume.

**T2 — How far does one error type travel?** (§1.1, §1.8)
Count `AppError::` construction and match sites by crate, and the subset where the constructing crate is not the matching crate. *Instrument*: a script over `core/src`, `db/src`, `engine/src`, `src`. *Starting numbers, taken today*: 4,395 `AppError::` references (74 / 1,061 / 372 / 2,888) and **2,105 sites constructing one with `format!`**. *Number that would move*: variants matched outside their originating crate — predicted high, and it is the number that decides whether §1.1 is a real split or a cosmetic one. This is a measurement, not a change, and should run before either proposal is accepted.

**T3 — Does one bad item cost the batch?** (§1.9)
Feed a provider list response and an MCP tool result each containing one malformed item among N. *Instrument*: items returned by the parse, and whether the malformed one is nameable afterwards. *Number that would move*: **today 0 returned, target N−1 plus one identified failure**. *Paired arm*: a response that is malformed at the *envelope* level must still fail whole — a per-item boundary that swallows a truncated stream is worse than none.

**T4 — Can two runs of one persona+trigger overlap?** (§2.1, §2.3)
Admit two executions with the same `persona_id` and the same trigger identity, with `max_concurrent = 2`. *Instrument*: `QueueTracker::running_ids` and the executions table's `started_at`/`completed_at` windows. *Number that would move*: concurrent runs for one (persona, trigger) — today 2, target 1. *Paired arm*: two runs of one persona from *different* triggers must still overlap, or the key has become the persona and the per-persona limit has been duplicated.

---

## Features, ranked, with why the scope admits each

`scope.does`: *"run local AI agent personas over wrapped CLIs, local-first storage, one operator per install"*, *"observe runs — cost, health, traces — and tune routing from evidence"*.

1. **Failure classification from a typed kind rather than from the message** → proposal `2026-09-03-typed-failure-classification.md`. `scope.does` says *"tune routing from evidence"*; a classifier that reads prose is the one place in the tree where the evidence is manufactured rather than measured, and §1.3's 93% figure is the tree's own measurement of what that cost. Highest ranked by a wide margin: it is the only finding in this study with a number already attached and an in-tree model (`db/damage.rs`) to copy.
2. **One admission slot per (persona, trigger) key** → proposal `2026-09-03-admission-key-exclusion.md`. `scope.does` names *"one operator per install"*, which is exactly the condition under which a double-run is invisible: there is no second person to notice two identical runs, and the cost lands on the provider bill. Second because §2.5 and §2.6 show the admission gate is already the right place to put it.
3. *(not proposed — recorded)* **A per-item parse boundary that keeps the failed item's identity** (§1.9). Strong, and personas is the fleet's worst case for it — but the right home is `data-access`'s corrupt-row contract rather than the subjects this run is landing, and the proposal cap is two.
4. *(not proposed — recorded)* **The test-power ladder as written doctrine** (§7.1). Twelve lines in `CLAUDE.md`; documentation, not a direction.
5. *(not proposed — recorded)* **Extend the hook registry's live-emit-site rule beyond `hooks/`** (§5.2, §6.1). The rule and its test already exist; applying it to `PromptDelivery` is a small refactor, not a direction.

**Directions not proposed, and why — recorded so the next fleet-map sweep need not re-derive it.** Nothing in this study proposes a cluster-operations capability for personas. Its `scope.does_not` bars *"CI/CD or deployment pipelines for other repositories"* and its `does` fixes the product local-first with one operator per install; dimension (b) is excluded by the project's own text, and both proposals above are in-process work under subjects the manifest already admits.

---

## The inverse list — where personas is ahead

Ordered by how much of it the corpus should carry.

1. **A lint posture with measured baselines and a ratchet** (§8.1), and **a `clippy.toml` that is a decision record** (§8.2) — including the argument that raising a threshold fixes no function and only deletes the markers pointing at the ones that need fixing. Better than kube's justified allows, and better than most golden paths on the subject.
2. **Two extension surfaces separated by return type, with a closed vocabulary held by a test** (§5.2, §9.2) — `Observer` returns `()` *by signature*; `Interceptor` declares one `MutationPoint`; `every_declared_point_has_a_live_emit_site` turns the build red on a declared-but-unfired point. kube has no equivalent, and neither does the corpus.
3. **A denial is `Decision::Refuse`, never `Err`** (§1.7), because veto-by-error makes a denial and a bug indistinguishable downstream.
4. **Boot classification instead of boot declaration** (§4.4), with the 74-of-2,188 measurement, a second counter keyed on the interruption rather than on a failure identity, and an escalation that terminates a run which kills the app on every resume.
5. **The clean-shutdown marker with its fail direction derived from cost** (§4.5).
6. **Reset only on a turn that completes, never on the attempt** (§3.2) — *"Clearing at resume time … makes every crash the first crash, so the escalation can never fire"*, which is `ResetTimerBackoff`'s rule stated better than `ResetTimerBackoff` states it.
7. **A provider-stated delay that distinguishes a rolling window from a weekly cap, and persists the retry** (§1.6). Strictly richer than `Retry-After`.
8. **Admission held by a quota the work would immediately violate** (§2.6), and **reject-by-class shedding with a displacement rule** (§2.5) — two admission-stage decisions kube never makes because it never refuses.
9. **Corruption class decided by extended result code, with the close-time checkpoint refused on canonical damage** (§1.5, `db/src/damage.rs:12-45`).
10. **A module boundary whose justification is a measured build number** (§9.1) and **changelog entries that carry the measurement and the ground truth they were checked against** (§10.1).
