# Golden path — Button

> **Leaf:** `ui-system/controls-and-forms/button`
> **Date:** 2026-08-13
> **Dimensions:** ui · code-quality · function
> **Sweep size:** 2,104 `.tsx` files parsed; **2,869 raw `<button>` elements** in
> **1,115 files** extracted and classified individually (118 of them inside
> `shared/components/`, leaving **2,751 app-layer elements in 1,055 files**).
> Plus `Button.tsx`, `AsyncButton.tsx`, `CopyButton.tsx`, `Button.test.tsx`,
> `index.ts`, `globals.css`, `.claude/Design.md`, `CATALOG.md`,
> `.claude/conventions.json`, and all 21 custom ESLint rules.

## Scope — read this before anything else

This path governs **what a button is made of**: which element, which variant,
which size, its radius, its focus ring, its accessible name, and its inert
state. The unit is a *control at rest*.

It does **not** govern what happens after the click. Busy state — `loading`,
`isLoading`, `aria-busy`, the double-submit guard, the spinner, `loadingLabel` —
belongs entirely to [`inline-busy-state.md`](./inline-busy-state.md), and that
path's rule is the one to follow there:

> **`AsyncButton` by default; `Button loading=` only when the flag is externally owned.**

Everything below applies equally to `Button` and `AsyncButton`, because
`AsyncButtonProps extends Omit<ButtonProps, 'loading'>` — the variant, size,
radius, focus and naming rules are the same object.

---

## 1. Trigger

You are in this situation if you are about to type any of these:

- "add a button", "add an action to this row", "put a dismiss X in the corner"
- "make this clickable", "add an icon button to the toolbar"
- **the if-you-are-about-to-write test:** you are about to type `<button` and
  then a `className` containing any of `bg-`, `border`, `px-`, `py-`,
  `rounded`, or `hover:`.
- you are about to copy a `<button className="…">` from a neighbouring file
  because it looks right
- you are about to write `<div onClick={…} role="button">`

