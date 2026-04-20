# C4 — Build-From-Scratch v3 Handoff

> **Purpose**: Transform the "build a persona from an intent" flow so user
> input lands as a v3-shaped `AgentIr` (behavior core + nested
> capabilities) instead of the v2 flat 8-dimension output. Covers: the
> current flow, gap analysis, new CLI prompt framework, new matrix UI
> layout, transformation pipeline, and an e2e test harness that mirrors
> the adoption framework.
>
> **Corrected mental model (from the user)**: the persona behavior core
> is **not** "tone of voice". It is **the common goal/mission that unites
> every capability under one identity**. Voice is a secondary part of
> core; the primary job of core is *shared purpose*.

---

## 1. Current State — What Happens Today

### 1.1 Flow map

```
src/features/agents/components/matrix/UnifiedMatrixEntry.tsx
  intentText (user types the goal)
  handleLaunch → invokeWithTimeout("start_build_session", { persona_id, intent, ... })
        │
        ▼
src-tauri/src/commands/design/build_sessions.rs::start_build_session
  state.build_session_manager.start_session(...)
        │
        ▼
src-tauri/src/engine/build_session.rs::start_session
  • Creates DB row in build_sessions
  • Assembles build_session_prompt(intent, creds, connectors, template_context, language)
  • Spawns tokio task: run_session(...)
        │
        ▼
src-tauri/src/engine/build_session.rs::run_session
  • Spawns Claude CLI subprocess with cli_args (model: claude-sonnet-4)
  • Pipes the system_prompt to stdin
  • Reads line-delimited JSON from stdout:
      - {"dimension": "use-cases", "status": "resolved", "data": {...}}
      - {"dimension": "connectors", "status": "pending", ...}
      - {"question": "...", "dimension": "...", "options": [...]}
      - {"agent_ir": {...}}   ← final output
  • Emits BuildEvent::cell_update, ::question, ::agent_ir back to the frontend channel
        │
        ▼
src/stores/slices/agents/matrixBuildSlice.ts
  • handleBuildCellUpdate → patches buildCellData[cellKey]
  • handleBuildQuestion   → appends to buildPendingQuestions
  • handleBuildAgentIr    → stores the full agent_ir JSON as buildDraft
        │
        ▼
User iterates via the matrix (edits cells, answers questions, refines).
User hits "Test Agent" → promote_build_draft (adoption-style) with the agent_ir.
```

### 1.2 The dimension framework (current)

`build_session_prompt` instructs the LLM to emit 8 parallel dimensions:

1. `use-cases` — WHAT the agent does (tasks / business logic)
2. `connectors` — WHICH services (external APIs)
3. `triggers` — WHEN it runs
4. `messages` — HOW it notifies
5. `human-review` — WHAT needs approval
6. `memory` — WHAT to remember
7. `error-handling` — WHAT can go wrong
8. `events` — WHAT to observe

Each dimension is resolved independently; agent_ir is assembled at the
end as a flat bundle. The only linkage between dimensions is
`use_cases[i].category` + implicit positional pairing.

### 1.3 The output shape (what agent_ir currently looks like)

```jsonc
{
  "agent_ir": {
    "name": "...", "description": "...", "system_prompt": "...",
    "structured_prompt": {
      "identity": "<prose blob>",
      "instructions": "<prose blob>",
      "toolGuidance": "...", "examples": "...", "errorHandling": "..."
    },
    "icon": "email", "color": "#...",
    "tools": [...],                          // flat list
    "triggers": [...],                       // flat list (NO use_case_id tag)
    "required_connectors": [...],            // flat list
    "use_cases": [
      { "title": "...", "description": "...", "category": "..." }
    ],
    "design_context": { "use_cases": [...] },
    "human_review": {}, "messages": {}, "memory": {}, "error_handling": {}, "events": []
  }
}
```

**Everything is flat.** Triggers/connectors/events sit at the top level
with no linkage to the use case that owns them. The `structured_prompt`
is an opaque prose blob — no decomposed mission/principles/constraints.

### 1.4 The UI (current)

`PersonaMatrix` renders 8 cells in a 3×3 grid (center is the Command
Hub). Each cell is one dimension. Editing happens via
`DimensionEditPanel` / `DimensionQuickConfig` per cell. The user
experience treats the 8 dimensions as peer categories.

---

## 2. Gap Analysis — What v3 Demands

### 2.1 The shape target (per C3)

