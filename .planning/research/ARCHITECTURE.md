# Architecture Patterns

**Domain:** Unified AI Agent Matrix Builder with Live Backend Streaming
**Researched:** 2026-03-14
**Confidence:** HIGH (based on direct codebase analysis + established patterns)

## Executive Summary

The unified matrix builder integrates into an existing Tauri desktop application that already has most of the foundational pieces: a CLI execution engine with streaming output (`runner.rs`, `CliProcessDriver`), a Tauri event bridge for backend-to-frontend communication (`eventBridge.ts`), Zustand stores with domain slices, a `PersonaMatrix` grid component with edit-mode cell rendering, and a working Q&A cycle in the design analysis flow (`useDesignAnalysis` -> `useTauriStream` -> `design-output`/`design-status` events). The architecture challenge is not building from scratch but **orchestrating existing subsystems into a new interactive flow** where the backend drives a Q&A session that visually manifests through cell-by-cell matrix updates.

The recommended architecture adds four new logical components: a **BuildSessionManager** (Rust, stateful coordinator), a **matrixBuildSlice** (Zustand, frontend state), a **MatrixAnimationLayer** (React + Framer Motion, visual feedback), and a **useBuildSession** hook (bridges session events to matrix interactions). These integrate through the existing EventBridge pattern and Tauri IPC, requiring no fundamental architectural changes.

## Recommended Architecture

### System Overview

```
User Interaction
      |
      v
+---------------------+     Tauri Channel      +---------------------+
|   React Frontend    | <===================> |    Rust Backend      |
|                     |                        |                     |
|  PersonaMatrix      |  build-cell-resolved   |  BuildSessionMgr    |
|  AnimationLayer     |  build-question        |  DesignEngine       |
|  MatrixCommandCenter|  build-progress        |  IntentCompiler     |
|  useBuildSession    |  build-phase-change    |  CliProcessDriver   |
|                     |                        |                     |
|  Zustand Store      |  Tauri Commands        |  SQLite Database    |
|  matrixBuildSlice   | =====================> |  build_sessions tbl |
+---------------------+                        +---------------------+
```

### Component Boundaries

| Component | Responsibility | Layer | Communicates With |
|-----------|---------------|-------|-------------------|
| **BuildSessionManager** | Coordinates multi-turn Q&A between CLI engine and user; tracks session state, resolved cells, pending questions; persists to SQLite for background continuity | Rust Engine (`engine/build_session.rs`) | DesignEngine, IntentCompiler, CliProcessDriver, Database, Tauri Channel emitter |
| **matrixBuildSlice** | Frontend state for active build session -- phase, cellStates map, currentQuestion, progress, animation queue, draft AgentIR | Zustand Slice (`stores/slices/agents/`) | EventBridge (receives), API layer (sends commands), AnimationLayer (drives) |
| **MatrixAnimationLayer** | Wraps `MatrixCellRenderer` with animation state transitions (empty -> highlighted -> resolving -> filled); manages animation queue to prevent jank | React Component | matrixBuildSlice (reads cellStates), PersonaMatrix (wraps cells) |
| **useBuildSession** | Hook that bridges build session events to user interactions; routes questions to correct matrix cell, handles answer submission, manages click-to-answer | React Hook | matrixBuildSlice (reads/writes), API (submits answers), useTauriStream (reused for output streaming) |
| **useParticleField** | Canvas 2D particle background for ambient effects; manages own requestAnimationFrame loop | React Hook | Canvas ref only (no store dependencies) |
| **PersonaMatrix** (existing) | Grid of 8 dimension cells + command center; already supports edit mode, view mode, build-locked state, question display, CLI output streaming | React Component | useBuildSession (highlight/question props), matrixBuildSlice (cell data) |
| **MatrixCommandCenter** (existing) | 9th cell centerpiece; already has creation variant with intent input, generation status, CLI output display (`CliOutputStream`), `DesignQuestionPrompt`, `CompletenessRing` | React Component | useBuildSession (questions routed here when not cell-specific) |
| **useTauriStream** (existing) | Generic hook for Tauri event streaming with progress lines, status resolution, timeout, cleanup | React Hook | Tauri event listeners; reused as sub-primitive by useBuildSession |
| **EventBridge** (existing) | Centralized Tauri event subscription manager with idempotent attach/teardown | Infrastructure | All Tauri events, Zustand stores |

