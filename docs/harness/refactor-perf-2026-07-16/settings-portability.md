# settings/portability — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: App Shell, Settings & Sharing | Files read: 13 | Missing: 0

## 1. `handleExportFull` (and the `exportFull` API wrapper) is dead frontend code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/settings/sub_portability/libs/useDataPortability.ts:71
- **Scenario**: `handleExportFull` is defined in the hook and returned at line 240, but no component consumes it — `DataPortabilitySettings` wires only `handleExportSelective` (the modal's ExportButton is the sole export path). Grep across `src/` shows `exportFull` is imported only by this hook.
- **Root cause**: The "export everything" one-click path was superseded by the ExportSelectionModal (which pre-selects everything and offers "Select everything"), but the old handler and its API wrapper were left behind.
- **Impact**: ~15 lines of dead handler + an unused IPC wrapper (`api/system/dataPortability.ts:16`) that must be kept mentally in sync with the selective path; readers wonder which path is live.
- **Fix sketch**: Delete `handleExportFull` from the hook and its return object, remove the `exportFull` import; delete the `exportFull` wrapper in `src/api/system/dataPortability.ts` if no other caller exists (grep confirmed none in src/; verify no test references). The Rust `export_full` command can stay or be flagged separately.

## 2. Sixth private copy of `formatBytes` — an exported shared one already exists
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_portability/components/StorageUsageSection.tsx:10
- **Scenario**: This file defines a private `formatBytes`; near-identical copies also live in `sub_network/NetworkDashboard.tsx:54`, `sub_network/BundleExportDialog.tsx:515`, `overview/health/LogDiskUsageSection.tsx:7`, `plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx:20`, while `features/vault/shared/vector/tabs/documentTabHelpers.ts:6` already exports one.
- **Root cause**: No shared byte-formatting utility in `lib/` or `features/shared/`, so each surface re-rolls it — with drifting signatures (this one takes `number`, LogDiskUsageSection accepts `number | bigint`) and drifting precision rules.
- **Impact**: Six implementations to keep consistent; byte displays can already disagree across screens (KB thresholds/decimals). Classic maintenance hazard, zero-risk consolidation.
- **Fix sketch**: Add `formatBytes(bytes: number | bigint)` to a shared module (e.g. `src/lib/formatBytes.ts` or next to `Numeric` in shared/display), pick the most permissive signature, and replace the six local copies. Pure function — trivially unit-testable.

## 3. Passphrase-reveal inline flow triplicated across export/import buttons
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_portability/components/CredentialPortability.tsx:80
- **Scenario**: The "button → swap to PasswordToggleField + action button + cancel" block appears three times with only color/label/status props differing: cred export (lines 81–114), cred import (lines 117–150), and workspace import in `ExportSection.tsx:76–114`.
- **Root cause**: The pattern grew per-feature; each copy hand-repeats ~35 lines of identical layout, keydown-Enter submit, disabled logic, and cancel-clears-passphrase behavior.
- **Impact**: ~70 duplicated lines; a behavior fix (e.g. clearing passphrase on Escape, min-length hint) must be applied in three places and can drift.
- **Fix sketch**: Extract a small `PassphraseActionField` component in this feature taking `{ triggerLabel, actionLabel, status, accent: 'amber'|'blue', placeholder, value, onChange, onSubmit, show, setShow }` and render it three times. Keep it local to `sub_portability` — no need for a global component.

## 4. `inv` object is re-spread every render, defeating all downstream `useMemo`s
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_portability/components/export-prototype/useExportPicker.ts:241
- **Scenario**: The hook returns `inv: { ...inv, loading: loading || inv.loading }`, creating a fresh object identity on every render. `ExportSelectionModal`'s `shownIds` memo (`ExportSelectionModal.tsx:49`, deps `[scope, q, personaFilter, inv]`) therefore recomputes on every render — including every checkbox toggle and every search keystroke — re-running the full lowercase/filter pass over 100+ personas plus the `shownSet` rebuild.
- **Root cause**: The carefully memoized inventory (`useMemo` at line 92) has its identity discarded at the return boundary by the spread.
- **Impact**: The `useMemo` around `shownIds` is effectively inert; with the stated design target of 100+ personas this is repeated O(n) string work plus Set construction on the hottest interaction (typing in search, toggling rows). Bounded, but pure waste that the code already tried to avoid.
- **Fix sketch**: Fold `loading` into the `inv` memo itself: make the inventory `useMemo` depend on `[raw, loading]` and set `loading: loading || !raw` inside it, then return `inv` directly. Alternatively `useMemo(() => ({ ...inv, loading: loading || inv.loading }), [inv, loading])`.

## 5. Every row re-renders on each selection toggle in a 100+-item picker
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_portability/components/export-prototype/rows.tsx:21
- **Scenario**: Clicking one checkbox in the modal updates a selection Set, which re-renders `ExportSelectionModal`; `PersonaPickRow`/`TeamPickRow`/`CredentialRow` are not memoized and receive fresh inline `onToggle` closures (`ExportSelectionModal.tsx:196`), so all visible rows (design target: 100+ personas, each with `PersonaIcon` + several `StatChip`s + `useTranslation`) re-render per click. "Select filtered" over a large list amplifies this.
- **Root cause**: Rows lack `React.memo`; even with it, `onToggle={() => picker.toggle(...)}` and the `isSelected` callback (whose `setFor` dep changes with every one of the three Sets, `useExportPicker.ts:171-179`) would break memoization.
- **Impact**: Per-click render cost scales linearly with inventory size on an interaction users repeat dozens of times while hand-picking; no virtualization means the whole list pays it.
- **Fix sketch**: Wrap the three row components in `React.memo`, pass stable primitives (`selected` boolean, `id`) and a stable `onToggle(kind, id)` reference (`picker.toggle` is already `useCallback`-stable — call it directly with args inside a memoized row via `useCallback` or by passing `toggle` + `id` down). If lists commonly exceed a few hundred, consider windowing the scroll area, but memoization alone removes most of the cost.

## 6. N+1 IPC calls for team members on every modal open
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/settings/sub_portability/components/export-prototype/useExportPicker.ts:70
- **Scenario**: Opening the export modal fires `listTeamMembers(t.id)` once per team — N separate Tauri `invoke` round-trips, each running its own SQLite query — after the initial 4-call batch. Runs on every open (no caching), so a workspace with 30 teams issues ~34 IPC calls before the picker renders.
- **Root cause**: There is no batched "list all team members" command; the frontend fans out per-team because `list_team_members` is the only available shape.
- **Impact**: Calls are parallelized so wall-clock cost is modest today; it is bounded per-open, hence Low — but it adds IPC/serde overhead proportional to team count and delays `loading=false` for the whole modal until the slowest call returns.
- **Fix sketch**: Add a Rust command `list_all_team_members()` returning `(team_id, persona_id)` pairs from one `SELECT team_id, persona_id FROM persona_team_members` query, and build `memberMap` from it in one call. Other N+1 callers (e.g. TeamList badge counts) could reuse it.
