# Ambient Context Fusion — Half-Wired Feature

**Status:** Concept / parked
**Author:** Investigation 2026-04-27
**Scope:** Settings.Engine "Ambient Context Fusion" panel, `engine/ambient_context.rs`, `engine/context_rules.rs`, build-session gates, prompt assembly, event wrapping
**Decision:** Document for later. Not finishing the wiring now.

## TL;DR

The "Ambient Context Fusion" section in **Settings → Engine** is a half-built
feature. About 60% wired:

- **Works:** the enable toggle, the live snapshot view, per-persona sensory
  policy CRUD, context-rules CRUD, and rule matches → `context_rule_match`
  persona events.
- **Missing:** the headline value-prop ("personas see what the user is doing")
  is unimplemented. The renderer that would format signals into a prompt
  block (`format_for_prompt`) is **only called from tests**. Every production
  call to `assemble_prompt` passes `None` for the `ambient_context` parameter
  the renderer would feed. One of three signal sources (file watcher) never
  even reaches the snapshot.

This doc captures (a) what's actually wired today, (b) the small set of
fixes needed to finish wiring, and (c) the four concrete pipelines where
this feature could deliver real value if/when we revisit it.

---

## Part 1 — What's wired today

### 1.1 Signal collection (2 of 3 producers live)

`engine/subscription.rs` runs reactive subscriptions on intervals:

- **Clipboard** — `subscription.rs:368-378`, ticks every 3s. On hash change,
  calls `ctx.push_clipboard("text", 0)`. ✅ Wired.
- **App focus** — `subscription.rs:592-604`, ticks every interval. On
  app/title change, calls `ctx.push_app_focus(app, title)`. ✅ Wired.
- **File watcher** — `subscription.rs:332-343`, ticks every 2s. The inline
  comment promises "push file change signals from within `file_watcher_tick`
  via ambient ctx" but `file_watcher.rs` contains **zero** references to
  `push_file_change` or `ambient_ctx`. ❌ **Dead.** Two-thirds of the panel's
  signal sources actually feed the snapshot.

All three producers are gated by `#[cfg(feature = "desktop")]`. The default
`tauri.conf.json` builds with `desktop-full` so this is on for normal dev
and ship builds.

### 1.2 Snapshot + UI

`commands/execution/ambient.rs` exposes the read/write IPC surface:

- `get_ambient_context_snapshot` (line 24) → returns the rolling window
- `set_ambient_context_enabled`, `set_ambient_sensory_policy`, etc.
- `get_context_stream_stats` → broadcast counter + active subscribers

`src/features/settings/components/AmbientContextPanel.tsx` reads these and
displays the live signal feed. ✅ Works end-to-end. (Keep in mind the file
watcher row is always empty.)

### 1.3 Context rules (the actually-functional half)

`engine/context_rules.rs:325-383` evaluates user-defined rules against the
context event stream and dispatches per-action:

- `TriggerExecution` → publishes a `context_rule_match` persona event via
  `event_repo::publish` (line 349-357). The event bus picks it up and runs
  any persona subscribed to that event type. ✅ Real downstream effect.
- `EmitEvent` → emits a frontend Tauri event (`CONTEXT_RULE_MATCH`).
- `Log` → tracing only.

This is the one place ambient signals already affect behavior outside the
panel. A user can wire "clipboard contains a Jira URL" → fires a Jira-triage
persona. That works today.

### 1.4 The unhooked piece

`engine/ambient_context.rs:483` defines `format_for_prompt(persona_id) →
Option<String>` — the markdown renderer that would build the
"## Ambient Desktop Context" block for prompt injection. **Only callers are
tests** (`grep format_for_prompt` confirms).

`engine/prompt/mod.rs:97` declares `assemble_prompt(... ambient_context:
Option<&str>)` and `mod.rs:558-564` already wraps a non-empty value in an
`<ambient_desktop_context>` XML block between Communication Protocols and
Input Data. **Every production callsite passes `None`** — verified by grep
across `runner/mod.rs:502`, `commands/execution/executions.rs:615`,
`commands/infrastructure/cloud.rs:566`, `commands/core/personas.rs:142,235`,
`gitlab/converter.rs:139,198`. The runner comment "Ambient context is
injected by the engine layer (see mod.rs)" is stale — `engine/mod.rs:93`
only declares the module, no wrapper exists.

---

## Part 2 — Minimum to finish wiring

Two fixes make the existing infrastructure live:

### Fix A — File watcher producer

`engine/subscription.rs:332-343` wraps `file_watcher_tick`. Either:

- pass the ambient handle into `file_watcher_tick` and call
  `ctx.push_file_change(kind, &paths)` per drained event, or
- snapshot the queue size before/after the tick and push a coarse summary
  ("3 file changes in `~/inbox`") instead of one signal per event.

