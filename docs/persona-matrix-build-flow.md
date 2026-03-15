# PersonaMatrix Build Flow

Technical documentation for the unified matrix agent builder — the core feature of Personas.

## Architecture Overview

```
User Intent (text)
 |
 v
UnifiedMatrixEntry.tsx          ← React entry point
 |
 ├─ useMatrixBuild.ts           ← Build orchestration hook
 |   └─ useBuildSession.ts      ← Tauri Channel + session management
 |
 ├─ useMatrixLifecycle.ts       ← Test/refine/promote lifecycle
 |
 └─ PersonaMatrix.tsx           ← 3x3 grid with MatrixCommandCenter
     ├─ MatrixCellRenderer.tsx  ← Cell rendering + state icons
     └─ SpatialQuestionPopover  ← Auto-opening Q&A modal

Backend (Rust):
 src-tauri/src/engine/build_session.rs
  ├─ BuildSessionManager::start_session()  ← Creates DB row, spawns task
  ├─ run_session()                         ← Multi-turn CLI orchestration
  ├─ run_single_turn()                     ← Individual CLI invocation
  ├─ build_session_prompt()                ← System prompt with credentials
  ├─ parse_build_line()                    ← Stream-JSON envelope parser
  └─ parse_llm_text_content()             ← Multi-event JSON extractor
```

## The 8 Dimensions

Each dimension is a card in the 3x3 matrix grid (the 9th cell is the Command Hub):

| Dimension | Cell Key | Description |
|-----------|----------|-------------|
| Tasks | `use-cases` | What workflows the agent handles |
| Apps & Services | `connectors` | External APIs/services needed (Gmail, Slack, GitHub) |
| When It Runs | `triggers` | Schedule, webhook, manual, event-based |
| Messages | `messages` | How it delivers results (built-in, Slack, email) |
| Human Review | `human-review` | Whether it needs human approval |
| Memory | `memory` | Context persistence between runs |
| Error Handling | `error-handling` | Retry, notify, skip behavior |
| Events | `events` | Event subscriptions and emissions |

## Build Flow — Step by Step

### 1. Intent Entry

User types a natural language description in the Command Hub textarea (center cell).

- **Enter key** submits immediately (Shift+Enter for newlines)
- Placeholder: "Describe what your agent should do... (Enter to generate)"
- On submit: immediate "Initializing..." spinner before CLI responds

### 2. Draft Persona Creation

`UnifiedMatrixEntry.handleLaunch()`:
1. Creates a draft persona in SQLite (`createPersona`)
2. Sets `buildPersonaId` in Zustand (survives navigation)
3. Calls `build.handleGenerate(intent, personaId)`
4. If CLI spawn fails: rolls back the draft persona

### 3. Multi-Turn CLI Conversation

`run_session()` in `build_session.rs` orchestrates sequential CLI calls:

```
Turn 1: [System Prompt + Intent] → Auto-resolves obvious dimensions + asks first question
Turn 2: [Full History + Answer]  → Resolves answered dimension + asks next question
Turn N: [Full History + Answer]  → All resolved → emits agent_ir → draft_ready
```

**Key design decision**: Each turn is a separate `claude` CLI invocation with full conversation history replayed. This avoids the stdin EOF deadlock of long-lived processes.

**Model**: Forced to `claude-sonnet-4-20250514` for speed.

### 4. System Prompt

The prompt (`build_session_prompt()`) includes:

- User's intent text
- Available credentials from the Vault (queried from SQLite)
- Available connectors (queried from SQLite)
- The 8 dimension definitions
- Output format (strict JSON, one object per line)
- Rules for dynamic resolution vs questioning

**Critical rules in the prompt**:
- Auto-resolve dimensions that are obvious from the intent
- Output MULTIPLE resolved events + one question per response
- Connectors dimension CANNOT be auto-resolved — must check credentials
- If a service is needed but credential is missing: warn the user
- Raw JSON only — no markdown, no code fences

### 5. CLI Output Parsing

