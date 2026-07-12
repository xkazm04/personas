> Context: teams/teamWorkspace [1/2]
> Total: 9
> Critical: 0  High: 0  Medium: 6  Low: 3

## 1. Unguarded `JSON.parse` in TeamWorkspacePane dirty-check can crash the settings pane
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/TeamWorkspacePane.tsx:106
- **Scenario**: The `dirty` useMemo runs `JSON.parse(team.default_model_profile).model` with no try/catch. If a team's `default_model_profile` is ever a bare (non-JSON) string, `JSON.parse` throws during render → the whole Workspace Settings pane blows up (error boundary / blank pane). The pane also re-runs this on every keystroke while editing.
- **Root cause**: Asymmetric handling of the same field. The seed path (`modelKeyFromProfile`, line 72) and the sibling `parseModelTier` in useTeamStudioData deliberately treat model-profile values as possibly-free-text (`.toLowerCase().includes(...)`, guarded parse), but `dirty` assumes strict JSON. The save path always writes JSON, but nothing guarantees every historical/backend-seeded row is JSON.
- **Impact**: crash of the settings pane for affected teams; user can't edit or disband.
- **Fix sketch**: Reuse the existing tolerant reader — compare against `modelKeyFromProfile(team.default_model_profile)` instead of re-parsing, or wrap the parse in a `try { … } catch { null }` helper shared with line 72.

