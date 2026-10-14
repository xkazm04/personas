/**
 * The Dial's canvas colours, read once from the app's tokens (so every theme drives it).
 *
 * A canvas cannot take `var(--x)`, so each token is resolved through a probe element and a 1x1
 * canvas (which also flattens `color-mix` and any wide-gamut computed value into rgb). Resolved
 * again only when the theme changes; nothing here runs per frame.
 */
export interface Rgb { r: number; g: number; b: number }

export const PHASE_TINT: Record<string, string> = {
  brief: '--color-role-external',
  explore: '--color-brand-purple',
  edit: '--color-brand-emerald',
  verify: '--color-muted-foreground',
  ship: '--color-accent',
};
export const tintVar = (keys: string[]) => PHASE_TINT[keys[0] ?? ''] ?? '--color-accent';

export interface Palette {
  accent: Rgb; err: Rgb; warn: Rgb; quiet: Rgb; fg: Rgb; mf: Rgb;
  phase: Record<string, Rgb>;
  glow: { accent: HTMLCanvasElement; err: HTMLCanvasElement; warn: HTMLCanvasElement; quiet: HTMLCanvasElement };
}

export const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

function glowSprite(c: Rgb): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  if (!g) return s;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(c, 1));
  gr.addColorStop(0.22, rgba(c, 0.5));
  gr.addColorStop(0.55, rgba(c, 0.12));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return s;
}

export function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  const dom = document.createElement('span');
  dom.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  host.appendChild(dom);
  const rgb = (token: string): Rgb => {
    dom.style.color = `var(${token})`;
    const computed = getComputedStyle(dom).color;
    if (!pc) return { r: 128, g: 128, b: 128 };
    pc.clearRect(0, 0, 1, 1);
    pc.fillStyle = 'black';
    pc.fillStyle = computed;
    pc.fillRect(0, 0, 1, 1);
    const d = pc.getImageData(0, 0, 1, 1).data;
    return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 };
  };
  const accent = rgb('--color-accent');
  const err = rgb('--color-status-error');
  const warn = rgb('--color-status-warning');
  const quiet = rgb('--color-status-neutral');
  const phase: Record<string, Rgb> = {};
  for (const k of Object.keys(PHASE_TINT)) phase[k] = rgb(PHASE_TINT[k]!);
  const pal: Palette = {
    accent, err, warn, quiet,
    fg: rgb('--color-foreground'),
    mf: rgb('--color-muted-foreground'),
    phase,
    glow: { accent: glowSprite(accent), err: glowSprite(err), warn: glowSprite(warn), quiet: glowSprite(quiet) },
  };
  dom.remove();
  return pal;
}
