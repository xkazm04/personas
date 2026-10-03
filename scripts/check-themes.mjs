#!/usr/bin/env node
/**
 * check-themes.mjs — WCAG contrast audit for all themes.
 *
 * Parses src/styles/globals.css, extracts the :root defaults and every
 * [data-theme="..."] override block, resolves each theme's effective CSS
 * variable map (overrides layered on root), then computes contrast ratios
 * for the pairs that matter — AND, since 2026-10-03, scores every `.typo-*`
 * colour in src/styles/typography.css against the same canvases, because
 * globals.css only declares the VARIABLES and the type scale decides what
 * fraction of them a tier of text is actually painted in. Reading one and not
 * the other graded the palette and not the page: `.typo-caption`'s muting
 * moved 70% -> 80% foreground (4,292 occurrences in 1,269 files) and this gate
 * ran green without looking at it. See the "Type tokens" section.
 *
 * The pairs:
 *
 *   foreground       / background  (body text — MUST be AA, ideally AAA)
 *   muted-foreground / background  (secondary/helper text — MUST be AA)
 *   muted-foreground / background  AT the minimum caption opacity (0.8) —
 *                                  opacity-tinted captions MUST still be AA
 *   muted            / background  (dim/tertiary text — MUST be AA)
 *   primary          / background  (links, accent text, active states)
 *   status-success   / background  (semantic chip on canvas)
 *   status-error     / background
 *   status-warning   / background
 *   status-info      / background
 *   role-agent|human|external|highlight / background  (hard fail below 4.5)
 *
 * A token spelled `var(--other)` is resolved one level, so the default theme
 * (which sets --status-x: var(--status-x-raw)) is graded too.
 *
 * AA token-pairing gate (hard fail → exit 1):
 *   body, muted-foreground, muted-foreground@MIN_CAPTION_OPACITY, and muted
 *   must each clear 4.5:1 in EVERY theme. These are the text tokens that
 *   carry readable copy for non-technical users; sub-AA here is an
 *   accessibility regression, not a style preference.
 *
 * The remaining pairs (primary + status colors) stay informational warnings
 * at the 3.0:1 (AA-large / non-text-UI) threshold.
 *
 * Type-token AA gate (hard fail → exit 1, added 2026-10-03):
 *   every `.typo-*` rule in typography.css that sets `color` is resolved per
 *   theme (the file's `[data-theme*="light"]` override is matched as a second
 *   rule), composited where the value is alpha, and held to the same 4.5:1
 *   floor. Known sub-AA cells live in TYPE_TOKEN_EXEMPT with a reason, and are
 *   TWO-SIDED exactly as MONOCHROME_THEMES is: a new one fails, and an
 *   exemption whose cell has climbed back above the floor fails too. A run that
 *   parses no type tokens exits 2 rather than grading zero of them — "found
 *   nothing" and "looked at nothing" are different outcomes.
 *
 * Role distinctness gate (hard fail, added 2026-09-24, WP4c):
 *   every accent role must be told apart AT A GLANCE from every status colour
 *   (success, warning, error, info, neutral) and from every other role, in
 *   every theme: CIEDE2000 deltaE >= DISTINCT_MIN_DE00. The contrast pairs
 *   above grade each colour against a surface and never one colour against
 *   another, which is how light shipped role-highlight === status-info
 *   (deltaE 0.0) with every contrast cell green. Declared monochrome themes
 *   exempt only the pairs where BOTH colours are achromatic, and the
 *   exemption is two-sided: a declared theme that no longer needs it fails.
 *   Every run first proves the instrument (CIEDE2000 against published test
 *   data) and that the gate catches a seeded collision; `--self-check` prints
 *   those seeded cases in full, `--matrix` prints every measured distance.
 *
 * Exits 1 if ANY theme fails ANY hard-fail pairing or distinctness pair;
 * 2 if the instrument is broken; 0 otherwise.
 * Always prints a readable table; failures are highlighted.
 *
 * No external deps — pure Node. Wired into CI via `npm run check:themes`
 * (see .github/workflows/ci.yml) and runnable locally the same way.
 *
 * Caption-opacity floor: components must keep opacity-tinted muted text at
 * ≥ MIN_CAPTION_OPACITY (text-muted-foreground/80). Below that the blend
 * with the canvas drops under AA on the light themes. See
 * docs/development/contrast.md.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// CHECK_THEMES_CSS lets a test fixture point the audit at an alternate CSS file
// (e.g. a deliberately-regressed copy) without touching the real stylesheet.
const CSS_PATH = process.env.CHECK_THEMES_CSS
  ? resolve(process.env.CHECK_THEMES_CSS)
  : resolve(__dirname, '..', 'src', 'styles', 'globals.css');
// The type scale is the OTHER half of this audit's subject and was unread until
// 2026-10-03 — see the "Type tokens" section below for what that cost.
const TYPO_CSS_PATH = process.env.CHECK_THEMES_TYPO_CSS
  ? resolve(process.env.CHECK_THEMES_TYPO_CSS)
  : resolve(__dirname, '..', 'src', 'styles', 'typography.css');

// --- Contrast math --------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const norm = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  return [
    parseInt(norm.slice(0, 2), 16),
    parseInt(norm.slice(2, 4), 16),
    parseInt(norm.slice(4, 6), 16),
  ];
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

/** Alpha-composite an opaque fg over an opaque bg, returning the resulting
 *  opaque hex. Models `color: var(--token); opacity: alpha` (or the Tailwind
 *  `text-token/NN` modifier) so the audit can score opacity-tinted captions. */
