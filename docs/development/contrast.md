# Text contrast compliance (WCAG AA)

Body and helper text must clear **WCAG 2.1 AA — 4.5:1** against the canvas in
**every** theme. This is an accessibility requirement, not a style preference:
secondary text (`muted-foreground`, `muted`) is where the app talks to
non-technical users, and "set by feel" contrast drifts below legible the moment
a new theme or an opacity tint is added. The gate below fixes contrast at the
**token** level so a single token change lifts (or breaks) legibility everywhere
at once, and CI catches regressions.

## The token gate — `scripts/check-themes.mjs`

`npm run check:themes` parses `src/styles/globals.css` **and
`src/styles/typography.css`**, resolves each theme's effective variable map
(`:root` defaults + the `[data-theme="…"]` overrides), and computes contrast
ratios. It is **wired into CI** (`.github/workflows/ci.yml`)
and **fails the build (exit 1)** if any of these text-token pairings drops below
AA (4.5:1) in any theme:

| Pairing | What it covers |
| --- | --- |
| `foreground / background` | primary body copy |
| `muted-foreground / background` | secondary / helper text (`text-muted-foreground`) |
| `muted-foreground / background` **@ 80% opacity** | opacity-tinted captions (`text-muted-foreground/80`) |
| `muted / background` | dim / tertiary text (`text-muted`) — used as a text class ~170× |

`primary` and the `status-*` colors are also reported, but as **informational
warnings** at the 3.0:1 (AA-large / non-text-UI) threshold — they label chips,
icons, and accents rather than running copy.

```bash
npm run check:themes      # prints the full table; exits 1 on any sub-AA text pairing
```

### The type tokens — the other half, unread until 2026-10-03

The table above grades the **palette**. `globals.css` only declares the
variables; `typography.css` decides what fraction of them a given tier of text
is painted in, and **that file was never opened**. The cost was measured: on
2026-10-03 `.typo-caption`'s muting moved from 70% to 80% foreground — 4,292
occurrences across 1,269 files, the widest-reaching text-colour change the app
has had — and `check:themes` ran **green without looking at it**.
`--muted-foreground`, which the gate does grade, appears **0 times** in
`typography.css`; `.typo-caption` is what the app's secondary prose actually
wears.

So a second table now scores **every `.typo-*` rule that sets `color`** against
each theme's `--background`, at the same 4.5:1 floor:

- the per-theme value is the `[data-theme*="light"]` override where the file
  writes one, otherwise the base declaration;
- `color-mix(in srgb, A N%, transparent)` is composited over the canvas (the
  same model the `muted-fg@80` row uses); an opaque second term is interpolated;
- a value the parser cannot read is **printed as "not scored"**, never counted
  as a pass, and a run that parses *no* type tokens **exits 2** — the matcher
  going blind must not look like a clean bill of health.

Known sub-AA cells are recorded in `TYPE_TOKEN_EXEMPT` with a reason and are
**two-sided** (built like `MONOCHROME_THEMES`): a new one fails the gate, and an
exemption whose cell has climbed back above the floor also fails, so the map
cannot rot into a permanent licence. **The map is EMPTY as of 2026-10-03** and
all 77 cells clear AA.

It held four entries for one day, all one defect seen four times: `dark-red`'s
`--primary` (`#cc0000`) is itself 3.40:1 on its own `#080808` canvas — the
informational `primary/bg` row above had always said so — and every
primary-tinted tier inherited it (`typo-title` 4.28, `typo-title-lg` 4.28,
`typo-section-title` 3.80, `typo-submodule-header` 3.62). **The fix was not to
move `--primary`.** That colour is the theme's identity, Gate 0 and Gate 1
protect the brand tint and the glow, and the owner's recorded preference is to
keep the hue rather than pass a number. `globals.css` instead gained a second
token:

