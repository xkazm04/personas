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

**The workspace's cross-project group is a framed column, pinned first
(2026-09-20).** Every workspace owns exactly one team that belongs to no
project — its *cross-project group*, the home for personas that work across all
of that workspace's projects (`persona_teams.workspace_id`, one per workspace by
a partial unique index). On the board that group is a different kind of object
and is drawn as one: a faint primary wash behind the whole column, a primary
border and card radius, and a workspace glyph badge in the header. The
per-workspace accent stays where it always was, on the header rule — the frame
says *what kind* of column this is, the rule says *which* workspace. The frame
is deliberately neither dashed nor a ring: dashed already means a queued session
and a primary ring already means selection or the Athena flash, and either would
have made a false claim about the tiles inside. It is drawn as a decoration that
grows outward into the board's own column gap, so the column's content box stays
exactly the measured ladder width and a tile inside a frame lines up with a tile
outside one at every width from 172 to 280.

Two rules change for that column and for nothing else. It **renders while it is
empty** — the ordinary "an empty team is noise" rule would have hidden a
freshly-created group until somebody moved in, which is the one moment it needs
to be visible — and shows a single quiet line naming what lands there. And it is
**pinned to the front of the board**: column order is the order `list_teams`
returns, which is `updated_at DESC`, so any write to any team reshuffles the
board and no `ORDER BY` can pin anything; the hoist is a stable partition in the
board model, leaving every other column in the order it arrived. The board's
empty state still wins over a row of empty frames — emptiness is answered from
the columns' rows, not from their count, so a machine with workspaces and no
personas still reaches "nothing is waiting on you".

The group's header right-click opens its **own** menu — *Open workspace* (jumps
to Dev Tools → Workspaces with that workspace selected) and *Rename group* —
where before it did nothing at all: the header's context menu is the project
on/off switch, and a group has no project to switch.

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

**The usage strip — one row per account (2026-09-21).** The band between the
board's header and its project columns answers *how much subscription is left,
and whose*. It has ONE layout. (For a round it hosted five layouts behind a
switcher; four were deleted along with the switcher and the *Machine & budgets*
block they carried. A layout name a browser profile still holds in localStorage
under `monitor.usage.variant` is read by nothing. The *Dynamic budgets* kill
switch, `fleet.dynamic_budgets`, is unchanged in **Settings → Limits**.)

The **header row** is permanent: the label and a *n/5 plans* count on the left;
on the right the auto-rotate toggle, its threshold and the last rotation, then
the "as of" stamp with a refresh button that is only live once the five-minute
cache has elapsed. Under it, every account is **one 28px row**, across all three
providers, laid out **five to a strip row** — a sixth account wraps to the next
row. Each column's floor is a fifth of the strip (`(100% − 4 gaps) / 5`) with a
14rem minimum under it, so a narrow window drops to fewer columns instead of
scrolling sideways:

```
<provider mark>  <account ………………………………>  [<5h: timer·percent·pace> <7d: calendar·percent·pace> <forget>]
══════════ 7-day utilisation, as the row's bottom border ══════════
```

**The stats are one right-aligned group** (2026-09-21). Both clusters — and the
hover-revealed Forget act — sit together at the row's right edge
(`data-testid="fleet-usage-stats"`, `ml-auto`, 6px between clusters), and the
account name takes everything else. Inside a cluster the icon, the percent and
the pace glyph touch (2px apart): no cluster has a fixed width or a spacer. Two
slots stay fixed so the rows of one column still line up — the percent is 3ch of
tabular digits right-aligned (`99%` fits; a capped `100%` overruns it by one
character) and the pace slot keeps the glyph's 14px even when there is no pace.
The Forget button takes **no width** until the row is hovered or anything in it
has focus (tabbing onto it is itself focus-within, so it is never a zero-width
focus target), so a row without hover gives that space to the email.

- **Provider mark** — the Claude, OpenAI (Codex) or X (Grok) glyph, 16px, in the
  text colour. Its tooltip names the provider and the CLI version when known; for
  Codex and Grok it also says the row is read-only and when the numbers were
  last reported (*reported 3h ago*), because Codex's last report can be hours old.
- **Account** — the login's email (Claude) or the plan type (Codex), truncated,
  with the full value in a tooltip. Before any Claude login is stored, the live
  login is one row of the same component.
