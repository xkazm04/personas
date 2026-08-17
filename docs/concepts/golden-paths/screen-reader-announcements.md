# Golden path — Screen-reader announcements

> Situation node: `ui-system/motion-and-accessibility/screen-reader-announcements`
> (recurrence 64, convergence `diverged`, risk `high`) · [situation spine](../situation-spine.md)
> Composed 2026-08-14 at `80c27811d`. Sweep: **2,104 `.tsx` files** walked and parsed
> with a brace/quote-aware JSX opening-tag scanner (not grepped) and every
> `aria-live` / `aria-atomic` / `aria-relevant` / `aria-busy` / `aria-label` /
> `aria-labelledby` / `aria-describedby` / `role` attribute extracted and classified;
> a second pass over every live region's enclosing component to separate persistent
> regions from ones mounted with their own text; full reads of `AriaLiveProvider`,
> `LoadingSpinner`, `ToastContainer`, `AlertToastContainer`, `toastStore`,
> `CharBudget`, `EstimatedProgressBar`, `SystemLoadFooterIcon`, `AthenaChatLiveRegion`,
> `CanvasShell`, `Sidebar`, `UnifiedTable`, `DataGrid`, `FormField`, `Listbox`,
> `Tooltip`, `no-hardcoded-jsx-text.cjs`, all 21 custom ESLint rules and all 51 census
> rules; the ARIA live-region specification fetched and quoted rather than recalled;
> and a convergence census of **two** sibling repos (`personas-web`, `brainiac/console`).
> Dimensions: **ui · function · code-quality** (+ i18n, which the evidence forced in).
> **Settles:** what the product says out loud when something changes on its own — which
> surface says it, how urgently, how often, and in whose language.
>
> Corpus counts are cited from [`shared-facts.json`](../shared-facts.json); everything
> else was measured during composition. Deviations become `violating` cells.

---

## 0. The three inherited findings, re-verified at the working tree

The brief handed me three measurements from earlier leaves in this wave. All three were
checked against source rather than assumed, and **all three hold**:

| Inherited claim | Verdict |
| --- | --- |
| `tooltip.md`: `aria-describedby` is broken at 194/194 sites in two ways on one line | **CONFIRMED.** `Tooltip.tsx:298` reads `aria-describedby={visible ? tooltipId : undefined}` and sits on the wrapper `<span>` (`:296-303`) whose child is `{children}` — the ancestor of the focused control, not the control. `visible` flips only after the delay timer. |
| `toasts.md`: every toast is announced twice; the two texts differ for matched errors | **CONFIRMED.** `toastStore.ts:138` calls `announceImperative(message, …)` and `:168` does the same for healing toasts, while `ToastContainer.tsx:280-284` is itself `role="status" aria-live="polite" aria-relevant="additions removals"`. That `aria-relevant` is **the only one in the repo** — MDN's default is `additions text`, so this container is uniquely configured to also speak dismissals. |
| `focus-management.md`: `useRovingTabIndex` has zero adopters; `AriaLiveProvider` already exists | **CONFIRMED.** Zero references to `useRovingTabIndex` outside its own file. `AriaLiveProvider` exists and is mounted exactly once (`App.tsx:322`). |

**The brief was right on all counts.** One thing it framed as an open question has a
clean answer worth stating up front: *"whether there is one host or many."* There is
**one announcer host** and **three announcement surfaces**, which is worse than either
extreme sounds — see §7.C.

### The boundary with `focus-management.md`, settled

That path and this one are the two halves of the same subdomain and they divide cleanly
on a single question: **does the user's attention move, or does the product speak
without moving it?**

| Question | Owner |
| --- | --- |
| Where does focus go when a surface opens / closes / changes? | [`focus-management.md`](./focus-management.md) |
| Can focus **reach** this element at all? Is the focus ring visible? | `focus-management.md` |
| Who owns a global key, and do arrow keys move focus? | `focus-management.md` |
| **Something changed and nobody moved — is it spoken?** | **here** |
| **Which region speaks it, how urgently, how often, and in what language?** | **here** |
| Is the accessible name a translated string? | **here** (see below for the split with `button.md`) |

The seam is testable and the populations barely touch. Focus-management's two census
signals are keyed on `addEventListener('keydown'` and `cursor-pointer`+`onClick`; this
path's is keyed on `aria-live`/`role="status"`. **Zero files overlap.** The one place
they genuinely meet is the *announcement-by-focus-move* fallback: moving focus to a new
node causes assistive technology to read it, which is why `FormErrorSummary`'s `jumpTo`
(`FormErrorSummary.tsx:27-36`, that path's mandated primitive) is also, incidentally, an
announcement. That is the only sanctioned overlap and it belongs to them, because the
decision it makes is *where focus goes*.

Two further seams, stated so they are not re-litigated:

- **[`button.md`](./button.md)** owns *whether a control has an accessible name at all*
  (844 unnamed icon controls). This path owns *whether the name can be spoken in the
  user's language* — the 116 hardcoded-English accessible names in §7.E, a population
  `button.md`'s corpus does not distinguish because an English name is still a name.
- **[`toasts.md`](./toasts.md)** owns the toast's own double announcement (its §7.D) and
  the one-file fix. This path owns the **general** rule that produced it, the other
  instances of it, and the surface that has the opposite defect (`AlertToastContainer`,
  §7.C). Non-overlap test: a toast that announces exactly once, in perfect copy, for an
  event the user did not cause is 100% compliant with that path; if the *same* event
  also renders a `role="status"` chip elsewhere on screen it violates this one.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md)'s recommendations #1 and #2,
the head is physically separated and every clause carries its **warrant**, so an adopting
repo can tell physics from local calibration. No file path, primitive name or count
appears below this line until the head ends.

> **P1 — physics.** A change the user did not cause is invisible to anyone who is not
> looking at the pixel that changed. If the only evidence that something happened is a
> colour, a position, or a number that moved, the change did not happen for a large class
> of users. Deciding not to announce it is a decision; not thinking about it is the same
> decision made by default.
>
> **P2 — physics, and the one this whole document turns on.** The region that speaks must
> already exist when the message arrives. Assistive technology announces *changes* to a
> region it is watching; a region that appears already holding its text presents no
> change to observe. Render the region unconditionally and empty, then put the message
> inside it as a separate step. This is not a style preference — it is the difference
> between an announcement and no announcement, and the two look identical in the DOM, in
> review, and in every automated check.
>
> **P3 — physics.** There is exactly one urgency worth interrupting for: something the
> user must know *now*, ahead of whatever is currently being read. Everything else waits.
> A system that interrupts for routine status trains the user to ignore interruptions,
> and then the one that mattered is ignored too.
>
> **P4 — physics.** An urgent-by-default region is the one construct exempt from P2:
> because it exists to interrupt, it is announced when it appears, text and all. That
> exemption is narrow, it is the *only* one, and it does not transfer to the polite
> region next to it.
>
> **P5 — physics.** One event, one utterance. Two surfaces that both describe the same
> change speak it twice, and the second one is invisible to everybody who could have
> caught it — including the person who added it. This gets *worse* as each surface is
> independently improved, because the two texts drift apart and the user hears a
> contradiction.
>
> **P6 — physics.** A region that changes faster than a sentence can be spoken is not
> communicating, it is jamming. A progress percentage, an elapsed-second counter, a
> character count, a streaming transcript — each is a stream, not a message. Announce
> the transitions that carry meaning (started, crossed a threshold, finished) and mark
> the rest as not-live. **Over-announcement is strictly worse than silence**, because
> silence leaves the rest of the interface usable.
>
> **P7 — physics.** Text that only ever exists to be spoken is still product copy. It is
> the *only* copy for the users who receive it, and it is the copy least likely to be
> reviewed, because nobody on the team ever sees it. Anything that reaches a live region,
> an accessible name, or an imperative announcement is translated on the same terms as a
> heading.
>
> **P8 — ergonomics.** A busy indicator that renders nothing and says nothing is not a
> lightweight busy indicator; it is the absence of one, with an import. If a component's
> entire contribution is optional, its default is what ships.
>
> **P9 — ergonomics.** An accessible name replaces the element's content for the user who
> hears it. Putting a fixed name on an element whose *content* is the status hides the
> status. The name says what the thing is; the content says what happened.
>
> **P10 — house convention, with evidence of need.** Announcements from outside the
> render tree — a store, a subscription, a background job — go through one registered
> queue rather than a region invented at the point of need. *No sibling repo reinvented
> this*; both hand-roll a region per site. Adopt it as a proposal, not as received
> doctrine; it pays from about the third surface that needs to speak without owning a
> region.
>
> **Scale condition.** P1–P4, P7 and P9 pay from the first announcement. P5 and P6 pay as
> soon as two surfaces or one stream exist. P8 pays the moment a busy primitive is shared.
> P10's queue pays at the scale where nobody reviews every region.

**Warrant evidence — what two siblings reinvented, and the one that matters most is a
defect they reinvented too.**

Checked against `personas-web` (Next.js, 597 `.tsx`, 14 locales, no shared code) and
`brainiac/console` (Next 15, 245 files, no i18n layer at all). Neither has seen this
document; neither has a live-region library in its dependency tree.

