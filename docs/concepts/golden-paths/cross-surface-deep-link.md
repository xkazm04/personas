# Golden path — Cross-surface deep link

> Situation node: `ui-system/layout-and-navigation/cross-surface-deep-link` · [situation spine](../situation-spine.md)
> `sides: client` (with one OS-level and one Rust-originated entry point) · `risk: high` · recurrence **42**.
> Dimensions: **function · resilience · ui · code-quality**.
>
> Composed 2026-08-15 against `master` from a ground-truth sweep of the **4,829**
> `.ts`/`.tsx` files under `src/` ([`shared-facts.json`](../shared-facts.json), independently
> re-walked at 4,829 by three separate walkers used in this composition). The headline
> results were **produced by execution, not by reading**:
> a **Vitest run against the real `registry.ts` / `sectionRouter.tsx` / `storeBus.ts` /
> `incidentDeepLink.ts` modules, imported unmodified**; a **`tsc --noEmit --strict` run over a
> four-line fixture** that settles why one cast spelling is worse than another; a
> **React Testing Library run** over verbatim reproductions of two shipped arrival effects; a
> **TypeScript-compiler AST pass** over every function body in `src/`; and **ten fault-injection
> runs** of the census runner. Read in full: the OS deep-link handler in `lib.rs`, `storeBus.ts`
> and its wiring, all twelve single-slot handoff channels and every producer and consumer of
> each, `incidentDeepLink.ts`, `flashSpotlight.ts`, `useGuidanceRunner.ts`,
> `useTrackedElementRect.ts`, `GuidedTour.tsx`'s `navigateToStep`, `NotificationCenter.tsx`'s
> `handleRedirect`, `navigateToProcess.ts`, `launchPowerMove.ts`, `CredentialNavContext.tsx`,
> the companion action surface on both sides of the IPC boundary, and the test-automation bridge.
> Convergence checked read-only against `../personas-web` and `../brainiac/console`.
>
> **Sibling leaves — settle the boundary before reading the prescription.**
> [`navigation-destination.md`](./navigation-destination.md) owns **the destination vocabulary**:
> what a place is called, whether that name exists, and whether every catalog agrees. **This path
> owns the arrival** — what happens when something *outside* a surface asks it to open at a
> specific place, and what guarantees the user lands there. The seam is one sentence and it is
> worth stating exactly:
>
> > **`navigation-destination` ends when the destination id is written. This path begins there.**
>
> Everything after that write — did the surface exist to receive it, did it exist *yet*, did the
> thing you asked it to show still exist, and does the user know they arrived — is here. The two
> paths therefore split the same defect in two: a deep link naming a bad *place* is
> `navigation-destination`'s §7 A; a deep link naming a good place and a bad *target within it*
> is this path's §7 C. Where a single call site does both, it appears in both, and this document
> says so.
> [`toasts.md`](./toasts.md) owns the toast; its `{ label, onClick }` action slot is one of the
> arrival entry points measured here (§7 A).
> [`client-state-persistence.md`](./client-state-persistence.md) owns how a value reaches
> `localStorage`. It supplies the reason this leaf is `risk: high`: **one of these arrival
> payloads is persisted, uncapped in time, and replayed on click months later** (§7 B4).
> [`focus-management.md`](./focus-management.md) and
> [`screen-reader-announcements.md`](./screen-reader-announcements.md) own focus and live regions
> in general; the arrival-specific measurement is §7 E.
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells when this path
> is ingested.

> ### ⚠ Three notes on the brief that commissioned this path
>
> 1. **The brief's numbers are confirmed, and one of them is worse than stated.** *"Executed: a
>    stale persisted id makes `isSectionGated` — the first statement of the render path — throw
>    `TypeError`"* — re-executed here against the same unmodified modules and reproduced exactly.
>    But the brief frames it as a *staleness* hazard (an id that used to exist). **Measured here:
>    three shipped surfaces pass `setSidebarSection` an id that was NEVER in the union** —
>    `'pipeline'` from an Athena assignment card and from a team-assignment notification,
>    `'agents'` from a one-shot-build notification (§7 B1). Those are not waiting for an app
>    update to become dangerous. They are reachable today, they are persisted, and they throw the
>    same `TypeError`. The census rule in §9 exists because **none of the three is visible to the
>    neighbouring rule `unchecked-destination-id-assertion`**, and §9 proves by compiler execution
>    why.
> 2. **"7 distinct deep-link mechanisms" is right for the *carrier* and undercounts the
>    *arrival*.** Counting how the intent travels gives seven. Counting **how the receiving side
>    handles "the target is not here yet"** gives **nine distinct strategies across 12 landing
>    implementations**, three of which are mutually contradictory (§7 D). That is the axis this
>    path is about, and it had not been counted.
> 3. **A `personas://` URL scheme exists and it cannot name a destination.**
>    `tauri-plugin-deep-link` is registered (`lib.rs:560`, `:1662-1670`) and `on_open_url`
>    (`:1604-1660`) handles **five** prefixes: `auth/callback`, `share`, `import/<slug>`,
>    `ref/<code>`, `pair`. **Zero of the five carries a section, a tab, or a row.** Each emits a
>    Tauri event that a feature turns into a modal or a captured code. So the one entry point that
>    is *structurally* a deep link in every other product is, here, the only one that cannot deep
>    link. That is a gap, not a defect (§8 gap 6) — but it means every claim in this document
>    about "the URL" is about the two sibling repos, never about Personas.

---

## 1. Trigger

- "This toast / notification / nudge should take the user straight to the thing it is about."
- "Athena needs to open Overview → Incidents **on incident X**." / "the tour step has to land on this row."
- "I set the tab right after the section and it lands on the wrong tab / the default tab."
- "It works when the page is already open but not on a cold jump." (or the reverse)
- "The user clicked a two-week-old notification and nothing happened."
- "How do I highlight / scroll to / open the detail of the thing I just navigated to?"

If you are about to type `setPending<Something>`, `consumePending…()`, `storeBus.emit(` for anything
other than a toast, a `setTimeout` before a tab setter, `document.querySelector('[data-testid=`
after a navigation, `scrollIntoView` in a `useEffect` that just navigated, a second module-level
`let _pendingX`, or `redirectSection: '<literal>'` in a notification payload — **you are in this
situation.**

### Scope — what is a "cross-surface deep link"

| Thing | In scope | Why |
|---|---|---|
| A **place** named from outside the surface that renders it | this is the subject | the arrival |
| A **target inside** that place — a row id, an entity id, a detail modal, an anchor | **yes, and this is the neglected half** | the thing that makes it a *deep* link |
| A lens/preset that rides along (`monitorChannelPreset`, `pendingApprovalsMode`) | **yes** | it must survive the same race |
| Which *name* the place has, and whether that name is in a union | no — [`navigation-destination.md`](./navigation-destination.md) | except where an arrival is the thing that ships a bad one (§7 B1) |
| A within-surface click (a row opening its own detail) | no | nothing crossed a surface boundary |
| An external URL (`open_external_url`, a GitLab pipeline link) | no | it leaves the app; see `sanitizeExternalUrl` |

---

## 2. The one way

**An arrival is a request that can be refused, so make it a value that is resolved on landing —
never a sequence of writes that assumes.** Build every cross-surface deep link out of three
separable parts and give each one an explicit answer: **(a)** the *place*, written atomically
through the navigation setter (that half belongs to
[`navigation-destination.md`](./navigation-destination.md)); **(b)** the *target*, parked in a
**single-slot latch that the destination subscribes to — never one it reads only on mount**,
because a mount-only read is silently dropped when the surface is already open and then fires on
an unrelated visit weeks later (§7 D1, proven by execution); and **(c)** the *landing*, which must
**resolve the target against reality before it renders anything** — look it up in what is loaded,
fetch it once if it is not, and when it genuinely is not there, **say so**. Copy
`IncidentsInbox.tsx:154-181` for the latch-plus-subscribe shape and
`GlobalExecutionList.tsx:197-218` for the resolve-fetch-once-then-give-up shape; between them they
are the whole prescription, they are both already in this repo, and **each has exactly one
adopter**. Never wait for a surface with a timer — `setTimeout(…, 100)` and `setTimeout(…, 300)`
are the guided tour's entire theory of whether a destination mounted, and the correct primitive
(**poll for the anchor with a deadline**) exists twice in this repo already
(`flashSpotlight.ts:36-56`, `useGuidanceRunner.ts:33-58`, both 4,000 ms / 80 ms, independently
written). Never let the target cross the boundary as a bare `string` that a nav setter accepts
through `as never` or `as Parameters<typeof setter>[0]` — that spelling is not shorthand for the
union, it is strictly weaker than it, and **it is where all three of this repo's live
navigate-to-a-nonexistent-place bugs live** (§9, proven with `tsc`). And **the arrival is not
finished when the state is written**: if the user was sent somewhere, move focus to what they were
sent to and announce it — **0 of the 58 arrival sites measured here do either.** Then stop: no
second latch mechanism, no `setTimeout` before a setter, no `success: true` returned before a
frame has rendered, and no silent `return` when the target is gone.

### The one genuine fork — is the target *addressable* or merely *reachable*?

- **Addressable**: the arrival can name it (`incidentId`, `executionId`, `taskId`, `goalId`,
  `projectId`, a `data-testid` anchor). It gets a latch, a resolver on landing, and a
  user-visible outcome when the resolve fails.
