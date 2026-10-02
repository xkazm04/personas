# Twin blueprint: "Personas blueprint" (`drafting`)

Spark `twin-portable-blueprint`, round 4 (2026-10-02). The owner kept round 3's level 3 ("very nice, keep Personas blueprint variant, remove Half and Half, Personas Touch, Drafting sheet"). It is now the only look of the `drafting` variant. The switcher offers two: **Personas blueprint** (`drafting`, the default) and **Strata** (parked for a possible use in another module).

The look: the twin drawn as a technical drawing that Personas has made its own. There is no foreign blue. The paper is the theme's background tinted toward its primary, with the 80/16 px drafting grid as a texture of it. The double sheet frame, the hatches, the dimension lines and the construction lines past each card's corners are in the primary. The regions are glowing Personas cards, each named by its icon in a lit chip. The title block is the twin's identity card, with the traced brand glyph and a readiness ring. Labels are the app's eyebrows, figures use the app's type ramp, and every state uses the app's status roles. Midnight draws a blue blueprint, Bronze a copper one, Pink a rose one, and a light theme draws ink on paper in its own hue. The sheet still draws itself in like a blueprint: frames by depth, then each container's content in reading order, with readiness pressed last.

## Code

- `variants/drafting/index.tsx`: the renderer. It has no theme prop and no theme context.
- `variants/drafting/sheet.css`: paper, ink, grid, sheet edge, cards, chips and status re-inks. It has no colour literal: every value is a token or a `color-mix()` over tokens.
- `variants/drafting/twinDrafting.css`: hatches, linings, the stage layout, the zoom and the container queries that move rows to layer two.
- `variants/drafting/draw/`: the draw-in engine, unchanged.
- Studio's `drafting.css` is still imported, only for its live hatch loop (`.drafting-hatch`, the delta note).

## Review artifacts

All files come from the page harness (Vite dev build, system Chrome).

| File | What it shows |
|---|---|
| `<state>-<size>-<theme>.png` | The six fixture states: `detail` (L1, one channel), `detail-empty` (L1, a just-forged twin), `detail-rich` (L1, nine channels and a full plan), `detail-focus` (L2, Voice), `stage` (the reconciled delta played), `stage-working` (the empty twin while the engine works). Sizes `1280x800` and `1920x1080`, themes `dark-midnight` and `light`. |
| `integrated-detail-1280x800-<theme>.png` | The real Twin Detail page (`twin/detail`, synthetic tape). |
| `integrated-stage-1280x800-<theme>.png` | The training overlay over it (`twin/stage`), after the answer is played. |
| `draw-in-detail-rich-dark-midnight.webm` | The L1 draw-in, rich twin, dark-midnight. |
| `draw-in-detail-rich-dark-bronze.webm` | The same in dark-bronze: the copper blueprint drawing itself. |
| `draw-in-filmstrip-dark-midnight.png` | The L1 draw-in at 0.3, 0.7, 1.3, 2.2, 3.4 and 6.0 s (planned 5.0 s: 323 parts, 88 frames, 3 depths, 470 letters; the pen is hidden). |

The two videos are round 3's level-3 recordings, moved here. Round 4 left the draw-in schedule unchanged: the schedule written on the DOM (every part's kind, moment, length and depth) is identical before and after the collapse for `detail-rich`, `detail-focus`, `stage` and `detail-empty`.

Comparison with round 3: every fixture still was shot before the collapse (`?kit=draftingNative`) and after it (`?kit=drafting`) at the same sizes and themes, then diffed pixel by pixel. 17 of 24 are identical. Three (`detail-rich` light at 1280, and both themes at 1920) differ in 9 to 19 pixels with a maximum channel delta of 2. That is anti-aliasing noise; round 3's own committed still differs from a re-shoot of itself in the same 16 pixels. The four `stage-working` stills differ only where the pen stands (about 23x39 px): the pen moves under script control, so its position at the moment of the shot varies. The before shots themselves match round 3's committed `level-3-personas` stills (L2 and stage pixel-identical, L1 within a channel delta of 4).

The integrated Detail page is laid out differently from round 3, and the look itself has not changed. With two options instead of five, the switcher fits on the header's line, so the blueprint is about 45 px taller and Knowledge shows its facts row.

Light shots use the harness's default brightness (0.82 on light themes), which makes them look grey-washed. The integrated shots' switcher still reads "Drafting sheet": the harness reads the split section locales, which the Director regenerates with the translations.

Anti-shrink, probed on every shot (a visible part outside its box, a label cut by an ellipsis, a clamped line that overflows): nothing on any surface. One exception, unchanged since round 2: in L2, the header's lead figure sits 2 px above the zoom's box (its line box), which is not visible.

Re-shoot a still:

```
node scripts/style/shoot.mjs --module twin/blueprint/detail-rich --tape synthetic --kit drafting --sizes 1280x800,1920x1080 --themes dark-midnight,light --out docs/design/twin-blueprint/drafting --label detail-rich
node scripts/style/shoot.mjs --module twin/detail --tape synthetic --sizes 1280x800 --themes dark-midnight,light --out docs/design/twin-blueprint/drafting --label integrated-detail
```

## Tests

- `__tests__/draftingSheet.test.tsx`: renders on its own paper in L1, every L2 and the stage, with no theme attribute. Every region, the title block, the zoom and the notes are cards: frame at depth 0, then fill and construction lines at depth 1. It also covers app titles and eyebrows, icon chips, the traced brand glyph, the readiness ring pressed last, slots as kit status dots, and the layer-one composition bar (the zoom keeps the tallies). The real stylesheet is injected into jsdom for a dark and a light theme: the 80/16 px grid and the sheet border are present, and paper and ink read the primary. A text check shows that `sheet.css`, `twinDrafting.css` and `draw/draw.css` name no colour at all, with a planted-literal self-check.
- `__tests__/drawSchedule.test.tsx`: the draw-in schedule's invariants for 3 fixtures x L1, every L2 and the stage, the nesting, reading order, reduced motion, a zoom pressed mid-draw, and stage deltas.
- `__tests__/blueprintVariant.test.ts` (one level up): the two ids, and the fallback to `drafting` for a stored retired id (`draftingTint`, `draftingSurface`, `draftingNative`, `dossier`, `radial`) or an unknown one.
