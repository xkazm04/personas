# Golden path — Tooltip

> Situation node: `ui-system/overlays/tooltip` (recurrence 120) · [situation spine](../situation-spine.md)
> Composed 2026-08-14 at `2a874e692`. Sweep: **2,104 `.tsx` files** walked and parsed
> (44,315 JSX opening tags read through a brace/quote-aware tag scanner, not grepped),
> plus full reads of `Tooltip`, `TruncateWithTooltip`, `FieldHint`, `Button`,
> `AsyncButton`, `CopyButton`, `StatCard`, `AbsoluteTime`, `RelativeTime`,
> `QuickEditPopover`, `PopoverPositioner`, `useViewportClamp`, `formatters.ts`,
> `designTokens.ts`, all 21 custom ESLint rules, all 48 census rules, and a
> convergence census of **two** sibling repos (`personas-web`, `brainiac/console`).
> Dimensions: **ui · function** (+ i18n and code-quality, which the evidence forced in).
> **Settles:** how explanatory text is attached to a control or a truncated value —
> and who can reach it.
>
> Corpus counts (`.tsx` file totals, lint baseline) are cited from
> [`shared-facts.json`](../shared-facts.json); everything else was measured during
> composition. Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md)'s recommendations #1 and #2,
the head is physically separated and every clause carries its **warrant**, so an
adopting repo can tell physics from local calibration. No file path, primitive name or
count appears below this line until the head ends.

> **P1 — physics.** A tooltip is *supplementary*. If the information exists nowhere
> else, it is not a tooltip — it is content, and it belongs in the layout. The moment a
> tooltip becomes the only route to a fact, every user who cannot hover has lost that
> fact permanently.
>
> **P2 — physics.** Whatever reveals a tooltip on hover must reveal it on keyboard
> focus. Hover and focus are one trigger with two spellings; implementing one is
> implementing half a control.
>
> **P3 — physics.** The trigger must be an element that can *receive* focus. Attaching
> focus handlers to a wrapper does not make the thing inside it focusable, and a tooltip
> on an inert element is a mouse-only affordance no matter how correct its handlers are.
>
> **P4 — physics.** The description must be bound to the **element that receives
> focus**, not to a container around it. Description relationships do not flow downward
> to descendants; a description attached one level out is announced to nobody.
>
> **P5 — physics.** The binding must exist *when focus arrives*. Assistive technology
> computes an element's description at the moment focus lands; a relationship that
> appears afterwards is never spoken, because nothing re-announces it.
>
> **P6 — physics (WCAG 1.4.13).** Content revealed by hover or focus must be
> **dismissable** without moving focus, **hoverable** without vanishing, and
> **persistent** until dismissed or the trigger is left. All three, or the pattern
> fails — and dismissability is the one that is never discovered by using the product,
> only by reading the requirement.
>
> **P7 — physics.** A surface the user can *act inside* is not a tooltip. Announcing it
> as one lies to assistive technology about whether its contents can be reached, because
> a tooltip's contract is that it holds nothing operable.
>
> **P8 — ergonomics.** Tooltip text is user-facing copy on the same footing as a label.
> It is translated, or the product is half-translated.
>
> **P9 — ergonomics.** A tooltip is one channel, not two. A control that carries both a
> platform-rendered tip and an application-rendered tip shows both at once.
>
> **P10 — house convention, with evidence of need.** The trigger declares an intent
> delay so incidental pointer travel across a dense surface does not strobe. *This clause
> was reinvented in neither sibling repo* — both reveal instantly. Adopt it as a
> proposal, not as received doctrine; it pays only once a surface is tooltip-dense.
>
> **Scale condition.** P1–P8 pay from the first tooltip. P9 only exists once a shared
> primitive does. P10 pays from roughly the first table with a tip per row.

**Warrant evidence.** P2, P3, P4, P6-hoverable and P8 were each independently re-derived
in a sibling repo with no shared code, no tooltip library in its dependency tree, and no
sight of this document. `personas-web` reached hover+focus parity on its one hand-rolled
tooltip and separately built a touch fallback (`[@media(hover:none)]:opacity-100`) for a
hover-revealed affordance, and its i18n tooling enumerates `title` as a user-facing
attribute alongside `aria-label`/`alt`/`placeholder`. `brainiac/console` deliberately
built its tooltip trigger out of its `Button` primitive *in order to* inherit a real
focusable control, wrote the reasoning into the file, chose a hoverable popup over
`pointer-events-none`, and binds descriptions directly onto its `<input>`/`<textarea>`
elements rather than onto wrappers. Two stacks, no shared document.

**P7 is warranted by a defect, which is stronger.** Both this repo and `personas-web`
independently shipped `role="tooltip"` on a surface containing focusable controls. A
mistake reinvented in two codebases is a hazard in the problem, not carelessness in one
team.

**P6-dismissable is warranted by nothing, and that is the finding.** Escape-to-dismiss
appears in **neither** sibling — 0 of 2, plus 193 of 194 sites here. By the contract's
convergence heuristic a clause with no trace anywhere should be suspected of local
calibration. It survives anyway, on the reduced-motion path's reasoning: for an
accessibility floor, codebases agreeing is evidence about **the shape of the problem**,
not a licence to relax. The shape is legible in the split — every clause the siblings
*did* reinvent is one you discover by noticing a broken interaction; every clause they
missed (dismissal, delay, the description binding) is one you only get from reading the
specification. Convergence measures discoverability. It does not measure whether the
requirement is real.

---

## 1. Trigger

- "Add a tooltip explaining what this metric / toggle / status dot means."
- "This name is truncated — show the full value on hover."
- "Explain why this button is disabled."
- "Put a little (i) next to the field with the valid range."
- "Show the full timestamp when they hover the '2h ago'."
- "The icon button needs a label on hover."
- **If you are about to write** `title=`, `role="tooltip"`, `cursor-help`,
  `group-hover:opacity-100` on an absolutely-positioned box, or
  `onMouseEnter={() => setShowTip(true)}` — you are in this situation.

### Scope: this path does NOT absorb `anchored-popover` — the seam, stated

`ui-system/overlays/anchored-popover` (recurrence 74) is unwritten and shares this
subdomain. **It is a different procedure.** The seam, in the form of the precedents
(`new-ipc-command` split from `command-naming-placement` on *"does this decision have a
wire consequence"*; `repository-crud-surface` split from `partial-update-semantics` on
*"exterior vs one statement inside"*):

> **Can the user act inside the surface?**
> **No → tooltip (here). Yes → anchored popover (there).**

The answer is not a matter of taste; it changes every other decision in the document:

| | Tooltip (**here**) | Anchored popover (**there**) |
| --- | --- | --- |
| Opened by | hover **and** focus | click / press |
| Takes focus | never | yes — it is a focus surface |
| Dismissal | leaving the trigger, or Escape | an explicit decision: Escape **and** outside-click |
| Pointer events | none — the surface is inert | required — that is the point |
| ARIA | `role="tooltip"` + a description bound to the trigger | `role="dialog"`/`"menu"` + a label |
| Failure if confused | content announced as unreachable becomes unreachable | a hover-revealed surface the user cannot move into |

