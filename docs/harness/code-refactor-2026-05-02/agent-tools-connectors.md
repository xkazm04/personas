# Code Refactor Scan — Agent Tools, Connectors & Use Cases

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~45

## Summary

The contract surface of these three sub-modules is healthier than the harness-track records suggest — most prior orphan duplicates (`sub_tools/useToolSelectorState.ts`, the older `useToolImpactData.ts` shim) have been deleted since the April scan. What remains is a different shape of debt: **(a) genuinely orphaned component trees that survived a feature retirement** (the entire `ToolSelector` chain in `sub_tools/components/`, `EventSubscriptionSettings`, `UseCaseSubscriptionsSection`, `UseCaseListPanel`), **(b) a still-not-deleted second `HealthTab.tsx`** that the dev-experience scan flagged a week ago, and **(c) tab-internal duplication** in `PersonaUseCasesTabGrid` vs. `PersonaUseCasesTabGlyph` — the Glyph variant forked from Grid and the shared plumbing was never lifted. Two structural patterns recur: **barrel `index.ts` files that nothing imports through** (callers all use deep paths), and **misnamed files** (e.g. `UseCaseTabHeader.tsx` actually contains `UseCaseGeneralHistory`; `UseCaseActiveItems.tsx` exports `UseCaseActiveTriggers`/`UseCaseActiveSubscriptions`).

