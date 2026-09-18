/**
 * Pure parts of scripts/e2e/athena-browser-react.mjs — setup parsing, the
 * stream-timeline reduction, result-row keys and the report aggregation.
 * No I/O, no app: everything here is unit-tested by
 * scripts/e2e/__tests__/athena-browser-react.test.mjs.
 *
 * The timing rule is the one scripts/test/lib/stream-timing.mjs encodes: a
 * latency figure names the two events it is measured between, and stamps
 * taken at different events never share a series. Here the UI-side series
 * is `uiFirstTextMs` = first `text_delta` stamp minus the send stamp, and the
 * ledger series is `ledgerFirstTextMs` = `companion_turn.first_text_ms`
 * (spawn or user-line write to first text, measured by the backend). They
 * are reported side by side, never pooled.
 */

export const DEFAULT_SETUPS = 'main:claude:claude-opus-5:low,main:claude:claude-sonnet-5:low';
export const SCENARIOS = ['A', 'B'];
export const TURN_KINDS = ['A', 'B', 'B2', 'B_followup'];

export const MESSAGES = {
  A: 'What do you think about this page?',
  B: 'Research whether the three claims on this page hold up, then tell me what you think.',
  B2: 'Meanwhile, what is the capital of Australia?',
};

/**
 * `main:<engine>:<model>:<effort>[,...]` -> [{ id, tier, engine, model, effort }].
 * `effort` may be empty (`main:claude:claude-opus-5:`) meaning the tier's
 * calibrated default; a missing fourth field is the same thing.
 */
export function parseSetups(spec) {
  const text = (spec ?? '').trim();
  if (!text) throw new Error('--setups is empty');
  return text.split(',').map((raw) => {
    const s = raw.trim();
    if (!s) throw new Error('empty setup entry in --setups');
    const parts = s.split(':');
    if (parts.length < 3 || parts.length > 4) {
      throw new Error(`setup "${s}" must be tier:engine:model[:effort]`);
    }
    const [tier, engine, model, effort = ''] = parts.map((p) => p.trim());
    if (tier !== 'main') throw new Error(`setup "${s}": only the main tier is driven by this harness`);
    if (!['claude', 'grok'].includes(engine)) throw new Error(`setup "${s}": engine must be claude or grok`);
    if (!model) throw new Error(`setup "${s}": model is empty`);
    return { id: s, tier, engine, model, effort };
  });
}

/** Comma list -> validated scenario ids. */
export function parseScenarios(spec) {
  const list = (spec ?? SCENARIOS.join(',')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const s of list) if (!SCENARIOS.includes(s)) throw new Error(`unknown scenario "${s}" (A, B)`);
  return [...new Set(list)];
}

/** Stable identity of one result row; resume skips keys already recorded. */
export function rowKey(r) {
  return `${r.setup}|${r.rep}|${r.scenario}|${r.turn}`;
}

/**
 * Reduce the bench's stamped events for ONE turn (matched by `turnId`, or by
 * `sessionId` when the turn id is unknown) against the send stamp.
 *
 * `sendPerfNow` is the page-side `performance.now()` taken right before the
 * send was dispatched; a `null` send stamp yields `null` intervals rather
 * than a guessed anchor.
 */
export function reduceTimeline(events, { turnId = null, sessionId = null, sendPerfNow = null } = {}) {
  const mine = events.filter((e) => (turnId ? e.turnId === turnId : true) && (sessionId ? e.sessionId === sessionId : true));
  const first = (pred) => mine.find(pred) ?? null;
  const started = first((e) => e.kind === 'started');
  const firstText = first((e) => e.isTextDelta);
  const firstChunk = first((e) => e.deltaType != null);
  const finished = first((e) => e.kind === 'finished');
  const errored = first((e) => e.kind === 'error');
  const result = first((e) => e.isResult);
  const rel = (e) => (e && sendPerfNow != null ? Math.round(e.perfNow - sendPerfNow) : null);
  const toolsUsed = [...new Set(mine.map((e) => e.toolName).filter(Boolean))];
  return {
    turnId: turnId ?? started?.turnId ?? firstText?.turnId ?? null,
    eventCount: mine.length,
    uiStartedMs: rel(started),
    uiFirstTextMs: rel(firstText),
    uiFirstChunkMs: rel(firstChunk),
    uiFirstChunkKind: firstChunk?.deltaType ?? null,
    uiFinishedMs: rel(finished ?? result),
    firstTextWallMs: firstText?.wallMs ?? null,
    toolsUsed,
    errored: Boolean(errored) || Boolean(result?.isError),
    unmeasured: firstText ? null : 'no-visible-text-delta',
  };
}

