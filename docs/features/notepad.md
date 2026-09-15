# Notepad

A footer-toggled, full-screen scratchpad for brainstorming notes that end as
work. Up to ten notes live as tabs; each is a markdown document that can be
mapped to a dev-tools project and then leaves the pad by one of **two doors**:

- **Dispatched** — **Publish to Fleet** runs it as a requirement in the project's
  Claude Code CLI, **Turn into goals** asks Athena to decompose it into goals for
  the project's open milestone.
- **Linked** — a note can instead become a **milestone's living brief**. It stops
  being a thing that gets executed and becomes the thing the scope is measured
  against, moving as the scope moves: scoped, cut, shipped. See [Plan](#plan).

Open it from the notepad icon at the left of the footer's right cluster (it
ships in every build; it is not dev tooling). It opens on the desk; a card opens
the full editor.

**The Escape ladder**, one rung per press: a popover (a card's project picker, a
ledger menu) dismisses itself first and the pad does not act; then a card's caret
leaves the card; then the editor steps back to the desk; then the desk closes the
pad. The plan tab is deliberately **not** a rung — it is a view of one note, not
a layer stacked over it, and unwinding it would put two presses between a plan
note and the desk.

## Desk

Every open note as a card in a four-column grid.

- **Capture line** — type and press Enter: a new draft lands on the desk, titled
  from its first line, in whichever project the filter has selected.
- **Two filters**, because there are two rails. They compose; neither is the
  other's sub-menu.
  - **Status** — **Drafts** (the brainstorm rail: Draft, Published, In progress,
    Completed) · **Scoped** (the plan rail mid-flight: Scoped, Cut) · **All**.
    The choice is remembered per machine, so the desk opens on the lens it closed
    on. **No lens shows a shipped note** — a shipped note is a record and lives in
    the archive drawer's [Shipped](#archive) group.
  - **Project** — All, one entry per project your notes point at, and No project,
    each with its count *within the current status lens*, so the two filters agree
    about what "· 4" means. Shown once there is more than one to choose.
- **Cards** — project and status badge, title, text, and one footer row: how
  long ago it was last touched (`<1 min`, `5 min`, `2 hr`, `3 days` — minutes
  are the smallest unit), its save dot, and for a draft the characters used out
  of 100. The state is also the card's colour: accent for Draft and Scoped, blue
  for Published, amber for In progress and Cut, green for Completed.
- **A linked card** adds three readings and no extra row:
  - a **goals rule** under the title — the milestone's done/total as a 2px bar in
    the note's own status tone. Hidden when the milestone has no goals yet: that
    is *nothing decomposed*, not *no progress*, and an empty bar would say the
    wrong one.
  - the **milestone's stamp** in place of the plain status badge — "Cut · 3 days",
    "Shipped · 2 hr". It replaces rather than joins it, because a `cut` note's
    status badge already reads "Cut" and the card's width is better spent on
    *when*.
  - a **forecast line** above the footer for a scoped or cut note: the project's
    median cut-to-ship cycle projected forward, phrased "Forecast ship
    2026-03-05" (or "…, if cut today" when there is no cut stamp yet). It appears
    only once the project has at least **two** observed cycles — one is an
    anecdote — and disappears entirely while the plan join is unreachable, since
    a median off a stale reading is a guess built on a guess.

    > The desk's forecast is derived from the **plan summaries of notes on the
    > desk**, while the plan pane's is derived from the project's full milestone
    > table. A project whose milestones are not all briefed by a note therefore
    > has a smaller sample here, and the two can differ.
- **Project on a card** — on a draft, click the project to pick another one (or
  No project) from a popover listing the active workspace's projects — every
  project when no workspace is selected — with a search field once there are
  more than six. A note past draft shows its project as a plain label.
- **Writing on a card** — a card shows the note formatted and never shows
  markdown markers, not even while you type. A draft of 100 visible characters
  or fewer is editable in place: click anywhere in its text. Formatting applies
  as you type — `**bold**`, `_italic_` and `` `code` `` turn into formatting the
  moment their closing marker is typed; `- `, `1. `, `[] `, `# `/`## `/`### ` and
  `> ` at the start of a line start a bullet list, numbered list, checklist,
  heading or quote; `Ctrl/Cmd+B`, `I` and `1/2/3` toggle bold, italic and
  headings; Enter continues a list and Enter on an empty item ends it; pasted
  text arrives unformatted. There is no toolbar, and the note is still stored as
  plain markdown, so the full editor, Athena and Fleet read exactly what they
  did. The 100 counts visible characters, not the markers behind them. Typing
  past 100 keeps the card editable until you leave it. A longer draft, or any note that has left draft, shows its
  formatted opening fading out, and clicking it opens the editor. A completed
  note shows its run's result summary.
- **Opening a note** — click its title, its excerpt, or the open control in the
  footer. **All notes** in the header returns; on a plan note that control
  becomes the first crumb of a breadcrumb — **Desk › _note title_ › _tab_**.