function blendOver(fgHex, bgHex, alpha) {
  const f = hexToRgb(fgHex);
  const b = hexToRgb(bgHex);
  const mix = [0, 1, 2].map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// --- Colour difference (CIEDE2000) ----------------------------------------
//
// Why CIEDE2000 and not OKLab distance: it is the CIE's current standard for
// small-to-medium colour differences, and the thresholds this gate relies on
// are published in its units. OKLab is more uniform for gradients, but a
// deltaE_OK threshold would be a number with no literature behind it.
// Implementation after Sharma, Wu & Dalal (2005), sRGB (D65) -> CIELAB.

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIELAB chroma C*ab: 0 for a pure grey. */
function chroma(hex) {
  const [, a, b] = hexToLab(hex);
  return Math.hypot(a, b);
}

function deltaE2000Lab([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (x, y) => {
    if (x === 0 && y === 0) return 0;
    const v = Math.atan2(y, x) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += hbp < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

function deltaE2000(hexA, hexB) {
  return deltaE2000Lab(hexToLab(hexA), hexToLab(hexB));
}

// Six pairs from Sharma, Wu & Dalal (2005), Table 1: they exercise the hue
// wrap, the grey axis, a large difference and near-black.
const CIEDE2000_TEST_DATA = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
];

function level(ratio) {
  if (ratio >= 7.0) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3.0) return 'AA-lg';
  return 'low';
}

// --- CSS parsing ----------------------------------------------------------

/** Returns map of var-name → hex value parsed out of one CSS block. */
function parseVars(block) {
  const vars = {};
  // Match `--name: #abc...;` and `--name: rgba(...);`. We only care about
  // hex values for contrast; non-hex (rgba, color-mix, var()) get skipped.
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) {
    const name = m[1].trim();
    const raw = m[2].trim();
    // Hex (with optional alpha at end ignored for contrast calc):
    const hexMatch = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      // Truncate to 6 chars (drop alpha if present)
      const h = hexMatch[1];
      vars[name] = '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6));
    }
  }
  return vars;
}