### Existing Components That Integrate Directly

These components already exist and require **modification, not replacement:**

| Component | Current Role | Integration Change |
|-----------|-------------|-------------------|
| `PersonaMatrix.tsx` | Static grid renderer with 8 cells keyed by `use-cases`, `connectors`, `triggers`, `human-review`, `messages`, `memory`, `error-handling`, `events` | Wrap cells with AnimationLayer; accept `cellBuildStates` prop |
| `MatrixCommandCenter.tsx` | Creation-mode command center with `LaunchOrb`, `BuildStatusIndicator`, `DesignQuestionPrompt`, `CreationPostGeneration`, `CliOutputStream` | Route build session phase to existing sub-components; these already handle the UI |
| `MatrixCreator.tsx` | Orchestrates matrix creation mode via `useMatrixOrchestration` | Replace `useMatrixOrchestration` with `useBuildSession`; simplify prop wiring |
| `CreationWizard.tsx` | Entry point with mode selection (build/chat/matrix) | Collapse to single "matrix" mode; remove mode selector |
| `useDesignAnalysis.ts` | Manages design Q&A cycle with `startAnalysis`/`refineAnalysis`/`answerQuestion` via `useTauriStream` | Reused internally by BuildSessionManager; not directly called from unified builder |
| `eventBridge.ts` | Registry of Tauri event listeners | Add `build-*` event registrations following existing pattern |
| `builderReducer.ts` | Reducer for step-by-step builder state (`BuilderState`, `BuilderAction`) | Reused for cell-level state mutations; `APPLY_DESIGN_RESULT` action already handles AgentIR application |

## Data Flow

### Primary Flow: Intent -> CLI Q&A -> Cell-by-Cell Resolution

```
1. User enters intent in MatrixCommandCenter textarea
2. useBuildSession calls `start_build_session` Tauri command
3. Rust BuildSessionManager creates session, starts CLI engine
   (calls build_intent_prompt() from intent_compiler.rs,
    spawns CliProcessDriver subprocess)
4. CLI engine begins analysis
5. Engine emits `build-progress` events (CLI output lines)
   -> EventBridge -> matrixBuildSlice.outputLines
   -> MatrixCommandCenter CliOutputStream shows streaming output

6. Engine resolves a dimension autonomously (e.g., error-handling)
7. BuildSessionManager emits `build-cell-resolved`:
   { session_id, cell_key: "error-handling", data: {...} }
   -> matrixBuildSlice.cellStates["error-handling"] = 'resolved'
   -> AnimationLayer queues: empty -> resolving -> filled transition

8. Engine needs user input for "connectors" dimension
9. BuildSessionManager emits `build-question`:
   { session_id, cell_key: "connectors", question: "...", options: [...] }
   -> matrixBuildSlice.currentQuestion set
   -> matrixBuildSlice.cellStates["connectors"] = 'highlighted'
   -> AnimationLayer applies pulsing glow to connectors cell

10. User clicks highlighted "connectors" cell (or answers in command center)
11. useBuildSession calls `answer_build_question` Tauri command
    { session_id, cell_key: "connectors", answer: "GitHub, Slack" }
12. BuildSessionManager forwards answer via mpsc channel to CLI task
13. CLI engine resumes, resolves connectors
14. Emits `build-cell-resolved` for "connectors"
    -> Animation: highlighted -> resolving -> filled

15. Steps 6-14 repeat for remaining dimensions

16. All cells resolved -> Engine emits `build-phase-change`:
    { session_id, phase: "draft-ready", draft: AgentIR }
    -> matrixBuildSlice transitions to draft preview
    -> MatrixCommandCenter shows "Test & Create" button
```

