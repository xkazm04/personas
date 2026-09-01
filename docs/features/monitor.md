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

> Restructured 2026-08-26: the header is now a ROUTER of four top-level views
> — **Activity (default) | Timeline | Conversations | Map** — replacing the
> old two-level switching (view-mode toggles + the Channels workspace's own
> nested layout pills). The persona search input was removed with the columns
> view it filtered; the Live pop-ups toggle is icon-only (Bell) with its label
> in the tooltip. The last-selected tab persists across monitor opens within a
> session.

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

## Views

### Activity (default)

The whole fleet as state-coloured persona squares grouped by team into slim
columns (running / attention / failed / idle, corner legend). Each square
additionally wears its **dominant pending operation** as a corner icon+count
badge — failed > review > input-required > draft > message — with the full
breakdown in the tooltip. Below each team's personas, a divider introduces the
**fleet-session lane**: one small hollow square per live Fleet session
dispatched under that team's dev project (session → project by working
directory, project → team by `team_id`), border-coloured by the canonical
fleet state palette. Teamless sessions and personas share the Ungrouped tray.
The System band (persona-less app-level processes) sits above the board.

> The former per-project columns view (MonitorProjectColumns) was descoped
> 2026-08-26; its operation badges migrated onto the Activity squares.

### Timeline

The read-only cross-team log (formerly Channels → Timeline): virtualized
30px radio rows, five composable lens dimensions in the left tuner rail
(kind · event family · callsign · channel · search) with live counts. Rows
sign with a real voice — persona callsign, You / Athena / Director, bridged
Slack names — and step rows show their lifecycle label (step_running /
step_done / ...), so consecutive lifecycle rows never read as duplicates.

### Conversations

The messenger, and the only place you write. Team channels (bands for
assignments/deliberations interleaved with talk bubbles, composer with
goal-routing) and **persona conversations** (chat bubbles with optimistic
echo, Reports as clamped markdown previews with an attachment chip opening
the full Report viewer, events/memories as subtle system lines, human
reviews as inline quick-decide cards with an open-in-Reviews forward).

The team composer never disables itself. Pressing Enter while a directive
or a goal-route is still in flight puts the next prompt in a visible **queued
row** at the bottom of the conversation; the outbox drains one post at a
time, consecutive plain prompts fold into one directive body (their rows
stay separate), and a goal is never folded. A post that fails marks its own
row **Not delivered** with Retry / Discard, and the toast says why; the rows
behind it keep going. Switching projects abandons the outbox, because a
directive is addressed to one team. On send, your own row is posed at the top
of the viewport with a reserve below it that shrinks as replies land, so the
pose is a legitimate bottom and follow-to-bottom stays armed. Both side
rails - the projects sidebar (left) and the Reviews/Deliberation rail (right)
- resize by drag or arrow keys and remember their width, exactly like the
Activity rail. A deliberation whose engine-written JSON is malformed no
longer blanks the rail; its status caption is translated.

### Map

The live constellation for one team — who is doing what to whom; a node
click drills into the Timeline scoped to that persona.

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
