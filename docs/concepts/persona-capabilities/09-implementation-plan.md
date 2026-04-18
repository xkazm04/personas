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

**Goal:** users can toggle capabilities, simulate them, run per-capability —
all from the Use Case tab. The persona-header Execute button is gone.

**Tasks (Rust):**

1. New IPC: `set_use_case_enabled(persona_id, use_case_id, enabled)`.
   - Single transaction: patch design_context JSON, cascade to triggers,
     subscriptions, automations; invalidate session pool.
2. New IPC: `simulate_use_case(persona_id, use_case_id, input_override?)`.
   - Wraps `execute_persona`, injects sample_input/fixture, marks execution
     with `is_simulation=true`.
3. Schema migration: add `is_simulation INTEGER NOT NULL DEFAULT 0` to
   `persona_executions` + index.
4. Dispatch layer: if `execution.is_simulation`, skip real notification send.

**Tasks (TS):**

1. `src/features/agents/sub_editor/components/PersonaEditorHeader.tsx`:
   - Remove Execute button, Cancel button, execution_started toast wiring.
   - Remove i18n keys (or retire them) for execute/cancel/execution_*.
2. `src/features/agents/sub_use_cases/`:
   - Expand `UseCaseRow` to show Enable toggle, Run button, Simulate button.
   - Wire Run → `executePersona(personaId, undefined, input, useCaseId)`.
   - Wire Simulate → `simulate_use_case(personaId, useCaseId, input)`.
   - Wire Toggle → `set_use_case_enabled(personaId, useCaseId, enabled)`.
   - Add confirmation dialog when disabling showing cascaded triggers/subs.
   - Show simulated runs with a SIMULATED badge in history.
3. `src/features/agents/sub_executions/`:
   - Add `is_simulation` filter toggle.
   - Add capability column to the execution list.

**Tasks (tests):**

1. Rust integration test for `set_use_case_enabled` — cascade verified.
2. Rust integration test for `simulate_use_case` — notification skipped,
   row tagged.
3. TS component test: `UseCaseRow` toggle fires IPC, disabled row visual.

**Deliverables:**

- Persona-header Execute gone
- Use Case tab is the run surface
- Simulations work end-to-end

## Phase C4 — Triggers/automations first-class

**Goal:** the Trigger Builder wires triggers to capabilities; Automations
can be scoped to capabilities.

**Tasks (TS):**

1. `src/features/triggers/sub_builder/`:
   - Rename/replace `PersonaConsumerNode` with `CapabilityConsumerNode`.
   - After user picks event source, show persona dropdown → capability
     dropdown.
   - Support "persona-wide" option (nullable `use_case_id`).
2. `src/features/agents/sub_connectors/components/automation/`:
   - Add capability dropdown to `AutomationSetupModal`.
   - Show capability badge on each automation card.

**Tasks (Rust):**

1. Event bus dispatch (`background.rs`): when an event matches multiple
   subscriptions, prefer capability-scoped over persona-wide.
2. Integration test for event routing: event fires → capability-scoped
   subscription handled first.

**Deliverables:**

- Trigger creation produces capability-scoped triggers by default
- Event routing respects capability scope when ambiguous

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
