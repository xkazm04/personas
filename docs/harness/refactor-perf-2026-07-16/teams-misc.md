# teams (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 4 medium / 0 low)
> Context group: Execution & Orchestration | Files read: 8 | Missing: 7

Note: 7 of the 15 files in the context spec no longer exist (`CollabLiveCorrespondence.tsx`, `CollabPane.tsx`, `DeliberationsPane.tsx`, and all 4 `sub_redRoom/` files). The Collab/RedRoom panes were retired in favor of the fleet-monitor Stream/Conversation surfaces, and several of the findings below are the orphans that retirement left behind. The context map entry is stale and should be refreshed.

## 1. `useTeamChannel()` hook and `parseDeliveries` are dead — their only callers were deleted
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_collab/useTeamChannel.ts:112 (also :44 `parseDeliveries`, collabRender.tsx:120 `dayKey`)
- **Scenario**: The file's own doc comment says the hook's callers are "CollabLiveCorrespondence, the studio roster" — `CollabLiveCorrespondence.tsx` and `CollabPane.tsx` are deleted, and a repo-wide grep finds zero call sites for `useTeamChannel(`, `parseDeliveries`, or collabRender's `dayKey`. Only the smaller exports (`useChannelSubscription`, `derivePresence`, `useTeamPresence`, `hasUnsentDraft`, `ChannelMember`) are still consumed by the monitor and studio.
- **Root cause**: The P0 monitor consolidation moved the live-chat UI to `fleet/monitor/channels/*` (Stream, Conversation), which read the channelSlice directly; the legacy view hook and its directive-receipt parser were left behind.
- **Impact**: ~60 lines of dead orchestration code in a hot, frequently-edited module; `DirectiveDelivery`/`parseDeliveries` suggest a delivery-receipts feature still exists when nothing renders it — a real trap for the next person extending the channel.
- **Fix sketch**: Delete `useTeamChannel`, `parseDeliveries`, `DirectiveDelivery`, and collabRender's `dayKey`; keep `useChannelSubscription`, `derivePresence`, `useTeamPresence`, `hasUnsentDraft` (see finding 2 for the last one). Update the module doc comment to name the real remaining consumers (monitor channels, studio roster, TeamList). Verify with `tsc` — all consumers are static imports, no dynamic use.

## 2. TeamList's unsent-draft badge reads a localStorage key that nothing writes anymore
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_collab/useTeamChannel.ts:26-35 (consumer: src/features/teams/sub_teamWorkspace/TeamList.tsx:91)
- **Scenario**: `hasUnsentDraft` checks `personas.channel.draft.<teamId>`; the only writer was the deleted `CollabLiveCorrespondence` composer. Repo-wide, `CHANNEL_DRAFT_PREFIX` has no remaining `setItem` site. A user who had a draft before the pane was retired now sees a permanent "unsent draft" badge in TeamList with no UI left to open, send, or clear it.
- **Root cause**: The composer moved to the monitor (ConversationComposer) with its own state, but the old per-team draft persistence contract and its TeamList indicator were not retired together.
- **Impact**: A misleading, unclearable UI signal for existing users, plus a phantom persistence contract that suggests drafts survive when they don't.
- **Fix sketch**: Either (a) remove `CHANNEL_DRAFT_PREFIX`/`hasUnsentDraft` and the TeamList badge, adding a one-time cleanup that removes stale `personas.channel.draft.*` keys, or (b) if the monitor's ConversationComposer should persist drafts, wire it to this key so the badge is truthful again. (a) is the smaller, honest change.

## 3. `useAssignmentProgressListener` is exported but has no consumers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_assignments/useAssignmentProgressListener.ts:10
- **Scenario**: Grep finds only its definition, the `index.ts` re-export, and a doc-comment mention in the global listener. The panel that mounted it per-team is gone; only `useGlobalAssignmentProgressListener` and `useAssignmentNotificationDispatcher` are mounted (both in BackgroundServices).
- **Root cause**: The team-scoped panel listener was superseded by the app-level global listener but the file was kept "just in case".
- **Fix sketch**: Delete the file and its `index.ts` export line; trim the "team-agnostic complement to..." paragraph in `useGlobalAssignmentProgressListener`'s doc comment. If the per-team list-reorder refresh (`fetchTeamAssignments` on `step_id === null`) is still wanted somewhere, that logic belongs in the global listener or the pipeline slice, not a dead hook. Verify no dynamic import first (none found).
- **Impact**: Dead 46-line file; also removes the latent double-subscription hazard — if remounted, every progress event would trigger `applyAssignmentProgress` (a detail re-fetch) twice, once here and once globally.

## 4. Deliberation `approveAction` can poll for up to 20 minutes after unmount with no cancellation
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/teams/sub_deliberations/useTeamDeliberations.ts:184-211
- **Scenario**: Approving a gated capability enters `for (let i = 0; i < 600 && status === 'action_running'; i++) { sleep(2s); pollDeliberationAction(id) }`. If the user switches teams or navigates away, the loop keeps issuing a Tauri IPC call every 2 s (up to 600 calls / 20 min), plus `refreshDetail` (4 parallel commands) and `refreshList` afterwards, then calls `setActionBusy` on an unmounted hook. `runToBudget`/`runAllTracks` have `runningRef` as a stop signal, but even that ref is only reset on `teamId` change (line 86-91), not on unmount — nothing stops `approveAction` at all.
- **Root cause**: The long-poll loop has no `cancelled`/unmount guard; the hook's other loops got `runningRef` but this one was written without any cooperative-cancellation check.
- **Impact**: Sustained background IPC + SQLite reads against a deliberation the user is no longer viewing; on repeated approve-then-navigate, multiple concurrent 20-minute loops accumulate. State updates on an unmounted component are silently dropped but the work is not.
- **Fix sketch**: Add a `mountedRef` (set false in a `useEffect` cleanup) and check `mountedRef.current` in the loop condition alongside `d.status === 'action_running'`; bail out of the post-loop refreshes too. Same guard belongs in `runToBudget`/`runAllTracks` (`runningRef.current = false` in the unmount cleanup). Small, mechanical change.

## 5. Selected-deliberation poll re-renders the whole pane and rebuilds its interval every 6 s even when nothing changed
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_deliberations/useTeamDeliberations.ts:106-117 (with refreshDetail at :68-83)
- **Scenario**: With an active deliberation selected, every 6 s tick runs `refreshDetail` (4 parallel Tauri calls) + `refreshList` and unconditionally `setDetail/setAgenda/setTurns/setTracks/setList` with fresh object/array identities. Even a completely idle deliberation re-renders the entire consuming pane (turn transcript, agenda, tracks list) every 6 s. Because `detail` is in the effect's dep array and gets a new identity each tick, the interval is also torn down and recreated every cycle.
- **Root cause**: Poll results are applied without change detection, and the poll effect depends on the very state it refreshes.
- **Impact**: Continuous no-op re-renders of a transcript that can hold hundreds of turns, for as long as an active deliberation is on screen; bounded but constant waste on a surface users leave open deliberately.
- **Fix sketch**: Depend on `detail?.status` (and `selectedId`) instead of the whole `detail` object so the interval survives ticks; in `refreshDetail`, skip the setState when the fetched data is unchanged (cheap check: compare `updated_at`/turn count, or `JSON.stringify` equality for the small agenda/tracks arrays). Alternatively use a functional `setTurns(prev => sameLength && sameLastId ? prev : t)` pattern to preserve identity.
