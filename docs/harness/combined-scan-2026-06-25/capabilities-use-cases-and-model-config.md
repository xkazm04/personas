# Capabilities, Use Cases & Model Config — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: capabilities-use-cases-and-model-config | Group: Persona & Agent Studio
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Budget UI/pause number is not the number the server actually enforces
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / wrong-result
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:78-92 (consumes `getAllMonthlySpend`); divergence is between src-tauri/src/commands/communication/observability/metrics.rs:158-167 and src-tauri/src/db/repos/execution/executions.rs:1441-1448
- **Scenario**: A persona has run some executions that were `cancelled` (killed mid-run after burning credits) and some Chat-tab ops queries, then is run near month boundary.
- **Root cause**: The frontend pause gate / badge derive status from `get_all_monthly_spend` which sums `status IN ('completed','failed')`, **includes** ops-chat, and uses the **local-timezone** start of month. The server gate that actually blocks runs (`get_monthly_spend`, used by both the manual gate at executions.rs:294-307 and `schedule_over_budget`) sums `('completed','failed','incomplete','cancelled')`, **excludes** ops-chat (`input_data NOT LIKE '%"_ops"%'`), and uses **UTC** `start of month`. background.rs:1495-1497 explicitly states the invariant "the budget UI shows... terminal statuses only, ops-chat excluded" — but the UI query violates it on all three axes.
- **Impact**: The two numbers disagree in both directions. UI can show "exceeded" (badge + manual run blocked) while the server would allow the run (UI over-counts ops-chat), nagging/blocking the user wrongly; or UI shows green/"ok" while the server's higher number (cancelled+incomplete spend) rejects the run with a confusing "Budget limit exceeded" error. Budget controls become untrustworthy in a context whose whole job is budget control.
- **Fix sketch**: Share one SQL predicate (status set + ops-chat filter + month-boundary basis) between `get_monthly_spend` and `get_all_monthly_spend_with_conn`, or have the UI query call the same per-persona helper. At minimum align status list, ops-chat exclusion, and timezone basis.
- **Value**: impact=8 effort=4

## 2. Manual "Run" double-submits real paid executions on a fast double-click
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition / double-submission
- **File**: src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:89-90 (guard) and :136 (per-call idempotency key)
- **Scenario**: User double-clicks the manual "Run" button on an under-budget capability within the same React commit window.
- **Root cause**: The reentrancy guard `if (!selectedPersona || isManualRunning) return;` reads `isManualRunning`, which is **React state captured in the closure**, not a synchronously-updated ref. Both click handlers run against the same render's closure (still `false`) before the re-render that disables the button commits. Each call additionally passes a fresh `crypto.randomUUID()` as the idempotency key, so the backend cannot dedupe them — they are two distinct executions, each individually under budget, so the server gate (executions.rs:299) passes both.
- **Impact**: Two real, paid production CLI spawns instead of one, and — per the code's own comment at :82-87 — any `emit_event` payloads fire twice, double-cascading downstream chained capabilities. Real money + duplicated side effects.
- **Fix sketch**: Use a `useRef` (`runInFlightRef`) set synchronously at function entry and cleared in `finally`, gating on the ref instead of state; and/or derive a stable idempotency key (e.g. `useCaseId + coarse timestamp bucket`) so the backend dedupes accidental repeats.
- **Value**: impact=7 effort=2

## 3. Rename "blast radius" count uses different trigger matching than the rename itself
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / preview-action divergence
- **File**: src-tauri/src/commands/core/use_cases.rs:459-467 (count via LIKE) vs :543-551 and :560-567 (rename/delete via json_extract)
- **Scenario**: A persona_triggers row stores config JSON with a space after the colon (`"event_type": "alert"`) or with event_type not at the top level; the user opens the rename modal for `alert`.
- **Root cause**: `count_event_listeners` matches triggers with a raw substring needle `%"event_type":"<escaped>"%` (no `json_valid`, whitespace-sensitive, no JSON-path anchoring). The actual `rename_event_listeners` matches with `json_valid(config) AND json_extract(config,'$.event_type') = ?`. The two predicates do not agree: the whitespaced/normalized row is counted=0 by LIKE but *is* rewritten by json_set (and vice-versa for a nested embed that LIKE catches but json_extract ignores).
- **Impact**: The confirmation dialog under- or over-states how many external consumers a rename will touch. The user approves "0 affected" and silently re-points or deletes N triggers, or is scared off a safe rename by a phantom count. Silent consumer-wiring breakage.
- **Fix sketch**: Make `count_event_listeners` use the exact same predicate as the mutation (`json_valid(config) AND json_extract(config,'$.event_type') = ?1`) for the trigger count, instead of LIKE.
- **Value**: impact=5 effort=3

## 4. `clearBudgetOverrides` is dead code — a one-time "Run anyway" becomes a session-permanent bypass
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: unclear-intent / silent-failure
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:174-176 (definition) and :155 / :140-151 (override consulted on every check)
- **Scenario**: User clicks "Run anyway" once on a budget-paused persona (PersonaRunner.tsx:102 → `overrideBudgetPause`); they keep working for the rest of the session.
- **Root cause**: `clearBudgetOverrides` is documented as "Clear all overrides (e.g. on budget refresh)" but is **never called anywhere** — `fetchBudgetSpend` does not invoke it. So `budgetOverrides`/`budgetStaleOverrides` only grow. Every later `isBudgetBlocked` for that persona returns `false` (and the stale path re-checks `budgetStaleOverrides` on every 60s TTL expiry), so the pause prompt never reappears for that persona this session, even across a fresh fetch or a new month.
- **Impact**: The per-decision consent model ("override *this* pause") silently degrades to a permanent, persona-scoped suppression of the frontend budget gate and stale-data fail-closed gate. The server monthly gate still backstops true over-budget runs, so this is UX/consent rather than direct overspend — but the documented safety reset simply does not exist.
- **Fix sketch**: Call `clearBudgetOverrides()` (or clear just the refreshed persona's entry) at the end of a successful `fetchBudgetSpend`, or give overrides a short TTL so they expire with the data they overrode.
- **Value**: impact=4 effort=2

## 5. Slice documents a "per-execution hard cap" that does not exist (no per-run ceiling)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: unclear-intent / undocumented-assumption (unit confusion)
- **File**: src/stores/slices/agents/budgetEnforcementSlice.ts:23-26
- **Scenario**: A maintainer reads "the backend budget (max_budget_usd per execution) still hard-caps individual runs" and concludes frontend-only gating is safe because runaway single runs are server-capped.
- **Root cause**: `max_budget_usd` is a **monthly** cap, not per-execution. Server enforcement (executions.rs:296-305 and `schedule_over_budget`) only checks `monthly_spend >= budget` **before** a run; there is no per-run cost ceiling, and `0.0`/`None` both mean "unlimited" (background.rs:1492-1494). A single runaway execution can therefore consume the entire monthly budget (or far more) in one go — the cap only stops the *next* run. The comment asserts a guarantee the system does not provide. (Related footgun: BudgetControls.tsx:34-44 accepts a literal `0` in the "$ Max budget" field, which silently means *unlimited*, not "spend nothing.")
- **Impact**: False sense of safety in money-handling code; the assumption blocks anyone from adding the real per-run guard, and a user entering `0` to halt spend gets the opposite.
- **Fix sketch**: Correct the comment to "monthly cap, enforced only between runs; no per-run ceiling." Consider a real per-execution cost cap (or wire `max_turns` as the documented runaway limiter), and in the UI either reject `0` (min=0.01) or label that `0`/empty = unlimited.
- **Value**: impact=5 effort=3
