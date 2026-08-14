# Golden path — Stale response guard

> Situation node: `client-runtime/data-fetching/stale-response-guard` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `cf14b9832`. Ground-truth sweep: every
> `let cancelled|active|alive|stale|mounted|aborted = <bool>` site under `src/`
> (**246 sites in 215 files**, enumerated by the census runner; ~30 read
> individually with their dep arrays extracted and compared against every
> identifier passed as a call argument), every capture-a-pre-incremented-counter
> site (**43 sites in 37 files**, 33 read individually), every
> `new AbortController(` site (**14 sites in 13 files**, all read), both
> sanctioned primitives and all **10** of their adopters, every entity-keyed
> async action across **15 Zustand slices**, **24** shared-busy-id clear sites,
> `src/lib/tauriInvoke.ts` in full, the five guard-regression tests, all 21
> custom ESLint rules and `conventions.json` — plus a convergence pass over
> `personas-web` and `brainiac`. **73 unguarded sites verified by reading.**
> Every count below was produced by reading or by a validated census run, not
> estimated. `.claude/worktrees/**` excluded.
> Shared corpus figures are cited from
> [`shared-facts.json`](../shared-facts.json) (4,829 `src/**/*.{ts,tsx}` files),
> not re-derived.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

**This path is the frontend manifestation of a library principle.** The
concurrency doctrine already states it — *"Stale async results must lose: carry
identity, commit only if still current"* — and that row has manifestations
beneath it. This document is the client-runtime one. It does not restate the
principle; it says which primitive carries the identity in this stack, where the
repo breaks it, and what would catch that.

**Adjacent leaves — cross-reference, do not absorb.**
[`polling-loop.md`](./polling-loop.md) owns **cadence**; this path owns the
**correctness of the result** a tick produces. A poll needs a guard from here;
`usePolling` does not supply one, and that is stated as Gap #6 there and Gap #4
here — same hole, two sides.
`client-runtime/data-fetching/shared-fetch-cache` owns request dedupe and the
module-scope warm cache. Its dedupe collapses *identical* concurrent reads; it
does nothing for two reads with *different* entity ids, which is this situation.
`client-runtime/data-fetching/paginated-list-query` owns `useLayeredList`, whose
`epochRef` (`:105`) is this guard applied to pagination.
`client-runtime/data-fetching/snapshot-plus-stream` owns reconciling a snapshot
against a live stream — a related ordering problem with a different fix.
`backend/concurrency/compare-and-swap-status-write` is the server-side sibling:
the same "only if still current" question, answered in SQL.

## Trigger

- "I clicked persona A, then B, and B's panel is showing A's data"
- "The spinner cleared but the request is still running" / "the wrong row's spinner stopped"
- "Switching the filter fast leaves the old filter's rows" / "the count doesn't match the list"
- "Search results flicker back to a previous query"
- "StrictMode double-mount makes this fetch land twice and the older one wins"
- "This resolved after the modal closed and reopened the panel"

If you are about to type any of these, you are in this situation:
`let cancelled = false`, `let active = true`, `let alive = true`,
`new AbortController()`, `const seq = ++seqRef.current`,
`if (id !== currentIdRef.current) return`, or *any* `await` followed by a
`set…()` whose value describes one particular entity.

## The one way

Decide first whether the result belongs to an **entity** or merely to a
**mount** — a persona, run, incident, credential, filter set or search string is
an entity; "this component is still on screen" is a mount. For a mount-only
concern inside a `useEffect`, `let cancelled = false` + `return () => { cancelled = true }`
is correct and you are done. For an **entity**, carry the identity: mint a token
from `createLatestWins()` (module scope in a store slice, `useRef(createLatestWins()).current`
in a hook) immediately before firing, and re-check `isCurrent(token)` after
**every** await and before **every** write — including the ones in `catch` and
`finally`, because a `finally` that clears a shared `busyId` or `isLoading`
unconditionally is the same bug wearing a smaller blast radius. Where the
identity is specifically the selected persona, `capturePersonaToken(id)` is that
mechanism with the store lookup already written. Do **not** substitute
`let cancelled` for a token: it is a mount guard that doubles as an identity
guard only by accident — when the effect's dep array happens to contain the id,
React runs cleanup before re-running the effect and the flag flips in time; the
moment the fetch is fired from a click handler, a store action or a `setTimeout`
there is no cleanup to flip and the flag is simply unavailable. Do **not** reach
for `AbortController` either: `invokeWithTimeout` accepts no `signal` and Tauri
`invoke` has no cancellation at all (`tauriInvoke.ts:115-128` says so in the
error type), so across this app's transport an `AbortController` is a boolean in
a platform primitive's costume — it costs an allocation and buys nothing a token
doesn't, and it misleads the next reader into believing the backend stopped. And
prefer, above all of it, to make the write **keyed rather than guarded**: store
the response under its own entity's key and derive the view from the current id,
so a late response lands in its own slot and is *harmless* instead of *dropped*.
`executionSlice.ts:703-728` already does exactly this and is the one site to
copy; a token is then only needed for the ephemeral view fields (`isLoading`,
the header), not for the data.

## Mandated primitives

