#!/usr/bin/env node
/**
 * by-session.mjs — read history by the session or work package that produced it.
 *
 * Several agent sessions commit to one checkout at once, so "which session made
 * this commit?" is a real question when a regression needs tracing. This reads
 * the structured trailers that answer it:
 *   Claude-Session:  https://claude.ai/code/session_<id>   (written by the cloud harness)
 *   Agent-Session:   <session id or active-runs slug@date>
 *   Work-Package:    <WP / backlog item id>
 *
 * Usage:
 *   node scripts/git/by-session.mjs                 # sessions seen in the last 2000 commits, with counts
 *   node scripts/git/by-session.mjs <text>          # commits whose session trailer contains <text>
 *   node scripts/git/by-session.mjs <text> --limit 5000
 *
 * Read-only: runs `git log` and nothing else.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SESSION_TRAILERS = ['Claude-Session', 'Agent-Session', 'Work-Package'];

const FIELD = '\x1f';
const RECORD = '\x1e';
const TRAILER_SEP = '\x1d';

/** Parse `git log` output produced with {@link logFormat}. */
export function parseLog(raw) {
  return raw
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash, date, subject, trailerBlock = ''] = r.split(FIELD);
      const trailers = trailerBlock
        .split(TRAILER_SEP)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const at = t.indexOf(':');
          return { key: t.slice(0, at).trim(), value: t.slice(at + 1).trim() };
        });
      return { hash, date, subject, trailers };
    });
}

export function logFormat() {
  const keys = SESSION_TRAILERS.map((k) => `key=${k}`).join(',');
  return ['%h', '%cs', '%s', `%(trailers:${keys},separator=%x1d)`].join('%x1f') + '%x1e';
}

function main(argv) {
  const limitAt = argv.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) || 2000 : 2000;
  const query = argv.filter((a, i) => !a.startsWith('--') && i !== limitAt + 1)[0] || null;

  let raw;
  try {
    raw = execFileSync('git', ['log', `-n${limit}`, `--format=${logFormat()}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`git log failed: ${err.message}`);
    process.exit(2);
  }

  const commits = parseLog(raw).filter((c) => c.trailers.length > 0);

  if (query) {
    const hits = commits.filter((c) => c.trailers.some((t) => t.value.indexOf(query) !== -1));
    for (const c of hits) {
      console.log(`${c.hash} ${c.date} ${c.subject}`);
      for (const t of c.trailers) console.log(`    ${t.key}: ${t.value}`);
    }
    console.log(`\n${hits.length} commit(s) in the last ${limit} carry a session trailer containing "${query}".`);
    return;
  }

  const bySession = new Map();
  for (const c of commits) {
    for (const t of c.trailers) {
      const id = `${t.key}: ${t.value}`;
      const seen = bySession.get(id) || { count: 0, first: c.date, last: c.date };
      seen.count += 1;
      if (c.date < seen.first) seen.first = c.date;
      if (c.date > seen.last) seen.last = c.date;
      bySession.set(id, seen);
    }
  }
  const rows = [...bySession.entries()].sort((a, b) => (a[1].last < b[1].last ? 1 : -1));
  for (const [id, s] of rows) console.log(`${String(s.count).padStart(4)}  ${s.first}..${s.last}  ${id}`);
  console.log(
    `\n${commits.length} of the last ${limit} commits carry a ${SESSION_TRAILERS.join(' / ')} trailer` +
      ` (${rows.length} distinct value(s)).`,
  );
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2));