| Clause | Verdict | Sibling evidence |
| --- | --- | --- |
| **P1 — a live region is the mechanism** | **PHYSICS** | Reached independently 32 times in `personas-web` (~29 separate hand-rolls) and 7 times in `brainiac/console`. Nobody was told to; everybody arrived. |
| **P2 — the region must pre-exist** | **PHYSICS, warranted by a defect — which is stronger** | **`personas-web`: 20 of 28 regions mount with their text. `brainiac/console`: 6 of 7.** Here: 26 of 82. Three codebases, three teams, the same broken shape at three different rates. A mistake reinvented three times is a hazard in the problem, not carelessness in one team. |
| **P2's *fix*** | **NOT convergent — this is the finding** | The correct construction exists in `personas-web` 8 times (and `FINDINGS.md:193` records that it was **retrofitted after an audit**, not designed in) and in `brainiac/console` exactly once — in a file whose own header says *"DELETE THIS FILE when the round consolidates."* **The defect converges; the fix does not.** That asymmetry is the signature of a requirement you can only get from the specification. |
| **P3 — polite/assertive split** | **PHYSICS (weak — 1 of 2)** | `personas-web` reached it and even wrote the elegant form (`ExecuteToast.tsx:38`, `isError ? assertive : polite`). `brainiac/console` has **zero** `assertive` and **zero** `role="alert"`: success and failure share one polite region at all four of its action sites and the urgency is carried **entirely in colour**. |
| **P4 — the alert exemption** | **PHYSICS (weak — 1 of 2)** | `personas-web` uses `role="alert"` 9 times, mostly for genuine interruptions. `brainiac/console` never uses it. Neither states the exemption; both benefit from it accidentally. |
| **P5 — one event, one utterance** | **PHYSICS, warranted by a defect** | `personas-web` has 3 independent doubles (a `role="log"` stream + a `role="status"` badge narrating the same run; an `aria-label` swap + a live tooltip with the same sentence; a `title` + a `role="alert"` with the identical string). `brainiac/console` puts the same fact twice inside one region (`Skeleton.tsx:74` + `:76`). Here it is the toast layer. Nobody avoids this; everybody hits it. |
| **P6 — over-announcement** | **PHYSICS, and a sibling wrote the reasoning down** | `personas-web` discovered it **twice, independently**: `TerminalSim.tsx:23` puts `aria-live="off"` on an elapsed-time counter, and `UndoToast.tsx:56-58` puts `aria-hidden` on a per-second tick **with the comment** *"the live region announces once on appearance; the per-second tick would otherwise re-announce every second."* It then violated it flagrantly by wrapping a per-character typing simulation in `role="log" aria-live="polite"`. Reinvented **and** re-broken in one repo is the strongest evidence a clause can carry. |
| **P7 — announced text is translated** | **The rule is written and unenforced in both** | `personas-web` ships 14 locales, its own `design.md:456` forbids hardcoded English in `aria-label` — and ~44% of its 141 `aria-label`s are raw English. It even has a scanner (`scripts/report-hardcoded-ui-strings.mjs:11`) that reads `aria-label`, wired into neither CI nor its git hooks. `brainiac/console` has no i18n layer at all: 49 of 49 raw English. |
| **P8 — a mute busy state** | **PHYSICS, warranted by a defect in all three** | `personas-web`: **1 of 4** spinner/skeleton components carries `role="status"` + text; its bulk-progress toast has a live `{done}/{total}` counter and no region at all. `brainiac/console`: **0 of 15** loading surfaces carry `role="status"`, and because the region unmounts on resolve, *loading finished* is never announced anywhere. Here: 21 of 252. |
| **P9 — a name that masks its content** | **PHYSICS (weak — 1 of 2), and the sibling's instance is the clearest** | `brainiac/console`'s `AddressBar.tsx:71-83` puts a **static** `aria-label="Copy a link to this exact view"` on the one button whose *children* are the only success/failure feedback — so the name hides the outcome entirely. Here: 10 live regions carry a competing `aria-label` (§7.F). |
| **P10 — one registered announcer queue** | **LOCAL CALIBRATION — mark it** | `personas-web`: 0 (`useAnnounce`, `announce()`, `<LiveRegion>`, `<VisuallyHidden>` — none exist; its only imperative announcer is opt-in **TTS**, `lib/review-voice.ts`, 1 adopter). `brainiac/console`: 0, and no imperative DOM path at all (`createElement`/`appendChild`/`setAttribute`/`textContent` return zero hits repo-wide). **Nobody else built this.** It is a genuine Personas advantage, not doctrine. |
| **Any lint rule or test gating announcements** | **LOCAL CALIBRATION — nobody has one, including us** | `personas-web`: 5 bespoke ESLint AST rules, none touching ARIA; 88 `getByRole` calls across 10 e2e specs with **zero** on `status`/`alert`/`log`; no `jsx-a11y`. `brainiac/console`: a real source-parsing a11y contract test (`src/design/focus-contract.test.ts`, 172 lines, 6 assertions, a reasoned allowlist) **aimed entirely at focus and never extended one inch toward announcement**; `jsx-a11y` present only transitively, 6 rules, all `warn`, none about live regions. §9 must be marked as manifestation, hard. |

**What the oracle inverted.** I intended to argue that the shared announcer (P10) is the
load-bearing clause — the thing an adopting repo should take first. **The oracle refuses
it.** Neither sibling has one, and `brainiac/console` demonstrates why that is survivable:
its 15 loading surfaces all inherit their live-region markup from a single `SkeletonFrame`
that nobody designed as an announcer. A shared *component* delivered the same coverage a
shared *hook* would have, without anyone deciding to build an announcer. The clause that
actually travels is **P2**, and the reason it travels is that every codebase gets it
wrong: 26 of 82 here, 20 of 28 there, 6 of 7 in the third.

**Applying `tooltip.md`'s lesson, because it changes how the thin convergence should be
read.** That path earned and stated the rule: *convergence measures **discoverability**,
not whether a requirement is real.* Screen-reader behaviour is almost entirely the second
kind — you cannot notice a missing announcement by using the product, only by running a
screen reader or reading the spec. So thin convergence was expected here, and it arrived:
of the ten clauses above, the ones both siblings reinvented (P1, P5, P6, P8) are exactly
the ones you find by noticing something is *wrong* — a double utterance is audible, a
jamming region is audible, a silent skeleton is a visible gap in a design review. The
ones they missed (P2, P4, P9, P10) are the ones you only get from reading. **For an
accessibility floor, two codebases agreeing is evidence about the shape of the problem,
not a licence to relax.**

---

## 1. Trigger

- "Tell them when the run finishes." / "Let them know the sync completed."
- "The list filtered — say how many results there are now."
- "This banner should pop when the connection drops."
- "Add a loading state here." / "Show a spinner while it fetches."
- "Give this icon button a label."
- "Announce the new message." / "The badge count changed."
- "The alert fired — surface it."
- **If you are about to write** `aria-live`, `role="status"`, `role="alert"`,
  `role="log"`, `aria-label`, `className="sr-only"`, `announce(`, or
  `<LoadingSpinner`, — you are in this situation.

You are **not** in this situation for:

- **where the cursor goes** when something opens or closes →
  [`focus-management.md`](./focus-management.md).
- **whether a control has a name at all** → [`button.md`](./button.md) §9 (Signal B).
- **which words, in which language, for a toast** →
  [`i18n-string-authoring.md`](./i18n-string-authoring.md) owns the catalog and the key.
- **whether a toast is the right surface, its tone and its duration** →
  [`toasts.md`](./toasts.md).
- **what a surface renders while it fetches** →
  [`docs/design/overview-loading.md`](../../design/overview-loading.md) owns the ghost;
  this path owns whether the ghost also *says* anything.
- **a busy state on a control the user just pressed** →
  [`inline-busy-state.md`](./inline-busy-state.md).

---

## 2. The one way

**Decide first whether the change was requested.** If the user pressed something and the
result lands where they are looking, the control's own busy and settled states carry it —
say nothing extra. If the change arrived on its own, or landed somewhere other than where
the user's attention is, it needs to be spoken, and there is one way to speak it: call
`useAnnounce()` in a component or `announceImperative()` from a store, and pass a
translated string. **Do not build a live region.** The app already owns two — a polite one
and an assertive one, both permanently mounted at the root — and the single most common
defect in this territory is a local `<div aria-live="polite">` that only renders when it
has something to say, which is a region nothing can ever observe changing. If you
genuinely need a region *in place* (a search-result count next to the box, a keyboard
cursor readout), render it unconditionally with `className="sr-only" aria-live="polite"`
and swap its **text**, never its existence — `{busy ? label : ''}`, never `{busy && …}`.
Reserve interruption for things that change what the user is about to do: `role="alert"`
for those, `role="status"` or `aria-live="polite"` for everything else, and never both
`role="alert"` and `aria-live="polite"` on one element, which downgrades the alert you
just asked for. Never point a live region at something that ticks — a percentage, an
elapsed second, a character count, a streaming transcript — announce its start and its
end and mark the stream itself `aria-live="off"` or `aria-hidden`. Announce each event
exactly once: if a container is already a live region, nothing inside it may announce
again. Every string you announce goes through `t.*` / `tx()` and all 14 locales in the
same change, including the ones in `.ts` files, where no lint rule can see them. Never
render `<LoadingSpinner>` without a `label` — it renders `null`, so a labelless one is an
import that produces nothing at all; prefer the surface's ghost or `AsyncButton`. And put
an `aria-label` on a control to say what it *is*, never on a region whose content is the
message — a name replaces content for the person listening.

---

## 3. Mandated primitives

- **`src/features/shared/components/feedback/AriaLiveProvider.tsx` — `useAnnounce()` /
  `announceImperative()`** — the announcer. Two permanently-mounted `sr-only` regions at
  the app root (`:97-116`): polite (`role="status" aria-live="polite" aria-atomic="true"`)
  and assertive (`role="alert" aria-live="assertive" aria-atomic="true"`). Mounted **once**,
  at `App.tsx:322`. Read `:34-38` before anything else — it documents the failure this
  design exists to prevent: *"A burst of `announce()` calls in one tick would otherwise
  collapse: React coalesces the setState calls so only the LAST message reaches the live
  region."* It queues, flushes one per 150 ms, and bumps a `key` per message so a repeated
  string still remounts the node and is spoken again (`:28-30`, `:48`). The unregister
  guard at `:76-79` is the other detail worth copying — it only clears the imperative
  handle if it is still the owner, so a remount cannot silence the app for the rest of the
  session. **8 adopters** (6 `useAnnounce`, 2 `announceImperative`) against 82 hand-rolled
  regions. This is the most under-used correct primitive in the leaf.
- **`useAnnounce()`'s politeness parameter** — `(message, politeness: Politeness = 'polite')`
  (`:62`). Optional with a safe default, and the default is the *quiet* one. This is the
  right shape and §Type-over-gate explains why.
- **`src/stores/toastStore.ts:138`** — the model for **deriving** politeness rather than
  asking for it: `announceImperative(message, type === 'error' ? 'assertive' : 'polite')`.
  The caller picks a tone; urgency follows. `:165-168` does the same from healing severity.
  Copy this shape; do not add a politeness argument to your own API.
