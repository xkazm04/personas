// @vitest-environment node
// Three deliberation IPCs await ONE headless Claude CLI leg inline:
//   split_team_deliberation         -> engine::deliberation::plan_split
//   merge_deliberation_tracks       -> engine::deliberation::synthesize_merged_proposal
//   resolve_deliberation_escalation -> engine::deliberation::synthesize_proposal ('resolve')
// each through companion::athena_reaction::cli_decision_on_route -> cli_text_inner,
// whose stream is bounded by `Duration::from_secs(N)`. If the wrapper gives up
// before that leg can, the UI reports a failure for tracks / a proposal the
// backend goes on to write. The backend figure is read from the Rust source at
// run time so the two cannot drift silently. Lives under __tests__/, which tsc
// skips (node:fs).
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

import {
  advanceTeamDeliberation,
  mergeDeliberationTracks,
  resolveDeliberationEscalation,
  splitTeamDeliberation,
} from '../teamDeliberations';

function cliLegBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/companion/athena_reaction.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const at = src.indexOf('async fn cli_text_inner');
  expect(at, 'cli_text_inner not found').toBeGreaterThan(0);
  const m = /let timeout = std::time::Duration::from_secs\((\d+)\);/.exec(src.slice(at));
  expect(m, 'cli_text_inner timeout not found').not.toBeNull();
  return Number(m![1]) * 1000;
}

/** engine/deliberation.rs `pub const MAX_TURNS_PER_TICK: usize = N;` - the cap on
 *  persona turns one Continue round runs sequentially (deliberation.rs:879). */
function maxTurnsPerTick(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/engine/deliberation.rs'), 'utf8');
  const m = /pub const MAX_TURNS_PER_TICK: usize = (\d+);/.exec(raw);
  expect(m, 'MAX_TURNS_PER_TICK not found').not.toBeNull();
  return Number(m![1]);
}

function resolvedTimeoutMs(args: unknown[]): number {
  const opts = args[2] as { timeoutMs?: number } | undefined;
  if (opts && typeof opts === 'object' && typeof opts.timeoutMs === 'number') return opts.timeoutMs;
  return DEFAULT_IPC_TIMEOUT_MS;
}

describe('deliberation LLM-leg timeout parity', () => {
  beforeEach(() => { calls.length = 0; });

  it('split_team_deliberation outlives its planner leg', async () => {
    await splitTeamDeliberation('d1');
    expect(calls[0]?.[0]).toBe('split_team_deliberation');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(cliLegBudgetMs());
  });

  it('merge_deliberation_tracks outlives its merge leg', async () => {
    await mergeDeliberationTracks('d1');
    expect(calls[0]?.[0]).toBe('merge_deliberation_tracks');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(cliLegBudgetMs());
  });

  it('resolve_deliberation_escalation outlives its proposal leg', async () => {
    await resolveDeliberationEscalation('d1', 'resolve');
    expect(calls[0]?.[0]).toBe('resolve_deliberation_escalation');
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(cliLegBudgetMs());
  });

  it('advance_team_deliberation outlives its worst-case round', async () => {
    // advance_one_deliberation: moderator leg, then EITHER Continue (up to
    // MAX_TURNS_PER_TICK sequential persona turns, each one cli_text_inner leg via
    // cli_decision_with_model) OR Resolve (one synthesize_proposal leg). The
    // branches are exclusive, so worst case = moderator + turns x leg.
    await advanceTeamDeliberation('d1');
    expect(calls[0]?.[0]).toBe('advance_team_deliberation');
    const leg = cliLegBudgetMs();
    const worst = leg * (1 + Math.max(maxTurnsPerTick(), 1));
    expect(resolvedTimeoutMs(calls[0]!)).toBeGreaterThan(worst);
  });
});
