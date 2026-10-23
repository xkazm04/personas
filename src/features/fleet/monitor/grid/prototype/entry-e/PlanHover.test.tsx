// The plan row's hover view prints only the numbers a read filled: per window
// the span, the used %, the countdown and the wall-clock reset; for the plan,
// when it was measured. Absent values are omitted, never invented.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PlanModel, ProviderModel, WindowModel } from '../../usage/useResourceModel';
import { PlanHover } from './PlanHover';

const NOW = Date.UTC(2026, 9, 16, 10, 0);
const HOUR = 3_600_000;

const win = (over: Partial<WindowModel>): WindowModel => ({
  key: 'five_hour', label: 'short', usedPct: 62, resetsAtMs: NOW + 2 * HOUR, windowMinutes: 300, pace: null,
  projected: false, asOfMs: NOW - 180_000, tone: 'ok', elapsedFrac: 0.6, remainingMs: 2 * HOUR, ...over,
});

const plan = (over: Partial<PlanModel> = {}): PlanModel => ({
  id: 'acc-1', name: 'ops@personas.dev', slot: 1, isActive: true, state: 'ok', reason: null,
  windows: [win({}), win({ key: 'seven_day', label: 'long', usedPct: 87, tone: 'warning', windowMinutes: 10_080, resetsAtMs: NOW + 30 * HOUR, remainingMs: 30 * HOUR })],
  asOfMs: NOW - 180_000, canSwitch: false, canRemove: false, login: null, relogin: null, rotationRank: null, ...over,
});

const claude: ProviderModel = {
  id: 'claude', readOnly: false, installed: true, version: null, emptyReason: null, pending: false, plans: [], asOfMs: null, projected: false,
};

describe('PlanHover', () => {
  it('prints used %, the span and both reset forms per window, and when it was measured', () => {
    render(<PlanHover plan={plan()} provider={claude} now={NOW} />);
    const rows = screen.getAllByTestId('entry-e-plan-hover-window');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId('entry-e-plan-hover-used').textContent).toMatch(/62\s?%/);
    expect(rows[0]!.textContent).toContain('5h');
    const reset = within(rows[0]!).getByTestId('entry-e-plan-hover-reset').textContent ?? '';
    expect(reset).toMatch(/2h/);
    expect(reset).toMatch(/\d{2}:\d{2}/);
    expect(within(rows[1]!).getByTestId('entry-e-plan-hover-used').className).toContain('text-status-warning');
    expect(screen.getByTestId('entry-e-plan-hover-asof')).toBeTruthy();
  });

  it('never prints an absolute used / limit count: no read reports one', () => {
    render(<PlanHover plan={plan()} provider={claude} now={NOW} />);
    expect(screen.getByTestId('entry-e-plan-hover').textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('omits what a read left absent: no reset clock, no as-of line', () => {
    render(<PlanHover plan={plan({ asOfMs: null, windows: [win({ resetsAtMs: null, remainingMs: null })] })} provider={claude} now={NOW} />);
    const reset = screen.getByTestId('entry-e-plan-hover-reset').textContent ?? '';
    expect(reset).not.toMatch(/\d{2}:\d{2}/);
    expect(screen.queryByTestId('entry-e-plan-hover-asof')).toBeNull();
  });

  it('says why an unreadable plan has no numbers', () => {
    render(<PlanHover plan={plan({ state: 'quarantined', windows: [] })} provider={claude} now={NOW} />);
    expect(screen.queryAllByTestId('entry-e-plan-hover-window')).toHaveLength(0);
    expect(screen.getByTestId('entry-e-plan-hover').textContent).toContain('Needs login');
  });
});
