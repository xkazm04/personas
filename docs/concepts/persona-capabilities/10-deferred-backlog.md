# 10 — Deferred Backlog

> Items intentionally deferred from C1–C6. Each has a **trigger condition**
> — the signal that says "now is the time." When the trigger fires, lift
> the item out of this doc, spec it, plan it, ship it.

## §A — Stale-prompt lint / warning

**What.** When a capability is disabled but the persona's baked
`structured_prompt.instructions` still references it by name, surface a
warning in the Design hub header with a one-click "regenerate prompt"
action.

**Why deferred.** We trust the live "Active Capabilities" section as source
of truth; the model treats it as authoritative. Drift is a nuisance, not a
correctness bug.

**Trigger to revisit.**

- Real users report persona behavior confusion traceable to stale references.
- OR: telemetry shows capability toggles are frequent and users regenerate
  prompts manually often enough that an automation would help.

## §B — Per-capability tool subsetting

**What.** Add `use_case_id` to `persona_tools` (or a link table), and allow
tools to be scoped to specific capabilities. Runtime filters the tool array
passed to Claude per capability.

**Why deferred.** The Active Capabilities section already includes
`tool_hints` so the model knows which tools are most relevant per capability.
Hard restriction adds complexity without clear value unless we observe
tools being misused cross-capability.

**Trigger to revisit.**

- Cost/token pressure: too many tool schemas sent per execution.
- Safety: a capability is misusing a tool it shouldn't have access to.
- User explicitly requests scoping during Design hub interactions.

## §C — Orphan cleanup UI for historical records

**What.** When a capability is removed from `design_context.useCases`,
historical `persona_executions`, `persona_messages`, `persona_manual_reviews`,
`persona_memories` rows retain their now-unknown `use_case_id`. Admin-mode
UI to reattribute these to a surviving capability or purge them.

**Why deferred.** Greenfield — no capabilities removed from production
personas yet. Data stays queryable by the defunct ID; UI just shows
"unknown capability."

**Trigger to revisit.**

- First support ticket about confusing "unknown capability" entries.
- OR: before first external beta, to avoid embarrassing state.

## §D — Capability composition graph / map view

**What.** A read-only graph visualization of capabilities as nodes, with
edges inferred from event subscriptions (capability A emits event X,
capability B subscribes to X → edge A → B). Reuses patterns from
`DependencyGraphPanel` in `sub_connectors`.

**Why deferred.** List view is sufficient for mental model. A graph adds
value only when personas have 5+ interlinked capabilities.

**Trigger to revisit.**

- A persona in the wild has 5+ capabilities with genuine event-driven composition.
- User research shows the list view is hiding coupling that causes surprise behavior.

## §E — "Focus this chat on capability X" affordance

**What.** A selector in the Chat UI that pins the current conversation to a
specific capability. The chat pinning injects `_use_case` into every chat
turn's `input_data`, scoping response style, tool hints, and notification
routing.

**Why deferred.** Chat is deliberately left persona-wide so the LLM can
route internally. Most chats span multiple capabilities.

**Trigger to revisit.**

- Users complain that chat "drifts" between capability contexts when they
  want one specific scope.

## §F — Cross-persona capability overview

**What.** An Overview-level page listing all capabilities across all
personas (filter by category, enable state, trigger type, last executed).
Makes the capability set a browsable unit of organization across the whole
app.

**Why deferred.** Persona-level organization is sufficient until the user
has many personas. Adding a cross-persona view before that clutters the
information architecture.

**Trigger to revisit.**

- User has >10 personas with ≥30 capabilities total.
- OR: explicit user request for "show me everything my agents can do."

## §G — Capability-local prompt overrides (structured_prompt fragments)

**What.** Each capability can declare its own prompt fragments that
override persona-wide fields for that capability only. E.g., "for Gem
Finder specifically, use this errorHandling strategy." Stored in
`DesignUseCase.per_capability_prompt_overrides`.

**Why deferred.** Option A assumes capability_summary + tool_hints +
model_override is enough. If usage shows a consistent need for deeper
prompt overrides, add this.

