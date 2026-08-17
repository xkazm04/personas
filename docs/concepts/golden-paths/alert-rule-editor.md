# Golden path — Alert rule editor

> Situation node: `product-surfaces/monitoring-surfaces/alert-rule-editor` ·
> [situation spine](../situation-spine.md) · recurrence **3** · risk **HIGH** ·
> sides: **client** (**contradicted** — see [§12.1](#121--sides-client-contradicted-the-eighth-time)) ·
> convergence: **mixed** (**not tested** — see [§12.6](#126--what-was-not-done)) ·
> dimensions: **function · ui · resilience**
> Composed 2026-08-17 against `master` @ `6c97502d3`. Mode-2 batch, full contract.
>
> **Sweep size.** The authoring surface (`AlertRulesPanel.tsx`, 341 lines) and every layer beneath
> it read end to end: the store slice (`alertSlice.ts`, 533 lines), the two client evaluation
> entry points, the Rust evaluator (`alert_evaluator.rs`, 464 lines), the repo
> (`alert_rules.rs`, 311 lines), the DDL, and the five ts-rs bindings that carry the rule's
> vocabulary. `src/**/*.tsx` (**2,104** files) walked **four** times — twice by the census engine
> (rule + positive control) and twice by two independently written scanners, one of them the
> shared instrument `scripts/census/lib/instruments/matchJsxTags.mjs`. **All 41 sites in the
> census population were opened by hand.**
>
> **Measured by execution, not by reading.** A read-only **copy** of the operator's live
> `personas.db` (347 MB) was taken 2026-08-17 with the app running; the live file was never
> opened for write and **the copy was deleted at the end of composition**. Replayed verbatim
> against it: `snapshot_for_scope` (`alert_evaluator.rs:166-187`) — both of its queries,
> `get_summary` and `get_chart_data`, transcribed from
> `db/src/repos/execution/metrics.rs:410-444` and `:748-775` — then `evaluate_rule`
> (`:83-119`) over a **16-rule natural matrix** (five metrics × their obvious operators and
> thresholds), at fleet scope and at each of the **78** persona scopes, in each of the **three
> windows the three live evaluators use**. That replay is what produced §0, and nobody had run it.
>
> **Primed, then verified.** This leaf sits beside `alert-dedupe-and-cooldown`, composed
> 2026-08-16, which owns everything downstream of the fire. Its D4 (*"two evaluators, one
> condition, and only one of them can compute the right number"*) is **extended, not
> re-derived**: there are **three**, and the third is driven by a dropdown. Claims imported from
> `metric-definition`, `scoring-and-thresholds`, `id-generation`, `delete-semantics`,
> `entity-picker` and `tooltip` are cited by site and re-checked, never restated as new.

---

## 0 The headline: one rule, three evaluators, three windows — and the number you tune the threshold against is never the number the rule is compared to

A user opens Overview → Observability, reads the cost chart over the **30-day** range the tab
opens on, sees ~$40, and writes the rule the chart just taught them: **`cost > 30`**. Three
independent loops will now evaluate that rule, and **not one of them evaluates it over 30 days**:

| # | evaluator | file | summary window | chart window | scope |
| --- | --- | --- | --- | --- | --- |
| 1 | the Rust NOC loop, 60 s, runs with the UI closed | `src/commands/execution/alert_evaluator.rs:170-171` | **1 day** (`SUMMARY_WINDOW_DAYS`) | **7 days** (`SPIKE_WINDOW_DAYS`) | **the rule's `persona_id`** (`:221`) |
| 2 | the client background loop, 60 s, in `BackgroundServices` | `useGlobalAlertEvaluator.ts:19,46` | **1 day** (`ALERT_EVAL_WINDOW_DAYS`) | **1 day** (same call) | **fleet-wide, always** |
| 3 | the Observability tab, on every metrics change | `useObservabilityData.ts:68-70` | **whatever the DayRangePicker says — default 30** | same | **whatever the PersonaSelect says** |

Evaluator 3 is the one nobody expects. `useObservabilityData.ts:68-70` is

```ts
useEffect(() => {
  if (observabilityMetrics) evaluateAlertRules();
}, [observabilityMetrics, evaluateAlertRules]);
```

— `evaluateAlertRules()` with **no `metricsOverride`**, so it reads `state.observabilityMetrics`,
which `refreshAll` fetched as `fetchObservabilityMetrics(effectiveDays, selectedPersonaId)`
(`useObservabilityData.ts:57`). `effectiveDays` defaults to **30**
(`OverviewFilterContext.tsx:44`) and the picker offers 1 / 7 / 30 / 90 plus a custom range
(`DayRangePicker.tsx:10-15`). That path is not read-only: a trigger runs `api.createFiredAlert`
(`alertSlice.ts:497`), which persists a row, raises a toast, and — through
`alert_rules.rs:287` → `audit_incidents_promoter::promote_fired_alert` — can open an incident.
**Clicking "90d" on a dashboard is an alert-firing action**, and the fired row records
`threshold` and `value` but nothing about the window either number came from.

The three also disagree about **scope**, and the disagreement is one-sided. The Rust loop keys its
snapshot cache on `rule.persona_id` (`alert_evaluator.rs:221-233`) and its own module docstring
calls this "*an upgrade over the client loop, which only ever saw the global snapshot*"
(`:9-11`). That is exact: in 533 lines of `alertSlice.ts`, `rule.persona_id` appears **once**, at
`:463`, copying the value onto the `FiredAlert` it is about to write. `evaluateRule`
(`:85-140`) never reads it. So a rule scoped to one persona is evaluated **per-persona** by the
server and **fleet-wide** by both client loops, and because all three share one 1-hour cooldown
keyed on `rule_id` (`alertSlice.ts:210`, `alert_evaluator.rs:57`), **whichever loop fires first
suppresses the other two for an hour** — including when it fired on the wrong denominator.

The same docstring documents a second defect it did not fix. `cost_spike` is
`today_cost / avg_daily_cost`; with a **1-day** chart window the series has at most one point,
so those two numbers are the same number. `alert_evaluator.rs:30-33` says so — "*the client's
global loop only had a 1-day window, which made spike ≈ 1.0 always*" — and evaluator 2 still
passes `ALERT_EVAL_WINDOW_DAYS = 1`. Not *approximately* 1.0: **exactly** 1.0 whenever any cost
exists, and 0.0 otherwise. A `cost_spike > 2` rule cannot fire in the client loop; a
`cost_spike < 2` rule always does.

And beneath all of it, the shape that decides what happens on a quiet machine. Both rate metrics
answer **`0.0`** when the window is empty (`alertSlice.ts:98,103`; `alert_evaluator.rs:87-99`).
This install's last execution was **2026-06-26** — 52 days before composition — so the 1-day
window has been empty for 52 days, and every rate reads 0. Replaying the 16-rule natural matrix
against it:

```
error_rate  > 10   false      success_rate  < 90   TRUE      cost  > 10   false     cost_spike > 2   false
error_rate  >= 10  false      success_rate  <= 90  TRUE      cost  < 10   TRUE      cost_spike < 2   TRUE
error_rate  < 5    TRUE       success_rate  > 90   false                            executions > 100 false
error_rate  <= 5   TRUE       success_rate  >= 90  false                            executions < 100 TRUE
```

**8 of 16 fire — every `<` and `<=` rule in the set — on a machine where nothing has happened.**
Among them is the most natural alert anyone writes: *tell me when success rate drops below 90%*.
On an idle install it fires once an hour, forever, and each fire opens an incident. Both
evaluators are protected by a test named `empty_window_never_fires_rate_rules`
(`alert_evaluator.rs:437-453`) — which asserts **only the `>` direction**, twice. The form offers
`<` and `<=` in the same dropdown (`AlertRulesPanel.tsx:89,91`), and `success_rate` is a metric
whose only sensible operator is one of them.

`alert_rules` holds **0 rows** on this install and `fired_alerts` holds **0**. None of the above
has ever been observed, because the surface that would produce the input has never been used —
which is exactly the condition under which a form's defects survive.

---

## Principle (stack-free head)

**An alert rule is a predicate over a named window, at a named scope, in a named unit. All four
parts belong to the rule row. If any of them lives in the evaluator instead, the rule means
different things to different evaluators, and the user cannot see which one they wrote.**

Three corollaries, each of which this repo violates:

1. **The window is part of the predicate.** `error_rate > 10` is not a condition; `error_rate over
   the last hour > 10` is. A window that lives in a constant is a window the author cannot see,
   cannot tune, and cannot reconcile with the chart they read it off.
2. **Exactly one process decides that a rule fired.** Not "one authority and two best-effort
   mirrors" — mirrors share the cooldown, so a mirror's wrong answer silences the authority's
   right one.
3. **A metric's domain constrains its threshold, and the editor is where that happens.** If
   `error_rate` is a percentage, the editor must refuse 500. Nothing downstream can recover a
   rule that can never be true.

And one that this repo gets right and should be copied: **the vocabulary is a type**. Metric,
operator and severity are `#[derive(TS)]` enums shared to TypeScript, and the client's `switch`
carries a `const unhandled: never = rule.metric` arm (`alertSlice.ts:123`) so adding a variant in
Rust is a TypeScript compile error, not a silently non-firing rule.

---

## 1 Trigger

You are in this situation if you are about to write, or are reading, any of:

- "let the user configure an alert / a threshold / a rule for when X goes wrong"
- "add a metric to the alert dropdown" — the dropdown is the smallest part of the change
- "why did this alert fire?" or "why didn't it?", where the answer needs the window
- "the same rule fires twice" / "the alert fired once and never again"
- "add a per-agent / per-project scope to the alerting"
- **the "if you are about to write X" test:** you are about to write
  `<select onChange={e => setForm({...form, metric: e.target.value as SomeUnion})}` beside an
  `<input type="number">` whose bound depends on which option is selected. The threshold input's
  legal range just became a function of a sibling control, and nothing in the JSX knows that.

---

## 2 The one way

**Put the whole predicate in the row and let exactly one process evaluate it.** Concretely: (a)
the rule row carries `metric`, `operator`, `threshold`, **`window_seconds`**, `scope` and
`severity` — the window is a column, defaulted at creation from the metric, never a constant in
an evaluator; (b) the metric is a closed `#[derive(TS)]` enum and each variant declares its
**unit and its domain** in one exported table (`error_rate` → percent, `0..=100`), which the
editor reads to bound the threshold control and to render the unit — so an unsatisfiable rule is
not authorable rather than merely wrong; (c) every metric returns `Option<f64>` / `number | null`
and returns `null` for an empty sample, and the evaluator **skips** a rule whose metric is `null`
rather than comparing against a manufactured `0` — "nothing happened" is not "everything
failed", and the `<` operators are where that distinction becomes a page at 3 a.m.; (d) **one**
evaluator fires — the backend one, because it runs with the UI closed — and every client is a
*reader* of `fired_alerts`, never a writer; delete the client's fire path rather than trying to
keep two implementations of one predicate in step, because they already share a cooldown and a
mirror's wrong answer silences the authority's right one; (e) the editor's edit branch passes the
existing row into the form as a **required** prop, so "edit" cannot silently mean "replace with
the defaults"; (f) every scope reference is validated at read time against the entity that is
still there, and a rule whose scope entity was deleted is surfaced as broken, not evaluated
fleet-wide by accident. If you can only do one of these, do (a) — every other defect in §7 is
downstream of the window and the scope living somewhere the rule cannot see.

---

## 3 Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `src/lib/bindings/AlertMetric.ts` · `AlertOperator.ts` · `AlertSeverity.ts` | the closed vocabularies, generated from Rust. Import these; never re-declare a string union beside them. `AlertOperator` is `">" \| "<" \| ">=" \| "<="` — four members, and the form must offer exactly those four |
| `stores/slices/overview/alertSlice.ts` `ALERT_METRIC_OPTIONS` / `ALERT_SEVERITY_OPTIONS` + `alertLabel(t, key)` (`:38-67`) | **the exemplar.** Option lists that carry an i18n **key** (`AlertLabelKey`, an `Extract<keyof Translations['alerts'], …>`) rather than an English value, so a renamed key fails the build and the labels follow a language switch. Copy this shape for every option list |
| `db/src/repos/communication/alert_rules.rs` `parse_enum_column` (`:19-32`) | a `TEXT` column that must round-trip through a typed enum, failing **loudly** on a row that predates the contract instead of dropping the rule |
| `features/shared/components/forms/NumberStepper` | the numeric-entry primitive: hold-to-repeat, step-aware rounding, **clamping to `min`/`max`**. Pass `min` and `max` — see §9; 27 of its 28 call sites do |
| `features/shared/components/forms/Listbox` · `forms/FormField` | the select and the label+input+error pair. `AlertRulesPanel` uses four raw `<select>` and four unlabelled raw `<input>` |
| `features/shared/components/buttons/AsyncButton` | the Save control. It renders a real spinner and owns the double-submit guard; the panel's Save is a bare `<button>` whose `onSubmit` is fire-and-forget |
| `features/shared/components/feedback/ConfirmDialog` | required before Delete. `AlertRulesPanel.tsx:333` deletes on one click — already on `delete-semantics`'s list |
| `src/i18n/tokenMaps.ts` `tokenLabel(t, category, token)` | the token → label door for machine vocabularies, with a DEV warning on an unmapped token |

**Never:** a second copy of the predicate in another language; a window constant; a
`Record<string, …>` over a ts-rs union (it disarms the exhaustiveness check — see
`anomaly-marker.md` §7 D2 for the same bug shipped in the same quarter).

---

## 4 Steps

1. **Write the vocabulary in Rust first.** `#[derive(TS)] #[ts(export)]` enums for metric,
   operator and severity. Regenerate with
   `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`
   and commit `src/lib/bindings/`. Without `--workspace --features desktop`, **zero** bindings
   regenerate and the run is indistinguishable from "already up to date".
2. **Beside the metric enum, export its domain table** — one entry per variant: unit, minimum,
   maximum, default threshold, and the default window. This table is the single thing the editor,
   the evaluator and the formatter all read. `ALERT_METRIC_OPTIONS` is two thirds of it today: it
   carries `unit` and nothing about range or window.
3. **Add `window_seconds` to the row** with a `NOT NULL DEFAULT` chosen per metric at insert.
   Backfill existing rows from whatever constant the evaluator used, so the migration is a
   *disclosure* of the old behaviour rather than a change to it.
4. **Make every metric fallible.** `fn value(&self, m: &Snapshot) -> Option<f64>`, returning
   `None` for an empty denominator. The evaluator's loop becomes
   `let Some(v) = rule.metric.value(&snap) else { continue };` — one line, and the entire
   "8 of 16 rules fire on silence" class disappears with it.
5. **Delete the client evaluator.** Both of them. `evaluateAlertRules`, `evaluateRule`,
   `formatAlertMessage`, `FIRED_COOLDOWN_MS`, `pendingSyncAlertIds` and the
   `createFiredAlert` retry loop all exist to make a browser tab a second NOC. The tab's job is
   `fetchAlertHistory` and a toast on the `alert_fired` event the backend already publishes
   (`alert_evaluator.rs:297-320`).
6. **Build the form from `FormField` + `Listbox` + `NumberStepper`**, and drive the stepper's
   `min`/`max`/`step`/`suffix` from the domain table keyed by the currently selected metric.
   Changing the metric re-clamps the threshold; that is the behaviour, not a bug.
7. **Make the edit branch's initial value required.** `initial: RuleFormData` (no `?`). The call
   site that opens a blank form passes the explicit defaults constant. Now "render the form
   without the row" does not compile.
8. **Validate scope at read time.** `list_alert_rules` returns each rule with a
   `scope_missing: bool` computed by a `LEFT JOIN personas`; the row renders a warning and the
   evaluator skips it.
9. **And then stop.** Dedupe, cooldown window, notification fan-out, incident promotion and
   suppression are **not** this surface's job — they belong to
   [`alert-dedupe-and-cooldown`](./alert-dedupe-and-cooldown.md), which owns them and has already
   measured seven competing cooldown constants. Do not add an eighth here.

---

## 5 Anti-patterns

- **The window as a constant.** `const SUMMARY_WINDOW_DAYS: i64 = 1;` reads like configuration
  and behaves like a hidden term in the user's predicate. *Failure mode:* the threshold the user
  derived from a 30-day chart is compared against a 1-day sample, and the rule looks broken to
  everyone including its author.
- **A second evaluator "so alerts fire even when X".** *Failure mode:* two implementations of one
  predicate drift on the axis nobody wrote a test for (here: scope, and the chart window), and
  because they share a cooldown, the wrong one racing first **silences** the right one.
- **Rendering a `never` arm and calling the union closed.** `alertSlice.ts:123` is correct and
  admirable — and it constrains only the *metric*. Nothing makes the `operator`'s four literal
  `<option value=">">` tags agree with `AlertOperator`; they are hand-typed strings
  (`AlertRulesPanel.tsx:88-91`). A closed type constrains exactly what it names
  (doctrine Q1).
- **An unbounded control for a bounded quantity.** `<input type="number" step="any">` for a
  percentage. *Failure mode:* `error_rate > 500` is authorable, saves, renders in the list, and
  can never be true. There is no "invalid rule" state anywhere in the system.
- **A form whose "current values" prop is optional.** *Failure mode:* the one call site that
  needs it forgets it, TypeScript is satisfied, and Edit becomes Reset. See §7 D3 — it is live.
- **Firing from a render effect.** `useEffect(… evaluateAlertRules …, [observabilityMetrics])`
  turns a *view* parameter into a *write*. *Failure mode:* a user exploring the dashboard
  manufactures alert history.
- **A message string built at fire time and stored.** `formatAlertMessage` is deliberately
  English (`alertSlice.ts:144-149`, with a good reason: history must not be a mosaic of whatever
  language was active). But it stores the *rendered* sentence rather than the parts, so the
  history can never be re-rendered in the reader's language and never gains the window it was
  missing. Store the parts; format at read time.
- **`?? 'Unknown'` for a scope whose row is gone.** `AlertRulesPanel.tsx:177`. Already counted by
  `missing-current-entity-rendered-as-unset`; the point here is that the *evaluator* makes the
  same mistake silently — a rule scoped to a deleted persona evaluates over an empty snapshot,
  and empty is 0, and 0 fires every `<` rule.

---

## 6 Evidence

**The one site to copy: `src/stores/slices/overview/alertSlice.ts:23-67`.** Not for the
evaluation — for the vocabulary. The block's own comment records the bug that produced it (option
lists carrying `en.alerts.metric_error_rate`, a *value* read at module scope, frozen English for
every locale), the fix (`labelKey` resolved through `alertLabel(t, key)` at render), and the type
that makes regression impossible (`Extract<keyof Translations['alerts'], …>` — a renamed key is a
build error). A custom ESLint rule, `custom/no-module-scope-en-value`, was written to hold the
line. This is the whole contract of a machine vocabulary that has to reach a human, in 45 lines.

Other exemplary sites:

| site | what it demonstrates |
| --- | --- |
| `alertSlice.ts:115-129` | the `const unhandled: never = rule.metric` arm, with a Sentry report on the runtime path for a stale DB row. Compile-time exhaustiveness *and* a runtime voice |
| `alertSlice.ts:88-95` | the decided denominator (`successful + failed`), with the reasoning and the two sibling definitions it was reconciled against named in the comment |
| `alert_evaluator.rs:358-368` | the loop: `MissedTickBehavior::Delay` plus `spawn_blocking` for the synchronous DB tick. `background-loop.md` calls this the one loop in the tree that thought about overrun |
| `alert_evaluator.rs:209-233` | the per-scope snapshot cache — N rules on one scope cost one metrics query, not N |
| `alert_rules.rs:19-32` | `parse_enum_column`: a legacy `TEXT` column forced to round-trip through the typed enum, failing loudly ("*surface it loudly rather than silently dropping the rule, so an alert that 'never fires' is investigated, not ignored*") |
| `alert_rules.rs:35-59` | `list_alert_rules` — `query-latency-instrumentation.md` names it "the one site to copy" for `timed_query!` |
| `useGlobalAlertEvaluator.ts:26-31` | the overlap guard: a re-entrancy latch so a slow tick cannot race the next one past the cooldown check |
| `alertSlice.ts:427-442` | the cooldown's persisted fallback — the in-memory map resets on reload, so the most recent `fired_alerts` row is consulted. This is the mechanism `alert-dedupe-and-cooldown` measured as the cross-loop dedupe |

**Where the copy stops.** `evaluateRule` and `evaluate_rule` are line-for-line ports of each
other, both carefully commented, both tested — and they are the defect, not the exemplar. Two
correct implementations of one predicate is one implementation too many.

---

## 7 Deviations

Twelve. D1–D4 are the shape; D5–D9 are the editor; D10–D12 are bookkeeping.

### D1 — three evaluators, three windows, and the third is a dropdown · executed

`alert_evaluator.rs:170-171` (1 d summary / 7 d chart, rule scope) · `useGlobalAlertEvaluator.ts:19,46`
(1 d / 1 d, fleet) · `useObservabilityData.ts:68-70` (the tab's `effectiveDays`, default **30**,
and the tab's persona filter). The third path persists (`alertSlice.ts:497`) and can promote an
incident (`alert_rules.rs:287`). Nothing in `fired_alerts` records which window produced a fire:
the row carries `value` and `threshold` and no denominator, no window, no scope-resolution.

**Fix:** step 5. The tab evaluating anything is the accident; the other two are a decision nobody
wrote down.

### D2 — the client evaluators ignore the rule's scope, and share the server's cooldown · executed, 78 scopes

`rule.persona_id` occurs **once** in `alertSlice.ts` (`:463`), copying it onto the outgoing
`FiredAlert`. The server keys its snapshot on it (`alert_evaluator.rs:221`). Replayed over all
**78** personas at fleet scope vs per-persona scope: on this install both sides read 0 because
the 1-day window holds **0 executions for 78 of 78 personas**, so the disagreement is currently
unobservable — which is the point. It is a latent 78-way divergence with no test, no telemetry
and no field in the fired row that could ever reveal it after the fact.

Extends `alert-dedupe-and-cooldown` **D4**, which found two evaluators and one of them unable to
compute the right number. The count is three, and the axis is scope as well as window.

### D3 — "Edit" opens a blank form, and the type allows it · read

`AlertRulesPanel.tsx:43-58` declares `initial?: RuleFormData` and does
`useState<RuleFormData>(initial ?? DEFAULT_FORM)`. The edit branch, `:320-326`, renders

```tsx
<RuleForm key={rule.id} personas={personaList}
          onSubmit={(data) => handleEdit(rule.id, data)}
          onCancel={() => setEditingId(null)} />
```

— **no `initial`**. Clicking the pencil on a rule reading `Cost > 30 · critical · Director` opens
a form reading `error_rate > 10 · warning · All agents`, and Save writes those values back over
the row (`handleEdit`, `:274-288`, sends every field). The only thing standing between the user
and a silently rewritten rule is that they notice.

**This is the contract's `FacetedDecisionTable` precedent exactly** — `emptyTitle` required gets
3/3 real copy, its optional-prop siblings get 5 of 20 falling through to `"No data"`. Making
`initial` required (doctrine Q2: requiredness is the fix precisely when *omission* is the defect)
turns this into a compile error at the one call site that has it wrong.

### D4 — an empty window is a confident zero, and half the operator space fires on it · executed, 8 of 16

`alertSlice.ts:98,103` and `alert_evaluator.rs:87-99` both return `0.0` when
`successful + failed == 0`. The matrix in §0: every `<` and `<=` rule fires. The guard test
(`alert_evaluator.rs:437-453`) checks only `>`, twice, in a function named
`empty_window_never_fires_rate_rules`.

The Rust half of this is already counted — `empty-sample-as-confident-zero`
(`metric-definition.md`, 16 files / 34 matches) matches
`if decided > 0 { … } else { 0.0 }` directly. What that rule cannot see is the **client** copy
and the **operator asymmetry**: the census ratchets the shape, and the shape is only dangerous
in one direction, which is the direction the test does not cover.

### D5 — the threshold input declares no domain, and the domain is metric-dependent · executed, 6 of 41

`AlertRulesPanel.tsx:94-107`: `<input type="number" step="any">`, no `min`, no `max`. The five
metrics span four domains — percent `0..100` (`error_rate`, `success_rate`), dollars `>= 0`
(`cost`), a ratio `>= 0` (`cost_spike`), a count `>= 0` integer (`executions`) — and
`ALERT_METRIC_OPTIONS` already carries the `unit` for each, so the panel *renders* `%` beside a
control that will happily accept `-40`. This is the census rule in §9; measured population **41**
numeric-entry controls in `src/**/*.tsx`, of which **6 declare no domain** and **35 do**.

### D6 — the operator vocabulary is hand-typed literals beside a generated union · read

`AlertOperator` is a four-member ts-rs union (`bindings/AlertOperator.ts:6`). The form renders it
as four literal `<option value=">">…` tags (`AlertRulesPanel.tsx:88-91`) and launders the result
with `e.target.value as AlertOperator` (`:85`). Metric and severity go through
`ALERT_*_OPTIONS.map`; operator does not. Nothing makes the four tags agree with the four
variants, and the assertion removes the compiler from the one place it could have.

Same family as `unchecked-destination-id-assertion` (19 files / 54 matches) but on a *form
control* rather than a navigation destination; that rule's vocabulary list is drawn from the nav
unions and does not include `AlertMetric`/`AlertOperator`/`AlertSeverity`, so these three sites
are outside it.

### D7 — the editor's own chrome is untranslated, and one string is a key rendered as text · read

`src/i18n/locales/en.json` → `alerts` holds exactly **15** keys: five metric labels, three
severity labels, seven error strings. **Nothing for the editor.** So:

| line | rendered |
| --- | --- |
| `:67` | `placeholder={"rule_name_placeholder"}` — the literal string `rule_name_placeholder`, in all 14 languages |
| `:145` / `:152` | `Save` / `Cancel` |
| `:177` | `'Unknown'` / `'Global'` |
| `:181` | `title={rule.enabled ? 'Disable' : 'Enable'}` |
| `:201` / `:204` | `title={"edit"}` / `title="Delete"` |
| `:224-225` | the eval-health tooltip: `` `Evaluated ${n} rules in ${ms}ms, ${k} triggered` `` |
| `:127,:302,:314` | three `DebtText` placeholders — the extraction system's own IOU |

`rule_name_placeholder` is not a missing key. It **exists**, twice, translated into all 14
locales — as `settings.ambient.rule_name_placeholder` and `settings.byom.rule_name_placeholder`,
belonging to the app's two *other* rule editors. Someone typed the key they meant to reference
and never referenced it.

### D8 — four raw `<select>`, four raw `<input>`, no `<label>`, in a form · read

`AlertRulesPanel.tsx:73,83,112,122` are bare `<select>` (already inside `raw-select`'s 46-file
baseline); `:64,:95` are bare `<input>`. None has a `<label>`, an `aria-label` or a `FormField`.
The threshold's only unit indicator is a `<span>` positioned absolutely inside the input
(`:102-106`) — visual only, invisible to a screen reader. `forms/FormField` exists and is the
mandated primitive.

### D9 — Save is a bare button with a fire-and-forget handler · read

`:136-146`. `onClick` calls `onSubmit(form)` synchronously; `handleAdd`/`handleEdit` are `async`
and their rejections land in `silentCatch` (`:271,:287`). No `aria-busy`, no disabled-while-
in-flight, no spinner, and a second click inside the round trip issues a second create. The
prescribed primitive is `buttons/AsyncButton`, whose whole contract is a promise-returning
`onClick` (`inline-busy-state.md`).

### D10 — `budget_alert_rules`: a rule table with no editor, no evaluator and no reader · executed

`db/src/migrations/schema.rs:564-572` creates `budget_alert_rules (id, persona_id, rule_type,
threshold_usd, enabled, created_at)` plus an index. Grepping the whole tree for the table name
returns **two hits, both the DDL itself** — no repo function, no command, no binding, no
component. It holds **0 rows**. A second alert-rule vocabulary was designed, schema'd, indexed,
and never given a door in either direction.

This is doctrine §"Where types cannot reach" item 4 — *a thing that was never declared*. No
signature is short a parameter; nobody calls anything. Only an inventory finds it.

### D11 — the fired row cannot explain itself · read

`fired_alerts` (`migrations/initial.rs:144-156`) stores `value`, `threshold`, `metric`,
`severity`, `persona_id`, `message`. It does **not** store the window, the denominator, the
sample count, or which evaluator wrote it. Given D1 and D2, two rows with identical `value` and
`threshold` can come from different windows at different scopes, and the history renders them
identically. `id-generation.md` already lists this table's mint site (`alertSlice.ts:455`
`crypto.randomUUID()` on the client vs `uuid::Uuid::new_v4()` in Rust) as its §7 "one concept,
many mints"; the missing provenance columns are the same problem one field over.

### D12 — no confirmation on delete; optimistic delete with a full-list restore · read/cited

`AlertRulesPanel.tsx:333` calls `deleteAlertRule` on a single click with no `ConfirmDialog` —
already on `delete-semantics`'s list at that exact line. `alertSlice.ts:304-321` then removes the
row optimistically and, on failure, restores `prevRules` **wholesale** — the pattern
`optimistic-update.md` D4 counts as "nine rollbacks erase writes that landed during the round
trip". Both cited, neither re-derived.

---

## 8 Gaps

Things the primitives genuinely cannot do today, several of which are upstream of the deviations.

1. **There is no window in the schema.** `alert_rules` has ten columns and none of them is time.
   D1 is not a bug in any one evaluator; it is three reasonable authors each supplying the term
   the row omitted.
2. **There is no "this rule is unsatisfiable" state.** A rule is `enabled` or not. `error_rate >
   500` and `success_rate < -1` are storable, listable, and permanently silent, and no surface
   can say so. Adding a domain table (step 2) makes the editor able to refuse them; it does not
   retro-classify the rows already there.
3. **`ALERT_METRIC_OPTIONS` is a *presentation* table doing a *domain* table's job.** It has
   `unit`, which is why the panel can render `%` — and nothing else, which is why it cannot bound
   the input. The Rust side has no equivalent at all: `format_alert_message`
   (`alert_evaluator.rs:124-148`) re-declares the same label-and-unit pairs as a fifth copy, in
   English literals, in a `match`.
4. **The metric snapshot has no per-metric window.** `MetricsSnapshot` is one struct with one
   `total_cost_usd` and one execution triple; `cost_spike` needs a second, longer window and gets
   it by a special field (`today_cost_usd`) rather than by asking for a different window. A rule
   with its own window cannot be served by this shape without changing it.
5. **Scope is one nullable `persona_id`.** Not a project, not a team, not a tag, not "any persona
   in this use case" — and the app has all four concepts. The `__global__` sentinel
   (`AlertRulesPanel.tsx:123-124`) is a string laundered into `null` at the boundary, which works
   only because there is exactly one scope dimension.
6. **`NumberStepper`'s `min`/`max` are optional.** The primitive is the right destination and
   it does clamp — but nothing makes a caller declare a domain. See §9: this is the *inverse* of
   the contract's `<Numeric locale>` case and worth knowing why.
7. **Nothing validates that a rule's scope entity still exists.** `list_alert_rules` selects the
   ten columns and returns; the evaluator passes `persona_id` straight into a `WHERE` clause. A
   deleted persona yields an empty snapshot, an empty snapshot yields `0.0`, and `0.0` fires
   every `<` rule (D4). The three defects compose into "delete an agent, get an hourly page".

---

## 9 The missing gate

Every deviation above shipped under a green `npm run check`, and the two biggest (D1, D2) are
invisible to any linter because the disagreement is between a Rust constant and a TypeScript
constant in two different trees.

**What is gateable here, and what is not.** D1/D2/D11 are *absences* — a missing column, a
parameter nobody passes, provenance nobody records — and the census "cannot assert an ABSENCE"
by construction. D3 is an AST-shaped condition (an optional prop omitted at one of two sibling
call sites) that belongs in ESLint with `RuleTester` fixtures, not in a text ratchet. D4's Rust
half is **already ratcheted** by `empty-sample-as-confident-zero`.

What remains, and what this path ships, is **D5**: a numeric control that collects a bounded
quantity and declares no bound.

### The signal, and the condition it is a proxy for

**Condition (stack-free):** an authoring surface collects a number whose legal domain is known to
the system, through a control that does not carry the domain — so a value the system can never
act on is authorable, saveable, and indistinguishable in the list from one that works.

**Proxy in this stack:** a JSX numeric-entry control — the intrinsic `<input type="number">` or
the shared `NumberStepper` — carrying **neither** `min` nor `max` in its open tag.

**Why the pairing of the two tags is load-bearing.** Counting only the raw `<input>` reports 12
sites and looks like a lint nit. Counting both reports a **population of 41** and a *distribution*
that is the actual finding:

| control | declares a domain | does not | rate |
| --- | --- | --- | --- |
| `NumberStepper` (the shared primitive) | **27** | 1 | **96.4 %** |
| bare `<input type="number">` | 8 | 5 | 61.5 % |
| **total (production `src/**/*.tsx`)** | **35** | **6** | **85.4 %** |

Reaching the primitive is what causes the domain to be declared — even though the primitive's
`min` and `max` are **optional props**. That is worth stating precisely, because it inverts the
contract's fifth failure mode. `<Numeric>`'s optional `locale` defaulted to `'en'` and **189 of
197** call sites forgot it. `NumberStepper`'s `min` has **no default**, and its `−` button walks
the value down past zero in front of the author on the first click. **An optional prop whose
omission is visible in the rendered artifact gets passed; an optional prop whose omission
produces a plausible wrong answer does not.** "Fix the default" is the right advice for the
second kind and unavailable for the first — there is no correct default `min` — so for this
primitive the ratchet is the whole answer.

### Fail-loud

Inherited from the runner, and exercised. The rule fails on a **rise** (a new domainless
control), on a **silent drop** (the usual cause is a broken matcher, not a fixed codebase), when
it matches **zero files anywhere**, when an `exclude` goes stale, and when the walk sees fewer
than `floor` files. The **positive control** partitions the same population: if the compliant
arm ever returns zero, the pattern has stopped discriminating and the runner fails structurally
rather than reporting a clean codebase.

**Correct end state is not zero.** A genuinely open quantity exists. It is a ratchet on the
proportion, and the positive control is what makes the proportion legible.

### The rule

```json
{
  "id": "domainless-numeric-entry",
  "goldenPath": "docs/concepts/golden-paths/alert-rule-editor.md",
  "title": "A numeric control collects a quantity whose domain the system knows, and declares no bound",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<NumberStepper(?![A-Za-z0-9_$-])(?:(?!\\bmin\\s*=)(?!\\bmax\\s*=)(?:[^>]|(?<=[=!<])>|>(?==))){0,1600}(?<![=!<])/?>(?!=)|<input(?![A-Za-z0-9_$-])(?=(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}?type\\s*=\\s*\\{?\\s*['\"]number['\"])(?:(?!\\bmin\\s*=)(?!\\bmax\\s*=)(?:[^>]|(?<=[=!<])>|>(?==))){0,1600}(?<![=!<])/?>(?!=)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A numeric-entry control — the intrinsic <input type=\"number\"> or the shared NumberStepper — whose open tag carries neither `min` nor `max`. PROXY FOR the stack-free condition: an authoring surface collects a number whose legal domain the system already knows (a percentage, a count, a currency amount) through a control that does not carry it, so an unsatisfiable value is authorable, saveable and indistinguishable in the list from a working one. EARNING CASE: AlertRulesPanel.tsx:95 is the alert threshold; its five metrics span four domains (percent 0..100, dollars, a ratio, an integer count) and ALERT_METRIC_OPTIONS already carries the unit for each, so the panel RENDERS `%` beside a control that accepts -40. THE TWO TAGS ARE BOTH LOAD-BEARING: counting only the raw <input> gives 12 sites and looks like a lint nit; counting both gives a population of 41 whose DISTRIBUTION is the finding — NumberStepper 27 of 28 declare a domain (96.4%), bare <input type=number> 8 of 13 (61.5%). Reaching the shared primitive is what causes the bound to be declared, even though its `min`/`max` are OPTIONAL props — the inverse of <Numeric>'s optional `locale`, which 189 of 197 call sites forgot. The discriminator: an optional prop whose omission is VISIBLE in the rendered artifact (the stepper's minus button walks past zero on the first click) gets passed; one whose omission yields a plausible wrong answer (en-US separators) does not. There is no correct default `min`, so 'fix the default' is unavailable here and the ratchet is the whole answer. THE DELIMITER HANDLING IS THE HARD PART, per doctrine §4 'enumerate the operators that contain your delimiters': the tempered token is `(?:[^>]|(?<=[=!<])>|>(?==))`, which consumes the `>` of an arrow `=>` and of `>=`/`<=` but stops at a real tag close; without it, `/?>` backtracks onto the `>` of `onChange={(e) =>` and the tag 'closes' at the arrow — measured, that reported 35 matches / 27 files instead of 6 / 6, and the positive control returned the SAME 35, which is the tell. The `{0,1600}` bound is measured, not guessed: at {0,700} the pattern missed TriggerScheduleConfig.tsx:70, whose open tag is longer than 700 characters because of a multi-line className template — a COMPLIANT site, so the undercount was silent and in the flattering direction. MEASURED 2026-08-17 at 6c97502d3 by two structurally independent implementations — this regex, and a scanner built on the shared instrument scripts/census/lib/instruments/matchJsxTags.mjs — which agree on the count AND on all 41 file:line sites after the bound was raised. ALL 41 OPENED BY HAND. Precision on the 6: 6/6 (alert threshold; a schema-driven lab field whose schema carries no range either; two KPI target/manual-value inputs beside a rendered unit; a KPI target in the context detail; a regex CAPTURE GROUP INDEX at FieldRuleRows.tsx:97, where a negative value is meaningless). A SEVENTH raw match is NumberStepper.tsx:49 — inside the primitive's own docstring, the sentence 'Replaces bare <input type=\"number\"> whose native spinners are micro-targets' — dropped by ignoreCommentLines. Both implementations matched it, in the same direction, and only hand-verification found it: the 35%-prose trap the engine's docstring records from raw-web-storage, reproduced. SITE-LEVEL OVERLAP against every committed rule that can reach these files: 8 rules share a FILE, 1 shares a SITE — native-title-tooltip at FieldRuleRows.tsx:97, which matches the same line for an unrelated reason (that input also carries title=\"Capture group\"). 1 of 6 = 16.7%. LEGAL FIX, in order: (1) export the quantity's domain beside its vocabulary — for alerts, a per-AlertMetric table of unit/min/max/default beside ALERT_METRIC_OPTIONS — and drive the control from it, so changing the metric re-clamps the threshold; (2) where the domain is a constant, write it: min={0} max={100}. PRECONDITION (re-derive per repo, do NOT port): this proxy works because the domain is spellable as a JSX attribute on the control. A repo that validates numeric ranges in a schema object (zod, yup, react-hook-form rules) carries no `min=` on the element and scores ZERO while the condition is present at full scale; derive the proxy from wherever THAT repo spells a bound."
  },
  "exclude": [
    {
      "path": "**/__tests__/**",
      "reason": "test fixtures deliberately construct bare numeric inputs to exercise the primitive's own clamping; they are not authoring surfaces and have no domain to declare"
    }
  ],
  "baseline": { "files": 6, "matches": 6 },
  "floor": 1500
}
```

```json
{
  "id": "domainless-numeric-entry-positive-control",
  "goldenPath": "docs/concepts/golden-paths/alert-rule-editor.md",
  "title": "CONTROL: the same anchors pointed at the COMPLIANT form — a numeric control that DOES declare its domain",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<NumberStepper(?![A-Za-z0-9_$-])(?=(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}?\\b(?:min|max)\\s*=)(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}(?<![=!<])/?>(?!=)|<input(?![A-Za-z0-9_$-])(?=(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}?type\\s*=\\s*\\{?\\s*['\"]number['\"])(?=(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}?\\b(?:min|max)\\s*=)(?:[^>]|(?<=[=!<])>|>(?==)){0,1600}(?<![=!<])/?>(?!=)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The SAME two anchors and the SAME delimiter handling, requiring `min` or `max` INSIDE the open tag instead of forbidding both. This is a PARTITION of the population, not a ratio: 35 compliant + 6 violating = 41, disjoint (measured: zero sites in both), and the two sets were reproduced identically by a second implementation built on matchJsxTags. If this control ever returns zero the pattern has stopped discriminating and the runner fails structurally rather than reporting a clean codebase. It carries no baseline, per the doctrine's control contract."
  },
  "exclude": [
    {
      "path": "**/__tests__/**",
      "reason": "same population boundary as the gate it controls — the two must scan identical file sets or the partition is not a partition"
    }
  ],
  "floor": 1500
}
```

### What the gate cannot reach, and the instrument that would

Three of this leaf's four worst defects need something else. Specified here so the next pass does
not re-derive them:

- **D1/D2 (three evaluators, three windows, one scope ignored)** — a **test**, not a ratchet:
  build one `AlertRule` fixture and one `MetricsSnapshot` fixture, run every registered evaluator
  over them, and assert the verdicts are identical. It fails the moment a second evaluator exists
  that disagrees on any axis, which is the whole condition. Note the trap
  `client-rule-mirroring.md` records: if each side ships its *own* fixtures, both suites stay
  green forever. One fixture, N evaluators.
- **D3 (optional "current values" prop omitted at the edit call site)** — ESLint with
  `RuleTester`: report a component rendered at ≥2 call sites in one module where one passes an
  optional prop and the other does not. AST-shaped; a text ratchet cannot see it.
- **D10 (`budget_alert_rules`)** — an **inventory** check: every `CREATE TABLE` in
  `db/src/migrations/**` cross-referenced against the repo functions that name it, failing on a
  table with zero readers *and* zero writers. Same instrument shape the orphan-bindings problem
  needs, and for the same reason: a diff-shaped gate cannot see an absence.

---

## 12 Corrections to the brief, and to prior findings

### 12.1 — `sides: "client"` contradicted, the eighth time

The node is `sides: "client"`, `twoSided: true`. The headline, the two worst deviations (D1, D2),
the missing column (Gap 1), the orphan table (D10) and the provenance gap (D11) are **all
server-side or schema-side**. The client's contribution is a form that omits a prop and a control
that omits a bound — real, and §7's smallest items.

But the correction here is not the usual "it was both". It is that **the label is pointing at the
wrong half of a genuinely two-sided leaf**: the *editor* is client-side, and the editor is not
where the rule acquires its meaning. The meaning is assembled from three constants in two
languages. A client-scoped brief would have found D3, D5 and D7 and stopped, and would have
reported this leaf as healthy.

Ledger: **eight** contradictions of `sides: "client"`, two upholdings
(`bulk-selection-actions`, `long-list-rendering`, both because *the server never sees the DOM*).
This one is a third distinct failure mode for that value — not incomplete, not inverted, but
**scoped to the surface rather than to the situation**.

### 12.2 — the brief's lead was right in shape and wrong in direction

The brief primed: *"the trigger-wiring-surface question, one domain over — that path found the
form writes fields nobody reads; check for the same shape here."*

Checked, and it is **inverted**. Every field the form writes *is* read: `name`, `metric`,
`operator`, `threshold`, `severity`, `enabled` by all three evaluators, and `persona_id` by the
server one. The defect is the mirror image — **the evaluator reads terms the form cannot write**.
Window and scope-resolution are supplied by constants and by an unrelated dropdown. A rule is
under-specified by its own editor, not over-specified.

Worth keeping, because the two failures need opposite fixes: a field nobody reads is deleted; a
term nobody can write is **promoted into the row**.

### 12.3 — the brief's three adjacent-measured claims: verified, and one re-scoped

- *"`alertSlice` binds English at module scope"* — **corrected, and it is the file's best
  feature.** That was true, was fixed, and the fix (`alertSlice.ts:23-53`) is now §6's one site
  to copy. `formatAlertMessage` (`:142-154`) still reads `en.alerts[…]`, deliberately and with a
  written reason: the string is persisted to `fired_alerts.message` and re-read months later, so
  localizing at write time would leave history in a mosaic of languages. It reads at *call* time,
  not module scope, so the shim's laziness applies. **Not a deviation.** The real defect beside it
  is that storing the rendered sentence rather than its parts makes the history permanently
  unlocalizable *and* permanently unable to gain the window it lacks (D11).
- *"ten distinct boundary sets for one kind of 0–100 number"* — verified as
  `scoring-and-thresholds` D9's finding, and it is **adjacent, not present**: this leaf has no
  verdict bands. Its 0–100 numbers are compared against a **user-supplied** threshold, which is
  the healthy form of exactly that problem — and it is why D5 (nothing bounds that threshold to
  0–100) matters more here than a band table would.
- *"inline verdict ladders at 37 files / 52 matches"* — verified as `inline-verdict-band`'s
  current baseline. **Zero matches in this leaf's files.**

### 12.4 — a primed claim from a neighbour, upheld and sharpened

`alert-dedupe-and-cooldown` §0 records that `tick()` returns at `if enabled.is_empty()`
(`alert_evaluator.rs:201`). Re-verified against the live copy: `alert_rules` holds **0** rows,
so the loop has never advanced past line 201, and `fired_alerts` holds **0**. Its **D4** —
"two evaluators, one condition, and only one of them can compute the right number" — is upheld
and **extended to three**, with the third being the Observability tab's own render effect. No
contradiction; the neighbour did not look at the tab because the tab is not part of its leaf.

### 12.5 — two measurement corrections earned during composition, both worth carrying

**(a) The instrument is blind inside attribute expressions, and it cost 2 of 42 sites.**
`matchJsxTags.mjs` treats `{ … }` attribute expressions as opaque — deliberately, because that is
how it stops reading `=>` and `>=` as tag delimiters. The consequence is that **JSX nested inside
a JSX attribute is invisible to it**. Measured: `RotationNewPolicy.tsx:47` and
`RotationActivePolicy.tsx:126` pass a whole `<input type="number" min={1} …/>` through a
`customInput={…}` render-prop attribute, and the instrument does not see either. **2 of 42
numeric controls in this repo (4.8%)**, both on the *compliant* side, so the miss flattered the
codebase. Reported upward: this belongs in the instrument's header beside the bug it already
records, because the next composer to reach for it will be counting components too.

**(b) A bounded quantifier undercounted, silently, in the flattering direction.** At `{0,700}`
the census pattern missed `TriggerScheduleConfig.tsx:70` — a **compliant** site whose open tag
runs past 700 characters because of a multi-line `className` template literal. Both arms of the
measurement had already agreed at 6 violating, so the disagreement surfaced only on the *control*
side (34 vs 35) and only because the control was measured as a **partition** rather than as a
ratio. The doctrine's rule is that a positive control returning ~0 means the pattern is not
discriminating; this adds a weaker but useful case — **a control that is off by one is a
quantifier bound, and only a partition can show you.** Raised to `{0,1600}`; both arms then agree
at 6 / 35 / 41 with identical membership.

And the one the doctrine already predicted, reproduced exactly: both implementations matched
`NumberStepper.tsx:49`, in the same direction, and it is **prose inside the primitive's own
docstring describing the very migration the rule enforces**. Agreement is not soundness;
hand-verification is what found it.

### 12.6 — what was not done

- **The convergence oracle was not run.** The node claims `convergence: mixed`; it is untested
  here. This is a Mode-2 batch of three leaves sharing one measurement pass, and the sibling sweep
  was the item cut. Recorded as an owed follow-up rather than reported as a silence — per
  doctrine, a silence must be *measured* before it is claimed, and reporting an unrun sweep as
  agreement or as silence would be the failure mode the oracle exists to prevent.
- **No fix was applied.** Everything in §7 is a note, per the campaign's no-destructive-applies
  rule. D3 in particular is a one-word change (`initial?:` → `initial:`) plus one call-site edit,
  and it changes what a live surface does; it belongs in
  [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).
- **An incidental i18n observation, out of scope and recorded once:** the German value for
  `settings.ambient.rule_name_placeholder` carries a runaway escape sequence
  (`Regelname (z.B. \\\\\\\\\\\\\"Absturz-Debug-Helfer\\\\\\\\\\\\\")`) — a translation-pipeline
  artifact, not a defect of this leaf. It belongs to
  [`translation-completeness`](./translation-completeness.md); noted here only because this leaf's
  D7 is what surfaced it.
