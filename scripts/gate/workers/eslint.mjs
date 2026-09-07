// ESLint worker for the gate daemon (docs/architecture/warm-verification-service.md).
//
// Runs inside a `node:worker_threads` Worker. Keeps one warm `ESLint` instance per
// root (LRU, cap 8) so a request for a worktree pays config load once, then lints
// only the files the request names: explicit `files`, else the overlay's non-deleted
// files, else (root is the base) the dirty-vs-HEAD set of the root itself.
//
// Verdict parity with `npm run check`: that chain runs `eslint src/` with no
// `--max-warnings`, so warnings never fail here either. `ok` is `errors === 0`.
//
// Protocol (one message in flight at a time, guaranteed by the daemon):
//   in : { id, type: 'gate', root, base, overlay, files? }
//   out: { id, ok: true, result } | { id, ok: false, error }
//   in : { type: 'invalidate', paths }        (no reply)
//   in : { id, type: 'status' }               -> { id, ok: true, result }
// The worker posts { type: 'ready', ms } once the base root's instance is warm.

import { parentPort, workerData } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';

const LINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const MAX_INSTANCES = 8;
const MAX_MESSAGES = 500;

const baseRoot = normalizeRoot(workerData?.baseRoot ?? process.cwd());

/** @type {Map<string, ESLint>} insertion order == LRU order (oldest first). */
const instances = new Map();
let lastMs = 0;

function normalizeRoot(root) {
  return path.resolve(String(root)).replace(/\\/g, '/');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function getInstance(root) {
  const key = normalizeRoot(root);
  const existing = instances.get(key);
  if (existing) {
    // Refresh recency.
    instances.delete(key);
    instances.set(key, existing);
    return existing;
  }
  const eslint = new ESLint({
    cwd: key,
    cache: true,
    cacheLocation: path.join(key, '.eslintcache'),
    // Pin typescript-eslint's project root to THIS checkout. Without it the
    // parser sees two candidate tsconfig roots (the main checkout and the
    // worktree) and refuses to parse: "multiple candidate TSConfigRootDirs are
    // present" (measured 2026-09-07 on a base-dirty generated file).
    overrideConfig: { languageOptions: { parserOptions: { tsconfigRootDir: key } } },
  });
  instances.set(key, eslint);
  while (instances.size > MAX_INSTANCES) {
    const oldest = instances.keys().next().value;
    instances.delete(oldest);
  }
  return eslint;
}

function gitLines(root, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function dirtyFiles(root) {
  const changed = gitLines(root, ['diff', '--name-only', 'HEAD']);
  const untracked = gitLines(root, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...changed, ...untracked])];
}

/**
 * Resolve the candidate list. Returns [{ path, content? }] with repo-relative posix paths.
 */
function selectCandidates(msg, root, isBase) {
  if (Array.isArray(msg.files) && msg.files.length > 0) {
    return msg.files.map((f) => ({ path: toPosix(f) }));
  }
  const overlayFiles = msg.overlay?.files;
  if (Array.isArray(overlayFiles) && overlayFiles.length > 0) {
    return overlayFiles
      .filter((f) => f && f.status !== 'deleted' && f.path)
      .map((f) => ({ path: toPosix(f.path), content: typeof f.content === 'string' ? f.content : undefined }));
  }
  if (isBase || !overlayFiles) {
    return dirtyFiles(root).map((p) => ({ path: toPosix(p) }));
  }
  return [];
}

function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

async function runGate(msg) {
  const started = Date.now();
  const root = normalizeRoot(msg.root ?? baseRoot);
  const baseOfRequest = msg.base?.root ? normalizeRoot(msg.base.root) : baseRoot;
  const isBase = root === baseOfRequest;
  const eslint = getInstance(root);

  const seen = new Set();
  const toLintFromDisk = [];
  const toLintFromText = [];
  for (const cand of selectCandidates(msg, root, isBase)) {
    const rel = cand.path.replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!LINT_EXTENSIONS.has(path.extname(rel))) continue;
    const abs = path.join(root, rel);
    if (await eslint.isPathIgnored(abs)) continue;
    // Overlay content is a copy of what is on disk in `root`, so prefer the
    // disk path (lintFiles honours the cache and the project service); lint
    // from text only when the file is genuinely not on disk.
    if (isFile(abs)) {
      toLintFromDisk.push({ abs, rel });
    } else if (typeof cand.content === 'string') {
      toLintFromText.push({ abs, rel, content: cand.content });
    }
  }

  const total = toLintFromDisk.length + toLintFromText.length;
  if (total === 0) {
    lastMs = Date.now() - started;
    return { ok: true, files: 0, errors: 0, warnings: 0, ms: lastMs };
  }

  const results = [];
  if (toLintFromDisk.length > 0) {
    results.push(...(await eslint.lintFiles(toLintFromDisk.map((f) => f.abs))));
  }
  for (const f of toLintFromText) {
    results.push(...(await eslint.lintText(f.content, { filePath: f.abs })));
  }

  let errors = 0;
  let warnings = 0;
  const messages = [];
  let truncated = false;
  for (const r of results) {
    errors += r.errorCount ?? 0;
    warnings += r.warningCount ?? 0;
    const file = toPosix(path.relative(root, r.filePath));
    for (const m of r.messages ?? []) {
      if (messages.length >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      messages.push({
        file,
        line: m.line ?? 0,
        col: m.column ?? 0,
        ruleId: m.ruleId ?? null,
        severity: m.severity === 2 ? 'error' : 'warning',
        message: m.message,
      });
    }
  }

  lastMs = Date.now() - started;
  const result = { ok: errors === 0, files: results.length, errors, warnings, messages, ms: lastMs };
  if (truncated) result.truncated = true;
  return result;
}

function status() {
  return { roots: [...instances.keys()], lastMs };
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, type } = msg;
  try {
    if (type === 'gate') {
      const result = await runGate(msg);
      parentPort.postMessage({ id, ok: true, result });
    } else if (type === 'status') {
      parentPort.postMessage({ id, ok: true, result: status() });
    } else if (type === 'invalidate') {
      // ESLint's own file cache is keyed by mtime/content; nothing to do.
    } else if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: `unknown message type: ${String(type)}` });
    }
  } catch (err) {
    if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: err?.stack ?? String(err) });
    }
  }
}

async function warm() {
  const started = Date.now();
  try {
    const eslint = getInstance(baseRoot);
    // Force config resolution so the first gate does not pay for it.
    const probe = path.join(baseRoot, 'eslint.config.js');
    if (existsSync(probe)) await eslint.calculateConfigForFile(path.join(baseRoot, 'src/main.tsx'));
  } catch {
    // A root without a flat config still answers (with lintFiles errors surfaced per request).
  }
  parentPort.postMessage({ type: 'ready', ms: Date.now() - started });
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    void handle(msg);
  });
  process.on('uncaughtException', (err) => {
    // Never let the thread die on a stray throw; the daemon owns restarts.
    parentPort.postMessage({ type: 'log', level: 'error', message: err?.stack ?? String(err) });
  });
  process.on('unhandledRejection', (err) => {
    parentPort.postMessage({ type: 'log', level: 'error', message: err?.stack ?? String(err) });
  });
  void warm();
}
