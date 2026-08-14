# Golden path — Focus management

> Situation node: `ui-system/motion-and-accessibility/focus-management` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. Sweep: 6,933 file-visits across `src/**` (4,829 `.ts` + 2,104 `.tsx`),
> plus a full read of `BaseModal`, `AppKeyboardProvider`, `useDeckDialog`, `Listbox`,
> `UnifiedTable`, `PanelTabBar`, `SegmentedTabs`, `IssuesList`, `useRovingTabIndex`,
> `globals.css`, all 21 custom ESLint rules, and a convergence census of the sibling
> repo `personas-web`.
> Dimensions: **ui · function · code-quality**.
> **Settles:** where keyboard focus goes when a surface opens, closes, or changes — and who owns it.
>
> Shared counts are cited from [`shared-facts.json`](../shared-facts.json); everything
> else was measured during composition. Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md)'s recommendations #1 and #2,
the head is physically separated and every clause carries its **warrant**, so an
adopting repo can tell physics from local calibration. No file path, primitive name
or count appears below this line until the head ends.

> **P1 — physics.** Anything the interface presents as operable must be reachable
> by keyboard. If a pointer can act on it, a tab stop must be able to reach it.
>
> **P2 — physics.** A surface that takes over the screen owns focus for as long as
> it is up: focus moves *in* when it opens, cannot leave while it is open, and
> returns to whatever opened it when it closes. All three, or none of them counts.
>
> **P3 — physics.** Restoration must survive the surface being *unmounted*, not
> only being toggled shut, and must not fire at a node that no longer exists.
>
> **P4 — physics.** A group of peer controls is **one** tab stop, not N. Arrow keys
> move within the group; Tab leaves it. Moving the selection must move real focus,
> not only a highlight — a highlight nothing is focused on is invisible to assistive
> technology.
>
> **P5 — physics.** Whatever currently has focus must be *visibly* marked. Removing
> the platform's focus indicator without supplying a replacement is a defect with no
> legitimate variant.
>
> **P6 — ergonomics.** The element that receives focus is a *decision*, not a
> side-effect of DOM order. A surface declares its initial focus target; falling back
> to "first focusable" is the default, not the answer.
>
> **P7 — ergonomics.** When content is replaced asynchronously and the focused node
> disappears with it, focus must be placed deliberately on the replacement. Left
> alone it falls to the document root and the keyboard user restarts from the top.
>
> **P8 — ergonomics.** Focus timing is a frame-ordering problem, not a duration
> problem. Wait for the frame the element exists in; never guess a millisecond count.
>
> **P9 — house convention, with evidence of need.** Every global key handler
> declares its position relative to the other surfaces competing for the same key.
> *This clause was not independently reinvented anywhere* — the sibling repo has 22
> scattered listeners, no ordering, and uses `stopPropagation()` as a manual
> stand-in, with its "am I typing?" guard forked three ways under two different
> definitions. That is evidence the **problem** is universal and the **solution**
> here is local. Adopt it as a proposal, not as received doctrine.
>
> **Scale condition.** P1–P5 and P7–P8 pay from the first surface. P4's shared
> primitive pays from about the third peer-group; P9's registry pays from about the
> fifth surface that binds a global key.

**Warrant evidence.** P2, P3, P4, P5 and P6 were each independently re-derived in
`personas-web`, a Next.js repo with no shared code, no focus library in its
dependency tree, and no sight of this document: **6 separate focus-trap
implementations** (`src/hooks/useFocusTrap.ts` plus five copies), **6 tab bars all
using the same roving-`tabIndex` idiom** (four carrying "mirroring X" comments),
an `initialFocusRef` prop that surfaced *after* three copies had open-coded it as
`setTimeout(…, 50)` / `setTimeout(…, 100)` / `queueMicrotask`, a detached-node guard
for restoration (`useDialogFocusTrap.ts:65-90`), and a global `*:focus-visible`
backstop (`globals.css:763-768`). Six mechanics, two stacks, no shared document.

---

## 1. Trigger

- "Open a detail drawer / modal / picker when this row is clicked."
- "Make this list navigable with the arrow keys." / "Add j/k to the inbox."
- "Focus the search box when the palette opens."
- "After the run finishes, put the cursor in the answer field."
- "This card should be clickable." / "Make the whole row a click target."
- "Add a tab bar / segmented toggle / filter pill group here."
- **If you are about to write** `.focus()`, `tabIndex=`, `autoFocus`,
  `document.activeElement`, `addEventListener('keydown'`, `cursor-pointer` next to an
  `onClick`, or `outline-none` — you are in this situation.

---

## 2. The one way

Focus is owned by a primitive, never by a feature. If the surface is an overlay,
render it with `BaseModal` and stop — it captures the trigger, moves focus in on the
next frame, cycles Tab inside the panel and restores focus on close, and
re-implementing any of that on top of it is a bug, not hardening. If the surface is a
list of peer controls — a tab strip, a segmented toggle, a row list, a listbox — it is
**one** tab stop with arrow keys inside it, and the group must own both the roving
`tabIndex` and the real `.focus()` call: reach for `PanelTabBar` / `SegmentedTabs`
horizontally, and `UnifiedTable` (whose `navigable` is *derived* from `onRowClick`, so
you cannot ship a clickable row without a keyboard path) for record lists; copy
`IssuesList.tsx:52-68` when you genuinely need a bare vertical listbox, and give index
`0` the tab stop at rest. Never make an element look operable with `cursor-pointer` and
an `onClick` without giving it a way to be reached — use a real `<button>`. Register
every global key binding through `useAppKeyboard` with a priority from the ladder, never
a bare `window`/`document` listener, so one keypress cannot mean two things. When focus
must be moved by hand, wait a `requestAnimationFrame` — never a guessed `setTimeout`
delay — declare the target explicitly rather than accepting "first focusable", give any
non-interactive landing target `tabIndex={-1}`, and re-place focus deliberately whenever
async content replaces the node that had it. Every focusable element carries the
`focus-ring` utility, and `outline-none` without a replacement indicator is never
correct.

---

## 3. Mandated primitives

