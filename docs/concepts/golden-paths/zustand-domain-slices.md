# Golden path — Zustand domain slices

> Situation node: `client-runtime/state-management/zustand-domain-slices` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2a874e692`, from a ground-truth sweep of the
> whole frontend: a TypeScript-AST pass over all **4,829** `.ts`/`.tsx` files
> ([`shared-facts.json`](../shared-facts.json) `frontend.tsFiles`) classifying every store
> subscription by return shape, cross-checked against an independent regex pass, plus ~30
> files opened directly and two sibling-repo convergence oracles.
> Dimensions: **performance · code-quality · function · resilience**.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

**Boundary with [`client-state-persistence`](./client-state-persistence.md).** That path
owns *durability*: who is the authority for a value, `persist()` configuration, storage
adapters, the `app_settings` key registry, secrets. This path owns *shape and
subscription*: what a slice is, how it composes into a root store, and how a component
reads from it. They meet at exactly one seam — `partialize`. **Which fields survive a
restart is that path's call; which slice a field lives in and how it is read is this
one's.** If you are adding a field, decide its slice here, then go there to decide
whether it persists. Do not write a `persist()` config from this document.

## Trigger

- "Where do I put this state?" / "should this be a new slice or a new store?"
- "I need to add a field / an action to the store"
- "This component re-renders too often" / "the whole page flashes when one row updates"
- "How do I read two things from the store at once?"
- "Should I use `useShallow` here?"
- "I need the current value but not a subscription"

If you are about to type `StateCreator<`, `create<`, `useShallow(`, `useXStore((s) =>`,
`useXStore.getState()`, or to add a field to an `interface *Slice` — you are in this
situation.

## The one way

Put the state in a **slice** — a plain function typed `StateCreator<RootStore, [], [], YourSlice>`
returning its own initial fields and its own actions — and spread it into exactly one of the
five domain root stores (`agentStore`, `systemStore`, `overviewStore`, `pipelineStore`,
`vaultStore`), adding its interface to the store's intersection type in `storeTypes.ts` in the
same edit; that third type parameter is what makes registration structural rather than
optional, and it is why 55 of 55 slices are correctly registered today. Read from it with
**one narrow selector per value** — `useSystemStore((s) => s.activeProjectId)` — and reach
for a second, third and fourth hook call rather than bundling, because a selector that
returns a direct property access is compared by `Object.is` and costs nothing, while a
bundle allocates. Use `useShallow` for **exactly one** thing: a selector that *constructs*
a fresh object or array from several fields, where you have no other way to avoid the
allocation. **Never wrap `useShallow` around a plain property access** — it cannot help
there, because if the reference were churning the fix belongs in the slice that writes it,
and if it were not, `Object.is` already short-circuits. When a value must be *derived*,
export a named hook whose producer memoizes into a stable reference
(`stores/selectors/personaSelectors.ts`) instead of computing it at the call site. And when
you need a value but not a subscription — inside an event handler, an effect, a module-level
function — call `useXStore.getState()`, never a selector you then ignore.

## Mandated primitives

- **`zustand`** `create<T>()(...)` and `StateCreator<Root, [], [], Slice>` — v5.0.13
  (`package.json:138`). The 4-parameter `StateCreator` form is the slice contract: parameter
  1 is the *whole root store* (so `get()` sees every sibling slice), parameter 4 is *this
  slice's own surface* (so the return value is checked against exactly what you declared).
- **`src/stores/storeTypes.ts`** — the registry. `CoreState` (`:181`) + `createCoreState()`
  (`:191`) seed the four fields every domain store shares (`error`, `errorKind`, `isLoading`,
  `sliceErrors`); each root store is an intersection type of its slice interfaces (`AgentStore`
  at `:201`). **A slice interface not in this file is not in any store.**
- **`reportError(err, fallback, set, options)`** — `storeTypes.ts:105`. The one error path for
  slice actions: Sentry scope + optional toast + optional scoped `sliceErrors[action]` entry,
  with a 5 s dedupe window (`:100-102`). Use it in every `catch` inside a slice; do not
  hand-roll `set({ error: String(err) })`.
- **`errMsg` / `errKind`** — `storeTypes.ts:71` / `:80`. Unwrap a `TauriError` into a message
  and a structured `kind`.
- **`useShallow`** from **`zustand/react/shallow`** — the only sanctioned import path, and the
  repo is unanimous on it (74 files, zero importing bare `shallow`). For **constructing**
  selectors only.
- **`src/stores/selectors/`** — shared derived selectors. `personaSelectors.ts` exports
  `useParsedDesignContext()` / `useSelectedUseCases()` / `useSelectedCredentialLinks()`;
  `activeAlertCount.ts` exports `selectActiveAlertCount`. **This is the right home for any
  derived value read from more than one file.**
- **`createLatestWins()`** — `src/stores/util/latestWins.ts`. The stale-response guard for
  slice fetch actions. (Owned by [`stale-response-guard`](./stale-response-guard.md) and
  already census-gated as `hand-rolled-stale-token`; named here only so you don't write a
  ninth `++seq` counter.)
- **`src/stores/__tests__/README.md`** — the slice testing doctrine, already written and
  genuinely good. **Harness-per-test is the default**; the singleton-with-reset deviation list
  is explicitly exhaustive. Read it before writing a slice test.

**The aggregator slice, for a domain that outgrows one file.** `devToolsSlice.ts` is 38 lines
and composes five sub-slices (`:32-37`) behind one `StateCreator<SystemStore, [], [], DevToolsSlice>`.
The root store registers one name, not five. Copy this when a slice would otherwise exceed
~400 lines.

## Steps

1. **Pick the root store by domain**, not by feature folder: agents / system / overview /
   pipeline / vault. If it fits none, it is probably view state — see
   [`view-state-persistence`](../situation-spine.md) — not store state.
2. **Write `export interface YourSlice`** in `src/stores/slices/<domain>/yourSlice.ts`, with a
   doc comment per non-obvious field. Fields first, actions after.
3. **Write `export const createYourSlice: StateCreator<RootStore, [], [], YourSlice> = (set, get) => ({ ... })`.**
   Initial values inline; every action `async` and `void`-returning, writing through `set`.
4. **Ask whether the field is derivable from a field you already have.** If yes, do not add
   it — add a selector in `src/stores/selectors/` instead. A stored derived value is a second
   source of truth that will drift.
5. **Ask whether a collection you `set()` will be compared by readers.** If a fetch replaces
   the whole array, every element is a fresh object and no reader-side equality check can
   save them. Preserve identity in the *writer* (patch with `.map()` keeping unmatched
   elements, or keep the array reference when contents are unchanged) — see Gaps #2.
6. **Register it**: add the import + `...createYourSlice(...a)` to the root store, and the
   interface to the intersection in `storeTypes.ts`. TypeScript fails the build if you do one
   and not the other. **This is the type doing the work — do not add a check script for it.**
7. **Route every `catch` through `reportError`** with an `action` name so the failure lands in
   `sliceErrors` and Sentry with a tag.
8. **Subscribe with one narrow selector per value.** `const x = useSystemStore((s) => s.x);`
   Four of these in one component is correct and idiomatic here — 2,160 of the repo's 2,290
   subscriptions are exactly this.
9. **Only if a selector must construct**, wrap it in `useShallow`. If what you are wrapping is
   `(s) => s.something` with nothing built, delete the `useShallow` and go fix step 5 instead.
10. **For an imperative read, use `getState()`** — in handlers, effects, and module functions.
    Never in a render body (the repo has zero such sites; keep it that way).
11. **Write the test with the harness pattern** from `src/stores/__tests__/README.md`.
12. **Stop.** No new `create<>` store outside `src/stores/` unless it is consumed by exactly
    one feature directory. No `useXStore.setState()` from a component. No `devtools`
    middleware. No selector memoized with `useMemo` — that runs *after* the re-render you
    were trying to avoid.

## Anti-patterns

- **`useShallow((s) => s.someArray)`.** The single most-copied mistake in this leaf — **15
  sites across 11 files**, 9 of them on `fleetSessions` / `projects`. `useShallow` shallow-compares
  the *result*; when the result is a property access, the only thing it can compare is the
  array's own elements. Both of those arrays are written by
  `set({ fleetSessions: snapshot.sessions })` (`fleetSlice.ts:233`) and
  `set({ projects, ... })` (`devToolsProjectSlice.ts:102`) — values deserialized fresh from
  IPC on every poll, so **every element is a new object and the shallow compare fails 100% of
  the time.** It is pure added cost: an O(n) walk per store notification that never prevents a
  render. The fix is in the writer, not the reader.
- **Bundling narrow reads into one `useShallow` object to "reduce subscriptions".** Four
  `useSystemStore((s) => s.a)` calls run four selectors and four `Object.is` checks and
  allocate nothing. One `useShallow((s) => ({a,b,c,d}))` runs one selector, **allocates an
  object on every store notification**, and then walks four keys. The bundle is not cheaper; it
  is more code and more garbage. Bundle only when the value genuinely must be constructed.
  *(This repo's own sibling `personas-web` ships an ESLint rule — `custom-zustand/no-multi-zustand-selector`
  — that tells developers to do the opposite. See Convergence.)*
- **A selector with a fallback literal: `(s) => s.scans ?? []`.** The `[]` is a new array every
  call, so the subscription re-renders on **every** unrelated `set()` in that store. Hoist the
  empty value to a module constant (`const EMPTY: Scan[] = []`) — the repo already does this
  correctly in `personaSelectors.ts:22-23` and `useTeamChannel.ts` (`EMPTY_CHANNEL`).
- **Storing a value you can derive.** A `*Count` that some action must remember to keep in
  sync is a bug waiting for the one code path that forgets. Derive it in a selector; only
  store a count the *backend* computed (a pagination total), which is not derivable client-side.
- **`useXStore.setState({...})` from a component.** Writes an untyped partial straight into the
  store, bypassing the slice's action — so the slice's tests never see it, `reportError` never
  runs, and no reader can find the writer by searching the slice. **39 production sites.**
- **A slice past ~400 lines.** `tourSlice.ts` is **1,671** and `matrixBuildSlice.ts` is
  **1,460** — each larger than all five root stores put together (328 lines). The aggregator
  pattern (`devToolsSlice.ts`) exists precisely to avoid this and is used once.
- **A new `create<>()` store in `src/features/` for state more than one feature reads.** It
  gets no `CoreState`, no `reportError`, no entry in `storeTypes.ts`, and no coverage from the
  store test doctrine.
- **`useMemo(() => heavy(x), [x])` where `x` came from a selector.** The re-render already
  happened. Memoize inside the *selector's producer* so `Object.is` can bail before React
  renders — `personaSelectors.ts:6-15` explains this and states the bound honestly.
- **Reading with a selector and ignoring the value** just to get at `getState()` later. Take
  the subscription off; use `getState()`.
- **`devtools` middleware.** Absent from the repo and should stay absent — it wraps every
  `set()` and serializes to a bridge; on `useSystemStore`, with 1,150 subscription sites, that
  is not free.

## Evidence

**Adoption:** 59 files under `src/stores/slices/` → **55** exported `create*Slice` creators,
**54** exported `*Slice` interfaces, **4** pure helper modules. All 55 are registered:
`systemStore` 18, `agentStore` 11, `overviewStore` 11, `pipelineStore` 5, `vaultStore` 5, and 5
via the `devToolsSlice` aggregator. **21** zustand stores exist in total — 13 in `src/stores/`,
8 in `src/features/`. **2,290** production subscriptions across **664** files; **867**
imperative ops (818 `getState`, 39 `setState`, 10 `subscribe`).

- **`src/stores/slices/network/devicesSlice.ts` — copy this one.** The cleanest complete slice
  in the repo: a header comment stating what the slice deliberately does *not* own (`:4-8`,
  the pairing state machine lives in a pure reducer so it is testable without a store), a
  documented field on every entry (`:21-32`), the exact `StateCreator<SystemStore, [], [], DevicesSlice>`
  signature (`:48`), and a doc comment on `setDeviceHome` (`:38-42`) recording a *product*
  invariant — exactly one device is home globally — where the next reader will find it.
- **`src/stores/selectors/personaSelectors.ts:6-15` — the structural answer to derived state.**
  The docstring is the best piece of state-management writing in the repo: it explains that
  `parseDesignContext` memoizes into a bounded LRU keyed by the raw string, that this is what
  lets zustand's default `Object.is` skip the re-render, **and that the guarantee is bounded
  rather than unconditional** because a cache eviction yields a fresh reference. Stating the
  limit of your own optimisation is rare; copy the habit. 14 call sites across 3 hooks.
- `src/stores/slices/system/devToolsSlice.ts:32-37` — the aggregator slice; five sub-slices,
  one registration, 38 lines.
- `src/stores/storeTypes.ts:189-196` — `createCoreState()`, with the reason in the comment
  ("so the four fields can't drift between stores").
- `src/stores/storeTypes.ts:105-140` — `reportError`, the one error path, with toast dedupe.
- `src/stores/util/latestWins.ts:1-29` — a shared primitive whose docstring includes a worked
  example and names the three concrete races it fixes.
- `src/stores/__tests__/README.md` — 200 lines of slice-testing doctrine with canonical
  examples, an exhaustive deviation list, and the `_resetDedupCacheForTests` gotcha written
  down. Most repos do not have this; use it.
- `src/lib/eventBridge.ts:141-146` — the `globalThis` HMR singleton done correctly, and the
  local/runtime flags kept in sync at `:1054-1055` and `:1234-1235` (verified — not a leak).

**Cleared, not defects** *(checked because a prior perf pass flagged them; do not re-raise)*:
`ExecutionList` **is** virtualized (`ExecutionList.tsx:144` `useVirtualList`, measured rows at
`:505`) — settled. `CompanionPanel` no longer exists as a file; the concern is moot. And the
suspected classes this sweep went looking for came back empty: **0** `getState()` calls in a
render body, **0** whole-store subscriptions in production, **0** unregistered slices.

## Deviations found

### A — `useShallow` compensating for writer-side identity churn (15 sites / 11 files)

The headline deviation and the only one at scale. Each is a reader-side band-aid for a
collection whose reference the slice replaces.

| Path | Field | Why it cannot work |
|---|---|---|
| `plugins/fleet/useFleetOverlayActions.ts:24,:29,:30` | `fleetSessions`, `projects`, `approvals` | three in one file |
| `teams/sub_mastermind/MastermindPage.tsx:205,:217,:221` | `personas`, `fleetSessions`, `projects` | three in one file |
| `plugins/fleet/FleetFooterIcon.tsx:25` · `FleetGridLayer.tsx:34` · `FleetMobilePreview.tsx:30` | `fleetSessions` | `fleetSlice.ts:233` sets the array straight from `snapshot.sessions` — all elements fresh from IPC |
| `plugins/companion/fleet/FleetStatsSidePanel.tsx:54` | `fleetSessions` | ditto |
| `teams/sub_factory/passport/passportFleet.tsx:43` · `useAutoRescanOnFleetExit.ts:40` | `fleetSessions` | ditto |
| `plugins/dev-tools/sub_workspaces/useWorkspaceSwitch.ts:17` · `plugins/fleet/sub_skills/SkillInstallModal.tsx:35` | `projects` | `devToolsProjectSlice.ts:102` sets `projects` from `devApi.listProjects()` — all elements fresh |
| `teams/sub_collab/useTeamChannel.ts:114` | `s.channels[key] ?? EMPTY_CHANNEL` | the one arguable case: the fallback is a module constant and the value is an object, so the shallow compare can bite. Not census-visible (the `??` tail). |

**The spread is by imitation, not by analysis** — 9 of the 15 are the same
`useShallow((s) => s.fleetSessions)` / `s.projects` line copied across the fleet surface.

### B — a selector that allocates (2 sites)

| Path | What's wrong |
|---|---|
| `plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx:132` | `useSystemStore((s) => s.scans ?? [])` — the `[]` is fresh each call, so this re-renders on **every** `set()` in `systemStore`, all 18 slices of it |
| `studio/StudioBuildSettings.tsx:33` | `useStudioStore((s) => s.runtimes[id]?.mcp ?? [])` — same |

These two are the complete population of "will re-render on every unrelated state change".
Two, out of 2,290.

### C — `setState` from outside the store (39 sites)

Bypasses the slice action, so the write is invisible to the slice's tests and to anyone
searching the slice. Worst concentrations: `onboarding/components/GuidedTour.tsx` (4),
`agents/sub_deployment/hooks/useCloudHealthMonitor.ts` (4), `lib/eventBridge.ts` (4),
`vault/shared/hooks/*` (4 across `useCredentialHealth`, `useCredentialRename`,
`useCredentialTags`, `PlaygroundHeader`), `hooks/utility/interaction/useUnsavedGuard.ts` (2),
`lib/storeBusWiring.ts` (2), `hooks/execution/usePersonaExecution.ts` (2).
`src/test/automation/bridge.ts` (3) is legitimate — a test harness deliberately reaching in.

### D — slices that outgrew the pattern (2)

`system/tourSlice.ts` **1,671 lines** · `agents/matrixBuildSlice.ts` **1,460 lines**. Together
they are 15% of all slice code (20,298 lines). `tourSlice` additionally owns four `globalThis`
flags (`:1015`, `:1085-1088`, `:1129`, `:1194`) and a storage-availability probe that everyone
needs and one slice owns. The aggregator pattern at `devToolsSlice.ts:32-37` is the in-repo
answer and has been applied exactly once.

### E — a domain store outside the registry (1 of 8)

Of the 8 `create<>` stores in `src/features/`, **7 are consumed by exactly one feature
directory** and are correct colocation, not deviations: `studioStore` (593 L) and
`studioHistory` (65 L) → `features/studio`; `sceneStore` (267 L) → `features/teams`;
`mcpRequestStore` (69 L), `operativeMemoryStore` (58 L) → `features/plugins`;
`powerMovesStore` (52 L) → `features/home`; `resourcePickerStore` (60 L) → `features/vault`.
**The one real deviation is `plugins/companion/companionStore.ts` — 1,402 lines, 150
subscription sites, consumed from 7 different feature directories plus `src/lib`.** That is a
domain store by every measure, living outside `storeTypes.ts`, outside `CoreState`, outside
`reportError`, and outside the store test doctrine.

*(Its `persist()` configuration is [`client-state-persistence`](./client-state-persistence.md) §F's
finding, not this one's — noted here only because the two paths converge on the same file.)*

### F — documentation defect: two named exemplars that do not exist

`.claude/CLAUDE.md:112` reads: *"`globalThis` for singletons surviving HMR (executionBuffers, eventBus)"*.

- **`executionBuffers` does not exist.** The identifier appears **nowhere in the repo** except
  in `CLAUDE.md` and in four comments citing it as precedent. The real object is
  `executionSink` (`src/lib/execution/executionSink.ts:339`), and it is
  `export const executionSink = new ExecutionSink()` — **a plain module const, not on
  `globalThis`, and therefore not HMR-surviving at all.** Only the dev-only *probe function*
  `__executionBufferProbe__` is hung on `globalThis` (`executionSlice.ts:199`).
- **`eventBus` is misnamed.** The real singleton is `globalThis.__personasEventBridge`
  (`eventBridge.ts:142`).

**Four files have copied the wrong names into their own doc comments as justification** —
`stores/slices/system/tourSlice.ts:1060`, `lib/silentFailureTelemetry.ts:17`,
`features/plugins/fleet/fleetTerminalManager.ts:31`,
`hooks/utility/interaction/useScrollRestoration.ts:37`. The convention itself is real and
sound (7 correct `globalThis` singletons), and each of those four implements it correctly —
but every one of them cites a precedent a reader cannot open. **Fix `CLAUDE.md:112` to name
`__personasEventBridge` and `fleetTerminalManager`'s registry, then correct the four
citations.**

### G — derived state stored, and selector duplication

- **162 distinct selector bodies appear in 3 or more separate files**, covering **1,151** of the
  2,290 subscriptions. The extremes: `useToastStore((s) => s.addToast)` in **114 files**,
  `useAgentStore((s) => s.personas)` in **68**, `useSystemStore((s) => s.setSidebarSection)` in
  **43**, `useVaultStore((s) => s.credentials)` in **36**. Most are correct and should stay
  inline — a property access needs no abstraction. But `src/stores/selectors/` holds only
  **3 modules**, and `selectActiveAlertCount` has **1** consumer, so the shared-selector
  directory is effectively unused for the cases that would benefit.
- **133 loading/error field declarations** across the slices, with `networkLoading` alone
  declared 35 times. Every domain re-derives the same `<thing>Loading` / `<thing>Error` /
  `<thing>` triple by hand. Not wrong — but it is the strongest signal that a
  `createAsyncField()` slice helper is missing (Gaps #4).

## Gaps in the primitive

1. **Zustand cannot type a selector's return *shape*.** `useStore(selector)` accepts any
   `(s: T) => U`; nothing at the type level distinguishes `U` that is a stable reference from
   `U` that is freshly allocated. This is the root reason deviations A and B can exist at all,
   and it is a genuine library limitation, not laziness.
2. **No writer-side reference-preservation primitive.** `stores/util/` has `latestWins.ts` and
   `dedupedStorage.ts` and nothing for "replace this array only if its contents actually
   changed" — so all 44 slices that patch collections re-derive identity handling by hand, and
   the fetch actions do not handle it at all. **Fix: `stores/util/preserveIdentity.ts` —
   `replaceIfEqual(prev, next, keyFn)` returning `prev` when the id sequence and per-item
   equality hold.** This is the single change that would retire all 15 of deviation A. The
   sibling `personas-web` has already written half of it (see Convergence).
3. **`StateCreator<Root, ...>` gives every slice `get()` over the entire root store.** There is
   no boundary: any of `systemStore`'s 18 slices can read and depend on any other's state. 22
   cross-slice `getState()` calls exist inside `src/stores/` today. The type parameter that
   makes registration safe is the same one that makes isolation impossible.
4. **No async-field helper.** 133 hand-written loading/error field triples (deviation G). A
   `createAsyncField<T>()` returning `{ data, loading, error, fetch }` with `reportError` and
   `latestWins` pre-wired would remove the most-repeated 20 lines in the slice corpus.
5. **One root store means one notification fan-out.** Every `set()` in any of `systemStore`'s
   18 slices runs all **1,150** of its subscription selectors. Each is cheap (a property read
   plus `Object.is`) and the repo's discipline keeps it cheap — but the cost is O(subscriptions),
   not O(subscribers-who-care), and zustand offers no per-slice scoping to fix it.
6. **`useShallow` is structurally unable to help across an IPC boundary.** Deserialized payloads
   have all-fresh object identities, so no reader-side equality check can ever match. Any
   solution must live in the writer. This is why deviation A is a *shape* problem, not a
   *discipline* problem.
7. **No test asserts the subscription contract.** The store tests (excellent as they are) test
   *actions and state*; nothing tests that a selector is reference-stable, so a regression in
   `parseDesignContext`'s LRU would silently degrade 14 call sites with every suite green.

## Prefer a type over a gate — answered

**Partially yes, and the half that is already typed is the proof.**

The **slice-registration** half is already unrepresentable-when-wrong, and it works: because
`StateCreator<Root, [], [], Slice>` names the root store, and because `storeTypes.ts` builds
each root as an intersection of slice interfaces, you cannot ship a slice whose fields are not
in the store's type, and you cannot add the interface without the compiler demanding the
creator. Measured result: **55 of 55 slices correctly registered, 0 drift.** Contrast
[`client-state-persistence`](./client-state-persistence.md), where the same repo answers a
convention question with prose and gets 89 private key constants and 8 competing prefixes.
**No gate is needed or proposed for slice registration** — the type already holds the line, and
adding a check script would be the museum-piece kind of gate that runs green forever.

The **subscription** half cannot be made fully unrepresentable — see Gaps #1; zustand's
`selector: (s: T) => U` accepts any `U`. But the most valuable sub-case *can*: **a derived
value read from more than one place should be exported as a named hook whose producer
memoizes**, because then no call site is able to allocate. `personaSelectors.ts` already does
this and both sibling repos converged on the same move independently. So the fix order is:
**(1)** ship `replaceIfEqual` (Gaps #2) so writers stop churning; **(2)** move any derived read
into `stores/selectors/` as a memoized hook; **(3)** keep the census rule below only as the
ratchet that stops deviation A regrowing while (1) and (2) land. The gate is the least of the
three, and it is scoped accordingly.

## The missing gate

**The condition being proxied** (stack-free, so an adopting repo can re-derive its own signal):
*subscription-side compensation for writer-side identity churn* — a component asking the
framework to compare a value more cheaply, when the real defect is that the producer replaced
the reference needlessly. In this stack it wears the syntax `useShallow((s) => s.prop)`. In a
Context-based stack it would wear `useMemo` around a context value; in a signals stack it would
wear an `equals:` option on a plain passthrough. **Re-derive the signal for your idiom; do not
port the regex.**

**Not already covered.** All 41 rules in `scripts/census/rules.json` were checked: none touches
zustand, stores, slices, selectors, or subscriptions. The nearest neighbour,
`hand-rolled-stale-token`, gates the fetch-sequence guard inside slices — a different condition,
already owned by [`stale-response-guard`](./stale-response-guard.md).

**Signal.** `useShallow(` whose arrow body is a bare property/index-access chain, terminated by
the closing paren — so an object literal (`=> ({`), an array literal (`=> [`), a block body
(`=> {`) and a derived call (`=> s.x.filter(...)`) all fail to match, because the character
after `=>` must begin an identifier and the chain must close the call.

```json
{
  "rules": [
    {
      "id": "shallow-wrapped-property-selector",
      "goldenPath": "docs/concepts/golden-paths/zustand-domain-slices.md",
      "title": "useShallow wrapping a selector that constructs nothing",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "useShallow\\(\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>\\s*[A-Za-z_$][\\w$]*(?:\\??\\.[\\w$]+|\\[[^\\]]*\\])*\\s*\\)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "useShallow() wrapping a selector whose body is a bare property-access chain. It constructs nothing, so the shallow compare can only ever be a workaround for a slice that replaces a collection reference whose contents are unchanged — and when the collection is refetched over IPC, every element is a fresh object and the compare can never match. PROXY FOR the stack-free condition: subscription-side compensation for writer-side identity churn. The fix is in the writing slice; see Gaps #2."
      },
      "baseline": { "files": 10, "matches": 14 },
      "floor": 4000
    }
  ]
}
```

**Mechanism.** The shared census runner (`npm run census` / `census:check`). No new script:
the ratcheting-baseline mechanism this needs is exactly what `scripts/census/` already
implements.

**Allowlist — empty, deliberately.** No `exclude` entry is proposed. Every one of the 14
matches is a genuine instance of the condition, so an exemption today would be a stale
exemption tomorrow — and the runner fails a rule whose `exclude` matches nothing, so an
empty allowlist is safer than a speculative one. `useTeamChannel.ts:114` — the one arguably
legitimate site — is **already outside the pattern** (its `?? EMPTY_CHANNEL` tail prevents a
match), so it needs no exemption.

**Validation performed.** Run standalone against the engine (`scripts/census/lib/engine.mjs`)
with the pattern **in a file, never through bash argv** — passing a regex through argv on this
machine mangles backslashes under MSYS.

| Case | Result | Exit |
|---|---|---|
| Baseline scan, `src`, 4,829 files walked | 10 files / 14 matches | — |
| Control: untouched corpus vs baseline | reproduces **exactly** | **0** |
| Fault A: one new violation added | `drift/rose` ×2, "files rose 10 → 11" | **1** |
| **Positive control 1:** violation rewritten to the compliant **bundle** form `useShallow((s) => ({ sessions: s.fleetSessions }))` | `drift/dropped` ×2 | **1** |
| **Positive control 2:** violation rewritten to the real fix — `useShallow` removed | `drift/dropped` ×2 | **1** |
| Positive control 2b: same fix **with** baseline ratcheted to `{9,13}` | clean | **0** |
| Fault B: floor unmet (matcher broken) | `structural/floor` — "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN" | **1** |
| Fault C: signal matches zero files anywhere | `structural/zero-matches` | **1** |
| Comment prose containing the exact pattern | **not counted** — 14 matches unchanged | **0** |

**The positive control is the load-bearing row.** Both compliant rewrites — the bundle form
*and* the removal — drop the count and therefore **fail** the run until the baseline is
ratcheted. That is what proves the matcher discriminates on the selector's *shape* rather than
merely matching the token `useShallow`: a rule that keyed on the token alone would still match
the bundle form and report no change.

**Populations and overlap.** The census signal finds **14 matches / 10 files**. An independent
TypeScript-AST classification of all 2,290 subscriptions finds **15** `useShallow`-over-a-stable-reference
sites. **Overlap: 14 — every census match is an AST match (precision 1.00); the AST finds one
the census misses (recall 0.93), `useTeamChannel.ts:114`, whose `?? EMPTY_CHANNEL` tail the
pattern deliberately does not cross.** The two implementations were built independently, which
is the cross-check the engine's own multiline-comment caveat asks for. The AST pass also
found two things the regex got *wrong* and that are worth recording: both apparent
"whole-store subscriptions" (`MessagingPickerShared.tsx:8`, `KeyboardNavMode.tsx:10`) are
**prose inside comments** — the same 35%-comment failure that corrected `raw-web-storage` from
430 to 186 — and all seven apparent "unstable derived selectors" return **primitives**
(`.filter(...).length`, `.some(...)`), which `Object.is` compares equal, so they cost CPU but
never a render.

**How it fails loudly when its own precondition is absent.** Inherited from the census runner
and verified above by injection, not assumed: `floor: 4000` against 4,829 walked files means a
moved root or a changed extension list is a **structural** failure, not a clean report
(Fault B); a signal that matches nothing anywhere is a structural failure with an explicit
"delete the rule rather than baseline it at zero" message (Fault C); and a **drop** without a
baseline update fails exactly as loudly as a rise (both positive controls). Surviving counts
print on success, so a build log distinguishes a clean run from one that checked nothing.

**What this gate does NOT catch, stated so the next reader does not over-trust it.** It is
blind to deviation B (the `?? []` allocating selector — 2 sites, no shared syntax with this
signal), to deviation C (`setState` from components), and to the underlying writer-side churn
that is the actual defect. It counts symptoms at the reader. If Gaps #2 lands and the writers
stop churning, this rule should be **deleted**, not baselined at zero.

## Convergence — the portability oracle

Three siblings were read. **The result contradicts the most obvious framing of this path, and
that is reported first.**

- **`personas-cloud`** — **no signal, and the brief's premise here is wrong.** It is a headless
  Cloudflare-worker monorepo (`dac-cloud`, workspaces `shared`/`orchestrator`/`worker`) with
  **zero `.tsx` files** and no React or zustand dependency anywhere. It cannot speak to client
  state. Verified directly, not delegated.
- **`brainiac/console`** (Next.js) — **zustand absent; Context absent; `useReducer` absent.**
  Zero `createContext`, zero `.Provider`. Domain state lives in the **URL**, parsed on the
  **server**: 14 `app/console/modules/*/Module.tsx` are async server components, none carrying
  `"use client"`, each handing one `data` prop to one client component. Its own comment
  (`memories/Module.tsx:38`) states the doctrine: *"The URL is the single source of truth."*
  Zero `useShallow`, zero `React.memo`, zero `useSyncExternalStore` — **nobody has felt
  re-render pain**, because there is no shared client store to over-subscribe to. This is the
  strongest form of "prefer a type over a gate": the problem was **deleted by architecture**
  rather than solved.
- **`personas-web`** (Next.js) — **uses zustand (12 stores) but has ZERO slice composition.**
  `StateCreator` returns **0 matches** across its entire `src/`. Every store is flat and
  single-purpose; the domain boundary is a *filename*, not a type parameter.

**So the slice-composition pattern is NOT convergent. It is a house convention of this
desktop app, and this path marks it as such** — per the contract, a clause with no trace
elsewhere should be suspected of local calibration rather than physics. In fairness it is
*load-bearing* local calibration: 55 slices across 5 root stores is a scale `personas-web`
(12 flat stores) never reaches, and the flat approach has a measurable cost there —
`personas-web/src/lib/clearUserCaches.ts:27-40` is a hand-maintained list of 6 stores to reset,
with a comment explaining it lives outside the stores to avoid an import cycle, and nothing
enforces that store #13 gets added. That is precisely the drift the intersection type in
`storeTypes.ts` prevents. **Keep the slice pattern; stop describing it as universal.**

**What IS convergent — and it is the writer-side fix, not the reader-side one.** Both sibling
codebases that kept client state arrived independently at *producing a stable reference*:

- `personas-web/src/stores/personaStore.ts:93,:128-130` — an `arraysEqual` guard that
  **preserves the previous array reference when the id order is unchanged**, with the comment
  *"so `useSortedPersonaIds()` consumers don't re-render on refetch"* — and
  `optimisticUpdatePersona` (`:155-167`) deliberately leaving `personaIds` untouched.
- `personas-web/src/stores/personaStore.ts:9-12` — normalized `personasById` +
  reference-stable `personaIds`, so a coarse subscription is **not expressible**: a list
  iterates ids and each card calls `usePersona(id)`.
- `personas-web/src/stores/executionStore.ts:43-52` — `activeCount` pre-aggregated in the
  *writer* so the nav badge can subscribe to a primitive, with the failure it prevents written
  out: *"every list mutation — including unrelated field edits — would re-render the nav."*
- **This repo's own `stores/selectors/personaSelectors.ts:6-15`** — the same idea, reached
  independently, via a memoizing producer instead of a writer-side guard.

Three independent rediscoveries of "make the producer return a stable reference" is the
strongest evidence in this document. **Gaps #2 is therefore physics, not taste** — and it is
the one item in this path that should be built rather than merely policed.

**A convergent idiom that is a shared trap — flagged.** `personas-web` ships an ESLint rule,
`custom-zustand/no-multi-zustand-selector`, whose message reads *"Component calls {{name}}
{{count}} times. Collapse into a single useShallow selector to avoid duplicate
subscriptions."* **That advice is backwards, and if it were adopted here it would flag this
repo's dominant and correct idiom** — 2,160 narrow property selectors — and push them toward
the allocating bundle form this path's Anti-patterns section warns against. N narrow selectors
allocate nothing and compare by `Object.is`; one `useShallow` bundle allocates an object per
notification and then walks N keys. The sibling's own configuration quietly concedes the point:
the rule is scoped to **1 of its 12 stores** and set to `warn`. **Do not adopt it. Do not
mirror it.**

**The transplantable mechanism, from the sibling that solved the problem best.**
`brainiac/console/src/design/focus-contract.test.ts:1-61` is a source-scanning conformance
**test** — it walks every `.tsx` in 11 directories and fails unless a violation is on an
allowlist that **requires a written reason string**, with the header *"the fix is almost never
to widen the allowlist."* Aimed at focus rings there; it is the exact shape a state-placement
conformance check would take if Gaps #2 lands and someone wants to assert reference stability
in CI (Gaps #7). **A caution earned by reading it, though:** the same repo's neighbouring
drift guard (`routes.ts:226-227`) *claims* the test compares its registry against the modules'
actual readers, and `routes.test.ts:142-148` does no such thing — it asserts a property the
`Record<ConsoleModuleId, …>` type already guarantees, which is close to a tautology. Its
`decodeAddress`/`encodeAddress` grammar has **zero production call sites**. A conformance test
is only as good as the condition it actually evaluates, and a comment claiming otherwise is
worse than silence.

## Severity note

The census rule is a **ratchet, not an error-level lint rule**, and this path deliberately does
not argue for `"error"` anywhere. Per `.claude/CLAUDE.md`, `npm run check` runs `eslint src/`
with no `--max-warnings` and the pre-commit hook runs `--quiet`, so **a warn-level rule
enforces nothing at either gate, at any warning count**. That is an argument about the gates'
construction, not about volume — the 1,135-warning baseline
([`shared-facts.json`](../shared-facts.json) `lint.warnings`) is not evidence for or against any
severity. `npm run census:check` is a separate exit-1 gate and is where this belongs.
