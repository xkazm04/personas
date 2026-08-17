# Golden path — Theming and contrast

> Situation node: `ui-system/design-tokens-theming/theming-and-contrast` · [situation spine](../situation-spine.md)
> Composed 2026-08-15. **Recurrence 62.**
> Sweep: every file under `src/**` — **4,829 files (2,725 `.ts` + 2,104 `.tsx`)** — walked twice by
> two independent implementations (a whole-file regex census and a `@typescript-eslint/parser` AST
> pass); full reads of `globals.css` (5,553 lines), `themeStore.ts`, `contrastRatio.ts`,
> `deriveCustomTheme.ts`, `check-themes.mjs`, `no-low-contrast-text-classes.cjs`, all 21 custom
> ESLint rules, `docs/development/contrast.md`, `.claude/Design.md`; a full `npx eslint` run over
> the corpus counted per rule and **per matched class**; **contrast ratios computed, not described**
> — 11 themes × 2 surfaces × 3 brightness levels × 17 alpha steps for the token vocabulary, plus
> 216 palette classes resolved through Tailwind v4's oklch table and this repo's light-correction
> cascade; the census runner exercised through all eight of its failure modes; and a convergence
> census of two sibling repos (`personas-web`, `brainiac/console`).
> Dimensions: **ui · code-quality · function**.
> **Settles:** how a text colour is chosen so it stays legible in every theme the app can be in.
>
> Shared counts cited from [`shared-facts.json`](../shared-facts.json) @ `211d519bb`; its
> `lint` block reproduces exactly here (1,135 warnings, 705 for the contrast rule).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
each clause carries its warrant. No file path, class name or count appears below this line until
the head ends.

> **P1 — physics.** Contrast is a property of two rendered pixels, not of two token values. Any
> transform between the token and the pixel — an alpha composite, a surface underneath, a filter on
> an ancestor — is part of the ratio. A system that audits its tokens and ships a transform has
> audited something the user never sees.
>
> **P2 — physics.** Expressing text hierarchy as *alpha on the body-text token* is a single
> decision applied across every theme, but its contrast consequence is different in each. It is
> tuned on whichever theme family the author had open, and it is wrong by construction on the other.
> Hierarchy that must hold across inverted backgrounds has to be carried by something invariant —
> size, weight, position — or by a *named* tier whose value each theme sets for itself.
>
> **P3 — physics.** An accessibility floor is a threshold, and a threshold has exactly one honest
> justification: a measurement. A contrast rule whose cutoff was chosen by eye will be wrong in both
> directions at once — flagging compliant code and certifying failing code — and the false positives
> are the more expensive half, because they teach people the rule is noise.
>
> **P4 — physics.** Two gates asserting opposite things about one token is worse than one gate. The
> stricter is treated as the noise and the looser as the truth, so the pair enforces the looser one
> while costing the maintenance of both.
>
> **P5 — physics.** A correction layer written as an enumerated list of names is an allow-list
> wearing a fix's clothing. Everything outside the enumeration keeps its original value *silently*,
> and the gap grows every time someone reaches for a value the enumerator did not anticipate.
>
> **P6 — ergonomics, with a measured cause.** A threshold people can meet gets met; a threshold that
> asks them to abandon a design idiom accumulates. Set the floor at the measured failure point and
> not one step beyond it — the extra strictness does not buy contrast, it buys a backlog.
>
> **P7 — governance.** The theme a *user* can author must pass the same audit as the themes the team
> authored, at the moment it is applied. A palette generator that no gate can see is a private,
> unaudited theme family shipped to production.
>
> **Scale condition.** P1–P3 pay from the second theme. P4–P5 begin to bite once a theme family is
> inverted (light beside dark). P6 pays once the violation population is larger than one sitting.
> P7 pays the day a theme editor ships.

**Warrant evidence — and one clause that is local calibration.** Two sibling repos measured
independently:

- **P2 is physics.** All three codebases express text hierarchy through alpha, reinvented with three
  different syntaxes and no shared document: `text-foreground/70` here, `text-foreground/70` in
  `personas-web` (646 uses, 188 with an opacity modifier), and a *named* ladder
  `INK`/`INK_DIM`/`INK_FAINT` in `brainiac/console` (314 refs). All three have members below AA:
  the console's `INK_FAINT` is alpha 0.35 = **2.83:1** and is its most-referenced text token.
