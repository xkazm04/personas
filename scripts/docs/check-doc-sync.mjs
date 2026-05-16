#!/usr/bin/env node
// Stop hook: nudge Claude when feature/command source changed in this turn
// but its coupled documentation surfaces were not all updated.
//
// Three target types per entry in scripts/docs/feature-doc-map.json:
//   1. `doc`                — feature doc in docs/features/. Exit-2 nag.
//   2. `onboardingFlows`    — tour-flow IDs from the onboardingFlows registry.
//                             Exit-2 nag if any listed AND no src/features/onboarding/**
//                             file was touched in the same turn.
//   3. `marketingModule`    — desktop-modules.ts module ID. Informational
//                             breadcrumb only; never exits 2 on its own. Folded
//                             into the message when (1) or (2) fires, so the
//                             reader can mention it in their next /guide-sync run.
//                             Standalone marketing-only impact is handled by
//                             the scheduled weekly /guide-sync routine — see
//                             CLAUDE.md "Documentation Sync".
//
// Triggered by .claude/settings.json -> hooks.Stop.
// Reads JSONL transcript at $payload.transcript_path, scans the most recent
// assistant turn for Edit/Write/MultiEdit/NotebookEdit tool calls, and matches
// edited paths against the map. Honors `stop_hook_active` to avoid loops.
//
// Dismiss path: if the change is internal-only (refactor, generated code,
// no behavior shift), Claude replies with one short sentence acknowledging
// "internal-only, no doc update needed" and stops.

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
  if (payload.stop_hook_active) process.exit(0);

  const edited = collectEditedFilesFromTranscript(payload.transcript_path);
  if (edited.size === 0) process.exit(0);

  const editedArr = [...edited];
  const docsTouched = editedArr.some((f) => f.startsWith('docs/features/'));
  const onboardingTouched = editedArr.some((f) => f.startsWith('src/features/onboarding/'));

  const meaningful = editedArr.filter((f) => !SKIP_PATTERNS.some((re) => re.test(f)));
  if (meaningful.length === 0) process.exit(0);

  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    process.exit(0);
  }

  const onboardingFlows = map.onboardingFlows || {};
  const compiled = (map.entries || []).map((entry) => ({
    doc: entry.doc,
    onboardingFlows: entry.onboardingFlows || [],
    marketingModule: entry.marketingModule || null,
    matchers: (entry.sourceGlobs || []).map(compileGlob),
  }));

  const docHits = new Map();           // doc path -> [files that triggered it]
  const onboardingHits = new Map();    // flow id -> [files that triggered it]
  const marketingHits = new Map();     // module id -> [docs whose entries pointed here]

  for (const f of meaningful) {
    for (const entry of compiled) {
      if (!entry.matchers.some((re) => re.test(f))) continue;

      if (entry.doc) {
        if (!docHits.has(entry.doc)) docHits.set(entry.doc, []);
        docHits.get(entry.doc).push(f);
      }
      for (const flowId of entry.onboardingFlows) {
        if (!onboardingHits.has(flowId)) onboardingHits.set(flowId, []);
        onboardingHits.get(flowId).push(f);
      }
      if (entry.marketingModule) {
        if (!marketingHits.has(entry.marketingModule)) marketingHits.set(entry.marketingModule, []);
        marketingHits.get(entry.marketingModule).push(entry.doc);
      }
    }
  }

  const featureDocMissing = !docsTouched && docHits.size > 0;
  const onboardingMissing = !onboardingTouched && onboardingHits.size > 0;

  if (!featureDocMissing && !onboardingMissing) process.exit(0);

  const sections = [];

  if (featureDocMissing) {
    const summary = [...docHits.entries()]
      .map(([doc, files]) => {
        const head = files.slice(0, 4).join(', ');
        const tail = files.length > 4 ? ` (+${files.length - 4} more)` : '';
        return `  - ${doc} <- ${head}${tail}`;
      })
      .join('\n');
    sections.push(
      `Doc-sync reminder: this turn edited feature/command source but no docs/features/* was touched.\n\n` +
      `Mapped feature doc(s) likely affected:\n${summary}`,
    );
  }

  if (onboardingMissing) {
    const flowLines = [...onboardingHits.entries()]
      .map(([flowId, files]) => {
        const flow = onboardingFlows[flowId] || {};
        const stepRef = flow.stepFile ? ` (step: ${flow.stepFile})` : '';
        const desc = flow.description ? ` — ${flow.description}` : '';
        const head = files.slice(0, 3).join(', ');
        const tail = files.length > 3 ? ` (+${files.length - 3} more)` : '';
        return `  - ${flowId}${stepRef}${desc}\n    triggered by: ${head}${tail}`;
      })
      .join('\n');
    sections.push(
      `Onboarding-tour reminder: this turn edited source coupled to one or more tour flows, ` +
      `but no src/features/onboarding/** file was touched.\n\n` +
      `Tour flow(s) likely affected:\n${flowLines}\n\n` +
      `If the user-visible flow this tour walks through changed (sidebar nav, modal copy, ` +
      `step ordering, anchor element renamed), re-walk the tour and update the step file(s) ` +
      `+ tourSlice config. If the change is internal (refactor without UI shift), dismiss with ` +
      `"internal-only, no tour update needed".`,
    );
  }

  if (marketingHits.size > 0) {
    const modLines = [...marketingHits.entries()]
      .map(([mod, docs]) => {
        const uniqDocs = [...new Set(docs.filter(Boolean))].slice(0, 3).join(', ');
        return `  - module "${mod}" (related docs: ${uniqDocs || 'unmapped'})`;
      })
      .join('\n');
    sections.push(
      `Marketing-guide breadcrumb (informational — no action required this turn):\n` +
      `Desktop-module(s) potentially affected, picked up by next scheduled /guide-sync:\n${modLines}\n` +
      `Run /guide-sync manually if the change is urgent for the marketing site.`,
    );
  }

  const message = sections.join('\n\n---\n\n') +
    `\n\nDismiss path: reply with one short sentence — e.g. "internal-only, no doc/tour update needed" — and stop.\n`;

  process.stderr.write(message);
  process.exit(2);
}

main();
