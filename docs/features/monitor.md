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

## The global fleet activity strip

A **1px-tall, 20-slot activity strip** sits directly under the titlebar in
*every* screen of the app (not just the Monitor) — so you always have a
peripheral read on how much live work the fleet is doing without opening
the Monitor.

- One slot = one currently-running execution. Slots fill left-to-right.
- The colour is the active theme's primary (cyan on midnight, amber on
  amber, magenta on magenta, etc.).
- Each slot **fades and scales in** when an execution starts and fades out
  when it finishes, so the strip is a live heartbeat — not a per-persona
  map and not a summary of attention.
- The strip caps at 20 simultaneous runs; beyond that the visual saturates
  (and the Monitor's per-persona view is the place to dig in).
- When no executions are running the strip is invisible but still
  reserves its 1px, so the page never re-flows as work comes and goes.

The component is `FleetActivityStrip` and is mounted between `<TitleBar />`
and the rest of the app in `App.tsx`. Reduced-motion users get the same
populated state without the fade animation.

## The grid

One card per persona, fleet-wide — including idle personas.

### Card anatomy — the Pillar layout

Each card has a hairline **1px top strip** that carries the state signal,
with the title anchored to the top and the caption + badges + icon
grouped at the bottom via flex justify-between:

```
┌──────────────────────────┐
│──────────────────────────│   1px top strip (state colour)
│ Persona Name             │   title, 2-line clamp — anchored top
│                          │
│                          │
│ running · 2m 14s         │   state caption (clickable)
│ [3⚠] [2✉]            🧠 │   badges left · persona icon bottom-right
└──────────────────────────┘
```

- **Top strip** — encodes execution state at the highest priority level
  (running > failed > input_required > draft_ready > queued > attention >
  idle). The strip pulses for live work (`running`, `input_required`).
- **Title** — fills the full card width, clamps to two lines, and anchors
  to the top of the card so the bottom rail is always visually aligned
  across the grid.
- **State caption** — a short, colour-coded label (`running · 2m 14s`,
  `Last run failed`, `Input needed`, `Draft ready`, `Queued`, `Pending
  review`, `Idle`). When the caption refers to live work, it is clickable
  and opens the drawer's **Activity** section.
- **Attention badges** — bottom-left. Reviews (tinted by highest severity)
  and unread messages each get their own badge; clicking opens the
  corresponding drawer section.
- **Persona icon** — bottom-right as a slightly muted signature mark; lifts
  to full opacity on hover.

Idle cards (no badges, no active work) become wholly clickable and open the
**Capabilities** section so you can quick-fire the persona.

Cards sort worst-first: failures → things needing you → just-busy → idle.

### Group by

If any **teams** exist (see [personas](./personas/README.md) § Home team),
the header shows a **By home team** toggle. When enabled, the grid is
partitioned into sections — one per team that is some persona's home team,
plus an **Unassigned** section for personas with `home_team_id = null`.
Each section header carries the team's color stripe and a chevron to
collapse the section locally (state is per-session, not persisted). Teams
with no visible personas (after the active-project filter) are hidden so
the header isn't padded with empty sections.

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
