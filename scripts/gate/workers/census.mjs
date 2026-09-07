// Census worker for the gate daemon (docs/architecture/warm-verification-service.md).
//
// Runs inside a `node:worker_threads` Worker. Holds ONE warm in-memory index of
// the base checkout (walk once, read once — `buildIndex` in
// scripts/census/lib/engine.mjs) and answers each gate request by laying the
// request's overlay over it copy-on-write, then evaluating every census rule
// with the SAME `scanRuleOverIndex` + `assertRule` the cold runner uses. No
// assertion logic lives here: a verdict from this worker is `--check` semantics
// by construction, not by re-implementation.
//
// Rules come from the REQUESTED root, not the base: a worktree may have
// re-baselined. If the overlay carries `scripts/census/rules.json` that content
// wins; otherwise `<root>/scripts/census/rules.json` is read from disk.
//
// Protocol (one message in flight at a time, guaranteed by the daemon):
//   in : { id, type: 'gate', root, base: { root, head }, overlay: { files }, files? }
//   out: { id, ok: true, result } | { id, ok: false, error }
//        result = { ok, structural: [{ rule, code, message }],
//                   drift: [{ rule, files: [measured, baseline], matches: [measured, baseline], codes }],
//                   rules, fileVisits, violations, violatingFiles, indexedFiles, overlayApplied, ms }
//   in : { type: 'invalidate', paths }        (no reply; re-reads those base files)
//   in : { id, type: 'status' }               -> { id, ok: true, result: { indexedFiles, builtAt, lastGateMs, rssMb } }
// The worker posts { type: 'ready', ms } once the base index is built.

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  applyOverlay,
  assertRule,
  buildIndex,
  invalidateIndex,
  scanRuleOverIndex,
  validateRule,
} from '../../census/lib/engine.mjs';

const RULES_REL = 'scripts/census/rules.json';

const baseRoot = normalizeRoot(workerData?.baseRoot ?? process.cwd());

/** The warm base index; null until `warm()` has built it. */
let baseIndex = null;
let lastGateMs = 0;

