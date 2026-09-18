import { describe, expect, it } from 'vitest';
import { budgetToneForPct, monthlyBudgetRollup } from '../CloudHistoryHelpers';

describe('monthlyBudgetRollup', () => {
  it('sums spend and cap across the deployments that declare one', () => {
    const r = monthlyBudgetRollup([
      { maxMonthlyBudgetUsd: 10, currentMonthCostUsd: 8.4 },
      { maxMonthlyBudgetUsd: 5, currentMonthCostUsd: 0.6 },
    ]);
    expect(r).toEqual({ spend: 9, cap: 15, pct: 60, unreported: 0 });
  });

  it('warns once utilization crosses 80%', () => {
    const r = monthlyBudgetRollup([{ maxMonthlyBudgetUsd: 10, currentMonthCostUsd: 8.4 }]);
    expect(r?.pct).toBeCloseTo(84);
    expect(budgetToneForPct(r!.pct)).toBe('amber');
  });

  it('is null when no deployment has a limit, so no card renders', () => {
    expect(
      monthlyBudgetRollup([
        { maxMonthlyBudgetUsd: null, currentMonthCostUsd: 40 },
        { maxMonthlyBudgetUsd: 0, currentMonthCostUsd: 2 },
      ]),
    ).toBeNull();
  });

  it('excludes uncapped deployments from the spend it reports', () => {
    // An unlimited deployment's spend must not be charged against a ceiling
    // it does not have.
    const r = monthlyBudgetRollup([
      { maxMonthlyBudgetUsd: 10, currentMonthCostUsd: 2 },
      { maxMonthlyBudgetUsd: null, currentMonthCostUsd: 500 },
    ]);
    expect(r).toEqual({ spend: 2, cap: 10, pct: 20, unreported: 0 });
  });

  it('never counts an unreported spend as zero - it leaves the cap out too', () => {
    // `currentMonthCostUsd` is optional on the wire: absent means the
    // orchestrator did not answer, not that the deployment is free.
    const r = monthlyBudgetRollup([
      { maxMonthlyBudgetUsd: 10, currentMonthCostUsd: 9 },
      { maxMonthlyBudgetUsd: 100, currentMonthCostUsd: null },
    ]);
    expect(r).toEqual({ spend: 9, cap: 10, pct: 90, unreported: 1 });
    expect(budgetToneForPct(r!.pct)).toBe('amber');
  });

  it('is null when every capped deployment failed to report', () => {
    expect(monthlyBudgetRollup([{ maxMonthlyBudgetUsd: 10, currentMonthCostUsd: null }])).toBeNull();
  });
});

describe('budgetToneForPct', () => {
  it('bands under / near / over the cap', () => {
    expect(budgetToneForPct(20)).toBe('emerald');
    expect(budgetToneForPct(80)).toBe('amber');
    expect(budgetToneForPct(100)).toBe('red');
  });
});