### Background Build Continuity Flow

```
1. User navigates away mid-build (5/8 cells resolved)
2. BuildSessionManager persists to SQLite on every state change:
   build_sessions(id, persona_id, phase, resolved_cells, pending_question, intent)
3. CLI process continues if no question pending
   (pauses at question boundary if waiting for input)

4. User returns to persona view
5. Frontend calls `get_active_build_session` command
6. matrixBuildSlice hydrates from response
7. AnimationLayer renders current state (filled cells, highlighted if question pending)
8. If CLI still running, Channel events resume updating the slice
```

### Cell-by-Cell Auto-Resolve Animation Flow

```
1. CLI engine auto-resolves cells that don't need user input
   (memory defaults, error handling defaults, etc.)
2. Engine emits rapid `build-cell-resolved` events
3. matrixBuildSlice queues animations (does NOT apply instantly)
4. AnimationLayer drains queue at stagger interval (150-200ms)
5. Cells fill in visual sequence with resolving shimmer effect
6. User sees persona "materializing" cell-by-cell
```

### Test Run + Promotion Flow

```
1. All cells resolved, draft AgentIR available
2. User clicks "Test & Create" in command center
3. useBuildSession calls `run_build_test` Tauri command
4. Rust creates temporary execution via existing ExecutionQueue
5. Execution streams output through existing execution events
6. Result displayed in command center (pass/fail)
7. User clicks "Create Agent" to finalize
8. `promote_build_draft` command applies AgentIR to real persona
   (reuses applyDesignResult pattern from useDesignAnalysis)
```

## Patterns to Follow

### Pattern 1: Two-Tier Animation (Structural + Decorative)

**What:** Separate structural animations (Framer Motion) from decorative animations (CSS).
**When:** Always. Every animated element should be classified.
**Why:** Framer Motion handles layout-affecting transitions (enter/exit/reorder). CSS handles visual decorations (glow, pulse, shimmer) on the GPU compositor.

```typescript
// Structural: Cell entering the grid (Framer Motion)
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 12 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
>
  {/* Decorative: Glow pulse (CSS @property) */}
  <div
    className="matrix-cell"
    data-build-state={cellState}
    style={{ '--glow-color': glowColor } as React.CSSProperties}
  >
    {children}
  </div>
</motion.div>
```

```css
@property --glow-intensity {
  syntax: '<number>';
  initial-value: 0;
  inherits: false;
}

.matrix-cell {
  box-shadow: 0 0 calc(var(--glow-intensity) * 20px)
              calc(var(--glow-intensity) * 4px)
              var(--glow-color);
  transition: --glow-intensity 0.6s ease-out;
}

.matrix-cell[data-build-state="highlighted"] {
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { --glow-intensity: 0.4; }
  50% { --glow-intensity: 1; }
}
```

### Pattern 2: Tauri Channel for Ordered Streaming (not Events)

**What:** Use the Tauri Channel API for build session updates, not broadcast events.
**When:** For all high-frequency build session communication (cell updates, progress lines).
**Why:** Tauri events are broadcast to all listeners and have no ordering guarantee. Channel API is point-to-point, typed, and ordered -- critical when multiple cells resolve in sequence.

```rust
// Rust: Create channel, pass to BuildSessionManager
use tauri::ipc::Channel;

#[tauri::command]
async fn start_build_session(
    channel: Channel<BuildEvent>,
    intent: String,
    persona_id: String,
    // ...
) -> Result<String, AppError> {
    let session = BuildSessionManager::start(channel, intent, persona_id).await?;
    Ok(session.id)
}
```

