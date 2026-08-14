# Golden path — HMR-safe singletons

> Situation node: `client-runtime/state-management/hmr-safe-singletons` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `4d515e9ac`, from a TypeScript-AST pass over all
> **4,829** `.ts`/`.tsx` files ([`shared-facts.json`](../shared-facts.json) `frontend.tsFiles`)
> classifying every module-scope binding by mutability, assignment direction and `globalThis`
> residency; cross-checked by a second independent implementation (regex over whole-file
> content, run through `scripts/census/lib/engine.mjs`) that agreed on **13 of 13**; plus ~45
> files opened directly and two sibling-repo convergence oracles.
> Dimensions: **resilience · code-quality · performance · function**.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

**Boundary with [`zustand-domain-slices`](./zustand-domain-slices.md).** That path owns *store*
state — what a slice is, how it registers, how a component subscribes. This path owns state that
is **not** in a store: bindings at module top level, and the `globalThis` slots a few of them are
parked on. They meet where a slice happens to own a global (`tourSlice`'s four keys,
`fleetSlice`'s listener flag) — the slice's *shape* is that path's call; whether its global slot is
justified is this one's. **Do not read this document to decide where a field lives.**

**Boundary with [`client-state-persistence`](./client-state-persistence.md).** That path owns
*durability across process restarts* — `app_settings`, `persist()`, localStorage. This path owns
*survival across module re-evaluation inside one running process*. The two are frequently
confused and the confusion is expensive: `globalThis` survives an HMR update and **does not
survive a reload** (§Gaps 1), while localStorage survives a reload and knows nothing about HMR.
If the value must outlive the window, you are in that path, not this one.

---

## Trigger

- "This resets every time I save a file" / "my counter goes back to zero when I edit"
- "Why do I have two listeners after a hot reload?" / "the handler fires twice in dev"
- "Should this be on `globalThis`?" / "does this survive HMR?"
- "Where do I put state that isn't in a store and isn't a component's?"
- "I need this to initialise exactly once"
- "This is fine in production, it only misbehaves in dev"

If you are about to type `let <x> = false;` at the top of a module, `globalThis.__something`,
`declare global { var … }`, `import.meta.hot`, or a top-level `new Map()` that something will
mutate — you are in this situation.

## The one way

**Ask what a second live copy of this module would do, and let the answer pick the mechanism —
do not start from `globalThis`.** If a second copy would merely recompute a value, re-fetch, or
re-warm a cache, then module scope is already correct and hoisting to `globalThis` is a
liability, not a fix; leave it alone. You have a real problem only when a second copy would
**install a second registration on an object that outlives the module** — a `document`/`window`
listener, a monkey-patch, a `<style>` node, a Tauri `listen()`, a process-lifetime registry — or
**repeat a write the user can observe**. That shape is a **latch**: a flag that goes `false → true`
and never comes back, guarding something that is never released. Fix it in this order. **(1)
Delete the need** by making the resource *refcounted* — acquire on first subscriber, release on
last — so the old copy's subscribers drain to zero and the old resource frees itself; this
self-heals under HMR *and* under unmount, costs no global namespace, and is what
`relativeTimeTicker.ts` and `relativeAgo.ts` already do correctly. **(2) If the resource genuinely
must be long-lived, make the stale copy inert rather than preventing it** — hold a `generation`
counter, capture it when you schedule work, and drop any callback whose captured generation no
longer matches, which is what `ExecutionSink` does and is why it needs no global at all. **(3)
Only when neither works — the registration cannot be released and cannot be re-created — park the
state in exactly one `globalThis` slot**, keyed with `Symbol.for()`, typed through `declare
global`, initialised with `??=`, carrying a comment that names the failure it prevents, and
exporting a `__reset<Name>ForTests()` in the same edit. **Never reach for
`import.meta.hot.dispose`**: it is the API this problem is documented to have, and three
independent codebases have now considered and declined it (§Convergence).

## Mandated primitives

There is no shared primitive for this today — that is [Gaps #4](#gaps-in-the-primitive), and the
single most valuable thing to build off this document. Until it exists, these are the four real
in-repo mechanisms, in the order §The-one-way prescribes:

- **Refcounted acquire/release — `src/hooks/utility/timing/relativeTimeTicker.ts:44-83`.**
  `const subscribers = new Set<Subscriber>()` plus `reschedule()` (`:63`), which
  `clearInterval`s and nulls the handle the moment `smallestCadence()` is not finite — i.e. when
  the last subscriber leaves. **This is the correct default and it needs no global.**
  `src/features/plugins/fleet/relativeAgo.ts:15-30` is the same shape in eight lines
  (`if (tickListeners.size === 0 && tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }`).
- **Generation token — `src/lib/execution/executionSink.ts:110,:154,:175,:211-215,:262-266,:305-309`.**
  `private generation = 0`; `reset()` (`:154`) and the teardown path (`:175`) increment it; every
  scheduled flush captures `const gen = this.generation` and returns early when
  `gen !== this.generation`. The consumer completes the pattern at
  `src/stores/slices/agents/executionSlice.ts:189-192` — `executionSink.reset()` then
  `executionSink.bind(...)`, commented *"On HMR / store recreation, re-binding automatically
  invalidates stale flushes."* **This is the object `CLAUDE.md` used to misname `executionBuffers`
  and claim was a `globalThis` singleton. It is the opposite: a plain module const that solves the
  problem without one, and it is the better answer.**
- **`declare global` + `??=` slot — `src/lib/eventBridge.ts:130-146`. Copy this one** when you get
  to step 3. It is the only slot in the repo that does all four things: a `declare global` block
  (`:130-135`) so the key is typed and discoverable, a comment naming the exact failure
  (*"The module local `attached` flag resets under HMR, but Tauri listeners remain active until
  their unlisten functions are called"*), `globalThis.__personasEventBridge ??= {…}` (`:142`) so
  initialisation is idempotent, and the module-local mirror kept in sync on both edges
  (`:1054-1055`, `:1234-1235`). *(The local `attached` flag at `:148` was checked by
  [`zustand-domain-slices`](./zustand-domain-slices.md) and is correctly synced — do not re-raise it.)*
- **`__reset<Name>ForTests()` — `src/lib/polling/pollingCoordinator.ts:279-283` and
  `src/lib/silentFailureTelemetry.ts:134`.** Any module-scope or global singleton that survives a
  module reload also survives a *test file*, so it needs an explicit reset export. **9 modules in
  the repo export one; only 2 of the 8 `globalThis` owners do** (§Deviations D).

**Do NOT reach for:**

- **`import.meta.hot.dispose` / `.accept`** — **zero uses in 4,829 files, and zero anywhere in the
  repo's code.** Not an oversight; see §Gaps 2 and §Convergence.
- **A `persist()` store or localStorage** to "keep it across reloads" — different problem, wrong
  path ([`client-state-persistence`](./client-state-persistence.md)).

## Steps

1. **Write the state at module scope first.** Most of it belongs there and stays there: 204
   module-scope containers and 200 module-scope `let`s exist in production code, and the
   overwhelming majority are correct.
2. **Ask the only question that matters: what does a *second live copy* do?** Recompute → stop,
   you are done. Install / append / patch / subscribe / write → continue.
3. **Try refcounting before anything else.** Can the resource be acquired on the first subscriber
   and released on the last? If yes, do that and stop — the HMR problem disappears as a side
   effect of correct lifecycle, and you also fix the unmount case nobody tested.
4. **If it must be long-lived, try a generation token.** You are not obliged to *prevent* a stale
   copy; making its callbacks no-op is usually cheaper and always more testable.
5. **Only now consider a `globalThis` slot.** Justify it in a comment by naming what duplicates
   without it. "So it survives HMR" is not a justification — it is a restatement.
6. **If you do take a slot: key it with `Symbol.for('personas.<module>.<what>')`,** not a string
   property. A `Symbol.for` key lives in the global symbol registry, cannot be reached by a
   dependency doing `for (const k in globalThis)`, and cannot silently collide with a string key
   of the same name. *(This is the sibling repo's mechanism, not this repo's — see §Convergence.)*
7. **Type it.** `declare global { var __x: T | undefined }` where the key is a plain identifier;
   a local `typeof globalThis & { [K]?: T }` intersection where it is computed. Never
   `globalThis as Record<string, unknown>` — that cast is what lets two modules claim one key.
8. **Initialise with `??=`, never `if (!g.x) g.x = …` split across two statements** unless you
   also set a sentinel eagerly against re-entrancy the way
   `fleetTerminalManager.ts:204-206` does.
9. **Export `__reset<Name>ForTests()` in the same edit.** Not a follow-up. A global without one
   makes every test that touches it order-dependent, and the repo already has two test files
   poking `globalThis` by hand because a slice skipped this step.
10. **Do not add an `import.meta.env.DEV` guard, and do not omit one by accident** — decide. All
    13 state slots currently ship to production unguarded (§Deviations C). That is defensible for
    a slot that also prevents *production* double-init (React StrictMode, a remounted root); it is
    not defensible for a dev probe. `executionSlice.ts:198` gets this right.
11. **Stop.** No `import.meta.hot`. No second slot for the same concern. No slot for a cache.

## Anti-patterns

- **`let installed = false;` at module scope, guarding a listener that is never removed.** The
  defining defect of this leaf, and the reason a second copy is *silently additive* rather than
  loudly broken: nothing throws, nothing logs, the listener count just goes up by one per edit
  and every handler runs twice, then three times. `src/lib/documentVisibility.ts:14` is the
  cleanest instance — 33 lines, `document.addEventListener('visibilitychange', notify)` at `:18`,
  **zero `removeEventListener` in the file**, and the subscriber-facing unsubscribe at `:29-31`
  only deletes from a `Set` the dead copy no longer owns.
- **Hoisting a *cache* to `globalThis`.** A cache losing its contents costs one recompute. Putting
  it on a process-global buys nothing, adds a name nobody registers, and makes every test that
  reads it order-dependent. `__personasScrollPositions__`
  (`useScrollRestoration.ts:39-42`) is a `Map<string, number>` of scroll offsets: if it were lost,
  a list would start at the top once.
- **`globalThis as Record<string, unknown>`.** Erases the one thing that could prevent a
  collision. **8 of the repo's 13 state keys are reached this way**, across four incompatible
  naming conventions (`__personasX`, `__personasX__`, `__fleetX__`, `__personas_x__`) with no
  registry — structurally the same disease
  [`client-state-persistence`](./client-state-persistence.md) §D diagnoses for localStorage keys
  (89 private constants, 8 prefixes), one namespace over.
- **Justifying a global by citing another global instead of naming the failure.** Four source
  comments cite `executionBuffers` — an identifier that has never existed — as precedent
  (§Deviations A). A comment that points at a neighbour instead of at a consequence cannot be
  checked, so it decays into folklore and propagates by copy-paste.
- **`import.meta.hot.dispose(() => cleanup())` as the "proper" fix.** It only runs when the module
  is inside an accepted HMR boundary chain; it does nothing on the full page reload Vite falls
  back to when no boundary accepts; it is dead-code-eliminated in production, so it cannot also
  fix the StrictMode double-invoke the same code has; and it puts the teardown in a place no test
  can reach. Zero adoption here, zero in both siblings, one explicit documented rejection
  (§Convergence).
- **A module-scope latch guarding a *backend write*.** `useFavoriteAgents.ts:16` guards a
  one-time localStorage→DB favorites migration; a reset re-runs it. `activation.ts:136` guards a
  referral credit. When a latch protects a side effect outside the process, its reset is not a
  dev annoyance — it is a data event.
- **Assuming `globalThis` survives a reload.** It does not: a reload builds a new realm. There are
  **6 `location.reload()` sites** in `src/`, one of them the `ErrorBoundary`'s recovery path
  (`ErrorBoundary.tsx:109`). Any state you park on `globalThis` is gone across it.
- **A slot with no `__reset*ForTests`.** `tourSlice`'s four keys have none, so
  `tourSlice.test.ts:36-38` and `dynamicTours.test.ts:52` reach into `globalThis` and set four
  properties to `undefined` by hand — the test suite re-implementing a teardown the module owed it.
- **Adding a global to fix a *component* remount.** Component-instance state that survives a
  remount is a `useRef` in a parent, a store field, or a module cache — three answers that all
  scope better than a process-global.

## Evidence

**Adoption.** `globalThis` is touched at **25 distinct property keys** across `src/`. Only
**13 are state slots**; the other 12 are correctly *not* singletons — feature detection on
standard globals (`requestIdleCallback`, `cancelIdleCallback`, `crypto`), build-time defines
(`__VITE_PLATFORM_ANDROID__`, `__VITE_PLATFORM_IOS__`), harness plumbing (`__IPC_TOKEN`,
`__TEST_FORCE_DRAFT__`), the DEV-only probe `__executionBufferProbe__`, and 4 keys used only in
tests. The 13 state keys have **8 owner modules**:

| Owner | Key(s) | Holds | Typed by |
|---|---|---|---|
| `lib/eventBridge.ts:142` | `__personasEventBridge` | `{attached, retryGeneration, unlisteners[]}` — Tauri unlisten handles | `declare global` `:130-135` |
| `lib/polling/pollingCoordinator.ts:274` | `__personasPollingCoordinator` | the coordinator instance | local `typeof globalThis &` `:268` |
| `features/plugins/fleet/fleetTerminalManager.ts:170,:182,:205` | `__fleetTerminalRegistry__`, `__fleetTerminalParked__`, `__fleetTerminalOutputListener__` | live xterm instances, an LRU, one shared `listen()` unlisten | cast |
| `stores/slices/system/tourSlice.ts:1015,:1085,:1107,:1129` | `__personasDynamicTours`, `…TourStorageProbed`, `…Available`, `…ToastShown` | a tour Map + a storage-probe result + a toast-once flag | `declare global` `:1010-1066` |
| `lib/silentFailureTelemetry.ts:63` | `__personasSwallowTracker__` | swallow counters | cast |
| `hooks/utility/interaction/useScrollRestoration.ts:39` | `__personasScrollPositions__` | `Map<string, number>` of scroll offsets | cast |
| `stores/slices/system/fleetSlice.ts:80` | `__personasFleetSessionListeners` | `{started, unlisten[]}` | cast (typed alias) |
| `api/companion.ts:36` | `__personas_companion_init__` | an in-flight init promise | cast |

*(This is **8** owners, not the 7 [`zustand-domain-slices`](./zustand-domain-slices.md) §F
reported — `src/api/companion.ts:36` was missed there. Its comment at `:21-31` is otherwise one of
the two best in the set, naming three distinct duplicate-init sources: StrictMode double-effects,
HMR re-evaluation, and component remounts.)*

**Module-scope population, production files only** (AST; test files excluded):
**200** `let` declarations · **204** `Map`/`Set`/`WeakMap`/`WeakSet` (**101** mutated after init) ·
**11** class instances · **4** mutated array literals · **87** `let`s holding a timer/handle/
unsubscribe (all reassigned; **39** in files that also register an external handle) · **34**
boolean flags, of which **13** are one-way latches.

- **`src/hooks/utility/timing/relativeTimeTicker.ts:44-83` — copy this one.** The best answer in
  the repo to the whole leaf, and it never mentions HMR. One shared `setInterval` for every
  relative-time label in the app, acquired on the first subscriber and released the moment the
  last one leaves. Under HMR the old module's subscribers unmount, its cadence set empties,
  `reschedule()` clears its interval, and the orphan collects itself. **A refcounted resource is
  HMR-safe for free; a latched one never is.** `relativeAgo.ts:15-30` is the compact version.
- `src/lib/execution/executionSink.ts:110,:211-215` + `stores/slices/agents/executionSlice.ts:189-192`
  — the generation-token answer, with the re-bind comment that states the mechanism.
- `src/lib/eventBridge.ts:130-146` — the `globalThis` slot done properly; the model for step 3.
- `src/api/companion.ts:21-31` — the best *justification* comment: it enumerates what duplicates
  (parallel `companion_init` invocations, "each of which spawns its own background doctrine
  ingest") rather than restating that HMR exists.
- `src/features/plugins/fleet/fleetTerminalManager.ts:198-206` — the re-entrancy detail worth
  copying: the slot is set to `true` *eagerly*, before the `await`, so a second call during
  registration cannot double-listen; the real unlisten replaces it on resolve and is cleared on
  failure so a retry is possible.
- `src/lib/polling/pollingCoordinator.ts:279-283` — the reset hatch, which also `destroy()`s the
  outgoing instance instead of just dropping the reference.

**Cleared, not defects** *(checked and found sound — do not raise these)*: `relativeTimeTicker`
and `relativeAgo`'s module-scope interval handles **self-heal** by refcount. `callbackTracker.ts`,
`appearanceMirror.ts` and `useObsidianVaultRehydration.ts` look like latches but each has a real
release path, so their flags are two-way state, not latches. `eventBridge.ts:148`'s local
`attached` flag is correctly mirrored on both edges. And the suspected classes this sweep went
looking for came back empty: **0** module-scope `addEventListener`/`setInterval` executed at
import time in production code (the one top-level side-effect call is in `src/test/setup.ts`), and
**0** state slots that a full reload was assumed to survive.

## Deviations found

### A — four comments cite an identifier that has never existed (4 sites)

`executionBuffers` appears in the tree **6 times: twice in documentation and four times in source
comments.** No declaration, no export, no import — the identifier has never existed.

| Path | Text |
|---|---|
| `src/features/plugins/fleet/fleetTerminalManager.ts:31` | *"same pattern as executionBuffers / eventBus elsewhere in the app"* |
| `src/hooks/utility/interaction/useScrollRestoration.ts:37` | *"mirrors the executionBuffers / eventBus singletons"* |
| `src/lib/silentFailureTelemetry.ts:17` | *"same pattern as executionBuffers / eventBus"* |
| `src/stores/slices/system/tourSlice.ts:1060` | *"used elsewhere (executionBuffers, eventBus)"* |

All four implement the pattern **correctly**; each justifies itself by pointing at a neighbour a
reader cannot open. The real objects are `executionSink` (`executionSink.ts:339`) — which is a
plain module const and deliberately *not* on `globalThis` — and `__personasEventBridge`
(`eventBridge.ts:142`).

> **Correction to the brief that commissioned this path, and to `CLAUDE.md`.** Both say *three*
> source comments. It is **four**: `fleetTerminalManager.ts:31` is missing from both counts.
> `git grep -n executionBuffers -- 'src/**/*.ts'` returns three because git's `src/**/*.ts`
> pathspec silently drops files with no intermediate directory; the file was also missed by the
> `Grep` tool for an unrelated reason. See §Gaps 7.
>
> Also: **`.claude/CLAUDE.md:112` has already been fixed** in the working tree at `4d515e9ac`. The
> brief describes it in the present tense; that is now history. **The four source comments are
> what remains, and they are the live defect** — fixing the doc while leaving four files citing
> it is how the fiction survives its own correction.

### B — one-way latches in module scope (13 sites; 6 are real hazards)

The census population. All 13 are the same shape — a module-scope `let x = false` that becomes
`true` and never returns. What differs is what the latch is *protecting*, and only that decides
whether a second copy is additive or merely wasteful.

**Tier 1 — a second copy installs a second permanent registration (4).**

| Path | What duplicates |
|---|---|
| `src/lib/documentVisibility.ts:14` | `document.addEventListener('visibilitychange', notify)` (`:18`), **never removed** — the file contains zero `removeEventListener`. Each re-evaluation adds one permanent listener bound to a `Set` the live code no longer references. Its three consumers are `useDocumentVisibility.ts:9`, **`executionSink.ts:282,:325`** and **`pollingCoordinator.ts:82`** — i.e. the un-hoisted latch sits directly beneath both the object the fiction misnamed and a genuine `globalThis` singleton. |
| `src/lib/storeBusWiring.ts:18` | `initStoreBus()` registers **14** `storeBus.on(…)` / `.provide(…)` entries (`:28-…`) with no deregistration path; loaded via a dynamic `import()` at `App.tsx:188`. A second copy means every cross-store event runs twice — double toast, double nav-history push, double activation milestone. |
| `src/features/templates/sub_generated/shared/ThinkingLoader.tsx:25` | `document.head.appendChild(style)` (`:31`), never removed — duplicate `<style>` nodes accumulate in `<head>`. This repo has already lost time to a WebView2 freeze traced to style re-injection. |
| `src/lib/throttledStorage.ts:23` | installs a `pagehide`/`beforeunload` flush hook. Currently inert *only* because the module has **zero call sites** ([`client-state-persistence`](./client-state-persistence.md) §G) — a latent duplicate the moment anyone wires it. |

**Tier 2 — a second copy repeats a write outside the process (2).**

| Path | What repeats |
|---|---|
| `src/hooks/agents/useFavoriteAgents.ts:16` | the one-time localStorage→DB favorites import (`:28`). |
| `src/lib/analytics/activation.ts:136` | a referral credit. *Mitigated, honestly:* the comment at `:139-143` records that the cloud dedupes on install id and that the flag is latched only on success. Listed for completeness, not as a bug. |

**Tier 3 — a second copy recomputes; not defects, listed so the count is auditable (7).**
`fleetGridView.ts:25` (remembered view choice) · `memoryActions.ts:29` (report-corruption-once) ·
`LifecyclePage.tsx:36` (warm-remount cache) · `workspaceStore.ts:52` (hydrate-once) ·
`CloudSyncPanel.tsx:28` (connection-checked-once) · `tauriInvoke.ts:431` (stampede warn-once) ·
`main.tsx:87` (Sentry ready — and the entry module is the least exposed of all, since a change
there forces a full reload).

**The gate counts the shape (13); this table classifies the harm (6). Both numbers are real and
they answer different questions** — see §The missing gate for why the rule is not narrowed to 6.

### C — every state slot ships to production, unguarded (13 of 13)

All **8** owner files contain **zero** occurrences of `import.meta.env.DEV` or `NODE_ENV`. The
only DEV-guarded global in the repo is `__executionBufferProbe__`
(`executionSlice.ts:198`) — a debug *function*, not state, and correctly gated.

This is not automatically wrong: a slot that also prevents StrictMode or remount double-init
(`api/companion.ts` explicitly claims all three) earns its production presence. But **nothing
distinguishes the ones that earned it from the ones that inherited it**, and the contrast with
the canonical Next.js idiom — where the dev singleton is guarded by
`process.env.NODE_ENV !== 'production'` precisely because it is dev-only scaffolding — is
unexamined here. The real production cost is **not** retention (a module const is retained just
as long) and **not** leaking across a reload (§Gaps 1); it is that 13 unregistered, mostly
untyped keys sit in a namespace shared with every dependency and every injected script.

### D — the test tax is unpaid on 6 of 8 owners

**9** modules in `src/` export a `__reset*ForTests()`; only **2** of the 8 `globalThis` owners are
among them (`pollingCoordinator.ts`, `silentFailureTelemetry.ts`). The other 7 hatches belong to
plain module-scope singletons (`layoutStore`, `focusStore`, `canvasActionStore`, `scenePublish`,
`appearanceMirror`, `useMorningBriefing`, `FleetSessionInsights`) — so the pattern is understood;
it just was not applied where the state is *most* durable. Consequence, in the tree today:
`tourSlice.test.ts:36-38,:325` and `dynamicTours.test.ts:52` assign `undefined` to four
`globalThis` properties by hand, and `tourSlice.test.ts:33` documents why. A test suite writing a
module's teardown for it is the smell.

### E — typing is split, and the untyped half is the one at risk of collision (8 of 13)

**5** keys are declared through `declare global { var … }` (`eventBridge` ×1, `tourSlice` ×4) — two
files. The remaining **8** are reached through a cast or a local type intersection, of which
`pollingCoordinator.ts:268` and `fleetSlice.ts:79` at least name a type, and 6 use bare
`Record<string, unknown>`. Four naming conventions are in play and nothing registers any of them.

### F — a docs proposal to use the HMR API that was never taken up (1)

`docs/harness/refactor-perf-2026-07-16/test-misc.md:59` proposes exactly the two options this path
weighs — *"Park the unsubscriber on a global … or use Vite's `import.meta.hot.dispose(...)`"* — and
**neither was implemented**. It is the only mention of the HMR API anywhere in the repo. Worth
recording because the sibling repo independently reached the same fork and wrote down the same
choice (§Convergence).

## Gaps in the primitive

1. **`globalThis` cannot outlive a realm, and nothing says so.** A full reload — 6 call sites in
   `src/`, including `ErrorBoundary.tsx:109`'s recovery path — destroys the realm and every slot
   with it. Multiple Tauri WebView windows are separate realms, so slots do not share between
   them either. Neither bound is documented at any of the 8 owners. *(The commissioning brief
   states a `globalThis` singleton "can leak across window reloads." Measured against the
   platform semantics: it cannot. What it does leak across is **module re-evaluation within one
   realm**, which is HMR — and **test files within one Vitest environment**, which is Deviation D
   and is the genuine, in-tree cost.)*
2. **`import.meta.hot.dispose` cannot be the answer, for four independent reasons.** It runs only
   when the module sits inside an accepted HMR boundary chain, so it is silent in exactly the case
   Vite falls back to a full reload; it is stripped in production, so it cannot also address
   StrictMode/remount double-init that the same code often needs; it is unreachable from a test;
   and it requires an `if (import.meta.hot)` guard whose *absence* is invisible. This is a real
   limitation of the sanctioned API, not laziness — and it is why zero of three codebases use it.
3. **No way to express "this registration is process-lifetime and intentionally never released."**
   `fleetSlice.ts:73-75` says it in prose (*"the registry is process-lifetime, never torn down"*)
   and `documentVisibility.ts` says it not at all, yet they are the same decision. A reader cannot
   tell a deliberate permanent listener from a forgotten one, which is precisely why Deviation B
   Tier 1 has sat there.
4. **No shared singleton primitive — the headline gap.** Eight owners have each hand-rolled key
   choice, typing, initialisation, re-entrancy and (mostly not) test reset. **Fix:
   `src/lib/hmrSingleton.ts` — `hmrSingleton<T>(name: string, create: () => T): { get(): T; reset(): void }`**,
   owning a `Symbol.for('personas.' + name)` key internally, inferring `T` from `create`, and
   returning the reset hatch so it cannot be forgotten. This is the type half of §Prefer a type
   over a gate, and it retires Deviations C, D and E at once.
5. **No registry of what slots exist.** 13 keys, four conventions, zero central declaration —
   structurally identical to [`client-state-persistence`](./client-state-persistence.md) §Gaps 2
   for localStorage keys. `Symbol.for` keying (Gap #4) makes collision impossible, which is
   strictly better than a registry that must be maintained.
6. **No test asserts the invariant.** Nothing checks that `document.addEventListener` is called
   once, that `storeBus` has 14 handlers rather than 28, or that a module can be re-imported
   without duplicating a registration. The whole leaf is verified by nobody, which is why a
   documentation fiction survived across four files.
7. **Both search tools used to measure this leaf are silently lossy, in different ways.** `git grep
   -- 'src/**/*.ts'` drops files with no intermediate directory — it does not see `src/main.tsx` or
   `src/App.tsx` (verified: `git grep -l sentryReady -- 'src/**/*.tsx'` returns nothing;
   `-- src` returns `src/main.tsx`). The `Grep` tool independently missed
   `fleetTerminalManager.ts` on the `executionBuffers` search that `git grep` found. And the
   `brainiac` oracle hit a third mode: a source file containing literal NUL bytes in a regex
   literal is classified binary, so `git grep` reports only *"Binary file … matches"* with no
   lines. **Not a code gap, but it belongs here: every count in this document that mattered was
   produced by an AST walk of the filesystem, and the two `git grep` figures inherited from the
   brief were both wrong.**

## Prefer a type over a gate — answered

**Half yes, and the split is unusually clean — which is why both are proposed.**

**The half a type can make unrepresentable: key, typing, collision, and the missing reset hatch.**
Ship `hmrSingleton()` (Gaps #4) and the wrong call stops being expressible. The key is chosen
*inside* the factory from the name, so two modules cannot claim one slot and no caller can typo a
key that a second caller reads. The value type is inferred from `create`, so
`globalThis as Record<string, unknown>` — the cast behind 8 of 13 keys and all 4 naming
conventions — has nowhere to appear. The reset hatch is part of the return value rather than an
optional export, so Deviation D cannot recur. Heeding the contract's own warning about
[gates that point at a broken destination](../golden-path-contract.md): the factory is only worth
routing to if it is **correct by default**, so `Symbol.for` keying and the reset hatch must be
non-optional — not a `{ symbol?: true }` option that 96% of callers will omit. The sibling repo's
measured result supports the mechanism: **2 of 2** of its slots use `Symbol.for` keying, because
the first author chose it and the second copied a working example.

**The half no type can reach: whether *this* state needs to survive at all.** That is a judgment
about the lifetime of a resource the type system never sees — a DOM listener, a `<style>` node, a
patched global. `let installed = false` and `let hasCachedData = false` are the same type, the
same shape, and the same three lines; only the thing on the other side of the latch differs, and
it is not in the signature. No required prop, newtype or factory can distinguish them. Deviation
B is therefore genuinely a policing problem, and it is exactly the 13 the census rule counts.

So the order is: **(1)** build `hmrSingleton()` and migrate the 8 owners — that is the permanent
fix and it needs no gate; **(2)** fix Deviation B Tier 1's four latches by refcounting
(`documentVisibility` can release its listener when `listeners.size` hits 0, which is strictly
better than hoisting it) ; **(3)** keep the census rule below as the ratchet that stops new
latches appearing while (1) and (2) land. The gate is the least of the three and is scoped
accordingly.

## The missing gate

**The condition being proxied** (stack-free, so an adopting repo can re-derive its own signal):
*a one-way latch guarding a registration that is never released* — state that can only move from
"not yet done" to "done", protecting a side effect on an object whose lifetime exceeds the
module's. In this stack it wears the syntax `let x = false` … `x = true` at module top level. In a
Python module it would wear `_INITIALIZED = False` at import scope; in Rust, a
`static ONCE: Once` guarding a registration with no matching teardown; in a Go package, an
`init()` that appends to a global slice. **Re-derive the signal for your idiom; do not port the
regex.**

**Not already covered.** All 48 rules in `scripts/census/rules.json` were checked: none touches
`globalThis`, module scope, HMR, singletons, or process-global state. The nearest neighbour,
`unmanaged-tauri-subscription` (`backend-to-frontend-events.md`), gates bare `listen()` calls —
a different condition (subscription *ownership*), and it does not fire on a latch at all, because
three of the four Tier-1 sites register DOM listeners and a `<style>` node, not Tauri events.

**Signal.** A module-scope `let` initialised to `false` (anchored at column 0 with the `m` flag —
nothing at module scope is indented under this repo's Prettier config), which is assigned `true`
somewhere later, and which is **never assigned `false` again**. That last clause is what makes it
a *latch* rather than a flag: a two-way flag has a release path and self-heals; a one-way latch
cannot. The reset-lookahead requires the reassignment to begin its own line (`\n[ \t]*`) so that
a comment containing `x = false` cannot suppress a real violation — a failure this signal
demonstrably had before that anchor was added (see the comment-prose row below).

```json
{
  "rules": [
    {
      "id": "module-scope-install-latch",
      "goldenPath": "docs/concepts/golden-paths/hmr-safe-singletons.md",
      "title": "One-way module-scope latch guarding an unreleased registration",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "^let\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]{0,60})?=\\s*false\\s*;(?![\\s\\S]*\\n[ \\t]*\\1\\s*=\\s*false)[\\s\\S]*?\\b\\1\\s*=\\s*true\\s*;",
        "flags": "gm",
        "ignoreCommentLines": true,
        "description": "A module-scope `let x = false` that is later set to true and never set back to false — a one-way latch. Because it lives in module scope it is re-created on every HMR module re-evaluation, so whatever it guards runs a second time; and because it has no release path, the first registration can never be undone. Where the latch guards an unreleased side effect (a document/window listener, a monkey-patch, an injected <style>, a process-lifetime registry) a second copy is SILENTLY ADDITIVE — nothing throws, the handler count just rises. PROXY FOR the stack-free condition: a one-way latch guarding a registration that is never released. Fix by refcounting the resource (acquire on first subscriber, release on last — see relativeTimeTicker.ts:44-83), by a generation token (executionSink.ts:110), or, last, by a globalThis slot (eventBridge.ts:130-146)."
      },
      "baseline": { "files": 13, "matches": 13 },
      "floor": 4000
    }
  ]
}
```

**Mechanism.** The shared census runner (`npm run census` / `census:check`). No new script.

**Allowlist — empty, deliberately.** Every one of the 13 matches is a genuine instance of the
stated condition (a one-way module-scope latch), including the seven whose *consequence* is
benign. Exempting the benign ones would mean encoding a harm judgment into a path pattern that
the next author of a Tier-3-looking latch would inherit as permission; and the runner fails a rule
whose `exclude` matches nothing, so a speculative allowlist is a liability. The count is the
count; §Deviations B does the triage.

**Why the rule is not narrowed to the 6 real hazards.** It could be — by requiring
`addEventListener|appendChild|setInterval` near the latch. Measured, that costs more than it buys:
the dominant idiom sets the latch *first* and registers afterwards (correct re-entrancy practice),
so proximity ordering is unreliable, and 3 of the 4 Tier-1 sites would still need the window
widened past the point where precision survives. A shape-level signal with 1.00 precision on the
shape, plus a prose triage, beats a harm-level signal with unstable recall.

**Validation performed.** Pattern held **in a file**, never passed through bash argv (argv mangles
backslashes under MSYS — and a heredoc did exactly that once during this composition, producing a
JSON parse error that made the failure obvious rather than silent). Fault injection ran against an
**isolated copy** of `src/` in a scratch directory; the repo working tree was never modified.

| Case | Result | Exit |
|---|---|---|
| Baseline scan, `src`, 4,829 files walked | **13 files / 13 matches** (1.4 s) | — |
| Control: untouched corpus vs baseline | reproduces **exactly** | **0** |
| Control re-run after all fixtures restored | reproduces **exactly** | **0** |
| Fault A: one new one-way latch added | `drift/rose` ×2, "files rose 13 → 14" | **1** |
| **Positive control 1:** `documentVisibility` latch hoisted to a `Symbol.for` `globalThis` slot — the prescribed fix | `drift/dropped` ×2 | **1** |
| Positive control 1b: same fix **with** baseline ratcheted to `{12,12}` | clean | **0** |
| **Positive control 2:** latch **kept in module scope** but given a release path (`uninstall…()` setting it back to `false`) | `drift/dropped` ×2 | **1** |
| Fault B: floor unmet (roots narrowed → 1 file walked) | `structural/floor` — "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN" | **1** |
| Fault C: signal matches zero files anywhere | `structural/zero-matches` | **1** |
| Comment prose containing the exact pattern (`// let installed = false;` / `// installed = true;`) | **13 matches unchanged** | **0** |

**The positive controls are the load-bearing rows, and there are two because the condition has two
distinct compliant forms.** Hoisting the state out of module scope drops the count; *keeping* it in
module scope and giving it a release path also drops the count. A rule that merely keyed on
`let x = false` would match both rewrites and report no change. That both compliant forms fail
until the baseline is ratcheted is what proves the matcher discriminates on **one-wayness**, not on
the token.

**The comment-prose row is not decoration — it caught a real defect in an earlier draft of this
signal.** With the reset-lookahead written as `(?![\s\S]*\b\1\s*=\s*false)`, appending the two
comment lines above to `documentVisibility.ts` dropped the count from 13 to **12**: the commented
`installed = false` satisfied the lookahead and **suppressed a genuine violation**, reporting the
codebase as improved when a comment had been added. `ignoreCommentLines` cannot prevent this,
because it filters a match by the line the match *starts* on and has no view of what a lookahead
consumed — the same class of failure `engine.mjs:194-209` records for `build-gated-ipc-entrypoint`.
Anchoring the lookahead to `\n[ \t]*` fixed it, and the row above is now the regression guard.

**Populations and overlap.** The census signal finds **13 matches / 13 files**. An independent
TypeScript-AST implementation — module-scope `let` initialised to `false`, with real scope
resolution and full assignment analysis, written without reference to the regex — finds **13**.
**Overlap: 13. Precision 1.00, recall 1.00, zero disagreement.** Reaching that took three
iterations and the disagreements were the useful part: the first draft (a guard-shaped pattern,
`if (x) return … x = true`) matched **103 sites across 92 files**, almost all function-local
`cancelled` flags inside `useEffect` — an 8× over-count that would have baselined mostly correct
code. Two later drafts disagreed with the AST on 4 sites, and in every case **the AST was right
and the regex was wrong**: `callbackTracker.ts:41`, `appearanceMirror.ts:180` and
`useObsidianVaultRehydration.ts:9` all have release paths (so are not latches at all — and
`callbackTracker`, which monkey-patches `setTimeout`/`MutationObserver`, had been on my Tier-1
hazard list until the AST cleared it), while `main.tsx:87` was a true latch the regex's distance
window was too small to see.

**How it fails loudly when its own precondition is absent.** Inherited from the census runner and
verified above **by injection, not assumed**: `floor: 4000` against 4,829 walked files means a
moved root or changed extension list is a **structural** failure, not a clean report (Fault B); a
signal matching nothing anywhere is structural with an explicit "delete the rule rather than
baseline it at zero" message (Fault C); a **drop** without a baseline update fails exactly as
loudly as a rise (both positive controls). Surviving counts print on success.

**What this gate does NOT catch, stated so the next reader does not over-trust it.** It is blind
to latches expressed as `let x: T | null = null` rather than a boolean (`p2pCapability.ts:72,:74`),
to latches held in an object field or on `globalThis` already, to the **untyped-cast** and
**missing-reset-hatch** deviations (C, D, E — those are the type's job, not the ratchet's), and to
the harm classification entirely: it reports 13 where 6 matter. If `hmrSingleton()` lands and the
four Tier-1 latches are refcounted, this rule should be **deleted**, not baselined at zero.

**Two conditions here are must-never-happen, and the census engine cannot express them.** A rule
that reaches zero fails `structural/zero-matches` by design, so "this must always be 0" has no
representation. Both need a **test** instead:

1. **No source comment may cite an identifier that does not exist** — Deviation A, the defect that
   created this leaf. A ~20-line Vitest case over `src/**` that extracts identifiers cited inside
   comments as cross-references and asserts each resolves to a declaration would have caught all
   four sites the day the first one was copied, and would keep catching the next one. **Ship this
   with the Deviation A fix, not after.**
2. **A module must not add a listener to `document`/`window` without a path that removes it** —
   Deviation B Tier 1. Structural, and better as a focused test over the handful of `src/lib`
   modules that legitimately do this than as a repo-wide regex.

`brainiac/console/src/design/focus-contract.test.ts` is a working precedent for both shapes: a
source-scanning conformance test whose allowlist requires a written reason string.

## Convergence — the portability oracle

Two siblings were read in full. **The result splits cleanly, and the half that contradicts the
brief is reported first.**

**The PROBLEM is physics — three codebases, six independent instances, nobody sharing a document.**
The exact shape — a module-scope one-way latch guarding a registration — was rediscovered
everywhere:

- `personas-web/src/lib/review-voice.ts:99` — `let voiceListenerBound = false` guarding
  `synth.addEventListener("voiceschanged", …)`. Module-local, not HMR-safe.
- `personas-web/src/lib/server/rate-limit.ts:9` — `let cleanupStarted = false` guarding a
  `setInterval`. Module-local, not HMR-safe.
- `brainiac/console/src/docs/MermaidBlock.tsx:26-29` — `let initialized = false` guarding
  `mermaid.initialize()`, in a `"use client"` module. Its comment says *"run it once per session"*
  — **an intent claim the mechanism cannot deliver**, which is this leaf in one line.
- Plus this repo's `documentVisibility.ts`, `storeBusWiring.ts`, `ThinkingLoader.tsx`.

**The FIX is only half-convergent, and one sibling reinvented it better than we did.**
`personas-web` arrived independently at the `globalThis` slot — twice, and with the mechanism this
path's step 6 now prescribes:

- `personas-web/src/hooks/usePageVisibility.ts:30-40` — a slot keyed
  `Symbol.for("personas.usePageVisibility.registered")`, holding a listener-registered flag,
  commented *"so HMR / Fast Refresh re-evaluating this module doesn't stack additional
  visibilitychange listeners on each cycle."* **This is the same file-shape as our
  `documentVisibility.ts` — the same `visibilitychange` listener, the same install guard. One repo
  fixed it and one did not.** Two codebases converging on the same defect *and* one of them on the
  fix is the strongest evidence in this document.
- `personas-web/src/lib/bodyScrollLock.ts:8-30` — a `globalThis` `{ lockCount, previousOverflow }`,
  with the best failure statement of the set: state on `globalThis` *"so HMR / Fast Refresh
  re-evaluating this module doesn't reset the count to zero while `body.style.overflow` is still
  hidden"* — **"freezing the page until a hard reload."**
- Both are **unconditional**, not `NODE_ENV`-guarded — deliberately, because they also protect
  production double-evaluation. That independently vindicates Deviation C's *unguarded* posture
  while leaving the criticism (nobody decided) intact.

`brainiac/console` **has zero `globalThis` in its entire source** and is the negative case:
no client store, no Context, `force-dynamic` + `no-store` everywhere, URL as the source of truth,
so there is almost no long-lived client module state for the problem to attach to. Where it needs
process-idempotence it **delegates to the SDK's own registry** — `firebase/admin.ts:33`
(`getApps()[0]`), `firebase/client.ts:22`, Sentry's hub — rather than building a second one. That
is a genuinely better move than either mechanism here and is worth remembering: **if the library
already owns a process registry, do not build a parallel one.** Its Rust side reaches the opposite
conclusion again, threading an `Arc<AppState>` through Axum extractors rather than using globals.

**So: the latch problem is doctrine; the `globalThis` slot is a house mechanism for
long-lived-client-state apps.** This path marks it as such. Where a codebase can delete the state
(brainiac) or delegate it (Firebase/Sentry), that beats both.

**The strongest convergent finding is a negative one, and it corrects the brief.** The brief
describes `import.meta.hot.dispose`/`accept` as *"the sanctioned way to clean up rather than
hoisting to `globalThis`."* Measured: **zero uses in all three codebases** — and in two of them the
API was explicitly considered and declined in writing.
`personas-web/docs/harness/bug-hunt-2026-05-10/layout-navigation-page-shell.md:18` proposes *"On
HMR (`module.hot?.dispose`) clear the set"* and the repo shipped the `globalThis` approach instead;
this repo's `docs/harness/refactor-perf-2026-07-16/test-misc.md:59` offers the same two options and
took neither. Three codebases, two documented rejections, zero adoptions. **The sanctioned API
loses on the merits** (Gaps #2), and a path that prescribed it would be prescribing something
nobody has ever chosen when they had the choice in front of them.

**One convergent practice this repo lacks: documentation that names real identifiers.**
`personas-web` documents both of its slots — `docs/features/platform/animation-motion.md:25,63`
even records the intent *"Intentional process-lifetime singleton — don't 'fix' it by adding
cleanup"*, which is exactly the expressiveness Gaps #3 says is missing here — and every identifier
those docs name was verified to exist. That is the direct contrast with Deviation A: the same
class of documentation, in a sibling repo, without the fiction.

**A convergent trap, flagged.** `brainiac/console/app/login/actions.ts:41-54` holds a brute-force
throttle in a module-scope `Map` and documents its lifetime — but along the **wrong axis**: the
comment names *restart* and *replicas*, never module re-evaluation. Under `next dev`, editing that
file resets every attacker's attempt counter. Two lessons, both worth carrying: naming *a*
lifetime bound is not the same as naming *the* one that bites you; and its own conclusion
(*"A shared store would"*) is the better fix, because **`globalThis` addresses module-graph
duplication and nothing else** — reaching for it to solve a durability or scaling problem is a
category error this path should not encourage.

## Severity note

The census rule is a **ratchet, not a lint rule**, and this path does not argue for `"error"`
anywhere. Per `.claude/CLAUDE.md`, `npm run check` runs `eslint src/` with no `--max-warnings` and
the pre-commit hook runs `--quiet`, so **a warn-level rule enforces nothing at either gate, at any
warning count** — an argument about how the gates are built, not about volume. The 1,135-warning
baseline ([`shared-facts.json`](../shared-facts.json) `lint.warnings`) is evidence for neither
side. `npm run census:check` is a separate exit-1 gate and is where this belongs. The two
must-never-happen conditions above belong in the Vitest suite, which is also exit-1.
