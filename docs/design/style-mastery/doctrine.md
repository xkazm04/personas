# Style doctrine

Spark `style-unification`. The vocabulary the app's type and colour speak, drawn
from the three surfaces the operator rated good: Events (one size in a row,
hierarchy by weight), the Manifest (a hairline under the header, tracked uppercase
section heads, one muting) and the KPI scale `KT`. Written by WP1 as a proposal;
**decided at Gate 0 on 2026-09-24** and applied by WP4a (verdict below). The
specimen shows proposal and current side by side:

```
npx vite --port 1431 --strictPort
http://localhost:1431/docs/design/style-mastery/specimen/index.html
```

Shipped rules: `src/styles/typography.css`, the roles in `src/styles/globals.css`.
The proposal files (`*.proposed.css`, scoped under `[data-style-proposal]`) stay
for the specimen. Worklist: `migration-map.md`.

## 0. Gate 0 verdict (2026-09-24)

| # | item | verdict | landed |
|---|---|---|---|
| 1 | Colour leaves the tokens (titles stop reading cyan) | **REJECTED**: titles keep their primary tint | - |
| 2 | Section title one step larger (1.125 -> 1.25rem) | **KEPT**, and it keeps its tint | `af9f8d33a` |
| 3 | The 2,342 un-muted captions | **not touched**: muting stays as it is | - |
| 4 | `typo-card-label`'s glow goes; card-label and submodule-header retire | **REJECTED**: both stay, glow stays | - |
| 5 | Mono Cascadia Mono; sans names the system face, Inter removed | **KEPT** | `175bd169d` |
| 6 | Four roles, `role-human` pink | **KEPT** (bound, bridged, graded; unused until WP4b) | `6528f44d3` |
| 7 | `accentColor` becomes `tone` | WP4b | - |
| 8 | Small floor: label and code 0.85 -> 0.875rem | **KEPT** | `af9f8d33a` |
| 9 | One text-scale factor | **KEPT** | `af9f8d33a` |
| - | Phantoms mapped, inert `[&_x]:typo-*` variants deleted, `typo-eyebrow` defined | **KEPT** (eyebrow composites migrate per module) | `5e5cd9ca5` |
| - | Dead overrides deleted, tokens moved into `@layer components` | **KEPT** (D6 steps 1-2) | `937854f7d`, `266c05551` |

Sections below describe what was decided. Where a proposal was rejected it stays
visible, marked "considered, rejected at Gate 0".

## 1. Type roles

A token is a ROLE: what the text is for. Its value can change; its role cannot.

| token | role |
|---|---|
| `typo-hero` | The one greeting a page opens with. |
| `typo-heading-lg` | The title of a page or a modal. |
| `typo-section-title` | Divides a page into parts. |
| `typo-title-lg` | The name of the one thing a card or detail is about. |
| `typo-body-lg` | Lead prose that opens a surface. |
| `typo-heading` | Heads a card or panel: the size of its content, set apart by weight. |
| `typo-title` | The name of a thing in a row, a list or a form field. |
| `typo-body` | A sentence a user reads. |
| `typo-caption` | Everything secondary to the line above it: the one muting. |
| `typo-data` | A figure in a row, tabular so a column aligns. |
| `typo-data-lg` | The one figure a surface leads with. |
| `typo-label` | Names a thing in less than a line: a chip, a badge, a column head. |
| `typo-eyebrow` (new) | The tracked uppercase head of a section inside a surface. |
| `typo-code` | An identifier, path or value a user may copy. |

Also shipped and kept: `typo-submodule-header` (a tinted agent-submodule divider,
step 3) and `typo-card-label` (a card-grid label with a primary glow, step 0).
*Considered, rejected at Gate 0:* retiring them into `typo-section-title` and
`typo-title`. The phantom names were mapped to the table above (migration-map.md
section 2, commit `5e5cd9ca5`).

**One ramp, seven steps, nothing small.** 0.875 / 1 / 1.125 / 1.25 / 1.5 / 1.75 /
2.75rem at the Standard text scale. Nothing sits below step 0. A row is step 1
throughout: name, sentence, figure and secondary line are one size, and weight
and the one muting carry the hierarchy. A text scale multiplies every step by one
factor, so the ramp keeps its proportions at Small, Standard and Large.

**Hierarchy is size and weight.** Never opacity. If a line should matter more, it
moves up a token; if less, it becomes a caption. The tinted tokens (below) carry a
tint as part of their role; a new tint is not a way to add emphasis.

## 2. What a token owns

