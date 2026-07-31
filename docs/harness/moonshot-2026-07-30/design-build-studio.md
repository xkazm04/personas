# Moonshots — Design & Build Studio

## 1. The Certified Persona Foundry — every persona proves itself before it exists

- **Tier**: 1 (10x category-defining)
- **Category**: intelligence + data-moat
- **Impact**: No persona is ever hand-promoted again — every design is compiled, flight-tested against its own generated test scenarios in a sandboxed loop, auto-fixed until it passes, and shipped with a living certification score that keeps updating from real runs; the accumulated evidence becomes a proprietary prior that makes every future build smarter.
- **Feasibility**: medium (all four load-bearing pieces already exist in partial form — this is explicitly a "finish and amplify" moonshot)
- **Time-horizon**: months
- **Why it's a moonshot**: Today the design pipeline is generative but not evidentiary: the IntentCompiler already emits `test_scenarios` in its output schema, the build session already has quality gates, a fix-pass, and an LLM-driven pre-promote test runner — but none of these close the loop. The scenarios are generated and then *displayed*, not *executed*; the gates gate structure, not behavior; certification dies at promote-time instead of living with the persona. Closing this loop changes what a persona *is*: from "a prompt someone configured" to "an agent that demonstrably does its job," which is the difference between a config editor and a foundry. And because every certification run produces structured evidence (scenario → transcript → score → fix applied), the app accrues a dataset nobody else has: which prompt shapes, gate answers, and archetype pairings actually survive contact with reality — feeding directly back into template match confidence and archetype priors.
- **What exists today**:
  - `src-tauri/engine/src/intent_compiler.rs` — already generates `test_scenarios` alongside the design (currently decorative output).
  - `src-tauri/src/engine/build_session/gates.rs` — Rule 16/17 gate state machine incl. the `sample_output` gate (the exact contract a scenario run should be scored against).
  - `src-tauri/src/engine/build_session/fix_pass.rs` + `tool_tests.rs` — auto-patching of failing steps and the pre-promote LLM test runner (currently one-shot, not a convergence loop).
  - `src-tauri/src/engine/build_session/orchestrator.rs` — the bounded-parallel lane scheduler, purpose-built for fanning out per-scenario runs but noted as "nothing in the runner fans out yet."
  - `src/features/agents/components/matrix/buildTemplateMatchConfidence.ts` + `src/hooks/design/template/useTemplateGallery.ts` — confidence scoring and gallery surfaces waiting for real evidence to display.
  - `src/features/agents/components/matrix/BuildSimulatePanel.tsx` — the UI seam where certification results belong.
- **Path to implementation**:
  1. Wire the already-generated `test_scenarios` into `run_lanes` in `orchestrator.rs`: after a build session's promote gate, execute each scenario against the freshly compiled persona (sandboxed, no external side effects — dry-run connectors) and persist transcript + verdict per scenario into `build_sessions`.
  2. Score each scenario against the `sample_output` gate's accepted format and the capability contract (`src-tauri/engine/src/capability_contract.rs`), producing a per-capability pass/fail matrix.
  3. Loop `fix_pass.rs` over failures with a convergence budget (N attempts, gate on regression) — the persona iterates itself until certified or flagged.
  4. Persist a `certification` object on the persona (score, scenarios, evidence, model used, date) and render it in `BuildSimulatePanel.tsx` and the template gallery as a first-class badge.
  5. Feed live execution outcomes (already tracked by execution-monitoring) back into the score so certification decays or strengthens with reality; recompute template match confidence from certified-fleet evidence instead of static heuristics.
  6. Let the gallery rank/filter by certification — "proven" templates become the default creation path.
- **Dependencies**: build-session-lifecycle + execution-runner (sandboxed runs), capability_contract, template gallery, SQLite (`build_sessions`, `personas`, new certification columns); no external services beyond the existing CLI/LLM.
- **Risks**: (1) Scenario runs cost real tokens per build — needs an effort budget and caching, or certification becomes the thing users skip. (2) LLM-judged pass/fail can enshrine wrong expectations (the medical-bill lesson: generated tests can encode bugs) — the sample_output gate answer from the *user* must stay the ground truth. (3) Convergence loops can thrash; hard attempt caps and "certified with exceptions" states are mandatory.
- **What changes if we ship it**: Personas stops being an editor with an AI assistant and becomes a foundry whose output is warrantied — and the certification corpus becomes a moat that compounds with every build the owner (and eventually every user) runs.

