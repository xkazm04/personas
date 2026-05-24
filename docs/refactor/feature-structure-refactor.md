# Feature Structure Refactor — `src/features` & `src/lib`

> **Status:** Analysis / backlog. Authored 2026-05-24.
> **Goal:** Make the folder hierarchy of `src/features` and `src/lib` reflect the
> *actual app navigation hierarchy*, extract genuinely shared code, and delete
> dead code. This is a working checklist — items are grouped, each has an ID,
> priority (P0–P3), rough effort, and a confidence note on the evidence.

---

## 0. Guiding principles (the target shape)

1. **A 1st-level folder == a 1st-level sidebar section.** Each top-level feature
   folder holds only that section's shell + top-level components. Per-submodule
   code lives in `sub_*` folders. Anything used by 3+ features moves to
   `src/features/shared`. Feature-specific libs live in the feature; genuinely
   cross-cutting libs live in `src/lib` (with a new `src/lib/shared/` for the
   low-level, app-wide primitives that are currently loose at `lib/` root).

2. **Chrome is not a feature.** The app shell (sidebar, titlebar, footer,
   global overlays, ambient surfaces) belongs together under
   `shared/components/layout`, not as sibling pseudo-features.

3. **The sidebar is the source of truth** (`shared/components/layout/sidebar/sidebarData.ts`):

   | Sidebar id      | Label       | Feature folder(s) today                              |
   |-----------------|-------------|------------------------------------------------------|
   | `home`          | Home        | `home/` (+ `onboarding/` global tour)                |
   | `overview`      | Overview    | `overview/`                                          |
   | `personas`      | Agents      | `agents/` **+ `pipeline/` (Teams) + `deployment/` (Cloud)** |
   | `events`        | Events      | `triggers/`                                          |
   | `credentials`   | Connections | `vault/` **+ `sharing/` (Network settings)**         |
   | `design-reviews`| Templates   | `templates/`, `recipes/`                             |
   | `plugins`       | Plugins     | `plugins/*`                                          |
   | `settings`      | Settings    | `settings/`                                          |
   | *(titlebar)*    | Schedules   | `schedules/` (reached via titlebar, not in sidebar)  |
   | *(chrome)*      | —           | `app-shell/`, `monitor/`, `radio/`, `execution/`     |

   Anything in the last two rows that is a **sibling top-level folder** is a
   smell: it's either chrome (→ `shared/components/layout`) or a hidden
   sub-view of a real section (→ `<section>/sub_*`).

### ⚠️ Methodology caveat — read before acting on §E (dead code)

There is **no `knip`/`ts-prune` installed**. The dead-code list below was built
by manual basename grep, which **misses transitive reachability** and produced at
least one large false positive during analysis (`templates/sub_n8n/**` was
flagged as ~51 dead files, but `N8nImportTab` *is* mounted by `DesignReviewsPage`
and transitively pulls in the wizard steps/widgets/hooks — **not dead**).

**TODO-DEAD-0 (P0, do first): ✅ DONE (2026-05-24).** `knip` is installed and
configured (`knip.json`), with `npm run check:dead` (full) and
`npm run check:dead:files` (files only). Baseline captured in
[`dead-code-baseline.md`](./dead-code-baseline.md): **455 unused files** /
**~1408 unused exports**. Key learning: file-mode and export-mode are
complementary — file-mode **under-reports** dead code hidden behind barrels
(e.g. `pipeline/sub_canvas` shows 0 files but its exports are dead), so check
both. The manual §E estimates below are **superseded** by the knip baseline;
work the clusters in `dead-code-baseline.md`, not the hand-grepped guesses here.

---

## A. Orphan / misplaced top-level folders

> **Phase 2 progress (2026-05-24):** ✅ **A1** app-shell→shared/layout (`e5a30d85d`),
> ✅ **A2** execution→shared/overlays (`6387e544e`), ✅ **A4** radio→shared/layout/radio
> (`88feb69bd`), ✅ **A5** sharing→settings/sub_network (`7e59db98a`). ⛔ **A3**
> monitor — BLOCKED (`monitor/PersonaMonitor.tsx` owned by the concurrent
> Groups→Teams session); do after it merges. Deferred: **A6** deployment, **A7**
> pipeline (pipeline owned by Groups→Teams session), **A8** schedules (needs a
> product decision — see below).

