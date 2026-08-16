# Golden path — Keyboard shortcut registration

> Situation node: `ui-system/chrome-and-feedback/keyboard-shortcut-registration` · [situation spine](../situation-spine.md)
> recurrence **30** · risk **MEDIUM** · sides **client** · convergence **diverged**
> dimensions: **function · ui · code-quality**
> merged from *Keyboard shortcut registration*, *Keyboard shortcut ownership*.
> Leaf definition: *"where a binding registers and who wins when a modal or input has focus."*
> Composed 2026-08-16 against `master` @ `e3c5e0d7f`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**4,418** production, 411 test). Every
> app-global keyboard registration was extracted **twice** — once by a pass that resolves each
> registration's *handler identifier* back to its declaration and reads the body, once by a pass
> that slices a fixed window around the registration call — and the two disagreed (§12.1). Read in
> full: `lib/keyboard/{AppKeyboardProvider,KeyboardNavMode,NavHistoryShortcuts,ShortcutCheatSheet,WorkspaceShortcuts,shortcutRegistry}.tsx|ts`,
> `lib/ui/BaseModal.tsx`, `shared/chrome/{CommandPalette,TitleBarDock}.tsx`,
> `agents/quick-answer/triage/deck/useDeckControls.tsx`,
> `agents/quick-answer/triage/__tests__/deckKeyboardOwnership.test.tsx`,
> `agents/sub_executions/libs/useRunnerExecution.ts`,
> `overview/sub_manual-review/components/{ReviewFocusFlow.tsx,backlog/BacklogFocusDeck.tsx,backlog/BacklogDetailModal.tsx}`,
> `plugins/fleet/useFleetHotkeys.ts`, `plugins/drive/DrivePage.tsx`,
> `plugins/artist/sub_gallery/{Gallery2D,Gallery3D}.tsx`,
> `shared/components/forms/Listbox.tsx`, `plugins/companion/orb/AthenaOrbLayer.tsx`,
> `templates/.../SearchAutocomplete.tsx`, `lib/dev/DevInspector.tsx`.
>
> **Measured by executing, not by reading.**
> 1. **Six experiments in jsdom** (`node_modules/jsdom`, the same DOM Vitest uses), with the
>    `AppKeyboardProvider` registry and eight real handlers **transcribed statement for statement**
>    from source. That replay is what produced §0's headline, §7 D1, D2, D3 and D7 — none of which
>    reading had. One of the six was **wrong the first time and is reported as wrong** (§12.3).
> 2. The §9 rule was built, run in a **composer-private scratch registry with a filename unique to
>    this composer**, hand-verified **13/13** and **5/5**, positive-controlled so the control
>    **partitions the population exactly** (13 + 5 = 18, no residue), fault-injected **six** ways —
>    all six fire — then re-extracted from this document and re-run. **The full registry was NOT
>    run**, per the doctrine.
> 3. **No database was copied.** Nothing in this leaf lives in SQLite; the scratchpad is therefore
>    clean by construction rather than by cleanup.
> 4. **The live app was not touched.** No key was pressed, no harness command was dispatched.
> 5. **`cargo` was not run.** This leaf is client-only; there is no Rust half.
>
> ### Sibling boundaries, settled in prose
>
> [**focus-management**](./focus-management.md) owns *whether the thing a key would act on can be
> reached at all*, and already ships **`unregistered-key-handler`** (72/72) — the gate on a
> keystroke listener attached straight to `window`/`document`. **That rule ratchets the dominant
> cause of everything in §7, and this path does not re-propose it.** §9 here is a reasoned decline
> on that condition plus one disjoint rule (file overlap measured at **0 of 12**) on what
> `unregistered-key-handler` structurally cannot see: a handler that *did* join the ladder, at a
> rank nothing can name.
>
> [**anchored-popover**](./anchored-popover.md) owns the dismissal contract of a transient surface
> and ships `hand-rolled-outside-click`, whose own description already declares the split:
> *"Disjoint from `unregistered-key-handler` …, which owns the `key*` half of the same effects."*
> **52 of this leaf's 90 registrations are an Escape-to-close on such a surface** — that population
> belongs to that path; this one owns what happens to *every other* key.
>
> [**informed-consent-gate**](./informed-consent-gate.md) owns what the operator was told before a
> billable or irreversible action ran. **This path owns the fact that the action can be reached by
> one keystroke** (§0, D7) and hands the disclosure question there.
>
> [**agent-dispatch**](./agent-dispatch.md) owns what happens to a spawned agent after the click.
> D7 supplies it a *keyboard* door into `executePersona` it did not count.
>
> The **Deviations** section is a note backlog, **not applied** — the operator uses this app daily
> and every entry below changes what a keystroke does.

---

## 0. The headline, before anything else

**This app built a keyboard ownership ladder — a priority-sorted registry with an `exclusive` mode
and a written rationale for every rank — and then registered 72 of its 90 keyboard bindings outside
it. The ladder is not merely bypassed: it is structurally unable to win. A `document` listener beats
every rank in it, including the highest one the app uses, because `document` precedes `window` in
the DOM's bubble path.**

```
src/lib/keyboard/AppKeyboardProvider.tsx:31-42   the priority ladder, as a doc-comment table
                                        :83      ONE window listener fans out to the registry
                                        :77-79   `exclusive` — "an EXCLUSIVE surface owns the
                                                  keyboard for everything beneath it"
```

| | n |
|---|---:|
| app-global keyboard registrations (two implementations reconciled) | **90** |
| ↳ through the ladder — `useAppKeyboard(...)` | **16** |
| ↳ raw `window.addEventListener('keydown', …)` | 48 |
| ↳ raw `document.addEventListener('keydown', …)` | **24** |
| ↳ the primitive's own two listeners (`AppKeyboardProvider.tsx:83`, `:135`) | 2 |
| event types across all 74 raw registrations | **`keydown` 74 · `keyup` 0 · `keypress` 0** |
| registrations that consult `event.target` before acting | **27 of 90 (30%)** |
| independent definitions of the typing guard `isTypingTarget` | **4** (1 exported, 3 private copies) |
| importers of the one exported guard | **3** |
| `useAppKeyboard` ranks written as a bare number | **13** |
| `useAppKeyboard` ranks written as a named constant | **5** |
| chords the `?` cheat sheet documents | **26** |
| calls to `stopImmediatePropagation` in 4,829 files | **1** |
| element-scoped JSX `onKeyDown`/`onKeyUp`/`onKeyPress` props (out of scope — not global) | 180 across 148 files |

### The three mechanisms cannot see each other, and it was executed

Transcribed handlers, dispatched in jsdom:

```
press `?` on the Fleet Sessions tab
  1. useFleetHotkeys   OPENED FleetHotkeysHelp        [document, no rank at all]
  2. (a registry handler at priority 1000 saw it second)
  3. ShortcutCheatSheet OPENED the GLOBAL cheat sheet [window, registry p=20]
  -> HELP SURFACES OPENED: 2

press Ctrl+K
  1. CommandPalette       togglePalette('all')        [registry p=90, RETURNED TRUE]
  2. RecipeManager        focus recipe search         [raw window]
  3. useCredentialManagerState focus credential search[raw window]
  -> ACTIONS FIRED FOR ONE PRESS: 3.  `return true` stopped 0 of the 2.

press ArrowLeft with the EXCLUSIVE triage deck open
  1. TriageDeck            rejected the top card      [exclusive p=70]
  2. DriveImageLightbox-shape goPrev()                [RAW document, behind the overlay]
  3. Gallery3D-shape        goPrev()                  [RAW window,  behind the overlay]
  -> ONE KEY DECIDED 3 THINGS. `exclusive` suppressed the registry-registered route;
     it suppressed 0 of 2 raw listeners.

press ArrowLeft INSIDE a <textarea>, same layout
  -> guarded handlers correctly stood down; 2 unguarded raw listeners still fired.
```

`AppKeyboardProvider`'s `exclusive` comment (`:69-76`) states the harm precisely — *"one press could
decide two rows (a triage verdict in front and a backlog verdict behind an opaque overlay)"* — and
the repo shipped a test for it (`deckKeyboardOwnership.test.tsx`, 137 lines, `DANGEROUS_KEYS`
fixture). **The mechanism is correct and the test is real. Both are scoped to the 16 handlers on the
ladder, which is 18% of the population.**

### And the shape all of §7 reduces to

**The three things a shortcut needs — a rank, a scope, and a name — are supplied by three different
mechanisms in this app, and no site gets all three.**

