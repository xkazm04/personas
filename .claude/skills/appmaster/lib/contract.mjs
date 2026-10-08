// /appmaster wire contract (WP0). Every number, vocabulary, path and record shape the three
// packages share lives HERE and nowhere else; a package that needs a value imports it.
//
// The headless App Master is the in-app App Master (engine/subscription/attention*.rs) with
// the app closed: this session is the clock, one subagent per project decides a wake, this
// session spawns the builders. Its record is FILES under .claude/master/<slug>/headless/;
// the app DB is read-only here, and every write the app owns is queued in an outbox and
// replayed through the app's own doors when it is up (lib/outbox.mjs).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- paths

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');
/** Per-project state root; shared with /master (brief.json, state.json, cursor.json, log.jsonl). */
export const STATE_ROOT = process.env.APPMASTER_STATE_ROOT || path.join(REPO_ROOT, '.claude', 'master');
export const DB_PATH = process.env.PERSONAS_DB
  || path.join(process.env.APPDATA || os.homedir(), 'com.personas.desktop', 'personas.db');
/** Worktrees live outside every repo so a recursive delete of one can never reach a checkout. */
export const WORKTREE_ROOT = process.env.APPMASTER_WORKTREE_ROOT
  || path.join(os.homedir(), '.personas', 'headless-masters', 'worktrees');

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The skill slug of a project: the root's last path segment (kp is "CandiDate" in dev_projects). */
export const slugOf = (name, root) => slugify(path.basename(String(root || '').replace(/[\\/]+$/, '')) || name);

export const stateDir = (slug) => path.join(STATE_ROOT, slug);
export const headlessDir = (slug) => path.join(stateDir(slug), 'headless');
export const briefPath = (slug) => path.join(stateDir(slug), 'brief.json');
export const wakesPath = (slug) => path.join(headlessDir(slug), 'wakes.jsonl');
export const asksPath = (slug) => path.join(headlessDir(slug), 'asks.jsonl');
export const channelPath = (slug) => path.join(headlessDir(slug), 'channel.jsonl');
export const outboxPath = (slug) => path.join(headlessDir(slug), 'outbox.jsonl');
export const contextDir = (slug) => path.join(headlessDir(slug), 'context');
/** Durable copies of the council run directories review runs produced (the worktree is removed). */
export const councilDir = (slug) => path.join(headlessDir(slug), 'council');
export const runsDir = (slug) => path.join(headlessDir(slug), 'runs');
export const runDir = (slug, runId) => path.join(runsDir(slug), runId);
/** Global (not per project): a usage limit belongs to the subscription. */
export const limitPath = () => path.join(STATE_ROOT, '_headless-limit.json');
/** Global: the durable admission queue (append-only, latest line per runId wins) and its lock. */
export const queuePath = () => path.join(STATE_ROOT, '_queue.jsonl');
export const queueLockPath = () => path.join(STATE_ROOT, '_queue.lock');
export const shortId = (runId) => String(runId).replace(/-/g, '').slice(0, 8);

// ---------------------------------------------------------------- numbers (defined ONCE)

/** The repo key of a project's own checkout (a dispatch with no `repo` targets it). */
export const SELF_REPO = 'self';

