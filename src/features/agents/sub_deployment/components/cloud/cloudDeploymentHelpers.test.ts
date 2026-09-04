import { describe, it, expect } from 'vitest';
import type { CloudDeployment } from '@/api/system/cloud';
import { budgetUtilization, budgetColor, statusColor, statusIcon } from './cloudDeploymentHelpers';
import { CheckCircle2, PauseCircle, XCircle, Circle } from 'lucide-react';

const dep = (max: number | null, cost: number | null) =>
  ({ maxMonthlyBudgetUsd: max, currentMonthCostUsd: cost } as unknown as CloudDeployment);

describe('budgetUtilization', () => {
  it('is null with no cap or no spend, so the gauge is not drawn for those', () => {
    expect(budgetUtilization(dep(null, 4))).toBeNull();
    expect(budgetUtilization(dep(10, null))).toBeNull();
    expect(budgetUtilization(dep(10, 0))).toBeNull();
  });
  it('is a percentage of the cap, clamped at 100', () => {
    expect(budgetUtilization(dep(10, 2.5))).toBe(25);
    expect(budgetUtilization(dep(10, 25))).toBe(100);
  });
});

describe('budgetColor thresholds', () => {
  it('turns amber at 50 and red at 80 (inclusive)', () => {
    expect(budgetColor(49.9)).toBe('bg-emerald-500');
    expect(budgetColor(50)).toBe('bg-amber-500');
    expect(budgetColor(79.9)).toBe('bg-amber-500');
    expect(budgetColor(80)).toBe('bg-red-500');
  });
});

describe('status presentation is a closed pair (colour + shape)', () => {
  it.each([
    ['active', CheckCircle2, 'emerald'],
    ['paused', PauseCircle, 'amber'],
    ['failed', XCircle, 'red'],
    ['deploying', Circle, 'secondary'],
  ])('%s', (status, icon, hue) => {
    expect(statusIcon(status)).toBe(icon);
    expect(statusColor(status)).toContain(hue);
  });
});
