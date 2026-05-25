#!/usr/bin/env node
/**
 * check-themes.mjs — WCAG contrast audit for all themes.
 *
 * Parses src/styles/globals.css, extracts the :root defaults and every
 * [data-theme="..."] override block, resolves each theme's effective CSS
 * variable map (overrides layered on root), then computes contrast ratios
 * for the pairs that matter:
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
 * Exits 1 if ANY theme fails ANY hard-fail pairing; 0 otherwise.
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
];

const css = readFileSync(CSS_PATH, 'utf8');
const rootBlock = extractBlock(css, ':root');
if (!rootBlock) {
  console.error('FATAL: could not find :root block in globals.css');
  process.exit(2);
}
const rootVars = parseVars(rootBlock);

const rows = [];
let hardFailures = 0;
let pairWarnings = 0;
const hardFailDetail = [];

for (const theme of THEMES) {
  const themeBlock = theme.selector === ':root' ? rootBlock : extractBlock(css, theme.selector);
  if (!themeBlock) {
    rows.push({ id: theme.id, error: 'block not found' });
    continue;
  }
  const themeVars = parseVars(themeBlock);
  // Effective map: root → theme overrides on top
  const effective = { ...rootVars, ...themeVars };
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

console.log('\nWCAG contrast audit — src/styles/globals.css\n');

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
      '% / muted) must clear AA in every theme.\n' +
      'Adjust the token in src/styles/globals.css; see docs/development/contrast.md.' +
      RESET,
  );
  process.exit(1);
}
console.log(GREEN + 'OK: all text-token pairings (body / muted-foreground / muted-foreground@80% / muted) meet AA in every theme' + RESET);
process.exit(0);
