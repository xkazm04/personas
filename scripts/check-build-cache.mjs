#!/usr/bin/env node
// Detect Rust target/host drift before it manifests as a baffling link error.
//
// The trap: `src-tauri/target/debug/deps/` is a flat directory keyed by crate
// hashes — Cargo does not segregate it by target triple. Build for x86_64,
// then for aarch64 (or vice versa), and the second build can pull in stale
// rlibs from the first, producing errors like:
//   lld-link: error: machine type x64 conflicts with arm64
//
// This script writes a marker on each successful run with the current host
// triple, and on the next run fails loud if the host has changed without a
// `cargo clean`. Faster than reading rlib magic bytes; catches the common
// human path (switched toolchain, restored from a different machine's cache).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(repoRoot, "src-tauri", "target");
const markerPath = join(targetDir, ".last-build-host");

function currentHost() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const host = currentHost();
if (!host) {
  // No rustc on PATH yet (fresh checkout, frontend-only contributor) —
  // nothing to validate. Don't block.
  process.exit(0);
}

if (!existsSync(targetDir)) {
  // No build artifacts yet — nothing to compare. Create the marker so the
  // first real build seeds it.
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(markerPath, host);
  process.exit(0);
}

if (existsSync(markerPath)) {
  const previous = readFileSync(markerPath, "utf8").trim();
  if (previous && previous !== host) {
    console.error(`\x1b[31m[host-check] Rust target host changed since the last build:\x1b[0m`);
    console.error(`  previous: ${previous}`);
    console.error(`  current : ${host}`);
    console.error(``);
    console.error(`Cached rlibs in src-tauri/target/debug/deps/ are likely contaminated.`);
    console.error(`Recover with:`);
    console.error(``);
    console.error(`  npm run clean:rust`);
    console.error(``);
    console.error(`(or, surgically: cd src-tauri && cargo clean)`);
    process.exit(1);
  }
}

writeFileSync(markerPath, host);
