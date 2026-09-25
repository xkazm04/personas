// The Chromium probe behind migration-map.md's dry run. For every
// (typo-* token, utility) pair measure.mjs found written together, it renders
// three spans against the app's real stylesheet:
//   e0  token alone            what the token gives
//   e1  token + utility        what the call site renders TODAY
//   eu  utility alone          what the utility gives once it can win
// A pair is DEAD when the token sets the property (so the cascade drops the
// utility in every context) and e1 equals e0 here. A dead pair is ORDER
// SENSITIVE when eu differs from e0: moving typography.css into a layer
// before the codemod deletes the utility would change what the site renders.
//
// Reference context: default theme, default text scale ("larger"), English.
import '@/styles/globals.css';

interface Pair { token: string; utility: string; family: string; tokenSetsIt: boolean; sites: string[]; siteCount: number; importantSites: number; variantSites: number }

const PROP: Record<string, keyof CSSStyleDeclaration> = {
  size: 'fontSize', weight: 'fontWeight', leading: 'lineHeight', tracking: 'letterSpacing',
  colour: 'color', family: 'fontFamily', numeric: 'fontVariantNumeric',
};

const canvas = document.createElement('canvas').getContext('2d');
function rgb(colour: string): [number, number, number] {
  if (!canvas) return [0, 0, 0];
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000';
  canvas.fillStyle = colour;
  canvas.fillRect(0, 0, 1, 1);
  const d = canvas.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}
/** A computed length in px. `normal` letter-spacing is 0; `normal` line-height
 *  is taken as 1.2em, Chromium's usual value for these faces. */
const px = (v: string, size: number, isLeading = false) =>
  v === 'normal' ? (isLeading ? 1.2 * size : 0) : v.endsWith('px') ? parseFloat(v) : parseFloat(v) * size;

/** Effect size, in rough "px of visible change". A heuristic for ranking, stated
 *  in migration-map.md: size 1:1, weight 2 per 100, leading 0.5 per px,
 *  tracking 4 per px, colour 10 per unit of normalised RGB distance. */
function magnitude(family: string, a: string, b: string, fontPx: number): number {
  if (a === b) return 0;
  switch (family) {
    case 'size': return Math.abs(parseFloat(a) - parseFloat(b));
    case 'weight': return (Math.abs(Number(a) - Number(b)) / 100) * 2;
    case 'leading': return Math.abs(px(a, fontPx, true) - px(b, fontPx, true)) * 0.5;
    case 'tracking': return Math.abs(px(a, fontPx) - px(b, fontPx)) * 4;
    case 'colour': {
      const [x, y] = [rgb(a), rgb(b)];
      return (Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 441.7) * 10;
    }
    case 'family': return 5;
    default: return 0.5;
  }
}

async function run() {
  const html = document.documentElement;
  html.setAttribute('data-text-scale', 'larger');
  html.setAttribute('lang', 'en');
  html.setAttribute('data-lang', 'en');
  // <html> has `transition: font-size 150ms`; measure only after it settles.
  html.style.transition = 'none';
  await new Promise((r) => setTimeout(r, 400));
  const pairs: Pair[] = await (await fetch('./pairs.generated.json')).json();
  const host = document.getElementById('probe') as HTMLElement;
  host.style.color = 'var(--foreground)';
  const out = [];
  for (const p of pairs) {
    const prop = PROP[p.family];
    if (!prop) continue;
    const box = document.createElement('div');
    const mk = (cls: string) => { const s = document.createElement('span'); s.className = cls; s.textContent = 'Invoice Reconciler 1,284'; box.appendChild(s); return s; };
    const e0 = mk(p.token);
    const e1 = mk(`${p.token} ${p.utility}`);
    const eu = mk(p.utility);
    host.appendChild(box);
    // em-relative utilities (leading-none, tracking-[0.35em]) must be measured
    // at the size the token gives the site, not at the inherited size.
    if (p.family === 'leading' || p.family === 'tracking') eu.style.fontSize = getComputedStyle(e0).fontSize;
    const c0 = getComputedStyle(e0); const c1 = getComputedStyle(e1); const cu = getComputedStyle(eu);
    const v0 = String(c0[prop]); const v1 = String(c1[prop]); const vu = String(cu[prop]);
    const deadNow = p.tokenSetsIt && v0 === v1;
    const effect = deadNow ? magnitude(p.family, v0, vu, parseFloat(c0.fontSize)) : 0;
    out.push({
      token: p.token, utility: p.utility, family: p.family, tokenSetsIt: p.tokenSetsIt,
      sites: p.siteCount, importantSites: p.importantSites, variantSites: p.variantSites,
      today: v1, tokenAlone: v0, utilityAlone: vu,
      deadNow, orderSensitive: deadNow && effect > 0, effect: Math.round(effect * 100) / 100,
      liveNow: !p.tokenSetsIt ? 'token does not set it' : v0 !== v1 ? 'utility wins today' : null,
    });
    host.removeChild(box);
  }
  (window as unknown as { __probe: unknown }).__probe = {
    context: { theme: 'dark-midnight', textScale: 'larger', rootFontSize: getComputedStyle(html).fontSize },
    pairs: out, done: true,
  };
  host.textContent = `probed ${out.length} pairs`;
}

void run();
