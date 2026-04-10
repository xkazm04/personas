# PersonaMatrix Build Architecture

Core feature of Personas Desktop — intelligent agent creation through an LLM-driven dimension resolution system. Supports two paths: **from-scratch creation** (user intent → CLI build) and **template adoption** (pre-designed template → customization).

---

## The 8 Dimensions

Every agent is defined by 8 orthogonal dimensions, rendered as cells in a 3x3 grid (9th cell = Command Hub):

| Dimension | Cell Key | What It Defines | Resolution |
|-----------|----------|-----------------|------------|
| Tasks | `use-cases` | Workflows the agent handles | LLM analyzes intent, may ask clarifying questions |
| Apps & Services | `connectors` | External APIs needed (Gmail, Slack, GitHub) | Never auto-resolved — must verify credentials |
| When It Runs | `triggers` | Schedule, webhook, polling, event, manual | LLM infers from intent, user configures details |
| Messages | `messages` | Notification channels (Slack, email, Telegram) | LLM suggests based on connectors |
| Human Review | `human-review` | Approval gates before execution | LLM infers risk level, user can override |
| Memory | `memory` | Context persistence between runs | LLM suggests based on workflow statefulness |
| Error Handling | `error-handling` | Retry, notify, skip behavior per service | LLM sets defaults, user can override |
| Events | `events` | Inter-agent event subscriptions/emissions | LLM detects coordination needs |

**Dependency graph**: Intent → Tasks → Connectors → Triggers → (Messages, Review, Memory, Errors, Events)

---

## Path 1: From-Scratch Creation

User types a natural language intent → LLM resolves dimensions through multi-turn conversation → agent is tested and promoted.

### Architecture

```
User types intent in Command Hub
         |
         v
UnifiedMatrixEntry.tsx                    ← React entry point
 ├─ handleLaunch()                        ← Creates draft persona, starts session
 ├─ useMatrixBuild.ts                     ← Build orchestration, derived state
 │   └─ useBuildSession.ts                ← Tauri Channel streaming, session hydration
 ├─ useMatrixLifecycle.ts                 ← Test / refine / promote lifecycle
 └─ PersonaMatrix.tsx (variant="creation")
     ├─ MatrixCellRenderer.tsx            ← Cell state machine rendering
     ├─ MatrixCommandCenter.tsx           ← Command Hub UI states
     ├─ SpatialQuestionPopover.tsx        ← Auto-opening Q&A modal
     ├─ DimensionEditPanel.tsx            ← Post-build inline editing
     └─ BuildReviewPanel.tsx              ← Pre-promote readiness check

Rust Backend:
 src-tauri/src/engine/build_session.rs
  ├─ BuildSessionManager::start_session() ← DB row + spawns tokio task
  ├─ run_session()                        ← Multi-turn CLI orchestration loop
  ├─ run_single_turn()                    ← Individual CLI invocation
  ├─ build_session_prompt()               ← System prompt (1100+ lines)
  ├─ parse_build_line()                   ← Stream-JSON envelope parser
  └─ parse_llm_text_content()            ← Multi-event JSON extractor
```

### Step-by-Step Flow

#### 1. Intent Entry

User types natural language description in Command Hub textarea (center cell).
- Enter submits immediately (Shift+Enter for newlines)
- Optional: import n8n workflow JSON as additional context

#### 2. Draft Persona Creation

`UnifiedMatrixEntry.handleLaunch()`:
1. Creates draft persona in SQLite via `createPersona()` (name placeholder, default system prompt)
2. Sets `buildPersonaId` in Zustand (survives navigation)
3. Calls `build.handleGenerate(intent, personaId, workflowJson?, parserResultJson?)`
4. Registers process activity for background tracking
5. On CLI spawn failure: rolls back the draft persona

#### 3. Multi-Turn CLI Conversation

`run_session()` in `build_session.rs` orchestrates sequential CLI calls:

```
Turn 0: [System Prompt + Intent]    → Auto-resolves obvious dimensions + asks first question
Turn 1: [--continue + Answer]       → Resolves answered dimension + asks next
Turn N: [--continue + Answer]       → All resolved → emits agent_ir → draft_ready
```

Each turn is a separate `claude` CLI invocation. Turn 0 sends the full system prompt; subsequent turns use `--continue` flag to reuse the conversation checkpoint in a temp directory. This avoids stdin EOF deadlocks with long-lived processes.

