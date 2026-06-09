# UI Perfectionist — teams-and-assignments
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Two divergent step-status visual vocabularies for the same 7 statuses
- **Severity**: critical
- **Category**: visual-consistency
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx:234 (and boardShared.tsx:36)
- **Scenario**: A user previews/launches a goal in the Orchestration Console and sees `matching` as an **amber** dot with an amber label; the same assignment opened in the Flight Deck step relay shows `matching` as a **violet** Wand2 icon with a violet label. `running` in the console is a plain pulsing blue dot; in the relay it is a spinning Loader2. The same orchestrator status is painted two ways, two pixels apart in the same feature.
- **Root cause**: There are two parallel, hand-maintained status maps for the identical status set. `boardShared.tsx` defines `STEP_STATUS_META` (icon + tone + tint + label, lines 36–44) and `STRIP_DOT` (lines 53–61). `teamStudioShared.tsx` independently defines `STEP_STATUS_STYLE` (dot + text, lines 234–242) and `StepStatusBadge` (lines 244–263) with different colors: `matching` = `bg-amber-400` here vs `text-violet-400`/Wand2 in boardShared. The console's live checklist (teamStudioShared.tsx:428–449) and preview list (464–491) also re-implement the numbered step row by hand instead of using `StepRelay`.
- **Impact**: inconsistency
- **Fix sketch**: Make `boardShared`'s `STEP_STATUS_META` the single source of truth. Re-export a `stepMeta()`-driven `StepStatusBadge` from boardShared and delete `STEP_STATUS_STYLE` + the local `StepStatusBadge` in teamStudioShared. Align `matching` on one color (violet, since it owns the Wand2 affordance) so the console and the relay agree.

## 2. Mission-rail step progress is invisible to screen readers (`aria-hidden`, no text alternative)
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/boardShared.tsx:67
- **Scenario**: A screen-reader user tabs through the mission rail. Each `MissionRow` announces only its title and a relative time; the entire progress strip — the at-a-glance "3 of 5 done, 1 running" signal a sighted user gets — is marked `aria-hidden` and conveyed purely as colored bar widths. There is no non-visual way to know an assignment is mid-flight, blocked on review, or failed.
- **Root cause**: `StepProgressStrip` is wrapped in `aria-hidden` (boardShared.tsx:67) with status carried only by `STRIP_DOT` background color and a wider bar for `running` (lines 72–74). `MissionRow` (TeamAssignmentBoardFlightDeck.tsx:188–209) adds no `aria-label` summarizing step counts, so the progress is color/width-only.
- **Impact**: inaccessible
- **Fix sketch**: Compute a textual summary (e.g. `tx(ts.deck_steps_summary, { done, total, running, review })`) and put it on the `MissionRow` button via `aria-label`, or render an `sr-only` span next to the strip. Optionally give the strip `role="img"` with an `aria-label` instead of fully hiding it. Keep the dots but pair each with its tooltip label as today.

## 3. Form placeholders render at full foreground opacity — indistinguishable from typed text
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/teams/sub_teamMemory/components/panel/MemoryPanelList.tsx:67
- **Scenario**: The memory search box, the Add-Memory title/content inputs, and the inline edit inputs all show their placeholder text at the SAME color as real user input. A user cannot tell at a glance whether a field is empty (showing a hint) or already filled, and the "search memories" hint reads as if a query is active.
- **Root cause**: `placeholder:text-foreground` is used instead of a dimmed placeholder token. Occurrences: MemoryPanelList.tsx:67 (search), AddTeamMemoryForm.tsx:68 and :75 (title/content), MemoryRowDetail.tsx:63 and :71 (edit title/content). Placeholders must be visibly lower-contrast than entered values.
- **Impact**: inaccessible
- **Fix sketch**: Replace `placeholder:text-foreground` with the project's muted placeholder class (e.g. `placeholder:text-foreground/40` / `placeholder:text-muted-foreground`) on all five inputs, matching the dimming used elsewhere in the app's form controls.