- **Reachable**: the arrival can only get the user to the list and the row is one of many
  (`ProactiveCard.tsx:65-66` lands on Overview → Messages, `useDecisionQueue.ts:302` on
  Approvals). That is a legitimate, cheaper answer — **but it must be a decision, not an
  omission.** Today 6 of the 12 notification kinds that carry a `personaId` never read it
  (§7 B2): the id was threaded all the way to the click handler and dropped.

**The test:** *if the user clicks this and the thing it names has been deleted, what do they see?*
If the honest answer is "the list, with no indication anything was meant to be selected", you have
built a reachable link and called it addressable. **That answer is currently correct for 9 of the
12 landings measured** (§7 C).

---

## 3. Mandated primitives

**The carrier — how the intent reaches the destination**

- **`src/features/overview/sub_incidents/libs/incidentDeepLink.ts` — the single-slot module latch.**
  27 lines: `setPendingIncidentDeepLink(id)` / `consumePendingIncidentDeepLink(): string | null`
  (read-and-clear). Its docstring is the clearest statement of this leaf's core hazard in the repo:
  *"storeBus is fire-and-forget with no replay … the emit can land BEFORE the inbox subscribes."*
  **Copy this shape for any target that must survive a lazy mount.**
- **`src/lib/storeBus.ts` — `emit` / `on`.** The typed cross-store bus. 12 event kinds; **2 are
  cross-surface intents** (`incidents:open-detail`, `tour:navigate-credential-view`). **Read
  `emit`'s first line before using it for an intent:** `if (!set) return;` — an emit with no
  subscriber is discarded, `emit` returns `void`, and **the sender cannot detect it** (proven by
  execution, §7 D2). Use it for the *already-mounted* half of an arrival, never as the only half.
- **`uiSlice.ts:143-221` + `overviewSlice.ts:83-190` — the single-slot store latches.** 12 declared
  (`pendingTaskFocusId`, `pendingApprovalsMode`, `pendingGoalSpotlightId`, `pendingFactoryFocus`,
  `pendingExecutionFocus`, `pendingPlaygroundRecipeId`, `pendingPrompt`, `monitorInitialView`,
  `monitorChannelPreset`, `pendingCatalogCategoryFilter`, `pendingLifecycleSubTab`,
  `canvasEdgeFocus`/`liveStreamHighlightEventId`). **Four of them are dead** — §7 A3.
- **`CredentialNavContext.tsx:17-58` — the provider-scoped latch.** `pendingKey` + a
  `navigateHandlerRef`; `setNavigateHandler` flushes the pending key the moment a handler
  registers (`:23-28`). This is the correct answer to "the receiver isn't mounted yet" expressed
  in React instead of in a module. It is **the only one of the three latch dialects that flushes
  automatically.**

**The wait — how the landing handles "not yet"**

- **`flashSpotlight.ts:36-56` — `waitForTestId`. THE PRIMITIVE TO COPY.** Polls
  `[data-testid="…"]` every 80 ms for up to 4,000 ms, sanitises the id against
  `/^[a-zA-Z0-9_-]+$/` before it can reach `querySelector`, and returns `null` on timeout instead
  of throwing inside an unawaited promise. Its caller adds a **generation token** (`:20-28`) so a
  second arrival abandons the first — the only cancellation of a superseded deep link in the repo.
- **`useGuidanceRunner.ts:33-58` — the same function, written independently, plus an
  `isCancelled()` hook, and — the part the tour lacks — it is **awaited after navigating**
  (`:219-229`). Two independent rediscoveries of one mechanic inside one repo is the strongest
  internal evidence available that this is physics, not taste (§Convergence).
- **`useTrackedElementRect.ts:40-41, 136-185` — the tracked-anchor hook.** `MISSING_TARGET_RETRY_MS
  = 500`, `MAX_MISSING_TARGET_RETRIES = 4`. **Read `:176-185` before relying on it:** the retry
  budget is reachable only from `handleReposition`, i.e. only after a successful first attach. The
  *initial* probe is a single `setTimeout(…, 100)` that calls `reportMissing()` on the first miss.
  **For an anchor that was never there, its budget is 100 ms, not 2 s.**

**The landing — how the target is resolved**

- **`IncidentsInbox.tsx:154-181` — THE ONE SITE TO COPY.** Consumes the latch on mount **and**
  subscribes to the live event, so it wins the race from both directions; resolves the id out of
  the loaded list first (`:157-160`) and falls back to `getAuditIncident(id)` (`:162-167`); carries
  a `cancelled` guard. Its one flaw is the one every landing shares — see §7 C1.