The Claude CLI with `--output-format stream-json --verbose` wraps output in envelopes:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"THE_ACTUAL_JSON"}]}}
{"type":"result","result":"THE_ACTUAL_JSON"}
{"type":"system",...}  // skipped
```

`parse_build_line()` unwraps the envelope, then `parse_llm_text_content()` extracts ALL JSON objects from the text (supports multiple events per response).

### 6. Event Types

| Event | JSON Key | Frontend Effect |
|-------|----------|----------------|
| Question | `{"question": "...", "dimension": "connectors", "options": [...]}` | Cell highlighted + auto-modal opens |
| Resolved | `{"dimension": "use-cases", "status": "resolved", "data": {"items": [...]}}` | Cell → green border + checkmark + bullet content |
| Agent IR | `{"agent_ir": {...}}` | All resolved → draft_ready |
| Test Report | `{"test_report": {"status": "ready", "issues": [], ...}}` | Test results displayed |
| Error | `{"error": "..."}` | Error banner shown |

### 7. Cell State Machine

```
hidden → revealed → pending → filling → resolved
                                ↓
                           highlighted (awaiting user input)
                                ↓
                            resolved (after answer)
```

Each state has visual properties defined in `cellStateClasses.ts`:
- **hidden**: transparent, invisible
- **revealed**: ghosted outline (blueprint)
- **pending/filling**: primary border + glow pulse animation
- **resolved**: emerald border + background checkmark watermark + bullet content
- **highlighted**: primary border + corner glow + question mark icon

### 8. Question Modal

When a question arrives, `SpatialQuestionPopover` auto-opens a full-screen modal:
- Header with dimension label + icon
- Question text
- 2-4 option buttons (click to answer)
- Free text input with Submit button (for custom answers)
- Escape or backdrop click to close

### 9. Post-Build Lifecycle

After all dimensions are resolved (`draft_ready`), the session stays alive for:

#### Refinement (`_refine`)
- User types in "Adjust anything..." input in Command Hub
- Sent through `answerBuildQuestion(sessionId, "_refine", feedback)`
- CLI updates affected dimensions and re-emits resolved events

#### Test (`_test`)
- User clicks "Test Agent" button
- Sent through `answerBuildQuestion(sessionId, "_test", "Run test")`
- CLI analyzes the configuration, checks credential coverage
- Returns `test_report` JSON with status, issues, and summary

#### Promote
- After successful test, user can promote draft to production persona
- `handlePromote()` in `useMatrixLifecycle.ts`
- Validates credential coverage via `computeCredentialCoverage()`
- Updates persona to `enabled: true`

## Data Flow

### Zustand Store (`matrixBuildSlice.ts`)

```typescript
interface MatrixBuildSlice {
  buildPersonaId: string | null;     // Draft persona ID (survives navigation)
  buildSessionId: string | null;     // Active CLI session
  buildPhase: BuildPhase;            // Current lifecycle phase
  buildCellStates: Record<string, CellBuildStatus>;  // Per-cell visual state
  buildCellData: Record<string, { items?: string[] }>;  // Resolved dimension content
  buildPendingQuestions: BuildQuestion[];  // Active questions for modal
  buildOutputLines: string[];        // CLI progress messages
  buildError: string | null;
}
```

### Build Phases

```
initializing → analyzing → resolving ⟷ awaiting_input → draft_ready → testing → test_complete → promoted
```

### Event Handlers

| Zustand Action | Triggered By |
|----------------|-------------|
| `handleBuildCellUpdate` | CLI resolved a dimension |
| `handleBuildQuestion` | CLI asked a question |
| `handleBuildProgress` | CLI emitted progress text |
| `handleBuildSessionStatus` | Phase transition |

## Credential Awareness

The build session queries the credential vault before starting:

```rust
let credentials = credential_repo::get_all(&pool).unwrap_or_default();
let connectors = connector_repo::get_all(&pool).unwrap_or_default();
```

These are injected into the system prompt so the CLI can:
1. Check if required services have credentials
2. Warn if credentials are missing
3. Suggest alternatives

## Grid Layout

```
grid-cols-[2fr_2.6fr_2fr] grid-rows-[1fr_1fr_1fr]
min-w-[1100px] min-h-[200px] per cell

  [Tasks]        [Apps & Services]  [When It Runs]
  [Human Review] [Command Hub]     [Messages]
  [Memory]       [Errors]          [Events]