```jsonc
{
  "agent_ir": {
    "name": "...", "description": "...", "icon": "...", "color": "...",
    "persona": {
      "mission": "...",                          // NEW — primary element
      "identity": { "role": "...", "description": "..." },
      "voice": { "style": "...", "output_format": "..." },
      "principles": [...],
      "constraints": [...],
      "decision_principles": [...],
      "verbosity_default": "normal",
      "operating_instructions": "...",
      "tool_guidance": "...",
      "error_handling": "...",
      "tools": [...],                            // shared pool
      "connectors": [...],                       // persona-wide registry
      "notification_channels_default": [...],
      "core_memories": []
    },
    "use_cases": [
      {
        "id": "uc_...", "title": "...", "description": "...",
        "capability_summary": "...",
        "enabled_by_default": true,
        "suggested_trigger": { trigger_type, config, description },
        "connectors": ["name_ref"],
        "notification_channels": [...],
        "review_policy": { mode, context },
        "memory_policy": { enabled, context },
        "event_subscriptions": [...],
        "input_schema": [...], "sample_input": {...},
        "tool_hints": [...], "use_case_flow": { nodes, edges }
      }
    ]
  }
}
```

### 2.2 What the current flow doesn't do

| v3 requirement | Current state | Gap |
|---|---|---|
| Extract a shared mission before anything else | LLM dives into 8 dimensions immediately | Prompt must establish the shared goal first |
| Treat capabilities as the primary unit | 8 peer dimensions | Reframe: capabilities ARE primary, 6 of the 8 dimensions are per-capability sub-fields |
| Attribute each trigger to its use_case | `triggers[]` is flat | Emit triggers WITH `use_case_id` from the start |
| Attribute each event to its use_case | `events[]` is flat | Same — scoped per capability |
| Per-capability notification channels | Global `messages` dimension | Nest under capability |
| Per-capability review policy | Global `human-review` dimension | Nest under capability with mode enum |
| Per-capability memory policy | Global `memory` dimension | Nest under capability with enabled + context |
| Decomposed `structured_prompt` | Opaque prose blob | Split into mission/identity/voice/principles/constraints/decision_principles |
| Principles + Constraints + Decision_principles | Not separately captured | Prompt must extract these as distinct arrays |

### 2.3 UI mismatch

The 3×3 matrix with peer dimensions tells the wrong story. In v3:

- **Top band**: the mission + identity + voice (behavior core)
- **Middle band**: a capability list — each row expandable
- **Right rail**: shared resources (tools, connectors, principles, constraints)

The old matrix is dimension-first; the new UI should be
**capability-first**, with each capability row showing its full chain
(trigger → connectors → review → memory → events) inline (exactly what
the chronology prototypes Chain / Wildcard already do — but as the
editing surface, not a read-only preview).

---

## 3. New CLI Prompt — The "Capability Framework"

### 3.1 Three-phase framework (replaces the 8-dimension framework)

```
Phase A — Mission & Identity (behavior core)
Phase B — Capability enumeration
Phase C — Per-capability resolution (parallel per capability)
```

### 3.2 Phase A — Mission & Identity

Before resolving anything, the LLM must answer:

1. **Mission**: one sentence that would make sense across every job this
   persona does. Not "it triages email" — that's a capability.
   Something like *"Be the user's most trusted email-attention
   gatekeeper — nothing surfaces that hasn't earned it."*
2. **Identity role**: *"You are X"* — 1 sentence.
3. **Identity description**: *1-line elaboration of purpose*.
4. **Voice**: style + output format, 1-2 sentences each.
5. **Principles**: 2-5 cross-cutting rules the persona always honors.
6. **Constraints**: 2-5 hard limits. Breaking them is a bug.
7. **Decision_principles**: 0-5 tiebreakers.
8. **Verbosity default**: terse | normal | verbose.

The LLM emits a single `behavior_core` event:

```jsonc
{ "behavior_core": {
    "mission": "...",
    "identity": { "role": "...", "description": "..." },
    "voice": { "style": "...", "output_format": "..." },
    "principles": [...],
    "constraints": [...],
    "decision_principles": [...],
    "verbosity_default": "normal"
}}
```

**Rule**: if the user's intent is vague, emit a `clarifying_question`
on the **mission** before resolving anything else. Example options:

- "A: Daily briefing assistant — surface overnight signal once per day"
- "B: Real-time monitor — alert the moment a threshold trips"
- "C: Interactive advisor — respond to user queries on demand"

User picks → mission becomes concrete → phase B begins.

### 3.3 Phase B — Capability Enumeration

The LLM now lists the **distinct capabilities** that realize the
mission. Rule of thumb: a capability is something the user would say
"turn X off" about.

Emit:

```jsonc
{ "capabilities_draft": [
    { "id": "uc_morning_digest",
      "title": "Morning Digest",
      "capability_summary": "Once-daily ranked summary of overnight email.",
      "user_facing_goal": "Start my day knowing what's critical in the inbox." },
    { "id": "uc_weekly_review",
      "title": "Weekly Review",
      "capability_summary": "Sunday-evening pattern roll-up over the past 7 days.",
      "user_facing_goal": "See whether my attention allocation matched what mattered." }
]}
```