```typescript
// Frontend: Channel established automatically by Tauri command
const channel = new Channel<BuildEvent>();
channel.onmessage = (event) => {
  const store = useAgentStore.getState();
  switch (event.type) {
    case 'cell_resolved': store.resolveBuildCell(event.cell, event.data); break;
    case 'question': store.setBuildQuestion(event.cell, event.question); break;
    case 'progress': store.appendBuildOutput(event.line); break;
    case 'phase_change': store.setBuildPhase(event.phase); break;
  }
};
```

**Note:** EventBridge is still used for session-level lifecycle events (session started, session completed) that other parts of the app may care about. The Channel handles the high-frequency stream within the active build session.

### Pattern 3: Cell State as Design Token

**What:** Map cell build states to the existing `StatusToken` palette from `statusTokens.ts`.
**When:** For all cell visual states.
**Why:** The app already has a token system (`statusTokens.ts` is a new untracked file). Using it keeps the matrix builder visually consistent with the rest of the application.

```typescript
const CELL_STATE_TOKENS: Record<CellBuildState, string> = {
  empty:       'neutral',     // dim, inactive
  highlighted: 'ai',          // violet - "AI wants your attention"
  resolving:   'rotation',    // cyan - "processing"
  filled:      'success',     // emerald - "done"
  error:       'error',       // red - "problem"
};
```

### Pattern 4: Animation Queue with Controlled Drain

**What:** Cell animations are queued and drained at a controlled rate, not fired immediately.
**When:** Multiple cells resolve in rapid succession (auto-resolve scenario).
**Why:** Prevents layout thrash and ensures the "cell-by-cell materialization" effect is visible even when the backend resolves multiple cells instantly.

```typescript
// In AnimationLayer, drain queue at stagger intervals
useEffect(() => {
  if (animationQueue.length === 0) return;
  const timer = setInterval(() => {
    const next = consumeAnimation();
    if (!next) { clearInterval(timer); return; }
    setCellAnimatingState(next.cellKey, next.to);
  }, AUTO_RESOLVE_STAGGER_MS); // 150-200ms
  return () => clearInterval(timer);
}, [animationQueue.length]);
```

### Pattern 5: Stagger Orchestration via Framer Motion Variants

**What:** Use Framer Motion parent/child variant propagation for initial matrix reveal and batch updates.
**When:** Initial grid appearance and when resuming a session with multiple filled cells.
**Why:** `AnimatedList.tsx` already uses this exact pattern (stagger cap at 10 items, ease curve `[0.22, 1, 0.36, 1]`). Consistency with existing motion language.

```typescript
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } },
};

const cellVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 16 },
  show: {
    opacity: 1, scale: 1, y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};
```

### Pattern 6: Question-to-Cell Mapping via cell_key

**What:** Every build question includes a `cell_key` that maps 1:1 to a matrix dimension.
**When:** CLI engine needs user input for a specific persona dimension.
**Why:** Enables the "click on highlighted cell to answer" interaction without guesswork.

The 8 cell keys map directly to PersonaMatrix's cell structure (from `PersonaMatrix.tsx` line 237-265):

| cell_key | Matrix Label | Auto-Resolvable? | Progressive Reveal Order |
|----------|-------------|-------------------|--------------------------|
| `use-cases` | Use Cases | No -- always needs user input | 1st (identity) |
| `connectors` | Connectors | Partial -- LLM suggests, user confirms | 2nd (capabilities) |
| `triggers` | Triggers | Partial -- LLM suggests from intent | 3rd (activation) |
| `human-review` | Human Review | Yes -- defaults available | 4th (policies) |
| `memory` | Memory | Yes -- defaults to persistent | 5th (policies) |
| `error-handling` | Errors | Yes -- defaults to halt | 6th (policies) |
| `messages` | Messages | Yes -- defaults to in-app | 7th (communication) |
| `events` | Events | Yes -- defaults to none | 8th (communication) |

This ordering moves from "must have user input" to "can auto-resolve with sensible defaults," creating the progressive materialization effect.

### Pattern 7: Session Persistence for Background Continuity

