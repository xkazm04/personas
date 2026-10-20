import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CloudDeployment } from '@/api/system/cloud';

const cloudListTriggers = vi.fn();

vi.mock('@/api/system/cloud', () => ({
  cloudListTriggers: (...a: unknown[]) => cloudListTriggers(...a),
  cloudUpdateTrigger: vi.fn(),
  cloudDeleteTrigger: vi.fn(),
  cloudListTriggerFirings: vi.fn(async () => []),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: unknown) => unknown) => sel({ personas: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] }),
}));
vi.mock('@/hooks/usePersonaNameMap', () => ({ usePersonaNameMap: () => (id: string) => id }));
vi.mock('../CreateTriggerForm', () => ({ CreateTriggerForm: () => null }));
vi.mock('../TriggerListItem', () => ({ TriggerListItem: () => null }));

import { CloudSchedulesPanel } from '../CloudSchedulesPanel';

const dep = (personaId: string) => ({ id: `d-${personaId}`, personaId, status: 'active' }) as unknown as CloudDeployment;

describe('CloudSchedulesPanel partial failure', () => {
  it('shows a failed-count notice instead of the empty copy, and Retry re-reads', async () => {
    cloudListTriggers.mockRejectedValue(new Error('orchestrator 500'));
    render(<CloudSchedulesPanel deployments={[dep('p1'), dep('p2')]} onRefresh={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load triggers for 2 personas\./)).toBeTruthy());
    expect(screen.queryByText(/No schedules/i)).toBeNull();
    cloudListTriggers.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByText(/Couldn't load triggers/)).toBeNull());
  });
});
