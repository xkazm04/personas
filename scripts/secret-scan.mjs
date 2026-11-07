#!/usr/bin/env node
// scripts/secret-scan.mjs — the D9 secret-scan control, run from the lefthook pre-commit hook.
//
// Runs gitleaks if it's installed. If not, it says so and falls back to a key-shape scan of the lines
// this commit adds. The fallback blocks ONLY on a hit: anything that stops it from running prints a
// line and exits 0, so it never breaks a commit for any other reason. No workflow runs gitleaks, so
// without the fallback the control did nothing on a machine that never installed it. Cross-platform
// (Node is guaranteed here; a raw shell guard is not — lefthook runs under cmd on Windows and sh
// elsewhere). When gitleaks IS present, it alone decides.
//
// Modes:
//   (default)  gitleaks protect --staged   — scan staged changes (the pre-commit control + capability verify)
//   --detect   gitleaks detect             — MANUAL full-history audit (slow; no fallback, it still skips)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const onWindows = process.platform === "win32";
const detect = process.argv.includes("--detect");
const args = detect
  ? ["detect", "--redact", "--no-banner"]
  : ["protect", "--staged", "--redact", "--no-banner"];

// The tail on the Anthropic shape keeps a placeholder such as `sk-ant-api03-...` from reading as a key.
const KEY_SHAPE =
  /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}|\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** The path allowlist gitleaks itself reads, so both scans exempt the same fixtures. */
function allowlistedPaths() {
  if (!existsSync(".gitleaks.toml")) return [];
  const block = readFileSync(".gitleaks.toml", "utf8").match(/^paths\s*=\s*\[([\s\S]*?)^\]/m);
  if (!block) return [];
  return [...block[1].matchAll(/'''(.+?)'''/g)].map((m) => new RegExp(m[1]));
}

/**
 * Files in a unified diff whose ADDED lines carry a key shape. A line marked `gitleaks:allow` is exempt,
 * as it is under gitleaks. Returns names only: a scan that echoes a secret has published it.
 */
function filesWithKeyShapes(diff, allowed = []) {
  const hits = new Set();
  let file = "";
  let inHeader = true;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) inHeader = true;
    else if (line.startsWith("@@")) inHeader = false;
    else if (inHeader) {
      if (line.startsWith("+++ ")) file = line.slice(4).trim().replace(/^b\//, "");
    } else if (
      line.startsWith("+") &&
      KEY_SHAPE.test(line) &&
      !line.includes("gitleaks:allow") &&
      !allowed.some((re) => re.test(file))
    ) {
      hits.add(file);
    }
  }
  return [...hits];
}

/** The fallback: exit code 1 on a hit, and 0 with a visible line in every other case. */
function scanStagedDiff() {
  // Seeded control, assembled at runtime so this file holds no key shape: a scan that cannot find a
  // planted token is not a scan, and its clean verdict is worth nothing.
  const seed = `+${"ghp"}_${"A".repeat(30)}`;
  if (filesWithKeyShapes(`+++ b/control\n@@ -0,0 +1 @@\n${seed}\n`).length !== 1) {
    console.log("[secret-scan] fallback control did not match a planted token — fallback SKIPPED (commit not blocked).");
    return 0;
  }
  const diff = spawnSync(
    "git",
    ["-c", "core.quotepath=off", "diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (diff.error || diff.status !== 0) {
    console.log("[secret-scan] could not read the staged diff — fallback SKIPPED (commit not blocked).");
    return 0;
  }
  const files = filesWithKeyShapes(diff.stdout, allowlistedPaths());
  if (files.length === 0) {
    console.log("[secret-scan] fallback: no key shapes in the staged lines. It is narrower than gitleaks.");
    return 0;
  }
  for (const file of files) console.error(`[secret-scan]   ${file}`);
  console.error("[secret-scan] the staged lines of the files above carry key-shaped strings (lines withheld on purpose) — commit blocked.");
  console.error("[secret-scan] Remove the key, or mark a test value's line with a `gitleaks:allow` comment.");
  return 1;
}

// Probe for gitleaks. On Windows, bare-name resolution needs the shell (PATHEXT/.exe).
const probe = spawnSync("gitleaks", ["version"], { stdio: "ignore", shell: onWindows });
if (probe.error || probe.status !== 0) {
  console.log("[secret-scan] gitleaks not installed — gitleaks scan SKIPPED.");
  console.log("[secret-scan] Install to enable the D9 control: https://github.com/gitleaks/gitleaks");
  process.exit(detect ? 0 : scanStagedDiff());
}

const res = spawnSync("gitleaks", args, { stdio: "inherit", shell: onWindows });
if (res.status && res.status !== 0) {
  console.error("[secret-scan] gitleaks found potential secrets — commit blocked. Remove them or add an allowlist entry.");
}
process.exit(res.status === null ? 1 : res.status);