- **`src/lib/ui/BaseModal.tsx` — `BaseModal`** — the overlay focus owner. Captures
  `document.activeElement` into `triggerRef` (`:185`), focuses the first focusable
  descendant on the next animation frame (`:187-195`), cycles Tab across the panel at
  keyboard priority 80 gated to the topmost modal (`:198-227`), restores to the trigger
  when `isOpen` goes false (`:229-233`). **129 call sites across 128 files.** See
  [`modals.md`](./modals.md) for everything else it owns; this path covers only the
  focus contract, and Gaps 1–3 below are the parts of it that are incomplete.
- **`src/lib/keyboard/AppKeyboardProvider.tsx` — `useAppKeyboard(handler, { priority, exclusive, enabled })`** —
  the single ordered `keydown` registry. One `window` listener (`:83`); handlers run
  highest-priority-first and stop when one returns `true`; `exclusive: true` swallows
  everything a full-app decision surface did not consume (`:63-85`). Ladder documented at
  `:27-42`; `ROUTE_DECISION_PRIORITY = 10` at `:98`.
- **`src/features/shared/components/layout/PanelTabBar.tsx`** and
  **`.../SegmentedTabs.tsx`** — the two correct horizontal roving-tabindex
  implementations. `PanelTabBar:73-89`: `role="tablist"`, `role="tab"`,
  `tabIndex={active ? 0 : -1}`, `←→ Home End` skipping disabled, and a real `.focus()`
  on the new tab. `SegmentedTabs:75-99,107,126` adds `↑↓` and is the more complete of
  the two.
- **`src/features/shared/components/display/UnifiedTable.tsx`** — record lists.
  `const navigable = !!onRowClick` (`:543`, `:751`) is the type-level move: a clickable
  row gets a container tab stop (`:642,:671,:783`), `↑↓` cursor movement, `Enter` to
  activate, and a visible `ring-1 ring-inset ring-primary/40` (`:564`) **by
  construction**, with no second prop to forget.
- **`src/features/overview/sub_observability/components/IssuesList.tsx:52-68`** — the
  reference *vertical* roving listbox: `role="listbox"` → `role="option"` +
  `aria-selected` + `tabIndex={focusedIndex === index ? 0 : -1}` + `rowRefs[next].focus()`
  + `Enter`. Copy this shape; fix its one bug (Gap 5) when you do.
- **`src/features/agents/quick-answer/triage/deck/useDeckDialog.tsx`** — the reference
  implementation of the *complete* contract for a non-`BaseModal` full-app surface:
  declared initial focus target (`:73-80`), Tab cycling that also recovers from focus
  having escaped to `<body>` (`:120-146`), restore in the effect **cleanup** so it
  survives unmount (`:83-96`), and `recoverFocus()` (`:98-107`) for when async content
  takes the focused node with it. It is the answer to P3, P6 and P7 in one file.
- **`src/features/shared/components/forms/FormErrorSummary.tsx:27-36` — `jumpTo`** —
  the sanctioned "send focus to the offending field" move, with
  `focus({ preventScroll: true })` paired with an explicit `scrollIntoView`.
- **`globals.css:11-15` — the `focus-ring` Tailwind utility** — `:focus-visible`
  outline driven by `--focus-ring-color/-width/-offset` (`:406-408`), so every theme
  and custom vibe gets a correct ring. Mandated by `.claude/Design.md:330-331,366`.
- **`eslint-rules/role-button-requires-keydown.cjs`** — registered at **error** in
  `eslint.config.js:106`. Currently the only machine check touching this situation. It
  checks for `onKeyDown`; it does not check that the element can be focused at all
  (Gap 7).

**Deliberately not mandated:** `src/hooks/utility/interaction/useRovingTabIndex.ts`.
See Gap 4 — it has zero adopters and cannot deliver the pattern.

---

## 4. Steps

1. **Classify the surface first.** Overlay (modal / drawer / picker) → step 2.
   Group of peer controls (tabs, segments, rows, options) → step 4. Single control →
   step 6. Async region → step 7.
2. **Overlay: use `BaseModal` and add nothing.** Do not write an Escape listener, a Tab
   handler, a focus capture, or a restore effect. All four exist at `BaseModal.tsx:183-233`,
   and the app's 23 hand-rolled overlays are the proof that rebuilding the shell means
   losing all of them — 0 of the 23 have a trap or a restore.
3. **Overlay: keep the modal component mounted while `isOpen` flips.** `BaseModal`
   restores focus in an effect keyed on `isOpen` (`:229-233`), not in a cleanup. If your
   parent does `{open && <MyModal/>}`, or your component does
   `if (!isOpen) return null` above the `<BaseModal>`, the effect never runs and focus
   lands on `<body>`. Render `<BaseModal isOpen={open}>` unconditionally and let it
   handle the closed case. (9 sites get this wrong — see Deviations.)
4. **Group: pick the primitive, do not hand-roll the group.**
   Horizontal tabs → `PanelTabBar` or `SegmentedTabs`. Record list → `UnifiedTable`.
   Vertical option list → copy `IssuesList.tsx:52-68`.
5. **Group, if you must hand-roll: satisfy all four clauses or none of it works.**
   (a) container `role`; (b) `tabIndex={isActive ? 0 : -1}` on every item, with **index
   0 active at rest** so the group has a tab stop before any key is pressed; (c) an
   arrow-key handler on the item or the container; (d) a real `.focus()` on the newly
   active item. Shipping (b) without (c) makes every inactive item permanently
   unreachable — `DraftEditStep.tsx:119-129` does exactly this. Shipping (c) without (d)
   makes the cursor invisible to screen readers — `IncidentsInbox.tsx:328-333` does that.
6. **Single control: make it a `<button>`.** If it looks clickable it must be
   focusable. `cursor-pointer` + `onClick` on a `<div>` is the single most common
   keyboard lockout in this repo (38 elements). Naming and ring styling of that button
   belong to [`button.md`](./button.md) — see the boundary note in §7.
7. **Async: place focus deliberately when the node that had it is replaced.**
   Landing target gets `tabIndex={-1}` (`DesignPhaseApplied.tsx:32`,
   `DesignPhasePreview.tsx:85`, `DimensionPanel.tsx:65`, `SigilEditModal.tsx:93` all do
   this correctly) or is already a real control
   (`NegotiatorGuidingPhase.tsx:69-71` → the `<button id={headerId}>` at
   `NegotiatorStepCardHelpers.tsx:60`). If the surface can lose focus mid-session,
   add a `recoverFocus()` on the `useDeckDialog.tsx:98-107` model.
