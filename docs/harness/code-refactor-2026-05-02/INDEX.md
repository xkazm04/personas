# Code Refactor Scan — personas, 2026-05-02

> Code-cleanliness audit across the personas TS/TSX surface. The scan looked for dead code, duplication, structural drift, leftover cleanup, and naming inconsistencies — `src-tauri/` Rust intentionally descoped.
> 17 parallel subagent runs, batched in waves of 8/8/1. ~570 files read.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 17 contexts | — | 38 | 75 | 37 | **150** |
| Share | — | 25.3% | 50.0% | 24.7% | 100% |

> Note: This scan uses 3-tier severity (high/medium/low). "Critical" is folded into "high" — there is no separate critical tier in the per-context reports.

---

## Per-context breakdown

(Sorted by `high` desc, then by total desc)

| # | Context | High | Medium | Low | Total | Report |
|---:|---|---:|---:|---:|---:|---|
| 1 | Agent Tools, Connectors & Use Cases | 4 | 3 | 2 | 9 | [agent-tools-connectors.md](agent-tools-connectors.md) |
| 2 | Agent Chat & Tool Runner | 4 | 3 | 2 | 9 | [agent-chat-tool-runner.md](agent-chat-tool-runner.md) |
| 3 | Credentials & Keys | 4 | 3 | 2 | 9 | [credentials-keys.md](credentials-keys.md) |
| 4 | Health, Validation & Network | 4 | 4 | 1 | 9 | [health-validation-network.md](health-validation-network.md) |
| 5 | Agent Lab & Matrix Builder | 3 | 4 | 2 | 9 | [agent-lab-matrix.md](agent-lab-matrix.md) |
| 6 | Overview Dashboard | 3 | 7 | 0 | 10 | [overview-dashboard.md](overview-dashboard.md) |
| 7 | Onboarding & Home | 3 | 5 | 1 | 9 | [onboarding-home.md](onboarding-home.md) |
| 8 | Agent Editor & Configuration | 2 | 3 | 3 | 8 | [agent-editor-config.md](agent-editor-config.md) |
| 9 | Connector Catalog | 2 | 4 | 3 | 9 | [connector-catalog.md](connector-catalog.md) |
| 10 | Execution Engine | 2 | 4 | 2 | 8 | [execution-engine.md](execution-engine.md) |
| 11 | Recipes & Pipelines | 2 | 5 | 2 | 9 | [recipes-pipelines.md](recipes-pipelines.md) |
| 12 | External Integrations | 2 | 5 | 2 | 9 | [external-integrations.md](external-integrations.md) |
| 13 | Vault Data Sources & Dependencies | 1 | 5 | 3 | 9 | [vault-data-sources.md](vault-data-sources.md) |
| 14 | Triggers & Schedules | 1 | 5 | 2 | 8 | [triggers-schedules.md](triggers-schedules.md) |
| 15 | Deployment, Sharing & Plugins | 1 | 5 | 3 | 9 | [deployment-sharing-plugins.md](deployment-sharing-plugins.md) |
| 16 | Persona Templates Catalog | 0 | 5 | 4 | 9 | [persona-templates.md](persona-templates.md) |
| 17 | Settings | 0 | 5 | 3 | 8 | [settings.md](settings.md) |

---

## All 38 high-severity findings — one-line summaries

Sorted into themes. Each item links to its full entry in the per-context report (anchor as `<report-slug>.md`; reader can locate by `## N.` heading).

### A. Orphan-feature islands — large dead component subtrees superseded by a newer implementation

The single largest pattern: ~12 high-severity findings describe entire subtrees (folders, multi-file features, page components) that survived a feature retirement or refactor. They appear live because their internal cross-references self-satisfy "go to definition" but no external consumer reaches them.

