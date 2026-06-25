# Companion Runtime & Chat — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: companion-runtime-and-chat | Group: Athena Companion
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. "Ask Athena" / External user actions are silently dropped when any turn is in flight
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: lost message / lifecycle
- **File**: src-tauri/src/companion/session.rs:386 (also chat.rs:69)
- **Scenario**: User clicks Fleet's "Ask Athena" (or any surface passing `system_source`) while an autonomous-continuation tick, a proactive turn, or a normal chat turn holds `TURN_LOCK`. `companion_send_message` maps a non-empty `system_source` to `TurnOrigin::External`. In `send_turn`, only `TurnOrigin::User` does `TURN_LOCK.lock().await`; **every other origin — including External — uses `try_lock()`** and, on contention, returns `Err("…background turn skipped")` without ever running.
- **Root cause**: External is a genuinely *user-initiated* origin but is bucketed with background spawners in the lock arm (session.rs:388, `_ => try_lock`). The frontend caller (`companionSendMessage`) typically `silentCatch`es the rejection, so nothing queues and nothing surfaces.
- **Impact**: A user pressing a button gets no reply, no error, no queue entry — the request is lost. Likelihood is real because autonomous mode keeps a 15s-spaced tick chain alive, so "a turn is in flight" is a common state.
- **Fix sketch**: Treat `External` like `User` for locking — `matches!(origin, User | External { .. }) => lock().await`. Or have the External entry point queue/retry instead of `try_lock`, and surface the skip to the user rather than `silentCatch`.
- **Value**: impact=7 effort=2

## 2. Frontend stream listener ignores `sessionId`; Studio web-build turns bleed into the main chat panel
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: streamed-bubble desync / race
- **File**: src/features/plugins/companion/CompanionPanel.tsx:896 (listener body, lines ~901–1102)
- **Scenario**: A web-build (Studio) turn runs. `run_build_turn` (session.rs:1298) does **not** acquire `TURN_LOCK` (only `send_turn` does, session.rs:361), and its `run_cli` emits every CLI line on the shared `STREAM_EVENT = "companion://stream"` channel keyed by `session_id="webbuild:<project_id>"` (session.rs:1595). The main panel's `companion_stream_listen` handler never reads `ev.sessionId` — it processes `cli` events unconditionally: `extractToolEvents`, `appendNarrationEntry`, `setStreamingSteps`, `appendStreamingText`/delta.
- **Root cause**: Missing `if (ev.sessionId !== DEFAULT_SESSION_ID) return;` guard. Because build turns are not serialized against chat turns, the two can also overlap, interleaving build CLI lines into a live chat turn's streaming/narration state.
- **Impact**: Build-turn tool calls and prose pollute the companion panel's narration trail and streaming bubble; when a chat turn streams concurrently the build's text is `appendStreamingText`-ed into it and its `PROGRESS:` lines fire as chat beats. UI/voice desync (DB episodes are unaffected).
- **Fix sketch**: Filter the listener on `ev.sessionId === DEFAULT_SESSION_ID` (the recall/turn-summary handlers already only matter for the default session). Optionally route build streams onto a distinct event channel.
- **Value**: impact=6 effort=3

## 3. Transcript + in-chat search are capped to the last 50 episodes with full-replace semantics
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: lost history / magic constant
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1515 (also :741 initial fetch); ChatSearch.tsx:43
- **Scenario**: Every send does `const fresh = await companionListRecentMessages(50); setMessages(fresh)` — a full replace of the visible transcript with only the 50 most recent episodes. A turn now persists a user episode + N `PROGRESS:` beats + M interim segments + the final reply as **separate** episodes (session.rs:686–721), so a single multi-step turn can burn 5–10 of the 50 slots. After a few turns the user's scrollback silently collapses to the last 50 on the next send. `ChatSearch` filters only the in-memory `messages` window, so searching the chat returns nothing for anything older than that window, with no "results truncated" hint.
- **Root cause**: Hard-coded `50` window + replace-all, with no pagination / "load older", combined with the new one-episode-per-beat persistence that inflates episode counts.
- **Impact**: For an "always-on companion," visible history vanishes and search is misleadingly empty even though the data is intact in SQLite/FTS. Erodes trust ("it forgot our conversation").
- **Fix sketch**: Add a "load older" pager (offset/keyset) and/or merge-append fetched messages instead of replacing; back ChatSearch with the server-side FTS (`companion_*`) rather than the client window. At minimum, label the window as partial.
- **Value**: impact=6 effort=5

## 4. `run_cli` orphans the Claude child process (and leaks the temp prompt file) on early error returns
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: handle / process leak
- **File**: src-tauri/src/companion/session.rs:1526 (spawn) → :1533 (stdin `?`); cleanup only at :1683/:1686
- **Scenario**: After `cmd.spawn()`, if the stdin `write_all` fails (claude died on spawn), or `child.stdout.take()`/`stderr.take()` returns the `ok_or_else` error, the function returns via `?` **before** the read loop. The `Command` is built without `.kill_on_drop(true)`, so dropping `child` does not reap the subprocess — an orphaned `claude` CLI keeps running. The temp system-prompt file (`write_temp_prompt`, session.rs:1855) is only deleted at session.rs:1686 on the post-loop path, so it is also leaked on every early-return.
- **Root cause**: No RAII/`kill_on_drop` for the child and no cleanup guard for the temp file on the `?` paths between spawn and the await loop.
- **Impact**: Orphaned CLI processes consume compute/subscription and hold the session; on Windows this feeds the documented console-heap exhaustion → `0xC0000142` cascade the codebase elsewhere works hard to avoid. Plus unbounded temp-file accumulation. (Sibling: `INTERRUPTED_TURNS` at session.rs:104 grows unbounded — a "stop" click landing after `clear_interrupt` at :1670 leaves a permanent entry.)
- **Fix sketch**: `.kill_on_drop(true)` on the command (or a `Drop` guard that `start_kill()`s); move temp-prompt deletion into a guard so it fires on all return paths.
- **Value**: impact=5 effort=3

## 5. A single turn's own PROGRESS/interim episodes can flood the recall window and evict real context
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: stale / missing prompt context
- **File**: src-tauri/src/companion/prompt.rs:183 (and :303) — `list_recent(user_db, session_id, 20)`
- **Scenario**: The non-ml prompt path (and the ml path's `retrieve(...).unwrap_or_default()` fallback) seeds episodes from `list_recent(…, 20)`. Because each PROGRESS beat and each non-final interim segment is persisted as its own assistant episode (session.rs:686–721), one tool-heavy turn can write well over a dozen low-value "texture" episodes. The next turn's 20-episode recall window can be almost entirely consumed by the previous turn's own asides, pushing earlier real conversation out of `format_episodes` (prompt.rs:358).
- **Root cause**: The episode count per turn was multiplied by the beat/interim-as-episode design, but the recall cap (`20`) and the `RecallPreview` accounting were not adjusted to discount `PROGRESS:`/interim rows.
- **Impact**: Athena loses earlier user context on long, multi-step turns and may repeat herself or drop commitments — undocumented coupling between two "display texture" features and the prompt-recall budget.
- **Fix sketch**: Exclude (or down-weight) `PROGRESS:`-prefixed and interim episodes from `list_recent` recall, or raise/separate the recall cap so asides don't crowd out substantive turns; document the per-turn episode fan-out as a known assumption.
- **Value**: impact=5 effort=5
