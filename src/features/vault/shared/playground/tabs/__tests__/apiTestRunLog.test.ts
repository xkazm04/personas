import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invoke(...a),
}));

import { useApiTestRunner } from '../../useApiTestRunner';
import { apiTestLineClassName } from '../apiExplorerHelpers';

const EP = (method: string, path: string) =>
  ({ method, path, summary: null, description: null, parameters: [], request_body: null, tags: [] }) as never;

describe('Run All log colouring', () => {
  beforeEach(() => invoke.mockReset());

  it('colours the pass, fail and request lines the runner actually writes', async () => {
    invoke.mockImplementation((cmd: string, args?: { path?: string }) =>
      cmd !== 'execute_api_request' ? Promise.resolve(null)
      : args?.path === '/ok'
        ? Promise.resolve({ status: 200, status_text: 'OK', duration_ms: 5, headers: {}, body: '', content_type: null, truncated: false })
        : Promise.reject({ error: 'connection refused', kind: 'Internal' }));

    const { result } = renderHook(() => useApiTestRunner());
    act(() => result.current.runAll([EP('GET', '/ok'), EP('GET', '/down')], 'cred-1'));
    await waitFor(() => expect(result.current.isRunning).toBe(false));

    const lines = result.current.lines;
    const classOf = (needle: string) => apiTestLineClassName(lines.find((l) => l.includes(needle))!);

    expect(classOf('200 OK')).toBe('text-emerald-400/70');
    expect(classOf('ERROR')).toBe('text-red-400/70');
    expect(classOf('GET /ok')).toBe('text-blue-400/50');
    expect(classOf('Done:')).toBe('text-foreground');
  });

  it("logs a refused request's reason, not the AppError envelope", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd !== 'execute_api_request' ? Promise.resolve(null)
      : Promise.reject({ error: 'connection refused', kind: 'Internal' }));
    const { result } = renderHook(() => useApiTestRunner());
    act(() => result.current.runAll([EP('GET', '/down')], 'cred-1'));
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.lines.some((l) => l.endsWith('ERROR: connection refused'))).toBe(true);
    expect(result.current.results.get('GET:/down')?.error).toBe('connection refused');
  });
});
