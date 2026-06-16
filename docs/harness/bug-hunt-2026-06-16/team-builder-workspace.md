# Bug Hunter — Team Builder & Workspace

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: team-builder-workspace | Group: Teams & Fleet Orchestration

## 1. Double-submit on Enter creates two orphaned teams
- **Severity**: Critical
- **Category**: ⚡ Race condition / double-create
- **File**: `src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:44` (and `useAutoTeam.ts:89`)
- **Scenario**: In the previewing phase the user presses Enter twice in quick succession (or Enter then clicks "Create team"). `handleKeyDown` fires `at.apply()` whenever `at.phase === 'previewing'`, and the primary button's `onClick` also calls `at.apply`. `at.phase` is read from the render snapshot, so two keydown events dispatched in the same tick (before React re-renders the `applying` phase) both observe `'previewing'` and both invoke `apply()`.
- **Root cause**: `apply()` has no re-entry guard at its top — it sets `setPhase('applying')` (async, batched) but never checks `if (phase !== 'previewing') return` or an in-flight ref. The `cancelledRef` is reset to `false` at the start of *each* call, so it offers no protection either.
- **Impact**: Two full team-creation flows run concurrently against the same blueprint: two `createTeam` calls → two team rows, double member adoption, duplicated connections, and double memory-seeding. The UI only tracks the second `createdTeam`, so the first team is orphaned with no recovery affordance (the rollback path only fires on member-add failure, not on duplicate success).
- **Fix sketch**: Add an in-flight guard: `const applyingRef = useRef(false); if (applyingRef.current) return; applyingRef.current = true;` cleared in a `finally`. Alternatively gate `apply()` on `if (phase !== 'previewing' || !blueprint) return` at the very top, and disable/remove the Enter handler once `applying`.

## 2. Auto-team reports connection count that overstates what actually persisted
- **Severity**: High
- **Category**: 💀 Silent failure / success theater
- **File**: `src/features/teams/sub_teamWorkspace/useAutoTeam.ts:148`
- **Scenario**: After members are added, `apply()` loops over `blueprint.connections` and calls `await createTeamConnection(...)`, then unconditionally does `connCount++`. But the store's `createTeamConnection` (teamSlice.ts:220) swallows backend errors via `reportError` and returns `null` on failure (cycle rejection, duplicate edge, member-belongs validation). The loop never inspects the return value.
- **Root cause**: The member loop (step 2) was hardened to null-check `addTeamMember` and roll back, but the connection loop (step 3) was not given the same treatment — null returns increment the counter as if they succeeded.
- **Impact**: The "done" screen shows e.g. "5 connections" when only 2 edges actually landed in the DB. The team's topology silently differs from the previewed blueprint; intra-team handoff wiring (which reads real connections) then cascades through fewer nodes than the user believes. Failures are invisible — `reportError` updates a store error field the modal never surfaces.
- **Fix sketch**: `const realConn = await createTeamConnection(...); if (realConn) connCount++;` and surface a non-fatal warning toast when `connCount < blueprint.connections.length`.

## 3. Preset adoption can leave an empty team shell with all errors buried in a list
- **Severity**: High
- **Category**: 🔮 Latent failure / silent partial team
- **File**: `src-tauri/src/engine/team_preset_adopter.rs:244` (team shell) + `:296` (member loop)
- **Scenario**: A preset is adopted but every member's template file is missing on disk, or `instant_adopt_template_inner` fails for all (integrity-check failure after a template edit). The team shell at step 1 is created unconditionally and "never rolled back". Each member failure is pushed to `failed_members` and the loop `continue`s; connections then skip silently (both endpoints missing), and `wire_team_handoff` runs against a zero-member graph.
- **Root cause**: Partial-success-by-design with no floor: there is no check for "zero members adopted" that would warrant deleting the shell or returning a hard error. Success is signaled by `Ok(AdoptedTeamPresetResult)` regardless of whether `members` is empty.
- **Impact**: User clicks "Adopt", sees a team appear in the list, opens it, and finds an empty canvas. The real cause (missing template / integrity drift) is only in `failed_members`, which the preview modal may render as a small "Retry N failed" badge rather than a blocking error. Empty teams accumulate and look like corruption. `dev_projects.team_id`-style downstream consumers may also bind to a memberless team.
- **Fix sketch**: After the member loop, if `members.is_empty() && !failures.is_empty()`, either delete the shell and return `AppError` with the aggregated reasons, or mark the team `enabled = false` and require explicit confirmation. At minimum, force the modal to render a blocking error when zero members landed.