/** Distinct turn ids seen in a session, in first-seen order. */
export function turnIdsInSession(events, sessionId) {
  const out = [];
  for (const e of events) if (e.sessionId === sessionId && e.turnId && !out.includes(e.turnId)) out.push(e.turnId);
  return out;
}

/** Nearest-rank percentile on a numeric array; null on empty. */
export function pctl(arr, p) {
  const xs = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const fmtS = (ms) => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');

/** Last row per key wins (a retried key replaces its earlier attempt). */
export function dedupeRows(rows) {
  const byKey = new Map();
  for (const r of rows) byKey.set(rowKey(r), r);
  return [...byKey.values()];
}

/**
 * Aggregate per (setup, scenario). Skipped rows are counted, never
 * averaged; timed-out rows count as attempts and contribute no latency.
 */
export function aggregate(rowsIn) {
  const rows = dedupeRows(rowsIn);
  const setups = [...new Set(rows.map((r) => r.setup))];
  const out = [];
  for (const setup of setups) {
    for (const scenario of SCENARIOS) {
      const mine = rows.filter((r) => r.setup === setup && r.scenario === scenario);
      if (!mine.length) continue;
      const first = mine.find((r) => r.turn === scenario) ?? mine[0];
      const primary = mine.filter((r) => r.turn === scenario && !r.skipped);
      const ok = primary.filter((r) => !r.error && !r.timedOut);
      const b2 = mine.filter((r) => r.turn === 'B2' && !r.skipped);
      const fu = mine.filter((r) => r.turn === 'B_followup' && !r.skipped);
      out.push({
        setup,
        engine: first.engine,
        model: first.model,
        effort: first.effort,
        scenario,
        attempts: primary.length,
        skipped: mine.filter((r) => r.skipped).length,
        timedOut: primary.filter((r) => r.timedOut).length,
        errors: primary.filter((r) => r.error && !r.timedOut).length,
        n: ok.length,
        uiFirstTextN: ok.filter((r) => r.uiFirstTextMs != null).length,
        p50UiFirstText: pctl(ok.map((r) => r.uiFirstTextMs), 50),
        p90UiFirstText: pctl(ok.map((r) => r.uiFirstTextMs), 90),
        p50LedgerFirstText: pctl(ok.map((r) => r.ledgerFirstTextMs), 50),
        p90LedgerFirstText: pctl(ok.map((r) => r.ledgerFirstTextMs), 90),
        p50Total: pctl(ok.map((r) => r.durationMs), 50),
        p90Total: pctl(ok.map((r) => r.durationMs), 90),
        tools: [...new Set(ok.flatMap((r) => r.toolsUsed ?? []))].sort(),
        researchDispatched: primary.filter((r) => r.researchDispatched === true).length,
        b2N: b2.length,
        b2AnsweredWhileRunning: b2.filter((r) => r.jobStillRunningAtFirstToken === true).length,
        p50B2FirstText: pctl(b2.map((r) => r.uiFirstTextMs), 50),
        followupN: fu.filter((r) => r.followupLatencyMs != null).length,
        p50Followup: pctl(fu.map((r) => r.followupLatencyMs), 50),
        p90Followup: pctl(fu.map((r) => r.followupLatencyMs), 90),
      });
    }
  }
  return out;
}

/** Markdown for .planning/athena-browser-react/report.md. */
export function renderReport(rowsIn, { generatedAt = new Date().toISOString() } = {}) {
  const rows = dedupeRows(rowsIn);
  const agg = aggregate(rows);
  const notes = [...new Set(rows.map((r) => r.note).filter(Boolean))];
  let md = `# Athena browser-page reaction — results\n\nGenerated ${generatedAt} · ${rows.length} rows (last row per setup/rep/scenario/turn) · ${agg.length} setup x scenario cells\n\n`;
  md += `Two first-token series, never pooled: **UI** = first \`text_delta\` seen by the page minus the send stamp (what the user waits); **ledger** = \`companion_turn.first_text_ms\` (spawn or user-line write to first text, backend-measured).\n\n`;
  md += `## Per setup x scenario\n\n| setup | scenario | attempts | ok | skipped | timed out | errors | p50 / p90 UI first text (n) | p50 / p90 ledger first text | p50 / p90 total | tools | research dispatched | B2 answered while job ran | p50 B2 first text | follow-up p50 / p90 (n) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const a of agg) {
    const research = a.scenario === 'B' ? pct(a.researchDispatched, a.attempts) : 'n/a';
    const b2 = a.scenario === 'B' ? `${pct(a.b2AnsweredWhileRunning, a.b2N)} (${a.b2N})` : 'n/a';
    const b2t = a.scenario === 'B' ? fmtS(a.p50B2FirstText) : 'n/a';
    const fu = a.scenario === 'B' ? `${fmtS(a.p50Followup)} / ${fmtS(a.p90Followup)} (${a.followupN})` : 'n/a';
    md += `| ${a.setup} | ${a.scenario} | ${a.attempts} | ${a.n} | ${a.skipped} | ${a.timedOut} | ${a.errors} | ${fmtS(a.p50UiFirstText)} / ${fmtS(a.p90UiFirstText)} (${a.uiFirstTextN}/${a.n}) | ${fmtS(a.p50LedgerFirstText)} / ${fmtS(a.p90LedgerFirstText)} | ${fmtS(a.p50Total)} / ${fmtS(a.p90Total)} | ${a.tools.join(', ') || 'none'} | ${research} | ${b2} | ${b2t} | ${fu} |\n`;
  }
  if (notes.length) {
    md += `\n## Notes recorded by the harness\n\n`;
    for (const n of notes) md += `- ${n}\n`;
  }
  const errs = rows.filter((r) => r.error && !r.skipped);
  if (errs.length) {
    md += `\n## Errors (${errs.length})\n\n`;
    for (const r of errs) md += `- ${rowKey(r)}: ${String(r.error).slice(0, 200)}\n`;
  }
  md += `\n_Judging answer quality is out of scope; every row keeps \`turnText\` for an offline judge pass._\n`;
  return md;
}

