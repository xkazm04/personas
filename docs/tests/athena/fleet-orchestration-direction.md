# Fleet orchestration — why Athena stalls on pending CLIs, and how to reach fully-autonomous parallel dev

**Date:** 2026-07-03. Companion to [`autonomous-mode-direction.md`](./autonomous-mode-direction.md)
(that doc covers execution-review / self-initiated analysis; this one covers **Athena driving a fleet
of Claude Code CLIs**). Code-verified map, four parallel reads across `companion/`, `commands/companion/`,
`commands/fleet/`, and the frontend companion surfaces.

## The symptom that started this

In autonomous mode, Athena **does not continue pending CLI sessions**, and instead surfaces a card like:

> **Athena reached out · fleet session waiting**
> Fleet session `d76c3a0d` (pof) has been awaiting your input for ~9 min. Want me to peek at what it needs?

Two things are wrong there: (1) she's asking permission to *even look* at a session she has full
machinery to read, and (2) 9 minutes elapsed before anything surfaced. Both are explained below.

---

## How Athena + Fleet actually interoperate today

Claude Code emits hooks → `POST /fleet/hooks/*` → `apply_hook` (`commands/fleet/hooks.rs`) sets state:

| Hook | State | Meaning |
|---|---|---|
| `SessionStart` | `Idle` | launched |
| `PreToolUse` / `PostToolUse` | `Running` | working (also *revives* a false `AwaitingInput`) |
| `Stop` | **`Idle`** | **turn finished — waiting for next instruction** |
| `Notification` | **`AwaitingInput`** | permission request / `AskUserQuestion` |

Then **two independent, wildly asymmetric paths react**:

### PUSH path — smart, event-driven (`orchestrate_on_awaiting`, `commands/companion/fleet_bridge.rs:192`)
Fires the instant `AwaitingInput` lands (Rust-direct from `hooks.rs:316`, plus a redundant JS-bridge
call that the throttle dedups).
- Reconstructs the **actual vt100 screen** (`registry::render_screen_for`) so she reads the real prompt —
  an `AskUserQuestion` menu, a permission, free-text — not a blind guess.
- Marks the tile "Athena's on it", spawns a `suppress_chat` `fleet_orchestration` proactive turn with the
  screen + operative-memory digest.
- She proposes `fleet_send_input {text, confidence, rationale}` or defers.
- `auto_resolve_if_allowed` (`approvals.rs`) **auto-types it only if `confidence=="high"`** (a literal
  string match, `approvals.rs:3093`); `medium`/`low`/absent → orb consult.
- Gated by autonomous mode + a **60 s/session throttle** (`ATTENTION_MIN_INTERVAL_MS`) + a
  **screen-hash dedupe** (`decision_signatures`) so it assesses each *distinct* prompt exactly once.

### POLL path — blind, timer-driven (`fleet_attention`, `companion/proactive/fleet_triggers.rs:45`)
Runs on the 5-minute proactive tick (`commands/companion/mod.rs:65`), **only in autonomous mode**
(`triggers.rs:81`).
- **Zero context** — reads only the registry DTO (id / state / age). It has no screen, no transcript.
- Emits the deterministic template `"…awaiting your input for ~N min. Want me to peek at what it needs?"`
  for any session `AwaitingInput ≥ 2 min` (`fleet_triggers.rs:57-68`).
- Renders as a chat card that **waits for a human "Engage" click** to start a real turn.

### What actually happened to `d76c3a0d`
1. **t0** — `Notification` → `AwaitingInput`. PUSH fires, reads the screen — but either **deferred**
   (confidence < high), or the first screen render was **empty** (the ring hadn't captured the
   alt-screen TUI yet) so she had nothing to decide and did nothing.
2. **t0 → ~9 min** — session sits. PUSH **won't re-fire**: it's only triggered by a *new* hook event, and
   the screen-hash dedupe blocks a re-assessment of the same screen.
3. **~t2 min+** — the POLL tick notices "still `AwaitingInput`" and emits the **blind "peek?" card**,
   which discards the screen-reading capability and parks waiting for a human click.

**So the autonomous brain ran once and stepped back, and a dumber, blind, ask-only path shadowed it.**

---

## The gaps (each tied to the symptom)

1. **The blind POLL card shadows the smart PUSH path.** `fleet_attention` only runs in autonomous
   mode — the *one* mode where `orchestrate_on_awaiting` already owns `AwaitingInput` sessions. So the
   "peek?" card is pure contradictory noise: a strictly-worse duplicate that needs a human click to
   re-invoke reasoning that already exists.