## 4. Seeded team memories duplicate and diverge with no dedupe or cap enforcement
- **Severity**: Medium
- **Category**: 🔮 Latent failure / shared-memory divergence
- **File**: `src/features/teams/sub_teamWorkspace/useAutoTeam.ts:187` + `src-tauri/src/db/repos/resources/team_memories.rs:438`
- **Scenario**: Auto-team seeding copies high-importance memories from any existing team sharing a persona, inserting them with a `[Seeded]` title prefix and `run_id: null`. Creating a second team over the same overlapping personas re-seeds the same source memories again — there is no check for an already-seeded copy. Separately, the source memory can later be edited; the seeded copy is a point-in-time snapshot and silently drifts.
- **Root cause**: Seeding is a blind copy keyed only on persona overlap + `importance >= 7`, with no idempotency key (e.g. source memory id) and no link back to the origin. Eviction (`evict_excess`) only deletes rows with `run_id IS NOT NULL`, so these `run_id = NULL` seeded/manual memories are *never* evicted and never count toward triggering eviction — the 200-cap is effectively unenforced for the manual pool.
- **Impact**: Shared team memory accumulates stale, duplicated "[Seeded]" entries that are injected into pipeline context (`get_for_injection` takes top-N by importance), crowding out fresh run-generated insights and feeding agents outdated facts. Over many auto-team creations the manual pool grows unbounded.
- **Fix sketch**: Store a `seeded_from` source-id in tags and skip if a copy already exists; make `evict_excess` (or a separate cap) consider the manual pool too, or exclude seeded copies from injection after an age threshold.

## 5. Optimizer panel renders accept/dismiss but `onAcceptSuggestion` has no live consumer; stale suggestions reference deleted members
- **Severity**: Low
- **Category**: 🕳️ Edge case / optimizer stale
- **File**: `src/features/teams/sub_canvas/components/OptimizerPanel.tsx:11` + `OptimizerResults.tsx:144`
- **Scenario**: `OptimizerPanel`/`OptimizerResults` expose `onAcceptSuggestion(suggestion)` and render a fully-styled Accept button, but the only references to the panel in the teams feature are the component files themselves and `sub_canvas/index.ts` (a barrel export) — no surface wires a real accept handler. Suggestions are computed from `get_pipeline_analytics` (a snapshot of runs/members/connections at fetch time). If the user deletes a member or edge after analytics load, `affected_member_ids` / `suggested_source` / `suggested_target` now point at stale member ids.
- **Root cause**: Analytics + suggestions are a point-in-time read with no re-validation against current `teamMembers`/`teamConnections` at accept time, and the accept affordance appears live even though it is unwired (the "built-but-unwired" pattern noted across this codebase).
- **Impact**: Low because the surface is effectively dormant — but the moment it is wired, accepting a stale `connect_isolated`/`reorder` suggestion would call `createTeamConnection` with a deleted `source_member_id`, hitting the "member does not belong to team" validation (best case) or wiring an edge to the wrong node if ids were recycled. Ghost edges in `useDerivedCanvasState` already filter against current connections but not against deleted members.
- **Fix sketch**: Either hide the Accept button until the handler is wired, or at accept time re-validate every referenced member id against the current `teamMembers` set and refresh analytics, dropping suggestions whose endpoints no longer exist.
