# Feature Landscape

**Domain:** Unified AI agent matrix builder with live CLI-driven construction
**Researched:** 2026-03-14
**Overall confidence:** MEDIUM-HIGH

## Table Stakes

Features users expect from any AI agent builder. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Natural language intent input | Every competitor (OpenAI Agent Builder, Gumloop, Lindy, MindStudio) accepts plain-text descriptions to start building. Users expect "describe what you want, get an agent." | Low | **Already exists** in `MatrixCommandCenter.tsx` as intent textarea. Keep as primary entry point. |
| Template/starter prompt suggestions | Gumloop, n8n, MindStudio all offer starter prompts or templates to reduce blank-page anxiety. Non-technical users especially need a "show me what's possible" nudge. | Low | **Already exists** in `ChatCreator.tsx` with `STARTER_PROMPTS`. Needs surfacing in unified matrix mode. |
| Visual progress feedback during generation | OpenAI Agent Builder shows per-node execution state; Gumloop streams build progress. Users will not tolerate a spinner-only experience for 10-60 second builds. | Medium | **Partially exists** via `cliOutputLines` prop. The cell-by-cell animation aspiration goes beyond table stakes but *some* visible progress is mandatory. |
| Inline editing of generated configuration | Every builder lets you adjust what the AI produced. Lindy and n8n let you edit within the visual canvas. An immutable output is useless. | Medium | **Already exists** via `MatrixEditState` / `MatrixEditCallbacks` in PersonaMatrix edit mode. 8 cell types support edit rendering. |
| Test/preview before committing | OpenAI Agent Builder offers preview runs with per-node observation. StackAI recommends multi-level testing before deployment. "Try before you buy" is universal. | Medium | **Partially exists** via `useDryRun` in `useMatrixOrchestration`. Needs to be surfaced clearly as a step the user *must* take (not optional/silent). |
| Draft vs. production separation | Standard software pattern: staging -> production with an approval gate. Every serious builder separates "editing" from "live." | Medium | **Already exists** via `DraftDiffViewer` and draft persona system. Needs explicit promotion flow in unified builder. |
| Undo/cancel generation | If the AI generates garbage, users need to abort or restart. All competitors offer this. | Low | **Partially exists** via `cancelAnalysis` in design state. Needs clear cancel button during build phase. |
| Connector/credential attachment | Every agent builder (n8n 400+ integrations, Lindy 4000+ apps, Gumloop 130+ nodes) treats integrations as first-class. An agent without connections is useless. | Medium | **Already exists** via `ConnectorEditCell`, credential matching. The matrix already renders this as a dedicated cell. |
| Error handling configuration | Table stakes for production agents. OpenAI Agent Builder and n8n both surface retry/fallback/escalation. Users need to know what happens when things fail. | Low | **Already exists** via error handling cell in matrix. Keep as-is. |
| Trigger/schedule configuration | Agents need to run on something -- schedule, webhook, event. Every competitor offers trigger configuration. | Medium | **Already exists** via `TriggerEditCell` and trigger presets. |

## Differentiators

