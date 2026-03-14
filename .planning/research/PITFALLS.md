# Pitfalls Research

**Domain:** Unified AI Agent Matrix Builder UX (live cell animations, CLI session Q&A, background builds, non-technical users)
**Researched:** 2026-03-14
**Confidence:** HIGH (grounded in codebase analysis + domain research)

## Critical Pitfalls

### Pitfall 1: Tauri Event Flooding Crashes the WebView During Cell-by-Cell Animation

**What goes wrong:**
The CLI engine emits rapid-fire `design-output` and `design-status` events as it resolves persona properties. The new unified builder wants to animate each cell individually as data arrives. If the Rust backend emits events faster than the WebView can process them -- which is documented behavior in Tauri -- the WebView panics or stutters badly. The existing `useTauriStream` hook accumulates lines in React state (`setLines`) on every event, causing re-renders of the entire Matrix on each line. With 8+ cells each potentially animating, this creates a cascade: event arrives -> state update -> React re-render -> Framer Motion layout recalculation -> paint -> next event arrives before paint completes.

**Why it happens:**
The existing codebase uses Tauri's `listen()` event system for streaming (see `useTauriStream.ts`), which Tauri's own docs warn "directly evaluates JavaScript code so it might not be suitable for sending a large amount of data." The current design works for single-stream output (one CLI output viewer), but breaks when you need to fan out events to 8+ independently-animating matrix cells simultaneously. The `PersonaMatrix` component already has a heavy `useMemo` with many dependencies (line 268) -- adding animation state multiplies the cost.

**How to avoid:**
- Use Tauri's **channel system** instead of events for high-frequency streaming data. Channels are designed for ordered, fast data transfer (used internally for download progress and child process output).
- Implement a **batching layer** between the stream and React state: accumulate events in a `ref` and flush to state on a `requestAnimationFrame` cadence (16ms batches). This decouples event arrival rate from render rate.
- Keep the `PersonaMatrix` cells as **independent subscribers** that read from a shared store selector, not props drilled from a parent re-render. Each cell should only re-render when its specific data changes.
- Cap the CLI output buffer (the existing `MAX_LINES = 500` in `useDesignAnalysis.ts` is good, but also limit per-frame processing to avoid jank).

**Warning signs:**
- Frame drops visible in DevTools Performance tab when CLI stream is active
- WebView becomes unresponsive during generation phase
- Matrix cells "flash" or "snap" instead of smoothly animating
- Console warnings about `listen()` callback queue depth

**Phase to address:**
Phase 1 (Core Architecture) -- the event-to-animation pipeline is foundational. Getting this wrong means every subsequent animation feature is built on a broken foundation. Implement the batching layer and channel-based streaming before building cell animations.

---

### Pitfall 2: Background Build Returns to a Stale/Desynchronized Matrix State

**What goes wrong:**
The user starts a build, navigates away (the PROJECT.md explicitly requires this: "Background build continuity -- user can leave and return to see progress"), then returns to find: (a) the matrix shows the pre-build state, (b) the build completed but the matrix doesn't reflect it, (c) the build errored but the user sees a perpetual "Generating..." spinner, or (d) a new build was started from a stale reducer state, creating a ghost persona. The existing `BackgroundJobManager` (see `background_job.rs`) stores job state with a 30-minute TTL, but the React `builderReducer` state is ephemeral -- it lives in `useReducer` inside `CreationWizard`, which unmounts when the user navigates away.

**Why it happens:**
The current architecture has a split-brain problem: the Rust backend tracks job status (`BackgroundJobManager`) but the React frontend tracks the builder's domain state (`builderReducer` in component state). When the component unmounts, the reducer state is lost. The `CreationWizard` already attempts resume via `resumeDraftId` + `fromDesignContext()` (line 79-85), but this reconstructs state from the *persisted* `design_context`, which only gets written after successful generation -- not during. The gap between "build started" and "build completed" is unrecoverable from the frontend perspective.