A token OWNS size, weight, line-height, tracking and font features. Most tokens
DECLINE colour: colour belongs to the component, written as a `text-*` class or a
role. Five tokens own a colour as part of their role and keep it (Gate 0):
`typo-title`, `typo-title-lg`, `typo-section-title`, `typo-submodule-header`
(primary tint; neutral or lighter tint in light themes) and `typo-card-label`
(foreground with a primary glow). *Considered, rejected at Gate 0:* stripping
colour from all tokens (198 sites would have changed colour).

`typo-caption` carries the muting colour as a default in `@layer base`, so a
status or role colour written beside it still wins (`typo-caption
text-status-error` reads red).

The tokens live in `@layer components` (since `266c05551`). Tailwind utilities
come later, so a utility beside a token APPLIES: `typo-body font-semibold` means
what it says, and a `text-*` beside a tinted title replaces its tint. Before the
move every such utility silently lost; the 2,777 dead ones were deleted first
(`937854f7d`) so the move changed nothing that rendered. That is a reason to write
fewer such pairs, not more: if a pair is common, it is a missing token.

`typo-section-title` stepped up to 1.25rem AND kept its tint. A divider that needs
a rule draws the Manifest hairline (`border-b border-primary/10`, `KT_RULE`).

## 3. One muting level (proposal; not applied)

Gate 0 left muting as it is: no muting form was rewritten, and `--ink-muted` /
`text-ink-muted` are not defined in the app. The proposal, kept for the module
gates: `--ink-muted` = foreground at 70%, the value `typo-caption` ships today. Contrast
7.97:1 on the default canvas, at least 6.11:1 on every theme's canvas and at least
6.58:1 on every theme's card (contrast.generated.json). It is carried by
`typo-caption`, and by `text-ink-muted` for anything that is not a caption (an
icon, a unit beside a figure).

Nothing else mutes. `text-foreground/N`, `text-foreground opacity-NN`,
`text-muted-foreground`, `text-muted` and `text-muted-dark` all map to this one
level or to full ink (migration-map.md section 3). Five forms at twenty opacities
become one.

## 4. Colour

**Status (kept).** `status-success`, `status-warning`, `status-error`,
`status-info`: how something went. They also name actions: the approve button is
success, the reject button is error; a state and the action that produces it share
a colour on purpose.

**Roles (new).** A colour named for what it means, bound per theme:

| role | means | replaces |
|---|---|---|
| `role-agent` | An agent made, proposed or is doing this. | violet, purple, fuchsia, indigo; `accentColor` violet / indigo |
| `role-human` | You made this, or it is waiting on you. | pink; the Manifest "you" tone; review-waiting markers |
| `role-external` | Something outside the app: a connector, a service, a webhook. | cyan, sky, teal on connector, cloud and API marks |
| `role-highlight` | Look here, with no further meaning: the theme's own hue. | `accentColor` cyan / blue as a generic accent; ContentTone primary / blue |

Why these four and no more: violet is the largest non-status hue in the tree
(1,638 uses) and it already means one thing (the agent). Cyan and sky mostly mark
connectors and external services. Pink is nearly free once rose maps to error.
Everything else a raw hue says today is a status. A fifth role must show at least
two distinct surfaces that need it (the D8 rule).

