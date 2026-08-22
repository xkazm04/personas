#!/usr/bin/env node
/**
 * check-binding-orphans — the INVENTORY-shaped gate on `src/lib/bindings/`.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND BINDING GATE
 * ---------------------------------------------------------------------------
 * CI already guards bindings with `git diff --quiet src/lib/bindings/` plus an
 * untracked-file check. That is DIFF-shaped, and it cannot see an orphan by
 * construction: ts-rs never deletes, so when a Rust type loses its
 * `#[derive(TS)] #[ts(export)]` — or disappears entirely — the generated `.ts`
 * simply stays on disk. No diff. No untracked file. Nothing to fail on. The
 * binding then freezes at whatever shape it had the day the type went away,
 * while the command it types keeps evolving.
 *
 * That is not hypothetical here: 35 such files exist today, 30 of them still
 * referenced by app code and 20 still the declared return type of a live
 * `invoke<T>` — which is exactly why `scripts/check-unused-bindings.sh` PROTECTS
 * them. "Imported" is its definition of used, so the most dangerous orphans are
 * the ones it certifies as fine.
 *
 * Only an inventory of what SHOULD exist finds these, so this script builds one
 * from the Rust tree (scripts/lib/rustTsExports.mjs) and compares both ways:
 *
 *   ORPHAN   a `src/lib/bindings/*.ts` with no `#[ts(export)]` type behind it.
 *   MISSING  an `#[ts(export)]` type with no committed binding file. The mirror
 *            image, and a real class: four exist today, all in personas-core,
 *            none feature-gated. Regenerating bindings would create them.
 *
 * ---------------------------------------------------------------------------
 * THE ALLOWLISTS ARE TWO-SIDED
 * ---------------------------------------------------------------------------
 * Same convention as scripts/check-command-registration.mjs and the census
 * engine: the run fails when the finding set RISES, and ALSO when an allowlisted
 * entry DROPS OUT without the file being updated. A silent drop is what a broken
 * matcher looks like, and a matcher that finds nothing produces a green run that
 * means nothing. Clearing an orphan is a real event; it should cost one deleted
 * line, not nothing.
 *
 * Usage:
 *   node scripts/check-binding-orphans.mjs          # gate
 *   node scripts/check-binding-orphans.mjs --json   # machine-readable
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTsExports } from "./lib/rustTsExports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BINDINGS_DIR = join(ROOT, "src", "lib", "bindings");

export const ORPHAN_ALLOWLIST_REL = "scripts/binding-orphan-allowlist.txt";
export const MISSING_ALLOWLIST_REL = "scripts/binding-missing-allowlist.txt";

/**
 * Floors on what each half of the walk must SEE. Below either, the comparison is
 * meaningless in the direction that matters: zero Rust exports makes EVERY
 * binding an orphan (a loud failure, survivable) and zero binding files makes
 * every Rust type "missing" — but also makes the orphan set EMPTY, which is a
 * green run that means nothing. Measured at the commit that added this: 1,008
 * exports, 1,039 binding files. Floors sit ~20% below.
 */
const MIN_RUST_EXPORTS = 800;
const MIN_BINDING_FILES = 800;

/** Parse an allowlist: one bare type name per line, `#` starts a comment. */
export function parseAllowlist(text) {
  const names = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) names.push(line);
  }
  return names;
}

/**
 * Top-level binding module names. Non-recursive on purpose: ts-rs also writes
 * `serde_json/JsonValue.ts`, which has no `#[ts(export)]` type of its own (it is
 * ts-rs's own mapping for `serde_json::Value`) and would be a permanent false
 * orphan.
 */
export function listBindingFiles(dir = BINDINGS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== "index.ts")
    .map((e) => e.name.slice(0, -3))
    .sort();
}

/**
 * The whole check, as data. Exported so the self-test can drive it over a
 * fixture tree without touching the real repo.
 *
 * @param {{rustRoot?: string, bindingsDir?: string, orphanAllowlist?: string[],
 *          missingAllowlist?: string[], minRustExports?: number,
 *          minBindingFiles?: number}} [opts]
 */
export function checkBindingOrphans(opts = {}) {
  const { exports, unresolved, renamed } = discoverTsExports(opts.rustRoot);
  const files = listBindingFiles(opts.bindingsDir);

  const exported = new Map();
  for (const e of exports) if (!exported.has(e.name)) exported.set(e.name, e);
  const fileSet = new Set(files);

  const orphanAllow =
    opts.orphanAllowlist ??
    parseAllowlist(readFileSync(join(ROOT, ORPHAN_ALLOWLIST_REL), "utf-8"));
  const missingAllow =
    opts.missingAllowlist ??
    parseAllowlist(readFileSync(join(ROOT, MISSING_ALLOWLIST_REL), "utf-8"));

  const orphans = files.filter((n) => !exported.has(n));
  const missing = [...exported.keys()].filter((n) => !fileSet.has(n)).sort();

  const orphanSet = new Set(orphans);
  const missingSet = new Set(missing);
  const orphanAllowed = new Set(orphanAllow);
  const missingAllowed = new Set(missingAllow);

  const rustFloor = opts.minRustExports ?? MIN_RUST_EXPORTS;
  const fileFloor = opts.minBindingFiles ?? MIN_BINDING_FILES;

  return {
    rustExportCount: exports.length,
    bindingFileCount: files.length,
    orphans,
    missing: missing.map((n) => ({ name: n, ...exported.get(n) })),
    /** Orphans nobody signed off on. Any entry here fails the run. */
    unlistedOrphans: orphans.filter((n) => !orphanAllowed.has(n)),
    /** Allowlisted names that are no longer orphans — stale exemptions. */
    staleOrphans: orphanAllow.filter((n) => !orphanSet.has(n)).sort(),
    unlistedMissing: missing.filter((n) => !missingAllowed.has(n)),
    staleMissing: missingAllow.filter((n) => !missingSet.has(n)).sort(),
    /** `#[ts(export)]` attributes whose item the matcher could not find. */
    unresolved,
    /**
     * `#[ts(rename)]` / `#[ts(export_to)]`, which break the "file name IS the
     * type name" assumption the whole comparison rests on. Zero today; if one
     * appears, this check must learn it before it can be trusted again.
     */
    renamed,
    belowFloor: exports.length < rustFloor || files.length < fileFloor,
    rustFloor,
    fileFloor,
  };
}

