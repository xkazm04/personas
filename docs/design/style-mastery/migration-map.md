# Style migration map (WP4 worklist) - DRAFT for Gate 0

Spark `style-unification`, WP1. Old -> new for every type token, every phantom,
every muting form, `Button accentColor`, `ContentTone` and the top 20 raw palette
steps, each with a count and the command that produced it. Then the dry run of the
WP4 codemod and the sites where the ORDER of its steps matters.

Measured 2026-09-24 on `master` at `b95f2de4f`. Counts move under sibling sessions;
re-derive, do not cite.

**How the counts were made**

- `rg` rows: `rg -o -P --glob '*.{ts,tsx}' '<pattern>' src | wc -l`. They include
  comment lines and tests. `(?<![\w-])` and `(?![\w-])` stop `typo-body` matching
  inside `typo-body-lg`.
- Pair rows (a utility written beside a token): `node docs/design/style-mastery/specimen/measure.mjs`.
  Unit = one quoted string on one line, comment lines skipped: the unit the census
  rule `typo-token-overpainted` uses. A token and a utility in two different `cn()`
  arguments are not paired, so pair counts are LOWER BOUNDS.
- Dead, live and order-sensitive: `node docs/design/style-mastery/specimen/shoot.mjs --probe`
  renders every pair in Chromium against the real `globals.css` (default theme,
  Standard text scale, 16.5px root) and compares computed styles. Measured, not
  inferred from a regex. `node docs/design/style-mastery/specimen/report.mjs` prints
  the section 7 and 8 tables from its output.

## 1. Type tokens

`rg -o -P --glob '*.{ts,tsx}' '(?<![\w-])typo-X(?![\w-])' src | wc -l` (and `rg -l` for files)

| today | uses (files) | proposed | what changes |
|---|---|---|---|
| `typo-hero` | 13 (12) | `typo-hero` | nothing |
| `typo-heading-lg` | 104 (78) | `typo-heading-lg` | nothing |
| `typo-submodule-header` | 8 (7) | `typo-section-title` | tint removed; 1.25rem now scales with the text scale |
| `typo-section-title` | 78 (71) | `typo-section-title` | 1.125 -> 1.25rem; tint removed (dark 85% primary, light 80% foreground) |
| `typo-title-lg` | 38 (30) | `typo-title-lg` | tint removed; tracking 0.005em -> 0 |
| `typo-body-lg` | 173 (104) | `typo-body-lg` | nothing |
| `typo-heading` | 581 (336) | `typo-heading` | tracking 0.025 -> 0.01em |
| `typo-title` | 140 (112) | `typo-title` | tint removed; tracking 0.015 -> 0.01em |
| `typo-card-label` | 47 (41) | `typo-title` | 0.875rem unscaled -> 1rem scaled; glow text-shadow dropped (decision 4) |
| `typo-body` | 3,483 (1,101) | `typo-body` | nothing |
| `typo-caption` | 4,479 (1,255) | `typo-caption` | colour moves from `@layer base` into the token's layer; value unchanged (70%) |
| `typo-data` | 120 (92) | `typo-data` | nothing |
| `typo-data-lg` | 38 (30) | `typo-data-lg` | nothing |
| `typo-label` | 827 (406) | `typo-label` | 0.85 -> 0.875rem at Standard |
| `typo-code` | 615 (298) | `typo-code` | 0.85 -> 0.875rem; face Consolas -> Cascadia Mono (decision 5) |
| (none) | 361 class strings compose `typo-* uppercase tracking-*` | `typo-eyebrow` (NEW) | one class; the tracking stops being a dead utility |

The 361: every quoted string holding a `typo-*`, `uppercase` and a `tracking-*`
(typo-caption 168, typo-heading 59, typo-code 58, typo-label 40, typo-body 32, other 4).

Colour-owning tokens with NO colour class beside them change colour at the recolour
step, by design: typo-title 88, typo-section-title 48, typo-card-label 29,
typo-title-lg 25, typo-submodule-header 8 = **198 sites** (`measure.generated.json` -> `recolour`).