- **`GlobalExecutionList.tsx:197-218` — the give-up primitive.** `find` in the loaded page, one
  refetch on a miss guarded by `focusFetchAttemptedForRef`, and on the second miss **clear the
  latch and stop**. Its comment names the exact failure it was written to fix (*"an id that never
  appears … refetched in a tight loop"*). **This is the only bounded retry in the repo's arrival
  surface.**
- **`RecipeManager.tsx:44-51` — the existence check.** `const exists = recipes.some(r => r.id ===
  pendingId); if (!exists) return;` — three lines, and the only landing that tests membership
  before acting on a handed-off entity id.

**Deliberately not a primitive, and that is the whole defect surface:** there is no
`DeepLink`/`Arrival` type pairing a destination with a target, no shared `createArrivalLatch()`,
no `awaitDestination(testId)` export, and no `resolveTarget(id, collection, onMissing)`. Their
absence is why the same four ideas are implemented nine ways (§7 D) and why
`waitForTestId` exists twice and `/^[a-zA-Z0-9_-]+$/` **four times** (`flashSpotlight.ts:30`,
`useGuidanceRunner.ts:25`, `useTrackedElementRect.ts:34`, `tourSlice.ts:189` — the last one is
`export`ed and the other three each carry a comment explaining why they did not import it).

---

## 4. Steps

1. **Decide addressable or reachable** (§2 fork). If you cannot name the target, do not pretend:
   navigate to the list and stop. Do not thread a `personaId` through a payload and never read it.
2. **Write the place atomically.** One helper, one store write for section + tab. Follow
   [`navigation-destination.md`](./navigation-destination.md) §4 step 7. **Never a `setTimeout`
   between the section and the tab** — `launchPowerMove.ts:26-38` is the least-bad version of that
   mistake (it re-checks `s.sidebarSection !== nav.section` before landing, `:33`) and it is still
   a mistake.
3. **Park the target in a latch the destination SUBSCRIBES to.** `useSystemStore((s) =>
   s.pendingX)` + an effect keyed on it (`FactoryShell.tsx:59-69`, `PersonaMonitor.tsx:56-63`) —
   **not** `useEffect(() => { getState().pendingX … }, [])`. The mount-only form drops the intent
   whenever the surface is already open, and the dropped intent stays in the store (§7 D1).
4. **Emit live as well, if the surface may already be mounted.** Latch *and* `storeBus.emit`, the
   way `ProactiveCard.tsx:56-58` does. Either alone loses one of the two orderings.
5. **Resolve the target on landing, in this order:** find it in what is loaded → fetch it once →
   give up **loudly**. `GlobalExecutionList.tsx:197-218` is steps one and two; step three exists
   nowhere in this repo and is the single most common gap (§7 C). The model to copy is in a
   sibling: `brainiac/console/src/.../useMemoryDetail.ts:39` resolves the id **independently of the
   list** and renders a plain sentence when it cannot (Convergence). Resolving independently is
   what lets a target on page 7 open at all — `RunDeskPage.tsx:72`'s wait-for-a-DOM-node cannot.
6. **If the target is a DOM anchor rather than a record, await it.** `waitForTestId` from
   `flashSpotlight.ts:36` or `useGuidanceRunner.ts:33`. Never a fixed delay. Never
   `document.querySelector` immediately after a navigation.
7. **Cancel a superseded arrival.** A generation token (`flashSpotlight.ts:20-28`) or an
   `isCancelled()` (`useGuidanceRunner.ts:35`). Without one, a 4-second poll started before the
   user navigated away will paint on the wrong screen — the comment at `flashSpotlight.ts:20-28`
   records exactly that bug being fixed.
8. **Land the user, not just the state.** `scrollIntoView({ block: 'center' })`, then **move focus
   to the target** (`tabIndex={-1}` + `.focus()`), then **announce it** through the existing
   `announceImperative` (`toastStore.ts:138`). Today this step is performed by nobody (§7 E). The
   one correct implementation across all three measured repos is
   `personas-web/src/.../guide/TopicView.tsx:88-98, 150` — `tabIndex={-1}` on the target, focus
   moved on change, and the initial mount explicitly skipped so focus is never stolen on load.
   Copy that mount-skip; it is the detail that makes the rest safe.
9. **If the arrival can be triggered from a persisted payload, validate on read, not on write.**
   A notification row lives in `localStorage` for 50 entries with no expiry
   (`notificationCenterStore.ts:56-57`); the code that wrote it may be three releases old. See
   [`client-state-persistence.md`](./client-state-persistence.md).
10. **And then stop.** No new latch dialect. No `setTimeout` before a setter. No `as never` at a
    nav setter. No `return { success: true }` before the destination has rendered.
11. **Verify:** open the destination, trigger the deep link **from the destination itself** (the
    already-mounted ordering), then navigate away, trigger it, and navigate back (the cold
    ordering). **Both must land.** Then delete the target entity and trigger it a third time; if
    the user sees nothing, you have not finished step 5.

### Can the primitive's signature make the wrong call impossible? — answered before §9

The contract asks this above the gate. **Here the answer is yes three times, and the third one is
the most valuable change in this document.**

- **A target-write must be able to refuse. YES, and today it cannot.** `selectPersona(id: string |
  null) => void` (`personaSlice.ts:78`) is the target half of **41 call sites in 32 files**, and it
  has a silent early return: if the editor is dirty it stashes into `pendingSelectPersonaId` and
  **returns without selecting** (`:470-473`). Every arrival that does `selectPersona(id)` then
  `setSidebarSection('personas')` then `setEditorTab('chat')` therefore has a live path where the
  place changes, the tab changes, and the *target does not* — the user lands on the previous
  persona's editor on the requested tab. Because the signature returns `void`, **not one of the 41
  callers can detect it, and none tries.** Changing it to `selectPersona(id): 'selected' |
  'deferred-dirty' | 'unknown-persona'` makes the refusal representable; the callers that today
  cannot ask would be forced to. This is a type change, and it is the one this leaf most needs.
- **A navigation setter's parameter should never be reachable through an anonymous assertion.
  YES — and this is measurable and already the §9 gate.** `setSidebarSection('pipeline' as
  Parameters<typeof setSidebarSection>[0])` compiles. So does `as never`. So does `as
  SidebarSection`. **`setSidebarSection('pipeline')` — the form with no assertion — is the only
  one `tsc` rejects** (measured, §9). There is no type change that removes `as`; the fix is that
  the *value* must never be a free literal at the call site. Give each arrival source a typed
  record — `PowerMoveNav` (`powerMoves/registry.ts:13-20`) is the shape — so the literal is
  declared once, in a position the compiler checks, instead of at the setter.
- **A latch's consumer contract should be in the latch, not in each consumer. YES, and it is a
  ~20-line module.** Every one of the 12 landings re-derives "read, clear, guard, decide whether to
  subscribe", and they disagree (§7 D1). A `createArrivalLatch<T>()` returning `{ set, useArrival(fn) }`
  — where `useArrival` subscribes *and* drains on mount, so the mount-only variant is not
  expressible — deletes the whole of §7 D1 permanently. The census rule in §9 counts a *different*
  symptom precisely because this one is structural and a text matcher cannot see it (§9 item 3).

**And one that cannot be typed away, recorded as a real limitation.** *"The target still exists"*
is a runtime fact about a database, not a property of a type. No signature can make
`pendingExecutionFocus: string` mean "an execution that is still there". The tractable version is
the §2 (c) protocol — resolve, fetch once, give up loudly — enforced by a shared landing helper
rather than by a type. **This is the one the census cannot carry either: see §9 item 3, refused
with measurement.**

---

## 5. Anti-patterns

- **Reading a handoff latch in `useEffect(…, [])`.** 6 sites (§7 D1). It looks defensive — "read
  once, clear so it cannot re-fire" — and it is exactly backwards: the intent is dropped when the
  surface is already open, and the *undropped* value then re-fires on the next unrelated visit.
  **Proven by execution:** a deep link fired at a mounted surface lands nowhere and is still in the
  store; a later remount consumes it.
- **A `setTimeout` as the theory of whether a destination mounted.** `GuidedTour.tsx:122` (100 ms
  for the sub-tab), `:202` (300 ms for the highlight), `launchPowerMove.ts:9` (120 ms). Every one
  is a guess about a lazy chunk, an IPC round trip and a React commit. The repo contains a poll
  with a deadline, twice.
- **`storeBus.emit` as the only carrier of an intent.** `appActions.ts:31-33` navigates and then
  emits in the next statement, with a comment claiming *"Navigating to `credentials` first makes
  this safe to call from anywhere."* The emit is dropped when no one is listening and returns
  nothing to say so. The incident path in the same feature folder added a module latch for
  precisely this reason and wrote it down.
- **Returning `success: true` before a frame has rendered.** All 8 harness navigation ops
  (`bridge.ts:234, 255, 270, 282, 326, 587, 911`). `success` means "the string passed my
  allow-list", and the harness's own `waitFor(selector, 5000)` (`:515-525`) — which polls and
  checks `offsetParent !== null` — **is called by none of them.** Every automated test that
  navigates is therefore racing, and any test that then fails on a missing element reports the
  wrong cause.
- **Threading an entity id into a payload and never reading it.** 6 of the 12 notification kinds
  carry a `personaId` that no branch of `handleRedirect` consumes (§7 B2). The link looks deep and
  is not.
- **Landing silently when the target is gone.** 9 of 12 landings (§7 C). The user clicked
  something that named a specific thing and got a list.
- **A second (third, fourth) latch dialect.** A store field, a module singleton, a React context
  ref, and a bus event now coexist, none shares a type, and none is testable as a unit.
- **`as never` / `as Parameters<typeof setter>[0]` at a navigation setter.** 20 sites, 9 files
  (§9). It is the same disarming as `as SomeTab` with the additional property that **no audit
  keyed on the vocabulary's name can see it** — which is why the two ids in this repo that are not
  in any union at all are hiding here.
- **Believing `selectPersona` selected the persona.** It has a documented early return. 41 call
  sites, 0 checks, and the signature makes checking impossible.
- **A catch-all `else` in an arrival dispatcher.** `navigateToProcess.ts:29-31` — any section that
  is not `personas`/`plugins`/`teams` writes its `tab` into **`setTemplateTab`**.
  `NotificationCenter.tsx:117-124` — any section that is not `personas`/`plugins` writes its
  `redirectTab` into **the Overview tab**. A process pointing at `overview` mutates the Templates
  page; a notification pointing at `pipeline` mutates Overview.

---

## 6. Evidence

**The correct arrival exists in this repo, twice, and the two halves are in different files.**
Name them first, because §7 is otherwise a list of things nobody knew the answer to — and they did.

**The one site to copy — winning the race from both directions:**
`src/features/overview/sub_incidents/components/IncidentsInbox.tsx:154-181`. A mount-time latch
drain **and** a live subscription in one effect, with a `cancelled` guard and a
resolve-then-fetch for the id. Read `incidentDeepLink.ts:1-15` with it: the docstring explains the
lazy-mount race in five lines and is the best prose in the corpus for this leaf.

**The one site to copy — bounded resolution of the target:**
`src/features/overview/sub_activity/components/GlobalExecutionList.tsx:197-218`. Find in the loaded
page; one refetch on a miss; **give up on the second miss** rather than loop. The
`focusFetchAttemptedForRef` guard and its comment (*"an id that never appears (pruned row, or
beyond the page cap) refetched in a tight loop"*) are a fix for a real shipped bug and the only
bounded retry in the arrival surface.

**The one site to copy — waiting for a DOM target:**
`src/features/home/sub_learning/powerMoves/flashSpotlight.ts:36-56` (`waitForTestId`) together with
its caller's generation token at `:20-28`. Independently reinvented at
`src/features/plugins/companion/guidance/useGuidanceRunner.ts:33-58` with the same 4,000 ms/80 ms
constants and an added `isCancelled()`. **Two independent authors, one repo, no shared module.**

- `src/features/vault/shared/hooks/CredentialNavContext.tsx:23-37` — the only latch that **flushes
  itself**: `setNavigateHandler` delivers the pending key the instant a handler registers, so the
  receiver never has to remember to drain. That is the ergonomic property §4's
  `createArrivalLatch` should generalise.
- `src/features/recipes/sub_manager/components/RecipeManager.tsx:44-51` — three lines that test the
  handed-off id against the loaded collection before acting. Note the honesty of its comment: it
  states the id *"is guaranteed to be in the freshly fetched catalog"* and then checks anyway.
- `src/features/home/sub_learning/powerMoves/launchPowerMove.ts:29-33` — the only deferred
  navigation in the repo that guards the gap: *"the user can navigate again inside the delay …
  land it only if the section we routed to is still the one on screen."* The right instinct
  wrapped around the wrong mechanism.
- `src/features/plugins/companion/guidance/useGuidanceRunner.ts:219-229` — **awaits the anchor
  after navigating.** The guided tour, which does the same job on the same anchors, does not.
- `src/features/onboarding/components/TourPanelBody.tsx:191-199` — `data-testid="tour-target-missing"`,
  an amber in-panel note when the anchor never appears. **The only user-visible "I could not get
  you there" in the entire application.** It is the model for §4 step 5's "give up loudly", and it
  is confined to one feature.
- `src/test/automation/bridge.ts:515-525` — `waitFor(selector, timeoutMs)`, a correct polling
  primitive checking `offsetParent !== null`, sitting unused by every navigation op in its own file.
- `src/lib/storeBus.ts:60-66` — the `incidents:open-detail` doc comment, which states the race,
  names the latch that solves it, and says why. Documentation of a hazard at the exact place a
  future author will meet it.

---

## 7. Deviations found

**Five categories, 26 individually-addressable items.** All ship green under `npm run check`
(`tsc --noEmit`, `eslint src/`, `census:check`, `check:tiers`, `check:contracts`) and under the
full Vitest suite.

### A. The arrival entry points, counted — and one of them is a slot nobody uses — 4

**A1 — 58 sites name a destination AND a target within it.** Two independent implementations:

| | Impl 1 (12-line co-occurrence window) | Impl 2 (TS AST, innermost enclosing function) |
|---|---|---|
| arrival sites | **60 in 44 files** | **58 in 47 files** |

The disagreement is explained and in both directions: the text window merges two adjacent handlers
in one component into one hit, and it misses composites spread over more than 12 lines
(`GuidedTour.tsx:103-208`, `navigateToProcess.ts:16-40`, `useBreadcrumbTrail.ts:82-197` — the three
largest dispatchers in the corpus). **Neither implementation can see the four arrivals that cross a
process boundary**, which are counted separately in A2.

By target kind: `selectPersona` 22 · `setActiveProject` 8 · `setPending*Focus/Id` 9 ·
`setPendingPrompt` 2 · `restoreChatSession` 2 · `setPendingIncidentDeepLink` 2 · `flashSpotlight` 1
· `setMonitorInitialView`/`ChannelPreset` 1 · `setCompanionLabJump` 1.

**A2 — the entry points that originate OUTSIDE the frontend, and what each can name:**

| Entry point | Can name a place | Can name a target within it | Validated |
|---|---|---|---|
| OS `personas://` URL (`lib.rs:1604-1660`, 5 verbs) | **no** | **no** | n/a — see the brief note |
| Rust `ClientAction::Navigate { route: String }` (`api/companion.ts:1127`) | yes, 1 bare string | **no** | allow-list, then silent `return` |
| Tauri `companion_open_lab` (`athenaChatNavigation.ts:129-148`) | yes (+ editor tab) | **yes — `personaId`** | truthiness only |
| Athena proactive nudge (`ProactiveCard.tsx:39-70`) | yes | **yes — `triggerRef` as an incident id** | truthiness only |
| Test harness HTTP (`bridge.ts`, 8 nav ops + `openMatrixAdoption`) | yes | **yes — a row id, interpolated raw into a selector** (`:1023`) | 7 of 8 allow-list the place; **0 validate the target** |
| Guided tour step (`tourSlice.ts:208-212`, 44 steps) | yes (+ sub-tab by *setter name string*) | **anchor `data-testid` only** | shape only (`/^[a-zA-Z0-9_-]+$/`) |
| Notification bell (`NotificationCenter.tsx:87-126`) | yes | **yes — 3 kinds** | **none at all** |
| Toast action slot (`toastStore.ts:18-21`) | yes | **no — the slot has no id field** | n/a |

**A3 — four of the twelve single-slot handoff channels are dead code, and one of them is a whole
feature's deep-link API.** Measured by resolving every producer and consumer of each channel
repo-wide:

| Channel | Declared | Producers | Consumers |
|---|---|---|---|
| `pendingLifecycleSubTab` | `uiSlice.ts:147` (+ setter `:277`, `:535`) | **0** | **0** |
| `canvasEdgeFocus` | `uiSlice.ts:162` (+ setter `:282`, `:540`) | **0** | **0** |
| `liveStreamHighlightEventId` | `uiSlice.ts:163` (+ setter `:283`, `:541`) | **0** | **0** |
| `pendingCatalogCategoryFilter` | `uiSlice.ts:143` | **0** | 1 (`usePickerFilters.ts:47-51`, which reads and clears a value nothing ever writes) |

`canvasEdgeFocus` and `liveStreamHighlightEventId` sit under a section header reading
`// Canvas <-> Live Stream cross-linking` — a named cross-surface feature with a documented
payload shape, a public setter, and no implementation on either side. `pendingCatalogCategoryFilter`'s
docstring describes its producer (*"the template adoption modal redirecting to the catalog when a
credential is missing"*) in the present tense; that producer does not exist.

**A4 — the toast's action slot is the one arrival channel that cannot carry a target, and it has
one user.** `ToastAction` is `{ label, onClick }` (`toastStore.ts:18-21`) — no id field —
and **1 of 475 `addToast` call sites passes one** (`eventBridge.ts:576-582`, navigating to Overview
→ Memories with no memory id). Independently measured and identically reported by
[`toasts.md`](./toasts.md) §7.H. The five auto-derived error nav actions
(`errorActionNav.ts:24-39`) likewise carry only a section. So the friendliest arrival surface in
the product — *"the thing you just did finished, go look at it"* — is structurally incapable of
pointing at the thing.

### B. An arrival ships a place that does not exist — 3 sites, and it is a crash — 5

**B1 — three shipped surfaces pass `setSidebarSection` an id that is not in `SidebarSection`.**
The union has 11 members (`types.ts:409`, re-read and printed by the probe below).

| Site | Value | How it gets past `tsc` |
|---|---|---|
| `CompanionAssignmentCards.tsx:23` | `'pipeline'` | `as Parameters<typeof setSidebarSection>[0]` |
| `useAssignmentNotificationDispatcher.ts:60` → `NotificationCenter.tsx:91` | `'pipeline'` | a bare string literal in a notification payload, cast at the single door |
| `eventBridge.ts:1002` → `NotificationCenter.tsx:91` | `'agents'` | same |

**B2 — the failure is a `TypeError` during render, measured by execution.** Vitest, importing the
real `registry.ts` and `sectionRouter.tsx` unmodified:

```
ALL_SIDEBAR_SECTIONS = ["home","overview","teams","personas","events","credentials",
                        "design-reviews","plugins","studio","schedules","settings"]

pipeline    navSection=undefined  isRoutable=false
            railSection=THROWS(TypeError: Cannot read properties of undefined (reading 'parent'))
            isSectionGated=THROWS(TypeError: Cannot read properties of undefined (reading 'gates'))
agents      … identical …
```

`isSectionGated` is the **first** statement of `PersonasPage.renderContent` (`:247`) and
`railSection` is called by `Sidebar.tsx:215`, so both the content area and the rail throw.
`sidebarSection` is persisted (`persona-ui-system`), so **the broken state survives a restart**;
`main.tsx:167` reads it back with `section as SidebarSection` after a `typeof === "string"` check.
This is `navigation-destination.md` §7 A's mechanism, reached by a live arrival rather than by a
schema change — which is why it belongs in both documents.

**B3 — 6 of 12 notification kinds carry a `personaId` that no branch ever reads.**
`eventBridge.ts:603`, `:929`, `:998`, `checkHumanReviews.ts:23`, and two more. `handleRedirect`
(`NotificationCenter.tsx:87-126`) reads `personaId` only inside the
`redirectSection === 'personas' && redirectTab === 'chat'` branch.

**B4 — the payload outlives the code that wrote it.** `notificationCenterStore.ts:56-57` persists
the history to `localStorage` capped at **50 entries with no expiry**. A `redirectSection` literal
written by a release three versions ago is replayed verbatim through the blind cast at `:91` when
the user clicks it. See [`client-state-persistence.md`](./client-state-persistence.md).

**B5 — `navigateToProcess`'s dispatcher has a catch-all that writes an unrelated vocabulary.**
`navigateToProcess.ts:22-31`: `personas` → `setEditorTab`, `plugins` → `setDevToolsTab`, `teams` →
`setTeamsTab`, **`else` → `setTemplateTab(tab as 'n8n' | 'generated')`.** A process declaring
`{ section: 'overview', tab: 'executions' }` sets the *Templates* tab to `'executions'`.
`NotificationCenter.tsx:117-124` has the same shape with the Overview tab as its `else`.

### C. The target is assumed to exist — 9 of 12 landings — 6

**C1 — the miss behaviour of every landing, read from the source:**

| Landing | Resolves the target? | On a miss |
|---|---|---|
| `GlobalExecutionList.tsx:197-218` (`pendingExecutionFocus`, **4 producers**) | yes — find, then one refetch | clears and **stops — silently**. Indistinguishable from "beyond the page cap", as its own comment says |
| `IncidentsInbox.tsx:154-181` (`incidentDeepLink` + bus, 2 producers) | yes — find, then `getAuditIncident` | `silentCatch`; **no modal, no message** |
| `RecipeManager.tsx:44-51` (`pendingPlaygroundRecipeId`) | yes — `recipes.some` | silent `return`; the latch is already cleared, so the intent is **lost permanently** |
| `RunDeskPage.tsx:63-84` (`pendingTaskFocusId`, 2 producers) | no — waits for a DOM node | **never gives up.** No deadline, no counter, no signal |
| `GoalConstellation.tsx:26-30` (`pendingGoalSpotlightId`, 3 producers) | no | opens `GoalDetailDrawer` on an id that may not exist |
| `FactoryShell.tsx:59-69` (`pendingFactoryFocus`) | no | sets `projectId` to a possibly-deleted project |
| `ManualReviewList.tsx:74-79` (`pendingApprovalsMode`) | n/a (a mode, not an entity) | — |
| `PersonaMonitor.tsx:56-75` (`monitorInitialView` + preset) | no | a team/persona filter that may match nothing |
| `Composer.tsx:169-186` (`pendingPrompt`, **8 producers**) | n/a (text) | — |
| `usePickerFilters.ts:47-51` | n/a | **dead channel** (A3) |
| harness `openMatrixAdoption` (`bridge.ts:1016-1062`) | no — raw selector interpolation `:1023` | returns before the destination settles, by design (`:1060`) |
| `athenaChatNavigation.ts:129-148` (`personaId` + Lab tab) | no | `selectPersona` throw is swallowed (`:138-142`) **and the navigation proceeds anyway** — the user lands on the Lab with nothing selected |

**9 of 12 land silently on a miss. 0 of 12 tell the user.** The one user-visible "I could not get
you there" in the app is the tour's amber note (`TourPanelBody.tsx:191-199`), and it is about a DOM
anchor, not a record.

**C2 — the unbounded landing, proven by execution.** `RunDeskPage.tsx:72-84` waits for
`[data-task-id="…"]` and re-runs on every `tasks.length` change. Reproduced verbatim under React
Testing Library with an id that never arrives:

```
F1 target never arrives: 8 data updates + 60s elapsed; rows=11;
   no give-up path exists, no user-visible signal
```

Its producer makes the miss likely rather than exotic: `BacklogPanel.tsx:198` focuses
`result.dispatched[0].taskId` — a task created milliseconds earlier, whose status must survive the
Run Desk's own `statusFilter`.

**C3 — and when it *does* hit, the landing affordance is permanent.** Same reproduction:

```
E1 immediately after landing: class="ring-2 ring-primary/60"  scrollIntoView=1
E2 after 5s (ring should be gone): class="ring-2 ring-primary/60"
E3 after a data update + 5s more: class="ring-2 ring-primary/60"
```

The effect adds the ring, arms a 2,000 ms removal timer, then calls `setPendingFocusId(null)` —
which changes a dependency, so React runs the effect's own cleanup, which **clears the removal
timer**. The classes were applied through `classList.add` on a node React does not own, so nothing
takes them off. The row stays highlighted for the life of the mount.

**C4 — `selectPersona` can silently decline, and 41 call sites cannot tell.** `personaSlice.ts:470-473`:
an unsaved editor turns `selectPersona(id)` into a no-op that stashes into `pendingSelectPersonaId`.
The signature is `=> void` (`:78`). Every arrival that pairs `selectPersona` with a section/tab
write therefore has a documented path to *place changed, target unchanged*. **No membership check
either** — a deleted persona sets `selectedPersonaId` and derives `selectedPersona: null`.

**C5 — the harness reports success for a navigation it did not verify.** All 8 nav ops return
`{ success: true }` synchronously after a Zustand setter; five are not even declared `async`
(`bridge.ts:53, 54, 111, 114, 115`). `openSettingsTab` (`:909-913`) performs **no validation of any
kind** and still returns success. A `waitFor` primitive is 400 lines up in the same file, unused
by any of them.

**C6 — the tour's sub-tab is dispatched by matching a setter *name* string, and 5 steps fall
through.** `GuidedTour.tsx:121-153` is an if-ladder over `step.nav.subTabSetter` handling exactly
7 names, inside a 100 ms `setTimeout`, with **no `else` and no warning**. Of 44 steps, **28 declare
a `subTab` and only 23 declare a `subTabSetter`** — the 5 without one are the entire
`plugins-explorer` tour (`tourSlice.ts:481, 496, 510, 525, 540`), which needs `setPluginTab` and
that branch does not exist. Those steps land on whichever plugin tab was last open and then
spotlight `companion-panel` / `twin-page` / `dev-tools-page`, anchors that are not mounted.

### D. Nine answers to "the target is not here yet", and they contradict each other — 6

**D1 — the latch-read contract splits 6/4 and the mount-only half is broken.** Of the 10 live
latch consumers: **6 read inside `useEffect(…, [])`** (`usePickerFilters.ts:47`,
`ManualReviewList.tsx:74`, `RunDeskPage.tsx:66`, `GoalConstellation.tsx:26`,
`IncidentsInbox.tsx:154`, `RecipeManager.tsx:44` — the last two are safe only because they also
subscribe or key on data); **4 subscribe** (`FactoryShell.tsx:59`, `PersonaMonitor.tsx:56` and
`:68`, `Composer.tsx:169`). Reproduced verbatim under React Testing Library:

```
D1 deep link fired while mounted -> landed=[]         storeStillHolds=goal-A
D2 unrelated later remount       -> landed=["goal-A"] (stale intent fired)
```

**Both halves are defects and the second is the nastier one:** the intent is not merely lost, it is
*retained*, and it fires the next time that surface happens to mount — a spotlight or a detail
modal popping open on a visit the user did not connect to anything.

**D2 — `storeBus.emit` drops an intent with no listener and cannot report it.** Executed against
the real module:

```
EMIT-BEFORE-ON  handler calls = 0     <- the lazy-mount race
EMIT-AFTER-ON   handler calls = 1
EMIT-AFTER-OFF  handler calls = 1     <- destination unmounted: dropped
EMIT RETURN VALUE = undefined         <- the sender cannot know
```

Two of the twelve event kinds are cross-surface intents. **`incidents:open-detail` has a latch;
`tour:navigate-credential-view` does not** — and its two producers disagree about the fix:
`GuidedTour.tsx:160` wraps the emit in a 150 ms timer, `appActions.ts:31-33` emits immediately with
a comment asserting safety. Neither is a latch. (In practice both currently land, because
`CredentialNavProvider` wraps the whole content area at `PersonasPage.tsx:375` and is always
mounted — the safety is an accident of where one provider happens to sit, not a property of the
mechanism, and `CredentialNavContext.tsx:50` still casts the payload `key as CredentialNavKey`
with no membership check.)

**D3 — nine distinct "not yet" strategies.** (1) no wait at all; (2) fixed timer — 100/120/150/300 ms
across three files; (3) `void import(store).then(set…)`; (4) `.finally()` after an unrelated async
precondition (`navigate.ts:24`, `:39`); (5) store-latch drained on mount; (6) module-singleton latch
(`incidentDeepLink.ts`); (7) React-context latch + handler ref, self-flushing
(`CredentialNavContext.tsx:23`); (8) DOM poll with a deadline — **written twice, 4,000 ms/80 ms,
independently** (`flashSpotlight.ts:36`, `useGuidanceRunner.ts:33`); (9) re-run-on-data-change with
no deadline (`RunDeskPage.tsx:72`). **None shares a type with any other; two are cancellable; one is
unbounded.**

**D4 — 16 navigation or target writes happen inside a deferring callback**, in 12 files (AST): 3 ×
`setTimeout`, 11 × `.then`, 2 × `.finally`. Four are structurally forced — `overviewTab` lives in a
separate lazily-imported store, so reaching an Overview tab is asynchronous by construction
(`CommandPalette.tsx:207`, `TriggersPage.tsx:64`, `QuickStatsBar.tsx:94`,
`NotificationCenter.tsx:118`). **Only `launchPowerMove.ts:33` re-checks that the user is still where
it sent them.** This extends `navigation-destination.md` §7 D2's count of 6 deferred *composites* to
16 deferred *writes* — the wider figure because a deferred target write races just as a deferred tab
write does.

**D5 — the anchor-wait primitive exists three times and the highest-traffic consumer got the weakest
one.** `waitForTestId` is declared twice, verbatim in behaviour; `/^[a-zA-Z0-9_-]+$/` is declared
**four times** (`flashSpotlight.ts:30`, `useGuidanceRunner.ts:25`, `useTrackedElementRect.ts:34`,
and `tourSlice.ts:189` where it is `export`ed as `TOUR_TEST_ID_PATTERN`), with three of the four
carrying a comment explaining why they did not import the other. The guided tour resolves its anchor
through `useTrackedElementRect`, whose **initial** probe is a single `setTimeout(…, 100)` that calls
`reportMissing()` on the first miss (`:176-185`); the 4 × 500 ms retry budget at `:136-154` is
reachable only from `handleReposition`, i.e. only after a successful attach. **An anchor that was
never there gets 300 ms + 100 ms. Athena's walkthrough runner, doing the same job, gets 4,000 ms and
awaits it.**

**D6 — the deep link's own scheme cannot deep link.** The five `personas://` verbs
(`lib.rs:1610-1658`) carry an auth code, a share URL, a gallery slug, a referral code and a pairing
request. There is no `personas://open/<section>/<id>`. Every in-app arrival is therefore
process-internal, which is why none of it is addressable, shareable, or testable from outside.

### E. Nobody is told they arrived — 0 of 58 — 3

**E1 — focus is moved by no arrival.** Of the 58 arrival sites, **0** call `.focus()` on the target,
set `tabIndex={-1}` on it, or reset focus to the destination's heading. The corpus is not
focus-illiterate — there are 91 `.focus()` calls in `src/` — but none is on an arrival path. The
count matches [`anchored-popover.md`](./anchored-popover.md)'s 0-of-63 finding on its own corpus.

**E2 — the arrival is announced by no arrival.** `announceImperative` (`toastStore.ts:138`) exists
and is used for toast *creation*. No arrival calls it. The tour's `aria-live="polite"` on its step
header (`TourPanelBody.tsx:90`) announces the *step text*, never the target. The one landing
affordance that paints something on the screen — `flashSpotlight`'s ring — sets
`aria-hidden="true"` on it (`flashSpotlight.ts:80`), correctly for a decorative ring and with
nothing accessible put in its place.

**E3 — the two chrome surfaces that raise arrivals both destroy focus on click.** The toast action
button (`ToastContainer.tsx:120-128`) and every notification row (`NotificationCenter.tsx:128-138`)
run their handler and then unmount themselves (dismiss / `setHeaderOverlay('none')`), dropping focus
to `<body>`. The notification rows are `<div onClick>` with `cursor-default` and no `role`/`tabIndex`,
so they are not keyboard-reachable at all — which is
[`focus-management.md`](./focus-management.md)'s `unfocusable-click-target` condition sitting on the
app's second-largest arrival surface.

### F. The harness cannot drive the arrivals it is supposed to certify — 2

**F1 — 0 of 8 harness navigation ops wait for the destination**, and `openMatrixAdoption` — the one
op that names a row — interpolates the id straight into a `querySelector` (`bridge.ts:1023`) with no
sanitisation, while `tourSlice.ts:1626` and `useTrackedElementRect.ts:34` both sanitise at the same
kind of boundary. `clickTestId` (`:803`) and `fillField` (`:786`) do the same.

**F2 — no automated test can drive any of the twelve handoff channels.** The harness exposes no
operation that sets `pendingExecutionFocus`, `pendingTaskFocusId`, `pendingGoalSpotlightId`,
`pendingFactoryFocus`, `monitorInitialView`, `pendingPlaygroundRecipeId`, or the incident latch, and
none that fires a `storeBus` intent. **Every defect in §7 C and §7 D is unreachable from the test
harness**, which is why they all ship green.

---

## 8. Gaps in the primitive

1. **There is no `Arrival`/`DeepLink` type.** A destination + a target is expressed as two
   independent store writes with no relation between them, so nothing can say "this arrival is
   incomplete", "this arrival superseded that one", or "this arrival failed". Every §7 C and §7 D
   defect is downstream of this.
2. **There is no shared latch.** Four dialects (store field, module singleton, context ref, bus
   event), 12 channels, 10 consumers, two contradictory read contracts. The correct ergonomics
   already exist in one of them — `CredentialNavContext`'s self-flushing handler registration — and
   have not been generalised.
3. **`storeBus` has no replay and no delivery result.** `emit` returns `void` and drops silently
   when the listener set is empty (`storeBus.ts:97`). For a toast that is right; for an intent it is
   the race. A `emitSticky`/`emitLatched` variant that retains the last payload per event until a
   subscriber drains it would delete `incidentDeepLink.ts` entirely and fix
   `tour:navigate-credential-view` for free.
4. **There is no landing protocol.** "Resolve, fetch once, give up loudly" is implemented in
   fragments across three files and completely by none: `GlobalExecutionList` has the bound but not
   the message, `RecipeManager` has the check but not the fetch, `IncidentsInbox` has the fetch but
   not the bound. **No arrival in the app tells the user the thing it named is gone.**
5. **`selectPersona` cannot report refusal or absence.** `=> void`, a documented dirty-editor early
   return, no membership check, 41 call sites. §4 records the type fix.
6. **The `personas://` scheme has no navigation verb.** Adding `personas://open/<section>[/<id>]`,
   resolved through one total `resolveArrival(unknown): Arrival | null`, would buy **persistence
   and addressability** — an arrival that survives until something reads it, and one that can be
   driven from outside the process, which §7 F2 says none currently can. **It would buy nothing
   about delivery:** the Convergence section measures four post-mount applications and one
   lazy-mount miss across the two URL-routed siblings. Do not adopt a URL expecting it to fix
   §7 D.
7. **`useTrackedElementRect`'s retry budget does not cover the case it is needed for.** The
   asymmetry at `:176-185` vs `:136-154` is almost certainly unintentional; making the initial probe
   use `scheduleMissingRetry()` is a one-line change that would give the tour a 2 s budget instead
   of 100 ms.
8. **Nothing links a notification/tour/power-move payload to the vocabulary it names.**
   `redirectSection` is `string`, `nav.sidebarSection` is `string`, `nav.subTabSetter` is a
   *function name* as a string. Typing these three fields to their unions turns §7 B1 and §7 C6 into
   compile errors and costs three words.

---

## 9. The missing gate

**Every deviation above ships green.** `census:check`'s 78 rules were read rule by rule before
writing this. Four neighbours were checked specifically and none shares a signal, a token or a
target: `unchecked-destination-id-assertion` (the immediate neighbour — keys on `as
<NamedVocabulary>`), `deferred-read-then-write` (Rust SQLite transactions),
`unverified-effect-dispatch` (`let _ =` on a Tauri emit), `module-scope-install-latch` (a
`let x = false` one-way HMR latch — adjacent in spirit, disjoint in signal).

### 1. Census rule — `unnamed-cast-at-navigation-door`

**The condition (stack-free):** *an intent arriving from outside a surface — a persisted payload,
tour data, an HTTP harness, an IPC event — is written into that surface's navigation state through
an escape hatch that names nothing, so neither the compiler nor any audit keyed on the destination
vocabulary can read the value.*

**The proxy in this repo:** a navigation setter whose argument is asserted through `as never`,
`as unknown`, or `as Parameters<typeof setter>[0]`.

**Why this is not the neighbour's rule, measured.** `unchecked-destination-id-assertion`'s
alternation is a list of 24 vocabulary **names** after `as`. This one matches only the spellings
that name nothing. One harness ran both patterns over the same 4,829 files: neighbour **19 files /
54 matches** (exactly its committed baseline — which is what validates the harness rather than the
rule), this rule **9 files / 20 matches**, **zero shared matches**; 4 files carry both, because a
file can hold one call of each shape.

**And the anonymous spelling is strictly worse, proven with the compiler.**
`npx tsc --noEmit --strict --ignoreConfig` over a four-line fixture declaring the real
`SidebarSection`:

| Form | Result |
|---|---|
| `setSidebarSection('pipeline' as SidebarSection)` | **compiles** |
| `setSidebarSection('pipeline' as Parameters<typeof setSidebarSection>[0])` | **compiles** |
| `setEditorTab('nope' as never)` | **compiles** |
| `setSidebarSection('pipeline')` | **error TS2345** |

**The one form the compiler rejects is the one nobody writes.** And `'pipeline'` is not a member
of the union — `CompanionAssignmentCards.tsx:23` ships it, and §7 B2 shows what the router does
with it. A rule keyed on the vocabulary's *name* cannot see any of that, by construction, because
the name is never written.

```json
{
  "rules": [
    {
      "id": "unnamed-cast-at-navigation-door",
      "goldenPath": "docs/concepts/golden-paths/cross-surface-deep-link.md",
      "title": "An arriving deep link is asserted into a navigation setter through a cast that names no vocabulary, so neither the compiler nor the vocabulary-named census rule can see the value",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\b(?:setSidebarSection|setHeaderOverlay|setApprovalsMode|set[A-Z][A-Za-z]*Tab)\\s*\\(\\s*[^()]{0,160}?\\bas\\s+(?:never\\b|unknown\\b|Parameters\\s*<)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a navigation setter whose argument is asserted through a cast that names no destination vocabulary - `as never`, `as unknown`, or `as Parameters<typeof setter>[0]`. PROXY FOR the stack-free condition: an intent arriving from outside a surface (persisted notification payload, tour data, an HTTP harness, an IPC event) is written into that surface's navigation state through an escape that neither the compiler nor a vocabulary-named audit can read.",
        "$measured": "9 files / 20 matches / 4829 files walked, 2026-08-15 at master. Population: GuidedTour.tsx:124,126,128,134,138,145,150 (7 - the tour's stringly-named sub-tab if-ladder, carrying `step.nav.subTab: string` from tour data); NotificationCenter.tsx:91,100,111,112,119 (5 - the single door every notification-bell deep link passes through, carrying a `redirectSection`/`redirectTab` string read back out of localStorage); bridge.ts:587,911 (2 - the HTTP test harness; :911 openSettingsTab has NO validation of any kind and still returns {success:true}); CompanionAssignmentCards.tsx:23, athenaChatNavigation.ts:145 (2 - Athena); navigateToProcess.ts:23 (1); QuickAnswerBody.tsx:25, QuickAnswerPopover.tsx:58 (2); CodebaseProjectPicker.tsx:102 (1).",
        "$whyThisIsNotTheNeighbourRule": "STRICTLY DISJOINT AT THE MATCH LEVEL, by construction, from `unchecked-destination-id-assertion` (navigation-destination.md), whose alternation is a list of 24 vocabulary NAMES after `as`. This one matches only `as never|unknown|Parameters<` - the spellings that name nothing. Verified with one harness running both patterns over the same tree: neighbour 19 files / 54 matches (exactly its committed baseline, which validates the harness), this rule 9 files / 20 matches, ZERO shared matches; 4 files carry both. The disjointness is the point: the live defects in this population are INVISIBLE to a vocabulary-named rule precisely because they never write the vocabulary's name.",
        "$whyTheAnonymousSpellingIsWorse": "MEASURED BY EXECUTION (npx tsc --noEmit --strict --ignoreConfig on a 4-line fixture): `setSidebarSection('pipeline' as SidebarSection)` compiles; `setSidebarSection('pipeline' as Parameters<typeof setSidebarSection>[0])` compiles; `setEditorTab('nope' as never)` compiles; `setSidebarSection('pipeline')` is the ONLY one that errors (TS2345). The compiler rejects exactly the form nobody writes. `'pipeline'` is not a member of SidebarSection - and CompanionAssignmentCards.tsx:23 ships it, as do two notification producers relayed through NotificationCenter.tsx:91 (eventBridge.ts:1002 'agents', useAssignmentNotificationDispatcher.ts:60 'pipeline'). Running the real registry + sectionRouter modules under Vitest against those ids: navSection=undefined, isSectionGated=THROWS(TypeError: Cannot read properties of undefined (reading 'gates')), railSection=THROWS(... reading 'parent'). isSectionGated is the FIRST statement of PersonasPage.renderContent, and sidebarSection is persisted, so the crash survives a restart.",
        "$falsePositiveNote": "Two independent implementations. (1) A standalone whole-file text matcher with its own walker and (2) the census engine's scanRule both return 9 files / 20 matches over 4829 walked files. `[^()]{0,160}?` is load-bearing: it cannot run past the setter's own argument list into a neighbouring call. `typeof` is DELIBERATELY EXCLUDED from the alternation even though it was in the first draft: it added bridge.ts:256,270,283 (`as typeof VALID_PLUGIN_TABS[number]`), which are each preceded by a real `includes()` membership check. Those are the weakest members of the population and a gate that fires on a checked value is worse than no gate, so the line is drawn at 'the assertion names no checkable set at all'. Their real defect - the hand-written list has drifted from the vocabulary (VALID_PLUGIN_TABS omits `scraper`, VALID_TEMPLATE_TABS omits `explore`) - is catalog drift and belongs to navigation-destination.md, not here. Of the 20 that DO match, 2 currently carry a value outside its union; the other 18 currently carry valid values and are counted because the cast is what removes the compiler's ability to say so, which is the whole condition. PRECONDITION, and an adopting repo must re-derive its own: this works because Personas' navigation setters take closed string unions, so the compliant form carries no assertion token at all. A repo whose destinations are filesystem routes (personas-web: 37 page.tsx, ZERO such casts) scores zero here while the arrival condition is present at full scale in another form."
      },
      "baseline": { "files": 9, "matches": 20 },
      "floor": 4000
    }
  ]
}
```

**Validated standalone** from a scratchpad rule file named uniquely to this composition
(`census-crosssurface-9a3f1c.json`; the pattern lives in a file, never in bash argv, and contains no
lookbehind), then **re-extracted from this finished document and re-run — same counts.** Clean run:

```
  OK   unnamed-cast-at-navigation-door      9      9       20     20    4829   4000
```

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules <file>`):

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK … 9 9 20 20 4829 4000` — surviving counts printed |
| matcher matches nothing (setter names replaced) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped 9 → 0` / `20 → 0` |
| floor above walk (`floor: 9000`) | **1** | `walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src/lib`) | **1** | `walked 1267 … floor is 4000` + `zero matches` + both drops |
| count rises (baseline 8) | **1** | `[drift] matches rose 8 → 20 (+12)` |
| renamed root (`srcc`) | **1** | `walked 0 files but floor is 4000` + `matched zero files anywhere` |
| count drops (baseline 60) | **1** | `[drift] matches dropped 60 → 20 (-40) without the baseline moving` |
| stale `exclude` | **1** | `exclude "…/Gone.tsx" matched no file. The exemption is stale…` |
| `exclude` with a 7-char `reason` | **1** | schema refusal before any scan |
| invalid regex | **1** | `signal.pattern is not a valid RegExp` before any scan |
| positive control carrying a baseline | **1** | `a positive control must NOT carry a baseline — it exists to fail` |

Eleven faults, eleven loud failures. **Expected trajectory: down to a small residue, not to zero.**
The 7 tour sites vanish when `TourStepDef.nav` is typed to its unions (§8 gap 8); the 5
notification-centre sites vanish with `redirectSection: SidebarSection`; the harness's 2 are the
last to go. Terminal state 2–4. **If it ever reaches 0 the rule must be deleted rather than
baselined at zero** — the engine treats a zero-match rule as a broken matcher, correctly.

**Positive control — an anchor-discrimination control.**

```json
{
  "id": "cross-surface-deep-link-positive-control",
  "goldenPath": "docs/concepts/golden-paths/cross-surface-deep-link.md",
  "title": "POSITIVE CONTROL - not a gate. Do not merge.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bas\\s+(?:never\\b|unknown\\b|Parameters\\s*<)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the anchor-discrimination control for unnamed-cast-at-navigation-door. IDENTICAL assertion alternation, with the navigation-setter anchor removed. Measured 2026-08-15: 202 files / 410 matches, versus the rule's 9 files / 20 matches - a 20.5x ratio, and the rule's population is a STRICT SUBSET by construction (the rule is this pattern plus a required prefix). Its purpose is to show that the discriminating power is the NAVIGATION SETTER, not the anonymous cast: a signal keyed on `as never|unknown|Parameters<` alone reports every escape hatch in the repo, 390 of which have nothing whatsoever to do with arriving at a destination and about which this path says nothing. Deliberately carries no baseline - the census runner REFUSES a baselined positive control ('a positive control must NOT carry a baseline - it exists to fail'), so it was validated in report mode, which prints an em-dash in the baseline columns."
  },
  "floor": 4000
}
```

**Both populations, measured with the runner itself:** the rule matches **9 files / 20 matches**;
the control **202 files / 410 matches**; the control's 390-match remainder is precisely the
population an anchor-blind rule would falsely flag. This is a containment control, which is the
honest shape here — the rule is the control plus a required prefix. **Do not merge this block.**

### 2. Extend `registry.test.ts` — the gate that fails on the first run (≈35 lines)

The census rule counts the *cast*. This test catches the *value*, and it is the higher-value half.
`src/lib/navigation/registry.test.ts` already enumerates and asserts in both directions.

- **Every `redirectSection` literal reaching a notification is a member of `ALL_SIDEBAR_SECTIONS`.**
  Export the payload builders (or assert over the union of literals in
  `addProcessNotification` call sites). **Fails today on `'agents'` (`eventBridge.ts:1002`) and
  `'pipeline'` (`useAssignmentNotificationDispatcher.ts:60`).**
- **Every `TourStepDef.nav.sidebarSection` is a member, and every `nav.subTabSetter` is one of the
  7 names the ladder handles, and every step with a `subTab` has a `subTabSetter`.** **Fails today
  on 5 steps** (§7 C6).
- **Every `redirectSection` in a persisted notification history is resolved, not asserted**: assert
  `resolveSection(<retired literal>) === 'home'` rather than a throw — the regression guard for
  §7 B2 and the shared half with `navigation-destination.md` §9 item 2.
- **How it fails loudly if its own precondition is absent** — copy the `checked > N` shape this repo
  already treats as the model (`ipc_auth.rs:971-976`): assert
  `NOTIFICATION_REDIRECTS.length >= 10` and `TOUR_STEPS.length >= 40` *before* asserting anything
  about them. A catalog that imports as an empty array must not read as "no drift".

### 3. REFUSED — a census rule on "the landing does not verify its target exists"

This is the highest-value condition in the leaf (§7 C: 9 of 12 landings) and the census runner
**provably cannot host it.** Measured, in ascending order of fatality:

1. **It is a relation between a producer and a consumer in different files**, and `scanRule`
   (`scripts/census/lib/engine.mjs:147-239`) opens one source, applies one regex, counts.
   *"`BacklogPanel.tsx:198` parks a task id that `RunDeskPage.tsx:72` waits for without a
   deadline"* needs both files at once.
2. **The defect is an absence.** "No existence check before acting on the handed-off id" has no
   token. The compliant form is three lines of ordinary code (`recipes.some(...)`) that looks like
   every other `.some()` in the repo.
3. **The landings have nothing textual in common.** A `find` (`GlobalExecutionList`), a `some`
   (`RecipeManager`), a `querySelector` retry (`RunDeskPage`), a list-then-IPC-fetch
   (`IncidentsInbox`), a bare `setState` (`GoalConstellation`, `FactoryShell`). A regex tuned to one
   scores zero on the other four.
4. **The mount-only variant nearly works and is still wrong to ship.** A pattern for
   *"a `.pending…` read inside `useEffect(…, [])`"* matches 6 sites in 6 files — but 2 of the 6
   (`IncidentsInbox`, `RecipeManager`) are **correct**, because they also subscribe or key on data.
   A one-in-three false-positive rate on a six-match population is exactly the shape the contract
   forbids: *a gate that fires on correct content is worse than no gate.* Refusing is the finding.

**Specify item 2's test instead**, and take the structural fix in §4 — `createArrivalLatch<T>()`
whose `useArrival` subscribes and drains, so the mount-only variant is not expressible. A type
removes the class; the census can only count a symptom of it, and the symptom it can count
cleanly is the cast, which is item 1.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. **Not because warnings drown in a large baseline** — the baseline is 1,135
([`shared-facts.json`](../shared-facts.json)) and the volume argument is not available at any count.
The count-independent argument is the only one that holds: `npm run check` runs `eslint src/` with
**no `--max-warnings`** (`package.json:51`), and the pre-commit hook runs `--quiet --max-warnings
99999`, where `--quiet` discards warnings before they can be counted. **A warn-level rule enforces
nothing at either gate, by construction.**

---

## Convergence — the oracle inverted my own headline, and this is the corrected version

Checked read-only against `../personas-web` (Next.js App Router; 17 navigational `#fragment` hrefs,
40 distinct fragment targets, 4 URL params, 5 dynamic route segments) and `../brainiac/console`
(Next.js, modules on one `?m=` route; 8 fragment hrefs, 26 distinct targets, 3 param classes).

