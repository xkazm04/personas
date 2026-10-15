// Canvas colours from the page's own tokens. The drawing's ink is `--bp-*` (blueprint.css), DERIVED from the app's
// tokens, so the canvas and the DOM can never disagree. A token is resolved through a probe element: the browser
// computes `color-mix()` itself. It reports a mixed colour as `color(srgb r g b / a)`, not `rgb()`, so
// `parseColor` reads both; a parser that knew only `rgb()` painted every alpha'd ink pale grey in the light theme.

/** The tokens the canvas draws with, by the name in the stylesheet (`--bp-<name>`). */
const TOKENS = ['live', 'build', 'dep', 'paper', 'ink', 'ink-hi', 'halo', 'accent', 'mint', 'amber', 'amber-2', 'red', 'red-2', 'delta', 'glyph-edge', 'label-bg', 'tile-base', 'poche', 'focus', 'grid'] as const;
type TokenName = (typeof TOKENS)[number];
type CamelToken = 'live' | 'build' | 'dep' | 'paper' | 'ink' | 'inkHi' | 'halo' | 'accent' | 'mint' | 'amber' | 'amber2' | 'red' | 'red2' | 'delta' | 'glyphEdge' | 'labelBg' | 'tileBase' | 'poche' | 'focus' | 'grid';

export type PatternKind = 'diag' | 'cross' | 'q';

export interface CanvasTheme extends Record<CamelToken, string> {
  mode: 'dark' | 'light';
  radius: number;
  glow: number;
  sans: string;
  mono: string;
  alpha(col: string, a: number): string;
  inkA(a: number): string;
  pattern(kind: PatternKind, size: number, color: string, lw?: number, bg?: string): CanvasPattern | null;
}

export function parseColor(c: string): [number, number, number, number] {
  const q = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+))?\)/.exec(c);
  if (q) return [Math.round(+q[1]! * 255), Math.round(+q[2]! * 255), Math.round(+q[3]! * 255), q[4] == null ? 1 : +q[4]];
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]; }
  return [200, 220, 240, 1];
}

const camel = (n: TokenName): CamelToken => n.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) as CamelToken;

export function readTheme(host: HTMLElement): CanvasTheme {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  host.appendChild(probe);
  const colors = {} as Record<CamelToken, string>;
  for (const n of TOKENS) { probe.style.color = `var(--bp-${n})`; colors[camel(n)] = getComputedStyle(probe).color; }
  const cs = getComputedStyle(host);
  host.removeChild(probe);
  const cache = new Map<string, string>();
  const pats = new Map<string, CanvasPattern | null>();
  const sans = cs.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif';
  const th: CanvasTheme = {
    ...colors,
    mode: document.documentElement.getAttribute('data-theme')?.startsWith('light') ? 'light' : 'dark',
    radius: parseFloat(cs.getPropertyValue('--bp-radius')) || 0,
    glow: parseFloat(cs.getPropertyValue('--bp-glow')) || 0,
    sans, mono: cs.getPropertyValue('--font-mono').trim() || 'Consolas, monospace',
    alpha(col, a) {
      const key = col + '|' + Math.round(a * 1000);
      let s = cache.get(key);
      if (!s) { const p = parseColor(col); s = `rgba(${p[0]},${p[1]},${p[2]},${(p[3] * a).toFixed(3)})`; cache.set(key, s); }
      return s;
    },
    inkA(a) { return th.alpha(th.ink, a); },
    pattern(kind, size, color, lw, bg) {
      const key = kind + size + color + lw + bg;
      if (pats.has(key)) return pats.get(key) ?? null;
      const r = window.devicePixelRatio || 1, c = document.createElement('canvas');
      c.width = c.height = Math.max(1, Math.round(size * r));
      const g = c.getContext('2d');
      if (!g) { pats.set(key, null); return null; }
      g.scale(r, r);
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
      g.strokeStyle = color; g.lineWidth = lw || 1;
      const diag = (dir: 1 | -1) => {
        g.beginPath();
        if (dir < 0) { g.moveTo(0, 0); g.lineTo(size, size); g.moveTo(-1, size - 1); g.lineTo(1, size + 1); g.moveTo(size - 1, -1); g.lineTo(size + 1, 1); }
        else { g.moveTo(0, size); g.lineTo(size, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(size - 1, size + 1); g.lineTo(size + 1, size - 1); }
        g.stroke();
      };
      if (kind === 'diag') diag(1);
      else if (kind === 'cross') { diag(1); diag(-1); }
      else { g.fillStyle = color; g.font = `600 ${size * 0.42}px ${sans}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', size * 0.25, size * 0.27); g.fillText('?', size * 0.75, size * 0.77); }
      const p = g.createPattern(c, 'repeat');
      if (p && p.setTransform) p.setTransform(new DOMMatrix([1 / r, 0, 0, 1 / r, 0, 0]));
      pats.set(key, p);
      return p;
    },
  };
  return th;
}
