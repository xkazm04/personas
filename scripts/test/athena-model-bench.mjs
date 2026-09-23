#!/usr/bin/env node
/**
 * Athena model/effort/prompt-family bench — Track B of
 * docs/plans/athena-live-conversation-layer.md, extended by the
 * hybrid-llm-engine spark (engine + prompt class per cell).
 *
 * Measures how far Athena's interactive turn can be moved — model, effort,
 * ENGINE (claude | grok) and PROMPT CLASS (full constitution | chat family) —
 * without damaging decision ability. Spawns the CLI headless with the REAL
 * composed system prompt per scenario (rendered by the production composer
 * through `athena-bench-validate --render-prompt`), captures stream-json
 * timing, and scores the raw turn text with the PRODUCTION dispatcher via
 * the same binary — so op/param validation and the prompt family can't
 * drift from what ships.
 *
 * Usage:
 *   node scripts/test/athena-model-bench.mjs --dry-run
 *       Validate the corpus + round-trip scenarios' canned `sample` texts
 *       through the validator binary. No LLM spawns.
 *   node scripts/test/athena-model-bench.mjs --cell o-low --reps 2
 *       Run one matrix cell (serial). Results append to
 *       .planning/athena-bench/results.jsonl; already-recorded
 *       (cell, scenario, rep) keys are skipped so a rate-limited run resumes.
 *   node scripts/test/athena-model-bench.mjs --cells o-low,o-low-chat,s-low-chat --reps 2 --parallel
 *       Several cells; with --parallel each cell runs as its own serial lane
 *       at the same time (the certification shape: ~230 turns in ~25 min).
 *   node scripts/test/athena-model-bench.mjs --report [--baseline o-low]
 *       Aggregate results.jsonl into .planning/athena-bench/report.md
 *       (per-cell × per-class accuracy + latency percentiles + gate verdicts
 *       vs the baseline cell, default o-low = today's MAIN tier on the full
 *       constitution).
 *
 * Options:
 *   --scenarios <id,id|class>   filter scenarios by id or class name
 *   --prompt-file <path>        use a REAL dumped prompt (PERSONAS_DUMP_PROMPT=1
 *                               snapshot from ~/.personas/debug/prompts/) as the
 *                               base system prompt instead of the composed one.
 *   --fixture-prompt            use the distilled fixtures/athena-bench/system-prompt.md
 *                               (the pre-2026-09-17 default) instead of the composed family.
 *   --timeout <s>               per-turn timeout (default 240)
 *   --fresh                     ignore existing results (re-run everything)
 *   --no-build                  fail if the validator binary is missing instead
 *                               of cargo-building it
 *
 * Env: CLAUDE_EXE (native claude.exe), PERSONAS_GROK_EXE (grok binary; default
 * C:/Users/kazda/.grok/bin/grok.exe on win32, `grok` on PATH elsewhere),
 * CARGO_TARGET_DIR (where the validator binary lives).
 *
 * The LLM judge (prose-quality secondary metric) is a deliberate follow-up;
 * this harness records everything the judge needs (message, turn text) in
 * results.jsonl so judging can run as a separate offline pass.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTurnTimer } from './lib/stream-timing.mjs';
import { replyShape as computeReplyShape } from './lib/reply-shape.mjs';
import { selfTest as replyShapeSelfTest } from './lib/reply-shape-self-test.mjs';

// A crashed run must say so in run.log, not die silently (bitten twice by
// async EPIPE from killed children).
process.on('uncaughtException', (e) => {
  console.error('FATAL uncaught exception:', e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('FATAL unhandled rejection:', e);
  process.exit(1);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'athena-bench');
const OUT_DIR = path.join(REPO, '.planning', 'athena-bench');
const RESULTS = path.join(OUT_DIR, 'results.jsonl');
const REPORT = path.join(OUT_DIR, 'report.md');

/** Model ids mirror `model_routing.rs` (MAIN = OPUS_CURRENT = claude-opus-5,
 *  ASIDE/MICRO = claude-sonnet-5) and `model_ids::GROK_CURRENT`. The o-* cells
 *  named `claude-opus-4-8` until 2026-09-17; they were renamed to match what
 *  Athena's MAIN tier actually spawns, so a baseline row is a baseline. */
const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5';
const GROK = 'grok-4.6';

/** Matrix cells. Every cell names its `engine` and `promptClass`:
 *  - engine `claude` = today's argv (`-p - --system-prompt-file`), `grok` =
 *    the Grok CLI lane per the hybrid-llm-engine builder law (`--agent
 *    <profile.md> --tools "" --max-turns 1`, profile = frontmatter + prompt).
 *  - promptClass `full` = the constitution + identity + dynamic blocks,
 *    `chat` = the chat family (chat core + generated op reference + the same
 *    dynamic blocks), both composed by the PRODUCTION composer.
 *  o-base carries no --effort: the CLI uses the model default (high), i.e. the
 *  pre-calibration production behaviour. `-r` cells append
 *  fixtures/athena-bench/reinforcements.md to the system prompt. */
