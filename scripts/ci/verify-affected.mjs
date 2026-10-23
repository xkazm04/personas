#!/usr/bin/env node
// verify:affected - the local, per-commit rung of the gate ladder: verify the
// files you changed, and what depends on them, instead of the whole tree.
//
// THE LADDER (2026-10-15; the CI half is described at the top of ci.yml)
//   per commit, local ...... `npm run verify:affected`       seconds to minutes
//   per push, CI fast lane . Linux, every gate, affected tests  ~25 min
//   every 3 h + nightly .... CI full lane, 3 OSes, all tests   ~70 min, never cancelled
//   release ................ release.yml requires a green full lane
//
// Each rung is a loan against the one below it. This one never claims more
// than it ran: it prints what it checked, and what it left to CI.
//
// WHAT IT RUNS
//   - the warm gate daemon (`npm run gate`): tsc, eslint on the changed
//     files, the census. Skipped only when every changed file is inert.
//   - `vitest related` on the changed files: the tests that import them. A
//     change under src/test/, to package.json or to a Vite/Vitest config runs
//     the whole suite (vitest.config.ts forceRerunTriggers).
//   - Rust, when src-tauri/ changed: clippy over the changed crates AND their
//     dependents (core <- db <- engine <- the app), `-D warnings`, as CI runs
//     it. The extracted crates' tests when only they changed. The app crate's
//     tests (`npm run test:rust`, the 8 GB step) only with --rust-tests; the
//     fast lane runs them on Linux on every push.
//
// WHICH FILES. A shared checkout holds other sessions' edits, so "everything
// dirty" is usually not yours. Name your files with --files; without it the
// set is every tracked change against --base (default HEAD) plus untracked
// files, and the list is printed so you can see whose it is.
//
// Usage:
//   npm run verify:affected -- [--files a,b,...] [--base <ref>] [--rust-tests] [--dry]
// Exit 0 = every step it ran passed, 1 = a step failed.

import { spawnSync, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes("--dry");
const rustTests = args.includes("--rust-tests");
const base = opt("--base") ?? "HEAD";

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);

let files;
if (opt("--files")) {
  // Comma-separated, or space-separated up to the next flag: CLAUDE.md spells
  // it `--files <your files>`, and reading only args[i + 1] silently gated the
  // first file of a space-separated list and nothing else.
  const after = args.slice(args.indexOf("--files") + 1);
  const end = after.findIndex((a) => a.startsWith("--"));
  files = (end < 0 ? after : after.slice(0, end))
    .flatMap((a) => a.split(","))
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean);
} else {
  files = [...new Set([...git("diff", "--name-only", "--no-renames", base), ...git("ls-files", "--others", "--exclude-standard")])];
}
if (files.length === 0) {
  console.log(`verify:affected: nothing changed against ${base}. Nothing to verify.`);
  process.exit(0);
}

// The same inert list as ci.yml's `changes` job: files no gate reads.
const INERT = /^(README\.md|CHANGELOG\.md|CONTRIBUTING\.md|CODE_OF_CONDUCT\.md|LICENSE|\.editorconfig|\.gitlab-ci\.yml|\.gitlab\/.*)$/;
const gated = files.filter((f) => !INERT.test(f));
const tsFiles = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
const testable = files.filter((f) => /^(src|tests)\//.test(f) || /(^|\/)(package\.json|vite\.config\.[^/]+|vitest\.config\.[^/]+)$/.test(f));

// Rust: which crates changed, then everything downstream of them.
const CRATE_DIRS = { "src-tauri/core/": "personas-core", "src-tauri/db/": "personas-db", "src-tauri/engine/": "personas-engine", "src-tauri/macros/": "personas-macros" };
const DOWNSTREAM = {
  "personas-core": ["personas-core", "personas-db", "personas-engine", "personas-desktop"],
  "personas-db": ["personas-db", "personas-engine", "personas-desktop"],
  "personas-engine": ["personas-engine", "personas-desktop"],
  "personas-macros": ["personas-macros", "personas-core", "personas-db", "personas-engine", "personas-desktop"],
  "personas-desktop": ["personas-desktop"],
};
const crates = new Set();
for (const f of files) {
  if (f === "rust-toolchain.toml" || /^src-tauri\/(Cargo\.(toml|lock)|\.cargo\/)/.test(f)) {
    for (const c of DOWNSTREAM["personas-macros"]) crates.add(c);
    continue;
  }
  if (!f.startsWith("src-tauri/")) continue;
  const dir = Object.keys(CRATE_DIRS).find((d) => f.startsWith(d));
  for (const c of DOWNSTREAM[dir ? CRATE_DIRS[dir] : "personas-desktop"]) crates.add(c);
}
const appCrate = crates.has("personas-desktop");

const steps = [];
const skipped = [];
if (gated.length > 0) {
  const gateArgs = ["scripts/gate/gate.mjs", "--gates", "tsc,eslint,census"];
  if (tsFiles.length > 0) gateArgs.push("--files", tsFiles.join(","));
  steps.push({ label: "gate: tsc, eslint, census", cmd: "node", argv: gateArgs });
} else {
  skipped.push("gate - every changed file is inert");
}
if (testable.length > 0) {
  steps.push({ label: `vitest related (${testable.length} file(s))`, cmd: "npx", argv: ["vitest", "related", "--run", "--passWithNoTests", ...testable] });
} else {
  skipped.push("vitest - no changed file under src/ or tests/, and no config");
}
if (crates.size > 0) {
  if (appCrate) {
    steps.push({ label: "clippy: workspace, --features desktop", cmd: "cargo", argv: ["clippy", "--workspace", "--manifest-path", "src-tauri/Cargo.toml", "--features", "desktop", "--", "-D", "warnings"] });
    if (rustTests) steps.push({ label: "rust tests: app crate (npm run test:rust)", cmd: "npm", argv: ["run", "test:rust"] });
    else skipped.push("app-crate Rust tests - pass --rust-tests to run them here; the CI fast lane runs them on Linux");
  } else {
    const p = [...crates].flatMap((c) => ["-p", c]);
    steps.push({ label: `clippy: ${[...crates].join(", ")}`, cmd: "cargo", argv: ["clippy", "--manifest-path", "src-tauri/Cargo.toml", ...p, "--all-targets", "--", "-D", "warnings"] });
    steps.push({ label: "rust tests: extracted crates (npm run test:rust:crates)", cmd: "npm", argv: ["run", "test:rust:crates"] });
  }
}
skipped.push("Windows/macOS legs, the feature matrix, the full Vitest suite - the CI lanes");

console.log(`verify:affected: ${files.length} changed file(s) against ${opt("--files") ? "--files" : base}`);
for (const f of files.slice(0, 40)) console.log(`  ${f}`);
if (files.length > 40) console.log(`  ... and ${files.length - 40} more`);
if (crates.size > 0) console.log(`Rust crates affected: ${[...crates].join(", ")}`);

const results = [];
for (const s of steps) {
  console.log(`\n> ${s.label}\n  ${s.cmd} ${s.argv.join(" ")}`);
  if (dry) continue;
  const started = Date.now();
  const r = spawnSync(s.cmd, s.argv, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  results.push({ label: s.label, ok: r.status === 0, seconds: (Date.now() - started) / 1000 });
}

console.log("\nverify:affected summary");
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}  (${r.seconds.toFixed(1)} s)`);
if (dry) console.log(`  (dry run: ${steps.length} step(s) listed, none run)`);
for (const s of skipped) console.log(`  left  ${s}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
