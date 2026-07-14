import { describe, it, expect } from 'vitest';

import { contextCostFromSpend, contextErrorsFromIssues } from '../useContextRuntime';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import type { SentryUnresolvedIssue } from '@/features/plugins/dev-tools/sub_overview/adapters';

function uc(slug: string, contextIds: string[]): DevUseCase {
  return { id: `uc-${slug}`, slug, name: slug, context_ids: contextIds } as unknown as DevUseCase;
}

function issue(over: Partial<SentryUnresolvedIssue>): SentryUnresolvedIssue {
  return { id: '1', shortId: 'E-1', title: 'Boom', culprit: null, count: 10, lastSeen: null, ...over };
}

describe('contextCostFromSpend', () => {
  it("flows a feature's cost onto every context it slices (NOT split between them)", () => {
    const cost = contextCostFromSpend(new Map([['checkout', 9]]), [uc('checkout', ['ctx-ui', 'ctx-api'])]);
    // Deliberate: the full 9 lands on both. It's a flow-through metric, not an
    // allocation — splitting would invent precision the data doesn't have.
    expect(cost.get('ctx-ui')).toBe(9);
    expect(cost.get('ctx-api')).toBe(9);
  });

  it('sums multiple features that touch the same context', () => {
    const cost = contextCostFromSpend(
      new Map([['a', 2], ['b', 3]]),
      [uc('a', ['ctx-1']), uc('b', ['ctx-1'])],
    );
    expect(cost.get('ctx-1')).toBe(5);
  });

  it('ignores features with no observed spend', () => {
    const cost = contextCostFromSpend(new Map([['a', 1]]), [uc('a', ['c1']), uc('unused', ['c2'])]);
    expect(cost.has('c2')).toBe(false);
  });
});

describe('contextErrorsFromIssues', () => {
  const contexts = [
    { id: 'ctx-auth', filePaths: ['src/auth/login.ts'] },
    { id: 'ctx-pay', filePaths: ['src/payments/charge.ts'] },
  ];

  it('attributes an issue to the context owning its culprit file', () => {
    const errs = contextErrorsFromIssues([issue({ culprit: 'src/auth/login.ts', count: 42 })], contexts);
    expect(errs.get('ctx-auth')).toBe(42);
    expect(errs.has('ctx-pay')).toBe(false);
  });

  it('matches despite windows separators and a decorated culprit', () => {
    const errs = contextErrorsFromIssues(
      [issue({ culprit: 'src\\auth\\login.ts in handleSubmit', count: 5 })],
      contexts,
    );
    expect(errs.get('ctx-auth')).toBe(5);
  });

  it('sums several issues landing on the same context', () => {
    const errs = contextErrorsFromIssues(
      [
        issue({ shortId: 'A', culprit: 'src/auth/login.ts', count: 3 }),
        issue({ shortId: 'B', culprit: 'src/auth/login.ts', count: 4 }),
      ],
      contexts,
    );
    expect(errs.get('ctx-auth')).toBe(7);
  });

  it('drops a culprit that matches nothing rather than smearing it across contexts', () => {
    const errs = contextErrorsFromIssues([issue({ culprit: 'vendor/lib.js', count: 99 })], contexts);
    expect(errs.size).toBe(0);
  });

  it('ignores issues with no culprit at all', () => {
    expect(contextErrorsFromIssues([issue({ culprit: null, count: 99 })], contexts).size).toBe(0);
  });
});