The measurement backs the seam rather than assuming it. Across the **23** `*Popover*`
files: **0** are hover-triggered, **18 of 22** production files contain interactive
controls, **12** implement outside-click dismissal, **8** implement Escape, **4** declare
`role="dialog"`. Across the tooltip corpus: the surface is `pointer-events-none`
(`Tooltip.tsx:315`) and holds no controls at any of 194 call sites. These are two
populations with opposite properties, not one procedure at two sizes.

**Two live sites sit on the wrong side of the seam, which is what a seam is for.**
`plugins/fleet/FleetFooterPopover.tsx:51` declares `role="tooltip"` on a panel with an
"open the Fleet page" control inside it; `teams/sub_canvas/components/edges/EdgeDeleteTooltip.tsx`
is named a tooltip and is a popover (delete, change-type, outside-click dismissal at
`:37-45`). Both are listed in Deviations, and both are **`anchored-popover`'s** to fix —
this path only names them.

**One thing genuinely belongs to neither path today, and it is handed over explicitly.**
Anchor measurement, viewport clamping, placement flip and portal escape are implemented
**five** independent times: `Tooltip.tsx:71-106`, `useViewportClampFixed`
(`hooks/utility/interaction/useViewportClamp.ts:18`, 5 adopters),
`QuickEditPopover.tsx:45-53`, `templates/sub_diagrams/PopoverPositioner.tsx:23-49`, and
`FieldHint.tsx:26-30`. That is `anchored-popover`'s territory by its own spine entry
(*"Positioning against a trigger, escaping overflow"*). **This path does not propose a
positioning primitive and does not gate positioning** — it records the count so the
spine can assign it. If a shared positioner lands there, `Tooltip` should consume it and
delete `:41-106`.

### Boundary with the two neighbouring written paths

- **[`modals.md`](./modals.md)** already draws the far edge: *"Anchored to a trigger →
  **not a modal**"* (`modals.md:39`) and lists 8 anchored popovers as lint false
  positives (`modals.md:111`). Nothing here re-litigates a backdrop, a focus trap, or
  stack-aware z-index.
- **[`button.md`](./button.md)** owns `title` **as an accessible name** — X2, *"302
  icon-only controls named by `title` alone"* (`button.md:222`), with the standing
  instruction *"add `title` only as a mouse-hover extra"* (`button.md:122,142`). This
  path owns `title` **as a delivery channel for information** — whether the extra is
  reachable at all. The split:

| Question | Owner |
| --- | --- |
| Does this control have a name? Is `title` standing in for one? | `button.md` |
| Can the *supplementary* text be reached by keyboard / touch / AT? | **here** |
| Is it dismissable, hoverable, translated? | **here** |

  The populations are related but the verdicts differ: `button.md` fixes 302 sites by
  adding `aria-label`; this path fixes 1,197 sites by moving the text off the `title`
  channel. Of the 1,197 native titles measured here, **319 already carry an
  `aria-label`** — outside `button.md`'s corpus entirely — and **67** carry a `title`
  whose text *differs* from the `aria-label`, which is precisely the supplementary
  content this path exists to make reachable.

- **[`timestamp-display.md`](./timestamp-display.md)** owns which locale a moment is
  formatted in. This path owns the fact that a tooltip is a locale surface. See §7-E for
  the one recall gap found in its shipped rule — reported, deliberately not re-gated.

---

## 2. The one way

Never write `title=` on a DOM element and never hand-roll a hover box: compose
`Tooltip` from `@/features/shared/components/display/Tooltip`, and wrap a trigger that
can actually take focus — a real `<button>`, `<a>` or input, never a bare `<span>` or
`<div>`, because the primitive's wrapper is `display:contents` and contributes no tab
stop of its own. Put nothing operable inside a tooltip; the instant the user needs to
click something in there it is an anchored popover and this path does not apply. Route
`content` through `t.*` / `tx()` like any other user-facing string, and translate all 14
locales in the same change — including the tooltip on a timestamp, which is a locale
surface exactly like the label it hangs off. Never carry information that exists nowhere
else: if the only way to learn a value is to hover, put the value in the layout and use
the tooltip for the explanation. Do not set `title` on the same element you wrap — you
will ship two tooltips, one of them untranslated. For a field-level explanation reach for
`FieldHint`, for a truncated value `TruncateWithTooltip`, for a disabled control
`Button`'s `disabledReason`, and for a chart cell accept a local hand-roll (the primitive
cannot wrap an SVG node) but give it `role="tooltip"` and keep it inert. Escape
dismissal, the description binding and viewport flipping belong to the primitive — do not
re-implement them, and read §8 first, because three of them are currently incomplete.

---

## 3. Mandated primitives

- **`src/features/shared/components/display/Tooltip.tsx` — `Tooltip`** — the sanctioned
  tooltip. Portal to `document.body` created only while visible (`:309-324`, deliberately
  — the comment at `:304-308` records that an always-mounted portal cost a 250-node grid
  250 idle containers), `role="tooltip"` (`:314`), placement flip when the preferred side
  overflows (`:71-96`), viewport clamp (`:98-106`), a CSS-triangle arrow that tracks the
  trigger centre (`:108-195`), `pointer-events-none` (`:315`), hover-intent delay from
  `MOTION.delay.tooltip` (`:201`), timer-clobber guard (`:216-228`). **194 call sites
  across 130 files.** Its `aria-describedby`, keyboard reach and Escape are **Gaps 2, 3
  and 4** — read them before adopting.
- **`.../display/TruncateWithTooltip.tsx`** — truncated text that reveals the full value
  *only when actually overflowing* (`:29`), and the **only** call site in the repo whose
  trigger is deliberately focusable (`tabIndex={0}`, `:39`). One adopter
  (`plugins/fleet/sub_settings/FleetProcessRow.tsx:39`). Use it for every truncated cell.
- **`.../display/FieldHint.tsx`** — the field-level "(i) explains this input" affordance:
  explanation + valid range + a concrete example, hover **and** focus (`:36-39`), on a
  real `<button>` with `focus-ring` and a translated `aria-label` (`:40-41`). 8 call
  sites. It is a second tooltip implementation — see Gap 1 for why that is currently
  tolerated and what it must inherit.
- **`.../buttons/Button.tsx` — the `disabledReason` prop (`:100`, `:257-275`)** — the
  sanctioned way to explain a disabled control. It is the one construct in the repo that
  solves the inert-trigger problem correctly: `triggerFocusable` turns the wrapper into a
  real tab stop carrying `aria-disabled`, `focus-ring` and Escape, and the comment at
  `:200-204` explains why the button underneath must stay `pointer-events-none`. **Never
  hand-roll a disabled explanation; pass `disabledReason`.**
- **`.../display/AbsoluteTime.tsx` / `RelativeTime.tsx`** — timestamps, which come with a
  tooltip already wired (`AbsoluteTime:67`, `RelativeTime:47-51`). Use them instead of
  building a date tooltip. Both currently invert their own locales — §7-E.
- **`src/lib/utils/designTokens.ts:38-49` — `MOTION.delay.tooltip`** — `fast` 150ms for a
  deliberate help affordance the pointer is already on, `default` 400ms for incidental
  reveals. Take the delay from here; never type a number.
- **`src/i18n/useTranslation.ts` — `t` / `tx`** — tooltip text is user-facing copy.

**Deliberately not mandated:** the `title` attribute, for anything except an
`<iframe>`'s required accessible name. And `role="tooltip"` on anything the user can
click — that is `anchored-popover`.

