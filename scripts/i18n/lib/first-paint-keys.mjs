/**
 * first-paint-keys — which keys of an i18n section the app can read before
 * first paint, for split-locales.mjs's "partial core" (2026-10-25).
 *
 * The startup path is the static import closure of src/main.tsx: everything
 * the entry imports without `import()`. That is computed here from source, so
 * codegen needs no build. Regex parsing, no resolver plugins: an extra edge
 * or an extra key only makes a partial a little larger, which is safe.
 *
 * A key is a first-paint key when, anywhere in that closure's source,
 *   - its name occurs as a whole word (`t.monitor.titlebar`, `m.titlebar`, a
 *     `'titlebar'` in a lookup table - aliasing does not hide it), or
 *   - it starts with a prefix the code completes at runtime: a template head
 *     (`` `dc_${kind}` ``) or a string literal ending in `_` (`'action_label_' + id`).
 * Recall over precision: generic names (`title`) match and stay in. A key
 * the rule still misses renders blank until the full section lands (about a
 * second, from the idle background load) and the reader re-renders - never a
 * throw, because a partial is read over the section's shape (useTranslation.ts).
 *
 * src/i18n/generated/ is excluded from the scan: it holds every key by
 * construction (the eager strings, SECTION_SHAPES), which would match all.
 */
import fs from 'node:fs';
import path from 'node:path';

const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const STATIC_IMPORT = /\b(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g;

function resolve(root, spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.join(path.dirname(fromFile), spec);
  else return null; // a package
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (/\.(ts|tsx|js|mjs)$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Source files statically reachable from `entry` (absolute paths). */
export function staticClosure(root, entry = path.join(root, 'src', 'main.tsx')) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(STATIC_IMPORT)) {
      if (m[2]) continue; // `import type` / `export type`: erased
      const dep = resolve(root, m[3].split('?')[0], file);
      if (dep && !seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}

/**
 * `{ section -> keys[] }` for the given sections of `english`, plus the
 * closure size for the caller's log line.
 */
export function firstPaintKeys(root, english, sections) {
  const closure = staticClosure(root);
  const generated = path.join(root, 'src', 'i18n', 'generated') + path.sep;
  let text = '';
  for (const file of closure) {
    if (file.startsWith(generated)) continue;
    text += fs.readFileSync(file, 'utf8') + '\n';
  }
  const words = new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g));
  const prefixes = [...new Set([...text.matchAll(/[`'"]([a-z][a-z0-9_]*_)(?:\$\{|['"`])/g)].map((m) => m[1]))];
  const out = {};
  for (const section of sections) {
    out[section] = Object.keys(english[section] ?? {}).filter((k) => words.has(k) || prefixes.some((p) => k.startsWith(p)));
  }
  return { keys: out, closureSize: closure.size };
}
