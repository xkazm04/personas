import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { extractMessage } from '@/lib/silentCatch';

// IPC rejects with a serialized AppError OBJECT, never an Error.
const APP_ERROR = { error: 'database is locked', kind: 'Database' };

vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string) =>
    cmd === 'list_audit_incidents'
      ? Promise.reject(APP_ERROR)
      : Promise.resolve({ open: 0, acknowledged: 0, resolved: 0, openBySeverity: [] }),
  ),
}));

import { useIncidentsData } from '../useIncidentsData';
import { OPEN_ONLY_FILTERS } from '../incidentFilterDefaults';

describe('useIncidentsData list failure', () => {
  it('keeps the IPC error raw so the banner can name it (never "[object Object]")', async () => {
    const { result } = renderHook(() => useIncidentsData(OPEN_ONLY_FILTERS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(extractMessage(result.current.error!.raw)).toBe('database is locked');
    expect(extractMessage(result.current.error!.raw)).not.toContain('[object Object]');
  });
});