/** True when the result should fail the run. */
export function isFailure(r) {
  return Boolean(
    r.unlistedOrphans.length ||
      r.staleOrphans.length ||
      r.unlistedMissing.length ||
      r.staleMissing.length ||
      r.unresolved.length ||
      r.renamed.length ||
      r.belowFloor,
  );
}

function main() {
  const json = process.argv.includes("--json");

  // Refuse an EMPTY enumeration explicitly, before anything else reads it. The
  // floors below cover this too, but "found nothing" and "looked at nothing"
  // must not share an exit code, and an empty binding directory is the case
  // where this check goes green for free (zero files ⇒ zero orphans).
  const seen = listBindingFiles();
  if (seen.length === 0) {
    console.error("src/lib/bindings/ enumerated ZERO files. Refusing to report.");
    process.exit(1);
  }

  const r = checkBindingOrphans();

  if (json) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(isFailure(r) ? 1 : 0);
  }

  console.log(
    `${r.rustExportCount} #[ts(export)] types, ${r.bindingFileCount} binding files, ` +
      `${r.orphans.length} orphaned, ${r.missing.length} missing.`,
  );

  if (r.belowFloor) {
    console.error(
      `\nWalk came back short: ${r.rustExportCount} Rust exports (floor ${r.rustFloor}), ` +
        `${r.bindingFileCount} binding files (floor ${r.fileFloor}).\n` +
        "Refusing to report on a partial scan — an empty binding directory makes the\n" +
        "orphan set EMPTY, which looks exactly like a clean tree.",
    );
  }

  if (r.renamed.length) {
    console.error(
      `\n${r.renamed.length} #[ts(rename)] / #[ts(export_to)] attribute(s) found:\n` +
        r.renamed.map((x) => `  src-tauri/${x.file}:${x.line}  ${x.attr}`).join("\n") +
        "\nThis check maps a Rust item name straight to a file name. A rename breaks\n" +
        "that mapping and would report a live type as an orphan. Teach the scanner\n" +
        "(scripts/lib/rustTsExports.mjs) the mapping before allowing this.",
    );
  }

  if (r.unresolved.length) {
    console.error(
      `\n${r.unresolved.length} #[ts(export)] attribute(s) with no resolvable item:\n` +
        r.unresolved.map((u) => `  src-tauri/${u.file}:${u.line}  ${u.reason}`).join("\n") +
        "\nThe matcher, not the code, is what to look at first.",
    );
  }

  if (r.unlistedOrphans.length) {
    console.error(
      `\n${r.unlistedOrphans.length} binding(s) with no #[ts(export)] type behind them:\n` +
        r.unlistedOrphans.map((n) => `  src/lib/bindings/${n}.ts`).join("\n") +
        "\n\nts-rs will never rewrite these, so they are frozen at whatever shape they\n" +
        "had when the Rust type went away — while the command they type keeps moving.\n" +
        "Either delete the file (and rerun `node scripts/generate-bindings-index.mjs`),\n" +
        "or restore `#[derive(TS)] #[ts(export)]` on the Rust type and regenerate.\n" +
        `If it is knowingly pending, add it to ${ORPHAN_ALLOWLIST_REL} with a reason.`,
    );
  }

  if (r.staleOrphans.length) {
    console.error(
      `\n${r.staleOrphans.length} allowlisted name(s) are no longer orphans:\n` +
        r.staleOrphans.map((n) => `  ${n}`).join("\n") +
        "\n\nEither they were fixed (good — delete the line), or the matcher stopped\n" +
        `seeing them (bad). A silent drop is as much a signal as a rise, so this\n` +
        `fails rather than quietly shrinking ${ORPHAN_ALLOWLIST_REL}.`,
    );
  }

  if (r.unlistedMissing.length) {
    const byName = new Map(r.missing.map((x) => [x.name, x]));
    console.error(
      `\n${r.unlistedMissing.length} #[ts(export)] type(s) with no committed binding:\n` +
        r.unlistedMissing
          .map((n) => `  ${n}  --  src-tauri/${byName.get(n).file}:${byName.get(n).line}`)
          .join("\n") +
        "\n\nRun the regeneration and commit what appears:\n" +
        "  cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings\n" +
        `then \`node scripts/generate-bindings-index.mjs\`. If it is knowingly pending,\n` +
        `add it to ${MISSING_ALLOWLIST_REL} with a reason.`,
    );
  }

  if (r.staleMissing.length) {
    console.error(
      `\n${r.staleMissing.length} allowlisted name(s) are no longer missing:\n` +
        r.staleMissing.map((n) => `  ${n}`).join("\n") +
        `\n\nDelete the line from ${MISSING_ALLOWLIST_REL}.`,
    );
  }

  if (isFailure(r)) process.exit(1);
  console.log(
    `All accounted for (${r.orphans.length} allowlisted orphans, ` +
      `${r.missing.length} allowlisted missing).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