**What:** Build session state persisted to SQLite on every phase transition and cell resolution.
**When:** Every state change that the user would lose if they navigated away.
**Why:** PROJECT.md requirement -- "user can leave and return to see progress."

```rust
fn resolve_cell(&mut self, cell_key: &str, data: Value, pool: &DbPool) -> Result<()> {
    self.resolved_cells.insert(cell_key.to_string(), data);
    self.updated_at = Utc::now();
    db::repos::build_sessions::update(pool, &self)?;
    Ok(())
}
```

Follows the existing pattern where `ExecutionQueue` persists execution state and `CredentialDesign` persists credential form state.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Animating box-shadow with JavaScript

**What:** Using Framer Motion `animate={{ boxShadow: "..." }}` for glow effects.
**Why bad:** `box-shadow` is not GPU-composited. Every frame triggers CPU paint. With 8+ cells glowing simultaneously, this drops below 60fps.
**Instead:** Use CSS `@property` to animate `--glow-intensity` feeding into a `box-shadow` calc. The browser optimizes the transition on the compositor.

### Anti-Pattern 2: Scattered Tauri Listeners

**What:** Calling `listen()` directly in components instead of registering in EventBridge.
**Why bad:** The entire codebase centralizes listeners in `eventBridge.ts`. Scattered listeners cause memory leaks (missed cleanup), duplicate handlers, and make event flow untraceable. The EventBridge uses `Promise.allSettled` for fault-tolerant setup and centralized teardown.
**Instead:** Register session-lifecycle events in EventBridge registry. Use Channel API for the high-frequency stream (Channel cleanup is automatic via Tauri command lifecycle).

### Anti-Pattern 3: New Execution Engine for Build Sessions

**What:** Creating a separate CLI subprocess pipeline for build sessions.
**Why bad:** `design.rs` + `intent_compiler.rs` + `CliProcessDriver` already handle LLM interaction, streaming output, question/answer cycles (the `DesignQuestion` / `awaiting-input` phase in `useDesignAnalysis`), and AgentIR result parsing. Building a parallel system duplicates complexity.
**Instead:** BuildSessionManager wraps the existing design pipeline. It calls `build_design_prompt()` / `build_intent_prompt()`, manages the CLI subprocess via existing `CliProcessDriver`, and adds session state tracking on top.

### Anti-Pattern 4: Storing Animation State in Zustand Store

**What:** Putting ephemeral animation state (which cell is currently glowing at frame N) in the store.
**Why bad:** Animation changes at 60fps. Store updates cause re-renders across all subscribers. The existing codebase correctly separates UI state (store) from render state (component-local).
**Instead:** Store only the animation *queue* (what transitions need to happen) in the slice. The AnimationLayer component manages glow/pulse state via local `useState`/`useRef`.

### Anti-Pattern 5: Canvas Particle Effects Without Cleanup

**What:** Starting a `requestAnimationFrame` loop for particles and never cleaning it up.
**Why bad:** If the user navigates away, the loop continues consuming CPU for an invisible canvas.
**Instead:** `useParticleField` hook cancels animation frame in `useEffect` cleanup. Uses `document.hidden` / `visibilitychange` to pause when minimized. Returns `{ pause, resume }` for parent control.

### Anti-Pattern 6: Full Store Snapshots for Undo

**What:** Tracking entire Zustand store state for undo/redo during build.
**Why bad:** The full store includes unrelated slices (vault, pipeline, overview). Snapshots become large.
**Instead:** If undo is needed, apply `zundo` middleware only to matrixBuildSlice. Only build-related state is tracked.

## Database Schema

```sql
-- Migration: add_build_sessions (follows pattern in db/migrations.rs)
CREATE TABLE build_sessions (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'initializing',
  resolved_cells TEXT NOT NULL DEFAULT '{}',  -- JSON map of cell_key -> resolved data
  pending_question TEXT,                       -- JSON nullable
  agent_ir TEXT,                               -- JSON nullable (draft result)
  intent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_build_sessions_persona ON build_sessions(persona_id);
```

