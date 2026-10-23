// The NL-query lane's lost-job watchdog must outlast the backend's own budget.
// `run_nl_query` (src-tauri/src/commands/credentials/nl_query.rs) hands the
// model call to `ai_helpers::run_single_turn_prompt`, which runs it through
// `run_claude_prompt_text_inner` with a silence lease (a producing call may run
// LEASE_CEILING_FACTOR times that long) and escalates ONCE on an output with no
// SQL block. The watchdog was 60 s against that budget, so a slow but healthy
// answer was cancelled and painted "timed out". The Rust figures are read from
// source at run time so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NL_QUERY_POLL_TIMEOUT_MS } from '../ChatTab';

function rust(rel: string): string {
  const raw = readFileSync(resolve(process.cwd(), rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function one(src: string, re: RegExp, what: string): number {
  const all = [...src.matchAll(new RegExp(re.source, 'g'))];
  expect(all.length, `${what}: a regex that finds nothing is a broken matcher`).toBe(1);
  return Number(all[0]![1]!.replace(/_/g, ''));
}

describe('NL query watchdog vs the backend run budget', () => {
  it('outlasts every leg the backend may still be working on', () => {
    const helpers = rust('src-tauri/src/engine/ai_helpers.rs');
    // The lease is the last argument of the run_claude_prompt_text_inner call
    // inside run_single_turn_prompt.
    const body = helpers.slice(helpers.indexOf('pub async fn run_single_turn_prompt'));
    const leaseSecs = one(
      body.slice(0, body.indexOf('\n}\n')),
      /run_claude_prompt_text_inner\([\s\S]*?,\s*(\d+),?\s*\)/,
      'single-turn lease',
    );
    const ceiling = one(
      rust('src-tauri/src/commands/design/n8n_transform/cli_runner.rs'),
      /const LEASE_CEILING_FACTOR: u32 = (\d+);/,
      'LEASE_CEILING_FACTOR',
    );
    // with_escalation runs the first route and, on rejected output, exactly one
    // escalated route (`escalate_to: None` on the second).
    const escalation = rust('src-tauri/engine/src/cli_process.rs');
    expect(escalation).toMatch(/pub async fn with_escalation/);
    const attempts = 2;

    const backendBudgetMs = attempts * leaseSecs * ceiling * 1000;
    expect(NL_QUERY_POLL_TIMEOUT_MS).toBeGreaterThan(backendBudgetMs);
  });
});