- **5-hour cluster** — a timer icon, the percent used, and the **pace** glyph
  (flame ahead of the clock, gauge on pace, snowflake behind; omitted when the
  window is too young or has no reset to pace against). There is **no 5-hour
  bar**.
- **7-day cluster** — a calendar icon, the percent, the pace glyph, same rules.
- **The bottom border is the 7-day meter** — a 2px track along the row's bottom
  edge, filled to the weekly window's utilisation in that window's tone. It is
  the only bar on the row; it is decorative to assistive tech, because the 7-day
  cluster carries the sentence. A plan with no weekly window shows an empty track.

The percent wears the window's **tone** (warning at 75%, error at 90%), and so
does the border's fill. Each cluster's tooltip and accessible name is the full
sentence — *5h 34% · resets in 2h 12m · on pace* — since what is painted is three
glyphs wide. Where a plan simply has no such window (Codex reports only a weekly
one) the cluster shows a dash, never a zero.

**There are no status icons.** No check mark on the live plan, no slot number,
no shield, no history mark. The **live** Claude plan is shown by emphasis alone:
full opacity, a medium-weight name and a subtle success wash on its cell
(`bg-status-success/10`). Every other cell — standby plans, the read-only CLIs,
an empty provider, the loading ghosts — sits on a subtle black wash
(`bg-black/20`) so its content does not float on the strip. Every other Claude plan recedes to 60%
and comes to full on hover **or keyboard focus**; where no plan is known to be
live (and for the read-only CLIs, which have no such notion) nothing recedes. A
plan that cannot be read says why **in words** beside its name — *Needs login*
(a dead refresh token), *Usage unavailable* (the tooltip gives the reason) — and
shows no clusters; it never fakes a meter.

**Acts.** Claude is the only provider the strip *drives*. Clicking an inactive
Claude row (its account name is the real button, so the keyboard reaches it)
opens the same **Switch** confirm as before — a switch changes which plan the
CLI's next message bills to. **Forget** is offered only where no usage could be
read for the plan, as an icon button that appears at the row's end on hover or
focus, behind its own confirm. **Codex** and **Grok** rows are strictly read-only
(`fleet_cli_usage`, polled every five minutes while the board is open): their
numbers come from each CLI's own records and never feed auto-rotate or pacing. A
provider with nothing to meter is still one row — its mark, and *Not installed*,
*No quota source*, *No sessions yet* or *Unreadable* where the account would be:
0% is a reading, and "not installed" is not.

**Loading.** Before a read settles, the header is already there and a
geometry-matched ghost row stands in for each provider — never a spinner. Usage
is cached for five minutes in the module, so re-opening the Monitor paints the
last read without re-fetching and without resetting the stamp.

**Source.** Anthropic's OAuth usage endpoint — the same one the community usage
monitors opt into — read with the Claude Code login already on the machine
(`~/.claude/.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN`); the token goes to
the host that issued it and nowhere else, and never crosses IPC. An install with
no OAuth login (API-key users, a macOS Keychain-only login) gets one row saying
*Usage unavailable*, whose tooltip says why. Backend cache 45s, poll 60s. Every
row comes out of one joined model (`grid/usage/useResourceModel.ts`), so the
three providers are described by the same two-window grammar.

**Simulation** fills every branch: five Claude plans (live, warning, estimated,
unreadable, needs-login) with per-model weekly windows on the live one (which the
row ignores — its 7-day cluster is the all-models window), Codex on a `pro` plan
with only a 7-day window last reported three hours ago, and Grok not installed.

**Several plans, one strip (2026-09-05; rows since 2026-09-21).** The usage
strip serves operators who juggle more than one Claude subscription. Storing a
login captures the CLI's current login (the whole credentials file, encrypted
with the app's master key, in the `claude_accounts` table) together with the
account identity from Anthropic's profile endpoint. From then on each stored
plan is a row — the active one at full strength — and every non-active row
switches on click, behind a confirm. A plan is only offered for forgetting when no usage could
be read for it and nothing is remembered; a plan that reads fine is not
clutter.

