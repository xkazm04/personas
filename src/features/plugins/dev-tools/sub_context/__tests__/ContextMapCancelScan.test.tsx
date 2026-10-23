import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import { useSystemStore } from '@/stores/systemStore';

// A rejected cancel used to skip processEnded + the phase reset, so the
// ScanOverlay stayed up and the rejection went unhandled.

const cancelScanCodebase = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/devTools', () => ({
  cancelScanCodebase,
  getScanCodebaseStatus: vi.fn(async () => null),
}));
vi.mock('@/api/systemOps', () => ({ planWeeklyContextScan: vi.fn() }));
vi.mock('@/hooks/useTauriEvent', () => ({ useTauriEvent: () => {} }));
vi.mock('../../hooks/useDevToolsActions', () => ({
  useDevToolsActions: () => ({ createContextGroup: vi.fn(), scanCodebase: vi.fn(), runScan: vi.fn() }),
}));
vi.mock('../useContextRuntime', () => ({ useContextRuntime: () => ({}) }));
vi.mock('../useUseCases', () => ({ useUseCases: () => ({ active: [], useCases: [], loading: false, scanning: false }) }));
vi.mock('../../sub_lifecycle/LifecycleProjectPicker', () => ({ LifecycleProjectPicker: () => null }));
vi.mock('../ContextDetail', () => ({ default: () => null }));
vi.mock('../ContextLedger', () => ({ default: () => null }));
vi.mock('../ContextGroupRowsStats', () => ({ default: () => null }));
vi.mock('../ContextMapHealth', () => ({ ContextMapHealth: () => null }));

const overlayProps = vi.hoisted(() => ({ onCancel: null as null | (() => Promise<void> | void) }));
vi.mock('../ScanOverlay', () => ({
  default: (p: { onCancel: () => Promise<void> | void }) => { overlayProps.onCancel = p.onCancel; return null; },
}));

import ContextMapPage from '../ContextMapPage';

beforeEach(() => {
  vi.clearAllMocks();
  cancelScanCodebase.mockRejectedValue(new Error('cancel ipc timed out'));
  useSystemStore.setState({ codebaseScanPhase: 'running', activeScanId: 'scan-1' });
});

describe('context scan cancel', () => {
  it('settles the UI even when the cancel call rejects', async () => {
    render(<ContextMapPage />);
    expect(overlayProps.onCancel).toBeTruthy();
    await overlayProps.onCancel!();
    await waitFor(() => expect(cancelScanCodebase).toHaveBeenCalledWith('scan-1'));
    expect(useSystemStore.getState().codebaseScanPhase).toBe('idle');
    expect(useSystemStore.getState().activeScanId).toBeNull();
  });
});
