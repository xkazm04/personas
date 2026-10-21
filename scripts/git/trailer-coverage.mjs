#!/usr/bin/env node
/**
 * trailer-coverage.mjs - how much of recent history can actually be traced to a session.
 *
 * AGENTS.md asks every agent session for an `Agent-Session:` trailer, and
 * check-session-trailer.mjs is the verdict on one message. This applies that same verdict
 * to a window of history and counts it: agent commits, how many name their session, the
 * share, and the hashes that do not. Human commits and git-written subjects (merge, revert,
 * fixup!) are counted separately and never owe a trailer, exactly as in the commit-msg check.
 *
 * It lives apart from by-session.mjs on purpose: check-session-trailer.mjs imports that
 * module, so importing the checker back into it would be a cycle.
 *
 * Usage:
 *   node scripts/git/trailer-coverage.mjs                      # last 30 days
 *   node scripts/git/trailer-coverage.mjs --since 2026-09-01   # any date git log --since accepts
 *   node scripts/git/trailer-coverage.mjs --min-share 0.9      # exit 1 when the share is lower
 *   node scripts/git/trailer-coverage.mjs --json
 *
 * Read-only: runs `git log` and nothing else.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyCommitMessage } from './check-session-trailer.mjs';

const FIELD = '\x1f';
const RECORD = '\x1e';

/** Parse `git log --format=%h%x1f%cs%x1f%B%x1e` into [{ hash, date, message }]. */
export function parseMessages(raw) {
  return raw
    .split(RECORD)
    .map((r) => r.replace(/^\r?\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash = '', date = '', message = ''] = r.split(FIELD);
      return { hash: hash.trim(), date: date.trim(), message };
    });
}

/**
 * Classify every commit and count. `share` is covered / agent, or null when the window
 * holds no agent commit at all: an empty window is "nothing to measure", not 100%.
 */
export function measureCoverage(commits) {
  const result = { total: commits.length, human: 0, exempt: 0, agent: 0, covered: 0, uncovered: [], share: null };
  for (const c of commits) {
    const verdict = classifyCommitMessage(c.message);
    if (verdict.kind === 'human') result.human += 1;
    else if (verdict.kind === 'exempt') result.exempt += 1;
    else {
      result.agent += 1;
      if (verdict.ok) result.covered += 1;
      else result.uncovered.push({ hash: c.hash, date: c.date, subject: c.message.split(/\r?\n/)[0] || '' });
    }
  }
  if (result.agent > 0) result.share = result.covered / result.agent;
  return result;
}

function argValue(argv, flag, fallback) {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
}

function main(argv) {
  const since = argValue(argv, '--since', '30.days.ago');
  const minShareArg = argValue(argv, '--min-share', null);
  const minShare = minShareArg === null ? null : Number(minShareArg);
  if (minShare !== null && !(minShare >= 0 && minShare <= 1)) {
    console.error('trailer-coverage: --min-share takes a number between 0 and 1.');
    process.exitCode = 2;
    return;
  }

  let raw;
  try {
    raw = execFileSync('git', ['log', `--since=${since}`, '--format=%h%x1f%cs%x1f%B%x1e'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`trailer-coverage: git log failed: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const r = measureCoverage(parseMessages(raw));
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ since, ...r }, null, 2));
  } else {
    for (const u of r.uncovered) console.log(`  uncovered  ${u.hash} ${u.date} ${u.subject}`);
    const pct = r.share === null ? 'n/a' : `${(r.share * 100).toFixed(1)}%`;
    console.log(
      `\nsince ${since}: ${r.total} commit(s) - ${r.agent} agent, ${r.human} human, ${r.exempt} exempt.` +
        `\n${r.covered} of ${r.agent} agent commit(s) name their session (${pct}).`,
    );
  }

  if (r.total === 0) {
    // Fail loud: an empty window is a wrong --since or a shallow clone, not a clean history.
    console.error('trailer-coverage: no commits in the window - nothing was measured.');
    process.exitCode = 2;
  } else if (minShare !== null && (r.share === null || r.share < minShare)) {
    console.error(`trailer-coverage: share is below --min-share ${minShare}.`);
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2));
