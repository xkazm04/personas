// The legend's specimens, drawn by the plan's own engine functions on small canvases (bp Legend.tsx Specimen /
// FlagSpecimen and the subtle legend's Swatch / TileSwatch): what the key shows is exactly what the plan draws, in the
// theme of the moment. Every function comes from ../../engine read-only; the live engine lends its words and fonts
// (flags, pins) with this canvas's theme read fresh.
import { useEffect, useRef } from 'react';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useSheet } from '../../controller/SheetContext';
import type { Engine } from '../../engine/Engine';
import { drawFlags } from '../../engine/flags';
import { glyph, glyphPin, stageFill, stageStroke } from '../../engine/glyphs';
import { lensMarks, type TileGeom } from '../../engine/lens';
import { lineType, railRest } from '../../engine/marks';
import { lineFill, unknownFill } from '../../engine/patterns';
import { readTheme, type CanvasTheme } from '../../engine/theme';
import { healthMarks } from '../../engine/tiles';
import type { Feature, LensDef, Stage } from '../../standard/load';

type Draw = (ctx: CanvasRenderingContext2D, th: CanvasTheme, e: Engine | null) => void;

/** One theme read per sheet, resolution and theme mode: a legend draws dozens of specimens, and each read walks every token. */
const THEMES = new WeakMap<Element, Map<string, CanvasTheme>>();
function themeOf(host: HTMLElement, dpr: number, dark: boolean): CanvasTheme {
  const root = host.closest('.bp-scope') ?? host, key = dpr + '|' + dark;
  let m = THEMES.get(root);
  if (!m) THEMES.set(root, (m = new Map()));
  let th = m.get(key);
  if (!th) m.set(key, (th = readTheme(host, dpr)));
  return th;
}

