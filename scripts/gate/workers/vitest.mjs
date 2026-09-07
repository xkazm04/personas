// Vitest worker for the gate daemon (docs/architecture/warm-verification-service.md).
//
// Not warm in v1: each gate spawns `vitest related <files...> --run` in the request's
// root and parses the JSON reporter output. File selection mirrors the eslint worker
// (explicit `files`, else the overlay's non-deleted files, else the root's dirty set)
// but keeps `.test.ts(x)` files, since a changed test is itself "related".
//
// `NODE_TEST_CONTEXT` and `NODE_OPTIONS` are stripped from the child env: an inherited
// NODE_TEST_CONTEXT makes node's test runner print failures and still exit 0
// (memory: feedback_node_test_context_false_green), and NODE_OPTIONS can smuggle the
// same kind of loader into a child that must answer for itself.
//
// Protocol: see ./eslint.mjs (identical envelope).

import { parentPort, workerData } from 'node:worker_threads';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_FAILURES = 100;

const baseRoot = normalizeRoot(workerData?.baseRoot ?? process.cwd());
let lastMs = 0;
let runs = 0;

function normalizeRoot(root) {
  return path.resolve(String(root)).replace(/\\/g, '/');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
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

function selectCandidates(msg, root, isBase) {
  if (Array.isArray(msg.files) && msg.files.length > 0) {
    return msg.files.map(toPosix);
  }
  const overlayFiles = msg.overlay?.files;
  if (Array.isArray(overlayFiles) && overlayFiles.length > 0) {
    return overlayFiles.filter((f) => f && f.status !== 'deleted' && f.path).map((f) => toPosix(f.path));
  }
  if (isBase || !overlayFiles) {
    return dirtyFiles(root).map(toPosix);
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

/** Locate vitest's entry for a root, falling back to the base root's copy. */
function vitestEntry(root) {
  for (const r of [root, baseRoot]) {
    const entry = path.join(r, 'node_modules', 'vitest', 'vitest.mjs');
    if (existsSync(entry)) return entry;
  }
  return null;
}

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

function runVitest(root, entry, files, outputFile) {
  return new Promise((resolve) => {
    const args = [
      entry,
      'related',
      ...files,
      '--run',
      '--passWithNoTests',
      '--reporter=json',
      `--outputFile=${outputFile}`,
    ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let timedOut = false;
    child.stderr.on('data', (d) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, stderr: String(err?.message ?? err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stderr });
    });
  });
}

function parseReport(root, report) {
  const failures = [];
  let truncated = false;
  for (const suite of report.testResults ?? []) {
    const file = toPosix(path.relative(root, suite.name ?? ''));
    for (const a of suite.assertionResults ?? []) {
      if (a.status !== 'failed') continue;
      if (failures.length >= MAX_FAILURES) {
        truncated = true;
        break;
      }
      failures.push({
        file,
        name: a.fullName ?? a.title ?? '',
        message: (a.failureMessages ?? []).join('\n').slice(0, 4000),
      });
    }
    // A suite that failed to load has no assertions but still counts as a failure.
    if (suite.status === 'failed' && (suite.assertionResults ?? []).length === 0 && failures.length < MAX_FAILURES) {
      failures.push({ file, name: '(suite)', message: String(suite.message ?? 'suite failed to run').slice(0, 4000) });
    }
  }
  const failed = report.numFailedTests ?? 0;
  const result = {
    ok: failed === 0 && report.success === true,
    related: report.numTotalTestSuites ?? 0,
    passed: report.numPassedTests ?? 0,
    failed,
    failures,
  };
  if (truncated) result.truncated = true;
  return result;
}

async function runGate(msg) {
  const started = Date.now();
  runs += 1;
  const root = normalizeRoot(msg.root ?? baseRoot);
  const baseOfRequest = msg.base?.root ? normalizeRoot(msg.base.root) : baseRoot;
  const isBase = root === baseOfRequest;

  const files = [];
  const seen = new Set();
  for (const raw of selectCandidates(msg, root, isBase)) {
    const rel = raw.replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!SOURCE_EXTENSIONS.has(path.extname(rel))) continue;
    if (!isFile(path.join(root, rel))) continue;
    files.push(rel);
  }

  if (files.length === 0) {
    lastMs = Date.now() - started;
    return { ok: true, related: 0, passed: 0, failed: 0, skipped: true, ms: lastMs };
  }

  const entry = vitestEntry(root);
  if (!entry) {
    lastMs = Date.now() - started;
    return { ok: false, related: 0, passed: 0, failed: 0, error: 'vitest not installed', ms: lastMs };
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'gate-vitest-'));
  const outputFile = path.join(dir, 'report.json');
  try {
    const { code, timedOut, stderr } = await runVitest(root, entry, files, outputFile);
    lastMs = Date.now() - started;
    if (timedOut) {
      return { ok: false, error: 'timeout', related: 0, passed: 0, failed: 0, ms: lastMs };
    }
    if (!existsSync(outputFile)) {
      return {
        ok: false,
        related: 0,
        passed: 0,
        failed: 0,
        error: `vitest exited ${code} without a report${stderr ? `: ${stderr.trim().slice(0, 2000)}` : ''}`,
        ms: lastMs,
      };
    }
    let report;
    try {
      report = JSON.parse(readFileSync(outputFile, 'utf8'));
    } catch (err) {
      return { ok: false, related: 0, passed: 0, failed: 0, error: `unreadable report: ${String(err?.message ?? err)}`, ms: lastMs };
    }
    const result = parseReport(root, report);
    if (!result.ok && result.failed === 0 && result.failures.length === 0 && code !== 0) {
      result.error = `vitest exited ${code}${stderr ? `: ${stderr.trim().slice(0, 2000)}` : ''}`;
    }
    result.ms = lastMs;
    return result;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best-effort
    }
  }
}

function status() {
  return { baseRoot, runs, lastMs, warm: false };
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
      // Nothing is cached in v1.
    } else if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: `unknown message type: ${String(type)}` });
    }
  } catch (err) {
    if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: err?.stack ?? String(err) });
    }
  }
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    void handle(msg);
  });
  process.on('uncaughtException', (err) => {
    parentPort.postMessage({ type: 'log', level: 'error', message: err?.stack ?? String(err) });
  });
  process.on('unhandledRejection', (err) => {
    parentPort.postMessage({ type: 'log', level: 'error', message: err?.stack ?? String(err) });
  });
  // Nothing to warm; report ready immediately with the resolved vitest entry as a sanity check.
  parentPort.postMessage({ type: 'ready', ms: 0, vitest: vitestEntry(baseRoot) !== null });
}
