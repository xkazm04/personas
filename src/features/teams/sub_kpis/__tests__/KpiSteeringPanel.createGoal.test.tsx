import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

vi.mock('@/api/devTools/devTools', () => ({
  goalAdvancingTeams: () => Promise.resolve([]),
}));

const fetchGoals = vi.fn(() => Promise.resolve());
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ fetchGoals }),
}));

// The real editor pulls the whole system store; this test only proves the
// steering panel hands it the right project + pre-linked KPI.
const editorProps: Record<string, unknown>[] = [];
vi.mock('../../sub_goals/GoalEditorModal', () => ({
  GoalEditorModal: (props: Record<string, unknown>) => {
    editorProps.push(props);
    return <div data-testid="goal-editor-stub" />;
  },
}));

import { KpiSteeringPanel } from '../KpiSteeringPanel';

const kpi = (over: Partial<DevKpi> = {}): DevKpi => ({
  id: 'kpi-1',
  project_id: 'proj-1',
  context_group_id: null,
  context_id: null,
  use_case_id: null,
  name: 'Weekly active users',
  description: null,
  category: 'value',
  measure_kind: 'manual',
  measure_config: '{}',
  unit: 'users',
  direction: 'up',
  baseline_value: 0,
  target_value: 100,
  target_date: null,
  current_value: 10,
  last_measured_at: null,
  cadence: 'weekly',
  status: 'active',
  created_by: 'user',
  rationale: null,
  needed_connector: null,
  metric_type: null,
  tier: 'primary',
  warn_at: null,
  // Hard critical line already crossed → off-track regardless of pace.
  crit_at: 20,
  manual_rating: null,
  assessment_pros: null,
  assessment_cons: null,
  last_skip_at: null,
  last_skip_rationale: null,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
  ...over,
});

describe('KpiSteeringPanel — off-track with no linked goals', () => {
  it('offers a create-goal action beside the caption', () => {
    editorProps.length = 0;
    render(<KpiSteeringPanel kpi={kpi()} linkedGoals={[]} measurements={[]} />);

    expect(screen.getByText(en.kpis.steering_none_offtrack)).toBeTruthy();
    expect(screen.getByTestId('kpi-steering-create-goal')).toBeTruthy();
    // Closed until asked for.
    expect(screen.queryByTestId('goal-editor-stub')).toBeNull();
  });

  it('opens the goal editor pre-linked to this KPI and its project', () => {
    editorProps.length = 0;
    render(<KpiSteeringPanel kpi={kpi()} linkedGoals={[]} measurements={[]} />);

    fireEvent.click(screen.getByTestId('kpi-steering-create-goal'));

    expect(screen.getByTestId('goal-editor-stub')).toBeTruthy();
    const last = editorProps[editorProps.length - 1];
    expect(last.projectId).toBe('proj-1');
    expect(last.initialKpiId).toBe('kpi-1');
  });

  it('refetches the project goals after a save so the new goal lands in flight', () => {
    editorProps.length = 0;
    fetchGoals.mockClear();
    render(<KpiSteeringPanel kpi={kpi()} linkedGoals={[]} measurements={[]} />);
    fireEvent.click(screen.getByTestId('kpi-steering-create-goal'));

    const onSaved = editorProps[editorProps.length - 1].onSaved as () => void;
    onSaved();
    expect(fetchGoals).toHaveBeenCalledWith('proj-1');
  });

  it('shows no create action when the KPI is on track', () => {
    editorProps.length = 0;
    render(
      <KpiSteeringPanel
        kpi={kpi({ crit_at: null, current_value: 100 })}
        linkedGoals={[]}
        measurements={[]}
      />,
    );
    // on-track + no goals → the panel renders nothing at all.
    expect(screen.queryByTestId('kpi-steering-create-goal')).toBeNull();
  });
});
