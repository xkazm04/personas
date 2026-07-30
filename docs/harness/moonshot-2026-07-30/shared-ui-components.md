# Moonshots — Shared UI Components

## 1. The Generative Cockpit — agents emit UI, not text
- **Tier**: 1 (10x category-defining)
- **Category**: interface
- **Impact**: Every persona run stops producing a text blob and starts producing a live, interactive decision surface — tables, gauges, accept/reject streams, dispatch buttons — rendered entirely from the 122-component blessed catalog, turning Personas from an agent *runner* into an agent *operating surface*.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: Today agent output lands as markdown/JSON that a human reads and then manually acts on elsewhere in the app. The moonshot inverts this: agents declare a typed `SurfaceSpec` (a constrained JSON schema whose vocabulary is exactly the shared catalog — StatCard, ConfidenceArc, UnifiedTable, FacetedDecisionTable, DecisionRow, MarkdownRenderer, EstimatedProgressBar, terminal panels) and the app renders it with actions wired back into execution. Because the vocabulary is the *existing, ESLint-enforced, token-consistent* component set, agent-generated UI is guaranteed on-brand, accessible, and safe — no arbitrary HTML, no injection surface, no design drift. This is the same bet as OpenAI's "generative UI" but with a moat competitors can't copy: a curated primitive catalog that already exists and is already the only way UI gets built here. It amplifies the Agent Execution, Execution Observability, Recipe Playback, and Self-Healing Recovery journeys simultaneously — a healing alert becomes a DecisionRow with one-click retry; a research persona's run becomes a faceted table you triage, not a wall of prose.
- **What exists today**:
  - The full vocabulary: `src/features/shared/components/CATALOG.md` (auto-generated, 122 components) and the sub-trees `display/` (`UnifiedTable.tsx`, `FacetedDecisionTable.tsx`, `StatCard.tsx`, `ConfidenceArc.tsx`, `GroupedVirtualList.tsx`), `editors/MarkdownRenderer.tsx`, `editors/JsonEditor.tsx`, `terminal/CliOutputPanel.tsx`, `progress/TransformProgress.tsx`.
  - The action contract, already domain-free by design: `src/features/shared/components/decisions/decisionTypes.ts` — `DecisionRecord`/`DecisionAction` explicitly built so "each feature writes a small adapter"; an agent is just another adapter author.
  - The action *executor*: `src/features/shared/dispatch/DispatchChooser.tsx` — a universal consent surface any generated button can hand a prepared prompt to (dev runner / fleet / CLI / console), with the `prepare()` pre-flight hook.
  - `src/features/shared/components/layout/ReasoningTrace.tsx` (expandable AI reasoning) and `VibeThemeProvider` (persona-derived theming) — the cockpit inherits the persona's visual identity for free.
- **Path to implementation**:
  1. Define `surfaceSpec.ts` next to `decisionTypes.ts`: a discriminated-union schema (`stat_row | table | decisions | markdown | gauge | progress | terminal`) with zod validation, plus `SurfaceAction` mapping onto `DecisionAction` and `DispatchRequest`. Doable now, pure types + tests.
  2. Build `<SurfaceRenderer spec={...}>` that maps each node to the existing catalog component — a ~300-line switch, no new visual primitives allowed.
  3. Add a system-prompt fragment + output-assertion ("respond with a SurfaceSpec when structured") to the persona editor's output-assertions feature; validate/repair the spec on ingest, fall back to MarkdownRenderer on parse failure.
  4. Wire it into the execution result view and the Playground so recipe playback renders surfaces live.
  5. Connect `SurfaceAction` → DecisionActions callbacks and DispatchChooser, so generated buttons re-invoke personas or dispatch fleet work (consent-gated, nothing auto-runs).
  6. Ship spec-authoring docs into the auto-generated catalog pipeline so the schema and the components can never drift.
- **Dependencies**: zod (already in repo patterns), execution-runner result plumbing, persona output-assertions, DispatchChooser; no external services.
- **Risks**: LLMs emit invalid/hallucinated specs (mitigate: strict validation + markdown fallback + self-repair pass); action wiring is a consent/safety surface and must stay behind explicit confirmation; scope creep toward a full DSL — the vocabulary must stay frozen to the catalog.
- **What changes if we ship it**: Personas becomes the first agent desktop where output *is* interface — every persona ships with a bespoke, on-brand cockpit for zero design effort, and human-in-the-loop becomes click-through instead of copy-paste.

