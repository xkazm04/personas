---
layer: application
subject: job-coordination
technique: job-state-machines
stack: rust
---

# The build-session phase machine

`BuildPhase` (`src-tauri/core/src/models/build_session.rs:11-99`) is the
repo's most complete job state machine, and it lands almost every clause of
the technique in ~90 lines.

## One authority, closed vocabulary

The eleven phases are one `enum`, `#[ts(export)]`ed so the client's type is
*generated from* the same definition rather than hand-copied — the
one-authority law held across the language boundary. `as_str` /
`from_str_value` (`:26`, `:51`) are the only string mappings, and the
parser is **strict**: an unknown stored value returns `None`, with the doc
comment naming the temptation it refuses — "instead of silently mapping to
`Failed`." The row mapper surfaces it as a real error
(`src-tauri/db/src/repos/core/build_sessions.rs:33-37`), so vocabulary
drift between schema and code becomes a loud defect, not a plausible
verdict.

## Classifier, transition table, history

- **State classes:** `is_terminal()` (`:42`) is the classifier the
  recovery and expiry sweeps branch on; `AwaitingInput` (`:14`) is a true
  paused state — the wizard's persisted question lives on the row
  (`pending_question`), so the machine distinguishes waiting-on-a-human
  from stuck.
- **Transition relation:** `validate_transition` (`:69-98`) enumerates
  legal exits per phase and rejects the rest with a message naming both
  ends. Terminal phases return `false` for all ordinary exits (`:86`) —
  verdicts are final on the normal paths.
- **History:** `append_phase_timing`
  (`src-tauri/db/src/repos/core/build_sessions.rs:226`) appends
  `{phase, ts}` to an append-only JSON column at each transition, so
  per-phase wall clock is reconstructable from the record alone — the
  transition trail as a queryable artifact.

## The escape hatch, and where it leaks

The table opens with the classic escape hatch: *any* phase may move to
`Failed` or `Cancelled` (`:70-73`) — which is what makes the bulk expiry
sweep (`expire_stale_non_terminal`) legal without bypassing the door. But
the check runs **before** the terminal guard, so `Completed → Failed` and
`Promoted → Cancelled` also validate: the escape hatch is "any state," not
"any non-terminal state," and a re-run sweep or a stale executor could
lawfully rewrite a final verdict. This is the technique's bound-the-
escape-hatch rule violated in the wild — currently unregistered (no
deferred-fixes anchor); reported upward by this subject's forge as a
candidate.

## The two-store shape next door

The n8n transform pipeline shows the same machine split across the
subject's two stores: durable session rows with `status` + `step` columns
(`src-tauri/db/src/repos/resources/n8n_sessions.rs`) beneath an in-memory
job manager holding the live execution state — snapshot, log ring, cancel
token (`src-tauri/src/commands/design/n8n_transform/job_state.rs:41-50`).
The start path guards admission with an atomic check-and-insert keyed on
the *session*, not just the transform (`cli_runner.rs:66-91`), and boot
recovery re-verdicts the rows while returning the ids whose in-memory
half must be purged — the record precedes the process, and the process's
state is treated as the cache it is.