## 4. Row edit/delete actions are hover-only — unreachable by keyboard
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/teams/sub_teamMemory/components/panel/TeamMemoryRow.tsx:120
- **Scenario**: A keyboard-only user navigating the team-memory list can never reach the Edit or Delete buttons on a memory row — they only mount on `onMouseEnter` and unmount on `onMouseLeave`. Tabbing through the list skips them entirely; there is no focus path to delete a memory. (Double-click-to-edit at line 63 is also mouse-only.)
- **Root cause**: `MemoryRowActions` is conditionally rendered behind a `hovered` boolean (`{hovered && <MemoryRowActions .../>}`, TeamMemoryRow.tsx:120, fed by `onMouseEnter`/`onMouseLeave` at 61–62). Because the element is absent from the DOM until hover, it can never receive focus.
- **Impact**: inaccessible
- **Fix sketch**: Always render `MemoryRowActions` and reveal it with CSS on hover **and** focus-within instead of conditional mounting — e.g. `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100` on the action container (the row already has `group`). This keeps the buttons in the tab order and visible on keyboard focus.

## 5. Team-memory content and metadata collapse into one flat foreground tone — no readability hierarchy
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/teams/sub_teamMemory/components/panel/TeamMemoryRow.tsx:68
- **Scenario**: In a memory row the title, the body, the auto/manual pill, the revision history (titles, categories, content, timestamps), the run marker's relative time, and the timeline entries' timestamps are all `text-foreground` (or near it). Everything shouts at the same volume, so the eye cannot quickly separate "what this memory is" from "when/how it was captured" — the panel reads as a wall of uniform text.
- **Root cause**: Pervasive `text-foreground` on secondary/tertiary text instead of a dimming scale. Examples: TeamMemoryRow.tsx:68 (content), :71 (auto/manual pill), :107/:109/:110 (revision category/content/timestamp); TimelineItem.tsx:32 (title), :39 (time); TimelineControls.tsx:55 (time), :57 (chevron); MemoryTimeline.tsx:104 (run count). The TeamList rows (TeamList.tsx:231/236) correctly use `text-foreground/50` and `/70`, so the memory panel is the outlier.
- **Impact**: unpolished
- **Fix sketch**: Apply a consistent emphasis scale: body content `text-foreground/80`, secondary metadata `text-foreground/55`, timestamps `text-foreground/45`. Mirror the tiers already used in `TeamList`/`boardShared` so the memory panel matches the rest of the feature.

## 6. Empty states use full-opacity icons/text and lack the feature's empty-state pattern
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/teams/sub_teamMemory/components/panel/MemoryPanelList.tsx:92
- **Scenario**: When there are no memories (or none for a run filter), the empty state is a `Brain` icon and two lines all at full `text-foreground` (MemoryPanelList.tsx:94–100); the timeline empty state (MemoryTimeline.tsx:90–94) and diff "need two runs" state (RunDiffView.tsx:64–69) are similarly flat. Next to the polished `TeamList` EmptyState (haloed icon, dimmed copy, action buttons) these read as unstyled fallbacks, and the primary "no memories" line is indistinguishable in weight from its helper subtext.
- **Root cause**: The illustrative icon and helper copy use `text-foreground` at full opacity instead of the dimmed treatment the established `EmptyState` in TeamList.tsx:296–322 uses (`text-indigo-400/50` icon, `text-foreground/90` heading, dimmed body). No shared empty-state primitive is reused across the memory sub-views.
- **Impact**: unpolished
- **Fix sketch**: Dim the empty-state icons (`text-foreground/30`) and demote the helper line to `text-foreground/50` while keeping the primary line at `text-foreground/80`, matching the TeamList EmptyState. Ideally extract a small shared `<MemoryEmptyState icon label hint />` used by MemoryPanelList, MemoryTimeline, and RunDiffView so the three sub-views stay consistent.
