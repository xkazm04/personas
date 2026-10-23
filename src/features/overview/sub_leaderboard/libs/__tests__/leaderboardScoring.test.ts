import { describe, it, expect } from 'vitest';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { computeLeaderboard, type DimensionKey, type LeaderboardEntry } from '../leaderboardScoring';
import { rankBy } from '../leaderboardRanking';
import { computeFleetBenchmark } from '../useLeaderboardData';

function signal(over: Partial<PersonaHealthSignal> & { personaId: string }): PersonaHealthSignal {
  return {
    personaName: over.personaId,
    personaIcon: null,
    personaColor: null,
    grade: 'healthy',
    heartbeatScore: 100,
    successRate: 100,
    successRateSource: 'unknown',
    healingFrequency: 0,
    rollbackCount: 0,
    budgetRatio: 0,
    dailyBurnRate: 0,
    projectedExhaustionDays: null,
    projectedMonthlyCost: 0,
    failureTrend: 'stable',
    predictedFailureInDays: null,
    totalExecutions: 0,
    recentExecutions: 0,
    avgLatencyMs: 0,
    ...over,
  };
}

/** An agent that has never run: the slice fills it with success 100
 *  ('unknown'), a heartbeat of 100, and the fleet's latency. */
const idle = signal({ personaId: 'idle', avgLatencyMs: 2000 });

/** An agent with a measured, imperfect record. */
const working = signal({
  personaId: 'working',
  successRateSource: 'measured',
  successRate: 80,
  heartbeatScore: 78,
  totalExecutions: 40,
  recentExecutions: 20,
  avgLatencyMs: 2000,
  dailyBurnRate: 0.5,
});

const working2 = signal({
  personaId: 'working2',
  successRateSource: 'measured',
  successRate: 60,
  heartbeatScore: 60,
  totalExecutions: 10,
  recentExecutions: 5,
  avgLatencyMs: 4000,
  dailyBurnRate: 0.2,
});

const dim = (e: LeaderboardEntry, key: DimensionKey) => e.dimensions.find((d) => d.key === key)?.value;
const byId = (entries: LeaderboardEntry[], id: string) => entries.find((e) => e.personaId === id)!;

describe('computeLeaderboard: unmeasured is not an answer', () => {
  it('an agent that never ran does not outrank one with a measured record', () => {
    const board = computeLeaderboard([idle, working]);
    expect(board[0]!.personaId).toBe('working');
    expect(board[0]!.rank).toBe(1);
    expect(board[0]!.medal).toBe('gold');
  });

  it('an agent with no measured runs has no composite, no rank and no medal', () => {
    const e = byId(computeLeaderboard([idle, working]), 'idle');
    expect(e.compositeScore).toBeNull();
    expect(e.rank).toBeNull();
    expect(e.medal).toBeNull();
  });

  it('the success, health and speed of an unmeasured agent read as absent, not 100 or neutral', () => {
    const e = byId(computeLeaderboard([idle, working]), 'idle');
    expect(dim(e, 'success')).toBeNull();
    expect(dim(e, 'health')).toBeNull();
    expect(dim(e, 'speed')).toBeNull();
    expect(dim(e, 'cost')).toBeNull();
    // Activity is a count: zero runs is a measurement.
    expect(dim(e, 'activity')).toBe(0);
  });

  it('a fleet-proxy success rate is not shown as the agent\'s own', () => {
    const proxy = signal({ personaId: 'proxy', successRateSource: 'proxy', successRate: 91, totalExecutions: 3, avgLatencyMs: 2000 });
    const e = byId(computeLeaderboard([proxy, working]), 'proxy');
    expect(dim(e, 'success')).toBeNull();
    expect(e.compositeScore).toBeNull();
  });
});

describe('rankBy: a dimension ranking never medals an absence', () => {
  it('unmeasured agents sort after measured ones, unranked', () => {
    const board = rankBy(computeLeaderboard([idle, working2, working]), 'speed');
    expect(board.map((e) => e.personaId)).toEqual(['working', 'working2', 'idle']);
    expect(board.map((e) => e.rank)).toEqual([1, 2, null]);
    expect(board[2]!.medal).toBeNull();
  });
});

describe('computeFleetBenchmark', () => {
  it('averages each dimension over the agents measured on it', () => {
    const board = computeLeaderboard([idle, working, working2]);
    const bench = computeFleetBenchmark(board)!;
    // success: (80 + 60) / 2, the idle agent's absent success is not a 0 or a 100
    expect(bench.dimensionValues[0]).toBe(70);
  });
});