**Model**: Forced to `claude-sonnet-4-20250514` for speed.
**Max turns**: 12 (safety limit).

#### 4. System Prompt Construction

`build_session_prompt()` builds a ~1100-line prompt containing:

1. **Language preamble** — forces all output to user's language (if not English)
2. **Dimension dependency graph** — tells LLM resolution order
3. **8 dimension definitions** — detailed specs for each cell key
4. **Available credentials** — queried from SQLite Vault, listed by type
5. **Available connectors** — all registered connectors in the system
6. **Output format rules** — raw JSON only, one object per line, no markdown
7. **Protocol messages** — user_message, agent_memory, manual_review, emit_event, etc.
8. **Icon catalog** — 20 lowercase IDs (assistant, code, data, email, etc.)

**Critical rules in the prompt**:
- Auto-resolve dimensions obvious from intent (don't ask unnecessary questions)
- Output MULTIPLE resolved events + at most one question per response
- Connectors dimension CANNOT be auto-resolved — must check credentials
- If a required service lacks credentials: warn the user
- Raw JSON only — no markdown, no code fences

#### 5. CLI Output Parsing

The Claude CLI with `--output-format stream-json --verbose` wraps output in envelopes:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"THE_ACTUAL_JSON"}]}}
{"type":"result","result":"THE_ACTUAL_JSON"}
{"type":"system",...}  // skipped
```

`parse_build_line()` unwraps the envelope. `parse_llm_text_content()` extracts ALL JSON objects from the text (handles multiple events per response). Events are deduplicated by `cell_key` (CLI emits both `assistant` and `result` envelopes).

#### 6. Streaming to Frontend

Events flow through a Tauri `Channel<BuildEvent>`:

```
Rust: run_session() → channel.send(BuildEvent)
         ↓
JS: Channel.onmessage → pendingEventsRef (accumulator)
         ↓
requestAnimationFrame → flushEvents() (16ms batching)
         ↓
Zustand: handleBuildCellUpdate / handleBuildQuestion / handleBuildProgress
```

A global `__BUILD_CHANNEL_ACTIVE__` flag disables the EventBridge to prevent double-processing.

#### 7. Event Types

| Event | JSON Shape | Frontend Effect |
|-------|-----------|----------------|
| Cell Update | `{"dimension": "use-cases", "status": "resolved", "data": {"items": [...]}}` | Cell → green border + checkmark + bullet content |
| Question | `{"question": "...", "dimension": "connectors", "options": [...]}` | Cell highlighted + auto-modal opens |
| Agent IR | `{"agent_ir": {...}}` | All resolved → draft_ready phase |
| Test Report | `{"test_report": {"status": "ready", ...}}` | Test results displayed |
| Error | `{"error": "..."}` | Error banner shown |

#### 8. Question Handling

When questions arrive for multiple dimensions, answers are collected locally via `collectAnswer()`. User clicks "Continue" → `submitAllAnswers()` combines them into a single `_batch` message:

```
"[use-cases]: User's answer about tasks\n[connectors]: User's connector choice\n[triggers]: Schedule preference"
```

Sent as `answerBuildQuestion(sessionId, "_batch", combined)`.

The `SpatialQuestionPopover` modal supports:
- Numbered option buttons (keyboard 1-9 for quick selection)
- Free text input (Shift+Enter to submit)
- Escape to close

#### 9. Cell State Machine

```
hidden → revealed → pending → filling → resolved
                                ↓
                           highlighted (question pending)
                                ↓
                            resolved → updated (after edit/refine)
