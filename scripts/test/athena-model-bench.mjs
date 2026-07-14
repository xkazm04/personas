#!/usr/bin/env node
/**
 * Athena model/effort bench — Track B of docs/plans/athena-live-conversation-layer.md.
 *
 * Measures how far Athena's turn model/effort can be dropped without damaging
 * decision ability. Spawns the Claude CLI headless with (a snapshot of) her
 * real system prompt per scenario, captures stream-json timing, and scores
 * the raw turn text with the PRODUCTION dispatcher via the
 * `athena-bench-validate` Rust binary — so op/param validation can't drift.
 *
 * Usage:
 *   node scripts/test/athena-model-bench.mjs --dry-run
 *       Validate the corpus + round-trip scenarios' canned `sample` texts
 *       through the validator binary. No LLM spawns.
 *   node scripts/test/athena-model-bench.mjs --cell o-base --reps 3
 *       Run one matrix cell (serial). Results append to
 *       .planning/athena-bench/results.jsonl; already-recorded
 *       (cell, scenario, rep) keys are skipped so a rate-limited run resumes.
 *   node scripts/test/athena-model-bench.mjs --cells all --reps 3
 *       The full matrix, one cell at a time.
 *   node scripts/test/athena-model-bench.mjs --report
 *       Aggregate results.jsonl into .planning/athena-bench/report.md
 *       (per-cell × per-class accuracy + latency percentiles + gate verdicts
 *       vs the o-base baseline).
 *
 * Options:
 *   --scenarios <id,id|class>   filter scenarios by id or class name
 *   --prompt-file <path>        use a REAL dumped prompt (PERSONAS_DUMP_PROMPT=1
 *                               snapshot from ~/.personas/debug/prompts/) as the
 *                               base system prompt instead of the distilled
 *                               fixture. Scenario seed/pinned sections are
 *                               appended as a BENCH APPENDIX; note that a real
 *                               dump's own pinned-connector claims may disagree
 *                               with a scenario's `pinned` list — the harness
 *                               warns per mismatch-prone scenario.
 *   --timeout <s>               per-turn timeout (default 240)
 *   --fresh                     ignore existing results (re-run everything)
 *   --no-build                  fail if the validator binary is missing instead
 *                               of cargo-building it
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

/** Matrix cells. o-base carries no --effort: the CLI uses the model default
 *  (high for both opus-4.8 and sonnet-5) — i.e. today's production behavior.
 *  `-r` cells append fixtures/athena-bench/reinforcements.md to the system
 *  prompt — the lessons-learned doctrine round targeting the v1 Sonnet gaps
 *  (delegation, act-don't-promise, one-line JSON, multi-op completeness). */
const CELLS = {
  'o-base': { model: 'claude-opus-4-8', effort: null },
  'o-med': { model: 'claude-opus-4-8', effort: 'medium' },
  'o-low': { model: 'claude-opus-4-8', effort: 'low' },
  's-high': { model: 'claude-sonnet-5', effort: 'high' },
  's-med': { model: 'claude-sonnet-5', effort: 'medium' },
  's-low': { model: 'claude-sonnet-5', effort: 'low' },
  's-high-r': { model: 'claude-sonnet-5', effort: 'high', reinforced: true },
  's-med-r': { model: 'claude-sonnet-5', effort: 'medium', reinforced: true },
  's-low-r': { model: 'claude-sonnet-5', effort: 'low', reinforced: true },
};

/** Promotion gates (§B3 of the plan), evaluated per class vs o-base. */
const GATES = {
  maxAccuracyDropPts: 2,
  hardFailClasses: ['restraint', 'gated_discipline'],
  minLatencyWinPct: 30,
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

// ── validator binary ─────────────────────────────────────────────────────
function validatorPath() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  return path.join(REPO, 'src-tauri', 'target', 'debug', `athena-bench-validate${exe}`);
}

function ensureValidator() {
  const bin = validatorPath();
  if (fs.existsSync(bin)) return bin;
  if (has('--no-build')) {
    console.error(`validator binary missing: ${bin} (run: cargo build --manifest-path src-tauri/Cargo.toml --bin athena-bench-validate)`);
    process.exit(1);
  }
  console.log('building athena-bench-validate (first run)…');
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
  if (expect.noLeak) add('noLeak', report.machineGrammarLeak === false);
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
    return { text: raw.split('---USER-MESSAGE---')[0], real: true };
  }
  return { text: fs.readFileSync(path.join(FIXTURES, 'system-prompt.md'), 'utf8'), real: false };
}

const VOICE_SECTION = `
# Voice is ON for this turn

The user will hear your reply. Emit exactly one \`TTS:\` line — one or two
short spoken-friendly sentences carrying the substance of your answer.`;

function reinforcementsText() {
  return fs.readFileSync(path.join(FIXTURES, 'reinforcements.md'), 'utf8');
}

