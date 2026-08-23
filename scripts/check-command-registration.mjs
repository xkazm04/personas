#!/usr/bin/env node
/**
 * check-command-registration — fails when a `#[tauri::command]` function is not
 * registered in any `generate_handler!` block.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `src-tauri/src/lib.rs` carries a structural test guarding ONE direction:
 * a registration naming a command that does not exist. Nothing guarded the
 * opposite direction, and by 2026-08-21 the tree held 73 `#[tauri::command]`
 * functions that were defined and never registered -- an IPC surface each one
 * advertises and none of them has. Zero were reachable from the frontend, so
 * nothing was broken at runtime; that is precisely why it went unnoticed for
 * so long, and precisely why it needs a gate rather than a reader.
 *
 * ---------------------------------------------------------------------------
 * WHY NODE AND NOT A RUST TEST
 * ---------------------------------------------------------------------------
 * The existing Rust guard hard-codes lib.rs's path, and lib.rs is about to be
 * decomposed. Both halves of this check are already solved in JS: registration
 * discovery by `discoverCommandNames` (scripts/generate-command-names.mjs) and
 * definition discovery by `discoverCommandDefinitions` (scripts/lib/
 * rustCommandDefs.mjs). Both walk directories rather than naming a file, so a
 * split lib.rs does not move them. Writing a third parser in Rust would be the
 * third parser.
 *
 * ---------------------------------------------------------------------------
 * THE ALLOWLIST IS TWO-SIDED
 * ---------------------------------------------------------------------------
 * Same convention as the census engine (scripts/census/rules.json:1-20): the
 * run fails when the finding set RISES, and also when an allowlisted entry
 * DROPS OUT without the file being updated. A silent drop is as much a signal
 * as a rise -- it is what a broken matcher looks like. Clearing an orphan is
 * a real event; it should cost one line in a file, not nothing.
 *
 * Usage:
 *   node scripts/check-command-registration.mjs          # gate
 *   node scripts/check-command-registration.mjs --json   # machine-readable
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverCommandNames } from "./generate-command-names.mjs";
import { discoverCommandDefinitions } from "./lib/rustCommandDefs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ALLOWLIST_REL = "scripts/command-registration-allowlist.txt";
export const ALLOWLIST_PATH = resolve(ROOT, ALLOWLIST_REL);

/**
 * Floor for the number of definitions the walk must SEE. Below it the result is
 * untrustworthy and the run fails with "matcher broken", not "codebase clean" --
 * because an empty definition set makes EVERY orphan disappear, which is a green
 * run that means nothing. 1,656 definitions at the commit that added this;
 * 1,400 is ~15% below, clear of ordinary churn and of a deliberate pruning wave.
 */
const MIN_DEFINITIONS = 1400;

/** Parse the allowlist: one bare command name per line, `#` comments ignored. */
export function parseAllowlist(text) {
  const names = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) names.push(line);
  }
  return names;
}

/**
 * The whole check, as data. Exported so the self-test can drive it over a
 * fixture tree without touching the real repo.
 *
 * @param {{rustRoot?: string, srcRoot?: string, allowlist?: string[], minDefinitions?: number}} [opts]
 */
export function checkCommandRegistration(opts = {}) {
  const { definitions, unresolved } = discoverCommandDefinitions(opts.rustRoot);
  const { names: registered } = discoverCommandNames(opts.srcRoot);

  const allowlist =
    opts.allowlist ?? parseAllowlist(readFileSync(ALLOWLIST_PATH, "utf-8"));
  const allowed = new Set(allowlist);
  const floor = opts.minDefinitions ?? MIN_DEFINITIONS;

  // First definition wins for reporting; duplicate names are cfg-gated variants
  // of the same command and are not a finding.
  const definedAt = new Map();
  for (const def of definitions) if (!definedAt.has(def.name)) definedAt.set(def.name, def);

  const registeredSet = new Set(registered);
  const orphans = [...definedAt.keys()].filter((n) => !registeredSet.has(n)).sort();
  const orphanSet = new Set(orphans);

  return {
    definitionCount: definitions.length,
    distinctDefinitions: definedAt.size,
    registeredCount: registered.length,
    orphans: orphans.map((n) => ({ name: n, ...definedAt.get(n) })),
    /** Orphans nobody signed off on. Any entry here fails the run. */
    unlisted: orphans.filter((n) => !allowed.has(n)),
    /** Allowlisted names that are no longer orphans -- stale exemptions. */
    stale: allowlist.filter((n) => !orphanSet.has(n)).sort(),
    /** Attributes whose `fn` the matcher could not find. Never expected. */
    unresolved,
    belowFloor: definitions.length < floor,
    floor,
  };
}

/** True when the result should fail the run. */
export function isFailure(r) {
  return Boolean(r.unlisted.length || r.stale.length || r.unresolved.length || r.belowFloor);
}

function main() {
  const json = process.argv.includes("--json");
  const r = checkCommandRegistration();

  if (json) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(isFailure(r) ? 1 : 0);
  }

  console.log(
    `${r.definitionCount} #[tauri::command] definitions (${r.distinctDefinitions} distinct), ` +
      `${r.registeredCount} registered, ${r.orphans.length} orphaned.`,
  );

  if (r.belowFloor) {
    console.error(
      `\nOnly ${r.definitionCount} definitions found; the floor is ${r.floor}.\n` +
        "Refusing to report on a partial scan -- an empty definition set makes every\n" +
        "orphan vanish, which looks exactly like a clean tree. Fix the walk, or lower\n" +
        "MIN_DEFINITIONS in this file in the same commit that removes the commands.",
    );
  }

  if (r.unresolved.length) {
    console.error(
      `\n${r.unresolved.length} #[tauri::command] attribute(s) with no resolvable fn:\n` +
        r.unresolved.map((u) => `  src-tauri/${u.file}:${u.line}`).join("\n") +
        "\nThe matcher, not the code, is what to look at first.",
    );
  }

  if (r.unlisted.length) {
    const byName = new Map(r.orphans.map((o) => [o.name, o]));
    console.error(
      `\n${r.unlisted.length} command(s) defined but never registered:\n` +
        r.unlisted
          .map((n) => `  ${n}  --  src-tauri/${byName.get(n).file}:${byName.get(n).line}`)
          .join("\n") +
        "\n\n`#[tauri::command]` on an unregistered fn advertises an IPC surface that\n" +
        "does not exist: the frontend can name it, and the invoke fails at runtime.\n" +
        "Either add it to a generate_handler! list, or remove the attribute.\n" +
        `If it is knowingly pending, add it to ${ALLOWLIST_REL} with a reason.`,
    );
  }

  if (r.stale.length) {
    console.error(
      `\n${r.stale.length} allowlisted name(s) are no longer orphans:\n` +
        r.stale.map((n) => `  ${n}`).join("\n") +
        "\n\nEither they were registered/removed (good -- delete the line), or the\n" +
        "matcher stopped seeing them (bad). A silent drop is as much a signal as a\n" +
        `rise, so this fails rather than quietly shrinking ${ALLOWLIST_REL}.`,
    );
  }

  if (isFailure(r)) process.exit(1);
  console.log(`All orphans accounted for (${r.orphans.length} allowlisted).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
