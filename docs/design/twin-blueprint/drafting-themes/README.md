# Twin blueprint: drafting sheet theme versions (round 2 / WP-C)

The owner, verbatim: "One flaw of the blueprints are theming differences from personas, create three variants with current blueprint as baseline with subtle to major attempts to play with the theme and design to both styles cooperate more naturally together."

The diagnosis: the baseline sheet is a cyanotype slab. Studio's `drafting.css` mixes every colour with a fixed blue, so in a warm or pink theme it is a blue rectangle inside a non-blue app. It also ignores the app's card and glow surfaces, and its drafting lettering meets the app's figures without a hierarchy.

## The four, subtle to major

| Switcher label (id) | The idea |
|---|---|
| **Drafting sheet** (`drafting`) | The baseline, unchanged (WP-B's draw-in included). Kept in the switcher for comparison. |
| **Tinted sheet** (`draftingTint`), subtle | The same sheet, lettering and drawing, but the paper and ink are mixed from the active theme only, so a bronze app gets a sepia sheet and a pink app a rose one. The sheet's edge is a Personas card (card radius, primary border, elevation, the theme's glow), and the drawn border stays inside it like a mat. |
| **Inked page** (`draftingSurface`), moderate | No paper: the drawing is inked straight onto the app's content surface, and each region is a Personas card whose frame the pen traces before its fill lays in. Drafting stays only as accents (crop marks at each card's corners, the bio's dimension line, dashed pending frames, the hatch); labels use the app's eyebrows and titles, and the title block is a Personas strip. |
| **Native drafting** (`draftingNative`), major | The twin as a native Personas page: glowing gradient section cards named by the app's own twin slot icons, every state in the app's status roles, readiness as a ring with the twin status dots, and the twin's brand glyph as the identity mark on the title card. At rest it reads as a Personas page; while it draws, the same draw-in traces every card, inks every part and letters every word, and the bio's dimension line and the hatch remain as drafting signatures. |

## What changes, layer by layer