Text scale: every size becomes `calc(step * --type-f)` with one factor per scale
(compact 0.8125, default 0.875, Small 0.9375, Standard 1, Large 1.0625). Body-sized
text is unchanged at every scale. `typo-caption` at Large (xl) goes 0.9375rem ->
1.0625rem, fixing today's anomaly where a caption at Large is SMALLER than body
(16.9px against 19.1px).

## 2. Phantom names (defined nowhere, so they render as their surroundings)

| phantom | rg uses (files) | -> | why |
|---|---|---|---|
| `typo-body-sm` | 50 (14) | `typo-body` | there is no small body |
| `typo-overline` | 26 (14) | `typo-eyebrow` | the tracked uppercase head it imitates |
| `typo-heading-sm` | 15 (13) | `typo-heading` | card and modal heads |
| `typo-body-strong` | 6 (5) | `typo-title` | body size at 600 is the name role |
| `typo-heading-md` | 3 (3) | `typo-title-lg` | modal titles one step above a row |
| `typo-button` | 3 (1) | `typo-title` | and McpRequestPanel's three raw `<button>`s become `Button` |
| `typo-h3` | 4 (4) | `typo-heading-lg` | panel titles |
| `typo-title-sm` | 1 (1) | `typo-title` | |
| `typo-heading-xs` | 1 (1) | `typo-title` | an editable row head |
| `typo-display` | 1 (1) | `typo-data-lg` | a lead metric |
| `typo-data-md` | 1 (1) | `typo-data` | a figure in a row |

**Brief correction.** `typo-h3` was missing from the brief's list: 3 real sites
(FleetHarvestPanel.tsx:68, DecisionsPanel.tsx:55, HealingEffectivenessPanel.tsx:83)
plus one inert variant. `typo-h4` and `typo-h5` exist only inside arbitrary variants.
Measured 11 phantom names, as the brief said, but not the same 11.

**Inert arbitrary variants: 14 class strings.** `[&_h1]:typo-heading-lg`,
`[&_code]:typo-caption`, `[&_h2]:typo-h4`, ... generate NO CSS. typo-* are plain
classes, not Tailwind utilities, so a variant cannot apply them. Checked in the dev
server's compiled globals.css: for `_h1` only `font-semibold`, `mt-*` and
`text-foreground` exist. Site list: `measure.generated.json` ->
`arbitraryVariantTypoSites`. WP4: rewrite each to a class on the child, or leave
it inert and say so. The layer move does not wake them.

## 3. Muting forms -> ONE level (`--ink-muted`, foreground at 70%)

| today | count | -> |
|---|---|---|
| `typo-caption` (70% via `@layer base`) | 4,479 | unchanged: it IS the level |
| `text-foreground/N`, N <= 80 | 1,010 | `text-ink-muted` |
| `text-foreground/N`, N >= 85 | 844 | `text-foreground` (a 5-15% dimming is not a tier) |
| `text-foreground/[0.0x]` | 3 | review by hand |
| `text-foreground` + `opacity-NN` in one string | 336 strings (measure) | `text-ink-muted`, REVIEW: opacity also dims icons and children |
| `text-muted-foreground(/N)` | 255 | `text-ink-muted` |
| `text-muted` | 47 | `text-ink-muted` |
| `text-muted-dark` | 19 | `text-ink-muted` |

Patterns: `(?<![\w-])text-foreground/([1-7]\d|80|[0-9])(?![\d])`,
`(?<![\w-])text-foreground/(8[5-9]|9\d)(?![\d])`,
`(?<![\w-])text-muted-foreground(/\d+)?(?![\w-])`, `(?<![\w-])text-muted(?![\w-])`.

**The un-muted caption (decision 3).** `typo-caption text-foreground` is written
**2,342** times (measure pairs; 2,261 lines by rg). More than half of all captions
render at full ink, because the caption colour sits in a layer and the utility
beats it. Not a dead override; WP4 needs no change for it.

## 4. `Button accentColor` -> roles