| | rank (who wins) | scope (does it fire while typing) | name (is it discoverable) |
|---|---|---|---|
| where it lives | `useAppKeyboard({priority})` | a guard the caller writes by hand | `shortcutRegistry.ts` |
| coverage | 16 of 90 | 27 of 90 | 26 chords |
| what the primitive gives you by default | `priority = 0` | **nothing — you get a raw `KeyboardEvent`** | nothing |
| consequence | 13 of 18 ranks are magic numbers; a tie resolves by **mount order** | the guard is reimplemented 4× and none of the 4 covers `<select>` | the nav-mode key set is stated in **4 places and 3 are wrong** |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
each clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and the whole subject.** *A keyboard binding is not a callback; it is a claim on a
> shared, single-slot resource.* Two components can both own a scroll position or a colour. Only one
> can own a chord. So a binding is finished not when it fires but when it has answered *who else
> wants this key, and why do I beat them* — and that answer must be a property of the registration,
> not of the reader's memory.
>
> **P2 — physics, and the clause with the most external warrant.** *A shortcut that acts on a key a
> person can type must ask what the keystroke was aimed at before it acts.* Bare letters, digits,
> punctuation and arrows all belong to whatever has focus first, and to the shortcut second. This
> is the one clause every sibling reinvented, and it is also the one every sibling implemented at a
> **different coverage** — which is the argument for exactly one guard, not for four correct ones.
>
> **P3 — physics.** *Write the guard once and hand it to the caller; do not describe it.* A rule
> that each registration must re-implement will be re-implemented at four different coverages, and
> the divergences cluster on the element nobody remembers — a `<select>`, a `contenteditable`, a
> terminal's hidden helper textarea. The correct place for the guard is inside the thing that
> delivers the event, where there is no argument to forget.
>
> **P4 — physics.** *A rank in an ordering scheme must be a name, not a number.* A number tells you
> what it is; only a name tells you what it is *for*. `priority: 29` cannot be reasoned about,
> searched for, or safely moved; `ABOVE_THE_CHEAT_SHEET` can. And two handlers that both wrote the
> same number have collided without either author being able to see it.
>
> **P5 — physics.** *If two claims can tie, the tie-break is part of the design and must be stated.*
> A sort that falls through to insertion order has made mount order load-bearing — and mount order
> is a property of the component tree, not of the keyboard, so it inverts under a refactor nobody
> connects to the keyboard.
>
> **P6 — physics, and the one that decides severity.** *A ranking scheme only ranks what registers
> with it.* A registry, a ladder and an exclusive mode are all agreements among participants. Any
> binding installed by the platform's own escape hatch is not a lower-ranked participant — it is
> outside the ranking entirely, and it will usually run **first**, because the escape hatch attaches
> closer to the event's origin than the registry does.
>
> **P7 — ergonomics, and the trap.** *A hand-maintained list of shortcuts drifts from the handlers
> it describes, and the drift is invisible because both halves keep working.* A cheat sheet is a
> second source of truth. Either derive it from the registrations themselves, or accept that it is
> documentation and check it like documentation. A list that promises it "can never drift" and is
> not derived is worse than no list, because it is believed.
>
> **P8 — function, ui.** *An overlay that hides a surface must silence it, not out-rank it.*
> Out-ranking only decides who sees a key first; it cannot stop a key the top surface ignores from
> reaching something the user cannot see. Anything the user cannot see must not be able to act.
>
> **P9 — security, cost.** *A single unmodified keystroke must not be the whole authorisation for
> something that spends money or cannot be undone.* Not because the key is likely to be pressed by
> accident, but because the keyboard has no hover, no tooltip and no second surface to disclose
> what is about to happen — a chord is the one affordance that can carry no explanation at all.
>
> **P10 — ergonomics.** *Scope by containment, not by tag.* "Is the target an input?" is a proxy for
> the real question, "does this surface own this keystroke?" — and it is a proxy that fails in both
> directions. The direct form is to ask whether the event's target is inside the element the
> shortcut belongs to, which needs no vocabulary of element types and cannot omit one.
>
> **Scale condition.** P2 and P9 are correctness on the first shortcut. P1, P4 and P6 begin to pay
> at the **second** surface that wants the same key, which is much sooner than anyone expects —
> arrows and Escape are claimed by nearly everything. P5 and P7 arrive silently and are discovered
> by a bug report nobody can reproduce. P8 is discovered the first time two decision surfaces are
> layered. P3 and P10 are discovered by an auditor.

### Warrant evidence — five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud`
(TS orchestrator/worker), `vibeman` (Next.js + Tauri), `ascent` (Next.js). All five present and
opened. **`personas-cloud` is NOT-APPLICABLE**, established by three independent zeros: 0 `.tsx`
files outside `node_modules`, 0 `key*` listeners, and no `react` dependency in the root or any of
its three workspace packages. So the denominator for every clause is **4**.

- **P1 and P4 are a genuine SILENCE — 0 of 4, and this is the most important result here.** Four UI
  repos, **63 hand-rolled `keydown` registrations, zero central dispatchers, zero priority
  schemes.** Nobody reinvented `AppKeyboardProvider`. The closest is `vibeman`'s
  `useNavigationShortcuts` (`src/hooks/useUnifiedNavigation.ts:176-214`), which globally owns
  Ctrl+1–6 — one app-level hook, but a fixed hardcoded map, not a registry other code can join.
  **Personas is alone and ahead. P1 and P4 are marked house conventions: strongly reasoned,
  externally untested.** An adopting repo should not assume a ladder is the answer — see P10's
  warrant below, which is a different and arguably better answer to the same problem.
- **P7 is CONVERGENT AS A FAILURE, twice, and that is stronger evidence than agreement.** Two of the
  four built a cheat sheet and **both are broken, in the two different ways available**:
  - `personas-web` built the registry and **never mounted it**, then wrote the warning down:
    *"**ShortcutsHud not mounted:** `ShortcutsFooter`/`ShortcutsOverlay` aren't rendered by the
    reviews page today… If you wire the HUD in, keep `REVIEW_SHORTCUTS` in sync with the real
    handlers"* (`docs/features/dashboard/reviews.md:90`). Its `shortcutTypes.ts:14` documents `?` =
    "Show all shortcuts" and **no `?` handler exists anywhere in that repo**.
  - `vibeman`'s overlay (`src/app/features/tinder/components/KeyboardShortcutOverlay.tsx:20-25`)
    advertises `A` Accept, `Z` Reject, `D` Delete, `V` variants. Grepping all of `vibeman/src` for a
    bare `e.key === 'a'|'z'|'d'` returns **zero**; the real bindings are ArrowLeft/ArrowRight only
    (`lib/useTinderItems.ts:234-235`). **Three of four advertised chords do not exist.**

  So the drift this path reports in §7 D4 is not local carelessness — **it is what happens to every
  hand-maintained shortcut list in every repo that builds one.** That is why P7 says *derive it or
  check it*, and why §9 does **not** propose gating the list (the census cannot assert an absence).
- **P2 is PHYSICS — 3 of 3 applicable repos — and the coverage is the finding, not the idea.**
  Every repo with a bare-key handler independently wrote a typing guard, and **no two wrote the same
  one.** `brainiac`'s is the only complete one (`ReviewWorklist.tsx:314-316`,
  `t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)`) and carries the comment
  *"// Never steal a keystroke from something being typed into."* `personas-web`'s three sites check
  `INPUT`/`TEXTAREA`/`SELECT` but **not** `isContentEditable`; `vibeman`'s four tinder sites use
  `e.target instanceof HTMLInputElement || HTMLSelectElement`, missing `<textarea>` **and**
  contentEditable. `ascent` needs none. **The idea converged at 3 of 3; the coverage converged at
  0 of 3** — which is P3 stated as an experiment someone else already ran.
- **P9 is PHYSICS — 3 of 3 — and every repo mitigated it differently, badly.** `brainiac`'s bare
  `a`/`r` sign a permanent audit claim with no confirmation (`ReviewWorklist.tsx:327-336`), and it
  wrote down why it believes that is safe: *"Sign the ONE claim the pane is showing — no
  confirmation, because the operator is looking at exactly it."* `personas-web` hit the same hazard
  and reached for a lock instead (`useReviewKeyboardShortcuts.ts:21-24`): *"the single-item a/r
  resolve must be inert then, or it races the deferred bulk batch (double-commit / un-undoable audit
  decision)."* `ascent` is the clean control and binds **no** product shortcut at all. **Two repos,
  the same irreversible-single-key risk, two incompatible ad-hoc mitigations.**
- **P8 is MINORITY — 1 of 4, implemented as a boolean.** `vibeman` threads an `enabled` flag by hand:
  `useTinderItemsKeyboardShortcuts(handleAccept, handleReject, !processing && !showShortcuts)`
  (`TinderLayout.tsx:153`). It is `exclusive: true` hand-built for exactly one pair of components,
  and it cannot compose. Personas' registry version is better and is the only one that generalises.
- **P10 is the strongest external result and it INVERTS the shape of this leaf.** `brainiac`
  deliberately chose the opposite mechanism from all of Personas' machinery: a React `onKeyDown` on
  a `tabIndex={-1}` container (`console/…/ReviewWorklist.tsx:313`, `:358-361`) instead of a `window`
  listener. **Ownership is then solved by the DOM focus tree instead of by a priority number** — no
  global registration, no teardown race, no cross-route leakage, no ladder to maintain, and P8 comes
  free. It is a repo that never needed P1, P4, P5, P6 or P8 because it declined the premise. This
  repo has the same answer available and uses it at **1** global site
  (`SearchAutocomplete.tsx:92-93`, `if (!wrapper.contains(e.target)) return`) out of 90 — see §8.1.
- **P6 is SILENCE only because nobody else has a ranking to escape from.** Not evidence either way.
- **C7, the library question, is TOTAL SILENCE — 0 of 5.** No `react-hotkeys-hook`, `hotkeys-js`,
  `tinykeys`, `mousetrap`, `cmdk` or `kbar` anywhere; not even Radix, so every Escape-to-close in
  six repos is hand-rolled. **Nobody evaluated a library and rejected it — the option appears never
  to have been considered.** That is a reportable fact about all six repos, not a prescription.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "add a keyboard shortcut for this" · "make Escape close it" · "let them press Enter to run it"
- "arrow keys should move through the list" · "`/` should focus search, like GitHub"
- "why did one keypress do two things?" · "this shortcut fires while I'm typing in the search box"
- "the shortcut works on this page but not that one" · "which key opens the palette again?"
- **The "about to write X" test:** you are about to type
  `window.addEventListener('keydown'`, `document.addEventListener('keydown'`,
  `if (e.key === '…')` inside a `useEffect`, `useAppKeyboard(…, { priority: 42 })` with a number
  you picked by looking at the table, another `const isTypingTarget = …`, or a new row in the
  cheat sheet.

You are **not** in this situation when the key handler is an `onKeyDown` **prop on the element it
acts on** — that is element-scoped and belongs to [focus-management](./focus-management.md), which
also owns whether the element can be focused at all (`unfocusable-click-target`, 32/38). Nor when
the only key is Escape on a transient anchored surface — that is
[anchored-popover](./anchored-popover.md)'s dismissal contract, and **52 of this repo's 90
registrations are exactly that.** **The discriminator is that the binding is installed on a global
target and therefore competes with every other surface in the app for the same key.**

---

## 2. The one way

