// Text measuring and drawing on the plan (PORTED from bp src/engine/text.ts, with the prototype's wrap/fit).
export interface PlanText {
  /** A canvas font string. */
  f(size: number, weight?: number, mono?: boolean): string;
  /** Width of a string in a font, with optional letter spacing. */
  w(s: string, font: string, ls?: number): number;
  /** Greedy word wrap to at most `maxLines` lines; null when it does not fit. */
  wrap(text: string, maxW: number, font: string, maxLines: number, ls?: number): string[] | null;
  /** The longest prefix of the parts joined with a middle dot that fits. */
  fit(parts: readonly string[], maxW: number, font: string): string | null;
}

export function makeText(ctx: CanvasRenderingContext2D, sans: string, mono: string): PlanText {
  const W = new Map<string, number>();
  const self: PlanText = {
    f: (size, weight = 500, isMono = false) => `${weight} ${size}px ${isMono ? mono : sans}`,
    w(s, font, ls = 0) {
      const k = font + '|' + s + '|' + ls;
      let v = W.get(k);
      if (v === undefined) { ctx.font = font; v = ctx.measureText(s).width + ls * s.length; W.set(k, v); }
      return v;
    },
    wrap(text, maxW, font, maxLines, ls) {
      if (maxW <= 0) return null;
      const words = String(text).split(/\s+/), lines: string[] = [];
      let cur = '';
      for (const word of words) {
        const t = cur ? cur + ' ' + word : word;
        if (self.w(t, font, ls) <= maxW) cur = t;
        else {
          if (!cur || self.w(word, font, ls) > maxW) return null;
          lines.push(cur); cur = word;
          if (lines.length >= maxLines) return null;
        }
      }
      if (cur) lines.push(cur);
      return lines.length <= maxLines ? lines : null;
    },
    fit(parts, maxW, font) {
      for (let n = parts.length; n >= 1; n--) { const s = parts.slice(0, n).join(' · '); if (self.w(s, font) <= maxW) return s; }
      return null;
    },
  };
  return self;
}

export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, halo?: string | null, ls = 0): void {
  ctx.font = font; ctx.letterSpacing = ls + 'px';
  if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = color; ctx.fillText(s, x, y); ctx.letterSpacing = '0px';
}
