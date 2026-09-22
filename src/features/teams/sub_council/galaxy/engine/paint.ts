// One frame of the field.
//
// A structural port of `docs/design/council-reference/index.html:522-643`.
// Everything the reference wrote as an rgba literal is a token here; every
// other number (radii, alphas, thresholds, the rim arc, the sunflower) is the
// reference's, unchanged, because those numbers ARE the approved design.
import { applyLens, LENS_NAME_AT_DEPTH, LENS_NAME_AT_SKY, LENS_R, lensShadows, type LensState } from './lens';
import { LabelQueue, type Rect } from './labels';
import { TAU } from './layout';
import { withAlpha, type CanvasTheme } from './theme';
import type { Viewport } from './camera';
import type {
  Altitude,
  CameraState,
  CategoryNode,
  CouncilMark,
  DomainNode,
  GalaxyLayout,
  GalaxyNode,
  PickTarget,
  SubjectNode,
} from './types';

export type { PickTarget } from './types';

/**
 * The CHILDREN of the node the reader is standing on are the readable,
 * clickable things at every altitude - the owner's fourth note ("each click
 * should always uncover nested layer, balance typography of children to be
 * readable and clickable"). Two numbers carry it.
 *
 * `CHILD_HIT_R` is a RADIUS, so the smallest target a child can offer is a
 * 24 px disc - the floor a pointer target is expected to clear - however few
 * pixels of ink the field actually spends on it at that altitude.
 *
 * `CHILD_LABEL_PX` is the chrome's `typo-heading` size, so a child on the
 * canvas reads at exactly the size a row of the rail beside it reads at.
 */
export const CHILD_HIT_R = 12;
export const CHILD_LABEL_PX = 14;

/** Lower wins. The node you stand on, then its children, then everything. */
const P_CURRENT = 0;
const P_CHILD = 1;

/**
 * The three captions the canvas prints that are PROSE, not data. They are
 * supplied by the React host from `t.council.galaxy.*` — the engine never
 * holds a user-facing string of its own.
 */
export interface CanvasCaptions {
  domainCaption: (d: DomainNode) => string;
  subjectFooter: (s: SubjectNode) => string;
  wedgeLabel: (key: string, n: number) => string;
}

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  captions: CanvasCaptions;
  theme: CanvasTheme;
  width: number;
  height: number;
  viewport: Viewport;
  camera: CameraState;
  layout: GalaxyLayout;
  lens: LensState;
  altitude: Altitude;
  domain: DomainNode | null;
  category: CategoryNode | null;
  subject: SubjectNode | null;
  hover: GalaxyNode | null;
  /** The council's star set, or null when nothing is focused. */
  thread: Set<string> | null;
  labels: LabelQueue;
  picks: PickTarget[];
  /** Chrome boxes, taken by the occupancy pass before any label is placed. */
  reserved: Rect[];
}

function markColour(theme: CanvasTheme, mark: CouncilMark): string {
  if (mark === 'approved') return theme.ok;
  if (mark === 'rejected') return theme.err;
  if (mark === 'pending') return theme.pend;
  return theme.uncouncilled;
}

/**
 * The ring that says "a click here lands on this".
 *
 * Drawn at the node's real hit radius rather than at its ink radius, because
 * the two differ by a lot for a child the field draws as three pixels of dot
 * and accepts a click on across 24. Without it the reader has to guess, which
 * is the complaint this pass exists to answer.
 */
