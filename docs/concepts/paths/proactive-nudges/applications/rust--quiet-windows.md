---
layer: application
subject: proactive-nudges
technique: quiet-windows
stack: rust
---

# Quiet windows — Athena's quiet-hours check (Personas)

The technique's declared-window discipline as implemented in
`src-tauri/src/companion/proactive/quiet.rs`, whose module doc is itself a
model of the technique's central demand: the boundary semantics are
written down once as a five-point contract and enforced by property tests
in the same file ("changing one means updating both the comment and the
test").

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Declaration | quiet windows are `quiet_hours` / `focus_window` rituals with `{ days?, from, to }` in local wall-clock `HH:MM`; multiple active windows union (`is_quiet_now`, `quiet.rs:63-79`) |
| Pinned edge semantics | contract point 1: `from` inclusive, `to` exclusive, minute granularity (`window_contains`, `quiet.rs:112-119`); property test `boundary_inclusion_same_day` walks both edges for arbitrary same-day windows |
| Midnight wrap | contract point 3: `from > to` means `[from, 24:00) ∪ [00:00, to)`; `wrap_inverts_membership_on_interior_points` proves the wrapped form is the exact complement of the same-day form on interior minutes — the property-style oracle the technique asks for |
| Degenerate window pinned | contract point 2: `from == to` is **zero-length, never quiet** — with the rationale recorded: equal endpoints most often mean a half-edited config, and silently converting that into 24-hour silence is worse than a no-op. `from_eq_to_is_never_quiet` holds for every (window, now, weekday) triple |
| Malformed-config posture | empty `days` array never matches (same don't-silently-widen logic); unparseable schedules are skipped, not guessed at (`quiet.rs:70-73`) |
| Timezone honesty | evaluated against the user's current local clock at each check (`Local::now()`), never a stored offset; contract point 5 pins DST as wall-clock-only, including the fall-back day's doubled 01:30 being quiet twice |
| Gate sees the target | the check runs at **delivery**: `release_pending` holds all queued rows while quiet (`mod.rs:388-392`) and they release once the window closes — deferral crossing a window edge is re-checked at the moment that matters |

## Judgment calls worth copying

- **The contract comment and the property tests reference each other by
  name.** Five numbered semantics points in the module doc, each mapped
  to a named test; the tests' own header declares them "the only place
  the semantics are written down once and checked everywhere." This is
  what "pinned by tests" means as a practice, not a slogan.
- **Complement-property over example points.** Instead of enumerating
  wrap cases, one property asserts same-day and wrapped membership are
  mutual complements on interior minutes — the class of off-by-one wrap
  bugs cannot survive it.
- **Quiet suppresses delivery, not noticing.** Evaluation during quiet
  hours is also skipped as an economy (`evaluate_with_extra_candidates`,
  `mod.rs:128-131`), but queued rows waiting out a window release well
  inside their expiry — the decoupling keeps the 02:00 signal for 07:01.

## Gaps against the technique (reported, not fixed)

- **No priority bypass class exists — and its absence is unmanaged in
  both directions.** Nothing crosses a quiet window via a declared
  class; instead, direct-delivery callers (`deliver_now` at
  `mod.rs:546-560`) decide individually whether to re-check quiet:
  message triage and execution review do check inline
  (`message_triage.rs:457`, `execution_review.rs:853`), the night-shift
  wake report path does not, and no crossing is counted or labeled. The
  technique requires a closed, enumerated, counted class — per-call-site
  judgment is exactly the bypass-creep shape it forbids.
- **No shipped default night window.** Quiet exists only if the user
  creates a ritual; the out-of-the-box configuration can nudge at 03:00.
  The technique ships a sane default because the users most harmed never
  open settings.
- **The budget's day boundary does not share the quiet layer's timezone
  honesty** — quiet is local wall-clock, the budget day is UTC
  (`budget.rs:234`), so the two policy clocks disagree by the user's
  offset. One subject, one clock discipline.
