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
> 2026-08-26; its operation badges migrated onto the Activity squares. Its
> three orphaned files were deleted 2026-09-02.

**The board says when it cannot read its data (2026-09-02).** The three feeds
behind the board (pending reviews, unread messages, persona health) used to
fail into silence — a log line, then a fleet of idle-grey tiles that read as
"your fleet is calm". A warning strip (`MonitorFeedStatus`) now sits above the
board naming each feed that failed and stamping the picture with "as of" the
**oldest** successful read across the feeds, so one healthy feed cannot make a
stale board look fresh. The strip renders nothing when every feed answered;
the rows underneath are never replaced by it. A quick-execute from the
Capabilities tab that fails now toasts instead of spinning back to idle.

**The Claude usage strip (2026-09-05).** A thin row between the board's
header and its project columns shows how much of the signed-in Claude
subscription this machine has burned: one meter per rolling rate-limit
window — the **5-hour** session window and the **7-day** window, plus the
per-family weekly windows (Opus, Sonnet) on accounts that report them — each
with its utilisation, a **reset countdown**, and a **pace** verdict
(*burning fast* / *on pace* / *under pace*: utilisation against how much of
the window has already elapsed). A plan chip names the tier the CLI stored
(Pro, Max 5×, Max 20×, Team, Enterprise). Meters turn warning at 75% and
error at 90%, and every non-ok state carries an icon and a label, never
colour alone. The source is Anthropic's OAuth usage endpoint — the same one
the community usage monitors opt into — read with the Claude Code login
already on the machine (`~/.claude/.credentials.json`, or
`CLAUDE_CODE_OAUTH_TOKEN`); the token goes to the host that issued it and
nowhere else, and never crosses IPC. An install with no OAuth login (API-key
users, a macOS Keychain-only login) gets one calm *Usage unavailable* chip
whose tooltip says why; it never fakes a meter. Backend cache 45s, poll 60s.

**Tiles speak (2026-09-05).** When a persona posts in its team channel, its
latest line slides in over its tile as a speech bubble and fades on its own
after ten seconds; a small chat mark with a count stays on the tile until the
operator opens that persona, which clears it. One bubble per persona — a
second line inside the window replaces the first and restarts the clock. The
bubbles are fed by the same channel cache the rail's Messages tab already
holds open, so they cost no extra reads. Athena, the director, steps, events,
memories and the operator's own directives never bubble — only a persona with
something to say.

**The cold open is staged (2026-09-05).** Opening the Monitor for the first
time in a session used to commit the whole board at once — the card, every
tile, and the rail's three feeds — behind a header-only skeleton. The board
now paints its chrome first (header, usage strip, column headers, ghost rows
the exact size of the tiles, and an empty rail of the persisted width), the
tiles the next frame, and the rail the frame after; a Monitor opened before
the roster exists shows the same chrome over a ghost board rather than a
settled empty state. Once the board has painted in a session, every later
open is warm and renders complete in one commit. The terminal and recap
modals are chunk-loaded on first use, so xterm is no longer part of opening
the board.

**Messages arrive on the event, not the poll (2026-09-02).** A persona's new
report lights its tile the moment the row lands: the board listens on the same
`report-created` event the Overview report list uses (one shared
subscription), and the 30-second poll stays as the fallback. A burst of
reports costs at most two reads. An unchanged poll is also free all the way
down now — messages and persona-health keep their array/record identity when
nothing moved, so an idle fleet no longer re-sorts and re-renders every tile
twice a minute.

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