---

## 4. Steps

1. **Ask P1 first: is this information available anywhere else?** If no, stop — it is not
   a tooltip. Put it in the layout, or expand the row, or open a popover. `UuidLabel.tsx:25`
   is the live counter-example: the visible text is `value.slice(0, 8)` and the only route
   to the full UUID is a hover, on a `cursor-default` `<span>`.
2. **Ask the seam question: can the user act inside it?** Yes → stop, you want
   `anchored-popover`, and do not put `role="tooltip"` on it.
3. **Pick the specific primitive before the general one.** Truncated value →
   `TruncateWithTooltip`. Field explanation → `FieldHint`. Disabled control →
   `Button disabledReason`. Timestamp → `AbsoluteTime` / `RelativeTime`. Only if none
   fits, `Tooltip`.
4. **Make the trigger focusable — this is the step that is skipped 113 times.** The child
   of `<Tooltip>` must be a real `<button>` / `<a>` / input, or carry `tabIndex={0}` plus a
   role. `<Tooltip><span>…</span></Tooltip>` compiles, renders, works with a mouse, and is
   invisible to every keyboard and every touch device. The wrapper is `display:contents`
   (`Tooltip.tsx:300`); it has no box and no tab stop. If the thing you want to explain is
   genuinely not a control, make it one (`<button type="button">` with no visual change) —
   or reconsider step 1.
5. **Write `content` as `t.*` / `tx(...)`, and translate all 14 locales in the same
   change.** `npm run check:i18n:strict` is part of finishing.
6. **Do not also set `title` on the wrapped element.** Two channels, two tooltips, one of
   them not translated. `CopyButton.tsx:76` + `:140` is the live instance.
7. **Take the delay from `MOTION.delay.tooltip`**, `fast` or `default`. Do not pass a
   literal.
8. **Do not implement Escape, positioning, flipping, portalling or the description
   relationship.** Those are the primitive's, and where the primitive is currently wrong
   (Gaps 2–4) the fix belongs in `Tooltip.tsx`, not in your call site. A local workaround
   here becomes the sixth positioning implementation.