8. **Defer with `requestAnimationFrame`, never `setTimeout`.** The element has to
   exist and be laid out; that is a frame, not a duration. The repo currently holds 14
   `setTimeout`-deferred focus calls at five different guessed delays (0, 50, 80, 100,
   200 ms) — every one of them is a race that happens to win on this machine.
9. **Ask the type question before writing a gate.** For every prop you are about to
   add: *can the signature make the wrong call impossible?* `UnifiedTable`'s
   `navigable = !!onRowClick` is the shipped proof in this repo — one derived boolean
   removed a whole deviation class for that primitive's call sites. A separate
   `keyboardNav` opt-in would have reproduced `Listbox`'s failure, where 3 of 13 call
   sites simply never pass the optional props and silently get no keyboard at all.
10. **Add `focus-ring` and stop.** Do not write `outline-none` unless you are
    replacing the indicator in the same class string. Route every `aria-label` through
    `t.*` per the i18n rule.

---

## 5. Anti-patterns

- **Re-implementing a Tab trap on top of `BaseModal`** — `PeerDetailDrawer.tsx:84-102`
  adds a second trap inside a component that is already wrapped by the primitive's
  priority-80 handler; two handlers fight over the same `preventDefault`, and the local
  copy uses a *weaker* selector (`'button, [href], input, …'` with no `:not([disabled])`),
  so a disabled control becomes a trap boundary.
- **Copying the focusable-selector string instead of the primitive.** Four files carry
  a byte-level copy of `BaseModal`'s selector. Every copy is a fork that will not receive
  the next fix (none of them, for instance, filters elements that are hidden).
- **Roving `tabIndex` with no arrow handler** — the worst possible half-adoption:
  it *removes* the inactive items from the tab order and supplies nothing to replace it,
  so a tab bar becomes 100% keyboard-inoperable. Strictly worse than doing nothing.
- **Moving a selection index without moving focus** — a purely visual cursor. Assistive
  technology is never told anything moved, and `Enter` acts on a row the user cannot
  confirm they are on.
- **`cursor-pointer` + `onClick` on a `<div>`/`<tr>`/`<span>`** — the element advertises
  itself as operable to the mouse and does not exist for the keyboard. `role="button"`
  alone does not fix it: without `tabIndex={0}` the element still cannot be focused, so
  the `onKeyDown` the lint rule demands can never fire.
- **A bare `window`/`document` keydown listener** — it has no position relative to
  anything else. `←` can mean "reject this review" to a route surface and "previous
  image" to a lightbox in the same frame. Two listeners in this repo additionally use
  **capture phase**, which outranks the entire registry regardless of priority.
- **`setTimeout(() => ref.current?.focus(), 80)`** — a guess about layout timing. It
  is a race, the delay is unexplainable, and the five different values in this repo
  prove nobody knows what the right one is.
- **`outline-none` with no replacement** — the one variant of the ring defect with no
  defence. The element is focusable, receives focus, and shows nothing. 32 live sites.
- **Restoring focus to a node that has unmounted** — `.focus()` on a detached element
  silently drops focus to `<body>`. The sibling repo hit this and guards it
  (`useDialogFocusTrap.ts:65-90`); `BaseModal` does not.
- **A generic free-floating focus hook** — a hook that returns helpers the caller must
  wire up correctly does not deliver the pattern; it delivers half of it and gets zero
  adopters. See Gap 4.

---

## 6. Evidence

**The one site to copy for a non-modal surface:**
`src/features/agents/quick-answer/triage/deck/useDeckDialog.tsx`. It is the only
implementation in the repo that satisfies the whole contract, and its header comment
explains why it did not simply reuse `BaseModal` (a full-app surface with no backdrop
and its own entrance). Specifically:

- `:73-80` — `focusFirst` targets a **declared** element (the prose scroller), with the
  first-focusable rule as fallback. The comment states the reasoning: for a
  read-then-rule surface, landing on a filter chip is wrong.
- `:83-96` — trigger capture and restore in the **effect cleanup**, so restoration
  survives unmount. This is the half `BaseModal` is missing.
- `:98-107` — `recoverFocus()`: every verdict remounts the top card and takes the
  focused node with it; without this the trap silently ends after one decision.
- `:120-146` — Tab cycling with the extra `!root.contains(active)` clause, so Tab from
  `<body>` re-enters the panel instead of walking into the route underneath.

**For an overlay:** `src/lib/ui/BaseModal.tsx:183-233` — and then nothing. 129 call
sites get capture, rAF-deferred entry focus, priority-80 topmost-gated Tab cycling and
restore for free.

**For a horizontal group:** `src/features/shared/components/layout/SegmentedTabs.tsx:75-99,107,126,158`
— `←→↑↓ Home End`, disabled-skipping via `focusEnabled`/`focusEdge`, roving `tabIndex`,
real `.focus()`. `PanelTabBar.tsx:51-89` is the same pattern in fewer lines.

**For a vertical group:** `src/features/overview/sub_observability/components/IssuesList.tsx:27-68`
— the complete WAI-ARIA listbox, roving `tabIndex` and `.focus()` included.

**For a record list:** `src/features/shared/components/display/UnifiedTable.tsx:543,564,642,671,751,783`
— `navigable` derived from `onRowClick`; the focus ring is applied by the primitive.

**For the keyboard ladder:** `AppKeyboardProvider.tsx:27-42` (the ladder),
`:63-85` (the dispatch loop and the `exclusive` reasoning),
`useDeckControls.tsx:607` (the only `exclusive: true` adopter, at priority 70),
`ReviewFocusFlow.tsx:217` and `BacklogFocusDeck.tsx:95` (route surfaces at
`ROUTE_DECISION_PRIORITY`), `BaseModal.tsx:198` (`enabled: isOpen` so a closed modal
holds no slot).

**For error focus:** `FormErrorSummary.tsx:27-36`.

**For async landing targets:** `DesignPhaseApplied.tsx:21-32`,
`NegotiatorGuidingPhase.tsx:69-71` + `NegotiatorStepCardHelpers.tsx:60`.

