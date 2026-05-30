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

Press `Esc` (or click the titlebar button again) to close. The Monitor fades
in on open and fades out on close (the mount is wrapped in `AnimatePresence`
so the exit animation plays before it unmounts); reduced-motion users get an
instant open/close.

### One coordinated header surface

The three titlebar surfaces — **Schedule** (a route), **Notifications** (a
right-side tray), and the **Persona Monitor** (a full-screen overlay) — are
coordinated through a single mutually-exclusive controller
(`uiSlice.headerOverlay`: `'none' | 'monitor' | 'notifications'`):

- **Only one overlay is ever open.** Opening the Monitor closes the
  Notifications tray and vice-versa — they can no longer stack and fight.
- **Navigating anywhere closes the open overlay.** Clicking Schedule (or any
  sidebar destination) dismisses the Monitor/Notifications and shows the route.
- **Back and `Esc` close the active overlay first.** The titlebar **Back**
  button closes whichever overlay is open (returning you to exactly the screen
  it floated over) before it falls back to popping the section history; it is
  shown whenever an overlay is open even if the history is empty.
- **Each button carries a clear active state.** While its surface is open, the
  Schedule / Notifications / Monitor button takes a theme-primary background
  highlight (`.titlebar-btn-active`) — including the Monitor button, which
  previously had no open-state indicator.

Athena's "open monitor" pseudo-route and the `Ctrl/⌘+M` shortcut both flow
through the same controller.

## The global fleet activity strip

A **2px-tall, 20-bar activity strip** sits directly under the titlebar in
*every* screen of the app (not just the Monitor) — so the fleet's live state
is **always visible**, and the Monitor reachable, from anywhere. At rest it is
a faint hairline baseline; it brightens as work comes in.

- One bright bar = one currently-running execution. Bars fill **from the
  centre outward**: the first running execution lights the central bar, the
  second switches to the other side, the third steps further out, and so on —
  the strip grows symmetrically from the middle.
- Running bars **ramp the active theme's primary → accent** by their distance
  from centre (centre = primary, edges = accent; re-tints per theme).
- Running bars **slowly pulse in unison** to signal work in progress. All
  running bars read a single shared pulse value, so they breathe synchronised
  rather than each drifting into its own confusing rhythm.
- A **dim tail** of bars continues outward for queued runs, so the strip reads
  as *live work + pressure* — never a per-persona map or a summary of
  attention (that is the grid's job).
- **Hovering** reveals a **centred** floating readout — running / queued
  counts, the oldest run's age, and live USD cost (or just an "open monitor"
  hint when idle) — as an overlay that never reflows the app. **Clicking** the
  strip (at any time) opens the Monitor.
- The strip caps at 20 simultaneous runs; beyond that the visual saturates
  (and the Monitor's per-persona view is the place to dig in).
- The 2px height is always reserved, so the page never re-flows as work comes
  and goes.

The component is `FleetActivityStrip` (mounted between `<TitleBar />` and the
app body in `App.tsx`); its centre-out slot math lives in the pure, unit-tested
`fleetStripModel.ts` (`centerOutOrder` / `layoutSlots`). Reduced-motion users
get the populated state without the synchronized pulse animation.

## The grid

One card per persona, fleet-wide — including idle personas.

### Card anatomy — the Pillar layout (v2)

Each card has a hairline **1px top strip** carrying the state signal, with the
title anchored to the top and caption + telemetry + health + badges + icon
grouped at the bottom via flex justify-between:

```
┌──────────────────────────┐
│──────────────────────────│   1px top strip (state colour)
│ Persona Name        🔧  │   title button (primary open) · hover quick-open
│                          │
│ running · 2m 14s         │   state caption (live elapsed, clickable)
│ 12 tools · $0.030        │   live telemetry (running cards only)
│ ▪▪▪▫▪▪▪  92%             │   recent-run health micro-bar + success rate
│ [3⚠] [2✉]            🧠 │   badges left · persona icon bottom-right
└──────────────────────────┘
```

- **Top strip** — encodes execution state at the highest priority level
  (running > failed > input_required > draft_ready > queued > attention >
  idle). The strip pulses for live work (`running`, `input_required`).
- **Title** — fills the full card width, clamps to two lines, anchors to the
  top, and is itself a **button** that opens the card's most relevant drawer
  section (activity for active states, reviews/messages for attention,
  capabilities for idle) — so every card has a clear primary action.
- **Hover quick-open** — a wrench affordance (top-right, on hover) jumps
  straight to the **Capabilities** section to quick-fire the persona.
- **State caption** — a short, colour-coded label (`running · 2m 14s`,
  `Last run failed`, `Input needed`, …). When it refers to live work it is
  clickable and opens the **Activity** section.
- **Live telemetry** — running cards show live tool-call count and USD cost,
  summed across that persona's running processes.
- **Health micro-bar** — the last seven run outcomes as colour ticks
  (green = completed, red = failed, amber = other), oldest→newest, with the
  success-rate percent. Hovering shows `% success · runs today`. Hidden when
  the persona has no run history.
- **Attention badges** — bottom-left. Reviews (tinted by highest severity)
  and unread messages each get their own badge; clicking opens the
  corresponding drawer section.
- **Persona icon** — bottom-right as a slightly muted signature mark; lifts
  to full opacity on hover.

The card's visual/state mapping is resolved by pure, unit-tested helpers in
`monitorModel.ts` (`pillarVisual`, `captionDescriptor`, `primaryDrawerSection`,
`healthSegments`), keeping the component to markup + i18n.

Cards sort worst-first: failures → things needing you → just-busy → idle.

### Header live chip

When any execution is running, the Monitor header shows a pulsing **live
chip** — running count plus aggregate in-flight USD cost — derived from the
`summarizeFleet` rollup.

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