/** Returns map of var-name -> referenced var-name for `--name: var(--target);`. */
function parseRefs(block) {
  const refs = {};
  const re = /--([a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)\s*;/gi;
  let m;
  while ((m = re.exec(block))) refs[m[1].trim()] = m[2].trim();
  return refs;
}

/** Map of var-name -> raw `color-mix(...)` value, for the palette vars that are
 *  a FRACTION of another token rather than a hex.
 *
 *  WHY: until 2026-10-03 `parseVars` kept hex only, by design and with a
 *  comment saying so ("non-hex … get skipped"). Then `--muted-foreground`
 *  became `color-mix(in srgb, var(--foreground) 80%, transparent)` — the one
 *  muting level, on a percentage basis instead of eleven hand-set hexes — and
 *  skipping it would have silently turned the TWO HARD-FAIL ROWS that grade
 *  the app's secondary text (`muted-fg/bg` and `muted-fg@80`) into `n/a`,
 *  which this script's own output code treats as `failed: false`. That is the
 *  identical failure mode the type-token section below exists to close, one
 *  file over. The resolver reads the mix; `assertHardPairsResolved` makes an
 *  unreadable one fatal rather than blank. */
function parseMixes(block) {
  const mixes = {};
  const re = /--([a-z0-9-]+)\s*:\s*(color-mix\([^;]*\))\s*;/gi;
  let m;
  while ((m = re.exec(block))) mixes[m[1].trim()] = m[2].trim().replace(/\s+/g, ' ');
  return mixes;
}

function extractBlock(css, selector) {
  // Match `<selector>` followed by optional whitespace and `{` — anchors to
  // the actual variable definition block, NOT to descendant selectors like
  // `[data-theme="light"] .titlebar-btn:hover { ... }` which appear earlier
  // in globals.css. Escape regex metacharacters in the selector first.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{', 'g');
  let braceStart = -1;
  let bestBlockSize = -1;
  let bestBlock = null;
  // There may be more than one valid match (e.g. :root appears twice — the
  // top-level palette and the brightness var block). Pick the one with the
  // most --foreground/--background/--primary declarations to land on the
  // canonical palette block.
  let m;
  while ((m = re.exec(css))) {
    braceStart = m.index + m[0].length - 1;
    let depth = 1;
    let i = braceStart + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const block = css.slice(braceStart + 1, i - 1);
    // Score by number of palette-relevant vars present.
    const score = (block.match(/--(foreground|background|primary|status-|brand-)/g) ?? []).length;
    if (score > bestBlockSize) {
      bestBlockSize = score;
      bestBlock = block;
    }
  }
  return bestBlock;
}

// --- Audit ----------------------------------------------------------------

const THEMES = [
  { id: 'dark-midnight', selector: ':root' },           // root IS midnight
  { id: 'dark-cyan',     selector: '[data-theme="dark-cyan"]' },
  { id: 'dark-bronze',   selector: '[data-theme="dark-bronze"]' },
  { id: 'dark-frost',    selector: '[data-theme="dark-frost"]' },
  { id: 'dark-purple',   selector: '[data-theme="dark-purple"]' },
  { id: 'dark-pink',     selector: '[data-theme="dark-pink"]' },
  { id: 'dark-red',      selector: '[data-theme="dark-red"]' },
  { id: 'dark-matrix',   selector: '[data-theme="dark-matrix"]' },
  { id: 'light',         selector: '[data-theme="light"]' },
  { id: 'light-ice',     selector: '[data-theme="light-ice"]' },
  { id: 'light-news',    selector: '[data-theme="light-news"]' },
];

// Minimum opacity a component may apply to muted text and still hold AA.
// Tailwind `text-muted-foreground/80` ⇒ 0.8. Anything lower (/70, /60, …)
// drops the light themes below 4.5:1 — the audit asserts the token clears
// AA AT this floor so any caption authored at ≥ /80 is guaranteed AA.
const MIN_CAPTION_OPACITY = 0.8;

const PAIRS = [
  { id: 'body',      label: 'fg/bg',        fg: 'foreground',      bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'muted-fg',  label: 'muted-fg/bg',  fg: 'muted-foreground', bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'muted-cap', label: 'muted-fg@80',  fg: 'muted-foreground', bg: 'background', failBelow: 4.5, hardFail: true, tintOpacity: MIN_CAPTION_OPACITY },
  { id: 'muted',     label: 'muted/bg',     fg: 'muted',           bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'primary',   label: 'primary/bg',   fg: 'primary',         bg: 'background', failBelow: 3.0 },
  { id: 'success',   label: 'success/bg',   fg: 'status-success',  bg: 'background', failBelow: 3.0 },
  { id: 'warning',   label: 'warning/bg',   fg: 'status-warning',  bg: 'background', failBelow: 3.0 },
  { id: 'error',     label: 'error/bg',     fg: 'status-error',    bg: 'background', failBelow: 3.0 },
  { id: 'info',      label: 'info/bg',      fg: 'status-info',     bg: 'background', failBelow: 3.0 },
  // Accent roles (Gate 0, 2026-09-24). Text colours by design, so AA is a hard
  // floor, not the 3.0 status warning. Canvas only here; the chip and card
  // ratios are in docs/design/style-mastery/specimen/contrast.generated.json.
  { id: 'agent',     label: 'agent/bg',     fg: 'role-agent',      bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'human',     label: 'human/bg',     fg: 'role-human',      bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'external',  label: 'extern/bg',    fg: 'role-external',   bg: 'background', failBelow: 4.5, hardFail: true },
  { id: 'highlight', label: 'hilite/bg',    fg: 'role-highlight',  bg: 'background', failBelow: 4.5, hardFail: true },
];

/** Each theme's effective variable map: root, the theme's overrides on top,
 *  then `--x: var(--y)` resolved one level. Returns null without a :root. */
function resolveThemes(cssText) {
  const rootBlock = extractBlock(cssText, ':root');
  if (!rootBlock) return null;
  const rootVars = parseVars(rootBlock);
  const rootRefs = parseRefs(rootBlock);
  const rootMixes = parseMixes(rootBlock);
  return THEMES.map((theme) => {
    const themeBlock = theme.selector === ':root' ? rootBlock : extractBlock(cssText, theme.selector);
    if (!themeBlock) return { id: theme.id, error: 'block not found' };
    const themeVars = parseVars(themeBlock);
    const themeRefs = parseRefs(themeBlock);
    const themeMixes = parseMixes(themeBlock);
    // Effective map: root → theme overrides on top
    const effective = { ...rootVars, ...themeVars };
    // Resolve `--x: var(--y)` one level against the merged map, unless the theme
    // itself sets --x to a literal. Without this every token the default theme
    // spells as `var(--x-raw)` (all its status colours, all the roles) read n/a.
    for (const [name, target] of Object.entries({ ...rootRefs, ...themeRefs })) {
      if (name in themeVars) continue;
      if (themeRefs[name] === undefined && name in rootVars) continue;
      if (effective[target]) effective[name] = effective[target];
    }
    // Then the fractional vars, composited over this theme's own canvas with
    // the same model `muted-fg@80` and the type tokens already use. A theme
    // that sets the name to a literal hex still wins (none do today).
    const unresolvedMixes = {};
    for (const [name, expr] of Object.entries({ ...rootMixes, ...themeMixes })) {
      if (name in themeVars) continue;
      if (themeMixes[name] === undefined && name in rootVars) continue;
      const r = resolveTextColour(expr, effective, effective.background);
      if (r.colour) effective[name] = r.colour;
      else unresolvedMixes[name] = r.skip ?? `unreadable \`${expr}\``;
    }
    return { id: theme.id, effective, unresolvedMixes, literal: new Set(Object.keys(themeVars)) };
  });
}

// --- Role distinctness ------------------------------------------------------

// A role and a status must read as two different colours at a glance.
// deltaE00 >= 10 is the upper edge of the "perceptible at a glance" band
// (2 to 10) in the practitioner scale most UI colour work cites (Schuessler,
// "Delta E 101", zschuessler.github.io/DeltaE/learn), and well above the
// large-patch just-noticeable difference (about 2.3 in CIELAB units, Mahy et
// al. 1994). The margin matters because the colours here are small text and
// chips: Stone, Szafir & Setlur (2014, CIC 22) measured that the difference
// needed to tell two colours apart grows as the mark shrinks.
const DISTINCT_MIN_DE00 = 10;
const ROLES = ['agent', 'human', 'external', 'highlight'];
const STATUSES = ['success', 'warning', 'error', 'info', 'neutral'];
// Below this CIELAB chroma a colour is a grey for the monochrome exemption.
const ACHROMATIC_CHROMA = 5;
// Themes that deliberately carry no hue: their status colours are greys that
// differ from each other by lightness alone, so a grey role cannot clear the
// bar against every grey status (in light-news four roles and five statuses
// would have to fit a lightness band about 40 L* wide). Only grey-vs-grey
// pairs are exempt; any pair with a hue in it is graded as everywhere else.
const MONOCHROME_THEMES = {
  'dark-red': 'black and white with blood red; status and role greys differ by lightness only',
  'light-news': 'newsprint: every status and role is a grey',
};

/** Every role against every status and every other role, per theme. */
function auditDistinct(themes, monochrome = MONOCHROME_THEMES) {
  const failures = [];
  const stale = [];
  const perTheme = [];
  for (const theme of themes) {
    if (theme.error) continue;
    const e = theme.effective;
    const pairs = [];
    ROLES.forEach((role, i) => {
      for (const s of STATUSES) pairs.push([`role-${role}`, `status-${s}`]);
      for (const other of ROLES.slice(i + 1)) pairs.push([`role-${role}`, `role-${other}`]);
    });
    let min = null;
    let exempted = 0;
    const cells = [];
    for (const [a, b] of pairs) {
      if (!e[a] || !e[b]) {
        failures.push({ theme: theme.id, a, b, de: null });
        continue;
      }
      const de = deltaE2000(e[a], e[b]);
      const grey = chroma(e[a]) < ACHROMATIC_CHROMA && chroma(e[b]) < ACHROMATIC_CHROMA;
      const exempt = theme.id in monochrome && grey;
      cells.push({ a, b, de, exempt });
      if (exempt) {
        if (de < DISTINCT_MIN_DE00) exempted++;
        continue;
      }
      if (!min || de < min.de) min = { a, b, de };
      if (de < DISTINCT_MIN_DE00) failures.push({ theme: theme.id, a, b, de, ha: e[a], hb: e[b] });
    }
    if (theme.id in monochrome && exempted === 0) stale.push(theme.id);
    perTheme.push({ id: theme.id, min, exempted, cells });
  }
  return { failures, stale, perTheme };
}

// --- Rendered model (informational) -------------------------------------------
//
// What the eye gets differs from the declared value: each brightness tier
// re-mixes a colour from its -raw value (globals.css [data-brightness=...]) and
// the html filter then scales the whole page. Roles are always re-mixed; a
// status a theme sets as a literal (`--status-info: #b6a8f5`) beats the tier
// block and is NOT, so under the filter the two drift apart (dark-purple's
// agent/info pair: 11.0 declared, 1.8 rendered at the default tier, before WP4c
// picked a value that holds in both). Modelled, not measured: brightness() as a
// per-channel sRGB multiplier. Printed, never graded. Filter values mirror
// DARK_/LIGHT_BRIGHTNESS_LEVELS in src/stores/themeStore.ts.
const BRIGHTNESS_FILTER = { 'dark-low': 1.25, 'dark-mid': 1.38, 'dark-high': 1.5, 'light-low': 0.82, 'light-mid': 0.91, 'light-high': 1.0 };

/** name -> { keep, toward } for every `--x: color-mix(in srgb, var(--x-raw) N%, black|white)` in a tier block. */
function parseTierMixes(cssText, tier) {
  const block = extractBlock(cssText, `[data-brightness="${tier}"]`) ?? '';
  const mixes = {};
  const re = /--([a-z0-9-]+)\s*:\s*color-mix\(in srgb,\s*var\(--[a-z0-9-]+-raw\)\s*(\d+)%,\s*(black|white)\)\s*;/gi;
  let m;
  while ((m = re.exec(block))) mixes[m[1]] = { keep: Number(m[2]) / 100, toward: m[3] === 'white' ? 255 : 0 };
  return mixes;
}

function renderedColour(theme, name, tierMixes, filter) {
  const e = theme.effective;
  let rgb = hexToRgb(e[name]);
  const mix = tierMixes[name];
  if (mix && !theme.literal.has(name) && e[`${name}-raw`]) {
    rgb = hexToRgb(e[`${name}-raw`]).map((c) => c * mix.keep + mix.toward * (1 - mix.keep));
  }
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * filter))).toString(16).padStart(2, '0')).join('');
}