## 2. "Assign & run" fails silently when decomposition errors
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx:298-336
- **Scenario**: In `handleAssign`, if `decomposeTeamAssignmentGoal` (or `createAssignment`) throws, the catch only calls `silentCatch(...)`, `setRunning(false)` runs, and nothing else changes. The spinner stops and the UI returns to its prior state with zero feedback — the user thinks the button is dead. (`handleDecompose` at least sets `steps=[]` to render a "no routing" message; the primary action gives nothing.)
- **Root cause**: The primary orchestration path swallows all errors with no user-facing surface, unlike the preview path.
- **Impact**: UX — the app's headline action appears broken; user can't tell a goal failed vs. succeeded in the background.
- **Fix sketch**: On catch, set a local error state and render an inline error strip (mirror AutoTeamModal's error card), or route through `toastCatch` instead of `silentCatch`.

## 3. Selected GitHub credential is silently dropped from the Codebase connector
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/teams/sub_teamWorkspace/TeamList.tsx:105-122 (with CreateTeamForm.tsx:162-174)
- **Scenario**: The create form lets the user pick a GitHub PAT credential (`prCredentialId` / `newPrCred`). When the team is created with a repo URL, `handleCreate` builds the Codebase connector `data` with only `project_name/team_id/github_url/mode/main_branch` — the chosen credential id is never written. The credential is used only to browse the repo list (`GitHubRepoSelector`), so the persisted connector has no linked auth.
- **Root cause**: The credential selection is consumed for repo-listing UX but never threaded into the connector payload; `newPrCred` is otherwise write-only in this component.
- **Impact**: functional — later authenticated operations (PRs, private-repo access) against the team's Codebase connector may fail with no linkage recorded; user believes they configured auth.
- **Fix sketch**: If a credential id should back the connector, include it in `data` (e.g. `credential_id: newPrCred`); if it is genuinely browse-only, drop the state and label the picker accordingly.

## 4. Redundant concurrent step-polling for the selected live mission
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: performance
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/TeamAssignmentBoardFlightDeck.tsx:69-72, 208
- **Scenario**: The focused pane calls `useAssignmentSteps(selected.id, live)` and *every* `MissionRow` also calls `useAssignmentSteps(assignment.id, live)`. For the currently-selected live assignment that's two independent 5s pollers hitting `listTeamAssignmentSteps` for the same id; with N live missions the rail alone spins up N pollers. No sharing/dedup.
- **Root cause**: Step fetching is a per-component hook with no cache, so overlap (selected row ∈ rail) double-fetches.
- **Impact**: performance / backend load — redundant Tauri IPC every 5s, scaling with fleet size.
- **Fix sketch**: Lift step state to a shared per-team map (store or context keyed by assignmentId), or have the rail strip reuse the selected pane's fetch; at minimum skip the row poller when `assignment.id === selectedId`.

## 5. AutoTeamModal focus/reset effect depends on the unstable hook object
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:30-38
- **Scenario**: `useEffect(..., [at, open])` lists `at`, which `useAutoTeam` returns as a fresh object every render. So while the modal is open the effect re-runs on every render (repeatedly scheduling/clearing the 100 ms focus timer), and while closed it calls `at.reset()` on every render. `reset()` is idempotent so no loop, but it's wasteful and fragile.
- **Root cause**: Depending on a non-memoized aggregate object rather than the specific `open` transition.
- **Impact**: maintainability / minor churn; a future non-idempotent `reset` would misbehave.
- **Fix sketch**: Depend on `[open]` only and pull `reset`/`setQuery` as stable callbacks, or memoize the returned controller in `useAutoTeam`.

## 6. Duplicated SQLite-timestamp→ISO-UTC helper
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/TeamAssignmentBoardFlightDeck.tsx:35-39 and teamStudio/AssignmentReplay.tsx:143-146
- **Scenario**: `toIsoUtc` (FlightDeck) and `toIso` (AssignmentReplay) are byte-for-byte the same logic (append `Z` / space→`T` to naive timestamps). Both live in this context; the shared `boardShared.tsx` is the obvious home and already hosts the other cross-variant primitives.
- **Root cause**: Helper copied per file instead of extracted; timezone-parsing rules that must stay in lockstep are now in two places.
- **Impact**: maintainability — a fix to one (e.g. handling millisecond precision) silently diverges the other.
- **Fix sketch**: Export a single `toIsoUtc` from `boardShared.tsx` and import it in both.

## 7. Duplicated color-swatch picker markup (CreateTeamForm vs TeamWorkspacePane)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_teamWorkspace/CreateTeamForm.tsx:127-150 and teamStudio/TeamWorkspacePane.tsx:217-233
- **Scenario**: Both render `Object.entries(TEAM_COLORS).map(...)` into near-identical swatch buttons (selected ring + `Check` icon + `drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]`). Verified both iterate the same `TEAM_COLORS` map exported from CreateTeamForm.
- **Root cause**: The swatch grid was inlined in each editor rather than extracted when identity editing was added to the workspace pane.
- **Impact**: maintainability — swatch styling/accessibility changes must be mirrored in two spots.
- **Fix sketch**: Extract a `<TeamColorPicker value onChange />` and use it in both; keep `TEAM_COLORS` as its data source.

## 8. `PENDING_META` duplicates `STEP_STATUS_META.pending`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_teamWorkspace/teamStudio/boardShared.tsx:37,46
- **Scenario**: `PENDING_META` (line 46) is an identical literal to the `pending` entry of `STEP_STATUS_META` (line 37); `stepMeta()` falls back to it. Two copies of the same object that must stay in sync.
- **Root cause**: Fallback constant hand-written instead of referencing the canonical map entry.
- **Impact**: maintainability — a change to the `pending` visual vocabulary must be made twice.
- **Fix sketch**: `const PENDING_META = STEP_STATUS_META.pending;` and drop the literal.

## 9. `createdTeam` state in useAutoTeam is set but never consumed
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/teams/sub_teamWorkspace/useAutoTeam.ts:50,122,148,271 (+ interface line 24)
- **Scenario**: `createdTeam`/`setCreatedTeam` are maintained through the apply flow and exposed on `AutoTeamState`, but the hook's only consumer — `AutoTeamModal` (grep-confirmed sole `useAutoTeam` caller) — never reads `at.createdTeam`. The modal drives its "done" panel off `memberCount`/`connectionCount`/`memoriesSeeded` instead.
- **Root cause**: Leftover state from an earlier design where the created team object was surfaced; the setter calls add noise (and a rollback path) for a value nothing observes.
- **Impact**: maintainability — dead surface area on the public hook API; misleads readers into thinking downstream depends on it.
- **Fix sketch**: Remove the field, its setter calls, and the interface member — or wire it into the "done" panel if the team object is actually wanted there.
