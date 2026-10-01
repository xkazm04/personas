import { useTranslation } from '@/i18n/useTranslation';
import { Letter } from './Lettering';
import DrawFrame from './draw/DrawFrame';
import DrawLoop from './draw/DrawLoop';
import Write from './draw/Write';

/** The miniature's drawing, in px (the plan below is laid out in it). */
const SIZE = { width: 280, height: 120 } as const;

type Box = readonly [x: number, y: number, w: number, h: number];
type Line = readonly [x1: number, y1: number, x2: number, y2: number];

/**
 * The layer-one plan in miniature (px inside a 280x120 drawing): each region
 * a frame, the boxes inside it a second wave of frames (elevations, topic
 * tracks, balloons, title cells), and its strokes the content drawn into it.
 * Region-local coordinates.
 */
const MINI: readonly { at: Box; boxes: readonly Box[]; round?: boolean; strokes: readonly Line[] }[] = [
  { at: [0, 0, 80, 46], round: true, boxes: [[8, 24, 14, 14], [28, 24, 14, 14], [48, 24, 14, 14]], strokes: [[8, 12, 58, 12], [58, 7, 58, 17]] },
  {
    at: [86, 0, 110, 92],
    boxes: [[6, 8, 30, 36], [40, 8, 30, 36], [74, 8, 30, 36], [6, 50, 30, 36], [40, 50, 30, 36]],
    strokes: [[12, 44, 12, 26], [18, 44, 18, 20], [24, 44, 24, 30], [46, 44, 46, 22], [52, 44, 52, 30], [58, 44, 58, 18], [80, 44, 80, 28], [86, 44, 86, 24], [12, 86, 12, 66], [18, 86, 18, 72], [46, 86, 46, 70]],
  },
  { at: [0, 52, 80, 68], boxes: [], strokes: [[8, 14, 8, 30], [13, 14, 13, 30], [18, 14, 18, 30], [23, 14, 23, 30], [5, 28, 26, 16], [36, 14, 36, 30], [41, 14, 41, 30], [8, 46, 60, 46]] },
  {
    at: [202, 0, 78, 92],
    boxes: [[6, 10, 66, 7], [6, 26, 66, 7], [6, 42, 66, 7], [6, 58, 66, 7], [6, 74, 66, 7]],
    strokes: [[7, 13.5, 48, 13.5], [7, 29.5, 30, 29.5], [7, 45.5, 60, 45.5], [7, 61.5, 22, 61.5], [7, 77.5, 40, 77.5]],
  },
  { at: [86, 98, 194, 22], boxes: [[0, 0, 124, 22], [124, 0, 70, 22]], strokes: [[8, 12, 96, 12], [136, 6, 160, 16]] },
];

/**
 * The waiting surface while the engine works with no question: the twin's
 * plan in miniature, drawn by the same engine as the sheet (frames by depth,
 * then each region's strokes in order), held, and lifted away, over and over
 * in CSS (`DrawLoop`), which the app's reduced-motion reset stops; under the
 * `reduced` prop it is simply drawn.
 */
export default function WorkingPlan({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  return (
    <div className="flex flex-col items-center gap-4" data-testid="twd-working">
      <Letter strong>{b.variantCopy.drafting.sheetTitle}</Letter>
      <DrawLoop live={!reduced} aria-hidden className="relative" style={SIZE} data-live={!reduced}>
        {MINI.map(({ at: [x, y, w, h], boxes, round, strokes }) => (
          <div key={`${x}-${y}`} data-draw-scope="" className="absolute" style={{ left: x, top: y, width: w, height: h }}>
            <DrawFrame stroke="var(--ink)" width={1.5} edge={0} />
            {boxes.map(([bx, by, bw, bh]) => (
              <div key={`${bx}-${by}`} className="absolute" style={{ left: bx, top: by, width: bw, height: bh }}>
                <DrawFrame stroke="var(--ink-dim)" edge={0} shape={round ? 'circle' : 'rect'} />
              </div>
            ))}
            <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
              {strokes.map(([x1, y1, x2, y2]) => (
                <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-strong)" strokeWidth={1.5} pathLength={100} data-draw="stroke" />
              ))}
            </svg>
          </div>
        ))}
      </DrawLoop>
      <Write text={b.states.working} className="typo-body text-foreground" />
    </div>
  );
}
