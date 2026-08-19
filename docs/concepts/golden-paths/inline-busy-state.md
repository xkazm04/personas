# Golden path — Inline busy state

> Situation node: `ui-system/empty-and-loading/inline-busy-state` · [situation spine](../situation-spine.md)
> Hand-authored 2026-08-13 from a repo-wide ground-truth sweep (38 tool calls),
> against `master` @ `f7676ab82`. `.claude/worktrees/**` excluded from all counts.
> Dimensions: ui · function · code-quality · performance.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

> **Post-publication note — 2026-08-17. The population is 247, not 252.** Every
> `<LoadingSpinner>` count in this document was measured before `78e9bff68` deleted the
> unreachable `teams/sub_canvas/` tree. The delta is **exactly the 5 sites that lived
> there** — verified by re-running the count at `78e9bff68^`, which returns 252. The
> splits below (75 busy ternaries / 152 standalone / 21 `label` / 4 `&&`-guarded) are
> therefore historical as of that commit. **Nothing was fixed**: the corpus shrank
> because the code was removed, which is the one reading a shrinking number must not
> get. Same correction applies to [`idempotent-invocation.md`](./idempotent-invocation.md).

## Scope — read this before anything else

This path governs **one action the user just triggered**: a save, a dispatch, a
retry, a test-connection, a row-level approve. The unit is a *control* — a
button, a row affordance, a menu item — and the question is "does the person who
just clicked know their click landed, and can they click it again?"

It does **not** govern a surface loading its data. Ghosts, skeletons, empty-state
flashes, `Suspense` fallbacks and the five loading laws belong to
[`page-loading.md`](./page-loading.md). The two leaves converge on one shared
primitive (`feedback/LoadingSpinner`) and diverge in opposite directions on it,
which is exactly why the boundary has to be stated out loud:

> **Spinners are banned for surfaces and required for actions.**

`page-loading.md` is right that a spinner is never a surface loading state in
this app — you paint calm ghosts under permanent chrome. This path is the other
half: on a control the user just pressed, a spinner is the *only* honest signal,
and `buttons/Button` renders a real one (`Button.tsx:230`, `:237`), as does
`buttons/AsyncButton` (`:85`). That is deliberate, and
`docs/refactor/shared-component-reuse.md:60-61` records the 2026-05-24 decision:
"inline `Loader2` is accepted."

That doctrine is written **nowhere else**. `docs/design/overview-loading.md`
never uses the words "button", "action", "spinner" or "inline" — verified by
grep. The result is measurable: of 252 `<LoadingSpinner>` call sites, **75 sit
in an action control** where the component returns `null` and the busy state is
therefore invisible. The split is clean enough to audit — see Deviations.

## Trigger

- "This button should show a spinner while it saves."
- "Users are double-clicking Send and it fires twice."
- "I need a loading state on this row's Retry button."
- "Where do I put the `isSaving` flag — component or store?"
- "The whole list greys out when I click one row's action."
- "This action takes 40 seconds and the UI looks frozen."

If you are about to type `const [saving, setSaving] = useState(false)`,
`disabled={busy}`, `<Loader2 className="animate-spin" />`, `{loading ?
<LoadingSpinner/> : <Icon/>}`, or a `somethingRunning: boolean` field in a
Zustand slice — you are in this situation.

## The one way

**Do not hold a boolean.** Render the control as `<AsyncButton>` and give its
`onClick` a handler that **returns the promise** — `onClick={() => save(row)}`,
never `onClick={() => void save(row)}`. AsyncButton then owns every guarantee
with zero state in your component: a synchronous in-flight ref that blocks the
second click before React can re-render (`AsyncButton.tsx:35,41-46`), a real
visible `Loader2` (`:85`), `disabled`, `aria-busy` (`:100,:113`), an animated
180 ms label swap, and a reduced-motion fallback. The moment you write `void`
in that handler the returned value is `undefined`, the thenable detection at
`AsyncButton.tsx:55` never fires, and **every one of those guarantees silently
evaporates** — that is the single highest-frequency defect in this leaf (177
sites). Reach for `<Button loading={flag}>` only when the flag is genuinely not
yours to own (it lives in a store, or a sibling control drives it); `Button` has
the same guard and spinner but will not derive the flag for you. If the busy
state must be **shared** — two controls, a row plus a toolbar, or a run that
outlives the component — do not lift a boolean: key it by entity in the store as
a `Set<id>` / `Record<key, run>` added *before* the await and removed in *both*
the success and the failure branch (`credentialSlice.ts:215-246` is the
reference), and have each control read `set.has(id)`. One flag must never drive
two different actions, and a per-entity action must never be signalled by a
scalar. Never render `<LoadingSpinner>` as the busy branch of anything: it
returns `null`, so your icon disappears and nothing takes its place. And never
let a fetch-shaped surface flag reach an action control — that is
[`page-loading.md`](./page-loading.md), and the two have opposite prescriptions.

## Mandated primitives

