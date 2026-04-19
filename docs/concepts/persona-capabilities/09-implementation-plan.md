# 09 — Implementation Plan

> Ordered phases, each committable and revertible. Every phase ends with
> green `npx tsc --noEmit` and `npx vite build`, plus the Rust tests still
> passing.
>
> **No backward compatibility required** — pre-production, no legacy personas.

## Sequencing (with rationale)

```
C1 → C2 → C3 → C4 → C5 → C6
│    │    │    │    │    │
│    │    │    │    │    └── Lab per-use-case (RFC-gated)
│    │    │    │    └─────── Per-capability messages/reviews/memories
│    │    │    └──────────── Triggers + automations first-class (UI)
│    │    └───────────────── UI activation (toggle, simulate, remove Execute)
│    └────────────────────── Building pipeline rewrite + template v2 + 107 migrations
└─────────────────────────── Runtime foundation (prompt + session cache + enabled field)
```

**Why this order:**

- C1 lands the runtime behavior changes with no UI or UX impact (safe toehold).
- C2 has to come before C3, because UI toggles depend on properly linked
  capabilities, which depend on templates + CLI producing them correctly.
- C3 is where the UX visibly changes; landing it after C2 means every new
  persona already has capabilities in the right shape.
- C4 expands the first-class treatment to triggers/automations in the UI.
- C5 deepens attribution (messages/reviews/memories) — needs schema adds,
  so it's batched separately.
- C6 is the most complex (Lab refinement per capability, versioning) and
  benefits from everything else being stable first. RFC-gated.

## Phase C1 — Runtime foundation

> **Status: SHIPPED (uncommitted) — 2026-04-19.**
> 9/9 C1 unit tests pass (`engine::prompt::tests::c1_*`).
> `npx tsc --noEmit` + `npx vite build` + `cargo check --features desktop` clean.
> Changes in: `persona.rs`, `prompt.rs`, `executions.rs` (command), `frontendTypes.ts`.
> Incidental hygiene fix: `credentials.rs` test compilation (2 `create` → `create_with_fields` sites) to unblock the C1 test suite.

**Goal:** the runtime reads `design_context.useCases`, injects a Capabilities
section, and honors the `enabled` flag. No UI changes.

**Tasks (Rust):**

1. `src-tauri/src/db/models/persona.rs` — add `enabled: Option<bool>` and
   `capability_summary: Option<String>` and `tool_hints: Option<Vec<String>>`
   to `DesignUseCase` with `#[serde(default)]`. No migration (JSON field).
2. `src-tauri/src/engine/prompt.rs`:
   - Promote the existing advisory-mode use-case rendering (~line 1380) into
     the main `assemble_prompt` flow.
   - New helper `render_active_capabilities(design_context: &str) -> String`
     that filters by `enabled != Some(false)`.
   - Renders as `## Active Capabilities\n- **{title}**: {capability_summary
     or description}. Trigger: {trigger_description}. Notifications:
     {channels}. Tools: {tool_hints}.`
   - If `input_data._use_case` is present, render a `## Current Focus`
     section too.
3. `src-tauri/src/commands/execution/executions.rs::execute_persona`:
   - After loading persona, if `use_case_id` is `Some`, parse design_context,
     find the capability, verify `enabled != Some(false)` (error if disabled),
     merge capability into `input_data._use_case` and `_time_filter`.
   - Apply `use_case.model_override` to the effective model profile.
   - Update the session hash to include structured_prompt + active capability
     fingerprint.
4. `src-tauri/src/engine/background.rs::scheduler_tick`:
   - Verify triggers already pass `use_case_id` (they do).
   - No new code, just a comment noting the flow.
5. Add Rust integration tests under `src-tauri/tests/phase_c1_runtime.rs`:
   - Persona with 3 capabilities, 2 enabled, 1 disabled → prompt assembly
     produces exactly 2 entries in `## Active Capabilities`.
   - Session hash differs when a capability is disabled vs enabled.
   - `execute_persona` with disabled `use_case_id` returns error.

**Tasks (TS):**

