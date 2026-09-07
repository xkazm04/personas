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
// Delta semantics (2026-09-07). A verdict for a WORKTREE is a delta against the
// base, exactly as the tsc worker answers with `introduced` / `resolved`: the
// smoke that motivated this reported `FAIL 3 drifted` for a worktree whose diff
// touched none of those rules, because the three drifts already existed on
// master. So for a worktree the base is evaluated once with the SAME registry
// the request uses (cached by the sha256 of the rules text, dropped on every
// `invalidate`), and per rule:
//   introduced = the worktree's measured [files, matches] differs from the
//                base's measured pair AND from the rule's baseline (landing
//                exactly on the baseline is a fix, not drift)
//   resolved   = the rule drifts in the base but not in the worktree
//   ok         = no structural problems AND no introduced rules
// `drift` (the full list vs baseline) stays in the result for visibility. For
// the base root itself nothing changes: full `--check` semantics, `ok` = no
// structural AND no drift. Structural problems are fatal in both modes.
//
// Protocol (one message in flight at a time, guaranteed by the daemon):
//   in : { id, type: 'gate', root, base: { root, head }, overlay: { files }, files? }
//   out: { id, ok: true, result } | { id, ok: false, error }
//        result = { ok, delta, structural: [{ rule, code, message }],
//                   drift: [{ rule, files: [measured, baseline], matches: [measured, baseline], codes }],
//                   baseDrift, introduced: [{ rule, files: [wt, base], matches: [wt, base], baseline }],
//                   resolved: [rule], rules, fileVisits, violations, violatingFiles, indexedFiles,
//                   overlayApplied, baseEvalMs, baseEvalCached, ms }
//   in : { type: 'invalidate', paths }        (no reply; re-reads those base files, drops the base evaluation)
//   in : { id, type: 'status' }               -> { id, ok: true, result: { indexedFiles, builtAt, lastGateMs, rssMb } }
// The worker posts { type: 'ready', ms } once the base index is built.

import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
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

/**
 * The base evaluated under one registry: `{ rulesHash, byRule: Map<id, {
 * files, matches, drifted }>, drift, structural, ms }`. Built on the first
 * worktree request, reused by every later one with the same rules text,
 * dropped when the base index changes (an `invalidate` message or a coverage
 * rebuild). A census evaluation costs ~7 s of regex on this repo; paying it
 * twice per request would double the gate.
 */
let baseEval = null;

