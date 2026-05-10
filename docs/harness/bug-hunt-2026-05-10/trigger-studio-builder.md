# Bug Hunt — Trigger Studio & Builder

> Group: Triggers & Events
> Files scanned: 13
> Total: 1C / 6H / 5M / 1L = 13 findings

---

## 1. Studio import does not regenerate node IDs — duplicate IDs corrupt React Flow state

- **Severity**: critical
- **Category**: validation-gap
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:367`
- **Scenario**: User clicks Export, then later clicks Import on a canvas that still has nodes (e.g. if Clear was not pressed first, or if the same JSON is imported twice). `setNodes(importedNodes)` replaces the canvas, so nodes are unique within that import — but if the file was hand-edited or originally exported from another canvas which shared IDs (e.g. `trigger-1731415920000-abcd`), and the user then imports a *second* file or appends, React Flow ends up with duplicate `node.id` keys. React's reconciler also throws the `Encountered two children with the same key` warning even on a single import if the JSON file itself contains duplicates (it is user-editable). Edges may also reference IDs that no longer exist if a partial import happens.
- **Root cause**: `chain.nodes.map((n, i) => ({ id: n.id, ... }))` trusts the imported `n.id` blindly — no uniqueness check, no remap of `edge.source`/`edge.target` to fresh IDs, and no validation that referenced edge endpoints exist among nodes.
- **Impact**: User who exports → edits → imports gets a silently-broken canvas: ghost edges, duplicate-key warnings, drag-drop selecting two nodes at once.
- **Fix sketch**: Build an `oldId → newId` map using `nextId(prefix)` for every imported node, remap edge `source`/`target` through the map, and drop edges whose endpoints don't resolve. Validate `chain.nodes` and `chain.edges` are arrays before mapping.

## 2. `JSON.parse` on imported chain has no shape validation — malformed file silently becomes empty canvas (or crashes mid-render)

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:357-388`
- **Scenario**: User imports a JSON file that parses but has `nodes: null`, missing `data`, or missing `type`. `chain.nodes.map(...)` throws TypeError — the catch logs but `setNodes`/`setEdges` are never called, so the canvas appears unchanged. Worse: if `n.type` is undefined, React Flow rejects the node silently. If `n.data` is `undefined`, the node renderer crashes when accessing `.label`/`.personaId`.
- **Root cause**: No schema validation between `JSON.parse` and `setNodes`.
- **Impact**: Importing any non-trigger-chain JSON appears to do nothing; only console shows error. Power users who edit by hand get crash on next render.
- **Fix sketch**: Validate `chain.nodes` is an array, every entry has string `id` + valid `type` ∈ {trigger/persona/condition}, `data` is an object. Surface the error as a toast.

## 3. Layout autosave persists invalidated layouts after `STUDIO_LAYOUT_VERSION` bumps — no migration path

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:68-76`
- **Scenario**: Developer bumps `STUDIO_LAYOUT_VERSION` from 1 to 2. `loadStudioLayout` returns `null` for old layouts → user opens Studio → sees empty canvas → adds *one* node → autosave fires after 800 ms → old version-1 data gets overwritten. The user's previous v1 layout is destroyed permanently, with no warning. There is no migration step that reads v1 and rewrites in v2.
- **Root cause**: Silent version skip + immediate re-save.
- **Impact**: Future schema migrations destroy customers' visual chains on first open.
- **Fix sketch**: When a stale-version layout is detected, copy raw to `STUDIO_LAYOUT_KEY + '_v1_backup'` before discarding, and either prompt user or run a migration function.

## 4. Auto-save fires on every node drag tick — last drag's debounce can lose state if component unmounts

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:172-176`
- **Scenario**: User drags a node and immediately switches to a different sidebar tab (Brain, Personas, etc.) within 800 ms. The `useEffect` cleanup is never registered for `saveTimerRef.current` — there's no `return () => clearTimeout(saveTimerRef.current)`, so the timer fires after unmount, calling `saveStudioLayout(nodes, edges)` with stale captured values. More importantly, work done between the last save and unmount is lost (the most recent drag never persists).
- **Root cause**: Missing cleanup in the autosave `useEffect`. The timer ref is never cleared on unmount, and there's no flush-on-unmount.
- **Impact**: User reports "I dragged nodes around and switched tabs and my changes were lost." Intermittent — only when the unmount happens during the 800 ms window.
- **Fix sketch**: Add `return () => { if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveStudioLayout(nodes, edges); } };` to the autosave effect.

