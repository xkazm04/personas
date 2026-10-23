// The rule-generation IPC must outlive the backend's own budget.
// `scraper_generate_rules` (commands/infrastructure/scraper.rs) first fetches
// the page through the scraper's SSRF-safe client (engine/src/scraper.rs,
// `build_ssrf_safe_client(Duration::from_secs(N))`), then runs the model through
// `with_escalation`, whose attempts are each capped by the `timeout_secs`
// argument of `spawn_claude_and_collect`. An `Extract` call escalates once, so
// a slow run is fetch + 2 attempts. If the wrapper gives up first, the UI says
// generation failed while the backend finishes and its rules go nowhere.
// Figures are read from the Rust source so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({});
  }),
}));

import { generateScraperRules } from '../scraper';

function rust(path: string): string {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function backendBudgetMs(): number {
  const cmd = rust('src-tauri/src/commands/infrastructure/scraper.rs');
  const start = cmd.indexOf('pub async fn scraper_generate_rules');
  expect(start, 'scraper_generate_rules not found').toBeGreaterThan(-1);
  const body = cmd.slice(start, cmd.indexOf('#[tauri::command]', start + 1));

  const attempt = /spawn_claude_and_collect\(\s*&cli_args,\s*prompt_text,\s*(\d+)\s*,/.exec(body);
  expect(attempt, 'spawn_claude_and_collect timeout_secs not found').not.toBeNull();
  const attempts = body.includes('with_escalation(') ? 2 : 1;

  const engine = rust('src-tauri/engine/src/scraper.rs');
  const fetchSecs = /build_ssrf_safe_client\(Duration::from_secs\((\d+)\)\)/.exec(engine);
  expect(fetchSecs, 'scraper fetch client timeout not found').not.toBeNull();

  return (Number(fetchSecs![1]) + attempts * Number(attempt![1])) * 1000;
}

describe('scraper_generate_rules timeout parity', () => {
  it('the IPC timeout is longer than the grounding fetch plus every model attempt', async () => {
    const budget = backendBudgetMs();
    expect(budget).toBe(210_000); // 30 s fetch + 2 x 90 s, today
    await generateScraperRules('the price', 'https://example.com');
    expect(calls[0]?.[0]).toBe('scraper_generate_rules');
    const opts = calls[0]![2] as { timeoutMs: number };
    expect(opts.timeoutMs).toBeGreaterThan(budget);
  });
});
