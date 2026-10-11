import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import CloudDeployPanel from './CloudDeployPanel';

const cloudDiagnose = vi.hoisted(() => vi.fn());
const toastCatchInner = vi.hoisted(() => vi.fn());
const toastCatch = vi.hoisted(() => vi.fn(() => toastCatchInner));

vi.mock('@/api/system/cloud', async (original) => ({
  ...(await original<typeof import('@/api/system/cloud')>()),
  cloudDiagnose,
}));
vi.mock('@/lib/silentCatch', async (original) => ({
  ...(await original<typeof import('@/lib/silentCatch')>()),
  toastCatch,
}));
vi.mock('@/features/agents/sub_deployment/hooks/useCloudHealthMonitor', () => ({ useCloudHealthMonitor: vi.fn() }));

beforeEach(() => {
  cloudDiagnose.mockReset();
  toastCatch.mockClear();
  toastCatchInner.mockClear();
  useSystemStore.setState({ cloudConfig: null, cloudInitialize: vi.fn() });
});

describe('CloudDeployPanel Diagnose', () => {
  it('reports a rejected diagnosis through the user-facing error handler', async () => {
    const error = new Error('TLS handshake failed');
    cloudDiagnose.mockRejectedValueOnce(error);
    render(<CloudDeployPanel />);

    fireEvent.change(screen.getByLabelText('Cloud Server URL'), { target: { value: 'https://cloud.example' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose' }));

    await waitFor(() => expect(cloudDiagnose).toHaveBeenCalledWith('https://cloud.example', 'secret-key'));
    await waitFor(() => expect(toastCatchInner).toHaveBeenCalledWith(error));
  });
});