### ⚠ What I had written, and what the measurement says instead

**The draft of this section argued that "a URL answers the arrival race structurally, because a URL
is a value read during render rather than an event dispatched at a moment." That is wrong, and the
oracle refuted it with the two siblings' own code.** It is recorded here rather than deleted,
because the reasoning is seductive and the next composer will reach for it too.

- **A URL is only read during render if you read it during render.** Measured: **four post-mount
  applications across the two siblings** — `personas-web`'s `LegalContent.tsx:49,58-74` initialises
  its tab to `"privacy"` and applies the real hash in a **`setTimeout(…, 0)`** inside a mount
  effect (a documented, e2e-covered flash of the wrong target); `brainiac`'s `CortexMap.tsx:41,46-55`
  and `IngestMonitor.tsx:41,46-55` both `useState("starchart")` and then `setActive` from `?view=`
  in an effect. That is `PersonaMonitor.tsx:56-63`'s shape, in a URL-routed app, twice.
- **And the sharpest case is not discipline at all — it is lazy mounting.** `personas-web`'s
  most-linked fragment is `/#download` (**10 links plus a server redirect** at
  `app/api/download/route.ts:73`). `id="download"` lives at `sections/DownloadCTA.tsx:40`, **inside
  a `LazyMount` placeholder** (`app/page.tsx:58`, `gate: true`). On a cold `GET /#download` the
  element **is not in the document**, the browser finds no fragment, and the user lands at the top
  of a very long page. The always-rendered wrapper carries a *different* id (`"download-section"`),
  and `LazyMount.tsx:15`'s own comment claims the reserved height *"keeps scroll-map anchors
  meaningful"* — the reserved height keeps the scroll geometry; it does not put the id in the DOM.
  **There is no effect to catch it, because neither repo has a single hash-scroll effect
  (measured: 0 and 0).**