Features that set the unified matrix builder apart from competitors. These are what make it worth using over OpenAI Agent Builder, n8n, or Gumloop.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Matrix-first visualization (not graph/canvas)** | Every competitor uses a node-and-wire graph (OpenAI, n8n, Gumloop, Lindy, Relevance AI). A matrix/grid with 8 dimension cells + command center is genuinely different. Provides at-a-glance overview vs. spaghetti graphs. Non-technical users understand a grid better than a DAG. | Low (exists) | **Already exists** as the 3x3 grid with `PersonaMatrix`. This IS the core differentiator. Protect it. |
| **Cell-by-cell live construction animation** | "Watching AI think" -- cells light up, pulse, fill in as the CLI engine resolves each dimension. No competitor does this. OpenAI shows per-node execution but in a linear trace, not a spatial matrix. Creates a futuristic "control room" feeling. | High | New feature. Requires: (1) backend emitting per-dimension progress events, (2) frontend cell state machine (empty -> pending -> filling -> resolved), (3) Framer Motion orchestration for glow/pulse/fill animations. |
| **Guided progressive reveal from single prompt** | Matrix starts mostly hidden/dimmed. As intent is analyzed, relevant cells progressively reveal with animation. Teaches the interface through usage rather than a tutorial. Progressive disclosure (NNGroup) applied to agent building. | High | New feature. Requires: (1) cell visibility state management, (2) staggered reveal animations, (3) logic to determine which cells are relevant to a given intent. |
| **Click-to-answer interaction on highlighted cells** | When the CLI engine needs user input, the relevant cell highlights/pulses. User clicks it to provide the answer. This is spatial Q&A -- questions appear WHERE they matter, not in a chat sidebar. No competitor does contextual spatial questioning. | High | New feature. Requires: (1) mapping CLI questions to matrix cell keys, (2) cell highlight/pulse state, (3) inline answer UI within each cell, (4) answer submission back to CLI engine. |
| **Command center orb as build nexus** | The center cell (9th position) acts as both launch control and status hub. Radial orb for generation, completeness ring for progress, refine input for iteration. One focal point for the entire build lifecycle. | Medium | **Partially exists** in `MatrixCommandCenter.tsx` with generation/completeness variants. Needs enhancement for unified flow lifecycle (idle -> generating -> Q&A -> testing -> promoting). |
| **Background build with return-to-progress** | User starts a build, navigates away (checks vault, reviews other agents), comes back to find cells filled in. Desktop advantage -- background processing that web-only tools cannot match. | Medium | **Partially exists** via `background_job.rs` and execution queue. Needs: (1) session persistence for build state, (2) re-hydration of matrix on return, (3) notification when build needs input or completes. |
| **Explicit test-then-promote approval gate** | After generation, user must run a real test, see actual output, then explicitly approve before the draft becomes a live persona. Competitors either auto-deploy or bury testing. Making it a mandatory, visible step builds trust. | Medium | **Partially exists** via `useDryRun` auto-test. Needs: (1) visible test results panel, (2) explicit "approve & activate" vs "reject & refine" actions, (3) diff view of what will be created. |
| **Futuristic/ambient aesthetic** | Dark control-room theme with glowing cells, particle effects, neon accents. Competitors use bland enterprise UIs (OpenAI), whitespace-heavy minimal (Lindy), or generic SaaS (Gumloop). The visual identity IS a feature -- makes building feel like commanding a starship, not filling out a form. | Medium | Some styling exists in matrix (`shadow-primary`, neon glow, radial gradients). Needs: (1) consistent dark theme tokens for build mode, (2) particle/ambient background effects, (3) cell state-driven glow colors. |
| **Completeness scoring with visual feedback** | Live completeness ring (0-100%) that updates as cells fill. Users can see exactly how "done" their agent is. Combines with progressive reveal -- cells that would increase completeness are highlighted as suggestions. | Low | **Already exists** via `calcCompleteness()` in `useMatrixOrchestration` and completeness ring in command center. Needs: (1) per-cell contribution display, (2) "next recommended" highlighting. |
| **Refine-in-place iteration** | After initial generation, user types refinement feedback and the CLI engine adjusts specific cells without regenerating everything. Surgical refinement vs. full rebuild. | Medium | **Partially exists** via `onRefine` prop. Needs: (1) targeted regeneration of specific dimensions, (2) visual diff of what changed, (3) undo for individual refinements. |

## Anti-Features

Features to explicitly NOT build. Avoiding these is as important as building the differentiators.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Node-and-wire graph editor** | Every competitor already does this (n8n, Gumloop, Lindy, OpenAI). Copying their UX neutralizes the matrix differentiator. Graph editors are also hostile to non-technical users -- wire management, zoom/pan, node positioning all create cognitive load. | Keep the matrix grid. If workflow sequencing is needed, show it as an ordered list within a cell, not a graph. |
| **Separate chat/build/matrix modes** | The whole point of this milestone is unification. Three modes means three partial experiences with three onboarding costs. The current `CreationWizard` with `EntryMode = 'build' | 'chat' | 'matrix'` must be retired. | Single unified matrix experience with the command center handling all interaction modes. |
| **Tutorial/walkthrough overlay** | Tutorial popups are universally dismissed. Non-technical users need learning through usage (progressive reveal), not a 5-step tooltip tour. NNGroup research shows inline guidance outperforms overlays. | Progressive disclosure of cells teaches the interface. Starter prompts show what is possible. Highlighted "next action" cells guide the flow. |
| **Complex JSON/YAML configuration UI** | Exposing raw config to non-technical users destroys the "zero code" promise. Even n8n hides raw JSON behind visual forms. | Keep config behind semantic controls (toggles, dropdowns, pickers). Power users get a JSON view only in settings/advanced, never in the primary build flow. |
| **Multi-persona simultaneous building** | Scope creep. One build session at a time is explicitly out of scope (per PROJECT.md). Multi-build adds massive state management complexity for minimal v1 value. | Queue persona creation. Show "you have a build in progress" if user tries to start a second. |
| **Drag-and-drop cell reordering** | Cells represent fixed agent dimensions (use cases, connectors, triggers, review, messages, memory, errors, events). Reordering them adds complexity without value -- the grid layout IS the conceptual model. | Fixed 3x3 grid with consistent cell positions. Users learn "connectors is top-right" like muscle memory. |
| **AI chat sidebar during build** | Adding a persistent chat panel recreates the old chat mode as a sidebar, defeating unification. The matrix IS the conversation -- questions appear in cells, answers go back to cells. | Spatial Q&A via cell highlighting. If the user wants to give freeform feedback, the command center refine input handles it. |
| **Per-model pricing display** | Unlike Gumloop and MindStudio which are cloud-hosted pay-per-use platforms, this is a desktop app with BYOM (bring your own model). Showing model costs during build adds anxiety and is architecturally different from the hosted competitors. | Show model configuration in settings. Build flow focuses on capability, not cost. |
| **Template marketplace** | n8n has 8500+ templates, Gumloop has a community library. Building a marketplace is a separate product initiative, not part of the build experience. | Support importing/exporting persona configs. A curated starter set of prompts is enough for v1. Template marketplace can be a future milestone. |