**Register through `useAppKeyboard`, at a rank that has a name, with a guard you did not write
yourself — and if the shortcut belongs to one visible surface, scope it by containment instead.**
Concretely: reach for `useAppKeyboard(handler, { priority, exclusive?, enabled? })` from
`@/lib/keyboard/AppKeyboardProvider` for anything app-global; never `window.addEventListener`, and
**never `document.addEventListener`, which is strictly worse** — `document` precedes `window` in the
bubble path, so a `document` listener beats every rank in the registry including the highest one the
app uses (executed: it beat `priority: 1000`). Give the rank a **named exported constant**, not a
number: `ROUTE_DECISION_PRIORITY` (`AppKeyboardProvider.tsx:98`) is the only one that exists today
and it is the right rank for anything belonging to the current route — if your surface needs a
different rank, export a new constant beside it rather than writing the number, because a number
cannot be searched for and two authors who pick the same one have collided invisibly (§7 D3, and
`15` is already claimed twice). Guard on the target by **importing** `isTypingTarget` from
`@/lib/keyboard/KeyboardNavMode` — do not write a fourth copy; and know that none of the four covers
`<select>`, so if your keys are arrows or Enter, copy `useFleetHotkeys.ts:48` instead
(`target?.closest('input, textarea, select, [contenteditable="true"]')`), whose containment form also
covers a focused terminal's hidden helper textarea. If your surface is a full-app decision layer
that hides what is beneath it, pass `exclusive: true` — and know its exact limit: it silences the
other registry handlers and **nothing else** (executed: 2 of 2 raw listeners still fired underneath).
If instead the shortcut belongs to one visible panel, prefer the containment form —
`if (!containerRef.current?.contains(e.target as Node)) return;` — which needs no rank, no guard
vocabulary, and no cheat-sheet entry, and which is how `brainiac` avoided this entire problem. Then
add the chord to `shortcutRegistry.ts` **and treat that as documentation, not synchronisation** — it
is a hand-maintained parallel list and it has already drifted (§7 D4). Then stop: do not call
`stopImmediatePropagation` to win a fight you should have declared (1 call in 4,829 files, and it is
not a shortcut); do not add a second `enabled` boolean threaded through props when `exclusive`
exists; and **do not bind a bare, unmodified key to anything billable or irreversible** — §7 D7 is
one `Enter`.

If you can only get one right: **the guard**. A shortcut that loses a race is annoying; a shortcut
that fires into the sentence someone is typing destroys their work, and it is the one clause all
three applicable siblings independently reinvented.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src/lib/keyboard/AppKeyboardProvider.tsx` — `useAppKeyboard(handler, options)`** | **The ladder.** One `window` keydown listener (`:83`) fans out to a registry sorted by `b.priority - a.priority \|\| b.id - a.id` (`:54-56`). A handler returning `true` breaks the loop. The rank table is a doc comment at `:31-42` and is the only statement of the scheme that exists. **16 call sites.** |
| **…`{ exclusive: true }`** | **The only correct answer to "an overlay must silence what it hides", and the best-reasoned comment in this leaf** (`:69-79`): *"Priority alone only decides who sees a key FIRST — it cannot stop a key the top surface ignores from reaching a route that is still mounted underneath, which is how one press could decide two rows."* Handlers **above** it still run, deliberately, so a modal on top keeps its Escape. **1 consumer** (`useDeckControls.tsx:607`). |
| **`AppKeyboardProvider.tsx:98` — `ROUTE_DECISION_PRIORITY` (= 10)** | **The only exported rank.** Its docstring says what it is *for*, which is the thing a number cannot say: *"Where a surface that belongs to the CURRENT ROUTE registers… Above the default so a route's own bindings beat incidental ones, and far below every overlay, because anything mounted over the route is what the user is actually looking at."* **4 call sites** — against **13** bare numbers, two of which are the literal `10`. |
| **`src/lib/keyboard/KeyboardNavMode.tsx:29` — `isTypingTarget(target)`** | The exported typing guard: `INPUT \|\| TEXTAREA \|\| isContentEditable`. **3 importers.** Note where it lives: inside a feature component, not beside the primitive that hands you the event — which is why three files wrote their own instead (§7 D5). It does **not** cover `<select>`. |
| **`src/features/plugins/fleet/useFleetHotkeys.ts:45-84`** | **The reference hand-rolled hook, and the one to copy if you cannot use the ladder.** Four things right in nine lines: an `enabled` parameter that goes inert when a modal is open; a modifier bail (`:46`); a **containment** guard covering `select` and `contenteditable` (`:48`) whose docstring notes it *"also covers xterm.js's hidden helper textarea, so keys typed INTO a focused terminal never trigger fleet navigation"*; and a `gridOpen` narrowing that changes the live key set with the surface. It is still a `document` listener, which is the one thing to fix. |
| **`src/features/shared/components/forms/Listbox.tsx:152` — the scoping *anti*-model, and `SearchAutocomplete.tsx:92-93` — the model** | Two shared list surfaces, same three keys (`ArrowUp`/`ArrowDown`/`Enter`), same `document` listener. `SearchAutocomplete` asks `if (!wrapper.contains(e.target as Node)) return;` — **containment**, the P10 form, the only instance of it in 90 registrations. `Listbox` asks nothing. Copy the first. |
| **`src/lib/ui/BaseModal.tsx:198-227`** | The modal's keyboard contract, and **it is narrower than people assume**: at `priority: 80` it claims **only** Escape (and only when `isTopmost`) and Tab **at the focus-trap boundary**; everything else returns `false`. **128 render sites.** A `BaseModal` being open does not make the route beneath it inert — see §7 D2 and §8.4. |
| **`src/lib/keyboard/shortcutRegistry.ts`** | The declarative chord list (**26 bindings**, 4 sections) that `ShortcutCheatSheet` renders on `?`. Read its promise (`:4-9`) against §7 D4 before trusting it. |
| **`src/features/agents/quick-answer/triage/__tests__/deckKeyboardOwnership.test.tsx`** | **The test to extend, and the best artefact in this leaf.** A `DANGEROUS_KEYS` fixture pressed against a layered deck + `SurfaceUnderneath` + `SurfaceAbove`, asserting nothing behind the overlay moves. It is the executable form of §2 — and it can only see handlers on the ladder. |

**Do not exist — this path names them:**

- **Any guard the primitive supplies.** `useAppKeyboard` hands you a raw `KeyboardEvent` and asks
  nothing, which is why the guard exists 4 times at 2 coverages and is absent from 63 registrations.
  See §4's type proposal.
- **Any named rank other than `ROUTE_DECISION_PRIORITY`.** The other eight ranks in the ladder table
  have no symbol; `DECK_KEYBOARD_PRIORITY = 70` is a **file-local** const in its own consumer
  (`useDeckControls.tsx:101`), not an export of the ladder.
- **Any tie-break.** Two handlers at the same rank fall through to `b.id - a.id` — **insertion order,
  descending**. `15` is claimed twice today.
- **Any derivation between `shortcutRegistry.ts` and the handlers.** It is a parallel hand-maintained
  list; §7 D4 is what that costs.
- **Any keyup or keypress binding anywhere.** All 74 raw registrations are `keydown`, so the
  provider's keydown-only fan-out is not currently a limitation (§8.3).

---

## 4. Steps

1. **Decide first whether this is global at all.** If the shortcut only makes sense while one panel
   is on screen, put an `onKeyDown` on that panel's container, or use the containment form. You then
   owe nothing to steps 2–6. `brainiac` built its whole review surface this way; this repo does it
   once in 90.
2. **Register through `useAppKeyboard`.** Never `window.addEventListener`, and treat
   `document.addEventListener` as a defect rather than a variant — it is not a lower rank, it is
   outside the ranking, and it runs first.
3. **Name the rank.** Import `ROUTE_DECISION_PRIORITY` if your surface belongs to the current route.
   If it does not, export a new constant from `AppKeyboardProvider.tsx` beside it, named for *what it
   beats and what beats it* — `ABOVE_CHEAT_SHEET`, `BELOW_MODAL` — and add its row to the ladder
   table in the same edit. **Do not write a number.** Search for the number you were about to write
   before you write it; `15`, `20`, `10` and `90` are each already taken.
4. **Import the guard; do not write one.** `isTypingTarget` from `@/lib/keyboard/KeyboardNavMode`. If
   your keys are arrows, Enter, Delete or bare letters, use the wider containment form from
   `useFleetHotkeys.ts:48` instead, because none of the four `isTypingTarget` copies covers
   `<select>`.
5. **Return `true` when you consumed the key, `false` when you did not** — and understand that
   `true` binds only the other registry handlers. It stops nothing raw (executed: 0 of 2).
6. **If your surface hides what is beneath it, pass `exclusive: true`, and then go and check what is
   underneath anyway.** Its guarantee ends at the registry boundary.
7. **Add the chord to `shortcutRegistry.ts`, and re-read the handler you just wrote against the row
   you just added.** They are not linked. The nav-mode key set is currently stated in four places
   and three are wrong.
8. **Do not bind a bare key to anything billable or irreversible.** If you must, put the
   confirmation behind it the way `DrivePage.tsx:283` does — `Delete`/`Backspace` opens a dialog, it
   does not delete.
9. **Ask the type question now, before §9** — see below.
10. **And then stop.** Whether the element can be focused at all is
    [focus-management](./focus-management.md); whether the popover closes on an outside press is
    [anchored-popover](./anchored-popover.md); what the confirmation says is
    [informed-consent-gate](./informed-consent-gate.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes for the guard, partly for the rank, and no for the registration itself. The boundary is the
finding.**

The dangerous freedom is not *registering* — it is **receiving a raw `KeyboardEvent` with no
obligation**. `useAppKeyboard(handler: (e: KeyboardEvent) => boolean | void)` hands every caller the
unfiltered event and asks nothing, so 63 registrations never ask what the key was aimed at and the 27
that do reinvent the question at two different coverages. Withhold the raw event:

```ts
// src/lib/keyboard/AppKeyboardProvider.tsx  (proposed)
declare const brand: unique symbol;
/** A keydown that is NOT aimed at an editable element. Constructible only by the provider. */
export type ShortcutEvent = KeyboardEvent & { readonly [brand]: 'ShortcutEvent' };

export interface AppKeyboardOptions {
  /** Named rank. The union IS the ladder — the doc-comment table becomes the type. */
  priority: KeyboardRank;
  exclusive?: boolean;
  enabled?: boolean;
  /** Opt OUT of the typing guard, with a reason. Escape-to-close is the legitimate case. */
  alsoWhileTyping?: 'escape-and-tab-only' | { reason: string };
}
export type KeyboardRank =
  | typeof DEV_OVERLAY | typeof COMMAND_PALETTE | typeof MODAL | typeof EXCLUSIVE_DECISION_SURFACE
  | typeof NAV_MODE | typeof NAV_MODE_HINT | typeof CHEAT_SHEET | typeof WORKSPACE
  | typeof ROUTE_DECISION_PRIORITY;