---

## 7. Deviations found

### Boundary with `button.md` — stated, per the leaf brief

`button.md` §9 already owns **the accessible name** (Signal B: 844 unnamed icon
controls, 302 named by `title` alone, `button.md:355-374`) and **the ring on a raw
`<button>`** (Signal C / X3: 2,247 of 2,751, `button.md:225,376-381`). This path does
**not** re-litigate either. The split is:

| Question | Owner |
| --- | --- |
| Does this control have a name? | `button.md` |
| Does this `<button>` have a themed ring? | `button.md` |
| Can focus **reach** this element at all? | **here** |
| Where does focus **go** on open / close / change? | **here** |
| Is the focus indicator **removed** with nothing in its place? | **here** |
| Do arrow keys move focus, and who owns the key? | **here** |

The two populations barely overlap: of the 32 elements with `outline-none` and no
replacement, **31 are not buttons** (19 `input`, 6 `textarea`, 5 `select`, 1 `<g>`), so
`button.md`'s corpus never sees them.

### A. Overlays that own no focus at all — **23 surfaces, 0 traps, 0 restores**

The 23 hand-rolled overlays catalogued in [`modals.md:82-95`](./modals.md), audited here
for focus specifically: **8 move focus in** (`autoFocus` or `.focus()`),
**0 trap Tab**, **0 restore focus on close**. The 15 that do nothing at all —
`ComposerPickerShell.tsx:89` (a full parallel modal primitive with 6 downstream
consumers), `TestReportModal.tsx:68`, `ReportPreviewDrawer.tsx:215`,
`ExperimentRunsDrawer.tsx:47`, `DecisionDrawer.tsx:54`, `FrequencyEditor.tsx:101`,
`ScanOverlay.tsx:31`, `CreatedKeyDialog.tsx:85`, `IngestDirectoryPicker.tsx:77`,
`DisconnectDialog.tsx:20`, `QuickAddCredentialModal.tsx:139`,
`CrossProjectMetadataModal.tsx:301`, `MemoryDetailModal.tsx:35`,
`EventRenameModal.tsx:176`, `ApiKeyAuditDrawer.tsx:68` — open with focus still behind
them and close with focus on `<body>`. `CommandPalette.tsx:410` is the highest-traffic
instance: it focuses its input (`:74`, correctly via rAF) and restores nothing.

### B. Hand-rolled Tab traps — **5, of which 4 should not exist**

| Site | Verdict |
| --- | --- |
| `settings/sub_network/components/PeerDetailDrawer.tsx:84-102` | **on top of `BaseModal`** — duplicate trap; weaker selector (no `:not([disabled])`); also duplicates Escape at `:75-81` |
| `shared/chrome/sidebar/Sidebar.tsx:53-72` | mobile drawer, verbatim selector copy; should be `BaseModal placement="right-drawer"` |
| `templates/.../runner/useDesignRunnerState.ts:63-86` | verbatim copy of `BaseModal.tsx:198-227` including the selector string and the rAF focus-first; straight migration |
| `agents/quick-answer/triage/deck/useDeckDialog.tsx` | **legitimate** — documented superset, and the only complete implementation in the repo |
| `lib/ui/BaseModal.tsx:205-226` | the primitive |

Four files carry a byte-identical copy of the focusable selector string.

### C. Focus restore that can never fire — **9 `BaseModal` sites**

`BaseModal.tsx:229-233` restores in an effect keyed on `isOpen`, not in a cleanup, so
unmounting while open skips it silently.

- `isOpen={true}` (parent unmounts the whole modal on close): `AnomalyDrilldownPanel.tsx`,
  `HealingIssueModal.tsx`, `RecipePlaygroundModal.tsx`.
- `if (!isOpen) return null` above the `<BaseModal>`: `RecommendedModal.tsx`,
  `CreateTemplateModal.tsx`, `DesignReviewRunner.tsx`, `TeamSynthesisPanel.tsx`,
  `SystemEventCommitModal.tsx`, `CredentialDesignModal.tsx`.

### D. Keyboard ownership — **72 of 74 `keydown` listeners bypass the registry**

Against **16** production `useAppKeyboard` adopters, exactly **1** of which sets
`exclusive` (`useDeckControls.tsx:607`).

- **15 bypasses handle arrow keys**, so they compete directly with route surfaces
  for the same press: `Listbox.tsx:152` · `SearchAutocomplete.tsx:114` ·
  `useQuestionnaireKeyboardNav.ts:90` · `ReplaySandbox.tsx:96` · `DrivePage.tsx:324` ·
  `DriveImageLightbox.tsx:178` · `useTimelineKeyboard.ts:122` · `Gallery3D.tsx:90` ·
  `Gallery2D.tsx:262` · `useGuidanceRunner.ts:168` · `useFleetHotkeys.ts:82` ·
  `PracticeDetailModal.tsx:99` · `BacklogDetailModal.tsx:110` ·
  `MessageDetailModal.tsx:172` · `IncidentsInbox.tsx:365`.
- **`Listbox.tsx:152` is the worst**, because it is a *shared primitive*: an open
  Listbox attaches its `↑`/`↓`/`Enter`/`Escape` handling to `document`, so all 13 call
  sites eat those keys app-wide while open.
- **2 use capture phase** and therefore outrank the entire ladder regardless of
  priority: `IngestDirectoryPicker.tsx:42`, `MonitorView.tsx:94`.
- Of **20 queue / deck / list navigation surfaces**, only **3 registrations** use the
  ladder (`useDeckControls.tsx:607` at 70/exclusive, `ReviewFocusFlow.tsx:217` and
  `BacklogFocusDeck.tsx:95` at 10); **11** attach bare listeners.
- **Ladder documentation drift:** `DevInspector.tsx:52` registers at **1000** and
  `TitleBarDock.tsx:35` at **29**; neither appears in the ladder comment at
  `AppKeyboardProvider.tsx:31-41`, which tops out at 100.

### E. Groups that are not one tab stop

**13 `role="tablist"` surfaces — 6 have arrow keys, 7 manage roving `tabIndex`:**

