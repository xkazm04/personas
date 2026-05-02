# Code Refactor Fix Wave 3 — Smaller Dead-Component Subtrees

> 7 atomic commits, 7 findings closed.
> ~3,670 LOC removed across 5 feature areas. Mechanical follow-through of Wave 1's pattern — same delete-and-grep discipline, smaller individual surfaces.
> Baseline preserved: tsc 0 → 0 errors; tests 1086/1087 → 1086/1087 (one pre-existing failure unrelated to this wave).

## Commits

| # | Commit | Findings closed | Files | Net LOC |
|---|---|---|---|---:|
| 1 | `f6ef321f` | agent-tools-connectors #3 | 5 (1 mod + 4 deleted; subscriptions/ subtree + AddSubscriptionForm + SubscriptionForm) | -430 |
| 2 | `d3bfc3c7` | agent-tools-connectors #4 | 2 deleted (UseCaseActiveItems, UseCaseTabHeader) | -254 |
| 3 | `43b68884` | agent-lab-matrix #1 | 1 deleted (BuildReviewPanel) | -148 |
| 4 | `c69379ca` | agent-chat-tool-runner #3 | 6 deleted (detail/views/ExecutionList chain + CostSparkline + useExecutionListState) | -734 |
| 5 | `4b841316` | credentials-keys #3 | 14 deleted (CredentialCard chain + audit features) | -1,533 |
| 6 | `934036f9` | credentials-keys #4 | 4 (1 mod + 3 deleted) | -379 |
| 7 | `8de09952` | connector-catalog #2 | 2 (1 mod + 1 deleted; SetupGuideModal + types.ts comment) | -194 |
|   | **Total** | | **34 files** | **-3,670** |

## What was fixed (grouped by sub-pattern)

1. **Section-retirement zombies (`EventSubscriptionSettings` + `UseCaseSubscriptionsSection`)** — A connectors-tab simplification deleted the import sites; the component files survived as zombies. `PersonaConnectorsTab.tsx:10` literally had a `// UseCaseSubscriptionsSection removed` comment confirming the dead state. Also took out `AddSubscriptionForm` and `SubscriptionForm` (verified consumed only by the doomed pair).

2. **Misnamed-file orphans (`UseCaseActiveItems`, `UseCaseTabHeader`)** — `UseCaseActiveItems.tsx` exported `UseCaseActiveTriggers`/`UseCaseActiveSubscriptions`; `UseCaseTabHeader.tsx` contained a single `UseCaseGeneralHistory` component. Filenames had nothing to do with their exports — fuzzy file search would land readers on wrong files.

3. **Superseded-by-newer-impl (`BuildReviewPanel`)** — 148 LOC review panel + `CountBadge`/`DimensionChip` helpers, replaced by `GlyphTestCompleteCore` + `MatrixCommandCenterParts`. (Note: `BadgeSlot.tsx` had a different function-scoped `CountBadge` — the deletion didn't touch that.)

4. **Half-completed extraction (`detail/views/Execution*`)** — 6 files of plausible-looking React (`ExecutionList`, `ExecutionRow`, `ExecutionListHeader`, `ExecutionExpandedDetail`, `useExecutionListState`, `CostSparkline`) that nothing outside the folder imported. The live `ExecutionList` lives at `components/list/`. Kept `ExecutionSummaryCard`, `ExecutionMemories`, `ExecutionLogViewer` (live consumers via `ExecutionMiniPlayer` + shared modal).

5. **List-architecture migration leftovers (`CredentialCard` chain — 14 files, 1.5k LOC)** — The current credential list view is `DataGrid` + `CredentialDetailModals`. The older expandable-card UI (`CredentialCard` + body/header/details/badges/sectionContent/tagsRow + 3 badges + `OAuthTokenMetricsPanel` + `CredentialAuditTimeline` + `AuditTimelineEntries` + `auditAnomalies`) was not deleted when the list view was migrated. Verified `OP_LABELS` from the kept `AuditLogTable.tsx` is still consumed by `CredentialIntelligence.tsx`.

6. **Pre-toolbar-design orphans (`HealthStatusBar`, `BulkHealthcheckSummary`, `CredentialFilterBar`)** — Replaced by `CredentialToolbar` + `DataGrid` column filters. The `useSimpleSummary.ts` comment referencing `HealthStatusBar`'s "conservative reading" was also updated to drop the dead reference.

7. **Single-component reimplemented inline (`SetupGuideModal`)** — 193 LOC standalone modal replaced by inline `SetupGuideSection` (in `sub_credentials/components/forms/`). The stale comment at `types.ts:176` ("Markdown body shown in the SetupGuideModal") was repointed to `SetupGuideSection`.

## Verification table (before/after)

| Gate | Before Wave 3 | After Wave 3 | Delta |
|---|---:|---:|---|
| `npx tsc --noEmit` | 0 errors | 0 errors | unchanged ✓ |
| `npx vitest run` | 1086/1087 | 1086/1087 | unchanged (same pre-existing `useMatrixBuild.test.ts:244` failure) |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Net LOC |
|---:|---|---:|---:|
| 1 | Delete orphan islands | 7 | -5,030 |
| 2 | Resolve diverged near-copies | 8 | -3,869 |
| 3 | Delete smaller dead-component subtrees | 7 | -3,670 |
| **Total** | | **22** | **-12,569** |

## Patterns established (additions to the catalogue, items 10-11)

10. **Section-retirement comment marker** — When a code area carries a comment like `// X removed` or `// Y was deprecated`, that comment is the smoking gun that someone intended to delete X/Y but stopped halfway. Find X/Y and check if it actually shipped — almost always it's still in the tree, accumulating cruft. **Detection:** `grep -r "// .*\(removed\|deprecated\|deleted\)" src/`. **Resolution:** verify the named entity is unreferenced, then delete it AND the comment marker.

11. **Filename-export mismatch as fuzzy-search hazard** — Files named after concepts that don't match what they actually export (e.g. `UseCaseActiveItems.tsx` exporting `UseCaseActiveTriggers`/`UseCaseActiveSubscriptions`; `UseCaseTabHeader.tsx` containing a `UseCaseGeneralHistory` component). Often a sign that a rename happened halfway: the file got new content but the original name. **Detection:** scan for files whose name doesn't contain any exported symbol. **Resolution:** if the file's still alive, rename it; if dead, delete it (these are usually dead — a rename-stuck file rarely is the canonical for any consumer).

## What remains

- **Wave 4** — Dead API exports + reachability bombs + half-shipped seams (≈6 findings)
- **Wave 5** — Cross-cutting duplicate primitives (≈6 findings)
- **Wave 6** — Dead barrels + misnamed files + boundary blur (≈7 findings)
- **Wave 7** — i18n leaks + naming/structure cleanup (≈6 findings, optional)