/** The distinctness pairs again, in the modelled rendered colours of each tier. */
function auditRendered(cssText, themes, monochrome = MONOCHROME_THEMES) {
  const cells = [];
  for (const theme of themes) {
    if (theme.error) continue;
    const mode = theme.id.startsWith('light') ? 'light' : 'dark';
    for (const level of ['low', 'mid', 'high']) {
      const tier = `${mode}-${level}`;
      const mixes = parseTierMixes(cssText, tier);
      const col = (name) => renderedColour(theme, name, mixes, BRIGHTNESS_FILTER[tier]);
      let min = null;
      ROLES.forEach((role, i) => {
        const others = [...STATUSES.map((s) => `status-${s}`), ...ROLES.slice(i + 1).map((r) => `role-${r}`)];
        for (const other of others) {
          const a = col(`role-${role}`);
          const b = col(other);
          if (theme.id in monochrome && chroma(a) < ACHROMATIC_CHROMA && chroma(b) < ACHROMATIC_CHROMA) continue;
          const de = deltaE2000(a, b);
          if (!min || de < min.de) min = { theme: theme.id, tier, a: `role-${role}`, b: other, de };
        }
      });
      if (min) cells.push(min);
    }
  }
  return cells;
}

// --- Type tokens (src/styles/typography.css) --------------------------------
//
// WHY THIS SECTION EXISTS, measured: on 2026-10-03 `.typo-caption`'s muting
// moved from 70% to 80% foreground — 4,292 occurrences across 1,269 files, the
// widest-reaching text-colour change this app has had — and `check:themes` ran
// GREEN WITHOUT LOOKING AT IT, because it read only globals.css. A gate that
// models one token family and is structurally blind to the other is the
// "museum of gates that ran green while checking nothing" the census doctrine
// names by that phrase.
//
// The division of labour between the two files is the reason the blind spot
// was invisible: globals.css declares the VARIABLES (--foreground, --primary,
// --background, per theme) and typography.css decides what fraction of them a
// given tier of text is painted in. `--muted-foreground` is graded above and
// has 0 occurrences in typography.css; `.typo-caption` is what the app's
// secondary prose actually wears. Grading one and not the other grades the
// palette and not the page.
//
// Scope: every `.typo-*` rule that sets `color`, resolved per theme (the file
// writes a light-theme override as a second rule, matched on the selector),
// composited where the value is alpha, and scored against that theme's
// --background exactly as muted-foreground already is.

/** Every flat `selector { body }` rule. A brace-free body means an `@layer` or
 *  `@media` wrapper never matches as a rule of its own — the scan falls
 *  through to the rules inside it, which is what we want. */
function* cssRules(cssText) {
  const src = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) yield { selector: m[1].trim(), body: m[2] };
}

/** The `.typo-*` tokens that set a text colour: `{ name, base, light }`, where
 *  `light` is the override the file writes for `[data-theme*="light"]`. The
 *  `color` match is prefixed so `background-color` and `color-mix(` inside
 *  another property (text-shadow) cannot be mistaken for a text colour. */
function parseTypeTokens(cssText) {
  const tokens = new Map();
  for (const { selector, body } of cssRules(cssText)) {
    const names = [...selector.matchAll(/\.(typo-[a-z0-9-]+)/gi)].map((x) => x[1]);
    if (names.length === 0) continue;
    const decls = [...body.matchAll(/(?:^|[;{\s])color\s*:\s*([^;]+);/g)];
    if (decls.length === 0) continue;
    const value = decls[decls.length - 1][1].trim();
    const light = /light/.test(selector);
    for (const name of names) {
      const entry = tokens.get(name) ?? { name, base: null, light: null };
      entry[light ? 'light' : 'base'] = value;
      tokens.set(name, entry);
    }
  }
  return [...tokens.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One colour term: a var(), a hex, or a keyword the type scale actually uses. */
function termColour(term, effective) {
  const t = term.trim();
  if (/^transparent$/i.test(t)) return 'transparent';
  if (/^white$/i.test(t)) return '#ffffff';
  if (/^black$/i.test(t)) return '#000000';
  let m = t.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/i);
  if (m) return effective[m[1]] ?? null;
  m = t.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  const h = m[1];
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6));
}

/** The opaque colour a `color:` declaration delivers to the eye on `bg`.
 *  `color-mix(in srgb, A N%, transparent)` is an ALPHA of N composited over the
 *  canvas (blendOver, the same model the muted-fg@80 pair already uses); with
 *  an opaque second term it is a plain sRGB interpolation. Anything else
 *  returns a reason, which the audit PRINTS — a value this parser cannot read
 *  is a hole in the gate, not a token that passed. */
function resolveTextColour(expr, effective, bg) {
  const e = expr.trim().replace(/\s+/g, ' ');
  const direct = termColour(e, effective);
  if (direct === 'transparent') return { skip: 'transparent (painted via background-clip)' };
  if (direct) return { colour: direct };
  const m = e.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)\s*\)$/i);
  if (!m) return { skip: `unreadable value \`${e}\`` };
  const a = termColour(m[1], effective);
  const b = termColour(m[3], effective);
  const pct = Number(m[2]) / 100;
  if (!a || a === 'transparent' || !b) return { skip: `unreadable value \`${e}\`` };
  return { colour: blendOver(a, b === 'transparent' ? bg : b, pct), alpha: b === 'transparent' ? pct : null };
}

