#!/usr/bin/env node
/**
 * Mechanical codemod for the three "1:1 substitution" lint rules:
 *   --rule=radius          no-raw-radius-classes
 *   --rule=shadow          no-raw-shadow-classes
 *   --rule=low-contrast    no-low-contrast-text-classes
 *
 * Walks src/**\/*.{ts,tsx}, respecting each rule's exemptions, and applies
 * word-boundary regex substitutions. Prints a file-by-file change count,
 * writes files in place, and reports a summary.
 *
 * Safe by design:
 *   - Only matches on word boundaries so `rounded-smx` (hypothetical) is not
 *     touched.
 *   - Skips state modifiers (`disabled:`, `hover:`, etc.) for the
 *     low-contrast rule, matching the lint rule's own allowance.
 *   - Skips the same files the lint rules skip.
 *   - Dry-run with `--dry` for diff preview.
 *
 * Usage:
 *   node scripts/codemod-lint-fix.mjs --rule=radius
 *   node scripts/codemod-lint-fix.mjs --rule=shadow
 *   node scripts/codemod-lint-fix.mjs --rule=low-contrast --dry
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v ?? true];
  }),
);

const rule = args.get('rule');
const dry = args.get('dry');

if (!['radius', 'shadow', 'low-contrast'].includes(rule)) {
  console.error('Usage: node scripts/codemod-lint-fix.mjs --rule=<radius|shadow|low-contrast> [--dry]');
  process.exit(1);
}

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// -- Substitution tables ----------------------------------------------------

const RADIUS_MAP = [
  // order matters — longer patterns first
  { re: /\brounded-sm\b/g, to: 'rounded-interactive' },
  { re: /\brounded-md\b/g, to: 'rounded-input' },
  { re: /\brounded-lg\b/g, to: 'rounded-card' },
  { re: /\brounded-xl\b/g, to: 'rounded-modal' },
];

// Side modifiers (t/b/l/r/tl/tr/bl/br): the design system doesn't have
// per-side semantic tokens, so we leave `rounded-t-md` / `rounded-r-lg` /
// etc. UNTOUCHED — bulk-substituting them would silently change geometry.

const SHADOW_MAP = [
  { re: /\bshadow-sm\b/g, to: 'shadow-elevation-1' },
  { re: /\bshadow-md\b/g, to: 'shadow-elevation-2' },
  { re: /\bshadow-lg\b/g, to: 'shadow-elevation-3' },
  { re: /\bshadow-xl\b/g, to: 'shadow-elevation-3' }, // bucket into same tier
  { re: /\bshadow-2xl\b/g, to: 'shadow-elevation-4' },
];

// Low-contrast: replace unprefixed `text-muted-foreground[/N]` and
// `text-foreground/N` (N<=80) with `text-foreground`. Skip any occurrence
// preceded by a state modifier like `disabled:`, `hover:`, etc.
//
// Strategy: use a regex that captures the token with optional prefix; in
// the replacer, only substitute if there is no state-modifier prefix.
const STATE_PREFIX_RE = /(?:disabled|hover|focus|focus-visible|active|group-hover|peer-hover|dark|light|aria-[a-z-]+|data-\[[^\]]+\])/;

const LOW_CONTRAST_MAP = [
  // text-muted-foreground and text-muted-foreground/N → text-foreground
  {
    re: new RegExp(
      `((?:${STATE_PREFIX_RE.source}:)*)text-muted-foreground(?:\\/\\d+)?\\b`,
      'g',
    ),
    replacer: (match, prefix) => (prefix ? match : 'text-foreground'),
  },
  // text-foreground/N where N is 0-80 → text-foreground (unprefixed only)
  {
    re: new RegExp(
      `((?:${STATE_PREFIX_RE.source}:)*)text-foreground\\/(\\d{1,2})\\b`,
      'g',
    ),
    replacer: (match, prefix, n) => {
      if (prefix) return match;
      const num = parseInt(n, 10);
      return num <= 80 ? 'text-foreground' : match;
    },
  },
];

// -- File selection (mirror each rule's lint exemptions) -------------------

function shouldSkip(filePath, rule) {
  const n = filePath.replace(/\\/g, '/');
  if (n.includes('/designTokens')) return true;
  if (n.endsWith('globals.css')) return true;
  if (n.includes('/.claude/')) return true;
  if (n.includes('/node_modules/')) return true;
  if (n.includes('/__tests__/') || n.includes('/test/')) return true;
  if (rule === 'radius' || rule === 'shadow') {
    if (n.includes('/src/lib/')) return true;
  }
  if (rule === 'radius') {
    if (n.includes('/src/features/shared/components/')) return true;
  }
  return false;
}

// -- Run ---------------------------------------------------------------------

const files = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
  .map((f) => path.join(ROOT, f))
  .filter((f) => !shouldSkip(f, rule));

const map = rule === 'radius' ? RADIUS_MAP : rule === 'shadow' ? SHADOW_MAP : LOW_CONTRAST_MAP;

let totalFiles = 0;
let totalSubs = 0;
const touchedFiles = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  let updated = src;
  let fileSubs = 0;

  for (const entry of map) {
    if (entry.replacer) {
      updated = updated.replace(entry.re, (...m) => {
        const replacement = entry.replacer(...m);
        if (replacement !== m[0]) fileSubs++;
        return replacement;
      });
    } else {
      updated = updated.replace(entry.re, () => {
        fileSubs++;
        return entry.to;
      });
    }
  }

  if (updated !== src) {
    totalFiles++;
    totalSubs += fileSubs;
    touchedFiles.push({ file: path.relative(ROOT, file), subs: fileSubs });
    if (!dry) writeFileSync(file, updated, 'utf8');
  }
}

console.log(`Rule: ${rule}`);
console.log(`Files scanned: ${files.length}`);
console.log(`Files modified: ${totalFiles}${dry ? ' (dry-run)' : ''}`);
console.log(`Total substitutions: ${totalSubs}`);
if (totalFiles > 0 && totalFiles <= 40) {
  console.log('\nTouched:');
  for (const { file, subs } of touchedFiles) {
    console.log(`  ${subs.toString().padStart(4)}  ${file}`);
  }
}