9. **Ask the type question before reaching for a gate.** *Can the signature make the wrong
   call impossible?* For this situation it can, twice — see
   [Type over gate](#type-over-gate--the-answer). A gate on `title=` ratchets the old
   channel shut; it does nothing about the 113 unreachable triggers, and nothing needs to,
   because one edit inside the primitive removes them all.
10. **And then stop.** A correct call site is two lines.

---

## 5. Anti-patterns

- **`title="…"` on a DOM element.** The single largest population in this document
  (1,197). It renders on mouse hover only: no keyboard path, no touch path, no dismissal,
  no styling, no translation through the app's own layer, and inconsistent screen-reader
  support. It is not a lightweight tooltip — it is a tooltip that four classes of user
  cannot open.
- **`<Tooltip>` around a bare `<span>` or `<div>`.** The most common *adopted* defect
  (113 sites). The author correctly reached for the primitive and then attached it to
  something that cannot be focused, so the tooltip is mouse-only anyway. Adoption did not
  fix the accessibility defect — it relocated it. **The tell is `cursor-help`**: 14 of the
  113 announce "there is information here" to a pointer and to nothing else.
- **Putting the description on a wrapper instead of on the trigger.** Description
  relationships do not reach descendants. Currently done by the primitive itself at all
  194 sites (Gap 2), which is why it is a gap rather than a per-site deviation.
- **Binding the description only while the tooltip is visible.** The description is read
  when focus arrives; adding it 400ms later is adding it to nobody. Also Gap 2 — and note
  that these are two independent failures on the same line, so fixing one leaves the other.
- **A hover box with no `onFocus`.** 13 of 17 hand-rolled hover surfaces. Mouse-only by
  construction, and the omission is invisible in review because it is an absence.
- **Gating Escape behind an opt-in prop.** WCAG 1.4.13 dismissability becomes a thing
  call sites remember, and they do not: 1 of 194.
- **`role="tooltip"` on something with a button inside it.** Announces "supplementary,
  nothing operable here" about a surface the user must operate. Reinvented in
  `personas-web` too, which makes it a trap rather than a slip.
- **Naming an anchored popover `*Tooltip`.** `EdgeDeleteTooltip.tsx` has a delete action,
  a type switcher and outside-click dismissal. The name is why the next person will copy
  the wrong shape.
- **Both a `title` and a `<Tooltip>` on one control.** Two tooltips appear, offset from
  each other, and only one is translated.
- **A hardcoded delay.** Five values already exist across the hand-rolls; `MOTION` exists
  precisely so a sixth is not invented.
- **A tooltip carrying prose.** `max-w-[480px]` (`Tooltip.tsx:315`) permits paragraphs;
  `SensorScoreboard.tsx:80` ships two sentences. Long content makes the un-hoverable
  surface (Gap 5) a real reading problem under magnification, and is a sign the content
  wanted a popover.

---

## 6. Evidence

**The one site to copy:** `src/features/shared/components/editors/JsonEditor.tsx:191-198`.
`<Tooltip content={t.shared.json_format_tooltip}>` wrapping a real `<button type="button">`
that carries its own visible label and `disabled` state. Trigger focusable, content
translated, no `title`, no positioning, no delay literal — four lines.

- `src/features/shared/components/display/Tooltip.tsx:304-308` — the portal-only-while-visible
  reasoning, with the measured cost of getting it wrong. This is the primitive's best
  decision and the model for how its remaining gaps should be documented when fixed.
- `…/Tooltip.tsx:216-228` — the `show()` timer-clobber guard, with the ghost-tooltip
  failure mode written into the comment.
- `…/Tooltip.tsx:71-96` + `:98-106` — placement flip and viewport clamp. Neither sibling
  repo has either; both hardcode a side.
- `…/Tooltip.tsx:253-260` — the `display:contents` → `getBoundingClientRect()` 0×0
  fallback in WebView2. Worth reading as the *first* scar left by the wrapper design that
  Gaps 2–4 are the rest of.
- **`src/features/shared/components/buttons/Button.tsx:257-275`** — the reference for an
  inert trigger: `triggerFocusable` + `triggerClassName` + `focus-ring` + `aria-disabled`,
  with `:200-204` explaining why the button stays `pointer-events-none`. The only place in
  the repo where hover and keyboard reach the same explanation for a disabled control.
- `…/display/TruncateWithTooltip.tsx:29,39,48` — overflow detection so the tooltip appears
  only when it adds something, plus the repo's only focusable trigger.
- `…/display/FieldHint.tsx:36-41` — hover **and** focus on a real button with a translated
  `aria-label`; the hand-roll that got the trigger right.
- `src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:438-465` — the
  **justified** hand-roll, and the model for how to justify one: the comment states the
  reason (an SVG `<rect>` cannot be wrapped by a primitive whose trigger is an HTML span),
  and it still ships `role="tooltip"`, `pointer-events-none`, `fixed` and a flip.
- `src/features/plugins/fleet/FleetStatusLegend.tsx:40` — the only CSS-only hover surface
  in the repo with a keyboard path (`group-focus-within:opacity-100`), on a trigger that is
  a real `<button>` with a translated `aria-label`.
- `src/lib/utils/designTokens.ts:38-49` — the delay tokens, with the reasoning for two
  rungs rather than one.
- `src/features/overview/sub_director/components/ScoreDistribution.tsx:55` — `tx()` with
  interpolated values in tooltip content, on a `<button>` trigger.

---

## 7. Deviations found

Everything below shipped under a green `npm run check`. The lint baseline is
**1,135 warnings / 0 errors** ([`shared-facts.json`](../shared-facts.json)); none of them
is about a tooltip, because no rule in the repo is.

### A. The `title` channel — **1,197 native tooltips across 596 files**

Parsed, not grepped. Every JSX opening tag in `src/**/*.tsx` was read with a
brace/quote-aware scanner and classified:

| | occurrences | files |
| --- | ---: | ---: |
| `title=` on a **lowercase DOM tag** — a native tooltip | **1,113** | 572 |
| `title=` on `<Button>` / `<AsyncButton>` — **also** native (both spread `...rest` onto the real `<button>`: `Button.tsx:220`, `AsyncButton.tsx:102,115`) | **84** | — |
| **Native tooltips, total** | **1,197** | **596** |
| `title=` on a component that *consumes* it as a heading prop (`ContentHeader`, `SectionCard`, `EmptyState`, …95 components) — **not** a tooltip | 580 | — |
| `<title>` SVG elements — not a tooltip | 20 | — |

The middle row is the one a grep cannot see and a reviewer will not either: `<Button
title="Cancel">` looks like a component prop and is a browser tooltip.

By host tag: `button` 716, `span` 292, `div` 59, `p` 13, `td` 9, `a` 8, then a tail.
By value: **1,080 are `{expressions}`**, only 33 are string literals.

**Adoption of the primitive against the channel it replaces: 194 / 1,391 = 13.9%.**

### B. Keyboard-unreachable triggers — **113 of 194 adopted call sites (58%), 78 files**

`Tooltip`'s wrapper is `display:contents` with no `tabIndex` (`Tooltip.tsx:300`). Its
`onFocus`/`onBlur` fire from the child's bubbled focus events, so the tooltip is
keyboard-reachable **if and only if the child is focusable**. Classified:

| trigger child | count | reachable? |
| --- | ---: | --- |
| `<button>` / `<a>` / input / `motion.button` | 47 | yes |
| `Button` / `AsyncButton` / `CopyButton` / … | 7 | yes |
| explicit `tabIndex` (`TruncateWithTooltip.tsx:39`) | 1 | yes |
| **bare `<span>` / `<div>` / `<svg>`, no `tabIndex`, no `role`** | **110** | **no** |
| **bare tag with `onClick` but no `tabIndex`/`role`** | **3** | **no** |
| icon component (`RotateCcw`, `HelpCircle`, `StatusBadge`, …) — renders inert SVG/span | 12 | effectively no |
| expression child (`{span}`, `{card}`, `{btn}`, …) | 14 | mixed — see C |

**14 of the 113 carry `cursor-help`** — a class that exists to say "hover for information
you cannot otherwise get". Worst instances:
`overview/sub_certification/GateBreakdown.tsx:29` (the gate log tail, available nowhere
else) · `agents/components/allPersonas/PersonaOverviewCells.tsx:160` (the names hidden
behind a "+N" overflow) · `PersonaOverviewColumns.tsx:41` · `PersonaParametersCard.tsx:60`
· `GroundingTable.tsx:63` · `StandardsCard.tsx:54` · `SensorScoreboard.tsx:53`.

High-traffic remainder: `ExecutionListRow.tsx:71,78,140,141,224` ·
`ExecutionValueBadges.tsx:35,42` · `LabVersionsTable.tsx:213,235,251` ·
`GlobalExecutionList.tsx:491` · `LlmCallsTable.tsx:208` · `EventLogList.tsx:290` ·
`PipelineDots.tsx:38` · `RunnerPhaseTimeline.tsx:58,85` · `KnowledgeTree.tsx:335` ·
`DispatchTable.tsx:106` · `PersonaCoachingTable.tsx:163,211` · `contextMapPerf.tsx:261,317`
· `CoveragePipeline.tsx:39,124` · `UseSkillDialog.tsx:130,131,152`.

### C. Two shared primitives multiply B — **~133 more instances from two lines**

Not call sites of `Tooltip` but *renderings* of it, and every one wraps a bare `<span>`:

| primitive | call sites | tooltip default | trigger |
| --- | ---: | --- | --- |
| `RelativeTime` | **100** | `showTooltip = true`, passed at only 4 sites | `<span>` (`:40-44`), wrapped at `:49` |
| `AbsoluteTime` | **37** | `showRelativeTooltip = true`, **never passed** | `<span>` (`:63`), wrapped at `:67` |
| `StatCard` | 32 | `tooltip` optional | `{card}` (`:94`) |

So the two most-used timestamp primitives in the app emit a mouse-only tooltip by
default, at ~133 sites, from two lines of source. **This is the leverage point: fixing
`Tooltip`'s wrapper fixes all of them without touching a call site.**

### D. The description reaches nobody — **194 of 194**

`Tooltip.tsx:298` — `aria-describedby={visible ? tooltipId : undefined}` — is on the
**wrapper span**, and it is **conditional on `visible`**. Two independent breaks:

1. **Wrong element.** The focused control is the child; the wrapper is its ancestor.
   Description relationships do not flow to descendants, so the focused button's
   accessible description is empty.
2. **Wrong time.** `visible` flips only after the delay timer (`:225-227`), default
   **400ms** (`designTokens.ts:47`). Descriptions are computed when focus arrives.
   Even on the right element, an attribute added 400ms later is never announced.

Corroboration from outside: `brainiac/console` binds `aria-describedby` directly onto its
`<input>`/`<textarea>` elements — it reached P4 unaided, because it never built a wrapper
to get it wrong on.

Repo-wide, `aria-describedby` appears on **10** elements: 8 form inputs, 1 `ThemedSelect`,
and this wrapper.

### E. Tooltips are a locale surface, and this one is inverted

**The inversion, confirmed:**

| | visible label | tooltip |
| --- | --- | --- |
| `AbsoluteTime` | `new Intl.DateTimeFormat(undefined, …)` (`:63`) → **host-OS locale** | `formatRelativeTime(…)` (`:67`) → **hardcoded English** (`formatters.ts:51-61`: `'just now'`, `` `${n}s ago` ``) |
| `RelativeTime` | `formatRelativeTime(…)` (`:36`) → **hardcoded English** | `new Date(iso).toLocaleString()` (`:38`) → **host-OS locale** |

Each renders one half in the machine's locale and the other in English, and they disagree
about which half. A Japanese user on an `en-US` machine gets a Japanese app showing
`Aug 14, 2026` with `2h ago` on hover; two lines away the same user gets `2h ago` with
`8/14/2026, 3:04:11 PM` on hover.

**Already gated — do not re-gate:** `host-locale-date-render` (43 files / 55) covers
`AbsoluteTime.tsx:63`; `english-elapsed-label` (16 / 47) covers `formatters.ts`. Both
belong to [`timestamp-display.md`](./timestamp-display.md).

**A recall gap in that rule, reported not fixed:** its pattern requires
`toLocale(?:Date|Time)String`, so **`RelativeTime.tsx:38`'s bare `.toLocaleString()`
does not match**. The single most-rendered date tooltip in the app (100 call sites) is
invisible to the rule that exists for exactly it. Widening that alternation is
`timestamp-display.md`'s edit, and it will move its baseline.

**Untranslated tooltip copy, by channel:**

| | English prose literals | files |
| --- | ---: | ---: |
| native `title=` | **43** | 36 |
| `<Tooltip content=>` | **6** | 6 |

Seven times as much untranslated copy hides in `title` — and structurally so.
`custom/no-hardcoded-jsx-text` *does* list `title` in `I18N_ATTRS`
(`no-hardcoded-jsx-text.cjs:66`), but its `JSXAttribute` visitor only inspects
**string-literal** values (`:123-134`). 1,080 of 1,113 DOM titles are `{expressions}`, so
the rule is blind to the channel by construction, and it is warn-level besides. Live
examples: `UnifiedBuildEntry.tsx:750` (a two-clause sentence in a ternary) ·
`UseCaseRow.tsx:134,156,192` · `GlyphTopBar.tsx:45` · `MessageDetailModal.tsx:945` ·
`AlertRulesPanel.tsx:222` · `LifecycleProjectPicker.tsx:79` · `FieldRuleRows.tsx:72,97`.
And in the primitive's own channel: `SensorScoreboard.tsx:80`, `SweepButton.tsx:81`,
`TerminalHeader.tsx:36,49,62`, `TerminalStrip.tsx:89,102`,
`ConnectorStatusCard.tsx:75`, `ReadinessTrend.tsx:17`.

Hand-rolls leak too: `schedules/components/EventTooltip.tsx:38` formats in the host
locale; `overview/sub_usage/components/ChartTooltip.tsx:11,18` uses bare
`new Intl.NumberFormat()`; `TriggerHealthSparkline.tsx:57` ships `'No timestamp'`.

### F. WCAG 1.4.13 — one of three requirements met

| requirement | status |
| --- | --- |
| **Dismissable** (removable without moving focus) | **fails at 193/194.** Escape is handled only inside `triggerFocusable` (`Tooltip.tsx:299`), and `triggerFocusable` is passed at exactly **one** site in the repo — `Button.tsx:269`, the disabled-reason path. **Zero feature call sites.** |
| **Hoverable** (pointer can enter the content) | **fails everywhere.** The bubble is `pointer-events-none` (`:315`) and `hide()` fires on the trigger's `mouseleave` (`:289`) across an 8px gap (`OFFSET`, `:31`). At `max-w-[480px]` the repo permits content long enough for this to matter under magnification. |
| **Persistent** | met — visibility is tied to hover/focus, nothing auto-dismisses. |

**Touch is a fourth axis with no handling at all.** `Tooltip` binds only
`onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur` — there is no pointer or touch path in
the file. Touch reachability therefore tracks keyboard reachability exactly: the 47
button-triggered tooltips surface on tap-focus; the 113 span-triggered ones never do; and
`title=` never surfaces on touch at any of 1,197 sites. `personas-web` independently built
an `[@media(hover:none)]` fallback for its hover-revealed affordance — the problem is
recognised in the family, just not here.

### G. Information that exists nowhere else — the P1 violations

- **67 elements carry both `title` and `aria-label` with *different* text**, so the
  `title` is genuinely extra content on a mouse-only channel:
  `DeckActionBar.tsx:133,154` (`branch.hint` vs `branch.label`) · `DeckTopBar.tsx:41,120,151`
  · `QuestionPanel.tsx:45` · `GlyphCapabilityPreview.tsx:229,242,253` ·
  `GlyphTestCompleteCore.tsx:82` · `UseCaseRow.tsx:134,192` · `ArenaPanelColosseum.tsx:799`
  · `PersonaSquare.tsx:27` · `PersonaMonitor.tsx:256` · `ReviewListItem.tsx:14,24,33` · …
- **Named exemplars where the tooltip is the sole route to a value:**
  `UuidLabel.tsx:25` (full UUID; visible text is `value.slice(0,8)`) ·
  `GateBreakdown.tsx:29` (`step.tail`) · `PersonaOverviewCells.tsx:160` (names behind
  "+N") · `RunnerPhaseTimeline.tsx:58,85` (per-phase and per-tool durations) ·
  `LabVersionsTable.tsx:213` (`change_summary`) · `GroundingTable.tsx:63` (`row.invalid`)
  · `ExecutionListRow.tsx:191` (`execution.id`) · `RevitalizeHistoryTable.tsx:103`
  (`run.error`) · `CloudSyncCard.tsx:215` (`status.deviceId`).

### H. Two channels on one control — `CopyButton`, 30 call sites

`CopyButton.tsx:76` sets `title={resolvedTooltip}` on the `<button>`; `:140` wraps that
same button in `<Tooltip content={…}>`. Both fire on hover, so the app's styled tooltip
and the operating system's appear together. `resolvedTooltip` defaults to
`t.shared.copy_tooltip` whenever there is no label (`:71`), so most of the 30 sites are
affected, and only 11 pass an explicit `tooltip`.

### I. Hand-rolled hover surfaces — **17 JS-driven + 4 CSS-only**

Of the 17 JS-driven (`onMouseEnter`+`onMouseLeave` driving state, in a file that renders a
positioned box), excluding the primitive itself: **13 have no `onFocus` at all**, **0**
declare `role="tooltip"`, **0** bind a description, **0** handle Escape, **0** portal.

| site | verdict |
| --- | --- |
| `shared/components/display/FieldHint.tsx:33` | **shared parallel primitive**, 8 consumers — Gap 1 |
| `overview/sub_analytics/ExecutionHeatmap.tsx:444` | **justified** (SVG `<rect>` trigger), reasoning at `:440-442` |
| `agents/sub_deployment/cloud/DailyBreakdownChart.tsx:101` | justified-shaped (SVG `<rect>`), but no `role`, no focus |
| `triggers/sub_triggers/TriggerHealthSparkline.tsx:42,51` | hover-only dot tooltip; trigger a bare `<div>`; `'No timestamp'` hardcoded |
| `schedules/components/EventTooltip.tsx:22` | fixed + `pointer-events-none`, no `role`, no aria, host-locale date |
| `plugins/fleet/FleetStatusLegend.tsx:40` | CSS-only but **has `group-focus-within`** — the best hand-roll |
| `plugins/fleet/FleetFooterPopover.tsx:51` | `role="tooltip"` on interactive content → **`anchored-popover`'s** |
| `teams/sub_canvas/edges/EdgeDeleteTooltip.tsx` | a popover named a tooltip → **`anchored-popover`'s** |
| `plugins/dev-tools/sub_skills/registry/RegistryHeatmap.tsx:116,139` · `agents/sub_executions/trace/SubSpanBar.tsx:32` · `shared/glyph/persona-layout/UseCaseRow.tsx:84` · `teams/sub_canvas/ConnectionLegend.tsx:10` · `teams/sub_canvas/PipelineControls.tsx:118` · `presetStudio/PresetProcessBlueprint.tsx:59` · `plugins/fleet/FleetFooterIcon.tsx:92` | mouse-only hover surfaces — migrate |
| `home/sub_welcome/NavigationGrid.tsx:39` · `shared/chrome/FleetActivityStrip.tsx:137` · `questionnaire/QuestionnaireStackedOptions.tsx:35` · `home/sub_welcome/SetupCards.tsx:494` | have `onFocus`; still no role / description / Escape |

CSS-only tooltips are a **small** population, and the honest number matters: 20 elements
match `absolute|fixed` + hidden + `group-hover` reveal, but **16 of them are
hover-revealed action buttons, not tooltips**. The four real ones are
`FleetStatusLegend.tsx:40`, `plugins/companion/Bubble.tsx:215`,
`artist/sub_media_studio/TimelineClip.tsx:152`, `TriggerSchedulePreview.tsx:85`. A gate
keyed on that class combination would have been ~80% noise.

### J. No test asserts any of this

**Zero.** No test file in the repo references `Tooltip`. `display/__tests__/` holds
`Numeric`, `SortableHeader`, `MotionizedGlyph`, `grouping`, `facetedTableModel` — no
tooltip. So Gaps 2–5 could each be fixed and silently regress. `brainiac/console` has a
source-parsing a11y contract test with a reasoned allowlist
(`src/design/focus-contract.test.ts:29-60`) — the mechanism a tooltip contract needs,
independently built, in a repo with no tooltip primitive to point it at.

---

## 8. Gaps in the primitives

> **Second pass — what is upstream of all of this.** Deviations B, D, F and the
> `getBoundingClientRect` scar at `Tooltip.tsx:253-260` are not four problems. They are
> **one API decision**: `Tooltip` takes `children: ReactNode` and *wraps* them in a
> `display:contents` span, instead of *cloning* a single child element and injecting onto
> it. Because the wrapper is the handler owner, keyboard reach became whatever the caller
> happened to wrap (113 misses); because the wrapper is the ARIA owner, the description
> landed on an ancestor (194 misses); because the wrapper is inert, Escape had to be
> gated behind an opt-in prop (193 misses); and because the wrapper has no box, WebView2
> reported 0×0 and needed a documented fallback. One decision, four deviation classes.
>
> **The convergence oracle inverted my expectation here, and it should be said plainly.**
> Neither sibling repo has this defect class — not because they solved it, but because
> **neither built a wrapper-based API at all.** They attach handlers to the trigger
> directly, so there is no wrong element to attach to. Our abstraction manufactured a
> failure mode that hand-rolling structurally cannot have. That does not vindicate
> hand-rolling: both siblings fail *worse and more widely* (no description binding, no
> Escape, no delay, no flip, no clamp, no portal — see below). But it does mean the usual
> "the primitive is safer" reasoning is not available for this one property, and the fix
> is to change the primitive's shape rather than to defend it.

1. **`FieldHint` is a second tooltip implementation, and it is the better-behaved one at
   the trigger and the worse one everywhere else.** It gets hover+focus parity and a real
   focusable button (`:33-41`) — the exact thing `Tooltip` misses 113 times — while having
   **no `role="tooltip"`, no `id`, no `aria-describedby`, no Escape, and no portal**
   (`:46-72`), so it clips inside any `overflow-hidden` or transformed ancestor and its
   content is announced to nobody. 8 call sites. Do not delete it — the field-explanation
   affordance is genuinely distinct. Make it *compose* `Tooltip` once Gaps 2–4 land, so
   there is one implementation of the hard parts.
2. **`Tooltip` binds its description to the wrong element, at the wrong time.**
   `:298`. Both halves must change together: move `aria-describedby` onto the trigger
   itself, and keep it bound while the tooltip is *mounted-and-scheduled*, not only while
   visible. Independently confirmed as the correct shape by `brainiac/console`'s
   `Input.tsx:103,137,172`.
3. **`Tooltip` cannot know whether its trigger is focusable, and does nothing about it.**
   The wrapper is `display:contents` unless `triggerFocusable` is passed (`:300`), and
   `triggerFocusable` is passed once in the entire repo. There is no runtime warning, no
   type constraint, and no default that fails safe. 113 call sites are mouse-only and none
   of their authors were told.
4. **Escape dismissal is opt-in.** `:299` attaches the Escape handler only under
   `triggerFocusable`. WCAG 1.4.13 dismissability is not a per-call-site decision; it is
   the primitive's job. 193 of 194 sites do not have it, and neither sibling repo has it
   anywhere — this is the clause you only get from reading the spec.
5. **The bubble is not hoverable.** `pointer-events-none` at `:315` with an 8px gap and
   `max-w-[480px]`. The two siblings *diverged* here — `personas-web` chose
   `pointer-events-none`, `brainiac` chose a hoverable popup with `onMouseLeave` — which
   is evidence the trade-off is real rather than settled. The honest resolution is a
   grace-period close (keep visible briefly after `mouseleave`, cancel if the pointer
   enters the bubble), which satisfies 1.4.13 without the accidental-hover problem that
   made `pointer-events-none` attractive.
6. **No touch path.** No pointer/touch handling in the file. Tap-to-reveal, or an
   explicit statement that touch users get the focus path, is missing.
7. **`content` is `string`.** So a tooltip cannot hold a `<kbd>`, a formatted number, or
   a `<Numeric>` — which is one reason `FieldHint` exists at all and why
   `RunnerPhaseTimeline.tsx:58` composes a template literal by hand. Widening to
   `ReactNode` is safe *only* alongside Gap 4, since richer content raises the cost of
   being unable to dismiss it.
8. **The primitive cannot wrap a non-HTML trigger.** SVG `<rect>`, `<circle>`, `<path>`
   and canvas nodes have no HTML box for the `display:contents` wrapper, which is the
   documented reason for `HeatmapTooltip` (`ExecutionHeatmap.tsx:440-442`) and the shape of
   `DailyBreakdownChart.tsx:101`. **This is a genuine limitation, not laziness.** A
   `<Tooltip anchorRect={rect}>` overload — content plus a measured rect, no trigger
   wrapper — would serve both, and chart tooltips would stop being hand-rolled.
9. **No shared positioner.** Five independent flip/clamp implementations (§1). Assigned
   to `anchored-popover`; recorded here because `Tooltip.tsx:41-106` is one of the five.
10. **Nothing tests it.** §7-J.

**Not a gap:** the portal-only-while-visible design (`:309`) and the two-rung delay scale
(`designTokens.ts:45-48`) are both deliberate, both documented with their failure modes,
and both absent from every other implementation examined in three repositories.

---

## Type over gate — the answer

**Yes — and unusually, the type move here removes *more* of the deviation surface than any
gate could, because 113 of the defects live inside one component's signature.**

The contract asks §4 to pose the question before §9 writes a gate: *can the primitive's
signature make the wrong call impossible?* For this situation there are three answers,
and they are different.

**1. The description binding: yes, and the fix is structural, not a prop.**
`Tooltip` should stop taking `children: ReactNode` and wrapping, and start taking
`children: ReactElement` and **cloning** — injecting `aria-describedby`, the pointer and
focus handlers, and the ref onto the trigger element itself. Once there is no wrapper,
*there is no wrong element to attach the description to.* Deviation D goes from 194 sites
to zero, not by fixing 194 call sites but by deleting the node that was wrong. This is the
same move the contract records for `personas-web`'s `createLazySection` (22/22 vs 2/31):
a shape in which the mistake is unrepresentable beats a rule that counts it. It is also
the shape `brainiac/console` arrived at independently — its descriptions sit on the
`<input>` because it never built a wrapper to put them on instead.

**2. Keyboard reachability: no type can express it — so fix the *default*, which is
better.** No TypeScript signature can require "this element will be focusable at
runtime": `ReactElement` does not carry focusability, and a required `isFocusable` prop
is exactly the forgettable-argument failure the contract records for `Numeric`'s
locale (189 of 197 call sites simply did not pass it). But once the primitive clones the
child it can *read* `children.type` at render time and, when the trigger is not a
natively-focusable tag and carries no `tabIndex`, supply `tabIndex={0}` itself — the
behaviour `Button.tsx:257-275` already implements correctly under `triggerFocusable`,
promoted from opt-in to default. **That single edit converts 113 unreachable call sites,
plus ~133 more instances rendered through `RelativeTime`/`AbsoluteTime`/`StatCard`, with
no call site touched.** This is the contract's own §9 lesson applied ahead of the gate:
*prefer fixing the default over counting the callers — one edit at the primitive
corrected ~212 call sites here, and no ratchet would have moved a single one.*
`triggerFocusable` should then be deleted, not merely defaulted, because a prop whose
correct value is always the same is a prop that will eventually be passed wrong.

**3. Escape dismissal: not a prop at all.** WCAG 1.4.13 dismissability is never a call
site's decision. `:299`'s conditional exists only because the wrapper is inert; once the
trigger owns the handlers, the primitive owns Escape unconditionally and there is nothing
to forget. Like `focus-management.md`'s restore-in-cleanup, this is a type-level guarantee
disguised as a two-line edit: it moves the promise from "the caller remembered a prop" to
"the component is mounted".

**Where a type cannot reach, and why the gate is still needed.** No signature can stop
someone writing `title=` on a `<div>`. That channel is the browser's, it needs no import,
it is one word long, and it will keep looking like the cheap option forever. That is
exactly the residue a ratchet is for — and it is 1,108 matches across 571 files, the
largest single population in this document. So §9 gates **one** thing: the old channel.
It does not gate the unreachable triggers, because those are being removed by shape
rather than counted.

**The seam claim, restated as a type.** P7 — *a tooltip holds nothing operable* — is
enforceable by the signature too, once `content` widens (Gap 7): typing it as text-like
rather than `ReactNode` makes "put a button in the tooltip" fail to compile, which is a
better answer than `FleetFooterPopover.tsx:51`'s `role="tooltip"` on a panel with a
control in it. That is a recommendation to `anchored-popover`'s author as much as to this
one: the two paths stay honest if the tooltip's content type cannot express a popover's
content.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The
condition is stated first so an adopting repo can re-derive its own proxy rather than
inherit this one — the portability test measured four ported signals at **zero** true
positives each.

### The semantic condition, stack-free

> **C1 — explanatory text is attached to a control through a channel the user agent alone
> renders.** Such a channel appears on pointer hover and nowhere else: it has no keyboard
> path, no touch path, no dismissal, no styling, no reliable assistive-technology
> announcement, and it never passes through the application's translation layer.
>
> *Proxy here:* the `title` attribute on a lowercase DOM tag in a `.tsx` file.
> *Precondition:* the repo renders to a DOM where `title` has that behaviour **and** owns
> a shared tooltip primitive that is the alternative. A repo with no primitive would find
> this rule fires on 100% of its tooltip sites — `personas-web` (29 native `title`, 0
> primitive) and `brainiac/console` (29 native `title`, 0 primitive) are both exactly
> that — and should read the 100% as the finding, not baseline it.

### Conditions deliberately NOT given a rule — refusals, with measurement

- **C2 — the tooltip trigger cannot receive keyboard focus** (113 sites, 78 files).
  **Do not gate this. Fix Gap 3 instead.** A default `tabIndex` inside the primitive
  eliminates all 113 plus ~133 primitive-rendered instances without a single call-site
  edit; a ratchet would count them for as long as it took someone to do the edit anyway,
  and would then have to be deleted. A ratchet on a condition the primitive can erase is
  wasted enforcement. *(A regex proxy is also weak: verdicts depend on whether the child
  component renders a focusable node — `<Tooltip><StatusBadge/></Tooltip>` is
  undecidable without resolving the import.)*
- **C3 — the description is bound to a wrapper rather than the trigger** (194/194).
  Not gateable and not worth gating: it is **one line in one file** (`Tooltip.tsx:298`),
  and a census rule pinned at "1 match in the primitive" is a gate that can never fail.
- **C4 — a hover-revealed surface with no focus path.** 13 of 17 hand-rolls. No honest
  regex proxy: the deviation is the *absence* of `onFocus` near an `onMouseEnter`, and
  whole-file matching cannot express absence without either file-granularity false
  positives or an AST. This belongs in an ESLint rule
  (`custom/hover-reveal-requires-focus`, keyed on a JSXElement carrying `onMouseEnter`
  that sets state, without `onFocus`), with `role-button-requires-keydown.cjs` as the
  working precedent for the AST shape. Recorded as the follow-up; **not shipped with this
  path**, because it should be written after Gaps 1–4 land so it can route people
  somewhere correct. Note also that a class-based proxy was tested and rejected on
  measurement: `absolute|fixed` + hidden + `group-hover` matches 20 elements of which
  **16 are hover-revealed action buttons, not tooltips** — ~80% noise.
- **C5 — the locale inversion in tooltip content.** Already gated by
  `host-locale-date-render` and `english-elapsed-label`
  ([`timestamp-display.md`](./timestamp-display.md)). **Checked before proposing
  anything, and no new rule is proposed.** One recall gap reported in §7-E for that
  path's author: the pattern requires `toLocale(?:Date|Time)String` and therefore misses
  `RelativeTime.tsx:38`'s bare `.toLocaleString()`.

### The rule — validated

Verified at the working tree with
`node scripts/census/run-census.mjs --rules <tmpfile> --check` → **exit 0**, reproducing
both baselines exactly.

```json
{
  "rules": [
    {
      "id": "native-title-tooltip",
      "goldenPath": "docs/concepts/golden-paths/tooltip.md",
      "title": "Explanatory text delivered through the native title attribute",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<(?:a|abbr|button|code|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|img|input|label|li|nav|ol|option|p|path|pre|section|select|small|span|strong|summary|svg|table|tbody|td|textarea|th|thead|tr|ul)(?![A-Za-z0-9_-])(?:(?!<)[\\s\\S]){0,1200}?\\stitle=",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the native `title` attribute on a lowercase DOM element. PROXY FOR the stack-free condition: explanatory text is attached to a control through a channel the user agent alone renders, so it appears only on mouse hover - it is never reachable by keyboard, never appears on a touch device, cannot be dismissed, is not reliably announced by assistive technology, and is not routed through the application's own translation layer. PRECONDITION (must be re-derived per repo): this repo renders to a DOM where `title` has that user-agent behaviour AND owns a shared Tooltip primitive that is the alternative; a repo with no primitive would find this rule fires on 100% of its tooltip sites and should read that as the finding, not baseline it. Measured precision 1109/1109 (zero false positives) and recall 99.7% against a JSX-parser ground truth of 1112 on the 2026-08-14 corpus; the 3 misses are opening tags whose attribute region exceeds 1200 characters before `title=`. `iframe` is deliberately absent from the tag list: `title` on an iframe is a REQUIRED accessible name (WCAG 4.1.2), not a tooltip, so including it would gate a correct construct."
      },
      "baseline": { "files": 571, "matches": 1108 },
      "floor": 2000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   native-title-tooltip     571    571     1108   1108    2104   2000
  census OK — 1 rule(s), 2104 file-visits, 1108 surviving violation(s) across 571 file(s).
```

### Precision and recall, measured against a second implementation

Per the contract's *"verify your §9 counts through a second implementation before
baselining them"*, the signal was diffed location-by-location against the brace/quote-aware
JSX parser used for §7:

| | |
| --- | ---: |
| parser ground truth (`title=` on a lowercase DOM tag, tests included) | 1,112 |
| regex distinct locations | 1,109 |
| **true positives** | **1,109** |
| **false positives** | **0** |
| missed | 3 |
| **precision** | **100.0%** |
| **recall** | **99.7%** |

The 3 misses are opening tags whose attribute region exceeds the 1,200-character bound
before reaching `title=` (e.g. `onboarding/components/TourPanelBody.tsx:162`). The bound
was raised from an initial 400 (recall 91.5%) after measuring; runtime was unchanged at
**2.2s** for the whole run. `iframe` was removed from the tag alternation after
measurement because `title` on an `<iframe>` is a *required* accessible name, not a
tooltip — a tag-level exclusion rather than a path-level `exclude`, so there is no stale
exemption to rot.

**Two tooling notes, both learned by getting them wrong here.** The pattern lives in a
**file**; an earlier verification harness built the same regex inside a bash heredoc and
every `\\s`/`\\S` was mangled to a bare `s`/`S`, producing **0 matches with no error** —
a validator that silently checks nothing, which is precisely the §9 failure mode. The
verification script therefore reads the pattern *out of the rules file* so it can never
diverge from the shipped rule. And the pattern uses no lookbehind: it chains forward
anchors (`<tag` → bounded run that cannot cross `<` → `\stitle=`), which is why it costs
2.2s rather than the 73s a variable-length lookbehind cost a sibling path.

### Positive control — the inverted, compliant form

Shipping a violation count proves nothing unless the matcher can be shown to
*discriminate*. So the inverted form — the construct this path prescribes — was run as a
rule through the same runner:

```json
{
  "id": "POSITIVE-CONTROL-tooltip-primitive",
  "roots": ["src"], "extensions": [".tsx"],
  "signal": { "pattern": "<Tooltip(?![A-Za-z0-9_])", "flags": "g", "ignoreCommentLines": true }
}
```

```
  OK   POSITIVE-CONTROL-tooltip-primitive    131    131      195    195    2104   2000
```

| | files | matches |
| --- | ---: | ---: |
| violating (`native-title-tooltip`) | **571** | 1,108 |
| compliant (`<Tooltip>`) | **131** | 195 |
| **files carrying BOTH** | **34** | — |

The two populations are **93.4% disjoint by file** (34 overlap): 6.0% of the violating
population also uses the primitive, 26.0% of the compliant population still carries a raw
`title` somewhere, and **97 files have adopted the primitive with no raw `title` at all**.
Had the violation signal been matching JSX in general, the compliant population would have
been a subset rather than a near-disjoint set. It also *fails loudly on a wrong baseline*
exactly like the shipped rule: baselined at the violating rule's numbers it reports
`files dropped 571 -> 131 (-440)` and `matches dropped 1108 -> 195 (-913)`.

The 34 overlapping files are themselves a finding — a mixed-adoption corpus where the
same author used both channels in one file, and the natural first apply wave:
`ExecutionListRow.tsx` · `GlobalExecutionList.tsx` · `LlmCallsTable.tsx` ·
`GroundingTable.tsx` · `PersonaCoachingTable.tsx` · `EventLogList.tsx` ·
`DispatchTable.tsx` · `KnowledgeTree.tsx` · `ExecutionHeatmap.tsx` ·
`GlyphCapabilityPreview.tsx` · `UseCaseDetailPanel.tsx` · `ConnectorStatusCard.tsx` ·
`DailyGoalsBar.tsx` · `DevOpLedger.tsx` · `contextLedgerShared.tsx` · `contextMapPerf.tsx`
· `LlmOverviewPage.tsx` · `DeepScanRecommendations.tsx` · `TraceOverview.tsx` ·
`FindingBadge.tsx` (+14).

**The positive control is deliberately NOT proposed for `rules.json`.** A census baseline
is monotone-downward by design — the runner treats a *rise* as a violation — so a rule
counting the compliant form would fail the build every time someone adopted the primitive.
It is a validation instrument, and it belongs in this document, not in the registry.

### How it fails loudly if its own precondition is absent

Each failure mode was **induced and observed**, not assumed. The runner's structural
contract (`run-census.mjs:19-38`) was exercised against this exact rule:

| induced fault | exit | reported |
| --- | :---: | --- |
| *(control — no fault)* | **0** | baseline reproduces exactly |
| pattern → a token present nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` raised to 9,000 | **1** | `[structural] walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots` → `["srcc"]` | **1** | `[structural] walked 0 files but floor is 2000 …` |
| baseline `files` 571 → 570 (a count rises) | **1** | `[drift] files rose 570 -> 571 (+1). New violations of docs/concepts/golden-paths/tooltip.md` |
| baseline `matches` 1108 → 1200 (a silent drop) | **1** | `[drift] matches dropped 1200 -> 1108 (-92) without the baseline moving. A silent drop is a broken matcher more often than fixed code` |
| a stale `exclude` path | **1** | `[structural] exclude "…" matched no file. The exemption is stale` |

`floor` is set at 2,000 against an observed walk of **2,104 `.tsx` files**
([`shared-facts.json`](../shared-facts.json) `frontend.tsxFiles`), consistent with
`unfocusable-click-target`, which uses the same root and extension.

**On severity.** This is a census rule, not an ESLint rule, so the warn/error question
does not arise: `npm run census:check` fails the build on drift regardless. That is
deliberate and is the whole reason to put it here rather than in `eslint.config.js` — as
[`CLAUDE.md`](../../../.claude/CLAUDE.md) records, `npm run check` runs `eslint src/` with
no `--max-warnings` and the pre-commit hook passes `--quiet`, so a warn-level rule
enforces nothing at either gate **at any count**. The argument is structural, not volumetric.

### Sequencing

1. **Gap 3 first** — the default `tabIndex` for a non-focusable trigger. It is the only
   change that removes a defect class (113 sites + ~133 primitive-rendered instances)
   instead of counting it, and it costs one edit.
2. **Gaps 2 and 4 together** — clone instead of wrap, which lands the description on the
   trigger, makes the binding permanent, and makes Escape unconditional. One shape change,
   three gaps.
3. **The census rule**, which then ratchets the 1,108 `title=` sites shut while the
   backlog is worked. Start with the 34 mixed-adoption files.
4. **Deviation H** (`CopyButton`'s double channel) and **§7-G**'s 67 differing
   `title`/`aria-label` pairs — mechanical once (3) is holding the line.
5. **Gap 1** — fold `FieldHint` onto the fixed `Tooltip`; **Gap 8** — the `anchorRect`
   overload, which retires the two justified chart hand-rolls.
6. **C4's ESLint rule** last, once there is somewhere correct to route people.
7. Hand `anchored-popover` its three items: `FleetFooterPopover.tsx:51`,
   `EdgeDeleteTooltip.tsx`, and the five-way positioning duplication.
