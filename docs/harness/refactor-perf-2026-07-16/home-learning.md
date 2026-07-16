# home/learning — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 1 medium / 3 low)
> Context group: App Shell, Settings & Sharing | Files read: 9 | Missing: 0

## 1. Power-move detection refetches ALL triggers on every Learning-hub mount

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-ipc
- **File**: src/features/home/sub_learning/powerMoves/powerMovesStore.ts:33 (probe at powerMoves/registry.ts:133)
- **Scenario**: Any user who has not yet earned the `event-chain` move (i.e. has no `event_listener` trigger — likely most users) pays a `list_all_triggers` Tauri IPC round-trip fetching the full trigger list of every persona, every time they open the Learning tab. The "steady state is zero IPC" comment only holds after the move is earned; the common negative case re-probes forever.
- **Root cause**: `usePowerMoveDetection` skips probes only when `done[move.id]` is set, and a negative probe result is never remembered — not even for the session. The probe also pulls the entire trigger list just to test existence.
- **Impact**: Bounded but recurring waste on a tab users are encouraged to revisit (progress tracker). Cost scales with total trigger count across all personas, serialized in the sequential `for..await` loop as more probes get added.
- **Fix sketch**: Memoize negative results for the session: a module-level `probedThisSession: Set<string>` (or a single in-flight promise) checked alongside `done`, so each probe runs at most once per app run. Optionally add a `has_event_listener_trigger` count query (or `LIMIT 1`) on the Rust side instead of materializing all triggers. Also run probes with `Promise.all` if the registry grows beyond one `detect`.

## 2. Uncancelled sub-tab timeout in launchPowerMove can apply a stale tab over a newer navigation

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/home/sub_learning/powerMoves/launchPowerMove.ts:27
- **Scenario**: User clicks "Try it" on `dead-letter` (events → dead-letter tab), then within ~120ms clicks another move or navigates elsewhere; the fire-and-forget `setTimeout` still fires and force-sets the event-bus/overview/plugin tab, fighting the newer navigation. The timer also fires with no owner if the app state has moved on entirely.
- **Root cause**: The `SUB_TAB_DELAY_MS` timeout id is discarded, so there is exactly one uncancellable pending navigation mutation per launch.
- **Impact**: Rare, self-healing UX glitch (wrong sub-tab selected) rather than a true leak — the timer is one-shot and short. Worth fixing because it is a two-line change on a deep-link path that will gain more nav targets.
- **Fix sketch**: Keep a module-level `pendingTabTimer: number | undefined`; `clearTimeout(pendingTabTimer)` at the top of `launchPowerMove` before scheduling the new one, mirroring how `flashSpotlight` already cancels its `activeFlash` singleton.

## 3. TourDef.icon / TourDef.color are stringly typed — typos silently fall back to Compass/violet

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: type-safety
- **File**: src/features/home/sub_learning/data.ts:7 (contract at src/stores/slices/system/tourSlice.ts:221-222)
- **Scenario**: Someone adds a tour to `TOUR_REGISTRY` with `icon: "Calendar"` (not in `TOUR_ICONS`) or `color: "rose"` (not in `COLORS`); it compiles fine and the card silently renders the generic Compass icon in violet. Nothing flags the drift between the registry strings and the two lookup maps.
- **Root cause**: `TourDef.icon`/`TourDef.color` are declared `string` in tourSlice, while the actual closed vocabularies live in this feature's `TOUR_ICONS`/`COLORS` maps — the contract is enforced only by runtime fallback.
- **Impact**: Maintenance hazard: new tours quietly lose their visual identity; the `?? Compass` / `?? FALLBACK` guards mask the bug so it survives review.
- **Fix sketch**: Define `export type TourIconName = 'Compass' | 'Activity' | ...` and `TourColorKey = 'violet' | 'blue' | ...` next to `TourDef` (or export them from data.ts and import the types into tourSlice — type-only import avoids a runtime cycle), type `TourDef.icon: TourIconName`, `color: TourColorKey`, and key `TOUR_ICONS: Record<TourIconName, ...>` / `COLORS: Record<TourColorKey, ...>` so an unmapped key is a compile error. Keep the runtime fallbacks as defense.

## 4. "Used" predicate (done || tried) duplicated between PowerMoveRow and PowerMovesPanel

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/home/sub_learning/powerMoves/PowerMoveRow.tsx:16 (and PowerMovesPanel.tsx:18)
- **Scenario**: The definition of a move being "used" — `done[id] || tried[id]` — is written independently in the row selector and in the panel's progress count. If the semantics ever change (e.g. detection-only counts as used, or a `dismissed` state is added), one call site will drift from the other and the header count will disagree with the row badges.
- **Root cause**: No shared helper expresses the completion semantics; both components re-derive it from raw store shape.
- **Impact**: Small today (two sites), but this is the core business rule of the feature and the panel/row pair is exactly where a mismatch would be user-visible (progress "3/12" while 4 badges show).
- **Fix sketch**: Export `isMoveUsed(state: PowerMovesState, id: string): boolean` from powerMovesStore.ts and use it in both places: `usePowerMovesStore((s) => isMoveUsed(s, move.id))` and `POWER_MOVES.filter((m) => isMoveUsed(state, m.id)).length` (select `tried`/`done` once in the panel as today).
