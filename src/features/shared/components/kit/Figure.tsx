import { useId, type CSSProperties, type ReactNode } from 'react';
import { toneColor } from './ChartFrame';
import { emptyBand, Ghost, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type KitState, type Tone } from './types';

/** One label under a drawn figure: the name at full type size, and the quantity the drawing
 *  states. `onPress` makes it the figure's control for that part of the drawing. */
export interface FigureCallout {
  id: string;
  /** The name. Rendered at full type size in normal flow - never inside the drawing. */
  label: ReactNode;
  /** The quantity the drawing draws, stated ("3/4"). */
  figure?: ReactNode;
  /** Accessible name of the control, when the rendered label alone would not say enough
   *  ("Local Environment, passing, 4 of 4 checks pass"). */
  name?: string;
  onPress?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  testId?: string;
}

/**
 * Figure: the kit's door for a DRAWN figure (doctrine 6c, 2026-10-03).
 *
 * 6c split the law the kit was being read under: **the kit governs STRUCTURE, it does not govern
 * FIGURE.** The kit exports ~30 parts and exactly two could draw anything (`UnitStrip`, rows of
 * squares; `ChartFrame`, a frame *around* a chart something else draws), so a builder who needed
 * visual expression had no legal move - the kit could not draw it and hand-rolling it was a
 * finding, and the only compliant output was austere rows. `Figure` is the legal move: a framed
 * region that HOSTS drawn content on the reading line, so a figure is composed INTO the kit rather
 * than bolted on beside it.
 *
 * **It is deliberately not a drawing API.** It owns the frame, the geometry, the states, the
 * announcement, the ink and the labels; it owns nothing about shape. Growing it an opinion about
 * series, axes, scales or marks would re-make the mistake 6c is correcting, so every prop here is
 * justified by a real need measured in `plugins/twin/blueprint/variants/strata` (the ~1,778-line
 * figure the owner named as the quality bar) or in the first surface drawn with it (System Check's
 * machine), and props that could not be justified that way were refused - see "Refused", below.
 *
 * **Free inside the frame is not lawless** (6c). The caller's drawing still takes colour only
 * through app tokens, states type through `.typo-*` or `calc(var(--type-N) * var(--type-f))`,
 * honours `prefers-reduced-motion` and renders in every theme.
 *
 * **What the frame gives the drawing.**
 *
 * 1. **A size container.** `.k-figure__plot` is `container-type: size`, which is the one thing strata
 *    actually needed from a host and the reason its whole geometry is pure CSS on container units
 *    with nothing measured in script. It is also why the geometry is a prop: a size container needs
 *    a definite size in both axes, and `height` / `aspect` are what declare it.
 * 2. **The `--fig-*` ink**, derived once from `tone`, with the light-theme correction. Strata's
 *    `--s-*` block is ten `color-mix()`es plus a per-theme fix - the single most copy-pasteable
 *    thing in it, and the half a second figure would get wrong.
 * 3. **The callout rail**, which is the rule that keeps a figure legible, made into an affordance
 *    instead of a comment. Strata's law: *labels live in flat callouts beside the drawing, at full
 *    type size*, because a label INSIDE a scaled drawing renders at whatever size the scale lands
 *    on - System Check's board was drawing 11px row text, and no type token can reach it. So the
 *    drawing is `aria-hidden` and carries no type at all; `callouts` is where its names go, in
 *    normal flow, on the same equal track the drawing divides itself by, so the two align with
 *    nothing measured. A callout with `onPress` is the figure's control for that part of the
 *    drawing, its hit area stretched up over the drawing - the same stretched press `ListRow`,
 *    `ContextCard` and `Tile` already use, built here where the kit builds controls rather than
 *    hand-rolled in a feature (6c: *a figure is not an excuse to re-draw chrome; the exemption
 *    covers the drawing, not its furniture*). A figure whose composition needs its labels somewhere
 *    else - strata puts them on leader lines off each plate - ignores `callouts` and draws them in
 *    `children`; the rail is an offer, not a shape.
 *
 * **Refused, with the reason.** `padding` / `bleed`: the frame owns the reading line, and a figure
 * that wants out of it is asking the kit to stop governing chrome. `title` / `caption`: that is a
 * `Section` head. `reduced` / `motion`: `prefers-reduced-motion` is a media query the figure's own
 * CSS answers (and `.k-host`'s own block already reaches inside a figure), and a prop would let a
 * figure *claim* it honoured reduced motion without doing so. `onPress` on the FRAME: a figure is a
 * drawing, and a frame that was also one button would force every figure to have exactly one
 * target - the targets belong to the parts of the drawing, which is what `callouts` carries.
 * Anything shaped like a series, a scale, an axis or a mark: that is a drawing API.
 * @catalog Figure - the kit's frame for a DRAWN figure (doctrine 6c): the reading line, a declared height or aspect, a size container for the drawing, its ghost and empty band, the figure's announcement, the --fig-* ink from a tone, and the flat callout rail that keeps the labels out of the drawing. Kit.
 */