**The login is stored on sight, and the controls live in the strip's own
header (2026-09-17).** The *Store this login* button and the "not stored yet"
notice are gone: the moment the backend reports a live login that is not one
of the stored plans (`livePresent && !liveCaptured`), the strip stores it
itself (`useAutoCapture`) and shows the usual *Stored … as plan N* toast — once
per login, guarded by a module-scoped set keyed on the live email, so a
capture that fails toasts once (through `toastCatch`, so it also reaches
Sentry) and never loops on the next poll or remount, while a different login
arriving later still gets its own attempt. Forgetting a plan stays a
deliberate act on the row. The strip's header row now carries the title and
a *n/5 plans* count on the left and, on the right, the auto-rotate toggle,
its threshold and the last rotation, followed by the refresh control; they
used to be portaled into the Activity card's header, which put the control
one row away from the thing it acts on.

**Only the live plan is at full strength (2026-09-07).** The strip answers one
question at a glance — how much of the plan being billed to right now is left —
and five equally-bright plans made the eye hunt for which one that was. Only a
quarantined plan was dimmed, so the four plans competing hardest with the answer
were the four in perfect health. Every plan that is not the live login now
recedes (60% since the 2026-09-21 rows) and comes to full on hover **or keyboard
focus** (its Switch and Forget controls are tab-reachable). The last rotation, being history rather than
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
a row's percentages carry an approximation sign and sit back, its bottom border
is drawn at half strength, each cluster's sentence ends in *Estimated*, and the
tooltip says which read it was projected from. Not precise, and never claimed to be.

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

**The dispatch dock's controls (2026-09-17).** The expanded dock is the
input, a chip rail, and one controls row: model and effort presets, the meta
line, and an icon toggle for background (headless) dispatch, pressed state
carried by `aria-pressed` and the primary tint, spelled out in its tooltip.
The `@` / `/` grammar is the input's own placeholder now rather than a hint
under it. A grid button at the input's leading edge opens the **skill picker**
above the console: the Skills → Registry heatmap (workspace axis, the same
component and adoption door as the tab) hosted as an anchored popover. A
filled cell loads that project and skill into the console as chips, an empty
cell installs the skill in that repo first and then loads it, and the skill
name picks it in the project already chosen (else the first repo that has
it). The registry is only fetched while the picker is open; a typeahead token
in the input outranks it, and Escape closes the picker before the dock.

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

#### Orchestration panel — the next tick, read-only

Opened from the Activity board, the **Orchestration** panel is a `BaseModal`
(`src/features/fleet/monitor/grid/orchestration/OrchestrationPanel.tsx`, exported
from that folder's `index.ts`; the board-header button lands in a later
package) around the autonomous-agent ledger that used to be the third tab of
the Schedules overlay (moved 2026-09-17). The schedule module was built for
time-triggered personas — a trigger fires at a moment and the calendar shows
the moments. Autopilot adds a population with no moment at all: personas the
attention loop wakes on its own tick, as many per tick as the pacing allows,
and for them the question is *what would the next tick do*. That is a Monitor
question, so the ledger sits beside the Autopilot pill that paces it.

`fleet_dispatch_preview` walks the roster with the loop's own admission
ladder in PROBE mode (`admit_persona(…, probe)` — the wake request is looked
at, not spent; no ledger row, no job) and reports per persona: interval floor
and self-pacing, last served, wake, the lane the tick would take
(`find_work`, read-only), and the verdict — *Starts #k* (within the tick's
budget = pacing slots capped by the running-persona headroom), *Waits for a
slot*, *Sleep consolidation only*, *Nothing pending*, *Off*, or *Refused* with
the rung (`AttentionRefusal::kind`) and the loop's own sentence in a tooltip.
The **ledger** (`OrchestrationLedger.tsx`) is an engineering table where every
input of the ladder is a column and the verdict is the last one, with four
counters above (budget, would start, waiting, held) and the budget band
(`BudgetBand` in `parts.tsx`: starts, waiting, running against the cap, and
any pacing hold). `useDispatchPreview` polls it every 30 s while the panel is
open, pauses while the tab is hidden, and keeps a warm copy so a re-open
paints at once.