## Notes and tabs

- **Tabs** — one per open note, each led by its status glyph. A **linked** note's
  glyph is tinted in its status tone; an unlinked one's stays quiet ink, so the
  two rails are distinguishable at a glance (three of the four plan glyphs are
  deliberately shared with a brainstorm status, so shape alone cannot carry it).
  Double-click renames; right-click opens Rename / Fork to new draft / Archive (or
  Delete for a never-published draft). `+` creates a note and is disabled at the
  cap of ten with a hint; its menu also opens the **Archived…** drawer.
- **Editor** — plain markdown in a textarea with a formatting toolbar (bold,
  italic, H1–H3, bullets, numbered, checklist, code, quote) and `Ctrl/Cmd+B`,
  `I`, `1/2/3` shortcuts, plus an Edit/Preview toggle. The stored text is
  exactly what Athena and the CLI read; there is deliberately no WYSIWYG layer.
- **Project chip** — next to the title, maps the note to a saved dev-tools
  project. Notes may stay unmapped; both dispatch buttons stay disabled with a
  hint until a project is mapped.

## Never losing a note

Every keystroke updates memory, writes a synchronous browser-storage shadow, and
schedules a 500 ms debounced save to the SQLite `dev_notes` table. The shadow is
cleared only once the row confirms it holds what you typed; if the app dies
inside that window, the next open restores the shadow and saves it. Pending saves
flush on tab switch, on closing the overlay, on archive/delete, and on window
close. A failed save keeps the tab's dot on and raises a toast with a retry —
never a silent clear.

## Lifecycle

**Two rails, sharing only Draft.** The link is the fork, not a stage. They are
alternatives rather than steps of each other: `Published` does not come before
`Scoped`, and a linked note will never reach `In progress`.

**Brainstorm** — the note is handed to a runner and the run reports back.

| Status | Meaning |
|---|---|
| Draft | Created; body and project editable. |
| Published | Dispatched (to Fleet or to Athena for goals). Body locks. |
| In progress | The CLI run wrote `started.json`, or Athena proposed the goals card. |
| Completed | The CLI run wrote `result.json`, or the goals were created. |

**Plan** — the note is a milestone's brief and moves as the **scope** moves.
These three mirror the milestone's `planned` / `active` / `shipped`, and **Rust
is what moves the note** when the milestone's status moves: the pad never writes
a note's status for a certification, so one transition never has two authors.

| Status | Meaning |
|---|---|
| Scoped | Linked to a milestone that is planned. Body and project still editable. |
| Cut | The scope is frozen. Body still editable — a brief that freezes when the scope is named is a brief nobody updates. Anything added to the scope from here is marked *added after the cut*. |
| Shipped | The milestone landed. The note is now the record of it: body read-only, and it leaves the desk for the drawer's Shipped group. |

Either rail: any status → **Archived**, and Archived → Draft (restore,
cap-checked).

**What is editable.** The body and the project are editable in **Draft, Scoped
and Cut** — the server agrees (`NoteStatus::can_edit_body`). Everything else is a
record; use **Fork to new draft** to iterate. Deleting is only possible for
drafts and archived notes; everything else archives.

**What the cap counts.** Ten notes, and the ten are the ones **occupying a slot**:
Draft, Published, In progress, Scoped, Cut. A **Completed** note is a finished
report and a **Shipped** one is a milestone that already landed — neither is live
work, and counting them would let a handful of finished briefs lock the pad shut.
Archived notes have never counted. The desk's "N of 10" line counts the same five.

## Plan

A note becomes a milestone's living brief through **Link to milestone** in the
dispatch bar: pick one of the project's open, unclaimed milestones, or create a
new one from the note. Only a scoped note can be unlinked — once the scope is cut
the note is the record of it.

From then on the editor renders the **plan pane** instead of the workbench: two
halves, and the split is the whole argument.

- **Left — the brief** you wrote, still editable while the plan is scoped or cut.
- **Right — the scope** it produced: the milestone's objective, its target, the
  project's cycle-time line, the rating-vs-readiness summary, and three views.

**The three views** — `Ctrl/Cmd+1`, `2`, `3` while a plan note is open, or the
tab strip above them:

| View | What it is |
|---|---|
| **Plan** | The cut: every feature and goal in it, each with the automation's readiness on its right edge and your own note + rating in a strip underneath. **Compose scope** opens the picker for what goes in. |
| **Criteria** | The exit criteria, each with its derived evidence. A criterion an agent can close grows a dispatch arm that spawns a Fleet session with a criterion-specific brief. |
| **Runs** | Everything that has been run against this note, newest first. |

**The verbs, by state.** The control bar offers what the state allows and
disables the rest with the reason in its tooltip:

