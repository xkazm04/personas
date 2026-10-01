/**
 * The draw-in planner (spark twin-portable-blueprint, round 2). It reads ONE
 * drawing's DOM once per mount and turns its declared parts into a schedule:
 *
 *   - `data-draw="frame"`: a frame. Its DEPTH is how many framed boxes hold
 *     it (a box is an element that carries an outline frame, `<DrawFrame>`).
 *     Every frame of one depth traces in parallel; depth n starts when depth
 *     n-1 has traced (`frameWave` apart).
 *   - any other kind is CONTENT. It belongs to the nearest
 *     `[data-draw-scope]` above it (its container; the drawing's root when
 *     none). Content starts only after the last frame wave, everywhere at once;
 *     inside one container the parts follow each other strictly, in document
 *     order, which the components keep in reading order.
 *   - `press` parts are pressed last, after every other part on the sheet.
 *
 * Why the DOM and not React props: the tree IS the component structure, so
 * the depth of a frame and the container of a part are read from where they
 * actually render, and a theme that moves a part moves its place in the
 * schedule with it. Nothing re-renders per step: the plan is written onto the
 * parts as CSS custom properties (`--draw-at`, `--draw-for`) once, and CSS
 * animations do the rest (draw.css). This is a computed schedule, not a list
 * entrance stagger: no part's delay is an index times a constant.
 */
import { DRAW_KINDS, DRAW_TIMING, drawDuration, type DrawKind } from './drawTiming';

export interface DrawItem {
  el: HTMLElement | SVGElement;
  kind: DrawKind;
  /** ms from the drawing's start. */
  at: number;
  dur: number;
  /** Frames only. */
  depth: number | null;
  /** Content only: the container whose chronology it is part of. */
  scope: Element | null;
  letters: number;
}

export interface PenWaypoint {
  /** When the ink arrives there (ms from the drawing's start). */
  at: number;
  el: HTMLElement;
}

export interface DrawPlan {
  items: DrawItem[];
  waves: number;
  contentAt: number;
  total: number;
  pen: PenWaypoint[];
}

const KINDS = new Set<string>(DRAW_KINDS);
type Part = HTMLElement | SVGElement;

function isPart(el: Element): el is Part {
  return el instanceof HTMLElement || el instanceof SVGElement;
}

/** A shape inside <mask> has no box of its own: ask the drawing that holds it. */
function visible(el: Part): boolean {
  const probe = el instanceof SVGElement ? (el.closest('svg') ?? el) : el;
  // jsdom has no checkVisibility; there everything counts as drawn.
  return typeof probe.checkVisibility === 'function' ? probe.checkVisibility() : true;
}

/** The element a part draws on: an SVG part's drawing's host, else itself. */
function hostOf(el: Part): HTMLElement | null {
  if (el instanceof HTMLElement) return el;
  const svg = el.closest('svg');
  return svg?.parentElement ?? null;
}

function depthOf(el: Part, root: Element, boxes: Set<Element>): number {
  const svg = el.closest('svg');
  const outline = svg?.getAttribute('data-draw-svg') === 'outline';
  let n = 0;
  for (let a = svg ? svg.parentElement : el.parentElement; a && a !== root; a = a.parentElement) {
    if (boxes.has(a)) n++;
  }
  // A box's own outline is drawn at the depth of the box, not inside it.
  return Math.max(0, n - (outline ? 1 : 0));
}

function lettersOf(el: Part): number {
  const declared = Number(el.getAttribute('data-draw-letters'));
  return declared > 0 ? declared : (el.textContent ?? '').trim().length;
}

