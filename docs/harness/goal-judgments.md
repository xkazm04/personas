# Goal Judgments — Personas Desktop

> Autonomous goal selection decisions and outcomes. Read at the start of Phase 2a to inform future ranking.

---

## Run #1 — 2026-04-11

**Mode:** improve
**Health scan:** 0 TS errors, 0 lint, 675/675 tests, 17 TODOs (all i18n placeholders), largest file 1294 LOC
**Selected goal:** Surface multi-agent workflow composer into production navigation
**Source:** scan (hidden feature discovery) + competitive analysis (multi-agent orchestration = gap #5)
**Confidence at selection:** high (feature already fully built, just needed wiring)
**Quality score:** 100/100
**User verdict:** accepted (approved plan without modifications)

**Why this goal was selected:**
The composition feature (~900 LOC across 6 components + store slice + DAG utils) was fully implemented but completely unreachable — no sidebar entry, no route, no user access. This was discovered via the host-infrastructure-first grep during Phase 2a scanning. Multi-agent workflow orchestration is a key competitive differentiator (CrewAI's entire value proposition). The feature includes NL-to-DAG compilation, visual ReactFlow canvas, topological execution with cost/token tracking. Surfacing it required only wiring and polish, not new feature development.

**Lessons for future ranking:**
- Scan for hidden/unreachable features FIRST — a fully built feature that no user can access is the highest-value discovery possible (zero implementation cost, high business impact)
- The project's feature surface is much larger than what the sidebar exposes — future runs should check for `devOnly: true` items that could be promoted
- Infrastructure readiness was already solid (20+ modules, sidebar navigation, shared layout) — this allowed jumping straight to feature surfacing
- localStorage persistence for workflows is a known tech debt — future stabilize runs should consider migration to SQLite

## Run #2 — 2026-04-11

**Mode:** improve
**Health scan:** 0 TS errors, 0 lint, 675/675 tests, 17 TODOs, largest file 1294 LOC
**Selected goal:** Agent Operations Hub Phase 2 — Chat Sidebar Panels
**Source:** vision-gap (agent-operations-hub.md Phase 2)
**Confidence at selection:** high
**Quality score:** 100/100
**User verdict:** accepted (approved from 4 options without modification)

**Why this goal was selected:**
The Agent Operations Hub design doc (docs/concepts/agent-operations-hub.md) defined 2 phases. Phase 1 (OpsLaunchpad preset cards + chatOpsDispatch operation routing) was already fully implemented. Phase 2 (compact sidebar panels for Run, Lab, Health, Assertions alongside the chat) was the logical next step. This consolidates 5 separate editor tabs into one unified operations interface accessible while chatting — directly serving the "understandable for non-technical users" criterion from the open goal.

Business domain scan findings (trace/replay, human-in-the-loop, marketplace) were deprioritized because:
- Trace/replay already existed (sub_executions/trace/ + replay/ with 15+ components)
- Human-in-the-loop approval gates would require Rust backend changes
- Marketplace was too large for one run

**Lessons for future ranking:**
- Vision-gap goals with existing design docs are highest-confidence — the spec is pre-written
- Always run already-existed check against business domain scan findings — 1 of 3 gaps was already implemented
- The codebase is extremely mature (0 errors, 675 tests); "improve" mode goals should target UX consolidation or novel features, not missing basics
- Chat tab is the integration point for operations — future features should consider adding compact views to the ops sidebar panels rather than creating new editor tabs

## Run #3 — 2026-04-11

**Mode:** improve (user-specified goal)
**Health scan:** 0 TS errors (1 pre-existing in AccountSettings.tsx), 0 lint errors, 675/675 tests
**Selected goal:** i18n Translation Infrastructure — tooling, patterns, and enforcement
**Source:** user-specified after deep 5-agent parallel analysis
**Confidence at selection:** high
**Quality score:** 93/100
**User verdict:** TBD

**Why this goal was selected:**
User requested comprehensive i18n analysis — 5 parallel research agents scanned the codebase and found ~4,750+ translatable strings across 5 layers (UI components, constants, lib registries, Rust backend, i18n system). Only 1,502 (32%) were in the i18n system. The user chose Phase 1 infrastructure (tooling + patterns) over immediate component migration, with Option A (token-based) for Rust backend i18n.

**Lessons for future ranking:**
- Infrastructure-first is correct for systemic problems — tooling compounds into every future migration run
- Deep analysis before goal definition produces much better-scoped goals than jumping straight to implementation
- The 5-layer model (UI components / constants / lib registries / Rust backend / i18n system) is the right taxonomy for i18n analysis
- Option A (machine tokens in DB/IPC, frontend resolves) is confirmed as the right architecture — Rust stays language-agnostic, new tokens just need a frontend mapping entry

## Run #4 — 2026-04-11

**Mode:** improve
**Health scan:** 0 TS errors, 0 lint, 675/675 tests
**Selected goal:** BYOM: Surface Custom Models + validate local model viability with Ollama/Gemma4
**Source:** scan (devOnly discovery from Run #1 lesson) + user request for empirical testing
**Confidence at selection:** medium (feature surface was high confidence; model viability was unknown)
**Quality score:** 85/100 (code change minimal, bulk of value is the empirical findings)
**User verdict:** TBD

**Why this goal was selected:**
Run #1 lesson said "check devOnly items for promotion." The devOnly scan found BYOM (Custom Models) as the most complete hidden feature (1,277 LOC, 6 components, 5 tabs). User accepted but redirected the goal from pure surfacing to include empirical validation: "download Gemma 4, test whether local models actually work."

**Key empirical findings:**
1. Claude Code CLI does NOT support non-Anthropic models (validates model name against Anthropic's list)
2. Codex CLI DOES support OpenAI-compatible endpoints (Ollama works via OPENAI_BASE_URL)
3. Local models (qwen3.5 9.7B, gemma4 12B) are viable for: structured JSON, code review, multi-tool, planning, email
4. Local models are NOT viable for: complex code changes, architectural reasoning, interactive speed (gemma4: up to 43s)
5. qwen3.5 is more consistent (7-13s) than gemma4 (6-43s)

**Lessons for future ranking:**
- "Surface hidden feature" pattern from Run #1 validated again — but user challenged the assumption that "built = works". Testing viability is critical for features that depend on external integrations
- The BYOM → Ollama path requires engine=codex_cli, not claude_code. This architectural constraint limits which personas can use local models
- Local models are viable for SECONDARY tasks (review, planning, notifications) but not PRIMARY execution (code generation, complex reasoning). BYOM should be positioned as "cost optimization for simple tasks" not "run everything locally"
- Future BYOM work should focus on the Codex CLI path and make the engine/provider distinction clearer in the UI

## Run #6 — 2026-04-11

**Mode:** improve (autonomous)
**Health scan:** 0 TS errors, 0 lint, 675/675 tests, 17 TODOs, largest file 1294 LOC
**Selected goal:** Agent Performance Leaderboard
**Source:** competitive research (no competitor has fleet-wide agent ranking as a feature)
**Confidence at selection:** medium (novel feature, no precedent in codebase)
**Quality score:** 100/100
**User verdict:** accepted (chose this over surfacing devOnly features and onboarding enhancement)

**Why this goal was selected:**
The autonomous backlog generated 3 candidates: (1) Surface hidden Event Bus features (Chain Studio, Dead Letter, Cloud Webhooks, Marketplace — all devOnly), (2) Agent Performance Leaderboard (novel), (3) Onboarding Enhancement. The user explicitly chose #2, rejecting the proven "surface hidden features" pattern in favor of a novel feature. This signals preference for new capabilities over polishing existing ones.

**Key implementation decisions:**
1. Composite score uses PersonaHealthSignal data (already computed by health pipeline) — zero new API calls
2. Scoring: Success 30% + Health 20% + Speed 20% + Cost 20% + Activity 10%
3. SVG radar chart is pure SVG (no Recharts dependency) — keeps bundle size small for a single chart
4. Fleet-average normalization for speed/cost — fair comparison regardless of absolute scale

**Lessons for future ranking:**
- Users may prefer NOVEL features over surfacing hidden ones — "surface devOnly" is a proven high-confidence pattern but doesn't excite as much after Run #1 already did it
- The PersonaHealthSignal type is a goldmine for data-driven features — it aggregates execution stats, cost data, health scores, and failure predictions per persona. Any future analytics feature should build on this data
- Pure SVG charts work well for single visualizations — avoid pulling in Recharts for one chart component
- The leaderboard is a natural cross-sell for the health dashboard — users who care about health scores will want rankings
