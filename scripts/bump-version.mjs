// scripts/bump-version.mjs
// Bumps the patch version (0.1.0 -> 0.1.1) in all three version files.
// Usage: node scripts/bump-version.mjs
// Prints the new version to stdout (captured by CI).

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");

// 1. Read current version from package.json (source of truth)
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = pkg.version;

// 2. Bump patch
const parts = current.split(".").map(Number);
parts[2] += 1;
const next = parts.join(".");

// 3. Update package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 4. Update src-tauri/tauri.conf.json
const tauriConfPath = join(ROOT, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// 5. Update src-tauri/Cargo.toml (regex replace first version line)
const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf-8");
cargo = cargo.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${next}$3`);
writeFileSync(cargoPath, cargo);

// 6. Print new version for CI to capture
console.log(next);
