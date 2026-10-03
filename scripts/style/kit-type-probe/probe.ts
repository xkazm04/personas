// Browser half of scripts/style/kit-type-probe/run.mjs.
//
// The question it answers, which the owner raised on 2026-10-03: "Kit typography
// does not reflect font size from appearance setting, overall is too small
// comparing to existing app fonts". Both halves are measurable, so measure them
// rather than reasoning from the CSS:
//   does a .typo-* token inside .k-host still scale with --type-f (the appearance
//   setting's text scale), and how far below the app's own size does the compact
//   tier sit?
import '@/styles/globals.css';
import '@/features/shared/components/kit/kit.css';

const TOKENS = [
  'typo-body', 'typo-caption', 'typo-title', 'typo-label', 'typo-data',
  'typo-section-title', 'typo-body-lg', 'typo-heading', 'typo-card-label',
] as const;

/** The five values the appearance setting writes to data-text-scale. */
const SCALES = ['compact', 'default', 'large', 'larger', 'xl'] as const;

type Host = 'app' | 'kit' | 'kit-compact';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function px(el: Element): number {
  return parseFloat(getComputedStyle(el).fontSize);
}

async function run() {
  const root = document.getElementById('probe') as HTMLElement;
  // Three hosts, side by side, each carrying the same token spans.
  root.innerHTML = `
    <div data-host="app"></div>
    <div class="k-host" data-host="kit"></div>
    <div class="k-host" data-type-density="compact" data-host="kit-compact"></div>`;
  for (const host of ['app', 'kit', 'kit-compact'] as Host[]) {
    const h = root.querySelector(`[data-host="${host}"]`) as HTMLElement;
    h.innerHTML = TOKENS.map((t) => `<span class="${t}" data-token="${t}">Ag</span>`).join('');
  }

  const out: Record<string, Record<string, Record<Host, number>>> = {};
  const html = document.documentElement;
  for (const scale of SCALES) {
    html.setAttribute('data-text-scale', scale);
    await frame(); await frame();
    out[scale] = {};
    for (const t of TOKENS) {
      out[scale][t] = {
        app: px(root.querySelector(`[data-host="app"] [data-token="${t}"]`)!),
        kit: px(root.querySelector(`[data-host="kit"] [data-token="${t}"]`)!),
        'kit-compact': px(root.querySelector(`[data-host="kit-compact"] [data-token="${t}"]`)!),
      };
    }
  }
  // The root font-size the scale ramp multiplies, for context.
  const rootPx: Record<string, number> = {};
  for (const scale of SCALES) {
    html.setAttribute('data-text-scale', scale);
    await frame();
    rootPx[scale] = parseFloat(getComputedStyle(html).fontSize);
  }
  return { tokens: TOKENS, scales: SCALES, rootPx, out };
}

(window as unknown as { __kitTypeProbe: typeof run }).__kitTypeProbe = run;