function scenarioPrompt(base, sc, cell) {
  const pinned = sc.pinned?.length ? sc.pinned.join(', ') : '(none pinned)';
  const activity = sc.seedActivity ?? '(nothing in flight right now)';
  const voice = sc.voice ? VOICE_SECTION : '';
  const tail = CELLS[cell]?.reinforced ? `\n\n${reinforcementsText()}` : '';
  if (!base.real) {
    return (
      base.text
        .replaceAll('{{PINNED_CONNECTORS}}', pinned)
        .replaceAll('{{LIVE_ACTIVITY}}', activity)
        .replaceAll('{{VOICE_SECTION}}', voice) + tail
    );
  }
  // Real dump: append a bench appendix. The dump's own context may disagree
  // with the scenario's pinned list — the appendix states the authoritative
  // bench state last (recency wins), and we warn for the risky cases.
  if (sc.expect?.noNewJobs || (sc.pinned?.length ?? 0) === 0) {
    console.warn(`  [prompt] ${sc.id}: real-dump mode may disagree with scenario pinned=[${sc.pinned ?? ''}]`);
  }
  return `${base.text}\n\n# BENCH APPENDIX — authoritative state for this turn\n\nConnectors pinned & enabled right now: ${pinned}\n\nLive activity right now:\n${activity}\n${voice}\n${tail}`;
}