**It is read-only, with one switch.** The operator dispatch order
(`fleet_autopilot.dispatch_order`, its `fleet_dispatch_order_set` command and
the ledger's rank column) is retired — boot migration **e37** deletes the
setting row. Rows sit in the order the loop will walk them (a pending wake,
then least recently served, then roster age), and *who goes first when a slot
opens* is the dispatch queue's own order below: every autopilot start is
admitted through the one door and waits in queue rank, so there is one order,
not a tick-side one that could disagree with it. What remains operable is each
row's **Active** switch (the same `personas.enabled` the editor header and the
Monitor tile flip), which paints its new value at once, holds it until the
preview agrees, and drops it on a failed write; a persona whose project is
switched off shows a held-off toggle with the project named on hover.

**A cycle is a goal.** Every autopilot dispatch of a persona into a project's
worktree is one **cycle**, and the cycle is a `dev_goals` row the worker is
bound to (`fleet_sessions.goal_id` / `cycle_index`, visible on the queued tile
and in the Goals tab). The row is an ordinary goal whose description opens
with the marker `[cycle:<persona_id>:<n>]`; the tick claims the persona's
newest *open* cycle goal in that project (set `in-progress`) or creates
`"<persona> · cycle 1"` from the charter's objective. The worker's brief ends
with a cycle block telling it to file the **next** cycle through the goal
write-back — `POST /dev-tools/goals/{goal_id}/amend` with
`next_cycle: { title, description }` — which lands as an *open* child goal
(`parent_goal_id` = the running cycle, marker `n+1`). When the worker reaches
`finished`, the harvest (off-thread, from the one state-transition door)
closes the cycle `done` and, if a successor was filed, re-enqueues the persona
**at the tail** of the dispatch queue on the successor (origin `autopilot`,
same worktree, args and run label, `cycle_index = n+1`) gated by
`not_before_ms = now + the persona's interval floor`, after probing the tick's
own admission ladder — quiet hours, the daily cap, the budget and the
concurrency cap still refuse, in which case the successor stays open for the
next tick to claim. A worker that files **no** next cycle parks the persona:
its goal is closed, nothing is re-enqueued, and a `cycle_plan_empty` refusal
row lands in the attention ledger (the Orchestration ledger shows it as a
refused verdict). One cycle worker runs per persona at a time: a charter
decided while the persona's cycle is still queued or running is refused at
the dispatch.

#### The dispatch queue — three layouts, one node, one cap, three verbs

Every fleet spawn goes through one admission door (`fleet.max_parallel_sessions`,
default 10, range 1–30). Under the cap a session starts at once; at the cap it is
admitted as a **queued** session — a ninth lifecycle state, slate-coloured, ordered
before *spawning* in every fleet palette, in the **parked** attention lane (it holds
no process and no slot). The Activity board reads the queue through
`fleet_queue_snapshot` (cap, live count, over-admission, and per queued row its
rank, origin, earliest-start gate and an estimated start from the last twenty
finished sessions), refreshed by `fleet-queue-changed` and by any session
entering or leaving `queued` (coalesced to one read per 150 ms in `fleetSlice`),
and reconciled by a 60 s poll the board owns while it is mounted
(`board/useQueuePoll.ts`).

**The header** (`board/GridHeader.tsx`) carries, left of the state key:

- the **cap stepper** (`board/MaxParallelStepper.tsx`, `data-testid="fleet-max-parallel"`):
  `running / cap`, with − / + that write the setting at once (the Rust side
  promotes the queue head when it rises). Over-admission reads `11 / 10` in the
  warning tone. The same bound object drives the **Fleet sessions** row in
  Settings → Limits → Parallel executions (`FLEET_MAX_PARALLEL_SESSIONS_BOUNDS`
  in `autopilotBounds.ts`), so the two controls cannot disagree.
- the **Orchestration** button (ordered-list icon), which opens the panel above.
- the **layout switch** (`SegmentedTabs`, persisted per viewer in localStorage
  `monitor.board.variant`): `classic` is the team-column board; the two queue
  layouts below share one model (`board/queue/useQueueModel.ts`: the registry
  joined to the snapshot by session id — running rows oldest first, queued rows
  by rank, a queued row the snapshot has not caught up with trailing with no
  rank rather than vanishing). A stored value naming a retired layout
  (`ranked`, `horizon`) opens on `classic`.