- **`templates/draft-editor/DraftEditStep.tsx:119,129` — the single most severe
  deviation in this document.** Roving `tabIndex={activeTab === tab.id ? 0 : -1}` with
  **no `onKeyDown` anywhere in the file**: every non-active tab is removed from the tab
  order and nothing replaces it, so the tab bar cannot be operated by keyboard at all.
- No arrows, no roving: `CapabilityTagBar.tsx:29` · `CapabilityTagSwitcher.tsx:67` ·
  `CapabilityRowTabs.tsx:63` · `HealingIssuesPanel.tsx:186` ·
  `DriveKnowledgeDrawer.tsx:95` · `passportInk.tsx:145`. Four of these also omit
  `aria-label` on the tablist.
- Partial: `ExecutionDetailTabs.tsx:62` has `←→` but no `Home`/`End`.

**6 tab strips with no ARIA at all** — no `role`, no `tabIndex`, no `onKeyDown`:
`StudioTabBar.tsx:17` · `WorkspaceTabs.tsx:18` · `ModeTabBar.tsx` ·
`AuthMethodTabs.tsx` · `TwinVariantTabs.tsx` · `PrototypeTabs.tsx`.

**15 `role="radiogroup"` segmented controls — 11 have neither arrows nor roving
`tabIndex`:** `PillGroup.tsx:46` (shared, 2 consumers) · `AutopilotControl.tsx:75` ·
`WakeCadence.tsx:64` · `FleetBoldnessDial.tsx:59` · `UnattendedModeSection.tsx:66` ·
`RemoteJobsPanel.tsx:163` · `PairedDevicesPanel.tsx:170` · `DispatchChooser.tsx:138` ·
`GoalEditorModal.tsx:202` · `KPIConnectWizard.tsx:210` · `MeasureSetupModal.tsx:218`.

**Selection without focus:** `IncidentsInbox.tsx:289-333` maintains a `focusedId`
cursor over `j`/`k`/`↑`/`↓` and only calls `scrollIntoView`. There is **no `tabIndex`
anywhere in `sub_incidents/components/`**, so no row is ever focusable, the cursor is
purely visual, and the listener is on bare `window`. `CommandPalette.tsx:360-364`,
`TwinPicker.tsx:162`, `FabricSearch.tsx:65`, `Composer.tsx:233` and `Listbox.tsx:137`
have the same shape — index-only, no DOM focus. Of these, only
`SearchAutocomplete.tsx:114` compensates with `aria-activedescendant`.

**10 near-duplicate roving implementations** exist across the 6 tablists and 4
radiogroups that got it right — each re-deriving `←→ Home End` + `.focus()`.

### F. Elements that cannot be reached — **38 elements / 32 files**

`cursor-pointer` + `onClick` on a non-interactive tag with neither `role` nor
`tabIndex`. Verified precision **37/38**. Two are inside *shared primitives*, so they
cascade to every consumer:

- **`shared/components/display/DataGrid.tsx:262`** — the select-all checkbox is a
  `<div onClick>`. The grid's bulk-select header cannot be operated by keyboard.
- **`shared/components/forms/SettingRow.tsx:64`** — a clickable settings row.

Highest-traffic feature sites: `ExecutionListRow.tsx:103,150` (both list layouts) ·
`MemoryCard.tsx:174,184` · `N8nParserResultsSections.tsx:27,72,126` ·
`ByomApiKeyManager.tsx:361,497` · `TableListSidebar.tsx:107,144` · `SLACard.tsx:83` ·
`LabHistoryTable.tsx:75` · `DomainTable.tsx:110` · `RecipesTableResults.tsx:232` ·
`ToneConsole.tsx:159` · `GoalCard.tsx:37` · `AssetCard.tsx:150` ·
`ComfortableRow.tsx:96` · `CompactRow.tsx:32` · `ConnectorIconButton.tsx:30` ·
`TeamCertCard.tsx:74` · `TimelinePanel.tsx:447` · `TimelineScrubber.tsx:129` ·
`BadgeSlot.tsx:96` · `SidebarGroupNav.tsx:133` · `ReasoningTrace.tsx:23` ·
`AutomationsSection.tsx:125` · `ProjectStep.tsx:37` · `DraftPromptTab.tsx:125` ·
`FixtureDropdownList.tsx:32` · `UseCaseDetailPanel.tsx:237` ·
`IdleSuggestions.tsx:44` · `QuerySidebar.tsx:81` · `CloudWebhooksTab.tsx:250`.

Separately, **3 elements carry an interactive `role` with no `tabIndex`**, so the role
is a lie: `FabricSearch.tsx:127` (`<li role="option">`), `TeamGraphPreview.tsx:163`
(`<g role="button">`), `DragHandle.tsx:42` (`<span role="button">`).

### G. Focus indicator — **the theming half, and the 32 that are worse**

Measured over `src/**/*.tsx` (tests excluded), counting native focusables plus
`tabIndex={0}` plus interactive `role=` — a superset of `button.md`'s button-only
population:

| | count | share |
| --- | ---: | ---: |
| focusable DOM elements | **3,422** | |
| carrying the themed `focus-ring` utility | 537 | 15.7% |
| carrying **any** focus indicator | 825 | 24.1% |
| relying on the UA default outline | 2,565 | 74.9% |
| **`outline-none` with no replacement — focus invisible** | **32** | 0.9% |

`.claude/Design.md:366` says "Add `focus-ring` to every interactive element."
Compliance is **15.7%**. Only **16 of 140** files under
`src/features/shared/components/` use it — the primitive layer does not model its own
rule.

The 32 invisible-focus sites, in 24 files: `ActivityFilters.tsx:79,92,106` ·
`ByomRoutingRules.tsx:69,96,108,122` · `ByomComplianceRules.tsx:83,112` ·
`CommandPanelComposeStep.tsx:95,105` · `CommandPanelMessagingRow.tsx:158` ·
`CommandPanelToolsRow.tsx:68` · `CommandPanelWhenRow.tsx:98` ·
`CapabilityRowHeader.tsx:32,39` · `PersonaSelector.tsx:103` ·
`PersonaSelectorModal.tsx:96` · `DialogueComposePanel.tsx:155` ·
`AddToScopeModal.tsx:60` · `TagEditorModal.tsx:114` · `Composer.tsx:310` ·
`DevToolsProjectDropdown.tsx:90` · `GitHubRepoSelector.tsx:218` ·
`GenerateHypothesesModal.tsx:191` · `TwinPicker.tsx:213` · `CommandPalette.tsx:421` ·
`TerminalSearchBar.tsx:83` · `StickyNoteNode.tsx:127` · `DraftEditStep.tsx:107` ·
`N8nUploadStep.tsx:203` · `ChannelMap.tsx:242`.

