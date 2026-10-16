// A lens on the drawing, from its manifest alone (PORTED from bp src/variants/subtle/expression.ts, the expression
// bp's index page draws, and bp src/lib/model/lens.ts lensContent / fieldPart / lensAggregate). General: one slot per
// enabled lens along a fixture's top edge, each a glyph in its health colour and a short rail in the lens's line type
// measuring `presentation.measures`. A lone lens: its glyph at the head of the strip and its line type laid across
// the tile body up to the measure; on a ribbon segment the same fill. Nothing here knows a lens id.
// EDIT (port): bp tweens between General and a lens with springs; this sheet switches at once, so the expansion is
// 0 or 1 and the lerps below land on their ends. Words come from `e.words` (no English is composed here).
import type { Feature, LensDef } from '../standard/load';
import type { Health, Scalar } from '../standard/types';
import type { LensField } from '../standard/types';
import { EVIDENCE_BY_DENSITY, reasonOf } from '../standard/present';
import { clamp } from './camera';
import type { CanvasTheme } from './theme';
import { glyph } from './glyphs';
import { healthInk, lineType, railNone, railRest } from './marks';
import { lineFill } from './patterns';
import type { EngineWords } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
/** One tile or ribbon segment's geometry, refilled per paint (bp lens/contract.ts TileGeom). */
export interface TileGeom extends Rect { form: 'tile' | 'ribbon'; u: number; k: number; strip: Rect; body: Rect; text: boolean }
/** A feature's live values (bp FeatureLive): the map's rollout and build progress, and any lens value. */
export interface FeatureLive { rolloutPct: number; progressPct: number; value(lens: string, key: string): Scalar | undefined }
export interface MarkArgs { ctx: CanvasRenderingContext2D; th: CanvasTheme; tile: TileGeom; f: Feature; d: LensDef; slot: Rect | null; r: Rect; w: number; x: number; live: FeatureLive }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const bandH = (t: TileGeom) => Math.min(t.strip.h + 2 * t.u, 9 * t.u);
const bandY = (t: TileGeom) => t.strip.y - t.u;
const GAP = 3, SIX = 6, END_W = 20;
const sixW = (t: TileGeom) => (t.strip.w - (SIX - 1) * GAP * t.u) / SIX;
const slotW = (t: TileGeom, n: number) => (n <= SIX ? sixW(t) : (t.strip.w - (n - 1) * GAP * t.u) / n);
const hasStrip = (t: TileGeom) => t.form === 'tile' && sixW(t) >= 10 * t.u;
const ribRailH = (t: TileGeom) => clamp(t.h * 0.22, 2.5, 4.5 * t.u);

/** General's slots: one per enabled lens along the top edge, in registry order (null: the tile has no strip). */
export function composeGeneral(t: TileGeom, n: number, i: number, out: Rect): Rect | null {
  if (!hasStrip(t) || !n) return null;
  const sw = slotW(t, n), g = GAP * t.u, h = bandH(t);
  out.x = t.strip.x + i * (sw + g); out.y = bandY(t); out.w = sw; out.h = h;
  return out;
}
export function expandedRect(t: TileGeom, out: Rect): Rect {
  if (t.form === 'tile') { out.x = t.strip.x; out.y = bandY(t); out.w = t.strip.w; out.h = bandH(t); }
  else { const h = ribRailH(t); out.x = t.body.x + 1; out.y = t.body.y + t.body.h - h; out.w = Math.max(0, t.body.w - 2); out.h = h; }
  return out;
}

/** 0..1 along a lens line; null when the value cannot be placed (bp lib/standard/present.ts lensLine). */
function lensLine(field: LensField | null, value: Scalar | undefined, fallbackMax?: number): number | null {
  if (!field || value === undefined) return null;
  // An exhaustive switch over the declaration's own FieldType union (bp wrote an if-chain over literals): a field
  // type the standard adds fails to compile here instead of falling silently into the last arm.
  switch (field.type) {
    case 'enum': {
      if (typeof value !== 'string') return null;
      const i = field.values.indexOf(value);
      return i < 0 ? null : field.values.length > 1 ? i / (field.values.length - 1) : 1;
    }
    case 'number': case 'integer': case 'percent': case 'money': {
      if (typeof value !== 'number' || Number.isNaN(value)) return null;
      const max = field.max ?? (field.type === 'percent' ? 100 : fallbackMax);
      if (max === undefined || !(max > 0)) return null;
      const min = field.min ?? 0;
      return clamp((value - min) / (max - min || 1), 0, 1);
    }
    case 'boolean': case 'string': case 'date': return null;
    default: { const never: never = field; return never; }
  }
}
const hotHealth = (fl: { h: Health; whyFields: readonly string[] }, key: string): boolean => (fl.h === 'bad' || fl.h === 'watch') && fl.whyFields.includes(key);
/** The field a rail end counts in dots: the first plain count that is not the measured field (standard and dense readers). */
/** The field types a rail end may count in dots (bp: integer only). */
const DOT_COUNT_TYPES: ReadonlySet<LensField['type']> = new Set(['integer']);
const countField = (d: LensDef): LensField | null =>
  d.density === 'simple' ? null : d.evidence.find((f) => DOT_COUNT_TYPES.has(f.type) && f.min === 0 && f.max === undefined && !f.unit && !f.source && f !== d.measures) ?? null;
