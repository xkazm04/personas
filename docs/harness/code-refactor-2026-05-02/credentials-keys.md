# Code Refactor Scan — Credentials & Keys

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~45

## Summary

The credential surface is large (~120 client-side files) and well organised at the seam (slices, API wrappers, FSM, picker host). However, two large feature folders are pure dead-code islands: an entire **provisioning wizard** (`components/wizard/`, plus `provisioningWizardStore`) and an entire **OpenAPI autopilot** flow (`components/autopilot/` + `api/vault/openapiAutopilot.ts`) — neither has a top-level entry point that's still rendered. There's also a third dead island: the inline expandable `CredentialCard` chain (Card → CardHeader/CardDetails/CardBody/CardBadges/SectionContent + `OAuthTokenMetricsPanel`, `CredentialAuditTimeline`, `BulkHealthcheckSummary`, `HealthStatusBar`, `CredentialFilterBar`) was superseded by the `DataGrid`-based `CredentialList` + `CredentialDetailModals` architecture, but the old components were never removed. Beyond that, the live code is mostly clean — no console.logs, no TODOs, no obvious duplicated state — but there's some thin-indirection cruft (`useCredentialRemediation` wrapper, `credentialDesign.ts` barrel) and a divergence where `CredentialList` re-implements filter/sort logic instead of using the perfectly capable `filterAndSortCredentials` helper that its own hook already imports.

## 1. Entire provisioning wizard is dead code

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/components/wizard/` (6 files: ProvisioningWizard.tsx, WizardDetectPhase.tsx, WizardBatchPhase.tsx, WizardDetectGrid.tsx, WizardDetectConnectorRow.tsx, WizardServiceSelect.tsx, BatchHelpers.tsx) and `src/stores/provisioningWizardStore.ts`
- **Scenario**: The `<ProvisioningWizard>` component is never rendered anywhere — project-wide grep finds zero `<ProvisioningWizard` JSX. `useCredentialManagerState.ts:65-70` even has a tell-tale `useEffect` that reactively force-closes the store any time it observes `phase !== 'closed'`, with the explicit comment `// Wizard was removed`. The "AI setup wizard" button in `SidebarLevel2.tsx:177` calls `useProvisioningWizardStore.getState().open(true)` — opening a store nothing reads — so the button is silently a no-op. All 6 wizard files only import each other.
- **Root cause**: The wizard was deprecated in favour of the FSM-driven `add-new` views (`CredentialAddViews.tsx`) but only the renderer side was deleted. The store, components, and the now-orphaned sidebar button survived the cleanup.
- **Impact**: ~7 component files (~600 LOC) ship to the bundle, the empty-state sidebar button is broken (silently opens nothing), and the defensive `useEffect` in `useCredentialManagerState` is permanently fighting a ghost. New contributors keep maintaining wizard code that no user can ever reach.
- **Fix sketch**:
  - Delete `components/wizard/` directory entirely (7 files).
  - Delete `src/stores/provisioningWizardStore.ts`.
  - In `SidebarLevel2.tsx`, replace the wizard button's onClick with a real action (e.g. `navigate('add-new')`) or drop the button.
  - Remove the wizard-close effect at `useCredentialManagerState.ts:65-70`.

