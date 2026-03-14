# Technology Stack

**Project:** Unified Matrix Builder
**Researched:** 2026-03-14
**Scope:** Additive stack for live matrix UI, ambient animations, and CLI-driven session management on top of existing Tauri 2 + React 19 + Rust + Zustand 5 + Tailwind 4 + Framer Motion 12

## Recommended Stack

This is not a greenfield stack recommendation. The app already has a mature stack (React 19.2.4, Zustand 5.0.11, Framer Motion 12.35.1, Tailwind CSS 4.2.1, Tauri 2.x with Rust). The recommendations below are **additive** -- new libraries and patterns needed specifically for the matrix builder UX.

### Cell-by-Cell Animation Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Framer Motion (existing) | ^12.35.1 | Staggered cell reveals, layout animations, presence transitions | Already in the codebase. `AnimatePresence`, `staggerChildren`, and `layoutId` are used in `CreationWizard.tsx` and `AnimatedList.tsx`. The `stagger()` function and variant orchestration handle cell-by-cell reveals natively. No additional animation library needed. [HIGH confidence] |
| CSS `@property` | Native | GPU-accelerated glow pulsing on matrix cells | Enables smooth animation of custom properties (gradient stops, glow intensity) that CSS cannot normally transition. Fully supported in WebView2 (Chromium 120+, auto-updates). Avoids animating `box-shadow` which causes paint thrashing. [HIGH confidence] |
| CSS `@keyframes` + Tailwind arbitrary values | Native | Ambient pulse/breathe effects on highlighted cells | For steady-state ambient effects (breathing glow on "awaiting input" cells), pure CSS keyframes on `opacity` and `transform` are cheaper than JS-driven animation. Compose with Tailwind's `animate-[name]` utility. [HIGH confidence] |