**How to avoid:**
- **Persist builder session state to Zustand** (not component `useReducer`). The codebase already uses Zustand slices extensively (see `stores/slices/`). Move the `BuilderState` into a dedicated `builderSessionSlice` that survives navigation.
- **Sync the Rust job status to the Zustand store** via the existing `eventBridge.ts` pattern: register a `build-session-status` listener that updates the store whether or not the Matrix component is mounted.
- **Snapshot intermediate state** at each CLI Q&A round-trip, not just at completion. When the user returns, reconstruct from the latest snapshot.
- **Add a "build in progress" indicator** to the sidebar persona list so the user knows something is happening even when not on the builder page.

**Warning signs:**
- Users reporting "my build disappeared"
- Ghost draft personas appearing in the persona list with no design_context
- Builder page showing empty matrix when a build is mid-flight
- Test: navigate away during build, navigate back -- does the matrix recover?

**Phase to address:**
Phase 1 (Core Architecture) -- session persistence is prerequisite for background builds. Phase 2 (Build Flow) should add the intermediate snapshotting.

---

### Pitfall 3: Replacing Three Modes Causes Silent Feature Regressions

**What goes wrong:**
The unified matrix replaces Chat, Build, and Matrix modes (PROJECT.md: "Keeping Chat/Build/Matrix as separate modes -- replaced entirely"). Each mode has unique capabilities that users rely on: Chat mode has natural language refinement with multi-turn conversation (`ChatCreator.tsx`, `useChatCreatorState.ts`), Build mode has structured step-by-step flow with credential auto-matching (`BuilderStep.tsx`, `builderReducer.ts`), and Matrix mode has inline edit cells for every property type (`EditableMatrixCells.tsx`, `PresetEditCells.tsx`). When consolidating, developers focus on the "new" unified experience and miss that specific sub-features of individual modes aren't represented. The regression is silent because there is no feature-parity checklist.

**Why it happens:**
The three modes evolved independently with different mental models: Chat is conversation-first, Build is form-first, Matrix is grid-first. The unified builder is grid+conversation, which naturally covers Matrix and Chat patterns but tends to lose Build mode's guided structure (step ordering, validation gates, credential coverage checks). The `computeCredentialCoverage` and `computeRoleCoverage` functions in `builderHelpers.ts` provide validation logic that has no equivalent in the matrix flow.

**How to avoid:**
- **Build an explicit feature-parity matrix** before removing old modes. List every user-facing capability of each mode and map it to its unified-mode equivalent. Column format: `[Feature] | [Chat Mode] | [Build Mode] | [Matrix Mode] | [Unified Mode Status]`.
- **Keep old mode code available** (behind a feature flag or dev-only toggle) for the first 2 releases after unification so regression reports can be verified against the old behavior.
- **Port validation logic first**: ensure `computeCredentialCoverage`, `computeRoleCoverage`, and the step-ordering logic from `BuilderStep` are integrated into the unified flow's completeness calculation (`calcCompleteness` in `useMatrixOrchestration.ts` currently only counts 8 fields -- it doesn't validate depth).

