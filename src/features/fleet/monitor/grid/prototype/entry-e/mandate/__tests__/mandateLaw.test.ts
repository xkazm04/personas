import { describe, expect, it } from 'vitest';

import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

import { canRevert, narrowableScope } from '../MandateRail';
import { asScope } from '../mandateCopy';
import { registerOrder } from '../RegisterView';
import { actMatches, countFilters } from '../useActLog';

function act(over: Partial<CharterAct>): CharterAct {
  return {
    id: 'a', charterId: 'c1', envelopeVersion: 1, itemKind: 'report', itemId: 'report:1', verdict: 'read',
    actor: 'router', scope: 'report.read', reversible: true, costUsd: null, shownJson: null, envChange: null,
    revertedAt: null, revertActId: null, originDevice: null, createdAt: '2026-10-14T00:00:00Z', ...over,
  };
}

function mandate(over: Partial<MandateSummary> & { scopes?: MandateSummary['envelope']['decideScopes']; version?: number }): MandateSummary {
  return {
    charterId: 'c1', title: 'Ship it', projectId: 'p1', projectName: 'Personas', stewardPersonaId: 's1', stewardName: 'App Master',
    status: 'active', scopeRung: 2, source: 'app_master', updatedAt: '2026-10-14T00:00:00Z',
    envelope: { decideScopes: over.scopes ?? [], mergePolicy: 'never', budgetMonthlyUsd: null, envelopeVersion: over.version ?? 0, keptAtActs: null },
    load: { spendUsedUsd: null, budgetUsd: null, actsCount: 0, openAsks: 0 },
    ...over,
  };
}

describe('act log filters', () => {
  const acts = [
    act({ id: '1' }),
    act({ id: '2', actor: 'operator', scope: null }),
    act({ id: '3', reversible: false }),
    act({ id: '4', revertedAt: '2026-10-14T01:00:00Z', revertActId: '5' }),
    act({ id: '5', actor: 'operator', itemKind: 'act.revert', scope: null }),
  ];

  it('counts every filter over the same page', () => {
    expect(countFilters(acts)).toEqual({ all: 5, steward: 3, you: 2, revertible: 2, reverted: 1 });
  });

  it('never offers a revert of a revert, a final act or a reverted one', () => {
    expect(canRevert(acts[0]!)).toBe(true);
    expect(canRevert(acts[2]!)).toBe(false);
    expect(canRevert(acts[3]!)).toBe(false);
    expect(canRevert(acts[4]!)).toBe(false);
    expect(actMatches('revertible', acts[4]!)).toBe(false);
  });
});

describe('narrow', () => {
  it('is offered only for a scope a signed envelope still grants', () => {
    const a = act({ scope: 'report.read' });
    expect(narrowableScope(mandate({ scopes: ['report.read'], version: 2 }), a)).toBe('report.read');
    expect(narrowableScope(mandate({ scopes: ['report.read'], version: 0 }), a)).toBeNull();
    expect(narrowableScope(mandate({ scopes: ['dispatch'], version: 2 }), a)).toBeNull();
    expect(narrowableScope(mandate({ scopes: ['report.read'], version: 2 }), act({ scope: 'weird' }))).toBeNull();
  });

  it('narrows an unknown stored scope to null', () => {
    expect(asScope('idea.accept')).toBe('idea.accept');
    expect(asScope('nope')).toBeNull();
    expect(asScope(null)).toBeNull();
  });
});

describe('the register order', () => {
  it('puts the mandates asking the operator first', () => {
    const quiet = mandate({ charterId: 'q', load: { spendUsedUsd: null, budgetUsd: null, actsCount: 9, openAsks: 0 } });
    const asking = mandate({ charterId: 'a', load: { spendUsedUsd: null, budgetUsd: null, actsCount: 0, openAsks: 2 } });
    expect(registerOrder([quiet, asking]).map((m) => m.charterId)).toEqual(['a', 'q']);
  });
});