```

Visual properties per state (defined in `cellStateClasses.ts`):
- **hidden**: transparent, invisible
- **revealed**: ghosted outline (blueprint)
- **pending/filling**: primary border + glow pulse animation
- **resolved**: emerald border + CheckCircle2 watermark (20% opacity) + bullet content
- **highlighted**: primary border + corner glow + HelpCircle icon
- **updated**: amber border (marks dimensions modified after initial resolution)

Stagger reveal: ripple from center cell (120ms adjacent, 240ms corners).

#### 10. Post-Build Editing

After `draft_ready`, users can click any resolved cell to switch to edit mode:

- `setEditingCell(cellKey)` toggles `DimensionEditPanel` over the cell
- Editable cells available: ConnectorEditCell, TriggerEditCell, ReviewEditCell, MemoryEditCell, MessagesEditCell, ErrorEditCell, UseCaseEditCell
- Edits are summarized and sent as `_refine` via `handleApplyEdits()`:

```
"User edited the agent dimensions. Current state:\n[use-cases]: ...\n[connectors]: ..."
```

Backend processes `_refine` as a special dimension key → continues multi-turn conversation → re-resolves affected dimensions.

#### 11. Auto-Test

When `buildPhase` becomes `draft_ready` and no pending questions/errors exist, `UnifiedMatrixEntry` automatically triggers `lifecycle.handleStartTest()`.

#### 12. Test Flow

`handleStartTest()`:
1. Phase → `testing`
2. Calls `testBuildDraft(sessionId, personaId)` — Tauri command
3. Backend loads `agent_ir`, extracts `tools` array
4. For each tool: resolves credential → calls `invoke_tool_direct()` with live API
5. Emits `BUILD_TEST_TOOL_RESULT` events (per-tool: name, status, HTTP code, latency)
6. Compiles report: `{ tools_passed, tools_failed, tools_skipped, credential_issues }`
7. Phase → `test_complete`

Pre-promote review (`BuildReviewPanel`) shows:
- Agent identity (name, icon)
- Entity counts (tools, triggers, connectors)
- Readiness checklist (all dimensions resolved, prompt generated, connectors ready)

#### 13. Promote

`handlePromote()`:
1. Calls `promoteBuildDraft(sessionId, personaId)` — Tauri command
2. Backend transaction:
   - Creates `PersonaToolDefinition` for each tool
   - Creates `PersonaTrigger` linked to use cases
   - Creates `PersonaEventSubscription` for events
   - Builds `design_context` with structured `DesignUseCase[]`
   - Updates persona: `enabled = true`, `last_design_result = agent_ir_json`
3. Phase → `promoted`
4. Auto-navigates to the promoted agent's page

**Force promote**: `onApproveTestAnyway()` bypasses test pass requirement when tests fail/skip.

---

## Path 2: Template Adoption

User selects a pre-designed template → dimensions are pre-seeded → user customizes and tests. Uses the same PersonaMatrix as creation — no separate wizard.

### Architecture

```
User clicks "Adopt" on template card
         |
         v
AdoptionWizardModal.tsx               ← Modal wrapper (header + close button)
 └─ MatrixAdoptionView.tsx            ← Adoption orchestration
     ├─ extractDimensionData(agentIR)  ← Parse template → cell data for all 8 dimensions
     ├─ create_adoption_session (Rust) ← Seed build session with resolved cells (no CLI)
     ├─ PersonaMatrix (variant="creation") ← Same grid component as creation
     ├─ QuestionnaireFormGrid          ← Template-specific questions (if any)
     └─ Auto-test on draft_ready       ← Same test/promote pipeline as creation