> **`--primary-ink` — the brand tint AS TEXT.** `var(--primary)` in `:root` and
> in ten of the eleven themes, so nothing but `dark-red` changed a pixel.
> `dark-red` sets it to `#ff1a1a`: `hsl(0 100% 55%)` against `#cc0000`'s
> `hsl(0 100% 40%)` — **hue and saturation preserved exactly, lightness the only
> axis that moved**, which is what "Changing a theme token" below prescribes.
> The four tinted `.typo-*` tokens in `typography.css` mix `--primary-ink`; the
> `.typo-card-label` glow and the hero-shine gradient still mix `--primary`,
> because those ARE tint.

Measured after: 6.04 / 6.04 / 5.54 / 5.36:1 — every cell AA with ~19% headroom,
and `primary/bg` still reports 3.4:1 because the brand colour genuinely did not
move. A brand colour chosen for a 4% gradient wash is not automatically legible
as 13px type; the two jobs now have two tokens. The exemption map stays in the
script, with its two-sided contract intact, for the next theme whose brand
colour is beautiful and illegible.

Measured while wiring this up: the caption muting holds AA down to **`/65`** and
breaks at **`/60`** on the light themes — so the 70→80 change was safe, which
is now *verified* rather than assumed.

**What this half still cannot see:** a `text-foreground/NN` utility written in a
`.tsx` file appears in no stylesheet, so no CSS reader can find it. What the gate
*can* compute is the floor those sites must clear, and it prints it every run:
`--foreground` over `--background` holds AA down to **`/50`** on the dark themes
and **`/65`** on the light ones. The sites themselves are ratcheted instead, by
the census rule `off-ladder-ink-opacity` — see "The ink ladder" below.

## The ink ladder: one muting level, three names

**Replaces the old "caption-opacity floor: `/80` minimum" section** (2026-10-03).
That section's advice — "bump them to `/80`" — was right about the direction and
wrong about the mechanism: it treated the opacity modifier as the unit of
hierarchy, when the unit is the token.

### What was measured

| finding | measurement |
| --- | --- |
| `--muted-foreground` was a per-theme hex | solved back into a fraction of each theme's own `--foreground`: **64.8% to 85.6%** — dark-frost 64.8, dark-bronze 67.6, dark-red 67.7, dark-matrix 68.3, dark-pink 69.9, dark-purple 70.8, light-news 76.0, dark-cyan 76.0, light-ice 76.3, light 76.8, dark-midnight 85.6. One named role, eleven values. 229 sites, 131 files. |
| `.typo-caption` had just gone to a flat 80% | app-wide, by the owner, 4,292 occurrences in 1,269 files — so the two named tokens were **1.12:1 apart** on the default theme (the same voice), and the ordering **flipped**: `--muted-foreground` was the stronger of the two in 6 of 11 themes before, in **1 of 11** after |
| a third, uncontrolled family | **1,797 `text-foreground/NN` + `text-muted-foreground/NN` sites across 719 files**, at **17** distinct levels on `text-foreground` (`/15`–`/95`) and 7 on `text-muted-foreground`. Measured on a clean `git archive HEAD` export. (An earlier count of "18 levels, 1,679 sites" was taken on the shared working tree; re-measure on an export before citing either.) |
| the real muting floor | `.typo-caption` holds AA down to **`/65`** and breaks at **`/60`** on the light themes — so the 70→80 move was safe, verified rather than assumed |

### The ladder

```
100%   --foreground                  full ink: prose, names, figures
 80%   --muted-foreground            everything secondary to the line above it
       .typo-caption                 (same level, carried by the type token)
       --quiet  (kit.css)            (same level, carried by the kit)
  –    --muted / --muted-dark        the dim tertiary tier; NOT on the percentage
                                     basis (it computes to 47.5%–67.3% across the
                                     themes — a fourth spread, still unresolved)
```

`--muted-foreground` is declared **once**, in `:root`, as
`color-mix(in srgb, var(--foreground) 80%, transparent)`, and the ten per-theme
hexes are deleted. Each theme overrides `--foreground`, so the mix resolves per
theme for free. The percentage basis is not new: `html[data-contrast="high"]` has
always written this token as a `color-mix` fraction of the foreground; the normal
mode now agrees with it.

