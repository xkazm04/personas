import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/agents/executions', () => ({
  dryRunPersona: vi.fn().mockRejectedValue({ error: 'Persona prompt is empty', kind: 'validation' }),
}));

// resolveError is echoed so the test sees exactly the string the hook handed it.
vi.mock('@/lib/errors/errorRegistry', () => ({ resolveError: (raw: string) => ({ message: raw }) }));

import { useDryRun } from '../useDryRun';

// A serialized AppError object must reach errorMessage as text, not "[object Object]".
describe('useDryRun with an AppError rejection', () => {
  it('never renders [object Object]', async () => {
    const { result } = renderHook(() => useDryRun({ personaId: 'p1' }));
    await act(async () => { await result.current.run(); });
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.errorMessage).toContain('Persona prompt is empty');
  });
});
