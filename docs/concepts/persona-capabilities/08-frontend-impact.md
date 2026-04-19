# 08 — Frontend Impact

> UI surfaces that change, why, and when.

## Core decisions (confirmed)

1. **The persona-level Execute button is removed** from `PersonaEditorHeader`.
2. Per-capability Run / Simulate live in the **Use Case tab** (expanded in C3).
3. **Chat stays persona-scoped**. The CLI-aware LLM routes internally to the
   right capability context.
4. **Lab stays persona-scoped** by default, with optional per-capability refinement mode (C6).
5. **Sidebar does not list capabilities.** Capabilities live in the Use Case tab.
6. No legacy personas exist, so migration affordances in the UI are unnecessary.

## Tab-by-tab changes

### Use Case tab (`src/features/agents/sub_use_cases/`)

**Biggest investment.** Becomes the capability management surface.

Post-C3:

- Replaces `UseCaseRow` with an expanded card showing:
  - Enable/disable toggle (wired to `set_use_case_enabled`)
  - Title, capability_summary
  - Trigger summary ("Mondays 8am" / "polling every 15 min" / "event: gov_filing_published" / "manual")
  - Notification channel summary (email, slack, etc.)
  - Model profile (inherited or override)
  - Run button (per-capability manual execution)
  - Simulate button (runs with sample_input, skips dispatch)
  - Config expand — input_schema, sample_input, test_fixtures editor
  - History expand — lists executions filtered by `use_case_id`, with Simulated tagged
- List → Capability Map toggle deferred (see [10-deferred-backlog.md](10-deferred-backlog.md) §D)

Run button payload:

```typescript
await executePersona(
  personaId,
  /* triggerId */ undefined,
  /* inputData */ JSON.stringify(userProvidedOrSampleInput),
  /* useCaseId */ capability.id,
);
```

Simulate button calls a new `simulate_use_case(personaId, capabilityId, inputOverride?)` command.

### Persona Editor Header (`src/features/agents/sub_editor/components/PersonaEditorHeader.tsx`)

- **Remove the Execute button** (introduced in Phase 1 of this session).
- **Remove the Cancel button** that paired with it.
- Keep the Active toggle (persona enable/disable — governance, different from capability enable/disable).
- Keep the readiness/health indicators.
- Active cancellation moves to the execution row in history or to the capability card when a per-capability run is in progress.

### Design hub (`src/features/agents/sub_design/` — existing from Phase A+B)

Unchanged structurally. Internals shift:

- **Design sub-tab**: the LLM-driven design flow continues; when the user
  requests a refinement, the sub-tab presents "Refine [persona core /
  capability X / multiple capabilities]" (hooks into Lab C6).
- **Prompt sub-tab** (PersonaPromptEditor): edits the persona-wide
  structured_prompt. After C2, the editor gains sections for the new v2
  fields (voice, principles, constraints, decision_principles).
- **Connectors & Tools sub-tab**: unchanged. Tools remain persona-scoped.
- **Health badge**: unchanged.

### Trigger Builder (`src/features/triggers/sub_builder/`)

Post-C4:

- The event-source node remains. The downstream "consumer" node changes from
  `PersonaConsumerNode` to `CapabilityConsumerNode`.
- When the user selects a persona, a second dropdown appears: "Which capability?"
  populated from `design_context.useCases`, defaulted to the most recently
  edited capability.
- A "persona-wide trigger" option exists for rare cases (shows as a subtle
  note: "This trigger will fire regardless of any specific capability").
- Existing personas without capabilities (none at C4 since greenfield) don't
  need a fallback.

### Automations (`src/features/agents/sub_connectors/components/automation/`)

Post-C4:

- `AutomationSetupModal` gets a "Applies to capability:" dropdown, defaulting
  to "All capabilities" (which maps to `use_case_id = NULL`).
- Existing capability-scoped automations display the capability badge on the card.

### Chat (`src/features/agents/sub_chat/`)

**No structural change in C1–C5.** Chat remains persona-scoped. The persona's
prompt already contains the Capabilities section (post-C1), so the LLM knows
its full repertoire. For ad-hoc chat, no `use_case_id` is passed; the model
picks context from message content.

Optional (later, not in the plan): a "Focus on [capability]" affordance inside
Chat for users who want to pin context. Deferred — see
[10-deferred-backlog.md](10-deferred-backlog.md) §E.

### Activity feed (`src/features/agents/sub_activity/`)

Post-C3:

- Add a "Capability" filter dropdown above the feed.
- Executions show a capability badge; simulations show a SIMULATED tag.
- Messages + reviews show their capability attribution (post-C5 when columns land).

### Execution history (`src/features/agents/sub_executions/`)

Post-C3:

- Add a capability column and filter.
- Filter simulations in/out via toggle.
- Clicking an execution shows the capability it ran under.

### Lab (`src/features/agents/sub_lab/`)

- C1–C5: unchanged. Lab operates persona-wide.
- C6: scope picker on Matrix start ("Persona / Capability / Multi-capability").
  Version list gains scope badges.

### Overview (`src/features/overview/`)

- No change in C1–C5. Personas listed as today.
- Post-C6 optional: "capabilities overview" across all personas, deferred to
  [10-deferred-backlog.md](10-deferred-backlog.md) §F.

### Sidebar (`src/features/shared/components/layout/sidebar/`)

Unchanged. Personas remain the primary navigation unit. No capability nesting.

## API surface changes

| IPC command | Change | Phase |
|---|---|---|
| `execute_persona` | accepts `useCaseId`; now **auto-expands** to input_data | C1 |
| `set_use_case_enabled` | NEW — toggle cascade | C2 |
| `simulate_use_case` | NEW — simulation wrapper | C3 |
| `cancel_execution` | unchanged | — |
| `list_executions_for_use_case` | already exists; adds `is_simulation` filter | C3 |
| `lab_start_matrix` | gains `scope` + `target_use_case_ids` | C6 |
| `lab_accept_matrix_draft` | branches on scope | C6 |
| `lab_rollback_version` | branches on scope | C6 |

## Frontend stores

- `useSystemStore` (`src/stores/slices/system/uiSlice.ts`) — unchanged for C1.
  No need for a new `selectedUseCaseId` at the global level; the Use Case tab
  can hold it locally.
- `useAgentStore` — existing `executionSlice`, `chatSlice`, `labSlice` all
  already accept `useCaseId` params where needed. No new slice required for
  C1–C5.
- **Maybe add `useCasesSlice`** in C3 if the Use Case tab accumulates enough
  state that local React state isn't enough — evaluate when writing C3.

## Breaking UX (unavoidable, documented)

| Change | User-visible impact | Mitigation |
|---|---|---|
| Persona-header Execute button removed | Users who relied on "one-click run" lose it | Per-capability Run buttons in Use Case tab; clearer mental model |
| Trigger Builder asks "which capability?" | Extra step when creating triggers | Default to "persona-wide" for backward-compat feel (nullable use_case_id) |
| Automations can be scoped to capabilities | More expressive, slightly more choice | Default remains "all capabilities" |
| Simulated executions tagged distinctly | Users see a new SIMULATED badge | Clear visual treatment; badge explains itself |

None of these are regressions — they're expansions. The only **removal** is
the persona-header Execute button, and the replacement (per-capability Run)
is strictly more capable.
