// Browser half of scripts/style/codemod-dead-overrides.mjs.
//
// For every case { tokens, utility } and every context { theme, scale } it
// renders three spans against the app's real stylesheet and reads the computed
// type properties:
//   t   the token set alone           what the site renders once the utility is gone
//   tu  the token set + the utility   what the site renders today
//   u   the utility on a neutral host whether the utility is typographic at all
// A utility is DEAD in a context when t equals tu on every property below. The
// codemod deletes it only when it is dead in every context AND it moves at least
// one property on the neutral host somewhere (so `text-center` or an unknown
// class, which move none of these properties, are never classed as dead).
import '@/styles/globals.css';

const PROPS = [
  'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'fontFamily',
  'fontVariantNumeric', 'fontFeatureSettings', 'textShadow', 'textTransform',
] as const;

// A host whose every probed property is set to a value no utility produces, so
// a typographic utility always moves at least one of them on a child span.
const NEUTRAL = 'font-size:7px;font-weight:100;line-height:3;letter-spacing:3px;color:rgb(1,2,3);'
  + 'font-family:fantasy;font-variant-numeric:slashed-zero;text-shadow:none;text-transform:none';

interface Case { tokens: string; utility: string }
interface Context { theme: string; scale: string }

function vector(el: Element): string {
  const c = getComputedStyle(el);
  return PROPS.map((p) => String(c[p])).join('\u0001');
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function applyContext(ctx: Context): Promise<void> {
  const html = document.documentElement;
  html.style.transition = 'none';
  if (ctx.theme === 'dark-midnight') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', ctx.theme);
  html.classList.toggle('dark', !ctx.theme.startsWith('light'));
  html.setAttribute('data-text-scale', ctx.scale);
  html.setAttribute('lang', 'en');
  html.setAttribute('data-lang', 'en');
  await frame();
  await frame();
}

async function run(cases: Case[], contexts: Context[]) {
  const host = document.getElementById('probe') as HTMLElement;
  const table: string[] = [];
  const index = new Map<string, number>();
  const intern = (s: string) => {
    let i = index.get(s);
    if (i === undefined) { i = table.length; table.push(s); index.set(s, i); }
    return i;
  };
  // out[caseIndex][contextIndex] = [t, tu, uMoves ? 1 : 0]
  const out: number[][][] = cases.map(() => []);
  for (const ctx of contexts) {
    await applyContext(ctx);
    const box = document.createElement('div');
    // Every span sits in a neutral host and gets its values by INHERITANCE (every
    // probed property inherits), so a class rule on the span can still override
    // them; an inline style on the span would beat the utility and hide it. The
    // t/tu spans need the host too: under the page's own foreground a
    // `text-foreground` beside a colourless token equals what the span inherits
    // and reads as dead, when at a call site inside a muted parent it is live.
    const neutralHost = document.createElement('div');
    neutralHost.setAttribute('style', NEUTRAL);
    const mk = (parent: HTMLElement, cls: string) => {
      const s = document.createElement('span');
      if (cls) s.className = cls;
      s.textContent = 'Invoice Reconciler 1,284';
      parent.appendChild(s);
      return s;
    };
    const neutral = mk(neutralHost, '');
    const rows = cases.map((c) => ({
      t: mk(neutralHost, c.tokens), tu: mk(neutralHost, `${c.tokens} ${c.utility}`), u: mk(neutralHost, c.utility),
    }));
    box.appendChild(neutralHost);
    host.appendChild(box);
    const base = vector(neutral);
    rows.forEach((r, i) => {
      out[i]!.push([intern(vector(r.t)), intern(vector(r.tu)), vector(r.u) !== base ? 1 : 0]);
    });
    host.removeChild(box);
  }
  return { props: PROPS, table, out, rootFontSize: getComputedStyle(document.documentElement).fontSize };
}

(window as unknown as { __deadProbe: unknown }).__deadProbe = { ready: true, run };