const CELLS = {
  'o-base': { engine: 'claude', model: OPUS, effort: null, promptClass: 'full' },
  'o-med': { engine: 'claude', model: OPUS, effort: 'medium', promptClass: 'full' },
  'o-low': { engine: 'claude', model: OPUS, effort: 'low', promptClass: 'full' },
  'o-low-chat': { engine: 'claude', model: OPUS, effort: 'low', promptClass: 'chat' },
  's-high': { engine: 'claude', model: SONNET, effort: 'high', promptClass: 'full' },
  's-med': { engine: 'claude', model: SONNET, effort: 'medium', promptClass: 'full' },
  's-low': { engine: 'claude', model: SONNET, effort: 'low', promptClass: 'full' },
  's-low-chat': { engine: 'claude', model: SONNET, effort: 'low', promptClass: 'chat' },
  's-high-r': { engine: 'claude', model: SONNET, effort: 'high', promptClass: 'full', reinforced: true },
  's-med-r': { engine: 'claude', model: SONNET, effort: 'medium', promptClass: 'full', reinforced: true },
  's-low-r': { engine: 'claude', model: SONNET, effort: 'low', promptClass: 'full', reinforced: true },
  // Grok cells are metered (grok.com login reports real total_cost_usd) and
  // measured ~3x slower to first text on the full prompt; run them on a
  // scenario subset, never as part of the certification.
  'g-low-full': { engine: 'grok', model: GROK, effort: 'low', promptClass: 'full' },
  'g-low-chat': { engine: 'grok', model: GROK, effort: 'low', promptClass: 'chat' },
};

/** Promotion gates, evaluated per class vs the baseline cell. */
const GATES = {
  maxAccuracyDropPts: 2,
  /** ANY drop in these classes vs the baseline fails the cell. */
  hardFailClasses: ['restraint', 'gated_discipline'],
  /** Informational for prompt-class cells (the spark's speed lever is the
   *  warm session + the small prompt together; this bench measures the cold
   *  spawn). Still part of the headline for model/effort cells. */
  minLatencyWinPct: 30,
  /** Above this share of attempts lost to infra, a cell's comparison against
   *  the baseline is inconclusive rather than passing or failing: the excluded
   *  runs are not random (slow/overloaded cells time out more), so the
   *  survivors are the cell's easier attempts. */
  maxExclusionRatePct: 20,
};

// ── args ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const corpus = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scenarios.json'), 'utf8'));
const scenarioFilter = opt('--scenarios');
const scenarios = corpus.scenarios.filter(
  (s) =>
    !scenarioFilter ||
    scenarioFilter.split(',').some((f) => f === s.id || f === s.class),
);
const TIMEOUT_MS = Number(opt('--timeout', '240')) * 1000;
const BASELINE = opt('--baseline', 'o-low');

// ── validator binary ─────────────────────────────────────────────────────
function validatorPath() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const target = process.env.CARGO_TARGET_DIR || path.join(REPO, 'src-tauri', 'target');
  return path.join(target, 'debug', `athena-bench-validate${exe}`);
}

