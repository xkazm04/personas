---
layer: application
subject: wizard-flows
technique: snapshot-and-resume
stack: rust
---

# The build-session FSM — server-side snapshot and resume in this repo

The persona build wizard is the repo's heaviest guided flow: an LLM
subprocess resolves a persona across phases, pausing whenever it needs a
human answer. Its interruption story is the technique's "system-of-record
persistence" tier, chosen deliberately over client storage — the flow has
expensive server work in flight from the first step, so the pointer lives
in the same SQLite row as the effects.

## The durable model: `src-tauri/core/src/models/build_session.rs`

- `BuildPhase` (`:11-23`) is the flow's position vocabulary, one closed
  enum — including **`AwaitingInput`** (`:14`), which makes the *pause
  itself* a first-class phase rather than a live process blocked on a
  prompt. The paused question is durable state on the row
  (`pending_question`, `:270`), so a restart mid-question loses nothing.
- `validate_transition` (`:69-98`) enumerates every legal move; any phase
  may fail or cancel, but `AwaitingInput` can only proceed to `Resolving`,
  and terminal phases (`is_terminal`, `:42-47`) transition nowhere. An
  illegal transition is an `Err` with both phase names in it — a guarded
  transition, enforced where the writes happen.
- `from_str_value` (`:49-66`) parses a stored phase back and **returns
  `None` for unknown values "instead of silently mapping to `Failed`"**
  (the doc comment says exactly this) — the unreadable-snapshot outcome
  spelled differently from every readable one.
- `BuildSession` (`:262-320`) is the snapshot: identity, phase, resolved
  cells, the pending question, the originating intent, the subprocess pid,
  and append-only `phase_timings_json` (`:297-301`) so per-phase
  wall-clock is reconstructable from persisted data alone.
- `UserAnswer` (`:336-357`) is the resume input — the frontend answers a
  paused session by id — and `PersistedBuildSession::from_session`
  (`:410-470`) is the hydration payload a cold-started client rebuilds its
  view from. Nothing about resume needs the process that paused.

## The reaper and the boot recovery

- `expire_stale_non_terminal`
  (`src-tauri/db/src/repos/core/build_sessions.rs:308`) collects sessions
  abandoned in non-terminal phases. It **cancels rather than deletes**,
  routes every row through the same `validate_transition` legality check,
  is idempotent, deliberately spares a draft persona's in-flight build —
  and ships enabled (wired into the background tick). Expiry resolves to a
  recorded outcome, not a disappearance.
- `recover_interrupted_sessions`
  (`src-tauri/db/src/repos/resources/n8n_sessions.rs:167`) is the boot
  pass for the n8n import wizard's sessions: rows the process died inside
  are rewritten with an explanatory error ("App closed during transform —
  click Retry to resume") so the resume surface presents them as
  *retryable*, not broken. Crash → offer, not ambush.

## The client-side re-attach tier, for contrast

Template generation runs as a background job keyed by a minted id
(`tpl-gen-${Date.now()}`, `useCreateTemplateActions.ts:47-56`), persisted
to a local context with a `savedAt` stamp. On return,
`usePersistedContext.ts` validates the context, **discards it past
`maxAge`** (the snapshot naming its reaper), and re-attaches by id;
`useCreateTemplateSnapshot.ts` then polls the job snapshot and — notably —
treats a completed job with a malformed result as a *reported failure*
("Generation finished but the result was malformed", `:36-56`), because
"completed with no result was indistinguishable from a slow run" (`:72-73`).
The re-attach honesty the technique asks for, in both tiers.

## Deviations on file

- **`n8n_transform_sessions` has no reaper at all** — the only `DELETE` is
  by explicit id (`n8n_sessions.rs:215`); the live database's entire table
  was measured at two abandoned 129-day-old rows carrying ~13KB of raw
  user workflow JSON each. Resume exists, boot recovery exists, expiry
  does not.
- **`sweep_stale_drafts` ships disabled** —
  `DRAFT_RETENTION_DAYS_DEFAULT = 0` (`src-tauri/db/src/settings_keys.rs:99`)
  reads as "off", so the draft-persona reaper has never run in the live
  database. The legacy golden path's verdict stands: a default-off reaper
  is indistinguishable from no reaper, and the fix is the default, not a
  gate.
- **`usePersistedContext` removes a corrupt context silently** (`catch`
  → `removeItem`, `:74-77`) — unreadable renders identically to absent,
  one notch quieter than the technique's rule; defensible for a
  low-stakes re-attach hint, but the build-session tier shows the louder
  form costs nothing.
