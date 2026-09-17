import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PersonaBudgetState } from '@/stores/slices/agents/budgetEnforcementSlice';

vi.mock('../../hooks/useQuickStats', () => ({
  useQuickStats: () => ({
    stats: {
      successRate: 100,
      avgLatencyMs: 900,
      avgCostPerRun: 0.2,
      hasLatencyData: true,
      hasCostData: true,
      lastRunAt: null,
      lastRunStatus: null,
      totalRecent: 3,
      healthGrade: null,
      healthScore: null,
    },
    loading: false,
    isEmpty: false,
  }),
}));

import { QuickStatsBar } from '../QuickStatsBar';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

function seedBudget(entry: PersonaBudgetState | null) {
  const map = new Map<string, PersonaBudgetState>();
  if (entry) map.set(entry.personaId, entry);
  useAgentStore.setState({ budgetSpendMap: map });
}

describe('QuickStatsBar budget chip', () => {
  beforeEach(() => {
    useSystemStore.setState({ editorTab: 'activity', designSubTab: 'manifest' });
  });

  it('shows month-to-date spend against the cap when under budget', () => {
    seedBudget({ personaId: 'p1', name: 'a', spend: 1.12, maxBudget: 5, ratio: 0.224, status: 'ok' });
    render(<QuickStatsBar personaId="p1" />);
    const chip = screen.getByTestId('quick-stat-budget');
    expect(chip.textContent).toContain('$1.12');
    expect(chip.textContent).toContain('$5.00');
  });

  it('warns when spend is near the cap and lands on the budget field', () => {
    seedBudget({ personaId: 'p1', name: 'a', spend: 4.6, maxBudget: 5, ratio: 0.92, status: 'warning' });
    render(<QuickStatsBar personaId="p1" />);
    const chip = screen.getByTestId('quick-stat-budget');
    expect(chip.className).toContain('amber');
    fireEvent.click(chip);
    expect(useSystemStore.getState().editorTab).toBe('design');
    expect(useSystemStore.getState().designSubTab).toBe('responsibilities');
  });

  it('stays hidden when the persona has no cap', () => {
    seedBudget({ personaId: 'p1', name: 'a', spend: 4.6, maxBudget: null, ratio: 0, status: 'ok' });
    render(<QuickStatsBar personaId="p1" />);
    expect(screen.queryByTestId('quick-stat-budget')).toBeNull();
  });
});
