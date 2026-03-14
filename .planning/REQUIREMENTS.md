# Requirements: Unified Matrix Builder

**Defined:** 2026-03-14
**Core Value:** Any person can build a working AI agent by answering questions in a visual matrix, watch it come alive cell-by-cell, verify it works, and promote it to production.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Session Infrastructure

- [x] **SESS-01**: BuildSessionManager in Rust wraps existing design.rs + CliProcessDriver with session state tracking
- [x] **SESS-02**: Tauri Channel API streaming pipeline delivers ordered, typed cell updates from Rust to frontend
- [x] **SESS-03**: Both Channel and EventBridge approaches implemented and benchmarked — winner selected based on performance, reliability, and interaction plasticity
- [x] **SESS-04**: Zustand matrixBuildSlice replaces ephemeral useReducer for build state (survives navigation within app)
- [x] **SESS-05**: CLI engine emits per-dimension progress events (not just done/not-done) enabling cell-level granularity
- [x] **SESS-06**: User answers flow back to CLI engine via tokio::mpsc channel with natural suspend/resume of build task

### Matrix Interaction

- [x] **MTRX-01**: Single unified matrix-first entry point replaces Chat, Build, and Matrix creation modes entirely
- [x] **MTRX-02**: Guided start experience — initial prompt/question reveals, then matrix progressively reveals as user answers
- [x] **MTRX-03**: Cell state machine with full lifecycle: hidden → revealed → pending → filling → resolved → highlighted-for-input
- [x] **MTRX-04**: Cell-by-cell live construction animation as CLI resolves each persona dimension
- [x] **MTRX-05**: Click-to-answer spatial Q&A — when CLI needs input, relevant cell highlights/pulses, user clicks to answer
- [x] **MTRX-06**: CLI questions mapped to specific matrix cell keys so questions appear WHERE they matter in the grid
- [x] **MTRX-07**: Natural language intent input via command center textarea as primary build trigger
- [x] **MTRX-08**: Inline cell editing of generated configuration (preserving existing edit cell capabilities)
- [x] **MTRX-09**: Cancel/abort generation at any point during build process
- [x] **MTRX-10**: Completeness scoring with visual ring updated live as cells fill

### Build Lifecycle

- [x] **LIFE-01**: Command center orb reflects full lifecycle: idle → generating → Q&A → testing → promoting
- [x] **LIFE-02**: Mandatory real test run — CLI executes persona against user's use case with actual results
- [x] **LIFE-03**: Explicit approval gate — user accepts test results before draft becomes real persona
- [x] **LIFE-04**: Reject action returns to matrix for refinement (not a dead end)
- [ ] **LIFE-05**: Refine-in-place via command center — user types refinement feedback, CLI adjusts specific cells
- [ ] **LIFE-06**: Draft-to-production promotion preserves all configured tools, triggers, and credentials

### Visual Design

- [ ] **VISL-01**: Futuristic/ambient dark control-room aesthetic with glowing cells and neon accents
- [ ] **VISL-02**: Cell state-driven glow colors (different glow for pending, filling, resolved, highlighted states)
- [ ] **VISL-03**: Framer Motion structural animations for cell enter/exit/reveal with stagger orchestration
- [ ] **VISL-04**: CSS @property decorative animations for glow pulse, shimmer, breathing effects (GPU-accelerated, zero JS cost)
- [x] **VISL-05**: Non-technical vocabulary for cell labels (e.g., "Apps & Services" not "Connectors", "When it runs" not "Triggers")
- [ ] **VISL-06**: 60fps animation performance maintained with 8+ simultaneous cell animations
- [ ] **VISL-07**: Smooth animation at minimum spec (900x600 viewport)

### Integration

- [ ] **INTG-01**: Existing personas created via old modes remain fully functional (no migration required)
- [ ] **INTG-02**: All existing connector, trigger, and credential edit cell capabilities preserved in unified mode
- [ ] **INTG-03**: Feature parity audit completed — no capabilities lost from retiring Chat, Build, or Matrix modes
- [x] **INTG-04**: Build validation logic from Build mode (computeCredentialCoverage) ported to unified matrix

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Background & Resumption

- **BGND-01**: Background build continues when user navigates away from matrix page
- **BGND-02**: Session persistence to SQLite — build state survives app restart
- **BGND-03**: Return-to-progress resumption — user returns to find cells filled while away
- **BGND-04**: Notification when background build needs input or completes

### Visual Polish

- **POLH-01**: Canvas-based ambient background particle effects
- **POLH-02**: Targeted dimension regeneration — refine specific cells without full rebuild
- **POLH-03**: Per-cell contribution display showing how each cell impacts completeness score
- **POLH-04**: Undo/redo for individual refinements (zundo integration)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Node-and-wire graph editor | Every competitor does this — matrix IS the differentiator |
| Separate Chat/Build/Matrix modes | Being replaced by unified mode — the whole point |
| Tutorial/walkthrough overlays | Progressive reveal teaches the interface through usage |
| Raw JSON/YAML config in build flow | Breaks zero-code promise for non-technical users |
| Multi-persona simultaneous building | Scope creep — one session at a time for v1 |
| Drag-and-drop cell reordering | Fixed grid layout IS the conceptual model |
| AI chat sidebar during build | Recreates old chat mode — matrix IS the conversation |
| Template marketplace | Separate product initiative, not part of build experience |
| Mobile/responsive layout | Desktop-first, matrix needs screen real estate |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| SESS-04 | Phase 1 | Complete |
| SESS-05 | Phase 1 | Complete |
| SESS-06 | Phase 1 | Complete |
| MTRX-01 | Phase 2 | Complete |
| MTRX-02 | Phase 2 | Complete |
| MTRX-03 | Phase 2 | Complete |
| MTRX-04 | Phase 2 | Complete |
| MTRX-05 | Phase 2 | Complete |
| MTRX-06 | Phase 2 | Complete |
| MTRX-07 | Phase 2 | Complete |
| MTRX-08 | Phase 2 | Complete |
| MTRX-09 | Phase 2 | Complete |
| MTRX-10 | Phase 2 | Complete |
| LIFE-01 | Phase 3 | Complete |
| LIFE-02 | Phase 3 | Complete |
| LIFE-03 | Phase 3 | Complete |
| LIFE-04 | Phase 3 | Complete |
| LIFE-05 | Phase 3 | Pending |
| LIFE-06 | Phase 3 | Pending |
| VISL-01 | Phase 4 | Pending |
| VISL-02 | Phase 4 | Pending |
| VISL-03 | Phase 4 | Pending |
| VISL-04 | Phase 4 | Pending |
| VISL-05 | Phase 2 | Complete |
| VISL-06 | Phase 4 | Pending |
| VISL-07 | Phase 4 | Pending |
| INTG-01 | Phase 2 | Pending |
| INTG-02 | Phase 2 | Pending |
| INTG-03 | Phase 2 | Pending |
| INTG-04 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after roadmap creation*
