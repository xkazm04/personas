// Shared release-script helper: list commit subject lines since the most
// recent git tag. Extracted from bump-version.mjs and generate-changelog.mjs,
// which carried byte-identical copies that could drift independently (a fix to
// merge-commit / tag handling had to be made in two places).
//
// `cwd` is the directory to run git in (repo root for both callers).

import { execSync } from "node:child_process";

export function getCommitsSinceLastTag(cwd) {
  try {
    const lastTag = execSync("git describe --tags --abbrev=0", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const log = execSync(`git log --oneline ${lastTag}..HEAD`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return log ? log.split("\n") : [];
  } catch {
    // No tags yet — fall back to an empty list (callers treat this as a
    // patch bump / maintenance changelog).
    return [];
  }
}
