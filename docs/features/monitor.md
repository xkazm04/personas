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
breakdown in the tooltip. Below each team's personas, a hairline introduces the
**fleet-session lane**: one small hollow square per live Fleet session
dispatched under that team's dev project (session → project by working
directory, project → team by `team_id`), border-coloured by the canonical
fleet state palette. Teamless sessions and personas share the Ungrouped tray.
The System band (persona-less app-level processes) sits above the board.

**The board wraps at five columns (2026-09-07).** Columns ran in one unbounded
horizontal row, which put the twentieth project several screens right of the
first. They now run five to a row — or fewer when the board is narrower than
five columns, measured live against the resizable rail — with a subtle rule
between rows, and the board scrolls vertically. A column is therefore
content-sized rather than full-height (a row is as tall as its tallest column),
with its roster capped at ten rows and scrolling inside itself beyond that. The
session lane's **"Live Claude Sessions"** caption was removed in the same pass:
a session tile is already shorter, hollow and dashed against a solid persona
tile, so the word restated the shape below it once per column. It remains as
`sr-only` text for assistive tech.

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

**The Claude usage strip (2026-09-05, reshaped 2026-09-06).** A band between
the board's header and its project columns. The **title row** carries the
label on the left and, on the right, the "as of" stamp with a refresh button
that is only live once the five-minute cache has elapsed. Under it sit
**five plan slots** of equal width: one card per Claude login, added one at
a time until all five are filled; empty slots stay empty and keep their
width, so the first plan is exactly as wide as the fifth will be. A card
shows its **account** on the header line — aligned with its own meters,
which is what a column is for — and beneath it one meter per rolling window:
the **5-hour** session window and the **7-day** window. Each meter is
labelled by the **whole units left** until that window resets (*3h*, *<1h*,
*2d*, *<1d*), and carries two dimensions: the fill is utilisation (brand
tone, warning at 75%, error at 90%), and a vertical **marker** is the clock —
it sits at the fraction of the window already elapsed and warms as the reset
approaches (cool, then warning past 60%, then error past 85%). A **pace**
glyph closes the row (flame ahead of the clock, snowflake behind, gauge on
pace). The exact countdown rides in each row's accessible label. Usage is
cached for five minutes in the module, so re-opening the Monitor paints the
last read without re-fetching and without resetting the stamp. Before any
login is stored the live login occupies the first slot with a *Store* button
on its header; that is the whole add flow — sign in with the CLI, and the
card notices it is not stored yet. The source is Anthropic's OAuth usage endpoint — the same one
the community usage monitors opt into — read with the Claude Code login
already on the machine (`~/.claude/.credentials.json`, or
`CLAUDE_CODE_OAUTH_TOKEN`); the token goes to the host that issued it and
nowhere else, and never crosses IPC. An install with no OAuth login (API-key
users, a macOS Keychain-only login) gets one calm *Usage unavailable* chip
whose tooltip says why; it never fakes a meter. Backend cache 45s, poll 60s.

**Several plans, one strip (2026-09-05).** The usage strip has a second
mode for operators who juggle more than one Claude subscription. *Store this
login* captures the CLI's current login (the whole credentials file, encrypted
with the app's master key, in the `claude_accounts` table) together with the
account identity from Anthropic's profile endpoint. From then on each stored
plan fills a slot — the active one on a highlighted ground, each with its
5-hour and 7-day meters (fill plus reset marker) and a pace glyph — and
every non-active card has a **Switch** button on its header behind a
confirm. The auto-rotate toggle, threshold and last rotation sit in a
controls row under the slots. A plan is only offered for forgetting when no usage could
be read for it and nothing is remembered; a plan that reads fine is not
clutter.

**Only the live plan is at full strength (2026-09-07).** The strip answers one
question at a glance — how much of the plan being billed to right now is left —
and five equally-bright cards made the eye hunt for which card that was. Only a
quarantined plan was dimmed, so the four cards competing hardest with the answer
were the four in perfect health. Every card that is not the live login now sits
at half opacity and comes to full on hover **or keyboard focus** (its Switch and
Forget controls are tab-reachable). The last rotation, being history rather than
state, recedes the same way.

**Fixed: *Store this login* could never appear on some installs (2026-09-07).**
The button keyed on the snapshot's `activeAccountId`, which is read from
`~/.claude.json`'s `oauthAccount.accountUuid` — a key some installs never write.
On such a machine the operator was logged in and `fleet_claude_account_capture`
would have succeeded (it resolves the account from the profile endpoint first
and only falls back to that file), but the affordance that runs it never
rendered. The snapshot now carries `livePresent` — whether there is a login on
this machine to store at all — and the button keys on that instead, so its
precondition is what the command needs rather than a stricter nearby fact.

**An unreachable plan is projected, not blanked (2026-09-06).** Every
successful usage read is remembered per plan. When the next read fails (the
endpoint rate-limits, the network drops, a token is mid-refresh) the last
read is carried forward to now: a window whose reset is still ahead keeps its
utilisation — this machine did not use the plan, so the figure is a floor —
and a window whose reset has passed shows empty, with the weekly window's
next reset advanced by whole weeks and the 5-hour window's left unknown. Such
a card wears a history mark on its header, its meters are hatched and their
percentages carry an approximation sign, and the tooltip says which read it
was projected from. Not precise, and never claimed to be.