`rg -o -P --glob '*.tsx' 'accentColor=' src | wc -l` = **158** sites. Literal values
(measure.mjs): violet 64, emerald 28, amber 24, rose 13, indigo 6, blue 4, sky 3,
cyan 3, orange 1. The rest are expressions.

| value | -> | meaning |
|---|---|---|
| violet, purple, indigo | `role-agent` | an action the agent performs (Generate, Optimise) |
| emerald, lime, teal | `status-success` | the committing action (Approve, Save, Run) |
| amber, orange | `status-warning` | |
| rose, pink, red | `status-error` | the refusing action (Reject, Stop) |
| blue, sky | `status-info` | |
| cyan | `role-highlight`, or `role-external` on a connector action | |

Proposed API: `accentColor` becomes `tone: 'agent' | 'human' | 'external' |
'highlight' | 'success' | 'warning' | 'error' | 'info'`.

## 5. `ContentTone` -> roles

9 JSX sites (measure: violet 1, amber 1, emerald 1, the rest expressions) plus
RichMarkdown's defaults (primary for cards, amber for pills). primary -> `highlight`,
blue -> `info`, amber -> `warning`, violet -> `agent`, emerald -> `success`,
red -> `error`, neutral stays. Keep the tinted-card recipe (fill /5, border /15,
ink): contentTones.ts records that a status-wash port "came out colourless", so a
role keeps the tint and only the NAME changes.

## 6. Top 20 raw palette steps

`rg -o --no-filename -P --glob '*.{ts,tsx}' '(?<![\w-])(text|bg|border)-(<hues>)-\d{2,3}(?![\w-])' src | sort | uniq -c | sort -rn | head -20`

Totals: text 4,647, bg 3,451, border 2,221 (src, .ts + .tsx), against
`text-status-*` 780. The brief's 4,110 / 2,975 are features-only .tsx (measured:
4,043 / 2,925). Keep the alpha modifier (`bg-amber-500/10` -> `bg-status-warning/10`).
A hue is not a meaning: the default below is the common case, and each module gate
reviews its files.

| step | count | default -> |
|---|---|---|
| text-amber-400 | 774 | text-status-warning |
| text-red-400 | 732 | text-status-error |
| text-emerald-400 | 725 | text-status-success |
| bg-amber-500 | 574 | bg-status-warning |
| bg-emerald-500 | 537 | bg-status-success |
| bg-red-500 | 502 | bg-status-error |
| bg-violet-500 | 457 | bg-role-agent |
| border-amber-500 | 423 | border-status-warning |
| text-violet-400 | 393 | text-role-agent |
| border-violet-500 | 357 | border-role-agent |
| border-emerald-500 | 345 | border-status-success |
| border-red-500 | 329 | border-status-error |
| text-blue-400 | 278 | text-status-info |
| bg-blue-500 | 219 | bg-status-info |
| text-violet-300 | 213 | text-role-agent |
| text-cyan-400 | 194 | text-role-external (review: a generic accent -> role-highlight) |
| text-amber-300 | 187 | text-status-warning |
| bg-cyan-500 | 151 | bg-role-external (review) |
| border-blue-500 | 143 | border-status-info |
| text-emerald-300 | 137 | text-status-success |

Why it pays beyond naming: raw steps do not follow the theme, so globals.css
repairs them for light themes with **232** component-level selectors such as
`[data-theme^="light"] .text-amber-400 { ... }`
(`grep -c '^\[data-theme^="light"\] \.\(text\|bg\|border\)-[a-z]*-[0-9]' src/styles/globals.css`).
A role is bound once per theme and needs none of them.

## 7. Dry run of the WP4 codemod

### 7a. Deletes: utilities beside a token that sets the same property