The latter is cheaper and matches how clipboard handles unknown content.
Either way the panel's "File changes" toggle stops being a no-op.

### Fix B — Wire `format_for_prompt` into the runner

`engine/runner/mod.rs:491-504` is the production assemble_prompt call. The
`ambient_context: None` is hard-coded and the comment explicitly punts the
work to "the engine layer." That layer doesn't exist. Replace with:

```rust
#[cfg(feature = "desktop")]
let ambient_md = state.ambient_context.lock().await.format_for_prompt(&persona.id);

prompt::assemble_prompt(
    &persona, &tools, input_data.as_ref(),
    /* hints */, /* workspace */, /* connectors */,
    #[cfg(feature = "desktop")] ambient_md.as_deref(),
)
```

`format_for_prompt` already returns `None` when the snapshot is empty or
disabled, so this is safe for personas in headless contexts. The XML
wrapping in `prompt/mod.rs:558-564` already exists; nothing else changes.

**That's it.** Two small fixes and the existing UI starts producing real
behavior. No new commands, no new DB tables, no schema changes.

---

## Part 3 — Four leverage points (where this feature could matter)

These are the pipelines where ambient signals could meaningfully change
behavior, ranked by ROI. Each anchored to existing code.

### Case 1 — Build-time gate seeding (highest ROI)

**Where:** `engine/build_session/gates.rs:130-217`. Five `intent_implies_*`
heuristics decide whether to ask the user a clarifying question or accept
the LLM's resolution.

**Today:** keyword matching on the intent string only.
- `intent_implies_trigger` — looks for "whenever", "every morning", etc.
- `intent_implies_connectors` — fuzzy aliases like "google drive"
- `intent_implies_review` — "automatically", "no approval"
- `intent_implies_memory` — "stateless", "remember preferences"

When all return `Closed`, the user gets 4-6 clarifying questions per build.

**With ambient:**
- User says "translate documents I drop in." Intent has no keyword for the
  drive type. Ambient sees `~/inbox/*.docx` arrived 10s ago → open the
  `connectors` gate with `local_drive` pre-selected. One question saved.
- User says "respond to PRs". Ambient shows chrome.exe focused on
  github.com → open `connectors` with `github` pre-selected.
- User clipboard contains a Notion URL while building → weight `notion` first
  in the connector option list.

**Code change shape:** add `ambient_hints: Option<&AmbientSnapshot>` to
`gate_seed_for_intent` (line 222) and `synthesize_gate_question` (line 330);
modify the connectors branch (line 386, currently empty options array) to
populate from ambient evidence before falling back to registry.

**Benefit:** measurable reduction in build-loop friction. The spammy
question loop is the single most-complained-about part of the build UX
today.

### Case 2 — Runner prompt injection (lights up the existing slot)

**Where:** `engine/runner/mod.rs:491` calling `prompt::assemble_prompt(...
ambient_context: None)`. The prompt slot at `prompt/mod.rs:558-564` is
already there.

**Today:** None passed → no `<ambient_desktop_context>` block in the prompt.

**With ambient:** general-purpose / chat / advisory personas get a
paragraph like:

```xml
<ambient_desktop_context>
## Ambient Desktop Context
**Active Application**: Code.exe — runner/mod.rs

**Recent Activity** (newest first):
- [clipboard] Clipboard: text (240 chars) (5s ago)
- [app_focus] Focused: Code.exe — runner/mod.rs (12s ago)
- [file_watcher] File modify: gates.rs (45s ago)
</ambient_desktop_context>
```

**Use cases:**
- Chat persona answering "what was I just looking at?" — currently can't
  answer; with ambient, trivial.
- Advisory persona reviewing "improve this for me" without explicit code
  attached — can pick up the focused file from ambient.
- Triage personas can disambiguate vague input like "fix this" by checking
  the active window title.

**Code change shape:** see Fix B above. One-line shape change in the
runner; consumer side already exists.

**Benefit:** real for general-purpose personas; mostly noise for
narrow event-driven personas (which already have explicit input). Worth
shipping for the former, harmless for the latter (`format_for_prompt`
returns None when no signals, no prompt bloat).

### Case 3 — Event payload enrichment

**Where:** `engine/background.rs:834-860`. When `event_bus_tick` claims
a pending persona event, it wraps the payload:

```json
{
  "_event": { "event_type": "...", "source_type": "...", "source_id": "..." },
  "payload": <original>
}
```

**Today:** `_event` carries identity only.

**With ambient:** add `_ambient_at_trigger_time` capturing the snapshot
*at the moment the event was first matched*, not at execute time
(execution can happen seconds-to-minutes after due to the queue). Lets
personas branch on "was the user actively working when this fired".

```json
{
  "_event": { ... },
  "_ambient_at_trigger_time": {
    "focused_app": "Slack.exe",
    "recent_signals": [...]
  },
  "payload": <original>
}
```