**One recipe per colour**, the shape status chips already use:
text `text-role-x`; chip `bg-role-x/10 text-role-x border border-role-x/30`; rule `border-role-x/30`.
The Tailwind bridge is `--color-role-x: var(--role-x)` in `@theme` (shipped;
`--color-ink-muted` is not, see section 3). `role-human` is pink, as proposed
(*considered, rejected:* the Manifest's amber, which collides with warning).
`npm run check:themes` grades all four roles on the canvas in every theme and
fails below 4.5:1.

**Contrast.** Every role clears 4.5:1 (AA body text) on the canvas, on its own 10%
chip and on the card, in all eleven themes: stricter than the 3.0:1 check-themes
applies to status. The lowest cell is 4.97:1 (highlight on its chip, light).
Computed by `specimen/contrast.mjs` with check-themes' own maths, which reproduces
88 of check-themes' printed ratios with 0 mismatches. In the monochrome themes
(dark-red, light-news) roles differ by lightness only, as their status colours do.

**Brightness.** Roles use the `-raw` pattern and every theme sets the raw value, so
the dark (1.25-1.50) and light (0.82-0.91) page filters are always compensated.

**Raw palette steps are not a vocabulary.** `text-amber-400` says a hue, not a
meaning, and does not follow the theme: globals.css keeps 232 light-theme repair
selectors for them. New code writes a status or a role.

## 5. Font (applied, `175bd169d`)

Name what ships. `--font-sans` begins with Inter and `--font-mono` with JetBrains
Mono, but neither is loaded (no `@font-face`, no bundled file; index.html only
preconnects to Google Fonts). On this Windows machine the DevTools protocol reports
Segoe UI for body text and Consolas for `typo-code`: the faces the good surfaces
were judged in. Shipped stacks: `system-ui, 'Segoe UI Variable Text', 'Segoe UI',
-apple-system, sans-serif` (renders Segoe UI, as before) and `'Cascadia Mono',
Consolas, 'Fira Code', ui-monospace, monospace` (Cascadia Mono ships with Windows 11
and has a clearer 0/O and l/1). No web-font dependency is added; *considered,
rejected:* bundling Inter.

## 6. Bespoke stylesheets: free layout, tokenised type and colour

A feature stylesheet (the Manifest's documentSurface.css, the curator blueprint,
the factory passport) keeps its composition, geometry and motion. Its font-size,
font-family and text or accent colour come from `var(--...)` or a `.typo-*` token.
SVG and illustration art is exempt by a named exclusion. The census counts literals
in `src/features/**/*.css` (WP2).

## 7. How it landed (D6, as decided at Gate 0)

1. Delete the dead overrides: 2,777 in 977 files, no visible change (`937854f7d`).
2. Move the tokens into `@layer components`: no visible change (`266c05551`).
3. Size system and section title +1 step (`af9f8d33a`).
4. Fonts (`175bd169d`).
5. Map phantoms, delete inert variants, define `typo-eyebrow` (`5e5cd9ca5`).
6. Accent roles: tokens, bridge, contrast gate (`6528f44d3`). Palette steps,
   `accentColor` and ContentTone move per module (WP4b onwards).

*Considered, rejected at Gate 0:* the recolour step (titles lose their tint).

## 8. Found while measuring (status after WP4a)

- check-themes prints `n/a` for every status colour of the default theme (and
  dark-cyan success/warning/error, dark-frost all four): `:root` sets
  `--status-success: var(--status-success-raw)` and the audit reads only literal
  hex. Fixed in `6528f44d3`: check-themes resolves one `var()` level, so the
  default theme is graded (status 7.0 to 11.6:1).
- Status colours are NOT brightness-compensated in the themes that set
  `--status-x` directly (bronze, purple, pink, red, matrix, cyan's info, all light
  themes): verified, dark-bronze computes `#66b06e` under `brightness(1.25)`.
- 27 size utilities beside a token are live, not dead: globals.css's text-scale
  rules for `.text-xs` / `.text-sm` / `.text-[Npx]` are unlayered and later.
- `typo-caption` at Large (xl) was smaller than `typo-body` (16.9px against 19.1px);
  fixed by the one factor (`af9f8d33a`).
- themeStore's swatch for Midnight says primary `#3b82f6`; the CSS primary is `#06b6d4`.
- `[&_h1]:typo-*` variants (14 strings) generate no CSS: typo-* are not utilities.
  Deleted in `5e5cd9ca5`.

## 9. What Gate 0 was asked (kept as asked; verdicts in section 0)

Each item had a recommendation. The operator's verdict is in section 0.

1. **Colour leaves the tokens.** Titles, section titles and headlines stop reading
   cyan (198 sites change). *Recommend: yes.* It is the root of the 101 dead colour
   overrides and of KT having to avoid `typo-title`.
2. **The section title grows one step (1.125 -> 1.25rem) to replace its tint.**
   *Recommend: yes*, with the Manifest hairline where a rule is wanted.
3. **The 2,342 un-muted captions** (`typo-caption text-foreground`). *Recommend:
   leave them in WP4* (no visual change) and let each module gate choose caption or
   body. The alternative, deleting `text-foreground`, mutes half the app's captions
   in one commit.
4. **`typo-card-label`'s glow goes.** *Recommend: yes*; decoration is not type, and
   it is 44 sites. The alternative is an opt-in effect class outside the tokens.
5. **Mono face: Cascadia Mono instead of Consolas.** *Recommend: yes* (sharper
   0/O, ships with Windows 11). Sans: keep the system face and drop the unloaded
   Inter name. The alternative, bundling Inter, adds an estimated 100 to 350 KB
   asset dependency.
6. **Four roles: agent, human, external, highlight.** *Recommend: yes.* Open
   sub-choice: `role-human` as pink (proposed, a hue no status uses) or as the
   Manifest's amber (collides with warning).
7. **`accentColor` becomes `tone`** with status and role names. *Recommend: yes.*
8. **The small floor.** Labels and code go 0.85 -> 0.875rem; nothing below.
   *Recommend: yes.* The raw `text-[Npx]` sizes (599) are WP2's census to ratchet.
9. **One text-scale factor instead of per-token overrides.** *Recommend: yes*;
   it fixes the Large caption anomaly and keeps body sizes identical at every scale.