1. **Agent Tools, Connectors & Use Cases — Entire `sub_tools/` UI tree dead** — `ToolSelector` plus 14 dependencies (~1.4k LOC) survived "Tools" tab being folded into connectors flow; only its own internal imports reach it. [`agent-tools-connectors.md` #1]
2. **Agent Tools, Connectors & Use Cases — `EventSubscriptionSettings` and `UseCaseSubscriptionsSection` dead** — `PersonaConnectorsTab.tsx:10` even has the comment "// UseCaseSubscriptionsSection removed", but ~210 LOC of UI plus a `validateSourceFilter` regex set still ship. [`agent-tools-connectors.md` #3]
3. **Agent Tools, Connectors & Use Cases — `UseCaseActiveItems.tsx` and `UseCaseTabHeader.tsx` dead** — ~250 LOC including `UseCaseActiveTriggers`/`UseCaseActiveSubscriptions`/`UseCaseGeneralHistory` exports unused; misleading filenames. [`agent-tools-connectors.md` #4]
4. **Agent Lab & Matrix Builder — `BuildReviewPanel` is dead** — 148-line review-panel component with `CountBadge`/`DimensionChip` helpers; superseded by `GlyphTestCompleteCore` and `MatrixCommandCenterParts` review surfaces. [`agent-lab-matrix.md` #1]
5. **Agent Lab & Matrix Builder — `src/features/composition/` is fully dead module** — `topologicalSort`, `validateWorkflow`, `getUpstream`, `getDownstream` exports with zero importers; harness defines its own `topologicalSort` privately. [`agent-lab-matrix.md` #3]
6. **Agent Chat & Tool Runner — Entire `detail/views/Execution*` subgraph dead** — `ExecutionList.tsx`, `ExecutionRow.tsx`, `ExecutionListHeader.tsx`, `ExecutionExpandedDetail.tsx`, `useExecutionListState.ts`, `CostSparkline.tsx` orphaned; live `ExecutionList` is at `components/list/`. [`agent-chat-tool-runner.md` #3]
7. **Credentials & Keys — Entire provisioning wizard is dead** — `components/wizard/` (7 files) + `provisioningWizardStore.ts`; the sidebar "AI setup wizard" button silently opens nothing. `useCredentialManagerState.ts:65-70` "// Wizard was removed" effect permanently fights a ghost. [`credentials-keys.md` #1]
8. **Credentials & Keys — Entire OpenAPI autopilot flow is dead** — `components/autopilot/` (10 files) + `api/vault/openapiAutopilot.ts`; `AutopilotPanel.tsx` exported but no route, sidebar entry, FSM view, or modal launches it. [`credentials-keys.md` #2]
9. **Credentials & Keys — `CredentialCard` expandable-row chain superseded** — 13 files including `CredentialCard.tsx`, `CredentialCardBody.tsx`, badges, `OAuthTokenMetricsPanel.tsx`, `CredentialAuditTimeline.tsx`, `auditAnomalies.ts` — replaced by `DataGrid` + `CredentialDetailModals` but never deleted. [`credentials-keys.md` #3]
10. **Credentials & Keys — Manager-level health UI exported but never rendered** — `HealthStatusBar.tsx`, `BulkHealthcheckSummary.tsx`, `CredentialFilterBar.tsx` orphaned next to actively-used siblings. [`credentials-keys.md` #4]
11. **Connector Catalog — Universal AutoCred subgraph dead (~600 LOC, 5 files)** — `UniversalAutoCredPanel`, `UniversalAutoCredInputPhase`, `UniversalAutoCredRunningPhase`, `UniversalAutoCredReview`, `universalAutoCredHelpers` plus `UniversalFieldRow` in `ReviewTable.tsx`. [`connector-catalog.md` #1]
12. **Connector Catalog — `SetupGuideModal` unreferenced (193 LOC)** — superseded by inline `SetupGuideSection` from `sub_credentials`; `types.ts:176` comment still misleadingly references it. [`connector-catalog.md` #2]
13. **Execution Engine — `PreRunPreview` component + companion hook unreferenced** — 175 LOC + `usePreRunCheck.ts` orphaned; CHANGELOG #31 implies feature ships, three prior harness scans flag bugs in unreachable code. [`execution-engine.md` #1]
14. **Triggers & Schedules — Dead React-Flow event-canvas subgraph (~20 files, ~1500 LOC)** — entire `sub_builder/` minus `EventCanvas.tsx`/`layouts/`/`eventCanvasConstants.ts` orphaned after migration to row-based RoutingView. [`triggers-schedules.md` #1]
15. **Overview Dashboard — Abandoned `sub_usage/charts/` shadows live `components/`+`libs/`** — 5 files including `MetricChart.tsx` plus `pivotToolUsage.ts` whose comment claims "deliberate" no-zero-fill that was actually the bug the live version fixed. [`overview-dashboard.md` #1]
16. **Overview Dashboard — `sub_memories/hooks/` is stale duplicate of `sub_memories/libs/`** — 4 files; dead `hooks/memoryActions.ts` is 5-line lossy copy while live `libs/` has corruption-recovery, `_sessionBackup`, Sentry routing. [`overview-dashboard.md` #2]
17. **Overview Dashboard — Top-level `CronAgentsPage.tsx` shadows maintained `components/CronAgentsPage.tsx`** — 191-line dead copy lacks `seedMockCronAgent` dev button + `useCallback` memoisation; re-defines `formatInterval` inline. [`overview-dashboard.md` #3]
18. **Onboarding & Home — `IconShowcase` + `CustomIcons` + `iconData` + `iconStyles` orphan icon island (~360 LOC)** — closed cycle of 4 files; `NavigationGrid` cards use `SIDEBAR_ICONS` from shared module. Flagged 2026-04-27 dev-experience scan, not removed. [`onboarding-home.md` #1]
19. **Onboarding & Home — `OnboardingProgressBar` dead (90 LOC)** — fully implemented step checklist with animated bar; never rendered (modal owns step UI directly). [`onboarding-home.md` #2]
20. **Recipes & Pipelines — `handleUpdateNote`/`handleDeleteNote` dead in `useCanvasHandlers`** — extracted into hook + returned, but `TeamCanvas.tsx` still uses re-implemented inline copies; hook versions never consumed. [`recipes-pipelines.md` #4]
21. **Health, Validation & Network — `src/api/validation.ts` entirely dead — flagged 2× before** — `getValidationRules()` and `validatePersonaContracts()` zero callers; ts-rs bindings `ContractReport`/`ValidationRule` ship for dead consumers. [`health-validation-network.md` #1]
22. **Health, Validation & Network — `sub_health/HealthTab.tsx` orphan still here — flagged 3× in prior scans** — orphan (25 LOC) vs live `components/HealthTab.tsx` (46 LOC); fuzzy-find returns both with equal probability. [`health-validation-network.md` #2]
23. **Deployment, Sharing & Plugins — `src/features/composition/` fully orphaned** — same module also flagged in agent-lab-matrix; `topologicalSort`/`validateWorkflow` exports with zero importers across the app. [`deployment-sharing-plugins.md` #1]

### B. Diverged near-copies — two parallel implementations that have already drifted

Two implementations of the same feature where one has already gained behaviour the other lacks (security fix, i18n, additional logic). Editing either by name alone risks landing the change on the wrong one.

24. **Agent Tools, Connectors & Use Cases — Two `HealthTab.tsx` files in `sub_health/`** — orphan + live, drifted: live adds stale-data auto-refresh `useEffect`, orphan does not. Same item as health-validation #22 above (cross-listed by both contexts). [`agent-tools-connectors.md` #2]
25. **Agent Chat & Tool Runner — Two parallel `ExecutionDetail` implementations from different entry points** — modal uses `detail/ExecutionDetail.tsx` (50-line decomposed); index re-export goes through `components/list/` → `components/detail/DetailSteps.tsx` (175-line monolith); same execution renders differently from different surfaces. [`agent-chat-tool-runner.md` #1]
26. **Agent Chat & Tool Runner — Two parallel `replay/` and `components/replay/` trees with diverging behaviour** — `PipelineWaterfall` synthetic-trace fallback differs; `TraceInspector` live-merge logic in one but not other. [`agent-chat-tool-runner.md` #2]
27. **Agent Chat & Tool Runner — `runnerHelpers.ts` and `runnerTypes.tsx` define same things twice with i18n drift** — `PHASE_META` in one has `labelKey: string`, other has hardcoded English `label`; `RunnerStreamView` not translated, `HealingCard` is. [`agent-chat-tool-runner.md` #4]
28. **Agent Editor & Configuration — Five-file dead duplication of model A/B compare** — root-level `ModelABCompare.tsx`, `ComparisonResults.tsx`, `CompareMetricCards.tsx`, `CompareOutputPreviews.tsx`, `compareModels.ts` (~600 LOC) shadow `components/compare/`. [`agent-editor-config.md` #1]
29. **Agent Editor & Configuration — Dead `ModelABCompare.tsx` is the SAFER version — exported copy is older/inferior** — dead root copy has persona-switch reset effect (cross-persona prompt leak fix), `aggregateResultsDetailed`/`missingModels` warning, `capturePersonaToken` guard; live copy lacks all three. Real correctness issue. [`agent-editor-config.md` #2]
30. **Health, Validation & Network — `mapOverallStatus` and feasibility-parsing duplicated between hook and slice — drift already happened** — issue IDs differ (FNV vs `digest_${ts}_${seq}`), proposals only run in hook, slice has `[object Object]` risk on non-string IPC entries. [`health-validation-network.md` #4]
31. **Recipes & Pipelines — `parseInputSchema` defined twice with the same name** — playground has richer `InputField` with `default`/`options`; shared has simpler `InputSchemaField`; both consume `recipe.input_schema`. [`recipes-pipelines.md` #1]

### C. Dead API exports / dead public surface — exported wrappers no caller imports

Functions or types exported from `api/` modules (or barrels) with zero consumers. They imply features that aren't wired and inflate the IPC surface area.

32. **Health, Validation & Network — Nine network/identity/exposure API exports never called** — `getConnectionStatus`, `setNetworkConfig`, `sendAgentMessage`, `getReceivedMessages`, `getExposedResource`, `updateExposedResource`, `getExposureManifest`, `getResourceProvenance`, `updateTrustedPeer`, `verifyBundle`, `resolveShareDeepLink` plus the orphan `networkSlice.updateExposedResource` action. [`health-validation-network.md` #3]
33. **External Integrations — Dead OCR API surface left after OCR plugin retired** — `ocrWithGemini`, `ocrWithClaude`, `listOcrDocuments`, `deleteOcrDocument` zero callers; only `cancelOcrOperation` still used after consolidation into `drive.ts`. Advertises a less-secure absolute-path code path. [`external-integrations.md` #1]

### D. Reachability bombs — code paths protected by an always-false guard

Live code that is "fighting" a ghost: a guard, a default, or a defensive effect that only matters because dead surface code keeps gesturing at it.

34. **Vault Data Sources & Dependencies — Revocation simulator's workflow analysis dead — always called with `[]`** — `simulateRevocation(workflows: Workflow[])` always passed `[]`, so `'critical'` severity branch, `AffectedWorkflows` panel, and `mitigation_pause` rule cannot fire; 4 sim_critical/workflows_*/mitigation_pause translation strings never display. [`vault-data-sources.md` #1]

### E. Cross-module duplication — same logic twice with one copy already buggy

Helpers copied between modules where the bug fix landed only in one copy, or where convergent behaviour grew up independently and now diverges in user-visible ways.

35. **External Integrations — Duplicated `safeInvoke` helper has already drifted between modules** — `researchLab.ts` carries 20-line comment + strict regex `isCommandNotFound`; `devTools.ts` still uses old broken `msg.includes("not found")` substring check that swallows real errors. Real bug: a `dev_tools_*` "context not found" error today is silently coerced into fallback. [`external-integrations.md` #2]

### F. Half-shipped feature seams — stub/enricher hooks with no consumer

Code that looks wired but isn't — typically the producer side of a feedback loop without the consumer.

36. **Agent Lab & Matrix Builder — `extractBuildHints` / `buildSessionEnricher.ts` unreachable** — exports `BuildHints` and `extractBuildHints(testMetadata)` with no project-wide reference; docstring claims data flows into PersonaMatrix but no caller exists. Misleads anyone debugging "why isn't lab feedback influencing builds?". [`agent-lab-matrix.md` #2]

### G. Three-way decorative drift — UI primitives copy-pasted across same flow

A widget rendered three times across closely-related screens with already-visible visual divergence (sizing, test-ids, source-of-truth for tokens).

37. **Onboarding & Home — Three-way duplication of theme/text-scale/brightness picker** — `AppearanceStep.tsx`, `TourAppearanceContent.tsx`, `AppearanceSettings.tsx` copy-paste card markup with drift in icon sizes, gap spacing, test-id coverage, and source-of-truth for `BRIGHTNESS_ICON_OPACITY_BY_INDEX` (one inlines opacity ladder, another reads from store-exported constant). [`onboarding-home.md` #3]

### H. Misc / one-offs

A high-severity finding that doesn't fit a multi-finding theme.

38. **Execution Engine — `ExecutionMiniPlayer` subscribes to same execution stream twice** — `useReasoningTrace(activeExecutionId)` + `useExecutionSummary(...)` called in parent, then `<SimpleExecutionView>` calls them again with the same id; two Tauri event listeners, two parallel 500-entry arrays, two re-render trees per event. Correctness smell on entry divergence. [`execution-engine.md` #2]

---

## Triage themes (full set including non-critical patterns)

Detect themes across ALL 150 findings — high, medium, and low — by clustering on category + title similarity. This expands beyond the high-only clustering above.

| Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---:|---|
| Orphan-feature islands (whole subtrees, page components, modal flows) | ~25 | One mental model: "find the entry point, confirm zero external imports, delete folder, run tsc". Same grep tooling, same verification. |
| Diverged near-copies (one canonical + one drifted) | ~12 | Same mental model: pick canonical, port any improvements from loser, delete loser. Drift makes blind delete unsafe — must read both. |
| Dead helpers / exported functions never called | ~18 | `ts-prune` + manual confirm. Same edit pattern: remove export, drop unused interface. Bulk-deletable. |
| Same primitive duplicated 2-4 times (constants, formatters, regexes) | ~15 | "Extract one canonical, replace N call sites". `TRIGGER_ICONS`, `timeAgo`, `HighlightedJson`, URL-extraction regexes, `extractErrorMessage`, `safeInvoke`, status-color tables. |
| Dead barrel `index.ts` files (callers all use deep paths) | ~10 | Greppable as "barrel exists, no `from '...sub_X'` import without path-suffix". One-shot delete pass. |
| Misnamed files (filename diverges from export) | ~6 | `UseCaseActiveItems.tsx` exports `UseCaseActiveTriggers`; `UseCaseTabHeader.tsx` contains `UseCaseGeneralHistory`; `ExecutionListItem.tsx` exports `CostSparkline`; `importTypes.ts` is mostly parser logic; `statusEmoji` returns plain text. Rename pass. |
| Boundary blur (file lives in wrong namespace) | ~7 | `ToolsSection` in `sub_connectors/`, `NotificationCenter` in `features/gitlab/`, `animationPresets` in `features/templates/`, `api/templates/recipes.ts` etc. Move-and-update-imports pass. |
| Dead/unused props or vestigial signatures | ~6 | `UseCaseDetailPanel` `credentials`/`connectorDefinitions`, `DatabaseListView.onBack`, `CredentialTypePicker.onSelectDesktop`, `dialogRef`/`handleFocusTrap`, `cronPreview` state. Drop-prop-and-update-call-sites pass. |
| English-string leaks in i18n'd files (constants at module scope) | ~5 | `PersonaCreationCoach`, `SetupCards`, `CELL_FRIENDLY_NAMES`, plugin-browse `research-lab`/`twin` labels, `quickSetup`/`moderateSetup` keys never read. Move static metadata into `t.*` keys. |
| Hardcoded magic numbers / constants that exist but aren't imported | ~4 | `MIN/MAX_PERSONA_TIMEOUT_MS` exists but `PersonaSettingsTab` hardcodes 10/1800; `EVENT_BRIDGE_TIMING` doc-by-constant for values used elsewhere; `STEP_ORDER` duplicated literal. |
| Logger / console.warn drift from canonical pattern | ~3 | `console.warn` in advisory dispatch + experiment bridge while siblings use `createLogger(...)`. Convert pass. |

---

## Suggested next-phase split

A 5-7 wave plan organising the findings by theme. Each wave should be **sessionable (5-7 fixes)** and share a mental model so the fixes compound.

### Wave 1 — Delete the obvious orphan islands (≈7 findings)
- **Why this is the right starting wave:** Highest reader-confusion impact. Every one of these is a fully-formed feature that grep returns as a hit but never runs — they corrupt every future audit, every "where does X happen" search, every IDE jump-to-definition. They're also the safest to delete: zero external imports, often a "// X removed" comment already in the live code admitting the dead state. Bulk-deletable in one PR per island.
- **Findings included:**
  - `sub_tools/` UI tree dead (~1.4k LOC, 14 deps) — `agent-tools-connectors.md` #1
  - Provisioning wizard dead (`components/wizard/` 7 files + store) — `credentials-keys.md` #1
  - OpenAPI autopilot dead (`components/autopilot/` 10 files + API) — `credentials-keys.md` #2
  - Universal AutoCred subgraph dead (~600 LOC, 5 files) — `connector-catalog.md` #1
  - React-Flow event-canvas subgraph dead (~1500 LOC, ~20 files) — `triggers-schedules.md` #1
  - `IconShowcase`/`CustomIcons`/`iconData`/`iconStyles` orphan island (~360 LOC) — `onboarding-home.md` #1
  - `src/features/composition/` fully dead (`topologicalSort` etc.) — `agent-lab-matrix.md` #3 / `deployment-sharing-plugins.md` #1
- **Verification:** `tsc --noEmit` clean after each delete; rerun `git grep` for the deleted symbol names to confirm no stragglers; if any test files target the deleted modules (e.g. `__tests__/DatabaseCard.test.tsx`), delete those too.

### Wave 2 — Resolve diverged near-copies (pick canonical, port deltas, delete loser) (≈6 findings)
- **Why this is the right second wave:** These can't be blind-deleted — at least one copy has gained behaviour the other lacks. Each one needs a careful read of both files to merge improvements before deletion. Concentrating them in one wave shares the mental model "diff the two, port deltas, delete loser." One of these (model A/B compare) is a real cross-persona prompt-leak fix sitting in dead code.
- **Findings included:**
  - Two `HealthTab.tsx` files in `sub_health/` — `agent-tools-connectors.md` #2 / `health-validation-network.md` #2 (same item)
  - Two parallel `ExecutionDetail` from different entry points — `agent-chat-tool-runner.md` #1
  - Two parallel `replay/` and `components/replay/` trees — `agent-chat-tool-runner.md` #2
  - `runnerHelpers.ts` vs `runnerTypes.tsx` (i18n drift) — `agent-chat-tool-runner.md` #4
  - Five-file model A/B compare duplication + dead copy is safer — `agent-editor-config.md` #1 + #2
  - `mapOverallStatus` / feasibility parsing hook vs slice (issue-ID drift) — `health-validation-network.md` #4
- **Verification:** For each pair, write down (or comment in commit) what was ported from the loser before delete; tsc clean; run `git grep` against both old paths to ensure no caller still imports the deleted side.

### Wave 3 — Delete dead-component subtrees with internal-only references (≈7 findings)
- **Why this is the right third wave:** Same delete-and-grep pattern as Wave 1 but smaller individual surfaces — typically a handful of files each rather than a whole feature. Fits well after Wave 1 because some Wave 1 deletes (e.g. `sub_tools/`) make these visible (e.g. dead barrel re-exports become obvious).
- **Findings included:**
  - `EventSubscriptionSettings` + `UseCaseSubscriptionsSection` dead — `agent-tools-connectors.md` #3
  - `UseCaseActiveItems.tsx` + `UseCaseTabHeader.tsx` dead with misleading names — `agent-tools-connectors.md` #4
  - `BuildReviewPanel` dead (148 LOC) — `agent-lab-matrix.md` #1
  - `detail/views/Execution*` subgraph dead (6 files) — `agent-chat-tool-runner.md` #3
  - `CredentialCard` expandable-row chain (13 files) — `credentials-keys.md` #3
  - `HealthStatusBar` + `BulkHealthcheckSummary` + `CredentialFilterBar` orphans — `credentials-keys.md` #4
  - `SetupGuideModal` (193 LOC) + stale `types.ts:176` comment — `connector-catalog.md` #2
- **Verification:** tsc clean; check for translation-key cleanup opportunities (e.g. `agents.build_review.*`, dead validateSourceFilter strings); grep `_attic`/`_unused` if team prefers preservation move over delete.

### Wave 4 — Dead API exports + reachability bombs + half-shipped feature seams (≈6 findings)
- **Why this is the right fourth wave:** Same edit pattern (delete export, drop interface), but each item also requires deciding "is this really dead, or is it pending wire-up?" Concentrating them lets the reviewer hold the same mental rubric. Each delete also shrinks the IPC surface (Tauri command list) and the persona tool-dispatch attack surface.
- **Findings included:**
  - 9 network/identity/exposure API exports zero callers — `health-validation-network.md` #3
  - `src/api/validation.ts` entirely dead (flagged 2× before) — `health-validation-network.md` #1
  - Dead OCR API surface (`ocrWithGemini`, `ocrWithClaude`, etc.) — `external-integrations.md` #1
  - Revocation simulator workflow analysis dead (always called with `[]`) — `vault-data-sources.md` #1
  - `extractBuildHints` / `buildSessionEnricher.ts` unreachable — `agent-lab-matrix.md` #2
  - `PreRunPreview` + `usePreRunCheck.ts` unreferenced — `execution-engine.md` #1
- **Verification:** `npx ts-prune --project tsconfig.json` to confirm no hidden dynamic-key callers; tsc clean; cite the finding IDs in each commit so the next audit can confirm follow-through; for each "delete vs wire" decision, prefer delete unless a tracked roadmap item exists.

### Wave 5 — Cross-cutting duplicate primitives (constants, regexes, formatters) (≈6 findings)
- **Why this is the right fifth wave:** Each is "extract one canonical, replace N call sites" — same fix template, similar verification. Fixing in one wave compounds: future contributors looking for `timeAgo` or `TRIGGER_ICONS` find one home. Safe to do later once the dead sites that referenced these are gone (Waves 1-3).
- **Findings included:**
  - `TRIGGER_ICONS` defined independently 4× with visual divergence — `persona-templates.md` #2
  - `timeAgo` re-exported 4× across deployment helpers (one with `'Never'` fallback drift) — `deployment-sharing-plugins.md` #2
  - 4 near-duplicate URL-extraction regexes (markdown-aware variant differs) — `connector-catalog.md` #4
  - `safeInvoke` duplicated researchLab vs devTools (broken substring check still in one) — `external-integrations.md` #2
  - `extractErrorMessage` duplicated locally in `ConsoleTab` — `vault-data-sources.md` #2
  - 3 `ScoreRing` variants hardcode grade-color triple, partial use of `gradeColors.ts` — `health-validation-network.md` #5
- **Verification:** for each promotion, add a one-line unit test if there's a contract worth pinning (the substring-vs-regex `safeInvoke` case has a real bug to lock in); tsc clean; visual smoke (`TRIGGER_ICONS` renders consistently across gallery/matrix/dimension panel).

### Wave 6 — Dead barrels + misnamed files + boundary blur (≈7 findings)
- **Why this is the right sixth wave:** Mostly mechanical structure cleanup. Greppable, low-risk, and pays back in IDE/onboarding clarity. Best done after the dead-code waves so the barrels' empty re-exports are exposed.
- **Findings included:**
  - 7 unused settings `sub_*/index.ts` barrels — `settings.md` #1
  - 6 unused `sub_generated/` barrels (adoption, design-preview, generation, shared, search/filters, search/suggestions, n8n/reducers) — `persona-templates.md` #3
  - 4 unused agent `sub_*/index.ts` barrels (`sub_tools`, `sub_connectors`, `sub_use_cases`, `sub_health`) — `agent-tools-connectors.md` #6
  - `api/templates/` is a misnamed bucket (recipes/skills/design/discovery moved out) — `persona-templates.md` #1
  - `NotificationCenter` misfiled in `features/gitlab/` — `external-integrations.md` #6
  - GitLab UI at `features/gitlab/` while every sibling integration is under `features/plugins/` — `external-integrations.md` #7
  - `animationPresets.ts` in `features/templates/` consumed by 4 other features — `persona-templates.md` #5
- **Verification:** tsc clean after each move; full app smoke (lazy-imports must resolve); update any `harness/scenario-parser.ts` directory markers; commit messages should cite both the old and new path so future grep history works.

### Wave 7 — i18n leaks + naming/structure cleanup (≈6 findings, optional)
- **Why this is the right last wave:** Lowest blast-radius, mostly one-line fixes. Save for last because they're safe, the team can grab any subset on a quiet day, and they don't block the other waves. Some of these (parallel feature-scoped i18n) overlap with Wave 6 boundary moves and can be combined if convenient.
- **Findings included:**
  - English-string leaks in `PersonaCreationCoach` + `SetupCards` (5 arrays of user-visible strings) — `onboarding-home.md` #7
  - Parallel feature-scoped i18n at `features/overview/i18n/` (14 stub locales, 3 dead keys) — `overview-dashboard.md` #8
  - `features/templates/i18n/` mini-system, 3 of 8 keys dead (quickSetup/moderateSetup/involvedSetup) — `persona-templates.md` #4
  - 2 plugins skip i18n pattern (research-lab, twin hardcoded English) — `deployment-sharing-plugins.md` #6
  - `CELL_FRIENDLY_NAMES` hardcodes English in i18n'd matrix — `persona-templates.md` #9
  - `EVENT_TYPE_LABELS` shadowed locally in `EventBusFilterBar.tsx` (drifted strings) — `overview-dashboard.md` #9
- **Verification:** tsc clean; visual smoke in a non-English locale (Czech, Bengali, Japanese) on Settings → Appearance, Onboarding wizard, Plugins browse, and Matrix command center; i18n CI key-completeness check passes.

> Findings beyond the suggested 5-7 waves go to a "Backlog" wave or are deferred until the user wants more. Don't try to plan all 150 into waves — only enough for the user to pick a starting point.

---

## How this scan was run

- **Scanner prompt**: `agent_code_refactor` (Code Refactor agent — dead code, duplication, structure, cleanup, naming)
- **Date**: 2026-05-02
- **Project**: personas (`C:\Users\kazda\kiro\personas`)
- **Stack**: Next.js 15 (App Router) + React 19 + Zustand + Tauri + SQLite + Tailwind 4 + TypeScript
- **Side scope**: client-side only — `src-tauri/` Rust intentionally descoped
- **Method**: 17 parallel subagent runs (one per Vibeman context), batched in 3 waves of 8/8/1
- **Findings target per context**: 6-10 meaningful items
- **Files read by scanners (approx)**: ~570
- **Verification**: count cross-checked two ways — sum of `> Total: N findings` headers vs count of `**Severity**:` bullets. Both report 150.
