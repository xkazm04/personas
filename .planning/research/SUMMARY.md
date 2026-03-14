# Project Research Summary

**Project:** Unified Matrix Builder
**Domain:** Desktop AI Agent Builder (Tauri 2 + React 19 + Rust)
**Researched:** 2026-03-14
**Confidence:** HIGH

## Executive Summary

The Unified Matrix Builder is a desktop-native AI agent configuration experience built on a mature Tauri 2 + React 19 + Rust + Zustand 5 stack. The project's strategic differentiator is a spatial matrix UI — a 3x3 grid of 8 agent dimension cells plus a command center — that replaces the existing three-mode experience (Chat, Build, Matrix) with a single unified flow. Every major competitor (OpenAI Agent Builder, n8n, Gumloop, Lindy) uses a node-and-wire graph canvas; the matrix format is genuinely differentiated, and protecting it is non-negotiable. The recommended approach is additive: nearly all required capabilities already exist in the codebase as partial implementations that need orchestration into a coherent flow, not greenfield construction. Only one new npm dependency is needed (`zundo@^2.3.0`).

The build order is dictated by a hard dependency chain. A new Rust `BuildSessionManager` must exist before any frontend session work begins, because the entire Q&A-driven matrix animation depends on per-dimension progress events streaming from the backend via Tauri Channels. The animation layer depends on the session state slice, which depends on the backend. The unified UI depends on the animation layer. Visual polish comes last. Getting the Tauri Channel-based streaming architecture right in Phase 1 is the single most consequential technical decision — the wrong approach (using the existing broadcast event system for high-frequency cell updates) will cause WebView crashes and cascading render thrashing that cannot be patched later.