export function useAppKeyboard(
  handler: (event: ShortcutEvent) => boolean | void,
  options: AppKeyboardOptions,
): void;
```

Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** ✔ and here is the honest limit.
  `ShortcutEvent` encodes *"the target was not an editable element"* and **not** *"this surface owns
  this keystroke"*. `Listbox` and `SearchAutocomplete` bind the same three keys on the same target;
  no type distinguishes them, because the difference is DOM containment at runtime. That is exactly
  why P10 stays prose and why §2 offers containment as an alternative rather than a refinement.
- **Q2 — requiredness ≠ closedness.** ✔ and this is the load-bearing distinction for the rank.
  Making `priority` **required** changes nothing: **18 of 18 call sites already pass one.** The win
  is entirely in **closing** it to a union, which makes `priority: 29` — a number chosen to sit
  between two other numbers — unspellable. Requiredness and closedness are two different edits here
  and only the second one is the fix.
- **Q3 — a type nobody constructs constrains nothing.** ✔ `ShortcutEvent` has **90 construction
  sites on the day it lands** if the 72 raw registrations migrate, and 16 if they do not. Either
  number clears this qualification comfortably. Contrast `--max-budget-usd`, refused at one
  construction site in 963 files ([headless-model-call](./headless-model-call.md)).
- **Q4 — a type anyone can construct authenticates nothing.** ⚠️ **This is the qualification that
  bites.** `ShortcutEvent` is a branded `KeyboardEvent`, and `e as ShortcutEvent` at any call site
  reduces the whole thing to a comment. The brand is only worth having if the provider is the sole
  minter and the cast lives in one file; lint the cast or drop the brand and keep the filtering.
  The `KeyboardRank` union has no such weakness — a union of literal types cannot be widened by a
  caller without an explicit cast that reads as one.
- **Q5 — withholding beats requiring.** ✔ and the repo has already run the requiring experiment.
  `AppKeyboardProvider`'s doc comment has asked callers to place their rank deliberately since it was
  written, and scored **5 named of 18**. `KeyboardNavMode` has exported `isTypingTarget` the whole
  time and scored **3 importers of 27 guards**. Documentation asked twice and was declined twice.
- **Q6 — withhold the dangerous freedom, not the answer.** ✔ `alsoWhileTyping` is the release valve
  and it is load-bearing: Escape-to-close **must** work inside a text field, and
  `useDeckControls.tsx` has the exemplary version of that reasoning — *"Esc inside a text box steps
  out of it first. Closing the whole deck mid-sentence would throw away work the reviewer just
  typed."* Withholding the un-guarded event without that valve would break 52 correct Escape
  handlers, which is Q6's failure mode exactly.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** ✔
  Nothing forces `Gallery3D.tsx:90` to skip its guard; the API simply never mentioned one. Widening
  any existing signature is inert. The **construction** — handing back a raw `KeyboardEvent` — is
  what must be withheld.

**Where the type does not reach**, three places, all measured:

1. **The 72 raw `window`/`document` registrations.** No signature reaches a call to a DOM built-in.
   This is the doctrine's *"where types cannot reach"* case #2 in a new costume — the platform's own
   escape hatch is always in scope, and no type discipline reaches a value that never crosses your
   parameter. **This is the case where a census rule genuinely earns its place, and
   `unregistered-key-handler` is already it.**
2. **Ownership between two surfaces binding the same key.** See Q1. Runtime containment, not a type.
3. **The cheat sheet.** `shortcutRegistry.ts` is data about handlers; no type links a data row to a
   `case '?':` in a different file. Deriving the registry from the registrations would close it, and
   that is a refactor, not a type (§8.6).

**The one-edit version, if only one lands:** make `priority` a closed union of named constants. It
is a single edit at the primitive, it corrects the position of all 18 registrations at once, and —
per the contract's *"prefer fixing the default over counting the callers"* — no ratchet would have
moved a single one.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`document.addEventListener('keydown', …)`** | Not a lower rank — **outside the ranking, and first**. `document` precedes `window` in the bubble path, so this beats every registry handler including `priority: 1000`. **Executed: pressing `?` on the Fleet Sessions tab opens two help overlays.** 24 sites. |
| **`window.addEventListener('keydown', …)`** | Same escape hatch, one step less severe (it races the provider on registration order rather than beating it structurally). `return true` from a registry handler stops it **never**. **Executed: one `Ctrl+K` fires 3 actions.** 48 sites. |
| **`{ priority: 29 }`** | A rank that cannot be searched for, reasoned about, or moved. Two authors who pick the same number have collided and neither can see it — `15` is claimed twice today. **13 sites (§9).** |
| **Relying on the tie-break** | There isn't one worth relying on: equal ranks fall through to insertion order **descending**, so the handler that mounts **last** runs **first**. **Executed: swapping mount order inverts the result.** Mount order is a property of the component tree and changes for reasons unrelated to the keyboard. |
| **Writing another `isTypingTarget`** | It exists 4 times. Three are byte-similar private copies, two of them **inside `src/lib/keyboard/` next to the exported one**. None covers `<select>`; only `useFleetHotkeys` does, and it wrote its own thing. The divergences cluster on the element nobody remembers. |
| **Acting on a bare key with no target check at all** | The shortcut fires into the sentence someone is typing. **Executed: with a `<textarea>` focused, the guarded handlers stand down and the unguarded ones still fire.** `Gallery2D`, `Gallery3D`, `DriveImageLightbox`, `Listbox`. |
| **Assuming an open modal makes the route inert** | `BaseModal` claims **Escape and boundary-Tab and nothing else**, and it is not `exclusive`. Every route handler below priority 80 still receives every key, and all 72 raw listeners receive every key regardless. |
| **`exclusive: true` treated as a full stop** | It silences the *other registry handlers*. **Executed: 2 of 2 raw listeners underneath an exclusive overlay still fired, and one key decided 3 things.** |
| **`stopImmediatePropagation` to win a race** | The only tool that would actually stop a sibling listener on the same target, used **once in 4,829 files** and not for a shortcut. Reaching for it means the ownership question was never asked; it does not answer it, it just makes the winner the earliest-registered instead of the highest-ranked. |
| **Adding a row to `shortcutRegistry.ts` and calling it synchronised** | It is a parallel hand-maintained list whose docstring promises *"the documentation can never drift from a hand-maintained list elsewhere"* — while being one. `D` is bound and undocumented; `U` is bound and undocumented. **Both siblings that built a cheat sheet broke it the same way.** |
| **A bare unmodified key on a billable or irreversible action** | `Enter` → `executePersona()`. No confirmation, no cost, no modifier. §7 D7. Owned for disclosure by [informed-consent-gate](./informed-consent-gate.md); listed here because the keyboard is the one affordance that can carry no explanation. |
| **Hardcoded English at a shortcut-reachable door** | `CommandPalette.tsx:105-106` toasts `'Execution started'` / `'Failed to start execution'` — the toast that confirms the run §7 D7 describes. Owned by [i18n-string-authoring](./i18n-string-authoring.md)'s `frozen-ui-copy-constant`. |

---

## 6. Evidence

### The one lane to copy: the triage deck's keyboard ownership

Three files, one idea, and it is the only complete implementation of this leaf in the repo.

```ts
// AppKeyboardProvider.tsx:69-79 — why exclusive exists, in the author's own words
// An EXCLUSIVE surface owns the keyboard for everything beneath it, whether or not it
// recognised this particular key. Priority alone only decides who sees a key FIRST — it
// cannot stop a key the top surface ignores from reaching a route that is still mounted
// underneath, which is how one press could decide two rows (a triage verdict in front and
// a backlog verdict behind an opaque overlay). Handlers ABOVE the exclusive one still run.

// useDeckControls.tsx:509-513, :536, :567 — guard, then modifier bail, then verdict
const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
if (e.key === 'Tab') return live.current.cycleTab(e);        // before the modifier bail: Shift+Tab
if (e.key === 'Escape') { if (inField) el?.blur(); }         //   is half of the focus trap
if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
if (inField) return false;
if (live.current.scrollBody(e.key)) return true;             // ↑↓PgUp/PgDn RESERVED for reading
if (e.key === 'ArrowLeft') { live.current.decideTop('reject'); return true; }