// ── CLI spawn (mirrors companion/session.rs run_cli) ─────────────────────
function spawnTurn(cell, systemPrompt, userMessage) {
  return new Promise((resolve) => {
    const promptFile = path.join(
      os.tmpdir(),
      `athena-bench-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`,
    );
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

    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' };
    // Subscription auth, never metered API — same rule as every Athena spawn.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const t0 = Date.now();
    let firstTokenMs = null;
    let timedOut = false;
    const segments = [];
    let usage = null;
    let isError = false;
    let stderr = '';
    let buf = '';

    const child = spawn(process.platform === 'win32' ? 'claude.cmd' : 'claude', args, {
      cwd: os.homedir(),
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // shell:true on Windows makes `child` the cmd shim — kill the whole
      // tree or the real claude process keeps running as an orphan.
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
      child.stdin.write(userMessage);
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
        if (firstTokenMs === null && ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          firstTokenMs = Date.now() - t0;
        }
        if (ev.type === 'assistant') {
          const text = (ev.message?.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
          if (text) segments.push(text);
          if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
        }
        if (ev.type === 'result') {
          usage = ev.usage ?? ev.result?.usage ?? null;
          isError = !!ev.is_error;
        }
      }
    });
    child.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(promptFile, { force: true });
      resolve({
        turnText: segments.join('\n'),
        firstTokenMs,
        totalMs: Date.now() - t0,
        usage,
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
  console.log(`dry-run: ${scenarios.length} scenarios OK-schema, ${roundTrips} sample round-trips, ${bad} problems`);
  process.exit(bad ? 1 : 0);
}

async function runCells(cellIds) {
  const bin = ensureValidator();
  const base = baseSystemPrompt();
  const reps = Number(opt('--reps', '3'));
  const done = loadDone();
  console.log(`running cells [${cellIds.join(', ')}] × ${scenarios.length} scenarios × ${reps} reps (base prompt: ${base.real ? 'REAL dump' : 'distilled fixture'})`);

  for (const cell of cellIds) {
    for (const sc of scenarios) {
      for (let rep = 1; rep <= reps; rep++) {
        const key = `${cell}|${sc.id}|${rep}`;
        if (done.has(key)) continue;
        process.stdout.write(`[${cell}] ${sc.id} #${rep} … `);
        const turn = await spawnTurn(cell, scenarioPrompt(base, sc, cell), sc.message);
        let row = {
          ts: new Date().toISOString(),
          cell,
          scenarioId: sc.id,
          class: sc.class,
          rep,
          message: sc.message,
          firstTokenMs: turn.firstTokenMs,
          totalMs: turn.totalMs,
          usage: turn.usage,
          timedOut: turn.timedOut,
          cliError: turn.isError,
          stderr: turn.stderr,
        };
        if (turn.timedOut && sc.class === 'delegate_vs_inline') {
          // A timeout on a delegate scenario is a DECISION failure, not
          // infra: the model held the turn open doing the work inline
          // instead of delegating and replying in seconds. Score it.
          row = { ...row, pass: false, checks: [{ name: 'delegated-promptly', pass: false, detail: `turn still running at ${TIMEOUT_MS / 1000}s — inlined instead of delegating` }] };
          console.log('FAIL (timeout = inlined, not delegated)');
        } else if (turn.timedOut || turn.isError || !turn.turnText) {
          // Infra failure (rate limit, CLI error, timeout) — recorded for
          // visibility but excluded from accuracy and NOT added to the done
          // set, so a later invocation retries it.
          row = { ...row, pass: false, infra: true, checks: [{ name: 'turn-completed', pass: false, detail: turn.timedOut ? 'timeout' : 'cli error/empty' }] };
          console.log(turn.timedOut ? 'TIMEOUT' : 'CLI ERROR');
        } else {
          const report = runValidator(bin, turn.turnText, sc.pinned ?? []);
          const { pass, checks } = score(report, sc.expect);
          row = { ...row, pass, checks, turnText: turn.turnText, validator: report };
          console.log(`${pass ? 'PASS' : 'FAIL'} (${((turn.totalMs ?? 0) / 1000).toFixed(1)}s)`);
        }
        appendResult(row);
      }
    }
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
  const infra = allRows.filter((r) => r.infra);
  const byKey = new Map();
  for (const r of allRows.filter((r) => !r.infra)) byKey.set(`${r.cell}|${r.scenarioId}|${r.rep}`, r);
  const rows = [...byKey.values()];
  const classes = [...new Set(rows.map((r) => r.class))].sort();
  const cells = Object.keys(CELLS).filter((c) => rows.some((r) => r.cell === c));

  const agg = {};
  for (const c of cells) {
    const mine = rows.filter((r) => r.cell === c);
    agg[c] = {
      n: mine.length,
      passRate: pct(mine.filter((r) => r.pass).length, mine.length),
      p50First: pctl(mine.map((r) => r.firstTokenMs).filter((x) => x != null), 50),
      p50Total: pctl(mine.map((r) => r.totalMs).filter((x) => x != null), 50),
      p90Total: pctl(mine.map((r) => r.totalMs).filter((x) => x != null), 90),
      byClass: Object.fromEntries(
        classes.map((k) => {
          const cc = mine.filter((r) => r.class === k);
          return [k, { n: cc.length, pass: cc.filter((r) => r.pass).length }];
        }),
      ),
    };
  }

  let md = `# Athena model/effort bench — results\n\nGenerated ${new Date().toISOString()} · ${rows.length} scored runs (${infra.length} infra failures excluded from accuracy) · corpus v${corpus.version}\n\n## Per-cell summary\n\n| cell | model | effort | runs | pass % | p50 first-token | p50 total | p90 total |\n|---|---|---|---|---|---|---|---|\n`;
  for (const c of cells) {
    md += `| ${c} | ${CELLS[c].model} | ${CELLS[c].effort ?? 'default(high)'}${CELLS[c].reinforced ? ' **+R**' : ''} | ${agg[c].n} | ${agg[c].passRate} | ${fmtS(agg[c].p50First)} | ${fmtS(agg[c].p50Total)} | ${fmtS(agg[c].p90Total)} |\n`;
  }
  md += `\n## Accuracy by class (pass/runs)\n\n| cell | ${classes.join(' | ')} |\n|---|${classes.map(() => '---').join('|')}|\n`;
  for (const c of cells) {
    md += `| ${c} | ${classes.map((k) => `${agg[c].byClass[k].pass}/${agg[c].byClass[k].n}`).join(' | ')} |\n`;
  }

  md += `\n## Gate verdicts vs o-base\n\nGates: accuracy drop ≤ ${GATES.maxAccuracyDropPts}pts per class; ZERO new fails in ${GATES.hardFailClasses.join(', ')}; p50 total latency win ≥ ${GATES.minLatencyWinPct}%.\n\n`;
  if (!agg['o-base']) {
    md += `_o-base has no runs yet — verdicts need the baseline first._\n`;
  } else {
    for (const c of cells.filter((x) => x !== 'o-base')) {
      const verdictLines = [];
      let promoted = true;
      for (const k of classes) {
        const b = agg['o-base'].byClass[k];
        const m = agg[c].byClass[k];
        if (!b.n || !m.n) { verdictLines.push(`- ${k}: insufficient runs`); promoted = false; continue; }
        const bAcc = (100 * b.pass) / b.n;
        const mAcc = (100 * m.pass) / m.n;
        const drop = bAcc - mAcc;
        const hardFail = GATES.hardFailClasses.includes(k) && m.pass < m.n && b.pass === b.n;
        const ok = !hardFail && drop <= GATES.maxAccuracyDropPts;
        if (!ok) promoted = false;
        verdictLines.push(`- ${k}: ${mAcc.toFixed(0)}% vs ${bAcc.toFixed(0)}% (${drop > 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)}pts)${hardFail ? ' **HARD FAIL**' : ''}${ok ? '' : ' ✗'}`);
      }
      const latWin = agg['o-base'].p50Total && agg[c].p50Total ? (100 * (agg['o-base'].p50Total - agg[c].p50Total)) / agg['o-base'].p50Total : null;
      const latOk = latWin != null && latWin >= GATES.minLatencyWinPct;
      md += `### ${c} — ${promoted && latOk ? '✅ CERTIFIED (all classes + latency)' : promoted ? '🟡 quality parity, latency win < gate' : '❌ not certified'}\n\n${verdictLines.join('\n')}\n- latency: p50 ${fmtS(agg[c].p50Total)} vs ${fmtS(agg['o-base'].p50Total)} (${latWin == null ? '—' : `${latWin.toFixed(0)}% win`})\n\n`;
    }
  }
  md += `\n_LLM-judge prose scoring: not run (deliberate follow-up; results.jsonl carries turnText for an offline judge pass)._\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT, md);
  console.log(md);
  console.log(`written to ${REPORT}`);
}

// ── main ─────────────────────────────────────────────────────────────────
if (has('--dry-run')) {
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
