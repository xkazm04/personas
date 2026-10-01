# Twin blueprint: Drafting sheet (WP7)

Metaphor: the twin drawn as a technical drawing on Studio's cyanotype sheet (`.drafting-root`). Four regions sit on the sheet like rooms on a plan, with a title block in the bottom-right corner. Each region is an inked drawing of its quantities, and its outline is inked clockwise as far as the section is drawn. Dashed means pending, solid ink means done, hatched means not measured.
- `detail-*`: L1, one-channel twin. Identity is the bio as a dimension line against its target plus language balloons. Voice is one 8-station elevation per channel, with sample ticks above a baseline and rule ticks below. Knowledge is tallies (approved inked, awaiting dashed, rejected crossed). Training is six topic scale bars, goal gauges and the kind-mix linings.
- `detail-empty-*`: a just-forged twin. Every part is dashed or hatched, never blank and never 0.
- `detail-rich-*`: nine channels and a full plan, the overflow test. Rows that do not fit move to L2 through container queries; nothing shrinks.
- `detail-focus-*`: L2 Voice, a drawing schedule (channels x the 8 dimensions, samples, rules, directives, origin symbols). `focus-identity|knowledge|training-*` show the other three zooms. Each zoom opens out of its region with a clip-path that grows to fill the sheet.
- `stage-*`: the training base layer, mid-beat with the reconciled delta. The middle is open paper the width of a card. The answered topic and goal are lit and re-inked, the pen sits beside them, a leader runs down the gutter to the notes, and the notes carry the gain and the model's why.
- `stage-working-*`: the engine working with no question. The open middle traces the plan in miniature (a CSS loop) while the pen tours the regions.
- `integrated-*`: the variant inside the real Detail page and the training overlay (WP6 shell), at 1280x800.
Sizes 1280x800 and 1920x1080, themes dark-midnight and light. Source: `src/features/plugins/twin/blueprint/variants/drafting/`.
