#!/usr/bin/env node
// Stop hook: nudge Claude to update docs/features when feature/command source
// changed in this turn but no matching feature doc was edited.
//
// Triggered by .claude/settings.json -> hooks.Stop.
// Reads JSONL transcript at $payload.transcript_path, scans the most recent
// assistant turn for Edit/Write/MultiEdit tool calls, and matches edited paths
// against scripts/docs/feature-doc-map.json. If user-visible feature source
// was touched without any docs/features/ edit, exits 2 with a reminder so
// Claude addresses it before stopping.
//
// Dismiss path: if the change is internal-only (refactor, generated code,
// no behavior shift), Claude is instructed to reply with one short sentence
// acknowledging "internal-only, no doc update needed" and stop. The hook
// honors `stop_hook_active` to avoid infinite re-trigger loops.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MAP_PATH = path.join(REPO_ROOT, 'scripts/docs/feature-doc-map.json');

const SKIP_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /__tests__\//,
  /\/bindings\//,
  /\/generated\//,
  /\.generated\.(ts|tsx|mjs|js|cjs)$/,
  /^src\/i18n\//,
  /^docs\//,
  /^scripts\/templates\//,
  /^scripts\/connectors\//,
  /^src-tauri\/src\/db\/migrations\//,
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalize(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

function compileGlob(pattern) {
  const re = pattern
    .split('/')
    .map((segment) => {
      if (segment === '**') return '__GLOBSTAR__';
      return segment
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*');
    })
    .join('/')
    .replace(/\/__GLOBSTAR__\//g, '(/.*)?/')
    .replace(/^__GLOBSTAR__\//, '(.*/)?')
    .replace(/\/__GLOBSTAR__$/, '(/.*)?')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${re}$`);
}

function collectEditedFilesFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const edited = new Set();
  // Walk backwards until we hit the most recent user message; the assistant
  // events between that boundary and EOF are this turn's tool calls.
  for (let i = lines.length - 1; i >= 0; i--) {
    const evt = safeJson(lines[i]);
    if (!evt) continue;
    if (evt.type === 'user' && evt.message?.role === 'user') break;
    if (evt.type !== 'assistant') continue;
    const content = evt.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp === 'string' && fp.length) edited.add(normalize(fp));
    }
  }
  return edited;
}

function main() {
  const payload = safeJson(readStdin()) || {};
  // Don't loop on ourselves
  if (payload.stop_hook_active) process.exit(0);

  const edited = collectEditedFilesFromTranscript(payload.transcript_path);
  if (edited.size === 0) process.exit(0);

  const docsTouched = [...edited].some((f) => f.startsWith('docs/features/'));
  if (docsTouched) process.exit(0);

  const meaningful = [...edited].filter((f) => !SKIP_PATTERNS.some((re) => re.test(f)));
  if (meaningful.length === 0) process.exit(0);

  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    process.exit(0);
  }

  const compiled = (map.entries || []).map((entry) => ({
    doc: entry.doc,
    matchers: (entry.sourceGlobs || []).map(compileGlob),
  }));

  const hits = new Map();
  for (const f of meaningful) {
    for (const entry of compiled) {
      if (entry.matchers.some((re) => re.test(f))) {
        if (!hits.has(entry.doc)) hits.set(entry.doc, []);
        hits.get(entry.doc).push(f);
      }
    }
  }

  if (hits.size === 0) process.exit(0);

  const summary = [...hits.entries()]
    .map(([doc, files]) => {
      const head = files.slice(0, 4).join(', ');
      const tail = files.length > 4 ? ` (+${files.length - 4} more)` : '';
      return `  - ${doc} <- ${head}${tail}`;
    })
    .join('\n');

  const message =
    `Doc-sync reminder: this turn edited feature/command source but no docs/features/* was touched.\n\n` +
    `Mapped feature doc(s) likely affected:\n${summary}\n\n` +
    `If the change is user-visible (new tab/page/command, changed flow, removed feature, ` +
    `new event, schema migration that surfaces in UI), update the matching doc(s) above.\n\n` +
    `If the change is internal-only (pure refactor, bugfix with no behavior shift, generated ` +
    `code, test-only), reply with one short sentence acknowledging "internal-only, no doc update needed" and stop.\n`;

  process.stderr.write(message);
  process.exit(2);
}

main();