### H. Deferred focus by guesswork — **14 sites, 5 different delays**

`ComposerConnectorsPickerModal.tsx:57` (80ms) · `ComposerEventPickerModal.tsx:56` (80) ·
`ComposerMessagingPickerModal.tsx:139` (80) · `GitHubRepoSelector.tsx:199` (50) ·
`useTrainingSession.ts:217,266` (100) · `ThemedSelect.tsx:115` (0) ·
`AutoTeamModal.tsx:37` (100) · `QuestionnaireFormGrid.tsx:127` (200) ·
`SelectPills.tsx:77` (50) · `ComponentFilterDropdown.tsx:40` (50) ·
`ConnectorFilterDropdown.tsx:36` (50) · `useCredentialTags.ts:60` (0) ·
`PlaygroundHeader.tsx:181` (0).

Against **6** correct `requestAnimationFrame` sites (`QuickEditPanel.tsx:31`,
`DriveToolbar.tsx:144`, `TwinPicker.tsx:146`, `CommandPalette.tsx:74`,
`Listbox.tsx:123`, `NegotiatorGuidingPhase.tsx:71`) plus `BaseModal.tsx:194` and
`useDeckDialog.tsx:85`.

**`autoFocus`: 99 occurrences across 80 files** — not itself a defect (React's
`autoFocus` is applied on mount, not the HTML attribute), but it is untyped as a
*decision*: `ConfirmDestructiveModal.tsx:121` uses it to override `BaseModal`'s
first-focusable rule, which is exactly the declared-initial-target need that Gap 1
should make a prop.

---

## 8. Gaps in the primitives

1. **`BaseModal` cannot be told where focus should land.** It always takes the first
   focusable descendant (`:187-192`), which for a `DetailModal`-shaped panel is the
   close button. There is no `initialFocusRef`. Consequences: `useDeckDialog` was
   written partly to get this (`:73-80`, with the reasoning in its comment), and 99
   `autoFocus` attributes are the informal workaround. **The sibling repo's
   `useFocusTrap.ts:25-30` has exactly this prop** — independent confirmation the API
   is missing here, not merely nice to have.
2. **`BaseModal` restore does not survive unmount.** `:229-233` is an effect keyed on
   `isOpen`, not an effect cleanup. Nine sites (Deviation C) therefore never restore.
   `useDeckDialog.tsx:83-96` shows the two-line fix: capture on mount, restore in the
   cleanup.
3. **`BaseModal` restore does not guard a detached node.** `triggerRef.current?.focus()`
   on an unmounted element silently drops focus to `<body>` — common when the trigger
   was a row in a list the modal's own action re-sorted. `personas-web`'s
   `useDialogFocusTrap.ts:65-90` independently found and fixed this (fall back to the
   page heading with a temporary `tabIndex={-1}`).
4. **`useRovingTabIndex` cannot deliver the pattern, which is why it has zero
   adopters.** Measured: **0 call sites** anywhere in `src/**`.
   Three reasons, all structural:
   (a) despite the name it **never sets `tabIndex`** — it returns `setRef` and
   `onKeyDown` only (`useRovingTabIndex.ts:14-49`), leaving the hardest and most
   error-prone half to the caller, which is precisely the half `DraftEditStep` and the
   11 radiogroups got wrong;
   (b) it is **horizontal-only** (`ArrowLeft`/`ArrowRight`/`Home`/`End`), so no vertical
   list can use it;
   (c) it is a **free-floating hook**, so it competes with "just write the switch
   statement" and loses — 10 groups re-derived the same logic rather than adopt it.
   The fix is not a better hook. It is (i) fold the horizontal case into
   `PanelTabBar`/`SegmentedTabs`, which already own it correctly, and (ii) put the
   vertical case **inside `Listbox`**, modelled on `IssuesList.tsx:52-68`. A free hook
   is what produced zero adopters the first time.
5. **`Listbox` implements a keyboard model that is optional, global, and mute.**
   (a) `itemCount` and `onSelectFocused` are optional — **3 of 13 call sites**
   (`AddChannelButton.tsx:22`, `UseCaseChannelDropdown.tsx:15`,
   `RemoteInstructionComposer.tsx:65`) pass neither and get no keyboard navigation at
   all, and `itemCount` is a hand-passed number that can silently drift from the number
   of items actually rendered by the render-prop child;
   (b) the handler is attached to `document` (`:152`), not to the input, so an open
   Listbox eats arrows app-wide;
   (c) the popup declares `role="listbox"` (`:206,:219`) with **no `role="option"`, no
   `aria-selected` and no `aria-activedescendant` anywhere in the file** — `focusIndex`
   is a purely visual highlight.
   `IssuesList.tsx:52-68` already contains the correct model, in a feature folder.
6. **`IssuesList`'s roving pattern has no entry point.** `focusedIndex` initialises to
   `-1` (`:16`), so every option renders `tabIndex={-1}` and the container
   (`role="listbox"`, `:52`) has no `tabIndex` of its own. At rest the whole listbox is
   outside the tab order, and the arrow handler that would fix `focusedIndex` can never
   receive a key. Index 0 must hold the tab stop by default. **This is the strongest
   argument in the document for a primitive over a convention: the repo's most correct
   hand-rolled implementation still got the entry wrong.**
7. **`custom/role-button-requires-keydown` checks the wrong half.** It requires
   `onKeyDown` on `role="button"` + `onClick` (`role-button-requires-keydown.cjs:47-63`)
   and never checks `tabIndex`. An element that cannot be focused cannot receive
   `keydown`, so the rule can pass on a control that is completely inoperable
   (`DragHandle.tsx:42` is exactly this shape). It also cannot see the far larger
   population that carries no `role` at all — the 38 elements in Deviation F.
   **There is no `jsx-a11y` plugin in `eslint.config.js`;** 21 custom rules, one of
   which touches focus, and it is the incomplete one.