- **P5 is physics.** `personas-web` independently built the same light-theme override layer this
  repo has — a block of `[data-theme^="light"] .<utility>` rules with `!important`, ~105 of them,
  under a header stating the same rationale ("glass patterns for dark mode… on light themes they're
  invisible"). Different utility family (white-alpha glass there, the numbered palette here), same
  mechanism, same enumerated-list shape, arrived at separately.
- **P3/P6 is physics, and the sibling supplies the controlled comparison.** `personas-web` wrote its
  own contrast lint rule with a threshold of **60**, warn-level, no `--max-warnings` — structurally
  identical enforcement to this repo's. Its distribution of `text-*/N` is **hard-truncated at
  exactly /60: 365 at or above, 0 below.** This repo's rule threshold is 80 plus a total ban on a
  second token, and **531 occurrences sit below /60**. Comparable density (0.35 vs 0.39
  opacity-tinted classes per file), same non-blocking enforcement, opposite outcomes.
- **The root filter is NOT physics — it is a house eccentricity.** Neither sibling applies any
  `filter:` to `html`/`body`/`:root`. This repo does (§3), and it is upstream of most of §7.
- **An in-app contrast toggle is not physics either.** Neither sibling has one; `personas-web` has
  only the OS-driven `forced-colors` block, which — unlike this repo's toggle — *does* re-point
  `--foreground` and `--background`.

---

## 1. Trigger

- "make this label secondary", "dim the timestamp", "this row should read as less important"
- "make it look right on the light theme", "add a light-theme override for this"
- "add a new theme" / "let the user pick their own colours"
- "the caption is hard to read", "this looks washed out on Ice"
- **If you are about to type** `text-foreground/`, `text-muted-foreground`, `opacity-` on anything
  containing words, a Tailwind palette colour on text (`text-emerald-400`, `text-amber-300`), a hex
  in a `--foreground`-family token, or a `[data-theme^="light"]` selector — you are in this
  situation.
- If you are about to add or change a value in `src/styles/globals.css` between `:root` and the
  last `[data-theme=…]` block, you are in this situation and you owe `npm run check:themes`.

You are **not** in this situation for a *background* alpha (`bg-secondary/40`, `bg-primary/5`) —
those change the surface, and §2 tells you to score text against the composed surface rather than
avoid them. You are not in it for a `disabled:` treatment either: WCAG 1.4.3 exempts inactive
components, so that belongs to
[`design-token-usage.md`](./design-token-usage.md) §7.F (see §7.H — this corrects a premise in the
brief). Status/severity hues are
[`status-and-severity-badges.md`](./status-and-severity-badges.md); entity colours are
[`entity-visual-identity.md`](./entity-visual-identity.md).

---

## 2. The one way

**Carry text hierarchy with the type scale and a full-strength colour token, and never with an
alpha modifier on the body-text token.** Write `typo-caption text-muted-foreground`, not
`typo-body text-foreground/60` — the tier is a decision each theme re-makes for itself, the alpha is
one number applied to eleven different backgrounds and correct on at most one family of them. If you
need a colour that is not `text-foreground`, `text-muted-foreground` or a `text-status-*` token, you
need a token, not a modifier; add it to `globals.css` for **every** theme and let
`npm run check:themes` price it. **Before you write any of it, know that the number the audit prints
is not the number the user sees**: `globals.css:832` renders the entire document through
`filter: brightness()` — 1.25 on dark themes, **0.82 on light ones by default** — so score contrast
against the *rendered* pixel, composite the text over the *card* it actually sits on rather than the
canvas, and check the light family explicitly, because that is the family every threshold in this
repo is wrong about. When you must reach for a Tailwind palette colour on text, use only the
`-300`/`-400` shades at `/50`–`/80` or no modifier: those, and only those, are the 153 exact class
names the light-theme correction layer at `globals.css:3382-3760` re-points, and anything outside
that enumeration renders its dark-tuned value on a white card (§7.E). Finally: if you are adding a
theme, add it to `check-themes.mjs`'s `THEMES` array in the same commit, and if you are touching the
custom-theme generator, know that nothing audits its output at all (§7.G).

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/styles/globals.css:285-430` (`:root`) + 10 `[data-theme=…]` blocks** (`:2161-2608`) | The 11 shipped palettes. `:root` **is** `dark-midnight`. Each block sets `--foreground`, `--background`, `--muted`, `--muted-foreground`, `--card-bg`, `--border`, `--primary`, `--status-*`. |
| **`src/stores/themeStore.ts:68-79` — `THEMES`** | The theme registry: **8 dark + 3 light = 11**, each with `isLight`. Plus a 12th, `'custom'`. This is the authority; two docs disagree with it (§7.I). |
| **`scripts/check-themes.mjs`** — `npm run check:themes` | The WCAG audit. Parses `globals.css`, resolves each theme's effective map, hard-fails (exit 1) if `foreground/bg`, `muted-foreground/bg`, `muted-foreground/bg @80%` or `muted/bg` drops below 4.5:1 in any theme. **Wired into CI (`ci.yml:137`) but NOT into `npm run check`** (`package.json:51`). Read §7.A before trusting its output. |
| **`src/lib/theme/contrastRatio.ts`** — `getContrastRatio(fg,bg)`, `getContrastLevel(fg,bg)` → `'AAA'\|'AA'\|'low'` | The WCAG 2.1 relative-luminance implementation, correct and already here. **2 consumers, both in Settings → Appearance.** It has never been pointed at a rendered pair. |
| **`globals.css:3382-3760`** — the light-theme palette correction layer | 153 exact-class re-points of Tailwind palette text utilities under `[data-theme^="light"]`, plus 51 `bg-` and 44 `border-` counterparts. The reason `text-emerald-400` is not lime-on-white. Its coverage is an enumeration — see §7.E. |
| **`globals.css:826-833`** — `--app-brightness` / `--app-saturation` and the `html { filter: … }` rule | The global tone control. **Every contrast ratio in this app is a post-filter quantity.** Set from JS at `themeStore.ts:230`. |
| **`themeStore.ts:33-44`** — `DARK_BRIGHTNESS_LEVELS` / `LIGHT_BRIGHTNESS_LEVELS` | The three filter values per family: dark `1.25 / 1.38 / 1.50`, light `0.82 / 0.91 / 1.00`. Default persisted level is `'low'` (`:289`). |
| **`globals.css:5091-5128`** — `html[data-contrast="high"]` | The high-contrast preset. Re-points `--status-*`, `--muted-foreground` and `--card-border`. **It does not touch `--foreground` or `--background`** — §7.C. |
| **`eslint-rules/no-low-contrast-text-classes.cjs`** — `custom/no-low-contrast-text-classes` | The call-site rule. 705 warnings / 179 files — 62% of the repo's entire lint population. Its threshold is not measured; §7.B is the measurement. |
| **`src/lib/connectors/connectorMeta.tsx:354-367`** — `ensureContrast(color, isLight)` | The only *runtime* theme-aware colour correction in the app. Thresholds on luminance, never computes a ratio, connectors only. |
| **`docs/development/contrast.md`** · **`.claude/Design.md` §1.4, §5, §8** | The prose doctrine. Authoritative on intent; §7.I records four places it is authoritative and wrong. |

**Explicitly NOT a primitive here.** `text-muted` reads like the dim tier and is used **twice in
4,829 files**, both inside `src/lib/harness/`. `--muted` is a *border/decoration* token in practice
(17 `var(--muted)` uses). Do not reach for `text-muted` as a text class; `check-themes.mjs` hard-fails
CI on its ratio anyway (§7.A).

---

## 4. Steps

1. **Name the job of the text before you colour it.** Primary copy → `text-foreground`. Secondary /
   helper → `text-muted-foreground`. A status → a `text-status-*` token. Anything else is not a
   colour decision, it is a *tier* decision, and it belongs in step 2.
2. **Express the tier with `typo-*`, not with alpha.** `typo-heading` → `typo-body` → `typo-caption`
   → `typo-label`. This is `Design.md` principle #4 stated as an instruction, and 83 files under
   `src/features/` already do it with zero opacity-tinted text — see §6.
3. **If you still want it dimmer, stop and pick a different token.** There is no third foreground
   tier in this system today (§8-G1). Adding one is a `globals.css` change across 11 themes plus a
   `check-themes.mjs` pairing, and it is the correct amount of work — it is what makes the tier
   correct on the light family instead of correct on yours.
4. **Ask the type question before you reach for §9's gate.** Can the wrong value be made
   unrepresentable? For the *call site*, no: Tailwind classes are strings and alpha is a continuous
   escape hatch. For the *theme*, yes — and that is where the leverage is; see
   [Type over gate](#type-over-gate--the-answer).
5. **Score against the surface, not the canvas.** Text sits on `--card-bg` composited over
   `--background` far more often than on the canvas. On the light themes the card is *lighter* than
   the canvas (`rgba(255,255,255,0.92)`), which moves the ratio the wrong way for dark text:
   `text-foreground/60` is 3.96:1 on the light canvas and **4.18:1** on a light card, and both fail.
6. **Score the rendered pixel, not the token.** Multiply by the filter (`brightness(1.25)` dark,
   `brightness(0.82)` light) *after* compositing. This is not a rounding correction: it moves
   `light`'s body ratio from 15.4:1 to **10.5:1**, and it is the difference between
   `text-muted-foreground/80` passing (4.6) and failing (4.11) the AA floor the docs promise.
7. **Check the light family explicitly, at the default brightness level.** The default persisted
   brightness id is `'low'`, which on a dark theme means "Standard" (1.25) and on a light theme
   means **"Dimmer" (0.82)** — the lowest-contrast of its three. A user who switches from a dark
   theme to a light one keeps the id and silently lands there (`themeStore.ts:299`).
8. **If you are adding a theme, add it to `check-themes.mjs:161-173` in the same commit.** The array
   is hand-maintained. A theme absent from it is a theme with no audit.
9. **And then stop.** Once the text is `typo-<tier> text-<token>` with no slash and no `opacity-`,
   you are done. Do not add a light override for it; the token already has one.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `typo-body text-foreground/60` for "secondary" | The commonest defect in this document. Measured on a card as rendered: **9.04:1 on dark-purple, 4.18:1 on light.** One number, eleven backgrounds, correct on eight. 90 sites at exactly `/60`; 531 below it. |
| `text-foreground/90` to "soften" body copy on a dark theme | **A no-op.** `brightness(1.25)` clips the composite to `#ffffff`, byte-identical to bare `text-foreground`, on six of the eight dark themes (`/95` on the other two). **608 occurrences of `/90` + 89 of `/95` = 697 authored dim-downs that render at full strength.** The author's intent is not merely wrong, it is absent. |
| Treating `/85` as "effectively the same as `text-foreground`" (the rule's own words) | True on dark **because of clipping, not calibration**. On a light card `/85` is 8.65:1 against `/100`'s 12.03 — a 28% reduction — and `text-muted-foreground/85` on the `light-news` canvas is **4.42:1, below AA**. |
| A Tailwind palette colour on text outside the `-300`/`-400` × `/50`–`/80` set | The light correction layer is an enumeration of 153 exact class names. `text-amber-400/90` is not in it, so it renders raw amber-400 on a white card: **1.59:1.** 430 hits across 116 such classes (§7.E). |
| `opacity-40` on a `<div>` that contains words | Identical rendered result to `text-foreground/40`, expressed in a syntax no rule in this repo looks at. 703 unmodified `opacity-N` utilities, 322 of them in the 1–60 range. |
| Reading `npm run check:themes`'s green as "the app meets AA" | It scores unfiltered tokens against the canvas only. Everything in §7.A. |
| Turning on High Contrast expecting `text-foreground/40` to improve | It does not move at all. And on the app's default theme it *lowers* secondary-text contrast by 18% (§7.C). |
| Adding a light-theme fix as one more `[data-theme^="light"] .foo` rule | Sometimes right (113 of 174 base classes have one). But if the thing you are fixing is a *palette utility*, you are extending an allow-list, and the next value will be outside it too. |
| Shipping a custom-theme generator with no audit on its output | `deriveCustomTheme` produces `--muted` at **3.07–3.73:1** at every hue — a value `check-themes.mjs` hard-fails the built-ins for. Nothing runs on it (§7.G). |

---

## 6. Evidence

**The one site to copy — for a component:**
`src/features/agents/components/matrix/SharedResourcesPanel.tsx`. 189 lines, **27 `typo-*` tiers,
25 semantic colour tokens, zero opacity-tinted text, zero palette classes.** Every text node is bare
`text-foreground`; the whole visual hierarchy is `typo-label` / `typo-caption` / `typo-body-sm`, and
the only alphas in the file are on *backgrounds* (`bg-secondary/40` on a chip, `:57`) where they
change the surface rather than the ink. It is step 2 done literally. **83 of 2,088 `.tsx` files under
`src/features/` meet this bar** (≥8 tiers, ≥6 semantic tokens, no opacity-tinted text) — a small
population, but not an empty one, and the shape is reproducible.

**The one site to copy — for a token:**
`src/styles/globals.css:2381-2427`, the `[data-theme="light"]` block. It is the only palette in the
repo that writes down *why* each value is where it is, in contrast terms, and names the gate that
proved it: "muted tiers darkened to hold AA on the softer canvas (verified by check:themes)"
(`:2389`), and "error/info/primary dropped to AA-lg when the background receded, so they go one step
deeper (red-700, blue-700) to clear AA proper" (`:2408-2410`). Copy this habit — a palette value with
no recorded reason is a value the next person will "clean up".

**For the audit itself:** `scripts/check-themes.mjs:84-92` (`blendOver`) and `:181-191` (`PAIRS`).
The design is right — token-level, per-theme, hard-fail, one place — and it is the thing to extend
rather than replace. Its `CHECK_THEMES_CSS` env override (`:49`) so a fixture can point it at a
deliberately-regressed stylesheet is exactly the fail-loud discipline the contract asks for.

**For a runtime correction:** `src/lib/connectors/connectorMeta.tsx:354-367` (`ensureContrast`) —
the only code in the app that adjusts a colour because of the active theme. Copy the *instinct*; do
not copy the implementation, which thresholds on absolute luminance and never computes a ratio
against the surface it will land on.

---

## 7. Deviations found

### 7.A The audit is green and it is measuring the wrong colours

`npm run check:themes` exits 0. All 44 hard-fail pairings (4 × 11 themes) pass. Four things it does
not do, each measured:

**(a) It scores the token, and the app renders the token through a filter.** `globals.css:832` is
`html { filter: brightness(var(--app-brightness)) saturate(var(--app-saturation)); }`. Recomputing
every pairing with the filter applied at each family's default level:

| | audit says | as rendered | Δ |
| --- | ---: | ---: | ---: |
| `light` · foreground/background | 15.4:1 | **10.53:1** | −32% |
| `light-ice` · foreground/background | 15.4:1 | **10.55:1** | −31% |
| `light-news` · foreground/background | 14.0:1 | **9.53:1** | −32% |
| `dark-midnight` · foreground/background | 15.7:1 | 18.86:1 | +20% |
| **`light` · muted-foreground @ /80** | **4.6:1 (pass)** | **4.11:1 (FAIL)** | −11% |
| **`light-ice` · muted-foreground @ /80** | **4.6:1 (pass)** | **4.09:1 (FAIL)** | −11% |
| **`light-news` · muted-foreground @ /80** | **4.6:1 (pass)** | **4.00:1 (FAIL)** | −13% |

The three tightest margins in the audit's entire table are the three that the filter pushes under.
`docs/development/contrast.md:47-49` states the consequence as a guarantee — *"`/80` is exactly the
AA floor in all 13 themes… anything at `/80` or above is guaranteed AA"* — and the guarantee does not
hold on any light theme.

**(b) It scores against `--background` only, never against `--card-bg` over `--background`.** Most
text in this app sits on a card. On dark themes the card raises the floor slightly (dark-midnight
18.86 → 16.26); on light themes the card is *brighter* than the canvas (`rgba(255,255,255,0.92)`),
which is the wrong direction for dark ink.

**(c) It audits 11 configurations out of 66.** The contrast-bearing axes are `data-theme` (11) ×
`data-brightness` (3) × `data-contrast` (2). The audit sees the first axis only, at an implicit
filter of 1.0 that no configuration uses.

**(d) One of its four hard-fail rows defends a token nobody uses.** `muted/bg` is a hard fail in
every theme. `text-muted` appears **2 times in 4,829 files**, both in `src/lib/harness/`
(`scenario-parser.ts`, `verifier.ts`). `contrast.md:24` justifies the row with "used as a text class
~170×" — off by roughly 85×. That row carries the audit's tightest margins (4.6–5.0 across the dark
themes) and is therefore the most likely thing to block a legitimate palette change, on behalf of
zero call sites.

**(e) It is not in `npm run check`.** `package.json:51` runs contracts, tiers, tauri-configs, corpus,
doc-map, census, `tsc` and `eslint`. `check:themes` runs only in CI (`ci.yml:137`) and in the
`.claude/CLAUDE.md` PR checklist. A local `npm run check` cannot tell you a palette edit broke AA.

### 7.B The 705-warning rule — 37.9% of it is not a contrast defect

`custom/no-low-contrast-text-classes` is **705 warnings across 179 files, 62.1% of the repo's entire
1,135-warning lint population**. It flags `text-muted-foreground` (any form) and `text-foreground/N`
for N ≤ 80. I computed the rendered ratio for each of the 18 exact classes it reports, on a card, at
each theme's default brightness:

| flagged class | warnings | fails AA on … | worst | best | verdict |
| --- | ---: | --- | ---: | ---: | --- |
| `text-muted-foreground` | **116** | nothing | 7.02 | 15.21 | **passes AA in all 11** |
| `text-foreground/80` | 35 | nothing | 7.50 | 16.56 | **passes AA in all 11** |
| `text-foreground/75` | 5 | nothing | 6.48 | 14.58 | **passes AA in all 11** |
| `text-foreground/70` | **102** | nothing | 5.59 | 12.75 | **passes AA in all 11** |
| `text-foreground/65` | 9 | nothing | 4.82 | 11.08 | **passes AA in all 11** |
| `text-foreground/60` | 90 | 3 light | 4.17 | 9.55 | theme-dependent |
| `text-foreground/55` | 54 | 3 light | 3.61 | 8.17 | theme-dependent |
| `text-foreground/50` | 62 | 3 light | 3.14 | 6.93 | theme-dependent |
| `text-foreground/45` | 89 | 3 light | 2.75 | 5.88 | theme-dependent |
| `text-foreground/40` | 85 | 3 light | 2.41 | 4.94 | theme-dependent |
| `text-muted-foreground/50` | 5 | 6 dark + 3 light | 2.36 | 4.85 | theme-dependent |
| `text-foreground/{35,30,25,20,15}` | 51 | all 11 | 1.35 | 4.12 | **fails everywhere** |
| `text-muted-foreground/{40,30}` | 2 | all 11 | 1.62 | 3.61 | **fails everywhere** |

> **267 of 705 (37.9%) clear WCAG AA in every single theme this app ships.**
> **385 (54.6%) fail on the three light themes and pass on all eight dark themes.**
> **53 (7.5%) fail everywhere.**

The rule's docstring gives contrast as its justification — *"fade into the background on every theme
except the high-contrast one"* — and for 267 reports that is measurably false. Its largest single
bucket, bare `text-muted-foreground` (116 warnings, 16.5% of the rule), is the sharpest case:

> **`check:themes` hard-fails CI if `muted-foreground/background` drops below 4.5:1 in any theme.
> `no-low-contrast-text-classes` warns on every use of that same token. Two shipped gates, opposite
> verdicts, one token.** Measured, the CI gate is right: 7.02:1 at worst.

The rule *does* also state a design policy ("the token itself is reserved for structural
micro-labels"), and as a policy it is defensible. But it is delivered under a contrast justification,
and mixing the two is what makes the backlog unfixable: there is no measurement that tells you which
of the 116 are policy violations, so nobody burns any of them down.

**Why the threshold matters more than the strictness** — the sibling comparison in the head:
`personas-web` set its cutoff at 60 and has **zero** occurrences below it across 365 sites, under
warn-level enforcement with no `--max-warnings`, exactly like here. This repo set the cutoff at 80
plus a token ban, and has **531** occurrences below 60. Densities are comparable (0.35 vs 0.39
opacity-tinted classes per file). This is one observation per repo and confounded by wiring date
(see [`design-token-usage.md`](./design-token-usage.md) §7.A), so read it as suggestive, not proven.
But it is the only evidence available on the question, and it points against strictness.

### 7.C High contrast does not change contrast for the class that needs it

`html[data-contrast="high"]` (`globals.css:5091-5128`) re-points `--status-*`, `--muted-foreground`
and `--card-border`. It leaves `--foreground` and `--background` untouched. Measured:

| theme | `text-foreground` on a card | `text-foreground/40` | `text-muted-foreground` |
| --- | --- | --- | --- |
| dark-midnight | 16.26 → **16.26** | 4.52 → **4.52** | 15.21 → **12.42** ⬇ |
| dark-cyan | 16.78 → **16.78** | 4.79 → **4.79** | 14.16 → **13.63** ⬇ |
| dark-frost | 16.38 → **16.38** | 4.94 → **4.94** | 10.00 → 14.00 ⬆ |
| light | 12.03 → **12.03** | 2.42 → **2.42** | 7.15 → 7.53 ⬆ |

Two findings:

1. **For the 589 of 705 rule reports that are `text-foreground/N`, High Contrast is a complete
   no-op.** The rule's own docstring claims the opposite.
2. **On the app's default theme, turning High Contrast ON lowers secondary-text contrast by 18%**
   (15.21 → 12.42), and by 4% on `dark-cyan`. The preset replaces each theme's opaque
   `--muted-foreground` hex with `color-mix(in srgb, var(--foreground) 75%, transparent)`; on the two
   themes whose muted token was already brighter than 75% of foreground, that is a downgrade. A
   third-order consequence: because the token becomes *translucent*, every
   `text-muted-foreground/N` call site has its alpha multiplied by 0.75 — High Contrast makes those
   8 sites strictly worse.

### 7.D The brightness filter erases the dark themes' foreground tokens

`brightness(1.25)` multiplies each sRGB channel and clamps. Every dark theme's `--foreground` has all
three channels ≥ 204, so:

| theme | `--foreground` | rendered | lowest `/N` still pixel-identical to `/100` |
| --- | --- | --- | --- |
| dark-midnight | `#e2e8f0` | `#ffffff` | **/90** |
| dark-cyan | `#e0f2fe` | `#ffffff` | /95 |
| dark-bronze | `#ece7df` | `#ffffff` | /95 |
| dark-frost | `#f1f5f9` | `#ffffff` | **/85** |
| dark-purple | `#e9e6ee` | `#ffffff` | **/90** |
| dark-pink | `#ece5e9` | `#ffffff` | **/90** |
| dark-red | `#ededed` | `#ffffff` | **/90** |
| dark-matrix | `#e8e8e8` | `#ffffff` | **/90** |

**Eight distinct, individually-chosen foreground tokens render as one colour.** The per-theme warmth
of `dark-bronze`'s `#ece7df` and the blue cast of `dark-cyan`'s `#e0f2fe` do not survive to the
screen for body text. And `text-foreground/90` — **the single most common opacity in the codebase at
608 occurrences** — is a no-op on six of eight dark themes; `/95` (89) on the other two;
`dark-frost` collapses from `/85` (205 occurrences repo-wide). The lint rule's "`/85` and above is
effectively the same as `text-foreground`" is accidentally true on dark, for a reason nobody
intended, and false on light.

### 7.E The light palette-correction layer is an allow-list of 153 names

`globals.css:3382-3760` re-points Tailwind palette text utilities under `[data-theme^="light"]`. Its
coverage, extracted from the selectors:

| covered | shades | opacity variants |
| --- | --- | --- |
| 20 hues | `-300`, `-400` | bare |
| 14 hues | `-300`, `-400` | `/50`, `/60`, `/70`, `/80` |
| 1 hue | `-500` | bare |

**153 exact class names.** Palette text usage in `src/**` is **5,326 hits across 216 distinct classes
in 1,077 files**. Of those, **4,896 fall inside the covered set and 430 fall outside it** — and
because a CSS selector matches the *escaped exact class*, `.text-emerald-400` does not match an
element classed `text-emerald-400/90`. Everything outside renders its dark-tuned Tailwind value on a
white card:

| class | hits | dark card | light card |
| --- | ---: | ---: | ---: |
| `text-amber-400/90` | 31 | 11.31 | **1.59** |
| `text-violet-200` | 27 | 16.26 | **1.35** |
| `text-cyan-200` | 27 | 14.92 | **1.22** |
| `text-amber-300/90` | 20 | 13.72 | **1.37** |
| `text-cyan-100` | 17 | 16.26 | **1.10** |
| `text-red-400/90` | 17 | 6.20 | **2.47** |
| `text-cyan-50` | 9 | 16.26 | **1.03** |

`text-amber-400/90` is real body copy — `<li className="typo-body text-amber-400/90 …">`
(`DesignPhaseApplied.tsx:83,116`), `<p className="typo-heading text-amber-400/90">`
(`BudgetRecoveryCard.tsx:102`). **421 of the 430 uncovered hits fail AA on a light card.**

The covered set is not safe either, because the correction targets were chosen by hue rather than by
measurement. Over all 5,326 palette text hits, as rendered on a card:

| | dark card | light card |
| --- | ---: | ---: |
| fail AA (4.5:1) | **172 (3.2%)** | **4,172 (78.3%)** |
| fail even 3:1 | — | **1,491 (28.0%)** |

At the light family's *brightest* level (1.0) the figure is still **3,259 (61.2%)**. The most-used
palette text class in the app, `text-emerald-400` (675 hits), is corrected to `#059669` and measures
**3.43:1** on a light card. The correction layer's own header comment says it exists "so they remain
legible."

### 7.F The rule's recall is 80.2%, and the missing fifth is concentrated in one syntax

Two independent implementations (whole-file regex; `@typescript-eslint/parser` AST) agree on the
denominator. Occurrences of the rule's own condition, excluding the state-modified forms it
deliberately allows:

| where | occurrences | files |
| --- | ---: | ---: |
| inside a `className` attribute, `.tsx` | **823** | 224 |
| a non-JSX string in a `.tsx` (module-scope class map) | 46 | 36 |
| a string in a `.ts` file (no JSX for the visitor to reach) | 10 | 6 |
| **total** | **879** | |
| **reported by ESLint** | **705** | 179 |

Of the 823 inside `className`, the rule's `extractStrings` walker reaches **707**; two more are
silenced by `eslint-disable` comments, giving exactly the 705 observed. **116 (14.1%) are lost inside
the attribute**, and the cause is one line: the `TemplateLiteral` branch
(`no-low-contrast-text-classes.cjs:101`) maps `node.quasis` and never visits `node.expressions`.

```tsx
// MonitorCapabilities.tsx:122 — invisible to the rule
<span className={`typo-caption ${isExecuting ? 'text-primary' : runnable ? 'text-foreground/55' : 'text-foreground/35'}`}>
```

113 of the 116 are ternaries nested inside a template-literal interpolation; 3 are logical
expressions. **All seven className-walking custom rules read `quasis`; none reads `expressions`** —
but the damage is not uniform, and the asymmetry is the finding:

| rule's condition | in `className` | walker reaches | missed |
| --- | ---: | ---: | ---: |
| `text-foreground/≤80` + `text-muted-foreground` | 823 | 707 | **116 (14.1%)** |
| raw radius classes | 1,768 | 1,749 | 19 (1.1%) |
| raw text-size classes | 75 | 73 | 2 (2.7%) |

A radius is a property of the element; an opacity-tinted foreground is a property of a *state* —
selected/unselected, active/inactive, done/pending. **The muted branch is literally the `else` of a
ternary, which is precisely the syntax the walker cannot see.** The blind spot and the defect share a
cause. One line — `...node.expressions.flatMap(extractStrings)` — recovers 116 reports here, 19
there, 2 there.

Also measured: the rule implements a `muted-ok: <reason>` escape hatch (`:183-196`) and documents it
prominently. **It is used zero times in 4,829 files.** Two `eslint-disable` comments name the rule
instead. An escape hatch nobody discovers is a feature that only costs.

### 7.G The one theme a user can author is audited by nothing

`CustomThemeCreator.tsx` lets a user build a theme from a primary colour and a base mode.
`deriveCustomTheme.ts:127-176` generates the full token set from HSL formulas. Measured across the
hue circle, unfiltered, the way `check-themes.mjs` would score it if it could see it:

| mode | `foreground/bg` | `muted-foreground/bg` | `muted/bg` |
| --- | ---: | ---: | ---: |
| dark, h = 0…300 | 15.28 – 15.72 | 5.84 – 6.94 | **3.07 – 3.73 — below AA at every hue** |
| light, h = 0…300 | 15.11 – 15.42 | 7.08 – 7.81 | 5.54 – 6.25 |

**Every derived dark theme would fail `npm run check:themes`'s `muted/bg` hard-fail row**, which the
11 built-ins are held to. Nothing runs the audit on a derived theme.

The creator *does* import `getContrastRatio` and show a badge — and it grades three pairings
(`body`, `btn`, `accent`, `CustomThemeCreator.tsx:33-35`), **not** `muted-foreground` or `muted`, the
two the built-in gate cares most about. `handleSave` is disabled only on an empty name (`:266`), so a
theme showing a red "Low" badge saves and applies. `deriveCustomTheme` also gives custom-light
`--card-bg: rgba(0,0,0,0.04)` — a *darkening* card — where all three built-in light themes use a
*brightening* one, so a custom light theme's card/canvas relationship is inverted relative to every
theme the palette was tuned against.

### 7.H Two claims from the brief, tested and cleared

**(a) `disabled:opacity-N` is not a contrast defect.** Measured: **594 occurrences across 10 distinct
values** (`50`×259, `40`×239, `30`×60, `60`×30, and one each of 25/0/100/35/70/45) — reproducing
[`design-token-usage.md`](./design-token-usage.md) §7.F exactly, and the token's own value (0.45)
appears once. But **WCAG 2.1 SC 1.4.3 explicitly exempts text in inactive user-interface
components**, so none of the 594 is an AA failure. They are a token-consistency defect owned by
`design-token-usage.md` and already gated by its `hand-rolled-disabled-state` census rule. This path
does not claim them. What this path *does* claim is the 703 **unmodified** `opacity-N` utilities
across 351 files — 322 of them in the 1–60 range — which dim whatever text they contain at rest and
which no rule in this repo looks at.

**(b) Light theme is a first-class target at the component layer.** The brief anticipated a retrofit.
Measured over `globals.css`: **174 class selectors defined outside any theme block, 113 of which have
a `[data-theme*="light"]` override**; only 8 base classes hardcode a `white`/`black` literal, and
only **2** of those have no light counterpart (`.chat-user-bubble`, `.companion-scroll`). Each of the
three light themes carries a complete ~26-declaration token block, the same token set as the dark
themes. The retrofit is not in the component layer — it is in the *palette* layer (§7.E), where a
hand-enumerated allow-list stands in for a systematic answer.

### 7.I Documentation drift, including the theme count

| claim | where | measured |
| --- | --- | --- |
| "the app ships **10** named themes (7 dark, 3 light)" | `.claude/Design.md:22` | **11** (8 dark, 3 light) — `themeStore.ts:68-79` |
| "in all **13** themes" | `docs/development/contrast.md:47` | 11 |
| "`muted` … used as a text class **~170×**" | `contrast.md:24` | **2**, both in `src/lib/harness/` |
| "`/80` … anything at `/80` or above is **guaranteed AA**" | `contrast.md:47-49` | false on all three light themes as rendered (§7.A) |
| "High-contrast … **comfortably above AA by construction**" | `contrast.md:79-82` | lowers `muted-foreground` on 2 of 11 themes (§7.C) |
| "`text-muted-foreground/N` … **fades into the background on every theme except the high-contrast one**" | `no-low-contrast-text-classes.cjs:8-10` | passes AA in all 11; high-contrast is a no-op for the `text-foreground/N` half (§7.B, §7.C) |

Three documents give three theme counts and none matches the registry. `check-themes.mjs`'s own
hand-maintained `THEMES` array is the only place that is right — and it is right by coincidence of
being edited alongside the CSS, not by construction.

---

## 8. Gaps — what the primitives genuinely cannot do

**G1 — there is no third text tier, so the alpha modifier is the only available answer.** The system
publishes `--foreground` and `--muted-foreground` and nothing between or below. A developer who needs
three levels of emphasis in one card has exactly two tokens and reaches for the slash. That is not
laziness; it is the shape of the token set. **`personas-web` shows the fix and also its limit**: it
publishes a five-rung ladder with the measured floor written into the comment beside each name
(`--muted-dark ≥ 7.5:1`, `--muted-foreground ≥ 6.6:1`, `--muted ≥ 4.8:1`, `--text-secondary ≥ 5.5:1`,
`--text-disabled ≥ 4.5:1`) and doctrine saying to prefer them over opacity classes — and three of the
five rungs have **0, 0 and 1** uses while `text-foreground/NN` is used 188 times in the same repo.
Ship the tiers *and* the ratchet, or you will have this section's problem with more nouns.

**G2 — nothing can score a rendered pair, because the transform is not in the same language as the
tokens.** `check-themes.mjs` reads CSS variables; the brightness filter is a `filter` declaration and
the surface is a `--card-bg` composite. Extending the audit to model both is real work
(alpha-compositing plus an sRGB channel multiply — about 30 lines, and this document's measurement
harness is a working reference), but it is not a config change. Until it lands, **every ratio the
repo asserts is a ratio of colours it does not render.**

**G3 — the light-theme palette correction cannot be complete, only longer.** It is a manual
enumeration of `<hue>-<shade>[/alpha]` combinations. Tailwind's palette is 22 hues × 11 shades × any
alpha; the enumeration covers 153 cells. Every new palette class a developer writes has a default
behaviour of "uncorrected", and there is no signal at authoring time. The structural answer is to
stop using palette classes for text at all and route through `text-status-*`
— which is blocked on
[`design-token-usage.md`](./design-token-usage.md) Gap 3, because `STATUS_PALETTE` currently publishes
its tokens *as* palette class strings, making adopter and violator textually identical.

**G4 — there is no theme-aware colour primitive for the app layer.** `ensureContrast` exists, works,
and is scoped to connector brand marks. There is no `useContrastSafe(color)` or
`--on-card-secondary` that a component could reach for, so "make this legible on both families" has
no primitive to name. `contrastRatio.ts` has the maths; nothing composes it with the active theme.

**G5 — the custom-theme path has no audit surface at all.** `check-themes.mjs` is a Node script over
a CSS file; a custom theme is a runtime `Record<string,string>` in a Zustand store. They cannot meet.
The fix is a type, not a script — see below.

**G6 — nothing tests any of this.** Zero tests assert a contrast ratio, that `data-contrast="high"`
raises anything, that a theme's tokens differ from another's, or that the filter is applied.
`check-themes.mjs` has a `CHECK_THEMES_CSS` hook designed for a regression fixture and **no fixture
uses it**.

---

## Type over gate — the answer

**Answered before §9, per the contract. The honest answer is split, and the split is the finding.**

**For the call site: no, and not for want of trying.** Tailwind classes are strings; alpha is a
continuous parameter; no prop signature stands between `text-foreground/60` and the DOM. The nearest
thing to a type in a string-typed system is a **closed vocabulary**, and this document measured what
that buys: `personas-web` published a named ladder with contrast floors baked into the token names
and still uses `text-foreground/NN` 188 times, with three of its five rungs at 0/0/1 adoption. **The
closed vocabulary is necessary and demonstrably insufficient**; it retires the *justification* for
the modifier without retiring the modifier. So for the call site the answer is: publish the tiers
(G1), and gate — §9 is the ratchet that makes the tier the path of least resistance.

**For the theme boundary: yes, and it is three lines.** This is where the leverage is. Today
`deriveCustomTheme(config)` returns `Record<string, string>` and `applyCustomTheme` accepts it. That
signature makes "a theme that fails the WCAG audit" perfectly representable — and §7.G measures that
every derived dark theme *is* one. The type move:

```ts
// contrastRatio.ts already exports the maths; this is the missing newtype.
declare const AUDITED: unique symbol;
export type AuditedTheme = Record<string, string> & { readonly [AUDITED]: true };

export function auditTheme(vars: Record<string, string>):
  | { ok: true; theme: AuditedTheme }
  | { ok: false; failures: Array<{ pair: string; ratio: number }> };
```

with `applyCustomTheme(theme: AuditedTheme)` as the only entry point. A palette that has not been
through the audit becomes unassignable, `deriveCustomTheme` is forced to either fix its `--muted`
formula or surface the failure, and the "Low" badge stops being advice. **This is the one place in
this leaf where a signature can delete a whole defect class**, and it is small precisely because
`getContrastRatio` already exists — the gap is that nothing sits on the boundary.

**The general rule this leaf adds.** [`focus-management.md`](./focus-management.md) derived a
guarantee from a prop that already existed;
[`entity-visual-identity.md`](./entity-visual-identity.md) made an optional prop required. Here:
**where the wrong value is a number rather than a shape, the type has to move to the boundary the
number crosses.** You cannot type an alpha. You can type the *theme* it will be composited against,
and you can refuse to apply one that has not been measured.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what
follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The risk is acute for this
leaf and is no longer hypothetical: `personas-web` wrote a rule for exactly this condition, and
running its regex against `brainiac/console` showed it would see **30 of 167** opacity-tinted text
classes and miss **97 of the 115 that are actually below the threshold — 84% blind** — because the
console writes `text-[var(--ink)]/35` and the rule matches `text-[\w-]+/(\d+)`. The gate is coupled
to a class-naming idiom, not to contrast. State the condition; let the next repo derive its own
proxy.

Everything in §7 shipped under a green `npm run check`, a green `npm run check:themes`, and 0 lint
errors.

### The semantic condition

> **C1 — text hierarchy is expressed as alpha on the body-text token, tuned on one theme family and
> shipped to all of them.**

*Proxy here:* `text-foreground/N` with N ≤ 45, anywhere under `src/`.

*Why 45, computed not chosen.* On the three light themes this app ships, `text-foreground` at 45%
alpha measures **2.65–2.93:1 across all 18 configurations the app can be in** (canvas and card
surfaces × three brightness levels) — below the 3:1 AA-large floor as well as the 4.5:1 AA floor, so
**no font size rescues it**. The same class measures 4.52–4.94:1 on all eight dark themes, which is
why it was written and why it survives review. 45 is the *highest* alpha at which the failure is
unconditional: `/50` also fails AA in all 18 light configurations but reaches 3.40:1 at the brightest
level, so large text there could be defended. Setting the cutoff one step past the measurement is
exactly the P6 mistake §7.B measured in the existing rule; I am not repeating it.

*Precondition:* this repo expresses alpha with Tailwind's `/N` modifier on a CSS-variable-backed
token, and renders light themes through a global `brightness(0.82)` filter that lowers their contrast
further. A repo whose light theme is a separate stylesheet, or that has no light theme, must
re-derive the proxy — **the condition is the alpha, not the slash**.

### Already-gated check

Searched all 75 rules in `scripts/census/rules.json`. The nearest neighbours are
`typo-token-overpainted` and `hand-rolled-disabled-state` (both `design-token-usage.md`),
`code-unit-monogram` (`entity-visual-identity.md`), and `unlooking-lint-rule`
(`custom-lint-rule.md`). None matches `text-foreground`, an opacity modifier, a palette class or a
theme selector — one file in `rules.json` mentions the word `contrast`, and it is a `goldenPath`
path. **Not already gated; no id collision.**

`unlooking-lint-rule` deserves a note because it is one shortcut away from §7.F's finding: it keys on
`getText().includes(…)`, `.type !== 'Literal'`, and aborting at an enclosing arrow function. It does
**not** key on "reads a template literal's `quasis` and never its `expressions`", which is the
shortcut all seven className-walking rules here take. That belongs to `custom-lint-rule.md`, not to
this leaf; it is offered as a finding for that path's next revision rather than claimed here.

### Conditions deliberately NOT given a census rule

- **C2 — a palette text class outside the light-theme correction layer's enumeration** (§7.E; 430
  hits / 116 classes, 421 of them failing AA on a light card). The signal is expressible — shades
  `50|100|200` of any hue, plus `300|400` at an alpha outside `/50`–`/80` — and precision measures
  **97.9%**. **Refused, and the refusal is the finding.** The rule would be keyed to the *current
  contents* of a hand-maintained CSS allow-list, so the moment someone adds an override the gate
  fires on corrected code — the "gate that fires on correct content" failure, with a delay fuse.
  Worse, it would reward the wrong fix: extending the enumeration (P5) rather than leaving the
  palette vocabulary. **Ship it the day `text-status-*` exists as a real token spelling**
  ([`design-token-usage.md`](./design-token-usage.md) Gap 3) and the legal fix stops being "add
  another row".
- **C3 — element-level alpha over text** (`opacity-N` at rest, 703 hits / 351 files, 322 in the 1–60
  band). Same rendered defect as C1 in different syntax. Refused on precision: `opacity-N` also dims
  icons, dividers, decorative gradients and ghost skeletons, and **the syntax carries no information
  about whether the subtree contains text.** An AST rule could ask; a census rule cannot. Recorded as
  the follow-up for the ESLint host.
- **C4 — a theme in `globals.css` absent from `check-themes.mjs`'s `THEMES` array.** Real, and
  currently clean (11 = 11). A census rule cannot express a *join* between two files, and it cannot
  express "must be zero" (the runner fails a rule matching nothing — `engine.mjs:264-274`). This is a
  **check-script** condition, not a census one: 6 lines inside `check-themes.mjs` asserting that
  every `[data-theme="…"]` block in the CSS appears in its own array, failing loudly if not. Named
  here as owed work.
- **C5 — the audit's own blindness to the filter** (§7.A). Not a countable signal at all; it is a
  correctness bug in `check-themes.mjs`. Fixing it is sequencing item 1 below, not a gate.

### The rules — validated

Run standalone against a private registry, never touching the shared `rules.json`:

```
$ node scripts/census/run-census.mjs --rules <scratch>/rules-theming-and-contrast-tc.json --check

  rule                                        files  base  matches  base  walked  floor
  OK  illegible-foreground-alpha                183   183      385   385    4829   4000
  OK  legible-foreground-alpha-positive-control 494     —      899     —    4829   4000

  census OK — 2 rule(s), 9658 file-visits, 1284 surviving violation(s) across 677 file(s).
```

**Cross-checked through a second implementation before baselining**, per the contract. An
independent whole-file regex counts **386** raw occurrences (`/45`×125, `/40`×174, `/35`×51,
`/30`×25, `/25`×9, `/20`×1, `/15`×1); the runner reports 385 plus **1** match discarded on a
comment-only line (`monitoringCard.tsx:20`, a doc comment describing the pattern). The control:
independent count **902**, runner **899**, the difference being exactly 3 comment-only lines
(`MessageDetailModal.tsx:87`, `:600`, `SectionCard.tsx:32`). Both reconcile to the digit.

**Precision — 94.0%, measured by classifying every one of the 385 hits by its owning JSX element:**

| bucket | hits | share | verdict |
| --- | ---: | ---: | --- |
| HTML element carrying text | 222 | 57.7% | true positive (WCAG 1.4.3, 4.5:1) |
| `placeholder:` text | 105 | 27.3% | true positive — placeholder is text |
| module-scope class constant applied to text | 20 | 5.2% | true positive |
| **icon component with `aria-hidden`** | **20** | **5.2%** | **false positive — decorative, WCAG-exempt** |
| icon component, not `aria-hidden` | 9 | 2.3% | true positive (WCAG 1.4.11, 3:1 — measures 2.42) |
| `className` forwarded to a text component (`RelativeTime`, `MarkdownRenderer`) | 4 | 1.0% | true positive |
| **`aria-hidden` `<span>`** | **3** | **0.8%** | **false positive** |
| class map in a `.ts` file | 2 | 0.5% | true positive |

**23 of 385 false positives (6.0%).** All 23 are `aria-hidden` decorative marks, which WCAG exempts;
they still render at 2.4:1 on a light card, so they are a design smell rather than a violation. They
are **not excluded** — an `exclude` entry needs a path, and these are scattered across 20 files;
naming them individually would be an allow-list with the same disease as §7.E.

**The positive control is the discriminator's proof.** `text-foreground/(?:100|9[0-9]|8[5-9])` shares
the token, the slash and the digit grammar with the violation and differs **only in the number** —
which is the quantity that decides legibility. It matches 494 files / 899 occurrences, all of which
measure ≥ 7.30:1 on every theme, on both surfaces, at every brightness level. It carries no baseline
by design.

### How each fails loudly if its own precondition is absent

Not asserted — **executed.** Each fault was induced against the real working tree and the exit code
captured:

| induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 250 -> 183 (-67) without the baseline moving.` |
| baseline deflated (a rise) | **1** | `[drift] files rose 100 -> 183 (+83). New violations of …theming-and-contrast.md` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| positive control given a `baseline` | **1** | `census: rules[1] …: a positive control must NOT carry a baseline — it exists to fail` |

Floor 4,000 sits below the observed 4,829 `.ts`+`.tsx` walk with margin, consistent with
`hand-rolled-disabled-state` and `code-unit-monogram`, which walk the same roots.

### Severity

**Not argued from volume, and `warn` is not on the table.** `npm run check` runs `eslint src/` with
no `--max-warnings` and the pre-commit hook runs `--quiet --max-warnings 99999`, which suppresses
warnings before they can be counted — **a warn-level rule enforces nothing at either gate at any
count**, which is why the 705-warning rule in §7.B has stood at 705. The census runner has no
severity dial: `npm run census:check` is fatal on drift. That is the correct level here on the
strength of 94.0% precision, an empty overlap with the control, and a threshold derived from 18
computed configurations — not on the strength of how many violations there are.

### Rule block — for the orchestrator to merge into `scripts/census/rules.json`

```json
{
  "id": "illegible-foreground-alpha",
  "goldenPath": "docs/concepts/golden-paths/theming-and-contrast.md",
  "title": "Body-text token dimmed past the point where any WCAG floor is reachable on the light themes",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "text-foreground\\/(?:4[0-5]|[1-3][0-9]|[0-9])\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The semantic body-text token composited toward the canvas at 45% alpha or less. PROXY FOR the stack-free condition: TEXT HIERARCHY EXPRESSED AS ALPHA ON THE BODY-TEXT TOKEN, TUNED ON ONE THEME FAMILY AND SHIPPED TO ALL OF THEM. Computed, not asserted: on the three light themes this repo ships, text-foreground at 45% alpha measures 2.65-2.93:1 across every configuration the app can be in (canvas and card surfaces, all three brightness levels of the Appearance setting) - below the 3:1 AA-large floor as well as the 4.5:1 AA floor, so no font size rescues it. The same class measures 4.52-4.94:1 on all eight dark themes, which is why it was authored and why it survives review. 45 is the highest alpha at which the failure is unconditional; 50-60 also fail AA on every light configuration but can clear 3:1 for large text, so they are excluded to keep precision at 100% of the WCAG floor that applies. Measured precision 94.0% (23 of 385 are aria-hidden decorative marks, WCAG-exempt but still 2.4:1). PRECONDITION: this repo expresses alpha with Tailwind's /N modifier on a CSS-variable-backed colour token, and renders light themes through a global brightness(0.82) filter that lowers their contrast further. A repo whose light theme is a separate stylesheet, or that has no light theme, must re-derive the proxy - the condition is the alpha, not the slash. The legal fix is bare text-foreground with hierarchy carried by the typo-* scale, per Design.md principle 4."
  },
  "baseline": { "files": 183, "matches": 385 },
  "floor": 4000
}
```

```json
{
  "id": "legible-foreground-alpha-positive-control",
  "goldenPath": "docs/concepts/golden-paths/theming-and-contrast.md",
  "title": "POSITIVE CONTROL - the same token at an alpha that clears AA on all eleven themes",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "text-foreground\\/(?:100|9[0-9]|8[5-9])\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Same token, same slash, same digits-after-slash grammar - the ONLY difference is the number. text-foreground at 85% alpha or more measures 7.30:1 or better on every one of the eleven shipped themes, on both the canvas and a card, at every brightness level. It shares every lexical feature with the violation and differs only on the quantity that decides legibility, which is what proves the violation rule discriminates on the measured threshold rather than on the token name. Expected ~494 files / ~899 matches. Carries no baseline by design: a control that ratcheted would fail the build every time compliant usage grew."
  },
  "floor": 4000
}
```

### Sequencing

1. **Teach `check-themes.mjs` the two transforms it is missing** — the `brightness()` filter at each
   family's default level, and the `card-bg`-over-`background` surface. ~30 lines; this document's
   harness is a working reference. Expect three light-theme rows to turn red at
   `muted-foreground@80`; that is the point. Fix `contrast.md`'s "13 themes" and "~170×" while you
   are in there. **Do this before anything else** — every other threshold in the repo is downstream
   of a number this script prints.
2. **Recalibrate `custom/no-low-contrast-text-classes` to the measurement, or split it in two.**
   Either move the cutoff to the measured failure point and drop the bare-token ban (the ratio says
   7.02:1 at worst), or keep the ban and re-message it honestly as a *design policy* with a separate
   rule id, so the contrast half can be burned down and the policy half can be argued on its merits.
   Today the two are welded and neither moves. **267 of 705 warnings disappear on the measurement
   alone.**
3. **Add `...node.expressions.flatMap(extractStrings)` to the `TemplateLiteral` branch** — in this
   rule and in the six siblings that share the walker. One line, +116 reports here, and it is the
   syntax the defect actually lives in (§7.F).
4. **Ship §9's census rule** as the ratchet on the 385 unconditional failures, and delete
   `text-foreground/90` and `/95` (697 occurrences) in the same sweep — they are no-ops (§7.D).
5. **Make `applyCustomTheme` take an `AuditedTheme`** and fix `deriveCustomTheme`'s `--muted`
   formula. See [Type over gate](#type-over-gate--the-answer). This closes §7.G permanently rather
   than counting it.
6. **Publish a third text tier** (G1), then re-run step 2's threshold — with a legal destination for
   "dimmer", the remaining opacity sites have a mechanical fix instead of a judgment call.
7. **Then** — and only then — gate the palette layer (C2), once
   [`design-token-usage.md`](./design-token-usage.md) Gap 3 has made `text-status-*` a real spelling.

---

## Convergence — what the sibling repos say

Measured independently in `../personas-web` (Next.js marketing site, 1,037 code files) and
`../brainiac/console` (Next.js internal console, 245 code files). Neither was modified.

### Reinvented independently — treat as physics

| Clause | personas | personas-web | brainiac/console |
| --- | --- | --- | --- |
| **Multi-theme via `[data-theme]` + CSS custom properties, light tier first-class** | 11 themes, 8+3 | **11 themes, 8+3**, full ~26-declaration token block per light theme | **declined outright** — `theme.ts:14`: "Fixed art direction → literal hexes/hsl on purpose (no light theme)" |
| **Text hierarchy expressed as alpha** | `text-foreground/N` ×1,906 | `text-foreground/N` ×188 of 646 | `INK`/`INK_DIM`/`INK_FAINT` ×314 refs |
| **…and at least one rung of it below AA** | `/45` = 2.75:1 on light | `/60` = **4.13:1** on its own `light` theme | **`INK_FAINT` (α 0.35) = 2.83:1** — and it is the console's *most-used* text token (132 refs) |
| **A light-theme override layer that re-points dark-tuned utilities, with `!important`** | 170 `.text-*` selectors + 51 `bg-` + 44 `border-` | **~105 rules**, aimed at `white/alpha` glass utilities, header states the same rationale | n/a |
| **A warn-level, proxy-based contrast lint rule with no blocking enforcement** | `no-low-contrast-text-classes`, threshold 80 | **`no-low-text-opacity.js`, threshold 60**, `eslint.config.mjs:54`, warn, CI has no `--max-warnings` | absent |
| **Hand-rolled `disabled:opacity-N` with no shared inert token** | 594 hits / 10 values | 31 hits / 5 values | 5 hits / 3 values |

**Five clauses reinvented with no shared document.** The strongest is the third: three codebases,
three syntaxes, and all three have an alpha rung that fails AA. **P2 is physics.**

### The controlled comparison — and it points against strictness

`personas-web`'s rule threshold is 60; its distribution of `text-*/N` is **/60×118, /65×9, /70×85,
/75×8, /80×84, /85×25, /90×34, /95×2 — 365 at or above, zero below.** This repo's threshold is 80
plus a token ban; it has **531 occurrences below /60.** Both rules are warn-level, both CI jobs run
eslint without `--max-warnings`, both densities are comparable (0.35 vs 0.39 tinted classes per
file). The one variable that differs is where the line was drawn.

Confounded by wiring date, which [`design-token-usage.md`](./design-token-usage.md) §7.A showed
dominates adoption, and it is one observation per repo. But it is the only evidence that exists on
the question, and §7.B's independent finding — that 37.9% of this repo's warnings are not contrast
defects at all — is a mechanism by which an over-strict threshold would produce exactly this outcome.

### Where convergence contradicts this brief — reported honestly

- **The brief's framing of `disabled:opacity-N` as "where text quietly drops below threshold" does
  not survive the standard.** WCAG 1.4.3 exempts inactive components, so the 594 occurrences are a
  token-consistency defect, not a contrast one, and they are already gated by another path's rule.
  The number reproduced exactly (594 / 10 values) — the *interpretation* was wrong, not the count.
  §7.H records it as a cleared claim.
- **The brief anticipated the light theme would be a retrofit. At the component layer it is not** —
  113 of 174 base classes carry a light override, only 2 hardcode a white/black literal without one,
  and all three light themes have complete token blocks. `personas-web` reached the same posture
  independently. The retrofit is one layer down, in the palette correction table, and that is where
  §7.E points.
- **The brief anticipated the identity/status swatch collision would extend here.** It does not: this
  leaf's collisions are between *thresholds*, not between palettes.
  [`entity-visual-identity.md`](./entity-visual-identity.md) already found and corrected the palette
  version of that claim; nothing in the token vocabulary reproduces it.
- **A sibling's own gate would be 84% blind if ported.** `personas-web`'s rule regex
  (`text-[\w-]+/(\d+)`) run against `brainiac/console` sees 30 of 167 opacity-tinted text classes and
  misses **97 of the 115 below its own threshold**, because the console writes
  `text-[var(--ink)]/35`. Fourth independent confirmation of the contract's §9 manifestation-layer
  rule, and the reason §9 above states the condition before the proxy.

### Not reinvented anywhere — local to this repo, flagged as such

- **`html { filter: brightness(…) saturate(…) }`.** Zero root-level filters in either sibling. This
  is a house eccentricity, and it is upstream of §7.A(a) and all of §7.D. Anyone adopting this path
  elsewhere inherits none of it — and should check whether their own stack has an equivalent
  transform between token and pixel (a backdrop, a blend mode, a canvas overlay), because P1 is
  about the transform, not about `filter`.
- **An in-app high-contrast toggle.** Neither sibling has one. `personas-web` has the OS-driven
  `forced-colors` block instead (`globals.css:904-937`) — which, unlike this repo's toggle, *does*
  re-point `--foreground` and `--background` to `CanvasText`/`Canvas`. **The sibling's free,
  OS-supplied contrast mode does the thing this repo's hand-built one does not.** House convention,
  and a weaker one than the alternative it replaced.
- **A hand-enumerated numbered-palette correction table.** `personas-web` reinvented the *mechanism*
  but aimed it at a different utility family; only 3 of its rules touch the numbered palette. The
  151-cell enumeration is local.

---

## Appendix — the measurement harness

Every ratio in this document was computed, not looked up. The harness was four throwaway Node
scripts in the session scratchpad plus two temporary AST scripts at the repo root, all deleted after
the run; the tree was left as found. Independent implementations were used wherever a number carries
an argument, and the disagreements are recorded above.

Four things that could not have been learned by reading:

1. **`text-foreground/90` renders pixel-identical to `text-foreground` on six of eight dark themes.**
   Reading the CSS suggests a 10% dim-down. Multiplying by the filter and clamping shows the
   composite reaching 255 in all three channels. 608 occurrences. (§7.D)
2. **`text-muted-foreground/80` fails AA on all three light themes.** `check-themes.mjs` prints 4.6
   and passes it — the tightest three margins in its table. Applying the `brightness(0.82)` those
   themes ship at by default gives 4.11 / 4.09 / 4.00. The audit and the screen disagree by
   0.5. (§7.A)
3. **267 of 705 lint warnings are not contrast defects.** Reading the rule suggests a backlog of
   illegible text. Computing each flagged class against each theme shows 37.9% of it clears AA
   everywhere — including the rule's own largest bucket, which a second shipped gate hard-fails CI to
   protect. (§7.B)
4. **The rule's blind spot and the defect share a cause.** The walker gap is 14.1% for this rule but
   1.1% for radius and 2.7% for text size, because opacity-as-hierarchy is inherently the `else`
   branch of a conditional and conditionals inside template literals are exactly what the walker
   skips. Measuring one rule would have shown a bug; measuring three showed a mechanism. (§7.F)

Two claims were **disproven during composition and are recorded rather than dropped**: that light
theming is a retrofit here (it is first-class at the component layer, §7.H(b)), and that
`disabled:opacity-N` is a contrast defect (WCAG exempts it, §7.H(a)). One measurement error was
caught by a second implementation and corrected: the first palette audit compounded a light
override's own `rgba()` alpha with the utility's `/N` modifier, understating `text-red-400/80` on
light as 2.25 when the override *replaces* the alpha and the true figure is 4.10 — the correction
came from reading the actual selector escaping (`.text-red-400\/80`), which is why the cascade model
in §7.E is stated explicitly.
