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
| `overview/NoteOverview.tsx` | Layer 1, the **desk** — keyboard-first ("the lamp on the blotter"): heading + slot count + the `?` keys button, a capture line (Enter creates a draft in the selected project), the `/` find field (fuzzy AND over title + body, title-prefix hits ranked first), TWO filters (status lens then project — the project tabs count what the lens admits; each status tab wears its `1`/`2`/`3` digit as a keycap) and the grid of `NoteDeskCard` in a recessed well, with `DeskHintRail` stuck under it and `DeskCheatSheet` one `?` away. Owns the `chromeReducer` state (selection, query, find open, cheat open) and the selection-survival step (the same note stays selected across a filter/find change; otherwise the note now in its old slot). Takes an optional `initialProjectId` that SEEDS the project filter once (the deep-link door). Derives the per-card forecasts over the whole open set and suppresses them while `planSummariesStale`. Picked 2026-09-21 out of a three-way contest (the 2026-09-14 Project desk, an Opus take and a Grok take); the Grok desk won and the other two and the switcher were deleted in the same change. |
| `overview/deskModel.ts` | PURE model of the desk: `chromeReducer` + the Escape rungs (`escapeOwnedByDesk`), grid walking (`moveIndex` / `moveSelection` — arrows clamp, `j`/`k` wrap), `surviveSelection`, find (`matchesQuery` / `scoreMatch` / `splitHighlight`), the keymap (`commandFromKey`), `isTypingSurface` / `overlayOwnsKeys`, the rendered column count (`columnsFromTemplate` / `columnsFromRowTops`) and where a review key lands (`reviewKeyEffect`: bubble first, thread otherwise). Everything the DOM knows is passed in. |
| `overview/useDeskKeyboard.ts` | The desk's keyboard layer through `useAppKeyboard` at `NOTEPAD_LAYER_PRIORITY + 1` — one rung above the host, because at an equal priority the host (a parent, registered later) would be asked first and its Escape would beat the desk's clear-find rung. Keys the desk does not consume fall through to the host. Also `useGridColumns`: the grid's RENDERED column count (computed `grid-template-columns`, else the cards' row tops, else the styled 4), re-measured on resize. |
| `overview/parts/Keycap.tsx` · `DeskHintRail.tsx` · `DeskCheatSheet.tsx` | `Keycap` and `DESK_KEY` — the key legends are glyphs, not copy, and never enter the catalogs. `DeskHintRail`: the keys that apply to the SELECTED note right now (Ask only when askable, Publish/Goals only for a mapped draft, `y`/`n` only while its bubble carries a pending review). `DeskCheatSheet`: the full map in a `BaseModal`, three groups. |
| `overview/deskFilter.ts` | The desk's STATUS lens — `drafts` (the brainstorm rail) · `scoped` (`scoped\|cut`) · `all`. `shipped` is excluded from every option, including `all`: a shipped note is a record and belongs in the archive drawer's Shipped group. The choice is a per-viewer convenience in `safeLocalStorage` under `personas.notepad.deskFilter`, coerced on read — never the authority for anything. |
| `overview/deskForecast.ts` | PURE per-card cycle-time forecast. Reuses `observedCycles` / `median` / `MIN_SAMPLES` from `lib/milestone/shipVelocity.ts` rather than `deriveShipVelocity`, which answers "when does the NEXT milestone land?" — one forecast per project, picked by `order_index`, which the summary does not carry. **Summary-based: it may differ from the plan pane's**, which reads the project's whole milestone table; the header says so in full. |
| `overview/NoteDeskCard.tsx` · `overview/parts/*` | One card (SELECTED, it lifts and wears the traveling lamp, a `layoutId` bar on its top edge; it receives the desk's keyboard verbs as a `command` prop and routes review keys through `reviewKeyEffect` — `r` / `n` reach the bubble via `NoteCardBubble`'s `intent`): project + status badge, title, text, one footer row (elapsed time via `RelativeTime format="elapsed"` · save dot · `n/100` · open). `NoteProjectPicker` turns the project into a `Listbox` popover of the ACTIVE WORKSPACE's projects (`scopeProjects`) — draft only. `NoteQuickWrite` owns the card rule: a draft of ≤100 VISIBLE characters is `CardRichText` — a `contentEditable` surface that formats as you type (`cardInputRules.ts`: closing `**`/`_`/`` ` `` and line-start `- `/`1. `/`[] `/`#`/`>` become formatting via `execCommand`, which keeps native undo) and serializes back to markdown on every input, so markers never show; editable stays latched until blur; anything else is a faded `DeferredMarkdown variant="card"` that opens the editor. No toolbar on cards; the editor's shortcuts work in the textarea. |
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
| `thread/threadLabels.ts` | PURE naming of a thread entry — `threadAuthorLabel` / `threadEntryLabel` (a `run` review whose body is the bare token `failed` reads "Run failed"; a status row's token rides in `ref_id`) / `threadVerdictLabel` / `isPendingReview` / `clipThreadBody` / `splitElapsedTemplate`. One table for the popover, the bubble and the stack projection. |
| `thread/ThreadControls.tsx` | The two shared controls: `ReviewVerdictActions` (Approve · Reject; a suggestion card rejects in one tap, a `run` review opens a REQUIRED reason field first; `AsyncButton`s that return their promise) and `ThreadComposer` (Enter sends via `commentOnNote`; cleared only once stored). Used by the popover, the card bubble and the LiveCommsStack row. |
| `thread/NoteThreadPopover.tsx` · `thread/NoteThreadButton.tsx` | The thread as an anchored popover (portaled, `NOTEPAD_POPOVER_Z`, outside-click + `preventDefault`ed Escape so the pad's ladder stops): ghost rows under the chrome while the first read is in flight, entries animating in, verdict buttons on a pending review, composer at the foot. OPENING IS READING — `setViewingThread(noteId)` + `markThreadRead(noteId)` on mount, `setViewingThread(null)` on close. `NoteThreadButton` is its door (icon + unread count), docked on every desk card and in the editor's top row. |
| `thread/cardVisibility.ts` | "Is this note's card on screen?" as a REFCOUNT of mounted desk cards. Mounting is the whole test: a card is mounted only while the pad is open, the overview is showing and the card passes both filters. |
| `thread/NotepadLiveFeeder.tsx` | Mounted always (in `NotepadLayer`). Routes a new thread entry for a note whose card is NOT visible (and whose thread was not open) into Fleet's LiveCommsStack through `fleet/monitor/live/liveExternal.ts`, and registers the notepad verbs there (inline verdict + reply, open = `openNotepadThread`, acknowledge = `markThreadRead`). Fleet imports nothing from the notepad — the overlay is in the app's first chunk. |
| `thread/threadDeepLink.ts` | `openNotepadThread(noteId)` — the stack's door: raises the pad and leaves a one-shot request the host consumes by opening that note's editor with the top-row thread popover up (the editor, not the card, because the card may be filtered out). |
| `notepadLayers.ts` | `NOTEPAD_POPOVER_Z` — the level every desk popover/menu portals at, above the pad's own `z-[200]`. |
| `overview/parts/NotePresenceChip.tsx` | The presence chip (Athena `Sparkles` violet / Fleet `SquareTerminal` blue + the translated `…{elapsed}…` template split around a ticking `RelativeTime`) and `WorkingEdge`, the breathing top edge (static under reduced motion). Fed by the grid's ONE `useNotesWorkingMap()` subscription. |
| `overview/parts/NoteLifecycleRail.tsx` | The hover rail over `noteLifecycleFor(milestoneId)`; shares the footer metadata's slot (the metadata fades under it — nothing moves). `railNextStep` (pure) names the one offered step: brainstorm draft → `publishFleet`, linked draft → `toGoals`, `scoped`/`cut` → certify (host opens the editor with `certifyOnOpen`; `NotePlanProvider` honours a SHIP only when the verdict is `go`). Sweeper moves are never offered. |
| `overview/parts/NoteCardMenu.tsx` | The right-click `ContextMenu` (`noteCardMenuItems`, pure) gated by the dispatch bar's predicates — `noteAskBlockedReasonKey`, draft-with-project, `noteDeleteBlocked` — with the refusal as the item's `hint`; Delete routes to the host's `ConfirmDialog` via `onDelete`. `NoteAskQuickInput` is the one-field Ask Athena popover at the click point. |
| `overview/parts/NoteCardBubble.tsx` | `useCardBubble(noteId)` (the card's slot on `onNoteComment`; newest wins, except a system row does not bury a pending review) and `NoteCardBubble` — spring in/out above the card, 10 s clock that pauses on hover/focus, Read / Approve·Reject / Comment. Dismiss and timeout do not mark read. |
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
scope is named is a brief nobody updates. Delete permanently is allowed on ANY status (the FK
cascade removes the thread and runs) and is refused only while a Fleet session holds the note
(`noteDeleteBlocked`); the desk menu and the archive drawer both confirm first.

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

## Prototype status: CLOSED (three times)

The `/prototype` round compared Journal, Workbench and Split canvas behind a
switcher. **Workbench won (2026-09-06)**; the other two files and the switcher
were deleted in the same commit that picked it, per the exit rule — a switcher
that outlives the decision is a decision nobody made.

The second round (2026-09-14) added the overview layer and compared Index cards,
Lifecycle board and Project desk. **Project desk won**, with two refinements
from the pick: no formatting toolbar on a card, and the last-touched and
character-count rows merged into one footer.

The third round (2026-09-21, `/spark note-overview-cycle`) put the Project desk
against two keyboard-first takes behind a switcher. **The Grok desk won**; the
Opus take, the switcher and the baseline were deleted in the same change, its
copy moved into the catalogs, and three gaps it reported itself were closed on
promotion (`r` / `n` reach the bubble, arrows read the rendered column count).

## Keyboard

The desk is meant to be driven with the hands on the keys; every verb is still on
the card for the mouse. Letter keys never fire while focus is in an input,
textarea or contenteditable (capture line, find field, quick-write, Ask Athena,
thread composer), nor while a dialog, menu or listbox owns focus. Modifier chords
(Ctrl/Cmd/Alt) are never the desk's.

| Key | Action |
|---|---|
| `↑` `↓` `←` `→` | Move the lamp across the grid, one RENDERED column / row (clamped) |
| `h` `l` | Left / right |
| `j` `k` | Next / previous note (wraps) |
| `Home` `End` | First / last note |
| `Enter` | Open the selected note in the editor |
| `/` | Find (fuzzy AND over title + body) |
| `Esc` | Clear find → close find → the host's ladder (blur, back, close) |
| `1` `2` `3` | Drafts / scoped / all |
| `⇧1`–`⇧9` | Jump to a project tab |
| `[` `]` | Cycle project tabs |
| `a` | Ask Athena (quick input on the selected card) |
| `p` | Publish to Fleet |
| `g` | Turn into goals |
| `t` | Open thread |
| `r` | Reply: the bubble's inline Comment field when the card has a bubble up, else the thread composer |
| `y` | Approve the bubble's pending review; otherwise open the thread |
| `n` | Reject the bubble's pending review — one tap for a suggestion card, the reason field for a `run` review; otherwise open the thread |
| `Del` | Delete permanently (the host confirms; refused while a Fleet session holds the note) |
| `?` | Cheat sheet |

Escape is claimed only while the cheat sheet or the find field is up, and never
when something above already handled it (`defaultPrevented`), so the pad's
existing ladder still owns the rest. Selection survives filter and find changes.

## Thread → bubble → stack (spark note-overview-cycle)

1. A producer (Athena `comment_on_note`, note-task ingest, the milestone mirror)
   inserts a `dev_note_comments` row and emits `notepad-note-comment`.
2. `noteThreadStore.ingestNoteComment` counts it (unless its thread is being
   viewed, in which case it is read on arrival) and fires `onNoteComment` for any
   non-operator entry, once per id.
3. Two subscribers, one router: the entry's desk CARD (mounted ⇒ visible, see
   `cardVisibility.ts`) shows `NoteCardBubble`; otherwise `NotepadLiveFeeder`
   pushes it into Fleet's LiveCommsStack (not gated by channel live mode; one row
   per note, newest wins). `viewed` entries go nowhere.
4. Reading: opening the thread popover (card icon, bubble **Read**, editor top
   row, or a stack row's body via `openNotepadThread`) marks the thread read;
   acknowledging a stack row does too. A bubble's dismiss/timeout does not, and a
   timed-out bubble is never re-posted to the stack.
