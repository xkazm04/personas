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

## Turn into goals

Sends Athena a prompt that points her at the note (she reads it with the
`describe_note` op) and asks her to propose goals for the project's open
milestone through her existing `show_ship_goals` card — the only door that
creates goals. She may ask clarifying questions in chat first. Proposing the
card moves the note to In progress; pressing **Create** on the card creates the
goals and moves the note to Completed with the goal ids recorded.

## Ask Athena

The **Ask Athena** button (with an optional one-line focus such as "add a risks
section") asks her to read the note and answer with a `note_suggestions` card.
Its rows render inside the note as inline suggestion blocks — new sections,
edits, or questions — each with Accept / Edit / Reject; questions carry a reply
field. Accepted text is inserted under the heading Athena anchored it to (or
appended). The same card appears in her chat and survives restarts.

_The Athena and Fleet sections describe the design contract; the Athena ops and
the dispatch wiring land with the spark's third work package._