// Text is text: a type token carries readable copy in every theme, so it holds
// the same AA floor body and muted-foreground already do. Nothing lower is
// defensible here — the whole point of the section is that the two families
// were being held to different standards by accident.
const TYPE_TOKEN_MIN = 4.5;

// Cells that are below the floor today, each with the reason and where the fix
// belongs. A TWO-SIDED exemption, built exactly like MONOCHROME_THEMES above: a
// NEW sub-AA cell fails, and an exemption whose cell has climbed back above the
// floor ALSO fails, so this map cannot rot into a permanent licence. The
// standard stays AA for every token in every theme; these are recorded
// deviations, not a lowered bar for a whole token family.
//
// EMPTY SINCE 2026-10-03, and the four entries it held are worth keeping in
// the record because they were FIXED rather than re-explained. All four were
// one defect seen four times: dark-red's `--primary` (#cc0000) is itself
// 3.40:1 on its own #080808 canvas — which the INFORMATIONAL primary/bg pair
// in the palette table above had always measured — and every primary-tinted
// type token inherited it (typo-title 4.28, typo-title-lg 4.28,
// typo-section-title 3.80, typo-submodule-header 3.62).
//
// The fix was NOT to move `--primary`: that is the theme's identity and Gate 0
// / Gate 1 protect the brand tint and the glow. globals.css gained
// `--primary-ink` — `var(--primary)` everywhere, a lighter red in dark-red
// only — and the four tinted tokens in typography.css read the ink instead of
// the tint. Nothing but text moved; the four cells now measure 6.04 / 6.04 /
// 5.54 / 5.36:1. Ten of eleven themes render byte-identically.
//
// The map stays, with its two-sided contract intact, because the next theme
// whose brand colour is beautiful and illegible will need somewhere to be
// recorded while it waits for the same treatment. Baseline it at measured
// reality, never at zero tolerance for a cell nobody has looked at.
const TYPE_TOKEN_EXEMPT = {};

/** Every `.typo-*` colour against every theme's canvas. */
function auditTypeTokens(tokens, themes, exempt = TYPE_TOKEN_EXEMPT) {
  const rows = [];
  const failures = [];
  const skipped = [];
  const exempted = [];
  const seenBelow = new Set();
  let scored = 0;
  for (const theme of themes) {
    if (theme.error) continue;
    const bg = theme.effective.background;
    const cells = {};
    for (const tok of tokens) {
      const expr = (theme.id.startsWith('light') && tok.light) || tok.base;
      if (!expr) { cells[tok.name] = null; continue; }
      const r = resolveTextColour(expr, theme.effective, bg);
      if (!r.colour) {
        skipped.push({ theme: theme.id, token: tok.name, why: r.skip });
        cells[tok.name] = null;
        continue;
      }
      scored++;
      const key = `${theme.id}·${tok.name}`;
      const ratio = contrastRatio(r.colour, bg);
      const low = ratio < TYPE_TOKEN_MIN;
      const isExempt = low && key in exempt;
      if (low) seenBelow.add(key);
      cells[tok.name] = { ratio, level: level(ratio), fg: r.colour, alpha: r.alpha, exempt: isExempt };
      if (low && !isExempt) failures.push({ theme: theme.id, token: tok.name, ratio, expr, fg: r.colour, bg });
      if (isExempt) exempted.push({ theme: theme.id, token: tok.name, ratio, why: exempt[key] });
    }
    rows.push({ id: theme.id, cells });
  }
  // The other side of the exemption: a recorded deviation that is no longer one.
  const stale = Object.keys(exempt).filter((k) => !seenBelow.has(k));
  return { rows, failures, skipped, exempted, stale, scored };
}

