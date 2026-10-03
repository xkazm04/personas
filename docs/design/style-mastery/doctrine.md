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
| 7 | `accentColor` becomes `tone` | **KEPT**: Button's accent variant takes a closed `tone` (4 status + 4 role names); 145 sites migrated | `115151627` |
| 8 | Small floor: label and code 0.85 -> 0.875rem | **KEPT** | `af9f8d33a` |
| 9 | One text-scale factor | **KEPT** | `af9f8d33a` |
| - | Phantoms mapped, inert `[&_x]:typo-*` variants deleted, `typo-eyebrow` defined | **KEPT** (eyebrow composites migrate per module) | `5e5cd9ca5` |
| - | Dead overrides deleted, tokens moved into `@layer components` | **KEPT** (D6 steps 1-2) | `937854f7d`, `266c05551` |
| - | Gate 1: highlight's hue shifts off status-info; roles graded against every status and role | **KEPT** (WP4c) | `7103b5c27`, `658e6196c` |
| K | Composition kit: A/3 Spine & Lens over A/1 Ledger, judged on Fleet Activity | **KEPT**: `shared/components/kit/`, section 6b | `26c19f6a5`, `9acfd7aea` |

Sections below describe what was decided. Where a proposal was rejected it stays
visible, marked "considered, rejected at Gate 0".

## 0b. How a module is revitalized (learned at Gates 0 and 1)

Gate 1's first pass on `home/sub_releases` was judged a **degradation**: flat card
surfaces replaced subtle gradients, a status label was restyled instead of removed,
and the in-progress rail went from the theme's primary glow to `status-info`. The
rework that reversed those three passed (`b9e540e62`). Together with Gate 0 keeping
the title tint and the card-label glow, the rule for every module is:

1. **The theme's primary tint and glow are identity, not decoration.** Where the old
   colour was the theme's own hue (cyan is `primary` in the default dark theme),
   keep it as `primary`, glow included. A status or role colour replaces a colour
   only when the old one was a raw palette step with no theme link AND the meaning
   is a status or role.
2. **Unification fixes what is broken, not what reads well.** Raw sizes, raw palette
   steps, below-floor text, hand-rolled controls and phantom tokens convert. A
   gradient surface, a mono tracked micro-head or a glow that carries the module's
   character stays, written over theme variables so light themes get it too.
3. **Remove redundancy instead of restyling it.** A label that repeats what position,
   colour or an icon already says goes.
4. **Light theme parity is judged on its own.** Every colour goes through a theme
   variable or token; a light theme that looked unstyled before is a real win.
5. **A kept look no token reproduces is a declared deviation** at the site:
   `// style-deviation: <why>`, naming the gate that kept it.
6. **Show the page the operator will look at.** Shots include one tall viewport
   (1440x3200) so the lower half of a surface is judged too.
7. **The headline of a module is what the surface visibly does, not its token
   count** (Gate 2). A pass that took `sub_triage` from divergence 7.27 to 0.59 was
   judged "almost non-existent"; the defects the operator saw were layout and data
   fit: a table body stretched to the viewport with the pager far below the rows,
   time cells wrapping, one cell cramming title, badge and a description that repeats
   the title. So every module starts by LOOKING at the integrated page for overflow,
   wrapping, dead space, crammed cells and redundant columns, and fixes those first,
   at the shared component when the defect lives there. Token conversion is the floor
   every module meets, never the deliverable. The unit of work is the surface the user
   sees, not the source directory.

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

## 3. One muting level (APPLIED 2026-10-03, at 80%)