## 1. Entire `sub_tools/` UI tree (`ToolSelector` and its 14 dependencies) is dead — only its own internal imports

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_tools/components/ToolSelector.tsx` plus 8 sibling components and 7 lib files (~1.4k LOC total)
- **Scenario**: `sub_tools/index.ts` exports `ToolSelector`, but a project-wide grep finds zero JSX usage, zero imports of the barrel, and zero imports of any sub-tools component or hook from outside the directory. The Editor-tabs registry (`sub_editor/components/EditorLazyTabs.tsx`) loads `ActivityTab`, `PersonaSettingsTab`, `PersonaUseCasesTab`, `LabTab`, `ChatTab`, `DesignTab` — none of which mount `ToolSelector`. Tools are now displayed by `sub_connectors/components/connectors/ToolsSection` inside the `DesignHub` → `PersonaConnectorsTab` path. The tools selector retired but its files were left behind.
- **Root cause**: The "Tools" editor tab was folded into the connectors flow; the `sub_tools` UI pieces survived the cut because they had no consumer to break.
- **Impact**: ~1.4k LOC of bundled code that ships nothing, plus the `useToolImpactData.test.ts` keeps passing tests against a hook no UI calls. Devs reading e.g. `recommendationFromCoUsedTools` (well-doc'd, well-tested) can plausibly believe it's live and edit it as part of a feature change. The `useToolImpactData` hook in particular re-implements cost attribution and co-occurrence math that's nowhere reused, so the temptation to "just import the canonical version" is real and wrong.
- **Fix sketch**:
  - Verify with one more pass (rg `ToolSelector`, `ConnectorGroup`, `useToolImpactData`, `recommendationFromCoUsedTools`) that nothing outside `sub_tools/` imports any of these symbols.
  - Delete the entire `sub_tools/` directory (or, if anyone is preserving the design for a future re-introduction, move it to a `_attic/` and document why in `AGENTS.md`).
  - Remove `sub_tools` references from `harness/scenario-parser.ts` if any.
  - Drop `sub_tools` from the `agents/AGENTS.md` table.

## 2. Two `HealthTab.tsx` files in `sub_health/` — orphan + live, drifted

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_health/HealthTab.tsx` (orphan, 25 LOC) and `src/features/agents/sub_health/components/HealthTab.tsx` (live, 46 LOC)
- **Scenario**: `sub_health/index.ts` re-exports the `components/` version. A repo-wide search for `HealthTab` lands a developer on either file with equal probability, and they have already drifted: the live one adds a stale-data auto-refresh `useEffect` against `selectedPersona`; the orphan does not. The dev-experience-2026-04-27 scan called this out (finding #2) and it is still here unchanged.
- **Root cause**: April refactor lifted the auto-refresh logic into a new `components/HealthTab.tsx` and the old top-level file was never deleted.
- **Impact**: Recurring onboarding tax; any visual change forces "did I edit the right one?" verification. Already documented as a problem in two prior harness scans, so leaving it longer signals the scans aren't being acted on.
- **Fix sketch**:
  - `git rm src/features/agents/sub_health/HealthTab.tsx`.
  - Confirm no test, `.kiro` reference, or harness scenario points at the top-level file — `lib/harness/scenario-parser.ts` already uses `sub_health/` as a directory marker, not a file path.

## 3. `EventSubscriptionSettings` and `UseCaseSubscriptionsSection` are dead — survived a section retirement

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_connectors/components/subscriptions/EventSubscriptionSettings.tsx` (114 LOC), `src/features/agents/sub_connectors/components/subscriptions/UseCaseSubscriptionsSection.tsx` (96 LOC)
- **Scenario**: `PersonaConnectorsTab.tsx:10` even has the comment `// UseCaseSubscriptionsSection removed`, but the file is still in the tree. `EventSubscriptionSettings` is similarly unreferenced — the only project-wide hit is the file itself. Both are full-featured components (load/save/delete/toggle subscriptions, validation, retry-on-error UI), so a dev exploring the area can easily mistake them for the live subscription surface, especially given the very specific source-filter validator inside `AddSubscriptionForm.tsx`.
- **Root cause**: A connectors-tab simplification deleted the import sites; the component files were left as zombies.
- **Impact**: ~210 LOC of dead UI plus a working `validateSourceFilter` regex set that nobody runs. Greater risk: `AddSubscriptionForm` (still imported only by these dead files) carries non-trivial validation rules that no longer guard any real input.
- **Fix sketch**:
  - Verify `AddSubscriptionForm` and `SubscriptionForm.tsx` (`SubscriptionRow`, `useConfirmDelete`) are referenced only from these two retired components — preliminary grep confirms this.
  - Delete `EventSubscriptionSettings.tsx`, `UseCaseSubscriptionsSection.tsx`. If `validateSourceFilter` is genuinely useful, hoist it into `lib/eventTypeTaxonomy.ts` first, then delete.
  - Remove the `// UseCaseSubscriptionsSection removed` comment marker from `PersonaConnectorsTab.tsx:10` once the file is gone.

## 4. `UseCaseActiveItems.tsx` and `UseCaseTabHeader.tsx` — dead files with misleading names

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_use_cases/components/core/UseCaseActiveItems.tsx` (153 LOC), `src/features/agents/sub_use_cases/components/core/UseCaseTabHeader.tsx` (102 LOC)
- **Scenario**: `UseCaseActiveItems.tsx` exports `UseCaseActiveTriggers` and `UseCaseActiveSubscriptions` — neither is imported anywhere. `UseCaseTabHeader.tsx` actually contains a single `UseCaseGeneralHistory` component (the filename has nothing to do with the export), and again is unreferenced. Both files will mislead anyone using fuzzy file search.
- **Root cause**: Section retirement (probably the same wave as finding #3) plus a rename that never landed.
- **Impact**: ~250 dead LOC including a fully wired delete-confirmation pattern (`InlineDeleteButton`) that overlaps with the live `useConfirmDelete` in `SubscriptionForm.tsx` — adds drift risk if someone copies the dead pattern.
- **Fix sketch**:
  - Delete both files.
  - If any of `UseCaseActiveTriggers` / `UseCaseActiveSubscriptions` / `UseCaseGeneralHistory` is genuinely wanted later, the live equivalents in `UseCaseHistory` / `SubscriptionList` already cover the use case.

## 5. `PersonaUseCasesTabGrid` and `PersonaUseCasesTabGlyph` duplicate ~80 LOC of detail-tray and defaults plumbing

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTabGrid.tsx:77-91, 260-313` and `PersonaUseCasesTabGlyph.tsx:60-74, 235-291`
- **Scenario**: Both components share: (a) the identical `useEffect` that fetches `getMemoryCount` + `listManualReviews` and sets `memoriesDefault` / `reviewsDefault`, (b) the identical `handleToggle` / `handleSim` callbacks calling `requestToggle` / `requestSimulate`, and (c) an essentially identical `<motion.div>` detail tray with `history`/`config` tabs and the close button. The Glyph variant forked from Grid in the recent "Glyph view" feature, but the shared logic was not lifted out. This finding was raised at medium severity in dev-experience-2026-04-27 #7 and is still open.
- **Root cause**: View-mode fork; refactor cost not paid at fork time.
- **Impact**: Adding a third detail tab ("Logs", say) requires lockstep edits in both files; same for any toast-policy change in the cascade-handlers. Reviewers must visually diff the tray code each time.
- **Fix sketch**:
  - Extract `useUseCaseDefaults(personaId): { memoriesDefault, reviewsDefault }` into `sub_use_cases/libs/`.
  - Extract `<UseCaseDetailTray useCase={...} personaId={...} ... />` into `components/detail/UseCaseDetailTray.tsx` covering the title bar + tab strip + tray body.
  - Each top-level component shrinks to "render the cards in this layout, mount the tray".

## 6. Multiple barrel `index.ts` files re-export but nothing imports through them

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/agents/sub_tools/index.ts`, `src/features/agents/sub_connectors/index.ts`, `src/features/agents/sub_use_cases/index.ts`, `src/features/agents/sub_health/index.ts`
- **Scenario**: A grep for `from '@/features/agents/sub_connectors'`, `from '@/features/agents/sub_use_cases'`, `from '@/features/agents/sub_tools'`, and `from '@/features/agents/sub_health'` returns zero matches. Every consumer (e.g. `DraftSettingsTab`, `DesignHub`, `EditorLazyTabs`, `ArenaPanelLedger`) imports through the deep file path. The barrels are aspirational, not actual contracts. `sub_use_cases/index.ts` even exports `UseCaseListPanel`, which has no consumer (see finding #7) — the barrel masks that the export is dead.
- **Root cause**: Barrels were added speculatively; the deep-path style won by usage but the index files were left behind.
- **Impact**: New devs can't tell what's the public contract — the barrel suggests one thing, real usage suggests another. Means dead-code detection is weaker (a barrel re-export looks like a "use" to naive scans).
- **Fix sketch**:
  - Pick one direction. Either: (a) delete all four `index.ts` files and force deep imports, since that's the de-facto convention, or (b) migrate every consumer to the barrel and document in `AGENTS.md` that the barrel is the contract.
  - Option (a) is the cheap win — it surfaces the dead `UseCaseListPanel` export and the fully-dead `ToolSelector` export immediately.

## 7. `UseCaseListPanel` is a third dead component in `sub_use_cases/`

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/agents/sub_use_cases/components/core/UseCaseListPanel.tsx` (84 LOC)
- **Scenario**: Exported from `sub_use_cases/index.ts:7` and imported by no one (verified via grep). The component is a fully-styled use-case list with category badges, override indicators, and selection state — but `PersonaUseCasesTabGrid` and `PersonaUseCasesTabGlyph` both render their own card grids and never instantiate it.
- **Root cause**: Likely an early prototype that lost the layout duel to the grid/glyph variants and was never removed. The barrel re-export (finding #6) hid that nothing actually uses it.
- **Impact**: 84 LOC + a `CATEGORY_STYLES` map duplicated nowhere else, but anyone copying its category-color pattern will be picking from a dead reference.
- **Fix sketch**: Delete the file and the matching `index.ts` re-export. If any future tab wants a list view of use cases, start from the grid variant, not this one.

## 8. `ToolsSection` lives under `sub_connectors/` but reads `t.agents.connectors.*` — feature-boundary blur

- **Severity**: low
- **Category**: structure
- **File**: `src/features/agents/sub_connectors/components/connectors/ToolsSection.tsx`
- **Scenario**: This component renders the tool chips inside the `PersonaConnectorsTab` and pulls translations from `t.agents.connectors.ts_configured` / `t.agents.connectors.ts_no_tools`. With `sub_tools/` retired (finding #1), `ToolsSection` is now the only "tools UI" in the codebase — yet it sits under `sub_connectors/`, named ambiguously alongside `ConnectorsSection`/`AutomationsSection`. The unused `personaId?: string` prop (line 8) is also a giveaway that the surface was once richer and has been pared back.
- **Root cause**: Tools display moved into connectors when `ToolSelector` retired; the file location matched the new mount point but never got renamed for clarity.
- **Impact**: Mild ongoing confusion when a new dev searches "where do agent tools render?" — they'll grep `Tools` and land in `sub_tools/` (now dead) before finding this. Also: the unused `personaId` prop is silent technical debt.
- **Fix sketch**:
  - Drop the unused `personaId` prop from `ToolsSectionProps` and from the call site in `PersonaConnectorsTab.tsx:139`.
  - Optionally rename `ToolsSection.tsx` → `PersonaToolsSection.tsx` to disambiguate from `ConnectorsSection`.
  - Once `sub_tools/` is deleted (finding #1), this is the natural single home for tools UI.

## 9. `UseCaseDetailPanel` accepts `credentials` and `connectorDefinitions` props it never reads

- **Severity**: low
- **Category**: cleanup
- **File**: `src/features/agents/sub_use_cases/components/detail/UseCaseDetailPanel.tsx:17`
- **Scenario**: Both props are destructured with leading underscores (`credentials: _credentials, connectorDefinitions: _connectorDefinitions`) and never referenced in the body. Both `PersonaUseCasesTabGrid:303-307` and `PersonaUseCasesTabGlyph:281-285` (and `UseCaseSubscriptionsSection`'s callsite, before it was retired) drill the props down through render trees just to satisfy this dead signature. The underscore prefix signals intent ("ignored on purpose") but does nothing about the upstream prop drilling.
- **Root cause**: The detail panel previously needed credential context; the inner `useUseCaseDetail` hook now reads from the store directly, so the props became vestigial. The signature wasn't updated.
- **Impact**: Reviewers reading the call sites have to follow the props down two levels to discover they're unused — gives a misleading impression of which data the panel depends on. Mildly inflates `EditorBody` → `PersonaUseCasesTab` → `Grid/Glyph` → `UseCaseDetailPanel` prop pipelines for no payoff.
- **Fix sketch**:
  - Remove `credentials` and `connectorDefinitions` from `UseCaseDetailPanelProps`.
  - At each call site, drop the pass-through. The Grid/Glyph components still take the props from `PersonaUseCasesTabProps` (the editor passes them in) — those become candidates for removal too if no other descendant reads them.

> Total: 9 findings (4 high, 3 medium, 2 low)