- **`shared/components/buttons/AsyncButton.tsx`** — `AsyncButton` + `AsyncButtonProps`. **The default answer.** Props: `isLoading?` (optional — it derives its own when `onClick` returns a thenable), `loadingText?`, plus everything `Button` takes. Gives you: synchronous double-submit guard (`inFlightRef`, `:35`), guard released in a `finally` so a *failed* action is retryable (`:57-60`), visible spinner (`:85`), `disabled || busy` (`:99,:112`), `aria-busy` (`:100,:113`), `AnimatePresence` label swap, `useReducedMotion` fallthrough to `Button`'s plain swap (`:94-107`).
- **`.../buttons/Button.tsx`** — `Button` + `ButtonProps`. Use when the flag is externally owned. `loading?: boolean` renders a real spinner (icon-only variant `:230`, labelled variant `:237`), dims the label (`:216`), sets `aria-busy` (`:226`), disables (`:128`), and **locks the resting width** in a `useLayoutEffect` so the button cannot collapse when the label swaps (`:139-148`). `loadingLabel?: ReactNode` replaces the children while busy (`:215`) — pass a translated string. Also carries the thenable double-submit guard (`:166-182`).
- **`.../feedback/ConfirmDialog.tsx`** — the destructive-action case. `onConfirm` may return a promise; while pending it disables both buttons, sets `aria-busy` (`:83`), and ignores backdrop/Escape dismissal (`:52-55`) so the action cannot be fired twice. You pass no flag.
- **`.../forms/FormField.tsx`** — inline async *validation* busy (`:253-258` label spinner, `:336` availability-check spinner). Use for "is this name taken" style checks; do not hand-roll a spinner next to an input.
- **`stores/improveActivityStore.ts`** — the reference **feature-scoped per-entity registry**: `byCell: Record<cellKey, { runId, kind }>` plus a `byRun` reverse index so a completion event that only knows the run id can resolve the cell (`:15-21`). Copy this shape when a run is keyed by something other than a row id.
- **`stores/slices/processActivitySlice.ts`** — the **app-wide** registry for runs that outlive their component: `processStarted(domain, runId, label, navigateTo)` / `enrichProcess` / `updateProcessStatus` / `processEnded`, feeding the titlebar activity dock. Use for anything measured in minutes.
- **`stores/slices/vault/credentialSlice.ts:215-246`** — the **canonical store-side per-entity in-flight set**. Add to `pendingDeleteCredentialIds` before the await; delete it in the success branch *and* the catch branch; consumer reads `pendingDeleteIds.has(id)` (`CredentialList.tsx:28,:149`).
- **`hooks/utility/interaction/useKeyedCopyFlag.ts`** — the keyed-feedback shape to imitate when you must hold busy locally for a list (`copiedKey`/`copy(key, …)`). There is no busy equivalent yet; see Gaps #2.
- **`lib/silentCatch.ts` `toastCatch()`** — the error half. A busy state that ends in a silent `catch {}` is worse than none: the spinner stops and the user learns nothing.

**Explicitly NOT a primitive here:** `feedback/LoadingSpinner`. It renders
`null` (`LoadingSpinner.tsx:12-21`) and emits only an `sr-only` `role="status"`
when given `label`. It is a surface-side compatibility shim. It must never
appear in an action control.

## Steps

1. **Decide the scope of the flag before you write a line.** Three tiers, in order of preference:
   - **Component-local, one control** → `AsyncButton`, no state at all.
   - **Shared between controls, or per-row** → a keyed set. Local `useState<Set<string>>` if the list owns it (`DeadLetterTab.tsx:134`); a store field if two components read it.
   - **Outlives the component** (a dispatch, a scan, a multi-minute run) → `processActivitySlice.processStarted(...)` / `processEnded(...)`, so the titlebar dock shows it after the user navigates away.