## Rust Session State Machine

```rust
pub enum BuildPhase {
    Initializing,     // Session created, CLI engine starting
    Analyzing,        // CLI engine running, no question yet
    AwaitingInput,    // Question emitted, waiting for user
    Resolving,        // Processing user answer
    DraftReady,       // All cells resolved, draft AgentIR available
    TestRunning,      // Validation execution in progress
    Complete,         // User accepted draft
    Cancelled,
}
```

This follows the typestate lifecycle pattern already proven in `lifecycle.rs` (`TriggerStatus`, `AutomationStatus`, `RotationStatus`) where valid transitions are explicitly modeled:

```
Initializing -> Analyzing
Analyzing -> AwaitingInput | DraftReady | Cancelled
AwaitingInput -> Resolving | Cancelled
Resolving -> Analyzing | AwaitingInput | DraftReady
DraftReady -> TestRunning | Complete | Cancelled
TestRunning -> DraftReady | Complete
Complete -> (terminal)
Cancelled -> (terminal)
```

## Tauri Command Surface

| Command | Direction | Purpose |
|---------|-----------|---------|
| `start_build_session` | FE -> BE | Create session, start CLI engine, return Channel |
| `answer_build_question` | FE -> BE | Forward user answer to CLI task via mpsc |
| `skip_build_question` | FE -> BE | Skip optional question with default value |
| `cancel_build_session` | FE -> BE | Clean shutdown, kill CLI subprocess |
| `get_active_build_session` | FE -> BE | Resume after navigation (returns full state) |
| `run_build_test` | FE -> BE | Trigger validation execution of draft |
| `promote_build_draft` | FE -> BE | Apply AgentIR to real persona, finalize |

These follow the existing command pattern in `src-tauri/src/commands/`: receive typed args via serde, interact with engine/database, return `Result<T, AppError>`.

## Scalability Considerations

| Concern | 8 Cells (Current) | 20+ Cells (Future) | Mitigation |
|---------|-------------------|---------------------|------------|
| Grid rendering | CSS Grid, no virtualization needed | CSS Grid still fine | Collapsible sections if > 12 |
| Stagger timing | 0.08s * 8 = 0.64s total reveal | 0.08s * 20 = 1.6s | Cap stagger at 10 (existing `AnimatedList` pattern: `DEFAULT_STAGGER_CAP = 10`) |
| Glow animations | 8 CSS animations, trivial | 20 CSS animations, fine | Glow only visible/active cells if > 15 |
| Channel throughput | ~15 events per build | ~40 events per build | Tauri Channels handle child process stdout at line speed; trivial |
| Session persistence | Small JSON blob (~2KB) | Larger resolved_cells (~10KB) | TEXT column, no schema change needed |
| Re-render frequency | 8 cell components | 20+ cell components | Zustand selector isolation: each cell subscribes to `cellStates[ownKey]` only |

## Suggested Build Order

Dependencies flow downward. Each phase depends on the one above.

### Phase 1: Build Session Infrastructure (Backend)
**Build first because:** Everything else depends on the session management layer.

1. `build_sessions` SQLite migration
2. `BuildSession` struct + `BuildPhase` enum (Rust)
3. `BuildSessionManager` with start/answer/cancel/get methods
4. Tauri commands: `start_build_session`, `answer_build_question`, `cancel_build_session`, `get_active_build_session`
5. Channel event emission for cell updates, questions, progress

**Reuses:** `design.rs` prompt building, `intent_compiler.rs`, `CliProcessDriver` for subprocess, existing DbPool and migration pattern.

### Phase 2: Build Session State (Frontend Store + EventBridge)
**Build second because:** UI components need state to render against.

