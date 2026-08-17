# Golden path — autonomy gating

> Situation node: `ai-agents/cost-governance/autonomy-gating` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 against `master` @ `7bd14eb9c`. **Recurrence 20 · risk HIGH · sides: server (the
> spine also marks it `twoSided`, and the client half is real — see §7.K) · convergence: converged.**
> Sweep: all **963** non-generated Rust files under `src-tauri/` walked by the census engine and
> re-walked by two independent scanners written for this path. `engine/src/autonomy.rs`,
> `engine/src/autopilot.rs`, `engine/src/queue.rs`, `db/src/settings_keys.rs`,
> `src/engine/background.rs`, `src/engine/subscription.rs`, `src/engine/system_ops.rs`,
> `src/commands/infrastructure/overnight.rs`, `src/companion/brain/sleep_cycle.rs` and
> `src/commands/companion/chat.rs` read in full; all **41** `ReactiveSubscription` impls enumerated
> and classified. **Read-only copies of the operator's two live SQLite databases**
> (`personas.db` 347 MB, `personas_data.db` 17.5 MB, copied 2026-08-15 22:45) queried for what has
> actually run unattended: **2,188 `persona_executions`, 4,972 `persona_events`, 351
> `persona_triggers`, 194 `persona_manual_reviews`, 120 `companion_approval`, 205
> `persona_healing_issues`, 32 `app_settings` rows.**
> The census rule in §9 was built, hand-verified at 5/5, fault-injected six ways, positive-controlled,
> and re-extracted from this document and re-run.
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent`**.
> Dimensions: **cost · security · function · ui**.
> **Settles:** what must be true before this app acts with nobody watching — and what must be true
> before it stops.

---

## 0. The headline, before anything else

**Every autonomy switch in this app defaults to OFF. Every money ceiling defaults to NO CEILING.
The accelerator fails closed and the brake fails open, and both were written by the same people in
the same file.**

Measured at `7bd14eb9c` in `db/src/settings_keys.rs`:

| | Count | Default | Meaning of the default |
|---|---:|---|---|
| `*_DEFAULT: bool` for an autonomy toggle | **17 of 17** | `false` | nothing runs unattended until a human opts in |
| `*_DEFAULT: f64` for a dollar ceiling | **2 of 2** | `0.0` | **no ceiling** (`MONTHLY_COST_CEILING_USD:357`, `CHAIN_MAX_COST_USD:669`) |

The pattern repeats at every other ceiling in the tree, always the same way:

- `personas.max_budget_usd` — `0`/NULL is "unlimited". **78 of 78 personas in the live database have
  no budget.** `2,011 of 2,188` executions carry `"max_budget_usd": null` in their config; the other
  177 have no key at all. **Zero executions have ever run under a dollar ceiling.**
- `overnight.rs:125 budget_verdict(month_spend, ceiling, projected)` — `None => BudgetVerdict::Allow`.
  Its ceiling comes from `monthly_cost_ceiling_usd`, which **is not among the 32 rows of the live
  `app_settings` table**, so the Overnight Portfolio Engine's "hard PRE-dispatch governor" currently
  returns `Allow` on every input.
- `background.rs:2051 schedule_over_budget(max_budget, spend)` — `matches!(max_budget, Some(b) if b > 0.0 && …)`;
  `None` and `0.0` are both "never over budget", and there are unit tests asserting exactly that
  (`:3294-3305`).
- `queue.rs:157 has_global_capacity()` — `self.global_max_concurrent == 0 || …`. **Setting the global
  concurrency cap to zero means unlimited, not stopped.**
- `core/src/run_budget.rs:93` — "Aggregate USD ceiling; `0.0` = unlimited". Enforcement is behind
  `PERSONAS_RUN_BUDGET_ENFORCE` (unset everywhere) and the `run_budgets` table holds **0 rows.**

So the honest description of this system's safety posture is: **turning autonomy on is one click and
turning the brakes on is a separate configuration nobody has done.** The live install proves it —
`companion_autonomous_mode = true`, twelve `autonomous_*` rows all `false`, **zero
`autopilot_mode:<project>` rows**, no monthly ceiling, no per-persona budget, no run budget.

**The second headline is the mirror image.** Where the system *does* stop for a human, it has no
clock. In the live database:

- **11 team assignments have been parked at `awaiting_review` for 59.6 to 68.3 days.** Nothing
  expires them, escalates them, or reports them. The subscription built to unstick them
  (`AssignmentAutoResumeSubscription`) is gated on `autonomous_assignment_retry`, which is `false`.
- Its sibling queue has the opposite policy: `persona_manual_reviews` gets an **unconditional 7-day
  GC sweep at every app launch** (`background.rs:816-836`), which has auto-resolved **20 rows — 17 of
  them `high` severity.**
- A further **148 of 194 reviews (76%) were auto-approved** by the unattended triage, **6 of them
  `high` severity**.

Two adjacent human-in-the-loop queues, opposite policies, neither aware of the other, and the
difference is not a decision anyone made — it is which module the author happened to be editing.

**The good news, and it is genuinely good: this repo has the thing four of five sibling repos do not
— one real front door.** `engine/src/autonomy.rs` answers "may this act unattended, for this
project" once, for 13 named actions, with the precedence rule written down and unit-tested. **24 of
the 29 autonomy verdicts in 963 files go through it.** This path's job is to route the other five
through it too, and to fix the asymmetry in §0's first table.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** "May this act without a human?" is **one question**, and it must have **one
> answer-giving function**. The moment two subsystems compute it independently they will disagree,
> and the disagreement will be invisible because both answers look reasonable in isolation. This is
> not a tidiness argument: the two implementations diverge on the *edge case* (what happens when the
> config is absent), which is precisely the case a human never tests.
>
> **P2 — physics, and the sharpest clause here.** **An autonomy flag must fail CLOSED and a ceiling
> must fail CLOSED, and most systems get exactly one of those right.** Absence of permission is not
> permission; absence of a limit is not licence. Teams reliably reason "unset means the user hasn't
> opted in" for the switch and "unset means the user doesn't want a limit" for the bound — the same
> unset value, read as *refuse* on one axis and *allow* on the other, in the same file.
>
> **P3 — physics.** A system that can act on its own must be able to be **stopped**, and stopping has
> two distinct meanings: *start nothing new* and *abandon what is running*. A control that only does
> the first is not a kill switch; it is a scheduler pause. State which one you built, because the
> operator reaching for it in an incident wants the second.
>
> **P4 — physics.** **A hold that only a human can release must carry a clock.** Otherwise the queue
> is not a queue, it is a place work goes to disappear — and the disappearance is silent, because a
> parked item looks identical to a healthy one that is merely recent. Whether the clock's expiry
> approves, refuses or escalates is a policy choice; *having* one is not.
>
> **P5 — physics.** The clock in P4 must be **the same clock for every hold in the system.** Two
> queues with two different expiry policies is worse than two queues with none, because the operator
> now believes items expire.
>
> **P6 — physics.** **Concurrency gets capped on the first lane and never on the second.** The
> capped lane is the one a human starts; the uncapped one is the loop that enumerates rows, tenants
> or projects, and it is always the newer, more autonomous one.
>
> **P7 — physics.** **A degrade path beats an off switch.** A governor that can move a subject from
> `full` to `reduced` on breach — durably, loudly — keeps the subject observable, whereas a boolean
> that flips to `false` on breach silently converts a running system into an idle one nobody
> notices.
>
> **P8 — ergonomics, and the one most often skipped.** **A gate must be exercisable, and you must
> check that it has been exercised.** A branch keyed on a value the producer never emits is not a
> safety feature; it is a comment with a `CHECK` constraint. Count the rows that took the guarded
> path before you claim the guard works.
>
> **P9 — ergonomics.** **Every autonomy flag needs a control surface and a consumer, and both must be
> verified.** A flag with a UI and no reader is a lie told to the operator; a flag with a reader and
> no UI is a capability only the source tree knows exists. Both are common and both are invisible
> from inside the feature that owns them.
>
> **P10 — security.** **An automatic path may lower its own autonomy; it must never raise it.** Any
> write to a config that a later automatic read treats as permission is an escalation channel,
> whether or not anyone intended it as one. Audit the *writers* of the autonomy config, not just its
> readers.
>
> **P11 — ergonomics.** **The gauge and the gate must be the same computation.** A read-only
> "would this run?" display derived separately from the admission decision will eventually disagree
> with it, and the operator will trust the display.
>
> **Scale condition.** P2, P4 and P10 are correctness on day one. P1, P5 and P6 begin to bite the
> moment a second autonomous lane exists — which is the moment somebody adds a cron. P3 and P8 pay
> the first time something goes wrong at 3am. P7, P9 and P11 are what make the rest operable.

### Warrant evidence — the five sibling repos, censused independently

`personas-web` (Next.js, 1 client escalation loop + 1 nightly CI cron), `brainiac` (Rust workspace,
**7** autonomous lanes off one `main.rs:722` loop), `personas-cloud` (Node orchestrator/worker, **4**
lanes), `vibeman` (Next.js, **11** lanes), `ascent` (Next.js, **14** entry points — 3 crons, 5
webhook `after()` handlers, 5 routes, 1 GitHub Action).

- **P1 is convergent as a FAILURE MODE — 5 of 5.** Where an admission function exists at all, it
  guards the *human request* surface and the autonomous lane routes around it. `brainiac`'s `auth_of`
  (`http.rs:172`) has **77 call sites and the 7 autonomous lanes consult it 0 times**, running on the
  RLS-bypassing `admin_pool` (`store/lib.rs:72`); only 3 of 7 check any flag. `personas-cloud`'s
  `dispatchMatch` (`eventProcessor.ts:483`) is a genuine funnel that checks idempotency, existence
  and concurrency and **never `persona.enabled`** — that flag's only appearance is an advisory string
  (`httpApi.ts:2331`). `ascent`'s `requireCronAuth` (`cron-auth.ts:18`) is used by **1 of 3** crons;
  the other two re-implement it (`purge:22`, `digest:61`). `vibeman` has **11 lanes, 11 inline
  predicates, 0 shared**, and its scan worker checks only `isRunning` (`scanQueueWorker.ts:122`).
  `personas-web` has 17 route handlers, **0** consulting a shared gate, and one that inverts its own
  predicate (`waitlist/route.ts:94,114` vs `lib/server/rate-limit.ts:48` — under-limit requests get
  429, over-limit pass). **This repo is the only one of the six with a real front door, and even
  here 5 verdicts are computed outside it (§7.A).**
- **P2's first half is PHYSICS — 4 of 5 independently reinvented string-equality opt-in.**
  `=== "true"` (`personas-web`, 5 sites), `envBool` accepting only `"1"|"true"` (`ascent env.ts:14-17`),
  `= "true"` on all three widening `action.yml` inputs (`ascent :51,55,59`), `DEFAULT false` on
  `sweep_schedules.enabled` and `kb_enabled` (`brainiac 0018:17`, `0020:23`). Four teams reached the
  same conclusion: an unset value must not be readable as permission. **This repo is the strongest
  instance — 17 of 17.**
- **P2's second half is a convergent FAILURE — 3 of 5 read absence-of-policy as absence-of-constraint.**
  The sharpest is `personas-cloud/packages/shared/src/prompt.ts:727`:
  `if (!policy || policy.skipAllPermissions) return ['--dangerously-skip-permissions']`. The
  `permission_policy` column was added with **no default** (`db.ts:62`), so NULL yields *unrestricted*
  tool execution — and `parsePermissionPolicy` returns `null` on a **JSON parse error** too
  (`:716`), so a corrupt policy also fails open. Twenty lines down, a comment reading *"most
  restrictive: no tool access"* sits directly above the line that returns
  `--dangerously-skip-permissions`. `brainiac/auth.rs:131-135` has `None => true`: a token with no
  scope list passes **every** scope including `admin` (duplicated at `mcp.rs:317-321`).
  `vibeman/src/lib/llm/llm-storage.ts:199`: `config?.enabled !== false // Default to true if not set`.
  **The failure is never on the switch; it is always on the policy the switch does not cover** —
  which is exactly this repo's accelerator/brake split.
