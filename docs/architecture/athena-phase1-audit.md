# Athena Desktop-Aware — Phase 1 Audit (Decision-Gate Record)

**Source:** `idea-40cffac7-os-level-athena-desktop-aware.md` (deleted on completion of this audit, 2026-05-09).
**Status:** Phase 1 complete. Decision gate: **GO** with two scope corrections (see below).
**Phase status snapshot (2026-05-11):** Phase 2 (privacy UX), Phase 3 c (clipboard MVP + daemon bridge + file_watcher producer), Phase 5 (CLI session awareness with persona-editor UI) all shipped. Phase 4 (macOS / Linux active-window) is the only outstanding multi-session phase.
**Sibling deliverables:** [`../features/companion/athena-daemon-bridge.md`](../features/companion/athena-daemon-bridge.md), [`../features/companion/athena-cli-session-awareness.md`](../features/companion/athena-cli-session-awareness.md).

This document is the durable Phase-1 deliverable the requirement called for. It is preserved verbatim as the decision-gate record — the gaps it called out and the scope corrections it made are referenced by every subsequent Athena phase doc.

---

## TL;DR

The 2026-05-08 audit baked into the original requirement was right that substantial foundation already exists — but **two of its three checklist items resolved differently than predicted**. One in our favor (Windows app-focus is already implemented, not "likely macOS-only"), one against us (`SensoryPolicy` is NOT consulted at signal capture — only at consumption). The latter has real privacy implications and bumps Phase 2's scope.

Phase 2 (privacy UX) remains the right next deliverable. Phase 4's Windows-active-window scope shrinks; macOS + Linux become the actual platform gaps.

## Per-checklist verdict

### ✅ Item 1 — `AppFocusSubscription` on Windows

