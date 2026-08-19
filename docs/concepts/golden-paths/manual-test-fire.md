# Manual test fire

> Situation node: `product-surfaces/authoring-and-catalogs/manual-test-fire` ·
> [situation spine](../situation-spine.md) · recurrence 5 · risk **medium** ·
> dimensions: ui · function · cost · resilience · `sides: "client"` ·
> `twoSided: true` · `convergence: "mixed"`
>
> *"Running a saved automation once now and reporting pass/fail, cost and
> duration."*
>
> **Short form** (Mode 2 tiering: `medium` risk, recurrence < 9). Prose is
> compressed; measurement is not. Composed 2026-08-17 from an exhaustive sweep of
> every "run it now / test it" affordance in the repo — **52 distinct doors** —
> plus `src/` (4,801 `.ts`/`.tsx`), `src-tauri/` (963 `.rs`), the 133-file
> template catalog, and the pre-purge backup
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`.
>
> Row-derived numbers are historical as of 2026-08-17 and unreproducible.

> **Post-publication note — 2026-08-17: `null-spinner-busy-state` under-reports by ~35%.**
> Measured hours after publication by the `connector-setup-panel` composer: the baseline
> (50 files / 68 matches) **misses 27 files / 30 matches** written in the Prettier-wrapped
> `? (` form and 6 more in the `&&` form. Among the missed sites is
> `ConnectionTestSection.tsx:43` — **the repo's primary "Test connection" button**, which is
> this leaf's own subject. Same repo, same defect, invisible because of where the formatter
> put a line break.
>
> **The baseline is NOT wrong and has not been re-based here.** It is the count of one
> spelling, and widening an anchor owes a full re-validation and a fresh precision figure —
> a rule quietly widened between waves is not reproducible. The suggested pattern is in
> [`connector-setup-panel.md`](./connector-setup-panel.md) §12.3; adopting it is owed work,
> not a silent edit. Same disposition as [`live-log-stream-view.md`](./live-log-stream-view.md)'s
> recall limit, recorded the same day for the same reason.

---

## §0 Headline

**A trigger's "Test fire" button does not fire the trigger. It calls
`execute_persona` directly, while a real fire publishes an event that the event
bus converts into a run — and the event bus creates that run with `trigger_id:
None`, three lines after reading the firing trigger's id out of
`event.source_id`. So the test button is the *only* writer that would ever
populate `persona_executions.trigger_id`, and the column is NULL in 2,188 of
2,188 rows.**

The two paths, side by side:

| | real fire | "Test fire" button |
|---|---|---|
| entry | `engine/background.rs:2906` `event_repo::publish(… source_type: "trigger", source_id: Some(trigger.id) …)` | `useTriggerOperations.ts:131` `executePersona(pid, triggerId)` |
| schedule advance / `mark_triggered` | yes, before publishing | **no** |
| `unattended_mode == "approval"` hold | yes — `background.rs:2878`, fire held for human approval | **no** — runs immediately |
| `unattended_mode == "dry_run"` → `is_simulation` | yes — `background.rs:1552-1570` | **no** — `execute_persona` passes `is_simulation: false` (`executions.rs:169`) |
| payload | `synthesize_trigger_fired_payload(&trigger, &cfg, &now)` when the author set none | **none at all** |
| downstream event subscribers | yes | **no** — nothing is published |
| `persona_executions.trigger_id` | **`None`** (`background.rs:1561`, `:1572`) | the trigger's id |

Both halves of the last row are wrong in opposite directions, and together they
empty the column: the automatic path drops the id it has, and the manual path is
the only one that supplies it. Then `listExecutionsByTrigger` — the query behind
the trigger drawer's own **Activity** panel (`useTriggerDetail.ts:105` →
`TriggerExecutionHistory.tsx`) — reads exactly that column. **A trigger's
activity log can only ever show runs produced by the test button, and on this
install it has never shown anything.**

Second measured absence: **`is_simulation = 0` in 2,188 of 2,188 rows.** The flag
has a column, a dedicated index (`idx_pe_simulation`), a field on two ts-rs
bindings, a UI badge (`ExecutionListRow.tsx:77`), a list filter
(`ExecutionList.tsx:133,137`), three metrics queries that exclude it
(`metrics.rs:498,535,623`), and eight `if ctx.is_simulation` branches in
`engine/dispatch.rs`. Five callers pass `true`. **None of them is a test-fire
control that a user presses on a saved automation.**

Third: **the operator's standing rule is honoured.** 0 of 133 shipped template
JSON files declare a `manual` trigger; the catalog's only concrete trigger
declarations are `skill-librarian.json:160` (`schedule`) and `:167`
(`event_listener`). `"manual"` appears in the tree only as an adoption fallback
(`template_adopt.rs:448` `.unwrap_or("manual")`), importer defaults
(`zapierParser.ts:81`, `githubActionsParser.ts:107,202`), a validation arm
(`triggers.rs:593`), four repo tests, and six dev scripts outside the shipped
catalog.

---

## §2 The one way (compact)

**A manual fire goes through the production door with a source tag, not around it
— and the row it produces says it was a test.** Concretely:

1. **Call the same function the automatic path calls, differing only by an
   argument.** The repo's own best examples: `system_ops_run_now`
   (`system_ops.rs:155`) is `run_op(&app, &db, &kind, &params, "manual")` against
   the scheduler's `run_op(app, pool, &kind, &params, "schedule")`
   (`engine/system_ops.rs:370`) and the event path's `"event"` (`:433`) — one
   string apart, three callers, one body. `rotate_credential_now`
   (`rotation.rs:140`) is `rotate_now(&db, &id, "manual")` against the anomaly
   path's `rotate_now(…, "anomaly_remediation")` (`engine/rotation.rs:824`).
   `resolve_pending_trigger_fire` (`triggers.rs:207`) calls the identical
   `event_repo::publish` the scheduler calls. **If your manual door has its own
   body, it tests its own body.**
2. **Reuse the payload builder, don't improvise a payload.** `backfill_schedule`
   (`scheduler.rs:364`) calls `background::synthesize_trigger_fired_payload` —
   the live one — and a test pins that it does (`:418`). A manual fire with no
   payload is not a test of a trigger that normally arrives with one.
3. **Mark the run.** The discriminator must be on the *row*, set by the door, not
   inferred later from a name or a null. This repo has the right column
   (`persona_executions.is_simulation`) and the right shape
   (`execute_persona_inner(…, is_simulation: bool)`); a manual test door passes
   `true`, exactly as `simulate_use_case` does (`use_cases.rs:648`). Without it
   the run enters cost, success-rate and activity metrics as production traffic —
   which is the whole reason the three `COALESCE(is_simulation, 0) = 0` clauses
   in `metrics.rs` exist.
4. **Carry provenance both ways.** The run row records *which* saved definition
   produced it (`trigger_id`, `use_case_id`, `source_recipe_id`) whether the fire
   was manual or automatic. Two paths that agree on the run but disagree on the
   provenance leave the definition's own activity view unable to find its runs.
5. **Make it idempotent on the request, not on the attempt.** Per
   [`idempotent-invocation`](./idempotent-invocation.md) §2 — derive the key from
   what is being asked (`format!("test-fire:{trigger_id}:{minute}")`), never from
   a fresh UUID. §7 D4 measures what happens when you don't.
6. **The busy state is a real spinner on the control.** Per
   [`inline-busy-state`](./inline-busy-state.md): `AsyncButton`, or
   `Button loading={flag}`. **Never `feedback/LoadingSpinner`, which renders
   `null`.** §9 gates this; the test-fire button itself is one of the 68.
7. **Validate before you spend, and say which check failed.**
   `useTriggerOperations.ts:119-128` does this well — it calls `validate_trigger`
   first and, on failure, returns the failing checks joined by label rather than
   a generic message. Copy that half.
8. **Report what the run cost.** The leaf's own `why` asks for "pass/fail, cost
   and duration". §7 D5.

---

## §7 Deviations

52 doors were enumerated across seven families (trigger, recipe, schedule,
connector/credential, persona/lab, chain/automation/build, alert/webhook/event).
The deviations below are the ones where the manual door and the real door differ
in a way the user cannot see.

### D1 — P0. The trigger test fire and the trigger's real fire are different code paths

Detailed in §0. The manual path skips `mark_triggered`, the approval hold, the
`dry_run` → simulation conversion, the rate-limit key, the active-hours window
and the event fan-out; it adds a `trigger_id` the automatic path does not set.
The consequence a user can observe: pressing "Test fire" on a trigger whose
`unattended_mode` is `"approval"` **runs it**, when the same trigger firing on
its schedule would have been held for approval (`background.rs:2878-2903`). The
control's tooltip is `t.triggers.validate_and_fire_title`; nothing says the
safety mode is bypassed.

### D2 — P0. `persona_executions.trigger_id` is dropped by the path that has it

```rust
// engine/background.rs:1552-1558 — the id is read here…
let dry_run = matches!(event.source_type.as_str(), "trigger" | "webhook")
    && event.source_id.as_deref()
        .and_then(|sid| trigger_repo::get_by_id(pool, sid).ok())
        .map(|t| t.unattended_mode == "dry_run").unwrap_or(false);

// …and discarded here, at both creation sites (:1561 and :1572)
exec_repo::create_with_idempotency(pool, &persona.id, None, /* trigger_id */ …)
exec_repo::create(pool, &persona.id, None, /* trigger_id */ …)
```

Both `exec_repo::create*` take `trigger_id: Option<String>` as their third
parameter. The column is declared `REFERENCES persona_triggers(id) ON DELETE SET
NULL` — a foreign key maintained for a value nothing writes. **2,188 of 2,188
rows NULL** in the backup, across an install that held 351 triggers.

This corroborates, from a second direction,
[`scheduled-trigger-firing`](./scheduled-trigger-firing.md)'s finding that
`get_due` returns zero rows: even if it had returned rows, the executions would
not have been attributable to the triggers that produced them.

### D3 — P0. The simulation flag exists, works, and no test control uses it

Five callers pass `is_simulation: true`: `simulate_use_case`
(`use_cases.rs:648`), `simulate_build_draft` (`build_simulate.rs:339`),
`synthesize_review` (`synthesize_review.rs:108`), the event bus's `dry_run`
branch (`background.rs:1569`), and nothing else. Ten pass `false`, including
`execute_persona` (`executions.rs:169`) — the door behind the trigger **Test
fire**, the schedule **Run now** (`useScheduleActions.ts:49`), the command
palette, the capability **Run now**, the execution re-run and onboarding.

`use_cases.rs:982-991` contains a source-scanning test asserting that
`dispatch.rs` still branches on `ctx.is_simulation`, i.e. the contract is
defended. What is undefended is the *set of doors that should set it*. That is
the doctrine's "a thing that was never declared": no signature is short a
parameter — `execute_persona_inner` takes the flag and every caller supplies one
— and only an inventory of *which doors are tests* finds the gap.

Measured cost of the omission: 0 rows carry the flag, so the three metrics
exclusions and the `ExecutionList` filter have never removed a row, and the
`ExecutionListRow.tsx:77` badge has never rendered.

### D4 — P1. The idempotency key is generated per attempt, and its comment claims otherwise

```ts
// src/api/agents/executions.ts:60-68
// … Default one here so every call is at least self-dedup'd against a
// concurrent duplicate (double-click, double-fire, React re-invoke) even
// when the caller didn't think to pass one.
const resolvedKey = idempotencyKey ?? crypto.randomUUID();
```

A fresh UUID per call cannot collide with itself, so **both** dedup layers are
inert: the client in-flight map (`tauriInvoke.ts:336-345`, keyed on the same
value — and whose own docstring at `:301` correctly calls it *"a per-attempt
key"*) and the server's `get_by_idempotency_key` pre-check
(`db/src/repos/execution/executions.rs:543+`). Of 20 `executePersona` call sites,
**one** passes an explicit key (`chatSlice.ts:244`) and it passes
`crypto.randomUUID()` too.

The double-click is nonetheless blocked at the trigger drawer, by
`disabled={detail.testing}` (`TriggerDetailDrawer.tsx:87`) plus the
`setTesting(true)` at `useTriggerDetail.ts:51`. So the *guard that works* is a
React boolean, and the *guard that is documented to work* does nothing. That is
worse than an unguarded door, because the comment is what a reader trusts when
they add the 21st caller.

This is a §12 correction owed to
[`idempotent-invocation`](./idempotent-invocation.md), whose §2 states the rule
this site inverts.

### D5 — P1. The leaf asks for "pass/fail, cost and duration"; the test fire reports none of the three

`handleTestFire` (`useTriggerDetail.ts:57-63`) surfaces
`Config OK. Execution {id.slice(0,8)} started` — a *started* message, from the
row `execute_persona` returns before the run completes. There is no follow-up:
no subscription to the execution's terminal status, no cost, no duration, and the
message self-clears after 8 seconds (`:68`). The Activity panel that would show
the outcome reads `trigger_id`, which is empty (D2). So a user who presses Test
fire learns that a run *started* and has no path back to what it did.

The competing door does better: `simulate_use_case`'s control
(`UseCaseRow.tsx:191-209`) carries the tooltip *"Simulate — real API calls, no
notifications delivered"*, which is the honest statement of what a test costs.

### D6 — P1. `test_automation_webhook` skips the runnable gate its production twin applies

`trigger_automation` (`automations.rs:155`) checks `is_runnable()` at `:164`
before calling `invoke_automation`. `test_automation_webhook` (`:188`) calls the
same `invoke_automation` (`:214`) with a generated sample payload
(`generate_sample_payload(schema)`, `:209-211`) and **no** `is_runnable()` check.
Its own comment (`:195-199`) is admirably clear that *"a 'Test' fires a REAL
outbound webhook"* and that it shares the in-flight guard. The gap is narrower
than D1 but the same shape: the test path is permitted something the real path
is not, so a webhook that the product would refuse to fire can be fired from the
test button.

### D7 — P2. Four "test" doors have no reachable UI

`run_prompt_ab_test` (`prompt_lab.rs:187`), `test_channel_delivery`
(`notifications.rs:1251`), `send_digest_now` (`digest.rs:40`) and
`openapi_playground_test` (`openapi_autopilot.rs:793`) all have API wrappers in
`src/api/**` and **zero frontend call sites**. `send_digest_now` is the notable
one: it is the *correct* shape (`digest.rs:45` calls the same
`digest::deliver_digest` the schedule calls) and nothing can invoke it.

### D8 — P2. The lab "Test" is a separate execution engine, correctly, and nothing says so

`start_test_run` (`commands/execution/tests.rs:37`) builds an `EphemeralPersona`
and runs `engine/src/test_runner.rs:232` — not the pipeline at all. That is the
right call for a scoring harness, and it means the **Test** button
(`UseCaseDetailPanel.tsx:152-160`) and the **Run now** button (`:167-182`, which
`useManualPersonaRun.ts:33-38` documents as *"the production `execute_persona`
IPC directly: real CLI spawn, real cost"*) exercise two different engines. They
sit adjacent in the same toolbar with the labels `uc.test` and `uc.run_now`. The
deviation is not the design; it is that nothing on the surface distinguishes
"runs the real thing" from "runs a harness that approximates it".

### D9 — P2. The test-fire control's busy state renders nothing

`TriggerDetailDrawer.tsx:91` —
`{detail.testing ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}`,
importing `feedback/LoadingSpinner` at `:3`. That component renders `null` (it
emits only an `sr-only` `role="status"` when given a `label`, which this call
does not pass). While a test fire is in flight the `Play` icon disappears and
nothing replaces it; the only remaining signal is the label swapping to
`t.triggers.detail.validating`. The dry-run button two lines down (`:102`) does
the same. §9 measures the class.

---

## §9 The rule

### Declined: a gate on "a test door that reaches the production executor without a discriminator"

The honest signal is `execute_persona_inner(…)` / `create_with_idempotency(…)`
reached from a function whose name marks it a test — and
[`idempotent-invocation`](./idempotent-invocation.md)'s `unkeyed-billable-spawn`
already anchors on exactly those two symbols with `None` arguments. A second rule
on the same anchor would collide at the site level on precisely this leaf's
sites. Refused for overlap, which the doctrine records as a respectable §9.

### Declined: a gate on `trigger_id: None` at an execution-creation site

Two sites (`background.rs:1561`, `:1572`). Below threshold, and the compliant
form is a variable name rather than a shape, so no pattern separates "dropped the
id" from "genuinely has no trigger" — which is the majority of runs.

### Published: `null-spinner-busy-state`

**The condition the signal is a proxy for:** *a control the user just pressed
shows no busy affordance at all, because its busy branch renders a component that
returns `null`.* In this repo the proxy is `<LoadingSpinner/>` as a ternary
consequent; an adopting repo re-derives its own (any compatibility shim rendered
where a real indicator is intended). The condition — **an action's busy state
must be visible on the action** — travels; `LoadingSpinner` does not.

**Shared territory, declared.** [`inline-busy-state`](./inline-busy-state.md)
owns this doctrine and its rule `hand-rolled-spinner` anchors on `animate-spin` —
the *opposite* defect (a spinner built by hand instead of used from the
primitive). `<LoadingSpinner .../>` contains no `animate-spin`, so **site-level
overlap is 0 by construction**, checked against all 184 rules in `rules.json`.
The rule is filed here because this leaf's headline control
(`TriggerDetailDrawer.tsx:91`) is one of its matches and because a test-fire
button with no visible busy state is the specific way this leaf fails: the user
presses it, nothing changes, and the guard that prevents the second press is
invisible.

**Why a type does not reach it.** Q4 — a type anyone can construct authenticates
nothing: `LoadingSpinner` is a legal `FC` and `{flag ? <A/> : <B/>}` is a legal
`ReactNode` in every arrangement. Q5 (withholding) *would* reach it — deleting
`feedback/LoadingSpinner` makes the bad state unspellable — but that is a
**destructive apply** across 178 files and belongs to `inline-busy-state`'s
owner, not to a short-form path. Recorded in the deferred-fixes register
instead; the gate is the ratchet that holds the line until it lands.

**Fail-loud.** `floor: 4000` — the `src/` walk must see at least 4,000
`.ts`/`.tsx` files (it sees 4,801).

**Two implementations, and they disagreed in both directions.** (A) a
whole-file-content scan for `? <LoadingSpinner …/> : <` → **68 sites / 50
files**. (B) an independent per-line tokeniser (find `?`, require `LoadingSpinner`
after it, require the text after the following `:` to start an element) → **65
sites / 48 files**. Membership diff: **4 in A only, 1 in B only. Neither is a
superset**, and each miss has a single cause:

- The 4 A-only sites (`EventLogList.tsx:249`, `ConnectorsSection.tsx:218`,
  `SearchChipInput.tsx:44`, `TriggerExecutionHistory.tsx:100`) are the *same
  ternary formatted across three lines*, with `?` and `<LoadingSpinner` on
  different lines. B cannot see them because it reads lines. This is the
  doctrine's *"match against whole file content, never line-by-line"* rule with
  a measured price attached: **4 of 69, or 5.8%, invisible to a line-oriented
  matcher purely because Prettier wrapped them.**
- The 1 B-only site (`MemoryPanelList.tsx:137`) wraps the consequent in a
  fragment — `{loadingMore ? (<><LoadingSpinner size="xs"/>{t.common.loading}</>) : <>…</>}`
  — so A's `\/>\s*:` never meets a `:`. It is a true instance (the spinner still
  renders nothing; only the adjacent text survives) and **the published rule
  cannot see it.**

So the true population is **at least 69** and the published baseline is 68. That
is the portability-test failure mode observed at home: *a signal keys on the
markup a deviation happened to wear.* Recorded rather than papered over, and it
is the reason §9's real fix is Q5 (delete the shim) with the gate as the ratchet.

**Hand-verified precision: 6/6** on a sample I opened —
`DeploymentCard.tsx:87` (`testRunning ? <LoadingSpinner size="sm"/> :
<FlaskConical/>` — a *test* control, on this leaf),
`SweepButton.tsx:90`, `RecipeVersionsTab.tsx:209`,
`WebhookRequestInspector.tsx:126`, `ExportSection.tsx:112`,
`MemoryHeaderActions.tsx:29`. All six replace a visible `lucide-react` icon with
a component that returns `null`.

**Positive control** points the same concern at the compliant form —
`<Button>`/`<AsyncButton>` carrying a `loading` prop, whose spinners are real
(`Button.tsx:230,:237`, `AsyncButton.tsx:85`) — and returns **66 matches / 52
files**. A comparable-sized compliant population against 68 violating: the repo
is at roughly 50/50 on this concern, which is what makes it worth ratcheting.
Broader anchor for reference: **247 `<LoadingSpinner` renders across 178 files**,
of which 68 are the ternary busy-state form.

```json
{
  "id": "null-spinner-busy-state",
  "goldenPath": "docs/concepts/golden-paths/manual-test-fire.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\?\\s*<LoadingSpinner(?:\\s[^>]{0,120})?/>\\s*:\\s*<",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A control's busy state rendered as <LoadingSpinner/> in the consequent of a ternary whose alternate is another element — almost always an icon. feedback/LoadingSpinner renders null (it emits only an sr-only role=status when passed a label), so the icon vanishes and nothing takes its place while the action is in flight. Use buttons/AsyncButton (returns-a-promise onClick) or buttons/Button loading={flag}, whose spinners are real (Button.tsx:230,237; AsyncButton.tsx:85). Doctrine: inline-busy-state.md."
  },
  "baseline": { "files": 50, "matches": 68 },
  "floor": 4000
}
```

```json
{
  "id": "null-spinner-busy-state-positive-control",
  "goldenPath": "docs/concepts/golden-paths/manual-test-fire.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "<(?:Async)?Button(?:\\s(?:[^<>]|<[^<>]*>){0,400}?)?\\b(?:loading|isLoading)\\s*=\\s*\\{",
    "flags": "g",
    "description": "POSITIVE CONTROL for null-spinner-busy-state: the COMPLIANT form — a shared Button/AsyncButton carrying a loading flag, which renders a real spinner inside the primitive. 66 sites in 52 files against 68 violating in 50, so the repo is near 50/50 on this concern. A control near zero would mean the violating pattern is keying on ternaries rather than on busy state."
  },
  "floor": 4000
}
```

---

## §12 Corrections

**To the brief.**

1. *"Does the manual fire go through the same door as the real one (if not, it
   tests nothing)?"* — **It does not, and the direction is the opposite of the
   obvious one.** I expected the manual door to be a thin wrapper that skipped a
   guard. It is the *reverse*: the manual door calls the production executor
   **directly** (`execute_persona`), while the automatic path goes the long way
   round through `event_repo::publish` and the event bus. So the manual fire is
   not a stripped-down version of the real fire — it is a **different, shorter,
   more privileged** one. It skips the approval hold, the dry-run→simulation
   conversion and the payload synthesis, all of which live on the event side.

2. *"Does it mark the resulting execution as a test (if not, it pollutes the
   metrics the operator reads)?"* — **It does not, and the pollution is currently
   zero, for a reason that is itself the finding.** `is_simulation = 0` in
   2,188 of 2,188 rows, so nothing has ever been excluded by the three
   `COALESCE(is_simulation, 0) = 0` clauses — but nothing has ever needed to be,
   because no test door sets the flag *and* `trigger_id` is empty, so there is
   nothing in the metrics that a filter could distinguish. The defect is not
   polluted metrics; it is **metrics with no discriminator at all**, which look
   identical to clean metrics.

3. *"Is it idempotent under a double-click?"* — **Yes at the UI, no at either
   layer that claims to provide it.** `disabled={detail.testing}` blocks the
   second click; the idempotency key that the API comment says provides
   "self-dedup against double-click" is a fresh `crypto.randomUUID()` per call
   and provides nothing (D4).

4. *"Templates must never include manual triggers — check whether the seeds
   honour it."* — **Honoured: 0 of 133.** Reported as a positive finding because
   the doctrine's oracle section notes these are rare and worth stating.

5. *"`trigger-wiring-surface.md` and the trigger fix committed this morning are
   adjacent."* — Held, and the primed claim is unchanged by anything here:
   `validate_all()` is the single door, and `useTriggerOperations.testFire`
   correctly calls `validate_trigger` before spending. I note without re-gating
   that `dry_run_trigger`'s validation switch has a `"file_watcher"` arm
   (`triggers.rs:601`) while the `persona_triggers.trigger_type` CHECK admits only
   `('manual','schedule','polling','webhook','chain','event_listener')` — the
   exact condition that path's `vocabulary-wider-than-its-column` rule already
   ratchets. Not re-found; corroborated.

**To my own first pass.** I read the `executePersona` call-site table and briefly
concluded that five sites pass their input into the `triggerId` positional slot
(`useRunnerExecution.ts:67`, `:112`, `useUseCaseExecution.ts:103`, …) — which
would have been a large finding and is false. Those call the **store's**
`executePersona` (`useAgentStore(s => s.executePersona)`), a different function
with a different signature. Positional-argument analysis across a name that is
bound twice is worthless without resolving the binding, and I nearly published it.

**To published paths.**

- [`idempotent-invocation`](./idempotent-invocation.md) §2 — *"Derive the key from
  the request, never from the attempt"* — is inverted at the repo's most-used
  spawn door, `src/api/agents/executions.ts:68`, **with a comment asserting the
  guarantee it does not provide**. 20 call sites; 1 passes an explicit key and it
  passes a UUID too. That path's §7 should carry this.
- [`scheduled-trigger-firing`](./scheduled-trigger-firing.md) gains an
  independent corroboration: `persona_executions.trigger_id` is NULL in 2,188 of
  2,188 rows, so even a firing scheduler would have produced unattributable runs.
- [`inline-busy-state`](./inline-busy-state.md) gains a measurement it does not
  currently carry: **68 ternary null-spinner busy states across 50 files**,
  against **66 compliant `Button`/`AsyncButton` `loading` props across 52** —
  a near-even split on one concern. Its own `hand-rolled-spinner` rule cannot see
  any of the 68.

**Oracle.** Cohort for this leaf: `personas-web` and `personas-cloud` are
excluded (port / dependent on adjacent leaves); `brainiac`, `vibeman` and
`ascent` are independent. None of the three has a saved-automation-with-a-test-
fire surface at all, so the sweep returns a **3-of-3 silence** — strong under the
one-author confound, and it means §2's prescriptions are *this repo's own*
solved problem generalized, not fleet doctrine. The generalization is legitimate
because the exemplars are internal and independent of each other:
`system_ops_run_now`, `rotate_credential_now`, `backfill_schedule` and
`resolve_pending_trigger_fire` are four separate authors-in-time arriving at
"same function, one argument different" — the strongest evidence available here
that the shape is right, and the strongest possible indictment of the one door
that did not.

`convergence: "mixed"` is **untestable** against a fleet-wide silence; recorded as
such rather than counted with the thirteen failures. `sides: "client"` is
**contradicted and inverted**: the headline, all nine deviations' root causes and
every provenance finding are server-side Rust; the client's contribution is one
button, one `useCallback`, and a busy state that renders nothing.
