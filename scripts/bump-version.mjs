// scripts/bump-version.mjs
// Bumps the version based on conventional commit types since the last tag.
//   feat:            -> minor bump
//   fix: / other     -> patch bump
//   BREAKING CHANGE: -> major bump
// Falls back to patch bump when no tags exist yet.
// Usage: node scripts/bump-version.mjs
// Prints the new version to stdout (captured by CI).

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCommitsSinceLastTag } from "./lib/git-tags.mjs";

const ROOT = join(import.meta.dirname, "..");

// ── 1. Determine bump type from commits since last tag ──────────────

function determineBumpType(commits) {
  let hasFeature = false;

  for (const line of commits) {
    // Strip the short hash prefix (e.g. "abc1234 feat: ...")
    const msg = line.replace(/^[a-f0-9]+\s+/, "");

    // Check for breaking change indicators
    if (/BREAKING CHANGE:/i.test(msg) || /^[a-z]+(\(.+\))?!:/.test(msg)) {
      return "major";
    }

    if (/^feat(\(.+\))?:/.test(msg)) {
      hasFeature = true;
    }
  }

  return hasFeature ? "minor" : "patch";
}

const commits = getCommitsSinceLastTag(ROOT);
const bumpType = determineBumpType(commits);

// ── 2. Read current version from package.json (source of truth) ─────

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = pkg.version;

// ── 3. Bump version ────────────────────────────────────────────────

// Strip any pre-release suffix (e.g. "0.1.0-ff.1" → "0.1.0") before
// parsing. Without this, `split(".").map(Number)` on "0-ff" yields NaN
// and the bumped version ships as "0.1.NaN.1".
const coreOnly = current.split("-")[0];
const parts = coreOnly.split(".").map(Number);
if (parts.some(Number.isNaN)) {
  console.error(`[bump-version] Refusing to bump: current version "${current}" is not parseable.`);
  process.exit(1);
}

switch (bumpType) {
  case "major":
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
    break;
  case "minor":
    parts[1] += 1;
    parts[2] = 0;
    break;
  default:
    parts[2] += 1;
    break;
}

const next = parts.join(".");

// ── 4. Update package.json ─────────────────────────────────────────

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// ── 5. Update src-tauri/tauri.conf.json ────────────────────────────

const tauriConfPath = join(ROOT, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// ── 6. Update src-tauri/Cargo.toml (regex replace first version line)

const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf-8");
cargo = cargo.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${next}$3`);
writeFileSync(cargoPath, cargo);

// ── 7. Update src-tauri/Cargo.lock (personas-desktop entry) ─────────
//
// Cargo.lock pins the workspace package's own version. If we bump Cargo.toml
// but leave the lock stale, master's lockfile permanently lags: every
// developer's next `cargo build` rewrites Cargo.lock (dirtying the tree) and
// `--locked`/`--frozen` builds fail. The bump job runs on Node only (no Rust
// toolchain), so we can't `cargo update` — do a targeted regex bump of the
// personas-desktop package block instead. (\r? tolerates CRLF checkouts.)

const lockPath = join(ROOT, "src-tauri", "Cargo.lock");
let lock = readFileSync(lockPath, "utf-8");
const lockRe = /(name = "personas-desktop"\r?\nversion = ")[^"]+(")/;
if (!lockRe.test(lock)) {
  console.error(`[bump-version] Could not find personas-desktop version in Cargo.lock — aborting so the lockfile can't silently drift.`);
  process.exit(1);
}
lock = lock.replace(lockRe, `$1${next}$2`);
writeFileSync(lockPath, lock);

// ── 8. Print new version for CI to capture ─────────────────────────

console.log(next);