```

### Adoption Flow

1. `extractDimensionData(ir)` parses the template's `AgentIR` into cell data:
   - Use cases → items list from `ir.use_cases` or `ir.use_case_flows`
   - Connectors → from `ir.suggested_connectors` with credential status
   - Triggers → from `ir.suggested_triggers` normalized by type (schedule, polling, webhook, etc.)
   - Messages → from `ir.suggested_notification_channels`
   - Human Review → from `ir.protocol_capabilities` (manual_review type)
   - Memory → from `ir.protocol_capabilities` (agent_memory type)
   - Error Handling → from `ir.structured_prompt.errorHandling`
   - Events → from `ir.suggested_event_subscriptions`

2. `create_adoption_session` (Rust) creates a build session pre-populated:
   - Phase set to `draft_ready` (no CLI build needed — template is already designed)
   - `resolved_cells` seeded with all dimension data
   - `agent_ir` stored from template
   - No background task spawned (unlike `start_build_session` in creation)

3. PersonaMatrix renders with all cells already resolved — user can:
   - Click cells to edit (same inline editing as creation flow)
   - Answer template-specific `adoption_questions` via `QuestionnaireFormGrid`
   - Test via the same `test_build_draft` pipeline
   - Promote via the same promote pipeline

4. If template has `adoption_questions`: shown as a form grid, user answers are merged into the draft as `_adoption_answers`, then phase transitions to `draft_ready`

5. Auto-test triggers when `draft_ready` and no pending questions — same as creation flow

6. Theme-based visual variants: PersonaMatrix, PersonaMatrixGlass, or PersonaMatrixBlueprint chosen based on active theme

### Key Difference from Creation

| Aspect | Creation | Adoption |
|--------|----------|----------|
| **Session type** | `start_build_session` (spawns CLI) | `create_adoption_session` (pre-seeds DB) |
| **Cell population** | Empty → LLM fills progressively | All 8 cells pre-resolved from template |
| **Time to draft_ready** | ~30-60s (LLM conversation) | Instant (no LLM needed) |
| **Questions** | Agent-generated during build | Template-defined `adoption_questions` |
| **Edit/refine** | `_refine` continues CLI conversation | `_refine` sends edit summary to CLI |

---

## Shared Infrastructure

Both creation and adoption use:

| Component | Purpose |
|-----------|---------|
| `PersonaMatrix.tsx` | 3x3 grid rendering (both use `variant="creation"`) |
| `MatrixCommandCenter.tsx` | Command Hub with test/approve/refine buttons |
| `MatrixCellRenderer.tsx` | Cell state icons and resolved content display |
| `EditableMatrixCells` | 7 inline cell editors (connectors, triggers, review, memory, etc.) |
| `DimensionEditPanel` | Post-build editing overlay |
| `BuildReviewPanel` | Pre-promote readiness checklist |
| `cellStateClasses.ts` | State → visual class mapping |
| `cellGlowColors.ts` | Cell key → glow color mapping |
| `matrixBuildSlice.ts` | Zustand state (multi-session support) |
| `useBuildSession.ts` | Channel streaming + session hydration |
| `useMatrixLifecycle.ts` | Test/refine/promote lifecycle |
| `test_build_draft` (Rust) | Live API tool testing |
| `promote_build_draft` (Rust) | Creates persona entities (tools, triggers, subscriptions) |

---

## State Management

### Zustand Store (`matrixBuildSlice.ts`)

Multi-draft architecture — sessions keyed by `sessionId`:

```typescript
{
  buildSessions: Record<sessionId, BuildSessionState>,  // source of truth
  activeBuildSessionId: string | null,                   // which draft UI shows
  // Scalar mirrors of active session for convenience:
  buildPersonaId, buildSessionId, buildPhase,
  buildCellStates, buildCellData, buildPendingQuestions,
  buildDraft, buildTestPassed, buildError, ...
}
```

Per-session state:
```typescript
BuildSessionState {
  personaId, sessionId: string;
  phase: BuildPhase;
  cellStates: Record<string, CellBuildStatus>;
  cellData: Record<string, { items?, summary?, raw? }>;
  pendingQuestions: BuildQuestion[];
  pendingAnswers: Record<string, string>;
  draft: AgentIR | null;
  testPassed: boolean | null;
  toolTestResults: ToolTestResult[];
  editState: MatrixEditState;
  editDirty: boolean;
  editingCellKey: string | null;
}
```

### Build Phase State Machine

```
initializing → analyzing → resolving ⟷ awaiting_input → draft_ready
                                                              ↓
                                                     [auto-test triggers]
                                                              ↓
                                                          testing → test_complete → promoted

Failure: any → failed | cancelled
Refine loop: draft_ready | test_complete → resolving → draft_ready
```

---

## Agent IR — Final Output Structure

The fully resolved agent specification:

```typescript
{
  name: string;                        // "Email Triage Manager"
  description: string;
  system_prompt: string;               // Fallback comprehensive instructions
  structured_prompt: {
    identity: string;                  // Who the agent is
    instructions: string;             // What it does
    toolGuidance: string;             // How to use tools
    examples: string;                 // Sample executions
    errorHandling: string;            // Error scenarios
    customSections: { key, label, content }[];
  };
  icon: string;                        // "email", "code", "assistant", etc.
  color: string;                       // Hex: "#8b5cf6"
  suggested_tools: string[];
  suggested_connectors: { name, service_type, purpose, credential_fields? }[];
  suggested_triggers: { trigger_type, config, description }[];
  required_connectors: { name, has_credential }[];
  use_cases: { title, description, category, execution_mode, event_subscriptions? }[];
  protocol_capabilities: { type, label, context }[];
  suggested_event_subscriptions: { event_type, source_filter?, description }[];
  suggested_notification_channels: { type, description, required_connector }[];
  design_context: { summary, use_cases: DesignUseCase[] };
  full_prompt_markdown: string;
  summary: string;
}
```

---

## Grid Layout

```
grid-cols-[2fr_2.6fr_2fr] grid-rows-[1fr_1fr_1fr]
min-w-[1100px] min-h-[200px] per cell

  [Tasks]        [Apps & Services]  [When It Runs]
  [Human Review]  [Command Hub]     [Messages]
  [Memory]        [Errors]          [Events]