- **P3 is convergent, and its violation is universal: 5 of 5 built a kill switch, 0 of 5 reach
  in-flight work.** `brainiac` says so out loud — *"we don't cancel a tick mid-source"* (`main.rs:726`)
  — and its sweeps (`sweeps.rs:261`) get no shutdown receiver at all; **0** `CancellationToken` in the
  repo. `vibeman`'s `stop()` (`scanQueueWorker.ts:195`) leaves in-flight promises (`:383`) unaborted,
  and its one `AbortController` (`:455`) is a 5-minute timeout unreachable from `stop()`.
  `personas-cloud`'s per-deployment `/pause` (`httpApi.ts:987`) is enforced only on the webhook path
  (`:1291`) — `getDueTriggers` (`db.ts:1043`) doesn't join deployments, so **a paused deployment still
  fires triggers**. `personas-web`'s `setEscalationEnabled` (`reviewStore.ts:334`) has **0 callers**.
  `ascent`'s two named "kill switches" both *widen* (`PUBLIC_SCAN_QUOTA_DISABLED`,
  `ASCENT_AUTH_BYPASS`, `env.ts:28`). **A kill switch that stops starts but not work is the single
  most reinvented mistake in this document.**
- **P4/P5 are convergent as a failure — 5 of 5 have a human-blocking queue, 0 of 5 have a universal
  TTL.** `brainiac` has **6 queues** and auto-decides on **2** (`raw_ttl` 30 d `sweeps.rs:292`;
  onboard `expires_at` `0034:82`); the other 4 wait forever. `personas-cloud`'s `pendingReviews`
  (`dispatcher.ts:923`) is **in-memory, with no expiry field and no sweep** — bounded only by
  `timeoutMs` killing the whole execution. `vibeman`'s `pending_approvals`
  (`migrations/index.ts:4327`) resolves only on `processApproval()`/abort; **0** `expires_at` hits.
  `ascent`'s `open` recommendations get a `counts.overdue` label that **decides nothing**
  (`org-insights.ts:429`). `personas-web` is the closest to right and the most instructive: it has a
  real TTL ladder — 30/240/480 min, `info` → auto-approve (`reviewStore.ts:86-90,379`) — **on a lane
  whose enable setter has zero callers**, so it waits forever anyway. **Having the clock is not
  enough; P9 is why.**
- **P6 is convergent — 5 of 5, and four independently chose a small integer near 4.**
  `SCAN_CONCURRENCY = 4` (`ascent pool.ts:37`), `DEFAULT_CONCURRENCY = 4` (`brainiac worker.rs:41`),
  `MAX_CONCURRENT_EXECUTIONS = 4` (`vibeman types.ts:15`), `CONCURRENCY = 6`
  (`personas-web useReviewBulkActions.ts:121`), per-persona `max_concurrent DEFAULT 1`
  (`personas-cloud db.ts:243`). **And in 5 of 5 the uncapped lane is the one that enumerates
  tenants or rows:** `ascent`'s `Promise.all(orgSlugs.map(...))` (`cron/rescan:53`) plus **0** GitHub
  `concurrency:` groups; `brainiac`'s bare `tokio::spawn` in a loop (`sweeps.rs:257`) and unbounded
  org fan-out (`main.rs:846`) with **0** `Semaphore`; `vibeman`'s auto-merge accepting all eligible in
  one loop (`scanQueueWorker.ts:585`); `personas-cloud`'s `getDueTriggers` with **no `LIMIT`**
  (`db.ts:1043`). This repo has `GLOBAL_MAX_CONCURRENT = 4` on the execution lane and an unbounded
  headless lane (see [`headless-model-call`](./headless-model-call.md) §7.B) — **the same shape, sixth
  time.**
- **P7 does NOT converge and must be labelled an invention.** No sibling has a governor that *degrades*
  a subject rather than disabling it. `ascent` comes closest with `FAILED_RESCAN_BACKOFF_MS = 6h`
  (`org-watch.ts:240`) — but that retries forever, and `lastScanStatus` has **no reader that
  disables**. This repo's `full → suggest` degrade (`overnight.rs:408-427`) has **no external
  warrant**; it is retained in §2 because the mechanism is sound and §6 shows it, but an adopting
  repo should treat it as untested doctrine.
- **P8 does not converge either — nobody checks whether their gates fire.** No sibling repo contains
  any assertion, test or query that a guarded branch has ever been taken. This repo's live data shows
  why it matters (§7.D: two gates with **0 exercises in 4,972 events**).
- **P9 is convergent as a failure — 4 declared-but-unread autonomy configs across 3 repos.**
  `vibeman`'s `require_approval` has a DB column (`DEFAULT 1`), a type, a UI toggle and **0
  enforcement sites**; its `max_concurrent_scans` appears 3 times and is **read 0 times**.
  `personas-web`'s `setEscalationEnabled` has 0 callers. `personas-cloud`'s `persona.enabled` is
  enforced nowhere automatic. **This repo contributes two more (§7.G).**
- **P10 mostly holds, with one real breach elsewhere.** `brainiac` is **absent by design** — `mcp.rs`
  has **0** references to `sweep_schedules` / `kb_enabled` / `publish_targets` / `api_tokens`, and a DB
  trigger (`0028:94`) forbids a standard leaving `proposed` without a named human. `vibeman` is the
  counterexample: an MCP tool `resolve_approval` with `readOnlyHint: false`
  (`src/mcp-server/tools/ideas.ts:194`) posts to `/api/ideas/approve` (`route.ts:16`, no auth, no
  human assertion) — **the agent held by the effort≥7/risk≥7 gate can call its own release** — plus 4
  hardcoded `--dangerously-skip-permissions` (`cli-service.ts:332,370,1157`,
  `executionManager.ts:199`) and a non-configurable Codex `approval_policy="never"` (`:356`).
  `personas-cloud` hands the agent the worker's full environment including `WORKER_TOKEN`
  (`worker/src/executor.ts:108`) while running it with permissions skipped. **This repo is clean on
  P10 (§7.H) and that is worth defending, not assuming.**
- **P11 does not converge.** Only this repo computes its gauge from its gate
  (`sleep_cycle.rs`: *"Deliberately the SAME computation the admission runs, not a parallel
  estimate"*). Mark it a house convention.

**A note on silence, per the doctrine.** There is **none**. Every clause above has traces in every
repo audited. The gap is never absence of the idea — it is the idea applied to the human path and
omitted from the machine path. That is a stronger and more actionable result than divergence.

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "run this automatically / nightly / on a schedule", "the system should just handle this"
- "add a background subscription that …", "make this a tick"
- "auto-approve", "auto-retry", "auto-heal", "auto-merge", "self-healing", "unattended"
- "gate it behind a setting" / "add a feature flag for this loop"
- "what happens if the user never clicks approve?"
- "add a budget / cap / limit so it can't run away"
- **If you are about to write `impl ReactiveSubscription for …`, you are in this situation.**
- **If you are about to write `settings::get(pool, settings_keys::AUTONOMOUS_…)` or
  `autopilot::load_modes(…)`, you are in this situation and you are already off the path** — call
  `autonomy::global_enabled` / `autonomy::is_allowed` instead.
- If you are about to add a `status` column whose vocabulary includes `pending`/`awaiting_*` plus
  `approved`/`rejected`, you are in this situation and §8.3 is about you.

You are **not** in this situation for: a manual "Run now" button (a human pressing it *is* the
approval — `system_ops.rs:135-136` says so explicitly), an execution launched from the Executions UI,
or a maintenance sweep that neither spends money nor mutates user-visible state (TTL eviction, cache
warming, healthcheck writes).

### Boundaries with the adjacent paths

- **[`headless-model-call.md`](./headless-model-call.md)** owns *the model call an autonomous path
  makes* — its ceiling, its payer, its meter. This path owns *whether the path was allowed to start
  at all*. Non-overlap test: a nightly scan that spawns through `spawn_headless_claude` with a pinned
  model, a metered leg, a turn cap and a timeout, but which nobody ever authorised to run, is **100%
  compliant with that path and 0% compliant with this one**.
- **[`background-loop.md`](./background-loop.md)** owns the *loop mechanics* — tick, backoff, overlap
  guard, `select!` race, shutdown. This path owns the **first statement inside the tick**: the
  verdict. A perfectly-raced, non-overlapping, backoff-correct loop with no admission check satisfies
  that path completely and violates this one.
- **[`human-review-queue.md`](./human-review-queue.md)** owns the *presentation and resolution* of a
  review — its list, its actions, its optimistic update. This path owns *whether the item can rot*
  (§7.E) and *whether a machine may resolve it* (§7.F).
- **[`llm-spend-accounting.md`](./llm-spend-accounting.md)** owns whether the recorded number is
  correct. This path owns whether a ceiling exists to compare it against (§0).
- **[`cancelling-in-flight-work.md`](./cancelling-in-flight-work.md)** owns per-execution
  cancellation. This path owns the *global* stop (§7.I) — and the finding is that the two are not
  connected.

---

## 2. The one way

**Ask one function, once, at the top of the tick, before you touch anything expensive — and make the
answer default to "no" for the switch and "refuse" for the ceiling.** Concretely: call
`autonomy::global_enabled(pool, Action::X)` for a global-only action, or
`autonomy::is_allowed(&modes, project_id, global, Action::X)` when the action is project-scoped,
having loaded `autonomy::load_modes(pool)` once per tick and early-returned on
`!autonomy::any_enabled(&modes) && !global`; never re-derive that verdict from `settings::get` or
`autopilot::load_modes` at your call site, because the two existing re-derivations use a **different
precedence rule** and neither author knew it. If your action is new, add it to the `Action` enum —
that is one line and one review — rather than inventing a fourteenth key nobody can enumerate. Then
bound the work three ways and make each bound's *absent* value the safe one: a **capability** (what
this mode grants), a **rate** (per tick, per project, per hour), and a **budget** checked
**before** the spend and expressed so that an unconfigured ceiling **refuses** rather than permits —
today `0` means unlimited at five different sites and that is the single largest defect in this
document. Claim your unit of work with a **UNIQUE database constraint**, not an in-memory flag, so a
crash cannot re-fire it (`autopilot_night_runs(project_id, night)` is the model) and so an unattended
retry loop is structurally impossible. Write one durable ledger row per run — including the runs you
**refused** and why — because a system that only records what it did cannot answer "why did nothing
happen last night". If your work parks on a human, give the hold a **clock in the same table you
create it in**, and pick its expiry semantics deliberately (approve / refuse / escalate); a hold
with no clock is where work goes to disappear, and this repo has eleven pieces of work that have been
gone for sixty-eight days. And when a ceiling is breached, prefer **degrading** the subject one level
(`full → suggest`) over flipping it off — a degraded project keeps scanning, keeps reporting, and
stays visible, whereas a disabled one is indistinguishable from an idle one.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`engine/src/autonomy.rs:157` — `global_enabled(pool, Action)`** · **`:169` — `is_allowed(&modes, project_id, global, Action)`** | **The one verdict, and the best type in this document.** 13 named `Action`s, each mapped to its settings key by `Action::global_key()` (`:124`) so no call site holds a key string. The precedence rule lives here once and is unit-tested three ways (`:189-242`). `global_enabled` is `== Some("true")`, so an unreadable row, a missing row, a corrupt value and a database error **all resolve to `false`** — fail-closed by construction, not by convention. Its module docstring names the exact regression it exists to prevent: *"That left 'who wins where?' ambiguous at every read site — each subscription re-derived precedence inline."* **24 of 29 verdicts in the tree route through it.** |
| **`engine/src/autopilot.rs:135` — `load_modes(pool)`** · **`:152` — `any_enabled(&modes)`** · **`:158` — `cap_enabled(…)`** | Per-project modes in **one query per tick** (not N settings lookups), with `AutopilotMode::parse(&val).unwrap_or(AutopilotMode::Off)` at `:140` — **a corrupt row can never widen autonomy past the global flag.** `any_enabled` is the cheap "fully off → no-op" early-out that keeps a disabled tick free. Reach these **through `autonomy`**, which re-exports them (`autonomy.rs:85`); calling `autopilot::` directly is what §7.A counts. |
| **`engine/src/autopilot.rs:107` — `AutopilotMode::allows(Capability)`** | The mode→capability matrix as a **total function over a closed enum**, with a monotonicity test (`:176-198`). Seven capabilities, four modes, one table. The `suggest`/`full` split between `ScanAndTriage` and `DispatchFixes` **is** the degrade semantics — a governor can drop a project one level and it keeps finding work without being able to spend on it. |
| **`src/commands/infrastructure/overnight.rs:125` — `budget_verdict(month_spend, ceiling, projected)`** · **`:142` — `dispatch_capacity(cap, live, want)`** | **The reference autonomous operation in this repo, and the only pre-spend governor that degrades.** Pure, unit-tested (`:708`), consulted **before** dispatch; on breach it refuses, persists `full → suggest` durably (`:411`), emits `tracing::error!` and sends a notification (`:427`). `dispatch_capacity` is `min(free slots, per-project nightly max, want)` — three bounds, one expression. **Copy this whole file's shape for any new unattended operation.** Its one defect is that `ceiling = None` returns `Allow` (§7.C). |
| **`overnight.rs:216` — `claim_night_run(pool, project_id, night, mode)`** | **Once-per-subject-per-window as a UNIQUE constraint, not a flag.** The docstring states the reasoning that matters: *"a crashed run does not re-fire until tomorrow (deliberate: unattended retry loops are the cost failure mode)"*. Use a database claim for every unattended unit of work. |
| **`src/companion/brain/sleep_cycle.rs:520` — `admit(pool, force)`** · **`:445` — `verdict(&reading, force)`** | **The admission shape to copy for anything cadence-driven.** An RAII single-flight guard taken *first* (`CycleGuard::acquire`), then a **pure** `verdict()` over a measured reading, then the row. `force` is documented as bypassing pressure/floor/staleness but **explicitly not the single-flight guard** — "and cannot". And the read-only gauge is computed by *the same two functions* (`sleep_pressure`), deliberately: *"A read-only gauge that could disagree with the gate it displays"* is the failure it avoids. That is P11, implemented. |
| **`engine/src/queue.rs:253` — `ConcurrencyTracker::admit(...)`** · **`:156` `has_global_capacity()`** · **`:163` `quota_available()`** | The execution lane's admission: per-persona capacity **and** a global cap **and** a provider-quota cooldown **and** a host-pressure gate, all in one place, with `AdmitResult::{Running, Queued}` making "rejected" unrepresentable — work is admitted or queued, never dropped. Keyed by `persona_id`, which is why headless work cannot use it (§8.5). |
| **`src/engine/subscription.rs:1502` — `quota_cooldown_active(pool)`** | The shared "the provider is angry, stand down" check, TTL-cached. Every unattended lane that spends should consult it; `overnight.rs:561` and `FleetLivenessWatchdog` do. |
| **`src/engine/deliberation.rs:162` — `floor_breach(spent, budget, idle_deadline, now)`** | A **two-axis** aggregate ceiling — cost *and* an idle deadline — checked before each round, with a real default (`DEFAULT_COST_BUDGET_USD = 5.0`) rather than "unlimited". The only ceiling in the tree whose unset value is a number. |
| **`src/engine/system_ops.rs:137` — `is_held(&automation)`** | The approval hold as a **one-line predicate**, with the manual/automatic distinction stated where it is decided: *"Automation-fired paths call this; manual `run_now` deliberately does NOT (running an automation by hand IS the approval)."* Copy that sentence's discipline. |
| **`core/src/models/trigger.rs:474` — `UNATTENDED_MODES`** · `"auto" \| "dry_run" \| "approval"` | The per-trigger destructive-action gate's vocabulary, in one place. `dry_run` launches with `is_simulation = true` (outbound suppressed); `approval` holds the fire in `pending_trigger_fires`. **Good design, 11% coverage — see §7.D.** |
| **`db/src/repos/core/settings.rs:95` — `settings::set`** | Validates key **and** value (`validate_key` + `validate_value`), warns on deprecated keys, and captures the prior value for `settings_audit_log`. `AUTOPILOT_MODE_PREFIX` values are checked against the closed enum at `settings_keys.rs:876-883`. **This is why P10 holds here** — there is no unvalidated door into the autonomy config. |

