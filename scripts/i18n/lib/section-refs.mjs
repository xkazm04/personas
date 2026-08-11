/**
 * Section-level reference scanner for the i18n catalog.
 *
 * Companion to `find-unused-i18n-keys.mjs`, which answers "is this KEY
 * referenced?". This module answers the coarser question the route-chunking
 * design actually depends on: **is this SECTION referenced anywhere, and from
 * which files?**
 *
 * ## Why a section-level scanner exists
 *
 * Non-English translations are shipped as one lazy chunk per top-level section
 * (`src/i18n/section-locales/<lang>/<section>.json`). A chunk is only fetched
 * if some route DECLARES the section in `src/i18n/routeSections.ts`
 * (`BASE_SECTIONS` or `ROUTE_SECTIONS[route]`). `getResolvedSection()` in
 * `useTranslation.ts` deliberately does NOT kick off a load from the property
 * getter (that caused a render storm), so an undeclared section is never
 * fetched — it silently and permanently resolves to English in every locale,
 * with no warning anywhere.
 *
 * That is invisible to every other gate: key-parity is green (the keys exist),
 * the value gate is green (the values ARE translated), and the dead-key scanner
 * is green (the keys ARE referenced). Only "referenced but undeclared" catches
 * it. `scripts/i18n/check-route-sections.mjs` is that gate; this module is the
 * reference half of it.
 *
 * ## Channels
 *
 * A section can be reached through more than one binding, and a channel this
 * scanner does not know about reads as "dead" — which is how the `debt` section
 * (539 keys, live in 113 files) looked unreferenced for months. Every known
 * channel:
 *
 *   1. `t.<section>.…`                     — useTranslation()
 *   2. `en.<section>.…`                    — the module-scope back-compat shim
 *   3. `getActiveTranslations().<section>`  — chained, non-React modules
 *   4. `const x = getActiveTranslations()` then `x.<section>.…`  — aliased
 *   5. `tokenLabel(t, '<category>', …)`     — dynamic status_tokens lookup
 *   6. `debtText('…')` / `<DebtText k=… />` — the `debt` staging channel
 *
 * ADDING A NEW CHANNEL: add its pattern here, not in a caller. Both the route
 * gate and any future consumer must agree on what "referenced" means.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '__mocks__', 'generated']);
const SKIP_FILE_RE = /\.(test|spec|stories)\.(ts|tsx)$/;

/** Recursively collect .ts/.tsx sources under `dir`. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, out);
    } else if (st.isFile()) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (SKIP_FILE_RE.test(name)) continue;
      out.push(full);
    }
  }
  return out;
}

const T_REF_RE = /\bt\.([a-z_][a-zA-Z0-9_]*)/g;
const TOKEN_LABEL_RE = /\btokenLabel\s*\(\s*t\s*,\s*['"][a-z_][a-zA-Z0-9_]*['"]/g;
const CHAINED_RE = /getActiveTranslations\s*\(\s*\)\.([a-z_][a-zA-Z0-9_]*)/g;
const ALIAS_DECL_RE = /(?:const|let|var)\s+(\w+)\s*=\s*getActiveTranslations\s*\(\s*\)(?!\s*\.)/g;
const DEBT_REF_RE = /\bdebtText\s*\(|<\s*DebtText\b/g;

const aliasRefRe = (name) =>
  new RegExp(`(?<![\\w.$])${name}\\.([a-z_][a-zA-Z0-9_]*)`, 'g');

/**
 * Scan a source tree for top-level i18n section references.
 *
 * @param {object} opts
 * @param {string} opts.root          repo root (absolute)
 * @param {string} opts.srcDir        source dir to walk (absolute)
 * @param {Iterable<string>} opts.sections  known top-level section names
 * @returns {Map<string, string[]>}   section -> sorted repo-relative file paths
 */