export function planDraw(root: HTMLElement, offset = 0): DrawPlan {
  const T = DRAW_TIMING;
  const boxes = new Set<Element>();
  root.querySelectorAll('svg[data-draw-svg="outline"]').forEach((s) => s.parentElement && boxes.add(s.parentElement));

  const parts = Array.from(root.querySelectorAll('[data-draw]')).filter(
    (el): el is Part => isPart(el) && KINDS.has(el.getAttribute('data-draw') ?? '') && el.closest('[data-draw-root]') === root && visible(el),
  );

  const items: DrawItem[] = parts.map((el) => {
    // Safe: the filter above kept only parts whose `data-draw` is in DRAW_KINDS.
    const kind = el.getAttribute('data-draw') as DrawKind;
    const letters = kind === 'write' ? lettersOf(el) : 0;
    const declared = Number(el.getAttribute('data-draw-ms'));
    const dur = declared > 0 ? declared : drawDuration(kind, letters);
    if (kind === 'frame') return { el, kind, at: 0, dur, depth: depthOf(el, root, boxes), scope: null, letters };
    const scope = el.parentElement?.closest('[data-draw-scope]') ?? null;
    return { el, kind, at: 0, dur, depth: null, scope: scope && root.contains(scope) ? scope : root, letters };
  });

  const frames = items.filter((i) => i.kind === 'frame');
  const waves = frames.reduce((m, f) => Math.max(m, (f.depth ?? 0) + 1), 0);
  for (const f of frames) f.at = offset + (f.depth ?? 0) * T.frameWave;
  const contentAt = offset + waves * T.frameWave;

  const cursor = new Map<Element, number>();
  let end = frames.reduce((m, f) => Math.max(m, f.at + f.dur), offset);
  for (const c of items) {
    if (c.kind === 'frame' || c.kind === 'press' || !c.scope) continue;
    c.at = cursor.get(c.scope) ?? contentAt;
    cursor.set(c.scope, c.at + c.dur);
    end = Math.max(end, c.at + c.dur);
  }
  const contentEnd = end;
  let pressAt = end + T.pressGap;
  for (const p of items.filter((i) => i.kind === 'press')) {
    p.at = pressAt;
    pressAt += p.dur;
    end = p.at + p.dur;
  }

  return { items, waves, contentAt, total: end, pen: penWaypoints(items, waves, offset, contentAt, contentEnd) };
}

function area(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

/**
 * Where the pen is while the sheet draws: on the largest frame of each wave,
 * then, every `penDwell`, at a container that is writing at that moment (the
 * next one in reading order, so it travels the sheet rather than circling one
 * spot), and last at the stamp.
 */
function penWaypoints(items: DrawItem[], waves: number, offset: number, contentAt: number, contentEnd: number): PenWaypoint[] {
  const T = DRAW_TIMING;
  const out: PenWaypoint[] = [];
  for (let d = 0; d < waves; d++) {
    const hosts = items.filter((i) => i.kind === 'frame' && i.depth === d).map((i) => hostOf(i.el)).filter((h): h is HTMLElement => !!h);
    const lead = hosts.reduce<HTMLElement | null>((best, h) => (!best || area(h) > area(best) ? h : best), null);
    if (lead) out.push({ at: offset + d * T.frameWave, el: lead });
  }
  const content = items.filter((i) => i.kind !== 'frame' && i.kind !== 'press');
  const rank = new Map<Element, number>();
  content.forEach((c, i) => c.scope && !rank.has(c.scope) && rank.set(c.scope, i));
  let last = -1;
  for (let t = contentAt; t < contentEnd; t += T.penDwell) {
    const active = content.filter((c) => c.at <= t && t < c.at + c.dur).sort((a, b) => (rank.get(a.scope!) ?? 0) - (rank.get(b.scope!) ?? 0));
    const next = active.find((c) => (rank.get(c.scope!) ?? 0) > last) ?? active[0];
    if (!next) continue;
    last = rank.get(next.scope!) ?? 0;
    const el = next.scope instanceof HTMLElement && !next.scope.hasAttribute('data-draw-root') ? next.scope : hostOf(next.el);
    if (el) out.push({ at: t, el });
  }
  for (const p of items.filter((i) => i.kind === 'press')) {
    const el = hostOf(p.el);
    if (el) out.push({ at: p.at, el });
  }
  return out.filter((w, i) => i === 0 || w.el !== out[i - 1]!.el);
}