After the change the gate reads `muted-fg/bg` **8.47:1 to 11.14:1** (was 7.37–11.41,
AAA everywhere) and `muted-fg@80` **5.05:1 to 7.21:1** (was 4.60–7.56). So the old
claim that "`/80` is exactly the AA floor" is no longer true — it is now comfortably
inside AA, and the floor for a modifier on *this* token is **`/75`** on the light
themes and **`/65`** on the dark ones.

> **The rule is now about the token, not the number.** Do not write an opacity
> modifier on an ink token at all. The token carries the level: `text-foreground`
> is full ink, `text-muted-foreground` is the one muting, and if you want
> something dimmer than the one muting you want **a different piece of
> information**, not a less-legible one.

The census rule `off-ladder-ink-opacity` freezes the third family at its measured
count so it cannot regrow (211 → 212 rules; baseline 719 files / 1,797 matches,
seeded red in `scripts/census/self-test.mjs`).

### The staged sweep and its mapping

`scripts/style/codemod-ink-ladder.mjs` applies the ladder. **It is written,
dry-run-verified and NOT YET RUN**: the sweep rewrites 1,451 sites in 644 files
across every feature module, and three builders were live in `src/features/**`
when it landed. It wants a quiet tree and its own commit.

| from | to | sites | why |
| --- | --- | --- | --- |
| `/85` `/90` `/95` | `text-foreground` | **845** | within 1.18:1 of full ink. `/90` is 12.7:1 against full ink's 15.7:1 on the default theme — a difference no reader can name, written at 571 sites. This is full ink spelled three ways. |
| `/50` … `/80` | `text-muted-foreground` | **562** | the muting band. The token IS 80% now, so `/80` is the token and the rest approximate it. `/50` is the AA floor on dark (4.5:1) and **fails on light** (3.3:1). |
| `/15` … `/45` | **hand review** | **251** | sub-AA in every theme (`/45` = 4.1:1 dark, 2.9:1 light). Two different things wear this spelling and no regex separates them: secondary prose, and an **icon stroke / separator / decorative glyph**, which is not an ink token's job at all. 2 of a 12-site precision sample were icons. |
| `placeholder:` / `placeholder-` | `placeholder:text-muted-foreground` | **107** | a separate opt-in pass (`--placeholders`). A placeholder is not content, so AA does not bind it, and 82 of these sit below `/50` (`placeholder-muted-foreground/30` is the repo's own idiom, `src/lib/utils/designTokens.ts:142`). Moving them onto the muting level is a visible design change, not a token cleanup. |

Variant prefixes (`hover:`, `group-hover:`, `focus-visible:`) are kept and mapped
by the same table: a state's job is to **change**, and the pair still changes when
both ends are on the ladder.

After the sweep the rule's count falls to 355 matches in 191 files (proved by
running the codemod against a throwaway export). That is a **drop**, so it is
cleared with `npm run census -- --update` in the sweep's own commit — the
legitimate use of `--update`, never for a rise.

### A conflict to settle before the sweep runs

`eslint-rules/no-low-contrast-text-classes.cjs` (warn, 705 findings — the single
largest contributor to the lint warning baseline) says the opposite of this
document: it forbids `text-muted-foreground` **outright**, with or without a
modifier, and sends every site to `text-foreground`, adding "for visual hierarchy
use `text-primary` + a text-shadow, NOT lower opacity". That rule predates both
the one-muting-level doctrine (`docs/design/style-mastery/doctrine.md` section 3)
and the AA calibration of the muted token. **Three documents, three answers** —
and because the rule is warn-level with no `--max-warnings` at either gate, its
705 findings enforce nothing while still steering every editor squiggle toward
un-muting text the ladder says should be muted. Reconciling it is the sweep's
precondition, and it is an `eslint-rules/` change, not a stylesheet one.

