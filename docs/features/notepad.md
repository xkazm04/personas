# Notepad

A footer-toggled, full-screen scratchpad for brainstorming notes that end as
work. Up to ten notes live as tabs; each is a markdown document that can be
mapped to a dev-tools project, expanded with Athena's suggestions, and then
dispatched one of two ways: **Publish to Fleet** runs it as a requirement in the
project's Claude Code CLI, **Turn into goals** asks Athena to decompose it into
goals for the project's open milestone.

Open it from the notepad icon at the left of the footer's right cluster (it
ships in every build; it is not dev tooling). `Escape` closes it.

## Notes and tabs

- **Tabs** — one per open note. Double-click renames; right-click opens Rename /
  Fork to new draft / Archive (or Delete for a never-published draft). `+` creates
  a note and is disabled at the cap of ten with a hint; its menu also opens the
  **Archived…** list, from which a note can be restored (cap-checked) or deleted
  permanently after a confirm.
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

| Status | Meaning |
|---|---|
| Draft | Created; body and project editable. |
| Published | Dispatched (to Fleet or to Athena for goals). Body locks. |
| In progress | The CLI run wrote `started.json`, or Athena proposed the goals card. |
| Completed | The CLI run wrote `result.json`, or the goals were created. |
| Archived | Hidden from tabs; restorable from **Archived…**; does not count toward the cap. |

From Published onward the body is read-only — an executor is consuming it. Use
**Fork to new draft** to iterate. Deleting is only possible for drafts and
archived notes; everything else archives.

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
duplicate the first. Pressing **Create** on the card creates the goals, binds
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

Accept and Edit only work while the note is a draft. A published note may
already be open in a running CLI session, so its body is locked; the blocks then
render read-only with a Reject button and say why. Asking Athena about a note
does **not** publish it; publishing would lock the body her suggestions need.

The same rows also appear in her chat as a `note_suggestions` card, where they
can be accepted or rejected but not edited. The card is a durable row, so it
survives a refresh and a restart, and it resolves itself once no row is left
undecided.
