# Unified Matrix Builder

## What This Is

A next-generation persona building experience that replaces the existing Chat, Build, and Matrix creation modes with a single unified interface. The PersonaMatrix becomes a live, interactive control surface where users build AI agents through a guided Q&A flow — the CLI engine produces questions, matrix cells highlight to request answers, and the persona materializes cell-by-cell as the user interacts. Designed for both developers and non-technical users who want to automate digital work without writing code.

## Core Value

Any person — technical or not — can build a working AI agent by answering questions in a visual matrix, watch it come alive cell-by-cell, verify it works with a real test run, and promote it to production.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — inferred from existing codebase. -->

- ✓ Chat-based persona creation via LLM CLI engine — existing (`ChatCreator.tsx`, `CreationWizard.tsx`)
- ✓ Builder step-by-step persona creation — existing (`BuilderStep.tsx`, `builderReducer.ts`)
- ✓ PersonaMatrix grid view for displaying persona properties — existing (`PersonaMatrix.tsx`)
- ✓ Matrix edit mode for inline property editing — existing (`PresetEditCells.tsx`, `ConnectorEditCell.tsx`, `TriggerEditCell.tsx`)
- ✓ CLI execution engine with queued processing and streamed output — existing (`runner.rs`, `ExecutionQueue`)
- ✓ Real-time event bridge (backend → frontend) via Tauri events — existing (`eventBridge.ts`)
- ✓ Background execution that survives UI navigation — existing (`background_job.rs`)
- ✓ Persona draft system before finalization — existing (`DraftDiffViewer.tsx`, `DraftPromptTab.tsx`)
- ✓ Tool/trigger/credential attachment to personas — existing (vault, triggers, connectors subsystems)
- ✓ Zustand state management with domain slices — existing (`stores/slices/`)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Unified matrix-first builder replacing Chat, Build, and Matrix modes
- [ ] Guided start experience — progressive matrix reveal from initial prompt
- [ ] CLI-driven Q&A flow visualized as highlighted/pulsing matrix cells
- [ ] Cell-by-cell live animation as CLI resolves persona properties
- [ ] Click-to-answer interaction on highlighted cells
- [ ] Background build continuity — user can leave and return to see progress
- [ ] Real test run validation before draft promotion
- [ ] User approval gate — accept test results before promoting draft to real persona
- [ ] Futuristic/ambient UI aesthetic — glowing cells, particle effects, dark control-room feel
- [ ] Non-technical user onboarding — zero-code agent building for workflows like email + Excel processing
- [ ] Backend session management for frequent CLI/user interaction cycles
- [ ] Matrix dimensions derived from persona data structure (identity, capabilities, tools, triggers, connections, behavior)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Keeping Chat/Build/Matrix as separate modes — replaced entirely by unified mode
- Mobile/responsive layout — desktop-first application, matrix needs screen real estate
- Voice/audio input for Q&A — text interaction is sufficient for v1
- Multi-persona simultaneous building — one build session at a time for v1

## Context

This is a brownfield project — a large Tauri desktop app (React 19 + Rust) with an established architecture:

- **Frontend:** React/TypeScript with Zustand state management, Tailwind CSS, Framer Motion
- **Backend:** Rust with tokio async runtime, SQLite database, execution engine
- **IPC:** Bidirectional Tauri command/event system with typed bindings (ts-rs)
- **Existing creation modes:** Three separate flows (Chat via LLM, Builder step-by-step, Matrix grid) each with gaps — none delivers the full experience alone

The PersonaMatrix (`src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx`) currently works well as a view/edit grid but isn't connected to the CLI build flow. The CLI engine (`src-tauri/src/engine/`) already supports queued execution, streaming output, and background processing — but the session management for rapid back-and-forth Q&A may need enhancement.

Key existing components to integrate:
- `PersonaMatrix.tsx` — grid structure, cell rendering, edit mode
- `ChatCreator.tsx` / `CreationWizard.tsx` — LLM CLI interaction
- `builderReducer.ts` — step-by-step state management
- `eventBridge.ts` — real-time backend→frontend updates
- `runner.rs` / `ExecutionQueue` — execution engine
- `DraftDiffViewer.tsx` — draft preview before finalization

## Constraints

- **Tech stack**: Must use existing Tauri 2 + React 19 + Rust stack — no framework changes
- **Backward compatibility**: Existing personas created via old modes must remain functional
- **Performance**: Cell-by-cell animations must be smooth (60fps) even with many dimensions
- **CLI engine**: Build process leverages existing execution engine — not a new engine
- **Desktop-first**: Minimum 900x600 viewport, optimized for 1280x800+

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace all three modes with unified matrix | Three partial solutions < one complete solution | — Pending |
| Matrix-first entry (not chat-first) | Matrix provides the visual context non-technical users need | — Pending |
| Guided start with progressive reveal | Empty matrix is overwhelming; guided reveal teaches the interface | — Pending |
| Cell-by-cell live updates (not batch) | Creates "watching AI think" experience; more engaging | — Pending |
| Futuristic/ambient aesthetic | Differentiates from generic AI tooling; control-room metaphor matches the building experience | — Pending |
| Real test run before promotion | Users need proof the persona works before committing | — Pending |
| Analyze backend session management impact | Frequent CLI/user Q&A cycles may need session improvements over current execution queue model | — Pending |

---
*Last updated: 2026-03-14 after initialization*