function drawHitHalo(f: FrameInput, x: number, y: number, r: number): void {
  const { ctx, theme } = f;
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Push a pick and, when the pointer is on it, show what the click will do. */
function pickChild(f: FrameInput, x: number, y: number, inkR: number, node: GalaxyNode): void {
  const r = Math.max(inkR, CHILD_HIT_R);
  f.picks.push({ x, y, r, node });
  if (f.hover === node) drawHitHalo(f, x, y, r);
}

interface Projector {
  sx: (worldX: number) => number;
  sy: (worldY: number) => number;
}

function projector(camera: CameraState, viewport: Viewport): Projector {
  const cx = (viewport.x0 + viewport.x1) / 2;
  const cy = (viewport.y0 + viewport.y1) / 2;
  return {
    sx: (w) => (w - camera.x) * camera.k + cx,
    sy: (w) => (w - camera.y) * camera.k + cy,
  };
}

function drawDust(f: FrameInput, p: Projector): void {
  const { ctx, theme, width, viewport } = f;
  ctx.fillStyle = theme.dust;
  for (const d of f.layout.dust) {
    const [x, y] = applyLens(f.lens, p.sx(d.x), p.sy(d.y));
    if (x < -6 || x > width + 6 || y < -6 || y > viewport.y1 + 6) continue;
    ctx.globalAlpha = 0.2 + d.s * 0.45;
    ctx.fillRect(x, y, 1.2 + d.s, 1.2 + d.s);
  }
  ctx.globalAlpha = 1;
}

/** The rim arc: how much of this cluster the council has reached. */
function drawRimArc(f: FrameInput, d: DomainNode, dx: number, dy: number, dr: number): void {
  const { ctx, theme } = f;
  const lw = Math.max(2.5, Math.min(8, dr * 0.032));
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.strokeStyle = theme.rimTrack;
  ctx.arc(dx, dy, dr + lw * 1.5, 0, TAU);
  ctx.stroke();
  let a0 = -Math.PI / 2;
  const denominator = Math.max(1, d.subjectCount);
  for (const [mark, colour] of [
    ['approved', theme.ok],
    ['pending', theme.pend],
    ['rejected', theme.err],
  ] as Array<[CouncilMark, string]>) {
    const n = d.counts[mark];
    if (!n) continue;
    const a1 = a0 + (TAU * n) / denominator;
    ctx.beginPath();
    ctx.strokeStyle = colour;
    ctx.arc(dx, dy, dr + lw * 1.5, a0, a1);
    ctx.stroke();
    a0 = a1;
  }
}

function drawSkyStars(f: FrameInput, p: Projector, d: DomainNode): void {
  const { ctx, theme, thread } = f;
  for (const c of d.categories) {
    for (const s of c.subjects) {
      const [x, y, mg] = applyLens(f.lens, p.sx(s.x), p.sy(s.y));
      const threaded = thread?.has(s.slug) ?? false;
      ctx.globalAlpha = thread ? (threaded ? 1 : 0.14) : 1;
      ctx.fillStyle = threaded ? theme.accent : markColour(theme, s.mark);
      const rr = (threaded ? 4.4 : s.mark === 'none' ? 1.4 : 2.6) * Math.min(3.2, mg);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
      if (threaded) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, rr + 4.5, 0, TAU);
        ctx.stroke();
        f.picks.push({ x, y, r: rr + 8, node: s });
        f.labels.push({ x, y: y - rr - 10, text: s.title, size: 14.5, color: theme.accent, weight: 670, align: 'center', priority: 1 });
      } else if (mg > LENS_NAME_AT_SKY) {
        f.labels.push({ x, y: y - rr - 7, text: s.title, size: 15, color: theme.ink1, weight: 680, align: 'center', priority: 0 });
      }
    }
  }
}

function drawTechniques(f: FrameInput, p: Projector, s: SubjectNode): void {
  const { ctx, theme, width, viewport, camera } = f;
  const hover = f.hover;
  for (const t of s.techniques) {
    const [x, y, m] = applyLens(f.lens, p.sx(t.x), p.sy(t.y));
    if (x < -30 || x > width + 30 || y < -30 || y > viewport.y1 + 30) continue;
    const tr = Math.max(2, Math.min(9, (1.1 + t.laws.length * 0.55) * camera.k * 0.42 * m));
    if (tr < 1.6) continue;
    const shared =
      hover != null && hover !== t && hover.kind === 'technique' && hover.laws.some((l) => t.laws.includes(l));
    ctx.fillStyle = shared ? theme.purple : hover === t ? theme.accent : withAlpha(theme.ink1, theme.light ? 0.66 : 0.76);
    ctx.beginPath();
    ctx.arc(x, y, tr, 0, TAU);
    ctx.fill();
    // A technique is a CHILD of the subject the reader is standing on: 24 px
    // of target and a name at the chrome's heading size, unconditionally. It
    // used to be named only above 4.2 px of ink, which left the small ones
    // clickable but anonymous - a click you cannot read is not a click.
    pickChild(f, x, y, tr + 5, t);
    f.labels.push({
      x,
      y: y - Math.max(tr, CHILD_HIT_R) - 6,
      text: `${t.rank}. ${t.slug.replace(/-/g, ' ')}`,
      size: CHILD_LABEL_PX,
      color: shared ? theme.purple : theme.ink2,
      weight: 580,
      align: 'center',
      // At subject altitude the technique names ARE the content. They yield
      // to the subject's own title and to nothing else.
      priority: P_CHILD,
    });
  }
}

