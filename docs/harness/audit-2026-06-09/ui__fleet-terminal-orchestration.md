# UI Perfectionist — fleet-terminal-orchestration
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

## 1. Status is color-only on the two-dot indicator — fails color-blind operators scanning the fleet
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/fleet/FleetStatusDots.tsx:64-77
- **Scenario**: The whole point of the grid is glanceable triage of 5-16 parallel sessions. The console/business state is encoded as two small 8px round dots whose *only* difference is hue (`alive` emerald-500 vs `idle` emerald-400/70 — nearly identical; `working` blue-400 vs `awaiting_input` violet-400 vs `stale` orange-400). A deuteranope cannot tell "working" from "awaiting your input" from "stale" — exactly the distinctions that decide whether to look now.
- **Root cause**: `CONSOLE_DOT`/`BUSINESS_DOT` carry only a `bg` color class and an optional `pulse`. Shape, glyph, and fill style are constant across every state, so color is the sole channel. The pulse helps separate active vs settled but doesn't disambiguate the three "alive" business states from each other. The hover/focus `FleetStatusLegend` is the only decoder and isn't visible while scanning.
- **Impact**: inaccessible — error-blind for ~8% of male users; even sighted users confuse the two near-identical emeralds.
- **Fix sketch**: Add a redundant non-color channel to each dot config: e.g. a tiny inset glyph or distinct fill treatment per state (hollow ring for idle, solid for alive; pulse already marks working/awaiting — give `awaiting_input` a second static ring or a `▲` micro-marker, `stale` a hollow/dashed treatment). Minimum bar: ensure `idle` and `alive` differ by more than 30% opacity of the same hue, and that `working`/`awaiting`/`stale` carry a shape or animation difference, not just hue. Keep the legend in sync (it already reuses the same maps).

## 2. Spawn / Broadcast / Refresh actions and the key empty/exited copy are hardcoded English in an otherwise fully-i18n surface
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:557,567,576,611-613,766-767
- **Scenario**: Every label in this page resolves through `t.plugins.fleet.*` / `tx(...)` — except the three primary ActionRow buttons render literal `'Spawn'` / `'Spawning…'` (557), `'Broadcast'` (567), `'Refresh'` (576); the empty-list hint (611-613) and the exited-pane copy `Exit code …` / `'Process exited unexpectedly'` (766-767) are also raw English. In a localized build the toolbar a user touches most stays English while the surrounding chrome (legend, pills, banner, tile actions) translates — a visible inconsistency and an untranslatable primary CTA.
- **Root cause**: These strings predate the i18n pass and were never migrated to `t.plugins.fleet`. The `title` props on the same buttons (`'Spawn at …'`, `'Pick a project first'`, 555) are likewise literals.
- **Impact**: inconsistency — split-language toolbar; the most-used control can't be localized.
- **Fix sketch**: Move the labels, the spawning state, the disabled titles, the empty-list hint, and the exited-pane copy into `plugins.fleet` keys (e.g. `spawn`, `spawning`, `broadcast`, `refresh`, `empty_spawn_hint`, `empty_pick_project`, `exit_code`, `exited_unexpected`) and reference them like the rest of the file.

## 3. The single-pane terminal mount has no a11y identity and no keyboard path to switch sessions
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/fleet/FleetTerminalPane.tsx:40-46; src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:580-660
- **Scenario**: The right-hand terminal is a bare `<div>` with only a `data-testid` — no `role`, no `aria-label` tying it to "terminal for session X", so a screen-reader user landing in the pane gets no context for which of N sessions they're in. Separately, the only keyboard way to change the focused session is the rows in the left list (each is a real `<button>`, good) or the "Needs you" cycle button — there's no roving-focus / arrow-key or shortcut to move between sessions once focus is inside the terminal, and `autoFocus` (37) yanks focus into xterm on every session switch, trapping keyboard users who then can't Tab back out predictably.
- **Root cause**: The pane was deliberately built "chrome-free" (per its docblock) and pushed all labeling to the surrounding toolbar, but the surrounding toolbar's view-toggle/skills/hibernate buttons don't label the terminal region itself, and no `aria-label`/`aria-controls` links the active row to the live pane.
- **Impact**: inaccessible — terminal region is unlabeled; keyboard/SR users can't reliably orient or escape focus.
- **Fix sketch**: Give the pane container `role="group"` + `aria-label={tx(t.plugins.fleet.terminal_for, { name })}` (passed from the toolbar where the session is known). Add an Escape (or a documented shortcut) handler in `attachTerminal` to return focus to the active session row, and mark the active list row with `aria-current="true"` (it currently only sets `data-active`). Consider gating `autoFocus` behind an explicit user action rather than every session change.