1. `src/lib/types/frontendTypes.ts` — add `enabled?: boolean`,
   `capability_summary?: string`, `tool_hints?: string[]` to `DesignUseCase`.
2. Regenerate bindings if codegen is present.

**Deliverables:**

- `cargo test -p personas` green
- `npx tsc --noEmit` green
- `npx vite build` green
- Existing UI shows no changes (no new surfaces yet)

**Revert path:** all additions are additive. Backing out = deleting the new
prompt section render + the auto-inject block; no data loss.

## Phase C2 — Building pipeline + template v2 + migrations

> **Status: IN PROGRESS (separate CLI session).**
> As of 2026-04-19 the working tree contains an uncommitted `agent_ir.rs` with
> `AgentIrTrigger.use_case_id` plus expanded `AgentIrUseCaseData` fields
> (notification_channels, model_override, tool_hints, capability_summary,
> enabled) — matches this phase's Rust task #1. A working document
> `docs/concepts/persona-capabilities/C2-template-audit.md` also exists.
> Template migration (107 files + mapping script) and the CLI build-prompt
> changes are unfinished.
>
> **For a resuming session:** verify those files are present and continue
> where this task list indicates.

**Goal:** CLI and templates produce v2 AgentIr with semantic trigger
linkage, v2 structured_prompt, and properly shaped capabilities. All 107
templates migrated.

**Tasks (Rust):**

1. `src-tauri/src/db/models/agent_ir.rs`:
   - Add `use_case_id: Option<String>` to `AgentIrTrigger`.
   - Add new fields to `AgentIrUseCaseData`: `notification_channels`,
     `model_override`, `test_fixtures`, `tool_hints`, `capability_summary`,
     `enabled` (all optional with serde default).
2. `src-tauri/src/commands/design/build_sessions.rs::create_triggers_in_tx`:
   - Prefer `trigger.use_case_id` from IR; fall back to positional.
3. `src-tauri/src/commands/design/template_adopt.rs`:
   - Add `schema_version: Option<u8>` on the template payload; route v2
     templates through `adopt_v2`. v1 returns an error (all templates are
     migrated in one pass; none remain).
4. CLI prompt (the dimension framework text — audit `build_session.rs` and
   any adjacent `.md` prompt files):
   - Rewrite dimensions to place `use-cases` first.
   - Tell the LLM to emit `use_case_id` on each trigger referencing the
     capability it fires.
   - Tell the LLM to produce v2 `structured_prompt` with voice, principles,
     constraints, decision_principles.

**Tasks (templates):**

1. Write `scripts/migrate_templates_v2.mjs` (Node script):
   - Walks `scripts/templates/**/*.json`.
   - For each v1 template, applies the mapping rules from
     [06-building-pipeline.md](06-building-pipeline.md) §107-template migration.
   - Writes the v2 file next to the v1 (or in place with `git diff` review).
2. Run on all 107 templates; commit the diff.
3. For each template, hand-review and hand-write `voice`, `principles`,
   `constraints`, `decision_principles` in the new `structured_prompt` fields
   (the migration script leaves these empty with a `# TODO` comment).

**Tasks (tests):**

1. Unit tests for `create_triggers_in_tx` with v2 IR (semantic linkage).
2. End-to-end test: adopt three v2 templates (stock-analyst, customer-feedback,
   autonomous-issue-resolver) and verify design_context + triggers + subscriptions.

**Deliverables:**

- All 107 templates have `schema_version: 2`
- Integration test suite passes for both "from-scratch CLI" and "from-template" flows
- CLI-generated personas have capability-attributed triggers

**Revert path:** templates can be reverted from git. Rust changes (adding
fields) are additive; code that only reads old fields still works.

## Phase C3 — UI activation + Execute button relocation