The top risk is split-brain state: the current `builderReducer` lives in component `useReducer` and is lost on navigation, while the Rust `BackgroundJobManager` persists jobs in SQLite. This split must be closed in Phase 1 by moving build session state to Zustand and persisting it to a new `build_sessions` SQLite table. The secondary risk is silent feature regression when retiring the three-mode wizard — each mode has distinct capabilities (Chat's multi-turn refinement, Build's credential coverage validation, Matrix's inline edit cells) that must be audited before removal. A third persistent risk is the futuristic aesthetic sacrificing readability: all text must meet WCAG AA contrast minimums, and glow/particle effects must be layered only on non-content elements.

## Key Findings

### Recommended Stack

The stack requires only one new npm dependency: `zundo@^2.3.0` for undo/redo scoped to the matrix build slice. Everything else is built from existing dependencies. Framer Motion 12 handles structural cell animations via `AnimatePresence`, stagger variants, and `layoutId` (already proven in `AnimatedList.tsx` and `CreationWizard.tsx`). Native CSS `@property` keyframes handle GPU-composited decorative effects (glow pulsing, ambient breathing) without any JS cost. A custom 150-line `useParticleField` Canvas 2D hook replaces `tsParticles`, which has unconfirmed React 19 compatibility after 2+ years without updates.

**Core technologies:**
- **Framer Motion 12 (existing):** Staggered cell reveal, enter/exit transitions, layout animations — already proven in codebase; `stagger()`, `AnimatePresence`, and variant orchestration cover all cell animation needs
- **CSS `@property` + keyframes (native):** GPU-composited glow effects on cells — zero JS cost, fully supported in WebView2 (Chromium 120+); never animate `box-shadow` via Framer Motion (causes paint thrashing)
- **Tauri Channel API (existing):** Ordered, point-to-point streaming from Rust build session to React — use for all high-frequency cell update events; do NOT use broadcast `listen()` events for this purpose
- **tokio::sync::mpsc (existing):** Per-session user-input channel in Rust; the build task suspends on `mpsc::recv()` until the user answers, then resumes naturally with zero polling
- **Zustand 5 + new `matrixBuildSlice` (new slice):** Frontend session state surviving navigation; scoped `zundo` middleware for undo/redo on build edits only
- **Custom `useParticleField` Canvas 2D hook (new):** Ambient particle background; ~150 lines, zero dependencies, `requestAnimationFrame` loop with `visibilitychange` pause and cleanup
- **Critical constraint:** Do NOT enable Tauri `transparent: true` on the window — it breaks `backdrop-filter` rendering on Windows (confirmed bugs #10064, #12437, #12804); apply blur to inner elements only

### Expected Features

**Must have (table stakes) — most already exist:**
- Natural language intent input — exists in `MatrixCommandCenter.tsx`
- Starter prompt suggestions — exists in `ChatCreator.tsx`, needs surfacing in unified mode
- Visual progress feedback during generation — partially exists via `cliOutputLines`; cell-by-cell animation elevates this to a differentiator
- Inline editing of generated configuration — exists via `MatrixEditState` / `MatrixEditCallbacks`
- Test/preview before committing — partially exists via `useDryRun`; needs mandatory visible step
- Draft vs. production separation — exists via `DraftDiffViewer`; needs explicit promotion flow
- Undo/cancel generation — partially exists via `cancelAnalysis`; needs clear cancel button during build phase
- Connector/credential attachment — exists via `ConnectorEditCell`
- Trigger/schedule configuration — exists via `TriggerEditCell`

**Should have (differentiators — mostly new):**
- Cell-by-cell live construction animation — watching AI materialize the matrix spatially; no competitor does this
- Guided progressive reveal from single prompt — cells appear as the CLI resolves them; teaches through use
- Click-to-answer spatial Q&A — questions appear on the cell they concern, not in a sidebar
- Command center orb as unified build nexus — single focal point across all lifecycle phases (idle -> generating -> Q&A -> testing -> promoting)
- Background build with return-to-progress — desktop advantage; web-only tools cannot match persistent background processes
- Explicit test-then-promote approval gate — mandatory visible test step before the agent goes live; builds trust
- Futuristic ambient aesthetic — dark control-room with contextual glow colors per cell state (violet=AI attention, cyan=processing, emerald=resolved, red=error)
- Completeness scoring with per-cell contribution — exists; needs "next recommended" cell highlighting

**Defer to v2+:**
- Background build with full resumption (build the base case first: user stays on page during build)
- Heavy particle/glow visual polish (ship the interaction model first, validate before investing in visual complexity)
- Targeted per-dimension regeneration (full-rebuild with refinement feedback is sufficient for v1)
- Template/starter library beyond curated starter prompts

**Anti-features (explicitly do not build):**
- Node-and-wire graph editor — neutralizes the matrix differentiator entirely
- Separate Chat/Build/Matrix modes — the whole point is unification
- Tutorial overlay popups — use progressive disclosure instead (NNGroup research)
- Raw JSON/YAML config in primary build flow — destroys zero-code promise
- Multi-persona simultaneous building — out of scope per PROJECT.md
- Drag-and-drop cell reordering — fixed positions build muscle memory; reordering adds complexity with no value
- AI chat sidebar during build — matrix IS the conversation; spatial Q&A via cells

### Architecture Approach

The architecture adds four new logical components to an already-capable system: `BuildSessionManager` (Rust stateful coordinator), `matrixBuildSlice` (Zustand frontend state), `MatrixAnimationLayer` (React + Framer Motion visual feedback), and `useBuildSession` hook (bridges session events to cell interactions). These integrate through the existing `EventBridge` pattern and Tauri IPC with no fundamental architectural changes. The existing design Q&A pipeline (`design.rs`, `intent_compiler.rs`, `CliProcessDriver`, `useDesignAnalysis`) is reused as the CLI engine for build sessions; `BuildSessionManager` wraps it rather than replacing it.

**Major components:**
1. **BuildSessionManager** (`engine/build_session.rs`) — coordinates multi-turn CLI Q&A, persists state to `build_sessions` SQLite table on every phase transition and cell resolution, emits typed Channel events per cell resolution/question/progress
2. **matrixBuildSlice** (`stores/slices/agents/`) — frontend session state with phase, `cellStates` map, animation queue, current question, draft AgentIR; survives navigation because it lives in Zustand, not component state
3. **MatrixAnimationLayer** — wraps `MatrixCellRenderer` with Framer Motion state transitions (empty -> highlighted -> resolving -> filled); drains animation queue at 150-200ms stagger to ensure cells materialize visibly even when backend resolves multiple cells instantly
4. **useBuildSession** hook — routes CLI questions to correct matrix cell, handles click-to-answer submission, manages Channel lifecycle and cleanup
5. **BuildPhase state machine** — 8-state typestate modeled on existing `lifecycle.rs` pattern: Initializing -> Analyzing -> AwaitingInput -> Resolving -> DraftReady -> TestRunning -> Complete / Cancelled
6. **`build_sessions` SQLite table** — persists session state on every state change; enables background build resume and crash recovery

**Key patterns to enforce:**
- Two-tier animation: Framer Motion for structural (enter/exit/layout), CSS `@property` for decorative (glow/pulse) — never use Framer Motion to animate `box-shadow` or `background-color`
- Tauri Channel for high-frequency cell updates; EventBridge for low-frequency session lifecycle events
- Cell state mapped to existing `StatusToken` palette: `highlighted=ai(violet)`, `resolving=rotation(cyan)`, `filled=success(emerald)`, `error=error(red)`
- Animation queue with controlled drain — max 3-4 concurrent cell animations; queue the rest with 40ms stagger
- Per-cell Zustand selectors — each cell subscribes to `cellStates[ownKey]` only, never re-renders on unrelated slice changes

### Critical Pitfalls

1. **Tauri event flooding crashes the WebView during cell animation** — Use Tauri Channel API (not broadcast `listen()` events) for all build-session streaming; add a `requestAnimationFrame` batching layer between stream and React state; each cell must subscribe independently to its own store selector. Implement in Phase 1 before any animation work.

2. **Background build returns to a desynchronized matrix state** — The current `builderReducer` in component `useReducer` is lost on navigation. Move build session state to Zustand + SQLite snapshot on every phase transition. The gap between "build started" and "build completed" must be zero-tolerance recoverable.

3. **Three-mode retirement causes silent feature regressions** — Chat has multi-turn refinement depth, Build has `computeCredentialCoverage`/`computeRoleCoverage` validation logic, Matrix has inline edit cells. Build an explicit feature-parity matrix before removing old modes. Keep old code behind a feature flag (`DEV_LEGACY_MODES`) for the first two releases.

4. **Framer Motion kills 60fps when multiple cells animate simultaneously** — Never animate `width`, `height`, `border`, `box-shadow`, or `background-color` via JS. Use CSS for ambient effects. Enforce animation budget: max 3-4 concurrent cell animations. Profile at 4x CPU throttle with 9 cells before shipping. Change any `transition-all` on matrix cells to explicit `transition-[opacity,transform]`.

5. **CLI session management breaks under rapid Q&A** — Model Q&A as a single long-running tokio task with `mpsc` channel for input, not a sequence of independent commands. Extend session timeout from 10 minutes to 30+ minutes. Implement double-submit guard. Add session heartbeats to prevent stale detection. Address in Phase 1.

6. **Futuristic UI sacrifices readability for aesthetics** — All text must meet WCAG AA (4.5:1 normal, 3:1 large). Audit every `/50`, `/40`, `/30` opacity class in matrix cells — `text-foreground/70` is the minimum for secondary content. Apply glows and particles to non-content elements only. Establish a contrast floor as a design token.

7. **Non-technical users don't understand what the matrix represents** — Replace technical labels with plain language: "Connectors" -> "Apps & Services", "Triggers" -> "When it runs", "Human Review" -> "Your approval", "Memory" -> "What it remembers". Add contextual hints per cell. Use CLI Q&A to explain dimensions before asking about them.

## Implications for Roadmap

Based on combined research findings, the suggested phase structure is:

### Phase 1: Build Session Infrastructure
**Rationale:** The Tauri Channel streaming architecture and Rust session management are prerequisites for everything downstream. Pitfalls 1 (event flooding), 2 (state loss on navigation), and 5 (CLI session management) all require Phase 1 solutions. Attempting to build the animation layer before this is in place means rebuilding it when the streaming substrate is fixed.
**Delivers:** `BuildSession` struct + `BuildPhase` enum (Rust); `build_sessions` SQLite migration; `BuildSessionManager` with start/answer/cancel/resume methods; Tauri commands: `start_build_session`, `answer_build_question`, `skip_build_question`, `cancel_build_session`, `get_active_build_session`; Channel event emission for cell updates/questions/progress; `matrixBuildSlice` Zustand slice; EventBridge registrations for session lifecycle events; API wrappers in `src/api/agents/buildSession.ts`; `requestAnimationFrame` batching layer between Channel and React state
**Addresses:** Background build continuity foundation; session persistence; event flooding prevention
**Avoids:** Pitfalls 1, 2, 5

### Phase 2: Cell Animation + Unified Build Flow
**Rationale:** Requires session state from Phase 1. Delivers the core differentiator: "watching AI think" in a spatial grid. Feature-parity audit for mode retirement happens here before old modes are removed. Animation budget enforcement must be established now, before visual complexity is added in Phase 4.
**Delivers:** `MatrixAnimationLayer` with Framer Motion cell state transitions (empty -> highlighted -> resolving -> filled); CSS `@property` glow effects per cell state using existing `StatusToken` palette; animation queue drain with controlled stagger; click-to-answer cell interaction wired to `useBuildSession`; progressive reveal of cells as CLI resolves dimensions; feature-parity matrix document before retiring old modes; plain-language cell label vocabulary layer; CreationWizard collapsed to single unified matrix entry point
**Uses:** Framer Motion stagger variants (proven in `AnimatedList.tsx`), CSS `@property`, `matrixBuildSlice` from Phase 1
**Implements:** MatrixAnimationLayer, cell state machine, Q&A orchestrator, unified entry point
**Avoids:** Pitfalls 3 (mode regression — parity audit), 4 (animation performance — budget enforcement), 6 (contrast floor), 7 (vocabulary layer)

### Phase 3: Approval Gate + Build Completion
**Rationale:** Requires a working cell animation flow (Phase 2) and a complete draft AgentIR to approve. The test-then-promote flow is listed as an MVP must-have in FEATURES.md. The command center orb lifecycle unification (idle -> generating -> Q&A -> testing -> promoting) completes the interaction model.
**Delivers:** Command center lifecycle with phase-appropriate UI variants; "Test & Create" button; test execution via existing `ExecutionQueue`; test result display with explicit approve/reject actions; `promote_build_draft` command applying AgentIR to real persona; background build resume on component mount via `get_active_build_session`; skip-question path for optional dimensions; "build in progress" indicator on sidebar persona list
**Implements:** Test run + draft promotion flow; full background continuity re-hydration
**Avoids:** Pitfall 2 (complete solution), Pitfall 3 (feature parity for test/promote flow validation)

### Phase 4: Visual Polish + Ambient Effects
**Rationale:** Pure aesthetic layer with no functional dependencies. Deferred deliberately per FEATURES.md MVP recommendation. The interaction model must be validated with real users before investing in visual complexity that may need to change. Also ensures the 60fps performance budget is confirmed before adding particles and enhanced glow.
**Delivers:** `useParticleField` Canvas 2D hook (40-60 translucent circles with drift); scan-line/shimmer effect during resolving cell state; ambient grid pulse animation; enhanced per-cell glow per state token; phase transition polish; `prefers-reduced-motion` compliance throughout; opt-out controls for ambient effects (independent of reduced-motion preference); high-contrast mode via extracted design tokens
**Uses:** Custom Canvas 2D hook (not tsParticles), CSS `@property` glow system extension, `useMotion()` hook (existing)
**Avoids:** Pitfall 6 (readability final pass — all `/opacity` values audited against WCAG AA)

### Phase Ordering Rationale

- **Infrastructure before UI:** The Tauri Channel streaming architecture must be solid before the animation layer is built on top of it. Inverting this order would require rewriting the animation layer when the streaming substrate changes.
- **Core differentiator in Phase 2:** Cell-by-cell animation is the product's unique value proposition. It gets Phase 2 priority to validate the concept early and allow design iteration before final polish.
- **Approval gate in Phase 3, not Phase 2:** The test-then-promote flow requires a complete draft AgentIR, which requires a complete Q&A flow. Dependencies enforce this order naturally.
- **Polish last:** The ambient effects are pure value-add. Deferring them ensures the interaction model is validated with real users before investing in visual complexity. It also keeps the performance budget stable — particles cannot be added until the base matrix is confirmed at 60fps.
- **Feature parity audit spans Phases 2-3:** Old mode retirement must be verified before Phase 3 ships. Phase 2 builds the parity document; Phase 3 validates it through test-run coverage of all three old modes' workflows.

### Research Flags

Phases with well-documented patterns (skip `/gsd:research-phase`):
- **Phase 1:** Tauri Channel API + tokio::mpsc bidirectional communication is documented with official examples; the `rfdonnelly.github.io` async Rust process pattern is directly applicable. SQLite migration follows existing `db/migrations.rs` pattern exactly.
- **Phase 3:** `applyDesignResult` and `ExecutionQueue` integration reuses existing codebase patterns with minimal new surface area.
- **Phase 4:** Canvas 2D particle hook, `requestAnimationFrame` cleanup, and `prefers-reduced-motion` are standard patterns well-documented on MDN.

Phases needing additional attention during implementation:
- **Phase 1 — CLI engine instrumentation:** The architecture assumes `design.rs`/`intent_compiler.rs` can emit `build-cell-resolved` events at per-dimension granularity. Confirm the specific extension point early in Phase 1 backend work before designing the full Channel event schema.
- **Phase 2 — animation timing constants:** The 150-200ms stagger and 3-4 concurrent animation cap are estimates. Validate with profiling on a minimum-spec Windows 11 machine early in Phase 2. If 60fps cannot be held at 4x CPU throttle, tighten the budget before adding more animations.
- **Phase 2 — vocabulary validation:** The plain-language label rewrites are assumptions. A quick usability check with 2-3 non-technical users before Phase 2 ships would de-risk Pitfall 7.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Entirely built on existing, proven dependencies. One new package (zundo) needs a quick compatibility test against Zustand 5.0.11 specifically — claims v5 support but was last published ~1 year ago; fall back to a custom 50-line undo stack if needed. |
| Features | MEDIUM-HIGH | Table stakes features are well-researched against multiple competitors. Differentiator features are novel (no direct comparable), so complexity estimates are less certain. Progressive reveal ordering and Q&A cell mapping are based on architectural analysis, not user validation yet. |
| Architecture | HIGH | Grounded in direct codebase analysis mapping to specific files and line numbers. The Tauri Channel + tokio::mpsc session pattern is referenced in official Tauri docs and proven community examples. All component boundaries map to existing patterns in the codebase. |
| Pitfalls | HIGH | Pitfalls 1, 2, 4, and 5 are grounded in actual codebase issues with specific files and line references. Pitfall 1 is also confirmed by a filed Tauri issue (#10987). Pitfalls 6 and 7 are grounded in cited accessibility and AI UX research with multiple sources in agreement. |

**Overall confidence:** HIGH

### Gaps to Address

- **zundo v5.0.11 compatibility:** Claims Zustand v5 support but not recently published. Write a minimal integration test during Phase 1 store work. If it fails, implement a ~50-line custom undo stack using Zustand middleware instead.
- **CLI engine per-dimension event instrumentation:** The architecture assumes `design.rs`/`intent_compiler.rs` can be instrumented to emit cell-keyed `build-cell-resolved` events. This is the right architectural assumption but the specific extension point needs confirmation in the actual code before the full Channel event schema is finalized.
- **Animation timing constants:** The 150-200ms stagger interval and 3-4 concurrent animation cap are engineering estimates. Validate by profiling on a minimum-spec Windows 11 machine early in Phase 2.
- **User vocabulary validation:** The plain-language label rewrites ("Connectors" -> "Apps & Services") are assumptions about non-technical user comprehension. Validate with 2-3 non-technical users before Phase 2 finalizes cell labels.
- **tsParticles React 19 status:** The custom Canvas hook approach is recommended due to tsParticles React wrapper staleness. If tsParticles ships a React 19-compatible release before Phase 4 begins, re-evaluate — but the custom hook is the safe default.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — `PersonaMatrix.tsx`, `MatrixCommandCenter.tsx`, `MatrixCreator.tsx`, `CreationWizard.tsx`, `useMatrixOrchestration.ts`, `eventBridge.ts`, `useTauriStream.ts`, `useDesignAnalysis.ts`, `AnimatedList.tsx`, `animationPresets.ts`, `builderReducer.ts`, `builderHelpers.ts`, `background_job.rs`, `runner.rs`, `queue.rs`, `lifecycle.rs`, `design.rs`, `statusTokens.ts`
- [Tauri v2 Channel API](https://v2.tauri.app/develop/calling-rust/) — ordered streaming, command lifecycle
- [Tauri v2 Event System](https://v2.tauri.app/develop/calling-frontend/) — broadcast events vs. channels; warns events "evaluate JS directly" and are unsuitable for high-frequency data
- [CSS @property baseline](https://web.dev/blog/at-property-baseline) — GPU-composited custom property animation, WebView2 support confirmed
- [Motion (Framer Motion) stagger API](https://www.framer.com/motion/stagger/) — cell-by-cell reveal implementation
- [Tauri backdrop-filter bug #12437](https://github.com/tauri-apps/tauri/issues/12437) — window transparency constraint confirmed

### Secondary (MEDIUM confidence)
- [Tauri + Async Rust Process pattern](https://rfdonnelly.github.io/posts/tauri-async-rust-process/) — tokio::mpsc bidirectional session management
- [Tauri Issue #10987](https://github.com/tauri-apps/tauri/issues/10987) — WebView panic from high-frequency event emission (confirms Pitfall 1)
- [Gumloop, Lindy, MindStudio, n8n competitor analysis](https://www.gumloop.com/blog/best-ai-agent-builder) — feature landscape and matrix differentiation
- [NNGroup progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — UX pattern for staged complexity; tutorial overlays outperformed by inline guidance
- [Smashing Magazine AI interfaces](https://www.smashingmagazine.com/2025/07/design-patterns-ai-interfaces/) — shift away from chat-alike AI interfaces
- [Smashing Magazine inclusive dark mode](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/) — WCAG AA contrast requirements for dark themes
- [UXmatters: Designing for Autonomy](https://www.uxmatters.com/mt/archives/2025/12/designing-for-autonomy-ux-principles-for-agentic-ai.php) — AI agent UX principles for non-technical users
- [NN/g dark mode usability](https://www.nngroup.com/articles/dark-mode-users-issues/) — usability problems with low-contrast dark themes
- [zundo GitHub](https://github.com/charkour/zundo) — Zustand undo/redo middleware, claimed Zustand v5 support

### Tertiary (LOW confidence)
- [StackAI agent testing](https://www.stackai.com/insights/ai-agent-testing-and-qa-how-to-validate-agent-behavior-before-deploying-to-production) — test-before-deploy patterns (methodology guidance, directional only)
- [Huyenchip: AI Engineering Pitfalls](https://huyenchip.com/2025/01/16/ai-engineering-pitfalls.html) — general AI application pitfalls (directional only)
- [Shape of AI UX patterns](https://www.shapeof.ai/) — AI interface design patterns reference

---
*Research completed: 2026-03-14*
*Ready for roadmap: yes*
