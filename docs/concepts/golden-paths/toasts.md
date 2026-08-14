# Golden path — Toasts

> Situation node: `ui-system/chrome-and-feedback/toasts` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `4c40fe2f1`. **Recurrence 752.**
> Sweep: `toastStore.ts`, `ToastContainer.tsx`, `useToastTimer.ts`, `AriaLiveProvider.tsx`,
> `AlertToastContainer.tsx`, `HealingToast.tsx`, `useSettingsSaveToast.ts`, `silentCatch.ts`,
> `errorPipeline.ts`, `errorRegistry.ts`, `useTranslatedError.ts`, `src-tauri/core/src/error.rs` and
> `globals.css` read in full; **all 475 production `addToast` call sites extracted by a
> brace-matching argument parser** (comments stripped, test files excluded) and cross-tabulated by
> tone × message-source × duration × action; the 65 `ERROR_KEY_MAP` and 62 `ERROR_RULES` matchers
> extracted and **executed** against a corpus of real Rust `AppError` Display strings and against
> every caller-authored literal; a hand-rolled-transient-surface census over all 2,104 `.tsx`; and a
> convergence census of `personas-web` (Next.js, 597 `.tsx`) and `personas-cloud` (Node services).
> Dimensions: **ui · function · resilience · code-quality**.
> **Settles:** when a transient notification is the right surface, which tone it wears, how long it
> lives, what it is allowed to say, and what belongs somewhere else.
>
> Corpus counts cite [`shared-facts.json`](../shared-facts.json) rather than re-deriving them.
> **Two of this leaf's stated premises are wrong**; both corrections are in §0 and §7.0.

---

## 0. Two premises in the brief, corrected before anything else

**(a) There is no `info` toast. The tone does not exist.** `StandardToast['type']` is
`'success' | 'error' | 'warning'` (`toastStore.ts:36`) and **zero** of the 475 call sites reference
an `info` tone. The brief asked for a population "by type (success/error/info/warning)"; the honest
answer is a three-tone system. This is not an oversight to fix — see §5's convergence note:
`personas-web` also has no `info` variant across five independent toast components, and neither does
any of its three disjoint local unions. **Three tones is the attested vocabulary.** The one `info`
in the app belongs to the *second*, ungoverned stack (`AlertToastContainer.tsx:14`), which is itself
the deviation (§7.C).

**(b) The premature-success class the brief expects is essentially absent here, and present in the
sibling.** `CompetitionCard.tsx:145` — the site named in the brief — reads today:

```tsx
setOptimisticCancelled(true);
useOverviewStore.getState().processEnded('competition', 'cancelled', competition.id);
addToast(dl.competition_cancelled_cleaning, 'success');     // ":145"
onRefresh();
cancelCompetition(competition.id).catch((err) => {
  silentCatch('CompetitionCard:handleCancel:cleanup')(err);
  addToast(tx(dl.background_cleanup_issue, { … }), 'error');
});
```

That is not the defect. The copy is **present-progressive and honest about incompleteness**
("cancelled — cleaning up"), the unawaited work carries a compensating error toast, and the error
reaches a telemetry door. It is the *correct* optimistic shape, written deliberately.

A systematic sweep for the real defect found **3** `.then(… success toast …)` chains with no sibling
`.catch` (all in `CommandPalette.tsx`), and a hand-check of the 49 sites a looser ordering heuristic
flagged put its precision near zero — the flagged shapes are post-success background refreshes
(`void fleetRefresh()`) and `.then().catch()` pairs, which are correct. **The convergence oracle
found the defect the brief described — in `personas-web`, not here** (§ Convergence, instance A):
`useReviewBulkActions.ts:212-226` composes past-tense success copy (`"Approved 12 reviews"`), shows
it at t=0, and starts the unawaited PATCHes at t=5000 ms. Personas' toast layer is measurably
healthier on this axis than its sibling's. Say so.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its **warrant**, so an adopting repo can tell physics from local calibration.
No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A transient notification is a *receipt*, not a *record*. It says "the thing you
> just did, happened" and then it is gone. Anything the user must still act on, refer back to, or
> read twice does not survive its own surface, and putting it there is a decision to lose it.
>
> **P2 — physics.** The tone is a claim about the world, and the moment the claim is made must be
> the moment it becomes true. A success shown before the work completes is not optimism, it is a
> false statement with a five-second head start on its own correction — and the correction, if it
> arrives at all, arrives in a different notification the user has no reason to connect to the
> first. Either await the work, or write copy that only claims what has actually happened.
>
> **P3 — physics.** Between "it worked" and "it failed" there is a third outcome that occurs
> constantly in any batched or multi-step operation: *partial*. A system with only two tones forces
> every partial result into one of them, and both are lies — the success tone hides real failures,
> the error tone hides real value delivered. A third tone is not a nicety; it is the arity of the
> problem.
>
> **P4 — physics, and the one most often violated.** A notification is anchored to a screen corner
> and the thing it describes is not. When the message is *about a specific control the user is
> looking at* — a field they left blank, a selection they did not make — the message belongs on that
> control. A transient surface makes the user carry the diagnosis across the screen from memory,
> and then takes it away.
>
> **P5 — physics.** Auto-dismissal is a timer competing with a human's reading speed, and the human
> loses if the timer runs while they are not looking. Pause it while the surface is not being
> attended to — the window hidden, the pointer resting on it, the keyboard focused inside it. A
> timer that ignores attention is a timer that dismisses unread messages, and it does so most
> reliably for the users who read slowest.
>
> **P6 — physics.** A notification stack is a queue with a rendering budget, and the two are
> different numbers. When more arrive than fit, the choice of which to show is a ranking problem —
> and recency is the wrong rank, because the most important message is not reliably the newest.
> Evict and order by declared importance, and tell the user something was withheld.
>
> **P7 — physics.** Whatever text the surface renders is the *product speaking*. A string produced
> by a machine — a database driver, a parser, a remote service — is not the product speaking, and
> handing one through unchanged does three things at once: it is unbounded, so it breaks the layout;
> it is untranslated, so it breaks the locale; and it is unreviewed, so it exports whatever the
> machine happened to include.
>
> **P8 — ergonomics, with a measured cause.** The notification will be over-used in exact proportion
> to how much cheaper it is to reach than its alternatives. If firing one is a single call available
> from anywhere with no state, no props and no layout decision, while an inline message costs a
> state variable, a render branch and a placement, then every ambiguous case resolves to the
> notification — not because it is right, but because it is closer.
>
> **P9 — governance.** Two surfaces that both announce the same event to assistive technology
> announce it twice. This is invisible to everyone who does not use assistive technology, including
> the person who added the second one, and it gets worse as each surface is independently improved.
>
> **Scale condition.** P1, P2, P4 and P7 pay from the first notification. P3 pays as soon as any
> operation is batched. P5 and P6 pay once notifications can arrive faster than they are read. P8
> and P9 pay at the scale where nobody reviews every call site — here, 475 of them.

**Warrant evidence — what two siblings reinvented, and what they did not.**

Checked against `personas-web` (Next.js, separate remote, 597 `.tsx`) and `personas-cloud`
(Node services). `personas-cloud` is a **negative control and confirms the boundary**: 0 occurrences
of `toast|snackbar|notistack|toastify|sonner` in the entire repo, 0 `.tsx`/`.jsx`/`.css` files, no
UI layer at all. Its absence is structural, not accidental — there is no user to notify.

`personas-web` has **no toast library** (no `sonner`, `react-hot-toast`, `react-toastify`,
`notistack`, `@radix-ui/react-toast` in `package.json`) and instead grew **five independent
hand-rolled toast components**. That makes it an unusually clean oracle: every mechanism it has, it
invented twice or more, from scratch, with no shared document.

