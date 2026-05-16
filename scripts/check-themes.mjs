#!/usr/bin/env node
/**
 * check-themes.mjs — WCAG contrast audit for all themes.
 *
 * Parses src/styles/globals.css, extracts the :root defaults and every
 * [data-theme="..."] override block, resolves each theme's effective CSS
 * variable map (overrides layered on root), then computes contrast ratios
 * for the pairs that matter:
 *
 *   foreground / background       (body text — MUST be AA, ideally AAA)
 *   primary    / background       (links, accent text, active states)
 *   status-success / background   (semantic chip on canvas)
 *   status-error   / background
 *   status-warning / background
 *   status-info    / background
 *
 * Exits 0 if every theme's body contrast (fg/bg) is ≥ 4.5 (AA).
 * Exits 1 if any theme fails body contrast.
 * Always prints a readable table; failures are highlighted.
 *
 * No external deps — pure Node. Suitable for pre-release manual run or
 * later wiring into CI via `npm run check:themes`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '..', 'src', 'styles', 'globals.css');

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
  { id: 'light-sage',    selector: '[data-theme="light-sage"]' },
  { id: 'light-sand',    selector: '[data-theme="light-sand"]' },
];

const PAIRS = [
  { id: 'body',     label: 'fg/bg',       fg: 'foreground',     bg: 'background', failBelow: 4.5 },
  { id: 'primary',  label: 'primary/bg',  fg: 'primary',        bg: 'background', failBelow: 3.0 },
  { id: 'success',  label: 'success/bg',  fg: 'status-success', bg: 'background', failBelow: 3.0 },
  { id: 'warning',  label: 'warning/bg',  fg: 'status-warning', bg: 'background', failBelow: 3.0 },
  { id: 'error',    label: 'error/bg',    fg: 'status-error',   bg: 'background', failBelow: 3.0 },
  { id: 'info',     label: 'info/bg',     fg: 'status-info',    bg: 'background', failBelow: 3.0 },
];

const css = readFileSync(CSS_PATH, 'utf8');
const rootBlock = extractBlock(css, ':root');
if (!rootBlock) {
  console.error('FATAL: could not find :root block in globals.css');
  process.exit(2);
}
const rootVars = parseVars(rootBlock);

const rows = [];
let bodyFailures = 0;
let pairWarnings = 0;

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
    const fg = effective[pair.fg];
    const bg = effective[pair.bg];
    if (!fg || !bg) {
      row.results[pair.id] = { ratio: null, level: 'n/a', failed: false };
      continue;
    }
    const r = contrastRatio(fg, bg);
    const lvl = level(r);
    const failed = r < pair.failBelow;
    if (failed) {
      if (pair.id === 'body') bodyFailures++;
      else pairWarnings++;
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
if (bodyFailures > 0) {
  console.log(RED + `FAIL: ${bodyFailures} theme(s) have body text contrast below AA (4.5:1)` + RESET);
  process.exit(1);
}
if (pairWarnings > 0) {
  console.log(YELLOW + `${pairWarnings} pair warning(s) — non-body contrast below 3.0 (informational, not a fail)` + RESET);
}
console.log(GREEN + 'OK: all themes meet AA body contrast' + RESET);
process.exit(0);
