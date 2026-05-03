#!/usr/bin/env node
// Surgically evict every ort/ort-sys build artifact + downloaded ONNX Runtime
// binary. Use this to recover from "machine type x64 conflicts with arm64"
// link errors (cache contamination across host triples).
//
// `cargo clean -p ort -p ort-sys` is NOT enough on its own — Cargo leaves
// rlibs/rmetas in the flat `target/debug/deps/` layout, and ort-sys's
// build-script outputs in `target/debug/build/ort-sys-*` survive too.

import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(repoRoot, "src-tauri", "target");

const removed = [];

function rmIfExists(path) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
}

function rmGlob(parent, predicate) {
  if (!existsSync(parent)) return;
  for (const name of readdirSync(parent)) {
    if (predicate(name)) rmIfExists(join(parent, name));
  }
}

// 1. target/<profile>/build/ort-sys-*  and  ort-*
for (const profile of ["debug", "release"]) {
  const buildDir = join(targetDir, profile, "build");
  rmGlob(buildDir, (n) => /^ort(-sys)?-[0-9a-f]+$/i.test(n));

  // 2. target/<profile>/deps/{libort,libort_sys}-*.{rlib,rmeta}
  const depsDir = join(targetDir, profile, "deps");
  rmGlob(depsDir, (n) => /^(lib)?ort(_sys)?-[0-9a-f]+\.(rlib|rmeta|d)$/i.test(n));
}

// 3. ONNX Runtime download cache (forces fresh re-download on next build)
const ortCache = join(homedir(), "AppData", "Local", "ort.pyke.io");
if (process.platform === "win32") rmIfExists(ortCache);
// macOS/Linux ort cache locations vary; ort respects ORT_OUT_DIR env var.

if (removed.length === 0) {
  console.log("clean-ort: nothing to remove (cache already clean)");
} else {
  console.log(`clean-ort: removed ${removed.length} path(s):`);
  for (const p of removed) console.log(`  ${p}`);
}