export function Figure({ label, desc, height, aspect, tone = 'primary', callouts, state, empty, testId, className, children }: {
  /** Accessible name of the figure. Required: the drawing is `aria-hidden`, so this is all a
   *  reader gets. */
  label: string;
  /** The drawing's text equivalent, announced as the figure's description. What a reader is owed
   *  when the shape is the message ("12 of 14 checks pass across 6 environments. 2 to fix."). */
  desc?: string;
  /** The frame's height in px. Exactly one of `height` / `aspect`. A fixed height is right when
   *  the figure's second dimension is a count that does not grow with the surface's width (the
   *  machine's six piers get WIDER on a wider screen, never taller). */
  height?: number;
  /** The frame's width-to-height ratio instead of a height, so the figure scales with the surface.
   *  Right when the drawing is a two-dimensional composition whose proportion is part of it
   *  (strata's plate is a declared `W x 0.62W`, and its scene is measured in both `cqw` and `cqh`). */
  aspect?: number;
  /** The figure's ink: `--fig-ink` and the five tints derived from it. Default `primary`, which is
   *  the theme's own identity (doctrine 0b.1). A figure whose WHOLE meaning is one status takes
   *  that status; a figure with per-element status colours keeps `primary` here and colours its
   *  own elements, so the frame never lies about what the figure means. */
  tone?: Tone;
  /** The flat labels under the drawing, one per equal column, at full type size. */
  callouts?: readonly FigureCallout[];
  state?: KitState;
  empty?: EmptySpec;
  testId?: string;
  className?: string;
  children?: ReactNode;
}) {
  const st: KitState = state ?? 'default';
  const descId = useId();
  const hasDesc = !!desc && st === 'default';
  const rail = st === 'default' ? callouts : undefined;
  // Exactly one geometry: a height wins when both are given, because a px height is the one that
  // cannot be satisfied by the other (an aspect with a definite height would double-declare it).
  const geom: CSSProperties = height != null
    ? { '--fig-h': `${height}px` } as CSSProperties
    : { '--fig-aspect': String(aspect ?? 3) } as CSSProperties;
  const style = { ...geom, '--fig-ink': toneColor(tone), ...(rail?.length ? { '--fig-cols': rail.length } : null) } as CSSProperties;
  return (
    <figure
      className={cx('k-figure', height != null ? 'k-figure--h' : 'k-figure--aspect', !!rail?.length && 'k-figure--railed', stateClass(st), className)}
      {...kitAttrs('Figure', st)}
      data-testid={testId}
      aria-label={label}
      aria-describedby={hasDesc ? descId : undefined}
      aria-busy={st === 'loading' || undefined}
      style={style}
    >
      {hasDesc && <p id={descId} className="k-figure__desc">{desc}</p>}
      {st === 'loading'
        ? <div className="k-figure__plot"><Ghost width="100%" height="100%" /></div>
        : st === 'empty'
          ? emptyBand(empty ?? { title: '' })
          : (
            <div className="k-figure__plot">
              {children}
              {rail?.length ? <div className="k-figure__rail">{rail.map((c) => <Callout key={c.id} c={c} />)}</div> : null}
            </div>
          )}
    </figure>
  );
}

/** One column of the rail. With `onPress` it is the kit's stretched press over its own column of
 *  the drawing; without one it is the same two lines, inert. */
function Callout({ c }: { c: FigureCallout }) {
  const body = (
    <>
      <span className="k-figure__name typo-body">{c.label}</span>
      {c.figure != null && <span className="k-figure__fig typo-data k-regular">{c.figure}</span>}
    </>
  );
  if (!c.onPress) {
    return <div className="k-figure__callout" data-testid={c.testId}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={cx('k-figure__callout', 'k-figure__press', c.pressed && 'is-selected')}
      data-testid={c.testId}
      aria-pressed={c.pressed}
      aria-label={c.name}
      disabled={c.disabled}
      onClick={c.onPress}
    >
      {body}
    </button>
  );
}
