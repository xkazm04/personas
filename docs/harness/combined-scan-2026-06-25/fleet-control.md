# Fleet Control — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: fleet-control | Group: Teams & Fleet Orchestration
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. Companion bridge silently no-ops — its only data source is refreshed solely by the Fleet page
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: fleet-companion bridge desync / silent failure
- **File**: src/features/plugins/companion/useFleetCompanionBridge.ts:42-55 (and :74-75, :96-98)
- **Scenario**: App starts. The user is on Chat / Personas / anywhere except the Fleet tab. Installed Claude Code hooks (or `claude` started externally) drive `FLEET_SESSION_STATE` / `FLEET_REGISTRY_CHANGED` / `FLEET_SESSION_EXITED` events for live sessions. The bridge's `findSession(id)` (line 42) resolves against `useSystemStore.fleetSessions`, which is still `[]` because nothing has called `fleetRefresh()` yet. Every handler hits its `if (!sess) return` guard (lines 55, 75, 98) and records nothing. Athena's brain never learns the fleet exists until the user manually opens the Fleet tab once. After the user leaves the Fleet tab, the store keeps a stale snapshot (no further patches) and any *newly* spawned session is invisible to the bridge again.
- **Root cause**: `fleetSessions` is a passive cache (`fleetSlice.ts`) populated ONLY by `FleetGridPage` (mount `refresh()` at sub_grid/FleetGridPage.tsx:175 + its event listeners, which are torn down on unmount) and `FleetBroadcastModal` (`fleetRefresh()` on open, line 60). The bridge is mounted at PersonasPage root (`PersonasPage.tsx:76`) and is documented as always-on, but it neither calls `fleetRefresh()` nor subscribes to keep the store fresh — and the fleet events themselves carry only `{session_id, state, reason}`, not the `projectLabel`/`cwd`/`claudeSessionId` the Rust `companion_record_fleet_event` requires, so the bridge is hard-coupled to a store nobody keeps current. The slice author even comments "No-op when no fleet sessions exist" at `PersonasPage.tsx:75`, treating the empty-store no-op as expected.
- **Impact**: The entire fleet→brain episodic-memory integration (the context's "bridge fleet to the companion") silently does nothing for all sessions until the Fleet tab is opened, and goes stale for sessions spawned after navigating away. Athena reasons about the fleet with missing/stale data and the synthesized exit work-logs are never written. No error, no toast — a pure silent gap.
- **Fix sketch**: Mount the bridge with its own `fleetRefresh()` on mount AND attach a lightweight always-on `FLEET_REGISTRY_CHANGED`→`fleetRefresh()` subscription at the root (independent of the Fleet page), OR make the Rust events carry the full session metadata so the bridge no longer needs the store. Drop the "no-op when empty" assumption.
- **Value**: impact=8 effort=4

## 2. Broadcast offers hibernated sessions as targets, but every write to them is guaranteed to fail
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: command delivery silently failing / misleading feedback
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:63-66
- **Scenario**: Auto-hibernate (or a manual sleep) has put one or more sessions into `hibernated`. The operator opens Broadcast, clicks "All", types a command, and sends. The hibernated sessions are in the target list and selected. Each `writeInput` to a hibernated session rejects, so a fleet of 3 live + 2 hibernated yields the amber "Sent to 3 of 5 sessions — 2 failed", or if all targets are hibernated, the red "Broadcast failed — 0 of 5 delivered" — even though every *live* session received the command.
- **Root cause**: `targetable = sessions.filter((s) => s.state !== 'exited')` excludes only `exited`, so `hibernated` sessions appear in the list, are counted in `Targets (N/M)`, and are swept up by `selectAll`. A hibernated session has had its PTY writer dropped (`registry.hibernate` → close handles), so `registry.write_input` returns `Err("session writer dropped")` (registry.rs:410-412) every time. The grid's own Broadcast-button disable check already excludes both states (`sub_grid/FleetGridPage.tsx:633` filters `!== 'exited' && !== 'hibernated'`), so the modal's narrower filter is an inconsistency, not intent.
- **Impact**: Corrupts the feature's single most important signal — "did my fleet-wide command land?" — turning a fully successful broadcast into a scary amber/red "partial failure", and wastes guaranteed-failing IPC writes.
- **Fix sketch**: Change the filter to `(s) => s.state !== 'exited' && s.state !== 'hibernated'` (mirror the grid button). Hibernated sessions have no PTY to type into; resume is the only path.
- **Value**: impact=5 effort=2

## 3. Spawn-episode recording hinges on a fixed 250 ms timer with no retry — lost under load
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / silent failure
- **File**: src/features/plugins/companion/useFleetCompanionBridge.ts:95-110
- **Scenario**: A new session is added. `FLEET_REGISTRY_CHANGED {kind:'added'}` fires; the bridge waits exactly `setTimeout(..., 250)` for the store slice to refresh, then calls `findSession`. The refresh it is waiting on is `FleetGridPage`'s `actionsRef.current.refresh()`, which round-trips `fleet_list_sessions` — and that command also does a filesystem read of `~/.claude/settings.json` on every call (`commands.rs:226-229`, `check_hooks`). On a slow disk or with many concurrent spawns, that round trip exceeds 250 ms, `findSession` still returns `undefined`, and the handler returns. There is no retry and no fallback, so the `spawned` episode is permanently lost.
- **Root cause**: A hard-coded latency guess (250 ms) is used to paper over the fact that the bridge has no session metadata of its own and must wait for an unrelated component's IPC refresh to land first. (Compounds Finding 1: if the Fleet page isn't even mounted, no refresh is in flight at all and the timer always misses.)
- **Impact**: Spawn events — including the `athenaOwned` recursion-guard flag — are dropped non-deterministically; Athena's brain misses that a session was started. Silent.
- **Fix sketch**: Replace the fixed timeout with a bounded retry/poll (e.g. re-check on the next `fleetSessions` change, or retry a few times up to ~2 s), or carry session metadata in the event payload so no store lookup is needed.
- **Value**: impact=5 effort=3

