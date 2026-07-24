import { describe, it, expect } from 'vitest';
import type { FleetRunReport } from '@/lib/bindings/FleetRunReport';
import type { FleetRunSession } from '@/lib/bindings/FleetRunSession';
import { buildRunMarkdown, formatTokens, outcomeToken } from '../fleetRunMarkdown';

const session = (over: Partial<FleetRunSession> = {}): FleetRunSession => ({
  sessionId: 's1',
  claudeSessionId: 'cc1',
  label: 'Refactor the fleet',
  projectLabel: 'personas',
  state: 'finished',
  summary: 'Shipped the durable registry.',
  tokens: { input: 12_000n, output: 3_400n, cacheCreation: 0n, cacheRead: 1_500_000n },
  filesTouched: 7,
  userMessages: 3,
  assistantMessages: 11,
  createdAtMs: 1_000n,
  lastActivityMs: 2_000n,
  ...over,
});

const report = (over: Partial<FleetRunReport> = {}): FleetRunReport => ({
  runId: 'abcdef0123456789',
  runLabel: 'perfect round 9',
  startedAtMs: 1_700_000_000_000n,
  sessions: [session()],
  totals: {
    sessionCount: 1,
    finishedCount: 1,
    activeCount: 0,
    exitedCount: 0,
    tokens: { input: 12_000n, output: 3_400n, cacheCreation: 0n, cacheRead: 1_500_000n },
    filesTouched: 7,
  },
  ...over,
});

describe('formatTokens', () => {
  it('scales to k / M so a report stays glanceable', () => {
    expect(formatTokens(942)).toBe('942');
    expect(formatTokens(12_300)).toBe('12.3k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(1_500_000n)).toBe('1.5M');
  });
});

describe('outcomeToken', () => {
  it('reads as an outcome, not a lifecycle state', () => {
    expect(outcomeToken('finished')).toBe('delivered');
    expect(outcomeToken('stale')).toBe('stalled');
  });
  it('passes unknown states through rather than inventing one', () => {
    expect(outcomeToken('some_future_state')).toBe('some_future_state');
  });
});

describe('buildRunMarkdown', () => {
  it('reports the declared summary and the run totals', () => {
    const md = buildRunMarkdown(report());
    expect(md).toContain('# perfect round 9');
    expect(md).toContain('Delivered: 1/1');
    expect(md).toContain('Files touched: 7');
    expect(md).toContain('12.0k in / 3.4k out');
    expect(md).toContain('### Refactor the fleet — delivered');
    expect(md).toContain('Shipped the durable registry.');
  });

  it('falls back to the run id when the run was never named', () => {
    const md = buildRunMarkdown(report({ runLabel: null }));
    expect(md).toContain('# Fleet run abcdef01');
  });

  it('flags still-live and exited sessions in the headline', () => {
    const md = buildRunMarkdown(
      report({
        totals: {
          ...report().totals,
          sessionCount: 4,
          finishedCount: 2,
          activeCount: 1,
          exitedCount: 1,
        },
      }),
    );
    expect(md).toContain('Delivered: 2/4 (1 still live) · 1 exited');
  });

  it('never fabricates an outcome for a session that declared none', () => {
    const md = buildRunMarkdown(
      report({ sessions: [session({ state: 'stale', summary: null, label: 'Silent one' })] }),
    );
    expect(md).toContain('### Silent one — stalled');
    expect(md).not.toContain('Shipped the durable registry.');
  });

  it('handles an empty run without producing a broken document', () => {
    const md = buildRunMarkdown(report({ sessions: [] }));
    expect(md).toContain('_No sessions in this run._');
  });
});
