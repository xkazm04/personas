import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import GoalCard from '../GoalCard';

function goal(over: Partial<DevGoal>): DevGoal {
  return {
    id: 'g1', project_id: 'p1', kpi_id: null, order_index: 0,
    title: 'Ship the loader', description: null, status: 'open', progress: 0,
    target_date: null, started_at: null, completed_at: null,
    created_at: '2026-09-01 10:00:00', updated_at: '2026-09-01 10:00:00',
    ...over,
  } as DevGoal;
}

function kpi(over: Partial<DevKpi>): DevKpi {
  return {
    id: 'k1', name: 'Activation rate', category: 'value', unit: '%',
    direction: 'up', baseline_value: 10, current_value: 12, target_value: 60,
    ...over,
  } as unknown as DevKpi;
}

describe('GoalCard outcome chip', () => {
  it('a KPI-linked goal shows the KPI name on the card', () => {
    render(<GoalCard goal={goal({ kpi_id: 'k1' })} items={[]} kpi={kpi({})} />);

    const chip = screen.getByTestId('goal-card-kpi');
    expect(chip.textContent).toContain('Activation rate');
    expect(chip.getAttribute('aria-label')).toBe(en.kpis.goal_link_title);
  });

  it('an ungrounded goal stays plain', () => {
    render(<GoalCard goal={goal({ kpi_id: null })} items={[]} />);
    expect(screen.queryByTestId('goal-card-kpi')).toBeNull();
  });

  it('a dangling kpi_id renders nothing rather than an empty chip', () => {
    // The KPI was archived, so the board could not resolve it. Same silence
    // GoalKpiLink keeps in the drawer.
    render(<GoalCard goal={goal({ kpi_id: 'gone' })} items={[]} />);
    expect(screen.queryByTestId('goal-card-kpi')).toBeNull();
  });

  it('an off-track KPI is tinted differently from a met one', () => {
    const { unmount } = render(
      <GoalCard goal={goal({ kpi_id: 'k1' })} items={[]} kpi={kpi({ current_value: 90 })} />,
    );
    const met = screen.getByTestId('goal-card-kpi').getAttribute('style');
    unmount();

    render(<GoalCard goal={goal({ kpi_id: 'k1' })} items={[]} kpi={kpi({ current_value: 1 })} />);
    const behind = screen.getByTestId('goal-card-kpi').getAttribute('style');

    expect(met).not.toBe(behind);
  });
});