**Explicitly NOT primitives.**
`commands::companion::chat::autonomous_mode_enabled` (`chat.rs:180`) is described by `autonomy.rs:63-67`
as "a thin wrapper" for the master bool — **it is not a wrapper, it is a copy**: it does not import
`autonomy`, does not call `global_enabled`, and re-implements the string compare. It has 12 callers
across 8 files. `companion/proactive/message_triage.rs:68 triage_enabled` is a third copy of the same
three lines. `settings_keys::AUTO_OPTIMIZE_PREFIX` and `HEALTH_WATCH_PREFIX` look like autonomy
config and have **zero consumers** (§7.G).

---

## 4. Steps

1. **Name the action before you write the loop.** Add a variant to `autonomy::Action`
   (`autonomy.rs:91`) and its key to `settings_keys` with a `*_DEFAULT: bool = false`. If it is
   project-scoped, map it to a `Capability` in `Action::capability()` (`:144`) and place it in
   `AutopilotMode::allows` (`autopilot.rs:107`). Update the read-site registry in the module
   docstring — it is the only enumeration of this surface that exists.
2. **First statement in the tick is the verdict.** `let global = autonomy::global_enabled(&self.pool, Action::X);`
   then, for project-scoped work, `let modes = autonomy::load_modes(&self.pool);` and
   `if !global && !autonomy::any_enabled(&modes) { return; }`. Never read `settings::get` for an
   autonomy key and never call `autopilot::` directly — §9's rule counts both.
3. **Second statement is the provider check.** `if quota_cooldown_active(&self.pool) { return; }` for
   anything that spends. This is what stops an unattended lane hammering a rate-limited provider.
4. **Claim the unit of work in the database, with a UNIQUE constraint.** `claim_night_run` is the
   pattern: `INSERT … ON CONFLICT DO NOTHING` returning `Option<run_id>`, `None` meaning somebody (or
   a previous crashed attempt) already owns this window. An in-memory `AtomicBool` does not survive a
   restart and an `InflightGuard` does not survive a crash.
5. **Compute the budget verdict BEFORE the spend, and make its unconfigured case refuse.** Today the
   correct call is `budget_verdict(month_spend_usd(pool), monthly_ceiling_usd(pool), projected)` — and
   until §7.C lands you must also decide, in your own code, what to do when the ceiling is `None`. Do
   not copy `None => Allow`.
6. **Bound the fan-out with a number that is not "however many rows came back".** `dispatch_capacity`
   is `min(free_slots, per_subject_max, want)`. A `for project in projects { spawn(…) }` is the shape
   five of five sibling repos have in their newest lane.
7. **On breach, degrade rather than disable.** `full → suggest` persisted through `settings::set`,
   plus a `tracing::error!` and a user-visible notification. A silently-disabled autonomous system is
   indistinguishable from a working idle one.
8. **Write a ledger row for every run — including the refusals.** `autopilot_night_runs` carries
   `skipped_count`, a `skip_reason`, `degraded`, `projected_cost_usd` and `month_spend_usd`. "Nothing
   happened last night and here is exactly why" is the whole product surface of an unattended system.
9. **If the work parks on a human, add the clock in the same `CREATE TABLE`.** An `expires_at` (or
   `escalate_at`) column plus the sweep that reads it. Decide and document what expiry *means* —
   approve, refuse, or escalate — and make it the same answer as every other hold in the app (§8.3).
10. **Prove the guarded branch can be reached, then check that it has been.** Write the query. This
    repo has two gates whose precondition has never once been satisfied in 4,972 events (§7.D), and
    nothing reported it.
11. **Give the flag a control surface.** Ten of the thirteen `Action`s have no UI anywhere in `src/`
    (§7.K). A capability only the source tree knows about is not a capability.
12. **And then stop.** Tick cadence, overlap, backoff and shutdown belong to
    [`background-loop`](./background-loop.md); the model call's ceiling and meter belong to
    [`headless-model-call`](./headless-model-call.md); per-execution cancellation belongs to
    [`cancelling-in-flight-work`](./cancelling-in-flight-work.md). Re-deriving any of them at the call
    site is how the five bypasses in §7.A happened.

### Can the type make the wrong call impossible? — asked before §9

**Partly, and the honest answer is more interesting than a yes.** See "Type over gate", below.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`settings::get(pool, settings_keys::AUTONOMOUS_X)` at the call site** | Re-derives the verdict, and the re-derivation will not match. Measured: 3 copies of the `COMPANION_AUTONOMOUS_MODE` predicate, and 2 sites using `autopilot::load_modes` **without the global fallback that `is_allowed` applies** — so the same project, same question, two answers (§7.A). |
| **`autopilot::load_modes(pool)` followed by `.allows(cap)` at the call site** | Skips the precedence rule. `is_allowed` falls back to the global flag when a project has **no** row; `overnight.rs:555` and `pattern_miner.rs:232` treat "no row" as **off**. Both behaviours are defensible; having both is not. |
| **A ceiling whose `0` or `None` means "unlimited"** | Reads as a limit in the UI, is not one in the code. **5 sites** (§0). The operator who types nothing gets no protection and no warning; the operator who types `0` gets the same thing while believing they typed a hard stop. |
| **`if max_concurrent <= 0 { return true }`** (`queue.rs:213`) | The obvious operator move — "set concurrency to zero to stop everything" — makes it **unlimited**. Only the settings floor (`MAX_PARALLEL_EXECUTIONS_MIN = 1`) keeps this unreachable from the UI; nothing keeps it unreachable from code. |
| **`row.get::<_, i64>("enabled").unwrap_or(1) != 0`** (`db/src/repos/system_ops.rs:22`) | **An automation whose enable flag cannot be read runs.** Two lines below, `:28-31` defaults an unreadable `unattended_mode` to `"auto"` — i.e. *runs without approval*. Both kill-switches fail open, in the row mapper of the only subsystem with a dispatch-op approval gate. |
| **A hold with no clock** | The item is indistinguishable from a healthy recent one. **11 team assignments at 59.6–68.3 days** (§7.E). The `awaiting_review` status has an index (`incremental.rs:5814`) and no sweep. |
| **Two holds with two different expiry policies** | Worse than none, because the operator generalises from the one they have seen. `persona_manual_reviews` → 7-day GC at every launch; `team_assignments.awaiting_review` → never; `companion_approval` → never (8 rows pending). |
| **A gate keyed on a value the producer never emits** | `background.rs:1551` gates `dry_run` on `event.source_type ∈ {"trigger","webhook"}`. **0 of 4,972 live events have either value.** The branch is unreachable in practice and reads as a shipped feature. |
| **Implying a capability from another toggle** | `COMPANION_AUTONOMOUS_MODE` (a button in the **Athena chat header**, `AthenaChatHeader.tsx:116`) implies unattended auto-approval of human reviews with **no separate opt-in** — `subscription.rs:2001-2008` says so. 148 reviews were auto-approved under it. Nothing in the chat header says that is what the switch does. |
| **`tokio::spawn` in a loop over projects/rows** | The uncapped second lane. 5 of 5 sibling repos have exactly this in their newest autonomous lane. |
| **Declaring an autonomy setting with no consumer** | `auto_optimize:<persona>` and `health_watch:<persona>` are writable over the authenticated management API, validated on write, and **read by nothing but their own GET handler.** An operator can enable a loop that does not exist. |
| **A gauge computed separately from the gate** | `sleep_cycle.rs` explicitly refuses to do this. Everything else in the tree that shows an autonomy state to the user re-reads the raw setting. |