/** One specimen canvas, w x h CSS px, redrawn when the theme or what it draws (`sig`) changes. */
function Specimen({ w, h, draw, sig }: { w: number; h: number; draw: Draw; sig: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useSheet().engine, dark = useIsDarkTheme();
  // `draw` is a fresh closure each render; `sig` names what it reads
  const paint = useRef(draw);
  paint.current = draw;
  useEffect(() => {
    const cv = ref.current, host = cv?.parentElement; if (!cv || !host) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const th = themeOf(host, dpr, dark);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    // the live engine with this theme read fresh (its fonts and words stay its own)
    const e = engine ? (Object.create(engine, { th: { value: th } }) as Engine) : null;
    paint.current(ctx, th, e);
  }, [w, h, engine, dark, sig]);
  return <canvas ref={ref} className="lg-cv" style={{ width: w, height: h }} aria-hidden="true" />;
}

/** A stage swatch: the plan's own base fill and outline for a tile in that stage. */
export function StageSwatch({ st, w = 24, h = 15 }: { st: Stage | null; w?: number; h?: number }) {
  return <Specimen w={w + 2} h={h + 2} sig={String(st)} draw={(ctx, th) => {
    ctx.fillStyle = th.tileBase; ctx.fillRect(1, 1, w, h);
    stageFill(ctx, th, st, 1, 1, w, h, 45, 60);
    stageStroke(ctx, th, st, 1, 1.3); ctx.strokeRect(1.5, 1.5, w - 1, h - 1); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }} />;
}

/** The trouble marks a tile carries: the cloud (bad), the tick (watch), and the ribbon's trouble bar at L0 and L1. */
export function HealthSpecimen({ k }: { k: 'cloud' | 'tick' | 'bar' }) {
  return <Specimen w={32} h={22} sig={k} draw={(ctx, th, e) => {
    const x = 4, y = k === 'bar' ? 9 : 8, w = 24, hh = k === 'bar' ? 9 : 10;
    ctx.fillStyle = th.inkA(k === 'bar' ? 0.3 : 0.08); ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = th.inkA(0.5); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    if (e) healthMarks(e, ctx, k === 'tick' ? 'watch' : 'bad', x, y, w, hh, k === 'bar', 1);
  }} />;
}

/** A finding's pennant over its fixture: waiting (amber, red at high risk) or approved and not built (mint, a check). */
export function PinSpecimen({ state }: { state: 'med' | 'high' | 'ok' }) {
  return <Specimen w={26} h={24} sig={state} draw={(ctx, th, e) => {
    glyphPin(ctx, th, 8, 22, state, true, 0.9, 0, 0, e ? e.tx.f(12, 600, true) : '600 12px ' + th.mono);
  }} />;
}

/** A trouble flag drawn by the canvas's own drawFlags (the first lens's glyph; `count` > 1 adds the cluster tag). */
export function FlagSpecimen({ bad, count }: { bad: boolean; count: number }) {
  const lens = useSheet().plan.lenses[0]?.id ?? '';
  return <Specimen w={40} h={40} sig={`${bad}|${count}|${lens}`} draw={(ctx, _th, e) => {
    if (!e || !lens) return;
    const s = bad ? 24 : 19, w = s * 1.1, tipX = 18, tipY = 38, ids = Array.from({ length: count }, (_, i) => 'x' + i);
    drawFlags(e, ctx, [{ x: tipX - w / 2, y: tipY - s * 0.26 - s, w, h: s, tipX, tipY, bad, lens, fid: ids[0]!, fids: ids, lenses: ids.map(() => lens) }], null);
  }} />;
}

/** The subtle key's lens row: the lens glyph, then its line type laid along the rail, `measure` of the way. */
export function LensSwatch({ d, measure = 0.7 }: { d: LensDef; measure?: number }) {
  return <Specimen w={48} h={16} sig={`${d.id}|${d.line}|${measure}`} draw={(ctx, th) => {
    const gs = 12, cy = 8;
    glyph(ctx, d.glyph, 1, cy - gs / 2, gs, th.inkA(0.9));
    const x0 = gs + 6, x1 = 46, rh = 5, len = (x1 - x0) * measure;
    railRest(ctx, th, x0 + len, x1, cy - rh / 2, rh);
    lineType(ctx, th, d.line, x0, cy - rh / 2, len, rh, th.inkA(0.92), 1);
  }} />;
}

const TW = 46, TH = 28;
/** A small fixture with the canvas's own fills: a lens fill at 62%, the "?" texture, or a tile the lens fades. */
export function LensTile({ d, kind }: { d: LensDef | null; kind: 'fill' | 'unknown' | 'faded' }) {
  return <Specimen w={TW} h={TH} sig={`${d?.id ?? ''}|${d?.line ?? ''}|${kind}`} draw={(ctx, th) => {
    ctx.globalAlpha = kind === 'faded' ? 0.35 : 1;
    ctx.fillStyle = th.tileBase; ctx.fillRect(1, 1, TW - 2, TH - 2);
    if (kind === 'unknown') unknownFill(ctx, th, 2, 2, TW - 4, TH - 4, 1, 1);
    else if (d) {
      glyph(ctx, d.glyph, 4, 3, 8, th.inkA(0.9));
      const fw = (TW - 6) * 0.62;
      lineFill(ctx, th, d.line, 3, 12, fw, TH - 15, 1, ctx.globalAlpha);
      ctx.fillStyle = th.inkA(0.55); ctx.fillRect(Math.round(3 + fw) - 1, 12, 1, TH - 15);
    }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(1.5, 1.5, TW - 3, TH - 3); ctx.globalAlpha = 1;
  }} />;
}

/** bp's lens Specimen: one sample feature drawn as a small fixture with that lens's marks alone. */
export function SampleTile({ d, f }: { d: LensDef; f: Feature }) {
  return <Specimen w={TW} h={TH} sig={`${d.id}|${f.id}`} draw={(ctx, th, e) => {
    if (!e) return;
    const x = 1, y = 1, w = TW - 2, h = TH - 2, live = e.live(f);
    const g: TileGeom = { x, y, w, h, form: 'ribbon', u: 1, k: 0.3, strip: { x, y, w, h: 3 }, body: { x: x + 1, y: y + 1, w: w - 2, h: h - 2 }, text: false };
    ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
    stageFill(ctx, th, f.stage, x, y, w, h, live.rolloutPct, live.progressPct);
    ctx.save(); lensMarks({ ctx, th, tile: g, f, d, slot: null, r: g.body, w: 1, x: 1, live, st: f.stage, now: true }); ctx.restore();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }} />;
}
