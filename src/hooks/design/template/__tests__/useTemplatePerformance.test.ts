import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getTemplatePerformance = vi.fn();
vi.mock('@/api/templates/templateFeedback', () => ({
  getTemplatePerformance: (id: string) => getTemplatePerformance(id),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: () => () => {},
}));

import { useTemplatePerformance } from '../useTemplatePerformance';

describe('useTemplatePerformance', () => {
  it('shows the message of an IPC AppError rejection, not "[object Object]"', async () => {
    // invokeWithTimeout rejects with the serialized AppError envelope, never an Error.
    getTemplatePerformance.mockRejectedValueOnce({ error: 'Template review missing', kind: 'NotFound' });
    const { result } = renderHook(() => useTemplatePerformance('review-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Template review missing');
    expect(result.current.performance).toBeNull();
  });
});