**Predicted:** "likely macOS-only today" (audit's worry).

**Reality:** Windows is the **only** implemented platform. `src-tauri/src/engine/app_focus.rs:67-123` implements `get_foreground_window_windows()` via the `windows` crate (`GetForegroundWindow` + `GetWindowTextW` + `GetProcessImageFileNameW`). `#[cfg(not(target_os = "windows"))]` returns `None`.

**Implication:** Phase 4's "Active-window watcher on Windows (`windows` crate / `GetForegroundWindow`)" is already done. The platform gaps are **macOS** (Accessibility API or `NSWorkspace`) and **Linux** (X11 first per the requirement; Wayland deferred). The Windows surface only needs to be exercised end-to-end during Phase 1's runtime verification — but the code path exists.

### ⚠️ Item 2 — Is `SensoryPolicy` consulted at signal production?

**Predicted:** unknown; "trace `ContextEvent` from watcher → consumer."

**Reality:** **No.** Tracing the broadcast path:

- `AmbientContextFusion::push_clipboard(content_type, content_length)` (`ambient_context.rs:237`)
- `AmbientContextFusion::push_file_change(kind, paths)` (`ambient_context.rs:247`)
- `AmbientContextFusion::push_app_focus(app_name, window_title)` (`ambient_context.rs:262`)

Each of these only checks `if !self.enabled { return; }` — the **global** enable flag, not any per-persona `SensoryPolicy`. Captured signals enter the rolling 30-signal window regardless of which personas have opted in or which globs/filters they declared.

`get_policy(persona_id)` and the per-persona `focus_app_filter` / `file_glob_filter` fields are consulted **only at consumption** — when a persona's prompt builder asks for a snapshot, the policy filters which signals from the window the persona is allowed to see.

**Implication for Phase 2:**
- Captured-then-filtered is fine for the windowed UI flow when toggles are OFF (push paths are guarded by global enable).
- It is NOT fine once toggles can be ON per-source: the user expects "I disabled file watching" to mean signals are not captured AT ALL, not "captured but filtered out for me."
- **Phase 2 scope additions:**
  1. Move per-source enablement from "implicit via global toggle" to "explicit at capture site." Each `push_*` function must check at least the global per-source flag (clipboard / file_changes / app_focus) before adding to the rolling window.
  2. Per-persona policy stays as a consumption-side filter (still useful for cross-persona scoping when global is ON).
  3. Redaction at capture (the requirement's Phase 2 bullet 4) MUST run before the signal enters the rolling window or the broadcast channel.

### ⚠️ Item 3 — `personas-web` marketing positioning conflict

**Predicted:** check whether reframing local-first as "peripheral vision" breaks marketing.

**Reality:** out of scope for this repo's audit. The `personas-web` source lives in a separate repo and isn't part of this checkout. Recommendation: when Phase 2's UI lands and the surfacing copy is being drafted (the "What did Athena see?" view, the per-source toggles), do a targeted `personas-web` pass to align messaging. The risk is small — the local-first story strengthens, doesn't conflict.

## Other findings while tracing

### Clipboard content capture: NOT happening today (good)

`push_clipboard` takes `content_type: &str` and `content_length: usize` — never the clipboard text itself. The summary lands as `"Clipboard: text (123 chars)"`. Phase 3 (clipboard MVP with redaction) is the right place to add content capture; today's surface area is metadata-only. **No retroactive privacy gap.**

### App-focus window title is captured raw

`push_app_focus(app_name, window_title)` stores the window title in the snapshot without filtering. Window titles can leak sensitive content (`"Confidential proposal.docx - Word"`, `"Re: severance terms - Outlook"`, search-bar query strings). Phase 2's "automatic redaction" must include window-title redaction, not just clipboard.

### Daemon ↔ ambient context: not threaded (confirms gap #6)

`grep -r "ambient_ctx\|AmbientContext\|ambient_context" src-tauri/src/daemon/` returns zero matches. The daemon's `consume_headless_events` (`daemon/runtime.rs:69`) calls `runner::run_execution` directly without reading the rolling ambient window. Headless personas executed by the daemon never see "what Athena just saw."

This is a real Phase 3 task and slightly larger than the requirement framed it: the daemon spawns personas via `runner::run_execution` directly; the `runner` itself needs to grow an optional `&AmbientContextSnapshot` parameter (or a thread-local handle) so both the windowed-UI execution path and the daemon-execution path can pass the same shape.

### Subscriptions are properly traced

The reactive-subscription model (`engine/subscription.rs`) cleanly separates `EventBusSubscription`, `FileWatcherSubscription`, `ClipboardSubscription`, `AppFocusSubscription`, `AmbientContextSubscription`, `ContextRuleSubscription` (all `#[cfg(feature = "desktop")]`). The trait+loop shape means new watchers don't need new `tokio::spawn` blocks. **Don't break the trait when extending watchers in Phase 2.**

### `context_rules::ContextRuleEngineHandle` is the right hook for Phase 3's ambient→trigger bridge

`engine/context_rules.rs` exists (per the file listing) — Phase 3's "ambient_match" trigger evaluator should plug into this engine, not invent a new one. (Not read in detail this session; flagged for Phase 3.)

## Decision gate verdict

**GO** for Phase 2, with these scope corrections:

1. **Phase 2 expansion:** add capture-time per-source enable checks to `push_clipboard`, `push_file_change`, `push_app_focus` (currently global-only). Without this, the "OFF by default per source" framing is theatre — the global flag still controls capture.
2. **Phase 2 expansion:** automatic redaction must include window titles, not just clipboard. The redaction regex set in the requirement covers credentials; window titles need an additional layer (filename truncation, common confidential-doc patterns, etc.).
3. **Phase 4 reduction:** Windows active-window is already done; remove from Phase 4. macOS (Accessibility / `NSWorkspace`) and Linux X11 are the real platform gaps.
4. **Phase 3 expansion:** the daemon-ambient bridge (gap #6) requires `runner::run_execution` to grow an optional ambient-snapshot parameter, threaded through both the windowed and daemon paths. Treat this as a discrete sub-task before the proactive trigger evaluator lands.

## What was NOT changed in this session

- No code edits to `engine/`, `daemon/`, `companion/`, or the frontend. This is an audit-only session per the requirement's Phase 1 framing.
- No backlog item created for Phase 2-5 — that's the next session's first action (likely `/architect` for Phase 2 scope refinement, or directly into the privacy-UX implementation).
- No marketing-copy delta to `personas-web` (out of repo).

## Follow-ups

- **Phase 2 (privacy UX):** start here next session. Architect-shaped if scope grows; explorer-shaped if it stays bounded to "What did Athena see?" view + capture-time gating + window-title redaction.
- **Runtime verification of Windows app-focus:** boot the desktop build with `PERSONAS_DAEMON_MODE=1` and observe `AppFocusSubscription` firing events. Confirm window titles populate cleanly. (Phase 1's third checklist item — runtime confirmation — was not done this session because verification needs a running build, not just code review.)
- **Marketing alignment with `personas-web`:** when Phase 2's UI copy lands.

## References

- Source idea: `~~ .claude/commands/unclear-wins/idea-40cffac7-os-level-athena-desktop-aware.md ~~` (deleted 2026-05-09 on Phase 1 completion).
- `src-tauri/src/engine/ambient_context.rs:84-118` — `SensoryPolicy` struct + Default.
- `src-tauri/src/engine/ambient_context.rs:237-274` — push_* paths (capture sites).
- `src-tauri/src/engine/app_focus.rs:67-123` — Windows `GetForegroundWindow` impl.
- `src-tauri/src/daemon/runtime.rs:40-61` — daemon tick (no ambient injection).
- `src-tauri/src/engine/subscription.rs:100-157` — desktop-feature watchers.
- Project memory: `feedback_credentials_stay_local.md` — local-first invariant Phase 2 redaction must honor.
