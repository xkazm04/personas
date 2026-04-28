# Dev Experience Engineer Scan — personas, 2026-04-27

> Per-context developer-experience audit across the personas codebase (Tauri 2 desktop, React 19 + TypeScript + Zustand + Vite frontend). Scope: client-side only — `src-tauri/` excluded.
> 17 parallel subagent runs, batched in waves of ≤8.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 17 contexts | **17** | **74** | **75** | **29** | **195** |
| Share | 8.7% | 37.9% | 38.5% | 14.9% | 100% |

Verification: header sum (`> Total: <N> ...`) = 195. Bullet sum (`- **Severity**:`) = 195. Both methods agree.

---

## Per-context breakdown

Sorted by criticals desc, then by total.

| # | Context | C | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Agent Chat & Tool Runner | 2 | 4 | 4 | 2 | 12 | `agent-chat-tool-runner.md` |
| 2 | Overview Dashboard | 2 | 4 | 4 | 1 | 11 | `overview-dashboard.md` |
| 3 | Persona Templates Catalog | 2 | 4 | 3 | 2 | 11 | `persona-templates.md` |
| 4 | Settings | 2 | 4 | 4 | 1 | 11 | `settings.md` |
| 5 | Agent Tools, Connectors & Use Cases | 1 | 5 | 5 | 2 | 13 | `agent-tools-connectors.md` |
| 6 | Agent Lab & Matrix Builder | 1 | 6 | 5 | 1 | 13 | `agent-lab-matrix.md` |
| 7 | Onboarding & Home | 1 | 5 | 5 | 2 | 13 | `onboarding-home.md` |
| 8 | Recipes & Pipelines | 1 | 5 | 5 | 2 | 13 | `recipes-pipelines.md` |
| 9 | Agent Editor & Configuration | 1 | 5 | 4 | 2 | 12 | `agent-editor-config.md` |
| 10 | Credentials & Keys | 1 | 4 | 5 | 2 | 12 | `credentials-keys.md` |
| 11 | Deployment, Sharing & Plugins | 1 | 5 | 4 | 1 | 11 | `deployment-sharing-plugins.md` |
| 12 | Triggers & Schedules | 1 | 4 | 4 | 2 | 11 | `triggers-schedules.md` |
| 13 | Vault Data Sources & Dependencies | 1 | 3 | 4 | 2 | 10 | `vault-data-sources.md` |
| 14 | External Integrations (client) | 0 | 5 | 6 | 2 | 13 | `external-integrations.md` |
| 15 | Health, Validation & Network | 0 | 4 | 5 | 2 | 11 | `health-validation-network.md` |
| 16 | Connector Catalog | 0 | 3 | 4 | 2 | 9 | `connector-catalog.md` |
| 17 | Execution Engine (client) | 0 | 4 | 4 | 1 | 9 | `execution-engine.md` |

---

## All 17 critical findings — one-line summary

Sorted into themes for triage. Each item links to its full entry in the per-context report.

### A. Dead trees & duplicate-with-drift implementations (9)