/** Usage text, shared by --help and the bad-flag path. */
export const USAGE = `Athena browser-page reaction harness (docs/tests/athena-browser-react/README.md)

Requires the app RUNNING with the test-automation server (npm run tauri:dev:test).

  node scripts/e2e/athena-browser-react.mjs [options]
  node scripts/e2e/athena-browser-react.mjs --dry-run       # app up? engines? fixture served + opened; sends nothing
  node scripts/e2e/athena-browser-react.mjs --report        # aggregate results.jsonl -> report.md

Options:
  --setups <list>     main:<engine>:<model>:<effort>,...  (default ${DEFAULT_SETUPS})
  --reps <n>          repetitions per setup x scenario (default 1)
  --scenarios <list>  A,B (default both)
  --port <n>          test-automation port (default PERSONAS_TEST_PORT or 17320)
  --fixture-port <n>  local port the fixture page is served on (default 3000)
  --timeout <s>       per-turn / per-wait ceiling in seconds (default 300)
  --fresh             ignore recorded rows (re-run every key)
  --dry-run           read-only checks + page open, no chat turn is sent
  --report            write .planning/athena-browser-react/report.md and exit
  --help              this text

Env: PERSONAS_TEST_PORT, PERSONAS_BASE (overrides host:port), PERSONAS_DB_DIR
(directory holding personas_data.db; default %APPDATA%/com.personas.desktop).

Exit codes: 0 done, 1 harness error, 2 app not reachable on the test port.`;
