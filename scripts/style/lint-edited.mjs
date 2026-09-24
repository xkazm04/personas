#!/usr/bin/env node
/**
 * PostToolUse hook: style feedback on the file an agent just edited.
 *
 * WHY. Every style rule in this repo is `warn`, and `npm run check` runs
 * `eslint src/` with no --max-warnings, so a warning never reaches a headless
 * agent at all: nothing fails and nobody reads the log. The census ratchets do
 * fail, but only at pre-push, minutes after the edit that caused them. This
 * hook moves both to the moment of the edit, for the one file edited, and only
 * talks when it has something to say.
 *
 * WHAT. For an Edit / Write / MultiEdit of a `src/**\/*.tsx` file or a
 * `src/features/**\/*.css` file:
 *   1. ESLint (the Linter API, no config file load) with ONLY the custom
 *      style/reuse rules listed in STYLE_RULES, on .tsx;
 *   2. the census style signatures (CENSUS_RULES, read from rules.json with
 *      their own roots, extensions and excludes) on the file's text.
 * It reports findings on the lines the edit wrote (the whole file for Write),
 * at most 12 lines, each naming what to use instead, and says how many more
 * sit elsewhere in the file. A clean edit prints nothing.
 *
 * CONTRACT. Never blocks: exit 0 on every path. Feedback reaches the model as
 * PostToolUse `hookSpecificOutput.additionalContext` on stdout. A payload it
 * cannot read is said once on stderr (fail-open, loudly, like
 * scripts/build/guard-whole-read.mjs). Registered in .claude/settings.json.
 *
 *   echo '{"tool_name":"Write","tool_input":{"file_path":"<abs>"}}' | node scripts/style/lint-edited.mjs
 *   node scripts/style/lint-edited.mjs --file <path>     # same, without a payload
 *   node scripts/style/lint-edited.mjs --file <scratch.tsx> --as src/features/x/X.tsx
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCommentOnlyLine, patternToRegExp } from '../census/lib/engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

export const STYLE_RULES = [
  'no-raw-text-classes',
  'no-raw-radius-classes',
  'no-raw-shadow-classes',
  'no-low-contrast-text-classes',
  'no-direct-white-colors',
  'enforce-base-modal',
  'prefer-numeric',
  'prefer-shared-clipboard',
  'prefer-status-badge',
];
export const CENSUS_RULES = [
  'raw-arbitrary-text-size',
  'raw-palette-text-colour',
  'bare-rounded',
  'opacity-dimmed-text',
  'phantom-typo-token',
  'raw-button-element',
  'feature-css-type-literal',
];
const MAX_LINES = 12;

/** Repo-relative posix path, or null when the file is not one this hook reads. */
export function relevantPath(filePath, root = ROOT) {
  if (!filePath) return null;
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, abs).split('\\').join('/');
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  if (/^src\/.+\.tsx$/.test(rel)) return rel;
  if (/^src\/features\/.+\.css$/.test(rel)) return rel;
  return null;
}

/** 1-based line ranges the edit wrote; null means the whole file. */
export function editedRanges(toolName, input, content) {
  if (toolName === 'Write') return null;
  const news = toolName === 'MultiEdit' ? (input?.edits ?? []).map((e) => e?.new_string) : [input?.new_string];
  const lf = content.replace(/\r\n/g, '\n');
  const ranges = [];
  for (const s of news) {
    if (typeof s !== 'string' || s.length === 0) continue;
    const at = lf.indexOf(s.replace(/\r\n/g, '\n'));
    if (at < 0) return null; // cannot place the edit: fall back to the whole file
    const start = lf.slice(0, at).split('\n').length;
    ranges.push([start, start + s.replace(/\r\n/g, '\n').split('\n').length - 1]);
  }
  return ranges.length ? ranges : null;
}

function lintWithEslint(rel, content) {
  const { Linter } = require('eslint');
  const tsParser = require('@typescript-eslint/parser');
  const rules = Object.fromEntries(STYLE_RULES.map((id) => [id, require(resolve(ROOT, 'eslint-rules', `${id}.cjs`))]));
  const linter = new Linter({ configType: 'flat', cwd: ROOT });
  const config = [
    {
      files: ['**/*.tsx'],
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { custom: { rules } },
      rules: Object.fromEntries(STYLE_RULES.map((id) => [`custom/${id}`, 'warn'])),
    },
  ];
  return linter
    .verify(content, config, { filename: resolve(ROOT, rel) })
    .filter((m) => m.ruleId)
    .map((m) => ({
      line: m.line,
      source: m.ruleId.replace(/^custom\//, ''),
      token: (/"([^"]+)"/.exec(m.message) ?? [])[1] ?? '',
      text: m.message.replace(/\s+/g, ' '),
    }));
}