```

Command Hub has corner-heavy glow (radial gradients at corners), elevated glass panel effect.

## Visual Effects

- **Glow colors**: Per-cell watermark colors (violet, cyan, amber, rose, blue, purple, orange, teal), theme-tinted via `color-mix()`
- **Resolved cells**: Emerald border + large background CheckCircle2 watermark (20% opacity) + bullet content
- **Highlighted cells**: Corner-heavy glow + large HelpCircle icon
- **Filling cells**: Glow pulse animation + large spinning Loader2
- **Stagger reveal**: Ripple from center (120ms adjacent, 240ms corners)
- **Reduced motion**: Instant transitions, glow colors preserved

## File Reference

### Frontend

| File | Purpose |
|------|---------|
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | Entry point, draft creation, launch handler |
| `src/features/agents/components/matrix/useMatrixBuild.ts` | Build orchestration, derived state |
| `src/features/agents/components/matrix/useMatrixLifecycle.ts` | Test/refine/promote through conversation |
| `src/hooks/build/useBuildSession.ts` | Tauri Channel streaming, session hydration |
| `src/stores/slices/agents/matrixBuildSlice.ts` | Zustand state for build session |
| `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` | 3x3 grid, cell rendering, command center |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCellRenderer.tsx` | Cell state icons, resolved content |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenter.tsx` | Command Hub UI states |
| `src/features/agents/components/matrix/SpatialQuestionPopover.tsx` | Auto-opening Q&A modal |
| `src/features/agents/components/matrix/cellStateClasses.ts` | State → visual class mapping |
| `src/features/agents/components/matrix/cellGlowColors.ts` | Cell key → glow color mapping |
| `src/styles/globals.css` | Glow keyframes, pseudo-element classes |

### Backend

| File | Purpose |
|------|---------|
| `src-tauri/src/engine/build_session.rs` | Multi-turn session orchestration, prompt, parsing |
| `src-tauri/src/commands/design/build_sessions.rs` | Tauri command handlers |
| `src-tauri/src/engine/prompt.rs` | CLI args builder |
| `src-tauri/src/db/repos/core/build_sessions.rs` | SQLite persistence |
| `src-tauri/src/db/repos/resources/credentials.rs` | Credential vault queries |
| `src-tauri/src/db/repos/resources/connectors.rs` | Connector queries |

### Test Automation

| File | Purpose |
|------|---------|
| `tools/test-mcp/server.py` | MCP server with 20 test tools |
| `src-tauri/src/test_automation.rs` | Rust HTTP server (feature-gated) |
| `src/test/automation/bridge.ts` | JS bridge on `window.__TEST__` |
| `docs/test-automation-guide.md` | Full test automation reference |

## Testing the Build Flow

Using test automation (`npx tauri dev --features test-automation`):

```bash
# 1. Start creation
curl -X POST http://127.0.0.1:17320/start-create-agent

# 2. Fill intent
curl -X POST http://127.0.0.1:17320/fill-field \
  -H "Content-Type: application/json" \
  -d '{"test_id":"agent-intent-input","value":"Fetch last gmail and send Message"}'

# 3. Launch build
curl -X POST http://127.0.0.1:17320/click-testid \
  -d '{"test_id":"agent-launch-btn"}'

# 4. Wait for modal, answer question
curl -X POST http://127.0.0.1:17320/click \
  -d '{"selector":"[data-testid=\"option-button\"]"}'

# 5. Check state
curl http://127.0.0.1:17320/state
```

## Known Limitations

- Each CLI turn takes 5-10 seconds (API latency) — total build time ~30-60s for 3-4 turns
- The CLI model is hardcoded to Sonnet — no user-selectable model yet
- Test flow validates configuration but doesn't execute the agent against real services
- Refinement replays full conversation history, which grows with each turn
- The `createPortal` approach for cell overlays has z-index issues in some edge cases