## 2. Athena Ships Agent-Native Apps — the Studio builds the product *and* the workforce that runs it

- **Tier**: 1 (10x category-defining)
- **Category**: platform
- **Impact**: A single vision prompt ("a lead-gen site for my agency") produces not just the web app but the operating business around it — Athena compiles the support persona, the content-refresh persona, and the inbound-lead triage persona via the IntentCompiler, wires them to the app through the existing webhook/trigger and MCP surfaces, and hands over a running, self-operating product instead of a static build.
- **Feasibility**: medium
- **Time-horizon**: quarters (first vertical slice in weeks)
- **Why it's a moonshot**: The app currently contains two world-class factories that don't know about each other: the Athena Web Build Studio (vision → scaffold → live dev server → turn-based build, all state in `studioStore.ts`) and the persona design pipeline (intent → complete persona with tools, triggers, tests). Every web-app category in `StudioVisionStart.tsx`'s starters — portfolio, landing, dashboard, blog — has an obvious agent workforce (contact-form responder, lead qualifier, data refresher, publisher). Fusing them redefines the product category: every builder tool on the market stops at "here's your site"; none can say "here's your site and the three agents already answering its inbox," because none of them own an agent runtime. Personas does. This is the leverage multiplier the owner wants: one prompt → an app plus its automation, reusable across every project in the fleet.
- **What exists today**:
  - `src/features/studio/studioStore.ts` + `src/features/studio/StudioPage.tsx` — the persistent multi-project build runtime with the full `webbuild*` IPC surface and per-project MCP connector config (`mcp: string[]` already on `ProjectRuntime`).
  - `src/features/studio/StudioDecision.tsx` + `StudioQuickActions.tsx` — the decision-card mechanism, the natural UX for "this app needs a support agent — spawn one?".
  - `src-tauri/engine/src/intent_compiler.rs` — greenfield intent → full persona (prompt + tools + triggers + tests) in one shot; exactly the compiler a Studio turn would invoke.
  - `src/api/templates/n8nTransform.ts` — proof the codebase already converts external workflow shapes into persona drafts; an app's API routes are just another workflow shape.
  - Cross-group but already shipped: the trigger system (inbound webhooks) and mcp-protocol context (personas addressable from outside), which are the two wires an external app needs.
  - `src-tauri/src/engine/render_plan/` — the Media Studio IR; the same fusion later lets a persona own the app's media/content pipeline.
- **Path to implementation**:
  1. Add an "operating agents" phase to the Studio build plan model (`src/features/studio/studioBuildModel.ts`): after Foundation, Athena's plan may include agent proposals emitted as a structured line (like the existing `BUILD_PLAN` / `NEEDS_INPUT` conventions in `studioStore.ts`), each surfaced as a StudioDecision card.
  2. On acceptance, call `compile_from_intent` (the existing `commands::design::analysis` path) with an intent synthesized from the project's vision + the routes Athena just built (`webbuildListRoutes` already exists) — producing a draft persona pre-wired to the app's context.
  3. Generate the glue in both directions in the same turn: Athena writes a webhook POST into the scaffolded app (contact form → persona trigger URL) while the persona side registers the inbound-webhook trigger; store the pairing on the project runtime.
  4. Surface the workforce in the Studio: a per-project agents rail next to the plan drawer showing each embedded persona's live status (reuse execution-monitoring data), with click-through to the persona editor.
  5. Certify the embedded personas with Moonshot 1's loop (or today's tool tests as interim) so a shipped app's agents are proven against the app's actual endpoints.
  6. Generalize into a "product blueprint": vision → app + agents + schedules exported as one reproducible bundle, deployable across the owner's fleet projects.
- **Dependencies**: studio-core IPC surface, design-template-api (`compile_from_intent`), trigger-system + mcp-protocol contexts (cross-group), credential-design-hooks for connector auth of spawned personas, dev-server routing for local webhook loopback.
- **Risks**: (1) Local-first reality: a webhook from a deployed app can't reach a desktop-app persona without a relay/tunnel — the first slice must be honest that it works dev-loop-local, with a relay as a later phase. (2) Scope explosion inside a build turn — agent compilation must be its own async task (the `useAiArtifactTask` pattern), never blocking the web build. (3) Auto-spawned personas with credentials raise the blast radius; every spawn must route through the existing credential negotiator, no silent grants.
- **What changes if we ship it**: The Studio's output stops being a website and becomes an operating business unit — Personas graduates from "app that manages agents" to "the factory that ships agent-native products," a category nobody else's builder can enter without owning an agent runtime.
