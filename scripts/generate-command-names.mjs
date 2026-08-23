#!/usr/bin/env node
/**
 * Extracts Tauri command names from the `generate_handler![ ... ]` registration
 * list(s) under `src-tauri/src/` and generates a TypeScript union type for
 * type-safe invoke calls.
 *
 * Usage: node scripts/generate-command-names.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A DIRECTORY SCAN AND NOT A REGEX AGAINST lib.rs
 * ---------------------------------------------------------------------------
 * Until 2026-08-20 this script matched exactly one shape, in exactly one file:
 *
 *     /invoke_handler\(tauri::generate_handler!\[\s*([\s\S]*?)\]\)/   on lib.rs
 *
 * Three things were wrong with that, and the Rust refactor (Wave 1 splits the
 * 4,020-line lib.rs, of which ~1,934 lines are this list) breaks all three:
 *
 *   1. It hard-codes the FILE. Move the list to `handlers.rs` and the regex
 *      stops matching -- and the script `process.exit(1)`s, which is the good
 *      half of the outcome. The bad half is (3).
 *   2. It hard-codes the CALL SHAPE, including the wrapper. The live call site
 *      is `ipc_auth::wrap_invoke_handler(tauri::generate_handler![`, which the
 *      old regex matched only by accident -- `wrap_invoke_handler(` happens to
 *      end in the literal `invoke_handler(`. Wrap it in anything else, or
 *      compose the list from per-domain functions, and it silently misses.
 *   3. It assumes ONE list. Split the registration across several
 *      `generate_handler!` invocations and a single-match regex emits only the
 *      first -- a SHORTER generated file that still type-checks, so every
 *      newly-missing command silently falls through to the overrides union
 *      instead of failing.
 *
 * So: scan every non-test `.rs` file under `src-tauri/src/`, find every
 * `generate_handler![`, bracket-match its body, and union the results.
 *
 * A union across files silently tolerates a list that got dropped entirely, so
 * it is paired with MIN_COMMANDS below -- a floor that fails loudly rather than
 * emitting a shorter file. A gate that silently no-ops is worse than no gate.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SOURCE IS MASKED BEFORE SCANNING (load-bearing, not hygiene)
 * ---------------------------------------------------------------------------
 * Bracket-matching raw Rust source does not work on this file. `lib.rs:2428`
 * carries a comment containing an unbalanced `[` -- the text "#[cfg(" quoted
 * inside a `//` comment, sitting INSIDE the handler list. A naive depth counter
 * never returns to zero at the list's real `]` and runs off the end of the
 * file. (The Rust-side twin of this scanner, `generate_handler_body()` at
 * lib.rs:3931, does exactly that and is broken by it today -- see
 * docs/plans/rust-refactor/w0-codegen-coupling.md.)
 *
 * `#[cfg(test)]` modules are stripped first for the same class of reason: the
 * Rust test module contains the string literal "generate_handler![", which a
 * plain indexOf would happily treat as another registration list.
 *
 * Both passes are line- and offset-preserving, so every reported `file:line`
 * refers to the real source.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { stripCfgTest, isRustTestFile } from "./census/lib/instruments/stripCfgTest.mjs";
import { maskRustLiteralsAndComments } from "./census/lib/instruments/extractRustStrings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_SRC_ROOT = resolve(ROOT, "src-tauri/src");
const OUTPUT = resolve(ROOT, "src/lib/commandNames.generated.ts");
const OVERRIDES = resolve(ROOT, "src/lib/commandNames.overrides.ts");

/**
 * Floor for the discovered command count. Below this, the script fails instead
 * of writing a shorter file.
 *
 * The registration list yielded 1,592 distinct commands when this floor was
 * set (2026-08-20). 1,400 is ~12% below that: clear of ordinary churn
 * and of a deliberate pruning wave, but far below any realistic *partial*
 * discovery -- the smallest plausible per-domain split of this list is a
 * handful of blocks of a few hundred each, so losing even one block lands
 * under the floor.
 *
 * Lowering this number is a deliberate act. If a real removal pass takes the
 * count below it, lower the floor in the same commit that removes the
 * commands, with the new count in the commit message.
 */
const MIN_COMMANDS = 1400;

/** Every `.rs` file under `dir` that is not test code, recursively. */
function rustSourceFiles(dir, srcRoot) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === "node_modules") continue;
      out.push(...rustSourceFiles(full, srcRoot));
      continue;
    }
    if (!entry.name.endsWith(".rs")) continue;
    const rel = relative(srcRoot, full).split(sep).join("/");
    if (isRustTestFile(rel)) continue;
    out.push(full);
  }
  return out;
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

/**
 * Find every `generate_handler![ ... ]` body in `code` (already masked).
 * @returns {Array<{body: string, startLine: number}>}
 */
function handlerBlocksIn(code) {
  const blocks = [];
  const needle = "generate_handler![";
  let from = 0;
  for (;;) {
    const start = code.indexOf(needle, from);
    if (start === -1) break;
    const open = start + needle.length;
    let depth = 1;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      const ch = code[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      // Unterminated even after masking -- a real syntax problem, not a stray
      // bracket in a comment. Refuse rather than guess a body.
      throw new Error(
        `unterminated generate_handler![ at line ${lineOf(code, start)}`,
      );
    }
    blocks.push({ body: code.slice(open, end), startLine: lineOf(code, start) });
    from = end + 1;
  }
  return blocks;
}

/** A Rust path: `foo` or `a::b::c`. Anything else in the list is not a command. */
const RUST_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Parse one handler body into bare command names.
 * @returns {{names: string[], rejects: string[]}}
 */