- **`src/features/shared/chrome/sidebar/Sidebar.tsx:178-183`** — the reference **in-place**
  region: `<div className="sr-only" aria-live="polite" aria-atomic="true">` rendered
  unconditionally, holding four independently-conditional count sentences, each through
  `tx()` with `_one`/`_other` plural variants. Permanent container, conditional text,
  translated, atomic. If you need a local region, this is the shape.
- **`src/features/plugins/companion/chat/AthenaChatLiveRegion.tsx`** — the reference for a
  **stream**. Its whole job is to *not* announce during streaming: `if (streaming) return ''`
  (`:21`), so the region holds the completed reply and nothing else. The header comment
  states the reasoning and the reason it is its own component. This is P6 implemented.
- **`src/features/teams/sub_mastermind/lib/CanvasShell.tsx:910-914`** — the reference for a
  **keyboard cursor** readout, with the best one-line justification in the repo:
  *"The ring is the visual answer to 'where am I'; this is the spoken one."*
- **`role="alert"` (implicitly assertive) for interruptions; `role="status"` /
  `aria-live="polite"` for everything else.** `shared/components/feedback/Banner.tsx:110`
  and `InlineErrorBanner.tsx:63` both derive **both** attributes from one severity prop —
  `role={isAlert ? 'alert' : 'status'} aria-live={isAlert ? 'assertive' : 'polite'}` — so
  the pair can never disagree. Use these two rather than hand-writing the pair.
- **`src/i18n/useTranslation.ts` — `t` / `tx`**, and `getActiveTranslations()` for `.ts`
  modules. Announced text is copy.

**Deliberately NOT a primitive.**
`src/features/shared/components/feedback/LoadingSpinner.tsx` — it renders `null` unless
given a `label`, and 231 of its 252 call sites do not give it one. `CLAUDE.md` already
calls it a compatibility shim; this path measures the consequence (§7.D) and recommends
deleting it (§8 Gap 1). And
`src/features/overview/sub_observability/components/AlertToastContainer.tsx`, which has
**zero** `aria-` attributes and **zero** roles in the entire file (§7.C).

---

## 4. Steps

1. **Ask whether the user caused this change.** Pressed a button and the result appears
   on that button → nothing to announce; that is
   [`inline-busy-state.md`](./inline-busy-state.md). Arrived on its own — a poll, a
   subscription, a backend event, a background job, a timer → continue. Landed somewhere
   other than where they are looking → continue.
2. **Reach for `useAnnounce()` before you reach for markup.** One call, no region, no
   politeness argument unless you need `assertive`, no lifecycle to get wrong. The
   provider is already mounted and already persistent, which means **step 3's defect is
   unreachable through this door.**
3. **If you must have a region in place, mount it unconditionally.** Render it always,
   empty at rest, and make the *text* conditional:
   ```tsx
   <span className="sr-only" aria-live="polite">{busy ? t.x.loading : ''}</span>   // yes
   {busy && <span className="sr-only" aria-live="polite">{t.x.loading}</span>}     // no
   ```
   The second form compiles, renders, passes review, and announces nothing. **26 live
   regions in this repo are the second form.** The same defect wearing a different hat is
   a component that early-returns `null` above its own region — 9 more sites — so check
   the whole component, not just the JSX line.
4. **Pick the urgency from what the user must do, not from how bad it feels.**
   `role="alert"` only if it changes what they are about to do next. Everything else is
   `role="status"`. Never write `role="alert"` and `aria-live="polite"` together — the
   explicit polite wins and you have shipped a downgraded alert
   (`PersonaEditorHeader.tsx:128` is the one live instance).
5. **If the thing updates continuously, it is not a message.** Announce start and finish;
   mark the stream itself `aria-live="off"` or wrap the ticking part in `aria-hidden`.
   A percentage, an elapsed counter, a character count and a streaming transcript are all
   streams. `AthenaChatLiveRegion.tsx:21` is the worked example.
6. **Check nothing else already announces this event.** If your component is inside a
   container that is a live region, adding a second one doubles the utterance. If you are
   also calling `announceImperative`, the container must not be live. §7.B is what
   happens when this step is skipped.
7. **Write the string as `t.*` / `tx(…)` and translate all 14 locales in the same change.**
   This applies with *more* force here than anywhere else in the app, because announced
   text is the only copy nobody on the team will ever see. `npm run check:i18n:strict` is
   part of finishing. Note that if you are in a `.ts` hook or store, **no lint rule can
   see your string at all** — the one that exists has only JSX visitors.
8. **Name controls; do not name regions.** `aria-label` on a button says what it does.
   `aria-label` on a live region replaces the message the region exists to deliver.
   10 regions here carry one (§7.F).
9. **Do not render `<LoadingSpinner>`.** If a surface is fetching, it gets a ghost
   ([`overview-loading.md`](../../design/overview-loading.md)); if a control is working,
   it gets `AsyncButton`. If you are genuinely keeping the spinner, `label` is not
   optional — without it the component returns `null` and you have imported nothing.
