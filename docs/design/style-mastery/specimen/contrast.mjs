#!/usr/bin/env node
// contrast.mjs - WCAG ratios for the proposed colour roles and the muting
// forms, in every theme, computed from the SHIPPED CSS.
//
// Run from the repo root:  node docs/design/style-mastery/specimen/contrast.mjs
// Writes contrast.generated.json, which the specimen page reads.
//
// REUSE, NOT A SECOND OPINION. The contrast maths, the CSS block extraction and
// the theme roster below are copied verbatim from scripts/check-themes.mjs (it
// runs at import and calls process.exit, so it cannot be imported). To prove
// the copy is faithful, `--self-check` runs the real check-themes, parses its
// table, and asserts this file reproduces every ratio it prints.
//
// One difference, stated: check-themes reads only literal hex, so a token set
// as `var(--x)` reads `n/a`. That is why it prints n/a for every status colour
// of the default theme (:root sets --status-success: var(--status-success-raw)).
// Here a `var()` is resolved one level, so the default theme is graded too.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');

// --- copied from scripts/check-themes.mjs ----------------------------------
function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const norm = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(norm.slice(0, 2), 16), parseInt(norm.slice(2, 4), 16), parseInt(norm.slice(4, 6), 16)];
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
function blendOver(fgHex, bgHex, alpha) {
  const f = hexToRgb(fgHex);
  const b = hexToRgb(bgHex);
  const mix = [0, 1, 2].map((i) => Math.round(f[i] * alpha + b[i] * (1 - alpha)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}
function parseVars(block) {
  const vars = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) {
    const name = m[1].trim();
    const raw = m[2].trim();
    const hexMatch = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      const h = hexMatch[1];
      vars[name] = '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6));
    }
  }
  return vars;
}
function extractBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{', 'g');
  let bestBlockSize = -1;
  let bestBlock = null;
  let m;
  while ((m = re.exec(css))) {
    const braceStart = m.index + m[0].length - 1;
    let depth = 1;
    let i = braceStart + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const block = css.slice(braceStart + 1, i - 1);
    const score = (block.match(/--(foreground|background|primary|status-|brand-)/g) ?? []).length;
    if (score > bestBlockSize) { bestBlockSize = score; bestBlock = block; }
  }
  return bestBlock;
}
const THEMES = [
  { id: 'dark-midnight', selector: ':root' },
  { id: 'dark-cyan', selector: '[data-theme="dark-cyan"]' },
  { id: 'dark-bronze', selector: '[data-theme="dark-bronze"]' },
  { id: 'dark-frost', selector: '[data-theme="dark-frost"]' },
  { id: 'dark-purple', selector: '[data-theme="dark-purple"]' },
  { id: 'dark-pink', selector: '[data-theme="dark-pink"]' },
  { id: 'dark-red', selector: '[data-theme="dark-red"]' },
  { id: 'dark-matrix', selector: '[data-theme="dark-matrix"]' },
  { id: 'light', selector: '[data-theme="light"]' },
  { id: 'light-ice', selector: '[data-theme="light-ice"]' },
  { id: 'light-news', selector: '[data-theme="light-news"]' },
];
const MIN_CAPTION_OPACITY = 0.8;
// --- end of the copy --------------------------------------------------------