## 2. Entire OpenAPI autopilot flow is dead code

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/components/autopilot/` (10 files) and `src/api/vault/openapiAutopilot.ts`
- **Scenario**: `AutopilotPanel.tsx` (the only entry point) is exported but never imported. All 10 files in `components/autopilot/` reference each other only (`AutopilotPanel` → `AutopilotPlayground`/`Header`/`InputStep`/`PreviewStep`/`GeneratedStep`, those → `AutopilotShared` / `PlaygroundOutput` / `PlaygroundRequestBuilder`). Likewise `api/vault/openapiAutopilot.ts` is imported only by `AutopilotPanel.tsx`. No route, sidebar entry, FSM view, or modal launches the autopilot.
- **Root cause**: A self-contained feature (parse OpenAPI spec → generate connector definition) that was wired up internally but never plumbed into a user-facing entry point, or whose entry point was removed.
- **Impact**: ~10 component files + 1 API wrapper, including a non-trivial OpenAPI parser/playground, sit in `dist/` for no benefit. Maintainers spend cycles understanding "how is this reached?" with no answer.
- **Fix sketch**:
  - Delete the entire `components/autopilot/` directory.
  - Delete `src/api/vault/openapiAutopilot.ts`.
  - If the feature is wanted later, recover it from git history rather than maintaining shelf-ware.

## 3. CredentialCard expandable-row chain is superseded but not deleted

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/components/card/` — `CredentialCard.tsx`, `CredentialCardBody.tsx`, `CredentialCardHeader.tsx`, `CredentialCardDetails.tsx`, `CredentialCardBadges.tsx`, `CredentialSectionContent.tsx`, `CredentialTagsRow.tsx`, plus `card/badges/RotationInsightBadge.tsx`, `card/badges/OAuthActivityBadge.tsx`, `card/badges/BadgeOverflowPill.tsx`; and `components/features/OAuthTokenMetricsPanel.tsx`, `CredentialAuditTimeline.tsx`, `AuditTimelineEntries.tsx`, `auditAnomalies.ts`
- **Scenario**: The current credential list view (`list/CredentialList.tsx`) is built on `DataGrid` + `CredentialDetailModals.tsx`, which opens the `CredentialPlaygroundModal` / `SchemaManagerModal` / `VectorKbModal` / `GatewayMembersModal` for the selected row. The older expandable-card UI (`CredentialCard` and its children) is not referenced from any live render path — confirmed by grep. The card chain transitively keeps `OAuthTokenMetricsPanel`, `CredentialAuditTimeline`, `AuditTimelineEntries`, `auditAnomalies`, `CredentialTagsRow`, and the three `card/badges/` files alive only via internal cross-references. Some of these (e.g. `RotationInsightBadge`, `OAuthTokenMetricsPanel`) are rich, multi-hundred-line components.
- **Root cause**: The list UI was migrated from "expand each row to show details" to "click row to open playground modal" but the previous components were not removed.
- **Impact**: ~13 component files, several of them substantial, ship to the bundle. Searches for "where does the playground render token metrics?" or "what badges show on a card?" produce two valid-looking answers, only one of which is wired up. The kept-alive `auditAnomalies.ts` still exposes `detectAnomalies` / `TimelineEntry`, used only by a dead timeline component, suggesting future readers can rebuild a feature on a foundation no live code touches.
- **Fix sketch**:
  - Delete `card/CredentialCard.tsx`, `CredentialCardBody.tsx`, `CredentialCardHeader.tsx`, `CredentialCardDetails.tsx`, `CredentialCardBadges.tsx`, `CredentialSectionContent.tsx`, `CredentialTagsRow.tsx`.
  - Delete `card/badges/RotationInsightBadge.tsx`, `OAuthActivityBadge.tsx`, `BadgeOverflowPill.tsx` (the surviving `CompositeHealthDot.tsx` and `VaultStatusBadge.tsx` are still used elsewhere — keep those).
  - Delete `features/OAuthTokenMetricsPanel.tsx`, `CredentialAuditTimeline.tsx`, `AuditTimelineEntries.tsx`, `auditAnomalies.ts`.
  - Verify `AuditLogTable.tsx`'s `OP_LABELS` still has a live consumer (`CredentialIntelligence` uses it) — keep that file.