function ensureValidator() {
  const bin = validatorPath();
  if (fs.existsSync(bin) && !has('--rebuild')) return bin;
  if (has('--no-build')) {
    console.error(`validator binary missing: ${bin} (run: cargo build --manifest-path src-tauri/Cargo.toml --features desktop --bin athena-bench-validate)`);
    process.exit(1);
  }
  console.log('building athena-bench-validate…');
  // --features desktop: tauri-build's capability resolution fails on the
  // default (empty) feature set — same reason every repo cargo command
  // carries it.
  const r = spawnSync(
    'cargo',
    ['build', '--manifest-path', path.join(REPO, 'src-tauri', 'Cargo.toml'), '--features', 'desktop', '--bin', 'athena-bench-validate'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (r.status !== 0 || !fs.existsSync(bin)) {
    console.error('validator build failed');
    process.exit(1);
  }
  return bin;
}

function runValidator(bin, turnText, pinned) {
  const args = pinned?.length ? ['--pinned', pinned.join(',')] : [];
  const r = spawnSync(bin, args, { input: turnText, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`validator failed: ${r.stderr || r.status}`);
  return JSON.parse(r.stdout);
}

/** Compose the REAL system prompt of `promptClass` for a scenario's declared
 *  state, through the production composer. Cached per (class, pinned,
 *  activity, voice): a corpus has a handful of distinct states, not one per
 *  turn. */
const promptCache = new Map();
function renderPromptViaBin(bin, promptClass, sc) {
  const key = JSON.stringify([promptClass, sc.pinned ?? [], sc.seedActivity ?? '', !!sc.voice]);
  if (promptCache.has(key)) return promptCache.get(key);
  const args = ['--render-prompt', promptClass];
  if (sc.pinned?.length) args.push('--pinned', sc.pinned.join(','));
  if (sc.voice) args.push('--voice');
  const r = spawnSync(bin, args, { input: sc.seedActivity ?? '', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`render-prompt failed: ${r.stderr || r.status}`);
  const chars = Number((/prompt_chars=(\d+)/.exec(r.stderr ?? '') ?? [])[1] ?? r.stdout.length);
  const out = { text: r.stdout, chars };
  promptCache.set(key, out);
  return out;
}

// ── deterministic scoring ────────────────────────────────────────────────
function sideEffectCount(rep) {
  return (
    rep.approvals.length +
    rep.backgroundJobs.length +
    rep.navigations.length +
    rep.labOpens.length +
    rep.dashboards +
    rep.cockpits +
    rep.chatCards.length +
    rep.guideWalkthroughs.length +
    rep.pointAts.length +
    rep.composedWalkthroughs.length
  );
}

/** Voice contract (wave 2): the reply itself is spoken as it streams, so a
 *  spoken-friendly PROSE reply satisfies the voice scenario as well as a
 *  `TTS:` line does. "Spoken-friendly" is checked structurally: non-empty,
 *  no headings, bullets, tables or code fences in the cleaned text. */
function spokenFriendly(report) {
  const text = (report.cleanedText ?? '').trim();
  if (!text) return false;
  return !text.split('\n').some((l) => /^\s*(#{1,6}\s|[-*]\s|\|\s|```|\d+\.\s)/.test(l));
}

/** replyShape (WP4, spark athena-layered-voice): sentence cap, zero bare ids,
 *  well-formed ref links — scored on the dispatcher's cleaned display text via
 *  the SAME counters `scripts/companion/reply-stats.mjs` uses on the live
 *  brain, so a bench number and a production number always mean the same
 *  thing. SOFT by default (`expect.hardShape` unset or false): the check
 *  always reports its numbers per scenario like the existing checks, but only
 *  FAILS the scenario when the scenario declares `hardShape: true`. This is
 *  deliberate — layer_one is a new prompt contract (WP1) that most of the
 *  corpus's existing cells were never taught, so a hard gate here would fail
 *  every pre-layer-one cell on a rule it doesn't know exists yet.
 *
 *  `bareIds` is `computeReplyShape`'s PRIMARY count (Director amendment,
 *  2026-09-23: an id inside INLINE code counts; only a fenced code block or a
 *  ref-link handle is exempt — `scripts/test/lib/reply-shape.mjs`'s
 *  `countBareIds` doc comment has the full reasoning). `bareIdsStrict`
 *  (all code spans exempt, the pre-amendment reading) rides along in the
 *  detail line, clearly labeled, for comparison only — it is never what
 *  `bareIdsOk`/`structurallyOk`/`hardShape` score against. */
function replyShapeCheck(report, expect) {
  const cap = expect.replyShape?.cap ?? 3;
  const text = (report.cleanedText ?? '').trim();
  const shape = computeReplyShape(text);
  const sentencesOk = shape.sentences <= cap;
  const bareIdsOk = shape.bareIds === 0;
  const refsOk = shape.refsMalformed === 0;
  const structurallyOk = sentencesOk && bareIdsOk && refsOk;
  const detail =
    `sentences=${shape.sentences}/${cap}${sentencesOk ? '' : ' OVER'} ` +
    `bareIds=${shape.bareIds}${bareIdsOk ? '' : ' LEAK'} (strict/code-exempt, comparison only: ${shape.bareIdsStrict}) ` +
    `refLinks=${shape.refLinkCount} (${shape.refsWellFormed} ok, ${shape.refsMalformed} malformed) ` +
    `words=${shape.words} chars=${shape.chars}` +
    (structurallyOk || expect.hardShape ? '' : ' [soft-fail — not scored against pass/fail]');
  return { pass: expect.hardShape ? structurallyOk : true, detail };
}

function score(report, expect) {
  const checks = [];
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail });

  // anyOf: pass if ANY branch's sub-expectation fully passes. The branch
  // checks are reported under a single aggregate check.
  if (expect.anyOf) {
    const branches = expect.anyOf.map((sub) => score(report, sub));
    const winner = branches.find((b) => b.pass);
    add(
      `anyOf(${expect.anyOf.length} branches)`,
      !!winner,
      winner ? branches.indexOf(winner) + ' matched' : branches.map((b, i) => `${i}: ${b.checks.filter((c) => !c.pass).map((c) => c.name).join(',')}`).join(' | '),
    );
  }

  for (const j of expect.jobs ?? []) {
    const hit = report.backgroundJobs.find(
      (b) =>
        b.kind === j.kind &&
        (!j.connector || b.params?.connector_name === j.connector) &&
        (!j.capability || b.params?.capability === j.capability),
    );
    add(`job:${j.kind}:${j.connector ?? '*'}.${j.capability ?? '*'}`, !!hit);
  }
  for (const a of expect.approvals ?? []) {
    add(`approval:${a}`, report.approvals.some((x) => x.action === a));
  }
  for (const r of expect.navigations ?? []) {
    add(`nav:${r}`, report.navigations.includes(r));
  }
  if (expect.noSideEffects) add('noSideEffects', sideEffectCount(report) === 0, `count=${sideEffectCount(report)}`);
  if (expect.noNewJobs) add('noNewJobs', report.backgroundJobs.length === 0, `jobs=${report.backgroundJobs.length}`);
  if (expect.noRejectedOps) add('noRejectedOps', report.warnings.length === 0, report.warnings.join(' | '));
  if (expect.requireTts) add('requireTts', typeof report.ttsText === 'string' && report.ttsText.length > 0);
  if (expect.spokenFriendly) add('spokenFriendly', spokenFriendly(report));
  if (expect.ttsNotDuplicate) {
    const tts = (report.ttsText ?? '').trim();
    add('ttsNotDuplicate', !tts || tts !== (report.cleanedText ?? '').trim(), 'TTS line repeats the prose verbatim');
  }
  if (expect.noLeak) add('noLeak', report.machineGrammarLeak === false);
  // The dispatcher's chat_cards array is how a `show_report` op is visible in
  // the validator report (a companion_chat_card row, kind "report"); there is
  // no dedicated `reportEmitted` field on this bench's report shape yet (that
  // lives in WP2's companion_turn.outcome_json, a production-only surface),
  // so this checks the same evidence the production reader would.
  if (expect.reportCard)
    add('reportCard', (report.chatCards ?? []).some((c) => c.kind === 'report'), `chatCards=${JSON.stringify(report.chatCards ?? [])}`);
  if (expect.replyShape) {
    const shape = replyShapeCheck(report, expect);
    add('replyShape', shape.pass, shape.detail);
  }
  if (expect.noParseErrors)
    add('noParseErrors', !report.warnings.some((w) => /parse error|malformed/i.test(w)), report.warnings.join(' | '));

  return { pass: checks.every((c) => c.pass), checks };
}

// ── prompt assembly ──────────────────────────────────────────────────────
function baseSystemPrompt() {
  const file = opt('--prompt-file');
  if (file) {
    const raw = fs.readFileSync(file, 'utf8');
    // Real dumps carry the user message after the divider — system part only.
    return { kind: 'real-dump', text: raw.split('---USER-MESSAGE---')[0] };
  }
  if (has('--fixture-prompt')) {
    return { kind: 'fixture', text: fs.readFileSync(path.join(FIXTURES, 'system-prompt.md'), 'utf8') };
  }
  return { kind: 'composed' };
}

const VOICE_SECTION = `
# Voice is ON for this turn

The user will hear your reply. Emit exactly one \`TTS:\` line — one or two
short spoken-friendly sentences carrying the substance of your answer.`;

function reinforcementsText() {
  return fs.readFileSync(path.join(FIXTURES, 'reinforcements.md'), 'utf8');
}

/** The system prompt for one (cell, scenario): the composed family by
 *  default, or the legacy fixture / real dump when asked. Returns the text
 *  and its size in chars (the composed size the turn ledger would record). */
function scenarioPrompt(bin, base, sc, cell) {
  const pinned = sc.pinned?.length ? sc.pinned.join(', ') : '(none pinned)';
  const activity = sc.seedActivity ?? '(nothing in flight right now)';
  const voice = sc.voice ? VOICE_SECTION : '';
  const tail = CELLS[cell]?.reinforced ? `\n\n${reinforcementsText()}` : '';
  if (base.kind === 'composed') {
    const rendered = renderPromptViaBin(bin, CELLS[cell].promptClass, sc);
    return { text: rendered.text + tail, chars: rendered.chars + tail.length };
  }
  if (base.kind === 'fixture') {
    const text =
      base.text
        .replaceAll('{{PINNED_CONNECTORS}}', pinned)
        .replaceAll('{{LIVE_ACTIVITY}}', activity)
        .replaceAll('{{VOICE_SECTION}}', voice) + tail;
    return { text, chars: text.length };
  }
  // Real dump: append a bench appendix. The dump's own context may disagree
  // with the scenario's pinned list — the appendix states the authoritative
  // bench state last (recency wins), and we warn for the risky cases.
  if (sc.expect?.noNewJobs || (sc.pinned?.length ?? 0) === 0) {
    console.warn(`  [prompt] ${sc.id}: real-dump mode may disagree with scenario pinned=[${sc.pinned ?? ''}]`);
  }
  const text = `${base.text}\n\n# BENCH APPENDIX — authoritative state for this turn\n\nConnectors pinned & enabled right now: ${pinned}\n\nLive activity right now:\n${activity}\n${voice}\n${tail}`;
  return { text, chars: text.length };
}

// ── CLI spawn ────────────────────────────────────────────────────────────
function tmpFile(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

/** Strip the Claude-nesting env every Athena spawn strips (a child CLI that
 *  believes it is nested inside Claude Code disables persistence), and never
 *  hand a metered API key to a subscription spawn. */
function spawnEnv() {
  const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') && !k.startsWith('CLAUDE_CODE_DISABLE_')) delete env[k];
  return env;
}

/** The native claude binary: CLAUDE_EXE, else the standard install location
 *  (~/.local/bin/claude.exe on Windows, where the npm shim is NOT on cmd.exe's
 *  PATH and spawning 'claude.cmd' fails in 36 ms with 'not recognized').
 *  Null falls back to the shell shim. */
function resolveClaudeExe() {
  if (process.env.CLAUDE_EXE) return process.env.CLAUDE_EXE;
  const candidates = process.platform === 'win32'
    ? [path.join(os.homedir(), '.local', 'bin', 'claude.exe')]
    : [path.join(os.homedir(), '.local', 'bin', 'claude')];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Claude arm: mirrors companion/session/cli.rs — prompt in a file, user
 *  message on stdin. */
function claudeLaunch(cell, systemPrompt, userMessage) {
  const promptFile = tmpFile('athena-bench-prompt', 'md');
  fs.writeFileSync(promptFile, systemPrompt);
  const args = [
    '-p', '-',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--exclude-dynamic-system-prompt-sections',
    '--model', CELLS[cell].model,
    '--system-prompt-file', promptFile,
  ];
  if (CELLS[cell].effort) args.push('--effort', CELLS[cell].effort);
  // Isolation mode: CLAUDE_EXE points at the native claude.exe (the npm
  // claude.cmd shim just execs it) — spawned directly with no cmd shell, so
  // the turn subprocess is claude.exe, not a cmd/node wrapper.
  const claudeExe = resolveClaudeExe();
  const program = claudeExe ?? (process.platform === 'win32' ? 'claude.cmd' : 'claude');
  return {
    program,
    args,
    shell: !claudeExe && process.platform === 'win32',
    stdin: userMessage,
    cleanup: () => fs.rmSync(promptFile, { force: true }),
  };
}

/** Grok arm, exactly per the hybrid-llm-engine builder law: the user message
 *  on argv (`-p`), the system prompt as the body of an agent PROFILE file
 *  (YAML frontmatter + blank line + prompt; `--system-prompt-override` is
 *  argv-only and 150 KB dies with ENAMETOOLONG on Windows and defeats
 *  caching), no tools, one turn, the Claude stream-json envelope out. */
function grokLaunch(cell, systemPrompt, userMessage) {
  const profileFile = tmpFile('athena-bench-profile', 'md');
  const profile = `---\nname: athena-bench\ndescription: Athena bench profile (${cell})\n---\n\n${systemPrompt}`;
  fs.writeFileSync(profileFile, profile);
  const args = [
    '-p', userMessage,
    '--agent', profileFile,
    '--tools', '',
    '--max-turns', '1',
    '-m', CELLS[cell].model,
    '--effort', CELLS[cell].effort ?? 'low',
    '--output-format', 'streaming-messages-json',
    '--include-partial-messages',
  ];
  // `||` on the trimmed value: PERSONAS_GROK_EXE set to '' means unset.
  const program =
    process.env.PERSONAS_GROK_EXE?.trim() || (process.platform === 'win32' ? 'C:/Users/kazda/.grok/bin/grok.exe' : 'grok');
  return {
    program,
    args,
    shell: false,
    stdin: null,
    cleanup: () => fs.rmSync(profileFile, { force: true }),
  };
}

function spawnTurn(cell, systemPrompt, userMessage) {
  return new Promise((resolve) => {
    const launch = CELLS[cell].engine === 'grok' ? grokLaunch(cell, systemPrompt, userMessage) : claudeLaunch(cell, systemPrompt, userMessage);
    const t0 = Date.now();
    // Timing lives in scripts/test/lib/stream-timing.mjs so every published
    // figure names the event its stamp was taken at: the first VISIBLE text
    // delta, the first forwarded chunk of any kind (on a thinking turn that
    // is an empty thinking_delta envelope, not a token), and the first
    // complete assistant message. Three intervals, never pooled into one.
    // Grok's `streaming-messages-json` IS the Claude stream-json envelope, so
    // the same timer reads both engines unchanged.
    const timing = createTurnTimer();
    let timedOut = false;
    const segments = [];
    let usage = null;
    let costUsd = null;
    let isError = false;
    let stderr = '';
    let buf = '';

    const child = spawn(launch.program, launch.args, {
      cwd: os.homedir(),
      env: spawnEnv(),
      shell: launch.shell,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // shell:true on Windows makes `child` the cmd shim — kill the whole
      // tree or the real CLI process keeps running as an orphan.
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
    }, TIMEOUT_MS);

    // A killed child's stdin raises async EPIPE — without a handler it
    // crashes the whole run during the NEXT turn (seen live twice).
    child.stdin.on('error', () => {});
    child.on('error', () => {
      isError = true;
    });
    try {
      if (launch.stdin != null) child.stdin.write(launch.stdin);
      child.stdin.end();
    } catch {
      isError = true;
    }
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        timing.observe(ev);
        if (ev.type === 'assistant') {
          const text = (ev.message?.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
          if (text) segments.push(text);
        }
        if (ev.type === 'result') {
          usage = ev.usage ?? ev.result?.usage ?? null;
          costUsd = typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null;
          isError = !!ev.is_error;
          // The CLI reports a rate limit / auth failure as an error RESULT with
          // zero usage, not on stderr; keep its text so the ledger says why.
          if (isError && typeof ev.result === 'string') stderr = `result: ${ev.result.slice(0, 500)}\n` + stderr;
          // Grok's result carries the final text; an assistant event may not
          // precede it on a no-thinking turn.
          if (!segments.length && typeof ev.result === 'string' && ev.result) segments.push(ev.result);
        }
      }
    });
    child.on('close', () => {
      clearTimeout(timer);
      launch.cleanup();
      const read = timing.read();
      resolve({
        turnText: segments.join('\n'),
        // What each figure is measured to, by name. A turn that streamed no
        // text delta reports firstVisibleTextMs: null and says why, rather
        // than borrowing a whole-message stamp and calling it a token.
        firstVisibleTextMs: read.firstVisibleTextMs,
        firstChunkMs: read.firstChunkMs,
        firstChunkKind: read.firstChunkKind,
        firstMessageMs: read.firstMessageMs,
        timingUnmeasured: read.unmeasured,
        totalMs: Date.now() - t0,
        usage,
        costUsd,
        timedOut,
        isError,
        stderr: isError || timedOut ? stderr.slice(0, 2000) : undefined,
      });
    });
  });
}

// ── result store ─────────────────────────────────────────────────────────
function loadDone() {
  const done = new Set();
  if (has('--fresh') || !fs.existsSync(RESULTS)) return done;
  for (const line of fs.readFileSync(RESULTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r.infra) done.add(`${r.cell}|${r.scenarioId}|${r.rep}`);
    } catch { /* skip corrupt line */ }
  }
  return done;
}

function appendResult(row) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
}

// ── modes ────────────────────────────────────────────────────────────────
async function dryRun() {
  console.log(`corpus: ${scenarios.length} scenarios across ${new Set(scenarios.map((s) => s.class)).size} classes`);
  let bad = 0;
  for (const sc of scenarios) {
    const problems = [];
    if (!sc.id || !sc.class || !sc.message || !sc.expect) problems.push('missing required field');
    if (problems.length) {
      bad++;
      console.error(`  ✗ ${sc.id ?? '<no id>'}: ${problems.join(', ')}`);
    }
  }
  const bin = ensureValidator();
  let roundTrips = 0;
  for (const sc of scenarios.filter((s) => s.sample)) {
    const report = runValidator(bin, sc.sample, sc.pinned ?? []);
    const { pass, checks } = score(report, sc.expect);
    roundTrips++;
    if (!pass) {
      bad++;
      console.error(`  ✗ sample round-trip failed: ${sc.id}`);
      for (const c of checks.filter((x) => !x.pass)) console.error(`      ${c.name} ${c.detail}`);
    } else {
      console.log(`  ✓ ${sc.id} (sample round-trip)`);
    }
  }
  // Both families must compose for every distinct scenario state.
  for (const promptClass of ['full', 'chat']) {
    const sizes = new Set();
    for (const sc of scenarios) sizes.add(renderPromptViaBin(bin, promptClass, sc).chars);
    console.log(`  ✓ ${promptClass} family composes (${[...sizes].sort((a, b) => a - b).join(', ')} chars across states)`);
  }
  console.log(`dry-run: ${scenarios.length} scenarios OK-schema, ${roundTrips} sample round-trips, ${bad} problems`);
  process.exit(bad ? 1 : 0);
}

async function runOneCell(bin, base, cell, reps, done) {
  for (const sc of scenarios) {
    for (let rep = 1; rep <= reps; rep++) {
      const key = `${cell}|${sc.id}|${rep}`;
      if (done.has(key)) continue;
      const prompt = scenarioPrompt(bin, base, sc, cell);
      const turn = await spawnTurn(cell, prompt.text, sc.message);
      let row = {
        ts: new Date().toISOString(),
        cell,
        engine: CELLS[cell].engine,
        model: CELLS[cell].model,
        effort: CELLS[cell].effort,
        promptClass: base.kind === 'composed' ? CELLS[cell].promptClass : base.kind,
        promptChars: prompt.chars,
        scenarioId: sc.id,
        class: sc.class,
        rep,
        message: sc.message,
        firstVisibleTextMs: turn.firstVisibleTextMs,
        firstChunkMs: turn.firstChunkMs,
        firstChunkKind: turn.firstChunkKind,
        firstMessageMs: turn.firstMessageMs,
        timingUnmeasured: turn.timingUnmeasured,
        totalMs: turn.totalMs,
        usage: turn.usage,
        costUsd: turn.costUsd,
        timedOut: turn.timedOut,
        cliError: turn.isError,
        stderr: turn.stderr,
      };
      let verdict;
      if (turn.timedOut && sc.class === 'delegate_vs_inline') {
        // A timeout on a delegate scenario is a DECISION failure, not
        // infra: the model held the turn open doing the work inline
        // instead of delegating and replying in seconds. Score it.
        row = { ...row, pass: false, checks: [{ name: 'delegated-promptly', pass: false, detail: `turn still running at ${TIMEOUT_MS / 1000}s — inlined instead of delegating` }] };
        verdict = 'FAIL (timeout = inlined, not delegated)';
      } else if (turn.timedOut || turn.isError || !turn.turnText) {
        // Infra failure (rate limit, CLI error, timeout) — recorded for
        // visibility but excluded from accuracy and NOT added to the done
        // set, so a later invocation retries it.
        row = { ...row, pass: false, infra: true, checks: [{ name: 'turn-completed', pass: false, detail: turn.timedOut ? 'timeout' : 'cli error/empty' }] };
        verdict = turn.timedOut ? 'TIMEOUT' : 'CLI ERROR';
      } else {
        const report = runValidator(bin, turn.turnText, sc.pinned ?? []);
        const { pass, checks } = score(report, sc.expect);
        row = { ...row, pass, checks, turnText: turn.turnText, validator: report };
        verdict = `${pass ? 'PASS' : 'FAIL'} (${((turn.totalMs ?? 0) / 1000).toFixed(1)}s)`;
      }
      appendResult(row);
      console.log(`[${cell}] ${sc.id} #${rep} … ${verdict}`);
    }
  }
}

async function runCells(cellIds) {
  const bin = ensureValidator();
  const base = baseSystemPrompt();
  const reps = Number(opt('--reps', '3'));
  const done = loadDone();
  const parallel = has('--parallel');
  console.log(`running cells [${cellIds.join(', ')}] × ${scenarios.length} scenarios × ${reps} reps (prompt: ${base.kind}${parallel ? ', cells in parallel' : ''})`);
  if (parallel) {
    await Promise.all(cellIds.map((cell) => runOneCell(bin, base, cell, reps, done)));
  } else {
    for (const cell of cellIds) await runOneCell(bin, base, cell, reps, done);
  }
  console.log(`done — results in ${RESULTS}; aggregate with --report`);
}

// ── report ───────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '—');
const pctl = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmtS = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

function report() {
  if (!fs.existsSync(RESULTS)) {
    console.error('no results yet');
    process.exit(1);
  }
  const allRows = fs
    .readFileSync(RESULTS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  // Infra failures (rate limit / CLI error / timeout) are visibility-only:
  // they never count against accuracy. Dedupe scored rows by key (a retried
  // key keeps its last scored row).
  const byKey = new Map();
  for (const r of allRows.filter((r) => !r.infra)) byKey.set(`${r.cell}|${r.scenarioId}|${r.rep}`, r);
  const rows = [...byKey.values()];
  // An infra row whose key was later retried and scored is not a lost attempt:
  // the resume semantics exist so a rate-limited window is re-run, not
  // written off. Only keys that NEVER produced a scored row are excluded,
  // which is what the sampling-bias gate below is about. Retried keys are
  // counted separately so the report still says how noisy the run was.
  const infraAll = allRows.filter((r) => r.infra);
  const infra = infraAll.filter((r) => !byKey.has(`${r.cell}|${r.scenarioId}|${r.rep}`));
  const retried = infraAll.length - infra.length;
  const classes = [...new Set(rows.map((r) => r.class))].sort();
  const cells = Object.keys(CELLS).filter((c) => rows.some((r) => r.cell === c));

  const agg = {};
  for (const c of cells) {
    const mine = rows.filter((r) => r.cell === c);
    // Infra exclusions are attributed to the cell that produced them. A
    // run-wide count cannot show that the drops clustered in ONE cell, and a
    // cell scored on its survivors is compared against a baseline scored on
    // everything — a confound, not a measurement error: both arms are clean
    // and the contrast is not.
    const attempted = mine.length + infra.filter((r) => r.cell === c).length;
    const costs = mine.map((r) => r.costUsd).filter((x) => typeof x === 'number');
    agg[c] = {
      n: mine.length,
      excluded: infra.filter((r) => r.cell === c).length,
      exclRate: attempted ? (100 * infra.filter((r) => r.cell === c).length) / attempted : 0,
      passRate: pct(mine.filter((r) => r.pass).length, mine.length),
      // Two series, never merged: the first visible text delta (what a reader
      // means by responsiveness) and the first forwarded chunk of any kind,
      // whose end event is printed per cell because a thinking cell's first
      // chunk is an empty envelope and a non-thinking cell's is the text.
      p50VisibleText: pctl(mine.map((r) => r.firstVisibleTextMs).filter((x) => x != null), 50),
      p90VisibleText: pctl(mine.map((r) => r.firstVisibleTextMs).filter((x) => x != null), 90),
      visibleTextN: mine.filter((r) => r.firstVisibleTextMs != null).length,
      p50FirstChunk: pctl(mine.map((r) => r.firstChunkMs).filter((x) => x != null), 50),
      chunkKinds: [...new Set(mine.map((r) => r.firstChunkKind).filter(Boolean))].sort(),
      p50Total: pctl(mine.map((r) => r.totalMs).filter((x) => x != null), 50),
      p90Total: pctl(mine.map((r) => r.totalMs).filter((x) => x != null), 90),
      p50PromptChars: pctl(mine.map((r) => r.promptChars).filter((x) => x != null), 50),
      p50Cost: costs.length ? pctl(costs, 50) : null,
      promptClasses: [...new Set(mine.map((r) => r.promptClass).filter(Boolean))].sort(),
      byClass: Object.fromEntries(
        classes.map((k) => {
          const cc = mine.filter((r) => r.class === k);
          return [k, { n: cc.length, pass: cc.filter((r) => r.pass).length }];
        }),
      ),
    };
  }

  let md = `# Athena model/effort/prompt-family bench — results\n\nGenerated ${new Date().toISOString()} · ${rows.length} scored runs (${infra.length} keys lost to infra and excluded from accuracy; ${retried} infra rows were retried to a scored row) · corpus v${corpus.version} · baseline cell \`${BASELINE}\`\n\n## Per-cell summary\n\n| cell | engine | model | effort | prompt class | p50 prompt chars | runs | infra excluded | pass % | p50 / p90 to first visible text (n) | p50 to first forwarded chunk (end event) | p50 total | p90 total | p50 cost/turn |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of cells) {
    const ex = agg[c].excluded ? `${agg[c].excluded} (${agg[c].exclRate.toFixed(0)}% of attempts)` : '0';
    const cost = agg[c].p50Cost == null ? (CELLS[c].engine === 'claude' ? 'seat' : '—') : `$${agg[c].p50Cost.toFixed(3)} (metered)`;
    md += `| ${c} | ${CELLS[c].engine} | ${CELLS[c].model} | ${CELLS[c].effort ?? 'default(high)'}${CELLS[c].reinforced ? ' **+R**' : ''} | ${agg[c].promptClasses.join('/') || CELLS[c].promptClass} | ${agg[c].p50PromptChars ?? '—'} | ${agg[c].n} | ${ex} | ${agg[c].passRate} | ${fmtS(agg[c].p50VisibleText)} / ${fmtS(agg[c].p90VisibleText)} (${agg[c].visibleTextN}/${agg[c].n}) | ${fmtS(agg[c].p50FirstChunk)} (${agg[c].chunkKinds.join(', ') || 'none'}) | ${fmtS(agg[c].p50Total)} | ${fmtS(agg[c].p90Total)} | ${cost} |\n`;
  }
  md += `\n## Accuracy by class (pass/runs)\n\n| cell | prompt class | ${classes.join(' | ')} |\n|---|---|${classes.map(() => '---').join('|')}|\n`;
  for (const c of cells) {
    md += `| ${c} | ${CELLS[c].promptClass} | ${classes.map((k) => `${agg[c].byClass[k].pass}/${agg[c].byClass[k].n}`).join(' | ')} |\n`;
  }

  md += `\n## Gate verdicts vs ${BASELINE}\n\nGates: accuracy drop ≤ ${GATES.maxAccuracyDropPts}pts per class; ANY drop in ${GATES.hardFailClasses.join(', ')} is a hard fail. Latency (p50 total win ≥ ${GATES.minLatencyWinPct}%) is reported beside the verdict: it decides the headline for a model/effort cell and is informational for a prompt-class cell, whose speed lever is the warm session this cold-spawn bench cannot see.\n\n`;
  if (!agg[BASELINE]) {
    md += `_${BASELINE} has no runs yet — verdicts need the baseline first._\n`;
  } else {
    for (const c of cells.filter((x) => x !== BASELINE)) {
      const verdictLines = [];
      let promoted = true;
      for (const k of classes) {
        const b = agg[BASELINE].byClass[k];
        const m = agg[c].byClass[k];
        if (!b.n || !m.n) { verdictLines.push(`- ${k}: insufficient runs`); promoted = false; continue; }
        const bAcc = (100 * b.pass) / b.n;
        const mAcc = (100 * m.pass) / m.n;
        const drop = bAcc - mAcc;
        const hardFail = GATES.hardFailClasses.includes(k) && drop > 0;
        const ok = !hardFail && drop <= GATES.maxAccuracyDropPts;
        if (!ok) promoted = false;
        verdictLines.push(`- ${k}: ${mAcc.toFixed(0)}% vs ${bAcc.toFixed(0)}% (${drop > 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)}pts)${hardFail ? ' **HARD FAIL**' : ''}${ok ? '' : ' ✗'}`);
      }
      const latWin = agg[BASELINE].p50Total && agg[c].p50Total ? (100 * (agg[BASELINE].p50Total - agg[c].p50Total)) / agg[BASELINE].p50Total : null;
      const latOk = latWin != null && latWin >= GATES.minLatencyWinPct;
      const promptClassCell = CELLS[c].promptClass !== CELLS[BASELINE].promptClass;
      // A cell that lost too many attempts to infra is not "at parity" — the
      // comparison did not happen. Say so in different words than a passing
      // gate, because a caveat printed under a green verdict is read as the
      // verdict. Re-run the cell; do not promote it and do not fail it.
      const exclOk = agg[c].exclRate <= GATES.maxExclusionRatePct && agg[BASELINE].exclRate <= GATES.maxExclusionRatePct;
      const headline = !exclOk
        ? `⚠️ INCONCLUSIVE — control failed, re-run (${agg[c].excluded} of ${agg[c].n + agg[c].excluded} attempts excluded, gate ${GATES.maxExclusionRatePct}%)`
        : promoted && (latOk || promptClassCell)
          ? `✅ CERTIFIED (all classes${promptClassCell ? '; prompt-class cell, latency informational' : ' + latency'})`
          : promoted
            ? '🟡 quality parity, latency win < gate'
            : '❌ not certified';
      const exclNote = exclOk
        ? ''
        : `\n- **the surviving runs are not a random sample**: the excluded attempts are the ones that timed out or errored, so this cell's accuracy is computed over its easier runs and compared against a baseline scored over all of its own. The numbers below are printed for the re-run, not as a verdict.`;
      md += `### ${c} — ${headline}\n\n${verdictLines.join('\n')}\n- latency: p50 total ${fmtS(agg[c].p50Total)} vs ${fmtS(agg[BASELINE].p50Total)} (${latWin == null ? '—' : `${latWin.toFixed(0)}% win`}); p50 first visible text ${fmtS(agg[c].p50VisibleText)} vs ${fmtS(agg[BASELINE].p50VisibleText)}\n- prompt size: p50 ${agg[c].p50PromptChars ?? '—'} chars vs ${agg[BASELINE].p50PromptChars ?? '—'}${exclNote}\n\n`;
    }
  }
  md += `\n_LLM-judge prose scoring: not run (deliberate follow-up; results.jsonl carries turnText for an offline judge pass)._\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT, md);
  console.log(md);
  console.log(`written to ${REPORT}`);
}

// ── help / self-test (no model, no validator binary) ───────────────────────
function printHelp() {
  const classes = [...new Set(corpus.scenarios.map((s) => s.class))].sort();
  console.log(`Athena model/effort/prompt-family bench — ${corpus.scenarios.length} scenarios across ${classes.length} classes:\n  ${classes.join(', ')}\n`);
  console.log('Cells: ' + Object.keys(CELLS).join(', '));
  console.log(`
Usage:
  --help                       this message (no model, no validator)
  --self-test                  unit-check the replyShape counter on fixture strings (no model, no validator)
  --dry-run                    validate corpus + round-trip sample texts (builds the validator, no model)
  --cell <id> [--reps N]       run one matrix cell
  --cells <id,id,...|all>      run several cells (add --parallel to run them concurrently)
  --report [--baseline <id>]   aggregate results.jsonl into report.md
See the file header for the full option list (--scenarios, --prompt-file, --fixture-prompt, --timeout, ...).`);
}

// ── main ─────────────────────────────────────────────────────────────────
if (has('--help')) {
  printHelp();
} else if (has('--self-test')) {
  process.exit(replyShapeSelfTest() ? 0 : 1);
} else if (has('--dry-run')) {
  await dryRun();
} else if (has('--report')) {
  report();
} else {
  const cellArg = opt('--cell') ?? (opt('--cells') === 'all' ? Object.keys(CELLS).join(',') : opt('--cells'));
  if (!cellArg) {
    console.error('nothing to do: pass --dry-run, --report, --cell <id>, or --cells all');
    process.exit(1);
  }
  const cellIds = cellArg.split(',').map((s) => s.trim());
  for (const c of cellIds) {
    if (!CELLS[c]) {
      console.error(`unknown cell ${c}; known: ${Object.keys(CELLS).join(', ')}`);
      process.exit(1);
    }
  }
  await runCells(cellIds);
}