export function scanSectionReferences({ root, srcDir, sections }) {
  const known = new Set(sections);
  const bySection = new Map();

  const note = (section, relPath) => {
    if (!known.has(section)) return;
    let files = bySection.get(section);
    if (!files) {
      files = new Set();
      bySection.set(section, files);
    }
    files.add(relPath);
  };

  for (const file of walk(srcDir)) {
    const relPath = relative(root, file).replace(/\\/g, '/');
    // The i18n machinery names sections by string literal (routeSections.ts,
    // locales.manifest.ts, the generated section-string table). Those are
    // DECLARATIONS, not usages — counting them would make every section look
    // live and defeat the gate.
    if (relPath.startsWith('src/i18n/')) continue;

    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    let m;
    T_REF_RE.lastIndex = 0;
    while ((m = T_REF_RE.exec(src)) !== null) note(m[1], relPath);

    CHAINED_RE.lastIndex = 0;
    while ((m = CHAINED_RE.exec(src)) !== null) note(m[1], relPath);

    TOKEN_LABEL_RE.lastIndex = 0;
    if (TOKEN_LABEL_RE.test(src)) note('status_tokens', relPath);

    DEBT_REF_RE.lastIndex = 0;
    if (DEBT_REF_RE.test(src)) note('debt', relPath);

    // `en` (the back-compat shim) + any local alias of getActiveTranslations().
    const aliases = new Set(['en']);
    ALIAS_DECL_RE.lastIndex = 0;
    while ((m = ALIAS_DECL_RE.exec(src)) !== null) aliases.add(m[1]);
    for (const alias of aliases) {
      if (alias === 't') continue; // already covered by T_REF_RE
      const re = aliasRefRe(alias);
      while ((m = re.exec(src)) !== null) note(m[1], relPath);
    }
  }

  return new Map(
    [...bySection.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, files]) => [section, [...files].sort()]),
  );
}

/**
 * Parse `BASE_SECTIONS` and `ROUTE_SECTIONS` out of routeSections.ts.
 *
 * Deliberately a source parse rather than an import: this runs from plain node
 * (pre-commit / CI script context) where the TypeScript module and its
 * `@/stores/*` imports are not loadable.
 *
 * @param {string} source  contents of src/i18n/routeSections.ts
 * @returns {{ base: string[], routes: Record<string, string[]>, covered: Set<string> }}
 */
export function parseRouteSections(source) {
  // Anchor on the ASSIGNMENT, not on the first bracket after the identifier —
  // the type annotation `readonly TranslationSection[]` contributes a `[` that
  // silently produced an empty BASE_SECTIONS list on the first attempt.
  const base = parseArrayLiteral(sliceAfterAssignment(source, 'BASE_SECTIONS', '['), ']');

  const routesBody = sliceAfterAssignment(source, 'ROUTE_SECTIONS', '{');
  const routes = {};
  const ROUTE_ENTRY_RE = /['"]?([a-z][a-z0-9-]*)['"]?\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = ROUTE_ENTRY_RE.exec(routesBody)) !== null) {
    routes[m[1]] = [...m[2].matchAll(/['"]([a-z_][a-zA-Z0-9_]*)['"]/g)].map((x) => x[1]);
  }

  const covered = new Set(base);
  for (const list of Object.values(routes)) for (const s of list) covered.add(s);

  return { base, routes, covered };
}

/**
 * Return the substring starting just after `const <name> … = <open>`.
 * `open` is the literal opening bracket the initializer must start with.
 */
function sliceAfterAssignment(source, name, open) {
  const re = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\${open}`);
  const m = re.exec(source);
  if (!m) throw new Error(`routeSections.ts: could not find "const ${name} … = ${open}"`);
  return source.slice(m.index + m[0].length);
}

/** Collect quoted identifiers up to the first `close` character. */
function parseArrayLiteral(body, close) {
  const end = body.indexOf(close);
  const slice = end === -1 ? body : body.slice(0, end);
  return [...slice.matchAll(/['"]([a-z_][a-zA-Z0-9_]*)['"]/g)].map((m) => m[1]);
}