- **`src/stores/util/latestWins.ts` — `createLatestWins()`** → `{ next(): number, isCurrent(token): boolean }`. 13 lines, module-scope closure counter. `next()` mints and increments (`:35-37`); `isCurrent(t)` is `t === seq` (`:39-41`). Its docstring (`:1-29`) already records why it exists: "several slices independently reimplement the same shape". Use module scope for a store slice (one counter per action, per `overviewSlice.ts:153`/`:159`) and `useRef(createLatestWins()).current` for a hook (`useBulkRerun.ts:141`, `usePassportData.ts:108`).
- **`src/lib/personas/personaToken.ts` — `capturePersonaToken(personaId)`** → `PersonaToken { personaId, isStillCurrent() }`. The entity-identity variant: `isStillCurrent()` (`:36-39`) compares the captured id against `useAgentStore.getState().selectedPersona?.id` live, so it is correct even when the persona changed through a path that never re-ran your effect. Its docstring (`:15-32`) records that "three real instances of this bug existed in the editor surface before this util was extracted". Reach for this — not a counter — whenever the identity *is* the selected persona: a counter answers "is this the newest request", a persona token answers "is this the right persona", and after a switch-away-and-back those two differ.
- **`src/stores/slices/agents/executionSlice.ts:698-728` — the keyed-write shape.** Not a module you import; a shape you copy. Every response writes `executionsCache[personaId]` unconditionally; only `executions` + `executionsPersonaId` (the *view*) are gated on `isLatest`. `:331` then derives visibility from `state.executionsPersonaId === personaId`. This is the closest the repo has to making the bug unrepresentable — see *Prefer a type over a gate* below.
- **`src/hooks/utility/data/useLayeredList.ts`** — `useLayeredList({ filterKey, fetchPage, fetchCounts })`. Owns an `epochRef` (`:105`) that guards the L0-counts and L1-page arms independently (`:113-127`). If your surface is a filtered, paginated list, adopt this and inherit the guard; do not hand-roll a third one. 2 adopters (`useManualReviewQueue.ts:40`, `useTaskQueue.ts:104`), 1 test file.
- **`@/lib/tauriInvoke`'s `invokeWithTimeout`** — the transport, and the reason the token exists. Read-only commands (`list_`/`get_`/`fetch_` prefixes, `:161-166`) are auto-deduped for 250 ms by `${cmd}:${stableStringify(args)}` (`:145-158`), which **does** collapse the StrictMode-double-mount race for identical args. It does **not** touch the entity-switch race: different args are different keys, so two real calls go out and the slower one still wins. `invokeWithTimeout` has **no `signal` parameter** (verified: zero occurrences of `signal` in the file outside one doc comment), and `InvokeTimeoutError.backendMayStillBeRunning` (`:115-128`) is a written commitment that IPC cannot be cancelled.
- **`src/features/shared/components/forms/useAsyncFieldValidation.ts`** — the one place `AbortController` is genuinely correct, because `check(value, signal)` may be a real HTTP call. If your validator only calls `invokeWithTimeout`, prefer `useFieldValidation.ts`'s `seqRef` shape (`:63-79`) — see Deviations, "two hooks, one folder, two mechanisms".
- **`src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx:60-74` — the busy-state shape.** Not a module; a shape. Per-row busy state is a `Set<string>`, and `clearSaving(templateId)` (`:68-74`) removes **its own** id — `if (!prev.has(templateId)) return prev;` — so a slow action on row A cannot clear row B's spinner. Use a `Set` (or a keyed record), never a scalar `busyId`. 24 sites in the repo use the scalar; this one and `AutomationsSection.tsx:59`'s `transitioningIds` are the only two that don't.