1. `matrixBuildSlice.ts` added to `AgentStore`
2. EventBridge registrations for session lifecycle events
3. Channel handler setup in useBuildSession hook
4. API wrapper functions in `src/api/agents/buildSession.ts`
5. Wire into existing store architecture (follows executionSlice, chatSlice patterns)

### Phase 3: Matrix Animation Layer
**Build third because:** Requires session state (Phase 2) to drive cell animations.

1. `useMotion` hook (reduced-motion preference detection)
2. `MatrixAnimationLayer` wrapping `MatrixCellRenderer` with Framer Motion
3. Cell state transitions: empty -> highlighted -> resolving -> filled
4. CSS `@property` glow effects for highlighted/resolving states
5. Animation queue consumer with stagger timing

**Reuses:** Framer Motion v12.35.1 (in deps, first substantial consumer). `AnimatedList.tsx` proves the variant pattern.

### Phase 4: Q&A Orchestrator + Unified UI
**Build fourth because:** Requires animation layer (Phase 3) and session state (Phase 2).

1. Wire `useBuildSession` into MatrixCreator (replaces `useMatrixOrchestration`)
2. Cell-click-to-answer interaction
3. Command center integration (fallback Q&A)
4. Background continuity (detect and resume sessions on mount)
5. Collapse CreationWizard mode selector to single unified entry

### Phase 5: Test Run + Draft Promotion
**Build fifth because:** Requires complete build flow (Phase 4) to produce a draft.

1. "Test & Create" button in command center
2. Test execution via existing `executePersona` / `ExecutionQueue`
3. Test result display (adapts from `PersonaRunner.tsx` patterns)
4. User approval gate
5. Draft promotion via `promote_build_draft` command (reuses `applyDesignResult`)

### Phase 6: Visual Polish + Ambient Effects
**Build last because:** Pure aesthetic layer with no functional dependencies.

1. Canvas particle field background (`useParticleField`)
2. Enhanced glow effects on active cells
3. Scan-line / shimmer effect during "resolving" state
4. Ambient grid pulse animation
5. Transition polish between build phases

## Sources

- Direct codebase analysis (HIGH confidence):
  - `src/lib/eventBridge.ts` -- centralized event subscription pattern
  - `src/hooks/design/core/useTauriStream.ts` -- generic streaming hook
  - `src/hooks/design/core/useDesignAnalysis.ts` -- design Q&A cycle with question/answer routing
  - `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` -- grid structure, 8 cells
  - `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenter.tsx` -- command center creation variant
  - `src/features/agents/components/creation/steps/builder/useMatrixOrchestration.ts` -- existing AI orchestration
  - `src/features/agents/components/creation/steps/MatrixCreator.tsx` -- current matrix creation flow
  - `src/features/agents/components/CreationWizard.tsx` -- mode selection entry point
  - `src/features/shared/components/display/AnimatedList.tsx` -- Framer Motion stagger pattern
  - `src/stores/storeTypes.ts` -- slice composition pattern
  - `src-tauri/src/engine/design.rs` -- design prompt builder
  - `src-tauri/src/engine/intent_compiler.rs` -- intent compilation
  - `src-tauri/src/engine/runner.rs` -- execution engine with CliProcessDriver
  - `src-tauri/src/engine/queue.rs` -- concurrency tracking
  - `src-tauri/src/engine/lifecycle.rs` -- typestate lifecycle pattern
- [Tauri v2 IPC Architecture](https://v2.tauri.app/concept/inter-process-communication/) -- Events vs Commands vs Channels
- [Tauri Channel API](https://v2.tauri.app/develop/calling-rust/) -- typed, ordered, point-to-point streaming
- [Tauri + Async Rust Process](https://rfdonnelly.github.io/posts/tauri-async-rust-process/) -- bidirectional async communication
- [CSS @property specification](https://web.dev/articles/at-property) -- GPU-composited custom property animation
- [Framer Motion variants](https://www.framer.com/motion/animation/) -- stagger orchestration

---

*Architecture analysis: 2026-03-14*