| | Drafting sheet | Tinted sheet | Inked page | Native drafting |
|---|---|---|---|---|
| Paper | Studio cyanotype (fixed blue anchor) | theme background tinted toward `--primary`; grid about half as loud; a faint primary glow top-left | none (the app's content surface) | none; a faint radial primary glow from the top |
| Ink | primary mixed with a fixed light or deep blue | `--primary` leaned toward `--foreground` | `--primary` leaned toward `--foreground` | `--primary` itself; states re-inked in status roles |
| Sheet edge / drawn border | drawn border 8px in | Personas card edge (radius, primary border, elevation, glow, inset 12px from the page); drawn border kept, rounded, 8px in | no sheet, no border | no sheet, no border |
| Region | dashed pencil outline, inked round to the share | same as baseline | card: traced frame, then the card fill (elevation 1); crop marks; ink runs round the card to the share | glowing gradient card (elevation 2 plus glow); in-progress ink in the primary glow, done in success with a success tick |
| Section mark and name | numbered balloon, drafting lettering | same as baseline | the name as `typo-title` | slot icon in a lit chip (`BookUser`, `MessagesSquare`, `Brain`, `GraduationCap`) and `typo-title`; the share as a lead figure |
| Labels | drafting lettering (mono, spaced capitals) | same as baseline | `typo-eyebrow`, muted foreground | `typo-eyebrow`, muted foreground |
| Title block | drafting title block, rotated readiness stamp | same as baseline | Personas strip: two cells under eyebrows, ruled divider, readiness in a lit level frame (pressed last) | identity card: the twin's brand glyph (traced), name, role; readiness as a ring inked to the score, figure pressed last |
| Readiness slots | inked squares | same | same | kit `Dot`s in the twin status roles (set success, partial warning, empty neutral hollow) |
| Knowledge on L1 | tallies | tallies | tallies | composition bar in the status roles (approved success, awaiting pending, rejected error) |
| Training | scale bars and gauges in ink | same | same | rounded meters; covered in success, awaiting in pending |
| L2 | the zoom grows out of the region | same | the detail on a card, under the section's own head | the detail on a glowing card, under the chip and the name; the tallies stay (the counting signature) |
| Stage | the overlay's base layer | same, without the page margin (the table already frames it) | cards around the open middle | glowing cards around the open middle; the brand mark steps out of a narrow title card |
| Pen | Studio's drafting pen | kept | kept | kept (the motion is where drafting survives) |

## Architecture: one renderer, a `theme`

`DraftingBlueprint` (`variants/drafting/index.tsx`) takes `theme: 'cyanotype' | 'tint' | 'surface' | 'native'`, puts it on its root as `data-drafting-theme` and in a context (`draftingTheme.ts`). The three switcher modules are one line each (`themes/tint.tsx`, `surface.tsx`, `native.tsx`), each importing its stylesheet. Colour and shape live in the stylesheets, scoped under `[data-drafting-theme]`. The context is read only where a theme changes structure:

- `BoxFrame.tsx`: a region-sized box's outline. It is the drafting frame on paper and a card off paper (frame, fill, and crop marks on the inked page).
- `SectionHead.tsx`: the section mark (balloon, none, or icon chip), the section name, and `TwinMark` (the brand glyph, traced).
- `Lettering.tsx` `Letter`: drafting lettering on paper, an eyebrow or a title off paper.
- `TitleCard.tsx`: the title block off paper (the strip, or the identity card with the readiness ring).
- `ReadinessSlots.tsx`: kit dots in the native version. `KnowledgeDrawing.tsx`: native L1 memories as the composition bar. `SheetBorder.tsx`: no border off paper.

The themed root does not carry Studio's `.drafting-root`, so none of the cyanotype's anchored values ever reach it. Studio's `drafting.css` is untouched.

**Keeping a pick is cheap.** The engine and the drawing components need no change; only the branches the pick does not take go:

- **Tinted sheet:** delete `themes/surface.*`, `themes/native.*`, `themes/paperless.css`, `TitleCard.tsx`, `BoxFrame`'s card branch, `SectionHead`'s chip and `TwinMark`, `Letter`'s eyebrow branch, the native branches of `ReadinessSlots` and `KnowledgeDrawing`.
- **Inked page:** delete `themes/tint.*`, `themes/native.*`, `SectionHead`'s chip and `TwinMark`, `TitleCard`'s ring, the native branches of `ReadinessSlots` and `KnowledgeDrawing`.
- **Native drafting:** delete `themes/tint.*`, `themes/surface.*`, `BoxFrame`'s crop marks and `TitleCard`'s level stamp.
- If the baseline goes too, `theme` collapses to the pick and `draftingTheme.ts` and its reads go with it.

## The draw-in, per version

WP-B's engine is untouched apart from one colour-free kind: `data-draw-wipe="fade"`, a surface laid in under its frame. The engine reads the rendered page, so every version gets the schedule from its own DOM:

- **Frames first, level by level.** On paper this is the border, the four regions and the title block, then what they frame. Off paper there is no border: a card's frame traces at depth n, its fill lays in at depth n+1 (as the inner frames trace), and the inked page's crop marks trace with the fill.
- **Then each container's content in reading order.** Inked page: name, share, then the ink round the card. Native: the chip's outline, its glow, the icon, the name, the share, the ink. The native title card traces the brand glyph's two profiles stroke by stroke.
- **Readiness pressed last** in all four (stamp, lit frame, or the ring's figure).
- L1 does not redraw when returning from a zoom (Director decision, kept). Reduced motion draws everything at once in all four.

`__tests__/drawSchedule.test.tsx` runs every schedule invariant for all four themes (3 fixtures x L1, every L2, and the stage). `__tests__/draftingThemes.test.tsx` pins each version's structure and its place in the schedule.

Measured in the page harness (Vite dev build, system Chrome, 1280x800, `twin/blueprint/detail-rich`, dark-midnight), planned length against the length measured from the `drawing` to the `done` state:

| Version | Planned | Measured | Parts / frames / letters | Long tasks while drawing |
|---|---|---|---|---|
| Drafting sheet (baseline, measured by WP-B) | 5490 ms | 5441 ms | 350 / 74 / 474 | none |
| Tinted sheet | 5490 ms | 5432 ms | 350 / 74 / 474 | none |
| Inked page | 5490 ms | 5433 ms | 361 / 97 / 470 | none |
| Native drafting | 4996 ms | 4943 ms | 302 / 67 / 470 | none |

The inked page has more frames (each card's fill and four crop marks). The native version is shorter because its layer-one memories are one composition bar instead of three rows of tally strokes; the frame waves are the same three.

## Theme-derived end to end (acceptance 2)

- **Stylesheet assertion** (`draftingThemes.test.tsx`): every declaration in `tint.css`, `paperless.css`, `surface.css` and `native.css`, stripped of `var(--*)`, numbers, and the colour and gradient functions, has nothing left that could name a colour. The check proves itself on a planted hex, a named colour and the cyanotype anchor. Each version's `--paper` and `--ink*` read only `--primary`, `--background`, `--foreground`, `--card-bg` and the status tokens. A render assertion confirms no `.drafting-root` anywhere in a version's tree.
- **Computed values in Chrome** (all 11 shipped themes, harness `twin/blueprint/detail-rich`): Chrome resolves `var()` inside a custom property but leaves `color-mix()` as text, so the colour literals left in the computed `--paper` / `--ink*` are exactly what they are made of. The baseline is flagged in 9 of the 11 themes (`#0b2447` and `#7fd3f7`, or `#1d4ed8` on light-news). It reads clean only on light and light-ice, where its fixed deep blue happens to equal the theme's own primary. All three versions name only their theme's own tokens in all 11 themes, and none of them defines `--drafting-blue`.

## Anti-shrink (acceptance 4)

Probed in the harness at 1280x800 for all four versions on `twin/detail`, `twin/stage-dealt`, `twin/stage` and every `twin/blueprint/*` surface. The probe looks for a visible part drawn outside its region, title block, notes box or zoom; a label cut by an ellipsis; and a clamped line that overflows. Result: no spill, no cut label, no overflowing clamp, in any version. Three fixes came out of the probe:

- The native section head is no taller than the baseline's (the share is a solid lead figure, and the chip is the balloon's size). Before that fix, Identity's language balloons sat 2px outside the card on the Detail page.
- The native title card's brand mark steps out of a narrow card (a container query; nothing shrinks), and the readiness ring sits beside its label. Before that fix, Training's goals overflowed by 22px in the overlay's wide, short layout.
- The tinted sheet pays for its page margin with tighter gutters inside the card, so layer one keeps the baseline's working widths, and it drops the margin in the overlay. Before that fix, the knowledge facts row wrapped out of its region, and the overlay with a delta note overflowed by 7px.

One finding is common to all four versions, the baseline included: the L2 header's lead figure sits 2px above the zoom's box (its line box). It is not visible.

## Review artifacts

| File | What it shows |
|---|---|
| `compare-dark-midnight.png`, `compare-dark-bronze.png`, `compare-dark-pink.png`, `compare-light.png` | One board per theme: the four versions side by side (subtle to major), rows L1, L2 Voice and the stage. |
| `<version>/detail-rich-<theme>.png` | L1, the rich twin (9 channels, full plan), 1280x800. |
| `<version>/detail-focus-<theme>.png` | L2, Voice zoom. |
| `<version>/stage-<theme>.png` | The stage with the reconciled delta played. |
| `<version>/integrated-detail-<theme>.png` | The real Detail page (`twin/detail`), dark-midnight and light. |
| `draw-in-tint.webm`, `draw-in-surface.webm`, `draw-in-native.webm` | Each version's L1 draw-in, rich twin, dark-midnight. |
| `draw-in-filmstrip-dark-midnight.png` | The four versions' draw-in at the same six moments (every animation seeked to the same time; the pen is hidden). |

`<version>` is `baseline`, `tint`, `surface` or `native`. Themes: dark-midnight, dark-bronze, dark-pink, light. Light shots use the harness's default brightness (the store default a fresh profile gets, 0.82 on light themes), which is why they look grey-washed; the same applies to every earlier light shot of this spark.
