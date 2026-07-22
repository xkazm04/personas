# teams/teamWorkspace [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 16 | Missing: 2

Missing files (skipped): `teamStudio/TeamAssignmentBoardFlightDeck.tsx` (deleted), `MotionizedGlyph.tsx` (moved — TeamList now imports it from `@/features/shared/components/display/MotionizedGlyph`). Context map should be refreshed for both.

## 1. Color-swatch picker duplicated between CreateTeamForm and TeamWorkspacePane
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_teamWorkspace/CreateTeamForm.tsx:128 (and teamStudio/TeamWorkspacePane.tsx:208)
- **Scenario**: Both surfaces render the same `Object.entries(TEAM_COLORS)` swatch grid — colored button, `scale-110` selected state, `Check` overlay with the identical drop-shadow class. TeamWorkspacePane already imports `TEAM_COLORS` from CreateTeamForm, so the coupling exists but the JSX was copy-pasted rather than shared.
- **Root cause**: The workspace-settings identity editor (Phase 2c) reimplemented the create-form's swatch row instead of extracting it.
- **Impact**: Any palette or interaction change (new color, keyboard support, aria-pressed — note only the Pane version has `aria-pressed`, the form version doesn't, so they've already drifted) must be made twice and can silently diverge.
- **Fix sketch**: Extract a `TeamColorPicker({ value, onChange, size? })` component next to `TEAM_COLORS` (or move both to a small `teamColors.tsx`), render the swatch buttons once with `aria-pressed`, and use it in both CreateTeamForm and TeamWorkspacePane. Also removes the awkward `TeamWorkspacePane → ../CreateTeamForm` value import.

## 2. Model-tier string sniffing duplicated (modelKeyFromProfile vs parseModelTier)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/TeamWorkspacePane.tsx:31 (and teamStudio/useTeamStudioData.ts:60)
- **Scenario**: Two functions in the same feature do the same `lower.includes('opus'|'sonnet'|'haiku') → tier` classification: `modelKeyFromProfile` (raw substring match on the JSON profile string) and `parseModelTier` (JSON-parse then substring match). TeamWorkspacePane additionally hardcodes its own `MODEL_OPTIONS` model-id list.
- **Root cause**: The workspace defaults editor and the studio data layer each grew their own profile→tier mapper.
- **Impact**: Adding a new tier/model (e.g. a new model family) requires touching both mappers plus `TIER_TONE` in teamStudioShared; the two already differ in whether they parse the JSON envelope, which is a drift trap (a profile whose non-model field contains "opus" misclassifies in the Pane version).
- **Fix sketch**: Add one `modelTierFromProfile(profile: string | null): 'Opus' | 'Sonnet' | 'Haiku' | 'Inherit'` helper (JSON-parse with bare-string fallback, then match) in a shared module (e.g. `teamStudio/modelTier.ts`) and have both callers derive their key/label from it.

## 3. Dangling "Orchestration console" section banner + stale Grid-variant docs in teamStudioShared
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx:215
- **Scenario**: The file ends with a full section-divider comment announcing the "Orchestration console — the heart of the no-wiring assignment flow" followed by nothing — the component it introduced was removed or relocated. The file docstring (line 12) and useTeamStudioData's docstring both still describe "Grid and Split" variants, but no Grid variant exists anywhere in src (only `TeamStudioSplitVariant`); `AssignmentReplay.tsx` also carries an unused `export default` alongside its consumed named export.
- **Root cause**: Leftovers from the variant-prototype phase; the console and Grid layout were removed without sweeping the comments/exports.
- **Impact**: Misleads readers into hunting for a console component and a Grid variant that don't exist; the stray default export invites inconsistent import styles.
- **Fix sketch**: Delete the trailing banner comment block (lines 215-219), reword the two docstrings to reference the Split variant (and other current consumers), and drop `export default AssignmentReplay` (only the named import is used, by GoalsMissions.tsx).

## 4. Auto-team memory seeding is a sequential N+1 sweep over every existing team
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/teams/sub_teamWorkspace/useAutoTeam.ts:192
- **Scenario**: After creating a team, `apply()` iterates ALL teams in the store and, for each one sequentially, awaits `listTeamMembers(existingTeam.id)` and then possibly `listTeamMemories(...)` + up to 5 sequential `createTeamMemory` calls. A workspace with dozens of teams issues dozens of serial Tauri IPC round-trips while the user watches the "seeding memories" spinner; only the `seeded >= 10` break (which requires overlap hits) shortens it.
- **Root cause**: Overlap detection needs each team's member list, and it's fetched one team at a time inside the loop instead of batched or parallelized.
- **Impact**: Team-creation latency grows linearly with total team count for a step that is best-effort decoration; every non-overlapping team still pays a full members fetch.
- **Fix sketch**: Fetch all member lists concurrently (`Promise.all(allTeams.map(t => listTeamMembers(t.id).catch(() => [])))`), filter to overlapping teams, then fetch memories for just those (also in parallel) and insert the capped 10 seeds. Better: add a single Rust-side query/command ("members grouped by team" or "seedable memories for persona set") so the whole step is one IPC call against SQLite.

## 5. AutoTeamModal effect keyed on the unstable `at` object — re-runs every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:30
- **Scenario**: `useAutoTeam()` returns a fresh object literal each render, and the mount effect depends on `[at, open]`. While the modal is open, every keystroke in the query input re-runs the effect, clearing and rescheduling the 100ms focus timer; while closed (the modal is always mounted from TeamList), every TeamList re-render re-invokes `at.reset()` — eight setState calls that only no-op because React bails on identical state.
- **Root cause**: The effect only needs `open` (plus the stable `at.reset`), but the whole hook result was listed as a dependency.
- **Impact**: Constant effect churn on a hot input path, and a fragility trap: if `reset` ever gains a non-idempotent side effect (analytics, abort of in-flight work) it will fire on every parent render. The repeated re-focus can also steal focus from the role-edit inputs in the preview list.
- **Fix sketch**: Depend on `[open, at.reset]` (reset is a `useCallback([], …)` so it's stable) — or split into two effects: one `[open]` effect for the focus timer, one that calls `resetRef.current()` on the open→closed transition only.

## 6. Every capability toggle refetches the entire persona list
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/useTeamStudioData.ts:143
- **Scenario**: `toggleUseCase` awaits `setUseCaseEnabled` and then `fetchPersonas()` — a full re-fetch of all personas — just to flip one boolean inside one persona's `design_context` JSON. The row's spinner stays up for the whole round-trip, and `members` (which re-JSON-parses every member's `design_context`/`config`) recomputes for the entire roster. Toggling several capabilities in a row multiplies this.
- **Root cause**: The doc comment promises an "optimistic path" but the implementation is pessimistic: no local patch, only invalidate-everything.
- **Impact**: With a large persona library the store round-trip plus full-list re-parse makes each toggle sluggish, and N rapid toggles issue N full-list fetches (later responses can also race earlier ones).
- **Fix sketch**: Optimistically patch the one persona in `agentStore` (update its `design_context` use-case entry, reverting on error), or add a `fetchPersona(id)` single-row refresh and merge it into the store instead of `fetchPersonas()`. Keep the busy-key UX; it then only covers the single mutation call.