export function censusFindings(rel, content, registry) {
  const out = [];
  const lines = content.split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const rule of registry.rules.filter((r) => CENSUS_RULES.includes(r.id))) {
    if (!rule.extensions.some((e) => rel.endsWith(e))) continue;
    if (!rule.roots.some((r) => rel.startsWith(r.replace(/\/$/, '') + '/'))) continue;
    if ((rule.exclude ?? []).some((e) => patternToRegExp(e.path).test(rel))) continue;
    const re = new RegExp(rule.signal.pattern, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const line = lineOf(m.index);
      if (rule.signal.ignoreCommentLines && isCommentOnlyLine(lines[line - 1] ?? '')) {
        re.lastIndex = m.index + 1;
        continue;
      }
      const token = m[0].split('\n')[0].trim().slice(0, 40);
      out.push({ line, source: `census ${rule.id}`, token, text: `${token} -> ${rule.signal.fix ?? rule.title}` });
    }
  }
  return out;
}

/** The whole analysis; returns the text to show, or '' for a clean edit. */
export function analyse({ toolName, input, rel, content, registry }) {
  let findings = censusFindings(rel, content, registry);
  if (rel.endsWith('.tsx')) {
    const eslint = lintWithEslint(rel, content);
    // The census arbitrary-size and phantom arms repeat what no-raw-text-classes says.
    const seen = new Set(eslint.map((f) => `${f.line}|${f.token}`));
    findings = [...eslint, ...findings.filter((f) => !seen.has(`${f.line}|${f.token}`))];
  }
  if (findings.length === 0) return '';
  const ranges = editedRanges(toolName, input, content);
  const inEdit = (f) => ranges === null || ranges.some(([a, b]) => f.line >= a && f.line <= b);
  const mine = findings.filter(inEdit).sort((a, b) => a.line - b.line);
  if (mine.length === 0) return '';
  const rest = findings.length - mine.length;
  const shown = mine.slice(0, MAX_LINES - 2);
  const out = [`style check on ${rel}: ${mine.length} finding(s) in what you just wrote (warn-level rules + census ratchets; fix before commit):`];
  for (const f of shown) out.push(`  L${f.line} [${f.source}] ${f.text}`.slice(0, 220));
  const tail = [];
  if (mine.length > shown.length) tail.push(`${mine.length - shown.length} more in the edit`);
  if (rest > 0) tail.push(`${rest} pre-existing elsewhere in this file`);
  if (tail.length) out.push(`  (+${tail.join('; ')}. Rules: .claude/rules/ui.md)`);
  return out.join('\n');
}

async function readStdin() {
  let payload = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) payload += chunk;
  return payload;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    let toolName = 'Write';
    let input = {};
    const fileArg = process.argv.indexOf('--file');
    if (fileArg > 0) {
      input = { file_path: process.argv[fileArg + 1] };
    } else {
      const payload = await readStdin();
      if (!payload.trim()) {
        console.error('[style-lint] DEGRADED: no hook payload on stdin; the edit was not checked.');
        process.exit(0);
      }
      const parsed = JSON.parse(payload);
      toolName = parsed?.tool_name ?? 'Write';
      input = parsed?.tool_input ?? {};
    }
    // --as <src/...> lints a file held elsewhere (a scratch file) as if it sat at
    // that repo path, so the demo and tests never have to write into src/.
    const asArg = process.argv.indexOf('--as');
    const rel = asArg > 0 ? relevantPath(process.argv[asArg + 1]) : relevantPath(input.file_path);
    if (!rel) process.exit(0);
    const content = readFileSync(asArg > 0 ? input.file_path : resolve(ROOT, rel), 'utf8');
    const registry = JSON.parse(readFileSync(resolve(ROOT, 'scripts/census/rules.json'), 'utf8'));
    const text = analyse({ toolName, input, rel, content, registry });
    if (text) {
      if (fileArg > 0) console.log(text);
      else console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
    }
  } catch (err) {
    console.error(`[style-lint] DEGRADED: ${err?.message ?? err}; the edit was not checked.`);
  }
  process.exit(0);
}