/** Proves the instrument and the gate before the real run trusts them. */
function selfCheck(cssText, typoText, typeThemes) {
  const problems = [];
  for (const [a, b, want] of CIEDE2000_TEST_DATA) {
    const got = deltaE2000Lab(a, b);
    if (Math.abs(got - want) > 1e-4) problems.push(`CIEDE2000 ${JSON.stringify(a)} vs ${JSON.stringify(b)} = ${got.toFixed(4)}, published ${want}`);
  }
  const cases = [];
  // Seed 1: the collision that shipped. light's role-highlight set to its status-info.
  const lightBlock = extractBlock(cssText, '[data-theme="light"]');
  const info = lightBlock && parseVars(lightBlock)['status-info'];
  if (!info) {
    problems.push('seed 1: light --status-info not found');
  } else {
    const seeded = cssText.replace(lightBlock, lightBlock.replace(/--role-highlight-raw\s*:\s*[^;]+;/, `--role-highlight-raw: ${info};`));
    const caught = auditDistinct(resolveThemes(seeded)).failures
      .filter((f) => f.theme === 'light' && f.a === 'role-highlight' && f.b === 'status-info');
    cases.push({ name: `light role-highlight := status-info (${info})`, caught: caught.length > 0, detail: caught });
  }
  // Seed 1b: the palette half's new blind spot, pushed until it breaks.
  // `--muted-foreground` is a `color-mix` fraction of `--foreground` since
  // 2026-10-03; take it to 25% and the two hard-fail muted rows must go red.
  // If a future refactor drops `parseMixes`, this seed fails instead of the
  // gate silently printing `n/a` (which the output code scores as a pass).
  const rootBlock = extractBlock(cssText, ':root');
  const mixedRootVars = rootBlock ? parseMixes(rootBlock) : {};
  if (!('muted-foreground' in mixedRootVars)) {
    problems.push('seed 1b: :root --muted-foreground is no longer a color-mix — re-point this seed');
  } else {
    const seeded = cssText.replace(rootBlock, rootBlock.replace(
      /--muted-foreground\s*:\s*color-mix\([^;]*\);/,
      '--muted-foreground: color-mix(in srgb, var(--foreground) 25%, transparent);'));
    const themes = resolveThemes(seeded);
    const caught = themes.filter((t) => !t.error
      && contrastRatio(t.effective['muted-foreground'], t.effective.background) < 4.5);
    cases.push({
      name: '--muted-foreground mixed down to 25% foreground (AA floor 4.5:1)',
      caught: caught.length === themes.length,
      detail: caught.slice(0, 2).map((t) => ({
        theme: t.id, a: 'muted-foreground', b: 'background', de: null,
        ratio: contrastRatio(t.effective['muted-foreground'], t.effective.background),
        ha: t.effective['muted-foreground'], hb: t.effective.background,
      })),
    });
  }
  // Seed 2: an exemption declared for a theme that has hue must read stale.
  const stale = auditDistinct(resolveThemes(cssText), { ...MONOCHROME_THEMES, 'dark-midnight': 'seeded' }).stale;
  cases.push({ name: 'dark-midnight declared monochrome', caught: stale.includes('dark-midnight'), detail: [] });
  // Seed 3: the change this section was added for, pushed until it breaks.
  // `.typo-caption`'s muting is the app's widest-reaching text colour; take it
  // from 80% foreground to 35% and the gate must go red. Proven on every run,
  // so a future refactor that quietly stops reading typography.css — the exact
  // failure this section closes — cannot pass as green.
  const typoTokens = parseTypeTokens(typoText);
  if (typoTokens.length === 0) {
    problems.push('seed 3: no .typo-* colour rules parsed out of typography.css');
  } else if (!typoTokens.some((x) => x.name === 'typo-caption')) {
    problems.push('seed 3: .typo-caption carries no colour declaration any more — re-point this seed');
  } else {
    const seeded = typoTokens.map((x) => (x.name === 'typo-caption'
      ? { ...x, base: 'color-mix(in srgb, var(--foreground) 35%, transparent)', light: null }
      : x));
    const caught = auditTypeTokens(seeded, typeThemes).failures.filter((f) => f.token === 'typo-caption');
    cases.push({
      name: 'typo-caption muted to 35% foreground (AA floor 4.5:1)',
      caught: caught.length > 0,
      detail: caught.map((f) => ({ theme: f.theme, a: f.token, b: 'background', de: null, ratio: f.ratio, ha: f.fg, hb: f.bg })),
    });
    // Seed 4: the OTHER side of the type-token exemption, as seed 2 is for the
    // monochrome one. An exemption declared for a cell that holds AA must read
    // stale, or the map becomes a permanent licence nobody revisits.
    const staleType = auditTypeTokens(typoTokens, typeThemes, {
      ...TYPE_TOKEN_EXEMPT,
      'dark-midnight·typo-caption': 'seeded',
    }).stale;
    cases.push({
      name: 'dark-midnight · typo-caption declared exempt while above AA',
      caught: staleType.includes('dark-midnight·typo-caption'),
      detail: [],
    });
  }
  for (const c of cases) if (!c.caught) problems.push(`seeded case NOT caught: ${c.name}`);
  return { problems, cases };
}

/** The fail-loud contract for the PALETTE half, matching the one the type-token
 *  half already has. `n/a` is `failed: false` in the output code below, so a
 *  hard-fail pair the resolver cannot read is a gate that grades nothing while
 *  printing green. "Found nothing" and "looked at nothing" are different
 *  outcomes and only one of them is success. Fatal, never a warning. */
function assertHardPairsResolved(themes) {
  const blind = [];
  for (const theme of themes) {
    if (theme.error) { blind.push(`${theme.id}: ${theme.error}`); continue; }
    for (const [name, why] of Object.entries(theme.unresolvedMixes ?? {})) {
      blind.push(`${theme.id} · --${name} is a color-mix this parser cannot read (${why})`);
    }
    for (const pair of PAIRS) {
      if (!pair.hardFail) continue;
      if (!theme.effective[pair.fg]) blind.push(`${theme.id} · ${pair.label}: --${pair.fg} did not resolve`);
      if (!theme.effective[pair.bg]) blind.push(`${theme.id} · ${pair.label}: --${pair.bg} did not resolve`);
    }
  }
  return blind;
}

const css = readFileSync(CSS_PATH, 'utf8');
const resolved = resolveThemes(css);
if (!resolved) {
  console.error('FATAL: could not find :root block in globals.css');
  process.exit(2);
}
const blindPairs = assertHardPairsResolved(resolved);
if (blindPairs.length > 0) {
  console.error('FATAL: a graded pairing did not resolve, so the gate would have printed n/a and passed:');
  for (const b of blindPairs) console.error(`  • ${b}`);
  process.exit(2);
}

const typoCss = readFileSync(TYPO_CSS_PATH, 'utf8');
const typeTokens = parseTypeTokens(typoCss);
const typeAudit = auditTypeTokens(typeTokens, resolved);
// Fail-loud contract (census doctrine): "found nothing" and "looked at nothing"
// are different outcomes and only one of them is success. A parser that stops
// matching typography.css must break the run, not quietly grade zero tokens —
// that silence is the exact defect this section was added to end.
if (typeTokens.length === 0 || typeAudit.scored === 0) {
  console.error(`FATAL: no .typo-* colour rules scored out of ${TYPO_CSS_PATH} ` +
    `(${typeTokens.length} token(s) parsed, ${typeAudit.scored} cell(s) scored) — the type-token matcher is broken`);
  process.exit(2);
}

const rows = [];
let hardFailures = 0;
let pairWarnings = 0;
const hardFailDetail = [];

for (const theme of resolved) {
  if (theme.error) {
    rows.push({ id: theme.id, error: theme.error });
    continue;
  }
  const effective = theme.effective;
  const row = { id: theme.id, results: {} };

  for (const pair of PAIRS) {
    const fgRaw = effective[pair.fg];
    const bg = effective[pair.bg];
    if (!fgRaw || !bg) {
      row.results[pair.id] = { ratio: null, level: 'n/a', failed: false };
      continue;
    }
    const fg = pair.tintOpacity ? blendOver(fgRaw, bg, pair.tintOpacity) : fgRaw;
    const r = contrastRatio(fg, bg);
    const lvl = level(r);
    const failed = r < pair.failBelow;
    if (failed) {
      if (pair.hardFail) {
        hardFailures++;
        hardFailDetail.push(`${theme.id} · ${pair.label} = ${r.toFixed(2)}:1 (needs ≥ ${pair.failBelow})`);
      } else {
        pairWarnings++;
      }
    }
    row.results[pair.id] = { ratio: r, level: lvl, failed, fg, bg };
  }
  rows.push(row);
}