**Warning signs:**
- Users asking "how do I [action that was possible in old mode]?"
- `calcCompleteness` reports 100% but the generated persona is missing connectors/triggers
- The "refine" flow in the unified mode doesn't match Chat mode's multi-turn depth
- Credential auto-matching stops working (it's currently wired through `AUTO_MATCH_CREDENTIALS` in the reducer but needs to fire after design result in the unified flow)

**Phase to address:**
Phase 2 (Build Flow) -- the feature-parity audit should happen during design of the unified build pipeline. Phase 3 (Polish) should include side-by-side comparison testing of old vs. new for each mode's workflows.

---

### Pitfall 4: Framer Motion Animations Kill 60fps When Multiple Cells Animate Simultaneously

**What goes wrong:**
The design calls for "cell-by-cell live animation as CLI resolves persona properties" with "glowing cells, particle effects." When the CLI rapidly fills in multiple cells (e.g., the LLM produces connectors, triggers, and use cases in quick succession), multiple Framer Motion `<motion.div>` elements animate simultaneously. Each animation triggers layout calculations. The existing `MatrixCellRenderer` (line 185-216 in `PersonaMatrix.tsx`) already has `transition-all duration-300` on every cell -- adding Framer Motion entrance animations, glow pulsing, and particle effects on top means each cell is running multiple CSS transitions + JS-driven Framer animations concurrently. On a 3x3 grid (9 cells), this means up to 27+ simultaneous animation tracks.

**Why it happens:**
Framer Motion layout animations are expensive because they measure DOM elements and compute transforms. The `staggerContainer`/`staggerItem` pattern in `animationPresets.ts` works well for static list reveals but breaks down when cells update asynchronously at unpredictable intervals (driven by CLI output timing, not a controlled stagger). Developers add animations per-cell during development and each one looks smooth in isolation, but the compound effect is brutal. The project also targets 900x600 minimum viewport -- smaller windows mean more layout thrashing per pixel.

**How to avoid:**
- **Animate only `transform` and `opacity`** -- never `width`, `height`, `border`, `box-shadow`, or `background-color` for the cell-fill animations. The glow/pulse effects should use CSS `box-shadow` animations promoted to the GPU via `will-change: box-shadow` or use pseudo-elements with `transform: scale()`.
- **Use CSS transitions for the ambient effects** (glow, pulse) and reserve Framer Motion for entrance/exit animations only. The existing `MatrixCellRenderer` already uses `transition-all` -- this is a red flag because it transitions *every* property. Change to explicit `transition-[opacity,transform]`.
- **Implement an animation budget**: never run more than 3-4 cell animations concurrently. Queue additional animations with a 40ms stagger (the `staggerChildren: 0.04` in `animationPresets.ts` is a good starting value).
- **Respect `prefers-reduced-motion`**: the codebase already has `useMotion()` and `REDUCED_FRAMER` patterns -- ensure the unified builder uses them. Skip particles and glows entirely in reduced-motion mode.
- **Profile early**: use Chrome DevTools Performance tab with CPU throttle 4x before adding the second animation type. The matrix must hold 60fps at 4x throttle on 9 cells.

**Warning signs:**
- DevTools shows layout/paint taking >10ms per frame during cell animations
- `transition-all` appearing anywhere in the matrix cell CSS
- Framer Motion `layout` prop used on matrix cells (triggers expensive layout measurements)
- Animations visibly stutter on first-gen Intel Macs or low-end Windows machines

**Phase to address:**
Phase 2 (Build Flow) -- cell animations are part of the build visualization. Establish the animation budget in Phase 1 architecture, implement and profile in Phase 2.

---

### Pitfall 5: CLI Session Management Breaks Under Rapid Q&A Cycles

**What goes wrong:**
The unified builder's core loop is: CLI emits question -> matrix cell highlights -> user answers -> CLI processes answer -> emits next question or result. The current execution engine (`runner.rs`, `ExecutionQueue`) is designed for fire-and-forget executions with a concurrency limit per persona. But the Q&A flow requires a *conversational session* -- multiple rapid back-and-forth exchanges within a single build. If the session state becomes desynchronized (user answers question 3, but the backend is still processing question 2's answer), the builder produces corrupt results or deadlocks. The existing `useDesignAnalysis` hook tracks `conversationIdRef` (line 60) but the underlying backend may not maintain session affinity across multiple Q&A rounds.

**Why it happens:**
The existing `ConcurrencyTracker` (see `queue.rs`) manages execution slots per persona. Each Q&A answer might be implemented as a new execution or command invocation. If two answers arrive before the first completes, the queue might serialize them (correct but slow) or reject the second (broken). The `BackgroundJobManager` has a `MAX_LINES: 500` and a 10-minute stale timeout (`DEFAULT_STALE_RUNNING_SECS`) -- a slow Q&A session that takes 12+ minutes would be marked stale and killed. The PROJECT.md notes this concern: "session management for rapid back-and-forth Q&A may need enhancement."

**How to avoid:**
- **Model Q&A as a single long-running session**, not a sequence of independent executions. The session should hold a persistent state handle in the Rust backend (a tokio task with a channel for user input).
- **Use Tauri channels for the Q&A data path** (not events). The backend sends a question through the channel, waits for input on an `mpsc::Receiver`, and the frontend sends the answer back via a Tauri command that feeds the `mpsc::Sender`.
- **Extend the stale timeout for build sessions** (the current 10-minute default is too short for non-technical users who may take time to understand questions). Use 30+ minutes for interactive build sessions.
- **Implement session heartbeats**: the frontend periodically pings the backend session to prevent stale detection while the user is thinking.
- **Guard against double-submit**: disable the answer UI immediately on submission, re-enable only when the next question/result arrives.