## 4. Every state transition writes a brain episode; the "volume is low" assumption is false for the awaiting↔running bounce
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented invariant / unbounded growth
- **File**: src/features/plugins/companion/useFleetCompanionBridge.ts:51-68 (Rust side: src-tauri/src/commands/companion/fleet_bridge.rs:159, contract at :20-22)
- **Scenario**: Claude Code is known to fire its idle "waiting for input" Notification during long tool waits / model-latency gaps, falsely flipping a working session to `awaiting_input`; the next tool call corrects it back to `running` (this is exactly why `registry.revive_to_running_on_activity` exists, registry.rs:493). A single long autonomous session can therefore bounce `running`↔`awaiting_input` many times. The bridge records a System episode on every `FLEET_SESSION_STATE` (no de-dup, no throttle), so each bounce appends another episode to Athena's brain.
- **Root cause**: `fleet_bridge.rs` documents "Volume is low (state transitions happen on hook events, capped by Claude Code's hook firing rate)" — but the Notification hook is the noisiest one and false-bounces are common enough that the codebase added a corrector for them. The bridge writes unconditionally where the orchestration path is carefully throttled (`ATTENTION_MIN_INTERVAL_MS`, decision-signature de-dup).
- **Impact**: Unbounded episodic-memory growth and brain pollution from redundant `state_changed` episodes on a single flapping session; retrieval quality and DB size degrade over a long run. Not a crash, but a slow silent bloat that contradicts the stated invariant.
- **Fix sketch**: De-dup at the bridge (skip if the new state equals `lastState.get(id)`), or throttle/coalesce `state_changed` episode writes per session as the orchestration path already does. At minimum, correct the "volume is low" comment to reflect the bounce reality.
- **Value**: impact=4 effort=4

## 5. The cooked tile-preview tier is fully built but wired to nothing — the context's "preview" capability is absent (and dead-session-stale if revived)
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: dead code / unmet capability / latent dead-session read
- **File**: src/features/plugins/fleet/FleetTilePreview.tsx (whole file) + src/features/plugins/fleet/useFleetTilePreviews.ts + src-tauri/src/commands/fleet/commands.rs:86 (`fleet_terminal_previews`)
- **Scenario**: The context is described as "broadcast, **preview**, and bridge", and `FleetTilePreview.tsx` is a named context file. But neither `FleetTilePreview` (the component) nor `useFleetTilePreviews` (the hook) is imported anywhere — the grep for their imports returns nothing, and `terminalPreviews` (the IPC wrapper) is consumed only by the orphaned hook. The grid's unwatched tiles actually render `FleetTileStatusBlock` (state label + heartbeat, no terminal content). So the entire change-gated preview pipeline — frontend hook, component, and the `fleet_terminal_previews` Rust command + `registry.preview_outputs` — is dead weight.
- **Root cause**: The preview tier appears to have been superseded by the status-block design (`FleetTileStatusBlock`'s comment argues dropping live output "blinds nobody" because Athena watches the backend), but the old tier was never removed or rewired. If it WERE rewired as-is, it would also read dead sessions: an exited/hibernated session stays in the Rust map until `fleet_remove_session`, its ring `rev` stops changing so `preview_outputs` (registry.rs:594) keeps it eligible, the change-gate then omits it, and `useFleetTilePreviews` (lines 75-96) keeps showing its frozen final frame with no "exited" indicator.
- **Impact**: Operators get no glanceable terminal preview on unwatched tiles (only "Working · 3m ago"), so the advertised "preview" capability is unmet; meanwhile ~3 modules + one Tauri command are maintained but unreachable. Low live impact today, but a real spec-vs-reality ambiguity and a maintenance trap.
- **Fix sketch**: Decide and document one of: (a) delete the preview tier (component, hook, `fleet_terminal_previews`, `preview_outputs`) as superseded by status blocks; or (b) wire `useFleetTilePreviews` into the grid's non-live tiles AND add a terminal/exited guard so a dead session shows an "exited" state instead of a stale frame.
- **Value**: impact=4 effort=3