1. **Agent Tools — Delete dead `sub_tools/useToolSelectorState.ts` + `useToolImpactData.ts` shims (423 LOC orphan duplicates with diverged co-occurrence algorithm)** — `agent-tools-connectors.md` finding #1.
2. **Agent Chat — `sub_executions/` ships parallel `replay/`+`detail/` and `components/replay/`+`components/list/` trees; the same `ReplaySandbox.tsx`, `PipelineWaterfall.tsx`, `ExecutionDetail.tsx` exist twice and have diverged. `index.ts` and direct imports point at different copies.** — `agent-chat-tool-runner.md` finding #1.
3. **Agent Chat — Three replay viewers (`ReplaySandbox`, `ReplayTheater`, `DreamReplayTheater`) each duplicate keyboard-shortcut + fork-builder logic with subtle inconsistencies (e.g. `Shift+ArrowLeft` maps differently in each).** — `agent-chat-tool-runner.md` finding #2.
4. **Agent Editor — Zombie duplicate `sub_settings/PersonaSettingsTab.tsx` shadows the live `components/` version; barrel exports the live one but the audit context referenced the dead one. Same drift pattern in `sub_model_config/credentials/`.** — `agent-editor-config.md` finding #1.
5. **Settings — Stale duplicate `<Foo>Settings.tsx` files at root of `sub_account`, `sub_admin`, `sub_notifications` alongside live `components/<Same>.tsx` siblings (race-fix lives in only one copy).** — `settings.md` finding #1.
6. **Settings — `useSettingsTranslation` hook + 14 locale files are dead code; all 27 panels use the global `useTranslation` instead.** — `settings.md` finding #2.
7. **Onboarding & Home — Two parallel i18n systems coexist; `src/features/{onboarding,home}/i18n/` ship 28 stale TS locale files that silently no-op when edited (deprecated "Phase 2" cleanup never happened).** — `onboarding-home.md` finding #1.
8. **Overview Dashboard — Three parallel dead module trees (`sub_executions`, `sub_timeline`, top-level `sub_realtime/*` flats + orphan widgets/cards) ship in the bundle and steer greps wrong.** — `overview-dashboard.md` finding #1.
9. **Overview Dashboard — Five separate "stat tile" implementations re-derive the same `icon + label + value + color` pattern instead of sharing one primitive.** — `overview-dashboard.md` finding #2.

### B. Zero tests on high-blast-radius surfaces (3)

10. **Credentials — Zero UI tests for `FieldActionButtons` (clipboard auto-wipe TTL, eye-toggle, secret copy) — the highest-blast-radius client component has no co-located test; only one API-mock test exists for the whole credentials domain.** — `credentials-keys.md` finding #1.
11. **Recipes & Pipelines — Zero tests across ~3,100 LOC of complex graph topology, optimistic CRUD with team-switch staleness guards, run-id correlation, and version history (defensive comments admit the existing bugs they prevent).** — `recipes-pipelines.md` finding #1.
12. **Deployment / Sharing / Plugins / Composition — Zero tests across all four feature folders despite high-leverage pure logic (DAG cycle detection, sort comparators, generation-counter health monitor, phase machine, readiness derivation).** — `deployment-sharing-plugins.md` finding #1.

### C. Type drift / runtime safety (4)

13. **Persona Templates — `TemplateCatalogEntry.payload` typed as `AgentIR` but the JSON files are a different v3 shape; consumers cast `as unknown as Record<string, unknown>` to access `payload.persona.goal`, `use_cases[]`, `adoption_questions[]` with zero compiler help.** — `persona-templates.md` finding #1.
14. **Persona Templates — No runtime schema validation for template JSON; only checksum + dup-id, so malformed/renamed JSON fields silently render empty cards that fail 4 clicks deep.** — `persona-templates.md` finding #2.
15. **Triggers & Schedules — `ScheduleTimeline` uses raw `listen<{ recovered, timestamp }>` for `OVERDUE_TRIGGERS_FIRED` but the registry payload is `{ trigger_ids: string[] }` — real type drift between client and registry, only consumer in client.** — `triggers-schedules.md` finding #1.
16. **Vault Data Sources — `escapeSqlStringLiteral` regex `[ -]` is the ASCII range space-to-hyphen and still strips every char it claims to preserve (`'users-prod'` still becomes `'usersprod'`); the comment celebrates a fix that never happened.** — `vault-data-sources.md` finding #1.

### D. Mega-monolith with mirrored state (1)

17. **Agent Lab — `matrixBuildSlice.ts` is a 1,303-LOC monolith maintaining ~30 fields mirrored in two places; every new BuildEvent variant requires 7 coordinated edits with no compile-time exhaustiveness check.** — `agent-lab-matrix.md` finding #1.

---

## Triage themes

Detected by clustering finding categories + descriptions across all 195 findings (criticals + highs + mediums + lows).

| # | Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---|---:|---|
| 1 | **Dead trees & drifted duplicates** | ~30 | Pure-deletion changes compound: removing 5 dead `<Foo>Settings.tsx` files, dual i18n trees, parallel `sub_executions` viewers, 5 stat-tile impls. One mental model ("verify orphan, delete, run barrel"), one PR per cluster. |
| 2 | **Zero tests on critical surfaces** | ~20 | Test-infra / first-test-in-folder work shares scaffolding (vitest config, mocks, helpers). Concentrated wave amortizes the setup; spread out = repeat 5×. |
| 3 | **Type drift & ts-rs codegen** | ~15 | Five distinct drift cases (Twin snake/camel, OVERDUE_TRIGGERS_FIRED, AgentIR template cast, escapeSqlStringLiteral regex, connector.metadata `any` 9× ) all benefit from a single "type-safe IPC bindings" pass plus runtime Zod adoption. |
| 4 | **Shared primitives extraction** | ~25 | StatTile, copy-to-clipboard hook, drag-handle utility, replay-keyboard hook, filter pipeline factory, three `mapOverallStatus` helpers — extracting one means writing the primitive once and replacing N call-sites. |
| 5 | **i18n unification** | ~10 | 28 stale onboarding/home files + dead `useSettingsTranslation` + scattered hard-coded SPAN_CONFIG strings + dead Twin/dev-tools/lifecycle locale hooks form one clean wave. |
| 6 | **Race-condition / async-cleanup consolidation** | ~10 | 3 hand-rolled persona-switch race guards in editor + team-switch staleness in recipe slice + network failure-counter convention + chat streaming watchdog inline — one shared `useRequestRace` / `useStaleTokenGuard` hook unifies these. |
| 7 | **Mega-file decomposition + missing docs** | ~15 | matrixBuildSlice 1.3k LOC, DesignTab 32→45-prop pipe, untyped `connector.metadata` (no schema or doc), missing barrel/README in execution and plugins, undocumented OnboardingOverlay state machine — same pattern (scope a hot file, extract, document) so one wave keeps the head warm. |
| 8 | **Convention-drift papercuts** | ~25 | useShallow deviations, `defaultValue` vs controlled inputs, magic timeouts (100/150/300/500/5000ms), string-typed step ids, masked GitLab error states — small individually but compound to onboarding tax. Best ridden as a final cleanup wave. |
| 9 | **Build/dev-loop tooling improvements** | ~10 | Generate-template-checksums script, dead-code linter rule, ts-rs codegen for 6 integration modules, vitest baseline broken at startup (pre-existing, but worth a fix), README/AGENTS.md additions for dense modules. |

Counts overlap across categories (a finding can be both "convention drift" and "dead trees").

---

## Suggested next-phase split

Six waves that each share one mental model. Wave 1 is the highest-payoff entry point (deletion-driven, no behavior change, immediate clarity).

### Wave 1 — Dead trees & duplicates (recommended first)

**Goal:** delete or unify all dead/duplicate code surfaced by Theme 1.
**Targets (5–7 fixes):** Pick the criticals + supporting highs from this theme. Suggested cuts:
- Delete `sub_tools/useToolSelectorState.ts` + `useToolImpactData.ts` orphan shims (423 LOC).
- Resolve `sub_executions` duplicate `replay/` + `detail/` trees: keep the live copies, delete the diverged shadows.
- Delete `sub_settings/PersonaSettingsTab.tsx` zombie + `sub_model_config/credentials/` dead files.
- Delete root-level `<Foo>Settings.tsx` duplicates in `sub_account`, `sub_admin`, `sub_notifications`.
- Delete `useSettingsTranslation` + dead Settings locale files (14 files).
- Delete onboarding/home parallel i18n trees (28 files).
- Delete Overview `sub_executions` / `sub_timeline` / orphan widgets.

**Why first:** zero behavior change, biggest clarity payoff per LOC removed, and breaking all the broken greps is the prerequisite for every later wave to work cleanly. Build verification is fast (tsc + barrel re-exports).

### Wave 2 — Test infra + first tests on critical surfaces

**Goal:** add the first co-located test in each high-blast-radius zero-test folder. Concentrated so vitest config + mock helpers are written once.
**Targets (5–7 fixes):**
- Co-locate tests for `FieldActionButtons` (clipboard TTL, eye-toggle, copy).
- First tests for `teamSlice.addTeamMember` optimistic path, `useRecipeTestRunner` run-id guard, `buildTeamGraph` cycle detection.
- First tests for `dagUtils` cycle detection in composition + the deployment phase machine.
- First tests for `useHealthCheck` + `computeHealthScore` + `classifyIssueCategory`.
- First tests for any of the integration wrappers (drive/ocr/signing/twin) — pick the one with most consumers.

