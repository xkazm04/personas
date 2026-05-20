#!/usr/bin/env node
/**
 * Re-score marathon results from the REAL executions in the DB.
 *
 * The first 50-template run had two harness measurement bugs:
 *   1. tool_steps was JSON.parse()'d but the bridge already returns it
 *      as an array → parse threw → count fell to 0 → 37 genuinely-
 *      successful runs became false `empty-execution` soft-fails.
 *   2. waitForExecution used a 4-min cap + a shared pre-loop timestamp.
 *      Real executions run 75s-385s; slow ones false-timed-out, and
 *      the shared timestamp let capability N match capability N-1's
 *      late-completing execution.
 *
 * Per-capability attribution can't be reliably reconstructed from the
 * raced original data, so this re-score reports PER-PERSONA execution
 * health instead: a template passes if its persona produced at least
 * one successful execution (completed, with tool steps or model cost)
 * and zero failed executions. The pipeline phases (open/questionnaire/
 * build/promote) keep their originally-recorded status.
 *
 * Usage: node tests/playwright/template-marathon-rescore.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', '..', 'tests', 'results', 'marathon');
const PORT = process.env.COMPANION_TEST_PORT ?? '17320';

async function listExecutions(personaId) {
  const res = await fetch(`http://127.0.0.1:${PORT}/bridge-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'invokeCommand',
      params: { command: 'list_executions', params: { personaId, limit: 50 } },
      timeout_secs: 20,
    }),
  });
  const raw = await res.json();
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const payload = parsed?.result ?? parsed;
  if (Array.isArray(payload)) return payload;
  return payload?.executions ?? [];
}

function countToolSteps(toolSteps) {
  if (Array.isArray(toolSteps)) return toolSteps.length;
  if (typeof toolSteps === 'string' && toolSteps.trim()) {
    try {
      const p = JSON.parse(toolSteps);
      return Array.isArray(p) ? p.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

async function main() {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));
  const summary = { pass: 0, 'soft-fail': 0, 'hard-fail': 0 };
  const report = [];

  for (const file of files) {
    const path = join(RESULTS_DIR, file);
    const d = JSON.parse(readFileSync(path, 'utf8'));

    // A pipeline-phase hard-fail (build/promote never produced a
    // persona) stays a hard-fail regardless of executions.
    const pipelineHardFail = d.phases.some(
      (p) => p.status === 'hard-fail' && ['open', 'questionnaire', 'build', 'promote'].includes(p.phase),
    );
    if (pipelineHardFail || !d.persona_id) {
      d.outcome = 'hard-fail';
      summary['hard-fail'] += 1;
      report.push({ id: d.template_id, outcome: 'hard-fail', note: d.failure_signature });
      writeFileSync(path, JSON.stringify(d, null, 2));
      continue;
    }

    const execs = await listExecutions(d.persona_id);
    let completed = 0;
    let failed = 0;
    let totalSteps = 0;
    let totalCost = 0;
    for (const e of execs) {
      if (e.status === 'completed') {
        completed += 1;
        totalSteps += countToolSteps(e.tool_steps);
        totalCost += e.cost_usd ?? 0;
      } else if (e.status === 'failed') {
        failed += 1;
      }
    }

    // Refresh capability_results as an execution-health summary.
    d.capability_results = [
      {
        executions_total: execs.length,
        executions_completed: completed,
        executions_failed: failed,
        total_tool_steps: totalSteps,
        total_cost_usd: Number(totalCost.toFixed(4)),
      },
    ];

    let outcome;
    if (execs.length === 0) {
      outcome = 'soft-fail';
      d.failure_signature = 'phase:execute:no-executions';
    } else if (failed > 0 && completed === 0) {
      outcome = 'hard-fail';
      d.failure_signature = 'phase:execute:all-executions-failed';
    } else if (failed > 0) {
      outcome = 'soft-fail';
      d.failure_signature = `phase:execute:${failed}-of-${execs.length}-failed`;
    } else if (totalSteps === 0 && totalCost === 0) {
      outcome = 'soft-fail';
      d.failure_signature = 'phase:verify:empty-execution';
    } else {
      outcome = 'pass';
      d.failure_signature = null;
    }
    d.outcome = outcome;
    summary[outcome] += 1;
    report.push({
      id: d.template_id,
      outcome,
      note: `${completed}✓/${failed}✗ execs, ${totalSteps} steps, $${totalCost.toFixed(2)}`,
    });
    writeFileSync(path, JSON.stringify(d, null, 2));
  }

  report.sort((a, b) => a.id.localeCompare(b.id));
  for (const r of report) {
    const mark = r.outcome === 'pass' ? '  ' : r.outcome === 'soft-fail' ? '~ ' : '✗ ';
    console.log(`${mark}${r.id.padEnd(40)} ${r.outcome.padEnd(10)} ${r.note ?? ''}`);
  }
  console.log(`\nFINAL: ${JSON.stringify(summary)}`);
}

main().catch((e) => {
  console.error('rescore failed:', e);
  process.exit(1);
});
