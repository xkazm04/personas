# Notepad — context

Footer-toggled, full-screen scratchpad for brainstorming notes that end as
work: **Publish to Fleet** (the note becomes `/note-task <id>` in the mapped
project's Claude Code CLI) or **Turn into goals** (Athena decomposes it into
`show_ship_goals` for the project's open milestone). Designed by the
`spark-notepad` run (2026-09-05); design record in the Obsidian vault
`Spark/ideas/notepad.md`, wire contract in `.claude/spark/notepad-contract.md`.

## Files

| File | Role |
|---|---|
| `NotepadFooterIcon.tsx` | The footer toggle (`data-testid="footer-notepad"`), first item of `DesktopFooter`'s right cluster. Ships in production, unlike the Fleet cluster. |
| `NotepadLayer.tsx` | Cheap always-mounted gate (`OverlayIsland name="notepad"` in `App.tsx`); lazy-loads the host on first open and owns the `notepad-note-changed` listener. |
| `NotepadOverlayHost.tsx` | The full-screen layer: tab strip → body → dispatch bar. Lazy-loads the archive modal and the confirm dialog, so neither is in the pad's first paint. |
| `NoteBody.tsx` | The body. The **Workbench** layout, picked 2026-09-06 out of the three the prototype round compared; the other two and the switcher were deleted in the same commit. |
| `notepadTiming.ts` | The cold-open stopwatch: `performance` marks at click → layer → shell → chunk → mount → paint → notes → projects, printed as one table. Always on in DEV; in production set `personas.notepad.trace` in browser storage. |
| `NoteTabStrip.tsx` | ARIA tablist of open notes: rename (double-click → `InlineEditableText`), right-click `ContextMenu` (Rename / Fork / Archive or Delete), `+` with cap hint and "Archived…". |
| `NoteArchiveModal.tsx` | Restore / delete-permanently list over `BaseModal`. |
| `notepadStore.ts` | Module store — ONE mutation door `patchNote`; memory → synchronous localStorage shadow → 500 ms debounced SQLite write; flush on tab switch / close / `beforeunload` / `pagehide`; loud save failure. |
| `useNotepad.ts` | `useSyncExternalStore` selectors over the store. |
| `noteStatusMeta.ts` | The ONE presentation table for `NoteStatus` (label key + `Badge` variant + icon); unknown token → warning entry. Never render the raw token. |
| `notepadActions.ts` | The three dispatch doors: `askAthena` (pointer prompt, no status change) · `publishFleet` (brief → skill install → `companionDispatchFleetPlan` → `published`) · `toGoals` (`published` FIRST, then the pointer prompt, so `show_ship_goals` can move it to `in_progress`). |
| `parts/*` | Hoisted pieces shared by the variants: `NoteHeader`, `NoteStatusTimeline`, `NoteDispatchBar`, `SuggestionSlot` (Athena's inline suggestion blocks — Accept / Edit / Reject per row, a reply field on a `question` row, and no batch accept by design). |
| `athena/*` | The Athena seam: `buildNoteAskPrompt` / `buildNoteGoalsPrompt` (POINTERS — they name `describe_note`, never paste the body), `noteSuggestions.ts` (the ONE boundary parse of the snake_case `note_suggestions` card config; no ts-rs binding by design). |


Backend: `src-tauri/src/commands/infrastructure/dev_tools/notepad.rs` (commands),
`src-tauri/db/src/repos/dev/notes.rs` (repo), migration `e22_dev_notes.rs`,
sweeper `src-tauri/src/commands/infrastructure/notepad_ingest.rs` (rides the
30 s fleet ticker), skill `.claude/skills/note-task/SKILL.md`.
Athena's half: read op `src-tauri/src/companion/note_ops.rs` (`describe_note`),
card validation + per-row resolution
`src-tauri/src/commands/infrastructure/dev_tools/note_suggestions.rs`, dispatcher
arms in `src-tauri/src/companion/dispatcher/dispatch.rs` (`show_note_suggestions`,
and the `note_id` extension to `show_ship_goals`).

## Storage tiers (why three)

1. **Memory** — what the editor renders; updated synchronously per keystroke.
2. **localStorage shadow** `personas.notepad.shadow.<id>` — written synchronously in the same
   call, BEFORE the debounce is scheduled; exists for the 500 ms window in which the WebView
   can die. Read only at `load()`, only when newer than the row.
3. **SQLite `dev_notes`** — system of record; the shadow is cleared only when the saved payload
   equals current memory (a stale save's resolution is not evidence about the current state).

## Lifecycle

`draft → published → in_progress → completed`, any → `archived`, `archived → draft` (restore,
cap-checked). Body and project are editable ONLY in `draft` (the overlay renders the body
read-only otherwise, with Fork to new draft in the tab menu). Delete is allowed for `draft`
and `archived` only; everything else archives. Cap = 10 non-archived notes.

## Cold-open cost, and where it goes

The pad is a summoned overlay, so every millisecond between the click and the
first frame is visible. Four costs, each with a mark in `notepadTiming.ts`:

1. **Reaching the layer** — a zustand read; negligible, and the shell paints here.
2. **The chunk** — the largest, and the one that has been cut twice: the losing
   variants are gone, the archive modal and confirm dialog are lazy, and
   `MarkdownMiniEditor` no longer drags react-markdown in (it renders through
   `DeferredMarkdown`). What is left is a textarea and a tab strip.
3. **Mount + paint** — React committing a full-screen portal.
4. **Two IPC reads** — `notepad_list_notes` and `dev_tools_list_projects`, which
   land AFTER the pad is usable and ghost under its chrome until they do.

The chunk is warmed twice before it is needed: on an idle slice 4s after boot,
and on pointer-enter of the footer icon. A warm open records no chunk cost at
all — which is what the table showing `chunk` absent means.

**What the freeze does and does not buy.** While the pad is up, `#main-content`
carries `content-visibility: hidden`, so the covered app stops paying layout and
paint for a screen nobody can see. It does not make the pad open faster: none of
the four costs above run in the app underneath.

## Prototype status: CLOSED

The `/prototype` round compared Journal, Workbench and Split canvas behind a
switcher. **Workbench won (2026-09-06)**; the other two files and the switcher
were deleted in the same commit that picked it, per the exit rule — a switcher
that outlives the decision is a decision nobody made.
