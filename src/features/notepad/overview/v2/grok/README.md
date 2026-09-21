# Grok desk — the lamp on the blotter

A keyboard-first notepad overview. A traveling lamp marks the selected note; numbered drawers switch rails; `/` finds across title and body. The mouse still works — every baseline verb is still on the card — but the desk is meant to be driven with the hands on the keys.

The visual idea is a physical blotter: cards sit in a recessed well, the selected one lifts, and a primary-tinted lamp slides from card to card (`layoutId`) instead of a static ring appearing and disappearing. Status tabs wear their digit as a keycap so the `1 / 2 / 3` rails are visible before the cheat sheet is.

## Key map

| Key | Action |
|---|---|
| `↑` `↓` `←` `→` | Move the lamp across the 4-column grid (clamped) |
| `h` `l` | Left / right |
| `j` `k` | Next / previous note (wraps) |
| `Home` `End` | First / last note |
| `Enter` | Open the selected note in the editor |
| `/` | Find (fuzzy AND over title + body) |
| `Esc` | Clear find → close find → host ladder |
| `1` `2` `3` | Drafts / scoped / all |
| `⇧1`–`⇧9` | Jump to a project tab |
| `[` `]` | Cycle project tabs |
| `a` | Ask Athena (quick input on the selected card) |
| `p` | Publish to Fleet |
| `g` | Turn into goals |
| `t` | Open thread |
| `r` | Reply (opens the thread composer, auto-focused) |
| `y` / `n` | Approve / reject a pending review on the bubble; otherwise open the thread |
| `Del` | Delete permanently (host confirm) |
| `?` | Cheat sheet |

Letter keys never fire while focus is in an input, textarea, or contenteditable (capture line, find field, quick-write, Ask Athena, thread composer). Escape is claimed only while the cheat sheet or find field is up, and `preventDefault`s so the pad's existing ladder still owns the rest.

Selection survives filter and find changes: the same note stays selected when it is still in the set; otherwise the lamp sits on the note that now occupies its old slot.

## Reused vs rebuilt

**Reused:** `NoteOverview` filter/forecast/presence wiring, `NoteDeskCard` parts (`NoteCardBubble`, `NoteCardMenu`, `NoteAskQuickInput`, `NoteLifecycleRail`, `NotePresenceChip`, `NoteProjectPicker`, `NoteQuickWrite`, `NoteCardFooter`, status glyphs, `OverviewGhost`), thread (`NoteThreadButton`, `approveReview` / `rejectReview`, `registerVisibleCard`), dispatch doors (`publishFleet`, `toGoals`, `askAthena` via the quick input), `SegmentedTabs`, `BaseModal`, `Tooltip`, `useAppKeyboard` at `NOTEPAD_LAYER_PRIORITY`, `useReducedMotion` from `@/hooks/utility/interaction/useMotion`.

**Rebuilt:** the overview chrome (capture blotter, find field, numbered rails, blotter well), the card frame (lamp, lift, rail-on-select, title highlight, keyboard command bus), the hint rail, the cheat sheet, and the pure selection/filter reducer in `deskModel.ts`.