| Layout | What it shows |
|---|---|
| **Runway** | a Running band with exactly `cap` slots (free slots as ghost cards, live rows past the cap appended with a warning border), then the queue as a **wrapped grid** in rank order — left → right, top → bottom, wrapping at whatever count fits the board's width by the same `ResizeObserver` arithmetic the classic board uses (`useBoardRows`), so there is no horizontal scroll at any width. Reorder in two dimensions with native HTML5 drag (drop before / after the node under the pointer by which half of it the pointer is on — `dropPayload` in `queueVerbs.ts`), ↑/↓ from the keyboard; a drop or a promotion slides the node to its new slot (`layoutId`). |
| **Lanes** | Running \| Queued \| Parked / done. Queued is the reorder list on the `y` axis (framer `Reorder`); Parked / done holds hibernated and finished rows plus rows that exited within the last hour. Every node spans its lane's full width. |

Loading and empty are decided once for both (`QueueBoard.tsx`): a ghost
under the chrome while the first read has not landed and there is nothing to
show, the shared `ScenarioEmptyState` when nothing is running or queued.

**The node** (`board/node/FleetNode.tsx`) is the one visual every board paints,
for both kinds — persona and session — at `NODE_W` = 172px (`gridGeometry.ts`;
`TILE_W`, `QUEUE_TILE_W`, the tray and per-row arithmetic all derive from it),
50px tall for a persona and 48px for a session: a 20px title row, 4px of divider
room (`NODE_DIVIDER_H`), an 18px symbol row, and 4px (persona) or 3px (session)
of padding above and below. The body is a `justify-between` column (2026-09-21):
the **title row pinned to the top**, a **subtle 1px hairline divider**
(`bg-foreground/10`, decorative, inset by the body's padding) between, and the
**symbol row pinned to the bottom** — so the title no longer sits on the symbol
row. The elapsed bar stays on the node's bottom edge, under the symbol row.
On the **Lanes** board every node **fills its lane** (`fill`): no fixed pixel
width, `w-full` in the Running and Parked lanes and `flex-1` beside the team
accent bar in the Queued lane; the affordances and the elapsed bar still anchor
to the node's own right and bottom edges. Runway and Classic keep the fixed
172px node. The component is split by idea — `nodeTypes.ts` (props, the
per-kind view, the fill arithmetic), `personaNodeView.tsx` /
`sessionNodeView.tsx` (what each kind paints), `NodeSymbolParts.tsx` (the symbol
pieces), `NodeRows.tsx` (the rows and the elapsed bar), `nodeHues.ts` (hues,
swatch, the treatment; re-exported by `nodeSymbols.ts`) — every file under 200
lines. The two rows are strict about what they hold:

- the **title row is the title and nothing else** — the whole width, one line,
  `typo-body`, no glyph, no chip and no control beside it. A title of about 24
  characters fits whole; a longer one truncates, and the full title (plus the
  wrapper's lines: state, project, who asked for it, rank, ETA, gate) is the
  row's tooltip. The body's accessible name carries the same text.
- the **symbol row is symbols and nothing else** — icon-sized indicators, each
  a lucide glyph or a pure-CSS mark with an `aria-label` and a tooltip, never a
  word. Two numerals are allowed: a queue **rank** in a ring and an unseen-chat
  **count** in a dot. The order is one list in `board/node/nodeSymbols.ts`, so
  every board agrees: **state** (running = pulsing dot, still under reduced
  motion; awaiting input = speech square; idle = hollow dot; stale = clock;
  queued = hourglass; spawning = dashed circle; finished = check; hibernated =
  moon; exited = square; a persona needing you or failed = warning triangle,
  in its own hue) · **off** (a switched-off persona) · **origin** (manual =
  hand, dev runner = play, ideas = bulb, Athena = sparkles, Autopilot = bot,
  night shift = moon, feed = rss, resume = rotate — an origin never wears the
  state hue, which is how its moon is told from hibernated's) · **rank** ·
  **gate** (a timer while the earliest start is still ahead) · **elapsed** (a
  12px ring: for a live row elapsed ÷ the mean duration the door's estimates
  imply, capped; for a queued row rank ÷ queue length inverted so the head is
  nearly full; drawn only when it has a denominator) · **team** / **project**
  (a 12px square swatch with the initial letter, hue hashed from the name, full
  name in the tooltip) · **operation** (the persona's highest-priority pending
  operation as its glyph) · **unseen chat** · **queued count**. A running
  session shows state · origin · elapsed · project; a queued one state ·
  origin · rank · gate · elapsed · project; a persona state · off · team ·
  operation · unseen · queued.

The **affordances** — a drag grip, the lock (running), recap, ↑/↓, Cancel,
Start now and the ⋯ menu — ride the symbol row's right end and appear on
hover or when anything inside the node has focus; they are buttons with the
same accessible names they had beside the body, and siblings of it, so the
keyboard reaches them exactly as before. `PersonaTile`, `SessionTile` and
`QueueTile` are thin wrappers that own the behaviour (the confirms, the
portalled menus, the aria text) and hand the node its body and its affordances.

The node has **one treatment**. Three were prototyped behind a header switch
(outline, accent, tinted); **tinted** was picked on 2026-09-20 and the other
two, the switch and its `monitor.board.node` storage key were deleted. What
remains, as constants in `board/node/nodeSymbols.ts` (`frameClass`,
`symbolClass`): the whole body washed in the state hue at 8 % with
`shadow-elevation-1` and no border; every symbol, the state one included, a
solid hue circle with the glyph cut out in the background colour; and the
elapsed fill as a 2px bar along the bottom edge across the full node width,
under a 6px labelled strip that carries the elapsed time (live row) or the ETA
(queued row) for the pointer and the screen reader.

Hues come from the canonical fleet palette (`fleetStateMeta`) and the persona
palette (`SQUARE_VISUAL`); the tint twins are a literal table tied to the
canonical `dot` by a lockstep test. A live row past the cap wears the warning
hue on its body wash and its state symbol. The flash ring, the selection
ring and the speech bubble are unchanged.

**The verbs** (`board/queue/useQueueActions.ts`, `queueVerbs.ts`): a drag drop
or ↑/↓ sends the **full** ordered id list to `fleet_queue_reorder` (rank is
dense on the door's side, so a partial list would leave it guessing) and paints
the new order optimistically until the snapshot confirms it; **Cancel**
(`fleet_queue_cancel`) drops a queued row before it ever starts; **Start now**
(`fleet_queue_start_now`) promotes a row past the cap — the fleet runs one over
its line until a live session ends, and that slot is not refilled. Both verbs sit
behind a `ConfirmDialog`. A failed verb toasts and the board snaps back to what
the door still holds. The simulated board (test builds) seeds ten live and thirty
queued rows — alternating realistic titles longer than the node's title row (≥ 40
characters, so truncation is visible) with short ones (≤ 24, so the untruncated
case is visible beside them), cycling through every paintable state and every
origin, some gated — with a fabricated snapshot at a cap of ten, and answers the
verbs locally, so every layout and every symbol can be walked without a real fleet.

The frontend-fed live-slot scheduler that used to sit in Fleet → Settings
(`fleetLiveSlotsEnabled` / `fleet_set_live_slots`) is retired: the cap is the
setting above and nothing else.

### Remote sessions

A fleet session this device sent to one of the operator's **paired devices**
(the **Run on** picker, see [Sharing → Devices](sharing/README.md#devices-run-a-session-on-another-device))
appears on the Activity board as a **remote tile**, keyed `remote:<jobId>`.

**Where it sits.** The session runs over there, so it has no local `cwd` to
map. What it carries instead is the project's git remote: when a local project
shares it (protocol, credentials, `.git` and case do not count), the tile joins
**that project's column**, under the same divider as the local sessions.
Otherwise it lands in an **On <device>** column, one per device, after the
others. With no remote sessions the board is exactly what it was: no extra
column, no empty section. A filtered board carries none, like local sessions.

**What the tile says.** The same node shell and state glyph as a local session,
plus a **device chip** (the shared `Badge`) and one status line:

- **Queued until <device> wakes**: the device was offline, and the job waits in
  this device's outbox until the link comes back.
- **Unknown**, dimmed, with **Last seen <ago>**: this device has not heard a
  mirror frame for more than 45 s (three 15 s health ticks), or the link is
  down. A quiet remote session never reads as running; the rule is re-applied
  on this device's own clock every 15 s (`effectiveRemoteState`), not only when
  an event arrives.
- **Returned work** once the job is done: the branch, the short SHA, and
  **Verified** (this device fetched the branch and found the commit), **Not
  found after fetch**, or **Could not verify here** (no local checkout to look
  in, which is not an error).

**The drawer.** Clicking a remote tile opens it through the same drawer shell
as a persona (`MonitorDrawerShell`): the state header, the returned work, a
**read-only terminal mirror**, the steer row, and the job's progress notes.

- The mirror subscribes to the session's output tail when the drawer opens and
  unsubscribes when it closes. **Closing never cancels the session.** It is the
  fleet terminal's own xterm look (`fleetTerminalOptions`), with input
  disabled. The tail is lossy by design (a slow link never holds back the
  remote terminal); a gap in the chunk sequence writes a dim **output skipped**
  marker where it happened. Until the first chunk arrives, a calm ghost sits
  under the terminal chrome.
- The steer row has three verbs, each a button with its own spinner while the
  other device acknowledges: **Send input** (one line), **Wake**, and **Kill**
  (asks first). A refusal or an unreachable device is a toast in plain words
  from the error registry. The row is off once the session has ended, and
  while it is still queued.

**On the device that runs it**, the session is an ordinary local tile; its
origin symbol and tooltip read **From <device>**.

Freshness: views arrive by push (`network:remote-session-updated`); the board
reconciles on mount, on window focus and, only while a remote session is still
live, on the shared 30 s dashboard cadence. A build without p2p polls nothing.

For screenshots and hand checks while the backend commands are stubs, dev and
test-automation builds expose a fixture once the Monitor has been opened:
`window.__remoteSessionsFixture.seed()` seeds one paired device and three
sessions (running, unknown, completed with a verified receipt), and `.clear()`
hands the board back.

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

A remote tile opens a different drawer in the same shell; see
[Remote sessions](#remote-sessions).

## Relationship to Overview → Approvals

The Monitor is the fleet-wide, header-launched view. The Overview →
**Approvals** tab keeps its focused inbox / focus-flow experience as the
alternative, queue-oriented way to work through reviews. Both act on the same
underlying human-review queue.

### Cross-CLI usage (Codex, Grok)

The usage strip shows one informational row per other coding CLI on the machine, served by `fleet_cli_usage`
(`src-tauri/src/commands/fleet/cli_usage/`). It is passive and read-only.

**Data source.** *Codex*: codex-cli appends a `token_count` event to the running session's rollout log
(`$CODEX_HOME` or `~/.codex`, `sessions/YYYY/MM/DD/rollout-*.jsonl`) after every model turn, carrying the account's
`rate_limits` as the server last reported them (`plan_type`, a `primary` and an optional `secondary` window with
`used_percent`, `window_minutes`, `resets_at`). The reader walks the date directories newest-first, reads only the last
256 KB of at most 20 logs, and takes the newest such event. The CLI version comes from the same log's `session_meta`
line. *Grok*: the grok CLI keeps no quota anywhere it can be read passively, so its card reports presence and version
only (from the same engine probe Settings > Engine uses) and always says "no quota source".

**Staleness.** Codex numbers are only as fresh as the last Codex turn run on this machine: the card carries `asOfMs`,
the event's own timestamp, and the figure is a floor (use from another machine is invisible). When a window's reset time
has passed since that reading, the window is shown as 0 % with an unknown next reset and the card is flagged `projected`
— an estimate, not a reading. Results are cached in memory for 45 s (Grok presence for 10 min).

**Card states.** `not_installed` (no CLI home / binary), `no_sessions` (Codex installed, never run here),
`no_quota_source` (Grok always; Codex when its logs carry no rate limits, e.g. an API-key login), `unreadable`
(logs exist but no longer parse). None of these is an error.

**Deliberately not done.**
- No refresh probe: nothing is spawned or requested to freshen Codex numbers; a stale card stays stale until Codex runs.
- No participation in auto-rotate, `usage_governor` or pacing — those remain Claude-only. These cards never gate a dispatch.
- No auth file access: `~/.codex/auth.json` is never opened, no token is read, nothing leaves the machine. File contents
  and paths are never logged or returned over IPC.

**Fragility.** The rollout log shape is an undocumented internal of codex-cli, observed on 0.153.x. The reader accepts
the event under `payload` or at top level, `resets_at` (unix seconds) or `resets_in_seconds`, and tolerates malformed
or truncated lines; if the shape drifts further the card degrades to `unreadable` / `no_quota_source` rather than failing.
