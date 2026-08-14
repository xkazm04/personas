# Golden path — Design token usage

> Situation node: `ui-system/design-tokens-theming/design-token-usage` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. **Recurrence 2,104 — the widest leaf in the corpus.**
> Sweep: every file under `src/**` — **4,829 files (2,725 `.ts` + 2,104 `.tsx`)** — parsed for
> twelve token axes; plus full reads of `globals.css`, `typography.css`, `designTokens.ts`,
> `statusTokens.ts`, `Button.tsx`, `SectionCard.tsx`, `StatusBadge.tsx`, `.claude/Design.md`,
> all 21 custom ESLint rules, a **full `npx eslint` run over the whole corpus** (JSON,
> counted per rule), and a twelve-axis convergence census of the sibling repo `personas-web`.
> Dimensions: **ui · code-quality**.
> **Settles:** which vocabulary a visual decision is written in, and who is allowed to spell it out by hand.
>
> Counts below were measured during composition. Where they touch
> [`shared-facts.json`](../shared-facts.json) they agree with it, with one correction
> noted in §7.0. Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated
and every clause carries its **warrant**, so an adopting repo can tell physics from local
calibration. No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A visual property that the design system names must be written in the
> system's name for it, never in the underlying scale. The scale is an implementation detail
> the system reserves the right to re-point.
>
> **P2 — physics, and the reason P1 is not merely tidy.** A system that re-points the
> underlying scale in place has made every raw scale class a **lie** — the class still
> compiles, still looks deliberate in review, and now renders a different value than its
> name says. Retuning the scale and permitting raw scale classes are mutually exclusive;
> pick one.
>
> **P3 — physics.** The layer that *defines* the tokens must be the layer that *uses* them
> most rigorously. When a primitive is written in raw values, every call site that adopts
> the primitive inherits the raw value while believing it inherited the token — and the
> divergence is invisible precisely where it propagates furthest.
>
> **P4 — physics.** A token is a decision made once. If the same decision is re-derived at
> the call site, the system ends up holding a value nothing renders while the app holds N
> values nothing names. Count the distinct values in flight: that number is the token's
> real adoption, and a token whose canonical value appears less often than its
> alternatives has already lost.
>
> **P5 — physics.** A composite token owns *all* the properties it declares. Patching one
> of them with a utility is either silently discarded or silently wins — and which one
> depends on cascade mechanics no call site can see. The legal move is to select a
> different token, never to amend the one you have.
>
> **P6 — ergonomics, with a measured cause.** Delivery format predicts adoption far less
> than enforcement does, but it is not free: a token you must *import* competes with a
> class you can *type*, and loses. Ship tokens in the same notation as the thing they
> replace wherever the platform allows it.
>
> **P7 — ergonomics.** A deny-list gate ("these class names are banned") certifies as
> correct every name it has not enumerated, including names that do not exist. Only an
> allow-list can tell a token from a typo.
>
> **P8 — governance.** A gate that exempts a directory has not made that directory
> compliant; it has made it *unmeasured*. Every exemption must name the gap it stands in
> for, so that closing the gap mechanically shrinks the exemption.
>
> **Scale condition.** P1–P5 pay from the first surface. P6 and P8 begin to bite around the
> point where more than one team-equivalent touches the system. P7 pays once the token
> vocabulary is larger than a reviewer can hold in their head.

**Warrant evidence — and one clause demoted.** A twelve-axis census of `personas-web`
(Next.js, separate remote, no shared package — its `tokens.css:1-11` claims a shared
monorepo that **does not exist**) separates physics from house taste, and the result
corrected this document's opening premise:

- **Semantic *colour* tokens are physics.** `personas-web` independently arrived at
  `--foreground` / `--muted` / `--card-bg` / `--status-{success,warning,error,info}` across
  11 themes and uses them **3,160 times**, a **63.4%** semantic share. This repo measures
  **66.2%**. Two stacks, no shared code, within three points.
- **P2 is physics, and both repos found the hazard the hard way.** Both override Tailwind's
  `--radius-*` scale *in place* — `--radius-lg` is `0.75rem` here (`globals.css:376`) and
  `1rem` there — so in both codebases `rounded-lg` silently means something other than
  Tailwind's `rounded-lg`. Neither repo appears to have noticed; the hazard was reinvented,
  not shared.
- **Semantic *radius/elevation/spacing tiers* are house calibration, not doctrine.**
  `personas-web` has **zero** role-named radius tokens (`--radius-card`, `--radius-modal`,
  … : 0 matches), **zero** shadow tiers, and **zero** named spacing constants. It renamed
  the scale rather than adding a role layer. **So `rounded-card` / `shadow-elevation-2` /
  `CARD_PADDING` are this house's calibration of P1 — adopt the principle, not our nouns.**
- **The controlled experiment.** `personas-web` carries the *same ten* `typo-*` class names,
  fully defined with per-script overrides at its `typography.css:120-191` — and **zero call
  sites**, against 1,462 raw `text-*`. The identical names mean this was transplanted, not
  reinvented; which makes it the sharper evidence. **The same artifact, in the repo with a
  lint rule, reached 10,230 call sites; in the repo with none, it reached 0.**

---

## 1. Trigger

- "make this card/panel/badge look right", "match the styling of that other row"
- "add a subtle border", "dim it when it's disabled", "make this label stand out"
- "the spacing feels off here", "round the corners a bit more"
- "copy the styles from `<neighbouring file>`"
- **If you are about to type** `rounded-`, `text-` followed by a size, `shadow-`, `p-`/`gap-`,
  `opacity-`, `duration-`, `font-bold`, a Tailwind palette colour (`text-slate-400`,
  `bg-emerald-500/10`), or `#` inside a `className` — you are in this situation.
- If you are about to paste a `className` string longer than about six utilities, you are
  in this situation and probably also in [`button.md`](./button.md) or
  [`empty-and-demo-states.md`](./empty-and-demo-states.md).

You are **not** in this situation for one-off internal micro-layout that no token names —
`flex`, `items-center`, `gap-2` between two icons, `absolute top-2 right-2`. Layout
positioning is not a token axis here. Everything that has a *tier* is.

---

## 2. The one way