// BacklogFocusDeck.tsx:88-94 — the route underneath, and the incident that produced the mechanism
// On the app keyboard registry at route level rather than on `window`: this deck stays mounted
// underneath the full-app triage deck, and a bare listener meant `←` there rejected a backlog
// idea here too — invisibly, behind an opaque overlay. `A` / `Z`, which the triage deck does not
// even bind, leaked the same way, which is why the overlay claims the keyboard exclusively
// rather than key-by-key.
```

Six properties make it the reference, and only one of them is the registration:

1. **The bug is written down at the site it happened**, including the detail that generalises it:
   `A`/`Z` leaked even though the overlay does not bind them, which is why key-by-key precedence is
   not enough and `exclusive` had to exist.
2. **Order inside the handler is designed.** Tab before the modifier bail because Shift+Tab is half
   the focus trap; Escape before the bail because Escape must work while typing; the guard before
   every verdict.
3. **Escape inside a field blurs rather than closes** — *"Closing the whole deck mid-sentence would
   throw away work the reviewer just typed."*
4. **Vertical keys are reserved and never become a verdict** (`:538-542`) — *"without them a 40-line
   description was undecidable by keyboard."* A decision surface must be readable before it is
   decidable.
5. **The undo key is bare `U`, not `mod+Z`, and the reason is ownership** (`:587-591`): *"the deck
   owns the keyboard EXCLUSIVELY, so a modifier chord here would swallow the browser/app undo
   everywhere else on the surface — including inside the reason strip's free-text box."*
6. **It is the one binding in the app with a test that asserts the ownership**
   (`deckKeyboardOwnership.test.tsx`, a `DANGEROUS_KEYS` fixture against a three-layer mount).

`useFleetHotkeys.ts:45-84` is the best *hand-rolled* version (an `enabled` gate, a modifier bail, a
containment guard covering `select` and the terminal's hidden textarea, and a `gridOpen` narrowing)
and is the one to copy if the ladder is genuinely unavailable — with its `document` swapped for
`useAppKeyboard`.

### The scoping model, used once in ninety

```ts
// SearchAutocomplete.tsx:92-93 — the P10 form. No tag vocabulary, nothing to omit.
const wrapper = containerRef.current?.parentElement;
if (!wrapper || !wrapper.contains(e.target as Node)) return;
```

`Listbox.tsx:136-155` is the same three keys on the same `document` target with no such check, and
has **13 render sites**. The pair is a controlled experiment inside one shared-components folder.

### What the executed replay settles

Six experiments in jsdom over transcribed handlers. Two things it settles that reading did not.
**One:** the ladder's three mechanisms — rank, `return true`, `exclusive` — all terminate at the
registry boundary, and the boundary is invisible from inside any one handler. **Two:** the ordering
is not a race that usually goes the right way; for `document` listeners it is a structural loss that
no rank can recover, which reframes 24 of the 72 raw registrations from "untidy" to "unrankable".

---

## 7. Deviations

**Not applied.** Every entry changes what a keystroke does in an app the operator uses daily, so
each is a note with enough detail to act on later.

**D1 — `?` opens two different help overlays on the Fleet Sessions tab. Executed.**
`useFleetHotkeys.ts:58-61` (raw `document`) opens `FleetHotkeysHelp`; `ShortcutCheatSheet.tsx:34-45`
(registry, `priority: 20`) opens the global cheat sheet. Neither can see the other; the `document`
one runs first. Both are correct in isolation. *Fix:* move `useFleetHotkeys` onto `useAppKeyboard`
and return `true` for `?`, or fold the Fleet chords into `shortcutRegistry.ts` and delete the second
overlay.

**D2 — `Ctrl+K` fires three actions. Executed.** `CommandPalette.tsx:62-67` (registry, `priority: 90`)
returns `true`, and both `RecipeManager.tsx:55-62` and `useCredentialManagerState.ts:72-79` (raw
`window`) fire anyway and pull focus into their own search box while the palette's
`requestAnimationFrame(() => inputRef.current?.focus())` (`CommandPalette.tsx:74`) races them. *Fix:*
both search boxes want `/`-to-focus, not the palette's chord — `PersonaOverviewToolbar.tsx:38-46`
already does exactly that and is the in-repo precedent.

**D3 — the rank is a bare number at 13 of 18 registrations, and `15` is claimed twice.**
`WorkspaceShortcuts.tsx:70` and `NavHistoryShortcuts.tsx:34` both pass `{ priority: 15 }`. Their
chords do not currently overlap, so this is latent rather than live — but the tie resolves by
insertion order **descending**, meaning whichever mounts *last* runs *first* (executed). Two further
numbers are the literal `10` where the exported `ROUTE_DECISION_PRIORITY` **is** 10
(`useEditorKeyboard.ts:19`, `useRunnerExecution.ts:145`), and one is `1000`
(`DevInspector.tsx:75`), which is **off the documented ladder entirely** — its table stops at 100.
*Fix:* §4's closed `KeyboardRank` union. This is §9's population.

**D4 — the nav-mode key set is stated in four places and three are wrong.** `TitleBarDock.tsx:39-70`
binds **S, C, R, D, M, N** (six). `shortcutRegistry.ts:68-72` documents **five** — `D`
(`tray.toggleDispatch()`, `:56-59`) is missing, so a bound global chord appears in no cheat sheet.
`KeyboardNavMode.tsx:12` says *"`S` / `C` / `R` / `M` / `N`"* — also five. `DevInspector.tsx:56`
says *"S/C/R/M/N/G are taken"* — omits `D` and invents `G`, which nav mode does not bind at all
(`g` is `useFleetHotkeys`, route-scoped). `TitleBarDock`'s own docstring (`:24`) is the only correct
one. Separately, the triage deck's bare `U` (undo, `useDeckControls.tsx:592`) appears nowhere in the
registry. *Fix:* derive the registry from the registrations (§8.6), or at minimum add `D` and `U`.

**D5 — the typing guard exists four times and none of the four covers `<select>`.**
`KeyboardNavMode.tsx:29` exports it (3 importers). `WorkspaceShortcuts.tsx:21`,
`ShortcutCheatSheet.tsx:15` and `AthenaOrbLayer.tsx:19` each define a private copy — **two of them
inside `src/lib/keyboard/` itself, in files that sit next to the export.** The copies have already
diverged: `AthenaOrbLayer`'s adds `typeof el.tagName !== 'string'` and `=== true`, and its docstring
cites *"guard in `QuickReplies` / `WorkspaceShortcuts`"* as precedent — a visible copy lineage. Only
`useFleetHotkeys.ts:48` covers `select`, and it did so by writing a fifth, different thing. *Fix:*
move the guard into `AppKeyboardProvider.tsx` and apply it by default (§4).

**D6 — four global handlers act on bare typable keys with no target check at all.**
`Gallery2D.tsx:262` (arrows, `+ = - _ 0 f F c C`), `Gallery3D.tsx:90` (arrows),
`DriveImageLightbox.tsx:178` (arrows, `+ = - _ 0 r R`) — all three are lightboxes that are usually
alone on screen, which is why nobody noticed — and `Listbox.tsx:152` (`ArrowUp`/`ArrowDown`/`Enter`,
**13 render sites**, `document`-scoped, `preventDefault` on Enter). Its shared-components sibling
`SearchAutocomplete.tsx:92-93` solves it correctly with containment. *Fix:* one line each — the
containment check from `SearchAutocomplete`, not a fifth `isTypingTarget`.

**D7 — a bare `Enter` starts a billable Claude run. Executed. This is the headline note.**
`useRunnerExecution.ts:119-145` registers at `priority: 10` and, on `Enter`, calls `handleExecute()`
→ `executePersona(personaId, parsedInput)` (`:112`, and the cloud arm at `:66`). No modifier, no
confirmation, no cost figure. Its denylist is careful — `INPUT`/`TEXTAREA`/`SELECT`/`BUTTON`/
`SUMMARY`/`A`, six ARIA roles, and `closest('[role="dialog"], dialog')` — but a keydown on the page
body, on the output pane, or on any non-interactive `<div>` passes all of it. Replayed: **Enter with
nothing focused → 1 billable run; Enter from a plain `<div>` → 1; five key-repeats → 5**, because
`e.repeat` is never consulted and the only re-entry guard is `isExecuting`, a Zustand value read
through React and therefore committed a frame late — the same shape
[agent-dispatch](./agent-dispatch.md) §7 D1 executed for a mouse double-press. *Fix (note only):*
require a modifier (`mod+Enter` is this repo's own "commit" idiom at `ComposerPickerShell.tsx:66`
and `QuickEditPopover.tsx:60`), or add `if (e.repeat) return false`, or route it through the
confirmation [informed-consent-gate](./informed-consent-gate.md) owns. **Also: the toast that
confirms it is hardcoded English** (`CommandPalette.tsx:105-106`, the palette's own path to the same
call).

**D8 — `BaseModal` (128 render sites) does not make the route beneath it inert, and the API reads as
if it does.** At `priority: 80` it returns `false` for every key but Escape-when-topmost and
boundary-Tab (`:198-227`), and it is never `exclusive`. So with any modal open, `BacklogFocusDeck`'s
bare `a`/`z`, `ReviewFocusFlow`'s arrows, `useRunnerExecution`'s `Enter` and all 72 raw listeners
still receive every keystroke. Two route surfaces have already hand-rolled their own compensation —
`useRunnerExecution.ts:141` (`closest('[role="dialog"]')`) and `IncidentsInbox.tsx:366`
(`modalOpenRef`) — which is the same guard invented twice at the wrong layer. *Fix:* an
`exclusive`-like default on `BaseModal`, or an exported `useAnyModalOpen()` the routes can consult.

**D9 — `AppKeyboardProvider`'s own fallback silently drops both guarantees.** `:131-136`: with no
provider in the tree, `useAppKeyboard` falls back to `window.addEventListener` and **neither
`priority` nor `exclusive` is honoured** — the options are accepted and ignored. The comment at
`:110-112` says so for `exclusive` only; `priority` is undocumented in that branch. This is the
contract's *"gate that points at a broken destination"* in its purest form: calling the right
function is not the same as getting the behaviour. *Fix:* throw in dev when the context is absent,
or drop the fallback.

**D10 — two capture-phase registrations claim top priority by bypassing the ranking rather than
ranking within it.** `MonitorView.tsx:94` and `IngestDirectoryPicker.tsx:42` pass `true` as the
third argument, which puts them ahead of everything on the way *down*. Both are Escape handlers and
both are probably right about wanting to win; neither says so anywhere a reader of the ladder would
look. The sibling sweep found the identical move in `ascent` (`_dev-inspector/DevInspector.tsx:125`)
— *C2 solved for exactly one consumer by bypassing everyone else rather than by ranking against
them.* *Fix:* a named top rank, so the claim is legible.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`useAppKeyboard` cannot express "this key belongs to this element's subtree".** Rank answers
   *who wins globally*; it has no vocabulary for *this only applies while focus is inside me*. Every
   guard in §7 D5/D6 is an approximation of that missing concept via element tags, which is why the
   approximations keep omitting `<select>`. `brainiac` avoided this leaf entirely by using the DOM
   focus tree instead (`ReviewWorklist.tsx:358-361`) — **the gap is upstream of most of §7, and it is
   the one place a sibling is ahead of this repo.**
2. **The ladder cannot rank a `document` listener, ever.** Not a policy failure — event propagation
   puts `document` strictly before `window` in the bubble phase. A registry attached to `window`
   cannot out-rank anything attached closer to the target. The only fixes are to move the registry
   to `document` capture-phase (which would then out-rank everything, including legitimate
   element-level handling) or to eliminate raw listeners.
3. **The provider is keydown-only** (`:83`). Not currently binding: **0 of the 74 raw registrations
   are `keyup` or `keypress`.** Worth knowing before someone needs keyup for a held-modifier
   affordance and reaches for `window` "because the hook can't do it".
4. **`exclusive` cannot suppress what it does not know about**, and there is no way for a surface to
   ask "is anything exclusive above me?" — so a route cannot defend itself either. Both halves would
   need the same registry.
5. **There is no tie-break.** `b.id - a.id` is insertion order, and React's mount order is not stable
   under refactor, `Suspense` boundaries, or StrictMode's double-invocation of effects.
6. **`shortcutRegistry.ts` cannot be derived from the handlers as they are written today**, because a
   chord lives in imperative control flow (`if (e.key === 'b' || e.key === 'B')`) rather than in
   data. Deriving it means the registration declares its chords — `useAppKeyboard({ chords: [...] })`
   — which is a larger refactor than this path prescribes, and is the real fix for D4.
7. **The census cannot see any of D1, D2, D4, D8 or D9.** They are absences (a chord *not*
   documented; a suppression that does *not* happen) or runtime interactions between two files. §9
   says what to build instead.

---

## 9. The missing gate

**The condition, stated stack-free:** *a surface installs a claim on a shared, single-slot input
resource without declaring a position relative to the other surfaces competing for the same slot —
either by not joining the ordering scheme at all, or by joining it at a position that has no name.*

**The first half is already gated, and I did not re-propose it.** `unregistered-key-handler`
(`focus-management.md`, baseline **72 files / 72 matches**) keys on
`addEventListener\(\s*['"]key(?:down|up|press)['"]`, excluding `AppKeyboardProvider.tsx`. **I
reproduced it independently — a third implementation, walking the tree and stripping comment lines
myself — and got exactly 72/72.** Its stated proxy is verbatim the condition this leaf is about:
*"a key handler that has no declared position relative to the other surfaces competing for the same
key, so one press can be interpreted twice."* Everything §0 executed is downstream of it. Adding a
second rule on the same 72 files would be the 83%-overlap decline the doctrine already records.

**What that rule structurally cannot see is the other half: a handler that *did* join the ladder.**
It matches on `addEventListener`; a `useAppKeyboard` call contains no such token. So the 18
registrations that followed the doctrine are invisible to it, and 13 of them wrote their rank as a
number. That is the contract's **fifth failure mode**: `unregistered-key-handler` verifies you
*arrived at the destination*; nothing verifies the destination was worth arriving at. **Measured file
overlap between the two rules: 0 of 12.**

**Where it runs.** `npm run census` / `npm run census:check` — inside `npm run check`
(`package.json:52`) and, more importantly, in the **`golden-path-census` pre-push job**
(`lefthook.yml:74-75`), which exists because the census had been *"enforced NOWHERE"* before
2026-08-16 (`lefthook.yml:58-64`). Deliberately **not** `ci.yml`: that workflow is currently red on
10 pre-existing Rust failures, and per this batch's calibration a gate that only runs in CI runs
nowhere. This one runs on every push from the machine that made the change. **Full run: 1.1 s.**

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| **`unregistered-key-handler`** (72/72, `focus-management`) | `addEventListener('key*')` on window/document | **The nearest neighbour and the reason this §9 is mostly a decline.** Same leaf-subject, opposite population: it owns everything *outside* the ladder, mine owns the rank *inside* it. Disjoint by anchor (`addEventListener` vs `priority:`) and **measured disjoint by file: 0 of 12 overlap**, run side by side in the same private registry. |
| `unfocusable-click-target` (32/38, `focus-management`) | a `div`/`span` with `onClick` + `cursor-pointer`, no `tabIndex`/`role` | Whether a *mouse* target is reachable by keyboard at all. JSX-tag-shaped; mine is a call-argument object. Zero possible overlap. |
| `hand-rolled-outside-click` (46/47, `anchored-popover`) | `addEventListener('mousedown'\|'pointerdown')` | Its own description declares the split: *"Disjoint from `unregistered-key-handler`…, which owns the `key*` half of the same effects."* Neither half is mine. |
| `module-scope-install-latch` (13/13) | a module-scope boolean guarding a one-time install | Nearest in *spirit* (a global installed once, unrankable) and disjoint in anchor — it sees no call-argument object. |
| `hand-rolled-row-stagger` (4/4) · `hand-rolled-spinner` (182/248) · `hand-rolled-disabled-state` (361/815) | non-adoption of a shared UI primitive | Same *family* of argument, different primitive, and all three key on JSX/class markup. Mine fires on sites that **did** adopt. |
| `stateless-disclosure-control` (56/59) · `live-region-born-with-its-message` (17/17) | ARIA attributes on rendered elements | Adjacent a11y territory, tag-shaped, no overlap. |
| `frozen-ui-copy-constant` (62/818, `i18n-string-authoring`) | English string constants | Owns D7's toast; not the binding. |
| `unkeyed-billable-spawn` (11/13) · `unconsented-irreversible-door` (12/12) | Rust idempotency keys · a `.tsx` importing a delete door with no confirmation | Both are about D7's *action*. Neither can see that a **keystroke** reaches it — `useRunnerExecution.ts` imports nothing from that verb vocabulary. D7 is carried as a note, not gated (see the rejected-gates table). |

**None of the 130 existing rules keys on the rank a handler declares when it joins an ordering
scheme. Proposing one.**

### Measurement

**Precision 13/13 violating and 5/5 compliant — every match opened and read.** The population is the
**18** call expressions to `useAppKeyboard` outside the primitive's own definition. The two patterns
see all 18 and partition them **13 violating / 5 compliant**, with no residual: **13 + 5 = 18
exactly**, which independently reconciles with the handler-resolving pass's count of 16 production
call sites plus the 2 in `deckKeyboardOwnership.test.tsx`.

Two independent implementations, and **the first was wrong twice**:

| implementation | global registrations found | notes |
| --- | ---: | --- |
| pass A — handler-identifier resolution, reads each declaration body | **90** | 74 raw + 16 `useAppKeyboard` |
| pass B — fixed-window slice around each registration call | **88** | deliberately skips the primitive's own 2 listeners → **reconciles exactly at 90** |
| the census engine, from the published pattern | 18 | 13 + 5 |

The two guard classifications, by contrast, **disagreed materially and pass B was worse** — it
reported `DrivePage.tsx:324` and `useTimelineKeyboard.ts:122` as unguarded when both guard on the
first statement, and it reported `PersonaOverviewToolbar.tsx:46` as unguarded because its guard uses
`.matches('input, textarea, [contenteditable="true"]')`, a form neither pattern's vocabulary listed.
**That is the doctrine's vocabulary-recall failure exactly** — *"the words you forget to list are
disproportionately the interesting ones"* — and it is why §0's guard figure (**27 of 90**) is
hand-corrected upward from the automated 26 rather than published as measured.

**The pattern was wrong twice before it was right, and both were instrument defects worth recording.**
(1) Written into bash argv, MSYS ate every backslash: `\{` became `{` and `\d` became a literal `d`,
the rule matched zero files, and the runner's structural check caught it. **The doctrine says put
patterns in a file; I did not, and paid for it in one round-trip.** (2) With the escaping fixed, the
pattern still missed `TitleBarDock.tsx:70` and `KeyboardNavMode.tsx:68` — **11 of 13, reported as a
silent drop.** The cause: `ignoreCommentLines` does **not** strip comments from the content before
matching (it discards matches whose line is a comment), so a `// …` block sitting between the
handler's closing `},` and the options object is *in* the text the pattern must cross. The published
pattern therefore admits up to six comment-or-blank lines in that gap, via a group anchored on a
mandatory `\r?\n` so there is no nested quantifier.

**Contamination: one match, and it is defensibly a true positive.**
`deckKeyboardOwnership.test.tsx:90` passes `{ priority: 90 }` in a fixture named *"Stands in for the
command palette (90) / BaseModal (80) — above the deck."* The number is a hand-copy of
`CommandPalette.tsx:67`; if the palette moves, the fixture keeps passing while no longer testing what
it claims. It is exactly the defect, in the file that exists to prevent it. It is **not** excluded.

**Backtracking:** the only multi-token fill is `(?:[ \t]*(?://[^\n]*)?\r?\n){0,6}`, whose body must
consume a newline every iteration and whose two inner quantifiers range over disjoint character sets
(`[ \t]` cannot start `//`). Full 4,829-file run of both rules: **1.1 s**.

**Fault-injected six ways, all six fire** (`census FAILED`, exit 1): floor raised to 99999 → *"THE
MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a non-matching literal → matched
zero files, structural; baseline lowered to 2 → rise; baseline raised to 40 → silent drop; a
`baseline` added to the control → rejected before any file is walked; a stale `exclude` path → *"the
exemption is stale"*.

**Validated standalone** in a composer-private registry
(`registry-keyboard-shortcut-registration-composer.json` — a filename unique to this composer,
because sibling composers share the scratchpad directory and have overwritten each other's files),
then **re-extracted from this finished document and re-run: `files 12 / matches 13` and `files 5 /
matches 5`, identical both times.** The full registry was not run.

**One reporting artefact, the same one [agent-dispatch](./agent-dispatch.md) recorded:** the engine
reports the line of the statement-boundary character, so each match line is **2–3 less** than the
line of the `useAppKeyboard` call and equal to or one less than the line of the options object.
`WorkspaceShortcuts.tsx:70` is the `{ priority: 15 }` at `:71`.

### The rule

```json
{
  "rules": [
    {
      "id": "unnamed-keyboard-priority",
      "goldenPath": "docs/concepts/golden-paths/keyboard-shortcut-registration.md",
      "title": "A handler joins the keyboard ownership ladder at a position written as a bare number, so its rank exists only in a doc comment",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": ",[ \\t]*(?:\\r?\\n(?:[ \\t]*(?://[^\\n]*)?\\r?\\n){0,6}[ \\t]*)?\\{[ \\t]*(?:enabled[ \\t]*:[ \\t]*[^,{}]{1,60},[ \\t]*)?priority[ \\t]*:[ \\t]*\\d",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An AppKeyboardOptions object passed as the SECOND argument of useAppKeyboard, whose `priority` is a NUMERIC LITERAL rather than a named constant. PROXY FOR the stack-free condition: a surface installs a claim on a shared single-slot input resource at a position that has no name, so its rank cannot be searched for, reasoned about or safely moved, and two surfaces that chose the same number have collided without either author being able to see it. MEASURED 2026-08-16 at e3c5e0d7f: 13 matches across 12 of 4829 .ts/.tsx files, ALL THIRTEEN OPENED AND READ (precision 13/13). POPULATION AND PARTITION: the 18 call expressions to useAppKeyboard outside the primitive's own definition split 13 numeric / 5 named, and 13 + 5 = 18 exactly, so every registration is classified and there is no unexamined third population; this independently reconciles with a handler-resolving pass that found 16 production call sites plus the 2 in deckKeyboardOwnership.test.tsx. THE THIRTEEN: App.tsx:168 (100) - useEditorKeyboard.ts:19 (10) - useRunnerExecution.ts:145 (10) and :190 (20) - CommandPalette.tsx:67 (90) - TitleBarDock.tsx:70 (29) - DevInspector.tsx:75 (1000) - KeyboardNavMode.tsx:68 (30) - NavHistoryShortcuts.tsx:34 (15) - ShortcutCheatSheet.tsx:43 (20) - WorkspaceShortcuts.tsx:70 (15) - BaseModal.tsx:227 (80) - deckKeyboardOwnership.test.tsx:90 (90). THREE OF THE THIRTEEN ARE ACTIVE DEFECTS, NOT MERELY UNNAMED. (1) NavHistoryShortcuts and WorkspaceShortcuts BOTH pass 15, and the registry's tie-break is `b.priority - a.priority || b.id - a.id`, i.e. INSERTION ORDER DESCENDING - executed in jsdom, swapping the mount order inverts which handler runs first, so React mount order is load-bearing on keyboard ownership. (2) useEditorKeyboard.ts:19 and useRunnerExecution.ts:145 write the literal 10 while AppKeyboardProvider.tsx:98 EXPORTS ROUTE_DECISION_PRIORITY = 10 with a docstring explaining what that rank is for - the constant exists, is exported, has exactly that value, and was not used. (3) DevInspector.tsx:75 passes 1000, which is off the documented ladder entirely: the table at AppKeyboardProvider.tsx:31-42 stops at 100. THE ONE TEST-FILE MATCH IS DELIBERATELY NOT EXCLUDED and is defensibly a true positive: deckKeyboardOwnership.test.tsx:90 is a fixture named 'Stands in for the command palette (90) / BaseModal (80) - above the deck', and its 90 is a hand-copy of CommandPalette.tsx:67; if the palette's rank moves, that test keeps passing while no longer testing what it claims - the exact defect, in the file that exists to prevent it. THE FIVE COMPLIANT SITES ARE THE DOCTRINE, NOT MERELY COMPLIANCE: four import ROUTE_DECISION_PRIORITY from the primitive (BacklogFocusDeck.tsx:115, ReviewFocusFlow.tsx:259, AthenaOrbLayer.tsx:166, and the same test file at :78), and the fifth (useDeckControls.tsx:607) uses DECK_KEYBOARD_PRIORITY - which is itself only a FILE-LOCAL const at useDeckControls.tsx:101, not an export of the ladder, so even the best site names its rank in the wrong place. DO NOT SILENCE A MATCH by hoisting the number into a local `const P = 29` in the same file: that satisfies the pattern and still leaves the rank invisible to every other file competing for the same key, which is the condition this rule names. THE PATTERN WAS WRONG TWICE BEFORE IT WAS RIGHT, both instrument defects: written into bash argv, MSYS ate every backslash (\\{ became { and \\d became a literal d) and the rule matched zero files - the doctrine says put patterns in a FILE and it is right; then, with escaping fixed, it still missed TitleBarDock.tsx:70 and KeyboardNavMode.tsx:68 at 11 of 13, because `ignoreCommentLines` does NOT strip comments from the content before matching - it discards matches whose LINE is a comment - so a // block sitting between the handler's closing `},` and the options object is IN the text the pattern must cross. Hence the comment-tolerant gap, written as a group anchored on a mandatory \\r?\\n so there is no nested quantifier: the body must consume a newline every iteration and its two inner quantifiers range over disjoint character sets ([ \\t] cannot begin //). CONTAMINATION otherwise ZERO: a bare /priority\\s*:\\s*\\d+/ finds 38 occurrences in src and only 13 are keyboard ranks - the other 25 are sidebar ordering, execution middleware and twin readiness gaps - and all 25 are excluded by two anchors together: the object must be the SECOND argument (preceded by a comma, which drops `idea({ priority: 2 })` in triageAdapters.test.ts where the preceding character is an open paren) and `priority` must be its FIRST key or follow only `enabled` (which drops `{ key: 'stage-timing', priority: 5 }` in the middleware and every `{ id: ..., priority: 6 }` in SidebarLevel1.tsx). Full 4829-file run of this rule and its control: 1.1s. DOES NOT OVERLAP unregistered-key-handler (focus-management.md, 72/72), which is this leaf's own nearest neighbour and owns the OTHER half of the same condition - a keystroke listener attached straight to window/document, i.e. a handler that never joined the ladder at all. That rule matches on `addEventListener`; a useAppKeyboard call contains no such token, so it is invisible to it, and 13 of the 18 sites that DID follow the doctrine wrote their rank as a number. FILE OVERLAP MEASURED, NOT ASSUMED: run side by side in the same private registry, the two rules' file sets intersect at ZERO of 12. This is the golden-path contract's fifth failure mode - unregistered-key-handler verifies you ARRIVED at the destination; nothing verifies the destination was worth arriving at. Nor does it overlap unfocusable-click-target or stateless-disclosure-control (both JSX-tag-shaped), hand-rolled-outside-click (whose own description declares the key* half belongs to unregistered-key-handler), or module-scope-install-latch (nearest in spirit, a global installed once and unrankable, and disjoint in anchor - it sees no call-argument object). LEGAL FIX, one import each: use ROUTE_DECISION_PRIORITY where the rank is 10, and export a named constant from AppKeyboardProvider.tsx for every other rung, adding its row to the ladder table in the same edit. END OF LIFE: this rule is designed to reach zero, and the golden path's 'Prefer a type over a gate' proposes the closed union `priority: KeyboardRank` that makes an unnamed rank UNSPELLABLE at all 18 sites - note that making `priority` merely REQUIRED changes nothing, because 18 of 18 already pass one; requiredness and closedness are two different edits here and only the second is the fix. When the count reaches 0 the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0. PRECONDITION (must be re-derived per repo, do NOT port): this repo owns a priority-ranked keyboard registry whose rank is passed as a numeric field of an options object. The convergence sweep found ZERO of four applicable sibling repos with any ordering scheme at all (63 hand-rolled keydown registrations, no central dispatcher, no priority number anywhere), so this pattern scores a STRUCTURAL ZERO in all four - and brainiac makes the point from the other side by declining the premise: it scopes shortcuts with a React onKeyDown on a tabIndex={-1} container (console/app/console/modules/reviews/ReviewWorklist.tsx:313,:358-361), so ownership is decided by the DOM focus tree and there is no rank to name.",
        "$measured": "2026-08-16 @ e3c5e0d7f — 4829 .ts/.tsx walked, floor 4000, both rules run in 1.1s; two independent implementations of the global-registration population (a handler-identifier resolver and a fixed-window slicer) reconciled exactly at 90 registrations, of which 18 are useAppKeyboard calls; all 13 matches and all 5 control matches hand-read; the AppKeyboardProvider registry and eight real handlers transcribed statement-for-statement and replayed in jsdom (document beats priority 1000; one Ctrl+K fires 3 actions; exclusive:true suppresses 0 of 2 raw listeners; a priority tie inverts with mount order; a bare Enter starts a billable executePersona run and 5 key-repeats start 5). No database was copied and the live app was never touched."
      },
      "baseline": { "files": 12, "matches": 13 },
      "floor": 4000
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unnamed-keyboard-priority-positive-control",
  "goldenPath": "docs/concepts/golden-paths/keyboard-shortcut-registration.md",
  "title": "POSITIVE CONTROL — the same options object, with the rank expressed as a named constant",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": ",[ \\t]*(?:\\r?\\n(?:[ \\t]*(?://[^\\n]*)?\\r?\\n){0,6}[ \\t]*)?\\{[ \\t]*(?:enabled[ \\t]*:[ \\t]*[^,{}]{1,60},[ \\t]*)?priority[ \\t]*:[ \\t]*[A-Za-z_$]",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ e3c5e0d7f — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 5 files / 5 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL options object in the IDENTICAL argument position as unnamed-keyboard-priority, differing in exactly one character class: the `priority` value begins with an identifier character rather than a digit. The two are mutually exclusive BY CONSTRUCTION rather than empirically - a JavaScript expression cannot begin with both a digit and an identifier character. MEASURED 2026-08-16 at e3c5e0d7f: 5 matches across 5 files versus the gate's 13 across 12. PARTITION, NOT A RATIO: the two patterns together see all 18 useAppKeyboard call expressions outside the primitive's own definition, and 13 + 5 = 18 exactly, so every registration is classified and there is no unexamined residue; this independently reconciles with a handler-resolving pass that counted 16 production call sites plus 2 in the ownership test. WHAT THE FIVE DEMONSTRATE IS THE DOCTRINE, NOT MERELY COMPLIANCE. Four import ROUTE_DECISION_PRIORITY from AppKeyboardProvider.tsx:98, whose docstring says the thing a number cannot - 'Where a surface that belongs to the CURRENT ROUTE registers... Above the default so a route's own bindings beat incidental ones, and far below every overlay, because anything mounted over the route is what the user is actually looking at' - and they are exactly the four route-level decision surfaces that would otherwise be able to decide something invisibly behind an overlay: BacklogFocusDeck.tsx:115, ReviewFocusFlow.tsx:259, AthenaOrbLayer.tsx:166, and deckKeyboardOwnership.test.tsx:78, the fixture that asserts precisely that. The fifth, useDeckControls.tsx:607, names its rank DECK_KEYBOARD_PRIORITY - and is the instructive one, because that constant is a FILE-LOCAL const at useDeckControls.tsx:101, not an export of the ladder, so even the compliant set's best member names its rank where no other file competing for the same key can see it. A CONTROL THAT MERELY COUNTED A NAMED IDENTIFIER WOULD ALSO PASS FOR A LOCAL `const P = 29` HOISTED OUT OF THE CALL, which leaves the rank just as invisible; that this repo's compliant set is four importers of the one exported rank plus one file-local const, with no hoisted magic numbers, is the evidence behind the golden path's section 4 proposal to close `priority` into a union of named constants rather than merely requiring it. 28% of this repo's keyboard registrations that joined the ladder named their rank; 72% did not. If this control's count ever collapses toward the gate's, the shared anchor (a second-argument options object whose first or second key is `priority`) has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible, and it already caught two: a bash-mangled backslash that zeroed the gate while the control kept matching, because the control's value class [A-Za-z_$] survived the mangling that destroyed the gate's \\d; and a comment-intolerant gap that silently cost the gate 2 of its 13 while the control, whose five sites have no comment between the handler and the options object, was unaffected and reported a clean 5. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine rejects a `-positive-control` id that carries one (verified by injection) and the registry merge skips it by construction."
  },
  "floor": 4000
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **`addEventListener('key*')` on window/document** — the dominant cause of every executed finding in §0 | 72 | 18 | **It already exists**, as `unregistered-key-handler` (`focus-management.md`), and I reproduced its 72/72 exactly with a third independent implementation. Its published proxy statement is verbatim this leaf's condition. **Declined for 100% duplication, not overlap.** |
| **`document`-only key listener** — a strictly worse subset (structurally out-ranks the whole registry, per §8.2) | 24 | 48 | **24 of 24 files are a strict subset of the existing rule's 72.** The distinction is real and load-bearing prose (§5, §8.2) but a second ratchet over the same files buys nothing. **Refused; carried as the first row of §5.** |
| **a global key handler with a bare-key test and no editable-target guard in the file** — D6, and the condition users actually feel | 10 | 25 | **8 of the 10 files overlap `unregistered-key-handler`** (80%), past the 83% precedent the doctrine records as a correct decline. Worse, precision is poor on its own terms: `App.tsx` (Ctrl+Shift+M) and the ownership test file are false positives, and the file-scoped negative lookahead cannot see that `SearchAutocomplete.tsx:92` solves it by **containment** rather than by a tag test — the better answer would have been counted as the defect. **Refused; carried as D6 and as §8.1.** |
| **a chord bound in code and absent from `shortcutRegistry.ts`** — D4, and the highest-value finding after D7 | — | — | **An absence, which the census cannot express**, and a cross-file one at that: the fact is that `'D'` appears in `TitleBarDock.tsx` and *not* in `shortcutRegistry.ts`. The right instrument is a **derivation**, not a counter — make the registration declare its chords (§8.6) and the list becomes a projection that cannot drift. Until then it is a doc check, and both sibling repos that built a cheat sheet drifted it too. |
| **a bare unmodified key reaching a billable or irreversible call** — D7, the headline | 1 | — | **One match is not a ratchet.** A single-match rule cannot distinguish "fixed" from "matcher broken", and the runner would fail structurally the moment it is fixed. It is also the wrong altitude: the *disclosure* belongs to [informed-consent-gate](./informed-consent-gate.md) and the *spend* to [spend-ceilings](./spend-ceilings.md). **Carried as D7 with the executed evidence, for a human to route.** |
| **`BaseModal` not suppressing route shortcuts** — D8 | — | — | A runtime interaction between two files, one of which does not mention the other. Nothing static sees it. The right instrument is the **existing ownership test** (`deckKeyboardOwnership.test.tsx`) extended with a `BaseModal` layer — a test, not a matcher. |

### What the census fundamentally cannot gate here, and what to build instead

Three of this document's findings are absences, and the runner ratchets presence:

- **"a bound chord that no cheat-sheet row documents"** (D4) — a *derivation* check. The general
  instrument is to make `useAppKeyboard` take the chords as data and generate `shortcutRegistry.ts`
  from the registry at build time, which turns a drift class into a type error. **Both sibling repos
  that hand-maintained a shortcut list drifted it**, so this is the clause with the most external
  warrant for being structural rather than checked.
- **"an overlay that does not silence what it hides"** (D8) — the **existing** ownership test is the
  right shape and needs one more layer. `deckKeyboardOwnership.test.tsx` already presses a
  `DANGEROUS_KEYS` fixture against a three-layer mount; adding `BaseModal` and one raw-`window`
  surface to that mount would have caught D8 and D2 at authoring time. **A test, not a rule** — and
  this repo already owns the test.
- **"the ladder has no tie-break"** (D3's second half, §8.5) — not a code condition at all. The fix
  is the closed `KeyboardRank` union in §4, which makes two handlers at the same rung a deliberate,
  named, greppable act instead of a coincidence of two numbers.

---

## 12. Corrections to the brief

The brief was right about the shape and wrong or incomplete on seven specifics. Recorded per the
doctrine, since the corrections are the deliverable.

1. **"`WorkspaceShortcuts.tsx` exists and dynamically imports a store — measure what it registers and
   how."** — Confirmed and **it is the wrong file to lead with.** It registers three chords
   (`mod+B`, `mod+M`, `alt+A`) at `priority: 15`, guards correctly, and its `import()` at `:57` is a
   deliberate lazy-load of the companion store inside the Alt+A branch, not a defect. What makes it
   worth naming is something the brief did not ask about: it defines its **own private copy** of
   `isTypingTarget` (`:21-26`) that is byte-similar to the exported one two files away
   (`KeyboardNavMode.tsx:29`) — one of **four** copies (§7 D5), and the one a third copy
   (`AthenaOrbLayer.tsx:15-16`) cites as its precedent.

2. **"A keystroke starts a billable persona run: `CommandPalette.tsx:104` calls `executePersona(id)`
   with no confirmation, no cost shown, and a hardcoded-English toast."** — **All three facts
   confirmed, and the framing understates it in one way and overstates it in another.** Overstates:
   the palette path is not one keystroke — it is `mod+K`, then typing, then `Enter` on a selected
   row, which is a deliberate multi-step act. **Understates: there is a genuinely single-key path to
   the same call and the brief did not have it.** `useRunnerExecution.ts:119-145` fires
   `executePersona` on a **bare, unmodified `Enter`** with nothing focused — replayed in jsdom,
   1 press → 1 billable run, 5 key-repeats → 5, because `e.repeat` is never consulted and the only
   re-entry guard is React state committed a frame late. **That is the headline (§7 D7), and it is
   a different file from the one the brief named.** The hardcoded-English toast is real at
   `CommandPalette.tsx:105-106` and belongs to `frozen-ui-copy-constant`.

3. **My own first replay was wrong, and I am recording it rather than dressing it up.** Experiment 4
   reported *"3 actions fired while typing"*, including a triage-deck verdict — which would have been
   a serious finding. It was **my** defect: I transcribed `useDeckControls` in abbreviated form and
   dropped its `inField` bail (`:509-513`, `:536`). Re-run with the real guard, **the deck correctly
   stands down** and only the genuinely unguarded raw listeners fire. The corrected number is in §0.
   This is the doctrine's *"the tool answered a different question than the one asked, and the answer
   looked plausible"* in first person: an abbreviated transcription is not a transcription.

4. **"Drag handles are `role="button"` but not focusable even via `.focus()` — keyboard reachability
   is 0 of 26 for drag-reorder."** — Out of scope and **already owned**:
   [focus-management](./focus-management.md) ships `unfocusable-click-target` (32/38) for exactly
   that. Not re-measured here; noted so the next composer does not re-derive it.

5. **"`useUnsavedGuard` intercepts navigation; there are only 3 navigate-away protections."** — Not
   this leaf. `useUnsavedGuard` never registers a key handler and does not appear in any of the 90
   registrations. The keyboard's only interaction with it is that `KeyboardNavMode`'s `←` and
   `NavHistoryShortcuts`' `alt+←` both route through `useSystemStore().navigateBack()`, which
   `KeyboardNavMode.tsx:9-11` documents as running *"a registered back-interceptor"* — so the guard
   is reached, correctly, through the store rather than through the keyboard. **No defect found; the
   integration is the good case.**

6. **"Whether any chord is claimed twice."** — Yes, and the interesting answer is not the count.
   Three chords are multiply claimed in a way that fires: `?` (2 help overlays, D1), `Ctrl+K`
   (3 actions, D2), and the `priority: 15` tie (latent, D3). But the mechanism is what matters:
   **`return true` and `exclusive: true` bind only the 18 handlers on the ladder**, so "claimed
   twice" is not a collision the app can lose gracefully — it is 72 handlers that were never in the
   competition. The naive chord-collision count over all 90 registrations is misleading in both
   directions (Escape alone is claimed by 52 sites, almost all correctly, because each is guarded by
   its own `open` flag) and I do not publish it as a headline.

7. **"Whether shortcuts work inside a modal."** — **They all do, and this was the brief's sharpest
   instinct.** `BaseModal` is at `priority: 80` with **128 render sites**, and it claims exactly
   Escape-when-topmost and boundary-Tab; everything else returns `false`, and it is never
   `exclusive`. So with a modal open, every route handler below 80 and every one of the 72 raw
   listeners still receives every keystroke. Two route surfaces have already hand-rolled their own
   compensation for this at the wrong layer (§7 D8).

8. **The leaf's `convergence: diverged` label survives, and it is diverged in an unusual direction —
   with one clause where a sibling is ahead.** The *typing guard* (P2) is unanimous physics, 3 of 3
   applicable repos, and **every one implemented it at a different coverage**, which is a stronger
   argument for §4's type than agreement would have been. The *single-key-on-an-irreversible-action*
   hazard (P9) is physics too, 3 of 3, with two incompatible ad-hoc mitigations. But the two clauses
   this document leans hardest on — **a central ranked dispatcher (P1) and named ranks (P4) — are
   SILENCE, 0 of 4**, across 63 hand-rolled registrations. Personas is alone and ahead on both, and
   they are marked house conventions in §2 and the head. **And on P10 a sibling is ahead of us:**
   `brainiac` declined the whole premise, scoping shortcuts by DOM containment on a focusable
   container, and therefore owes nothing to P1, P4, P5, P6 or P8. An adopting repo should read §8.1
   before building a ladder, not after.