**Warning signs:**
- User submits answer and nothing happens (session was killed as stale)
- Backend logs show concurrent execution conflicts for the same persona during Q&A
- Questions appear out of order or repeat
- The `design-status` event shows `awaiting-input` but no question payload

**Phase to address:**
Phase 1 (Core Architecture) -- session management is foundational to the entire Q&A flow. The Rust-side session model must be designed before the frontend Q&A UI is built.

---

### Pitfall 6: "Futuristic UI" Sacrifices Readability for Aesthetics

**What goes wrong:**
The project requires a "futuristic/ambient UI aesthetic -- glowing cells, particle effects, dark control-room feel." Developers implement low-contrast glowing text, transparent overlays, and animated backgrounds that make the matrix visually striking in demos but unusable in practice. Non-technical users -- the primary audience -- struggle to read cell content, can't distinguish filled from empty cells, misidentify interactive elements, and experience eye fatigue. The existing `MatrixCellRenderer` uses `text-foreground/70` and `text-muted-foreground/50` opacity classes, which already reduce contrast below WCAG AA standards depending on the theme's foreground color.

**Why it happens:**
"Futuristic" aesthetics in design culture default to low-contrast, high-opacity, neon-on-dark patterns. These look impressive in screenshots and demos but fail real-world use, especially for: users with astigmatism (dark-mode text blooms for ~50% of the population), users in bright environments (low-contrast text washes out), and older non-technical users (who are a key persona for "automate digital work without writing code"). The `bg-card-bg` with `opacity-[0.07]` radial gradient in the command center (line 293 of `PersonaMatrix.tsx`) already creates near-invisible visual hierarchy.

