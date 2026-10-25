// The Codex engine (spark spooky, WP-A). A project whose brief carries `engine: {kind: 'codex'}` keeps
// its App Master on Claude (orchestrator + reviewer) but runs every BUILDER through the OpenAI Codex CLI.
// The project owns ONE durable main Codex thread (`codex init`, persisted in headless/codex.json); each
// build thread is a `codex exec fork` of it, so every build descends from the main thread, and every
// build thread is journalled in headless/codex-threads.jsonl beside its parent.
//
// Lineage mode, measured 2026-10-25 on Codex CLI 0.160.0 (Windows, `[windows] sandbox = "unelevated"`):
//   - `codex exec fork <main>` runs in the SPAWN cwd, not the main thread's: `pwd` in the fork printed
//     the worktree while the main thread had been started in the project root.
//   - fork has no -C/-s/--add-dir, but `-c sandbox_mode="workspace-write"` and
//     `-c sandbox_workspace_write.writable_roots=[...]` are honoured: the cwd and a listed root were
//     writable, an unlisted directory was denied (outside %TEMP%, which workspace-write always allows).
//   - `-c approval_policy="never"` makes exec non-interactive: a denied write is reported, never asked.
//   - a build thread CANNOT commit: workspace-write keeps every `.git` path read-only, even one listed
//     in writable_roots. A worktree commit writes <repo>/.git/worktrees/<name>/index.lock and failed
//     `Permission denied` with the git dir listed, and again with .git/{worktrees,objects,refs,logs}
//     listed one by one. So a Codex builder leaves its change UNCOMMITTED and settle commits it on the
//     run's branch (commitCodexWork) before it verifies anything; the merge gate then judges that commit
//     exactly as it judges a Claude builder's. The alternative, sandbox_mode="danger-full-access", is
//     the bypass this engine must never use.
// So FORK is the mode; `exec` (fresh thread, lineage only in the journal) is kept for a missing parent.
//
// Pure helpers (codexArgs, parseCodexStream, codexLimitSurface, detectCodexLimit, validateEngine) are
// exported for the tests; nothing here starts a real `codex` under test (APPMASTER_CODEX_BIN).

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SKILL_DIR, Refusal, codexPath, codexThreadsPath, headlessDir, runDir, readJson, writeJson, appendJsonl, readJsonl,
  nowIso, shortId, isReviewRun, LIMIT_SIGNATURES, GLOBAL_CAP, projectCap, normRoot, repoOf,
} from './contract.mjs';
import { loadBrief, listRuns, listSlugs, updateRun, findRun, loadWakes } from './store.mjs';

// ---------------------------------------------------------------- the brief key

export const CODEX = {
  kind: 'codex',
  model: 'gpt-6.1-sol',
  effort: 'high',
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  /** fork when the project has a main thread (it always must: dispatch refuses without one) */
  mode: 'fork',
  /** how long dispatch waits for `thread.started` before leaving the id to watch/settle */
  threadWaitMs: 8000,
  /** `codex init` runs in the foreground; a primer that takes longer than this is reported, not waited on */
  initTimeoutMs: 15 * 60000,
  lastMessageClip: 600,
};

/**
 * Lower-cased substrings of a Codex error/turn.failed message that mean the plan is out (usage) or the
 * service is throttling (rate). Measured 2026-10-25: a throttled fork ended on
 * `{"type":"turn.failed","error":{"message":"exceeded retry limit, last status: 429 Too Many Requests"}}`.
 */