So the corrected statement is: **the URL buys persistence of the intent, not delivery of it.** The
intent survives in the address bar until something reads it — which is exactly the property
`incidentDeepLink.ts`, `CredentialNavContext`'s `pendingKey` and the twelve store latches hand-build
four different ways, and that much is real. It buys **nothing** about whether the receiver existed
when the read happened. "Has the destination mounted yet" is the same race in a store-driven desktop
app and in a lazily-mounted Next.js page, and **`brainiac` states the fix as a discipline, not a
guarantee** — `app/demo/DemoConsole.tsx:238-240`: *"Read on the first render, not in an effect: a
visitor landing on /demo?m=graph must get the graph, not the overview and then a flinch."* The
principle is written down in that repo; two of its own modules violate it.

**This is the same shape as the refutation the brief carried forward from
[`navigation-destination.md`](./navigation-destination.md)** — *the type link predicts drift, the
state location does not.* Extended by this measurement: **the state location does not predict the
race either.** What predicts the race is whether the receiver reads the intent on its first render
or in an effect, and that is a code-shape decision available in every architecture.

### The strongest result: a convergent absence

**Neither sibling validates a fragment target against the rendered id set (0 and 0). Neither
retries when the target is not there (0 and 0). Neither announces arrival (0 and 0). Neither has a
link checker that runs.** And both carry **three provably dead fragment links today**:

| | dead targets | how |
|---|---|---|
| `personas-web` | `#features` (`sections/DownloadCTA.tsx:92` — the target lives in a component whose only import site is the dev-only `/preview` route); `#download` from `flow-composer/components/FlowCTA.tsx:21` (which renders on `/how`, where `id="download"` does not exist); `/#download` on cold load | no gate |
| `brainiac` | `#contradictions-h` ×3 (`src/observatory/Observatory.tsx:195,207,219`) | **the anchor id was renamed to `wl-contra-h` and given a shared constant + a test pin** (`reviews/review-surface.ts:96-104`, `review-surface.test.ts:188-197`); `ReviewsLive.tsx:71` and `ReviewWorklist.tsx:917` import it; **`Observatory.tsx` never did.** The links also route through a 307 (`next.config.ts:49`) first, so the round trip happens and *then* the scroll goes nowhere |

`brainiac`'s is the more instructive failure and it is *exactly* `navigation-destination.md` §7 E2's
shape — consolidation performed, written down, and re-drifted in the one file that never imported
the constant — applied to **targets** rather than to destinations. That the same failure appears at
both levels, in two repos, is what makes "the target's id belongs in one shared constant, and every
producer and the renderer must both import it" a physics clause rather than a preference.

### The three things a sibling does better, and Personas should import