### Ambient Visual Effects

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom Canvas 2D hook (`useParticleField`) | N/A (hand-rolled) | Ambient floating particle background behind the matrix | A 150-line custom `useRef` + `requestAnimationFrame` canvas hook is preferable to tsParticles for this use case. tsParticles `@tsparticles/react` v3.0.0 has not been updated in 2 years, has unknown React 19 compatibility, and pulls ~80KB for features we do not need (confetti, fireworks, 3D). A bespoke hook drawing 30-60 translucent circles with simple drift math is lighter, fully controlled, and trivially tunable. [HIGH confidence -- custom approach; LOW confidence on tsParticles React 19 compat] |
| CSS radial gradients + `mix-blend-mode` | Native | Neon glow halos behind active cells, radial light bleeding | Already used in `PersonaMatrix.tsx` (the command center cell has `bg-[radial-gradient(...)]`). Extend this pattern with `--glow-color` custom property animated via `@property` for per-cell contextual glow (violet for AI, cyan for connectors, amber for triggers). Zero bundle cost. [HIGH confidence] |
| `backdrop-filter: blur()` | Native | Frosted glass panels over the matrix during build phases | Supported in WebView2. **Caveat:** Do NOT enable Tauri window transparency (`transparent: true`), which breaks `backdrop-filter` rendering on Windows (confirmed bug, open issues #10064, #12437, #12804). Keep window opaque and use `backdrop-filter` on inner elements only. [HIGH confidence, with known constraint] |

### Session Management (CLI <-> UI Rapid Interaction)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tauri Channel API (`Channel<T>`) | Tauri 2.x (existing) | Ordered streaming of build progress, cell updates, and questions from Rust to frontend | Channels are Tauri's recommended mechanism for streaming data. They guarantee message ordering (index-based), have strong type support, and are faster than the event system for continuous data flow. The existing event bridge (`eventBridge.ts`) uses `listen()` which is fine for infrequent events but not optimal for rapid Q&A streaming. Use Channel for the build session stream. [HIGH confidence] |
| `tokio::sync::mpsc` | tokio 1.x (existing) | Rust-side session state: user answers flow in via mpsc sender, CLI output flows back via Channel | The existing engine uses tokio extensively. Add a per-session `mpsc::Sender<UserAnswer>` that the Tauri command handler sends into when the user answers a question. The build session task receives from this channel and continues generation. This creates a natural suspend/resume loop without polling. [HIGH confidence] |
| Zustand session slice | Zustand 5.x (existing) | Frontend session state: current question, answered cells, build phase, progress | Add a dedicated `matrixBuildSlice` to the existing slice architecture in `stores/slices/`. Tracks `sessionId`, `currentQuestion`, `answeredCells: Map<cellKey, value>`, `buildPhase`, `progress: 0-100`. The existing `useMatrixOrchestration` hook already manages similar state -- this formalizes it into the store for cross-component access. [HIGH confidence] |
| Tauri events (existing) | Tauri 2.x | Lifecycle events only: session-started, session-paused, session-completed | Keep the existing event system for low-frequency lifecycle transitions that multiple consumers need (sidebar badge updates, notification triggers). Do not use for per-cell streaming. [HIGH confidence] |

### State Management Additions

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zundo | 2.3.0 | Undo/redo for matrix edits during build | Users will click cells and provide answers during the Q&A flow. Undo/redo on these answers is expected UX. zundo is <700B, works with Zustand 5, and provides `temporal.undo()` / `temporal.redo()` with no configuration. Apply only to the matrix build slice, not the entire store. [MEDIUM confidence -- untested with Zustand 5.0.11 specifically but docs claim v5 support] |

### Grid Layout

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| CSS Grid (existing via Tailwind) | Native | Matrix layout: 3-column grid with variable-height cells | Already used in `PersonaMatrix.tsx` (`grid grid-cols-[1fr_1.3fr_1fr]`). CSS Grid handles the asymmetric layout (8 dimension cells + 1 command center) natively. No grid library needed. The matrix has a fixed small number of cells (~8-10), so virtualization is irrelevant. [HIGH confidence] |
| `@tanstack/react-virtual` (existing) | 3.13.21 | NOT for the matrix itself -- for scrollable content within cells | If a cell (e.g., "Use Cases") contains a long list of items, virtualize that inner list. The matrix grid itself should never be virtualized -- it is always fully visible. [HIGH confidence] |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Animation library | Framer Motion (existing) | GSAP, React Spring | GSAP has licensing concerns for commercial use. React Spring would add a parallel animation system when Framer Motion already handles everything needed. Framer Motion 12's `stagger()`, `AnimatePresence`, and layout animations cover cell reveals, presence, and orchestration. |
| Particle effects | Custom Canvas hook | tsParticles (`@tsparticles/react`) | `@tsparticles/react` 3.0.0 last published 2+ years ago. Unknown React 19 compatibility. Massive feature surface (confetti, fireworks, 3D) for a simple ambient drift effect. Custom hook is ~150 lines, zero dependencies, fully tunable. |
| Particle effects | Custom Canvas hook | Three.js / React Three Fiber | Extreme overkill. WebGL context for floating circles is like bringing a crane to hang a picture. Adds ~150KB+ to bundle for no gain over Canvas 2D. |
| Grid component | CSS Grid (native) | AG Grid, TanStack Table | The matrix is a fixed 8-10 cell layout, not a data grid. AG Grid/TanStack Table are for hundreds/thousands of rows with sorting/filtering/virtualization. Using them here would fight their APIs rather than leverage them. |
| Undo/redo | zundo | zustand-travel | zustand-travel uses JSON Patch internally which adds complexity. zundo is simpler, smaller (<700B), and battle-tested with Zustand. |
| Session streaming | Tauri Channel API | WebSocket, Server-Sent Events | In a Tauri app, adding a WebSocket server is unnecessary overhead. The Channel API is built for exactly this use case -- ordered streaming from Rust to JS. It is what Tauri uses internally for child process output and download progress. |
| Session streaming | Tauri Channel + tokio::mpsc | Polling (setInterval) | Polling wastes CPU and adds latency. The mpsc channel pattern suspends the Rust task naturally until user input arrives, then resumes immediately. Zero waste. |
| CSS glow effects | `@property` + CSS keyframes | Framer Motion for glow | Animating `box-shadow` or `filter` via Framer Motion triggers JS on every frame for what should be a GPU-composited effect. CSS `@property` lets the browser handle gradient/opacity transitions on the compositor thread at 60fps with zero JS cost. Use Framer Motion for structural animations (enter/exit/layout), CSS for ambient visual effects. |

## Architecture Patterns for the Stack

### Animation Separation of Concerns

```
Framer Motion (JS-driven)          CSS @property + keyframes (GPU-driven)
------------------------------     ------------------------------------
Cell enter/exit transitions        Ambient glow pulsing
Staggered cell reveals             Breathing intensity on active cells
Layout shifts when cells resize    Gradient color cycling
Drag interactions                  Neon border effects
Page/phase transitions             Hover state glows
```

**Rule:** If the animation is structural (moves elements, changes layout, controls presence), use Framer Motion. If the animation is decorative (glow, pulse, color shift, particle drift), use CSS/Canvas. This keeps the main thread free for interaction handling.

### Session Communication Flow

```
Frontend (React)                  Backend (Rust)
-----------------                 ---------------
                                  Build session starts
                                  |
                  <-- Channel --- Streams cell updates + progress
                  <-- Channel --- Sends question for cell X
                                  |
User clicks cell X                (tokio task suspended on mpsc::recv)
User types answer                 |
                                  |
Tauri command ------>             mpsc::send(answer)
                                  tokio task resumes
                                  |
                  <-- Channel --- Streams next cell updates
                  <-- Channel --- Sends next question or completion
```

### Glow Token System

Extend the existing `STATUS_PALETTE_EXTENDED` in `statusTokens.ts` with matrix-specific glow tokens:

```typescript
// Matrix cell state -> glow color mapping
// idle:        no glow
// highlighted: pulsing glow (cell awaiting user input)
// resolving:   fast pulse (CLI is processing this cell)
// resolved:    brief flash then steady dim glow
// error:       red pulse

// Map to existing palette:
// highlighted -> ai (violet)
// resolving   -> rotation (cyan)
// resolved    -> success (emerald)
// error       -> error (red)
```

This leverages the existing color system rather than inventing a parallel one.

## Installation

```bash
# Only new dependency needed
npm install zundo@^2.3.0
```

No other new packages required. The entire matrix builder stack is built on existing dependencies plus native CSS capabilities.

## Performance Budget

| Concern | Target | Approach |
|---------|--------|----------|
| Cell reveal animation | 60fps, <16ms per frame | Framer Motion `transform` + `opacity` only (compositor-friendly). No `width`/`height` animation. |
| Ambient glow | 0ms JS cost | Pure CSS `@property` animation on `--glow-intensity` custom property. GPU composited. |
| Particle background | <2ms per frame | Canvas 2D with 40-60 particles. `requestAnimationFrame` loop. Particles are circles with `globalAlpha` -- no complex shapes. |
| Build session streaming | <5ms event-to-render | Tauri Channel delivers ordered updates. Zustand `setState` batches React renders. |
| Undo/redo | <1ms per operation | zundo stores diffs, not full snapshots. Scoped to matrix build slice only. |

## WebView2 Compatibility Notes

| Feature | Support | Notes |
|---------|---------|-------|
| CSS `@property` | Yes (Chromium 85+) | WebView2 auto-updates, effectively Chromium 120+ on all Windows 11 machines. Safe to use without fallback. |
| CSS Grid subgrid | Yes (Chromium 117+) | Available if needed for nested cell layouts. |
| Canvas 2D | Yes | Full support. Used for particle effects. |
| `backdrop-filter` | Partial | Works on inner elements. Breaks when Tauri window `transparent: true` is set. Keep window opaque. |
| `@layer` | Yes (Chromium 99+) | Tailwind 4 uses this. Already working in the app. |
| View Transitions API | Yes (Chromium 111+) | Available for phase transitions but Framer Motion `AnimatePresence` is more controllable. Not recommended for this use case. |

## Sources

- [Motion (Framer Motion) documentation](https://motion.dev/docs) - Animation patterns, stagger API, layout animations
- [Motion stagger API](https://www.framer.com/motion/stagger/) - Cell-by-cell reveal implementation
- [Tauri 2 Calling Rust from Frontend](https://v2.tauri.app/develop/calling-rust/) - Channel API for streaming
- [Tauri 2 Calling Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/) - Event system vs Channel comparison
- [Tauri + Async Rust Process pattern](https://rfdonnelly.github.io/posts/tauri-async-rust-process/) - tokio::mpsc session management
- [CSS @property baseline support](https://web.dev/blog/at-property-baseline) - Browser support confirmation
- [Animating with @property and Container Queries](https://yoo.be/animating-layouts-without-javascript-css-property-container-queries-houdini/) - GPU-accelerated custom property animation
- [CSS GPU Acceleration guide](https://www.lexo.ch/blog/2025/01/boost-css-performance-with-will-change-and-transform-translate3d-why-gpu-acceleration-matters/) - Performance optimization
- [zundo GitHub](https://github.com/charkour/zundo) - Undo/redo middleware for Zustand
- [Tauri backdrop-filter bug #12437](https://github.com/tauri-apps/tauri/issues/12437) - Known transparency limitation
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/) - WebView2 auto-update behavior

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Framer Motion for cell animations | HIGH | Already in codebase, patterns proven in `AnimatedList.tsx` and `CreationWizard.tsx` |
| CSS @property for glow effects | HIGH | Baseline support confirmed, WebView2 auto-updates to latest Chromium |
| Custom Canvas particle hook | HIGH | Standard pattern, zero dependencies, well-documented approach |
| Tauri Channel API for session streaming | HIGH | Official Tauri recommendation for ordered streaming, documented with examples |
| tokio::mpsc for session suspend/resume | HIGH | Standard tokio pattern, already used throughout the Rust backend |
| zundo for undo/redo | MEDIUM | Claims Zustand v5 support but last published 1 year ago; test during implementation |
| backdrop-filter constraint | HIGH | Multiple confirmed bug reports in Tauri repo; workaround is straightforward |
| tsParticles avoidance | MEDIUM | React 19 compat unconfirmed (2-year-old package); custom approach is safer but requires more code |
