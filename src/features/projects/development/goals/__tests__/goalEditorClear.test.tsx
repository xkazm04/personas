import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';

// Every `t.section.key` resolves to the literal "section.key".
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, {
    get: (_s, key) => (key === 'dev_lifecycle'
      ? new Proxy({}, { get: (_d, k) => `dev_lifecycle.${String(k)}` })
      : `${String(section)}.${String(key)}`),
  }),
});
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx: (s: unknown) => String(s) }) }));

const updateGoal = vi.fn(async () => {});
const state = {
  createGoal: vi.fn(), updateGoal, deleteGoal: vi.fn(),
  kpis: [], fetchAllKpis: vi.fn(async () => {}),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

import { GoalEditorModal } from '../GoalEditorModal';

const goal = {
  id: 'g1', project_id: 'p1', title: 'Ship it', description: 'old notes',
  status: 'open', kpi_id: null,
} as Partial<DevGoal> as DevGoal;

describe('GoalEditorModal edit', () => {
  it('clearing the description sends an empty description, not "leave untouched"', async () => {
    render(<GoalEditorModal isOpen onClose={() => {}} projectId="p1" editGoal={goal} />);
    const area = await screen.findByLabelText('dev_lifecycle.goal_field_description');
    fireEvent.change(area, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('common.save'));
    await vi.waitFor(() => expect(updateGoal).toHaveBeenCalled());
    expect(updateGoal.mock.calls[0]).toEqual(['g1', expect.objectContaining({ description: '' })]);
  });
});