## 5. `onConnect` reads stale `nodes` snapshot in `useCallback` closure → wrong condition-branch label

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:290-316`
- **Scenario**: User edits a condition gate's branch label (changing branch ids/labels via some future edit), then immediately drags a connection from that gate to a persona. Because `onConnect` depends on `[nodes, setEdges, dispatch]`, it captures `nodes` at render time. If `setNodes` updated the gate's data and the user connects before the next render commits, `data.branches.find(...)` finds the *old* branch label.
- **Root cause**: `onConnect` callback resolves branch label from a captured `nodes` array rather than the latest from `reactFlowInstance.getNode()`.
- **Impact**: Edge label shows obsolete branch text; the conditionBranch identifier may not exist in current data, breaking any downstream evaluator.
- **Fix sketch**: Use `reactFlowInstance.getNode(c.source)` inside `onConnect` (or a ref to nodes), not the closed-over `nodes` array.

## 6. `isValidConnection` allows infinite cycles — A → B → A enables runaway chain firing

- **Severity**: high
- **Category**: validation-gap
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:270-288`
- **Scenario**: Drag from PersonaStep A to PersonaStep B (allowed). Then drag from B back to A (also allowed: persona → persona). The chain forms a cycle. When this is exported and the backend executes it as a trigger chain, persona A fires B, B fires A, ...
- **Root cause**: `isValidConnection` checks only node-type pair compatibility, not graph cycles or self-loops (`source === target`).
- **Impact**: Authoring a self-firing loop is one drag away. Even if the runtime catches it, the studio shouldn't allow it.
- **Fix sketch**: Reject `c.source === c.target`. Run a DFS from `target` looking for `source` over current edges; reject if reachable.

## 7. `handleAddTriggerSource` uses `template.icon.displayName` which is `undefined` for many lucide icons

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/triggers/sub_studio/TriggerStudioCanvas.tsx:229`
- **Scenario**: lucide-react icons in production builds may not preserve `displayName` after minification (Vite + terser drops it). `template.icon.displayName ?? 'Zap'` then collapses every trigger source's icon to `'Zap'`, regardless of `template.label`. The TriggerSourceNode renderer that resolves icons by name now shows wrong icons.
- **Root cause**: Relying on a non-stable React property as a stable identifier across builds.
- **Impact**: Production builds show all-Zap icons in saved/restored canvases. Dev works fine; prod silently regresses.
- **Fix sketch**: Add an explicit `iconName` field on each `TriggerBlockTemplate` (`'Clock'`, `'Globe'`, ...) and use that.

## 8. `recordTriggerComplete` decrements `queueDepth` even when the completed firing was not from the queue

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/pipeline/triggerSlice.ts:176-193`
- **Scenario**: A fires successfully (allowed → `concurrentCount: 1`, `queueDepth: 0`). Before completion, user toggles cooldown config and a second firing is rejected (throttled → `queueDepth: 1`). Meanwhile A completes. `recordTriggerComplete` blindly does `queueDepth = max(0, queueDepth - 1)`, dropping the *queued* firing's bookkeeping to 0 even though no run was dequeued.
- **Root cause**: The slice doesn't distinguish "completed an in-flight execution" from "drained one from the queue." Same code does both.
- **Impact**: Queue depth shown to user (and used in `getRateLimitSummary`) silently drifts negative-clamped, so the throttled badge can disappear while triggers are still queued.
- **Fix sketch**: Track which firings came from the queue (return an opaque token from `recordTriggerFiring`). On completion, only decrement `queueDepth` if the completing firing replaced a queued one.

## 9. `recordTriggerFiring` cooldown check leaks across config changes — old cooldown blocks new "no-cooldown" config

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/stores/slices/pipeline/triggerSlice.ts:153-156`
- **Scenario**: Trigger has 60 s cooldown; fires; `cooldownUntil = now + 60000`. User edits the trigger to `cooldown_seconds: 0`. Within the next minute, `recordTriggerFiring` checks `rl.cooldown_seconds > 0` — false, so cooldown ignored — *good*. But then if user re-enables cooldown to `30` within that same window, the stale `cooldownUntil` from the *first* firing (still > now) wrongly throttles the trigger.
- **Root cause**: `cooldownUntil` is stored across config changes; only updated on successful fires.
- **Impact**: Trigger appears mysteriously throttled after editing rate-limits.
- **Fix sketch**: Reset `cooldownUntil` to 0 when trigger config changes (subscribe to `trigger:changed` storeBus event in the slice).

## 10. CronConfig `maxBackfill` defaults to 1 in UI but stored as `undefined` — backend default may differ

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:248-252`
- **Scenario**: User opens the form (`maxBackfill ?? 1` shows "Off"). They never touch the dropdown. On submit, `maxBackfill` is `undefined` in the saved config. Backend default for `max_backfill` may be 0, 1, or unset — divergent from what the UI promised ("Off"). After downtime the user gets either 0 catch-up runs or, worse, hundreds (backend hard-cap is 100 per tick per the help text).
- **Root cause**: UI default is local-only; never written into the saved config object unless the user changes it.
- **Impact**: Schedule triggers behave differently from what UI shows post-restart.
- **Fix sketch**: When saving, if `maxBackfill === undefined`, write `max_backfill: 1` explicitly into the trigger config.