> **Status: SHIPPED — core scope (uncommitted) — 2026-04-19.**
> Two sub-tasks deferred to a follow-up commit (see below).
> `npx tsc --noEmit` + `npx vite build` + `cargo check --features desktop` clean.
>
> Files touched (C3):
> - **Backend**: `src-tauri/src/db/models/execution.rs`,
>   `src-tauri/src/db/repos/execution/executions.rs`,
>   `src-tauri/src/db/migrations/incremental.rs`,
>   `src-tauri/src/commands/execution/executions.rs`,
>   `src-tauri/src/commands/core/mod.rs`,
>   `src-tauri/src/commands/core/use_cases.rs` (new),
>   `src-tauri/src/engine/dispatch.rs`,
>   `src-tauri/src/engine/runner.rs`,
>   `src-tauri/src/engine/mod.rs`,
>   `src-tauri/src/lib.rs`.
> - **Frontend**: `src/api/agents/useCases.ts` (new),
>   `src/features/agents/sub_use_cases/libs/useCapabilityToggle.ts` (new),
>   `src/features/agents/sub_use_cases/components/core/CapabilityDisableDialog.tsx` (new),
>   `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTab.tsx`,
>   `src/features/shared/components/use-cases/UseCaseRow.tsx`,
>   `src/features/agents/sub_editor/components/PersonaEditorHeader.tsx`.

**Goal:** users can toggle capabilities, simulate them, run per-capability —
all from the Use Case tab. The persona-header Execute button is gone.

**Tasks (Rust):** — all shipped

1. ✅ New IPC: `set_use_case_enabled(persona_id, use_case_id, enabled)` plus `get_use_case_cascade(persona_id, use_case_id)` preview.
   - Single transaction: patch design_context JSON, cascade to triggers,
     subscriptions, automations; invalidate session pool.
2. ✅ New IPC: `simulate_use_case(persona_id, use_case_id, input_override?)`.
   - Refactored `execute_persona` body into private `execute_persona_inner(..., is_simulation: bool)`;
     `simulate_use_case` passes `true`. Auto-resolves `sample_input` from the use case.
   - Simulations **bypass** the `enabled` gate so disabled capabilities can still be tested.
3. ✅ Schema migration: added `is_simulation INTEGER NOT NULL DEFAULT 0` to
   `persona_executions` + `idx_pe_simulation` index.
4. ✅ Dispatch layer: `DispatchContext.is_simulation` flag; when true,
   `notify_new_message`/`notify_manual_review` pushes are skipped (DB rows still written).
   Execution-completed notifications skipped in `engine/mod.rs` for simulation runs.

**Tasks (TS):** — all shipped

1. ✅ `PersonaEditorHeader.tsx`: Execute + Cancel buttons removed; only the
   Active governance toggle remains. Stale execution_started toast wiring dropped.
2. ✅ `UseCaseRow.tsx`:
   - Power toggle (enable/disable) wired to `set_use_case_enabled`.
   - Simulate button (FlaskConical) wired to `simulate_use_case`.
   - Disabled capabilities grey out + "PAUSED" badge.
   - `capability_summary` shown in place of description when present.
3. ✅ `useCapabilityToggle.ts` hook orchestrates the flow with cascade-preview.
4. ✅ `CapabilityDisableDialog.tsx` — confirmation modal showing exact counts
   of triggers/subscriptions/automations that will be paused.

**Tasks (tests):** — partially deferred

1. ⏸ **DEFERRED — Rust integration test for `set_use_case_enabled`** (cascade verified end-to-end).
   See [10-deferred-backlog.md](10-deferred-backlog.md) §K.
2. ⏸ **DEFERRED — Rust integration test for `simulate_use_case`** (notification skipped, row tagged).
   See [10-deferred-backlog.md](10-deferred-backlog.md) §K.
3. *No TS component test yet* — manual verification via dev server.

**Tasks deferred out of C3 scope:**

- ⏸ **DEFERRED — Execution history UI (`src/features/agents/sub_executions/`):**
  add `is_simulation` filter toggle and a capability column to the execution list.
  Pure UI polish; backend column is shipped and `PersonaExecution.is_simulation`
  is already serialized to the frontend. See [10-deferred-backlog.md](10-deferred-backlog.md) §L.

**Deliverables:**

- Persona-header Execute gone
- Use Case tab is the run surface
- Simulations work end-to-end

