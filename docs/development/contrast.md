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
cannot rot into a permanent licence. There are **four** today, all one defect
seen four times — `dark-red`'s `--primary` is itself 3.4:1 on its own canvas
(the informational `primary/bg` row above has always said so), and every
primary-tinted tier (`typo-title`, `typo-title-lg`, `typo-section-title`,
`typo-submodule-header`) inherits it. The fix is to move `dark-red`'s
`--primary-raw` in `globals.css`; `typography.css` cannot correct it.

Measured while wiring this up: the caption muting holds AA down to **`/65`** and
breaks at **`/60`** on the light themes — so the 70→80 change was safe, which
is now *verified* rather than assumed.

**What this half still cannot see:** a `text-foreground/NN` utility written in a
`.tsx` file appears in no stylesheet, so no CSS reader can find it (there are
~1,679 such sites across 18 levels, `/15`–`/95`; a separate workstream owns
them). What the gate *can* compute is the floor those sites must clear, and it
prints it every run: `--foreground` over `--background` holds AA down to
**`/50`** on the dark themes and **`/65`** on the light ones.

## The caption-opacity floor: `/80` minimum

Tailwind opacity modifiers (`text-muted-foreground/70`, `/60`, …) composite the
token toward the canvas, which **lowers** contrast. On the light themes
`muted-foreground` sits around 7:1, so `/70` lands near 3.5:1 — below AA.

The rule, enforced by the `muted-fg@80` row of the gate:

> **Opacity-tinted muted text must stay at `≥ /80`.** Captions, timestamps, and
> helper labels use `text-muted-foreground/80` at most — never `/70`, `/60`,
> `/50`, `/40`. If you need it dimmer, you need a different (lighter-weight)
> piece of information, not a less-legible one.

The tokens are calibrated so that **`/80` is exactly the AA floor** in all 13
themes (≈4.6:1 on the light themes, higher on dark). Anything at `/80` or above
is guaranteed AA; anything below is not.

### Migrating existing sub-`/80` usages

A handful of components still use `text-muted-foreground/{40,50,60,70}` (and the
matching `opacity-50/70` caption pattern). These are a known incremental cleanup
— bump them to `/80` (or drop the modifier) when you next touch the file, the
same fix-as-you-touch policy as the `custom/no-raw-*` design-token migration. The
token gate guarantees the *token* supports `/80`; the per-component bump is what
realises AA in the rendered caption.

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