```

Glow colors per cell: violet, cyan, amber, rose, blue, purple, orange, teal.
Command Hub has corner-heavy glow (radial gradients), elevated glass panel effect.

Visual effects:
- Resolved: emerald border + large CheckCircle2 watermark (20% opacity) + typewriter bullet reveal
- Highlighted: corner glow + HelpCircle icon
- Filling: glow pulse animation + spinning Loader2
- Updated: amber border (post-edit)
- Stagger reveal: ripple from center (120ms adjacent, 240ms corners)
- Reduced motion: instant transitions, glow colors preserved

---

## File Reference

### Frontend — Matrix Core

| File | Purpose |
|------|---------|
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | Creation entry point, draft creation, launch handler |
| `src/features/agents/components/matrix/useMatrixBuild.ts` | Build orchestration, derived state |
| `src/features/agents/components/matrix/useMatrixLifecycle.ts` | Test / refine / promote lifecycle |
| `src/features/agents/components/matrix/SpatialQuestionPopover.tsx` | Auto-opening Q&A modal |
| `src/features/agents/components/matrix/ConnectorsCellContent.tsx` | Credential status, linking, swap |
| `src/features/agents/components/matrix/DimensionEditPanel.tsx` | Post-build inline editing |
| `src/features/agents/components/matrix/BuildReviewPanel.tsx` | Pre-promote readiness check |
| `src/features/agents/components/matrix/cellStateClasses.ts` | State → visual class mapping |
| `src/features/agents/components/matrix/cellGlowColors.ts` | Cell key → glow color mapping |
| `src/hooks/build/useBuildSession.ts` | Tauri Channel streaming, session hydration |
| `src/stores/slices/agents/matrixBuildSlice.ts` | Multi-session Zustand state |

### Frontend — Matrix Grid

| File | Purpose |
|------|---------|
| `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` | 3x3 grid, cell rendering, command center |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCellRenderer.tsx` | Cell state icons, resolved content |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenter.tsx` | Command Hub UI states + prompt sections |
| `src/features/templates/sub_generated/gallery/matrix/EditableMatrixCells.tsx` | 7 inline cell editors |
| `src/features/templates/sub_generated/gallery/matrix/TriggerEditCell.tsx` | Cron/webhook/polling config |
| `src/features/templates/sub_generated/gallery/matrix/PresetEditCells.tsx` | Review, Memory, Messages, Error presets |

### Frontend — Adoption

| File | Purpose |
|------|---------|
| `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx` | Modal wrapper (header + close) |
| `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx` | Adoption orchestration (pre-seed + test) |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx` | Template-specific question form |
| `src/features/templates/sub_generated/adoption/PersonaMatrixGlass.tsx` | Glass visual variant |
| `src/features/templates/sub_generated/adoption/PersonaMatrixBlueprint.tsx` | Blueprint visual variant |

### Backend

| File | Purpose |
|------|---------|
| `src-tauri/src/engine/build_session.rs` | Multi-turn session, prompt construction, parsing |
| `src-tauri/src/commands/design/build_sessions.rs` | Tauri commands (start, answer, test, promote) |
| `src-tauri/src/commands/design/template_adopt.rs` | Template transform commands |
| `src-tauri/src/commands/design/create_personas.rs` | confirmTemplateAdoptDraft |
| `src-tauri/src/db/repos/core/build_sessions.rs` | Session persistence |
| `src-tauri/src/engine/prompt.rs` | CLI args builder |

---

## Known Limitations

- Each CLI turn takes 5-10 seconds (API latency) — total build time ~30-60s for 3-4 turns
- CLI model hardcoded to Sonnet — no user-selectable model
- Test flow validates tool connectivity but doesn't execute full agent workflows against real services
- Refinement replays full conversation history, which grows with each turn
- Entity-level toggle (include/exclude individual tools before promote) not yet available — all tools from agent_ir are included
