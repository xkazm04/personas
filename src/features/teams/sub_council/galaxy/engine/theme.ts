// The canvas has no CSS. It paints with the app's own semantic tokens, read
// once per theme flip and never guessed: there is no literal hex anywhere in
// the engine.
//
// Tokens are resolved through a PROBE element rather than
// `getPropertyValue('--token')`, because several of this app's tokens are
// `color-mix(...)` or `var(...)` chains (globals.css re-declares every status
// and brand colour under `[data-brightness=...]`). `getPropertyValue` hands
// back that unresolved text, which `ctx.fillStyle` cannot parse and silently
// ignores. Assigning the expression to a probe's `color` and reading the
// computed value gives a real `rgb()/rgba()` string in every case.
//
// Mapping (from `docs/design/council-reference/README.md` "Token mapping"):
//   --ink-1..4       -> foreground / muted-foreground / muted / muted-dark
//   --sky            -> background   (the stage IS the page in this app)
//   --panel*         -> card / secondary  (used by the HTML chrome, not here)
//   --hair / --hair-2-> card-border / border

/** Every colour the galaxy paints with, already resolved to rgb()/rgba(). */
export interface CanvasTheme {
  light: boolean;
  font: string;
  sky: string;
  ink1: string;
  ink2: string;
  ink3: string;
  ink4: string;
  hair: string;
  hair2: string;
  accent: string;
  ok: string;
  err: string;
  pend: string;
  purple: string;
  /** Derived tints the reference hard-coded as rgba literals. */
  dust: string;
  domainGlow: string;
  uncouncilled: string;
  rimTrack: string;
  lensFill: string;
}

const PROBE_ID = 'council-galaxy-token-probe';

function probeElement(): HTMLElement {
  const existing = document.getElementById(PROBE_ID);
  if (existing instanceof HTMLElement) return existing;
  const node = document.createElement('span');
  node.id = PROBE_ID;
  node.setAttribute('aria-hidden', 'true');
  node.style.position = 'fixed';
  node.style.left = '-9999px';
  node.style.top = '0';
  node.style.width = '0';
  node.style.height = '0';
  node.style.pointerEvents = 'none';
  document.body.appendChild(node);
  return node;
}

function resolveColor(probe: HTMLElement, expression: string, fallback: string): string {
  probe.style.color = fallback;
  probe.style.color = expression;
  const value = getComputedStyle(probe).color;
  return value || fallback;
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` -> the same colour at a given alpha. */
export function withAlpha(color: string, alpha: number): string {
  const nums = color.match(/-?[\d.]+/g);
  if (!nums || nums.length < 3) return color;
  const [r, g, b] = nums;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Is the app standing in one of its light themes right now? */
export function isLightTheme(): boolean {
  return (document.documentElement.dataset.theme ?? '').startsWith('light');
}

/**
 * Read the live theme. Cheap enough to call on every flip, far too expensive
 * to call per frame — the engine caches the result and re-reads only when the
 * root's `data-theme` / `data-brightness` actually changes.
 */
export function readCanvasTheme(): CanvasTheme {
  const probe = probeElement();
  const light = isLightTheme();
  const pick = (token: string, fallback: string) =>
    resolveColor(probe, `var(${token})`, fallback);

  const ink1 = pick('--foreground', light ? '#0f172a' : '#e2e8f0');
  const ink2 = pick('--muted-foreground', light ? '#3e4a5c' : '#bcc8d8');
  const ink3 = pick('--muted', light ? '#586883' : '#8c9aae');
  const ink4 = pick('--muted-dark', light ? '#7c8aa0' : '#6e7e92');
  const sky = pick('--background', light ? '#eceef2' : '#0a0e14');
  const accent = pick('--accent', light ? '#1d4ed8' : '#22d3ee');

  return {
    light,
    font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
    sky,
    ink1,
    ink2,
    ink3,
    ink4,
    hair: pick('--card-border', light ? 'rgba(15,23,42,.10)' : 'rgba(255,255,255,.10)'),
    hair2: pick('--border', light ? '#cdd5e1' : '#1e293b'),
    accent,
    ok: pick('--status-success', light ? '#047857' : '#34d399'),
    err: pick('--status-error', light ? '#be1b1b' : '#f87171'),
    pend: pick('--status-pending', light ? '#92400e' : '#fbbf24'),
    purple: pick('--brand-purple', light ? '#7c3aed' : '#a78bfa'),
    // The reference's five rgba literals, rebuilt from the same two inks so a
    // re-themed app re-tints them instead of keeping a dark-theme constant.
    dust: withAlpha(light ? ink1 : ink1, light ? 0.14 : 0.26),
    domainGlow: withAlpha(light ? ink1 : accent, light ? 0.055 : 0.085),
    uncouncilled: withAlpha(ink1, light ? 0.45 : 0.55),
    rimTrack: withAlpha(ink1, 0.1),
    lensFill: withAlpha(accent, 0.07),
  };
}
