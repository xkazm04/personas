// scripts/generate-changelog.mjs
// Reads commits since the last git tag and produces a grouped markdown changelog.
// Usage: node scripts/generate-changelog.mjs
// Prints the changelog to stdout (captured by CI).

import { join } from "path";
import { getCommitsSinceLastTag } from "./lib/git-tags.mjs";

const ROOT = join(import.meta.dirname, "..");

// ── 2. Parse and group commits ─────────────────────────────────────

const FEAT_RE = /^feat(\(.+\))?!?:\s*/;
const FIX_RE = /^fix(\(.+\))?!?:\s*/;
// Internal commit types that shouldn't appear in user-facing release notes.
// (perf/docs/refactor are kept — they can carry user-relevant changes.)
const INTERNAL_RE = /^(chore|ci|test|style|build)(\(.+\))?!?:\s*/;

function groupCommits(commits) {
  const features = [];
  const fixes = [];
  const other = [];

  for (const line of commits) {
    // Strip the short hash prefix
    const msg = line.replace(/^[a-f0-9]+\s+/, "");

    // Skip internal commit types (chore incl. version bumps, ci, test,
    // style, build) — they're noise in a user-facing changelog.
    if (INTERNAL_RE.test(msg)) continue;

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

const commits = getCommitsSinceLastTag(ROOT);
const groups = groupCommits(commits);
const changelog = buildChangelog(groups);

console.log(changelog);
