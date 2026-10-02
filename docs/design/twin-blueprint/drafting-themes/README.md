# Twin blueprint: three levels of Personas absorbing the blueprint (round 3 / WP-D)

The owner rejected round 2's direction (its three versions moved away from the blueprint: the subtle one dropped the cyanotype blue, the others dropped the paper and became plain cards) and asked, verbatim:

> "I really need to prototype 3 variants inside the app combining the two layers: 1. blueprint with strong background patterns and blue color 2. personas with more clear design, color per theme...I need to see there 3 levels of personas absorbing the blueprint, one very subtle up to Personas theming eating the blueprint making it its own"

So in every level the blueprint is a strong, kept layer (the paper with its 80/16 px grid, the double sheet frame, the hatches, the dimension lines, the balloons or chips, the draw-in), and Personas takes over more of it at each step. The baseline drafting sheet stays in the switcher as the reference.

## The four, in the switcher's order

| Switcher label (id) | What the blueprint keeps | What Personas takes |
|---|---|---|
| **Drafting sheet** (`drafting`) | Everything: Studio's cyanotype, unchanged (WP-B's draw-in included). | Nothing; the reference. |
| **Personas touch** (`draftingTint`), level 1 | The cyanotype intact: the same blue paper and pale ink in every theme, the grid, every drafting pattern at full strength and the drafting lettering on every label. | Only a touch: the sheet sits on a Personas card edge (radius, elevation, a primary hairline), the figures are the app's, and the theme's primary is the accent ink of live things (the ink a section has run round its frame, the done tick, the readiness stamp, the region under the pointer, the mark the last answer landed on, the pen). A Bronze user sees a blue blueprint with copper accents. |
| **Half and half** (`draftingSurface`), level 2 | Its patterns at full strength (grid, sheet frame, balloons, lettering on labels, hatches, dimension lines) drawn on top of the cards, and its blue in the paper and the ink. | Half of every colour: paper and ink are a color-mix of the cyanotype and the theme, and every region and the title block is a Personas glass card laid on the paper (theme hairline, gradient, elevation, glow on hover and on the mark an answer landed on), with the app's titles for section names. Construction lines run on past each card's corners. |
| **Personas blueprint** (`draftingNative`), level 3 | Every pattern at full presence: the grid, the double sheet frame, the hatches, the dimension lines, the construction lines and the whole draw-in. It still reads as a blueprint drawing itself. | All the colour and the type: no foreign blue, the grid a texture of the theme's background in its primary, the regions glowing Personas cards named by their icons, the title block the twin's identity card with a readiness ring, the labels the app's eyebrows and every state in the app's status roles. Midnight draws a cyan-blue blueprint, Bronze a copper one, Pink a rose one, a light theme ink on paper in its own hue. |

Labels were shortened to fit the switcher (each under 22 characters): the brief's "Blueprint, Personas touch" and "Blueprint meets Personas" became "Personas touch" and "Half and half".

## Layer by layer

| | Drafting sheet | Personas touch | Half and half | Personas blueprint |
|---|---|---|---|---|
| Paper | Studio cyanotype (its anchor mixed with the theme) | the cyanotype paper, fixed in every theme | cyanotype and theme paper mixed in oklab (about 3:1 toward the blue in dark themes, even in light themes) | the theme background tinted toward its primary, plus the theme's radial glow |
| Grid (80/16 px) | ink at 14% / 7% | cyanotype ink at 17% / 8% | blended ink at 16% / 8% | primary at 18% / 8% |
| Ink | primary mixed with a fixed light or deep blue | the cyanotype's pale ink | cyanotype ink and theme ink, half each | the primary; states re-inked in the status roles |
| Sheet edge | none (drawn border 8px in) | Personas card edge (radius, hairline, elevation, glow), drawn border kept inside it | same, glow in the theme | same, stronger elevation and glow |
| Regions | dashed pencil frame, inked round to the share | same | glass card on the paper (traced frame, then the fill); construction lines past the corners | glowing gradient card; construction lines past the corners |
| Section mark and name | balloon, lettering | balloon, lettering | balloon, `typo-title` | icon chip, `typo-title`, the share as a lead figure |
| Labels | drafting lettering | drafting lettering | drafting lettering | `typo-eyebrow` |
| Title block | drafting title block, tilted stamp | same, stamp in the accent | card: lettered cells, stamp in a lit frame | identity card: brand glyph, readiness ring |
| Live accent | ink | the theme's primary | the theme's primary (glow, titles, card lines) | everything is the theme |
| Text on the sheet | theme foreground | the sheet's ink (the foreground tokens are rebound, so a light theme still reads on blue paper) | theme foreground on the cards | theme foreground |

## Architecture: one renderer, a `theme`

Unchanged from round 2: `DraftingBlueprint` (`variants/drafting/index.tsx`) takes `theme: 'cyanotype' | 'tint' | 'surface' | 'native'`, puts it on its root as `data-drafting-theme` and in a context (`draftingTheme.ts`). The three switcher modules are one line each (`themes/tint.tsx`, `surface.tsx`, `native.tsx`). Colour and shape live in the stylesheets:

- `themes/sheet.css` (all three levels): the sheet on its card edge, the 80/16 px grid drawn from the level's `--grid-major` / `--grid-fine`, the rounded drawn border, the region-card mechanics, and the gutters that pay for the card edge's margin.
- `themes/cyanotype.css` (levels 1 and 2 only): `--twd-cyanotype`, the one blue anchor, and its paper and inks mixed with black and white.
- `themes/tint.css`, `surface.css`, `native.css`: each level's paper, ink, grid, edge and card colours.

