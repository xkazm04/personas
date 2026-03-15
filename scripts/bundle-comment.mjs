#!/usr/bin/env node
/**
 * bundle-comment.mjs — Post bundle size report as a PR comment on GitHub.
 *
 * Runs bundle-size-report.mjs, captures the markdown output, then posts
 * (or updates) a comment on the current PR via the GitHub API.
 *
 * Required env vars:
 *   GITHUB_TOKEN       — Token with pull-requests:write permission
 *   PR_NUMBER          — Pull request number to comment on
 *   GITHUB_REPOSITORY  — owner/repo (e.g. "acme/personas")
 *
 * Usage:  node scripts/bundle-comment.mjs
 */

import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_SCRIPT = join(__dirname, "bundle-size-report.mjs");

const COMMENT_MARKER = "<!-- bundle-size-report -->";

// ── Validate env ─────────────────────────────────────────────────────

const { GITHUB_TOKEN, PR_NUMBER, GITHUB_REPOSITORY } = process.env;

if (!GITHUB_TOKEN || !PR_NUMBER || !GITHUB_REPOSITORY) {
  console.error(
    "Missing required env vars. Need: GITHUB_TOKEN, PR_NUMBER, GITHUB_REPOSITORY"
  );
  process.exit(1);
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");
if (!owner || !repo) {
  console.error(`Invalid GITHUB_REPOSITORY format: "${GITHUB_REPOSITORY}" (expected owner/repo)`);
  process.exit(1);
}

// ── Generate report ──────────────────────────────────────────────────

let reportMarkdown;
try {
  reportMarkdown = execSync(`node "${REPORT_SCRIPT}"`, {
    encoding: "utf-8",
    cwd: join(__dirname, ".."),
  }).trim();
} catch (err) {
  console.error("Failed to generate bundle size report:");
  console.error(err.stderr || err.message);
  process.exit(1);
}

const commentBody = `${COMMENT_MARKER}\n${reportMarkdown}`;

// ── GitHub API helpers ───────────────────────────────────────────────

const API_BASE = `https://api.github.com/repos/${owner}/${repo}`;

async function ghFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Find existing comment ────────────────────────────────────────────

async function findExistingComment() {
  let page = 1;
  while (true) {
    const comments = await ghFetch(
      `/issues/${PR_NUMBER}/comments?per_page=100&page=${page}`
    );
    if (comments.length === 0) break;

    const existing = comments.find(
      (c) =>
        c.user?.login === "github-actions[bot]" &&
        c.body?.includes(COMMENT_MARKER)
    );
    if (existing) return existing;

    if (comments.length < 100) break;
    page++;
  }
  return null;
}

// ── Post or update ───────────────────────────────────────────────────

async function run() {
  const existing = await findExistingComment();

  if (existing) {
    await ghFetch(`/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: commentBody }),
    });
    console.log(`Updated existing comment #${existing.id} on PR #${PR_NUMBER}`);
  } else {
    const created = await ghFetch(`/issues/${PR_NUMBER}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: commentBody }),
    });
    console.log(`Created comment #${created.id} on PR #${PR_NUMBER}`);
  }
}

run().catch((err) => {
  console.error("Failed to post PR comment:", err.message);
  process.exit(1);
});