8. **There is no global focus-indicator backstop.** `globals.css` contains **no
   `*:focus-visible` rule**; the only global focus styling is scoped to
   `input[type="range"]` (`:1179-1193`) and one glyph petal (`:1731`). The `focus-ring`
   utility (`:11-15`) is entirely opt-in, and opt-in produced 15.7% compliance against
   an explicit written mandate. `personas-web` solved the same problem structurally
   with `*:focus-visible { outline: 2px solid …; outline-offset: 2px }`
   (`globals.css:763-768`), which is why its only genuinely unringed control is a
   single input. **One CSS rule converts 2,565 convention-dependent elements into
   structurally-covered ones and reduces the real deviation set to the 32 explicit
   opt-outs.** This is the highest-leverage change in this document.
9. **The ladder is documentation, not a type.** `priority` is a bare `number`
   (`AppKeyboardProvider.tsx:120`), so 1000 and 29 entered the codebase without
   appearing in the ladder comment, and nothing prevents a fifth surface claiming 80
   and fighting `BaseModal`. A `KeyboardLayer` union (`'overlay' | 'route' | 'chrome'
   | …`) mapped to numbers internally would make an undocumented priority
   unrepresentable.
10. **Nothing tests any of this.** The only focus tests in the repo are
    `triage/__tests__/deckDialog.test.tsx` (trap cycling and trigger restore) and
    `deckKeyboardOwnership.test.tsx`. `BaseModal` has no test asserting entry focus,
    Tab cycling or restore, so Gaps 1–3 could be fixed and regress unnoticed.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The
conditions are stated first so an adopting repo can re-derive its own proxies rather
than inherit these — the portability test measured four ported signals at **zero** true
positives each.

Everything in §7 shipped under a green `npm run check`. The one existing rule
(`custom/role-button-requires-keydown`, at **error**) reports clean while 38 elements
are keyboard-unreachable and 72 key handlers are unordered, because it checks a
condition that is neither.

### Semantic conditions, stated stack-free

- **C1 — a key handler with no declared position** relative to the other surfaces
  competing for the same key. *Proxy here:* a `keydown` listener attached to
  `window`/`document` outside the registry. *Precondition:* this repo owns an ordering
  mechanism. A repo without one (like `personas-web`, 22 scattered listeners) would
  find this rule fires on 100% of sites and should read that as the finding, not
  baseline it.
- **C2 — an element the UI presents as operable that the keyboard cannot reach.**
  *Proxy here:* `cursor-pointer` + `onClick` + no `role` + no `tabIndex` on a
  non-interactive tag. *Precondition:* this repo signals clickability with the
  `cursor-pointer` utility class. A repo using a styled-component or a hover token must
  re-derive the proxy — this is exactly how `tables.md`'s `role="columnheader"` signal
  scored zero on the sibling.

### Conditions deliberately NOT given a rule

- **C3 — the focus indicator is removed with nothing in its place** (32 sites).
  Do not gate this. **Fix Gap 8 instead:** one `*:focus-visible` backstop in
  `globals.css` makes the defect structurally unreachable except by explicit
  `focus-visible:outline-none`, which is then a 32-site cleanup, not a standing gate.
  A ratchet on a condition a stylesheet can eliminate is wasted enforcement.
- **C4 — a group of peer controls that is not one tab stop.** No honest regex proxy
  exists: the deviation is the *absence* of an arrow handler near a `role="tab"`,
  which the census's whole-file matching cannot express without either a
  file-granularity false-positive storm or an AST. This belongs in an ESLint rule
  (`custom/roving-group-requires-arrows`, keyed on a `role="tablist"`/`"radiogroup"`
  JSXElement whose subtree has `tabIndex` but no `onKeyDown`) — 13 + 15 candidate
  elements, and `role-button-requires-keydown.cjs` is the working precedent for the
  AST shape. Recorded here as the follow-up; it is not shipped with this path.

### The rules — validated

Both validated at commit-time working tree with
`node scripts/census/run-census.mjs --rules <tmpfile> --check` → **exit 0**.

```json
{
  "rules": [
    {
      "id": "unregistered-key-handler",
      "goldenPath": "docs/concepts/golden-paths/focus-management.md",
      "title": "Global keystroke handler registered outside the app keyboard ladder",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "addEventListener\\(\\s*['\"]key(?:down|up|press)['\"]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a keystroke listener attached straight to window/document. PROXY FOR the stack-free condition: a key handler that has no declared position relative to the other surfaces competing for the same key, so one press can be interpreted twice. PRECONDITION: this repo owns an ordering mechanism (AppKeyboardProvider) that the handler could have used; a repo without one must re-derive a different proxy (see the golden path section 9)."
      },
      "exclude": [
        {
          "path": "src/lib/keyboard/AppKeyboardProvider.tsx",
          "reason": "the registry itself plus its no-provider fallback - the two listeners this rule routes every other caller into"
        }
      ],
      "baseline": { "files": 72, "matches": 72 },
      "floor": 4000
    },
    {
      "id": "unfocusable-click-target",
      "goldenPath": "docs/concepts/golden-paths/focus-management.md",
      "title": "Element presented as clickable that can never receive keyboard focus",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<(?:div|span|li|tr|td|section|article|nav|header|aside|figure)(?![A-Za-z0-9])(?:(?!<|\\btabIndex\\b|\\brole=)[\\s\\S]){0,700}?(?:onClick(?:(?!<|\\btabIndex\\b|\\brole=)[\\s\\S]){0,700}?cursor-pointer|cursor-pointer(?:(?!<|\\btabIndex\\b|\\brole=)[\\s\\S]){0,700}?onClick)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a non-interactive tag carrying BOTH a click handler AND cursor-pointer, with neither tabIndex nor role in the same opening tag. PROXY FOR the stack-free condition: an element the UI presents as operable that the keyboard can never reach. cursor-pointer is the load-bearing half - it separates a real control from an event shield or a card that merely happens to have an onClick. PRECONDITION: this repo signals clickability with the cursor-pointer utility class; a repo that signals it another way (a styled-component, a hover token) must re-derive the proxy. Measured precision 37/38 on the 2026-08-14 corpus - the one false positive is CreateMemoryForm.tsx:30, where role=slider and tabIndex=0 sit AFTER cursor-pointer in the tag so the negative lookahead completes before reaching them."
      },
      "exclude": [
        {
          "path": "src/features/shared/components/display/UnifiedTable.tsx",
          "reason": "the primitive already solves this - a single tabIndex={0} scroll container (:642, :671, :783) owns the tab stop and moves a focusedIndex with arrow keys, so its rows are deliberately not individually focusable"
        }
      ],
      "baseline": { "files": 32, "matches": 38 },
      "floor": 2000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   unregistered-key-handler     72     72       72     72    4829   4000
  OK   unfocusable-click-target     32     32       38     38    2104   2000
  census OK — 2 rule(s), 6933 file-visits, 110 surviving violation(s) across 104 file(s).
```

