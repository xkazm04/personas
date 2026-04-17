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
import { execSync } from "child_process";

const ROOT = join(import.meta.dirname, "..");

// ── 1. Determine bump type from commits since last tag ──────────────

function getCommitsSinceLastTag() {
  try {
    const lastTag = execSync("git describe --tags --abbrev=0", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const log = execSync(`git log --oneline ${lastTag}..HEAD`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return log ? log.split("\n") : [];
  } catch {
    // No tags yet — fall back to patch bump
    return [];
  }
}

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

const commits = getCommitsSinceLastTag();
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

// ── 7. Print new version for CI to capture ─────────────────────────

console.log(next);
