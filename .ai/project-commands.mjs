#!/usr/bin/env node
// .ai/project-commands.mjs - project the manifest's command table into the guidance files.
//
// The commands an agent runs (build, test, lint, typecheck, ...) are declared ONCE, in
// .ai/manifest.yaml `capabilities` (plus `guidance.doneGate` and `guidance.prePushGate`). Every guidance projection
// listed in `guidance.projections` (AGENTS.md, root CLAUDE.md) carries a generated block
// between the markers below instead of restating them in prose, so a command that changes
// changes everywhere or fails a check. .claude/CLAUDE.md is the canonical prose and is not
// a projection; it is never written here.
//
// Usage:
//   node .ai/project-commands.mjs            # --check (default): exit 1 if a block is stale or missing
//   node .ai/project-commands.mjs --write    # rewrite every block from the manifest
//
// `--check` also runs as src/__tests__/structural/guidanceCommands.test.ts, so `npm test`
// and the CI test step fail on a stale block. Zero-dependency on purpose, like doctor.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = '.ai/manifest.yaml';
export const BEGIN = '<!-- ai:commands:begin -->';
export const END = '<!-- ai:commands:end -->';

const unquote = (s) => s.trim().replace(/^"(.*)"$/, '$1');
const lf = (s) => s.replace(/\r\n/g, '\n');

/** `capabilities:` entries in declaration order: [{ name, command, note }]. */
export function parseCapabilities(manifestText) {
  const block = lf(manifestText).split(/\ncapabilities:\n/)[1];
  if (!block) return [];
  const caps = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^ {2}([\w-]+):\s*\{(.*)\}\s*$/);
    if (m) {
      const command = m[2].match(/\bcommand:\s*"([^"]*)"/);
      const note = m[2].match(/\bnote:\s*"([^"]*)"/);
      if (command) caps.push({ name: m[1], command: command[1], note: note ? note[1] : null });
    } else if (/^[^\s#]/.test(line)) {
      break;
    }
  }
  return caps;
}

/** `guidance.doneGate`, `guidance.prePushGate` and `guidance.projections`. */
export function parseGuidance(manifestText) {
  const block = (lf(manifestText).split(/\nguidance:\n/)[1] || '').split(/\n(?=[^\s#])/)[0];
  const doneGate = block.match(/^\s+doneGate:\s*(.+)$/m);
  const prePushGate = block.match(/^\s+prePushGate:\s*(.+)$/m);
  const projections = block.match(/^\s+projections:\s*\[([^\]]*)\]/m);
  return {
    doneGate: doneGate ? unquote(doneGate[1]) : null,
    prePushGate: prePushGate ? unquote(prePushGate[1]) : null,
    projections: projections ? projections[1].split(',').map(unquote).filter(Boolean) : [],
  };
}

/** The exact block every projection must carry, markers included. */
export function renderBlock(manifestText) {
  const caps = parseCapabilities(manifestText);
  const { doneGate, prePushGate } = parseGuidance(manifestText);
  const lines = [
    BEGIN,
    `<!-- GENERATED from ${MANIFEST} (capabilities, guidance.doneGate, guidance.prePushGate) by node .ai/project-commands.mjs --write. Edit the manifest, not this block: --check, and src/__tests__/structural/guidanceCommands.test.ts, fail when it is stale. -->`,
    '',
    '| Capability | Command |',
    '|---|---|',
    ...caps.map((c) => `| ${c.name} | \`${c.command}\` |`),
  ];
  if (doneGate) lines.push('', `Before you report done: \`${doneGate}\`.`);
  if (prePushGate) lines.push('', `Before you push: \`${prePushGate}\` (the full pre-push chain; it is not part of done).`);
  const notes = caps.filter((c) => c.note);
  if (notes.length > 0) {
    lines.push('');
    for (const c of notes) lines.push(`- **${c.name}**: ${c.note}`);
  }
  lines.push(END);
  return lines.join('\n');
}

/** The block currently in a file's text, or null when its markers are absent. */
export function extractBlock(text) {
  const t = lf(text);
  const begin = t.indexOf(BEGIN);
  const end = t.indexOf(END, begin + BEGIN.length);
  if (begin === -1 || end === -1) return null;
  return t.slice(begin, end + END.length);
}

const sameBlock = (a, b) => {
  const norm = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n').trim();
  return norm(a) === norm(b);
};

/**
 * Compare (or with `write`, rewrite) every projection's block.
 * Returns [{ file, status }] where status is 'ok' | 'stale' | 'missing' | 'written'.
 */
export function syncProjections({ root = ROOT, write = false } = {}) {
  const manifestText = readFileSync(join(root, MANIFEST), 'utf8');
  const expected = renderBlock(manifestText);
  const results = [];
  for (const file of parseGuidance(manifestText).projections) {
    const abs = join(root, file);
    const text = readFileSync(abs, 'utf8');
    const current = extractBlock(text);
    if (current === null) {
      results.push({ file, status: 'missing' });
    } else if (sameBlock(current, expected)) {
      results.push({ file, status: 'ok' });
    } else if (write) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(abs, lf(text).replace(current, () => expected).split('\n').join(eol));
      results.push({ file, status: 'written' });
    } else {
      results.push({ file, status: 'stale' });
    }
  }
  return results;
}

function main(argv) {
  const results = syncProjections({ write: argv.includes('--write') });
  if (results.length === 0) {
    console.error(`project-commands: ${MANIFEST} names no guidance.projections - nothing was checked.`);
    process.exitCode = 1;
    return;
  }
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.file}`);
  const bad = results.filter((r) => r.status === 'stale' || r.status === 'missing');
  if (bad.length > 0) {
    console.error(
      `\n${bad.length} projection(s) out of step with ${MANIFEST}. Stale: run \`node .ai/project-commands.mjs --write\`. ` +
        `Missing: add a line pair \`${BEGIN}\` / \`${END}\` where the commands belong, then --write.`,
    );
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2));