// --- Output ---------------------------------------------------------------

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function colorLevel(lvl, failed) {
  if (lvl === 'AAA') return GREEN + lvl + RESET;
  if (lvl === 'AA') return GREEN + lvl + RESET;
  if (lvl === 'AA-lg') return failed ? RED + lvl + RESET : YELLOW + lvl + RESET;
  if (lvl === 'low') return RED + lvl + RESET;
  return DIM + lvl + RESET;
}

console.log('\nWCAG contrast audit — src/styles/globals.css (palette) + src/styles/typography.css (type tokens)\n');

const header = ['theme'.padEnd(15)].concat(PAIRS.map((p) => p.label.padEnd(13))).join('');
console.log(DIM + header + RESET);
console.log(DIM + '-'.repeat(15 + PAIRS.length * 13) + RESET);

for (const row of rows) {
  if (row.error) {
    console.log(row.id.padEnd(15) + RED + row.error + RESET);
    continue;
  }
  const cells = [row.id.padEnd(15)];
  for (const pair of PAIRS) {
    const r = row.results[pair.id];
    if (!r || r.ratio === null) {
      cells.push(DIM + 'n/a'.padEnd(13) + RESET);
    } else {
      const ratioStr = r.ratio.toFixed(1) + ':1';
      cells.push((ratioStr + ' ' + colorLevel(r.level, r.failed)).padEnd(13 + colorLevel(r.level, r.failed).length - r.level.length));
    }
  }
  console.log(cells.join(''));
}

console.log();
if (pairWarnings > 0) {
  console.log(YELLOW + `${pairWarnings} pair warning(s) — primary/status contrast below 3.0 (informational, not a fail)` + RESET);
}
if (hardFailures > 0) {
  console.log(RED + `FAIL: ${hardFailures} text-token pairing(s) below AA (4.5:1):` + RESET);
  for (const d of hardFailDetail) console.log(RED + '  • ' + d + RESET);
  console.log(
    DIM +
      '\nText tokens (body / muted-foreground / muted-foreground@' +
      Math.round(MIN_CAPTION_OPACITY * 100) +
      '% / muted / the accent roles) must clear AA in every theme.\n' +
      'Adjust the token in src/styles/globals.css; see docs/development/contrast.md.' +
      RESET,
  );
} else {
  console.log(GREEN + 'OK: all text-token pairings (body / muted-foreground / muted-foreground@80% / muted / the four accent roles) meet AA in every theme' + RESET);
}

// --- Type-token output --------------------------------------------------------

const typoShort = (name) => name.replace(/^typo-/, '');
console.log(`\nType tokens — every .typo-* colour in typography.css vs its theme's canvas, AA floor ${TYPE_TOKEN_MIN}:1\n`);

const typeHeader = ['theme'.padEnd(15)].concat(typeTokens.map((tok) => typoShort(tok.name).slice(0, 12).padEnd(13))).join('');
console.log(DIM + typeHeader + RESET);
console.log(DIM + '-'.repeat(15 + typeTokens.length * 13) + RESET);
for (const row of typeAudit.rows) {
  const cells = [row.id.padEnd(15)];
  for (const tok of typeTokens) {
    const r = row.cells[tok.name];
    if (!r) {
      cells.push(DIM + 'n/a'.padEnd(13) + RESET);
    } else {
      const lvl = r.exempt ? YELLOW + r.level + RESET : colorLevel(r.level, r.ratio < TYPE_TOKEN_MIN);
      cells.push((r.ratio.toFixed(1) + ':1 ' + lvl).padEnd(13 + lvl.length - r.level.length));
    }
  }
  console.log(cells.join(''));
}
for (const s of typeAudit.skipped) {
  console.log(DIM + `  not scored: ${s.theme} · .${s.token} — ${s.why}` + RESET);
}
for (const e of typeAudit.exempted) {
  console.log(YELLOW + `  recorded deviation: ${e.theme} · .${e.token} = ${e.ratio.toFixed(2)}:1 — ${e.why}` + RESET);
}

// What this half of the gate still cannot see, said out loud rather than left
// to be assumed. A `text-foreground/NN` utility in a .tsx file appears in no
// stylesheet, so no CSS reader can find it (a separate workstream owns the
// 1,679 such sites, 18 distinct levels, /15 to /95). What IS computable from
// here is the FLOOR those sites have to clear: the lowest alpha at which
// `--foreground` over `--background` still holds AA, per theme. Informational
// — this gate grades declarations, not call sites.
const alphaFloor = (theme) => {
  for (let pct = 5; pct <= 100; pct += 5) {
    if (contrastRatio(blendOver(theme.effective.foreground, theme.effective.background, pct / 100), theme.effective.background) >= TYPE_TOKEN_MIN) return pct;
  }
  return null;
};
const floors = resolved.filter((t) => !t.error && t.effective.foreground && t.effective.background)
  .map((t) => ({ id: t.id, pct: alphaFloor(t) }));
const worstFloor = floors.reduce((a, b) => (b.pct !== null && (a === null || b.pct > a.pct) ? b.pct : a), null);
console.log(YELLOW + `\n  text-foreground/NN utilities (informational, NOT graded — they live in .tsx, not in any\n` +
  `  stylesheet, so no CSS reader can see them): AA needs /${worstFloor} in the worst theme ` +
  `(${floors.filter((f) => f.pct === worstFloor).map((f) => f.id).join(', ')}); per theme ` +
  floors.map((f) => `${f.id} /${f.pct}`).join(', ') + RESET);

if (typeAudit.failures.length > 0) {
  console.log(RED + `\nFAIL: ${typeAudit.failures.length} type-token colour(s) below AA (${TYPE_TOKEN_MIN}:1):` + RESET);
  for (const f of typeAudit.failures) {
    console.log(RED + `  • ${f.theme} · .${f.token} = ${f.ratio.toFixed(2)}:1 — ${f.fg} on ${f.bg}  (${f.expr})` + RESET);
  }
  console.log(DIM + '\nA .typo-* token sets the text colour of every surface that wears it. Adjust the\n' +
    'declaration in src/styles/typography.css (or the variable it mixes, in globals.css);\n' +
    'see docs/development/contrast.md. A cell that is a known, owned deviation goes in\n' +
    'TYPE_TOKEN_EXEMPT with its reason — never by relaxing the floor.' + RESET);
}
if (typeAudit.stale.length > 0) {
  console.log(RED + `\nFAIL: ${typeAudit.stale.length} stale type-token exemption(s) — the cell now holds AA (or no longer exists):` + RESET);
  for (const k of typeAudit.stale) console.log(RED + `  • ${k} — delete it from TYPE_TOKEN_EXEMPT` + RESET);
}
if (typeAudit.failures.length === 0 && typeAudit.stale.length === 0) {
  console.log(GREEN + `\nOK: all ${typeAudit.scored} type-token/theme colour(s) across ${typeTokens.length} .typo-* token(s) meet AA` +
    (typeAudit.exempted.length > 0 ? ` (${typeAudit.exempted.length} recorded deviation(s), listed above)` : '') + RESET);
}