| Clause | Verdict | Sibling evidence |
|---|---|---|
| **A transient notification exists as a distinct surface at all** | **PHYSICS** | Five independent implementations in one repo; `ExecuteToast.tsx:11` even documents the lineage — *"Mirrors the AuthToast / BulkResultToast pattern."* |
| **success / error as the primary tone axis** | **PHYSICS** | `"success" \| "error"` declared **twice independently** in the sibling — `ExecuteToast.tsx:21` and `agents/page.tsx:22` — as two separate types spelling the same union. |
| **An error lives longer than a success** | **PHYSICS, and the sibling wrote down the reasoning** | `ExecuteToast.tsx:29` — `setTimeout(onDismiss, isError ? 7000 : 4000)`, with the comment *"Errors linger a little longer so they're not missed."* Personas: 5000 vs 3000 (`toastStore.ts:71-75`). Same direction, same rationale, no shared code. |
| **assertive for error, polite otherwise** | **PHYSICS (weak — 1 of 5)** | `ExecuteToast.tsx:38`. The other four sibling surfaces hardcode a level, and 4 of 5 violate the sibling's own written standard at `.claude/design.md:472`. |
| **Copy that claims a queue, not a completion** | **PHYSICS** | The sibling's single correctly-sequenced toast (`agents/page.tsx:74`) uses the key `executeQueued`. Personas' correct optimistic site uses `competition_cancelled_cleaning`. Two repos, same instinct: when the work is not done, name the stage. |
| **A `warning` / partial tone (P3)** | **LOCAL CALIBRATION — mark it** | **Absent in all five sibling components and all three of its unions.** Personas has it (`toastStore.ts:27-36`), with a docstring that argues P3 explicitly. This is a genuine Personas advantage, not doctrine — an adopting repo must be given the *argument*, because nobody else derived it. |
| **An `info` tone** | **Absent everywhere, including here** | 0 in Personas' union, 0 in all three sibling unions, 0 call sites. Three tones is the attested vocabulary. |
| **One queue with a render cap, priority eviction and an overflow chip (P6)** | **LOCAL CALIBRATION — and the sibling shows the cost of not having it** | Grep for `MAX_VISIBLE\|maxSnack\|visibleToasts\|toastLimit` across `personas-web`: **0 matches.** Each of its five surfaces holds a single nullable value, so a new one silently overwrites the old. Worse, **all five render at the identical `fixed bottom-20 left-1/2 z-[70]`** and `AuthToast` is mounted globally (`AuthProvider.tsx:25`), so a session-expiry notice overlaps any of the other four exactly. One hand-written mutual-exclusion condition exists in the whole repo (`ReviewsSplitPaneToasts.tsx:42`) and covers one pair. |
| **Pause on hover / on hidden tab (P5)** | **LOCAL CALIBRATION — and the sibling had the parts** | Zero hover handlers and zero `visibilitychange` listeners in any of the five sibling toast files — while `usePageVisibility.ts:39`, `usePolling.ts:34` and `useSectionPause.ts:22` sit unused in the same repo. Its `UndoToast` timer is what **commits an irreversible bulk approve/reject** (`useReviewBulkActions.ts:220-226`) and it keeps counting while the tab is hidden. |
| **A typed `{ label, onClick }` action slot** | **LOCAL CALIBRATION** | Three sibling surfaces have an action; none is a parameter. Each hardcodes its own button in its own body — which is precisely how `AuthToast.tsx:76` shipped the literal English `"Sign in"` past a 15-locale catalog. |
| **Routing error copy through a classification / i18n layer** | **LOCAL CALIBRATION** | No such layer feeds any sibling toast. `agents/page.tsx:76-77` is `catch {` with no binding and a fixed i18n template — the error is unrecoverable. |
| **Any lint rule, test or CI check gating toast usage** | **LOCAL CALIBRATION — nobody has one** | `personas-web` ships **five** bespoke ESLint AST rules and points none at toasts; 0 unit tests and 0 e2e assertions mention one; its only toast governance is prose in `design.md`, which 4 of 5 implementations violate. Personas has none either. §9 must be marked as manifestation, hard. |

**What this inverts.** I was going to argue that the tone is not a caller's to pick — that
`'error'` should be produced only by a failure pipeline. **The oracle refuses it.** Caller-chosen
tone is reinvented in every sibling surface that has tones at all; it is the norm, not a defect. The
clause survives only as a *local* proposal in § Type over gate, explicitly marked, and it is **not**
in the head.

**What this confirms.** Personas is ahead of its sibling on exactly the mechanisms P5 and P6
describe, and the sibling is a live demonstration of the cost. That is the strongest possible
argument for **not** letting a sixth surface accrete — which is precisely what has already begun
here (§7.C).

---

## 1. Trigger

- "let the user know it saved" / "show a confirmation" / "pop a toast when it's done"
- "tell them it failed" / "surface the error to the user"
- "warn them if some of them didn't work" / "it adopted 4 of 6"
- "they need to pick a project first" / "the field is empty, tell them"
- "this is going to take a while, acknowledge it now"
- **If you are about to type `addToast(`, `useToastStore.getState().addToast(`, or a `setTimeout`
  that hides a fixed-position notification** — you are in this situation.

You are **not** in this situation for:
- **a failure a background job produced that nobody is waiting on** → operator door,
  [`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md).
- **the wording of an error, or its translation** → [`i18n-string-authoring.md`](./i18n-string-authoring.md)
  owns the catalog and the key; [`typed-error-contract.md`](./typed-error-contract.md) owns what the
  error *is* and what the envelope carries. This path owns only whether a toast is the right place
  to put it and how it behaves once it is there.
- **a control the user just pressed showing it is working** → that is a busy state on the control,
  [`inline-busy-state.md`](./inline-busy-state.md). A toast is never a loading indicator.
- **a region fetching its data** → [`overview-loading.md`](../../design/overview-loading.md).

### Boundaries with the three adjacent paths, stated so the seams are testable

- **[`i18n-string-authoring.md`](./i18n-string-authoring.md)** owns *what the words are and what
  language they are in*. Its census rule `discarded-toast-copy` (49 files / 94 matches) counts
  call-site English literals handed to error-toast helpers. This path adds nothing to that count and
  deliberately does not re-gate it. Non-overlap test: a perfectly-translated sentence shown in a
  success toast for work that has not completed is 100% compliant with that path and 0% compliant
  with this one. Rule of thumb — if the question is *"which words, which language"*, it is theirs;
  if it is *"which surface, which tone, how long"*, it is ours.
- **[`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md)** owns *whether any durable
  record survives the catch block* and which of the two doors — `toastCatch` (user) or `silentCatch`
  (operator) — a failure goes through. Its P0 (`toastCatch` never calls `recordSwallow`,
  `silentCatch.ts:102-132`) is **still open at `4c40fe2f1`, verified by reading the function**, and
  is theirs to close. This path takes their door choice as settled and starts one step later: given
  that a human is being told, what does the telling look like. Non-overlap test: a failure that
  reaches `toastCatch` and produces a perfect Sentry trail, but renders a 400-character
  `Database error:` string in a `max-w-sm` card, is compliant with that path and violates §2 here.
- **[`typed-error-contract.md`](./typed-error-contract.md)** owns the envelope. It is the reason
  §7.B below is a *symptom*: the backend already ships a machine `kind` discriminant
  (`src-tauri/core/src/error.rs:180-200`) and the toast pipeline throws it away and pattern-matches
  the prose instead. The cure is theirs; the measurement of what it costs on screen is this
  document's contribution.

---

## 2. The one way