const measure = (d: LensDef, live: FeatureLive): number => (d.measures ? lensLine(d.measures, live.value(d.id, d.measures.key), d.measureMax) ?? -1 : -1);

function dots(a: MarkArgs, x1: number, cy: number, n: number, hot: number, col: string, hotCol: string): void {
  const { ctx } = a, u = a.tile.u, r = Math.max(1.3, 1.5 * u), sp = 4.6 * u, more = n > 4, shown = more ? 3 : n;
  for (let i = 0; i < shown; i++) { ctx.fillStyle = i < hot ? hotCol : col; ctx.beginPath(); ctx.arc(x1 - r - i * sp, cy, r, 0, 6.2832); ctx.fill(); }
  if (more) {
    const px = x1 - r - 3 * sp, arm = Math.max(1, r * 0.55), t = Math.max(1, Math.round(u * 0.9));
    ctx.fillStyle = hot > 3 ? hotCol : col; ctx.fillRect(px - arm - t / 2, cy - t / 2, 2 * arm + t, t); ctx.fillRect(px - t / 2, cy - arm - t / 2, t, 2 * arm + t);
  }
}

function drawTile(a: MarkArgs): void {
  const { ctx, th, tile: t, f, d } = a, u = t.u, fl = f.lens[d.id], h: Health = fl ? fl.h : 'unmeasured', e = smooth(a.x);
  const H = bandH(t), slot = a.slot, sx = slot ? slot.x : t.strip.x, sW = slot ? slot.w : t.strip.w;
  const rx = lerp(sx, t.strip.x, e), rw = lerp(sW, t.strip.w, e), lift = (1 - a.w) * 3 * u;
  const gs = Math.max(6, lerp(Math.min(H - u, sW * 0.5, 8 * u), Math.min(H, 9 * u), e) * lerp(0.55, 1, a.w));
  const cy = bandY(t) + H / 2 - lift, gy = cy - gs / 2, ga = ctx.globalAlpha * a.w, m = measure(d, a.live);
  if (m > 0 && e > 0.004) {
    const b = t.body, top = bandY(t) + H, fh = b.y + b.h - top, fw = b.w * Math.min(1, m);
    if (fh >= 2) {
      lineFill(ctx, th, d.line, b.x, top, fw, fh, u, ga * e);
      if (m < 1 && fw >= 1) { ctx.globalAlpha = ga * e; ctx.fillStyle = th.inkA(0.55); ctx.fillRect(Math.round(b.x + fw) - 1, top, 1, fh); }
    }
  }
  ctx.globalAlpha = ga;
  glyph(ctx, d.glyph, rx, gy, gs, healthInk(th, h, true));
  if (e > 0.01 && t.text && t.w >= 250 * u && t.h >= 120 * u) {
    const ws = Math.min(t.h * 0.24, 30 * u);
    ctx.globalAlpha = ga * e * (th.mode === 'dark' ? 0.3 : 0.24);
    glyph(ctx, d.glyph, t.x + t.w - 16 * u - ws, t.y + t.h * 0.6 - ws / 2, ws, th.ink);
    ctx.globalAlpha = ga;
  }
  const cf = countField(d), x0 = rx + gs + 3 * u, endW = cf ? END_W * u * smooth((a.x - 0.4) / 0.6) : 0, x1 = rx + rw - endW - (endW ? 3 * u : 0);
  if (x1 - x0 < 3 * u) return;
  const railA = m < 0 && h !== 'unmeasured' && h !== 'na' ? 1 : 1 - e;
  if (railA > 0.004) {
    const rh = lerp(Math.min(3 * u, H * 0.4), Math.min(5 * u, H * 0.62), e), ry = cy - rh / 2, len = m > 0 ? (x1 - x0) * Math.min(1, m) : 0;
    ctx.globalAlpha = ga * lerp(0.6, 1, e) * railA;
    if (m < 0) railNone(ctx, th, x0, x1, ry, rh, u); else railRest(ctx, th, x0 + len, x1, ry, rh);
    if (len > 0) lineType(ctx, th, d.line, x0, ry, len, rh, th.inkA(0.92), u);
  }
  if (endW > 0.5 && cf && fl) {
    const n = a.live.value(d.id, cf.key);
    if (typeof n === 'number' && n > 0) { ctx.globalAlpha = ga * smooth((a.x - 0.5) / 0.5); dots(a, rx + rw, cy, n, hotHealth(fl, cf.key) ? n : 0, th.inkA(0.85), healthInk(th, fl.h, true)); }
  }
}

