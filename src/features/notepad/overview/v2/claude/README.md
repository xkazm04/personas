# Notepad desk v2 — "claude"

Entry: `NoteOverviewV2.tsx`. It takes exactly the props of the baseline `NoteOverview`
(`NoteOverviewProps & { loading }`).

## Thesis: the desk as an instrument

1. **One line, two modes.** The capture line and the filter are the same field. **Write**
   keeps a draft; **Find** is a live fuzzy filter over title and body. `/` switches (typed at
   the start of an empty line, or pressed anywhere). With zero matches, Enter keeps the query
   as a new draft (Notational Velocity's search-or-create).
2. **One cursor.** A single halo springs from card to card. The selected card lifts, shows
   its thread icon and its lifecycle rail, and scrolls into view.
3. **A status line that teaches.** The bottom bar shows the mode (Browse / Find / Write),
   the selected note, and the verbs available on it *right now* as key chips. Every chip is
   also a button, so the mouse path and the key map are the same thing.
4. **A cheat sheet you can practise with.** `?` opens a HUD, not a modal: keys keep working
   under it, and rows that do nothing for the selected note are dimmed.
5. **One composer.** Ask Athena, reply and reject-with-reason share one popover docked
   under the card.

## Key map

| Key | Does |
|---|---|
| `←` `↑` `→` `↓` | Move the cursor across the grid. Up/down follow the columns, measured from the rendered grid. The first press only shows the cursor. `↑` from the top row goes back into the line |
| `j` / `k` (also `h` / `l`) | Next / previous note in reading order |
| `Home` / `End` | First / last note |
| `Enter` / `o` | Open in the editor (`onOpen`). Enter on a focused button stays that button's |
| `/` | Find: focus the line in Find mode |
| `c` | Write: focus the line in Write mode (clears a Find query) |
| `1` `2` `3` | Status filter: Drafts · Scoped · All |
| `[` / `]` / `0` | Previous / next project filter (wraps) / all projects |
| `Esc` | Closes the HUD, then clears the Find query, then hands over to the host's ladder (blur a field, then close the pad) |
| `a` | Ask Athena (composer; refused with the guard's reason when `noteAskBlocked`) |
| `r` | Reply in the thread. Answers the bubble when one is showing |
| `t` | Open the thread popover (marks it read, swallows the bubble) |
| `y` / `n` | Approve / reject the waiting review: the bubble's, otherwise the newest pending one in the thread. Rejecting a run review opens the reason composer |
| `s` | Take the rail's next step (publish / goals / certify), with the rail's own gate |
| `p` / `g` | Publish to Fleet / Turn into goals |
| `i` | Write on the card (focuses its quick-write, caret at the end) |
| `m`, `Shift+F10`, the context-menu key | The card menu (it shows shortcut hints) |
| `e` | Archive |
| `Del` | Delete permanently: goes through `onDelete`, so the host confirms. Refused while a Fleet session holds the note |
| `?` | Toggle the keys HUD |

Inside the line: `ArrowDown` drops into the grid and keeps the filter. `Backspace` on an
empty Find line goes back to Write. In Find, `Enter` opens the lit card.

The single-letter keys never fire while focus is in an input, textarea or contenteditable.
Keys that arrive inside another surface (a confirm dialog, the thread popover, a menu) are
left to that surface.

## Reused vs rebuilt

**Reused unchanged:** `NoteProjectPicker`, `NoteThreadButton` + `NoteThreadPopover`,
`NoteStatusGlyph`, `PlanStampBadge`, `GoalsBar`, `NoteQuickWrite`, `NotePresenceChip`,
`WorkingEdge`, `NoteCardFooter`, `NoteLifecycleRail` (+ `railNextStep`), `NoteCardBubble`,
`noteCardMenuItems` (with shortcut hints mapped on), `OverviewGhost`, `deskFilter`,
`deskForecast`, `useNotesWorkingMap`, `registerVisibleCard`, and every action door:
`publishFleet`, `toGoals`, `askAthena`, `commentOnNote`, `approveReview`, `rejectReview`,
`archiveNote`. Shared primitives used: `SegmentedTabs`, `ContextMenu`, `NoResults`,
`Tooltip`, `AsyncButton`, `RevealItem`.

**Rebuilt:**
- `DeskCardV2`: the baseline card's anatomy, recomposed so the thread, bubble and menu are
  owned by the desk (the keyboard can drive them).
- `useDeskBubbles`: the `useCardBubble` rules, run once for the grid.
- `CommandLine` (Write/Find), `CursorHalo`, `CommandBar`, `KeysHud`, `CardComposer`.
- `deskKeyModel.ts` (pure key map, grid cursor, selection reconciliation, fuzzy match) and
  `deskActions.ts` (one availability predicate for the chips, the HUD and the handler).

Prototype-only copy is in `copy.ts`.

## Two decisions worth knowing

- **Handler ordering.** The desk registers `useAppKeyboard` at `NOTEPAD_LAYER_PRIORITY`,
  the same rung as the host. When two handlers share a priority, the registry runs the newer
  one first. Child effects run before parent effects, so a naive registration would leave the
  host's handler first, and it would close the pad on an Escape meant for the filter. The
  desk therefore arms one frame after mount. A test stands in for the host and checks this.
- **The cursor is not a `layoutId`.** A shared-layout halo inside a slot that is leaving
  kept that slot's exit open: the card never unmounted, a stuck ghost. The integration test
  caught it. The halo is now one absolutely positioned element, animated to the selected
  slot's layout box.

## Tests

- `__tests__/deskKeyModel.test.ts`: key resolution (including the typing rule), grid moves,
  column inference, selection reconciliation, fuzzy match and highlighting, project cycling.
- `__tests__/NoteOverviewV2.keys.test.tsx`: the desk driven through the real
  `AppKeyboardProvider`. Covers the cursor, Find narrowing and Escape, drop-to-grid, the
  typing rule on the capture line, the HUD versus the host's Escape ladder, the Ask composer,
  digit filters, and open/delete through the host props.
