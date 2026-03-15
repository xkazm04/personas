// scripts/generate-changelog.mjs
// Reads commits since the last git tag and produces a grouped markdown changelog.
// Usage: node scripts/generate-changelog.mjs
// Prints the changelog to stdout (captured by CI).

import { execSync } from "child_process";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");

// ── 1. Get commits since last tag ──────────────────────────────────

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
    // No tags exist — return empty
    return [];
  }
}

// ── 2. Parse and group commits ─────────────────────────────────────

const FEAT_RE = /^feat(\(.+\))?!?:\s*/;
const FIX_RE = /^fix(\(.+\))?!?:\s*/;

function groupCommits(commits) {
  const features = [];
  const fixes = [];
  const other = [];

  for (const line of commits) {
    // Strip the short hash prefix
    const msg = line.replace(/^[a-f0-9]+\s+/, "");

    // Skip CI version-bump commits
    if (/^chore: bump version to/.test(msg)) continue;

    if (FEAT_RE.test(msg)) {
      features.push(msg.replace(FEAT_RE, "").replace(/^\w/, (c) => c.toUpperCase()));
    } else if (FIX_RE.test(msg)) {
      fixes.push(msg.replace(FIX_RE, "").replace(/^\w/, (c) => c.toUpperCase()));
    } else {
      // Strip any conventional prefix for readability
      const cleaned = msg.replace(/^[a-z]+(\(.+\))?!?:\s*/, "");
      other.push(cleaned.replace(/^\w/, (c) => c.toUpperCase()));
    }
  }

  return { features, fixes, other };
}

// ── 3. Build markdown output ───────────────────────────────────────

function buildChangelog({ features, fixes, other }) {
  const sections = [];

  sections.push("## What's Changed");

  if (features.length > 0) {
    sections.push("");
    sections.push("### Features");
    for (const f of features) sections.push(`- ${f}`);
  }

  if (fixes.length > 0) {
    sections.push("");
    sections.push("### Fixes");
    for (const f of fixes) sections.push(`- ${f}`);
  }

  if (other.length > 0) {
    sections.push("");
    sections.push("### Other");
    for (const o of other) sections.push(`- ${o}`);
  }

  if (features.length === 0 && fixes.length === 0 && other.length === 0) {
    sections.push("");
    sections.push("Maintenance release.");
  }

  return sections.join("\n");
}

// ── 4. Run ─────────────────────────────────────────────────────────

const commits = getCommitsSinceLastTag();
const groups = groupCommits(commits);
const changelog = buildChangelog(groups);

console.log(changelog);