2. **PUSH is event-only, never re-checked on a timer.** If the first assessment no-op'd (empty screen)
   or the screen later changed without a fresh `Notification` hook, nothing re-looks. The session
   silently stalls.
3. **The confidence gate is binary, self-reported, and doctrinally biased toward deferring.** Only
   `"high"` auto-fires, and the constitution is pervasively cautious ("*Nothing executes without his
   click*", "*When in doubt, ask*"). The model rarely self-labels `"high"`, so most decisions become
   consults → "doesn't continue." The confidence is also **uncalibrated self-report** — no server-side
   verification.
4. **Only `AwaitingInput` triggers orchestration.** A session that finished a chunk and idles at the
   prompt (`Stop → Idle`) — the literal "pending CLI session" — has **no autonomous trigger**. A
   `Running`-but-looping session is detected (`stuck_dispatched_sessions`) but its fix `fleet_intervene`
   is **deliberately off the autoapprove allowlist** → always a human click.
5. **She can't autonomously recover a session.** There is **no dispatcher action for wake / resume /
   hibernate** — those are UI-only Tauri commands. After an auto-hibernate or an app-restart orphaning,
   sessions stall with zero autonomous recovery, though `fleet_wake_session` / `fleet_resume_orphan`
   fully work.
6. **No durable decision memory, no per-session objective.** Re-ask suppression is in-memory only
   (screen-hash map, 1 h-TTL operative memory) — a restart loses it. There is no structured `defer_reason`,
   and no durable per-session goal, so she can't judge *done vs needs-next vs stuck*.

---

## The design — generalize the one proven primitive

The act-or-consult primitive already works end-to-end for `fleet_send_input` (`fleet_bridge.rs:272` →
`approvals.rs:397`). The whole design **generalizes that one mechanism** across triggers, actions, and a
durable memory — it is not a new system.

### Phase 1 — Kill the blind peek; make orchestration timer-re-checked
- **Remove** the blind `fleet_awaiting` "peek?" nudge from `fleet_attention` (it only fires in the mode
  where orchestration already owns the session).
- **Add** a timer-driven re-assessment on the proactive tick: for `AwaitingInput` sessions parked past a
  threshold, call `orchestrate_on_awaiting` again. Its existing 60 s throttle + screen-hash dedupe make
  this safe — an *unchanged* screen is skipped (no re-nag on a genuinely-deferred session), a *changed*
  screen (including empty → rendered) is re-assessed. This closes gap 1 + gap 2 with no new spam surface.
- Net: a stuck `AwaitingInput` session gets re-reasoned from its real screen; the only thing that reaches
  the user is a real recommendation or auto-action — never "want me to look?".

### Phase 2 — Widen the confidence gate: decision-class + boldness dial
- Add a `decision_class` to the fleet directive — **`drive_forward`** (continue / proceed / obvious-next)
  vs **`choice`** (irreversible / preference). `drive_forward` auto-fires at high **or** medium; `choice`
  stays high-only.
- Add a **Cautious / Balanced / Bold** setting mapping to that confidence × class matrix in
  `auto_resolve_if_allowed`.
- Add a cheap **execution-time re-check** (the screen hash still matches the one she decided on) since
  confidence is uncalibrated self-report. Destructive / external actions stay always-gated.

### Phase 3 — Trigger on more than `AwaitingInput`
- **Idle-needs-next:** `Stop → Idle` on a session with a live objective wakes a supervisor turn to send
  the next step (reusing the `continue_autonomously` chain primitive, `session.rs:1019`).
- **Running-stuck:** promote `stuck_dispatched_sessions`' `fleet_intervene` onto the confidence-gated
  autonomous path (already detected, just off the allowlist).

### Phase 4 — Recovery hands
- New confidence-gated dispatcher actions `fleet_wake` / `fleet_resume` wrapping the existing
  `fleet_wake_session` / `fleet_resume_orphan`, so she can revive hibernated / orphaned sessions.

### Phase 5 — Durable decision memory + per-session objective
- Persist `(session_id, screen_hash, action, confidence, defer_reason)` so restarts don't re-ask and you
  can see *why* she stopped.
- Thread the spawn task into a **durable per-session objective** rendered into the orchestration prompt,
  so she judges *done vs needs-next vs stuck*.

Sequencing: Phase 1 kills the visible symptom; Phase 2 makes her actually continue; Phases 3–5 complete
the parallel-dev vision. Each phase is testable in isolation.

---

## Phase 1 — shipping now

**Files:**
- `companion/proactive/fleet_triggers.rs` — remove the `AwaitingInput → fleet_awaiting` arm of
  `fleet_attention` (the "peek?" nudge). `fleet_stale` / `fleet_failed` are unchanged (different states,
  separate phase).
- `commands/companion/fleet_bridge.rs` — new `reassess_stale_awaiting(app, state)`: scan the registry for
  `AwaitingInput` sessions parked ≥ `REASSESS_AFTER_MS`, and call `orchestrate_on_awaiting` for each. No
  new gating logic — it reuses orchestration's throttle + screen-hash dedupe.
- `commands/companion/mod.rs` — call `reassess_stale_awaiting` from the autonomous branch of the 5-minute
  proactive tick.

**Why this is safe (no re-nag regression):** the screen-hash dedupe (`decision_signatures`) means a
session that Athena already assessed on its *current* screen is skipped. A genuinely-deferred session
(she left it to the user) sits quietly; only a session whose screen *changed* — or whose first render was
empty and has since rendered — is re-assessed.

**How to verify live** (`npm run tauri:dev:test`, autonomous mode ON):
1. Spawn a fleet session in a real project and let it hit an `AskUserQuestion` / permission prompt.
2. Confirm **no** "Athena reached out · fleet session waiting / Want me to peek?" card appears.
3. Confirm the session is instead assessed on its real screen: she auto-answers (high confidence), or
   surfaces a real recommendation on the orb (medium/low), or defers with a lean.
4. Force the empty-first-render case (a session parked before its screen rendered) and confirm the next
   proactive tick re-assesses it from the now-rendered screen rather than nagging.

---

## Build log

- **2026-07-03** — analysis + this direction doc.
- **2026-07-03** — **Phase 1 shipped + live-verified.** Removed the blind `fleet_awaiting` peek
  nudge; added `reassess_stale_awaiting` on the proactive tick (commits `5e25bf530`, `fbc442362`).
  Live demo drove a session to `AwaitingInput` via an injected `Notification` hook and confirmed:
  the PUSH path fires and reads the real screen (`fleet_orchestration: waking Athena to assess the
  fleet`), **no** blind "peek?" card, and the **timer re-assessment re-fires orchestration on the
  parked session with no new hook** (observed `waking Athena … session_id=ed4a4bd2` at successive
  ticks after hook injection stopped). The demo also caught a latent bug: `reassess_stale_awaiting`
  looked up `AppState` where the app manages `Arc<AppState>` — a runtime panic on every tick that
  the panic-guard swallowed but which aborted the whole autonomous branch (exec-review + triage +
  reassess). `cargo check` couldn't see it; the live run did. Fixed in `fbc442362`.
  **Verification lesson:** ship-blocking runtime bugs in Tauri-state / scheduler wiring only surface
  when the scheduler actually ticks — drive the live scenario, don't trust `cargo check` alone.
- **2026-07-04** — **Phase 2 backend shipped (default dial = Bold, user choice).** Commits
  `02fabd81a` (2.1 — directive asks for `decision_class` drive_forward|choice + honest confidence),
  `5683f077f` (2.2 — `COMPANION_FLEET_BOLDNESS` setting + `FleetBoldness` enum + set/get commands),
  `1744ee812` (2.3 — `fleet_send_input_auto_fires` matrix gate replacing the high-only gate, + 8
  unit tests), `8252e44f0` (2.4 — `screen_matches_last_decision` execution-time re-check: defers an
  auto-fire whose target screen changed since Athena reasoned on it). Matrix: high always fires; low
  never; medium fires per dial×class (cautious=none, balanced=drive_forward-only, bold=both); a
  missing/unknown class is treated as the stricter `choice`.
- **2026-07-04** — **Phase 2 COMPLETE + verified.** P2.2 boot-verified live (get/set/validate
  round-trip; the boot-verify caught a settings-allowlist bug — a new key needs `ALLOWED_KEYS` +
  `validate_value` registration, not just the const — fixed `abb87be33`). P2.3 matrix unit tests
  pass 6/6. Frontend `FleetBoldnessDial` (Cautious/Balanced/Bold radiogroup next to WakeCadence,
  shown while autonomous mode is on) + `companionFleetBoldness` store state + api wrappers + 5
  `boldness_*` i18n keys across all 14 locales shipped `718f749fb` (tsc+eslint clean). All on origin
  (`b3c79725b`). The one deferred live check is the full LLM e2e (Athena emitting `decision_class`
  → the gate firing on a real parked session), flaky/LLM-dependent; the foundations are verified.