## Feature Dependencies

```
Intent Input (exists)
  -> AI Generation (exists)
    -> Cell-by-cell animation (NEW - requires per-dimension events from backend)
    -> Progressive reveal (NEW - requires cell visibility state)
      -> Click-to-answer spatial Q&A (NEW - requires cell-question mapping)
    -> Completeness scoring (exists)
      -> "Next recommended" cell highlighting (NEW - trivial addition)
    -> Background build (partially exists)
      -> Return-to-progress resumption (NEW - requires session persistence)
    -> Dry run / test (partially exists)
      -> Explicit approval gate (NEW - requires approval UI)
        -> Draft-to-production promotion (exists)
    -> Refine-in-place (partially exists)
      -> Targeted dimension regeneration (NEW)

Futuristic aesthetic (NEW)
  -> Cell state-driven glow (NEW - depends on cell-by-cell animation states)
  -> Ambient background effects (NEW - independent)
  -> Dark theme tokens (NEW - independent)

Guided start experience = Progressive reveal + Starter prompts + Completeness scoring
```

## Critical Path

The dependency chain that determines build order:

1. **Backend per-dimension events** -- Everything animated depends on the CLI engine reporting progress at the dimension level (not just "done/not done"). This is the single most important new backend feature.
2. **Cell state machine** -- Each cell needs states: hidden -> revealed -> pending -> filling -> resolved -> highlighted-for-input. This drives both animation and Q&A.
3. **Cell-question mapping** -- The CLI engine's questions need metadata linking them to specific matrix cells. Without this, spatial Q&A is impossible.
4. **Approval gate UI** -- The test-then-promote flow needs a visible results panel with accept/reject actions.

## MVP Recommendation

Prioritize this set for the initial milestone:

1. **Unified entry point** (retire 3-mode wizard) -- Table stakes for the unified vision. Low complexity because the matrix mode already works.
2. **Guided progressive reveal** -- The single most impactful UX feature. Makes the matrix approachable for non-technical users. Without this, an empty 3x3 grid is intimidating.
3. **Cell-by-cell live construction** -- The core differentiator. "Watching AI think" in a spatial grid is what makes this product unique.
4. **Click-to-answer spatial Q&A** -- Completes the interaction model. Without it, Q&A falls back to a chat sidebar (anti-feature).
5. **Explicit test-then-promote gate** -- Builds trust. Users must see their agent work before committing.

Defer:
- **Background build with resumption**: Valuable but complex session persistence. The base case (user stays on page during build) must work first.
- **Futuristic ambient effects (particles, heavy glow)**: Polish layer. Ship the interaction model first, add visual flair in a follow-up.
- **Targeted dimension regeneration**: Requires more sophisticated CLI engine coordination. Full-regeneration with refinement feedback is sufficient for v1.
- **Template/starter library**: Not needed for the build experience itself. Starter prompts cover the blank-page problem.

## Sources

- [OpenAI Agent Builder docs](https://developers.openai.com/api/docs/guides/agent-builder/) - Visual canvas, preview runs, versioning (HIGH confidence)
- [Gumloop blog - best AI agent builders 2026](https://www.gumloop.com/blog/best-ai-agent-builder) - Node-based canvas, 130+ nodes, minimal learning curve (MEDIUM confidence)
- [Lindy no-code agent builder review](https://www.lindy.ai/blog/no-code-ai-agent-builder) - Block-based interface, drag-and-drop, templates (MEDIUM confidence)
- [MindStudio review](https://max-productive.ai/ai-tools/mindstudio/) - Visual workflow builder, 100+ templates, 15min-1hr build time (MEDIUM confidence)
- [Relay.app best AI agent builders 2026](https://www.relay.app/blog/best-ai-agent-builders) - Market comparison, feature landscape (MEDIUM confidence)
- [n8n workflow automation guide](https://hatchworks.com/blog/ai-agents/n8n-guide/) - 400+ integrations, visual editor, template marketplace (MEDIUM confidence)
- [NNGroup progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) - UX pattern for staged complexity (HIGH confidence)
- [StackAI agent testing](https://www.stackai.com/insights/ai-agent-testing-and-qa-how-to-validate-agent-behavior-before-deploying-to-production) - Testing patterns before deployment (MEDIUM confidence)
- [Shape of AI UX patterns](https://www.shapeof.ai/) - AI interface design patterns reference (MEDIUM confidence)
- [Smashing Magazine AI interfaces](https://www.smashingmagazine.com/2025/07/design-patterns-ai-interfaces/) - Shift away from chat-alike interfaces (MEDIUM confidence)