> **Two defects fixed the same day.** The snapshot only reported a live
> account id when that account was already stored, so on an empty table the
> *Store this login* button could never appear — nothing could ever be
> stored, and the strip stayed in single-login mode for good. And the two
> auto-rotate settings keys were not on the settings allowlist, so saving the
> policy was rejected as a validation error. Both are corrected; the keys are
> registered as JSON-validated settings. A switch refreshes
the stored token if it is about to expire, takes Claude Code's own credential
lock directories (`<config>/.oauth_refresh.lock`, `~/.claude.lock`), replaces
`~/.claude/.credentials.json` atomically, and patches `oauthAccount` in
`~/.claude.json` key-scoped; the CLI picks it up on its next message with no
restart. Before every read and switch the live file is synced back into the
store for the account it belongs to, because refresh tokens rotate and a
stale stored copy would die on first use. A stored login whose refresh token
is dead is marked *Needs login* and cannot be switched to until `claude
login` is run for it and it is stored again. **Auto-rotate** (off by default)
switches to the coolest stored plan when the active one reaches a threshold
on its 5-hour window — checked once a minute in the background whether or
not the Monitor is open, with a five-minute cooldown, and only onto a plan
that is under the threshold on both windows. The last automatic rotation is
shown in the strip and toasted when it happens. macOS keeps its token in the
Keychain, which this switcher does not reach; it is a Windows / Linux feature.

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

**The chunk boundaries sit deeper (2026-09-06).** Walking the Monitor's
static imports gave 551 modules against the ~90 the app shell already holds,
and almost all of the excess hung off components that are not on screen when
the Monitor opens onto Activity: the drawer, the three channel surfaces, the
dispatch dock, the Activity rail with its three feeds, and the usage strip's
dialogs and controls. Each is now its own chunk behind a fallback that holds
its exact footprint (the dock's bar, a header ghost for a channel card, the
rail's width, the strip's frame with ghost meters). The eager Monitor graph is
227 modules, 90 of them the shell's. The tiles rise into place with a short
motion when they mount, so data landing reads as data landing.

**Messages arrive on the event, not the poll (2026-09-02).** A persona's new
report lights its tile the moment the row lands: the board listens on the same
`report-created` event the Overview report list uses (one shared
subscription), and the 30-second poll stays as the fallback. A burst of
reports costs at most two reads. An unchanged poll is also free all the way
down now — messages and persona-health keep their array/record identity when
nothing moved, so an idle fleet no longer re-sorts and re-renders every tile
twice a minute.

#### Autopilot — the board's one switch, paced to the subscription

The header's **Autopilot** pill is the attention loop's on/off
(`autonomous_attention_loop`, the same setting Mission Control's Attention
Loop card flips) with a **pacing policy** between the quota governor's stop and
the loop's dispatch budget. The loop already served every persona holding an
active charter whose cadence has the attention loop enabled, up to the
running-work headroom (`max_active_personas`), and stopped at 97 % of either
subscription window; Autopilot decides *how many* of those starts a tick may
make, from three gauges (`src-tauri/src/engine/subscription/usage_pacing.rs`):

| Gauge | Source | Converts into |
|---|---|---|
| 7-day window | the OAuth usage endpoint (`fleet_claude_usage`) | **whether**: the window must be *behind* its linear pace to the weekly target (`elapsed × target`); ahead of pace the loop holds |
| 5-hour window | same | **how many**: the headroom under the worker line (`stop − margin`) scales the parallel cap down — 50 points of headroom opens every slot, less opens proportionally fewer, never zero while any remains |
| physical memory | `system_metrics` (sysinfo) | **how many**: free memory below the memory stop line, divided by what one worker takes |

`slots = min(parallel cap, usage slots, memory slots)`; the tick then takes the
smaller of that and the headroom it already had, so pacing only ever reduces.
An unreadable usage gauge fails open on the usage half (as the governor does)
and the memory half still applies. An untouched 7-day window (no reset stated)
owes the whole target.

**The pill** says the one thing that matters, by precedence: the governor's
stop (`stopped: seven_day at 98%`) over a pacing hold (`holding: ahead of
weekly pace` / `5-hour window full` / `memory full`) over the open slots and
the week's standing (`2/3 slots · behind pace by 12 pt`). Off, it shows how
many personas would qualify. **Its tooltip** carries the three gauges with
their lines, personas running against the cap, today's dispatches, and
**which personas can run on their own** — a persona qualifies when it is
enabled and holds at least one active charter with the attention loop on (the
loop's own work list, restated per persona). Schedule / polling / webhook /
file-watcher triggers start a persona on their own clock regardless of the
switch, and spend the same quota; they are listed beside the eligibility so
the operator can see both.

**Settings → Limits → Autopilot** parametrises it (`fleet_autopilot.*` keys,
plus the two governor lines that were previously settable only from the
database): pacing on/off, personas started per tick (1–10, default 3), weekly
target (10–100 %, default 90), quota stop (50–99.5 %, default 97), worker start
margin (0–40 points, default 10), memory stop (40–95 %, default 75), memory per
worker (256–8192 MB, default 1500). Every value is read fresh on each tick.

`fleet_autopilot_status` returns the whole verdict — switch, pacing, governor,
headroom, per-persona standing — from the same module the tick reads, so the
board never shows a number the loop would not act on. The tick logs the pacing
line in its summary and announces a hold once per transition, the way the
governor's stop is announced.

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