function parseHandlerBody(body) {
  const names = [];
  const rejects = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    // Comments are already blanked by the mask; attributes and blanks are not.
    if (!trimmed || trimmed.startsWith("#[") || trimmed.startsWith("//")) continue;

    // One registration per line, optional trailing comma.
    const match = trimmed.match(/^([\w:]+),?$/);
    if (!match || !RUST_PATH.test(match[1])) {
      rejects.push(trimmed);
      continue;
    }
    const fullPath = match[1];
    const name = fullPath.includes("::") ? fullPath.split("::").pop() : fullPath;
    if (name) names.push(name);
  }
  return { names, rejects };
}

/**
 * Discover every registered command name under `srcRoot`.
 * Exported so the test suite can point it at a fixture tree.
 *
 * @param {string} [srcRoot] directory to scan (default: src-tauri/src)
 * @returns {{names: string[], blocks: Array<{file: string, startLine: number, count: number}>, rejects: Array<{file: string, line: string}>}}
 */
export function discoverCommandNames(srcRoot = DEFAULT_SRC_ROOT) {
  const all = [];
  const blocks = [];
  const rejects = [];

  for (const file of rustSourceFiles(srcRoot, srcRoot)) {
    const raw = readFileSync(file, "utf-8");
    // Cheap pre-filter on the raw text; the authoritative scan is on the mask.
    if (!raw.includes("generate_handler![")) continue;
    const code = maskRustLiteralsAndComments(stripCfgTest(raw));
    const rel = relative(srcRoot, file).split(sep).join("/");
    for (const block of handlerBlocksIn(code)) {
      const { names, rejects: bad } = parseHandlerBody(block.body);
      blocks.push({ file: rel, startLine: block.startLine, count: names.length });
      all.push(...names);
      for (const line of bad) rejects.push({ file: rel, line });
    }
  }

  blocks.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  return { names: [...new Set(all)].sort(), blocks, rejects };
}

function main() {
  const { names: unique, blocks, rejects } = discoverCommandNames();

  for (const block of blocks) {
    console.log(`  ${block.file}:${block.startLine} -- ${block.count} commands`);
  }

  if (blocks.length === 0) {
    console.error(
      "No generate_handler![ ... ] list found under src-tauri/src/.\n" +
        "The registration list moved somewhere this scan does not reach, or it is gone.",
    );
    process.exit(1);
  }

  if (rejects.length > 0) {
    console.error(
      `Unparseable lines inside generate_handler![ ... ] (${rejects.length}):\n` +
        rejects.map((r) => `  ${r.file}: ${r.line}`).join("\n") +
        "\nEvery non-attribute, non-comment line in the list must be a single Rust path.",
    );
    process.exit(1);
  }

  if (unique.length < MIN_COMMANDS) {
    console.error(
      `Discovered only ${unique.length} commands across ${blocks.length} handler ` +
        `block(s); the floor is ${MIN_COMMANDS}.\n` +
        "Refusing to write a shorter commandNames.generated.ts -- a partial scan " +
        "looks exactly like a successful one downstream.\n" +
        "If commands were genuinely removed, lower MIN_COMMANDS in " +
        "scripts/generate-command-names.mjs in the same commit.",
    );
    process.exit(1);
  }

  const sourceNote =
    blocks.length === 1
      ? `src-tauri/src/${blocks[0].file} invoke_handler`
      : `${blocks.length} generate_handler! lists under src-tauri/src/`;

  const output = `// AUTO-GENERATED by scripts/generate-command-names.mjs — DO NOT EDIT
// Re-run: node scripts/generate-command-names.mjs
//
// Generated from ${sourceNote} (${unique.length} commands)

/**
 * Union of every Tauri command name registered in the invoke_handler.
 * Using this type in \`invokeWithTimeout\` ensures command name typos are
 * caught at compile time.
 */
export type CommandName =
${unique.map((c) => `  | "${c}"`).join("\n")};
`;

  writeFileSync(OUTPUT, output, "utf-8");
  console.log(`Generated ${OUTPUT} with ${unique.length} command names.`);

  // --- Auto-prune stale overrides ---
  const registeredSet = new Set(unique);
  const overridesSrc = readFileSync(OVERRIDES, "utf-8");

  // Extract every quoted command name from the overrides union
  const overrideNames = [...overridesSrc.matchAll(/"([\w]+)"/g)].map((m) => m[1]);
  const stale = overrideNames.filter((n) => registeredSet.has(n));
  const remaining = overrideNames.filter((n) => !registeredSet.has(n));

  if (stale.length > 0) {
    // Rebuild the file cleanly from the remaining commands
    const header = `/**
 * Commands referenced in the frontend that are NOT yet registered in the Rust
 * invoke_handler. These are either planned commands or dead code.
 *
 * When a command is implemented and added to lib.rs invoke_handler, re-run
 * \`node scripts/generate-command-names.mjs\` and remove it from this list.
 */
`;

    let overridesOutput;
    if (remaining.length === 0) {
      // No overrides left — export a never type so the union in tauriInvoke.ts still compiles
      overridesOutput = `${header}export type UnregisteredCommand = never;\n`;
    } else {
      overridesOutput = `${header}export type UnregisteredCommand =\n${remaining.map((c) => `  | "${c}"`).join("\n")};\n`;
    }

    writeFileSync(OVERRIDES, overridesOutput, "utf-8");
    console.log(`Pruned ${stale.length} stale overrides (${remaining.length} remaining).`);
  } else {
    console.log("No stale overrides found.");
  }
}

// Run only when invoked directly; importable for tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