## Phase C4 — Triggers/automations first-class — **SHIPPED 2026-04-19**

**Goal:** the Trigger Builder wires triggers to capabilities; Automations
can be scoped to capabilities.

**Status.** Shipped. The active code path (UnifiedRoutingView → AddPersonaModal
→ `link_persona_to_event`) now threads `use_case_id` through Rust, TS API,
and UI. The Automation modal has a capability-scope dropdown and cards
render a capability badge. Event-bus dispatch prefers capability-scoped
matches over persona-wide ones via a new `prefer_capability_scoped` helper.

**Landed — Rust:**

- `engine/bus.rs` — new `prefer_capability_scoped(Vec<EventMatch>)` helper:
  when a persona has both scoped + persona-wide matches, persona-wide is
  dropped; different capabilities still dispatch independently;
  `(persona_id, use_case_id)` tuples are deduped to prevent double-fire
  from the legacy-subs + event_listener-triggers merge path. 6 new tests
  pin the rules.
- `engine/background.rs:666-675` — uses `prefer_capability_scoped` in place
  of the old persona_id-only dedupe at the event-bus tick.
- `db/repos/resources/triggers.rs::link_persona_to_event` — now accepts
  `use_case_id: Option<&str>` and threads it into the INSERT. All 8
  existing repo tests updated with trailing `None` for persona-wide;
  39 tests still pass.
- `commands/tools/triggers.rs::link_persona_to_event` IPC command —
  accepts `use_case_id: Option<String>` and forwards to repo.
- `engine/platforms/deploy.rs::DeployAutomationInput.use_case_id` —
  already present (pre-C4), now actually set by the UI.

**Landed — TS:**

- `src/api/pipeline/triggers.ts::linkPersonaToEvent` — new signature
  `(personaId, eventType, { handlerText?, useCaseId? })`. Options bag
  keeps the common case (no options) clean.
- `src/features/triggers/sub_builder/layouts/AddPersonaModal.tsx` —
  two-step flow: pick persona → if persona has enabled capabilities, pick
  "Persona-wide" or a specific capability; otherwise skip step 2.
- `src/features/triggers/sub_builder/layouts/routingHelpers.tsx` —
  `Connection.useCaseId` populated for trigger-listener connections;
  dedupe key widened to `(personaId, useCaseId)` so the same persona can
  listen to one event via multiple capabilities.
- `src/features/triggers/sub_builder/layouts/UnifiedRoutingView.tsx` —
  resolves `use_case_id` → capability title from the persona's
  design_context and renders it as a violet badge on the `PersonaChip`.
- `src/features/agents/sub_connectors/libs/useAutomationSetup.ts` —
  derives `availableUseCases` from the persona's design_context; exposes
  `useCaseId`/`setUseCaseId`; threads `useCaseId` into `deployAutomation`
  and loads existing `editAutomation.useCaseId` on edit.
- `src/features/agents/sub_connectors/components/automation/AutomationTriggerStep.tsx` —
  new "Capability scope" dropdown (only rendered when persona has
  capabilities); defaults to persona-wide.
- `src/features/agents/sub_connectors/components/automation/AutomationCard.tsx` —
  renders a cyan capability badge with `Layers` icon when
  `automation.use_case_id` is set; resolves title via
  `useSelectedUseCases()`.

**Note on the ReactFlow canvas path.** `PersonaConsumerNode.tsx`,
`reconcileCanvasWithTriggers`, `useEventCanvasActions`, and friends are
**dead code** on master — imported by no live component. The plan's
"Rename PersonaConsumerNode → CapabilityConsumerNode" task was skipped as
pure churn; the live path is the table view in `UnifiedRoutingView`.
Delete-or-revive is backlog §M territory if that canvas ever resumes.

**Tests.** 23 bus tests (6 new for preference helper) + 10 use_cases
tests + 39 triggers repo tests all green under
`cargo test --features desktop`. `npx tsc --noEmit` and `npx vite build`
clean.

**Original task list (for history):**

1. ~~`src/features/triggers/sub_builder/`: rename PersonaConsumerNode →
   CapabilityConsumerNode~~ — skipped, dead code path.