### How each fails loudly if its own precondition is absent

Both inherit the runner's structural contract (`run-census.mjs:19-38`), and both were
tested against it rather than assumed:

- **Matcher stops matching** → `pattern` replaced with a token that appears nowhere,
  baseline left at 72: **exit 1**, `[structural] matched zero files anywhere. A census
  rule that finds nothing is a broken regex far more often than a finished migration.`
- **Walk stops seeing the corpus** → `floor` raised to 9,000: **exit 1**,
  `[structural] walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE
  CODEBASE CLEAN — roots ["src"] or extensions [".tsx"] no longer describe this repo.`
- **A count silently drops** without `--update`: fatal under `--check`, because a drop
  is a broken matcher more often than it is fixed code.
- **A stale `exclude`**: if `AppKeyboardProvider.tsx` or `UnifiedTable.tsx` is ever
  moved or renamed, the exemption matches nothing and the run fails rather than
  quietly widening.

Floors are set below the observed walk (4,829 `.ts`+`.tsx`; 2,104 `.tsx`) with margin,
consistent with `raw-select` and `raw-web-storage`, which use the same roots.

### Sequencing

1. **Gap 8 first** — one `*:focus-visible` rule in `globals.css`. It is the only change
   here that removes a defect class instead of counting it.
2. **Gaps 1–3** — `initialFocusRef`, restore-in-cleanup, detached-node guard on
   `BaseModal`. Three small edits to one file that pay out across 129 call sites, and
   all three are independently confirmed by the sibling repo's implementation.
3. **The two census rules**, which then ratchet D and F while the backlog is worked.
4. **Gap 5 and Gap 6** — fold the vertical roving model from `IssuesList` into
   `Listbox`, with the entry-point bug fixed; retire `useRovingTabIndex`.
5. **C4's ESLint rule** last, once the primitives it would route people to are correct.

---

## Type over gate — the answer

**Yes, and the repo already contains the proof.**

`UnifiedTable.tsx:543` — `const navigable = !!onRowClick` — is the shape. Keyboard
navigability is not a prop the author can forget; it is *derived from the prop that
made the row interactive in the first place*. Every `UnifiedTable` call site with a
clickable row gets a container tab stop, arrow-key movement, `Enter` activation and a
visible focus ring, with no second decision to get wrong. The contrast is exact and
measurable: **38 hand-rolled clickable elements have `cursor-pointer` and `onClick` and
no keyboard path**, because a raw `<div onClick>` has no signature to derive anything
from. This is the same finding the contract records for `FacetedDecisionTable`'s
required `emptyTitle` (3/3) versus its optional-prop siblings (5 of 20 falling through),
and `Listbox` is the local counter-example that confirms it: its `itemCount` and
`onSelectFocused` are optional, and **3 of 13 call sites silently ship with no keyboard
navigation at all.**

So the general rule for this situation is: **the prop that makes something interactive
and the prop that makes it focusable must be the same prop.**

The leaf asks specifically whether a focusable-surface primitive could own focus by
construction — one that cannot be mounted without declaring its initial focus target
and its restore target. The honest answer, measured, is **partly, and the two halves
have different answers**:

- **Restore target: yes, and it should not be a prop at all.** The restore target is
  never a decision — it is always "whatever had focus when this opened". Making it a
  required prop would invite call sites to get it wrong. The correct type move is to
  make it *impossible to omit*: capture in the mount effect and restore in that
  effect's **cleanup**, so restoration is bound to the component's lifetime rather than
  to a `isOpen` transition an unmounting parent can skip. `useDeckDialog.tsx:83-96`
  already does this; `BaseModal.tsx:229-233` does not, and that difference alone is
  Deviation C's nine sites. This is a type-level fix disguised as a two-line edit —
  it moves the guarantee from "the caller keeps the component mounted" to "React
  runs cleanups", which is not negotiable.

- **Initial focus target: make it a prop, but do not make it required.** A required
  `initialFocusRef` on `BaseModal` would be a 129-site migration whose most common
  answer is the existing default, and a required prop whose right answer is usually the
  default trains people to pass junk. The evidence for the softer call is direct: the
  sibling repo shipped `initialFocusRef` as optional and **2 of 6 consumers pass it** —
  which is the correct ratio, because the other four genuinely want first-focusable.
  What *is* worth typing is the escape hatch: today the only way to override
  `BaseModal`'s choice is `autoFocus` (99 occurrences), which is invisible to the
  primitive, cannot be validated, and races its `requestAnimationFrame`.

- **Where a type cannot reach: the focus ring.** No signature can require a CSS class.
  The structural equivalent is not a type but a **default in the cascade** — the
  `*:focus-visible` backstop of Gap 8. Convention produced 15.7% compliance against an
  explicit written mandate; one stylesheet rule makes the failure mode
  "someone explicitly opted out" instead of "someone forgot", which is the same
  inversion a required prop achieves, obtained where props do not apply.

- **Where a type would help but is not yet available: the ladder.** `priority: number`
  should be `layer: KeyboardLayer`. A bare number let 1000 and 29 into the codebase
  without either appearing in the ladder doc, and nothing stops a future surface
  claiming 80 and silently fighting every modal's Tab trap.

The gate in §9 is the ratchet that holds the line on the 72 unordered handlers and the
38 unreachable elements **until** Gaps 1–3, 5, 6 and 8 land. It is not the answer; it
is what keeps the answer from being undone while it is being built.