export const CODEX_LIMIT_SIGNATURES = [...LIMIT_SIGNATURES, 'rate limit', 'rate_limit', 'too many requests', '429', 'usage_limit', 'quota'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** (engine) => string[]   // errors; absent engine = none (the Claude builders, unchanged) */
export function validateEngine(engine) {
  if (engine == null) return [];
  if (!isObj(engine)) return ['engine must be an object {kind: "codex", model?, effort?}'];
  const errors = [];
  for (const k of Object.keys(engine)) if (!['kind', 'model', 'effort'].includes(k)) errors.push(`engine.${k} is not a known key (kind, model, effort)`);
  if (engine.kind !== CODEX.kind) errors.push(`engine.kind must be "${CODEX.kind}" (omit engine for Claude builders)`);
  if (engine.model != null && !(typeof engine.model === 'string' && engine.model.trim())) errors.push('engine.model must be a Codex model id string');
  if (engine.effort != null && !CODEX.efforts.includes(engine.effort)) errors.push(`engine.effort must be one of ${CODEX.efforts.join(', ')}`);
  return errors;
}

/** (brief) => {kind:'codex', model, effort} | null   // null = Claude builders */
export function engineOf(brief) {
  const e = brief?.engine;
  if (!isObj(e) || e.kind !== CODEX.kind) return null;
  return { kind: CODEX.kind, model: e.model || CODEX.model, effort: e.effort || CODEX.effort };
}
/** The engine a run is billed to: 'codex' or 'claude'. A review run always stays on Claude. */
export const engineName = (run) => (run?.engine === CODEX.kind ? CODEX.kind : 'claude');
/** The engine a usage-limit mark binds ('claude' for every mark written before engines existed). */
export const limitEngine = (mark) => (mark?.engine === CODEX.kind ? CODEX.kind : 'claude');

// ---------------------------------------------------------------- the bin

/**
 * ({env?, platform?, exists?}) => {bin, via: 'env'|'node-entry'|'path'}
 * APPMASTER_CODEX_BIN always wins. On Windows `codex` is an npm .cmd shim, which spawn cannot start
 * without a shell and whose pid would be cmd.exe's; the shim's own node entry
 * (<dir>/node_modules/@openai/codex/bin/codex.js) runs under node instead, so the pid await watches is
 * the real launcher (it waits for the native binary and exits with it). Elsewhere plain `codex`.
 */
export function resolveCodexBin({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const explicit = (env.APPMASTER_CODEX_BIN || '').trim();
  if (explicit) return { bin: explicit, via: 'env' };
  if (platform === 'win32') {
    const dirs = String(env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
    for (const d of dirs) {
      if (!exists(path.join(d, 'codex.cmd'))) continue;
      const entry = path.join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (exists(entry)) return { bin: entry, via: 'node-entry' };
    }
  }
  return { bin: 'codex', via: 'path' };
}
/** [cmd, argv]: a bin ending in .js/.mjs/.cjs runs under this node. */
export const commandFor = (bin, args) => (/\.(m?js|cjs)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]);

// ---------------------------------------------------------------- argv (pure)

/** A TOML array of basic strings (a JSON string is a valid TOML basic string for any path). */
export const tomlStrings = (xs) => `[${xs.map((x) => JSON.stringify(String(x))).join(',')}]`;

/**
 * ({mode, threadId?, model, effort, cwd?, writableRoots?, lastMessage}) => string[]
 *   init    the main thread: fresh, read-only, in the project root (-C)
 *   fork    a build thread forked from the main thread; cwd = the spawn cwd (the worktree), sandbox via -c
 *   resume  a follow-up turn on a build thread (bounce); same sandbox as fork
 *   exec    the fallback: a fresh build thread in -C <worktree> with --add-dir for each writable root
 * Every mode: --json on stdout, approvals never asked, the prompt on STDIN (`-`), the last message to a file.
 * Never `--dangerously-bypass-approvals-and-sandbox`.
 */
export function codexArgs({ mode, threadId, model, effort, cwd, writableRoots = [], lastMessage }) {
  if (!model || !effort) throw new Error('codexArgs: model and effort are required');
  if (!lastMessage) throw new Error('codexArgs: lastMessage is required');
  const common = ['--json', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-c', 'approval_policy="never"'];
  // network on: a build thread installs its dependencies (cargo, pnpm); CastleControl WP 0.6 blocked offline, 2026-10-25
  const net = ['-c', 'sandbox_workspace_write.network_access=true'];
  const sandboxC = ['-c', 'sandbox_mode="workspace-write"', ...net, ...(writableRoots.length ? ['-c', `sandbox_workspace_write.writable_roots=${tomlStrings(writableRoots)}`] : [])];
  const tail = ['-o', lastMessage, '-'];
  switch (mode) {
    case 'init':
      if (!cwd) throw new Error('codexArgs init: cwd (the project root) is required');
      return ['exec', ...common, '-s', 'read-only', '-C', cwd, ...tail];
    case 'fork':
    case 'resume':
      if (!threadId) throw new Error(`codexArgs ${mode}: threadId is required`);
      return ['exec', mode, threadId, ...common, ...sandboxC, ...tail];
    case 'exec':
      if (!cwd) throw new Error('codexArgs exec: cwd (the worktree) is required');
      return ['exec', ...common, '-s', 'workspace-write', ...net, '-C', cwd, ...writableRoots.flatMap((r) => ['--add-dir', r]), ...tail];
    default:
      throw new Error(`codexArgs: unknown mode ${mode}`);
  }
}

// ---------------------------------------------------------------- the stream (pure)

/**
 * (streamText) => {threadId, lastMessage, turnsCompleted, turnFailed, errors[], usage, ended}
 * Codex `exec --json` events: thread.started{thread_id}, turn.started, item.*, turn.completed{usage},
 * turn.failed{error.message}, error{message}. A truncated last line is skipped.
 */
export function parseCodexStream(text) {
  const out = { threadId: null, lastMessage: null, turnsCompleted: 0, turnFailed: false, errors: [], usage: null, ended: null };
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (!isObj(o)) continue;
    if (o.type === 'thread.started' && o.thread_id && !out.threadId) out.threadId = String(o.thread_id);
    else if (o.type === 'item.completed' && o.item?.type === 'agent_message' && typeof o.item.text === 'string') out.lastMessage = o.item.text;
    else if (o.type === 'turn.completed') { out.turnsCompleted++; out.usage = o.usage ?? out.usage; out.ended = 'completed'; out.turnFailed = false; }
    else if (o.type === 'turn.failed') { out.turnFailed = true; out.ended = 'failed'; if (o.error?.message) out.errors.push(String(o.error.message)); }
    else if (o.type === 'error' && o.message) out.errors.push(String(o.message));
  }
  return out;
}
/** The first build/main thread id in a Codex stream, or null. */
export const codexThreadId = (text) => parseCodexStream(text).threadId;

/**
 * The part of a Codex run's output a limit can honestly come from: stderr whole, the message of every
 * `error` and `turn.failed` event, and stdout lines that are not JSON. NOT the items: a command's
 * aggregated_output quotes the repo, and a repo that mentions "rate limit" is not the plan running out.
 */
export function codexLimitSurface(streamText, stderrText = '') {
  const parts = [String(stderrText ?? '')];
  for (const line of String(streamText ?? '').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { parts.push(line); continue; }
    if (!isObj(o)) continue;
    if (o.type === 'error' && o.message) parts.push(String(o.message));
    if (o.type === 'turn.failed' && o.error?.message) parts.push(String(o.error.message));
  }
  return parts.join('\n');
}
export function detectCodexLimit(text) {
  const t = String(text ?? '').toLowerCase();
  return CODEX_LIMIT_SIGNATURES.some((s) => t.includes(s));
}
export function codexLimitSnippet(text) {
  const raw = String(text ?? ''), t = raw.toLowerCase();
  for (const s of CODEX_LIMIT_SIGNATURES) {
    const i = t.indexOf(s);
    if (i >= 0) return raw.slice(Math.max(0, i - 80), i + s.length + 80).replace(/\s+/g, ' ').trim();
  }
  return null;
}

// ---------------------------------------------------------------- the journal

export const loadMain = (slug) => readJson(codexPath(slug), null);
export const loadThreads = (slug) => readJsonl(codexThreadsPath(slug));

/** Append {runId, threadId, parent, mode, startedAt} once per (runId, threadId, mode). */
export function appendThread(slug, row) {
  const seen = loadThreads(slug).some((r) => r.runId === row.runId && r.threadId === row.threadId && r.mode === row.mode);
  if (!seen) appendJsonl(codexThreadsPath(slug), row);
  return row;
}

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/**
 * A codex run whose thread id is not on run.json yet: read it from stream.jsonl, record it, journal it.
 * Idempotent, a no-op for a Claude run. Returns the (maybe updated) run.
 */
export function recordCodexThread(run) {
  if (run?.engine !== CODEX.kind || run.codexThreadId) return run;
  const id = codexThreadId(readText(path.join(runDir(run.slug, run.runId), 'stream.jsonl')));
  if (!id) return run;
  const next = updateRun(run, { codexThreadId: id, sessionId: run.sessionId || id });
  appendThread(run.slug, { runId: run.runId, threadId: id, parent: run.codexParent ?? null, mode: run.codexMode ?? CODEX.mode, startedAt: run.startedAt ?? nowIso() });
  return next;
}

/** The last message Codex wrote with -o, clipped, or null. */
export function lastMessageOf(run, clip = CODEX.lastMessageClip) {
  const t = readText(path.join(runDir(run.slug, run.runId), 'last-message.txt')).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > clip ? `${t.slice(0, clip - 3)}...` : t;
}

// ---------------------------------------------------------------- spawn

/**
 * The roots a build thread may write besides its cwd (the worktree): the run dir, for result.json, then
 * the package caches that exist on this machine (cargo registry and git checkouts, the pnpm store, the npm
 * cache), so a build can fetch its dependencies. Without them WP 0.6 could not resolve one crate (2026-10-25).
 */
export const toolchainCacheRoots = (home = os.homedir(), localAppData = process.env.LOCALAPPDATA) => [
  path.join(home, '.cargo', 'registry'), path.join(home, '.cargo', 'git'),
  ...(localAppData ? [path.join(localAppData, 'pnpm', 'store'), path.join(localAppData, 'npm-cache')] : []),
].filter((d) => fs.existsSync(d));
export const writableRootsFor = (run) => [runDir(run.slug, run.runId), ...toolchainCacheRoots()];

const git = (cwd, args, opts = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...opts });

/** Paths `git status` reports in a worktree (tracked changes and untracked files), NUL-safe. */
function dirtyPaths(worktree) {
  const out = git(worktree, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']);
  return out.split('\0').filter((e) => e.length > 3).map((e) => e.slice(3));
}

/** One line for the commit: the claim's commitMessage, else its summary's first sentence, else the charter. */
export function commitMessageFor(run, claim) {
  const pick = [claim?.commitMessage, String(claim?.summary ?? '').split(/(?<=\.)\s|\n/)[0]].find((m) => typeof m === 'string' && m.trim());
  const head = (pick || `${run.charterSlug}: codex build`).replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${head}\n\nCommitted by the App Master for Codex build thread ${run.codexThreadId ?? '(unknown)'} (run ${shortId(run.runId)}, forked from ${run.codexParent ?? 'no main thread'}): the Codex sandbox keeps .git read-only.`;
}

/**
 * Settle's first step for a codex run (the builder cannot commit, see the header): when the claim
 * says done or partial and the worktree holds changes, stage exactly those paths (never a
 * node_modules junction) and commit them on the run's branch, hooks included (never --no-verify).
 * A run with no claim, or a blocked one, is left as it is: it settles like a Claude run that left
 * uncommitted work. (run, claim, {junctions}) => {sha, files, message} | {error, files} | null
 */
export function commitCodexWork(run, claim, { junctions = [] } = {}) {
  if (run?.engine !== CODEX.kind || !run.worktree || !fs.existsSync(run.worktree)) return null;
  if (!claim || !['done', 'partial'].includes(claim.status)) return null;
  const skip = junctions.map((j) => j.replace(/\\/g, '/').replace(/\/+$/, ''));
  const files = dirtyPaths(run.worktree).filter((f) => !skip.some((j) => f === j || f === `${j}/` || f.startsWith(`${j}/`)));
  if (!files.length) return null;
  const message = commitMessageFor(run, claim);
  try {
    git(run.worktree, ['add', '--', ...files]);
    git(run.worktree, ['commit', '-q', '-F', '-'], { input: message });
  } catch (e) {
    return { error: String(e.stderr || e.message || e).trim().split('\n').slice(-3).join(' | '), files };
  }
  return { sha: git(run.worktree, ['rev-parse', 'HEAD']).trim(), files, message: message.split('\n')[0] };
}

/** The addendum appended to roles/builder.md for a Codex build thread. */
export function renderCodexAddendum(run) {
  const t = fs.readFileSync(path.join(SKILL_DIR, 'roles', 'builder-codex.md'), 'utf8');
  const values = {
    runDir: runDir(run.slug, run.runId), worktree: run.worktree, branch: run.branch, mainThreadId: run.codexParent || '(none: a fresh thread)',
    writableRoots: writableRootsFor(run).map((r) => `\`${r}\``).join(', '),
  };
  return t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Start a Codex process detached in `cwd`, prompt on STDIN, stdout appended to <dir>/stream.jsonl,
 * stderr to <dir>/stderr.log, pid to <dir>/pid. Waits up to waitMs for `thread.started`.
 * The prompt is a FILE handed over as the child's stdin (<dir>/prompt-<ts>.md), not a pipe: Codex reads
 * stdin to EOF before it starts the thread, and a pipe this process writes would not be flushed while
 * the synchronous wait below holds the event loop (measured: no thread.started in 8 s through a pipe).
 * (opts) => {pid, threadId|null}
 */
export function spawnCodex({ cwd, dir, args, prompt, env, waitMs = CODEX.threadWaitMs, bin = resolveCodexBin().bin }) {
  fs.mkdirSync(dir, { recursive: true });
  const [cmd, argv] = commandFor(bin, args);
  const streamPath = path.join(dir, 'stream.jsonl');
  const promptPath = path.join(dir, `prompt-${Date.now()}.md`);
  fs.writeFileSync(promptPath, prompt, 'utf8');
  const inp = fs.openSync(promptPath, 'r');
  const out = fs.openSync(streamPath, 'a');
  const err = fs.openSync(path.join(dir, 'stderr.log'), 'a');
  let child;
  try {
    child = spawn(cmd, argv, { cwd, env, detached: true, windowsHide: true, stdio: [inp, out, err] });
  } finally {
    fs.closeSync(inp); fs.closeSync(out); fs.closeSync(err);
  }
  if (!child.pid) throw new Error(`could not spawn ${cmd}`);
  child.on('error', () => {});
  child.unref();
  fs.writeFileSync(path.join(dir, 'pid'), String(child.pid));
  let threadId = null;
  const until = Date.now() + waitMs;
  while (!threadId && Date.now() < until) {
    threadId = codexThreadId(readText(streamPath));
    if (!threadId) nap(150);
  }
  return { pid: child.pid, threadId };
}

/**
 * The builder spawn for a codex run (worker.spawnWorker delegates here). Fork from the main thread
 * when the run names one (always, through dispatch), else a fresh exec in the worktree.
 * (run, prompt, env) => {pid, sessionId, codexThreadId}
 */
export function spawnCodexWorker(run, promptText, env) {
  const dir = runDir(run.slug, run.runId);
  const mode = run.codexParent ? 'fork' : 'exec';
  const args = codexArgs({
    mode, threadId: run.codexParent, model: run.model, effort: run.effort || CODEX.effort,
    cwd: run.worktree, writableRoots: writableRootsFor(run), lastMessage: path.join(dir, 'last-message.txt'),
  });
  const { pid, threadId } = spawnCodex({ cwd: run.worktree, dir, args, prompt: promptText, env });
  return { pid, sessionId: threadId, codexThreadId: threadId, codexMode: mode };
}

// ---------------------------------------------------------------- the CLI: codex init | show | say

function requireSlug(flags) {
  if (!flags.project || flags.project === true) throw new Error('--project <slug> is required');
  const want = String(flags.project).toLowerCase();
  const slug = listSlugs().find((s) => s === want);
  if (!slug) throw new Error(`no managed project "${flags.project}" (managed: ${listSlugs().join(', ') || 'none'})`);
  return slug;
}

/** The project root: --root, else the last context snapshot, else the app DB (read-only). */
async function projectRootOf(slug, flags) {
  if (flags.root && flags.root !== true) return { root: path.resolve(String(flags.root)), name: slug, from: '--root' };
  const known = loadWakes(slug).filter((w) => w.project?.root).at(-1)?.project;
  if (known) return { root: known.root, name: known.name || slug, from: 'wakes' };
  const { resolveProject } = await import('./dbread.mjs');
  const p = resolveProject(slug);
  return { root: p.root, name: p.name || slug, from: 'db' };
}

/** The primer the main thread starts from: what the project is, where its plan lives, how builds relate. */
export function renderPrimer({ slug, name, root, brief, planFiles }) {
  const product = typeof brief?.product === 'string' && brief.product.trim() ? brief.product.trim() : '(the brief names no product)';
  const goals = Array.isArray(brief?.goals) ? brief.goals.map((g) => `- ${g.title}`).join('\n') : '';
  return [
    `You are the main Codex thread of the project **${name}** (${slug}), rooted at \`${root}\`.`,
    '',
    'This thread does not change files (it runs read-only). It is the durable root of the project: every build thread',
    'is forked from it, receives ONE task in its own git worktree from the project\'s App Master, leaves its change there',
    '(the sandbox keeps .git read-only, so the App Master commits it), and reports back by writing a result.json the',
    'App Master verifies. Follow-ups to a build continue that build\'s thread.',
    '',
    `What the project is: ${product}`,
    goals ? `\nGoals:\n${goals}` : '',
    '',
    planFiles.length
      ? `The plan lives in \`docs/plan/\`: ${planFiles.map((f) => `\`${f}\``).join(', ')}.`
      : 'There is no `docs/plan/` directory yet; the App Master keeps the plan in its own journal.',
    '',
    'Now read the project\'s agent instructions (AGENTS.md, CLAUDE.md, whichever exist) and the plan files above,',
    'without running anything that writes, and reply with a summary of under 150 words: the product, the stack,',
    'the conventions a builder must keep. Build threads will start from this summary.',
  ].join('\n');
}

async function codexInit(flags) {
  const slug = requireSlug(flags);
  const brief = loadBrief(slug) || {};
  const engine = engineOf(brief);
  if (!engine) throw new Refusal('not a codex project', { slug, hint: 'the brief needs "engine": {"kind": "codex"} (onboard --force)' });
  const target = codexPath(slug);
  let backup = null;
  if (fs.existsSync(target)) {
    if (!flags.force) throw new Refusal('codex main thread exists', { slug, codexPath: target, main: loadMain(slug), hint: 'pass --force to start a new main thread (a .bak copy is kept)' });
    backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(target, backup);
  }
  const { root, name, from } = await projectRootOf(slug, flags);
  if (!fs.existsSync(root)) throw new Error(`project root ${root} does not exist`);
  const planDir = path.join(root, 'docs', 'plan');
  let planFiles = [];
  try { planFiles = fs.readdirSync(planDir).filter((f) => !f.startsWith('.')).sort().slice(0, 20).map((f) => `docs/plan/${f}`); } catch { /* none */ }
  const prompt = renderPrimer({ slug, name, root, brief, planFiles });
  const dir = path.join(headlessDir(slug), 'codex-init');
  fs.mkdirSync(dir, { recursive: true });
  const lastMessage = path.join(dir, 'last-message.txt');
  const args = codexArgs({ mode: 'init', model: engine.model, effort: engine.effort, cwd: root, lastMessage });
  const [cmd, argv] = commandFor(resolveCodexBin().bin, args);
  const r = spawnSync(cmd, argv, { cwd: root, input: prompt, encoding: 'utf8', windowsHide: true, timeout: CODEX.initTimeoutMs, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(dir, 'stream.jsonl'), r.stdout ?? '');
  fs.writeFileSync(path.join(dir, 'stderr.log'), r.stderr ?? '');
  fs.writeFileSync(path.join(dir, 'primer.md'), prompt);
  const parsed = parseCodexStream(r.stdout);
  if (!parsed.threadId) throw new Error(`codex init: no thread.started event (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}); see ${dir}`);
  if (parsed.turnFailed || r.status !== 0) {
    const surface = codexLimitSurface(r.stdout, r.stderr);
    throw new Refusal(detectCodexLimit(surface) ? 'codex usage limit' : 'codex init failed', {
      slug, threadId: parsed.threadId, exit: r.status, errors: parsed.errors, hint: 'nothing was persisted; run codex init again later', dir,
    });
  }
  const main = { mainThreadId: parsed.threadId, model: engine.model, effort: engine.effort, createdAt: nowIso(), cwd: root };
  writeJson(target, main);
  return { slug, ...main, codexPath: target, backup, rootFrom: from, planFiles, summary: parsed.lastMessage };
}

function codexShow(flags) {
  const slug = requireSlug(flags);
  const main = loadMain(slug);
  const runs = new Map(listRuns(slug).map((r) => [r.runId, r]));
  const threads = loadThreads(slug).map((t) => ({ ...t, runId8: shortId(t.runId), state: runs.get(t.runId)?.state ?? null, charter: runs.get(t.runId)?.charterSlug ?? null }));
  return { slug, engine: engineOf(loadBrief(slug)), main, threads, codexPath: codexPath(slug), threadsPath: codexThreadsPath(slug) };
}

/** Rename the run's current output aside (stream.1.jsonl, ...) so a follow-up turn is judged on its own. */
function rotateOutput(dir) {
  const names = ['stream.jsonl', 'stderr.log', 'result.json', 'last-message.txt'];
  let n = 1;
  while (names.some((f) => fs.existsSync(path.join(dir, f.replace(/(\.[a-z]+)$/, `.${n}$1`))))) n++;
  const moved = [];
  for (const f of names) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const to = path.join(dir, f.replace(/(\.[a-z]+)$/, `.${n}$1`));
    fs.renameSync(p, to);
    moved.push(path.basename(to));
  }
  return { generation: n, moved };
}

const SAY_STATES = ['held', 'exited', 'failed', 'released'];

async function codexSay(flags) {
  const run = findRun(String(flags.run ?? ''));
  if (!flags.run || flags.run === true || !run) throw new Error('--run <runId> of a codex build is required');
  if (!flags.file || flags.file === true) throw new Error('--file <msg.md> is required');
  const message = fs.readFileSync(String(flags.file), 'utf8').replace(/^﻿/, '');
  if (!message.trim()) throw new Error(`${flags.file} is empty`);
  if (run.engine !== CODEX.kind || isReviewRun(run)) throw new Refusal('not a codex build', { runId: run.runId, engine: engineName(run) });
  const live = recordCodexThread(run);
  if (!live.codexThreadId) throw new Refusal('no codex thread', { runId: run.runId, hint: 'the run never reported thread.started; nothing to resume' });
  if (!SAY_STATES.includes(live.state)) throw new Refusal('run not resumable', { runId: run.runId, state: live.state, hint: `say takes a ${SAY_STATES.join(', ')} run (a merged run's worktree is gone; a running one is still working)` });
  if (!live.worktree || !fs.existsSync(live.worktree)) throw new Refusal('worktree gone', { runId: run.runId, worktree: live.worktree ?? null });
  const { readLimit } = await import('./limits.mjs');
  const limit = readLimit();
  if (limit && limitEngine(limit) === CODEX.kind) throw new Refusal('usage limit', { engine: CODEX.kind, resetsAt: limit.resetsAt ?? null, reason: limit.reason });
  const mine = listRuns(live.slug, { states: ['running'] });
  const cap = projectCap(loadBrief(live.slug));
  if (mine.length >= cap) throw new Refusal('project cap', { cap, running: mine.map((r) => shortId(r.runId)) });
  const all = listSlugs().flatMap((s) => listRuns(s, { states: ['running'] }));
  if (all.length >= GLOBAL_CAP) throw new Refusal('global cap', { cap: GLOBAL_CAP });
  const others = listSlugs().flatMap((s) => listRuns(s, { states: ['running', 'exited', 'verifying'] }))
    .filter((r) => r.runId !== live.runId && normRoot(repoOf(r).root || '') === normRoot(repoOf(live).root || ''));
  const { overlappingPairs } = await import('./paths.mjs');
  const clash = others.filter((r) => !isReviewRun(r) && overlappingPairs(live.paths, r.paths).length);
  if (clash.length) throw new Refusal('paths overlap', { runId: live.runId, with: clash.map((r) => `${r.slug}:${shortId(r.runId)} (${r.state})`) });

  const dir = runDir(live.slug, live.runId);
  const rotated = rotateOutput(dir);
  const prompt = [
    'The App Master reviewed this build and sends it back. Address the following in the same worktree and on the',
    'same branch, commit, then write result.json again exactly as before (the earlier one was moved aside).',
    '',
    message.trim(),
  ].join('\n');
  fs.writeFileSync(path.join(dir, `say.${rotated.generation}.md`), prompt);
  const args = codexArgs({
    mode: 'resume', threadId: live.codexThreadId, model: live.model, effort: live.effort || CODEX.effort,
    writableRoots: writableRootsFor(live), lastMessage: path.join(dir, 'last-message.txt'),
  });
  const { workerEnv } = await import('./worker.mjs');
  const { pid, threadId } = spawnCodex({ cwd: live.worktree, dir, args, prompt, env: workerEnv(live.slug, live) });
  const startedAt = nowIso();
  appendThread(live.slug, { runId: live.runId, threadId: threadId || live.codexThreadId, parent: live.codexParent ?? null, mode: 'resume', startedAt });
  const bounces = [...(live.bounces ?? []), { at: startedAt, generation: rotated.generation, fromState: live.state, heldReason: live.heldReason ?? null, file: String(flags.file) }];
  const next = updateRun(live, {
    state: 'running', pid, startedAt, endedAt: null, limitSeenAt: null, verdict: null, settledAt: null, heldReason: null, bounces,
  });
  const { awaitCommandFor } = await import('./worker.mjs');
  return { ...next, rotated, resumedThreadId: threadId || live.codexThreadId, awaitCommand: awaitCommandFor(next) };
}

/** (args) => object   // codex init --project p [--force] [--root dir] | show --project p | say --run id --file msg.md */
export async function cmdCodex({ _ = [], flags = {} } = {}) {
  const sub = _[0];
  if (sub === 'init') return codexInit(flags);
  if (sub === 'show') return codexShow(flags);
  if (sub === 'say') return codexSay(flags);
  throw new Error(`codex: unknown sub-command ${sub ?? '(none)'} (init|show|say)`);
}
