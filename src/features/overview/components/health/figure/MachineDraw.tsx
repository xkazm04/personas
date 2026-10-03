/**
 * The drawing itself (kit batch home-3, builder FG). A figure under doctrine 6c: free inside the
 * kit's `Figure` frame, and bound by section 6's law for a bespoke stylesheet - colour only through
 * app tokens, no literal type, every theme, reduced motion honoured.
 *
 * **What it draws, and why this shape says something a list cannot.** The six environments are not
 * peers in a grid: they are supports under one deck. Each pier's GIRTH is how many checks that
 * environment is made of, its COURSES are those checks stacked worst-at-the-top, and the deck is
 * the single continuous thing they all carry - the machine being ready. One failing check does not
 * colour a cell red; it shortens its pier, breaks the span above it, and leaves a step in a line
 * that is otherwise flat across the whole width. A labelled list of the same numbers states six
 * facts; the figure states the one fact those six are about, as a silhouette, before any colour is
 * read.
 *
 * **Failure is legible from SHAPE, which is the constraint 2b set.** Drop the colour and the five
 * states still differ: a passing course is a filled stone, a warning one is inset (bearing less), a
 * failing one is a void between two stubs inside a dashed outline, an unconfigured one is a dashed
 * outline with nothing in it, and a fact is a thin shim. The deck is solid, sagging, broken into
 * two pieces, or dashed.
 *
 * **Text is not in here.** Strata's rule: the drawing is `aria-hidden` and carries no glyph of
 * type at all; the names and figures live in the flat callout rail under it, in normal flow, at
 * full type size, where a type token can reach them. The 11px text inside a scaled drawing is
 * exactly the defect this batch is fixing.
 *
 * Only rectangles and horizontal / vertical lines, because `preserveAspectRatio="none"` stretches
 * X alone: a diagonal would skew with the window's width. (Strata takes the same vow for the same
 * reason, with `vector-effect: non-scaling-stroke` keeping the strokes honest.)
 */
import { BASE_Y, COL_W, VIEW_H, VIEW_W, type Course, type Pier } from './machineModel';

const DECK_T = 0.7;
/** Half the gap a broken span opens over the pier that failed. */
const BREAK = 0.22;
/** A capital under the deck and a plinth on the ground. Neither carries data - they are what makes
 *  the eye read a pier as BEARING something rather than as a bar standing next to a line, which is
 *  the whole difference between this figure and the board it replaces. */
const CAP_H = 0.55;
const CAP_OVER = 0.9;

function CourseShape({ c, x, w }: { c: Course; x: number; w: number }) {
  const common = { x, y: c.y, width: w, height: c.h };
  switch (c.kind) {
    case 'ok':
      return <rect className="mf-course mf-c-ok" {...common} />;
    case 'warn':
      // Inset on both sides: the course is still there and still bearing, but on less of itself.
      return <rect className="mf-course mf-c-warn" x={x + w * 0.16} y={c.y} width={w * 0.68} height={c.h} />;
    case 'error':
      // A void where a stone should be: the outline says what is missing, the two stubs are what is
      // left of it, and the gap between them is the one thing a colour-blind reader still sees.
      return (
        <g data-course="error">
          <rect className="mf-void" {...common} />
          <rect className="mf-course mf-c-error" x={x} y={c.y} width={w * 0.22} height={c.h} />
          <rect className="mf-course mf-c-error" x={x + w * 0.78} y={c.y} width={w * 0.22} height={c.h} />
        </g>
      );
    case 'inactive':
      // Planned, never built: the outline is drawn, the stone is not.
      return <rect className="mf-planned" {...common} />;
    case 'info':
      // A fact carries nothing, so it is drawn as a shim rather than as a course.
      return <rect className="mf-course mf-c-info" x={x} y={c.y + c.h * 0.36} width={w} height={Math.max(0.3, c.h * 0.28)} />;
    default:
      return <rect className="mf-course mf-c-ghost" {...common} />;
  }
}

