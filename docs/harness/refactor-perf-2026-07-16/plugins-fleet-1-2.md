# plugins/fleet [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. Dead tile-preview subsystem: useFleetTilePreviews + FleetTilePreview + terminalPreviews API have zero callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/fleet/useFleetTilePreviews.ts:27
- **Scenario**: The grid overlay's render policy moved to "live terminal for focused/awaiting tiles, cheap `FleetTileStatusBlock` for the rest" (see FleetTerminalOverlay.tsx:97-102). The polled-preview lane that predates it is now unreachable: grep across `src/` shows `useFleetTilePreviews` is exported but never imported, `FleetTilePreview` (FleetTilePreview.tsx, companion file outside this context slice) is exported but never imported, and the `terminalPreviews` wrapper in src/api/fleet/fleet.ts:75 is only called by the dead hook.
- **Root cause**: The status-block redesign replaced the batch-preview rendering path but the old hook/component/API wrapper were left behind.
- **Impact**: ~180 LOC of maintained-looking but unreachable code, including a polling loop with visibility handling and rev-diff logic that a reader will assume is live; it also keeps the Rust `fleet_terminal_previews` command looking used from the TS side. Verification needed only for the Rust command before removing it too (frontend side is confirmed orphaned).
- **Fix sketch**: Delete `useFleetTilePreviews.ts` and `FleetTilePreview.tsx`, remove the `terminalPreviews` export from `src/api/fleet/fleet.ts`, and (after checking src-tauri for other invokers) retire the backend preview-cook command. If the preview lane is intended to return (e.g. for the mobile companion), park the design note in a doc instead of live code.

## 2. Session-state palette (color + label per FleetSessionState) is duplicated in 5 files and can drift
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/fleet/FleetSummaryPills.tsx:18
- **Scenario**: Adding a state (as `hibernated` was) or re-tuning a state color requires touching five hand-maintained tables: `GROUP_ORDER` (sub_grid/FleetGridPage.tsx:63), `STATE_META` (FleetSummaryPills.tsx:18), `GLANCE_STATES` (FleetMobilePreview.tsx:18), `STATE_BAR` (FleetStateSparkline.tsx:17), `STATE_VIS` (FleetTileStatusBlock.tsx:23) — plus the axis palettes in FleetStatusDots.tsx. They already disagree subtly: FleetMobilePreview's `GLANCE_STATES` omits `hibernated` entirely (indigo pills the desktop shows never appear in the phone preview even though its counts record includes the state), and exited is `bg-zinc-500` in pills/preview but `text-foreground` accent in the grid header.
- **Root cause**: Each surface re-declared its own `state → {tailwind color, labelKey, icon}` map instead of extending the exported single source (`CONSOLE_DOT`/`BUSINESS_DOT` pattern that FleetStatusLegend already reuses).
- **Impact**: Real maintenance hazard — the file headers explicitly promise the palettes "can never drift", but four of the five copies aren't wired to any shared source, and one has already drifted (missing hibernated in the mobile glance).
- **Fix sketch**: Add one `FLEET_STATE_META: Record<FleetSessionState, { dot: string; text: string; labelKey: FleetLabelKey; icon?: LucideIcon }>` (natural home: FleetStatusDots.tsx or a new fleetStatePalette.ts) with the canonical display order as an exported array. Derive `GROUP_ORDER`, `STATE_META`, `GLANCE_STATES`, `STATE_BAR`, and `STATE_VIS` from it (each keeps only its surface-specific overrides, e.g. the icon-less `running` tile).

## 3. FleetOverlayTile is not memoized — every fleet store patch re-renders the whole open grid
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/fleet/FleetOverlayTile.tsx:37
- **Scenario**: With the fullscreen grid open over 10–16 sessions, every `FLEET_SESSION_STATE` / activity event patches one session; `fleetPatchSession` deliberately preserves the identity of untouched session objects, but `liveSessions` (a fresh filtered+sorted array) re-renders `FleetTerminalOverlay`, and since `FleetOverlayTile` is a plain function component, all N tiles re-render — headers, `FleetTileStatusBlock` (with `useNowTick`), `FleetTileAthenaBar`, and any mounted `FleetSessionInsights` subtree — for a change to one tile.
- **Root cause**: The left-column path invests heavily in this exact optimization (`FleetSessionCard` is `memo`'d with an explicit comparator, and FleetGridPage's docblock calls it out as the scaling mechanism), but the grid-overlay tile — the surface that exists precisely for high session counts — never got the same treatment.
- **Impact**: Measurable render churn on the hottest surface: hook events arrive per-turn per-session, so a busy 16-session fleet re-renders ~16 tiles many times a minute while the overlay is open. Terminals themselves live outside React (managed holders) so this is DOM/VDOM cost, not xterm cost — real waste, not breakage.
- **Fix sketch**: Wrap `FleetOverlayTile` in `React.memo`. Its props are already memo-friendly except `approvals` (a fresh array from `approvalsForSession` per render) — either compare it shallowly in a custom comparator or move the `approvalsForSession` filtering inside the tile (pass the raw `approvals` array, which only changes identity when approvals actually change). All callbacks passed from FleetGridPage are already `useCallback`-stable.

## 4. Dead exports: FleetStatusLegend component and FleetPhaseBanner (with a stale "still imported" comment)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/fleet/FleetStatusLegend.tsx:27
- **Scenario**: Grep across `src/` finds no importer of `FleetStatusLegend` (the overlay uses the distinct `FleetAttentionLegend` instead). Likewise `FleetPhaseBanner` (FleetPage.tsx:102) has zero importers, yet its comment claims "Retained for the three sub_*/page modules that still import it" — those imports were removed and the comment is now actively misleading.
- **Root cause**: The status-dots legend was superseded by the attention legend in the overlay, and the phase-banner consumers were fully built out; neither export was cleaned up afterwards.
- **Impact**: ~110 LOC of unreferenced UI plus a false comment that tells a maintainer the code is load-bearing when it isn't.
- **Fix sketch**: Delete `FleetStatusLegend.tsx` and the `FleetPhaseBanner` export at the bottom of `FleetPage.tsx` (including its now-unused `ContentBox/ContentHeader/ContentBody`/`debtText` imports there if nothing else uses them). If a dots legend is still wanted somewhere, resurrect it wired to the shared palette from finding #2.

## 5. Broadcast sends to N sessions serially — one awaited IPC round-trip per target
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: serial-io
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:108
- **Scenario**: `handleSend` loops `for (const sid of selected) { await writeInput(sid, payload) }`. Broadcasting to a 16-session fleet performs 16 sequential Tauri invokes; if one target's PTY write stalls (dead/wedged process before the backend errors), every later session waits behind it and the modal shows "Sending…" for the sum of all latencies.
- **Root cause**: Sequential awaiting where the writes are independent — per-session failures are already tracked individually, so nothing requires ordering.
- **Impact**: Bounded (IPC is normally milliseconds), but the worst case is user-visible: the flagship "did my fleet-wide command land?" gesture is gated on the slowest target instead of running in parallel.
- **Fix sketch**: `const results = await Promise.allSettled([...selected].map((sid) => writeInput(sid, payload)))` and count `rejected` results for the `failed` tally. Toast logic stays identical.