### Wave 3 — Type drift & runtime schema validation

**Goal:** close the four type-drift criticals + re-type the consequential undocumented shapes.
**Targets (4–6 fixes):**
- Fix `escapeSqlStringLiteral` regex bug (vault-data-sources #1).
- Replace `ScheduleTimeline` raw `listen` with `typedListen` + actual payload type (triggers-schedules #1).
- Replace `TemplateCatalogEntry.payload: AgentIR` with the actual `TemplateV3Payload` type; remove the unsound casts (persona-templates #1).
- Add Zod schema validation in `templateCatalog.ts` loader (persona-templates #2).
- Add `ConnectorMetadata` TypeScript shape + replace 9 ad-hoc parses (connector-catalog top high).
- Generate ts-rs bindings for the 6 of 7 integration modules currently hand-typed (external-integrations #2).

### Wave 4 — Shared primitives extraction

**Goal:** stop re-deriving the same UI atom 3–5 times per feature.
**Targets (5–7 fixes):**
- One shared `StatTile` primitive replacing 5 overview impls.
- One shared `useReplayKeyboardShortcuts` + `useForkInputBuilder` for the 3 replay viewers.
- One shared `useCopyToClipboard` (already exists but underused) + replace duplicates in execution + chat + credentials.
- One shared `mapOverallStatus`/`inferSeverity` helper eliminating 3-place duplication in health.
- One shared `usePickerFilters` factory for connector picker (4 near-duplicate filter pipelines).

### Wave 5 — Race-condition consolidation

**Goal:** unify the 6+ hand-rolled persona-switch / staleness guards into one hook.
**Targets (3–5 fixes):** Build `useRequestRace` / `useStaleTokenGuard` and replace inline guards in agent-editor (3 places), recipe slice team-switch staleness, chat streaming watchdog, network failure-counter.

### Wave 6 — Mega-monolith decomposition + docs

**Goal:** split the 1.3k matrixBuildSlice and document the densest modules.
**Targets (3–5 fixes):** matrixBuildSlice split into focused sub-slices with exhaustive-check union; DesignTab prop-drill collapse via context; README/AGENTS.md for `features/execution`, `features/plugins`, `OnboardingOverlay`; document `ConnectorDefinition.metadata` schema.

Convention-drift papercuts (Theme 8) and build-tooling (Theme 9) can be folded into whichever later wave has cycles, or saved as a "Wave 7 cleanup".

---

## How this scan was run

- **Scanner prompt:** `agent_dev_experience_engineer` (`src/lib/prompts/registry/agents/dev-experience-engineer.ts`, version 1.0.0).
- **Date:** 2026-04-27.
- **Project:** personas (`C:\Users\kazda\kiro\personas`), branch `master`.
- **Scope:** all 17 project contexts from `GET /api/contexts?projectId=<personas>`. **Side filter: client-side only** — `src-tauri/` paths excluded from each context's `filePaths` before hand-off.
- **Method:** parallel orchestration in two waves of 8 + 9 `general-purpose` subagents. Each subagent received the role prompt + filtered context paths + a 6–15 findings target + the structured-markdown output format. Subagent replies were ≤150 words; full reports were written directly to disk by the subagent.
- **File-read counts (approximate, summed across replies):** Wave 1 ≈ 175 client files. Wave 2 ≈ 245 client files. **Total ≈ 420 client files read across the scan.**
- **Verification:** findings counted two ways — `^> Total:` headers (sum = 195) and `^- \*\*Severity\*\*:` bullets (sum = 195). Both methods agree, no malformed reports.
- **Baseline health (Phase B2):** `tsc --noEmit` = 0 errors. `vitest run` = startup error (pre-existing plugin failure in vitest server init; **not from this scan**). Lint baseline deferred to wave-time. Regression check during fix waves will be tsc-only.
- **Output directory:** `docs/harness/dev-experience-2026-04-27/` (alongside prior `bug-hunt-2026-04-27/` and `ambiguity-2026-04-27/` indexes).
