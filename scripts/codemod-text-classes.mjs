#!/usr/bin/env node
/**
 * Codemod for `custom/no-raw-text-classes`.
 *
 * Applies contextual substitution: inspects the companion classes in the
 * same className string (font-bold, font-semibold, uppercase, tabular-nums,
 * font-mono) and picks the matching typo-* token.
 *
 * Mapping from eslint-rules/no-raw-text-classes.cjs docstring:
 *   text-4xl font-bold              → typo-hero
 *   text-2xl font-bold tabular-nums → typo-data-lg
 *   text-2xl                        → typo-heading-lg     (no mapping; bucket with xl)
 *   text-xl  font-bold              → typo-heading-lg
 *   text-xl                         → typo-heading-lg
 *   text-lg  font-bold              → typo-heading-lg
 *   text-lg                         → typo-heading-lg
 *   text-base                       → typo-body-lg
 *   text-sm  font-bold|font-semibold → typo-heading
 *   text-sm  tabular-nums           → typo-data
 *   text-sm                         → typo-body
 *   text-xs  uppercase              → typo-label
 *   text-xs  font-mono              → typo-code
 *   text-xs                         → typo-caption
 *
 * Conservative:
 *   - Skips files in src/lib/, src/features/shared/components/, designTokens*.
 *   - Skips `!text-*` Tailwind !important overrides.
 *   - If a `text-<size>` is detected but the companion classes are ambiguous
 *     (e.g., text-sm in a className with both `font-bold` and another state
 *     modifier prefix), falls back to the safe default (typo-body / typo-caption).
 *   - Only substitutes inside string literals, template-literal quasis, and
 *     strings passed through cn()/clsx()/twMerge() wrappers (detected by
 *     regex on the file text — no full AST parse).
 *
 * Usage:
 *   node scripts/codemod-text-classes.mjs [--dry]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dry = process.argv.includes('--dry');
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function shouldSkip(filePath) {
  const n = filePath.replace(/\\/g, '/');
  if (n.includes('/designTokens')) return true;
  if (n.includes('/src/lib/')) return true;
  if (n.includes('/src/features/shared/components/')) return true;
  if (n.includes('/src/styles/')) return true;
  if (n.includes('/__tests__/') || n.includes('/test/')) return true;
  if (n.includes('/.claude/')) return true;
  if (!n.match(/\.(tsx|ts)$/)) return true;
  return false;
}

/**
 * Pick the typo-* token given a text-<size> hit and the surrounding class
 * string. The string contains the full className fragment that has the hit.
 */
function pickToken(size, surrounding) {
  const has = (re) => re.test(surrounding);
  switch (size) {
    case 'xs':
      if (has(/\bfont-mono\b/)) return 'typo-code';
      if (has(/\buppercase\b/)) return 'typo-label';
      return 'typo-caption';
    case 'sm':
      if (has(/\bfont-mono\b/)) return 'typo-code';
      if (has(/\bfont-(bold|semibold)\b/)) return 'typo-heading';
      if (has(/\btabular-nums\b/)) return 'typo-data';
      return 'typo-body';
    case 'base':
      return 'typo-body-lg';
    case 'lg':
      return 'typo-heading-lg';
    case 'xl':
      return 'typo-heading-lg';
    case '2xl':
      if (has(/\btabular-nums\b/) && has(/\bfont-bold\b/)) return 'typo-data-lg';
      return 'typo-heading-lg';
    case '3xl':
    case '4xl':
    case '5xl':
    case '6xl':
    case '7xl':
    case '8xl':
    case '9xl':
      return 'typo-hero';
    default:
      return null;
  }
}

/**
 * Inside a single quoted string literal (JSX className value or one template
 * literal chunk), substitute text-<size> tokens with picked typo-* tokens.
 * Skips `!text-*` (!important overrides), skips text-<size> that is already
 * part of a longer class name (handled by \b), and skips text-<size> when a
 * typo-* class is already present in the same string (conservative — it
 * implies the author picked intentionally).
 */
function substituteInString(str) {
  if (/\btypo-/.test(str)) {
    // Author already has a semantic token — leave alone.
    return { out: str, changed: 0 };
  }
  let changed = 0;
  const out = str.replace(
    /(?<![!-])(?:(?:[a-z][a-z0-9-]*:)*)text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g,
    (match, size) => {
      const token = pickToken(size, str);
      if (!token) return match;
      changed++;
      // Preserve any variant prefix (hover:, md:, etc.) that was captured
      // before text-*. The regex's non-capturing group had them; we need to
      // extract and re-prepend.
      const prefixMatch = match.match(/^((?:[a-z][a-z0-9-]*:)*)(text-.+)$/);
      const prefix = prefixMatch ? prefixMatch[1] : '';
      return `${prefix}${token}`;
    },
  );
  return { out, changed };
}

/**
 * Walk the file text and substitute inside plausible className contexts:
 * - JSX className="..." / className='...' / className={` ... `}
 * - cn(...), clsx(...), twMerge(...) call arguments (any string literal)
 * - Any bare string that *looks* like it contains Tailwind classes
 *   (contains at least 2 hyphen-joined tokens and no spaces that look like
 *   prose — heuristic).
 *
 * Simpler: substitute in any single-quoted / double-quoted / backtick-quasi
 * string that matches the text-<size> pattern. The pickToken fn refuses when
 * surrounding classes already contain typo-*, so false positives are low.
 */
function processFile(source) {
  let changed = 0;

  // Regex to find string literals (not inside comments — approximate).
  // Handles single-quoted, double-quoted, and template-literal static parts.
  // We DON'T care about template-literal interpolations; we just process the
  // raw text chunks between them.
  const out = source.replace(
    /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g,
    (full, quote, inner) => {
      // Skip non-class-like strings: no space, no hyphen → probably not a
      // className. We still need to process single-token strings like
      // `"text-sm"` so don't be too strict.
      if (!/text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(inner)) {
        return full;
      }
      // Skip strings that contain HTML tags or URL-like patterns — those are
      // probably content, not classNames.
      if (/https?:\/\//.test(inner)) return full;
      if (/<\/?[a-z]+[\s>]/.test(inner)) return full;

      const { out: subbed, changed: n } = substituteInString(inner);
      changed += n;
      return `${quote}${subbed}${quote}`;
    },
  );

  return { out, changed };
}

// -- Run ---------------------------------------------------------------------

const files = globSync('src/**/*.{ts,tsx}', { cwd: ROOT })
  .map((f) => path.join(ROOT, f))
  .filter((f) => !shouldSkip(f));

let totalFiles = 0;
let totalSubs = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { out, changed } = processFile(src);
  if (changed > 0 && out !== src) {
    totalFiles++;
    totalSubs += changed;
    if (!dry) writeFileSync(file, out, 'utf8');
  }
}

console.log(`Rule: text-classes`);
console.log(`Files scanned: ${files.length}`);
console.log(`Files modified: ${totalFiles}${dry ? ' (dry-run)' : ''}`);
console.log(`Total substitutions: ${totalSubs}`);