### A1 — `app-shell/` → fold into `shared/components/layout` `[P1, M, high]`
**Finding:** `app-shell/` contains only `Sidebar.tsx` and `TitleBar.tsx`. But the
sidebar *primitives, section renderers, and `sidebarData.ts` already live in
`shared/components/layout/sidebar/`*, and a `TitleBarAmbient.tsx` already lives
in `shared/components/layout/`. So the composition shells are split from their
own building blocks. Importers: only `App.tsx` and `PersonasPage.tsx`.

- [ ] **A1.1** Move `app-shell/components/Sidebar.tsx` →
      `shared/components/layout/sidebar/Sidebar.tsx` (co-locate with `SidebarLevel1/2/3`).
- [ ] **A1.2** Move `app-shell/components/TitleBar.tsx` →
      `shared/components/layout/TitleBar.tsx` (next to `TitleBarAmbient.tsx`).
- [ ] **A1.3** Delete the `app-shell/` folder; update the 2 importers.

### A2 — `execution/` → `shared/components` (global mini-player) `[P2, S, high]`
**Finding:** Only 2 files. `ExecutionMiniPlayer.tsx` is mounted by `App.tsx`
(global floating player); `PipelineDots.tsx` is imported only by
`ExecutionMiniPlayer`. This is chrome, not a feature. Note the name collision
risk with `lib/execution` (execution tracking) and `pipeline` — pick a clear home.

- [ ] **A2.1** Move both files to `shared/components/overlays/executionPlayer/`
      (or `shared/components/feedback/`). Update `App.tsx` import.
- [ ] **A2.2** Delete the `execution/` feature folder.

### A3 — `monitor/` → `shared/components/layout` (Persona Monitor chrome) `[P2, S, med]`
**Finding:** 6 files. `PersonaMonitor` is mounted from
`shared/components/layout/ProcessActivityIndicator.tsx` (a titlebar indicator);
`MonitorDrawer` is internal. It's a global chrome surface reachable from the
always-mounted titlebar, not a sidebar section.

- [ ] **A3.1** Move `monitor/*` → `shared/components/layout/monitor/`.
      Keep its `index.ts` barrel. Update `ProcessActivityIndicator` + `MonitorDrawer` consumers.

### A4 — `radio/` → `shared/components/layout` (ambient footer feature) `[P3, S, med]`
**Finding:** 12 files. `RadioFooter` renders in `DesktopFooter`,
`RadioSettingsCard` in the Account settings tab; state lives in a `radioSlice`.
Ambient/entertainment chrome, not a sidebar section. Lower priority — it's
self-contained and harmless where it is.