10. **Ask the type question before reaching for a gate.** For this situation the answer
    is yes twice and no once — see [Type over gate](#type-over-gate--the-answer).
11. **And then stop.** A correct announcement is one line.

---

## 5. Anti-patterns

- **`{cond && <div aria-live="polite">{msg}</div>}`** — the defining defect of this
  territory: **26 sites here, 20 of 28 in one sibling, 6 of 7 in the other.** The region
  and its text enter the accessibility tree in the same commit, so there is no change to
  observe. It reads correctly, renders correctly, and is silent. MDN is explicit:
  *"Start with an empty live region, then – in a separate step – change the content
  inside the region."*
- **A component that `return null`s above its own live region.** The same defect through
  control flow instead of JSX, and a regex cannot see it — which is exactly why §9 gates
  only half of this class and §7 names the rest. `EstimatedProgressBar.tsx:87`,
  `CharBudget.tsx:47`, `BulkRerunStrip.tsx:16`, `LabProgress.tsx:32`,
  `NarrationThread.tsx:72`, `DataHealthBar.tsx:21` are the live instances.
- **`role="alert"` together with `aria-live="polite"`.** The role's implicit assertiveness
  is overridden by the explicit attribute, so you get a polite region wearing an alert's
  name. `PersonaEditorHeader.tsx:128`. `personas-web` shipped the same contradiction at
  `SignInPrompt.tsx:60-61` — two repos, one confusion.
- **`aria-live` on anything that ticks.** A `requestAnimationFrame` progress bar, a
  per-keystroke character counter, a 2-second poll. `personas-web` wrapped a
  *per-character typing animation* in `role="log" aria-live="polite"` on its homepage; the
  same repo elsewhere set `aria-live="off"` on an elapsed counter **and wrote down why**.
  Both instincts, one codebase. Here it is `CharBudget` and `EstimatedProgressBar`.
- **`aria-atomic="true"` on a frequently-changing region** — the multiplier. Atomic means
  the *whole* region is re-read on every change, so a progress panel that updates its
  percentage re-speaks its label, its counts and its percentage together, every tick.
  `DesignReviewRunner.tsx:131`.
- **A container that is a live region wrapping items that also announce.** Two utterances
  per event, and once the container starts transforming the text (translating it,
  classifying it) the two utterances say different things. `ToastContainer.tsx:280-284`
  plus `toastStore.ts:138`.
- **`aria-relevant="additions removals"`** — opts *out* of the default and into announcing
  disappearances. An auto-dismissing notification then speaks itself on the way in and on
  the way out. One instance repo-wide, and it is on the toast stack.
- **A screen-corner surface for backend-fired events with no ARIA at all.** The purest
  form of "something changed without the user acting", and the one most likely to be
  built as pure presentation. `AlertToastContainer.tsx` — 0 roles, 0 `aria-*`, 0 live
  regions, and it is the surface the alerting engine fires into.
- **`<LoadingSpinner />` with no `label`.** It renders `null`. Not a small spinner —
  nothing. No pixels, no announcement, no `role`. 231 sites.
- **`aria-label` on a live region.** The name replaces the content for the listener, so
  the message you put inside is masked by the label you put outside.
  `SystemLoadFooterIcon.tsx:118-128` is the terminal case: the label is the only mutable
  thing and the children are `aria-hidden`, so the region can never announce anything.
- **A single-word English `aria-label`.** `aria-label="Close"` — 21 instances of that
  exact string. It is invisible to the repo's i18n lint rule *by construction* (§7.E), it
  is the most common accessible name in the app, and a Japanese user hears it in English.
- **Announcing from a `.ts` hook with a bare string.** `announce('Indexing source…')`.
  Every gate in this repo that looks at user-facing copy is a JSX visitor. A `.ts` module
  is a blind spot with no floor.

---

## 6. Evidence

**The one site to copy — a stream that knows when to be quiet:**
`src/features/plugins/companion/chat/AthenaChatLiveRegion.tsx`. Twenty lines, and every
judgement in this path is in them: a persistent `sr-only` region (`:29`), `aria-atomic`
so a partial re-render does not speak a fragment, `if (streaming) return ''` (`:21`) so
the token stream never reaches it, and a header comment that states both the problem
(*"the chat bubbles are not inside a live region, so a screen reader would never hear an
assistant reply land"*) and why it is a separate component.

- **`src/features/shared/components/feedback/AriaLiveProvider.tsx:34-38`** — the queue,
  with the React-batching failure it prevents written into the comment. This is the
  primitive's best decision and neither sibling repo has anything like it.
- **`…/AriaLiveProvider.tsx:28-30`, `:48`** — the `key` bump, so a repeated identical
  message is still a change and is still spoken. The non-obvious half of a live region.
- **`…/AriaLiveProvider.tsx:76-79`** — the unregister guard, with the failure mode named:
  *"blindly nulling would silence the live one."*
- **`src/features/shared/chrome/sidebar/Sidebar.tsx:177-183`** — permanent container,
  conditional text, `tx()` with plural variants, `aria-atomic`. The in-place reference.
- **`src/features/teams/sub_mastermind/lib/CanvasShell.tsx:910-914`** — a spoken keyboard
  cursor, with the clearest one-line rationale in the repo.
- **`src/features/shared/components/feedback/Banner.tsx:110`** and
  **`InlineErrorBanner.tsx:63`** — `role` and `aria-live` derived from one severity prop,
  so they cannot disagree. This is the shape §4 step 4 asks for, already shipped.
- **`src/stores/toastStore.ts:138`** — politeness derived from tone rather than passed.
- **`src/features/agents/quick-answer/triage/__tests__/deckDialog.test.tsx:214-235`** —
  **the only announcement contract test in the repo, and it is excellent.** It asserts
  `deck.querySelectorAll('[aria-live], [role="status"], [role="alert"]')` has length
  **zero** — the feature owns no region and defers entirely to the provider. Read three
  things in it: the header at `:14-16`, which records the live over-announcement it was
  written for (*"Both drag stamps carried a permanent `role="status" aria-live="polite"`
  … so a screen reader announced 'Reject… Approve' on every deal and buried the card's
  own title"*); `:221-223`, which records that the *earlier* version of this assertion
  queried `[aria-live]` alone and *"reported 'one' while three more were speaking"*; and
  `:232-233`, which states P2 in one sentence: **"a region that already holds its text is
  not a change, and most screen readers stay silent for it."** The doctrine is already
  written in this repo. It is written in exactly one place, and 26 regions violate it.
- **`src/features/agents/quick-answer/__tests__/quickAnswerHonesty.test.tsx:73,82,105`** —
  the second announcement test: asserts the *text* of `role="status"` and `role="alert"`,
  and that a failed dispatch does not announce that the run started.

---

## 7. Deviations found

Everything below shipped under a green `npm run check`, a green CI and a green suite.
The lint baseline is **1,135 warnings / 0 errors** ([`shared-facts.json`](../shared-facts.json));
**none of them is about an announcement, because no rule in the repo is.** There is no
`eslint-plugin-jsx-a11y` in `eslint.config.js`; of the 21 custom rules exactly one touches
ARIA (`role-button-requires-keydown`), and [`focus-management.md`](./focus-management.md)
Gap 7 has already established that it checks the wrong half of its own condition.

### The population, parsed

Every JSX opening tag in `src/**/*.tsx` (2,104 files, tests excluded) was read with a
brace/quote-aware scanner and classified.

| | count | files |
| --- | ---: | ---: |
| `aria-live` | 49 | 47 |
| `role="status"` with no `aria-live` | 17 | — |
| `role="alert"` with no `aria-live` | 15 | — |
| `role="log"` with no `aria-live` | 1 | — |
| **Live regions, total** | **82** | **78** |
| `aria-atomic` | 10 | 9 |
| **`aria-relevant`** | **1** | 1 |
| `aria-busy` | 9 | 7 |
| `aria-label` | 906 | 519 |
| `aria-labelledby` | 10 | 9 |
| `aria-describedby` | 10 | 8 |

Two of those numbers are the story before any analysis. **`aria-describedby` = 10** across
a 2,104-file app — 8 form inputs, 1 `ThemedSelect`, and `Tooltip`'s broken wrapper — which
is `tooltip.md`'s finding confirmed from the other direction: the description channel is
essentially unused. And **`aria-relevant` = 1**, on the toast stack, opting into announcing
dismissals.

### A. The defining defect — **26 live regions born holding their own message**

Measured twice, by two independent passes over the same parse: (i) the JSX site's
preceding token (`&&`, `?`, `:`), and (ii) a top-level `return null` guard above the
region inside its own component.

| mount mode | count | verdict |
| --- | ---: | --- |
| **persistent** — region always rendered, text swaps inside | **42** | correct |
| conditional at the JSX site — `{cond && <region>}` / `{cond ? <region> : …}` | 28 | — |
| conditional by early return — `if (…) return null` above the region | 12 | — |
| **conditional total** | **40** | — |
| …of which `role="alert"` (the P4 exemption — announced on insertion) | 14 | **correct** |
| …of which polite / `role="status"` | **26** | **defect** |

Plus **`LoadingSpinner.tsx:15`**, whose `return null` sits *after* its region so the
automated guard pass does not see it — the region exists only when a `label` does. That
makes **27**, and it is the one that cascades (§7.D).

The 26, in full:

| | site |
| --- | --- |
| **JSX-conditional (17)** | `CloudConnectionForm.tsx:123` · `ConnectorTableScopeRow.tsx:109` · `WalkthroughOfferWidget.tsx:88` · `GuidedTour.tsx:477` · `ExecutionMetricsDashboard.tsx:73` · `GlobalExecutionList.tsx:399` · `Composer.tsx:359`\* · `OrbQuickInputBar.tsx:95` · `GitLabConnectionForm.tsx:117` · `GitLabDeployModal.tsx:219` · `RemoteJobDetail.tsx:45` · `FleetActivityStrip.tsx:191` · `DataGrid.tsx:344` · `Listbox.tsx:185`\* · `DesignReviewRunner.tsx:131` · `N8nImportTab.tsx:121` · `N8nSessionList.tsx:268` |
| **early-return (9)** | `EstimatedProgressBar.tsx:96` · `CharBudget.tsx:56` · `BulkRerunStrip.tsx:24` · `LabProgress.tsx:38` · `NarrationThread.tsx:77` · `DataHealthBar.tsx:23` · `RemoteJobNoticeChip.tsx:81` · `AthenaOrbLayer.tsx:173` · `TourPanelBody.tsx:90` |

\* **Two are false positives and were cleared by hand, not assumed.**
`Composer.tsx:359` (`{dictation.supported && …}`) and `Listbox.tsx:185`
(`searchable ? … : null`) gate on a **static capability**, not on the message — the region
really is mounted for the surface's lifetime and its text swaps between a value and `''`.
Both are correct implementations. True positives: **24 of 26.**

**The sharpest instances, because their authors were being careful:**

- **`GitLabConnectionForm.tsx:116-120`, `GitLabDeployModal.tsx:218-222`,
  `CloudConnectionForm.tsx:122-127`.** All three noticed that `<LoadingSpinner/>` says
  nothing and *compensated* by adding a sibling `<span className="sr-only">{t.…}</span>`
  — translated, correct copy — then wrapped the pair in a `{isConnecting ? …}` region.
  Three independent authors reached the right instinct and lost it to the mount mode.
- **`DataGrid.tsx:339-345`** and **`UnifiedTable.tsx:283-284`** are the same code in two
  shared primitives, one conditional and one not. `DataGrid`'s ghost branch is
  `{isLoading && data.length === 0 ? (<div role="status" aria-live="polite">…` — the
  region is the ghost. `UnifiedTable`'s `TableGhostRows` renders the region
  unconditionally *within itself*, which is better, but the component is still mounted
  conditionally by its caller. Two primitives, one loading doctrine, two different
  answers to the same question, and neither announces.
- **`GlobalExecutionList.tsx:398-401`** — `{globalExecutionsWarning && <div role="status"
  aria-live="polite">{globalExecutionsWarning}</div>}`. A warning that arrives from a
  background fetch: the exact case P1 exists for, in the exact shape P2 forbids.

### B. Every toast is announced twice — confirmed, and generalised

`toasts.md` §7.D owns the instance and its one-line fix. Verified here at the working
tree and recorded because it is P5's live proof and because **the generalisation is this
path's**: `toastStore.ts:138` announces imperatively; `ToastContainer.tsx:280-284` is
*itself* `role="status" aria-live="polite"`. Both fire per toast.

Two details this path adds:

1. **`aria-relevant="additions removals"` is the only one in the repo.** MDN's default is
   `additions text`; this container has explicitly opted into speaking removals, so an
   auto-dismissing error toast can produce a third utterance five seconds after the first
   two. Nothing else in 2,104 files sets this attribute.
2. **The double is structurally *invisible* to the repo's only announcement test.**
   `deckDialog.test.tsx:225` asserts a *feature* owns no region; nothing asserts that a
   feature announcing through the provider is not *also* inside one. That is the shape
   `toasts.md` Gap 6 should take.

Convergence note worth carrying: `personas-web` has this defect three separate times but
**not** in its toast stack — its toast containers are plain `AnimatePresence` wrappers and
each toast carries its own role, so the container/announcer double is absent there. Ours
is the version with a shared store, which is precisely why it happened: the store
announces and the container renders, and neither author could see the other.

### C. Three announcement surfaces, one announcer, and the loudest event is on the mute one

There is exactly **one** `AriaLiveProvider` mount (`App.tsx:322`) — no duplicated host.
But there are three surfaces on which a change announces itself, and they are configured
in three different directions:

| | announces | politeness | translated |
| --- | --- | --- | --- |
| `AriaLiveProvider` | via `useAnnounce` / `announceImperative` | polite + assertive, both | caller's responsibility (§7.G) |
| `ToastContainer.tsx:280` | itself, **plus** the store's imperative call | polite, `additions removals` | yes (`resolveErrorTranslated`) |
| **`AlertToastContainer.tsx`** | **nothing** | — | **no** — `alert.rule_name` / `alert.message` arrive from the backend |

**`AlertToastContainer.tsx` contains zero `aria-` attributes and zero `role` attributes in
the entire file.** It is the surface the alerting engine fires into — the single purest
instance in this app of *"something changed without the user acting"* — and it is
inaudible. Its dismiss button (`:53`) also has no accessible name. `toasts.md` §7.C
already prescribes merging it into the unified store; **that merge is also the fix for
this**, and it is worth saying that the accessibility argument for the merge is stronger
than the z-index one.

The same shape converges. `personas-web`'s `ConnectionStatusIndicator.tsx:33-38` reports
realtime connection state through a coloured dot, a `title` and an `aria-label`, changes
on its own, and has no live region; and its Realtime new-review event produces
**spoken TTS if the user opted in, and nothing else**. `brainiac/console` has six surfaces
that change with no user action — four polls, a carousel, and a Suspense boundary — and
**not one of them announces anything**. Three codebases; the unsolicited change is the
event nobody wires up.

### D. `LoadingSpinner` — **252 call sites, 21 labels, 0 announcements**

The component renders `null` unless given a `label`, in which case it renders
`<span role="status" className="sr-only">{label}</span>` and nothing else
(`LoadingSpinner.tsx:12-21`).

| | count | share |
| --- | ---: | ---: |
| production call sites | **252** in 182 files | |
| passing `label` | **21** | **8.3%** |
| **passing nothing — renders `null`** | **231** | **91.7%** |
| of the 21 labels, hardcoded English | **6** | 28.6% |

The 6: `PersonaCoreModal.tsx:35` and `:37` (`"Loading mentalities…"`),
`RecipeAlternativeModal.tsx:130`, `GitHubRepoSelector.tsx:130`,
`CloudSyncPanel.tsx:170` (`"Checking Drive connection..."`),
`DataDiffSection.tsx:122`.

**And the 21 that do pass a label announce nothing either**, because every one of them is
mounted conditionally — the region is born holding its text. Verified by reading the call
sites: `SkillsManagerPage.tsx:56-57` (`{loading && … ? <LoadingSpinner label=…/>`),
`FleetActivityPage.tsx:88-89`, `SuspenseFallback.tsx:14` (a Suspense fallback, which by
definition mounts on suspend). **Net: 252 of 252 busy states are silent** — 231 because
there is no label and 21 because of the mount mode.

**The most instructive site in the whole document is `QuickAnswerBody.tsx:58-68`:**

```tsx
{/* The spinner IS the announcement (it renders an `sr-only`
    `role="status"` and nothing else), so the visible copy is hidden
    from assistive tech rather than read out twice. */}
<LoadingSpinner label={t.monitor.quick_loading} />
<span className="typo-body text-foreground" aria-hidden>{t.monitor.quick_loading}</span>
```

The author reasoned correctly about P5 — *don't say it twice* — and deliberately
`aria-hidden` the visible text so the sr-only region would be the single utterance. The
region is inside an `if (total === 0 && loading) return (…)` branch, so it never fires.
**The surface is silent, and it is silent because someone thought carefully about
accessibility.** That is the cost of P2 being invisible.

Convergence is exact: `personas-web` has **1 of 4** spinner/skeleton components carrying
`role="status"` + text, and its `BulkProgressBar` — a live `{done}/{total}` counter in the
same toast stack as two live regions — has none. `brainiac/console` routes all 15 loading
surfaces through one `SkeletonFrame` that *does* carry `aria-live` + `aria-busy` +
`sr-only` text (the best coverage of the three), and still announces nothing, because the
frame mounts as a Suspense fallback and **unmounts** on resolve, so *loading finished* is
never spoken anywhere in that product either.

### E. Announced text is the least-translated copy in the app — **116 hardcoded English accessible names, 94 of them structurally invisible**

`aria-label` is the app's largest announcement channel: **906 attributes in 519 files**.
66 are string literals; 840 are expressions.

| | count |
| --- | ---: |
| `aria-label` string literals (all English) | **66** |
| `aria-label` expressions containing a hardcoded English string or template literal | **50** (in 43 files) |
| **Total hardcoded-English accessible names** | **116** |
| Reported by `custom/no-hardcoded-jsx-text` | **22** |
| **Structurally invisible to it** | **94 (81%)** |

**Two independent blindnesses, both confirmed by running ESLint rather than reading it:**

1. **`isNonTranslatable()` treats every single word as a technical token.**
   `no-hardcoded-jsx-text.cjs:83` — `if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) &&
   trimmed.length <= 20) return true;`. That heuristic is defensible for a JSX *text
   node*, where a bare word often is an identifier. It is exactly backwards for
   `aria-label`, where **a single word is the normal and correct form of an accessible
   name.** It silences **44 of the 66 literals**, and **21 of those 44 are the literal
   word `"Close"`** — the most common accessible name in the application. Also silenced:
   `"Remove"`, `"Dismiss"` ×3, `"Accept"` ×2, `"Reject"` ×2, `"Save"`, `"Edit"`,
   `"Delete"`, `"Refresh"`, `"Collapse"`, `"Primary"`, `"Category"`, `"Tier"`,
   `"Direction"`, `"Cadence"`, `"Connector"`, `"Actions"`.
2. **The `JSXAttribute` visitor only inspects `Literal` values** (`:126`), so all 50
   expression-valued English labels are unreachable — `CharBudget.tsx:56`
   (`` `${value} of ${max} characters used` ``), `EstimatedProgressBar.tsx:96`
   (`` `Progress: ${…}%` `` / `'Complete'`), `WarningBadge.tsx:38`
   (`` `${items.length} off-track signals need attention` ``),
   `NegotiatorStepCard.tsx:31`, `StudioChatInput.tsx:158/175/198/236`,
   `FleetSessionCard.tsx:205/222`, and 40 more. This is the identical structural gap
   `tooltip.md` measured for `title` (1,080 of 1,113 values are expressions).

**Verified empirically, not inferred.** `npx eslint src/features/teams/sub_factory/AddKpiModal.tsx
src/features/studio/StudioPlanDrawer.tsx` reports **19 problems, 0 errors** — and **zero**
of them concern `AddKpiModal`'s four hardcoded `aria-label`s (`"Close"`, `"Category"`,
`"Tier"`, `"Direction"`), while **both** of `StudioPlanDrawer`'s multi-word ones
(`"Build plan"`, `"Close plan"`) are reported. The blindness is the single-word rule,
demonstrated by the gate itself.

**And the imperative channel is worse, because it has no gate at all.** Of the 16
`announce()` calls in the repo, **7 (43.8%) pass a hardcoded English string**:

| file | strings |
| --- | --- |
| `plugins/artist/hooks/useCreativeSession.ts:68,76,188` | `'A generation is already running'` · `'Generating image…'` · `'Image generated'` |
| `plugins/research-lab/shared/useIngestSource.ts:24` | `'Indexing source…'` |
| `plugins/twin/sub_training/useTrainingSession.ts:140,151,159` | `'Generating interview questions…'` · `` `${qaPairs.length} interview questions ready` `` (hand-rolled English pluralization) · `'Question generation failed — using fallback questions'` |

All three are **`.ts` files**. `custom/no-hardcoded-jsx-text` has only `JSXText` and
`JSXAttribute` visitors, so it cannot see a `.ts` module at any severity —
`frozen-ui-copy-constant`'s own description records that this is the structural blind spot
covering the repo's 2,725 `.ts` files. Add `toastStore.ts:168`'s
`` announceImperative(`${personaName}: ${title}`, urgency) ``, which composes a string
with a hardcoded `": "` outside the translation layer.

**So the only text this product ever speaks-but-never-shows is 44% untranslated and 100%
ungated.** The 9 correct sites are worth naming as the contrast: `TriageDeckVariant.tsx:113`
(`tx()` with interpolation), `DriveOcrDrawer.tsx:86,108`, `SyncPanel.tsx:100,130`.

Both siblings converge on the defect and on the *unenforcement*: `personas-web` is ~44%
raw English across 141 `aria-label`s while its own `design.md:456` forbids exactly that,
and it has a scanner that reads `aria-label` (`scripts/report-hardcoded-ui-strings.mjs:11`)
wired into neither CI nor its git hooks — a report nobody is forced to read.
`brainiac/console` is 49 of 49, having no i18n layer at all.

### F. Over-announcement — five live streams, and the worst is `aria-atomic`

| site | what changes | cadence | why it is a stream |
| --- | --- | --- | --- |
| **`CharBudget.tsx:56-64`** | `<Numeric value={value}/>` inside an `aria-live="polite"` span | **every keystroke** | And the region is only *visually* hidden below threshold (`opacity-0`, `:61`), which does not remove it from the accessibility tree — so it announces from character 1, not from 70%. Reaches every `FormField` with a `maxLength` (8 call sites) plus `DesignInput.tsx:234`. |
| **`EstimatedProgressBar.tsx:96`** | `role="status" aria-live="polite"`; children include `{elapsedInt}` seconds | **every second**, for 30 s+ | Driven by `requestAnimationFrame` (`:58`). 3 adopters. Its `aria-label` is also hardcoded English. |
| **`DesignReviewRunner.tsx:131`** | `aria-live="polite" aria-atomic="true"` around `{current}/{total} — {pct}%` | every progress tick | **`aria-atomic` is the multiplier**: the entire panel is re-spoken on every percentage change, not just the number. |
| `BulkRerunStrip.tsx:24-28` | `role="status" aria-live="polite"` around a `finished/total` + `pct` counter | per item completed | Also conditionally mounted (§7.A), so the first utterance is lost and every subsequent one lands. |
| `DesignReviewTerminal.tsx:57-63` | `role="log" aria-live="polite"` on a build terminal | per output line | `role="log"` is designed for this, so this one is defensible — but a design-review run streams hundreds of lines and there is no completion summary. |

**One case is the reverse and is worth stating because it looks like the same defect:**
`SystemLoadFooterIcon.tsx:118-129` is `role="status"` on a **2-second poll**
(`POLL_MS = 2000`, `:19`) — and it almost certainly announces **nothing**, because its
only mutable content is an `aria-label` while its children are `aria-hidden` (`:126`), and
`aria-relevant` defaults to `additions text`. An attribute change is neither. So the live
region is decorative, and the readout it wraps reaches assistive technology only through
browse mode or a mouse-only `title`. Cleared as over-announcement; recorded as P9 (§7.F,
next paragraph) and as an example of why "it has `role="status"`" is not evidence that
anything is spoken.

### G. Names that mask messages — **10 of 82 live regions carry an `aria-label`**

`TraceInspector.tsx:167` · `ExecutionMetricsDashboard.tsx:73` · `NarrationThread.tsx:77` ·
`RemoteJobNoticeChip.tsx:81` · `ByomProviderList.tsx:418` · `SystemLoadFooterIcon.tsx:118` ·
`CharBudget.tsx:56` · `EstimatedProgressBar.tsx:96` · `DesignReviewTerminal.tsx:57` ·
`OAuthProgressRing.tsx:58`.

For a container the user navigates to (`role="log"` on a terminal), a name is right —
`DesignReviewTerminal.tsx:62` and `NarrationThread.tsx:80` are correct and translated. For
a region whose *content is the message*, the name competes with it.
`ExecutionMetricsDashboard.tsx:73-77` is the clean illustration: a refresh indicator whose
`aria-label` is `t.common.refresh` — the listener hears the noun "Refresh", not the fact
that a refresh is happening. `OAuthProgressRing.tsx:58` falls back to a hardcoded
`'OAuth authorization in progress'`.

`brainiac/console`'s `AddressBar.tsx:71-83` is the same defect at its most legible: a
static `aria-label="Copy a link to this exact view"` on the very button whose children
(`{copied ? "copied" : failed ? "copy failed" : "copy link"}`) are the *only* success or
failure feedback in the interaction. The name wins; the outcome is never spoken.

### H. Politeness — one downgraded alert, and 15 alerts nobody chose

| | count |
| --- | ---: |
| assertive (5 explicit `aria-live="assertive"` + 15 implicit via `role="alert"`) | **20** |
| polite (42 explicit + 18 implicit via `role="status"`/`"log"`) | **60** |
| computed from a prop (`Banner`, `InlineErrorBanner`) | 2 |
| **`role="alert"` explicitly downgraded with `aria-live="polite"`** | **1** |

The downgrade is `PersonaEditorHeader.tsx:128`. `personas-web` shipped the identical
contradiction at `SignInPrompt.tsx:60-61` — independently, in a different stack.

The 15 implicit assertives are the more interesting number: `role="alert"` carries
`aria-live="assertive"` whether or not the author knew, so **15 interruptions in this app
were configured by choosing a role name, not by deciding to interrupt.** Most are genuine
(form validation, vault errors, the root error boundary at `main.tsx:194`), which is why
this is a note rather than a deviation — but `WalkthroughOfferWidget.tsx:108` interrupts
for a *walkthrough offer*, and `ChatDecisionCard.tsx:81` / `OrbDecisionBubble.tsx:255`
interrupt for a companion prompt.

### I. What exists and is unused

- **`aria-atomic`: 10** across 82 live regions. Where a region holds a composed sentence
  (`Sidebar.tsx:178`'s four count clauses), atomic is what makes it read as one statement
  instead of a fragment. Nine regions with multi-node content do not set it.
- **`aria-busy`: 9**, and **not one is on a live region**. Seven are on buttons
  (`Button.tsx:219`, `AsyncButton.tsx:96/110`, `ConfirmDialog.tsx:79`, …), which is
  correct and is [`inline-busy-state.md`](./inline-busy-state.md)'s. Zero are on a
  fetching surface. `personas-web` has 7 and `brainiac/console` reaches all 15 of its
  loading surfaces from a single `aria-busy`; ours is the only one of the three where the
  attribute never touches a data region.
- **`sr-only`: 52 usages in 45 files** — used correctly, and mostly for exactly the right
  things: 14 are live-region content, the rest are accessible names for icon-only or
  glyph-only controls (`StatusDot.tsx:159`, `AccessibleToggle.tsx:58`,
  `DeckQueueRail.tsx:109`). Only 2 carry hardcoded English (`ErrorRecoveryBanner.tsx:107`
  `"Dismiss"`, `ConnectorCard.tsx:169` `"Connected"`). **This is the healthiest mechanism
  in the territory** and is worth saying, because both siblings use it far more thinly
  (8 and 3 usages, neither ever abstracted).

### J. What tests it

**Two files, both in one feature.** `deckDialog.test.tsx:214-235` (the contract test
quoted in §6) and `quickAnswerHonesty.test.tsx:73,82,105`. Nothing covers
`AriaLiveProvider`, `ToastContainer`, `LoadingSpinner`, `CharBudget`,
`EstimatedProgressBar`, or any of the 82 regions outside the triage deck. Every deviation
above shipped under a green suite because the suite has no opinion.

The comparison is instructive rather than damning: `personas-web` has **zero** announcement
assertions across 88 `getByRole` calls and 8 unit files. `brainiac/console` built a real
source-parsing a11y contract test with a reasoned allowlist — and pointed all six of its
assertions at focus. **Three codebases; one announcement test; it is ours.** It is also
the one that already contains this path's central principle in prose.

---

## 8. Gaps in the primitives

> **Second pass — what is upstream of §7.A.** The 26 born-with-their-message regions are
> not 26 mistakes. They are one missing shape. Every one of them is a place where someone
> needed to say something and reached for markup instead of for `useAnnounce()` — and the
> reason they reached for markup is that `useAnnounce()` is a bare hook with no visible
> surface, no import path anybody stumbles over, and no entry in `CATALOG.md`. It has
> **6 adopters against 82 hand-rolled regions**. The `useRovingTabIndex` finding in
> [`focus-management.md`](./focus-management.md) Gap 4 is the same lesson from the
> neighbouring leaf: *a free-floating hook competes with "just write the markup" and
> loses.* The difference is that `useRovingTabIndex` could not deliver its pattern;
> `useAnnounce` delivers it completely and still lost, which makes this a **discovery**
> problem rather than a design one — and discovery problems are fixed with a component,
> not a better hook.

1. **`LoadingSpinner` renders `null` and should be deleted, not fixed.** 231 of 252 call
   sites pass no `label`, so they import a component to render nothing. The 21 that do
   pass one are all conditionally mounted, so they announce nothing either. Making `label`
   required would be a 231-site migration whose correct answer at almost every site is
   *"use the surface's ghost"* ([`overview-loading.md`](../../design/overview-loading.md))
   or *"use `AsyncButton`"* ([`inline-busy-state.md`](./inline-busy-state.md)) — both of
   which are already this repo's doctrine. **Delete the component; migrate the 21 labelled
   sites to a persistent region or `useAnnounce()`; delete the other 231 outright.**
   `CLAUDE.md` already flags the component and already flags `CATALOG.md`'s description of
   it as wrong on both halves; this measurement is the third reason.
2. **There is no `<LiveRegion>` component, and that is why there are 82 hand-rolls.**
   A `<LiveRegion message={…} politeness="polite" />` that renders its container
   unconditionally and only varies its text would make §7.A's defect **unrepresentable**
   — the same move `tooltip.md` prescribes for `Tooltip` (clone the child instead of
   wrapping it, so there is no wrong element to attach to). It is ~15 lines, it belongs in
   `shared/components/feedback/` next to the provider, and it needs a `@catalog` tag so it
   is discoverable, which the hook never was.
3. **`AriaLiveProvider` cannot be told to coalesce.** The 150 ms queue (`:58`) spaces
   messages but never drops or replaces one, so a component that announces on a state
   change it does not control will drain a backlog long after the state settled. §7.F's
   streams would each need a caller-side throttle. A `announce(msg, { politeness, replaces:
   'key' })` overload — where a later message with the same key supersedes a queued one —
   is the missing half, and it is the thing that would let `EstimatedProgressBar` and
   `BulkRerunStrip` announce *correctly* rather than not at all.
4. **Nothing marks a region as a stream.** `aria-live="off"` exists and is used **zero**
   times in this repo; `personas-web` reached for it independently
   (`TerminalSim.tsx:23`, on an elapsed counter). There is no shared way to say "this
   number ticks, do not watch it", so every author who thinks about it invents
   `aria-hidden` on a child, and every author who does not think about it ships §7.F.
5. **`ToastContainer` is a live region and does not need to be.** One attribute triple at
   `:280-284`. `toasts.md` §9 sequencing step 4 owns the edit; this path adds that
   `aria-relevant="additions removals"` should go with it and that no other file in the
   repo sets that attribute.
6. **`AlertToastContainer` has no accessibility surface at all** — 0 roles, 0 `aria-*`,
   an unnamed dismiss button, and untranslated backend content. Merging it into the toast
   store (`toasts.md` §9 step 5) fixes all four at once.
7. **`custom/no-hardcoded-jsx-text` is wrong about `aria-label` in two independent ways**
   (§7.E), and both are small. (a) Exempt `I18N_ATTRS` from the single-word branch of
   `isNonTranslatable` — a one-line guard that converts 44 invisible sites into reported
   ones, including 21 instances of `"Close"`. (b) Extend the `JSXAttribute` visitor to
   `TemplateLiteral` and to the two branches of a `ConditionalExpression` — 50 more sites.
   **This is the highest-leverage change in the document for P7**, and per §9 it is a
   *fix*, not a gate.
8. **No gate, no rule, no test reaches the imperative channel.** `announce()` in a `.ts`
   hook is invisible to every visitor the repo owns. 7 of 16 calls are English.
9. **Nothing tests any of this outside one feature.** §7.J. The three highest-value cases:
   a live region rendered conditionally produces no announcement (a jsdom mutation
   assertion); one `addToast` produces exactly one utterance; `LoadingSpinner` without a
   label renders nothing at all — which, if asserted, would document the shim's behaviour
   for the next person who reaches for it.

**Not a gap:** the provider's queue-and-key design (`:34-58`), the unregister guard
(`:76-79`), and `Banner`/`InlineErrorBanner`'s derived `role`+`aria-live` pair. All three
are deliberate, all three are documented with their failure modes, and **none of the three
exists in either sibling repo.**

---

## Type over gate — the answer

**Yes for two of the four defect classes, and for one of them the type move erases the
class rather than counting it.**

**1. The conditional region: yes, and the fix is a component, not a prop.** No signature
on a `<div>` can require "this node was already mounted." But a component whose *body*
renders the container unconditionally and takes the message as a prop makes the wrong
call unrepresentable:

```tsx
<LiveRegion politeness="polite" message={busy ? t.x.loading : ''} />   // cannot be born with its text
```

There is no `{cond && …}` to write, because the condition has moved inside the prop. This
is the same shape `tooltip.md` prescribes for its own primitive (stop wrapping, start
cloning — *"a shape in which the mistake is unrepresentable beats a rule that counts it"*)
and the same shape `focus-management.md` found already shipped in `UnifiedTable`
(`navigable = !!onRowClick`). **17 of the 26 sites are one mechanical edit each; the other
9 disappear entirely, because a component that early-returns `null` can simply render
`<LiveRegion message="">` instead.**

**2. Politeness: the type is already right, and it is worth saying so.** `Politeness` is a
closed union `'polite' | 'assertive'` (`AriaLiveProvider.tsx:7`) with the **quiet** value
as the default (`:62`). Compare `focus-management.md`'s finding that `Listbox`'s optional
`itemCount`/`onSelectFocused` silently ship 3 of 13 call sites with no keyboard at all: an
optional argument is dangerous when its absence means *nothing happens*, and safe when its
absence means *the conservative thing happens*. Here it is the second. The stronger form is
already shipped one layer up: `toastStore.ts:138` **derives** politeness from the toast's
tone, so no caller ever decides to interrupt. That is `navigable = !!onRowClick` for
urgency, and it is the shape any new announcing API should copy.

**3. Translation: no type reaches this, and the honest answer is to fix the linter.**
`announce(message: string)` cannot express "this string came from the catalog", because
`t.section.key` *is* a `string` — the type system in this repo has no branded translated
type and introducing one would be a 17,000-key change to serve one call site count of 16.
The structural equivalent is not a type but **a gate that can see the channel**, and §7.E
measured precisely why the existing one cannot: a single-word heuristic that is right for
JSX text and backwards for accessible names, and a visitor that only reads literals.
Gap 7 is ~4 lines and converts 94 invisible sites into reported ones. **Prefer fixing the
detector over counting the callers** — the same lesson `focus-management.md` drew from its
`*:focus-visible` backstop, obtained here in the linter rather than the cascade.

**4. Where a type would be actively wrong, and the oracle is why.** I intended to propose
that `role` and `aria-live` should never both be author-supplied — that the repo should
expose only `<LiveRegion politeness>` and forbid the raw attributes, so the
`role="alert"` + `aria-live="polite"` contradiction (§7.H) becomes unrepresentable.
**The oracle refuses the strong form.** `brainiac/console` has zero `assertive` and zero
`role="alert"` across seven regions — success and failure share one polite region at all
four of its action sites and urgency is carried entirely in colour. A repo that never
makes the urgency decision at all is worse off than one that occasionally makes it wrong,
so a primitive that *hides* the axis is the wrong lesson to draw from one contradiction in
2,104 files. The clause survives as `Banner`/`InlineErrorBanner`'s shape — derive **both**
attributes from one severity input, keep the axis visible, make disagreement impossible —
and not as a ban.

So the general rule for this situation: **the condition that decides whether to speak must
live inside the message, never around the region.** Everything else in this document is
either a translation problem the linter should catch or a judgement a signature cannot
make, which is why §9 gates one class of seventeen and refuses five larger ones.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a **proxy** for a semantic condition, tuned to this repo's idiom — and for
this leaf the warning must be loud, because **the convergence check found no announcement
gate anywhere.** `personas-web` ships 5 bespoke ESLint AST rules and points none at ARIA,
has zero announcement assertions across 88 `getByRole` calls, and no `jsx-a11y`.
`brainiac/console` built a genuine 172-line source-parsing a11y contract test with a
reasoned allowlist — **and aimed every one of its six assertions at focus**; its only
`jsx-a11y` rules arrive transitively at `warn` and none concerns live regions. **Nobody has
independently invented gating announcements.** The rule below is local calibration; the
*condition* it proxies is the part that travels.

### The semantic condition, stated stack-free

> **C1 — the live region and the text it exists to announce enter the accessibility tree
> in the same commit.** Assistive technology announces *changes* to a region it is already
> observing. A region that appears already holding its message presents no change, so the
> announcement the author wrote is never spoken — and the DOM, the code review and every
> automated check see something indistinguishable from a working one.
>
> *Grounded in the specification, not in taste.* MDN's live-region guide: *"works as long
> as you add the attribute before the changes occur … Start with an empty live region,
> then – in a separate step – change the content inside the region."* And the documented
> exception, which is why the proxy excludes it: for `role="alert"`, *"the content …
> is announced, even when the region … is injected dynamically into the page."*
>
> *Proxy here:* a polite live region (`aria-live=`, or `role="status"`, whose implicit
> politeness is polite) whose opening tag is reached **directly** from a conditional
> operator.
> *Precondition:* the repo spells conditional rendering as JSX `&&` / ternary inside
> braces. A repo that renders through a template directive, a `v-if`, or a signal must
> re-derive the proxy — this is how `tables.md`'s `role="columnheader"` signal scored zero
> on a sibling.

### Conditions deliberately NOT given a rule — refusals, with measurement

- **C2 — the same defect through control flow** (9 sites: `EstimatedProgressBar.tsx:96`,
  `CharBudget.tsx:56`, `BulkRerunStrip.tsx:24`, `LabProgress.tsx:38`,
  `NarrationThread.tsx:77`, `DataHealthBar.tsx:23`, `RemoteJobNoticeChip.tsx:81`,
  `AthenaOrbLayer.tsx:173`, `TourPanelBody.tsx:90`, plus `LoadingSpinner.tsx:15`).
  **Not gateable, and the shortfall is structural, not lazy.** The census matches whole
  *file content*; the deviation is a `return null` guard several statements above the
  region, inside the same function. Expressing "this component may not have reached this
  JSX" requires control-flow analysis, which is an AST job. Recorded here so §9's recall
  number is honest (17 of 26, **65%**) rather than quietly presented as complete.
- **C3 — hardcoded English in an accessible name** (116 sites, §7.E). **Do not add a rule.
  Fix Gap 7 instead**, and report it to its owner. The condition — *user-facing copy that
  cannot reach the translation layer* — is
  [`i18n-string-authoring.md`](./i18n-string-authoring.md)'s, and it already owns two
  census signals for it. **Checked before proposing anything:** `frozen-ui-copy-constant`
  is `.ts`-only and keys on `label:`/`description:` object properties, and
  `discarded-toast-copy` is anchored to `addToast`/`toastCatch`; **neither covers a `.tsx`
  `aria-label`, so this channel is genuinely ungated.** A second counter for the same
  condition would double-count it, and — decisively — a **4-line change to
  `no-hardcoded-jsx-text.cjs` converts 94 invisible sites into reported ones at authoring
  time**, which no ratchet can do. *Reported for that path's author, as `tooltip.md`
  reported its `toLocaleString()` recall gap to `timestamp-display.md`: the single-word
  branch of `isNonTranslatable` (`:83`) must not apply to `I18N_ATTRS` (`:65-68`), and the
  `JSXAttribute` visitor (`:126`) must read template literals. The 44/50 split is in §7.E.*
- **C4 — `<LoadingSpinner>` with no `label`** (231 of 252). Tempting: precise, large,
  zero-judgement, and **not covered by `hand-rolled-spinner`**, whose signal is
  `animate-spin` (a class this component does not render, because it renders nothing).
  **Refused anyway, and this is the clearest refusal in the document: a ratchet on a
  missing prop of a component that renders `null` would outlive the component.** Gap 1's
  answer is deletion, and 231 of the 231 correct fixes are "use the ghost" or "use
  `AsyncButton`", both of which are other paths' doctrine. A gate here would ratchet a
  population whose right size is zero-by-removal.
- **C5 — over-announcement** (§7.F, 5 sites). **Not regex-reachable at any precision.**
  The condition is a relationship between a region and the *update cadence of the value
  inside it* — `requestAnimationFrame`, a `setInterval`, a controlled input's `onChange` —
  which lives in a different part of the file, or a different file. A class-based or
  attribute-based proxy was considered and rejected before writing: `aria-live` near
  `useState` matches most of the healthy population too. This class needs a reviewer, and
  §4 step 5 is where it belongs.
- **C6 — the double announcement** (§7.B). Owned by [`toasts.md`](./toasts.md) §9 C6,
  which already refused it for the right reason: *"it is a property of two files agreeing,
  not of any line."* **Not adding a second refusal to a condition that already has one.**
- **C7 — "a feature must own zero live regions."** This is the assertion
  `deckDialog.test.tsx:225` already makes for one feature, and it is the natural
  generalisation. **The census engine cannot express it.** `assertRule` treats
  `result.matches === 0` as a *structural failure* — `"A census rule that finds nothing is
  a broken regex far more often than a finished migration … a rule pinned at 0 is a gate
  that can never fail"` (`engine.mjs:264-273`). That is correct engine design and it means
  a must-never-happen condition is outside the instrument by construction. **A
  must-be-zero condition needs a test, not a census rule** — and the repo already contains
  the template for exactly this one, four lines long, in the file §6 quotes.

### The rule — validated

Verified at the working tree with
`node scripts/census/run-census.mjs --rules <scratch> --check` → **exit 0**, against a
scratch rules file, never against `scripts/census/rules.json`.

```json
{
  "rules": [
    {
      "id": "live-region-born-with-its-message",
      "goldenPath": "docs/concepts/golden-paths/screen-reader-announcements.md",
      "title": "Live region mounted in the same render as the text it exists to announce",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "(?:&&|\\?)(?:\\s|\\(|/\\*(?:(?!\\*/)[\\s\\S])*?\\*/|//[^\\n]*)*<[A-Za-z][A-Za-z0-9.]*(?![A-Za-z0-9_-])(?:(?!<|role=\"alert\")[\\s\\S]){0,900}?\\s(?:aria-live=|role=\"status\")",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a polite live region (aria-live=, or role=\"status\", whose implicit politeness is polite) whose opening tag is reached DIRECTLY from a conditional operator - `{cond && <div aria-live=...>}` or `{cond ? (<span role=\"status\">…)}` - with only whitespace, parentheses and comments in between. PROXY FOR the stack-free condition: the live-region node and the text it exists to announce enter the accessibility tree in the SAME commit, so there is no change for the assistive technology to observe and the announcement the author wrote never fires. Grounded in the specification, not in taste: MDN's live-region guide states the attribute 'works as long as you add the attribute before the changes occur ... Start with an empty live region, then - in a separate step - change the content inside the region.' role=\"alert\" is DELIBERATELY EXCLUDED from the pattern (the negated run cannot cross role=\"alert\") because it is the documented exception - alert content 'is announced, even when the region ... is injected dynamically into the page' - so gating it would flag a correct construct; the 14 conditionally-mounted role=\"alert\" regions in this repo are therefore not counted. PRECONDITION (measured, must be re-derived per repo): this repo spells conditional rendering as JSX && / ternary inside braces. RECALL IS PARTIAL AND THE SHORTFALL IS STRUCTURAL: the identical defect also appears as a component that early-returns null above its region (9 further sites here - EstimatedProgressBar.tsx:96, CharBudget.tsx:56, BulkRerunStrip.tsx:24, LabProgress.tsx:38, NarrationThread.tsx:77, DataHealthBar.tsx:23, RemoteJobNoticeChip.tsx:81, AthenaOrbLayer.tsx:173, TourPanelBody.tsx:90, plus LoadingSpinner.tsx:15 whose return null sits AFTER the region). A whole-file regex cannot see a control-flow guard, so the gate ratchets the lexically-visible half and section 7 names the rest. Measured against a brace/quote-aware JSX opening-tag parser over all 2,104 .tsx files: recall 17/17 = 100% of the JSX-conditional sub-population, 17/26 = 65% of the full condition; precision 15/17 - the two false positives are Composer.tsx:359 and Listbox.tsx:185, where the outer condition is a STATIC CAPABILITY flag (dictation.supported, searchable) rather than the message's own presence, so the region really is mounted for the surface's lifetime and its text swaps inside it. Both were hand-verified rather than assumed. CONVERGENCE: this defect is reinvented in both sibling repos at a HIGHER rate than here - personas-web 20 of 28 regions, brainiac/console 6 of 7 - which makes it a hazard in the problem rather than carelessness in one team. LEGAL FIX: render the region unconditionally and put the condition on its TEXT (`<span className=\"sr-only\" aria-live=\"polite\">{busy ? label : ''}</span>`), or delete the local region and call useAnnounce()/announceImperative() from the app-wide AriaLiveProvider, which is persistent by construction."
      },
      "baseline": { "files": 17, "matches": 17 },
      "floor": 2000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   live-region-born-with-its-message     17     17       17     17    2104   2000
  census OK — 1 rule(s), 2104 file-visits, 17 surviving violation(s) across 17 file(s).
```

Runtime **0.74 s**. The pattern uses **no lookbehind**: it chains forward anchors
(`&&`/`?` → a bounded run of whitespace, parens and comments → `<tag` → a bounded run that
cannot cross `<` or `role="alert"` → the attribute). An earlier draft that stopped at
whitespace-and-parens alone scored 14/17 — the three misses
(`WalkthroughOfferWidget.tsx:88`, `DataGrid.tsx:344`, `FleetActivityStrip.tsx:191`) each
have a JSX comment sitting between the conditional and the tag, which is exactly the kind
of silent recall loss the contract asks composers to find by measuring rather than
assuming. The pattern lives in a **file**, never in bash argv.

### Precision and recall, measured against a second implementation

Per the contract's *"verify your §9 counts through a second implementation before
baselining them"*, the signal was diffed location-by-location against the brace/quote-aware
JSX parser used for §7, and every disagreement was opened and read.

| | |
| --- | ---: |
| parser ground truth — polite live regions, JSX-conditional | 17 |
| regex matches | 17 |
| **recall against the JSX-conditional sub-population** | **17/17 = 100%** |
| parser ground truth — the full condition (incl. early-return) | 26 |
| **recall against the full condition** | **17/26 = 65%** |
| **precision** | **15/17 = 88%** |

The two false positives were **hand-verified, not estimated**: `Composer.tsx:358-361`
(`{dictation.supported && <span className="sr-only" aria-live="assertive">{dictation.listening
? hint : ''}</span>}`) and `Listbox.tsx:184-188` (`searchable ? <div aria-live="polite"
role="status" className="sr-only">{query ? … : ''}</div> : null`) both gate on a static
capability and both already swap `''` inside a region that lives as long as the surface.
They are correct implementations that happen to be lexically indistinguishable from the
defect, and no forward-anchored pattern can separate "this boolean describes a capability"
from "this boolean describes a message."

### Positive control — the inverted, compliant form

A violation count proves nothing unless the matcher can be shown to *discriminate*. The
control is deliberately the **lexical inverse**: the same tag vocabulary, the same two
attribute anchors, the same comment handling, the same negated run — only the preceding
token changes, from a conditional operator to a sibling element's `>`.

```json
{
  "id": "live-region-persistent-positive-control",
  "roots": ["src"], "extensions": [".tsx"],
  "signal": {
    "pattern": ">(?:\\s|\\{[^{}]*\\}|/\\*(?:(?!\\*/)[\\s\\S])*?\\*/|//[^\\n]*)*<[A-Za-z][A-Za-z0-9.]*(?![A-Za-z0-9_-])(?:(?!<|role=\"alert\")[\\s\\S]){0,900}?\\s(?:aria-live=|role=\"status\")",
    "flags": "g", "ignoreCommentLines": true
  },
  "baseline": { "files": 18, "matches": 18 }, "floor": 2000
}
```

```
  OK   live-region-persistent-positive-control     18     18       18     18    2104   2000
```

| | files | matches |
| --- | ---: | ---: |
| violating (`live-region-born-with-its-message`) | **17** | 17 |
| compliant (persistent, sibling-anchored) | **18** | 18 |
| **files carrying BOTH** | **0** | — |

**The two populations are 100% disjoint by file.** Had the violation signal been matching
live regions in general rather than *conditionally-mounted* ones, the control would have
been a superset of it rather than a partition of it. The control also **fails loudly on a
wrong baseline** exactly like the shipped rule: baselined at the violating rule's numbers
it reports `files rose 17 -> 18 (+1)` and `matches rose 17 -> 18 (+1)`.

The control's 18 include the provider itself (`AriaLiveProvider.tsx:93`), the two
reference sites (`Sidebar.tsx:175`, `CanvasShell.tsx:908`) and
`AthenaChatStreamingTurn.tsx:93` — which is the right company for a compliant population
to keep. It also picks up five early-return components whose region is persistent *within*
the component but conditional *at* it (`LabProgress`, `ExecutionStep`, `TourPanelBody`,
`IncidentsInbox`, `AthenaVerdictCard`), which is precisely the C2 blind spot stated in the
open: the control is a **lexical** inverse, not a semantic one, and saying so is part of
the measurement.

**The positive control is deliberately NOT proposed for `rules.json`.** A census baseline
is monotone-downward by design, so a rule counting the compliant form would fail the build
every time someone did the right thing. It is a validation instrument and it belongs in
this document.

### How it fails loudly if its own precondition is absent

Each failure mode was **induced against the real working tree and the exit code
captured**, not assumed.

| induced fault | exit | reported |
| --- | :---: | --- |
| *(control — no fault)* | **0** | `census OK — 1 rule(s), 2104 file-visits, 17 surviving violation(s) across 17 file(s).` |
| pattern → a token present nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` raised to 9,000 | **1** | `[structural] walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots` → `["srcc"]` | **1** | `[structural] walked 0 files but floor is 2000 …` |
| `extensions` → `[".svelte"]` | **1** | `[structural] walked 0 files but floor is 2000 …` |
| baseline `files` 17 → 16 (a rise) | **1** | `[drift] files rose 16 -> 17 (+1). New violations of docs/concepts/golden-paths/screen-reader-announcements.md` |
| baseline `matches` 17 → 40 (a silent drop) | **1** | `[drift] matches dropped 40 -> 17 (-23) without the baseline moving. A silent drop is a broken matcher more often than fixed code` |
| a stale `exclude` path | **1** | `[structural] exclude "src/does/not/Exist.tsx" matched no file. The exemption is stale` |
| an `exclude` with no `reason` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" (library home) or "principle" (consuming repo)` |
| **a real violation written into a real source file** | **1** | `[drift] files rose 17 -> 18 (+1)` and `matches rose 17 -> 18 (+1)` |

The last row is the one that matters. An actual `x && <div aria-live="polite">…</div>`
appended to `src/features/shared/components/progress/AnalysisModeView.tsx` moved both
counts by exactly 1 and failed the gate; reverting returned the tree to exit 0 with
`git status --porcelain` clean for that path.

`floor` is 2,000 against an observed walk of **2,104 `.tsx` files**
([`shared-facts.json`](../shared-facts.json) `frontend.tsxFiles`), consistent with
`unfocusable-click-target` and `native-title-tooltip`, which use the same root and
extension.

**On severity.** This is a census rule, not an ESLint rule, so the warn/error question
does not arise: `npm run census:check` fails the build on drift regardless. That is
deliberate and is the whole reason to put it here. As [`CLAUDE.md`](../../../.claude/CLAUDE.md)
records, `npm run check` runs `eslint src/` with no `--max-warnings` and the pre-commit
hook passes `--quiet`, so **a warn-level rule enforces nothing at either gate at any
count.** The argument is structural, not volumetric — and it is worth stating plainly here
because the one existing gate adjacent to this territory,
`custom/no-hardcoded-jsx-text`, is warn-level, which is why 22 reported hardcoded
`aria-label`s have sat in the tree alongside the 94 it cannot see.

### Sequencing

1. **Gap 2 first — ship `<LiveRegion>`, with a `@catalog` tag.** It is ~15 lines and it is
   the only change here that makes a defect class *unrepresentable* rather than counted.
   Everything else in this list gets easier once it exists.
2. **Gap 7 — the four-line fix to `no-hardcoded-jsx-text.cjs`.** Independent of everything
   else, converts 94 invisible sites into authoring-time squiggles, and hands
   [`i18n-string-authoring.md`](./i18n-string-authoring.md) a channel it did not know it
   was missing. Expect its `custom/no-hardcoded-jsx-text` warning count to rise by ~94.
3. **The census rule**, which then ratchets the 17 lexically-visible sites shut while the
   backlog is worked. Start with the three that already wrote correct `sr-only` copy and
   lost it to the mount mode (`GitLabConnectionForm`, `GitLabDeployModal`,
   `CloudConnectionForm`) — they are one-line moves and they prove the pattern.
4. **The 9 early-return sites (C2)**, by hand, in the same pass — they are invisible to
   the gate and will otherwise rot.
5. **Gap 1 — delete `LoadingSpinner`.** 21 labelled sites migrate to a persistent region;
   231 delete. Coordinate with [`inline-busy-state.md`](./inline-busy-state.md) and
   [`overview-loading.md`](../../design/overview-loading.md), which already own both
   replacements, and fix `CATALOG.md`'s wrong description in the same change.
6. **Gaps 5 and 6 together** — drop the live-region attributes from `ToastContainer` and
   merge `AlertToastContainer` into the store. Both are [`toasts.md`](./toasts.md)'s
   edits; this path's contribution is that they are also the fix for a silent alert
   surface and the only `aria-relevant` in the repo.
7. **Gap 3's `replaces` key**, then §7.F's five streams — announce their start and finish
   and mark the tick `aria-live="off"`.
8. **Gap 9's tests last**, once the primitives they would assert against are correct.
   `deckDialog.test.tsx:214-235` is the template, and C7 is the assertion that must be a
   test because the census engine cannot express "zero".