**How to avoid:**
- **Set a contrast floor**: all text must meet WCAG AA minimum (4.5:1 for normal text, 3:1 for large text). Use `text-foreground/90` minimum for primary content, `text-foreground/70` minimum for secondary. Audit every `/50`, `/40`, `/30` opacity class in matrix cells.
- **Layer the futuristic aesthetic on non-content elements**: glows on borders, particles in backgrounds, ambient radials behind cards -- but never on or near text. The "control-room" feel should come from layout, spacing, and card structure, not from obscuring content.
- **Use dark gray backgrounds (#121212 or `--card-bg` at appropriate lightness), not pure black**. Avoid pure white text on pure black -- the contrast causes eye strain and text halation.
- **Test with the audience**: show the matrix to someone who isn't a developer. If they squint, the contrast is wrong.
- **Make particles and glows opt-out**, not just reduced-motion aware. Some users will want dark mode without the ambient effects.

**Warning signs:**
- Any text using opacity below `/60` on primary content
- Screenshot of the builder looks great but is hard to read on a real monitor
- Contrast checker tools flag WCAG AA failures
- User feedback mentioning "hard to read" or "can't tell what's clickable"

**Phase to address:**
Phase 2 (Build Flow) for the base matrix UI, Phase 3 (Polish) for the ambient effects layer. Establish the contrast floor as a design token in Phase 1.

---

### Pitfall 7: Non-Technical Users Don't Understand What the Matrix Represents

**What goes wrong:**
The matrix presents 8 domain categories (Use Cases, Connectors, Triggers, Human Review, Messages, Memory, Errors, Events) with technical labels and domain-specific content. A non-technical user wanting to "automate email + Excel processing" sees a grid of jargon: "Connectors," "Triggers," "Protocol Capabilities." They don't know what to click, what the cells mean, or whether the build is progressing. The guided start (progressive reveal) helps, but if the revealed cells use the same technical vocabulary, progressive reveal just means "showing confusing things slowly."

**Why it happens:**
The matrix categories are derived from the `AgentIR` data structure (the persona's internal representation). Engineers name things after what they are internally, not what the user needs to understand. "Connectors" means "which apps this agent connects to." "Triggers" means "when this agent runs." "Human Review" means "does this agent ask you before acting?" The existing `MatrixCellRenderer` labels are uppercase technical terms (line 206: `cell.label`), and the cell content uses bullet lists of technical identifiers (connector names, cron descriptions).

**How to avoid:**
- **Create a user-facing vocabulary layer** that maps technical labels to plain language:
  - "Connectors" -> "Apps & Services" or "What it connects to"
  - "Triggers" -> "When it runs"
  - "Human Review" -> "Your approval"
  - "Memory" -> "What it remembers"
  - "Error Handling" -> "When things go wrong"
  - "Events" -> "What it watches for"
- **Add contextual hints** (small `?` icon or subtitle) on each cell explaining what the user should expect. "Apps & Services: The tools your agent will use, like Gmail, Slack, or Excel."
- **Progressive disclosure, not progressive reveal**: don't just show cells one at a time -- show them *with explanation*. The first revealed cell should have a 1-sentence description of what it means. Subsequent cells are introduced with "Next, let's set up [plain description]."
- **Use the CLI Q&A to set context**: before asking a technical question, the CLI should explain why it matters. "I need to know when this agent should run. Should it check for new emails every hour, or wait until you tell it to start?"

**Warning signs:**
- User testing: users hover over cells without clicking
- Users answer CLI questions with "I don't know" or irrelevant answers
- Completeness stays at 0-25% for >2 minutes after the user starts
- Support requests asking "what does [technical term] mean?"

**Phase to address:**
Phase 2 (Build Flow) -- vocabulary and progressive disclosure are part of the guided experience. Phase 3 (Polish) should include user testing with non-technical participants.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing builder state in `useReducer` instead of Zustand | Simpler component, no global state | Background builds can't resume; state lost on navigation | Never -- migrate to Zustand slice in Phase 1 |
| Using `transition-all` on matrix cells | Easy to animate any property change | Triggers expensive transitions on every CSS change (colors, shadows, borders); kills 60fps | Never for production cells -- use explicit transition properties |
| Emitting one Tauri event per CLI output line | Simple implementation matches existing pattern | WebView overload at high output rates; cascading re-renders | Acceptable during Phase 1 prototyping, must migrate to channels/batching before Phase 2 animations |
| Sharing `designIdRef` as a module-level variable (`_designIdRef` in `useDesignAnalysis.ts`) | Allows stable callbacks without re-creating closures | Single-instance assumption breaks if two build sessions ever coexist; non-obvious mutation pattern | Acceptable for v1 single-session constraint, document the limitation |
| Hardcoding 8-cell grid layout (3+center+4 pattern) | Matches current `AgentIR` structure | Adding new persona dimensions requires layout rework | Acceptable if the `AgentIR` schema is stable; add a TODO for dynamic grid |

## Integration Gotchas

Common mistakes when connecting subsystems in this builder.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CLI Engine -> Matrix Cell Updates | Emitting `design-status` with full `AgentIR` on every property change (entire matrix re-derives) | Emit granular `cell-updated` events with cell key + new value; matrix subscribes per-cell |
| Zustand Store -> Framer Motion | Reading store state in animated component causes re-render on any slice change | Use fine-grained selectors (`useAgentStore(s => s.buildSession?.cellState['connectors'])`) to isolate re-renders to the affected cell |
| `builderReducer` -> `design_context` persistence | Writing `design_context` on every reducer dispatch (expensive JSON serialization on every keystroke) | Debounce persistence to 500ms after last dispatch; persist immediately only on navigation-away |
| Background job completion -> Matrix revival | Assuming the Matrix component is mounted when the job completes; calling component-level callbacks | Route completion through Zustand/EventBridge so it works whether or not the UI is mounted |
| Credential auto-matching -> Matrix connectors cell | Running auto-match only after `APPLY_DESIGN_RESULT` but not after manual connector edits | Also trigger auto-match on `ADD_COMPONENT` and `UPDATE_COMPONENT_CREDENTIAL` actions |

## Performance Traps

Patterns that work at small scale but fail as the matrix grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `useMemo` for cells array with 10+ dependencies (line 268, PersonaMatrix.tsx) | Memo invalidates on every edit-state change, re-creating all 8 cell objects | Split into per-cell memos or move cell derivation into individual cell components | Breaks at >3 cells editing simultaneously |
| Framer Motion `AnimatePresence` wrapping the entire grid | Every cell addition/removal re-measures all siblings | Use `AnimatePresence` per-cell, not per-grid; or use CSS transitions for the grid layout | Breaks when 4+ cells animate entrance simultaneously |
| CLI output stored as growing array in React state | State updates trigger full component re-render; array growth causes GC pressure | Use a ring buffer (fixed-size), stored in a ref; expose only the visible slice via a selector | Breaks at >200 lines with active animations |
| `createPortal` for every modal/overlay (MatrixCommandCenter uses it for PromptModal) | Each portal is a React subtree with independent reconciliation | Reuse a single portal root; control visibility via state, not mount/unmount | Breaks when 2+ modals are opened rapidly |

## Security Mistakes

Domain-specific security issues for the builder context.

| Mistake | Risk | Prevention |
|---------|------|------------|
| CLI engine executes user-provided "intent" text without sanitization | Prompt injection: user crafts intent that causes LLM to produce malicious system prompt or credential exfiltration | Sanitize intent input (length limit, strip control characters); the `sanitize_env_name` pattern in `runner.rs` shows the team knows about this -- apply similar rigor to intent text |
| Persisting draft personas with credentials before user approval | Abandoned drafts may reference real credentials that appear in audit logs or are accessible via API | Don't link credentials to draft personas until the user explicitly approves the build. The current `AUTO_MATCH_CREDENTIALS` fires automatically -- gate it behind the approval step |
| Background build sessions with no timeout kill-switch | A stuck build session holds a Rust tokio task indefinitely, leaking memory and potentially holding credential locks | Use the `CancellationToken` already present in `BackgroundJobManager`; enforce a hard 30-minute maximum session lifetime |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing all 8 cells at once during onboarding | Non-technical users are overwhelmed; don't know where to start | Progressive reveal: start with intent + 1 cell; add cells as the CLI populates them |
| Matrix cells highlight to request answers but the input field is in the center command cell | User's eyes go to the highlighted cell but the input is elsewhere; spatial disconnect | Place inline input directly on the highlighted cell, or use an arrow/connector visual from the cell to the command center input |
| "Generating..." spinner with no progress indication | User doesn't know if 10% or 90% done; anxiety increases, user navigates away | Show which cells have been resolved vs. pending; use the completeness ring (already exists in `MatrixCommandCenter`) but make it cell-granular |
| Refine/adjust feedback box is too small and vague ("Adjust anything...") | Users don't know what they can change; type vague requests that don't map to cells | Offer cell-specific refine: "Change triggers" or "Add more connectors" as clickable chips that pre-fill the refinement prompt |
| Error states show technical messages from the CLI engine | Non-technical users see Rust error messages or LLM parsing failures | Catch all errors at the boundary; display friendly messages with recovery actions ("Something went wrong building your agent. Try simplifying your description, or click Retry.") |
| Animation-heavy entrance hides that the matrix is interactive | Users watch the animation like a video instead of clicking cells | Keep entrance animation under 2 seconds total; immediately show interactive affordances (hover states, cursor changes) on animation completion |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Cell-by-cell animation:** Often missing stagger budget enforcement -- verify that no more than 3 cells animate simultaneously by running a burst test (CLI returns all 8 properties in <500ms)
- [ ] **Background build resume:** Often missing intermediate state persistence -- verify by navigating away mid-Q&A (not just mid-generation) and returning; the question and all previous answers should be intact
- [ ] **Progressive reveal:** Often missing the "return to full matrix" state -- verify that after initial reveal animation, ALL cells are visible and interactive; don't trap users in a partial view
- [ ] **CLI Q&A flow:** Often missing the "skip question" path -- verify that users can skip optional questions without blocking the build; the CLI must handle empty/skip answers gracefully
- [ ] **Credential auto-matching:** Often missing the "no credentials available" state -- verify that when no matching credentials exist, the cell shows a clear "connect [service]" CTA, not just an empty bullet list
- [ ] **Test run before promotion:** Often missing the "test failed" recovery path -- verify that a failed test run doesn't leave the draft in a broken state; user should be able to edit and re-test
- [ ] **Old mode feature parity:** Often missing Build mode's validation gates -- verify that `computeCredentialCoverage` logic is active in the unified flow; a persona with unmatched required connectors should warn, not silently proceed
- [ ] **Accessibility:** Often missing keyboard navigation through the matrix grid -- verify that Tab/Arrow keys move focus between cells and Enter activates cell interaction; screen readers announce cell labels and content

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| WebView crashes during animation | LOW | Implement animation kill-switch (disable all Framer Motion via context flag); revert to CSS-only transitions; profile and remove offending animations |
| Background build state lost | MEDIUM | Add a "recover build" flow that reads the `BackgroundJobManager` snapshot from Rust and reconstructs the Zustand session state; worst case, the user restarts with their intent pre-filled |
| Feature regression after mode removal | HIGH | Keep old mode code on a git branch with a feature flag (`DEV_LEGACY_MODES`); when a regression is reported, compare behavior side-by-side; port the missing logic to the unified flow |
| CLI session deadlock (question not delivered) | MEDIUM | Add a 60-second watchdog: if the backend is in `awaiting-input` but the frontend never received the question event, re-emit the question; add a manual "refresh session" button |
| Contrast/readability complaints | LOW | Extract all opacity values into design tokens (`--text-primary-opacity`, `--text-secondary-opacity`); ship a "high contrast" mode that raises all opacities; takes ~2 hours if tokens are in place |
| Non-technical user confusion | MEDIUM | Add an opt-in "guided mode" overlay (tooltip tour) that explains each cell on first use; make it dismissible and don't show again; can be added as a Phase 3 polish item without restructuring |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Tauri event flooding / WebView crash | Phase 1 (Core Architecture) | Profile: 0 dropped frames during CLI stream with 9 cells visible; test with 100 events/second burst |
| Background build state loss | Phase 1 (Core Architecture) | Test: navigate away mid-build, navigate back; state is intact. Test: close app mid-build, reopen; session recoverable |
| Three-mode feature regression | Phase 2 (Build Flow) | Feature-parity matrix document with 100% coverage; side-by-side test of old Chat/Build/Matrix workflows vs. unified |
| Animation performance (60fps) | Phase 2 (Build Flow) | Chrome DevTools Performance: hold 60fps at 4x CPU throttle during cell-fill animation burst. No `layout` props on cell elements |
| CLI session management | Phase 1 (Core Architecture) | Test: 10 rapid Q&A round-trips complete without ordering errors; session survives 20-minute idle gap; double-submit is impossible |
| Futuristic UI readability | Phase 2 (Build Flow) + Phase 3 (Polish) | WCAG AA contrast checker passes on all text. User test: 3 non-technical users can read all cell content without squinting |
| Non-technical user confusion | Phase 2 (Build Flow) + Phase 3 (Polish) | User test: non-technical user builds a working agent in <5 minutes using guided flow without asking for help |

## Sources

- [Tauri v2 Event System Documentation](https://v2.tauri.app/develop/calling-frontend/) -- confirms events evaluate JS directly, channels preferred for high-frequency data
- [Tauri Issue #10987](https://github.com/tauri-apps/tauri/issues/10987) -- panic caused by high-frequency event emission
- [Framer Motion Performance Guide](https://motion.dev/docs/react-motion-component) -- v11 improvements for large animation sets
- [MDN: CSS/JS Animation Performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance) -- GPU-composited properties (transform/opacity) maintain 60fps
- [LogRocket: UI Patterns for Async Workflows](https://blog.logrocket.com/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines) -- background job state recovery UX patterns
- [Smashing Magazine: Inclusive Dark Mode](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/) -- dark theme contrast and accessibility requirements
- [UXmatters: Designing for Autonomy](https://www.uxmatters.com/mt/archives/2025/12/designing-for-autonomy-ux-principles-for-agentic-ai.php) -- AI agent UX principles for non-technical users
- [NN/g: Dark Mode Issues](https://www.nngroup.com/articles/dark-mode-users-issues/) -- usability problems with dark themes
- [Huyenchip: AI Engineering Pitfalls](https://huyenchip.com/2025/01/16/ai-engineering-pitfalls.html) -- common mistakes in AI application building
- Codebase analysis: `PersonaMatrix.tsx`, `eventBridge.ts`, `useTauriStream.ts`, `useDesignAnalysis.ts`, `useMatrixOrchestration.ts`, `builderReducer.ts`, `background_job.rs`, `runner.rs`, `queue.rs`, `MatrixCommandCenter.tsx`, `CreationWizard.tsx`, `animationPresets.ts`

---
*Pitfalls research for: Unified AI Agent Matrix Builder UX*
*Researched: 2026-03-14*
