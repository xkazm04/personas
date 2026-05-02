#!/usr/bin/env node
// Verify that onnxruntime.dll lands next to personas-desktop.exe in the
// release build dir. The Cargo.toml comment warns that flipping ort to
// `load-dynamic` silently breaks startup (boot-time panic looking for the
// DLL); this check fails the release pipeline instead of users' machines.
//
// Usage: node scripts/verify-onnxruntime-bundling.mjs --target <triple>

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--target");
const target = i >= 0 ? args[i + 1] : null;
if (!target) {
  console.error("usage: node scripts/verify-onnxruntime-bundling.mjs --target <triple>");
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(repoRoot, "src-tauri", "target", target, "release");

if (!existsSync(releaseDir)) {
  console.error(`release dir not found: ${releaseDir}`);
  process.exit(1);
}

const exeName = "personas-desktop.exe";
const dllName = "onnxruntime.dll";

const exePath = join(releaseDir, exeName);
const dllPath = join(releaseDir, dllName);

const issues = [];
if (!existsSync(exePath)) issues.push(`missing exe: ${exePath}`);
if (!existsSync(dllPath)) issues.push(`missing dll: ${dllPath} — fastembed/ort's bundled binary did not land`);

// Also surface the list of DLLs alongside the exe — useful in CI logs when
// onnxruntime.dll moved or got renamed in a future fastembed.
if (existsSync(releaseDir)) {
  const dlls = readdirSync(releaseDir)
    .filter((f) => f.toLowerCase().endsWith(".dll"))
    .map((f) => ({ name: f, size: statSync(join(releaseDir, f)).size }));
  console.log(`DLLs in ${releaseDir}:`);
  for (const d of dlls) console.log(`  ${d.name} (${(d.size / 1024 / 1024).toFixed(2)} MiB)`);
}

if (issues.length) {
  console.error("\nONNX Runtime bundling check failed:");
  for (const m of issues) console.error(`  - ${m}`);
  console.error("\nIf load-dynamic was intentionally enabled, also bundle onnxruntime.dll");
  console.error("as a Tauri resource so it ships next to the exe in the installer.");
  process.exit(1);
}
console.log(`\nONNX Runtime bundled correctly for ${target}.`);