**Trigger to revisit.**

- Lab C6 refinement patterns consistently produce fragments that are
  capability-specific.
- User feedback indicates "the persona is too generic when running X, I want
  it to think differently."

## §H — n8n workflow → single capability (instead of persona)

**What.** `import_n8n_workflow(persona_id, use_case_id, workflow_json)` —
import an n8n workflow as one capability within an existing persona, rather
than always as a new persona.

**Why deferred.** Current flow (one workflow = one persona) works for first
users. The per-capability path needs the AgentIr v2 schema stable first (C2).

**Trigger to revisit.**

- After C2 ships.
- First user with multiple related n8n workflows that should be one persona.

## §I — Test fixtures cross-referenced from Lab scenarios

**What.** A capability's `test_fixtures` feed directly into Lab's scenario
test runner, so "run Lab against capability X's fixtures" is a one-click
action instead of manual JSON copy-paste.

**Why deferred.** Separate scenarios already exist in Lab; unifying requires
C5 (use_case_id on executions) plus C6 (Lab scope awareness) to be done first.

**Trigger to revisit.**

- After C6 ships.
- Users manually wiring fixtures into Lab scenarios frequently.

## §J — Budget / turn limits per capability

**What.** Allow `max_budget_usd` and `max_turns` overrides on a capability,
so a cheap classification capability can be budget-capped separately from a
deep analysis one.

**Why deferred.** Persona-level governance is sufficient for MVP. Complexity
of merging persona + capability caps (which wins? both? min of the two?)
isn't worth solving until we hear from users.

**Trigger to revisit.**

- A persona has a mix of cheap + expensive capabilities and the user is
  worried about a runaway on the expensive one.

## §K — C3 Rust integration tests (cascade + simulation) — **shipped 2026-04-19**

**Status.** Promoted out of backlog. Tests live in
`src-tauri/src/commands/core/use_cases.rs` `mod tests` and pass under
`cargo test --features desktop --lib commands::core::use_cases` (10/10).

**What landed.**

- Cascade core extracted into pure helper `cascade_use_case_toggle(&mut Conn, ...)`;
  IPC `set_use_case_enabled` now delegates to it (behavior identical, just
  testable). Session-pool invalidation stays in the IPC wrapper.
- Simulation input-build extracted into `build_simulation_input(use_case, override)`
  so the `_simulation: true` flag injection can be asserted in isolation.
- Tests:
  1. `cascade_disables_triggers_subscriptions_and_running_automations` —
     full SQL-state verification for 2 triggers + 3 subscriptions + 1
     running automation, plus `design_context.use_cases[i].enabled` patch.
  2. `cascade_reenable_resumes_triggers_and_subs_but_leaves_automations_paused`
     — pins the deliberate "operator must explicitly reactivate automations"
     contract.
  3. `cascade_rejects_unknown_use_case` — error path.
  4. `build_simulation_input_*` (×4) — override, sample fallback, missing
     sample, plain-text override.
  5. `dispatch_module_contains_simulation_short_circuit` — static guard
     that pins the `if ctx.is_simulation` + `[SIM]` markers in
     `engine/dispatch.rs`. Cheap proxy for the full mock-notifier
     integration test described below under "Still deferred".
- Hygiene fix: `engine/management_api.rs` test fixture missing
  `is_simulation` field on `PersonaExecution` literal — added so the test
  binary actually compiles.

**Still deferred (smaller scope).** A full mock-notifier integration test
that runs `simulate_use_case` end-to-end and asserts zero real notification
sends. Requires a constructible `AppHandle` mock and an `AppState` builder
that doesn't pull in the entire desktop runtime. The static dispatch-marker
test pins the contract until that harness exists.

## §M — C5 follow-up UI polish (deferred during 2026-04-19 ship)

**What.** Three UI surfaces could use deeper integration with capability
attribution beyond what shipped in C5:

