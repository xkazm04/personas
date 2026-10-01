# Twin blueprint: Drafting sheet (WP7, round 2 draw-in)

The twin is drawn as a technical drawing on Studio's cyanotype sheet (`.drafting-root`). Four regions sit on the sheet like rooms on a plan, with a title block in the bottom-right corner. Each region is an inked drawing of its quantities, and its outline is inked clockwise as far as the section is drawn. Dashed means pending, solid ink means done, hatched means not measured.

## The draw-in (round 2)

Every sheet draws itself in the way a draughtsman would. The engine lives in `src/features/plugins/twin/blueprint/variants/drafting/draw/`, and its schedule tree is written at the top of `DrawSheet.tsx`.
1. **Frames first, level by level, all in parallel.** Depth 0 traces first: the sheet border, the four region outlines and the title block (plus the notes box on the stage). Depth 1 traces only once depth 0 has finished: each channel's elevation box and tick baseline, the topic tracks, the goal gauges, the language balloons, the tally gate rules, the bio scale and extension lines, the title block cells. Depth 2 comes next: the tier marks in each track and the readiness slots in their cell. Every frame is a stroke (`pathLength` 100 and `stroke-dashoffset`). Dashed frames are revealed through a solid mask that traces, so nothing fades in.
2. **Then content, in reading order inside every container.** Every container (a region, a channel, a tally, a topic, a gauge, a title block cell, a schedule row) writes its own parts one after another. Containers write side by side, all starting the moment the last frame has traced. Bars extend, stations rise one by one, ticks and tally strokes are struck one at a time, hatches sweep, and words and figures are lettered one character at a time. A region's balloon, name and share are its own content; the ink then runs round its outline to the share, and a tick follows.
3. **The readiness stamp is pressed last**, after every other part of the sheet.

Where it plays: L1 on the first look of a mount (a visit to the Detail page, or a variant switch; back from a zoom, L1 is simply there). L2 every time a region zooms open; it draws while the zoom grows. The stage plays once when the overlay opens, and an answer's delta plays on the drawn sheet; an answer that arrives mid-draw finishes the drawing first. The `working` miniature uses the same engine in a CSS loop. Reduced motion draws everything at once: nothing is planned, nothing is lettered, the pen stays off. The pen (Studio's `DraftingPen`) sets down on the largest frame of each wave, then on a container that is writing, then on the stamp. It leaves early, so it arrives with the ink.

Mechanics: the planner reads each drawing's DOM once at mount (depth = framed boxes above a frame; container = nearest `[data-draw-scope]`) and writes `--draw-at` / `--draw-for` onto the parts. One CSS animation per part does the rest. Nothing re-renders per step. The engine keeps its own animation events away from React's root listener. Timing constants are in `draw/drawTiming.ts`: 550 ms per frame wave, 28 ms per letter, 90-220 ms per content part.

## Review artifacts

| File | What it shows |
|---|---|
| `draw-in-detail-rich-dark-midnight.webm` | L1, rich twin (9 channels, full plan), 1280x800. |
| `draw-in-detail-focus-light.webm` | L2 Voice opened directly (it fades in and draws itself), light theme. |
| `draw-in-zoom-middraw-dark-midnight.webm` | L1 drawing, Voice pressed 2.3 s in: the zoom grows out of the region and draws itself. |
| `draw-in-integrated-detail-dark-midnight.webm` | The real Detail page (`twin/detail`), 1280x800. |
| `draw-in-integrated-stage-dark-midnight.webm` | The training overlay opening (`twin/stage-dealt`): the stage draws itself under the dealt card, stamp last. |
| `draw-in-integrated-stage-answer-dark-midnight.webm` | `twin/stage`: the harness answers the card at once, which finishes the drawing; the delta then plays on the drawn sheet. |
| `draw-in-detail-rich-filmstrip.png`, `draw-in-detail-focus-filmstrip.png` | 8 frames at fixed times, every animation seeked to the same moment (the pen is hidden in the strips because script motion cannot be seeked). |

Measured in the page harness (Vite dev build, system Chrome, 1280x800), with the planned length against the length measured from the `drawing` to the `done` state:

| Surface | Planned | Measured | Parts / letters |
|---|---|---|---|
| L1 rich | 5490 ms | 5441 ms | 350 / 474 |
| L2 Voice (rich) | 3620 ms | 3592 ms | 207 / 271 |
| Integrated Detail (L1) | 4066 ms | 4053 ms | 180 / 429 |
| Integrated stage (opening) | 4066 ms | 4138 ms | 122 / 335 |

## Final-state stills

The stills were re-shot after the draw-in with `shoot.mjs --settle 9000`. The only visible change from round 1 is the faint rule under each tally gate, which is now the gate's frame.
- `detail-*`: L1, one-channel twin. Identity is the bio as a dimension line against its target, plus language balloons. Voice is one 8-station elevation per channel, with sample ticks above a baseline and rule ticks below. Knowledge is tallies (approved inked, awaiting dashed, rejected crossed). Training is six topic scale bars, goal gauges and the kind-mix linings.
- `detail-empty-*`: a just-forged twin. Every part is dashed or hatched, never blank and never 0.
- `detail-rich-*`: nine channels and a full plan, the overflow test. Rows that do not fit move to L2 through container queries; nothing shrinks.
- `detail-focus-*`: L2 Voice, a drawing schedule (channels x the 8 dimensions, samples, rules, directives, origin symbols). `focus-identity|knowledge|training-*` show the other three zooms (pressed from L1, shot once drawn).
- `stage-*`: the training base layer with the reconciled delta played on the drawn sheet: the answered topic and goal lit and re-inked, a leader down the gutter to the notes, and the notes carrying the gain and the model's why.
- `stage-working-*`: the engine working with no question. The open middle shows the plan in miniature, drawn, held and lifted away in a loop.
- `integrated-*`: the variant inside the real Detail page and the training overlay (WP6 shell), at 1280x800.
Sizes 1280x800 and 1920x1080, themes dark-midnight and light. Source: `src/features/plugins/twin/blueprint/variants/drafting/`.