**Write the semantic name, never the scale.** Radius is
`rounded-{interactive|input|card|modal|pill}`, type is `typo-*`, elevation is
`shadow-elevation-{1..4}`, colour is `text-foreground` / `text-primary` / `bg-secondary` /
`border-border` and — for anything that means a *status* — a `StatusToken` pulled from
`STATUS_PALETTE`, never a hand-picked Tailwind hue. **Never spell a raw scale class
(`rounded-lg`, `text-sm`, `shadow-md`): this repo re-points Tailwind's scale in
`globals.css:373-387`, so those names no longer mean what Tailwind says they mean, and a
reviewer reading `rounded-lg` cannot know it renders 12px.** When a token declares several
properties at once — every `typo-*` tier declares `font-size`, `font-weight` and
`line-height` together — **select a different tier rather than patching one property**; the
`.typo-*` rules are unlayered CSS and beat every Tailwind utility, so
`typo-caption font-semibold` renders as `typo-caption` and silently discards your intent
(`typography.css:161-162` says so in its own comment; 2,005 call sites do it anyway).
For an inert control write **`disabled:is-disabled`** and stop — it is opacity, cursor and
`pointer-events` in one utility, tied to `--disabled-opacity`; never pick your own
`disabled:opacity-40`. For a card's inner padding and a section's rhythm, import
`CARD_PADDING` / `SECTION_GAP` from `designTokens.ts`, because those are the only spellings
wired to the `--density-*` variables that the Appearance → Density setting re-maps — a raw
`p-4` is a card that ignores a user preference the app ships. **And if you are writing a
shared primitive, all of the above binds you harder, not less**: four of the five token lint
rules exempt `src/features/shared/components/` and/or `src/lib/`, so the primitive layer is
the one place where a wrong token has no detector at all (§7.C).

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/styles/globals.css:380-387`** — `--radius-interactive` 6px · `--radius-input` 8px · `--radius-card` 12px · `--radius-modal` 16px, bridged to Tailwind at `:498-506` | The four role radii, plus back-compat `rounded-container` (= card) and `rounded-secondary` (= sm). **4,819 hits / 1,369 files.** |
| **`src/styles/typography.css:105-358`** — 15 `typo-*` tiers | Size + weight + line-height + font-features as one decision, re-mapped under `[data-text-scale]` and per-`[data-lang]` script. **10,230 hits / 1,592 files — the best-adopted token in the repo.** |
| **`globals.css:391-394`** — `--shadow-elevation-1..4` | Four depth tiers; the `@theme` block re-points Tailwind's `shadow-md` etc. at them, so even a mistake resolves correctly. **518 hits / 395 files.** |
| **`globals.css:31-35` — `.is-disabled`** | `opacity: var(--disabled-opacity)` (0.45, `:413`) + `cursor: not-allowed` + `pointer-events: none`. The whole inert state, one class. Use as `disabled:is-disabled`. |
| **`globals.css:11-16` — `.focus-ring`** | The themed `:focus-visible` outline. Owned by [`focus-management.md`](./focus-management.md) and [`button.md`](./button.md); listed here only so the token inventory is complete. |
| **`src/lib/design/statusTokens.ts`** — `STATUS_PALETTE` (5), `STATUS_PALETTE_EXTENDED` (+ai/rotation/critical/caution), `SEVERITY_ACCENTS`, `SETTINGS_ICON_ACCENTS`, `healthScale()`, `healthClasses()` | The only sanctioned source of a status colour. Each `StatusToken` is `{text,bg,border,ring,icon}` so a badge, a chip and a left-accent all derive from one entry. |
| **`src/lib/utils/designTokens.ts`** — `CARD_PADDING`, `SECTION_GAP`, `LIST_ITEM_GAP`, `FORM_FIELD_GAP`, `BORDER_{SUBTLE,DEFAULT,EMPHASIS,HOVER}`, `DIVIDE_SUBTLE`, `MOTION`, `STATE_DISABLED_OPACITY`, `STATE_LOCKED` | The JS-side tokens. `CARD_PADDING` / `SECTION_GAP` emit `p-[var(--density-pad)]`-style classes and are **the only way a surface participates in the Density setting**. |
| **`globals.css:342-354, 793-807`** — `--density-pad`, `--density-pad-sm`, `--density-gap`, `--density-gap-lg` under `[data-density="cozy|compact"]` | The runtime half of the spacing tokens. |
| **`.claude/Design.md`** | The prose index of all of the above. Authoritative on intent; §7.D records where it is authoritative and wrong. |

**Explicitly NOT primitives here.** `INPUT_FIELD` / `INPUT_FIELD_ERROR` /
`inputFieldClass()` (`designTokens.ts:103-113`) are *named* like tokens and are the
documented answer for "every text input" (`Design.md:188`), but they hardcode `rounded-xl`
and `text-sm` — the modal radius and a raw type size — see §7.C. Use them for the focus and
border behaviour; do not treat their radius or type as the token. Likewise `BUTTON_VARIANTS`
(`designTokens.ts:115-134`) is a third, redundant button-variant vocabulary alongside
`Button`'s `variant` and `accentColor`; [`button.md`](./button.md) owns that decision.

---

## 4. Steps

1. **Name the property before you write it.** Radius / type / elevation / colour / spacing /
   inert-state / motion. If it has a tier, it has a token, and steps 2–6 apply. If it is
   pure layout (`flex`, `items-center`, `absolute`), write Tailwind and stop.
2. **Write the role, not the size.** `rounded-card`, not `rounded-lg` — even when you have
   checked that they are numerically equal today, because `globals.css:373-387` is exactly
   the file that will make them unequal tomorrow.
3. **For type, pick one `typo-*` tier and add nothing.** No `text-sm`, and — the one most
   people get wrong — **no `font-medium` / `font-semibold` / `font-bold`.** Every tier
   already declares a weight; the utility is discarded. If it is not emphatic enough,
   move up a tier: `typo-caption` → `typo-title` → `typo-heading`.
4. **For anything meaning a status, import the token.**
   `STATUS_PALETTE.success.text`, not `text-emerald-400`. A literal palette class is only
   acceptable for decorative, non-semantic colour, and even then it will not track a theme.
5. **For an inert control, write `disabled:is-disabled` and stop.** Not
   `disabled:opacity-50 disabled:cursor-not-allowed` — that is two classes to say what one
   says, at a value the system does not hold.
6. **For a card's padding or a section's rhythm, import `CARD_PADDING` / `SECTION_GAP`.**
   This is the only step that requires an import rather than a class, and it is the step
   with 0.8% adoption. It is also the only one with a *functional* consequence: a raw `p-4`
   card does not respond to the Density setting.
7. **Ask the type question before you reach for a `className`.** If you are passing a
   `className` to a shared primitive that contains a radius, type, padding or elevation
   class, you are overriding a decision the primitive was built to own. Either the
   primitive needs a new variant, or you need a different primitive. 125 files currently
   do this to `<Button>` alone and 30 to `<StatusBadge>`; none of them added a variant.
8. **If you are editing a file under `src/features/shared/components/` or `src/lib/`,
   re-read steps 2–6 and apply them literally.** No lint rule will catch you there for
   radius or white; nothing at all will catch you for spacing, inert-state or motion. The
   primitive layer is the highest-leverage and least-observed place in this document.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `rounded-lg` / `rounded-xl` / `text-sm` / `shadow-md` | The scale is re-pointed (`globals.css:373-387`). `rounded-lg` is 12px, not Tailwind's 8px. The class name is now misinformation to every reader, and to every reviewer comparing two files. |
| `typo-body font-medium` | The commonest defect in this document — **821 occurrences of this exact pair.** `.typo-body` is unlayered and declares `font-weight: 400`; the utility is in `@layer utilities` and loses unconditionally. You asked for medium and shipped normal, and the code reads as though you got what you asked for. |
| `disabled:opacity-40 disabled:cursor-not-allowed` | Re-deriving a state the system defines once. Ten different opacities ship; the token's own value (0.45) appears once in 594. Two classes replaced by one, at a value nobody chose. |
| `text-emerald-400` for "success" | Bypasses `STATUS_PALETTE`, so the next brightness/theme pass tunes the token and not you. `Design.md:134` — "never invent a new red" — and there are now three separate copies of the severity-accent table (`statusTokens.ts:149`, re-exported at `designTokens.ts:163`, re-derived at `SectionCard.tsx:50-56`). |
| `p-4` on a card | Invisible defect: the card opts out of the Density setting the app ships in Appearance *and* in the onboarding tour. 595 of 913 card-bearing files do this; 7 do not. |
| `text-md` | **This class does not exist.** Not in `globals.css`, not in `typography.css`, not in Tailwind's default theme (`node_modules/tailwindcss/theme.css:347-366` goes `xs, sm, base, lg, xl, 2xl…`), and there is no `tailwind.config`. It renders nothing. 230 occurrences in 63 files — including four of `Button`'s seven sizes. |
| A `className` on a shared primitive that repaints radius / type / padding / elevation | You have forked the primitive at one call site. The next restyle of the primitive will not reach you, and the divergence has no name. |
| Adding a token rule with a path exemption | The exemption does not make the directory compliant, it makes it unmeasured — and it will be the directory whose values propagate furthest. §7.C is entirely this. |
| Writing a new token as a TS constant when a CSS class would do | Measured cost: every class-delivered token in this repo sits at 94–99% adoption *or* is ungated; every import-delivered token sits at 0.2–3.4%. |

---

## 6. Evidence

**The one site to copy:**
`src/features/vault/sub_credentials/components/gateway/GatewayMembersModal.tsx:25-33`.
It imports `CARD_PADDING`, `SECTION_GAP`, `LIST_ITEM_GAP` and `INPUT_FIELD` together
(`:208` `CARD_PADDING.standard`, `:209` `SECTION_GAP.between`, `:235` `LIST_ITEM_GAP.dense`)
and composes them with `BaseModal` and `Button`. It is the only file in the repo that uses
three spacing tokens at once, and it is what step 6 looks like when someone actually does it.

**For the inert state:**
`src/features/agents/quick-answer/triage/deck/DeckActionBar.tsx:48` and `:75` —
`focus-ring … rounded-full … shadow-elevation-2 … disabled:is-disabled` and
`focus-ring … rounded-interactive … typo-body … disabled:is-disabled`. Five token axes,
zero raw scale classes, in one class string. `DeckTopBar.tsx:48` is the same shape with
`rounded-pill` / `typo-caption`. These four are **the entire app-layer adoption of
`is-disabled`**, which is the point.

**For type:** any of the 1,592 files using `typo-*` — this is the axis that works. The
instructive read is the token file itself, `src/styles/typography.css:147-168` and
`:186-197`, where the reasoning for `typo-caption`'s weight and the "adding `font-*` here
is silently a no-op" warning are both written down. The rule in §9 is that comment,
enforced.

**For card padding under density:** `src/features/agents/sub_lab/components/shared/LabResultCard.tsx:54,84,105`
— `CARD_PADDING.standard` for header and body, `.compact` for the dense row. It is the
cleanest use of the density-aware tier.

**For status colour:** `src/lib/design/statusTokens.ts:179-188` — `healthScale()` /
`healthClasses()`. Ten files import from this module. It is the right shape (one entry
yields text, bg, border, ring and dot) with almost no adopters — see Gap 3.

---

## 7. Deviations found

### 7.0 Two corrections to the numbers this sweep was handed

**(a) The lint baseline is stale by 8.9×, and its composition is wrong.**
`.claude/CLAUDE.md` records "0 errors, ~10,086 warnings … almost entirely
`custom/no-raw-*-classes` … and `custom/no-hardcoded-jsx-text`". A full
`npx eslint "src/**/*.{ts,tsx}"` run over the whole corpus today measures:

| | warnings | share | files |
| --- | ---: | ---: | ---: |
| **total** | **1,135** | | **246** of 4,829 |
| `custom/no-low-contrast-text-classes` | 705 | 62.1% | 179 |
| `custom/no-hardcoded-jsx-text` | 226 | 19.9% | 56 |
| `custom/no-raw-radius-classes` | 128 | 11.3% | 44 |
| `custom/no-raw-text-classes` | 16 | 1.4% | 12 |
| everything else (11 rules) | 60 | 5.3% | |
| `custom/no-raw-shadow-classes` | **0** | | |
| errors | **0** | | |

All four `no-raw-*-classes` rules together are **144 warnings (12.7%)**, not the dominant
mass. The dominator is a *colour/opacity* rule. **This inverts the premise this leaf was
briefed with** — "a warn-level rule in a sea of ~10,086 is indistinguishable from noise".
There is no sea. 1,135 warnings across 246 files is a readable list. The token rules are
not failing because they are drowned; they are failing because **five of the eight token
axes have no rule at all, and the rules that exist do not look where the violations are.**

**(b) `shared-facts.json`'s `frontend.tsFiles: 4829` is the combined `.ts` + `.tsx` total,
not the `.ts` count.** Measured: `src/**` holds **2,725 `.ts` + 2,104 `.tsx` = 4,829**.
(`focus-management.md`'s header reads it as "4,829 `.ts` + 2,104 `.tsx`", which
double-counts; its census output — 6,933 *file-visits* across two rules with different
`extensions` — is correct and reproduces exactly here.)

### 7.A The headline — adoption tracks enforcement, not merit

Twelve axes, measured over the same 4,829 files. Sorted by adoption:

| Axis | Token delivered as | Machine check | On-token | Off-token | Adoption |
| --- | --- | --- | ---: | ---: | ---: |
| Type size/weight | **CSS class** `typo-*` | `no-raw-text-classes` warn, **no path exemption** | 10,230 / 1,592 f | 105 raw / 56 f | **99.0%** |
| Elevation | **CSS class** `shadow-elevation-N` | `no-raw-shadow-classes` warn | 518 / 395 f | 3 raw / 2 f | **99.4%** |
| Radius | **CSS class** `rounded-<role>` | `no-raw-radius-classes` warn, **exempts primitives + lib** | 4,819 / 1,369 f | 307 / 111 f | **94.0%** |
| Colour (theme) | **CSS class** `text-foreground`… | `no-direct-white-colors` warn (white only) | 24,613 / 1,731 f | 12,460 palette / 1,141 f | 66.2% |
| Focus ring | **CSS class** `focus-ring` | **none** | 616 / 289 f | — | 15.7% ([focus-management.md](./focus-management.md) §7.G) |
| Motion | import `MOTION.duration` | **none** | 14 / 7 f | `duration-N` 196 / 118 f | 3.4% |
| Status colour | import `STATUS_PALETTE` | `prefer-status-badge` warn (3 hits) | 103 / 10 f | 12,460 palette literals | ~0.6% |
| Border tier | import `BORDER_DEFAULT`… | **none** | 22 / 4 f | — | ~0.2% |
| Card padding | import `CARD_PADDING` | `no-raw-spacing-classes` **`off`** | 26 / 10 f | 595 card files on raw `p-N` | **0.8%** |
| Section rhythm | import `SECTION_GAP` | **`off`** | 5 / 3 f | — | ~0.2% |
| **Inert state** | **CSS class** `is-disabled` | **none** | **9 / 6 f** | **815 / 361 f** | **1.0%** |
| Text hierarchy | "type scale, never opacity" (`Design.md` #4) | `no-low-contrast-text-classes` warn | — | `text-foreground/N` 1,906 / 760 f, 12+ values | 705 open warnings |

Two variables, and their relative weight is unambiguous:

- **Every class-delivered token with a rule sits at 94–99%.**
- **Every class-delivered token *without* a rule collapses** — `focus-ring` to 15.7%,
  `is-disabled` to 1.0%. Same delivery format, same discoverability, no gate.
- **Every import-delivered token sits at 0.2–3.4%**, gate or not.

So delivery format matters (P6) but enforcement dominates. And `personas-web` supplies the
counterfactual for the top row: **the same `typo-*` layer, with no lint rule, has zero
adopters there against 10,230 here.**

**The one honest complication, and it sharpens the rule rather than weakening it.**
`no-low-contrast-text-classes` *is* a rule and its axis is the worst in the table. The
difference is what the rule asks for. Every other token rule names a 1:1 replacement
(`rounded-lg` → `rounded-card`) and converges. This one says "stop expressing hierarchy
with opacity" and the replacement is a *design decision* per site. **A gate converges where
the fix is mechanical and accumulates where the fix needs judgment** — which is exactly why
§9's two rules were chosen for having one legal answer each, and why the third candidate
was deferred.

### 7.B The largest single defect — 2,005 silently-discarded weights

**`typo-*` + a `font-*` weight utility in one class string: 2,005 occurrences across
824 files — 39% of every `.tsx` file in the app.**

Verified from source, not inferred: `typography.css` is imported at `globals.css:3` with no
`layer()`, its only `@layer` is a `base` block for `typo-caption`'s colour, and all 15 real
tiers declare `font-weight` (checked; the two that do not, `.typo-rtl` and
`.typo-hero-shine`, are modifiers). Unlayered declarations beat every `@layer utilities`
declaration regardless of source order or specificity. So the utility never applies.

| Pair | × |
| --- | ---: |
| `typo-body font-medium` | 821 |
| `typo-caption font-medium` | 518 |
| `typo-heading font-semibold` | 171 |
| `typo-caption font-semibold` | 90 |
| `typo-body font-semibold` | 68 |
| `typo-label font-semibold` | 52 |
| …9 further pairs | 285 |

Worst files: `TestReportModal.tsx` (22), `ArenaPanelColosseum.tsx` (15),
`ArenaResultsView.tsx` (14), `AutomationConditionStep.tsx` (12),
`shared/components/modals/ExecutionDetailModal/OutputSections.tsx` (12),
`SmeeRelayTab.tsx` (12).

This is not a style preference — it is 2,005 authored intentions that the browser throws
away, in a codebase where the token file warns about it **twice, verbatim**
(`typography.css:161-162`, `:190-191`) and `Design.md:82-87` warns a third time. Three
written warnings, zero machine checks, 824 files. It is the cleanest possible demonstration
of the contract's "documentation does not hold a line".

Relatedly and much smaller: **12 class strings hold both a `typo-*` tier and a raw
`text-<size>`** (`HomeReleases.tsx:68,72,103,105,123`, `MetricHelpPopover.tsx:108`,
`BrainAtelier.tsx:320`, `TwinHero.tsx:22`, …) — same mechanism, same outcome. Note that
`no-raw-text-classes.cjs:44` **deliberately skips any className containing `typo-`**, so
these 12 are exempted by design. The rule's largest suppression is applied to the exact
combination the design system documents as broken.

### 7.C The primitive layer is where the tokens are not spoken — and it is exempt

**Four of five token rules exempt the layer that defines the design system, and no two
exempt the same set.** Read from the rule sources:

| Rule | `shared/components/` | `src/lib/` | `designTokens` / `globals.css` |
| --- | :---: | :---: | :---: |
| `no-raw-radius-classes` (`:46-52`) | **exempt** | **exempt** | exempt |
| `no-direct-white-colors` (`:28-33`) | **exempt** | `src/lib/ui` only | exempt |
| `no-raw-shadow-classes` (`:45-47`) | linted | **exempt** | exempt |
| `no-raw-text-classes` | linted | linted | linted |
| `no-low-contrast-text-classes` | linted | linted | linted |

Nobody chose this matrix; it accreted one rule at a time. And it predicts the deviations
precisely: **typography, the one axis with no path exemption anywhere, is the one axis at
99% including inside the primitives.**

**Radius, measured against the rule's actual reach.** 307 raw radius classes exist. The
rule can see **130 (42.3%)**:

| Bucket | files | hits |
| --- | ---: | ---: |
| **A — visible to the rule** (`.tsx`, app layer, inside a `className` attribute) | 45 | **130** |
| B — hidden: `.ts` file, so no JSX for a `JSXAttribute` visitor to reach | 1 | 2 |
| **C — hidden: exempt path** (`shared/components/` 154, `src/lib/` 5) | **54** | **159** |
| D — hidden: `.tsx`, app layer, but not inside a `className` attribute (module-scope maps) | 11 | 16 |
| | | **57.7% invisible** |

(Bucket A's 130 against ESLint's 128 reported warnings: the rule `exec`s once per string, so
a className holding two raw radii reports once.)

**Concrete consequences, all in the exempt half:**

- **`designTokens.ts:104` — `INPUT_FIELD`**, the token `Design.md:188` mandates for "every
  text input", is `… rounded-xl text-sm …`. **A `rounded-xl` input renders at 16px — the
  *modal* tier — where `Design.md:216` mandates `rounded-input` (8px).** It also carries a
  raw type size and, at `:108`, `INPUT_FIELD_ERROR` hand-rolls a focus ring
  (`focus-visible:ring-red-500/40`) instead of `focus-ring`, plus `border-red-500/50`
  instead of a status token. **The file that defines the tokens is written in raw classes,
  and it is exempt from three of the five rules that would say so.**
- **`designTokens.ts:247` — `SIMPLE_MODE.CARD`** is `rounded-xl` where a card is
  `rounded-card` (12px).
- **`SectionCard.tsx:58-62`** — the card primitive that `custom/prefer-section-card` routes
  people *to* — renders `sm: rounded-lg`, `md: rounded-xl`, `lg: rounded-xl`. Its `md` and
  `lg` sizes are modal-radius cards. Its `STATUS_BORDER` (`:11-17`) is a third copy of
  `SEVERITY_ACCENTS`.
- **`StatusBadge.tsx:47-50`** — `SIZE_CLASSES` is `text-[10px]` and `text-xs`; a badge
  primitive with an arbitrary type size and a raw one, and no `typo-*` anywhere.
- **`Button.tsx:46-56`** — five raw radii and `text-md` ×4. Owned by
  [`button.md` Gap 5](./button.md#8-gaps); cited here only because it is the same disease as
  the three above, and this section is the diagnosis `button.md` asked for. **`button.md`
  found the contradiction in one primitive; it is in at least four, and the exemption is why.**
- **51 files / 154 hits of raw radius under `shared/components/`** in total.

### 7.D `text-md` — 230 occurrences of a class that does not exist

**No `--text-md` is defined in `globals.css` or `typography.css`; there is no
`tailwind.config` (this is Tailwind 4 CSS-first); and Tailwind's own theme
(`node_modules/tailwindcss/theme.css:347-366`) has no `md` step.** `text-md` renders
nothing. **230 occurrences across 63 files**, including `Button.tsx:47-50`, which means
**every labelled `<Button>` in the app has no font-size of its own and inherits from its
parent.**

Why nothing caught it: `no-raw-text-classes.cjs:41` is a **deny-list** —
`text-(xs|sm|base|lg|xl|2xl|…)`. `md` is not on it, so `text-md` is certified correct by
the same rule whose job is font sizes. **A deny-list gate cannot distinguish a token from a
typo** (P7). This one class has survived 63 files' worth of review because it *looks* like
it belongs to the scale.

### 7.E The Density setting is a near-total no-op

`--density-pad` / `--density-gap` are re-mapped by `[data-density="cozy"|"compact"]`
(`globals.css:793-807`), driven by a shipped Appearance setting
(`sub_appearance/components/AppearanceDensitySettings.tsx`) that also has its own
**onboarding step** (`onboarding/components/AppearanceStep.tsx`). The only spellings bound
to those variables are `CARD_PADDING` and `SECTION_GAP`.

- Files containing `rounded-card` (i.e. a card surface): **913**.
- Of those, using `CARD_PADDING`: **7**. Using a raw `p-N` instead: **595**.
- **Density adoption on card surfaces: 0.8%.**

Density still adjusts `typo-body` line-height (`globals.css:811-813`), which is broadly
adopted — so the setting does something. Its padding half reaches 7 files. A user who
selects "Compact" gets tighter line-height and the same padding everywhere.

### 7.F Inert state — one token, ten values, four adopters

- `disabled:opacity-N` — **594 hits / 357 files**, across **ten distinct values**:
  `50`×259, `40`×239, `30`×60, `60`×30, and one each of `25, 35, 45, 70, 0, 100`.
  **The token's own value, 0.45, appears once.**
- `disabled:cursor-not-allowed` — 221 hits / 167 files, which `is-disabled` also supplies.
- `is-disabled` — **9 hits / 6 files**, and **4 of those 9 are the token/primitive/test
  files themselves** (`designTokens.ts` ×2, `Button.tsx` ×2, `Button.test.tsx` ×1).
  App-layer adoption is **4 hits / 3 files**.
- `STATE_DISABLED_OPACITY`, the JS constant that emits `disabled:is-disabled` and is
  documented at `Design.md:190` — **1 occurrence, its own definition. Zero consumers.**
- Of **599 files containing a `disabled` binding, 6 use the token and 361 hand-roll it.**

The primitive layer is not the exception: `DataGrid.tsx:465,533,562`,
`ConfirmDialog.tsx:75,84`, `ThemedSelect.tsx:140`, `NumberStepper.tsx:190`,
`KeyValueEditor.tsx:139`, `ChatInputBar.tsx:111,158`, `ConfirmDestructiveModal.tsx:139`,
`UnsavedChangesModal.tsx:44,55` and 8 more shared components all hand-roll it. `Button.tsx`
is the only shared component that does not.

> Boundary: [`button.md` X4](./button.md#7-deviations) counts 403 disabled buttons with no
> `disabledReason` — that is *why the control is inert, explained to the user*. This is
> *how inertness is painted*. Different condition, different corpus (`.ts` files and
> non-button elements included), no overlap in the fix.

### 7.G Colour — the axis where the token exists and the palette wins anyway

- Semantic colour utilities (`text-foreground`, `bg-secondary`, `border-border`,
  `text-status-*`, …): **24,613 hits / 1,731 files.**
- Literal Tailwind palette utilities (`text-slate-400`, `bg-emerald-500/10`, …):
  **12,460 hits / 1,141 files** — a **33.5%** share.
- `text-white` / `bg-white` / `-black` family: 109 hits / 73 files. `no-direct-white-colors`
  reports **3**, because it matches only `text-white` / `bg-white` (not `border-`, `ring-`,
  `divide-`, and nothing black at all) and exempts `shared/components/` + `src/lib/ui`.
  `AccessibleToggle.tsx:54` (`bg-white`), `BaseModal.tsx:180-181` (`bg-black/60`),
  `authMethodStyles.ts:18` (`bg-white/10` in a `.ts` file) are all invisible to it.
- Arbitrary colour literals in class position (`bg-[#…]`, `text-[rgb(…)]`): 13 / 10 files.
- `STATUS_PALETTE` importers: **10 files.**

The honest reading: `Design.md:120-134` only forbids palette literals for *status*, and it
publishes `STATUS_PALETTE` **as palette classes** (`text-emerald-400`), so a hand-written
`text-emerald-400` is textually identical to the token's own output. **The token and the
violation are the same string, which is why no regex can separate them and why this axis
gets no rule in §9.** The structural fix is Gap 3.

### 7.H Elevation, motion, arbitrary values

- Raw `shadow-{sm,md,lg,xl,2xl}`: **3 hits / 2 files** — effectively solved.
  But `shadow-[…]` arbitrary values: **93 hits / 40 files**, which no rule matches, so the
  real elevation escape hatch is arbitrary values, not the raw scale.
- `MOTION` / `MOTION_PRESETS`: **14 hits / 7 files**, against `duration-N` utilities at
  **196 hits / 118 files**. `var(--duration-*)` is referenced **0 times** in `src/**`.
  `Design.md:249-262` says "every `setTimeout`/transition driving UI motion should derive
  from this registry"; 7 files do.
- Arbitrary spacing/size values (`p-[12px]`, `w-[240px]`, `gap-[3px]`, …): **979 hits /
  546 files**. `custom/no-raw-spacing-classes` is `off` (`eslint.config.js:97`) and would
  not match arbitrary values anyway.
- `text-foreground/N`: **1,906 hits / 760 files** across at least 12 distinct opacities
  (`/90`×608, `/85`×205, `/70`×181, `/40`×174, `/80`×151, `/45`×125, …) against
  `Design.md`'s principle #4, "Hierarchy by type + color tokens, not opacity". This is the
  705-warning corpus.

### 7.I Primitives repainted at the call site

Opening tags parsed with brace-matching across all 2,104 `.tsx` files:

| Primitive | call sites | pass `className` | repaint an axis the primitive owns | files |
| --- | ---: | ---: | --- | ---: |
| `<Button>` | 566 | 317 | 59 numeric `w-`/`h-`, 7 radius, 5 padding, 1 type | 125 |
| `<StatusBadge>` | 75 | **52** | 21 type, 8 radius, 2 padding, 1 elevation | 30 |
| `<AsyncButton>` | 49 | 19 | sizing | 15 |
| `<SectionCard>` | 55 | 16 | sizing | 12 |
| `<BaseModal>` | 129 | **0** | — | 0 |

`<StatusBadge>` is the sharpest: **two-thirds of its call sites pass a `className`, and
21 of them re-specify the font size** on a primitive whose entire job is to bundle type,
colour, padding and radius into one decision. `<BaseModal>` at 0/129 is the counter-example
and the reason Gap 5 is worth acting on: it exposes no `className` prop at all.

---

## 8. Gaps in the primitives

1. **The radius contract contradicts itself, and the contradiction is systemic — not
   `Button`'s.** [`button.md` Gap 5](./button.md#8-gaps) frames this as a `Button` decision.
   Measured across the primitive layer, `Button`, `SectionCard`, `StatusBadge` and
   `INPUT_FIELD` **all four** render raw scale radii while `Design.md:215-218` and
   `no-raw-radius-classes.cjs:9-12` mandate role radii — because all four sit in the two
   directories that rule exempts. **The decision `button.md` asks for must be made once for
   the design system, not once for `Button`,** and recorded in `Design.md` §5. Until it is,
   §9's third candidate rule stays unshipped.
2. **`is-disabled` is more capable than anything documents, and nothing routes anyone to
   it.** It is a plain `@utility` (`globals.css:31-35`), so bare `class="is-disabled"` works
   on any element — a `<div>` or `<a>` with no `:disabled` pseudo-class included — and its
   own comment (`:28-30`) says to pair it with `aria-disabled="true"`. But the only exported
   form is `STATE_DISABLED_OPACITY = 'disabled:is-disabled'` (`designTokens.ts:213`), the
   only `Design.md` row (`:190`) shows that variant, and `Design.md:366` mentions the
   utility in one clause of a prose sentence. **The capability is not the gap; the routing
   is.** Zero consumers of the constant and 4 app-layer uses of the class is what "documented
   in one clause" buys. **Fix:** give the bare form a `Design.md` §5 row of its own beside
   the radius and elevation tables, where someone looking up a token will find it; and
   either delete `STATE_DISABLED_OPACITY` (0 consumers, 1 occurrence — its own definition)
   or make it the canonical import and say so.
3. **`STATUS_PALETTE` publishes its tokens as raw palette strings, so adopting it is
   textually invisible.** `STATUS_PALETTE.success.text` *is* `'text-emerald-400'`. A
   reviewer cannot tell an adopter from a violator, and no linter ever will. **Fix:** move
   the status palette into CSS custom properties (`--status-success` already exists at
   `globals.css` and is brightness-compensated per `[data-brightness]` — the class bundles
   in `statusTokens.ts` bypass that compensation) and publish `text-status-success` /
   `bg-status-success/10` as the token spelling. That makes adoption *visible*, which is the
   precondition for it being checkable. This is the highest-leverage change on the colour
   axis and the one the 12,460 palette literals are waiting on.
4. **Spacing tokens are imports, competing with classes.** `CARD_PADDING.standard` is
   `'p-[var(--density-pad)]'` — a *string*. It is delivered as a TS constant requiring an
   import path, to replace something you can type in four characters. Adoption 0.8%.
   **Fix:** publish `p-density` / `p-density-sm` / `space-y-density` / `space-y-density-lg`
   as real utilities in the `@theme` block, so the density-aware spelling is a class like
   every other token. Keep the constants as a re-export. This converts the axis from
   import-delivered (0.2–3.4% band) to class-delivered (94–99% band) without any call site
   changing shape, and it is a prerequisite for gating spacing at all.
5. **No primitive can seal an axis it owns, because every one takes an open `className`.**
   **126 of 129** `shared/components/*.tsx` files reference `className`; **63** declare
   `className?: string` in their props. There is no `cn()` helper and **no `clsx`,
   `classnames`, `tailwind-merge`, `cva` or `tailwind-variants` anywhere in
   `package.json`** — class strings are template-literal concatenations. So an override is
   not even reliably an override: `<Button className="rounded-full">` emits
   `rounded-xl … rounded-full`, two equal-specificity utilities whose winner is decided by
   Tailwind's stylesheet emission order, not by the call site. **The escape hatch is both
   universal and non-deterministic.** See the type-over-gate answer.
6. **`Design.md` is authoritative and, in four places, wrong.** `:188` mandates
   `INPUT_FIELD` for every input while `INPUT_FIELD` violates `:216`. `:215` mandates
   `rounded-interactive` for buttons while `Button` ships four other radii. `:332` advertises
   `.btn-sm/.btn-md/.btn-lg` presets that `Button` does not use ([`button.md` D7](./button.md#7-deviations)
   measured 3 uses app-wide). `:359` describes `no-raw-spacing-classes` as "currently off —
   self-discipline", which the 0.8% figure evaluates. **A canonical reference that
   contradicts the code trains readers to stop trusting it.**
7. **Nothing tests any token contract.** No test asserts that `typo-body` renders weight 400,
   that `is-disabled` sets `--disabled-opacity`, that `rounded-card` is 12px, or that a
   primitive emits the tier it claims. `Button.test.tsx` (6 tests) covers `disabledReason`
   and `loading` only. Every deviation in §7.C could be "fixed" and silently regress.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The
conditions are stated first so an adopting repo re-derives its own proxy rather than
inheriting these — the portability test measured four ported signals at **zero** true
positives each, and §7.A above shows why that risk is acute for *this* leaf specifically:
the sibling repo shares this repo's colour doctrine and none of its radius/spacing/elevation
vocabulary, so a signal keyed on `rounded-card` would score zero there while the condition
was present 1,146 times.

Everything in §7 shipped under a green `npm run check`. Four token rules exist; they report
144 warnings between them while 2,005 weights are silently discarded, 815 inert states are
hand-derived and 230 occurrences of a non-existent class render nothing.

### Semantic conditions, stated stack-free

- **C1 — a call site patches one property of a composite token with a utility the cascade
  discards, so the authored intent is dropped while the code reads as though it were
  honoured.** *Proxy here:* a Tailwind font-weight utility written within 120 characters of a
  `typo-*` token inside one class string. *Precondition:* this repo ships composite type
  tokens as **unlayered** CSS classes alongside layered Tailwind utilities. A repo whose
  type tokens are React components, or whose tokens live inside `@layer utilities`, has the
  same condition wearing entirely different markup.
- **C2 — a state the system defines exactly once is re-derived per call site, so the system
  holds a value nothing renders and the app holds N values nothing names.** *Proxy here:* a
  `disabled:` variant applying an opacity or the not-allowed cursor. *Precondition:* this
  repo expresses conditional state with Tailwind's `disabled:` variant and owns a
  single-utility replacement bundling opacity + cursor + pointer-events. A repo styling
  `:disabled` in a stylesheet must re-derive the proxy.

### Conditions deliberately NOT given a census rule

- **C3 — a primitive is written in the scale its own design system forbids** (§7.C, 156
  matches in 54 files under the two exempt roots; validated as a working rule during
  composition). **Do not ship this until Gap 1 is decided.** Ratcheting 54 files toward a
  target nobody has chosen — while `Design.md:215` and `Button.tsx:46` say different things —
  spends the gate's authority on a coin-flip. This is the same sequencing
  [`button.md`](./button.md#sequencing--this-matters) applied to `variantClone`, and for the
  same reason. Ship it as the *third* census rule the day `Design.md` §5 records the
  decision; the rule text is `roots: ["src/features/shared/components", "src/lib"]` with
  `no-raw-radius-classes.cjs`'s own regex, `baseline {files: 54, matches: 156}`, `floor: 1100`.
- **C4 — a name in token position that no theme defines** (§7.D, `text-md` ×230). A census
  rule keyed on `text-md` would work and would be 100% precise, but it treats a symptom.
  The condition is that `no-raw-text-classes` is a **deny-list**, so it certifies every name
  it has not enumerated. **The right fix is to invert that rule to an allow-list** — flag any
  `text-<identifier>` in a `className` that is neither a known colour token, a known size, nor
  `typo-*` — which requires the AST-and-fixtures host ESLint provides and the census does not.
  Recorded as the follow-up. Delete the 230 `text-md` occurrences in the same change.
- **C5 — a status colour authored by hand rather than taken from the palette.** No honest
  proxy exists *here*, and that is a finding rather than a limitation: `STATUS_PALETTE`
  publishes `'text-emerald-400'`, so the token's output and the violation are byte-identical
  (§7.G). **Fix Gap 3 first** — make the token spelling `text-status-success` — and the
  condition becomes trivially matchable afterwards. This is the clearest case in the corpus
  of *a gate being blocked by a primitive's API rather than by regex skill*.
- **C6 — spacing that ignores the density contract.** Blocked on Gap 4 for the same reason:
  while the density-aware spelling is an import, a rule would fire on ~595 files whose only
  available fix is an import churn. Publish `p-density` first, then gate.

### The rules — validated

Both were run against the working tree with
`node scripts/census/run-census.mjs --rules <tmpfile> --check` → **exit 0**.

```json
{
  "rules": [
    {
      "id": "typo-token-overpainted",
      "goldenPath": "docs/concepts/golden-paths/design-token-usage.md",
      "title": "Font-weight utility layered over a typo-* token, where the token silently wins",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "\\btypo-[a-z-]+[^\"'`{}<>]{0,120}?font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\\b|\\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)[^\"'`{}<>]{0,120}?\\btypo-[a-z-]+",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a Tailwind font-weight utility written next to a typo-* token inside one class string. PROXY FOR the stack-free condition: a call site tries to patch one property of a composite token with a utility that the cascade discards, so the authored intent is silently dropped and the code reads as if it were honoured. Verified from source, not inferred: typography.css is imported at globals.css:3 with no layer(), every real .typo-* tier declares font-weight (17 rules checked; only the .typo-rtl / .typo-hero-shine modifiers do not), and unlayered declarations beat every @layer utilities declaration regardless of order or specificity. The token file states the failure twice in its own comments - 'typo-caption font-semibold is silently a no-op' (typography.css:161-162) and 'typo-label font-bold is silently a no-op' (:190-191) - as does Design.md section 2. PRECONDITION: this repo ships semantic type tokens as UNLAYERED CSS classes alongside layered Tailwind utilities. A repo whose type tokens are React components, or are themselves inside @layer utilities, has the same condition wearing different markup and must re-derive the proxy. The legal fix is to move up a token (typo-caption -> typo-title -> typo-heading), never to add a font-* utility."
      },
      "baseline": { "files": 824, "matches": 2005 },
      "floor": 2000
    },
    {
      "id": "hand-rolled-disabled-state",
      "goldenPath": "docs/concepts/golden-paths/design-token-usage.md",
      "title": "Inert-control appearance re-derived at the call site instead of taken from the disabled token",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "disabled:(?:opacity-\\d+|cursor-not-allowed)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a disabled: variant that paints inertness by hand. PROXY FOR the stack-free condition: a state the design system defines exactly once is re-derived per call site, so the system holds a value nothing renders and the app holds N values nothing names. Here the token is --disabled-opacity (0.45, globals.css:413), surfaced as the `is-disabled` utility (globals.css:31-35) and the STATE_DISABLED_OPACITY constant (designTokens.ts:213); the app ships ten different opacities instead and 0.45 appears exactly once among 594 of them. PRECONDITION: this repo expresses conditional state with Tailwind's disabled: variant and owns a single-utility replacement that bundles opacity + cursor + pointer-events. A repo that styles :disabled in a stylesheet, or that has no unified inert token, must re-derive its own proxy - see the golden path section 9. The legal fix is `disabled:is-disabled` (or STATE_DISABLED_OPACITY), which replaces both halves of every match."
      },
      "exclude": [
        {
          "path": "src/features/shared/components/buttons/Button.tsx",
          "reason": "the primitive that already applies is-disabled (Button.tsx:205) and carries the reasoning comment for why pointer-events-none stays — the destination this rule routes callers to"
        }
      ],
      "baseline": { "files": 361, "matches": 815 },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   typo-token-overpainted      824    824     2005   2005    2104   2000
  OK   hand-rolled-disabled-state  361    361      815    815    4829   4000
  census OK — 2 rule(s), 6933 file-visits, 2820 surviving violation(s) across 1185 file(s).
```

Both counts were cross-checked against an independent ad-hoc implementation before
baselining, per the contract's instruction. The independent count for
`hand-rolled-disabled-state` was 815 (agreement); for `typo-token-overpainted` it was 2,006
against the runner's 2,005 — **the runner was right**, and the difference is one match on a
comment-only line that `ignoreCommentLines` correctly discards. `untokenized-primitive-radius`
(C3) was measured the same way: 159 by grep, 156 + 3 comment-line ignores by the runner.

### How each fails loudly if its own precondition is absent

Not asserted — **executed**. Each failure mode was induced against the real working tree and
the exit code captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 6933 file-visits` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` → 9000 | **1** | `[structural] walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 900 -> 824 (-76) without the baseline moving.` |
| baseline deflated (a rise) | **1** | `[drift] files rose 800 -> 824 (+24). New violations of …design-token-usage.md` |
| `exclude` path renamed (`Button.tsx` → `ButtonMOVED.tsx`) | **1** | `[structural] exclude "…ButtonMOVED.tsx" matched no file. The exemption is stale` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 2000` |

The stale-`exclude` check caught a real mistake during composition: the first draft of
`typo-token-overpainted` carried a `src/styles/**` exemption, which can never match because
the rule's `extensions` are `.tsx`-only. The runner failed the run rather than accepting a
decorative exemption. That is the fail-loud contract working on its author.

Floors sit below the observed walks with margin (2,104 `.tsx`; 4,829 `.ts`+`.tsx`),
consistent with `raw-select` and `raw-web-storage`, which walk the same roots.

### Sequencing

1. **`typo-token-overpainted` immediately.** No precondition, one legal fix (delete the
   `font-*` class or move up a tier), 2,005 sites, and every one of them is currently a
   discarded intention. Ship the rule and burn the backlog down; it is the largest
   mechanical win in the document.
2. **`hand-rolled-disabled-state` immediately.** No precondition, one legal fix
   (`disabled:opacity-N disabled:cursor-not-allowed` → `disabled:is-disabled`), 815 sites.
   Do Gap 2 (give the bare `is-disabled` form its own `Design.md` §5 row) in the same
   change, so the `<div>`/`<a>` cases have a documented destination rather than a
   capability nobody knows about.
3. **Delete `text-md` (§7.D) and invert `no-raw-text-classes` to an allow-list (C4).** One
   commit for the 230 occurrences, one rule change so it cannot recur.
4. **Gap 4 — publish `p-density` / `space-y-density` as real utilities**, then gate spacing
   (C6). This is the change that moves an entire axis from the 0.2–3.4% band to the 94–99%
   band, and it makes the shipped Density setting real.
5. **Gap 3 — republish `STATUS_PALETTE` as `text-status-*` utilities**, then gate status
   colour (C5). Largest axis by volume (12,460), currently unmatchable by construction.
6. **Gap 1 — decide the radius contract once, in `Design.md` §5**, fix the four primitives,
   then ship C3 as the third census rule and **delete the path exemptions from
   `no-raw-radius-classes.cjs:46-52` and `no-direct-white-colors.cjs:28-33`.** Per P8, an
   exemption must name the gap it stands in for; these two name none, and §7.C is the bill.

---

## Type over gate — the answer

**Mostly no, and the reason is worth more than the answer.**

The leaf asks whether the primitives could stop exposing `className` for the axes they own,
or whether a `cva`-style variant API could make an off-token value unrepresentable at the
call site. Measured, the honest answer has three parts.

**1. The variant API already exists here — it just isn't a type.** `Button.VARIANT_CLASSES`
/ `SIZE_CLASSES`, `SectionCard.SIZE_CLASSES` / `STATUS_BORDER`, `StatusBadge.SIZE_CLASSES`,
`STATUS_PALETTE`, `SEVERITY_ACCENTS`, `BUTTON_VARIANTS`, `TONE_CHIP` — every one is
`Record<Variant, classString>`, which is `cva` with the ergonomics removed. **`personas-web`
independently arrived at the identical shape 45 times across 45 files**, with `cva`, `cn`,
`clsx` and `tailwind-merge` all at zero occurrences there too. Two stacks, no shared code,
the same hand-rolled abstraction reinvented ~50 times. **That instinct is physics; the
missing shared abstraction is the gap.** Adopting `cva` or `tailwind-variants` would not
change what is representable — it would consolidate ~50 lookup maps and give the variant
union a name.

**2. Sealing `className` is possible, is already done once, and does not scale.**
`<BaseModal>` accepts no `className` and **0 of its 129 call sites** repaint anything —
against `<StatusBadge>`, which accepts one and is repainted at **52 of 75**. That is the
cleanest natural experiment available and it says sealing works. But it works for
`BaseModal` because a modal shell owns its whole box; a `Button` genuinely needs
`ml-auto`, `flex-shrink-0`, `absolute top-2 right-2`. **The right shape is therefore not
`className: never` but a split: `layout?: string` for position and flow, with radius, type,
padding, elevation and colour reachable only through variant props.** That makes an
off-token radius unrepresentable at the call site without taking away the escape hatch
people legitimately need — and it is checkable, because a `layout` prop containing
`rounded-` is a one-line lint rule where a `className` containing it is a judgment call.

**3. The escape hatch does not even reliably work, which is the strongest argument for
closing it.** There is no `clsx`, no `tailwind-merge`, no `cn()` in this repo (or in the
sibling). Classes are concatenated with template literals, so
`<Button className="rounded-full">` emits `rounded-xl … rounded-full` — two utilities of
equal specificity for the same property, whose winner is decided by Tailwind's stylesheet
emission order rather than by the call site. **125 files override `<Button>` and 30 override
`<StatusBadge>` through a mechanism none of them can predict the outcome of.** A prop that
sometimes works is worse than no prop.

**Where a type cannot reach at all — and this is the leaf's real finding.** Tailwind classes
are strings, so the *dominant* deviation classes in §7 are simply out of reach of any
signature. No prop can prevent `typo-body font-medium` (2,005 sites) or
`disabled:opacity-40` (815) or `text-md` (230), because none of them passes through a
component boundary. For those, the structural equivalent of a type is **a change to the
token's own publication format**, and this document measured which changes pay:

- **From an import to a class.** Every import-delivered token here sits at 0.2–3.4%; every
  class-delivered token sits at 94–99% with a rule and 1–16% without. Gap 4 (`p-density`)
  and Gap 3 (`text-status-success`) are both this move. It is the design-token analogue of
  making the right thing the default rather than the documented thing.
- **From a deny-list to an allow-list.** `no-raw-text-classes` certifies `text-md` as
  correct because `md` is not on its ban list. An allow-list gate cannot certify a name that
  does not exist. This is the closest a string-typed system gets to a closed union.
- **From an exempted directory to none.** Typography — the only axis with no path exemption
  anywhere — is the only axis at 99% *including inside the primitives*. Radius, exempt in
  both directories where the primitives live, has 57.7% of its violations in a blind spot.

So the general rule for this situation is the mirror of the one
[`focus-management.md`](./focus-management.md) found. There, the fix was to derive the
guarantee from a prop that already existed. Here, where there is no prop to derive from:
**publish the token in the same notation as the thing it replaces, in a vocabulary that is
closed rather than open, and exempt nothing — because the layer you exempt is the layer
whose values everything else inherits.**