1. **Capability title resolution in MemoryCard scope badge.** The badge in
   `MemoryCard.tsx` shows the raw `use_case_id` (truncated). The overview
   memory list aggregates across personas, so the badge cannot trivially
   reach `useSelectedUseCases()`. Add a join-friendly map (persona_id →
   {use_case_id → title}) populated alongside the persona list, and feed it
   into MemoryRow as a prop so the badge can render the human title instead
   of the slug.
2. **Dedicated capability filter on the manual reviews queue.** Reviews
   filter via the shared activity-feed dropdown today, but a top-level
   reviews UI (e.g. inside the persona's Use Case tab) would be a better
   home. Surface a "Reviews for this capability" view inside
   `PersonaUseCasesTab` once the C6 lab refinement work lands and the tab
   structure stabilizes.
3. **"Capability scope" picker when creating a memory manually.**
   `CreatePersonaMemoryInput.use_case_id` is now optional but the
   `CreateMemoryForm` doesn't expose it. Add a dropdown defaulted to the
   selected capability when the user opens the form from inside a
   capability context; default to "persona-wide" otherwise.

**Why deferred.** All three are reachable with the v1 surfaces (activity
feed already filters by capability; the badge shows the slug; manual
memories default to persona-wide which is the safe choice). Shipping them
required either touching unrelated UI scaffolding (#1, #2) or speculating
on a creation flow that hasn't been requested yet (#3).

**Trigger to revisit.**

- User feedback that "the violet badge is ugly because it shows a UUID"
  (#1).
- Manual review queue gets crowded enough that filtering inside the Use
  Case tab is meaningfully better than the activity feed dropdown (#2).
- A user requests scoping a learned memory to a specific capability via the
  UI (#3).

## §L — C3 execution history UI polish — **shipped 2026-04-19**

**Status.** Promoted out of backlog. Implemented across:

- `src/lib/bindings/PersonaExecution.ts` + `GlobalExecutionRow.ts` — added
  `is_simulation: boolean` field (mirrors Rust model; ts-rs will rewrite
  identically on next regen).
- `src/i18n/locales/en.json` — added `col_capability`, `show_simulations`,
  `hide_simulations`, `simulations_filter_tooltip`, `simulated_badge`,
  `simulated_badge_tooltip`, `capability_unattributed`. Types regenerated
  via `node scripts/i18n/gen-types.mjs`.
- `ExecutionListFilters.tsx` — new "Show/Hide simulations" toggle (only
  shown when at least one simulation row exists; FlaskConical icon, violet
  treatment).
- `ExecutionList.tsx` — wires `useSelectedUseCases()` to build a
  `use_case_id → title` map; filters `executions` by `showSimulations`;
  added `Capability` column to the desktop header (12-col grid: status 2,
  capability 2, duration 2, started 2, tokens 2, cost 2).
- `ExecutionListRow.tsx` — desktop row renders capability cell + violet
  "SIMULATED" badge (FlaskConical) next to the status badge; mobile card
  shows capability title on a second line and the same badge inline.

**Acceptance met.** Toggle filters the list; capability column resolves
`use_case_id` to title (em-dash when unattributed); simulation rows carry
the badge. `npx tsc --noEmit` clean; lint adds 0 new errors.

## How to promote an item out of this backlog

1. Confirm the trigger condition has fired.
2. Write a short RFC under `docs/concepts/persona-capabilities/rfc-<name>.md`:
   - What's changing
   - Why now (trigger evidence)
   - Schema/API/UI impact
   - Phases
3. Open a planning discussion (Slack thread, sync meeting).
4. Convert to a phase in [09-implementation-plan.md](09-implementation-plan.md).
5. Remove or annotate the item here ("Promoted to Phase CX, YYYY-MM-DD").

## Items **not** in this backlog

Things we explicitly rejected from scope, not just deferred:

- **Capabilities as sub-personas with independent identities.** We are not
  fragmenting identity; see [00-vision.md](00-vision.md) non-goals.
- **DAG composition between capabilities.** Event subscriptions are the
  composition primitive.
- **Capability-per-organization / multi-tenant capability registry.** Out of
  scope for the local-first model.