function normalizeRoot(root) {
  return path.resolve(String(root)).replace(/\\/g, '/');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function log(level, message) {
  parentPort?.postMessage({ type: 'log', level, message });
}

function readRegistryText(root) {
  return readFileSync(path.join(root, RULES_REL), 'utf8');
}

function readRegistry(root) {
  return JSON.parse(readRegistryText(root));
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Absolute paths (what the daemon's watcher sends) become base-relative; relative ones pass through. */
function toBaseRel(p) {
  const posix = toPosix(p);
  const prefix = baseRoot + '/';
  if (posix.toLowerCase().startsWith(prefix.toLowerCase())) return posix.slice(prefix.length);
  return posix;
}

/**
 * The registry the request wants evaluated: the overlay's copy of rules.json
 * when the worktree changed it, else the requested root's file on disk.
 */
function resolveRegistry(root, overlayFiles) {
  const entry = overlayFiles.find((f) => f && toPosix(f.path) === RULES_REL);
  if (entry && entry.status !== 'deleted' && typeof entry.content === 'string') {
    return { registry: JSON.parse(entry.content), source: 'overlay', rulesHash: sha256(entry.content) };
  }
  const text = readRegistryText(root);
  return { registry: JSON.parse(text), source: `${root}/${RULES_REL}`, rulesHash: sha256(text) };
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
  baseEval = null;
  log('info', `census index rebuilt for wider coverage in ${Date.now() - t0} ms (${baseIndex.files.size} files)`);
}

/**
 * Evaluate every rule over `view` with the engine's own scan + assert. Returns
 * per-rule measurements plus the structural and drift problem lists; no
 * assertion logic of its own.
 */
function evaluate(rules, view) {
  const byRule = new Map();
  const structural = [];
  const drift = [];
  let fileVisits = 0;
  let violations = 0;
  let violatingFiles = 0;
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
    byRule.set(rule.id, { files: result.files, matches: result.matches, drifted: driftProblems.length > 0 });
  }
  return { byRule, structural, drift, fileVisits, violations, violatingFiles };
}

/** The base under this registry: from the cache when the rules text matches, else evaluated and cached. */
function evaluateBase(rules, rulesHash) {
  if (baseEval && baseEval.rulesHash === rulesHash) return { ...baseEval, cached: true };
  const t0 = Date.now();
  const r = evaluate(rules, baseIndex);
  baseEval = { rulesHash, byRule: r.byRule, drift: r.drift, structural: r.structural, ms: Date.now() - t0 };
  return { ...baseEval, cached: false };
}

const samePair = (a, b) => a.files === b.files && a.matches === b.matches;

function runGate(msg) {
  const started = Date.now();
  if (!baseIndex) throw new Error('census index is not built yet');

  const root = normalizeRoot(msg.root ?? baseRoot);
  const requestBase = msg.base?.root ? normalizeRoot(msg.base.root) : baseRoot;
  if (requestBase.toLowerCase() !== baseRoot.toLowerCase()) {
    throw new Error(`base mismatch: worker holds ${baseRoot}, request names ${requestBase}`);
  }
  const overlayFiles = Array.isArray(msg.overlay?.files) ? msg.overlay.files : [];
  // The base root gets full --check semantics; any other root is a worktree
  // and gets the delta. An overlay-free worktree is still a worktree: its diff
  // introduces nothing, whatever the base's own drift.
  const delta = root.toLowerCase() !== baseRoot.toLowerCase();

  const { registry, source, rulesHash } = resolveRegistry(root, overlayFiles);
  const rules = registry.rules ?? [];

  const structural = [];
  let drift = [];
  const introduced = [];
  const resolved = [];
  let baseDrift = 0;

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
  let baseEvalMs = 0;
  let baseEvalCached = null;

  if (structural.length === 0) {
    ensureCoverage(rules);
    const view = delta ? applyOverlay(baseIndex, materializeOverlay(root, overlayFiles)) : baseIndex;
    overlayApplied = view.overlayApplied ?? 0;

    const wt = evaluate(rules, view);
    structural.push(...wt.structural);
    drift = wt.drift;
    fileVisits = wt.fileVisits;
    violations = wt.violations;
    violatingFiles = wt.violatingFiles;

    if (delta) {
      const base = evaluateBase(rules, rulesHash);
      baseEvalMs = base.ms;
      baseEvalCached = base.cached;
      baseDrift = base.drift.length;
      for (const rule of rules) {
        if (!rule.baseline) continue; // a positive control has no baseline and cannot drift
        const w = wt.byRule.get(rule.id);
        const b = base.byRule.get(rule.id);
        if (!w || !b) continue;
        const baseline = { files: rule.baseline.files, matches: rule.baseline.matches };
        if (!samePair(w, b) && !samePair(w, baseline)) {
          introduced.push({ rule: rule.id, files: [w.files, b.files], matches: [w.matches, b.matches], baseline });
        }
        if (b.drifted && !w.drifted) resolved.push(rule.id);
      }
    } else {
      baseDrift = drift.length;
    }
  }

  lastGateMs = Date.now() - started;
  return {
    ok: structural.length === 0 && (delta ? introduced.length === 0 : drift.length === 0),
    delta,
    structural,
    drift,
    baseDrift,
    introduced,
    resolved,
    rules: rules.length,
    fileVisits,
    violations,
    violatingFiles,
    indexedFiles: baseIndex.files.size,
    overlayApplied,
    rulesSource: source,
    rulesHash,
    baseEvalMs,
    baseEvalCached,
    ms: lastGateMs,
  };
}

function status() {
  return {
    indexedFiles: baseIndex ? baseIndex.files.size : 0,
    builtAt: baseIndex ? baseIndex.builtAt : null,
    lastGateMs,
    baseEval: baseEval ? { rulesHash: baseEval.rulesHash.slice(0, 12), drift: baseEval.drift.length, ms: baseEval.ms } : null,
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
      // The daemon's watcher sends absolute paths; the engine keys by
      // base-relative posix paths, so an absolute one would never have hit.
      if (baseIndex && Array.isArray(msg.paths)) invalidateIndex(baseIndex, msg.paths.map(toBaseRel));
      baseEval = null; // the base moved; its evaluation is stale whatever the registry
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
