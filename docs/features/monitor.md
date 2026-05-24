# Persona Monitor

The **Persona Monitor** is the full-screen fleet view, launched from the
titlebar. It puts every persona on one grid so the state of a 100+ persona
fleet is legible at a glance, and lets you triage reviews, read messages, and
inspect live activity without leaving it.

## Opening it

The titlebar **activity** button (between the schedule calendar and the
notification bell) opens the Monitor. The button shows:

- **Attention badge** — a count of items that need you: pending human
  reviews + unread messages + processes blocked on input.
- **Pulsing ring** — appears while any persona has a `running` process.

The companion, **Athena**, can also open it — ask her for a fleet overview
("how are my personas doing?") and she summarises in chat and opens the grid.
See [companion](./companion/README.md).

Press `Esc` (or click the titlebar button again) to close.

## The grid

One card per persona, fleet-wide — including idle personas.

### Card colour = execution state

The card colour encodes the persona's execution lifecycle:

- **Running** — bright, with a pulsing ring. A process is executing now.
- **Failed** — red. The most recent execution failed.
- **Attention** — the default app tone. Idle, but something is pending.
- **Idle** — muted. Nothing running, nothing pending.

### Badges = required attention

Below the persona name, each pending-attention type gets its own badge —
**reviews** (tinted by highest severity) and **unread messages** — as
`icon + count`. The activity dot (top-right, shown when the persona has
processes) is the third affordance.

There is **no whole-card click** — every badge is its own button:

- Review badge → opens the drawer's **Reviews** section.
- Messages badge → opens the **Messages** section.
- Activity dot → opens the **Activity** section.

Cards sort worst-first: failures → things needing you → just-busy → idle.

### Group by

If any **persona groups** exist (see [personas](./personas/README.md) §
Persona Groups), the header shows a **By group** toggle. When enabled,
the grid is partitioned into sections — one per group, plus an
**Ungrouped** section for personas with `group_id = null`. Each section
header carries the group's color stripe and a chevron to collapse the
section locally (state is per-session, not persisted). Groups with no
visible personas (after the active-project filter) are hidden so the
header isn't padded with empty sections.

### System band

App-level activity not tied to a persona — idea scans, context maps, the task
runner — appears in the **System band** above the grid.

> A process is attributed to a persona via its `personaId`, navigation
> target, or an exact `label === persona.name` match. Execution rows emitted
> by the runner carry the persona name, so live runs land on the right card;
> genuinely app-level work has no persona and shows in the System band.

## The drawer

Opening a badge slides a drawer **down** from the top over the grid (the grid
stays mounted). It has three switchable sections:

- **Reviews** — inline triage: approve / reject with an optional note. Local
  and cloud reviews both appear here.
- **Messages** — unread messages for the persona, each with mark-as-read.
- **Activity** — the persona's live processes; execution rows expand into a
  reasoning trace, and rows with a navigation target jump to that screen.

## Relationship to Overview → Approvals

The Monitor is the fleet-wide, header-launched view. The Overview →
**Approvals** tab keeps its focused inbox / focus-flow experience as the
alternative, queue-oriented way to work through reviews. Both act on the same
underlying human-review queue.