**Fire a toast only when a person just did something and the receipt is the whole message, then let
the store own everything else.** Call `addToast(message, type)` and stop: the per-tone duration
(3 s / 4 s / 5 s), the priority, the ARIA urgency, the pause-on-hover, the pause-on-hidden-tab, the
stack cap, the eviction order and the overflow chip are all already decided
(`toastStore.ts` + `useToastTimer.ts`) and passing a third or fourth argument is opting out of a
policy, not configuring one. **Choose the tone by what actually happened, not by how it feels**:
`'success'` only when the operation has completed — if you have not awaited it, either await it or
write copy that names the stage you are actually in ("cancelling", "queued", "starting"), never a
past tense; `'warning'` whenever the result is *partial*, which is the entire reason that tone
exists and which two of its call sites currently mis-report as success or error; `'error'` last, and
prefer reaching it through `toastCatch('feature:operation')` so the failure also leaves a trail.
**Never hand a machine-authored string through as the message** — an `err instanceof Error ?
err.message : …` ladder puts an unbounded, untranslated, unreviewed string into a card that has no
clamp; use `toastCatch`, or scope the raw detail inside a translated frame,
`tx(t.section.op_failed, { error })`. And **before you reach for a toast at all, check that the
message is not about a control the user is looking at**: an empty required field, an unmade
selection and a disabled-precondition are inline states and a disabled button, not a notification in
the opposite corner that erases itself in five seconds. If the user must *do* something about it,
either give the toast an `action` — the slot exists and **one of 475 call sites uses it** — or put
it somewhere that persists.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/stores/toastStore.ts:123` — `addToast(message, type, duration?, action?)`** | The only sanctioned way to raise a standard toast. **475 production call sites in 170 files.** Assigns duration + priority from the tone and calls `announceImperative` for you. Reach it via `useToastStore((s) => s.addToast)` in a component, or `useToastStore.getState().addToast` from a non-React module (**51 files** do the latter, correctly). |
| **`toastStore.ts:36` — `type: 'success' \| 'error' \| 'warning'`** | The whole tone vocabulary. Read the `warning` docstring at `:27-35` before choosing — it argues P3 with a worked example ("adopted 4/6 members") and is the most useful three sentences in the file. |
| **`toastStore.ts:71-75` — `DEFAULT_DURATION`** | `success: 3000`, `warning: 4000`, `error: 5000`. **This is the policy.** 443 of 475 sites correctly pass nothing. |
| **`toastStore.ts:54-65` — `STANDARD_PRIORITY` / `HEALING_PRIORITY`** | The full ladder, highest first: healing `critical` 40 · healing `high` 30 · healing `medium` 25 · **error 20** · **warning 18** · healing `low` 15 · **success 10**. Drives both render order and eviction. |
| **`toastStore.ts:89` — `capToasts()`** | Caps state at `MAX_TOASTS = 10` by evicting **lowest-priority-then-oldest**, not most-recent. Its docstring states the reason: a burst of successes must not push out an unseen critical. |
| **`toastStore.ts:98` — `MAX_VISIBLE_TOASTS = 3`** | The render budget, separate from the state cap. The remainder becomes the overflow chip. |
| **`toastStore.ts:18-21` — `ToastAction { label, onClick }`** | The action slot: renders an underlined button that runs `onClick` and dismisses (`ToastContainer.tsx:116-124`). **1 of 475 call sites uses it** (`src/lib/eventBridge.ts:576`). This is the most under-used correct primitive in the leaf. |
| **`toastStore.ts:141` — `addHealingToast({ issueId, … })`** | The healing variant: severity-coloured, carries `personaName` + `suggestedFix` + a **Resolve** button, 8 s, deduped by `issueId`. **2 call sites.** Do not hand-roll a richer toast — extend this. |
| **`src/features/shared/chrome/useToastTimer.ts:21`** | The timing contract, shared by both variants. One RAF loop; pauses on hover **and** on `useDocumentVisibility()` so a backgrounded tab does not burn the duration; re-anchors the clock on resume (`:70-74`) so a hover does not count as elapsed. |
| **`src/features/shared/chrome/ToastContainer.tsx:250`** | The single renderer. Mounted once at `App.tsx:397`. Sorts by priority then recency, slices to `MAX_VISIBLE_TOASTS`, renders the overflow chip, and resolves error copy through the translated registry (`:65-79`). |
| **`src/lib/silentCatch.ts:102` — `toastCatch(context, custom?)`** | The **user door** for a caught failure: extracts the message, logs it, breadcrumbs it, and raises the error toast for you. **389 call sites.** Owned by [`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md); named here because it is the correct destination for §7.B's 20 raw-error call sites. |
| **`src/hooks/utility/interaction/useSettingsSaveToast.ts:13`** | The auto-save receipt: an inline checkmark **plus** a 2 s success toast. The right precedent for pairing a persistent inline marker with a transient one. |
| **`src/features/shared/components/feedback/AriaLiveProvider.tsx`** — `announceImperative` | Queued, one-per-150 ms sr-only announcements. `addToast` already calls it (`toastStore.ts:138`). **Do not call it yourself for a toast** — see §7.D. |

**Explicitly NOT a primitive.** `src/features/overview/sub_observability/components/AlertToastContainer.tsx`
is a second, independent toast stack (§7.C). Do not extend it, do not copy it, and do not add a
third.

---

## 4. Steps

1. **First, decide it should be a toast at all.** Ask one question: *is this message about a control
   the user is currently looking at?* An empty required field, an unmade selection, a precondition
   the form can see — the answer is yes, and the answer is `forms/FormField`'s error state or a
   disabled button, not a notification. **25 call sites got this wrong** (§7.E). Ask a second:
   *must the user act on this later?* Then it needs an `action` or a persistent surface.
2. **Pick the tone from what happened, not from how it feels.** Completed → `success`. Failed
   entirely → `error`. **Anything in between → `warning`** — a batch where some items succeeded, a
   save that landed with a follow-up step that did not. If you are writing `queued++` in a loop, you
   are in `warning` territory the moment the loop can throw (§7.F).
3. **If you have not awaited the work, do not use the past tense.** Two legal shapes: `await` it
   before the toast, or keep the optimistic order and write copy that names the stage —
   `competition_cancelled_cleaning`, `dispatch_toast`, `compact_toast` ("Compacting {name}…") are
   the in-repo precedents — and attach a compensating handler to the promise you did not await.
   `CompetitionCard.tsx:141-153` is the reference implementation of the whole step.
4. **Write the message as a key.** `t.section.key` / `tx(t.section.key, { … })`. **240 of 475 sites (50.5%)
   already do**; the catalog already holds 101 keys whose name contains `toast`. This is
   [`i18n-string-authoring.md`](./i18n-string-authoring.md)'s rule, restated because a toast is the
   single most common place it is broken.
5. **Never let a machine's string be the message.** If you are in a catch and want the detail
   shown, use `.catch(toastCatch('feature:operation'))` — it does the extraction *and* leaves a
   breadcrumb. If you want a sentence around it, `tx(t.section.op_failed, { error })` keeps the
   sentence translated and scopes the raw text. **What you may not write is
   `addToast(err instanceof Error ? err.message : …, 'error')`** — that is §9's whole subject.
6. **Pass two arguments and stop.** No third. The per-tone duration is the policy; overriding it
   opts out of a decision that was made once for the whole app. Seven sites currently fight it
   (§7.G). If you genuinely need a 30-second notification, you need a panel.
7. **If the user must do something, give it the action.** `addToast(msg, type, undefined, { label:
   t.common.view, onClick })`. `eventBridge.ts:576` is the only worked example in the repo; copy it.
   Error toasts additionally get a free navigation action when the classifier produced one
   (`ToastContainer.tsx:84-88`) — you do not need to add that yourself.
8. **And then stop.** Do not add your own `announceImperative`, your own timer, your own dismiss
   button, your own fixed-position container, or your own `setTimeout`. All eight of those exist in
   the store and the container, and each hand-rolled copy is the first of the five surfaces
   `personas-web` now has.

### Can the type make the wrong call impossible? — asked before §9