function DeckSpan({ p }: { p: Pier }) {
  const y = p.deckY - DECK_T / 2;
  const x0 = p.colX;
  const cls = `mf-deck mf-deck--${p.deck}`;
  if (p.deck === 'planned') {
    // Drawn, not built. A dash made of rects rather than a `stroke-dasharray`, because the view box
    // is stretched on X alone and a dash pattern would stretch with it.
    const n = 5;
    const seg = COL_W / (n * 2 - 1);
    return (
      <g data-deck="planned">
        {Array.from({ length: n }, (_, i) => (
          <rect key={i} className={cls} x={x0 + i * seg * 2} y={y} width={seg} height={DECK_T} />
        ))}
      </g>
    );
  }
  if (p.deck !== 'broken') {
    return <rect className={cls} x={x0} y={y} width={COL_W} height={DECK_T} />;
  }
  // Broken: two pieces with the span's middle gone, so the deck is visibly not continuous.
  const half = COL_W * (0.5 - BREAK);
  return (
    <g data-deck="broken">
      <rect className={cls} x={x0} y={y} width={half} height={DECK_T} />
      <rect className={cls} x={x0 + COL_W - half} y={y} width={half} height={DECK_T} />
    </g>
  );
}

/** The vertical joint where the deck steps between two piers: a step, never a diagonal. */
function Riser({ a, b }: { a: Pier; b: Pier }) {
  if (Math.abs(a.deckY - b.deckY) < 0.05) return null;
  const top = Math.min(a.deckY, b.deckY) - DECK_T / 2;
  const h = Math.abs(a.deckY - b.deckY) + DECK_T;
  return <rect className="mf-riser" x={b.colX - DECK_T / 2} y={top} width={DECK_T} height={h} />;
}

/** The capital and the plinth: the two slabs that make a pier read as a support. */
function Bearings({ p }: { p: Pier }) {
  return (
    <g className="mf-bearing" aria-hidden="true">
      <rect x={p.x - CAP_OVER} y={p.top} width={p.w + CAP_OVER * 2} height={CAP_H} />
      <rect x={p.x - CAP_OVER} y={BASE_Y - CAP_H} width={p.w + CAP_OVER * 2} height={CAP_H} />
    </g>
  );
}

export function MachineDraw({ piers }: { piers: readonly Pier[] }) {
  return (
    <svg
      className="mf-draw"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* This machine: the ground the piers stand on. The SELECTED column is not drawn here: the
          kit's `Figure` washes its own callout column, and two owners for one state is two bugs. */}
      <rect className="mf-ground" x={0} y={BASE_Y} width={VIEW_W} height={VIEW_H - BASE_Y} />
      <rect className="mf-base" x={0} y={BASE_Y - 0.25} width={VIEW_W} height={0.5} />

      {piers.map((p) => (
        <g key={p.id} data-pier={p.id} data-worst={p.loading ? 'loading' : p.failed ? 'failed' : p.worst}>
          {p.failed
            ? <rect className="mf-failed" x={p.x} y={p.top} width={p.w} height={BASE_Y - p.top} />
            : p.courses.map((c) => <CourseShape key={c.key} c={c} x={p.x} w={p.w} />)}
          {!p.loading && !p.failed && <Bearings p={p} />}
          {p.overflow > 0 && (
            <g data-overflow={p.overflow}>
              <rect className="mf-over" x={p.x + p.w * 0.3} y={p.top - 1.5} width={p.w * 0.4} height={0.3} />
              <rect className="mf-over" x={p.x + p.w * 0.3} y={p.top - 0.9} width={p.w * 0.4} height={0.3} />
            </g>
          )}
        </g>
      ))}

      {piers.map((p, i) => (i > 0 ? <Riser key={`r-${p.id}`} a={piers[i - 1]!} b={p} /> : null))}
      {piers.map((p) => <DeckSpan key={`d-${p.id}`} p={p} />)}
    </svg>
  );
}