// --- Role distinctness output -------------------------------------------------

const short = (name) => name.replace(/^(status|role)-/, '');
const distinct = auditDistinct(resolved);
console.log(`\nRole distinctness: CIEDE2000 deltaE >= ${DISTINCT_MIN_DE00}, every role vs every status and every other role\n`);
if (process.argv.includes('--matrix')) {
  for (const t of distinct.perTheme) {
    console.log(DIM + '  ' + t.id + RESET);
    for (const role of ROLES) {
      const mine = t.cells.filter((c) => c.a === `role-${role}` || c.b === `role-${role}`);
      const text = mine.map((c) => {
        const other = short(c.a === `role-${role}` ? c.b : c.a);
        const cell = `${other} ${c.de.toFixed(1)}`;
        return c.exempt ? DIM + cell + '(m)' + RESET : c.de < DISTINCT_MIN_DE00 ? RED + cell + RESET : cell;
      });
      console.log(`    ${role.padEnd(10)} ${text.join('  ')}`);
    }
  }
  console.log(DIM + '  (m) = grey vs grey in a declared monochrome theme, reported, not graded' + RESET + '\n');
}
for (const t of distinct.perTheme) {
  const low = t.min && t.min.de < DISTINCT_MIN_DE00;
  const minText = t.min ? `min ${t.min.de.toFixed(1)} (${short(t.min.a)} / ${short(t.min.b)})` : 'no graded pair';
  const note = t.id in MONOCHROME_THEMES ? DIM + `  monochrome: ${t.exempted} grey pair(s) below the bar, exempt` + RESET : '';
  console.log('  ' + t.id.padEnd(15) + (low ? RED : GREEN) + minText + RESET + note);
}

const rendered = auditRendered(css, resolved);
const renderedLow = rendered.filter((c) => c.de < DISTINCT_MIN_DE00).sort((x, y) => x.de - y.de);
const renderedLine = renderedLow.length === 0
  ? `every tier holds >= ${DISTINCT_MIN_DE00}`
  : `${renderedLow.length} of ${rendered.length} theme/tier cells below ${DISTINCT_MIN_DE00}; lowest ${renderedLow[0].de.toFixed(1)} ` +
    `(${renderedLow[0].theme} ${renderedLow[0].tier}, ${short(renderedLow[0].a)} / ${short(renderedLow[0].b)})`;
console.log(YELLOW + `
  rendered, modelled per brightness tier (informational, not graded): ${renderedLine}` + RESET);
if (process.argv.includes('--matrix')) {
  for (const c of rendered) console.log(DIM + `    ${c.theme.padEnd(15)}${c.tier.padEnd(11)}min ${c.de.toFixed(1)} (${short(c.a)} / ${short(c.b)})` + RESET);
}

const check = selfCheck(css, typoCss, resolved);
console.log(DIM + `\n  instrument: CIEDE2000 reproduces ${CIEDE2000_TEST_DATA.length} published pairs (Sharma et al. 2005); ` +
  `${check.cases.filter((c) => c.caught).length}/${check.cases.length} seeded cases caught (--self-check shows them)` + RESET);
if (process.argv.includes('--self-check')) {
  for (const c of check.cases) {
    console.log(`\n  seeded: ${c.name} -> ${c.caught ? 'CAUGHT' : 'MISSED'}`);
    for (const f of c.detail) {
      // Two kinds of seeded failure now: a distinctness pair (deltaE) and a
      // type-token contrast pair (a ratio against the canvas).
      console.log(f.de === null
        ? RED + `    FAIL ${f.theme} · .${f.a} ${f.ha} on ${f.b} ${f.hb} = ${f.ratio.toFixed(2)}:1 (needs >= ${TYPE_TOKEN_MIN})` + RESET
        : RED + `    FAIL ${f.theme} · ${f.a} ${f.ha} vs ${f.b} ${f.hb} = deltaE ${f.de.toFixed(1)} (needs >= ${DISTINCT_MIN_DE00})` + RESET);
    }
    if (c.name === 'dark-midnight declared monochrome') console.log(RED + '    FAIL stale monochrome exemption: dark-midnight has no grey pair below the bar' + RESET);
    if (c.name.startsWith('dark-midnight · typo-caption')) console.log(RED + '    FAIL stale type-token exemption: dark-midnight · .typo-caption is above the AA floor' + RESET);
  }
}

if (check.problems.length > 0) {
  console.log(RED + '\nFATAL: an instrument is broken (distinctness and/or the type-token matcher):' + RESET);
  for (const p of check.problems) console.log(RED + '  • ' + p + RESET);
  process.exit(2);
}
if (distinct.failures.length > 0 || distinct.stale.length > 0) {
  console.log(RED + `\nFAIL: ${distinct.failures.length} role pair(s) below deltaE ${DISTINCT_MIN_DE00}:` + RESET);
  for (const f of distinct.failures) {
    const de = f.de === null ? 'unresolved' : `deltaE ${f.de.toFixed(1)}`;
    console.log(RED + `  • ${f.theme} · ${f.a} ${f.ha ?? ''} vs ${f.b} ${f.hb ?? ''} = ${de}` + RESET);
  }
  for (const id of distinct.stale) {
    console.log(RED + `  • ${id} is declared monochrome but has no grey pair below the bar: delete it from MONOCHROME_THEMES` + RESET);
  }
  console.log(DIM + '\nA role must read as a different colour from every status and every other role in every theme.\n' +
    'Move the role\'s -raw value in src/styles/globals.css; see docs/design/style-mastery/doctrine.md section 4.' + RESET);
}
const distinctFailed = distinct.failures.length > 0 || distinct.stale.length > 0;
if (!distinctFailed) console.log(GREEN + `\nOK: every role is at least deltaE ${DISTINCT_MIN_DE00} from every status and every other role in every theme` + RESET);
process.exit(hardFailures > 0 || distinctFailed || typeAudit.failures.length > 0 || typeAudit.stale.length > 0 ? 1 : 0);