---

## 6. Evidence

**The one site to copy: `src-tauri/engine/src/autonomy.rs` in full — and
`src/commands/infrastructure/overnight.rs` for what a complete unattended operation looks like on top
of it.**

`autonomy.rs` is the only place in 963 Rust files where the question "may this act unattended" has a
single answer with its precedence written down, its edge cases chosen deliberately, and its consumers
enumerated. Three properties make it worth copying rather than admiring:

1. **The key never leaves the module.** `Action::global_key()` (`:124`) is the only mapping from an
   action to a settings string, so a call site physically cannot typo a key or read a deprecated one.
2. **Both unknown-cases were decided in writing, in the same direction.** `:33-41`: *"Conservative
   tie-breaks (this is a safety gate — fail closed): Unset per-project mode → follow the global flag.
   Unknown / corrupt per-project enum value → treated as the most restrictive mode (`off`) … so a
   garbled row can never widen autonomy beyond what the global flag alone would grant."*
3. **The registry is in the docstring** (`:43-67`) — the only enumeration of this surface anywhere.
   (It is also **wrong in one entry**, and that is §7.A.)

`overnight.rs` then shows every step of §4 on one page: capability gate (`:555`), night window
(`:559`), quota cooldown (`:561`), UNIQUE-constraint claim (`:566`), pre-spend budget verdict with a
durable degrade (`:406-427`), triple-bounded fan-out (`:401`), and a ledger row carrying
`skip_reason`, `degraded`, `projected_cost_usd` and `month_spend_usd` (`:248-280`). Its module
docstring is the design note this path generalises: *"the budget governor's degrade path (`full` →
`suggest`) maps exactly onto this split: a degraded project keeps scanning + triaging but can no
longer spend on dispatch."*

Also exemplary:

- **`src/companion/brain/sleep_cycle.rs:445-560`.** Guard-first, then a pure verdict, then the row.
  `force` bypasses the policy and **cannot** bypass the single-flight guard, with the reason given.
  The gauge is the gate (`sleep_pressure`), stated as a deliberate refusal of the parallel-estimate
  design. This is P11's only implementation across six codebases.
- **`src/engine/background.rs:2407-2945` — `trigger_scheduler_tick_counted`.** Twelve `continue`
  gates between `get_due` and the publish — daemon yield, trigger type, enabled, timezone, budget,
  hourly ceiling, overlap, backfill budget, approval hold — and **every one of them writes a reason**
  into `persona_events.error_message` through the `EventGateReason` token enum (`:947-960`), so "why
  did nothing fire" is answerable from the database. Compare `EventGateReason::ApprovalHeld`
  (`:1423`) whose comment explains the exact bug fixed by writing a terminal status instead of
  `continue`-ing: rows stranded in `processing` forever, *"never delivered, never retried, exempt from
  retention … and invisible to both the pending and dead-letter counts."*
- **`db/src/repos/execution/healing.rs:302-345`.** The `auto_fix_pending` state machine drawn as
  ASCII with all three exits and a TTL, and a global sweep that reverts stale rows
  (`subscription.rs:1021-1040`). This is what a self-acting subsystem's state should look like even
  though (§7.B) it has no autonomy flag above it.
- **`engine/src/queue.rs:253-280` — `admit`.** Returns `AdmitResult::{Running, Queued{position}}`; a
  rejection is not representable, so backpressure cannot silently drop work.
- **`src/engine/system_ops.rs:127-141`.** `is_dispatch_kind` narrows the approval gate to the two ops
  that act on production signal, and the docstring says which paths call `is_held` and which
  deliberately do not.

---

## 7. Deviations found

### 7.A Five verdicts are computed outside the one front door — and two use a different rule

`autonomy::global_enabled` / `is_allowed` / `load_modes` / `any_enabled` are called at **24 sites
across 2 files** (`subscription.rs` ×23, `deliberation.rs` ×1). Five more sites answer the same
question without them:

| Site | What it does | Divergence |
|---|---|---|
| `src/commands/companion/chat.rs:182` | `autonomous_mode_enabled(db)` — re-implements `Action::CompanionMaster` | **12 callers across 8 files.** Semantically identical today; `autonomy.rs:63-67` calls it "a thin wrapper", but it neither imports nor calls `autonomy` |
| `src/companion/proactive/message_triage.rs:70` | `triage_enabled(sys_db)` — a **third** copy of the same three lines | Identical today. Three implementations of one predicate |
| `src/commands/infrastructure/overnight.rs:555` | `autopilot::load_modes` + `m.allows(ScanAndTriage)` in the tick | **Different precedence.** No global fallback: a project with **no** autopilot row is `Off` here and follows the global flag in `is_allowed` |
| `src/commands/infrastructure/overnight.rs:660` | same, in the manual `run_now` command | Same divergence, plus `unwrap_or(AutopilotMode::Off)` made explicit |
| `src/engine/pattern_miner.rs:232` | `mining_enabled(pool)` — `load_modes` + `allows(AutomationSuggestion)` | Same divergence, **documented as deliberate**: *"There is no legacy global flag for this capability, so 'no project opted in' honestly means OFF"* |

The last three are the interesting ones. Each is individually defensible; together they mean the
sentence "a project with no autopilot row" has two different meanings in the same binary, and nothing
anywhere states which one is correct. `pattern_miner`'s reasoning is sound and should be promoted
*into* `autonomy.rs` as a third precedence mode (`ProjectOnly`) rather than living as a local
exception.

**A sixth surface is invisible to the rule and must be named here:** `companion::night_shift::enabled`
(`night_shift/mod.rs:257`) reads `COMPANION_NIGHT_SHIFT` with `.map(|v| v == "true").unwrap_or(COMPANION_NIGHT_SHIFT_DEFAULT)`
— a **fourth spelling** of the decode, gating what its own key docstring calls *"the most autonomous
surface in the app"* (`settings_keys.rs:394-402`). It is not an `Action`, so it is not in the
registry and not in the count.

**And the registry itself is wrong.** `autonomy.rs:63-67` claims the companion master toggle "also has
the convenience reader `commands::companion::chat::autonomous_mode_enabled` … It reads the same
`Action::CompanionMaster` key; kept as a thin wrapper". It reads the same *key*; it does not read it
*through* the front door, and `message_triage` is a third reader the registry does not mention at all.

### 7.B The most-exercised autonomous action in the app has no autonomy flag

Healing auto-retry re-runs a failed execution — spending real money, unattended — and consults
**nothing** from §3. Its entire gate is arithmetic:

```rust
// engine/src/healing_timeline.rs:274-283
let is_auto_fixable = is_usage_limit_retry
    || (healing::is_auto_fixable(&category)
        && consecutive < 3
        && exec.retry_count < MAX_RETRY_COUNT
        && matches!(diagnosis.action, HealingAction::RetryWithBackoff { .. } | HealingAction::RetryWithTimeout { .. }));
```

No `autonomy::`, no `unattended_mode`, no per-project mode, no budget. The live database holds **205
`persona_healing_issues`** (171 open `external`, 8 open `config`) and **27 `healing_audit_log`** rows.

The same is true of six other always-on subscriptions that take real action: `AutoRollbackSubscription`
(rolls a persona back to a prior prompt version — gated only on a per-persona `auto_rollback:<id>`
setting, `auto_rollback.rs:73-83`), `IncidentContinuationSubscription` (re-runs blocked work;
documents its reasoning honestly — *"the trigger is an explicit human/Athena resolve (the consent)"* —
which §7.F complicates), `QueueDrainWatchdog` (promotes up to 16 queued executions per tick),
`ScraperScheduleSubscription`, `CompositeSubscription`, and the **startup stale-review GC** (below).

Of the **39 production `ReactiveSubscription` impls** (41 including the two test fixtures), **12
route through `autonomy::`**. The other 27 are not all defects — TTL eviction and healthchecks
legitimately need no gate — but the boundary between "maintenance" and "autonomy" is nowhere
declared, and healing auto-retry sits on the wrong side of it.

### 7.C Five ceilings treat "not configured" as "no limit"

Enumerated in §0. The live consequence, measured:

| Ceiling | Live value | Effect |
|---|---|---|
| `monthly_cost_ceiling_usd` | **absent from a 32-row `app_settings`** | `budget_verdict` returns `Allow` for every input; the Overnight governor cannot refuse |
| `chain_max_cost_usd` | absent | *"the ONLY brake on runaway chain COST"* (`settings_keys.rs:663`) is off |
| `personas.max_budget_usd` | **0/NULL on 78 of 78 personas** | `schedule_over_budget` returns `false` for every persona |
| `run_budgets` ceiling | table holds **0 rows**; `PERSONAS_RUN_BUDGET_ENFORCE` unset | warn-only, unexercised |
| `global_max_concurrent` | 10 (`MAX_PARALLEL_EXECUTIONS_DEFAULT`) | the one ceiling with a non-permissive default — and `0` still means unlimited in the tracker |

Contrast the switches: **17 of 17 autonomy bools default `false`**, and the two keys with no live row
at all (`autonomous_deliberation`, `autonomous_director_storm`) resolve to `false` through
`global_enabled`'s `== Some("true")`. The switch discipline is exemplary. The ceiling discipline is
its exact inverse, in the same file, sixty lines apart.

### 7.D Two gates have never been exercised, and the app cannot tell

`persona_triggers.unattended_mode` is the destructive-action gate: `auto` | `dry_run` | `approval`.
In the live database, **all 351 trigger rows are `auto`** — the column has never held another value.
That alone is not a defect. These are:

**1. The gate covers 11% of triggers.** By type: `event_listener` 189, `manual` 68, `chain` 55,
`schedule` 32 (20 disabled), `polling` 7 (6 disabled), `webhook` **0**. The backend honours
`approval` for schedule (`background.rs:2878`) and webhook (`:1393`), and `dry_run` for events whose
`source_type ∈ {"trigger","webhook"}` (`:1551-1557`). The frontend renders the control for
`{schedule, polling, webhook}` (`UnattendedModeSection.tsx:16`) — so **`polling` shows a control the
backend does not honour**, and `event_listener` + `chain` (244 rows, 70%) have no gate at either
layer. The component's own comment concedes half of this: *"internal persona events (chain steps) …
are not gated here — the run gate would need subscription→trigger resolution that isn't plumbed, and
surfacing a control the backend doesn't honor would be a worse (lying) signal."* The `polling` case
is exactly that lying signal.

**2. The `dry_run` branch has never evaluated true.** Its precondition is
`event.source_type ∈ {"trigger","webhook"}`. **0 of 4,972 `persona_events` carry either value** — the
live distribution is `persona:T:_<Team>` handoffs (3,826), `chain` (727), `manual_review` (36),
`system_op` (28), `findings` (15). Corroborating: `is_simulation = 0` for **all 2,188 executions**,
and `pending_trigger_fires` holds **0 rows**. Both halves of the gate — the hold and the simulation —
are unexercised in the app's entire recorded history.

**3. The `dry_run` lookup asks the wrong trigger.** `:1551-1556` resolves the trigger from
`event.source_id` — the trigger that **published** the event — and applies its mode to the persona
about to **run**. For an `event_listener` match those are different triggers. The gate would consult
the producer's policy to decide the consumer's behaviour.

### 7.E Eleven pieces of work have been waiting on a human for sixty-eight days

`team_assignments.status = 'awaiting_review'`, live, ordered by age:

| Days parked | Count |
|---|---|
| 68.3, 68.2, 67.9, 66.5, 65.0, 65.0, 64.8, 63.0, 61.4, 59.6, 59.6 | **11** |

`team_assignments` (`incremental.rs:5793-5815`) has no `expires_at`, no `escalate_at`, no sweep. The
status is indexed (`:5814`) purely for the UI list. The subscription that could unstick them —
`AssignmentAutoResumeSubscription`, whose whole purpose is *"Resumes an assignment soft-paused at
awaiting_review after a retryable (quota/session/rate-limit) step failure so the goal-advance loop
self-heals instead of deadlocking"* (`background.rs:585-589`) — is gated on
`autonomous_assignment_retry`, which is `false` and has been since 2026-06-17.

