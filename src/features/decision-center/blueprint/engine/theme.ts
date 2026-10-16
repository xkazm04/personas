// Canvas colours (PORTED from bp src/engine/theme.ts). bp reads its CSS tokens off <html>; here they are bp's own
// palette as `--bp-*` on `.bp-scope` (theme/bp-tokens.css, verbatim), resolved through a probe element inside the
// sheet so the canvas and the DOM can never disagree. The browser may report a colour as `color(srgb r g b / a)`,
// not `rgb()`, so `parseColor` reads both. Patterns are bp's: cached per theme and ANCHORED TO THE WORLD (the static
// raster moves them with the plan), never to the screen.

/** The tokens the canvas draws with, by the name in the stylesheet (`--bp-<name>`). */
const TOKENS = [
  'paper', 'paper-hi', 'ink', 'ink-hi', 'halo', 'accent', 'mint', 'mint-2', 'amber', 'amber-2', 'red', 'red-2', 'delta',
  'glyph-edge', 'label-bg', 'tile-base', 'poche', 'chip-bg', 'panel-solid',
] as const;
type TokenName = (typeof TOKENS)[number];
type CamelToken = 'paper' | 'paperHi' | 'ink' | 'inkHi' | 'halo' | 'accent' | 'mint' | 'mint2' | 'amber' | 'amber2' | 'red' | 'red2' | 'delta' | 'glyphEdge' | 'labelBg' | 'tileBase' | 'poche' | 'chipBg' | 'panelSolid';

export type PatternKind = 'diag' | 'back' | 'cross' | 'dots' | 'grid' | 'hlines' | 'vlines';
export interface PatternSpec { kind: PatternKind; size: number; color: string; lw?: number; bg?: string }

export interface CanvasTheme extends Record<CamelToken, string> {
  mode: 'dark' | 'light';
  sans: string;
  mono: string;
  /** Any colour at alpha `a` (cached string). */
  alpha(col: string, a: number): string;
  /** Ink at alpha `a` (cached string). */
  inkA(a: number): string;
  /** A cached, world-anchored hatch pattern. */
  pattern(spec: PatternSpec): CanvasPattern | null;
  /** Anchor every pattern to the screen position of the world origin (called once per raster). */
  anchor(ox: number, oy: number): void;
}

export function parseColor(c: string): [number, number, number, number] {
  const q = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+))?\)/.exec(c);
  if (q) return [Math.round(+q[1]! * 255), Math.round(+q[2]! * 255), Math.round(+q[3]! * 255), q[4] == null ? 1 : +q[4]];
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]; }
  return [223, 240, 255, 1];
}

const camel = (n: TokenName): CamelToken => n.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) as CamelToken;

/** bp's Patterns: one bitmap per spec, a `repeat` pattern re-anchored to the world origin on every raster. */
class Patterns {
  private map = new Map<string, { p: CanvasPattern; s: number; r: number }>();
  private res: number;
  constructor(res: number) { this.res = res; }
  get(spec: PatternSpec): CanvasPattern | null {
    const key = spec.kind + '|' + spec.size + '|' + spec.color + '|' + (spec.lw ?? 1) + '|' + (spec.bg ?? '');
    const hit = this.map.get(key);
    if (hit) return hit.p;
    if (typeof document === 'undefined') return null;
    const s = spec.size, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s * this.res)); c.height = c.width;
    const g = c.getContext('2d');
    if (!g) return null;
    g.scale(c.width / s, c.width / s);
    if (spec.bg) { g.fillStyle = spec.bg; g.fillRect(0, 0, s, s); }
    g.strokeStyle = spec.color; g.fillStyle = spec.color; g.lineWidth = spec.lw ?? 1;
    const diag = (dir: number) => {
      g.beginPath();
      if (dir < 0) { g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(-1, s - 1); g.lineTo(1, s + 1); g.moveTo(s - 1, -1); g.lineTo(s + 1, 1); }
      else { g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); }
      g.stroke();
    };
    if (spec.kind === 'diag') diag(1);
    else if (spec.kind === 'back') diag(-1);
    else if (spec.kind === 'cross') { diag(1); diag(-1); }
    else if (spec.kind === 'dots') { g.beginPath(); g.arc(s / 2, s / 2, (spec.lw ?? 1) * 0.9, 0, 7); g.fill(); }
    else if (spec.kind === 'grid') { g.beginPath(); g.moveTo(0, 0.5); g.lineTo(s, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, s); g.stroke(); }
    else if (spec.kind === 'hlines') { g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke(); }
    else { g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke(); }
    const p = g.createPattern(c, 'repeat');
    if (!p) return null;
    const rec = { p, s, r: c.width / s };
    this.map.set(key, rec);
    // EDIT (port): a pattern first built mid-raster takes the raster's anchor at once (bp leaves it unscaled until the next raster)
    this.place(rec);
    return p;
  }
  private ox = 0; private oy = 0;
  private place(v: { p: CanvasPattern; s: number; r: number }): void {
    if (typeof DOMMatrix === 'undefined') return;
    const s = v.s;
    v.p.setTransform?.(new DOMMatrix([1 / v.r, 0, 0, 1 / v.r, ((this.ox % s) + s) % s, ((this.oy % s) + s) % s]));
  }
  anchor(ox: number, oy: number): void {
    this.ox = ox; this.oy = oy;
    for (const v of this.map.values()) this.place(v);
  }
}

/** Read the theme under `host` (inside `.bp-scope`) at device resolution `res`. */
export function readTheme(host: HTMLElement, res = window.devicePixelRatio || 1): CanvasTheme {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  host.appendChild(probe);
  const colors = {} as Record<CamelToken, string>;
  for (const n of TOKENS) { probe.style.color = `var(--bp-${n})`; colors[camel(n)] = getComputedStyle(probe).color; }
  const cs = getComputedStyle(host);
  host.removeChild(probe);
  const [ir, ig, ib, ia] = parseColor(colors.ink);
  const inkCache = new Map<number, string>();
  const anyCache = new Map<string, Map<number, string>>();
  const pats = new Patterns(res);
  const sans = (cs.getPropertyValue('--bp-font-sans') || cs.getPropertyValue('--font-sans')).trim() || '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif';
  const mono = (cs.getPropertyValue('--bp-font-mono') || cs.getPropertyValue('--font-mono')).trim() || '"IBM Plex Mono",Consolas,monospace';
  const th: CanvasTheme = {
    ...colors,
    mode: document.documentElement.getAttribute('data-theme')?.startsWith('light') ? 'light' : 'dark',
    sans, mono,
    inkA(a) {
      const k = Math.round(a * 1000);
      let s = inkCache.get(k);
      if (!s) { s = `rgba(${ir},${ig},${ib},${(ia * k / 1000).toFixed(3)})`; inkCache.set(k, s); }
      return s;
    },
    alpha(color, a) {
      let byA = anyCache.get(color);
      if (!byA) { byA = new Map(); anyCache.set(color, byA); }
      const k = Math.round(a * 1000);
      let s = byA.get(k);
      if (!s) { const [r, g, b, a0] = parseColor(color); s = `rgba(${r},${g},${b},${(a0 * a).toFixed(3)})`; byA.set(k, s); }
      return s;
    },
    pattern: (spec) => pats.get(spec),
    anchor: (ox, oy) => pats.anchor(ox, oy),
  };
  return th;
}