### Weight is not a lever here, and that was measured too

The sibling question — "reading prose feels muted; step the weight up" — has no
answer in this app, and the reason belongs beside the contrast figures because it
is the same kind of mistake: a diagnosis that was right about the perception and
wrong about the mechanism.

Probed 2026-10-03 in the same headless Chromium that shoots the review
screenshots, against the real `--font-sans`
(`system-ui, 'Segoe UI Variable Text', 'Segoe UI', …`), measuring both advance
width and canvas ink coverage of a 13.2px sample:

| requested `font-weight` | advance | verdict |
| --- | --- | --- |
| 300 | 335.203px | distinct (Light) |
| 400 | 353.938px | Regular, ink 222 |
| 420 / 450 / 475 | 353.938px | **identical to 400** |
| 500 | 360.938px | Semibold, ink 273 (+23%) |
| 600 | 360.938px | **identical to 500** |
| 700 | 375.484px | distinct (Bold) |

`system-ui` resolves to **Segoe UI**, a static family with no Medium: CSS font
matching for a target in (400, 500] searches upward to 500 first, finds nothing,
and falls back below — so a half-step renders as 400. `font-variation-settings:
'wght' N` changes nothing either, at any value, on any of 'Segoe UI Variable
Text', 'Segoe UI Variable Display' or 'Segoe UI Variable' (identical advance AND
identical ink at 400 through 600). **The rendered ladder is 300 / 400 / 600 /
700.** "One step up from body" means Semibold.

Two consequences:

- Reading prose cannot be stepped up without becoming Semibold, which puts it at
  the same rendered weight as `.typo-title`, `.typo-label` and the kit's
  `.k-strong`. The lever for prose is **size** (`.typo-body` step 1 → `.typo-body-lg`
  step 2, 13.2px → 14.9px at the default appearance setting), not weight.
- `font-weight: 500` and `600` are **the same pixels**, so the kit's `.k-medium`
  and `.k-strong` are indistinguishable, and any emphasis recipe that separates a
  white name (500) from a tinted title (600) is separating them by **tint alone**.

Measured with the probe recorded in the `.typo-body` comment block of
`src/styles/typography.css`. Caveat, stated: the probe runs in
`chrome-headless-shell`, which is the engine behind the review screenshots but
not byte-identical to the WebView2 runtime the shipped app uses. Both resolve
`system-ui` to the same Windows system font, so the conclusion holds; re-probe
inside the app before betting anything expensive on it.

### Note for custom themes

`src/lib/theme/deriveCustomTheme.ts:137,162,183` derives its own
`--muted-foreground` hex and writes it as an inline style on `<html>`, which beats
`:root`. Custom themes are therefore **not on this ladder** and are not among the
eleven themes the gate grades. A derived theme at, say, 58% of its foreground is
invisible to every measurement in this document.

## Changing a theme token

If `check:themes` fails after you edit a palette:

1. Read the failing row — it names the theme, the pairing, and the measured
   ratio (e.g. `dark-purple · muted/bg = 2.31:1 (needs ≥ 4.5)`).
2. Adjust the offending token in `src/styles/globals.css`. On **dark** themes
   raise lightness (toward the foreground); on **light** themes lower it (toward
   the foreground). Preserve the hue/saturation so the theme keeps its character
   — nudge lightness only, by the minimum needed to clear AA with a small margin.
3. Re-run `npm run check:themes` until it exits 0.

Keep the tier hierarchy intact: `muted` stays visibly dimmer than
`muted-foreground`, which stays dimmer than `foreground`. The calibrated values
target ~4.6:1 (a hair above AA) for the dimmest tier so the audit has rounding
headroom without over-brightening the design.

## High-contrast mode

`html[data-contrast="high"]` (Settings → Appearance) redefines
`muted-foreground` as a high fraction of `foreground` (75–80% alpha), which is
comfortably above AA by construction and is not part of the per-theme palette
audited above.