## 11. TriggerCountdown "firing" window relies on local clock — timezone DST shifts can show "FIRE" indefinitely

- **Severity**: medium
- **Category**: timezone
- **File**: `src/features/triggers/sub_triggers/TriggerCountdown.tsx:84-104`
- **Scenario**: A daily cron trigger's `next_trigger_at` was computed by the backend in UTC for tomorrow 09:00 in user's TZ. The user's machine clock shifts -1 hour at DST fall-back at 02:00. The frontend `Date.now()` is now suddenly 1 hour behind the static `next_trigger_at`; if the backend hasn't yet re-emitted the trigger's `next_trigger_at`, `remaining` stays positive but spawns/freezes weirdly. Conversely, on spring-forward, `remaining` jumps to 0 an hour early and the "firing" window (`remaining <= 0 && remaining > -2`) elapses in <2 ms, then `remaining <= 0` keeps the green FIRE label visible *indefinitely* until the backend updates `next_trigger_at`.
- **Root cause**: The `firing` window is a 2-second band but the fall-through `remaining <= 0` permanently shows FIRE.
- **Impact**: After DST, every cron trigger appears "FIRING" until next backend tick — confusing in the list view.
- **Fix sketch**: Cap how long the FIRE state can show (e.g. 60 s after `nextMs`), then fall back to "Pending" until the backend pushes a new `next_trigger_at`.

## 12. `TriggersPage` `useEffect` depends on `personas` array reference — refetches all triggers on every store update

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/triggers/TriggersPage.tsx:92-112` and `src/features/triggers/sub_triggers/TriggerList.tsx:35-71`
- **Scenario**: Every time anything in `agentStore` produces a new `personas` array reference (a different field's update may flow through), both the page and the list re-fetch all triggers via `Promise.all([listAllTriggers(), getTriggerHealthMap()])`. Multiple in-flight fetches race; the latest wins via `stale = true` but earlier ones still hit IPC.
- **Root cause**: Coarse-grained dep on entire personas array, not on its identities.
- **Impact**: Excess Tauri IPC traffic; battery on laptops; possible UI flicker if a slow earlier fetch races a fast later one (the `stale` guard helps but only if requests resolve in order — which they may not).
- **Fix sketch**: Memoize a stable signature like `personas.map(p => p.id).join(',')` or bus-based invalidation via `storeBus.on('trigger:changed', ...)` instead of fan-out from agent store.

## 13. SharedEventsTab unsubscribe race — subscribe + unsubscribe in quick succession can leave orphan rows

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/triggers/sub_shared/SharedEventsTab.tsx:59-75`
- **Scenario**: User clicks Subscribe on entry X (in flight). Before `subscribeFeed` resolves, user clicks Unsubscribe (which finds `sub` from `subscriptions.find(s => s.catalogEntryId === entry.id)` — but `subscriptions` doesn't yet contain the new sub). The unsubscribe is silently dropped (`if (sub) handleUnsubscribe(sub.id)` — `sub` is `undefined`). Then the original subscribe resolves and prepends to `subscriptions`. End state: subscribed (orphan), but UI shows the catalog card as "subscribed" — user must click Unsubscribe again. Also the original subscribe's `setSubscriptions(prev => [sub, ...prev])` may include duplicates if `load()` ran in between.
- **Root cause**: Optimistic UI without an in-flight tracking set; unsubscribe lookup uses local list snapshot.
- **Impact**: User has to re-click Unsubscribe; backend ends up with subscribed feed they thought they removed.
- **Fix sketch**: Track `pendingSubscribes: Set<entryId>` and `pendingUnsubscribes: Set<entryId>`. Disable Subscribe/Unsubscribe while pending. Use `entryId` (not `subId`) as the cancellation key.
