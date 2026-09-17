import { describe, expect, it } from 'vitest';
import { budgetTone, budgetToneForPct, monthlyBudgetRollup, projectMonthEndSpend } from '../CloudHistoryHelpers';

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

// --------------------------------------------------------------------------
// sweep #116 — the cap card carries a month-end projection, and the tone knows
// the difference between money already spent and money merely forecast.
// --------------------------------------------------------------------------

describe('projectMonthEndSpend', () => {
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

  it('extrapolates the month-to-date burn in a straight line', () => {
    // $8.40 by day 20 of a 30-day month -> $12.60, the card's own worked example.
    expect(projectMonthEndSpend(8.4, at(2026, 9, 20))).toBeCloseTo(12.6, 5);
  });

  it('is null on day one, when there is nothing to extrapolate from', () => {
    // A few hours of spend divided by a fraction of a day reads as a 30x
    // overshoot; no projection is honest, a wild one is not.
    expect(projectMonthEndSpend(0.5, at(2026, 9, 1))).toBeNull();
  });

  it('reports the spend itself on the last day of the month', () => {
    expect(projectMonthEndSpend(11, at(2026, 9, 30))).toBe(11);
  });

  it('uses the real length of the month, not a fixed 30', () => {
    // February 2026 has 28 days: $7 by day 14 projects to $14, not $15.
    expect(projectMonthEndSpend(7, at(2026, 2, 14))).toBeCloseTo(14, 5);
  });
});

describe('budgetTone', () => {
  it('stays green when both actual and projected sit under the cap', () => {
    expect(budgetTone(20, false)).toBe('emerald');
  });

  it('warns when the projection crosses a cap the actual spend has not', () => {
    expect(budgetTone(20, true)).toBe('amber');
  });

  it('never paints a forecast red - actual overspend outranks it', () => {
    // A pace far over the cap on a calm month is still an estimate: amber.
    expect(budgetTone(10, true)).toBe('amber');
    // Actually over the cap is a fact: red.
    expect(budgetTone(100, true)).toBe('red');
  });

  it('is unchanged when there is no projection to act on', () => {
    expect(budgetTone(20, false)).toBe('emerald');
    expect(budgetTone(85, false)).toBe('amber');
  });
});