## 4. Manager-level health UI is exported but never rendered

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/vault/sub_credentials/manager/HealthStatusBar.tsx`, `BulkHealthcheckSummary.tsx`, and `components/list/CredentialFilterBar.tsx`
- **Scenario**: `HealthStatusBar` (a 150-line component with a custom SVG progress ring) is exported but the only project-wide hit besides its own definition is a comment in `useSimpleSummary.ts` referring to its logic. `BulkHealthcheckSummary` is similarly only self-referenced. `CredentialFilterBar` (filter dropdowns) is exported but never imported — `CredentialList` uses `useCredentialColumns` for header filters instead. Sibling files in `manager/` (e.g. `HeaderActionButtons`, `VaultBreadcrumb`) ARE wired up correctly — these three are the orphans.
- **Root cause**: Predecessor toolbar/filter design replaced by `CredentialToolbar` + `DataGrid` column filters; the old building blocks weren't deleted.
- **Impact**: Three sizeable orphan components live next to actively-used siblings, making it look like there are two competing designs in flight. Bundle bloat plus reader confusion.
- **Fix sketch**:
  - Delete `manager/HealthStatusBar.tsx`.
  - Delete `manager/BulkHealthcheckSummary.tsx`.
  - Delete `components/list/CredentialFilterBar.tsx`.

## 5. CredentialList re-implements filtering instead of using its own hook's helpers

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/vault/sub_credentials/components/list/CredentialList.tsx:36-103` vs `credentialListTypes.ts:49-138`
- **Scenario**: `useCredentialListFilters` (which `CredentialList` uses for `filteredCredentials`/selection) imports `filterAndSortCredentials` and `groupCredentials` from `credentialListTypes.ts` and exposes a richer state surface (`selectedTags`, `healthFilter`, `sortKey`, `grouped`, `allTags`, `toggleTag`, `clearFilters`, `showFilterBar`, `openDropdown`). `CredentialList` ignores most of those and instead declares its own `categoryFilter`, `healthFilter`, `sortKey`, `sortDir` state and a parallel sort/filter pipeline. The two pipelines have already drifted: the hook supports a `'last-used'` sort key and tag filtering, the in-component pipeline doesn't; the in-component pipeline supports a `category` filter the hook doesn't.
- **Root cause**: The list view was rewritten on top of `DataGrid` (which has its own column-level filter API) without unifying with the hook's filter helpers. Both code paths now coexist and slowly drift.
- **Impact**: Two filter implementations to keep in sync, type drift (`SortKey` vs string, `HealthFilter` vs string), and confusion about which is the "blessed" path. `filterAndSortCredentials`, `groupCredentials`, `healthFilterLabel`, `sortLabel` are exported but never reached by the live list view.
- **Fix sketch**:
  - Either: refactor `CredentialList` to use the helpers (`filterAndSortCredentials`/`groupCredentials`) it already has, extending them with the missing `category` axis.
  - Or: shrink `useCredentialListFilters` to just the selection + connector-lookup state it actually provides, and delete `filterAndSortCredentials`/`groupCredentials`/`healthFilterLabel`/`sortLabel`/`HealthFilter`/`SortKey`/`GroupedCredentials` from `credentialListTypes.ts`.