## 4. Two near-identical pane-header toolbars (single pane vs grid tile) are duplicated and have drifted
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:700-757; src/features/plugins/fleet/FleetOverlayTile.tsx:49-75
- **Scenario**: Both the single-pane and each grid tile render the same conceptual chrome: status dots + session name + a Terminal/Insights toggle + a kill/hibernate action. But they've diverged — the single pane uses labeled text buttons in a pill style (`px-2.5 py-1 rounded-card text-[13px]`), shows a *Hibernate* (Moon) action and a Skills button; the tile uses icon-only `p-0.5` buttons, shows *Kill* (Trash2) instead of hibernate, and inverts the toggle icon logic. The result is two visual languages for "the same titlebar," so muscle memory and iconography don't transfer between the single and grid views.
- **Root cause**: The tile header was extracted from the overlay (per its docblock) but the single-pane header was hand-rolled inline in `FleetGridPage` and never unified. There is no shared `FleetPaneHeader` owning the dots+name+view-toggle layout.
- **Impact**: inconsistency / unpolished — divergent control sizing and iconography for the same role; double maintenance.
- **Fix sketch**: Extract a `FleetPaneHeader` taking `{ session, view, onToggleView, actions }` that renders the dots + truncated name + the Terminal/Insights segmented toggle identically, and let each surface inject its own trailing actions (hibernate+skills for single, kill for tile) into a shared slot. Standardize the toggle on one icon convention (show the *target* view's icon in both, or the *current* view's — pick one).

## 5. Empty/idle states are inconsistent and the primary empty-state CTA isn't actionable
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:603-614,776-781
- **Scenario**: With zero sessions the user sees two unrelated empties side by side: the left list shows an icon tile that *says* "Click Spawn to launch claude" (611) — but that's plain text, not a button, so the natural click does nothing; the actual Spawn button is up in the ActionRow. The right pane simultaneously shows a second, differently-styled empty ("Select a session to view its terminal", 779) which is meaningless when there are no sessions to select. A first-run operator faces two empties, one with a dead-end instruction.
- **Root cause**: The left empty-state and the right placeholder are independent blocks with no shared "no sessions yet" zero-state; the right pane's generic "select a session" copy doesn't branch on `sessions.length === 0`.
- **Impact**: confusion / unpolished — dead-end CTA and a contradictory second empty on first run.
- **Fix sketch**: Make the left empty-state hint an actual `<Button>` that calls `handleSpawn` (reuse the ActionRow handler), disabled with the "Pick a project" copy when `!activeProject`. When `sessions.length === 0`, replace the right pane's "select a session" with either nothing or a single unified onboarding panel so there's one zero-state, not two.

## 6. Destructive Kill action carries no extra weight or confirmation, equal visual rank to benign actions
- **Severity**: low
- **Category**: visual-hierarchy
- **File**: src/features/plugins/fleet/FleetSessionCard.tsx:181-195; src/features/plugins/fleet/FleetOverlayTile.tsx:64-74
- **Scenario**: Killing a running CLI (losing its live process) is the most consequential per-session action, yet on the row it's a tiny `opacity-40` `X` glyph that only reddens on hover (192) sitting at the same size next to the benign rename pencil; on the tile it's an icon-only `Trash2` at `p-0.5`, the same weight as the Insights toggle beside it. There's no confirmation and no persistent visual signal that this one click terminates a process. The same `X` even means two different things by state (kill vs. drop-from-list, 184) with no visual distinction between the destructive and the harmless variant.
- **Root cause**: Kill/remove reuse the generic ghost-icon-button styling shared by non-destructive controls; destructiveness is conveyed only by a hover color and an `aria-label` string, not by standing visual treatment, grouping, or a guard.
- **Impact**: unpolished / error-prone — accidental termination of a long-running agent with no undo.
- **Fix sketch**: Give the destructive kill a persistent low-key danger affordance (e.g. red-tinted on hover *and* a subtle separator/grouping away from rename), and add a lightweight confirm (inline "click again to kill" or a small confirm popover) only for the *kill-live-process* branch — keep the exited/hibernated "remove from list" branch one-click since it's non-destructive. Visually differentiate the two `X` meanings (Trash for kill, X for drop).