**Explicitly not a primitive for this:** `AbortController` for anything that
ends in `invokeWithTimeout`, and `usePolling` (it has no guard of any kind —
Gap #4).

## Steps

1. **Name the entity.** Write down the identity the result belongs to: `personaId`, `executionId`, `incidentId`, `requestKey`, the trimmed search string. If you cannot name one, you have a mount concern, not this situation — use `let cancelled` in the effect and stop here.
2. **Ask whether the write can be keyed instead of guarded.** Can the response go into `Record<EntityId, T>` with the view derived from the current id? If yes, do that — it removes the failure mode rather than policing it, and it also gives you a warm cache on switch-back for free. `executionSlice.ts:698-728` is the reference. Only the ephemeral view fields then need step 4.
3. **Decide token vs persona token.** Newest-request-wins → `createLatestWins()`. Right-persona-wins → `capturePersonaToken()`. If the surface can be navigated away from and back to the *same* entity, you want the persona/entity token: a counter will (correctly) reject a response the user is now waiting for again, and you will ship a panel that never fills.
4. **Mint before firing, in the same statement block as the state reset.** `const token = latestWins.next();` immediately before the call — not after a preceding `await`, or you have already lost the race you are trying to guard.
5. **Re-check after every await.** Not just the last one. `useChainTrace.ts:64-77` awaits three times; a guard checked only at the end leaves two windows open. Every `await` is a suspension point at which the entity can change.
6. **Guard the failure and the teardown too.** `if (!latestWins.isCurrent(token)) return;` at the top of your `catch`, and around anything in `finally` that writes shared state — `setIsLoading(false)`, `setBusyId(null)`, `inflight = null`. `executionSlice.ts:732-738` is the correct shape: error, loading flag and dedup slot are all gated.
7. **Stop.** No `let cancelled` beside the token, no `AbortController`, no second ref. One mechanism per surface. `useConnectorReadiness.ts:109-115` runs a `seq` **and** a `cancelled` flag in the same six lines; that is not belt-and-braces, it is two half-understood mechanisms nobody can safely delete.
8. **Write the regression test.** The five that exist (see Evidence) are all the same shape and take ~20 lines: fire A, fire B, resolve A last, assert the state is B's. This is the only class of bug in the repo where a test is this cheap and this decisive, and it is the reason those five sites will not regress.

## Anti-patterns

- **`let cancelled = false` for an entity-scoped fetch outside a `useEffect`.** A click handler, a store action and a `setTimeout` callback have no cleanup function, so the flag has no writer. This is the single most common shape of the bug and it is invisible to review because it *looks* like the 246 correct uses.
- **`let cancelled = false` in an effect whose dep array omits the id the fetch reads.** The flag then only fires on unmount. The id usually arrives via `getState()`, a ref, or a memoised callback that was excluded from deps by an `exhaustive-deps` disable — which is exactly what makes it survive review.
- **`AbortController` around a Tauri call.** It cannot abort anything: `invokeWithTimeout` takes no signal and Tauri `invoke` has no cancellation. `useEventLog.ts:129-172` is the clearest case — the controller is constructed, stored in a ref, `abort()`ed on the next search, and then used purely as `if (controller.signal.aborted) return`. It is `let cancelled` with a class allocation and a false promise that the backend stopped. (The backend *has not* stopped, and for a mutating command that matters: see `InvokeTimeoutError.backendMayStillBeRunning`.)
- **A scalar `busyId` cleared unconditionally in `finally`.** `try { await action(); } finally { setBusyId(null); }` — call A for row 1 resolves after the user started call B for row 2, and row 2's spinner disappears and its buttons re-enable while its work is still running. **24 of 24** scalar busy-id sites in the repo do this (Deviations). The fix is a `Set` that removes its own id (`CredentialEventConfig.tsx:68-74`), and `AutomationsSection.tsx` proves it is not a knowledge gap: line 59 does it correctly with `transitioningIds` and line 52 does it wrong with `testingId`, seven lines apart.
- **One counter shared by two different actions.** `overviewSlice.ts` uses `fetchGlobalSeq` in both `runDashboardWave1` (`:215`) and `fetchGlobalExecutions` (`:358`). It is correct *here* only because wave 1 deliberately scopes the check to the row-list half of its patch (`:246-248`) and commits the dashboard half regardless — a subtlety documented in a four-line comment. Copy the comment or don't copy the pattern.
- **A counter where an identity is meant.** A monotonic counter answers "newest request wins". If the user can switch away from entity A and back to A while A's first fetch is in flight, the counter rejects a response that is now correct again and the panel stays empty. Use `capturePersonaToken` / compare the id.
- **Two mechanisms on one surface.** `useConnectorReadiness.ts:109-115` (seq + cancelled). Whichever you delete, the reviewer cannot tell whether the other one covered the case.
- **Guarding the success path only.** A `catch` that writes an error banner without re-checking currency paints entity A's failure onto entity B's panel — worse than stale data, because the user acts on it.
- **Reinventing the counter.** 36 files do (Deviations). `createLatestWins()` is 13 lines and already imported by 8 modules; the reinvention is not a judgement call, it is not knowing the file exists.

## Evidence

**Adoption:** the two sanctioned primitives have **10 consumer files** between them
(`createLatestWins` 8, `capturePersonaToken` 2). Against that: **36 files**
hand-roll the identical counter/compare, ~5 more write a bare identity check by
hand (`pipeline/teamSlice.ts`, `system/ambientContextSlice.ts`,
`agents/testSlice.ts`, `useToolRunner.ts`, `executionSlice.ts`), and **73 sites
have no guard at all**. **Adoption ratio among sites that guard: 10 / 51 ≈ 20%;
among sites that need to: 10 / 124 ≈ 8%.** (The 215 closure-flag files are
excluded from both ratios — see *Not a deviation*, they are mount guards doing
their own correct job.)

- **`src/stores/slices/agents/executionSlice.ts:698-738` — copy this one.** The keyed write (`executionsCache[personaId]` always; `executions` + `executionsPersonaId` only when `isLatest`), the bounded per-persona eviction that never evicts the entity being fetched (`:713-718`), the guarded error write (`:732`), the guarded `finally` that owns both the loading flag and the dedup slot (`:734-738`), and a selector at `:331` that derives visibility from `executionsPersonaId === personaId`. It is the whole doctrine in forty lines, and it is the only site where the stale write is *harmless* rather than *dropped*.
- `src/stores/util/latestWins.ts:1-43` — the primitive, and the best-written docstring of the three. Read `:9-11` for why the comparison direction lives in one place.
- `src/lib/personas/personaToken.ts:15-39` — the entity-identity variant. Its example (`:26-31`) is the only place in the repo that shows the *compensating action* — `void cancelArena(runId)` when the token is stale — rather than a bare `return`. If your superseded request started backend work, this is the shape.
- `src/features/agents/sub_editor/libs/useEditorSave.ts:125-146` — `capturePersonaToken` checked twice across a two-await save, with the `!personaId` re-check folded in.
- `src/stores/slices/overview/overviewSlice.ts:152-159` — the best comment in the corpus: it explains why the *counts* need their own counter separate from the *rows*, and names the exact symptom ("overwrite the badges with the previous persona's totals").
- `src/features/overview/sub_observability/libs/useAnomalyDrilldown.ts:26-69` — a hand-rolled `seqRef` that is nonetheless the most complete guard in the repo: success, error **and** `finally` all gated (`:52`,`:55`,`:58`), and `closeDrilldown` (`:63-70`) bumps the counter so an in-flight fetch cannot write into a closed panel. Its comment (`:26-32`) records the production bug verbatim — click A then B, A resolves last, "the user sees B's metadata paired with A's correlated events / root-cause, leading to wrong root-cause conclusions during incident triage". Migrate it to `createLatestWins`; keep every line of that comment.
- `src/features/agents/sub_tool_runner/libs/useToolRunner.ts:28-35` — the only synchronous render-body identity ref in the repo, and the comment explains why an effect would be wrong: "a tool result resolving in the microtask queue between commit and effect-flush would otherwise see a one-render-stale ref". If you ever need a ref-based identity guard, this is the reason it must be assigned in the render body, not in a `useEffect`.
- `src/features/agents/sub_tool_runner/libs/useToolRunner.ts:50-59` — derived id-equality: each entry stores its own `personaId` and `getState` returns `EMPTY_STATE` on mismatch. The author labels it "defense-in-depth"; it is actually the keyed-write idea in embryo.
- `src/features/agents/sub_executions/libs/useBulkRerun.ts:134-150` — the clearest statement of *why a boolean is not enough*: `cancelledRef` stops the worker loop from picking up new items but cannot abort in-flight promises from a prior batch, so a token is threaded through `updateItem(token, …)` and checked at the single write point.
- `src/features/agents/sub_deployment/hooks/useCloudHealthMonitor.ts:26-42` — the generation-counter variant, correct for its shape: five separate re-arm sites share one `generationRef`, `isStale(gen)` (`:40-42`) folds unmount and supersession into one predicate, and the counter is bumped on every effect teardown (`:136`). Ten `isStale` checks across three async functions — this is what "check after every await" looks like at scale.
- `src/hooks/utility/data/useLayeredList.ts:100-127` — the epoch guard applied per-arm, so a failing counts fetch cannot cancel a good page fetch.
- `src/features/vault/sub_credentials/components/features/CredentialEventConfig.tsx:60-74` — **the only correct busy-state implementation in the repo.** `savingIds` is a `Set`, and `clearSaving(templateId)` removes its own id (`:68-74`) with an early `if (!prev.has(templateId)) return prev;`. 24 other sites use a scalar and clear it unconditionally. Its sibling `AutomationsSection.tsx` has both shapes seven lines apart — `transitioningIds` as a `Set` at `:59`, `testingId` as a scalar at `:52` — which is the clearest single proof that this is a missing-primitive problem, not a missing-knowledge one.
- `src/stores/slices/pipeline/teamSlice.ts` — **eight** `if (get().selectedTeamId !== teamId) return;` checks (`:119`,`:124`,`:199`,`:262`,`:325`,`:328`,`:339`,`:342`), two per action, one after each await. An **identity** check rather than a counter, written without any primitive, and the most thorough guarding in any slice. This is what `capturePersonaToken` generalises, and the shape a `captureEntityToken` (Gap #1) should produce.
- **The five regression tests** — `src/stores/slices/system/__tests__/twinSlice.fetchTwinTones.test.ts`, `src/stores/slices/agents/__tests__/labSlice.fetchRuns.test.ts`, `src/features/agents/sub_executions/libs/__tests__/useBulkRerun.test.ts`, `src/features/teams/sub_factory/passport/__tests__/usePassportData.test.tsx`, `src/features/plugins/companion/__tests__/useCompanionAssignmentBridge.test.tsx` (7 cases total). Each names the production bug it locks down in its file header. Copy the shape: fire A, fire B, resolve A **last**, assert B survived.

## Deviations found

**73 unguarded sites verified by reading, plus 36 files that re-derive the
primitive.** Summary, worst first:

| Class | Count | Fixable by |
|---|---|---|
| Entity-keyed store actions writing flat state, no token | **40** in 15 slices | `createLatestWins()`, or the keyed-write shape |
| Scalar busy-id cleared unconditionally in `finally` | **24 of 24** | one line, or a `Set` |
| Async click/selection handlers, no guard possible without a token | **8** | `createLatestWins()` / `capturePersonaToken()` |
| Files re-deriving the counter/compare inline | **36 files / 42 sites** | import the primitive |
| `AbortController` across a non-abortable transport | **9 of 14** | delete it, use a token |
| Closure flag guarding unmount where an entity is meant | **1** confirmed of ~30 sampled | move the id into deps |

### P0 — the root cause: two primitives exist, 36 files re-derive one of them

`createLatestWins()` is 13 lines and its own docstring says slices were
independently reimplementing it. That has not stopped: **36 files / 42 sites**
capture a pre-incremented counter inline. Verified by census (precision 32/33 on
the files read individually; the one false positive, `AriaLiveProvider.tsx:48`,
is excluded by name in the rule).

| Family | Sites |
|---|---|
| `useRef(0)` + `const seq = ++xRef.current` in a hook | 31 files |
| module-scoped `let seq = 0` + `const seq = ++seq` in a store slice | `overviewSlice.ts:215,358,410` · `personaSlice.ts:185,210` · `executionSlice.ts:698` · `flashSpotlight.ts:71` |

Full list (`path:line`): `BundleImportDialog.tsx:144,178,205` ·
`overviewSlice.ts:215,358,410` · `useCronPreview.ts:90,306` ·
`personaSlice.ts:185,210` · `PersonaConfigPanel.tsx:306` ·
`useTemplateIntentMatch.ts:34` · `useCloudHealthMonitor.ts:136` ·
`useRecipeStarters.ts:29` · `useHealthCheck.ts:376` · `UseCaseHistory.tsx:40` ·
`flashSpotlight.ts:71` · `useTourNarration.ts:96` · `useHealthChecks.ts:57` ·
`useIncidentsData.ts:45` · `MemoriesPageDense.tsx:98` ·
`AthenaSpendSection.tsx:38` · `useAnomalyDrilldown.ts:36` ·
`useAthenaHealth.ts:24` · `useRenderPlan.ts:34` · `useLocalDictation.ts:257` ·
`useDrive.ts:414` · `useRecipeTestRunner.ts:41` · `useFieldValidation.ts:63` ·
`useTeamSlackBridge.ts:79` · `useConnectorReadiness.ts:109` ·
`useFileUpload.ts:73` · `useSharedEvents.ts:31` · `useDbQueryRunner.ts:40` ·
`useBuildSession.ts:328` · `useAiSearch.ts:41` · `useTauriStream.ts:140` ·
`useOAuthPolling.ts:113` · `useGalleryQuery.ts:160` · `useLayeredList.ts:105` ·
`useTerminalClassification.ts:58` · `executionSlice.ts:698`.

**Why this is P0 and not cosmetic:** each of the 36 got the comparison direction
right *this time*. The primitive exists so that only one file has to. Two of the
36 already diverge in behaviour — `useOAuthPolling.ts` folds abort into the same
counter, `useCloudHealthMonitor.ts` folds unmount into it — so a future reader
cannot assume the shape is uniform, which is precisely the property a shared
primitive is supposed to guarantee.

### P0 — 40 entity-keyed store actions write flat state with no token

**In 15 slices.** Each takes an id (or a filter set) that varies from a
dropdown, a row click or a tab, awaits, then `set({ …flat fields })`
unconditionally. Two calls with different ids race and the slower one wins the
whole panel.

The sharpest evidence that this is a *reach* problem, not a *knowledge* problem:
**two slices already import `createLatestWins` and apply it to exactly one
action each while nine sibling actions in the same file stay unguarded.**

| Slice | Guarded | Unguarded siblings |
|---|---|---|
| `stores/slices/system/twinSlice.ts` | `fetchTwinTones` (`:428`,`:434`,`:437`) | `:509` `fetchTwinPendingMemories` (twinId, status) · `:523` `fetchTwinReadinessApproved` (feeds the readiness *score*) · `:556` `fetchTwinCommunications` (twinId, channel, limit — channel toggles race each other too) · `:584` `fetchTwinVoiceProfile` (a later `upsertTwinVoiceProfile` then saves against the wrong twin's displayed profile) · `:618` `fetchTwinChannels` |
| `stores/slices/agents/labSlice.ts` | `fetchRuns` (`:164`,`:167`,`:170`) | `:546` `fetchVersions` (the version table `activateVersion` acts on) · `:590` `fetchHealthRate` · `:601` `fetchVersionRatings` · `:611` `fetchVersionEconomics` (cost figures attributed to the wrong persona) |

`twinSlice.ts:517-519` is the tell: its comment explains that
`fetchTwinReadinessApproved` writes **only** `twinReadinessApproved` so sibling
panels cannot clobber the score's corpus — the keyed-write instinct, applied at
field granularity, by an author who did not reach for the token sitting 90 lines
above.

**Dev-tools slices** (`projectId` / `goalId` / `kpiId` all from dropdowns):
`devToolsProjectSlice.ts:319` `fetchGoalSignals` · `:331` `fetchGoalDependencies`
(the dependency editor writes against it) · `:433` `fetchKpiMeasurements` (chart
shows another KPI's series) · `:394` `fetchKpiTrends` (replaces the whole map, so
a stale id-set wins wholesale) · `:205` `fetchGoals` · `:370` `fetchKpis` ·
`:149` `fetchStandards` · `devToolsScannerSlice.ts:129` `fetchIdeas`
(**filter** changes race, not just project switches) · `:112` `fetchScans` ·
`devToolsTriageSlice.ts:160` `fetchTriageIdeas` — **stores `lastTriageQuery` at
`:153` and never compares it after the await; the field exists, the check
doesn't** · `devToolsTaskSlice.ts:116` `fetchTasks` ·
`devToolsContextSlice.ts:108` `fetchContexts` · `:51` `fetchContextGroups`.

**GitLab slice** (every read is per-`projectId`, several per sub-entity):
`gitlabSlice.ts:430` `gitlabSelectPipeline` (pipeline A's jobs under B's header)
· `:457` `gitlabFetchJobLog` (job A's log under job B) · `:483`
`gitlabFetchPersonaVersions` (rollback then targets the wrong persona's version
list) · `:323` `gitlabFetchAgents` · `:400` `gitlabFetchPipelines` · `:605`
`gitlabFetchDeploymentHistory`.

**Remaining per-persona / per-credential:** `chatSlice.ts:164`
`fetchChatMessages` — sets `chatMessages` **and** `activeChatSessionId`
unconditionally, so session A's transcript lands while B is active and
`sendChatMessage` appends into it · `chatSlice.ts:151` `fetchChatSessions` (its
"activeGone" branch can null out a *valid* session belonging to the newer
persona) · `healingSlice.ts:86` `fetchRetryChain` · `:96`
`fetchHealingTimeline` · `testSlice.ts:64` `fetchTestRuns` and `:137`
`fetchTestSuites` — while `fetchTestResults` (`:104`) in the **same file** does
guard, on `activeTestResultsRunId` · `automationSlice.ts:40` `fetchAutomations` ·
`:143` `fetchZapierZaps` · `databaseSlice.ts:60` `fetchDbSchemaTables` (then
`createDbSchemaTable` appends into another credential's list) · `:104`
`fetchDbSavedQueries` · `overviewSlice.ts:555` `fetchObservabilityMetrics` — 150
lines below the guarded `fetchGlobalExecutions` in the same file ·
`toolSlice.ts:120` `fetchToolUsage` (three fields from one `Promise.all`).

**Already correct, for contrast** — do not "fix" these: `personaSlice.ts:215`
(`fetchDetailSeq`) · `executionSlice.ts:703` (`isLatest` + keyed cache) ·
`pipeline/teamSlice.ts` ×8 (`get().selectedTeamId !== teamId` — an identity
check, not a counter) · `system/ambientContextSlice.ts:91`,`:140`,`:166`
(module-scoped `latest*PersonaId`) · `testSlice.ts:104` · `overviewSlice.ts:368`,
`:413`. And the actions that write into a **keyed map** are self-guarding by
construction and need nothing: `assignmentSlice`, `rotationSlice`,
`automationSlice.fetchAutomationRuns`, `networkSlice.fetchPeerManifest`,
`channelSlice`, `messageSlice.fetchDeliverySummaries`,
`labSlice.fetchResults`/`fetchUserRatings`. **That list is the argument for the
keyed-write fix**: the slices that already store by key are the slices with no
race to guard.

### P0 — 8 handlers where a boolean flag is structurally impossible

A click/selection handler has no cleanup function, so `let cancelled` cannot be
written there at all. These need a token; today they have nothing.

| Path | Varies | Defect |
|---|---|---|
| `vault/shared/hooks/useUndoDelete.ts:23-31` | `credential.id` | `requestDelete` awaits `listCredentialEvents(credential.id)` then `setDeleteConfirm({ credential, … })`. Two quick delete clicks rebuild the confirm dialog with the **first** credential; `confirmDelete` (`:35-44`) deletes that one. **Destructive, and the highest-severity site in this document.** |
| `teams/sub_kpis/KPIConnectWizard.tsx:131` | `cred.credential_id` | `picked` is set synchronously, `setResult(r)` after the await. Pick A then B → `picked=B`, `result=A`; `activate()` (`:145`) activates B's credential with A's composed procedure and value. |
| `plugins/fleet/sub_skills/useSkillData.ts:150` | skill name + file | `loadFile` sets `fileContent`+`editContent` unconditionally; B is selected showing A's SKILL.md, and `editContent` is what a save writes back. |
| `plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:139` | note `path` | `selectedPath` set first, `setNoteContent` after the await → B's title over A's body. |
| `agents/sub_executions/components/list/ExecutionList.tsx:180` | `executionId` | `handleAutoCompareRetry` awaits `getRetryChain` then sets `compareLeft`/`compareRight`/`compareMode` with no ownership check. |
| `teams/sub_deliberations/useTeamDeliberations.ts:88` | deliberation id | `refreshDetail` awaits a 4-way `Promise.all` then sets four fields. Driven from an effect at `:107` (`[selectedId]`) **with no cleanup at all**, and also called imperatively after every advance/split/merge. |
| `plugins/twin/sub_brain/useBrainConnection.ts:103` | `kbId` | `handleBind(id)` writes `lastLoadedKbId.current = id` *after* the await, so a slower first bind overwrites both the panel and the cache marker. |
| `plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx:82` | `competition.id` | `loadDetail` → `setDetail(await …)`; an 8s poll (`:92`) races the expand-triggered fetch, so a slow poll response replaces fresher detail. |

### P0 — 24 of 24 scalar busy-id clears are unconditional

The "clear a shared `busyId` only if it still belongs to YOUR call" rule is
violated **everywhere it applies — zero sites check ownership.** Slow action on
row A resolves after the user started row B; row B's spinner clears and its
buttons re-enable mid-flight.

`agents/sub_deployment/components/UnifiedDeploymentDashboard.tsx:150` ·
`agents/sub_deployment/components/cloud/DeploymentCard.tsx:49` (the identical
two-line helper, copy-pasted) ·
`agents/sub_connectors/components/automation/AutomationsSection.tsx:52` ·
`vault/shared/vector/tabs/DocumentsTab.tsx:59` ·
`triggers/sub_triggers/PendingTriggerApprovals.tsx:45` ·
`triggers/sub_triggers/WebhookRequestInspector.tsx:204` (the *result* at `:199`
carries its own id — only the spinner is wrong) ·
`overview/sub_patterns/PracticeRolloutModal.tsx:87`,`:100` ·
`overview/sub_patterns/ExtractionMenu.tsx:186`,`:200` ·
`overview/sub_manual-review/components/dispatch/DispatchPanel.tsx:141` ·
`overview/sub_manual-review/components/backlog/useBacklogQueue.ts:109` ·
`plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:109` ·
`plugins/dev-tools/sub_context/ContextMapHealth.tsx:95`,`:106`,`:120` (`:120`
runs after `applyRepair` awaits `runAudit()`, which itself clears busy at `:95`) ·
`plugins/dev-tools/sub_runner/RunDeskControls.tsx:84` ·
`plugins/twin/sub_training/TrainingStudio.tsx:147` (row *content* at `:143` is
correctly keyed; the spinner id is not) ·
`shared/components/surface/SurfaceRenderer.tsx:102` ·
`home/sub_cockpit/widgets/DecisionDrawer.tsx:48` ·
`templates/sub_n8n/steps/N8nSessionList.tsx:147`,`:237` (this file holds a
`Map<string, AbortController>` at `:106` for its loads and still clears the id
unconditionally) ·
`settings/sub_notifications/components/WebhookSubscriptionsPanel.tsx:172` (the
result map at `:159` *is* keyed — the spinner id is not) ·
`teams/sub_teamWorkspace/teamStudio/boardShared.tsx:200` ·
`teams/sub_kpis/KpiSimSuggestions.tsx:125`,`:137` ·
`teams/sub_factory/passport/improve/useImproveActions.ts:86`,`:114` ·
`teams/sub_factory/passport/improve/StandardsScan.tsx:102` ·
`scraper/useScraperData.ts:114`.

Same idiom, grep-identified and not individually read (blast radius one card in
the last two): `ExtractionMenu.tsx:236`,`:294`,`:314` ·
`ConsolidationReview.tsx:427`,`:451` · `ProactiveCard.tsx:75` ·
`ApprovalCard.tsx:41`,`:56`.

**The fix is one line each** — `setBusyId((cur) => (cur === id ? null : cur))` —
or, better, migrate the scalar to the `Set` shape at
`CredentialEventConfig.tsx:60-74`. Note that three of these files already write
their *results* into a keyed map while leaving the *spinner* scalar
(`WebhookSubscriptionsPanel`, `TrainingStudio`, `WebhookRequestInspector`): the
author solved the harder half and left the visible half broken, which is what a
missing shared primitive looks like.

### P1 — the one confirmed mount-only flag on an entity-scoped fetch

`overview/sub_incidents/components/IncidentsInbox.tsx:154-181` — effect deps are
`[]`, and `openById(incidentId)` (`:157`) is invoked from a
`storeBus.on('incidents:open-detail')` subscription with an arbitrary id and
from `consumePendingIncidentDeepLink()`. `cancelled` flips only on **unmount**,
so two deep-links in quick succession both call `getAuditIncident` and whichever
resolves last wins `setDetailIncident` (`:165`) — the modal can show incident A
after the user was routed to B. This is the "flag guards unmount, not entity
switch" anti-pattern, and it is the **only** confirmed instance in ~30 sites
sampled with their dep arrays mechanically extracted and compared against every
identifier passed as a call argument. The closure-flag corpus is disciplined;
the danger is the flag's *absence* in handlers and slices, not its misuse in
effects.

### P1 — `AbortController` used as a boolean across a non-abortable transport (9 of 14)

`invokeWithTimeout` accepts no `signal`; Tauri `invoke` has no cancellation.
These sites therefore pay for a class and communicate a cancellation that never
happens:

| Path | What it actually does |
|---|---|
| `overview/sub_events/libs/useEventLog.ts:129-172` | Controller in a ref, `abort()` on the next search, then `if (controller.signal.aborted) return` at three points. Pure boolean; `searchEvents` is IPC. |
| `overview/sub_observability/libs/useAnnotationData.ts:28,65` | Two controllers in two effects; signal is only ever read as `.aborted`. |
| `agents/sub_health/useHealthDigestScheduler.ts:39-67` | Four `abort.signal.aborted` checks; no consumer of the signal. |
| `templates/sub_n8n/steps/N8nSessionList.tsx:106,158` | `Map<string, AbortController>` so delete can "cancel" an in-flight load (`:131`). It cannot; the load runs to completion. |
| `vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts:114-165` | Passes `ctrl.signal` down (`:142`) — trace it and it terminates at an IPC call. |
| `hooks/build/useBuildSession.ts:329-369` | Passes `abortController.signal` (`:360`) into a helper that races it against the promise (`:105-113`) — the await stops, the backend does not. |
| `hooks/design/oauth/useOAuthPolling.ts:109` | Belt-and-braces with the generation counter at `:113`; the counter is what works. |
| `hooks/agents/usePrefetchOnHover.ts:25-28` | `prefetchPersona(personaId, controller.signal)` — the store action receives a signal it cannot honour. |

**Legitimately correct (4, do not "consolidate"):**
`plugins/research-lab/sub_literature/arxivClient.ts:71` and `crossrefClient.ts:81`
(real `fetch` to real HTTP, timeout controllers), their two callers
`ArxivSearchModal.tsx:53` / `AddSourceForm.tsx:53`, and
`shared/components/forms/useAsyncFieldValidation.ts:112` (the `check` callback
may be HTTP; it also correctly swallows `AbortError` at `:129`).

### P1 — two hooks, one folder, two mechanisms, same job

`src/features/shared/components/forms/useFieldValidation.ts` (seq counter,
`:41,:63-79`) and `src/features/shared/components/forms/useAsyncFieldValidation.ts`
(AbortController, `:73,:112-133`) are debounced async field validators sitting in
the same directory with different guards, different state vocabularies
(`validationState: 'idle'|'validating'|'valid'|'error'` vs
`status: 'idle'|'checking'|'available'|'taken'`) and no cross-reference. A
developer adding a validated field picks by autocomplete order.

### P1 — the primitives are untested; only their consumers are

`src/stores/util/latestWins.ts` and `src/lib/personas/personaToken.ts` have
**zero** test files. The comparison direction, the module-scope-vs-ref lifetime,
and `isStillCurrent()`'s live store read are unverified. Five *consumer*
regression tests exist (7 cases) and they are the only thing standing between
this doctrine and silent regression — which means the guarantee is per-site, not
per-primitive, at 5 of 46 sites.

### P2 — belt-and-braces sites (two mechanisms, one surface)

`templates/sub_generated/shared/useConnectorReadiness.ts:109-115` (seq **and**
`cancelled`, six lines apart) · `hooks/design/oauth/useOAuthPolling.ts:109,113`
(AbortController **and** generation) · `hooks/build/useBuildSession.ts:328,329,523`
(generation **and** AbortController **and** a `cancelled` flag in a third effect).
Each is defensible individually and indefensible as a corpus: nobody can delete
the redundant one safely.

### P2 — `usePolling` supplies no guard, so every polled surface needs its own

`src/hooks/utility/timing/usePolling.ts` returns `{ isPolling, lastRefreshed }`
and holds `fetchFn` in a ref; it has no notion of a request identity. Every one
of its 11 call sites that polls entity-scoped data must therefore add a guard by
hand, and the two that poll *filtered* data (`GlobalExecutionList.tsx:231` →
`fetchGlobalExecutions(reset, status, personaId)`) are covered only because the
*slice* happens to carry `fetchGlobalSeq`. Cross-referenced as
[polling-loop.md](./polling-loop.md) Gap #6 (the missing `stopWhen`/identity
surface); recorded here because the correctness half is this leaf's.

### Not a deviation — 245 of the 246 closure flags are correct

Do **not** bulk-migrate `let cancelled = false`. Read in full with their dep
arrays: `useTraceData.ts:65-106` (`[executionId, personaId, refreshKey]`) ·
`useChainTrace.ts:56-99` (`[executionId, personaId, skip]`) ·
`useQuickStats.ts:65-84` (`[personaId, reloadTick]`) ·
`ReviewDetailPanel.tsx:42-50` (`[review.id, isCloud]`) ·
`IncidentDetailModal.tsx:90-109` (`[personaId, incident.id]`) ·
`useEffectiveConfig.ts:20` (`[personaId, refreshKey]`) ·
`ToolPerformancePanel.tsx:56` (`[since, personaId, limit]`) ·
`useConversation.ts:48` (`[teamId, …]`) · `IncidentDiagnosisCard.tsx:28`
(`[incidentId]`) · `MessageDetailModal.tsx:223`
(`[message.execution_id, message.persona_id]`) · `ScenarioDetailPanel.tsx:135`
(`[resultId, resultKind]`) · `useRemoteJobs.ts:62` (`[selectedId, …]`) ·
`useContextRuntime.ts:130`,`:158` · `UnifiedBuildEntry.tsx:291`
(`[draftPersonaId]`) · `useBuildSession.ts:523` (plus a `generationRef` epoch
check) · `usePersonaExecution.ts:283` (stable callback, id read from the event
payload). Every one has the entity id in its dep array and a cleanup that flips
the flag, so React's cleanup-before-re-run ordering makes the flag a correct
identity guard.

The pattern is wrong in exactly the two positions named under Anti-patterns
(outside an effect — 8 sites, and no flag is even writable there; id missing from
deps — 1 site, `IncidentsInbox.tsx:155`). **A gate that flagged all 215 files
would be exactly the "keys on the markup, not the condition" failure the**
[contract](../golden-path-contract.md#section-9-is-manifestation-layer-not-principle-layer)
**warns about** — 214 false positives for 1 true one — which is why the census
rule below does not.

## Gaps in the primitive

1. **`createLatestWins()` cannot express identity, only recency.** It answers "is this the newest request", never "is this the right entity". A user who switches away from A and back to A while A's fetch is in flight gets a correctly-rejected response for a panel that is now waiting for it, and the surface stays empty until something re-triggers. `capturePersonaToken` solves this for exactly one entity type (persona). There is no generic `captureEntityToken(kind, id, selector)`, which is the single most-requested missing shape across the 36 hand-rolls.
2. **Nothing composes recency with a keyed write — and this is the upstream cause of the whole Deviations section.** The second sweep pass makes it plain: **every slice action that already writes into a keyed map has no race to guard** (`assignmentSlice`, `rotationSlice`, `automationSlice.fetchAutomationRuns`, `networkSlice.fetchPeerManifest`, `channelSlice`, `messageSlice.fetchDeliverySummaries`, `labSlice.fetchResults`/`fetchUserRatings`), and **all 40 unguarded actions write flat fields**. The bug is not carelessness about tokens; it is the default store shape. The strongest counter-example (`executionSlice.ts:703-728`) is 40 lines of hand-written store surgery — a keyed cache, an eviction policy, a view-field gate and a selector — reproduced nowhere else. There is no `createKeyedLatest<K, V>()` giving a slice `commit(key, value)` + `viewFor(key)`, and until there is, "write it flat" will keep being the path of least resistance.
3. **The transport cannot cancel, and nothing in the type system says so.** `invokeWithTimeout` silently accepts no signal; a developer reaching for `AbortController` gets no compiler feedback that it will do nothing. 9 of 14 sites made that mistake. A `signal?: never` in `InvokeOpts`, or an `InvokeOpts.currency?: () => boolean` that gates the resolve, would turn a runtime no-op into a compile error or a working feature.
4. **`usePolling` has no identity surface at all.** See Deviations P2 and [polling-loop.md](./polling-loop.md) Gap #6. Adding `guard?: () => boolean` — checked between the fetch resolving and the caller's continuation — would close it in three lines and cover 11 call sites.
5. **No compensating-action affordance.** `personaToken.ts:26-31` shows the right thing (cancel the backend work the superseded request started) and *nothing in the repo does it*. Every one of the 51 guarded sites drops the result and leaves the backend running to completion. For read commands this is only waste; for the 5 sites that start work (`useBulkRerun`, `ModelABCompare`'s arena, `useBuildSession`, `useToolRunner`, `useRecipeTestRunner`) it is orphaned execution and, per `InvokeTimeoutError.backendMayStillBeRunning`, unbounded cost. A token that carries an `onSuperseded` callback would make the correct thing the easy thing.
6. **Both primitives are untested (Deviations P1).** `createLatestWins` in particular has an inverted-comparison failure mode that is silent: `token !== seq` instead of `token === seq` would drop every response and look like "the backend is slow".
7. **`latestWins.ts` lives in `src/stores/util/`.** Half its natural consumers are hooks and components, which must import across a store boundary to use it. Nine of the 36 hand-rolls are in `src/hooks/**`, where an import from `@/stores/util/*` reads as a layering violation. It belongs in `src/lib/async/` beside `createCachedFetch` / `deduplicateFetch` / `staleWhileRevalidate`.
8. **No documentation surface.** `latestWins.ts` and `personaToken.ts` appear in no `docs/` page, no `.claude/Design.md` entry, no `CATALOG.md` row (components only), and `conventions.json` says nothing about async commit ordering — grep for `stale`, `race`, `supersede`, `abort` returns one unrelated hit. None of the 21 custom ESLint rules touches it. **A developer following every documented rule in this repo writes `let cancelled = false` in a click handler and passes review.** This is the cheapest gap to close and probably the largest single cause of the 20% adoption rate.

## Prefer a type over a gate — the answer for this leaf

**Yes, and the repo has already built it once without recognising it as the answer.**

The proposed shape in the brief — `invokeFor(entityId)` returning a value the
setter only accepts while that id is still selected — is real but is the *weakest*
of the three type-shaped fixes available, because the unwrap point is still a
discipline. Ranked by how much they remove:

1. **Key the write (available today, no new primitive).** Store `Record<EntityId, T>`
   and derive the view from the current id. A response for A physically cannot
   address B's slot, because it does not hold B's key. The stale write becomes
   *harmless* instead of *dropped*, and switch-back paints warm.
   `executionSlice.ts:698-728` + `:331` is the working implementation. This is the
   fix; everything else is scaffolding around not having done it.
2. **`useEntityQuery(entityId, fetcher)` returning `{ data: T | null }` where
   `data` is `null` unless the stored `forId === entityId`.** The *return type* is
   the guard, so there is no commit point to get wrong. This is `useLayeredList`'s
   epoch idea generalised from "filter key" to "entity id", and it would absorb
   most of the 36 hand-rolls without any call site writing a comparison.
3. **`invokeFor(entityId, cmd, args): Promise<Scoped<T>>`** with
   `Scoped<T> = { readonly entityId: string; readonly value: T }` and a single
   `unwrapIfCurrent(scoped, currentId): T | null`. Weaker than 1 and 2 — it still
   trusts the caller to pass the right `currentId` — but it makes today's exact
   bug, `setState(await invoke(...))`, a **type error**, which is worth a great
   deal for a mechanical migration.

**The convergence evidence says this is physics, not house taste.** In
`personas-web` (Next.js + SWR), **1 of 31** client fetches gets stale-response
immunity for free, and it is precisely the one whose SWR key carries the entity
id — `dashboard-queries.ts:26`, `["dashboard","agent-detail", personaId]`, with a
factory (`dashboardKeys`) so the key cannot be built wrong. The other six
`useSWR` keys are constant strings and get dedupe, not race safety; the remaining
~24 fetches hand-roll **14 `let cancelled` flags** (11 of which have no
entity-ish dep and are therefore unmount-only) and **2 module-scoped sequence
counters** (`executionStore.ts:13`, `reviewStore.ts:17`) that are line-for-line
our `fetchGlobalSeq`. It also has an unguarded entity-keyed poll
(`useExecutionPolling.ts:44-53`) that appends execution A's stdout into execution
B's terminal. In `brainiac` (no SWR, no React Query, no data layer at all),
**100%** is hand-rolled: 9 `let cancelled` flags, 1 `AbortController`, zero
sequence counters, zero tests over any of them, and two unguarded
`.then(setState)` sites.

So the sibling repos independently reinvented our closure flag *and* our sequence
counter with no shared document — which by the contract's own portability oracle
makes the prescription doctrine rather than local calibration. **And the one
place either sibling gets it for free is the one place the key carries the
entity id.** That is the finding: our seven mechanisms are not a discipline
failure, they are the predictable consequence of writing entity data to an
unkeyed slot.

One more transfer, from the other direction: `brainiac`'s **server** does make
the constraint unrepresentable, one layer down, in SQL —
`UPDATE promotions SET … WHERE id = $1 AND reviewed_at IS NULL`
(`crates/brainiac-server/src/console.rs:225-242`), so a superseded reviewer
updates 0 rows and receives a 409 instead of winning. Its own comment: *"never a
last-writer-wins reviewer."* That is the same doctrine as this path, enforced by
a precondition in the write rather than by a check before it — and it is the
model for `backend/concurrency/compare-and-swap-status-write`.

Until (1) or (2) lands, the census rule below is the ratchet that holds the line.

## The missing gate

**Nothing gates this today.** 21 custom ESLint rules, none about async commit
ordering. `conventions.json` is silent. `npm run check` is green with all 46
guarded sites, all 24 unconditional busy-id clears and all 9 misapplied
`AbortController`s in the tree. Every deviation above shipped under a green
check.

### The signal, and the condition it is a proxy for

**Condition:** *a surface owns its own supersession bookkeeping instead of
delegating it to the shared primitive.*

**Proxy in this stack:** the mint half of a hand-rolled latest-wins guard —
`const <name> = ++<counter>;` where `<counter>` is either a module-scoped `let`
or a `ref.current`. Capturing a **pre**-incremented counter into a local is the
signature move and has almost no other use: postfix id-allocators
(`const id = nextIdRef.current++`, `ModalStackContext.tsx:37`,
`AppKeyboardProvider.tsx:49`) and bare accumulators (`errorCountRef.current++`,
`dragCounterRef.current += 1`) do not match. **Measured precision: 32/33 files**
on the subset read individually — one false positive, `AriaLiveProvider.tsx:48`,
excluded by name.

**This proxy is manifestation-layer and does not travel.** An adopting repo
inherits the trigger, the one way, the anti-patterns and the *intent* — "count
the places that re-derive the primitive, ratchet it down" — and writes its own
signal. In `personas-web` the same condition wears different markup and the
proxy would be `let \w+FetchSeq = 0` at module scope in `src/stores/**` (2 files)
plus `useAbortableEffect`'s 1-of-16 adoption; the `++ref.current` pattern there
matches **nothing**, exactly as the portability test predicted.

### What it deliberately does NOT catch, stated plainly

The census can ratchet **reinvention**; it cannot see **absence**. A click
handler that awaits an entity-scoped fetch and commits with no guard at all —
the highest-severity shape in this document — produces zero matches. Deciding
whether a given `setState` after an `await` is entity-scoped requires knowing
which state fields describe which entity, which is a semantic property no regex
and no single-file AST rule can decide. An AST rule keyed on "an `async`
function containing an `await` followed by a state setter, with no currency
identifier in scope" was designed and rejected: `setLoading(false)` after an
await appears in hundreds of legitimate places and the precision would be
unusable. **Recording it as unenforceable is the finding**, per the
[contract](../golden-path-contract.md#why-a-gate-is-required-at-all) — the
alternative is a check that pretends to verify it.

Two things carry that half instead:
- **The type fix.** Once entity data is written keyed (`Prefer a type over a
  gate`, option 1 or 2), the absence case stops being a bug — which is the
  strongest argument for doing it rather than writing a smarter linter.
- **A review obligation, written down here so it exists at all.** A new `await`
  followed by a write of entity-scoped state, in a handler or store action, gets
  a human read — the same treatment `CLAUDE.md` gives crypto/vault/IPC changes.

### How it fails loudly if its own precondition is absent

Inherited from [`scripts/census/`](../../../scripts/census/) and **verified by
deliberate break on this rule**, not assumed:

| Break | Result |
|---|---|
| add one new `const seq = ++seqRef.current;` under `src/` | `FAIL … files rose 36 -> 37 (+1), matches rose 42 -> 43 (+1)`, **exit 1** |
| remove it again | `OK  hand-rolled-stale-token 36 36 42 42 4829 4000`, **exit 0** |
| repoint the `exclude` at a path that no longer exists | `[structural] exclude "…/DoesNotExist.tsx" matched no file. The exemption is stale`, **exit 1** |
| raise `floor` above the real corpus (4000 → 6000) | `[structural] walked 4829 files but floor is 6000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN`, **exit 1** |

A silent **drop** is also fatal without a baseline update, and a rule matching
zero files anywhere is fatal — so a renamed convention or a broken glob reads as
a failure, never as a clean tree. Surviving counts print on success
(`census OK — 1 rule(s), 4829 file-visits, 42 surviving violation(s) across 36 file(s)`),
so a build log distinguishes a clean run from one that checked nothing.

### The rule

Do **not** paste this into `scripts/census/rules.json` from this document by
hand-merging concurrently — hand it to the orchestrator. Measured against
`master` @ `cf14b9832`; `floor: 4000` matches the `raw-web-storage` rule's floor
over the same 4,829-file corpus.

```json
{
  "id": "hand-rolled-stale-token",
  "goldenPath": "docs/concepts/golden-paths/stale-response-guard.md",
  "title": "Hand-rolled latest-wins counter instead of createLatestWins()",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bconst\\s+[A-Za-z_$][\\w$]*\\s*=\\s*\\+\\+\\s*[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*current)?\\s*;",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "capture-a-pre-incremented-counter (`const seq = ++xRef.current` / `const seq = ++moduleSeq`) — the mint half of a hand-rolled latest-wins guard. src/stores/util/latestWins.ts already owns this; every match is a re-implementation of it."
  },
  "exclude": [
    {
      "path": "src/features/shared/components/feedback/AriaLiveProvider.tsx",
      "reason": "false positive: ++keyRef.current allocates a React key to re-announce a live-region message, it never guards an async commit"
    }
  ],
  "baseline": { "files": 36, "matches": 42 },
  "floor": 4000
}
```

**Allowlist policy.** Only the one false positive is excluded. The shared
primitives that currently match — `useLayeredList.ts:105`,
`useOAuthPolling.ts:113` — are deliberately **left in the count**: they are
legitimate migration targets for `createLatestWins()`, and exempting a primitive
because it is a primitive is how a ratchet stops measuring anything. Every
downward move of this baseline should have a migration commit behind it; ratchet
with `npm run census -- --update` only after the fix lands.
