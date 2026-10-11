import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CloudSchedulesPanel } from './CloudSchedulesPanel';
import type { CloudDeployment } from '@/api/system/cloud';

const api = vi.hoisted(() => ({
  cloudListTriggers: vi.fn(),
  cloudUpdateTrigger: vi.fn(),
  cloudDeleteTrigger: vi.fn(),
  cloudListTriggerFirings: vi.fn(),
  cloudCreateTrigger: vi.fn(),
}));
const toastCatchInner = vi.hoisted(() => vi.fn());
const toastCatch = vi.hoisted(() => vi.fn((_ctx: string) => toastCatchInner));

vi.mock('@/api/system/cloud', () => api);
vi.mock('@/lib/silentCatch', async (orig) => ({ ...(await orig<typeof import('@/lib/silentCatch')>()), toastCatch }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: unknown[] }) => unknown) => sel({ personas: [{ id: 'p1', name: 'Alpha' }] }),
}));
vi.mock('@/hooks/usePersonaNameMap', () => ({ usePersonaNameMap: () => (id: string) => id }));

const deployments = [{ id: 'd1', personaId: 'p1', status: 'active' }] as unknown as CloudDeployment[];
const trigger = { id: 'tr-1', personaId: 'p1', triggerType: 'schedule', config: '{"cron":"0 * * * *"}', enabled: true,
  healthStatus: null, healthMessage: null, lastTriggeredAt: null, nextTriggerAt: null };

describe('CloudSchedulesPanel remote writes', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    toastCatchInner.mockReset();
    toastCatch.mockClear();
    api.cloudListTriggers.mockResolvedValue([trigger]);
    api.cloudListTriggerFirings.mockResolvedValue([]);
  });

  it('a rejected enable/disable toggle goes through toastCatch and the row stays', async () => {
    const boom = new Error('orchestrator said no');
    api.cloudUpdateTrigger.mockRejectedValueOnce(boom);
    render(<CloudSchedulesPanel deployments={deployments} onRefresh={() => {}} />);
    fireEvent.click(await screen.findByText('0 * * * *'));
    const toggle = await screen.findByTestId('cloud-trigger-toggle-tr-1');
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(toastCatchInner).toHaveBeenCalledWith(boom));
    expect(toastCatch).toHaveBeenCalledWith('CloudSchedulesPanel:toggle');
    expect(screen.getByTestId('cloud-trigger-toggle-tr-1')).toBeTruthy();
  });
});