## 6. Three exported helpers in useCredentialHealth are never called

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/vault/shared/hooks/health/useCredentialHealth.ts:236-254`
- **Scenario**: The module exposes `getHealthResult`, `isHealthChecking`, and `resetHealthCache` as public exports for "static" cache access (read without subscribing). Project-wide grep finds zero call sites for any of the three. The sibling `setHealthResultStatic` IS used (by `useBulkHealthcheck`).
- **Root cause**: API surface was speculatively exposed during the module-cache migration ("someone might want to peek without subscribing") but no consumer ever materialised.
- **Impact**: Reader confusion ("when is this cache reset? where?"), and accidental future calls to `resetHealthCache` could clobber an in-flight bulk check.
- **Fix sketch**:
  - Delete `getHealthResult`, `isHealthChecking`, `resetHealthCache` exports.
  - Keep `setHealthResultStatic` (still has a real caller).

## 7. useCredentialRemediation is a no-op wrapper around useRemediationEvaluator

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/vault/shared/hooks/health/useCredentialRemediation.ts`
- **Scenario**: The entire file is a 2-line wrapper: `useCredentialRemediation(): void { useRemediationEvaluator(); }`. It throws away the rich return value of `useRemediationEvaluator` (`lastEvaluation`, `evaluating`, `forceEvaluate`, `eventLog`). The wrapper has exactly one caller (`BackgroundServices.tsx`), which doesn't need the return value either — but going via the wrapper hides the fact that a more useful API exists if we ever wanted a UI for the remediation log.
- **Root cause**: Over-eager "facade per consumer" pattern. The wrapper was justified at first ("name describes the side-effect not the implementation") but is now just an extra import hop with no value.
- **Impact**: Two files where one would do; new readers wonder why the wrapper exists. If anyone ever wanted to surface `eventLog` in the UI, they'd discover the wrapper is in their way.
- **Fix sketch**:
  - Delete `useCredentialRemediation.ts`.
  - In `BackgroundServices.tsx`, swap the import to `useRemediationEvaluator` directly: `useRemediationEvaluator();` (return value still ignored).

## 8. `credentialDesign.ts` barrel is a 4-line back-compat re-export with one rotting consumer

- **Severity**: low
- **Category**: structure
- **File**: `src/api/vault/credentialDesign.ts`
- **Scenario**: The whole file is `export * from "./credentialDesignApi"; export * from "./oauthGatewayApi"; export * from "../overview/healthcheckApi";`. Comment says "Re-export from focused modules for backward compatibility". Only two consumers actually go through this barrel (`useCredentialHealth.ts`, `CatalogCredentialModal.tsx`), and both pull a single symbol — `testCredentialDesignHealthcheck` — which lives in `@/api/overview/healthcheckApi`, not in the same path as the barrel suggests. Most other call sites import `credentialDesignApi` and `oauthGatewayApi` directly.
- **Root cause**: A leftover from a module split. The barrel survived because nobody chased the last two consumers.
- **Impact**: Misleading file path (the barrel called `credentialDesign.ts` re-exports OAuth gateway and overview-healthcheck APIs that have nothing to do with credential design), tiny bundle cost, and a "backward compatibility" promise to nobody.
- **Fix sketch**:
  - Update `useCredentialHealth.ts:3` and `CatalogCredentialModal.tsx:6` to import `testCredentialDesignHealthcheck` / `CredentialDesignHealthcheckResult` from `@/api/overview/healthcheckApi`.
  - Delete `src/api/vault/credentialDesign.ts`.

## 9. `importTypes.ts` filename hides ~270 lines of parser logic

- **Severity**: low
- **Category**: naming
- **File**: `src/features/vault/sub_credentials/components/import/importTypes.ts`
- **Scenario**: The file is named `importTypes.ts` but only ~50 of its ~365 lines are types. The rest is real implementation: `parseEnvFile`, `parse1PasswordOutput`, `parseAwsSecretsOutput`, `parseAzureKeyVaultOutput`, `parseDopplerOutput`, `parseImportInput`, `detectServiceFromKey`, `buildMappings`, `groupByService`, `buildDesignResultFromImport`, plus the `IMPORT_SOURCES` registry and `SERVICE_PATTERNS` table. The convention elsewhere in the project is that `*Types.ts` is types-only.
- **Root cause**: File started as a small types module and accreted parsers as the import flow grew. Nobody renamed it.
- **Impact**: Poor discoverability — a reader looking for "where do we parse 1Password output?" wouldn't search a `Types.ts` file. Inconsistent with the rest of the codebase.
- **Fix sketch**:
  - Rename `importTypes.ts` → `importHelpers.ts` (or split: `importTypes.ts` for types only, `importParsers.ts` for the parsers and registries).
  - Update the 5 importers in `import/index.ts`, `useCredentialImport.ts`.

> Total: 9 findings (4 high, 3 medium, 2 low)
