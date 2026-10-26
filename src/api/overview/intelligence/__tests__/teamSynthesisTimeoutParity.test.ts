// @vitest-environment node
// Both team-synthesis IPCs must outlive the backend's own run budget.
// `run_crew_synthesis` (commands/design/team_synthesis.rs) runs a StructuredJson
// Claude call under `with_escalation`, so a rejected first answer is retried
// once on a second route: two legs of SYNTHESIS_TIMEOUT_SECS each, then team
// assembly, all inline. If the wrapper gives up first, the UI reports failure
// for a team the backend goes on to create. The backend figure is read from
// the Rust source at run time so the two cannot drift silently.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_IPC_TIMEOUT_MS = 90_000; // src/lib/tauriInvoke.ts DEFAULT_TIMEOUT_MS

const calls: unknown[][] = [];
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({});
  }),
}));

import { synthesizeTeamFromTemplates } from '../teamSynthesis';
import { synthesizeProjectCrew } from '../../../devTools/crewFoundry';

function backendBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/design/team_synthesis.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = /const SYNTHESIS_TIMEOUT_SECS: u64 = (\d+);/.exec(src);
  expect(m, 'SYNTHESIS_TIMEOUT_SECS not found').not.toBeNull();
  const body = src.slice(src.indexOf('async fn run_crew_synthesis'));
  expect(body.length, 'run_crew_synthesis not found').toBeGreaterThan(30);
  const legs = /with_escalation\(\s*SYNTHESIS_CLASS/.test(body) ? 2 : 1;
  return Number(m![1]) * 1000 * legs;
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  if (typeof args[3] === 'number') return args[3];
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('team synthesis timeout parity', () => {
  beforeEach(() => { calls.length = 0; });

  it('the backend budget is two escalation legs', () => {
    expect(backendBudgetMs()).toBeGreaterThanOrEqual(240_000);
  });

  it('synthesize_team_from_templates outlives the backend budget', async () => {
    await synthesizeTeamFromTemplates('a crew', 'Crew');
    expect(calls[0]?.[0]).toBe('synthesize_team_from_templates');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });

  it('synthesize_project_crew outlives the backend budget', async () => {
    await synthesizeProjectCrew('p1', 'brief', [], 'Crew');
    expect(calls[0]?.[0]).toBe('synthesize_project_crew');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(backendBudgetMs());
  });
});