`companion_approval` shows the same shape at a smaller scale: **8 rows `pending` at 5.1 days**, plus
12 in a terminal `approved_failed` state. No expiry column, no sweep.

**Nothing anywhere reports this.** There is no "oldest pending item" metric, no staleness badge, no
notification. The eleven assignments are invisible unless someone opens the list and reads the dates.

### 7.F The other hold auto-resolves — on a hardcoded threshold, with no flag

`persona_manual_reviews` has the opposite policy, applied by **two independent mechanisms**:

1. **Auto-triage** (`subscription.rs:1986-2069`) — gated on `Action::CompanionMaster`, which is
   **`true`** in the live install. Approves low/medium after a 60-minute grace, ≤10 per tick.
   Measured: **148 of 194 reviews (76.3%) carry the auto-triage note.** By severity: medium 93, low
   49, **high 6**.
2. **Startup stale GC** (`background.rs:816-836`) — **unconditional**, no autonomy flag of any kind,
   spawned on every app launch, threshold hardcoded at 7 days with the comment *"exposing it via
   app_settings is tracked as a follow-up."* Measured: **20 rows auto-resolved**, each with a
   `policy_events` audit row. By severity those 20 are **17 `high`, 2 `low`, 1 `medium`**.

So the app's answer to "what happens to a run waiting on a human who never answers" is **three
different answers in one binary**: wait forever (`team_assignments`, `companion_approval`),
auto-approve after an hour if a chat-header toggle is on (`persona_manual_reviews`, low/medium), or
auto-resolve after seven days no matter what any flag says (`persona_manual_reviews`, all
severities). The third one has closed 17 high-severity items.

The high-severity auto-approval path is well-built — a hard business/policy **denylist**
(`REVIEW_BUSINESS_POLICY_MARKERS`, 25 markers including `phi`, `production`, `force push`,
`drop table`, `credential`) that wins on any overlap with the safe-technical **allowlist**, behind a
separate `AUTONOMOUS_REVIEW_TRIAGE_HIGH` opt-in, pure and unit-tested (`:1977-1983`). It is exactly
the right design. The stale GC bypasses all of it.

### 7.G Two autonomy settings have no consumer

`AUTO_OPTIMIZE_PREFIX` (`auto_optimize:<persona_id>`) and `HEALTH_WATCH_PREFIX`
(`health_watch:<persona_id>`) are:

- allow-listed (`settings_keys.rs:824-825`), validated on write (`:889-891`),
- writable and readable over the authenticated management API
  (`management_api.rs:100-105, 1481-1568`), carrying `enabled`, `cron`, `min_score`, `models` /
  `enabled`, `interval_hours`, `error_threshold`,
- and **referenced by nothing else in the entire tree.** A grep across `src-tauri/` and `src/` for
  `auto_optimize` / `health_watch` in any casing returns only those four handlers plus one settings
  unit test. There is no loop, no subscription, no scheduler entry.

An integrator can `POST /api/settings/auto-optimize/<persona>` with `{"enabled": true, "cron": …}`,
get `200`, see it persisted, read it back — and nothing will ever run. Two further keys are in the
same family by admission: `AUTONOMOUS_MESSAGE_TRIAGE` and `AUTONOMOUS_REVIEW_TRIAGE` are documented
as *"no longer consulted"* (`settings_keys.rs:1069-1070`) and kept allow-listed, and
`Capability::AutomationCommit` is *"granted by the matrix but exercised by NOTHING"*
(`autopilot.rs:76-82`) — that last one is at least honest in its own docstring.

The oracle found the identical shape in three sibling repos (P9), which makes this convergent rather
than careless. It is still four flags an operator can set that do nothing.

### 7.H What this path CLEARED — the escalation audit

**Nothing in this app can raise its own autonomy, and the design is deliberate.** Verified by
enumerating every writer:

- `settings::set` (`settings.rs:95-120`) validates **key and value** and audits the prior value.
  `autopilot_mode:<project>` values are checked against the closed enum (`settings_keys.rs:876-883`);
  an `AUTONOMOUS_*` value must be the literal `"true"`/`"false"`.
- **31 `settings::set` call sites.** Exactly **two** write an autonomy verdict:
  `commands/infrastructure/autopilot.rs:52` (an IPC command behind `require_auth`) and
  **`overnight.rs:411` — which only ever writes `suggest`, a downgrade.** There is no automatic write
  that widens.
- The management API is behind `require_api_key` — scoped bearer tokens against `external_api_keys`,
  with per-route scope checks and an audit log (`management_api.rs:396-450`), and it never logs token
  plaintext.
- The MCP tool surface (`src/mcp_server/tools.rs`) contains **no** `settings::set` call at all.

That is a materially better posture than `vibeman`, where an MCP tool can post to an unauthenticated
`/api/ideas/approve` and release the approval gate holding it. **This is worth protecting explicitly**
— the property is currently maintained by 31 individually-correct call sites, not by a type (§8.4).

Three more things the obvious reading would predict and the measurement refutes:

