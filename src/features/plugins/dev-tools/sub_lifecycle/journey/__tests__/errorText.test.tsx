import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { resolveError } from '@/lib/errors/errorRegistry';

import { errorText } from '../../lifecycleView/system/errorText';
import { useLifecycleSnapshot } from '../useLifecycleSnapshot';

// An IPC rejection is a serialized AppError OBJECT, never an `Error`. The old
// ladder handed the registry "[object Object]", so a classified failure read as
// the generic "Something went wrong.".

const getLifecycle = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle }));

const appError = { error: 'Request timed out after 30s', kind: 'timeout' };
const timedOut = resolveError('timed out').message;

describe('Lifecycle failure copy reads the IPC envelope', () => {
  it('classifies an AppError object, not "[object Object]"', () => {
    expect(timedOut).not.toBe(resolveError(null).message);
    expect(errorText(appError)).toBe(timedOut);
    expect(errorText(new Error('Request timed out'))).toBe(timedOut);
  });

  it('the snapshot read shows the classified sentence', async () => {
    getLifecycle.mockRejectedValue(appError);
    const { result } = renderHook(() => useLifecycleSnapshot('p-err-envelope'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(timedOut);
  });

  it('no Lifecycle source keeps the instanceof-Error ladder', () => {
    const root = resolve(__dirname, '../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/instanceof Error \? \w+\.message : String\(/.test(src)) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