Partly, and it is the strongest available finding. See § Type over gate. The short version: three of
the four defect classes below pass through `addToast`'s four-positional-argument signature, and two
of them stop compiling if the optional slots become a typed options object. §9's rule is the ratchet
that holds the line until that lands, not the fix.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `addToast(err instanceof Error ? err.message : fallback, 'error')` | **20 sites / 12 files.** An unbounded, untranslated, unreviewed machine string becomes the entire visible text of a card that has no clamp. Until 2026-08-14 it was silently replaced by "Something went wrong."; that safety net is now gone (§7.0, §7.B). |
| `if (!title.trim()) { addToast(t.x.required, 'error'); return; }` | **25 sites.** The diagnosis is about a field the user is looking at, and it is delivered in the opposite screen corner, in the error tone, and erased in five seconds. The field itself is left unmarked. P4. |
| `addToast(t.x.done, 'success')` before an unawaited call | P2. The claim precedes the fact. Rare here (3 sites), and **the dominant defect in the sibling** (`useReviewBulkActions.ts:212` vs `:225`, 5 s apart). |
| `for (…) { queued++ } … catch { addToast(t.x.failed, 'error') }` | P3. A partial batch reported as a total failure — the items that *did* queue are never mentioned. `warning` exists exactly for this and its docstring says so. `ImprovePlanPanel.tsx:72` / `:75`. |
| `addToast(msg, 'success', 30_000)` | A 30-second notification is a panel with an expiry date. It occupies one of three render slots for half a minute and evicts nothing while doing it (its priority is 10, the lowest). 2 sites. |
| `addToast(msg, 'error', 2400)` | Shortens the tone that most needs reading time, below the success default. Inverts the one duration rule two codebases independently derived. 4 sites. |
| A new `fixed bottom-4 right-4 … setTimeout(dismiss)` component | The sixth surface. `personas-web` has five, all at identical coordinates, one mounted globally, with exactly one hand-written collision guard between them. Personas has two (§7.C) and should have one. |
| Calling `announceImperative` next to your own `addToast` | Double utterance. `addToast` already announces (`toastStore.ts:138`) *and* the container is itself a live region (`ToastContainer.tsx:278-280`). §7.D. |
| `addToast(\`Queued ${n} ${n === 1 ? 'task' : 'tasks'}\`, 'success')` | Hand-rolled English pluralization inside a toast. `tx()` + `_one`/`_other` exists. `ImprovePlanPanel.tsx:72`. Owned by [`i18n-string-authoring.md`](./i18n-string-authoring.md); listed because the toast is where it keeps happening. |
| Treating the toast as the record of a failure | It is dismissed in five seconds and is then the only thing that ever knew. Route the error through a door first — [`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md), P1 of that path. |

---

## 6. Evidence

**The one site to copy:**
`src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx:139-153`. In fifteen
lines it does every judgement in this path correctly and nothing else does all of them together:

- `:141-144` — the optimistic UI update and the store event fire first, so the surface is already
  consistent when the toast appears.
- `:145` — `addToast(dl.competition_cancelled_cleaning, 'success')`. The tone matches what has
  actually happened (the cancellation is committed), and the **copy names the stage that has not**
  ("cleaning up"). This is step 3, implemented.
- `:149-152` — the unawaited cleanup carries **both** doors: `silentCatch(…)` for the operator trail
  and a compensating `addToast(…, 'error')` for the user. A background failure after an optimistic
  success is the one case where two toasts about one operation is correct.
- `:151` — the compensating message is `tx(dl.background_cleanup_issue, { error })`: a translated
  frame with the raw detail scoped inside it, which is step 5's second legal shape.

**For the action slot:** `src/lib/eventBridge.ts:576` — the only site in 475 that passes a
`ToastAction`. Read it before adding the second.

**For pairing transient with persistent:**
`src/hooks/utility/interaction/useSettingsSaveToast.ts:16-19` — an inline checkmark *and* a 2 s
toast from one `trigger()`. The right answer whenever a receipt should also leave a mark.

**For the timing contract:** `src/features/shared/chrome/useToastTimer.ts:37-74`. Two details worth
copying rather than re-deriving: `isPaused = paused || !isDocumentVisible` (`:31`) makes a hidden tab
a pause, and `lastTickRef.current = Date.now()` on mouse-leave (`:72`) is the drift correction that
stops a hover from being counted as elapsed time.

**For eviction:** `src/stores/toastStore.ts:82-95`. `capToasts` sorts by priority before slicing and
then restores timestamp order — the docstring states the failure it prevents, which is the model for
how a cap should be documented.

---

## 7. Deviations found

**Measured at `4c40fe2f1`. Test files excluded throughout. Population: 475 production `addToast`
sites in 170 files — success 224, error 204, warning 26, tone-by-expression 21.**

### 7.0 The change that landed today — verified, correct, and it opened one hole

The brief describes `ToastContainer.tsx` as edited this session so that error copy resolves through
`resolveErrorTranslated(t, …)` and the caller's message wins when the classification is
`'unclassified'`. **Read at `:55-79`, both halves are exactly as described.** Verification, not
trust:

```tsx
const classified = useMemo(() => (toast.type === 'error' ? classifyErrorFull(toast.message) : null), …);   // :55
const friendly   = useMemo(() => (toast.type === 'error' ? resolveErrorTranslated(t, toast.message) : null), [t, …]); // :65
const matched       = friendly !== null && friendly.category !== 'unclassified';                          // :78
const displayMessage = matched ? friendly.message : toast.message;                                        // :79
```

Four independent checks, all passed:

1. **The translated registry is genuinely reached.** `resolveErrorTranslated`
   (`useTranslatedError.ts:170`) returns a non-nullable `TranslatedError`; `friendly` is `null` only
   for non-error toasts, where `matched` is correctly `false` and `toast.message` renders unchanged.
   No regression for success/warning.
2. **`'unclassified'` is the right discriminant.** It is set in exactly two places, both the
   unmatched fallback (`useTranslatedError.ts:175`, `errorRegistry.ts:620`), and nowhere else. The
   unreachable-branch bug the brief describes was real and is now fixed.
3. **`t` is stable, so the extra `useMemo` dependency does not thrash.** `getBundle()`
   (`useTranslation.ts:223-259`) caches one `Proxy` per language and `useTranslation` memoizes on
   `[bundle, language]` (`:348-364`). This matters because `useToastTimer` re-renders the item once
   per second and `recordResolveBreadcrumb`'s dedupe window is exactly 1000 ms
   (`useTranslatedError.ts:26`) — an unstable `t` would have re-resolved on every tick and defeated
   the dedupe. It does not. *(One DEV-only exception: with the pseudo-locale active,
   `getBundle` returns a fresh `buildPseudoBundle(...)` per call (`:224-226`), so `t` changes
   identity every render. Dev-only, no shipping impact, worth knowing before profiling.)*
4. **The claimed benefit is real, and I measured it rather than accepting it.** Extracting all 65
   `ERROR_KEY_MAP` matchers and all 62 `ERROR_RULES` matchers and executing them against every
   caller-authored literal error string (positive-controlled on `'NetworkOffline'`,
   `'request timed out after 30s'`, `'Validation failed: name'`, `'Decryption failed: bad key'` —
   all four match as expected): **54 of 54 are `unclassified`, so 54 of 54 now reach the user and
   0 did yesterday.** `"Couldn't queue the campaign"`, `"Failed to update display name"`,
   `"Health check failed"`, `"Could not parse AI synthesis output"` — all of them previously
   rendered as **"Something went wrong."** This closes the *dead* half of
   `i18n-string-authoring.md`'s §7.B exactly as that document's step (2) prescribed, and the census
   rule `discarded-toast-copy`'s own description already records the status change.

**Nothing was broken. One thing was opened, and it is this document's §9.** The `unclassified`
branch is now **live**, and it renders `toast.message` verbatim. For a caller-authored sentence that
is the whole point. For a *machine-authored* string it is a new exposure that the generic fallback
used to absorb — see §7.B, which is why §9 exists at all.

**Two follow-ups the same change should have carried, both one line:**

- **`ToastContainer.tsx:196` still calls `friendlySeverity(toast.severity)`** — the **English**
  registry — for the healing toast's severity badge, while `friendlySeverityTranslated(t, severity)`
  sits in the file it already imports from (`useTranslatedError.ts:230`). The standard toast was
  localized; its sibling twenty-five lines below was not. Four labels, every locale.
- **`toastCatch`'s own comment is now stale and actively misleading.** `silentCatch.ts:121-125`
  reads *"Pass the raw error string (no 'Failed to load data.' prefix — it was always discarded by
  the renderer's friendly rewrite)"*. That justification was true yesterday and is false today: the
  raw string is no longer always discarded, which is precisely why passing it is now a choice with
  consequences. A future reader will take the comment as licence.

**Interaction check, since the brief asked.** `useToastTimer` is unaffected — it consumes only
`id`/`duration`/`timestamp` and never touches the message. Stacking is unaffected — `MAX_VISIBLE_TOASTS`
slicing happens in the parent, above resolution. The healing variant does not use `displayMessage`
at all. **No bad interaction found between the three.** The healing variant's *own* untranslated
badge is a pre-existing gap the change did not create and did not close.

### 7.A The two things this system does better than its sibling — say them before the defects

Both are load-bearing and both would be the first casualties of a "simplify the toast store" pass:

- **Attention-aware timing.** `useToastTimer.ts:26,31` treats a hidden tab as a pause and `:70-74`
  re-anchors the clock after a hover. `personas-web` has neither across five surfaces, and its
  `UndoToast` — whose expiry **commits an irreversible bulk write** — counts down while the tab is
  hidden.
- **One queue, ranked.** `capToasts` (`toastStore.ts:89`) evicts by priority, `MAX_VISIBLE_TOASTS`
  budgets the render, and the overflow chip tells the user something was withheld. The sibling's
  five single-slot surfaces overwrite each other and physically collide at one coordinate.

### 7.B Machine strings as the message — 20 sites / 12 files, newly visible today

Twenty error toasts hand the toast an `x instanceof Error ? x.message : …` ladder, `String(err)`, or
`extractMessage(err)` as the **entire** first argument. Concentration: `CompanionToolbar.tsx` 4 ·
`sub_lifecycle/*` 6 · `plugins/twin/*` 4 · `sub_skills/useSkillData.ts` 2 ·
`artist/hooks/useBlenderMcp.ts` 2 · 2 others.

*(A further 14 sites use the **correct** shape — `tx(t.schedules.toast_update_failed, { error })` —
where the sentence is translated and only the detail is raw. Those are not counted and §9's pattern
is anchored specifically to exclude them.)*

Three properties make this materially worse than it looks, all verified rather than assumed:

1. **Most backend errors are unmatched, so the raw string is what renders.** Executing both matcher
   sets against a corpus of 25 real `AppError` Display strings — built from the `#[error(...)]`
   templates in `src-tauri/core/src/error.rs` with their placeholders filled — **17 of 25 match
   neither registry.** Among them: `Database error: UNIQUE constraint failed: personas.name`,
   `Rate limited: 429 from api.anthropic.com; retry-after 42s`,
   `Serialization error: missing field 'capabilities' at line 1 column 84`,
   `Process spawn error: program not found: claude`.
2. **Three registry rules are dead, and they cover the three commonest failures.** `ERROR_KEY_MAP`
   and `ERROR_RULES` both match the PascalCase *Rust variant names* `'NetworkOffline'`, `'NotFound'`
   and `'RateLimited'` — but the wire carries the **Display** string (`error.rs:173-179`), which is
   `"Network offline: …"`, `"Not found: …"`, `"Rate limited: …"`. A repo-wide grep finds those three
   PascalCase tokens **only inside the registries and their own tests**; no code path produces them.
   So network-offline, not-found and rate-limited — the three failures a desktop app hits most —
   fall straight through to the raw string.
3. **The sanitizer does not cover this path, and the card does not clamp.**
   `sanitize_error_message` (`error.rs:144-153`) strips absolute file paths only, and only for the
   `Database`/`Io`/`Internal` variants — not hostnames, SQL identifiers, URLs or IDs. Sentry's
   `scrubPii` (`sentry.ts:17`) runs in `beforeSend`/`beforeBreadcrumb`, i.e. on the **telemetry**
   path, never on the toast. And the standard toast's message span (`ToastContainer.tsx:112`) has no
   `truncate`, no `line-clamp`, no `max-h` — `truncate` and `line-clamp-2` appear **only** on the
   healing variant (`:192`, `:216`). An unbounded string wraps freely inside a `max-w-sm` card.

**This is P7, and it is downstream of a missing type at the IPC boundary.** The backend already
serializes a machine `kind` discriminant alongside the prose (`error.rs:180-200`), and
`classifyUnknownErrorFull` (`errorPipeline.ts:106`) exists specifically to use it — but `toastCatch`
calls `classifyErrorFull(msg)` on the already-flattened string (`silentCatch.ts:108`), so `kind` is
gone by the time anything renders. The cure belongs to
[`typed-error-contract.md`](./typed-error-contract.md); this section is the measurement of what it
is worth.

### 7.C A second toast stack, mounted at the same time as the first

`AlertToastContainer.tsx` and `ToastContainer` are both mounted in `App.tsx` (`:366` and `:397`) and
both render simultaneously. Point-by-point against the primitive:

| | `ToastContainer` | `AlertToastContainer` |
|---|---|---|
| position | `fixed bottom-4 right-4` | `fixed top-4 right-4` |
| z-index | `z-50` | **`z-[9990]`** |
| render cap | `MAX_VISIBLE_TOASTS = 3` + overflow chip | `.slice(0, 5)`, **silent drop past 5** |
| eviction | by priority (`capToasts`) | none — array order |
| duration | per-tone 3/4/5 s | fixed `AUTO_DISMISS_MS = 8000` (`:25`) |
| pause on hover | yes | **no** |
| pause on hidden tab | yes | **no** |
| ARIA live region | `role="status" aria-live="polite"` | **none** |
| dismiss button label | `aria-label={t.common.dismiss_notification}` | **no accessible name** (`:55`) |
| tones | success / warning / error | **info** / warning / critical |

It is not a rogue accretion — it is careful in its own terms (it derives colour from
`STATUS_PALETTE`, and `:33-41` documents a real timer-restart bug it fixed). But it is a second
implementation of six mechanisms that exist twenty lines away, it is the only place an `info` tone
exists, and its content (`alert.rule_name`, `alert.message`) arrives from the backend untranslated.
A repo-wide census for the shape — a `fixed` screen-corner overlay that also self-auto-dismisses —
finds **exactly 1 file**: this one. That is the entire population, which is why §9 does not gate it;
it is a one-file merge, not a migration.

**Why it matters more than its size.** `personas-web` is what this looks like at n=5: five
components at `fixed bottom-20 left-1/2 z-[70]`, one mounted globally, one hand-written collision
guard covering one pair. The second surface is the cheap one; the fifth is not.

### 7.D Every toast is announced twice, and for errors the two announcements differ

`addToast` calls `announceImperative(message, type === 'error' ? 'assertive' : 'polite')`
(`toastStore.ts:138`), which writes into the sr-only live regions in `AriaLiveProvider`. The
container is **also** a live region — `role="status" aria-live="polite" aria-relevant="additions
removals"` (`ToastContainer.tsx:278-280`) — so inserting the toast node announces the text a second
time. Three consequences:

1. **Every toast is spoken twice.**
2. **For error toasts the two texts are different.** `announceImperative` receives the *raw*
   `toast.message`; the visible region contains `displayMessage`, the resolved (and, since today,
   translated) copy. A screen-reader user hears the raw backend string and then the friendly one.
   Today's change narrowed the gap for unclassified errors — where the two are now identical — and
   left it for every matched one.
3. **`aria-relevant="additions removals"` announces the dismissal too**, so an auto-dismissing error
   toast can produce three utterances of the same content.

The fix is one attribute: the container's own live-region role is redundant with the provider that
already exists for exactly this purpose, and `aria-hidden` on the visual stack (or dropping
`role`/`aria-live`/`aria-relevant` from `:278-280`) leaves one correct announcement with the correct
urgency. **P9, and nothing in the repo can see it** — there is no test of any kind over
`toastStore.ts`, `ToastContainer.tsx` or `useToastTimer.ts`.

### 7.E Toasts doing an inline state's job — 25 sites

Twenty-five call sites raise a toast from a **guard clause** — a precondition check that returns
before any work starts. The user is told, in the opposite screen corner, in the error tone, for five
seconds, about a control they are looking at. A hand-check of eight put the tight sub-class
(an empty or unmade **form input**) at 4 of 8:

- `NewCompetitionModal.tsx:48` — `if (!title.trim()) { addToast(dl.task_title_required, 'error'); return; }`
- `GraphPanel.tsx:128` and `:153` — `if (!journalBody.trim())` (and both are hardcoded English)
- `StaticScanConfigModal.tsx:64` — `if (argv.length === 0)`
- `SetupPanel.tsx:158` — `if (!vaultPath || !connectionResult?.valid)`

The other four are *data* preconditions after a real call (`useScheduleActions.ts:183`,
`ToneAtelier.tsx:145`, `GenerateHypothesesModal.tsx:83`) or an empty-selection guard where the
button should have been disabled (`BacklogPanel.tsx:172`). All four are still P4 violations; they
just have a different legal fix. **The measured 50% split is exactly why §9 does not gate this
class** — see §9's "deliberately not gated".

**P8 is the cause, and it is measurable.** Reaching a toast is
`useToastStore.getState().addToast(msg, 'error')` — one line, from anywhere, no state, no props, no
layout decision. Reaching an inline error is a `useState`, a render branch, and a placement. 475
toasts in 170 files is what that price difference buys.

### 7.F Partial results reported as totals

`ImprovePlanPanel.tsx:66-76` iterates `queueTask` over a fleet, counting `queued++`, and its catch
raises a single `addToast('Couldn't queue the campaign', 'error')`. If item 3 of 10 throws, the two
that queued are never mentioned and the user is told the campaign failed. The `warning` tone exists
for precisely this and its docstring (`toastStore.ts:27-35`) uses the same worked example
("adopted 4/6 members"), and 26 sites do use it correctly — `templates.presets.toast_partial`,
`gh_import_toast_partial`, `adopted_params_partial_toast` are all model copy. Adoption is real but
partial: **26 of 475 (5.5%)**, against 11 sites that compute the tone from a comparison
(`inserted > 0 ? 'success' : 'warning'`) and therefore *did* think about it.

### 7.G Duration discipline is good, and the seven exceptions all fight the policy

**443 of 475 (93.3%) pass no duration at all** — the defaults are genuinely working. Of the 32 that
do, seven contradict the per-tone policy:

| Site | tone | ms | Against |
|---|---|---:|---|
| `IncidentDetailModal.tsx:121`, `useIncidentActions.ts:32`, `:38` | error | 4000 | below the 5000 error default |
| `ManualReviewList.tsx:296` | error | **2400** | less than half the error default, and shorter than a success |
| `DevConversationLogButton.tsx:96`, `useFleetDebugLog.ts:56` | success | **30000** | ten times the success default; holds 1 of 3 render slots for half a minute at the lowest priority |
| `eventBridge.ts:576` | success | 6000 | longer than the error default — though this is the one action-carrying toast, so it has the best case of the seven |

The 2400 ms error is the sharpest: it inverts the one duration rule *two independent codebases*
derived (§ Convergence), in the tone that most needs reading time.

### 7.H The action slot: 1 adopter in 475

`ToastAction` is a complete, correct, rendered primitive (`toastStore.ts:18`,
`ToastContainer.tsx:116-124`) with **one** call site. Meanwhile a class of toasts exists whose whole
content is an instruction the user must carry elsewhere —
`settings.account.updates_available_toast` = *"Update available — see the banner at the top to
install"*, `plugins.dev_tools.skills_load_failed_toast` = *"Failed to load skills. Make sure a
project with `.claude/skills/` exists."* Those are navigations, and the toast can perform them.

The machinery for it is already half-built and unused from the other end too: error toasts
automatically surface a nav action when the classifier produced a globally-executable one
(`ToastContainer.tsx:84-88`, `isGlobalErrorAction`) — a good design that only fires for the small
set of errors carrying an `explanation.action`.

### 7.I Sole-surface failures

`IdentitySettings.tsx:40-86` — five handlers, each `try { await … } catch { addToast('Failed to …',
'error') }`. The failure exists in exactly one place for five seconds. The field keeps the value the
user typed with no error marker, and the error object is destroyed by the bindingless catch, so
there is no trail either. Cited by [`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md)
§P3 for the discarded binding; recorded here for the other half — **the toast is the entire user-side
report of a failed identity mutation.** The healing path shows the correct shape by contrast: its
toast is a *notification of* something that also persists in `HealingIssuesPanel`, so a missed toast
loses nothing.

---

## 8. Gaps in the primitives

1. **There is no way to say "this one should persist."** Every toast auto-dismisses; `duration` is a
   number with no `null`/`Infinity`/`persist` escape hatch (`toastStore.ts:131`). The two 30-second
   successes in §7.G are that missing feature, spelled as a magic number. **Fix:** accept
   `duration: 'persistent'` and render without a progress bar, requiring an explicit dismiss. Small,
   and it removes the incentive to invent a sixth surface.
2. **Overflow toasts do not age.** Only `visible` items mount (`ToastContainer.tsx:297`), so ranks
   4-10 have no `useToastTimer` at all and sit indefinitely until promoted, then receive a **full
   fresh duration** while their elapsed label reads the true wall-clock age. Defensible (each toast
   gets its reading time) but undocumented and surprising: a burst of ten takes ~50 s to drain.
   **Fix:** decide it deliberately and write it in `capToasts`' docstring, or start the clock on
   enqueue for non-critical tones.
3. **No pause on keyboard focus.** `useToastTimer` returns `onMouseEnter`/`onMouseLeave` only
   (`:76`). The action button and the dismiss button are focusable, so a keyboard user can tab into
   a toast that then dismisses out from under them — WCAG 2.2.1. **Fix:** add `onFocus`/`onBlur` to
   the same `paused` state. Four lines, and the hidden-tab pause already proves the pattern.
4. **The message is `string`, so a machine string type-checks perfectly.** `addToast(message:
   string, …)` cannot express "this must be text the product wrote." §7.B's 20 sites all compile.
   See § Type over gate for what *can* be expressed.
5. **`friendlySeverityTranslated` exists and the healing badge does not use it.** One call swap at
   `ToastContainer.tsx:196`. Blocked on nothing.
6. **Nothing tests the toast layer.** Zero test files cover `toastStore.ts`, `ToastContainer.tsx` or
   `useToastTimer.ts` — the twelve test files that mention `addToast` all mock it to assert
   something else. Everything in §7 shipped under a green suite because the suite has no opinion.
   The three highest-value cases: `capToasts` evicts by priority not recency; a hidden tab does not
   advance the timer; an error toast is announced once, not twice.
7. **Two stacks, one z-order, no arbitration.** §7.C. `z-50` versus `z-[9990]` was chosen twice, by
   two authors, with nothing to reconcile them.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what
follows is a **proxy** for a semantic condition, tuned to this repo's idiom — and for this leaf the
warning must be unusually loud, because **the convergence check found no toast gate anywhere.**
`personas-web` ships five bespoke ESLint AST rules and points none at toasts, has zero unit or e2e
assertions mentioning one, and its only toast governance is prose in `design.md:472` that four of
its five implementations violate. `personas-cloud` has no UI. **Nobody has independently invented
gating toasts.** The rule below is local calibration; the *condition* it proxies is the part that
travels.

Everything in §7 shipped under a green `npm run check`, a green CI, and a green test suite.

### The semantic condition, stated stack-free

**C1 — a transient, auto-dismissing, corner-anchored surface is asked to carry an unbounded
machine-authored string as its entire message.** The three failures are simultaneous and
independent: unbounded (layout), untranslated (locale), unreviewed (content). *Precondition here:*
this repo funnels transient notifications through one `addToast(message, type)` store action and
spells raw-error extraction as an `instanceof Error` ternary. A repo that discards the error and
renders a fixed template — which is exactly what `personas-web` does at `agents/page.tsx:76-77` —
has already resolved this condition in the other direction and would score zero. Re-derive the proxy
against your own extraction idiom.

### Conditions deliberately NOT gated, each with the measurement

- **C2 — a toast doing an inline state's job (§7.E, 25 sites).** A regex over the guard-clause shape
  measured **4 of 8** on a hand-checked sample. The other four are legitimate refusals whose correct
  fix is a different tone or a disabled control, not an inline field error. **A gate at 50%
  precision must not be written** — the contract is explicit and `swallowed-error-telemetry.md`
  refused at ~70% for the same reason. This class needs the judgement of a reviewer, and §4 step 1
  is where it belongs.
- **C3 — a success toast preceding its own work (§0b).** Measured at **3** sites in this repo, all
  in one file, none clearly wrong. The condition is real — it is the sibling's dominant defect — but
  its in-repo population does not justify a ratchet, and the shape that matters there
  (`setTimeout(… void work(), 5000)` five lines after the success copy) is not regex-reachable
  anyway. **Refusing here is the finding**: the brief expected this class and the measurement does
  not support it.
- **C4 — a second toast stack (§7.C).** Population **1**. A census rule with `baseline: {files: 1}`
  is a tripwire, not a ratchet, and it would fire on the very file it describes. The right
  instrument is the one-file merge in the backlog below. Recorded so the next composer does not add
  the rule.
- **C5 — caller-authored English literals in a toast (54 sites).** Already counted by
  `discarded-toast-copy` (49 files / 94 matches), which belongs to
  [`i18n-string-authoring.md`](./i18n-string-authoring.md). **Not adding a second counter for a
  signal that is already counted.**
- **C6 — the double ARIA announcement (§7.D).** The sharpest correctness defect in the document and
  genuinely not countable: it is a property of *two* files agreeing, not of any line. It is a **test**,
  not a gate — assert that adding one toast produces exactly one live-region announcement — and Gap 6
  is where it goes.
- **C7 — duration overrides that fight the policy (§7.G, 7 sites).** Needs arithmetic against a
  per-tone table, which a regex cannot do. Seven sites is a backlog item, not a gate.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "raw-error-as-toast-message",
      "goldenPath": "docs/concepts/golden-paths/toasts.md",
      "title": "A transient notification whose entire message is a machine-authored error string",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "addToast\\(\\s*(?:[A-Za-z_$][\\w$]*\\s+instanceof\\s+Error\\s*\\?|String\\(\\s*(?:e|err|error)\\s*\\)|extractMessage\\()(?:(?!addToast\\()[\\s\\S]){0,200}?,\\s*['\"]error['\"]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the FIRST argument to an error toast BEGINS with a machine-authored error expression - an `x instanceof Error ? x.message : ...` ladder, `String(err)`, or `extractMessage(err)` - so the entire visible text of the notification is a string the product never wrote. PROXY FOR the stack-free condition: a transient, auto-dismissing, corner-anchored surface is asked to carry an unbounded machine-authored string as its whole message, which is simultaneously a layout failure (unbounded), a locale failure (untranslated in all 14 locales) and a content failure (unreviewed). ANCHORED DELIBERATELY: a TRANSLATED FRAME with the detail scoped inside - tx(t.schedules.toast_update_failed, { error: err instanceof Error ? err.message : String(err) }), 14 sites - is the CORRECT shape prescribed by this path's step 5 and is NOT matched. Three template-literal frames with hardcoded English around the same ternary (CreateTriggerForm.tsx:37, useEditorSave.ts:139, ChronologyAdoptionView.tsx:1137) are also excluded by the anchor: they are the same rendering defect but their PRIMARY defect is untranslated English, which belongs to discarded-toast-copy in i18n-string-authoring.md. BOTH COUNTS WERE PRODUCED TWICE, as the contract requires for a multiline pattern: this regex and an independent brace-matching argument extractor (comments stripped, arguments split at paren depth 1) agree exactly - the unanchored variant at 37 matches / 19 files, the anchored variant shipped here at 20 matches / 12 files. WHY THIS IS NEWLY URGENT: until 2026-08-14 ToastContainer.tsx computed `friendly = classifyErrorFull(toast.message).friendly` and rendered `friendly?.message ?? toast.message`, and resolveError() ALWAYS returns a FriendlyError, so the right branch was unreachable and every one of these strings was replaced by the generic 'Something went wrong.' ToastContainer.tsx:78-79 now reads `matched ? friendly.message : toast.message` with matched = (friendly !== null && friendly.category !== 'unclassified'), so the unmatched branch is LIVE for the first time. Measured against a corpus of 25 real Rust AppError Display strings built from the #[error(...)] templates in src-tauri/core/src/error.rs with placeholders filled: 17 of 25 match NEITHER the 65 ERROR_KEY_MAP matchers NOR the 62 ERROR_RULES matchers, and therefore now render verbatim - including 'Database error: UNIQUE constraint failed: personas.name', 'Rate limited: 429 from api.anthropic.com; retry-after 42s' and 'Serialization error: missing field capabilities at line 1 column 84'. Three registry rules are additionally DEAD because they match the PascalCase Rust variant names NetworkOffline / NotFound / RateLimited while the wire carries the Display strings 'Network offline: ...' / 'Not found: ...' / 'Rate limited: ...' (error.rs:173-179); those three tokens appear nowhere in the repo outside the registries and their own tests. sanitize_error_message (error.rs:144-153) strips absolute file paths ONLY, and only for the Database/Io/Internal variants - not hostnames, SQL identifiers, URLs or ids - and Sentry's scrubPii runs in beforeSend/beforeBreadcrumb, i.e. on the TELEMETRY path, never on the toast. The standard toast has NO clamp: `truncate` and `line-clamp-2` appear only on the healing variant (ToastContainer.tsx:192, :216), while the message span at :112 is a bare `typo-heading block` inside a max-w-sm card. PRECONDITION (measured, must be re-derived per repo): this repo funnels every transient notification through ONE addToast(message, type) store action and spells raw-error extraction as an `instanceof Error` ternary. personas-web made the OPPOSITE choice at src/app/dashboard/agents/page.tsx:76-77 - `catch {` with no binding and a fixed i18n template - so this pattern scores ZERO there while the underlying question is answered by all five of its hand-rolled toast components. LEGAL FIX, in order of preference: (1) `.catch(toastCatch('feature:operation'))` from @/lib/silentCatch, which performs the same extraction AND emits log.warn + a Sentry breadcrumb first, which a bare addToast does not; (2) a translated frame, tx(t.<section>.<op>_failed, { error }), keeping the sentence localized and the raw detail scoped; (3) where no error object exists because the guard fired before any work started, an inline field/panel state rather than a toast at all."
      },
      "exclude": [
        {
          "path": "src/lib/silentCatch.ts",
          "reason": "toastCatch is DEFINED here - silentCatch.ts:126-130 is addToast(customMessage || msg, 'error', 5000) with msg = extractMessage(err). This is the sanctioned door the rule routes callers TO, not a call site, and it earns the raw string because it emits log.warn + a Sentry breadcrumb before rendering it. Scoped to this one file rather than a src/lib/** glob so that future render-facing code under lib is still counted"
        }
      ],
      "baseline": { "files": 12, "matches": 20 },
      "floor": 4000
    }
  ]
}
```

**Measured result** — validated standalone against a scratch rules file, never against
`scripts/census/rules.json`:

```
  rule                    files   base  matches   base  walked  floor
  OK   raw-error-as-toast-message     12     12       20     20    4829   4000
  census OK — 1 rule(s), 4829 file-visits, 20 surviving violation(s) across 12 file(s).
```

`--check` exits **0**. The floor of 4,000 sits below the observed 4,829 `.ts`+`.tsx` under `src`
with margin, consistent with the eleven existing `roots: ["src"]` rules.

**Precision: 20/20 by construction.** The condition is not "this looks like a raw error" — the
matched expression *is* the raw error, and it *is* the first argument. There is no judgement call in
the signal, which is exactly why this class was chosen over the three larger but fuzzier ones above.

### How it fails loudly if its own precondition is absent

Not asserted — **executed**. Every failure mode was induced against the real working tree and the
exit code captured:

| Fault induced | exit | runner says |
|---|:---:|---|
| (unmodified) | **0** | `census OK — 1 rule(s), 4829 file-visits, 20 surviving violation(s)` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` → 9000 (above the walk) | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| baseline inflated to 120/200 (a silent drop) | **1** | `[drift] files dropped 120 -> 12 (-108) without the baseline moving.` |
| baseline deflated by 1 (a rise) | **1** | `[drift] matches rose 19 -> 20 (+1). New violations of …toasts.md` |
| `exclude` path renamed to `silentCatchMOVED.ts` | **1** | `[structural] exclude "src/lib/silentCatchMOVED.ts" matched no file. The exemption is stale` |
| `roots` renamed `src` → `app` | **1** | `[structural] walked 0 files but floor is 4000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| `exclude` `reason` removed | **1** | `exclude[0] ("src/lib/silentCatch.ts") needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **a real violation appended to a real source file** (`useBlenderMcp.ts`) | **1** | `[drift] matches rose 20 -> 21 (+1)` |

The last row is the one that matters: an actual
`addToast(err instanceof Error ? err.message : String(err), 'error')` written into a real source
file moved the count by exactly 1 and failed the gate; reverting it returned the tree to exit 0 with
no residue (`git status --porcelain` clean for that path). The reason-required check earned its keep
during composition — it fired on the first draft and forced the exclusion to state what it stands in
for, which is how it ended up scoped to one file rather than a `src/lib/**` glob that would have
hidden future render-facing code.

### Sequencing

1. **`raw-error-as-toast-message` immediately.** 20 sites, one legal fix (`toastCatch(context)`)
   that is strictly better than what is there — it produces the same text *and* a Sentry
   breadcrumb — and a working precedent in 389 other call sites.
2. **Fix the three dead registry rules first, in the same commit if possible.** Change
   `'NetworkOffline'` → `'Network offline'`, `'NotFound'` → `'Not found'`, `'RateLimited'` →
   `'Rate limited'` in both `ERROR_KEY_MAP` (`useTranslatedError.ts:71,109,85`) and `ERROR_RULES`.
   Three one-word edits localize the three commonest failures in the app and shrink the raw-string
   exposure before anyone migrates a call site. Add both spellings if the PascalCase form is ever
   produced by a path I did not find.
3. **`ToastContainer.tsx:196` → `friendlySeverityTranslated(t, toast.severity)`** and delete the
   stale justification comment at `silentCatch.ts:121-125`. Both are one-liners owed by today's
   change (§7.0).
4. **Fix the double announcement** (§7.D) — drop `role`/`aria-live`/`aria-relevant` from
   `ToastContainer.tsx:278-280` and add `aria-hidden` — **and ship the test with it** (Gap 6). This
   is the highest-value correctness fix in the document and it is invisible to every existing gate.
5. **Merge `AlertToastContainer` into the unified store** (§7.C). Add an `info` tone or map
   `info → warning`, then delete the second container. One file, and it removes the z-order conflict,
   the missing pause, the missing live region and the unnamed dismiss button in one move.
6. **Add `onFocus`/`onBlur` to `useToastTimer`** (Gap 3). Four lines, WCAG 2.2.1.
7. **Land the options-object signature** (§ Type over gate), then burn down §7.G's seven duration
   overrides and §7.E's 25 guard-clause toasts with reviewer judgement, not a gate.

---

## Type over gate — the answer

**Yes for two of the four defect classes, and the type change is small.** `addToast`'s signature is
upstream of nearly everything in §7:

```ts
addToast: (message: string, type: 'success' | 'error' | 'warning',
           duration?: number, action?: ToastAction) => void     // toastStore.ts:106
```

Four positional parameters, the last two optional and untyped beyond their primitives. Every
deviation except §7.C and §7.D passes through it.

**1. What the type already gets right, and it is worth naming.** The tone is a **closed union**, so
`addToast(msg, 'info')` is a compile error today — which is why the `info` tone leaked into the
*second* container (§7.C) rather than into this one. The closed union did its job: it pushed the
unsanctioned tone out of the primitive entirely. That is the mechanism working, and it is the
argument for step 5 of the sequencing rather than against it.

**2. Where a type closes a real class: the optional slots.** Replace the two trailing positionals
with a named options object, and two of §7's sections stop being representable:

```ts
type ToastOptions = {
  /** Overrides the per-tone default. 'persistent' requires an explicit dismiss. */
  duration?: number | 'persistent';
  action?: ToastAction;
};
addToast(message: string, type: ToastTone, opts?: ToastOptions): void;
```

- It closes **Gap 1** — the 30-second success (§7.G) becomes `duration: 'persistent'` or stops being
  written, because the magic number was always a request for a feature that did not exist.
- It makes the **action slot discoverable**. §7.H's 1-in-475 adoption is substantially a *signature*
  problem: reaching `action` today requires typing `undefined` into the third position. `{ action }`
  costs nothing and reads as an offer.
- It is **~32 mechanical edits** — only the sites that pass a third or fourth argument change at
  all; 443 of 475 are untouched.

**3. Where a type reaches the deepest, and this is the leaf's real finding.** §7.B's twenty sites
type-check perfectly, because the parameter *is* `string` and a string is what was passed. No
signature on `addToast` can express "this text was written by the product." But one further up
**can**: the reason a machine string is available to pass at all is that the error's structure was
already destroyed. `extractMessage(err)` flattens a typed `AppError` envelope — `{ error, kind,
category, auto_fixable, failover_eligible }` (`error.rs:171-214`) — into one string, and
`toastCatch` then calls `classifyErrorFull` on the flattened result (`silentCatch.ts:108`) and
pattern-matches the prose with 127 substring rules across two hand-synced tables. The `kind`
discriminant that would make all of it unnecessary is present on the wire and thrown away one
function earlier. **§7.B is not a call-site defect; it is what a lost type looks like on screen.**
The cure belongs to [`typed-error-contract.md`](./typed-error-contract.md), and this document's
contribution is the number: 17 of 25 real backend errors, plus three dead registry rules covering
the three commonest failures, plus an unclamped card.

**4. Where a type would be wrong, and the oracle is why.** I intended to propose removing `'error'`
from `addToast`'s tone union entirely — forcing every failure through `toastCatch` / `reportError`,
which are the telemetry doors — so that "an error toast with no trail" would be unrepresentable. It
is a clean type-over-gate move and it would be 204 mechanical edits. **The convergence check refuses
it.** Caller-chosen tone is reinvented in every sibling surface that has tones at all
(`showToast("error", …)`, `status: "success" | "error"` declared twice independently); nothing
anywhere rediscovered "the error tone is not the caller's to pick." Per the contract, a clause with
no trace elsewhere is local calibration and must not be presented as doctrine. It stays here, marked,
as a proposal a maintainer may weigh — and it is deliberately absent from the head and from §2.

So the general rule for this situation is the mirror of what
[`i18n-string-authoring.md`](./i18n-string-authoring.md) found. **There, the key space was already a
closed type and the leverage was in making every place copy can be written accept a key. Here the
*tone* is already a closed type and it demonstrably works — the leverage is in closing the two
slots beside it, and in restoring the type the error lost three functions before it reached this
one.** Everything else in this document is a judgement a signature cannot make, which is why §9
gates one class of twenty and refuses four larger ones.