1. **`brainiac` independently invented the `Arrival` type this document's §4 asks for.**
   `src/design/routes.ts:206-217` — `ConsoleAddress { module; view?; sel?; asOf?; filters }`, where
   `sel` is *the object that is open*. Its rationale comment (`:191-196`) is this leaf's thesis in
   one sentence: *"the one thing a link most needs to carry — WHICH OBJECT IS OPEN — lived in
   `useState` inside each module. So no view in the product could be handed to anyone."* Independent
   rediscovery of the exact type → **physics.** **And the warning rides with it: `decodeAddress`
   has ZERO production callers.** Every module still hand-rolls its own reader; `memories/Module.tsx:44-46`
   re-declares a private `one()` identical to `routes.ts:248`. The grammar was added *beside* the
   five private dialects it says it replaced, not *under* them. **Declaring the type is not the
   fix; making it the only path is.** Personas has the same disease at a different layer —
   `PowerMoveNav` (`powerMoves/registry.ts:13-20`) is a correct destination *value* with one consumer.
2. **The only honest "the thing you named is gone" in any of the three repos** is
   `brainiac`'s `useMemoryDetail.ts:39` — `finish(null, "Couldn't load this memory — the server may
   be unavailable.")`, rendered in-pane at `Archive.tsx:613`, with a comment at `:36-38` explicitly
   refusing to substitute a fabricated record. Note also that `?sel=` there resolves **independently
   of the list** (`useMemoryDetail.ts:33` fetches `/api/memories/${id}` directly), so a target on
   page 7 of the archive still opens — which is precisely what `RunDeskPage.tsx:72`'s
   wait-for-a-DOM-node cannot do. **This corrects §2's claim that the "give up loudly" half exists
   only once: it exists twice, and the better of the two is in a sibling.**
