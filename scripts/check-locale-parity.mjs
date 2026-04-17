#!/usr/bin/env node
/**
 * Locale parity checker — diffs all translation locale files against
 * the English source of truth (en.ts) and reports missing keys.
 *
 * Usage:
 *   node scripts/check-locale-parity.mjs           # Check all locales
 *   node scripts/check-locale-parity.mjs --json     # Machine-readable output
 *   node scripts/check-locale-parity.mjs cs de      # Check specific locales only
 *
 * Exit codes:
 *   0 = all locales have 100% key coverage
 *   1 = at least one locale has missing keys
 *
 * This script uses dynamic import() to load the .ts locale files via
 * the tsx loader. Make sure tsx is installed (npx tsx works too).
 */
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = resolve(__dirname, "../src/i18n");

// ---------------------------------------------------------------------------
// Key extraction from TypeScript source (regex-based, no transpiler needed)
// ---------------------------------------------------------------------------

/**
 * Extract all dotted key paths from a TypeScript translation object.
 * Strips string contents and comments before counting braces so that
 * interpolation placeholders like {count} don't corrupt the nesting depth.
 */
function extractKeys(filePath) {
  const src = readFileSync(filePath, "utf-8");
  const keys = [];
  const stack = [];
  let inExport = false;

  for (const line of src.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comment-only lines
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Detect the start of the exported object
    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) {
        inExport = true;
      }
      continue;
    }

    // Strip string contents to avoid counting {count} style placeholders as braces.
    // Replace "..." and '...' and `...` contents with empty strings.
    const stripped = trimmed
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '""');

    // Count net closing braces on the stripped line to track nesting
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    const netClose = closes - opens;

    // Detect a key: value line (key may be quoted or unquoted)
    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];

      // If the value (after stripping strings) opens a brace that isn't closed on the
      // same line (opens > closes), it's a multi-line nested object — push to the path stack.
      // If opens === closes the braces are balanced on this line (inline object like
      // `key: { a: "x", b: "y" },`); do NOT push, or the key accumulates on the stack
      // forever and corrupts every subsequent leaf path.
      const afterColon = stripped.slice(stripped.indexOf(":") + 1);
      if (afterColon.includes("{") && opens > closes) {
        stack.push(key);
      } else if (!afterColon.includes("{")) {
        // Leaf key
        const fullKey = [...stack, key].join(".");
        keys.push(fullKey);
      }
      // else: inline object (opens === closes) — leaf keys inside are not individually
      // parseable from this line, so skip silently (same behaviour as before the bug).
    }
    for (let i = 0; i < netClose && stack.length > 0; i++) {
      stack.pop();
    }

    // Detect end of the export: a line that is just `};` with an empty stack
    if (stripped === "};" && stack.length === 0) break;
  }

  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const requestedLocales = args.filter((a) => !a.startsWith("--"));

// Discover locale files
const allFiles = readdirSync(I18N_DIR).filter(
  (f) => f.endsWith(".ts") && !f.startsWith("use") && f !== "en.ts" && f !== "tokenMaps.ts" && f !== "useTranslatedError.ts"
);

const locales = requestedLocales.length > 0
  ? allFiles.filter((f) => requestedLocales.includes(basename(f, ".ts")))
  : allFiles;

// Extract English keys (source of truth)
const enKeys = extractKeys(resolve(I18N_DIR, "en.ts"));
const enCount = enKeys.size;

// Compare each locale
const results = [];
let hasMissing = false;

for (const file of locales.sort()) {
  const lang = basename(file, ".ts");
  const localeKeys = extractKeys(resolve(I18N_DIR, file));
  const missing = [];

  for (const key of enKeys) {
    if (!localeKeys.has(key)) {
      missing.push(key);
    }
  }

  const coverage = ((enCount - missing.length) / enCount * 100).toFixed(1);

  results.push({
    lang,
    total: enCount,
    present: enCount - missing.length,
    missing: missing.length,
    coverage,
    missingKeys: missing,
  });

  if (missing.length > 0) hasMissing = true;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (jsonMode) {
  console.log(JSON.stringify({ enKeyCount: enCount, locales: results }, null, 2));
} else {
  console.log(`\nLocale parity check — ${enCount} keys in en.ts\n`);
  console.log("Lang  | Present | Missing | Coverage");
  console.log("------|---------|---------|--------");

  for (const r of results) {
    const status = r.missing === 0 ? " ✓" : "";
    console.log(
      `${r.lang.padEnd(5)} | ${String(r.present).padStart(7)} | ${String(r.missing).padStart(7)} | ${r.coverage.padStart(6)}%${status}`
    );
  }

  // Show missing key details for locales with gaps
  const withGaps = results.filter((r) => r.missing > 0);
  if (withGaps.length > 0) {
    console.log("\n--- Missing keys by locale ---\n");
    for (const r of withGaps) {
      console.log(`${r.lang} (${r.missing} missing):`);
      // Group by top-level section
      const sections = {};
      for (const key of r.missingKeys) {
        const section = key.split(".")[0];
        if (!sections[section]) sections[section] = [];
        sections[section].push(key);
      }
      for (const [section, keys] of Object.entries(sections)) {
        console.log(`  ${section}:`);
        for (const k of keys) {
          console.log(`    - ${k}`);
        }
      }
      console.log();
    }
  }
}

process.exit(hasMissing ? 1 : 0);
