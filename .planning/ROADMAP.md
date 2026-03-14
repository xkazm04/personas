# Roadmap: Unified Matrix Builder

## Overview

This roadmap transforms the existing three-mode persona creation experience (Chat, Build, Matrix) into a single unified matrix-first builder. The journey moves from backend session infrastructure (streaming, state management, CLI orchestration) through the core interactive matrix surface (cell animation, Q&A flow, unified entry point) to the build lifecycle (test-then-promote approval gate) and finally visual polish (futuristic aesthetic, ambient effects, performance hardening). Each phase delivers a verifiable capability that the next phase builds on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Session Infrastructure** - Rust build session manager, Tauri Channel streaming, Zustand build state slice, and CLI per-dimension event emission
- [ ] **Phase 2: Unified Matrix Build Surface** - Single matrix-first entry point with cell state machine, live cell-by-cell animation, click-to-answer Q&A, and feature parity with retired modes
- [x] **Phase 3: Build Lifecycle and Approval** - Command center lifecycle orb, mandatory test run, explicit approve/reject gate, refinement loop, and draft-to-production promotion (completed 2026-03-14)
- [x] **Phase 4: Visual Polish and Performance** - Futuristic dark control-room aesthetic, state-driven glow system, GPU-accelerated decorative animations, and 60fps performance validation (completed 2026-03-14)

## Phase Details

### Phase 1: Session Infrastructure
**Goal**: The backend can manage a multi-turn build session with typed streaming events, and the frontend can receive, batch, and persist build state across navigation
**Depends on**: Nothing (first phase)
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06
**Success Criteria** (what must be TRUE):
  1. A build session can be started from the frontend, and typed cell-update events stream from Rust to React in order without dropped or duplicated messages
  2. User can navigate away from the matrix page and return to find build state intact (not reset)
  3. The CLI engine emits distinct progress events per persona dimension (identity, capabilities, tools, triggers, connections, behavior), not just a single completion event
  4. User answers submitted from the frontend reach the Rust build task and resume it without requiring a new CLI process
  5. Both Tauri Channel and EventBridge streaming approaches have been implemented and benchmarked, with the winner selected and the loser removed
**Plans:** 5 plans

Plans:
- [x] 01-01-PLAN.md — Rust data models, SQLite migration, BuildSessionManager engine, and Tauri commands
- [x] 01-02-PLAN.md — Frontend TypeScript types, dimension mapping, Zustand matrixBuildSlice, and API wrappers
- [x] 01-03-PLAN.md — useBuildSession hook with Channel streaming, 16ms event batching, and Channel vs EventBridge evaluation
- [x] 01-04-PLAN.md — Gap closure: multi-turn stdin delivery (answer forwarding to CLI subprocess)
- [x] 01-05-PLAN.md — Gap closure: Channel vs EventBridge benchmark implementation

### Phase 2: Unified Matrix Build Surface
**Goal**: Users build AI agents through a single interactive matrix where cells animate to life as the CLI resolves persona dimensions, questions appear spatially on relevant cells, and all capabilities from the retired Chat/Build/Matrix modes are preserved
**Depends on**: Phase 1
**Requirements**: MTRX-01, MTRX-02, MTRX-03, MTRX-04, MTRX-05, MTRX-06, MTRX-07, MTRX-08, MTRX-09, MTRX-10, VISL-05, INTG-01, INTG-02, INTG-03
**Success Criteria** (what must be TRUE):
  1. User enters a natural language intent in the command center, and matrix cells progressively reveal and fill as the CLI resolves each dimension -- the user watches the agent materialize cell by cell
  2. When the CLI needs user input, the relevant cell highlights/pulses and the user clicks it to answer -- questions appear WHERE they matter in the grid, not in a separate chat panel
  3. User can click any resolved cell to inline-edit its generated configuration, cancel generation mid-build, and see a live completeness score updating as cells fill
  4. All cell labels use non-technical vocabulary (e.g., "Apps & Services" not "Connectors", "When it runs" not "Triggers")
  5. Existing personas created via old modes remain fully functional, and all connector/trigger/credential edit cell capabilities from the retired modes are preserved (verified by feature parity audit)
**Plans**: TBD

Plans:
- [x] 02-01-PLAN.md -- Data contracts: cell vocabulary labels, state machine class map, multi-question slice upgrade
- [ ] 02-02: TBD

### Phase 3: Build Lifecycle and Approval
**Goal**: Users can verify their built agent works with a real test run and explicitly approve or reject it before it becomes a production persona, with the full lifecycle reflected in the command center orb
**Depends on**: Phase 2
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-05, LIFE-06, INTG-04
**Success Criteria** (what must be TRUE):
  1. The command center orb visually reflects the full build lifecycle: idle, generating, awaiting input, testing, and promoting -- the user always knows what state the build is in
  2. After the matrix is filled, user triggers a mandatory real test run that executes the persona against their use case and shows actual results
  3. User can explicitly approve test results to promote the draft to a real persona, or reject to return to the matrix for refinement -- rejection is not a dead end
  4. User can type refinement feedback in the command center and the CLI adjusts specific cells without starting over
  5. Promoted personas retain all configured tools, triggers, and credentials, and build validation logic (credential coverage checks) prevents incomplete agents from being promoted
**Plans:** 3/3 plans complete

Plans:
- [ ] 03-01-PLAN.md — BuildPhase enum extension (Rust + TS), matrixBuildSlice test lifecycle state, credential coverage utility
- [ ] 03-02-PLAN.md — Test run integration hook, command center test/approve/reject UI states
- [ ] 03-03-PLAN.md — Refinement loop, draft-to-production promotion, end-to-end verification

### Phase 4: Visual Polish and Performance
**Goal**: The matrix experience delivers a futuristic, ambient dark control-room aesthetic with GPU-accelerated glow and animation effects while maintaining 60fps performance at minimum viewport specs
**Depends on**: Phase 3
**Requirements**: VISL-01, VISL-02, VISL-03, VISL-04, VISL-06, VISL-07
**Success Criteria** (what must be TRUE):
  1. The matrix UI presents a futuristic dark control-room aesthetic with contextual neon glow colors per cell state (violet for AI attention, cyan for processing, emerald for resolved, red for error)
  2. Cell enter/exit/reveal animations use Framer Motion with stagger orchestration, while glow pulse, shimmer, and breathing effects use CSS @property keyframes with zero JS cost
  3. Animation performance holds 60fps with 8+ simultaneous cell animations at minimum viewport (900x600), verified by profiling at 4x CPU throttle
  4. All text meets WCAG AA contrast minimums (4.5:1 normal, 3:1 large) and glow/particle effects are layered only on non-content elements
**Plans:** 3/3 plans complete

Plans:
- [ ] 04-01-PLAN.md — CSS glow foundation: keyframes, pseudo-element glow system, theme-tinted color classes, cellStateClasses extension
- [ ] 04-02-PLAN.md — Component integration: cell glow wiring, stagger reveal, typewriter content, glass panel command center, orb lifecycle glow
- [ ] 04-03-PLAN.md — Performance hardening: will-change optimization, animation audit, 60fps validation checkpoint

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Session Infrastructure | 3/5 | Gap closure | - |
| 2. Unified Matrix Build Surface | 2/5 | In Progress|  |
| 3. Build Lifecycle and Approval | 3/3 | Complete   | 2026-03-14 |
| 4. Visual Polish and Performance | 3/3 | Complete   | 2026-03-14 |
