#!/usr/bin/env node
/**
 * check-session-trailer.mjs - a commit-msg check: an agent's commit names its session.
 *
 * AGENTS.md asks every session to add `Agent-Session: <slug>@<date>` so that
 * `scripts/git/by-session.mjs` can trace a regression to the session that made it.
 * This turns that request into a verdict on one commit message:
 *
 *   agent   the message carries a `Co-Authored-By:` naming Claude / Anthropic, or a
 *           `Claude-Session:` trailer. It must also carry `Agent-Session:` or
 *           `Claude-Session:` (the session trailers by-session.mjs reads).
 *   human   neither marker: passes untouched. A person committing by hand is not asked
 *           for a session they do not have.
 *   exempt  merge, revert, fixup!/squash!/amend! subjects: git or a tool wrote them.
 *
 * Read-only: it reads the message file git hands a commit-msg hook and nothing else.
 *
 * Usage (lefthook commit-msg passes the message file as {1}):
 *   node scripts/git/check-session-trailer.mjs .git/COMMIT_EDITMSG
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SESSION_TRAILERS } from './by-session.mjs';

/** The trailers that name a session (Work-Package names an item, not a session). */
export const SESSION_KEYS = SESSION_TRAILERS.filter((k) => k.endsWith('-Session'));

const EXEMPT_SUBJECT = /^(?:Merge |Revert "|fixup! |squash! |amend! )/;
const SCISSORS = /^# -+ >8 -+$/m;

/** Drop git's comment lines and everything below a `--verbose` scissors line. */
export function stripComments(message) {
  const text = message.replace(/\r\n/g, '\n');
  const cut = text.search(SCISSORS);
  return (cut === -1 ? text : text.slice(0, cut))
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

/** Trailers of the last paragraph, when the message has a paragraph beyond the subject. */
export function parseTrailers(message) {
  const paragraphs = stripComments(message).split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length < 2) return [];
  return paragraphs[paragraphs.length - 1]
    .split('\n')
    .map((line) => /^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => ({ key: m[1], value: m[2].trim() }));
}

/** { kind: 'agent' | 'human' | 'exempt', ok, reason } for one commit message. */
export function classifyCommitMessage(message) {
  const subject = stripComments(message).split('\n')[0] || '';
  if (EXEMPT_SUBJECT.test(subject)) return { kind: 'exempt', ok: true, reason: 'written by git or a tool' };

  const trailers = parseTrailers(message);
  const has = (key) => trailers.some((t) => t.key.toLowerCase() === key.toLowerCase() && t.value);
  const coAuthoredByAgent = trailers.some(
    (t) => t.key.toLowerCase() === 'co-authored-by' && /claude|anthropic/i.test(t.value),
  );
  if (!coAuthoredByAgent && !has('Claude-Session')) {
    return { kind: 'human', ok: true, reason: 'no agent marker' };
  }
  if (SESSION_KEYS.some(has)) return { kind: 'agent', ok: true, reason: 'session trailer present' };
  return {
    kind: 'agent',
    ok: false,
    reason: `an agent commit carries none of ${SESSION_KEYS.join(' / ')}`,
  };
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('usage: node scripts/git/check-session-trailer.mjs <commit-message-file>');
    process.exitCode = 2;
    return;
  }
  const verdict = classifyCommitMessage(readFileSync(file, 'utf8'));
  if (verdict.ok) return;
  console.error(
    `check-session-trailer: ${verdict.reason}.\n` +
      '  Name the session so scripts/git/by-session.mjs can trace this commit:\n' +
      '    git commit --trailer "Agent-Session: <your active-runs slug>@<date>" ...\n' +
      '  (see "Git policy" in AGENTS.md).',
  );
  process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2));
