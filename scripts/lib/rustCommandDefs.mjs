/**
 * rustCommandDefs — every `#[tauri::command]` function DEFINED under src-tauri/.
 *
 * The registration side of this question already has a scanner
 * (`discoverCommandNames` in scripts/generate-command-names.mjs). This is its
 * mirror: what was *defined*. Kept in its own module so the guard and its
 * self-test share one implementation and a fixture tree can be pointed at it.
 *
 * ---------------------------------------------------------------------------
 * THE TWO TRAPS THIS EMBODIES (both hit on the way here, 2026-08-21)
 * ---------------------------------------------------------------------------
 *
 * 1. MASKING IS LOAD-BEARING, NOT HYGIENE. `#[tauri::command]` appears 1,680
 *    times in the raw text of src-tauri/ but only 1,668 of those are real
 *    definitions. Eight sit inside `///` doc examples (macros/src/lib.rs shows
 *    the attribute four times in the `#[requires]` rustdoc; core/src/
 *    context_fingerprint.rs and commands/testing/mod.rs quote it too) and four
 *    inside lib.rs's own `#[cfg(test)]` structural test. A raw scan counts all
 *    twelve, and every one of them becomes a phantom orphan.
 *
 * 2. `isRustTestFile()` IS THE WRONG FILTER FOR THE DEFINITION SIDE. It is
 *    correct for `generate_handler!` discovery, but applied here it drops NINE
 *    REAL, REGISTERED COMMANDS purely on filename:
 *      commands/companion/browser_test.rs   (3)  matches /_test\.rs$/
 *      commands/execution/test_suites.rs    (5)  matches /^tests?_/
 *      test_automation.rs                   (1)  matches /^tests?_/
 *    All nine are in the live handler list. Filtering them out reports them as
 *    "registered but not defined" -- a whole screen of confident nonsense. So
 *    the definition walk excludes only real test *directories* (tests/,
 *    benches/) and lets `stripCfgTest` handle in-file test modules, which is
 *    an attribute-driven judgement rather than a filename guess.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCfgTest } from "../census/lib/instruments/stripCfgTest.mjs";
import { maskRustLiteralsAndComments } from "../census/lib/instruments/extractRustStrings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUST_ROOT = resolve(__dirname, "../../src-tauri");

const ATTR = "#[tauri::command]";

/** Directories that are test/build output and never hold a live command. */
const SKIP_DIRS = new Set(["target", "node_modules", "gen"]);

/** A path segment that means "this whole directory is test code". */
const TEST_DIR = /(^|\/)(tests|benches)\//;

/**
 * The `fn` header, allowing every visibility/qualifier spelling in this tree.
 * Anchored at the start of the slice, so it only matches when the very next
 * token after the attribute run IS the function.
 */
const FN_HEADER =
  /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/;

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

/** Every `.rs` file under `dir` that is not in a test/bench directory. */
function rustSourceFiles(dir, root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      rustSourceFiles(full, root, out);
      continue;
    }
    if (!entry.name.endsWith(".rs")) continue;
    const rel = relative(root, full).split(sep).join("/");
    if (TEST_DIR.test(rel)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Definitions inside one already-masked file.
 *
 * After the attribute there may be ANY number of further attributes, doc
 * comments and blank lines before the `fn`. The naive shape --
 * `/#\[tauri::command\]\s*(?:#\[[^\]]*\]\s*)*(?:pub )?fn (\w+)/` -- allows only
 * `#[...]` in between and so misses every command whose attribute is followed
 * by a doc comment (`#[tauri::command]` then `/// …` then `fn`), of which this
 * tree has several. Worse, it fails SILENTLY: the definition disappears and
 * the command it registers becomes a phantom "registered but undefined".
 *
 * So: walk forward token-run by token-run, bracket-matching each attribute
 * (which may itself contain `]`, e.g. `#[cfg(all(not(a), b))]`), skipping
 * whitespace, and stopping at the first thing that is not an attribute. Doc
 * comments are already whitespace by the time we get here, because the caller
 * masked them.
 */
function definitionsIn(masked, rel) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = masked.indexOf(ATTR, from);
    if (at === -1) break;
    from = at + ATTR.length;

    let i = from;
    let name = null;
    for (let guard = 0; guard < 500; guard++) {
      while (i < masked.length && /\s/.test(masked[i])) i++;
      if (masked[i] === "#") {
        const open = masked.indexOf("[", i);
        if (open === -1) break;
        let depth = 1;
        let k = open + 1;
        while (k < masked.length && depth > 0) {
          if (masked[k] === "[") depth++;
          else if (masked[k] === "]") depth--;
          k++;
        }
        if (depth !== 0) break;
        i = k;
        continue;
      }
      const m = FN_HEADER.exec(masked.slice(i, i + 300));
      if (m) name = m[1];
      break;
    }
    out.push({ name, file: rel, line: lineOf(masked, at) });
  }
  return out;
}

/**
 * Every `#[tauri::command]` definition under `rustRoot`.
 *
 * @param {string} [rustRoot] directory to scan (default: src-tauri)
 * @returns {{definitions: Array<{name: string|null, file: string, line: number}>,
 *            unresolved: Array<{file: string, line: number}>}}
 *   `unresolved` is an attribute whose `fn` could not be found -- a matcher
 *   failure, reported rather than dropped.
 */
export function discoverCommandDefinitions(rustRoot = DEFAULT_RUST_ROOT) {
  const definitions = [];
  const unresolved = [];
  for (const file of rustSourceFiles(rustRoot, rustRoot)) {
    const raw = readFileSync(file, "utf-8");
    if (!raw.includes(ATTR)) continue; // cheap pre-filter; the scan is on the mask
    const rel = relative(rustRoot, file).split(sep).join("/");
    const masked = maskRustLiteralsAndComments(stripCfgTest(raw));
    for (const def of definitionsIn(masked, rel)) {
      if (def.name) definitions.push(def);
      else unresolved.push({ file: def.file, line: def.line });
    }
  }
  definitions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { definitions, unresolved };
}
