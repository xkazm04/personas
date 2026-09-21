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
| `NotepadOverlayHost.tsx` | The full-screen layer, in two views: the **overview** (layer 1) and the **editor** (layer 2: tab strip → body → dispatch bar). Opens on the overview; a card opens the editor, "All notes" and `Escape` step back. Lazy-loads the archive modal and the confirm dialog, so neither is in the pad's first paint. Owns the **plan tab** (so `Ctrl/Cmd+1/2/3` can move it from the pad's keyboard priority — the pane is two levels down) and the **Escape ladder**: popover (`defaultPrevented`, in BOTH views) → card caret → editor back → close, with the plan tab deliberately NOT a rung. On a plan note the back button becomes the first crumb of `Desk › title › tab`. |
| `overview/NoteOverview.tsx` | Layer 1, the **Project desk**: heading + slot count, a capture line (Enter creates a draft in the selected project), TWO filters (status lens then project — the project tabs count what the lens admits) and a 4-column grid of `NoteDeskCard`. Takes an optional `initialProjectId` that SEEDS the project filter once (the deep-link door); a seed and not a controlled value, so it never fights the operator. Derives the per-card forecasts over the whole open set and suppresses them entirely while `planSummariesStale`. Picked 2026-09-14 out of three directions (Index cards, Lifecycle board, Project desk); the other two and the switcher were deleted in the same change. |
| `overview/deskFilter.ts` | The desk's STATUS lens — `drafts` (the brainstorm rail) · `scoped` (`scoped\|cut`) · `all`. `shipped` is excluded from every option, including `all`: a shipped note is a record and belongs in the archive drawer's Shipped group. The choice is a per-viewer convenience in `safeLocalStorage` under `personas.notepad.deskFilter`, coerced on read — never the authority for anything. |
| `overview/deskForecast.ts` | PURE per-card cycle-time forecast. Reuses `observedCycles` / `median` / `MIN_SAMPLES` from `lib/milestone/shipVelocity.ts` rather than `deriveShipVelocity`, which answers "when does the NEXT milestone land?" — one forecast per project, picked by `order_index`, which the summary does not carry. **Summary-based: it may differ from the plan pane's**, which reads the project's whole milestone table; the header says so in full. |
| `overview/NoteDeskCard.tsx` · `overview/parts/*` | One card: project + status badge, title, text, one footer row (elapsed time via `RelativeTime format="elapsed"` · save dot · `n/100` · open). `NoteProjectPicker` turns the project into a `Listbox` popover of the ACTIVE WORKSPACE's projects (`scopeProjects`) — draft only. `NoteQuickWrite` owns the card rule: a draft of ≤100 VISIBLE characters is `CardRichText` — a `contentEditable` surface that formats as you type (`cardInputRules.ts`: closing `**`/`_`/`` ` `` and line-start `- `/`1. `/`[] `/`#`/`>` become formatting via `execCommand`, which keeps native undo) and serializes back to markdown on every input, so markers never show; editable stays latched until blur; anything else is a faded `DeferredMarkdown variant="card"` that opens the editor. No toolbar on cards; the editor's shortcuts work in the textarea. |
| `noteText.ts` | Pure text helpers shared by both layers: `CARD_TEXT_LIMIT`, `visibleLength`, `canQuickWrite`, `titleFromText`, `resultSummary`. |
| `cardMarkdown.ts` | The card's markdown subset (lines, `#`–`###`, `>`, bullet / numbered / checklist items, `**` `_` `` ` ``) both ways: `renderCardMarkdown` (escaped, parsed via `DOMParser`, `card` density classes), `cardDomToMarkdown` (reads the browser's block-per-line DOM), `markdownToPlainText`. Stored text stays plain markdown. |
| `NoteBody.tsx` | The body. The **Workbench** layout, picked 2026-09-06 out of the three the prototype round compared; the other two and the switcher were deleted in the same commit. |
| `notepadTiming.ts` | The cold-open stopwatch: `performance` marks at click → layer → shell → chunk → mount → paint → notes → projects, printed as one table. Always on in DEV; in production set `personas.notepad.trace` in browser storage. |
| `NoteTabStrip.tsx` | ARIA tablist of open notes: rename (double-click → `InlineEditableText`), right-click `ContextMenu` (Rename / Fork / Archive or Delete), `+` with cap hint and "Archived…". Each tab carries `data-status` and its status glyph, tinted in the status tone for a LINKED note only — three of the four plan glyphs are shared with a brainstorm status, so shape alone cannot carry the rail, and colouring every tab would make the strip a stripe. |
| `NoteArchiveModal.tsx` | The drawer, TWO groups over `BaseModal`. **Archived**: Restore (cap-gated) / Delete permanently (routed to the host's `ConfirmDialog`). **Shipped**: `shippedNotes()`, newest ship first, each with `RelativeTime(shippedAt)` and the cut→ship span (`formatSpanCompact`); Fork only — no Restore and no Delete, because un-shipping a milestone from a notes drawer would rewrite a record. |
| `notepadStore.ts` | Module store — ONE mutation door `patchNote`; memory → synchronous localStorage shadow → 500 ms debounced SQLite write; flush on tab switch / close / `beforeunload` / `pagehide`; loud save failure. |
| `useNotepad.ts` | `useSyncExternalStore` selectors over the store. |
| `noteStatusMeta.ts` | The ONE presentation table for `NoteStatus` (label key + `Badge` variant + icon + `tone`); unknown token → warning entry. Never render the raw token. Also the two rails (`NOTE_LIFECYCLE_*`), `noteBodyEditable`, and `noteOccupiesSlot` — the cap predicate, MIRRORING `ACTIVE_STATUSES` in `src-tauri/db/src/repos/dev/notes.rs`. |
| `notifications/goalBanner.ts` · `notifications/GoalBannerHost.tsx` | The ceremony title card: a module event store (`emitGoalBanner(subtitle, kind)`) and a host at App root. THREE moments, one per marked crossing — `in_progress→completed` (`goal`), `scoped→cut` (`cut`), `cut→shipped` (`shipped`) — raised from `notepadStore.refetchNote`'s `BANNER_TRANSITIONS` table. The event carries no display text: `kind` travels and the host resolves the headline against the live translations. |
| `notepadActions.ts` | The three dispatch doors: `askAthena` (pointer prompt, no status change; opens the note's Athena wait) · `publishFleet` (`dispatchNoteToFleet` → `published`) · `toGoals` (`published` FIRST, then the pointer prompt, so `show_ship_goals` can move it to `in_progress`). `dispatchNoteToFleet` is the status-free half (brief via `composeNoteBrief` → skill install → `companionDispatchFleetPlan`), shared with the rework loop, which appends a trailing `## Operator feedback` section. `sendAthenaPointer` is the one `source: 'notepad'` door. |
| `noteGuards.ts` | PURE predicates two surfaces must agree on: `noteAskBlocked` / `noteAskBlockedReasonKey` (dispatch bar + desk menu), `noteDeleteBlocked` (a Fleet session still holds the note, queued included), `noteSessionLabel` + `sessionNameMatchesNote` (the label and both rendered spellings of it), `workingSessionFor`. |
| `notepadAskState.ts` | "Athena is working on this note" as a module store keyed by note id — lifted out of `NoteDispatchBar` so the desk reads the same answer. `startAsk` / `clearAsk` / `reportSuggestionCount`; ends on a suggestion-count rise, an Athena thread entry, or the 120 s ceiling. `useNoteAsking` / `useNoteAskingMap`. |
| `thread/noteThreadStore.ts` | The per-note thread (`dev_note_comments`): unread counts for the whole desk (`loadThreadUnread` at pad open, kept live by `notepad-note-comment`), per-note threads in a `createModuleCache` (cap 16) fetched on popover open, optimistic `markThreadRead`, `setViewingThread` (an entry for the thread on screen is read on arrival), `ingestNoteComment` (event + command answers, de-duplicated by id), and `onNoteComment` — the bubble feed (new non-operator entries only). Hooks `useNoteThread` / `useNoteUnread` / `useNoteUnreadMap`. Listener started beside the sweeper's in `NotepadLayer`. |
| `thread/threadActions.ts` | The thread's verbs: `commentOnNote` (store, THEN a `buildNoteCommentPrompt` pointer, THEN the Athena wait) · `approveReview` (a suggestion card accepts its open rows first) · `rejectReview` (a suggestion card rejects its rows; a `run` review requires a reason, the server moves the note `completed → published`, and the note is re-dispatched with the reason + the operator's comments since the review). |
| `thread/useNoteWorking.ts` | The presence chip's reading — `athena` (open wait) › `fleet` (a working session named for the note) › `fleet` inferred from `in_progress` with no visible session. `useNoteWorking(noteId)` for one card, `useNotesWorkingMap()` for a grid (one fleet subscription). |
| `parts/*` | Hoisted pieces shared by the variants: `NoteHeader`, `NoteStatusTimeline`, `NoteDispatchBar`, `SaveDot` (the tab strip's and the cards' save state), `SuggestionSlot` (Athena's inline suggestion blocks — Accept / Edit / Reject per row, a reply field on a `question` row, and no batch accept by design). |
| `plan/planInk.ts` | The plan rail's colour vocabulary in DESIGN TOKENS, and the mapping from the Passport Wall's ink it replaced (teal→`primary`, emerald→`status-success`, amber→`status-warning`, red→`status-error`, blue→`status-info`, violet→`brand-purple`, the slate grey→`status-neutral`). Class strings (`PLAN_INK` / `PLAN_BORDER` / `PLAN_WASH` / `PLAN_FILL` / `PLAN_TINT`) for everything that owns its markup; `PLAN_HUE` as `var(--token)` VALUES for the two props still typed as a colour string, one of which also carries the Goals feature's own status colour and therefore stays a string. |
| `plan/*` | **The plan rail.** A note linked to a milestone is that milestone's living brief, and this folder is the Ship tab's ledger rehosted here (moved wholesale out of the Factory's Ship tab on 2026-09-15 — `useProjectPlan.ts` is the old `useShipData.ts`). `NotePlanContext` fetches the milestone ONCE for both halves of the editor and carries the host-owned `tab` / `setTab` pair (`PlanTab`, `PLAN_TABS`); `NotePlanPane` is the two-column surface (brief left, scope right) `NoteBody` renders instead of the Workbench; `NotePlanLedger` is the cut; `NotePlanRuns` is `dev_note_runs`, newest first. The `Ship*` files are unchanged apart from their import paths; the Factory's `ShipPlannerTab` / `FactoryShipTab` that used to render them were deleted on 2026-09-15 and `useShipData(data)` collapsed into `useProjectPlan(projectId)`, its one surviving entry point. |
| `parts/NoteMilestonePicker.tsx` | The fork: "which plan is this note the brief of?". Lists the project's open, unclaimed milestones plus "New milestone" (`notepad_promote_note`); fetches on OPEN, so a pad of brainstorm notes costs no milestone IPC. |
| `athena/*` | The Athena seam: `buildNoteAskPrompt` / `buildNoteGoalsPrompt` / `buildNoteCommentPrompt` (POINTERS — they name `describe_note`, never paste the body; the comment pointer answers with `comment_on_note`), `noteSuggestions.ts` (the ONE boundary parse of the snake_case `note_suggestions` card config; no ts-rs binding by design; also `openSuggestionCountFor` and `startNoteAskSuggestionWatch`, which ends Athena waits when her blocks land). |


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

**TWO RAILS, sharing only `draft`.** The link is the fork, not a stage.

- **Brainstorm** — `draft → published → in_progress → completed`. The note is handed to a
  runner and the run reports back.
- **Plan** — `draft → scoped → cut → shipped`. The note is a milestone's brief and moves as
  the SCOPE moves. `scoped`/`cut`/`shipped` mirror the milestone's `planned`/`active`/`shipped`,
  and the Rust side is what moves the note when the milestone's status moves — the pad never
  writes the note's status for a certification.

Either rail: any → `archived`, `archived → draft` (restore, cap-checked). Body and project are
editable in `draft | scoped | cut` (`noteBodyEditable`) — a brief that freezes the moment the
scope is named is a brief nobody updates. Delete is allowed for `draft` and `archived` only;
everything else archives.

**Cap = 10 notes OCCUPYING A SLOT, not 10 non-archived notes.** The slot statuses are
`draft | published | in_progress | scoped | cut` (`noteOccupiesSlot`), mirroring
`ACTIVE_STATUSES` in `src-tauri/db/src/repos/dev/notes.rs` — `completed` is a finished report
and `shipped` is a milestone that already landed. The frontend counted `status !== 'archived'`
until 2026-09-15, which greyed the `+` button out while the server would still have created the
note and could render "12 of 10 notes"; `activeNoteCount()` is now the one number both sides
agree on.

The plan rail's timestamps live on the MILESTONE (`cut_at`, `shipped_at`) and reach the pad
through `notepad_list_plan_summaries`, kept live in the store by the Ship tables' own
revision signal (`useNotepadPlanLive`). `scoped` has no stamp anywhere and the timeline says
so with an em dash rather than borrowing `updatedAt`.

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

## Prototype status: CLOSED (twice)

The `/prototype` round compared Journal, Workbench and Split canvas behind a
switcher. **Workbench won (2026-09-06)**; the other two files and the switcher
were deleted in the same commit that picked it, per the exit rule — a switcher
that outlives the decision is a decision nobody made.

The second round (2026-09-14) added the overview layer and compared Index cards,
Lifecycle board and Project desk. **Project desk won**, with two refinements
from the pick: no formatting toolbar on a card, and the last-touched and
character-count rows merged into one footer.
