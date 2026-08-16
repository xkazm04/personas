# Golden path — Debounced autosave

> Situation node: `client-runtime/mutations-and-editing/debounced-autosave` ·
> [situation spine](../situation-spine.md) · recurrence **16** · risk high ·
> dimensions **function · resilience · ui · code-quality** · sides **client**.
> Composed 2026-08-16 from a ground-truth sweep against `master`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files walked, three times: once by a brace-matched scan
> that found **304** production `setTimeout` call sites and classified every one of them, once by a
> second implementation that resolved each file's persist doors from its own `@/api/*` imports rather
> than from a hand-written verb list, and once by the census engine. The two inventories **disagreed
> (13 vs 22)** and the disagreement was the finding — see [Corrections](#corrections-to-the-brief-that-composed-this-path).
> The union was hand-classified into
> **13 debounced durable-write sites** (11 hand-rolled, 2 primitives) and ~19 debounced *reads*, which
> belong to a different leaf.
>
> **Eleven scenarios were EXECUTED, not argued** — the real `useDebouncedSave` and
> `useDebouncedSaveGroup`, plus verbatim transcriptions of the four teardown shapes found in `src/`,
> mounted and unmounted through `@testing-library/react` under fake timers in a composer-private
> vitest config (nothing written into the repo). Every number in §7 marked *executed* came out of that
> harness. **No `cargo` was run.**
>
> **A convergence sweep** ran read-only against all five siblings — `personas-web`, `brainiac`,
> `personas-cloud`, `vibeman`, `ascent`. All five exist and all five were swept. It produced the
> single strongest result in this document, and it is a **negative**: across **12 live debounced write
> sites in six repos, the number that survive a window close is ZERO** (§6). It also inverted one
> clause of this path's first draft and confirmed another as physics.
>
> The **Deviations** section is a fix backlog and contains **one live, shipped, total-data-loss path**
> and **one debounce that does not debounce**, neither previously known.

## Scope — what this path owns, and the seam with `entity-draft-editing`

[entity-draft-editing](./entity-draft-editing.md) owns **what the draft is**: two copies, the
identity-guarded reseed, derived dirty, and which keys go on the wire. Its conclusions are
load-bearing inputs here and were re-verified rather than cited from memory. Its §4 step 9 ends with
*"do not add a debounce, a retry, or an autosave until the diff is correct — an autosave over a
full-object payload multiplies the blast radius by its frequency."* **This document is what comes
after that sentence.**

**This path owns the timer.** When the write happens, what cancels it, what flushes it, and what is
true of the pending write at the moment its owner dies. The sibling asks *what is in the payload*;
this one asks *whether the payload ever leaves*.

The seam is sharp and the measurement proves it: **not one defect in §7 is a payload defect.** Every
one of them is a correctly-built write that was scheduled and then discarded, or scheduled twice and
landed inverted.

**Not this path:** whether a *read* is debounced (search-as-you-type, filter refetch) — 19 sites, a
different leaf. Whether an explicit Save button shows a spinner — [inline-busy-state](./inline-busy-state.md),
though see §8 gap 8, which is a hole in that path this one found. Whether a surface ghosts while
loading — [`docs/design/overview-loading.md`](../../design/overview-loading.md), though see §5's last
anti-pattern for how the two prescriptions compose badly. Whether a stale *response* overwrites a
newer one — [stale-response-guard](./stale-response-guard.md); this path owns stale *requests*.

## 1 Trigger

- "It should just save as I type — no Save button"
- "I lost the last thing I typed when I clicked away"
- "How long should the debounce be?"
- "Do I need to save on unmount?" / "what happens if they close the window mid-debounce?"
- "It says Saved but the database has the old value"
- "Two saves fired and the older one won"

If you are about to type `setTimeout(` inside a `useEffect` whose callback writes anything that
outlives the component — an IPC call, `setAppSetting`, `localStorage.setItem`, a file write — or the
words *autosave*, *debounce*, *flush*, or *pending write* — you are in this situation. The single
strongest tell: **you are about to write `return () => clearTimeout(t)`.**

## 2 The one way

**Do not own the timer.** A pending write must not live in the component that scheduled it, because
the component's death is exactly the event that must not discard it. Reach for `hooks/utility/timing/useDebouncedSave`
— it is the only implementation in the repo (or in any of the five siblings) that flushes on unmount,
and it does so from a **separate mount-once effect** (`:82-92`), which is load-bearing: React cannot
tell you whether a cleanup is running because a dependency changed or because the component died, so
a flush written into the timer effect's own cleanup fires on **every keystroke** and silently deletes
the debounce (executed: 5 writes for 5 keystrokes in a 100 ms burst, §7 P1-1). Pass a `save` that
reads its data from a **ref**, never from a closure, so the flush persists the last keystroke rather
than the one that started the timer. Wrap that save in `useDebouncedSaveGroup` if two saves can
overlap — the primitive has **no in-flight lock**, and a slow write followed by a fast one lands in
the wrong order with the older value winning (executed: `["v2","v1"]`, §7 P1-3). Wire the surface's
dirty flag into `useUnsavedGuard` and make its `onSave` **`cancel()` then save explicitly** —
`cancel` is all the primitive exposes; there is no `flush()`, so every consumer composes one
(`EditorBody.tsx:86-89`). Never show a success state that the write has not earned: derive the
indicator from `isSaving || isDirty || saved`, in that order, and make sure "there are edits not yet
written" is a **representable** state — one live surface's status union has no such member, so it
renders a green check over unsaved data forever (§7 P0-1). And then stop: the timer belongs to the
scheduler, the data belongs to the ref, and the only thing the component decides is *when it changed*.

**Where the surface is a module-scoped singleton rather than a hook** — a canvas layout store, an
appearance mirror, a persisted zustand store — put the timer at module scope too (`layoutStore.ts:267-273`
is the shape). That removes unmount from the problem entirely, and it is the better answer whenever
the state itself outlives the view. **It also makes `pagehide` the only teardown that exists for
that writer**, which is the next paragraph and is not optional.

**Register every pending write with one window-close drain.** This is the clause the whole document
is built on, and it is the one nobody in six repos has shipped: there is exactly one implementation
of a `pagehide`/`beforeunload` flush in the entire fleet (`src/lib/throttledStorage.ts:42-43`) and it
has **zero importers**. Until a shared drain exists (§8 gap 2, §9), a debounced writer must register
its own listener — and a golden path that told you to skip that step would be prescribing the exact
hole all six repos are standing in.

> **House convention, not doctrine, and labelled as such.** The convergence sweep found **zero**
> flush-on-unmount and **zero** flush-on-close in any sibling: `personas-web` 0, `brainiac` 0
> (0 debounced writes at all), `personas-cloud` 0 client-side, `vibeman` 0, `ascent` 0. Personas is
> ahead of all five and still fails its own bar at 11 of 13 sites. An adopting repo should treat
> §2's flush clauses as the thing to build, not the thing to check.

## 3 Mandated primitives

All of these exist today. None needs to be built. Their consumer counts are the whole story and are
printed beside them.

| Primitive | What it gives you | Real consumers |
|---|---|---|
| `hooks/utility/timing/useDebouncedSave` (`:19`) | trailing debounce + `isSaving`/`lastError` + `cancel` + **flush on unmount from a separate mount-once effect (`:82-92`)**. The only one of its kind in six repos | **1** (`useTabSection.ts:63`), reaching **2** surfaces |
| `features/agents/sub_editor/libs/useTabSection` (`:58`) | the `'debounced' \| 'immediate' \| 'explicit'` tri-mode wrapper + DirtyStore registration + unmount unregister | 2 (`useEditorSave.ts:203,213`) |
| `features/agents/sub_editor/libs/useDebouncedSaveGroup` (`:22`) | **the in-flight lock.** Awaits the running save, then re-saves iff the live draft diverged from the snapshot it persisted (`:36-45`). The only write-ordering guard in the repo | 2 (same file) |
| `hooks/utility/interaction/useUnsavedGuard` (`:39`) | sidebar-nav + window-close interception with Save/Discard/Stay. Its `beforeunload` (`:59-64`) **prompts, it does not save** | 2 (`EditorBody.tsx:85`, `ByomSettings.tsx:36`) |
| `features/agents/sub_editor/libs/EditorDocument` → `cancelAll` (`:187-190`) / `saveAllTabs` | the aggregator that makes cancel-then-save-explicitly one call | 1 surface |
| `features/agents/sub_editor/hooks/usePersonaSwitchGuard` (`:13`) | **flush on entity switch** — `cancelAllDebouncedSaves()` then `saveAllTabs()` (`:26-29`). The only entity-switch flush in the app | 1 |
| `lib/throttledStorage` → `createThrottledLocalStorage` (`:61`) | trailing debounce per key, **read-through pending map** so `getItem` never returns a stale value you just wrote (`:81-89`), and **a synchronous drain on `pagehide` and `beforeunload` (`:25-44`)** | **0.** Not one importer in `src/` or `scripts/`, not even a test |
| `lib/throttledStorage` → `flushThrottledStorage` (`:124`) | the manual drain, for tests and for an explicit flush point | **0** |
| `hooks/utility/timing/useDebounce` (`:8`) | debounce a *value*. For reads. Do not build a save on it | 6 |

## 4 Steps

1. **Decide whose timer it is.** If the edited state dies with the view, the timer is a hook
   (`useDebouncedSave`). If the state is a module singleton or a persisted store, the timer is a
   module-scoped scheduler (`layoutStore.ts:267-273`). Getting this wrong is what produces the
   cancel-only bug — a component-scoped timer guarding state that outlives it.
2. **Hold the data in a ref, and pass a save that reads the ref.** `useDebouncedSaveGroup` does this
   for you (`draftRef`). The flush runs after the last render; a closure captured at schedule time
   persists the *previous* keystroke.
3. **Never write your flush into the timer effect's cleanup.** Use a second `useEffect(() => () =>
   flush(), [])`. React runs the dep-cleanup on every dep change, so a flush there is a write per
   keystroke and the debounce is gone. This is not a style point — it is measured, §7 P1-1.
4. **Serialize.** Wrap in `useDebouncedSaveGroup` when a second save can start before the first
   lands. Note its **undocumented precondition**: it snapshots `draftRef.current` by *reference*
   (`:47-48`), so a draft mutated in place makes `draftChanged` compare the live object with itself
   and the early return at `:44` swallows the second save entirely (executed, §8 gap 4). Replace the
   draft object; never mutate it.
5. **Register the window-close drain.** One `pagehide` + `beforeunload` listener that drains every
   pending write synchronously. `throttledStorage.ts:25-44` is written and works; wire it, or
   register your own until the shared one exists.
6. **Flush on entity switch, not just unmount.** Switching the edited entity inside a mounted surface
   is a teardown that React does not report. `usePersonaSwitchGuard:26-29` is the shape;
   `FactoryShell.tsx:72-86` is what happens without it (§7 P0-2).
7. **Make the indicator's states exhaustive.** `isSaving` → busy; `isDirty` → *unsaved*; else →
   saved. `SettingsStatusBar.tsx:26-41` is the reference tri-state. A union of
   `'idle' | 'saving' | 'saved' | 'error'` cannot express "you have edits that are not yet written",
   so it renders success over unsaved data by construction.
8. **On failure keep the draft, keep the dirty flag, surface the error.** The repo already gets this
   right everywhere — 232 save-shaped catches, 0 discard the draft ([entity-draft-editing](./entity-draft-editing.md)
   §7). Do not be the first. Note that a failure inside the *unmount* flush cannot toast (the
   component is gone) and reaches only the global `unhandledrejection` handler at `main.tsx:120-141`.
9. **And then stop.** No retry ladder, no interval, no "save every N seconds". A trailing debounce
   plus a flush at every teardown is the whole mechanism.

## 5 Anti-patterns

- **`return () => clearTimeout(t)` as the entire cleanup of a persist timer.** *Failure:* the pending
  write is discarded and nothing anywhere records that it existed. Executed: 800 ms debounce, 100 ms
  of typing, unmount → **0 writes**, and advancing timers 5 s further changes nothing. This is the
  default shape React tutorials teach and it is **6 of the 9 component-scoped write sites here** and
  **11 of 13 across six repos**.
- **Putting the flush in the timer effect's cleanup instead of a mount-once effect.** *Failure:* the
  debounce silently stops debouncing. Executed: 5 keystrokes 20 ms apart produced **5 writes** where a
  real 400 ms debounce produces 0. The site that does this carries the comment *"Debounced, and
  flushed on unmount"* — half true, and the wrong half is invisible.
- **`if (inFlight) return;` in the timer callback.** *Failure:* it looks like the in-flight lock and
  it is its opposite — it drops the write rather than queueing it. Executed against
  `useMediaStudioPersistence.ts:86` verbatim: the user's **last** edit is never persisted, because the
  rationale (*"the next edit will re-queue"*) has no next edit. `useDebouncedSaveGroup:37` is the
  queue-on-overlap form; these two read identically to a reviewer and behave oppositely.
- **A debounced write with no ordering guard.** *Failure:* a slow save followed by a fast one lands
  inverted and the **older** value is what persists. Executed: `["v2","v1"]`. `tauriInvoke`'s in-flight
  dedupe does not help — `:47` and `:491` state it only collapses *concurrent* calls, and its
  auto-dedup is gated to read-only command prefixes (`:160`), so a write never participates.
- **Treating "not saving" as "saved".** *Failure:* the flag flips to idle while a write is still in
  flight (executed: `isSaving=false` with one write outstanding), and any status union without a
  *pending* member shows a success chip over unsaved data. Compounding it,
  `useAppSetting.ts:76-77` sets `saved` then schedules `setTimeout(() => setSaved(false), 2000)` into
  a variable it never stores and never clears — two saves 300 ms apart (exactly what the
  `NotificationSettings` debounce produces on a toggle burst) leave the first timer to clear the
  second save's indicator.
- **Relying on `beforeunload` to save.** *Failure:* the one `beforeunload` handler that guards data
  (`useUnsavedGuard.ts:59-64`) sets `e.returnValue` and returns; it never calls `onSave`. And nothing
  on the Rust side asks the frontend to flush — the only `CloseRequested` handlers in `src-tauri` are
  for the OAuth popup (`commands/infrastructure/auth.rs:502,624`); the main window has none.
- **Rendering the busy state with `feedback/LoadingSpinner`.** *Failure:* it returns `null` unless you
  pass `label`. `SettingsStatusBar.tsx:28` passes `size` and `className` and no label, so the persona
  editor's "Saving…" state renders text with an invisible spinner and no `role="status"`.
- **Hoisting the surface's last *read* into a module-scoped cache while leaving the *write* timer in
  the component.** *Failure:* this is [`overview-loading.md`](../../design/overview-loading.md) law 4
  (a remount paints warm from a module cache — `sub_lifecycle/LifecyclePage.tsx:34-36`) composed with
  a cancel-only autosave, and the pair is worse than either alone: the remount repaints the user's
  edits **from the cache**, so a write that was discarded at unmount becomes invisible. Following
  both prescriptions without this paragraph produces a surface that has lost your data and shows it
  to you anyway. If you adopt law 4 on a surface that autosaves, the cache and the pending write must
  be torn down by the same event.

## 6 Evidence

**Copy this one:** `src/hooks/utility/timing/useDebouncedSave.ts`, read together with its two
consumers `features/agents/sub_editor/libs/useTabSection.ts` and `libs/useEditorSave.ts`. It is the
only surface in the repo that gets four of the five halves right — trailing debounce with values (not
array identity) in the dep list (`:73`, with the comment explaining why), flush on unmount from a
separate mount-once effect (`:82-92`), a save that reads a ref so the flush persists the newest state
(`useDebouncedSaveGroup:47`), and an in-flight lock with a divergence re-check (`:36-45`). The fifth
half — the window-close drain — it does not have, and neither does anything else.

Other sites worth reading, each for one thing:

| Site | What it gets right |
|---|---|
| `src/hooks/utility/timing/useDebouncedSave.ts:75-81` | the comment naming the exact incident the mount-once flush was written for ("picking a persona icon … silently lost") and why the guard path can't double-save |
| `src/features/agents/sub_editor/libs/useDebouncedSaveGroup.ts:28-35` | why the in-flight snapshot is stored **synchronously** rather than compared against `baselineRef` — the async setter left a window that swallowed keystrokes |
| `src/features/agents/sub_editor/hooks/usePersonaSwitchGuard.ts:23-46` | flush on **entity switch**: cancel, save-all, and only then commit the switch; failure keeps you on the entity |
| `src/features/agents/sub_settings/components/SettingsStatusBar.tsx:26-41` | the exhaustive tri-state — saving / **changed** / all saved |
| `src/lib/throttledStorage.ts:25-44,81-89` | the window-close drain **and** the read-through pending map. The best code in this leaf and it has zero callers |
| `src/features/teams/sub_mastermind/lib/layoutStore.ts:267-273` | module-scoped scheduling — the timer cannot die with a view because it never belonged to one |
| `src/features/teams/sub_mastermind/lib/scenePublish.ts:163-178` | content-idempotency before scheduling: an unchanged scene schedules nothing, so the steady state costs zero IPC |
| `src/features/plugins/artist/sub_media_studio/hooks/useRenderPlan.ts:31-45` | a monotonic sequence guard (`compileSeqRef`) — the ordering fix, correctly built, on a **read** |

### Convergence — what five sibling repos independently did

Read-only sweep of `personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent`. All five exist;
none was modified. Every load-bearing claim below was re-verified by hand in the sibling checkout.

**PHYSICS — nobody uses a debounce library. 6 of 6, independently.**
`lodash`, `lodash.debounce`, `use-debounce`, `debounce`, `throttle-debounce`, `react-use`,
`usehooks-ts`, `ahooks`: **zero declared dependencies in all six `package.json` trees**, including the
nested ones (`brainiac/console`, `personas-cloud/packages/*`). Six independent chances to reach for
the obvious library; six refusals. Every debounce in the fleet is a hand-rolled `useRef<Timeout>` +
`clearTimeout` pair. **So §2's prescription of the ref-pair shape is not local eccentricity — and a
path that prescribed `lodash.debounce().flush()` would fight all six repos at once.**

**PHYSICS — cancel-only is the default and flush is the exception. 11 vs 2 across the fleet.**
Both flushes are in this repo (`useDebouncedSave.ts:82-92`, `useDeckControls.tsx:140-147`, and the
second one is the broken kind). `personas-web/src/components/flow-composer/use-flow-composer.ts:53-66`
independently reinvented the identical cancel-only shape for a 500 ms debounced
`history.replaceState` — a different repo, a different stack, a different write target, the same
`return () => { if (ref.current) clearTimeout(ref.current); }`. `vibeman`'s server-side
`exportContextMap.ts:401-418` is cancel-only *by design* and says so.

**PHYSICS, and the strongest result here — the window-close drain does not exist anywhere.**
Across the fleet: `routeChangeStart` **0 hits**, `useBeforeUnload` **0 hits**, `sendBeacon` **0 hits**,
`pagehide` **1 hit**, in this repo's dead file. Six `beforeunload` handlers exist and every one of
them does something else — prompt (`useUnsavedGuard.ts:59`), flush analytics
(`lib/analytics/index.ts:149`), write a heartbeat (`sinceLeftBriefing.ts:137`), close SSE sockets
(`vibeman/src/components/cli/store/cliExecutionManager.ts:150`,
`vibeman/src/app/features/TaskRunner/lib/pollingManager.ts:85`). The ~15 `visibilitychange` handlers
across four repos are all poll/refetch/pause triggers; **not one flushes a write.**
**12 live debounced write sites, 0 that survive a close.**

**THE INVERSION — the only correct implementation in the fleet is in the repo with no users typing.**
`personas-cloud/packages/orchestrator/src/kafka.ts` is a headless Kafka outbox and it has the entire
mechanism this path prescribes: a linger timer (`:94`), a flush mutex that awaits the in-flight flush
**and then re-checks for messages that accumulated during the wait** (`:108-117`) — structurally the
same drain loop as `useDebouncedSaveGroup:36-45`, invented independently — a `draining` flag that
rejects new work (`:81`), a `drain()` that flushes on shutdown (`:102-105`), and a **call site that
actually invokes it** (`:275`). A backend queue got flush-on-teardown right because losing a message
is obviously a bug; six UIs did not, because losing a keystroke looks like the user not having typed
it. That asymmetry is this document's best argument for a shared scheduler over per-site care.

**PHYSICS — success flags are honest; decay timers are not.**
No repo sets a success state before the promise resolves — checked at every site. But five separate
`setTimeout(() => setStatus('idle'), N)` decay timers are stored in no variable and cleared on
nothing: `useAppSetting.ts:77` (2000 ms), `parameterEditing.tsx:73` (1500 ms),
`QueryEditorPane.tsx:61` (1500 ms), `vibeman/src/components/editor/MultiFileEditor.tsx:148` (1200 ms),
`ascent/src/components/org/executive/BrandingSettings.tsx:42` (4000 ms). A second save inside the
decay window has its indicator cleared by the previous save's timer, in five files, in three repos,
with no shared code between them.

**THE FINDING THAT REPLICATED — the right abstraction exists and is not used, in two repos, for the
same hook.** `vibeman/src/lib/performance/useDebouncedValue.ts:75` exports `useDebouncedCallback`,
re-exported from the barrel at `index.ts:12` with a usage `@example` in its docstring. Grepping
`vibeman/src` finds exactly two references: the definition and the barrel. **Zero consumers.** This
repo's `useDebouncedSave` has **1**, and `createThrottledLocalStorage` has **0** while four persisted
zustand stores use the *synchronous* `createDedupedJSONStorage` sibling instead
(`themeStore.ts:360`, `systemStore.ts:57`, `agentStore.ts:40`, `companionStore.ts:1379`).
`entity-draft-editing` §6 found this three times for draft machinery; this path found it twice more,
for timers, in two repos, and one of the two unused primitives is the **only** window-close drain in
the fleet. **Adoption, not invention, is the failure mode** — which is why §9's gate counts hand-rolls
rather than proposing a fourth primitive.

**SILENCES, reported as silences:**

- **No out-of-order protection on a write, anywhere except two places.** `useDebouncedSaveGroup:36-45`
  (2 consumers, and unexported outside `sub_editor/libs`) and `kafka.ts:108-117` (a backend). No repo
  has a request-sequence number on a save, a server-side compare-and-set for autosave, an
  `AbortController` on a write, or a save queue. The two sequence guards that do exist
  (`useRenderPlan.ts:31-45`, `ascent/src/components/QuotaMeter.tsx:24`) are both on **reads**.
- **`brainiac` has zero debounced writes at all.** Four debounced reads, all cancel-only, all
  correctly so. Its console edits standards through explicit save. That is a legitimate answer to
  this leaf and worth naming: *not autosaving* is a design position, not an omission.
- **`ascent` has no dirty-state concept at all** — one hit for `autosave|unsaved|isDirty` across
  `ascent/src`, and it is an unrelated comment (`src/lib/db/scans-persist.ts:70`). Its own bug-report
  corpus already documents the consequence, quoted in `entity-draft-editing` §6.
- **One idea to steal.** `personas-web/src/components/guide/SearchCombobox.tsx:99-107` clears the
  pending timer and runs immediately on Enter — a **flush on user intent**. It is the only correct use
  of the flush verb outside this repo, and it is the missing third teardown: unmount, window close,
  and *the user signalling they are done*.

## 7 Deviations found

### P0-1 — shipped, live, loses the user's last edits outright (Media Studio)

`useMediaStudioPersistence.ts:80-107` autosaves the composition 800 ms after the last edit. Three
independent defects stack on one effect:

1. **Cancel-only cleanup** (`:104-106`) — `return () => { if (autosaveTimer.current) window.clearTimeout(...) }`.
2. **Drop-on-overlap** (`:86`) — `if (autosaveInFlight.current) return;` with no reschedule.
3. **The composition state dies with the view.** `useMediaStudio.ts:60` is plain `useState`, and
   `MediaStudioPage` is a `lazy()` route (`ArtistPage.tsx:11`), so navigating away destroys it.

So the *edit* and the *pending write* are destroyed by the same event, and the mount-time restore
(`:118-142`) then repaints the **older** autosave. This is not lag; the data is gone.

**Executed, not argued** (verbatim transcription of `:80-107`, real React, fake timers):

```
in-flight guard at :86   composition v1 -> autosave starts (2s IPC for a large composition)
                         composition v2 (the user's LAST edit) -> timer fires at +800ms,
                         sees autosaveInFlight, RETURNS without rescheduling
   persisted after 30s : ["v1"]        <-- "v2" is never written, ever

cancel-only cleanup at :104   type for 100ms, navigate away (unmount)
   writes = 0                          <-- and advancing timers 5s further changes nothing
```

**And the UI reports success the whole time.** `PersistenceStatus` is
`'idle' | 'saving' | 'saved' | 'error'` (`:19`) — there is **no member meaning "there are edits not
yet written"**. `SaveStatusChip` (`MediaStudioToolbar.tsx:1020-1052`) therefore falls through to a
green `<Check/>` plus "saved N ago" for the *previous* write, both during the 800 ms window and
permanently after a dropped one. The status decays back to `'idle'` 2500 ms after a save
(`:111-115`), which removes the only signal that anything happened.

**Fix, in order:** (a) replace the effect with `useDebouncedSave(save, dirty, [composition], 800)` —
it brings the mount-once flush; (b) delete the `if (autosaveInFlight.current) return;` and wrap the
save in the queue-on-overlap form instead; (c) add `'dirty'` to `PersistenceStatus` and render it
between `saving` and `saved`; (d) register the composition writer with a `pagehide` drain.

### P0-2 — shipped, live, discards KPI calibration on tab switch and on nav-away

`FactoryShell.tsx:72-86` persists the open KPI's calibration and assessment edits to `dev_kpis` on a
600 ms debounce, with a cancel-only cleanup at `:85`. The effect's deps are `[kpiId, edits]`.

That dep list makes the loss sharper than unmount: **changing `kpiId` runs the cleanup for the
previous KPI**, so clicking from KPI A to KPI B within 600 ms of typing in A cancels A's write and
schedules B's. There is no `usePersonaSwitchGuard` equivalent on this surface, no `useUnsavedGuard`
(Factory is not one of its 2 consumers), and no dirty indicator — `saveKpiAssessment` is
fire-and-forget through `silentCatch` (`:83`), so a failure is invisible to the user as well.

**The same shape at lower severity, all cancel-only, all confirmed:**

| Path | Delay | What is discarded |
|---|---|---|
| `src/features/templates/sub_n8n/hooks/useN8nSession.ts:126` | 600 ms | the n8n import session's step/draft/answers → SQLite. Nav-away mid-import loses the last state transition |
| `src/features/templates/sub_n8n/hooks/useN8nSession.ts:168` | 300 ms | the in-progress transform context → `localStorage`. This is the crash-recovery record |
| `src/features/settings/sub_notifications/components/NotificationSettings.tsx:66` | 300 ms | the weekly-digest toggle → `set_app_setting` |
| `src/features/settings/sub_notifications/components/NotificationSettings.tsx:109` | 300 ms | all notification prefs → `set_app_setting` |

**The loss window is the full delay, not a fraction of it**, because unmount is synchronous with the
navigation commit — there is no race to win. Executed at 800 ms with 100 ms of typing: 0 writes.

### P1-1 — a debounce that does not debounce

`useDeckControls.tsx:134-148` is the repo's only hand-rolled flush-on-unmount, and it puts the flush
in the **timer effect's own cleanup** (`:140-147`), whose deps are `[drafts]`. React runs that cleanup
on every dep change, so every keystroke synchronously writes the *previous* draft before rescheduling.

**Executed** (verbatim transcription, 5 keystrokes 20 ms apart inside one 400 ms window):

```
writes DURING the burst = 5        (a real 400ms debounce produces 0)
sequence               = ["a","ab","abc","abcd","abcde"]  + "abcdef" at unmount
```

The comment above it reads *"Debounced, and flushed on unmount."* The second half is true; the first
half has been false since the flush was added. `saveTriageSession` merges and writes to web storage,
so this is a correctness-preserving performance defect rather than data loss — but it is the exact
reason `useDebouncedSave` uses a separate mount-once effect, and the comment at `:76-81` of the
primitive says so, three files away from the site that needed to read it.

### P1-2 — no pending write in this app survives a window close

**0 of 13.** There is one `pagehide` listener in `src/` and one `beforeunload` that drains a pending
write; both are the same two lines (`throttledStorage.ts:42-43`) in a module with **zero importers**,
so at runtime the app has **three** live `beforeunload` listeners and **none** of them saves:
`useUnsavedGuard.ts:65` (prompts), `analytics/index.ts:149` (analytics), `sinceLeftBriefing.ts:137`
(heartbeat). Nothing on the Rust side compensates — the main window registers no `CloseRequested`
handler (the two in `commands/infrastructure/auth.rs:502,624` belong to the OAuth popup).

This bites hardest on the three **module-scoped** writers, because for them `pagehide` is the *only*
teardown that exists: `layoutStore.ts:269` (500 ms, the Mastermind canvas layout),
`scenePublish.ts:172` (500 ms), `appearanceMirror.ts:175` (400 ms). They correctly survive unmount
and are then discarded by the one event they cannot see.

> **This is a correction to a sibling path.** `entity-draft-editing` §7 records "four `beforeunload`
> handlers … exactly one guards unsaved data; the other three flush analytics and storage." The
> file count is right and the runtime count is not: the storage-flushing one is never imported, so it
> registers nothing. **Counting handlers in the tree over-counts the ones that run.** Same family as
> that document's own `head -3` correction — the measurement answered "how many are written", and the
> question was "how many fire".

### P1-3 — two debounced saves land out of order, and the older value wins

`useDebouncedSave` has no in-flight lock. Its timer fires, `setIsSaving(true)`, awaits, and a second
debounce window can open and fire while the first `await` is outstanding.

**Executed** (real `useDebouncedSave`, 100 ms debounce, save #1 takes 300 ms and save #2 takes 10 ms —
a large payload followed by a small one):

```
landed order = ["v2","v1"]     <-- the value the user typed FIRST is what persists
isSaving after the fast save resolves = false, with one write still in flight
```

So the primitive is simultaneously (a) capable of persisting a stale value over a fresh one and
(b) reporting "saved" while a write is outstanding. Both are fixed by `useDebouncedSaveGroup`, which
**2 of 13 sites** use. Nothing else in the app — and nothing in five sibling repos — guards a
debounced write's order.

### P2 — latent and adjacent

- `useEngineCapabilities.ts:88-102` (500 ms → `setAppSetting`) has **no cleanup at all**; the timer
  ref is cleared only by the next `persist()`. Executed: the write survives unmount — **because the
  timer leaks.** It is the only site in the app whose autosave is correct by accident, and the
  accident is one `return () => clearTimeout(...)` away from becoming P0-2. Fix it *forward*, to a
  real flush, not backward to a cleanup.
- `SettingsStatusBar.tsx:28` renders the "Saving…" busy state with `feedback/LoadingSpinner` and no
  `label`, so it returns `null` (`LoadingSpinner.tsx:12-19`) — no spinner and no `role="status"`.
- `useAppSetting.ts:76-77` — an unstored, uncleared 2000 ms `saved`-reset timer. Two saves 300 ms
  apart (what `NotificationSettings` produces) let the first timer clear the second's indicator.
- `throttledStorage.ts` — 135 lines, fully built, zero importers. Its docstring names the exact
  stores it was written for (`matrixBuildSlice`, `executionSlice`) and gives the wiring line
  (`:49`). Four persisted stores use the *synchronous* `createDedupedJSONStorage` instead, which
  solves the write-volume problem and deliberately has no pending state — so the debounce **and** its
  drain were both dropped in the same decision, and only half of it was replaced.

### Structural — the shape of the leaf

Measured twice by independent implementations, then hand-classified:

- **304** production `setTimeout` call sites across 4,829 files. **13** delay a durable write; the rest
  are UI timers, polls, and ~19 debounced **reads**.
- Of the **9 component-scoped** debounced writers: **1** flushes correctly (the primitive), **1**
  flushes but defeats its own debounce, **6** are cancel-only, **1** survives only by leaking.
- Of the **3 module-scoped** writers: **3** survive unmount by construction, **0** survive a close.
- **0 of 13** register a window-close drain. **2 of 13** serialize. **2 of 13** are reachable by a
  navigate-away flush (`useUnsavedGuard`'s 2 consumers). **1 of 13** flushes on entity switch.
- **Delay values: 300, 300, 300, 400, 400, 500, 500, 600, 600, 800, 800.** No convention, no shared
  constant, no doc. Eleven numbers, eleven files, three orders of severity.
- **Three persisted drafts, zero invalidation**, unchanged from `entity-draft-editing` §7 and
  re-verified here: `companionStore.ts`'s own `clearDraft` (declared `:300`, implemented `:942`) still
  has **zero call sites repo-wide** — the only `clearDraft` calls in `src/` are
  `clearTwinReplyDraft`, a different store (`ReplyOutbox.tsx:42,191,332`).

### Second pass — what is upstream of all of it

Re-reading the deviations together: 6 cancel-only cleanups, 1 inverted flush, 1 drop-on-overlap, 1
leak, 0 close-drains and 11 uncoordinated delay constants are not independent lapses.

> **The pending write has no owner. Every site invents one, and the owner it invents is always the
> component — which is the one object guaranteed to die first.**

Where the timer belongs to something that outlives the edit (`layoutStore`, `scenePublish`,
`appearanceMirror`, and the `throttledStorage` design), unmount stops being a hazard and the only
remaining teardown is the window — one event, one listener, one place to get right. Where the timer
belongs to the component, every teardown becomes a separate hand-rolled decision, and there are four
of them (dep change, unmount, entity switch, window close) that a `useEffect` cleanup cannot tell
apart. That is exactly the 6-cancel-only, 1-inverted-flush, 1-leak spread measured above.

And the convergence sweep says the same thing from the other end: **the one implementation in six
repos that drains on teardown is a backend outbox** (`kafka.ts:102-117,275`), where the pending write
is owned by a long-lived service object and the shutdown path is a first-class concept. The fix is
not more care at the call site. It is to stop giving the call site a timer.

## 8 Gaps in the primitive

1. **`useDebouncedSave` has `cancel` but no `flush`.** It returns `{ isSaving, lastError, cancel }`
   (`:25`), so every consumer that needs a deliberate flush composes one by hand —
   `EditorBody.tsx:86-89` and `usePersonaSwitchGuard.ts:26-29` both do `cancelAllDebouncedSaves()`
   then `saveAllTabs()`. That pairing is the correct behaviour and it is unenforced: `cancel()`
   without the follow-up save is a data-loss call the type welcomes.
2. **There is no window-close drain registry.** `throttledStorage.ts:25-44` implements one for
   `localStorage` keys only, and is unimported. A generic `registerPendingWrite(key, flush)` +
   one `pagehide`/`beforeunload` drain does not exist, so the correct thing to do at 13 sites is to
   add 13 listeners. This is the single highest-value extraction in this document and it is ~30 lines.
3. **`useDebouncedSaveGroup` is not where anyone can find it.** It lives in
   `features/agents/sub_editor/libs/`, is not exported from `src/hooks`, and is not in the shared
   catalog — while `useDebounce` and `useDebouncedSave` are barrel-exported from
   `hooks/utility/timing/`. The only write-ordering guard in the repo is structurally invisible to
   the rest of it, and the sibling sweep found the same placement/adoption correlation in `vibeman`.
4. **`useDebouncedSaveGroup` snapshots by reference, undocumented.** `const snapshot = draftRef.current`
   (`:47`) plus `draftChanged(draftRef.current, snapshotBefore, keys)` (`:44`) means a draft mutated
   in place compares equal to itself and the second save is swallowed. Executed: immutable replace →
   `["v1","v2"]`; in-place mutation → `["v1"]`, and `v2` is never written. It works today only
   because `PersonaDraft` is replaced through `setDraft`. Same class as that path's own Gap 4
   (`draftChanged` compares with `!==`).
5. **The unmount flush is untrackable and untestable from outside.** `void saveFnRef.current()`
   (`:89`) is fire-and-forget by necessity — the component is gone, so `isSaving`/`lastError` cannot
   move and the toast at `:57` is unreachable. A failure reaches only the global
   `unhandledrejection` handler (`main.tsx:120-141`), which is Sentry, not the user. There is no
   supported way for a caller to await the final flush.
6. **`PersistenceStatus`-style unions cannot express "unsaved".** This is a per-surface type, not a
   shared one, so there is nothing to fix once. `SettingsStatusBar` gets it right by taking `isDirty`
   as a separate prop rather than as a union member — which works and does not generalise.
7. **No shared debounce delay.** `useDebouncedSave`'s default is 800 (`:24`) and `useTabSection`
   re-declares 800 (`:59`); the other 11 sites each pick their own. There is no constant to import
   and no doc saying what a write debounce should be versus a read debounce.
8. **The spinner boundary has no row for this.** [`inline-busy-state`](./inline-busy-state.md) and
   `CLAUDE.md` split busy states into *a surface loading its data* (ghost, never a spinner) and *an
   action the user pressed* (a real spinner on the control). **An autosave is neither** — no control
   was pressed and no surface is loading — and the repo's answer to it (`SettingsStatusBar`) reaches
   for `LoadingSpinner`, which renders `null`. The third row is missing from that table, and this is
   offered upward rather than filed as a bug here.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered before §9 is written, and held against all
seven qualifications.

**Measured answer: no type reaches this condition, and saying so is the finding.**

The dangerous state is *a scheduled write whose scheduler is about to be destroyed*. TypeScript
cannot see that a `setTimeout` handle went out of scope, cannot see that a cleanup ran, and cannot
distinguish React's dep-change cleanup from its unmount cleanup — the runtime does not distinguish
them either, which is precisely why `useDebouncedSave` needs two effects to tell them apart. This is
the doctrine's third "where types cannot reach" case in a new form: **the value never crosses a
parameter, because the value is a moment in time.**

Held against the seven qualifications:

1. **A required prop carries only what it encodes.** A required `onFlush` would encode "a flush
   function was supplied", not "a flush happened". The gap between those two is the entire defect:
   `EditorDocument` *has* a `registerCancel` (`:56`) and every debounced tab supplies one, and
   cancelling is exactly the wrong half.
2. **Requiredness is orthogonal to closedness.** Making `delay` required changes nothing; making it
   a closed union of two named constants would close it and still not schedule a flush. The one
   place closedness genuinely pays here is the **status union** — see below.
3. **A type nobody constructs constrains nothing.** Decisive. `useDebouncedSave` has **1** consumer
   and `createThrottledLocalStorage` has **0**. Any signature change to either reaches 2 surfaces and
   0 surfaces respectively. **The binding constraint on this leaf is adoption, not expressiveness** —
   the same conclusion `entity-draft-editing` reached from the opposite direction, and the reason §9
   counts hand-rolls rather than proposing a fourth primitive.
4. **A type anyone can construct authenticates nothing.** `setTimeout` is a global. No newtype,
   no branded `PendingWrite`, no wrapper can prevent a developer from typing the eight characters
   that create an unowned timer. This is the qualification that kills the type answer outright.
5. **Withholding beats requiring.** The dangerous freedom is **owning the timer**, and it *can* be
   withheld — by a module-scoped scheduler that hands back nothing cancellable. Three sites already
   do this (`layoutStore`, `scenePublish`, `appearanceMirror`) and all three are immune to the
   unmount bug as a consequence, not as a precaution.
6. **Withhold the dangerous freedom, not the answer.** The answer is *what to write and when it
   changed*; the dangerous freedom is *when it goes out*. `scheduleDurableWrite(key, () => write(ref.current))`
   takes the former and keeps the latter. `useDebouncedSave` already withholds the timer and then
   hands back `cancel()` — half the freedom, returned.
7. **Withholding a requirement only helps when the requirement forced the bad value.** Nothing
   *requires* anyone to hand-roll a timer; they do it voluntarily, because `setTimeout` is right
   there and the primitive is one directory away with one consumer. So relaxing any requirement is
   inert here. **The fix is to withhold construction — and, since `setTimeout` cannot be withheld,
   to make the correct construction the one that is easier to reach.**

**So the structural fix is not a type. It is a registry.** Ship
`lib/pendingWrites.ts` — `schedule(key, flush, delay)` / `flushAll()` — module-scoped, one
`pagehide` + `beforeunload` listener registered once, a per-key queue-on-overlap (not drop, §5), and
a `getPending(key)` read-through so a surface can render "unsaved" honestly.
`throttledStorage.ts:25-44,81-89` is that design already written for one storage backend; generalise
it and delete the special case. Then have `useDebouncedSave` schedule *through* it, so the 2 surfaces
that already use the primitive inherit the drain for free, and the 11 hand-rolls have somewhere to
migrate to. Unmount, entity switch and window close stop being four per-site decisions and become one
property of the scheduler.

**The one type that does pay** is the indicator's. A status union that cannot represent "there are
edits not yet written" makes an honest UI unrepresentable — `PersistenceStatus`
(`useMediaStudioPersistence.ts:19`) is `'idle' | 'saving' | 'saved' | 'error'` and renders a green
check over unsaved data as a direct consequence. Adding `'dirty'` is a closedness fix (Q2) on a type
that *is* constructed (Q3) at every render of the chip, and it makes the P0-1 display defect a
compile error. Do that one. It is not the fix for the data loss; it is the fix for not being told.

## 9 The missing gate

**The condition, stack-free:** *a write is scheduled for later by an object that can die before
"later" arrives, and nothing drains it when that happens.* The four deaths are a dependency change, a
component unmount, an entity switch, and the window closing — and the code that schedules the write
cannot distinguish them.

**What a signal cannot see.** Three of the four deaths are runtime events with no textual signature.
Worse, the census **cannot assert an absence** (doctrine §4), and the largest finding in this document
*is* an absence: zero `pagehide` drains in live code. There is no rule that can say "no pending write
is registered with a close handler". So the gate targets the only half that is present and countable:
**the hand-rolled timer that delays a durable write.** Every such site in this repo is missing at
least one of {flush-on-unmount, flush-on-close} — verified individually, 11 of 11 — so counting them
counts real deviations without needing to see which teardown they got wrong.

**The signal, and what it is a proxy for.** A `setTimeout` whose arrow-function callback reaches a
**durable-write door** before the callback closes. "Durable" is what makes the timer dangerous: the
value is meant to outlive the component, and the timer guarantees it briefly does not. This is a
proxy for "a pending write has no owner but the view", and it is stack-specific as the contract
requires: a repo that debounces through `lodash.debounce().flush()`, or through a server-side linger
(`personas-cloud/packages/orchestrator/src/kafka.ts:94`), or through an ORM's unit-of-work, has the
same condition wearing markup this pattern cannot see and would score a structural zero. **The
condition to re-derive in another repo is "which construct delays a durable write", not
`setTimeout`.**

**Precision: 11/11, hand-verified.** Every match was opened and confirmed to be a debounced durable
write. Three false-positive families were removed **by construction** during tuning, not by allowlist:

- **Span leakage past the callback.** An earlier draft matched a harmless UI timer whose span ran
  forward into an unrelated `await artistLoadAutosave(` twenty lines below. Removed by tempering the
  span with a negative lookahead for the callback's own terminator `}, <delay>)` — 4 false positives
  deleted, including `TriageRulesPanel.tsx:107` and `FactoryOverviewTab.tsx:436`.
- **React state setters that read as writes.** `setSaved(false)`, `updateEntry(index, {...})`,
  `reducer.saveStarted(...)`, `store.updateBackgroundExecution(...)`. Removed by the `(?!set)` guard
  on the `*save*` alternative and by narrowing `update*` to `update*Session` — 4 more deleted.
- **Store-buffer flushes.** `setTimeout(flushNormal, …)` / `setTimeout(flushPendingOutput, …)` in
  `executionSink.ts:291,334`, `artistSlice.ts:193`, `devToolsTaskSlice.ts:220` drain an in-memory
  buffer into a store; nothing durable is scheduled. Removed by dropping the bare
  `flush*`/`write*` identifier alternatives — 4 more deleted, at a disclosed recall cost below.

**Positive control — mandatory, and it partitions.** The identical anchors and the identical
terminator tempering, pointed at the **compliant** form — a timer callback that closes without
reaching any durable-write door — match **94 times across 85 files** against the gate's 10 across 8.
So the rule keys on *durability*, not on the token `setTimeout`: **9.6% of brace-bodied timer
callbacks schedule a durable write and 90.4% do not.** If that control's count ever collapses toward
the gate's, the anchors have broken and both numbers are meaningless. The control carries **no
`baseline`** — a ratchet is monotone-downward and a rule counting compliant code would fail the build
every time adoption improved.

**Disclosed recall gaps — three, all structural:**

1. **A bare function reference is invisible.** `setTimeout(flushWriteThrough, WRITE_THROUGH_DEBOUNCE_MS)`
   (`appearanceMirror.ts:175`) is a real debounced durable write with no call expression in the
   callback. Recovering it means matching `setTimeout(<identifier>,` on a `flush|write|persist|save`
   name — which re-admits the four store-buffer false positives above, taking precision from 11/11 to
   11/15 (73%). The contract's *"a gate that fires on correct content is worse than no gate"* rules
   that out. **`appearanceMirror.ts:175` must be fixed by hand.**
2. **An indirected write is invisible.** `useDebouncedSave.ts:47` itself calls `saveFnRef.current()`;
   no door appears in the callback. That is *desirable* for the primitive, and it means a hand-roll
   that indirects through a local callback would also be missed — the same blind spot
   `entity-draft-editing` §9 disclosed for hoisted payloads, one layer down.
3. **The gate cannot see which teardown is wrong.** It counts hand-rolls, not cancel-only cleanups.
   That is deliberate — the cancel-only shape measured 6/8 precision as a standalone signal — but it
   means a site can satisfy the gate's *intent* (add a flush) without the count moving. The count
   moves only when the timer stops being hand-rolled.

**Why this is a census rule and not an ESLint rule.** The countable signal is textual and the
mechanism wanted is a ratchet. The *better* instrument is an ESLint rule with type information that
flags a `setTimeout` inside a `useEffect` whose callback transitively reaches a function imported from
`@/api/**` or `@/lib/tauriInvoke` — that closes gaps 1 and 2, can see the cleanup's shape as an AST
node rather than as text, and can autofix the import to `useDebouncedSave`. It is worth building and
it is not this. Until it exists, the census holds the line.

**How it fails loudly.** Inherited from the runner: a walk seeing fewer than `floor` files fails
("matcher broken, not codebase clean"); zero matches anywhere fails; a stale `exclude` fails; a count
that *drops* without the baseline being updated fails, because a silent drop is a broken matcher more
often than fixed code.

**Where it runs.** `npm run census:check`, which is what the corpus's own gate runs and which executes
in ~0.2 s for these two rules over 4,829 files. Per this batch's calibration: `ci.yml`'s
`frontend-checks` is currently red on a platform-incomplete lockfile and its Rust job is red on 10
pre-existing failures, so **a gate that only runs in CI runs nowhere**. The census runner is invocable
locally and by the corpus's own maintenance loop, which is why the ratchet lives there rather than in
a new CI step.

**This rule cannot express "must be zero", and it should be zero.** All 10 matches are removable —
9 by migrating to `useDebouncedSave` or a module-scoped scheduler registered with the drain of §8
gap 2, and `useEngineCapabilities.ts:97` by fixing it *forward* to a real flush rather than backward
to a cleanup. When the count reaches 0 the runner will fail structurally on zero-matches **by
design**: at that point **delete the rule, do not baseline it at 0**.

**Validated standalone before publication**, in a composer-private registry with a filename unique to
this composer, then re-extracted from this document and re-run — both runs report
`files 8 / matches 10` for the gate and `files 85 / matches 94` for the control, over 4,829 files
walked against a floor of 3,000, with `commentMatchesSkipped 0`. The full registry was **not** run,
per doctrine §4.

```json
{
  "id": "unflushable-debounced-write",
  "goldenPath": "docs/concepts/golden-paths/debounced-autosave.md",
  "title": "A hand-rolled setTimeout delays a write that outlives the component, so the pending write is owned by the one object guaranteed to die before it lands",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:window\\.)?setTimeout\\s*\\(\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>\\s*(?:\\{(?:(?!\\}\\s*,\\s*[A-Za-z0-9_.$]{1,40}\\s*\\))[\\s\\S]){0,900}?|(?!\\{)[^;{}]{0,60}?)(?:setAppSetting\\s*\\(|(?:local|session)Storage\\.setItem|\\b(?!set)\\w*[Ss]ave[A-Z]\\w*\\s*\\(|\\b\\w+\\.save\\s*\\(|\\b\\w*[Aa]utosave\\w*\\s*\\(|\\bwrite\\w*Now\\s*\\(|\\bupdate[A-Z]\\w*Session\\s*\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a setTimeout whose arrow-function callback reaches a DURABLE-WRITE door (set_app_setting, local/sessionStorage.setItem, a save*/autosave*/write*Now/update*Session call) before the callback's own terminator `}, <delay>)`. PROXY FOR the stack-free condition: a write is scheduled for later by an object that can die before 'later' arrives, and nothing drains it when that happens. The four deaths - a dependency change, an unmount, an entity switch, and the window closing - are indistinguishable from inside a useEffect cleanup, which is why useDebouncedSave needs TWO effects (a cancel-only timer effect at :65-67 and a mount-once flush at :82-92) to tell the first two apart. EXECUTED, not argued: the four teardown shapes found in src/ were transcribed verbatim and replayed against real React via @testing-library/react under fake timers. (1) CANCEL-ONLY - 800ms debounce, 100ms of typing, unmount -> 0 writes, and draining timers 5s further changes nothing; this is the shape at useMediaStudioPersistence.ts:104, FactoryShell.tsx:85, useN8nSession.ts:149 and :184, NotificationSettings.tsx:67 and :110. (2) FLUSH-IN-THE-DEP-CLEANUP - 5 keystrokes 20ms apart inside one 400ms window produced 5 WRITES where a real debounce produces 0, because React runs the dep-cleanup on every dep change; useDeckControls.tsx:140-147 does this under a comment reading 'Debounced, and flushed on unmount'. (3) NO CLEANUP - useEngineCapabilities.ts:88-102 survives unmount BECAUSE THE TIMER LEAKS, which is correct by accident and one `return () => clearTimeout(...)` away from data loss. (4) WINDOW CLOSE - a pending 800ms write with pagehide and beforeunload both dispatched first -> 0 writes; there is exactly one pagehide/beforeunload drain in src/ (lib/throttledStorage.ts:42-43) and that module has ZERO importers, so at runtime the app has three live beforeunload listeners and none of them saves. Also executed: useDebouncedSave has no in-flight lock, so a 300ms save followed by a 10ms save lands ['v2','v1'] - the OLDER value persists - while isSaving reads false with a write still outstanding. Measured 2026-08-16 at HEAD: 10 matches across 8 files, ALL ELEVEN RAW MATCHES OPENED AND CONFIRMED (precision 11/11; one is excluded as the primitive), commentMatchesSkipped 0, over 4829 files walked. Reconciles with two independent inventories - a brace-matched scan of all 304 production setTimeout call sites, and a second implementation that resolved each file's persist doors from its own @/api/* imports rather than from a verb list. THREE FALSE-POSITIVE FAMILIES ARE EXCLUDED BY CONSTRUCTION rather than by allowlist: (a) SPAN LEAKAGE - an untempered span ran past the callback into an unrelated call twenty lines below (TriageRulesPanel.tsx:107, FactoryOverviewTab.tsx:436, useMediaStudioPersistence.ts:113, usePersonaExecution.ts:329), removed by the negative lookahead for the callback's own terminator; (b) REACT STATE SETTERS reading as writes - setSaved(false), updateEntry(index, {...}) at ByomApiKeyManager.tsx:211, reducer.saveStarted(...) at useCreateTemplateActions.ts:79 - removed by the (?!set) guard and by narrowing update* to update*Session; (c) STORE-BUFFER FLUSHES - setTimeout(flushNormal|flushTail|flushPendingOutput, ..) at executionSink.ts:291,334, artistSlice.ts:193, devToolsTaskSlice.ts:220 drain an in-memory buffer into a store and schedule nothing durable - removed by dropping the bare flush*/write* identifier alternatives. NOT EVERY MATCH IS EQUALLY SEVERE AND THE RULE DOES NOT CLAIM SO. The 10 break down exactly: SIX are cancel-only and lose the pending write on unmount - useMediaStudioPersistence.ts:83 (800ms, and its composition state is plain useState under a lazy() route so the edit dies with the timer), FactoryShell.tsx:76 (600ms, and its [kpiId, edits] dep list also cancels the previous KPI's write on a tab switch), useN8nSession.ts:126 (600ms) and :168 (300ms), NotificationSettings.tsx:66 and :109 (300ms). ONE inverts the flush into the dep-cleanup and thereby deletes its own debounce - useDeckControls.tsx:136. ONE has no cleanup and survives only by leaking - useEngineCapabilities.ts:97. TWO are module-scoped and therefore immune to unmount but exposed to the window close, which for them is the ONLY teardown that exists - layoutStore.ts:269 and scenePublish.ts:172 (500ms each). ZERO of the ten register a window-close drain. 6 + 1 + 1 + 2 = 10. It is a RATCHET on a construction that is removable in every case. DISCLOSED RECALL GAPS, all three structural: (1) a BARE FUNCTION REFERENCE is invisible - lib/appearanceMirror.ts:175 is `setTimeout(flushWriteThrough, WRITE_THROUGH_DEBOUNCE_MS)`, a real debounced durable write with no call expression in the callback, and recovering it re-admits the four store-buffer false positives, taking precision from 11/11 to 11/15 (73%), which is worse than no gate; (2) an INDIRECTED write is invisible - useDebouncedSave.ts:47 calls saveFnRef.current() and no door appears, which is desirable for the primitive and means a hand-roll indirecting through a local callback is also missed; (3) the gate CANNOT SEE WHICH TEARDOWN IS WRONG - it counts hand-rolls, not cancel-only cleanups, because the cancel-only shape measured only 6/8 precision as a standalone signal, so a site can satisfy the gate's intent without moving the count until the timer stops being hand-rolled. PRECONDITION (must be re-derived per repo): this repo hand-rolls every debounce as a useRef<Timeout> + clearTimeout pair - a convergence sweep found ZERO debounce-library dependencies across all six checkouts in the fleet (lodash, use-debounce, throttle-debounce, react-use, usehooks-ts, ahooks: 0 declared, 0 imported) - and writes durably through a small set of named doors. A repo that debounces through lodash.debounce().flush(), through a server-side linger (personas-cloud/packages/orchestrator/src/kafka.ts:94), or through an ORM unit-of-work has the SAME condition wearing markup this pattern cannot see and scores a structural zero. POSITIVE CONTROL: the identical anchors and the identical terminator tempering, pointed at the COMPLIANT form (a timer callback that closes without reaching any durable-write door), match 94 times across 85 files, so the rule discriminates on DURABILITY rather than on the token setTimeout - 9.6% of brace-bodied timer callbacks schedule a durable write and 90.4% do not. LEGAL FIX, in order: (1) replace the hand-roll with hooks/utility/timing/useDebouncedSave, which is the only implementation in six repos that flushes on unmount and does it from a SEPARATE mount-once effect (:82-92) - copying its flush into the timer effect's cleanup instead is the defect at useDeckControls.tsx:140; (2) if the edited state outlives the view, move the timer to module scope - features/teams/sub_mastermind/lib/layoutStore.ts:267-273 is the shape - which removes unmount from the problem entirely; (3) EITHER WAY register the pending write with a pagehide/beforeunload drain, for which src/lib/throttledStorage.ts:25-44 is a complete working implementation with zero importers; (4) if two saves can overlap, wrap in features/agents/sub_editor/libs/useDebouncedSaveGroup, whose in-flight lock is the only write-ordering guard in the repo (2 consumers) - note it snapshots draftRef.current BY REFERENCE at :47-48, so a draft mutated in place makes draftChanged compare the live object with itself and the early return at :44 swallows the second save (executed: immutable replace -> ['v1','v2'], in-place mutation -> ['v1']). Do NOT silence a match by hoisting the timer body into a named function (that hides it from the rule without fixing it) or by adding `if (inFlight) return;` - that reads as the in-flight lock and is its opposite, dropping the write instead of queueing it, which is exactly how useMediaStudioPersistence.ts:86 loses the user's last edit. END OF LIFE: this rule is designed to reach zero - all 10 are removable. When it does the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
  },
  "exclude": [
    {
      "path": "src/lib/throttledStorage.ts",
      "reason": "the primitive itself - the only debounced writer in the repo that registers a pagehide/beforeunload drain (:42-43) and a read-through pending map (:81-89) so a buffered value is never read back stale. It is the compliant form this rule routes callers toward; it has zero importers, which is deviation P2, not a gate violation."
    }
  ],
  "baseline": { "files": 8, "matches": 10 },
  "floor": 3000
}
```

```json
{
  "id": "unflushable-debounced-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/debounced-autosave.md",
  "title": "POSITIVE CONTROL - the same anchors pointed at a timer callback that closes without scheduling anything durable",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:window\\.)?setTimeout\\s*\\(\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>\\s*\\{(?:(?!\\}\\s*,\\s*[A-Za-z0-9_.$]{1,40}\\s*\\))(?!setAppSetting\\s*\\(|(?:local|session)Storage\\.setItem|\\b(?!set)\\w*[Ss]ave[A-Z]\\w*\\s*\\(|\\b\\w+\\.save\\s*\\(|\\b\\w*[Aa]utosave\\w*\\s*\\(|\\bwrite\\w*Now\\s*\\(|\\bupdate[A-Z]\\w*Session\\s*\\()[\\s\\S]){0,900}?\\}\\s*,\\s*[A-Za-z0-9_.$]{1,40}\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The identical setTimeout anchors and the identical `}, <delay>)` terminator tempering as unflushable-debounced-write, with the durable-write door alternation moved into a negative lookahead - i.e. a timer callback that opens, runs, and closes without scheduling anything that outlives the component. Exists to prove the gate discriminates on DURABILITY rather than on the token setTimeout: measured 2026-08-16 at HEAD it matches 94 times across 85 files against the gate's 10 across 8, so 90.4% of brace-bodied timer callbacks in this repo schedule nothing durable and are correctly ignored, while 9.6% do. That partition is the whole claim - the repo has 304 production setTimeout call sites and only 13 of them delay a durable write, so a rule anchored on setTimeout alone would be counting UI timers, polls and ~19 debounced READS (a different situation leaf). Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved, and scripts/census/merge-published-rules.mjs skips baseline-less rules by construction while the engine exempts a `-positive-control` id from the baseline requirement. If this control's count ever collapses toward the gate's, the terminator tempering has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible."
  },
  "floor": 3000
}
```

## Corrections to the brief that composed this path

Recorded per [doctrine §7](../golden-path-doctrine.md#7-corrections-are-the-deliverable), because a
brief is a hypothesis and refuting it is part of the job.

1. **"Lazy routes fully unmount on nav-away, so a pending debounce timer dies with them."** True for
   9 of 13 sites and **false for 3** — `layoutStore`, `scenePublish` and `appearanceMirror` schedule
   at module scope, so unmount is not their hazard at all. The brief's framing would have sent a
   composer looking for an unmount bug in three files that do not have one, and would have missed
   that for exactly those three the window close is the *only* teardown that exists. The interesting
   axis is **who owns the timer**, not whether the route is lazy.
2. **"A debounced save that fires after the entity changed underneath is the lost-update shape."**
   Measured: the ordering defect here is not a lost update against a *server* write, it is a lost
   update against **the client's own earlier save** — `["v2","v1"]`, the older value persisting,
   with no third party involved. Qualification 7 does apply, but for a different reason than the
   brief supposed: no requirement is forcing the bad value, so relaxing a type is inert; the fix is
   an in-flight lock, which is a runtime object and not a type at all.
3. **"0 of 232 save-catch blocks discard the draft — the one dimension already right everywhere."**
   Taken on trust from [entity-draft-editing](./entity-draft-editing.md) §7 and **not re-measured
   here** — but it does not extend to this leaf, and the extension is where the
   damage is: **a discarded pending write never reaches a catch block.** The write that is lost at
   unmount is not a failed save; it is a save that never happened, so the dimension the repo gets
   right everywhere has no jurisdiction over the dimension it gets wrong at 11 of 13 sites.
4. **The two independent inventories disagreed, 13 vs 22, and the disagreement was the result.**
   Implementation A used a hand-written verb list and found 13; implementation B resolved each
   file's persist doors from its own `@/api/*` imports and found 22. Neither was right. A's verb
   list missed `artistAutosaveComposition` because `\bautosave` does not match inside
   `artistAutosave` — a word-boundary assumption, and the miss landed squarely on the one site that
   turned out to be P0-1. B's larger number was mostly **debounced reads**, which are a different
   leaf entirely. The doctrine's warning that "a vocabulary-based signal's recall is bounded by its
   author's word list, and the misses cluster on the unusual cases" replicated exactly: the word I
   forgot to list was the one guarding the most losable write in the app.
5. **A count of handlers in the tree over-counted the ones that run.** `entity-draft-editing` §7
   records four `beforeunload` handlers, "one guards unsaved data … the other three flush analytics
   and storage." The file count is right; the storage one is never imported, so **three** register at
   runtime and **zero** flush a pending write. Corrected in §7 P1-2.
6. **`useDeckControls` is listed nowhere as a defect and reads as the one hand-rolled site that got
   flush-on-unmount right.** It does flush — and the same three lines delete its debounce, which
   nothing in the code, the comment, or the brief indicates. It took a replay to see, which is the
   doctrine's "execute, don't read" in its purest form: the file is *correct on the dimension it
   documents* and wrong on the one it does not mention.