function drawSubject(f: FrameInput, p: Projector, s: SubjectNode, inCategory: boolean): void {
  const { ctx, theme, width, viewport, camera, thread } = f;
  const [x, y, m] = applyLens(f.lens, p.sx(s.x), p.sy(s.y));
  if (x < -40 || x > width + 40 || y < -40 || y > viewport.y1 + 40) return;
  const base = ctx.globalAlpha;
  const threaded = thread?.has(s.slug) ?? false;
  const isSelected = f.subject === s;
  if (thread) ctx.globalAlpha = base * (threaded ? 1 : 0.12);
  else if (f.subject && !isSelected) ctx.globalAlpha = base * 0.2;

  const r = Math.max(2, Math.min(11, (1.7 + camera.k * 0.55) * m));
  // A subject is a child when the reader is standing in its category and has
  // not yet gone into a subject.
  const isChild = inCategory && f.subject === null;
  if (isChild) pickChild(f, x, y, r + 4, s);
  else f.picks.push({ x, y, r: Math.max(r + 4, 8), node: s });

  if (s.mark !== 'none') {
    const colour = markColour(theme, s.mark);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    glow.addColorStop(0, withAlpha(colour, theme.light ? 0.33 : 0.4));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, TAU);
    ctx.fill();
  }
  if (s.mark === 'rejected') {
    ctx.fillStyle = theme.err;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = theme.sky;
    ctx.lineWidth = Math.max(1, r * 0.4);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y);
    ctx.lineTo(x + r * 0.7, y);
    ctx.stroke();
  } else if (s.mark === 'approved') {
    ctx.fillStyle = theme.ok;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  } else if (s.mark === 'pending') {
    ctx.strokeStyle = theme.pend;
    ctx.lineWidth = Math.max(1.3, r * 0.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
  } else {
    ctx.strokeStyle = theme.uncouncilled;
    ctx.lineWidth = Math.max(1, r * 0.38);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.9, 0, TAU);
    ctx.stroke();
  }
  if (isSelected || f.hover === s) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, TAU);
    ctx.stroke();
  }

  const lensed = m > LENS_NAME_AT_DEPTH;
  // A subject dimmed because a SIBLING is open is context, not content: it is
  // drawn at a fifth of the ink and its name would compete with the open
  // subject's techniques for the same space. Not queued at all, so it can
  // neither win a slot nor be counted as a label the view withheld.
  const dimmedBySibling = f.subject !== null && !isSelected;
  const wantName = isSelected || threaded || f.hover === s || lensed || (isChild && !dimmedBySibling);
  if (isSelected) {
    // The node the reader is standing on. Its own title is the ONE caption
    // that outranks its children, and it is the way back up: clicking it
    // climbs, which is the canvas twin of clicking the breadcrumb.
    f.labels.push({
      x,
      y: y - r * 2.9,
      text: `${s.rank}. ${s.title}`,
      size: 20,
      color: theme.ink1,
      weight: 670,
      align: 'center',
      priority: P_CURRENT,
      climb: s,
    });
  } else if (wantName) {
    f.labels.push({
      x,
      y: y - Math.max(r, isChild ? CHILD_HIT_R : r) - 8,
      text: s.title,
      size: isChild || lensed ? CHILD_LABEL_PX : 13.5,
      color: threaded ? theme.accent : f.hover === s ? theme.ink1 : lensed || isChild ? theme.ink1 : theme.ink2,
      weight: lensed || isChild ? 680 : 620,
      align: 'center',
      priority: isChild || threaded ? P_CHILD : f.hover === s ? P_CURRENT : lensed ? 2 : 6,
    });
  }
  if (isSelected) {
    drawTechniques(f, p, s);
    const [sx, sy] = applyLens(f.lens, p.sx(s.x), p.sy(s.y));
    f.labels.push({
      x: sx,
      y: sy + Math.min(200, 13 * camera.k * 0.9) + 20,
      text: f.captions.subjectFooter(s),
      size: 13.2,
      color: theme.ink4,
      weight: 700,
      align: 'center',
      priority: 1,
    });
  }
  ctx.globalAlpha = base;
}