> **Applied, by the owner's decision, and at a different number than proposed.**
> "Both tokens to 80%, app-wide" took `.typo-caption` and the kit's `--quiet`
> from 70% to 80%; "Finish it — one ladder, all three families" then brought
> `--muted-foreground` onto the same basis. It is now declared ONCE, in `:root`,
> as `color-mix(in srgb, var(--foreground) 80%, transparent)`, and the ten
> per-theme hexes are deleted — so **there is one muting level and three names
> for it**: `--muted-foreground`, `.typo-caption`, `--quiet`.
>
> The spread that was there before is the argument for having done it. Solved
> back into a fraction of each theme's own `--foreground`, the single named
> token `--muted-foreground` meant **64.8% to 85.6%** depending on the theme,
> and once caption went to a flat 80% the two names sat 1.12:1 apart on the
> default theme with their ordering **flipped** (muted-foreground was the
> stronger of the two in 6 of 11 themes before, in 1 of 11 after).
>
> Measured at 80%: **10.13:1 on the default canvas, at least 8.47:1 on every
> theme's canvas and at least 9.42:1 on every theme's card**
> (`contrast.generated.json`, regenerated). The figures below this box were the
> 70% ones and are superseded. `--ink-muted` / `text-ink-muted` are still not
> defined in the app; `--muted-foreground` is the name that carries the level
> for anything that is not a caption. The fourth family —
> `text-foreground/NN` in `.tsx` class strings, 1,797 sites across 719 files at
> 24 levels — is ratcheted by the census rule `off-ladder-ink-opacity` and its
> sweep is staged in `scripts/style/codemod-ink-ladder.mjs`; the mapping and the
> contrast behind each row are in `docs/development/contrast.md`.

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
fails below 4.5:1, and fails any role closer than deltaE 10 to a status or another
role (below).

**Distinct (Gate 1, WP4c).** A role must be distinguishable from every status and
every other role in every theme; `check:themes` enforces CIEDE2000 deltaE >= 10.
Contrast grades a colour against a surface, never against another colour, so
Gate 0 shipped light's highlight as `#1d4ed8`, the same hex as `status-info`
(deltaE 0.0): "Now" and "In Progress" read alike. The number: 10 is the top of
the "perceptible at a glance" band (2 to 10) in the Delta E scale most UI colour
work cites, set above the large-patch JND (about 2.3) because chips and text are
small marks, and the difference needed to tell small marks apart grows as they
shrink (Stone, Szafir & Setlur 2014). The pair the operator called "almost the
same blue" measures 0.0 declared and 8.2 in the rendered model below at the
default light tier: under 10 either way, and 8.2 did not read as two colours.
CIEDE2000 rather than OKLab distance because its thresholds are published.

- Before: 11 pairs under 10 in 7 themes (light and light-ice highlight/info 0.0,
  dark-matrix highlight/info 0.0, dark-purple agent/info 6.1, light-ice
  external/neutral 6.7, dark-cyan highlight/info 7.6, dark-bronze
  highlight/warning 8.7, dark-midnight external/highlight 9.3, dark-cyan
  external/info 9.1, dark-matrix highlight/success 3.1 and agent/success 9.8).
  After: every graded pair >= 11.0 (`7103b5c27`). Highlight stays in the
  teal/cyan family where that is its intent: light and light-ice `#036d7d`.
- Monochrome themes (dark-red, light-news) grade only pairs with a hue in them.
  Their statuses are greys that differ by lightness alone, and four grey roles
  cannot sit 10 from five grey statuses inside the lightness band that clears
  4.5:1 (about 40 L* on newsprint). The exemption is two-sided: a declared theme
  with no grey pair under the bar fails as stale.
- `node scripts/check-themes.mjs --matrix` prints all 286 distances;
  `--self-check` shows the seeded collisions the gate must catch on every run.

**Rendered is not declared.** Each brightness tier re-mixes a role from its
`-raw` value, but a status a theme sets as a literal (`--status-info: #b6a8f5`)
beats the tier block and is scaled by the page filter uncompensated (section 8).
So a pair can pass as declared and collapse on screen: dark-purple's agent at a
lighter lavender (`#ddcafb`) scores 11.0 declared and 2.0 rendered at the default tier.
check:themes prints the modelled rendered minimum per tier (informational, never
graded). After WP4c: 4 of 30 theme/tier cells under 10, lowest 9.4 (light-ice
mid tier, highlight/success); before: 21 of 30, lowest 0.0. Compensating the
literal statuses (a status-token change) closes the gap and would let the gate
grade the rendered colour.

**Contrast.** Every role clears 4.5:1 (AA body text) on the canvas, on its own 10%
chip and on the card, in all eleven themes: stricter than the 3.0:1 check-themes
applies to status. The lowest cell is 4.51:1 (highlight on its chip, light,
`#036d7d`; was 4.97:1 for `#1d4ed8`).
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

## 6b. Composition kit (Gate K, 2026-09-25)

