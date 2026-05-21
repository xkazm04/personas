# Persona Monitor

The **Persona Monitor** is the full-screen fleet view, launched from the
titlebar. It fuses two signals — human reviews awaiting a decision and live
process activity — onto a single grid of persona cards, so the state of a
100+ persona fleet is legible at a glance.

## Opening it

The titlebar **activity** button (between the schedule calendar and the
notification bell) opens the Monitor. The button shows:

- **Attention badge** — a count of items that need you: pending human
  reviews + processes blocked on input (`input_required`, `draft_ready`).
- **Pulsing ring** — appears while any persona has a `running` process.
  Colour answers "do I need to act?"; the pulse answers "is the fleet busy?".

Press `Esc` (or click the titlebar button again) to close.

## The grid

One card per persona, fleet-wide — including idle personas.

- **Card colour = attention.** The highest-priority unresolved item wins:
  `critical review` → `input needed` → `warning review` → `draft ready` →
  `info review`. A persona with nothing pending is **muted** ("Idle").
- **Live pulse = activity.** A pulsing dot marks personas with running work;
  cards also show an elapsed timer, queued count, and per-severity review
  badges.
- Cards are sorted worst-first: critical attention → … → busy-but-clear →
  idle.

### System band

App-level activity that isn't tied to a persona — idea scans, context maps,
the task runner, queued runs with no persona — appears in the **System band**
above the grid. The band is hidden when there is no such activity.

> A process is placed on a persona card via its `personaId`, its navigation
> target, or an exact `label === persona.name` match. Execution rows emitted
> by the runner carry the persona name as their label, so live runs land on
> the right card; genuinely app-level work (idea scans, context maps, the
> task runner) has no persona and is shown in the System band by design. The
> only edge case is two personas sharing an identical name — a label-matched
> process then attributes to one of them.

## The drawer

Clicking a card opens a drawer that slides **down** from the top over the
grid (the grid stays mounted underneath). It has two stacked sections:

- **Reviews** — inline triage. Each review can be approved or rejected, with
  an optional note. Local and cloud reviews are both handled here.
- **Activity** — the persona's live processes. Execution rows expand into a
  reasoning trace; rows with a navigation target jump to the relevant screen.

## Relationship to Overview → Approvals

The Monitor is the fleet-wide, header-launched view. The Overview →
**Approvals** tab keeps its focused inbox / focus-flow experience as the
alternative, queue-oriented way to work through reviews. Both act on the same
underlying human-review queue.