function drawCategory(f: FrameInput, p: Projector, c: CategoryNode, dimmedByDomain: boolean): void {
  const { ctx, theme, width, viewport, camera } = f;
  const [ccx, ccy, m] = applyLens(f.lens, p.sx(c.x), p.sy(c.y));
  const cr = c.r * camera.k * m;
  if (ccx + cr < -90 || ccx - cr > width + 90 || ccy + cr < -90 || ccy - cr > viewport.y1 + 90) return;
  const isCurrent = f.category === c;
  const dimmedByCategory = f.category != null && f.category !== c;
  // A category is a child when the reader is standing in ITS domain and has
  // not yet gone into a category.
  const isChild = !dimmedByDomain && f.domain === c.domain && f.category === null;
  ctx.globalAlpha = dimmedByDomain ? 0.15 : dimmedByCategory ? 0.2 : 1;
  ctx.beginPath();
  ctx.arc(ccx, ccy, cr, 0, TAU);
  ctx.strokeStyle = isCurrent ? theme.accent : theme.hair2;
  ctx.lineWidth = isCurrent ? 1.6 : 1;
  ctx.stroke();
  if (isChild) pickChild(f, ccx, ccy, cr, c);
  else f.picks.push({ x: ccx, y: ccy, r: cr, node: c });
  if (cr > 24 || isChild) {
    f.labels.push({
      x: ccx,
      y: ccy - Math.max(cr, isChild ? CHILD_HIT_R : cr) - 8,
      text: `${c.rank}. ${c.title}`,
      size: isCurrent ? 15.5 : CHILD_LABEL_PX,
      color: isCurrent ? theme.accent : isChild ? theme.ink1 : theme.ink2,
      weight: isCurrent || isChild ? 670 : 620,
      align: 'center',
      priority: isCurrent ? P_CURRENT : isChild ? P_CHILD : 4,
      // Only while it IS the node being stood in — a category title at
      // sky or domain altitude descends, it does not climb.
      climb: isCurrent && f.subject === null ? c : undefined,
    });
  }
  if (isCurrent && cr > 150 && c.wedges.length > 1) {
    for (const w of c.wedges) {
      ctx.save();
      ctx.strokeStyle = theme.hair2;
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ccx, ccy);
      ctx.lineTo(ccx + Math.cos(w.a0) * cr, ccy + Math.sin(w.a0) * cr);
      ctx.stroke();
      ctx.restore();
      f.labels.push({
        x: ccx + Math.cos(w.mid) * (cr + 22),
        y: ccy + Math.sin(w.mid) * (cr + 22),
        text: f.captions.wedgeLabel(w.key, w.n),
        size: 13,
        color: theme.ink3,
        weight: 660,
        align: Math.cos(w.mid) >= 0 ? 'left' : 'right',
        priority: 2,
      });
    }
  }
  for (const s of c.subjects) drawSubject(f, p, s, isCurrent);
}