The owner ran a contest for the building blocks one level above buttons, shortlisted
A/1 "Ledger" and A/3 "Spine & Lens", saw both ported onto Fleet Activity with real
data, and chose **Spine & Lens**. It lives in `@/features/shared/components/kit`
(catalogued under `kit` in `CATALOG.md`); its look is `kit/kit.css`, the contest
entry's own stylesheet, token-only. Fleet Activity is the reference page.

**The rule: a surface is composed from the kit. A local one-off composition that
duplicates a kit part (a hand-built section head, stat tile, key-value grid, chip
strip, filter bar or table row) is a finding**, fixed by composing the kit part,
or by extending the kit when the need is real and shared.

The idea in one paragraph: every part of a surface hangs from one vertical spine. A
section head is a node on it, a row's status is a Mark on it, a selected row lights
its segment in the theme's primary glow, a working (live) row glows. No card
backgrounds and no row hairlines: rows are fixed heights on an 8px grid with a faint
alternating band, and every name starts on one reading line (40px). One emphasised
name per row; figures and meta at regular weight. Quantities are drawn as countable
units of a stated quantum, coloured by who claims them. Bands are the background
stepped by its own lightness, so light themes keep them without per-theme code.

| Part | What it is for | API (one line) |
|---|---|---|
| `KitHost` | root of any kit surface: kit variables, the compact tier, the container the side pane measures | `<KitHost compact? testId?>` |
| `Surface` | a region whose parts hang from the spine; `dense` for tool surfaces | `<Surface dense?>` |
| `Split` | work area plus a sticky detail pane, shown only when the surface has room (container query) | `<Split main pane paneLabel paneRef?>` |
| `Drawer` | the same detail on a narrow surface; Esc closes | `<Drawer open onClose closeLabel label>` |
| `Section` | a titled part of a surface; level 1 or 2; owns empty and loading states | `<Section title eyebrow? count? meta? actions? level? state? empty?>` |
| `Crumbs` | the trail of levels above a drilled surface, in a Section's `eyebrow`; a crumb with `onPress` is a text button back up; a last crumb without one is `aria-current="page"`, so a surface whose title names the current level passes only the levels above (grow-1) | `<Crumbs label items={[{label, onPress?, testId?}]}>` |
| `ListRow` / `Rows` | a list of fixed-height rows (name, meta, mark, figures, time) with its ghost and empty band; with `onPress` the name is the row's one button, its hit area stretched over the row (trail controls stay pressable above it, focus ring on the row, a selected row is `aria-current`, height unchanged) (grow-2) | `<ListRow name meta? mark? figures? size? state? onPress? testId?>`, `<Rows count empty loading? pager? cap?>`; `cap` shows the first N rows and a "Show all N" control that expands in place and announces the count (grow-3) |
| `DataTable` | the same row family under column heads, with a pager under the last row; rows select; a column opts in to sorting (head is a button with `aria-sort`, absent values last, row id breaks ties) | `<DataTable cols rows label empty loading? pager? onRowClick? sort?/defaultSort? onSortChange? locale?>`, col `sortable: 'asc'\|'desc'`, col `width: '8rem'` (a CSS length through a colgroup; a table column, not a grid track), row `sort: {key: value}` |
| `StatStrip` | headline figures; a lone tile is a strip of one; `draw` shows the quantity | `<StatStrip tiles={[{label, value, unit?, draw?, note?}]} state?>` |
| `KeyValueGrid` | facts about one thing; a null value renders its `none` text, muted | `<KeyValueGrid items={[{k, v, draw?, none?}]} min?>` |
| `ChipRow` / `ChipView` | a set of named counts; a chip with `onPress` is a filter | `<ChipRow chips={[{id, label, count?, share?, onPress?}]} label emptyLabel>` |
| `Toolbar` | a surface filter bar: `Segmented`, `SearchField` (with `/`), `KitButton` | `<Toolbar label>...</Toolbar>` |
| `KitButton` | the kit's 32px button over the shared Button: real busy spinner; `disabled` is the Button's (native, out of the tab order) with an optional reason; `stopPropagation` for an action inside a selectable row or card (grow-1). `tone` is one closed set named for meaning: `default`, `quiet` (a secondary action), `primary` (the surface's one call to action: the theme's primary -> accent gradient, each stop keeping its hue and chroma with OKLCH lightness capped at 0.45 / 0.52 so the white ink holds 4.5:1 at both ends in every theme, plus the primary glow, over the shared Button's primary variant; owner, grow-2 gate: "Theme gradient"); `quiet` the boolean is a deprecated alias of `tone="quiet"`. `icon` sits before the label as its own flex item, hidden from the tree, so it never wraps; a busy spinner takes its place (grow-2) | `<KitButton onClick tone?=default\|quiet\|primary icon? loading? pressed? expanded? hint? label? disabled? disabledReason? stopPropagation?>` |
| `RangePicker` | a time window: preset segments plus an optional Custom segment that opens the caller's own date picking | `<RangePicker label presets={[{v, label}]} value onChange custom?={{label, active, render(close)}}>` |
| `ChartFrame` | a chart's plot area on the reading line, fixed height, with its ghost and empty band; `toneColor(tone)` colours its series | `<ChartFrame height label state? empty?>{chart}</ChartFrame>` |
| `UnitStrip` | a quantity as units of a fixed quantum; `apportion()` splits a total by claim; `legend` states the quantum when it is above one: what one unit stands for in the caller's noun ("5 runs"), nothing drawn (owner, grow-2 gate: "Hover only"): the strip becomes its own Hint, "1 unit = 5 runs" on hover and keyboard focus (a tab stop, above a pressable card's press), and the same sentence is its description; no `auto`, because only the caller knows the noun (grow-2) | `<UnitStrip segments={[{n, tone, glyph?}]} size rows? label legend?>` |
| `quantumFor` | the unit quantum: the smallest 1-2-5 step at or above `min` that keeps a strip at or under `maxUnits`; state it in the legend (grow-1) | `quantumFor(total, maxUnits = 60, min = 1) -> number` |
| `Mark` / `Dot` | status as Tone x Glyph, on the spine or inline | `<Mark tone glyph label>`, `<Dot tone glyph>` |
| `Hint` | the explanation on a mark, figure or unit strip: the shared Tooltip plus an always-present hidden description the trigger points at (`aria-describedby`); `focusable` only for a standalone trigger, never per mark in a row (grow-1) | `<Hint content focusable? placement?>{one element}</Hint>` |
| `ContextCard` / `ContextCards` | one peer as a tile when the peers are FEW (a level-2 group of at most 12): a band, not a box; the stepped band with a primary wash from a 2px rail, its Mark on the rail, selected lights the rail, live breathes. One layout whatever it carries: head (title, meta) at the top with actions at its top-right, figures pinned to the foot, so every figure line in a row aligns; ghost and dashed-empty states; a pressable card's title is its one button (grow-1). `art` is the head's decoration at the top-right: hidden from the tree, never catches a pointer (a press on it lands on the card), never on the foot; beside actions it sits to their left and the actions keep the corner; not drawn while loading (grow-2) | `<ContextCard title meta? figures? actions? art? mark? state? empty? onPress?>`, `<ContextCards label min?>` |
| `Tiles` / `Tile` | a dashboard (the Home Cockpit): a 12-column grid whose rows are CONTENT-SIZED (a row's tiles stretch to its tallest; nothing clips or scrolls inside a tile, the page scrolls), spans collapse by the grid's own width (1-3 become 6 under 1100px, all full under 720px), `cols={1}` stacks tiles for a chat column or an evidence well; a Tile is ContextCard's band on a rail (owner, grow-3 gate: "B Band": a grid of mixed tiles keeps card feel) and owns the chrome, the head (one emphasis: the title; count and meta regular; actions top-right), the body and a footer for the tile's actions, loading ghost rows, empty and error bands; no row span; a long list inside is `Rows cap`, whose pager sits on the tile's foot when the tile is stretched beside a taller one (grow-3) | `<Tiles label cols?>`, `<Tile span? title? count? meta? actions? footer? state? empty? error? ghostRows? testId?>` |
| `ContextOverview` / `ContextGroups` | the parent layer over MANY contexts: level 1 is one 56px row per group (worst state as the Mark, size, its contexts as units by state at one quantum for every row, fixed figure columns; one roving tab stop) under a search that reaches every context (at most `MATCH_CAP` = 50 matches mounted); a row opens level 2, a level-2 Section with Crumbs back up whose body is cards up to `CARD_LEVEL_MAX` = 12 and a DataTable past it (`contextLevel(n)`). One level mounted at a time: 320 contexts in 22 groups mount 22 rows (grow-1) | `<ContextOverview label rootLabel groups={[{id, name, meta?, count, mark, states, figures?, contexts}]} open onOpen query onQuery searchPlaceholder match renderGroup(g, level) renderMatches(matches, total) unitLabel legend? figureHeads? toolbar? loading? empty>` |

When to use which: a list the operator scans and picks from is a `DataTable` when
its figures line up in columns, `Rows` when each row is a name and a sentence. Facts
about the selection go in a `KeyValueGrid` inside a level-2 `Section` in the `Split`
pane (narrow: `Drawer`). Headline numbers are a `StatStrip` at the top; a count of
named things (tools, tags) is a `ChipRow`. State is a `Mark`, never a trailing
status word. Tone is closed (`primary`, the status names, the role names) and Glyph
is closed (`solid`, `soft`, `hollow`, `empty`, `live`): a state gets one Tone x Glyph
and keeps it on every surface.

Decided with the kit:
- **Stat label size follows the product's compact tier** (14.4px at the default
  scale), not the entry's 13.4px: the compact tier (`ec6ca0516`) puts
  `typo-card-label` on the row step and the kit does not override the type scale.
  `kit.css` declares no font size anywhere.