| State | Certify | Compose | Execute | Decompose brief | Ask Athena |
|---|---|---|---|---|---|
| Scoped | **Certify cut** — never gated on the criteria (they are measured *against* the cut, so they cannot be a precondition for making one) | yes | yes | yes, once the brief has text | yes |
| Cut | **Ship** — gated on every exit criterion being met | yes | yes | yes | yes |
| Shipped | — | — | — | — | yes (a record can still be asked about) |

**Execute** hands the cut to a `/ship-milestone` session in the project's repo;
results come back on their own and the fleet ticker ingests them.
**Decompose brief** asks Athena to read *the note* and propose goals for the
milestone through her `show_ship_goals` card.

**Ceremony.** Two of these moments raise the same full-width title card the
brainstorm rail raises when a run lands: **Scope cut** when the milestone is cut,
and **Shipped** when it lands. Each fires once, when the pad observes the
crossing.

## Archive

**Archived…** in the tab strip's menu opens a drawer with two groups, offering
different verbs because they are different acts.

- **Archived** — work put aside. **Restore** brings it back as a draft and is
  gated on the same cap the `+` button obeys (restoring is creating, from the
  server's point of view). **Delete permanently** is offered after a confirm.
- **Shipped** — notes whose milestone landed, newest first, each with when it
  shipped and how long the cut → ship cycle took. **Restore is not offered**:
  un-shipping a milestone from a notes drawer would rewrite a record, and the
  milestone's own status is the authority for that transition. **Fork** is the
  verb that fits — it copies the brief into a fresh draft and leaves the record
  alone.

## Publish to Fleet

The app writes the note to `<project>/.personas/notepad/<note-id>/note.md`,
installs the `note-task` system skill into the project if missing, and spawns a
Fleet session whose first prompt is `/note-task <note-id>`. The skill claims the
note by writing `runs/<note-id>/started.json` first, executes the requirement
with the repo's own gates, and reports through `runs/<note-id>/result.json`
(`schema_version: 1`, `status: completed | failed`, `summary`, `artifacts[]`) plus
a free-form `report.md`. The fleet ticker sweeps those files every 30 seconds
(`notepad_ingest_runs` does it on demand) and moves the note to In progress /
Completed; a failed run leaves the note In progress with the failure in its
result. The CLI never writes the Personas database.

The dispatch goes through `companion_dispatch_fleet_plan`, which returns a
message rather than a session id, so the note records its dispatch key
(`note:<note-id>`) and not the session. The session is bound back to the note
when it reaches Running (the Fleet session-state listener matches the session
label `note:<first 8 of the id>` against the pad), so the pad shows In progress
within a second of the terminal starting; the run-artifact sweeper is
authoritative for everything after that.

## Turn into goals

Sends Athena a prompt that points her at the note (she reads it with the
`describe_note` op, which also tells her the project's open milestone id) and
asks her to propose goals through her existing `show_ship_goals` card, the only
door that creates goals. Pressing the button moves the note to **Published**
immediately; **proposing** the card moves it to **In progress**, so the button
stops being offered while a card is already on screen and a second card cannot
duplicate the first. On a **linked** note the same card decomposes the *brief*
into goals bound to that note's milestone — see [Plan](#plan)'s **Decompose
brief** — and the note's own status stays on the plan rail. Pressing **Create** on the card creates the goals, binds
them to the milestone, and moves the note to **Completed** with the goal ids in
its result. She may ask clarifying questions first, in chat or as `question`
rows on a suggestions card.

A note with no project, or a project with no unshipped milestone, cannot be
decomposed; `describe_note` says so and she reports it rather than choosing a
project for you.

## Ask Athena

The **Ask Athena** button (with an optional one-line focus such as "add a risks
section") asks her to read the note with `describe_note` and answer with a
`show_note_suggestions` card. Its rows render **inside the note** as inline
blocks at the heading each row anchors to: a suggested change to a piece of
writing is judged next to the writing.

Each row is one of three kinds:

| Kind | What it is | What Accept does |
|---|---|---|
| **New section** | a part of the note that is not there yet | inserts the markdown |
| **Edit** | a rewrite of something already written | inserts the markdown |
| **Question** | something she needs answered before she can propose | **writes nothing**; it sends her your answer and closes the row |

Every row is answered on its own; there is no "accept all". Accepted text lands
after the anchored section's last line, before the next heading of the same or
shallower depth. A row whose anchor no longer matches any heading is appended at
the end rather than refused, so accepted text is never lost to a renamed heading.

Accept and Edit work wherever the body does — **Draft, Scoped and Cut**. A
published note may already be open in a running CLI session, and a shipped one is
a record, so in those states the body is locked; the blocks then render read-only
with a Reject button and say why. Asking Athena about a note
does **not** publish it; publishing would lock the body her suggestions need.

The same rows also appear in her chat as a `note_suggestions` card, where they
can be accepted or rejected but not edited. The card is a durable row, so it
survives a refresh and a restart, and it resolves itself once no row is left
undecided.