| family | pairs | sites | dead today (codemod deletes) | order-sensitive (visible if layered first) | live although the token sets it | token does not set it (live, kept) |
|---|---|---|---|---|---|---|
| colour | 451 | 8901 | 104 | 92 | 0 | 8797 |
| weight | 36 | 1635 | 1635 | 1532 | 0 | 0 |
| numeric | 12 | 500 | 97 | 0 | 0 | 403 |
| family | 11 | 403 | 236 | 0 | 0 | 167 |
| leading | 37 | 403 | 403 | 403 | 0 | 0 |
| tracking | 37 | 397 | 121 | 103 | 0 | 276 |
| size | 20 | 39 | 12 | 7 | 27 | 0 |
| **total** | 604 | 12278 | 2608 | 2137 | 27 | 9643 |

- **The codemod deletes 2,608 utility occurrences** (dead today), minus the 3 in 7c.
  They change nothing today; the probe proves it per pair.
- **27 size utilities are LIVE although the token sets size** (`typo-code text-[11px]`
  14 sites, ...). globals.css's text-scale rules for `.text-xs`, `.text-sm` and
  `.text-[7..15px]` are unlayered and come after typography.css, so they beat the
  token. The brief's "~38 raw sizes beside typo-*" are not all dead. WP4 must not
  delete these 27: they are what renders today.
- `numeric` (typo-data + tabular-nums) and `family` (typo-code + font-mono) are dead
  and also invisible when alive (same value). Safe either way.
- Census `typo-token-overpainted` counts 1,754 dead `font-*`; the probe's 1,635
  differs by unit extraction (a 120-char regex window against one quoted string).
  Same condition, two measurements.

### 7b. Rewrites (class changes with an intended visible effect)

| step | occurrences |
|---|---|
| retired tokens (`typo-submodule-header` 8, `typo-card-label` 47) | 55 |
| phantoms (section 2) | 111, plus 14 inert variants to review |
| eyebrow composites -> `typo-eyebrow` | 361 class strings |
| muting (section 3) | 2,175 rewrites + 339 reviewed |
| recolour (no class change; tokens decline colour) | 198 sites |
| `accentColor` -> `tone` | 158 |
| `ContentTone` names | 9 + markdown defaults |
| palette steps -> status / roles | 10,319 (text + bg + border), reviewed per module |

### 7c. Dead colour overrides whose intent is a hue (review, do not delete)

`typo-title text-amber-300`, `typo-card-label text-cyan-200`,
`typo-card-label text-violet-300`: 3 sites. They render tinted-primary today while
the author asked for a hue. Deleting keeps today's look and drops the intent; after
recolour the right class is the matching role or status. The other 101 dead colour
overrides are `text-foreground(/N)` or `text-primary`, which recolour makes true anyway.

## 8. The D6 order, and where it matters

1. **Delete dead overrides** (7a). Visible change: none, by construction.
2. **Move typography.css into `@layer components`.** Visible change: none IF step 1
   ran; otherwise the 2,137 order-sensitive sites below all change at once.
3. **Recolour** (tokens decline colour; caption keeps its default). Visible: the 198
   sites in section 1, nothing else.
4. **Map phantoms and retired tokens.** AFTER step 2: mapped onto a still-unlayered
   token, every utility beside a phantom (live today, because the phantom sets
   nothing) would go dead. After the layer move they stay live.
5. **Accent roles** (bridge, then palette / accentColor / ContentTone rewrites).

**Order-sensitive sites: 2,137** (dead today AND a different value once alive:
weight 1,532, leading 403, tracking 103, colour 92, size 7). All are listed per pair
in `specimen/pairs.generated.json`. The 25 with the largest visual effect; effect
is a ranking heuristic in rough px of change (size 1:1, weight 2 per 100, leading
0.5 per px, tracking 4 per px, colour 10 per unit of normalised RGB distance):