function drawDomain(f: FrameInput, p: Projector, d: DomainNode): void {
  const { ctx, theme, width, viewport, camera } = f;
  const [dx, dy, m] = applyLens(f.lens, p.sx(d.x), p.sy(d.y));
  const dr = d.r * camera.k * m;
  if (dx + dr < -140 || dx - dr > width + 140 || dy + dr < -140 || dy - dr > viewport.y1 + 140) return;

  const dimmed = f.domain != null && f.domain !== d;
  ctx.globalAlpha = dimmed ? 0.2 : 1;
  const g = ctx.createRadialGradient(dx, dy, dr * 0.1, dx, dy, dr);
  g.addColorStop(0, theme.domainGlow);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(dx, dy, dr, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = theme.hair;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(dx, dy, dr, 0, TAU);
  ctx.stroke();
  // At sky altitude every domain is a child of the field.
  if (f.altitude === 'sky') pickChild(f, dx, dy, dr, d);
  else f.picks.push({ x: dx, y: dy, r: dr, node: d });
  drawRimArc(f, d, dx, dy, dr);

  if (f.altitude === 'sky' && !dimmed) {
    // The lens stands in the same label queue as the field: where it sits on a
    // caption, the caption stands down rather than being overprinted.
    const shadowed = lensShadows(f.lens, dx, dy + dr + 31);
    drawSkyStars(f, p, d);
    ctx.globalAlpha = f.thread ? 0.55 : 1;
    f.labels.push({
      x: dx,
      y: dy + dr + 22,
      text: `${d.rank}. ${d.title}`,
      size: Math.max(CHILD_LABEL_PX, Math.min(22, dr * 0.14)),
      color: f.hover === d ? theme.accent : theme.ink1,
      weight: 660,
      align: 'center',
      priority: shadowed ? 6 : P_CHILD,
    });
    if (!shadowed) {
      f.labels.push({
        x: dx,
        y: dy + dr + 40,
        text: f.captions.domainCaption(d),
        size: 13,
        color: theme.ink4,
        weight: 600,
        align: 'center',
        priority: 3,
      });
    }
    ctx.globalAlpha = 1;
    return;
  }
  for (const c of d.categories) drawCategory(f, p, c, dimmed);
  ctx.globalAlpha = 1;
}

/** The dashed curve that ties one council's stars together. */
function drawThreads(f: FrameInput, p: Projector, thread: Set<string>): void {
  const { ctx, theme } = f;
  const pts = [...thread].map((slug) => f.layout.bySlug.get(slug)).filter((s): s is SubjectNode => Boolean(s));
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const [x, y] = applyLens(f.lens, p.sx(pt.x), p.sy(pt.y));
    if (i === 0) {
      ctx.moveTo(x, y);
      return;
    }
    const prev = pts[i - 1];
    if (!prev) return;
    const [qx, qy] = applyLens(f.lens, p.sx(prev.x), p.sy(prev.y));
    const mx = (qx + x) / 2;
    const my = (qy + y) / 2;
    const dx = x - qx;
    const dy = y - qy;
    const n = Math.hypot(dx, dy) || 1;
    ctx.quadraticCurveTo(mx - (dy / n) * 26, my + (dx / n) * 26, x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawLensCircle(f: FrameInput): void {
  const { ctx, theme, lens } = f;
  if (!lens.on || lens.x === null || lens.y === null) return;
  ctx.save();
  const g = ctx.createRadialGradient(lens.x, lens.y, 0, lens.x, lens.y, LENS_R);
  g.addColorStop(0, theme.lensFill);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, LENS_R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, LENS_R, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(lens.x, lens.y, LENS_R + 3.5, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Paint one frame. Returns how many labels the occupancy pass had to drop. */
export function paintFrame(f: FrameInput): number {
  const { ctx, theme, width, height } = f;
  ctx.fillStyle = theme.sky;
  ctx.fillRect(0, 0, width, height);
  f.labels.reset();
  f.picks.length = 0;
  const p = projector(f.camera, f.viewport);
  drawDust(f, p);
  for (const d of f.layout.domains) drawDomain(f, p, d);
  if (f.thread) drawThreads(f, p, f.thread);
  drawLensCircle(f);
  // The label pass mints the last picks: a title is only clickable once it
  // has actually been PLACED, which nothing but the occupancy pass knows.
  return f.labels.flush(ctx, theme, width, f.viewport.y1, f.reserved, f.picks);
}