The context is read only where a level changes structure: `hasCards` (levels 2 and 3: `BoxFrame` makes a card with construction lines, `TwinTitleBlock` hands over to `TitleCard`), `appHeadings` (levels 2 and 3: `SectionName` is a title), `appLabels` (level 3: `Letter` is an eyebrow), and the level-3 branches of `SectionMark`, `TitleCard`, `ReadinessSlots`, `KnowledgeDrawing` and the region's share. `SheetBorder` no longer reads the theme: every level keeps the sheet. Round 2's paperless stylesheet, its crop marks and `isPaperless` are gone. The themed root does not carry Studio's `.drafting-root`; Studio's `drafting.css` is untouched.

**The cyanotype anchor.** The brief asked for the blue to be derived from an existing token if one exists. None does: the status `-raw` tokens are re-synced to each theme's status colours at runtime (`themeStore.applyBrightness`; Bronze's info colour is a gold, so a first attempt drew a brown "blueprint"), and Tailwind's palette variables exist only while some utility uses them (census `raw-palette-text-colour` is retiring those uses). So `cyanotype.css` declares exactly one hex anchor (`--twd-cyanotype: #3b74c4`) and everything else is `color-mix()` over it. It is the one `feature-css-type-literal` match these stylesheets add.

**Keeping a pick.** Keeping level 1 deletes `themes/surface.*`, `themes/native.*`, `TitleCard.tsx`, the card branch of `BoxFrame` and the level-3 branches. Keeping level 2 deletes `themes/tint.*`, `themes/native.*` and the level-3 branches (chip, `TwinMark`, ring, dots, composition bar). Keeping level 3 deletes `themes/tint.*`, `themes/surface.*`, `cyanotype.css` and `TitleCard`'s stamp.

## The draw-in, per level

WP-B's engine is untouched; each level gets its schedule from its own DOM (frames by depth, then each container's content in reading order, readiness pressed last, L1 not redrawn back from a zoom, reduced motion instant). Levels 2 and 3 now keep the sheet border, so six frames stand at depth 0 in all three (the border, four regions, the title block); a card's fill and its four construction-line pairs trace at depth 1.

Measured in the page harness (Vite dev build, system Chrome, 1280x800, `twin/blueprint/detail-rich`), planned against measured from `drawing` to `done`:

| Level | Theme | Planned | Measured | Parts / frames / letters | Long tasks while drawing |
|---|---|---|---|---|---|
| Personas touch | dark-midnight | 5490 ms | 5433 ms | 350 / 74 / 474 | none |
| Half and half | dark-midnight | 5490 ms | 5436 ms | 374 / 98 / 474 | none |
| Personas blueprint | dark-midnight | 4996 ms | 4934 ms | 323 / 88 / 470 | none |
| Personas blueprint | dark-bronze | 4996 ms | 4924 ms | 323 / 88 / 470 | none |

Level 3 is shorter because its layer-one memories are one composition bar instead of three rows of tally strokes.

## Tests

- `__tests__/drawSchedule.test.tsx`: every schedule invariant for all four themes (3 fixtures x L1, every L2, the stage).
- `__tests__/draftingThemes.test.tsx`: each id renders its level in L1, every L2 and the stage; the structure each level changes and where it lands in the draw-in; the real stylesheets injected into jsdom and read back from the rendered root, in a dark and a light theme: the 80/16 px grid and the sheet border are present in all three, levels 1 and 2 carry `--twd-cyanotype` (level 1's paper and ink are the cyanotype alone, level 2's mix the cyanotype with the theme), level 3 carries none and its paper and ink read the primary. A text check pins that the five stylesheets name no colour except the one anchor, and that `native.css` never reads the cyanotype.

## Anti-shrink

Probed in the harness at 1280x800 for all three levels on `twin/detail`, `twin/stage`, `twin/stage-dealt` and every `twin/blueprint/*` surface (a visible part outside its box, a label cut by an ellipsis, a clamped line that overflows): none. One fix came out of it: the title card used its own cell layout, which wrapped the role onto a second line and pushed Identity's languages 5 to 6px out of their region on the integrated Detail page; it now uses the paper title block's cell layout (label over the figure and the slots). The L2 header's lead figure still sits 2px above the zoom's box (its line box) in all four, the baseline included, as in round 2; it is not visible.

## Review artifacts

| File | What it shows |
|---|---|
| `compare-dark-midnight.png`, `compare-dark-bronze.png`, `compare-dark-pink.png`, `compare-light.png` | One board per theme: baseline, level 1, level 2, level 3 side by side; rows L1, L2 Voice and the stage. |
| `<level>/detail-rich-<theme>.png` | L1, the rich twin, 1280x800. |
| `<level>/detail-focus-<theme>.png` | L2, Voice zoom. |
| `<level>/stage-<theme>.png` | The stage with the reconciled delta played. |
| `<level>/integrated-detail-<theme>.png` | The real Detail page (`twin/detail`), dark-midnight and light. |
| `draw-in-level-1-touch.webm`, `draw-in-level-2-half.webm`, `draw-in-level-3-personas.webm` | Each level's L1 draw-in, rich twin, dark-midnight. |
| `draw-in-level-3-personas-dark-bronze.webm` | Level 3 in dark-bronze: the copper blueprint drawing itself. |

`<level>` is `baseline`, `level-1-touch`, `level-2-half` or `level-3-personas`. Themes: dark-midnight, dark-bronze, dark-pink, light. The harness's dark-midnight draws with the app's default cyan primary. Light shots use the harness's default brightness (0.82 on light themes), which is why they look grey-washed. The integrated shots' variant switcher still shows round 2's labels: the harness reads the split section locales, which are regenerated with the 13 translations at the Director's i18n step.