- **Busy controls use the product's spinner.** `KitButton` renders the shared
  `Button` in the kit's look; kit.css sets `--type-control` so its label is the
  label step, as in the entry.
- **Status tones take the brightness compensation** the app applies to every
  status colour (the entry's page had none), so a neutral mark is darker in the
  product than in the entry. That is the product's rule, not a kit deviation.
- **Cards are for a level where the count is small; a surface that can hold many entities
  gets a parent layer first** (owner, grow-1: "projects will have hundreds of contexts").
  `ContextOverview` is that layer for contexts: groups at level 1, one group at level 2, cards
  only up to 12. Measured on its 320-context specimen: level 1 mounts 507 DOM nodes (React
  first commit 23 ms) where a flat grid of the same contexts mounts 2,241 (74 ms).
- **ContextCard is the one tile, and it is a band** (kit grow-1). The owner kept card
  surfaces at Gate 1 and the Factory turned context cards into tables for lack of a kit
  card, so the kit gained one, drawn from the spine idea rather than a boxed surface: the
  row's stepped band and right-only radius, a 2px rail as the card's own spine. It is for
  peers that read as tiles; a list the operator scans stays `Rows` / `DataTable`.
- **Light themes step the band by a small fixed amount** (grow-3 gate: "Yes, lighten them").
  The lightness formula lands about 0.14 below a light background, so lists read as dark
  stripes and cards and tiles as grey slabs; on a light theme `--band-alt` is the background
  minus 0.035 OKLCH lightness instead (rows, tables, cards and tiles alike), still a
  perceptible rhythm. Dark themes keep the formula.
- Not carried from the entry: its Lens overlay (outline and count every part),
  its specimen page and SettingRow. Every composition root still carries
  `data-kit` / `data-kit-state`, so a Lens can be added without touching parts.

## 6c. What the kit does NOT govern: the figure (2026-10-03)

> **The kit governs STRUCTURE. It does not govern FIGURE.** Owner, after reviewing the
> System Check prototypes: *"prototypes following the kit then look terrible, locked by
> the kit limitations from visual creativity perspective, and the typography does not
> add. It seems we have critical gaps in kit design, and the way how we use it, I will
> need your help to get out from this situation so we can trust it."*

### What went wrong, measured

The kit was forged on **Fleet Activity**, a dense list page, and it is excellent at being
that. But section 6b's rule - *a local composition that duplicates a kit part is a
finding* - was read as *everything on a surface must be a kit part*. Counted 2026-10-03:
the kit exports about **30 parts, of which exactly TWO can draw anything**: `UnitStrip`
(rows of 7-12px squares) and `ChartFrame` (a frame *around* a chart something else
draws). There is no part for a figure, a diagram, an illustration, or any geometry.

So a builder who needed visual expression had **no legal move**: the kit could not draw
it, and hand-rolling it was a finding. The only compliant output was austere rows. That
is a defect in this doctrine, not in the builders. `strata` (the twin blueprint variant,
~1,778 lines of bespoke SVG and CSS) is the quality bar the owner names, and it was only
ever legal because it sits outside the kit's jurisdiction entirely.

### The split

- **The kit owns**: layout and the spine, rhythm and row height, density tiers, status
  vocabulary (Tone x Glyph), controls, lists and tables, facts, empty and loading states,
  chrome. Section 6b's rule stands **in full** for all of it.
- **The kit does NOT own**: a drawn figure. Geometry, illustration, diagram, isometric or
  spatial composition, bespoke SVG, a visualization whose whole point is its shape. A
  figure is **composed INTO a kit frame and is free inside it.**
- **Free does not mean lawless.** Inside the frame a figure still takes colour only
  through app tokens (`--primary`, `--status-*`, roles, `color-mix` over them), states
  type through `.typo-*` or `calc(var(--type-N) * var(--type-f))`, honours
  `prefers-reduced-motion`, and renders in every theme light and dark. Section 6's rule
  for bespoke stylesheets - free layout, tokenised type and colour - is exactly the right
  law for a figure, and it already existed.
- **A figure is NOT an excuse to re-draw chrome.** A hand-built section head beside a
  figure is still a finding. The exemption covers the drawing, not its furniture.

### How to tell them apart

Ask what would be lost if the thing were replaced by a labelled list of the same numbers.
**Nothing lost -> it is structure**, and it belongs to the kit. **The point is lost ->
it is a figure**, and the kit hosts it without dictating it.

### What the first builder under 6c found ambiguous (fed back the same day)

`Figure` and the System Check machine figure were built hours after this section landed, and the
builder reported three gaps. All three are closed here rather than left for the next person:

1. **A figure's controls and labels are the KIT's, not the figure's.** The line between "the
   drawing" and "its furniture" was not stated, and the builder hit it as a *census failure*: a
   raw `<button>` for a pressable part of the drawing is a finding in a feature directory and
   legal inside the kit. That pressure pushed the callout rail into `Figure` itself, which is the
   right outcome - but it arrived by gate accident, not by doctrine. **Stated now: the press
   target, the label rail, the legend and the selection state belong to the kit part that frames
   the figure. The drawing owns shape, ink and geometry, and nothing that takes a click or reads
   as text.**
2. **A figure's viewBox aspect is load-bearing and was unmentioned.** The first attempt used a
   120x100 viewBox inside a 1340x188 plot, stretching ~6:1, and every drawn support came out
   wider than tall - a bar chart, which is precisely the failure mode 6c exists to prevent.
   **Measure the plot the frame will actually give you, then choose the viewBox to match it.** A
   figure whose aspect fights its frame is not a figure; `preserveAspectRatio="none"` makes the
   mismatch silent.
3. **`compact` is now forbidden on showcase surfaces and nothing enforces it.** 13 surfaces still
   opt in. That is census-shaped (an attribute on a root, matched against the surface's kind) and
   is registered as the next ratchet rather than left to vigilance.

Two further traps the same build surfaced, worth carrying: `.k-fig` was ALREADY taken by
`ListRow`'s figures cell, so a new figure class silently inherited `display:inline-flex` and drew
at 0px wide - **grep the kit's stylesheet before minting a class name**. And an `<svg>` is a
replaced element: absolutely positioned with `width:auto` it takes its intrinsic width and ignores
`left`/`right`.

### Consequences adopted the same day

1. **`Figure`** joins the kit as the legal door: a framed region that hosts drawn content
   on the reading line, with the surface's own ghost and empty states, so a figure is
   composed-into rather than bolted-on.
2. **The expressive vocabulary is chosen the way the kit itself was** - by contest, on a
   real page, judged by the owner. A second contest covers what `UnitStrip` and
   `ChartFrame` cannot say.
3. **The compact tier is for dense tool lists ONLY.** Measured 2026-10-03 with
   `scripts/style/kit-type-probe/`: a compact kit host renders every row token **11.1% to
   12.5% smaller** than the same token outside the kit (at the default appearance setting
   `typo-body` is 13.20px in the app and **11.55px** in a compact host). **14 surfaces**
   had opted in, including System Check, the Home Cockpit and Athena's chat cards - most
   of them not dense tool lists. A showcase, diagnostic or reading surface must not be
   compact.
   The same probe refuted the other half of the owner's reading: kit tokens **do** track
   the appearance setting, identically to the rest of the app, across all five scales.
   The perception was right and the mechanism was not - which is the second time in one
   review, so **measure the rendered pixels before accepting a diagnosis.**

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