| # | site | written | renders today | after a layer move without the delete | effect |
|---|---|---|---|---|---|
| 1 | `src/features/settings/sub_devices/components/FingerprintCode.tsx:16` | `typo-heading-lg tracking-[0.35em]` | tracking -0.2475px | 8.6625px | 35.64 |
| 2 | `src/features/plugins/twin/sub_profiles/TwinHero.tsx:22` | `typo-section-title text-3xl` | size 18.5625px | 30.9375px | 12.38 |
| 3 | `src/features/overview/sub_observability/components/HealingIssuesPanel.tsx:104` | `typo-body font-black` | weight 400 | 900 | 10 |
| 4 | `src/features/plugins/twin/experience/opus/table/DealerCard.tsx:63` | `typo-label tracking-[0.18em]` | tracking 0.14025px | 2.5245px | 9.54 |
| 5 | `src/features/plugins/twin/experience/opus/table/LootCard.tsx:51` | `typo-label tracking-[0.18em]` | tracking 0.14025px | 2.5245px | 9.54 |
| 6 | `src/features/plugins/twin/experience/opus/table/PlayedPile.tsx:60` | `typo-label tracking-[0.18em]` | tracking 0.14025px | 2.5245px | 9.54 |
| 7 | `src/features/plugins/twin/experience/opus/table/SuitRail.tsx:33` | `typo-label tracking-[0.18em]` | tracking 0.14025px | 2.5245px | 9.54 |
| 8 | `src/features/plugins/twin/experience/opus/table/TopicRail.tsx:33` | `typo-label tracking-[0.18em]` | tracking 0.14025px | 2.5245px | 9.54 |
| 9 | `src/features/home/sub_releases/HomeReleases.tsx:69` | `typo-heading text-2xl` | size 16.5px | 24.75px | 8.25 |
| 10 | `src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx:477` | `typo-data text-2xl` | size 16.5px | 24.75px | 8.25 |
| 11 | `src/features/overview/sub_reports/components/ReportDetailSections.tsx:118` | `typo-heading-lg font-light` | weight 700 | 300 | 8 |
| 12 | `src/features/agents/components/PopupIconSelector.tsx:57` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 13 | `src/features/agents/components/PopupIconSelector.tsx:59` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 14 | `src/features/teams/sub_factory/passport/CoverBody.tsx:98` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 15 | `src/features/teams/sub_factory/passport/CoverBody.tsx:99` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 16 | `src/features/teams/sub_factory/passport/CoverRoadmap.tsx:100` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 17 | `src/features/teams/sub_teamWorkspace/presetStudio/PresetConnectionGraph.tsx:229` | `typo-body-lg leading-none` | leading 31.5562px | 18.5625px | 6.5 |
| 18 | `src/features/shared/glyph/GlyphCard.tsx:140` | `typo-heading tracking-[0.12em]` | tracking 0.4125px | 1.98px | 6.27 |
| 19 | `src/features/templates/sub_generated/adoption/chronology/ChronologyCommandHub.tsx:125` | `typo-heading tracking-[0.12em]` | tracking 0.4125px | 1.98px | 6.27 |
| 20 | `src/features/plugins/twin/sub_profiles/TwinHero.tsx:22` | `typo-section-title text-2xl` | size 18.5625px | 24.75px | 6.19 |
| 21 | `src/App.tsx:480` | `typo-caption font-bold` | weight 400 | 700 | 6 |
| 22 | `src/features/overview/sub_leaderboard/components/LeaderboardMatrixView.tsx:190` | `typo-caption font-bold` | weight 400 | 700 | 6 |
| 23 | `src/features/shared/chrome/sidebar/sections/PluginsSidebarNav.tsx:132` | `typo-caption font-bold` | weight 400 | 700 | 6 |
| 24 | `src/features/shared/chrome/sidebar/sections/PluginsSidebarNav.tsx:166` | `typo-caption font-bold` | weight 400 | 700 | 6 |
| 25 | `src/features/teams/sub_factory/passport/passportWidgets.tsx:83` | `typo-caption font-bold` | weight 400 | 700 | 6 |

The largest classes of order-sensitive site by count: `typo-body font-medium` 656
(400 -> 500), `typo-caption font-medium` 410, `typo-body leading-relaxed` 141,
`typo-heading font-semibold` 138 (700 -> 600), `typo-caption font-semibold` 83,
`typo-heading tracking-wider` 43. These are the ones a wrong order would make the
whole app visibly heavier in one commit.