/** A checkout root as a comparable key (resolved, no trailing separator, case-folded on Windows). */
export const normRoot = (p) => {
  const r = path.resolve(String(p ?? '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
/**
 * Two repos several masters write into (lib/repos.mjs): personas-web also changes the Personas
 * desktop, and the game masters forge into the knowledge registry. Overridable for tests.
 */
export const PERSONAS_ROOT = process.env.APPMASTER_PERSONAS_ROOT || 'C:\\Users\\kazda\\kiro\\personas';
export const AI_REGISTRY_ROOT = process.env.APPMASTER_REGISTRY_ROOT || 'C:\\Users\\kazda\\kiro\\ai-registry';
/**
 * Repo lanes: the most live runs (running, exited, verifying, or planned with a worktree) that may
 * target one repo root at once, across ALL projects. A brief's `repos[].lane` may only tighten one.
 * Exceeding it refuses `repo lane` (a queue reason).
 */
export const REPO_LANES = { [normRoot(PERSONAS_ROOT)]: 1, [normRoot(AI_REGISTRY_ROOT)]: 1 };
/** Operator rule: ONE Personas cargo target; a run targeting that repo never starts a second Rust tree. */
export const PERSONAS_CARGO_TARGET = path.join(PERSONAS_ROOT, 'src-tauri', 'target');
/** The repo a run targets: what run.json recorded at decide, else (older runs) the project's own checkout. */
export const repoOf = (run) => ({
  key: run?.repo ?? SELF_REPO,
  root: run?.repoRoot ?? run?.project?.root,
  baseBranch: run?.repoBase ?? run?.project?.baseBranch,
});
/**
 * Cargo jobs one Rust run may use. Up to GLOBAL_CAP builders, their gates and the operator's own
 * builds share one 16-core machine; an uncapped cargo takes every core (operator, 2026-10-07).
 */
export const RUST_BUILD_JOBS = 6;
const rustRepoCache = new Map();
/** A repo compiles Rust when its root, or its src-tauri/, holds a Cargo.toml. */
export function isRustRepo(root) {
  if (!root) return false;
  const key = normRoot(root);
  if (!rustRepoCache.has(key)) {
    rustRepoCache.set(key, ['Cargo.toml', path.join('src-tauri', 'Cargo.toml')].some((f) => fs.existsSync(path.join(root, f))));
  }
  return rustRepoCache.get(key);
}
/**
 * Env a builder and its gates get for the repo they work in: the Personas repo's one cargo target,
 * and a job cap on any Rust repo. Other Rust repos keep a target per worktree on purpose: a target
 * shared by two live worktrees lets one branch's tests run the other's binaries (cargo judges
 * freshness by mtime and hashes member paths relative to the workspace).
 */
export const repoEnv = (root) => ({
  ...(root && normRoot(root) === normRoot(PERSONAS_ROOT) ? { CARGO_TARGET_DIR: PERSONAS_CARGO_TARGET } : {}),
  ...(isRustRepo(root) ? { CARGO_BUILD_JOBS: String(RUST_BUILD_JOBS) } : {}),
});

/** Projects this skill manages by default; any other brief.json opts in with `"headless": true`. */
export const DEFAULT_MANAGED = ['pof', 'ascent', 'kp'];

// Builders running at once across all projects (ten masters share it; a refused dispatch queues).
// 16 since 2026-10-07 midday: the operator gave the machine to this loop ("two threads per app
// master, at most 16 LLM processes"); it was 8 while sibling sessions shared it. MEM still brakes.
export const GLOBAL_CAP = 16;
/**
 * Builders running at once in one project. Two only when their declared `paths` are disjoint from
 * every other live run of the project (dispatch refuses `paths overlap`); the free-memory brake
 * (MEM) still decides whether the machine can carry another one.
 */
export const PER_PROJECT_CAP = 2;
/**
 * Memory admission, in GB of FREE memory (lib/memory.mjs). Replaces the old machine-wide used-% brake,
 * which a sibling process could pin high without this loop being the cause.
 */
export const MEM = {
  dispatchMinFreeGb: 4,        // a dispatch needs this much free ...
  perBuilderReserveGb: 1.5,    // ... plus this per builder already running (they grow: tsc, vitest)
  gateMinFreeGb: 6,            // a gate run (typecheck ~2.6 GB + a test run) needs this much free
  samples: 5,                  // free memory is the MEDIAN of this many readings
  sampleGapMs: 600,
  gateWaitMaxMin: 20,          // settle waits this long for the gate slot and the headroom, then refuses
  gateWaitPollSec: 20,
  lockStaleMin: 45,            // a gate lock older than this, or whose pid is dead, is taken over
};
export const QUIET_MIN = 10;          // a run whose stream.jsonl is this old is flagged quiet (never killed)
export const TIMEOUT_MIN = 90;        // a run older than this is flagged timed-out (never killed); also `await`'s default wait
/**
 * `await` (lib/await.mjs): an exit watcher instead of a polling Director. It polls the builder's pid
 * (cheap, no LLM) every pollSec, then watches and settles that run. Its per-run lock
 * (runs/<id>/await.lock) expires at the wait + MEM.gateWaitMaxMin + lockSlackMin, so a reused pid
 * can never hold a run forever.
 */
export const AWAIT = { pollSec: 5, lockSlackMin: 120 };
export const WAKE_MIN = 10;           // nextWakeMinutes bounds a master may choose
export const WAKE_MAX = 240;
export const MAX_ASKS = 3;            // asks one decision may raise
export const MAX_DISPATCH = 2;        // dispatches one decision may make (== PER_PROJECT_CAP); 2 needs disjoint `paths`
export const SLEEP_MIN_SEC = 60;      // the Director's ScheduleWakeup clamp
export const SLEEP_MAX_SEC = 3600;
/**
 * The admission queue (lib/queue.mjs). "Later is a promise": a dispatch refused for one of these
 * reasons is not dropped but held in _queue.jsonl until `promote` dispatches it or `queue drop`
 * refuses it explicitly. A usage limit is NOT a reason to queue: it stops the loop.
 * The lock serialises dispatch and promote across processes (several awaits promote at once).
 */
/**
 * The plan a master returns on a PLAN WAKE (a project with no plan in the journal and no milestone in
 * the app): 1..5 milestones of 1..5 goals each, strings bounded. Queued as ONE outbox entry `plan`.
 */
export const PLAN = { minMilestones: 1, maxMilestones: 5, minGoals: 1, maxGoals: 5, nameMax: 120, goalMax: 500, titleMax: 160, measureMax: 300, descriptionMax: 1000 };
/**
 * The council lane. Two charter slugs a brief may list are REVIEW runs, not builds: the builder role is
 * roles/council-reviewer.md, which runs `/council --lite <feature>` or `/council <feature>` in the
 * project repo's worktree and must not change code. settle ends one `reviewed` (a terminal state),
 * never `merged`. A dispatch for them carries `featureSlug` (a dev_use_cases slug).
 */
export const REVIEW_CHARTERS = { 'council-lite-review': 'lite', 'council-review': 'full' };
export const isReviewRun = (run) => Boolean(REVIEW_CHARTERS[run?.charterSlug]);
export const COUNCIL = {
  runsRel: '.personas/council/runs',         // where the council writes <YYYY-MM-DD>-<slug>-r<n>/ (the skill's default)
  stateRel: '.personas/council/state.json',  // what a person decided last time (seeded into the worktree)
  outcomes: ['ready', 'fail', 'incomplete', 'stalled'],
  maxRounds: 3,                              // the council refuses round 4 (stalled); decide refuses dispatching it
  mustAddressItems: 3, mustAddressChars: 200,
  reportMax: 20000,                          // the report.md carried in a `report` outbox entry
  attachmentsMax: 12,                        // the reports door's own cap (headless_report.rs MAX_ATTACHMENTS); 20 was refused 400
  // the reports door's accepted types (headless_report.rs check_attachment); any other file is refused 400
  attachable: /\.(png|jpe?g|gif|webp|mp4|webm|pdf|md|markdown)$/i,
};
export const FEATURE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * The UX gate (pof, via its brief). A `ux-proposal` run files a `[UX]` idea and merges a prototype;
 * decide REFUSES one while more than `pendingMax` of the project's pending ideas carry the prefix
 * (machine-enforced: the operator reviews the pile before more is added to it).
 */
export const UX = { charter: 'ux-proposal', titlePrefix: '[UX]', pendingMax: 10 };
/**
 * Charters with no row in recipe_definitions: their title and one-line purpose are built in, so the
 * context still says what each is for (lib/dbread.mjs chartersFor, the YOUR CHARTERS section).
 */
export const BUILTIN_CHARTERS = {
  'council-lite-review': { title: 'Council-lite review of one feature', purpose: 'Run the lite council on one feature (featureSlug) and report its outcome and must-address; every feature passes it, reworked until lite-ready. Writes no code.' },
  'council-review': { title: 'Full council review of one major feature', purpose: 'Run the full council on one lite-ready feature you judge major; a ready result goes to the operator as a Report with an Approval. Writes no code.' },
  'ux-proposal': { title: 'UX proposal', purpose: 'File one [UX] idea through the ideas door and merge its prototype as a /layout lab variant, for the operator to judge; refused while more than 10 [UX] ideas wait.' },
};
export const QUEUE_REASONS = ['global cap', 'project cap', 'repo lane', 'paths overlap', 'memory'];
export const QUEUE_STATES = ['queued', 'promoted', 'dropped'];
export const QUEUE_LOCK = { waitMs: 30000, pollMs: 100, staleMin: 10 };

// ---------------------------------------------------------------- vocabularies

export const RUN_STATES = ['planned', 'running', 'exited', 'verifying', 'merged', 'held', 'released', 'failed', 'reviewed'];
export const LIVE_RUN_STATES = ['planned', 'running', 'exited', 'verifying'];
/** States settle never moves a run out of (`reviewed`: a council review run, settled without a merge). */
export const SETTLED_STATES = ['merged', 'failed', 'released', 'reviewed'];
export const ASK_KINDS = ['scope', 'spend', 'risk', 'goal-conflict', 'recipe-failing', 'merge-held', 'other'];
export const OUTBOX_KINDS = ['idea-verdict', 'task-complete', 'ask', 'say', 'plan', 'council', 'tier', 'report'];
export const OUTBOX_STATES = ['queued', 'replayed', 'failed', 'skipped'];
export const VERDICT_STATUSES = ['accepted', 'rejected'];
/** Exit codes: 0 ok, 2 refused by a brake or a gate (stdout carries {refused}), 1 error. */
export const EXIT = { OK: 0, ERROR: 1, REFUSED: 2 };

// ---------------------------------------------------------------- models

/**
 * The Opus id is `claude-opus-5-5` since 2026-10-07: `claude -p --model claude-opus-5-5 "say ok"`
 * answered (exit 0) that day. `claude-opus-5` stays an accepted alias of it, so a master that still
 * writes the old id is upgraded rather than refused.
 */
export const MODELS = {
  master: 'claude-opus-5-5',
  builder: 'claude-sonnet-5-5',
  /** charters that default to Opus builders; the brief's models.byCharter overrides any of this */
  builderByCharter: { 'codebase-architecture-review': 'claude-opus-5-5', 'codebase-security-scan': 'claude-opus-5-5' },
};
/** The short forms (and the retired id) a master may write in a dispatch's `model`; each resolves to a model id above. */
export const MODEL_ALIASES = { sonnet: MODELS.builder, opus: MODELS.master, 'claude-opus-5': MODELS.master };
/** Every value a dispatch's `model` may take: the short forms and the model ids they name. */
export const BUILDER_MODEL_CHOICES = [...new Set([...Object.keys(MODEL_ALIASES), ...Object.values(MODEL_ALIASES)])];
/** 'opus' (or the retired 'claude-opus-5') -> 'claude-opus-5-5'; any other full id is returned as it is. */
export const resolveModel = (m) => MODEL_ALIASES[m] ?? m;

// ---------------------------------------------------------------- worker spawn contract

/** Removed from the child env: API-key billing leaks and every Claude Code nesting marker. */
export const ENV_STRIP = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_EFFORT',
];
export const ENV_SET = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' };
/** Lower-cased substrings of a worker's output that mean the subscription (or a model) hit its limit. */
export const LIMIT_SIGNATURES = [
  'usage limit', 'session limit', 'usage-credits', 'limit will reset', 'limit resets', 'hit your',
  'reached your', 'switch to another model',
];
export const RUN_LABEL_PREFIX = 'cli-master:';
export const claudeBin = () => process.env.APPMASTER_CLAUDE_BIN || 'claude';

// ---------------------------------------------------------------- record shapes (JSDoc = the contract)

/**
 * @typedef {Object} ProjectCtx        resolved once from dev_projects, then snapshotted into every record
 * @property {string} slug             skill slug (slugOf)
 * @property {string} id               dev_projects.id
 * @property {string} name
 * @property {string} root             absolute path of the project's main checkout
 * @property {string} baseBranch       dev_projects.main_branch (kp is "main", the others "master")
 */

/**
 * @typedef {Object} Brief             .claude/master/<slug>/brief.json, /master's schema; this skill only READS it
 * @property {Array<{slug:string,priority:number|null}>} charters
 * @property {boolean} [headless]     opt a project outside DEFAULT_MANAGED into this skill
 * @property {Array<{key:string,root:string,baseBranch:string,lane?:number,gates?:Object}>} [repos]
 *   repos this project's master may also target; the project's own checkout is the implicit key `self`.
 *   `gates` names that repo's gate commands (a repo without a manifest or package.json has none).
 * @property {string[]} [boundaries]   path globs (no whitespace, enforced) or prose rules (passed to the builder only)
 * @property {{typecheck?:string,lint?:string,test?:string}} [gates]  shell commands; else .ai/manifest.yaml capabilities
 * @property {{master?:string,builder?:string,byCharter?:Record<string,string>}} [models]
 * @property {string[]} [askFor]
 * @property {string} [reportStyle]
 */

/**
 * @typedef {Object} Decision          the master's whole answer to one wake (schema/decision.schema.json)
 * ABSENT-VALUE CONVENTION: every array is present (empty []), `say` is null when silent. Never omitted.
 * @property {string} wakeId
 * @property {Array<{charterSlug:string,reason:string,brief:string,ideaIds:string[],model?:string|null,paths?:string[],repo?:string,featureSlug?:string}>} dispatch
 *   `featureSlug` is REQUIRED for a REVIEW_CHARTERS dispatch (and optional on a rework delivery)
 *   `model` (BUILDER_MODEL_CHOICES) overrides the charter's default unless the brief pins one;
 *   `paths` (repo-relative path prefixes / globs the builder will touch) is REQUIRED on every entry
 *   when there are two, and the two must be disjoint (lib/paths.mjs)
 * @property {Array<{charterSlug:string,reason:string}>} defer
 * @property {Array<{kind:string,question:string,context:string,options:Array<{label:string,action:string}>}>} asks
 * @property {Array<{ideaId:string,status:'accepted'|'rejected',reason:string}>} ideaVerdicts
 * @property {string|null} say
 * @property {string} note              the coverage note; the next wake's context quotes it
 * @property {number} nextWakeMinutes   integer WAKE_MIN..WAKE_MAX
 * @property {{milestones:Array<{name:string,goal:string,targetDate?:string|null,goals:Array<{title:string,measure:string,description?:string|null}>}>}|null} [plan]
 *   REQUIRED on a plan wake (the wake line carries planWake: true), refused on any other; absent or null otherwise
 */

/**
 * @typedef {Object} Wake              one line of wakes.jsonl (written by `context`, completed by `decide`)
 * @property {string} wakeId
 * @property {string} slug
 * @property {string} at
 * @property {string} contextPath
 * @property {'context'|'decided'} status
 * @property {Decision} [decision]
 * @property {string[]} [runIds]
 * @property {string} [nextWakeAt]      ISO; at + nextWakeMinutes
 * @property {string} [note]
 */

/**
 * @typedef {Object} Run               runs/<runId>/run.json
 * @property {string} runId            minted by `decide` BEFORE any effect (intent mints the identity)
 * @property {string} slug
 * @property {ProjectCtx} project
 * @property {string} wakeId
 * @property {string} charterSlug
 * @property {string} reason
 * @property {string} brief            the master's task text for this dispatch
 * @property {string[]} ideaIds
 * @property {string} state            RUN_STATES
 * @property {string} model
 * @property {'brief'|'decision'|'contract'} [modelSource]   who chose the model (the brief, the master, the defaults)
 * @property {string[]} [paths]        what the builder declared it will touch; [] / absent = the whole repo
 * @property {string} [repo]           the target repo key (SELF_REPO or a brief.repos key); absent = self
 * @property {string} [repoRoot]       the target repo's checkout (worktree, gates, merge, dirty checks)
 * @property {string} [repoBase]       the branch the run is cut from and merges into
 * @property {string} [featureSlug]    the dev_use_cases slug a review run (or a rework delivery) is about
 * @property {'lite'|'full'} [councilMode]   a review run's council (REVIEW_CHARTERS)
 * @property {string[]} [councilSeeded]      council run dirs present in the worktree BEFORE the reviewer ran
 * @property {Object} [council]        what settle read: {mode, featureSlug, runDirName, copyPath, outcome, overall, coverage, round, mustAddress, summary}
 * @property {string} [branch]         autopilot/<charter>-<shortId>
 * @property {string} [worktree]
 * @property {string} [baseSha]        the base the branch sits on: the tip when the worktree was cut, moved by a rebase
 * @property {string} [originalBaseSha] the cut-time base, kept once settle has rebased the branch onto a moved base
 * @property {number} [pid]
 * @property {string} [sessionId]
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [endedAt]
 * @property {Object} [verdict]        what `settle` measured: commits, files, gates{}, boundaryHits[]
 * @property {string} [heldReason]
 * @property {string} [mergedSha]
 * @property {string} [nodeModules] @property {string} [limitSeenAt] @property {boolean} [killed] @property {Object} [cleanup]
 * @property {string} [askId] @property {string} [settledAt] @property {string} [verifyStartedAt]   written by WP2 (worker/merge)
 */

/**
 * @typedef {Object} OutboxEntry       one line of outbox.jsonl
 * @property {string} id               `${kind}:${sha1(canonical(payload))}` - the idempotency key
 * @property {string} kind             OUTBOX_KINDS
 * @property {string} slug
 * @property {string} projectId
 * @property {Object} payload          idea-verdict {ideaId,status,reason} | task-complete {ideaIds,sha,title,runId,branch,repo?}
 *                                     | ask {askId,question,context,options} | say {message} | plan {projectId,plan}
 *                                     | council {projectId,runDir,featureSlug,mode,outcome} | tier {projectId,featureSlug,tier}
 *                                     | report {projectId,title,content,attachments:[{path,caption}],approval:{title,description,severity}}
 * @property {Object} [created]        ids a multi-post replay already created (plan: {milestones:{i:id}, goals:{"i.j":id}}),
 *                                     so a later replay never posts them again
 * @property {{wakeId?:string,runId?:string}} source
 * @property {string} queuedAt
 * @property {string} state            OUTBOX_STATES
 * @property {number} attempts
 * @property {string} [evidence]       what the DB showed after replay
 */

/**
 * @typedef {Object} Ask               one line of asks.jsonl (latest line per askId wins)
 * @property {string} askId
 * @property {string} slug
 * @property {string} wakeId
 * @property {'master'|'merge-gate'} source
 * @property {string} kind             ASK_KINDS
 * @property {string} question
 * @property {string} context
 * @property {Array<{label:string,action:string}>} options
 * @property {'open'|'answered'} state
 * @property {string} raisedAt
 * @property {{choice:string,notes:string,at:string}} [answer]
 */

/**
 * @typedef {Object} QueueEntry        one line of _queue.jsonl (global; latest line per runId wins)
 * @property {string} runId
 * @property {string} slug
 * @property {string} charterSlug
 * @property {string} repo             the run's target repo key ('self' or a brief.repos key)
 * @property {string} model
 * @property {string} decidedAt        when the wake that minted the run was decided: the FIFO key
 * @property {string} enqueuedAt       the first refusal
 * @property {string} reason           QUEUE_REASONS: the latest refusal
 * @property {'queued'|'promoted'|'dropped'} state
 * @property {number} [position]       operator override (`queue move`), lower first; unpositioned entries follow, FIFO
 */

// ---------------------------------------------------------------- small helpers

export const nowIso = () => new Date().toISOString();
export const mintId = () => crypto.randomUUID();
export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
/** JSON with sorted keys, so equal payloads hash equal. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function memoryHeadroom() {
  const total = os.totalmem(), free = os.freemem();
  return { usedPct: Math.round(((total - free) / total) * 100), freeGb: +(free / 2 ** 30).toFixed(1) };
}

/** Thrown by a brake or a gate. The CLI prints {refused, ...extra} and exits EXIT.REFUSED. */
export class Refusal extends Error {
  constructor(reason, extra = {}) { super(reason); this.reason = reason; this.extra = extra; }
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
/**
 * Windows refuses a rename onto a file another process holds open without delete sharing (an
 * indexer, antivirus) with EPERM, EACCES or EBUSY, and the hold clears in milliseconds. On
 * 2026-10-08 an await died on exactly that rename and left its council run exited and unsettled,
 * so writeJson retries with a growing wait (50 ms, 100 ms, ... about 10 s over 20 attempts).
 */
export const RENAME_RETRY = { attempts: 20, waitMs: 50, codes: ['EPERM', 'EACCES', 'EBUSY'] };
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n');
  for (let i = 1; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) {
      if (!RENAME_RETRY.codes.includes(e.code) || i >= RENAME_RETRY.attempts) {
        try { fs.unlinkSync(tmp); } catch { /* the tmp may already be gone */ }
        throw e;
      }
      sleepSync(RENAME_RETRY.waitMs * i);
    }
  }
}
export function appendJsonl(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(v) + '\n');
}
export function readJsonl(p) {
  let text; try { text = fs.readFileSync(p, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