function normalizeRoot(root) {
  return path.resolve(String(root)).replace(/\\/g, '/');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function log(level, message) {
  parentPort?.postMessage({ type: 'log', level, message });
}

function readRegistry(root) {
  return JSON.parse(readFileSync(path.join(root, RULES_REL), 'utf8'));
}

/**
 * The registry the request wants evaluated: the overlay's copy of rules.json
 * when the worktree changed it, else the requested root's file on disk.
 */
function resolveRegistry(root, overlayFiles) {
  const entry = overlayFiles.find((f) => f && toPosix(f.path) === RULES_REL);
  if (entry && entry.status !== 'deleted' && typeof entry.content === 'string') {
    return { registry: JSON.parse(entry.content), source: 'overlay' };
  }
  return { registry: readRegistry(root), source: `${root}/${RULES_REL}` };
}

/**
 * Overlay entries as `applyOverlay` wants them. The overlay module marks large
 * or NUL-bearing files `binary` and omits their content; a text file the
 * census reads can still be resolved from the requested root's disk, and one
 * that cannot be read is dropped (the walk would not have read it either).
 */
function materializeOverlay(root, overlayFiles) {
  const out = [];
  for (const f of overlayFiles) {
    if (!f || typeof f.path !== 'string') continue;
    const entry = { path: toPosix(f.path), status: f.status };
    if (f.status === 'deleted') {
      out.push(entry);
      continue;
    }
    if (typeof f.content === 'string') {
      entry.content = f.content;
    } else if (baseIndex.extensions.some((ext) => entry.path.endsWith(ext))) {
      try {
        entry.content = readFileSync(path.join(root, entry.path), 'utf8');
      } catch {
        continue;
      }
    } else {
      continue; // an extension no rule reads: applyOverlay would ignore it anyway
    }
    out.push(entry);
  }
  return out;
}

/**
 * The base index was built from the BASE registry's roots and extensions. A
 * requested registry that reaches further (a new root, a new extension) needs
 * the base re-indexed with the union, or its rules would walk fewer files than
 * their floor and fail structurally for the wrong reason.
 */
function ensureCoverage(rules) {
  const wantRoots = [...new Set(rules.flatMap((r) => r.roots ?? []))];
  const wantExts = [...new Set(rules.flatMap((r) => r.extensions ?? []))];
  const missingExt = wantExts.some((e) => !baseIndex.extensions.includes(e));
  const missingRoot = wantRoots.some((r) => {
    const rel = toPosix(path.relative(baseRoot, path.join(baseRoot, r)));
    return !baseIndex.roots.some((have) => have === '' || rel === have || rel.startsWith(have + '/'));
  });
  if (!missingExt && !missingRoot) return;
  const roots = [...new Set([...baseIndex.roots, ...wantRoots])];
  const extensions = [...new Set([...baseIndex.extensions, ...wantExts])];
  const t0 = Date.now();
  baseIndex = buildIndex(baseRoot, { roots, extensions });
  log('info', `census index rebuilt for wider coverage in ${Date.now() - t0} ms (${baseIndex.files.size} files)`);
}

function runGate(msg) {
  const started = Date.now();
  if (!baseIndex) throw new Error('census index is not built yet');

  const root = normalizeRoot(msg.root ?? baseRoot);
  const requestBase = msg.base?.root ? normalizeRoot(msg.base.root) : baseRoot;
  if (requestBase.toLowerCase() !== baseRoot.toLowerCase()) {
    throw new Error(`base mismatch: worker holds ${baseRoot}, request names ${requestBase}`);
  }
  const overlayFiles = Array.isArray(msg.overlay?.files) ? msg.overlay.files : [];

  const { registry, source } = resolveRegistry(root, overlayFiles);
  const rules = registry.rules ?? [];

  const structural = [];
  const drift = [];

  // A malformed registry must never scan "successfully" — same posture as the
  // cold runner, which exits 1 before scanning anything.
  const schemaErrors = rules.flatMap((rule, i) => validateRule(rule, i));
  if (schemaErrors.length > 0) {
    for (const message of schemaErrors) structural.push({ rule: '(registry)', code: 'schema', message });
  } else if (rules.length === 0) {
    structural.push({
      rule: '(registry)',
      code: 'empty',
      message: `the rule registry is empty — ${source} declares no rules, so this gate checked nothing at all`,
    });
  }

  let fileVisits = 0;
  let violations = 0;
  let violatingFiles = 0;
  let overlayApplied = 0;

  if (structural.length === 0) {
    ensureCoverage(rules);
    const view = applyOverlay(baseIndex, materializeOverlay(root, overlayFiles));
    overlayApplied = view.overlayApplied ?? 0;

    for (const rule of rules) {
      const result = scanRuleOverIndex(rule, view);
      fileVisits += result.walked;
      violations += result.matches;
      violatingFiles += result.files;
      const problems = assertRule(rule, result);
      for (const p of problems.filter((x) => x.kind === 'structural')) {
        structural.push({ rule: rule.id, code: p.code, message: p.message });
      }
      const driftProblems = problems.filter((x) => x.kind === 'drift');
      if (driftProblems.length > 0) {
        drift.push({
          rule: rule.id,
          files: [result.files, rule.baseline?.files ?? null],
          matches: [result.matches, rule.baseline?.matches ?? null],
          codes: driftProblems.map((p) => p.code),
        });
      }
    }
  }

  lastGateMs = Date.now() - started;
  return {
    ok: structural.length === 0 && drift.length === 0,
    structural,
    drift,
    rules: rules.length,
    fileVisits,
    violations,
    violatingFiles,
    indexedFiles: baseIndex.files.size,
    overlayApplied,
    rulesSource: source,
    ms: lastGateMs,
  };
}

function status() {
  return {
    indexedFiles: baseIndex ? baseIndex.files.size : 0,
    builtAt: baseIndex ? baseIndex.builtAt : null,
    lastGateMs,
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  };
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, type } = msg;
  try {
    if (type === 'gate') {
      parentPort.postMessage({ id, ok: true, result: runGate(msg) });
    } else if (type === 'status') {
      parentPort.postMessage({ id, ok: true, result: status() });
    } else if (type === 'invalidate') {
      if (baseIndex && Array.isArray(msg.paths)) invalidateIndex(baseIndex, msg.paths.map(toPosix));
    } else if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: `unknown message type: ${String(type)}` });
    }
  } catch (err) {
    if (id !== undefined) {
      parentPort.postMessage({ id, ok: false, error: err?.stack ?? String(err) });
    } else {
      log('error', err?.stack ?? String(err));
    }
  }
}

function warm() {
  const started = Date.now();
  try {
    const { rules = [] } = readRegistry(baseRoot);
    baseIndex = buildIndex(baseRoot, { rules });
    parentPort.postMessage({ type: 'ready', ms: Date.now() - started, indexedFiles: baseIndex.files.size });
  } catch (err) {
    // Stay alive: a gate request will answer { ok: false, error } until a
    // restart; the daemon owns restarts and must see why.
    log('error', `census index build failed: ${err?.stack ?? String(err)}`);
    parentPort.postMessage({ type: 'ready', ms: Date.now() - started, error: String(err?.message ?? err) });
  }
}

if (parentPort) {
  parentPort.on('message', handle);
  process.on('uncaughtException', (err) => {
    // Never let the thread die on a stray throw; the daemon owns restarts.
    log('error', err?.stack ?? String(err));
  });
  process.on('unhandledRejection', (err) => {
    log('error', err?.stack ?? String(err));
  });
  warm();
}