function drawRibbon(a: MarkArgs): void {
  const { ctx, th, tile: t, f, d, r } = a, u = t.u;
  if (r.w < 3 || a.w < 0.02) return;
  const e = smooth(a.x), h = f.lens[d.id]?.h ?? 'unmeasured', m = measure(d, a.live);
  ctx.globalAlpha *= a.w;
  if (m < 0) { if (h !== 'unmeasured' && h !== 'na') railNone(ctx, th, r.x, r.x + r.w * e, r.y, r.h, u); }
  else if (m > 0) {
    const b = t.body, fw = b.w * e * Math.min(1, m);
    lineFill(ctx, th, d.line, b.x, b.y, fw, b.h, u, ctx.globalAlpha);
    if (m < 1 && fw >= 1) { ctx.fillStyle = th.inkA(0.55); ctx.fillRect(Math.round(b.x + fw) - 1, b.y, 1, b.h); }
  }
  // bp draws the lens glyph on an unwell segment only when trouble flags are off (?flags=0); here they are always on
}

/** A lens's marks on one tile or ribbon segment (bp manifestChannel.marks). */
export function lensMarks(a: MarkArgs): void {
  if (!a.f.stage || a.w < 0.03) return;
  if (a.tile.form === 'tile') drawTile(a); else drawRibbon(a);
}

// ------------------------------------------------------------------------------- words (bp lib/model/lens.ts)
const shortLabel = (f: LensField) => f.label.replace(/\s*\([^)]*\)/g, '');
const rnd = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10);
function money(W: EngineWords, f: LensField, v: number): string {
  const n = W.num(Math.round(v)), cur = 'currency' in f ? f.currency : '';
  return cur === 'USD' ? '$' + n : n + (cur ? ' ' + cur : '');
}
/** A value as a short evidence part for a tile header (mono, uppercase). */
function fieldPart(W: EngineWords, f: LensField, v: Scalar | undefined): string {
  const L = shortLabel(f).toUpperCase();
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? L : W.fieldNo(L).toUpperCase();
  switch (f.type) {
    case 'date': return typeof v === 'string' ? L + ' ' + v.slice(5) : '';
    case 'percent': return typeof v === 'number' ? L + ' ' + W.pct(rnd(v)) : '';
    case 'money': return typeof v === 'number' ? L + ' ' + money(W, f, v) : '';
    case 'enum': case 'string': case 'number': case 'integer':
      if (typeof v === 'string') return v.replace(/-/g, ' ').toUpperCase();
      return L + ' ' + W.num(rnd(v)) + (f.unit ? f.unit.toUpperCase() : '');
    case 'boolean': return typeof v === 'string' ? v.replace(/-/g, ' ').toUpperCase() : L + ' ' + W.num(rnd(v));
    default: { const never: never = f; return never; }
  }
}
/** The words a tile says under a lens: evidence parts; the stamp is the reason when the lens is unwell. */
export function lensContent(W: EngineWords, d: LensDef, f: Feature, live: FeatureLive): { parts: string[]; stamp?: string } {
  const fl = f.lens[d.id];
  if (!fl) return { parts: [] };
  const parts: string[] = [];
  for (const fd of d.evidence.slice(0, EVIDENCE_BY_DENSITY[d.density])) { const p = fieldPart(W, fd, live.value(d.id, fd.key)); if (p) parts.push(p); }
  if (!parts.length) return { parts: [W.verdict(fl.h).toUpperCase()] };
  return { parts: parts.slice(0, EVIDENCE_BY_DENSITY[d.density]), stamp: fl.h === 'bad' || fl.h === 'watch' ? reasonOf(fl) ?? undefined : undefined };
}