- **"The autonomy flags fail open."** No — **17 of 17 default `false`**, `global_enabled` is
  `== Some("true")`, and `load_modes` coerces a corrupt row to `Off`. The fail-open sites are 3, all
  outside the front door: `system_ops.rs:22` (`enabled` → `1`), `system_ops.rs:28-31`
  (`unattended_mode` → `"auto"`), and two API defaults (`dev_tools.rs:1508 auto_execute.unwrap_or(true)`,
  `memories.rs:715 auto_apply.unwrap_or(true)`). Two independent scanners agree on the population
  (21 fail-open / 17 fail-closed on flag-shaped reads across 951 non-test files); hand-verification
  shows **18 of the 21 are create-time product defaults** ("a new trigger is enabled unless you say
  otherwise"), not gate reads.
- **"There is no single admission point."** There is one, it is good, and it covers 24 of 29
  verdicts. The defect is the five that bypass it, not its absence.
- **"The autopilot is on somewhere."** No — **0 `autopilot_mode:` rows exist**, so the entire
  per-project system, the Overnight Portfolio Engine, and `pattern_miner`'s suggestion lane are all
  inert on this install. `autopilot_night_runs`, `dev_auto_runs`, `automation_runs`,
  `automation_suggestions`, `evolution_cycles`, `policy_proposals`, `incident_diagnoses`,
  `circuit_breaker_state`, `budget_alert_rules`, `desktop_connector_approvals`,
  `schedule_missed_runs`, `scheduled_retries`, `chain_stop_reasons`, `companion_night_plan` and
  `companion_night_event` all hold **0 rows.**

### 7.I There is no kill switch that reaches in-flight work

Four candidates, none of which is one:

| Control | What it does | Reaches running work? |
|---|---|---|
| `background.rs:908 stop_loops` | sets `running = false` **and bumps `generation`** | **No.** Its own comment: *"Dropping `subscription_handles`' JoinHandles does not abort the underlying tasks, so any loop spawned under the previous generation is still alive and ticking."* The generation bump retires orphans **at their next tick boundary** |
| `chat.rs:139 companion_cancel_autonomy` | cancels pending autonomy ticks | **No**, and says so: *"Does NOT interrupt an in-flight stream — use `companion_interrupt_turn` for that"* |
| `companion_set_autonomous_mode(false)` | flips the master row | **No.** Next tick only |
| `set_global_max_concurrent(n)` | hot-reloads the cap | **No** — and `n = 0` means *unlimited* (`queue.rs:157`) |

There is no command that halts every autonomous lane, and no command that abandons in-flight
autonomous work. `force_cancel_all_for_persona` exists (`personas.rs:813`) and is per-persona.

`circuit_breaker_state` — the persistent breaker table with a 15-minute TTL
(`incremental.rs:2299-2302`) — holds **0 rows**, and `is_circuit_breaker = 0` on all 205 healing
issues. The breaker has never tripped, so its restart-survival path is also unexercised.

Per the oracle this is 5-of-5 physics-as-failure-mode, so the *class* is not a local mistake. The
local part is that this app has more autonomous lanes than any sibling audited.

### 7.J The concurrency cap describes one lane

`GLOBAL_MAX_CONCURRENT = 4` (`queue.rs:10`, overridden at runtime by
`MAX_PARALLEL_EXECUTIONS_DEFAULT = 10`) governs `persona_executions` via one `admit` call site. The
other lanes:

| Lane | Cap | Where |
|---|---|---|
| persona executions | 10 (setting) / 4 (const fallback) | `queue.rs:253` |
| overnight fleet dispatch | `min(free slots, per-project nightly max, want)` | `overnight.rs:142` |
| knowledge apply sessions | `APPLY_MAX_CONCURRENT_PER_REPO = 4` | `approval_exec_knowledge.rs:464` |
| task executor fan-out | `unwrap_or(2)`, elsewhere `.clamp(1, 8)` | `task_executor.rs:662, 1481` |
| headless model calls | **none** | [`headless-model-call`](./headless-model-call.md) §7.B |
| every `ReactiveSubscription` tick | **none** — each tick's own per-tick constant is the only bound | `subscription.rs` |

The per-tick constants are real and mostly sensible (`REVIEW_TRIAGE_MAX_PER_TICK = 10`,
`BACKLOG_TO_GOAL_MAX_PER_TICK = 5`, `MAX_PROMOTE_PER_TICK = 16`), but they are **per subscription**,
so twelve autonomous lanes ticking at once have no aggregate bound and no shared budget.

### 7.K The client half: ten of thirteen actions have no control surface

The leaf is marked `twoSided` and its dimensions include `ui`. Measured across `src/`:

- **`AutopilotControl.tsx`** (Teams › KPIs) is the only per-project autonomy UI — four modes, self-contained,
  with the mode→capability matrix restated in its docstring and a note to keep it in sync with
  `autopilot.rs`. It governs **3 of the 13 `Action`s** (`KpiEvaluation`, `KpiGoalDerivation`,
  `GoalAdvancement`) plus the two Overnight capabilities. Its own docstring frames its purpose as
  *"replacing a hunt through a dozen global `autonomous_*` setting keys."*
- **`AthenaChatHeader.tsx:116`** — a button in the chat header — is the only control for
  `COMPANION_AUTONOMOUS_MODE`, the master toggle that implies unattended review auto-approval.
- **`LimitsSettings.tsx`** writes `monthly_cost_ceiling_usd` and `max_parallel_executions`, and
  treats an empty ceiling as `0` (`isValidCeiling`: *"empty = unset; treated as 0"`) — i.e. the UI
  faithfully renders the fail-open convention.
- **Everything else: nothing.** A grep for `autonomous_` across `src/**/*.{ts,tsx}` finds no toggle
  component for any of the remaining ten actions. `autonomy.rs:8-10` describes them as *"opt-in
  toggles surfaced in the Limits/Admin UI"*; **they are not surfaced anywhere.** They are reachable
  only through the generic `setAppSetting(key, value)` bridge (`api/system/settings.ts:31`), which no
  autonomy UI calls.

So the operator's mental model of this system's autonomy is one 4-level dial for one project family
and one chat-header switch, and the other ten capabilities are invisible. That is the mirror of §7.G:
there, flags with a surface and no consumer; here, consumers with no surface.

---

## 8. Gaps in the primitives

### 8.1 `Action` has two precedence modes and needs three

`Action::capability()` returns `Option<Capability>`, and `is_allowed` branches on it: `Some` →
per-project with global fallback, `None` → global-only. There is no way to express *"per-project
only; no row means off"*, which is what `pattern_miner` and `overnight` both need and both
hand-rolled. Adding a third mode (`ProjectOnly`) is a one-variant change to a private enum and it
retires 3 of the 5 bypasses in §7.A. **This is the root cause of most of §7.A.**

### 8.2 `global_enabled` takes a `&DbPool`, so the decision is not injectable — and is re-read per tick

Every gate is a settings read. `load_modes` batches the per-project side into one query; the global
side does not batch, so `FleetLivenessWatchdog` performs two reads and `GoalAdvance` three. More
importantly, a verdict cannot be constructed in a test or passed down a call stack — it must be
re-derived wherever it is needed, which is precisely the pressure that produced `autonomous_mode_enabled`.
An `AutonomyVerdict` value (see Type-over-gate) would fix both.

### 8.3 There is no hold primitive, so every hold invents its expiry policy

Four human-blocking queues (`persona_manual_reviews`, `team_assignments.awaiting_review`,
`companion_approval`, `pending_trigger_fires`), four different answers, zero shared code. Measured
across the DDL: **33 declarations of a `status TEXT … DEFAULT '<hold token>'` column in the tree, and
the number carrying any expiry column is 0.** The only `expires_at` columns in the schema belong to
`external_api_keys` (a credential lifetime) and `claim_expires_at` on `persona_executions` /
`build_sessions` (a leader lease). **No hold in this application has ever carried a clock.**

The primitive that would fix it is small: a `HumanHold` trait or a shared `expires_at` +
`on_expiry TEXT CHECK(on_expiry IN ('approve','refuse','escalate'))` column pair plus one sweep
subscription that reads every registered hold table. Today the sweep exists once, hardcoded, at
startup, for one table, with a `const` threshold.

### 8.4 "An automatic path may not widen autonomy" is a property of 31 call sites, not a type

§7.H's clean result is maintained by every `settings::set` caller happening to be correct. Nothing
stops the 32nd from writing `autopilot_mode:<p> = "full"` from a background tick — `validate_value`
would accept it, since `full` is a legal value. The fix is a type: split the writer into
`settings::set_human(key, value)` (behind an auth-carrying call) and `settings::set_machine(...)`
that rejects the autonomy key space, or make `AutopilotMode` writes go through a
`fn downgrade_only(current, next)` that cannot move up the ladder.

### 8.5 The one real admission tracker is keyed by `persona_id`

`ConcurrencyTracker::admit` takes `&persona.id`, so no headless or subscription-driven lane can enter
it without inventing a synthetic persona. This is the same gap
[`headless-model-call`](./headless-model-call.md) §8.5 identifies from the other side, and the same
fix applies: widen the key to `enum CallOwner { Persona(String), Headless(&'static str), Subscription(&'static str) }`
rather than building a second tracker. There are already two aggregate ceilings that do not know
about each other (`deliberation::floor_breach`, `RunBudgetLedger`); a third would be worse.

### 8.6 Nothing measures whether a gate has ever fired

§7.D found two branches unreachable in practice, and the only way to learn that was to query the live
database by hand. `EventGateReason` is the right shape — it writes a token per skip — but it covers
one subsystem, and none of the `unattended_mode`, autopilot-capability or budget-verdict decisions
emit a counter. A `gate_decisions(gate, verdict, count, day)` rollup would make "this guard has never
said no" a dashboard row instead of an archaeology exercise.

### 8.7 `Capability` is closed but the mode matrix is `Self::Full => true`

`AutopilotMode::allows` (`autopilot.rs:116`) grants **every** capability at `full` via a catch-all
arm. Adding a capability therefore grants it to every `full` project silently — `AutomationCommit`
already arrived that way and is documented as *"granted by the matrix but exercised by nothing"*.
An exhaustive match at `Full` would make each new capability an explicit decision.

---

## Convergence — what the five sibling repos say

| Clause | brainiac | personas-cloud | ascent | vibeman | personas-web | Verdict |
|---|---|---|---|---|---|---|
| One admission oracle for autonomous work | `auth_of` 77 sites, **0 of 7 lanes** | `dispatchMatch` funnel, never checks `enabled` | 1 of 3 crons | **11 lanes, 0 shared** | 17 routes, 0 shared | **Convergent failure 5/5. This repo is the only one with a real front door (24/29)** |
| Unset config → refuse | 13 closed / 5 open | **fail-OPEN** (4× `DEFAULT 1`) | fail-CLOSED, `envBool` | split 12/5 | fail-CLOSED | **Physics 4/5** on string-equality opt-in. **This repo is the strongest: 17/17** |
| Absence of *policy* → restricted | `None => true` on scopes | **NULL policy → `--dangerously-skip-permissions`** | ok | `enabled !== false` | ok | **Convergent failure 3/5** |
| Kill switch reaches in-flight work | **no** (says so) | **no** (paused deployment still fires) | **no** | **no** | **no** (0 callers) | **Physics as failure: 5/5 built one, 0/5 reach running work** |
| Automatic path cannot widen its own autonomy | **absent by design** (DB trigger) | partial (`WORKER_TOKEN` handed over) | partial | **BREACHED** (unauth `/api/ideas/approve` from MCP) | absent | **Mixed. This repo is clean (§7.H)** |
| Inner concurrency cap | 4 | 1/worker | 4 | 4 | 6 | **Physics 5/5, four chose ~4** |
| Outer enumeration loop capped | **no** (`spawn` in loop) | **no** (`getDueTriggers` no LIMIT) | **no** (`Promise.all(orgs)`) | **no** | **no** | **Convergent failure 5/5** |
| Human hold carries a clock | 2 of 6 queues | **none, in-memory** | none | none | ladder exists, **lane unarmable** | **Convergent failure 5/5. 0/6 including this repo** |
| Circuit breaker guards the autonomous lane | provider + publish only | none | **0 breakers** | LLM calls only | human replay path only | **Physics on threshold=5 (3 repos independently); failure 5/5 on placement** |
| Declared-but-unread autonomy config | — | `persona.enabled` | — | `require_approval`, `max_concurrent_scans` | `setEscalationEnabled` | **Convergent failure 3/5. This repo adds 2 more (§7.G)** |
| Governor DEGRADES rather than disables | — | — | — | — | — | **Silence 0/5 — this repo's `full → suggest` is an invention** |
| Gauge computed by the gate | — | — | — | — | — | **Silence 0/5 — house convention** |

**The sharpest external finding, and the one that most directly validates P2's second half:**
`personas-cloud`'s `prompt.ts:727` returns `['--dangerously-skip-permissions']` when the permission
policy is `null` — and `null` is what you get from an un-defaulted column, **and** from a JSON parse
error, **and** the file contains a comment reading *"most restrictive: no tool access"* twenty lines
below that return. Three independent routes to unrestricted execution, one of them a corrupted row,
under a comment asserting the opposite. That is the same failure this repo commits on its money axis
and avoids on its switch axis, and it is why P2 is stated as two halves.

**Two silences worth naming as silences.** (1) **Nobody degrades** — five repos, zero governors that
move a subject down a ladder instead of off. (2) **Nobody computes the gauge from the gate.** Both
this repo's answers are inventions with no external warrant; adopt them as proposals, not doctrine.

---

## Type over gate — the answer

**Partly yes, and the honest answer is that this repo has already made the strongest available type
move and it is not enough — because the type it needs is on the axis it did not type.**

Held against the seven earned qualifications:

**1. `AutonomyVerdict` as a value, not a call.** The single highest-value type change:

```rust
pub struct AutonomyVerdict { action: Action, allowed: bool, project: Option<String> }
pub fn resolve(pool: &DbPool, action: Action, project: Option<&str>) -> AutonomyVerdict
```

with `allowed` **private** and the only accessor being `fn permit<T>(&self, f: impl FnOnce() -> T) -> Option<T>`.
**Qualification 5 — withholding beats requiring — is the reason this works**: the caller cannot obtain
the bool, so it cannot re-derive, cache, invert or copy it; the only way to act is to hand your work
to the verdict. `autonomous_mode_enabled` and `triage_enabled` become unwritable, because there is no
bool to return. **Qualification 3 bounds the claim**: a type nobody constructs constrains nothing, so
`resolve` must be the *only* public path — which means `settings_keys::AUTONOMOUS_*` and
`AUTOPILOT_MODE_PREFIX` must become `pub(crate)` to the `autonomy` module. That is the move that makes
it real, and it is a 5-site change (§7.A) plus two visibility edits.

**2. `Ceiling` as a closed enum, and this is the one the repo has not done.**

```rust
pub enum Ceiling<T> { Unlimited, At(T) }   // no Default impl, no From<Option<T>>
```

`0.0` and `None` currently mean *unlimited* at five sites through five different expressions
(`== 0`, `<= 0`, `filter(|v| *v > 0.0)`, `matches!(.., Some(b) if b > 0.0 && ..)`, `None => Allow`).
**Qualification 2 — requiredness is orthogonal to closedness — is exactly the trap here**: making
`ceiling: f64` required changes nothing, because `0.0` is already required and already means
unlimited. Closedness is the whole win: `Ceiling::Unlimited` must be *typed*, so an operator's blank
field cannot silently become it, and every ceiling site must state which of the two it meant.
**Qualification 1 limits it honestly**: this constrains the *shape*, not the *policy* — someone can
still write `Ceiling::Unlimited` as the default, and only the review of that one line stops them.
That is still infinitely better than five spellings of zero.

**3. `Hold<Policy>` — a hold you cannot create without a clock.** §8.3's fix as a type: a constructor
`Hold::new(subject, expires_at: DateTime<Utc>, on_expiry: Expiry)` where `Expiry` is
`{ Approve, Refuse, Escalate }`. **Qualification 6 is what makes this the right withholding**: the
dangerous freedom is "park work with no deadline", not "park work" — callers keep the hold, they
simply cannot omit its clock. And **qualification 7 applies to the counter-proposal**: widening
`team_assignments.status` or adding a nullable `expires_at` column is inert, because the callers who
forget it today will keep forgetting it; the construction must be withheld.

**4. `settings::set_machine` — withhold the widening write.** §8.4. **Qualification 4 bounds this
one**: a newtype anyone can construct authenticates nothing, so the split must be at *visibility* —
`set` becomes `pub(crate)` to a module that only IPC commands can reach, and background code gets a
setter whose key space excludes autonomy. Otherwise it is a comment.

**What the gate is for.** None of the four is a substitute for §9's rule, and §9 is not a substitute
for them. Move 1 is the one that makes §9's condition unrepresentable — at which point the rule
reaches zero and, per the census contract, must be **deleted** rather than baselined. Until then the
rule holds the line at 5 and, more usefully, makes the *next* bypass visible on the day it lands
rather than at the next audit.

---

## 9. The missing gate

**Manifestation layer** ([`golden-path-contract.md:43-69`](../golden-path-contract.md)). The warning
must be loud: **no sibling repo gates anything in this document**, and four of the five have no
autonomy chokepoint for a gate to key on. The conditions below travel; the signal does not — an
adopting repo must re-derive its own proxy for "an autonomy verdict computed away from the one place
that should compute it".

**And a calibration specific to this repo, 2026-08-15:** `ci.yml` has **0 successes in 260 all-time
runs**, and four of seven workflows are at 0%. A gate that only runs in CI currently runs nowhere.
The rule below therefore lives in **`scripts/census/rules.json`**, executed by `npm run census:check`
— which runs from the developer's shell and from the pre-push hook, not only from a workflow file.

### Checked first — the existing 96 census rules

| Rule | Overlaps? |
|---|---|
| `settings-bool-by-string-compare` (15 files / 18, `app-settings-store.md`) | **Yes, partially — and the overlap is 2 of my 4 files.** It counts the *decode idiom* (`settings::get(..) == "true"`), which `chat.rs:182` and `message_triage.rs:70` both commit. It does **not** see `autopilot::load_modes` (2 of my 4 files, `overnight.rs` and `pattern_miner.rs`), and it fires on 13 files that have nothing to do with autonomy. The two rules answer different questions about the same two lines: *how is this value decoded* vs *should this site be deciding at all*. 50% file overlap — well under the 83% that got a previous rule declined, and the residue is exactly the half that matters. |
| `settings-key-declared-outside-registry` (8 / 10) | Counts a `const *_KEY: &str` declared outside `settings_keys.rs`. Orthogonal — my violations all use the registry's constants correctly and read them in the wrong place. |
| `unpinned-billing-account-spawn` (5 / 5, `headless-model-call.md`) | Counts who *pays* for a spawn. No overlap with who *authorised* it; the two paths state the boundary in §1. |
| `unknown-money-as-zero` (21 / 25, `llm-spend-accounting.md`) | Counts `cost.unwrap_or(0)` — a **recording** defect. My §0 "0 means unlimited" is a **ceiling** defect wearing similar syntax. Deliberately not given a second counter; see the declines below. |
| `config-value-frozen-at-compile-time` (4 / 11) · `env-default-conflates-unset-with-empty` (4 / 4) | Both about environment-sourced config. `PERSONAS_RUN_BUDGET_ENFORCE` (§7.C) is arguably theirs; not re-counted here. |
| `unraced-loop-wait` (12 / 13, `background-loop.md`) · `process-global-caches-a-failure` (3 / 4) | Loop mechanics. Checked; no overlap with the admission verdict. |
| `discarded-guard-verdict` (7 / 11, `conditional-write.md`) | Counts a compare-and-set whose row count is dropped. Adjacent in spirit — a guard whose outcome is unobservable — but disjoint in syntax and files. |
| `nullable-default-column` (4 / 27) · `constraintless-table-declaration` (6 / 15) | Both walk the same DDL my declined C3 below would have. Checked: neither counts a status column's expiry. |

### The semantic conditions, stated stack-free

**C1 — an autonomy verdict is computed somewhere other than the one function that owns it.** *Gated
below.*

**C2 — a ceiling's unconfigured value means "no ceiling".** *Designed, measured, REJECTED on
precision — see below.*

**C3 — a hold that only a human can release carries no clock.** *Designed, measured, REJECTED
because the census cannot assert an absence and the positive control is structurally zero — see
below.*

**C4 — an autonomous lane starts work with no admission check at all.** *Not gated; see below.*

**C5 — a declared autonomy flag has no consumer.** *Not gateable by counting; specification for a
different instrument given below.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C2 (a ceiling that permits when unset) — built, run, rejected at ≤50% precision.** Anchoring on a
  ceiling-named identifier compared to zero whose branch permits
  (`(?:cap|ceiling|limit|budget|quota|max_\w+|threshold)\w*\s*(?:==|<=)\s*0(?:\.0)?\s*(?:\|\||\{\s*(?:return\s+)?(?:true|Allow))`)
  scores **4 matches / 3 files**, of which `queue.rs:157` and `:215` are true positives and
  `schema_vocabulary.rs:165` and `tier_usage.rs:88` are unrelated arithmetic. The inverted control
  (the zero branch **refuses**) scores **0 — there is not one instance in 963 files** — so the rule
  cannot be positive-controlled, and per the doctrine a control of ~0 is a stop sign. Widening to
  `None => Allow` scores **25 matches / 22 files** against **23 / 20** for `None => false`, i.e. a
  ratio of **1.09×**, which measures "does this code use `Option`" and nothing else. **Refusing is
  the finding**, and the reason is instructive: "unlimited" is not one syntactic fact — it is `0`,
  `0.0`, `None`, a `.filter(|v| *v > 0.0)` and a `matches!` guard, and the five sites chose five
  spellings precisely because no type named the concept. **The right instrument is
  `Ceiling<T>` (Type-over-gate move 2), not a matcher.**
- **C3 (a clockless human hold) — built, run, rejected twice.** First form (any `status TEXT …
  DEFAULT '<hold token>'` in a `CREATE TABLE` with no expiry column in the same statement): **30
  matches / 6 files** against an anchor population of 33 — a beautiful partition and **~27%
  precision**, because `pending` on `lab_eval_results`, `persona_events` and `dev_kpis` is a machine
  queue state, not a human hold. Second form, narrowed to the unambiguous human-verdict vocabulary (a
  status list containing both an approval verb and a refusal verb): **4 matches / 4 anchor matches,
  100% precision** — `pending_trigger_fires`, `twin_pending_memories`, `automation_suggestions`,
  `policy_proposals` — with a positive control (the same anchor **with** an expiry column) of
  **exactly 0.** Four matches in one file, a control of zero, and a condition that is an **absence**:
  three independent reasons the census is the wrong host. §8.3's fix is a type
  (Type-over-gate move 3) and the instrument that would catch it is a **migration test** asserting
  that every table registered in a `HUMAN_HOLD_TABLES` list has an `expires_at` column — one
  `#[test]`, not a ratchet.
- **C4 (an ungated autonomous lane) — measured and declined.** An `impl ReactiveSubscription for X`
  whose block contains no `autonomy::` scores **27 of 39** production impls; the compliant half is
  **12**. A clean partition of the whole anchor, and a **~37% precision** gate, because TTL eviction,
  ambient-context relay and healthcheck sweeps are correctly ungated. Narrowing is not possible from
  the impl block: **every one of the 27 delegates its work to a free function in another module**, so
  the matcher cannot see whether the tick spends money. §7.B's list goes to the backlog as **named
  fixes, not a ratchet**.
- **C5 (a flag with no consumer) — not gateable, and the specification for what would catch it.**
  "This constant is referenced only by its own accessor" is a whole-program reachability question, not
  a regex. The instrument is a `#[test]` in `settings_keys.rs` that, for every key in `ALLOWED_KEYS`
  and `ALLOWED_PREFIXES`, greps the tree for a reader outside `settings_keys.rs` and the key's own
  IPC handler, and fails with the orphan list. It would have caught `auto_optimize`, `health_watch`,
  and both quarantined `AUTONOMOUS_*_TRIAGE` keys on the day they became orphans. Filed as backlog
  item 12.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "autonomy-verdict-outside-the-front-door",
      "goldenPath": "docs/concepts/golden-paths/autonomy-gating.md",
      "title": "A 'may this run unattended' verdict computed from raw config instead of engine::autonomy",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:settings(?:_repo)?::(?:get|get_by_prefix)\\s*\\([^;]{0,160}?(?:COMPANION_AUTONOMOUS_MODE|AUTONOMOUS_[A-Z0-9_]+|AUTOPILOT_MODE_PREFIX)\\b|autopilot::(?:load_modes|cap_enabled)\\s*\\(|AutopilotMode::parse\\s*\\()",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a site that answers 'may this act unattended (for this project)' from raw configuration — either a direct app_settings read naming an autonomy key, or a direct call into the per-project autopilot primitive — instead of calling engine::autonomy, the module that exists to answer it once. PROXY FOR the stack-free condition: the same autonomy question is computed in more than one place, so two subsystems can disagree about whether an unattended action is permitted, and the disagreement is invisible because both answers look reasonable in isolation. PRECISION 5/5, every match opened and confirmed; the two DIVERGENT ones are the point — overnight.rs:555,660 and pattern_miner.rs:232 treat 'this project has no autopilot row' as OFF, while autonomy::is_allowed treats it as 'follow the global flag' (autonomy.rs:24-31), so one project can be simultaneously permitted and refused for the same capability. The other two (chat.rs:182, message_triage.rs:70) are byte-for-byte re-implementations of Action::CompanionMaster; autonomy.rs:63-67 calls the first 'a thin wrapper' and it neither imports nor calls the module. The POSITIVE CONTROL is what makes this a fact rather than a taste judgement: the same verdict taken THROUGH the front door scores 24 matches across 2 files, so the two rules partition the tree's 29 autonomy verdicts 5/24 and the count measures WHERE THE DECISION IS MADE, not 'how much autonomy code exists'. RECALL is deliberately partial and one gap is named: companion::night_shift::enabled (night_shift/mod.rs:257) gates what its own key docstring calls 'the most autonomous surface in the app' by reading COMPANION_NIGHT_SHIFT, which is not an AUTONOMOUS_* key and not an Action, so it is invisible here — that key should be promoted into the Action enum, at which point this rule sees it. PRECONDITION (must be re-derived per repo): this repo HAS a single autonomy front door (engine/src/autonomy.rs) with 13 named actions and a written precedence rule. Four of the five sibling repos audited for this path have no such module at all — their equivalent condition is present at far greater scale and scores ZERO here, which is why none of them has this rule and why an adopting repo must key on its own chokepoint instead."
      },
      "exclude": [
        { "path": "src-tauri/engine/src/autonomy.rs", "reason": "the front door itself — it is where the raw read is supposed to happen" },
        { "path": "src-tauri/engine/src/autopilot.rs", "reason": "the per-project primitive the front door delegates to and re-exports" },
        { "path": "src-tauri/src/commands/infrastructure/autopilot.rs", "reason": "the human-facing IPC read/write surface for the mode itself: AutopilotMode::parse here validates an operator's WRITE, it is not an unattended verdict" }
      ],
      "baseline": { "files": 4, "matches": 5 },
      "floor": 900
    },
    {
      "id": "autonomy-verdict-outside-the-front-door-positive-control",
      "goldenPath": "docs/concepts/golden-paths/autonomy-gating.md",
      "title": "Positive control — the same verdict taken THROUGH the front door",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "autonomy::(?:global_enabled|is_allowed|load_modes|any_enabled)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT half of autonomy-verdict-outside-the-front-door: the identical decision, taken through engine::autonomy. Scores 24 matches across 2 files (subscription.rs x23, deliberation.rs x1) against the violating rule's 5 across 4. It must stay materially non-zero and must not overlap the violating set: together they are the complete population of autonomy verdicts in the tree, so a violating count that rose while this fell would mean adoption regressed rather than that new code appeared. It carries NO baseline by design — a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "exclude": [
        { "path": "src-tauri/engine/src/autonomy.rs", "reason": "the front door itself — its own definitions are not call sites" }
      ],
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, hand-verified, fault-injected six ways, positive-controlled, re-extracted

Run against a private registry (never `scripts/census/rules.json`, per the contract's
concurrent-writer warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — **4 files / 5 matches / 963 walked / floor 900** · **exit 0** |
| Runtime | **~1 s** for both rules. No lookbehind; the only unbounded construct is `[^;]{0,160}`, a tempered class that cannot leave its statement |
| Precision | **5/5** — all opened: `overnight.rs:555`, `overnight.rs:660`, `chat.rs:182`, `message_triage.rs:70`, `pattern_miner.rs:232` |
| False positive found and excluded | `commands/infrastructure/autopilot.rs:47` — `AutopilotMode::parse` validating an **operator's write**, not an unattended verdict. Excluded with that reason; precision went 5/6 → 5/5 |
| **Positive control** — the same verdict through the front door | **24 matches / 2 files** vs 5/4. The two rules **partition all 29 autonomy verdicts in the tree** |
| Fault: baseline `3/4` (a new bypass appears) | `[drift] files rose 3 -> 4 (+1)`, `matches rose 4 -> 5 (+1)` · **exit 1** |
| Fault: baseline `5/6` (a silent drop) | `[drift] files dropped 5 -> 4 (-1) without the baseline moving` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `zero-matches` + all three stale-exclude errors · **exit 1** |
| Fault: an `exclude` entry matching nothing | `[structural] exclude "src-tauri/src/engine/gone_module.rs" matched no file. The exemption is stale` · **exit 1** |
| Fault: an `exclude` with a one-word reason | `exclude[3] needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` at `validateRule` · **exit 1, 0 rules scanned** |
| Fault: the positive control given a `baseline` | `a positive control must NOT carry a baseline` at `validateRule` · **exit 1, 0 rules scanned** |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 4 files / 5 matches / 24 control matches / exit 0** |

The positive control is the load-bearing check. Violating and compliant here do not share a syntactic
anchor — that is the *nature* of this condition, since the compliant form's whole point is that the
key never appears at the call site — so the partition is semantic rather than lexical: **5 + 24 = 29
is the complete set of places in 963 files where this application decides whether something may act
unattended.** A count that is a stable fraction of a known-complete population is stronger evidence
than a ratio, because it makes the denominator auditable: if someone adds a fourteenth `Action`, the
control rises; if someone adds a sixth bypass, the violating count rises; and only one of those two
fails the build.

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files means a repo whose `roots`/`extensions` no longer describe it
reports **"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than a clean run. The
`zero-matches` structural check means a port to a repo with no autonomy chokepoint fails immediately
rather than baselining at 0 — which is the correct outcome, because in `vibeman` the condition is
present **eleven times over** in different syntax and this proxy cannot see any of it. The three
`exclude` entries all name real files and each carries a prose reason the runner enforces, so a
refactor that moves the front door breaks the build instead of silently exempting the tree.

### Where the gate executes

`npm run census:check`, which runs from a developer shell and from the repo's pre-push hook — **not**
from `ci.yml`, which has 0 successes in 260 all-time runs. `npm run census` prints surviving counts on
success, so a passing run is distinguishable from one that checked nothing.

### The census cannot express "must be zero"

This condition **should** reach zero: there is no legitimate reason to answer this question outside
the module built to answer it. `assertRule` treats a zero-match rule as a structural failure (*"a rule
pinned at 0 is a gate that can never fail"*), so the correct sequence is: land Type-over-gate move 1
(§8.1's `ProjectOnly` precedence mode retires 3 of the 5 by itself), ratchet 5→4→3→2→1 with
`npm run census -- --update`, and when the last one lands, **delete the rule and this section** and
let `autonomy::resolve`'s private field keep it there — which is the type doing the work the gate was
renting.

---

## 12. Corrections to the brief

**1. The `convergence: converged` label HOLDS — but only if you read it as a convergent *failure
mode*, and one clause of the brief's framing inverts under measurement.** The oracle found no clause
where five repos independently converged on the *right* answer to autonomy gating. It found four
where they converged on the same **mistake**: the autonomous lane bypasses the admission spine (5/5),
the kill switch stops starts but not running work (5/5), the outer enumeration loop is uncapped
(5/5), and no human hold expires (5/5). It found genuine physics on three narrower things:
string-equality opt-in so an unset value cannot read as permission (4/5), a small inner concurrency
cap near 4 (5/5), and a circuit-breaker threshold of 5 (3 repos, independently). **Nothing was
SILENT** — every clause has traces in every repo. So `converged` is the right label and the wrong
intuition: it does not mean "the practice is settled", it means "the mistake is structural rather than
cultural", which is a stronger and more actionable result.

**2. "Is there a single place that answers 'may this act unattended right now', or is the decision
re-derived at each site?" — the brief's either/or is the wrong shape, and the answer is the most
valuable thing in this sweep.** There **is** a single place, it is well-built, and it is used for
**24 of 29** verdicts. The five exceptions matter not because five is a lot but because **two of them
implement a different precedence rule** — `overnight.rs` and `pattern_miner.rs` treat "this project
has no autopilot row" as *off*; `autonomy::is_allowed` treats it as *follow the global flag*. A brief
that asks "one place or many?" gets a number. The question that produced the finding is **"do the
copies agree, and on which input do they diverge?"** — and the answer is that they agree on every
input a human would test and disagree on the unconfigured one, which is the only input an unattended
system ever actually sees. Recommend adding that question to future briefs.

**3. "What is the default when the answer is unknown or the config is missing — permit or refuse?
Measure it, don't assume." — measured, and the answer is BOTH, on two axes, in one file.**
**17 of 17** autonomy `*_DEFAULT: bool` are `false`; **2 of 2** dollar-ceiling `*_DEFAULT: f64` are
`0.0` meaning *no ceiling*, and the same permissive reading of "unset" repeats at five ceiling sites
in three more spellings. The switch discipline in this repo is the best of the six codebases audited.
The ceiling discipline is its exact inverse. Asking the question once, as the brief does, produces
"fail-closed, good" and misses the entire cost exposure — the accelerator and the brake have to be
measured separately.

**4. "`unattended_mode` is a column on `persona_triggers` … Find out who reads it and what the values
mean." — the lead survives, and the answer is that reading it is not the problem.** Four readers,
all correct (`background.rs:1393, 1551, 2878`; `system_ops.rs:138` on its own table). The findings are
elsewhere: **all 351 live rows are `auto`**; the gate covers **39 of 351 rows (11%)** because 244 are
`event_listener`/`chain` types it does not apply to and **0 are webhook**; the frontend renders the
control for `polling`, which the backend does not honour; and the `dry_run` branch's precondition
(`source_type ∈ {"trigger","webhook"}`) is satisfied by **0 of 4,972 live events**, so it has never
once evaluated true. **The column is fine. The gate has never run.**

**5. "A `GLOBAL_MAX_CONCURRENT = 4` exists on one lane; a sibling path found that in 5 of 5 repos a
second concurrency lane is left uncapped." — confirmed, sixth repo, and there is a sharper version.**
This repo has five lanes that start work and **two** with no cap at all (headless model calls, and
every subscription tick's aggregate). But the more useful finding is that `GLOBAL_MAX_CONCURRENT = 4`
is **not the runtime value** — `MAX_PARALLEL_EXECUTIONS_DEFAULT = 10` is (`settings_keys.rs:580`; the
const is documented as "only the no-pool/test fallback"). And `has_global_capacity` treats **0 as
unlimited** (`queue.rs:157`), so the operator's obvious "set it to zero to stop everything" is an
inversion — currently unreachable from the UI only because `MAX_PARALLEL_EXECUTIONS_MIN = 1`.

**6. "The scheduled-trigger pipeline has not fired since 2026-05-28, so anything gated on a schedule
firing has not been exercised." — true, and understated.** The unexercised set is much larger than
schedules: `pending_trigger_fires` 0 rows, `is_simulation = 0` on all 2,188 executions,
`circuit_breaker_state` 0 rows, `autopilot_night_runs` 0, `dev_auto_runs` 0, `run_budgets` 0,
`incident_diagnoses` 0, `automation_runs` 0, `automation_suggestions` 0, `policy_proposals` 0,
`evolution_cycles` 0, `budget_alert_rules` 0, `desktop_connector_approvals` 0,
`companion_night_plan` 0, `companion_night_event` 0, and **0 `autopilot_mode:` settings rows**. The
Night Shift — which its own key docstring calls *"the most autonomous surface in the app"* — has never
produced a single row. This is not a criticism of the code; it is the reason §8.6 exists, because the
only way I learned any of it was to copy the database and count.

**7. "Kill switch: is there one, does it reach in-flight work, and has it ever been exercised?" — no,
no, and no; but the brief's three-part question missed the interesting fourth part.** There are four
partial stops and none abandons running work. What the brief did not ask, and what the live data
answered, is the **inverse**: *does anything stop that should not?* **Eleven team assignments have
been stopped for 68 days**, waiting on a human, with no clock, no escalation and no report — while a
sibling queue auto-resolves after 7 days including **17 high-severity items**. An autonomy audit that
only looks for runaway action will pass a system that has silently stopped, and stopping silently is
the failure this operator actually experienced.

**8. "Does anything escalate — an agent that can grant itself more autonomy?" — no, and the negative
result deserves to be recorded as a property worth defending.** 31 `settings::set` call sites; exactly
two write an autonomy verdict; the automatic one (`overnight.rs:411`) writes only a **downgrade**;
`settings::set` validates key and value and audits the prior value; the MCP tool surface contains no
settings write at all; the management API is behind scoped bearer tokens. `vibeman` shows what the
absence of this discipline costs — an MCP tool posting to an unauthenticated `/api/ideas/approve`,
letting the agent release the gate that was holding it. **But the property here is held by 31
individually-correct call sites, not by a type** (§8.4), so it is one careless background write away
from being false, and nothing would notice.

**9. A correction to a sibling path, offered because this sweep re-measured it.**
[`row-to-struct-mapping.md`](./row-to-struct-mapping.md) lists `db/src/repos/system_ops.rs:22` as a
fail-open row mapper. That is correct and this path confirms it — but the doc describes both it and
`:28-31` as "kill-switches defaulting to off-the-brakes" without noting that they are the **only two**
fail-open autonomy reads in 951 non-test files, against 17 of 17 fail-closed defaults. The isolated
finding reads as a symptom of a lax codebase; measured against its population it is a **two-line
outlier in an otherwise exemplary discipline**, which changes both the severity and the fix (patch the
mapper, do not audit the tree). Recorded here rather than edited there, per the parallel-composition
rules.

**10. What the brief did not ask and should have.** The single highest-value measurement in this sweep
was not any of the listed questions; it was **counting the live rows of every table a gate is supposed
to write to.** Fifteen tables at zero rows told me which gates are unexercised, `unattended_mode` at
351/351 `auto` told me the destructive-action gate has never been armed, and one `ORDER BY days_old`
told me eleven pieces of work have been stranded for two months. None of that is visible from the
source. A brief that asks "is the gate correct?" gets a code review. A brief that asks **"how many
times has this gate said no, and to what?"** gets the product.

---

## Backlog

| # | Item | Where | Size |
|---|---|---|---|
| 1 | **Make an unset ceiling refuse instead of permit** — `Ceiling<T>` (Type-over-gate move 2), starting with `budget_verdict`'s `None => Allow` | `overnight.rs:125`, `background.rs:2051`, `queue.rs:157,213`, `run_budget.rs:93`, `settings_keys.rs:357,669` | L |
| 2 | **Add a clock to `team_assignments.awaiting_review`** and sweep it; 11 rows are 59–68 days old right now | `incremental.rs:5793`, new sweep | M |
| 3 | Add `Action::NightShift` for `COMPANION_NIGHT_SHIFT` and route `night_shift::enabled` through the front door | `autonomy.rs:91`, `night_shift/mod.rs:257` | S |
| 4 | Add a `ProjectOnly` precedence mode to `Action`; retire the `overnight.rs` + `pattern_miner.rs` bypasses | `autonomy.rs:144,169`, `overnight.rs:555,660`, `pattern_miner.rs:232` | M |
| 5 | Delete `chat::autonomous_mode_enabled` and `message_triage::triage_enabled`; route 13 callers through `autonomy::global_enabled` | `chat.rs:180`, `message_triage.rs:68` + 12 callers | S |
| 6 | Fix the two fail-open row-mapper defaults | `db/src/repos/system_ops.rs:22,28-31` | S |
| 7 | Delete `auto_optimize:` / `health_watch:` (settings with no consumer), or build the loops they promise | `settings_keys.rs:824-825`, `management_api.rs:100-105,1481-1568` | S |
| 8 | Stop rendering the unattended-mode control for `polling` (the backend does not honour it) | `UnattendedModeSection.tsx:16` | S |
| 9 | Resolve the `dry_run` gate against the **matched** trigger, not the event's source trigger | `background.rs:1551-1556` | S |
| 10 | Gate the startup stale-review GC on an autonomy flag and move its 7-day threshold into `app_settings` | `background.rs:816-836` | S |
| 11 | Give healing auto-retry an `Action` (it is the most-exercised unattended spender and has no flag) | `healing_timeline.rs:274`, `engine/mod.rs:3088` | M |
| 12 | A `#[test]` that fails on any allow-listed settings key with no reader outside its own IPC handler (§9 C5) | `settings_keys.rs` | S |
| 13 | A `gate_decisions(gate, verdict, day, count)` rollup so "this guard has never said no" is a query | new | M |
| 14 | Surface the ten `Action`s that have no UI, or fold them into the autopilot ladder | `src/features/settings/**` | M |
| 15 | Widen `ConcurrencyTracker`'s key to `CallOwner` so subscriptions and headless work share one admission point | `queue.rs:253`, `engine/mod.rs:886` | M |
| 16 | Split `settings::set` so a background path cannot widen autonomy (§8.4) | `settings.rs:95` | M |
| 17 | Make `AutopilotMode::allows`'s `Full` arm exhaustive so a new capability is an explicit grant | `autopilot.rs:116` | S |
| 18 | Add a real kill switch: one command that both stops admission and cancels in-flight autonomous work | `background.rs:908`, `engine/mod.rs` | M |