**Constraint on granularity**:
- Error-recovery flows ≠ capabilities (they're internal mechanisms).
- Attention-escalation flows ≠ capabilities (they're events from a capability).
- Setup/initialization ≠ capability (it's inlined in `operating_instructions`).
- Multiple schedules (hourly + daily + weekly) → multiple capabilities, each with 1 schedule.

If 2+ capabilities share ALL traits except trigger → still multiple
capabilities. If they share trigger AND output → likely ONE capability
with a sample_input parameter.

Again, emit a `clarifying_question` on capability granularity if
ambiguous. Options should be labelled "single capability with X" vs
"two capabilities: Y and Z" so the user can pick the split.

### 3.4 Phase C — Per-Capability Resolution

For each capability in the enumeration, resolve its full envelope.
These can be parallelised across capabilities; within a capability the
order is:

1. `suggested_trigger` — single trigger object, or null for manual-only.
2. `connectors[]` — names referencing the persona-wide connector registry.
3. `notification_channels[]` — per-capability delivery, or [] to inherit default.
4. `review_policy` — `{ mode, context }` with mode in {never, on_low_confidence, always}.
5. `memory_policy` — `{ enabled, context }`.
6. `event_subscriptions[]` — `[{ event_type, direction, description }]` (direction: emit | listen).
7. `input_schema[]` + `sample_input` — typed fields + canonical example.
8. `tool_hints[]` — subset of persona tools.
9. `use_case_flow` — `{ nodes[], edges[] }` diagram.
10. `error_handling` — per-capability override string, or empty.

Each resolution emits:

```jsonc
{ "capability_resolution": {
    "id": "uc_morning_digest",
    "field": "suggested_trigger",
    "value": { ... },
    "status": "resolved"
}}
```

Or a clarifying question:

```jsonc
{ "clarifying_question": {
    "capability_id": "uc_morning_digest",
    "field": "review_policy",
    "question": "Should the digest be delivered automatically or wait for approval?",
    "options": [...]
}}
```

### 3.5 Persona-wide resolution (happens alongside Phase C)

Independent of capabilities, the LLM also resolves:

- `persona.tools[]` — the shared tool pool. Derived from the union of
  all capabilities' `tool_hints` plus tools that are always relevant
  (file_read, file_write).
- `persona.connectors[]` — the persona-wide connector registry. Each
  capability's `connectors` field references names from here.
- `persona.notification_channels_default[]` — the fallback channel list.
- `persona.operating_instructions` — cross-capability how-to prose.
- `persona.tool_guidance` — per-tool hints.
- `persona.error_handling` — persona-wide error posture (individual
  capabilities can override).
- `persona.core_memories[]` — always-injected facts.

These emit `persona_resolution` events with a `field` and `value`.

### 3.6 Final agent_ir emission

Once behavior_core + all capabilities resolved + persona-wide resolved:

```jsonc
{ "agent_ir": {
    "name": "...", "description": "...", "icon": "...", "color": "...",
    "persona": { /* all behavior core + persona-wide */ },
    "use_cases": [ /* capabilities with full envelopes */ ]
}}
```

The v3 normalizer (`src-tauri/src/engine/template_v3.rs`) already
handles flattening this to the legacy v2 shape the current promote
pipeline expects, so the backend will accept v3 agent_ir without
changes. The CLI just needs to emit v3 shape.

### 3.7 Prompt skeleton — what needs rewriting

File: `src-tauri/src/engine/build_session.rs::build_session_prompt`.

Replace the "## The 8 Dimensions" section with a "## The Capability
Framework" section containing §3.2-3.5. Keep the:

- Language preamble (unchanged)
- Available credentials / connectors sections (unchanged)
- Output format section (update examples to v3 events)
- Protocol Message Integration section (unchanged — these are runtime protocols, orthogonal to build shape)
- Rules (rewrite 1-11 for v3 semantics; drop the "dimension keys" rule, add "every trigger/event/channel must carry use_case_id")

**Keep the design-direction adversarial-questioning rule** (§Rule 10 in
current prompt) — it's even more important in v3 because the mission
picks the capability split.

**Add a new rule**: "Before emitting a `behavior_core`, confirm the
mission is 1 sentence, not a task description. If it reads like a task
('fetches unread emails'), that's a capability — the mission is the
broader *why*."

### 3.8 Streaming events — contract update

The streaming event types currently include:

- `cell_update` (per-dimension data payload)
- `question` (pending question for a dimension)
- `progress` (integer %)
- `error` (fatal)
- `session_status` (state machine transitions)

Add for v3:

- `behavior_core_update` — payload = behavior_core object
- `capability_enumeration_update` — payload = list of capability drafts
- `capability_resolution_update` — payload = { capability_id, field, value, status }
- `persona_resolution_update` — payload = { field, value, status }
- `clarifying_question_v3` — payload = { scope: "mission"|"capability"|"field", capability_id?, field?, question, options[] }

Keep the legacy `cell_update` stream flowing (map
`capability_resolution_update` events to the corresponding flat cell
key) so the existing `matrixBuildSlice` + chronology prototypes
continue to render without changes. That's the migration bridge — old
UI keeps working while new UI rolls out.

---

## 4. New Matrix UI — Capability-First Layout

### 4.1 Current layout

3×3 grid, 8 dimension cells + center Command Hub. See
`src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx`
for the rendering and
`src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` for the
entry. The edit surface is `DimensionEditPanel` / `DimensionQuickConfig`.

### 4.2 Target layout

```
┌────────────────────────────────────────────────────────────────┐
│ BEHAVIOR CORE                                                  │
│ ┌───────────────┬──────────────────────────────────────────┐  │
│ │ Mission       │ One sentence the persona lives by        │  │
│ │ Identity      │ Role • Description                       │  │
│ │ Voice         │ Style • Output format                    │  │
│ │ Principles    │ 2-5 rules (chips)                        │  │
│ │ Constraints   │ 2-5 hard limits (chips)                  │  │
│ └───────────────┴──────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│ CAPABILITIES                                  [+ Add]         │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ ▸ Morning Digest · Schedule 7am · Gmail · msg · mem · 4e │  │
│ │ ▸ Weekly Review  · Schedule Sun 18 · Gmail · msg · mem   │  │
│ │   ↓ (expanded: trigger config, connectors, policies,     │  │
│ │      events, input schema, flow diagram — editable)      │  │
│ └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│ SHARED RESOURCES                                               │
│ ┌───────────────┬──────────────────────────────────────────┐  │
│ │ Tools         │ gmail_search · gmail_read · file_read    │  │
│ │ Connectors    │ Gmail (oauth2 ✓) · …                     │  │
│ │ Defaults      │ Notification channels · memory · errors  │  │
│ └───────────────┴──────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│ COMMAND HUB                                                    │
│ Phase · Completeness · Launch · Test · Approve · View          │
└────────────────────────────────────────────────────────────────┘
```

This is what `PersonaChronologyChain` (the tabular view) and
`PersonaChronologyWildcard` (the radial view) already render as
read-only. The editing version reuses the same layout but makes every
cell editable (chip-based inline editors, popovers for complex fields,
expand-on-click for flow diagrams).

### 4.3 Editing primitives (to reuse / extend)

Already in place:

- `SpatialQuestionPopover.tsx` — for in-cell quick Q&A
- `DimensionEditPanel.tsx` — for full-dimension editing (per-cell drawer)
- `DimensionQuickConfig.tsx` — for field-level quick config
- `TablePickerModal.tsx` — for select-from-list inputs
- `ConnectorsCellContent.tsx`, `EventsPanel.tsx`, `SchedulePanel.tsx`,
  `ServicesPanel.tsx` — dimension-specific mini-editors

New components needed:

- `BehaviorCoreEditor.tsx` — top band, 5 sub-editors (mission /
  identity / voice / principles / constraints)
- `CapabilityRowEditor.tsx` — row component, collapsed/expanded states,
  all chain fields inline
- `CapabilityAddModal.tsx` — clicking "+ Add" asks the LLM (or user) to
  describe a new capability; new capability gets `capability_draft`
  state, then full Phase-C resolution
- `SharedResourcesPanel.tsx` — right rail / bottom band, 3 sections

### 4.4 Edit-time LLM conversation (the "refine" path)

Today `useMatrixLifecycle.handleRefine(summary)` sends a plaintext
summary of dirty dimensions back to the CLI via `--continue`. Keep this
pattern for v3. The summary format becomes:

```
User edited behavior_core.principles — added "never send without approval"
User edited use_cases[uc_morning_digest].suggested_trigger — changed cron to 0 6 * * *
User added a new capability: "End-of-day outbox check" — trigger not yet set
```

The LLM then re-emits the affected fields via the v3 stream events.
`matrixBuildSlice` applies them. No full rebuild needed for small
edits.

### 4.5 Migration path for the UI

**Don't throw out the current matrix.** Add a variant switcher at the
top of `UnifiedMatrixEntry`:

```tsx
type BuildLayout = "legacy-dimensions" | "v3-capabilities";
```

- `legacy-dimensions`: current 3×3 matrix (stays while the CLI still
  emits v2 events)
- `v3-capabilities`: new capability-first layout (activated once the
  CLI emits v3 events and all other chronology prototypes tests pass)

Users can toggle during the transition. Once `v3-capabilities` is
proven by live testing across 20+ real build sessions, remove the
legacy layout in a cleanup PR.

---

## 5. Transformation Pipeline — CLI Output → v3 AgentIr

### 5.1 Current pipeline

```
CLI subprocess stdout line
  → build_session.rs::run_session event parser
  → BuildEvent::cell_update → channel
  → matrixBuildSlice.handleBuildCellUpdate → buildCellData[key]
  ...
  (at end-of-stream)
  → BuildEvent::agent_ir → session.agent_ir in DB
  → frontend: buildDraft = agent_ir
  → user tests + promotes → promote_build_draft_inner
      → parses session.agent_ir as AgentIr (flat shape)
      → substitute_variables, inject_configuration_section, promote
```

### 5.2 v3 pipeline

```
CLI subprocess stdout line
  → build_session.rs::run_session event parser v3
  → BuildEvent::behavior_core_update → channel
  → BuildEvent::capability_enumeration_update → channel
  → BuildEvent::capability_resolution_update → channel
  → BuildEvent::persona_resolution_update → channel
  → BuildEvent::clarifying_question_v3 → channel
  ...
  (at end-of-stream)
  → BuildEvent::agent_ir (v3-shaped) → session.agent_ir in DB
  → frontend: buildDraft = v3 agent_ir
  → user tests + promotes → promote_build_draft_inner
      → parses session.agent_ir
      → template_v3::normalize_v3_to_flat(&mut payload)  ← already built
      → now flat-shape AgentIr
      → substitute_variables, inject_configuration_section, promote
```

**The v3 normalizer is already in place** — it was built during the
template migration. It handles v3-shaped payloads transparently,
including payloads that come from the CLI rather than templates. The
CLI just needs to emit v3 shape; the rest of the backend is ready.

### 5.3 Specific Rust changes required

1. **`src-tauri/src/engine/build_session.rs`**:
   - Rewrite `build_session_prompt` to §3 framework.
   - Extend `run_session` event parser to recognise the new event types
     (`behavior_core`, `capability_enumeration`, `capability_resolution`,
     `persona_resolution`).
   - Map each new event to the existing `BuildEvent::cell_update`
     channel for the **legacy** matrix UI (so it keeps working), AND
     to the new event types for the **v3** UI.

2. **`src-tauri/src/db/models/build_event.rs`** (or wherever `BuildEvent`
   enum lives — check via `grep -rn "enum BuildEvent"`): add the new
   variants.

3. **`src/lib/bindings/BuildEvent.ts`** (generated via ts-rs): regen
   after the Rust changes.

4. **`src/stores/slices/agents/matrixBuildSlice.ts`**: add reducers
   for the new event types. Maintain a new `buildBehaviorCore` +
   `buildCapabilities` slice alongside `buildCellData`. When the CLI
   emits v2-shape, populate `buildCellData` as today. When v3-shape,
   populate the new slices (and mirror to `buildCellData` via the v3→v2
   normalizer on the frontend side for chronology compatibility).

5. **`src-tauri/src/commands/design/build_sessions.rs::promote_build_draft_inner`**:
   already calls the v3 normalizer after `create_adoption_session`
   stored v3 payload. Verify this is true for build-from-scratch too —
   if the CLI emits v3 agent_ir, the session's agent_ir field will be
   v3-shaped, and the normalizer runs at session-create time. This
   needs an explicit normalization call in `promote_build_draft_inner`
   as a safety net if session.agent_ir is v3-shaped. Add:

   ```rust
   if crate::engine::template_v3::is_v3_shape(&agent_ir_value) {
       crate::engine::template_v3::normalize_v3_to_flat(&mut agent_ir_value);
   }
   ```

   Then parse as `AgentIr`. This belt-and-braces covers CLI sessions
   that skipped create_adoption_session.

### 5.4 Specific TypeScript changes required

1. **`src/stores/slices/agents/matrixBuildSlice.ts`**: add new state
   fields + reducers as above.

2. **`src/features/agents/components/matrix/useMatrixBuild.ts`**: add
   selectors for `buildBehaviorCore`, `buildCapabilities`, derived
   completeness logic.

3. **`src/features/agents/components/matrix/UnifiedMatrixEntry.tsx`**:
   add layout toggle; render `v3-capabilities` layout when selected.

4. New components (§4.3).

5. **`src/api/agents/matrix.ts`** (or wherever edit-time IPCs live):
   extend with capability-level editing calls that map to `useAgentStore`
   mutations.

---

## 6. E2E Test Framework

### 6.1 Mirror the adoption framework

The adoption framework lives at `docs/guide-adoption-test-framework.md`
and drives `tools/test-mcp/e2e_c2_sweep.py`. The build-from-scratch
framework should parallel it:

- **Doc**: `docs/guide-build-from-scratch-test-framework.md`
- **Runner**: `tools/test-mcp/e2e_build_sweep.py`
- **Report**: `tools/test-mcp/reports/build-sweep-{ts}.json`
- **HTTP bridge**: reuse the existing `src-tauri/src/test_automation.rs`
  (port 17320). Add new routes if necessary.

### 6.2 Test harness additions

New HTTP routes the Python runner will call:

- `POST /build/start` → body: `{ intent, language? }`. Creates a draft
  persona, starts a build session, returns `{ session_id, persona_id }`.
- `POST /build/answer` → body: `{ session_id, cell_key, answer }`.
  Sends a user answer to a pending question.
- `POST /build/answer-v3` → body:
  `{ session_id, scope, capability_id?, field?, answer }` for the new
  clarifying_question_v3 shape.
- `GET /build/state` → query: `?session_id=...`. Returns the current
  buildCellData + buildBehaviorCore + buildCapabilities + pending
  questions.
- `POST /build/test` → body: `{ session_id, persona_id }`. Triggers
  test_build_draft.
- `POST /build/promote` → body: `{ session_id, persona_id, force? }`.
  Triggers promote_build_draft.
- `POST /build/cancel` → body: `{ session_id }`.

The adoption harness already has `/open-matrix-adoption`,
`/persona-detail`, etc. — use these unchanged for the shared post-promote
verification.

### 6.3 Sweep fixture set

A fixture file `tools/test-mcp/fixtures/build-intents.yaml` listing
intent strings + expected outcomes:

```yaml
- id: simple-email-digest
  intent: "Read my Gmail each morning and send me a summary of what matters."
  expected:
    capabilities: 1
    has_schedule_trigger: true
    connectors: [gmail]
    review_policy_mode: never
    memory_policy_enabled: true

- id: multi-cap-financial
  intent: "Monitor my stock watchlist weekly with technical indicators + news, plus let me backtest strategies on demand."
  expected:
    capabilities_min: 2
    has_schedule_trigger: true
    has_manual_trigger: true
    connectors: [alpha_vantage]

- id: vague-should-ask
  intent: "Help me with my work."
  expected:
    should_ask_clarifying: true
    clarifying_scope: mission

- id: multi-schedule-should-split
  intent: "Check new GitHub issues every hour, summarise them daily, and produce a weekly velocity report."
  expected:
    capabilities_min: 3
    distinct_triggers_min: 3

- id: error-recovery-not-a-capability
  intent: "Monitor my infra endpoints every 5 minutes and page me on failure."
  expected:
    capabilities: 1                  # NOT 2 (monitoring + error recovery)
    has_polling_trigger: true
    notification_channels_min: 1
```

30-50 fixtures covering: simple single-capability, multi-capability,
vague-requiring-clarification, merge-should-be-one-capability,
should-be-split-into-multiple, connector-gap, credential-gap.

### 6.4 Per-intent checklist

For each intent the sweep drives end-to-end:

| Check | Passes when | Fails when |
|---|---|---|
| `build_starts` | `/build/start` returns `success:true` | Backend error |
| `behavior_core_emitted` | `buildBehaviorCore.mission` non-empty within 30s | Mission never emitted |
| `mission_is_single_sentence` | `mission.split('. ').length <= 2` and `mission.length < 300` | Blob prose |
| `identity_role_one_sentence` | `identity.role` ends with a period and has 1-2 clauses | Bullet points or multiple sentences |
| `principles_array` | 1-5 entries, each < 180 chars | Empty or too many, or each is a paragraph |
| `constraints_array` | 1-5 entries, each < 180 chars | Same |
| `capabilities_enumerated` | `buildCapabilities.length >= 1` within 60s | Empty |
| `capabilities_have_ids` | every capability has a non-empty `id` starting with `uc_` | Missing or malformed |
| `capabilities_have_titles` | every capability has `title` (1-40 chars) | Missing or blob |
| `capabilities_have_summaries` | every capability has `capability_summary` (20-180 chars) | Missing or too long/short |
| `triggers_have_use_case_id` | if `triggers[]` present, every entry has `use_case_id` matching a capability | Flat triggers w/o linkage |
| `events_have_use_case_id` | same for `events[]` | Flat events |
| `connectors_registered` | `persona.connectors[]` contains all referenced names | Orphan references |
| `no_internal_flows_as_capabilities` | no capability whose title is "error recovery", "attention escalation", "retry", "fallback" | Wrong granularity |
| `questions_scoped` | every pending question has a `scope` (mission/capability/field) | Unscoped |
| `clarifying_question_triggered` | for vague intents, at least one clarifying question fires before resolution | LLM hallucinated a mission |
| `test_agent_works` | `/build/test` returns test output | Test endpoint fails |
| `promote_works` | `/build/promote` succeeds | Approve path broken |
| `promoted_persona_has_v3` | `/persona-detail` shows `design_context.useCases[]` in v3 shape | Promote lost the v3 structure |
| `triggers_persisted_with_use_case_id` | persona_triggers DB rows have use_case_id populated | Semantic linkage lost in transaction |
| `subscriptions_persisted_with_use_case_id` | persona_event_subscriptions rows have use_case_id populated | Same |

### 6.5 Grading rubric

Same A/B/C/D/F scheme as the adoption sweep. A passes all checks, B
passes structural checks with minor content warnings, C passes
structural only, D promotes but without v3 attribution, F fails to
promote.

Target: **95%+ A/B** on the fixture set before shipping the CLI prompt
rewrite. Lower grades = prompt needs iteration.

### 6.6 Fail-fast policy

Same as adoption framework. Log every failure, continue. Fix systemic
bugs inline when the same failure repeats across 3+ intents. Log
one-off fixture-specific fails without fixing — those usually indicate
the fixture is unrealistic.

### 6.7 Golden-output tests

For the 5 key fixtures (simple-email-digest, multi-cap-financial,
multi-schedule-should-split, error-recovery-not-a-capability,
vague-should-ask), snapshot the final agent_ir and diff against a
committed golden file:

- `tools/test-mcp/golden/simple-email-digest.json`
- ...

When the prompt is iterated, re-run and review the diff. Changes to
golden files must be intentional and reviewed in PR.

---

## 7. Migration Strategy — Incremental, Not Big-Bang

### 7.1 Phase order

1. **Add v3 event types to the Rust side** (additive, non-breaking).
   Legacy CLI output that emits `cell_update` keeps working; new event
   types are opt-in.
2. **Update the CLI prompt incrementally** — one section at a time,
   starting with the behavior core (Phase A) while still emitting the
   8 dimensions.
3. **Land `BehaviorCoreEditor` in the UI** — shows the emitted mission /
   principles / constraints above the existing 3×3 matrix, doesn't
   replace it.
4. **Run the e2e fixture set continuously** as each prompt section
   lands. Watch grades rise.
5. **Update the CLI to emit capability-scoped artefacts** (triggers with
   `use_case_id`, events with `use_case_id`, per-capability
   notification_channels). Legacy flat emissions become fallback only.
6. **Land the capability-first UI** as an opt-in toggle (`v3-capabilities`
   in §4.5). Dogfood for 2-4 weeks.
7. **Flip default to v3-capabilities** once all fixtures grade A/B.
8. **Remove legacy dimension flow** in a cleanup PR.

### 7.2 Backward compatibility with templates

Templates are already migrated to v3 (see C3 handoff). The build-from-
scratch path producing v3 means both entry points (CLI and template
adoption) produce the same shape. The promote pipeline receives a
consistent v3 AgentIr regardless of source.

The v3 normalizer (`template_v3::normalize_v3_to_flat`) is called in
both paths:

- Template adoption: `create_adoption_session` normalizes before
  storing session.agent_ir
- CLI build: `promote_build_draft_inner` normalizes as belt-and-braces
  if session.agent_ir wasn't normalized at create time

After C4 lands, both entry points are identical downstream of the
normalizer.

---

## 8. Files To Touch

### 8.1 Rust

| File | Change |
|---|---|
| `src-tauri/src/engine/build_session.rs` | Rewrite `build_session_prompt` (§3.7); extend `run_session` event parser (§5.3) |
| `src-tauri/src/db/models/build_event.rs` (or wherever `BuildEvent` lives) | Add v3 event variants |
| `src-tauri/src/commands/design/build_sessions.rs` | Add normalizer safety-net call in `promote_build_draft_inner` (§5.3 item 5) |
| `src-tauri/src/test_automation.rs` | Add HTTP routes for build harness (§6.2) |
| `src-tauri/src/engine/template_v3.rs` | **No changes** — already covers CLI output too |

### 8.2 TypeScript

| File | Change |
|---|---|
| `src/lib/bindings/BuildEvent.ts` | Regenerate via ts-rs after Rust changes |
| `src/stores/slices/agents/matrixBuildSlice.ts` | Add `buildBehaviorCore` / `buildCapabilities` slices + reducers |
| `src/features/agents/components/matrix/useMatrixBuild.ts` | New selectors |
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | Layout toggle |
| `src/features/agents/components/matrix/BehaviorCoreEditor.tsx` | **NEW** — top band editor |
| `src/features/agents/components/matrix/CapabilityRowEditor.tsx` | **NEW** — capability list row |
| `src/features/agents/components/matrix/CapabilityAddModal.tsx` | **NEW** — add-capability modal |
| `src/features/agents/components/matrix/SharedResourcesPanel.tsx` | **NEW** — persona-wide resources panel |
| `src/api/agents/matrix.ts` | Extend with capability-level IPC wrappers |
| `src/test/automation/bridge.ts` | Extend `window.__TEST__` with build-specific selectors + methods |

### 8.3 Docs + tooling

| File | Change |
|---|---|
| `docs/guide-build-from-scratch-test-framework.md` | **NEW** — mirror of adoption framework |
| `tools/test-mcp/e2e_build_sweep.py` | **NEW** — sweep runner |
| `tools/test-mcp/fixtures/build-intents.yaml` | **NEW** — 30-50 fixture set |
| `tools/test-mcp/golden/*.json` | **NEW** — golden agent_ir snapshots |

---

## 9. The Behavior Core — Framing Correction

The C3 schema spec framed `persona` as identity + voice + principles +
constraints. The user's correction is: **voice is secondary; the
primary element is the shared goal/mission.**

Update the schema (backward-compatible addition):

```jsonc
"persona": {
  "mission": "...",                            // NEW — primary, 1 sentence
  "identity": { "role": "...", "description": "..." },
  "voice": { "style": "...", "output_format": "..." },
  "principles": [...],
  "constraints": [...],
  "decision_principles": [...],
  ...
}
```

Mission examples (from the done templates, written post-hoc):

- Email Morning Digest: *"Be the most trusted email-attention gatekeeper
  the user has — nothing surfaces unless it's earned its way in."*
- Financial Stocks Signaller: *"Be a disciplined analytical witness to
  the user's watchlist — surface what the numbers say, refuse to be
  their advisor, let them decide."*
- Onboarding Tracker: *"Make sure nobody's onboarding ever slips through
  the cracks — every deadline visible, every stakeholder aware, every
  milestone celebrated."*
- YouTube Content Pipeline: *"Make weekly publishing sustainable for
  solo creators by eliminating the 90% of production that isn't
  filming."*

Mission distinguishes this persona from a generic agent. A prompt rule
should enforce: **if the mission reads like a task ("fetch unread
emails"), it's wrong — the mission is the broader WHY that persists
across every capability.**

Frontend mission editor should coach the user toward this:

- Red-highlight mission text that contains verbs like "fetch", "send",
  "check", "query" — those are task verbs.
- Green-highlight mission text that contains verbs like "be", "make",
  "ensure", "serve" — those are purpose verbs.
- Suggest: "Your mission sounds like a task. The mission is the
  unchanging purpose your capabilities all work toward. Try: 'Be the
  user's [role] so that [outcome].'"

(This is stylistic guidance; the LLM should also enforce it in the
Phase-A prompt step.)

Update §3.2 Phase A to include this mission-framing constraint
explicitly. Update the §6.4 `mission_is_single_sentence` check to
additionally verify that no task verbs appear as the primary verb.

---

## 10. Open Questions (decide before starting)

1. **Timing vs template migration**: C4 can run in parallel with the
   C3 template migration (§11 in the C3 handoff). The two are largely
   independent once the v3 normalizer is in place. Decide whether to
   sequence or parallelize.
2. **Legacy UI retention window**: how long do we keep the 3×3
   dimension matrix after v3-capabilities ships? Recommendation: 2-4
   weeks of dogfood before removal.
3. **Prompt iteration model**: does the dedicated session own the CLI
   prompt, or is that a separate concern? Recommendation: same session
   owns it, because prompt changes feed directly into the e2e sweep
   grading.
4. **Fixture ownership**: does the test-mcp dev own the fixtures, or
   does the template-authoring session contribute them? Recommendation:
   same session since they map cleanly to the build-from-scratch flow.
5. **Golden snapshots**: how do we detect *intentional* prompt evolution
   vs regression? Recommendation: require PR reviewer approval on
   golden file diffs; an automated sign-off from the next session is
   not enough.
6. **Language coverage**: the build-from-scratch CLI already supports
   14 languages via `lang_preamble`. Verify the v3 prompt rewrite
   preserves that, and add 1 non-English intent per language to the
   fixture set.

---

## 11. Minimum Viable v3 Build — MVP Slice

If the session has limited time, the minimum-viable v3 build flow is:

1. Rewrite just **Phase A** of the CLI prompt — emit `behavior_core`
   with mission + identity + voice + principles + constraints.
2. Render `BehaviorCoreEditor` above the existing matrix — shows the
   behavior core, editable. The 8-dimension matrix below remains.
3. Verify via 5 fixture intents that mission quality is good.
4. Ship.

The capability-first layout can come in a follow-up session. The
behavior core alone is ~60% of the v3 value prop — *persona identity
across capabilities* — even before the capability UI lands.

---

## 12. One-Paragraph TLDR

Today the matrix builds a flat 8-dimension agent_ir. v3 needs a
**mission-first, capability-first** shape. Three-phase CLI prompt
(behavior_core → capability_enumeration → per-capability resolution),
new event streams piped through the existing BuildEvent channel, a new
capability-first UI that coexists with the legacy matrix via a toggle,
the v3 normalizer already handles the output shape (no promote changes
needed). Mirror the adoption test framework with a
`tools/test-mcp/e2e_build_sweep.py` runner, 30-50 fixture intents, and
golden snapshots for the 5 canonical cases. Incremental migration: land
behavior core first, ship, then capabilities. The user's correction on
core-as-mission (not voice) is the single most important framing
change — enforce it in the prompt, enforce it in the UI, enforce it in
the e2e grading.