2. Capability dropdown on new triggers — delivered via AddPersonaModal
   step 2 + Automation trigger-step dropdown.
3. Event bus dispatch prefers capability-scoped — delivered via
   `prefer_capability_scoped` helper.
4. Integration test for event routing — delivered as 6 bus.rs unit tests
   covering the merge + preference path (full DB-level integration belongs
   alongside a broader event-bus test harness, not this phase).

## Phase C5 — Messages/reviews/memories per use case

**Goal:** attribute messages, reviews, and memories to capabilities. Enable
per-capability queues and scoped learned memory.

**Tasks (schema):**

1. Migration: add `use_case_id TEXT` to:
   - `persona_manual_reviews` + index
   - `persona_messages` + index
   - `persona_memories` + index

**Tasks (Rust):**

1. `message_repo::create` — accept optional `use_case_id`, inherit from
   execution when not explicit.
2. `review_repo::create` — same.
3. `memory_repo::create` — scoped by tier + use_case_id rules per
   [04-data-model.md](04-data-model.md).
4. `memory_repo::get_for_injection_v2(persona_id, use_case_id: Option<&str>)` —
   replaces v1 caller. Update `runner.rs:484` to pass execution's
   `use_case_id`.
5. Dispatch precedence: use capability `notification_channels` before falling
   back to persona-wide.
6. New queries: `get_by_use_case_id` for messages, reviews, memories.

**Tasks (TS):**

1. Activity feed: capability filter on messages + reviews.
2. Manual reviews UI: per-capability filter.
3. Memory editor: show capability scope, allow creating capability-scoped
   memory.

**Deliverables:**

- Messages, reviews, memories carry capability attribution
- Learned memory tier is correctly scoped (verified via runtime tests)

## Phase C6 — Lab per-use-case (RFC-gated)

**Goal:** Lab can refine whole persona or specific capabilities; versioning
tracks scope.

**Preconditions:**

1. RFC finalized (see [07-lab-versioning.md](07-lab-versioning.md) open questions).
2. C1–C5 in production for at least one internal cycle so we have real
   usage data to inform the merge algorithm.

**Tasks:** See [07-lab-versioning.md](07-lab-versioning.md).

## Cross-phase hygiene

Every phase ends with:

- `npx tsc --noEmit` green
- `npx vite build` green
- `cargo test -p personas` green (add new tests as features land)
- Locale parity check: any new i18n keys added to `src/i18n/locales/en.json`
  and types regenerated via `node scripts/i18n/gen-types.mjs`
- Update this doc's status table in [README.md](README.md)
- Commit with a clear message and reference to the phase doc

## Effort estimate (calendar)

Assuming one focused engineer:

| Phase | Effort | Notes |
|---|---|---|
| C1 | 2–3 days | Mostly Rust; TS is trivial |
| C2 | 5–7 days | 107-template migration is the long tail |
| C3 | 4–5 days | UI surface work |
| C4 | 3–4 days | Trigger Builder overhaul |
| C5 | 3–4 days | Schema + repo + UI |
| C6 | 7–10 days | RFC + implementation |
| **Total** | **~5 weeks** | Sequential; C6 can slip without blocking earlier phases |

## Handoff markers

After each phase, update:

- [README.md](README.md) status table
- Relevant phase doc header — add "Shipped YYYY-MM-DD, commit ${sha}"
- Any open items discovered during implementation → added to
  [10-deferred-backlog.md](10-deferred-backlog.md) with triggers for when to
  revisit

## If context resets mid-phase

A new Claude session should:

1. Read [README.md](README.md) for status + reading order.
2. Read [00-vision.md](00-vision.md) for mental model.
3. Read the specific phase doc here.
4. Read any adjacent pillar/data docs referenced.
5. Run `git log --oneline -20` to see recent commits.
6. Check task list (`TaskList` tool) for any in-progress items.
7. Resume from the last completed task.

Every phase's doc contains enough context to execute without re-reading the
other phases (citations are absolute, not relative).