- [ ] **A4.1** Move `radio/*` → `shared/components/layout/radio/` (or leave with a
      doc note if churn isn't worth it — decide during execution).

### A5 — `sharing/` → split between `settings/sub_network` and a global overlay `[P1, M, high]`
**Finding:** 16 files. `ShareLinkHandler` is a global deep-link overlay mounted
in `App.tsx` (`personas://share`). `ExposureManager`/`NetworkDashboard`/`PeerCard`/etc.
are rendered as the **Settings → Network** tab (`settings` has a `network`
devOnly item). So this is two things wearing one folder: a settings sub-feature +
one global overlay.

- [ ] **A5.1** Move the P2P/network UI (`NetworkDashboard`, `PeerList`, `PeerCard`,
      `PeerDetailDrawer`, `ExposureManager`, `IdentitySettings`, `NetworkAccessScopeBadge`,
      `ProvenanceBadge`, `NetworkIcons`, `EnclaveVerificationView`) →
      `settings/sub_network/`.
- [ ] **A5.2** Move bundle import/export dialogs (`BundleExportDialog`,
      `BundleImportDialog`, `BundlePreviewContent`, `ImportSuccessCelebration`,
      `InlineConfirm`) to wherever they're invoked from — likely `settings/sub_portability/`
      or `shared/components/modals/`. **Verify call sites first.**
- [ ] **A5.3** Move `ShareLinkHandler` → `shared/components/overlays/`.
- [ ] **A5.4** Delete `sharing/`.

### A6 — `deployment/` → `personas/sub_deployment` (Agents → Cloud tab) `[P1, L, high]`
**Finding:** 30 files. Mounted by `PersonasPage` under `agentTab === 'cloud'`
with a `cloudTab` sub-router (unified/cloud/gitlab). It is a hidden sub-view of
the **personas** section, not top-level.

- [ ] **A6.1** Move `deployment/` → `personas/sub_deployment/` (preserve the
      `components/cloud/` + `hooks/` internal layout). Update `PersonasPage` imports.
- [ ] **A6.2** Re-check the `plugins/gitlab` ↔ deployment imports survive the move.

### A7 — `pipeline/` → `personas/sub_teams` (Agents → Team tab) `[P1, L, high]`
**Finding:** 60+ files. Mounted by `PersonasPage` under `agentTab === 'team'`.
"Pipeline" is the legacy name for the Teams feature. Large chunks are dead (see
§E). `CommandPanelComposer` is referenced by the sidebar composer.

- [ ] **A7.1** First do the §E dead-code removal for `pipeline/sub_canvas/**` and
      `pipeline/components/groups/**` (shrinks the move surface dramatically).
- [ ] **A7.2** Rename/move `pipeline/` → `personas/sub_teams/`. Keep `sub_assignments`,
      `sub_teamMemory`, and the live `components/` (TeamList, TeamCanvas, teamStudio,
      CreateTeamForm, AutoTeamModal, BlueprintPreview). Update `PersonasPage` + sidebar imports.
- [ ] **A7.3** Reconcile the name "pipeline" everywhere (store name `pipelineStore`,
      `lib/canvas`) — decide whether to rename to `teams*` for consistency or leave
      stores alone to limit blast radius. **Recommend: rename folder now, defer store rename.**

### A8 — `schedules/` → clarify status `[P2, S, med]`
**Finding:** 16 files. `ScheduleTimeline` mounts when `sidebarSection === 'schedules'`,
routed from the titlebar `CalendarClock` button — but `schedules` is **not** in
`sidebarData.ts`'s `sections[]`. It's a titlebar-only quick-access route.

- [ ] **A8.1** Decide intent with the user: (a) promote to a real sidebar section
      (add to `sections[]`), or (b) keep as a titlebar overlay and document it as
      such in the folder README. Until decided, leave the folder top-level.

---

## B. `agents/` internal restructure

The `agents/components/` folder (~104 files) is the biggest internal antipattern:
it holds entire sub-feature trees instead of only agent-shell components, sitting
beside the proper `sub_*` siblings.

> **Phase 4 progress (2026-05-24):** ✅ **B4** health/→sub_health/ + dead-stub
> delete (`19f7e91e4`), ✅ **B2** components/glyph→sub_glyph (`b1c44706d`),
> ✅ **B1.1** components/newPersona→sub_new_persona (`9f06a70d0`), ✅ **B3**
> ConfigurationPopup→overview/health + onboarding/ removed (`72e768158`).
> `agents/components/` now holds only: `allPersonas/` (⛔ owned by Groups→Teams
> session), `matrix/` (deferred — **B1.2** is a 20-importer extraction, not a
> rename), and loose `ChatThread`/`ChatMessageContent` (**B5**, deferred — string
> reference in `lib/harness`). preview/ already removed in Phase 1.

### B1 — Promote sub-feature trees out of `agents/components/` `[P1, L, med]`
- [ ] **B1.1** `agents/components/newPersona/` (+ `capabilityView/`) → `agents/sub_new_persona/`.
      It's a distinct creation flow, not a shared component.
- [ ] **B1.2** `agents/components/matrix/` → keep the live editor components
      (`UnifiedBuildEntry`, `BuildSimulatePanel`, `SharedResourcesPanel`,
      `BehaviorCoreEditor`) but **extract** `quickConfigTypes.ts` +
      `useHealthyConnectors.ts` → `agents/shared/quickConfig/` (they're reused by
      glyph/matrix/templates). [med confidence — verify the cross-imports]
- [ ] **B1.3** `agents/components/allPersonas/` → this is the agent-list landing
      surface for the section; promote to `agents/sub_list/` (or leave at
      `agents/` root if it's the section shell). Decide based on entry component.
- [ ] **B1.4** `agents/components/preview/` (`PreviewPanel`, `PreviewSection`) —
      appears self-contained with no external importers. **Verify with knip**;
      if dead, delete (see §E). If live, fold into the sub-feature that uses it.

### B2 — `agents/components/glyph/` vs `shared/glyph/` `[P2, M, high]`
**Finding:** Not duplicates. `shared/glyph/` (dimArt, persona-layout, persona-sigil)
is the visual sigil/layout *design system*; `agents/components/glyph/` (CommandPanel,
GlyphEditFace, GlyphFullLayout, GlyphPrototypeLayout, GlyphUseCaseBlocks) is the
agent *editor UI* built on top. Imports of each stay within their domain.

- [ ] **B2.1** Rename `agents/components/glyph/` → `agents/sub_glyph/` (or
      `agents/sub_editor/glyph/` if it belongs to the editor) so it's clearly a
      sub-feature, not generic components. Leave `shared/glyph/` as the design system.
- [ ] **B2.2** Add a one-line README in each glyph folder stating the split, to
      stop future "looks like a dupe, let me merge" churn.

### B3 — `agents/components/onboarding/` `[P2, S, med]`
**Finding:** Separate from the top-level `onboarding/` feature. Only
`ConfigurationPopup` is imported (by `SystemHealthPanel`); `OnboardingTemplateStep`
+ `useOnboardingChecklist` appear unused.

- [ ] **B3.1** Move the live `ConfigurationPopup` to wherever `SystemHealthPanel`
      lives (it's a health/system-check concern, not agent onboarding).
- [ ] **B3.2** Delete the unused `OnboardingTemplateStep` + `useOnboardingChecklist`
      after knip confirms (see §E).

### B4 — Resolve `agents/health/` vs `agents/sub_health/` duplication `[P1, S, high]`
**Finding:** Two health folders. `agents/health/` (14 files) is the substantive
health library; `agents/sub_health/` (1 file) is a near-empty stub (missing barrel).

- [ ] **B4.1** Determine which is canonical (likely `health/`). Move its contents
      into `agents/sub_health/` to match the `sub_*` convention, then delete the
      bare `health/` folder. Update importers.

### B5 — Stray root files in `agents/components/` `[P3, S, med]`
- [ ] **B5.1** `ChatThread.tsx`, `ChatMessageContent.tsx`, `designUtils.ts` —
      flagged unused (only referenced by the test harness / each other). Verify
      with knip, then delete (see §E).

---

## C. `home/` and the `onboarding/` question

### C1 — Answer "why is `onboarding/` not under `home/`?" `[P2, doc, high]`
**Finding & answer:** `onboarding/` is a **global guided-tour overlay**
(`GuidedTour`, `TourSpotlight`) mounted at the `App.tsx` root and spotlighting UI
across *all* routes — not a home-scoped page. Home has its own "Welcome"/"Learning"
tabs, which are different. So it is correctly *not* a home sub-feature.

- [ ] **C1.1** Decision for the user: keep `onboarding/` top-level as a
      cross-cutting overlay, **or** move it under `shared/` (e.g.
      `shared/components/overlays/onboarding/` or `shared/onboarding/`) to make its
      "chrome, not a section" nature explicit. **Recommend: move under `shared/`**,
      consistent with principle #2. Add a README either way.

### C2 — `home/components/cockpit/` and `releases/` are sub-features `[P2, M, high]`
**Finding:** `home/components/cockpit/widgets/**` and `home/components/releases/**`
are deeply nested sub-feature trees inside `components/`.

- [ ] **C2.1** Promote `home/components/cockpit/` → `home/sub_cockpit/`.
- [ ] **C2.2** Promote `home/components/releases/` → `home/sub_releases/` (note: it
      keeps the allowed `releases/i18n/useReleasesTranslation.ts` display adapter —
      see CLAUDE.md; that's fine).
- [ ] **C2.3** `home/lib/fleetHealth.ts` is distinct from `lib/fleet/` — keep, but
      see §G for the `lib/fleet` question.

---

## D. Other feature folders — internal consistency

### D1 — `overview/`: collapse `utils/` into `libs/` `[P2, S, med]`
**Finding:** Both `overview/libs/` and `overview/utils/` exist with no clear
split principle. `overview/shared/` (e.g. `eventVisuals.ts`) is overview-internal
only — correctly scoped, keep.

- [ ] **D1.1** Merge `overview/utils/` into `overview/libs/`; pick one name
      (`libs/`) and update imports. Keep `overview/shared/` as-is.

### D2 — `plugins/*`: standardize `_shared`/`_variants` naming `[P3, S, high]`
**Finding:** `plugins/research-lab/_shared/`, `plugins/twin/_shared/`,
`plugins/twin/_variants/` use a non-standard underscore-prefix that's inconsistent
with the rest of the codebase (`shared`, `sub_*`).

- [ ] **D2.1** Rename `research-lab/_shared/` → `research-lab/shared/`.
- [ ] **D2.2** Rename `twin/_shared/` → `twin/shared/`, `twin/_variants/` → `twin/variants/`.
- [ ] **D2.3** Audit `plugins/langfuse/` (only a `hooks/` folder) — confirm it's
      live or remove. [verify]

### D3 — `triggers/`, `vault/`, `recipes/`, `settings/`, `templates/` `[P3, doc]`
**Finding:** These are largely coherent. Their feature-local `shared/`/`sub_shared/`
folders were verified **not** used outside the feature.

- [ ] **D3.1** Document, don't move: add a one-liner to each explaining
      `lib/` (domain logic/errors) vs `sub_shared/`/`shared/` (reusable components
      within the feature). Specifically `triggers/lib` + `triggers/sub_shared` and
      `vault/shared` (which *is* legitimately consumed by personas/plugins/home — keep elevated).
- [ ] **D3.2** Clarify `recipes/` (standalone authoring hub) vs `templates/sub_recipes/`
      (consumption view inside the templates gallery). They are **not** duplicates —
      add a README cross-reference to prevent a future "merge these" mistake.

---

## E. Dead code (CANDIDATES — gate on knip, see TODO-DEAD-0)

> Every item here needs knip confirmation. Confidence = manual-verification strength.

### E1 — `pipeline/sub_canvas/**` — the legacy edge-wiring canvas `[high]`
`TeamCanvas.tsx` carries a comment: *"edge-wiring canvas (sub_canvas/, canvas/,
AutoTeam) is no longer [used]"*. `PersonasPage` imports only `CanvasDragProvider`
from the `sub_canvas` barrel; everything else (nodes/, edges/, debugger/,
assistant/, OptimizerPanel, libs/*) is unreferenced.

- [ ] **E1.1** Delete all of `pipeline/sub_canvas/` **except** verify whether
      `CanvasDragProvider` is still doing real work in `PersonasPage`; if it's a
      no-op wrapper, remove that too. ~27 files.

### E2 — `pipeline/components/groups/**` — post Groups→Teams migration `[high]`
`GroupCard`, `GroupEditModal`, `GroupManagerPage`, `GroupMemoryListModal` have no
real importers (the grep "hits" were a comment in `TeamPresetGroupSpec.ts`, a
comment in `api/overview/memories.ts`, and the unrelated `RoleGroupCard`).

- [ ] **E2.1** Delete `pipeline/components/groups/` (4 files) after knip.

### E3 — `agents/components/` strays `[high/med]`
- [ ] **E3.1** `ChatThread.tsx`, `ChatMessageContent.tsx` (high), `designUtils.ts` (high).
- [ ] **E3.2** `onboarding/OnboardingTemplateStep.tsx`, `onboarding/useOnboardingChecklist.ts` (high).
- [ ] **E3.3** `preview/PreviewPanel.tsx`, `preview/PreviewSection.tsx` (med — self-contained, no external refs).

### E4 — `templates/` partial dead candidates `[med — VERIFY transitively]`
> ⚠️ The earlier blanket "`sub_n8n` is dead" claim was **FALSE** (wizard is live).
> Only these narrower candidates remain, and even these need transitive checking:
- [ ] **E4.1** `templates/sub_diagrams/` — `FlowDiagram`, `FlowNodeCard`, `NodePopover`,
      `PopoverPositioner`, `activityDiagramTypes` (only `ActivityDiagramModal` is imported). [med]
- [ ] **E4.2** `templates/sub_presets/PresetGraphAdapter`, `PresetQuestionnaireForm`. [med]
- [ ] **E4.3** `templates/sub_recipes/libs/recipeAdapter`, `substituteBindings`,
      `mockRecipes`, `useEligibility`. [low — likely barrel-exported; verify]

### E5 — Misc `[low]`
- [ ] **E5.1** `shared/components/icons/` (3 files, reported 0 imports). [verify]
- [ ] **E5.2** `lib/attention`, `lib/polling` reported with unclear/no importers. [verify]

---

## F. `shared/` — mostly healthy, light touches

**Finding:** `shared/components` is well-organized (buttons, display, editors,
feedback, forms, layout, modals, overlays, picker, progress, terminal, use-cases)
with no single-feature components hiding in it and no obvious cross-feature
component leaks. Keep the taxonomy.

- [ ] **F1** After A1–A5, ensure all chrome lands under `shared/components/layout`
      (sidebar/, monitor/, radio/, TitleBar) so "chrome" is one coherent subtree.
- [ ] **F2** `shared/charts/` (1 file) — fine; leave.
- [ ] **F3** Verify `shared/components/icons/` is used; delete if confirmed dead (E5.1).

---

## G. `src/lib/` reorganization

### G1 — Create `src/lib/shared/` and group the ~25 loose root `.ts` files `[P2, M, med]`
**Finding:** ~25 loose files at `lib/` root (`analytics.ts`, `eventBridge.ts`,
`eventRegistry.ts`, `sentry.ts`, `log.ts`, `fsm.ts`, `storeBus.ts`,
`telemetryPreference.ts`, `documentVisibility.ts`, `density.ts`, `idlePrefetch.ts`,
`throttledStorage.ts`, `memoryLimits.ts`, …) with no grouping.

- [ ] **G1.1** Create `src/lib/shared/` and group by concern, e.g.
      `shared/events/` (eventBridge, eventRegistry, eventPayloads, storeBus, storeBusWiring),
      `shared/observability/` (analytics, sentry, log, telemetryPreference, ipcMetrics),
      `shared/dom/` (documentVisibility, density, idlePrefetch),
      `shared/state/` (fsm, throttledStorage, memoryLimits).
      Do this incrementally — it's a wide import-path churn, so batch by group and
      run `tsc --noEmit` between batches. **Leave `tauriInvoke.ts` at a stable path**
      (ESLint `no-restricted-imports` references it).

### G2 — Merge `lib/theme` + `lib/theming` `[P2, S, high]`
**Finding:** `lib/theme/` (`deriveCustomTheme`, `contrastRatio`) and `lib/theming/`
(`vibeThemes`) are split confusingly.

- [ ] **G2.1** Consolidate into `lib/theme/` (move `vibeThemes` → `lib/theme/vibes.ts`).
      Delete `lib/theming/`. Update the few importers.

### G3 — Relocate feature-specific libs `[P3, S, low — VERIFY usage first]`
- [ ] **G3.1** `lib/canvas/` — reported used only by triggers (2 imports). **But**
      also check `pipeline`/Teams canvas before moving. If truly triggers-only,
      move → `triggers/lib/canvas/`. [verify — low confidence]
- [ ] **G3.2** `lib/fleet/` — reported used by overview (1) and related to
      `home/lib/fleetHealth` + `plugins/fleet`. Do **not** move blindly; map all
      importers first. Likely stays as shared infra. [verify]
- [ ] **G3.3** Keep `lib/eval`, `lib/execution`, `lib/personas`, `lib/credentials`,
      `lib/templates` as shared domain libs (used across multiple features).

---

## Suggested sequencing

1. **Phase 0 — Tooling:** TODO-DEAD-0 (install knip + `check:dead`).
2. **Phase 1 — Delete dead code (§E)** once knip confirms. Biggest wins:
   `pipeline/sub_canvas`, `pipeline/components/groups`, agents strays. Shrinks
   everything downstream.
3. **Phase 2 — Chrome consolidation (§A1–A5, F1):** app-shell, execution, monitor,
   radio, sharing → `shared/components/layout` / `settings`. Mechanical, high-value.
4. **Phase 3 — Personas sub-views (§A6, A7):** deployment → `sub_deployment`,
   pipeline → `sub_teams`. Larger; do after their dead code is gone.
5. **Phase 4 — agents/ + home/ internal restructure (§B, §C).**
6. **Phase 5 — lib/ reorg (§G)** — wide churn, do last, batch + `tsc` between batches.
7. **Phase 6 — naming/docs cleanup (§D).**

## Risks & guardrails

- **Import churn:** every move is a wide find-replace of import paths. Run
  `npx tsc --noEmit` after each item; commit atomically per item (CLAUDE.md
  parallel-safety rules). Prefer a `git worktree` for the multi-file phases.
- **ts-rs bindings / generated files:** never move `lib/bindings`,
  `commandNames.generated.ts`, `n8nLimits.generated.ts`.
- **Docs sync hook:** moving feature source will trip the Stop hook
  (`check-doc-sync.mjs`). These are structural-only moves with no user-visible
  behavior change → dismiss with *"internal refactor, no doc/tour/marketing
  change"* per turn, unless a folder rename actually changes a documented path.
- **i18n:** none of these moves touch `en.json` keys; the section-locales pipeline
  is path-independent of `src/features` layout.
- **Stores:** `pipelineStore` rename is deferred (A7.3) to limit blast radius.
