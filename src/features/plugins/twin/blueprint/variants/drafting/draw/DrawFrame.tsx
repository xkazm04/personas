import { useId } from 'react';

/**
 * A box's outline as a frame the engine traces (a stroke, never a fade). It
 * stands in for a CSS border: the box keeps its border WIDTH as a transparent
 * border (`edge`, so nothing moves) and is `position: relative`; the frame
 * draws its stroke exactly where the border was. A box that carries a
 * DrawFrame is what the planner counts as nesting depth.
 *
 * A dashed outline cannot trace by its own dash (the dash IS its pattern), so
 * it is revealed through a solid mask that traces instead. `draw` false is
 * the same outline, simply there (a sheet already drawn).
 */
export default function DrawFrame({
  shape = 'rect',
  stroke,
  width = 1,
  edge = 1,
  dash,
  draw = true,
  kind = 'frame',
}: {
  shape?: 'rect' | 'circle';
  /** Any CSS colour; the engine itself has none. */
  stroke: string;
  width?: number;
  /** The border width the box keeps (transparent) where the frame draws; 0 for a box with none. */
  edge?: number;
  dash?: string;
  draw?: boolean;
  /** `stroke`: the outline is CONTENT of its container (a balloon is its region's, drawn after the frames). */
  kind?: 'frame' | 'stroke';
}) {
  const id = `twd-frame-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // The SVG's edges run along the middle of the stroke, so a 1px line lands on whole pixels.
  const at = width / 2 - edge;
  const grow = -2 * at;
  const box = { left: at, top: at, width: `calc(100% + ${grow}px)`, height: `calc(100% + ${grow}px)` };
  const masked = !!dash && draw;
  const shapeProps = shape === 'circle' ? { cx: '50%', cy: '50%', rx: '50%', ry: '50%' } : { x: 0, y: 0, width: '100%', height: '100%' };
  const Shape = shape === 'circle' ? 'ellipse' : 'rect';

  return (
    <svg aria-hidden data-draw-svg="outline" className="pointer-events-none absolute overflow-visible" style={box}>
      {masked && (
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x="-10%" y="-10%" width="120%" height="120%">
            <Shape {...shapeProps} fill="none" stroke="white" strokeWidth={width + 2} pathLength={100} data-draw={kind} />
          </mask>
        </defs>
      )}
      <Shape
        {...shapeProps}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        pathLength={dash ? undefined : 100}
        mask={masked ? `url(#${id})` : undefined}
        data-draw={draw && !dash ? kind : undefined}
      />
    </svg>
  );
}