You are **not** in this situation — go to the named path instead — if the
control is a tab (`SegmentedTabs` / `PanelTabBar`), a switch
(`forms/AccessibleToggle`), a select (`forms/Listbox`), a copy affordance
(`buttons/CopyButton`, enforced by `custom/prefer-shared-clipboard`), or a
full-width row in a menu/listbox (see [Gaps](#8-gaps)).

---

## 2. The one way

**Import `Button` from `@/features/shared/components/buttons` and pass a
`variant` and a `size` — never a `className` that paints.** Six variants
(`primary` `secondary` `ghost` `danger` `accent` `link`) and seven sizes
(`xs` `sm` `md` `lg` `icon-sm` `icon-md` `icon-lg`) cover every push-button
shape this app has; `accent` plus one of thirteen `accentColor` stems covers the
tinted-chip look that 72 call sites currently hand-roll. **If the button shows
only an icon, use `size="icon-*"` and give it `aria-label={t.…}` — not `title=`,
and not nothing.** `size="icon-*"` is not cosmetic: it carries the
`[@media(pointer:coarse)]:w-11 h-11` bump that pairs with the global 44px
`min-height` rule in `globals.css:91-105`, so hand-rolling `w-7 h-7` silently
ships a sub-WCAG-2.5.5 touch target — and so does passing `className="w-6 h-6"`
*to* `Button`, which 23 call sites do today. Reach for `className` only to
position the button in its parent (`ml-auto`, `absolute top-2 right-2`,
`flex-shrink-0`) — never to colour, pad, round, or size it. When the button is
inert, pass `disabled` (the native attribute — `<button>` needs no
`aria-disabled`, and this repo uses it **zero** times in 2,869 raw buttons) and
pass `disabledReason` with it, which wraps the button in a focusable tooltip so
keyboard users can discover *why*; 403 disabled buttons in this repo surface no
reason at all. **The one thing you must not do is reach for a raw `<button>`
because "it's just a small one"** — that is how 2,311 of them got here, 84% of
every button in the app.

**Before you follow this, read [Gaps §5](#8-gaps).** `Button`'s radius does not
currently match the radius token the design system mandates for buttons. Until
that is resolved, adopting `Button` on a surface that today uses
`rounded-interactive` will visibly change its shape. That is a real,
unresolved contradiction in this repo, not a reason to hand-roll.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`shared/components/buttons/Button.tsx`** — `Button`, `ButtonProps`, `ButtonVariant`, `ButtonSize` | The canonical control. 6 variants (`Button.tsx:31-44`), 7 sizes (`:46-57`), 13 `accentColor` stems (`:65-79`). Also gives you, for free and in one place: `focus-ring` (`:195`), `type="button"` by default (`:121`), `active:scale-[0.98]` press response (`:194`), `is-disabled` (`:205`), the coarse-pointer 44px bump (`:54-56`), a `disabledReason` tooltip on a focusable wrapper (`:256-275`), and `forwardRef`. |
| **`.../buttons/AsyncButton.tsx`** — `AsyncButton`, `AsyncButtonProps` | Same object plus busy handling. Everything in this document applies to it unchanged. Its own rules live in [`inline-busy-state.md`](./inline-busy-state.md). |
| **`.../buttons/CopyButton.tsx`** — `CopyButton` | The clipboard case. Enforced by `custom/prefer-shared-clipboard`. |
| **`.../buttons/index.ts`** | The import you should use: `import { Button } from '@/features/shared/components/buttons'`. This barrel is the majority form already (155 files vs 57 deep-path). |
| **`globals.css:6-16` `focus-ring`** | `:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring-color) }`. Theme-aware, re-derived per vibe. `Button` applies it; a raw `<button>` does not, and falls back to the UA ring. |
| **`globals.css:26-35` `is-disabled`** | `--disabled-opacity` (0.45) + `cursor: not-allowed` + `pointer-events: none`, in one utility. Do not hand-roll `opacity-40 cursor-not-allowed`. |
| **`globals.css:91-105`** | The `pointer: coarse` 44px `min-height` floor. It supplies height only — **width comes from `Button`'s `icon-*` sizes**, which is why hand-rolled icon buttons are non-square on touch. |
| **`forms/AccessibleToggle`, `layout/SegmentedTabs`, `layout/PanelTabBar`, `forms/Listbox`** | The four shapes that are *not* buttons. Route to these rather than adding `aria-pressed`/`role="tab"` to a `<button>`. |

**Explicitly NOT primitives here:** `globals.css:1272-1296` `.btn-sm` / `.btn-md`
/ `.btn-lg`. `.claude/Design.md:316` advertises them as size presets, but
`Button.tsx` does not use them (it uses its own `SIZE_CLASSES` Tailwind strings
at `:46-57`) and app code uses them **3 times** in 2 files. They are a dead
third answer to "how big is a button". Do not reach for them; see
[Deviations §D7](#7-deviations).

---

## 4. Steps

1. **Decide it is a button at all.** Does it perform an action, or does it
   select among options / toggle a mode / navigate? Options → `SegmentedTabs` or
   `Listbox`. Toggle → `AccessibleToggle`. Navigation inside a list row → see
   [Gaps §1](#8-gaps). Action → continue.
2. **`import { Button } from '@/features/shared/components/buttons';`**
3. **Pick the variant by intent, not by colour.** `primary` = the one CTA on the
   surface. `secondary` = the default for everything else. `ghost` = toolbar and
   row actions. `danger` = destructive. `accent` + `accentColor` = a categorised
   or tinted action. `link` = inline in prose.
4. **Pick the size.** Labelled: `xs` `sm` `md` (default) `lg`. Icon-only:
   `icon-sm` `icon-md` `icon-lg` — and **stop**; do not add `w-`/`h-` classes.
5. **Give it its name.** Labelled buttons: `{t.section.key}` as children.
   Icon-only buttons: `aria-label={t.section.key}` on the button, and
   `aria-hidden="true"` on the icon. Add `title=` only *in addition to*
   `aria-label`, never instead of it.
6. **If it can be inert, pass `disabled` and `disabledReason` together.**
   `disabled` alone produces a dead control with no explanation.
7. **Stop.** Do not add `focus-ring`, `type="button"`, `cursor-pointer`,
   `transition-colors`, `active:scale`, `rounded-*`, `px-*`, or a disabled
   opacity class — `Button` already emits every one of them. A `className` on a
   `Button` should contain layout only.
8. **If the action is async**, switch the tag to `AsyncButton` and return the
   promise from `onClick`. Everything above is unchanged. Stop here and follow
   [`inline-busy-state.md`](./inline-busy-state.md).

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `<button className="px-3 py-1.5 rounded-card bg-secondary/40 border …">` | You have re-derived a variant by eye. There are now 5 distinct button radii and dozens of padding pairs in this app (see §7). Nothing converges, and a theme change has to be applied by hand to each one. |
| `<button>` with only an icon inside and no `aria-label` | The control has **no accessible name**. A screen reader announces "button". 844 elements do this. WCAG 4.1.2 failure, and it is a defect whether or not you adopt `Button`. |
| `title="Delete"` as the accessible name on an icon button | `title` is not exposed as an accessible name reliably, never appears on touch, and is not translated in 302 of the sites that rely on it here. Use `aria-label`; add `title` only as a mouse-hover extra. |
| `<Button size="icon-sm" className="w-6 h-6">` | You have overridden the size map and thrown away the `pointer:coarse` 44px bump. 23 call sites. If `icon-sm` is the wrong size, the fix is a new size in `SIZE_CLASSES`, not a local override. |
| `<button disabled>` with no reason | The user sees a dead control and cannot find out why. `Button`'s `disabledReason` exists precisely for this and is used 18 times against 627 `disabled` raw buttons. |
| `aria-disabled` on a `<button>` | Unnecessary — the native `disabled` attribute already conveys it, and `globals.css` keys its cursor and touch-target rules on `:not(:disabled):not([aria-disabled="true"])` so both work. This repo correctly uses `aria-disabled` **0 times**; keep it that way. Reserve `aria-disabled` for non-`<button>` elements that take `role="button"`. |
| `<div role="button" onClick={…}>` | You must then hand-roll keyboard activation, focus, and disabled semantics. `custom/role-button-requires-keydown` is an **error** and will stop you. Use a real `<button>`. |
| `<button>` inside a `<form>` with no `type` | Defaults to `type="submit"`. **Not currently a live defect here** — all 17 raw buttons in the 5 files containing a `<form>` set `type` explicitly — but `Button` defaults `type="button"` (`:121`) so the primitive keeps it that way for free. |
| Adding `focus-ring` to a raw `<button>` and calling it done | It fixes the ring and none of the other nine things `Button` gives you. Only 18% of raw buttons even do this much. |

---

## 6. Evidence

- **`src/features/plugins/dev-tools/sub_context/contextLedgerShared.tsx:324-330` — copy this one.** Three row actions in a row:
  `<Button variant="ghost" size="icon-sm" onClick={…} aria-label={t.uc_view_details} title={t.uc_view_details}>` ×3 (view / accept / reject). Variant + size + translated `aria-label` + `title` as an extra, **no `className` at all**. This is the single most common shape in the drift corpus (icon-only row action, 1,577 elements) done correctly.
- `src/features/plugins/fleet/FleetSpawnTaskModal.tsx:63` and `sub_skills/SkillInstallModal.tsx:106` — the modal-dismiss case: `<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>`. Copy this for every corner X.
- `src/features/agents/sub_lab/components/arena/ArenaPanelColosseum.tsx:214,334` — the only place `disabledReason` is derived as a real explanation string and passed to `Button`. The reference for step 6.
- `src/features/settings/sub_engine/components/PolicyProposalsSection.tsx:264` — the async case, already named as the exemplar by [`inline-busy-state.md:132`](./inline-busy-state.md).

---

## 7. Deviations

**Headline correction to the hypothesis that opened this sweep.** Three of its
four numbers hold; one is wrong in a way that changes the story.

| Claim | Hypothesised | Actual | Verdict |
| --- | --- | --- | --- |
| `.tsx` files | 2,104 | **2,104** | ✅ exact |
| files containing a raw `<button>` | 1,119 | **1,119** | ✅ exact |
| files using `Button` | 58 | **217** | ❌ **3.7× understated** |
| files using `AsyncButton` | 40 | **39** | ✅ within 1 |

The `Button` figure counted only the deep-path import
(`buttons/Button`, 57 files) and missed the **barrel** import
(`from '@/features/shared/components/buttons'`, 155 files), which is the
majority form. **244 files import from the buttons folder; 217 render
`<Button>`.** The real ratio is 1,119 : 217 ≈ **5.2 : 1**, not 19 : 1. It is
still the worst raw-vs-primitive ratio measured, but the primitive is not
abandoned — it is *half-adopted*, which is a different and more tractable
problem. **114 files use both**, which is the clearest possible evidence that
the raw buttons are not a deliberate choice.

### Is it a defect, or is `Button` the wrong shape?

Every one of the 2,751 app-layer elements was classified by shape.
**16.0% are legitimate. 84.0% are drift.**

**Legitimate — 440 elements / 331 files.** `Button` genuinely cannot make these,
or another primitive owns them:

| # | Shape | Elements | Files | Why it is legitimate |
| --- | --- | --- | --- | --- |
| L1 | `role="tab"` / `aria-selected` | 27 | 24 | `SegmentedTabs` / `PanelTabBar` jurisdiction. |
| L2 | `aria-pressed` toggle | 121 | 95 | Toggle semantics; `Button` has no pressed state. |
| L3 | `flex-col` multi-line card | 35 | 31 | `Button` is `inline-flex items-center` (`:194`) — it cannot stack. |
| L4 | `w-full` + `text-left`/`justify-between` row | 250 | 198 | `Button`'s `block` forces `w-full justify-center` (`:199`) — it cannot left-align. See [Gaps §1](#8-gaps). |
| L5 | drag handle (`onPointerDown`/`draggable`) | 7 | 7 | Needs pointer events `Button` does not forward semantics for. |

**Drift — 2,311 elements / 915 files.** `Button` covers these exactly:

| # | Shape | Elements | Files | The primitive that covers it |
| --- | --- | --- | --- | --- |
| D1 | icon-only button (rounded/hover/sized) | **1,577** | **757** | `size="icon-sm\|icon-md\|icon-lg"` + a variant |
| D2 | labelled button with fill/border + padding | **540** | **300** | `variant` + `size` |
| D3 | ghost-hover button | 62 | 51 | `variant="ghost"` |
| D5 | other styled | 115 | 81 | a variant |
| D4 | unstyled `<button>` (no className) | 17 | 12 | `variant="ghost"` |

The answer to the question is therefore: **it is overwhelmingly a defect, and
the largest single bucket is the one the hypothesis guessed was legitimate.**
Icon-only affordances are not an argument against the primitive — `Button` has
had three icon sizes since it was written, and 93 call sites already use them.
Table row actions are the same shape. The genuinely-legitimate exceptions are
narrow, enumerable, and worth 16%.

### Cross-cutting defects (these hold regardless of the shape argument)

| # | Defect | Count | Detail |
| --- | --- | --- | --- |
| X1 | **Icon-only control with no accessible name** | **844 elements** | Neither `aria-label` nor `title` nor text. WCAG 4.1.2. `src/features/plugins/twin/sub_channels/ChannelsAtelier.tsx:293` has `title` but no `aria-label`; hundreds have neither. |
| X2 | Icon-only control named by `title` alone | 302 elements | Not a reliable accessible name; invisible on touch. |
| X3 | **No themed focus ring** | **2,247 of 2,751 (81.7%)** | No `focus-ring` / `focus-visible:` class. **Corrected claim:** there is no global `outline: none` reset (the only one, `globals.css:1180`, is scoped to `input[type=range]`), so these still get the *UA* ring. This is a theming defect — the ring ignores `--focus-ring-color` and every custom vibe — **not** a total loss of focus indication. Severity P2, not P0. |
| X4 | `disabled` with no reason surfaced | 403 elements | No `title`, no `aria-label`, no `disabledReason`. |
| X5 | Drift buttons in files that **already import** `Button` | **232 elements / 93 files** | No shape argument available. Worst: `overview/sub_messages/components/MessageDetailModal.tsx` (13), `onboarding/components/TourPanelBody.tsx` (9), `triggers/sub_smee_relay/SmeeRelayTab.tsx` (9). |
| X6 | Exact variant clones | 75 elements / 55 files | className contains the full `accent` triple or `bg-btn-primary`. Provably `<Button variant=…>`. **This is the gate corpus.** |
| X7 | `Button` call sites overriding the icon size | 23 / 16 files | e.g. `agents/sub_editor/components/PersonaEditorHeader.tsx:142` (`size="icon-sm"` + `className="w-6 h-6"`), `EditorBanners.tsx:51` (`w-7 h-7`, redundant), `sub_executions/replay/ReplayTransportControls.tsx` (6 sites). Defeats the coarse-pointer bump. |
| X8 | **Adopted `Button`s that are still unnamed** | **57 of 93 icon-`Button` call sites** | 29 pass `title` alone, 28 pass no name at all. Adoption did not fix the a11y defect — see [Gap 4](#8-gaps). |
| D6 | **`CopyButton` violates this path from inside the buttons folder** | 1 file | `CopyButton.tsx:74` renders a raw `<button>` with a hand-rolled class string, `rounded-lg` instead of a semantic radius, and `opacity-40 cursor-not-allowed` (`:87`) instead of the `is-disabled` utility. The primitive folder does not follow its own doctrine. |
| D7 | **Dead size presets** | 3 uses / 2 files | `globals.css:1272-1296` `.btn-sm/.btn-md/.btn-lg`, advertised at `Design.md:316`, unused by `Button.tsx`, used 3 times app-wide (`AutomationSetupModal.tsx:116,132`, `RecipeManager.tsx:96`). Delete them or make `Button` use them. |
| D8 | `Button.test.tsx` covers none of this path | 6 tests | All six are about `disabledReason` and `loading`. **Zero** coverage of variant class output, size class output, `focus-ring` presence, icon-only `aria-label`, or `block`. The rule in §9 depends on `Button`'s class output; nothing pins it. |

### The second pass — what is upstream of all of this

Re-reading the corpus asking "why did 915 files each invent a button", one
answer explains the shape of the drift better than laziness does: **the repo
gives three different answers to "what radius is a button", and the primitive is
not the one the design system mandates.**

- `.claude/Design.md:215` — `rounded-interactive` (0.375rem / **6px**) — "Buttons, toggles, chips".
- `eslint-rules/no-raw-radius-classes.cjs` docstring — same: "rounded-interactive — buttons, toggles, chips (6px)".
- `Button.tsx:46-57` — `xs: rounded-md`, `sm: rounded-lg`, **`md` (the default): `rounded-xl`**, `lg: rounded-xl`, `icon-sm: rounded-lg`, `icon-md/lg: rounded-xl`.

The repo overrides Tailwind's scale in `globals.css:374-387`, so those resolve
to `--radius-md` = 0.5rem (8px), `--radius-lg` = 0.75rem (**12px**), and
`--radius-xl` = 1rem (**16px**). By the lint rule's own mapping table, the
default `<Button>` renders at **`rounded-modal`**. And
`no-raw-radius-classes.cjs` **exempts `src/features/shared/components/`**, so
nothing has ever flagged the divergence.

The consequence is directly visible in the corpus. Radius used by app-layer raw buttons:

| Radius | Elements | = |
| --- | --- | --- |
| `rounded-card` | 631 | 12px |
| `rounded-interactive` | 548 | 6px — *what the design system mandates* |
| `rounded-modal` | 413 | 16px — *what `<Button>` actually renders* |
| `rounded-full` | 170 | pill |
| `rounded` | 148 | 4px (Tailwind bare) |
| `rounded-input` | 148 | 8px |
| raw `rounded-lg`/`xl`/`md` | 65 | trips the lint rule |

**A developer who obeys the documented token writes a 6px button. A developer
who obeys the catalog and uses `<Button>` ships a 16px button. They cannot be
made to match, and 548 sites are on one side of that line while the primitive is
on the other.** Every incremental adoption of `Button` on an existing surface is
therefore a visible restyle, which is a strong disincentive precisely where
adoption matters most. This must be decided before §9's rule ships at `error` —
see [Gaps §5](#8-gaps).

---

## 8. Gaps

Real limitations of the primitive. Several deviations above are downstream of
gaps 1–3.

1. **`block` cannot left-align.** `Button.tsx:199` is
   `block ? 'w-full justify-center' : ''` — width and justification are welded
   together. The 250-element L4 bucket (menu rows, listbox options, selector
   rows like `agents/components/PersonaSelector.tsx:124` and
   `teams/sub_mastermind/lib/FleetListPopover.tsx:52`) needs
   `w-full` + `text-left`. **Fix:** split into `block` (width only) and a
   `justify` prop, or accept `align="start|center"`. Until then these 250 are
   correctly hand-rolled and belong on the gate's allowlist.
2. **No stacked/multi-line content.** `Button` is `inline-flex items-center`
   (`:194`). The 35-element L3 bucket (choice cards with a title and a
   description) cannot be expressed. **Fix:** either a `layout="stack"` variant
   or an explicit statement that choice-cards are a separate primitive.
3. **No pressed/toggle state.** 121 elements carry `aria-pressed`.
   `forms/AccessibleToggle` is a *switch*, which is a different control with
   different semantics. There is no toggle-button primitive. **Fix:** add a
   `pressed?: boolean` prop that emits `aria-pressed` and a selected surface, or
   name a separate primitive.
4. **No enforced accessible name — and this is the gap with the hardest
   evidence.** `<Button size="icon-sm">` with no `aria-label` type-checks and
   ships. Of the **93 `Button`/`AsyncButton` call sites that use an `icon-*`
   size**, only **36 pass `aria-label`**; **29 pass `title` alone** and **28 pass
   neither** (`agents/executionPlayer/ExecutionMiniPlayer.tsx:279,291,301`,
   `overview/sub_manual-review/components/ReviewFocusFlow.tsx:362,365,400,416`,
   `agents/sub_editor/components/EditorBanners.tsx:51`, …).
   **61% of the developers who did adopt the primitive still shipped an unnamed
   or badly-named control.** That is the decisive datum in this document:
   adoption alone does not fix the accessibility defect, so a rule that only
   pushes people toward `Button` would leave most of X1 in place.
   **Fix:** make the icon sizes require a name at the type level — a
   discriminated union where `size: 'icon-*'` demands
   `aria-label: string`. This is the single highest-leverage change available to
   the primitive: it converts a lint warning into a compile error, it cannot be
   silenced with a disable comment, and it is the only measure here that reaches
   both the 844 raw sites and the 57 adopted-but-unnamed ones.
5. **The radius contract contradicts itself** (see the second pass, above).
   This is the gap that gates the others: it is not a limitation of `Button` so
   much as an unresolved decision. **Two options, and one must be chosen and
   recorded in `Design.md`:** (a) change `SIZE_CLASSES` to use
   `rounded-interactive` / `rounded-input` and accept a global visual diff on
   217 files' worth of existing `Button` usage; or (b) change `Design.md:215`
   and the lint-rule docstring to say buttons are `rounded-input`/`rounded-card`,
   and migrate the 548 `rounded-interactive` sites. Option (b) is smaller and
   matches what the app looks like today; option (a) matches what is written
   down. Either is fine — **the status quo is not**, because it makes the
   primitive and the token system mutually exclusive.
6. **No test pins any of the class output** (D8). Nothing prevents a future
   restyle of `Button` from silently invalidating both this document and §9's
   rule.

---

## 9. The missing gate

Every deviation above shipped under a green `npm run check`. There is no rule of
any kind about buttons — but there is **proven precedent for exactly this rule
in this repo**: `custom/prefer-status-badge`, `prefer-numeric`,
`prefer-section-card` and `prefer-shared-clipboard` are all "you hand-rolled a
primitive" rules, and `prefer-status-badge.cjs` already demonstrates the design
— key on the *complete* class combo at canonical opacities, suppress the known
false-positive shapes explicitly, ship at warn.

**A gate is appropriate here, but not the obvious one.** "Raw `<button>` is
banned" would fire on 2,751 sites, 440 of them legitimate, and would be ignored
exactly like the 1,135 existing warnings — a figure corrected 2026-08-14 from the
stale "~10,086" in `CLAUDE.md`; the argument is unaffected, since neither gate
fails on warnings at any count. The gate has to key on things that
are provably wrong.

### Signal A — exact variant clone (precision ≈ 100%)

A raw `<button>` whose static `className` contains **`bg-btn-primary`** (that
token exists only to fill `Button`'s primary variant) **or** the complete accent
triple `bg-{c}-500/10` + `text-{c}-400` + `border-{c}-500/2[05]` for one of the
13 `ACCENT_CLASSES` stems. **75 elements / 55 files.** These are not
"button-ish" — they are `<Button variant="primary">` and
`<Button variant="accent" accentColor={c}>` transcribed by hand. Zero judgment,
directly reusing `prefer-status-badge.cjs`'s `classText()` walker (which already
handles template literals, conditionals and `cn()` calls).

### Signal B — control with no accessible name (precision ≈ 100%, highest value)

A `<button>`, `<Button>` or `<AsyncButton>` whose children contain no text node,
no `{t.…}` / `{tx(…)}`, and no `{label|title|name|text|children}` expression,
and which carries none of `aria-label`, `aria-labelledby`, `title`.
**1,080 raw elements / 626 files** (844 of them icon-bearing), **plus 28
`Button`/`AsyncButton` call sites** that pass no name — 1,108 in total. Counting
`title`-only as a defect too (X2, X8) raises it to **1,409**.

Note that the rule must match `Button` and `AsyncButton`, not just `<button>`.
Restricting it to the raw element would exempt the 57 adopted-but-unnamed sites
in [Gap 4](#8-gaps) and reward half-adoption — the exact behaviour that produced
the 114 mixed files.

This is the signal that matters most, because **it does not depend on the
contested judgment at all.** It fires identically whether the author adopts
`Button` or keeps the raw element, so it cannot be argued away with "the
primitive is the wrong shape" — the only way to satisfy it is to name the
control. It is a WCAG 4.1.2 conformance defect on its own terms, and it happens
to route every fixer through this document.

### Signal C — styled for the mouse only (precision ~85%, warn + ratchet)

A raw `<button>` with a `hover:` class and no `focus-ring` /
`focus-visible:` class. **2,106 elements / 820 files.** Noisier and lower
severity (X3: these still get the UA ring), so `warn`, and its value is the
ratchet rather than the message.

### Mechanism

One rule file, **`eslint-rules/prefer-button-primitive.cjs`**, registered in
`eslint.config.js` beside its 21 peers, with three `messageId`s:

| messageId | Severity | Message |
| --- | --- | --- |
| `variantClone` | **error** | `This <button> hand-rolls Button's "{{variant}}" variant. Use <Button variant="{{variant}}"{{accent}}> from @/features/shared/components/buttons — see docs/concepts/golden-paths/button.md.` |
| `unnamedControl` | **error** | `Icon-only control has no accessible name. Add aria-label={t.…} (not title=). See docs/concepts/golden-paths/button.md.` |
| `unthemedFocus` | warn | `This <button> is styled for hover but has no focus-ring, so keyboard users get the browser's unthemed ring. Prefer <Button>, which applies focus-ring.` |

ESLint is the right host rather than a `scripts/check-*.mjs` grep, for the
structural reason [`inline-busy-state.md:279-284`](./inline-busy-state.md)
already established: `eslint.config.js` loads each rule with a top-level
`require()`, so a missing or broken rule file **throws at config load and ESLint
exits non-zero**. A grep script whose glob matches nothing exits 0 — the
failure mode `ci.yml` is already a museum of.

### Allowlist

Named exceptions, each traceable to a Gap:

- `src/features/shared/components/buttons/**` — the primitives themselves.
  (Note: this exemption is what currently hides D6; scope it to `Button.tsx` and
  `AsyncButton.tsx` only, so `CopyButton.tsx` is flagged.)
- `role="tab"` / `aria-selected` present → **L1**, `SegmentedTabs` territory (27).
- `aria-pressed` present → **L2**, [Gap 3](#8-gaps) (121).
- `flex-col` in className → **L3**, [Gap 2](#8-gaps) (35).
- `w-full` with `text-left` or `justify-between` → **L4**, [Gap 1](#8-gaps) (250).
- `onPointerDown` / `draggable` → **L5** (7).
- `aria-hidden="true"` **and** `tabIndex={-1}` → decorative, out of the a11y
  tree; the only exemption from `unnamedControl`.
- `*.test.tsx` / `*.stories.tsx`.
- **No allowlist for `variantClone`.** There is no legitimate reason to
  transcribe `bg-btn-primary` or the accent triple onto a raw element.

Each allowlist entry that maps to a Gap must carry the Gap number in a comment,
so that closing Gap 1 mechanically shrinks the allowlist rather than leaving a
permanent hole.

### How it fails loudly if its own precondition is absent

The rule rests on four things that can rot silently. Each gets a guard.

1. **`Button`'s class output still matches what the rule keys on.** `Signal A`
   is only valid while `bg-btn-primary` and the accent triple are what `Button`
   emits. Close gap D8 first: add to `Button.test.tsx` an assertion that
   `<Button variant="primary">` emits `bg-btn-primary`, that
   `<Button variant="accent" accentColor="violet">` emits all three
   `border-violet-500/25 bg-violet-500/10 text-violet-400` classes, and that
   `<Button size="icon-sm">` emits `w-7 h-7` **and** the
   `[@media(pointer:coarse)]` pair — each with a comment naming this golden
   path. The day someone restyles `Button`, those tests fail in the same commit
   that would have made the rule wrong.
2. **`focus-ring` is still the mechanism.** Assert in the same file that a
   rendered `Button` carries `focus-ring`. If it is ever inlined or renamed,
   `unthemedFocus` becomes 2,106 lines of wrong advice; this test says so.
3. **The rule still matches its own corpus.** Ship it with `RuleTester` cases in
   `src/test/eslint-rules/customRules.test.ts` (the existing harness, covering
   12 of 21 rules) — one `invalid` case per `messageId` with an exact
   `errors: N`, plus one `valid` case per allowlist entry. `RuleTester` **fails
   when a rule stops reporting**, which is precisely the silent-decay mode a
   grep gate cannot detect.
4. **The migration ratchets down, never up.**
   `scripts/check-button-adoption.mjs` records the remaining count per
   `messageId` in a committed baseline and fails when any count rises. It must
   `process.exit(1)` — **not 0** — when the baseline file is missing **or** when
   its file glob returns zero matches, because "found nothing" and "looked at
   nothing" are otherwise the same exit code.

### Sequencing — this matters

Ship in this order, because two of the three signals have a precondition:

1. **`unnamedControl` at `error` immediately.** It has no dependency on the
   radius decision, no dependency on `Button`'s styling, and it is a real a11y
   defect. 1,080 sites, each with a one-line fix. This is the whole gate's value
   even if nothing else lands.
2. **`unthemedFocus` at `warn` with the ratchet immediately.** Cheap, bounded, no
   preconditions.
3. **`variantClone` at `error` only after [Gap 5](#8-gaps) is decided** and
   `Design.md` records which radius a button has. Telling 55 files to adopt a
   primitive that will change their shape — while a different lint rule tells
   them the opposite — is how a gate loses its authority. 75 sites is a small
   enough corpus to hold until the contradiction is resolved.

And the one change worth more than all three: **[Gap 4](#8-gaps) — make
`size="icon-*"` require `aria-label` at the type level.** That converts the
844-element defect class from a lint warning into a compile error, and unlike an
ESLint rule it cannot be disabled with a comment.
