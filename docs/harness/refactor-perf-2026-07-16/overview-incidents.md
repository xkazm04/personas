# overview/incidents — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 15 | Missing: 0

## 1. Unstable `actions` + `focusedId` dependency re-render every incident row on every keypress
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_incidents/components/IncidentsInbox.tsx:131 (also :365-380, libs/useIncidentActions.ts:24)
- **Scenario**: During keyboard triage (j/k over the default 100-row inbox), every keypress changes `focusedId` and `announcement`, which re-renders IncidentsInbox and — because `renderRow` depends on `focusedId` and `IncidentRow` is not memoized — re-renders all ~100 grid rows (each with 4+ lucide icons, `severityBadgeClass`, `isStaleIncident` Date math) plus every group header.
- **Root cause**: Three compounding issues: (a) `onAfterChange` is passed as an inline async arrow (IncidentsInbox.tsx:132), so `useIncidentActions`'s careful `useCallback` chain is defeated — `actions` gets a new identity every render; (b) `renderRow` lists `focusedId` in its deps, so moving the cursor invalidates it; (c) `IncidentRow` has no `React.memo`, so even a stable `renderRow` wouldn't stop child re-renders.
- **Impact**: O(rows) wasted render work per keystroke on the feature's flagship interaction (keyboard triage). At 100 rows it is measurable jank on modest hardware; also fires on every 30s poll tick when the interval refresh replaces the `incidents` array.
- **Fix sketch**: Wrap `onAfterChange` in `useCallback` (it only touches `refresh` and a ref). Memoize `IncidentRow` with `React.memo` and pass `focused` as the only per-row-varying prop; drop `focusedId` from `renderRow`'s deps by passing `focusedId` down to `IncidentAgentGroup`/row map instead of baking it into the closure, or compute `focused={focusedId === incident.id}` at the map site with a memoized row component so only the two affected rows re-render.

## 2. The "resting open-only filter" object and "isNarrowed" logic are triplicated across three components
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_incidents/components/IncidentsInbox.tsx:28 (also IncidentsFilterBar.tsx:29-35,88-94; IncidentsInboxKpiHeader.tsx:17-19; IncidentsInbox.tsx:386-393)
- **Scenario**: A future change to the default view (e.g. defaulting to `open`+`acknowledged`) must be applied in three files: `DEFAULT_FILTERS` (Inbox), `OPEN_ONLY_FILTERS` (FilterBar), and `OPEN_FILTERS` (KpiHeader) — plus two independently-written "isNarrowed" computations (FilterBar:88-94 vs Inbox:386-393) that already differ subtly (FilterBar treats `statuses: null` via `?.length === 1` short-circuit, Inbox explicitly allows `!filters.statuses` as default).
- **Root cause**: Each component re-declares the resting-state constant and re-derives "has the user narrowed past it" instead of importing one shared definition.
- **Impact**: Silent drift hazard on a user-visible behavior (inbox-zero celebration vs "no match" empty state, Clear-filters visibility, KPI tile active-state). The two isNarrowed variants can already disagree for `statuses: null`.
- **Fix sketch**: Add `libs/incidentFilterDefaults.ts` exporting `OPEN_ONLY_FILTERS` and `isNarrowedFrom(filters): boolean`; import it in all three components and delete the local copies. `filtersMatch`/`arrEq` in the KPI header can live there too.

## 3. `relativeTime` / `humanizeKey` re-implement formatters that already exist elsewhere in the app
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_incidents/libs/incidentTaxonomy.ts:149 (also libs/incidentDetail.ts:47)
- **Scenario**: `relativeTime(t, iso)` (used once, for the sibling list in IncidentDetailModal:265) is the third hand-rolled relative-time formatter in the codebase — `dev-tools/sub_scanner/ideaScannerHelpers.ts:54` and `dev-tools/sub_overview/ProjectOverviewPage.tsx:678` carry near-identical copies, and the shared `RelativeTime` component (used two lines away in the same modal) already renders live-ticking relative times. `humanizeKey` in incidentDetail.ts:47 likewise duplicates `teams/sub_collab/payloadView.ts:72`.
- **Root cause**: Feature-local utility written instead of reusing/extending the shared display primitive; each copy has slightly different truncation rules ("just now" vs "0m", i18n vs none).
- **Impact**: Inconsistent timestamp wording across surfaces and 4 places to touch for any locale/formatting change. Pure maintenance cost — no runtime effect.
- **Fix sketch**: Use the shared `<RelativeTime>` component for the sibling rows (it is already imported in IncidentDetailModal) and delete `incidentTaxonomy.relativeTime`; if a plain-string variant is genuinely needed, host one canonical `formatRelativeTime` next to `RelativeTime.tsx` and point the two dev-tools copies at it in a follow-up. Move `humanizeKey` to a shared `lib/utils` module reused by both incidents and teams payload views (verify no signature drift first).

## 4. 30s polling interval keeps hitting the backend while the window is hidden
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: polling-waste
- **File**: src/features/overview/sub_incidents/libs/useIncidentsData.ts:60-66
- **Scenario**: With the incidents tab mounted and the Tauri window minimized or in the background for hours, the hook still fires `listAuditIncidents` + `getAuditIncidentsSummary` (two IPC round-trips into rusqlite) every 30 seconds, re-setting state and re-rendering the whole inbox tree (compounded by finding #1) for a screen nobody is looking at.
- **Root cause**: `setInterval` runs unconditionally; there is no `document.visibilityState` / window-focus gate.
- **Impact**: Bounded but continuous background CPU + DB churn in a desktop app that users leave running; battery-relevant on laptops. Not user-visible breakage.
- **Fix sketch**: Skip the tick when `document.visibilityState === 'hidden'` (and do one immediate refresh on the `visibilitychange` → visible transition so the inbox is fresh when the user returns). A tiny shared `usePolling(fn, ms, { pauseWhenHidden: true })` would also serve the other 30s pollers in the app.

## 5. Time-range dropdown reuses the "All time" option string as its column label
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/overview/sub_incidents/components/IncidentsFilterBar.tsx:111
- **Scenario**: The third `ColumnDropdownFilter` is labelled `t.overview.incidents.range_all_time` — the same string as its "All time" option — while the severity and source dropdowns use dedicated `filter_*_label` tokens. When a range is active the control's label still reads "All time", which is misleading copy.
- **Root cause**: Copy-paste of the option token into the `label` prop instead of adding a `filter_range_label` (or `filter_time_label`) translation key.
- **Impact**: Minor user-visible mislabel and an i18n key doing double duty; trivial to fix.
- **Fix sketch**: Add `overview.incidents.filter_time_label` to the translation catalogs and pass it as the `label`; keep `range_all_time` for the option only.
