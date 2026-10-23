// Canvas text (PORTED from bp src/engine/text.ts): font strings with the 12 px floor, a width cache (each string
// measured once) and a word-wrap cache. Wrap never truncates: it returns null when the text does not fit. bp scales
// sizes by its UI factor U; the sheet's chrome is not scaled here, so U stays 1 (the floor holds either way).

import { silentCatch } from '@/lib/silentCatch';

/** Smallest canvas text size the engine will ever set, in CSS px. */
export const MIN_PX = 12;

/** Cache caps: a map that outgrows its cap is cleared (entries are cheap to measure again). */
const WC_MAX = 8000, WR_MAX = 4000;

export class PlanText {
  private wc = new Map<string, number>();
  private wr = new Map<string, string[] | null>();
  private fc = new Map<number, string>();
  private m: CanvasRenderingContext2D | null = null;
  /** Smallest font size actually used since the last reset (for the 12 px check). */
  minUsed = Infinity;
  sans: string; mono: string;
  constructor(sans: string, mono: string) { this.sans = sans; this.mono = mono; }
  setFamilies(sans: string, mono: string): void { this.sans = sans; this.mono = mono; this.clear(); }
  clear(): void { this.wc.clear(); this.wr.clear(); this.fc.clear(); }
  /** Font string, never below 12 px on screen. */
  f(sz: number, wt = 500, mono = false): string {
    const px = Math.max(MIN_PX, Math.round(sz * 10) / 10);
    if (px < this.minUsed) this.minUsed = px;
    const key = (Math.round(px * 10) * 1000 + wt) * 2 + (mono ? 1 : 0);
    let s = this.fc.get(key);
    if (s === undefined) { s = wt + ' ' + px + 'px ' + (mono ? this.mono : this.sans); this.fc.set(key, s); }
    return s;
  }
  /** Width of a string in a font, with optional letter spacing. */
  w(t: string, font: string, ls = 0): number {
    const key = font + '|' + t;
    let v = this.wc.get(key);
    if (v == null) {
      this.m ||= document.createElement('canvas').getContext('2d');
      if (!this.m) return t.length * 7 + ls * t.length;
      this.m.font = font;
      v = this.m.measureText(t).width;
      if (this.wc.size >= WC_MAX) this.wc.clear();
      this.wc.set(key, v);
    }
    return v + ls * t.length;
  }
  /** Greedy word wrap to at most `maxL` lines; null when a word or the lines do not fit. */
  wrap(text: string, maxW: number, font: string, maxL: number, ls = 0): string[] | null {
    const key = text + '|' + Math.round(maxW) + '|' + font + '|' + maxL + '|' + ls;
    if (this.wr.has(key)) return this.wr.get(key) ?? null;
    const words = text.split(' '), lines: string[] = [];
    let cur = '', ok = maxW > 0;
    for (const w of words) {
      if (this.w(w, font, ls) > maxW) ok = false;
      const t = cur ? cur + ' ' + w : w;
      if (!cur || this.w(t, font, ls) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const r = ok && lines.length <= maxL ? lines : null;
    if (this.wr.size >= WR_MAX) this.wr.clear();
    this.wr.set(key, r);
    return r;
  }
  /** Join parts with " · ", dropping trailing parts until it fits; null if even the first does not. */
  fit(parts: readonly string[], maxW: number, font: string): string | null {
    let n = parts.length;
    while (n > 1 && this.w(parts.slice(0, n).join(' · '), font) > maxW) n--;
    const s = parts.slice(0, n).join(' · ');
    return this.w(s, font) <= maxW ? s : null;
  }
}

/** Draw text with an optional halo; letter spacing in px. */
export function drawText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, font: string, col: string, halo?: string | null, ls = 0): void {
  ctx.font = font;
  if (ls) ctx.letterSpacing = ls + 'px';
  if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = halo; ctx.strokeText(t, x, y); }
  ctx.fillStyle = col; ctx.fillText(t, x, y);
  if (ls) ctx.letterSpacing = '0px';
}

/**
 * bp Engine (fonts.ready -> fontsV): when the drawing's typefaces arrive, every cached width is wrong. Asks for the
 * weights the plan draws with, and calls `onLoad` when they (or any later face) finish loading. Returns the unsubscribe.
 */
export function watchFonts(fam: { sans: string; mono: string }, onLoad: () => void): () => void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return () => undefined;
  let live = true;
  const again = () => { if (live) onLoad(); };
  Promise.all([500, 600].flatMap((w) => [fonts.load(`${w} 14px ${fam.sans}`), fonts.load(`${w} 14px ${fam.mono}`)])).then(again, silentCatch('blueprint.engine:fonts'));
  fonts.addEventListener('loadingdone', again);
  return () => { live = false; fonts.removeEventListener('loadingdone', again); };
}