/** parseVars, plus one level of `var(--x)` resolution against `scope`. */
function parseVarsResolved(block, scope) {
  const vars = parseVars(block);
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)\s*;/gi)) {
    const target = vars[m[2]] ?? scope[m[2]];
    if (target) vars[m[1]] = target;
  }
  return vars;
}
/** rgba(r, g, b, a) -> { hex, alpha } for the card surface, which is translucent. */
function parseRgba(block, name) {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)`));
  if (!m) return null;
  const hex = '#' + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('');
  return { hex, alpha: Number(m[4]) };
}

const globals = readFileSync(join(ROOT, 'src', 'styles', 'globals.css'), 'utf8');
const proposed = readFileSync(join(ROOT, 'src', 'styles', 'accent-roles.proposed.css'), 'utf8');
const rootBlock = extractBlock(globals, ':root');
const rootVars = parseVarsResolved(rootBlock, {});

// The proposal's own blocks: each theme's binding is introduced by a
// `/* theme: <id> */` marker comment, and the block is the next `{ ... }`.
function proposalBlock(themeId) {
  const at = proposed.indexOf(`/* theme: ${themeId} */`);
  if (at < 0) return null;
  const open = proposed.indexOf('{', at);
  const close = proposed.indexOf('}', open);
  return proposed.slice(open + 1, close);
}

export const ROLES = ['agent', 'human', 'external', 'highlight'];
export const STATUSES = ['success', 'warning', 'error', 'info'];
const CHIP_FILL = 0.1; // bg-role-x/10, the fill status chips already use (bg-status-x/10)
const CHIP_BORDER = 0.3; // border-role-x/30
const MUTE = 0.7; // the one muting level: foreground at 70%
const TEXT_BAR = 4.5; // AA body text: the bar this proposal holds roles to
const STATUS_BAR = 3.0; // the bar check-themes applies to status colours

const r2 = (n) => Math.round(n * 100) / 100;
const out = { generatedBy: 'docs/design/style-mastery/specimen/contrast.mjs', bars: { text: TEXT_BAR, status: STATUS_BAR }, recipe: { chipFill: CHIP_FILL, chipBorder: CHIP_BORDER, mute: MUTE }, themes: {} };
let belowBar = 0;

for (const theme of THEMES) {
  const block = theme.selector === ':root' ? rootBlock : extractBlock(globals, theme.selector);
  const eff = { ...rootVars, ...parseVarsResolved(block, rootVars) };
  const bg = eff.background;
  const fg = eff.foreground;
  const cardRaw = parseRgba(block, 'card-bg') ?? parseRgba(rootBlock, 'card-bg');
  const card = cardRaw ? blendOver(cardRaw.hex, bg, cardRaw.alpha) : bg;
  const pVars = parseVars(proposalBlock(theme.id) ?? '');
  const row = { bg, fg, card, status: {}, roles: {}, muting: {} };

  const grade = (hex) => {
    const chip = blendOver(hex, bg, CHIP_FILL);
    return {
      hex,
      onBg: r2(contrastRatio(hex, bg)),
      onCard: r2(contrastRatio(hex, card)),
      onChip: r2(contrastRatio(hex, chip)),
      border: r2(contrastRatio(blendOver(hex, bg, CHIP_BORDER), bg)),
    };
  };
  for (const s of STATUSES) if (eff[`status-${s}`]) row.status[s] = grade(eff[`status-${s}`]);
  for (const role of ROLES) {
    const hex = pVars[`role-${role}-raw`];
    if (!hex) { row.roles[role] = null; belowBar++; continue; }
    const g = grade(hex);
    g.pass = Math.min(g.onBg, g.onChip, g.onCard) >= TEXT_BAR;
    if (!g.pass) belowBar++;
    row.roles[role] = g;
  }
  // The four muting forms as the app writes them, then the one proposed level.
  const alpha = (a) => r2(contrastRatio(blendOver(fg, bg, a), bg));
  row.muting = {
    'typo-caption (70%)': alpha(0.7),
    'text-foreground/60': alpha(0.6),
    'text-foreground/40': alpha(0.4),
    'text-foreground opacity-60': alpha(0.6),
    'text-muted-foreground': r2(contrastRatio(eff['muted-foreground'], bg)),
    'text-muted-foreground@80 (check-themes floor)': r2(contrastRatio(blendOver(eff['muted-foreground'], bg, MIN_CAPTION_OPACITY), bg)),
    'proposed ink-muted on canvas': alpha(MUTE),
    'proposed ink-muted on card': r2(contrastRatio(blendOver(fg, card, MUTE), card)),
  };
  out.themes[theme.id] = row;
}
out.rolesBelowTextBar = belowBar;
writeFileSync(join(HERE, 'contrast.generated.json'), JSON.stringify(out, null, 1) + '\n');

// --- console table ---
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('theme', 15) + ROLES.map((r) => pad(r + ' bg/chip/card', 22)).join('') + 'ink-muted');
for (const [id, row] of Object.entries(out.themes)) {
  console.log(pad(id, 15) + ROLES.map((r) => {
    const g = row.roles[r];
    return pad(g ? `${g.onBg}/${g.onChip}/${g.onCard}${g.pass ? '' : ' LOW'}` : 'missing', 22);
  }).join('') + `${row.muting['proposed ink-muted on canvas']}/${row.muting['proposed ink-muted on card']}`);
}
console.log(belowBar === 0 ? `OK: every role clears ${TEXT_BAR}:1 on canvas, chip and card in every theme` : `${belowBar} role/theme cell(s) below ${TEXT_BAR}:1`);

// --- self-check: reproduce check-themes' own table --------------------------
if (process.argv.includes('--self-check')) {
  const raw = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-themes.mjs')], { encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '');
  const PAIRS = [['foreground'], ['muted-foreground'], ['muted-foreground', 0.8], ['muted'], ['primary'], ['status-success'], ['status-warning'], ['status-error'], ['status-info']];
  let checked = 0; let mismatched = 0;
  for (const theme of THEMES) {
    const line = raw.split('\n').find((l) => l.startsWith(theme.id + ' '));
    const cells = [...line.matchAll(/(\d+\.\d):1|n\/a/g)].map((m) => (m[1] ? Number(m[1]) : null));
    const block = theme.selector === ':root' ? rootBlock : extractBlock(globals, theme.selector);
    const eff = { ...parseVars(rootBlock), ...parseVars(block) }; // unresolved, as check-themes reads it
    PAIRS.forEach(([name, a], i) => {
      const expected = cells[i];
      if (expected === null || !eff[name]) return;
      const fgHex = a ? blendOver(eff[name], eff.background, a) : eff[name];
      const mine = Number(contrastRatio(fgHex, eff.background).toFixed(1));
      checked++;
      if (mine !== expected) { mismatched++; console.log(`MISMATCH ${theme.id} ${name}: check-themes ${expected}, here ${mine}`); }
    });
  }
  console.log(`self-check: ${checked} ratios compared with check-themes output, ${mismatched} mismatched`);
  if (mismatched) process.exit(1);
}
if (belowBar) process.exitCode = 1;