2. **Write the handler as an ordinary `async` function that returns its promise** and terminates in `toastCatch('<Feature>:<action>')`. `PolicyProposalsSection.tsx:79-87` is the shape.
3. **Render `<AsyncButton onClick={() => apply(row)}>`.** No `isLoading`, no `useState`, no `try/finally`. **Do not write `void`.**
4. **Only if the flag is external, use `<Button loading={flag} loadingLabel={t.…}>`.** `loadingLabel` must be a translated string, never a literal.
5. **For a per-row action, key the flag by the row.** Add before the await, remove in `finally` (or in both success and catch branches when the store owns it). The control reads `busy.has(row.id)`, never a bare boolean.
6. **For a non-button affordance** (a row's gear, a refresh icon, a status cell), spin the icon **in place** and set `disabled` + `aria-busy` on the enclosing control. Do **not** swap the icon for a different element: that changes the box and shifts the row.
   ```tsx
   <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
   ```
7. **Give any action over ~2 s a label, not just a spinner.** `loadingText` / `loadingLabel`, or a progress interpolation like `useSequentialReview`'s `{done}/{total}` (`StaleSweepButton.tsx:31`). A spinner alone on a 40-second run reads as a hang.
8. **Stop.** No `useState(false)`, no `try { setBusy(true) } finally { setBusy(false) }`, no `<LoadingSpinner>`, no `opacity-60` on the surface behind the button, no full-page overlay.

## Anti-patterns

- **`{busy ? <LoadingSpinner/> : <Icon/>}`** — the worst move available, and the most common: `LoadingSpinner` returns `null`, so pressing the button makes its icon *vanish and nothing replace it*. The control looks broken rather than busy. **73 sites across 53 files.** `KbPickerDialog.tsx:119` is the pure form: `{pending ? <LoadingSpinner className="text-violet-200" /> : null}` — a busy branch that is `null` either way.
- **`onClick={() => void handleSave()}` on a `Button`/`AsyncButton`** — `void` yields `undefined`, the thenable check (`Button.tsx:174`, `AsyncButton.tsx:55`) fails, and the double-submit guard plus AsyncButton's self-derived spinner both silently switch off. There is no warning, no type error, and the button still *looks* right. 177 `() => void` handlers exist in 94 files; 34 are directly on a `Button`/`AsyncButton`.
- **Rendering `<AsyncButton>` with a `void` handler *and* no `isLoading`** — belt and braces both removed. 15 files, 22 renders (see Deviations).
- **A scalar flag for a per-entity action** — clicking row 3's Retry disables and spins every row. The store half of the same mistake: 266 slice actions take an entity id, and exactly **2** per-entity in-flight sets exist in the entire store tree.
- **One flag driving two different actions** — `memoryReviewRunning` (`memorySlice.ts:29`) is set by both `reviewMemories` and `reflectPersona` and read by four buttons across three components; triggering either spins both. Same defect at finer grain in `MessageDetailModal.tsx:953,:967` (one `resolving` spins Approve *and* Reject).
- **An async store action that exposes no in-flight state** — every consumer then invents its own, differently. `resolveHealingIssue(id)` has four callers and four treatments, three of which show nothing at all (see Deviations).
- **`disabled={busy}` with no `aria-busy`** — a screen-reader user hears the control go dead with no explanation. `aria-busy` appears **10 times in all of `src/`**, six of them inside the shared primitives and their tests; **4 feature call sites**, against 93 files that disable a control from a busy flag.
- **Swapping the icon for a `Loader2` element** rather than spinning it in place — different intrinsic size, so the label jumps. 52 sites in 33 files. `Button` already solves this with its width lock; a raw `<button>` does not.
- **Hardcoded English busy labels** — `'Saving…'`, `'Reviewing...'`, `'Loading...'`. 17 sites in 16 files, plus `DataGrid.tsx:125`'s default `loadingLabel = 'Loading...'`.
- **Hand-rolling `try { setBusy(true) } … finally { setBusy(false) }`** — **158 action-named busy flags across 149 files** in `src/features/**` (`saving`/`busy`/`submitting`/`running`/`deleting`/`testing`/`sending`/`dispatching`/`generating`/`applying`/`retrying`/`resolving`/`approving`/`drafting`), inside a wider 825 `useState(false)` population. `useAsyncAction` was written in this repo to delete exactly that block and has **zero adopters** (see Gaps #3).
- **A busy state whose failure path is a bare `catch {}`** — the spinner stops, the row does not change, and the user concludes the app ate their click. Route through `toastCatch`; `custom/no-silent-catch` is already `error`.
- **Dimming or overlaying the surface behind the control** — that is a surface loading state, and law 1 of `overview-loading.md` forbids it. Busy belongs on the control the user pressed.

## Evidence

**Adoption:** 49 `<AsyncButton>` renders across 39 files; **56** `loading={…}` props on `<Button>` (of 95 `loading=` props repo-wide — the other 39 are on domain components); 21 `ConfirmDialog` sites; 13 files registering with `processActivitySlice`; 1 feature-scoped per-cell store; 1 store-side per-entity in-flight set. Against **2,877 raw `<button>` elements in 1,116 files** and 261 `<Button>` renders.

- **`settings/sub_engine/components/PolicyProposalsSection.tsx:264` — copy this one.** `<AsyncButton variant="primary" onClick={() => apply(p)}>` where `apply` (`:79-87`) is `async`, awaits the IPC call, refreshes, and ends in `toastCatch`. The component holds **no busy state whatsoever**, and gets the guard, the spinner, `aria-busy` and the label swap for free. Three such buttons in one file (`:264`, `:282`, `:301`).
- `overview/sub_director/components/StaleSweepButton.tsx:26-38` — the long-running variant: `isLoading={running}` plus `loadingText={tx(t.director.review_filtered_progress, { done, total })}`, so a multi-minute sequential batch reports progress instead of spinning silently. Shares `useSequentialReview` with `ReviewFilteredAction.tsx:29-41`.
- `stores/slices/vault/credentialSlice.ts:215-246` — **the store-side reference.** Add to `pendingDeleteCredentialIds` before the await, remove it in the success set *and* in the catch, tombstone separately so a late fetch can't resurrect the row. Consumed at `CredentialList.tsx:28,:149`.
- `stores/improveActivityStore.ts:24-47` — per-cell registry with a `byRun` reverse index and a `selectAnyImproveRunning` roll-up for the sidebar dot. The right shape when completion arrives asynchronously by run id.
- `teams/sub_factory/passport/improve/ImproveCell.tsx:69-86` — the non-button consumer of that store: `busy` read by cell key, `disabled`, `aria-busy` (`:73`), and the gear **spun in place** at `:82` so the row geometry never moves.
- `triggers/sub_dead_letter/DeadLetterTab.tsx:134,:685-689` — the local per-row set done correctly: `actionsInProgress: Set<string>`, `disabled={actionsInProgress.has(evt.id) || bulkInFlight}`, icon spun in place. Also models the row-flag / bulk-flag composition.
- `agents/sub_use_cases/…/usePolicyControls.ts:38,:70` — **the answer to "one flag, many actions": discriminate, don't boolean.** `pending: PolicyKey | null` is shared by three sibling toggles, each reading `pending === 'memories' | 'reviews' | 'events'` (`TilePolicyToggles.tsx:31,:40,:43`), so pressing one never busies the other two. Same shape as `BulkActionsToolbar`'s `busyOp`. (Its *indicator* is weak — see Deviations.)
- `shared/components/buttons/Button.tsx:139-148` — the width lock; `:159-182` — the guard, with a comment explaining precisely why a reactive flag is insufficient (the native click event dispatches synchronously, before React commits).
- `shared/components/feedback/ConfirmDialog.tsx:39-55` — busy owned entirely inside the primitive, including refusing dismissal mid-flight.
- `shared/components/buttons/Button.test.tsx:53,:67` — the only regression coverage that exists: `aria-busy` + re-click blocking, and the icon→spinner swap.

## Deviations found

### P0 — the shared-layer root cause (fix first; upstream of ~75 files)

| Path | What's wrong |
|---|---|
| `shared/components/feedback/LoadingSpinner.tsx:12-21` | Renders `null`. Three documents mandate it as canonical, so following the documentation produces an **invisible** busy state. Not a bug in the component — a bug in what points at it. Either rename it `SrOnlyLoadingStatus` (making the no-op legible at every call site) or make it `throw` in dev when rendered without `label`. |
| `.claude/Design.md:297` | "spinner → `feedback/LoadingSpinner`" in the don't-hand-roll table. Points at the no-op. |
| `src/features/shared/components/CATALOG.md:97` | "Canonical loading spinner with size + a11y label. Use for any full-element loading state." Describes a visual that does not exist. Generated from the component's own missing `@catalog` tag. |
| `docs/refactor/shared-component-reuse.md:19` vs `:60-61` | **The same file contradicts itself.** Line 19's quick-reference says `<div className="animate-spin">` → `LoadingSpinner`; lines 60-61 say the opposite ("LEAVE — intentional no-op; inline `Loader2` is accepted"). A developer reads the table, not the audit 40 lines down. Delete the row at `:19`. |
| `docs/design/overview-loading.md` | Contains no rule for action/control busy state at all — no occurrence of "button", "action", "spinner" or "inline". The surface half is doctrine; the action half is folklore. Add the one-line boundary: **spinners banned for surfaces, required for actions.** |

### `<LoadingSpinner>` inside an action control — the icon vanishes (73 sites / 53 files)

The full split of all 252 `<LoadingSpinner>` sites: 21 pass `label` (sr-only only), **75 are a busy ternary** (73 inside an action control, 2 elsewhere) — this leaf; 152 standalone + 4 `&&`-guarded are surface loading — [`page-loading.md`](./page-loading.md)'s leaf. Highest-value first:

| Path | What's wrong |
|---|---|
| `plugins/drive/knowledge/KbPickerDialog.tsx:119` | `{pending ? <LoadingSpinner …/> : null}` — both branches render nothing. Compounded: `pending` is scalar, so every KB row button (`:81-86`) disables with no indication of *which* one is being picked. |
| `overview/sub_observability/components/HealingIssueModal.tsx:224` | Local `resolving` flag and a re-entrancy guard are both correct — then the spinner is the no-op, so only the label changes and the check icon disappears. |
| `overview/sub_memories/components/MemoriesPageDense.tsx:214-227` | **Six defects in fourteen lines.** Raw `<button>`; no-op spinner ×2; one `memoryReviewRunning` flag driving two *different* actions (Review, Reflect); hardcoded `'Reviewing...'` / `'Review'`; no `aria-busy`; label swap on an unlocked width. |
| `overview/sub_memories/components/MemoriesPageGraph.tsx:117-119` · `MemoryHeaderActions.tsx:29-30` | The same block copy-pasted twice more, same flag, same hardcoded English. |
| `agents/sub_deployment/components/BulkActionsToolbar.tsx:93,:105,:126` | `busyOp === 'pause' \| 'resume' \| 'delete'` is correctly discriminated per action — and then all three render the no-op. `:126` swaps the confirm *label* for nothing, leaving an empty button. |
| `agents/sub_deployment/components/cloud/DeploymentCard.tsx:87,:99,:111` · `DeploymentSubComponents.tsx:118` · `CreateTriggerForm.tsx:141` | Deployment controls; icons vanish on press. |
| `plugins/obsidian-brain/sub_setup/SetupPanel.tsx:205,:262,:380` · `sub_cloud/CloudSyncPanel.tsx:233,:286,:295` · `sub_sync/SyncPanel.tsx:215,:226` · `sub_graph/GraphPanel.tsx:255` | Nine sites in one plugin — the densest cluster. Every long-running sync/push/pull button goes blank mid-flight. |
| `settings/sub_network/components/BundleExportDialog.tsx:355,:365,:374,:385` | Four in one dialog. `:355`/`:365` are three-way ternaries where the busy branch is the only invisible one, so the user sees idle → nothing → ✓. |
| `plugins/dev-tools/sub_context/ContextMapHealth.tsx:161,:209,:260` | Passes `icon={busy === 'audit' ? <LoadingSpinner/> : <Stethoscope/>}` **to a `<Button>` that has a working `loading` prop**. Delete the ternary, pass `loading={busy === 'audit'}`. |
| `plugins/dev-tools/sub_overview/StandardsScanCard.tsx:75` · `plugins/gitlab/components/GitLabPipelineViewer.tsx:101` | Same pattern — no-op spinner injected as `icon` on a `Button`. |
| `settings/sub_portability/components/CredentialPortability.tsx:106,:143` · `ExportSection.tsx:112` · `export-prototype/panels.tsx:218` | Import/export buttons on multi-second operations, no visible busy. |
| `triggers/sub_triggers/TriggerDetailDrawer.tsx:91,:102` · `WebhookRequestInspector.tsx:126` · `sub_smee_relay/SmeeRelayTab.tsx:316` · `sub_studio/StudioPatchbay.tsx:238` · `suggestions/GhostCables.tsx:116` | Trigger test / dry-run / replay controls. |
| `agents/sub_connectors/…/AutomationCard.tsx:55,:94` · `AutomationTriggerStep.tsx:182,:208` · `AutomationActionStep.tsx:49` · `AutomationReviewStep.tsx:28` · `ConnectorsTabSections.tsx:147` · `ConnectorStatusCard.tsx:78` · `channels/NotificationChannelCard.tsx:136` | Connector test/send buttons — the exact controls where "did it fire?" matters most. |
| `agents/sub_tool_runner/components/ToolInvocationCard.tsx:156` · `recipes/sub_editor/components/RecipeEditor.tsx:156` · `sub_playground/tabs/RecipeVersionsTab.tsx:209` · `schedules/components/ScheduleRow.tsx:374` | `ScheduleRow.tsx:374` swaps the *label* for the no-op, so the backfill button empties on click. |
| `plugins/dev-tools/sub_llm_overview/LlmOverviewPage.tsx:258` · `sub_triage/findings/SweepButton.tsx:90` · `sub_context/contextMapPerf.tsx:126` · `plugins/gitlab/…/DeploymentHistoryTab.tsx:101` · `GitOpsVersionHistory.tsx:184` | |
| `templates/sub_generated/gallery/search/suggestions/SearchChipInput.tsx:44,:121` · `design-preview/ConnectorsSection.tsx:217` · `teams/sub_teamMemory/…/MemoryPanelList.tsx:137` · `overview/sub_events/…/EventLogList.tsx:250` · `triggers/sub_triggers/TriggerExecutionHistory.tsx:100` | |

### The guard silently disarmed — `void` handlers (34 on shared buttons; 177 total)

`Button.tsx:174` and `AsyncButton.tsx:55` both detect an in-flight action by
checking whether `onClick` returned a thenable. `() => void fn()` returns
`undefined`. Nothing warns.

| Path | What's wrong |
|---|---|
| **15 files render `<AsyncButton>` and never pass `isLoading`** — `agents/sub_deployment/components/cloud/CloudReconcileBanner.tsx` (2) · `overview/sub_patterns/CreatePracticeModal.tsx` · `plugins/artist/sub_media_studio/VoiceoverButton.tsx` · `plugins/dev-tools/sub_skills/analytics/StaticScanConfigModal.tsx` · `scraper/EditorSteps.tsx` · `scraper/LlmRuleBuilder.tsx` · `settings/sub_devices/components/RemoteInstructionComposer.tsx` · `settings/sub_engine/components/ModelRoutingSection.tsx` · `settings/sub_engine/components/PolicyProposalsSection.tsx` (3) · `settings/sub_portability/components/StorageUsageSection.tsx` · `teams/sub_kpis/{KPIConnectWizard,KpiDetailModal,KPIProposalModal,KPIsPage}.tsx` (9) · `triggers/sub_studio/system_ops/SystemEventCommitModal.tsx` | 22 renders whose **only** busy signal is the thenable detection. Audited: these pass bare references (`onClick={generate}`, `onClick={() => apply(p)}`) so they currently work — but they are one `void` away from silently losing the spinner *and* the guard, with no test and no lint to catch it. This is the fragility, not yet the defect. |
| 34 `onClick={() => void …}` on `<Button>`/`<AsyncButton>` across the tree | Guard off. Convert to `onClick={() => fn()}` — the handler already ends in `toastCatch`, so there is no unhandled rejection to fear. |

### One flag, many actions

| Path | What's wrong |
|---|---|
| `stores/slices/overview/memorySlice.ts:29` (`memoryReviewRunning`) | Set by two distinct actions (`:216`, `:245`) and read by four buttons in three components. Clicking Review spins Reflect. Split into `memoryReviewRunning` / `memoryReflectRunning`, or key by persona id. |
| `overview/sub_messages/components/MessageDetailModal.tsx:953,:967` | Correctly keyed per review (`resolvingReviewId === r.id`, `:757`) — but *within* the row, one `resolving` spins both Approve and Reject, so the user cannot tell which verdict is in flight. |
| `teams/sub_factory/l2/FactoryOverviewTab.tsx:404,:412` | `ctxScanId` drives two different context-scan buttons. |
| `overview/sub_observability/components/HealingIssuesPanel.tsx:132-136` | `healingRunning` on the analysis button, plus a hardcoded English `aria-label` at `:133` (`'Analysis in progress'`). |

### The store half — per-entity actions with scalar or absent flags

Repo-wide: **400** `Promise`-returning actions declared across `src/stores/slices/**`; **266** of them take an entity id; **62** scalar busy booleans; **2** per-entity in-flight sets (`pendingDeleteCredentialIds`, `pendingDeleteEventIds`, both in `credentialSlice`).

| Path | What's wrong |
|---|---|
| `stores/slices/overview/healingSlice.ts:26` (`resolveHealingIssue(id, personaId?)`) | **The case study.** No in-flight state of any kind, so four consumers invented four answers: `HealingIssueModal.tsx:25` holds a local boolean and renders the no-op spinner; `ToastContainer.tsx:156` awaits with no signal at all; `useInboxActions.ts:92` awaits with no signal; `HealingIssuesPanel.tsx:21` types the action as `(id: string) => void`, **discarding the promise**, so it cannot show busy even in principle. Add `resolvingHealingIds: Set<string>` to the slice and delete all four hand-rolls. |
| `stores/slices/overview/alertSlice.ts:187` | `pendingSyncAlertIds` looks like an in-flight set but is a *failure* set ("shown in the UI but failed to persist"). Do not copy it as the busy pattern; name-collision hazard. |
| 62 scalar `*Loading` / `*Running` fields across 31 slices | Correct only where the action is genuinely a singleton (`healingRunning`, `obsidianSyncRunning`). Audit each against whether its action takes an id. |

### Actions with no busy state at all

| Path | What's wrong |
|---|---|
| `teams/sub_factory/passport/improve/ImprovePlanPanel.tsx:148` | The per-row "Run" button dispatches `runScan(it)` — a multi-minute scan — and never changes. No disable, no spinner, no `aria-busy`. Its sibling `ImproveCell.tsx` in the same folder does this correctly via `improveActivityStore`; this panel simply doesn't read it. |
| `overview/sub_observability/components/HealingIssuesPanel.tsx:238` | `onResolve={resolveHealingIssue}` typed `=> void`; the promise is dropped on the floor. |
| `agents/sub_use_cases/…/TilePolicyToggles.tsx:64-83` | The *flag* is exemplary (discriminated `pending === 'memories'`); the *indicator* is `disabled` + `opacity-50` and nothing else — no spinner, no `aria-busy`. A dimmed 24 px circle reads as "unavailable", not "working". The right fix is `<Button size="icon-sm" loading={…}>`, which already renders the icon-only spinner at `Button.tsx:230`. |
| 93 files drive `disabled=` from a busy flag with **no `aria-busy` anywhere in the file** | Screen readers get a control that goes dead without explanation. |

### i18n leaks in busy labels (17 sites / 16 files)

`agents/sub_use_cases/components/core/EventRenameModal.tsx:318` (`'Saving…'`) · `overview/sub_memories/components/MemoriesPageDense.tsx:216` · `MemoriesPageGraph.tsx:119` · `MemoryHeaderActions.tsx:30` (`'Reviewing...'` ×3) · `recipes/sub_manager/components/RecipeManager.tsx:88` · `teams/sub_factory/passport/improve/DataLinksPopover.tsx:128` · `vault/sub_credentials/components/forms/FormActions.tsx:76` (`'Saving...'`) · `vault/sub_credentials/components/picker/ResourcePicker.tsx:409` · `teams/sub_factory/passport/improve/ImproveCell.tsx:74` (`'Upgrade running…'` in a `title`) · `overview/sub_observability/components/HealingIssuesPanel.tsx:133` (`aria-label`) · `shared/components/display/DataGrid.tsx:125` (default `loadingLabel = 'Loading...'` — should have no default).

### Dead primitive

`hooks/utility/interaction/useAsyncAction.ts` — **zero adopters** in the entire
tree (grep returns only its own JSDoc). Its docstring claims to replace a
pattern the repo repeats 261 times. See Gaps #3 for why nobody uses it.

## Gaps in the primitive

1. **No shared inline busy indicator for anything that is not a button.** `Button`/`AsyncButton` own the button case completely; a row's gear, a refresh affordance, a tab label, a status cell have nothing. The result is **242 hand-rolled `animate-spin` lines across 177 files** outside `shared/components/**` (254 across 185 including the 8 primitive/test files that legitimately own one), in two mutually inconsistent shapes — **73 spin-in-place** (`? 'animate-spin' : ''`, 66 files — geometry-safe, the right one) and **52 element-swap** (`? <Loader2/>`, 33 files — shifts layout). `display/ActivityDot` exists but is `aria-hidden` decorative with no busy tone and 4 adopters. **Needed:** `display/BusyIcon` — wraps a lucide icon, spins in place, no layout change, and warns if its parent control lacks `aria-busy`.
2. **No keyed-busy primitive.** `useKeyedCopyFlag` proves the shape is wanted for copy feedback (6 adopters) but there is no `useBusySet` / `useKeyedBusy`. Consequence: **9** hand-rolled busy sets — `DeadLetterTab.tsx:134` (`actionsInProgress`), `RegistryTab.tsx:61` (`adopting`), `MonitorCapabilities.tsx:31` (`executing`), `LlmOverviewPage.tsx:158` (`proposing`), `CoveragePipeline.tsx:60` / `DeepScanRecommendations.tsx:35` (`dispatched`), `AutomationsSection.tsx:56` (`transitioningIds`), `MastermindGoalsModal.tsx:36` (`busyIds`), `CredentialEventConfig.tsx:30` (`savingIds`) — each independently re-deriving add-before-await / delete-in-finally, plus **14** `useState<…Id | null>` single-slot busy-ids, inside a wider population of **78** `useState<Set<string>>` where selection, expansion and busy-tracking all wear the same undifferentiated shape. The store side is stuck at 2 sets against 266 per-entity actions. A ~20-line `useBusySet<K>()` returning `{ isBusy, run }` where `run(key, fn)` owns the add/remove would collapse most of Deviations §"store half" and §"per-row" — and give the gate a name to key on.
3. **`useAsyncAction` is structurally unusable, which is why it has 0 adopters** despite its docstring claiming ~70% of component fetches hand-roll the block it replaces (158 such flags, 149 files). `execute` is `useCallback(…, [fn, options])` and *both* deps are inline literals at every plausible call site, so `execute` gets a new identity every render — it cannot be a `useEffect` dep or be passed to a memoized child without defeating the memo. It also swallows the error into local state (`:63-70`) instead of routing through `toastCatch`, which `custom/async-catch-requires-helper` pushes everything else toward. Fix (stash `fn` in a ref, default `onError` to `toastCatch`) or delete it — a canonical hook nobody can use is worse than none, because the docstring keeps promising.
4. **The double-submit guard is thenable-keyed with no diagnostic.** Both `Button` and `AsyncButton` decide "is this async?" by sniffing the return value. The repo's dominant handler idiom (`() => void fn()`, 177 sites) returns `undefined` and turns the guard off silently. There is no dev warning, no type-level signal (`onClick` is `MouseEventHandler`, which returns `void` by type), and no test. **Minimum fix:** a dev-only `console.warn` when `AsyncButton` receives neither `isLoading` nor a thenable from a handler that was clicked. **Better fix:** a distinct `onAction?: () => Promise<unknown>` prop that is typed to return a promise, so `void` becomes a type error.
5. **No minimum-visible duration.** `Button.loading` flips instantly, so a 40 ms action flashes a spinner; `AsyncButton`'s `AnimatePresence` swap is 180 ms in *and* 180 ms out, so a fast action produces a visible in-out flicker that reads as a glitch. Neither exposes `minVisibleMs`. (Note the asymmetry with `page-loading.md`, where the delay deliberately lives on the *placeholder* — here the delay would need to live on the *exit*.)
6. **`Button` and `AsyncButton` are not interchangeable and the difference is undocumented.** `Button` has the guard but will not derive its own visual — `<Button>` with an async handler is guarded and *silent*. `AsyncButton` derives both. `CATALOG.md:20-21` describes them as if they were siblings. State the rule: **`AsyncButton` by default; `Button loading=` only for externally-owned flags.**
7. **`ConfirmDialog` owns busy correctly but shows nothing.** It disables and sets `aria-busy` (`:74,:82-83`) but renders raw `<button>`s rather than `Button`, so the confirm action on a slow destructive operation has **no spinner** — the dialog just freezes. It also exposes no `busy` prop, so a caller that already knows the action is running cannot reflect it. 21 call sites inherit this.
8. **`AsyncButton` has zero tests.** `Button.test.tsx` covers `loading` in 2 of 6 cases (`:53` aria-busy + re-click block, `:67` icon swap). The canonical primitive — the one carrying the in-flight ref, the retry-after-failure release, and the reduced-motion branch — has none. The `finally`-release at `:57-60` (which makes a *failed* action retryable) is exactly the kind of subtlety that regresses unnoticed.
9. **No enforcement.** 21 custom ESLint rules exist — including `custom/prefer-shared-clipboard` for a 31-site problem and `custom/prefer-numeric` for a 240-site one — and **none** covers busy state, a ~600-site problem across two layers. Every deviation above shipped under a green `npm run check`.

## The missing gate

Two of the three signals here are cleaner than `role="columnheader"` was for
tables (6 files, 4 true positives), because they key on **a no-op primitive** and
**a syntactic form**, not on a judgement call.

### Signal 1 — `<LoadingSpinner>` in a conditional (precision ≈ 100%)

`feedback/LoadingSpinner` renders `null`. Therefore *every* `{x ?
<LoadingSpinner/> : …}` and `{x && <LoadingSpinner/>}` is wrong by
construction — either an invisible action busy state (this path) or a spinner
where `page-loading.md` mandates a ghost. **252 call sites; among the 231 that
pass no `label` there is no legitimate use — the component cannot render
anything, so the false-positive rate is structurally zero.** AST-detectable with
no heuristics: `JSXElement` whose `openingElement.name.name === 'LoadingSpinner'`.

### Signal 2 — `void` inside an `onClick` on a shared button (precision 100%)

`JSXAttribute[name.name='onClick']` whose value is an `ArrowFunctionExpression`
with a `UnaryExpression` body of `operator: 'void'`, on a `JSXOpeningElement`
named `Button` or `AsyncButton`. 34 hits today; each one provably disarms the
guard. Autofixable (strip the `void`).

### Signal 3 — `disabled={<flag>}` without `aria-busy` (precision ~85%, warn-only)

An element with `disabled={X}` where the same `X` identifier also appears in a
conditional expression within the element's children, and the element carries no
`aria-busy`. 93 files. Noisier — some `disabled` flags are validity, not busy —
so ship it at `warn` and let the co-occurrence with a conditional carry it.

### Mechanism

One rule file, `eslint-rules/no-noop-busy-state.cjs`, registered in
`eslint.config.js` beside its 21 peers, with three `messageId`s:

| messageId | Severity | Message |
|---|---|---|
| `noopSpinner` | **error** | `LoadingSpinner renders null. For an action control use <AsyncButton> (it renders a real spinner); for a surface use a ghost — see docs/concepts/golden-paths/inline-busy-state.md.` |
| `voidDisarmsGuard` | **error** (fixable) | `void in this onClick makes the handler return undefined, silently disabling the double-submit guard and AsyncButton's spinner. Return the promise.` |
| `busyWithoutAriaBusy` | warn | `This control is disabled by a busy flag but has no aria-busy.` |

ESLint is the right host over a `scripts/check-*.mjs` grep for a structural
reason: `eslint.config.js` loads each rule with a top-level `require()`, so a
missing or broken rule file **throws at config load and ESLint exits non-zero**.
A grep script that no-ops when its glob matches nothing exits 0 — the failure
mode `ci.yml` is already a museum of.

### Allowlist

- `shared/components/feedback/LoadingSpinner.tsx` — the component itself.
- `shared/components/buttons/{Button,AsyncButton}.tsx`, `forms/FormField.tsx`, `feedback/ConfirmDialog.tsx` — the primitives that own the real spinner.
- `<LoadingSpinner label={…} />` rendered as a sibling of a *visual* ghost, i.e. deliberate sr-only announcement — 21 sites today. Allowed only via an explicit `// eslint-disable-next-line custom/no-noop-busy-state -- sr-only status beside a ghost`, so each survivor is a recorded decision rather than a default.
- `*.test.tsx` / `*.stories.tsx`.
- No allowlist at all for `voidDisarmsGuard`. There is no legitimate reason to `void` a handler on these two components.

### How it fails loudly if its own precondition is absent

The rule depends on two ground truths about the primitives, and on its own
continued ability to match. All three can rot silently, so each gets a guard —
and the fourth item keeps the backlog from re-growing behind the rule:

1. **`LoadingSpinner` still renders nothing.** If someone "fixes" it to render a real spinner, `noopSpinner` becomes 252 lines of wrong advice. Add to `src/features/shared/components/feedback/__tests__/LoadingSpinner.test.tsx`:
   `expect(render(<LoadingSpinner size="sm" />).container.innerHTML).toBe('')` — with a comment naming this golden path. The day that assertion fails, the rule must be revisited, and the test says so.
2. **`Button.loading` still renders a real spinner.** Extend `Button.test.tsx` (which already asserts the swap at `:67`) with an explicit `.animate-spin` presence check, so the rule's recommended destination cannot silently become a no-op too.
3. **The rule still matches its own corpus.** Ship it with `RuleTester` cases in `src/test/eslint-rules/customRules.test.ts` (the existing harness, 12 of 21 rules covered) — one `invalid` case per `messageId` with an exact `errors: N`. RuleTester *fails* when a rule stops reporting, which is precisely the silent-decay mode a grep gate cannot detect.
4. **The migration ratchets down, never up.** `scripts/check-busy-state.mjs` records the remaining `noopSpinner` count in a committed baseline and fails when the count rises. It must `process.exit(1)` — not 0 — when the baseline file is missing **or** when its file glob returns zero matches, because "found nothing" and "looked at nothing" are the same exit code otherwise.

Ship `noopSpinner` and `voidDisarmsGuard` at `error` from day one: both have
bounded, fully enumerated corpora (252 and 34), and unlike the design-token
migrations there is no long tail to grandfather — every hit is a real defect
with a one-line fix.
