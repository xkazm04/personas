# Fleet Control — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. One misclick hard-kills a live Claude session — no confirmation anywhere in the grid path
- **Severity**: High
- **Category**: bug
- **File**: src/features/plugins/fleet/FleetOverlayTile.tsx:75-85 (also src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:318-324, src/features/plugins/fleet/FleetSessionCard.tsx:87)
- **Scenario**: If the user aims for the Insights toggle on a tile header (a 12px icon directly adjacent to the trash icon) and lands one icon to the right, `onKill` fires immediately: `handleKill` → `killSession(id)` → Rust `close_pty_handles` hard-kills the `claude` child. No confirm, no undo. The same unguarded path exists on the session card's close button for live sessions.
- **Root cause**: The design assumes kill is a low-stakes tile operation, but the codebase itself contradicts this — the Settings process scanner routes the *same* kill through a ConfirmDialog warning "Any unsaved work in that session is lost" (FleetProcessScanner.tsx:153-160). The grid, the primary operating surface, skips the guard entirely.
- **Impact**: Irrecoverable loss of an in-flight agent session (uncommitted work, un-checkpointed conversation turn) from a single misclick on the densest click target in the UI. Hibernated sessions can be resumed; killed interactive sessions cannot (only via manual `--resume` archaeology).
- **Fix sketch**: Reuse the existing ConfirmDialog (as in FleetProcessScanner) for kills of sessions in `running`/`awaiting_input` state, or make the tile trash icon a two-step press (click → turns red "confirm?" → click again). Exited/idle sessions can keep one-click removal.

## 2. Broadcast target list includes hibernated/spawning sessions that can never receive input
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:63-66
- **Scenario**: If the user has 3 running sessions and 2 hibernated ones and clicks "All" then Send, the broadcast reports "Sent to 3 of 5 sessions — 2 failed" (amber warning) every single time. `targetable` filters only `state !== 'exited'`, so `hibernated` (process killed, PTY writer dropped) and `spawning` sessions are selectable targets.
- **Root cause**: The filter assumes "not exited" ⇒ "can accept stdin". Hibernated sessions have no live writer — Rust `write_input` returns `Err("session writer dropped")` (src-tauri/src/commands/fleet/registry.rs:469-471) — and the prune effect (lines 73-85) never removes them because they remain non-exited, so the failure repeats on every send.
- **Impact**: Persistent false partial-failure toasts train the operator to ignore the one signal the feature exists to give ("did my fleet-wide command land?"); the "N targets" counter always overstates the real audience; a "Waiting"/"All" broadcast silently never reaches hibernated sessions the user may believe were woken by it.
- **Fix sketch**: Exclude `hibernated` and `spawning` from `targetable` (or render them disabled with a "sleeping — wake first" hint). Optionally auto-wake selected hibernated sessions before writing.

## 3. Total broadcast failure destroys the composed message and closes the modal
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:126-132
- **Scenario**: If the user composes a careful multi-line fleet prompt and every write fails (e.g. all targets raced to exit, or the backend hiccups), `handleSend` shows the red "Broadcast failed — 0 of N delivered" toast, then unconditionally runs `setText(''); onClose()` — the message is erased and the modal dismissed in the same instant the failure is announced.
- **Root cause**: The post-send cleanup assumes send ⇒ delivered. The code even documents the composer's persist-across-open-close contract ("the composer persists ... until a send clears it"), but "a send" here includes a send that delivered nothing.
- **Impact**: The user's typed work is lost exactly when they need to retry it; recovering means reopening the modal, re-selecting targets, and retyping the whole prompt from memory — while the error toast has already expired.
- **Fix sketch**: On `sent === 0`, keep the modal open with text and selection intact (just `setSending(false)`); only clear + close on full or partial success. One-line reorder of the tail of `handleSend`.

## 4. Auto-fire re-check verifies against the *last wake's* screen hash, not the screen the pending decision was made on
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:450-466 (signature written at 310-313)
- **Scenario**: (a) Athena is woken on session S; her `fleet_send_input` sits pending (e.g. awaiting the autonomy gate). >60s later the throttle admits a second wake for S on a *new* screen, which overwrites the single per-session slot in `decision_signatures`. When the first decision finally applies, `screen_matches_last_decision` compares the current screen to wake #2's hash — matches — and returns `Some(true)`, so a decision reasoned on the *old* prompt types into the *new* one. (b) The documented empty-first-render case (line 493: "the PTY ring hadn't captured the alt-screen TUI yet") records `hash("")`; if S later exits, `render_screen_for` yields `None → ""` and the re-check again reports "unchanged — safe to auto-fire".
- **Root cause**: The safety check keys the verification hash by session id only (one mutable slot), assuming at most one in-flight decision per session and that a recorded hash always represents a real rendered screen. Both assumptions break at the 60s throttle boundary and on empty renders.
- **Impact**: The Phase 2.4 guard — the thing standing between an uncalibrated self-reported confidence and keystrokes typed into a live CLI — can green-light a stale decision against the wrong prompt (answering "2" to a different question than the one Athena read).
- **Fix sketch**: Stamp the screen hash *into the proposed action* at wake time and have the executor compare against that immutable value instead of the shared map; additionally treat an empty `screen_text` on either side as `Some(false)` (never "verified unchanged").

## 5. Broadcast target rows are indistinguishable for same-project sessions
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:214
- **Scenario**: If the user runs three sessions in one project (explicitly supported — src/api/fleet/fleet.ts:22-24: "Multiple sessions per cwd are allowed") and opens the broadcast modal to target just one of them, all three rows render an identical `projectLabel` with only a status dot to differentiate — no name, no title.
- **Root cause**: The row label uses `s.projectLabel` alone, while every other fleet surface (e.g. FleetOverlayTile.tsx:54) resolves `s.name ?? s.title ?? s.projectLabel`, so a user-assigned session name that disambiguates tiles is dropped exactly where a wrong pick sends input into the wrong agent's stdin.
- **Impact**: Targeted (non-All) broadcasts to same-cwd fleets become a guessing game; a prompt lands in the wrong session and derails its run — the failure is silent because the write succeeds.
- **Fix sketch**: Use the same `name ?? title ?? projectLabel` fallback chain as the tile header, with `projectLabel` as a secondary dimmed suffix when a name/title exists.