**Use cases:**
- A drive-watch persona that summarizes silently when user was elsewhere,
  but pings them in chat when they were actively in the file's parent
  folder.
- A meeting-prep persona that checks "was I in Calendar.exe when this
  meeting event fired" to decide whether to interrupt or queue.

**Benefit:** narrow. Most event-driven personas don't care about
user-presence signals. Ship if/when a concrete persona needs it.

### Case 4 — Context-rule snapshot timestamping

**Where:** `engine/context_rules.rs:338-364`. When `TriggerExecution`
fires, the persona event is published immediately but executes later via
`event_bus_tick`.

**Today:** the receiving persona reads the ambient snapshot at execute
time — by then, signals from the moment of match have rolled out of the
window.

**With ambient:** capture the snapshot at `engine/context_rules.rs:340`
(before `event_repo::publish`) and embed it in the published payload. The
receiving persona sees state-at-match-time, not state-at-execute-time.

**Use cases:** any rule whose meaning depends on what the user was doing
at the moment the rule matched, not what they're doing 10 seconds later
when execution dequeues.

**Benefit:** subtle but important *if* you have rule-driven personas. No
benefit if you don't.

---

## Part 4 — Order of work, if/when we revisit

1. **Fix A (file watcher producer)** — without this, every other case
   runs on 2/3 evidence. ~30 min.
2. **Case 1 (build-time gate seeding)** — biggest user-visible win;
   reduces the spammy question loop. ~half day for the gates changes,
   ~half day for the option-ranking changes, ~half day for tests.
3. **Fix B + Case 2 (runner injection)** — one-line wiring for the runner,
   plus a sensory-policy pass to avoid leaking irrelevant signals into
   prompts of personas that don't want them. ~half day.
4. **Cases 3 and 4** — defer until a concrete persona needs them. They're
   real but narrow; not worth speculative work.

Skip the "memory-tier parallel injection" idea I considered earlier — it
duplicates Case 2 with no extra value.

---

## Part 5 — Things to think about before resuming

- **Privacy.** Clipboard contents and active window titles can contain
  passwords, keys, document titles users wouldn't want in an LLM prompt.
  Today the snapshot stores summaries only ("Clipboard: text (240 chars)")
  not raw content, which is the right call. Don't regress this when wiring
  Case 2 — never put raw clipboard text or full window titles into a
  prompt unless the persona has explicitly opted in (sensory policy
  already supports app focus filters, extend to a "verbose" flag).
- **Cross-persona leakage.** All personas currently share the same global
  ambient state. The `SensoryPolicy` per-persona filter is the right
  isolation primitive. Make sure Case 1/2 use `snapshot_for_persona` not
  the raw signal queue.
- **Mobile/headless.** All ambient producers are `#[cfg(feature =
  "desktop")]`. The cases above must degrade gracefully — Case 2 already
  does (None when no snapshot); Cases 1/3/4 need similar care.
- **Cost.** A persona prompt growing by ~15 lines of ambient context per
  call has token cost. Cheap per-call but adds up at scale; consider
  including it only when the persona's design_context opts in.

---

## Appendix — File:line index

**Wired (works today):**
- `engine/ambient_context.rs:1-516` — fusion store, signal types, snapshot
- `engine/ambient_context.rs:483` — `format_for_prompt` (only called from tests)
- `engine/subscription.rs:368-378` — clipboard producer
- `engine/subscription.rs:592-604` — app focus producer
- `engine/context_rules.rs:325-383` — rule evaluator + dispatch
- `commands/execution/ambient.rs:24-136` — read/write IPC surface
- `src/features/settings/components/AmbientContextPanel.tsx` — UI panel

**Half-wired (the comment lies):**
- `engine/subscription.rs:332-343` — file_watcher tick, comment claims
  ambient push, doesn't happen
- `engine/runner/mod.rs:491-504` — `assemble_prompt` call, comment says
  "injected by engine layer", layer doesn't exist
- `engine/mod.rs:93` — only `pub mod ambient_context;`, no injection wrapper

**Slot exists, never populated:**
- `engine/prompt/mod.rs:97` — `ambient_context: Option<&str>` parameter
- `engine/prompt/mod.rs:558-564` — XML wrapping for ambient block

**Build-time decision points (Case 1 targets):**
- `engine/build_session/gates.rs:130-217` — five intent_implies_* heuristics
- `engine/build_session/gates.rs:222` — `gate_seed_for_intent`
- `engine/build_session/gates.rs:330` — `synthesize_gate_question`
- `engine/build_session/gates.rs:386` — connectors options array (empty)

**Execution-time enrichment points (Cases 3, 4):**
- `engine/background.rs:834-860` — event payload `_event` wrap site
- `engine/context_rules.rs:340` — pre-publish snapshot capture site