## 2. The Design Genome — export the design system as an agent-installable organ
- **Tier**: 1 (10x category-defining)
- **Category**: ecosystem
- **Impact**: The catalog + tokens + lint-enforcement trio becomes a machine-readable, versioned "genome" that Fleet installs into every managed repo, so every project the owner (and eventually other Personas users) builds with agents inherits Personas-grade UI quality automatically — multiplying one design system across an entire portfolio.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The owner runs a fleet of a dozen+ repos and constantly dispatches coding agents into them; every one of those agents re-derives UI conventions from scratch, badly. Personas already solved the hard part *for itself*: a generated catalog (`scripts/docs/gen-shared-catalog.mjs` → CATALOG.md, "run `npm run gen:catalog`"), semantic tokens (`designTokens.ts`, `statusTokens.ts`, motion registry), motion presets, and ESLint rules that ban hand-rolled buttons/modals. The moonshot is to make that whole discipline *portable and agent-consumable*: a published `@personas/ui` package + a JSON genome (component props via react-docgen-typescript, token values, usage rules) + a drop-in skill that teaches any coding agent "import, don't hand-roll" with lint gates that enforce it. Personas' Fleet dispatch already has the exact injection point — `DispatchRequest.prepare()` in `DispatchChooser.tsx` exists precisely for "placing a skill" in a target repo before a session starts. This turns the shared-components folder from an internal convenience into the product's ecosystem play: Personas doesn't just run your agents, it makes everything they build look and behave like a senior team shipped it.
- **What exists today**:
  - `scripts/docs/gen-shared-catalog.mjs` + `src/features/shared/components/CATALOG.md` — the generator and human-readable index (with `@catalog` JSDoc convention, partially populated).
  - `src/lib/utils/designTokens.ts`, `src/lib/design/statusTokens.ts`, `src/lib/utils/colorWithAlpha.ts`, `src/features/shared/components/display/motionPresets.ts`, `src/lib/utils/rafAnimationEngine.ts` — the token/motion layer, already framework-cleanly separated in `lib/`.
  - ESLint enforcement of the blessed set (Button, BaseModal re-export noted in the group extract) and `.claude/Design.md` — the rules layer.
  - Fleet transports + `prepare()` hook in `src/features/shared/dispatch/DispatchChooser.tsx`; the existing passport/kpi-sim pattern of dispatching skills into managed repos proves the delivery mechanism.
- **Path to implementation**:
  1. Extend `gen-shared-catalog.mjs` to also emit `catalog.json` — per-component name, import path, props (react-docgen-typescript), one-liner, category, "use instead of X" mapping. Doable now; pure build tooling, and it forces finishing the missing `@catalog` tags.
  2. Extract the token + primitive layer into a buildable package (`packages/personas-ui/`): tokens, buttons, feedback, display formatters, forms — the domain-free 80% of the catalog (decisions/dispatch stay app-side).
  3. Author the `design-genome` skill: catalog.json + token sheet + the "import, don't hand-roll" doctrine + an ESLint flat-config preset the skill installs.
  4. Add a Fleet dispatch preset that uses `prepare()` to place the skill + install the package in a target repo before any UI-building session.
  5. Dogfood across two owned repos (e.g. vibeman's Next.js UI), measure drift, then version the genome (semver + changelog surfaced in Personas' plugin ecosystem UI).
  6. Long-term: genome marketplace — users publish their own genomes; personas building UI anywhere consume them.
- **Dependencies**: react-docgen-typescript (build-time), npm publishing or git-subtree/verdaccio for private distribution, Fleet session spawning, ESLint preset packaging; Tailwind version alignment in consumer repos.
- **Risks**: Tailwind/theme coupling makes true portability harder than it looks (tokens must ship as CSS custom properties, not class strings); a package split adds maintenance drag to a solo owner if not automated; consumer repos on different React versions (mitigate: keep the genome data+rules useful even where the component package can't install — agents can replicate patterns from the JSON alone).
- **What changes if we ship it**: The design system stops being a folder and becomes leverage — one place to raise the bar, and every agent-built UI across the owner's entire fleet rises with it; Personas becomes the tool that makes *all* your software look designed.