3. **The only correct arrival-focus implementation in any of the three repos** is
   `personas-web`'s `guide/TopicView.tsx:88-98, 103, 150`: the fragment target carries
   `tabIndex={-1}`, the skip link points at it, and client-side topic changes move focus to it while
   explicitly skipping the initial mount so focus is never stolen on load. **Copy this for §4 step 8.**
   It is 1 of 40 fragment targets in its own repo — but it is 1 more than Personas' 0 of 58.

### The clause-by-clause warrant, recomputed against the oracle

| Clause | Warrant | Evidence |
|---|---|---|
| **The intent must persist until the receiver reads it** | **physics** | Rediscovered 4× inside Personas (module latch, context latch, 12 store latches, the bus) and is the defining property of URL-carried state in both siblings. |
| **The target's id belongs in one shared constant both the linker and the renderer import** | **physics** | `brainiac`'s `CONTRA_HEADING_ID` (+ its one un-migrated file) and its 21/21 data-driven `SectionRail` ids; `personas-web`'s `extractHeadings()` feeding both `TopicTOC` and `HeadingAnchor` (the only fragment class in that repo with zero dead links). Both repos' dead links are exactly the hand-written ones. |
| **A first-class `Arrival`/address value carrying the open object** | **physics** | `ConsoleAddress` (`brainiac/src/design/routes.ts:206-217`), invented independently, with the same rationale. |
| **Resolve the target on landing, and say so when it is gone** | **physics for "resolve"; a two-instance proposal for "say so"** | resolve: universal. say-so: `brainiac/useMemoryDetail.ts:39` and Personas' `TourPanelBody.tsx:191-199`, and **nothing else in three repos**. Presented above as a proposal, and correctly so. |
| **Wait for the target with a deadline, never a fixed delay** | **physics WITHIN Personas; absent in both siblings** | Two independent implementations here (`flashSpotlight.ts:36`, `useGuidanceRunner.ts:33`, identical 4,000/80). The siblings have **zero** retries — `ScrollMap.tsx:18`, `MobilePageTOC.tsx:43`, `SectionRail.tsx:86` all `if (!el) return` and silently no-op. **Personas is ahead here and does not know it.** |
| **Cancel a superseded arrival** | **house convention** | Two instances, both Personas, both written after the bug. No trace in either sibling. Treat as local calibration until a third repo rediscovers it. |
| **Announce and focus the arrival** | **doctrine from outside, plus exactly one sighting** | 0 of 58 here; 1 of 40 in `personas-web`; 0 in `brainiac` (which has **zero `.focus()` calls anywhere**). Prescribed on WCAG 2.4.3 grounds, not because the corpus does it. Said plainly so a future composer does not cite this document as evidence that anyone does. |

### The asymmetry, restated for an adopting repo

A web app adopting this path gets **the place** from its framework (a route has a file or it 404s)
and **persistence of the intent** from its address bar. It gets **neither delivery nor the target**:
its fragment can point at an unmounted lazy section, its `?sel=` can name a deleted row, and
measured across 66 distinct intra-page targets in two repos, **not one is checked by anything.**
`personas-web`'s single slug-resolution gate (`scripts/check-guide-content.mjs`, whose header names
the exact silent-404 it prevents) **is wired into `package.json` and run by neither CI
(`ci.yml:26-32`) nor the pre-push hook (`install-git-hooks.mjs:18-22`)** — the same "a gate that
never runs" pattern the contract's §9 warns about, found again.

So the effort an adopting repo saves on §2 (a) should go entirely to (b) and (c) — and a desktop app
with no address bar must build all three, once, rather than nine times as Personas has.

**The §9 gate does not transfer at all, and says so in its own `description`.** Its proxy is a
TypeScript cast at a store setter. A repo whose arrivals are URLs has no cast, no setter, and no
token — it would score zero while the arrival condition is present at full scale. The transferable
artefact is the **condition**: *an intent crosses into a surface through a channel that neither the
compiler nor an audit can read.* An adopting repo re-derives its own proxy — for a Next.js repo the
obvious candidate is an intra-page target read from `useSearchParams()`/`hash` and used without a
membership test, which is a completely different regex for the same sentence.
