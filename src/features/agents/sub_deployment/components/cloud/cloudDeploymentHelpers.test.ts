import { describe, it, expect } from 'vitest';
import type { CloudDeployment } from '@/api/system/cloud';
import { budgetUtilization, budgetColor, statusColor, statusIcon } from './cloudDeploymentHelpers';
import { CheckCircle2, PauseCircle, XCircle, Circle } from 'lucide-react';
import { budgetToneForPct } from './CloudHistoryHelpers';

const dep = (max: number | null, cost: number | null) =>
  ({ maxMonthlyBudgetUsd: max, currentMonthCostUsd: cost } as unknown as CloudDeployment);

describe('budgetUtilization', () => {
  it('is null with no cap or unreported spend, but measures a reported zero', () => {
    expect(budgetUtilization(dep(null, 4))).toBeNull();
    expect(budgetUtilization(dep(10, null))).toBeNull();
    expect(budgetUtilization(dep(10, 0))).toBe(0);
  });
  it('is a percentage of the cap, including overspend', () => {
    expect(budgetUtilization(dep(10, 2.5))).toBe(25);
    expect(budgetUtilization(dep(10, 25))).toBe(250);
  });
});

describe('budgetColor thresholds', () => {
  it.each([0, 49, 50, 79, 80, 99, 100, 150])('agrees with the history tone at %i percent', (pct) => {
    const tone = budgetToneForPct(pct);
    expect(budgetColor(pct)).toBe({ emerald: 'bg-status-success', amber: 'bg-status-warning', red: 'bg-status-error' }[tone]);
  });
});

describe('status presentation is a closed pair (colour + shape)', () => {
  it.each([
    ['active', CheckCircle2, 'status-success'],
    ['paused', PauseCircle, 'status-warning'],
    ['failed', XCircle, 'status-error'],
    ['deploying', Circle, 'surface-2'],
  ])('%s', (status, icon, hue) => {
    expect(statusIcon(status)).toBe(icon);
    expect(statusColor(status)).toContain(hue);
  });
});
